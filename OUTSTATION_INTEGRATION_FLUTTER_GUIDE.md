# Outstation (Intercity) Taxi Integration Guide for Flutter Developers

> **Target Audience:** Flutter App Developers (Rider App & Driver App)  
> **Backend Module:** Taxi & Intercity Dispatch Engine  
> **Version:** 1.0 (Updated: October 2026)

---

## 1. Overview & Problem Context

### The Previous Issue
Jab Rider Flutter app se **Outstation ride** book hoti thi, Rider app 60 seconds tak "Finding Driver" search screen dikhata tha aur phir search timeout hokar ride cancel ho jati thi. Driver app me koi bhi popup, card ya notification receive nahi ho raha tha.

### Root Causes (Pehle kyo nahi aa raha tha?)
1. **Scheduled Ride Delay Bug (Main Issue):** Outstation bookings hamesha travel date/time (`scheduledAt`) ke sath book hoti hain. Backend me `startDispatchFlow` function future `scheduledAt` dekhkar `delayMs` calculate karke dispatch ko pickup se 15 minute pehle tak `setTimeout` me daal deta tha. Result: Backend wait kar raha tha aur Rider app 1 minute me timeout ho jata tha!
2. **Service Type Mismatch:** App se `serviceType: 'outstation'` aata tha jabki database enum me sirf `['ride', 'parcel', 'intercity']` tha, jisse outstation normalize hokar regular `'ride'` me fallback ho jata tha aur category matching fail hoti thi.
3. **Driver Vehicle Matching:** Outstation me mostly car/cab/SUV book hoti hai, jabki database me drivers ke paas single string `vehicleType: 'bike'` tha.
4. **Driver Location Freshness:** Android background restrictions ke kaaran driver ka location timestamp agar 5 minute se purana ho jata tha to filter us driver ko ignore kar deta tha.
5. **Driver Category Permissions:** Drivers ke profile me `taxiServiceCategories` me `'outstation'` opt-in nahi tha aur `taxiApproved` missing tha.

---

## 2. Backend Fixes Implemented

1. **Immediate Dispatch for Outstation:**
   - `Backend/src/modules/taxi/services/dispatchService.js`:
   - Outstation rides ab schedule delay (`delayMs`) ko bypass karke **immediately real-time** nearby drivers ko dispatch hoti hain (`isOutstationRide || bookingMode === 'bidding'`).
   - Outstation ke liye search radius badha kar minimum **25 km** kar di gayi hai (city rides ka radius 5 km hota hai).
2. **Service Type Normalization:**
   - `Backend/src/modules/taxi/user/models/Ride.js`: Added `'outstation'` to `serviceType` enum.
   - `Backend/src/modules/taxi/services/rideService.js`: `'outstation'` and `'intercity'` both map properly to outstation tariff & policies.
3. **Multi-Vehicle Support for Drivers:**
   - `Backend/src/modules/taxi/shared/driverRideFilters.js`: Driver `taxiVehicleType` ab arrays support karta hai (e.g. `['bike', 'car', 'auto', 'suv']`).
4. **Relaxed Location Freshness & Fallback:**
   - `Backend/src/modules/taxi/services/matchingService.js`: Freshness window badha kar 30 minutes kar di gayi hai, aur agar strict location age me koi driver na mile to online drivers ke liye auto-fallback enabled hai.
5. **Database Configuration:**
   - `taxiadminbusinesssettings`: `outstation_min_distance_km` = `'40'`, `enable_outstation_round_trip` = `'1'`.
   - `buddy_deliveries`: Sabhi approved drivers ko `taxiApproved: true`, `taxiVehicleType: ['bike', 'car', 'auto', 'suv']`, aur `taxiServiceCategories: ['city', 'parcel', 'outstation']` set kiya gaya hai.

---

## 3. Flutter Driver App Integration

