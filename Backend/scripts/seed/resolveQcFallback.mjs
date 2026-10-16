/** Fast path: generic real photographs (Openverse / Commons) for packaged items without a pack photo. */
import fs from 'node:fs';
import { SELLERS } from './data/qcData2.mjs';
import { resolveOpenverse } from './openverseBank.mjs';
import { resolve as resolveCommons } from './imageBank.mjs';

const OUT = '.cache/qc-plan2-fb.json';
const off = JSON.parse(fs.readFileSync('.cache/qc-plan2-off.json', 'utf8'));
const plan = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { sellers: {} };
const used = new Set();
const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const jobs = [];
for (const s of SELLERS) for (const p of s.products) {
  if (p.kind !== 'off') continue;
  const id = `off:${p.terms[0]}`;
  if (off.sellers[s.shop]?.products[id]) continue;
  jobs.push({ s, p, id });
}
console.log('jobs', jobs.length);
async function one({ s, p, id }) {
  const sp = (plan.sellers[s.shop] ||= { shop: null, products: {} });
  if (sp.products[id]) return;
  const base = p.terms[p.terms.length - 1];
  const qs = [...new Set([...p.terms, `${p.terms[0]} packet`, `${base} product`])];
  let e = null;
  if (!process.env.NO_OV) for (const q of qs) { try { e = await resolveOpenverse(q, { avoid: used }); break; } catch {} }
  if (!e) for (const q of qs) { try { e = await resolveCommons(q, 0, { avoid: used }); break; } catch {} }
  if (!e) { console.log('FAIL', s.shop, id); return; }
  used.add(e.title);
  sp.products[id] = { name: `${cap(p.terms[0])} (${p.size})`, title: e.title, key: e.key, file: e.file };
  fs.writeFileSync(OUT, JSON.stringify(plan, null, 1));
  console.log('ok', s.shop, sp.products[id].name);
}
const queue = [...jobs];
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await one(queue.shift()); }));
fs.writeFileSync(OUT, JSON.stringify(plan, null, 1));
console.log('done;');
