# Cash on Delivery with advance (Food, Marketplace, Taxi) - guide for the Flutter team

Backend, admin panel and the web apps are live. Base URL `https://sooperbuddy.in/api/v1`. This document is what the **native Flutter user, rider and driver apps** must do.

## 1. What it is
- Admin turns **COD on per service** (Food, Marketplace, Taxi - any one, two or all three) and sets an **advance %** (admin page: *Payment Settings -> Cash on Delivery*). COD is **off by default** everywhere.
- When COD is on, checkout shows a third option next to Online and Wallet: **Cash on Delivery**. If the admin keeps it off, the option must **not** be shown.
- The customer pays only the **advance** now (wallet and/or online, exactly like a prepaid order). The **remaining** is paid in **cash** after delivery / at the end of the ride.
- If the order or ride is **cancelled**, the advance goes back to the customer's **wallet only** (never to Razorpay).
- Rider / driver collects **only the remaining** amount, not the full bill.

Example: 20% advance on a Rs 500 bill -> pay Rs 100 now, Rs 400 in cash.
Advance = `round(total x percent / 100, 2)`, at least Rs 1 when a percent is set (gateway minimum). Always take the numbers from the API below, do not compute them on the client.

## 2. Which options to show (all three services)
`GET /common/payment-options?service=food|quickCommerce|taxi&total=<bill amount>` (public, no auth)
```json
{ "service":"food", "online":{"enabled":true}, "wallet":{"enabled":true},
  "cod":{ "enabled":true, "advancePercent":20, "split":{ "total":500,"percent":20,"advanceAmount":100,"remainingAmount":400 } } }
```
- Show the COD row only when `cod.enabled == true`. Subtitle: "Pay Rs {advanceAmount} now, Rs {remainingAmount} on delivery" (taxi: "after the ride").
- `split` appears only when you pass `total`. Call again whenever the bill changes (coupon, tip, vehicle change).
- Per-customer block: the server can still refuse COD for a customer; show the error message.

## 3. Placing the order / booking

The advance is paid the same way as any prepaid order. **If nothing has to be paid online (advance is 0, or the wallet covers it and `useWallet:true`) the order is created immediately. Otherwise you get a checkout with Razorpay data for the advance only, pay it, then call verify - the order/ride is created only after that.**

### Food
`POST /food/orders` - same body as today with `"paymentMethod": "cod"` and `"useWallet": true|false` (true = use wallet first for the advance).
- Order created now (advance 0 or wallet-covered): response has `order`, `paymentType: "COD"`, `codAdvance:{total,percent,advanceAmount,remainingAmount}`, `requiresPayment:false`.
- Online part needed: response has `requiresPayment:true`, `checkoutId`, `codAdvance`, `walletAmount`, `onlineAmount`, `razorpay:{key,orderId,amount (paise),currency}`. Pay `razorpay.amount` (this is the **advance only**), then `POST /food/orders/verify-payment { checkoutId, razorpayOrderId, razorpayPaymentId, razorpaySignature }` (same as prepaid today). The order is created by verify.
- COD is for **delivery** orders only (not self-pickup). Errors: "Cash on Delivery is not available right now..." when off.

### Marketplace
`POST /quick-commerce/orders` with `"paymentMode": "COD"` (as today) and optional `"useWallet": true|false`.
- Immediate: `201 { success, result: order }`.
- Online part: `201 { requiresPayment:true, checkoutId, amount:<advance>, total, walletAmount, onlineAmount, cod:{percent,advanceAmount,remainingAmount}, razorpay:{key,orderId,amount,currency}, expiresAt, result:null }`. Pay Razorpay, then `POST /quick-commerce/checkout/verify-payment { checkoutId, razorpay_order_id, razorpay_payment_id, razorpay_signature }` -> `{ success, result: order }`. The shop sees the order only after the advance is paid.