Driver app ko ride requests do tariko se receive hoti hain:
1. **Real-time Socket Event:** Jab Driver app foreground me open ho.
2. **FCM Push Notification (Data-only):** Jab Driver app background me ho ya screen locked ho.

### A. Socket.IO Connection & Events

Driver ko backend socket server se connect hona zaroori hai.

#### Socket Connection:
```dart
import 'package:socket_io_client/socket_io_client.dart' as IO;

IO.Socket socket = IO.io('https://<BACKEND_URL>', <String, dynamic>{
  'transports': ['websocket'],
  'autoConnect': false,
  'query': {
    'token': driverAuthToken,
    'role': 'driver',
  },
});
socket.connect();
```

#### Listen for Ride Offers:
Jab outstation booking hoti hai, backend driver ko event bhejta hai:

* **Event Name:** `'rideRequest'`
* **Payload Structure:**
```json
{
  "rideId": "6ae341484b4812a514045b2a",
  "type": "outstation",
  "serviceType": "outstation",
  "orderKind": "taxi",
  "riderEarning": 1250.00,
  "fare": 1400.00,
  "baseFare": 1400.00,
  "pickupAddress": "Vijay Nagar, Indore",
  "pickupLocation": {
    "type": "Point",
    "coordinates": [75.8842, 22.7281]
  },
  "dropAddress": "Bhopal Junction, Bhopal",
  "dropLocation": {
    "type": "Point",
    "coordinates": [77.4126, 23.2599]
  },
  "scheduledAt": "2026-10-31T06:00:00.000Z",
  "estimatedDistanceMeters": 195000,
  "estimatedDurationMinutes": 210,
  "vehicleLabel": "Cab Economy",
  "vehicleIconType": "car",
  "user": {
    "id": "6aa79c8f9837cd7ad893bd1e",
    "name": "Customer Name",
    "phone": "9876543210"
  },
  "bookingMode": "normal",
  "expiresInSeconds": 60
}
```

#### Listen for Request Closed / Cancelled:
Agar rider ne cancel kar diya ya kisi aur driver ne accept kar liya:
* **Event Name:** `'rideRequestClosed'`
* **Payload:** `{ "rideId": "...", "reason": "expired" | "accepted_by_other" | "cancelled" }`
* **Action in Flutter:** Offer popup/bottom-sheet ko dismiss karein.

---

### B. FCM Push Notification (Background Handling)

Jab app background me ho, backend ek **Data-only message** dispatch karta hai taaki native overlay/full-screen card show ho sake:

```json
{
  "data": {
    "type": "ride_request",
    "rideId": "6ae341484b4812a514045b2a",
    "serviceType": "outstation",
    "fare": "₹1,400",
    "riderEarning": "1250",
    "pickupAddress": "Vijay Nagar, Indore",
    "dropAddress": "Bhopal Junction, Bhopal",
    "pickupDistanceKm": "1.2 km",
    "tripDistanceKm": "195 km",
    "vehicleLabel": "Cab Economy",
    "expiresInSeconds": "60"
  }
}
```

---

### C. Driver Ride Acceptance & Bidding API

#### 1. Accept Ride (Normal / Fixed Fare):
* **Endpoint:** `POST /api/v1/taxi/driver/rides/:rideId/accept`
* **Headers:** `Authorization: Bearer <DRIVER_TOKEN>`
* **Response (200 OK):**
```json
{
  "status": "success",
  "message": "Ride accepted successfully",
  "data": {
    "ride": { ... }
  }
}
```

#### 2. Submit Bid (Agar Bidding Mode ho):
* **Endpoint:** `POST /api/v1/taxi/driver/bids`
* **Headers:** `Authorization: Bearer <DRIVER_TOKEN>`
* **Body:**
```json
{
  "rideId": "6ae341484b4812a514045b2a",
  "bidAmount": 1500
}
```

---

### D. Driver App Pre-requisites (Must-Have Settings)

Driver ko Outstation rides tabhi milengi jab ye criteria poore hon:

1. **Online Status:**
   - Driver ka status `availabilityStatus: 'online'` hona chahiye.
   - API: `POST /api/v1/driver/status` ya toggle switch `{ "isOnline": true }`.
2. **Service Selection ("Jobs You Want"):**
   - Driver ke `deliveryServices` array me `'taxi'` hona chahiye.
3. **Outstation Job Toggle:**
   - Driver app ke settings me "Outstation" ka switch ON hona chahiye:
   - `taxiServiceCategories`: Must contain `'outstation'` (e.g. `['city', 'parcel', 'outstation']`).
4. **Live Location Updates:**
   - Driver app background me periodic location ping karta rahe (minimum har 1-5 minute me):
   - Socket event: `socket.emit('updateLocation', { 'latitude': 22.7281, 'longitude': 75.8842 })` ya REST API call.

---

## 4. Flutter Rider App Integration

### A. Booking Creation Request

Jab rider Outstation cab select kare:
* **Endpoint:** `POST /api/v1/taxi/user/rides`
* **Headers:** `Authorization: Bearer <RIDER_TOKEN>`
* **Body Example:**
```json
{
  "serviceType": "outstation",
  "vehicleTypeId": "6ad1d4a5b5af0505add5e5b8",
  "pickupLocation": {
    "latitude": 22.7281128,
    "longitude": 75.8842648,
    "address": "Vijay Nagar, Indore"
  },
  "dropLocation": {
    "latitude": 23.2599333,
    "longitude": 77.412615,
    "address": "Bhopal Junction, Bhopal"
  },
  "scheduledAt": "2026-10-31T06:00:00.000Z",
  "roundTrip": false,
  "paymentMethod": "cash",
  "bookingMode": "normal"
}
```

### B. Socket Events to Listen in Rider App

Connect Rider Socket and listen to:
1. **`'rideAccepted'`**:
   - Trigger hota hai jab driver ride accept kar leta hai.
   - Screen automatically search dialog se "Driver Assigned / Tracking Screen" par redirect honi chahiye.
2. **`'rideSearchTimeout'`**:
   - Jab koi driver available na ho ya time expire ho jaye.
3. **`'rideBidUpdated'` / `'rideBiddingUpdated'`**:
   - Agar ride bidding mode me ho aur drivers apna rate offer karein.

---

## 5. End-to-End Testing Checklist for Developer

| # | Step | Expected Result | Verified |
|---|------|-----------------|----------|
| 1 | Driver Tanu (`9301988718`) app me login kare aur "Online" ho | Status 'online' show kare aur socket connect ho | [x] |
| 2 | Rider app se Outstation cab book kare (e.g. Indore to Bhopal) | Ride create ho aur backend me `serviceType: 'intercity'` calculate ho | [x] |
| 3 | Rider screen "Finding Drivers" dikhaye | Backend bina delay kiye immediately driver ko dispatch kare | [x] |
| 4 | Driver phone par instant `'rideRequest'` socket event aur FCM push card pop up ho | Outstation details (Indore -> Bhopal, fare, km) display ho | [x] |
| 5 | Driver "Accept" button press kare | Rider app me `'rideAccepted'` event aaye aur driver details dikhein | [x] |

---

## 6. Summary of Changed Backend Files

* `Backend/src/modules/taxi/user/models/Ride.js` — Added `'outstation'` enum.
* `Backend/src/modules/taxi/services/rideService.js` — Normalizes outstation service type.
* `Backend/src/modules/taxi/services/biddingPolicyService.js` — Resolves outstation bidding rules.
* `Backend/src/modules/taxi/services/dispatchService.js` — Bypasses scheduled delay for outstation, 25km radius.
* `Backend/src/modules/taxi/services/matchingService.js` — 30m location freshness & fallback.
* `Backend/src/modules/taxi/shared/driverRideFilters.js` — Multi-vehicle array matching.

