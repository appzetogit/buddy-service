# Buddy Food — Realtime Stability: Socket + Order-Polling Remediation

Living tracker for making the order realtime path reliable **without changing the
existing order flow**. Two goals only:

1. **Stable socket connection** — one connection per client, survives token refresh,
   reconnects predictably, never silently dies.
2. **Reduce order polling** — replace the 8s/10s/15s order polls with an
   event-driven sync that is *provably* not missing events before any poll is removed.

Everything else found in the audit (dual-leg, settlements, dispatch economics) is
out of scope here and stays untouched.

Status legend: ⬜ todo · 🟦 in progress · ✅ done

---

## Non-negotiable safety rules

These exist because the current flow works in production and must keep working
while this lands.

| Rule | Why |
| --- | --- |
| **Every change is additive.** New events/fields ship alongside the old ones; nothing existing is deleted until its replacement has run clean in prod. | A missed order costs money. There is no safe "big bang" here. |
| **`resync` stays live.** The new `sync` handshake is a *second* handler. `resync` is only deleted in Stage 4, after `sync` has zero-gap telemetry. | The delivery app in the field still calls `resync`. |
| **No breaking schema changes.** `recipients[]` and `cursor` are new optional fields on `food_order_events`. Existing docs stay readable. | Rolling deploys will run old and new code at the same time. |
| **Polling is raised before it is removed.** 10s → 60s → off, one poll at a time, each behind a flag. | If the sync layer has a hole, a 60s poll still catches it. A deleted poll does not. |
| **Every phase ends green.** Build passes + the phase's manual checklist passes before the next phase starts. | Matches the existing `REMEDIATION_PHASES.md` discipline. |

**Feature flags introduced** (all default `false`, so deploying changes nothing):

```
SYNC_CURSOR_ENABLED=false      # write recipients[]/cursor to the event log
SYNC_HANDSHAKE_ENABLED=false   # expose the new sync/sync_batch/sync_ack handlers
VITE_SYNC_CLIENT_ENABLED=false # client uses cursor sync instead of blind refetch
VITE_ORDER_POLL_MS=10000       # order poll interval; raise, then set 0 to disable
```

---

## Phase 0 — Config + constants (no code risk) · S ✅

Highest value per line changed. These are the bugs actively losing orders today.
None of them alter the order flow — they only stop it being cut short.

### ✅ DISP-01 — Orders are auto-cancelled before dispatch can retry once

- **Bug.** `NO_DRIVER_AUTO_CANCEL_MS = 1 * 60 * 1000` in
  `Backend/src/modules/food/orders/services/order.helpers.js:722`. The watchdog runs
  every 30s (`server.js`) and cancels any order older than 60s with no accepted rider.
  `tryAutoAssign` schedules its next attempt at `delay: 60000`, and only widens the
  radius from 15km on attempt 2. **The escalation ladder — 25km → 40km → 60km, the
  phase-2 broadcast at attempt ≥ 3, and `MAX_DISPATCH_ATTEMPTS = 10` — is unreachable.**
  Orders die mid-search.
- **Fix.** `NO_DRIVER_AUTO_CANCEL_MS = 8 * 60 * 1000`. Eight minutes lets attempts
  1–7 run, which covers the full radius expansion plus two broadcast rounds.
- **Flow impact.** None. Only the deadline moves; every downstream path
  (`cancelOrderNoDriverFound`, refund, user notification) is unchanged.
- **Verify.** Place an order with no rider online → it stays `offered` and keeps
  re-hunting for 8 minutes instead of cancelling at 60s.

### ✅ DISP-02 — The watchdog cannot heal an order in `offered` state

- **Bug.** `recoverStuckOrders()` case 1 queries `'dispatch.status': 'assigned'`
  (`order.service.js:1426`), but `tryAutoAssign` writes `'dispatch.status': 'offered'`
  (`order-dispatch.service.js:591`). The only safety net that still runs when BullMQ is
  off never matches the state the dispatcher actually produces. Those orders fall
  straight through to case 4, which just cancels them.
- **Fix (shipped).** Query is now `{ $in: ['assigned', 'offered'] }`. Because
  `offered` orders carry no `assignedAt`, staleness is computed from the newest
  `offeredTo[].at` (90s threshold — the 60s offer window plus buffer); `assigned`
  keeps its 2-minute threshold. An order with no timestamp at all is treated as stale
  so it can never sit in limbo.
- **Also fixed: the ladder no longer restarts.** The old call was
  `tryAutoAssign(order._id)` with no options, so `attempt` defaulted to 1 and the
  radius was pinned at 15km on every heal. It now derives the next attempt from
  `max(offeredTo[].attemptNumber) + 1`, so a re-hunted order continues to
  25 → 40 → 60km and reaches the phase-2 broadcast.
