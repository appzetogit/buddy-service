/**
 * Fills the Taxi admin "User App Management" sections with real data (stored in the database):
 *   App Modules, Vehicle Types (+ vehicle preferences they depend on), Promo Banners,
 *   and the user-home settings: Home Sections, Everything In Minutes, Explore Cards,
 *   Promo Banners, Go Places and Footer Content.
 *
 *   node scripts/seed/seedTaxiUserApp.mjs [--dry]
 *
 * Idempotent (existing rows are matched by name/title and left in place). Images are uploaded to the
 * platform Cloudinary once and cached in .cache/taxi-urls.json.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import { resolve as resolveCommons } from './imageBank.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(HERE, '../../../Frontend/src/modules/taxi/assets');
const DRY = process.argv.includes('--dry');
const URLS_FILE = path.join(HERE, '.cache', 'taxi-urls.json');
const urls = fs.existsSync(URLS_FILE) ? JSON.parse(fs.readFileSync(URLS_FILE, 'utf8')) : {};

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
const { uploadImageBuffer } = await import('../../src/services/cloudinary.service.js');
const adminService = await import('../../src/modules/taxi/admin/services/adminService.js');
const { TaxiAppModule } = await import('../../src/modules/taxi/admin/models/TaxiAppModule.js');
const { Vehicle } = await import('../../src/modules/taxi/admin/models/Vehicle.js');
const { UserPreference } = await import('../../src/modules/taxi/admin/models/UserPreference.js');
const { Banner } = await import('../../src/modules/taxi/admin/promotions/models/Banner.js');

/** Upload a project asset (path under taxi/assets) once and return its hosted URL. */
async function asset(rel, folder) {
  const key = `${folder}|${rel}`;
  if (urls[key]) return urls[key];
  if (DRY) return `dry://${rel}`;
  const buf = fs.readFileSync(path.join(ASSETS, rel));
  urls[key] = await uploadImageBuffer(buf, folder);
  fs.writeFileSync(URLS_FILE, JSON.stringify(urls, null, 1));
  return urls[key];
}

/** Real photograph from Wikimedia Commons, re-hosted on Cloudinary. */
async function photo(query, folder) {
  const key = `commons|${folder}|${query}`;
  if (urls[key]) return urls[key];
  if (DRY) return `dry://${query}`;
  const r = await resolveCommons(query, 0, {});
  urls[key] = await uploadImageBuffer(fs.readFileSync(r.file), folder);
  fs.writeFileSync(URLS_FILE, JSON.stringify(urls, null, 1));
  return urls[key];
}

// ---------------------------------------------------------------- app modules
const MODULES = [
  ['Daily Rides', 'taxi', 'normal', 'car', 'icons/car.png', 'Everyday city cab rides', 'Book a hatchback, sedan or SUV cab for quick point-to-point rides across the city at upfront fares.'],
  ['Bike Taxi', 'taxi', 'normal', 'bike', 'icons/bike.png', 'Beat the traffic', 'Solo rides on a bike taxi: the fastest and cheapest way through busy roads.'],
  ['Auto Rickshaw', 'taxi', 'normal', 'auto', 'icons/auto.png', 'Local auto rides', 'Metered-fair auto rickshaw rides for short city trips and market runs.'],
  ['Premium Cabs', 'taxi', 'normal', 'premium', 'icons/Premium.png', 'Sedans with top-rated drivers', 'Comfortable sedans driven by our highest-rated captains for office and airport transfers.'],
  ['Outstation', 'taxi', 'outstation', 'suv', 'icons/SUV.png', 'One-way and round trips', 'Plan an intercity trip with an SUV or sedan, with fixed fares and flexible return.'],
  ['Bid Ride', 'taxi', 'bid', 'car', 'icons/car.png', 'Name your own fare', 'Offer your own price and let nearby drivers accept or counter it.'],
  ['Parcel Delivery', 'delivery', 'normal', 'bike', 'icons/Delivery.png', 'Send anything, anywhere', 'Documents, gifts and small parcels picked up and delivered within the city on a bike.'],
  ['Goods & Trucks', 'delivery', 'normal', 'truck', 'icons/truck.png', 'Move bigger loads', 'Mini trucks and tempos for bulky goods, shop stock and furniture.'],
  ['Packers & Movers', 'delivery', 'outstation', 'lcv', 'images/delivery/movers.png', 'Shift homes with ease', 'Vehicle with loaders for home and office shifting, within the city or between cities.'],
];

