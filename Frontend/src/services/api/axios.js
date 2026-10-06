/**
 * Central API client for backend (auth and future APIs).
 * - baseURL from VITE_API_BASE_URL (e.g. http://localhost:5000/api/v1)
 * - When baseURL ends with /api/v1, request paths must NOT include /v1 (use /food/..., /auth/...)
 * - Attaches Bearer token (user or admin based on request URL)
 * - On 401: attempts refresh, retries once; on refresh failure logs out
 */

import axios from "axios";
import { clearModuleAuth } from "../../modules/Food/utils/auth.js";

// Prefer explicit env. If not set, default to /api/v1 so the Vite proxy can forward to backend.
// This avoids hardcoding ports like 5000 that may conflict with local setups.
const baseURL =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL
    ? String(import.meta.env.VITE_API_BASE_URL).replace(/\/$/, "")
    : "/api/v1";

const apiClient = axios.create({
  baseURL: baseURL || undefined,
  timeout: 30000,
  headers: { "Content-Type": "application/json" },
});

function isPublicFoodRestaurantUrl(normalized = "") {
  // Consumer/catalog endpoints live under /food/restaurant/* but must NOT use
  // the partner restaurant session (and must never wipe it on 401).
  if (!normalized.includes("/food/restaurant")) return false;
  if (normalized.includes("/public")) return true;
  if (
    /\/food\/restaurant\/restaurants(\/|\?|$)/.test(normalized) ||
    /\/food\/restaurant\/offers(\?|$)/.test(normalized) ||
    /\/food\/restaurant\/delivery-speed-options(\?|$)/.test(normalized) ||
    /\/food\/restaurant\/categories(\/|\?|$)/.test(normalized)
  ) {
    return true;
  }
  return false;
}

function getModuleFromUrl(url = "") {
  const u = typeof url === "string" ? url : (url?.url || "");
  if (!u) return "user";
  
  const normalized = u.toLowerCase();
  
  // Admin detection
  if (
    normalized.includes("/admin/") || 
    normalized.includes("/food/admin/") || 
    normalized.includes("/food/auth/admin") || 
    normalized.includes("/auth/admin") || 
    normalized.includes("admin/login")
  ) return "admin";

  // Unified driver endpoints (onboarding + mode selector) issued under
  // /api/v1/driver/* by the new BuddyIdentity layer. Must come before the
  // legacy /food/delivery match below so DRIVER tokens are used.
  if (
    normalized.startsWith("/driver/") ||
    normalized === "/driver" ||
    normalized.includes("/driver/onboarding") ||
    normalized.includes("/driver/mode")
  ) return "driver";

  // Quick Commerce seller APIs (/v1/seller/*) authenticate with the seller session
  if (/(^|\/)seller(\/|$)/.test(normalized)) return "seller";

  // Delivery detection - Catch all delivery-specific functional and auth routes
  if (
    normalized.includes("/food/delivery") || 
    normalized.includes("/auth/delivery") || 
    normalized.includes("/delivery/")
  ) return "delivery";

  // Public consumer restaurant catalog APIs → user module
  if (isPublicFoodRestaurantUrl(normalized)) {
    return "user";
  }
  
  // Restaurant partner detection - authenticated partner panel routes only
  if (
    normalized.includes("/food/restaurant/") || 
    normalized.includes("/auth/restaurant") || 
    normalized.includes("/restaurant/")
  ) {
    // Exception: /food/restaurants (plural) is usually a public user app route
    if (normalized.includes("/food/restaurants") && !normalized.includes("/food/restaurant/")) {
       return "user";
    }
    return "restaurant";
  }
  
  return "user";
}

function getModuleFromConfig(config) {
  if (config?.contextModule) return config.contextModule;
  return getModuleFromUrl(config?.url);
}

function getAccessToken(config) {
  const module = getModuleFromConfig(config);
  const key = `${module}_accessToken`;
  try {
    // 1. Try module-specific token first
    const moduleToken = localStorage.getItem(key);
    if (moduleToken) return moduleToken;

    // Unified BuddyIdentity DRIVER login writes both driver_* and delivery_* slots,
    // but older sessions / partial writes may only have one — accept either.
    if (module === "delivery") {
      return localStorage.getItem("driver_accessToken") || null;
    }
    if (module === "driver") {
      return localStorage.getItem("delivery_accessToken") || null;
    }

    // 2. Fallback to legacy generic token only for user module.
    // Using generic token for delivery/restaurant can send wrong role token
    // and trigger 403 on protected role-based endpoints.
    if (module === "seller") {
      return localStorage.getItem("auth_seller") || null;
    }
    if (module === "user") {
      return localStorage.getItem("accessToken") || null;
    }
    return null;
  } catch {
    return null;
  }
}

