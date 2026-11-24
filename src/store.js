// Guarda inscripciones, opt-outs y última respuesta de cada teléfono.
// RedisStore en producción; MemoryStore para pruebas.

export class MemoryStore {
  constructor() { this.kv = new Map(); this.sets = new Map(); }
  async get(k) { return this.kv.has(k) ? JSON.parse(this.kv.get(k)) : null; }
  async set(k, v) { this.kv.set(k, JSON.stringify(v)); }
  async del(k) { this.kv.delete(k); }
  async sadd(k, v) { if (!this.sets.has(k)) this.sets.set(k, new Set()); this.sets.get(k).add(v); }
  async smembers(k) { return [...(this.sets.get(k) || [])]; }
}

export class RedisStore {
  constructor(redis) { this.r = redis; }
  async get(k) { const v = await this.r.get(k); return v ? JSON.parse(v) : null; }
  async set(k, v) { await this.r.set(k, JSON.stringify(v)); }
  async del(k) { await this.r.del(k); }
  async sadd(k, v) { await this.r.sadd(k, v); }
  async smembers(k) { return this.r.smembers(k); }
}

const K = {
  enrollment: (id) => `enr:${id}`,
  personEnrollments: (pid) => `person:${pid}:enr`,
  phoneEnrollments: (ph) => `phone:${ph}:enr`,
  optOut: (ph) => `phone:${ph}:optout`,
  lastInbound: (ph) => `phone:${ph}:lastin`,
};

export function makeRepo(store) {
  return {
    async saveEnrollment(e) {
      await store.set(K.enrollment(e.id), e);
      await store.sadd(K.personEnrollments(e.personId), e.id);
      await store.sadd(K.phoneEnrollments(e.phone), e.id);
    },
    getEnrollment: (id) => store.get(K.enrollment(id)),
    async enrollmentsFor({ personId, phone }) {
      const ids = new Set([
        ...(personId ? await store.smembers(K.personEnrollments(personId)) : []),
        ...(phone ? await store.smembers(K.phoneEnrollments(phone)) : []),
      ]);
      const out = [];
      for (const id of ids) { const e = await store.get(K.enrollment(id)); if (e) out.push(e); }
      return out;
    },
    async stopAllFor(selector, reason) {
      const list = await this.enrollmentsFor(selector);
      for (const e of list) {
        if (e.status === 'active') { e.status = 'stopped'; e.stopReason = reason; await store.set(K.enrollment(e.id), e); }
      }
      return list.filter((e) => e.stopReason === reason).length;
    },
    isOptedOut: async (ph) => !!(await store.get(K.optOut(ph))),
    setOptOut: (ph) => store.set(K.optOut(ph), { at: new Date().toISOString() }),
    clearOptOut: (ph) => store.del(K.optOut(ph)),
    lastInbound: (ph) => store.get(K.lastInbound(ph)),
    setLastInbound: (ph, at = new Date().toISOString()) => store.set(K.lastInbound(ph), at),
  };
}
