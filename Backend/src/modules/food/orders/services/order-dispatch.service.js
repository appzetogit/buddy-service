import mongoose from 'mongoose';
import { FoodOrder, FoodSettings } from '../models/order.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { FoodDeliveryCashDeposit } from '../../delivery/models/foodDeliveryCashDeposit.model.js';
import { FoodDeliveryCashLimit } from '../../admin/models/deliveryCashLimit.model.js';
import { BuddyIdentity } from '../../../../core/identity/buddyIdentity.model.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';
import { config } from '../../../../config/env.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { addOrderJob } from '../../../../queues/producers/order.producer.js';
import { haversineKm } from '../../../../core/location/haversine.util.js';
import { getRoadDistanceBatch } from '../../../../core/location/distance.service.js';
import {
  buildDeliverySocketPayload,
  buildOfferPushData,
  buildOrderIdentityFilter,
  notifyOwnersSafely,
  publish,
  MAX_DISPATCH_ATTEMPTS,
} from './order.helpers.js';
import { fetchRoadDistancesKm } from '../utils/googleMaps.js';

// Singleton initializer loop for Socket Bridge at server boot.
//
// Bounded: this module is also imported by the standalone BullMQ workers (see
// ecosystem.config.cjs), where initSocket() is never called, so getIO() stays null forever. An
// unbounded retry left a 200ms timer spinning for the lifetime of every worker process.
const SOCKET_BRIDGE_RETRY_MS = 200;
const SOCKET_BRIDGE_MAX_ATTEMPTS = 150; // ~30s, ample for boot ordering in the web process
let socketBridgeInitialized = false;
let socketBridgeAttempts = 0;

function scheduleSocketBridgeRetry() {
  socketBridgeAttempts += 1;
  if (socketBridgeAttempts >= SOCKET_BRIDGE_MAX_ATTEMPTS) {
    logger.warn(
      '[SocketBridge] Socket.IO unavailable in this process after ' +
      `${socketBridgeAttempts} attempts; giving up. Expected in BullMQ worker processes — ` +
      'but note that socket emits from this process will be dropped unless the Redis adapter is attached.',
    );
    return;
  }
  setTimeout(tryInitSocketBridge, SOCKET_BRIDGE_RETRY_MS).unref?.();
}

function tryInitSocketBridge() {
  if (socketBridgeInitialized) return;
  try {
    const io = getIO(true);
    if (io) {
      import('../../../../shared/adapters/socket-bridge.service.js')
        .then(({ initializeSocketBridge }) => {
          initializeSocketBridge(io);
          socketBridgeInitialized = true;
          logger.info('[SocketBridge] Successfully initialized once at server boot via order-dispatch service hook.');
        })
        .catch((err) => {
          logger.warn(`[SocketBridge] Failed to load socket-bridge.service.js: ${err.message}`);
        });
    } else {
      scheduleSocketBridgeRetry();
    }
  } catch {
    scheduleSocketBridgeRetry();
  }
}
tryInitSocketBridge();

/**
 * Candidate ordering: live riders first, then nearest.
 *
 * Used for every re-sort in the shortlist pipeline (straight-line, then road-distance
 * refinement) so a later sort cannot silently discard the presence ranking.
 */
/**
 * How long a `dispatch.dispatchingAt` lock is honoured before it is treated as abandoned.
 * Must exceed the worst-case runtime of tryAutoAssign (geo query + Distance Matrix + writes).
 */
const DISPATCH_LOCK_TTL_MS = 2 * 60 * 1000;

const byPresenceThenDistance = (a, b) => {
  const aStale = Boolean(a?.stalePresence);
  const bStale = Boolean(b?.stalePresence);
  if (aStale !== bStale) return aStale ? 1 : -1;
  return a.distanceKm - b.distanceKm;
};

/**
 * Symmetric check to the taxi side: drop any delivery partner whose linked
 * BuddyIdentity says they're currently in taxi mode. Legacy partners without
 * an identityId are passed through unchanged.
 */