### Taxi (rides)
`POST /taxi/rides` - same body with `"paymentMethod": "cod"` and optional `"useWallet"`.
- Immediate: `201 { data:{ ride, realtime } }` (`ride.cod` is set).
- Online part: `201 { data:{ requiresPayment:true, checkoutId, kind, percent, fare, advanceAmount, remainingAmount, walletAmount, onlineAmount, expiresAt, razorpay:{keyId,orderId,amount,currency} } }`. **No ride exists and no driver search starts yet.** Pay Razorpay, then `POST /taxi/rides/cod-advance/verify { checkoutId, razorpay_order_id, razorpay_payment_id, razorpay_signature }` -> `201 { data:{ ride, realtime } }` and the driver search starts. The checkout is valid ~30 minutes; if booking fails the advance returns to the wallet.
- Parcel: `POST /taxi/deliveries` with `"paymentMethod":"cod"`, verify at `POST /taxi/deliveries/cod-advance/verify` (same payload).

## 4. Order / ride JSON (what to render)
Food and Marketplace orders: `payment.method = "cash"`, `payment.status = "cod_pending"` until the cash is collected (then `"paid"`), `payment.amountDue` = remaining. Taxi rides: `ride.paymentMethod = "cash"`, `ride.cod`, `ride.amountDue`.
```json
"cod": { "enabled":true, "percent":20, "advanceAmount":124, "advanceWalletAmount":124, "advanceOnlineAmount":0,
         "remainingAmount":496, "advanceStatus":"paid",          // none | paid | refunded
         "refundedAmount":0, "refundedAt":null, "collectedAmount":0, "collectedAt":null }
```
Order details / ride receipt (customer app) must show:
- Payment method: "Cash on Delivery (advance + cash)".
- "Paid in advance: Rs X (Wallet Rs a + Online Rs b)".
- Not yet delivered: "To pay in cash on delivery: Rs R".
- After delivery: "Paid in cash on delivery: Rs `collectedAmount`".
- After cancel: "Advance Rs `refundedAmount` refunded to your wallet" (`advanceStatus == "refunded"`).

## 5. Cancel
No new API. Existing cancel endpoints (`PATCH /food/orders/{id}/cancel`, QC cancel, taxi cancel) now refund the advance to the wallet automatically (instantly on user cancel; any other path - admin, restaurant/seller reject, no driver found - within about 30 seconds). Refresh the wallet after a cancel and show the message "Your advance of Rs X has been credited to your wallet." The same advance is never refunded twice.
- **Taxi:** the existing ride cancellation fee (admin configured) still applies and is taken from the advance first; whatever is left is refunded, the rest of the fee comes from the wallet as before. So a cancelled ride can return less than the advance when a fee applies.

## 6. Rider / driver apps
- The amount to collect is `payment.amountDue` (Food/Marketplace) or `amountToCollect` / `payment.amountDue` (taxi job) = **remaining**, not the full bill. Show: "Cash to collect Rs R" and a small note "Order total Rs T - Rs A already paid in advance".
- Collection flow is unchanged (cash, or the existing QR for the remaining amount). Cash-in-hand and the cash limit count only the remaining.
- **Taxi final fare:** fare can change by the end of the ride. The driver collects `finalFare - advance` (never negative). If the final fare is lower than the advance the difference is returned to the customer's wallet automatically. The driver wallet is settled on the final fare (`advance - commission` for COD rides).

## 7. Checklist for QA
1. Admin keeps COD off -> no COD row in any app; the API refuses it with "Cash on Delivery is not available right now".
2. Admin turns Food on at 25% -> Food checkout shows COD with the split; Marketplace/Taxi still hide it.
3. Place a COD order with enough wallet -> order created, wallet debited only the advance, order shows "To pay in cash".
4. Place with empty wallet -> Razorpay opens for the **advance only**; no order exists until verify succeeds.
5. Cancel -> wallet gets the advance back, order shows "Advance refunded to your wallet".
6. Rider delivers -> collects only the remaining; order shows "Paid in cash".
7. Taxi: complete a ride whose final fare differs from the quoted fare -> only `finalFare - advance` is collected.
