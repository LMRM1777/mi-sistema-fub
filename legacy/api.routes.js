// src/routes/api.routes.js
// Endpoints que TÚ llamas desde tu frontend o herramienta de gestión
// Por ejemplo: "marcar este lead para llamar ahora"

import { Router } from 'express';
import { iniciarLlamadaSaliente } from '../services/llamada.service.js';
import { encolarLead, encolarNota } from '../services/queue.js';

const router = Router();

// POST /api/llamar
// Inicia una llamada saliente hacia un lead
// Body: { leadPhone, fubPersonId }
router.post('/llamar', async (req, res) => {
  try {
    const { leadPhone, fubPersonId } = req.body;

    if (!leadPhone) {
      return res.status(400).json({ error: 'leadPhone es requerido' });
    }

    const callSid = await iniciarLlamadaSaliente({
      leadPhone,
      fubPersonId,
    });

    res.json({ ok: true, callSid });

  } catch (err) {
    console.error('[API] Error iniciando llamada:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/lead
// Crea un lead manualmente en FUB
// Body: { nombre, apellido, telefono, email, fuente }
router.post('/lead', async (req, res) => {
  try {
    await encolarLead(req.body);
    res.json({ ok: true, mensaje: 'Lead encolado para crear en FUB' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/nota
// Agrega una nota a un lead en FUB
// Body: { personId, texto }
router.post('/nota', async (req, res) => {
  try {
    await encolarNota(req.body);
    res.json({ ok: true, mensaje: 'Nota encolada para FUB' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/salud
// Verifica que el servidor está funcionando
router.get('/salud', (req, res) => {
  res.json({
    ok:      true,
    hora:    new Date().toISOString(),
    version: '1.0.0',
  });
});

export default router;
