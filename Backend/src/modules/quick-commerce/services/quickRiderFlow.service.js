/**
 * Rider-side trip steps for Quick Commerce, with the same rules Food has:
 *
 *  - pickup is only allowed once the store marked the order ready
 *  - several stores in one order: collect store by store, in sequence
 *  - two riders on one order (legs): each rider has their own pickup, drop and handover OTP; the
 *    order is delivered only when every leg is delivered
 *  - handover OTP is mandatory once the customer was given one
 *
 * The controller stays thin; everything that decides state lives here.
 */
import mongoose from 'mongoose';
import { QuickOrder } from '../models/order.model.js';
import { FoodDeliveryPartner } from '../../food/delivery/models/deliveryPartner.model.js';
import {
  applyEmploymentAwareDualEarnings,
  generateFourDigitDeliveryOtp,
  notifyOwnerSafely,
  notifyOwnersSafely,
} from '../../food/orders/services/order.helpers.js';
import {
  areAllLegsDelivered,
  ensureDualLegs,
  getActiveLegs,
  getActivePickups,
  getLegForPartner,
  getLegProgress,
  getNextPickup,
  getNextPickupForLeg,
  isDualLegActive,
  isShareRequired,
} from '../../food/orders/services/order-lifecycle.policy.js';
import { ValidationError, NotFoundError, ForbiddenError } from '../../../core/auth/errors.js';
import { getIO, rooms } from '../../../config/socket.js';
import { logger } from '../../../utils/logger.js';
import { getQuickDeliverySettings } from './quickDeliverySettings.service.js';
import { emitQuickOrderUpdate } from './quickDispatch.service.js';
import { emitQuickLegOtpsToCustomer } from './quickOrderFlows.service.js';
import { syncSellerOrderFromDelivery } from './quickOrder.service.js';

const toId = (value) => {
  const raw = value?._id || value;
  return raw ? String(raw) : '';
};

/** Primary rider or the second rider of a shared order. */
const loadOrderForRider = async (orderId, partnerId, { withOtp = false } = {}) => {
  if (!mongoose.Types.ObjectId.isValid(String(orderId))) throw new NotFoundError('Order not found for this rider');
  const id = new mongoose.Types.ObjectId(String(partnerId));
  const query = QuickOrder.findOne({
    _id: orderId,
    $or: [{ 'dispatch.deliveryPartnerId': id }, { 'dispatch.sharedPartnerId': id }],
  });
  const order = await (withOtp ? query.select('+deliveryOtp') : query);
  if (!order) throw new NotFoundError('Order not found for this rider');
  // A shared slot that never filled in has no legs; a joined second rider always has them.
  if (order.dispatch?.sharedPartnerId && !isDualLegActive(order)) {
    ensureDualLegs(order, generateFourDigitDeliveryOtp);
  }
  return order;
};

const myLegOf = (order, partnerId) => (isDualLegActive(order) ? getLegForPartner(order, partnerId) : null);

const pushHistory = (order, partnerId, from, to, note) => {
  order.statusHistory.push({
    byRole: 'DELIVERY_PARTNER',
    byId: new mongoose.Types.ObjectId(String(partnerId)),
    from,
    to,
    note,
    at: new Date(),
  });
};

const isMultiStop = (order) => Boolean(order.isMultiSeller) && getActivePickups(order).length > 0;

/** Is the stop this rider is due at still waiting for the store to finish? */
const isWaitingForStore = (order, leg) => {
  if (isMultiStop(order)) {
    const next = leg ? getNextPickupForLeg(order, leg) : getNextPickup(order);
    return Boolean(next && String(next.status || '') !== 'ready');
  }
  return !['ready_for_pickup', 'picked_up', 'reached_drop', 'delivered'].includes(String(order.orderStatus || ''));
};

