/**
 * Quick Commerce dispatch — rider first, exactly like Food.
 *
 * A placed QC order is offered to riders BEFORE the seller ever sees it. The seller order is
 * only created (and the shop notified) once a rider accepts, so no shop starts packing an
 * order nobody will collect.
 *
 * Rider selection is Food's (`listNearbyOnlineDeliveryPartners`) so both verticals share one
 * fleet, cash-limit rules and ranking. Offers are emitted straight to the rider rooms rather
 * than through Food's `publish()` outbox, which would write QC rows into food_order_events.
 */
import mongoose from 'mongoose';
import { QuickOrder } from '../models/order.model.js';
import { Seller } from '../seller/models/seller.model.js';
import { listNearbyOnlineDeliveryPartners } from '../../food/orders/services/order-dispatch.service.js';
import { buildOfferPushData, notifyOwnersSafely } from '../../food/orders/services/order.helpers.js';
import {
  CAPACITY_REACHED_MESSAGE,
  claimExceedsStackingLimit,
  getRiderCapacity,
} from '../../food/orders/services/rider-capacity.service.js';
import { getIO, rooms } from '../../../config/socket.js';
import { getQuickDeliverySettings } from './quickDeliverySettings.service.js';
import { getNextPickup } from '../../food/orders/services/order-lifecycle.policy.js';
import { logger } from '../../../utils/logger.js';

/** Default offer window; the live value comes from the admin delivery settings. */
export const QUICK_OFFER_TIMEOUT_MS = 60 * 1000;
const PRIORITY_STATUSES = ['confirmed', 'preparing', 'ready_for_pickup'];
const DISPATCH_LOCK_TTL_MS = 2 * 60 * 1000;

/** Statuses where a rider may still be hunted for. */
const DISPATCHABLE_STATUSES = ['placed', 'confirmed', 'preparing', 'ready_for_pickup'];

const toId = (value) => {
  const raw = value?._id || value;
  return raw ? String(raw) : '';
};

/** Seller shop acts as the pickup, mirroring the restaurant on a Food order. */
const resolveQuickPickup = (order) => {
  // Several stores: the rider card and the rider search follow the stop the rider is due at next.
  const stops = Array.isArray(order?.pickups) ? order.pickups : [];
  if (stops.length > 1) {
    const next = getNextPickup(order) || stops[0];
    const [lng, lat] = Array.isArray(next?.location?.coordinates) ? next.location.coordinates : [undefined, undefined];
    return {
      sellerId: next?.restaurantId ? String(next.restaurantId) : '',
      name: next?.restaurantName || 'Store',
      address: next?.address || '',
      phone: next?.phone || '',
      latitude: Number.isFinite(Number(lat)) ? Number(lat) : undefined,
      longitude: Number.isFinite(Number(lng)) ? Number(lng) : undefined,
    };
  }
  const point = (order?.pickupPoints || []).find((p) => p?.location?.coordinates?.length === 2)
    || (order?.pickupPoints || [])[0]
    || null;
  const coordinates = point?.location?.coordinates;
  const [lng, lat] = Array.isArray(coordinates) ? coordinates : [undefined, undefined];
  return {
    sellerId: point?.sourceId || '',
    name: point?.sourceName || 'Store',
    address: point?.address || '',
    phone: point?.phone || '',
    latitude: Number.isFinite(Number(lat)) ? Number(lat) : undefined,
    longitude: Number.isFinite(Number(lng)) ? Number(lng) : undefined,
  };
};

/**
 * Offer payload in the same shape Food sends, so the rider app's existing offer card renders
 * a QC job unchanged. `orderKind` tells the app which API to call on accept/pickup/drop.
 */
