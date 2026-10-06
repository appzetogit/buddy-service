import apiClient from "@food/api/axios";

/**
 * Rider-side Quick Commerce API.
 *
 * Deliberately mirrors the method names of Food's `deliveryAPI` so the rider screens can pick
 * an API object per order (`orderKind === 'quick'`) instead of branching at every call site.
 */
const base = (orderId) => `/quick-commerce/delivery/orders/${String(orderId)}`;
const opts = { contextModule: "delivery" };

export const quickDeliveryAPI = {
  getAvailableOrders: (params = {}) =>
    apiClient.get("/quick-commerce/delivery/orders/available", { params, ...opts }),

  getCurrentDelivery: () =>
    apiClient.get("/quick-commerce/delivery/orders/current", opts),

  getOrderDetails: (orderId) => apiClient.get(base(orderId), opts),

  acceptOrder: (orderId) => apiClient.patch(`${base(orderId)}/accept`, {}, opts),

  rejectOrder: (orderId) => apiClient.patch(`${base(orderId)}/reject`, {}, opts),

  confirmReachedPickup: (orderId) =>
    apiClient.patch(`${base(orderId)}/reached-pickup`, {}, opts),

  /** Picked up from the seller. Signature matches Food's confirmOrderId. */
  confirmOrderId: (orderId, _confirmedOrderId, location = {}, data = {}) =>
    apiClient.patch(
      `${base(orderId)}/confirm-pickup`,
      { latitude: location.lat, longitude: location.lng, billImageUrl: data.billImageUrl },
      opts,
    ),

  confirmReachedDrop: (orderId) =>
    apiClient.patch(`${base(orderId)}/reached-drop`, {}, opts),

  verifyDropOtp: (orderId, otp) =>
    apiClient.post(`${base(orderId)}/verify-drop-otp`, { otp: String(otp) }, opts),

  completeDelivery: (orderId, body = {}) => {
    const payload = body && typeof body === "object" ? body : {};
    return apiClient.patch(`${base(orderId)}/complete`, payload, opts);
  },

  /** Quick Commerce has no shared/second-rider leg; kept so callers can stay uniform. */
  acceptSharedOrder: (orderId) => quickDeliveryAPI.acceptOrder(orderId),
};

/** True when an order came from the Quick Commerce pipeline rather than Food. */
export const isQuickDeliveryOrder = (order) =>
  String(order?.orderKind || order?.orderType || "").toLowerCase() === "quick";

export default quickDeliveryAPI;
