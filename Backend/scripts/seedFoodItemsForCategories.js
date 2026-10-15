/**
 * Seed demo food items into the 7 categories created by seedFoodCategoriesAndCoupons.js
 * (Starters, Main Course, Desserts, South Indian, Chinese, Biryani, Salads):
 *   - Tanu's Restaurant gets 13 items (spans every one of the 7 categories)
 *   - every other approved restaurant gets 2-3 items (alternating), picked from distinct
 *     categories so the spread across categories stays varied restaurant to restaurant
 *
 * Writes directly to the FoodItem collection via the real Mongoose model (same shape
 * admin.service.js's createFood() produces: approvalStatus 'approved', foodType 'Veg' —
 * 10 of the 11 approved restaurants are pureVegRestaurant: true, so every item is kept
 * Veg to stay consistent with that constraint rather than mixing in Non-Veg for the one
 * restaurant that could technically take it).
 *
 * Does NOT call admin.service.js directly (same reasoning as the categories/coupons seed:
 * keep this script's side effects to exactly "write these documents", nothing else).
 *
 * Idempotent: an item is skipped (not duplicated) if a FoodItem with the same
 * (restaurantId, name) already exists, so the script is safe to re-run.
 *
 * USAGE
 *   node scripts/seedFoodItemsForCategories.js            # preview (no writes)
 *   node scripts/seedFoodItemsForCategories.js --commit    # actually write to DB
 *
 * ENV
 *   MONGO_URI / MONGODB_URI (Backend/.env)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { FoodRestaurant } from '../src/modules/food/restaurant/models/restaurant.model.js';
import { FoodCategory } from '../src/modules/food/admin/models/category.model.js';
import { FoodItem } from '../src/modules/food/admin/models/food.model.js';

dotenv.config();

const COMMIT = process.argv.includes('--commit');

const CATEGORY_NAMES = [
  'Starters',
  'Main Course',
  'Desserts',
  'South Indian',
  'Chinese',
  'Biryani',
  'Salads',
];

// 35 dishes, grouped by the 7 categories above (6+6+5+5+5+4+4).
const DISH_POOL = [
  { name: 'Paneer Tikka', category: 'Starters', price: 220, description: 'Marinated cottage cheese cubes grilled to smoky perfection.' },
  { name: 'Veg Spring Roll', category: 'Starters', price: 160, description: 'Crispy rolls stuffed with fresh vegetables.' },
  { name: 'Chilli Paneer', category: 'Starters', price: 210, description: 'Paneer tossed in a spicy Indo-Chinese chilli sauce.' },
  { name: 'Hara Bhara Kabab', category: 'Starters', price: 180, description: 'Spinach and green pea patties, shallow fried.' },
  { name: 'Crispy Corn', category: 'Starters', price: 170, description: 'Golden fried sweet corn tossed in spices.' },
  { name: 'Paneer 65', category: 'Starters', price: 230, description: 'Spicy deep-fried paneer bites, South Indian style.' },

  { name: 'Paneer Butter Masala', category: 'Main Course', price: 260, description: 'Paneer simmered in a rich buttery tomato gravy.' },
  { name: 'Dal Makhani', category: 'Main Course', price: 220, description: 'Slow-cooked black lentils finished with cream and butter.' },
  { name: 'Shahi Paneer', category: 'Main Course', price: 250, description: 'Paneer in a creamy cashew-based royal gravy.' },
  { name: 'Kadai Paneer', category: 'Main Course', price: 240, description: 'Paneer and peppers tossed in a bold kadai masala.' },
  { name: 'Malai Kofta', category: 'Main Course', price: 260, description: 'Soft vegetable dumplings in a mildly sweet creamy gravy.' },
  { name: 'Veg Kofta Curry', category: 'Main Course', price: 230, description: 'Mixed vegetable koftas in a spiced tomato gravy.' },

  { name: 'Gulab Jamun', category: 'Desserts', price: 90, description: 'Soft milk dumplings soaked in rose-scented sugar syrup.' },
  { name: 'Rasmalai', category: 'Desserts', price: 110, description: 'Cottage cheese discs in saffron-flavoured sweet milk.' },
  { name: 'Gajar Halwa', category: 'Desserts', price: 100, description: 'Classic carrot halwa slow-cooked with milk and ghee.' },
  { name: 'Kheer', category: 'Desserts', price: 80, description: 'Creamy rice pudding flavoured with cardamom.' },
  { name: 'Jalebi', category: 'Desserts', price: 70, description: 'Crispy spirals soaked in warm sugar syrup.' },

  { name: 'Masala Dosa', category: 'South Indian', price: 130, description: 'Crispy rice crepe filled with spiced potato masala.' },
  { name: 'Idli Sambar', category: 'South Indian', price: 100, description: 'Steamed rice cakes served with sambar and chutney.' },
  { name: 'Uttapam', category: 'South Indian', price: 140, description: 'Thick savoury pancake topped with onions and tomatoes.' },
  { name: 'Medu Vada', category: 'South Indian', price: 90, description: 'Crispy fried lentil doughnuts served with chutney.' },
  { name: 'Rava Dosa', category: 'South Indian', price: 150, description: 'Thin and crispy semolina crepe.' },

  { name: 'Veg Manchurian', category: 'Chinese', price: 190, description: 'Fried vegetable balls tossed in tangy Manchurian sauce.' },
  { name: 'Veg Fried Rice', category: 'Chinese', price: 180, description: 'Wok-tossed rice with fresh vegetables.' },
  { name: 'Hakka Noodles', category: 'Chinese', price: 190, description: 'Stir-fried noodles with crunchy vegetables.' },
  { name: 'Veg Chowmein', category: 'Chinese', price: 170, description: 'Classic street-style chowmein loaded with veggies.' },
  { name: 'Chilli Potato', category: 'Chinese', price: 160, description: 'Crispy fried potatoes tossed in spicy chilli sauce.' },

  { name: 'Veg Biryani', category: 'Biryani', price: 220, description: 'Fragrant basmati rice layered with spiced vegetables.' },
  { name: 'Paneer Biryani', category: 'Biryani', price: 260, description: 'Aromatic biryani loaded with marinated paneer.' },
  { name: 'Mushroom Biryani', category: 'Biryani', price: 250, description: 'Flavourful biryani with juicy mushrooms.' },
  { name: 'Soya Chaap Biryani', category: 'Biryani', price: 240, description: 'Biryani tossed with spiced soya chaap pieces.' },

  { name: 'Green Garden Salad', category: 'Salads', price: 120, description: 'Fresh seasonal greens with a light dressing.' },
  { name: 'Sprouts Salad', category: 'Salads', price: 100, description: 'Protein-rich sprouts tossed with lemon and spices.' },
  { name: 'Kachumber Salad', category: 'Salads', price: 90, description: 'Classic Indian cucumber, tomato and onion salad.' },
  { name: 'Fruit Salad', category: 'Salads', price: 110, description: 'Seasonal fresh fruits tossed with a hint of chaat masala.' },
];

const DISHES_BY_CATEGORY = {};
for (const dish of DISH_POOL) {
  (DISHES_BY_CATEGORY[dish.category] ||= []).push(dish);
}

/** Tanu's Restaurant (13 items): spread as evenly as possible across all 7 categories. */
function pickBalanced(count) {
  const picks = [];
  const per = Math.floor(count / CATEGORY_NAMES.length);
  let remainder = count % CATEGORY_NAMES.length;
  for (const cat of CATEGORY_NAMES) {
    const take = per + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
    const dishes = DISHES_BY_CATEGORY[cat] || [];
    for (let i = 0; i < take && i < dishes.length; i++) picks.push(dishes[i]);
  }
  return picks.slice(0, count);
}

