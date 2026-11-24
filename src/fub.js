import axios from 'axios';

export function normalizePhone(raw) {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}

export function pickMobile(person) {
  const phones = person?.phones || [];
  const ok = phones.filter((p) => normalizePhone(p.value) && p.status !== 'Not Valid');
  const mobile = ok.find((p) => /mobile|cell/i.test(p.type || '')) || ok[0];
  return mobile ? normalizePhone(mobile.value) : null;
}

export function makeFub({ apiKey, system, systemKey }) {
  const http = axios.create({
    baseURL: 'https://api.followupboss.com/v1',
    auth: { username: apiKey, password: '' },
    headers: { 'Content-Type': 'application/json', 'X-System': system, 'X-System-Key': systemKey },
    timeout: 15000,
  });
  return {
    async getPerson(id) {
      const { data } = await http.get(`/people/${id}`, { params: { fields: 'allFields' } });
      return data;
    },
    async findByPhone(phone) {
      const { data } = await http.get('/people', { params: { phone: phone.replace('+1', ''), limit: 1 } });
      return data.people?.[0] || null;
    },
    // Crea o actualiza el lead (FUB deduplica por teléfono) y devuelve la persona.
    async upsertLead({ phone, source, type = 'General Inquiry', tags = [], message }) {
      const { data } = await http.post('/events', {
        source, system: system, type, message,
        person: { phones: [{ value: phone, type: 'mobile' }], tags },
      });
      return data;
    },
    async addTags(personId, tags) {
      const p = await this.getPerson(personId);
      const merged = [...new Set([...(p.tags || []), ...tags])];
      await http.put(`/people/${personId}`, { tags: merged });
    },
    logText: ({ personId, message, toNumber, fromNumber, isIncoming }) =>
      http.post('/textMessages', { personId, message, toNumber, fromNumber, isIncoming }),
    addNote: (personId, body, subject = 'Sistema de textos') =>
      http.post('/notes', { personId, subject, body }),
    logCall: (call) => http.post('/calls', call),
    createTask: ({ personId, name, dueDate, type = 'Call' }) => http.post('/tasks', { personId, name, type, dueDate }),
  };
}

export function makeSlack(webhookUrl) {
  return async (text) => {
    if (!webhookUrl) return;
    try { await axios.post(webhookUrl, { text }); } catch (e) { console.error('[slack]', e.message); }
  };
}
