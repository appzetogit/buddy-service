import mongoose from 'mongoose';
import { GlobalSettings } from '../models/settings.model.js';
import { ValidationError } from '../../../core/auth/errors.js';

/**
 * Cash on delivery with an advance, shared by Food, Marketplace (quickCommerce) and Taxi.
 *
 * The admin switches COD on per service and sets what share of the bill the customer pays NOW
 * (the advance, through the wallet and/or online). The rest (remaining) is paid in cash after
 * delivery / at the end of the ride. If an order is cancelled, the advance goes back to the
 * customer's WALLET (never to the gateway).
 *
 * Order shape written by every service (field names are the same everywhere):
 *   payment.method        'cash'   (taxi: paymentMethod 'cash')
 *   payment.status        'cod_pending' until the remaining cash is collected, then 'paid'
 *   payment.amountDue     = remainingAmount
 *   payment.cod = {
 *     enabled: true, percent, advanceAmount, advanceWalletAmount, advanceOnlineAmount,
 *     remainingAmount, advanceStatus: 'paid' | 'refunded' | 'none',
 *     refundedAmount, refundedAt, collectedAmount, collectedAt
 *   }
 */
export const COD_SERVICES = ['food', 'quickCommerce', 'taxi'];
export const COD_SERVICE_LABEL = { food: 'Food', quickCommerce: 'Marketplace', taxi: 'Taxi' };

const DEFAULT_SERVICE = { enabled: false, advancePercent: 20 };
const CACHE_MS = 30 * 1000;
let cache = null;
let cachedAt = 0;

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const normalizeService = (raw = {}) => {
  const percent = Number(raw.advancePercent);
  return {
    enabled: raw.enabled === true,
    advancePercent: Number.isFinite(percent) ? Math.min(100, Math.max(0, round2(percent))) : DEFAULT_SERVICE.advancePercent,
  };
};

export const clearCodSettingsCache = () => {
  cache = null;
  cachedAt = 0;
};

/** { food: {enabled, advancePercent}, quickCommerce: {...}, taxi: {...} } - COD is off everywhere until an admin turns it on. */
export async function getCodSettings() {
  if (cache && Date.now() - cachedAt < CACHE_MS) return cache;
  const doc = await GlobalSettings.findOne().select('codConfig').lean();
  const raw = doc?.codConfig || {};
  cache = Object.fromEntries(COD_SERVICES.map((s) => [s, normalizeService(raw[s])]));
  cachedAt = Date.now();
  return cache;
}

export async function getServiceCod(service) {
  if (!COD_SERVICES.includes(service)) throw new ValidationError('Unknown service');
  return (await getCodSettings())[service];
}

export async function updateCodSettings(body = {}) {
  const current = await getCodSettings();
  const next = {};
  for (const s of COD_SERVICES) {
    const incoming = body?.[s] || {};
    const merged = normalizeService({
      enabled: incoming.enabled !== undefined ? incoming.enabled === true : current[s].enabled,
      advancePercent: incoming.advancePercent !== undefined ? incoming.advancePercent : current[s].advancePercent,
    });
    if (incoming.advancePercent !== undefined) {
      const p = Number(incoming.advancePercent);
      if (!Number.isFinite(p) || p < 0 || p > 100) {
        throw new ValidationError(`${COD_SERVICE_LABEL[s]}: advance must be between 0 and 100 percent`);
      }
    }
    next[s] = merged;
  }
  await GlobalSettings.findOneAndUpdate({}, { $set: { codConfig: next } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  clearCodSettingsCache();
  return next;
}

/**
 * Split a bill into what is paid now and what is paid in cash later.
 * advance = percent of the bill, at least Rs 1 when a percent is set (the gateway minimum), never above the bill.
 */
export function computeCodSplit(total, advancePercent) {
  const bill = Math.max(0, round2(total));
  const percent = Math.min(100, Math.max(0, Number(advancePercent) || 0));
  let advance = round2((bill * percent) / 100);
  if (percent > 0 && advance < 1) advance = Math.min(1, bill);
  advance = Math.min(bill, advance);
  return { total: bill, percent, advanceAmount: advance, remainingAmount: round2(bill - advance) };
}

/** What the apps need before checkout: which payment options exist and, if COD is on, the exact split for `total`. */
export async function getPaymentOptions(service, total = null) {
  const cfg = await getServiceCod(service);
  const out = {
    service,
    online: { enabled: true },
    wallet: { enabled: true },
    cod: { enabled: cfg.enabled, advancePercent: cfg.advancePercent },
  };
  if (cfg.enabled && Number.isFinite(Number(total)) && Number(total) > 0) {
    out.cod.split = computeCodSplit(total, cfg.advancePercent);
  }
  return out;
}

/** True unless an admin switched COD off for this customer (the existing per-user COD flags). */
export const isUserCodAllowed = (user) => !(user && (user.isCodEnabled === false || user.isCodAllowed === false));

/** Throws a clear message when COD cannot be used. Returns the service config and split when it can. */
export async function assertCodAllowed(service, { total, user = null } = {}) {
  const cfg = await getServiceCod(service);
  if (!cfg.enabled) throw new ValidationError('Cash on Delivery is not available right now. Please pay online or with wallet.');
  if (user && !isUserCodAllowed(user)) throw new ValidationError('Cash on Delivery is not available for this account.');
  return { ...cfg, split: computeCodSplit(total, cfg.advancePercent) };
}

/** The `payment.cod` block stored on an order once the advance is paid. */
export function buildCodPayment(split, { advanceWalletAmount = 0, advanceOnlineAmount = 0 } = {}) {
  return {
    enabled: true,
    percent: split.percent,
    advanceAmount: split.advanceAmount,
    advanceWalletAmount: round2(advanceWalletAmount),
    advanceOnlineAmount: round2(advanceOnlineAmount),
    remainingAmount: split.remainingAmount,
    advanceStatus: split.advanceAmount > 0 ? 'paid' : 'none',
    refundedAmount: 0,
    refundedAt: null,
    collectedAmount: 0,
    collectedAt: null,
  };
}

export const objectId = (v) => new mongoose.Types.ObjectId(String(v));
