/**
 * Seeds the Uttarakhand food zone with 20 Kashipur restaurants (approved), each with a full menu of
 * dishes carrying real photographs hosted on the platform's Cloudinary.
 *
 *   node scripts/seed/seedKashipurFood.mjs [--dry]
 *
 * Idempotent: a restaurant (by name, in the zone) or dish (by name, in the restaurant) that already
 * exists is left alone, so the script can be re-run safely. Everything goes through the same admin
 * service functions the admin panel uses, so the data is shaped exactly like admin-created data.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import { RESTAURANTS, FOOD_CATEGORIES } from './data/foodData.mjs';
import { publish, manifestEntries } from './imageBank.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes('--dry');
const ZONE_NAME = 'Uttarakhand';

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
const { uploadImageBuffer } = await import('../../src/services/cloudinary.service.js');
const admin = await import('../../src/modules/food/admin/services/admin.service.js');
const { FoodRestaurant } = await import('../../src/modules/food/restaurant/models/restaurant.model.js');
const { FoodItem } = await import('../../src/modules/food/admin/models/food.model.js').catch(() => ({}));
const { FoodCategory } = await import('../../src/modules/food/admin/models/category.model.js').catch(() => ({}));
const { FoodZone } = await import('../../src/modules/food/admin/models/zone.model.js').catch(() => ({}));

const plan = JSON.parse(fs.readFileSync(path.join(HERE, '.cache', 'food-plan.json'), 'utf8'));

const zone = await (FoodZone || mongoose.connection.collection('food_zones')).findOne({ name: ZONE_NAME });
if (!zone) throw new Error(`Food zone "${ZONE_NAME}" not found`);

const photo = async (entry, folder) => (entry ? publish(entry, folder, uploadImageBuffer) : '');
const FoodCategoryModel = FoodCategory || mongoose.connection.collection('food_categories');

// ---- categories -------------------------------------------------------------------------------
// A pure-veg restaurant can only use Veg-scoped categories, every other restaurant uses "Both".
const categoryIds = new Map();
const escapeRe = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function ensureCategory(name, scope) {
  const key = `${scope}|${name}`;
  if (categoryIds.has(key)) return categoryIds.get(key);
  const existing = await FoodCategoryModel.findOne({
    name: new RegExp(`^${escapeRe(name)}$`, 'i'),
    zoneId: { $in: [null, undefined] },
    isActive: { $ne: false },
    foodTypeScope: scope,
  });
  if (existing) {
    categoryIds.set(key, existing._id);
    return existing._id;
  }
  if (DRY) {
    console.log('would create category', name, scope);
    return null;
  }
  const image = await photo(plan.categories[name], 'food/categories');
  const created = await admin.createCategory({ name, image, foodTypeScope: scope, isActive: true });
  categoryIds.set(key, created._id);
  console.log('category created:', name, `(${scope})`);
  return created._id;
}

// ---- restaurants + dishes --------------------------------------------------------------------
const slotTimings = (open, close) =>
  Object.fromEntries(
    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => [
      d,
      { isOpen: true, openingTime: open, closingTime: close },
    ]),
  );

const TIMINGS = {
  'Kashipur Breakfast Point': ['06:30', '14:00'],
  'Chai Sutta Cafe': ['07:00', '23:00'],
  'Cake Walk Bakery': ['09:00', '21:30'],
  'Sweet Treats Mithai Wala': ['08:00', '22:00'],
  'Frosty Scoops Ice Cream Parlour': ['11:00', '23:30'],
  'Biryani Junction': ['11:00', '23:30'],
  'Punjabi Dhaba Highway': ['10:00', '23:59'],
};

const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
const pan = (i, owner) => {
  const initial = owner.trim().split(/\s+/).pop()[0].toUpperCase();
  const a = letters[(i * 3) % letters.length];
  const b = letters[(i * 5 + 2) % letters.length];
  const c = letters[(i * 7 + 4) % letters.length];
  return `${a}${b}${c}P${initial}${String(2000 + i * 37).padStart(4, '0')}${letters[(i * 11) % letters.length]}`;
};

const phoneOf = (i) => `90000${String(1001 + i).padStart(5, '0')}`;

let restaurantIndex = 0;
for (const r of RESTAURANTS) {
  const i = restaurantIndex++;
  const [lat, lng] = r.geo;
  let restaurant = await FoodRestaurant.findOne({ restaurantName: r.name, zoneId: zone._id }).select('_id').lean();

  if (!restaurant) {
    if (DRY) {
      console.log('would create restaurant', r.name);
      continue;
    }
    const images = plan.restaurants[r.name] || {};
    const profileImage = await photo(images.profile, 'food/restaurants/profile');
    const menuImage = await photo(images.menu, 'food/restaurants/menu');
    const [open, close] = TIMINGS[r.name] || ['09:00', '22:30'];
    const gstRegistered = i % 3 === 0;
    const panNumber = pan(i, r.owner);
    const bankHolder = r.owner;

    const created = await admin.createRestaurantByAdmin({
      restaurantName: r.name,
      ownerName: r.owner,
      ownerEmail: `owner.${r.name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/\.+$/, '')}@kashipur-demo.in`,
      ownerPhone: phoneOf(i),
      primaryContactNumber: phoneOf(i),
      dietaryType: r.diet,
      cuisines: r.cuisines,
      zoneId: String(zone._id),
      location: {
        latitude: lat,
        longitude: lng,
        addressLine1: r.address,
        formattedAddress: `${r.address}, Kashipur, Uttarakhand 244713`,
        address: `${r.address}, Kashipur, Uttarakhand 244713`,
        area: r.area,
        city: 'Kashipur',
        state: 'Uttarakhand',
        pincode: '244713',
        landmark: r.address.split(',')[0],
      },
      outletTimings: slotTimings(open, close),
      estimatedDeliveryTime: r.eta,
      featuredDish: r.featured[0],
      featuredPrice: r.featured[1],
      offer: r.offer,
      profileImage,
      menuImages: menuImage ? [menuImage] : [],
      panNumber,
      nameOnPan: r.owner,
      gstRegistered,
      gstNumber: gstRegistered ? `05${panNumber}1Z${(i % 9) + 1}` : '',
      gstLegalName: gstRegistered ? r.name : '',
      gstAddress: gstRegistered ? `${r.address}, Kashipur, Uttarakhand 244713` : '',
      fssaiNumber: `1222400${String(100000 + i * 7919).slice(-7)}`,
      fssaiExpiry: '2028-03-31',
      accountNumber: `3${String(41000000000 + i * 1234567).slice(0, 11)}`,
      ifscCode: 'SBIN0000821',
      accountHolderName: bankHolder,
      accountType: 'current',
    });
    restaurant = { _id: created._id };

    // Same state an admin reaches by pressing "Approve" in the panel.
    await admin.approveRestaurant(String(created._id));

    // A new place that has been open a while: a believable rating from the menu mix.
    await FoodRestaurant.updateOne(
      { _id: created._id },
      { $set: { rating: Number((4.0 + ((i * 7) % 8) / 10).toFixed(1)), totalRatings: 60 + ((i * 53) % 420) } },
    );
    console.log(`restaurant ${i + 1}/20 created+approved: ${r.name}`);
  } else {
    console.log(`restaurant exists: ${r.name}`);
  }

  // dishes
  const images = plan.restaurants[r.name]?.items || {};
  for (const [name, category, type, price, description, , prep] of r.items) {
    const have = await FoodItem.findOne({ restaurantId: restaurant._id, name }).select('_id').lean();
    if (have) continue;
    if (DRY) {
      console.log('   would add', name);
      continue;
    }
    const image = await photo(images[name], 'foods');
    await admin.createFood({
      restaurantId: String(restaurant._id),
      name,
      categoryId: (await ensureCategory(category, r.diet === 'veg' ? 'Veg' : 'Both')) ? String(await ensureCategory(category, r.diet === 'veg' ? 'Veg' : 'Both')) : undefined,
      categoryName: category,
      description,
      price,
      foodType: type === 'V' ? 'Veg' : 'Non-Veg',
      image,
      preparationTime: `${prep} mins`,
      isAvailable: true,
    });
  }
  console.log(`   menu ready for ${r.name}`);
}

console.log('done. cached photos:', manifestEntries().length);
await mongoose.disconnect();
process.exit(0);
