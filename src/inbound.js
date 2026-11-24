import { normalizePhone } from './fub.js';

// Texto que entra a uno de nuestros números. Devuelve { reply } (texto a contestar o null).
export function makeInbound({ repo, fub, drip, config, notify, log = console }) {
  const { rules, numbers } = config;
  const sourceFor = (to) => numbers.numbers[to]?.source || `Texto - ${to}`;

  async function personFor(phone, to, extra = {}) {
    let person = await fub.findByPhone(phone).catch(() => null);
    if (!person) person = await fub.upsertLead({ phone, source: sourceFor(to), ...extra });
    return person;
  }

  async function handleSms({ From, To, Body = '', OptOutType }, now = new Date()) {
    const phone = normalizePhone(From);
    if (!phone) return { reply: null };
    const word = Body.trim().toUpperCase().replace(/[^A-ZÑ]/g, '');

    // STOP: Twilio ya contesta la confirmación (Advanced Opt-Out). Nosotros cortamos todo.
    if (OptOutType === 'STOP' || rules.opt_out_words.includes(word)) {
      await repo.setOptOut(phone);
      const n = await repo.stopAllFor({ phone }, 'pidió STOP');
      const person = await fub.findByPhone(phone).catch(() => null);
      if (person) {
        await fub.addTags(person.id, ['SMS_OPT_OUT']).catch((e) => log.error?.('[inbound] tag', e.message));
        await fub.addNote(person.id, `Pidió STOP por texto al ${To}. Se detuvieron ${n} campaña(s).`).catch(() => {});
      }
      await notify(`🛑 ${phone} pidió STOP (${sourceFor(To)}). Campañas detenidas: ${n}.`);
      return { reply: null };
    }
    if (OptOutType === 'START' || rules.opt_in_words.includes(word)) {
      await repo.clearOptOut(phone);
      return { reply: null };
    }
    if (OptOutType === 'HELP') return { reply: null };

    // Palabra clave (CASA / HOME): crea el lead, confirma y arranca la campaña.
    const kw = rules.keywords[word];
    if (kw) {
      const person = await personFor(phone, To, {
        type: 'General Inquiry', message: `Escribió ${word} al ${To}`,
        tags: [kw.lang === 'es' ? 'espanol' : 'english', `keyword-${word.toLowerCase()}`],
      });
      if (kw.campaign_tag && person?.id) {
        const c = drip.campaignForTag(kw.campaign_tag);
        if (c) await drip.enroll({ personId: person.id, campaignId: c.id }).catch((e) => log.error?.('[inbound] enroll', e.message));
      }
      await notify(`🏠 Nuevo lead por texto: ${phone} escribió *${word}* (${sourceFor(To)}).`);
      return { reply: rules.keyword_reply[kw.lang] };
    }

    // Respuesta normal: frena drips (stop_on_reply), registra en FUB y avisa al equipo.
    await repo.setLastInbound(phone, new Date(now).toISOString());
    const person = await personFor(phone, To, { message: Body });
    if (person?.id) {
      await fub.logText({ personId: person.id, message: Body, toNumber: To, fromNumber: phone, isIncoming: true })
        .catch((e) => log.error?.('[inbound] logText', e.message));
    }
    const name = [person?.firstName, person?.lastName].filter(Boolean).join(' ') || phone;
    await notify(`💬 ${name} contestó (${sourceFor(To)}): "${Body.slice(0, 300)}"`);
    return { reply: null };
  }

  return { handleSms };
}
