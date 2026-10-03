# Phase Test Plan — Driver-First Food Order Flow

How to test everything shipped in Phases 1–7, one phase at a time, including edge cases.

**Nothing in the 7-phase plan is outstanding** except three deliberate deferrals, listed in
§10. Every phase is currently verified only by `node --check` + code inspection — the repo has
**no test harness** (`npm test` is a stub). Nothing below has been executed against a running
instance. Treat this as the first real verification pass.

Legend — **Type**: `API` (HTTP) · `SOCK` (socket) · `DB` (inspect Mongo) · `RACE` (concurrency)
· `DEVICE` (must be run manually on a real phone). **Auto**: can be automated Y/N.

---

## 0. Before you start

### 0.1 Hard prerequisites
| Thing | Why it matters |
|---|---|
| **COD is disabled** | `createOrder` rejects `cash`/`razorpay_qr` outright. You **cannot** place a cash order. Use **razorpay (prepaid)** or **wallet**. Wallet is far easier for testing — top up a test user and use `paymentMethod: "wallet"`. |
| **Driver-first** | The restaurant **cannot see the order** until a driver accepts (`listOrdersRestaurant` filters `dispatch.status: 'accepted'`). If the restaurant app looks empty, that is correct — accept as a driver first. |
| Redis + BullMQ up | Dispatch retries/timeouts run through BullMQ. With Redis down, dispatch still works but rider location writes go direct to Mongo (see 0.4). |
| ≥2 approved delivery partners | Needed for every race and dual-leg test. |
| ≥2 approved restaurants | Needed for all multi-restaurant tests (max 3 per order). |
| Firebase service account configured | Otherwise all push assertions are untestable. |

### 0.2 Timers are set LOW for testing — check before interpreting results
| Constant | File | Value |
|---|---|---|
| `NO_DRIVER_AUTO_CANCEL_MS` | `order.helpers.js` | **1 min** |
| `RESTAURANT_ACK_RESEND_MS` | `order.helpers.js` | **2 min** |
| `RESTAURANT_ACK_TIMEOUT_MS` | `order.helpers.js` | **5 min** |
| `SHARE_TIMEOUT_MS` | `order.helpers.js` | **5 min** |
| `PICKUP/DROP_GEOFENCE_METERS` | `order.helpers.js` | **1000 m** |
| `RIDER_LOCATION_STALE_MS` | `order.helpers.js` | **10 min** |
| Watchdog interval | `server.js` | **30 s** |
| `splitOrderThreshold` | `FoodDeliveryBoySettings` | **20** (admin-configurable) |

> An order sitting unaccepted for 60s will be **auto-cancelled + refunded**. That is expected,
> not a bug. Raise `NO_DRIVER_AUTO_CANCEL_MS` if it interferes with slower manual testing.

### 0.3 Base paths
```
POST/PATCH  /api/v1/food/delivery/orders/:orderId/...    (role: DELIVERY_PARTNER)
PATCH       /api/v1/food/restaurant/orders/:orderId/...  (role: RESTAURANT)
PATCH       /api/v1/food/admin/orders/:orderId/...       (role: ADMIN)
            /api/v1/food/orders/...                      (role: USER)
```

### 0.4 Geofence testing gotcha (read before Phase 2)
The geofence **fails OPEN** when the rider's last fix is missing or older than 10 min — by
design, so real riders are never blocked. To make a geofence test actually *block*, you must
first push a **fresh** location far from the target:
```
socket.emit('update-location', { orderId, lat: <far>, lng: <far> })
```
With Redis up, that write is buffered and lands in Mongo after ~30s. Wait for it, or stop Redis
to force a direct write. Reading `FoodDeliveryPartner.lastLat/lastLng/lastLocationAt` in Mongo
tells you exactly what the server will use.

---

## 1. Smoke test — baseline single-driver happy path
Run this first. If it fails, do not proceed to the phase suites.

| TC | Steps | Expected | Type | Auto |
|---|---|---|---|---|
| SMK-1 | Place a wallet order (1 restaurant, <20 items) | Order `created`, wallet debited, `tryAutoAssign` fires | API | Y |
| SMK-2 | Driver A accepts | `dispatch.status='accepted'`; **restaurant now sees the order**; customer gets "Delivery partner assigned" | API | Y |
| SMK-3 | Restaurant → `confirmed` → `preparing` → `ready_for_pickup` | Status advances; driver gets `order_ready` | API | Y |
| SMK-4 | Driver: reached-pickup → confirm-pickup | `orderStatus='picked_up'` | API | Y |
| SMK-5 | Driver: reached-drop | OTP generated + delivered to customer | API | Y |
| SMK-6 | Driver: complete with OTP | `delivered`; settlement + earnings recorded once | API | Y |
| SMK-7 | `GET /api/v1/food/orders` as user | Order in history with correct final amount | API | Y |