async function excludeTaxiModePartners(partners = []) {
  if (!partners.length) return partners;
  const partnerIds = partners.map((p) => p.partnerId || p._id).filter(Boolean);
  if (!partnerIds.length) return partners;

  const partnerDocs = await FoodDeliveryPartner.find({ _id: { $in: partnerIds } })
    .select('_id identityId')
    .lean();
  const identityByPartner = new Map(
    partnerDocs.map((d) => [String(d._id), d.identityId ? String(d.identityId) : null]),
  );

  const identityIds = [...new Set(partnerDocs.map((d) => d.identityId).filter(Boolean))];
  if (!identityIds.length) return partners;

  const taxiModeIds = await BuddyIdentity.find({
    _id: { $in: identityIds },
    activeService: 'taxi',
  })
    .select('_id')
    .lean();
  if (!taxiModeIds.length) return partners;
  const blocked = new Set(taxiModeIds.map((d) => String(d._id)));

  return partners.filter((p) => {
    const identityId = identityByPartner.get(String(p.partnerId || p._id));
    return !identityId || !blocked.has(identityId);
  });
}

async function filterPartnersByCashLimit(partners = [], options = {}) {
  if (!Array.isArray(partners) || partners.length === 0) return [];
  const requiredAmount = Math.max(0, Number(options.requiredAmount || 0));
  const allowOverLimitFallback = options.allowOverLimitFallback !== false;

  const limitDoc = await FoodDeliveryCashLimit.findOne({ isActive: true })
    .sort({ createdAt: -1 })
    .lean();
  const totalCashLimit = Number(limitDoc?.deliveryCashLimit || 0);

  // Treat missing/non-positive setting as "no cap" to avoid blocking all dispatch.
  if (!Number.isFinite(totalCashLimit) || totalCashLimit <= 0) {
    return partners.map((p) => ({
      ...p,
      availableCashLimit: Number.MAX_SAFE_INTEGER,
      allowOverLimit: false,
      requiredCashForOrder: requiredAmount,
    }));
  }

  const partnerIds = partners
    .map((p) => p?.partnerId || p?._id)
    .filter(Boolean)
    .map((id) => new mongoose.Types.ObjectId(String(id)));

  if (partnerIds.length === 0) return [];

  const [cashAgg, depositsAgg] = await Promise.all([
    FoodOrder.aggregate([
      {
        $match: {
          'dispatch.deliveryPartnerId': { $in: partnerIds },
          orderStatus: 'delivered',
          'payment.method': 'cash',
        },
      },
      {
        $group: {
          _id: '$dispatch.deliveryPartnerId',
          grossCashCollected: { $sum: { $ifNull: ['$pricing.total', 0] } },
        },
      },
    ]),
    FoodDeliveryCashDeposit.aggregate([
      {
        $match: {
          deliveryPartnerId: { $in: partnerIds },
          status: 'Completed',
        },
      },
      {
        $group: {
          _id: '$deliveryPartnerId',
          depositedCash: { $sum: { $ifNull: ['$amount', 0] } },
        },
      },
    ]),
  ]);

  const grossCashByPartner = new Map(
    (cashAgg || []).map((row) => [String(row._id), Number(row.grossCashCollected || 0)]),
  );
  const depositedByPartner = new Map(
    (depositsAgg || []).map((row) => [String(row._id), Number(row.depositedCash || 0)]),
  );

  const withCapacity = partners.map((p) => {
    const partnerId = String(p?.partnerId || p?._id || '');
    if (!partnerId) return null;
    const grossCash = grossCashByPartner.get(partnerId) || 0;
    const depositedCash = depositedByPartner.get(partnerId) || 0;
    const cashInHand = Math.max(0, grossCash - depositedCash);
    const availableCashLimit = Math.max(0, totalCashLimit - cashInHand);
    return {
      ...p,
      availableCashLimit,
      allowOverLimit: false,
      requiredCashForOrder: requiredAmount,
    };
  }).filter(Boolean);

  // Cash-in-hand only constrains CASH orders. COD is disabled at order creation, so applying
  // this to prepaid/wallet orders would strand riders who merely hold historical cash.
  if (requiredAmount <= 0) return withCapacity;

  // Base block: riders with zero available limit should not receive fresh cash offers.
  const baseEligible = withCapacity.filter((p) => Number(p.availableCashLimit || 0) > 0);
  if (baseEligible.length === 0) return [];

  const sufficient = baseEligible.filter(
    (p) => Number(p.availableCashLimit || 0) >= requiredAmount,
  );
  if (sufficient.length > 0) return sufficient;

  if (!allowOverLimitFallback) return [];

  // Fallback: keep order moving by offering to highest available-limit riders.
  return baseEligible
    .slice()
    .sort((a, b) => Number(b.availableCashLimit || 0) - Number(a.availableCashLimit || 0))
    .map((p) => ({
      ...p,
      allowOverLimit: true,
    }));
}

