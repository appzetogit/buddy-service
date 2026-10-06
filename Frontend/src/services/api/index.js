/**
 * API layer - auth connected to new backend; rest stubbed for UI compatibility.
 */

import apiClient from "./axios.js";
import { API_ENDPOINTS } from "./config.js";
import * as authService from "./auth.js";
import {
  invalidateRestaurantSessionCache,
  restaurantSessionCache,
} from "../../modules/Food/utils/restaurantSessionCache.js";
import { resolveEntityId } from "../../modules/Food/utils/common.js";

// Unified BuddyIdentity helpers (single login + driver onboarding/mode).
export {
  identityAPI,
  driverOnboardingAPI,
  driverModeAPI,
  persistUserIdentitySession,
  persistDriverIdentitySession,
  clearIdentitySession,
  isUnifiedIdentityDriverSession,
  getApiErrorMessage,
} from "./identity.js";

const stub = () =>
  Promise.resolve({
    data: { success: false, message: "Backend not connected", data: null },
    status: 200,
    statusText: "OK",
    headers: {},
    config: {},
  });

function stableStringify(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function createInFlightCache({ ttlMs }) {
  const inFlight = new Map();
  const cached = new Map();

  const getCached = (key) => {
    const hit = cached.get(key);
    if (!hit) return null;
    if (Date.now() - hit.t > ttlMs) {
      cached.delete(key);
      return null;
    }
    return hit.v;
  };

  const getOrCreate = (key, factory) => {
    const cachedValue = getCached(key);
    if (cachedValue) return Promise.resolve(cachedValue);
    if (inFlight.has(key)) return inFlight.get(key);
    const p = Promise.resolve()
      .then(factory)
      .then((res) => {
        cached.set(key, { t: Date.now(), v: res });
        return res;
      })
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, p);
    return p;
  };

  const clear = (key) => {
    if (key) {
      cached.delete(key);
      inFlight.delete(key);
      return;
    }
    cached.clear();
    inFlight.clear();
  };

  return { getOrCreate, clear };
}

/** Search API - unified search for user app */
const foodSearchCache = createInFlightCache({ ttlMs: 30 * 1000 });
const foodSearchCategoriesCache = createInFlightCache({ ttlMs: 5 * 60 * 1000 });

export const searchAPI = {
  unifiedSearch: (params = {}, config = {}) => {
    const { noCache, signal, ...axiosConfig } = config || {};
    const keyParams = { ...params };
    delete keyParams._ts;
    if (noCache || signal) {
      return apiClient.get("/food/search/unified", { params: keyParams, signal, ...axiosConfig });
    }
    const key = `search:${stableStringify(keyParams)}`;
    return foodSearchCache.getOrCreate(key, () =>
      apiClient.get("/food/search/unified", { params: keyParams, ...axiosConfig }),
    );
  },
  getAdminCategories: (params = {}, config = {}) => {
    const { noCache, ...axiosConfig } = config || {};
    const keyParams = { ...params };
    if (noCache) {
      return apiClient.get("/food/search/categories/admin", { params: keyParams, ...axiosConfig });
    }
    const key = `search-categories:${stableStringify(keyParams)}`;
    return foodSearchCategoriesCache.getOrCreate(key, () =>
      apiClient.get("/food/search/categories/admin", { params: keyParams, ...axiosConfig }),
    );
  },
};

const createStubAPI = () =>
  new Proxy(
    {},
    {
      get(_, prop) {
        return () => stub();
      },
    },
  );

export default apiClient;
export { API_ENDPOINTS };

// Stub for non-auth endpoints so we don't hit backend for unimplemented routes (avoids 404s and extra calls).
// Auth is done via authAPI/authService which use apiClient directly.
const emptyDataStub = () =>
  Promise.resolve({
    data: { success: false, data: null },
    status: 200,
    statusText: "OK",
    headers: {},
    config: {},
  });

export const api = {
  get: (_url, _config) => emptyDataStub(),
  post: (_url, _data, _config) => emptyDataStub(),
  put: (_url, _data, _config) => emptyDataStub(),
  patch: (_url, _data, _config) => emptyDataStub(),
  delete: (_url, _config) => emptyDataStub(),
};

/** Single in-flight + short cache for user /auth/me - avoids duplicate calls. */
const getUserMeOnce = () => authService.getMe("user");

/** Auth API - user OTP + admin login via new backend */
export const authAPI = {
  sendOTP: (phone, _purpose = "login", _email = null) => {
    if (!phone) return Promise.reject(new Error("Phone is required"));
    return authService.requestUserOtp(phone);
  },
  verifyOTP: (
    phone,
    otp,
    _purpose,
    _name,
    _email,
    _role,
    _password,
    _referralCode,
    fcmToken = null,
    platform = "web",
  ) => {
    if (!phone || !otp)
      return Promise.reject(new Error("Phone and OTP are required"));
    return authService.verifyUserOtp(
      phone,
      otp,
      _referralCode,
      _name,
      fcmToken,
      platform,
    );
  },
  getCurrentUser: () => getUserMeOnce(),
  refreshToken: (token) => authService.refreshToken(token),
  logout: (refreshToken, fcmToken = null, platform = "web") => {
    invalidateUserCartCache();
    const token =
      refreshToken ||
      (typeof localStorage !== "undefined"
        ? localStorage.getItem("user_refreshToken")
        : null);
    return authService.logout(token, fcmToken, platform);
  },
};

export const supportAPI = {
  createTicket: (body) =>
    apiClient.post("/food/user/support/ticket", body ?? {}, {
      contextModule: "user",
    }),
  getMyTickets: (params = {}) =>
    apiClient.get("/food/user/support/my-tickets", {
      params,
      contextModule: "user",
    }),
  getSupportTicketsAdmin: (params = {}) =>
    apiClient.get("/food/admin/support-tickets", {
      params,
      contextModule: "admin",
    }),
  updateSupportTicketAdmin: (id, body = {}) =>
    apiClient.patch(`/food/admin/support-tickets/${String(id)}`, body ?? {}, {
      contextModule: "admin",
    }),
};

export const notificationAPI = {
  getInbox: (params = {}, config = {}) =>
    apiClient.get("/food/notifications/inbox", {
      params,
      ...config,
    }),
  markAsRead: (id, config = {}) =>
    apiClient.patch(`/food/notifications/${String(id)}/read`, {}, config),
  dismiss: (id, config = {}) =>
    apiClient.delete(`/food/notifications/${String(id)}`, config),
  dismissAll: (config = {}) =>
    apiClient.delete("/food/notifications/inbox/all", config),
};

