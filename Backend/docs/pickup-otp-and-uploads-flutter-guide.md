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

---

## 3. Bulk Excel upload for restaurants & sellers (web panel, not rider app)

Restaurants (Food) and sellers (Quick Commerce) can now bulk-upload their own menu items / products from their own panel, using an Excel file plus a folder of images — the same tool admin already had, now self-service. **This section is only relevant if the Flutter app has a restaurant/seller panel; it does not affect the rider or customer apps.**

### Food — restaurant self-service

```
GET  /food/restaurant/foods/bulk-template      -> downloads an .xlsx template
POST /food/restaurant/foods/bulk-upload        -> multipart: file (xlsx) + images[] (jpg/png)

GET  /food/restaurant/addons/bulk-template     -> downloads an .xlsx template
POST /food/restaurant/addons/bulk-upload       -> multipart: file (xlsx) + images[] (jpg/png)
```

Both upload endpoints require the restaurant's normal auth token (same header as every other restaurant-panel call). Every row in the sheet is created under the authenticated restaurant automatically — there's no restaurant-picker field, unlike the admin version.

**Excel columns — Foods:**
`Food Name, Description, Price, Other Price, Food Type (Veg/Non-Veg), Variants, Category Name, Image, Tags, Is Recommended`
- `Variants` (optional): `Name:Price:Unit` separated by `;`, e.g. `Small:149:piece;Large:299:piece`. Leave blank to use the `Price` column for a single-variant item.
- `Image`: exact filename of one of the images uploaded alongside the Excel (e.g. `margherita.jpg`) — it is matched by filename, not by order.

**Excel columns — Addons:**
`Addon Name, Description, Price, Food Type (Veg/Non-Veg), Image`

**Response (both):**
```json
{
  "success": true,
  "message": "Bulk upload processed",
  "data": {
    "created": [{ "row": 2, "id": "650f...", "name": "Margherita Pizza" }],
    "failed": [{ "row": 3, "name": "Paneer Tikka", "reason": "Price is required when no Variants are given" }],
    "totalRows": 2
  }
}
```
Each row succeeds or fails independently — a bad row does not stop the rest of the sheet from importing.

### Quick Commerce — seller self-service

```
GET  /quick-commerce/seller/products/bulk-template   -> downloads an .xlsx template
POST /quick-commerce/seller/products/bulk-upload      -> multipart: file (xlsx) + images[] (jpg/png)
```

Requires the seller's normal auth token. Every row is created under the authenticated seller.

**Excel columns:**
`Product Name, Description, Brand, Header Category, Category, Subcategory, Tags, Price, Sale Price, Stock, Variant Label, Images, Variants, Variant Images`
- Either fill `Variants` (for multiple sizes/packs) **or** just `Price` / `Stock` / `Images` for a single-variant product.
- `Variants` format: `Name:Price:SalePrice:Stock` separated by `;`, e.g. `Small:100:90:20;Large:150:140:10` (leave SalePrice blank if none: `Small:100::20`).
- `Variant Images`: one filename-group per variant, groups separated by `|`, filenames within a group separated by `,`, in the same order as `Variants` — e.g. `small1.jpg,small2.jpg|large1.jpg`. Each variant needs 1–3 images.
- `Header Category` / `Category` / `Subcategory` must exactly match existing category names in that seller's store.

**Response:** same shape as the Food endpoints — `{ created: [...], failed: [...], totalRows: N }`.

### Notes for both
- The uploaded images are matched to Excel rows purely by filename (case-insensitive, ignoring spaces/underscores) — there is no need to upload them in any particular order.
- Images end up on local server storage (see section 2) just like any other upload — the created items' image URLs look like `https://sooperbuddy.in/uploads/...`.
- This is a web-panel feature (multipart file + folder picker); it is not something the rider or customer mobile app needs to call. Only build this if/when the Flutter app has a restaurant-owner or seller-owner panel.
