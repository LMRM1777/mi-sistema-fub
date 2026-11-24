import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (f) => JSON.parse(readFileSync(path.join(root, 'config', f), 'utf8'));

export function loadConfig() {
  const campaigns = readJson('campaigns.json').campaigns;
  const numbers = readJson('numbers.json');
  const rules = readJson('rules.json');
  validateCampaigns(campaigns);
  return { campaigns, numbers, rules };
}

export function validateCampaigns(campaigns) {
  const ids = new Set();
  for (const c of campaigns) {
    if (!c.id || !c.trigger_tag || !Array.isArray(c.steps) || !c.steps.length) {
      throw new Error(`Campaña inválida: ${JSON.stringify(c).slice(0, 80)}`);
    }
    if (ids.has(c.id)) throw new Error(`Campaña repetida: ${c.id}`);
    ids.add(c.id);
    c.steps.forEach((s, i) => {
      const where = `Paso ${i + 1} de ${c.id}`;
      if (s.after) {
        if (typeof s.after.n !== 'number' || !s.after.unit) throw new Error(`${where}: 'after' necesita n y unit`);
        if (s.at && !/^\d{1,2}:\d{2}$/.test(s.at)) throw new Error(`${where}: 'at' debe ser HH:MM`);
      } else if (typeof s.day !== 'number' || !(s.time === 'now' || /^\d{2}:\d{2}$/.test(s.time))) {
        throw new Error(`${where}: usa 'after' {n, unit} o 'day' + 'time' (HH:MM o 'now')`);
      }
      const texts = s.text ? [['text', s.text]] : [['es', s.es], ['en', s.en]];
      if (texts.some(([, t]) => !t)) throw new Error(`${where}: falta texto (text, o es y en)`);
      const sms = !s.type || ['texto', 'imagen', 'vcard'].includes(s.type);
      // Solo las campañas activas tienen que cumplir las reglas del carrier.
      if (sms && c.active !== false) {
        for (const [lang, t] of texts) {
          if (!/STOP/i.test(t)) throw new Error(`${where} (${lang}): debe decir STOP`);
          if (!/Lake Michigan Realty/.test(t)) throw new Error(`${where} (${lang}): debe nombrar la marca`);
        }
      }
    });
  }
}

export const env = {
  port: process.env.PORT || 8080,
  baseUrl: (process.env.BASE_URL || '').replace(/\/$/, ''),
  twilioSid: process.env.TWILIO_ACCOUNT_SID,
  twilioToken: process.env.TWILIO_AUTH_TOKEN,
  messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
  fubApiKey: process.env.FUB_USER_API_KEY,
  fubSystem: process.env.FUB_SYSTEM_NAME || 'Lake-Michigan-Realty',
  fubSystemKey: process.env.FUB_SYSTEM_KEY,
  redisUrl: process.env.REDIS_URL,
  slackWebhook: process.env.SLACK_WEBHOOK_URL,
  adminKey: process.env.ADMIN_API_KEY,
  agentName: process.env.DEFAULT_AGENT_NAME || 'Javier',
  // Interruptor general: mientras sea distinto de "true" NO sale ningún texto (solo se registra en el log).
  sendingEnabled: process.env.SMS_SENDING_ENABLED === 'true',
  verifySignatures: process.env.VERIFY_SIGNATURES !== 'false',
};
