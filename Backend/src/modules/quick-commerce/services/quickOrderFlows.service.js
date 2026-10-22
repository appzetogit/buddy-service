/**
 * Quick Commerce order flows that mirror Food's lifecycle:
 *
 *  - cancellation (user / seller timeout / admin / no rider found) with refund + stock + rider release
 *  - admin manual rider assign / reassign / second rider
 *  - rider-initiated second rider ("Find new driver") + split confirmation
 *  - delay reporting (rider / seller -> customer)
 *  - scheduled orders (activate 30 min before the slot)
 *  - watchdogs: seller did not respond, no rider found
 *
 * Everything here works on QuickOrder only. It reuses Food's shared building blocks (rider
 * selection, capacity, notifications, earning split) but never writes to a Food collection.
 */
import mongoose from 'mongoose';
import { QuickOrder } from '../models/order.model.js';
import { SellerOrder } from '../seller/models/sellerOrder.model.js';
import { FoodDeliveryPartner } from '../../food/delivery/models/deliveryPartner.model.js';
import { listNearbyOnlineDeliveryPartners } from '../../food/orders/services/order-dispatch.service.js';
import {
  applyEmploymentAwareDualEarnings,
  generateFourDigitDeliveryOtp,
  notifyOwnerSafely,
  notifyOwnersSafely,
} from '../../food/orders/services/order.helpers.js';
import {
  buildDeliveryLegs,
  getLegProgress,
  getPendingLegHandoverOtps,
  isDualLegActive,
  isShareRequired,
} from '../../food/orders/services/order-lifecycle.policy.js';
import { assertRiderHasFreeSlot } from '../../food/orders/services/rider-capacity.service.js';
import * as foodTransactionService from '../../food/orders/services/foodTransaction.service.js';
import { ValidationError, NotFoundError, ForbiddenError } from '../../../core/auth/errors.js';
import { refundWalletBalance } from '../../food/user/services/userWallet.service.js';
import { initiateRazorpayRefund } from '../../food/orders/helpers/razorpay.helper.js';
import { getIO, rooms } from '../../../config/socket.js';
import { logger } from '../../../utils/logger.js';
import { processQuickOrderRefund } from './quickRefund.service.js';
import { emitQuickCommerceStatusUpdate } from './quickStatusRealtime.service.js';
import { restoreQuickOrderItemsStock, restoreQuickOrderStockOnce } from '../utils/stock.helpers.js';
import { restoreSellerCouponUsageForOrder } from '../utils/sellerCouponUsage.helpers.js';
import {
  getSellerVisibleQuickOrderPaymentFilter,
  isQuickOrderVisibleToSeller,
} from '../utils/sellerOrderVisibility.helpers.js';
import { getQuickDeliverySettings } from './quickDeliverySettings.service.js';
import { buildQuickOfferPayload, dispatchQuickOrder, emitQuickOrderUpdate } from './quickDispatch.service.js';

export const QUICK_TERMINAL_STATUSES = [
  'delivered',
  'cancelled_by_user',
  'cancelled_by_restaurant',
  'cancelled_by_admin',
  'cancelled_by_system',
];

/** A rider can still be swapped while the parcel is with the shop. */
const REASSIGNABLE_STATUSES = ['placed', 'created', 'confirmed', 'preparing', 'ready_for_pickup'];
/** Statuses in which a rider may ask for a second rider. */
const SHAREABLE_STATUSES = ['confirmed', 'preparing', 'ready_for_pickup', 'picked_up'];

const toId = (value) => {
  const raw = value?._id || value;
  return raw ? String(raw) : '';
};

const asObjectId = (value) =>
  mongoose.Types.ObjectId.isValid(String(value || '')) ? new mongoose.Types.ObjectId(String(value)) : null;

const findOrderByIdentity = async (orderId) => {
  const raw = String(orderId || '').trim();
  if (!raw) return null;
  if (mongoose.Types.ObjectId.isValid(raw)) {
    const byId = await QuickOrder.findById(raw);
    if (byId) return byId;
  }
  return QuickOrder.findOne({ orderId: raw });
};

const emitToRider = (partnerId, event, payload) => {
  if (!partnerId) return;
  try {
    getIO()?.to(rooms.delivery(String(partnerId))).emit(event, payload);
  } catch (err) {
    logger.warn(`[QuickFlows] emit ${event} failed: ${err.message}`);
  }
};

const involvedRiderIds = (order) => {
  const ids = new Set();
  if (order?.dispatch?.deliveryPartnerId) ids.add(toId(order.dispatch.deliveryPartnerId));
  if (order?.dispatch?.sharedPartnerId) ids.add(toId(order.dispatch.sharedPartnerId));
  return [...ids].filter(Boolean);
};

/**
 * Tell every seller leg of a cancelled/withdrawn order to close its new-order popup: socket
 * event for an open app, FCM data push for a killed one. Mirrors releaseRidersForCancelledQuickOrder.
 */
export async function notifySellersOrderWithdrawn(order, { sellerLegs } = {}) {
  if (!order) return;
  const mongoId = toId(order._id);
  const legs = sellerLegs || (await SellerOrder.find({ orderId: order.orderId }).select('sellerId _id').lean());
  if (!legs?.length) return;

  legs.forEach((leg) => {
    try {
      getIO()
        ?.to(rooms.seller(String(leg.sellerId)))
        .emit('order_status_update', {
          orderId: order.orderId,
          orderMongoId: mongoId,
          orderStatus: order.orderStatus,
          status: 'cancelled',
          message: `Order #${order.orderId} was cancelled.`,
        });
    } catch {
      /* socket optional */
    }

    void notifyOwnerSafely(
      { ownerType: 'SELLER', ownerId: leg.sellerId },
      {
        title: 'Order cancelled',
        body: `Order #${order.orderId} was cancelled.`,
        data: {
          type: 'order_cancelled',
          orderId: String(order.orderId),
          sellerOrderId: toId(leg._id),
          orderMongoId: mongoId,
        },
      },
    ).catch(() => {});
  });
}

