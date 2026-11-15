# Flutter - Change Note: Parcel banner removed, Parcel is now a service card

Applies to the home screen API: `GET https://sooperbuddy.in/api/v1/common/home-config`
(full guide: `flutter-home-screen-guide.md`). This note only lists **what changed** and
**what the app must change**.

---

## 1. What changed on the server

| Before | Now |
|---|---|
| Response had a `parcelBanners` list (wide banner under the service cards) | **`parcelBanners` is removed** from the response. There is no parcel banner any more |
| `serviceCards` had 3 cards: Quick Commerce, Food, Taxi | `serviceCards` now has **4 cards**: Quick Commerce, Food, Taxi, **Parcel Delivery** |

Parcel is now a normal service card. It comes from the same `serviceCards` list, in the order the
admin set (Parcel Delivery is 4th).

### Parcel card item (live data)

```json
{
  "id": "6909...",
  "title": "Parcel Delivery",
  "subtitle": "Send Anything, Anywhere",
  "imageUrl": "https://sooperbuddy.in/uploads/home/service_card/759c60ed-0302-4fe2-abea-a9a6d2776b6b.webp",
  "iconKey": "",
  "linkType": "service",
  "linkValue": "parcel",
  "sortOrder": 3
}
```

- Image is **800 x 1100** (portrait), same size as the other service cards.
- Tap -> `linkType == "service"`, `linkValue == "parcel"` -> open the **Parcel Delivery** flow.
- The image already contains the title, the Documents / Products / Gifts / Any Item tiles, the
  scooter and the "Send a Parcel >" button look. Do not draw extra text on top.

### Full `serviceCards` now

| sortOrder | title | linkValue |
|---|---|---|
| 0 | Quick Commerce | `quick_commerce` |
| 1 | Food | `food` |
| 2 | Taxi | `taxi` |
| 3 | Parcel Delivery | `parcel` |

Hero banners (3) and bottom options (4) are unchanged.

---

## 2. What the app must change

1. **Remove** everything that reads `parcelBanners`:
   - the model field / JSON parsing,
   - the wide parcel banner widget under the service cards.
2. **Render the 4th service card** from `serviceCards` like the other three. Do not hardcode 3.
   - A 4-card layout works best as a **2 x 2 grid** (or a horizontally scrolling list). Keep the
     card aspect ratio at about **0.73 : 1** (800 x 1100).
   - The number of cards can change from the admin panel, so build the list from the response.
3. **Handle the tap** `linkValue == "parcel"` -> open the Parcel Delivery screen/flow.
   (This was already in the guide's tap handler; the old parcel banner used the same value.)
4. If a **cached** old response (from before this change) still contains `parcelBanners`, ignore
   it. Do not show a parcel banner from old cache.

### Dart - model (after the change)

```dart
class HomeConfig {
  final List<HomeItem> heroBanners, serviceCards, features; // no parcelBanners
  HomeConfig(this.heroBanners, this.serviceCards, this.features);

  factory HomeConfig.fromJson(Map<String, dynamic> data) {
    List<HomeItem> list(String k) =>
        ((data[k] ?? []) as List).map((e) => HomeItem.fromJson(e)).toList();
    return HomeConfig(list('heroBanners'), list('serviceCards'), list('features'));
  }
}
```

### Dart - service cards as a 2 x 2 grid

```dart
GridView.builder(
  shrinkWrap: true,
  physics: const NeverScrollableScrollPhysics(),
  padding: const EdgeInsets.symmetric(horizontal: 16),
  itemCount: config.serviceCards.length,
  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
    crossAxisCount: 2,
    mainAxisSpacing: 12,
    crossAxisSpacing: 12,
    childAspectRatio: 800 / 1100,
  ),
  itemBuilder: (context, i) {
    final item = config.serviceCards[i];
    return GestureDetector(
      onTap: () => onHomeItemTap(context, item), // handles 'parcel'
      child: ClipRRect(
        borderRadius: BorderRadius.circular(20),
        child: CachedNetworkImage(imageUrl: item.imageUrl, fit: BoxFit.cover),
      ),
    );
  },
)
```

(A horizontal `ListView` of fixed-width cards also works if the design wants a single row.)

---

## 3. Check

```
curl https://sooperbuddy.in/api/v1/common/home-config
```

Expected: `heroBanners` 3, `serviceCards` 4 (the last one is Parcel Delivery), `features` 4, and
**no** `parcelBanners` key.

The admin can still reorder, hide, edit or delete the Parcel Delivery card from
**Admin > Banner Settings > App Home Screen > Service Cards**. If it is hidden, it simply will not
appear in `serviceCards`.
