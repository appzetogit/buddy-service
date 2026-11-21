# Gigs (rider slot booking) - complete guide for the Flutter team

This is the single document for everything built around **Gigs**: what it is, the rules the backend enforces, every API the rider app needs, what each screen must show, how earnings reach the rider, and how scheduled orders / rides behave. It replaces `flutter-gigs-slots.md` (older, shorter).

- Backend + admin panel + the rider **web** app are already live. Base URL: `https://sooperbuddy.in/api/v1`
- If your Flutter app loads the rider web app in a WebView, the Gigs tab already exists at `/food/delivery/gigs` and nothing has to be built. This guide is for a **native Flutter** implementation.
- All times are **India time (IST, UTC+5:30)**. Dates are `YYYY-MM-DD` strings. Time-of-day values are **minutes since midnight** (`startMin`, `endMin`) plus a ready `start` / `end` string (`"10:00"`).
- Services are always one of: `food`, `quickCommerce` (shown to users as **Marketplace**), `taxi`.
- `dayOfWeek`: 0 = Sunday ... 6 = Saturday.

---

## 1. What Gigs are (business flow)

1. **Admin** creates *slots* in the admin panel. A slot has a name (Breakfast / Lunch / Evening Snacks / Dinner ...), the services it covers, the weekdays it repeats on, and a list of **1-hour time slots**. Each hour has:
   - `extraPerOrder` - rupees the rider earns **extra on every order** completed in that hour,
   - `maxDrivers` - how many riders may book that hour.
   Time slots of the same service never overlap on the same day (the admin panel rejects overlaps).
2. **Rider** opens the **Gigs** tab, picks a day, ticks one or more hours and taps **Book now**. Booking is free (no charge, no penalty for cancelling).
3. On the booked day the rider **only receives orders inside the booked hour(s)** and only for the services of that slot. Outside those hours that day no order is offered and `accept` is refused. On days with no booking the rider works as normal.
4. Every order / ride completed inside a booked hour pays the hour's `extraPerOrder` **on top of** the normal earning. It goes into the rider's wallet immediately and is deducted from the admin's earning.
5. **Scheduled orders / rides** (customer picked a future time) go **only to riders who booked a gig covering that time**. If nobody did, the order waits for the admin, who assigns a driver by hand (see section 7).

Not building anything for admin: admin pages (Gig Slots, Gig Bookings & Payouts, Scheduled - Assign Driver) are web only.

### Key rules the app must respect
| Rule | Detail |
|---|---|
| Booking opens | **From tomorrow.** Same-day booking is refused. |
| Visible window | Today + next 6 days (7 days). |
| Capacity | `maxDrivers` per hour; `isFull` when reached. |
| Same rider | Cannot book overlapping hours on one date. |
| Cancel | Only until the **day before** the gig. Today's / past bookings cannot be cancelled. |
| Services | A rider only sees slots for services they work in (`deliveryServices` of their profile; empty = all). |
| Cost | Booking and cancelling are free. |

---

## 2. Authentication

Same rider token as every other rider API (`Authorization: Bearer <accessToken>`, role `DELIVERY_PARTNER` / `DRIVER`). One rider account works for Food, Marketplace and Taxi. All responses use the usual envelope:

```json
{ "success": true, "message": "OK", "data": { ... } }
```
Errors: `{ "success": false, "message": "..." }` - show `message` to the rider as a toast. Validation errors come back as **HTTP 422** (some accept endpoints use **409**); treat any non-2xx the same way.

---

## 3. Rider APIs (base `/gigs/rider`)

### 3.1 `GET /days` - the Gigs tab list
Next 7 days, one row per day.
```json
{ "today": "2026-11-21",
  "days": [
    { "date": "2026-11-21", "dayOfWeek": 6, "isToday": true,  "bookable": false, "blockedReason": "same_day",
      "slotCount": 4, "openCount": 14, "myBookingCount": 1, "status": "closed" },
    { "date": "2026-11-22", "dayOfWeek": 0, "isToday": false, "bookable": true,  "blockedReason": null,
      "slotCount": 4, "openCount": 14, "myBookingCount": 2, "status": "open" } ] }
```
`status`: `open` (can book) / `full` (everything full) / `closed` (today, booking closed) / `none` (no gigs that day for this rider).
UI mapping: `open` green card "Booking open", `full` amber "All slots full", `closed` grey with lock "Booking closed - gigs must be booked a day before", `none` grey "No gigs". Show `myBookingCount` as a chip "2 hours booked by you". Group days under a month header (NOVEMBER).

