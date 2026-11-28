# Quick Commerce (Marketplace) Returns - full flow + deep audit

Scope: customer, seller, rider (driver) and admin, for every order type. Based on a line-by-line read of the backend (`modules/quick-commerce/**`, `core/**`) and the three web panels. Live production data was **not** inspected (no DB access was used), so the audit is code-level.
Base URL `https://sooperbuddy.in/api/v1`.

---

## 0. TL;DR (read this first)

| # | Finding | Severity |
|---|---|---|
| 1 | **The rider (driver) part of a return is not connected.** The code that lets a rider accept the pickup, reach the customer, verify the customer OTP, upload photos, reach the seller and verify the seller OTP exists (`returnPickupDelivery.service.js`) but **no route, controller or driver-app screen calls it**, and the dispatcher (`tryAutoAssign`) only understands Food orders, so a return id never finds a rider. | **Blocker** |
| 2 | Because of #1 a return stops at `return_pickup_assigned`. The only code that sets `returned` is the unconnected rider service, so **no return can currently reach `returned`, quality check or refund through the normal path**. The admin "Quality Pass & Refund" button is shown only for `returned`. | **Blocker** |
| 3 | The back-end admin API `POST /quick-commerce/admin/returns/:id/quality-pass` accepts `{ "force": true }`, which skips the `returned` check and pays the refund. That is the only way to finish a return today (API call only, not in the admin UI). | Workaround |
| 4 | Everything before the rider works: request, eligibility (per-product window), refund calculation, seller approve/reject, OTP generation, rider earning calculation, cancel. Everything after the rider works (refund to wallet, seller clawback, stock restore, ledger) once a return is `returned` or forced. | OK |
| 5 | A customer gets **one return per order, ever**. After a rejection or cancellation the same order cannot be returned again (`RETURN_ALREADY_EXISTS`). The "re-open / partial second return" helper exists in code but is not used. | Policy gap |
| 6 | No timeouts: a return waits forever for the seller to approve/reject, and for a rider. No auto-approve/escalate/cancel job. | Gap |
| 7 | Refund is **always to the customer wallet**, for every payment method (online, wallet, COD). UPI/bank payout is retired in the request but its admin code still exists. | By design |
| 8 | Delivery fee, platform fee and packing fee are **never refunded**; GST (tax) share is refunded; the coupon share is deducted. | By design |

Recommended fix order: (1) wire the rider side + make the dispatcher understand returns, (2) add an admin "force complete" / reject / reassign in the UI, (3) seller-response timeout, (4) allow a fresh return after rejection if the business wants it.

---

## 1. Which orders can be returned

| Order type | Returnable? | Notes |
|---|---|---|
| Food (restaurant) | **No** | No return concept; food uses cancellation + item ratings only. |
| Marketplace / Quick (`orderType: quick`) | **Yes** | The normal case. |
| Mixed (`mixed`: food + marketplace in one order) | **Yes, marketplace lines only** | `getQuickItemsFromOrder` keeps only lines with `type: quick`; food lines can never be selected. |
| Taxi (rides, parcel) | **No** | Taxi has cancel + feedback, no returns. |
| Scheduled marketplace orders | Yes | Same as normal once delivered. |

Common rules (`loadReturnEligibleOrder`):
- The order must belong to the logged-in customer and be **delivered** (`orderStatus = delivered` or workflow `DELIVERED`).
- **Payment method does not matter** (online/Razorpay, wallet, COD cash + advance all qualify). There is no check that the order was actually paid.
- **One seller per return**: an order with items from several sellers is rejected (`"This order contains items from multiple sellers. Returns are supported for one seller per order."`).
- **Return window is per product**, taken from its **Header Category** (admin -> Categories): `returnsEnabled` (on/off) and `returnWindowHours` (default **72 h**), counted from the delivery time. The window value stored on the order line at purchase time (snapshot) wins over the live category value. If every line is disabled -> `RETURNS_DISABLED`; if every enabled line has expired -> `RETURN_WINDOW_EXPIRED`; a request containing an expired/disabled product is refused for that product.
- Delivery time = `deliveryState.deliveredAt`, else the latest seller-leg `deliveredAt`, else the order `updatedAt`.

