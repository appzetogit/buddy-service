# COD (advance) + Rider Cash Limit + Cash Deposit - complete guide for the Flutter team

Base URL: `https://sooperbuddy.in/api/v1`. All endpoints below are **live**. Admin panel and web apps already work; this document lists what the **native Flutter apps** must implement.

Apps covered:
- **User app** (Food, Marketplace/Quick-commerce, Taxi): show COD, pay the advance, show amounts, cancel.
- **Rider / driver app** (one unified rider account for Food + Marketplace + Taxi): cash to collect, cash in hand, limit, blocked state, deposit, history, service filter.
- **Restaurant app / Seller app**: show COD info on orders.

Always take amounts from the API. Never compute them on the client.

---------------------------------------------------------------------

## PART A - CASH ON DELIVERY (COD) WITH ADVANCE

### A1. How it works (one minute)
1. Admin turns COD **on/off per service** (Food, Marketplace, Taxi - any one, two or all) and sets an **advance %** for each. COD is **off by default**.
2. If COD is off for a service, the COD option must **not** appear in that service's checkout.
3. If on, checkout shows **Cash on Delivery** next to Online and Wallet.
4. The customer pays only the **advance** now. The **remaining** is paid in **cash** to the rider/driver after delivery / at the end of the ride.
5. The advance is paid **online through Razorpay by default**. The wallet is used **only if the customer ticks "use wallet"** (`useWallet: true`). If the wallet is ticked but has too little money, the wallet pays what it can and Razorpay pays the rest.
6. If the order/ride is **cancelled**, the advance returns to the customer's **wallet only** (never back to Razorpay).

Example: 20% advance on a Rs 500 bill = Rs 100 now (Razorpay), Rs 400 in cash.

### A2. Admin settings (web only - Flutter does not build this)
Admin panel: *Food -> Payment Settings -> Cash on Delivery*.
- `GET /common/admin/cod-settings` and `PUT /common/admin/cod-settings` with `{ "food": {"enabled":true,"advancePercent":10}, "quickCommerce": {...}, "taxi": {...} }`.

### A3. Which payment options to show (all three services)
`GET /common/payment-options?service=food|quickCommerce|taxi&total=<bill amount>` (public, no token)
```json
{ "service":"food", "online":{"enabled":true}, "wallet":{"enabled":true},
  "cod":{ "enabled":true, "advancePercent":20,
          "split":{ "total":500,"percent":20,"advanceAmount":100,"remainingAmount":400 } } }
```
- Show the COD row **only if `cod.enabled == true`**.
- Subtitle: `Pay Rs {advanceAmount} now, Rs {remainingAmount} on delivery` (Taxi: "after the ride").
- `split` is returned only when you pass `total`. **Call again whenever the bill changes** (coupon, tip, delivery fee, vehicle change).
- Wallet toggle for COD: **default OFF**. Label example: "Use wallet balance for the advance".
- COD is for **delivery** orders only (not self-pickup).
- The server can still refuse COD for a specific customer. Show the error message from the API.

### A4. Placing the order / booking
Rule for all three services: if nothing has to be paid online (advance is 0, or the wallet covers it and `useWallet:true`), the order is created immediately. **Otherwise the response contains Razorpay data for the advance only. Open Razorpay, then call the verify API. The order/ride is created only after verify succeeds.**

#### Food
`POST /food/orders` - same body as today, with `"paymentMethod": "cod"` and `"useWallet": true|false`.
- Created now: `{ order, paymentType:"COD", codAdvance:{total,percent,advanceAmount,remainingAmount}, requiresPayment:false }`.
- Online part needed: `{ requiresPayment:true, checkoutId, codAdvance, walletAmount, onlineAmount, razorpay:{ key, orderId, amount (paise), currency } }`.
  Open Razorpay with `razorpay.amount` (this is the **advance only**), then:
  `POST /food/orders/verify-payment { checkoutId, razorpayOrderId, razorpayPaymentId, razorpaySignature }`. The order is created by verify.

#### Marketplace (Quick-commerce)
`POST /quick-commerce/orders` with `"paymentMode": "COD"` and optional `"useWallet": true|false`.
- Created now: `201 { success, result: order }`.
- Online part: `201 { requiresPayment:true, checkoutId, amount:<advance>, total, walletAmount, onlineAmount, cod:{percent,advanceAmount,remainingAmount}, razorpay:{ key, orderId, amount, currency }, expiresAt, result:null }`.
  After payment: `POST /quick-commerce/checkout/verify-payment { checkoutId, razorpay_order_id, razorpay_payment_id, razorpay_signature }` -> `{ success, result: order }`. The shop sees the order only after the advance is paid.

