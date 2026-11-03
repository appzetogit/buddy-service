# Flutter Guide - Wallet + Online Split Payment, and Refunds to Wallet

Applies to **Food**, **Quick Commerce (QC)** and **Taxi**.

## 1. What changed (short)

1. **Split payment (online only).** If the user picks **Online payment** and has wallet balance,
   they can choose to use the wallet for part of the amount.
   Example: order is Rs 200, wallet has Rs 50 -> wallet pays Rs 50, Razorpay charges Rs 150.
2. **All refunds go to the wallet.** Any refund (cancel, restaurant/seller cancel, return, etc.)
   is credited to the user's wallet, never back to bank/UPI/card.
3. **COD / cash is unchanged.** No split for cash.

The server decides every amount. The app only sends a flag and then opens Razorpay with the
amount the server returns.

---

## 2. UI rules

- Show a **"Use wallet balance (Rs X)"** toggle only when **all** are true:
  - selected payment is **Online** (not Wallet, not Cash),
  - user is **logged in**,
  - wallet balance **> 0**.
- When the toggle is ON show: `Wallet Rs a + Online Rs b`
  where `a = min(walletBalance, total)` and `b = total - a`. (Display only; the server's response
  is the final truth.)
- Default: toggle **OFF**.
- If the wallet balance is **>= total**, the server places the order as a pure **wallet** order
  (no Razorpay). Handle that response (see each module below).
- Refresh the wallet balance after the order is placed / payment verified.