const moduleIds = {};
let order = 1;
for (const [name, transport, service, iconFor, icon, short, description] of MODULES) {
  let doc = await TaxiAppModule.findOne({ name });
  if (!doc && !DRY) {
    const mobile_menu_icon = await asset(icon, 'taxi/app-modules');
    doc = await TaxiAppModule.create({
      name, transport_type: transport, service_type: service, icon_types_for: iconFor, order_by: order,
      short_description: short, description, mobile_menu_icon, mobile_menu_cover_image: mobile_menu_icon, active: 1,
    });
    console.log('app module created:', name);
  }
  order++;
  if (doc) moduleIds[name] = String(doc._id);
}

// ---------------------------------------------------------------- vehicle preferences
const PREFERENCES = ['Air Conditioned', 'Luggage Space', 'Child Seat', 'Pet Friendly', 'Female Driver', 'Wheelchair Accessible'];
const preferenceIds = {};
for (const name of PREFERENCES) {
  let p = await UserPreference.findOne({ name });
  if (!p && !DRY) {
    p = await adminService.createPreference({ name });
    console.log('preference created:', name);
  }
  if (p) preferenceIds[name] = String(p._id);
}

// ---------------------------------------------------------------- vehicle types
const delivery = (base, free, dist) => ({ enabled: true, base_price: base, free_distance: free, distance_price: dist, free_time: 5, time_price: 1 });
const VEHICLES = [
  { name: 'Bike', category: 'bike', icon_types: 'bike', cap: 1, size: '1', img: 'icons/bike.png', modules: ['Bike Taxi'], prefs: [], short: 'Quick solo rides', desc: 'Skip the traffic on a bike taxi. Helmet provided.' },
  { name: 'Auto', category: 'auto', icon_types: 'auto', cap: 3, size: '3', img: 'icons/auto.png', modules: ['Auto Rickshaw'], prefs: ['Luggage Space'], short: 'Affordable local rides', desc: 'Three-seater auto rickshaw for short city trips.' },
  { name: 'Cab Economy', category: 'car', icon_types: 'car', cap: 4, size: '4', img: 'icons/Hatchback.png', modules: ['Daily Rides', 'Bid Ride'], prefs: ['Air Conditioned', 'Luggage Space'], short: 'Hatchback, up to 4 riders', desc: 'Comfortable AC hatchbacks for everyday rides.' },
  { name: 'Cab Premium', category: 'car', icon_types: 'premium', cap: 4, size: '4', img: 'icons/Premium.png', modules: ['Daily Rides', 'Premium Cabs', 'Bid Ride'], prefs: ['Air Conditioned', 'Luggage Space', 'Child Seat'], short: 'Sedan with top-rated drivers', desc: 'Spacious sedans with the highest-rated captains.', supports: ['Cab Economy'] },
  { name: 'SUV', category: 'car', icon_types: 'suv', cap: 6, size: '6', img: 'icons/SUV.png', modules: ['Daily Rides', 'Outstation'], prefs: ['Air Conditioned', 'Luggage Space', 'Child Seat'], short: 'Up to 6 riders', desc: 'Roomy SUVs for family trips and outstation journeys.', supports: ['Cab Economy', 'Cab Premium'] },
  { name: 'Luxury', category: 'car', icon_types: 'Luxary', cap: 4, size: '4', img: 'icons/Luxury.png', modules: ['Premium Cabs', 'Outstation'], prefs: ['Air Conditioned', 'Luggage Space', 'Wheelchair Accessible'], short: 'Arrive in style', desc: 'Top-end luxury sedans for weddings, events and business travel.', supports: ['Cab Premium'] },
  {
    name: 'Parcel Bike', category: 'bike', icon_types: 'bike', cap: 0, size: '1', img: 'images/delivery/bike.png', modules: ['Parcel Delivery'], prefs: [], transport: 'delivery', del: '2wheeler',
    pricing: delivery(40, 2, 10), short: 'Parcels up to 10 kg', desc: 'Fast two-wheeler delivery for documents and small parcels.',
  },
  {
    name: 'Mini Truck', category: 'car', icon_types: 'LCV', cap: 0, size: '1000 kg', img: 'icons/LCV.png', modules: ['Goods & Trucks', 'Packers & Movers'], prefs: [], transport: 'delivery', del: 'trucks',
    pricing: delivery(250, 3, 18), short: 'Loads up to 1 tonne', desc: 'Tata Ace style mini truck for shop stock, furniture and small shifts.',
  },
  {
    name: 'Truck', category: 'car', icon_types: 'truck', cap: 0, size: '3000 kg', img: 'icons/truck.png', modules: ['Goods & Trucks', 'Packers & Movers'], prefs: [], transport: 'delivery', del: 'trucks',
    pricing: delivery(600, 5, 28), short: 'Loads up to 3 tonnes', desc: 'Large trucks for heavy goods and full home shifting.',
  },
];

