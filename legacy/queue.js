// src/services/queue.js
// Cola de trabajos con Bull + Redis
// Todos los eventos pasan por aquí antes de llegar a FUB
// Esto evita sobrepasar el rate limit de FUB (200 req / 10 seg)

import Bull from 'bull';

// Una sola instancia de la cola — se reutiliza en toda la app
export const fubQueue = new Bull('fub-events', {
  redis: process.env.REDIS_URL,
  defaultJobOptions: {
    attempts:  5,                        // reintenta hasta 5 veces si FUB falla
    backoff: {
      type:  'exponential',
      delay: 2000,                       // espera: 2s, 4s, 8s, 16s, 32s
    },
    removeOnComplete: 100,               // guarda los últimos 100 trabajos exitosos
    removeOnFail:     50,
  },
});

// Helpers para agregar trabajos a la cola
// Úsalos desde tus rutas en lugar de llamar a FUB directamente

export async function encolarLlamada(datos) {
  return fubQueue.add('registrar-llamada', datos);
}

export async function encolarLead(datos) {
  return fubQueue.add('crear-lead', datos);
}

export async function encolarActualizarLlamada(datos) {
  return fubQueue.add('actualizar-llamada', datos);
}

export async function encolarNota(datos) {
  return fubQueue.add('agregar-nota', datos);
}
