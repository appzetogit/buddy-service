import { QuickDeliverySettings } from '../admin/models/quickDeliverySettings.model.js';
import { sanitizeDeliverySpeedOptions } from '../../food/admin/services/admin.service.js';

/** Values used until an admin saves the settings page (and as the fallback for missing fields). */
export const QUICK_DELIVERY_SETTINGS_DEFAULTS = Object.freeze({
  codEnabled: false,
  offerTimeoutSec: 60,
  broadcastFromAttempt: 3,
  adminAlertFromAttempt: 6,
  maxDispatchAttempts: 10,
  noRiderCancelMinutes: 8,
  sellerAckResendMinutes: 2,
  sellerAckTimeoutMinutes: 5,
  scheduleEnabled: true,
  scheduleLeadMinutes: 30,
  scheduleMinAheadMinutes: 20,
  scheduleMaxDays: 7,
  splitOrderEnabled: true,
  splitOrderThreshold: 20,
  shareTimeoutMinutes: 5,
  multiOrderEnabled: false,
  multiOrderMaxDistance: 5,
  multiOrderAdditionalCharge: 0,
  maxSellersPerOrder: 2,
  deliverySpeedOptions: [],
});

const CACHE_TTL_MS = 15 * 1000;
let cached = null;
let cachedAt = 0;

export const clearQuickDeliverySettingsCache = () => {
  cached = null;
  cachedAt = 0;
};

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const bool = (value, fallback) => (value === undefined || value === null ? fallback : Boolean(value));

/** Coerce a stored / submitted document into a complete, range-checked settings object. */
const normalize = (raw = {}) => {
  const d = QUICK_DELIVERY_SETTINGS_DEFAULTS;
  return {
    codEnabled: bool(raw.codEnabled, d.codEnabled),
    offerTimeoutSec: Math.round(clamp(raw.offerTimeoutSec, 15, 180, d.offerTimeoutSec)),
    broadcastFromAttempt: Math.round(clamp(raw.broadcastFromAttempt, 1, 10, d.broadcastFromAttempt)),
    adminAlertFromAttempt: Math.round(clamp(raw.adminAlertFromAttempt, 1, 20, d.adminAlertFromAttempt)),
    maxDispatchAttempts: Math.round(clamp(raw.maxDispatchAttempts, 1, 30, d.maxDispatchAttempts)),
    noRiderCancelMinutes: clamp(raw.noRiderCancelMinutes, 1, 120, d.noRiderCancelMinutes),
    sellerAckResendMinutes: clamp(raw.sellerAckResendMinutes, 1, 30, d.sellerAckResendMinutes),
    sellerAckTimeoutMinutes: clamp(raw.sellerAckTimeoutMinutes, 2, 60, d.sellerAckTimeoutMinutes),
    scheduleEnabled: bool(raw.scheduleEnabled, d.scheduleEnabled),
    scheduleLeadMinutes: clamp(raw.scheduleLeadMinutes, 5, 240, d.scheduleLeadMinutes),
    scheduleMinAheadMinutes: clamp(raw.scheduleMinAheadMinutes, 5, 240, d.scheduleMinAheadMinutes),
    scheduleMaxDays: Math.round(clamp(raw.scheduleMaxDays, 1, 30, d.scheduleMaxDays)),
    splitOrderEnabled: bool(raw.splitOrderEnabled, d.splitOrderEnabled),
    splitOrderThreshold: Math.max(1, Math.round(Number(raw.splitOrderThreshold) || d.splitOrderThreshold)),
    shareTimeoutMinutes: clamp(raw.shareTimeoutMinutes, 1, 60, d.shareTimeoutMinutes),
    multiOrderEnabled: bool(raw.multiOrderEnabled, d.multiOrderEnabled),
    multiOrderMaxDistance: clamp(raw.multiOrderMaxDistance, 1, 10, d.multiOrderMaxDistance),
    multiOrderAdditionalCharge: Math.max(0, Number(raw.multiOrderAdditionalCharge) || 0),
    maxSellersPerOrder: Math.round(clamp(raw.maxSellersPerOrder, 2, 3, d.maxSellersPerOrder)),
    deliverySpeedOptions: sanitizeDeliverySpeedOptions(raw.deliverySpeedOptions),
  };
};

/** Current QC delivery settings (cached for a few seconds; the admin save clears the cache). */
export async function getQuickDeliverySettings({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached;
  let doc = null;
  try {
    doc = await QuickDeliverySettings.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
  } catch {
    doc = null; // settings must never take checkout down; fall back to defaults
  }
  cached = normalize(doc || {});
  cachedAt = Date.now();
  return cached;
}

export async function upsertQuickDeliverySettings(body = {}) {
  const existing = await QuickDeliverySettings.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
  const merged = normalize({ ...(existing || {}), ...body });
  const saved = existing
    ? await QuickDeliverySettings.findByIdAndUpdate(existing._id, { $set: merged }, { new: true }).lean()
    : (await QuickDeliverySettings.create({ ...merged, isActive: true })).toObject();
  clearQuickDeliverySettingsCache();
  return normalize(saved);
}

/** Settings the customer app needs: COD availability, schedule rules, speed options, multi-store rules. */
export async function getPublicQuickDeliveryOptions() {
  const s = await getQuickDeliverySettings();
  const options = s.deliverySpeedOptions.filter((o) => o.isEnabled !== false);
  const defaultOption = options.find((o) => o.isDefault) || options[0] || null;
  return {
    codEnabled: s.codEnabled,
    schedule: {
      enabled: s.scheduleEnabled,
      leadMinutes: s.scheduleLeadMinutes,
      minAheadMinutes: s.scheduleMinAheadMinutes,
      maxDays: s.scheduleMaxDays,
    },
    speedOptions: options,
    defaultSpeedOptionId: defaultOption?.id || null,
    multiSeller: {
      enabled: s.multiOrderEnabled,
      maxSellers: s.maxSellersPerOrder,
      maxDistanceKm: s.multiOrderMaxDistance,
      additionalCharge: s.multiOrderAdditionalCharge,
    },
  };
}