---

## 2. Statuses

`returnStatus` (on `SellerReturn`, mirrored to the parent order `returnStatus`):

| Status | Meaning | Set by |
|---|---|---|
| `return_requested` | Customer asked | customer |
| `return_approved` | Seller accepted (OTPs created, pickup fee calculated) | seller |
| `return_rejected` | Seller refused (terminal) | seller |
| `return_pickup_assigned` | Pickup dispatch started / waiting for a rider | system (right after approve) |
| `return_in_transit` | A rider accepted | rider (not connected, see 0) |
| `returned` | Seller received the goods (seller OTP verified) | rider (not connected) |
| `refund_completed` | Customer refunded (terminal) | system/admin |
| `return_cancelled` | Customer cancelled (terminal) | customer |

Other fields: `refundStatus` (`none`, `pending`, `processing`, `completed`, `failed`), `dispatch.status` (`unassigned`, `assigned`, `accepted`, `rejected`, `cancelled`, `completed`), `deliveryState.currentPhase` (`en_route_to_pickup`, `at_pickup`, `en_route_to_delivery`, `at_drop`, `completed`), `qualityCheck.status` (`pending`, `passed`), `returnHistory[]` (who/what/when audit trail) and `refundAuditLog[]`.

Active statuses (block a new request and block order-level actions): requested, approved, pickup_assigned, in_transit, returned. Terminal: rejected, refund_completed, cancelled.

```
return_requested --seller approve--> return_approved --(auto)--> return_pickup_assigned
        |                                                         |  rider accepts (NOT WIRED)
        |--seller reject--> return_rejected                       v
        |--customer cancel (requested/approved/pickup_assigned)--> return_cancelled
                                                           return_in_transit
                                                                  | seller OTP at drop (NOT WIRED)
                                                                  v
                                                               returned
                                                                  | auto QC pass / admin QC pass
                                                                  v
                                                          refund_completed (wallet credit)
```

---

## 3. Customer flow (web + app)

### 3.1 APIs (all need the customer Bearer token)
| Action | Request |
|---|---|
| Create return | `POST /quick-commerce/orders/{orderId}/returns` body `{ reason, items:[{itemId, quantity}], pickupImages?:[url], refundMethod?, payoutDetails? }` |
| Status / eligibility | `GET /quick-commerce/orders/{orderId}/returns` |
| Pickup OTP | `GET /quick-commerce/orders/{orderId}/returns/pickup-otp` |
| Cancel | `POST /quick-commerce/orders/{orderId}/returns/cancel` body `{ reason? }` |

`orderId` may be the order number or the Mongo id.

### 3.2 Creating a return - rules and errors
- `reason` >= 3 characters (the web page offers: wrong item, damaged/defective, quality not as expected, missing items, changed my mind, other).
- `refundMethod` is **ignored**: the server forces `wallet`.
- `items[].itemId` is `productId` or `productId::variantName` (variant orders **must** use the variant key; otherwise `variantName is required when this product has multiple variants`). `quantity` defaults to the remaining quantity; must be whole, > 0 and <= remaining returnable quantity. Duplicate lines are dropped.
- `pickupImages` (customer photos of the damaged item): max 8 URLs kept. Upload the photos first with the normal upload API.
- Errors (HTTP 400/403/404/409, always `{success:false, message, code?}`): `Return reason must be at least 3 characters`, `Returns can only be requested for delivered orders`, `RETURNS_DISABLED`, `RETURN_WINDOW_EXPIRED`, `Item ... has no remaining returnable quantity`, `Return quantity ... cannot exceed remaining returnable quantity (n)`, multi-seller error above, `RETURN_ALREADY_EXISTS` (409).
- Idempotency: if an **active** return already exists the API answers `200` with `alreadyExists:true` and the existing return (no duplicate). If an existing one is terminal (rejected / cancelled / refunded) -> `RETURN_ALREADY_EXISTS` (so no second attempt, see finding 5).
- On success `201 { returns:[...] }`: the parent order `returnStatus = return_requested`, a realtime status event is emitted and **the seller gets an inbox notification** ("Return request received"). Admin is **not** notified.