function getRefreshToken(module) {
  try {
    // 1. Try module-specific refresh token
    const moduleRefreshToken = localStorage.getItem(`${module}_refreshToken`);
    if (moduleRefreshToken) return moduleRefreshToken;

    if (module === "delivery") {
      return localStorage.getItem("driver_refreshToken") || null;
    }
    if (module === "driver") {
      return localStorage.getItem("delivery_refreshToken") || null;
    }

    // 2. Fallback to legacy generic refresh token only for user module.
    if (module === "user") {
      return localStorage.getItem("refreshToken") || null;
    }
    return null;
  } catch {
    return null;
  }
}

const refreshStateByModule = new Map();

function getRefreshState(module) {
  if (!refreshStateByModule.has(module)) {
    refreshStateByModule.set(module, {
      isRefreshing: false,
      subscribers: [],
    });
  }
  return refreshStateByModule.get(module);
}

function subscribeToRefresh(module, cb) {
  getRefreshState(module).subscribers.push(cb);
}

function onRefreshed(newToken, module) {
  const state = getRefreshState(module);
  state.subscribers.forEach((cb) => cb(newToken));
  state.subscribers = [];
}

function onRefreshFailed(module) {
  clearModuleAuth(module);
  const state = getRefreshState(module);
  state.subscribers.forEach((cb) => cb(null));
  state.subscribers = [];

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("authRefreshFailed", { detail: { module } }));
    if (module === "restaurant") {
      window.dispatchEvent(new Event("restaurantAuthChanged"));
    }
  }
}

/**
 * Proactively refresh an expired access token using the stored refresh token.
 * Used on app startup so guards don't bounce users to login before any API call.
 * @param {string} module
 * @returns {Promise<string|null>} new access token or null
 */
function isTransientRefreshError(err) {
  if (!err) return false;
  // No HTTP response = network / timeout / offline — keep tokens so reopen can retry.
  if (!err.response) return true;
  const status = err.response.status;
  return status === 408 || status === 429 || status >= 500;
}

export async function refreshModuleAccessToken(module) {
  if (!module) return null;
  const refreshToken = getRefreshToken(module);
  if (!refreshToken) return null;

  const state = getRefreshState(module);
  if (state.isRefreshing) {
    return new Promise((resolve) => {
      subscribeToRefresh(module, (newToken) => resolve(newToken || null));
    });
  }

  state.isRefreshing = true;
  try {
    const refreshUrl = baseURL
      ? `${baseURL}/food/auth/refresh-token`
      : "/api/v1/food/auth/refresh-token";
    const { data } = await axios.post(refreshUrl, { refreshToken }, { timeout: 10000 });
    const newAccessToken = data?.data?.accessToken || data?.accessToken;
    const newRefreshToken = data?.data?.refreshToken || data?.refreshToken;
    if (newAccessToken) {
      try {
        localStorage.setItem(`${module}_accessToken`, newAccessToken);
        localStorage.setItem(`${module}_authenticated`, "true");
        if (newRefreshToken && typeof newRefreshToken === "string") {
          localStorage.setItem(`${module}_refreshToken`, newRefreshToken);
        }
        window.dispatchEvent(
          new CustomEvent("authRefreshed", {
            detail: { module, token: newAccessToken },
          }),
        );
      } catch (_) {}
      onRefreshed(newAccessToken, module);
      return newAccessToken;
    }
  } catch (err) {
    // Only wipe the session when the refresh token is definitively invalid.
    // Network blips on app reopen must not force restaurant partners to log in again.
    if (isTransientRefreshError(err)) {
      onRefreshed(null, module);
      return null;
    }
    onRefreshFailed(module);
    return null;
  } finally {
    state.isRefreshing = false;
  }

  onRefreshFailed(module);
  return null;
}