async function listNearbyOnlineDeliveryPartners(
  restaurantId,
  { maxKm = 15, limit = 25, requiredAmount = 0, allowOverLimitFallback = true } = {},
) {
  let coordinates = null;
  if (restaurantId && restaurantId.location && Array.isArray(restaurantId.location.coordinates)) {
    coordinates = restaurantId.location.coordinates;
  } else if (restaurantId) {
    const rId = (restaurantId?._id || restaurantId).toString();
    const restaurant = await FoodRestaurant.findById(rId)
      .select("location")
      .lean();
    if (restaurant?.location?.coordinates?.length) {
      coordinates = restaurant.location.coordinates;
    }
  }

  if (!coordinates) {
    const partners = await FoodDeliveryPartner.find({
      status: "approved",
      availabilityStatus: "online",
    })
      .select("_id status name")
      .limit(Math.max(1, limit))
      .lean();

    const cashEligiblePartners = await filterPartnersByCashLimit(
      partners.map((p) => ({ partnerId: p._id, ...p })),
      { requiredAmount, allowOverLimitFallback },
    );
    const modeEligible = await excludeTaxiModePartners(cashEligiblePartners);

    return {
      restaurant: null,
      partners: modeEligible.map((p) => ({ partnerId: p.partnerId || p._id, distanceKm: null })),
    };
  }

  const [rLng, rLat] = coordinates;
  const allOnline = await FoodDeliveryPartner.find({
    availabilityStatus: "online",
  })
    .select("_id status lastLat lastLng lastLocationAt name presence")
    .lean();

  const scored = [];
  const allowedStatuses = process.env.NODE_ENV === 'production' ? ['approved'] : ['approved', 'pending'];
  const STALE_GPS_MS = 10 * 60 * 1000;
  // A partner not seen on a socket for this long is probably a ghost: availabilityStatus says
  // 'online' but the app is killed. Rank them last rather than dropping them, so a presence
  // bug (or a partner on a flaky connection) can never starve dispatch.
  const STALE_PRESENCE_MS = 2 * 60 * 1000;

  const hasStalePresence = (p) => {
    const lastSeen = p?.presence?.lastSeenAt;
    // No presence recorded at all = a partner who has not connected since this shipped.
    // Treat as fresh so the rollout cannot silently de-rank the entire fleet.
    if (!lastSeen) return false;
    return Date.now() - new Date(lastSeen).getTime() > STALE_PRESENCE_MS;
  };

  for (const p of allOnline) {
    if (!allowedStatuses.includes(p.status)) continue;

    const stalePresence = hasStalePresence(p);
    const isStale = !p.lastLocationAt || (Date.now() - new Date(p.lastLocationAt).getTime()) > STALE_GPS_MS;
    if (p.lastLat == null || p.lastLng == null || isStale) {
      scored.push({ partnerId: p._id, distanceKm: 999, status: p.status, stalePresence });
      continue;
    }

    const d = haversineKm(rLat, rLng, p.lastLat, p.lastLng);
    if (Number.isFinite(d) && d <= maxKm) {
      scored.push({ partnerId: p._id, distanceKm: d, status: p.status, lat: p.lastLat, lng: p.lastLng, stalePresence });
    }
  }

  // Live riders first, then by distance. Ghosts stay in the pool but sit at the back.
  scored.sort(byPresenceThenDistance);
  let picked = scored.slice(0, Math.max(1, limit));

  // Refine the already stale-filtered, straight-line-sorted shortlist with real
  // road distance. Bounded to `picked.length` (<= limit, default 25) so this
  // never balloons into a Distance Matrix call per online partner.
  const withCoords = picked.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (withCoords.length > 0) {
    const roadResults = await getRoadDistanceBatch(
      { lat: rLat, lng: rLng },
      withCoords.map((p) => ({ lat: p.lat, lng: p.lng })),
    );
    withCoords.forEach((p, i) => {
      if (roadResults[i]) p.distanceKm = roadResults[i].meters / 1000;
    });
    picked = picked.slice().sort(byPresenceThenDistance);
  }

  // Re-rank top candidates by road distance when Google Maps is configured.
  if (picked.length > 0 && Number.isFinite(rLat) && Number.isFinite(rLng)) {
    const partnerById = new Map(allOnline.map((p) => [String(p._id), p]));
    const roadCandidates = picked
      .map((entry) => {
        const p = partnerById.get(String(entry.partnerId));
        if (!p || p.lastLat == null || p.lastLng == null) return null;
        return { entry, lat: p.lastLat, lng: p.lastLng };
      })
      .filter(Boolean);

    if (roadCandidates.length > 0) {
      const roadKmList = await fetchRoadDistancesKm(
        { lat: rLat, lng: rLng },
        roadCandidates.map((c) => ({ lat: c.lat, lng: c.lng })),
      );
      if (Array.isArray(roadKmList)) {
        roadCandidates.forEach((c, idx) => {
          const roadKm = roadKmList[idx];
          if (Number.isFinite(roadKm)) {
            c.entry.distanceKm = roadKm;
            c.entry.distanceSource = 'road';
          }
        });
        picked.sort(byPresenceThenDistance);
      }
    }
  }

  if (picked.length === 0) {
    const anyOnline = await FoodDeliveryPartner.find({
      status: { $in: allowedStatuses },
      availabilityStatus: "online",
    })
      .select("_id status name identityId")
      .limit(Math.max(1, limit))
      .lean();

    const eligible = await excludeTaxiModePartners(
      anyOnline.map((p) => ({ partnerId: p._id, ...p })),
    );

    return {
      partners: eligible.map((p) => ({
        partnerId: p.partnerId || p._id,
        distanceKm: null,
        status: p.status,
      })),
    };
  }

  const final = (config.env === 'production')
    ? picked.filter(p => p.status === 'approved')
    : picked;

  const cashEligibleFinal = await filterPartnersByCashLimit(final, {
    requiredAmount,
    allowOverLimitFallback,
  });
  const modeEligibleFinal = await excludeTaxiModePartners(cashEligibleFinal);

  return { partners: modeEligibleFinal };
}