### 3.3 What the customer sees
`GET .../returns` returns the return(s) plus eligibility: `canReturn`, `returnWindowHours`, `returnExpiryAt`, `remainingSeconds`, per-item `itemEligibility`, and for each return `returnStatus`, `refundStatus`, `returnRefundAmount`, `returnItems[]` (qty, `refundAmount`, `couponShare`, `taxShare`), `timelineSteps` (Requested -> Approved -> Pickup Assigned -> Rider Coming -> Picked Up -> Reached Seller -> Quality Check -> Refund Processing -> Refund Completed), the pickup-OTP card and the dispatch/lifecycle label. The customer is pushed a notification on **approve / reject** only (with the rejection reason). There is no push when a rider is assigned or when the refund is credited (only the realtime status event on the order).

### 3.4 Pickup OTP
`GET .../returns/pickup-otp` is available only while status is approved / pickup_assigned / in_transit. The customer reads this 4-digit OTP to the rider at pickup. OTP validity **4 hours** from approval; after that: `Return pickup OTP has expired. Contact support or the seller.` There is **no endpoint to regenerate** an expired OTP (only re-requesting pickup when the seller OTP is empty re-stamps both).

### 3.5 Cancel
Allowed only in `return_requested`, `return_approved`, `return_pickup_assigned`. Once a rider has accepted (`return_in_transit`) the customer cannot cancel. Cancelling sets the return to `return_cancelled`, closes any open rider offer, and (if no other active return) sets the parent order to cancelled-return. A cancelled return **cannot be re-requested**.

---

## 4. Money: how the refund amount is calculated
(`returnRefundCalculation.helpers.js`, all in paise-exact arithmetic)

For each returned line: `gross = unit price x returned qty`.
Coupon and tax of the order are shared by value: `couponShare = min(remaining coupon, gross / items-subtotal x order coupon)`, `taxShare` likewise (if **all remaining items** are returned, the full remaining coupon/tax is used, so totals match exactly). Distribution between lines uses largest-remainder rounding so the paise always add up.

```
line refund   = gross - couponShare + taxShare
return refund = sum(line refund)            (capped at what the customer actually paid and has not been refunded yet)
```
- **Not refunded:** delivery fee, platform fee, packing/handling fee (`deliveryFeeRefunded = 0`, `platformFeeRefunded = 0`).
- Paid total = `pricing.total` (fallback `payment.amountDue`, else subtotal+fees+tax-discount). Cap = paid total - already refunded.
- Refund money always goes to the **customer wallet** (`refundWalletBalance`, idempotent with transaction id `qc_return_<returnId>_wallet`).
- COD orders: the customer paid cash to the rider on the original delivery; the return refund still goes to the wallet (no cash handling in the return).

---

## 5. Seller flow (seller panel + seller app)

APIs (seller token, `/seller/...`): `GET /seller/returns`, `PUT /seller/returns/{orderId}/approve`, `PUT /seller/returns/{orderId}/reject` body `{ reason }`, `POST /seller/returns/{orderId}/request-pickup`.

- `GET /seller/returns` returns all returns of this seller (newest first), enriched with order context, customer, items, refund amount, dispatch state and the **seller OTP** (the seller shows this OTP to the rider when the goods are dropped back).
- **Approve** (only from `return_requested`; any other state is a silent no-op): status -> `return_approved`; customer + seller OTPs (4 digits, 4 h, max 5 wrong attempts) are created; **pickup distance and rider earning are calculated** (road distance customer -> seller, using Billing delivery slabs); the customer is notified; then pickup dispatch starts in the background and the status becomes `return_pickup_assigned`. The API answers immediately with `pickupDispatch.pending = true` (it does not wait for the rider search).
- **Reject**: status -> `return_rejected`, reason saved and sent to the customer. Terminal; no refund; no admin review step.
- **Request / retry pickup**: allowed in `return_approved` and `return_pickup_assigned` while no rider has accepted. Tries to offer the job to online riders; errors `No online delivery partners available for return pickup`, `No nearby eligible delivery partners found for return pickup` (HTTP 422). The web page shows a "Retry Dispatch" button for this.
- Seller **cannot** edit items, change the refund amount, or inspect/quality-check goods; quality check is automatic on rider completion or by admin.

