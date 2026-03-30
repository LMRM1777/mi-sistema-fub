import express from 'express';
import twilio from 'twilio';
import axios from 'axios';
import Bull from 'bull';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const VoiceResponse = twilio.twiml.VoiceResponse;
const sesiones = new Map();

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const smsQueue = new Bull('sms-drip', {
  redis: process.env.REDIS_URL,
});

// Calcular delay hasta una hora especifica del dia siguiente
function delayHastaHora(diasDespues, hora) {
  const ahora = new Date();
  const objetivo = new Date();
  objetivo.setDate(ahora.getDate() + diasDespues);
  objetivo.setHours(hora, 0, 0, 0);
  return objetivo.getTime() - ahora.getTime();
}

const DRIP_MESSAGES = [
  { delay: () => delayHastaHora(1, 12), msg: 'Hola, soy Javier. Pudiste hablar con alguien de mi equipo? Estoy aqui para ayudarte.' },
  { delay: () => delayHastaHora(3, 10), msg: 'Hola de nuevo, tienes alguna pregunta sobre propiedades en Michigan?' },
  { delay: () => delayHastaHora(7, 9),  msg: 'Hola, quiero asegurarme de que recibas la mejor atencion. Cuando es buen momento para hablar?' },
];

smsQueue.process(async (job) => {
  const { to, message } = job.data;
  await twilioClient.messages.create({
    body: message,
    from: process.env.TWILIO_TRACKING_NUMBER,
    to,
  });
  console.log(`SMS drip enviado a ${to}`);
});

app.get('/', (req, res) => {
  res.json({ sistema: 'Mi Sistema FUB', estado: 'activo' });
});

app.post('/webhook/twilio/entrante', async (req, res) => {
  const { From, To, CallSid } = req.body;
  console.log(`Llamada entrante: ${From} → ${To}`);
  sesiones.set(CallSid, { callerPhone: From, trackingNum: To });
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

app.post('/webhook/twilio/estado', async (req, res) => {
  const { CallSid, CallStatus, CallDuration } = req.body;
  const sesion = sesiones.get(CallSid) || {};
  const callerPhone = sesion.callerPhone || '+10000000000';
  console.log(`Llamada: ${CallStatus} ${CallDuration}s - Lead: ${callerPhone}`);
  const fub = axios.create({
    baseURL: 'https://api.followupboss.com/v1',
    auth: { username: process.env.FUB_USER_API_KEY, password: '' },
    headers: { 'Content-Type': 'application/json' },
  });
  try {
    const evento = await fub.post('/events', {
      source: `Llamada - ${sesion.trackingNum || 'Desconocido'}`,
      system: process.env.FUB_SYSTEM_NAME || 'MiSistema',
      type: 'General Inquiry',
      person: { phones: [{ value: callerPhone, type: 'mobile' }] },
    });
    const personId = evento.data.id;
    const dur = parseInt(CallDuration) || 0;
    await fub.post('/calls', {
      personId,
      duration: dur,
      outcome: CallStatus === 'completed' ? 'Interested' : 'No Answer',
      note: `Llamada ${CallStatus} - ${Math.floor(dur/60)}m ${dur%60}s`,
      phone: callerPhone,
      isIncoming: 1,
    });
    console.log(`Registrado en FUB OK - Lead ${personId}`);

    if (callerPhone !== '+10000000000') {
      await twilioClient.messages.create({
        body: 'Hola, soy Javier de Lake Michigan Realty. Gracias por llamar, te contactare pronto.',
        from: process.env.TWILIO_TRACKING_NUMBER,
        to: callerPhone,
      });
      console.log(`SMS inmediato enviado a ${callerPhone}`);

      for (const drip of DRIP_MESSAGES) {
        await smsQueue.add(
          { to: callerPhone, message: drip.msg },
          { delay: drip.delay() }
        );
      }
      console.log(`Drip programado para ${callerPhone}`);
    }

  } catch (err) {
    console.error('Error:', err.message, JSON.stringify(err.response?.data));
  }
  res.sendStatus(200);
});

app.post('/webhook/twilio/grabacion', async (req, res) => {
  const { CallSid, RecordingUrl } = req.body;
  const sesion = sesiones.get(CallSid);
  if (sesion?.fubCallId) {
    try {
      const fub = axios.create({
        baseURL: 'https://api.followupboss.com/v1',
        auth: { username: process.env.FUB_USER_API_KEY, password: '' },
        headers: { 'Content-Type': 'application/json' },
      });
      await fub.put(`/calls/${sesion.fubCallId}`, { recordingUrl: `${RecordingUrl}.mp3` });
    } catch (err) {
      console.error('Error grabacion:', err.message);
    }
  }
  res.sendStatus(200);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor en puerto ${PORT}`);
});
