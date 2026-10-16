/**
 * Photographs of everyday objects/produce from Openverse (openly licensed, commercial use allowed).
 * Titles are matched against the query so a result is only used when it is really that item.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const manifest = () => (fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {});
const BAD = /sea cucumber|nightshade|field|fields|town|lunch at|stew|recipe|cooked|soup|salad|sandwich|painting|drawing|logo|cartoon|clipart|illustration|vector|\bart\b|museum|tattoo|tree\b|plant\b|flower|garden|market in|vendor|stall|shop\b/i;
const stem = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(ies)$/, 'y').replace(/(es|s)$/, '');
const STOP = new Set(['the', 'and', 'with', 'for', 'set', 'pcs', 'pack']);

async function api(url, attempt = 0) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (res.status === 429 || res.status >= 500) {
    if (attempt > 4) throw new Error(`Openverse HTTP ${res.status}`);
    await sleep(3000 * (attempt + 1));
    return api(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`Openverse HTTP ${res.status}`);
  return res.json();
}

export async function resolveOpenverse(query, { avoid = null, allowShops = false } = {}) {
  if (process.env.NO_OV) throw new Error('Openverse disabled');
  const key = `ov2|${query}`;
  const m = manifest();
  if (m[key]?.file && fs.existsSync(m[key].file) && !(avoid && avoid.has(m[key].title))) return { key, ...m[key] };

  const tokens = query.split(/\s+/).map(stem).filter((t) => t.length >= 3 && !STOP.has(t));
  const params = new URLSearchParams({ q: query, license_type: 'commercial', page_size: '30', category: 'photograph', mature: 'false' });
  const data = await api(`https://api.openverse.org/v1/images/?${params}`);
  const cands = (data.results || []).filter((r) => {
    const title = `${r.title || ''}`;
    const hay = title.toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
    if (!tokens.every((t) => hay.includes(t))) return false;
    if (!allowShops && BAD.test(title)) return false;
    if (avoid && avoid.has(`OV:${title}`)) return false;
    return (r.width || 0) >= 500 && (r.height || 0) >= 400;
  });
  const pick = cands[0];
  if (!pick) throw new Error(`No Openverse photo for "${query}"`);
  const res = await fetch(pick.thumbnail || pick.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(FILES_DIR, { recursive: true });
  const file = path.join(FILES_DIR, `${crypto.createHash('md5').update(key).digest('hex')}.jpg`);
  fs.writeFileSync(file, buffer);
  const fresh = manifest();
  fresh[key] = { query, title: `OV:${pick.title}`, page: pick.foreign_landing_url, file, cloudinary: fresh[key]?.cloudinary || null };
  fs.writeFileSync(MANIFEST, JSON.stringify(fresh, null, 1));
  await sleep(400);
  return { key, ...fresh[key] };
}