export async function getDispatchSettings() {
  return { dispatchMode: "auto" };
}

export async function updateDispatchSettings(dispatchMode, adminId) {
  // Always set to auto
  await FoodSettings.findOneAndUpdate(
    { key: "dispatch" },
    {
      $set: {
        dispatchMode: "auto",
        updatedBy: { role: "ADMIN", adminId, at: new Date() },
      },
    },
    { upsert: true, new: true },
  );
  return getDispatchSettings();
}

export async function tryAutoAssign(orderId, options = {}) {
  const attempt = options.attempt || 1;
  const lockTimeout = 90000; // 90 seconds lock interval

  // Self-healing dispatch lock.
  //
  // `dispatchingAt` is cleared in a finally block, so a process that dies inside this function
  // leaves it set forever — and the selection query below used to require
  // `{ $exists: false }`, which made that order permanently undispatchable. Comparing against a
  // TTL instead means a crashed lock ages out on its own.
  const staleLockBefore = new Date(Date.now() - DISPATCH_LOCK_TTL_MS);
  const lockIsFree = {
    $or: [
      { 'dispatch.dispatchingAt': { $exists: false } },
      { 'dispatch.dispatchingAt': null },
      { 'dispatch.dispatchingAt': { $lt: staleLockBefore } },
    ],
  };

  const dispatchableStatuses = new Set([
    'created',
    'confirmed',
    'preparing',
    'ready_for_pickup',
    'ready',
    'picked_up',
  ]);

  const isObjectId = mongoose.Types.ObjectId.isValid(orderId);
  const FoodOrder = mongoose.model('FoodOrder');
  const Order = mongoose.model('Order');

  let order = null;
  let isQc = false;

  // Try to find in Food Order
  order = await FoodOrder.findOneAndUpdate(
    {
      _id: isObjectId ? new mongoose.Types.ObjectId(orderId) : null,
      orderStatus: { $in: Array.from(dispatchableStatuses) },
      $and: [
        {
          $or: [
            { 'dispatch.status': 'unassigned' },
            {
              'dispatch.status': 'assigned',
              'dispatch.acceptedAt': { $exists: false },
              'dispatch.assignedAt': { $lt: new Date(Date.now() - lockTimeout) }
            }
          ],
        },
        lockIsFree,
      ],
    },
    {
      $set: { 'dispatch.dispatchingAt': new Date() }
    },
    { new: true }
  ).populate(['restaurantId', 'userId', 'zoneId']);

  if (!order) {
    // Try to find in QC Order
    const qcQuery = {
      workflowStatus: 'DELIVERY_SEARCH',
      'dispatch.status': { $in: ['unassigned', 'offered', 'timed_out'] },
      // Same self-healing lock as the food path above.
      ...lockIsFree,
    };
    if (isObjectId) {
      qcQuery._id = new mongoose.Types.ObjectId(orderId);
    } else {
      qcQuery.orderId = orderId;
    }


    order = await Order.findOneAndUpdate(
      qcQuery,
      {
        $set: { 'dispatch.dispatchingAt': new Date() }
      },
      { new: true }
    ).populate(['seller', 'customer']);

    if (order) {
      isQc = true;
    }
  }

  if (!order) {
    logger.info(`tryAutoAssign: Skip for ${orderId} (not dispatchable, already dispatching, accepted, or lock active).`);
    return null;
  }

  try {
    const offeredIds = (order.dispatch?.offeredTo || []).map(o => o.partnerId.toString());
    const paymentMethod = String(isQc ? (order.paymentMode || 'COD') : (order.payment?.method || 'cash')).toLowerCase();
    const isCashOrder = paymentMethod === 'cash' || paymentMethod === 'cod';
    const requiredAmount = isCashOrder ? Number(order.pricing?.total || 0) : 0;
    
    // RADIUS EXPANSION LOGIC
    const isPriority = isQc ? false : ['confirmed', 'preparing', 'ready_for_pickup', 'ready'].includes(order.orderStatus);
    
    let maxKm = 15;
    if (isPriority) {
      maxKm = 60;
    } else {
      if (attempt === 2) maxKm = 25;
      if (attempt === 3) maxKm = 40;
      if (attempt >= 4) maxKm = 60;
    }

    const searchOptions = {
      maxKm,
      limit: 15,
      requiredAmount,
      allowOverLimitFallback: true,
    };

    // Use normalized pickup from adapter
    const { normalizePickupForDispatch } = await import('../../../../shared/adapters/qc-dispatch.adapter.js');
    const pickupTarget = normalizePickupForDispatch(order, isQc ? 'quick' : 'food');


    const { partners } = await listNearbyOnlineDeliveryPartners(pickupTarget, searchOptions);
    

    // TIERED ALERT LOGIC
    const isPhase2 = attempt >= 3;
    const isPhase3 = attempt >= 6; // ~6 minutes

    if (isPhase3 && !isQc) {
      logger.error(`[CRITICAL] Order ${order._id} unassigned for ${attempt} mins. Triggering Admin Alert (Phase 3).`);
      try {
        await notifyOwnersSafely(
          [{ ownerType: 'ADMIN', ownerId: 'GLOBAL' }],
          {
            title: 'Unassigned Food Order Crisis!',
            body: `Food Order #${order.order_id || order._id} has not been picked up for 5+ minutes.`,
            data: { type: 'admin_alert_unassigned', orderId: order._id.toString() }
          }
        );
      } catch (err) {
        logger.warn(`Admin notification failed: ${err.message}`);
      }
    }

    const eligible = partners.filter(p => !offeredIds.includes(p.partnerId.toString()));

    if (eligible.length === 0) {
      logger.info(`tryAutoAssign: No NEW eligible partners in ${maxKm}km for order ${order._id}. Restarting hunt...`);

      if (!isQc && attempt >= MAX_DISPATCH_ATTEMPTS) {
        try {
          const { cancelOrderNoDriverFound } = await import('./order.service.js');
          await cancelOrderNoDriverFound(order._id.toString());
        } catch (err) {
          logger.error(`tryAutoAssign: cancelOrderNoDriverFound failed for ${order._id}: ${err.message}`);
        }
        return order;
      }
      
      if (partners.length > 0) {
        let payload;
        if (isQc) {
          const { adaptQcOrderToFoodShape } = await import('../../../../shared/adapters/delivery-response.adapter.js');
          payload = buildDeliverySocketPayload(adaptQcOrderToFoodShape(order), null);
        } else {
          payload = buildDeliverySocketPayload(order, order.restaurantId);
        }
        // Re-broadcast to the already-offered pool. Through publish() so it is durable and so
        // it works from the BullMQ worker, where getIO() is null.
        const distanceByPartner = new Map(
          partners.map((p) => [String(p.partnerId), p.distanceKm]),
        );
        await publish(
          'new_order_available',
          payload,
          partners.map((p) => ({ kind: 'DELIVERY_PARTNER', id: p.partnerId })),
          {
            orderMongoId: order._id,
            payloadFor: (r) => ({
              ...payload,
              pickupDistanceKm: distanceByPartner.get(String(r.id)),
            }),
          },
        );
      }

      // Re-queue itself to keep trying
      await addOrderJob({
        action: 'DISPATCH_TIMEOUT_CHECK',
        orderMongoId: order._id.toString(),
        orderId: isQc ? order.orderId : order._id.toString(),
        attempt: attempt + 1
      }, { delay: 30000 }); // Retry faster (30s) if no one found

      return order;
    }

    let payload;
    if (isQc) {
      const { adaptQcOrderToFoodShape } = await import('../../../../shared/adapters/delivery-response.adapter.js');
      payload = buildDeliverySocketPayload(adaptQcOrderToFoodShape(order), null);
    } else {
      payload = buildDeliverySocketPayload(order, order.restaurantId);
    }

    const phase1Batch = eligible.slice(0, Math.min(3, eligible.length));

    // Everyone this attempt offers to. Phase 2 is the wide broadcast that exists precisely
    // because nobody accepted, so it needs the same reach as phase 1 — not less.
    const offerBatch = isPhase2 ? eligible : phase1Batch;

    if (isPhase2) {
      logger.info(`[Phase 2] Broadcasting order ${order._id} to ${eligible.length} riders.`);
    } else if (phase1Batch[0]) {
      const lead = phase1Batch[0];
      logger.info(`[Phase 1] Offering order ${order._id} to ${phase1Batch.length} riders (lead ${lead.partnerId}, ${lead.distanceKm}km)`);
    }

    // Through publish() so the offer lands in the durable outbox before it is emitted. This is
    // the event a rider most needs to recover after being offline, and until now it had no
    // durable record at all — a missed `new_order` was simply gone.
    //
    // pickupDistanceKm is per-rider, so the live payload is overridden per recipient while the
    // stored event keeps the base payload. The emitted shape is unchanged.
    const distanceByPartner = new Map(
      offerBatch.map((p) => [String(p.partnerId), p.distanceKm]),
    );
    await publish(
      'new_order',
      payload,
      offerBatch.map((p) => ({ kind: 'DELIVERY_PARTNER', id: p.partnerId })),
      {
        orderMongoId: order._id,
        alsoEmit: ['new_order_available'],
        payloadFor: (r) => ({
          ...payload,
          pickupDistanceKm: distanceByPartner.get(String(r.id)),
        }),
      },
    );

    // Push to EVERY rider in the batch, not just the lead. A socket emit only reaches a rider
    // whose app is foregrounded and connected; a rider with a backgrounded or killed app is
    // reachable by FCM alone. Previously phase 1 pushed to the lead only and phase 2 pushed to
    // nobody, so an offline rider could never learn about an offer.
    //
    // Fire-and-forget: notifyOwnersSafely fans out sequentially, and dispatch must not block on
    // it. `eligible` is bounded by searchOptions.limit (15), so the fan-out stays small.
    if (!isQc && offerBatch.length > 0) {
      const pushTargets = offerBatch.map((p) => ({
        ownerType: 'DELIVERY_PARTNER',
        ownerId: p.partnerId,
      }));
      void notifyOwnersSafely(pushTargets, {
        title: 'New order available!',
        body: `You have 60 seconds to accept Order #${order.order_id || order._id}.`,
        // Time-critical offer: ring through on a killed app.
        ring: true,
        // Ring every device this rider has registered (phone + web dashboard), rather than the
        // single most-recent token. An offer is worth the duplicate; the client dedupes by
        // order id within ALERT_DEDUPE_MS.
        sendToAllDevices: true,
        data: { ...buildOfferPushData(payload), orderId: order._id.toString() },
      }).catch((err) => {
        logger.warn(`Dispatch push fan-out failed for order ${order._id}: ${err.message}`);
      });
    }

    // Record exactly who was offered — same list that was emitted/pushed to above.
    const offeredToEntries = offerBatch.map(p => ({
      partnerId: p.partnerId,
      at: new Date(),
      action: 'offered',
      allowOverLimit: Boolean(p.allowOverLimit),
      requiredCashForOrder: Number(p.requiredCashForOrder || requiredAmount || 0),
      attemptNumber: attempt,
      radiusKm: maxKm,
    }));

    order.dispatch = order.dispatch || {};
    order.dispatch.status = 'offered'; // Set status to 'offered' during active offer attempt
    order.dispatch.deliveryPartnerId = null;
    order.dispatch.offeredTo = order.dispatch.offeredTo || [];
    order.dispatch.offeredTo.push(...offeredToEntries);

    const collectionName = isQc ? 'quick_orders' : 'food_orders';
    const updateRes = await mongoose.connection.db.collection(collectionName).updateOne(
      { _id: order._id },
      {
        $set: {
          'dispatch.status': 'offered',
          'dispatch.deliveryPartnerId': null
        },
        $push: {
          'dispatch.offeredTo': { $each: offeredToEntries }
        }
      }
    );
    // Re-check in 60s
    await addOrderJob({
      action: 'DISPATCH_TIMEOUT_CHECK',
      orderMongoId: order._id.toString(),
      orderId: isQc ? order.orderId : order._id.toString(),
      attempt: attempt + 1
    }, { delay: 60000 });

    return order;
  } finally {
    const collectionName = isQc ? 'quick_orders' : 'food_orders';
    await mongoose.connection.db.collection(collectionName).updateOne(
      { _id: order._id },
      { $unset: { 'dispatch.dispatchingAt': '' } }
    );
  }
}


