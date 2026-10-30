/**
 * Rider-facing taxi endpoints.
 *
 * Same rider account and app as Food / Quick Commerce: a delivery partner who has switched on
 * "Taxi" in the jobs they want is offered rides, takes them through the same steps as any other
 * job (go to pickup -> collect -> go to drop -> hand over) and sees the money in the same wallet.
 * The ride rules themselves (claiming a ride, the state machine, commission) are the taxi
 * services; these handlers only speak the delivery app's language.
 */
import mongoose from 'mongoose';
import { getRiderActiveLoadMap } from '../../food/orders/services/rider-capacity.service.js';
import { ApiError } from '../../../utils/ApiError.js';
import { sendResponse, sendError } from '../../../utils/response.js';
import { logger } from '../../../utils/logger.js';
import { RIDE_LIVE_STATUS, RIDE_STATUS } from '../constants/index.js';
import { Ride } from '../user/models/Ride.js';
import { Driver } from '../driver/models/Driver.js';
import { resolvePartnerFromAccountId } from '../shared/partner.js';
import {
  SCHEDULED_RIDE_ACTIVE_LEAD_MS,
  acceptRideAssignment,
  driverVehicleMatchesRide,
  getRideDetails,
  isRideScheduledForFuture,
  getRideRoom,
  saveParcelProof,
  serializeRideRealtime,
  submitRideBid,
  updateRideDriverLocation,
  updateRideLifecycle,
} from '../services/rideService.js';
import {
  cancelScheduledRideByDriver,
  getSocketServer,
  markDriverRejectedFromDispatch,
  notifyRideAccepted,
  notifyRideBidUpdated,
} from '../services/dispatchService.js';
import { mirrorRideDriverLocation, mirrorRideRealtimeState } from '../services/rideRealtimeSyncService.js';
import { resolveTransportDispatchConfig } from '../services/transportSettingsService.js';
import { SOCKET_EVENTS } from '../socket/events.js';
import { buildRideJob } from './rideJob.js';

/** Statuses a rider still has work to do on. */
const ACTIVE_RIDE_STATUSES = [RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING];

const resolveRider = async (req) => {
  const partner = await resolvePartnerFromAccountId(req.user?.userId);
  return partner ? String(partner._id) : null;
};

const riderPositionOf = async (partnerId) => {
  const doc = await Driver.findById(partnerId).select('lastLocation currentLocation lastLat lastLng').lean();
  const c = doc?.lastLocation?.coordinates || doc?.currentLocation?.coordinates;
  if (Array.isArray(c) && c.length === 2) return { lat: Number(c[1]), lng: Number(c[0]) };
  if (Number.isFinite(Number(doc?.lastLat)) && Number.isFinite(Number(doc?.lastLng))) {
    return { lat: Number(doc.lastLat), lng: Number(doc.lastLng) };
  }
  return null;
};

const populateForJob = (query) => query.populate('userId', 'name phone profileImage');

const loadOwnedRide = async (rideId, partnerId) => {
  if (!mongoose.Types.ObjectId.isValid(String(rideId))) throw new ApiError(404, 'Ride not found');
  const ride = await populateForJob(Ride.findOne({ _id: rideId, driverId: partnerId }));
  if (!ride) throw new ApiError(404, 'Assigned ride not found');
  return ride;
};

/** Pushes the new ride state to everyone watching it (the passenger's app, admin, the rider). */
const broadcastRideProgress = async (rideId) => {
  try {
    const io = getSocketServer();
    if (!io) return;
    const ride = await getRideDetails(rideId);
    const room = getRideRoom(ride._id);
    io.to(room).emit(SOCKET_EVENTS.RIDE_STATUS_UPDATED, {
      rideId: String(ride._id),
      status: ride.status,
      liveStatus: ride.liveStatus,
      acceptedAt: ride.acceptedAt,
      arrivedAt: ride.arrivedAt,
      startedAt: ride.startedAt,
      completedAt: ride.completedAt,
    });
    const state = serializeRideRealtime(ride);
    io.to(room).emit(SOCKET_EVENTS.RIDE_STATE, state);
    mirrorRideRealtimeState(state).catch(() => {});
  } catch (error) {
    logger.warn(`[TaxiDelivery] progress broadcast failed for ${rideId}: ${error.message}`);
  }
};