export const buildQuickOfferPayload = (orderDoc) => {
  const order = orderDoc?.toObject ? orderDoc.toObject() : orderDoc || {};
  const pickup = resolveQuickPickup(order);
  const address = order?.deliveryAddress || {};
  const customerAddress = [address.street, address.additionalDetails, address.city, address.state, address.zipCode]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join(', ');
  const riderEarning = Number(order?.riderEarning || 0);

  return {
    orderKind: 'quick',
    // Rider screens resolve a trip by `_id`; keep it alongside the human order number.
    _id: toId(order?._id),
    orderMongoId: toId(order?._id),
    orderId: order?.orderId || toId(order?._id),
    status: order?.orderStatus,
    orderStatus: order?.orderStatus,
    deliveryState: order?.deliveryState,
    items: order?.items || [],
    pricing: order?.pricing,
    total: order?.pricing?.total,
    payment: order?.payment,
    paymentMethod: order?.payment?.method,
    // The rider card is restaurant-shaped; for QC the "restaurant" is the seller's shop.
    restaurantId: pickup.sellerId,
    restaurantName: pickup.name,
    restaurantAddress: pickup.address,
    restaurantPhone: pickup.phone,
    restaurantLocation: {
      latitude: pickup.latitude,
      longitude: pickup.longitude,
      address: pickup.address,
    },
    deliveryAddress: address,
    customerAddress,
    customerName: address.fullName || address.name || order?.customerName || '',
    customerPhone: address.phone || order?.customerPhone || '',
    userName: address.fullName || address.name || '',
    userPhone: address.phone || '',
    // `note` is the customer's note for the SELLER, not the rider — riders only get
    // deliveryInstructions. Do not add `note` back here.
    deliveryInstructions: order?.deliveryInstructions || '',
    tipAmount: Number(order?.tipAmount || 0),
    riderEarning,
    // Single-store orders carry the OTP on the top-level field (select:false), so this is only
    // ever true/false here — never the real code, even if a caller forgot to strip it upstream.
    hasPickupOtp: Boolean(order?.pickupOtp),
    pickupOtpVerified: Boolean(order?.pickupOtpVerified),
    sharedRiderEarning: Number(order?.sharedRiderEarning || 0),
    earnings: riderEarning,
    deliveryBoyFee: riderEarning,
    deliveryFee: order?.pricing?.deliveryFee || 0,
    dispatch: order?.dispatch,
    isMultiRestaurant: Boolean(order?.isMultiSeller),
    pickups: (Array.isArray(order?.pickups) ? order.pickups : []).map((p) => {
      const [lng, lat] = Array.isArray(p?.location?.coordinates) ? p.location.coordinates : [undefined, undefined];
      return {
        restaurantId: p?.restaurantId ? String(p.restaurantId) : '',
        restaurantName: p?.restaurantName || 'Store',
        address: p?.address || '',
        phone: p?.phone || '',
        status: p?.status,
        sequence: p?.sequence,
        items: p?.items || [],
        permanentlyDropped: Boolean(p?.permanentlyDropped),
        pickedAt: p?.pickedAt || null,
        hasPickupOtp: Boolean(p?.pickupOtp),
        pickupOtpVerified: Boolean(p?.pickupOtpVerified),
        location: { coordinates: p?.location?.coordinates, latitude: lat, longitude: lng },
      };
    }),
    isDualLeg: Boolean(order?.isDualLeg),
    splitMode: order?.splitMode || 'none',
    // Handover codes never go to a rider's screen: the customer reads them out at the door.
    legs: (Array.isArray(order?.legs) ? order.legs : []).map((leg) => {
      const { otp, ...rest } = leg || {};
      return { ...rest, hasOtp: Boolean(otp) };
    }),
    deliveryState: order?.deliveryState,
    delayContext: order?.delayContext,
    scheduledAt: order?.scheduledAt,
    createdAt: order?.createdAt,
  };
};

const emitToRiders = (partnerIds, event, payloadFor) => {
  const io = getIO();
  if (!io) return;
  partnerIds.forEach((partnerId) => {
    io.to(rooms.delivery(String(partnerId))).emit(event, payloadFor(partnerId));
  });
};

/**
 * Hunt for a rider for one QC order. Safe to call repeatedly: a short-lived lock plus the
 * `offeredTo` history stop two runs from double-offering the same order.
 */