### Seller money impact (when the refund completes)
`applyReturnSellerFinance` (idempotent, runs once):
1. **Clawback** = seller's product earnings for the returned share (`productEarnings x returnedGross / orderSubtotal`). The **packing fee stays with the seller**; commission recorded at sale is kept for reporting; GST/platform fee stay on the admin side.
2. If the seller has not withdrawn earnings yet (unwithdrawn credits) the clawback is deducted from those ("pre-settlement"); the rest is posted as a negative ledger entry `RETURN_REFUND` ("post-settlement", wallet can go negative; shown in admin Return Finance Report as negative-balance sellers/pending recoveries). Mode is stored in `finance.settlementMode` = `pre_settlement | post_settlement | mixed`.
3. Seller order receivable / subtotal / total are reduced accordingly; stock of the returned items is **added back** (`restoreReturnItemsStockOnce`, once only).
4. The **rider pickup fee is paid by the platform**, not debited from the seller (`adminPickupFeeCharged` is recorded for admin accounting).

---

## 6. Rider (driver) flow - intended design vs. reality

### 6.1 Intended design (code exists in `returnPickupDelivery.service.js`, `returnPickup.helpers.js`, `returnDispatch.adapter.js`)
1. Return approved -> offer sent to online approved riders (socket event `new_order_available` with `documentType: seller_return`, `tripType: return_pickup`, title "Return Pickup", rider earning, distance, customer address as pickup point, seller shop as drop point, items, note = return reason). Other riders get `order_claimed` when someone accepts.
2. Rider **accepts** (atomic claim, status -> `return_in_transit`, Firebase live tracking created) or **rejects** (job re-offered).
3. **Reached customer** (`at_pickup`).
4. **Confirm pickup**: rider enters the **customer OTP** (max 5 attempts, 4 h) and uploads **1-8 pickup photos** (required) -> `picked_up`.
5. **Reached seller** (`at_drop`; only after pickup).
6. **Complete**: rider enters the **seller OTP** (and photos must exist) -> `returned`, `dispatch.status = completed`, tracking removed, **rider wallet credited** with the pickup earning (category `delivery_earning`, once per return, idempotent), and the **quality check + refund is run automatically** (`passReturnQualityCheckAndRefund`, note "Auto quality pass after rider return pickup completion").
Rider history lines are written to `returnHistory` (`RETURN_PICKUP_ACCEPTED`, `RETURN_REACHED_CUSTOMER`, `RETURN_PICKED_UP`, `RETURN_REACHED_SELLER`, `RETURN_PICKUP_COMPLETED`).

### 6.2 What is actually deployed (audit result)
- None of these functions are imported by any route/controller (`grep` shows the file is only referenced by itself), the rider REST routes in `food/delivery/routes/delivery.routes.js` (`/delivery/orders/...`) work on **Food orders only**, and the web driver app (`DeliveryV2`) and the shared helper `isReturnPickupTrip` have no return screens (the helper is not used anywhere).
- `tryAutoAssign(returnId, {documentType: seller_return})` in `order-dispatch.service.js` ignores `documentType`, looks the id up in **FoodOrder**, finds nothing and returns `null`. The fallback "renotify existing offers" has no offers to renotify, so the dispatch audit says no riders were notified. Because approval dispatches in the background, **the seller sees "Return approved" while no rider is ever offered the job**.
- The project history shows the files came in one commit (`qc add`) as a port; the dispatcher comment even says "Buddy's Food dispatch doesn't have that feature".
- Result: return stays at `return_pickup_assigned` forever (customer sees "Pickup Assigned" / seller "Dispatch Failed / Waiting for Rider").

