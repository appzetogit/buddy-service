# Buddy-service — Food Delivery Platform ka Pura Flow (Single File)

Yeh ek single combined document hai jisme Buddy-service ke **food delivery module** ka complete flow hai — onboarding se lekar order complete hone tak, aur uske baad bhi (rating, refund, settlement) jo hota hai sab, 4 roles (User, Restaurant, Delivery Partner, Admin) ke hisaab se.

## Table of Contents
1. [Overview / Project Structure](#1-overview--project-structure)
2. [Onboarding & Authentication Flow](#2-onboarding--authentication-flow)
3. [User (Customer) Flow](#3-user-customer-flow)
4. [Restaurant Flow](#4-restaurant-flow)
5. [Delivery Partner (Delivery Boy) Flow](#5-delivery-partner-delivery-boy-flow)
6. [Admin Flow](#6-admin-flow)
7. [Order Lifecycle — End to End](#7-order-lifecycle--end-to-end)
8. [Realtime Tracking (Socket.IO) & Notifications](#8-realtime-tracking-socketio--notifications)

---

# 1. Overview / Project Structure

Yeh ek **monorepo** hai:

- `Backend/` → Node.js + Express (ESM), MongoDB (Mongoose), Redis + BullMQ (queues), Socket.IO (realtime), Razorpay + PhonePe (payments), Cloudinary (uploads), Firebase Admin (push notifications).
- `Frontend/` → Ek hi React 19 + Vite SPA jisme **4 alag role ke UI modules** hain (separate deployed apps nahi hain, ek hi app ke andar routes hain):
  - `Frontend/src/modules/Food/pages/user` → Customer app
  - `Frontend/src/modules/Food/pages/restaurant` → Restaurant panel
  - `Frontend/src/modules/Food/pages/admin` → Admin panel
  - `Frontend/src/modules/driver` (legacy) + `Frontend/src/modules/DeliveryV2` (naya) → Delivery partner app

Backend ke andar `Backend/src/modules/food/` me role-wise sub-modules hain: `admin`, `restaurant`, `delivery`, `user`, `orders`, `dining` (table booking), `landing`, `search`, `shared`, `services`, `utils`.

> Note: isi backend me ek dusra product bhi hai — `Backend/src/modules/quickCommerce/` (grocery jaisa) — jo `core/` (auth, users, payments, notifications) share karta hai food module ke saath. Yeh documentation sirf **food delivery flow** pe focus karti hai.

## 4 Actors (Roles) Jinka Flow Cover Kiya Gaya Hai

| Role | Kaam |
|---|---|
| **User/Customer** | Restaurant browse, order place, payment, tracking, rating |
| **Restaurant** | Onboarding/approval, menu manage, order accept/prepare |
| **Delivery Partner** | Onboarding/approval, order pickup/deliver, earnings |
| **Admin** | Sabko approve/manage, orders monitor, reports |

## High-Level Flow (Bird's Eye View)

```
[Restaurant Onboarding + Admin Approval]     [Delivery Partner Onboarding + Admin Approval]
              |                                              |
              v                                              v
      Menu Live ho jata hai                       Partner "online/available" hota hai
              |                                              |
              +--------------------+-------------------------+
                                   |
                            [User Signup/Login]
                                   |
                    Browse Restaurants -> Menu -> Cart
                                   |
                          Checkout & Pricing Calculate
                                   |
                        Order Place + Payment (COD/Razorpay/Wallet)
                                   |
                      Restaurant ko order milta hai (realtime)
                       Accept -> Preparing -> Ready for Pickup
                                   |
                    System nearest Delivery Partner ko dhoondh
                       ke order OFFER karta hai (auto-assign)
                                   |
                  Partner Accept -> Reach Pickup -> Pickup Confirm
                                   |
                     Reach Drop -> OTP Verify -> Order Delivered
                                   |
                        User Rating deta hai (restaurant + partner)
                                   |
                    Settlement: Restaurant payout, Partner payout,
                          Platform commission — sab calculate hota hai
```

Har box/step ka detailed breakdown aage ke sections me diya gaya hai.

---

# 2. Onboarding & Authentication Flow

Sabhi 4 roles (User, Restaurant, Delivery Partner, Admin) ka auth core logic `Backend/src/core/auth/auth.service.js` me hai, routes `Backend/src/core/auth/auth.routes.js` me hain. Ek naya unified identity system bhi hai `Backend/src/core/identity/identity.routes.js` jo same OTP flow use karta hai user + driver dono ke liye.

## 2.1 User (Customer) — Signup/Login

Base: `POST /v1/food/auth/user/request-otp` → `POST /v1/food/auth/user/verify-otp`

**Step by step:**
1. User apna phone number daalta hai → `request-otp` API call hoti hai.
2. Agar **naya user** hai (phone pehli baar aaya), OTP request ke saath `name` bhejna zaroori hai — yeh signup gate hai (bina naam ke naya account nahi banega).
3. OTP generate hota hai (`core/otp/otp.service.js`). Dev/staging me OTP response me hi return ho jata hai (`useDefaultOtp` config), production me SMS provider se bhejna hai — **abhi SMS provider integrate nahi hai** (code me `TODO: integrate SMS provider here` comment hai, `auth.service.js:113`).
4. User OTP daalta hai → `verify-otp` call hoti hai.
5. Verify hone par:
   - Naya `FoodUser` record create hota hai (agar naya hai), `isVerified: true` set hota hai.
   - Automatic `referralCode` generate hota hai us user ke liye.
   - Agar signup ke time referral code use kiya tha, `creditReferralReward` se referral bonus credit hota hai.
   - FCM push token store hota hai (web/mobile alag arrays me) — notifications ke liye.
   - JWT **access token** + **refresh token** issue hote hain, refresh token DB me (`FoodRefreshToken`) save hota hai.
6. Ab user logged in hai, app use kar sakta hai.

## 2.2 Restaurant — Onboarding/Registration/Approval

Base: `POST /v1/food/auth/restaurant/request-otp` → `verify-otp`

**Step by step:**
1. Restaurant owner apna phone (`ownerPhone`/`primaryContactNumber`) daal kar OTP request karta hai.
2. Backend phone match karta hai existing restaurants me (fuzzy digit-suffix match bhi karta hai).
3. **Agar restaurant exist nahi karta:** automatically ek **draft restaurant** create ho jata hai (`ensureDraftRestaurantForPhone`) — matlab restaurant "sign up" khud onboarding wizard ke through hota hai, koi upfront admin-created account nahi hota.
4. Response me `onboardingStatus` aata hai jo yeh batata hai restaurant kis stage pe hai:
   - `NOT_STARTED` → onboarding shuru nahi hui
   - `IN_PROGRESS` → wizard fill ho raha hai
   - `SUBMITTED` → submit kar diya, review pending
   - `UNDER_REVIEW` → admin dekh raha hai
   - `APPROVED` → live hai, orders le sakta hai
   - `REJECTED` → reject hua, reason ke saath dobara try kar sakta hai
5. **Onboarding Wizard (multi-step form):**
   - `GET /v1/food/restaurant/onboarding` — current progress fetch
   - `PUT /v1/food/restaurant/onboarding/step/:step` — har step submit (profile details, PAN card image, GST document, FSSAI license image, menu images — sab file uploads Cloudinary pe jaate hain)
   - `POST /v1/food/restaurant/onboarding/submit` — final submit, status → `SUBMITTED`/`UNDER_REVIEW`
6. **Admin Review:** Admin panel me pending restaurants dikhte hain. Admin:
   - `PATCH /v1/food/admin/restaurants/:id/approve` → status `APPROVED`, ab restaurant menu live ho sakta hai
   - `PATCH /v1/food/admin/restaurants/:id/reject` → status `REJECTED` (reason ke saath)
7. Agar restaurant `pendingApproval` state me hai, login to hota hai lekin **usable session nahi milta** — matlab dashboard sirf status dekhne ke liye khulta hai, orders operate nahi kar sakta.
8. Rejected restaurant bhi login karke apna data dekh/edit karke **resubmit** kar sakta hai.
9. Admin restaurant ko **ban** bhi kar sakta hai (`isRestaurantBanned` check login ke time hota hai).

## 2.3 Delivery Partner — Onboarding/Registration/Approval

Base: `POST /v1/food/auth/delivery/request-otp` → `verify-otp`

**Step by step:**
1. Delivery partner apna phone number daal kar OTP request karta hai.
2. **Agar koi `FoodDeliveryPartner` record match nahi hota** (naya partner hai), response me `needsRegistration: true` aata hai.
3. Frontend isko dekh kar registration form pe redirect karta hai: `POST /v1/food/delivery/register` (multipart form) — isme:
   - Profile photo
   - Aadhar card photo
   - PAN card photo
   - Driving license photo
   - UPI QR code (payout ke liye)
   - Naam, phone, vehicle details, bank details
4. Registration ke baad status `pending` set hota hai (model enum: `pending | approved | rejected`).
5. **Admin Review:**
   - `PATCH /v1/food/admin/delivery/:id/approve` → status `approved`, ab partner orders accept kar sakta hai
   - `PATCH /v1/food/admin/delivery/:id/reject` → status `rejected` (rejectionReason ke saath)
6. Jab tak `approved` nahi hota, login response me `pendingApproval: true` milta hai (rejected ho to `rejectionReason` bhi), tokens nahi milte — kaam nahi kar sakta.
7. Ek naya **Driver Onboarding Wizard v2** bhi hai (`core/identity/driverOnboarding.routes.js` → `/v1/driver/onboarding/*`) jo unified `BuddyIdentity` system ka part hai — yeh newer flow hai jisme ek hi identity food aur quickCommerce dono me driver mode toggle kar sakti hai.

## 2.4 Admin — Login

Base: `POST /v1/food/auth/admin/login`

**Step by step:**
1. Admin email + password se login karta hai (bcrypt-hashed password check hota hai).
2. `Admin` model me do type hote hain:
   - `superadmin` → sab kuch access
   - `subadmin` → sirf specific `permissions[]` array ke hisaab se limited access
3. `servicesAccess: [food, quickCommerce]` field decide karta hai admin kaunse product access kar sakta hai.
4. **Forgot Password Flow (OTP via Email, password ke through nahi):**
   - `POST /v1/food/auth/admin/forgot-password/request-otp` → OTP email pe bheja jata hai (`AdminResetOtp` model, 10-min expiry, max attempt limit)
   - `POST /v1/food/auth/admin/forgot-password/reset` → OTP verify karke naya password set
5. `PATCH /v1/food/auth/admin/profile` — profile update
6. `POST /v1/food/auth/admin/change-password` — password change karne par **sabhi admins ko security-alert push notification** jaata hai (suspicious activity ke against safety measure).

## 2.5 Common/Shared Auth Endpoints (Sab Roles Ke Liye)

| Endpoint | Kaam |
|---|---|
| `POST /v1/auth/refresh-token` | Access token expire hone par naya token lena |
| `POST /v1/auth/logout` | Refresh token invalidate + FCM token sabhi 4 role collections se hata deta hai |
| `GET /v1/auth/me` | Role-aware profile — jo bhi role logged in hai uske hisaab se profile data deta hai |

## 2.6 Summary Table — Onboarding Status per Role

| Role | Pre-approval possible? | Approval kaun karta hai | Status field |
|---|---|---|---|
| User | N/A (turant verified) | Auto (OTP verify hi kaafi hai) | `isVerified` |
| Restaurant | Haan, multi-step draft | Admin | `onboardingStatus` |
| Delivery Partner | Haan, single registration form | Admin | `status: pending/approved/rejected` |
| Admin | Account pehle se banaya jata hai (seeded/created by superadmin) | — | — |

---

# 3. User (Customer) Flow

Customer ke perspective se pura journey — signup se lekar order deliver hone aur rating dene tak.

**Related Files:** Routes: `Backend/src/modules/food/user/user.routes.js` · Order routes: `Backend/src/modules/food/orders/order.routes.user.js` · Frontend: `Frontend/src/modules/Food/pages/user`

## Step 1 — Signup/Login
Dekho [Section 2.1](#21-user-customer--signuplogin). Short me: Phone + OTP → verify → account ban jata hai / login ho jata hai.

## Step 2 — Profile Setup
- `userProfile.controller.js` se profile complete karta hai (naam, email, photo).
- Address add karta hai — `userAddress.controller.js` se addresses CRUD (multiple delivery addresses save kar sakta hai, ek ko "default" mark kar sakta hai).
- `userReferral.controller.js` se apna referral code share kar sakta hai doston ke saath (unke signup pe bonus milta hai).

## Step 3 — Restaurant Browse Karna
- `GET /v1/food/restaurant/restaurants` (public endpoint, cached) — nearby/available restaurants ki list.
- `GET /v1/food/restaurant/restaurants/:id` — restaurant detail.
- `GET /v1/food/restaurant/restaurants/:id/menu` — menu items.
- `GET /v1/food/restaurant/restaurants/:id/outlet-timings` — restaurant kab khula hai.
- `GET /v1/food/restaurant/restaurants/:id/offers` — us restaurant ke coupons/offers.
- Search bhi available hai (`/v1/food/search`).

## Step 4 — Cart Me Add Karna
- Items cart me add hote hain (`FoodUserCart` model, `userCart.controller.js`).
- Cart ek hi restaurant se items rakh sakta hai ya **multiple restaurants se bhi** (max 3 restaurants per order allowed — multi-restaurant order feature).

## Step 5 — Checkout / Pricing Preview
- `POST /v1/food/orders/calculate` → order place karne se pehle pura price breakdown dikhta hai:
  - Subtotal (items ka total)
  - Tax
  - Packaging fee
  - Delivery fee
  - Platform fee
  - Restaurant commission (backend calculation, user ko nahi dikhta usually)
  - Coupon/offer discount agar apply kiya
  - Platform subsidy (agar koi promo chal raha ho)
- `POST /v1/food/orders/validate-restaurant-chain` — multi-restaurant order ke time validate karta hai ki sab restaurants valid combo me hain.

## Step 6 — Order Place Karna
- `POST /v1/food/orders/` → order create hota hai.
- Payment method choose karta hai:
  - **Cash (COD)** — `payment.status: cod_pending`
  - **Razorpay** (online card/UPI/netbanking)
  - **Razorpay QR**
  - **Wallet** (app wallet balance se pay)
- Online payment ke case me:
  - `POST /v1/food/orders/verify-payment` — Razorpay payment signature verify hoti hai.
  - Ek webhook bhi hai (`/v1/payments/webhook`) jo Razorpay se async events (jaise payment success delayed confirm) handle karta hai.
- Agar checkout session expire ho jaye lekin payment ho chuka ho, **auto-refund** trigger hota hai.

## Step 7 — Order Restaurant/Kitchen Ko Jaata Hai
- Order create hote hi restaurant ko realtime notification milti hai (Socket.IO room `restaurant:{id}`).
- User order status live track kar sakta hai `GET /v1/food/orders/:orderId` se, ya socket room `tracking:{orderId}` join karke realtime updates paata hai.

## Step 8 — Order Track Karna (Restaurant Accept → Prepare → Pickup → Deliver)
Order ka status yeh transitions follow karta hai (poora detail [Section 7](#7-order-lifecycle--end-to-end) me):
```
created → confirmed → preparing → ready_for_pickup → picked_up → delivered
```
- User ko har status change ka realtime update milta hai (socket + push notification).
- Delivery partner assign hone ke baad, user uski **live location** map pe dekh sakta hai (`location-update` socket event, throttled every 2 seconds).
- `GET /v1/food/orders/:orderId/drop-otp` — jab delivery partner ghar pahunchta hai, user ko ek OTP dikhta hai jo delivery partner ko dena hota hai delivery confirm karne ke liye (security ke liye — galat vyakti ko order na mile).

## Step 9 — Order Cancel Karna (Agar Chahe)
- `PATCH /v1/food/orders/:orderId/cancel` — user order cancel kar sakta hai (agar abhi terminal state me nahi pahuncha).
- Refund destination choose kar sakta hai: **wallet** (app wallet me turant credit) ya **source** (original payment method me Razorpay refund, thoda time lagta hai).
- Agar restaurant ne accept hi nahi kiya ya delivery partner nahi mila, system khud order cancel + refund kar deta hai.

## Step 10 — Special Instructions
- `PATCH /v1/food/orders/:orderId/instructions` — order ke liye special note add kar sakta hai (jaise "no onions", "leave at door") order place hone ke baad bhi.

## Step 11 — Order Delivered Hone Ke Baad
- Order status `delivered` ho jata hai.
- `GET /v1/food/orders/:orderId/payments` — payment details dekh sakta hai.
- `PATCH /v1/food/orders/:orderId/ratings` — **Rating dena**:
  - Restaurant ko alag rating + comment (1-5 scale)
  - Delivery partner ko alag rating + comment (1-5 scale)

## Extra User Features
- **Wallet**: `userWallet.controller.js` — app wallet balance dekhna, refunds/cashback isi me aate hain.
- **Order History**: `GET /v1/food/orders/` — sab past orders ki list.
- **Support Tickets**: `supportTicket.controller.js` — koi complaint/issue ho to ticket raise kar sakta hai.
- **Safety/Emergency SOS**: `userSafetyEmergency.controller.js` — delivery ke time koi safety issue ho to emergency report kar sakta hai.
- **Dining/Table Booking**: `/v1/food/dining` — restaurant me table book karne ka alag flow bhi hai (dine-in reservation), order flow se separate feature.
- **Delete Account**: `deleteAccount.controller.js`.

## User Journey Summary (Ek Line Me Har Step)
1. Phone + OTP se login/signup → 2. Profile + address setup → 3. Restaurant browse + menu dekhna → 4. Cart me items add → 5. Checkout pricing preview → 6. Order place + payment → 7. Restaurant accept/prepare (realtime updates) → 8. Delivery partner assign + live tracking → 9. OTP dekar delivery confirm → 10. Rating dena.

---

# 4. Restaurant Flow

Restaurant owner ke perspective se pura journey — registration se lekar roz-roz orders handle karne tak.

**Related Files:** Routes: `Backend/src/modules/food/restaurant/restaurant.routes.js` · Models: `restaurant.model.js`, `FoodAddon`, `FoodOutletTimings`, `RestaurantWallet`, `FoodRestaurantWithdrawal` · Frontend: `Frontend/src/modules/Food/pages/restaurant`

## Step 1 — Registration/Onboarding
Dekho [Section 2.2](#22-restaurant--onboardingregistrationapproval). Short me:
1. Phone number se OTP request → agar naya hai, draft restaurant auto-create.
2. Multi-step onboarding wizard fill karta hai (profile, PAN, GST, FSSAI, menu images).
3. `POST /v1/food/restaurant/onboarding/submit` — final submit → status `SUBMITTED`/`UNDER_REVIEW`.
4. Admin approve/reject karta hai.

## Step 2 — Approval Ke Baad Dashboard Access
- Approved hone ke baad restaurant login karke apna full dashboard use kar sakta hai.
- `GET /v1/food/restaurant/current` — apni profile info fetch karna.
- `PUT /v1/food/restaurant/profile` — profile edit karna.

## Step 3 — Menu Setup
- Categories create karna (menu categories jaise "Starters", "Main Course").
- `POST /v1/food/restaurant/foods` — individual food item add karna (naam, price, image, description, veg/non-veg).
- `POST /v1/food/restaurant/foods/bulk` — ek saath multiple items add karna.
- Addons manage karna (`FoodAddon` — jaise "extra cheese", "extra spicy" jo food item ke saath add ho sakte hain).
- **Note:** Naye categories/foods/addons admin approval ke through jaate hain (admin panel me "pending approvals" dikhta hai) taaki quality control raha sake.

## Step 4 — Outlet Timings & Availability
- `PUT /v1/food/restaurant/outlet-timings` — restaurant kab khula/band rehta hai set karna (din-wise timings).
- `PATCH /v1/food/restaurant/availability` — real-time "Accepting Orders" toggle. Agar restaurant busy hai ya band karna hai temporary, isko OFF kar sakta hai — tab naye orders nahi aayenge, existing users ko restaurant "unavailable" dikhega.

## Step 5 — Offers/Coupons Banana
- `POST /v1/food/restaurant/my-offers` — apna khud ka coupon/offer create karna (discount %, min order value, validity).
- Analytics dekh sakta hai (`GET /my-offers/:id/analytics`) — kitne log use kiye, kitna discount diya.
- Yeh bhi admin approval se hoke jaate hain.

## Step 6 — Order Aana (Live)
1. Jab user order place karta hai us restaurant se, **realtime notification** milti hai (Socket.IO room `restaurant:{id}` + push notification via FCM).
2. `GET /v1/food/restaurant/orders` — restaurant apne saare current/pending orders dekh sakta hai.
3. `GET /v1/food/restaurant/orders/:orderId` — ek order ka detail (items, quantity, special instructions, customer address).

## Step 7 — Order Accept/Reject Karna
- `PATCH /v1/food/restaurant/orders/:orderId/status` — status update karta hai:
  - **Accept** → order status `created`/`confirmed` → `confirmed`
  - **Reject** → `rejected_by_restaurant` (agar reject karta hai to system automatically **refund** trigger karta hai aur (multi-restaurant order ho to) baaki restaurants continue rehte hain)
  - **Preparing** → `preparing` (kitchen me banna start)
  - **Ready for Pickup** → `ready_for_pickup` (ab delivery partner ko pickup ke liye ready signal jaata hai)
- Agar restaurant time pe respond nahi karta, system auto-timeout karke order cancel/refund kar sakta hai.

## Step 8 — Delay Notify Karna
- `POST /v1/food/restaurant/orders/:orderId/delay` — agar order banne me zyada time lag raha hai, restaurant customer ko delay notify kar sakta hai (transparency ke liye).
- `POST /v1/food/restaurant/orders/:orderId/resend-notification` — agar delivery partner ko notification nahi mila, dobara bhej sakta hai.

## Step 9 — Multi-Restaurant Orders (Special Case)
- Agar ek order me 3 alag restaurants se items hain (max limit 3), har restaurant apne `pickups[]` sub-order ko independently accept/reject/prepare karta hai.
- Agar koi ek restaurant reject kar de ya slow ho, admin us restaurant ko order se **drop** kar sakta hai (`permanentlyDropped`) aur us hisse ka **partial refund** ho jata hai customer ko.

## Step 10 — Delivery Partner Pickup Karta Hai
- Jab order `ready_for_pickup` hota hai, delivery partner reach hokar order pick karta hai.
- Restaurant ke paas koi special action nahi hota is step me — sirf order handover karta hai.

## Step 11 — Finance & Payout
- `GET /v1/food/restaurant/finance` — earnings dashboard (kitna kamaya, pending settlement, commission deduction breakdown).
- `POST /v1/food/restaurant/withdraw` — apna earned balance withdraw/payout request karta hai (`RestaurantWallet` → `FoodRestaurantWithdrawal`).
- `GET /v1/food/restaurant/withdrawals` — withdrawal history/status dekh sakta hai.
- Admin in withdrawal requests ko approve karta hai.
- Har order ke completion pe ek `restaurantSettlement` entry banti hai jisme order ka payout, platform commission, GST breakdown record hota hai.

## Step 12 — Support & Complaints
- `restaurant.routes.js` me `/complaints` aur `/support/tickets` — agar restaurant ko customer/delivery related koi issue ho to admin se contact/ticket raise kar sakta hai.

## Restaurant Journey Summary (Ek Line Me Har Step)
1. Phone OTP + draft restaurant auto-create → 2. Onboarding wizard fill (documents upload) → 3. Admin approval wait → 4. Approved → menu setup (categories, foods, addons) → 5. Outlet timings + availability toggle set → 6. Offers create karna (optional) → 7. Live order aana (realtime) → 8. Accept/Reject → Preparing → Ready for Pickup → 9. Delivery partner pickup → 10. Finance dashboard me earnings dekhna → 11. Withdraw request → Admin approve → Payout.

---

# 5. Delivery Partner (Delivery Boy) Flow

Delivery partner ke perspective se pura journey — registration se lekar delivery complete karke payout milne tak.

**Related Files:** Routes: `Backend/src/modules/food/delivery/delivery.routes.js` · Models: `deliveryPartner.model.js`, `DeliveryWallet`, `FoodDeliveryCashDeposit`, `FoodDeliveryWithdrawal` · Frontend: `Frontend/src/modules/driver` (legacy) + `Frontend/src/modules/DeliveryV2` (newer)

## Step 1 — Registration
Dekho [Section 2.3](#23-delivery-partner--onboardingregistrationapproval). Short me:
1. Phone se OTP request → agar record nahi milta, `needsRegistration: true` milta hai.
2. `POST /v1/food/delivery/register` — multipart form: profile photo, Aadhar, PAN, driving license, UPI QR code, bank details.
3. Status `pending` set hota hai.
4. Admin approve/reject karta hai (`status: pending | approved | rejected`).
5. Approved hone tak login response me `pendingApproval: true` milta hai — kaam start nahi kar sakta.

## Step 2 — Online/Offline (Availability Toggle)
- `PATCH /v1/food/delivery/availability` — partner khud ko **online** karta hai jab kaam karna chahta hai. Offline karne par naye orders offer nahi honge.
- Har 30 seconds (approx) ek **heartbeat** socket event bhejta rehta hai (`presence.lastSeenAt`) taaki system ko pata rahe partner active hai.

## Step 3 — Order Milna (Auto-Assignment)
- Jab restaurant order ko `ready_for_pickup` mark karta hai (ya usse pehle bhi, dispatch system nearest available partner dhoondhta hai), system **automatically** sabse paas wale online delivery partner ko order **offer** karta hai.
- `dispatch.status` flow: `unassigned → offered → assigned → accepted` (ya `rejected`/`timed_out` agar partner respond na kare time pe).
- `GET /v1/food/delivery/orders/available` — partner ko dikhne wale available/offered orders ki list.
- Realtime push aata hai socket room `delivery:{id}` ya `all_delivery` broadcast room me.

## Step 4 — Order Accept/Reject
- `PATCH /v1/food/delivery/orders/:orderId/accept` — order accept karna. `dispatch.status → accepted`.
- `PATCH /v1/food/delivery/orders/:orderId/reject` — agar accept nahi karna, reject kar sakta hai (system next nearest partner ko try karega).
- Agar koi bhi partner accept nahi karta time limit ke andar, system **auto-cancel + refund** kar deta hai order (`cancelOrderNoDriverFound`).

## Step 5 — Pickup Restaurant Se
1. `PATCH /orders/:orderId/reached-pickup` — restaurant pahunch gaya, isse mark karta hai. `deliveryState.currentPhase → at_pickup`.
2. `PATCH /orders/:orderId/confirm-pickup` — order restaurant se le liya, confirm karta hai. Order status → `picked_up`. Phase → `en_route_to_delivery`.
- `GET /v1/food/delivery/orders/:orderId/pickup-sequence` — agar multi-restaurant order hai (multiple pickups), kis order me pickup karna hai woh sequence dikhata hai.

## Step 6 — Customer Tak Jaana (Live Tracking)
- Partner apni GPS location bhejta rehta hai socket event `update-location` se — server har 2 second me throttle karke broadcast karta hai `tracking:{orderId}` room me, jise customer aur restaurant dono dekh sakte hain live map pe.
- Location Redis me hot-cache hoti hai instant reads ke liye, aur 30 sec delay ke saath MongoDB me bhi save hoti hai (background job).

## Step 7 — Customer Tak Pahunchna Aur Delivery Confirm
1. `PATCH /orders/:orderId/reached-drop` — customer ke location pe pahunch gaya, mark karta hai. Phase → `at_drop`.
2. Customer ko app me ek 4-digit **Drop OTP** dikhta hai (`GET /v1/food/orders/:orderId/drop-otp` — user side API).
3. `POST /orders/:orderId/verify-drop-otp` — partner customer se OTP lekar verify karta hai. Yeh security step hai taaki order sahi vyakti ko hi mile.
4. `PATCH /orders/:orderId/complete` — OTP verify hone ke baad order complete/deliver mark karta hai. Order status → `delivered`. Phase → `delivered`/`completed`.

## Step 8 — Cash Collection (COD Orders)
- Agar order COD (cash on delivery) tha, partner customer se cash leta hai.
- `POST /v1/food/delivery/orders/:orderId/collect/qr` — QR code se cash collect confirm karta hai.
- `GET /v1/food/delivery/orders/:orderId/payment-status` — payment collected hua ya nahi check kar sakta hai.
- Collected cash ko baad me deposit karna hota hai: `POST /v1/food/delivery/wallet/deposit/order` + `/verify` (Razorpay ke through cash deposit verify hota hai) — partner apne paas jama COD cash ko company ko wapas deposit karta hai.
- `GET /v1/food/delivery/cash-limit` — partner ke paas kitna max cash rakhne ki limit hai (`DeliveryCashLimit`), zyada ho jaye to naye COD orders offer nahi honge jab tak deposit na kare.

## Step 9 — Order Sharing (Dual-Driver Feature)
- Bade/multi-restaurant orders me doosra partner bhi join ho sakta hai help ke liye:
  - `POST /orders/:orderId/share` — original partner share request bhejta hai.
  - `POST /orders/:orderId/accept-share` — doosra partner accept karta hai.
  - `PATCH /orders/:orderId/confirm-split` — split mode decide hota hai (`stop`-wise ya `item`-wise split).
  - Har partner ka apna independent `legs[]` track hota hai (apna pickup/drop/OTP alag).

## Step 10 — Delay Report
- `POST /v1/food/delivery/orders/:orderId/delay` — agar traffic/kisi wajah se delay ho raha hai, customer/restaurant ko notify karne ke liye report karta hai.

## Step 11 — Earnings & Wallet
- `GET /v1/food/delivery/wallet` — current wallet balance.
- `GET /v1/food/delivery/earnings` — earnings breakdown (per-order delivery fee, tip, incentive, bonus).
- `GET /v1/food/delivery/trip-history` — completed orders ki history.
- `GET /v1/food/delivery/pocket-details` — pocket/wallet ka detailed view.
- `POST /v1/food/delivery/wallet/withdraw` — earned amount withdraw request.
- Admin ke through **bonus** (`DeliveryBonusTransaction`), **salary payments** (`DeliverySalaryPayment`), **commission rules** (`DeliveryCommissionRule`) bhi apply hote hain partner ki earnings pe.
- `GET /v1/food/delivery/earning-addons/active` — koi active earning-boost scheme (jaise peak-hour bonus) dikhata hai.
- `GET /v1/food/delivery/referrals/stats` — doosre partners ko refer karne ka bonus stats.

## Step 12 — Safety
- `GET/POST /v1/food/delivery/emergency-help` — emergency SOS button, safety issue ke time use karta hai (`DeliveryEmergencyHelp` model, `SafetyEmergencyReport`).

## Step 13 — Support
- `supportTicket` endpoints — koi bhi issue ho to ticket raise kar sakta hai, admin resolve karta hai.

## Delivery Partner Journey Summary (Ek Line Me Har Step)
1. Phone OTP → registration form (documents upload) → 2. Admin approval wait → 3. Approved → Online/available hona → 4. Nearest order auto-offer hona → 5. Accept → Reach pickup → Confirm pickup → 6. En-route (live location share) → 7. Reach drop → OTP verify → Complete/Deliver → 8. Cash collect (agar COD) → Deposit → 9. Earnings/Wallet check → Withdraw request → Payout.

---

# 6. Admin Flow

Admin poore platform ka control-center hai — sab kuch approve, monitor aur manage karta hai.

**Related Files:** Routes: `Backend/src/modules/food/admin/admin.routes.js` (~250 lines, sabse bada route file) · Frontend: `Frontend/src/modules/Food/pages/admin`

## Step 1 — Login
Dekho [Section 2.4](#24-admin--login). Email + password login, `superadmin`/`subadmin` roles, `permissions[]` based access control.

## Step 2 — Dashboard
- `GET /v1/food/admin/dashboard-stats` — overview: total orders, active restaurants, active delivery partners, revenue snapshot.
- `GET /v1/food/admin/sidebar-badges` — pending-approval counts (kitne restaurants/delivery partners/foods approval wait kar rahe hain) taaki admin ko turant dikhe kya action lena hai.
- `GET /v1/food/admin/search` — global search (order ID, user, restaurant, partner kuch bhi search kar sakta hai).

## Step 3 — Restaurant Management
1. `GET /v1/food/admin/restaurants/pending` — naye onboarding wale restaurants jo review wait kar rahe hain.
2. Har restaurant ka onboarding data dekhta hai (documents, menu, PAN/GST/FSSAI).
3. `PATCH /v1/food/admin/restaurants/:id/approve` → restaurant live ho jata hai.
4. `PATCH /v1/food/admin/restaurants/:id/reject` → reason ke saath reject.
5. `PATCH /v1/food/admin/restaurants/:id/status` — active/inactive/banned status manage karna.
6. `PATCH /v1/food/admin/restaurants/:id/location` — location correct/set karna (delivery zone ke liye zaroori).
7. `GET /v1/food/admin/restaurants/:id/analytics` — us restaurant ka performance (orders count, revenue, ratings).
8. `GET /v1/food/admin/restaurants/:id/menu-pdf` — menu ko PDF format me export karna.
9. **Commissions**: `RestaurantCommission` — har restaurant ka apna commission % set kar sakta hai admin.

## Step 4 — Delivery Partner Management
1. `GET /v1/food/admin/delivery` — sab partners ki list (pending/approved/rejected filter ke saath).
2. `PATCH /v1/food/admin/delivery/:id/approve` / `/reject` — onboarding approval.
3. `GET /v1/food/admin/delivery/join-requests` — naye join requests.
4. `PATCH /v1/food/admin/delivery/:id` — partner detail update.
5. **Wallets & Payments**: partner wallet dekhna, bonus transactions add karna, salary payments process karna, commission rules set karna (per-km/per-order rates), earning-addons manage karna.
6. `GET /v1/food/admin/delivery/:id/reviews` — customer ne partner ko kya rating di.
7. Support tickets resolve karna delivery partners ke liye.

## Step 5 — Category, Food & Addon Approvals
- Restaurant jab naya category/food-item/addon add karta hai, woh **pending approval** me jata hai (quality control ke liye).
- `GET /v1/food/admin/categories/pending`, `PATCH /:id/approve`, `/reject`
- Categories ko `make-global` bhi kar sakta hai (sab restaurants ke liye common category ban jaati hai).
- `GET /v1/food/admin/foods/pending-approvals`, approve/reject similarly.
- Addon approvals bhi same pattern.

## Step 6 — Offers/Coupons Approval
- Restaurant-created offers admin approval se jaate hain: `PATCH /v1/food/admin/offers/:id/approve` / `/reject`.
- `/cart-visibility` — kaun se offers cart me dikhenge control karta hai.
- `/analytics` — offer performance dekh sakta hai.

## Step 7 — Customer Management
- `GET /v1/food/admin/customers` — sab users ki list.
- `GET /v1/food/admin/customers/:id` — ek customer ka detail (order history, wallet, addresses).
- `PATCH /v1/food/admin/customers/:id/status` — customer ban/block/activate karna (fraud/abuse ke case me).
- Bulk COD action — bahut se customers ka COD access ek saath enable/disable karna (COD abuse rokne ke liye).

## Step 8 — Zones Management
- `Zone` model — geo-fencing ke liye zones create karta hai (delivery fee calculation aur dispatch dono isi pe based hote hain).
- Zone-wise delivery fee, service availability set hoti hai.

## Step 9 — Order Oversight
1. `GET /v1/food/admin/orders` — sab orders ki list (filter: status, date, restaurant, partner).
2. `GET /v1/food/admin/orders/:orderId` — full order detail.
3. `PATCH /v1/food/admin/orders/:orderId/cancel` — admin khud order cancel kar sakta hai (dispute/issue ke case me), refund bhi trigger hota hai.
4. `PATCH /v1/food/admin/orders/:orderId/drop-restaurant` — multi-restaurant order me se ek restaurant ko drop karna (partial refund automatic).
5. `PATCH /v1/food/admin/orders/:orderId/assign-delivery` / `/assign-second` — manually delivery partner assign/reassign karna (agar auto-assign fail ho jaye ya koi issue ho). `assignmentHistory[]` me audit trail bhi record hota hai.
6. `DELETE /v1/food/admin/orders/:orderId` — extreme case me order record delete (rare, testing/spam data ke liye).
7. `GET /v1/food/admin/orders/settlement-report` — settlement/payout report.

## Step 10 — Fee, Business & Referral Settings
- `FeeSettings` — platform fee, packaging fee rules set karna.
- `BusinessSettings` — app branding, business info.
- `ReferralSettings` — referral bonus amount kitna dena hai set karna.
- `DeliveryBoySettings` — delivery partner ke liye global settings.

## Step 11 — Safety & Support
- `SafetyEmergencyReport` — koi bhi role (user/partner) emergency report kare to admin yahan dekh kar resolve karta hai.
- `SupportTicket` — user/restaurant/delivery teeno ke support tickets ek jagah manage karna.
- `FeedbackExperience` — app feedback dekhna.
- Restaurant complaints bhi handle karta hai.

## Step 12 — CMS/Content Management
- `PageContent` — static pages (About, Terms, etc.) edit karna.
- `HeroBanner`, `DiningBanner`, `Under250Banner`, `ExploreIcon`, `GourmetRestaurant`, `LandingSettings` — home page ka content/banners manage karna.
- Push notification broadcast bhejna (segment-wise — sab users, ya sirf ek city, etc.)
- FSSAI license expiry ke liye automatic notifications trigger karna restaurants ko.

## Step 13 — Reports & Revenue
- `GET /v1/food/admin/reports/restaurants` — restaurant-wise performance report.
- `GET /v1/food/admin/reports/transactions` — sab transactions ka report.
- `GET /v1/food/admin/reports/tax` — tax/GST report.
- `GET /v1/food/admin/revenue` — platform ki overall revenue.

## Step 14 — Withdrawal Approvals
- Restaurant aur delivery partner dono ke withdrawal requests admin ke paas approval ke liye aate hain.
- Admin verify karke payout process karta hai.

## Admin Journey Summary (Ek Line Me Har Step)
1. Login → 2. Dashboard check (pending approvals badge dekhna) → 3. Restaurant/Delivery/Category/Food/Offer approvals process karna → 4. Zones/Fees/Settings configure karna → 5. Live orders monitor karna, dispute/issue me manual intervene karna → 6. Withdrawal requests approve karna → 7. Reports/Revenue analyze karna → 8. Support tickets/Safety reports resolve karna.

---

# 7. Order Lifecycle — End to End

Ek **single order** ke poore safar ko cover karta hai — jab wo create hota hai se lekar delivered/cancelled hone tak — aur har step me kaun kya karta hai (User + Restaurant + Delivery Partner + Admin saath milkar).

**Related Files:** Model: `Backend/src/modules/food/orders/models/order.model.js` (`FoodOrder`) · Policy: `order-lifecycle.policy.js` (status transitions ka rulebook) · Services: `order.service.js`, `order-checkout.service.js`, `order-payment.service.js`, `order-dispatch.service.js`, `foodOrderPayment.service.js`

## Order Status — State Machine

```
created → confirmed → preparing → ready_for_pickup → picked_up → delivered
                                                            ↑
                                                    (ye terminal/success state hai)

Extra transitions:
- created/confirmed → rejected_by_restaurant
- koi bhi non-terminal state → cancelled_by_user / cancelled_by_restaurant / cancelled_by_admin
- scheduled → created  (jab pre-scheduled order ka time aata hai)
```

**Terminal states** (yahan pahunchne ke baad status nahi badalta): `delivered`, `cancelled_by_user`, `cancelled_by_restaurant`, `cancelled_by_admin`.

Illegal transition try karne par system error de deta hai (`ValidationError` via `assertOrderTransition`) — yeh galti se galat status jump hone se rokta hai (jaise `created` se seedha `delivered` nahi ho sakta).

## Full Step-by-Step Flow

### Phase 1: Order Creation (User Side)
1. User cart me items daalta hai → checkout pe jata hai.
2. `POST /v1/food/orders/calculate` — pricing preview (subtotal, tax, delivery fee, packaging fee, platform fee, discount).
3. `POST /v1/food/orders/` — order create hota hai, status = `created`.
4. **Multi-restaurant support**: agar order me max 3 alag restaurants se items hain, har restaurant ka apna `pickups[]` sub-document banta hai jo independently track hota hai.

### Phase 2: Payment
5. Payment method ke hisaab se:
   - **Cash (COD)**: `payment.status = cod_pending`, koi online step nahi.
   - **Razorpay**: `POST /v1/food/orders/verify-payment` se signature verify hota hai. Webhook (`/v1/payments/webhook`) bhi async confirm karta hai.
   - **Razorpay QR**: `payment.status = pending_qr` phir scan hone pe `paid`.
   - **Wallet**: app wallet balance se turant deduct.
6. Payment status enum: `cod_pending, created, authorized, paid, failed, refunded, pending_qr`.
7. Agar checkout session expire ho jaaye lekin payment ho chuka tha, **automatic refund** trigger hota hai.

### Phase 3: Restaurant Acceptance
8. Order restaurant ko realtime milta hai (socket room `restaurant:{id}` + push notification).
9. Restaurant `PATCH /v1/food/restaurant/orders/:orderId/status`:
   - **Accept** → status `confirmed`
   - **Reject** → status `rejected_by_restaurant` → auto-refund
10. Agar restaurant time pe respond na kare, system auto-timeout/cancel karta hai.
11. Accept hone ke baad restaurant **preparing** mark karta hai → status `preparing`.
12. Khana ban jaane par restaurant **ready for pickup** mark karta hai → status `ready_for_pickup`.

### Phase 4: Dispatch (Delivery Partner Assignment)
13. `dispatch` sub-schema apna alag status track karta hai: `unassigned → offered → assigned → accepted` (ya `rejected`/`cancelled`/`timed_out`).
14. System automatically **nearest available online delivery partner** ko dhoondh kar order **offer** karta hai (`tryAutoAssign`).
15. Partner ke paas offer aata hai (`GET /orders/available`), wo **accept** ya **reject** kar sakta hai.
16. Agar reject kare ya time pe respond na kare, system next nearest partner ko try karta hai.
17. Agar **koi bhi partner na mile** time limit ke andar → order auto-cancel + refund (`cancelOrderNoDriverFound`).
18. Admin bhi manually assign/reassign kar sakta hai zaroorat pade to (audit trail `assignmentHistory[]` me record hota hai).

### Phase 5: Pickup
19. Partner restaurant pahunchta hai → `PATCH /reached-pickup`.
20. Order handover leta hai → `PATCH /confirm-pickup` → order status = `picked_up`.
21. `deliveryState.currentPhase` fine-grained tracking karta hai: `en_route_to_pickup → at_pickup → en_route_to_delivery`.

### Phase 6: Delivery (Live Tracking)
22. Partner ki live GPS location socket ke through broadcast hoti hai `tracking:{orderId}` room me (throttled har 2 second).
23. User aur restaurant dono partner ki location map pe dekh sakte hain realtime.

### Phase 7: Drop / Delivery Confirmation
24. Partner customer ke location pahunchta hai → `PATCH /reached-drop`. Phase → `at_drop`.
25. Customer app me **4-digit Drop OTP** dikhta hai (`GET /orders/:orderId/drop-otp`).
26. Partner customer se OTP maangta hai, `POST /verify-drop-otp` se verify karta hai — yeh ek security check hai galat delivery se bachne ke liye.
27. OTP verify hone ke baad `PATCH /complete` → order status = **`delivered`** (final/success state). Phase → `delivered`/`completed`.

### Phase 8: Post-Delivery
28. User rating deta hai: `PATCH /v1/food/orders/:orderId/ratings` — restaurant aur delivery partner ko **alag-alag** rating/comment (1-5 scale).
29. **Settlement calculation** automatic hota hai:
    - `restaurantSettlement[]` — restaurant ka payout, commission deduction, GST breakdown
    - `driverSettlement` — delivery fee + tip + incentive - deductions = final payout
    - `platformRevenue` — platform fee + commission + delivery margin (company ka profit)
30. `settlementSnapshots[]` — har major event (create/accept/share/partial_drop/complete/admin_cancel) pe ek immutable ledger entry save hoti hai audit ke liye.

## Cancellation & Refund Flow (Kisi Bhi Point Pe Ho Sakta Hai)

| Trigger | Kaun karta hai | Refund kaise |
|---|---|---|
| User khud cancel kare | User (`PATCH /orders/:orderId/cancel`) | User choose karta hai: **wallet** (instant credit) ya **source** (Razorpay refund, original method me, thoda time lagta hai) |
| Restaurant reject kare | Restaurant/System auto | Automatic refund + agar multi-restaurant hai to sirf uss restaurant ka portion refund (baaki continue) |
| Koi delivery partner na mile | System auto | Automatic full refund (`cancelOrderNoDriverFound`) |
| Admin intervene kare | Admin | Admin decide karta hai refund kaise diya jaaye |
| Restaurant order se drop ho (multi-restaurant case) | Admin | Sirf uss restaurant ka **partial refund** (`partialRefunds[]`), baaki order continue rehta hai |

Refund status track hota hai `order.payment.refund.status`: `none → pending → processed`/`failed`.

## Order Sharing — Dual Driver (Special Case)

Bade ya multi-restaurant orders me doosra delivery partner bhi help ke liye join ho sakta hai:
1. Original partner `POST /orders/:orderId/share` se help request bhejta hai.
2. Doosra partner `POST /accept-share` se accept karta hai.
3. `PATCH /confirm-split` — split mode set hota hai: **stop-wise** (alag-alag pickup/drop points) ya **item-wise** (same location, items divide).
4. Har partner ka apna independent `legs[]` track hota hai — alag pickup status, alag drop OTP.

## Quick Reference — Kaun Kya Trigger Karta Hai

| Status | Kaun set karta hai |
|---|---|
| `created` | System (order place hone pe) |
| `confirmed` | Restaurant (accept) |
| `preparing` | Restaurant |
| `ready_for_pickup` | Restaurant |
| `picked_up` | Delivery Partner (confirm-pickup) |
| `delivered` | Delivery Partner (complete, OTP verify ke baad) |
| `rejected_by_restaurant` | Restaurant |
| `cancelled_by_user` | User |
| `cancelled_by_restaurant` | System (auto, agar restaurant timeout) |
| `cancelled_by_admin` | Admin |

---

# 8. Realtime Tracking (Socket.IO) & Notifications

Order tracking realtime kaise kaam karti hai aur notifications (push/email/SMS) kaise bheji jaati hain.

**Related Files:** Socket setup: `Backend/src/config/socket.js` · Notifications: `Backend/src/core/notifications/`

## 8.1 Socket.IO — Realtime System

Ek hi Socket.IO server hai (Redis-adapter se backed ho sakta hai horizontal scaling ke liye), JWT se authenticate hota hai connection ke time.

### Rooms (Kisko Kya Milega)
- `restaurant:{id}` — us restaurant ke saare updates
- `user:{id}` — us user ke saare updates
- `delivery:{id}` — us delivery partner ke updates
- `all_delivery` — sab online delivery partners ko broadcast (jaise naya order offer)
- `tracking:{orderId}` — us specific order ki live location updates (user + restaurant + assigned partner sab isme join hote hain)

### Important Events

| Event | Kaun bhejta hai | Kya hota hai |
|---|---|---|
| `join-restaurant` / `join-delivery` / `join-tracking` | Client | Apne respective room me join hota hai (ownership check hota hai — galat user kisi aur ka room join nahi kar sakta) |
| `update-location` | Delivery Partner | GPS location bhejta hai; server verify karta hai partner is order pe assigned hai; throttle hota hai (2 second gap, Redis ke through); `tracking:{orderId}` room me `location-update` event broadcast hota hai |
| `sync` / `sync_ack` | Client | Agar connection drop ho gaya tha, client apna last cursor bhejta hai aur missed events (`FoodOrderEvent` outbox se) resume kar leta hai — polling ki zaroorat nahi padti |
| `resync` | Client (reconnect pe) | Poora current state dobara mil jata hai (`order_state`, `active_order`, pending drop-OTP bhi agar applicable ho) |
| `heartbeat` | Delivery Partner | Partner "main abhi active hoon" bata raha hai (presence tracking) |

### Location Storage Strategy (Hot/Cold Pattern)
- **Hot (instant reads)**: Redis hash me location save hoti hai (`rider:locations:hot`, `order:locations:hot`) — turant access ke liye.
- **Cold (permanent record)**: 30 second delay ke saath (debounced) ek background BullMQ job MongoDB me bhi likh deta hai — history/audit ke liye.
- Agar Redis/BullMQ kisi wajah se unavailable ho, direct MongoDB write pe fallback ho jata hai (system fail-safe hai).

### Background Workers Bhi Socket Events Bhej Sakte Hain
- Kuch kaam (jaise dispatch timeout check karna) alag background worker process me chalte hain jinke paas live socket connection nahi hota — woh **Redis-backed Emitter** use karke bhi socket events push kar dete hain (jaise "naya order offer" bhejna jab dispatch timeout ho aur next partner try ho).

## 8.2 Notifications System

### Push Notifications (Firebase Cloud Messaging)
- Har role (`FoodUser`, `FoodRestaurant`, `FoodDeliveryPartner`, `Admin`) ke paas apna FCM token store hota hai — **web** aur **mobile** ke liye alag arrays.
- Token register hota hai `/v1/fcm-tokens` API se (login ke time frontend automatically bhejta hai).
- Service worker: `Frontend/public/firebase-messaging-sw.js` (background me bhi notification receive karne ke liye).
- **Kab-kab push jata hai:**
  - Restaurant ko: naya order aane par
  - Delivery Partner ko: naya order offer hone par
  - User ko: order status change hone par (confirmed/preparing/out-for-delivery/delivered)
  - Admin ko: sensitive action hone par (jaise koi admin apna password change kare — sab admins ko security alert jata hai)
  - Admin broadcast: admin segment-wise (sab users, ek city, etc.) custom announcement bhej sakta hai
  - FSSAI license expiry hone wali ho to restaurant ko automatic reminder

### Email
- Sirf specific use-case ke liye hai abhi: **Admin forgot-password OTP** email pe jata hai (SMTP based, `utils/email.js`).

### SMS
- OTP verification (login/signup) ke liye SMS bheja jaana chahiye tha, lekin **abhi actual SMS provider integrate nahi hua hai** (code me `TODO: integrate SMS provider here` comment hai).
- Filhaal dev/staging environment me OTP seedha API response me hi return ho jata hai (`useDefaultOtp` config flag) — testing ke liye convenient hai lekin production-ready SMS gateway abhi missing hai. **Yeh ek gap hai jo production jaane se pehle fix karna hoga.**

### In-App / Event-Sourced Sync
- `FoodOrderEvent` naam ka ek "outbox" model hai — har order-related event yahan store hota hai.
- Isse client reconnect hone pe missed updates ko replay/sync kar sakta hai bina kuch miss kiye — traditional polling se better approach hai, kam server load hota hai.

## 8.3 Summary — Realtime Flow Ek Order Ke Liye

```
Order Created → restaurant room + push notification
Restaurant Accept/Preparing/Ready → user room + push notification (status update)
Dispatch Offer → delivery partner (all_delivery room) + push notification
Partner Accept → user/restaurant room update
Partner Location Update (every 2s) → tracking:{orderId} room (live map)
Order Delivered → user + restaurant + delivery room, final status push
```
