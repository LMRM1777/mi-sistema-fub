// src/routes/twilio.routes.js
// Webhooks que Twilio llama cuando hay actividad en las llamadas
// Twilio → tu servidor → cola → FUB

import { Router } from 'express';
import twilio from 'twilio';
import {
  encolarLead,
  encolarLlamada,
  encolarActualizarLlamada,
} from '../services/queue.js';
import { buscarLeadPorTelefono } from '../services/fub.service.js';

const router = Router();
const VoiceResponse = twilio.twiml.VoiceResponse;

// Guardamos sesiones de llamadas en memoria (en producción usa Redis)
const sesionesLlamadas = new Map();

// ─── LLAMADA ENTRANTE ─────────────────────────────────────────────────────────
// Twilio llama a este endpoint cuando alguien marca tu número de rastreo
// URL que configuras en Twilio: https://tu-app.railway.app/webhook/twilio/entrante

router.post('/entrante', async (req, res) => {
  const { From, To, CallSid } = req.body;

  console.log(`[Twilio] Llamada entrante: ${From} → ${To}`);

  // Guardar la sesión para usarla cuando termine la llamada
  sesionesLlamadas.set(CallSid, {
    callSid:     CallSid,
    callerPhone: From,
    trackingNum: To,
    direction:   'inbound',
    startTime:   new Date(),
    fubPersonId: null,
    fubCallId:   null,
  });

  // Buscar si el lead ya existe en FUB
  const leadExistente = await buscarLeadPorTelefono(From);
  if (leadExistente) {
    const sesion = sesionesLlamadas.get(CallSid);
    sesion.fubPersonId = leadExistente.id;
    sesionesLlamadas.set(CallSid, sesion);
  }

  // Responder a Twilio con instrucciones (TwiML)
  const twiml = new VoiceResponse();
  twiml.say({ language: 'es-MX' }, 'Un momento por favor.');

  const dial = twiml.dial({
    record:                  'record-from-ringing',
    recordingStatusCallback: `${process.env.BASE_URL}/webhook/twilio/grabacion`,
    timeout:                 20,
    action:                  `${process.env.BASE_URL}/webhook/twilio/estado`,
  });

  dial.number(process.env.AGENT_PHONE_NUMBER);

  res.type('text/xml').send(twiml.toString());
});

// ─── ESTADO DE LA LLAMADA ─────────────────────────────────────────────────────
// Twilio llama aquí cuando la llamada termina (completed, no-answer, busy, failed)

router.post('/estado', async (req, res) => {
  const { CallSid, CallStatus, CallDuration, From } = req.body;

  console.log(`[Twilio] Llamada ${CallSid} terminó: ${CallStatus} (${CallDuration}s)`);

  const sesion = sesionesLlamadas.get(CallSid);
  if (!sesion) return res.sendStatus(200);

  try {
    // Si el lead no existía, crearlo en FUB
    if (!sesion.fubPersonId) {
      await encolarLead({
        telefono: From || sesion.callerPhone,
        fuente:   `Llamada Entrante - ${sesion.trackingNum}`,
      });
    }

    // Registrar la llamada en FUB
    const mins = Math.floor((parseInt(CallDuration) || 0) / 60);
    const secs = (parseInt(CallDuration) || 0) % 60;

    await encolarLlamada({
      personId:  sesion.fubPersonId,
      duracion:  parseInt(CallDuration) || 0,
      resultado: CallStatus,
      nota: [
        `Llamada ${CallStatus === 'completed' ? 'conectada' : 'sin respuesta'}`,
        `Duración: ${mins}m ${secs}s`,
        `Número de rastreo: ${sesion.trackingNum}`,
        `Dirección: ${sesion.direction === 'inbound' ? 'Entrante' : 'Saliente'}`,
      ].join('\n'),
      fechaHora: sesion.startTime.toISOString(),
    });

  } catch (err) {
    console.error('[Twilio] Error procesando estado de llamada:', err.message);
  }

  sesionesLlamadas.delete(CallSid);
  res.sendStatus(200);
});

// ─── GRABACIÓN LISTA ──────────────────────────────────────────────────────────
// Twilio llama aquí unos segundos después cuando termina de procesar el audio

router.post('/grabacion', async (req, res) => {
  const { CallSid, RecordingUrl, RecordingDuration } = req.body;

  console.log(`[Twilio] Grabación lista para ${CallSid}: ${RecordingUrl}`);

  const sesion = sesionesLlamadas.get(CallSid);
  if (sesion?.fubCallId) {
    await encolarActualizarLlamada({
      callId:       sesion.fubCallId,
      grabacionUrl: `${RecordingUrl}.mp3`,
      nota:         `Grabación disponible: ${RecordingUrl}.mp3 (${RecordingDuration}s)`,
    });
  }

  res.sendStatus(200);
});

// ─── CONECTAR LLAMADA SALIENTE ────────────────────────────────────────────────
// Cuando el agente contesta, Twilio llama aquí para conectarlo con el lead

router.post('/saliente-conectar', (req, res) => {
  const { leadPhone } = req.query;

  const twiml = new VoiceResponse();
  const dial = twiml.dial({ record: 'record-from-answer' });
  dial.number(leadPhone);

  res.type('text/xml').send(twiml.toString());
});

export default router;