export async function dispatchQuickOrder(orderId, options = {}) {
  const requestedAttempt = Number(options.attempt || 1);
  const settings = await getQuickDeliverySettings();
  const offerTimeoutMs = settings.offerTimeoutSec * 1000;
  const staleLockBefore = new Date(Date.now() - DISPATCH_LOCK_TTL_MS);
  const staleOfferBefore = new Date(Date.now() - offerTimeoutMs);

  if (!mongoose.Types.ObjectId.isValid(String(orderId))) return null;

  const order = await QuickOrder.findOneAndUpdate(
    {
      _id: new mongoose.Types.ObjectId(String(orderId)),
      orderStatus: { $in: DISPATCHABLE_STATUSES },
      'dispatch.acceptedAt': { $exists: false },
      $and: [
        {
          $or: [
            { 'dispatch.status': { $in: ['unassigned', 'rejected'] } },
            // A stale offer round: nobody took it inside the window.
            { 'dispatch.status': 'offered', 'dispatch.assignedAt': { $lt: staleOfferBefore } },
            // Admin handed it to a rider who never accepted: go back to hunting.
            { 'dispatch.status': 'assigned', 'dispatch.assignedAt': { $lt: staleOfferBefore } },
          ],
        },
        {
          $or: [
            { 'dispatch.dispatchingAt': { $exists: false } },
            { 'dispatch.dispatchingAt': null },
            { 'dispatch.dispatchingAt': { $lt: staleLockBefore } },
          ],
        },
      ],
    },
    { $set: { 'dispatch.dispatchingAt': new Date() } },
    { new: true },
  );

  if (!order) return null;

  // The hunt counter lives on the order, so every re-offer (reject, timeout, watchdog) moves the
  // order one step further up the radius/phase ladder instead of restarting at the nearest 15 km.
  const attempt = Math.max(requestedAttempt, Number(order.dispatch?.dispatchAttempt || 0) + 1);

  try {
    await QuickOrder.updateOne({ _id: order._id }, { $set: { 'dispatch.dispatchAttempt': attempt } });
    const pickup = resolveQuickPickup(order);
    if (!Number.isFinite(pickup.latitude) || !Number.isFinite(pickup.longitude)) {
      logger.warn(`[QuickDispatch] Order ${order._id} has no seller coordinates; cannot hunt riders.`);
      return order;
    }

    const paymentMethod = String(order.payment?.method || '').toLowerCase();
    const isCashOrder = paymentMethod === 'cash' || paymentMethod === 'cod';
    const requiredAmount = isCashOrder ? Number(order.pricing?.total || 0) : 0;

    // Same widening ladder as Food: start tight, open up when nobody bites. An order whose shop
    // is already working on it (admin reassign) skips straight to the widest net.
    let maxKm = 15;
    if (PRIORITY_STATUSES.includes(order.orderStatus)) maxKm = 60;
    else if (attempt === 2) maxKm = 25;
    else if (attempt === 3) maxKm = 40;
    else if (attempt >= 4) maxKm = 60;

    if (attempt >= settings.adminAlertFromAttempt && !order.dispatch?.crisisAlertedAt) {
      logger.error(`[CRITICAL] Quick order ${order._id} unassigned after ${attempt} rounds. Alerting admin.`);
      void notifyOwnersSafely([{ ownerType: 'ADMIN', ownerId: 'GLOBAL' }], {
        title: 'Unassigned Quick Order!',
        body: `Quick order #${order.orderId || order._id} still has no rider.`,
        data: { type: 'admin_alert_unassigned', orderId: String(order._id), orderKind: 'quick' },
      }).catch(() => {});
      await QuickOrder.updateOne({ _id: order._id }, { $set: { 'dispatch.crisisAlertedAt': new Date() } });
    }

    const pickupTarget = {
      _id: pickup.sellerId,
      location: { type: 'Point', coordinates: [pickup.longitude, pickup.latitude] },
    };

    const { partners = [] } = await listNearbyOnlineDeliveryPartners(pickupTarget, {
      maxKm,
      limit: 15,
      requiredAmount,
      allowOverLimitFallback: true,
      service: 'quickCommerce',
      // Riders already holding their maximum stacked orders are filtered out by the shared
      // rider selection; this order itself must not count against them while we hunt.
      excludeOrderId: order._id,
    });

    const alreadyOffered = new Set((order.dispatch?.offeredTo || []).map((o) => String(o.partnerId)));
    const fresh = partners.filter((p) => !alreadyOffered.has(String(p.partnerId)));

    // Nobody new left to ask: out of budget -> cancel + refund; otherwise re-broadcast to everyone
    // in range and let the watchdog come back for the next round.
    if (fresh.length === 0) {
      if (attempt >= settings.maxDispatchAttempts) {
        const { cancelQuickOrderNoDriverFound } = await import('./quickOrderFlows.service.js');
        await cancelQuickOrderNoDriverFound(order._id);
        return order;
      }
      if (partners.length === 0) {
        logger.info(`[QuickDispatch] No riders available for order ${order._id} within ${maxKm}km (attempt ${attempt}).`);
        await QuickOrder.updateOne({ _id: order._id }, { $set: { 'dispatch.status': 'unassigned' } });
        return order;
      }
    }

    // Phase 1: the 3 nearest not-yet-asked riders. Phase 2 (round 3+): everyone eligible.
    const eligible = fresh.length > 0 ? fresh : partners;
    const offerBatch = attempt >= settings.broadcastFromAttempt ? eligible : eligible.slice(0, 3);

    const payload = buildQuickOfferPayload(order);
    const distanceByPartner = new Map(offerBatch.map((p) => [String(p.partnerId), p.distanceKm]));
    const payloadFor = (partnerId) => ({
      ...payload,
      pickupDistanceKm: distanceByPartner.get(String(partnerId)),
    });
    const partnerIds = offerBatch.map((p) => p.partnerId);

    emitToRiders(partnerIds, 'new_order', payloadFor);
    emitToRiders(partnerIds, 'new_order_available', payloadFor);

    void notifyOwnersSafely(
      partnerIds.map((partnerId) => ({ ownerType: 'DELIVERY_PARTNER', ownerId: partnerId })),
      {
        title: 'New Quick Commerce order!',
        body: `You have ${settings.offerTimeoutSec} seconds to accept order #${order.orderId || order._id}.`,
        ring: true,
        sendToAllDevices: true,
        data: { ...buildOfferPushData(payload), orderId: String(order._id), orderKind: 'quick' },
      },
    ).catch((err) => logger.warn(`[QuickDispatch] push fan-out failed: ${err.message}`));

    await QuickOrder.updateOne(
      { _id: order._id },
      {
        $set: {
          'dispatch.status': 'offered',
          'dispatch.deliveryPartnerId': null,
          'dispatch.assignedAt': new Date(),
          'dispatch.offerTimeoutSec': settings.offerTimeoutSec,
        },
        $push: {
          'dispatch.offeredTo': {
            $each: partnerIds.map((partnerId) => ({
              partnerId,
              at: new Date(),
              action: 'offered',
              attemptNumber: attempt,
              radiusKm: maxKm,
            })),
          },
        },
      },
    );

    logger.info(`[QuickDispatch] Offered order ${order._id} to ${partnerIds.length} rider(s), attempt ${attempt}.`);
    return order;
  } finally {
    await QuickOrder.updateOne({ _id: order._id }, { $unset: { 'dispatch.dispatchingAt': '' } });
  }
}