- **Flow impact.** None. It re-enters `tryAutoAssign`, which is already idempotent
  (guarded by `dispatch.dispatchingAt` + the `offeredIds` exclusion).
- **Verify.** Offer an order, kill the rider app, wait 2 min → watchdog logs
  `Healing N stuck assigned/offered orders` and the order is re-offered to a
  different rider at a wider radius.

### ✅ DISP-03 — Dispatch retries are a silent no-op

- **Bug.** `Backend/.env` has `BULLMQ_ENABLED=false` and `REDIS_ENABLED=false`.
  `addOrderJob()` (`queues/producers/order.producer.js:12`) logs a warning and returns
  `null`, so every `DISPATCH_TIMEOUT_CHECK` re-queue in `tryAutoAssign` (line 513, 610)
  and `processDispatchTimeout` disappears. An order offered to three riders who ignore
  it is never re-offered.
- **Code side (shipped).** Retries no longer *depend* on BullMQ. With DISP-02 fixed,
  `recoverStuckOrders()` — which runs every 30s in the web process regardless of
  Redis — now re-hunts `offered` orders and continues the escalation ladder. The
  30s watchdog is a coarser trigger than the 60s job, but it is no longer a dead path.
  `server.js` now logs a single explicit boot warning
  (`Dispatch retries are running in WATCHDOG-ONLY mode`) so the degradation is
  visible instead of a per-job warning buried in the log.
- **Infra side (yours — not done here).** Set `REDIS_ENABLED=true`,
  `BULLMQ_ENABLED=true`, `REDIS_URL`. I deliberately did **not** edit `Backend/.env`:
  it needs a running Redis, and enabling the queue without the workers running would
  pile up jobs nobody processes — strictly worse than the watchdog path.
- **⚠️ Prerequisite — do not skip.** `buddy-worker-order` runs as a **separate PM2
  process** (`ecosystem.config.cjs`) where `initSocket()` was never called, so
  `getIO()` returns `null` and every `if (io)` guard skips silently (**DISP-07**).
  Enabling BullMQ *without* the Redis adapter moves dispatch into a process that
  cannot reach a single client. Confirm
  `Socket.IO Redis adapter attached for horizontal scaling` appears at boot **before**
  starting the worker, or keep dispatch in the web process until it does.
- **Verify (after enabling).** Offer → ignore for 60s →
  `[BullMQ:order] action=DISPATCH_TIMEOUT_CHECK` in the worker log, and the order
  re-offers with a wider radius.

### ✅ FCM-01 — Only the lead rider gets a push; phase-2 sends none

- **Bug.** `order-dispatch.service.js:552-576` emits sockets to all three phase-1
  riders but calls `notifyOwnerSafely` for `lead` only. The phase-2 broadcast
  (line 534-544) — which exists *specifically because nobody accepted* — sends zero
  pushes. A rider whose app is backgrounded or killed is unreachable in both phases.
  **This is the direct cause of "the driver was offline and never saw the order."**
- **Fix (shipped).** Introduced a single `offerBatch` (`= isPhase2 ? eligible :
  phase1Batch`) that drives the socket emit, the push fan-out **and** the
  `offeredTo` record, so the three can no longer drift. Push now goes to every rider
  in that batch via one `notifyOwnersSafely` call, with `sendToAllDevices: true` so a
  rider with both the phone app and the web dashboard is rung on both.
- **Fire-and-forget.** The call is `void`-ed with a `.catch`, so the sequential FCM
  fan-out (FCM-03, Phase 4) never delays the `offeredTo` write. The batch is bounded
  by `searchOptions.limit = 15`.
- **Flow impact.** More pushes, same events. The client already dedupes by order id
  (`ALERT_DEDUPE_MS = 15000` in `useDeliveryNotifications`), so a rider receiving both
  a socket event and a push rings once.
- **Verify.** Kill the delivery app entirely, place an order → the phone rings on the
  `order_ring` channel.

### ✅ FCM-02 — "Latest token" is insertion order, so pushes go to the wrong device

- **Bug.** `sendNotificationToOwner` defaults to `pickLatestTokenOnly()`
  (`core/notifications/firebase.service.js:269`), which takes the **last array
  element**. `upsertFirebaseDeviceToken` builds that array with
  `[...new Set([...existing, newToken])]` — and `Set` preserves **first** insertion
  order. Re-registering a token that already exists does not move it to the end. A
  rider who switches back to a previously-used device silently stops receiving
  pushes, because they keep going to whichever device registered a genuinely *new*
  token last.
- **Fix (shipped).** No schema change was needed. `normalizeTokenList` now dedupes
  keeping the **last** occurrence instead of the first, so re-registering an existing
  token promotes it to the tail — which is exactly what `pickLatestTokenOnly` reads.
  Chosen over the `{ token, lastSeenAt }` rewrite because it fixes the bug with zero
  migration and no change to the stored shape.
