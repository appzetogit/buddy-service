# Admin Support Chat – Flutter Integration Guide

Direct real-time chat between **Admin** and **User / Seller / Restaurant / Delivery partner (driver)**.
Admin sets *chat hours*; outside those hours nobody (app side or admin) can send. Reading old messages always works.

Flutter apps only build the **participant side** (the 4 apps below). The admin side is the web panel (Food admin → *Chattings*).

| App | Token role | Socket room (auto-joined by server) |
|---|---|---|
| User | `USER` | `user:<id>` |
| Seller | `SELLER` | `seller:<id>` |
| Restaurant | `RESTAURANT` | `restaurant:<id>` |
| Delivery / Driver | `DELIVERY_PARTNER` or `DRIVER` | `delivery:<id>` |

Where to put it: in each app's **Profile** screen add a "Chat with Admin" tile that opens one shared chat screen.

---

## 1. Basics

- Base URL: `{API_BASE}/api/v1/support-chat` (same host/token as the rest of the app).
- Auth header on every call: `Authorization: Bearer <accessToken>` (the app's normal access token; the server reads the role from it – **do not send role/user id**).
- Response envelope: `{ "success": true, "message": "...", "data": { ... } }`. Errors: `{ "success": false, "message": "..." }`.
- Thread = one per account. It is created automatically on the first message (either side). You never create or pass a thread id.

## 2. REST API (participant)

### GET `/me`  – open the chat screen
```json
{ "data": {
  "status": { "open": true, "enabled": true, "timezone": "Asia/Kolkata",
              "startTime": "09:00", "endTime": "21:00", "days": [0,1,2,3,4,5,6],
              "closedMessage": "Chat is closed right now..." },
  "thread": { "id": "...", "lastMessage": "...", "lastAt": "...", "unreadForParticipant": 2 }   // null if no chat yet
} }
```
`status.open` is the server's verdict right now. `days`: 0 = Sunday … 6 = Saturday.

### GET `/me/messages?limit=30&before=<messageId>`
Cursor pagination (newest page first call; for older pages pass the **id of the oldest message you have** as `before`).
```json
{ "data": { "messages": [ { "id":"..","threadId":"..","sender":"ADMIN|PARTICIPANT","text":"..","clientId":"..|null","createdAt":"ISO" } ],
            "hasMore": true } }
```
`messages` come **oldest → newest** within the page. `limit` max 50.

### POST `/me/messages`
Body: `{ "text": "hello", "clientId": "<uuid you generate>" }` → `201`
```json
{ "data": { "thread": { ... }, "message": { "id":"..", "sender":"PARTICIPANT", "text":"hello", "clientId":"<same>", "createdAt":".." } } }
```
- `text`: 1–2000 chars (trimmed).
- `clientId`: **always send a fresh UUID per message.** If the network drops and you retry the same `clientId`, the server returns the already-saved message (`"duplicate": true`) instead of creating a second one.
- Errors: `403` chat closed (message text = `closedMessage`), `422` empty/too long, `429` more than 30 msgs/min.

### PATCH `/me/read`
Call when the chat screen is visible and there are unread admin messages. Resets `unreadForParticipant` to 0. Idempotent.

## 3. Real-time (Socket.IO)

Use `socket_io_client` (v2/v3, matches server socket.io 4).

```dart
final socket = io.io(
  originOfApi,                       // e.g. https://api.example.com  (origin only, no /api/v1)
  io.OptionBuilder()
    .setPath('/socket.io/')
    .setTransports(['polling', 'websocket'])   // polling first, then upgrade
    .setAuth({'token': accessToken})
    .enableReconnection()
    .build(),
);
```
- The server auto-joins the right rooms from the token – **do not emit any join event**.
- If the token expires, the handshake fails with `AUTH_INVALID`: refresh the token, set `socket.auth = {'token': newToken}` and `socket.connect()`. Re-read the token on every reconnect.

Events received:

| Event | Payload | What to do |
|---|---|---|
| `support_chat:message` | `{ thread, message }` | Add `message` to the list **if not already there** (match by `id` **or** `clientId`). If `message.sender == "ADMIN"` and screen is open → show it and call `PATCH /me/read`; otherwise bump the unread badge. |
| `support_chat:read` | `{ threadId, by }` | `by == "ADMIN"` → admin has read your messages (optional "seen" tick). |
| `support_chat:settings` | same object as `data.status` | Admin changed chat hours → replace local `status`; enable/disable the input immediately. |

You do **not** send messages over the socket – always use `POST /me/messages` (it validates chat hours and saves). The socket is receive-only.

### Reliability rules (important)
1. On every socket `connect` (including reconnects): call `GET /me` + `GET /me/messages?limit=30` and merge – this catches anything missed while offline.
2. While the socket is disconnected, poll `GET /me/messages?limit=30` every ~10 s. Stop polling when connected.
3. When the app returns to foreground (`AppLifecycleState.resumed`): refetch like step 1.
4. Dedupe by `id` and `clientId`. The sender also receives its own message through the socket *and* the POST response – both must collapse to one bubble.

## 4. Sending flow (optimistic UI)

```dart
Future<void> send(String text) async {
  final clientId = const Uuid().v4();
  final temp = Msg(id: 'tmp-$clientId', clientId: clientId, sender: 'PARTICIPANT',
                   text: text, createdAt: DateTime.now(), pending: true);
  add(temp);                                   // show immediately, greyed out
  try {
    final saved = await api.post('/support-chat/me/messages', {'text': text, 'clientId': clientId});
    replaceByClientId(clientId, saved.message); // pending -> sent
  } on ApiError catch (e) {
    remove(temp);
    if (e.status == 403) refreshStatus();       // chat just closed
    showSnack(e.message);                       // closed / rate-limited / validation
    restoreTextIntoInput(text);
  }
}
```

## 5. Chat hours (the time window)

- Source of truth is the server (`status.open`). The input must be **disabled** when `open == false`; show `closedMessage` + "Chat hours: startTime–endTime".
- Window boundaries change without any event (e.g. 21:00 passes). Recompute locally every ~30 s using `status` (`timezone`, `startTime`, `endTime`, `days`), and also re-fetch `/me` on foreground. Rules:
  - `startTime < endTime`: open when current time ∈ [start, end) and today ∈ `days`.
  - `startTime > endTime` (e.g. 22:00–02:00): runs past midnight; the part after midnight belongs to the previous day's `days` entry.
  - `startTime == endTime`: open all day on `days`.
  - `enabled == false`: closed for everyone.
  - Compute "now" in `status.timezone` (use the `timezone` package), not the phone's zone.
- If your local calc disagrees with the server, the server's `403` wins – call `GET /me` and refresh.

## 6. Screens / UX checklist

- Profile → **Chat with Admin** tile (optionally show unread count from `GET /me` → `thread.unreadForParticipant`).
- Chat screen: header (title + Open/Closed dot + hours), message list (newest at bottom, auto-scroll only if the user is near the bottom), "Load earlier" / scroll-to-top pagination using `before`, closed-banner, input + send button (disabled when closed or empty).
- Push notification: when admin replies the server sends an FCM push with `data: { type: "support_chat", threadId }`. Handle tap → open the chat screen. (Uses the existing FCM token registration of each app.)
- Show timestamps in the device's locale (`createdAt` is UTC ISO).

## 7. Suggested Dart structure

```
lib/features/support_chat/
  support_chat_api.dart        // 4 REST calls above
  support_chat_socket.dart     // connect/reconnect, stream of events
  support_chat_repository.dart // merge + dedupe + status timer
  support_chat_controller.dart // state (Bloc/Riverpod/GetX – your choice)
  support_chat_screen.dart
```
One shared package/module can serve all four Flutter apps; only the token provider differs.

## 8. Quick test (curl)

```bash
curl -H "Authorization: Bearer $TOKEN" $API/api/v1/support-chat/me
curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"text":"hi","clientId":"7f1c0f0e-0000-4000-8000-000000000001"}' \
     $API/api/v1/support-chat/me/messages
```
Admin sets hours in web panel: **Chattings → gear icon**.
