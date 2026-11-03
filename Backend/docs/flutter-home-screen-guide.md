# Flutter Guide - Admin-managed Home Screen

The home screen (hero banner, "Choose a service" cards, bottom options) is now
controlled from the admin panel (**Admin > Banner Settings > App Home Screen**).
The app only needs to call **one public API** and render what it returns.

---

## 1. API

```
GET https://sooperbuddy.in/api/v1/common/home-config
```

- **No login / token needed** (works before the user logs in).
- Server caches the response for **60 seconds**, so an admin change shows up within ~1 minute.
- Only **active** items are returned, **already sorted** in the order the admin set. Do not re-sort.

### Response

```json
{
  "success": true,
  "message": "Home config fetched",
  "data": {
    "heroBanners": [
      {
        "id": "6908...",
        "title": "Quick Commerce",
        "subtitle": "Groceries, Essentials & More",
        "imageUrl": "https://sooperbuddy.in/uploads/home/hero_banner/4f6ea158-....webp",
        "iconKey": "",
        "linkType": "service",
        "linkValue": "quick_commerce",
        "sortOrder": 0
      }
    ],
    "serviceCards": [ { "...same fields..." } ],
    "features": [
      {
        "id": "6908...",
        "title": "Live Offers",
        "subtitle": "Coupons at checkout",
        "imageUrl": "https://sooperbuddy.in/uploads/home/feature/d8f4c6cd-....png",
        "iconKey": "percent",
        "linkType": "none",
        "linkValue": "",
        "sortOrder": 0
      }
    ]
  }
}
```

Every item has the same fields:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Unique id |
| `title` | string | May be empty (banners often have no title) |
| `subtitle` | string | May be empty |
| `imageUrl` | string | Full https URL. May be empty for a `feature` that only has `iconKey` |
| `iconKey` | string | Only for `features`: name of a built-in icon (see section 4). Empty otherwise |
| `linkType` | `"none"` \| `"service"` \| `"url"` | What happens on tap |
| `linkValue` | string | Depends on `linkType` (see section 3) |
| `sortOrder` | number | Already applied by the server |

---

## 2. What to render where

| JSON key | Screen area | Image | Notes |
|---|---|---|---|
| `heroBanners` | Top big banner | **1600 x 670** (about 2.4 : 1) | **Can be many** - show as a carousel (PageView) with auto-scroll + dots. 1 item = no carousel |
| `serviceCards` | "Choose a service" cards | **800 x 1100** (portrait, about 0.73 : 1) | Currently 4 cards (Quick Commerce, Food, Taxi, Parcel Delivery). Render as a grid / horizontal list; the count can change from admin |
| `features` | 4 options at the very bottom | **256 x 256** icon (round) | Show `imageUrl` if present, else map `iconKey` to a Flutter icon. Show `title` and `subtitle` under it |

The images already contain the artwork (title text, picture, button look), so for banners and
cards just show the image full-size (`BoxFit.cover`) with rounded corners. Do not draw extra
text over them. `title` / `subtitle` are for accessibility labels and fallbacks.

Use `cached_network_image` so images are cached.

---

## 3. Tap handling

```
switch (item.linkType) {
  "none"    -> do nothing
  "service" -> open the screen for item.linkValue
  "url"     -> open item.linkValue (in-app browser / external launch)
}
```

`linkValue` for `linkType == "service"` is always one of:

| linkValue | Open |
|---|---|
| `quick_commerce` | Quick Commerce home |
| `food` | Food home |
| `taxi` | Taxi home |
| `parcel` | Parcel delivery flow (the Parcel Delivery service card uses this) |

If the app ever receives an **unknown** value (a new service added later), ignore the tap
instead of crashing.

---

## 4. Feature icons (`iconKey`)

If `imageUrl` is not empty, show the image. Otherwise map `iconKey` to a built-in icon.
Current keys the admin can choose:

| iconKey | Suggested Flutter icon |
|---|---|
| `percent` | `Icons.percent` |
| `shield-check` | `Icons.verified_user` |
| `headphones` | `Icons.headset_mic` |
| `truck` | `Icons.local_shipping` |
| `tag` | `Icons.sell` |
| `wallet` | `Icons.account_balance_wallet` |
| `clock` | `Icons.access_time` |
| `star` | `Icons.star` |
| `gift` | `Icons.card_giftcard` |
| `map-pin` | `Icons.location_on` |

Unknown key = show a default icon (e.g. `Icons.info_outline`).

---

## 5. Dart example

```dart
class HomeItem {
  final String id, title, subtitle, imageUrl, iconKey, linkType, linkValue;
  final int sortOrder;
  HomeItem.fromJson(Map<String, dynamic> j)
      : id = j['id'] ?? '',
        title = j['title'] ?? '',
        subtitle = j['subtitle'] ?? '',
        imageUrl = j['imageUrl'] ?? '',
        iconKey = j['iconKey'] ?? '',
        linkType = j['linkType'] ?? 'none',
        linkValue = j['linkValue'] ?? '',
        sortOrder = (j['sortOrder'] ?? 0).toInt();
}

class HomeConfig {
  final List<HomeItem> heroBanners, serviceCards, features;
  HomeConfig(this.heroBanners, this.serviceCards, this.features);

  factory HomeConfig.fromJson(Map<String, dynamic> data) {
    List<HomeItem> list(String k) =>
        ((data[k] ?? []) as List).map((e) => HomeItem.fromJson(e)).toList();
    return HomeConfig(list('heroBanners'), list('serviceCards'), list('features'));
  }
}

Future<HomeConfig> fetchHomeConfig() async {
  final res = await dio.get('https://sooperbuddy.in/api/v1/common/home-config');
  return HomeConfig.fromJson(res.data['data']);
}
```

Tap handling:

```dart
void onHomeItemTap(BuildContext context, HomeItem item) {
  switch (item.linkType) {
    case 'service':
      switch (item.linkValue) {
        case 'quick_commerce': /* open QC */ break;
        case 'food':           /* open Food */ break;
        case 'taxi':           /* open Taxi */ break;
        case 'parcel':         /* open Parcel */ break;
      }
      break;
    case 'url':
      launchUrl(Uri.parse(item.linkValue), mode: LaunchMode.externalApplication);
      break;
    default:
      break; // 'none'
  }
}
```

---

## 6. Rules to follow

1. **Hide a section if its list is empty** (e.g. no hero banners = do not show that area).
2. **Offline / API error:** keep the last successful response (SharedPreferences / local cache)
   and show it; if there is none, show the built-in default layout the app had before.
3. Refresh the config on app start and on pull-to-refresh. No need to poll.
4. Never hardcode the number of items - the admin can add or remove them. Features are
   recommended to be 4, but render whatever comes.
5. Image URLs are absolute (`https://sooperbuddy.in/uploads/...`); use them as is.

---

## 7. Not controlled by this API (still in the app)

The header ("Sooper Buddy / Your Everyday Companion"), the location chip and the search bar
are **not** part of this API yet. They stay as they are in the app.

---

## 8. Quick test

```
curl https://sooperbuddy.in/api/v1/common/home-config
```

Currently live data: 3 hero banners, 4 service cards (incl. Parcel Delivery), 4 bottom options.
Admin can change all of it from the admin panel without an app release.

> Note: there is **no separate parcel banner** any more. Parcel is a normal service card (`linkValue: "parcel"`). The `parcelBanners` key is no longer in the response.