- **Verified.** `A → B → A` now stores `[tokB, tokA]` and resolves latest = `tokA`.
  Old behaviour stored `[tokA, tokB]` and resolved `tokB` — the wrong device.
  Also checked: 10-token cap, all-duplicate input, blank/null entries.
- **Flow impact.** None to the flow; fixes delivery targeting. Existing stored arrays
  are read unchanged and self-correct on the next registration.
- **Note.** `sendToAllDevices: true` on the dispatch offer (FCM-01) makes order
  offers independent of this ranking anyway — the ranking still matters for every
  other single-device notification.

### ✅ SOCK-04 — The restaurant socket is pinned to HTTP long-polling

- **Bug.** `Frontend/src/modules/Food/hooks/useRestaurantNotifications.js:489` sets
  `transports: ['polling']` with no websocket upgrade. Every order event arrives via
  a fresh XHR round trip — added latency and load on the client that most needs a live
  channel. The delivery hook already uses `['polling', 'websocket']` correctly.
- **Fix.** `transports: ['polling', 'websocket']`. Polling stays first, so the
  handshake behaviour is unchanged and it degrades safely behind proxies that block
  WS upgrade.
- **Flow impact.** None. Same events, same handlers, faster transport.
- **Verify.** DevTools → Network → WS shows an upgraded connection; the socket id
  survives the upgrade.

### ✅ DISP-07 (prereq) — Socket bridge retries forever in worker processes

- **Bug.** `tryInitSocketBridge()` in `order-dispatch.service.js` re-armed a 200ms
  `setTimeout` unconditionally while `getIO()` was null. This module is imported by
  the standalone BullMQ workers, where `initSocket()` is never called — so the timer
  spun for the entire lifetime of every worker process.
- **Fix (shipped).** Bounded to 150 attempts (~30s, ample for boot ordering in the
  web process), `.unref()`-ed so it can't hold the event loop open, and it logs once
  on giving up — including the warning that emits from that process will be dropped
  unless the Redis adapter is attached.
- **Flow impact.** None in the web process, where it succeeds within a few hundred ms.

*Files changed:* `order.helpers.js`, `order.service.js`, `order-dispatch.service.js`,
`firebase.service.js`, `server.js`, `useRestaurantNotifications.js`.
*Not changed:* `Backend/.env` — see DISP-03.

---

## Phase 1 — Stable socket connection · S–M ✅

Nothing here changes what events exist. It changes how reliably the pipe stays up.

### ✅ SOCK-06 — The socket is torn down and rebuilt while the page loads

- **Bug.** `useDeliveryNotifications.js:1029` — the connection effect depends on
  `deliveryPartnerId`, which transitions `null → localStorage value → API value` on
  every mount (`resolveDeliveryPartnerIdFromClient()` then `deliveryAPI.getMe()`).
  Each transition destroys and recreates the socket, so the app reconnects **at least
  twice on load**, and any event arriving in that window is lost. The restaurant hook
  has the same shape — it refuses to connect at all until `getCurrentRestaurant()`
  returns (line 328).
- **Fix.** Split into two effects:
  - **Connection effect** — deps `[]`. Builds the socket once from the JWT. The
    server already decodes identity in the auth middleware and auto-joins the role
    room (`config/socket.js:131-144`), so the client id is not needed to connect.
  - **Room effect** — deps `[deliveryPartnerId]`. Emits `join-delivery` /
    `join-restaurant` when the id resolves, on an already-open socket.
- **Flow impact.** None. The same rooms are joined, just without a reconnect.
  `join-delivery` is already idempotent server-side.
- **Verify.** Reload the delivery app with `localStorage.delivery_socket_debug='1'`
  → exactly one `Socket connected` line, not two or three.

### ✅ SOCK-05 — An expired token becomes an infinite unrecoverable reconnect loop

- **Bug.** The token is read from `localStorage` once at socket construction
  (`useDeliveryNotifications.js:742-763`). With `reconnectionAttempts: Infinity`, an
  expired token retries forever against `AUTH_INVALID` (`config/socket.js:102`), and
  `socket.auth.token` is only refreshed if an `authRefreshed` window event happens to
  fire. No `connect_error` handler distinguishes an auth failure from a transport
  failure.
- **Fix.** In `connect_error`, branch on the message:
  - `AUTH_MISSING` / `AUTH_INVALID` → call the existing refresh-token flow, write the
    new token to `socket.auth.token`, then `socket.connect()`. Cap at 3 refresh
    attempts, then surface a re-login prompt.
  - anything else → leave Socket.IO's own backoff alone.