/** Rider arrived at the store. */
export async function reachedPickup(orderId, partnerId) {
  const order = await loadOrderForRider(orderId, partnerId);
  if (order.orderStatus === 'delivered') throw new ValidationError('Order already delivered');

  const leg = myLegOf(order, partnerId);
  const waiting = isWaitingForStore(order, leg);
  const nextStop = isMultiStop(order) ? (leg ? getNextPickupForLeg(order, leg) : getNextPickup(order)) : null;
  const from = order.deliveryState?.status || order.deliveryState?.currentPhase || order.orderStatus;

  if (leg) {
    if (['at_pickup', 'picked_up', 'at_drop', 'delivered'].includes(String(leg.status || ''))) return order;
    leg.status = 'at_pickup';
    leg.reachedPickupAt = leg.reachedPickupAt || new Date();
    order.markModified('legs');
  } else if (order.deliveryState?.currentPhase === 'at_pickup' && !isMultiStop(order)) {
    return order; // already marked, nothing to redo
  }

  order.deliveryState.currentPhase = 'at_pickup';
  order.deliveryState.status = waiting ? 'waiting_for_food' : 'reached_pickup';
  order.deliveryState.reachedPickupAt = order.deliveryState.reachedPickupAt || new Date();
  pushHistory(
    order,
    partnerId,
    from,
    'reached_pickup',
    waiting
      ? `Reached ${nextStop?.restaurantName || 'the store'} - waiting for the order to be ready`
      : leg
        ? `Leg ${leg.legIndex} reached pickup`
        : 'Reached pickup location',
  );
  await order.save();

  // Tell the store(s) the rider is here.
  try {
    const sellerIds = isMultiStop(order)
      ? [toId(nextStop?.restaurantId)].filter(Boolean)
      : (order.pickupPoints || []).map((p) => String(p?.sourceId || '')).filter(Boolean);
    const partner = await FoodDeliveryPartner.findById(partnerId).select('name').lean();
    sellerIds.forEach((sellerId) => {
      void notifyOwnerSafely(
        { ownerType: 'SELLER', ownerId: sellerId },
        {
          title: 'Rider arrived!',
          body: `${partner?.name || 'The delivery partner'} has arrived to pick up Order #${order.orderId}.`,
          data: { type: 'rider_arrived', orderId: String(order.orderId), orderMongoId: toId(order._id) },
        },
      ).catch(() => {});
      getIO()?.to(rooms.seller(sellerId)).emit('rider_arrived', { orderId: order.orderId, orderMongoId: toId(order._id) });
    });
  } catch (err) {
    logger.warn(`[QuickRider] rider-arrived notify failed: ${err.message}`);
  }

  await emitQuickOrderUpdate(order, 'order_update');
  return order;
}

