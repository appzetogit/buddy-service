# Peak Hour Pricing & Cart Delivery Speed Info — Mobile (Flutter) Integration Guide

This document covers two related, separately shippable pieces of backend work for **Food** and
**Quick Commerce (QC)**, so the Flutter app can display them correctly to customers:

1. **Peak Hour Pricing** — an extra recurring/festival-date surcharge on the delivery fee (§1–6).
2. **Cart Delivery Speed info popup** — an optional "what is this option?" detail view for each
   speed option (eco/standard/priority/etc.) (§7).

There is **no dedicated Flutter/mobile work required to *calculate* the charge** — the backend
always computes the final price (including any active peak-hour surcharge) and returns it in the
existing order-pricing / checkout-preview response. The mobile app's job is purely **display**:
show the extra line item and/or badge when the field is present and non-zero.

---

## 1. What it is

Admin can configure **Peak Hour rules** from the web admin panel (Food: `/admin/food/fee-settings`
→ "Peak Hours" tab; QC: `/admin/quick-commerce/billing` → "Peak Hours" tab). A rule is either:

- **Recurring**: repeats on chosen days of the week (or every day if none chosen), between a start
  and end time, every week — e.g. "Lunch Rush", 12:00–15:00, every day, +₹20.
- **Festival dates**: applies only within a fixed calendar date range (inclusive), during the same
  kind of start/end time window — e.g. "Diwali", 2026-11-08 to 2026-11-12, 00:00–23:59, +₹35.

When the **current server time** (IST) falls inside an **enabled** rule's window, that rule's flat
₹ charge is added **on top of the delivery fee**. If multiple rules are active at once, only the
rule with the **highest charge** applies — charges never stack/add together.

**Important — who keeps the money**: the entire peak-hour charge is kept by the platform. It is
**not** split with the delivery rider (unlike the separate "Cart Delivery Speed" fee, which does
have a rider/admin split). Nothing changes on the rider/driver side of the app for this feature.

**Overnight windows**: an end time earlier than the start time (e.g. 22:00–02:00) is treated as
wrapping past midnight — this is handled entirely server-side, no special client logic needed.

---

## 2. Where the charge shows up (the only two response shapes that matter)

### 2.1 Food — `POST /api/v1/food/orders/calculate` (and real order placement)

Auth: Bearer token, role `USER`.

Request body (existing, unchanged):
```json
{
  "items": [ ... ],
  "restaurantId": "...",
  "deliveryAddress": { ... },
  "couponCode": "SAVE20",
  "deliverySpeedOptionId": "speed-2",
  "deliveryOption": "standered"
}
```

Response — new fields are `pricing.peakHourCharge`, `pricing.peakHourSurcharge`, and the same two
fields nested inside `pricing.deliveryFeeBreakdown`:

```json
{
  "success": true,
  "data": {
    "pricing": {
      "subtotal": 350,
      "deliveryFee": 155,
      "deliveryDiscount": 0,
      "platformFee": 5,
      "tax": 17.5,
      "total": 527.5,
      "currency": "INR",

      "peakHourCharge": 20,
      "peakHourSurcharge": {
        "ruleId": "6ad5e81ca2206dc750c2e70f",
        "name": "Lunch Rush",
        "charge": 20
      },

      "deliveryFeeBreakdown": {
        "baseFee": 100,
        "speedFeeModifier": 35,
        "peakHourCharge": 20,
        "peakHourRuleId": "6ad5e81ca2206dc750c2e70f",
        "peakHourRuleName": "Lunch Rush",
        "fee": 155,
        "...": "other existing fields unchanged"
      }
    }
  }
}
```

**When no rule is active**: `peakHourCharge` is `0` and `peakHourSurcharge` is `null`. Always
check for `> 0` before showing anything — don't just check for field presence.

**When delivery is free** (free-delivery coupon or subtotal threshold): the peak-hour charge is
automatically waived too (`peakHourCharge: 0`) — the backend already handles this, no client logic
needed.

### 2.2 Quick Commerce — `POST /api/v1/quick-commerce/checkout/preview` (and real order placement)

Same idea, field names identical. The checkout-preview response (`result` in the existing
`previewCheckout` response) gets two new top-level fields:

