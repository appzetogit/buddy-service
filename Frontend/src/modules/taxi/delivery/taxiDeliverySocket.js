import { taxiDeliveryAPI } from "./taxiDeliveryApi";

/**
 * Ride events on the rider's existing delivery socket.
 *
 * Ride offers arrive as `rideRequest`; the offer card needs the job in the app's own shape, so the
 * server's available-rides list is read for it rather than re-describing the ride here.
 */
export const attachTaxiRideListeners = (socket, { onOffer, onClosed, onCancelled } = {}) => {
  if (!socket) return;

  socket.on("rideRequest", async (payload = {}) => {
    try {
      const res = await taxiDeliveryAPI.getAvailableOrders();
      const offers = res?.data?.data?.orders || [];
      const job = offers.find((o) => String(o._id) === String(payload.rideId)) || null;
      if (job) onOffer?.(job);
    } catch {
      // The poll in the home screen will pick the offer up.
    }
  });

  // Another rider took it, it expired, or the passenger cancelled before anyone did.
  socket.on("rideRequestClosed", (payload = {}) => onClosed?.(payload.rideId, payload));

  // The passenger cancelled a ride this rider already accepted.
  socket.on("rideCancelled", (payload = {}) => onCancelled?.(payload.rideId, payload));
};
