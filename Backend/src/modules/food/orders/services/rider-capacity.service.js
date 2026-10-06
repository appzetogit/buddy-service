/**
 * Rider order capacity - how many live jobs one delivery partner may hold at the same time.
 *
 * A rider may stack up to `maxConcurrentOrders` (default 2) accepted orders and run them
 * together: accept order A, accept order B while A is still open, then deliver both. The
 * next order is withheld - no offer, no accept - until one of the held orders reaches a
 * terminal state (delivered or cancelled).
 *
 * The fleet is shared between Food and Quick Commerce, so the count spans BOTH collections.
 * A rider carrying one food order and one QC order is at the default limit and is skipped by
 * both dispatchers until one finishes. Counting only one vertical would let a rider quietly
 * hold 2 food + 2 QC jobs.
 *
 * Only *accepted* work counts. An order that is merely offered - or admin-assigned but not yet
 * accepted (`dispatch.status: 'assigned'` with no `acceptedAt`) - is a pending invitation, not
 * a held job, and must not consume a slot or the rider could never accept it.
 *
 * Enforced in two layers, and both are needed:
 *   - dispatch (`listNearbyOnlineDeliveryPartners`) so a full rider is never offered an order;
 *   - accept (food, food share-join, Quick Commerce) so a stale offer card, a replayed socket
 *     event or a direct API call cannot push a rider past the limit.
 *
 * Every read FAILS OPEN. If a capacity query throws, dispatch and accept behave exactly as they
 * did before this module existed: a bug here may never strand orders or lock riders out.
 */
import mongoose from 'mongoose';
import { FoodOrder } from '../models/order.model.js';
import { FoodDeliveryBoySettings } from '../../admin/models/deliveryBoySettings.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';

/** Orders a rider may hold at once when admin has not configured anything. */
export const DEFAULT_MAX_CONCURRENT_ORDERS = 2;
export const MIN_MAX_CONCURRENT_ORDERS = 1;
export const MAX_MAX_CONCURRENT_ORDERS = 5;

/** Food statuses where the rider still has work to do on an accepted order. */
export const ACTIVE_FOOD_ORDER_STATUSES = [
  'created',
  'confirmed',
  'preparing',
  'ready_for_pickup',
  'reached_pickup',
  'picked_up',
  'reached_drop',
];

/** Quick Commerce statuses where the rider still has work to do on an accepted order. */
export const ACTIVE_QUICK_ORDER_STATUSES = [
  'confirmed',
  'preparing',
  'ready_for_pickup',
  'picked_up',
];

export const CAPACITY_REACHED_MESSAGE =
  'You already have the maximum number of orders in hand. Deliver them to get new orders.';

const toObjectId = (value) => {
  const raw = String(value?._id || value || '');
  return mongoose.Types.ObjectId.isValid(raw) ? new mongoose.Types.ObjectId(raw) : null;
};

