/**
 * Backfill `image` for the 7 global categories and 35 dishes seeded by
 * seedFoodCategoriesAndCoupons.js / seedFoodItemsForCategories.js (none of them had an
 * image set - this script fills that in, nothing else).
 *
 * Images are Unsplash CDN URLs in the exact format the app's own frontend fallback already
 * uses (Frontend/src/modules/Food/constants/images.js: `images.unsplash.com/photo-<id>
 * ?w=400&h=300&fit=crop`) - same convention, so nothing downstream has to special-case these.
 * Every URL below was verified with a live HTTP HEAD-equivalent request (curl, 200 OK) before
 * being written here.
 *
 * Idempotent and narrowly scoped: only touches a document whose `image` is currently empty,
 * matched by exact name (+ global scope for categories). Never overwrites an image an admin
 * (or a future run) may have set since. Safe to re-run.
 *
 * USAGE
 *   node scripts/backfillFoodCategoryAndItemImages.js            # preview (no writes)
 *   node scripts/backfillFoodCategoryAndItemImages.js --commit    # actually write to DB
 *
 * ENV
 *   MONGO_URI / MONGODB_URI (Backend/.env)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { FoodCategory } from '../src/modules/food/admin/models/category.model.js';
import { FoodItem } from '../src/modules/food/admin/models/food.model.js';

dotenv.config();

const COMMIT = process.argv.includes('--commit');

const unsplash = (id) => `https://images.unsplash.com/photo-${id}?w=400&h=300&fit=crop`;

const CATEGORY_IMAGES = {
  'Starters': unsplash('1666001120694-3ebe8fd207be'),
  'Main Course': unsplash('1603894584373-5ac82b2ae398'),
  'Desserts': unsplash('1666190092159-3171cf0fbb12'),
  'South Indian': unsplash('1668236543090-82eba5ee5976'),
  'Chinese': unsplash('1585032226651-759b368d7246'),
  'Biryani': unsplash('1697155406055-2db32d47ca07'),
  'Salads': unsplash('1559317996-d154e05c76fb'),
};

const DISH_IMAGES = {
  // Starters
  'Paneer Tikka': unsplash('1666001120694-3ebe8fd207be'),
  'Veg Spring Roll': unsplash('1631452180519-c014fe946bc7'),
  'Chilli Paneer': unsplash('1567188040759-fb8a883dc6d8'),
  'Hara Bhara Kabab': unsplash('1631452180539-96aca7d48617'),
  'Crispy Corn': unsplash('1690401767645-595de0e0e5f8'),
  'Paneer 65': unsplash('1690403160225-3db8cc8babd5'),
  // Main Course
  'Paneer Butter Masala': unsplash('1603894584373-5ac82b2ae398'),
  'Dal Makhani': unsplash('1606471191009-63994c53433b'),
  'Shahi Paneer': unsplash('1596797038530-2c107229654b'),
  'Kadai Paneer': unsplash('1742599361539-f096753d1100'),
  'Malai Kofta': unsplash('1708793873401-e8c6c153b76a'),
  'Veg Kofta Curry': unsplash('1708782341807-ed35fc16b4ea'),
  // Desserts
  'Gulab Jamun': unsplash('1666190092159-3171cf0fbb12'),
  'Rasmalai': unsplash('1593701461250-d7b22dfd3a77'),
  'Gajar Halwa': unsplash('1646578515903-67873a5398f9'),
  'Kheer': unsplash('1616429266392-63ba6f1570a1'),
  'Jalebi': unsplash('1617013451942-441bbba35a5e'),
  // South Indian
  'Masala Dosa': unsplash('1668236543090-82eba5ee5976'),
  'Idli Sambar': unsplash('1694849789325-914b71ab4075'),
  'Uttapam': unsplash('1708146464361-5c5ce4f9abb6'),
  'Medu Vada': unsplash('1743517894265-c86ab035adef'),
  'Rava Dosa': unsplash('1751560455942-f859f1215826'),
  // Chinese
  'Veg Manchurian': unsplash('1585032226651-759b368d7246'),
  'Veg Fried Rice': unsplash('1607328874071-45a9cd600644'),
  'Hakka Noodles': unsplash('1553621043-f607bfbf6640'),
  'Veg Chowmein': unsplash('1634864572865-1cf8ff8bd23d'),
  'Chilli Potato': unsplash('1716535232835-6d56282dfe8a'),
  // Biryani
  'Veg Biryani': unsplash('1697155406055-2db32d47ca07'),
  'Paneer Biryani': unsplash('1563379091339-03b21ab4a4f8'),
  'Mushroom Biryani': unsplash('1630409346824-4f0e7b080087'),
  'Soya Chaap Biryani': unsplash('1691171047462-66025ecd5efc'),
  // Salads
  'Green Garden Salad': unsplash('1559317996-d154e05c76fb'),
  'Sprouts Salad': unsplash('1708184528305-33ce7daced65'),
  'Kachumber Salad': unsplash('1646487793655-bbf280273d2f'),
  'Fruit Salad': unsplash('1651217611748-7e0d467eec9b'),
};

async function backfillCategories() {
  const updated = [];
  const skipped = [];

  for (const [name, image] of Object.entries(CATEGORY_IMAGES)) {
    const doc = await FoodCategory.findOne({ name, restaurantId: { $exists: false } })
      .select('image')
      .lean();
    if (!doc) {
      skipped.push(`${name} (not found)`);
      continue;
    }
    if (doc.image) {
      skipped.push(`${name} (already has an image)`);
      continue;
    }
    if (COMMIT) {
      await FoodCategory.updateOne({ _id: doc._id }, { $set: { image } });
    }
    updated.push(name);
  }

  return { updated, skipped };
}

async function backfillItems() {
  const updated = [];
  const skipped = [];

  for (const [name, image] of Object.entries(DISH_IMAGES)) {
    const items = await FoodItem.find({ name, image: { $in: ['', null] } })
      .select('_id restaurantId')
      .lean();
    if (!items.length) {
      skipped.push(`${name} (no items with an empty image)`);
      continue;
    }
    if (COMMIT) {
      await FoodItem.updateMany(
        { _id: { $in: items.map((i) => i._id) } },
        { $set: { image } },
      );
    }
    updated.push(`${name} (${items.length})`);
  }

  return { updated, skipped };
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
  const catResult = await backfillCategories();
  catResult.updated.forEach((n) => console.log(`  + ${n}`));
  catResult.skipped.forEach((n) => console.log(`  = ${n}`));
  console.log(`Categories: ${catResult.updated.length} updated, ${catResult.skipped.length} skipped`);

  console.log('\n--- Food items ---');
  const itemResult = await backfillItems();
  itemResult.updated.forEach((n) => console.log(`  + ${n}`));
  itemResult.skipped.forEach((n) => console.log(`  = ${n}`));
  console.log(`Items: ${itemResult.updated.length} dish names updated, ${itemResult.skipped.length} skipped`);

  if (!COMMIT) {
    console.log('\nThis was a DRY RUN - nothing was written. Re-run with --commit to persist.');
  }

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Backfill failed:', err.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect errors
  }
  process.exit(1);
});
