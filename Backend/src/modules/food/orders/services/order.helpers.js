import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import { logger } from '../../../../utils/logger.js';
import {
  sendNotificationToOwner,
  sendNotificationToOwners,
} from "../../../../core/notifications/firebase.service.js";
import { getIO, getBroadcaster, rooms } from '../../../../config/socket.js';
import { config } from '../../../../config/env.js';
import { addOrderJob } from '../../../../queues/producers/order.producer.js';
import { FoodOrderEvent } from '../models/foodOrderEvent.model.js';

/**
 * Record an order lifecycle milestone.
 *
 * Single chokepoint for every milestone: it (1) atomically allocates a per-order monotonic
 * `seq`, (2) appends the event to the durable outbox (food_order_events) with a unique
 * `eventId`, and (3) enqueues the BullMQ job (now carrying seq/eventId). The outbox is what
 * `/sync` replays so a reconnecting client can detect gaps and recover missed milestones.
 *
 * Fire-and-forget: callers do not await it. All failures are swallowed/logged so a milestone
 * record never blocks or breaks the primary state change (which has already been persisted).
 */
export async function enqueueOrderEvent(action, payload = {}) {
  let eventId = null;
  let seq = null;
  try {
    const rawOrderId = payload.orderMongoId || payload.orderId;
    if (rawOrderId && mongoose.Types.ObjectId.isValid(String(rawOrderId))) {
      eventId = randomUUID();
      // Atomically allocate the next per-order sequence, then append to the outbox.
      const updated = await mongoose
        .model('FoodOrder')
        .findByIdAndUpdate(rawOrderId, { $inc: { eventSeq: 1 } }, { new: true, select: 'eventSeq' })
        .lean();
      seq = updated?.eventSeq ?? null;
      if (seq != null) {
        await FoodOrderEvent.create({
          orderId: rawOrderId,
          seq,
          eventId,
          type: action,
          payload,
          at: new Date(),
        });
      }
    }
  } catch (err) {
    logger.warn(`Order event outbox append failed: ${action} - ${err?.message || err}`);
  }

  try {
    void addOrderJob({ action, eventId, seq, ...payload }).catch((err) => {
      logger.warn(`BullMQ enqueue order event failed: ${action} - ${err?.message || err}`);
    });
  } catch (err) {
    logger.warn(`BullMQ enqueue order event failed (sync): ${action} - ${err?.message || err}`);
  }
}

/** Max events returned per sync page. A rider offline for hours must not blow the frame limit. */
export const SYNC_PAGE_SIZE = 100;

/** Map a JWT role to the recipient kind used in the outbox. */
export function recipientKindForRole(role) {
  if (role === 'USER') return 'USER';
  if (role === 'RESTAURANT') return 'RESTAURANT';
  if (role === 'DELIVERY_PARTNER' || role === 'DRIVER') return 'DELIVERY_PARTNER';
  return null;
}

/**
 * Fetch the events addressed to one recipient after their cursor.
 *
 * This is what makes a poll unnecessary: it answers "what was sent to me while I was away?"
 * exactly, in one indexed query, instead of refetching the whole order list on a timer.
 *
 * Read-only and never throws — a sync failure must degrade to "no events", not break the
 * socket connection.
 *
 * @param {{kind:string, id:any}} recipient
 * @param {number} sinceCursor - client's last applied cursor (0 = everything retained)
 * @param {number} [limit]
 * @returns {Promise<{events:Array, nextCursor:number, hasMore:boolean}>}
 */
export async function readSyncBatch(recipient, sinceCursor = 0, limit = SYNC_PAGE_SIZE) {
  const empty = { events: [], nextCursor: Number(sinceCursor) || 0, hasMore: false };
  if (!config.syncCursorEnabled) return empty;

  try {
    const [rec] = normalizeRecipients([recipient]);
    if (!rec) return empty;

    const since = Number.isFinite(Number(sinceCursor)) ? Number(sinceCursor) : 0;
    const pageSize = Math.max(1, Math.min(Number(limit) || SYNC_PAGE_SIZE, SYNC_PAGE_SIZE));

    // limit+1 to detect a further page without a second count query.
    const rows = await FoodOrderEvent.find({
      cursor: { $gt: since },
      recipients: {
        $elemMatch: { kind: rec.kind, id: new mongoose.Types.ObjectId(String(rec.id)) },
      },
    })
      .sort({ cursor: 1 })
      .limit(pageSize + 1)
      .lean();

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const events = page.map((e) => ({
      cursor: e.cursor,
      eventId: e.eventId,
      type: e.type,
      at: e.at,
      payload: e.payload,
    }));

    return {
      events,
      nextCursor: events.length ? events[events.length - 1].cursor : since,
      hasMore,
    };
  } catch (err) {
    logger.warn(`readSyncBatch failed: ${err?.message || err}`);
    return empty;
  }
}

/**
 * Map a sync recipient to its Socket.IO room.
 * @param {{kind: string, id: any}} recipient
 * @returns {string|null}
 */
function roomForRecipient(recipient) {
  const id = recipient?.id;
  if (!id) return null;
  switch (recipient.kind) {
    case 'USER': return rooms.user(id);
    case 'RESTAURANT': return rooms.restaurant(id);
    case 'DELIVERY_PARTNER': return rooms.delivery(id);
    default: return null;
  }
}

const VALID_RECIPIENT_KINDS = new Set(['USER', 'RESTAURANT', 'DELIVERY_PARTNER']);