export const clampMaxConcurrentOrders = (value) => {
  // null / undefined / '' mean "not configured", NOT zero. Number(null) is 0, which would
  // otherwise clamp to 1 and silently switch order stacking off for the whole fleet.
  if (value === null || value === undefined || value === '') {
    return DEFAULT_MAX_CONCURRENT_ORDERS;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_MAX_CONCURRENT_ORDERS;
  return Math.min(
    MAX_MAX_CONCURRENT_ORDERS,
    Math.max(MIN_MAX_CONCURRENT_ORDERS, Math.trunc(numeric)),
  );
};

/**
 * Admin-configured stacking limit. Read live (no cache) so a change in the admin panel takes
 * effect on the very next dispatch instead of after a TTL nobody can see.
 */
export async function getMaxConcurrentOrders() {
  try {
    const settings = await FoodDeliveryBoySettings.findOne({ isActive: true })
      .select('maxConcurrentOrders')
      .sort({ createdAt: -1 })
      .lean();
    if (settings?.maxConcurrentOrders == null) return DEFAULT_MAX_CONCURRENT_ORDERS;
    return clampMaxConcurrentOrders(settings.maxConcurrentOrders);
  } catch (err) {
    logger.warn(`[RiderCapacity] settings read failed, using default: ${err?.message || err}`);
    return DEFAULT_MAX_CONCURRENT_ORDERS;
  }
}

/**
 * The Quick Commerce model is resolved from the mongoose registry rather than imported, so this
 * food-side module never takes a hard dependency on the QC module (which already imports from
 * food dispatch). If QC is not mounted, its jobs simply do not count.
 */
const getQuickOrderModel = () => mongoose.models?.QuickOrder || null;

/**
 * Live accepted-job count per rider, across Food and Quick Commerce.
 *
 * @param {Array} partnerIds
 * @param {{ excludeOrderId?: string|null }} options `excludeOrderId` leaves one order out of the
 *   tally - used when re-checking the very order the rider is accepting, so their own claim does
 *   not count against them.
 * @returns {Promise<Map<string, number>>} partnerId -> held order count (missing = 0)
 */
export async function getRiderActiveLoadMap(partnerIds = [], options = {}) {
  const ids = [...new Set((partnerIds || []).map((id) => String(id?._id || id || '')))]
    .map(toObjectId)
    .filter(Boolean);
  const loadByPartner = new Map();
  if (ids.length === 0) return loadByPartner;

  const excludeId = toObjectId(options.excludeOrderId);
  const bump = (partnerId) => {
    const key = String(partnerId);
    loadByPartner.set(key, (loadByPartner.get(key) || 0) + 1);
  };

  const QuickOrder = getQuickOrderModel();

  const foodFilter = {
    'dispatch.status': 'accepted',
    orderStatus: { $in: ACTIVE_FOOD_ORDER_STATUSES },
    $or: [
      { 'dispatch.deliveryPartnerId': { $in: ids } },
      { 'dispatch.sharedPartnerId': { $in: ids } },
    ],
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  };

  const quickFilter = {
    'dispatch.deliveryPartnerId': { $in: ids },
    'dispatch.acceptedAt': { $exists: true, $ne: null },
    orderStatus: { $in: ACTIVE_QUICK_ORDER_STATUSES },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  };

  const [foodRows, quickRows] = await Promise.all([
    FoodOrder.find(foodFilter)
      .select('dispatch.deliveryPartnerId dispatch.sharedPartnerId')
      .lean(),
    QuickOrder
      ? QuickOrder.find(quickFilter).select('dispatch.deliveryPartnerId').lean()
      : Promise.resolve([]),
  ]);

  const wanted = new Set(ids.map((id) => String(id)));

  for (const row of foodRows || []) {
    // A dual-leg order counts once per rider: the primary and the share partner each carry it.
    const primary = String(row?.dispatch?.deliveryPartnerId || '');
    const shared = String(row?.dispatch?.sharedPartnerId || '');
    if (primary && wanted.has(primary)) bump(primary);
    if (shared && shared !== primary && wanted.has(shared)) bump(shared);
  }

  for (const row of quickRows || []) {
    const primary = String(row?.dispatch?.deliveryPartnerId || '');
    if (primary && wanted.has(primary)) bump(primary);
  }

  return loadByPartner;
}

/**
 * Every job this rider currently holds, oldest acceptance first, across Food and Quick Commerce.
 *
 * Needed by the post-claim reconcile on both accept paths: the keep-set that decides which
 * simultaneous claims survive has to span the same collections the limit is counted over, or a
 * rider holding a QC job could still win two food claims and end up over the limit.
 *
 * The ordering is the tie-break, so it must be deterministic and identical for every racer:
 * acceptedAt, then order id.
 *
 * @returns {Promise<Array<{ id: string, kind: 'food'|'quick', acceptedAt: Date|null }>>}
 */
export async function listRiderHeldOrders(partnerId, options = {}) {
  const id = toObjectId(partnerId);
  if (!id) return [];

  const excludeId = toObjectId(options.excludeOrderId);
  const QuickOrder = getQuickOrderModel();

  const [foodRows, quickRows] = await Promise.all([
    FoodOrder.find({
      'dispatch.status': 'accepted',
      orderStatus: { $in: ACTIVE_FOOD_ORDER_STATUSES },
      $or: [{ 'dispatch.deliveryPartnerId': id }, { 'dispatch.sharedPartnerId': id }],
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    })
      .select('_id dispatch.acceptedAt')
      .lean(),
    QuickOrder
      ? QuickOrder.find({
        'dispatch.deliveryPartnerId': id,
        'dispatch.acceptedAt': { $exists: true, $ne: null },
        orderStatus: { $in: ACTIVE_QUICK_ORDER_STATUSES },
        ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      })
        .select('_id dispatch.acceptedAt')
        .lean()
      : Promise.resolve([]),
  ]);

  const rows = [
    ...(foodRows || []).map((r) => ({ id: String(r._id), kind: 'food', acceptedAt: r?.dispatch?.acceptedAt || null })),
    ...(quickRows || []).map((r) => ({ id: String(r._id), kind: 'quick', acceptedAt: r?.dispatch?.acceptedAt || null })),
  ];

  return rows.sort(byAcceptedAtThenId);
}

/**
 * Tie-break for which simultaneous claims survive: oldest acceptance first, then order id.
 *
 * Must be total and identical for every racer, or two accepts could each decide the OTHER one
 * survives and both release. An absent acceptedAt sorts LAST rather than first, so a row with
 * no timestamp can never evict a claim that carries a real one.
 */
export const byAcceptedAtThenId = (a, b) => {
  const at = a?.acceptedAt ? new Date(a.acceptedAt).getTime() : Number.MAX_SAFE_INTEGER;
  const bt = b?.acceptedAt ? new Date(b.acceptedAt).getTime() : Number.MAX_SAFE_INTEGER;
  const aValid = Number.isFinite(at) ? at : Number.MAX_SAFE_INTEGER;
  const bValid = Number.isFinite(bt) ? bt : Number.MAX_SAFE_INTEGER;
  if (aValid !== bValid) return aValid - bValid;
  const aId = String(a?.id || '');
  const bId = String(b?.id || '');
  return aId < bId ? -1 : aId > bId ? 1 : 0;
};

/**
 * Post-claim verdict shared by both accept paths.
 *
 * Two accepts can both clear the pre-accept check and both claim. Re-reading here - with both
 * claims visible - gives every racer the same picture, and the deterministic oldest-first
 * ordering means only the surplus claims are told to roll themselves back.
 *
 * Fails open: if the check itself throws, the claim stands.
 *
 * @returns {Promise<boolean>} true when this claim must be released.
 */
export async function claimExceedsStackingLimit(orderMongoId, partnerId) {
  try {
    const max = await getMaxConcurrentOrders();
    const held = await listRiderHeldOrders(partnerId);
    if (held.length <= max) return false;
    const keep = new Set(held.slice(0, max).map((row) => row.id));
    return !keep.has(String(orderMongoId));
  } catch (err) {
    logger.warn(
      `[RiderCapacity] post-claim reconcile failed for ${orderMongoId}, keeping claim: ${err?.message || err}`,
    );
    return false;
  }
}

/**
 * Capacity snapshot for one rider, safe to put straight into an API response.
 *
 * Fails open: on a query error it reports a free slot so the rider is never locked out by
 * infrastructure trouble.
 */
export async function getRiderCapacity(partnerId, options = {}) {
  const max = await getMaxConcurrentOrders();
  try {
    const loadMap = await getRiderActiveLoadMap([partnerId], options);
    const inHand = loadMap.get(String(partnerId?._id || partnerId)) || 0;
    return {
      maxConcurrentOrders: max,
      ordersInHand: inHand,
      remainingSlots: Math.max(0, max - inHand),
      canAcceptMore: inHand < max,
      message: inHand < max ? '' : CAPACITY_REACHED_MESSAGE,
    };
  } catch (err) {
    logger.warn(`[RiderCapacity] load read failed for ${partnerId}: ${err?.message || err}`);
    return {
      maxConcurrentOrders: max,
      ordersInHand: 0,
      remainingSlots: max,
      canAcceptMore: true,
      message: '',
    };
  }
}

/**
 * Accept-path guard.
 *
 * @throws {ValidationError} when the rider already holds the maximum number of orders.
 */
export async function assertRiderHasFreeSlot(partnerId, options = {}) {
  const capacity = await getRiderCapacity(partnerId, options);
  if (!capacity.canAcceptMore) {
    throw new ValidationError(CAPACITY_REACHED_MESSAGE);
  }
  return capacity;
}

/**
 * Dispatch-path filter: drop every candidate who is already carrying their maximum.
 *
 * Shape-preserving - entries are returned untouched apart from an added `ordersInHand`, so the
 * caller's ranking, cash-limit fields and `partnerId`/`_id` duality all keep working.
 *
 * Fails open: on error the candidate list is returned unchanged.
 */
export async function filterPartnersByOrderCapacity(partners = [], options = {}) {
  if (!Array.isArray(partners) || partners.length === 0) return partners;

  try {
    const max = await getMaxConcurrentOrders();
    const loadMap = await getRiderActiveLoadMap(
      partners.map((p) => p?.partnerId || p?._id),
      options,
    );

    const withLoad = [];
    for (const partner of partners) {
      const key = String(partner?.partnerId || partner?._id || '');
      const inHand = loadMap.get(key) || 0;
      if (inHand >= max) continue;
      withLoad.push({ ...partner, ordersInHand: inHand });
    }

    if (withLoad.length === 0) {
      logger.info(
        `[RiderCapacity] all ${partners.length} nearby riders are at the ${max}-order limit; order will be re-hunted.`,
      );
    }
    return withLoad;
  } catch (err) {
    logger.warn(
      `[RiderCapacity] capacity filter failed, passing candidates through: ${err?.message || err}`,
    );
    return partners;
  }
}