```json
{
  "success": true,
  "result": {
    "subtotal": 420,
    "deliveryFee": 95,
    "platformFee": 30,
    "total": 545,

    "peakHourCharge": 25,
    "peakHourSurcharge": {
      "ruleId": "6ad...",
      "name": "Evening Peak",
      "charge": 25
    },

    "deliveryFeeBreakdown": {
      "peakHourCharge": 25,
      "peakHourRuleId": "6ad...",
      "peakHourRuleName": "Evening Peak",
      "...": "other existing fields unchanged"
    }
  }
}
```

Same rules apply: `0` / `null` when nothing is active, and the charge is already folded into
`deliveryFee` and `total` — the client never computes it, only displays it as a breakdown line.

---

## 3. Optional standalone "what's active right now" endpoint

Useful if the app wants to show a banner on the restaurant/store list or cart page **before** the
user has gone through the full pricing calculation (e.g. "🔥 Peak hour charges apply right now").

### Quick Commerce — fully public, no auth required
```
GET /api/v1/quick-commerce/peak-hour-rules/active
```
```json
{
  "success": true,
  "data": {
    "surcharge": { "ruleId": "6ad...", "name": "Evening Peak", "charge": 25 }
    // or "surcharge": null when nothing is active
  }
}
```

### Food — ⚠️ currently requires an ADMIN-role token, not usable by the customer app
```
GET /api/v1/food/admin/peak-hour-rules/active
```
This route is mounted under `/v1/food/admin`, which the backend protects with
`authMiddleware + requireRoles('ADMIN')` for the **entire** sub-router — so despite its "public"
naming, a regular customer/user token gets `401 Authentication token missing` / `403`. This is
also true of Food's older `fee-settings/public` endpoint (same pre-existing pattern, not something
new to this feature).

**Practical implication for Flutter (Food)**: don't call this endpoint from the customer app. Rely
entirely on `pricing.peakHourCharge` / `pricing.peakHourSurcharge` returned from
`/food/orders/calculate`, which already requires only a normal USER token and is called on every
cart/checkout screen anyway. If a pre-checkout banner is wanted for Food, that needs a new, genuinely
public backend route — flag this back if it's needed; it is a small backend change, not something
the Flutter side can work around alone.

---

## 4. Suggested UI treatment (matches the admin preview + Food/QC web cart already shipped)

- **Line item** in the fare/bill breakdown, directly under the delivery fee row:
  - Label: the rule's `name` (e.g. "Lunch Rush"), or fall back to "Peak hour charge" if the name is
    empty.
  - Value: `+₹{charge}` (always positive — this is always an add-on, never a discount).
  - Suggested color: amber/orange accent with a small dot indicator, to visually separate it from
    the base delivery fee and from coupon discounts (which are green).
  - Only render this row when `peakHourCharge > 0`.
- **Optional banner** (if using the standalone QC endpoint, or Food once a public route exists):
  "⚡ {name} is active — an extra ₹{charge} applies to delivery right now."

No other UI (speed-option cards, totals, etc.) needs special-casing — the charge is already baked
into `deliveryFee` and `total` server-side.

---

## 5. Edge cases already handled server-side (no client logic needed)

| Case | Behavior |
|---|---|
| Two rules' windows overlap | Highest `charge` wins; they never add together. |
| Rule window crosses midnight (e.g. 10 PM–2 AM) | Handled correctly including which calendar day "owns" the small-hours portion. |
| Rule is disabled (`status: false`) by admin | Never matches, regardless of time/date. |
| Delivery is free (coupon or subtotal threshold) | `peakHourCharge` forced to `0` for that order. |
| Festival rule with only a start date or only an end date | Treated as open-ended on the missing side (e.g. only `startDate` = "applies from that date onward"). |
| No peak-hour rules configured at all | `peakHourCharge: 0`, `peakHourSurcharge: null`, exactly as if the feature didn't exist. |

---

## 6. Quick checklist for the Flutter side

- [ ] Food cart/checkout screen: read `pricing.peakHourCharge` and `pricing.peakHourSurcharge.name`
      from the existing `/food/orders/calculate` response; show the line item when `> 0`.
