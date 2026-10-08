/**
 * Rule checks for the rider's stacked-order store (focus, promote, per-order stage).
 * Run from the Frontend directory: node src/modules/DeliveryV2/store/useDeliveryStore.test.js
 */
import assert from 'node:assert/strict';

import { useDeliveryStore, orderKeyOf, orderAliasesOf } from './useDeliveryStore.js';

const A = { _id: 'aaaaaaaaaaaaaaaaaaaaaa01', order_id: 'A1' };
const B = { _id: 'bbbbbbbbbbbbbbbbbbbbbb02', order_id: 'B2' };
const C = { _id: 'cccccccccccccccccccccc03', order_id: 'C3' };

const s = () => useDeliveryStore.getState();
const reset = () => s().clearAllActiveOrders();

// --- keys -------------------------------------------------------------------------------
assert.equal(orderKeyOf(A), A._id);
assert.equal(orderKeyOf({ orderMongoId: 'x' }), 'x');
assert.equal(orderKeyOf({ orderId: 'q' }), 'q', 'Quick Commerce payloads key off orderId');
assert.equal(orderKeyOf(null), '');
assert.deepEqual(orderAliasesOf({ _id: '1', orderId: '2' }), ['1', '2']);

// --- accepting a first order ------------------------------------------------------------
reset();
s().setActiveOrder(A);
assert.equal(orderKeyOf(s().activeOrder), orderKeyOf(A));
assert.equal(s().activeOrders.length, 1);
assert.equal(s().tripStatus, 'PICKING_UP');

// --- the order the rider is driving advances through its stages --------------------------
s().updateTripStatus('PICKED_UP');
assert.equal(s().tripStatus, 'PICKED_UP');
assert.equal(s().tripStatusByOrder[orderKeyOf(A)], 'PICKED_UP');

// --- stacking a second order must NOT inherit the first order's stage -------------------
s().setActiveOrder(B);
assert.equal(s().activeOrders.length, 2);
assert.equal(orderKeyOf(s().activeOrder), orderKeyOf(B), 'the newly accepted order takes focus');
assert.equal(s().tripStatus, 'PICKING_UP', 'order B starts at its own first stage');
assert.equal(s().tripStatusByOrder[orderKeyOf(A)], 'PICKED_UP', "order A keeps its own stage");

// --- switching focus restores each order's real stage -----------------------------------
s().focusOrder(orderKeyOf(A));
assert.equal(orderKeyOf(s().activeOrder), orderKeyOf(A));
assert.equal(s().tripStatus, 'PICKED_UP');
s().focusOrder(orderKeyOf(B));
assert.equal(s().tripStatus, 'PICKING_UP');

// --- focusing something not in hand is ignored ------------------------------------------
s().focusOrder(orderKeyOf(C));
assert.equal(orderKeyOf(s().activeOrder), orderKeyOf(B), 'unknown order cannot steal focus');

// --- re-setting the focused order keeps its stage (data refresh, not a stage reset) ------
s().updateTripStatus('REACHED_PICKUP');
s().setActiveOrder({ ...B, orderStatus: 'ready_for_pickup' });
assert.equal(s().tripStatus, 'REACHED_PICKUP');
assert.equal(s().activeOrders.length, 2, 'refreshing an order must not duplicate it');

// --- delivering the focused order promotes the next held order ---------------------------
s().updateTripStatus('COMPLETED');
s().clearActiveOrder();
assert.equal(s().activeOrders.length, 1);
assert.equal(orderKeyOf(s().activeOrder), orderKeyOf(A), 'order A is promoted');
assert.equal(s().tripStatus, 'PICKED_UP', 'order A resumes exactly where it was left');
assert.equal(s().tripStatusByOrder[orderKeyOf(B)], undefined, 'the finished order leaves no state');

// --- delivering the last order returns the rider to idle ---------------------------------
s().clearActiveOrder();
assert.equal(s().activeOrders.length, 0);
assert.equal(s().activeOrder, null);
assert.equal(s().tripStatus, 'IDLE');
assert.deepEqual(s().tripStatusByOrder, {});

// --- a server sync keeps the order the rider is looking at -------------------------------
reset();
s().setActiveOrders([A, B]);
s().focusOrder(orderKeyOf(B));
s().updateTripStatus('PICKED_UP');
s().setActiveOrders([A, B]);
assert.equal(orderKeyOf(s().activeOrder), orderKeyOf(B), 'a background refresh must not yank focus');
assert.equal(s().tripStatus, 'PICKED_UP');

