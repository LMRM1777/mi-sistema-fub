import 'dotenv/config';
import express from 'express';
import { Router } from 'express';
import twilio from 'twilio';
import axios from 'axios';

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.json({
    sistema: 'Mi Sistema FUB',
    estado:  'activo',
    hora:    new Date().toISOString(),
  });
});

app.get('/api/salud', (req, res) => {
  res.json({ ok: true, hora: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
  console.log(`URL: ${process.env.BASE_URL || 'local'}`);
});
