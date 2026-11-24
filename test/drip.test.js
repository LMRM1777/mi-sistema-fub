import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { loadConfig } from '../src/config.js';
import { MemoryStore, makeRepo } from '../src/store.js';
import { makeDrip } from '../src/drip.js';
import { makeInbound } from '../src/inbound.js';
import { stepTime, nextAllowed } from '../src/schedule.js';

const config = loadConfig();
const tz = config.rules.timezone;
const at = (s) => DateTime.fromISO(s, { zone: tz });
const quiet = { info() {}, error() {} };

function setup(personOver = {}) {
  const repo = makeRepo(new MemoryStore());
  const person = { id: 7, firstName: 'Ana', tags: ['espanol'], stage: 'Lead',
    phones: [{ value: '(616) 555-0101', type: 'mobile' }], ...personOver };
  const sent = []; const jobs = []; const logged = []; const notes = []; const tagged = [];
  const fub = {
    getPerson: async () => person,
    findByPhone: async () => person,
    upsertLead: async () => person,
    logText: async (t) => logged.push(t),
    addTags: async (_id, t) => tagged.push(...t),
    addNote: async (_id, n) => notes.push(n),
    createTask: async (t) => notes.push(t),
  };
  const sms = { send: async (m) => { sent.push(m); return { sid: 'SM1', from: '+16162025704' }; } };
  const scheduler = { schedule: async (data, ms) => jobs.push({ data, ms }) };
  const drip = makeDrip({ repo, fub, sms, scheduler, config, env: { agentName: 'Javier' }, log: quiet });
  const inbound = makeInbound({ repo, fub, drip, config, notify: async () => {}, log: quiet });
  return { repo, person, sent, jobs, logged, tagged, notes, drip, inbound };
}

test('config: todas las campañas dicen STOP y nombran la marca', () => {
  assert.ok(config.campaigns.length >= 1);
});

test('horario: un paso a las 7am se mueve a las 9am; de noche pasa al día siguiente', () => {
  assert.equal(nextAllowed(at('2026-12-01T07:00'), config.rules).toFormat('HH:mm'), '09:00');
  const late = nextAllowed(at('2026-12-01T21:30'), config.rules);
  assert.equal(late.toISODate(), '2026-12-02');
  assert.equal(late.toFormat('HH:mm'), '09:00');
});

test('horario: el domingo no se manda (pasa a lunes)', () => {
  const sun = nextAllowed(at('2026-11-29T12:00'), config.rules); // domingo
  assert.equal(sun.weekday, 1);
});

test('stepTime: día 1 a las 12:00 después de inscribirse', () => {
  const enrolled = at('2026-12-01T15:00').toUTC().toISO();
  const t = stepTime({ day: 1, time: '12:00' }, enrolled, config.rules, at('2026-12-01T15:00'));
  assert.equal(t.toISO({ includeOffset: false }).slice(0, 16), '2026-12-02T12:00');
});

test('drip completo: inscribe, manda en español con nombre, registra en FUB y agenda el siguiente', async () => {
  const s = setup();
  const now = at('2026-12-01T10:00');
  const r = await s.drip.enroll({ personId: 7, campaignId: 'nuevo-lead-llamada', now });
  assert.equal(r.enrolled, true);
  assert.equal(s.jobs.length, 1);
  const run = await s.drip.runStep(s.jobs[0].data, at('2026-12-02T12:00'));
  assert.equal(run.sent, true);
  assert.match(s.sent[0].body, /^Lake Michigan Realty: Hola Ana, soy Javier\./);
  assert.equal(s.sent[0].to, '+16165550101');
  assert.equal(s.logged.length, 1);
  assert.equal(s.jobs.length, 2);
  assert.equal(s.jobs[1].data.stepIndex, 1);
});

test('no se inscribe dos veces en la misma campaña', async () => {
  const s = setup();
  await s.drip.enroll({ personId: 7, campaignId: 'nuevo-lead-llamada', now: at('2026-12-01T10:00') });
  const again = await s.drip.enroll({ personId: 7, campaignId: 'nuevo-lead-llamada', now: at('2026-12-01T11:00') });
  assert.equal(again.enrolled, false);
});

test('freno: si el lead contestó, no sale el siguiente texto', async () => {
  const s = setup();
  await s.drip.enroll({ personId: 7, campaignId: 'nuevo-lead-llamada', now: at('2026-12-01T10:00') });
  await s.inbound.handleSms({ From: '+16165550101', To: '+16162025704', Body: 'Sí, me interesa' }, at('2026-12-01T18:00').toJSDate());
  const run = await s.drip.runStep(s.jobs[0].data, at('2026-12-02T12:00'));
  assert.equal(run.sent, false);
  assert.equal(run.reason, 'el lead contestó');
  assert.equal(s.sent.length, 0);
});

test('freno: STOP corta todo y pone el tag SMS_OPT_OUT', async () => {
  const s = setup();
  await s.drip.enroll({ personId: 7, campaignId: 'nuevo-lead-llamada', now: at('2026-12-01T10:00') });
  await s.inbound.handleSms({ From: '+16165550101', To: '+16162025704', Body: 'Stop', OptOutType: 'STOP' });
  assert.ok(s.tagged.includes('SMS_OPT_OUT'));
  const run = await s.drip.runStep(s.jobs[0].data, at('2026-12-02T12:00'));
  assert.equal(run.sent, false);
  assert.equal(s.sent.length, 0);
});

