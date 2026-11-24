// src/services/llamada.service.js
// Funciones para iniciar llamadas salientes desde tu sistema hacia los leads

import twilio from 'twilio';
import { encolarLlamada } from './queue.js';

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/**
 * Inicia una llamada saliente.
 * Primero conecta al agente, luego al lead.
 *
 * @param {object} params
 * @param {string} params.leadPhone    - Teléfono del lead a llamar
 * @param {string} params.agentPhone   - Teléfono del agente que llama
 * @param {number} params.fubPersonId  - ID del lead en FUB
 */
export async function iniciarLlamadaSaliente({ leadPhone, agentPhone, fubPersonId }) {
  console.log(`[Llamada] Iniciando llamada saliente a ${leadPhone}`);

  const call = await twilioClient.calls.create({
    to:   agentPhone || process.env.AGENT_PHONE_NUMBER,
    from: process.env.TWILIO_TRACKING_NUMBER,
    // Cuando el agente contesta, conectamos al lead
    url:  `${process.env.BASE_URL}/webhook/twilio/saliente-conectar?leadPhone=${encodeURIComponent(leadPhone)}`,
    // Cuando termina, registramos en FUB
    statusCallback:         `${process.env.BASE_URL}/webhook/twilio/estado`,
    statusCallbackMethod:   'POST',
    // Grabación
    record:                  true,
    recordingStatusCallback: `${process.env.BASE_URL}/webhook/twilio/grabacion`,
  });

  console.log(`[Llamada] Llamada iniciada: SID ${call.sid}`);
  return call.sid;
}