const fail = (res, error, fallback) => {
  const status = error instanceof ApiError ? error.statusCode || error.status || 400 : 500;
  if (!(error instanceof ApiError)) logger.error(`[TaxiDelivery] ${fallback}: ${error.message}`);
  return sendError(res, status, error instanceof ApiError ? error.message : fallback);
};

/** Offers currently on this rider's screen. */
export const listAvailableRides = async (req, res) => {
  try {
    const partnerId = await resolveRider(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');

    const partner = await Driver.findById(partnerId).select('deliveryServices isOnRide availabilityStatus').lean();
    if (!partner || partner.isOnRide || !(partner.deliveryServices || []).includes('taxi')) {
      return sendResponse(res, 200, 'Available rides', { orders: [] });
    }

    const [regular, bidding] = await Promise.all([
      resolveTransportDispatchConfig(),
      resolveTransportDispatchConfig({ bidding: true }),
    ]);
    const freshest = new Date(Date.now() - Math.max(regular.maxSearchSeconds, bidding.maxSearchSeconds) * 1000);

    const rides = await Ride.find({
      status: RIDE_STATUS.SEARCHING,
      driverId: null,
      'dispatchTracking.notifiedDriverIds': partnerId,
      'dispatchTracking.rejectedDriverIds': { $ne: partnerId },
      'dispatchTracking.lastDispatchAttemptAt': { $gte: freshest },
    })
      .sort({ 'dispatchTracking.lastDispatchAttemptAt': -1 })
      .limit(5)
      .populate('userId', 'name phone profileImage');

    const position = await riderPositionOf(partnerId);
    const orders = [];
    for (const ride of rides) {
      const config = ride.pricingNegotiationMode === 'driver_bid' ? bidding : regular;
      const lastAt = ride.dispatchTracking?.lastDispatchAttemptAt
        ? new Date(ride.dispatchTracking.lastDispatchAttemptAt).getTime()
        : Date.now();
      const elapsed = Math.max(0, Math.round((Date.now() - lastAt) / 1000));
      const expiresInSeconds = Math.max(1, config.retryWindowSeconds - elapsed);
      const job = await buildRideJob(ride, { riderPosition: position, partnerId });
      orders.push({ ...job, expiresInSeconds, requestExpiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString() });
    }

    return sendResponse(res, 200, 'Available rides', { orders });
  } catch (error) {
    return fail(res, error, 'Failed to load ride offers');
  }
};

/** The rider's in-flight rides. */
export const listCurrentRides = async (req, res) => {
  try {
    const partnerId = await resolveRider(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');

    const rides = await populateForJob(
      Ride.find({ driverId: partnerId, status: { $in: ACTIVE_RIDE_STATUSES } }).sort({ acceptedAt: -1 }),
    );
    // A ride booked ahead is the rider's live trip only from the active lead before pickup; earlier it
    // waits in their Scheduled rides list.
    const activeFrom = new Date(Date.now() + SCHEDULED_RIDE_ACTIVE_LEAD_MS);
    const live = rides.filter((ride) => !isRideScheduledForFuture(ride, activeFrom));
    const position = await riderPositionOf(partnerId);
    const orders = await Promise.all(live.map((ride) => buildRideJob(ride, { riderPosition: position, partnerId })));
    return sendResponse(res, 200, 'Current rides', { orders });
  } catch (error) {
    return fail(res, error, 'Failed to load current rides');
  }
};

/** Rides within this distance of the rider's last position are offered in Scheduled rides. */
const SCHEDULED_LIST_RADIUS_KM = 50;

/**
 * Rides booked for later that this rider can take in advance (and the ones they already took),
 * soonest first. Open ones are rides still searching for a driver, for this rider's vehicle class,
 * near them, that they have not given back.
 */
export const listScheduledRides = async (req, res) => {
  try {
    const partnerId = await resolveRider(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');

    const partner = await Driver.findById(partnerId).select('deliveryServices vehicleType taxiVehicleType taxiServiceCategories').lean();
    if (!partner || !(partner.deliveryServices || []).includes('taxi')) {
      return sendResponse(res, 200, 'Scheduled rides', { orders: [], results: [], totalCount: 0 });
    }

    const position = await riderPositionOf(partnerId);
    const from = new Date();
    const open = {
      scheduledAt: { $gte: from },
      status: RIDE_STATUS.SEARCHING,
      liveStatus: RIDE_LIVE_STATUS.SEARCHING,
      driverId: null,
      bookingSource: { $ne: 'website' },
      'dispatchTracking.rejectedDriverIds': { $ne: partnerId },
      ...(position
        ? { pickupLocation: { $geoWithin: { $centerSphere: [[position.lng, position.lat], SCHEDULED_LIST_RADIUS_KM / 6378.1] } } }
        : {}),
    };
    const mine = {
      scheduledAt: { $gte: from },
      driverId: partnerId,
      status: RIDE_STATUS.ACCEPTED,
      liveStatus: { $in: [RIDE_LIVE_STATUS.ACCEPTED, RIDE_LIVE_STATUS.ARRIVING] },
    };

    const rides = await populateForJob(Ride.find({ $or: [open, mine] }).sort({ scheduledAt: 1 }).limit(200));
    const visible = [];
    for (const ride of rides) {
      const isMine = ride.driverId && String(ride.driverId) === String(partnerId);
      if (isMine || (await driverVehicleMatchesRide(ride, partner))) visible.push(ride);
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const pageRides = visible.slice((page - 1) * limit, page * limit);
    const orders = await Promise.all(pageRides.map((ride) => buildRideJob(ride, { riderPosition: position, partnerId })));
    return sendResponse(res, 200, 'Scheduled rides', {
      orders,
      results: orders,
      totalCount: visible.length,
      pagination: { page, limit, total: visible.length, totalPages: Math.max(1, Math.ceil(visible.length / limit)) },
    });
  } catch (error) {
    return fail(res, error, 'Failed to load scheduled rides');
  }
};

/**
 * Gives a ride the rider took in advance back: the passenger keeps the booking (told "finding you
 * another driver"), the ride goes to other riders, and the giving-back rider is charged the driver
 * cancellation fee.
 */
export const giveBackRideController = async (req, res) => {
  try {
    const partnerId = await resolveRider(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');
    if (!mongoose.Types.ObjectId.isValid(String(req.params.rideId))) throw new ApiError(404, 'Ride not found');

    let ride;
    try {
      ride = await cancelScheduledRideByDriver({ rideId: req.params.rideId, driverId: partnerId });
    } catch (error) {
      // The service throws plain Errors for "not upcoming" / "already completed".
      throw error instanceof ApiError ? error : new ApiError(400, error.message || 'Could not give this ride back');
    }
    if (!ride) throw new ApiError(404, 'Scheduled ride not found for this driver');
    return sendResponse(res, 200, 'Scheduled ride given back - it goes to other drivers', {
      rideId: String(ride._id),
      status: ride.status,
      liveStatus: ride.liveStatus,
    });
  } catch (error) {
    return fail(res, error, 'Failed to give the ride back');
  }
};

export const getRideJob = async (req, res) => {
  try {
    const partnerId = await resolveRider(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');
    const ride = await loadOwnedRide(req.params.rideId, partnerId);
    return sendResponse(res, 200, 'Ride', { order: await buildRideJob(ride, { partnerId, riderPosition: await riderPositionOf(partnerId) }) });
  } catch (error) {
    return fail(res, error, 'Failed to load ride');
  }
};

export const acceptRideController = async (req, res) => {
  try {
    const partnerId = await resolveRider(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');

    // A rider already carrying Food / Quick Commerce orders is not free for a passenger.
    const load = await getRiderActiveLoadMap([partnerId]).catch(() => new Map());
    if ((load.get(partnerId) || 0) > 0) {
      return sendError(res, 409, 'Finish your current orders before taking a ride');
    }

    // Ride rules (one winner per ride, one ride per rider, vehicle class, opted-in) live in the service.
    const accepted = await acceptRideAssignment({ rideId: req.params.rideId, driverId: partnerId });

    // Put the rider's own sockets in the ride room, then tell the passenger and the other riders.
    const io = getSocketServer();
    io?.in(`taxi:driver:${partnerId}`).socketsJoin(getRideRoom(accepted._id));
    await notifyRideAccepted(accepted);

    const ride = await loadOwnedRide(accepted._id, partnerId);
    const order = await buildRideJob(ride, { partnerId, riderPosition: await riderPositionOf(partnerId) });
    return sendResponse(res, 200, 'Ride accepted', { order });
  } catch (error) {
    return fail(res, error, 'Failed to accept ride');
  }
};

export const rejectRideController = async (req, res) => {
  try {
    const partnerId = await resolveRider(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');
    await markDriverRejectedFromDispatch(req.params.rideId, partnerId);
    return sendResponse(res, 200, 'Ride declined', { rideId: String(req.params.rideId) });
  } catch (error) {
    return fail(res, error, 'Failed to decline ride');
  }
};

export const submitBidController = async (req, res) => {
  try {
    const partnerId = await resolveRider(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');

    const rideId = req.params.rideId || req.body.rideId;
    const bidAmount = req.body.bidAmount ?? req.body.bidFare ?? req.body.amount;

    if (!rideId) return sendError(res, 400, 'rideId is required');
    if (bidAmount === undefined || bidAmount === null) return sendError(res, 400, 'bidAmount is required');

    const result = await submitRideBid({ rideId, driverId: partnerId, bidFare: Number(bidAmount) });
    await notifyRideBidUpdated({ ride: result.ride, bid: result.bid }).catch(() => {});

    return sendResponse(res, 200, 'Bid submitted successfully', result);
  } catch (error) {
    return fail(res, error, 'Failed to submit bid');
  }
};

const transition = (nextStatus, message, { requireOtp = false } = {}) => async (req, res) => {
  try {
    const partnerId = await resolveRider(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');

    const current = await loadOwnedRide(req.params.rideId, partnerId);

    if (requireOtp && current.otp) {
      const given = String(req.body?.otp ?? '').trim();
      if (!given) return sendError(res, 400, 'Ask the passenger for the ride code');
      if (given !== String(current.otp)) return sendError(res, 400, 'That ride code is not correct');
    }

    await updateRideLifecycle({
      rideId: current._id,
      driverId: partnerId,
      nextStatus,
      paymentMethod: req.body?.paymentMethod,
      collectedVia: req.body?.collectedVia,
    });
    await broadcastRideProgress(current._id);

    const ride = await loadOwnedRide(current._id, partnerId);
    return sendResponse(res, 200, message, {
      order: await buildRideJob(ride, { partnerId, riderPosition: await riderPositionOf(partnerId) }),
    });
  } catch (error) {
    return fail(res, error, 'Failed to update ride');
  }
};

/** Rider reached the passenger. */
export const reachedPickupController = transition(RIDE_LIVE_STATUS.ARRIVING, 'Arrived at pickup');
/** Passenger confirmed with the ride code; the trip begins. */
export const startRideController = transition(RIDE_LIVE_STATUS.STARTED, 'Ride started', { requireOtp: true });
/** Rider reached the destination. */
export const reachedDropController = transition(RIDE_LIVE_STATUS.ARRIVED, 'Reached destination');
/** Fare collected (or already paid online); the ride is settled. */
export const completeRideController = transition(RIDE_LIVE_STATUS.COMPLETED, 'Ride completed');

/** Parcel trips: the photo of the parcel at pickup / handover (required before start / complete). */
export const parcelProofController = async (req, res) => {
  try {
    const partnerId = await resolveRider(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');
    await saveParcelProof({
      rideId: req.params.rideId,
      driverId: partnerId,
      stage: req.body?.stage,
      imageUrl: req.body?.imageUrl || req.body?.url,
    });
    await broadcastRideProgress(req.params.rideId);
    const ride = await loadOwnedRide(req.params.rideId, partnerId);
    return sendResponse(res, 200, 'Parcel photo saved', {
      order: await buildRideJob(ride, { partnerId, riderPosition: await riderPositionOf(partnerId) }),
    });
  } catch (error) {
    return fail(res, error, 'Failed to save parcel photo');
  }
};

/** Live position while on a ride - the passenger's map follows this. */
export const updateRideLocationController = async (req, res) => {
  try {
    const partnerId = await resolveRider(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');
    const { lat, lng, heading, speed } = req.body || {};
    const update = await updateRideDriverLocation({
      rideId: req.params.rideId,
      driverId: partnerId,
      coordinates: [Number(lng), Number(lat)],
      heading,
      speed,
    });
    getSocketServer()
      ?.to(getRideRoom(req.params.rideId))
      .emit(SOCKET_EVENTS.RIDE_DRIVER_LOCATION_UPDATED, {
        ...update,
        lat: update.coordinates[1],
        lng: update.coordinates[0],
      });
    mirrorRideDriverLocation({
      rideId: req.params.rideId,
      coordinates: update.coordinates,
      heading: update.heading,
      speed: update.speed,
    }).catch(() => {});
    return sendResponse(res, 200, 'Location updated', update);
  } catch (error) {
    return fail(res, error, 'Failed to update location');
  }
};
