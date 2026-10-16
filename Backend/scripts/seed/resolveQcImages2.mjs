/** Resolves a photo for every QC product / shop in qcData2 and writes .cache/qc-plan2.json (resumable). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SELLERS } from './data/qcData2.mjs';
import { resolveOff } from './offBank.mjs';
import { resolveOpenverse } from './openverseBank.mjs';
import { resolve as resolveCommons } from './imageBank.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODE = process.argv[2] || 'all';
const OUT = path.join(HERE, '.cache', `qc-plan2-${MODE}.json`);
const plan = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { sellers: {} };
const used = new Set();
const failed = [];

const clean = (s) => s.replace(/\s+/g, ' ').replace(/[|_]+/g, ' ').trim();
function nameOf(e) {
  const b = e.brand, p = clean(e.productName);
  const full = p.toLowerCase().startsWith(b.toLowerCase()) ? p : clean(`${b} ${p}`);
  return full.length > 70 ? full.slice(0, 70).replace(/\s+\S*$/, '') : full;
}

for (const s of SELLERS) {
  const sp = (plan.sellers[s.shop] ||= { shop: null, products: {} });
  try {
    if (!sp.shop && MODE !== 'off') sp.shop = await tryAll(s.shopPhoto, true);
  } catch (e) { failed.push(`${s.shop}: shop photo ${e.message}`); }

  for (const [i, p] of s.products.entries()) {
    if (MODE !== 'all' && p.kind !== MODE) continue;
    const id = p.kind === 'off' ? `off:${p.terms[0]}` : `gen:${p.name}`;
    if (sp.products[id]) { used.add(sp.products[id].title); continue; }
    try {
      if (p.kind === 'off') {
        let e = null;
        for (const term of p.terms) {
          try { e = await resolveOff(term, { db: p.db, must: p.any.length ? [] : [], avoid: used }); } catch { /* next */ }
          if (e && !p.any.some((k) => `${e.brand} ${e.productName}`.toLowerCase().includes(k))) e = null;
          if (e) break;
        }
        if (!e) throw new Error('no OFF match');
        used.add(e.title);
        sp.products[id] = { name: nameOf(e), title: e.title, key: e.key, file: e.file };
      } else {
        const e = await tryAll(p.queries, false);
        used.add(e.title);
        sp.products[id] = { name: p.name, title: e.title, key: e.key, file: e.file };
      }
      fs.writeFileSync(OUT, JSON.stringify(plan, null, 1));
      console.log(`ok   ${s.shop} #${i + 1} ${sp.products[id].name}`);
    } catch (e) {
      failed.push(`${s.shop} :: ${id} :: ${e.message}`);
      console.log(`FAIL ${s.shop} :: ${id} :: ${e.message}`);
    }
  }
}
fs.writeFileSync(OUT, JSON.stringify(plan, null, 1));
fs.writeFileSync(path.join(HERE, '.cache', `qc-failed2-${MODE}.txt`), failed.join('\n'));
console.log('done; failed:', failed.length);

async function tryAll(queries, shops) {
  for (const q of queries) {
    try { return await resolveOpenverse(q, { avoid: used, allowShops: shops }); } catch { /* next */ }
  }
  for (const q of queries) {
    try { return await resolveCommons(q, 0, { avoid: used }); } catch { /* next */ }
  }
  throw new Error(`no photo for ${queries[0]}`);
}