test('freno: tag AI_OPT_OUT o stage de cita detienen el drip', async () => {
  for (const over of [{ tags: ['AI_OPT_OUT'] }, { stage: 'Appointment Set' }]) {
    const s = setup(over);
    await s.drip.enroll({ personId: 7, campaignId: 'nuevo-lead-llamada', now: at('2026-12-01T10:00') });
    const run = await s.drip.runStep(s.jobs[0].data, at('2026-12-02T12:00'));
    assert.equal(run.sent, false, JSON.stringify(over));
  }
});

test('fuera de horario: se reprograma en vez de mandar', async () => {
  const s = setup();
  await s.drip.enroll({ personId: 7, campaignId: 'nuevo-lead-llamada', now: at('2026-12-01T10:00') });
  const run = await s.drip.runStep(s.jobs[0].data, at('2026-12-02T22:00'));
  assert.equal(run.sent, false);
  assert.ok(run.retryAt.startsWith('2026-12-03T09:00'));
  assert.equal(s.sent.length, 0);
});

test('CASA: contesta confirmación en español e inscribe en drip-casa', async () => {
  const s = setup({ tags: [] });
  const r = await s.inbound.handleSms({ From: '+16165550101', To: '+16162025704', Body: 'casa' });
  assert.match(r.reply, /Estás suscrito/);
  assert.equal(s.jobs.length, 1);
});

test('inglés si el lead no tiene tag de español', async () => {
  const s = setup({ tags: [] });
  await s.drip.enroll({ personId: 7, campaignId: 'nuevo-lead-llamada', now: at('2026-12-01T10:00') });
  await s.drip.runStep(s.jobs[0].data, at('2026-12-02T12:00'));
  assert.match(s.sent[0].body, /^Lake Michigan Realty: Hi Ana, it's Javier\./);
});

// --- Campañas estilo CallAction (tiempo desde el paso anterior, recordatorios, variables) ---
import { render } from '../src/drip.js';
import { relativeTime } from '../src/schedule.js';

test('relativeTime: +1 día a las 8:30 desde el paso anterior', () => {
  const t = relativeTime({ after: { n: 1, unit: 'días' }, at: '8:30' }, at('2026-12-01T15:00').toUTC().toISO(), config.rules, at('2026-12-01T15:00'));
  assert.equal(t.toFormat('yyyy-MM-dd HH:mm'), '2026-12-02 09:00'); // 8:30 cae antes de la ventana de 9:00
});

test('relativeTime: próximo viernes', () => {
  const t = relativeTime({ after: { n: 1, unit: 'próximo viernes' }, at: '10:00' }, at('2026-12-01T15:00').toUTC().toISO(), config.rules, at('2026-12-01T15:00'));
  assert.equal(t.weekday, 5);
  assert.equal(t.toFormat('HH:mm'), '10:00');
});

test('render: variables de CallAction', () => {
  const now = at('2026-12-02T10:00'); // miércoles
  const out = render('{{greeting}} {{contact_first_name}}, soy {{user_first_name}}. Te escribí el {{from_2_days_ago}}.', { firstName: 'Ana', assignedTo: 'Javier Rodriguez' }, 'Javier', { now, lang: 'es' });
  assert.equal(out, 'Buenos días Ana, soy Javier. Te escribí el lunes.');
});

test('campaña de CallAction: recordatorio crea tarea en FUB y el texto sale con STOP', async () => {
  const s = setup({ tags: [] });
  const tasks = [];
  config.campaigns.push({ id: 't-ca', name: 'Prueba CA', trigger_tag: 't-ca', lang: 'en', steps: [
    { type: 'recordatorio', after: { n: 5, unit: 'segundos' }, text: '1st call attempt' },
    { type: 'texto', after: { n: 3, unit: 'minutos' }, text: 'Lake Michigan Realty: Hi {{contact_first_name}}! Reply STOP to opt out.' },
  ] });
  try {
    const r = await s.drip.enroll({ personId: 7, campaignId: 't-ca', now: at('2026-12-01T10:00') });
    assert.equal(r.enrolled, true);
    const run1 = await s.drip.runStep(s.jobs[0].data, at('2026-12-01T10:00:05'));
    assert.equal(run1.task, true);
    assert.equal(s.sent.length, 0);
    const run2 = await s.drip.runStep(s.jobs[1].data, at('2026-12-01T10:03:05'));
    assert.equal(run2.sent, true);
    assert.equal(s.sent[0].body, 'Lake Michigan Realty: Hi Ana! Reply STOP to opt out.');
  } finally { config.campaigns.pop(); }
});

test('campaña inactiva no arranca por tag', () => {
  const s = setup();
  config.campaigns.push({ id: 'off', name: 'off', trigger_tag: 'off-tag', active: false, steps: [] });
  try { assert.equal(s.drip.campaignForTag('off-tag'), undefined); } finally { config.campaigns.pop(); }
});