/**
 * First rider to accept wins; everyone else gets "gone". The seller order is created here —
 * this is the moment the shop learns the order exists.
 */
/**
 * Undo a QC claim the rider was not entitled to keep, and put the order back on the hunt.
 *
 * Only reachable from the stacking reconcile, which runs before the seller fan-out and the
 * customer notification, so nothing outside this collection has to be unwound. The handover OTP
 * is cleared too: a new one is minted for whoever accepts next.
 */
async function releaseQuickOrderClaim(orderMongoId, partnerId, preClaim = {}) {
  try {
    await QuickOrder.updateOne(
      {
        _id: orderMongoId,
        'dispatch.deliveryPartnerId': new mongoose.Types.ObjectId(String(partnerId)),
      },
      {
        $set: {
          'dispatch.status': 'unassigned',
          'dispatch.deliveryPartnerId': null,
          orderStatus: preClaim?.orderStatus || 'placed',
          'deliveryState.currentPhase': preClaim?.deliveryState?.currentPhase || null,
        },
        $unset: { 'dispatch.acceptedAt': '', deliveryOtp: '' },
        $push: {
          statusHistory: {
            byRole: 'SYSTEM',
            from: 'confirmed',
            to: preClaim?.orderStatus || 'placed',
            note: 'Accept rolled back: rider was already at their concurrent-order limit',
            at: new Date(),
          },
        },
      },
    );
    void dispatchQuickOrder(String(orderMongoId), { attempt: 2 }).catch((err) =>
      logger.warn(`[QuickDispatch] re-dispatch after capacity rollback failed: ${err.message}`),
    );
  } catch (err) {
    logger.error(
      `[QuickDispatch] failed to roll back over-capacity accept for ${orderMongoId}: ${err.message}`,
    );
  }
}

