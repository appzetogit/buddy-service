# Delivery Proof Photo before Drop OTP – Flutter Guide (Food + Quick Commerce)

## What changed

At the customer's door the rider must now **photograph the delivered order first**. The photo is saved on the order and the **customer sees it live in their order screen**. Only after that the rider asks the customer for the OTP and verifies it. No photo → OTP verification / complete is rejected (`400`).

Old flow: `reached-drop → verify-drop-otp → complete`
New flow: `reached-drop → **drop-proof (photo)** → verify-drop-otp → complete`

Covers every order shape (nothing else in the flow changed):

| Order type | Where the photo is stored | Who uploads |
|---|---|---|
| Single restaurant/store, 1 rider | `order.deliveryVerification.dropProof` | that rider |
| Multiple restaurants/stores, 1 rider | same (there is still one drop) | that rider |
| 2 riders (dual leg) – each has own OTP | `order.legs[i].dropProofUrl` | **each rider uploads for their own leg** |
| Multi-store + 2 riders | per leg, as above | each rider |

Rule of thumb for the rider app: *"my photo"* = my leg's `dropProofUrl` if `isDualLeg`/`legs.length > 1` and I have a leg, else `order.deliveryVerification.dropProof.imageUrl`.
(Find my leg: `legs.firstWhere((l) => l.partnerId == myPartnerId)`.)

## 1. Rider app

### Step A – Upload the image (existing upload API)
Same API used for the pickup bill image: `POST /api/v1/uploads/image` (multipart, field `file`, optional `folder`, e.g. `appzeto/delivery/drop-proof`). Response contains the image `url` (`data.url` or `data.secure_url`). Max 5 MB – compress on device (e.g. `image_picker` with `imageQuality: 70`, `maxWidth: 1600`). Use the **camera only** (`ImageSource.camera`) so riders can't attach a gallery photo.

### Step B – Save it on the order

| Order kind | Request |
|---|---|
| Food | `POST /api/v1/food/delivery/orders/{orderId}/drop-proof` |
| Quick Commerce | `POST /api/v1/quick-commerce/delivery/orders/{orderMongoId}/drop-proof` |

Headers: `Authorization: Bearer <rider token>`. Body:
```json
{ "imageUrl": "https://res.cloudinary.com/.../photo.jpg" }
```
- `orderId`: same id you already use for `reached-drop` / `verify-drop-otp` on that order kind (Food: order number or Mongo id; QC: Mongo `_id`).
- `imageUrl` must be an `http(s)` URL (max 1000 chars).

Success `200` → `data.order` is the updated order. Read the photo from:
- single rider: `order.deliveryVerification.dropProof.imageUrl`
- dual leg: `order.legs[i].dropProofUrl`
- both: `order.dropProofs` = `[{ legIndex, imageUrl, uploadedAt }]` (`legIndex: null` for single rider)

Errors (`400/403`, `message` is user-readable – show it):
- *"Mark 'reached drop' before uploading the delivery photo."* – call `reached-drop` first (the photo is only allowed at the drop).
- *"OTP is already verified … photo can no longer be changed."* – too late.
- *"A valid delivery photo URL is required"*.
- `403` not your order / no leg for you.

You may call it again to **replace** the photo (retake) as long as the OTP is not verified yet.

### Step C – OTP (unchanged API)
`verify-drop-otp` (and `complete` when it receives the otp) now return `400` *"Take a photo of the delivered order before verifying the customer OTP."* if no photo exists for that rider. So the UI order is:

1. Rider taps **Reached drop** (OTP is generated and sent to the customer – as before).
2. Screen shows **Step 1: Take photo** (camera) → upload → `drop-proof`. Show a preview + "Retake".
3. Only when a photo exists: enable the OTP boxes / slider (**Step 2**) → `verify-drop-otp` → payment/complete as before.
4. If the screen is reopened (app killed), read the existing photo from the order (see above) and skip step 2 when present.

Dual-leg: every rider does steps 2–3 for **their own leg**; one rider's photo never unlocks the other's OTP.

## 2. Customer app (user)

The order detail/tracking response and the live `order_update` socket event now carry:
```json
"dropProofs": [ { "legIndex": null, "imageUrl": "https://...", "uploadedAt": "2026-..." } ]
```
- Food order APIs and QC order APIs both include `dropProofs` (QC also includes `legs[i].dropProofUrl`).
- Show a **"Delivery photo"** card when `dropProofs` is non-empty (tap = full screen). With two riders there are up to two photos (use `legIndex` to label them "Delivery 1/2").
- Update live: the photo arrives on the existing `order_update` event (same socket the app already listens to for order status); no new event/listener. Also re-read it on screen open / pull-to-refresh.
- The customer keeps seeing the OTP exactly as before – the photo appears first, then the customer gives the OTP to the rider.

## 3. Compatibility / rollout

- Existing endpoints and payloads are unchanged; this only adds `drop-proof` + new response fields.
- **Old rider apps** that don't send a photo will get the `400` above at OTP time. Ship the new rider app first, or temporarily set env `DROP_PROOF_REQUIRED=false` on the server (photo upload still works, it's just not enforced). Default is `true` (enforced).
- Orders with no OTP step are not affected (the check runs only where an OTP is verified).

## 4. Minimal Dart sketch

```dart
Future<void> submitDropProof({required String orderId, required bool isQuick, required File photo}) async {
  final url = await uploadApi.uploadImage(photo, folder: 'appzeto/delivery/drop-proof'); // existing helper
  final path = isQuick
      ? '/quick-commerce/delivery/orders/$orderId/drop-proof'
      : '/food/delivery/orders/$orderId/drop-proof';
  final res = await dio.post(path, data: {'imageUrl': url});
  order = Order.fromJson(res.data['data']['order']); // contains dropProofs
}

bool hasMyProof(Order o, String myPartnerId) {
  final legs = o.legs;
  if (o.isDualLeg && legs.isNotEmpty) {
    final mine = legs.where((l) => l.partnerId == myPartnerId);
    return mine.isNotEmpty && (mine.first.dropProofUrl ?? '').isNotEmpty;
  }
  return (o.deliveryVerification?.dropProof?.imageUrl ?? '').isNotEmpty;
}
```
