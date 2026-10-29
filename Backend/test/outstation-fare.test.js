import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeOutstationFare,
  outstationTripDays,
} from '../src/modules/taxi/services/outstationFareService.js';

const tariff = {
  enable_outstation_ride: true,
  outstation_base_price: 500,
  outstation_base_distance: 10,
  outstation_price_per_distance: 12,
  outstation_time_price: 1,
  outstation_round_trip_price_per_distance: 10,
  outstation_min_km_per_day: 300,
  outstation_driver_allowance_per_day: 400,
};

test('one way: base + km beyond the included distance + minutes', () => {
  const q = computeOutstationFare({ setPrice: tariff, distanceMeters: 100000, durationMinutes: 120 });
  assert.equal(q.tripType, 'one_way');
  assert.equal(q.total, 500 + 90 * 12 + 120);
});

test('round trip: both ways, at least min km per day, plus allowance, no minutes', () => {
  const q = computeOutstationFare({
    setPrice: tariff,
    distanceMeters: 100000,
    durationMinutes: 120,
    tripType: 'round_trip',
    travelDate: '2026-11-02T04:30:00.000Z',
    returnDate: '2026-11-03T10:00:00.000Z',
  });
  assert.equal(q.days, 2);
  assert.equal(q.total, 500 + 600 * 10 + 800);
  assert.equal(q.driverAllowance, 800);
});

test('trip days are inclusive IST calendar days, at least 1', () => {
  // 23:00 IST on the 2nd to 01:00 IST on the 3rd is 2 days.
  assert.equal(outstationTripDays('2026-11-02T17:30:00.000Z', '2026-11-02T19:30:00.000Z'), 2);
  assert.equal(outstationTripDays('2026-11-02T04:00:00.000Z', '2026-11-02T10:00:00.000Z'), 1);
  assert.equal(outstationTripDays(null, null), 1);
});

test('a tariff without outstation pricing is not priced here', () => {
  assert.equal(computeOutstationFare({ setPrice: { enable_outstation_ride: false }, distanceMeters: 1000 }), null);
  assert.equal(computeOutstationFare({ setPrice: { enable_outstation_ride: true }, distanceMeters: 1000 }), null);
});
