import express from 'express';
import twilio from 'twilio';
import axios from 'axios';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const VoiceResponse = twilio.twiml.VoiceResponse;
const sesiones = new Map();

// Salud del servidor
app.get('/', (req, res) => {
  res.json({ sistema: 'Mi Sistema FUB', estado: 'activo' });
});

// Twilio llama aquí cuando entra una llamada
app.post('/webhook/twilio/entrante', async (req, res) => {
  const { From, To, CallSid } = req.body;
  console.log(`Llamada entrante: ${From} → ${To}`);

  sesiones.set(CallSid, {
    callerPhone: From,
    trackingNum: To,
    startTime: new Date(),
  });

  const twiml = new VoiceResponse();
  twiml.say({ language: 'es-MX' }, 'Un momento por favor.');
  const dial = twiml.dial({
    record: 'record-from-ringing',
    recordingStatusCallback: `${process.env.BASE_URL}/webhook/twilio/grabacion`,
    action: `${process.env.BASE_URL}/webhook/twilio/estado`,
    timeout: 20,
  });
  dial.number(process.env.AGENT_PHONE_NUMBER);

  res.type('text/xml').send(twiml.toString());
});

// Twilio llama aquí cuando termina la llamada
app.post('/webhook/twilio/estado', async (req, res) => {
  const { CallSid, CallStatus, CallDuration, From } = req.body;
  console.log(`Llamada terminó: ${CallStatus} - ${CallDuration}s`);

  const sesion = sesiones.get(CallSid) || {};
  const fub = axios.create({
    baseURL: 'https://api.followupboss.com/v1',
    auth: { username: process.env.FUB_USER_API_KEY, password: '' },
    headers: { 'Content-Type': 'application/json' },
  });

  try {
    // Crear lead en FUB
    const evento = await fub.post('/events', {
      source: `Llamada - ${sesion.trackingNum || To}`,
      system: process.env.FUB_SYSTEM_NAME || 'MiSistema',
      type: 'General Inquiry',
      person: { phones: [{ value: From || sesion.callerPhone, type: 'mobile' }] },
    });

    const personId = evento.data.id;
    const mins = Math.floor((parseInt(CallDuration) || 0) / 60);
    const secs = (parseInt(CallDuration) || 0) % 60;

    // Registrar la llamada en FUB
    const llamada = await fub.post('/calls', {
      personId,
      duration: parseInt(CallDuration) || 0,
      outcome: CallStatus === 'completed' ? 'Connected' : 'No Answer',
      note: `Llamada ${CallStatus === 'completed' ? 'conectada' : 'sin respuesta'}\nDuración: ${mins}m ${secs}s\nNúmero: ${sesion.trackingNum}`,
      createdAt: (sesion.startTime || new Date()).toISOString(),
    });

    sesiones.set(CallSid, { ...sesion, fubCallId: llamada.data.id });
    console.log(`Llamada registrada en FUB: ID ${llamada.data.id}`);
  } catch (err) {
    console.error('Error registrando en FUB:', err.message);
  }

  res.sendStatus(200);
});

// Twilio llama aquí cuando la grabación está lista
app.post('/webhook/twilio/grabacion', async (req, res) => {
  const { CallSid, RecordingUrl } = req.body;
  console.log(`Grabación lista: ${RecordingUrl}`);

  const sesion = sesiones.get(CallSid);
  if (sesion?.fubCallId) {
    try {
      const fub = axios.create({
        baseURL: 'https://api.followupboss.com/v1',
        auth: { username: process.env.FUB_USER_API_KEY, password: '' },
        headers: { 'Content-Type': 'application/json' },
      });
      await fub.put(`/calls/${sesion.fubCallId}`, {
        recordingUrl: `${RecordingUrl}.mp3`,
      });
      console.log('Grabación agregada a FUB');
    } catch (err) {
      console.error('Error agregando grabación:', err.message);
    }
  }

  res.sendStatus(200);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor en puerto ${PORT}`);
});