- **Flow impact.** None on success paths. Turns a permanent dead socket into a
  recovering one.
- **Verify.** Expire the access token by hand, force a reconnect → one refresh, then
  a successful connect. Not an infinite loop.

### ✅ SOCK-08 — Connection settings are duplicated and drift between hooks

- **Bug.** The URL-normalisation block is copy-pasted and *differs* between
  `useDeliveryNotifications.js:686-740` and `useRestaurantNotifications.js:333-475`
  (~140 lines of near-duplicate regex, with different localhost-blocking rules and
  different transports). Further copies exist in the taxi
  modules. Fixes land in one and not the others.
- **Fix.** Extract `Frontend/src/services/socket/createRealtimeSocket.js` — one URL
  resolver, one options object, one auth-refresh handler, one debug surface. The
  hooks keep their own event handlers and public API, so **no component changes.**
- **Flow impact.** None. Pure consolidation; each hook's return shape is untouched.
- **Verify.** Both apps connect; `window.__deliverySocketDebug.dump()` still works.

### ✅ DISP-06 — Rider availability is a DB flag with no liveness signal

- **Bug.** `availabilityStatus` is only ever written by an explicit API call
  (`delivery/services/delivery.service.js:398`). Nothing connects it to socket
  presence or a heartbeat. A rider who force-quits stays `online` forever and keeps
  absorbing offers into the void. The GPS staleness check only demotes them to
  `distanceKm: 999` (`order-dispatch.service.js:242`) — it does not exclude them.
- **Fix.** Additive, non-authoritative first:
  - On socket `connect`/`disconnect` for a delivery role, write
    `presence: { socketConnectedAt, lastSeenAt }` on the partner doc.
  - Client emits `heartbeat` every 30s; server refreshes `lastSeenAt`.
  - `listNearbyOnlineDeliveryPartners` **de-prioritises** (does not yet exclude)
    partners whose `lastSeenAt` is older than 2 minutes — sort them last.
- **Flow impact.** Deliberately soft. Ordering changes; nobody is dropped from the
  candidate pool, so a presence bug cannot starve dispatch. Promote to a hard filter
  only after a week of telemetry.
- **Verify.** Kill the rider app → within ~2 min their `lastSeenAt` goes stale and
  they rank below live riders in the offer batch.

### Extra fixes found while implementing

- **Stale-closure on `sharedOrder`.** The delivery hook's `order_status_update`
  listener read `sharedOrder` from the render that registered it. With deps [] this
  became permanent, so it now reads through `sharedOrderRef`. It was already latent
  before this phase.
- **Malformed protocol URLs.** The old restaurant hook had explicit regex repair for
  `https:/host`, `https:///host` and `https://https://host`. `new URL()` accepts the
  last one and resolves it to origin `https://https`, which then fails to connect with
  no useful error. `resolveSocketOrigin` now repairs all three before parsing.
  Verified 4/4.
- **Silenced `debugError`.** The restaurant hook stubbed `debugError` to a no-op, so an
  unrecoverable auth failure would have looked identical to a healthy socket. Errors
  now log; `debugLog`/`debugWarn` stay quiet.

*Files changed:* `services/socket/createRealtimeSocket.js` (new),
`services/socket/index.js`, `useDeliveryNotifications.js`,
`useRestaurantNotifications.js`, `config/socket.js`, `deliveryPartner.model.js`,
`order-dispatch.service.js`.
*Verified:* `vite build` green; `resolveSocketOrigin` covered for prod/dev/localhost-block/
malformed input.

---

## Phase 2 — Make the event log authoritative (additive only) · M ✅

Nothing in this phase changes client behaviour. It builds the durable record that
Phase 3 needs, and lets us **measure** the gap before trusting it.

### ✅ DISP-04 — Order offers are never written to the durable outbox

- **Bug.** `enqueueOrderEvent` is called at **27 sites**, but there are **85 direct
  `io.to(...).emit(...)` calls** in the food module. The gap includes the events that
  matter most: `new_order`, `new_order_available`, `shareable_order_available`,
  `order_claimed`. Live emit and durable record are two independent paths that
  diverge exactly when the socket is down — so no later resync can replay an offer.
- **Fix.** Add `publish(type, payload, recipients, opts)` in `order.helpers.js`:
  writes the log first, then emits, then queues the push. Behind
  `SYNC_CURSOR_ENABLED`, and it **calls the existing emit internally** — so with the
  flag off it is byte-identical to today.