/**
 * Tell every rider tied to a cancelled order to let go of it: the assigned rider(s) get
 * `order_cancelled`, riders who merely hold an unanswered offer get the "taken" signal that
 * closes their offer card.
 */
export async function releaseRidersForCancelledQuickOrder(order, { message = 'This order was cancelled.' } = {}) {
  if (!order) return;
  const mongoId = toId(order._id);
  const assigned = involvedRiderIds(order);
  const payload = {
    orderMongoId: mongoId,
    orderId: mongoId,
    orderNumber: order.orderId,
    orderKind: 'quick',
    orderStatus: order.orderStatus,
    status: 'cancelled',
    message,
  };

  assigned.forEach((partnerId) => {
    emitToRider(partnerId, 'order_status_update', payload);
    emitToRider(partnerId, 'order_cancelled', payload);
  });

  const offeredOnly = (order.dispatch?.offeredTo || [])
    .map((o) => toId(o.partnerId))
    .filter((id) => id && !assigned.includes(id));
  [...new Set(offeredOnly)].forEach((partnerId) =>
    emitToRider(partnerId, 'order_claimed', { orderId: mongoId, orderMongoId: mongoId, orderKind: 'quick' }),
  );

  if (assigned.length) {
    void notifyOwnersSafely(
      assigned.map((ownerId) => ({ ownerType: 'DELIVERY_PARTNER', ownerId })),
      {
        title: 'Order cancelled',
        body: `Order #${order.orderId || mongoId} was cancelled. You are free to accept new orders.`,
        data: { type: 'order_cancelled', orderId: mongoId, orderMongoId: mongoId, orderKind: 'quick' },
      },
    ).catch(() => {});
  }

  try {
    await QuickOrder.updateOne(
      { _id: order._id },
      { $set: { 'dispatch.status': 'cancelled', 'dispatch.isShared': false, 'deliveryState.currentPhase': 'cancelled' } },
    );
  } catch (err) {
    logger.warn(`[QuickFlows] could not mark dispatch cancelled for ${mongoId}: ${err.message}`);
  }
}

/**
 * Atomically cancel a QC order and run every side effect (refund, stock, coupon, transaction,
 * seller leg, rider release, customer notification). Idempotent: a second call finds the order
 * already terminal and throws.
 */
export async function finalizeQuickCancellation(order, opts = {}) {
  const {
    toStatus,
    cancelledBy,
    byRole = 'SYSTEM',
    byId = undefined,
    reason = '',
    refundTo = 'gateway',
    allowAfterPickup = false,
    userMessage = '',
  } = opts;

  const from = String(order.orderStatus || '');
  if (QUICK_TERMINAL_STATUSES.includes(from)) {
    throw new ValidationError(`Order is already ${from.replace(/_/g, ' ')}`);
  }
  if (from === 'picked_up' && !allowAfterPickup) {
    throw new ValidationError('Order can no longer be cancelled once it is picked up');
  }

  const paymentStatusUpdate =
    order.payment?.method === 'cash' && order.payment?.status !== 'paid' ? { 'payment.status': 'failed' } : {};

  const claimed = await QuickOrder.findOneAndUpdate(
    { _id: order._id, orderStatus: { $nin: QUICK_TERMINAL_STATUSES } },
    {
      $set: {
        orderStatus: toStatus,
        cancelledBy,
        cancellationReason: reason,
        ...paymentStatusUpdate,
      },
      $push: {
        statusHistory: { byRole, ...(byId ? { byId } : {}), from, to: toStatus, note: reason, at: new Date() },
      },
    },
    { new: true },
  );
  if (!claimed) throw new ValidationError('Order can no longer be cancelled');

  let refundResult = null;
  try {
    refundResult = await processQuickOrderRefund(claimed, { refundTo, cancelledBy, reason });
    await claimed.save();
  } catch (err) {
    logger.error(`[QuickFlows] refund failed for ${claimed.orderId}: ${err.message}`);
  }

  const stockEligible =
    claimed.payment?.method !== 'razorpay' ||
    ['paid', 'refunded'].includes(String(claimed.payment?.status || '').toLowerCase());
  if (stockEligible) {
    await restoreQuickOrderStockOnce(claimed).catch((err) =>
      logger.warn(`[QuickFlows] stock restore failed for ${claimed.orderId}: ${err.message}`),
    );
  }
  await restoreSellerCouponUsageForOrder(claimed).catch((err) =>
    logger.warn(`[QuickFlows] coupon restore failed for ${claimed.orderId}: ${err.message}`),
  );

  try {
    const paid = ['paid', 'refunded'].includes(String(claimed.payment?.status || '').toLowerCase());
    await foodTransactionService.updateTransactionStatus(claimed._id, toStatus, {
      status: claimed.payment?.status === 'refunded' ? 'refunded' : paid ? 'captured' : 'failed',
      note: reason,
      recordedByRole: byRole,
      ...(byId ? { recordedById: byId } : {}),
    });
  } catch (err) {
    logger.warn(`[QuickFlows] transaction sync failed for ${claimed.orderId}: ${err.message}`);
  }

  await SellerOrder.updateMany(
    { orderId: claimed.orderId, status: { $nin: ['cancelled', 'delivered'] } },
    { $set: { status: 'cancelled', workflowStatus: 'CANCELLED', cancellationReason: reason } },
  ).catch(() => {});

  const message = userMessage || refundResult?.message || 'Your order was cancelled.';
  await releaseRidersForCancelledQuickOrder(claimed, { message: `Order #${claimed.orderId} was cancelled.` });

  // Seller learns the order is gone (only matters once the rider-accept fan-out created a leg).
  await notifySellersOrderWithdrawn(claimed).catch(() => {});

  await emitQuickCommerceStatusUpdate(claimed, { message }).catch(() => {});
  await emitQuickOrderUpdate(claimed, 'order_update').catch(() => {});

  if (claimed.userId) {
    void notifyOwnerSafely(
      { ownerType: 'USER', ownerId: claimed.userId },
      {
        title: 'Order cancelled',
        body: message,
        data: { type: 'order_cancelled', orderId: String(claimed.orderId), orderMongoId: toId(claimed._id) },
      },
    ).catch(() => {});
  }

  return { order: claimed, refund: refundResult, message };
}