### 3.2 `GET /days/{date}` - one day with its slots
```json
{ "date": "2026-11-22", "dayOfWeek": 0, "bookable": true, "blockedReason": null,
  "slots": [ {
    "slotId": "...", "name": "Lunch", "services": ["food","quickCommerce","taxi"],
    "timeSlots": [ {
      "timeSlotId": "...", "start": "12:00", "end": "13:00", "startMin": 720, "endMin": 780,
      "extraPerOrder": 10, "maxDrivers": 20, "bookedCount": 3, "remaining": 17,
      "isFull": false, "bookedByMe": false, "bookingId": null, "canBook": true } ] } ] }
```
Errors: 422 if `date` is outside today..today+6.
UI per time slot row: `12pm - 1pm`, `₹10 extra per order`, `3 booked · 17 left`. If `isFull && !bookedByMe` show red **"Gig full"** and disable. If `bookedByMe` show a green **Booked** chip. Checkbox only when `canBook`. Slot card header: name, range (first start - last end), `N Gigs`, services list. Top filter chips: **All / Open / Booked** (Open = `canBook`, Booked = `bookedByMe`). Sticky bottom button **Book now** (disabled until something is ticked, label e.g. `Book 2 gigs`).

### 3.3 `POST /book`
```json
{ "date": "2026-11-22", "timeSlotIds": ["<timeSlotId>", "<timeSlotId>"] }
```
Success `200`: `{ "bookings": [ {booking}, ... ] }`. It is **all or nothing**. After success reload `GET /days/{date}`.
Possible error messages (show as-is): "Gigs must be booked at least one day before. Pick tomorrow or a later day." / "10:00-11:00 is already full" / "Your selected time slots overlap with another booking" / "You have already booked one of these time slots" / "A selected time slot is not available on this day" / "\"Lunch\" is not for the services you work in" / "That date is outside the booking window" / "Select at least one time slot".

### 3.4 `DELETE /bookings/{bookingId}`
`200 { "cancelled": true }`. Error "A gig can only be cancelled until the day before it starts". Only show the **Cancel** button when `booking.date > today` (use `today` from `/days`); for today show a **Today** chip, for earlier dates **Done**.

### 3.5 `GET /bookings?upcoming=true` - my bookings + earnings summary
```json
{ "totalGigEarnings": 40, "totalGigOrders": 4,
  "recentEarnings": [ { "_id":"...", "service":"food", "amount":10, "slotName":"Lunch", "orderRef":"FOD-123", "createdAt":"2026-11-21T11:31:00.000Z" } ],
  "bookings": [ { "_id":"...", "date":"2026-11-22", "slotName":"Lunch", "services":["food","quickCommerce","taxi"],
                  "startMin":720, "endMin":780, "start":"12:00", "end":"13:00",
                  "startAt":"2026-11-22T06:30:00.000Z", "endAt":"2026-11-22T07:30:00.000Z",
                  "extraPerOrder":10, "status":"booked", "ordersCount":0, "extraEarned":0 } ] }
```
Use `upcoming=true` for the "My bookings" list on the Gigs tab (today and later). Without it you get history too (max 100).

---

## 4. Screens to build

### 4.1 Gigs tab (new bottom-nav item)
Bottom navigation order: **Delivery (feed) | Pocket | Gigs | History | Profile** (Gigs in the middle, lightning-bolt icon).
Content, top to bottom:
1. Title "Gigs" + one line: "Book hourly slots a day ahead. In a booked hour you get only gig orders and earn extra on every order."
2. If `totalGigEarnings > 0`: card "Gig extra earned so far: ₹40".
3. **My bookings** (from 3.5): per row `Lunch`, `Sun, 22 Nov · 12 PM - 1 PM`, green line `₹10 extra / order · Food, Marketplace, Taxi`, Cancel / Today / Done on the right.
4. Day cards from `GET /days` (see 3.1). Tap a card whose status is `open`, `full` or `closed` to open the day screen (closed shows the slots read-only with the banner "Gigs must be booked at least one day before. You can book from tomorrow onwards."). `none` is not tappable.
Pull-to-refresh reloads both calls.

### 4.2 Day screen ("Gigs, Sunday, 22/11/2026")
As described in 3.2. Back arrow returns to the tab and refreshes it.