const vehicleIds = {};
for (const v of VEHICLES) {
  let doc = await Vehicle.findOne({ name: v.name });
  if (!doc && !DRY) {
    const image = await asset(v.img, 'taxi/vehicle-types');
    const created = await adminService.createVehicleType({
      name: v.name, short_description: v.short, description: v.desc,
      transport_type: v.transport || 'taxi', dispatch_type: 'normal', icon_types: v.icon_types, category: v.category,
      capacity: v.cap, size: v.size, is_accept_share_ride: v.category === 'car' && v.cap >= 4 ? 1 : 0,
      delivery_category: v.del, delivery_distance_pricing: v.pricing,
      admin_commission_type_from_driver: 1, admin_commission_from_driver: 10,
      image, map_icon: image, icon: image, status: 1,
      vehicle_preference: v.prefs.map((p) => preferenceIds[p]).filter(Boolean),
      app_modules: v.modules.map((m) => moduleIds[m]).filter(Boolean),
    });
    doc = created;
    console.log('vehicle type created:', v.name);
  }
  if (doc) vehicleIds[v.name] = String(doc._id);
}
// the pre-existing "Parcel" vehicle: give it the missing image/modules/preferences
const legacy = await Vehicle.findOne({ name: 'Parcel' });
if (legacy && !DRY) {
  const image = await asset('icons/Delivery.png', 'taxi/vehicle-types');
  const patch = {};
  if (!legacy.image) Object.assign(patch, { image, icon: image, map_icon: image });
  if (!legacy.short_description) patch.short_description = 'Send anything on a bike';
  if (!legacy.app_modules?.length) patch.app_modules = [moduleIds['Parcel Delivery']].filter(Boolean);
  if (Object.keys(patch).length) {
    await Vehicle.updateOne({ _id: legacy._id }, { $set: patch });
    console.log('vehicle type updated: Parcel');
  }
  vehicleIds.Parcel = String(legacy._id);
}
// vehicles that can also take cheaper rides
for (const v of VEHICLES) {
  if (!v.supports || DRY || !vehicleIds[v.name]) continue;
  await Vehicle.updateOne(
    { _id: vehicleIds[v.name] },
    { $set: { supported_other_vehicle_types: v.supports.map((n) => vehicleIds[n]).filter(Boolean) } },
  );
}

