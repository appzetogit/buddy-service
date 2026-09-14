/**
 * Rule check for the 2-restaurant / 5 km limit.
 * Run: node test/active-restaurant-limit.test.js
 */
import assert from 'node:assert/strict';

import { haversineKm } from '../src/core/location/haversine.util.js';
import {
  evaluateRestaurantLimit,
  distinctRestaurantIds,
  ACTIVE_RESTAURANT_RADIUS_KM,
} from '../src/modules/food/orders/services/active-restaurant-limit.rules.js';

const A = '000000000000000000000a01';
const B = '000000000000000000000b02';
const C = '000000000000000000000c03';

const base = { lat: 22.7196, lng: 75.8577 }; // Indore
// Due-north offsets: latitude degrees are ~constant in length, so this gives
// predictable separations without hardcoding the earth radius.
const north = (km) => ({ lat: base.lat + km / 111.195, lng: base.lng });

const coords = (overrides) => ({ [A]: base, ...overrides });

// 1. No active orders -> anything goes.
assert.equal(
  evaluateRestaurantLimit({ activeRestaurantIds: [], targetRestaurantIds: [A], coordsById: coords() }).allowed,
  true,
);

// 2. Second restaurant comfortably inside the radius.
{
  const near = north(3);
  const verdict = evaluateRestaurantLimit({
    activeRestaurantIds: [A],
    targetRestaurantIds: [B],
    coordsById: coords({ [B]: near }),
  });
  assert.equal(verdict.allowed, true);
  assert.ok(verdict.distanceKm < ACTIVE_RESTAURANT_RADIUS_KM);
}

// 3 & 4. Boundary: allowed iff the measured distance is <= the limit. Asserting
// against haversineKm itself keeps this honest if the earth-radius constant moves.
for (const km of [4.99, 5.0, 5.01, 5.2]) {
  const point = north(km);
  const measured = haversineKm(base.lat, base.lng, point.lat, point.lng);
  const verdict = evaluateRestaurantLimit({
    activeRestaurantIds: [A],
    targetRestaurantIds: [B],
    coordsById: coords({ [B]: point }),
  });
  assert.equal(
    verdict.allowed,
    measured <= ACTIVE_RESTAURANT_RADIUS_KM,
    `at ${measured.toFixed(4)} km expected allowed=${measured <= ACTIVE_RESTAURANT_RADIUS_KM}`,
  );
  if (!verdict.allowed) assert.equal(verdict.code, 'TOO_FAR');
}

// 5. Two restaurants already live -> a third is refused even if it is next door.
{
  const verdict = evaluateRestaurantLimit({
    activeRestaurantIds: [A, B],
    targetRestaurantIds: [C],
    coordsById: coords({ [B]: north(1), [C]: north(0.2) }),
  });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.code, 'MAX_RESTAURANTS');
}

// 6. Re-ordering from a restaurant already in play takes no new slot.
assert.equal(
  evaluateRestaurantLimit({
    activeRestaurantIds: [A, B],
    targetRestaurantIds: [A],
    coordsById: coords({ [B]: north(1) }),
  }).allowed,
  true,
);

// 10 & 11. Unknown or unusable coordinates fail closed, never "probably nearby".
for (const bad of [undefined, { lat: Number.NaN, lng: 75.8 }]) {
  const verdict = evaluateRestaurantLimit({
    activeRestaurantIds: [A],
    targetRestaurantIds: [B],
    coordsById: coords(bad === undefined ? {} : { [B]: bad }),
  });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.code, 'MISSING_COORDINATES');
}

// Multi-restaurant orders contribute every pickup, not just the anchor.
assert.deepEqual(
  distinctRestaurantIds([
    { restaurantId: A, pickups: [{ restaurantId: B }] },
    { restaurantId: A, pickups: [] },
  ]),
  [A, B],
);

// A single order spanning 2 restaurants already fills both slots.
assert.equal(
  evaluateRestaurantLimit({
    activeRestaurantIds: distinctRestaurantIds([{ restaurantId: A, pickups: [{ restaurantId: B }] }]),
    targetRestaurantIds: [C],
    coordsById: coords({ [B]: north(1), [C]: north(1.5) }),
  }).allowed,
  false,
);

console.log('active-restaurant-limit: all checks passed');