/** No rider accepted within the hunt budget: cancel + refund (preferring the wallet, like Food). */
export async function cancelQuickOrderNoDriverFound(orderId) {
  const order = await findOrderByIdentity(orderId);
  if (!order) return null;
  if (!['placed', 'created', 'scheduled'].includes(order.orderStatus)) return null;
  if (order.dispatch?.acceptedAt) return null;

  try {
    const result = await finalizeQuickCancellation(order, {
      toStatus: 'cancelled_by_admin',
      cancelledBy: 'system',
      byRole: 'SYSTEM',
      reason: 'No delivery partner found. Order cancelled and refund initiated where applicable.',
      refundTo: 'wallet',
      userMessage:
        'No delivery partner was available for your order, so it was cancelled. Any payment is being refunded.',
    });
    return result.order;
  } catch (err) {
    logger.warn(`[QuickFlows] no-driver cancel skipped for ${order._id}: ${err.message}`);
    return null;
  }
}

/** The store never responded after a rider accepted: cancel, refund, free the rider. */
export async function cancelQuickOrderSellerNoResponse(orderId) {
  const order = await findOrderByIdentity(orderId);
  if (!order) return null;
  try {
    const result = await finalizeQuickCancellation(order, {
      toStatus: 'cancelled_by_restaurant',
      cancelledBy: 'restaurant',
      byRole: 'SYSTEM',
      reason: 'Store did not respond in time. Order auto-cancelled, rider released, and refund initiated where applicable.',
      refundTo: 'gateway',
      userMessage: 'The store did not accept your order in time, so it was cancelled. Any payment is being refunded.',
    });
    return result.order;
  } catch (err) {
    logger.warn(`[QuickFlows] seller-timeout cancel skipped for ${order._id}: ${err.message}`);
    return null;
  }
}

export async function adminCancelQuickOrder(orderId, adminId, reason = '') {
  const order = await findOrderByIdentity(orderId);
  if (!order) throw new NotFoundError('Order not found');
  const text = String(reason || '').trim() || 'Cancelled by admin';
  return finalizeQuickCancellation(order, {
    toStatus: 'cancelled_by_admin',
    cancelledBy: 'admin',
    byRole: 'ADMIN',
    byId: asObjectId(adminId) || undefined,
    reason: text,
    refundTo: 'gateway',
    allowAfterPickup: true,
    userMessage: `Your order was cancelled by support. ${text}`,
  });
}

/** Riders the admin can hand an order to: online + approved, nearest first when we know the shop. */
export async function listAssignableQuickRiders(orderId) {
  const order = orderId ? await findOrderByIdentity(orderId) : null;
  const pickupPoint = (order?.pickupPoints || []).find((p) => p?.location?.coordinates?.length === 2);
  let nearby = [];
  if (pickupPoint) {
    try {
      const { partners = [] } = await listNearbyOnlineDeliveryPartners(
        { _id: pickupPoint.sourceId, location: { type: 'Point', coordinates: pickupPoint.location.coordinates } },
        { maxKm: 60, limit: 50, requiredAmount: 0, allowOverLimitFallback: true, service: 'quickCommerce' },
      );
      nearby = partners;
    } catch (err) {
      logger.warn(`[QuickFlows] nearby rider lookup failed: ${err.message}`);
    }
  }
  const distance = new Map(nearby.map((p) => [String(p.partnerId), p.distanceKm]));
  const ids = nearby.map((p) => p.partnerId);
  const riders = await FoodDeliveryPartner.find({
    $or: [{ _id: { $in: ids } }, { availabilityStatus: 'online', $or: [{ status: 'approved' }, { isVerified: true }] }],
  })
    .select('name phone status availabilityStatus vehicleType vehicleNumber')
    .limit(100)
    .lean();
  return riders
    .map((r) => ({
      _id: r._id,
      name: r.name || 'Delivery Partner',
      phone: r.phone || '',
      availabilityStatus: r.availabilityStatus || '',
      vehicleType: r.vehicleType || '',
      vehicleNumber: r.vehicleNumber || '',
      distanceKm: distance.has(String(r._id)) ? distance.get(String(r._id)) : null,
    }))
    .sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
}

const assertPartnerUsable = async (partnerId) => {
  const partner = await FoodDeliveryPartner.findById(partnerId).select('status isVerified name phone employmentType').lean();
  if (!partner || !(partner.status === 'approved' || partner.isVerified === true)) {
    throw new ValidationError('Delivery partner not available');
  }
  return partner;
};

/**
 * Admin hands the order to a specific rider (or swaps the rider). Like Food, the rider still has
 * to accept; if they don't, the normal hunt takes over again.
 */
