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
import { getIO, rooms } from '../../../config/socket.js';
import { logger } from '../../../utils/logger.js';

/** Offer window before the order is re-offered to the next riders. */
export const QUICK_OFFER_TIMEOUT_MS = 60 * 1000;
/** Give up (and let admin/user cancel) after this many hunting rounds. */
const MAX_QUICK_DISPATCH_ATTEMPTS = 10;
const DISPATCH_LOCK_TTL_MS = 2 * 60 * 1000;

/** Statuses where a rider may still be hunted for. */
const DISPATCHABLE_STATUSES = ['placed', 'confirmed', 'preparing', 'ready_for_pickup'];

const toId = (value) => {
  const raw = value?._id || value;
  return raw ? String(raw) : '';
};

/** Seller shop acts as the pickup, mirroring the restaurant on a Food order. */
const resolveQuickPickup = (order) => {
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
    note: order?.note || '',
    riderEarning,
    earnings: riderEarning,
    deliveryBoyFee: riderEarning,
    deliveryFee: order?.pricing?.deliveryFee || 0,
    dispatch: order?.dispatch,
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
  const attempt = Number(options.attempt || 1);
  const staleLockBefore = new Date(Date.now() - DISPATCH_LOCK_TTL_MS);
  const staleOfferBefore = new Date(Date.now() - QUICK_OFFER_TIMEOUT_MS);

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

  try {
    const pickup = resolveQuickPickup(order);
    if (!Number.isFinite(pickup.latitude) || !Number.isFinite(pickup.longitude)) {
      logger.warn(`[QuickDispatch] Order ${order._id} has no seller coordinates; cannot hunt riders.`);
      return order;
    }

    const paymentMethod = String(order.payment?.method || '').toLowerCase();
    const isCashOrder = paymentMethod === 'cash' || paymentMethod === 'cod';
    const requiredAmount = isCashOrder ? Number(order.pricing?.total || 0) : 0;

    // Same widening ladder as Food: start tight, open up when nobody bites.
    let maxKm = 15;
    if (attempt === 2) maxKm = 25;
    else if (attempt === 3) maxKm = 40;
    else if (attempt >= 4) maxKm = 60;

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
    });

    const alreadyOffered = new Set((order.dispatch?.offeredTo || []).map((o) => String(o.partnerId)));
    const fresh = partners.filter((p) => !alreadyOffered.has(String(p.partnerId)));
    // After a few rounds re-offer to everyone again rather than starving the order.
    const offerBatch = fresh.length > 0 ? fresh.slice(0, 5) : partners.slice(0, 10);

    if (offerBatch.length === 0) {
      logger.info(`[QuickDispatch] No riders available for order ${order._id} within ${maxKm}km (attempt ${attempt}).`);
      return order;
    }

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
        body: `You have 60 seconds to accept order #${order.orderId || order._id}.`,
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
          'dispatch.offerTimeoutSec': Math.round(QUICK_OFFER_TIMEOUT_MS / 1000),
        },
        $push: {
          'dispatch.offeredTo': {
            $each: partnerIds.map((partnerId) => ({ partnerId, at: new Date(), action: 'offered' })),
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
export async function acceptQuickOrder(orderId, partnerId) {
  if (!mongoose.Types.ObjectId.isValid(String(orderId))) {
    return { ok: false, reason: 'INVALID_ORDER' };
  }

  const claimed = await QuickOrder.findOneAndUpdate(
    {
      _id: new mongoose.Types.ObjectId(String(orderId)),
      orderStatus: { $in: DISPATCHABLE_STATUSES },
      'dispatch.acceptedAt': { $exists: false },
      $or: [
        { 'dispatch.deliveryPartnerId': null },
        { 'dispatch.deliveryPartnerId': { $exists: false } },
      ],
    },
    {
      $set: {
        'dispatch.status': 'accepted',
        'dispatch.deliveryPartnerId': new mongoose.Types.ObjectId(String(partnerId)),
        'dispatch.acceptedAt': new Date(),
        'dispatch.assignedAt': new Date(),
        'deliveryState.currentPhase': 'en_route_to_pickup',
        orderStatus: 'confirmed',
        // Handover code the customer reads out at the door; the rider verifies it to finish.
        deliveryOtp: String(Math.floor(1000 + Math.random() * 9000)),
      },
      $push: {
        statusHistory: {
          byRole: 'DELIVERY_PARTNER',
          from: 'placed',
          to: 'confirmed',
          note: 'Rider accepted; order sent to seller',
          at: new Date(),
        },
      },
    },
    { new: true },
  );

  if (!claimed) return { ok: false, reason: 'ALREADY_TAKEN' };

  // Tell the riders who lost the race to drop the card.
  const losers = (claimed.dispatch?.offeredTo || [])
    .map((o) => String(o.partnerId))
    .filter((id) => id && id !== String(partnerId));
  emitToRiders(losers, 'order_taken', () => ({ orderMongoId: String(claimed._id), orderKind: 'quick' }));

  // Seller learns about the order only now.
  try {
    const { fanOutQuickSellerOrdersForParent } = await import('./quickSellerOrderFanout.service.js');
    await fanOutQuickSellerOrdersForParent(claimed);
  } catch (err) {
    logger.error(`[QuickDispatch] seller fan-out failed for ${claimed._id}: ${err.message}`);
  }

  await emitQuickOrderUpdate(claimed, 'rider_assigned', { message: 'Rider assigned — the store is preparing your order.' });
  return { ok: true, order: claimed };
}

/** Rider declined (or let the card expire): remember it and hunt again straight away. */
export async function rejectQuickOrder(orderId, partnerId) {
  if (!mongoose.Types.ObjectId.isValid(String(orderId))) return { ok: false };

  await QuickOrder.updateOne(
    { _id: new mongoose.Types.ObjectId(String(orderId)), 'dispatch.acceptedAt': { $exists: false } },
    {
      $set: { 'dispatch.status': 'unassigned' },
      $push: { 'dispatch.offeredTo': { partnerId, at: new Date(), action: 'rejected' } },
    },
  );

  void dispatchQuickOrder(orderId, { attempt: 2 }).catch((err) =>
    logger.warn(`[QuickDispatch] re-dispatch after reject failed: ${err.message}`),
  );
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
 * Watchdog: re-offer QC orders whose offer window lapsed with nobody accepting. BullMQ is
 * optional in this deployment, so the interval in server.js is what actually keeps hunting.
 */
export async function recoverStuckQuickOrders() {
  const staleOfferBefore = new Date(Date.now() - QUICK_OFFER_TIMEOUT_MS);
  const stuck = await QuickOrder.find({
    orderStatus: { $in: DISPATCHABLE_STATUSES },
    'dispatch.acceptedAt': { $exists: false },
    $or: [
      { 'dispatch.status': { $in: ['unassigned', 'rejected'] } },
      { 'dispatch.status': 'offered', 'dispatch.assignedAt': { $lt: staleOfferBefore } },
    ],
  })
    .select('_id dispatch.offeredTo')
    .limit(25)
    .lean();

  for (const order of stuck) {
    const rounds = (order.dispatch?.offeredTo || []).length;
    if (rounds > MAX_QUICK_DISPATCH_ATTEMPTS * 5) continue;
    await dispatchQuickOrder(order._id, { attempt: Math.min(4, Math.floor(rounds / 5) + 1) }).catch((err) =>
      logger.warn(`[QuickDispatch] watchdog re-offer failed for ${order._id}: ${err.message}`),
    );
  }
  if (stuck.length) logger.info(`[QuickDispatch] watchdog re-offered ${stuck.length} order(s).`);
}

/** Seller for an accepted order (used by the rider pickup screens). */
export async function getQuickOrderSeller(order) {
  const sellerId = resolveQuickPickup(order).sellerId;
  if (!sellerId || !mongoose.Types.ObjectId.isValid(String(sellerId))) return null;
  return Seller.findById(sellerId).select('shopName name phone location shopInfo').lean();
}
