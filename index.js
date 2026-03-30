// src/index.js
// Punto de entrada principal — arranca el servidor Express
// Railway ejecuta este archivo con "npm start"

import 'dotenv/config';
import express from 'express';
import twilioRoutes from './routes/twilio.routes.js';
import apiRoutes    from './routes/api.routes.js';

const app  = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // necesario para webhooks de Twilio

// Rutas
app.use('/webhook/twilio', twilioRoutes);  // Twilio llama aquí
app.use('/api',            apiRoutes);     // Tu app llama aquí

// Ruta raíz — para verificar que el servidor está vivo
app.get('/', (req, res) => {
  res.json({
    sistema: 'Mi Sistema FUB',
    estado:  'activo',
    hora:    new Date().toISOString(),
    rutas: {
      salud:           'GET  /api/salud',
      llamarLead:      'POST /api/llamar',
      crearLead:       'POST /api/lead',
      agregarNota:     'POST /api/nota',
      webhookEntrante: 'POST /webhook/twilio/entrante',
      webhookEstado:   'POST /webhook/twilio/estado',
      webhookGrabacion:'POST /webhook/twilio/grabacion',
    },
  });
});

app.listen(PORT, () => {
  console.log(`\n=============================================`);
  console.log(` Mi Sistema FUB corriendo en puerto ${PORT}`);
  console.log(` URL pública: ${process.env.BASE_URL || 'no configurada'}`);
  console.log(`=============================================\n`);
});