export async function adminAssignQuickRider(orderId, partnerId, adminId) {
  const order = await findOrderByIdentity(orderId);
  if (!order) throw new NotFoundError('Order not found');
  if (!REASSIGNABLE_STATUSES.includes(order.orderStatus)) {
    throw new ValidationError(
      order.orderStatus === 'picked_up'
        ? 'The parcel is already picked up; the rider cannot be changed now'
        : 'Cannot assign a rider for this order',
    );
  }
  const partner = await assertPartnerUsable(partnerId);
  const previousId = toId(order.dispatch?.deliveryPartnerId) || null;
  if (previousId && previousId === String(partnerId)) {
    throw new ValidationError('This driver is already assigned to the order');
  }
  const droppedShared = toId(order.dispatch?.sharedPartnerId) || null;
  const now = new Date();
  const adminObjectId = asObjectId(adminId);
  const note = previousId
    ? `Reassigned by admin from ${previousId} to ${partner.name || partnerId}`
    : `Assigned by admin to ${partner.name || partnerId}`;

  const updated = await QuickOrder.findOneAndUpdate(
    {
      _id: order._id,
      orderStatus: { $in: REASSIGNABLE_STATUSES },
    },
    {
      $set: {
        'dispatch.status': 'assigned',
        'dispatch.deliveryPartnerId': new mongoose.Types.ObjectId(String(partnerId)),
        'dispatch.assignedAt': now,
        'dispatch.sharedPartnerId': null,
        'dispatch.isShared': false,
        'dispatch.shareOpenedAt': null,
        sharedRiderEarning: 0,
        isDualLeg: false,
        splitMode: 'none',
        legs: [],
      },
      $unset: { 'dispatch.acceptedAt': '', 'dispatch.dispatchingAt': '' },
      $push: {
        'dispatch.assignmentHistory': {
          at: now,
          action: previousId ? 'reassigned' : 'assigned',
          fromPartnerId: previousId ? new mongoose.Types.ObjectId(previousId) : null,
          toPartnerId: new mongoose.Types.ObjectId(String(partnerId)),
          byRole: 'ADMIN',
          byId: adminObjectId,
          note,
        },
        statusHistory: {
          byRole: 'ADMIN',
          ...(adminObjectId ? { byId: adminObjectId } : {}),
          from: order.dispatch?.status || 'unassigned',
          to: previousId ? 'reassigned' : 'assigned',
          note,
          at: now,
        },
      },
    },
    { new: true },
  );
  if (!updated) throw new ValidationError('Order changed while assigning. Please retry.');

  const payload = buildQuickOfferPayload(updated);
  emitToRider(partnerId, 'new_order_available', payload);
  emitToRider(partnerId, 'new_order', payload);
  // Riders who were still holding an open offer lose it: the order is reserved now.
  [...new Set((updated.dispatch?.offeredTo || []).map((o) => toId(o.partnerId)))]
    .filter((id) => id && id !== String(partnerId) && id !== previousId)
    .forEach((id) =>
      emitToRider(id, 'order_claimed', { orderId: toId(updated._id), orderMongoId: toId(updated._id), orderKind: 'quick' }),
    );
  [previousId, droppedShared]
    .filter((id) => id && id !== String(partnerId))
    .forEach((id) =>
      emitToRider(id, 'order_reassigned_elsewhere', {
        orderMongoId: toId(updated._id),
        orderId: toId(updated._id),
        orderKind: 'quick',
        message: 'This order has been reassigned to another delivery partner.',
      }),
    );

  void notifyOwnersSafely([{ ownerType: 'DELIVERY_PARTNER', ownerId: partnerId }], {
    title: previousId ? 'Order reassigned to you' : 'New order assigned',
    body: `You have been assigned Order #${updated.orderId}.`,
    ring: true,
    data: { type: 'new_order', orderId: toId(updated._id), orderMongoId: toId(updated._id), orderKind: 'quick' },
  }).catch(() => {});
  [previousId, droppedShared]
    .filter((id) => id && id !== String(partnerId))
    .forEach((id) =>
      void notifyOwnerSafely(
        { ownerType: 'DELIVERY_PARTNER', ownerId: id },
        {
          title: 'Order reassigned',
          body: `Order #${updated.orderId} has been reassigned. You are no longer on this delivery.`,
          data: { type: 'order_reassigned_elsewhere', orderId: toId(updated._id), orderMongoId: toId(updated._id) },
        },
      ).catch(() => {}),
    );

  await emitQuickCommerceStatusUpdate(updated, { message: 'A delivery partner has been assigned.' }).catch(() => {});
  return updated;
}

/** Split the rider payout between two riders (shared helper with Food keeps salary/per-order rules). */
const applySharedEarningSplit = async (order, primaryId, secondaryId) => {
  const [primary, secondary] = await Promise.all([
    FoodDeliveryPartner.findById(primaryId).select('employmentType').lean(),
    FoodDeliveryPartner.findById(secondaryId).select('employmentType').lean(),
  ]);
  applyEmploymentAwareDualEarnings(order, {
    primaryEmploymentType: primary?.employmentType || 'per_order',
    secondaryEmploymentType: secondary?.employmentType || 'per_order',
  });
};

/**
 * The order now runs as two independent legs (stores or items divided between the riders), each
 * with its own handover OTP. Persisted on the order; callers save it.
 */
const buildQuickLegs = (order, primaryId, secondaryId) => {
  const { legs, splitMode } = buildDeliveryLegs(order, {
    primaryPartnerId: primaryId,
    secondaryPartnerId: secondaryId,
    primaryEarning: order.riderEarning,
    secondaryEarning: order.sharedRiderEarning,
    otpFactory: generateFourDigitDeliveryOtp,
  });
  order.legs = legs;
  order.splitMode = splitMode;
  order.isDualLeg = true;
  order.markModified('legs');
};

/** Customer gets every leg's OTP so each rider can be handed the right one at the door. */
export const emitQuickLegOtpsToCustomer = (order) => {
  try {
    if (!order?.userId || !isDualLegActive(order)) return;
    const legOtps = getPendingLegHandoverOtps(order, { onlyAtDrop: false });
    if (!legOtps.length) return;
    getIO()
      ?.to(rooms.user(String(order.userId)))
      .emit('delivery_drop_otp', {
        orderMongoId: toId(order._id),
        orderId: order.orderId || toId(order._id),
        orderKind: 'quick',
        otp: legOtps[0].otp,
        legIndex: legOtps[0].legIndex,
        role: legOtps[0].role,
        partnerId: legOtps[0].partnerId,
        isDualLeg: true,
        legOtps,
        message: 'Share each OTP with the matching delivery partner at drop-off.',
      });
  } catch (err) {
    logger.warn(`[QuickFlows] leg OTP push failed: ${err.message}`);
  }
};

