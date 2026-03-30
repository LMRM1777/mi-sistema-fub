// src/services/fub.service.js
// Funciones de alto nivel para interactuar con FUB

import { createFubClient } from './fub.client.js';

const apiKey = process.env.FUB_USER_API_KEY;

// ─── LEADS ──────────────────────────────────────────────────────────────────

/**
 * Crea un nuevo lead en FUB. Si el lead ya existe (mismo email/teléfono),
 * FUB lo actualiza en lugar de duplicarlo.
 * Esto también dispara los action plans configurados en FUB.
 */
export async function crearLead({ nombre, apellido, telefono, email, fuente }) {
  const fub = createFubClient(apiKey);

  const person = { phones: [] };
  if (nombre)   person.firstName = nombre;
  if (apellido) person.lastName  = apellido;
  if (telefono) person.phones.push({ value: telefono, type: 'mobile' });
  if (email)    person.emails = [{ value: email }];

  const resp = await fub.post('/events', {
    source: fuente || 'Sistema de Llamadas',
    system: process.env.FUB_SYSTEM_NAME || 'MiSistema',
    type:   'General Inquiry',
    person,
  });

  return resp.data;
}

// ─── LLAMADAS ────────────────────────────────────────────────────────────────

/**
 * Registra una llamada en el timeline del lead en FUB.
 */
export async function registrarLlamada({
  personId,
  duracion,       // en segundos
  resultado,      // 'Connected' | 'Left Voicemail' | 'No Answer'
  grabacionUrl,   // URL del audio .mp3
  nota,
  fechaHora,
}) {
  const fub = createFubClient(apiKey);

  const outcomeMap = {
    'completed': 'Connected',
    'no-answer': 'Left Voicemail',
    'busy':      'No Answer',
    'failed':    'No Answer',
  };

  const resp = await fub.post('/calls', {
    personId,
    duration:     duracion || 0,
    outcome:      outcomeMap[resultado] || resultado || 'No Answer',
    note:         nota || `Llamada ${resultado} — ${duracion}s`,
    recordingUrl: grabacionUrl || undefined,
    createdAt:    fechaHora || new Date().toISOString(),
  });

  return resp.data;
}

/**
 * Actualiza una llamada ya registrada — útil para agregar la grabación
 * cuando Twilio termina de procesarla (llega unos segundos después).
 */
export async function actualizarLlamada(callId, { grabacionUrl, nota }) {
  const fub = createFubClient(apiKey);

  const resp = await fub.put(`/calls/${callId}`, {
    recordingUrl: grabacionUrl,
    note:         nota,
  });

  return resp.data;
}

// ─── NOTAS ───────────────────────────────────────────────────────────────────

/**
 * Agrega una nota de texto al timeline del lead.
 */
export async function agregarNota({ personId, texto }) {
  const fub = createFubClient(apiKey);

  const resp = await fub.post('/notes', {
    personId,
    body: texto,
  });

  return resp.data;
}

// ─── PERSONAS ────────────────────────────────────────────────────────────────

/**
 * Busca un lead por número de teléfono.
 * Devuelve el lead o null si no existe.
 */
export async function buscarLeadPorTelefono(telefono) {
  const fub = createFubClient(apiKey);

  try {
    const resp = await fub.get('/people', {
      params: { phone: telefono },
    });
    return resp.data?.people?.[0] || null;
  } catch {
    return null;
  }
}
