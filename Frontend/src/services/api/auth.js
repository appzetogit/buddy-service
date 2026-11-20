/**
 * Auth API – new backend (USER, ADMIN, RESTAURANT, DELIVERY).
 * Food-prefixed: POST /food/auth/...
 */

import apiClient from "./axios.js";
import { EMAIL_REGEX } from "@/shared/utils/emailValidation";

const AUTH = {
  USER_REQUEST_OTP: "/food/auth/user/request-otp",
  USER_VERIFY_OTP: "/food/auth/user/verify-otp",
  ADMIN_LOGIN: "/auth/admin/login",
  RESTAURANT_REQUEST_OTP: "/food/auth/restaurant/request-otp",
  RESTAURANT_VERIFY_OTP: "/food/auth/restaurant/verify-otp",
  DELIVERY_REQUEST_OTP: "/food/auth/delivery/request-otp",
  DELIVERY_VERIFY_OTP: "/food/auth/delivery/verify-otp",
  REFRESH_TOKEN: "/food/auth/refresh-token",
  LOGOUT: "/food/auth/logout",
  ME: "/food/auth/me",
  // Unified BuddyIdentity endpoints — one pair for USER and DRIVER.
  IDENTITY_REQUEST_OTP: "/auth/request-otp",
  IDENTITY_VERIFY_OTP: "/auth/verify-otp",
};

/**
 * Normalize phone to digits only (for backend 8–15 digits).
 * @param {string} phone - e.g. "+91 9876543210" or "9876543210"
 */
function normalizePhone(phone) {
  if (!phone) return "";
  const digits = String(phone).replace(/\D/g, "");
  return digits.slice(-15);
}

/** User phone: exactly 10 digits, numeric only. */
const USER_PHONE_LENGTH = 10;

/**
 * Request OTP for user login.
 * Validation: phone required, numeric only, exactly 10 digits (last 10 if country code included).
 * @param {string} phone - Phone (with or without country code, e.g. "+91 9876543210")
 * @returns {Promise<{ data }>}
 */
export function requestUserOtp(phone) {
  const digits = normalizePhone(phone);
  if (!digits) {
    return Promise.reject(new Error("Phone number is required"));
  }
  if (!/^\d+$/.test(digits)) {
    return Promise.reject(new Error("Phone must contain only digits"));
  }
  const normalized =
    digits.length > USER_PHONE_LENGTH
      ? digits.slice(-USER_PHONE_LENGTH)
      : digits;
  if (normalized.length !== USER_PHONE_LENGTH) {
    return Promise.reject(new Error("Phone number must be exactly 10 digits"));
  }
  return apiClient.post(AUTH.USER_REQUEST_OTP, { phone: normalized });
}

/**
 * Verify OTP and login (user).
 * Validation: phone 10 digits, OTP required, exactly 4 digits numeric.
 * Backend returns { accessToken, refreshToken, user }.
 * @param {string} phone - Same format as request
 * @param {string} otp - 4-digit OTP only
 */
export function verifyUserOtp(
  phone,
  otp,
  ref,
  name = null,
  fcmToken = null,
  platform = "web",
) {
  const digits = normalizePhone(phone);
  if (!digits) {
    return Promise.reject(new Error("Phone number is required"));
  }
  const normalized =
    digits.length > USER_PHONE_LENGTH
      ? digits.slice(-USER_PHONE_LENGTH)
      : digits;
  if (normalized.length !== USER_PHONE_LENGTH) {
    return Promise.reject(new Error("Phone number must be exactly 10 digits"));
  }
  const otpStr = String(otp ?? "")
    .replace(/\D/g, "")
    .slice(0, 4);
  if (!otpStr) {
    return Promise.reject(new Error("OTP is required"));
  }
  if (otpStr.length !== 4) {
    return Promise.reject(new Error("OTP must be exactly 4 digits"));
  }
  const refValue = typeof ref === "string" ? ref.trim() : "";
  return apiClient.post(AUTH.USER_VERIFY_OTP, {
    phone: normalized,
    otp: otpStr,
    ...(refValue ? { ref: refValue } : {}),
    ...(name ? { name } : {}),
    ...(fcmToken ? { fcmToken, platform } : {}),
  });
}

/**
 * Admin login (email + password).
 * Validation: email required and valid format, password required and min 6 characters.
 * Backend returns { accessToken, refreshToken, user } (key is "user" not "admin").
 */