#### Taxi (rides)
`POST /taxi/user/rides` with `"paymentMethod": "cod"` and optional `"useWallet"`.
- Created now: `201 { data:{ ride, realtime } }` (`ride.cod` is set).
- Online part: `201 { data:{ requiresPayment:true, checkoutId, kind, percent, fare, advanceAmount, remainingAmount, walletAmount, onlineAmount, expiresAt, razorpay:{ keyId, orderId, amount, currency } } }`.
  **No ride exists and no driver search starts yet.** Pay Razorpay, then `POST /taxi/user/rides/cod-advance/verify { checkoutId, razorpay_order_id, razorpay_payment_id, razorpay_signature }` -> `201 { data:{ ride, realtime } }`, driver search starts.
  The checkout is valid ~30 minutes. If booking fails after payment the advance returns to the wallet automatically.
- Parcel: `POST /taxi/user/deliveries` with `"paymentMethod":"cod"`, verify at `POST /taxi/user/deliveries/cod-advance/verify` (same payload).
- Note the Razorpay key field name differs: Food/QC use `key`, Taxi uses `keyId`.

If the user closes Razorpay without paying, **do nothing else**: no order exists, nothing was charged.

### A5. The COD object (Food + Marketplace orders: `payment.cod`, Taxi: `ride.cod`)
```json
"payment": { "method":"cash", "status":"cod_pending", "amountDue": 496 },
"cod": { "enabled":true, "percent":20,
         "advanceAmount":124, "advanceWalletAmount":0, "advanceOnlineAmount":124,
         "remainingAmount":496,
         "advanceStatus":"paid",            // none | paid | refunding | refunded
         "refundedAmount":0, "refundedAt":null,
         "collectedAmount":0, "collectedAt":null }
```
- `payment.status`: `cod_pending` until the cash is collected, then `paid`.
- `payment.amountDue` = remaining cash to collect.
- Taxi: `ride.paymentMethod = "cash"`, `ride.cod`, `ride.amountDue` / `amountToCollect`.

### A6. What the USER app must show (order details, tracking, ride receipt)
| Situation | Text to show |
|---|---|
| Payment method | "Cash on Delivery (advance + cash)" |
| Advance paid | "Paid in advance: Rs {advanceAmount} (Wallet Rs {advanceWalletAmount} + Online Rs {advanceOnlineAmount})" |
| Not delivered yet | "To pay in cash on delivery: Rs {remainingAmount}" |
| Delivered / ride complete | "Paid in cash on delivery: Rs {collectedAmount}" |
| Cancelled (`advanceStatus == "refunded"`) | "Advance Rs {refundedAmount} refunded to your wallet" |
| Cancelled (`advanceStatus == "paid"` or `"refunding"`) | "Your advance will be refunded to your wallet shortly" |

Checkout summary also shows: Total, "Pay now (advance) Rs X", "Pay on delivery Rs Y".

### A7. Cancel
No new API. Existing cancel endpoints (`PATCH /food/orders/{id}/cancel`, QC cancel, taxi cancel) refund the advance to the **wallet** automatically:
- User cancels: instantly.
- Any other path (admin cancel, restaurant/seller reject, no driver found): within about 30 seconds.
- The same advance is **never refunded twice**.
After a cancel: refresh the wallet and show "Your advance of Rs X has been credited to your wallet."
- **Taxi:** the existing cancellation fee (admin configured) still applies and is taken from the advance first. A cancelled ride can therefore return less than the advance.

### A8. Taxi final fare
The fare can change by the end of the ride. The driver collects `finalFare - advance` (never negative). If the final fare is lower than the advance, the difference goes back to the customer's wallet automatically. Show the final split on the ride-complete screen.

---------------------------------------------------------------------

## PART B - RIDER / DRIVER APP

One rider account serves Food, Marketplace and Taxi. All cash numbers are **combined** across the three services (one limit, one cash in hand, one deposit).

### B1. Cash to collect on a job
- Food / Marketplace: `payment.amountDue` = **remaining** only.
- Taxi: `amountToCollect` / `amountDue` = remaining (= final fare - advance).
- Show: "Cash to collect Rs R" and a small note "Order total Rs T - Rs A already paid in advance".
- The existing delivery-complete flow (cash or QR for the remaining amount) is unchanged. Collect **only the remaining**, not the full bill.
- Prepaid orders: nothing to collect.

### B2. Cash summary (Pocket / Wallet screen + home banner)
`GET /food/delivery/cash-summary` (rider token)
```json
{ "data": { "summary": {
  "limit": 5000,              // 0 = admin has not set a limit (no cap)
  "cashInHand": 3200.5,       // collected - deposited
  "pendingCash": 400,         // cash on jobs accepted but not yet delivered
  "available": 1399.5,        // limit - cashInHand - pendingCash, null when limit == 0
  "blocked": false,           // true when cashInHand >= limit
  "deposited": 1000,
  "lastDepositAt": "2026-11-23T10:00:00.000Z",
  "byService": {
    "food":          { "collected": 1200, "pending": 0,   "orders": 5 },
    "quickCommerce": { "collected": 500,  "pending": 0,   "orders": 2 },
    "taxi":          { "collected": 1500.5,"pending": 400, "orders": 4 } } } } }
```
**Important:** the figures are wrapped in `data.summary` (not directly in `data`).

