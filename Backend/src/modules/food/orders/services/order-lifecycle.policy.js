/**
 * Central Food order lifecycle policy.
 * Used by cart, pricing, create, restaurant status, share, cancel, and complete.
 */

import { ValidationError } from '../../../../core/auth/errors.js';
import { haversineKm } from '../../../../core/location/haversine.util.js';

export const MAX_RESTAURANTS_PER_ORDER = 3;
export const MAX_DRIVERS_PER_ORDER = 2;

/**
 * Scheduled-order window.
 *
 * MIN_SCHEDULE_LEAD_MINUTES mirrors the activation job's own lookahead
 * (processScheduledOrderAlerts in order.service.js, server.js's 1-minute cron): that job
 * activates any scheduled order within this many minutes of its scheduledAt. Requiring at
 * least this much lead time at creation means a scheduled order spends a real amount of time
 * as "scheduled" before the pipeline picks it up — anything less and it would just activate on
 * the very next cron tick, which is functionally an instant order wearing a "scheduled" label.
 * Both sides import this one constant so they can never drift apart.
 */
export const MIN_SCHEDULE_LEAD_MINUTES = 30;
/** Don't let a cart's pricing/menu snapshot go stale against a slot a week+ out. */
export const MAX_SCHEDULE_LEAD_DAYS = 7;

/**
 * Canonical order-status adjacency map (the real state machine, not just monotonic rank).
 * `from → [allowed next]`. Terminal states have no outgoing edges. Used by `canOrderTransition`
 * to block bypassable jumps (e.g. ready_for_pickup → delivered, skipping pickup) that the older
 * rank-only `isStatusAdvance` let through. Note: `reached_pickup` / `reached_drop` are tracked on
 * `deliveryState`, not `orderStatus`, so they are not modelled here.
 */
export const ORDER_STATUS_TRANSITIONS = {
  scheduled: ['created', 'cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin'],
  created: [
    'confirmed', 'preparing', 'ready_for_pickup', 'picked_up',
    'rejected_by_restaurant', 'cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin',
  ],
  confirmed: [
    'preparing', 'ready_for_pickup', 'picked_up',
    'rejected_by_restaurant', 'cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin',
  ],
  preparing: ['ready_for_pickup', 'picked_up', 'cancelled_by_restaurant', 'cancelled_by_admin'],
  ready_for_pickup: ['picked_up', 'cancelled_by_restaurant', 'cancelled_by_admin'],
  picked_up: ['delivered', 'cancelled_by_admin'],
  delivered: [],
  rejected_by_restaurant: ['created', 'confirmed', 'cancelled_by_restaurant', 'cancelled_by_admin'],
  cancelled_by_user: [],
  cancelled_by_restaurant: [],
  cancelled_by_admin: [],
};

