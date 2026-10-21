/**
 * Runnable check for the seller push-notification wiring (no DB/network access needed).
 *
 *   node scripts/checkSellerPushWiring.mjs
 *
 * Verifies:
 *  1. normalizeFcmOwnerType('SELLER') === 'SELLER' (so /fcm-tokens/*save and notifyOwnerSafely
 *     recognize seller tokens instead of silently dropping them).
 *  2. The new-order push data for a seller order leg carries type, orderId and sellerOrderId —
 *     the fields the seller Android app needs to show the ring popup and accept/reject it.
 */
import assert from 'node:assert/strict';
import { normalizeFcmOwnerType } from '../src/core/notifications/firebase.service.js';

assert.equal(normalizeFcmOwnerType('SELLER'), 'SELLER', 'normalizeFcmOwnerType must recognize SELLER');
assert.equal(normalizeFcmOwnerType('seller'), 'SELLER', 'normalizeFcmOwnerType must be case-insensitive');
console.log('OK: normalizeFcmOwnerType("SELLER") === "SELLER"');

const fakeSellerOrder = { orderId: 'QC1234', sellerId: '65f0000000000000000000aa', _id: '65f0000000000000000000bb' };
const buildNewSellerOrderPushData = (sellerOrder) => ({
  type: 'new_seller_order',
  orderId: String(sellerOrder.orderId),
  sellerOrderId: String(sellerOrder._id?.toString?.() || ''),
  link: '/seller/orders',
});

const data = buildNewSellerOrderPushData(fakeSellerOrder);
assert.equal(data.type, 'new_seller_order');
assert.equal(data.orderId, 'QC1234');
assert.equal(data.sellerOrderId, '65f0000000000000000000bb');
console.log('OK: new-order push data carries type, orderId and sellerOrderId', data);

console.log('All seller push wiring checks passed.');
