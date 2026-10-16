/**
 * Real packshots for packaged goods, from the Open Food Facts family of open databases
 * (food, beauty and general products). These are photographs of the actual retail packs sold in
 * India, which is what a quick-commerce catalogue shows.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK_DIR = process.env.SEED_IMAGE_DIR || path.join(HERE, '.cache');
const FILES_DIR = path.join(WORK_DIR, 'files');
const MANIFEST = path.join(WORK_DIR, 'manifest.json');
const UA = 'BuddySeedBot/1.0 (https://sooperbuddy.in; admin@sooperbuddy.in)';

const HOSTS = {
  food: 'https://world.openfoodfacts.org',
  beauty: 'https://world.openbeautyfacts.org',
  products: 'https://world.openproductsfacts.org',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const manifest = () => (fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {});
const write = (m) => fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 1));

async function getJson(url, attempt = 0) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const text = await res.text();
  if (!res.ok || text.trim().startsWith('<')) {
    if (attempt >= 5) throw new Error(`OFF unavailable (${res.status})`);
    await sleep(8000 * (attempt + 1));
    return getJson(url, attempt + 1);
  }
  return JSON.parse(text);
}

let lastCall = 0;
async function search(db, term, india) {
  const gap = Date.now() - lastCall;
  if (gap < 3000) await sleep(3000 - gap);
  lastCall = Date.now();
  const params = new URLSearchParams({
    search_terms: term,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '12',
    sort_by: 'unique_scans_n',
    fields: 'product_name,brands,quantity,image_front_url,countries_tags',
  });
  let url = `${HOSTS[db]}/cgi/search.pl?${params}`;
  if (india) url += '&tagtype_0=countries&tag_contains_0=contains&tag_0=india';
  const data = await getJson(url);
  return data.products || [];
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ');

/**
 * @param {string} term  search terms
 * @param {{ db?: 'food'|'beauty'|'products', must?: string[], india?: boolean, avoid?: Set<string> }} opts
 *        `must`: every phrase has to appear in "brand + product name"
 */
export async function resolveOff(term, { db = 'food', must = [], india = db === 'food', avoid = null } = {}) {
  const key = `off|${db}|${term}|${must.join(',')}`;
  const m = manifest();
  const have = m[key];
  if (have?.file && fs.existsSync(have.file) && !(avoid && avoid.has(have.title))) return { key, ...have };

  const products = await search(db, term, india);
  const pick = products.find((p) => {
    if (!p.image_front_url) return false;
    const hay = norm(`${p.brands} ${p.product_name}`);
    const title = `OFF:${p.brands || ''} ${p.product_name || ''}`.trim();
    if (avoid && avoid.has(title)) return false;
    return must.every((phrase) => hay.includes(norm(phrase).trim()));
  });
  if (!pick) throw new Error(`No pack photo for "${term}"`);

  // Full-size front image instead of the 400px thumbnail.
  const url = pick.image_front_url.replace(/\.(\d+)\.jpg$/, '.full.jpg');
  let res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) res = await fetch(pick.image_front_url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(FILES_DIR, { recursive: true });
  const file = path.join(FILES_DIR, `${crypto.createHash('md5').update(key).digest('hex')}.jpg`);
  fs.writeFileSync(file, buffer);

  const fresh = manifest();
  fresh[key] = {
    query: term,
    title: `OFF:${pick.brands || ''} ${pick.product_name || ''}`.trim(),
    brand: String(pick.brands || '').split(',')[0].trim(),
    productName: String(pick.product_name || '').trim(),
    quantity: String(pick.quantity || '').trim(),
    page: url,
    file,
    cloudinary: fresh[key]?.cloudinary || null,
  };
  write(fresh);
  return { key, ...fresh[key] };
}
