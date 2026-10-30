# Outstation (Intercity) Taxi Integration Guide for Flutter Developers

> **Target Audience:** Flutter App Developers (Rider App & Driver App)  
> **Backend Module:** Taxi & Intercity Dispatch Engine  
> **Version:** 1.2 (Updated: October 2026 - 3-4 Hours Outstation Lifecycle & Automatic Online Refund)

---

## 1. Overview & Key Changes

### A. 3-4 Hours Auto-Cancel (No Immediate Cancellation)
* **Pehle kya hota tha:** Outstation booking 5 minute ke initial search ke baad turant `CANCELLED` ho jati thi, jisse rider ko bar-bar re-book karna padta tha.
* **Ab kya hota hai:** Outstation ride initial search ke baad **cancel NAHI hoti**. Initial buzzer stop ho jata hai lekin booking **`SEARCHING` (active) status** me rehti hai.
  * Drivers is booking ko Driver App ke **"Scheduled / Outstation Rides"** tab me dekh kar kabhi bhi accept kar sakte hain.
  * Booking **3 se 4 hours (3.5 hours)** tak active rehti hai. Agar 3.5 hours me koi driver accept nahi karta aur rider bhi cancel nahi karta, tab jakar system usko auto-cancel karta hai.
  * Agar pickup time jaldi hai (e.g. 2 hours baad pickup hai), to booking pickup se 30 minute pehle auto-cancel hogi.

### B. Automatic Online Payment Refund (Wallet / Gateway)
* Agar rider ne booking ke waqt **Online payment** kiya hai (via Razorpay / UPI / Card / Wallet) aur ride cancel hoti hai (chahe 3.5 hours auto-timeout se, ya user ke manually cancel karne se, ya admin dwara):
  1. **Source Refund (Razorpay):** Agar Razorpay payment ID available hai, to system direct customer ke original payment source (bank / card / UPI) me refund initiate karta hai.
  2. **Wallet Refund:** Agar direct gateway refund na ho sake ya user ne wallet se pay kiya ho, to paisa **turant Customer ke Buddy Wallet (`balance`)** me 100% credit ho jata hai.
  3. **Real-time Event:** Rider app ko instant socket event `'rideRefundProcessed'` receive hota hai taaki UI par confirmation banner show ho sake.

---

## 2. Dispatch, Repeat & Lifecycle Rules

1. **Initial Search Waves:**
   * Jab Outstation booking banti hai, real-time dispatch chalu hota hai (30 seconds per attempt).
   * Agar driver response nahi deta, offer dismiss hokar **repeat/cycle** hokar wapas aata hai.
   * Jab initial waves poori ho jati hain, booking active rehti hai (Scheduled pool me).
2. **Auto-Cancellation Sweeper (3.5 Hours):**
   * Backend background sweeper har 30 seconds me check karta hai.
   * Agar koi Outstation booking 3.5 hours se unaccepted hai, to wo auto-cancel hoti hai aur online payment refund trigger hota hai.

---

## 3. Flutter Rider App Integration

### A. Listening for Outstation Scheduled Pool Status
Jab 5 minute ke initial buzzer attempts khatam hote hain, rider app ko `'rideSearchUpdate'` socket event milta hai:

```json
{
  "rideId": "6ae341484b4812a514045b2a",
  "status": "searching",
  "searchActive": false,
  "isOutstationPending": true,
  "message": "Your outstation booking is active in the scheduled pool. Drivers can accept it from upcoming rides."
}
```
> **Rider App UI Action:** Rider ko search loader band karke "Booking Placed - Waiting for Driver Acceptance" screen ya "Scheduled Rides" screen dikhayein. Rider ko ride cancel karne ki zaroorat nahi hai.

### B. Listening for Automatic Online Refund
Jab booking auto-cancel ya cancel hoti hai aur online refund process hota hai:

* **Socket Event Name:** `'rideRefundProcessed'`
* **Payload Structure:**
```json
{
  "rideId": "6ae341484b4812a514045b2a",
  "amount": 1400.00,
  "refundMethod": "gateway", // "gateway" (original bank/UPI) ya "wallet" (Buddy Wallet)
  "message": "Refund of ₹1400 initiated to your original payment method."
}
```
> **Rider App UI Action:** Screen par Green/Success popup ya snackbar dikhayein:  
> *"Booking cancelled. Refund of ₹1,400 has been credited to your Buddy Wallet / Original Payment Method."*

---

## 4. Flutter Driver App Integration

### A. Scheduled / Outstation Rides Tab
* Drivers ko Outstation booking initial real-time popup me to aati hi hai (30s countdown ke sath).
* Agar initial wave me kisi ne accept nahi kiya, to wo booking driver app ke **Scheduled Rides** tab me **3.5 hours tak live dikhti rahegi**:
  * **API Endpoint:** `GET /api/v1/taxi/driver/rides/scheduled`
  * **Accept API:** `POST /api/v1/taxi/driver/rides/:rideId/accept`
* Jab koi driver wahan se "Accept" dabata hai, ride turant confirm ho jati hai aur rider ko `'rideAccepted'` event chala jata hai.

---

## 5. End-to-End Testing Checklist

| # | Test Case | Expected Behavior | Status |
|---|-----------|-------------------|--------|
| 1 | Rider Outstation ride book karta hai | Real-time dispatch waves start (30s window) | Verified |
| 2 | Driver popup nahi dabata | Card dismiss hota hai aur 1.5s baad wapas repeat hota hai | Verified |
| 3 | Initial attempts khatam hote hain | Ride cancel NAHI hoti, `searching` status me active rehti hai | Verified |
| 4 | Driver "Scheduled Rides" tab open karta hai | Outstation booking list me available show hoti hai | Verified |
| 5 | Driver "Scheduled Rides" se Accept karta hai | Ride confirm hoti hai aur tracking start hoti hai | Verified |
| 6 | Rider ya System 3.5 hours baad cancel karta hai | Ride cancel hoti hai | Verified |
| 7 | Online payment refund check | Razorpay ya Buddy Wallet me amount instant refund hota hai | Verified |
