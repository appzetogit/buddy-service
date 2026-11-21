# Gigs (rider slot booking) - Flutter changes

The rider web app already has the new **Gigs** tab (between Pocket and History). If the Flutter app uses its own screens, build them on these APIs. Same rider token as Food / Marketplace / Taxi; base path `/api/v1/gigs/rider`.

## How it works
- Admin makes slots (name, services, weekdays, hourly time slots, extra ₹ per order, max drivers).
- Rider books hours for **tomorrow or later** (same day is closed). Window = today + 6 days.
- A rider who has a gig booked **today** gets orders/rides **only inside the booked hours and only for that slot's services**. Outside those hours that day, no offers and accept is refused (HTTP 409 "You have a gig booked today..."). A rider with no booking today is not affected.
- Each order delivered / ride completed inside a booked hour pays `extraPerOrder` extra (added to wallet + bonus history, deducted from admin earning).
- Slots are listed only for the services the rider works in (`deliveryServices`; empty = all).

## Endpoints
| Method | Path | Use |
|---|---|---|
| GET | `/days` | Next 7 days. Each: `date`, `dayOfWeek` (0=Sun), `status` = `open` / `full` / `closed` (today) / `none`, `slotCount`, `openCount`, `myBookingCount` |
| GET | `/days/:date` | `YYYY-MM-DD`. `slots[]` -> `{slotId, name, services[], timeSlots[]}`; each time slot: `timeSlotId, start, end, startMin, endMin, extraPerOrder, maxDrivers, bookedCount, remaining, isFull, bookedByMe, bookingId, canBook` |
| POST | `/book` | Body `{ "date": "2026-11-22", "timeSlotIds": ["..."] }`. All or nothing. Errors (400): same day, full, overlap, not your service |
| DELETE | `/bookings/:id` | Cancel (only until the day before) |
| GET | `/bookings?upcoming=true` | Own bookings + `totalGigEarnings`, `totalGigOrders` |

Response envelope is the usual `{ success, message, data }`.

## UI (matches the reference screens)
1. **Gigs tab** -> list from `/days` (green = `open`, grey = `closed`/`none`, amber = `full`), month headers.
2. Tap a day -> `/days/:date`: cards per slot (name, time range, "N Gigs"), rows per hour with `₹extra per order`, `Gig full` in red when `isFull`, "X booked / Y left", checkbox when `canBook`, "Booked" chip when `bookedByMe`. Filters All / Open / Booked. **Book now** posts the selected `timeSlotId`s.
3. Pocket: show `totalGigEarnings` from `/bookings` as "Gig extra earned"; the amount is already inside the pocket balance, and each gig credit appears in the bonus transactions as `Gig extra: <slot> <start>-<end> (...)`.

## Behaviour to handle
- Accept calls for food (`PATCH /food/delivery/orders/:id/accept`), marketplace (`.../quick-commerce/delivery/...accept`) and taxi (`/taxi/delivery/rides/:id/accept`) can now return **409/4xx with the gig message**; show it as a toast.
- No change to the socket events.