export async function acceptQuickOrder(orderId, partnerId) {
  if (!mongoose.Types.ObjectId.isValid(String(orderId))) {
    return { ok: false, reason: 'INVALID_ORDER' };
  }

  // Order stacking is shared with Food: a rider already holding their maximum (counting both
  // verticals) cannot take this job, however they got hold of the offer card.
  const capacity = await getRiderCapacity(partnerId, { excludeOrderId: orderId });
  if (!capacity.canAcceptMore) {
    return { ok: false, reason: 'AT_CAPACITY', message: capacity.message };
  }

  // Snapshot of what the claim below overwrites, so an over-capacity claim can be put back
  // exactly as it was. Read separately because the claim returns the UPDATED document; the
  // status could in theory move between this read and the claim, which on the rare rollback
  // path costs us a slightly stale status and nothing else.
  const preClaim = await QuickOrder.findById(orderId)
    .select('+deliveryOtp orderStatus deliveryState.currentPhase')
    .lean();

  // A fresh order is still 'placed'; one an admin re-assigned mid-flight keeps the progress the
  // shop has already made, and keeps the handover code the customer already holds.
  const freshOrder = !preClaim || ['placed', 'created', 'scheduled'].includes(preClaim.orderStatus);
  const partnerObjectId = new mongoose.Types.ObjectId(String(partnerId));

  const claimed = await QuickOrder.findOneAndUpdate(
    {
      _id: new mongoose.Types.ObjectId(String(orderId)),
      orderStatus: { $in: DISPATCHABLE_STATUSES },
      'dispatch.acceptedAt': { $exists: false },
      // Open to whoever was offered it, or reserved for the rider an admin picked.
      $or: [
        { 'dispatch.deliveryPartnerId': null },
        { 'dispatch.deliveryPartnerId': { $exists: false } },
        { 'dispatch.deliveryPartnerId': partnerObjectId },
      ],
    },
    {
      $set: {
        'dispatch.status': 'accepted',
        'dispatch.deliveryPartnerId': partnerObjectId,
        'dispatch.acceptedAt': new Date(),
        'dispatch.assignedAt': new Date(),
        'deliveryState.currentPhase': 'en_route_to_pickup',
        ...(freshOrder ? { orderStatus: 'confirmed' } : {}),
        // Handover code the customer reads out at the door; the rider verifies it to finish.
        ...(preClaim?.deliveryOtp
          ? {}
          : {
              deliveryOtp: String(Math.floor(1000 + Math.random() * 9000)),
              // Without this the customer app never shows the code the rider asks for at the door.
              'deliveryVerification.dropOtp.required': true,
              'deliveryVerification.dropOtp.verified': false,
            }),
      },
      $push: {
        statusHistory: {
          byRole: 'DELIVERY_PARTNER',
          from: preClaim?.orderStatus || 'placed',
          to: freshOrder ? 'confirmed' : preClaim.orderStatus,
          note: freshOrder ? 'Rider accepted; order sent to seller' : 'Rider accepted the reassigned order',
          at: new Date(),
        },
      },
    },
    { new: true },
  );

  if (!claimed) return { ok: false, reason: 'ALREADY_TAKEN' };

  // Post-claim stacking guard, mirroring the Food accept path. Two accepts by the same rider
  // (QC + QC, or QC + Food) can both clear the pre-check above and both claim; the shared
  // reconcile picks the oldest acceptances and tells the surplus claim to release itself.
  //
  // Deliberately placed BEFORE the seller fan-out and the customer notification, so a released
  // claim never reaches a shop or the customer.
  if (await claimExceedsStackingLimit(claimed._id, partnerId)) {
    await releaseQuickOrderClaim(claimed._id, partnerId, preClaim);
    return { ok: false, reason: 'AT_CAPACITY', message: CAPACITY_REACHED_MESSAGE };
  }

  // Tell the riders who lost the race to drop the card.
  const losers = (claimed.dispatch?.offeredTo || [])
    .map((o) => String(o.partnerId))
    .filter((id) => id && id !== String(partnerId));
  emitToRiders(losers, 'order_taken', () => ({ orderMongoId: String(claimed._id), orderKind: 'quick' }));
  // The rider app closes its offer card on `order_claimed` (what Food emits), so send that too.
  emitToRiders(losers, 'order_claimed', () => ({
    orderId: String(claimed._id),
    orderMongoId: String(claimed._id),
    orderKind: 'quick',
  }));
  if (losers.length) {
    void notifyOwnersSafely(
      losers.map((ownerId) => ({ ownerType: 'DELIVERY_PARTNER', ownerId })),
      {
        title: 'Order taken',
        body: 'Another delivery partner accepted this order.',
        dataOnly: true,
        data: { type: 'order_taken', orderId: String(claimed._id), orderMongoId: String(claimed._id), orderKind: 'quick' },
      },
    ).catch((err) => logger.warn(`[QuickDispatch] order_taken push failed: ${err.message}`));
  }

  // Seller learns about the order only now. A re-accept after an admin reassign must not re-create
  // (and so reset) a seller leg the shop has already started working on.
  try {
    const { SellerOrder } = await import('../seller/models/sellerOrder.model.js');
    const existingLegs = await SellerOrder.find({ parentOrderId: claimed._id });
    const fanout = await import('./quickSellerOrderFanout.service.js');
    if (!existingLegs.length) {
      await fanout.fanOutQuickSellerOrdersForParent(claimed);
    } else {
      // Leg may pre-exist (built silently before accept): still pending -> ring the seller now.
      // Past pending (admin reassign) -> stay quiet.
      const pendingLegs = existingLegs.filter((leg) => leg.status === 'pending');
      if (pendingLegs.length) await fanout.emitQuickSellerOrders(pendingLegs);
    }
  } catch (err) {
    logger.error(`[QuickDispatch] seller fan-out failed for ${claimed._id}: ${err.message}`);
  }

  await emitQuickOrderUpdate(claimed, 'rider_assigned', { message: 'Rider assigned — the store is preparing your order.' });
  return { ok: true, order: claimed };
}

