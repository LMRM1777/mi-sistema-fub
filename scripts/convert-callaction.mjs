// Convierte campañas copiadas de CallAction (config/callaction-import.json) al formato de Señal.
// Uso: node scripts/convert-callaction.mjs 18 19 13 7   (números de campaña del Manual)
// Agrega la marca y "STOP" a los textos que no los tienen y deja la campaña INACTIVA (active:false)
// para que la revises antes de prenderla.
import { readFileSync, writeFileSync } from 'node:fs';

const IMPORT = 'config/callaction-import.json';
const OUT = 'config/campaigns.json';
const wanted = process.argv.slice(2).map(Number);
if (!wanted.length) { console.error('Dime qué campañas: node scripts/convert-callaction.mjs 18 19'); process.exit(1); }

const source = JSON.parse(readFileSync(IMPORT, 'utf8'));
const target = JSON.parse(readFileSync(OUT, 'utf8'));

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const BRAND_VARIANTS = /Lake\s*M(?:I|i|ichigan)\s*Realty(?:\s*(?:Management|Mangement|Manegment|Mgmnt|management|M))?|LM Realty/g;
const SMS = ['texto', 'imagen', 'vcard'];

export function cleanText(text, lang) {
  let t = text.replace(BRAND_VARIANTS, 'Lake Michigan Realty');
  if (!/Lake Michigan Realty/.test(t)) t = `Lake Michigan Realty: ${t}`;
  if (!/STOP/i.test(t)) t = `${t.trim()} ${lang === 'es' ? 'Responde STOP para cancelar.' : 'Reply STOP to opt out.'}`;
  return t;
}

for (const n of wanted) {
  const c = source.find((x) => x.n === n);
  if (!c) { console.error(`No existe la campaña ${n}`); continue; }
  const id = `ca-${n}-${slug(c.name)}`.slice(0, 60);
  const steps = c.steps.filter((s) => !s.date).map((s) => ({
    type: s.type,
    after: s.after,
    ...(s.at ? { at: s.at } : {}),
    text: SMS.includes(s.type) ? cleanText(s.text, c.lang) : s.text,
  }));
  const campaign = {
    id, name: `${c.name} (de CallAction)`, active: false, lang: c.lang,
    trigger_tag: c.start_tag || `drip-${slug(c.name)}`.slice(0, 40),
    stop_on_reply: true, source: `CallAction C${n}`, steps,
  };
  const i = target.campaigns.findIndex((x) => x.id === id);
  if (i >= 0) target.campaigns[i] = campaign; else target.campaigns.push(campaign);
  console.log(`✓ ${c.name} → ${id} (${steps.length} pasos, tag ${campaign.trigger_tag}, INACTIVA)`);
}
writeFileSync(OUT, JSON.stringify(target, null, 2) + '\n');