// --- a sync that drops the focused order re-focuses what is left -------------------------
s().setActiveOrders([A]);
assert.equal(s().activeOrders.length, 1);
assert.equal(orderKeyOf(s().activeOrder), orderKeyOf(A));
assert.equal(s().tripStatusByOrder[orderKeyOf(B)], undefined, 'stale per-order stage is dropped');

// --- an empty sync clears everything (no stale order gets promoted) ----------------------
s().setActiveOrders([A, B]);
s().setActiveOrders([]);
assert.equal(s().activeOrders.length, 0);
assert.equal(s().activeOrder, null);
assert.equal(s().tripStatus, 'IDLE');

// --- cancelling one stacked order leaves the other alone --------------------------------
reset();
s().setActiveOrders([A, B]);
s().focusOrder(orderKeyOf(A));
s().removeActiveOrder(orderKeyOf(B));
assert.equal(s().activeOrders.length, 1);
assert.equal(orderKeyOf(s().activeOrder), orderKeyOf(A), 'focus is untouched when another order dies');

// --- cancelling the focused order promotes a survivor ------------------------------------
reset();
s().setActiveOrders([A, B]);
s().focusOrder(orderKeyOf(A));
s().removeActiveOrder(orderKeyOf(A));
assert.equal(s().activeOrders.length, 1);
assert.equal(orderKeyOf(s().activeOrder), orderKeyOf(B));

// --- removing something not held is a no-op ---------------------------------------------
reset();
s().setActiveOrders([A]);
s().removeActiveOrder(orderKeyOf(C));
assert.equal(s().activeOrders.length, 1);

// --- capacity gate ----------------------------------------------------------------------
reset();
// No capacity payload seen yet: fall back to the default of 2 so a first-load race cannot
// hide a real offer.
assert.equal(s().canStackAnotherOrder(), true);
s().setActiveOrders([A]);
assert.equal(s().canStackAnotherOrder(), true);
s().setActiveOrders([A, B]);
assert.equal(s().canStackAnotherOrder(), false, 'two orders in hand = no third offer');

// The backend is authoritative and also counts Quick Commerce jobs the food list never shows.
reset();
s().setActiveOrder(A);
s().setOrderCapacity({ maxConcurrentOrders: 2, ordersInHand: 2 });
assert.equal(
  s().canStackAnotherOrder(),
  false,
  'a QC job the food list cannot see still fills the slot',
);

// Admin raising the limit takes effect immediately.
s().setOrderCapacity({ maxConcurrentOrders: 3, ordersInHand: 2 });
assert.equal(s().canStackAnotherOrder(), true);

// A stale low count never outvotes what we can see locally.
s().setActiveOrders([A, B]);
s().setOrderCapacity({ maxConcurrentOrders: 2, ordersInHand: 0 });
assert.equal(
  s().canStackAnotherOrder(),
  false,
  'locally held orders win over a stale server count',
);


// --- order_claimed matching: offer card id vs accept-time claim id ----------------------
// Regression test for the bug where another rider's offer popup never closed when someone
// else accepted. buildDeliverySocketPayload (the offer card payload) sets `orderId` to the
// human-readable order number (order.order_id), while the backend's 'order_claimed' broadcast
// on accept always sends the Mongo _id as `orderId`. A naive `incomingOrder.orderId ||
// incomingOrder._id` picks the human number first and it never equals the Mongo id, so the
// card stayed up forever. orderAliasesOf must surface BOTH so a membership check catches it.
{
  const offerCard = {
    // No top-level _id on an offer payload - only these two.
    orderMongoId: 'mongo000000000000000001',
    orderId: 'FO-10234', // human-readable order number, NOT the Mongo id
  };
  const claimedOrderId = 'mongo000000000000000001'; // backend always sends the Mongo id here

  const aliases = orderAliasesOf(offerCard);
  assert.ok(
    aliases.includes(claimedOrderId),
    'the offer card must be recognised as the claimed order via its Mongo id alias',
  );
  // The bug, demonstrated: the old priority-pick comparison would have missed this.
  const buggyPick = offerCard.orderId || offerCard._id || offerCard.orderMongoId;
  assert.notEqual(
    String(buggyPick),
    claimedOrderId,
    'sanity check: the old orderId-first comparison really did not match',
  );
}

reset();
console.log('useDeliveryStore: all assertions passed');
