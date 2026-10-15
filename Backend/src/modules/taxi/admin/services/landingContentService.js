import { LandingContent } from '../models/LandingContent.js';
import { defaultLandingContent } from '../data/defaultLandingContent.js';

/**
 * Content for the public marketing site.
 *
 * Reads are cached briefly: the landing page is the busiest route on the site
 * and this content changes rarely, so it should not hit Mongo on every visit.
 * Writes drop the cache immediately so admin edits show up on the next load.
 */

// Sections that ride along with the marketing site payload on every visit.
const SECTIONS = ['services', 'valueProps', 'drivers', 'partners', 'launchCities', 'contact', 'brand', 'hero', 'footer', 'seo', 'about', 'faqs', 'servicesPage',
  'corporatePage', 'partnerPage', 'driverPage', 'advertisePage'];
// Legal documents are editable in the same admin screen but are far too large to
// ship with the landing payload, so they get their own endpoint and cache.
const LEGAL_SECTION = 'legal';
const EDITABLE_SECTIONS = [...SECTIONS, LEGAL_SECTION];
const CACHE_TTL_MS = 60_000;

let cache = { value: null, expiresAt: 0 };
let legalCache = { value: null, expiresAt: 0 };

export const invalidateLandingContentCache = () => {
  cache = { value: null, expiresAt: 0 };
  legalCache = { value: null, expiresAt: 0 };
};

const serialize = (doc) => {
  const out = {};
  for (const key of SECTIONS) {
    const value = doc?.[key];
    const isEmpty = Array.isArray(value) ? value.length === 0 : !value || !Object.keys(value).length;
    // fall back per-section, so a half-filled document still renders a full page
    out[key] = isEmpty ? defaultLandingContent[key] : value;
  }
  return out;
};

/** Creates the document from the defaults on first call. */
export const getLandingContent = async ({ fresh = false, includeLegal = false } = {}) => {
  if (!fresh && !includeLegal && cache.value && cache.expiresAt > Date.now()) {
    return cache.value;
  }

  // upsert with $setOnInsert so an existing document is never overwritten
  const doc = await LandingContent.findOneAndUpdate(
    { scope: 'default' },
    { $setOnInsert: { scope: 'default', ...defaultLandingContent } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  const value = serialize(doc);
  // Only the public shape is cached; the admin variant is read fresh anyway.
  if (!includeLegal) {
    cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }
  return { ...value, [LEGAL_SECTION]: doc?.[LEGAL_SECTION] || {} };
};

/** Legal documents only — its own endpoint, so the landing payload stays small. */
export const getLegalContent = async ({ fresh = false } = {}) => {
  if (!fresh && legalCache.value && legalCache.expiresAt > Date.now()) {
    return legalCache.value;
  }

  const doc = await LandingContent.findOne({ scope: 'default' }).select(LEGAL_SECTION).lean();
  // No server-side default: an unset document falls back to the copy bundled
  // with the client, so there is only one place that text lives.
  const value = doc?.[LEGAL_SECTION] || {};
  legalCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
};

export const updateLandingContent = async (payload = {}) => {
  const $set = {};
  for (const key of EDITABLE_SECTIONS) {
    if (payload[key] !== undefined) {
      $set[key] = payload[key];
    }
  }

  if (!Object.keys($set).length) {
    return getLandingContent({ fresh: true, includeLegal: true });
  }

  await LandingContent.updateOne({ scope: 'default' }, { $set }, { upsert: true });
  invalidateLandingContentCache();
  return getLandingContent({ fresh: true, includeLegal: true });
};
