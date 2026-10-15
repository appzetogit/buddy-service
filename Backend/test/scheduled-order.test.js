/**
 * Rule checks for scheduled-order business validation (assertValidScheduledAt).
 * Run: node test/scheduled-order.test.js
 */
import assert from 'node:assert/strict';

import {
  MIN_SCHEDULE_LEAD_MINUTES,
  MAX_SCHEDULE_LEAD_DAYS,
  assertValidScheduledAt,
} from '../src/modules/food/orders/services/order-lifecycle.policy.js';

const NOW = new Date('2026-01-15T10:00:00.000Z');
const minutes = (n) => n * 60 * 1000;
const days = (n) => n * 24 * 60 * 60 * 1000;

// 1. No scheduledAt at all -> ordinary instant order, no validation to fail.
assert.equal(assertValidScheduledAt(undefined, NOW), null);
assert.equal(assertValidScheduledAt(null, NOW), null);
assert.equal(assertValidScheduledAt('', NOW), null);

// 2. Malformed value -> rejected, not silently treated as "no schedule".
assert.throws(() => assertValidScheduledAt('not-a-date', NOW), /invalid/i);
assert.throws(() => assertValidScheduledAt('this is definitely not a timestamp', NOW), /invalid/i);

// 3. The actual bug being fixed: a past (or "right now") scheduledAt used to silently fall back
//    to an instant order. It must now be rejected outright.
assert.throws(
  () => assertValidScheduledAt(new Date(NOW.getTime() - minutes(5)).toISOString(), NOW),
  /at least/i,
);
assert.throws(() => assertValidScheduledAt(NOW.toISOString(), NOW), /at least/i);

// 4. Inside the activation job's own lookahead window: rejected. A value here would activate on
//    the very next 1-minute cron tick, which is an instant order wearing a "scheduled" label.
assert.throws(
  () => assertValidScheduledAt(new Date(NOW.getTime() + minutes(10)).toISOString(), NOW),
  new RegExp(`at least ${MIN_SCHEDULE_LEAD_MINUTES} minutes`, 'i'),
);

// 5. Exactly at the minimum boundary: accepted.
{
  const atMin = new Date(NOW.getTime() + minutes(MIN_SCHEDULE_LEAD_MINUTES));
  const parsed = assertValidScheduledAt(atMin.toISOString(), NOW);
  assert.equal(parsed.getTime(), atMin.getTime());
}

// 6. A sensible future slot: accepted, and the exact Date is returned (so callers never
//    re-parse the raw string again).
{
  const slot = new Date(NOW.getTime() + minutes(90));
  const parsed = assertValidScheduledAt(slot.toISOString(), NOW);
  assert.ok(parsed instanceof Date);
  assert.equal(parsed.getTime(), slot.getTime());
}

// 7. Too far out: rejected.
assert.throws(
  () => assertValidScheduledAt(new Date(NOW.getTime() + days(MAX_SCHEDULE_LEAD_DAYS) + minutes(1)).toISOString(), NOW),
  new RegExp(`more than ${MAX_SCHEDULE_LEAD_DAYS} days`, 'i'),
);

// 8. Exactly at the maximum boundary: accepted.
{
  const atMax = new Date(NOW.getTime() + days(MAX_SCHEDULE_LEAD_DAYS));
  const parsed = assertValidScheduledAt(atMax.toISOString(), NOW);
  assert.equal(parsed.getTime(), atMax.getTime());
}

// 9. A Date instance (not just a string) is accepted directly, matching how `scheduled: Date`
//    re-validation could be called internally without re-serialising first.
{
  const slot = new Date(NOW.getTime() + minutes(60));
  const parsed = assertValidScheduledAt(slot, NOW);
  assert.equal(parsed.getTime(), slot.getTime());
}

console.log('scheduled-order: all assertions passed');