UI:
- Big number: cash in hand. Below: "Limit Rs X - Available Rs Y" (if `limit == 0` show "No cash limit set").
- Progress bar `(cashInHand + pendingCash) / limit` (hide when limit is 0). Colour: green < 80%, amber 80-100%, red when blocked.
- Three chips: Food / Marketplace / Taxi with `byService.*.collected` (and "+ Rs N pending" when `pending > 0`).
- If `blocked == true`: red banner "Cash limit reached. Deposit your cash to get new orders." and a **Deposit cash** button (also on the home screen).
- Refresh this summary after: delivery complete, ride complete, deposit success, and on app resume.

### B3. Cash limit (what the backend enforces)
The admin sets one **global** limit (Food admin -> *Rider Cash Limit*). It applies to **Food, Marketplace and Taxi**:
- `cashInHand >= limit` -> the rider gets **no new order or ride of any kind** (even prepaid) until they deposit.
- Below the limit, a **cash/COD job** needs headroom: `available >= cash to collect`. Otherwise it is not offered/accepted.
- An **admin-assigned** taxi ride is exempt.
- Only the **remaining cash** counts for COD jobs, not the advance.
When accept is refused the API returns an error message (Marketplace `reason: "CASH_LIMIT"`, Taxi/Food: error text "Deposit your cash to get new orders." or "Your cash limit is not enough for this order. Deposit your cash to get new orders."). Show it in a dialog with a **Deposit now** button.
`GET /food/delivery/cash-limit` returns the raw settings (`deliveryCashLimit`, `deliveryWithdrawalLimit`) if you only need the number.

### B4. Deposit cash (online, Razorpay)
The rider pays cash-in-hand **to the company online**. One combined amount for all services (not per service). Allowed amount: Rs 1 up to `cashInHand` (cannot exceed cash in hand, max Rs 5,00,000). Default amount in the UI = full `cashInHand`.

1. `POST /food/delivery/wallet/deposit/order` body `{ "amount": 3200.5 }`
   -> `201 { data:{ razorpay:{ key, orderId, amount (paise), currency:"INR" } } }`
   A **Pending** deposit is created on the server at this point.
2. Open Razorpay Checkout with `key`, `orderId`, `amount`.
3. On success call `POST /food/delivery/wallet/deposit/verify`
   body `{ "razorpay_order_id": "...", "razorpay_payment_id": "...", "razorpay_signature": "...", "amount": 3200.5 }`
   -> `200 { data:{ deposit, wallet } }`. The server checks the signature **and** asks Razorpay that exactly this amount was captured. Then the deposit becomes **Completed** and cash in hand drops immediately.
4. After success: refresh `cash-summary`, show "Rs X deposited", close the sheet. If the rider was blocked they start receiving orders again.
5. If payment fails or verify fails: the deposit stays **Failed/Pending**, cash in hand does **not** change. Show the error and allow retry (a new order id is created on retry).
6. If the app dies before verify, Razorpay's webhook completes the deposit on the server - on next open, just refresh the summary.
Idempotent: calling verify twice for the same payment never double-counts.

Errors to show as-is: "Deposit amount cannot exceed cash in hand", "Amount must be at least Rs 1", "Payment verification failed".

### B5. Deposit history
`GET /food/delivery/wallet/deposits?status=Pending|Completed|Failed&page=1&limit=20`
```json
{ "data": { "deposits":[ { "id":"...","amount":3200.5,"method":"razorpay","status":"Completed",
                           "razorpayOrderId":"order_x","razorpayPaymentId":"pay_x","note":"","createdAt":"..." } ],
            "totals": { "completedAmount":4200.5,"completedCount":2,"pendingCount":0,"failedCount":1 },
            "pagination": { "page":1,"limit":20,"total":3,"pages":1 } } }
```
Show a "History" list: amount, date/time, method, status chip (Completed green, Failed red, Pending amber).

### B6. Service filter (Food / Marketplace / Taxi / All)
Add a filter on **Trip history, Earnings and Pocket details**: `?service=food|quickCommerce|taxi` (omit for All). Accepted aliases for Marketplace: `quickCommerce`, `quick`, `qc`, `marketplace`.
- `GET /food/delivery/trip-history?period=...&service=taxi`
- `GET /food/delivery/earnings?...&service=food`
- `GET /food/delivery/pocket-details?...&service=quickCommerce`