function normalizeRecipients(recipients = []) {
  const seen = new Set();
  const out = [];
  for (const r of Array.isArray(recipients) ? recipients : [recipients]) {
    if (!r || !VALID_RECIPIENT_KINDS.has(r.kind) || !r.id) continue;
    const key = `${r.kind}:${String(r.id)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: r.kind, id: r.id });
  }
  return out;
}

/**
 * Single chokepoint for emitting a realtime event to a known set of recipients.
 *
 * Order matters: the durable record is written BEFORE the live emit. If the process dies after
 * the write, the client's next sync finds the event; if it dies before, the event never
 * logically happened. The reverse order — which is what the ~85 scattered `io.to().emit()`
 * calls do today — can emit an event that no recovery path will ever replay.
 *
 * Gated on `config.syncCursorEnabled`. With the flag OFF this is behaviourally identical to a
 * direct `io.to(room).emit(type, payload)`: no extra writes, no payload change.
 *
 * Failures in the durable path are logged and swallowed — an outbox problem must never stop a
 * live event reaching a connected client.
 *
 * @param {string} type - event name, e.g. 'new_order'
 * @param {object} basePayload - payload stored in the outbox
 * @param {Array<{kind:'USER'|'RESTAURANT'|'DELIVERY_PARTNER', id:any}>} recipients
 * @param {object} [options]
 * @param {(r:object)=>object} [options.payloadFor] - per-recipient live payload override
 * @param {string|object} [options.orderMongoId] - defaults to basePayload.orderMongoId/orderId
 * @param {string[]} [options.alsoEmit] - extra event names to emit with the same payload
 * @returns {Promise<number|null>} allocated cursor, or null when disabled/unavailable
 */
export async function publish(type, basePayload = {}, recipients = [], options = {}) {
  const targets = normalizeRecipients(recipients);
  let cursor = null;

  if (config.syncCursorEnabled && targets.length > 0) {
    try {
      const rawOrderId =
        options.orderMongoId || basePayload.orderMongoId || basePayload.orderId;
      if (rawOrderId && mongoose.Types.ObjectId.isValid(String(rawOrderId))) {
        const [{ nextGlobalCursor }, { FoodOrderEvent: EventModel }] = await Promise.all([
          import('../models/foodCounter.model.js'),
          import('../models/foodOrderEvent.model.js'),
        ]);
        cursor = await nextGlobalCursor();
        const updated = await mongoose
          .model('FoodOrder')
          .findByIdAndUpdate(rawOrderId, { $inc: { eventSeq: 1 } }, { new: true, select: 'eventSeq' })
          .lean();
        await EventModel.create({
          orderId: rawOrderId,
          seq: updated?.eventSeq ?? 0,
          eventId: randomUUID(),
          type,
          payload: basePayload,
          at: new Date(),
          cursor,
          recipients: targets.map((r) => ({ kind: r.kind, id: r.id })),
        });
      }
    } catch (err) {
      // Never let an outbox failure suppress the live emit.
      logger.warn(`publish outbox append failed: ${type} - ${err?.message || err}`);
      cursor = null;
    }
  }

  // Broadcaster, not getIO(): in a BullMQ worker there is no Socket.IO server, so this falls
  // back to the Redis emitter. Without it every dispatch emit from the worker is dropped.
  const broadcaster = await getBroadcaster();
  const localIo = getIO(true);
  if (broadcaster) {
    const eventNames = [type, ...(Array.isArray(options.alsoEmit) ? options.alsoEmit : [])];
    const absent = [];
    for (const r of targets) {
      const room = roomForRecipient(r);
      if (!room) continue;

      // Gap telemetry, measured where the gap actually happens: an empty room means the live
      // emit reached nobody. This is the number that justifies (or retires) the order polls —
      // it needs no client change, unlike a cursor the client has to report.
      //
      // Only meaningful in a process that owns a Socket.IO server; the Redis emitter has no
      // view of room membership, so we skip rather than report a false gap.
      if (localIo && (localIo.sockets?.adapter?.rooms?.get(room)?.size || 0) === 0) {
        absent.push(`${r.kind}:${r.id}`);
      }

      const live = options.payloadFor ? options.payloadFor(r) : basePayload;
      // __cursor lets a client detect a gap against its own last-applied cursor. Harmless to
      // clients that ignore it, and absent entirely while the flag is off.
      const framed = cursor == null ? live : { ...live, __cursor: cursor };
      for (const name of eventNames) broadcaster.to(room).emit(name, framed);
    }

    if (absent.length > 0) {
      logger.info(
        `[SyncGap] '${type}' emitted to ${absent.length}/${targets.length} disconnected recipient(s) ` +
        `[${absent.join(', ')}] — ${cursor == null
          ? 'NOT recoverable (SYNC_CURSOR_ENABLED is off)'
          : `recoverable at cursor ${cursor}`}`,
      );
    }
  }

  return cursor;
}

// Canonical implementation lives in core/location/haversine.util.js.
// Import for local use, then re-export for existing importers.
import { haversineKm } from '../../../../core/location/haversine.util.js';
export { haversineKm };

/**
 * Total payout pool that can be split between two drivers.
 * Includes salary-reclaimed amounts so a per-order second driver still gets a fair share.
 */
export function resolveDualPayoutPool(order) {
  if (!order) return 0;
  const assigned =
    Math.max(0, Number(order.riderEarning) || 0) +
    Math.max(0, Number(order.sharedRiderEarning) || 0);

  const reclaim = Math.max(
    0,
    Number(order.settlementBreakdown?.platform?.salaryReclaim || 0) || 0,
  );

  const costReclaim = (order.settlementBreakdown?.costBearers || []).find(
    (c) => String(c?.type || '') === 'salary_reclaim',
  );
  const costReclaimAmt =
    costReclaim && Number(costReclaim.amount) > 0 ? Number(costReclaim.amount) : 0;

  const breakdown = order.pricing?.deliveryFeeBreakdown || {};
  const fee = Math.max(
    0,
    Number(breakdown.riderFee ?? breakdown.deliveryBoyFee ?? 0) || 0,
  );

  // Use the largest known slab. A provisional 50/50 after salary-zeroing
  // (e.g. rider=0 + shared=15) must not shrink a ₹30 pool to ₹15.
  return Math.max(assigned, reclaim, costReclaimAmt, fee);
}

/**
 * Apply earnings by each partner's employment type (same rule as solo / without split):
 * - salary → ₹0 wallet; unpaid slab share → admin (salaryReclaim / platformProfit)
 * - per_order → slab share credited to wallet
 *
 * Pool is always the configured delivery-boy fee from pricing/slabs (never customer charge).
 * - both per_order → 50/50 of that fee
 * - mixed → full configured fee to the per-order partner; salary gets ₹0 (admin keeps unpaid share)
 * - both salary → both ₹0; full fee → admin
 */
export function applyEmploymentAwareDualEarnings(order, {
  primaryEmploymentType = 'per_order',
  secondaryEmploymentType = 'per_order',
} = {}) {
  if (!order?.dispatch?.sharedPartnerId) return order;

  const pool = resolveDualPayoutPool(order);
  const primarySalary = primaryEmploymentType === 'salary';
  const secondarySalary = secondaryEmploymentType === 'salary';

  const perOrderCount = (primarySalary ? 0 : 1) + (secondarySalary ? 0 : 1);
  let nextPrimary = 0;
  let nextShared = 0;

  if (perOrderCount === 2) {
    const half = Math.round(pool / 2);
    nextPrimary = Math.max(0, pool - half);
    nextShared = half;
  } else if (perOrderCount === 1) {
    // Same as solo for the earning partner: they get the full configured slab.
    if (!primarySalary) nextPrimary = pool;
    if (!secondarySalary) nextShared = pool;
  }
  // both salary → both ₹0; reclaim = full pool → admin

  const reclaim = Math.max(0, pool - (nextPrimary + nextShared));

  const prevAssigned =
    Math.max(0, Number(order.riderEarning) || 0) +
    Math.max(0, Number(order.sharedRiderEarning) || 0);
  const nextAssigned = nextPrimary + nextShared;
  const platformDelta = prevAssigned - nextAssigned;
  if (platformDelta !== 0) {
    order.platformProfit = Number(
      ((Number(order.platformProfit) || 0) + platformDelta).toFixed(2),
    );
  }

  order.riderEarning = nextPrimary;
  order.sharedRiderEarning = nextShared;

  const existingBreakdown =
    order.settlementBreakdown && typeof order.settlementBreakdown === 'object'
      ? order.settlementBreakdown
      : {};
  const nextCostBearers = [
    ...((existingBreakdown.costBearers || []).filter(
      (c) => String(c?.type || '') !== 'salary_reclaim',
    )),
    ...(reclaim > 0
      ? [
          {
            type: 'salary_reclaim',
            bearer: 'admin',
            amount: reclaim,
            note: 'Salary partner — delivery slab share retained by admin (no wallet credit)',
          },
        ]
      : []),
  ];
  order.settlementBreakdown = {
    ...existingBreakdown,
    driver: {
      ...(existingBreakdown.driver || {}),
      payout: nextPrimary,
      sharedPayout: nextShared,
      employmentType: primarySalary ? 'salary' : 'per_order',
      sharedEmploymentType: secondarySalary ? 'salary' : 'per_order',
      note: [
        primarySalary
          ? 'Primary on salary — ₹0 wallet (share retained by admin)'
          : `Primary per-order wallet ₹${nextPrimary}`,
        secondarySalary
          ? 'Shared on salary — ₹0 wallet (share retained by admin)'
          : `Shared per-order wallet ₹${nextShared}`,
        perOrderCount === 2
          ? 'Both per-order — 50/50 of configured slab'
          : perOrderCount === 1
            ? 'Mixed employment — full configured slab to per-order partner; salary ₹0'
            : `Both on salary — full configured slab ₹${reclaim} retained by admin`,
      ]
        .filter(Boolean)
        .join('; '),
    },
    platform: {
      ...(existingBreakdown.platform || {}),
      netProfit: Number(order.platformProfit) || 0,
      salaryReclaim: reclaim,
    },
    costBearers: nextCostBearers,
  };

  if (Array.isArray(order.legs) && order.legs.length) {
    for (const leg of order.legs) {
      const role = String(leg?.role || '');
      if (role === 'primary') leg.earning = nextPrimary;
      if (role === 'secondary' || role === 'shared') leg.earning = nextShared;
    }
    if (typeof order.markModified === 'function') order.markModified('legs');
  }
  if (typeof order.markModified === 'function') {
    order.markModified('settlementBreakdown');
  }
  return order;
}

/**
 * Single source of truth for what the driver is paid on an order.
 * NEVER use customer `pricing.deliveryFee` here — that is the customer charge
 * (userCharge + speed + multi), not the rider payout.
 *
 * Priority:
 * 1. Frozen `order.riderEarning` / `sharedRiderEarning` (includes salary = ₹0)
 * 2. `pricing.deliveryFeeBreakdown.riderFee`
 * 3. `settlementBreakdown.driver.payout`
 * 4. `pricing.deliveryFeeBreakdown.deliveryBoyFee`
 */
export function resolveRiderPayoutAmount(order, { partnerId } = {}) {
  if (!order) return 0;

  const partnerStr = partnerId != null ? String(partnerId) : '';
  const primaryId = String(
    order?.dispatch?.deliveryPartnerId?._id || order?.dispatch?.deliveryPartnerId || '',
  );
  const sharedId = String(
    order?.dispatch?.sharedPartnerId?._id || order?.dispatch?.sharedPartnerId || '',
  );

  if (partnerStr && sharedId && partnerStr === sharedId) {
    if (order.sharedRiderEarning !== undefined && order.sharedRiderEarning !== null) {
      return Math.max(0, Number(order.sharedRiderEarning) || 0);
    }
    return 0;
  }

  // Explicit frozen field — keep 0 for salary partners (do not fall through).
  if (order.riderEarning !== undefined && order.riderEarning !== null) {
    return Math.max(0, Number(order.riderEarning) || 0);
  }

  const breakdown = order?.pricing?.deliveryFeeBreakdown || {};
  const settlementPayout = order?.settlementBreakdown?.driver?.payout;
  const candidates = [
    breakdown.riderFee,
    settlementPayout,
    breakdown.deliveryBoyFee,
  ];
  for (const value of candidates) {
    if (value === undefined || value === null) continue;
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

/**
 * Mongo aggregation expression for primary-partner rider payout.
 * $ifNull skips only null/missing — explicit 0 (salary) is preserved.
 * Never falls back to pricing.deliveryFee.
 */
export const RIDER_PAYOUT_MONGO_EXPR = {
  $ifNull: [
    '$riderEarning',
    {
      $ifNull: [
        '$pricing.deliveryFeeBreakdown.riderFee',
        {
          $ifNull: [
            '$settlementBreakdown.driver.payout',
            { $ifNull: ['$pricing.deliveryFeeBreakdown.deliveryBoyFee', 0] },
          ],
        },
      ],
    },
  ],
};

/** Mongo expr: payout for a given partner (primary vs shared). */
export function riderPayoutForPartnerMongoExpr(partnerObjectId) {
  return {
    $cond: [
      { $eq: ['$dispatch.deliveryPartnerId', partnerObjectId] },
      RIDER_PAYOUT_MONGO_EXPR,
      {
        $cond: [
          { $eq: ['$dispatch.sharedPartnerId', partnerObjectId] },
          { $ifNull: ['$sharedRiderEarning', 0] },
          0,
        ],
      },
    ],
  };
}

export function resolveSlabAmounts(rule) {
  if (!rule) return { userCharge: 0, deliveryBoyFee: 0 };
  const legacyBase = Number(rule.basePayout);
  const hasLegacy = Number.isFinite(legacyBase) && legacyBase >= 0;

  // Prefer new fields; fall back to legacy basePayout when field is missing (undefined/null)
  const userCharge = Number(
    rule.userCharge ?? (hasLegacy ? legacyBase : 0),
  );
  const deliveryBoyFee = Number(
    rule.deliveryBoyFee ?? (hasLegacy ? legacyBase : 0),
  );

  return {
    userCharge: Number.isFinite(userCharge) && userCharge >= 0 ? userCharge : 0,
    deliveryBoyFee: Number.isFinite(deliveryBoyFee) && deliveryBoyFee >= 0 ? deliveryBoyFee : 0,
  };
}

/**
 * Match a fixed distance slab.
 * Inclusive min/max; if multiple slabs match a boundary (e.g. 2 km on 0–2 and 2–4),
 * the lower (first) slab wins.
 */
export function findMatchingDistanceSlab(distanceKm, rules = []) {
  const d = Math.max(0, Number(distanceKm) || 0);
  const list = Array.isArray(rules) ? rules.filter((r) => r && r.status !== false) : [];
  if (!list.length) return null;

  const sorted = [...list].sort(
    (a, b) => (Number(a.minDistance) || 0) - (Number(b.minDistance) || 0),
  );

  for (const rule of sorted) {
    const min = Number(rule.minDistance || 0);
    const max = rule.maxDistance == null ? null : Number(rule.maxDistance);
    if (d < min) continue;
    if (max != null && Number.isFinite(max) && d > max) continue;
    return rule;
  }

  // Beyond last closed slab → use last open-ended or last rule
  const last = sorted[sorted.length - 1];
  if (last && (last.maxDistance == null || last.maxDistance === undefined)) return last;
  return null;
}

/**
 * Fixed slab fee for the customer (userCharge of matching slab).
 * No per-km accumulation.
 */
export function calculateDistanceSlabFee(distanceKm, rules = []) {
  const matched = findMatchingDistanceSlab(distanceKm, rules);
  if (!matched) return 0;
  const { userCharge } = resolveSlabAmounts(matched);
  return Math.round(userCharge);
}

/** Fixed slab fee for the delivery partner (deliveryBoyFee of matching slab). */
export function calculateDistanceSlabRiderFee(distanceKm, rules = []) {
  const matched = findMatchingDistanceSlab(distanceKm, rules);
  if (!matched) return 0;
  const { deliveryBoyFee } = resolveSlabAmounts(matched);
  return Math.round(deliveryBoyFee);
}

/** Resolve both customer + rider fixed fees for a distance. */
export function resolveDistanceSlabQuote(distanceKm, rules = []) {
  const matched = findMatchingDistanceSlab(distanceKm, rules);
  if (!matched) {
    return {
      matched: null,
      userCharge: 0,
      deliveryBoyFee: 0,
    };
  }
  const amounts = resolveSlabAmounts(matched);
  return {
    matched,
    userCharge: Math.round(amounts.userCharge),
    deliveryBoyFee: Math.round(amounts.deliveryBoyFee),
  };
}

export function calculateRangeDeliveryFee(distanceKm, ranges = []) {
  const d = Number(distanceKm);
  if (!Number.isFinite(d) || d < 0) return null;
  const list = Array.isArray(ranges) ? [...ranges] : [];
  if (!list.length) return null;

  const sorted = list.sort((a, b) => Number(a.min) - Number(b.min));
  for (let i = 0; i < sorted.length; i += 1) {
    const range = sorted[i];
    const min = Number(range.min);
    const max = Number(range.max);
    const fee = Number(range.fee);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(fee)) continue;
    const isLastRange = i === sorted.length - 1;
    const inRange = isLastRange
      ? d >= min && d <= max
      : d >= min && d < max;
    if (inRange) return fee;
  }
  return null;
}

function getRestaurantLatLng(restaurant) {
  const coords = restaurant?.location?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Fee distance path: user → R1 → R2 → … → Rn (cart order).
 * Single restaurant: user → R1.
 */
function resolveOrderDistanceKmStraight(restaurants = [], userLoc) {
  if (!Array.isArray(restaurants) || restaurants.length === 0) return 0;
  if (!Array.isArray(userLoc) || userLoc.length < 2) return 0;

  const points = [{ lat: userLoc[1], lng: userLoc[0] }];
  for (const restaurant of restaurants) {
    const point = getRestaurantLatLng(restaurant);
    if (point) points.push(point);
  }
  if (points.length < 2) return 0;

  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    total += haversineKm(
      points[i].lat,
      points[i].lng,
      points[i + 1].lat,
      points[i + 1].lng,
    );
  }
  return total;
}

/** Sync fallback (haversine). Prefer resolveOrderDistanceKmAsync for road distance. */
export function resolveOrderDistanceKm(restaurants = [], userLoc) {
  return resolveOrderDistanceKmStraight(restaurants, userLoc);
}

/**
 * Order delivery distance in km (road preferred).
 * Path: user → R1 → R2 → … → Rn.
 */
export async function resolveOrderDistanceKmAsync(restaurants = [], userLoc) {
  const straight = resolveOrderDistanceKmStraight(restaurants, userLoc);
  if (!Array.isArray(restaurants) || restaurants.length === 0) return 0;
  if (!Array.isArray(userLoc) || userLoc.length < 2) return 0;

  try {
    const { fetchRoadDistancesKm } = await import('../utils/googleMaps.js');
    const user = { lat: userLoc[1], lng: userLoc[0] };

    const points = [user];
    for (const restaurant of restaurants) {
      const point = getRestaurantLatLng(restaurant);
      if (point) points.push(point);
    }
    if (points.length < 2) return 0;

    let total = 0;
    for (let i = 0; i < points.length - 1; i += 1) {
      const [leg] = (await fetchRoadDistancesKm(points[i], [points[i + 1]])) || [];
      if (!Number.isFinite(leg)) {
        return Number.isFinite(straight) ? Number(straight.toFixed(2)) : 0;
      }
      total += leg;
    }
    return Number(total.toFixed(2));
  } catch {
    // fall through to straight-line
  }

  return Number.isFinite(straight) ? Number(straight.toFixed(2)) : 0;
}

export function applyDeliverySurcharges(baseFee, { isMultiRestaurant, isSplitOrder, deliveryBoySettings } = {}) {
  const base = Math.max(0, Number(baseFee) || 0);
  let surcharge = 0;
  let multiplier = 1;

  if (isMultiRestaurant) {
    surcharge += Math.max(0, Number(deliveryBoySettings?.multiOrderAdditionalCharge) || 0);
  }
  if (isSplitOrder) {
    surcharge += base;
    multiplier = 2;
  }

  return {
    baseFee: base,
    surcharge,
    multiplier: isSplitOrder ? multiplier : 1,
    fee: base + surcharge,
  };
}

export function resolveSpeedFeeModifier(deliveryBoySettings, deliverySpeedOptionId, deliveryOptionName) {
  const matched = resolveSpeedOption(
    deliveryBoySettings,
    deliverySpeedOptionId,
    deliveryOptionName,
  );
  return matched ? Number(matched.feeModifier) || 0 : 0;
}

/** Resolve the selected Cart Delivery Speed option document (enabled only). */
export function resolveSpeedOption(deliveryBoySettings, deliverySpeedOptionId, deliveryOptionName) {
  const options = Array.isArray(deliveryBoySettings?.deliverySpeedOptions)
    ? deliveryBoySettings.deliverySpeedOptions.filter((o) => o && o.isEnabled !== false)
    : [];
  if (!options.length) return null;

  const id = String(deliverySpeedOptionId || "").trim();
  if (id) {
    const byId = options.find((o) => String(o.id) === id);
    if (byId) return byId;
  }

  const name = String(deliveryOptionName || "").trim().toLowerCase();
  if (name) {
    const byName = options.find((o) => String(o.name || "").trim().toLowerCase() === name);
    if (byName) return byName;
  }

  return options.find((o) => o.isDefault) || options[0] || null;
}

/**
 * Split Cart Delivery Speed fee between admin and driver only (no restaurant).
 * - fee <= 0: no driver share; negative amount is borne entirely by admin
 * - fee > 0: driver gets configured driverShareAmount (clamped), admin gets remainder
 */
export function splitSpeedFeeShares(speedFeeModifier, { driverShareAmount } = {}) {
  const fee = Number(speedFeeModifier) || 0;
  if (!Number.isFinite(fee) || fee === 0) {
    return {
      feeModifier: 0,
      speedShareAdmin: 0,
      speedShareRestaurant: 0,
      speedShareDriver: 0,
      adminBearsNegative: false,
    };
  }
  if (fee < 0) {
    return {
      feeModifier: fee,
      speedShareAdmin: fee,
      speedShareRestaurant: 0,
      speedShareDriver: 0,
      adminBearsNegative: true,
    };
  }

  const configured = Number(driverShareAmount);
  const driverShare = Number.isFinite(configured)
    ? Math.min(fee, Math.max(0, configured))
    : 0;
  const speedShareDriver = Number(driverShare.toFixed(2));
  const speedShareAdmin = Number((fee - speedShareDriver).toFixed(2));

  return {
    feeModifier: fee,
    speedShareAdmin,
    speedShareRestaurant: 0,
    speedShareDriver,
    adminBearsNegative: false,
  };
}

/** Weight a total amount across restaurant groups by food subtotal (remainder on last). */
export function allocateByFoodSubtotal(totalAmount, restaurantGroups = []) {
  const groups = Array.isArray(restaurantGroups) ? restaurantGroups : [];
  const amount = Math.max(0, Number(totalAmount) || 0);
  if (!groups.length || amount === 0) {
    return groups.map((g) => ({
      restaurantId: g.restaurantId,
      amount: 0,
    }));
  }
  const foodTotal = groups.reduce((s, g) => s + (Number(g.subtotal) || 0), 0);
  if (foodTotal <= 0) {
    const each = Math.floor((amount * 100) / groups.length) / 100;
    return groups.map((g, idx) => ({
      restaurantId: g.restaurantId,
      amount:
        idx === groups.length - 1
          ? Number((amount - each * (groups.length - 1)).toFixed(2))
          : each,
    }));
  }
  let allocated = 0;
  return groups.map((g, idx) => {
    if (idx === groups.length - 1) {
      return {
        restaurantId: g.restaurantId,
        amount: Number((amount - allocated).toFixed(2)),
      };
    }
    const share = Number(
      (((Number(g.subtotal) || 0) / foodTotal) * amount).toFixed(2),
    );
    allocated += share;
    return { restaurantId: g.restaurantId, amount: share };
  });
}

export function generateFourDigitDeliveryOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function sanitizeOrderForExternal(orderDoc) {
  const o = orderDoc?.toObject ? orderDoc.toObject() : { ...(orderDoc || {}) };
  delete o.deliveryOtp;
  // Never leak per-leg handover OTPs — only the customer receives them (see
  // emitDeliveryDropOtpToUser / getDropOtpUser). Expose presence, not the code.
  if (Array.isArray(o.legs)) {
    o.legs = o.legs.map((leg) => {
      const { otp, ...rest } = leg || {};
      return { ...rest, hasOtp: Boolean(otp) };
    });
  }
  const dv = o.deliveryVerification;
  if (dv && dv.dropOtp != null) {
    const d = dv.dropOtp;
    o.deliveryVerification = {
      ...dv,
      dropOtp: {
        required: Boolean(d.required),
        verified: Boolean(d.verified),
      },
    };
  }
  o.orderMongoId = (o._id || orderDoc?._id || "").toString();
  // Ensure orderId field for UI always contains the pretty ID
  o.orderId = o.order_id || o.orderMongoId; 
  return o;
}

export function emitDeliveryDropOtpToUser(order, plainOtp, meta = {}) {
  try {
    const io = getIO();
    if (!io || !plainOtp || !order?.userId) return;
    io.to(rooms.user(order.userId)).emit("delivery_drop_otp", {
      orderMongoId: order._id?.toString?.(),
      orderId: order.order_id || order._id?.toString?.(),
      otp: plainOtp,
      legIndex: meta.legIndex ?? null,
      role: meta.role || null,
      partnerId: meta.partnerId ? String(meta.partnerId) : null,
      isDualLeg: Boolean(meta.isDualLeg),
      legOtps: Array.isArray(meta.legOtps) ? meta.legOtps : undefined,
      message: meta.isDualLeg
        ? "Share each OTP with the matching delivery partner at drop-off."
        : "Share this OTP with your delivery partner to hand over the order.",
    });
  } catch (e) {
    logger.warn(`emitDeliveryDropOtpToUser failed: ${e?.message || e}`);
  }
}

export async function notifyOwnersSafely(targets, payload) {
  try {
    await sendNotificationToOwners(targets, payload);
  } catch (error) {
    logger.warn(`FCM notification failed: ${error?.message || error}`);
  }
}

export async function notifyOwnerSafely(target, payload) {
  try {
    await sendNotificationToOwner({ ...target, payload });
  } catch (error) {
    logger.warn(`FCM notification failed: ${error?.message || error}`);
  }
}

export function buildOrderIdentityFilter(orderIdOrMongoId) {
  const raw = String(orderIdOrMongoId || "").trim();
  if (!raw) return null;
  if (mongoose.isValidObjectId(raw))
    return { _id: new mongoose.Types.ObjectId(raw) };
  
  // Search BOTH underscore and camelCase variants for robust lookup
  return { 
    $or: [
        { order_id: raw },
        { orderId: raw }
    ]
  };
}

export function toGeoPoint(lat, lng) {
  if (lat == null || lng == null) return undefined;
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return { type: "Point", coordinates: [b, a] };
}

export function pushStatusHistory(order, { byRole, byId, from, to, note = "" }) {
  order.statusHistory.push({
    at: new Date(),
    byRole,
    byId: byId || undefined,
    from,
    to,
    note,
  });
}

export const MAX_DISPATCH_ATTEMPTS = 10;

/**
 * Auto-cancel food orders with no accepted driver after this age.
 *
 * MUST stay well above the dispatch escalation ladder or orders die mid-search: tryAutoAssign
 * re-queues itself every 60s and only widens the radius from attempt 2 (15 → 25 → 40 → 60km),
 * switching to the phase-2 broadcast at attempt 3. At the previous 1 min this watchdog cancelled
 * the order before a single retry could run, so the ladder was unreachable. 8 min covers
 * attempts 1-7 — the full radius expansion plus two broadcast rounds.
 */
export const NO_DRIVER_AUTO_CANCEL_MS = 8 * 60 * 1000;

/**
 * How long a bulk order waits for a second (shared) delivery partner to join before the
 * primary partner is allowed to complete the delivery solo with the full earning restored.
 * Prevents a ≥threshold-item order from getting permanently stuck when no 2nd driver joins.
 */
export const SHARE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Driver-first escalation: once a rider has accepted but NO restaurant has accepted yet
 * (orderStatus still 'created'), re-notify the restaurant after RESEND, then auto-reject +
 * refund + release the driver after TIMEOUT. Prevents a driver from being stranded on an
 * order the restaurant silently ignores.
 */
export const RESTAURANT_ACK_RESEND_MS = 2 * 60 * 1000;
export const RESTAURANT_ACK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Server-side geofence for "reached pickup" / "reached drop". Fail-OPEN when the rider's
 * last known location is missing or staler than RIDER_LOCATION_STALE_MS (Mongo location can
 * lag the Redis hot path by ~30s), so legitimate riders are never blocked; only gross spoofing
 * (marking arrived from far away) is rejected. Radii are intentionally generous.
 */
export const PICKUP_GEOFENCE_METERS = 1000;
export const DROP_GEOFENCE_METERS = 1000;
export const RIDER_LOCATION_STALE_MS = 10 * 60 * 1000;

export function freeOrderDispatch(orderDoc) {
  if (!orderDoc) return;
  orderDoc.dispatch = orderDoc.dispatch || {};
  orderDoc.dispatch.status = 'cancelled';
  orderDoc.dispatch.deliveryPartnerId = null;
  orderDoc.dispatch.sharedPartnerId = null;
  orderDoc.dispatch.acceptedAt = undefined;
  orderDoc.dispatch.assignedAt = undefined;
}

export function computeRiderToRestaurantDistanceKm(orderDoc) {
  const order = orderDoc?.toObject ? orderDoc.toObject() : orderDoc || {};
  const riderCoords = order?.lastRiderLocation?.coordinates;
  if (!Array.isArray(riderCoords) || riderCoords.length < 2) return null;

  const restaurantCoords =
    order?.restaurantId?.location?.coordinates ||
    order?.pickups?.[0]?.location?.coordinates ||
    null;
  if (!Array.isArray(restaurantCoords) || restaurantCoords.length < 2) return null;

  const [rLng, rLat] = riderCoords;
  const [restLng, restLat] = restaurantCoords;
  const km = haversineKm(rLat, rLng, restLat, restLng);
  return Number.isFinite(km) ? Number(km.toFixed(2)) : null;
}

export function normalizeOrderForClient(orderDoc) {
  const order = orderDoc?.toObject ? orderDoc.toObject() : orderDoc || {};
  const mongoId = (order._id || orderDoc?._id || "").toString();
  const displayId = order.order_id || mongoId;
  const phase = order?.deliveryState?.currentPhase;
  const prePickupPhases = new Set(['en_route_to_pickup', 'at_pickup']);
  const prePickupStatuses = new Set(['created', 'confirmed', 'preparing', 'ready_for_pickup', 'reached_pickup']);
  const showRiderToRestaurantDistance =
    prePickupPhases.has(phase) ||
    (prePickupStatuses.has(order?.orderStatus) && order?.dispatch?.status === 'accepted');

  return {
    ...order,
    orderMongoId: mongoId,
    orderId: displayId,
    status: order?.orderStatus || order?.status || "",
    deliveredAt:
      order?.deliveryState?.deliveredAt || order?.deliveredAt || null,
    deliveryPartnerId:
      order?.dispatch?.deliveryPartnerId || order?.deliveryPartnerId || null,
    rating: order?.ratings?.restaurant?.rating ?? order?.rating ?? null,
    restaurantNote: order?.restaurantNote || "",
    cancellationReason: (order?.orderStatus?.includes('cancel') || order?.status?.includes('cancel')) 
      ? (order.statusHistory?.findLast(h => h.to?.includes('cancel'))?.note || "")
      : null,
    failureReason: (() => {
      const cancelNote = String(
        order.statusHistory?.findLast((h) => h.to?.includes('cancel'))?.note || '',
      ).toLowerCase();
      if (cancelNote.includes('no delivery partner')) return 'driver_not_found';
      if (
        cancelNote.includes('rejected the order') ||
        cancelNote.includes('restaurant rejected') ||
        cancelNote.includes('did not respond')
      ) return 'restaurant_rejected';
      return null;
    })(),
    riderToRestaurantDistanceKm: showRiderToRestaurantDistance
      ? computeRiderToRestaurantDistanceKm(order)
      : null,
    deliveryState: {
      ...(order?.deliveryState || {}),
      currentLocation: order?.lastRiderLocation?.coordinates?.length >= 2 ? {
        lat: order.lastRiderLocation.coordinates[1],
        lng: order.lastRiderLocation.coordinates[0]
      } : (order?.deliveryState?.currentLocation || null)
    }
  };
}

function slimPublicPartner(partner) {
  if (!partner) return null;
  if (typeof partner !== 'object') return partner;
  return {
    _id: partner._id,
    name: partner.name || partner.fullName || '',
    fullName: partner.fullName || partner.name || '',
    phone: partner.phone || partner.phoneNumber || '',
    phoneNumber: partner.phoneNumber || partner.phone || '',
    // The partner model stores the photo as `profilePhoto`; keep the older
    // names as aliases so existing clients read it too.
    avatar: partner.avatar || partner.profileImage || partner.profilePhoto || null,
    profileImage: partner.profileImage || partner.avatar || partner.profilePhoto || null,
    rating: partner.rating,
    totalRatings: partner.totalRatings,
    // Shown to the customer on the tracking screen, like other delivery apps.
    vehicleType: partner.vehicleType || '',
    vehicleName: partner.vehicleName || '',
    vehicleNumber: partner.vehicleNumber || '',
  };
}

function slimPublicRestaurant(restaurant) {
  if (!restaurant) return null;
  if (typeof restaurant !== 'object') return restaurant;
  const location = restaurant.location || undefined;
  // Ensure map clients always get GeoJSON coordinates when only lat/lng exist.
  let normalizedLocation = location;
  if (location && (!Array.isArray(location.coordinates) || location.coordinates.length < 2)) {
    const lat = Number(location.latitude ?? location.lat);
    const lng = Number(location.longitude ?? location.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      normalizedLocation = {
        ...location,
        type: location.type || 'Point',
        coordinates: [lng, lat],
        latitude: lat,
        longitude: lng,
      };
    }
  }
  return {
    _id: restaurant._id,
    restaurantName: restaurant.restaurantName || restaurant.name || '',
    name: restaurant.name || restaurant.restaurantName || '',
    phone: restaurant.phone || restaurant.ownerPhone || restaurant.primaryContactNumber || '',
    ownerPhone: restaurant.ownerPhone || restaurant.phone || '',
    profileImage: restaurant.profileImage || restaurant.logo || null,
    logo: restaurant.logo || restaurant.profileImage || null,
    slug: restaurant.slug || restaurant.restaurantSlug || undefined,
    location: normalizedLocation,
  };
}

function normalizeGeoLocation(location) {
  if (!location || typeof location !== 'object') return location || null;
  if (Array.isArray(location.coordinates) && location.coordinates.length >= 2) {
    return {
      ...location,
      type: location.type || 'Point',
      coordinates: [Number(location.coordinates[0]), Number(location.coordinates[1])],
    };
  }
  const lat = Number(location.latitude ?? location.lat);
  const lng = Number(location.longitude ?? location.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return {
      ...location,
      type: location.type || 'Point',
      coordinates: [lng, lat],
      latitude: lat,
      longitude: lng,
    };
  }
  return location;
}

function resolveRestaurantCoordsForUser(order) {
  const fromRestaurant = normalizeGeoLocation(order?.restaurantId?.location);
  if (Array.isArray(fromRestaurant?.coordinates) && fromRestaurant.coordinates.length >= 2) {
    return fromRestaurant.coordinates;
  }
  const pickups = Array.isArray(order?.pickups) ? order.pickups : [];
  for (const pickup of pickups) {
    const loc = normalizeGeoLocation(pickup?.location);
    if (Array.isArray(loc?.coordinates) && loc.coordinates.length >= 2) {
      return loc.coordinates;
    }
  }
  return null;
}

function resolveCustomerCoordsForUser(order) {
  const addr = order?.deliveryAddress || order?.address || {};
  const fromLoc = normalizeGeoLocation(addr?.location);
  if (Array.isArray(fromLoc?.coordinates) && fromLoc.coordinates.length >= 2) {
    return fromLoc.coordinates;
  }
  if (Array.isArray(addr?.coordinates) && addr.coordinates.length >= 2) {
    return [Number(addr.coordinates[0]), Number(addr.coordinates[1])];
  }
  return null;
}

function slimCustomerPricing(pricing = {}) {
  return {
    subtotal: Number(pricing.subtotal) || 0,
    foodSubtotal: Number(pricing.foodSubtotal ?? pricing.subtotal) || 0,
    tax: Number(pricing.tax) || 0,
    packagingFee: Number(pricing.packagingFee) || 0,
    deliveryFee: Number(pricing.deliveryFee) || 0,
    platformFee: Number(pricing.platformFee) || 0,
    discount: Number(pricing.discount) || 0,
    deliveryDiscount: Number(pricing.deliveryDiscount) || 0,
    total: Number(pricing.total) || 0,
    currency: pricing.currency || 'INR',
    couponCode: pricing.couponCode || undefined,
    couponCategory: pricing.couponCategory || undefined,
  };
}

function resolveRestaurantAcceptedAt(order) {
  const trackingAt = order?.tracking?.confirmed?.timestamp || order?.tracking?.preparing?.timestamp;
  if (trackingAt) return trackingAt;
  const history = Array.isArray(order?.statusHistory) ? order.statusHistory : [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const to = String(history[i]?.to || '').toLowerCase();
    if (['confirmed', 'accepted', 'preparing'].includes(to)) {
      return history[i]?.at || null;
    }
  }
  return null;
}

/**
 * Lean customer-facing order payload for GET /food/orders/:id (and similar user views).
 * Strips settlements, earnings, commission internals, and raw statusHistory.
 */
export function toUserOrderResponse(orderDoc, extras = {}) {
  const base = normalizeOrderForClient(orderDoc);
  const order = orderDoc?.toObject ? orderDoc.toObject() : orderDoc || {};
  const restaurantAcceptedAt = resolveRestaurantAcceptedAt(order);

  const items = Array.isArray(order.items)
    ? order.items.map((item) => ({
        itemId: item.itemId || item._id || item.id,
        name: item.name,
        variantId: item.variantId,
        variantName: item.variantName,
        variantPrice: item.variantPrice ?? item.price,
        quantity: item.quantity,
        price: item.price,
        image: item.image || item.imageUrl,
        isVeg: item.isVeg,
        restaurantId: item.restaurantId,
      }))
    : [];

  const pickups = Array.isArray(order.pickups)
    ? order.pickups.map((p) => ({
        restaurantId: p.restaurantId,
        restaurantName: p.restaurantName,
        restaurantAddress: p.restaurantAddress,
        restaurantPhone: p.restaurantPhone,
        restaurantLogo: p.restaurantLogo,
        status: p.status,
        location: normalizeGeoLocation(p.location),
        items: p.items,
        sequence: p.sequence,
        readyAt: p.readyAt,
      }))
    : [];

  const dispatchPartner = slimPublicPartner(order.dispatch?.deliveryPartnerId);
  const sharedPartner = slimPublicPartner(order.dispatch?.sharedPartnerId);
  const slimRestaurant = slimPublicRestaurant(order.restaurantId);
  const restaurantCoords = resolveRestaurantCoordsForUser({
    ...order,
    restaurantId: slimRestaurant,
    pickups,
  });
  const customerCoords = resolveCustomerCoordsForUser(order);
  const deliveryAddressRaw = order.deliveryAddress || order.address || null;
  const deliveryAddress = deliveryAddressRaw
    ? {
        ...deliveryAddressRaw,
        location: normalizeGeoLocation(deliveryAddressRaw.location) || deliveryAddressRaw.location,
        coordinates:
          customerCoords ||
          deliveryAddressRaw.coordinates ||
          undefined,
      }
    : null;

  return {
    _id: base._id,
    orderMongoId: base.orderMongoId,
    orderId: base.orderId,
    order_id: order.order_id || base.orderId,
    orderStatus: order.orderStatus || base.status || '',
    status: base.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    scheduledAt: order.scheduledAt || null,
    cancelledAt: order.cancelledAt || undefined,
    deliveredAt: base.deliveredAt,
    note: order.note || '',
    restaurantNote: base.restaurantNote || '',
    sendCutlery: Boolean(order.sendCutlery),
    isMultiRestaurant: Boolean(order.isMultiRestaurant),
    deliveryOption: order.deliveryOption || null,
    deliveryTime: order.deliveryTime || null,
    estimatedTime: Number(order.estimatedTime) || null,
    estimatedDeliveryTime: Number(order.estimatedDeliveryTime || order.estimatedTime) || null,
    restaurantAcceptedAt,
    restaurantId: slimRestaurant,
    restaurantName:
      order.restaurantName ||
      slimRestaurant?.restaurantName ||
      slimRestaurant?.name ||
      '',
    restaurantPhone:
      order.restaurantPhone ||
      slimRestaurant?.phone ||
      slimRestaurant?.ownerPhone ||
      '',
    restaurantSlug: order.restaurantSlug || slimRestaurant?.slug || undefined,
    // Explicit map helpers so tracking UI does not depend on nested populate shape.
    restaurantLocation: restaurantCoords
      ? { type: 'Point', coordinates: restaurantCoords }
      : null,
    userId: order.userId
      ? {
          _id: order.userId._id,
          name: order.userId.name || order.userId.fullName || '',
          fullName: order.userId.fullName || order.userId.name || '',
          phone: order.userId.phone || '',
        }
      : undefined,
    customerName: order.customerName || '',
    customerPhone: order.customerPhone || '',
    deliveryAddress,
    // Alias used by some tracking transforms
    address: deliveryAddress,
    items,
    pickups,
    pricing: slimCustomerPricing(order.pricing),
    payment: {
      method: order.payment?.method || '',
      status: order.payment?.status || '',
      refund: order.payment?.refund
        ? { destination: order.payment.refund.destination, status: order.payment.refund.status }
        : undefined,
    },
    dispatch: {
      status: order.dispatch?.status || '',
      acceptedAt: order.dispatch?.acceptedAt || null,
      deliveryPartnerId: dispatchPartner,
      sharedPartnerId: sharedPartner,
    },
    deliveryPartnerId: dispatchPartner || base.deliveryPartnerId || null,
    deliveryState: {
      currentPhase: base.deliveryState?.currentPhase || null,
      status: base.deliveryState?.status || null,
      currentLocation: base.deliveryState?.currentLocation || null,
      deliveredAt: base.deliveryState?.deliveredAt || base.deliveredAt || null,
    },
    tracking: order.tracking
      ? {
          confirmed: order.tracking.confirmed || undefined,
          preparing: order.tracking.preparing || undefined,
          ready: order.tracking.ready || undefined,
          outForDelivery: order.tracking.outForDelivery || undefined,
          delivered: order.tracking.delivered || undefined,
        }
      : undefined,
    ratings: order.ratings || {},
    rating: base.rating,
    delayContext: order.delayContext?.reason
      ? { reason: order.delayContext.reason }
      : undefined,
    cancellationReason: base.cancellationReason,
    failureReason: base.failureReason,
    riderToRestaurantDistanceKm: base.riderToRestaurantDistanceKm,
    deliveryVerification: extras.deliveryVerification || {
      dropOtp: {
        required: Boolean(order.deliveryVerification?.dropOtp?.required),
        verified: Boolean(order.deliveryVerification?.dropOtp?.verified),
      },
    },
    handoverOtp: extras.handoverOtp || undefined,
    isDualLeg: extras.isDualLeg || undefined,
    legProgress: extras.legProgress || undefined,
    legHandoverOtps: extras.legHandoverOtps || undefined,
  };
}

/**
 * Amount the restaurant receives for this order:
 * food + packaging - commission - (restaurant-funded coupon discount when applicable).
 */
export function resolveRestaurantEarnings(order, restaurantId) {
  const rid = String(restaurantId || '').trim();
  const orderRestaurantId = String(
    order?.restaurantId?._id || order?.restaurantId || '',
  ).trim();
  const pricing = order?.pricing || {};
  const discount = Number(pricing.discount || 0) || 0;
  const isRestaurantCoupon = pricing.couponCreatedBy === 'restaurant';
  const settlements = Array.isArray(order?.restaurantSettlement)
    ? order.restaurantSettlement
    : [];
  const match = settlements.find(
    (s) => String(s?.restaurantId?._id || s?.restaurantId || '').trim() === rid,
  );

  let foodAmount = 0;
  let packagingFee = 0;
  let commission = 0;
  let speedShare = 0;
  let payout = null;

  if (match) {
    foodAmount = Number(match.foodAmount) || 0;
    packagingFee = Number(match.packagingFee) || 0;
    commission = Number(match.commission) || 0;
    speedShare = Number(match.speedShare) || 0;
    payout = Number(match.restaurantPayout);
    if (!Number.isFinite(payout)) {
      payout = Math.max(
        0,
        Number((foodAmount + packagingFee + speedShare - commission).toFixed(2)),
      );
    }
  } else {
    const items = Array.isArray(order?.items) ? order.items : [];
    foodAmount = items.reduce((sum, item) => {
      const itemRid = String(item?.restaurantId?._id || item?.restaurantId || '').trim();
      const belongs =
        itemRid ? itemRid === rid : orderRestaurantId === rid;
      if (!belongs) return sum;
      const price = Number(item?.price || 0);
      const qty = Number(item?.quantity || 1);
      return sum + (Number.isFinite(price) ? price : 0) * (Number.isFinite(qty) ? qty : 1);
    }, 0);
    if (!foodAmount && orderRestaurantId === rid) {
      foodAmount = Number(pricing.subtotal || 0) || 0;
    }
    packagingFee =
      orderRestaurantId === rid
        ? Number(pricing.packagingFee || pricing.restaurantPackagingTotal || 0) || 0
        : 0;
    commission =
      orderRestaurantId === rid
        ? Number(pricing.restaurantCommission || 0) || 0
        : 0;
    speedShare =
      orderRestaurantId === rid
        ? Number(pricing?.deliveryFeeBreakdown?.speedShareRestaurant || 0) || 0
        : 0;
    payout = Math.max(
      0,
      Number((foodAmount + packagingFee + speedShare - commission).toFixed(2)),
    );
  }

  // Restaurant-funded coupons reduce restaurant payout (matches FoodTransaction.restaurantShare).
  // Prefer settlement.couponDiscount when already applied at create.
  const settlementCouponDiscount = Number(match?.couponDiscount) || 0;
  const applyCouponDiscount =
    settlementCouponDiscount <= 0 &&
    isRestaurantCoupon &&
    discount > 0 &&
    (settlements.length <= 1 || rid === orderRestaurantId);
  const restaurantDiscount = settlementCouponDiscount > 0
    ? settlementCouponDiscount
    : (applyCouponDiscount ? discount : 0);
  if (restaurantDiscount > 0 && settlementCouponDiscount <= 0) {
    payout = Math.max(0, Number((payout - restaurantDiscount).toFixed(2)));
  }

  return {
    foodAmount: Number(foodAmount.toFixed(2)),
    packagingFee: Number(packagingFee.toFixed(2)),
    commission: Number(commission.toFixed(2)),
    speedShare: Number(speedShare.toFixed(2)),
    discount: Number(restaurantDiscount.toFixed(2)),
    payout: Number((Number.isFinite(payout) ? payout : 0).toFixed(2)),
  };
}

export function mapPickupStatusToRestaurantOrderStatus(pickupStatus, fallbackOrderStatus = 'created') {
  const pickup = String(pickupStatus || '').toLowerCase().trim();
  switch (pickup) {
    case 'pending':
      return 'created';
    case 'accepted':
      return 'confirmed';
    case 'preparing':
      return 'preparing';
    case 'ready':
    case 'ready_for_handover':
      return 'ready_for_pickup';
    case 'picked_up':
      return 'picked_up';
    case 'cancelled':
      return 'cancelled_by_restaurant';
    default:
      break;
  }
  const fallback = String(fallbackOrderStatus || 'created').toLowerCase().trim();
  return fallback || 'created';
}

/**
 * Reverse of mapPickupStatusToRestaurantOrderStatus: derive the pickup-level status implied by
 * the overall orderStatus. Used for single-restaurant orders, where the write path historically
 * only advanced `orderStatus` and left `pickups[0].status` at 'pending' forever.
 */
export function derivePickupStatusFromOrderStatus(orderStatus) {
  const v = String(orderStatus || '').toLowerCase().trim();
  if (v === 'confirmed') return 'accepted';
  if (v === 'preparing') return 'preparing';
  if (v === 'ready_for_pickup' || v === 'reached_pickup') return 'ready';
  if (['picked_up', 'reached_drop', 'delivered', 'completed'].includes(v)) return 'picked_up';
  if (v.includes('cancel') || v.includes('reject')) return 'cancelled';
  return 'pending'; // created / scheduled / unknown
}

export function buildRestaurantScopedOrder(orderDoc, restaurantId) {
  const order = orderDoc?.toObject ? orderDoc.toObject() : orderDoc || {};
  const rid = String(restaurantId || '').trim();
  if (!rid) return order;

  const orderRestaurantId = String(
    order?.restaurantId?._id || order?.restaurantId || '',
  ).trim();

  // Keep items that belong to this restaurant. If an item has no restaurantId
  // (legacy/single-restaurant orders), treat it as belonging to the order's restaurant.
  const filteredItems = Array.isArray(order.items)
    ? order.items.filter((item) => {
        const itemRid = String(item?.restaurantId?._id || item?.restaurantId || '').trim();
        if (itemRid) return itemRid === rid;
        return orderRestaurantId === rid;
      })
    : [];
  const filteredPickups = Array.isArray(order.pickups)
    ? order.pickups.filter(
        (pickup) => String(pickup?.restaurantId?._id || pickup?.restaurantId || '') === rid,
      )
    : [];

  const earnings = resolveRestaurantEarnings(
    { ...order, items: filteredItems },
    rid,
  );

  // Restaurant clients should only see what they earn — not customer bill fees.
  const restaurantPricing = {
    ...(order.pricing || {}),
    subtotal: earnings.foodAmount,
    packagingFee: earnings.packagingFee,
    restaurantCommission: earnings.commission,
    discount: earnings.discount,
    tax: 0,
    deliveryFee: 0,
    platformFee: 0,
    deliveryDiscount: 0,
    platformSubsidy: 0,
    total: earnings.payout,
  };

  // Multi-restaurant: each restaurant must see ITS pickup status, not aggregate orderStatus.
  // Otherwise after restaurant A accepts, restaurant B incorrectly sees "preparing/accepted".
  const ownPickup = filteredPickups[0] || null;
  const hasMultiPickups = Array.isArray(order.pickups) && order.pickups.length > 1;
  const isMultiRestaurant = Boolean(order.isMultiRestaurant) || hasMultiPickups;

  let scopedStatus;
  let myPickupStatus;
  if (isMultiRestaurant) {
    scopedStatus = mapPickupStatusToRestaurantOrderStatus(
      ownPickup?.status,
      // Before rider accept, restaurants shouldn't act; still show created/pending for this pickup
      ownPickup ? 'created' : (order?.orderStatus || order?.status || 'created'),
    );
    myPickupStatus = ownPickup?.status || null;
  } else {
    // Single-restaurant: `orderStatus` is the source of truth. The pickup row may be stale
    // ('pending' forever on legacy orders), so derive the pickup-level view from orderStatus
    // rather than the other way around. Otherwise an accepted order keeps looking like a new one.
    scopedStatus = order?.orderStatus || order?.status || 'created';
    myPickupStatus = derivePickupStatusFromOrderStatus(scopedStatus);
  }

  const responsePickups = !isMultiRestaurant
    ? filteredPickups.map((p) => ({ ...p, status: myPickupStatus }))
    : filteredPickups;

  const scoped = {
    ...order,
    items: filteredItems,
    pickups: responsePickups,
    restaurantId: rid,
    pricing: restaurantPricing,
    restaurantEarnings: earnings,
    restaurantPayout: earnings.payout,
    // Explicit client fields for restaurant live panel / accept popup
    status: scopedStatus,
    orderStatus: scopedStatus,
    // Keep aggregate for debugging / DP-aligned clients that need it
    aggregateOrderStatus: order?.orderStatus || order?.status || '',
    myPickupStatus,
  };

  if (filteredPickups.length === 1 && filteredPickups[0]?.restaurantName) {
    scoped.restaurantName = filteredPickups[0].restaurantName;
  }

  return scoped;
}

/**
 * Build restaurant-facing order timeline with date + time from statusHistory.
 */
export function buildRestaurantOrderTimeline(order = {}) {
  const formatTimestamp = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const findHistoryAt = (...statuses) => {
    const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    const wanted = statuses.map((s) => String(s).toLowerCase());
    const match = history.find((h) => wanted.includes(String(h?.to || '').toLowerCase()));
    return match?.at || null;
  };

  const statusLower = String(order.orderStatus || order.status || '').toLowerCase();
  const steps = [
    {
      key: 'placed',
      event: 'Order placed',
      at: order.createdAt,
      reached: true,
    },
    {
      key: 'confirmed',
      event: 'Order confirmed',
      at:
        findHistoryAt('confirmed', 'accepted') ||
        order.dispatch?.acceptedAt ||
        order.restaurantNotifiedAt,
      reached:
        Boolean(findHistoryAt('confirmed', 'accepted') || order.dispatch?.acceptedAt) ||
        ['confirmed', 'preparing', 'ready', 'ready_for_pickup', 'picked_up', 'out_for_delivery', 'delivered'].includes(statusLower),
    },
    {
      key: 'preparing',
      event: 'Preparing',
      at: findHistoryAt('preparing'),
      reached:
        Boolean(findHistoryAt('preparing')) ||
        ['preparing', 'ready', 'ready_for_pickup', 'picked_up', 'out_for_delivery', 'delivered'].includes(statusLower),
    },
    {
      key: 'ready',
      event: 'Ready for pickup',
      at: findHistoryAt('ready', 'ready_for_pickup'),
      reached:
        Boolean(findHistoryAt('ready', 'ready_for_pickup')) ||
        ['ready', 'ready_for_pickup', 'picked_up', 'out_for_delivery', 'delivered'].includes(statusLower),
    },
    {
      key: 'out_for_delivery',
      event: 'Out for delivery',
      at:
        findHistoryAt('picked_up', 'out_for_delivery') ||
        order.deliveryState?.pickedUpAt,
      reached:
        Boolean(findHistoryAt('picked_up', 'out_for_delivery') || order.deliveryState?.pickedUpAt) ||
        ['picked_up', 'out_for_delivery', 'delivered'].includes(statusLower),
    },
    {
      key: 'delivered',
      event: 'Delivered',
      at:
        findHistoryAt('delivered', 'completed') ||
        order.deliveryState?.deliveredAt ||
        order.deliveredAt,
      reached:
        Boolean(
          findHistoryAt('delivered', 'completed') ||
            order.deliveryState?.deliveredAt ||
            order.deliveredAt,
        ) || statusLower === 'delivered' || statusLower === 'completed',
    },
  ];

  const timeline = steps
    .filter((step) => step.reached)
    .map((step) => ({
      event: step.event,
      timestamp: formatTimestamp(step.at),
      at: step.at || null,
      status: 'completed',
    }));

  if (statusLower.includes('cancel') || statusLower.includes('reject')) {
    const cancelAt =
      findHistoryAt(
        'cancelled',
        'cancelled_by_user',
        'cancelled_by_restaurant',
        'cancelled_by_admin',
        'rejected',
        'rejected_by_restaurant',
      ) || order.cancelledAt;
    timeline.push({
      event: statusLower.includes('reject') ? 'Rejected' : 'Cancelled',
      timestamp: formatTimestamp(cancelAt),
      at: cancelAt || null,
      status: 'rejected',
      reason: order.cancellationReason || '',
    });
  }

  return timeline;
}

/**
 * Lean restaurant-facing order payload.
 * Excludes customer bill internals, payment gateway secrets, OTPs, and other unused fields.
 */
export function toRestaurantOrderResponse(orderDoc) {
  const order = orderDoc?.toObject ? orderDoc.toObject() : { ...(orderDoc || {}) };
  const mongoId = (order._id || order.orderMongoId || '').toString();
  const displayId = order.order_id || order.orderId || mongoId;
  const addr = order.deliveryAddress || order.address || {};
  const user = order.userId && typeof order.userId === 'object' ? order.userId : null;
  const partnerRaw = order.dispatch?.deliveryPartnerId;
  const partner =
    partnerRaw && typeof partnerRaw === 'object' ? partnerRaw : null;
  const partnerId = partner
    ? String(partner._id || partner.id || '')
    : partnerRaw
      ? String(partnerRaw)
      : null;

  const rid = String(
    order?.restaurantId?._id || order?.restaurantId || '',
  ).trim();
  const earnings =
    order.restaurantEarnings ||
    (rid ? resolveRestaurantEarnings(order, rid) : null) || {
      foodAmount: Number(order.pricing?.subtotal || 0) || 0,
      packagingFee: Number(order.pricing?.packagingFee || 0) || 0,
      commission: Number(order.pricing?.restaurantCommission || 0) || 0,
      discount: Number(order.pricing?.discount || 0) || 0,
      payout: Number(order.restaurantPayout ?? order.pricing?.total ?? 0) || 0,
    };

  const items = (Array.isArray(order.items) ? order.items : []).map((item) => ({
    name: item?.name || '',
    quantity: Number(item?.quantity || 1) || 1,
    price: Number(item?.price || 0) || 0,
    image: item?.image || undefined,
    isVeg: item?.isVeg ?? String(item?.foodType || '').toLowerCase() === 'veg',
    foodType: item?.foodType || undefined,
    addons: Array.isArray(item?.addons) ? item.addons : undefined,
    variant: item?.variant || undefined,
    specialInstructions: item?.specialInstructions || item?.note || undefined,
  }));

  const formattedAddress =
    addr.formattedAddress ||
    addr.address ||
    [addr.street, addr.additionalDetails, addr.city, addr.state, addr.zipCode || addr.pincode]
      .map((v) => String(v || '').trim())
      .filter(Boolean)
      .join(', ');

  const timeline = buildRestaurantOrderTimeline(order);

  return {
    _id: mongoId,
    orderMongoId: mongoId,
    orderId: displayId,
    order_id: displayId,
    orderStatus: order.orderStatus || order.status || '',
    status: order.orderStatus || order.status || '',
    aggregateOrderStatus: order.aggregateOrderStatus || undefined,
    myPickupStatus: order.myPickupStatus || order.pickups?.[0]?.status || null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    cancelledAt: order.cancelledAt || undefined,
    cancellationReason: order.cancellationReason || undefined,
    restaurantNote: order.restaurantNote || '',
    note: order.note || '',
    sendCutlery: Boolean(order.sendCutlery),
    scheduledAt: order.scheduledAt || undefined,
    deliveryFleet: order.deliveryFleet || undefined,
    estimatedDeliveryTime: order.estimatedDeliveryTime || undefined,
    restaurantNotifiedAt: order.restaurantNotifiedAt || order.dispatch?.acceptedAt || undefined,
    restaurantId: rid,
    restaurantName:
      order.restaurantName ||
      order.restaurantId?.restaurantName ||
      order.restaurant?.restaurantName ||
      '',
    customerName:
      order.customerName ||
      user?.name ||
      user?.fullName ||
      addr.fullName ||
      addr.name ||
      '',
    customerPhone:
      order.customerPhone || user?.phone || addr.phone || '',
    userId: user
      ? {
          name: user.name || user.fullName || '',
          phone: user.phone || '',
        }
      : undefined,
    deliveryAddress: {
      street: addr.street || '',
      additionalDetails: addr.additionalDetails || '',
      city: addr.city || '',
      state: addr.state || '',
      zipCode: addr.zipCode || addr.pincode || '',
      formattedAddress,
      name: addr.fullName || addr.name || '',
      phone: addr.phone || '',
    },
    items,
    restaurantEarnings: earnings,
    restaurantPayout: Number(order.restaurantPayout ?? earnings.payout) || 0,
    pricing: {
      subtotal: earnings.foodAmount,
      packagingFee: earnings.packagingFee,
      restaurantCommission: earnings.commission,
      discount: earnings.discount,
      total: earnings.payout,
      currency: order.pricing?.currency || 'INR',
    },
    payment: {
      method: order.payment?.method || '',
      status: order.payment?.status || '',
    },
    tracking: order.tracking
      ? {
          confirmed: order.tracking.confirmed || undefined,
          preparing: order.tracking.preparing || undefined,
          ready: order.tracking.ready || undefined,
          outForDelivery: order.tracking.outForDelivery || undefined,
          delivered: order.tracking.delivered || undefined,
        }
      : undefined,
    dispatch: {
      status: order.dispatch?.status || null,
      acceptedAt: order.dispatch?.acceptedAt || undefined,
      deliveryPartnerId: partner
        ? {
            _id: partnerId,
            name: partner.name || partner.fullName || '',
            phone: partner.phone || partner.phoneNumber || '',
          }
        : partnerId,
    },
    deliveryPartnerId: partnerId,
    timeline,
    pickups: Array.isArray(order.pickups)
      ? order.pickups.map((p) => ({
          restaurantId: String(p?.restaurantId?._id || p?.restaurantId || ''),
          restaurantName: p?.restaurantName || '',
          status: p?.status || '',
        }))
      : [],
  };
}

export async function applyAggregateRating(model, entityId, newRating) {
  if (!entityId) return;
  const doc = await model.findById(entityId).select("rating totalRatings");
  if (!doc) return;

  const totalRatings = Number(doc.totalRatings || 0);
  const currentAverage = Number(doc.rating || 0);
  const nextTotal = totalRatings + 1;
  const nextAverage = Number(
    ((currentAverage * totalRatings + Number(newRating)) / nextTotal).toFixed(1),
  );

  doc.totalRatings = nextTotal;
  doc.rating = nextAverage;
  await doc.save();
}

export function buildDeliverySocketPayload(orderDoc, restaurantDoc = null) {
  const order = orderDoc?.toObject ? orderDoc.toObject() : orderDoc || {};
  const restaurant = restaurantDoc || order?.restaurantId || null;
  const restaurantLocation = restaurant?.location || {};
  const deliveryAddress = order?.deliveryAddress || {};
  const customerAddressParts = [
    deliveryAddress.street,
    deliveryAddress.additionalDetails,
    deliveryAddress.city,
    deliveryAddress.state,
    deliveryAddress.zipCode,
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean);

  return {
    orderMongoId:
      orderDoc?._id?.toString?.() || order?._id?.toString?.() || order?._id,
    orderId: order?.order_id || order?._id?.toString?.(),
    status: orderDoc?.orderStatus || order?.orderStatus,
    items: order?.items || [],
    pricing: order?.pricing,
    total: order?.pricing?.total,
    payment: order?.payment,
    paymentMethod: order?.payment?.method,
    restaurantId:
      order?.restaurantId?._id?.toString?.() ||
      order?.restaurantId?.toString?.() ||
      order?.restaurantId,
    restaurantName: restaurant?.restaurantName || order?.restaurantName,
    restaurantAddress:
      restaurantLocation?.address ||
      restaurantLocation?.formattedAddress ||
      restaurant?.addressLine1 ||
      "",
    restaurantPhone: restaurant?.phone || "",
    restaurantLocation: {
      latitude: restaurantLocation?.latitude,
      longitude: restaurantLocation?.longitude,
      address:
        restaurantLocation?.address ||
        restaurantLocation?.formattedAddress ||
        restaurant?.addressLine1 ||
        "",
      area: restaurantLocation?.area || restaurant?.area || "",
      city: restaurantLocation?.city || restaurant?.city || "",
      state: restaurantLocation?.state || restaurant?.state || "",
    },
    deliveryAddress: order?.deliveryAddress,
    customerAddress: customerAddressParts.length ? customerAddressParts.join(', ') : "",
    customerName: order?.customerName || order?.deliveryAddress?.fullName || order?.deliveryAddress?.name || order?.userId?.name || "",
    customerPhone: order?.customerPhone || order?.deliveryAddress?.phone || order?.userId?.phone || "",
    userName: order?.customerName || order?.deliveryAddress?.fullName || order?.deliveryAddress?.name || order?.userId?.name || "",
    userPhone: order?.customerPhone || order?.deliveryAddress?.phone || order?.userId?.phone || "",
    note: order?.note || "",
    riderEarning: resolveRiderPayoutAmount(order),
    earnings: resolveRiderPayoutAmount(order),
    deliveryBoyFee: Number(
      order?.pricing?.deliveryFeeBreakdown?.deliveryBoyFee
      ?? order?.riderEarning
      ?? 0,
    ) || 0,
    deliveryFee: order?.pricing?.deliveryFee || 0,
    deliveryFeeBreakdown: order?.pricing?.deliveryFeeBreakdown || null,
    deliveryFleet: order?.deliveryFleet,
    dispatch: order?.dispatch,
    pickups: order?.pickups || [],
    zoneId: order?.zoneId?._id || order?.zoneId || "",
    zoneName: order?.zoneId?.name || order?.zoneId?.zoneName || order?.zoneName || "",
    createdAt: order?.createdAt,
    updatedAt: order?.updatedAt,
  };
}

/**
 * FCM `data` for a rider offer push, built from `buildDeliverySocketPayload`.
 * These are the fields the rider app's native offer card (and its Flutter
 * fallback) render — a push carrying only the order id shows a blank card.
 * FCM data values must be strings.
 */
export function buildOfferPushData(payload) {
  const p = payload || {};
  const loc = p.restaurantLocation || {};
  const str = (v) => (v === undefined || v === null ? '' : String(v));
  // Multi-restaurant offers: without these the card only names the first store.
  const stops = (Array.isArray(p.pickups) ? p.pickups : [])
    .filter((s) => !s?.permanentlyDropped && String(s?.status || '') !== 'cancelled')
    .map((s) => ({
      restaurantId: str(s.restaurantId?._id || s.restaurantId),
      restaurantName: str(s.restaurantName),
      address: str(s.location?.address || s.location?.formattedAddress),
      status: str(s.status),
      sequence: Number(s.sequence) || 0,
    }))
    .sort((a, b) => a.sequence - b.sequence);
  return {
    isMultiRestaurant: str(stops.length > 1),
    pickupNames: stops.map((s) => s.restaurantName).filter(Boolean).join(' + '),
    pickups: stops.length > 1 ? JSON.stringify(stops) : '',
    type: 'new_order',
    orderId: str(p.orderMongoId),
    orderMongoId: str(p.orderMongoId),
    orderDisplayId: p.orderId ? `#${p.orderId}` : '',
    restaurantName: str(p.restaurantName),
    restaurantAddress: str(p.restaurantAddress),
    restaurantPhone: str(p.restaurantPhone),
    restaurantLat: str(loc.latitude),
    restaurantLng: str(loc.longitude),
    customerName: str(p.customerName),
    customerAddress: str(p.customerAddress),
    riderEarning: str(p.riderEarning),
    paymentMethod: str(p.paymentMethod),
  };
}

