# Ratings: rate the items you got, not the restaurant/seller (Food, Marketplace, Taxi) - Flutter guide

Base URL `https://sooperbuddy.in/api/v1`. Backend, web apps and admin are live.

## What changed (read this first)
- **Food and Marketplace:** after a delivered order the customer **no longer rates the restaurant / seller directly**. They rate **each dish / product they ordered** (1-5 stars, optional comment) and, if a rider delivered it, the **delivery partner** (unchanged).
- A dish's / product's rating is the average of its ratings. A **restaurant's / seller's rating is the average of all ratings given to its dishes / products** (so one number, built from the items).
- **Taxi is unchanged:** the rider rates only the driver (`PATCH /taxi/rides/{id}/feedback`).
- Old apps that still send `restaurantRating` / `sellerRating` are not broken at the network level, but those values are **ignored** and the call fails with `422 Rate at least one item or the delivery partner` unless it also contains `items` or `deliveryPartnerRating`. Update the apps.

## 1. API (Food and Marketplace use the same body)

| Order type | Request |
|---|---|
| Food order | `PATCH /food/orders/{orderId}/ratings` |
| Marketplace order | `PATCH /quick-commerce/orders/{orderId}/ratings` |

Body:
```json
{
  "items": [
    { "itemId": "6a7...", "rating": 5, "comment": "Fresh and hot" },
    { "itemId": "6a8...", "rating": 3 }
  ],
  "deliveryPartnerRating": 4,
  "deliveryPartnerComment": "On time"
}
```
- `items[].itemId` = the `itemId` of a line in the order (`order.items[].itemId`). `rating` = whole number 1-5. `comment` optional, max 500.
- `deliveryPartnerRating` (1-5, optional) only if the order had a rider. Max 500 chars comment.
- **At least one** of `items` or `deliveryPartnerRating` is required.
- You may rate only some items now and the rest later: items already rated are skipped. The rider can be rated once per order.
- Allowed only for the customer's own order whose `orderStatus == "delivered"`.
- Marketplace orders that contain food items (mixed orders): send them in the same `items` list; each item is credited to the right restaurant or seller.

Success `200`: `{ success:true, data:{ order } }` (Marketplace: `result:{ order }`). The returned `order.ratings` now has:
```json
"ratings": {
  "items": [ { "itemId":"6a7...", "itemType":"food", "name":"Paneer Tikka", "rating":5, "comment":"Fresh and hot", "ratedAt":"..." } ],
  "deliveryPartner": { "rating":4, "comment":"On time", "ratedAt":"..." }
}
```
Errors (show `message`): `400/422` "You can rate only delivered orders", "Rate at least one item...", "One of the rated items is not part of this order", "Each item rating must be a whole number from 1 to 5", "You have already rated the delivery partner for this order", "These items are already rated for this order".

## 2. Screens

**Rate order screen** (opens automatically once after delivery, and from Order details -> "Rate your items"):
1. List every item of the order (name, variant, qty). For each: 5 stars; once a star is chosen show an optional comment box. Already-rated items (`order.ratings.items`) show "Rated 4 ★" and are not editable.
2. If `order.deliveryPartnerId` / rider name exists and `order.ratings.deliveryPartner` is empty: a "How was the delivery?" block with 5 stars + optional comment.
3. **Submit** is enabled when at least one item or the rider has a rating. Send only what the user rated.
4. After success update the local order (`order.ratings`) and show "Thanks for your feedback!". The order counts as **fully rated** when every item is rated and (no rider or rider rated); until then keep a "Rate remaining items" button. "Maybe later" just closes.
5. **Order list/detail "You rated" chip:** show the average of `order.ratings.items[].rating`.

**Marketplace product page:** the "Write a review" form only works for a product from a **delivered order** (once per order); otherwise the API answers `403 You can rate a product only after it has been delivered to you, and only once per order`. Prefer the order rating screen above. `POST /quick-commerce/products/reviews { productId, rating, comment?, orderId? }` still exists for this form; `comment` is optional now, `rating` must be 1-5. Reviews list: `GET /quick-commerce/products/{productId}/reviews` (ratings from orders appear there automatically).

## 3. Where averages are shown (no new API)
- Restaurant lists / details: `restaurant.rating` and `restaurant.totalRatings` (now the average of dish ratings; history from before is kept and new ratings continue from it).
- Seller / shop: `seller.rating`, `seller.totalRatings` likewise.
- Dish: `foodItem.rating`, `foodItem.totalRatings` (new, `0` until rated). Marketplace product: `product.rating` (shown average; stays 4.2 until the first real rating) and `product.totalRatings`.
- Delivery partner: `rating`, `totalRatings` as before. (A rider who works in Food/Marketplace **and** Taxi: Taxi keeps its own counter `ratingCount` - the app should show the Food/Marketplace `rating` or whichever the product team prefers.)

## 4. Restaurant app and Seller app (new screens)
- **Restaurant app -> "Dish ratings"**: `GET /food/restaurant/dish-ratings?page=1&limit=20`
- **Seller app -> "Ratings"**: `GET /seller/ratings?page=1&limit=20`

Same response for both:
```json
{ "data": {
  "summary": { "average": 4.3, "totalRatings": 58 },
  "items":   [ { "itemId":"..", "name":"Paneer Tikka", "image":"..", "count":12, "average":4.5, "latest":".." } ],
  "reviews": [ { "id":"..", "itemId":"..", "itemName":"Paneer Tikka", "rating":5, "comment":"..", "customerName":"Riya", "orderRef":"FOD-123", "createdAt":".." } ],
  "pagination": { "total":58, "page":1, "limit":20, "pages":3 } } }
```
(Seller responses use `result` instead of `data` in the envelope, like the other seller APIs.)
UI: top card with the overall rating and count; "By dish/product" list (image, name, stars, count); "Latest reviews" list with pagination.

## 4b. Admin (web, no Flutter work)
Admin -> Food -> Customer Management -> **Item Ratings**: every dish/product rating with item, restaurant/seller, stars, comment, customer and order, with filters and search.

## 5. Taxi (no change)
`PATCH /taxi/rides/{rideId}/feedback { "rating": 1-5, "comment": "...", "tipAmount": 0 }` after a completed ride; once per ride. Only the driver is rated.

## 6. QA checklist
1. Delivered Food order with 3 dishes and a rider: rate 2 dishes + rider -> `order.ratings.items` has 2, restaurant average moves, the third dish can be rated later, the rider cannot be rated twice.
2. Rating the same dish again in the same order -> skipped / "already rated".
3. Order not delivered -> "You can rate only delivered orders".
4. Marketplace order: rate a product -> seller average and product rating change; the rating appears in the product's review list.
5. Mixed order (food + Marketplace items): each item credited to its own restaurant/seller.
6. Seller app and Restaurant app show the new rating screens with real numbers; admin Item Ratings lists the new ratings.
7. Taxi rating still works and no restaurant/seller rating box appears anywhere.