const announceSharedJoin = (order, primaryId, secondaryId) => {
  const payload = {
    orderId: toId(order._id),
    orderMongoId: toId(order._id),
    orderKind: 'quick',
    orderStatus: order.orderStatus,
    isDualLeg: Boolean(order.isDualLeg),
    splitMode: order.splitMode || null,
    legs: (order.legs || []).map((leg) => {
      const { otp, ...rest } = leg?.toObject?.() || leg || {};
      return { ...rest, hasOtp: Boolean(otp) };
    }),
    legProgress: getLegProgress(order),
    dispatch: order.dispatch,
    riderEarning: order.riderEarning,
    sharedRiderEarning: order.sharedRiderEarning,
  };
  [primaryId, secondaryId].forEach((id) => {
    emitToRider(id, 'order_shared_accepted', payload);
    emitToRider(id, 'order_status_update', payload);
  });
  try {
    if (order.userId) getIO()?.to(rooms.user(String(order.userId))).emit('delivery_partner_updated', payload);
    getIO()?.to('all_delivery').emit('order_claimed', { orderId: toId(order._id), orderMongoId: toId(order._id), orderKind: 'quick' });
  } catch {
    /* socket optional */
  }
};

/** Admin force-assigns the second rider (for when nobody picks up the open slot). */
export async function adminAssignSecondQuickRider(orderId, partnerId, adminId) {
  const order = await findOrderByIdentity(orderId);
  if (!order) throw new NotFoundError('Order not found');
  if (QUICK_TERMINAL_STATUSES.includes(order.orderStatus)) {
    throw new ValidationError('Cannot add a second driver to a closed order');
  }
  const primaryId = toId(order.dispatch?.deliveryPartnerId);
  if (!primaryId || !order.dispatch?.acceptedAt) {
    throw new ValidationError('Assign a primary delivery partner (who has accepted) first');
  }
  if (order.dispatch?.sharedPartnerId) {
    throw new ValidationError('Maximum 2 drivers already assigned');
  }
  if (primaryId === String(partnerId)) {
    throw new ValidationError('Second driver must be different from the primary driver');
  }
  await assertPartnerUsable(partnerId);
  await assertRiderHasFreeSlot(partnerId, { excludeOrderId: order._id });

  const claimed = await QuickOrder.findOneAndUpdate(
    { _id: order._id, 'dispatch.sharedPartnerId': null, orderStatus: { $nin: QUICK_TERMINAL_STATUSES } },
    {
      $set: { 'dispatch.sharedPartnerId': new mongoose.Types.ObjectId(String(partnerId)), 'dispatch.isShared': false },
      $push: {
        'dispatch.assignmentHistory': {
          at: new Date(),
          action: 'second_assigned',
          toPartnerId: new mongoose.Types.ObjectId(String(partnerId)),
          byRole: 'ADMIN',
          byId: asObjectId(adminId),
          note: 'Second rider assigned by admin',
        },
      },
    },
    { new: true },
  );
  if (!claimed) throw new ValidationError('A second driver is already assigned');

  await applySharedEarningSplit(claimed, primaryId, partnerId);
  buildQuickLegs(claimed, primaryId, String(partnerId));
  claimed.statusHistory.push({
    byRole: 'ADMIN',
    ...(asObjectId(adminId) ? { byId: asObjectId(adminId) } : {}),
    from: claimed.orderStatus,
    to: claimed.orderStatus,
    note: 'Second delivery partner assigned by admin',
    at: new Date(),
  });
  await claimed.save();

  announceSharedJoin(claimed, primaryId, String(partnerId));
  emitQuickLegOtpsToCustomer(claimed);
  void notifyOwnerSafely(
    { ownerType: 'DELIVERY_PARTNER', ownerId: partnerId },
    {
      title: 'Added to an order',
      body: `You have been added as the second rider on Order #${claimed.orderId}.`,
      data: { type: 'order_shared_accepted', orderId: toId(claimed._id), orderMongoId: toId(claimed._id), orderKind: 'quick' },
    },
  ).catch(() => {});
  return claimed;
}

/** Primary rider opens a second-rider search ("Find new driver") for a bulky order. */
export async function shareQuickOrder(orderId, partnerId) {
  const order = await findOrderByIdentity(orderId);
  if (!order || toId(order.dispatch?.deliveryPartnerId) !== String(partnerId)) {
    throw new NotFoundError('Order not found or not assigned to you');
  }
  if (!SHAREABLE_STATUSES.includes(order.orderStatus)) {
    throw new ValidationError(`Order in status '${order.orderStatus}' cannot be shared.`);
  }
  if (order.dispatch?.sharedPartnerId) throw new ValidationError('Order already has a shared partner');
  if (order.dispatch?.isShared) throw new ValidationError('A second-driver search is already open for this order.');

  const settings = await getQuickDeliverySettings();
  if (!isShareRequired(order, settings)) {
    throw new ValidationError('This order is not large enough to request a second delivery partner.');
  }

  const opened = await QuickOrder.findOneAndUpdate(
    {
      _id: order._id,
      'dispatch.isShared': { $ne: true },
      'dispatch.sharedPartnerId': null,
      'dispatch.deliveryPartnerId': new mongoose.Types.ObjectId(String(partnerId)),
    },
    {
      $set: { 'dispatch.isShared': true, 'dispatch.shareOpenedAt': new Date() },
      $push: {
        statusHistory: {
          byRole: 'DELIVERY_PARTNER',
          byId: asObjectId(partnerId),
          from: order.orderStatus,
          to: order.orderStatus,
          note: 'Primary requested a second delivery partner (Find new driver)',
          at: new Date(),
        },
      },
    },
    { new: true },
  );
  if (!opened) throw new ValidationError('A second-driver search is already open for this order.');

  // Invite nearby QC-capable riders only (respects riders who opted out of quick commerce).
  try {
    const pickup = (opened.pickupPoints || []).find((p) => p?.location?.coordinates?.length === 2);
    if (pickup) {
      const { partners = [] } = await listNearbyOnlineDeliveryPartners(
        { _id: pickup.sourceId, location: { type: 'Point', coordinates: pickup.location.coordinates } },
        { maxKm: 15, limit: 25, requiredAmount: 0, allowOverLimitFallback: true, service: 'quickCommerce', excludeOrderId: opened._id },
      );
      const targets = partners.filter((p) => String(p.partnerId) !== String(partnerId));
      const base = buildQuickOfferPayload(opened);
      targets.forEach((p) =>
        emitToRider(p.partnerId, 'shareable_order_available', {
          ...base,
          pickupDistanceKm: p.distanceKm,
          sharedFrom: String(partnerId),
          shareRequired: false,
        }),
      );
      void notifyOwnersSafely(
        targets.map((p) => ({ ownerType: 'DELIVERY_PARTNER', ownerId: p.partnerId })),
        {
          title: 'Second rider needed',
          body: `Order #${opened.orderId} needs a second rider. Tap to join.`,
          ring: true,
          data: { type: 'shareable_order_available', orderId: toId(opened._id), orderMongoId: toId(opened._id), orderKind: 'quick' },
        },
      ).catch(() => {});
    }
  } catch (err) {
    logger.warn(`[QuickFlows] share invite failed for ${opened._id}: ${err.message}`);
  }
  return opened;
}