/** True if `to` is a valid successor of `from` per ORDER_STATUS_TRANSITIONS. */
export function canOrderTransition(from, to) {
  if (!from) return true; // start of flow
  if (from === to) return false; // no self-loops (idempotency handled by callers)
  const allowed = ORDER_STATUS_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function assertOrderTransition(from, to) {
  if (!canOrderTransition(from, to)) {
    throw new ValidationError(`Illegal order transition: '${from}' → '${to}'.`);
  }
}

/** Pickup statuses that still participate in the active multi-restaurant trip */
const ACTIVE_PICKUP_STATUSES = new Set([
  'pending',
  'accepted',
  'preparing',
  'ready',
  'picked_up',
]);

const ACCEPTED_OR_LATER_PICKUP = new Set([
  'accepted',
  'preparing',
  'ready',
  'picked_up',
]);

const TERMINAL_ORDER_STATUSES = new Set([
  'delivered',
  'cancelled_by_user',
  'cancelled_by_restaurant',
  'cancelled_by_admin',
]);

export function countUniqueRestaurantIds(items = []) {
  const ids = new Set();
  for (const item of items || []) {
    const rid = String(item?.restaurantId || '').trim();
    if (rid) ids.add(rid);
  }
  return ids.size;
}

export function assertMaxRestaurants(items = []) {
  const count = countUniqueRestaurantIds(items);
  if (count > MAX_RESTAURANTS_PER_ORDER) {
    throw new ValidationError(
      `You can order from a maximum of ${MAX_RESTAURANTS_PER_ORDER} restaurants at a time`,
    );
  }
  return count;
}

export function assertMultiOrderAllowed(settings, restaurantCount) {
  if (restaurantCount <= 1) return;
  if (settings && settings.multiOrderEnabled === false) {
    throw new ValidationError('Multi-restaurant orders are currently disabled');
  }
}

/**
 * Validates an explicit `scheduledAt` the client sent with a new order.
 *
 * Previously the only check anywhere was `dto.scheduledAt && new Date(dto.scheduledAt) >
 * new Date()`, used purely to DECIDE whether to treat the order as scheduled - a past or
 * malformed value silently fell back to an instant order instead of being rejected, so a
 * customer who explicitly picked "tomorrow 7pm" could end up with an order placed (and
 * dispatched) as if they had asked for ASAP, with no error telling them why.
 *
 * This throws instead, enforces a sane lead-time window (see MIN/MAX constants above), and
 * returns the parsed Date so callers do not have to re-parse `dto.scheduledAt` later -
 * `scheduled: ['created', ...]` only ever moves to `created` for a value that passed here.
 *
 * @param {string|Date|null|undefined} scheduledAt
 * @param {Date} [now]
 * @returns {Date|null} parsed scheduled time, or null when none was given (ordinary instant order)
 * @throws {ValidationError}
 */
export function assertValidScheduledAt(scheduledAt, now = new Date()) {
  if (scheduledAt === undefined || scheduledAt === null || scheduledAt === '') {
    return null;
  }

  const parsed = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError('Scheduled time is invalid');
  }

  const minAllowed = new Date(now.getTime() + MIN_SCHEDULE_LEAD_MINUTES * 60 * 1000);
  if (parsed < minAllowed) {
    throw new ValidationError(
      `Scheduled time must be at least ${MIN_SCHEDULE_LEAD_MINUTES} minutes from now`,
    );
  }

  const maxAllowed = new Date(now.getTime() + MAX_SCHEDULE_LEAD_DAYS * 24 * 60 * 60 * 1000);
  if (parsed > maxAllowed) {
    throw new ValidationError(
      `Scheduled time cannot be more than ${MAX_SCHEDULE_LEAD_DAYS} days from now`,
    );
  }

  return parsed;
}

export function isActivePickup(pickup) {
  if (!pickup) return false;
  if (pickup.permanentlyDropped) return false;
  const status = String(pickup.status || '');
  if (status === 'cancelled') return false;
  return ACTIVE_PICKUP_STATUSES.has(status);
}

export function getActivePickups(order) {
  const pickups = Array.isArray(order?.pickups) ? order.pickups : [];
  return pickups.filter(isActivePickup);
}

/** Fallback kitchen prep when a menu item carries no preparationTime. */
export const DEFAULT_PREP_MINUTES = 15;
/** Assumed average road speed used to convert trip distance into ETA minutes. */
export const AVG_SPEED_KMPH = 20;

/** Parse a menu preparationTime ("15 mins" | "15" | 15 | null) into minutes; 0 when unknown. */
export function parsePrepMinutes(value) {
  if (value == null) return 0;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  }
  const match = String(value).match(/(\d+)/);
  if (!match) return 0;
  const minutes = parseInt(match[1], 10);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

/** A kitchen is only as fast as its slowest item. */
export function computeRestaurantPrepMinutes(items = []) {
  let max = 0;
  for (const item of items || []) {
    const minutes = parsePrepMinutes(item?.preparationTime);
    if (minutes > max) max = minutes;
  }
  return max > 0 ? max : DEFAULT_PREP_MINUTES;
}

/** Kitchens cook in parallel, so combined readiness = the slowest remaining kitchen. */
export function computeCombinedPrepMinutes(order) {
  const active = getActivePickups(order);
  if (active.length === 0) return DEFAULT_PREP_MINUTES;
  const max = active.reduce((acc, p) => Math.max(acc, Number(p.prepMinutes) || 0), 0);
  return max > 0 ? max : DEFAULT_PREP_MINUTES;
}

