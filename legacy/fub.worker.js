// src/workers/fub.worker.js
// El "procesador" — corre en background y ejecuta cada trabajo de la cola
// Lee un trabajo a la vez y llama a FUB respetando el rate limit

import 'dotenv/config';
import Bottleneck from 'bottleneck';
import { fubQueue } from '../services/queue.js';
import {
  crearLead,
  registrarLlamada,
  actualizarLlamada,
  agregarNota,
} from '../services/fub.service.js';

// Limiter: máximo 1 request cada 60ms = ~16 por segundo
// FUB permite 200 cada 10 segundos — dejamos margen de seguridad
const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime:       60,
});

// ─── PROCESADORES ────────────────────────────────────────────────────────────

// Procesa trabajos de tipo "crear-lead"
fubQueue.process('crear-lead', async (job) => {
  console.log(`[Worker] Creando lead: ${job.data.telefono}`);
  const resultado = await limiter.schedule(() => crearLead(job.data));
  console.log(`[Worker] Lead creado en FUB: ID ${resultado.id}`);
  return resultado;
});

// Procesa trabajos de tipo "registrar-llamada"
fubQueue.process('registrar-llamada', async (job) => {
  console.log(`[Worker] Registrando llamada para persona ${job.data.personId}`);
  const resultado = await limiter.schedule(() => registrarLlamada(job.data));
  console.log(`[Worker] Llamada registrada en FUB: ID ${resultado.id}`);
  return resultado;
});

// Procesa trabajos de tipo "actualizar-llamada" (agrega grabación)
fubQueue.process('actualizar-llamada', async (job) => {
  console.log(`[Worker] Actualizando llamada FUB ID ${job.data.callId}`);
  const resultado = await limiter.schedule(() =>
    actualizarLlamada(job.data.callId, job.data)
  );
  console.log(`[Worker] Llamada actualizada con grabación`);
  return resultado;
});

// Procesa trabajos de tipo "agregar-nota"
fubQueue.process('agregar-nota', async (job) => {
  console.log(`[Worker] Agregando nota para persona ${job.data.personId}`);
  const resultado = await limiter.schedule(() => agregarNota(job.data));
  console.log(`[Worker] Nota agregada en FUB`);
  return resultado;
});

// ─── EVENTOS DE LA COLA ───────────────────────────────────────────────────────

fubQueue.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job.id} (${job.name}) falló intento ${job.attemptsMade}:`, err.message);
});

fubQueue.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} (${job.name}) completado OK`);
});

fubQueue.on('error', (err) => {
  console.error('[Worker] Error en la cola:', err.message);
});

console.log('[Worker] Procesador FUB iniciado — esperando trabajos...');