Each trip row now has these extra fields:
```json
{ "service":"food|quickCommerce|taxi", "paymentMethod":"cash|online",
  "totalAmount":500, "orderTotal":500,
  "advanceAmount":100,          // paid online in advance (COD), else 0
  "codAmount":400,              // cash the rider had to collect
  "cashCollected":400,          // cash actually collected
  "earningAmount":35 }
```
Row UI: service badge, "Total Rs 500", "Advance paid Rs 100", "Cash collected Rs 400", "Earning Rs 35".

### B7. Job screens / new-order popup
- New order/ride popup and active job screen: show the **service badge**, **"Cash to collect Rs R"** (COD remaining) or "Prepaid - no cash", and the advance note.
- Taxi trip sheet: show "Cash to collect Rs (finalFare - advance)" and update it when the final fare changes.
- Gigs/scheduled jobs are unchanged.

---------------------------------------------------------------------

## PART C - RESTAURANT APP AND SELLER APP

### C1. Restaurant app (Food)
Order JSON now carries `cod` (same shape as A5, via `payment.cod`/`cod`). On the order card and order details show a note when `cod.enabled`:
- "Cash on Delivery - customer paid Rs {advanceAmount} in advance. Rider collects Rs {remainingAmount} in cash."
- After delivery: "Rider collected Rs {collectedAmount}".
- Cancelled: "Advance refunded to customer's wallet".
The restaurant payout is unchanged: it is calculated on the full order, not on the advance. Show it as before.

### C2. Seller app (Marketplace)
Seller order JSON:
```json
"payment": { "method":"cash", "status":"cod_pending", "amountDue":496,
             "cod": { "advanceAmount":124, "remainingAmount":496, "advanceStatus":"paid",
                      "refundedAmount":0, "collectedAmount":0, "collectedAt":null } }
```
Show "Cash on Delivery (Rs {advanceAmount} paid in advance, Rs {remainingAmount} on delivery)". For `method:"online"` show "Paid online".
The seller sees the order **only after the advance is paid**.

---------------------------------------------------------------------

## PART D - WHAT THE ADMIN SEES (for QA, no Flutter work)
- *Payment Settings -> Cash on Delivery*: per-service on/off + advance %.
- *Food -> Rider Cash Limit* (`/admin/food/rider-cash-limit`): the global cash limit (0 = no cap).
- *Delivery Boy Wallet & Cash*: every rider's cash in hand, pending, limit, available, status (OK / Blocked), deposited, cash by service.
- *Cash Deposits* (`/admin/food/cash-deposits`): every deposit with rider, amount, status, Razorpay ids, filters and totals.
- Order details (Food / Marketplace / Taxi): COD box with advance, wallet/online split, remaining, collected, refund; Settlement shows only the advance as paid/refunded for cancelled COD orders.

---------------------------------------------------------------------

## PART E - QA CHECKLIST
**COD (user)**
1. COD off for a service -> no COD row; API refuses COD ("Cash on Delivery is not available right now").
2. Food on at 25% -> only Food shows COD with the right split; Marketplace/Taxi still hide it.
3. Place COD order with wallet toggle OFF -> Razorpay opens for the **advance only**; no order exists until verify succeeds.
4. Wallet toggle ON with enough wallet -> order created at once, wallet debited only the advance.
5. Wallet toggle ON with too little wallet -> wallet pays part, Razorpay the rest.
6. Close Razorpay without paying -> no order, no charge.
7. Cancel -> wallet gets the advance, screen says "Advance refunded to your wallet". Taxi: cancellation fee taken from the advance first.
8. Delivered -> "Paid in cash on delivery Rs X".
9. Repeat 3-8 for Marketplace and Taxi (Taxi: final fare differs from the quote -> only `finalFare - advance` collected).

**Rider cash**
10. Limit 0 -> "No cash limit set", never blocked.
11. Admin sets a limit above cash in hand -> "Available" shown, progress bar moves after each cash job.
12. Cash in hand reaches the limit -> red banner, no new Food/Marketplace/Taxi jobs, accept attempts show the deposit message.
13. Deposit full amount via Razorpay -> cash in hand becomes 0, banner disappears, jobs resume, row appears in History as Completed and on the admin Cash Deposits page.
14. Deposit a smaller amount -> cash in hand drops by that amount.
15. Failed/cancelled payment -> no change to cash in hand; retry works.
16. Service filter on trip history / earnings / pocket-details shows only that service; rows show advance and cash collected.

## Known limits (tell QA so they are not logged as bugs)
- Deposit is one combined amount (not per service).
- Deposits are recorded in the Cash Deposits table and reduce cash in hand; they do not create a separate admin-wallet/ledger entry.
- Guest Marketplace checkout cannot get a wallet refund (no wallet); the advance is refunded manually by admin.
- The per-customer COD toggle on the admin Customers page does not control this new flow; the per-service admin setting does.