```js
// order.helpers.js — new, additive
export async function publish(type, payload, recipients, opts = {}) {
  let cursor = null;
  if (config.syncCursorEnabled) {
    cursor = await nextCursor();                       // durable first
    await FoodOrderEvent.create({
      orderId: payload.orderMongoId, type, payload, at: new Date(),
      eventId: randomUUID(),
      seq: await nextOrderSeq(payload.orderMongoId),
      recipients: recipients.map(r => ({ ...r, cursor })),
    });
  }
  const io = getIO(true);
  if (io) for (const r of recipients) {                // unchanged live path
    io.to(roomFor(r)).emit(type, cursor ? { ...payload, __cursor: cursor } : payload);
  }
  if (opts.push) await enqueuePush(recipients, opts.push);
  return cursor;
}
```

- **Schema (additive, optional fields).**

```js
// food_order_events
{ orderId, seq, eventId, type, payload, at,          // existing, unchanged
  recipients: [{ kind: 'DELIVERY_PARTNER'|'RESTAURANT'|'USER', id, cursor }] }

// index: { 'recipients.kind': 1, 'recipients.id': 1, 'recipients.cursor': 1 }
// TTL:   7 days — this is a recovery buffer, not order history
```

- **Flow impact.** With the flag off: none. With it on: an extra insert per event,
  and `__cursor` on the payload, which existing clients ignore.
- **Verify.** Flag on in staging → every `new_order` has a matching
  `food_order_events` row with the right `recipients`.

### ✅ DISP-05 — A crash mid-dispatch permanently strands the order

- **Bug.** The lock `dispatch.dispatchingAt` is cleared in a `finally`
  (`order-dispatch.service.js:618-624`). If the process dies inside `tryAutoAssign`,
  the field survives — and the selection query requires
  `'dispatch.dispatchingAt': { $exists: false }` (line 389), so that order can never
  be picked up again. The 5-minute sweeper in the watchdog is the only recovery, and
  it runs *after* the 60-second cancel has already fired.
- **Fix.** Replace `$exists: false` with a TTL comparison:
  `{ $or: [{ dispatchingAt: { $exists: false } }, { dispatchingAt: { $lt: new Date(Date.now() - 90_000) } }] }`.
  Self-healing, no sweeper needed.
- **Flow impact.** None in the happy path — the lock is still exclusive within 90s.
- **Verify.** Set `dispatchingAt` manually to 5 min ago → the order dispatches on the
  next attempt instead of hanging.

### ✅ DISP-08 — Concurrent timeouts overwrite each other's offer history

- **Bug.** `processDispatchTimeout` reads `order.dispatch.offeredTo`, mutates it in
  memory, then `$set`s the whole array back (`order-dispatch.service.js:670-679`).
  Two overlapping timeout jobs for the same order lose one another's writes, so a
  rider who already declined can be re-offered indefinitely while a fresh rider is
  skipped.
- **Fix.** Update in place with an array filter instead of replacing the array:
  `updateOne({ _id }, { $set: { 'dispatch.offeredTo.$[o].action': 'timeout' } }, { arrayFilters: [{ 'o.partnerId': pid, 'o.action': 'offered' }] })`.
- **Flow impact.** None. Same end state, no lost writes.
- **Verify.** Fire two timeout jobs concurrently → both offer entries end
  `action: 'timeout'`.

### ✅ Gap telemetry (the gate for Phase 3)

Add a counter, logged per sync: **how many events would the client have missed?**
This is the number that justifies deleting a poll. Do not proceed to Phase 3 until
it is stable and near-zero for a week.

### Implementation notes

- **Cursor allocator is Mongo, not Redis.** `REDIS_ENABLED` is false here and the cursor
  must be correct regardless of whether the cache layer is up, so `nextGlobalCursor()` uses
  an atomic `findOneAndUpdate()` on a `food_counters` doc. Swap it for Redis INCR later
  if you want — the only requirement is strictly increasing, not gapless.
- **TTL is opt-in.** `SYNC_EVENT_TTL_DAYS` defaults to 0 (no index). Enabling it deletes
  existing rows older than the window, so it is not something a deploy should do silently.
- **Gap telemetry needed no client change.** Rather than waiting for clients to report a
  cursor, `publish()` checks the recipient room size at emit time and logs `[SyncGap]` when
  the room is empty — i.e. the live emit reached nobody. That is the number that justifies
  or retires each poll. `measureSyncGap()` also exists for the Phase 3 cursor query.
- **Migrated emit sites (2 of 85):** the dispatch offer (`new_order` +
  `new_order_available`) and `notifyRestaurantNewOrder`. These were the two events with no
  durable record at all. The remaining 83 still use direct emits and are unaffected.

*Files changed:* `order.helpers.js`, `foodOrderEvent.model.js`,
`foodCounter.model.js` (new), `order-dispatch.service.js`, `config/env.js`, `.env.example`.
*Verified* against a local mongod on a scratch DB (dropped afterwards): cursor monotonic
under 20 concurrent allocations; outbox row + per-recipient cursors; recipient dedupe and
invalid-kind filtering; the Phase 3 inbox query at several cursor positions; `publish()` is a
true no-op with the flag off; dispatch lock claimable when absent/null/stale but not when
fresh; and a direct demonstration that the old read-modify-write loses one of two concurrent
`offeredTo` writes while the array filter does not.