/**
 * Every other restaurant (2-3 items): one dish from `count` DISTINCT categories, the
 * starting category and the dish chosen within it both rotated by restaurant position so
 * two restaurants rarely end up with an identical little menu.
 */
function pickForRestaurant(count, position) {
  const offset = position % CATEGORY_NAMES.length;
  const rotatedCategories = [
    ...CATEGORY_NAMES.slice(offset),
    ...CATEGORY_NAMES.slice(0, offset),
  ].slice(0, count);

  return rotatedCategories.map((cat) => {
    const dishes = DISHES_BY_CATEGORY[cat];
    return dishes[position % dishes.length];
  });
}

async function seedItemsForRestaurant(restaurant, dishes, categoryIdByName) {
  const label = restaurant.restaurantName || restaurant.name || String(restaurant._id);
  const created = [];
  const skipped = [];

  for (const dish of dishes) {
    const existing = await FoodItem.findOne({
      restaurantId: restaurant._id,
      name: dish.name,
    }).lean();
    if (existing) {
      skipped.push(dish.name);
      continue;
    }

    if (COMMIT) {
      await FoodItem.create({
        restaurantId: restaurant._id,
        categoryId: categoryIdByName.get(dish.category),
        categoryName: dish.category,
        name: dish.name,
        description: dish.description,
        price: dish.price,
        variants: [],
        image: '',
        foodType: 'Veg',
        isAvailable: true,
        preparationTime: '15-20 mins',
        approvalStatus: 'approved',
      });
    }
    created.push(dish.name);
  }

  return { label, created, skipped };
}

