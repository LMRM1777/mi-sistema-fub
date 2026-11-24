import { DateTime } from 'luxon';

const hm = (s) => { const [h, m] = s.split(':').map(Number); return { hour: h, minute: m, second: 0, millisecond: 0 }; };

// Mueve una fecha al siguiente momento permitido (ventana de envío y días bloqueados).
export function nextAllowed(dt, rules) {
  const tz = rules.timezone;
  let t = dt.setZone(tz);
  const start = hm(rules.send_window.start);
  const end = hm(rules.send_window.end);
  for (let i = 0; i < 14; i++) {
    const dayStart = t.set(start);
    const dayEnd = t.set(end);
    const blocked = (rules.skip_weekdays || []).includes(t.weekday);
    if (!blocked && t >= dayStart && t < dayEnd) return t;
    if (!blocked && t < dayStart) return dayStart;
    t = t.plus({ days: 1 }).set(start);
  }
  throw new Error('No hay día permitido para enviar en las próximas 2 semanas: revisa rules.json');
}

// Hora en que debe salir un paso: día N después de la inscripción, a la hora indicada.
export function stepTime(step, enrolledAtIso, rules, now = DateTime.now()) {
  const tz = rules.timezone;
  const base = DateTime.fromISO(enrolledAtIso).setZone(tz);
  let target = step.time === 'now' ? base : base.plus({ days: step.day }).set(hm(step.time));
  if (step.time === 'now' && step.day) target = base.plus({ days: step.day });
  if (target < now) target = now.setZone(tz);
  return nextAllowed(target, rules);
}

export const isWithinWindow = (now, rules) => +nextAllowed(now, rules) === +now.setZone(rules.timezone);
