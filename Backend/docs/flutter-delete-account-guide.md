# Delete Account (User, Seller, Restaurant, Driver) - Flutter guide

Base URL `https://sooperbuddy.in/api/v1`. Backend, web apps and the admin panel are live. This is what each **native Flutter app** must build: a "Delete account" option in **Profile / Settings** with a safe confirmation flow.

## 1. Endpoints (one per app)

| App | Request | Token |
|---|---|---|
| Customer (Food / Marketplace / Taxi user) | `DELETE /food/user/account` | user access token |
| Restaurant | `DELETE /food/restaurant/account` | restaurant access token |
| Seller (Marketplace) | `DELETE /seller/profile` | seller access token |
| Driver / Delivery partner | `DELETE /food/delivery/account` | driver access token |

- Header: `Authorization: Bearer <accessToken>` (the app's normal token; the server reads role and id from it).
- Optional JSON body (a DELETE with a body - in Dio use `data:`): `{ "reason": "Moving to another city" }` - max 300 chars. The admin sees it. Send it only if the person typed something.
- Success: `200 { "success": true, "message": "..." }`.
- Errors you must show as-is (`message` is user-friendly):
  - `409` **active work** - "You still have an active food order... Please finish or cancel it first" (customer: any active food / Marketplace order or taxi ride/parcel; restaurant: any order in progress; seller: any order not yet delivered/cancelled; driver: any active delivery or ride). **Driver only:** "You are holding cash of Rs X. Please deposit it first" (use the cash deposit flow from `flutter-cod-and-cash-complete-guide.md`, then retry).
  - `401` token missing/expired -> normal re-login handling.
  - `404` account not found (already deleted) -> treat as logged out.
  - `500` -> "Could not delete the account, please try again".
- A `409` is **not** a failure of the session: keep the person logged in, show the message in a dialog, do not clear tokens.

## 2. Screens (same flow in all 4 apps)

1. **Profile -> Delete account** (red text, at the bottom).
2. **Warning screen** - show what will happen (copy below), and for money-holding accounts the current numbers if you have them (customer wallet balance; seller/restaurant/driver pending withdrawals). Buttons: "Keep my account" / "Continue".
3. **Reason (optional)** - a short text field "Why are you leaving?" (or a list + "Other").
4. **Final confirmation** - the person must type **`DELETE MY ACCOUNT`** (exact, case-insensitive after trim). The "Delete forever" button stays disabled until it matches.
5. Call the API with a loading state (disable the buttons while the request runs).
6. On `200`: clear everything stored for the session - access/refresh tokens, cached profile, FCM token registration, local notification schedules, any socket connection - then go to the login screen with the toast "Your account has been deleted".

Suggested warning copy:
- Customer: "Your profile, saved addresses, wallet balance and order history will be removed. Any wallet balance is lost. This cannot be undone."
- Restaurant: "Your restaurant and all its menu items will be removed and no longer shown to customers. This cannot be undone."
- Seller: "Your shop and all your products will be hidden from customers immediately and you will not be able to log in again."
- Driver: "Your profile, wallet and earnings history will be removed. Deposit your cash in hand and finish any active job first. This cannot be undone."

## 3. What the backend does (so QA knows what to expect)

| | Customer | Restaurant | Seller | Driver |
|---|---|---|---|---|
| Account | permanently deleted | permanently deleted | soft-deleted (`isDeleted`, login refused) | permanently deleted |
| Listings | - | restaurant **and all foods/addons/menus removed**, so customers stop seeing them at once (lists are re-cached) | **all products set inactive**, hidden from the customer app at once | removed from dispatch |
| Orders / money history | kept for the business, personal details removed | kept, restaurant shown as "Deleted Restaurant" | kept | kept, partner shown as "Deleted Partner" |
| Login tokens | revoked | revoked | revoked | revoked |
| Same phone can sign up again | yes (new account) | yes | **no** - login is refused for a deleted seller; contact support | yes |

- **Admin is informed:** a bell/push notification "<type> account deleted" and a permanent entry in **Admin -> Food -> Customer Management -> Deleted Accounts** (name, phone, type, deleted by self/admin, reason, order count, wallet and pending payout at the time).
- Deleting is blocked while there is active work (see the `409` messages above), so no customer or rider is left hanging.
- Taxi note: the taxi customer app already had `POST /taxi/users/me/delete-request`; it can keep working, but new builds should use `DELETE /food/user/account` (same customer account).

## 4. Dart sketch

```dart
Future<void> deleteAccount({required String path, String? reason}) async {
  try {
    await dio.delete(path, data: (reason ?? '').trim().isEmpty ? null : {'reason': reason!.trim()});
    await session.clearAll();          // tokens, FCM, cache, socket
    router.goToLogin(toast: 'Your account has been deleted');
  } on DioException catch (e) {
    final status = e.response?.statusCode;
    final msg = e.response?.data?['message'] ?? 'Could not delete the account';
    if (status == 404) { await session.clearAll(); router.goToLogin(); return; }
    showDialog(msg);                   // 409 included: stay logged in
  }
}
```

## 5. QA checklist
1. Customer with an active order taps delete -> 409 dialog, still logged in.
2. Customer with no active order -> deleted, back on login, old token no longer works (401).
3. Restaurant deletes -> its foods disappear from the customer app immediately; admin sees "Restaurant account deleted" and a Deleted Accounts row with the reason.
4. Seller deletes -> products vanish from the Marketplace home/search/category lists immediately; seller cannot log in again.
5. Driver holding cash -> 409 "deposit your cash first"; after depositing it works. Driver with an active job -> 409.
6. Reason typed -> visible on the admin Deleted Accounts page; no reason -> empty.
7. "Delete forever" stays disabled until `DELETE MY ACCOUNT` is typed exactly.
