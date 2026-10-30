import test from 'node:test';
import assert from 'node:assert/strict';

test('dispatch cycling repeats unrejected drivers across waves', () => {
  const drivers = [{ _id: 'driver_tanu' }, { _id: 'driver_raj' }];
  const rejectedDriverIds = new Set();
  let notifiedDriverIds = new Set();
  let lastDriverId = null;
  const dispatchHistory = [];

  for (let attempt = 0; attempt < 6; attempt++) {
    const eligibleDrivers = drivers.filter((driver) => !rejectedDriverIds.has(String(driver._id)));
    let availableDrivers = eligibleDrivers.filter((driver) => !notifiedDriverIds.has(String(driver._id)));

    let isNewCycle = false;
    if (availableDrivers.length === 0 && eligibleDrivers.length > 0) {
      isNewCycle = true;
      notifiedDriverIds = new Set();
      availableDrivers = eligibleDrivers.slice().sort((a, b) => {
        if (lastDriverId) {
          if (String(a._id) === String(lastDriverId)) return 1;
          if (String(b._id) === String(lastDriverId)) return -1;
        }
        return 0;
      });
    }

    const targetDrivers = availableDrivers.slice(0, 1);
    if (targetDrivers.length) {
      lastDriverId = String(targetDrivers[0]._id);
      notifiedDriverIds.add(lastDriverId);
    }
    dispatchHistory.push(targetDrivers.map((d) => d._id));
  }

  assert.deepEqual(dispatchHistory, [
    ['driver_tanu'],
    ['driver_raj'],
    ['driver_tanu'], // Cycled back!
    ['driver_raj'],  // Cycled back!
    ['driver_tanu'], // Cycled back!
    ['driver_raj'],
  ]);
});

test('dispatch cycling with single driver repeats on every attempt', () => {
  const drivers = [{ _id: 'driver_tanu' }];
  const rejectedDriverIds = new Set();
  let notifiedDriverIds = new Set();
  let lastDriverId = null;
  const dispatchHistory = [];

  for (let attempt = 0; attempt < 4; attempt++) {
    const eligibleDrivers = drivers.filter((driver) => !rejectedDriverIds.has(String(driver._id)));
    let availableDrivers = eligibleDrivers.filter((driver) => !notifiedDriverIds.has(String(driver._id)));

    let isNewCycle = false;
    if (availableDrivers.length === 0 && eligibleDrivers.length > 0) {
      isNewCycle = true;
      notifiedDriverIds = new Set();
      availableDrivers = eligibleDrivers.slice();
    }

    const targetDrivers = availableDrivers.slice(0, 1);
    if (targetDrivers.length) {
      lastDriverId = String(targetDrivers[0]._id);
      notifiedDriverIds.add(lastDriverId);
    }
    dispatchHistory.push(targetDrivers.map((d) => d._id));
  }

  assert.deepEqual(dispatchHistory, [
    ['driver_tanu'],
    ['driver_tanu'], // Repeats because driver did not reject
    ['driver_tanu'],
    ['driver_tanu'],
  ]);
});

test('driver who explicitly rejected is excluded from cycles', () => {
  const drivers = [{ _id: 'driver_tanu' }, { _id: 'driver_raj' }];
  const rejectedDriverIds = new Set(['driver_tanu']); // Tanu explicitly rejected!
  let notifiedDriverIds = new Set();
  let lastDriverId = null;
  const dispatchHistory = [];

  for (let attempt = 0; attempt < 3; attempt++) {
    const eligibleDrivers = drivers.filter((driver) => !rejectedDriverIds.has(String(driver._id)));
    let availableDrivers = eligibleDrivers.filter((driver) => !notifiedDriverIds.has(String(driver._id)));

    if (availableDrivers.length === 0 && eligibleDrivers.length > 0) {
      notifiedDriverIds = new Set();
      availableDrivers = eligibleDrivers.slice();
    }

    const targetDrivers = availableDrivers.slice(0, 1);
    if (targetDrivers.length) {
      lastDriverId = String(targetDrivers[0]._id);
      notifiedDriverIds.add(lastDriverId);
    }
    dispatchHistory.push(targetDrivers.map((d) => d._id));
  }

  // Only raj receives, tanu never receives
  assert.deepEqual(dispatchHistory, [
    ['driver_raj'],
    ['driver_raj'],
    ['driver_raj'],
  ]);
});