### 4.3 Pocket screen additions
- Under the "Earnings overview" amount add a green strip: `Gig extra earned (all time, 4 orders)  +₹40.00` (from 3.5 totals; show only if `> 0`).
- Below it list the last 5 `recentEarnings`: `Gig bonus · Lunch · Food · 21 Nov, 5:01 pm   +₹10.00` (service label: `quickCommerce` -> Marketplace).
- The gig extra is **already inside** the wallet balance / available balance. Do not add it again.
- Pocket details / statement pages already list bonus rows. A gig credit appears there as: `Bonus - Gig extra: Lunch 12:00-13:00 (food order FOD-123)`.

### 4.4 Notification / toast
Push payload when a gig bonus lands:
```json
{ "title": "Gig bonus added", "body": "Rs 10 extra added for your Lunch gig order.",
  "data": { "type": "gig_bonus", "amount": "10", "orderRef": "FOD-123" } }
```
On `data.type == "gig_bonus"`: show an in-app toast "+₹10 gig bonus" and refresh Pocket / Gigs data if those screens are open.

---

## 5. How orders reach a gig rider (what the app will observe)

No app logic is needed - the backend filters. This is only so QA knows what to expect.

| Situation | Result |
|---|---|
| Rider has a booking **today**, now inside the booked hour, order of a booked service | Offered normally. |
| Rider has a booking today, now **outside** the booked hours (or a service not in that slot) | No offers. `accept` is refused. Food returns `422`, Marketplace and Taxi return `409` with: **"You have a gig booked today. You can take orders only during your booked time slots."** |
| Rider has **no** booking today | Works exactly as before. |
| Rider has a booking on **another** date | Not affected today. |

Applies to the existing endpoints (no change to URLs or socket events):
- Food accept `PATCH /food/delivery/orders/{id}/accept`, available list `GET /food/delivery/orders/available`
- Marketplace accept `.../quick-commerce/delivery/orders/{id}/accept`, available list `.../quick-commerce/delivery/orders/available`
- Taxi accept `POST|PATCH /taxi/delivery/rides/{id}/accept`, offers `GET /taxi/delivery/rides/available`

**Required app change:** surface the error message of a failed `accept` as a toast (many apps swallow it). Nothing else.

---

## 6. Earnings - exactly when and how much

- The extra is paid when the job is **completed**: Food delivered, Marketplace final delivery, Taxi ride completed.
- Amount = the booked hour's `extraPerOrder`, **once per order** (never twice). The booking snapshot is used, so later admin edits do not change what a rider earns.
- The job must fall inside the booked hour. A job accepted inside the hour may be delivered up to 45 minutes after the hour ends and still earns the extra.
- For a **scheduled** job the booked hour is matched against its **scheduled time**.
- Where it shows: wallet `totalBonus` (`GET /food/delivery/wallet`), pocket details bonus rows (`GET /food/delivery/pocket-details`), `GET /gigs/rider/bookings` (`totalGigEarnings`, `recentEarnings`, per-booking `ordersCount` / `extraEarned`).
- The rider is **not charged** for booking or cancelling.
- The amount is deducted from admin earnings (Food dashboard, Marketplace finance, Taxi earnings report) - admin side only.

---

## 7. Scheduled orders / rides + gigs

Scheduled = the customer chose a future delivery / pickup time (Food and Marketplace orders, Taxi "ride later").

1. A scheduled job is offered **only to riders who booked a gig that covers its scheduled time** (for that service). Everyone else never gets the offer, never sees it in the available list (Food) or the scheduled-rides list (`GET /taxi/delivery/rides/scheduled`), and `accept` returns: **"This scheduled order is only for riders who booked the gig slot that covers its time."**
2. If **nobody** booked that time (or no booked rider can take it) the job is **not cancelled**. It is parked in the admin panel (*Gigs -> Scheduled - Assign Driver*). The admin gets a notification and picks a driver by hand.
3. Admin-assigned job:
   - Food / Marketplace: the order arrives to that driver like an admin assignment (`dispatch.status = assigned`, socket `new_order` / `new_order_available`, appears in the available list). If the admin picked before the order went live, it is handed over the moment it goes live. The driver **can accept even without a gig**. The assignment is never taken back automatically.
   - Taxi: the ride is accepted for that driver immediately (status `accepted`); it appears in `GET /taxi/delivery/rides/scheduled` ("mine") and opens as the active trip 30 minutes before pickup, with the usual reminders.
