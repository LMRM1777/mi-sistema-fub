import express from 'express';
import twilio from 'twilio';
import Bull from 'bull';
import Redis from 'ioredis';
import crypto from 'node:crypto';
import { env, loadConfig } from './config.js';
import { RedisStore, makeRepo } from './store.js';
import { makeFub, makeSlack, normalizePhone } from './fub.js';
import { makeDrip } from './drip.js';
import { makeInbound } from './inbound.js';

const config = loadConfig();
const redis = new Redis(env.redisUrl, { maxRetriesPerRequest: null });
const repo = makeRepo(new RedisStore(redis));
const fub = makeFub({ apiKey: env.fubApiKey, system: env.fubSystem, systemKey: env.fubSystemKey });
const notify = makeSlack(env.slackWebhook);
const tw = twilio(env.twilioSid, env.twilioToken);

// Interruptor: si SMS_SENDING_ENABLED != true, el texto solo se escribe en el log.
const sms = {
  async send({ to, body }) {
    if (!env.sendingEnabled) {
      console.log(`[DRY-RUN] a ${to}: ${body}`);
      return { sid: null, from: null, dryRun: true };
    }
    const m = await tw.messages.create({ messagingServiceSid: env.messagingServiceSid, to, body });
    return { sid: m.sid, from: m.from, dryRun: false };
  },
};

const queue = new Bull('drip-v2', env.redisUrl);
const scheduler = {
  schedule: (data, runAtMs) => queue.add(data, {
    delay: Math.max(0, runAtMs - Date.now()), attempts: 3, backoff: 60000, removeOnComplete: 500,
  }),
};
const drip = makeDrip({ repo, fub, sms, scheduler, config, env, notify });
const inbound = makeInbound({ repo, fub, drip, config, notify });
queue.process(async (job) => {
  const r = await drip.runStep(job.data);
  console.log('[queue]', job.data, r.sent ? 'enviado' : r.reason);
  return r;
});

const app = express();
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false }));

const twilioGuard = (req, res, next) => {
  if (!env.verifySignatures) return next();
  const ok = twilio.validateRequest(env.twilioToken, req.get('X-Twilio-Signature') || '', env.baseUrl + req.originalUrl, req.body);
  return ok ? next() : res.status(403).send('firma inválida');
};

// FUB firma el webhook: HMAC-SHA256 (hex) del cuerpo en base64, con la X-System-Key.
const fubGuard = (req, res, next) => {
  if (!env.verifySignatures) return next();
  const expected = crypto.createHmac('sha256', env.fubSystemKey || '')
    .update(Buffer.from(req.rawBody || '').toString('base64')).digest('hex');
  const got = req.get('FUB-Signature') || '';
  if (got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) return next();
  console.warn('[fub] firma inválida');
  return res.status(403).send('firma inválida');
};

const adminGuard = (req, res, next) =>
  env.adminKey && req.get('x-api-key') === env.adminKey ? next() : res.status(401).send('no autorizado');

app.get('/health', (_req, res) => res.json({
  ok: true, envio_real: env.sendingEnabled, campañas: config.campaigns.map((c) => c.id),
}));

// FUB → nos avisa cuando se agrega un tag. Si el tag es de una campaña, inscribimos al lead.
app.post('/webhook/fub', fubGuard, async (req, res) => {
  res.sendStatus(200);
  const { event, resourceIds = [] } = req.body || {};
  if (event !== 'peopleTagsCreated') return;
  for (const id of resourceIds) {
    try {
      const person = await fub.getPerson(id);
      for (const tag of person.tags || []) {
        const c = drip.campaignForTag(tag);
        if (c) console.log('[fub]', id, tag, await drip.enroll({ personId: id, campaignId: c.id }));
      }
    } catch (e) { console.error('[fub] webhook', id, e.message); }
  }
});

app.post('/webhook/twilio/sms', twilioGuard, async (req, res) => {
  const twiml = new twilio.twiml.MessagingResponse();
  try {
    const { reply } = await inbound.handleSms(req.body);
    if (reply) twiml.message(reply);
  } catch (e) { console.error('[sms]', e.message); }
  res.type('text/xml').send(twiml.toString());
});

app.post('/webhook/twilio/voz', twilioGuard, (req, res) => {
  const cfg = config.numbers.numbers[req.body.To] || {};
  const twiml = new twilio.twiml.VoiceResponse();
  const dial = twiml.dial({
    timeout: 20, record: 'record-from-answer',
    action: `${env.baseUrl}/webhook/twilio/voz-fin`,
  });
  dial.number(cfg.forward_to || config.numbers.default_forward_to);
  res.type('text/xml').send(twiml.toString());
});

app.post('/webhook/twilio/voz-fin', twilioGuard, async (req, res) => {
  res.type('text/xml').send(new twilio.twiml.VoiceResponse().toString());
  const { From, To, DialCallStatus, DialCallDuration, RecordingUrl } = req.body;
  const phone = normalizePhone(From);
  if (!phone) return;
  const cfg = config.numbers.numbers[To] || {};
  try {
    const person = await fub.upsertLead({ phone, source: cfg.source || `Llamada - ${To}`, tags: cfg.call_tag ? [cfg.call_tag] : [] });
    const dur = Number(DialCallDuration) || 0;
    await fub.logCall({
      personId: person.id, phone, isIncoming: true, duration: dur,
      outcome: DialCallStatus === 'completed' ? 'Interested' : 'No Answer',
      note: `Llamada a ${cfg.source || To}: ${DialCallStatus} (${dur}s)${RecordingUrl ? `\nGrabación: ${RecordingUrl}.mp3` : ''}`,
    });
    if (DialCallStatus !== 'completed') await notify(`📞 Llamada perdida de ${phone} (${cfg.source || To}). Devolver la llamada.`);
  } catch (e) { console.error('[voz-fin]', e.message); }
});

app.post('/api/enroll', adminGuard, async (req, res) => {
  try { res.json(await drip.enroll(req.body)); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/stop', adminGuard, async (req, res) => {
  res.json({ detenidas: await repo.stopAllFor({ personId: req.body.personId, phone: normalizePhone(req.body.phone) }, 'detenido a mano') });
});

app.listen(env.port, '0.0.0.0', () => {
  console.log(`v2 en puerto ${env.port} — envío real: ${env.sendingEnabled ? 'SÍ' : 'NO (dry-run)'}`);
});
