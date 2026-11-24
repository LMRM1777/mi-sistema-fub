// src/services/fub.client.js
// Cliente base para comunicarse con la API de Follow Up Boss

import axios from 'axios';

const FUB_BASE_URL = 'https://api.followupboss.com/v1';

/**
 * Crea un cliente HTTP listo para llamar a FUB.
 * Incluye los headers X-System y Authorization automáticamente.
 *
 * @param {string} userApiKey - API Key del agente en FUB (Admin → API)
 */
export function createFubClient(userApiKey) {
  const headers = { 'Content-Type': 'application/json' };

  // Agrega X-System solo si ya tienes el registro aprobado por FUB
  if (process.env.FUB_SYSTEM_NAME) headers['X-System']     = process.env.FUB_SYSTEM_NAME;
  if (process.env.FUB_SYSTEM_KEY)  headers['X-System-Key'] = process.env.FUB_SYSTEM_KEY;

  return axios.create({
    baseURL: FUB_BASE_URL,
    headers,
    auth: {
      username: userApiKey,
      password: '',           // FUB usa solo username (la API Key)
    },
  });
}