// ---------------------------------------------------------------- banners
const BANNERS = [
  ['Experience A New Standard With Buddy', 'user-app/yellow-taxi.jpg', '/taxi/user/ride/select-location'],
  ['Need to Send Packages? Try Parcel!', 'images/delivery/bike.png', '/taxi/user/parcel/type'],
  ['Beat the Traffic With Bike Taxi', 'user-app/banner-taxi.jpg', '/taxi/user/ride/select-location'],
  ['Outstation Trips Made Easy', 'seamless_highway_bg.png', '/taxi/user/ride/select-location'],
];
const bannerImages = {};
for (const [title, img, route] of BANNERS) {
  let b = await Banner.findOne({ title });
  if (!b && !DRY) {
    const image = await asset(img, 'taxi/banners');
    b = await Banner.create({ title, image, link_type: 'deep_link', deep_link: route, redirect_url: route, active: true });
    console.log('banner created:', title);
  }
  if (b) bannerImages[title] = b.image;
}

// ---------------------------------------------------------------- user-home settings
const R = '/taxi/user/ride/select-location';
const P = '/taxi/user/parcel/type';
const item = (id, title, subtitle, image, route) => ({
  id: String(id), title, subtitle, image, uploadedImage: image, route, order: id, status: 'active', imageDisplayMode: 'illustration', imageMode: 'illustration',
});

if (!DRY) {
  const a = (rel) => asset(rel, 'taxi/user-app');
  const settings = {
    homeSections: { enableEverything: true, enableExplore: true, enablePromo: true, enableGoPlaces: true, enableFooter: true },
    everything: [
      item(1, 'Parcel', 'Send anything', await a('user-app/parcel.png'), P),
      item(2, 'Bike Taxi', 'Beat the traffic', await a('icons/bike.png'), R),
      item(3, 'Book now', 'Your everyday rides', await a('icons/Hatchback.png'), R),
      item(4, 'All Services', 'All Services', await a('icons/SUV.png'), ''),
    ],
    explore: [
      item(1, 'Parcel on Bike', '', await a('images/delivery/bike.png'), P),
      item(2, 'Auto', '', await a('icons/auto.png'), R),
      item(3, 'Cab Economy', '', await a('icons/Hatchback.png'), R),
      item(4, 'Bike', '', await a('icons/bike.png'), R),
    ],
    promos: [
      { ...item(1, 'Experience A New Standard With Buddy', 'A premier private hire service where luxury and reliability converge.', bannerImages[BANNERS[0][0]], R), imageDisplayMode: 'cover', imageMode: 'cover' },
      { ...item(2, 'Need to Send Packages? Try Parcel!', 'Fast and secure delivery across Indore at affordable prices.', bannerImages[BANNERS[1][0]], P), imageDisplayMode: 'cover', imageMode: 'cover' },
      { ...item(3, 'Beat the Traffic With Bike Taxi', 'Reach on time with a quick bike ride, helmets provided.', bannerImages[BANNERS[2][0]], R), imageDisplayMode: 'cover', imageMode: 'cover' },
      { ...item(4, 'Outstation Trips Made Easy', 'One-way and round trips at fixed fares with SUVs and sedans.', bannerImages[BANNERS[3][0]], R), imageDisplayMode: 'cover', imageMode: 'cover' },
    ],
    goPlaces: [
      { ...item(1, 'Hassle-Free Airport Rides', '', await photo('Indore airport terminal', 'taxi/user-app'), R), imageDisplayMode: 'cover', imageMode: 'cover' },
      { ...item(2, 'Quick Rides to Railway Station', '', await photo('Indore Junction railway station', 'taxi/user-app'), R), imageDisplayMode: 'cover', imageMode: 'cover' },
      { ...item(3, 'Ride to Bus Terminal', '', await photo('Indore bus stand', 'taxi/user-app'), R), imageDisplayMode: 'cover', imageMode: 'cover' },
    ],
    footer: {
      hashtag: '#goBuddy',
      line1: 'Made for India',
      line2: 'Crafted for riders',
      image: '',
      uploadedImage: await a('seamless_highway_bg.png'),
    },
  };
  await adminService.updateGeneralSettings('user-home-management', { settings });
  console.log('user home settings saved (home sections, everything, explore, promos, go places, footer)');
}

await mongoose.disconnect();
process.exit(0);