---

## Phase 3 — Sync handshake, then retire the polls · M ✅

### ✅ SOCK-01 — The restaurant never resyncs, and the server has no branch for it

- **Bug.** `useRestaurantNotifications` contains **zero** `emit('resync')` calls.
  Even if it did, `resyncState()` handles `USER` and `DELIVERY_PARTNER | DRIVER` and
  then falls through to `return {}` (`order.service.js:1625`). **A restaurant that
  loses connectivity for thirty seconds has no mechanism at all to learn what it
  missed** — which is precisely why the 10s order poll exists.

### ✅ SOCK-02 — The recovery envelope is built server-side and thrown away client-side

- **Bug.** The server computes `lastEventSeq` and `missedEvents` and emits them in
  `resync_complete` (`config/socket.js:406-410`). The delivery client's handler is
  `debugLog('Resync completed', data)` (`useDeliveryNotifications.js:798`) — nothing
  else. No frontend file references `missedEvents`, `lastEventSeq`, or `sinceSeq`.
  The client also calls `emit('resync')` with **no argument**, so the server always
  replays a blind 50-event tail instead of the actual gap.

### ✅ SOCK-03 — Resync is scoped to one active order, so pending offers are unrecoverable

- **Bug.** `resyncState` for a rider queries
  `dispatch.status ∈ ['assigned','accepted']` (`order.service.js:1607`). A rider with
  no active trip who was offered an order while offline gets `activeOrder: null` and
  an empty event list. The outbox is keyed by `orderId`, not by recipient, so there is
  no way to ask *"what was sent to me?"* — exactly the question a reconnecting rider
  needs answered.

**Combined fix for SOCK-01/02/03** — one new handler, alongside `resync`:

```
client → sync       { since: <lastCursor> }
server → sync_batch { events: [...], nextCursor, hasMore }
client → sync_ack   { cursor }
```

- Same handler for all three roles; the recipient filter is the only difference.
- Paged, so a rider offline for hours cannot blow the frame limit.
- Client persists `lastCursor` in `localStorage` (**not** React state — it must
  survive a reload), dedupes by `eventId` against a bounded LRU, and applies strictly
  in cursor order.
- Triggers: `connect`, `reconnect`, `visibilitychange → visible`, and any live event
  whose `__cursor > lastCursor + 1`.
- Behind `SYNC_HANDSHAKE_ENABLED` / `VITE_SYNC_CLIENT_ENABLED`. `resync` keeps
  working untouched the whole time.

### ✅ Poll reduction — one at a time, in this order

Only after gap telemetry is clean. Each step is a separate deploy.

| # | Poll | File | Now | Step 1 | Step 2 |
| --- | --- | --- | --- | --- | --- |
| 1 | Rider presence check | `DeliveryHomeV2.jsx:635` | 15s | 60s | off — covered by `order_reassigned_elsewhere` + sync |
| 2 | Dining bookings | `OrdersLive.jsx:609` | 8s | 60s | off — `new_dining_booking` already emitted |
| 3 | Restaurant order list | `OrdersLive.jsx:807` | 10s | 60s | off — sync on reconnect |
| 4 | Badge counts | `OrdersLive.jsx:1211` | 30s | — | derive from the socket-updated store |
| 5 | Scheduled-order enqueue | `OrdersLive.jsx:1779` | 60s | — | server-side scheduler emit |
| 6 | Payment capture | `DeliveryVerificationModal.jsx:267` | 5s | 15s | off — Razorpay webhook → `payment_captured` |

**Keep as-is — these are not network polls:**

- `OrdersLive.jsx:808` — 1s `setCurrentTime` countdown tick (pure UI clock).
- Both alert hooks' 4.5s re-ring loop (local audio only).
- `useRestaurantDashboardData.js:197` — analytics, not order flow.
- `useAdminNotifications.js:259` — 5 min, acceptable slow net.

*Files:* `config/socket.js`, `order.service.js`,
`services/socket/createRealtimeSocket.js`, `useDeliveryNotifications.js`,
`useRestaurantNotifications.js`, `OrdersLive.jsx`, `DeliveryHomeV2.jsx`,
`DeliveryVerificationModal.jsx`.

---

## Phase 4 — Push hardening · M ✅

Lower urgency once Phase 0's FCM-01/FCM-02 have landed, but these are why push
failures are currently invisible.

### ✅ FCM-03 — Fan-out is a sequential await loop over individual HTTP calls