/** Another rider joins an open second-rider slot. First one wins. */
export async function acceptSharedQuickOrder(orderId, newPartnerId) {
  const target = await findOrderByIdentity(orderId);
  if (!target) throw new NotFoundError('Shared order not found or no longer available');
  const newId = new mongoose.Types.ObjectId(String(newPartnerId));
  await assertRiderHasFreeSlot(newPartnerId, { excludeOrderId: target._id });

  const order = await QuickOrder.findOneAndUpdate(
    {
      _id: target._id,
      'dispatch.isShared': true,
      'dispatch.sharedPartnerId': null,
      'dispatch.deliveryPartnerId': { $ne: newId },
      orderStatus: { $nin: QUICK_TERMINAL_STATUSES },
    },
    { $set: { 'dispatch.sharedPartnerId': newId, 'dispatch.isShared': false } },
    { new: true },
  );

  if (!order) {
    const existing = await QuickOrder.findById(target._id).select('dispatch').lean();
    if (String(existing?.dispatch?.deliveryPartnerId || '') === String(newPartnerId)) {
      throw new ValidationError('You already have this order assigned.');
    }
    if (String(existing?.dispatch?.sharedPartnerId || '') === String(newPartnerId)) {
      return QuickOrder.findById(target._id); // idempotent retry
    }
    throw new ValidationError('This shared order has already been taken by another partner.');
  }

  const primaryId = toId(order.dispatch.deliveryPartnerId);
  await applySharedEarningSplit(order, primaryId, newPartnerId);
  buildQuickLegs(order, primaryId, String(newPartnerId));
  order.statusHistory.push({
    byRole: 'DELIVERY_PARTNER',
    byId: newId,
    from: order.orderStatus,
    to: order.orderStatus,
    note: `Shared order slot joined by partner ${newPartnerId}`,
    at: new Date(),
  });
  await order.save();

  announceSharedJoin(order, primaryId, String(newPartnerId));
  emitQuickLegOtpsToCustomer(order);
  return order;
}

/** Primary rider confirms the earnings split with the second rider. */
export async function confirmQuickSplit(orderId, partnerId) {
  const order = await findOrderByIdentity(orderId);
  if (!order) throw new NotFoundError('Order not found');
  if (!order.dispatch?.sharedPartnerId) {
    throw new ValidationError('This is not a shared order, split not required.');
  }
  if (toId(order.dispatch.deliveryPartnerId) !== String(partnerId)) {
    throw new ForbiddenError('Only the primary partner can confirm the earnings split.');
  }
  if (order.deliveryState?.isSplitConfirmed) return order;
  await QuickOrder.updateOne({ _id: order._id }, { $set: { 'deliveryState.isSplitConfirmed': true } });
  const fresh = await QuickOrder.findById(order._id);
  await emitQuickOrderUpdate(fresh, 'order_update').catch(() => {});
  return fresh;
}

/** Rider or store reports a delay; the customer is told live and the reason is kept on the order. */
export async function reportQuickOrderDelay(orderId, actorId, role, reason) {
  const order = await findOrderByIdentity(orderId);
  if (!order) throw new NotFoundError('Order not found');

  if (role === 'DELIVERY_PARTNER') {
    const mine =
      toId(order.dispatch?.deliveryPartnerId) === String(actorId) ||
      toId(order.dispatch?.sharedPartnerId) === String(actorId);
    if (!mine) throw new ForbiddenError('Not assigned to you');
  } else if (role === 'SELLER') {
    const sellerId = (order.pickupPoints || []).map((p) => String(p?.sourceId || ''));
    if (!sellerId.includes(String(actorId))) throw new ForbiddenError('Not your order');
  }

  order.delayContext = { reason: String(reason || '').trim(), reportedBy: role, reportedAt: new Date() };
  await order.save();

  try {
    if (order.userId) {
      getIO()?.to(rooms.user(String(order.userId))).emit('order_delay_update', {
        orderId: toId(order._id),
        orderMongoId: toId(order._id),
        orderKind: 'quick',
        reason: order.delayContext.reason,
        reportedBy: role,
      });
    }
    getIO()?.to(rooms.tracking(toId(order._id))).emit('order_delay_update', {
      orderId: toId(order._id),
      reason: order.delayContext.reason,
      reportedBy: role,
    });
  } catch {
    /* socket optional */
  }
  return order;
}