/** Rider collected the parcel (one store at a time on multi-store orders). */
export async function confirmPickup(orderId, partnerId, { billImageUrl = '' } = {}) {
  const order = await loadOrderForRider(orderId, partnerId);
  if (order.orderStatus === 'picked_up') return order;
  if (order.orderStatus === 'delivered') throw new ValidationError('Order already delivered');

  const leg = myLegOf(order, partnerId);
  const from = order.orderStatus;
  const isPrimary = toId(order.dispatch?.deliveryPartnerId) === String(partnerId);
  if (order.dispatch?.sharedPartnerId && !isPrimary && !leg) {
    throw new ForbiddenError('Only the primary partner can confirm order pickup.');
  }

  let collectedAll = true;
  let stopName = '';

  if (isMultiStop(order)) {
    const current = leg ? getNextPickupForLeg(order, leg) : getNextPickup(order);
    if (current && String(current.status || '') !== 'ready') {
      throw new ValidationError(
        `Cannot pick up from ${current.restaurantName || 'this store'} until it marks the order ready.`,
      );
    }
    if (current) {
      stopName = current.restaurantName || '';
      current.status = 'picked_up';
      current.pickedAt = new Date();
      if (billImageUrl) current.billImageUrl = billImageUrl;
    }
    if (leg && !getNextPickupForLeg(order, leg)) {
      leg.status = 'picked_up';
      leg.pickedAt = leg.pickedAt || new Date();
      order.markModified('legs');
    }
    const remaining = order.pickups.filter((p) => !p.permanentlyDropped && String(p.status || '') !== 'cancelled');
    collectedAll = remaining.length > 0 && remaining.every((p) => String(p.status) === 'picked_up');
    if (!collectedAll) {
      order.deliveryState.currentPhase = 'en_route_to_pickup';
      order.deliveryState.status = 'ready_for_pickup';
      pushHistory(order, partnerId, from, from, `Picked up items from ${stopName || 'one store'}. Heading to the next pickup.`);
      await order.save();
      await emitQuickOrderUpdate(order, 'order_update');
      return order;
    }
  } else {
    // Same rule as Food: the store must have marked the order ready first.
    if (from !== 'ready_for_pickup' && !(leg && from === 'picked_up')) {
      throw new ValidationError('You can only pick up the order after the store marks it ready for pickup.');
    }
    if (leg) {
      leg.status = 'picked_up';
      leg.pickedAt = leg.pickedAt || new Date();
      order.markModified('legs');
      const allCollected = getActiveLegs(order).every((l) =>
        ['picked_up', 'at_drop', 'delivered'].includes(String(l?.status || '')),
      );
      if (!allCollected) {
        pushHistory(order, partnerId, from, from, `Leg ${leg.legIndex} collected. Waiting for the other partner to collect their items.`);
        if (billImageUrl) order.deliveryState.lastPickupBillImageUrl = billImageUrl;
        await order.save();
        await emitQuickOrderUpdate(order, 'order_update');
        return order;
      }
    }
  }

  order.orderStatus = 'picked_up';
  order.deliveryState.currentPhase = 'en_route_to_delivery';
  order.deliveryState.status = 'picked_up';
  order.deliveryState.pickedUpAt = new Date();
  if (billImageUrl) order.deliveryState.billImageUrl = String(billImageUrl);
  pushHistory(order, partnerId, from, 'picked_up', 'Rider collected the order from the store');
  await order.save();

  await syncSellerOrderFromDelivery(order._id, 'picked_up').catch((err) =>
    logger.warn(`[QuickRider] seller sync (picked_up) failed: ${err.message}`),
  );
  await emitQuickOrderUpdate(order, 'order_update');
  return order;
}

/** Rider is at the customer's door. */
export async function reachedDrop(orderId, partnerId) {
  const order = await loadOrderForRider(orderId, partnerId, { withOtp: true });
  const leg = myLegOf(order, partnerId);
  // With two riders each one heads to the drop as soon as their own part is collected.
  const collected = leg
    ? ['picked_up', 'at_drop', 'delivered'].includes(String(leg.status || ''))
    : ['picked_up', 'delivered'].includes(order.orderStatus);
  if (!collected) {
    throw new ValidationError('Pick up the order before marking it reached at the drop location.');
  }

  if (leg) {
    if (leg.otpVerified) return order;
    if (!leg.otp) leg.otp = generateFourDigitDeliveryOtp();
    leg.status = 'at_drop';
    leg.reachedDropAt = leg.reachedDropAt || new Date();
    order.markModified('legs');
    order.deliveryState.currentPhase = 'at_drop';
    order.deliveryState.status = 'reached_drop';
    order.deliveryState.reachedDropAt = order.deliveryState.reachedDropAt || new Date();
    await order.save();
    emitQuickLegOtpsToCustomer(order);
    await emitQuickOrderUpdate(order, 'order_update');
    return order;
  }

  order.deliveryState.currentPhase = 'at_drop';
  order.deliveryState.status = 'reached_drop';
  order.deliveryState.reachedDropAt = order.deliveryState.reachedDropAt || new Date();
  await order.save();
  await emitQuickOrderUpdate(order, 'order_update');
  return order;
}

const otpMatches = (expected, supplied) => {
  const a = String(expected || '').trim();
  const b = String(supplied || '').trim();
  return Boolean(a) && Boolean(b) && a === b;
};