Amount units: `walletAmount`, `onlineAmount`, `amount` in the order body are **rupees**.
`razorpay.amount` / taxi `amount` is **paise** (Razorpay's unit) and is **only the online part**.

---

## 3. Food

### 3.1 Create order

```
POST /api/v1/food/orders          (Authorization: Bearer <user token>)
```

Same body as before, plus one optional field:

```json
{
  "...": "existing fields",
  "paymentMethod": "razorpay",
  "useWallet": true
}
```

`useWallet` is only meaningful with `paymentMethod: "razorpay"`. Omit it (or `false`) for a normal
full-online payment.

**Response A - split / online (needs payment)**

```json
{
  "success": true,
  "data": {
    "order": null,
    "checkoutId": "6909...",
    "paymentType": "PREPAID",
    "requiresPayment": true,
    "amount": 200,
    "walletAmount": 50,
    "onlineAmount": 150,
    "razorpay": { "key": "rzp_live_x", "orderId": "order_Abc", "amount": 15000, "currency": "INR" },
    "pricing": { "...": "..." },
    "expiresAt": "..."
  }
}
```

-> Open Razorpay with `razorpay.key`, `razorpay.orderId`, **`razorpay.amount`** (already Rs 150 in
paise). Do **not** compute the amount yourself.
The wallet is **not** debited yet. It is debited by the server after Razorpay succeeds.

**Response B - wallet covered everything**

```json
{ "success": true, "data": { "order": { "...": "..." }, "paymentType": "WALLET", "requiresPayment": false } }
```

-> No Razorpay. Order is already placed.

### 3.2 Verify payment

```
POST /api/v1/food/orders/verify-payment
{ "checkoutId": "...", "razorpayOrderId": "...", "razorpayPaymentId": "...", "razorpaySignature": "..." }
```

Unchanged. On success the order is created and the wallet part is debited by the server.

### 3.3 If the user closes Razorpay / payment fails

```
POST /api/v1/food/orders/checkout/:checkoutId/cancel
```

Nothing to refund: the wallet was never debited.

### 3.4 Order fields (read-only)

`order.payment.walletAmount` and `order.payment.onlineAmount` show how it was paid
(`walletAmount + onlineAmount = pricing.total`). For a pure wallet order `walletAmount = total`.

### 3.5 Wallet balance

```
GET /api/v1/food/user/wallet   ->  data.wallet.balance
```

---

## 4. Quick Commerce

### 4.1 Place order

```
POST /api/v1/quick-commerce/orders
```

Same body as before. For split send:

```json
{ "paymentMode": "ONLINE", "useWallet": true }
```

`useWallet` is honoured only for **logged-in** users and **ONLINE** payment. Guests: ignored (full
online).

**Response A - needs payment (HTTP 201)**

```json
{
  "success": true,
  "requiresPayment": true,
  "checkoutId": "6909...",
  "amount": 200,
  "walletAmount": 50,
  "onlineAmount": 150,
  "razorpay": { "key": "...", "orderId": "...", "amount": 15000, "currency": "INR" },
  "expiresAt": "..."
}
```

-> Open Razorpay with `razorpay.amount` (online part, paise).

**Response B - wallet covered everything:** a normal order response (no `requiresPayment`), and
`result.payment.method == "wallet"`.

### 4.2 Verify / cancel

```
POST /api/v1/quick-commerce/checkout/verify-payment
{ "checkoutId": "...", "razorpay_order_id": "...", "razorpay_payment_id": "...", "razorpay_signature": "..." }

POST /api/v1/quick-commerce/checkout/cancel
{ "checkoutId": "..." }
```

Unchanged. Wallet part is debited by the server on verify.

### 4.3 Wallet balance

```
GET /api/v1/quick-commerce/wallet/balance
```

(Same wallet as Food - one wallet for the user.)

### 4.4 Returns

The return request still accepts `refundMethod`, but the server now **always refunds to wallet**
(UPI / bank are retired). Remove the UPI / Bank options from the return screen and always send
`"refundMethod": "wallet"`.

---

## 5. Taxi

Base: `/api/v1/taxi`. Taxi uses the **same wallet** as Food and QC.

Payment happens when the ride is completed (fare + tip), through two flows. Both support the split.

### 5.1 Ride completion payment

```
POST /api/v1/taxi/rides/:rideId/complete-payment/razorpay/order
{ "tipAmount": 10, "useWallet": true }
```

Response:

```json
{
  "success": true,
  "data": {
    "keyId": "rzp_live_x",
    "orderId": "order_Abc",
    "amount": 15000,
    "currency": "INR",
    "fare": 180, "fareDue": 180, "tipAmount": 20,
    "totalCharge": 200,
    "walletAmount": 50,
    "onlineAmount": 150
  }
}
```

-> Open Razorpay with `orderId` and `amount` (online part, paise).

Then verify exactly as before:

```
POST /api/v1/taxi/rides/:rideId/complete-payment/razorpay/verify
{ "razorpay_order_id": "...", "razorpay_payment_id": "...", "razorpay_signature": "...",
  "rating": 5, "comment": "", "tipAmount": 20 }
```

The wallet part is debited by the server at verify time, in the same step.

If the wallet **covers the whole amount**, the order call returns **HTTP 400**
("Your wallet covers this payment. Please pay with wallet."). In that case use the wallet-only
endpoint:

```
POST /api/v1/taxi/rides/:rideId/complete-payment/wallet
```

### 5.2 Fare paid during the trip

```
POST /api/v1/taxi/rides/:rideId/fare-payment/razorpay/order   { "useWallet": true }
POST /api/v1/taxi/rides/:rideId/fare-payment/razorpay/verify  (unchanged)
```

Response has the same `walletAmount` / `onlineAmount` / `amount` fields.

### 5.3 Wallet balance

```
GET /api/v1/taxi/users/wallet   ->  data.balance
```

### 5.4 Special case: HTTP 409

If the user's wallet balance dropped between "create order" and "verify" (spent elsewhere), verify
returns **409** with the message *"Your wallet balance changed. The online payment was added to
your wallet; please pay again."* The online amount is already back in the wallet. Show the message
and let the user pay again.

### 5.5 Not split (still full online / wallet)

Online **rental advance** and the **tip-only** Razorpay payment are not split. Do not show the
toggle there.

---

## 6. Refunds - all go to the wallet

| Case | Result |
|---|---|
| User cancels a paid order / ride | Full paid amount (wallet part + online part) credited to wallet |
| Restaurant / seller cancels | Same - wallet |
| No delivery partner found | Same - wallet |
| One store drops from a multi-store order | Partial amount - wallet |
| QC return | Wallet only |
| Payment received after checkout expired | Credited to wallet |
| Taxi cancellation refund | Wallet (`rideRefundProcessed` socket event, message "...credited to your Buddy Wallet") |

What to change in the app:

- Food cancel dialog: remove the "Refund to original payment method / wallet" choice. The server
  ignores `refundDestination` and always uses the wallet. Show: *"The full amount you paid will
  be credited to your wallet."*
- QC return screen: wallet only (see 4.4).
- Wherever the app says "refund to original payment method / 5-7 days", change it to
  "credited to your wallet".
- Order object: `order.payment.refund.destination` is `"wallet"` (food) and
  `payment.refund.processedMethod` is `"wallet"` (QC).
- Refresh the wallet balance after a cancellation.
- Exception: a **guest** QC order (not logged in) has no wallet, so its refund still goes back to
  the original payment method.

---

## 7. Error handling

| Situation | What the server returns | What to do |
|---|---|---|
| Wallet balance changed during food/QC payment | 400 / 409 with a message; the online amount is already credited to wallet | Show the message, refresh wallet, let the user place the order again |
| Wallet covers everything (taxi) | 400 "pay with wallet" | Call the wallet-only endpoint |
| Not enough wallet balance for a pure wallet order | 400 "Insufficient wallet balance" | Show the message |
| User closes Razorpay | none | Call the checkout cancel API (food / QC). Wallet is untouched |

## 8. Checklist for the app

- [ ] Toggle "Use wallet balance" under Online payment (hidden for cash / wallet / guests)
- [ ] Send `useWallet: true` (food/taxi: `useWallet`; QC: with `paymentMode: "ONLINE"`)
- [ ] Open Razorpay with the amount **from the response**, not a local calculation
- [ ] Handle the "wallet covered everything" response (no Razorpay)
- [ ] Show wallet + online split in the order summary / order details
- [ ] Refresh wallet balance after payment, cancel and refund
- [ ] Remove "refund to bank / UPI / original payment method" text and options
