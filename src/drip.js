import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { stepTime, relativeTime, isWithinWindow, nextAllowed } from './schedule.js';
import { pickMobile } from './fub.js';

const lower = (a) => (a || []).map((x) => String(x).toLowerCase());

export function languageFor(person, rules, fallback = 'en') {
  const tags = lower(person.tags);
  return lower(rules.spanish_tags).some((t) => tags.includes(t)) ? 'es' : fallback;
}

// Tipos de paso: los que le llegan al lead por texto, y los que son tarea para el agente.
export const SMS_TYPES = ['texto', 'imagen', 'vcard'];
export const isSmsStep = (step) => !step.type || SMS_TYPES.includes(step.type);

const DAYS = { es: ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'], en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] };

// Reemplaza {first_name}/{agent_name} (v2) y las variables de CallAction ({{contact_first_name}}, {{greeting}}…).
export function render(text, person, defaultAgent, { now = DateTime.now(), lang = 'en', company = 'Lake Michigan Realty', website = 'https://www.homesearchmi.com', tz = 'America/Detroit' } = {}) {
  const t = now.setZone(tz);
  const first = (person.firstName || '').trim();
  const agentFull = person.assignedTo || defaultAgent;
  const agent = agentFull.split(' ')[0];
  const day = (d) => DAYS[lang][d.weekday - 1];
  const greet = lang === 'es' ? (t.hour < 12 ? 'Buenos días' : t.hour < 18 ? 'Buenas tardes' : 'Buenas noches') : (t.hour < 12 ? 'Good morning' : t.hour < 18 ? 'Good afternoon' : 'Good evening');
  const firstContact = person.created ? DateTime.fromISO(person.created).setZone(tz) : null;
  const vars = {
    contact_first_name: first, contact_last_name: person.lastName || '', contact_full_name: [first, person.lastName].filter(Boolean).join(' '),
    user_first_name: agent, user_full_name: agentFull, user_company: company, user_website: website, user_email: person.assignedUserEmail || '',
    lead_email_address: person.emails?.[0]?.value || '', greeting: greet, today_day: day(t), time_now: t.toFormat('h:mm a'),
    lead_first_contact_month: firstContact ? firstContact.setLocale(lang).toFormat('LLLL') : '',
    lead_first_contact_date: firstContact ? firstContact.toFormat('LL/dd') : '',
    last_msg_time: t.minus({ hours: 1 }).toFormat('h:mm a'),
  };
  let out = text
    .replace(/\{\{\s*from_(\d+)_days?_ago\s*\}\}/g, (_, n) => day(t.minus({ days: +n })))
    .replace(/\{\{\s*in_(\d+)_days?\s*\}\}/g, (_, n) => day(t.plus({ days: +n })))
    .replace(/\{\{\s*contact_in_(\d+)min\s*\}\}/g, (_, n) => t.plus({ minutes: +n }).toFormat('h:mm a'))
    .replace(/\{\{\s*(\w+)\s*\}\}\}?/g, (m, k) => (k in vars ? vars[k] : ''));
  out = out
    .replace(/\s*\{first_name\}/g, first ? ` ${first}` : '')
    .replace(/\{agent_name\}/g, agent);
  return out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
}

// Revisa todo antes de mandar. Devuelve { ok } o { ok:false, reason } o { ok:false, retryAt }.
export async function checkGuards({ enrollment, campaign, person, repo, rules, now }) {
  if (enrollment.status !== 'active') return { ok: false, reason: `inscripción ${enrollment.status}` };
  if (!campaign) return { ok: false, reason: 'la campaña ya no existe en campaigns.json' };
  if (!person) return { ok: false, reason: 'lead no encontrado en FUB' };
  const phone = pickMobile(person);
  if (!phone) return { ok: false, reason: 'lead sin celular válido' };
  if (phone !== enrollment.phone) enrollment.phone = phone;
  if (await repo.isOptedOut(phone)) return { ok: false, reason: 'pidió STOP' };
  const stopTags = lower(rules.stop_tags);
  const hit = lower(person.tags).find((t) => stopTags.includes(t));
  if (hit) return { ok: false, reason: `tag de bloqueo: ${hit}` };
  if (lower(rules.stop_stages).includes(String(person.stage || '').toLowerCase())) {
    return { ok: false, reason: `stage: ${person.stage}` };
  }
  if (campaign.stop_on_reply !== false) {
    const last = await repo.lastInbound(phone);
    if (last && last > enrollment.enrolledAt) return { ok: false, reason: 'el lead contestó' };
  }
  if (!isWithinWindow(now, rules)) return { ok: false, retryAt: nextAllowed(now, rules) };
  return { ok: true, phone };
}