export async function processDispatchTimeout(orderId, partnerId, options = {}) {
  const FoodOrder = mongoose.model('FoodOrder');
  const Order = mongoose.model('Order');

  let order = await FoodOrder.findById(orderId);
  let isQc = false;
  if (!order) {
    order = await Order.findById(orderId);
    if (order) isQc = true;
  }
  if (!order) return;

  const jobAttempt = Number(options.attempt || 0);
  const nextAttempt = jobAttempt > 0
    ? jobAttempt
    : (order.dispatch?.offeredTo?.length || 0) + 1;

  if (!isQc && nextAttempt >= MAX_DISPATCH_ATTEMPTS) {
    try {
      const { cancelOrderNoDriverFound } = await import('./order.service.js');
      await cancelOrderNoDriverFound(order._id.toString());
    } catch (err) {
      logger.error(`processDispatchTimeout: cancelOrderNoDriverFound failed for ${orderId}: ${err.message}`);
    }
    return;
  }

  const stillAssigned = order.dispatch?.status === 'assigned' &&
    String(order.dispatch?.deliveryPartnerId) === String(partnerId) &&
    !order.dispatch?.acceptedAt;

  if (stillAssigned) {
    logger.info(`Dispatch timeout for partner ${partnerId} on order ${orderId}. Re-trying hunt...`);

    // Use the id straight off the doc rather than re-casting `partnerId`: stillAssigned has
    // already proven they are equal, and this cannot throw on a malformed input.
    const timedOutPartnerId = order.dispatch.deliveryPartnerId;

    order.dispatch.status = 'unassigned';
    order.dispatch.deliveryPartnerId = null;

    // Mark just this partner's offer in place with an array filter.
    //
    // This used to read `offeredTo`, mutate it in memory and `$set` the whole array back — so
    // two overlapping timeout jobs for the same order silently lost one another's writes, and a
    // rider who had already declined could be re-offered indefinitely while a fresh rider was
    // skipped. A positional update touches only the matching element.
    const collectionName = isQc ? 'quick_orders' : 'food_orders';
    await mongoose.connection.db.collection(collectionName).updateOne(
      { _id: order._id },
      {
        $set: {
          'dispatch.status': 'unassigned',
          'dispatch.deliveryPartnerId': null,
          'dispatch.offeredTo.$[offer].action': 'timeout',
        }
      },
      {
        arrayFilters: [
          { 'offer.partnerId': timedOutPartnerId, 'offer.action': 'offered' },
        ],
      }
    );

    await tryAutoAssign(order._id, { attempt: nextAttempt });
  } else if (order.dispatch?.status === 'unassigned' || order.dispatch?.status === 'offered') {
    await tryAutoAssign(order._id, { attempt: nextAttempt });
  }
}


