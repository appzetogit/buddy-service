# Taxi - Scheduled Parcel booking (Flutter user app)

Base URL `https://sooperbuddy.in/api/v1`. Backend and web app are live. Scheduled **rides** and **intercity** already work in the app; this adds the same "book for later" to **Parcel / Delivery**.

## What changes in the app
On the parcel confirm screen (after sender/receiver details, before booking) add a two-way choice, same look as the ride screen:
- **Send now** (default): booking works exactly as today.
- **Schedule**: show a date-time picker. Allowed window in the app: **from 1 hour from now up to 7 days ahead** (the server accepts 15 minutes to 30 days; keep the app at 1 hour / 7 days, same as scheduled rides). Show an inline error outside the window.

## API
`POST /taxi/user/deliveries` - same body as today plus one optional field:
```json
{ "...": "existing parcel fields", "scheduledAt": "2026-11-25T10:30:00.000Z" }
```
- Send **ISO-8601 UTC** (`DateTime.toUtc().toIso8601String()`). Omit the field (or send `null`) for "Send now".
- Works with **COD** too: `"paymentMethod": "cod"` + `scheduledAt`. The advance is paid first (Razorpay, same two-step flow as before: `POST /taxi/user/deliveries` -> pay -> `POST /taxi/user/deliveries/cod-advance/verify`); the parcel is saved as scheduled only after the advance is paid. `scheduledAt` is remembered from the first call, you do not send it again on verify.
- Success is the same `201 { data: { rideId, ... } }`. For a scheduled parcel `data.scheduledAt` is set and `status` is `searching` (no driver yet).
- Errors (show the message): `scheduledAt is invalid`, `Pick a pickup time at least 15 minutes from now, or book the ride now` (`code: SCHEDULE_TOO_SOON`), `Rides can be scheduled up to 30 days ahead` (`code: SCHEDULE_TOO_FAR`).
- A time within about 5 minutes of now is treated as **Send now** by the server.

## After booking a scheduled parcel
- **Do not** open the live "searching captain" / tracking screen. Show a confirmation: "Parcel scheduled - pickup {date, time}. A captain will be assigned automatically before the pickup time." with a **Done** button back to home.
- Also register the same local reminders you use for scheduled rides.
- The parcel is **not** the user's current active delivery until it is due, so `GET /taxi/user/deliveries/active/me` returns nothing for it until about 30 minutes before pickup. List it under **Activity -> Scheduled** (existing list endpoint, category `scheduled`) where users can open it and cancel it with the existing cancel API (`PATCH /taxi/user/rides/{id}/cancel`).
- When the pickup time gets close it becomes the active delivery and the normal parcel tracking screen applies.

## Backend rules (no app work, for QA)
- Drivers see the parcel in their **Scheduled** list / push "New scheduled ride"; dispatch to captains starts a lead window before pickup.
- **Gigs:** a scheduled parcel goes only to captains who booked a gig covering the pickup time; if none, it waits in the admin panel for manual assignment (same as scheduled rides).
- COD cash limit rules apply to the remaining cash as usual.

## QA
1. Send now -> unchanged behaviour.
2. Schedule 2 hours ahead, cash -> booked, confirmation screen, parcel under Activity -> Scheduled, no live search.
3. Schedule with COD -> Razorpay for the advance only, then the same confirmation; cancel -> advance back to wallet.
4. Pick less than 1 hour ahead / more than 7 days -> app shows an error; the server also refuses outside 15 min - 30 days.
5. Cancel a scheduled parcel before the time -> disappears from the driver's Scheduled list.
