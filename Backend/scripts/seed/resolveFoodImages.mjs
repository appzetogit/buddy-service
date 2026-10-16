import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from './imageBank.mjs';
import { RESTAURANTS, FOOD_CATEGORIES } from './data/foodData.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const avoid = new Set(); // photo titles already taken, so every item gets its own picture
const used = new Map(); // primary query -> times used (so repeated dishes get different photos)
const asList = (q) => (Array.isArray(q) ? q : [q]);

async function pick(queries, loose = false) {
  const list = asList(queries);
  const count = used.get(list[0]) || 0;
  used.set(list[0], count + 1);
  let last;
  for (const q of list) {
    try {
      const item = await resolve(q, count, { loose, avoid });
      avoid.add(item.title);
      return item;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

const plan = { categories: {}, restaurants: {} };
for (const [name, q] of FOOD_CATEGORIES) {
  try {
    plan.categories[name] = await pick(q);
  } catch {
    console.log('  MISS category', name, '->', asList(q).join(' | '));
  }
}
for (const r of RESTAURANTS) {
  const entry = { items: {} };
  for (const [slot, q] of [['profile', r.profileQ], ['menu', r.menuQ]]) {
    try {
      entry[slot] = await pick(q);
    } catch {
      console.log('  MISS', r.name, slot, '->', asList(q).join(' | '));
    }
  }
  for (const [name, , , , , q] of r.items) {
    try {
      entry.items[name] = await pick(q);
    } catch (e) {
      console.log('  MISS', r.name, '/', name, '->', asList(q).join(' | '));
    }
  }
  plan.restaurants[r.name] = entry;
  console.log('resolved', r.name);
}
fs.writeFileSync(path.join(HERE, '.cache', 'food-plan.json'), JSON.stringify(plan, null, 1));
console.log('done');
