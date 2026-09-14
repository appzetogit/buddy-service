import mongoose from 'mongoose';

import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodOrder } from '../models/order.model.js';
import { getRestaurantCoords } from './restaurant-chain-radius.service.js';
import {
  ACTIVE_ORDER_TERMINAL_STATUSES,
  ACTIVE_RESTAURANT_RADIUS_KM,
  MAX_CONCURRENT_RESTAURANTS,
  TOO_MANY_RESTAURANTS_MESSAGE,
  distinctRestaurantIds,
  evaluateRestaurantLimit,
  restaurantIdsOfOrder,
} from './active-restaurant-limit.rules.js';

export {
  ACTIVE_ORDER_TERMINAL_STATUSES,
  ACTIVE_RESTAURANT_RADIUS_KM,
  MAX_CONCURRENT_RESTAURANTS,
  distinctRestaurantIds,
  evaluateRestaurantLimit,
};

/**
 * Restaurants the user currently has live orders with, oldest order first.
 *
 * Ordering is deterministic (createdAt, then _id) so that two racing requests
 * independently agree on which restaurants hold the existing slots.
 */
export async function getActiveRestaurantOrders(userId, { excludeOrderId = null } = {}) {
  if (!userId) return [];

  const query = {
    userId: new mongoose.Types.ObjectId(String(userId)),
    orderStatus: { $nin: ACTIVE_ORDER_TERMINAL_STATUSES },
  };
  if (excludeOrderId) {
    query._id = { $ne: new mongoose.Types.ObjectId(String(excludeOrderId)) };
  }

  return FoodOrder.find(query)
    .select('_id restaurantId pickups.restaurantId createdAt')
    .sort({ createdAt: 1, _id: 1 })
    .lean();
}

async function loadCoords(restaurantIds) {
  const ids = [...new Set(restaurantIds.filter(Boolean).map(String))].filter((id) =>
    mongoose.Types.ObjectId.isValid(id),
  );
  if (ids.length === 0) return {};

  const docs = await FoodRestaurant.find({ _id: { $in: ids } })
    .select('_id location')
    .lean();

  const coordsById = {};
  for (const doc of docs) {
    const coords = getRestaurantCoords(doc);
    if (coords) coordsById[String(doc._id)] = coords;
  }
  return coordsById;
}

/** Non-throwing form, for answering "may I order here?" before checkout. */
export async function checkRestaurantEligibility(userId, restaurantId, { excludeOrderId = null } = {}) {
  const targets = (Array.isArray(restaurantId) ? restaurantId : [restaurantId])
    .filter(Boolean)
    .map(String);

  const activeOrders = await getActiveRestaurantOrders(userId, { excludeOrderId });
  const activeRestaurantIds = distinctRestaurantIds(activeOrders);

  const coordsById = await loadCoords([...activeRestaurantIds, ...targets]);
  const verdict = evaluateRestaurantLimit({
    activeRestaurantIds,
    targetRestaurantIds: targets,
    coordsById,
  });

  return {
    ...verdict,
    activeRestaurantIds,
    maxRestaurants: MAX_CONCURRENT_RESTAURANTS,
    maxDistanceKm: ACTIVE_RESTAURANT_RADIUS_KM,
  };
}

/** Throwing form used on the order-creation path. */
export async function assertRestaurantOrderLimit(userId, restaurantIds, { excludeOrderId = null } = {}) {
  const verdict = await checkRestaurantEligibility(userId, restaurantIds, { excludeOrderId });
  if (!verdict.allowed) throw new ValidationError(verdict.message);
  return verdict;
}

/**
 * Post-insert guard closing the gap between the pre-insert check and the write.
 *
 * Two concurrent requests can both pass the pre-check and both insert. Re-reading
 * here — with the new order included — lets every racer see the same picture, and
 * the deterministic oldest-first ordering means only the losers roll themselves
 * back. Mirrors the existing compensating-delete used for wallet debit failures.
 */
export async function reconcileRestaurantLimitAfterInsert(userId, orderId) {
  const activeOrders = await getActiveRestaurantOrders(userId);
  const ordered = distinctRestaurantIds(activeOrders);
  if (ordered.length <= MAX_CONCURRENT_RESTAURANTS) return { allowed: true };

  const thisOrder = activeOrders.find((o) => String(o._id) === String(orderId));
  const keep = ordered.slice(0, MAX_CONCURRENT_RESTAURANTS);
  const mine = restaurantIdsOfOrder(thisOrder);
  const survives = mine.length > 0 && mine.every((id) => keep.includes(id));

  if (survives) return { allowed: true };

  await FoodOrder.deleteOne({ _id: orderId });
  throw new ValidationError(TOO_MANY_RESTAURANTS_MESSAGE);
}
