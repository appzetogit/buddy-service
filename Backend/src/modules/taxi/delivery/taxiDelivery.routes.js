import express from 'express';
import { authMiddleware } from '../../../core/auth/auth.middleware.js';
import { requireRoles } from '../../../core/roles/role.middleware.js';
import { RIDER_PLATFORM_ROLES } from '../shared/partner.js';
import {
  acceptRideController,
  completeRideController,
  getRideJob,
  giveBackRideController,
  listAvailableRides,
  listCurrentRides,
  listScheduledRides,
  parcelProofController,
  reachedDropController,
  reachedPickupController,
  rejectRideController,
  startRideController,
  submitBidController,
  updateRideLocationController,
} from './taxiDelivery.controller.js';

/**
 * Mounted at /api/v1/taxi/delivery. Same rider accounts as Food and Quick Commerce
 * (DELIVERY_PARTNER legacy login, DRIVER unified identity).
 */
export const taxiDeliveryRouter = express.Router();

const riderOnly = [authMiddleware, requireRoles(...RIDER_PLATFORM_ROLES)];

taxiDeliveryRouter.get('/rides/available', ...riderOnly, listAvailableRides);
taxiDeliveryRouter.get('/rides/current', ...riderOnly, listCurrentRides);
taxiDeliveryRouter.get('/rides/scheduled', ...riderOnly, listScheduledRides);
taxiDeliveryRouter.get('/rides/:rideId', ...riderOnly, getRideJob);
taxiDeliveryRouter.patch('/rides/:rideId/accept', ...riderOnly, acceptRideController);
taxiDeliveryRouter.post('/rides/:rideId/accept', ...riderOnly, acceptRideController);
taxiDeliveryRouter.post('/bids', ...riderOnly, submitBidController);
taxiDeliveryRouter.post('/rides/:rideId/bid', ...riderOnly, submitBidController);
taxiDeliveryRouter.patch('/rides/:rideId/give-back', ...riderOnly, giveBackRideController);
taxiDeliveryRouter.patch('/rides/:rideId/reject', ...riderOnly, rejectRideController);
taxiDeliveryRouter.patch('/rides/:rideId/reached-pickup', ...riderOnly, reachedPickupController);
taxiDeliveryRouter.post('/rides/:rideId/start', ...riderOnly, startRideController);
taxiDeliveryRouter.patch('/rides/:rideId/reached-drop', ...riderOnly, reachedDropController);
taxiDeliveryRouter.patch('/rides/:rideId/complete', ...riderOnly, completeRideController);
taxiDeliveryRouter.post('/rides/:rideId/parcel-proof', ...riderOnly, parcelProofController);
taxiDeliveryRouter.post('/rides/:rideId/location', ...riderOnly, updateRideLocationController);
