import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from './imageBank.mjs';
import { HEADER_IMAGES, TREE, SELLERS, HEALTH_LEVEL2 } from './data/qcData.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const avoid = new Set();
const asList = (q) => (Array.isArray(q) ? q : [q]);
const used = new Map();

async function pick(queries) {
  const list = asList(queries);
  const count = used.get(list[0]) || 0;
  used.set(list[0], count + 1);
  let last;
  for (const q of list) {
    try {
      const item = await resolve(q, count, { avoid });
      avoid.add(item.title);
      return item;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

const plan = { headers: {}, level2: {}, subs: {}, products: {} };
const miss = [];
const safe = async (label, queries, store, key) => {
  try {
    store[key] = await pick(queries);
  } catch {
    miss.push(`${label}: ${asList(queries).join(' | ')}`);
  }
};

for (const [h, q] of Object.entries(HEADER_IMAGES)) await safe(`header ${h}`, q, plan.headers, h);
const trees = { ...TREE };
for (const [header, levels] of Object.entries(trees)) {
  for (const [l2, def] of Object.entries(levels)) {
    if (!def.existing) await safe(`level2 ${l2}`, def.q, plan.level2, l2);
    for (const [sub, q] of def.subs) await safe(`sub ${sub}`, q, plan.subs, `${l2}/${sub}`);
  }
}
await safe('level2 Health & Wellness', HEALTH_LEVEL2.q, plan.level2, HEALTH_LEVEL2.name);
for (const [sub, q] of HEALTH_LEVEL2.subs) await safe(`sub ${sub}`, q, plan.subs, `${HEALTH_LEVEL2.name}/${sub}`);

for (const s of SELLERS) {
  for (const [name, , , , , , , q] of s.products) await safe(`product ${s.shop}/${name}`, q, plan.products, `${s.shop}/${name}`);
  // shop photo: the store's signature product line
  await safe(`shop ${s.shop}`, [s.type, `${s.type} store`], plan.products, `${s.shop}/__shop__`);
  console.log('resolved', s.shop);
}
fs.writeFileSync(path.join(HERE, '.cache', 'qc-plan.json'), JSON.stringify(plan, null, 1));
console.log('MISSES:\n' + miss.join('\n'));
console.log('done');
