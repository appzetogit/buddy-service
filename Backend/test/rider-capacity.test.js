/**
 * Rule checks for rider order stacking (how many orders one delivery partner may hold).
 * Run: node test/rider-capacity.test.js
 */
import assert from 'node:assert/strict';

import {
  ACTIVE_FOOD_ORDER_STATUSES,
  ACTIVE_QUICK_ORDER_STATUSES,
  CAPACITY_REACHED_MESSAGE,
  DEFAULT_MAX_CONCURRENT_ORDERS,
  MAX_MAX_CONCURRENT_ORDERS,
  MIN_MAX_CONCURRENT_ORDERS,
  byAcceptedAtThenId,
  clampMaxConcurrentOrders,
} from '../src/modules/food/orders/services/rider-capacity.service.js';

// 1. The product rule: two orders in hand by default, third only after one is delivered.
assert.equal(DEFAULT_MAX_CONCURRENT_ORDERS, 2);

// 2. Admin input is clamped, and anything unusable falls back to the default.
assert.equal(clampMaxConcurrentOrders(1), 1);
assert.equal(clampMaxConcurrentOrders(2), 2);
assert.equal(clampMaxConcurrentOrders(0), MIN_MAX_CONCURRENT_ORDERS);
assert.equal(clampMaxConcurrentOrders(-7), MIN_MAX_CONCURRENT_ORDERS);
assert.equal(clampMaxConcurrentOrders(99), MAX_MAX_CONCURRENT_ORDERS);
assert.equal(clampMaxConcurrentOrders(2.9), 2, 'fractional limits truncate, never round up');
assert.equal(clampMaxConcurrentOrders('3'), 3, 'numeric strings from the admin form are accepted');
assert.equal(clampMaxConcurrentOrders(null), DEFAULT_MAX_CONCURRENT_ORDERS);
assert.equal(clampMaxConcurrentOrders(undefined), DEFAULT_MAX_CONCURRENT_ORDERS);
assert.equal(clampMaxConcurrentOrders('abc'), DEFAULT_MAX_CONCURRENT_ORDERS);
assert.equal(clampMaxConcurrentOrders(NaN), DEFAULT_MAX_CONCURRENT_ORDERS);
assert.equal(clampMaxConcurrentOrders(Infinity), DEFAULT_MAX_CONCURRENT_ORDERS);

// 3. A slot is held only while there is real work left. Terminal states must never count, or a
//    rider would be permanently blocked by their own delivery history.
for (const terminal of [
  'delivered',
  'cancelled_by_user',
  'cancelled_by_restaurant',
  'rejected_by_restaurant',
  'cancelled_by_admin',
]) {
  assert.ok(
    !ACTIVE_FOOD_ORDER_STATUSES.includes(terminal),
    `food status "${terminal}" is terminal and must not consume a slot`,
  );
}
for (const terminal of ['delivered', 'cancelled_by_user', 'cancelled_by_system']) {
  assert.ok(
    !ACTIVE_QUICK_ORDER_STATUSES.includes(terminal),
    `quick status "${terminal}" is terminal and must not consume a slot`,
  );
}

// 4. Every stage a rider can actually be working through does count.
for (const live of ['confirmed', 'preparing', 'ready_for_pickup', 'reached_pickup', 'picked_up', 'reached_drop']) {
  assert.ok(ACTIVE_FOOD_ORDER_STATUSES.includes(live), `food status "${live}" must consume a slot`);
}
for (const live of ['confirmed', 'preparing', 'ready_for_pickup', 'picked_up']) {
  assert.ok(ACTIVE_QUICK_ORDER_STATUSES.includes(live), `quick status "${live}" must consume a slot`);
}

// 5. 'scheduled' is a future order nobody is driving yet.
assert.ok(!ACTIVE_FOOD_ORDER_STATUSES.includes('scheduled'));

// 6. The rider-facing message is shared by every rejection path (food, share-join, QC) so the
//    app can recognise it; the delivery UI matches on "maximum number of orders".
assert.match(CAPACITY_REACHED_MESSAGE, /maximum number of orders/);

// 7. Race tie-break. Every racer sorts the SAME way, keeps the first `max`, and only a surplus
//    claim releases itself. If this were not total and symmetric, two simultaneous accepts could
//    each decide the other survives and both roll back, losing the order.
{
  const t = (ms) => new Date(2026, 0, 1, 0, 0, 0, ms);
  const food = { id: 'f1', kind: 'food', acceptedAt: t(10) };
  const quick = { id: 'q1', kind: 'quick', acceptedAt: t(20) };
  const later = { id: 'f2', kind: 'food', acceptedAt: t(30) };

  // Oldest acceptance first, regardless of which vertical it came from.
  const sorted = [later, quick, food].sort(byAcceptedAtThenId);
  assert.deepEqual(sorted.map((r) => r.id), ['f1', 'q1', 'f2']);

  // The keep-set spans both verticals: a QC job really does occupy one of the two slots.
  const keep = new Set(sorted.slice(0, DEFAULT_MAX_CONCURRENT_ORDERS).map((r) => r.id));
  assert.ok(keep.has('f1'));
  assert.ok(keep.has('q1'), 'a Quick Commerce job holds a slot against Food');
  assert.ok(!keep.has('f2'), 'the surplus claim is the one that releases itself');

  // Identical timestamps fall back to order id, so the verdict is still deterministic.
  const sameTime = [
    { id: 'bbb', acceptedAt: t(5) },
    { id: 'aaa', acceptedAt: t(5) },
  ].sort(byAcceptedAtThenId);
  assert.deepEqual(sameTime.map((r) => r.id), ['aaa', 'bbb']);

  // A missing or unparseable acceptedAt sorts LAST: it must never evict a real claim.
  const missing = [
    { id: 'no-ts', acceptedAt: null },
    { id: 'real', acceptedAt: t(99) },
  ].sort(byAcceptedAtThenId);
  assert.deepEqual(missing.map((r) => r.id), ['real', 'no-ts']);

  const bogus = [
    { id: 'bad', acceptedAt: 'not-a-date' },
    { id: 'real', acceptedAt: t(99) },
  ].sort(byAcceptedAtThenId);
  assert.deepEqual(bogus.map((r) => r.id), ['real', 'bad']);

  // Symmetry: comparing in either direction must give opposite signs, never both <= 0.
  assert.ok(byAcceptedAtThenId(food, later) < 0);
  assert.ok(byAcceptedAtThenId(later, food) > 0);
  assert.equal(byAcceptedAtThenId(food, { ...food }), 0);
}

console.log('rider-capacity: all assertions passed');
