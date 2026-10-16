/**
 * Adds the Uttarakhand (Kashipur) service location + zone to the Taxi admin and fills every admin-managed
 * section for the Indore and Uttarakhand zones:
 *   Service Location, Zone, Airport, Set Price, Package Pricing, Price Hike, Automatic Surge,
 *   Promo Codes, Push Notifications, Banners, Driver Needed Documents, Payment Methods,
 *   Cancellation Reasons, Support Ticket Titles, Goods Types.
 *
 *   node scripts/seed/seedTaxiZones.mjs
 * Idempotent: rows are matched by natural keys and left alone when they already exist.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import { resolve as resolveCommons } from './imageBank.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const URLS_FILE = path.join(HERE, '.cache', 'taxi-urls.json');
const urls = fs.existsSync(URLS_FILE) ? JSON.parse(fs.readFileSync(URLS_FILE, 'utf8')) : {};

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
const { uploadImageBuffer } = await import('../../src/services/cloudinary.service.js');
const svc = await import('../../src/modules/taxi/admin/services/adminService.js');
const promoSvc = await import('../../src/modules/taxi/admin/promotions/services/promotionsService.js');
const { ServiceLocation } = await import('../../src/modules/taxi/admin/models/ServiceLocation.js');
const { Zone } = await import('../../src/modules/taxi/driver/models/Zone.js');
const { Airport } = await import('../../src/modules/taxi/admin/models/Airport.js');
const { SetPrice } = await import('../../src/modules/taxi/admin/models/SetPrice.js');
const { Vehicle } = await import('../../src/modules/taxi/admin/models/Vehicle.js');
const { RentalPackageType } = await import('../../src/modules/taxi/admin/models/UnportedFeatures.js');
const { PromoCode } = await import('../../src/modules/taxi/admin/promotions/models/PromoCode.js');
const { Notification } = await import('../../src/modules/taxi/admin/promotions/models/Notification.js');
const { Banner } = await import('../../src/modules/taxi/admin/promotions/models/Banner.js');
const { PriceHike } = await import('../../src/modules/taxi/admin/models/PriceHike.js');
const { DriverNeededDocument } = await import('../../src/modules/taxi/admin/models/DriverNeededDocument.js');
const { PaymentMethod } = await import('../../src/modules/taxi/admin/models/PaymentMethod.js');
const { CancellationReason } = await import('../../src/modules/taxi/admin/models/CancellationReason.js');
const { GoodsType } = await import('../../src/modules/taxi/admin/models/GoodsType.js');
const { SupportTicketTitle } = await import('../../src/modules/taxi/support/models/SupportTicketTitle.js');

const indore = await ServiceLocation.findOne({ name: 'Indore' });
if (!indore) throw new Error('Indore service location missing');
const indoreZone = await Zone.findOne({ name: 'Indore' });
if (!indoreZone) throw new Error('Indore zone missing');

// ---------------------------------------------------------------- Uttarakhand service location + zone
const KASHIPUR = { lat: 29.2104, lng: 78.9619 };
let uk = await ServiceLocation.findOne({ name: 'Uttarakhand' });
if (!uk) {
  await svc.createServiceLocation({
    name: 'Uttarakhand', address: 'Kashipur, Udham Singh Nagar, Uttarakhand, India', country: 'India',
    currency_name: 'Indian Rupee', currency_symbol: '₹', currency_code: 'INR', timezone: 'Asia/Kolkata', unit: 'km',
    latitude: KASHIPUR.lat, longitude: KASHIPUR.lng, status: 'active',
  });
  uk = await ServiceLocation.findOne({ name: 'Uttarakhand' });
  console.log('service location created: Uttarakhand');
}
let ukZone = await Zone.findOne({ name: 'Uttarakhand' });
if (!ukZone) {
  await svc.createZone({
    name: 'Uttarakhand', service_location_id: String(uk._id), unit: 'km',
    boundary_mode: 'circle', circle_center: KASHIPUR, circle_radius_meters: 80000,
    peak_zone_ride_count: 4, peak_zone_radius: 2, peak_zone_selection_duration: 30, peak_zone_duration: 20, peak_zone_surge_percentage: 20,
    maximum_distance_for_regular_rides: 60, maximum_distance_for_outstation_rides: 400, status: 'active',
  });
  ukZone = await Zone.findOne({ name: 'Uttarakhand' });
  console.log('zone created: Uttarakhand (Kashipur, 80 km)');
}

// ---------------------------------------------------------------- airport
if (!(await Airport.findOne({ code: 'PGH' }))) {
  await svc.createAirport({
    name: 'Pantnagar Airport', code: 'PGH', service_location_id: String(uk._id), zone_id: String(ukZone._id),
    terminal: 'Terminal 1', address: 'Pantnagar, Udham Singh Nagar, Uttarakhand 263145', contact_number: '05944-233500',
    latitude: 29.0334, longitude: 79.4737, airport_surge: 80, support_airport_fee: 150, status: 'active',
  });
  console.log('airport created: Pantnagar');
}

// ---------------------------------------------------------------- set price for the Uttarakhand zone
const FARES = {
  Bike: [25, 2, 7, 0.5, 1], Auto: [35, 2, 11, 1, 1.5], 'Cab Economy': [60, 2, 13, 1.5, 2], 'Cab Premium': [90, 2, 17, 2, 2.5],
  SUV: [120, 2, 21, 2.5, 3], Luxury: [180, 2, 30, 3, 4], Parcel: [45, 2, 12, 1, 1], 'Parcel Bike': [40, 2, 10, 1, 1],
  'Mini Truck': [250, 3, 18, 2, 2], Truck: [600, 5, 28, 3, 3],
};
const CARS = new Set(['Cab Economy', 'Cab Premium', 'SUV', 'Luxury']);
const DELIVERY = new Set(['Parcel', 'Parcel Bike', 'Mini Truck', 'Truck']);
let order = (await SetPrice.countDocuments()) + 1;
for (const [name, [base, baseDist, perKm, perMin, wait]] of Object.entries(FARES)) {
  const v = await Vehicle.findOne({ name }).lean();
  if (!v) continue;
  if (await SetPrice.findOne({ zone_id: ukZone._id, vehicle_type: v._id, pricing_scope: { $ne: 'package' } })) continue;
  const isCar = CARS.has(name);
  const isRide = !DELIVERY.has(name);
  await svc.createSetPrice({
    zone_id: String(ukZone._id), service_location_id: String(uk._id), vehicle_type: String(v._id), transport_type: v.transport_type || 'taxi',
    pricing_scope: 'ride', payment_type: ['cash', 'online', 'wallet'], active: 1, status: 'active',
    admin_commision_type: 1, admin_commision: 5, admin_commission_type_from_driver: 1, admin_commission_from_driver: 10, service_tax: 5,
    base_price: base, base_distance: baseDist, price_per_distance: perKm, time_price: perMin, waiting_charge: wait,
    free_waiting_before: 3, free_waiting_after: 3,
    enable_airport_ride: isCar, support_airport_fee: isCar ? 100 : 0, airport_surge: isCar ? 10 : 0,
    enable_outstation_ride: isCar, support_outstation: isCar ? 1 : 0,
    outstation_base_price: isCar ? base * 4 : 0, outstation_base_distance: isCar ? 20 : 0,
    outstation_price_per_distance: isCar ? Number((perKm * 0.9).toFixed(1)) : 0, outstation_time_price: isCar ? perMin : 0,
    enable_shared_ride: 0, enable_ride_sharing: false,
    user_cancellation_fee: isRide ? 20 : 30, driver_cancellation_fee: isRide ? 10 : 15,
    user_cancellation_fee_type: 'amount', driver_cancellation_fee_type: 'amount', cancellation_fee_goes_to: 'admin',
    order_number: order++, bill_status: 1,
  });
  console.log('set price created: Uttarakhand /', name);
}

// ---------------------------------------------------------------- package pricing (Uttarakhand)
const typeId = {};
for (const t of await RentalPackageType.find({}).lean()) typeId[t.name] = String(t._id);
const rows = async (prices) => {
  const out = [];
  for (const [name, [base, freeKm, perKm, freeMin, perMin]] of Object.entries(prices)) {
    const v = await Vehicle.findOne({ name }).lean();
    if (!v) continue;
    out.push({
      vehicle_type: String(v._id), base_price: base, free_distance: freeKm, distance_price: perKm, free_time: freeMin, time_price: perMin,
      admin_commision_type: 1, admin_commision: 5, admin_commission_type_from_driver: 1, admin_commission_from_driver: 10,
      service_tax: 5, cancellation_fee: 100, active: 1,
    });
  }
  return out;
};
const UK_PACKAGES = [
  ['Local Rental', 'Kashipur City (8 hrs / 80 km)', { 'Cab Economy': [1300, 80, 13, 480, 1], 'Cab Premium': [1800, 80, 17, 480, 1.5], SUV: [2300, 80, 21, 480, 2] }],
  ['Day Trip', 'Jim Corbett Safari (Ramnagar)', { 'Cab Economy': [2400, 120, 12, 480, 1], 'Cab Premium': [3200, 120, 16, 480, 1.5], SUV: [4000, 120, 20, 480, 2] }],
  ['Pilgrimage Tour', 'Kainchi Dham and Nainital', { 'Cab Economy': [3800, 260, 12, 600, 1], 'Cab Premium': [4900, 260, 16, 600, 1.5], SUV: [6200, 260, 20, 600, 2] }],
  ['Weekend Getaway', 'Nainital, Bhimtal and Mukteshwar', { 'Cab Economy': [8200, 450, 12, 1500, 1], 'Cab Premium': [10800, 450, 16, 1500, 1.5], SUV: [13500, 450, 20, 1500, 2], Luxury: [18500, 450, 28, 1500, 3] }],
  ['Pilgrimage Tour', 'Haridwar and Rishikesh Darshan', { 'Cab Economy': [6500, 420, 12, 900, 1], 'Cab Premium': [8400, 420, 16, 900, 1.5], SUV: [10500, 420, 20, 900, 2] }],
];
for (const [type, destination, prices] of UK_PACKAGES) {
  if (await SetPrice.findOne({ pricing_scope: 'package', package_destination: destination })) continue;
  await svc.createSetPrice({
    pricing_scope: 'package', transport_type: 'rental', service_location_id: String(uk._id),
    package_type_id: typeId[type], package_destination: destination, package_availability: 'available',
    status: 'active', active: 1, package_vehicle_prices: await rows(prices),
  });
  console.log('package pricing created:', destination);
}

// ---------------------------------------------------------------- price hike slots + automatic surge
const WEEKDAYS = [1, 2, 3, 4, 5];
const ALL = [0, 1, 2, 3, 4, 5, 6];
const HIKES = [
  ['Weekday Morning Rush', WEEKDAYS, '08:00', '10:30', 1.2, true],
  ['Weekday Evening Rush', WEEKDAYS, '17:30', '20:30', 1.25, true],
  ['Late Night Rides', ALL, '23:00', '05:00', 1.3, true],
  ['Weekend Evening Demand', [0, 6], '18:00', '22:00', 1.15, false],
  ['Festive Season (Diwali Week)', ALL, '10:00', '22:00', 1.35, false],
];
for (const [label, days, start, end, multiplier, active] of HIKES) {
  if (await PriceHike.findOne({ label })) continue;
  await svc.createPriceHike({ label, days, start_time: start, end_time: end, timezone: 'Asia/Kolkata', multiplier, active });
  console.log('price hike created:', label);
}
await svc.updateAutomaticSurge({ enabled: true, window_minutes: 10, min_demand: 3, trigger_ratio: 1.5, ratio_step: 0.5, step: 0.1, max_multiplier: 2, hold_minutes: 10 });

// ---------------------------------------------------------------- promo codes (Uttarakhand + existing codes extended)
const bothIds = [String(indore._id), String(uk._id)];
const from = '2026-10-01';
const to = '2027-03-31';
const UK_PROMOS = [
  ['KASHIPUR20', 'taxi', 20, 60, 100, 5, 0],
  ['HILLS15', 'taxi', 15, 150, 800, 2, 1500],
  ['CORBETT100', 'taxi', 10, 100, 1500, 1, 500],
  ['PARCELUK25', 'delivery', 25, 50, 70, 4, 0],
];
for (const [code, transport, pct, maxDiscount, minTrip, perUser, maxTotal] of UK_PROMOS) {
  if (await PromoCode.findOne({ code })) continue;
  await promoSvc.createPromoCode({
    code, transport_type: transport, discount_percentage: pct, maximum_discount_amount: maxDiscount,
    cumulative_max_discount_amount: maxDiscount * perUser, minimum_trip_amount: minTrip, from, to, uses_per_user: perUser, max_uses_total: maxTotal,
    service_location_ids: [String(uk._id)], user_specific: false,
  });
  console.log('promo created:', code);
}
// the platform-wide codes also run in Uttarakhand
for (const code of ['WELCOME50', 'BUDDY20', 'AIRPORT100', 'OFFICE30', 'FESTIVE40', 'WEEKEND10']) {
  const promo = await PromoCode.findOne({ code });
  if (!promo || (promo.service_location_ids || []).some((id) => String(id) === String(uk._id))) continue;
  promo.service_location_ids.push(uk._id);
  promo.service_location_names.push(uk.service_location_name || uk.name);
  await promo.save();
}

// ---------------------------------------------------------------- push notification history
const DAY = 86400000;
const UK_NOTIFICATIONS = [
  ['all', 'Buddy is now in Kashipur', 'Book cabs, autos and bike taxis across Kashipur and Udham Singh Nagar. Use KASHIPUR20 on your first ride.', 8],
  ['users', 'Weekend trip to Jim Corbett?', 'Fixed-fare Corbett and Nainital packages with an SUV are live. Book your weekend getaway today.', 4],
  ['drivers', 'Drivers wanted in Kashipur', 'Register your cab, auto or bike and start earning with Buddy in Uttarakhand.', 2],
];
for (const [sendTo, title, message, daysAgo] of UK_NOTIFICATIONS) {
  if (await Notification.findOne({ push_title: title })) continue;
  await Notification.create({
    service_location_id: uk._id, service_location_name: uk.service_location_name || uk.name,
    send_to: sendTo, push_title: title, message, status: 'sent', sent_at: new Date(Date.now() - daysAgo * DAY),
  });
  console.log('notification created:', title);
}

// ---------------------------------------------------------------- banners (Uttarakhand)
async function photo(query) {
  const key = `commons|taxi/banners|${query}`;
  if (urls[key]) return urls[key];
  const r = await resolveCommons(query, 0, {});
  urls[key] = await uploadImageBuffer(fs.readFileSync(r.file), 'taxi/banners');
  fs.writeFileSync(URLS_FILE, JSON.stringify(urls, null, 1));
  return urls[key];
}
for (const [title, query] of [['Weekend Getaway to Nainital', 'Nainital lake'], ['Jim Corbett Safari Rides', 'Jim Corbett National Park']]) {
  if (await Banner.findOne({ title })) continue;
  try {
    const image = await photo(query);
    await Banner.create({ title, image, link_type: 'deep_link', deep_link: '/taxi/user/intercity', redirect_url: '/taxi/user/intercity', active: true });
    console.log('banner created:', title);
  } catch (e) { console.log('banner skipped:', title, e.message); }
}

// ---------------------------------------------------------------- driver needed documents
const DOCS = [
  { name: 'Driving Licence', image_type: 'front_back', has_expiry_date: true, has_identify_number: true, identify_number_key: 'licenseNumber', verification_type: 'driving_license' },
  { name: 'Aadhaar Card', image_type: 'front_back', has_expiry_date: false, has_identify_number: true, identify_number_key: 'aadhaarNumber' },
  { name: 'PAN Card', image_type: 'front', has_expiry_date: false, has_identify_number: true, identify_number_key: 'panNumber', verification_type: 'pan' },
  { name: 'Vehicle RC', image_type: 'front_back', has_expiry_date: true, has_identify_number: true, identify_number_key: 'rcNumber', verification_type: 'rc' },
  { name: 'Vehicle Insurance', image_type: 'front', has_expiry_date: true, has_identify_number: true, identify_number_key: 'insuranceNumber' },
  { name: 'Fitness Certificate', image_type: 'front', has_expiry_date: true, has_identify_number: false },
  { name: 'Police Verification', image_type: 'front', has_expiry_date: true, has_identify_number: false },
  { name: 'Profile Photo', image_type: 'front', has_expiry_date: false, has_identify_number: false },
];
for (const doc of DOCS) {
  if (await DriverNeededDocument.findOne({ template_type: 'document', name: doc.name })) continue;
  await svc.createDriverNeededDocument({ ...doc, template_type: 'document', account_type: 'individual', is_editable: true, is_required: true, active: true });
  console.log('driver document created:', doc.name);
}

// ---------------------------------------------------------------- payment methods (driver payouts)
const METHODS = [
  ['UPI', [{ type: 'text', name: 'UPI ID', placeholder: 'name@bank', is_required: true }]],
  ['Bank Transfer', [
    { type: 'text', name: 'Account Holder Name', placeholder: 'As per bank records', is_required: true },
    { type: 'number', name: 'Account Number', placeholder: 'Bank account number', is_required: true },
    { type: 'text', name: 'IFSC Code', placeholder: 'e.g. SBIN0000821', is_required: true },
    { type: 'text', name: 'Bank Name', placeholder: 'e.g. State Bank of India', is_required: true },
  ]],
];
for (const [name, fields] of METHODS) {
  if (await PaymentMethod.findOne({ name })) continue;
  await svc.createPaymentMethod({ method_name: name, fields, active: true });
  console.log('payment method created:', name);
}

// ---------------------------------------------------------------- cancellation reasons
const REASONS = {
  user: ['Driver is taking too long', 'Driver asked me to cancel', 'Booked by mistake', 'Found another ride', 'Change of plans', 'Wrong pickup location', 'Other'],
  driver: ['Rider is not at the pickup point', 'Rider is not responding', 'Rider asked me to cancel', 'Vehicle problem', 'Too far from pickup', 'Wrong address in the booking', 'Other'],
};
for (const [audience, titles] of Object.entries(REASONS)) {
  let i = 1;
  for (const title of titles) {
    if (!(await CancellationReason.findOne({ audience, title }))) {
      await CancellationReason.create({ title, audience, requiresNote: title === 'Other', order_by: i, active: true });
    }
    i++;
  }
}

// ---------------------------------------------------------------- support ticket titles
const TITLES = [
  ['user', 'general', ['Payment or refund issue', 'Fare is different from the estimate', 'Driver behaviour', 'App is not working properly', 'Promo code not applied']],
  ['user', 'request', ['Lost item in the ride', 'Invoice request', 'Wrong route was taken']],
  ['driver', 'general', ['Wallet or payout issue', 'Document verification pending', 'App is not working properly', 'Rider behaviour']],
  ['driver', 'request', ['Fare dispute for a trip', 'Update vehicle details', 'Reactivate my account']],
];
for (const [userType, supportType, titles] of TITLES) {
  for (const title of titles) {
    if (await SupportTicketTitle.findOne({ title, userType })) continue;
    await SupportTicketTitle.create({ title, userType, supportType, active: true });
  }
}

// ---------------------------------------------------------------- goods types
const GOODS = ['Documents and Letters', 'Groceries', 'Food and Tiffin', 'Electronics', 'Clothes and Footwear', 'Medicines', 'Furniture and Home Goods', 'Gifts and Flowers'];
for (const name of GOODS) {
  if (await GoodsType.findOne({ goods_type_name: name })) continue;
  await svc.createGoodsType({ goods_type_name: name, goods_types_for: 'delivery', active: 1 });
}

await mongoose.disconnect();
process.exit(0);