/**
 * Rider declined: remember it. The next hunt round starts straight away only once every rider
 * in the current round has answered; otherwise the others still have their window.
 */
export async function rejectQuickOrder(orderId, partnerId) {
  if (!mongoose.Types.ObjectId.isValid(String(orderId))) return { ok: false };

  const order = await QuickOrder.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId(String(orderId)), 'dispatch.acceptedAt': { $exists: false } },
    { $push: { 'dispatch.offeredTo': { partnerId, at: new Date(), action: 'rejected' } } },
    { new: true },
  ).select('dispatch');
  if (!order) return { ok: true };

  // An order an admin reserved for this rider goes back to the open hunt when they decline it.
  const reservedForRider = String(order.dispatch?.deliveryPartnerId || '') === String(partnerId);
  const entries = order.dispatch?.offeredTo || [];
  const round = Number(order.dispatch?.dispatchAttempt || 0);
  const offeredThisRound = entries.filter((o) => o.action === 'offered' && Number(o.attemptNumber || 0) === round);
  const rejectedIds = new Set(entries.filter((o) => o.action === 'rejected').map((o) => String(o.partnerId)));
  const everyoneAnswered =
    offeredThisRound.length === 0 || offeredThisRound.every((o) => rejectedIds.has(String(o.partnerId)));

  if (reservedForRider || everyoneAnswered) {
    await QuickOrder.updateOne(
      { _id: order._id, 'dispatch.acceptedAt': { $exists: false } },
      { $set: { 'dispatch.status': 'unassigned', 'dispatch.deliveryPartnerId': null } },
    );
    void dispatchQuickOrder(orderId).catch((err) =>
      logger.warn(`[QuickDispatch] re-dispatch after reject failed: ${err.message}`),
    );
  }
  return { ok: true };
}

