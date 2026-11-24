# Cancellation with a reason (Food, Marketplace, Taxi) - Flutter guide

Base URL `https://sooperbuddy.in/api/v1`. Backend and web apps are live. This lists what every **native Flutter app** must send/show when an order or ride is cancelled.

Rule for all apps: **always ask the person for a reason and send it.** The reason is shown to the customer, admin, restaurant/seller and driver.

## Summary

| App | Action | API | Reason field | Required by server? |
|---|---|---|---|---|
| Food user | Cancel order | `PATCH /food/orders/{id}/cancel` | `reason` | No (app must still require it) |
| Food restaurant | Reject / cancel order | `PATCH /food/restaurant/orders/{id}/status` | `note` | **Yes (new)** |
| Marketplace user | Cancel order | `POST /quick-commerce/orders/{id}/cancel` | `reason` | No (app must still require it) |
| Marketplace seller | Cancel order | `PUT /seller/orders/{id}/status` | `reason` | Yes (already) |
| Taxi user | Cancel ride / parcel | `PATCH /taxi/rides/{id}/cancel` | `reason` | No, stored if sent (**new**) |
| Taxi driver | Give back a scheduled ride | `PATCH /taxi/delivery/rides/{id}/give-back` | `reason` | No, stored if sent (**new**) |
| Admin (web only) | Cancel | existing admin cancel APIs | `reason` | - |

## 1. Food - customer cancels
`PATCH /food/orders/{orderId}/cancel` body `{ "reason": "Ordered by mistake" }` (optional `refundDestination`).
- Show a text box (or a list) and **do not enable the Cancel button until a reason is entered**.
- Refund always goes to the **wallet**. If the order was COD with an advance, the advance returns to the wallet (see `flutter-cod-and-cash-complete-guide.md`).
- The order shows `cancellationReason` afterwards; display "Reason: ..." under a cancelled order.

## 2. Food - restaurant rejects / cancels (CHANGED)
`PATCH /food/restaurant/orders/{orderId}/status` body `{ "orderStatus": "cancelled_by_restaurant", "note": "Item not available" }`.
- **`note` is now mandatory.** Without it the API returns 400 `Cancellation reason is required`.
- Get the list to show from `GET /food/restaurant/orders/rejection-reasons` -> `{ reasons: ["Restaurant is too busy", ...] }` (admin-managed). Always include an "Other" choice that opens a text box and send the typed text (or `Other: <text>`).

## 3. Marketplace - customer cancels
`POST /quick-commerce/orders/{orderId}/cancel` body `{ "reason": "...", "refundTo": "wallet" }`.
- `refundTo`: `wallet` or `gateway` (online-paid orders; COD advance and wallet orders always go to the wallet). Same reason rules as Food: ask first, then send.
- Allowed only until delivery is in progress; otherwise 400 "Order can no longer be cancelled once delivery is in progress" - show it.
- Web note: the QC order page now falls back to this endpoint automatically when the Food endpoint does not know the order. Flutter should call the QC endpoint directly for Marketplace orders.

## 4. Marketplace - seller cancels
`PUT /seller/orders/{orderId}/status` body `{ "status": "cancelled", "reason": "Out of stock" }`. `reason` is mandatory (400 otherwise). Offer presets (Out of stock, Shop closed, ... , Other + text).

## 5. Taxi - rider cancels a ride or parcel (NEW)
`PATCH /taxi/rides/{rideId}/cancel` body `{ "reason": "Driver is taking too long" }` (parcels use the same ride id).
- Load the list from `GET /taxi/users/cancellation-reasons?audience=user` ->
  ```json
  { "data": { "results": [ { "id":"...", "title":"Driver is taking too long", "requiresNote":false }, { "id":"...", "title":"Other", "requiresNote":true } ] } }
  ```
  (admin-managed in the Taxi admin panel -> Cancellation Reasons). If the list cannot be loaded use a built-in fallback: Driver is taking too long / Booked by mistake / Changed my plan / Found another ride / Other.
- If `requiresNote` is true show a text box and send `"<title>: <text>"`.
- **When to ask:** after a captain is assigned (tracking screen) - required, the Cancel button stays disabled until a reason is chosen. While still searching for a driver do not ask; send the fixed reason `"Cancelled while searching for a driver"`.
- The server stores `cancelledBy: "user"`, `cancelReason`, `cancelledAt` on the ride; admin Trips shows "Reason: ...". If the app sends nothing the server stores "Cancelled by user".
- Existing rules are unchanged: the admin cancellation fee still applies; online/COD advance is refunded as described in the COD guide.

## 6. Taxi - driver gives back a scheduled ride (NEW)
`PATCH /taxi/delivery/rides/{rideId}/give-back` body `{ "reason": "Vehicle breakdown" }`.
- Only for upcoming scheduled rides. The ride is **not** cancelled: the passenger keeps the booking and it goes to other drivers; the driver pays the driver cancellation fee.
- Show the driver reasons from `GET /taxi/users/cancellation-reasons?audience=driver` (same shape as above). The reason is saved in the ride's `driverGiveBacks` history (`driverId`, `reason`, `at`).

## 7. Who cancelled (for UI labels)
- Food/QC: `orderStatus` is `cancelled_by_user`, `cancelled_by_restaurant` / `rejected_by_restaurant`, `cancelled_by_admin`; reason in `cancellationReason`.
- Taxi: `ride.status = "cancelled"`, `ride.cancelledBy` is `user`, `admin:<name>` or empty for system cancels, `ride.cancelReason` has the text (system values: `unmatched`, `auto_expired_no_driver_3_hours`).
- Show "Cancelled by you / the restaurant / the shop / admin / no driver found" plus "Reason: ...".

## 8. QA checklist
1. Food customer cancel without a reason -> button disabled; with a reason -> order shows "Reason: ...".
2. Food restaurant reject without `note` -> 400 `Cancellation reason is required`; with a reason from the list -> customer sees it.
3. Marketplace customer cancels from the app -> order cancelled, refund to wallet, reason visible.
4. Marketplace seller cancel without reason -> 400.
5. Taxi: cancel after captain assigned -> reason list from the admin catalog, "Other" needs text, admin Trips shows the reason.
6. Taxi: cancel while searching -> no dialog for reason, stored as "Cancelled while searching for a driver".
7. Taxi driver gives back a scheduled ride with a reason -> ride returns to searching, `driverGiveBacks` has the entry.
8. Online / COD advance refunds still land in the wallet after every cancel above.
