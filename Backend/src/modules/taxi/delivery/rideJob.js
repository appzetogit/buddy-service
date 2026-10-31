import { RIDE_LIVE_STATUS, RIDE_STATUS } from '../constants/index.js';
import { estimateRideDriverEarnings } from '../driver/services/walletService.js';

/**
 * A taxi ride, described the way the rider app describes any job.
 *
 * The delivery app already knows how to show an offer, drive a trip (go to pickup, collect, go to
 * drop, hand over) and summarise it, for Food and Quick Commerce orders. A ride is the same shape
 * of work - pick someone up at A, take them to B - so it is handed to that app in the same
 * vocabulary instead of teaching the app a second one. `orderKind: 'taxi'` is what lets the app
 * pick the ride-specific steps (ride OTP at pickup, no bill photo, fare collection at the end).
 */

const toLatLng = (point) => {
  const coordinates = point?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const [lng, lat] = coordinates.map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

const place = (point, address = '') => {
  const at = toLatLng(point);
  return {
    address,
    formattedAddress: address,
    ...(at ? { latitude: at.lat, longitude: at.lng, coordinates: [at.lng, at.lat] } : {}),
  };
};

/** Rider-app order status for a ride's lifecycle. */
export const jobStatusOf = (ride) => {
  if (ride.status === RIDE_STATUS.CANCELLED) return 'cancelled';
  if (ride.status === RIDE_STATUS.COMPLETED) return 'delivered';
  switch (ride.liveStatus) {
    case RIDE_LIVE_STATUS.ARRIVING:
      return 'reached_pickup';
    case RIDE_LIVE_STATUS.STARTED:
      return 'picked_up';
    case RIDE_LIVE_STATUS.ARRIVED:
      return 'reached_drop';
    case RIDE_LIVE_STATUS.COMPLETED:
      return 'delivered';
    case RIDE_LIVE_STATUS.ACCEPTED:
      return 'confirmed';
    default:
      return 'created';
  }
};

const shortId = (ride) => `R${String(ride._id).slice(-6).toUpperCase()}`;

const distanceMeters = (from, to) => {
  if (!from || !to) return null;
  const rad = (v) => (v * Math.PI) / 180;
  const dLat = rad(to.lat - from.lat);
  const dLng = rad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/**
 * @param {object} ride  Ride document or lean object (userId may be populated)
 * @param {{ riderPosition?: {lat:number,lng:number}|null, partnerId?: string|null, offer?: boolean }} [options]
 */
export const buildRideJob = async (ride, { riderPosition = null, partnerId = null } = {}) => {
  const raw = typeof ride?.toObject === 'function' ? ride.toObject() : ride;
  const id = String(raw._id);
  const pickup = toLatLng(raw.pickupLocation);
  const drop = toLatLng(raw.dropLocation);
  const rider = raw.userId && typeof raw.userId === 'object' ? raw.userId : {};
  const fare = Number(raw.fare) || 0;
  const isCash = String(raw.paymentMethod || '').toLowerCase() === 'cash';
  const settled = raw.driverEarnings !== undefined && raw.driverEarnings !== null && raw.walletSettledAt;
  const estimate = settled
    ? { earnings: Number(raw.driverEarnings) || 0, commission: Number(raw.commissionAmount) || 0 }
    : await estimateRideDriverEarnings(raw);
  const toPickupMeters = distanceMeters(riderPosition, pickup);
  const status = jobStatusOf(raw);
  const customerName = rider.name || 'Passenger';
  const isParcel = (raw.serviceType || 'ride') === 'parcel';

  return {
    _id: id,
    id,
    orderId: id,
    rideId: id,
    order_id: shortId(raw),
    displayOrderId: shortId(raw),
    orderKind: 'taxi',
    orderType: 'taxi',
    serviceType: raw.serviceType || 'ride',
    orderStatus: status,
    status,
    liveStatus: raw.liveStatus,

    // The pickup point plays the role of the "restaurant" in the rider app.
    restaurantName: isParcel ? 'Parcel pickup' : `Pickup - ${customerName}`,
    restaurant_name: isParcel ? 'Parcel pickup' : `Pickup - ${customerName}`,
    restaurantAddress: raw.pickupAddress || '',
    restaurant_address: raw.pickupAddress || '',
    restaurantPhone: rider.phone || '',
    restaurantLocation: pickup,
    restaurantId: { name: customerName, phone: rider.phone || '', location: place(raw.pickupLocation, raw.pickupAddress || '') },

    // The drop point is the "customer".
    deliveryAddress: { ...place(raw.dropLocation, raw.dropAddress || ''), street: raw.dropAddress || '', location: place(raw.dropLocation, raw.dropAddress || '') },
    customerAddress: raw.dropAddress || '',
    customerLocation: drop,
    customerName,
    customerPhone: rider.phone || '',
    user: { name: customerName, phone: rider.phone || '', profileImage: rider.profileImage || '', logo: rider.profileImage || '' },

    pickupDistanceKm: toPickupMeters == null ? undefined : Number((toPickupMeters / 1000).toFixed(1)),
    distanceKm: Number(((Number(raw.estimatedDistanceMeters) || 0) / 1000).toFixed(1)),
    estimatedTime: Number(raw.estimatedDurationMinutes) || undefined,
    duration: Number(raw.estimatedDurationMinutes) || undefined,

    riderEarning: estimate.earnings,
    earnings: estimate.earnings,
    pricing: {
      total: fare,
      deliveryFeeBreakdown: { riderFee: estimate.earnings, deliveryBoyFee: estimate.earnings },
    },
    paymentMethod: isCash ? 'cash' : 'online',
    // 'paid' once the rider has paid online (during or after the trip).
    paymentStatus: ['paid', 'captured', 'completed'].includes(String(raw.driverPaymentCollection?.status || '')) ? 'paid' : 'pending',
    payment: { method: isCash ? 'cash' : 'online', amountDue: isCash ? fare : 0 },
    amountToCollect: isCash ? fare : 0,

    dispatch: {
      status: raw.driverId ? 'accepted' : 'offered',
      deliveryPartnerId: raw.driverId ? String(raw.driverId?._id || raw.driverId) : null,
      acceptedAt: raw.acceptedAt || null,
    },
    deliveryVerification: { dropOtp: { required: false, verified: true } },

    taxi: {
      rideId: id,
      serviceType: raw.serviceType || 'ride',
      fare,
      commission: estimate.commission,
      driverEarnings: estimate.earnings,
      paymentMethod: raw.paymentMethod,
      collectedVia: raw.collectedVia || 'cash',
      /** The rider (passenger) tells the driver this code at pickup; it is checked on the server. */
      otpRequired: Boolean(raw.otp),
      otpVerified: Boolean(raw.startedAt),
      scheduledAt: raw.scheduledAt || null,
      /** Outstation: tripType, returnDate, travelDate, fromCity, toCity, distance, vehicleName and the server's fare breakdown (pricing). */
      intercity: raw.intercity || null,
      bookingMode: raw.bookingMode || 'normal',
      parcel: raw.parcel || null,
      stops: raw.stops || [],
      vehicleIconType: raw.vehicleIconType || '',
      pickupAddress: raw.pickupAddress || '',
      dropAddress: raw.dropAddress || '',
      acceptedAt: raw.acceptedAt || null,
      arrivedAt: raw.arrivedAt || null,
      startedAt: raw.startedAt || null,
      completedAt: raw.completedAt || null,
    },
    scheduledAt: raw.scheduledAt || null,
    intercity: raw.intercity || null,
    isAssignedToCurrentDriver: Boolean(partnerId && raw.driverId && String(raw.driverId?._id || raw.driverId) === String(partnerId)),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    partnerId,
  };
};
