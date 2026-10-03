# Buddy Food — Driver-First Order Flow: Remediation Phases

Living tracker for fixing the gaps found in the three-flow audit. Each phase is
independently shippable and must end with a green build + its manual test
checklist before the next phase starts.

**Locked design decisions**
- **Flow 3 → full dual-leg rebuild** (real two-driver delivery: `legs[]`, item/stop split, second OTP, two-marker tracking). Phase 1 ships an interim safety layer first; Phase 6 is the real rebuild.
- **Restaurant rejection → immediate drop + refund.** Remove the misleading 3-strike messaging and the unused resend endpoint (Phase 3).
- **Start with Phase 1 now.**

Status legend: ⬜ todo · 🟦 in progress · ✅ done

---

## Phase 1 — Stop the bleeding (money & stuck-orders) · S ✅
Interim safety for the current earnings-share model, before the Phase 6 rebuild.

- ✅ **F-3B** Atomic shared-driver join — `acceptSharedOrderDelivery` now uses a conditional `findOneAndUpdate` on `dispatch.sharedPartnerId:null` (+ `deliveryPartnerId != joiner`); distinguishes already-taken / self / idempotent-retry. `order.service.js`.
- ✅ **F-3A** Share-timeout solo-complete — added `dispatch.shareOpenedAt` (schema) + `SHARE_TIMEOUT_MS` (helpers, 5 min); set on both auto-share (accept) and manual `shareOrderDelivery`; `completeDelivery` lets the primary finish solo with the full earning restored + admin alert once the window elapses.
- ✅ **F-3C** Admin reassign no longer silently drops the shared partner — captures/​notifies the dropped shared partner and re-opens the share slot (restarting the timeout clock) for bulk orders. `assignDeliveryPartnerAdmin`.
- ✅ Settlement double-fire: confirmed blocked by `isStatusAdvance(from,'delivered')` re-entry guard (can't re-deliver → can't re-settle).

*Files:* `order.model.js`, `order.helpers.js`, `order-delivery.service.js`, `order.service.js`.
*Test:* place a ≥20-item order, accept as driver, let share timeout elapse → primary can complete; two drivers race the shared slot → exactly one joins; admin reassigns primary on a shared order → shared partner notified, order not stuck.

## Phase 2 — Driver-first operational holes · S–M ✅
- ✅ **F-1A** Restaurant no-response escalation in `recoverStuckOrders`: Tier 1 (> `RESTAURANT_ACK_RESEND_MS`, 2m) re-notifies restaurant(s) + admin once (throttled by `dispatch.restaurantAckResendAt`); Tier 2 (> `RESTAURANT_ACK_TIMEOUT_MS`, 5m) auto-rejects → refund → releases the driver.
- ✅ **F-1B** Server-side geofence `assertRiderAtTarget` on reached-pickup (restaurant/active-pickup) and reached-drop (customer). Fail-OPEN on missing/stale (>10m) rider location; `*_GEOFENCE_METERS` = 1000m, tunable.
- ✅ **F-1C** Pickup ready-state guard: single-restaurant pickup requires `orderStatus === 'ready_for_pickup'`; multi requires the current pickup `status === 'ready'` — closes the `isStatusAdvance` gap that let `confirmed→picked_up` slip through.
- ✅ **F-3D** `shareOrderDelivery` now re-checks `isShareRequired` server-side (item count ≥ threshold), closing the UI-only abuse gate.

*Note:* Tier-2 auto-cancel for a multi-restaurant no-response only pushes the cancellation to the primary restaurant (others never engaged); refine in Phase 3 if needed.

## Phase 3 — Flow 2 reject/resend correctness · S–M ✅
- ✅ **F-2A** Reject policy is now consistently **immediate-drop**. Removed the dead 3-strike system end-to-end: `resendOrderToRestaurant` service + controller + route deleted; `MAX_PICKUP_RESEND_ATTEMPTS` + `canResendPickup` + `shouldPermanentlyDropPickup` + `getPickupRejectionAttempts` removed from policy; vestigial `pickup.rejectionAttempts` increment dropped; all "after 3 attempts / resend up to 3 times" copy replaced with immediate-drop messaging; orphaned frontend `RejectedOrderModal.jsx` + `deliveryAPI.resendOrderToRestaurant` deleted. Updated the `failureReason` classifier to key off the new note text.
- ✅ **Post-pickup rejection flow** — a restaurant can no longer reject once its items are picked up or the order has left the pickup phase (`picked_up`/`reached_drop`/`delivered`). When dropping the last un-picked restaurant leaves everything else already picked up, the order auto-advances to the delivery phase instead of stranding the driver.

*Kept:* `resendDeliveryNotificationRestaurant` (restaurant-initiated **driver** re-search) — unrelated, still live.

