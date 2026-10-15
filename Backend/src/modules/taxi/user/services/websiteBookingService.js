import { ApiError } from '../../../../utils/ApiError.js';
import { User } from '../models/User.js';
import { Ride } from '../models/Ride.js';
import { RIDE_STATUS, RIDE_LIVE_STATUS } from '../../constants/index.js';

/**
 * Booking enquiries from the public marketing site.
 *
 * These are leads, not dispatchable rides: the website form collects free-text
 * addresses with no coordinates and no fare, so the ride is created directly
 * here rather than through rideService.createRide. That is deliberate — going
 * through rideService would push the request into driver dispatch, pinging real
 * drivers for a trip that has no real pickup point. Admin picks these up from
 * Trip Requests and calls the customer.
 *
 * The typed addresses are what matter and are stored verbatim in
 * pickupAddress / dropAddress. Coordinates fall back to the configured default
 * city centre purely to satisfy the schema's required GeoJSON.
 */

// Bengaluru city centre — matches general.default_lat/lng in the CMS settings.
const FALLBACK_COORDS = [77.5946, 12.9716]; // GeoJSON is [lng, lat]

const clean = (value, max = 200) => String(value ?? '').trim().slice(0, max);

const normalizePhone = (phone) => {
  const digits = String(phone ?? '').replace(/\D/g, '');
  // tolerate +91 / 0 prefixes on a 10-digit Indian mobile
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
};

export const createWebsiteBookingRequest = async (payload = {}) => {
  const name = clean(payload.name, 80);
  const phone = normalizePhone(payload.phone);
  const pickupAddress = clean(payload.pickup, 300);
  const dropAddress = clean(payload.drop, 300);

  if (!name) throw new ApiError(400, 'name is required');
  if (phone.length !== 10) throw new ApiError(400, 'a valid 10-digit phone number is required');
  if (!pickupAddress) throw new ApiError(400, 'pickup is required');
  if (!dropAddress) throw new ApiError(400, 'drop is required');

  // Reuse the customer record if they have booked or signed up before, so the
  // admin sees one user rather than a duplicate per enquiry.
  let user = await User.findOne({ phone });
  if (!user) {
    user = await User.create({ name, phone });
  } else if (!user.name && name) {
    user.name = name;
    await user.save();
  }

  const scheduledAt = payload.scheduledAt ? new Date(payload.scheduledAt) : null;

  const ride = await Ride.create({
    userId: user._id,
    serviceType: 'ride',
    bookingSource: 'website',
    status: RIDE_STATUS.SEARCHING,
    liveStatus: RIDE_LIVE_STATUS.SEARCHING,
    pickupAddress,
    dropAddress,
    pickupLocation: { type: 'Point', coordinates: FALLBACK_COORDS },
    dropLocation: { type: 'Point', coordinates: FALLBACK_COORDS },
    fare: 0,
    vehicleIconType: clean(payload.vehicleType, 40) || 'car',
    scheduledAt: scheduledAt && !Number.isNaN(scheduledAt.valueOf()) ? scheduledAt : null,
    paymentMethod: 'cash',
  });

  return {
    requestId: `REQ_${String(ride._id).slice(-12).toUpperCase()}`,
    rideId: String(ride._id),
    status: ride.status,
    scheduledAt: ride.scheduledAt,
  };
};