export function canExposeOrderToRestaurant(orderLike) {
  const method = String(orderLike?.payment?.method || "").toLowerCase();
  const status = String(orderLike?.payment?.status || "").toLowerCase();
  if (["cash", "wallet"].includes(method)) return true;
  return ["paid", "authorized", "captured", "settled"].includes(status);
}

export async function notifyRestaurantNewOrder(orderDoc, restaurantIdOverride = null, options = {}) {
  try {
    if (!orderDoc || !canExposeOrderToRestaurant(orderDoc)) return;

    const targetRestaurantId = String(
      restaurantIdOverride ||
        orderDoc?.restaurantId?._id ||
        orderDoc?.restaurantId ||
        '',
    ).trim();
    if (!targetRestaurantId) return;

    const freshNotify = Boolean(options.freshNotify || options.resentToRestaurant);
    const notifiedAt = freshNotify
      ? new Date()
      : orderDoc.dispatch?.acceptedAt ||
        orderDoc.restaurantNotifiedAt ||
        new Date();

    if (freshNotify && typeof orderDoc?.markModified === 'function') {
      orderDoc.restaurantNotifiedAt = notifiedAt;
    }

    const scopedOrder = buildRestaurantScopedOrder(orderDoc, targetRestaurantId);
    const leanOrder = toRestaurantOrderResponse(scopedOrder);
    const scopedStatus = leanOrder.orderStatus || leanOrder.status || 'created';
    const payload = {
      ...leanOrder,
      orderMongoId: orderDoc._id?.toString?.() || leanOrder.orderMongoId,
      orderId: orderDoc.order_id || orderDoc._id?.toString?.() || leanOrder.orderId,
      // Always use THIS restaurant's pickup-scoped status (never aggregate)
      status: scopedStatus,
      orderStatus: scopedStatus,
      // Fresh timer on DP resend; otherwise rider-accept time for first notify
      restaurantNotifiedAt: notifiedAt,
      resentToRestaurant: freshNotify,
      dispatch: leanOrder.dispatch,
      isMultiRestaurant: Boolean(orderDoc.isMultiRestaurant),
      myPickupStatus: scopedOrder.myPickupStatus || null,
    };
    logger.info(
      `[RestaurantOrders] Emitting new_order to ${rooms.restaurant(targetRestaurantId)} for order ${orderDoc._id?.toString?.() || ''} status=${scopedStatus}${freshNotify ? ' (resent)' : ''}`,
    );
    // Durable-then-live: a restaurant that was disconnected when this fired currently has no
    // way to learn the order exists, which is exactly what the 10s order poll compensates for.
    await publish('new_order', payload, [{ kind: 'RESTAURANT', id: targetRestaurantId }], {
      orderMongoId: orderDoc._id,
    });

    await notifyOwnersSafely(
      [{ ownerType: "RESTAURANT", ownerId: targetRestaurantId }],
      {
        title: freshNotify ? "Order resent — please review" : "New order received",
        body: `Order #${orderDoc.order_id || orderDoc._id} is waiting for review.`,
        data: {
          type: freshNotify ? "order_resent_to_restaurant" : "new_order",
          orderId: orderDoc._id.toString(),
          orderMongoId: orderDoc._id?.toString?.() || "",
          link: `/restaurant/orders/${orderDoc._id?.toString?.() || ""}`,
          // Fields the restaurant app's native order card renders; without them
          // it shows a blank card. FCM data values must be strings.
          orderDisplayId: `#${payload.orderId || ""}`,
          customerName: String(leanOrder.customerName || ""),
          address: String(leanOrder.deliveryAddress?.formattedAddress || ""),
          itemCount: String((leanOrder.items || []).reduce((n, i) => n + (Number(i.quantity) || 1), 0)),
          itemsList: (leanOrder.items || []).map((i) => `${i.quantity || 1}× ${i.name}`).join(", ").slice(0, 300),
          total: String(leanOrder.pricing?.total ?? ""),
          paymentMethod: String(leanOrder.payment?.method || ""),
        },
      },
    );
  } catch {
    // Do not block order/payment flow if notification fails.
  }
}