export function makeDrip({ repo, fub, sms, scheduler, config, env, notify = async () => {}, log = console }) {
  const findCampaign = (id) => config.campaigns.find((c) => c.id === id);

  async function scheduleStep(enrollment, stepIndex, now = DateTime.now()) {
    const campaign = findCampaign(enrollment.campaignId);
    const step = campaign?.steps[stepIndex];
    if (!step) {
      enrollment.status = 'completed';
      await repo.saveEnrollment(enrollment);
      return null;
    }
    const runAt = step.after
      ? relativeTime(step, enrollment.lastStepAt || enrollment.enrolledAt, config.rules, now)
      : stepTime(step, enrollment.enrolledAt, config.rules, now);
    enrollment.nextStep = stepIndex;
    enrollment.nextAt = runAt.toISO();
    await repo.saveEnrollment(enrollment);
    await scheduler.schedule({ enrollmentId: enrollment.id, stepIndex }, runAt.toMillis());
    return runAt;
  }

  async function enroll({ personId, campaignId, now = DateTime.now() }) {
    const campaign = findCampaign(campaignId);
    if (!campaign) throw new Error(`No existe la campaña ${campaignId}`);
    const person = await fub.getPerson(personId);
    const phone = pickMobile(person);
    if (!phone) return { enrolled: false, reason: 'lead sin celular válido' };
    const existing = await repo.enrollmentsFor({ personId, phone });
    // No repetir: si ya está activo, o entró a esta misma campaña en los últimos 30 días.
    const recent = now.minus({ days: 30 }).toUTC().toISO();
    if (existing.some((e) => e.campaignId === campaignId && (e.status === 'active' || e.enrolledAt > recent))) {
      return { enrolled: false, reason: 'ya está (o estuvo hace poco) en esta campaña' };
    }
    const enrollment = {
      id: randomUUID(), personId, phone, campaignId, status: 'active',
      enrolledAt: now.toUTC().toISO(), sent: [],
    };
    const runAt = await scheduleStep(enrollment, 0, now);
    log.info?.(`[drip] ${personId} → ${campaignId}, primer texto ${runAt?.toISO()}`);
    return { enrolled: true, enrollment };
  }

  // Lo llama la cola cuando llega la hora de un paso.
  async function runStep({ enrollmentId, stepIndex }, now = DateTime.now()) {
    const enrollment = await repo.getEnrollment(enrollmentId);
    if (!enrollment) return { sent: false, reason: 'inscripción no existe' };
    if (enrollment.nextStep !== stepIndex) return { sent: false, reason: 'paso viejo, ignorado' };
    const campaign = findCampaign(enrollment.campaignId);
    let person = null;
    try { person = await fub.getPerson(enrollment.personId); } catch (e) { log.error?.('[drip] FUB', e.message); }

    const g = await checkGuards({ enrollment, campaign, person, repo, rules: config.rules, now });
    if (g.retryAt) {
      enrollment.nextAt = g.retryAt.toISO();
      await repo.saveEnrollment(enrollment);
      await scheduler.schedule({ enrollmentId, stepIndex }, g.retryAt.toMillis());
      return { sent: false, reason: 'fuera de horario, reprogramado', retryAt: g.retryAt.toISO() };
    }
    if (!g.ok) {
      if (enrollment.status === 'active') { enrollment.status = 'stopped'; enrollment.stopReason = g.reason; }
      await repo.saveEnrollment(enrollment);
      log.info?.(`[drip] detenido ${enrollmentId}: ${g.reason}`);
      return { sent: false, reason: g.reason };
    }

    const step = campaign.steps[stepIndex];
    const lang = campaign.lang || languageFor(person, config.rules);
    const raw = step.text || step[lang] || step.es || step.en;
    const body = render(raw, person, env.agentName, { now, lang, tz: config.rules.timezone });
    enrollment.lastStepAt = now.toUTC().toISO();

    if (!isSmsStep(step)) {
      // Recordatorio / voz / video / audio → tarea para el agente en FUB, no texto al lead.
      try { await fub.createTask({ personId: enrollment.personId, name: `[${campaign.name}] ${body}`.slice(0, 250), dueDate: now.toISODate() }); }
      catch (e) { log.error?.('[drip] no se creó la tarea en FUB', e.message); }
      enrollment.sent.push({ step: stepIndex, at: enrollment.lastStepAt, task: true });
      await repo.saveEnrollment(enrollment);
      await scheduleStep(enrollment, stepIndex + 1, now);
      return { sent: false, task: true, body };
    }

    const result = await sms.send({ to: g.phone, body });
    enrollment.sent.push({ step: stepIndex, at: enrollment.lastStepAt, sid: result.sid, dryRun: result.dryRun });
    await repo.saveEnrollment(enrollment);
    try {
      await fub.logText({ personId: enrollment.personId, message: body, toNumber: g.phone, fromNumber: result.from, isIncoming: false });
    } catch (e) { log.error?.('[drip] no se registró en FUB', e.message); }
    await scheduleStep(enrollment, stepIndex + 1, now);
    return { sent: true, body, dryRun: result.dryRun };
  }

  return { enroll, runStep, findCampaign, campaignForTag: (tag) =>
    config.campaigns.find((c) => c.active !== false && c.trigger_tag.toLowerCase() === String(tag).toLowerCase()) };
}
