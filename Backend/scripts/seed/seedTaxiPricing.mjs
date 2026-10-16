/**
 * Fills the Taxi admin sections:
 *   Price Management: Service Location, Zone, Airport, Set Price
 *   Package Pricing:  rental package types + destination packages with per-vehicle prices
 *   Promotions:       Promo Codes, Push Notifications (history)
 * Run seedTaxiUserApp.mjs first (it creates the vehicle types these prices attach to).
 *
 *   node scripts/seed/seedTaxiPricing.mjs
 * Idempotent: rows are matched by natural keys and left alone when they already exist.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
const svc = await import('../../src/modules/taxi/admin/services/adminService.js');
const promo = await import('../../src/modules/taxi/admin/promotions/services/promotionsService.js');
const { ServiceLocation } = await import('../../src/modules/taxi/admin/models/ServiceLocation.js');
const { Zone } = await import('../../src/modules/taxi/driver/models/Zone.js');
const { Airport } = await import('../../src/modules/taxi/admin/models/Airport.js');
const { SetPrice } = await import('../../src/modules/taxi/admin/models/SetPrice.js');
const { Vehicle } = await import('../../src/modules/taxi/admin/models/Vehicle.js');
const { RentalPackageType } = await import('../../src/modules/taxi/admin/models/UnportedFeatures.js');
const { PromoCode } = await import('../../src/modules/taxi/admin/promotions/models/PromoCode.js');
const { Notification } = await import('../../src/modules/taxi/admin/promotions/models/Notification.js');

const ZoneModel = Zone;

const indore = await ServiceLocation.findOne({ name: 'Indore' });
const delhi = await ServiceLocation.findOne({ name: 'New Delhi' });
if (!indore || !delhi) throw new Error('Service locations Indore / New Delhi not found');

// ---------------------------------------------------------------- service location fix
// the New Delhi row was saved with Indore's map point
await ServiceLocation.updateOne(
  { _id: delhi._id },
  { $set: { 'location.coordinates': [77.209, 28.6139], latitude: 28.6139, longitude: 77.209 } },
);

// ---------------------------------------------------------------- zones
const indoreZone = await ZoneModel.findOne({ name: 'Indore' });
if (indoreZone) {
  await ZoneModel.updateOne(
    { _id: indoreZone._id, peak_zone_ride_count: null },
    { $set: { peak_zone_ride_count: 5, peak_zone_radius: 2, peak_zone_selection_duration: 30, peak_zone_duration: 20, peak_zone_surge_percentage: 20, maximum_distance_for_regular_rides: 60, maximum_distance_for_outstation_rides: 500 } },
  );
}
let delhiZone = await ZoneModel.findOne({ name: 'New Delhi' });
if (!delhiZone) {
  await svc.createZone({
    name: 'New Delhi', service_location_id: String(delhi._id), unit: 'km',
    boundary_mode: 'circle', circle_center: { lat: 28.6139, lng: 77.209 }, circle_radius_meters: 45000,
    peak_zone_ride_count: 6, peak_zone_radius: 2, peak_zone_selection_duration: 30, peak_zone_duration: 20, peak_zone_surge_percentage: 25,
    maximum_distance_for_regular_rides: 70, maximum_distance_for_outstation_rides: 600, status: 'active',
  });
  delhiZone = await ZoneModel.findOne({ name: 'New Delhi' });
  console.log('zone created: New Delhi');
}

// ---------------------------------------------------------------- airports
const indoreAirport = await Airport.findOne({ service_location_id: indore._id });
if (indoreAirport && !indoreAirport.code) {
  indoreAirport.name = 'Devi Ahilya Bai Holkar Airport';
  indoreAirport.code = 'IDR';
  indoreAirport.zone_id = indoreZone?._id || null;
  indoreAirport.terminal = 'Terminal 1';
  indoreAirport.address = 'Airport Road, Devi Ahilya Bai Holkar Airport, Indore, Madhya Pradesh 452005';
  indoreAirport.contact_number = '0731-2410031';
  indoreAirport.latitude = 22.7218;
  indoreAirport.longitude = 75.8011;
  indoreAirport.location = { type: 'Point', coordinates: [75.8011, 22.7218] };
  await indoreAirport.save();
  console.log('airport updated: Indore');
}
if (!(await Airport.findOne({ code: 'DEL' }))) {
  await svc.createAirport({
    name: 'Indira Gandhi International Airport', code: 'DEL', service_location_id: String(delhi._id), zone_id: String(delhiZone._id),
    terminal: 'Terminal 3', address: 'New Delhi, Delhi 110037', contact_number: '011-24632950',
    latitude: 28.5562, longitude: 77.1, airport_surge: 100, support_airport_fee: 250, status: 'active',
  });
  console.log('airport created: Delhi IGI');
}

// ---------------------------------------------------------------- set price (ride / delivery fares)
const vehicle = async (name) => Vehicle.findOne({ name }).lean();
// base, base distance (km), price per km, per minute, waiting per minute
const FARES = {
  Bike: [25, 2, 7, 0.5, 1],
  Auto: [35, 2, 11, 1, 1.5],
  'Cab Economy': [60, 2, 13, 1.5, 2],
  'Cab Premium': [90, 2, 17, 2, 2.5],
  SUV: [120, 2, 21, 2.5, 3],
  Luxury: [180, 2, 30, 3, 4],
  Parcel: [45, 2, 12, 1, 1],
  'Parcel Bike': [40, 2, 10, 1, 1],
  'Mini Truck': [250, 3, 18, 2, 2],
  Truck: [600, 5, 28, 3, 3],
};
const CARS = new Set(['Cab Economy', 'Cab Premium', 'SUV', 'Luxury']);
let order = 1;
for (const [zone, sl, mult] of [[indoreZone, indore, 1], [delhiZone, delhi, 1.1]]) {
  for (const [name, [base, baseDist, perKm, perMin, wait]] of Object.entries(FARES)) {
    const v = await vehicle(name);
    if (!v || !zone) continue;
    const exists = await SetPrice.findOne({ zone_id: zone._id, vehicle_type: v._id, pricing_scope: { $ne: 'package' } });
    if (exists) continue;
    const m = (n) => Number((n * mult).toFixed(1));
    const isCar = CARS.has(name);
    const isRide = !['Parcel', 'Parcel Bike', 'Mini Truck', 'Truck'].includes(name);
    await svc.createSetPrice({
      zone_id: String(zone._id), service_location_id: String(sl._id), vehicle_type: String(v._id),
      pricing_scope: 'ride', transport_type: v.transport_type || 'taxi', payment_type: ['cash', 'online', 'wallet'], active: 1, status: 'active',
      admin_commision_type: 1, admin_commision: 5,
      admin_commission_type_from_driver: 1, admin_commission_from_driver: 10,
      service_tax: 5,
      base_price: m(base), base_distance: baseDist, price_per_distance: m(perKm), time_price: m(perMin), waiting_charge: m(wait),
      free_waiting_before: 3, free_waiting_after: 3,
      enable_airport_ride: isCar, support_airport_fee: isCar ? 100 : 0, airport_surge: isCar ? 10 : 0,
      enable_outstation_ride: isCar, support_outstation: isCar ? 1 : 0,
      outstation_base_price: isCar ? m(base * 4) : 0, outstation_base_distance: isCar ? 20 : 0,
      outstation_price_per_distance: isCar ? m(perKm * 0.9) : 0, outstation_time_price: isCar ? m(perMin) : 0,
      enable_shared_ride: name === 'Cab Economy' ? 1 : 0, enable_ride_sharing: name === 'Cab Economy',
      price_per_seat: name === 'Cab Economy' ? m(45) : 0, shared_price_per_distance: name === 'Cab Economy' ? m(7) : 0,
      shared_cancel_fee: name === 'Cab Economy' ? 20 : 0,
      user_cancellation_fee: isRide ? 20 : 30, driver_cancellation_fee: isRide ? 10 : 15,
      user_cancellation_fee_type: 'amount', driver_cancellation_fee_type: 'amount', cancellation_fee_goes_to: 'admin',
      order_number: order++, bill_status: 1,
    });
    console.log(`set price created: ${sl.name} / ${name}`);
  }
}

// ---------------------------------------------------------------- package pricing
const PACKAGE_TYPES = [
  ['Local Rental', 'Hourly rental within the city (8 hrs / 80 km included)'],
  ['Day Trip', 'Out and back in the same day with a fixed fare'],
  ['Weekend Getaway', '2 days and 1 night trip with driver stay included'],
  ['Pilgrimage Tour', 'Darshan trips with waiting time for temple visits'],
];
const packageTypeId = {};
for (const [name, description] of PACKAGE_TYPES) {
  let t = await RentalPackageType.findOne({ name });
  if (!t) {
    const created = await svc.createRentalPackageType({ transport_type: 'taxi', name, short_description: description, description, status: 'active' });
    t = { _id: created._id || created.id };
    console.log('package type created:', name);
  }
  packageTypeId[name] = String(t._id);
}

// vehicle rows: base fare, included km, per km beyond, included minutes, per minute
const rows = async (prices) => {
  const out = [];
  for (const [name, [base, freeKm, perKm, freeMin, perMin]] of Object.entries(prices)) {
    const v = await vehicle(name);
    if (!v) continue;
    out.push({
      vehicle_type: String(v._id), base_price: base, free_distance: freeKm, distance_price: perKm, free_time: freeMin, time_price: perMin,
      admin_commision_type: 1, admin_commision: 5, admin_commission_type_from_driver: 1, admin_commission_from_driver: 10,
    });
  }
  return out;
};
const PACKAGES = [
  ['Local Rental', 'Indore City (8 hrs / 80 km)', { 'Cab Economy': [1400, 80, 14, 480, 1], 'Cab Premium': [1900, 80, 18, 480, 1.5], SUV: [2400, 80, 22, 480, 2] }],
  ['Pilgrimage Tour', 'Ujjain Mahakaleshwar Darshan', { 'Cab Economy': [2200, 120, 13, 360, 1], 'Cab Premium': [2900, 120, 17, 360, 1.5], SUV: [3600, 120, 21, 360, 2] }],
  ['Pilgrimage Tour', 'Omkareshwar Jyotirlinga', { 'Cab Economy': [3000, 160, 13, 420, 1], 'Cab Premium': [3900, 160, 17, 420, 1.5], SUV: [4800, 160, 21, 420, 2] }],
  ['Day Trip', 'Maheshwar and Mandu', { 'Cab Economy': [4200, 280, 12, 600, 1], 'Cab Premium': [5400, 280, 16, 600, 1.5], SUV: [6600, 280, 20, 600, 2], Luxury: [9000, 280, 28, 600, 3] }],
  ['Day Trip', 'Bhopal and Bhimbetka', { 'Cab Economy': [4600, 400, 12, 720, 1], 'Cab Premium': [5900, 400, 16, 720, 1.5], SUV: [7200, 400, 20, 720, 2] }],
  ['Weekend Getaway', 'Pachmarhi Hill Station', { 'Cab Economy': [9800, 650, 12, 1500, 1], 'Cab Premium': [12500, 650, 16, 1500, 1.5], SUV: [15500, 650, 20, 1500, 2], Luxury: [21000, 650, 28, 1500, 3] }],
];
for (const [type, destination, prices] of PACKAGES) {
  const exists = await SetPrice.findOne({ pricing_scope: 'package', package_destination: destination });
  if (exists) continue;
  await svc.createSetPrice({
    pricing_scope: 'package', transport_type: 'rental', service_location_id: String(indore._id),
    package_type_id: packageTypeId[type], package_destination: destination, package_availability: 'available',
    status: 'active', active: 1, package_vehicle_prices: await rows(prices),
  });
  console.log(`package pricing created: ${type} / ${destination}`);
}

// ---------------------------------------------------------------- promo codes
const DAY = 86400000;
const from = new Date('2026-10-01');
const to = new Date('2027-03-31');
const PROMOS = [
  ['WELCOME50', 'taxi', 50, 100, 150, 1, 0, 'Flat 50% off on your first ride (up to Rs 100)'],
  ['BUDDY20', 'taxi', 20, 50, 120, 5, 0, '20% off on rides above Rs 120'],
  ['AIRPORT100', 'taxi', 15, 100, 400, 3, 0, 'Airport transfers: 15% off up to Rs 100'],
  ['OFFICE30', 'taxi', 30, 80, 100, 10, 2000, '30% off for weekday office rides'],
  ['PARCEL25', 'delivery', 25, 60, 80, 4, 0, '25% off on parcel deliveries'],
  ['MOVER15', 'delivery', 15, 150, 500, 2, 500, '15% off on goods and truck bookings'],
  ['FESTIVE40', 'all', 40, 120, 200, 2, 3000, 'Festive season offer on rides and deliveries'],
  ['WEEKEND10', 'all', 10, 40, 0, 4, 0, '10% off on weekend rides, no minimum fare'],
];
for (const [code, transport, pct, maxDiscount, minTrip, perUser, maxTotal] of PROMOS) {
  if (await PromoCode.findOne({ code })) continue;
  await promo.createPromoCode({
    code, transport_type: transport, discount_percentage: pct, maximum_discount_amount: maxDiscount,
    cumulative_max_discount_amount: maxDiscount * perUser, minimum_trip_amount: minTrip,
    from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10),
    uses_per_user: perUser, max_uses_total: maxTotal,
    service_location_ids: [String(indore._id), String(delhi._id)], user_specific: false,
  });
  console.log('promo created:', code);
}

// ---------------------------------------------------------------- push notification history
const NOTIFICATIONS = [
  ['all', 'Welcome to Buddy', 'Book your first ride with code WELCOME50 and get 50% off.', 21],
  ['users', 'Airport rides made easy', 'Pre-book an airport cab and use AIRPORT100 to save up to Rs 100.', 14],
  ['drivers', 'Higher earnings this weekend', 'Peak-hour surge is live in Indore this weekend. Go online and earn more per ride.', 10],
  ['users', 'Send parcels in minutes', 'Need to send something across town? Try Parcel Bike delivery with PARCEL25.', 6],
  ['all', 'Festive offer is live', 'Use FESTIVE40 on rides and deliveries and save up to Rs 120.', 3],
  ['drivers', 'Complete your documents', 'Upload your licence and vehicle papers so you do not miss ride requests.', 1],
];
for (const [sendTo, title, message, daysAgo] of NOTIFICATIONS) {
  if (await Notification.findOne({ push_title: title })) continue;
  await Notification.create({
    service_location_id: indore._id, service_location_name: indore.service_location_name || indore.name,
    send_to: sendTo, push_title: title, message, status: 'sent', sent_at: new Date(Date.now() - daysAgo * DAY),
  });
  console.log('notification created:', title);
}

await mongoose.disconnect();
process.exit(0);