export const STATUS_PRIORITY = {
  created: 10,
  confirmed: 20,
  preparing: 30,
  ready_for_pickup: 40,
  reached_pickup: 50,
  picked_up: 60,
  reached_drop: 70,
  delivered: 80,
  rejected_by_restaurant: 90,
  cancelled_by_user: 100,
  cancelled_by_restaurant: 100,
  cancelled_by_admin: 100,
};

/**
 * Returns true if the next status is a valid forward progression from the current status.
 * Prevents "reversing" order status (e.g. from Preparing back to Created).
 */
export function isStatusAdvance(current, next) {
  // If current status is missing, it's effectively 'created' or start of flow
  if (!current) return true;
  
  const currentPrio = STATUS_PRIORITY[current] || 0;
  const nextPrio = STATUS_PRIORITY[next] || 0;

  // Terminal states (100) cannot transition to anything else
  if (currentPrio >= 100) return false;
  
  // Specific bypass for Resend Flow: allowed to go from rejected_by_restaurant back to created/confirmed
  if (current === 'rejected_by_restaurant' && (next === 'created' || next === 'confirmed')) return true;
  // Specific bypass for Rejection Flow: allowed to go from confirmed/preparing to rejected_by_restaurant
  if ((current === 'confirmed' || current === 'preparing' || current === 'created') && next === 'rejected_by_restaurant') return true;

  // Delivered (80) cannot transition to anything (except maybe cancellation if allowed, but here we say no)
  if (currentPrio === 80) return false;

  // Special case: Cancellation is almost always an advance unless already delivered
  if (nextPrio === 100 && currentPrio < 80) return true;

  return nextPrio > currentPrio;
}