/** Scheduled orders whose slot is within the lead window become live and start hunting a rider. */
export async function activateDueScheduledQuickOrders() {
  const settings = await getQuickDeliverySettings();
  const trigger = new Date(Date.now() + settings.scheduleLeadMinutes * 60 * 1000);
  const due = await QuickOrder.find({
    orderStatus: 'scheduled',
    scheduledAt: { $lte: trigger },
    ...getSellerVisibleQuickOrderPaymentFilter(),
  })
    .select('_id')
    .limit(50)
    .lean();

  let activated = 0;
  for (const row of due) {
    try {
      const order = await QuickOrder.findOneAndUpdate(
        { _id: row._id, orderStatus: 'scheduled' },
        {
          $set: { orderStatus: 'placed', activatedAt: new Date() },
          $push: {
            statusHistory: {
              byRole: 'SYSTEM',
              from: 'scheduled',
              to: 'placed',
              note: 'Scheduled order activated',
              at: new Date(),
            },
          },
        },
        { new: true },
      );
      if (!order) continue;
      if (!isQuickOrderVisibleToSeller(order)) continue;
      activated += 1;
      if (order.userId) {
        void notifyOwnerSafely(
          { ownerType: 'USER', ownerId: order.userId },
          {
            title: 'Your scheduled order is on its way to being prepared',
            body: `Order #${order.orderId} is now active and we are searching for a delivery partner.`,
            data: { type: 'order_status_update', orderId: String(order.orderId), orderMongoId: toId(order._id) },
          },
        ).catch(() => {});
      }
      await emitQuickCommerceStatusUpdate(order, { message: 'Your scheduled order is now active.' }).catch(() => {});
      void dispatchQuickOrder(order._id).catch((err) =>
        logger.warn(`[QuickFlows] dispatch after activation failed for ${order._id}: ${err.message}`),
      );
    } catch (err) {
      logger.warn(`[QuickFlows] could not activate scheduled order ${row._id}: ${err.message}`);
    }
  }
  if (activated) logger.info(`[QuickFlows] activated ${activated} scheduled order(s).`);
  return activated;
}

/**
 * A rider accepted but the store has not acted:
 *  - after RESTAURANT_ACK_RESEND_MS: re-notify the store + alert admin (once per interval)
 *  - after RESTAURANT_ACK_TIMEOUT_MS: auto-cancel, refund, release the rider
 */
export async function sweepQuickSellerAcknowledgements() {
  const now = Date.now();
  const settings = await getQuickDeliverySettings();
  const resendMs = settings.sellerAckResendMinutes * 60 * 1000;
  const timeoutMs = settings.sellerAckTimeoutMinutes * 60 * 1000;
  const waiting = await QuickOrder.find({
    orderStatus: 'confirmed',
    'dispatch.status': 'accepted',
    'dispatch.acceptedAt': { $lt: new Date(now - resendMs) },
  }).limit(50);

  for (const order of waiting) {
    try {
      const pending = await SellerOrder.find({ orderId: order.orderId, status: 'pending' }).lean();
      if (!pending.length) continue;

      const waited = now - new Date(order.dispatch.acceptedAt).getTime();
      if (waited >= timeoutMs) {
        await cancelQuickOrderSellerNoResponse(order._id);
        continue;
      }

      const lastResent = order.dispatch?.sellerAckResendAt ? new Date(order.dispatch.sellerAckResendAt).getTime() : 0;
      if (lastResent && now - lastResent < resendMs) continue;

      pending.forEach((leg) => {
        const payload = {
          orderId: leg.orderId,
          sellerOrderId: toId(leg._id),
          status: leg.status,
          workflowStatus: leg.workflowStatus,
          items: leg.items || [],
          pricing: leg.pricing || {},
          createdAt: leg.createdAt,
        };
        try {
          const io = getIO();
          io?.to(rooms.seller(String(leg.sellerId))).emit('new_order', payload);
          io?.to(rooms.seller(String(leg.sellerId))).emit('order:new', payload);
          io?.to(rooms.seller(String(leg.sellerId))).emit('play_notification_sound', {
            audience: 'seller',
            type: 'new_order',
            orderId: leg.orderId,
            sellerOrderId: toId(leg._id),
          });
        } catch {
          /* socket optional */
        }
        void (async () => {
          const { buildNewSellerOrderPushDetails } = await import('./quickSellerOrderFanout.service.js');
          const details = await buildNewSellerOrderPushDetails(leg);
          await notifyOwnerSafely(
            { ownerType: 'SELLER', ownerId: leg.sellerId },
            {
              title: 'Order waiting for you',
              body: `Order ${leg.orderId} has a rider waiting. Please accept it.`,
              ring: true,
              data: { type: 'new_seller_order', orderId: String(leg.orderId), sellerOrderId: toId(leg._id), link: '/seller/orders', ...details },
            },
          );
        })().catch(() => {});
      });

      if (!order.dispatch?.sellerAckAlertedAt) {
        await notifyOwnersSafely([{ ownerType: 'ADMIN', ownerId: 'GLOBAL' }], {
          title: 'Store not responding',
          body: `Quick order #${order.orderId} has a rider waiting; the store has not accepted yet.`,
          data: { type: 'seller_ack_pending', orderId: toId(order._id) },
        });
      }
      await QuickOrder.updateOne(
        { _id: order._id },
        { $set: { 'dispatch.sellerAckResendAt': new Date(), 'dispatch.sellerAckAlertedAt': order.dispatch?.sellerAckAlertedAt || new Date() } },
      );
    } catch (err) {
      logger.warn(`[QuickFlows] seller-ack sweep failed for ${order._id}: ${err.message}`);
    }
  }
}