/**
 * Push the current QC order state out.
 *
 * Two channels on purpose: the lightweight `order_update` the rider screens listen to, plus
 * the canonical QC status event that the customer, seller and admin panels already consume.
 */
export async function emitQuickOrderUpdate(order, event = 'order_update', options = {}) {
  try {
    const io = getIO();
    if (io) {
      const payload = buildQuickOfferPayload(order);
      if (order?.userId) io.to(rooms.user(String(order.userId))).emit(event, payload);
      const partnerId = order?.dispatch?.deliveryPartnerId;
      if (partnerId) io.to(rooms.delivery(String(partnerId))).emit(event, payload);
      io.to(rooms.tracking(String(order._id))).emit(event, payload);
    }
  } catch (err) {
    logger.warn(`[QuickDispatch] emit ${event} failed: ${err.message}`);
  }

  try {
    const { emitQuickCommerceStatusUpdate } = await import('./quickStatusRealtime.service.js');
    await emitQuickCommerceStatusUpdate(order, options);
  } catch (err) {
    logger.warn(`[QuickDispatch] status broadcast failed: ${err.message}`);
  }
}

/**
 * Watchdog (runs on the server.js interval; BullMQ is optional in this deployment):
 *  1. re-offer orders whose offer window lapsed with nobody accepting
 *  2. remind / auto-cancel when a rider accepted but the store never responded
 *  3. cancel + refund orders that have hunted for a rider for too long
 */
export async function recoverStuckQuickOrders() {
  const settings = await getQuickDeliverySettings();
  const staleOfferBefore = new Date(Date.now() - settings.offerTimeoutSec * 1000);
  const stuck = await QuickOrder.find({
    orderStatus: { $in: DISPATCHABLE_STATUSES },
    'dispatch.acceptedAt': { $exists: false },
    $or: [
      { 'dispatch.status': { $in: ['unassigned', 'rejected'] } },
      { 'dispatch.status': { $in: ['offered', 'assigned'] }, 'dispatch.assignedAt': { $lt: staleOfferBefore } },
    ],
  })
    .select('_id dispatch.dispatchAttempt')
    .limit(25)
    .lean();

  for (const order of stuck) {
    // dispatchQuickOrder derives the round from the order's own counter.
    await dispatchQuickOrder(order._id).catch((err) =>
      logger.warn(`[QuickDispatch] watchdog re-offer failed for ${order._id}: ${err.message}`),
    );
  }
  if (stuck.length) logger.info(`[QuickDispatch] watchdog re-offered ${stuck.length} order(s).`);

  try {
    const flows = await import('./quickOrderFlows.service.js');
    await flows.sweepQuickSellerAcknowledgements();
    await flows.sweepQuickNoRiderTimeouts();
    await flows.activateDueScheduledQuickOrders();
  } catch (err) {
    logger.warn(`[QuickDispatch] lifecycle sweep failed: ${err.message}`);
  }
}

/** Seller for an accepted order (used by the rider pickup screens). */
export async function getQuickOrderSeller(order) {
  const sellerId = resolveQuickPickup(order).sellerId;
  if (!sellerId || !mongoose.Types.ObjectId.isValid(String(sellerId))) return null;
  return Seller.findById(sellerId).select('shopName name phone location shopInfo').lean();
}