- [ ] QC cart/checkout screen: read the same two fields from the `/quick-commerce/checkout/preview`
      response (`result.peakHourCharge`, `result.peakHourSurcharge.name`).
- [ ] QC only, optional: call `GET /quick-commerce/peak-hour-rules/active` for a pre-checkout
      banner on the store/cart screen — fully public, safe to call anywhere.
- [ ] Food pre-checkout banner: **not available yet** without a backend change — don't build this
      against the current `/food/admin/peak-hour-rules/active` route, it will 401 for customers.
- [ ] No pricing math to implement — the charge is always already included in `deliveryFee` /
      `total`; only display it as a breakdown line.
- [ ] No rider/driver-app changes needed — this charge is never split with the rider.

---

## 7. Cart Delivery Speed — info popup ("What is Priority Delivery?")

Each delivery-speed option (eco / standard / priority / super fast / etc., configured by the admin
in the "Cart Delivery Speed" tab) now carries two text fields instead of one:

- `description` (**already existed**) — a short line shown directly on the option card/row, e.g.
  "normal delivery". Admin can now also use it as a longer, multi-line explanation — it is a
  textarea in the admin panel now, not a single-line input.
- `detailTitle` (**new**) — a heading for an optional "what is this?" info popup. If an admin fills
  this in, the web cart shows a small ⓘ info icon next to that option's name; tapping it opens a
  popup titled `detailTitle` with `description` as the body text (this is exactly the reference
  screenshot — "What is Priority Delivery?" as the title, the explanation as the body, a "Got it"
  button to close). **If `detailTitle` is empty, don't show any info icon for that option** — this
  is how the admin opts a given speed option in or out of having a popup.

No "Learn more" link field was added — keep this to title + body only, matching what's live now.

### 7.1 Where this data comes from

Same response shape for both verticals; the two new/changed fields live inside each item of a
`speedOptions` (or `options`) array that the app already consumes for the speed-selector UI.

**Food** — `GET /api/v1/food/restaurant/delivery-speed-options` (public, cached ~300s):
```json
{
  "success": true,
  "data": {
    "options": [
      {
        "id": "speed-3",
        "name": "quick",
        "badge": "priority",
        "time": "10-15 mins",
        "feeModifier": 40,
        "description": "Get your order faster. If delayed by 15+ minutes, you'll get a voucher as compensation.",
        "detailTitle": "What is Priority Delivery?",
        "icon": "clock",
        "isEnabled": true,
        "isDefault": false
      }
    ],
    "defaultOptionId": "speed-1"
  }
}
```

**Quick Commerce** — `GET /api/v1/quick-commerce/delivery-options` (public):
```json
{
  "success": true,
  "data": {
    "speedOptions": [
      {
        "id": "option-3",
        "name": "Priority",
        "feeModifier": 40,
        "description": "Get your order faster...",
        "detailTitle": "What is Priority Delivery?",
        "...": "same shape as Food"
      }
    ],
    "defaultSpeedOptionId": "option-1"
  }
}
```

Both endpoints were already being called for the speed selector — no new API call is needed, only
read two more fields off objects you already have.

### 7.2 Suggested UI treatment (matches the web cart already shipped)

- Next to the option's name/badge on the selector row, show a small ⓘ icon **only when
  `detailTitle` is non-empty**.
- Tapping it opens a bottom sheet / dialog:
  - Title: `detailTitle`.
  - Body: `description` (may be multi-line — preserve line breaks).
  - A single "Got it" / close button.
- Tapping the icon must **not** also select that delivery speed option (stop event propagation /
  use a separate tap target from the row's own select action).
- An option with an empty `detailTitle` behaves exactly as before — just its short `description`
  line under the name, no icon, no popup.

### 7.3 Quick checklist

- [ ] Read `detailTitle` and `description` off each speed option object (already present in the
      endpoints above — no new network call).
- [ ] Render an info icon per-option only when `detailTitle` is non-empty.
- [ ] Icon tap opens a title+body popup; row tap still selects the option; the two must not
      conflict (separate tap targets, event stops propagation on the icon).
- [ ] No pricing or ordering logic involved — this is purely informational UI.