/** Admin API - new backend only (GET /auth/me, PATCH /auth/admin/profile, POST /auth/admin/change-password) */
export const adminAPI = {
  getSidebarBadges: () =>
    apiClient.get("/food/admin/sidebar-badges", { contextModule: "admin" }),
  login: (email, password) => authService.adminLogin(email, password),
  /** POST /auth/admin/forgot-password/request-otp – only accepts registered admin email */
  requestForgotPasswordOtp: (email) =>
    apiClient.post("/auth/admin/forgot-password/request-otp", {
      email: String(email || "")
        .trim()
        .toLowerCase(),
    }),
  /** POST /auth/admin/forgot-password/reset – verify OTP and set new password in one call */
  resetPasswordWithOtp: (email, otp, newPassword) =>
    apiClient.post("/auth/admin/forgot-password/reset", {
      email: String(email || "")
        .trim()
        .toLowerCase(),
      otp: String(otp || "").replace(/\D/g, ""),
      newPassword: String(newPassword || ""),
    }),
  /** Raw /auth/me for admin (e.g. navbar). For Profile & Settings use getAdminProfile. */
  getCurrentAdmin: () => authService.getMe("admin"),
  /** Single API for admin profile: GET /auth/me, returns { data: { admin } }. Use on Profile & Settings only. */
  getAdminProfile: () =>
    authService.getMe("admin").then((res) => {
      const user =
        res?.data?.data?.user ??
        res?.data?.user ??
        res?.data?.data ??
        res?.data;
      return { data: { data: { admin: user }, admin: user } };
    }),
  /** PATCH /auth/admin/profile. Body: name?, phone?, profileImage? */
  updateAdminProfile: (body) =>
    apiClient.patch("/auth/admin/profile", body ?? {}, {
      contextModule: "admin",
    }),
  /** POST /auth/admin/change-password */
  changePassword: (currentPassword, newPassword) =>
    apiClient.post(
      "/auth/admin/change-password",
      { currentPassword, newPassword },
      { contextModule: "admin" },
    ),
  logout: (refreshToken) => {
    const token =
      refreshToken ||
      (typeof localStorage !== "undefined"
        ? localStorage.getItem("admin_refreshToken")
        : null);
    const fcmToken = typeof localStorage !== "undefined" ? localStorage.getItem("fcm_web_registered_token_admin") : null;
    return authService.logout(token, fcmToken, "web");
  },
  // Restaurant approvals and join requests
  getPendingRestaurants: () =>
    apiClient.get("/food/admin/restaurants/pending", {
      contextModule: "admin",
    }),
  /** List restaurant complaints (admin). */
  getRestaurantComplaints: (params = {}) =>
    apiClient.get("/food/admin/restaurants/complaints", {
      params,
      contextModule: "admin",
    }),
  getRestaurantMenuPdfUrl: (id) =>
    apiClient.get(`/food/admin/restaurants/${String(id)}/menu-pdf`, {
      contextModule: "admin",
    }),
  downloadRestaurantMenuPdf: (id) =>
    apiClient.get(`/food/admin/restaurants/${String(id)}/download-menu-pdf`, {
      contextModule: "admin",
      responseType: "blob",
    }),
  updateRestaurantComplaint: (id, body) =>
    apiClient.patch(`/food/admin/restaurants/complaints/${id}`, body, {
      contextModule: "admin",
    }),
  /** Global universal search (admin). */
  globalSearch: (query) =>
    apiClient.get("/food/admin/global-search", {
      params: { query },
      contextModule: "admin",
    }),
  approveRestaurant: (id) =>
    apiClient.patch(
      `/food/admin/restaurants/${id}/approve`,
      {},
      {
        contextModule: "admin",
      },
    ),
  rejectRestaurant: (id, reason) =>
    apiClient.patch(
      `/food/admin/restaurants/${id}/reject`,
      { reason },
      { contextModule: "admin" },
    ),
  /** Delivery partner join requests - uses /food/admin/delivery/* (new backend API) */
  getDeliveryPartnerJoinRequests: (params) =>
    apiClient.get("/food/admin/delivery/join-requests", {
      params,
      contextModule: "admin",
    }),
  /** List approved delivery partners (Deliveryman List page) */
  getDeliveryPartners: (params) =>
    apiClient.get("/food/admin/delivery/partners", {
      params,
      contextModule: "admin",
    }),
  getDeliverymanReviews: (params = {}) =>
    apiClient.get("/food/admin/delivery/reviews", {
      params,
      contextModule: "admin",
    }),
  getContactMessages: (params = {}) =>
    apiClient.get("/food/admin/contact-messages", {
      params,
      contextModule: "admin",
    }),
  /** Dashboard summary stats (admin home) */
  getDashboardStats: (params = {}) =>
    apiClient.get("/food/admin/dashboard-stats", {
      params,
      contextModule: "admin",
    }),
  /** List restaurant withdrawal requests (admin). */
  getWithdrawals: (params = {}) =>
    apiClient.get("/food/admin/withdrawals", {
      params,
      contextModule: "admin",
    }),
  /** Update status of a withdrawal request. */
  updateWithdrawalStatus: (id, body) =>
    apiClient.patch(`/food/admin/withdrawals/${id}`, body, {
      contextModule: "admin",
    }),
  /** List delivery withdrawal requests (admin). */
  getDeliveryWithdrawals: (params = {}) =>
    apiClient.get("/food/admin/delivery/withdrawals", {
      params,
      contextModule: "admin",
    }),
  /** Update status of a delivery withdrawal request. */
  updateDeliveryWithdrawalStatus: (id, body) =>
    apiClient.patch(`/food/admin/delivery/withdrawals/${id}`, body, {
      contextModule: "admin",
    }),
  /** Delivery withdrawal aliases */
  getDeliveryWithdrawalRequests: (params) => adminAPI.getDeliveryWithdrawals(params),
  approveDeliveryWithdrawal: (id) => adminAPI.updateDeliveryWithdrawalStatus(id, { status: "approved" }),
  rejectDeliveryWithdrawal: (id, reason) => adminAPI.updateDeliveryWithdrawalStatus(id, { status: "rejected", rejectionReason: reason }),
  // Aliases for RestaurantWithdraws page
  getWithdrawalRequests: (params) => adminAPI.getWithdrawals(params),
  approveWithdrawalRequest: (id) => adminAPI.updateWithdrawalStatus(id, { status: "approved" }),
  rejectWithdrawalRequest: (id, reason) => adminAPI.updateWithdrawalStatus(id, { status: "rejected", rejectionReason: reason }),
  /** Delivery boy wallets (stub until backend implements - returns empty so list still loads) */
  getDeliveryBoyWallets: (params) =>
    apiClient.get("/food/admin/delivery/wallets", {
      params,
      contextModule: "admin",
    }),
  getDeliveryPartnerById: (id) =>
    apiClient.get(`/food/admin/delivery/${id}`, { contextModule: "admin" }),
  updateDeliveryPartner: (id, body) =>
    apiClient.patch(`/food/admin/delivery/${id}`, body ?? {}, { contextModule: "admin" }),
  getDeliveryBoySettings: (config = {}) => getDeliveryBoySettingsOnce(config),
  updateDeliveryBoySettings: (body) => {
    deliveryBoySettingsCache.clear("settings");
    return apiClient.put('/food/admin/delivery-boy-settings', body ?? {}, { contextModule: "admin" });
  },
  approveDeliveryPartner: (id, service = 'food') =>
    apiClient.patch(
      `/food/admin/delivery/${String(id)}/approve`,
      { service },
      {
        contextModule: "admin",
      },
    ),
  rejectDeliveryPartner: (id, reason, service = 'food') =>
    apiClient.patch(
      `/food/admin/delivery/${String(id)}/reject`,
      { reason: String(reason || "").trim(), service },
      {
        contextModule: "admin",
      },
    ),
  /** GET /food/admin/delivery/support-tickets - list all delivery support tickets (query: status, priority, search, page, limit). */
  getDeliverySupportTickets: (params) =>
    apiClient.get("/food/admin/delivery/support-tickets", {
      params,
      contextModule: "admin",
    }),
  getExpiredFssaiNotifications: (params = {}) =>
    apiClient.get("/food/admin/notifications/fssai-expired", {
      params,
      contextModule: "admin",
    }),
  /** GET /food/admin/delivery/support-tickets/stats - counts by status. */
  getDeliverySupportTicketStats: () =>
    apiClient.get("/food/admin/delivery/support-tickets/stats", {
      contextModule: "admin",
    }),
  /** PATCH /food/admin/delivery/support-tickets/:id - update adminResponse, status. */
  updateDeliverySupportTicket: (id, body) =>
    apiClient.patch(`/food/admin/delivery/support-tickets/${id}`, body ?? {}, {
      contextModule: "admin",
    }),
  createBroadcastNotification: (body = {}) =>
    apiClient.post("/food/admin/notifications/broadcast", body ?? {}, {
      contextModule: "admin",
    }),
  getBroadcastNotifications: (params = {}) =>
    apiClient.get("/food/admin/notifications/broadcast", {
      params,
      contextModule: "admin",
    }),
  deleteBroadcastNotification: (id) =>
    apiClient.delete(`/food/admin/notifications/broadcast/${String(id)}`, {
      contextModule: "admin",
    }),
  /** List restaurants for admin. Requires admin auth. */
  getRestaurants: (params = {}, config = {}) =>
    apiClient.get("/food/admin/restaurants", {
      params: { limit: 1000, ...params },
      contextModule: "admin",
      ...config,
    }),
  getRestaurantReviews: (params = {}) =>
    apiClient.get("/food/admin/restaurants/reviews", {
      params: { page: 1, limit: 1000, ...params },
      contextModule: "admin",
    }),
  /** Categories (admin) */
  getCategories: (params = {}) =>
    apiClient.get("/food/admin/categories", { params, contextModule: "admin" }),
  /** Dining categories (admin) */
  getDiningCategories: (params = {}) =>
    apiClient.get("/food/admin/dining/categories", {
      params,
      contextModule: "admin",
    }),
  createDiningCategory: (body) =>
    apiClient.post("/food/admin/dining/categories", body ?? {}, {
      contextModule: "admin",
    }),
  updateDiningCategory: (id, body) =>
    apiClient.patch(`/food/admin/dining/categories/${String(id)}`, body ?? {}, {
      contextModule: "admin",
    }),
  deleteDiningCategory: (id) =>
    apiClient.delete(`/food/admin/dining/categories/${String(id)}`, {
      contextModule: "admin",
    }),
  getDiningRestaurants: (params = {}) =>
    apiClient.get("/food/admin/dining/restaurants", {
      params,
      contextModule: "admin",
    }),
  updateRestaurantDiningSettings: (restaurantId, body) =>
    apiClient.patch(
      `/food/admin/dining/restaurants/${String(restaurantId)}`,
      body ?? {},
      { contextModule: "admin" },
    ),
  getDiningRequests: (params = {}) =>
    apiClient.get("/food/admin/dining/requests", {
      params,
      contextModule: "admin",
    }),
  approveDiningRequest: (id) =>
    apiClient.patch(`/food/admin/dining/requests/${String(id)}/approve`, {}, {
      contextModule: "admin",
    }),
  rejectDiningRequest: (id, reason) =>
    apiClient.patch(`/food/admin/dining/requests/${String(id)}/reject`, { reason }, {
      contextModule: "admin",
    }),
  createCategory: (body) =>
    apiClient.post("/food/admin/categories", body ?? {}, {
      contextModule: "admin",
    }),
  updateCategory: (id, body) =>
    apiClient.patch(`/food/admin/categories/${id}`, body ?? {}, {
      contextModule: "admin",
    }),
  deleteCategory: (id) =>
    apiClient.delete(`/food/admin/categories/${id}`, {
      contextModule: "admin",
    }),
  approveCategory: (id) =>
    apiClient.patch(
      `/food/admin/categories/${String(id)}/approve`,
      {},
      { contextModule: "admin" },
    ),
  rejectCategory: (id, reason) =>
    apiClient.patch(
      `/food/admin/categories/${String(id)}/reject`,
      { reason: String(reason || "").trim() },
      { contextModule: "admin" },
    ),
  makeCategoryGlobal: (id) =>
    apiClient.patch(
      `/food/admin/categories/${String(id)}/make-global`,
      {},
      { contextModule: "admin" },
    ),
  toggleCategoryStatus: (id) =>
    apiClient.patch(
      `/food/admin/categories/${id}/toggle`,
      {},
      { contextModule: "admin" },
    ),
  /** Get single restaurant by id (full details for View Details modal). */
  getRestaurantById: (id) =>
    apiClient.get(`/food/admin/restaurants/${id}`, { contextModule: "admin" }),
  /** Get restaurant analytics for POS. */
  getRestaurantAnalytics: (id) =>
    apiClient.get(`/food/admin/restaurants/${id}/analytics`, {
      contextModule: "admin",
    }),
  /** Update restaurant basic details (admin). */
  updateRestaurant: (id, body) =>
    apiClient.patch(`/food/admin/restaurants/${String(id)}`, body ?? {}, {
      contextModule: "admin",
    }),
  deleteRestaurant: (id) =>
    apiClient.delete(`/food/admin/restaurants/${id}`, { contextModule: "admin" }),
  /** Update restaurant status (admin). Body: { status: boolean } */
  updateRestaurantStatus: (id, status) =>
    apiClient.patch(
      `/food/admin/restaurants/${String(id)}/status`,
      { status: status !== false },
      { contextModule: "admin" },
    ),
  /** Update restaurant location (admin). Body includes lat/lng + address fields. */
  updateRestaurantLocation: (id, body) =>
    apiClient.patch(
      `/food/admin/restaurants/${String(id)}/location`,
      body ?? {},
      { contextModule: "admin" },
    ),
  /** Restaurant menu (admin) */
  getRestaurantMenuById: (id, config = {}) =>
    apiClient.get(`/food/admin/restaurants/${id}/menu`, {
      contextModule: "admin",
      ...config,
    }),
  updateRestaurantMenuById: (id, body) =>
    apiClient.patch(`/food/admin/restaurants/${id}/menu`, body ?? {}, {
      contextModule: "admin",
    }),
  /** Foods (admin) - separate collection */
  getFoods: (params = {}) =>
    apiClient.get("/food/admin/foods", { params, contextModule: "admin" }),
  createFood: (body) =>
    apiClient.post("/food/admin/foods", body ?? {}, { contextModule: "admin" }),
  updateFood: (id, body) =>
    apiClient.patch(`/food/admin/foods/${id}`, body ?? {}, {
      contextModule: "admin",
    }),
  deleteFood: (id) =>
    apiClient.delete(`/food/admin/foods/${id}`, { contextModule: "admin" }),
  /** Food approvals (admin) - pending items created by restaurants */
  getPendingFoodApprovals: (params = {}) =>
    apiClient.get("/food/admin/foods/pending-approvals", {
      params,
      contextModule: "admin",
    }),
  approveFoodItem: (id) =>
    apiClient.patch(
      `/food/admin/foods/${String(id)}/approve`,
      {},
      { contextModule: "admin" },
    ),
  rejectFoodItem: (id, reason) =>
    apiClient.patch(
      `/food/admin/foods/${String(id)}/reject`,
      { reason: String(reason || "").trim() },
      { contextModule: "admin" },
    ),
  /** Customers (admin) */
  getCustomers: (params = {}) =>
    apiClient.get("/food/admin/customers", { params, contextModule: "admin" }),
  getCustomerById: (id) =>
    apiClient.get(`/food/admin/customers/${String(id)}`, {
      contextModule: "admin",
    }),
  updateCustomerStatus: (id, isActive) =>
    apiClient.patch(
      `/food/admin/customers/${String(id)}/status`,
      { isActive: isActive !== false },
      { contextModule: "admin" },
    ),
  bulkToggleCod: (userIds, status) =>
    apiClient.put("/food/admin/customers/bulk-cod", { userIds, status }, { contextModule: "admin" }),
  /** Orders (admin) – list, get by id, assign delivery partner */
  getOrders: (params = {}) =>
    apiClient.get("/food/admin/orders", {
      params: { limit: 30, page: 1, ...params },
      contextModule: "admin",
    }),
  /** Cancelled orders with refund info (uses orders list API). */
  getRefundRequests: (params = {}) =>
    apiClient.get("/food/admin/orders", {
      params: { limit: 1000, page: 1, status: "cancelled", ...params },
      contextModule: "admin",
    }),
  getOrderById: (orderId) =>
    apiClient.get(`/food/admin/orders/${String(orderId)}`, {
      contextModule: "admin",
    }),
  cancelOrder: (orderId, bodyOrReason = {}) => {
    const body =
      typeof bodyOrReason === "string"
        ? { reason: bodyOrReason }
        : bodyOrReason ?? {};
    return apiClient.patch(
      `/food/admin/orders/${String(orderId)}/cancel`,
      body,
      { contextModule: "admin" },
    );
  },
  /** Drop one restaurant from a multi-restaurant order (partial refund + continue). */
  dropRestaurantFromOrder: (orderId, restaurantId, body = {}) =>
    apiClient.patch(
      `/food/admin/orders/${String(orderId)}/restaurants/${String(restaurantId)}/drop`,
      body ?? {},
      { contextModule: "admin" },
    ),
  getMultiOrderSettlementReport: (params = {}) =>
    apiClient.get("/food/admin/orders/settlement-report", {
      params,
      contextModule: "admin",
    }),
  deleteOrder: (orderId) =>
    apiClient.delete(`/food/admin/orders/${String(orderId)}`, {
      contextModule: "admin",
    }),
  assignDeliveryPartner: (orderId, deliveryPartnerId) =>
    apiClient.patch(
      `/food/admin/orders/${String(orderId)}/assign-delivery`,
      { deliveryPartnerId: String(deliveryPartnerId) },
      { contextModule: "admin" },
    ),
  /** Dispatch settings – auto vs manual assign (global) */
  /** Create restaurant (admin). Single API: POST /food/admin/restaurants. Body: JSON with image URLs. */
  createRestaurant: (body) =>
    apiClient.post("/food/admin/restaurants", body ?? {}, {
      contextModule: "admin",
    }),
  checkRestaurantPhone: (phone) =>
    apiClient.get("/food/admin/restaurants/check-phone", {
      params: { phone },
      contextModule: "admin",
    }),
  checkRestaurantEmail: (email) =>
    apiClient.get("/food/admin/restaurants/check-email", {
      params: { email },
      contextModule: "admin",
    }),
  /** List delivery zones. Query: limit, page, isActive, search */
  getZones: (params = {}) =>
    apiClient.get("/food/admin/zones", {
      params: { limit: 1000, ...params },
      contextModule: "admin",
    }),
  /** Restaurant report (admin). */
  getRestaurantReport: (params = {}) =>
    apiClient.get("/food/admin/reports/restaurants", {
      params: { page: 1, limit: 1000, ...params },
      contextModule: "admin",
    }),
  getTransactionReport: (params = {}) =>
    apiClient.get("/food/admin/reports/transactions", {
      params: { page: 1, limit: 1000, ...params },
      contextModule: "admin",
    }),
  getTaxReport: (params = {}) =>
    apiClient.get("/food/admin/reports/tax", {
      params: { page: 1, limit: 1000, ...params },
      contextModule: "admin",
    }),
  getTaxReportDetail: (id, params = {}) =>
    apiClient.get(`/food/admin/reports/tax/${id}`, {
      params,
      contextModule: "admin",
    }),
  /** Get single zone by id */
  getZoneById: (id) =>
    apiClient.get(`/food/admin/zones/${id}`, { contextModule: "admin" }),
  /** Create zone. Body: name, zoneName?, country?, unit?, coordinates, isActive? */
  createZone: (body) =>
    apiClient.post("/food/admin/zones", body ?? {}, { contextModule: "admin" }),
  /** Update zone. Body: name?, zoneName?, country?, unit?, coordinates?, isActive? */
  updateZone: (id, body) =>
    apiClient.patch(`/food/admin/zones/${id}`, body ?? {}, {
      contextModule: "admin",
    }),
  /** Delete zone */
  deleteZone: (id) =>
    apiClient.delete(`/food/admin/zones/${id}`, { contextModule: "admin" }),

  /** Feedback Experience (admin) */
  getFeedbackExperiences: (params = {}) =>
    apiClient.get(API_ENDPOINTS.ADMIN.FEEDBACK_EXPERIENCE, {
      params,
      contextModule: "admin",
    }),
  deleteFeedbackExperience: (id) =>
    apiClient.delete(`${API_ENDPOINTS.ADMIN.FEEDBACK_EXPERIENCE}/${id}`, {
      contextModule: "admin",
    }),

  /** Public env variables (safe subset). Used for runtime keys like Google Maps. */
  // getPublicEnvVariables removed: rely on import.meta.env instead.

  /** Public categories (user app) - zone-aware */
  getPublicCategories: (params = {}, config = {}) =>
    apiClient.get("/food/restaurant/categories/public", {
      ...config,
      params: params ?? {},
      contextModule: "user",
    }),

  /** Offers & Coupons (admin) */
  getAllOffers: (params = {}) =>
    apiClient.get("/food/admin/offers", { params, contextModule: "admin" }),
  createAdminOffer: (body) =>
    apiClient.post("/food/admin/offers", body ?? {}, {
      contextModule: "admin",
    }),
  updateAdminOffer: (offerId, body) =>
    apiClient.patch(`/food/admin/offers/${String(offerId)}`, body ?? {}, {
      contextModule: "admin",
    }),
  updateAdminOfferCartVisibility: (offerId, itemId, showInCart) =>
    apiClient.patch(
      `/food/admin/offers/${String(offerId)}/cart-visibility`,
      { itemId: String(itemId), showInCart: Boolean(showInCart) },
      { contextModule: "admin" },
    ),
  deleteAdminOffer: (offerId) =>
    apiClient.delete(`/food/admin/offers/${String(offerId)}`, {
      contextModule: "admin",
    }),
  approveAdminOffer: (offerId) =>
    apiClient.patch(`/food/admin/offers/${String(offerId)}/approve`, {}, {
      contextModule: "admin",
    }),
  rejectAdminOffer: (offerId, reason) =>
    apiClient.patch(`/food/admin/offers/${String(offerId)}/reject`, { reason }, {
      contextModule: "admin",
    }),
  getAdminOfferAnalytics: (offerId) =>
    apiClient.get(`/food/admin/offers/${String(offerId)}/analytics`, {
      contextModule: "admin",
    }),
  getAdminOfferUsageHistory: (offerId, params = {}) =>
    apiClient.get(`/food/admin/offers/${String(offerId)}/history`, {
      params,
      contextModule: "admin",
    }),

  /** Delivery Partner Bonus (admin) */
  getDeliveryPartnerBonusTransactions: (params = {}) =>
    apiClient.get("/food/admin/delivery/bonus-transactions", {
      params,
      contextModule: "admin",
    }),
  /** Delivery Earnings (admin) */
  getDeliveryEarnings: (params = {}) =>
    apiClient.get("/food/admin/delivery/earnings", {
      params,
      contextModule: "admin",
    }),
  getAdminRevenue: (params = {}) =>
    apiClient.get("/food/admin/revenue", {
      params,
      contextModule: "admin",
    }),
  getAdminRevenueOrder: (orderId) =>
    apiClient.get(`/food/admin/revenue/${encodeURIComponent(String(orderId || ""))}`, {
      contextModule: "admin",
    }),
  getDeliverySalaryEarnings: (params = {}) =>
    apiClient.get("/food/admin/delivery/salary-earnings", {
      params,
      contextModule: "admin",
    }),
  getDeliverySalaryPayments: (id, params = {}) =>
    apiClient.get(`/food/admin/delivery/${String(id)}/salary-payments`, {
      params,
      contextModule: "admin",
    }),
  markDeliverySalaryPaid: (body) =>
    apiClient.post("/food/admin/delivery/salary-payments", body ?? {}, {
      contextModule: "admin",
    }),
  addDeliveryPartnerBonus: (deliveryPartnerId, amount, reference = "") =>
    apiClient.post(
      "/food/admin/delivery/bonus",
      {
        deliveryPartnerId: String(deliveryPartnerId),
        amount: Number(amount),
        reference: String(reference || ""),
      },
      { contextModule: "admin" },
    ),

  /** Earning Addon Offers (admin) */
  getEarningAddons: (params = {}) =>
    apiClient.get("/food/admin/delivery/earning-addons", {
      params,
      contextModule: "admin",
    }),
  createEarningAddon: (body) =>
    apiClient.post("/food/admin/delivery/earning-addons", body ?? {}, {
      contextModule: "admin",
    }),
  updateEarningAddon: (id, body) =>
    apiClient.patch(
      `/food/admin/delivery/earning-addons/${String(id)}`,
      body ?? {},
      { contextModule: "admin" },
    ),
  deleteEarningAddon: (id) =>
    apiClient.delete(`/food/admin/delivery/earning-addons/${String(id)}`, {
      contextModule: "admin",
    }),
  toggleEarningAddonStatus: (id, status) =>
    apiClient.patch(
      `/food/admin/delivery/earning-addons/${String(id)}/status`,
      { status: String(status) },
      { contextModule: "admin" },
    ),

  /** Earning Addon History (admin) */
  getEarningAddonHistory: (params = {}) =>
    apiClient.get("/food/admin/delivery/earning-addon-history", {
      params,
      contextModule: "admin",
    }),
  creditEarningToWallet: (historyId, notes = "") =>
    apiClient.post(
      `/food/admin/delivery/earning-addon-history/${String(historyId)}/credit`,
      { notes: String(notes || "") },
      { contextModule: "admin" },
    ),
  cancelEarningAddonHistory: (historyId, reason = "") =>
    apiClient.post(
      `/food/admin/delivery/earning-addon-history/${String(historyId)}/cancel`,
      { reason: String(reason || "") },
      { contextModule: "admin" },
    ),
  checkEarningAddonCompletions: (deliveryPartnerId, force = false) =>
    apiClient.post(
      "/food/admin/delivery/earning-addon-completions/check",
      { deliveryPartnerId: String(deliveryPartnerId), force: Boolean(force) },
      { contextModule: "admin" },
    ),
  getDeliveryWallets: (params = {}) =>
    apiClient.get("/food/admin/delivery/wallets", {
      params,
      contextModule: "admin",
    }),
  getDeliveryWithdrawals: (params = {}) =>
    apiClient.get("/food/admin/delivery/withdrawals", {
      params,
      contextModule: "admin",
    }),
  updateDeliveryWithdrawalStatus: (id, body) =>
    apiClient.patch(`/food/admin/delivery/withdrawals/${String(id)}`, body, {
      contextModule: "admin",
    }),

  /** Restaurant Commission (admin) */
  getRestaurantCommissionBootstrap: () =>
    apiClient.get("/food/admin/restaurant-commissions/bootstrap", {
      contextModule: "admin",
    }),
  getRestaurantCommissions: (params = {}) =>
    apiClient.get("/food/admin/restaurant-commissions", {
      params,
      contextModule: "admin",
    }),
  getRestaurantCommissionById: (id) =>
    apiClient.get(`/food/admin/restaurant-commissions/${String(id)}`, {
      contextModule: "admin",
    }),
  createRestaurantCommission: (body) =>
    apiClient.post("/food/admin/restaurant-commissions", body ?? {}, {
      contextModule: "admin",
    }),
  updateRestaurantCommission: (id, body) =>
    apiClient.patch(
      `/food/admin/restaurant-commissions/${String(id)}`,
      body ?? {},
      { contextModule: "admin" },
    ),
  deleteRestaurantCommission: (id) =>
    apiClient.delete(`/food/admin/restaurant-commissions/${String(id)}`, {
      contextModule: "admin",
    }),
  toggleRestaurantCommissionStatus: (id) =>
    apiClient.patch(
      `/food/admin/restaurant-commissions/${String(id)}/toggle`,
      {},
      { contextModule: "admin" },
    ),
  /** Backward-compatible alias used in UI */
  getApprovedRestaurants: (params = {}) =>
    apiClient.get("/food/admin/restaurants", {
      params: { status: "approved", limit: 1000, ...params },
      contextModule: "admin",
    }),

  /** Delivery Boy Commission Rules (admin) */
  getCommissionRules: () =>
    apiClient.get("/food/admin/delivery/commission-rules", {
      contextModule: "admin",
    }),
  createCommissionRule: (body) =>
    apiClient.post("/food/admin/delivery/commission-rules", body ?? {}, {
      contextModule: "admin",
    }),
  updateCommissionRule: (id, body) =>
    apiClient.patch(
      `/food/admin/delivery/commission-rules/${String(id)}`,
      body ?? {},
      { contextModule: "admin" },
    ),
  deleteCommissionRule: (id) =>
    apiClient.delete(`/food/admin/delivery/commission-rules/${String(id)}`, {
      contextModule: "admin",
    }),
  toggleCommissionRuleStatus: (id, status) =>
    apiClient.patch(
      `/food/admin/delivery/commission-rules/${String(id)}/status`,
      { status: Boolean(status) },
      { contextModule: "admin" },
    ),

  /** Fee Settings (admin) */
  getFeeSettings: () =>
    apiClient.get("/food/admin/fee-settings", { contextModule: "admin" }),
  getPublicFeeSettings: (config = {}) =>
    apiClient.get("/food/admin/fee-settings/public", config),
  createOrUpdateFeeSettings: (body) =>
    apiClient.put("/food/admin/fee-settings", body ?? {}, {
      contextModule: "admin",
    }),

  /** Referral Settings (admin) */
  getReferralSettings: () =>
    apiClient.get("/food/admin/referral-settings", { contextModule: "admin" }),
  createOrUpdateReferralSettings: (body) =>
    apiClient.put("/food/admin/referral-settings", body ?? {}, {
      contextModule: "admin",
    }),

  /** Safety / Emergency Reports (admin) */
  getSafetyEmergencyReports: (params) =>
    apiClient.get("/food/admin/safety-emergency-reports", {
      params: params ?? {},
      contextModule: "admin",
    }),
  updateSafetyEmergencyStatus: (id, status) =>
    apiClient.put(
      `/food/admin/safety-emergency-reports/${String(id)}/status`,
      { status: String(status) },
      { contextModule: "admin" },
    ),
  updateSafetyEmergencyPriority: (id, priority) =>
    apiClient.put(
      `/food/admin/safety-emergency-reports/${String(id)}/priority`,
      { priority: String(priority) },
      { contextModule: "admin" },
    ),
  deleteSafetyEmergencyReport: (id) =>
    apiClient.delete(`/food/admin/safety-emergency-reports/${String(id)}`, {
      contextModule: "admin",
    }),

  /** Delivery Emergency Help (admin) */
  getEmergencyHelp: () =>
    apiClient.get("/food/admin/delivery-emergency-help", {
      contextModule: "admin",
    }),
  createOrUpdateEmergencyHelp: (body) =>
    apiClient.put("/food/admin/delivery-emergency-help", body ?? {}, {
      contextModule: "admin",
    }),

  /** Restaurant add-ons approval (admin) */
  getRestaurantAddons: (params = {}) =>
    apiClient.get("/food/admin/addons", {
      params: params ?? {},
      contextModule: "admin",
    }),
  updateRestaurantAddon: (id, body) =>
    apiClient.patch(
      `/food/admin/addons/${String(id)}`,
      body ?? {},
      { contextModule: "admin" },
    ),
  approveRestaurantAddon: (id) =>
    apiClient.patch(
      `/food/admin/addons/${String(id)}/approve`,
      {},
      { contextModule: "admin" },
    ),
  rejectRestaurantAddon: (id, reason) =>
    apiClient.patch(
      `/food/admin/addons/${String(id)}/reject`,
      { reason: String(reason || "").trim() },
      { contextModule: "admin" },
    ),
  /** Business Settings (admin) */
  getBusinessSettings: () =>
    apiClient.get(API_ENDPOINTS.ADMIN.BUSINESS_SETTINGS, {
      contextModule: "admin",
    }),
  updateBusinessSettings: (data, files = {}) => {
    const formData = new FormData();
    // Add JSON data
    formData.append("data", JSON.stringify(data));
    // Add files
    if (files.logo) formData.append("logo", files.logo);
    if (files.favicon) formData.append("favicon", files.favicon);

    return apiClient.patch(API_ENDPOINTS.ADMIN.BUSINESS_SETTINGS, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      contextModule: "admin",
    });
  },
};