---

## 2. Phase 1 — two-driver safety (stuck order, race, admin reassign)

### 2.1 F-3A — bulk order can never get stuck
| TC | Preconditions | Steps | Expected |
|---|---|---|---|
| P1-1 | Order with **total quantity ≥ 20** | Driver A accepts | Share slot auto-opens: `dispatch.isShared=true`, **`dispatch.shareOpenedAt` set** (DB check) |
| P1-2 | P1-1, no 2nd driver joins, **before** 5 min | A tries to complete | ❌ Rejected: "requires a second delivery partner" |
| P1-3 | P1-1, wait **> `SHARE_TIMEOUT_MS`** | A completes solo | ✅ Completes. `riderEarning` **restored to full**, `sharedRiderEarning=0`, `isShared=false`, admin alert `bulk_solo_complete` fired |
| P1-4 | — | Inspect `statusHistory` | Contains the "No second partner joined within N min" note |

**Edge cases**
- P1-E1: Order of exactly **20** items → share required (threshold is `>=`, not `>`).
- P1-E2: Order of **19** → no share slot; completes normally.
- P1-E3: `splitOrderEnabled=false` in settings → no share requirement at any quantity.
- P1-E4: 2nd driver joins at 4:59 → normal dual path, **not** solo fallback.
- P1-E5: Complete called twice after solo fallback → 2nd call rejected (already `delivered`).

### 2.2 F-3B — atomic shared-slot join `RACE`
| TC | Steps | Expected |
|---|---|---|
| P1-5 | Two drivers B and C `POST /accept-share` **simultaneously** (same ms) | Exactly **one** wins. Loser gets *"This shared order has already been taken by another partner."* `dispatch.sharedPartnerId` set once |
| P1-6 | Winner B retries the same call | **Idempotent** — returns current state, no error, no duplicate |
| P1-7 | Primary A calls `/accept-share` on own order | ❌ "You already have this order assigned." |
| P1-8 | Any driver calls `/accept-share` after slot filled | ❌ already taken |

> Run P1-5 with a concurrency tool (`ab`, `k6`, or two `curl &` in one shell). A single
> sequential run will *not* exercise the race.

### 2.3 F-3C — admin reassign must not strand anyone
| TC | Steps | Expected |
|---|---|---|
| P1-9 | Bulk order, A primary + B shared. Admin reassigns primary to C | B receives `order_reassigned_elsewhere` (socket **and** push). Share slot **re-opens** (`isShared=true`, `shareOpenedAt` reset) |
| P1-10 | After P1-9, nobody joins, wait > timeout | C can still complete solo — order **not** re-trapped |

---

## 3. Phase 2 — driver-first operational holes

### 3.1 F-1A — restaurant no-response escalation
| TC | Steps | Expected |
|---|---|---|
| P2-1 | Driver accepts; restaurant does nothing **2 min** | Tier 1: restaurant re-notified (`new_order` + push), admin gets `restaurant_ack_pending`, `dispatch.restaurantAckResendAt` set (DB) |
| P2-2 | Keep ignoring until **5 min** | Tier 2: order `cancelled_by_restaurant`, **refund issued**, driver released (`dispatch` freed), customer + driver notified |
| P2-3 | Between tier 1 and 2, watchdog runs again (30s) | Nudge **not** repeated — throttled by `restaurantAckResendAt` |
| P2-4 | Restaurant accepts at 3 min | No escalation; order proceeds normally |

**Edge cases**
- P2-E1: Multi-restaurant, *one* accepts → `orderStatus` leaves `created`, escalation no longer applies.
- P2-E2: Tier-2 fires on a multi-restaurant order → whole order cancelled + refunded (only the primary restaurant is pushed the cancellation — known minor gap, documented).

