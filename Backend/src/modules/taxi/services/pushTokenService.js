import { ApiError } from '../../../utils/ApiError.js';

const MOBILE_PLATFORMS = new Set(['android', 'ios', 'mobile']);
const WEB_PLATFORMS = new Set(['web', 'browser', 'pwa']);

export const normalizePushPlatform = (platform) => {
  const normalized = String(platform || '').trim().toLowerCase();

  if (WEB_PLATFORMS.has(normalized)) {
    return 'web';
  }

  if (MOBILE_PLATFORMS.has(normalized)) {
    return 'mobile';
  }

  throw new ApiError(400, 'platform must be web, android, ios, or mobile');
};

export const normalizePushToken = (token) => {
  const normalized = String(token || '').trim();

  if (!normalized) {
    throw new ApiError(400, 'token is required');
  }

  if (normalized.length < 20) {
    throw new ApiError(400, 'token looks invalid');
  }

  return normalized;
};

export const getPushTokenField = (platform) =>
  normalizePushPlatform(platform) === 'web' ? 'fcmTokenWeb' : 'fcmTokenMobile';

export const assignPushTokenToEntity = (entity, { token, platform }) => {
  const normalizedToken = normalizePushToken(token);
  const normalizedPlatform = normalizePushPlatform(platform);
  const fieldName = getPushTokenField(normalizedPlatform);

  entity[fieldName] = normalizedToken;
  entity.set?.('fcmTokens', undefined, { strict: false });

  return {
    token: normalizedToken,
    platform: normalizedPlatform,
    fieldName,
  };
};

const toTokenList = (value) =>
  (Array.isArray(value) ? value : [value]).map((token) => String(token || '').trim()).filter(Boolean);

/**
 * Tokens a push can go to. Taxi drivers keep one string per platform; platform customers (riders)
 * keep arrays - `fcmTokenMobile` and `fcmTokens` (web) - because the same account can be signed in
 * on several devices across Food, Quick Commerce and Taxi.
 */
export const listEntityPushTokens = (entity = {}, role = 'unknown') => {
  const mobileTokens = toTokenList(entity.fcmTokenMobile);
  const webTokens = toTokenList(entity.fcmTokenWeb).concat(toTokenList(entity.fcmTokens));

  // Prioritize mobile tokens to prevent double notifications on the same device
  // (e.g. in hybrid/webview wrappers where the same device registers both web & mobile FCM tokens).
  if (mobileTokens.length > 0) {
    return mobileTokens.map((token) => ({ role, field: 'fcmTokenMobile', platform: 'mobile', token }));
  }

  return [...new Set(webTokens)].map((token) => ({ role, field: 'fcmTokenWeb', platform: 'web', token }));
};
