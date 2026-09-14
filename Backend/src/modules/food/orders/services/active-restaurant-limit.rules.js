import { haversineKm } from '../../../../core/location/haversine.util.js';

export const MAX_CONCURRENT_RESTAURANTS = 2;
export const ACTIVE_RESTAURANT_RADIUS_KM = 5;

/**
 * Statuses that free up a restaurant slot. Matches the wider list already used
 * by restaurantFood.service.js — a rejected order is finished from the user's
 * point of view even though the lifecycle policy lets it transition back.
 */
export const ACTIVE_ORDER_TERMINAL_STATUSES = [
  'delivered',
  'cancelled_by_user',
  'cancelled_by_restaurant',
  'cancelled_by_admin',
  'rejected_by_restaurant',
];

export const TOO_MANY_RESTAURANTS_MESSAGE =
  'You can only order from 2 restaurants at a time.';

export const TOO_FAR_MESSAGE =
  `Sorry, you can only order from another restaurant within ${ACTIVE_RESTAURANT_RADIUS_KM} km of your current restaurant order.`;

export const MISSING_COORDS_MESSAGE =
  'We could not confirm this restaurant’s location, so we can’t check it against your active order. Please try again later.';

const idToString = (value) => (value ? String(value) : null);

/** Every restaurant an order pulls from — anchor plus any extra pickups. */
export function restaurantIdsOfOrder(order) {
  const ids = [idToString(order?.restaurantId)];
  for (const pickup of order?.pickups || []) {
    ids.push(idToString(pickup?.restaurantId));
  }
  return ids.filter(Boolean);
}

/** Distinct restaurant ids across the given orders, preserving order age. */
export function distinctRestaurantIds(orders) {
  const seen = [];
  for (const order of orders || []) {
    for (const id of restaurantIdsOfOrder(order)) {
      if (!seen.includes(id)) seen.push(id);
    }
  }
  return seen;
}

/**
 * The rule itself, with no I/O so it can be exercised directly.
 *
 * `coordsById` must contain `{lat, lng}` for every id involved in a distance
 * comparison. A missing entry is rejected rather than waved through — an
 * unknown location must never be assumed to be nearby.
 */
export function evaluateRestaurantLimit({
  activeRestaurantIds = [],
  targetRestaurantIds = [],
  coordsById = {},
  maxKm = ACTIVE_RESTAURANT_RADIUS_KM,
  maxRestaurants = MAX_CONCURRENT_RESTAURANTS,
}) {
  const active = activeRestaurantIds.filter(Boolean).map(String);
  const targets = [...new Set(targetRestaurantIds.filter(Boolean).map(String))];

  if (targets.length === 0) return { allowed: true, distanceKm: null };

  // Re-ordering from a restaurant already in play takes no new slot.
  const additions = targets.filter((id) => !active.includes(id));
  if (additions.length === 0) return { allowed: true, distanceKm: null };

  if (active.length + additions.length > maxRestaurants) {
    return {
      allowed: false,
      code: 'MAX_RESTAURANTS',
      message: TOO_MANY_RESTAURANTS_MESSAGE,
    };
  }

  const usable = (c) => c && Number.isFinite(c.lat) && Number.isFinite(c.lng);

  let furthestKm = null;
  for (const existingId of active) {
    const from = coordsById[existingId];
    if (!usable(from)) {
      return { allowed: false, code: 'MISSING_COORDINATES', message: MISSING_COORDS_MESSAGE };
    }
    for (const newId of additions) {
      const to = coordsById[newId];
      if (!usable(to)) {
        return { allowed: false, code: 'MISSING_COORDINATES', message: MISSING_COORDS_MESSAGE };
      }

      const km = haversineKm(from.lat, from.lng, to.lat, to.lng);
      if (!Number.isFinite(km)) {
        return { allowed: false, code: 'MISSING_COORDINATES', message: MISSING_COORDS_MESSAGE };
      }
      if (furthestKm === null || km > furthestKm) furthestKm = km;

      if (km > maxKm) {
        return {
          allowed: false,
          code: 'TOO_FAR',
          message: TOO_FAR_MESSAGE,
          distanceKm: Number(km.toFixed(3)),
        };
      }
    }
  }

  return { allowed: true, distanceKm: furthestKm === null ? null : Number(furthestKm.toFixed(3)) };
}
