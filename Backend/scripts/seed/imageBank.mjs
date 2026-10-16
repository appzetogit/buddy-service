/**
 * Real photographs for seed data.
 *
 * Each image is looked up on Wikimedia Commons by a descriptive query (real, freely licensed
 * photographs - never placeholders), downloaded, and re-hosted on the platform's own Cloudinary
 * account, so the database only ever holds platform-hosted URLs.
 *
 * Two phases so a run can be reviewed before anything is uploaded:
 *   resolve(query, n)  - pick the nth suitable photo for the query and download it locally
 *   publish(item, folder) - upload that photo to Cloudinary (cached, so reruns never re-upload)
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

fs.mkdirSync(FILES_DIR, { recursive: true });

const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
// Several resolvers share one manifest file, so merge with what is on disk instead of overwriting it.
const save = () => {
  const disk = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
  Object.assign(disk, manifest);
  fs.writeFileSync(MANIFEST, JSON.stringify(disk, null, 1));
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BAD_TITLE = /burger king|mcdonald|wendy|kfc|domino|pizza hut|subway|starbucks|ben and jerry|cascarini|coca[- ]cola|pepsi|a&h|kosher|package|packet|beef|pork|bacon|\bham\b|wine|beer|liquor|alcohol|cocktail|twice|portrait|actress|singer|met dp|porcelain|whopper|big mac|bigmac|logo|map\b|diagram|flag|icon|sign\b|chart|poster|advert|menu card|banner|screenshot|\.svg|\.pdf|\.gif|drawing|painting|statue|stamp|coin/i;

async function getJson(url, attempt = 0) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (res.status === 429 || res.status >= 500) {
    if (attempt > 4) throw new Error(`HTTP ${res.status} for ${url}`);
    await sleep(2000 * (attempt + 1));
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function searchCommons(query) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrnamespace: '6',
    gsrlimit: '30',
    gsrsearch: `${query} filetype:bitmap`,
    prop: 'imageinfo',
    iiprop: 'url|size|mime',
    iiurlwidth: '900',
  });
  const data = await getJson(`https://commons.wikimedia.org/w/api.php?${params}`);
  const pages = Object.values(data?.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  return pages
    .map((p) => {
      const info = (p.imageinfo || [])[0] || {};
      return {
        title: p.title,
        mime: info.mime,
        width: info.width,
        height: info.height,
        url: info.thumburl || info.url,
        page: info.descriptionurl,
      };
    })
    .filter(
      (c) =>
        c.url &&
        c.mime === 'image/jpeg' &&
        c.width >= 500 &&
        c.height >= 400 &&
        !BAD_TITLE.test(c.title),
    );
}

const STOP = new Set(['indian', 'food', 'dish', 'with', 'and', 'the', 'street', 'style', 'traditional', 'glass', 'bowl', 'plate']);
const stem = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(ies)$/, 'y').replace(/(es|s)$/, '');

/** Title must mention the dish: all of its words (or all but one for longer names). */
function matchesQuery(title, query) {
  const tokens = query
    .split(/\s+/)
    .map(stem)
    .filter((t) => t.length >= 3 && !STOP.has(t));
  if (!tokens.length) return true;
  const hay = title.toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
  const hits = tokens.filter((t) => hay.includes(t)).length;
  return hits >= (tokens.length <= 2 ? tokens.length : tokens.length - 1);
}

const keyOf = (query, n, loose) => `v8|${loose ? 'loose|' : ''}${query}#${n}`;

/** Pick the nth suitable photo for `query` (0-based) and keep a local copy. */
export async function resolve(query, n = 0, { loose = false, avoid = null } = {}) {
  const key = keyOf(query, n, loose);
  if (manifest[key]?.file && fs.existsSync(manifest[key].file) && !(avoid && avoid.has(manifest[key].title))) {
    return { key, ...manifest[key] };
  }

  // Commons search needs every word to match, so a long query can come back empty: drop trailing
  // words (never below two) until something suitable turns up.
  const words = query.split(/\s+/);
  let candidates = [];
  for (let len = words.length; len >= Math.min(2, words.length) && !candidates.length; len -= 1) {
    const attempt = words.slice(0, len).join(' ');
    candidates = (await searchCommons(attempt)).filter(
      (c) => (loose || matchesQuery(c.title, attempt)) && !(avoid && avoid.has(c.title)),
    );
  }
  // With an avoid-list the first unused photo is taken, so no two items share a picture.
  const pick = avoid ? candidates[0] : candidates[n] || candidates[candidates.length - 1];
  if (!pick && avoid) return resolve(query, n, { loose, avoid: null });
  if (!pick) throw new Error(`No suitable photo found for "${query}"`);

  const res = await fetch(pick.url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${pick.url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const file = path.join(FILES_DIR, `${crypto.createHash('md5').update(key).digest('hex')}.jpg`);
  fs.writeFileSync(file, buffer);

  manifest[key] = { query, n, title: pick.title, page: pick.page, file, cloudinary: manifest[key]?.cloudinary || null };
  save();
  await sleep(250);
  return { key, ...manifest[key] };
}

/** Upload a resolved photo to Cloudinary (once) and return the hosted URL. */
export async function publish(item, folder, uploadImageBuffer) {
  if (!manifest[item.key] && fs.existsSync(MANIFEST)) {
    Object.assign(manifest, JSON.parse(fs.readFileSync(MANIFEST, 'utf8')));
  }
  const entry = manifest[item.key];
  const cached = entry?.cloudinary?.[folder];
  if (cached) return cached;
  const url = await uploadImageBuffer(fs.readFileSync(entry.file), folder);
  entry.cloudinary = { ...(entry.cloudinary || {}), [folder]: url };
  save();
  return url;
}

export const manifestEntries = () => Object.entries(manifest);
