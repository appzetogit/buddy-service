/**
 * Seed demo food categories + coupons:
 *   - 7 global food categories (admin-created, auto-approved)
 *   - 3-4 admin-created coupons PER approved restaurant (auto-approved, active)
 *   - 2-3 restaurant-created coupons PER approved restaurant (pending admin approval)
 *
 * Writes directly to the FoodCategory / FoodOffer collections using the real Mongoose
 * models (correct schema, defaults, the unique index on couponCode). Deliberately does
 * NOT call admin.service.js / restaurant.service.js — createAdminOffer() there fires a
 * real push notification ("New Campaign Invitation") to the restaurant on every
 * restaurant-scoped coupon, which would spam real devices 30-40+ times for a seed run.
 * This script reproduces the exact same document shape those functions write, minus
 * that side effect.
 *
 * Idempotent: every category/coupon is skipped (not duplicated) if it already exists,
 * so the script is safe to re-run.
 *
 * USAGE
 *   node scripts/seedFoodCategoriesAndCoupons.js            # preview (no writes)
 *   node scripts/seedFoodCategoriesAndCoupons.js --commit    # actually write to DB
 *
 * ENV
 *   MONGO_URI / MONGODB_URI (Backend/.env)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { FoodRestaurant } from '../src/modules/food/restaurant/models/restaurant.model.js';
import { FoodCategory } from '../src/modules/food/admin/models/category.model.js';
import { FoodOffer } from '../src/modules/food/admin/models/offer.model.js';

dotenv.config();

const COMMIT = process.argv.includes('--commit');

// --- 1. Global categories (admin-created, auto-approved) -----------------------------
const NEW_CATEGORIES = [
  'Starters',
  'Main Course',
  'Desserts',
  'South Indian',
  'Chinese',
  'Biryani',
  'Salads',
];

// --- 2. Coupon code helper -------------------------------------------------------------
/** Deterministic, human-readable, collision-resistant slug from a restaurant name + index. */
function restaurantSlug(restaurant, index) {
  const alnum = String(restaurant.restaurantName || restaurant.name || 'REST')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const base = (alnum || 'REST').slice(0, 4).padEnd(4, 'X');
  const idx = String(index + 1).padStart(2, '0');
  return `${idx}${base}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const now = () => new Date();
const daysFromNow = (n) => new Date(Date.now() + n * DAY_MS);

/** Admin-created coupon templates (auto-approved, active). Up to 4 per restaurant. */
function buildAdminCouponTemplates(slug, restaurantId) {
  return [
    {
      couponCode: `WELCOME${slug}`,
      discountType: 'percentage',
      discountValue: 10,
      customerScope: 'first-time',
      isFirstOrderOnly: true,
      minOrderValue: 149,
      maxDiscount: 60,
      usageLimit: null,
      perUserLimit: 1,
      name: 'Welcome Offer',
      description: 'Flat 10% off on your first order from this restaurant.',
    },
    {
      couponCode: `SAVE${slug}20`,
      discountType: 'percentage',
      discountValue: 20,
      customerScope: 'all',
      minOrderValue: 299,
      maxDiscount: 100,
      usageLimit: 500,
      perUserLimit: 2,
      name: '20% Off',
      description: 'Save 20% on orders above ₹299.',
    },
    {
      couponCode: `FLAT${slug}50`,
      discountType: 'flat-price',
      discountValue: 50,
      customerScope: 'all',
      minOrderValue: 249,
      maxDiscount: null,
      usageLimit: 1000,
      perUserLimit: 3,
      name: 'Flat ₹50 Off',
      description: 'Flat ₹50 off on orders above ₹249.',
    },
    {
      couponCode: `MEGA${slug}30`,
      discountType: 'percentage',
      discountValue: 30,
      customerScope: 'all',
      minOrderValue: 499,
      maxDiscount: 150,
      usageLimit: 200,
      perUserLimit: 1,
      name: 'Mega Saver',
      description: 'Save 30% on big orders above ₹499.',
    },
  ].map((t) => ({
    ...t,
    restaurantScope: 'selected',
    restaurantId,
    startDate: now(),
    endDate: daysFromNow(90),
    status: 'active',
    pausedBy: null,
    approvalStatus: 'approved',
    showInCart: true,
    createdBy: 'admin',
    createdById: undefined,
    couponCategory: 'normal',
    isGlobal: false,
  }));
}

/** Restaurant-created coupon templates (pending admin approval). Up to 3 per restaurant. */
function buildRestaurantCouponTemplates(slug, restaurantId) {
  return [
    {
      couponCode: `RES${slug}10`,
      discountType: 'percentage',
      discountValue: 10,
      customerScope: 'all',
      minOrderValue: 199,
      maxDiscount: 50,
      usageLimit: 100,
      perUserLimit: 1,
    },
    {
      couponCode: `RES${slug}30`,
      discountType: 'flat-price',
      discountValue: 30,
      customerScope: 'all',
      minOrderValue: 149,
      maxDiscount: null,
      usageLimit: 150,
      perUserLimit: 2,
    },
    {
      couponCode: `RES${slug}15`,
      discountType: 'percentage',
      discountValue: 15,
      customerScope: 'first-time',
      isFirstOrderOnly: true,
      minOrderValue: 99,
      maxDiscount: 40,
      usageLimit: null,
      perUserLimit: 1,
    },
  ].map((t) => ({
    ...t,
    restaurantScope: 'selected',
    restaurantId,
    startDate: now(),
    endDate: daysFromNow(60),
    status: 'paused', // mirrors createRestaurantOffer(): stays paused until admin approves
    pausedBy: null,
    approvalStatus: 'pending',
    showInCart: true,
    createdBy: 'restaurant',
    createdById: restaurantId,
    couponCategory: 'normal',
    isGlobal: false,
  }));
}

async function seedCategories() {
  const created = [];
  const skipped = [];
  let sortOrder = 100; // stay clear of existing categories' sortOrder values

  for (const name of NEW_CATEGORIES) {
    const existing = await FoodCategory.findOne({
      name,
      restaurantId: { $exists: false },
    }).lean();

    if (existing) {
      skipped.push(name);
      continue;
    }

    sortOrder += 10;
    if (COMMIT) {
      await FoodCategory.create({
        name,
        image: '',
        type: '',
        foodTypeScope: 'Both',
        zoneId: undefined,
        isActive: true,
        sortOrder,
        approvalStatus: 'approved',
        isApproved: true,
        approvedAt: now(),
        rejectionReason: '',
        restaurantId: undefined,
        createdByRestaurantId: undefined,
      });
    }
    created.push(name);
  }

  return { created, skipped };
}

async function seedCouponsForRestaurant(restaurant, index) {
  const slug = restaurantSlug(restaurant, index);
  const label = restaurant.restaurantName || restaurant.name || String(restaurant._id);

  // Alternate 4-vs-3 admin coupons and 3-vs-2 restaurant coupons so every restaurant
  // lands inside the requested "3-4" / "2-3" range without every restaurant being identical.
  const adminCount = index % 2 === 0 ? 4 : 3;
  const restaurantCount = index % 2 === 0 ? 3 : 2;

  const adminTemplates = buildAdminCouponTemplates(slug, restaurant._id).slice(0, adminCount);
  const restaurantTemplates = buildRestaurantCouponTemplates(slug, restaurant._id).slice(0, restaurantCount);

  const result = { label, adminCreated: [], adminSkipped: [], restCreated: [], restSkipped: [] };

  for (const doc of adminTemplates) {
    const existing = await FoodOffer.findOne({ couponCode: doc.couponCode }).lean();
    if (existing) {
      result.adminSkipped.push(doc.couponCode);
      continue;
    }
    if (COMMIT) await FoodOffer.create(doc);
    result.adminCreated.push(doc.couponCode);
  }

  for (const doc of restaurantTemplates) {
    const existing = await FoodOffer.findOne({ couponCode: doc.couponCode }).lean();
    if (existing) {
      result.restSkipped.push(doc.couponCode);
      continue;
    }
    if (COMMIT) await FoodOffer.create(doc);
    result.restCreated.push(doc.couponCode);
  }

  return result;
}

async function run() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI or MONGODB_URI is required in Backend/.env');
  }

  console.log(COMMIT ? '=== WRITING to DB ===' : '=== DRY RUN (pass --commit to write) ===');
  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);

  console.log('\n--- Categories ---');
  const catResult = await seedCategories();
  catResult.created.forEach((n) => console.log(`  + ${n}`));
  catResult.skipped.forEach((n) => console.log(`  = ${n} (already exists, skipped)`));
  console.log(`Categories: ${catResult.created.length} created, ${catResult.skipped.length} skipped`);

  const restaurants = await FoodRestaurant.find({ status: 'approved', isActive: true })
    .select('restaurantName name')
    .sort({ createdAt: 1 })
    .lean();

  console.log(`\n--- Coupons for ${restaurants.length} approved restaurants ---`);
  let totalAdminCreated = 0;
  let totalAdminSkipped = 0;
  let totalRestCreated = 0;
  let totalRestSkipped = 0;

  for (let i = 0; i < restaurants.length; i++) {
    const r = await seedCouponsForRestaurant(restaurants[i], i);
    console.log(`\n${r.label}`);
    console.log(`  admin coupons   : +${r.adminCreated.length} [${r.adminCreated.join(', ')}]` +
      (r.adminSkipped.length ? `  (skipped: ${r.adminSkipped.join(', ')})` : ''));
    console.log(`  pending coupons : +${r.restCreated.length} [${r.restCreated.join(', ')}]` +
      (r.restSkipped.length ? `  (skipped: ${r.restSkipped.join(', ')})` : ''));
    totalAdminCreated += r.adminCreated.length;
    totalAdminSkipped += r.adminSkipped.length;
    totalRestCreated += r.restCreated.length;
    totalRestSkipped += r.restSkipped.length;
  }

  console.log('\n--- Summary ---');
  console.log(`Categories        : ${catResult.created.length} created, ${catResult.skipped.length} skipped`);
  console.log(`Admin coupons     : ${totalAdminCreated} created, ${totalAdminSkipped} skipped`);
  console.log(`Pending coupons   : ${totalRestCreated} created, ${totalRestSkipped} skipped`);
  if (!COMMIT) {
    console.log('\nThis was a DRY RUN - nothing was written. Re-run with --commit to persist.');
  }

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Seed failed:', err.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect errors
  }
  process.exit(1);
});
