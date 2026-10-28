# Pickup OTP & Local File Uploads — Flutter Guide

This covers two backend changes that affect the rider (delivery partner) app:

1. A new pickup OTP step for Food and Quick Commerce orders.
2. All image/video upload URLs now point to our own server instead of Cloudinary.

---

## 1. Pickup OTP

### What changed

When a restaurant (Food) or seller (Quick Commerce) marks an order **ready for pickup**, the backend generates a random 4-digit OTP and shows it only to that restaurant/seller. The rider must ask for this code and submit it together with the bill photo when confirming pickup.

**The existing pickup flow is unchanged** — bill photo upload still works exactly as before. The OTP is an additional, optional field in the same request.

### API change — confirm pickup

Both Food and Quick Commerce use the same endpoint shape:

```
PATCH /food/delivery/orders/:orderId/confirm-pickup
PATCH /quick-commerce/delivery/orders/:orderId/confirm-pickup
```

**Request body** — add `pickupOtp`:

```json
{
  "billImageUrl": "https://sooperbuddy.in/uploads/appzeto/delivery/bills/<uuid>.webp",
  "pickupOtp": "4821"
}
```

- `pickupOtp` is a string of up to 4 digits.
- Only send it when the store actually generated one (see below) — if no OTP was generated for that order/stop, omit the field or send an empty string; the backend skips verification in that case.

### How the rider knows an OTP is required

The order object returned to the rider (from the offer card, trip details, and after every pickup/status action) now includes:

- **Single-restaurant / single-store order**: `hasPickupOtp: true|false` and `pickupOtpVerified: true|false` at the top level of the order.
- **Multi-restaurant / multi-store order**: each entry in `pickups[]` has its own `hasPickupOtp` and `pickupOtpVerified`.

The rider never receives the actual OTP value — only these two booleans. Show the OTP input field whenever `hasPickupOtp` is `true` and `pickupOtpVerified` is `false` for the current pickup stop.

### UI flow (mirrors the existing bill-photo step)

1. Rider reaches the restaurant/store and opens the pickup screen (same screen as today).
2. Rider takes/uploads the bill photo (unchanged).
3. If `hasPickupOtp` is true for this stop, show a 4-digit OTP input next to the bill photo.
4. The "Slide to Pick Up" / confirm button stays disabled until the bill photo is uploaded **and**, when required, the OTP is entered.
5. Submit both in the same confirm-pickup call.

### Error handling

If the OTP is wrong, the confirm-pickup call fails with a normal error response:

```json
{
  "success": false,
  "message": "Invalid pickup OTP. Ask the restaurant for the code shown on their order screen."
}
```

Show this message to the rider and let them re-enter the code — nothing else about the order state changes on a failed attempt.

### Multi-restaurant / multi-store orders

For orders with more than one pickup stop, each stop can have its own OTP. The rider picks up from one restaurant/store at a time; send `pickupOtp` for whichever stop is currently being picked up (the backend matches it to the current stop automatically — you don't need to specify which stop).

---

## 2. Local file storage (Cloudinary removed)

All image/video uploads (food photos, bill photos, profile images, documents, etc.) used to return a Cloudinary URL like:

```
https://res.cloudinary.com/<cloud-name>/image/upload/v169.../appzeto/food/abc123.webp
```

They now return a URL hosted on our own server instead:

```
https://sooperbuddy.in/uploads/appzeto/food/<uuid>.webp
```

### What this means for Flutter

**No code change should be required.** Both are plain absolute HTTPS URLs — load them in an `Image.network(...)` (or your image-loading widget) exactly as before.

**One thing to check:** if any code hardcodes or special-cases the `cloudinary.com` domain (e.g. for a specific image transform, CDN check, or URL pattern match), that logic will no longer apply to new uploads. Old images uploaded before this change are untouched and will still be served from Cloudinary, so both domains can appear in the same list of images for a while — don't assume every image URL is from one host or the other.

No new fields, no new response shape — just a different domain in the URL string.