4. Scheduled orders are **never auto-cancelled** for "no driver found". A scheduled **Taxi** ride still unassigned 15 minutes after its pickup time is cancelled.
5. Offers carry `scheduledAt` in the payload - show it on the offer card ("Scheduled for 22 Nov, 12:30 pm") so the rider knows it is for later.

---

## 8. Suggested Dart models

```dart
class GigDay {
  final String date; final int dayOfWeek; final bool isToday, bookable;
  final String? blockedReason; final int slotCount, openCount, myBookingCount;
  final String status; // open | full | closed | none
}
class GigTimeSlot {
  final String timeSlotId, start, end; final int startMin, endMin, extraPerOrder,
      maxDrivers, bookedCount, remaining; final bool isFull, bookedByMe, canBook; final String? bookingId;
}
class GigSlot { final String slotId, name; final List<String> services; final List<GigTimeSlot> timeSlots; }
class GigBooking {
  final String id, date, slotName, start, end, status; final List<String> services;
  final int extraPerOrder, ordersCount, extraEarned;
}
class GigEarning { final String id, service, slotName, orderRef; final int amount; final DateTime createdAt; }
```
Repository (all calls via your existing authenticated Dio client):
```dart
Future<List<GigDay>> days() async => ...GET /gigs/rider/days  -> data.days
Future<GigDayDetail> day(String date) => GET /gigs/rider/days/$date
Future<void> book(String date, List<String> ids) => POST /gigs/rider/book {date, timeSlotIds}
Future<void> cancel(String id) => DELETE /gigs/rider/bookings/$id
Future<GigSummary> mine() => GET /gigs/rider/bookings?upcoming=true
```
Format helpers: `12h(int minutes)` -> `"10am"`, `"12:30pm"`; day card shows the date number and weekday short name.

---

## 9. Styling reference (match the web rider app)
- Open day: left block green `#16A34A`, white date + weekday; closed / none: slate-grey block; full: amber.
- Slot card header: dark navy `#0F172A` with white name, subtitle `10am - 1pm · 3 Gigs · Food, Marketplace, Taxi`, small sunrise / sun / sunset / moon icon by start time (before 11:00, before 16:00, before 20:00, else).
- Ticked checkbox green; booked chip light-green; "Gig full" red; extra amount in green.
- Bottom action bar: full-width green button, disabled grey when nothing ticked.
- Gigs tab icon: lightning bolt; active tab green pill with the label "Gigs".

---

## 10. QA checklist (live data already exists)
Slots currently on live: **Breakfast** (7-11, ₹5), **Lunch** (11-15, ₹10), **Evening Snacks** (15-19, ₹7), **Dinner** (19-23, ₹12), every day, all three services, 20 drivers per hour.

1. Gigs tab shows 7 days; today is "Booking closed", others "Booking open".
2. Open tomorrow, tick 2 hours, **Book now** -> both show **Booked**, tab shows "2 hours booked by you", My bookings lists them.
3. Try booking the same hour again -> error toast. Book overlapping hours -> error toast.
4. Cancel a tomorrow booking -> disappears; today's booking has no Cancel button.
5. With a booking **today** (ask backend to add one for testing - the API refuses same-day booking), outside the hour: go online, no offers; `accept` of any order shows the gig message toast. Inside the hour: offers arrive, deliver an order -> push "Gig bonus added", Pocket shows `+₹X` and the list entry.
6. Scheduled order for a time nobody booked: rider app never receives it; admin sees it under *Scheduled - Assign Driver*; after the admin assigns, it arrives in the available list and can be accepted without a gig.
7. Full hour (`isFull`) shows red "Gig full" and cannot be ticked.

Ask the backend team for a test rider account (credentials are intentionally not stored in this document).

---

## 11. API quick reference

| Purpose | Method + path |
|---|---|
| Days list | `GET /gigs/rider/days` |
| One day | `GET /gigs/rider/days/{YYYY-MM-DD}` |
| Book | `POST /gigs/rider/book` |
| Cancel | `DELETE /gigs/rider/bookings/{id}` |
| My bookings + earnings | `GET /gigs/rider/bookings?upcoming=true` |
| Wallet (has `totalBonus`) | `GET /food/delivery/wallet` |
| Pocket details (bonus rows) | `GET /food/delivery/pocket-details` |
| Scheduled taxi rides | `GET /taxi/delivery/rides/scheduled` |

Admin endpoints (`/gigs/admin/...`) are used by the web admin panel only.
