import apiClient from "@food/api/axios";

/**
 * Rider-side taxi API.
 *
 * The rider app runs on the delivery partner's own login, so every call is made in the `delivery`
 * session. Method names deliberately mirror Food's `deliveryAPI` (and the Quick Commerce one) so
 * the trip screens can pick an API object per job instead of branching at every call site.
 */
const base = (rideId) => `/taxi/delivery/rides/${String(rideId)}`;
const opts = { contextModule: "delivery" };

export const taxiDeliveryAPI = {
  getAvailableOrders: (params = {}) =>
    apiClient.get("/taxi/delivery/rides/available", { params, ...opts }),

  getCurrentDelivery: () => apiClient.get("/taxi/delivery/rides/current", opts),

  getOrderDetails: (rideId) => apiClient.get(base(rideId), opts),

  acceptOrder: (rideId) => apiClient.patch(`${base(rideId)}/accept`, {}, opts),

  rejectOrder: (rideId) => apiClient.patch(`${base(rideId)}/reject`, {}, opts),

  /** Rider reached the passenger. */
  confirmReachedPickup: (rideId) => apiClient.patch(`${base(rideId)}/reached-pickup`, {}, opts),

  /**
   * Passenger gave the ride code: start the trip. Signature matches Food's confirmOrderId
   * (orderId, confirmedOrderId, location, data) - the ride code travels in `data.otp`.
   */
  confirmOrderId: (rideId, _confirmedOrderId, _location = {}, data = {}) =>
    apiClient.post(`${base(rideId)}/start`, { otp: data.otp }, opts),

  confirmReachedDrop: (rideId) => apiClient.patch(`${base(rideId)}/reached-drop`, {}, opts),

  /** A ride has no drop-off code (the code is checked at pickup); kept so shared code can call it. */
  verifyDropOtp: async () => ({ data: { success: true } }),

  /** Ride finished. `paymentMethod` / `collectedVia` say how the fare reached the rider. */
  completeDelivery: (rideId, body = {}) => {
    const payload = body && typeof body === "object" ? body : {};
    // The rider app's shared "complete" call passes the tender as `paymentMethod`; for a ride the
    // tender (cash / UPI) is how the fare was collected.
    const collectedVia =
      payload.collectedVia || (["cash", "upi"].includes(payload.paymentMethod) ? payload.paymentMethod : undefined);
    return apiClient.patch(`${base(rideId)}/complete`, { collectedVia }, opts);
  },

  /** Parcel trips: the photo of the parcel at "pickup" or "delivery". */
  uploadParcelProof: (rideId, stage, imageUrl) =>
    apiClient.post(`${base(rideId)}/parcel-proof`, { stage, imageUrl }, opts),

  updateRideLocation: (rideId, { lat, lng, heading, speed } = {}) =>
    apiClient.post(`${base(rideId)}/location`, { lat, lng, heading, speed }, opts),
};

/** True when a job is a taxi ride rather than a Food / Quick Commerce order. */
export const isTaxiRide = (order) =>
  String(order?.orderKind || order?.orderType || "").toLowerCase() === "taxi";

export default taxiDeliveryAPI;
