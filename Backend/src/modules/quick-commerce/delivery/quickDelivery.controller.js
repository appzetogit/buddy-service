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
  emitQuickOrderUpdate,
} from '../services/quickDispatch.service.js';
import { syncSellerOrderFromDelivery } from '../services/quickOrder.service.js';
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

const loadOrderForPartner = async (orderId, partnerId) => {
  if (!mongoose.Types.ObjectId.isValid(String(orderId))) return null;
  return QuickOrder.findOne({
    _id: orderId,
    'dispatch.deliveryPartnerId': new mongoose.Types.ObjectId(String(partnerId)),
  });
};

/** Offers currently on this rider's screen. */
export const listAvailableQuickOrders = async (req, res) => {
  try {
    const partnerId = await resolvePartnerId(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');

    const orders = await QuickOrder.find({
      orderStatus: { $in: ['placed', 'confirmed', 'preparing', 'ready_for_pickup'] },
      'dispatch.acceptedAt': { $exists: false },
      'dispatch.offeredTo.partnerId': new mongoose.Types.ObjectId(partnerId),
      $or: [
        { 'dispatch.deliveryPartnerId': null },
        { 'dispatch.deliveryPartnerId': { $exists: false } },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    return sendResponse(res, 200, 'Available quick commerce orders', {
      orders: orders.map(buildQuickOfferPayload),
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
      'dispatch.deliveryPartnerId': new mongoose.Types.ObjectId(partnerId),
      orderStatus: { $in: ACTIVE_STATUSES },
    })
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

    const order = await QuickOrder.findById(req.params.orderId).select('+deliveryOtp').lean();
    if (!order) return sendError(res, 404, 'Order not found');

    const assigned = String(order?.dispatch?.deliveryPartnerId || '') === String(partnerId);
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

/** Phase-only updates (arrived at shop / at the customer's door). */
const setPhase = (phase, deliveryStatus, message) => async (req, res) => {
  try {
    const partnerId = await resolvePartnerId(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');

    const order = await loadOrderForPartner(req.params.orderId, partnerId);
    if (!order) return sendError(res, 404, 'Order not found for this rider');

    order.deliveryState = order.deliveryState || {};
    order.deliveryState.currentPhase = phase;
    order.deliveryState.status = deliveryStatus;
    await order.save();
    await emitQuickOrderUpdate(order, 'order_update');

    return sendResponse(res, 200, message, { order: buildQuickOfferPayload(order) });
  } catch (error) {
    logger.error(`[QuickDelivery] phase ${phase} failed: ${error.message}`);
    return sendError(res, 500, 'Failed to update order');
  }
};

export const reachedPickupController = setPhase('at_pickup', 'reached_pickup', 'Marked as reached pickup');
export const reachedDropController = setPhase('at_drop', 'reached_drop', 'Marked as reached drop');

/** Rider collected the parcel from the seller. */
export const confirmPickupController = async (req, res) => {
  try {
    const partnerId = await resolvePartnerId(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');

    const order = await loadOrderForPartner(req.params.orderId, partnerId);
    if (!order) return sendError(res, 404, 'Order not found for this rider');
    if (order.orderStatus === 'picked_up') {
      return sendResponse(res, 200, 'Already picked up', { order: buildQuickOfferPayload(order) });
    }

    order.orderStatus = 'picked_up';
    order.deliveryState = order.deliveryState || {};
    order.deliveryState.currentPhase = 'en_route_to_delivery';
    order.deliveryState.status = 'picked_up';
    if (req.body?.billImageUrl) order.deliveryState.billImageUrl = String(req.body.billImageUrl);
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({
      byRole: 'DELIVERY_PARTNER',
      from: 'confirmed',
      to: 'picked_up',
      note: 'Rider collected the order from the seller',
      at: new Date(),
    });
    await order.save();

    await syncSellerOrderFromDelivery(order._id, 'picked_up').catch((err) =>
      logger.warn(`[QuickDelivery] seller sync (picked_up) failed: ${err.message}`),
    );
    await emitQuickOrderUpdate(order, 'order_update');

    return sendResponse(res, 200, 'Pickup confirmed', { order: buildQuickOfferPayload(order) });
  } catch (error) {
    logger.error(`[QuickDelivery] confirmPickup failed: ${error.message}`);
    return sendError(res, 500, 'Failed to confirm pickup');
  }
};

/** Handover code check at the customer's door. */
export const verifyDropOtpController = async (req, res) => {
  try {
    const partnerId = await resolvePartnerId(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');

    const order = await QuickOrder.findOne({
      _id: req.params.orderId,
      'dispatch.deliveryPartnerId': new mongoose.Types.ObjectId(partnerId),
    }).select('+deliveryOtp');
    if (!order) return sendError(res, 404, 'Order not found for this rider');

    const supplied = String(req.body?.otp || '').trim();
    const expected = String(order.deliveryOtp || '').trim();
    if (!expected) return sendError(res, 400, 'No handover code set for this order');
    if (supplied !== expected) return sendError(res, 400, 'Incorrect handover code');

    return sendResponse(res, 200, 'Handover code verified', { verified: true });
  } catch (error) {
    logger.error(`[QuickDelivery] verifyDropOtp failed: ${error.message}`);
    return sendError(res, 500, 'Failed to verify handover code');
  }
};

/** Delivered: closes the rider job and the seller order together. */
export const completeQuickOrderController = async (req, res) => {
  try {
    const partnerId = await resolvePartnerId(req);
    if (!partnerId) return sendError(res, 403, 'Delivery partner profile not found');

    const order = await QuickOrder.findOne({
      _id: req.params.orderId,
      'dispatch.deliveryPartnerId': new mongoose.Types.ObjectId(partnerId),
    }).select('+deliveryOtp');
    if (!order) return sendError(res, 404, 'Order not found for this rider');
    if (order.orderStatus === 'delivered') {
      return sendResponse(res, 200, 'Already delivered', { order: buildQuickOfferPayload(order) });
    }

    const expected = String(order.deliveryOtp || '').trim();
    const supplied = String(req.body?.otp || '').trim();
    if (expected && supplied && supplied !== expected) {
      return sendError(res, 400, 'Incorrect handover code');
    }

    order.orderStatus = 'delivered';
    order.deliveryState = order.deliveryState || {};
    order.deliveryState.currentPhase = 'delivered';
    order.deliveryState.status = 'delivered';
    order.deliveredAt = new Date();
    if (String(order.payment?.method || '').toLowerCase() === 'cash') {
      order.payment.status = 'paid';
    }
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({
      byRole: 'DELIVERY_PARTNER',
      from: 'picked_up',
      to: 'delivered',
      note: 'Rider delivered the order',
      at: new Date(),
    });
    // Handover code is single-use.
    order.deliveryOtp = '';
    await order.save();

    await syncSellerOrderFromDelivery(order._id, 'delivered').catch((err) =>
      logger.warn(`[QuickDelivery] seller sync (delivered) failed: ${err.message}`),
    );
    await emitQuickOrderUpdate(order, 'order_update');

    return sendResponse(res, 200, 'Order delivered', { order: buildQuickOfferPayload(order) });
  } catch (error) {
    logger.error(`[QuickDelivery] complete failed: ${error.message}`);
    return sendError(res, 500, 'Failed to complete order');
  }
};
