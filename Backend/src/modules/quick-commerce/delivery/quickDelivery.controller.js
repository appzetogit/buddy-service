/**
 * Rider-facing Quick Commerce endpoints.
 *
 * Same rider account and app as Food — only the data source differs (quick_orders instead of
 * food_orders), so these mirror the Food delivery endpoints the app already calls.
 */
import mongoose from 'mongoose';
import { QuickOrder } from '../models/order.model.js';
import { Seller } from '../seller/models/seller.model.js';
import { FoodDeliveryPartner } from '../../food/delivery/models/deliveryPartner.model.js';
import {
  acceptQuickOrder,
  rejectQuickOrder,
  buildQuickOfferPayload,
} from '../services/quickDispatch.service.js';
import {
  completeDelivery,
  confirmPickup,
  reachedDrop,
  reachedPickup,
  verifyDropOtp,
} from '../services/quickRiderFlow.service.js';
import {
  acceptSharedQuickOrder,
  confirmQuickSplit,
  reportQuickOrderDelay,
  shareQuickOrder,
} from '../services/quickOrderFlows.service.js';
import {
  CAPACITY_REACHED_MESSAGE,
  getRiderCapacity,
} from '../../food/orders/services/rider-capacity.service.js';
import { sendResponse, sendError } from '../../../utils/response.js';
import { logger } from '../../../utils/logger.js';

/** Statuses a rider still has work to do on. */
const ACTIVE_STATUSES = ['confirmed', 'preparing', 'ready_for_pickup', 'picked_up'];

/**
 * The rider token may carry either the delivery-partner id (legacy food login) or the unified
 * identity id, so accept both.
 */
const resolvePartnerId = async (req) => {
  const userId = req.user?.userId;
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return null;
  const direct = await FoodDeliveryPartner.findById(userId).select('_id').lean();
  if (direct) return String(direct._id);
  const byIdentity = await FoodDeliveryPartner.findOne({ identityId: userId }).select('_id').lean();
  return byIdentity ? String(byIdentity._id) : null;
};

/** Primary rider or the second rider of a shared order. */
const riderOnOrder = (partnerId) => {
  const id = new mongoose.Types.ObjectId(String(partnerId));
  return { $or: [{ 'dispatch.deliveryPartnerId': id }, { 'dispatch.sharedPartnerId': id }] };
};