/** Handover code check at the door (this rider's own leg when two riders share the order). */
export async function verifyDropOtp(orderId, partnerId, otp) {
  const order = await loadOrderForRider(orderId, partnerId, { withOtp: true });
  const leg = myLegOf(order, partnerId);

  if (leg) {
    if (leg.otpVerified) return { verified: true, order };
    if (!otpMatches(leg.otp, otp)) throw new ValidationError('Incorrect handover code');
    leg.otpVerified = true;
    order.markModified('legs');
    await order.save();
    await emitQuickOrderUpdate(order, 'order_update');
    return { verified: true, order };
  }

  const expected = String(order.deliveryOtp || '').trim();
  if (!expected) throw new ValidationError('No handover code set for this order');
  if (!otpMatches(expected, otp)) throw new ValidationError('Incorrect handover code');
  order.set('deliveryVerification.dropOtp.verified', true);
  await order.save();
  return { verified: true, order };
}

/** Delivered. With two riders, each completes their own leg; the last one closes the order. */
export async function completeDelivery(orderId, partnerId, { otp = '' } = {}) {
  const order = await loadOrderForRider(orderId, partnerId, { withOtp: true });
  if (order.orderStatus === 'delivered') return { order, finished: true, waitingForPartner: false };

  const isPrimary = toId(order.dispatch?.deliveryPartnerId) === String(partnerId);
  const leg = myLegOf(order, partnerId);
  const settings = await getQuickDeliverySettings();

  if (isDualLegActive(order) && !leg) {
    throw new ForbiddenError('No delivery leg assigned to you on this shared order');
  }

  if (leg) {
    if (String(leg.status || '') === 'delivered') {
      return { order, finished: order.orderStatus === 'delivered', waitingForPartner: order.orderStatus !== 'delivered' };
    }
    if (!['picked_up', 'at_drop'].includes(String(leg.status || ''))) {
      throw new ValidationError('Collect your part of the order before completing your delivery.');
    }
    if (!leg.otpVerified) {
      if (!String(otp || '').trim()) {
        throw new ValidationError('Customer handover OTP is required. Verify the OTP for your delivery before completing.');
      }
      if (!otpMatches(leg.otp, otp)) throw new ValidationError('Invalid handover OTP provided.');
      leg.otpVerified = true;
    }
    leg.status = 'delivered';
    leg.deliveredAt = new Date();
    order.markModified('legs');

    if (!areAllLegsDelivered(order)) {
      pushHistory(order, partnerId, order.orderStatus, order.orderStatus, `Leg ${leg.legIndex} delivered. Waiting for the other partner to finish.`);
      await order.save();
      await emitQuickOrderUpdate(order, 'order_update');
      return { order, finished: false, waitingForPartner: true };
    }

    // Final leg: re-apply salary / per-order payouts so wallets never credit salary partners.
    try {
      const [primary, shared] = await Promise.all([
        FoodDeliveryPartner.findById(order.dispatch?.deliveryPartnerId).select('employmentType').lean(),
        FoodDeliveryPartner.findById(order.dispatch?.sharedPartnerId).select('employmentType').lean(),
      ]);
      applyEmploymentAwareDualEarnings(order, {
        primaryEmploymentType: primary?.employmentType || 'per_order',
        secondaryEmploymentType: shared?.employmentType || 'per_order',
      });
    } catch (err) {
      logger.warn(`[QuickRider] employment-aware split failed: ${err.message}`);
    }
    order.set('deliveryVerification.dropOtp.required', true);
    order.set('deliveryVerification.dropOtp.verified', true);
    order.set('deliveryState.isSplitConfirmed', true);
  } else {
    // Single rider: the customer's code is mandatory once they were given one.
    const required = Boolean(order.deliveryVerification?.dropOtp?.required);
    const alreadyVerified = Boolean(order.deliveryVerification?.dropOtp?.verified);
    if (required && !alreadyVerified) {
      if (!String(otp || '').trim()) {
        throw new ValidationError('Customer handover OTP is required. Verify the OTP from the customer before completing delivery.');
      }
      if (!otpMatches(order.deliveryOtp, otp)) throw new ValidationError('Invalid handover OTP provided.');
    } else if (String(otp || '').trim() && String(order.deliveryOtp || '').trim() && !otpMatches(order.deliveryOtp, otp)) {
      throw new ValidationError('Incorrect handover code');
    }
    order.set('deliveryVerification.dropOtp.verified', true);
  }

  if (order.orderStatus !== 'picked_up') {
    throw new ValidationError('Cannot complete delivery: the order must be picked up first.');
  }

  // Two riders but no leg yet (legacy rows): the primary must have confirmed the split.
  if (order.dispatch?.sharedPartnerId && !leg && !order.deliveryState?.isSplitConfirmed) {
    throw new ValidationError('Earnings split must be confirmed by the primary partner before completing the delivery.');
  }

  // Bulky order where the primary asked for a second rider that never came.
  if (isShareRequired(order, settings) && !order.dispatch?.sharedPartnerId) {
    const openedAt = order.dispatch?.shareOpenedAt ? new Date(order.dispatch.shareOpenedAt).getTime() : null;
    const wasOpened = Boolean(order.dispatch?.isShared) || openedAt != null;
    const timedOut = openedAt != null && Date.now() - openedAt >= settings.shareTimeoutMinutes * 60 * 1000;
    if (wasOpened && !timedOut) {
      throw new ValidationError(
        'Waiting for a second delivery partner. If no one joins, you can complete alone after the search times out.',
      );
    }
    if (wasOpened) {
      const restored = Number(order.riderEarning || 0) + Number(order.sharedRiderEarning || 0);
      order.riderEarning = restored;
      order.sharedRiderEarning = 0;
      order.set('dispatch.isShared', false);
      order.set('dispatch.shareOpenedAt', null);
      pushHistory(order, partnerId, order.orderStatus, order.orderStatus, `No second partner joined in time; primary completing solo with full earning Rs ${restored}.`);
      void notifyOwnersSafely([{ ownerType: 'ADMIN', ownerId: 'GLOBAL' }], {
        title: 'Bulk order completed solo',
        body: `Quick order #${order.orderId} had no second rider join in time; the primary partner is completing it alone.`,
        data: { type: 'bulk_solo_complete', orderId: toId(order._id), orderKind: 'quick' },
      }).catch(() => {});
    }
  }

  order.orderStatus = 'delivered';
  order.deliveryState.currentPhase = 'delivered';
  order.deliveryState.status = 'delivered';
  order.deliveryState.deliveredAt = new Date();
  order.deliveredAt = new Date();
  if (String(order.payment?.method || '').toLowerCase() === 'cash') order.payment.status = 'paid';
  pushHistory(order, partnerId, 'picked_up', 'delivered', `Delivery completed by ${isPrimary ? 'primary' : 'second'} partner`);
  // Handover codes are single-use.
  order.deliveryOtp = '';
  await order.save();

  await syncSellerOrderFromDelivery(order._id, 'delivered').catch((err) =>
    logger.warn(`[QuickRider] seller sync (delivered) failed: ${err.message}`),
  );

  try {
    const io = getIO();
    const split = {
      orderId: toId(order._id),
      orderKind: 'quick',
      totalEarnings: (order.riderEarning || 0) + (order.sharedRiderEarning || 0),
      primaryShare: order.riderEarning,
      sharedShare: order.sharedRiderEarning,
      deliveryPartnerId: order.dispatch?.deliveryPartnerId,
      sharedPartnerId: order.dispatch?.sharedPartnerId,
    };
    if (order.dispatch?.deliveryPartnerId) io?.to(rooms.delivery(toId(order.dispatch.deliveryPartnerId))).emit('order_earnings_split', split);
    if (order.dispatch?.sharedPartnerId) io?.to(rooms.delivery(toId(order.dispatch.sharedPartnerId))).emit('order_earnings_split', split);
  } catch {
    /* socket optional */
  }

  await emitQuickOrderUpdate(order, 'order_update');
  return { order, finished: true, waitingForPartner: false, legProgress: getLegProgress(order) };
}