### 3.2 F-1B — server-side geofence (see §0.4 first)
| TC | Steps | Expected |
|---|---|---|
| P2-5 | Fresh rider fix **>1 km** from restaurant → reached-pickup | ❌ "You appear to be Nm from the restaurant…" |
| P2-6 | Fresh fix **<1 km** → reached-pickup | ✅ Accepted |
| P2-7 | **No** rider location at all → reached-pickup | ✅ Accepted (fail-open — intended) |
| P2-8 | Location **older than 10 min** → reached-pickup | ✅ Accepted (fail-open — intended) |
| P2-9 | Same 4 cases against **reached-drop** (customer address) | Same behaviour |
| P2-10 | Multi-restaurant: fresh fix near restaurant **B** while due at **A** | ❌ blocked (target is the sequenced stop, not any stop) |

### 3.3 F-1C — pickup requires READY
| TC | Steps | Expected |
|---|---|---|
| P2-11 | Single restaurant at `confirmed`/`preparing` → confirm-pickup | ❌ "only pick up… after the restaurant marks it ready" |
| P2-12 | Single restaurant at `ready_for_pickup` → confirm-pickup | ✅ |
| P2-13 | Multi: pickup A `preparing` → confirm-pickup | ❌ "…until it marks the food ready" (names the restaurant) |
| P2-14 | Multi: A `ready`, B `preparing` → confirm-pickup | ✅ collects A only; stays in pickup phase |

### 3.4 F-3D — share eligibility enforced server-side
| TC | Steps | Expected |
|---|---|---|
| P2-15 | Order with **<20** items → `POST /orders/:id/share` **directly via API** (bypassing UI) | ❌ "not large enough to require a second delivery partner" |
| P2-16 | Order with ≥20 → same call | ✅ Slot opens |

---

## 4. Phase 3 — immediate-drop reject policy

| TC | Steps | Expected |
|---|---|---|
| P3-1 | Single restaurant rejects | Order `cancelled_by_restaurant` **immediately**, refund issued, driver released |
| P3-2 | Read the customer/driver messages | **No** "3 attempts" / "resend up to 3 times" wording anywhere |
| P3-3 | `POST /api/v1/food/delivery/orders/:id/resend-to-restaurant` | **404** — route removed |
| P3-4 | Multi (A+B): B rejects, A still active | B dropped + **partial refund to wallet**; order continues with A; customer notified with refund amount |
| P3-5 | Multi: last remaining restaurant rejects | Whole order cancelled + full refund |
| P3-6 | `DB`: check `pickups[].permanentlyDropped` | `true` on first rejection (no strike grace) |