/** Restaurant API - OTP login via new backend; no email/password. */
export const restaurantAPI = {
  sendOTP: (phone, _purpose = "login") => {
    if (!phone) return Promise.reject(new Error("Phone is required"));
    return authService.requestRestaurantOtp(phone);
  },
  verifyOTP: (phone, otp, _purpose, _name, _email, fcmToken = null, platform = "web") => {
    if (!phone || !otp)
      return Promise.reject(new Error("Phone and OTP are required"));
    return authService.verifyRestaurantOtp(phone, otp, fcmToken, platform);
  },
  getMe: () => authService.getMe("restaurant"),
  /** Restaurant dashboard: fetch current restaurant profile (deduped + short-cached). */
  getCurrentRestaurant: () => getRestaurantCurrentOnce(),
  /** Onboarding progress from database. */
  getOnboardingProgress: () => getRestaurantOnboardingOnce(),
  saveOnboardingStep: (step, formData) => {
    invalidateRestaurantSessionCache();
    return apiClient.put(`/food/restaurant/onboarding/step/${step}`, formData, {
      contextModule: "restaurant",
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  submitOnboarding: (formData) => {
    invalidateRestaurantSessionCache();
    return apiClient.post("/food/restaurant/onboarding/submit", formData, {
      contextModule: "restaurant",
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  /** Finance dashboard for `hub-finance`. */
  getFinance: (params = {}) =>
    apiClient.get("/food/restaurant/finance", {
      contextModule: "restaurant",
      params: params || {},
    }),
  /** Fetch restaurant by owner (stub for missing backend endpoint). */
  getRestaurantByOwner: () =>
    Promise.resolve({
      data: {
        success: true,
        data: {
          restaurant: {
            name: "Your Restaurant",
            restaurantId: "REST000001",
            address: "Your address",
          },
        },
      },
    }),
  /** Submit a real withdrawal request to the backend. */
  createWithdrawalRequest: (amount) =>
    apiClient.post("/food/restaurant/withdraw", { amount: Number(amount) }, {
      contextModule: "restaurant"
    }),
  /** List withdrawal history for current restaurant. */
  getWithdrawalHistory: () =>
    apiClient.get("/food/restaurant/withdrawals", {
      contextModule: "restaurant"
    }),
  /** Update restaurant profile fields (name/cuisines/location/menuImages). */
  updateProfile: (body) =>
    apiClient
      .patch("/food/restaurant/profile", body ?? {}, {
        contextModule: "restaurant",
      })
      .then((res) => {
        restaurantSessionCache.current = res;
        return res;
      }),
  updateDiningSettings: (body) =>
    apiClient
      .patch("/food/restaurant/dining-settings", body ?? {}, {
        contextModule: "restaurant",
      })
      .then((res) => {
        restaurantSessionCache.current = res;
        return res;
      }),
  requestDiningUpdate: (body) =>
    apiClient.post("/food/restaurant/dining-settings/request", body ?? {}, {
      contextModule: "restaurant",
    }),
  getPendingDiningRequest: () =>
    apiClient.get("/food/restaurant/dining-settings/pending", {
      contextModule: "restaurant",
    }),
  /** PATCH /food/restaurant/availability. Body: { isAcceptingOrders: boolean } */
  updateAcceptingOrders: (isAcceptingOrders) =>
    apiClient
      .patch(
        "/food/restaurant/availability",
        { isAcceptingOrders: Boolean(isAcceptingOrders) },
        { contextModule: "restaurant" },
      )
      .then((res) => {
        restaurantSessionCache.current = res;
        return res;
      }),
  /** Upload and set restaurant profile image (multipart). Field name: file */
  uploadProfileImage: (file) => {
    if (!file) return Promise.reject(new Error("File is required"));
    const formData = new FormData();
    formData.append("file", file);
    return apiClient.post("/food/restaurant/profile/profile-image", formData, {
      contextModule: "restaurant",
    });
  },
  /** Upload a menu/cover image (multipart). Does not auto-attach; use updateProfile(menuImages) after. */
  uploadMenuImage: (file) => {
    if (!file) return Promise.reject(new Error("File is required"));
    const formData = new FormData();
    formData.append("file", file);
    return apiClient.post("/food/restaurant/profile/menu-image", formData, {
      contextModule: "restaurant",
    });
  },
  uploadCoverImages: (files = []) => {
    const normalizedFiles = Array.from(files || []).filter(Boolean);
    if (normalizedFiles.length === 0) {
      return Promise.reject(new Error("At least one file is required"));
    }
    const formData = new FormData();
    normalizedFiles.forEach((file) => formData.append("files", file));
    return apiClient.post("/food/restaurant/profile/cover-images", formData, {
      contextModule: "restaurant",
    });
  },
  uploadMenuImages: (files = []) => {
    const normalizedFiles = Array.from(files || []).filter(Boolean);
    if (normalizedFiles.length === 0) {
      return Promise.reject(new Error("At least one file is required"));
    }
    const formData = new FormData();
    normalizedFiles.forEach((file) => formData.append("files", file));
    return apiClient.post("/food/restaurant/profile/menu-images", formData, {
      contextModule: "restaurant",
    });
  },
  /** Public Offers for users (global/selected restaurant) */
  getPublicOffers: () =>
    apiClient.get("/food/restaurant/offers", { contextModule: "user" }),
  getRestaurantPageOffers: (restaurantId) =>
    apiClient.get(`/food/restaurant/restaurants/${String(restaurantId)}/offers`, {
      contextModule: "user",
    }),
  getDeliverySpeedOptions: (config = {}) =>
    apiClient.get("/food/restaurant/delivery-speed-options", {
      ...config,
      contextModule: "user",
    }),
  getPublicCheckoutSettings: (config = {}) =>
    apiClient.get("/food/restaurant/checkout-settings/public", {
      ...config,
      contextModule: "user",
    }),
  /** Backward-compat helper used by Cart: returns coupons array for an item by adapting public offers */
  getCouponsByItemIdPublic: (restaurantIds, _itemId) =>
    apiClient.get("/food/restaurant/offers", { contextModule: "user" }).then((res) => {
      const list = res?.data?.data?.allOffers || res?.data?.allOffers || [];
      const idList = Array.isArray(restaurantIds)
        ? restaurantIds.map((id) => String(id || "")).filter(Boolean)
        : [String(restaurantIds || "")].filter(Boolean);
      const now = Date.now();
      const coupons = list
        .filter((o) => o.showInCart !== false)
        .filter((o) => {
          if (String(o?.restaurantScope) === "selected") {
            if (!idList.length) return false;
            return idList.includes(String(o.restaurantId || ""));
          }
          return true;
        })
        .map((o) => {
          const isFreeDel = o.couponCategory === "free_delivery" || o.isFreeDelivery
          if (isFreeDel) {
            return {
              couponCode: o.couponCode,
              code: o.couponCode,
              discountType: "free_delivery",
              discountPercentage: 0,
              discount: 0,
              discountValue: 0,
              originalPrice: 0,
              discountedPrice: 0,
              minOrderValue: Number(o.minOrderValue || 0),
              minOrder: Number(o.minOrderValue || 0),
              maxDiscount: null,
              customerGroup: o.customerScope === "first-time" ? "new" : "all",
              customerScope: o.customerScope || "all",
              isGlobalCoupon: o.restaurantScope !== "selected",
              restaurantScope: o.restaurantScope || "all",
              restaurantId: o.restaurantId || null,
              createdBy: o.createdBy || "admin",
              couponCategory: "free_delivery",
              isFreeDelivery: true,
              freeDelivery: true,
              discountDisplay: "FREE DELIVERY",
              sourceLabel: o.createdBy === "restaurant" ? "Restaurant" : "Platform",
              endDate: o.endDate || null,
              showInCart: o.showInCart !== false,
              _ts: now,
            };
          }
          const isPct = o.discountType === "percentage";
          return {
            couponCode: o.couponCode,
            code: o.couponCode,
            discountType: o.discountType,
            discountPercentage: isPct ? Number(o.discountValue) || 0 : 0,
            discount: isPct ? 0 : Number(o.discountValue) || 0,
            discountValue: Number(o.discountValue) || 0,
            originalPrice: 0,
            discountedPrice: 0,
            minOrderValue: Number(o.minOrderValue || 0),
            minOrder: Number(o.minOrderValue || 0),
            maxDiscount: o.maxDiscount != null ? Number(o.maxDiscount) : null,
            customerGroup: o.customerScope === "first-time" ? "new" : "all",
            customerScope: o.customerScope || "all",
            isGlobalCoupon: o.restaurantScope !== "selected",
            restaurantScope: o.restaurantScope || "all",
            restaurantId: o.restaurantId || null,
            createdBy: o.createdBy || "admin",
            couponCategory: o.couponCategory || "normal",
            isFreeDelivery: o.couponCategory === "free_delivery",
            sourceLabel: o.createdBy === "restaurant" ? "Restaurant" : "Platform",
            endDate: o.endDate || null,
            showInCart: o.showInCart !== false,
            _ts: now,
          };
        });
      return { data: { success: true, data: { coupons } } };
    }),
  getMyOffers: () =>
    apiClient.get("/food/restaurant/my-offers", { contextModule: "restaurant" }),
  createMyOffer: (body) =>
    apiClient.post("/food/restaurant/my-offers", body ?? {}, {
      contextModule: "restaurant",
    }),
  updateMyOffer: (offerId, body) =>
    apiClient.patch(`/food/restaurant/my-offers/${String(offerId)}`, body ?? {}, {
      contextModule: "restaurant",
    }),
  reapplyMyOffer: (offerId) =>
    apiClient.patch(`/food/restaurant/my-offers/${String(offerId)}/reapply`, {}, {
      contextModule: "restaurant",
    }),
  deleteMyOffer: (offerId) =>
    apiClient.delete(`/food/restaurant/my-offers/${String(offerId)}`, {
      contextModule: "restaurant",
    }),
  getMyOfferAnalytics: (offerId) =>
    apiClient.get(`/food/restaurant/my-offers/${String(offerId)}/analytics`, {
      contextModule: "restaurant",
    }),
  getMyOfferUsageHistory: (offerId, params = {}) =>
    apiClient.get(`/food/restaurant/my-offers/${String(offerId)}/history`, {
      params,
      contextModule: "restaurant",
    }),
  /** Categories (restaurant dashboard) */
  getCategories: (params = {}) =>
    // Compact payload for item creation forms (id + name only).
    apiClient.get("/food/restaurant/categories", {
      params: { compact: true, limit: 1000, ...params },
      contextModule: "restaurant",
    }),
  // For MenuCategoriesPage compatibility
  getAllCategories: (params = {}) =>
    apiClient.get("/food/restaurant/categories", {
      params: {
        includeInactive: true,
        withCounts: true,
        ...params,
      },
      contextModule: "restaurant",
    }),
  createCategory: (body) =>
    apiClient.post("/food/restaurant/categories", body ?? {}, {
      contextModule: "restaurant",
    }),
  updateCategory: (id, body) =>
    apiClient.patch(`/food/restaurant/categories/${String(id)}`, body ?? {}, {
      contextModule: "restaurant",
    }),
  deleteCategory: (id) =>
    apiClient.delete(`/food/restaurant/categories/${String(id)}`, {
      contextModule: "restaurant",
    }),
  /** Menu (restaurant dashboard) */
  getMenu: (params = {}) =>
    apiClient.get("/food/restaurant/menu", {
      params,
      contextModule: "restaurant",
    }),
  /** Orders (restaurant dashboard) */
  getOrders: (params = {}) =>
    apiClient.get("/food/restaurant/orders", {
      params: { limit: 50, page: 1, ...params },
      contextModule: "restaurant",
    }),
  getOrderById: (orderId) =>
    apiClient.get(`/food/restaurant/orders/${String(orderId)}`, {
      contextModule: "restaurant",
    }),
  updateMenu: (body) =>
    apiClient.patch("/food/restaurant/menu", body ?? {}, {
      contextModule: "restaurant",
    }),
  saveFcmToken: (token, platform = "web") => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    const path =
      platform === "mobile" ? "/fcm-tokens/mobile/save" : "/fcm-tokens/save";
    return apiClient.post(
      path,
      { token: String(token), platform },
      { contextModule: "restaurant" },
    );
  },
  removeFcmToken: (token, platform = "web") => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    return apiClient.delete(
      `/fcm-tokens/remove/${encodeURIComponent(String(token))}`,
      {
        data: { token: String(token), platform },
        contextModule: "restaurant",
      },
    );
  },
  /** Outlet timings (restaurant dashboard) */
  getOutletTimings: () =>
    apiClient.get("/food/restaurant/outlet-timings", {
      contextModule: "restaurant",
    }),
  saveOutletTimings: (outletTimings) =>
    apiClient.put(
      "/food/restaurant/outlet-timings",
      { outletTimings: outletTimings || {} },
      { contextModule: "restaurant" },
    ),
  /** Foods (restaurant) - stored in food_items collection */
  createFood: (body) =>
    apiClient.post("/food/restaurant/foods", body ?? {}, {
      contextModule: "restaurant",
    }),
  updateFood: (id, body) =>
    apiClient.patch(`/food/restaurant/foods/${String(id)}`, body ?? {}, {
      contextModule: "restaurant",
    }),
  deleteFood: (id) =>
    apiClient.delete(`/food/restaurant/foods/${String(id)}`, {
      contextModule: "restaurant",
    }),
  /** Orders (restaurant dashboard) */
  getOrders: (() => {
    // Single-flight de-dupe to avoid duplicate GETs in React StrictMode / double-mount.
    let inFlight = null;
    let inFlightKey = "";
    let cache = null;
    let cacheKey = "";
    let cacheAt = 0;
    const CACHE_MS = 800;

    const buildKey = (p = {}) => JSON.stringify({ limit: 50, page: 1, ...p });

    return (params = {}) => {
      const key = buildKey(params);
      const now = Date.now();

      if (cache && cacheKey === key && now - cacheAt < CACHE_MS) {
        return Promise.resolve(cache);
      }

      if (inFlight && inFlightKey === key) return inFlight;

      inFlightKey = key;
      inFlight = apiClient
        .get("/food/restaurant/orders", {
          params: { limit: 50, page: 1, ...params },
          contextModule: "restaurant",
        })
        .then((res) => {
          // Backend paginated shape: { data: { data: [...], meta: {...} } }
          // Normalize to { data: { data: { orders: [...], meta } } } for restaurant UI pages.
          const payload = res?.data?.data || {};
          const rowsRaw = Array.isArray(payload.data) ? payload.data : [];

          // Normalize backend order fields to match existing restaurant UI expectations.
          // UI historically uses: order.status, order.address, order.total, order.paymentMethod
          const normalizeStatus = (s, order) => {
            // Terminal order status must win over pickup status.
            // Backend keeps myPickupStatus="picked_up" even after delivered, which
            // previously made delivered orders appear as "Out for delivery".
            const orderStatus = String(
              s ||
                order?.orderStatus ||
                order?.aggregateOrderStatus ||
                order?.status ||
                "",
            ).toLowerCase();

            if (
              orderStatus === "delivered" ||
              orderStatus === "completed"
            ) {
              return "delivered";
            }
            if (orderStatus.includes("cancel")) return "cancelled";
            if (orderStatus === "rejected") return "rejected";

            // Prefer this restaurant's own pickup status when present (multi-restaurant)
            const pickupStatus = String(
              order?.myPickupStatus
              || order?.pickups?.[0]?.status
              || "",
            ).toLowerCase();
            if (pickupStatus === "pending") return "confirmed"; // awaiting restaurant accept
            if (pickupStatus === "accepted") return "confirmed";
            if (pickupStatus === "preparing") return "preparing";
            if (pickupStatus === "ready" || pickupStatus === "ready_for_handover") return "ready";
            if (pickupStatus === "picked_up") return "out_for_delivery";
            if (pickupStatus === "cancelled") return "cancelled";

            // Backend: created -> treat as confirmed/new in UI
            if (orderStatus === "created") return "confirmed";
            // Backend: ready_for_pickup -> ready
            if (orderStatus === "ready_for_pickup") return "ready";
            // Backend: picked_up / reached_drop -> out_for_delivery
            if (
              orderStatus === "picked_up" ||
              orderStatus === "reached_drop" ||
              orderStatus === "reached_pickup" ||
              orderStatus === "out_for_delivery" ||
              orderStatus === "out-for-delivery"
            ) {
              return "out_for_delivery";
            }
            return orderStatus || "confirmed";
          };

          const rows = rowsRaw.map((o) => {
            const status = normalizeStatus(o.orderStatus || o.status, o);
            const address = o.deliveryAddress || o.address;
            const total = o.pricing?.total ?? o.total ?? 0;
            const paymentMethod = o.payment?.method || o.paymentMethod || null;
            return { ...o, status, address, total, paymentMethod };
          });
          const meta = payload.meta || payload.pagination || {};
          const normalized = {
            ...res,
            data: {
              ...res.data,
              data: { orders: rows, meta, pagination: meta },
            },
          };

          cache = normalized;
          cacheKey = key;
          cacheAt = Date.now();
          return normalized;
        })
        .finally(() => {
          inFlight = null;
          inFlightKey = "";
        });

      return inFlight;
    };
  })(),
  updateOrderStatus: (orderId, body) => {
    const raw = body ?? {};
    const outgoing = { ...raw };

    // Translate UI-friendly statuses to backend enum values.
    const normalizeOutgoingStatus = (s) => {
      const v = String(s || "")
        .toLowerCase()
        .trim();
      if (!v) return v;
      if (v === "ready") return "ready_for_pickup";
      if (v === "out_for_delivery") return "picked_up";
      if (v === "cancelled") return "cancelled_by_restaurant";
      return v;
    };

    if (outgoing.orderStatus) {
      outgoing.orderStatus = normalizeOutgoingStatus(outgoing.orderStatus);
    }

    return apiClient.patch(
      `/food/restaurant/orders/${String(orderId)}/status`,
      outgoing,
      { contextModule: "restaurant" },
    );
  },
  /**
   * Accept an incoming order (restaurant).
   * UI expects this to move order into "preparing" bucket.
   * Backend supports PATCH /food/restaurant/orders/:orderId/status with { orderStatus }.
   */
  acceptOrder: async (orderId, _prepTimeMins = null) => {
    try {
      return await restaurantAPI.updateOrderStatus(orderId, {
        orderStatus: "preparing",
      });
    } catch (error) {
      const statusCode = Number(error?.response?.status || 0);
      if (statusCode === 400) {
        // Compatibility fallback: some backends treat "confirmed" as accept action.
        return restaurantAPI.updateOrderStatus(orderId, {
          orderStatus: "confirmed",
        });
      }
      throw error;
    }
  },
  /**
   * Reject/cancel order by restaurant.
   * Backend orderStatus enum: cancelled_by_restaurant.
   */
  rejectOrder: (orderId, reason = "") =>
    restaurantAPI.updateOrderStatus(orderId, {
      orderStatus: "cancelled_by_restaurant",
      note: reason,
    }),
  /** Mark order ready (restaurant handoff). */
  markOrderReady: (orderId) =>
    restaurantAPI.updateOrderStatus(orderId, {
      orderStatus: "ready_for_pickup",
    }),
  /**
   * Get a single order by id for restaurant screens.
   * Prefer direct endpoint; fallback to list+filter for backward compatibility.
   */
  getOrderById: async (orderId) => {
    return await apiClient.get(`/food/restaurant/orders/${String(orderId)}`, {
      contextModule: "restaurant",
    });
  },
  /** Add-ons (restaurant) - approval handled by admin */
  getAddons: (params = {}) =>
    apiClient.get("/food/restaurant/addons", {
      // Backend validator enforces limit <= 100
      params: { limit: 100, page: 1, ...params },
      contextModule: "restaurant",
    }),
  addAddon: (body) =>
    apiClient.post("/food/restaurant/addons", body ?? {}, {
      contextModule: "restaurant",
    }),
  updateAddon: (id, body) =>
    apiClient.patch(`/food/restaurant/addons/${String(id)}`, body ?? {}, {
      contextModule: "restaurant",
    }),
  deleteAddon: (id) =>
    apiClient.delete(`/food/restaurant/addons/${String(id)}`, {
      contextModule: "restaurant",
    }),
  logout: (refreshToken) => {
    invalidateRestaurantSessionCache();
    const token =
      refreshToken ||
      (typeof localStorage !== "undefined"
        ? localStorage.getItem("restaurant_refreshToken")
        : null);
    const fcmToken = typeof localStorage !== "undefined" ? localStorage.getItem("fcm_web_registered_token_restaurant") : null;
    return authService.logout(token, fcmToken, "web");
  },
  /** Backend has no email/password login; use phone OTP only. */
  login: (_email, _password) =>
    Promise.reject(new Error("Please use phone number and OTP to sign in.")),
  /**
   * Register a restaurant (multipart FormData).
   * Backend: POST /v1/food/restaurant/register (path relative to baseURL /api/v1)
   */
  register: (formData) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(new Error("FormData is required"));
    }
    return apiClient.post("/food/restaurant/register", formData);
  },
  /** Public: list approved restaurants for user app */
  getRestaurants: (params = {}, config = {}) =>
    getPublicRestaurantsOnce(params, config),
  /** Public: get single approved restaurant by id or slug */
  getRestaurantById: (id, config = {}) => getPublicRestaurantDetailOnce(id, config),
  /** Public: get approved menu by restaurant id or slug */
  getMenuByRestaurantId: (id, config = {}) =>
    getPublicRestaurantMenuOnce(id, config),
  /** Public: get outlet timings by restaurant id */
  getOutletTimingsByRestaurantId: (id, config = {}) =>
    getPublicRestaurantOutletTimingsOnce(id, config),
  /** Public (user app): approved add-ons by restaurant id/slug */
  getAddonsByRestaurantId: (id, config = {}) =>
    apiClient.get(`/food/restaurant/restaurants/${String(id)}/addons`, {
      ...config,
    }),
  getPublicOffers: (params = {}, config = {}) =>
    apiClient.get("/food/restaurant/offers", { params, ...config }),
  /** Resend delivery notification (restaurant dashboard) */
  resendDeliveryNotification: (orderId) =>
    apiClient.post(`/food/restaurant/orders/${String(orderId)}/resend-notification`, {}, {
      contextModule: "restaurant",
    }),
  /** List restaurant complaints (for current restaurant dashboard) */
  getComplaints: (params = {}) =>
    apiClient.get("/food/restaurant/complaints", {
      params,
      contextModule: "restaurant",
    }),
  /** Restaurant support tickets */
  createSupportTicket: (body = {}) =>
    apiClient.post("/food/restaurant/support/tickets", body ?? {}, {
      contextModule: "restaurant",
    }),
  getSupportTickets: (params = {}) =>
    apiClient.get("/food/restaurant/support/tickets", {
      params,
      contextModule: "restaurant",
    }),
  /** DELETE /food/restaurant/account - permanently delete restaurant account */
  deleteAccount: () =>
    apiClient.delete("/food/restaurant/account", { contextModule: "restaurant" }),
};

// Public user-app endpoints can be called by multiple components/effects on refresh (and React StrictMode in dev).
// A small in-flight + short TTL cache collapses duplicate requests without changing functionality.
const publicRestaurantsCache = createInFlightCache({ ttlMs: 5 * 60 * 1000 });
const publicRestaurantMenuCache = createInFlightCache({ ttlMs: 5 * 60 * 1000 });
const publicRestaurantOutletTimingsCache = createInFlightCache({ ttlMs: 5 * 60 * 1000 });
const publicRestaurantDetailCache = createInFlightCache({ ttlMs: 5 * 60 * 1000 });
const publicBusinessSettingsCache = createInFlightCache({ ttlMs: 5 * 60 * 1000 });
const deliveryBoySettingsCache = createInFlightCache({ ttlMs: 5 * 60 * 1000 });
const userCartCache = createInFlightCache({ ttlMs: 15 * 1000 });
const publicGenericGetCache = createInFlightCache({ ttlMs: 3000 });

export const invalidatePublicBusinessSettingsCache = () => {
  publicBusinessSettingsCache.clear("public");
};

export const getPublicBusinessSettingsOnce = (config = {}) => {
  const { noCache } = config || {};
  if (noCache) {
    return apiClient.get(API_ENDPOINTS.ADMIN.BUSINESS_SETTINGS_PUBLIC);
  }
  return publicBusinessSettingsCache.getOrCreate("public", () =>
    apiClient.get(API_ENDPOINTS.ADMIN.BUSINESS_SETTINGS_PUBLIC),
  );
};

const getDeliveryBoySettingsOnce = (config = {}) => {
  const { noCache } = config || {};
  if (noCache) {
    return apiClient.get("/food/admin/delivery-boy-settings", {
      contextModule: "admin",
    });
  }
  return deliveryBoySettingsCache.getOrCreate("settings", () =>
    apiClient.get("/food/admin/delivery-boy-settings", {
      contextModule: "admin",
    }),
  );
};

export const invalidateUserCartCache = () => {
  userCartCache.clear("cart");
};

const getPublicRestaurantDetailOnce = (id, config = {}) => {
  const safeId = resolveEntityId(id) || String(id || "").trim();
  const { noCache, params, ...axiosConfig } = config || {};
  if (!safeId || safeId === "[object Object]") {
    return Promise.resolve({
      data: { success: false, data: null },
      status: 200,
      statusText: "OK",
      headers: {},
      config: {},
    });
  }
  // Round to ~111m so nearby GPS jitter still hits the in-flight cache.
  const keyParams = { ...params };
  if (keyParams.lat != null && Number.isFinite(Number(keyParams.lat))) {
    keyParams.lat = Math.round(Number(keyParams.lat) * 1000) / 1000;
  }
  if (keyParams.lng != null && Number.isFinite(Number(keyParams.lng))) {
    keyParams.lng = Math.round(Number(keyParams.lng) * 1000) / 1000;
  }
  if (noCache) {
    return apiClient.get(`/food/restaurant/restaurants/${safeId}`, {
      params: keyParams,
      ...axiosConfig,
    });
  }
  const key = `detail:${safeId}:${stableStringify(keyParams)}`;
  return publicRestaurantDetailCache.getOrCreate(key, () =>
    apiClient.get(`/food/restaurant/restaurants/${safeId}`, {
      params: keyParams,
      ...axiosConfig,
    }),
  );
};

export const publicGetOnce = (url, config = {}) => {
  const safeUrl = typeof url === "string" ? url.trim() : "";
  const { noCache, params, ...axiosConfig } = config || {};
  if (!safeUrl) return Promise.reject(new Error("url is required"));

  if (noCache) {
    return apiClient.get(safeUrl, { params, ...axiosConfig });
  }

  const keyParams =
    params && typeof params === "object" ? { ...params } : params;
  if (keyParams && typeof keyParams === "object") {
    // `_ts` is used as a cache-buster in some call sites; ignore it for dedupe purposes.
    delete keyParams._ts;
  }

  const key = `GET:${safeUrl}:${stableStringify(keyParams)}`;
  return publicGenericGetCache.getOrCreate(key, () =>
    apiClient.get(safeUrl, { params, ...axiosConfig }),
  );
};

const getPublicRestaurantsOnce = (params = {}, config = {}) => {
  const { noCache, ...axiosConfig } = config || {};
  const scopeHome = String(params.scope || "").toLowerCase() === "home";
  const maxLimit = scopeHome ? 15 : 100;
  const defaultLimit = scopeHome ? 12 : 20;
  const keyParams = { page: 1, limit: defaultLimit, ...params };
  delete keyParams._ts;
  if (keyParams.page != null) {
    keyParams.page = Math.max(1, parseInt(keyParams.page, 10) || 1);
  }
  if (keyParams.limit != null) {
    keyParams.limit = Math.min(
      Math.max(parseInt(keyParams.limit, 10) || defaultLimit, 1),
      maxLimit,
    );
  }
  if (keyParams.lat != null && Number.isFinite(Number(keyParams.lat))) {
    keyParams.lat = Math.round(Number(keyParams.lat) * 1000) / 1000;
  }
  if (keyParams.lng != null && Number.isFinite(Number(keyParams.lng))) {
    keyParams.lng = Math.round(Number(keyParams.lng) * 1000) / 1000;
  }
  if (noCache) {
    return apiClient.get("/food/restaurant/restaurants", {
      params: keyParams,
      ...axiosConfig,
    });
  }
  const key = `restaurants:${stableStringify(keyParams)}`;
  return publicRestaurantsCache.getOrCreate(key, () =>
    apiClient.get("/food/restaurant/restaurants", {
      params: keyParams,
      ...axiosConfig,
    }),
  );
};

const getPublicRestaurantMenuOnce = (id, config = {}) => {
  const safeId = resolveEntityId(id) || String(id || "").trim();
  const { noCache, params, ...axiosConfig } = config || {};
  if (!safeId || safeId === "[object Object]") {
    return Promise.resolve({
      data: { success: false, data: null },
      status: 200,
      statusText: "OK",
      headers: {},
      config: {},
    });
  }
  const requestParams = params && typeof params === "object" ? params : undefined;
  if (noCache) {
    return apiClient.get(`/food/restaurant/restaurants/${safeId}/menu`, {
      params: requestParams,
      ...axiosConfig,
    });
  }
  const key = `menu:${safeId}:${stableStringify(requestParams || { page: 1 })}`;
  return publicRestaurantMenuCache.getOrCreate(key, () =>
    apiClient.get(`/food/restaurant/restaurants/${safeId}/menu`, {
      params: requestParams,
      ...axiosConfig,
    }),
  );
};

const getPublicRestaurantOutletTimingsOnce = (id, config = {}) => {
  const safeId = String(id || "").trim();
  const { noCache, ...axiosConfig } = config || {};
  if (!safeId) {
    return Promise.resolve({
      data: { success: false, data: null },
      status: 200,
      statusText: "OK",
      headers: {},
      config: {},
    });
  }
  if (noCache) {
    return apiClient.get(
      `/food/restaurant/restaurants/${safeId}/outlet-timings`,
      { ...axiosConfig },
    );
  }
  const key = `outletTimings:${safeId}`;
  return publicRestaurantOutletTimingsCache.getOrCreate(key, () =>
    apiClient.get(`/food/restaurant/restaurants/${safeId}/outlet-timings`, {
      ...axiosConfig,
    }),
  );
};

/** Session cache for restaurant /food/restaurant/current and /onboarding — one fetch per login. */
/** Cached public landing/zone reads for Food user app. */
export const landingAPI = {
  getHeroBannersPublic: (config = {}) =>
    publicGetOnce("/food/hero-banners/public", config),
  getUnder250BannersPublic: (config = {}) =>
    publicGetOnce("/food/hero-banners/under-250/public", config),
  getDiningBannersPublic: (config = {}) =>
    publicGetOnce("/food/hero-banners/dining/public", config),
  getGourmetPublic: (config = {}) =>
    publicGetOnce("/food/hero-banners/gourmet/public", config),
  getExploreIconsPublic: (config = {}) =>
    publicGetOnce("/food/explore-icons/public", config),
  getLandingSettingsPublic: (config = {}) =>
    publicGetOnce("/food/landing/settings/public", config),
};

export const pageAPI = {
  getPublic: (key, config = {}) =>
    publicGetOnce(`/food/pages/${String(key || "").trim().toLowerCase()}`, config),
};

const publicZonesCache = createInFlightCache({ ttlMs: 5 * 60 * 1000 });

/** Single in-flight + short cache for restaurant /food/restaurant/current - prevents request storms. */
let restaurantCurrentInFlight = null;
let restaurantCurrentCached = null;
let restaurantCurrentCacheTime = 0;
const RESTAURANT_CURRENT_CACHE_MS = 3000;

const getRestaurantCurrentOnce = () => {
  if (restaurantSessionCache.current) {
    return Promise.resolve(restaurantSessionCache.current);
  }
  if (!restaurantSessionCache.currentInFlight) {
    restaurantSessionCache.currentInFlight = apiClient
      .get("/food/restaurant/current", { contextModule: "restaurant" })
      .then((res) => {
        restaurantSessionCache.current = res;
        return res;
      })
      .finally(() => {
        restaurantSessionCache.currentInFlight = null;
      });
  }
  return restaurantSessionCache.currentInFlight;
};

const getRestaurantOnboardingOnce = () => {
  if (restaurantSessionCache.onboarding) {
    return Promise.resolve(restaurantSessionCache.onboarding);
  }
  if (!restaurantSessionCache.onboardingInFlight) {
    restaurantSessionCache.onboardingInFlight = apiClient
      .get("/food/restaurant/onboarding", { contextModule: "restaurant" })
      .then((res) => {
        restaurantSessionCache.onboarding = res;
        return res;
      })
      .finally(() => {
        restaurantSessionCache.onboardingInFlight = null;
      });
  }
  return restaurantSessionCache.onboardingInFlight;
};

export { invalidateRestaurantSessionCache };

/** Single in-flight + short cache for delivery /auth/me - one call per page load / refresh. */
let deliveryMeInFlight = null;
let deliveryMeCached = null;
let deliveryMeCacheTime = 0;
const DELIVERY_ME_CACHE_MS = 3000;

const getDeliveryMeOnce = () => {
  const now = Date.now();
  if (deliveryMeCached && now - deliveryMeCacheTime < DELIVERY_ME_CACHE_MS) {
    return Promise.resolve(deliveryMeCached);
  }
  if (!deliveryMeInFlight) {
    deliveryMeInFlight = authService
      .getMe("delivery")
      .then((res) => {
        deliveryMeCached = res;
        deliveryMeCacheTime = Date.now();
        return res;
      })
      .finally(() => {
        deliveryMeInFlight = null;
      });
  }
  return deliveryMeInFlight;
};

/** Delivery API - OTP login + registration via new backend. */
export const deliveryAPI = {
  sendOTP: (phone, _purpose = "login") => {
    if (!phone) return Promise.reject(new Error("Phone is required"));
    return authService.requestDeliveryOtp(phone);
  },
  verifyOTP: (phone, otp, _purpose, _name, fcmToken = null, platform = "web") => {
    if (!phone || !otp)
      return Promise.reject(new Error("Phone and OTP are required"));
    return authService.verifyDeliveryOtp(phone, otp, fcmToken, platform);
  },
  getMe: () => getDeliveryMeOnce(),
  /** Get delivery profile (same as getMe under the hood; maps response to profile shape). */
  getProfile: () =>
    getDeliveryMeOnce().then((res) => ({
      ...res,
      data: {
        ...res.data,
        data: { profile: res.data?.data?.user ?? res.data?.data },
      },
    })),
  getReferralStats: () =>
    apiClient.get("/food/delivery/referrals/stats", {
      contextModule: "delivery",
    }),
  logout: (refreshToken) => {
    deliveryMeCached = null;
    deliveryMeCacheTime = 0;
    try {
      localStorage.removeItem("app:isOnline");
    } catch (_) { }
    const token =
      refreshToken ||
      (typeof localStorage !== "undefined"
        ? localStorage.getItem("delivery_refreshToken")
        : null);
    const fcmToken = typeof localStorage !== "undefined" ? localStorage.getItem("fcm_web_registered_token_delivery") : null;
    return authService.logout(token, fcmToken, "web");
  },
  /** POST /food/delivery/register - multipart FormData (new partner, no token). */
  register: (formData) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(
        new Error("FormData with details and document files is required"),
      );
    }
    return apiClient.post("/food/delivery/register", formData);
  },
  /** PATCH /food/delivery/profile - complete profile after OTP (Bearer token required). */
  completeProfile: (formData) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(
        new Error("FormData with details and document files is required"),
      );
    }
    return apiClient.patch("/food/delivery/profile", formData, {
      contextModule: "delivery",
    });
  },
  /** PATCH /food/delivery/profile/details - JSON updates (vehicle number, etc). */
  updateProfileDetails: (payload) =>
    apiClient.patch("/food/delivery/profile/details", payload ?? {}, {
      contextModule: "delivery",
    }),
  /** PATCH /food/delivery/profile - multipart updates for photos/documents (uses same endpoint). */
  updateProfileMultipart: (formData) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(new Error("FormData is required"));
    }
    return apiClient.patch("/food/delivery/profile", formData, {
      contextModule: "delivery",
    });
  },
  /** POST /food/delivery/profile/photo-base64 - Flutter in-app camera base64 upload. */
  updateProfilePhotoBase64: (payload) =>
    apiClient.post("/food/delivery/profile/photo-base64", payload ?? {}, {
      contextModule: "delivery",
    }),
  /** PATCH /food/delivery/profile/bank-details - update bank details + PAN (JSON, Bearer required). */
  updateProfile: (payload) =>
    apiClient.patch("/food/delivery/profile/bank-details", payload ?? {}, {
      contextModule: "delivery",
    }),
  /** PATCH /food/delivery/profile/bank-details - multipart updates for bank details + UPI QR (FormData required). */
  updateBankDetailsMultipart: (formData) => {
    if (!formData || !(formData instanceof FormData)) {
      return Promise.reject(new Error("FormData is required"));
    }
    return apiClient.patch("/food/delivery/profile/bank-details", formData, {
      contextModule: "delivery",
    });
  },
  saveFcmToken: (token, platform = "web") => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    const path =
      platform === "mobile" ? "/fcm-tokens/mobile/save" : "/fcm-tokens/save";
    return apiClient.post(
      path,
      { token: String(token), platform },
      { contextModule: "delivery" },
    );
  },
  removeFcmToken: (token, platform = "web") => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    return apiClient.delete(
      `/fcm-tokens/remove/${encodeURIComponent(String(token))}`,
      {
        data: { token: String(token), platform },
        contextModule: "delivery",
      },
    );
  },
  /** GET /food/delivery/support-tickets - list tickets for logged-in delivery partner. */
  getSupportTickets: () =>
    apiClient.get("/food/delivery/support-tickets", {
      contextModule: "delivery",
    }),
  /** POST /food/delivery/support-tickets - create ticket (body: subject, description, category?, priority?). */
  createSupportTicket: (body) =>
    apiClient.post("/food/delivery/support-tickets", body ?? {}, {
      contextModule: "delivery",
    }),
  /** GET /food/delivery/support-tickets/:id - get one ticket (own only). */
  getSupportTicketById: (id) =>
    apiClient.get(`/food/delivery/support-tickets/${id}`, {
      contextModule: "delivery",
    }),
  /** PATCH /food/delivery/availability - set online/offline (and optional lat/lng). */
  updateOnlineStatus: (isOnline) =>
    apiClient.patch(
      "/food/delivery/availability",
      { status: isOnline ? "online" : "offline" },
      { contextModule: "delivery" },
    ),
  updateLocation: (latitude, longitude, isOnline, extras = {}) =>
    apiClient.patch(
      "/food/delivery/availability",
      { status: isOnline ? "online" : "offline", latitude, longitude, ...extras },
      { contextModule: "delivery" },
    ),
  /** Orders */
  getOrders: (() => {
    // Collapse duplicate list fetches triggered by multiple effects + StrictMode.
    let inFlight = new Map(); // key -> Promise
    let cache = new Map(); // key -> { at, res }
    const CACHE_MS = 2500;

    const stableKey = (p = {}) => {
      const safe = p && typeof p === "object" ? { ...p } : {};
      // Ensure stable ordering + defaults.
      const normalized = { limit: 50, page: 1, ...safe };
      // Remove cache-busters if any.
      delete normalized._ts;
      return JSON.stringify(
        Object.keys(normalized)
          .sort()
          .reduce((acc, k) => {
            acc[k] = normalized[k];
            return acc;
          }, {}),
      );
    };

    return (params = {}) => {
      const key = stableKey(params);
      const now = Date.now();
      const cached = cache.get(key);
      if (cached && now - cached.at < CACHE_MS)
        return Promise.resolve(cached.res);

      const existing = inFlight.get(key);
      if (existing) return existing;

      const p = apiClient
        .get("/food/delivery/orders/available", {
          params: { limit: 50, page: 1, ...params },
          contextModule: "delivery",
        })
        // One rider, both verticals: show open Quick Commerce offers in the same list.
        // Food's own list is never dropped — QC is appended, and a QC failure is ignored.
        .then(async (res) => {
          try {
            const qcRes = await apiClient.get("/quick-commerce/delivery/orders/available", {
              contextModule: "delivery",
            });
            const quickOrders = qcRes?.data?.data?.orders || [];
            if (quickOrders.length && res?.data?.data) {
              const foodOrders = res.data.data.orders || [];
              res.data.data.orders = [...quickOrders, ...foodOrders];
            }
          } catch {
            // Quick Commerce is optional for a rider.
          }
          return res;
        })
        .then((res) => {
          cache.set(key, { at: Date.now(), res });
          return res;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, p);
      return p;
    };
  })(),
  getOrderDetails: (() => {
    // Collapse duplicate calls coming from multiple effects (and React StrictMode in dev).
    let inFlight = new Map(); // key -> Promise
    let cache = new Map(); // key -> { at, res }
    const CACHE_MS = 1200;

    const isProbablyOrderIdentity = (value) => {
      const raw = String(value || "").trim();
      if (!raw) return false;
      // Mongo ObjectId
      return /^[a-f0-9]{24}$/i.test(raw);
    };

    return (orderId) => {
      const key = String(orderId || "").trim();
      if (!isProbablyOrderIdentity(key)) {
        return Promise.resolve({
          data: { success: false, message: "Invalid order id", data: null },
          status: 200,
          statusText: "OK",
          headers: {},
          config: {},
        });
      }

      const now = Date.now();
      const cached = cache.get(key);
      if (cached && now - cached.at < CACHE_MS)
        return Promise.resolve(cached.res);

      const existing = inFlight.get(key);
      if (existing) return existing;

      const p = apiClient
        .get(`/food/delivery/orders/${key}`, { contextModule: "delivery" })
        .then((res) => {
          cache.set(key, { at: Date.now(), res });
          return res;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, p);
      return p;
    };
  })(),
  /**
   * GET /food/delivery/current - fallback for some UI hooks.
   *
   * A rider runs one trip at a time and the same account serves both verticals, so when Food
   * reports no active trip we check Quick Commerce before answering "idle". Food's own answer
   * is never modified — if a food trip exists it is returned untouched.
   */
  getCurrentDelivery: async () => {
    const foodRes = await apiClient.get("/food/delivery/orders/current", { contextModule: "delivery" });
    const data = foodRes?.data?.data;
    const foodTrip = data && Object.prototype.hasOwnProperty.call(data, "activeOrder") ? data.activeOrder : data;
    if (foodTrip && (foodTrip._id || foodTrip.orderId || foodTrip.order_id)) return foodRes;

    try {
      const qcRes = await apiClient.get("/quick-commerce/delivery/orders/current", {
        contextModule: "delivery",
      });
      const quickTrip = (qcRes?.data?.data?.orders || [])[0];
      if (!quickTrip) return foodRes;
      return { ...qcRes, data: { ...qcRes.data, data: { activeOrder: quickTrip } } };
    } catch {
      // Quick Commerce is optional for a rider; never let it break the food trip sync.
      return foodRes;
    }
  },
  /**
   * GET /food/delivery/orders/active - every trip the rider is running right now.
   *
   * Order stacking lets a rider hold more than one accepted order (default 2) and deliver them
   * together, so this returns a list plus the rider's remaining capacity. Quick Commerce jobs
   * are appended because the same rider serves both verticals and they share one limit; a QC
   * failure is ignored so it can never break the food trip sync.
   *
   * Resolves to `{ activeOrders, capacity }`.
   */
  getActiveDeliveries: async () => {
    const foodRes = await apiClient.get("/food/delivery/orders/active", {
      contextModule: "delivery",
    });
    const foodData = foodRes?.data?.data || {};
    const activeOrders = Array.isArray(foodData.activeOrders) ? foodData.activeOrders : [];
    const capacity = foodData.capacity || null;

    let quickOrders = [];
    try {
      const qcRes = await apiClient.get("/quick-commerce/delivery/orders/current", {
        contextModule: "delivery",
      });
      quickOrders = qcRes?.data?.data?.orders || [];
    } catch {
      // Quick Commerce is optional for a rider.
    }

    return { activeOrders: [...activeOrders, ...quickOrders], capacity };
  },
  acceptOrder: (orderId, body = {}) =>
    apiClient.patch(
      `/food/delivery/orders/${String(orderId)}/accept`,
      body ?? {},
      {
        contextModule: "delivery",
      },
    ),
  /** Set visit order for remaining multi-restaurant pickups after accept. */
  setPickupSequence: (orderId, restaurantIds = []) =>
    apiClient.patch(
      `/food/delivery/orders/${String(orderId)}/pickup-sequence`,
      { restaurantIds },
      { contextModule: "delivery" },
    ),
  acceptSharedOrder: (orderId) =>
    apiClient.post(
      `/food/delivery/orders/${String(orderId)}/accept-share`,
      {},
      {
        contextModule: "delivery",
      },
    ),
  rejectOrder: (orderId, body = {}) =>
    apiClient.patch(
      `/food/delivery/orders/${String(orderId)}/reject`,
      body ?? {},
      {
        contextModule: "delivery",
      },
    ),
  /**
   * PATCH /food/delivery/orders/:orderId/reached-pickup
   * Marks "reached pickup" (arrival at restaurant) in backend order deliveryState.
   */
  confirmReachedPickup: (orderId) =>
    apiClient.patch(
      `/food/delivery/orders/${String(orderId)}/reached-pickup`,
      {},
      { contextModule: "delivery" },
    ),
  /**
   * Confirm order ID and upload bill image (Picked Up slide).
   * Backend endpoint: PATCH /food/delivery/orders/:id/confirm-pickup
   */
  confirmOrderId: (orderId, confirmedOrderId, location = {}, data = {}) =>
    apiClient.patch(
      `/food/delivery/orders/${String(orderId)}/confirm-pickup`,
      {
        confirmedOrderId,
        latitude: location.lat,
        longitude: location.lng,
        billImageUrl: data.billImageUrl,
      },
      {
        contextModule: "delivery",
      },
    ),
  confirmReachedDrop: (orderId) =>
    apiClient.patch(
      `/food/delivery/orders/${String(orderId)}/reached-drop`,
      {},
      {
        contextModule: "delivery",
      },
    ),
  verifyDropOtp: (orderId, otp) =>
    apiClient.post(
      `/food/delivery/orders/${String(orderId)}/verify-drop-otp`,
      { otp: String(otp) },
      {
        contextModule: "delivery",
      },
    ),
  /** POST /food/delivery/orders/:orderId/collect/qr - create Razorpay payment link (COD collection) */
  createCollectQr: (orderId, body = {}) =>
    apiClient.post(
      `/food/delivery/orders/${String(orderId)}/collect/qr`,
      body ?? {},
      {
        contextModule: "delivery",
      },
    ),
  /** GET /food/delivery/orders/:orderId/payment-status - check COD/QR payment status */
  getPaymentStatus: (orderId) =>
    apiClient.get(`/food/delivery/orders/${String(orderId)}/payment-status`, {
      contextModule: "delivery",
    }),
  completeDelivery: (orderId, body = {}) => {
    // Backward-compatible: older UI calls completeDelivery(orderId, rating, review)
    // where rating is a number (sent as raw JSON like "3"). Normalize to an object.
    let payload = body ?? {};
    if (
      typeof payload === "number" ||
      typeof payload === "string" ||
      payload == null
    ) {
      payload = { rating: payload == null ? null : Number(payload) };
    }
    return apiClient.patch(
      `/food/delivery/orders/${String(orderId)}/complete`,
      payload,
      {
        contextModule: "delivery",
      },
    );
  },
  updateOrderStatus: (orderId, body = {}) =>
    apiClient.patch(
      `/food/delivery/orders/${String(orderId)}/status`,
      body ?? {},
      {
        contextModule: "delivery",
      },
    ),
  /** Registration Re-verification */
  reverify: () =>
    apiClient.post(
      "/food/delivery/reverify",
      {},
      { contextModule: "delivery" },
    ),
  /** GET /food/delivery/wallet - wallet for Pocket/requests page (backend) */
  getWallet: () =>
    apiClient.get("/food/delivery/wallet", { contextModule: "delivery" }),
  /** GET /food/delivery/earnings - earnings summary for Pocket/requests page */
  getEarnings: (params) =>
    apiClient.get("/food/delivery/earnings", {
      params: params ?? {},
      contextModule: "delivery",
    }),
  /** Earning Addons (Hotspots/Bonus) */
  getActiveEarningAddons: () =>
    apiClient.get("/food/delivery/earning-addons/active", {
      contextModule: "delivery",
    }),
  /** GET /food/delivery/trip-history - completed/cancelled/pending trips for delivery partner */
  getTripHistory: (params) =>
    apiClient.get("/food/delivery/trip-history", {
      params: params ?? {},
      contextModule: "delivery",
    }),
  /** GET /food/delivery/pocket-details - single-call week details (trips + transactions) */
  getPocketDetails: (params) =>
    apiClient.get("/food/delivery/pocket-details", {
      params: params ?? {},
      contextModule: "delivery",
    }),
  /** GET /food/delivery/emergency-help - admin-set emergency numbers for delivery partner */
  getEmergencyHelp: () =>
    apiClient.get("/food/delivery/emergency-help", {
      contextModule: "delivery",
    }),
  /** GET /food/delivery/cash-limit - admin-set cash limit for delivery partner */
  getCashLimit: () =>
    apiClient.get("/food/delivery/cash-limit", {
      contextModule: "delivery",
    }),
  createWithdrawalRequest: (body) =>
    apiClient.post("/food/delivery/wallet/withdraw", body ?? {}, {
      contextModule: "delivery"
    }),
  createDepositOrder: (amount) =>
    apiClient.post("/food/delivery/wallet/deposit/order", { amount }, {
      contextModule: "delivery"
    }),
  verifyDepositPayment: (body) =>
    apiClient.post("/food/delivery/wallet/deposit/verify", body ?? {}, {
      contextModule: "delivery"
    }),
  /** Wallet transactions - from wallet response (no separate backend endpoint) */
  getWalletTransactions: (params) =>
    apiClient
      .get("/food/delivery/wallet", {
        params: params ?? {},
        contextModule: "delivery",
      })
      .then((res) => ({
        ...res,
        data: {
          ...res.data,
          data: {
            transactions: res?.data?.data?.wallet?.transactions ?? [],
          },
        },
      })),
  /** Zone discovery */
  getZonesInRadius: (lat, lng, radiusKm = 10) =>
    apiClient.get("/food/zones/nearby", {
      params: { lat, lng, radius: radiusKm },
      contextModule: "delivery",
    }),
  /** DELETE /food/delivery/account - permanently delete delivery partner account */
  deleteAccount: () =>
    apiClient.delete("/food/delivery/account", { contextModule: "delivery" }),
  shareOrder: (orderId) =>
    apiClient.post(`/food/delivery/orders/${String(orderId)}/share`, {}, {
      contextModule: "delivery",
    }),
  acceptSharedOrder: (orderId) =>
    apiClient.post(`/food/delivery/orders/${String(orderId)}/accept-share`, {}, {
      contextModule: "delivery",
    }),
  confirmSplit: (orderId) =>
    apiClient.patch(`/food/delivery/orders/${String(orderId)}/confirm-split`, {}, {
      contextModule: "delivery",
    }),
  reportDelay: (orderId, reason) =>
    apiClient.post(`/food/delivery/orders/${String(orderId)}/delay`, { reason }, {
      contextModule: "delivery",
    }),
};

export const userAPI = {
  /** Get aggregated master profile (Bearer USER). */
  getMasterProfile: () =>
    apiClient.get("/profile/master", { contextModule: "user" }),
  /** Get current user profile (Bearer USER). */
  getProfile: () =>

    getUserMeOnce().then((res) => {
      const user =
        res?.data?.data?.user ??
        res?.data?.user ??
        res?.data?.data ??
        res?.data;
      return { ...res, data: { ...res.data, data: { user } } };
    }),
  /** PATCH /food/user/profile (Bearer USER) */
  updateProfile: (body) =>
    apiClient.patch("/food/user/profile", body ?? {}, {
      contextModule: "user",
    }),
  /** Upload and set user profile image (multipart). Field name: file */
  uploadProfileImage: (file) => {
    if (!file) return Promise.reject(new Error("File is required"));
    const formData = new FormData();
    formData.append("file", file);
    return apiClient.post("/food/user/profile/profile-image", formData, {
      contextModule: "user",
    });
  },
  /** GET /food/user/wallet (Bearer USER). Deduped + short-cached. */
  getWallet: (() => {
    let inFlight = null;
    let cached = null;
    let cacheTime = 0;
    const CACHE_MS = 3000;
    return () => {
      const now = Date.now();
      if (cached && now - cacheTime < CACHE_MS) return Promise.resolve(cached);
      if (!inFlight) {
        inFlight = apiClient
          .get("/food/user/wallet", { contextModule: "user" })
          .then((res) => {
            cached = res;
            cacheTime = Date.now();
            return res;
          })
          .finally(() => {
            inFlight = null;
          });
      }
      return inFlight;
    };
  })(),
  /** GET /food/user/referrals/stats (Bearer USER) */
  getReferralStats: () =>
    apiClient.get("/food/user/referrals/stats", { contextModule: "user" }),
  /** GET /food/user/referrals/details (Bearer USER) */
  getReferralDetails: () =>
    apiClient.get("/food/user/referrals/details", { contextModule: "user" }),
  /** POST /food/user/wallet/topup/order (Bearer USER). Body: { amount } */
  createWalletTopupOrder: (amount) =>
    apiClient.post(
      "/food/user/wallet/topup/order",
      { amount: Number(amount) },
      { contextModule: "user" },
    ),
  /** POST /food/user/wallet/topup/verify (Bearer USER) */
  verifyWalletTopupPayment: (body) =>
    apiClient.post("/food/user/wallet/topup/verify", body ?? {}, {
      contextModule: "user",
    }),
  /** GET /food/user/cart (Bearer USER) */
  getCart: (config = {}) => {
    const { force = false } = config || {};
    if (force) {
      invalidateUserCartCache();
    }
    return userCartCache.getOrCreate("cart", () =>
      apiClient.get("/food/user/cart", { contextModule: "user" }),
    );
  },
  /** PUT /food/user/cart (Bearer USER) */
  syncCart: (body) => {
    invalidateUserCartCache();
    return apiClient.put("/food/user/cart", body ?? {}, { contextModule: "user" });
  },
  /** POST /food/user/cart/validate-restaurants (Bearer USER) */
  validateCartRestaurants: (body) =>
    apiClient.post("/food/user/cart/validate-restaurants", body ?? {}, {
      contextModule: "user",
    }),
  /** GET /food/user/addresses (Bearer USER). Deduped + short-cached. */
  getAddresses: (() => {
    let inFlight = null;
    let cached = null;
    let cacheTime = 0;
    const CACHE_MS = 3000;
    return () => {
      const now = Date.now();
      if (cached && now - cacheTime < CACHE_MS) return Promise.resolve(cached);
      if (!inFlight) {
        inFlight = apiClient
          .get("/food/user/addresses", { contextModule: "user" })
          .then((res) => {
            cached = res;
            cacheTime = Date.now();
            return res;
          })
          .finally(() => {
            inFlight = null;
          });
      }
      return inFlight;
    };
  })(),
  /** POST /food/user/addresses (Bearer USER) */
  addAddress: (body) =>
    apiClient.post("/food/user/addresses", body ?? {}, {
      contextModule: "user",
    }),
  /** PATCH /food/user/addresses/:id (Bearer USER) */
  updateAddress: (id, body) =>
    apiClient.patch(`/food/user/addresses/${String(id)}`, body ?? {}, {
      contextModule: "user",
    }),
  /** DELETE /food/user/addresses/:id (Bearer USER) */
  deleteAddress: (id) =>
    apiClient.delete(`/food/user/addresses/${String(id)}`, {
      contextModule: "user",
    }),
  /** PATCH /food/user/addresses/:id/default (Bearer USER) */
  setDefaultAddress: (id) =>
    apiClient.patch(
      `/food/user/addresses/${String(id)}/default`,
      {},
      { contextModule: "user" },
    ),
  /** POST /food/user/safety-emergency-reports (Bearer USER) */
  createSafetyEmergencyReport: (message) =>
    apiClient.post(
      "/food/user/safety-emergency-reports",
      { message: String(message || "") },
      { contextModule: "user" },
    ),
  /** GET /food/user/safety-emergency-reports (Bearer USER) */
  getMySafetyEmergencyReports: (params) =>
    apiClient.get("/food/user/safety-emergency-reports", {
      params: params ?? {},
      contextModule: "user",
    }),
  /**
   * POST /food/user/location (Bearer USER) - persists the raw "current
   * location" GPS ping (independent of any saved address) to the backend.
   */
  updateLocation: (payload) =>
    apiClient.post("/food/user/location", payload, { contextModule: "user" }),
  saveFcmToken: (token, options = {}) => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    const platform = options?.platform === "mobile" ? "mobile" : "web";
    const path =
      platform === "mobile" ? "/fcm-tokens/mobile/save" : "/fcm-tokens/save";
    return apiClient.post(
      path,
      { token: String(token), platform },
      { contextModule: "user" },
    );
  },
  removeFcmToken: (token, options = {}) => {
    if (!token) return Promise.reject(new Error("FCM token is required"));
    const platform = options?.platform === "mobile" ? "mobile" : "web";
    return apiClient.delete(
      `/fcm-tokens/remove/${encodeURIComponent(String(token))}`,
      {
        data: { token: String(token), platform },
        contextModule: "user",
      },
    );
  },
  testFcmNotification: (options = {}) => {
    const platform = options?.platform === "mobile" ? "mobile" : "web";
    return apiClient.post("/fcm-tokens/test", { platform }, { contextModule: "user" });
  },
  /** DELETE /food/user/account - permanently delete user account */
  deleteAccount: () =>
    apiClient.delete("/food/user/account", { contextModule: "user" }),
};
export const locationAPI = {
  /**
   * GET /location/reverse-geocode?lat=&lng= - shared endpoint (any
   * authenticated actor). Backend does the Google Geocode API call + caching
   * server-side so the API key is never exposed to the browser.
   * Response shape: { lat, lng, formattedAddress, addressLine1, area, city, state, pincode, country, placeId }
   */
  reverseGeocode: (lat, lng) =>
    apiClient.get("/location/reverse-geocode", { params: { lat, lng } }),
};
export const zoneAPI = {
  /** Public: detect active service zone for a lat/lng point. */
  detectZone: (lat, lng, config = {}) => {
    const { noCache, ...axiosConfig } = config || {};
    const params = {
      lat: Number.isFinite(Number(lat)) ? Math.round(Number(lat) * 1000) / 1000 : lat,
      lng: Number.isFinite(Number(lng)) ? Math.round(Number(lng) * 1000) / 1000 : lng,
    };
    if (noCache) {
      return apiClient.get("/food/zones/detect", { params, ...axiosConfig });
    }
    const key = `zoneDetect:${stableStringify(params)}`;
    return publicZonesCache.getOrCreate(key, () =>
      apiClient.get("/food/zones/detect", { params, ...axiosConfig }),
    );
  },
  /** Public: list active zones (for onboarding dropdowns). */
  getPublicZones: (params = {}, config = {}) => {
    const { noCache, ...axiosConfig } = config || {};
    const keyParams = { ...(params || {}) };
    if (noCache) {
      return apiClient.get("/food/zones/public", { params: keyParams, ...axiosConfig });
    }
    const key = `zonesPublic:${stableStringify(keyParams)}`;
    return publicZonesCache.getOrCreate(key, () =>
      apiClient.get("/food/zones/public", { params: keyParams, ...axiosConfig }),
    );
  },
};
export const uploadAPI = {
  /**
   * Upload a single image file to the backend (Cloudinary-backed).
   * @param {File|Blob} file
   * @param {{ folder?: string }} options
   */
  uploadMedia: (file, options = {}) => {
    if (!file) {
      return Promise.reject(new Error("File is required for upload"));
    }

    const formData = new FormData();
    formData.append("file", file);
    if (options.folder) {
      formData.append("folder", options.folder);
    }

    return apiClient.post("/uploads/image", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  /**
   * Upload a single non-image file (PDF) to the backend.
   * @param {File|Blob} file
   * @param {{ folder?: string }} options
   */
  uploadFile: (file, options = {}) => {
    if (!file) {
      return Promise.reject(new Error("File is required for upload"));
    }

    const formData = new FormData();
    formData.append("file", file);
    if (options.folder) {
      formData.append("folder", options.folder);
    }

    return apiClient.post("/uploads/file", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
};
/** Order API (user app – Bearer USER token). Minimal calls: single create/verify, list/details cached by caller. */
export const orderAPI = {
  validateRestaurantChain: (payload) =>
    apiClient.post("/food/orders/validate-restaurant-chain", payload ?? {}, {
      contextModule: "user",
    }),
  calculateOrder: (payload) =>
    apiClient.post("/food/orders/calculate", payload ?? {}, {
      contextModule: "user",
    }),
  createOrder: (payload) =>
    apiClient.post("/food/orders", payload ?? {}, { contextModule: "user" }),
  verifyPayment: (body) =>
    apiClient.post("/food/orders/verify-payment", body ?? {}, {
      contextModule: "user",
    }),
  cancelCheckout: (checkoutId) =>
    apiClient.post(`/food/orders/checkout/${String(checkoutId)}/cancel`, {}, {
      contextModule: "user",
    }),
  getOrders: (() => {
    const inFlight = new Map();
    const cache = new Map();
    const CACHE_MS = 5000;

    const normalizeOrdersResponse = (res, params) => {
      const payload = res?.data?.data;

      if (
        payload &&
        typeof payload === "object" &&
        Array.isArray(payload.data) &&
        payload.meta &&
        typeof payload.meta === "object"
      ) {
        const meta = payload.meta;
        const pagination = {
          total: Number(meta.total || 0),
          page: Number(meta.page || 1),
          limit: Number(meta.limit || params.limit || 20),
          totalPages: Number(meta.totalPages || 1),
          hasNextPage: Boolean(
            meta.hasNextPage ?? meta.page < (meta.totalPages || 1),
          ),
          hasPreviousPage: Boolean(
            meta.hasPreviousPage ?? meta.hasPrevPage ?? meta.page > 1,
          ),
        };
        return {
          ...res,
          data: {
            ...res.data,
            data: {
              ...payload,
              orders: payload.data,
              pagination,
            },
          },
        };
      }

      if (
        payload &&
        typeof payload === "object" &&
        payload.pagination &&
        Array.isArray(payload.data)
      ) {
        return {
          ...res,
          data: {
            ...res.data,
            data: {
              ...payload,
              orders: payload.data,
            },
          },
        };
      }

      return res;
    };

    return (params = {}, options = {}) => {
      const force = options.force === true;
      const key = stableStringify({ limit: 20, page: 1, ...params });
      const now = Date.now();

      if (!force) {
        const hit = cache.get(key);
        if (hit && now - hit.at < CACHE_MS) {
          return Promise.resolve(hit.res);
        }
        const pending = inFlight.get(key);
        if (pending) return pending;
      }

      const request = apiClient
        .get("/food/orders", {
          params: { limit: 20, page: 1, ...params },
          contextModule: "user",
        })
        .then((res) => normalizeOrdersResponse(res, params))
        .then((res) => {
          cache.set(key, { at: Date.now(), res });
          return res;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, request);
      return request;
    };
  })(),
  getOrderDetails: (() => {
    const inFlight = new Map();
    const cache = new Map();
    /** Dedupes overlapping calls (StrictMode, poll + socket) without hiding fresh data for long. */
    const CACHE_MS = 800;

    return (orderId, options = {}) => {
      const key = String(orderId ?? "").trim();
      if (!key) {
        return Promise.reject(new Error("orderId required"));
      }

      const force = options.force === true;
      const now = Date.now();
      if (!force) {
        const hit = cache.get(key);
        if (hit && now - hit.at < CACHE_MS) {
          return Promise.resolve(hit.res);
        }
      }

      const pending = inFlight.get(key);
      if (pending) return pending;

      const p = apiClient
        .get(`/food/orders/${key}`, { contextModule: "user" })
        // Quick Commerce orders live in their own collection, so a food lookup cannot find
        // them. Only on failure do we try QC, which leaves the food path untouched. The QC
        // detail endpoint answers { success, result }, reshaped here to the { data: { order } }
        // the tracking screen reads.
        .catch(async (err) => {
          const status = err?.response?.status;
          if (status !== 404 && status !== 400) throw err;
          const qcRes = await apiClient.get(`/quick-commerce/orders/${key}`, {
            contextModule: "user",
          });
          const quickOrder = qcRes?.data?.result || qcRes?.data?.data;
          if (!quickOrder) throw err;
          return { ...qcRes, data: { success: true, data: { order: quickOrder } } };
        })
        .then((res) => {
          cache.set(key, { at: Date.now(), res });
          return res;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, p);
      return p;
    };
  })(),
  cancelOrder: (orderId, body = {}) =>
    apiClient.patch(`/food/orders/${String(orderId)}/cancel`, body ?? {}, {
      contextModule: "user",
    }),
  updateOrderInstructions: (orderId, instructions) =>
    apiClient.patch(`/food/orders/${String(orderId)}/instructions`, { instructions }, {
      contextModule: "user",
    }),
  submitOrderRatings: (orderId, body = {}) =>
    apiClient.patch(`/food/orders/${String(orderId)}/ratings`, body ?? {}, { contextModule: "user" }),
  /** Submit a complaint for an order (user). */
  submitComplaint: (payload) =>
    apiClient.post(
      "/food/user/support/ticket",
      {
        type: "order",
        orderId: payload.orderId,
        issueType: payload.complaintType,
        description: payload.subject ? `${payload.subject}: ${payload.description}` : payload.description,
      },
      { contextModule: "user" }
    ),
};

export const diningAPI = {
  /** Combined dining explore payload (banners + categories + restaurants). Deduped in-flight. */
  getHome: (params = {}, config = {}) => {
    const keyParams = {
      page: 1,
      limit: 12,
      ...params,
    };
    keyParams.page = Math.max(1, parseInt(keyParams.page, 10) || 1);
    keyParams.limit = Math.min(Math.max(parseInt(keyParams.limit, 10) || 12, 1), 50);
    if (keyParams.lat != null && Number.isFinite(Number(keyParams.lat))) {
      keyParams.lat = Math.round(Number(keyParams.lat) * 1000) / 1000;
    }
    if (keyParams.lng != null && Number.isFinite(Number(keyParams.lng))) {
      keyParams.lng = Math.round(Number(keyParams.lng) * 1000) / 1000;
    }
    const { noCache, ...restConfig } = config || {};
    if (noCache || keyParams.page > 1) {
      return apiClient.get("/food/dining/home/public", {
        ...restConfig,
        params: keyParams,
      });
    }
    return publicGetOnce("/food/dining/home/public", {
      ...restConfig,
      params: keyParams,
    });
  },
  getCategories: (params = {}, config = {}) =>
    publicGetOnce("/food/dining/categories/public", { ...config, params }),
  getRestaurants: (params = {}, config = {}) => {
    const keyParams = {
      page: 1,
      limit: 12,
      ...params,
    };
    keyParams.page = Math.max(1, parseInt(keyParams.page, 10) || 1);
    keyParams.limit = Math.min(Math.max(parseInt(keyParams.limit, 10) || 12, 1), 50);
    if (keyParams.lat != null && Number.isFinite(Number(keyParams.lat))) {
      keyParams.lat = Math.round(Number(keyParams.lat) * 1000) / 1000;
    }
    if (keyParams.lng != null && Number.isFinite(Number(keyParams.lng))) {
      keyParams.lng = Math.round(Number(keyParams.lng) * 1000) / 1000;
    }
    const { noCache, ...restConfig } = config || {};
    if (noCache || keyParams.page > 1) {
      return apiClient.get("/food/dining/restaurants/public", {
        ...restConfig,
        params: keyParams,
      });
    }
    return publicGetOnce("/food/dining/restaurants/public", {
      ...restConfig,
      params: keyParams,
    });
  },
  getHeroBanners: (config = {}) =>
    publicGetOnce("/food/hero-banners/dining/public", config),
  getRestaurantBySlug: (slug, config = {}) =>
    getPublicRestaurantDetailOnce(slug, config),
  getOfferBanners: () => Promise.resolve({ data: { success: true, data: [] } }),
  getStories: () => Promise.resolve({ data: { success: true, data: [] } }),
  getBankOffers: () => Promise.resolve({ data: { success: true, data: [] } }),

  getBookableDates: (restaurantId, params = {}) =>
    apiClient.get(`/food/dining/restaurants/${String(restaurantId)}/dates`, {
      params,
      contextModule: "user",
    }),
  getAvailableSlots: (restaurantId, params = {}) =>
    apiClient.get(`/food/dining/restaurants/${String(restaurantId)}/slots`, {
      params,
      contextModule: "user",
    }),
  getAvailableTables: (restaurantId, params = {}) =>
    apiClient.get(`/food/dining/restaurants/${String(restaurantId)}/tables`, {
      params,
      contextModule: "user",
    }),

  getBookings: (params = {}) =>
    apiClient.get("/food/dining/bookings", { params, contextModule: "user" }),
  getBookingById: (bookingId) =>
    apiClient.get(`/food/dining/bookings/${String(bookingId)}`, {
      contextModule: "user",
    }),
  createBooking: (payload = {}) => {
    const restaurantId = String(
      payload?.restaurantId ||
      payload?.restaurant ||
      payload?.restaurantRef?._id ||
      payload?.restaurantRef?.id ||
      payload?.restaurant?._id ||
      payload?.restaurant?.id ||
      "",
    ).trim();

    const dateValue = payload?.date
      ? new Date(payload.date)
      : new Date();
    const dateKey = Number.isNaN(dateValue.getTime())
      ? String(payload?.date || "").slice(0, 10)
      : `${dateValue.getFullYear()}-${String(dateValue.getMonth() + 1).padStart(2, "0")}-${String(dateValue.getDate()).padStart(2, "0")}`;

    return apiClient.post(
      "/food/dining/bookings",
      {
        restaurantId,
        date: dateKey,
        timeSlot: String(payload?.timeSlot || "").trim(),
        guests: Math.max(1, Number(payload?.guests) || 1),
        tableId: payload?.tableId || null,
        specialRequest: String(payload?.specialRequest || "").trim(),
        guestInfo: {
          name: payload?.user?.name || payload?.guestInfo?.name || "",
          phone: payload?.user?.phone || payload?.guestInfo?.phone || "",
          email: payload?.user?.email || payload?.guestInfo?.email || "",
        },
      },
      { contextModule: "user" },
    );
  },
  cancelBooking: (bookingId, body = {}) =>
    apiClient.patch(
      `/food/dining/bookings/${String(bookingId)}/cancel`,
      body,
      { contextModule: "user" },
    ),
  createReview: (payload = {}) =>
    apiClient.post(
      "/food/dining/reviews",
      {
        bookingId: String(payload?.bookingId || "").trim(),
        rating: Number(payload?.rating || 0),
        comment: String(payload?.comment || "").trim(),
      },
      { contextModule: "user" },
    ),

  getRestaurantBookings: (_restaurantRef, params = {}) =>
    apiClient.get("/food/restaurant/dining/bookings", {
      params,
      contextModule: "restaurant",
    }),
  getRestaurantBookingStats: () =>
    apiClient.get("/food/restaurant/dining/bookings/stats", {
      contextModule: "restaurant",
    }),
  searchRestaurantBooking: (code) =>
    apiClient.get("/food/restaurant/dining/bookings/search", {
      params: { code },
      contextModule: "restaurant",
    }),
  updateBookingStatusRestaurant: (bookingId, status, body = {}) =>
    apiClient.patch(
      `/food/restaurant/dining/bookings/${String(bookingId)}/status`,
      { status, ...body },
      { contextModule: "restaurant" },
    ),

  listTables: (params = {}) =>
    apiClient.get("/food/restaurant/dining/tables", {
      params,
      contextModule: "restaurant",
    }),
  createTable: (body) =>
    apiClient.post("/food/restaurant/dining/tables", body ?? {}, {
      contextModule: "restaurant",
    }),
  updateTable: (tableId, body) =>
    apiClient.patch(
      `/food/restaurant/dining/tables/${String(tableId)}`,
      body ?? {},
      { contextModule: "restaurant" },
    ),
  deleteTable: (tableId) =>
    apiClient.delete(`/food/restaurant/dining/tables/${String(tableId)}`, {
      contextModule: "restaurant",
    }),

  listSlots: (params = {}) =>
    apiClient.get("/food/restaurant/dining/slots", {
      params,
      contextModule: "restaurant",
    }),
  createSlot: (body) =>
    apiClient.post("/food/restaurant/dining/slots", body ?? {}, {
      contextModule: "restaurant",
    }),
  updateSlot: (slotId, body) =>
    apiClient.patch(
      `/food/restaurant/dining/slots/${String(slotId)}`,
      body ?? {},
      { contextModule: "restaurant" },
    ),
  deleteSlot: (slotId) =>
    apiClient.delete(`/food/restaurant/dining/slots/${String(slotId)}`, {
      contextModule: "restaurant",
    }),

  getReservationSettings: () =>
    apiClient.get("/food/restaurant/dining/reservation-settings", {
      contextModule: "restaurant",
    }),
  updateReservationSettings: (body) =>
    apiClient.patch(
      "/food/restaurant/dining/reservation-settings",
      body ?? {},
      { contextModule: "restaurant" },
    ),

  // Admin
  getAdminBookings: (params = {}) =>
    apiClient.get("/food/admin/dining/bookings", {
      params,
      contextModule: "admin",
    }),
  getAdminBookingAnalytics: (params = {}) =>
    apiClient.get("/food/admin/dining/bookings/analytics", {
      params,
      contextModule: "admin",
    }),
};
export const heroBannerAPI = createStubAPI();
export const publicAPI = createStubAPI();