/** Orders that have been hunting a rider for too long are cancelled and refunded. */
export async function sweepQuickNoRiderTimeouts() {
  const now = Date.now();
  const noRiderMs = (await getQuickDeliverySettings()).noRiderCancelMinutes * 60 * 1000;
  const candidates = await QuickOrder.find({
    orderStatus: 'placed',
    'dispatch.acceptedAt': { $exists: false },
    'dispatch.status': { $in: ['unassigned', 'offered', 'assigned', 'rejected'] },
    ...getSellerVisibleQuickOrderPaymentFilter(),
  })
    .select('_id createdAt activatedAt statusHistory')
    .limit(100)
    .lean();

  for (const order of candidates) {
    // The hunt starts when the order became live, not at checkout (scheduled orders sit for hours).
    const startedAt = Math.max(
      new Date(order.createdAt).getTime(),
      order.activatedAt ? new Date(order.activatedAt).getTime() : 0,
    );
    if (now - startedAt > noRiderMs) {
      await cancelQuickOrderNoDriverFound(order._id);
    }
  }
}

/**
 * One store of a multi-store order backs out. The order carries on with the remaining stores and the
 * customer gets that store's items back (food + packing + a share of tax, minus its coupon share);
 * delivery and platform fees stay. When no store is left the caller cancels the whole order.
 *
 * @returns {{ fullyCancelled: boolean, refunded?: number }}
 */
export async function dropSellerFromQuickOrder(parentOrder, sellerId, sellerOrder, reason = '') {
  const key = String(sellerId);
  const stop = (parentOrder.pickups || []).find((p) => String(p.restaurantId) === key);
  if (!stop) throw new ValidationError('Store not found on this order');
  if (stop.permanentlyDropped) return { fullyCancelled: false, refunded: 0 };
  if (String(stop.status || '') === 'picked_up') {
    throw new ValidationError('These items have already been picked up and can no longer be rejected.');
  }
  if (['picked_up', 'delivered'].includes(parentOrder.orderStatus)) {
    throw new ValidationError('The order is already out for delivery and can no longer be rejected.');
  }

  const stillActive = (parentOrder.pickups || []).filter(
    (p) => String(p.restaurantId) !== key && !p.permanentlyDropped && String(p.status || '') !== 'cancelled',
  );
  if (stillActive.length === 0) return { fullyCancelled: true };

  stop.status = 'cancelled';
  stop.permanentlyDropped = true;
  stop.droppedAt = new Date();

  const droppedItems = (parentOrder.items || []).filter((item) => String(item.sourceId) === key);
  const droppedSubtotal = droppedItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
  const orderSubtotal = Math.max(Number(parentOrder.pricing?.subtotal || 0), 1);
  const share = droppedSubtotal / orderSubtotal;
  const packing = Number(sellerOrder?.pricing?.packingFee || 0);
  const taxShare = Number(parentOrder.pricing?.tax || 0) * share;
  const discountShare = Number(parentOrder.pricing?.discount || 0) * share;
  const refundAmount = Math.max(0, Number((droppedSubtotal + packing + taxShare - discountShare).toFixed(2)));

  await restoreQuickOrderItemsStock(droppedItems).catch((err) =>
    logger.warn(`[QuickFlows] stock restore for dropped store failed: ${err.message}`),
  );

  const paymentMethod = String(parentOrder.payment?.method || '').toLowerCase();
  const paid = String(parentOrder.payment?.status || '').toLowerCase() === 'paid';
  let refunded = 0;
  let refundMethod = '';
  let refundId = '';
  if (refundAmount > 0 && paid && parentOrder.userId) {
    try {
      if (paymentMethod === 'wallet') {
        await refundWalletBalance(parentOrder.userId, refundAmount, 'Quick order partial refund', {
          orderId: String(parentOrder.orderId),
          source: 'quick_order_partial_refund',
        });
        refundMethod = 'wallet';
      } else if (parentOrder.payment?.razorpay?.paymentId) {
        const result = await initiateRazorpayRefund(parentOrder.payment.razorpay.paymentId, refundAmount);
        if (!result?.success) throw new Error(result?.error || 'gateway refund failed');
        refundMethod = 'gateway';
        refundId = result.refundId || '';
      }
      refunded = refundMethod ? refundAmount : 0;
    } catch (err) {
      logger.error(`[QuickFlows] partial refund failed for ${parentOrder.orderId}: ${err.message}`);
      void notifyOwnersSafely([{ ownerType: 'ADMIN', ownerId: 'GLOBAL' }], {
        title: 'Partial refund FAILED',
        body: `Quick order #${parentOrder.orderId}: could not refund Rs ${refundAmount} for a store that dropped out.`,
        data: { type: 'quick_partial_refund_failed', orderId: toId(parentOrder._id) },
      }).catch(() => {});
    }
  } else if (refundAmount > 0 && !paid) {
    // Cash on delivery: the customer simply pays less.
    parentOrder.pricing.total = Math.max(0, Number(parentOrder.pricing.total || 0) - refundAmount);
    parentOrder.payment.amountDue = Math.max(0, Number(parentOrder.payment.amountDue || 0) - refundAmount);
  }

  parentOrder.partialRefunds.push({
    amount: refunded || refundAmount,
    reason,
    sellerId: key,
    method: refundMethod || (paid ? 'pending' : 'cod_adjusted'),
    refundId,
    at: new Date(),
  });
  parentOrder.markModified('pickups');

  if (parentOrder.userId) {
    void notifyOwnerSafely(
      { ownerType: 'USER', ownerId: parentOrder.userId },
      {
        title: 'A store removed from your order',
        body: `${stop.restaurantName || 'One store'} could not fulfil your order${reason ? ` (${reason})` : ''}. Your order continues with the other store(s)${refunded ? ` and Rs ${refunded} is being refunded` : ''}.`,
        data: { type: 'order_status_update', orderId: String(parentOrder.orderId), orderMongoId: toId(parentOrder._id) },
      },
    ).catch(() => {});
  }
  return { fullyCancelled: false, refunded };
}