### 6.3 What must be built (checklist for backend + driver apps)
Backend:
1. Let the dispatcher accept a `SellerReturn` id (`documentType: seller_return`): select eligible online riders near the **customer** address (pickup point), write `dispatch.offeredTo`, emit `new_order_available` with `buildReturnDeliverySocketPayload`, retry like food.
2. Expose rider routes (same auth `DELIVERY_PARTNER`/`DRIVER`), for example:
   - `GET /delivery/returns/available`, `GET /delivery/returns/current`
   - `PATCH /delivery/returns/:returnId/accept`, `.../reject`, `.../reached-pickup`, `.../confirm-pickup` (body `{ otp, pickupImages[] }`), `.../reached-drop`, `.../complete` (body `{ otp }`) mapped to the existing service functions.
   - Or reuse `/delivery/orders/:orderId/...` and branch when the id is a return (`isSellerReturnDocumentId`).
3. Include returns in the rider's current-trip / earnings / trip-history responses so the app's home screen shows the job.
4. Add a timeout/re-offer job for unaccepted offers (the code has `offeredTo.action = timeout` but nothing runs it).
Rider app (Flutter + web): "Return pickup" card (earning, distance, customer + shop addresses), accept/reject, navigation to the customer, "Reached", OTP + photo screen, navigation to the shop, "Reached", seller OTP entry, complete; earning appears in the wallet.

---

## 7. Admin flow

Panel: Quick Commerce admin -> **Returns** (`AdminReturns.jsx`). APIs (admin token, `/quick-commerce/admin/...`):

| Action | Request |
|---|---|
| List | `GET /returns?page=&limit=&status=&search=&sellerId=` (search: order id, customer name/phone) |
| Detail | `GET /returns/{returnId}` (id or order id) with customer, pricing, items, history, finance, pickup photos |
| Quality pass + refund | `POST /returns/{returnId}/quality-pass` body `{ notes?, force? }` |
| Refund (UPI/bank legacy) | `POST /returns/{returnId}/refund` body `{ note?, payoutReference? }` (only when status is `returned`) |
| Confirm payout (UPI/bank legacy) | `POST /returns/{returnId}/confirm-payout` body `{ payoutReference?, note? }` |
| Finance report | `GET /finance/returns/report` (negative-balance sellers, pending recoveries, recovery summary, pending payouts) |

UI buttons: **Quality Pass & Refund** (visible only when `returnStatus = returned`), **Confirm Payout** (visible only when `refundStatus = pending`), **Process Refund** (only non-wallet returns). Because no return reaches `returned` today (finding 2), these buttons never appear; admin currently can only view.

Admin policy settings: return on/off and window hours per **Header Category** (Categories page); delivery/rider earning slabs in **Billing** (used for the return pickup fee).

Admin can **not** today: reject a return, approve on behalf of a seller, reassign/force a rider, mark returned, cancel a return, or change the amount. Admin gets no notification when a return is requested.

### 7.1 Quality pass + refund (`passReturnQualityCheckAndRefund`)
1. Requires `returned` (unless `force: true`). If already passed + refunded -> `alreadyProcessed`.
2. Marks `qualityCheck.status = passed` (who/when/notes).
3. `executeReturnCustomerRefund`: atomic lock (`refundStatus = processing`), wallet credit, `refundStatus = completed`, `returnStatus = refund_completed`, cumulative returned quantities written (so a partial-return history is correct), parent order `payment.refund` synced (order becomes `refunded` only when the whole paid amount is refunded; otherwise stays `paid` with a refund block).
4. Seller finance + stock restore (section 5).
All steps are idempotent (double click / retry safe); a wallet credit interrupted mid-way is recovered when the call is repeated.

---

## 8. End-to-end timeline (target behaviour, with who does what)