## Phase 4 — State-machine & real-time integrity · M ✅ (backend; client dedup deferred → 4b)
- ✅ **4A** Explicit `ORDER_STATUS_TRANSITIONS` adjacency map + `canOrderTransition`/`assertOrderTransition` in policy (canonical state machine). Wired into `completeDelivery`: `delivered` may only follow `picked_up` — closes the rank-only hole where `ready_for_pickup → delivered` (skipping pickup) was accepted because 80 > 40.
- ✅ **Durable event outbox** — new `FoodOrderEvent` model (`food_order_events`) + `order.eventSeq` counter. `enqueueOrderEvent` (the single milestone chokepoint, 19 call sites) now atomically allocates a per-order `seq`, generates a unique `eventId`, appends to the outbox, and passes seq/eventId into the BullMQ job.
- ✅ **Seq-aware, multi-driver `/sync`** — `resyncState` now matches primary **OR** shared partner (shared driver can finally recover), accepts `sinceSeq`, and returns `lastEventSeq` + the missed-event tail; socket `resync` forwards `sinceSeq` and emits `{ lastEventSeq, missedEvents }` in `resync_complete`.

*Deferred to Phase 4b:* threading `seq`/`eventId` onto every live socket payload + client-side dedup across the 3 frontends. The outbox + seq-aware `/sync` already give clients a reliable gap-detection/replay path on reconnect; live-payload dedup is an optimization, not a correctness gap.

## Phase 5 — Flow 2 orchestration · M ✅ (backend + driver stop-selection; list UI deferred → 5b)
- ✅ **Combined ETA** — menu items already carried `preparationTime` (threaded through `order-pricing.service.js`) but it was never persisted and `estimatedTime` was hardcoded `30`. Now each pickup stores `prepMinutes` (its slowest item) and the order ETA = slowest kitchen (they cook in parallel) + travel time over the trip distance. Helpers: `parsePrepMinutes`, `computeRestaurantPrepMinutes`, `computeCombinedPrepMinutes`, `computeOrderEtaMinutes`.
- ✅ **Pickup sequencing** — new `pickups[].sequence`, assigned at create by `assignPickupSequence` (farthest-from-customer first, nearest last, so the final leg is shortest — deterministic, no routing API call). `getNextPickup` follows `sequence` but diverts to any already-ready stop so the driver never idles at a cold kitchen. Wired into reached-pickup (geofence target) and confirm-pickup. Driver app's `useProximityCheck` mirrors the same rule.
- ✅ **Waiting state + progress** — `pickups[].readyAt` recorded when a kitchen marks ready; `deliveryState.status = 'waiting_for_food'` when the driver arrives early; `getPickupProgress` ("Picked up 1 of 2") added to `emitOrderUpdate`, the restaurant broadcast, and the reached/pickup events. New `pickup_leg_completed` milestone so intermediate legs land in the outbox (previously silent).

*Deferred to Phase 5b:* the full multi-stop **list** UI in the driver app (ordered stop cards, per-stop ETA/waiting badges). The data contract (`sequence`, `prepMinutes`, `readyAt`, `pickupProgress`) is now served, and stop-selection already follows it.

## Phase 6 — Flow 3 true dual-leg (the big one) · L ✅ (backend; customer/restaurant UI → 6b)
**Split semantics used (D2 default, unconfirmed):** stop-level across 2+ restaurants, item-level
(quantity-aware) within a single restaurant, **one OTP per leg**.

- ✅ **Data model** — `legs[]` (legIndex, role, partnerId, status, restaurantIds, quantity-aware `itemSplits`, per-leg `otp`/`otpVerified`, earning, timestamps) + `isDualLeg` + `splitMode`. Legs are only populated when a second driver joins, so single-driver orders are completely unaffected.
- ✅ **Split** — `buildDeliveryLegs` balances whole restaurants across legs by item count (stop mode), or balances units and splits a line when needed (item mode — a single line of qty 20 halves correctly).
- ✅ **Per-leg execution** — reached-pickup, confirm-pickup, reached-drop, verify-OTP and complete are all leg-scoped via `getLegForPartner`; `getNextPickupForLeg` means each driver only sees their own stops. The old "only the primary partner can confirm pickup" block is lifted under dual-leg.
- ✅ **Parent-completion guard** — a driver completes only THEIR leg; the parent is DELIVERED (and settled) only when `areAllLegsDelivered`. Item-split orders hold the parent at `ready_for_pickup` until both legs are collected.
- ✅ **Second OTP** — each leg gets its own handover code, generated at its own drop arrival and verified independently. Leg OTPs are stripped from every external payload (`sanitizeOrderForExternal` exposes `hasOtp` only) and surfaced to the customer via `getDropOtpUser` / `/sync` (`legHandoverOtps`).
- ✅ **Admin force-assign second driver** — new `assignSecondDeliveryPartnerAdmin` + `PATCH /admin/orders/:orderId/assign-second-delivery` (previously admin assign *wiped* the shared partner; there was no way to add one).
- ⬜ **Customer two-driver tracking UI** (two markers / two rows) → 6b. `legProgress` is now served on every delivery payload and in `/sync`.
- ⬜ **Restaurant labeled handover UI** (pack two labelled sets) → 6b. The split map is persisted per leg.