export async function resendDeliveryNotificationRestaurant(orderId, restaurantId) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne({
    ...identity,
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  });

  if (!order) throw new NotFoundError('Order not found');

  const activeStatuses = ['confirmed', 'preparing', 'ready_for_pickup', 'ready'];
  if (!activeStatuses.includes(order.orderStatus)) {
    throw new ValidationError(`Cannot resend notification for order in status: ${order.orderStatus}`);
  }

  if (order.dispatch?.status === 'accepted') {
    throw new ValidationError('A delivery partner has already accepted this order.');
  }

  const paymentMethod = String(order.payment?.method || 'cash').toLowerCase();
  const requiredAmount = paymentMethod === 'cash' ? Number(order?.pricing?.total || 0) : 0;
  const preview = await listNearbyOnlineDeliveryPartners(order.restaurantId, {
    maxKm: 15,
    limit: 15,
    requiredAmount,
    allowOverLimitFallback: true,
  });
  const shortlistedCount = Array.isArray(preview?.partners) ? preview.partners.length : 0;

  order.dispatch.status = 'unassigned';
  order.dispatch.deliveryPartnerId = null;
  order.dispatch.offeredTo = [];
  await order.save();

  await tryAutoAssign(order._id);

  const refreshed = await FoodOrder.findById(order._id)
    .select('dispatch.offeredTo dispatch.status dispatch.deliveryPartnerId')
    .lean();
  const notifiedCount = Array.isArray(refreshed?.dispatch?.offeredTo)
    ? refreshed.dispatch.offeredTo.filter((entry) => entry?.action === 'offered').length
    : 0;
  const notifiedPartnerIds = Array.isArray(refreshed?.dispatch?.offeredTo)
    ? refreshed.dispatch.offeredTo
        .filter((entry) => entry?.action === 'offered' && entry?.partnerId)
        .map((entry) => String(entry.partnerId))
    : [];
  const io = getIO();
  const connectedSocketCount = io
    ? notifiedPartnerIds.reduce((count, pid) => {
        const roomName = rooms.delivery(pid);
        const roomSize = io?.sockets?.adapter?.rooms?.get(roomName)?.size || 0;
        return count + roomSize;
      }, 0)
    : 0;

  return {
    success: true,
    notifiedCount,
    shortlistedCount,
    requiredAmount,
    connectedSocketCount,
    dispatchStatus: refreshed?.dispatch?.status || 'unassigned',
  };
}
