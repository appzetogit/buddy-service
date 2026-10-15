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
  acceptRideAssignment,
  getRideDetails,
  getRideRoom,
  saveParcelProof,
  serializeRideRealtime,
  updateRideDriverLocation,
  updateRideLifecycle,
} from '../services/rideService.js';
import {
  getSocketServer,
  markDriverRejectedFromDispatch,
  notifyRideAccepted,
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
    const position = await riderPositionOf(partnerId);
    const orders = await Promise.all(rides.map((ride) => buildRideJob(ride, { riderPosition: position, partnerId })));
    return sendResponse(res, 200, 'Current rides', { orders });
  } catch (error) {
    return fail(res, error, 'Failed to load current rides');
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
