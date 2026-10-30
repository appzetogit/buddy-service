import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTSTATION_AUTO_EXPIRE_HOURS,
  OUTSTATION_AUTO_EXPIRE_MS,
  processRideCancellationRefund,
} from '../src/modules/taxi/services/dispatchService.js';

test('outstation auto-expire duration is 3.5 hours (3-4 hours)', () => {
  assert.equal(OUTSTATION_AUTO_EXPIRE_HOURS, 3.5);
  assert.equal(OUTSTATION_AUTO_EXPIRE_MS, 3.5 * 60 * 60 * 1000);
});

test('refund skips cash ride', async () => {
  const cashRide = {
    userId: 'user1',
    paymentMethod: 'cash',
    fare: 500,
    driverPaymentCollection: { status: 'pending' },
  };
  const result = await processRideCancellationRefund(cashRide);
  assert.equal(result.refunded, false);
});

test('refund skips pending online ride without payment ID or capture', async () => {
  const pendingOnlineRide = {
    userId: 'user1',
    paymentMethod: 'online',
    fare: 1500,
    driverPaymentCollection: { status: 'pending', providerPaymentId: '' },
  };
  const result = await processRideCancellationRefund(pendingOnlineRide);
  assert.equal(result.refunded, false);
});

test('refund skips already refunded ride', async () => {
  const alreadyRefundedRide = {
    userId: 'user1',
    paymentMethod: 'online',
    fare: 1500,
    driverPaymentCollection: { status: 'refunded' },
  };
  const result = await processRideCancellationRefund(alreadyRefundedRide);
  assert.equal(result.refunded, true);
  assert.equal(result.status, 'already_refunded');
});