/** Offers currently on this rider's screen. */
export const listAvailableQuickOrders = async (req, res) => {
  try {
    const partnerId = await resolvePartnerId(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');

    // A rider at their stacking limit gets no offer cards - matches the Food available list,
    // and keeps the app from showing an offer that accept would reject anyway.
    const capacity = await getRiderCapacity(partnerId);
    if (!capacity.canAcceptMore) {
      return sendResponse(res, 200, 'Available quick commerce orders', {
        orders: [],
        orderCapacity: capacity,
      });
    }

    const orders = await QuickOrder.find({
      orderStatus: { $in: ['placed', 'confirmed', 'preparing', 'ready_for_pickup'] },
      'dispatch.acceptedAt': { $exists: false },
      $or: [
        // Offered to me and still open...
        {
          'dispatch.offeredTo.partnerId': new mongoose.Types.ObjectId(partnerId),
          $or: [
            { 'dispatch.deliveryPartnerId': null },
            { 'dispatch.deliveryPartnerId': { $exists: false } },
          ],
        },
        // ...or an admin handed it to me and I have not answered yet.
        { 'dispatch.status': 'assigned', 'dispatch.deliveryPartnerId': new mongoose.Types.ObjectId(partnerId) },
      ],
    })
      .select('+pickupOtp')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    return sendResponse(res, 200, 'Available quick commerce orders', {
      orders: orders.map(buildQuickOfferPayload),
      orderCapacity: capacity,
    });
  } catch (error) {
    logger.error(`[QuickDelivery] listAvailable failed: ${error.message}`);
    return sendError(res, 500, 'Failed to load quick commerce offers');
  }
};

/** The rider's in-flight QC jobs. */
export const listCurrentQuickOrders = async (req, res) => {
  try {
    const partnerId = await resolvePartnerId(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');

    const orders = await QuickOrder.find({
      ...riderOnOrder(partnerId),
      orderStatus: { $in: ACTIVE_STATUSES },
    })
      .select('+pickupOtp')
      .sort({ 'dispatch.acceptedAt': -1 })
      .lean();

    return sendResponse(res, 200, 'Current quick commerce orders', {
      orders: orders.map(buildQuickOfferPayload),
    });
  } catch (error) {
    logger.error(`[QuickDelivery] listCurrent failed: ${error.message}`);
    return sendError(res, 500, 'Failed to load current quick commerce orders');
  }
};

export const getQuickOrderDetails = async (req, res) => {
  try {
    const partnerId = await resolvePartnerId(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');

    const order = await QuickOrder.findById(req.params.orderId).select('+deliveryOtp +pickupOtp').lean();
    if (!order) return sendError(res, 404, 'Order not found');

    const assigned =
      String(order?.dispatch?.deliveryPartnerId || '') === String(partnerId) ||
      String(order?.dispatch?.sharedPartnerId || '') === String(partnerId);
    const offered = (order?.dispatch?.offeredTo || []).some(
      (o) => String(o.partnerId) === String(partnerId),
    );
    if (!assigned && !offered) return sendError(res, 403, 'This order is not assigned to you');

    const payload = buildQuickOfferPayload(order);
    const seller = payload.restaurantId && mongoose.Types.ObjectId.isValid(String(payload.restaurantId))
      ? await Seller.findById(payload.restaurantId).select('shopName name phone location shopInfo').lean()
      : null;

    return sendResponse(res, 200, 'Quick commerce order', {
      order: {
        ...payload,
        seller,
        // Only the assigned rider may see the handover code.
        handoverOtp: assigned ? String(order.deliveryOtp || '') : '',
      },
    });
  } catch (error) {
    logger.error(`[QuickDelivery] getDetails failed: ${error.message}`);
    return sendError(res, 500, 'Failed to load order');
  }
};

export const acceptQuickOrderController = async (req, res) => {
  try {
    const partnerId = await resolvePartnerId(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');

    const result = await acceptQuickOrder(req.params.orderId, partnerId);
    if (!result.ok) {
      if (result.reason === 'AT_CAPACITY') {
        return sendError(res, 409, result.message || CAPACITY_REACHED_MESSAGE);
      }
      const message = result.reason === 'ALREADY_TAKEN'
        ? 'This order has already been taken by another rider'
        : 'Unable to accept this order';
      return sendError(res, 409, message);
    }
    return sendResponse(res, 200, 'Order accepted', { order: buildQuickOfferPayload(result.order) });
  } catch (error) {
    logger.error(`[QuickDelivery] accept failed: ${error.message}`);
    return sendError(res, 500, 'Failed to accept order');
  }
};

export const rejectQuickOrderController = async (req, res) => {
  try {
    const partnerId = await resolvePartnerId(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');
    await rejectQuickOrder(req.params.orderId, partnerId);
    return sendResponse(res, 200, 'Order declined', {});
  } catch (error) {
    logger.error(`[QuickDelivery] reject failed: ${error.message}`);
    return sendError(res, 500, 'Failed to decline order');
  }
};

/** Wraps a rider-trip step: resolves the rider, runs it, maps domain errors to HTTP codes. */
const riderStep = (label, message, run) => async (req, res) => {
  try {
    const partnerId = await resolvePartnerId(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');
    const result = await run(req, partnerId);
    const order = result?.order || result;
    return sendResponse(res, 200, result?.message || message, {
      order: buildQuickOfferPayload(order),
      ...(result?.waitingForPartner ? { waitingForPartner: true } : {}),
      ...(result?.verified ? { verified: true } : {}),
    });
  } catch (error) {
    return sendFlowError(res, error, `Failed to ${label}`);
  }
};

export const reachedPickupController = riderStep('mark reached pickup', 'Marked as reached pickup', (req, partnerId) =>
  reachedPickup(req.params.orderId, partnerId),
);

/** Rider collected the parcel from the store (one store at a time on multi-store orders). */
export const confirmPickupController = riderStep('confirm pickup', 'Pickup confirmed', (req, partnerId) =>
  confirmPickup(req.params.orderId, partnerId, { billImageUrl: req.body?.billImageUrl, pickupOtp: req.body?.pickupOtp }),
);

export const reachedDropController = riderStep('mark reached drop', 'Marked as reached drop', (req, partnerId) =>
  reachedDrop(req.params.orderId, partnerId),
);

/** Handover code check at the customer's door. */
export const verifyDropOtpController = riderStep('verify handover code', 'Handover code verified', (req, partnerId) =>
  verifyDropOtp(req.params.orderId, partnerId, req.body?.otp),
);

/** Delivered: closes the rider job and the seller order together (each leg on a shared order). */
export const completeQuickOrderController = riderStep('complete order', 'Order delivered', async (req, partnerId) => {
  const result = await completeDelivery(req.params.orderId, partnerId, { otp: req.body?.otp });
  return {
    ...result,
    message: result.waitingForPartner ? 'Your delivery is done. Waiting for your partner to finish.' : 'Order delivered',
  };
});

/** Maps the flow services' thrown errors to HTTP status codes. */
const sendFlowError = (res, error, fallback) => {
  const name = error?.name || error?.constructor?.name || '';
  const status = /Validation/.test(name) ? 400 : /Forbidden/.test(name) ? 403 : /NotFound/.test(name) ? 404 : 500;
  if (status === 500) logger.error(`[QuickDelivery] ${fallback}: ${error?.message}`);
  return sendError(res, status, status === 500 ? fallback : error.message);
};

/** Primary rider asks for a second rider ("Find new driver"). */
export const shareQuickOrderController = async (req, res) => {
  try {
    const partnerId = await resolvePartnerId(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');
    const order = await shareQuickOrder(req.params.orderId, partnerId);
    return sendResponse(res, 200, 'Looking for another driver', { order: buildQuickOfferPayload(order) });
  } catch (error) {
    return sendFlowError(res, error, 'Failed to find a new driver');
  }
};

/** Another rider joins an open second-rider slot. */
export const acceptSharedQuickOrderController = async (req, res) => {
  try {
    const partnerId = await resolvePartnerId(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');
    const order = await acceptSharedQuickOrder(req.params.orderId, partnerId);
    return sendResponse(res, 200, 'Joined the delivery', { order: buildQuickOfferPayload(order) });
  } catch (error) {
    return sendFlowError(res, error, 'Failed to join this order');
  }
};

export const confirmQuickSplitController = async (req, res) => {
  try {
    const partnerId = await resolvePartnerId(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');
    const order = await confirmQuickSplit(req.params.orderId, partnerId);
    return sendResponse(res, 200, 'Earnings split confirmed', { order: buildQuickOfferPayload(order) });
  } catch (error) {
    return sendFlowError(res, error, 'Failed to confirm split');
  }
};

export const reportQuickDelayController = async (req, res) => {
  try {
    const partnerId = await resolvePartnerId(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return sendError(res, 400, 'A delay reason is required');
    const order = await reportQuickOrderDelay(req.params.orderId, partnerId, 'DELIVERY_PARTNER', reason);
    return sendResponse(res, 200, 'Delay reported to customer', { order: buildQuickOfferPayload(order) });
  } catch (error) {
    return sendFlowError(res, error, 'Failed to report delay');
  }
};
