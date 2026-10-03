/**
 * Unified BuddyIdentity client helpers.
 *
 * One source of truth for:
 *   - Calling the new /auth/request-otp + /auth/verify-otp endpoints
 *   - Persisting the issued JWT into every legacy localStorage slot so
 *     existing modules (food user, food delivery, driver portal,
 *     etc.) keep working without changes.
 *   - Driver onboarding wizard + mode selector API calls.
 */

import apiClient from "./axios.js";
import {
  requestIdentityOtp,
  verifyIdentityOtp,
} from "./auth.js";
import { setAuthData } from "@food/utils/auth";

const DRIVER_ROUTES = {
  ONBOARDING: "/driver/onboarding",
  ONBOARDING_SERVICES: "/driver/onboarding/services",
  ONBOARDING_VEHICLE_FOOD: "/driver/onboarding/vehicle-food",
  ONBOARDING_BASICS: "/driver/onboarding/basics",
  ONBOARDING_KYC: "/driver/onboarding/kyc",
  ONBOARDING_BANK: "/driver/onboarding/bank",
  ONBOARDING_VEHICLE: "/driver/onboarding/vehicle",
  ONBOARDING_SELFIE: "/driver/onboarding/selfie",
  ONBOARDING_COMPLETE: "/driver/onboarding/complete",
  ONBOARDING_ENABLE: "/driver/onboarding/capabilities/enable",
  MODE: "/driver/mode",
};

/* -------------------------- token persistence --------------------------- */

/**
 * Save a USER-role identity login into every storage slot the rest of the
 * frontend reads from (food, generic, legacy fallbacks).
 *
 * After this runs, ProtectedRoute / axios / cart guards on any of:
 *   /food/user  will see the user as logged in.
 */
export function persistUserIdentitySession({ accessToken, refreshToken, user, identity }) {
  if (!accessToken) return;
  const safeUser = user || identity || {};

  // canonical food slot (used by Food module + auth Login page)
  setAuthData("user", accessToken, safeUser, refreshToken || null);

  try {
    localStorage.setItem("userToken", accessToken);
    localStorage.setItem("userInfo", JSON.stringify(safeUser));

    // legacy generic token keys still read by some code paths
    localStorage.setItem("token", accessToken);
    localStorage.setItem("accessToken", accessToken);
    if (refreshToken) localStorage.setItem("refreshToken", refreshToken);

    // Buddy identity itself (handy for SDK / debugging)
    if (identity) localStorage.setItem("buddy_identity", JSON.stringify(identity));

    localStorage.setItem("role", "user");
    localStorage.setItem("chatRole", "user");
  } catch {
    /* localStorage quota — already logged inside setAuthData */
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("identity:user-login", {
      detail: { token: accessToken, user: safeUser },
    }));
  }
}

/**
 * Save a DRIVER-role identity login into every legacy driver storage slot
 * so the existing food-delivery portal works unchanged.
 */
export function persistDriverIdentitySession({ accessToken, refreshToken, identity, capabilities, activeService }) {
  if (!accessToken) return;
  const safeIdentity = identity || {};

  // The new `/driver/*` endpoints (onboarding wizard + mode selector)
  // are matched by `getModuleFromUrl` to module="driver", so axios looks
  // for `driver_accessToken`. We MUST write that slot too — otherwise
  // every authenticated driver call 401s and the wizard bounces back
  // to /driver/login.
  setAuthData("driver", accessToken, safeIdentity, refreshToken || null);

  // Legacy food-delivery (DeliveryV2) reads `delivery_accessToken`.
  setAuthData("delivery", accessToken, safeIdentity, refreshToken || null);

  try {
    localStorage.setItem("driverToken", accessToken);
    localStorage.setItem("token", accessToken);
    localStorage.setItem("driverInfo", JSON.stringify({
      ...safeIdentity,
      role: "driver",
    }));
    localStorage.setItem("role", "driver");
    localStorage.setItem("driverRole", "driver");
    localStorage.setItem("chatRole", "driver");

    // canonical identity bag
    if (safeIdentity && Object.keys(safeIdentity).length) {
      localStorage.setItem("buddy_identity", JSON.stringify(safeIdentity));
    }
    if (capabilities) {
      localStorage.setItem("driver_capabilities", JSON.stringify(capabilities));
    }
    if (activeService) localStorage.setItem("driver_activeService", activeService);
  } catch {
    /* ignore */
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("identity:driver-login", {
      detail: { token: accessToken, identity: safeIdentity, capabilities, activeService },
    }));
  }
}