apiClient.interceptors.request.use(
  (config) => {
    config.contextModule = getModuleFromConfig(config);

    // If sending FormData, let the browser set proper multipart boundary.
    if (config.data instanceof FormData) {
      if (config.headers && config.headers["Content-Type"]) {
        delete config.headers["Content-Type"];
      }
    }

    const token = getAccessToken(config);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (err) => Promise.reject(err)
);

apiClient.interceptors.response.use(
  (response) => response,
  async (err) => {
    const original = err?.config;
    const module = original?.contextModule || getModuleFromUrl(original?.url || "");
    const banMessage = String(err?.response?.data?.message || "");

    if (
      err?.response?.status === 403 &&
      module === "restaurant" &&
      /banned/i.test(banMessage)
    ) {
      clearModuleAuth("restaurant");
      window.dispatchEvent(new Event("restaurantAuthChanged"));
      if (typeof window !== "undefined" && !window.location.pathname.includes("/food/restaurant/login")) {
        window.location.assign("/food/restaurant/login");
      }
      return Promise.reject(err);
    }

    if (err?.response?.status === 429) {
      return Promise.reject(err);
    }
    if (err?.response?.status !== 401 || !original || original._retry) {
      return Promise.reject(err);
    }

    // OTP / login endpoints return 401 for invalid/missing OTP — never treat as
    // session expiry or run refresh (that can clear a just-issued login).
    const requestUrl = String(original?.url || "");
    const normalizedRequestUrl = requestUrl.toLowerCase();
    if (
      /\/(request-otp|verify-otp|login|register)(\?|$)/i.test(requestUrl) ||
      /\/auth\/(user|restaurant|delivery)\/(request-otp|verify-otp)/i.test(requestUrl) ||
      /\/food\/auth\/(user|restaurant|delivery)\/(request-otp|verify-otp)/i.test(requestUrl)
    ) {
      return Promise.reject(err);
    }

    // Public consumer catalog calls must never wipe a partner restaurant session.
    if (isPublicFoodRestaurantUrl(normalizedRequestUrl)) {
      return Promise.reject(err);
    }

    const refreshToken = getRefreshToken(module);
    if (!refreshToken) {
      // Only clear when this request was actually using that module's session.
      // Avoid wiping restaurant/delivery auth because of unrelated 401s.
      const hadModuleAccessToken = Boolean(
        original?.headers?.Authorization || getAccessToken({ ...original, contextModule: module })
      );
      if (hadModuleAccessToken) {
        clearModuleAuth(module);
        if (module === "restaurant" && typeof window !== "undefined") {
          window.dispatchEvent(new Event("restaurantAuthChanged"));
        }
      }
      return Promise.reject(err);
    }

    const state = getRefreshState(module);
    if (state.isRefreshing) {
      return new Promise((resolve, reject) => {
        subscribeToRefresh(module, (newToken) => {
          if (newToken) {
            original.headers.Authorization = `Bearer ${newToken}`;
            resolve(apiClient(original));
          } else {
            reject(err);
          }
        });
      });
    }

    original._retry = true;
    state.isRefreshing = true;

    try {
      // Use relative URL so this works both with an explicit baseURL and with a dev proxy.
      // Use plain axios to avoid interceptor recursion.
      const refreshUrl = baseURL ? `${baseURL}/food/auth/refresh-token` : "/api/v1/food/auth/refresh-token";
      const { data } = await axios.post(refreshUrl, { refreshToken }, { timeout: 10000 });
      const newAccessToken = data?.data?.accessToken || data?.accessToken;
      const newRefreshToken = data?.data?.refreshToken || data?.refreshToken;
      if (newAccessToken) {
        try {
          localStorage.setItem(`${module}_accessToken`, newAccessToken);
          localStorage.setItem(`${module}_authenticated`, "true");
          if (newRefreshToken && typeof newRefreshToken === "string") {
            localStorage.setItem(`${module}_refreshToken`, newRefreshToken);
          }
          // Dispatch a custom event specifically for the module that refreshed
          window.dispatchEvent(new CustomEvent("authRefreshed", { 
            detail: { module, token: newAccessToken } 
          }));
        } catch (_) {}
        onRefreshed(newAccessToken, module);
        original.headers.Authorization = `Bearer ${newAccessToken}`;
        return apiClient(original);
      }
    } catch (refreshErr) {
      if (isTransientRefreshError(refreshErr)) {
        onRefreshed(null, module);
        return Promise.reject(err);
      }
      onRefreshFailed(module);
      return Promise.reject(err);
    } finally {
      state.isRefreshing = false;
    }

    onRefreshFailed(module);
    return Promise.reject(err);
  }
);

export default apiClient;