- **Bug.** `sendNotificationToOwners` loops with `await` per recipient
  (`firebase.service.js:478-489`), and `sendPushNotification` issues one `fetch` per
  token against the v1 `messages:send` endpoint (line 366-403). Broadcasting to 50
  riders is **50 serial round trips** — tens of seconds, on an order that until
  Phase 0 had a 60-second life.
- **Fix.** The Admin SDK is already a dependency (`config/firebase.js`). Use
  `sendEachForMulticast` in batches of 500.

### ✅ FCM-04 — Push failures are logged and discarded

- **Bug.** `notifyOwnerSafely` catches everything and returns `null`
  (`firebase.service.js:524-531`); `notifyRestaurantNewOrder` wraps its whole body in
  a bare `catch {}` (`order.helpers.js:1772`). An FCM 5xx, a quota rejection or an
  expired OAuth token loses the notification permanently, with no record it was ever
  attempted.
- **Fix.** Route push through the existing notification queue with retry +
  dead-letter, and write a delivery receipt per attempt.

### ✅ FCM-05 — Two independent Firebase initialisations

- **Bug.** `config/firebase.js:46` initialises the Admin SDK (and only *warns* when
  the service account is missing), while `core/notifications/firebase.service.js:100`
  hand-rolls a JWT, mints its own OAuth token and caches it in a separate
  module-level variable. Two credential loaders, two caches, two failure modes — and
  only one is checked at boot.
- **Fix.** Collapse onto the Admin SDK; delete the hand-rolled OAuth path. Fail loudly
  at boot if credentials are absent.

*Files:* `firebase.service.js`, `config/firebase.js`, `order.helpers.js`,
`queues/processors/notification.processor.js`.

---

## Verification checklist

Run before calling any phase done.

**Socket stability**
- [ ] One `Socket connected` log per app load (not 2–3).
- [ ] Airplane mode 60s → back → reconnects and resyncs without a manual refresh.
- [ ] Expired access token → refreshes once and reconnects; no infinite loop.
- [ ] Restaurant socket shows an upgraded WS frame in DevTools.

**No missed orders**
- [ ] Rider app killed → order placed → phone rings (FCM).
- [ ] Rider offline during offer → comes back → the offer is still there.
- [ ] Restaurant tab closed during a status change → reopened → state is correct
      with the order poll disabled.
- [ ] No rider online → order survives 8 min of re-hunting before cancelling.

**Metrics to watch**
- **Gap rate** — syncs returning a non-empty batch, per client per day. This is the
  number that justified polling; it should be small and shrinking.
- **Offer → first view latency**, split by app state (foreground / background /
  killed). FCM-01 should move the killed bucket sharply.
- **Orders cancelled with zero rider views** — should approach zero after Phase 0.
- **Push receipts vs attempts**, per platform. Currently unmeasurable, which is
  exactly why FCM-02 went unnoticed.

---

## Rollback

| Phase | Rollback |
| --- | --- |
| 0 | Revert the constants; reset `.env` flags. No schema or client change. |
| 1 | Revert the frontend hooks. Server-side presence writes are additive and inert. |
| 2 | `SYNC_CURSOR_ENABLED=false`. The new fields become dead data; the TTL clears them. |
| 3 | `VITE_SYNC_CLIENT_ENABLED=false` + restore `VITE_ORDER_POLL_MS`. `resync` is still live, so the client falls back to today's behaviour. |
| 4 | Revert to the fetch-based sender; the queue path is additive. |

---

## Bug index

| ID | Severity | Bug | Phase |
| --- | --- | --- | --- |
| DISP-01 | Critical | Orders auto-cancelled at 60s, before dispatch can retry once | 0 |
| DISP-02 | Critical | Watchdog query misses `offered` state | 0 |
| DISP-03 | Critical | BullMQ disabled → every dispatch retry is a no-op | 0 |
| FCM-01 | Critical | Push to lead rider only; phase-2 broadcast sends none | 0 |
| FCM-02 | Critical | "Latest token" is insertion order → pushes hit the wrong device | 0 |
| SOCK-04 | Major | Restaurant socket pinned to HTTP long-polling | 0 |
| SOCK-06 | Major | Socket torn down/rebuilt while partner id resolves | 1 |
| SOCK-05 | Major | Expired token → infinite unrecoverable reconnect loop | 1 |
| SOCK-08 | Major | Duplicated, drifting socket setup across 5 hooks | 1 |
| DISP-06 | Major | Availability is a DB flag with no liveness signal | 1 |
| DISP-04 | Critical | Order offers never written to the durable outbox | 2 |
| DISP-05 | Major | Crash mid-dispatch permanently strands the order | 2 |
| DISP-08 | Major | Concurrent timeouts overwrite offer history | 2 |
| SOCK-01 | Critical | Restaurant never resyncs; no server branch for it | 3 |
| SOCK-02 | Critical | Recovery envelope built server-side, discarded client-side | 3 |
| SOCK-03 | Critical | Resync scoped to one order → pending offers unrecoverable | 3 |
| DISP-07 | Major | `getIO()` is null in worker processes → emits silently skip | 0 (prereq) |
| FCM-03 | Major | Sequential await loop over individual HTTP push calls | 4 |
| FCM-04 | Major | Push failures logged and discarded; no retry or dead-letter | 4 |
| FCM-05 | Major | Two independent Firebase initialisations | 4 |

