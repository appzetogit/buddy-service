# Flutter: online payment, wallet split aur WhatsApp - kya badla aur app mein kya karna hai

Backend deploy ho chuka hai. Neeche wali cheezein Flutter app mein check/badalni hain.

---

## 1. Wallet top-up: cancel par paisa NAHI judna chahiye

**Backend ab kya karta hai:** top-up tabhi credit hota hai jab Razorpay khud confirm kare ki payment `captured` hai, usi order par hai, aur usi user ka hai. Amount Razorpay ka hota hai, app ka bheja hua nahi. Cancel / fail / authorized-only payment par credit nahi hota (error aata hai).

**Flutter mein karna hai (`razorpay_flutter`):**
- Verify API sirf `Razorpay.EVENT_PAYMENT_SUCCESS` par call karo.
- `EVENT_PAYMENT_ERROR` (cancel / fail) par **verify call mat karo** aur balance bhi apni taraf se mat badhao. Sirf "Payment cancelled" dikhao.
- Success ke baad balance **server se dobara fetch karo** (wallet API), local `balance += amount` mat karo.
- Success par bhejo: `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature` (teeno response se, khali nahi).

Endpoints (change nahi hue):
- Food/common wallet: `POST /api/v1/food/user/wallet/topup/order` -> `POST /api/v1/food/user/wallet/topup/verify`
  (verify body: `razorpayOrderId`, `razorpayPaymentId`, `razorpaySignature`; `amount` ab ignore hota hai).
- Taxi wallet: `POST /api/v1/taxi/users/wallet/razorpay/order` -> `POST /api/v1/taxi/users/wallet/razorpay/verify` (taxi router `/api/v1/taxi` ke andar)
  (body: `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`).

Yehi "sirf captured payment par kaam" rule ab in sab verify calls par bhi hai: ride completion payment, ride fare payment, ride tip, rental advance, delivery cash deposit, onboarding fee.

---

## 2. Order / booking payment ke bina aage nahi badhna chahiye

- **Food aur Marketplace (Quick Commerce):** pehle se sahi hai. Online payment par pehle sirf checkout session banta hai (`requiresPayment: true`, `checkoutId`), order **verify-payment ke baad hi** banta hai. App ko order screen tabhi dikhani hai jab verify success ho.
- **Taxi:** ride/parcel booking pehle ban jati hai, online payment ride ke complete hone par (ya trip ke beech fare-payment se) hota hai. Ye taxi ka design hai, isliye maine badla nahi.
- Flutter mein rule: Razorpay `PAYMENT_ERROR` / cancel par order ya booking ko "paid" ya "confirmed" mat dikhao.

---

## 3. Wallet + online split (jaise bill 170, wallet 98 + online 72)

**Pehle kya bug tha:** backend wallet tabhi use karta tha jab app `useWallet: true` bheje. Flutter nahi bhejta tha, isliye poora 170 Razorpay se kat gaya aur wallet se kuch nahi kata.

**Ab backend:**
- `useWallet` **nahi bheja** -> wallet ka paisa automatically pehle use hota hai, baaki Razorpay se. (Wallet balance 98, bill 170 -> wallet 98 + online 72.)
- `useWallet: false` -> poora online (user ne wallet band kiya).
- `useWallet: true` -> wallet use. Agar wallet poora bill cover kare, to wallet-only payment ho jati hai.
- Wallet ka hissa **verify ke baad hi** katta hai (Razorpay se online hissa paid hone ke baad). Isliye cancel karne par wallet nahi katta.
- Agar wallet poora bill cover karta hai aur `useWallet` bheja hi nahi, to purane jaisa poora online payment hi chalta hai (app toot-ta nahi).

**Flutter mein karna hai:**
1. Payment screen par checkbox "Use wallet balance" rakho (default ON) aur request mein **hamesha explicit** `useWallet: true/false` bhejo.
2. Razorpay checkout `order.amount` (paise) se kholo, jo backend ne diya hai (yeh online hissa hota hai). Apna alag amount mat nikalo.
3. Order create ke response mein ye fields aate hain, inhi ko UI mein dikhao: `amount` (total), `walletAmount`, `onlineAmount`.
4. Taxi ride completion / fare payment order API (`.../razorpay/order`) ke body mein bhi `useWallet` bhejo. Response mein `walletAmount` aur `onlineAmount` milte hain.
5. Verify ke baad wallet balance server se refresh karo.

---

## 4. Parcel booking par WhatsApp message

- Pehle parcel book karne par **2 message** jate the (Ride + Delivery dono ke liye). Ab **1** jata hai.
- Wording: "Parcel Booked" / "Parcel Delivered" / "Parcel Cancelled" (ride ke liye "Ride Booked / Ride Completed / Ride Cancelled").
- Ye sab backend ka kaam hai, Flutter mein kuch nahi badalna.
- Note: message ka baaki text (jaise "Your order #... has been updated") BhashSMS ke approved template ka hai. Poora "parcel" wording chahiye to BhashSMS mein naya template approve karwao aur server `.env` mein `WHATSAPP_PARCEL_TEMPLATE=<template_name>` set karo. Template mein `{{1}}` naam, `{{2}}` id, `{{3}}` status rakhna.