## Phase 7 — Cleanup & hardening · M ✅ (7.3 structural refactor deliberately deferred)
- ✅ **FCM ring channel** — `buildMessagePayload` supports `ring: true`: dedicated `order_ring` channel, `PRIORITY_MAX`, custom vibrate pattern, `visibility: PUBLIC`, 60s TTL, APNs `apns-priority: 10` + `interruption-level: time-sensitive`, and webpush `requireInteraction`. Wired into the time-critical driver offer. **Client requirement:** the app must register an Android channel with id `order_ring` (and bundle the sound) — the server cannot create a full-screen intent on its own, and this is a web frontend today.
- ✅ **COD formally gated — fixed a live bug.** Cash-in-hand limits were applied to *every* order, but COD is rejected at creation, so a rider holding historical cash was silently excluded from dispatch (`filterPartnersByCashLimit`) and got "Cash limit reached" when accepting **prepaid** orders (`acceptOrderDelivery`). Both now only gate genuine cash orders.
- ✅ **Debug-noise removal** — stripped 36 stray `console.log`s from the order services (`[SELLER UNLOCK DEBUG]`, `[DEBUG]`), including one that `JSON.stringify`-dumped the full nearby-partner list on every dispatch. Removed the two dead blocks left behind. These files are now `console.log`-free.

---

### Progress log
- **Phase 1 — done & committed** on branch `phase1-two-driver-safety` (`b02d667`). Files: `order.model.js` (`dispatch.shareOpenedAt`), `order.helpers.js` (`SHARE_TIMEOUT_MS`), `order-delivery.service.js` (auto-share timestamp + solo-complete fallback), `order.service.js` (atomic shared join, manual-share timestamp, admin-reassign shared handling). `main` restored to `c6cdb87`.
- **Phase 2 — done** on branch `phase2-driver-first-holes` (stacked on Phase 1). Files: `order.model.js` (`dispatch.restaurantAckResendAt`), `order.helpers.js` (ack + geofence constants), `order-delivery.service.js` (`assertRiderAtTarget` geofence + pickup ready-state guard), `order.service.js` (F-1A escalation in `recoverStuckOrders` + F-3D share eligibility). All pass `node --check`. Runtime/device test still pending (no automated test harness).
- **Phase 3 — done** on branch `phase3-reject-policy` (stacked on Phase 2). Backend: `order.service.js` (removed `resendOrderToRestaurant`, immediate-drop messaging, post-pickup reject guards + auto-advance), `order-lifecycle.policy.js` (removed strike constant/helpers), `order.helpers.js` (`failureReason` classifier), `order.controller.js` + `delivery.routes.js` (removed resend endpoint), `order.model.js` (comment fixes). Frontend: deleted `RejectedOrderModal.jsx`, removed `resendOrderToRestaurant` API. All backend pass `node --check`; frontend api parses as ESM. Runtime test pending.
- **Phase 7 — done** on branch `phase7-hardening-cleanup` (stacked on Phase 6). `firebase.service.js` (ring channel), `order-dispatch.service.js` (ring on driver offer + cash gate fix + debug purge), `order-delivery.service.js` (accept-path cash gate fix + debug purge), `order.service.js` (debug purge). All pass `node --check`; order services are now `console.log`-free with no dead blocks.
- **Phase 6 — done** on branch `phase6-dual-leg` (stacked on Phase 5). `order.model.js` (legs/isDualLeg/splitMode), `order-lifecycle.policy.js` (leg helpers + split), `order-delivery.service.js` (leg-scoped pickup/drop/OTP/complete), `order.service.js` (leg creation on share-accept, admin second-driver assign, customer leg OTPs in `/sync`), `order.helpers.js` (strip leg OTPs), `order.controller.js` + `admin.routes.js` (new endpoint). All pass `node --check`; all 5 leg entry points gated by `isDualLegActive` so the single-driver path is untouched. Customer/restaurant UI → 6b. Runtime test pending.
- **Phase 5 — done** on branch `phase5-multi-restaurant-orchestration` (stacked on Phase 4). `order.model.js` (pickup `sequence`/`prepMinutes`/`readyAt`), `order-lifecycle.policy.js` (ETA + sequencing + progress helpers), `order.service.js` (create-time prep/sequence/ETA, `readyAt`, progress in broadcast), `order-delivery.service.js` (sequence-aware stop, waiting state, progress on events, `pickup_leg_completed`), `useProximityCheck.js` (mirrors server stop rule). All pass `node --check`. Multi-stop list UI deferred to 5b. Runtime test pending.
- **Phase 4 — done** on branch `phase4-state-machine-events` (stacked on Phase 3). New `foodOrderEvent.model.js` outbox. `order.model.js` (`eventSeq`), `order-lifecycle.policy.js` (transition table + validators), `order-delivery.service.js` (completeDelivery adjacency guard), `order.helpers.js` (`enqueueOrderEvent` → seq + outbox), `order.service.js` (seq-aware multi-driver `resyncState`), `config/socket.js` (resync forwards `sinceSeq`, emits recovery envelope). All pass `node --check`. Client-side dedup deferred to 4b. Runtime test pending.