/** Combined ETA (minutes) = slowest kitchen + travel time over the whole trip. */
export function computeOrderEtaMinutes(order, distanceKm = 0) {
  const prep = computeCombinedPrepMinutes(order);
  const km = Math.max(0, Number(distanceKm) || 0);
  const travel = Math.round((km / AVG_SPEED_KMPH) * 60);
  return Math.max(1, prep + travel);
}

/**
 * Assign visit order: farthest-from-customer first, nearest-to-customer last, so the final leg
 * to the customer is the shortest. Deterministic and cheap — no routing API call.
 * `customerCoords` is GeoJSON order [lng, lat]. Mutates + returns the list.
 */
export function assignPickupSequence(pickups = [], customerCoords = null) {
  const list = Array.isArray(pickups) ? pickups : [];
  const cLng = Number(Array.isArray(customerCoords) ? customerCoords[0] : NaN);
  const cLat = Number(Array.isArray(customerCoords) ? customerCoords[1] : NaN);

  if (Number.isFinite(cLat) && Number.isFinite(cLng) && list.length > 1) {
    const distanceToCustomer = (pickup) => {
      const coords = pickup?.location?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) return 0;
      const lng = Number(coords[0]);
      const lat = Number(coords[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 0;
      return haversineKm(cLat, cLng, lat, lng);
    };
    list.sort((a, b) => distanceToCustomer(b) - distanceToCustomer(a));
  }

  list.forEach((pickup, index) => {
    pickup.sequence = index;
  });
  return list;
}

/**
 * The stop the driver should head to next.
 * Follows `sequence`, but if the next sequenced stop is not ready and another remaining stop
 * already is, send them to the ready one first so they never idle at a cold kitchen.
 */
export function getNextPickup(order) {
  const remaining = getActivePickups(order).filter(
    (p) => String(p.status || '') !== 'picked_up',
  );
  if (remaining.length === 0) return null;

  const bySequence = remaining
    .slice()
    .sort((a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0));

  const head = bySequence[0];
  if (String(head.status || '') === 'ready') return head;
  return bySequence.find((p) => String(p.status || '') === 'ready') || head;
}

/**
 * Customer/driver-facing multi-stop progress, e.g. "Picked up 1 of 2".
 *
 * For single-restaurant orders `orderStatus` is the source of truth: the write paths now mirror
 * it onto `pickups[0].status`, but legacy orders may still carry a stale 'pending' pickup. So
 * single orders are derived from `orderStatus`, otherwise they could look "waiting" forever.
 */
export function getPickupProgress(order) {
  const active = getActivePickups(order);
  const isMulti = Boolean(order?.isMultiRestaurant) && active.length > 1;

  if (!isMulti) {
    const status = String(order?.orderStatus || '');
    const collected = ['picked_up', 'reached_drop', 'delivered'].includes(status);
    return {
      picked: collected ? 1 : 0,
      total: 1,
      nextRestaurantId: '',
      nextRestaurantName: '',
      isWaitingForFood: !collected && status !== 'ready_for_pickup',
      label: '',
    };
  }

  const total = active.length;
  const picked = active.filter((p) => String(p.status || '') === 'picked_up').length;
  const next = getNextPickup(order);
  return {
    picked,
    total,
    nextRestaurantId: next ? String(next.restaurantId || '') : '',
    nextRestaurantName: next?.restaurantName || '',
    isWaitingForFood: Boolean(next && String(next.status || '') !== 'ready'),
    label: `Picked up ${picked} of ${total}`,
  };
}


/**
 * All remaining (active) restaurants have accepted (or progressed past accept).
 */
export function areAllActiveRestaurantsAccepted(order) {
  const active = getActivePickups(order);
  if (active.length === 0) {
    // Single-restaurant orders may have empty pickups[]
    if (!order?.isMultiRestaurant) {
      return ['confirmed', 'preparing', 'ready_for_pickup', 'reached_pickup', 'picked_up', 'reached_drop', 'delivered']
        .includes(String(order?.orderStatus || ''));
    }
    return false;
  }
  return active.every((p) => ACCEPTED_OR_LATER_PICKUP.has(String(p.status || '')));
}

export function isPrimaryDriverAccepted(order) {
  return (
    String(order?.dispatch?.status || '') === 'accepted' &&
    Boolean(order?.dispatch?.deliveryPartnerId)
  );
}

export function getTotalItemCount(orderOrItems) {
  const items = Array.isArray(orderOrItems?.items)
    ? orderOrItems.items
    : Array.isArray(orderOrItems)
      ? orderOrItems
      : [];
  return items.reduce((sum, it) => sum + (Number(it?.quantity) || 1), 0);
}

/**
 * Bulk / large cart: eligible for an optional second-driver search
 * ("Find new driver"). Does NOT mean a second driver is mandatory.
 */
export function isShareRequired(order, settings = {}) {
  const splitEnabled = settings?.splitOrderEnabled !== false;
  const threshold = Number(settings?.splitOrderThreshold ?? 20);
  if (!splitEnabled || !(threshold > 0)) return false;
  return getTotalItemCount(order) >= threshold;
}

export function isSharedDriverJoined(order) {
  return Boolean(order?.dispatch?.sharedPartnerId);
}

/**
 * Fully locked: all active restaurants accepted + primary driver accepted.
 * Second-driver share is optional and does not block the lock.
 * Not locked while any pickup is awaiting DP resend.
 */
export function isOrderFullyLocked(order, settings = {}) {
  const pickups = Array.isArray(order?.pickups) ? order.pickups : [];
  const awaitingResend = pickups.some(
    (p) =>
      !p.permanentlyDropped &&
      String(p.status || '') === 'cancelled',
  );
  if (awaitingResend) return false;

  if (!areAllActiveRestaurantsAccepted(order)) return false;
  if (!isPrimaryDriverAccepted(order)) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * Flow 3 — dual-leg delivery
 * Legs only exist once a second driver joins; single-driver orders keep
 * using `deliveryState` and never populate `legs`.
 * ------------------------------------------------------------------ */

/** Normalize any partner ref (ObjectId, populated doc, plain string) to an id string. */
export function toPartnerId(ref) {
  if (ref == null || ref === '') return '';
  if (typeof ref === 'object') {
    const nested = ref._id || ref.id || ref.partnerId;
    if (nested != null && typeof nested === 'object') {
      return String(nested._id || nested.id || nested);
    }
    return String(nested || '');
  }
  return String(ref);
}

export function isDualLegActive(order) {
  const hasLegs = Array.isArray(order?.legs) && order.legs.length > 1;
  if (Boolean(order?.isDualLeg) && hasLegs) return true;
  // Soft detect: second partner already assigned with legs persisted.
  if (order?.dispatch?.sharedPartnerId && hasLegs) return true;
  return false;
}

/**
 * When a shared partner is on the order but legs were never built (failed join, legacy row),
 * rebuild independent legs so OTP/status never collapse into the single-driver path.
 */
export function ensureDualLegs(order, otpFactory = () => '') {
  if (!order) return false;
  if (isDualLegActive(order)) return true;
  const primaryPartnerId = toPartnerId(order.dispatch?.deliveryPartnerId);
  const secondaryPartnerId = toPartnerId(order.dispatch?.sharedPartnerId);
  if (!primaryPartnerId || !secondaryPartnerId) return false;
  try {
    const { legs, splitMode } = buildDeliveryLegs(order, {
      primaryPartnerId,
      secondaryPartnerId,
      primaryEarning: order.riderEarning,
      secondaryEarning: order.sharedRiderEarning,
      otpFactory,
    });
    order.legs = legs;
    order.splitMode = splitMode;
    order.isDualLeg = true;
    if (typeof order.markModified === 'function') {
      order.markModified('legs');
    }
    return true;
  } catch {
    return false;
  }
}

/** Pending (unverified) per-leg handover OTPs for the customer/admin. */
export function getPendingLegHandoverOtps(order, { onlyAtDrop = false } = {}) {
  return (Array.isArray(order?.legs) ? order.legs : [])
    .filter((leg) => {
      if (leg?.otpVerified) return false;
      if (!String(leg?.otp || '').trim()) return false;
      if (onlyAtDrop && String(leg?.status || '') !== 'at_drop') return false;
      return true;
    })
    .map((leg) => ({
      legIndex: leg.legIndex,
      role: leg.role,
      partnerId: toPartnerId(leg.partnerId) || null,
      otp: String(leg.otp).trim(),
      status: leg.status || null,
      otpVerified: false,
    }));
}

/** All per-leg OTPs (including verified) — admin monitoring. */
export function getAllLegHandoverOtps(order) {
  return (Array.isArray(order?.legs) ? order.legs : [])
    .filter((leg) => String(leg?.otp || '').trim())
    .map((leg) => ({
      legIndex: leg.legIndex,
      role: leg.role,
      partnerId: toPartnerId(leg.partnerId) || null,
      otp: String(leg.otp).trim(),
      status: leg.status || null,
      otpVerified: Boolean(leg.otpVerified),
    }));
}

/** Legs still in play (a cancelled leg no longer blocks parent completion). */
export function getActiveLegs(order) {
  const legs = Array.isArray(order?.legs) ? order.legs : [];
  return legs.filter((leg) => String(leg?.status || '') !== 'cancelled');
}

export function getLegForPartner(order, partnerId) {
  const pid = toPartnerId(partnerId);
  if (!pid) return null;
  const legs = Array.isArray(order?.legs) ? order.legs : [];
  return legs.find((leg) => toPartnerId(leg?.partnerId) === pid) || null;
}

/** Parent order may only be DELIVERED when every active leg is delivered. */
export function areAllLegsDelivered(order) {
  const active = getActiveLegs(order);
  if (active.length === 0) return false;
  return active.every((leg) => String(leg?.status || '') === 'delivered');
}

/**
 * The next stop for a specific leg. Under a stop-level split each driver only sees the
 * restaurants assigned to their own leg; item-level splits share the same single restaurant.
 * Falls back to the order-wide next stop when the leg has no restaurant assignment.
 */
export function getNextPickupForLeg(order, leg) {
  if (!leg) return getNextPickup(order);
  const allowed = new Set((leg.restaurantIds || []).map((id) => String(id)));
  if (allowed.size === 0) return getNextPickup(order);

  const remaining = getActivePickups(order).filter(
    (p) =>
      String(p.status || '') !== 'picked_up' &&
      allowed.has(String(p.restaurantId || '')),
  );
  if (remaining.length === 0) return null;

  const bySequence = remaining
    .slice()
    .sort((a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0));
  const head = bySequence[0];
  if (String(head.status || '') === 'ready') return head;
  return bySequence.find((p) => String(p.status || '') === 'ready') || head;
}

/** Progress summary for customer-facing two-driver tracking. */
export function getLegProgress(order) {
  const active = getActiveLegs(order);
  return {
    isDualLeg: isDualLegActive(order),
    total: active.length,
    delivered: active.filter((l) => String(l?.status || '') === 'delivered').length,
    legs: active.map((leg) => ({
      legIndex: leg.legIndex,
      role: leg.role,
      partnerId: toPartnerId(leg.partnerId),
      status: leg.status,
      otpVerified: Boolean(leg.otpVerified),
      restaurantIds: (leg.restaurantIds || []).map(String),
    })),
  };
}

/**
 * Divide the order between two drivers.
 *
 * - 2+ active restaurants → **stop-level** split: whole restaurants are balanced across the
 *   legs by item count, so each driver owns their own pickups.
 * - single restaurant → **item-level** split: units are balanced across the legs, splitting a
 *   line when needed (a single line of qty 20 still halves correctly).
 *
 * Returns `{ legs, splitMode }`; the caller persists them onto the order.
 */
export function buildDeliveryLegs(order, {
  primaryPartnerId = null,
  secondaryPartnerId = null,
  primaryEarning = 0,
  secondaryEarning = 0,
  otpFactory = () => '',
} = {}) {
  const now = new Date();
  const makeLeg = (legIndex, role, partnerId, earning) => {
    const code = typeof otpFactory === 'function' ? String(otpFactory() || '').trim() : '';
    return {
      legIndex,
      role,
      partnerId: toPartnerId(partnerId) || null,
      status: 'assigned',
      restaurantIds: [],
      itemSplits: [],
      // Each leg gets its own OTP — never reuse a single order-level code across drivers.
      otp: code || String(Math.floor(1000 + Math.random() * 9000)),
      otpVerified: false,
      earning: Math.max(0, Number(earning) || 0),
      assignedAt: now,
    };
  };

  const legs = [
    makeLeg(0, 'primary', primaryPartnerId, primaryEarning),
    makeLeg(1, 'secondary', secondaryPartnerId, secondaryEarning),
  ];

  const activePickups = getActivePickups(order);

  // Stop-level split across 2+ restaurants.
  if (activePickups.length >= 2) {
    const weighted = activePickups
      .map((p) => ({
        restaurantId: p.restaurantId,
        weight: Array.isArray(p.items) ? p.items.length : 0,
      }))
      .sort((a, b) => b.weight - a.weight);

    const load = [0, 0];
    for (const stop of weighted) {
      const target = load[0] <= load[1] ? 0 : 1;
      legs[target].restaurantIds.push(stop.restaurantId);
      load[target] += stop.weight;
    }
    return { legs, splitMode: 'stop' };
  }

  // Item-level split within a single restaurant (quantity-aware).
  const items = Array.isArray(order?.items) ? order.items : [];
  const totalQty = items.reduce((sum, it) => sum + (Number(it?.quantity) || 1), 0);
  const firstLegTarget = Math.ceil(totalQty / 2);
  let assigned = 0;

  items.forEach((item, itemIndex) => {
    const qty = Number(item?.quantity) || 1;
    if (assigned >= firstLegTarget) {
      legs[1].itemSplits.push({ itemIndex, quantity: qty });
      return;
    }
    const takeForFirst = Math.min(qty, firstLegTarget - assigned);
    if (takeForFirst > 0) {
      legs[0].itemSplits.push({ itemIndex, quantity: takeForFirst });
      assigned += takeForFirst;
    }
    const remainder = qty - takeForFirst;
    if (remainder > 0) {
      legs[1].itemSplits.push({ itemIndex, quantity: remainder });
    }
  });

  const singleRestaurantId = activePickups[0]?.restaurantId || order?.restaurantId || null;
  if (singleRestaurantId) {
    legs.forEach((leg) => {
      leg.restaurantIds = [singleRestaurantId];
    });
  }
  return { legs, splitMode: 'item' };
}

/**
 * Cancel permission matrix.
 * @param {'USER'|'RESTAURANT'|'DELIVERY_PARTNER'|'ADMIN'|'SYSTEM'} role
 */
export function canCancel({ role, order, settings = {} }) {
  const status = String(order?.orderStatus || '');
  if (TERMINAL_ORDER_STATUSES.has(status)) {
    return { allowed: false, reason: 'Order is already terminal' };
  }

  if (role === 'ADMIN' || role === 'SYSTEM') {
    return { allowed: true };
  }

  if (isOrderFullyLocked(order, settings)) {
    return {
      allowed: false,
      reason: 'Order is locked after restaurants and drivers accepted. Only admin can cancel.',
      code: 'ORDER_LOCKED_ADMIN_ONLY',
    };
  }

  if (role === 'USER') {
    if (['created', 'scheduled'].includes(status)) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'Order cannot be cancelled at this stage' };
  }

  if (role === 'RESTAURANT') {
    // Before full lock, restaurant may reject (handled via status update, not cancel)
    if (isOrderFullyLocked(order, settings)) {
      return {
        allowed: false,
        reason: 'Order is locked. Only admin can cancel.',
        code: 'ORDER_LOCKED_ADMIN_ONLY',
      };
    }
    return { allowed: true };
  }

  if (role === 'DELIVERY_PARTNER') {
    return { allowed: false, reason: 'Delivery partner cannot cancel the order' };
  }

  return { allowed: false, reason: 'Cancel not allowed' };
}

export function assertCanCancel(args) {
  const result = canCancel(args);
  if (!result.allowed) {
    throw new ValidationError(result.reason || 'Cancel not allowed');
  }
  return result;
}

export function assertCanShareSecondDriver(order) {
  if (order?.dispatch?.sharedPartnerId) {
    throw new ValidationError(`Maximum ${MAX_DRIVERS_PER_ORDER} drivers already assigned`);
  }
}

/**
 * Refund amount for a dropped restaurant: food + packaging + proportional tax on food.
 * Delivery fee and platform fee are kept unless the whole order is cancelled.
 */
export function computeDroppedRestaurantRefundAmount(order, restaurantId) {
  const rid = String(restaurantId || '');
  const groups = Array.isArray(order?.pricing?.restaurantGroups)
    ? order.pricing.restaurantGroups
    : [];
  const group = groups.find((g) => String(g?.restaurantId || '') === rid);

  let foodAmount = 0;
  let packagingFee = 0;

  if (group) {
    foodAmount = Number(group.subtotal) || 0;
    packagingFee = Number(group.packagingFee) || 0;
  } else {
    const items = (order?.items || []).filter(
      (it) => String(it?.restaurantId || '') === rid,
    );
    foodAmount = items.reduce(
      (sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 1),
      0,
    );
    const settlement = (order?.restaurantSettlement || []).find(
      (s) => String(s?.restaurantId || '') === rid,
    );
    packagingFee = Number(settlement?.packagingFee) || 0;
  }

  const foodSubtotal = Number(order?.pricing?.foodSubtotal ?? order?.pricing?.subtotal) || 0;
  const taxTotal = Number(order?.pricing?.tax) || 0;
  const taxShare =
    foodSubtotal > 0 && foodAmount > 0
      ? Math.round(taxTotal * (foodAmount / foodSubtotal))
      : 0;

  const amount = Math.max(0, Number((foodAmount + packagingFee + taxShare).toFixed(2)));
  return {
    amount,
    foodAmount,
    packagingFee,
    taxShare,
  };
}

/**
 * Append an immutable settlement snapshot onto the order document (in-memory).
 */
export function pushSettlementSnapshot(order, event, note = '') {
  if (!order) return null;
  if (!Array.isArray(order.settlementSnapshots)) order.settlementSnapshots = [];

  const breakdown = order.pricing?.deliveryFeeBreakdown || null;
  const activeCount = getActivePickups(order).length;
  const snap = {
    at: new Date(),
    event: String(event || 'create'),
    pricing: order.pricing
      ? {
          foodSubtotal: Number(order.pricing.foodSubtotal ?? order.pricing.subtotal) || 0,
          packagingFee: Number(order.pricing.packagingFee) || 0,
          deliveryFee: Number(order.pricing.deliveryFee) || 0,
          platformFee: Number(order.pricing.platformFee) || 0,
          tax: Number(order.pricing.tax) || 0,
          discount: Number(order.pricing.discount) || 0,
          deliveryDiscount: Number(order.pricing.deliveryDiscount) || 0,
          total: Number(order.pricing.total) || 0,
          restaurantGroups: order.pricing.restaurantGroups || [],
        }
      : null,
    riderEarning: Number(order.riderEarning) || 0,
    sharedRiderEarning: Number(order.sharedRiderEarning) || 0,
    platformProfit: Number(order.platformProfit) || 0,
    driverSettlement: order.driverSettlement || null,
    platformRevenue: order.platformRevenue || null,
    settlementBreakdown: order.settlementBreakdown || null,
    deliveryFeeBreakdown: breakdown,
    isMultiRestaurant: Boolean(order.isMultiRestaurant),
    isSplitOrder: Boolean(breakdown?.isSplitOrder),
    activePickupCount: activeCount,
    partialRefundAmount: (order.partialRefunds || []).reduce(
      (sum, r) => sum + (Number(r?.amount) || 0),
      0,
    ),
    note: note || '',
  };
  order.settlementSnapshots.push(snap);
  return snap;
}

/**
 * Rewrite settlement ledger for a cancelled order: full refund to customer,
 * zero payouts for restaurant, driver, and platform.
 */
export function applyCancellationSettlement(order, { cancelledBy = 'system', note = '' } = {}) {
  if (!order) return null;

  const total = Number(order.pricing?.total) || 0;
  const paymentMethod = String(order.payment?.method || 'cash').toLowerCase();
  const paymentStatus = String(order.payment?.status || 'cod_pending').toLowerCase();
  const refund = order.payment?.refund || {};
  const refundStatus = String(refund.status || '').toLowerCase();
  const isCod = paymentMethod === 'cash' || paymentMethod === 'cod';
  const wasPaid =
    paymentStatus === 'paid' ||
    paymentStatus === 'refunded' ||
    paymentMethod === 'wallet' ||
    paymentMethod === 'razorpay';
  const refundAmount =
    Number(refund.amount) ||
    (refundStatus === 'processed' || paymentStatus === 'refunded' ? total : 0);
  const refundDestination = refund.destination || null;

  const previousSb =
    order.settlementBreakdown && typeof order.settlementBreakdown === 'object'
      ? order.settlementBreakdown
      : {};
  const previousRestaurants = Array.isArray(previousSb.restaurants)
    ? previousSb.restaurants
    : Array.isArray(order.restaurantSettlement)
      ? order.restaurantSettlement.map((s) => ({
          restaurantId: s.restaurantId,
          restaurantName: s.restaurantName,
          foodAmount: s.foodAmount,
          packagingFee: s.packagingFee,
          commission: s.commission,
          speedShare: s.speedShare,
          couponDiscount: s.couponDiscount,
          payout: s.restaurantPayout,
        }))
      : [];

  const originalDriverPayout =
    Number(previousSb.driver?.payout) ||
    Number(order.riderEarning) ||
    0;
  const originalSharedPayout = Number(order.sharedRiderEarning) || 0;
  const originalPlatformProfit =
    Number(previousSb.platform?.netProfit) ||
    Number(order.platformProfit) ||
    0;

  order.riderEarning = 0;
  order.sharedRiderEarning = 0;
  order.platformProfit = 0;

  if (Array.isArray(order.restaurantSettlement)) {
    order.restaurantSettlement = order.restaurantSettlement.map((s) => ({
      ...(s?.toObject ? s.toObject() : s),
      restaurantPayout: 0,
    }));
  }

  const refundNote = (() => {
    if (refundAmount > 0 && refundDestination === 'wallet') {
      return `Full order amount ₹${refundAmount} credited to customer wallet`;
    }
    if (refundAmount > 0 && refundDestination === 'source') {
      return `Full order amount ₹${refundAmount} refunded to original payment method`;
    }
    if (refundAmount > 0) {
      return `Full order amount ₹${refundAmount} refunded to customer`;
    }
    if (isCod) return 'COD order — no online payment collected; nothing to refund';
    return 'No refund applicable for this cancellation';
  })();

  order.settlementBreakdown = {
    ...previousSb,
    status: 'cancelled',
    customer: {
      ...(previousSb.customer || {}),
      paid: total,
      refund: refundAmount,
      refundDestination,
      refundStatus: refund.status || (paymentStatus === 'refunded' ? 'processed' : 'none'),
      netCost: Math.max(0, total - refundAmount),
      note: refundNote,
    },
    restaurants: previousRestaurants.map((r) => ({
      ...r,
      originalPayout: Number(r.payout) || 0,
      payout: 0,
      note: 'Order cancelled — no restaurant payout',
    })),
    driver: {
      ...(previousSb.driver || {}),
      originalPayout: originalDriverPayout,
      originalSharedPayout,
      payout: 0,
      sharedPayout: 0,
      note: 'Order cancelled — no driver payout',
    },
    platform: {
      ...(previousSb.platform || {}),
      originalNetProfit: originalPlatformProfit,
      netProfit: 0,
      note: 'Order cancelled — platform retains no profit',
    },
    cancellation: {
      cancelledBy: String(cancelledBy || 'system'),
      reason: note || '',
      refundAmount,
      refundDestination,
      refundStatus: refund.status || (paymentStatus === 'refunded' ? 'processed' : 'none'),
      wasPaid,
      at: new Date(),
    },
    costBearers: [],
  };

  return order.settlementBreakdown;
}