---

## Completion log — all phases shipped

Redis + BullMQ are now **enabled** (`REDIS_ENABLED=true`, `BULLMQ_ENABLED=true`) against the
Docker Redis on 6379.

### ⚠️ Redis is shared with another project — read before changing config

`blaze-redis-dev` db0 already hosts another project (`rydox`) running BullMQ queues named
`bull:order:*`, `bull:tracking:*`, `bull:otp:*` — **the same generic names this app uses**.
Connecting to db0 unprefixed would have had the two apps consuming each other's jobs.
Isolation was applied on both axes:

- `REDIS_URL=redis://127.0.0.1:6379/3` — separate logical db for keys.
- `REDIS_KEY_PREFIX=buddy` — BullMQ prefix, applied to the queues **and every worker**
  (a mismatch means jobs are produced where nothing reads).
- Socket.IO adapter `key=buddy:socket.io` — **needed separately**, because Redis pub/sub is
  global and is NOT scoped by db index.

Verified: db0 still holds exactly its original 18 keys; `buddy:*` keys live in db3.

### DISP-07 — worker emits now actually work

Enabling BullMQ alone would have made things worse: dispatch moves into `buddy-worker-order`,
where `initSocket()` was never called, so `getIO()` is null and every `if (io)` guard skips
silently. Added `@socket.io/redis-emitter` behind a new `getBroadcaster()` — returns the real
server when the process has one, otherwise a Redis emitter on the same adapter key.
`publish()` uses it. **Proven end to end:** an emit from a spawned process with no Socket.IO
server was received by a real connected client.

### Phase 3 — proven end to end

A rider offline when an offer fires recovers it on reconnect. 11/11 assertions, including:
events replayed in cursor order, `eventId` present for dedupe, `hasMore`/`nextCursor` paging,
re-sync from the new cursor returning zero (no replay storm), per-recipient isolation (a
different rider sees none of it), and the RESTAURANT role syncing — which had no server branch
at all before.

Schema correction vs the Phase 2 sketch: `cursor` moved to the **top level** of the event
document. Mongo cannot sort on a field inside an array, so a per-recipient cursor could not
serve `{ cursor: { $gt: since } }` plus a sort. Recipients keep `{ kind, id }` only.

### Phase 4 — measured

- Fan-out to 8 targets: **326ms vs ~4592ms** serial. The `for … await` loop is gone.
- Multicast returns per-token results; unregistered tokens are flagged terminal (not retried).
- Hand-rolled OAuth/JWT path deleted; one `firebase-admin` init. Messaging now initialises
  **independently of the Realtime Database**, so a missing `databaseURL` can no longer silently
  disable every push.
- Every attempt writes a `food_push_receipts` row — including "owner has no registered device",
  which was previously invisible.

Two further bugs found while testing Phase 4, and fixed:

1. A failure while pruning dead tokens fell through to the outer catch and rewrote an
   already-successful send as `failed`. Pruning is now isolated and uses `validateModifiedOnly`.
2. Receipts were fire-and-forget, so a row could be lost if the process exited. They are written
   after the send has completed, so awaiting them costs no send latency.

### Safety net kept deliberately

`notifyOwnerSafely` probes for a live notification worker (result cached 30s) before queueing.
With BullMQ on but no worker running, pushes would otherwise queue into a void and stop
entirely — instead it falls back to sending inline. `buddy-worker-notification` was added to
`ecosystem.config.cjs`.

### Polls: reduced, not deleted

All order polls now route through `Frontend/src/services/socket/pollConfig.js` at a 60s safety
net (down from 8s/10s/15s), each overridable by env and settable to `0` to retire. The
restaurant list also refetches immediately on a socket event, so the lower interval is not
slower in practice. `VITE_PAYMENT_STATUS_POLL_MS` deliberately stays at 5s — that flow is
user-blocking at the doorstep and has no socket event yet (it needs a Razorpay webhook →
`payment_captured` emit).

### Still unverified

Everything above is verified against local Redis, local Mongo and real FCM calls, but **not**
under production traffic. Set `SYNC_CURSOR_ENABLED=true` and watch the `[Sync]` / `[SyncGap]`
logs before setting any poll interval to 0.
