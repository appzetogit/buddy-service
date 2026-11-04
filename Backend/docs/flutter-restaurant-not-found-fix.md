# Flutter: "Restaurant not found" / slow restaurant details - kya check karna hai

**Backend API mein koi change nahi hua.** Sirf web frontend (`RestaurantDetails.jsx`) fix hua. Flutter ko API ke liye kuch badalna nahi hai; neeche wali galtiyan Flutter mein hon to wahi fix karein.

Endpoint: `GET /food/restaurant/restaurants/:idOrSlug?lat=&lng=`
- Found: `200 { success: true, data: { restaurant } }`
- Real not-found: `404 { success: false, message: "Restaurant not found" }`
- Slug match `restaurantNameNormalized` se hota hai (`-` ko space maan kar). Jahan ho sake **Mongo `_id` se call karein**, slug se nahi.

## Web par kya bug tha (Flutter mein bhi ho sakta hai)

1. **Har error par "not found".** Timeout / 5xx / network error par bhi "Restaurant not found" dikh raha tha.
   - Fix: sirf `statusCode == 404` par not-found screen. Baaki errors par "Load nahi hua" + **Retry** button.
2. **Transient error par retry nahi.** Fix: timeout/5xx/network par 2-3 baar retry (400ms, 800ms backoff). 404 par retry nahi.
3. **Do overlapping fetch.** Location/zone aane par detail call dobara chal jati thi, pehli fail hoti to error flash hota tha.
   - Fix: ek restaurant ke liye ek hi in-flight call (flag ya `Future` cache). Location badalne par naya call mat chalayein agar data aa chuka hai. Lat/lng sirf distance ke liye hai.
4. **Ek hi endpoint do baar.** Dining aur restaurant dono ek hi URL hit karte the, fail hone par wait double. Fix: ek hi call.
5. **Name-search fallback (100 restaurants list)** har failure par chal raha tha. Fix: sirf asli 404 par, aur ho sake to hatayein; list se tap karte waqt `_id` pass karein.
6. **Loading state.** `restaurant == null && error == null` ko "not found" na dikhayein; skeleton/loader dikhayein.

## Flutter ke liye pseudo-code

```dart
Future<Restaurant> fetchRestaurant(String idOrSlug, {double? lat, double? lng}) async {
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      final res = await dio.get('/food/restaurant/restaurants/$idOrSlug',
          queryParameters: {if (lat != null) 'lat': lat, if (lng != null) 'lng': lng});
      return Restaurant.fromJson(res.data['data']['restaurant']);
    } on DioException catch (e) {
      if (e.response?.statusCode == 404) throw RestaurantNotFound(); // only real not-found
      if (attempt == 2) throw RestaurantLoadFailed(e);               // show Retry, not "not found"
      await Future.delayed(Duration(milliseconds: 400 * (attempt + 1)));
    }
  }
  throw RestaurantLoadFailed();
}
```

UI: `NotFound` -> "Restaurant not found"; `LoadFailed` -> error + Retry; `loading` -> skeleton.