export function adminLogin(email, password, loginAs) {
  const trimmedEmail = typeof email === "string" ? email.trim() : "";
  if (!trimmedEmail) {
    return Promise.reject(new Error("Email is required"));
  }
  if (!EMAIL_REGEX.test(trimmedEmail)) {
    return Promise.reject(new Error("Please enter a valid email address"));
  }
  const passwordStr = String(password ?? "");
  if (!passwordStr) {
    return Promise.reject(new Error("Password is required"));
  }
  if (passwordStr.length < 6) {
    return Promise.reject(new Error("Password must be at least 6 characters"));
  }
  return apiClient.post(AUTH.ADMIN_LOGIN, {
    email: trimmedEmail,
    password: passwordStr,
    ...(loginAs ? { loginAs } : {}),
  });
}

/**
 * Refresh access token.
 * @param {string} refreshToken
 * @returns {Promise<{ data }>} data.accessToken
 */
export function refreshToken(refreshToken) {
  if (!refreshToken)
    return Promise.reject(new Error("Refresh token is required"));
  return apiClient.post(AUTH.REFRESH_TOKEN, { refreshToken });
}

/**
 * Logout (invalidate refresh token).
 * @param {string} refreshToken
 * @param {string} fcmToken
 * @param {string} platform
 */
export function logout(refreshToken, fcmToken = null, platform = "web") {
  if (!refreshToken) return Promise.resolve({ data: { success: true } });

  const payload = { refreshToken };
  if (fcmToken) {
    payload.fcmToken = fcmToken;
    payload.platform = platform;
  }

  clearMeCache();
  return apiClient.post(AUTH.LOGOUT, payload);
}

/** 
 * Clear all local /me caches (resets on logout or new login) 
 */
export function clearMeCache() {
  meCache.clear();
  meInFlight.clear();
}

/**
 * Get current profile (requires Bearer).
 * @param {string} [module] - "user" | "admin" | "restaurant" | "delivery" (which token to send; default "user")
 */
export function getMe(module = "user") {
  const m = String(module || "user");
  // Deduplicate /me calls to avoid request storms (and accidental 429s)
  // across multiple components mounting at once.
  return getMeOnce(m);
}

// ---- /me in-flight + short cache (per module) ----
const ME_CACHE_MS = 60 * 1000;
const meCache = new Map(); // module -> { at, res }
const meInFlight = new Map(); // module -> Promise

function hasAccessToken(module) {
  try {
    if (localStorage.getItem(`${module}_accessToken`)) return true;
    // DRIVER identity login may only have one of these slots populated
    if (module === "delivery" && localStorage.getItem("driver_accessToken")) return true;
    if (module === "driver" && localStorage.getItem("delivery_accessToken")) return true;
    return false;
  } catch {
    return false;
  }
}

// module -> { at, backoffUntil }
const meBackoff = new Map();
const BACKOFF_MS = 10000; // 10s wait on 429

function getMeOnce(module) {
  const now = Date.now();
  
  // 1. Check Backoff (e.g. from previous 429)
  const backoff = meBackoff.get(module);
  if (backoff && now < backoff) {
    return Promise.reject(new Error("Rate limited. Retrying too soon."));
  }

  // 2. Check Cache
  const cached = meCache.get(module);
  if (cached && now - cached.at < ME_CACHE_MS) {
    return Promise.resolve(cached.res);
  }

  // 3. Check Auth Status
  if (!hasAccessToken(module)) {
    return Promise.reject(new Error("Not authenticated"));
  }

  // 4. Return In-Flight Promise
  const existing = meInFlight.get(module);
  if (existing) return existing;

  const p = apiClient
    .get(AUTH.ME, { contextModule: module })
    .then((res) => {
      meCache.set(module, { at: Date.now(), res });
      return res;
    })
    .catch((err) => {
      if (err?.response?.status === 429) {
        meBackoff.set(module, Date.now() + BACKOFF_MS);
      }
      throw err;
    })
    .finally(() => {
      meInFlight.delete(module);
    });

  meInFlight.set(module, p);
  return p;
}

/**
 * Restaurant OTP auth (backend: same phone format as user, 4-digit OTP e.g. 1234).
 */
export function requestRestaurantOtp(phone) {
  const normalized = normalizePhone(phone);
  if (normalized.length < 8) {
    return Promise.reject(new Error("Phone must be at least 8 digits"));
  }
  return apiClient.post(AUTH.RESTAURANT_REQUEST_OTP, { phone: normalized });
}