async function run() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI or MONGODB_URI is required in Backend/.env');
  }

  console.log(COMMIT ? '=== WRITING to DB ===' : '=== DRY RUN (pass --commit to write) ===');
  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);

  const categoryDocs = await FoodCategory.find({
    name: { $in: CATEGORY_NAMES },
    restaurantId: { $exists: false },
  })
    .select('name')
    .lean();
  const categoryIdByName = new Map(categoryDocs.map((c) => [c.name, c._id]));

  const missing = CATEGORY_NAMES.filter((n) => !categoryIdByName.has(n));
  if (missing.length) {
    throw new Error(
      `Missing global categories: ${missing.join(', ')}. Run scripts/seedFoodCategoriesAndCoupons.js --commit first.`,
    );
  }

  const restaurants = await FoodRestaurant.find({ status: 'approved', isActive: true })
    .select('restaurantName name')
    .sort({ createdAt: 1 })
    .lean();

  const tanusIndex = restaurants.findIndex((r) =>
    /tanu/i.test(r.restaurantName || r.name || ''),
  );
  if (tanusIndex === -1) {
    throw new Error("Could not find Tanu's Restaurant among approved restaurants.");
  }

  let totalCreated = 0;
  let totalSkipped = 0;
  let otherPosition = 0; // only increments for non-Tanu's restaurants, keeps 3/2 alternation clean

  for (let i = 0; i < restaurants.length; i++) {
    const restaurant = restaurants[i];
    const isTanus = i === tanusIndex;
    const dishes = isTanus
      ? pickBalanced(13)
      : pickForRestaurant(otherPosition % 2 === 0 ? 3 : 2, otherPosition);
    if (!isTanus) otherPosition++;

    const result = await seedItemsForRestaurant(restaurant, dishes, categoryIdByName);
    console.log(`\n${result.label}${isTanus ? ' (Tanu\'s - full menu)' : ''}`);
    console.log(`  +${result.created.length} [${result.created.join(', ')}]` +
      (result.skipped.length ? `  (skipped, already exist: ${result.skipped.join(', ')})` : ''));
    totalCreated += result.created.length;
    totalSkipped += result.skipped.length;
  }

  console.log('\n--- Summary ---');
  console.log(`Food items: ${totalCreated} created, ${totalSkipped} skipped`);
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