**Post-pickup rejection (F-2 #14)**
| TC | Steps | Expected |
|---|---|---|
| P3-7 | Multi: driver collected A; B then rejects | ✅ B dropped + refunded, and **order auto-advances to the delivery phase** (`picked_up` / `en_route_to_delivery`) — driver is not stranded waiting for a stop that no longer exists |
| P3-8 | Restaurant tries to reject a pickup already `picked_up` | ❌ "already been picked up and can no longer be rejected" |
| P3-9 | Any restaurant rejects when order is `picked_up`/`reached_drop`/`delivered` | ❌ "already out for delivery and can no longer be rejected" |

---

## 5. Phase 4 — state machine + event outbox

### 5.1 Transition guard
| TC | Steps | Expected |
|---|---|---|
| P4-1 | Order at `ready_for_pickup` → call **complete** (skipping pickup) | ❌ "must be picked up first" — this was **accepted** before Phase 4 |
| P4-2 | Order at `picked_up` → complete | ✅ |
| P4-3 | Complete an already-`delivered` order | ❌ blocked (idempotent) |

### 5.2 Outbox + seq `DB`
| TC | Steps | Expected |
|---|---|---|
| P4-4 | Run a full order, then query `food_order_events` for that `orderId` | One row per milestone; `seq` strictly increasing **1,2,3…** with no gaps; every row has a unique `eventId` |
| P4-5 | Check `FoodOrder.eventSeq` | Equals the highest `seq` |
| P4-6 | Two milestones fired near-simultaneously `RACE` | No duplicate `seq` (unique index `{orderId, seq}` must not throw) |

### 5.3 Seq-aware `/sync` `SOCK`
| TC | Steps | Expected |
|---|---|---|
| P4-7 | Connect, `socket.emit('resync')` | `resync_complete` carries `{ lastEventSeq, missedEvents[] }` |
| P4-8 | `socket.emit('resync', { sinceSeq: N })` | `missedEvents` contains **only** events with `seq > N` |
| P4-9 | **Shared/second driver** calls resync | ✅ Returns the shared order — before Phase 4 this returned `null` |
| P4-10 | Disconnect, advance the order, reconnect + resync with last known seq | Exactly the missed milestones are replayed |

---

## 6. Phase 5 — multi-restaurant orchestration

### 6.1 Combined ETA
| TC | Steps | Expected |
|---|---|---|
| P5-1 | Place order where items have differing `preparationTime` | `pickups[].prepMinutes` = that kitchen's **slowest item**; `estimatedTime` = slowest kitchen + travel — **not** the old hardcoded `30` |
| P5-2 | Items with **no** `preparationTime` | Falls back to `DEFAULT_PREP_MINUTES` (15) |
| P5-3 | `preparationTime` as `"15 mins"` string vs number `15` | Both parse to 15 |

### 6.2 Sequencing
| TC | Steps | Expected |
|---|---|---|
| P5-4 | Multi order; inspect `pickups[].sequence` | Farthest-from-customer = `sequence 0`; nearest-to-customer = **last** |
| P5-5 | Driver flow | Sent to `sequence 0` first |
| P5-6 | Stop 0 `preparing` but stop 1 `ready` | Driver is **diverted to stop 1** (never idles at a cold kitchen) |
| P5-7 | Driver app map target | Matches the server's chosen stop (`useProximityCheck` mirrors `getNextPickup`) |

### 6.3 Waiting state + progress
| TC | Steps | Expected |
|---|---|---|
| P5-8 | Reach pickup before food ready | `deliveryState.status='waiting_for_food'`; `currentPhase` still `at_pickup` (UI must not break) |
| P5-9 | Restaurant marks ready | `pickups[].readyAt` set |
| P5-10 | Collect 1 of 2 | `pickupProgress = { picked:1, total:2, label:"Picked up 1 of 2" }` on socket payloads; `pickup_leg_completed` row in outbox |
| P5-11 | **Single**-restaurant order | `pickupProgress.isWaitingForFood` is driven by `orderStatus`, **not** stuck `true` (regression guard) |

---

## 7. Phase 6 — Flow 3 true dual-leg ⚠️ highest-risk suite

> Legs only exist once a second driver joins. Confirm `isDualLeg`, `splitMode` and `legs[]` in
> Mongo at each step.

### 7.1 Split correctness `DB`
| TC | Preconditions | Expected |
|---|---|---|
| P6-1 | ≥20 items across **2 restaurants**, B joins | `splitMode='stop'`; each leg's `restaurantIds` disjoint; both non-empty |
| P6-2 | ≥20 items, **3 restaurants** | Restaurants balanced across 2 legs by item count |
| P6-3 | ≥20 items, **1 restaurant, many lines** | `splitMode='item'`; `itemSplits` balanced; totals equal the order |
| P6-4 | **1 line, quantity 20** (degenerate) | Split **10/10 across the single line** — leg 1 must not be empty |
| P6-5 | Sum every leg's `itemSplits.quantity` | Exactly equals the order's total quantity — no units lost or duplicated |

### 7.2 Independent execution
| TC | Steps | Expected |
|---|---|---|
| P6-6 | Each driver reached-pickup | Only their own stops are targeted (`getNextPickupForLeg`) |
| P6-7 | Secondary driver confirm-pickup | ✅ Allowed — the old "only primary can confirm pickup" block is lifted |
| P6-8 | Each driver reached-drop | Each gets **their own** OTP; customer sees both via `legHandoverOtps` |
| P6-9 | Driver A verifies OTP | Only leg A `otpVerified=true`; leg B untouched |
| P6-10 | A uses **B's** OTP | ❌ Invalid |

### 7.3 Parent completion guard — **the critical test**
| TC | Steps | Expected |
|---|---|---|
| P6-11 | A completes leg A; B still out | Leg A `delivered`; **parent NOT delivered**; **no settlement yet**; `leg_delivered` event |
| P6-12 | B then completes leg B | Parent → `delivered`, settlement runs **exactly once** |
| P6-13 | `DB`: settlement rows/earnings | Each driver credited once; no double settlement |
| P6-14 | A re-submits complete | Idempotent — no second settlement |
| P6-15 | Item-split: A collects, B hasn't | Parent held at `ready_for_pickup` until **both** collected |

### 7.4 Security
| TC | Steps | Expected |
|---|---|---|
| P6-16 | Any driver/restaurant API response containing `legs` | Contains `hasOtp: true/false`, **never** the `otp` value |
| P6-17 | Customer `GET` drop OTP | Returns `legOtps[]` for legs currently `at_drop` and unverified |

### 7.5 Admin
| TC | Steps | Expected |
|---|---|---|
| P6-18 | `PATCH /api/v1/food/admin/orders/:id/assign-second-delivery` | Dual-leg activates; earnings split; both drivers notified |
| P6-19 | Call it twice | ❌ "Maximum 2 drivers already assigned" |
| P6-20 | Call with the **primary** driver's id | ❌ rejected |
| P6-21 | Call on a delivered/cancelled order | ❌ rejected |

### 7.6 Regression — single-driver path MUST be unaffected
| TC | Steps | Expected |
|---|---|---|
| P6-22 | Full normal single-driver order | Identical to SMK-1…7. `legs=[]`, `isDualLeg=false`, `splitMode='none'` |
| P6-23 | Bulk order where **no** 2nd driver joins | Phase-1 solo fallback still works (legs never created) |

---

## 8. Phase 7 — ring, COD gating, noise

| TC | Steps | Expected | Type |
|---|---|---|---|
| P7-1 | Trigger a driver offer; capture the FCM message | `android.notification.channel_id='order_ring'`, `notification_priority='PRIORITY_MAX'`, `ttl='60s'`, `apns-priority: 10`, `data.ring='true'` | API |
| P7-2 | Driver app **killed**, offer sent | Ringing notification appears | **DEVICE** |
| P7-3 | Non-offer notification (e.g. status update) | Uses `channel_id='default'` — unchanged | API |
| P7-4 | Rider with historical cash **≥ limit** in hand, **prepaid** order | ✅ Receives offers **and can accept** — this was broken before Phase 7 | API |
| P7-5 | Same rider, a legacy **cash** order | ❌ Still correctly blocked by cash limit | API |
| P7-6 | `grep -c console.log` on the 3 order services | **0** | — |

> P7-2 cannot be verified from the server. Android requires the client to register a channel with
> id `order_ring`; until the app does, it silently falls back to default behaviour.

---

## 9. Cross-cutting suites

### 9.1 Concurrency `RACE`
- X-1: Two drivers accept the same order simultaneously → exactly one wins ("already accepted by another partner").
- X-2: Two drivers join the same shared slot (= P1-5).
- X-3: Restaurant accept **+** watchdog tier-2 auto-cancel firing at the same instant → one wins, state stays consistent (no order both cancelled and confirmed).
- X-4: Driver completes **+** admin cancels simultaneously → one wins atomically.
- X-5: Same driver account on two devices, both confirm pickup → single transition.

### 9.2 Money safety
- M-1: Trace one order end-to-end: `item total + delivery fee + tax − discount == charged == settled`.
- M-2: Every failure path in §2–4 issues **exactly one** refund (`payment.refund.status='processed'`, never twice).
- M-3: Partial refund (P3-4) reduces `pricing.total` by exactly the dropped restaurant's food + packaging + proportional tax.
- M-4: Dual-leg (P6-12): `riderEarning + sharedRiderEarning` equals the pre-split total (watch the `Math.round` — flag any ₹1 drift).
- M-5: Wallet order cancelled → wallet re-credited exactly once.

### 9.3 Real-time
- R-1: Every stage emits both socket **and** FCM to the right actors.
- R-2: Kill the app at **each** stage for **each** actor; on relaunch `/sync` restores correct state.
- R-3: Confirm there is **no polling** — only the active-delivery GPS stream should be periodic.

---

## 10. Known gaps — deliberately not shipped, so don't test for them
1. **Live socket payloads carry no `seq`/`eventId`; no client-side dedup** (deferred 4b). Recovery works via `/sync` replay only.
2. **No multi-stop list UI** in the driver app (deferred 5b) — sequencing works, but stops aren't rendered as an ordered list.
3. **No customer two-driver tracking UI / no restaurant labelled-handover UI** (deferred 6b). `legProgress` and the split map are served but unrendered.
4. Tier-2 multi-restaurant cancellation only pushes to the primary restaurant.

---

## 11. Suggested order of execution
1. §1 smoke — proves the baseline.
2. §7.6 regression (P6-22/23) — proves the 7 phases didn't break normal orders. **Do this early.**
3. §4 Phase 3, §5 Phase 4, §3 Phase 2 — cheap, high signal.
4. §2 Phase 1 and §6 Phase 5.
5. §7 Phase 6 — most complex, needs 2 drivers.
6. §8 Phase 7, then §9 cross-cutting.

**Stop-ship triggers:** any failure in P6-11/12/13 (double or missing settlement), P1-5 (race),
M-1/M-2 (money), or §7.6 (single-driver regression).
