import test from 'node:test';
import assert from 'node:assert/strict';
import {
  driverRideFilter,
  driverTakesRide,
  rideCategoryOf,
} from '../src/modules/taxi/shared/driverRideFilters.js';
import { normalizeTaxiCategories } from '../src/core/identity/taxiPartnerSync.js';

const car = [/^car$/i];

test('ride kinds', () => {
  assert.equal(rideCategoryOf('intercity'), 'outstation');
  assert.equal(rideCategoryOf('parcel'), 'parcel');
  assert.equal(rideCategoryOf('ride'), 'city');
  assert.equal(rideCategoryOf(undefined), 'city');
});

test('a taxi-only rider is matched on their taxi vehicle, not the (empty) Food one', () => {
  const tara = { vehicleType: '', taxiVehicleType: 'car', taxiServiceCategories: ['city', 'outstation'] };
  assert.equal(driverTakesRide(tara, { regexes: car, serviceType: 'intercity' }).ok, true);
  assert.equal(driverTakesRide(tara, { regexes: car, serviceType: 'parcel' }).categoryOk, false);
  assert.equal(driverTakesRide(tara, { regexes: [/^auto$/i], serviceType: 'ride' }).vehicleOk, false);
});

test('a rider who never chose takes every kind (as before)', () => {
  const old = { vehicleType: 'car' };
  for (const t of ['ride', 'intercity', 'parcel']) assert.equal(driverTakesRide(old, { regexes: car, serviceType: t }).ok, true);
});

test('the Mongo filter has a vehicle clause (either field) and a category clause', () => {
  const f = driverRideFilter({ regexes: car, serviceType: 'intercity' });
  assert.equal(f.$and.length, 2);
  assert.deepEqual(f.$and[0].$or.map((c) => Object.keys(c)[0]), ['vehicleType', 'taxiVehicleType']);
  assert.deepEqual(f.$and[1].$or.at(-1), { taxiServiceCategories: 'outstation' });
  assert.equal(driverRideFilter({ serviceType: 'ride' }).$and.length, 1);
});

test('categories are validated', () => {
  assert.equal(normalizeTaxiCategories(undefined), undefined);
  assert.deepEqual(normalizeTaxiCategories(['City', 'outstation', 'city']), ['city', 'outstation']);
  assert.throws(() => normalizeTaxiCategories([]));
  assert.throws(() => normalizeTaxiCategories(['bus']));
});
