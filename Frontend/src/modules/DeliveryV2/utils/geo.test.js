/**
 * Rule checks for rider distance resolution — the reason an offer card could read "?? KM"
 * and an in-trip header "-- km".
 * Run from the Frontend directory: node src/modules/DeliveryV2/utils/geo.test.js
 */
import assert from 'node:assert/strict';

import { extractLatLng, resolvePickupLatLng, formatKm } from './geo.js';

const INDORE = { lat: 22.7196, lng: 75.8577 };

// --- extractLatLng: every shape the backend actually sends ------------------------------
// GeoJSON is the canonical restaurant shape, and the one that used to be missed.
assert.deepEqual(extractLatLng({ type: 'Point', coordinates: [75.8577, 22.7196] }), INDORE);
// The flat mirror written by toGeoPoint().
assert.deepEqual(extractLatLng({ latitude: 22.7196, longitude: 75.8577 }), INDORE);
// The client-side shape used by the store.
assert.deepEqual(extractLatLng({ lat: 22.7196, lng: 75.8577 }), INDORE);
// GeoJSON wins when both are present and agree.
assert.deepEqual(
  extractLatLng({ coordinates: [75.8577, 22.7196], latitude: 22.7196, longitude: 75.8577 }),
  INDORE,
);
// A GeoJSON object with an EMPTY coordinates array must fall through to the mirror, not fail.
assert.deepEqual(extractLatLng({ type: 'Point', coordinates: [], latitude: 22.7196, longitude: 75.8577 }), INDORE);
// Strings from form payloads are still coordinates.
assert.deepEqual(extractLatLng({ lat: '22.7196', lng: '75.8577' }), INDORE);

// Nothing usable -> null, never NaN (NaN silently reads as "out of range" forever).
assert.equal(extractLatLng(null), null);
assert.equal(extractLatLng(undefined), null);
assert.equal(extractLatLng({}), null);
assert.equal(extractLatLng('somewhere'), null);
assert.equal(extractLatLng({ latitude: 22.7196 }), null, 'half a coordinate is not a location');
assert.equal(extractLatLng({ lat: 'abc', lng: 'def' }), null);
assert.equal(extractLatLng({ coordinates: [75.8577] }), null, 'a one-element array is not a point');

// --- resolvePickupLatLng: where the rider must go --------------------------------------
// Flattened shape set by the trip sync.
assert.deepEqual(resolvePickupLatLng({ restaurantLocation: { lat: 22.7196, lng: 75.8577 } }), INDORE);

// The case that broke the shared-order card: a populated restaurant with GeoJSON only.
assert.deepEqual(
  resolvePickupLatLng({ restaurantId: { location: { type: 'Point', coordinates: [75.8577, 22.7196] } } }),
  INDORE,
);

// A socket offer payload carrying the flat mirror.
assert.deepEqual(
  resolvePickupLatLng({ restaurantLocation: { latitude: 22.7196, longitude: 75.8577 } }),
  INDORE,
);

// Legacy flat keys.
assert.deepEqual(resolvePickupLatLng({ restaurant_lat: 22.7196, restaurant_lng: 75.8577 }), INDORE);

// Multi-restaurant: the NEXT uncollected stop wins, in server-assigned visit order.
{
  const order = {
    isMultiRestaurant: true,
    restaurantLocation: { lat: 1, lng: 1 },
    pickups: [
      { sequence: 1, status: 'ready', location: { coordinates: [75.9, 22.8] } },
      { sequence: 0, status: 'picked_up', location: { coordinates: [75.5, 22.5] } },
    ],
  };
  assert.deepEqual(
    resolvePickupLatLng(order),
    { lat: 22.8, lng: 75.9 },
    'an already collected stop must not be the target',
  );
}

// Dropped and cancelled stops are skipped too.
{
  const order = {
    pickups: [
      { sequence: 0, status: 'cancelled', location: { coordinates: [75.1, 22.1] } },
      { sequence: 1, permanentlyDropped: true, location: { coordinates: [75.2, 22.2] } },
      { sequence: 2, status: 'ready', location: { coordinates: [75.8577, 22.7196] } },
    ],
  };
  assert.deepEqual(resolvePickupLatLng(order), INDORE);
}

// A stop with no usable coordinates is skipped rather than returning null for the whole order.
{
  const order = {
    pickups: [
      { sequence: 0, status: 'ready', location: {} },
      { sequence: 1, status: 'ready', location: { coordinates: [75.8577, 22.7196] } },
    ],
  };
  assert.deepEqual(resolvePickupLatLng(order), INDORE);
}

// All pickups collected -> fall back to the order's own restaurant location.
{
  const order = {
    restaurantLocation: { lat: 22.7196, lng: 75.8577 },
    pickups: [{ sequence: 0, status: 'picked_up', location: { coordinates: [75.5, 22.5] } }],
  };
  assert.deepEqual(resolvePickupLatLng(order), INDORE);
}

// Genuinely no location anywhere (restaurant never geocoded) -> null, so the UI can say so.
assert.equal(resolvePickupLatLng({ restaurantName: "Tanu's Restaurant" }), null);
assert.equal(resolvePickupLatLng(null), null);

// --- formatKm: never render "Infinity km" / "NaN km" to a rider -------------------------
assert.equal(formatKm(1234), '1.2');
assert.equal(formatKm(0), '0.0');
assert.equal(formatKm(Infinity), '--');
assert.equal(formatKm(NaN), '--');
assert.equal(formatKm(null), '--');
assert.equal(formatKm(undefined), '--');
assert.equal(formatKm(-5), '--');
assert.equal(formatKm(Infinity, '?'), '?');

console.log('geo: all assertions passed');