export function clearIdentitySession() {
  const keys = [
    "buddy_identity",
    "driver_capabilities",
    "driver_activeService",
  ];
  keys.forEach((key) => {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  });

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("identity:driver-logout"));
  }
}

const decodeJwtPayload = (token) => {
  if (!token || typeof token !== "string") return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padding = (4 - (normalized.length % 4)) % 4;
    return JSON.parse(atob(normalized + "=".repeat(padding)));
  } catch {
    return null;
  }
};

/** True when the current session was issued by unified BuddyIdentity driver auth. */
export function isUnifiedIdentityDriverSession() {
  const token =
    localStorage.getItem("driver_accessToken") ||
    localStorage.getItem("delivery_accessToken") ||
    localStorage.getItem("driverToken");
  const payload = decodeJwtPayload(token);
  return String(payload?.role || "").toUpperCase() === "DRIVER" && Boolean(payload?.identityId);
}

export function getApiErrorMessage(err, fallback = "Something went wrong") {
  return (
    err?.response?.data?.error ||
    err?.response?.data?.message ||
    err?.message ||
    fallback
  );
}

/* -------------------------- thin OTP wrappers --------------------------- */

export const identityAPI = {
  requestOtp: requestIdentityOtp,
  verifyOtp: verifyIdentityOtp,
};

/* ----------------------------- onboarding ------------------------------- */

export const driverOnboardingAPI = {
  getState: () => apiClient.get(DRIVER_ROUTES.ONBOARDING, { contextModule: "driver" }),
  saveServices: (services) =>
    apiClient.patch(
      DRIVER_ROUTES.ONBOARDING_SERVICES,
      { services: Array.isArray(services) ? services : [services].filter(Boolean) },
      { contextModule: "driver" },
    ),
  saveFoodVehicle: (payload) =>
    apiClient.patch(DRIVER_ROUTES.ONBOARDING_VEHICLE_FOOD, payload, { contextModule: "driver" }),
  saveBasics: (payload) => apiClient.patch(DRIVER_ROUTES.ONBOARDING_BASICS, payload, { contextModule: "driver" }),
  saveKyc: (payload) => apiClient.patch(DRIVER_ROUTES.ONBOARDING_KYC, payload, { contextModule: "driver" }),
  saveBank: (payload) => apiClient.patch(DRIVER_ROUTES.ONBOARDING_BANK, payload, { contextModule: "driver" }),
  saveVehicle: (payload) => apiClient.patch(DRIVER_ROUTES.ONBOARDING_VEHICLE, payload, { contextModule: "driver" }),
  saveSelfie: (payload) => apiClient.patch(DRIVER_ROUTES.ONBOARDING_SELFIE, payload, { contextModule: "driver" }),
  complete: (services) =>
    apiClient.post(
      DRIVER_ROUTES.ONBOARDING_COMPLETE,
      services
        ? { services: Array.isArray(services) ? services : [services].filter(Boolean) }
        : {},
      { contextModule: "driver" },
    ),
  enableCapability: (service) =>
    apiClient.post(
      DRIVER_ROUTES.ONBOARDING_ENABLE,
      { service },
      { contextModule: "driver" },
    ),
};

/* ---------------------------- mode selector ----------------------------- */

export const driverModeAPI = {
  get: () => apiClient.get(DRIVER_ROUTES.MODE, { contextModule: "driver" }),
  set: (mode, extras = {}) =>
    apiClient.post(
      DRIVER_ROUTES.MODE,
      { mode, ...extras },
      { contextModule: "driver" },
    ),
};

export default {
  identityAPI,
  driverOnboardingAPI,
  driverModeAPI,
  persistUserIdentitySession,
  persistDriverIdentitySession,
  clearIdentitySession,
  isUnifiedIdentityDriverSession,
  getApiErrorMessage,
};