export function verifyRestaurantOtp(phone, otp, fcmToken = null, platform = "web") {
  const normalized = normalizePhone(phone);
  const otpStr = String(otp).replace(/\D/g, "").slice(0, 6);
  if (!normalized || otpStr.length < 4) {
    return Promise.reject(new Error("Phone and 4-digit OTP are required"));
  }
  return apiClient.post(AUTH.RESTAURANT_VERIFY_OTP, {
    phone: normalized,
    otp: otpStr,
    ...(fcmToken ? { fcmToken, platform } : {}),
  });
}

/**
 * Delivery partner OTP auth (backend: same phone + 4-digit OTP).
 */
export function requestDeliveryOtp(phone) {
  const normalized = normalizePhone(phone);
  if (normalized.length < 8) {
    return Promise.reject(new Error("Phone must be at least 8 digits"));
  }
  return apiClient.post(AUTH.DELIVERY_REQUEST_OTP, { phone: normalized });
}

export function verifyDeliveryOtp(phone, otp, fcmToken = null, platform = "web") {
  const normalized = normalizePhone(phone);
  const otpStr = String(otp).replace(/\D/g, "").slice(0, 6);
  if (!normalized || otpStr.length < 4) {
    return Promise.reject(new Error("Phone and 4-digit OTP are required"));
  }
  return apiClient.post(AUTH.DELIVERY_VERIFY_OTP, {
    phone: normalized,
    otp: otpStr,
    ...(fcmToken ? { fcmToken, platform } : {}),
  });
}

/* ---------------------------------------------------------------------- *
 *  Unified BuddyIdentity auth (the new single login)
 *  These power both customer and driver apps. The same phone+OTP works
 *  for whichever `role` the caller verifies with.
 *
 *  Endpoints (mounted under /api/v1):
 *    POST /auth/request-otp   { phone, role? }
 *    POST /auth/verify-otp    { phone, role, otp, name?, fcmToken?, platform? }
 * ---------------------------------------------------------------------- */

const IDENTITY_ROLES = new Set(["USER", "DRIVER"]);

function normalizeIdentityRole(role) {
  const upper = String(role || "USER").toUpperCase();
  return IDENTITY_ROLES.has(upper) ? upper : "USER";
}

/**
 * Request OTP for the unified identity login.
 * Server enforces a 10-digit phone; we mirror that validation client-side.
 */
export function requestIdentityOtp(phone, role = "USER") {
  const digits = normalizePhone(phone);
  if (!digits) return Promise.reject(new Error("Phone number is required"));
  const last10 = digits.slice(-10);
  if (last10.length !== 10) {
    return Promise.reject(new Error("Phone number must be exactly 10 digits"));
  }
  return apiClient.post(
    AUTH.IDENTITY_REQUEST_OTP,
    { phone: last10, role: normalizeIdentityRole(role) },
    // The identity routes don't follow the food/taxi naming convention used
    // by getModuleFromUrl, so we must hint the axios module manually.
    { contextModule: normalizeIdentityRole(role) === "DRIVER" ? "driver" : "user" },
  );
}

/**
 * Verify OTP, log in, and (for first-time USER signups) capture the name.
 * Response shape: { accessToken, refreshToken, role, identity, capabilities,
 *   services, needsOnboarding, isNewUser, user?, activeService? }
 */
export function verifyIdentityOtp(
  phone,
  role,
  otp,
  {
    name = null,
    fcmToken = null,
    platform = "web",
    ref = null,
  } = {},
) {
  const digits = normalizePhone(phone);
  if (!digits) return Promise.reject(new Error("Phone number is required"));
  const last10 = digits.slice(-10);
  if (last10.length !== 10) {
    return Promise.reject(new Error("Phone number must be exactly 10 digits"));
  }
  const otpStr = String(otp ?? "").replace(/\D/g, "").slice(0, 4);
  if (otpStr.length !== 4) {
    return Promise.reject(new Error("OTP must be exactly 4 digits"));
  }

  const normalizedRole = normalizeIdentityRole(role);
  const refValue = typeof ref === "string" ? ref.trim() : "";

  return apiClient.post(
    AUTH.IDENTITY_VERIFY_OTP,
    {
      phone: last10,
      role: normalizedRole,
      otp: otpStr,
      ...(name ? { name: String(name).trim() } : {}),
      ...(fcmToken ? { fcmToken, platform } : {}),
      ...(refValue ? { ref: refValue } : {}),
    },
    { contextModule: normalizedRole === "DRIVER" ? "driver" : "user" },
  );
}