| Step | Actor | Result |
|---|---|---|
| 1 | Customer | Selects items/qty + reason (+ photos) -> `return_requested`; seller notified |
| 2a | Seller | Approve -> OTPs + rider fee calculated, customer notified, dispatch starts (`return_pickup_assigned`) |
| 2b | Seller | Reject -> `return_rejected` (end) |
| 2c | Customer | Cancel before a rider accepts -> `return_cancelled` (end) |
| 3 | Rider **(not wired)** | Accept -> `return_in_transit` |
| 4 | Rider **(not wired)** | At customer: customer OTP + photos -> picked up |
| 5 | Rider **(not wired)** | At seller: seller OTP -> `returned`, rider paid |
| 6 | System / Admin | Quality pass -> wallet refund (`refund_completed`), seller clawback, stock back |

---

## 9. Detailed audit findings

### Critical
1. **Rider side unwired** (section 6). Impact: every approved return is stuck; customers wait, sellers see "Dispatch failed".
2. **Dispatcher ignores returns** (`tryAutoAssign` is Food-only) - covered by the same fix.
3. **No admin recovery path in the UI** for a stuck return; the API `force` flag is hidden.

### High
4. Seller approval does not wait for dispatch; the API returns success even when no rider exists (the 422 branch in `approveSellerReturnController` can never fire because the approve path always returns `pending: true`).
5. One return per order forever (no re-request after reject/cancel); the `resetReturnDocForNewCycle` function is dead code. Partial returns in several rounds are also impossible in practice (the second request is blocked), although the refund maths supports cumulative returns.
6. No SLA timers: seller never responds -> return open forever; no escalation to admin; no auto-cancel of an unaccepted pickup; the customer OTP expires after 4 h with no way to regenerate.
7. Admin not notified of new returns/failed dispatch; customer not pushed for pickup assigned/refund credited.

### Medium
8. COD/unpaid edge: returns are allowed on any delivered order, refund capped by `pricing.total`; for a COD order the customer paid cash, refund goes to the wallet (policy decision to confirm with the business).
9. Wrong-OTP lock (5 attempts) has no unlock for support.
10. Seller can approve then the rider fee is fixed from the distance at approval; if Billing slabs yield zero, the rider is paid 0 (only a log warning).
11. `GET /seller/returns` returns **all** returns unpaginated.
12. Admin list `search` uses unescaped user text in a RegExp (regex injection / slow query risk) - escape it.
13. Request-level `refundMethod`/`payoutDetails` are still accepted and stored in history although ignored.
14. Legacy admin endpoints for UPI/bank payouts are alive but unreachable from the UI flow.

### Low
15. `return_in_transit` is set when the rider **accepts** (label "Rider Coming"), not when goods are picked up (picked-up is tracked in `deliveryState`). Frontends already handle this via `timelineSteps`.
16. Firebase live tracking uses the order id as key (`active_orders/<orderId>`) and may overwrite the original delivery tracking node of the same order (already delivered, so harmless).

---

## 10. QA checklist (run after the rider side is built)
1. Delivered marketplace order, item with returns enabled -> request return with 1 of 2 qty -> refund amount = price x qty - coupon share + GST share; delivery/platform/packing not included.
2. Product with `returnsEnabled=false` -> `RETURNS_DISABLED`; after the window -> `RETURN_WINDOW_EXPIRED`; food-only order -> no return button; mixed order -> only marketplace lines selectable; two-seller order -> refused.
3. Second request while one is active -> `alreadyExists:true` (no duplicate); after cancel/reject -> `RETURN_ALREADY_EXISTS` (current behaviour).
4. Seller approve -> customer gets OTP, rider offer arrives, seller sees status; reject -> customer notified with reason.
5. Rider accepts (second rider sees order claimed), customer OTP wrong 5x -> locked; correct + photos -> picked up; seller OTP -> `returned`; rider wallet +earning once.
6. After `returned`: refund credited once (retry the API -> `alreadyProcessed`), seller ledger shows `RETURN_REFUND` or reduced credits, stock increased once, order payment shows refund.
7. Customer cancel works before rider accept, refused after.
8. Admin list/filter/search/detail; Quality Pass button appears for `returned`; finance report numbers match ledger.
9. Wallet-paid, online-paid and COD orders each refund to wallet.
10. Rider app shows return jobs in current trip / earnings / history.
