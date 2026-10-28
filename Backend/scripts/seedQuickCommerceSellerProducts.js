/**
 * Seed demo products into the category tree created by seedQuickCommerceCategories.js
 * (Personal Care & Beauty / Cleaning & Household / Snacks & Beverages), 10-12 products per
 * approved + active ("present") seller.
 *
 * Writes directly to the QuickProduct model. SellerProduct (used by the live seller add-product
 * flow) and QuickProduct point at the exact same MongoDB collection - see the `collection:
 * 'quick_products'` override in sellerProduct.model.js - so this is the same data a seller's own
 * product list and the customer catalog both already read, not a side channel.
 *
 * Each product's headerId/categoryId/subcategoryId is resolved from the real category docs
 * (by name), mirroring what resolveSellerCategoryIds() in sellerCatalog.service.js enforces:
 * categoryId must be a 'category'-type node, subcategoryId (when set) must be a 'subcategory'
 * whose parent is that categoryId. Every image URL was verified live (curl, 200 OK) before
 * being written here, same convention as the Food item/category image seeds.
 *
 * Products are marked approvalStatus: 'approved' only when their seller is itself approved
 * (matching createSellerProductController's own rule: `sellerApproved ? 'approved' :
 * 'pending'`), status: 'active', isActive: true - so they clear publicProductVisibilityFilter
 * and actually show up in the customer catalog (subject to the seller's own zone, which this
 * script does not touch - see the summary printed at the end for any seller missing one).
 *
 * Idempotent: a product already present for that seller (matched by sellerId + name) is
 * skipped, not duplicated. Safe to re-run.
 *
 * USAGE
 *   node scripts/seedQuickCommerceSellerProducts.js            # preview (no writes)
 *   node scripts/seedQuickCommerceSellerProducts.js --commit    # actually write to DB
 *
 * ENV
 *   MONGO_URI / MONGODB_URI (Backend/.env)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { QuickCategory } from '../src/modules/quick-commerce/models/category.model.js';
import { QuickProduct } from '../src/modules/quick-commerce/models/product.model.js';
import { Seller } from '../src/modules/quick-commerce/seller/models/seller.model.js';

dotenv.config();

const COMMIT = process.argv.includes('--commit');

const unsplash = (id) => `https://images.unsplash.com/photo-${id}?w=400&h=300&fit=crop`;

/**
 * 41 products across the 6 categories seeded by seedQuickCommerceCategories.js. `category` /
 * `subcategory` are resolved to real ObjectIds at runtime by name - never hardcoded, so this
 * script works whether or not the category seed happened to change an id.
 */
const PRODUCT_POOL = [
  // --- Skin Care (category: Skin Care, header: Personal Care & Beauty) ---
  { name: 'Gentle Face Wash', category: 'Skin Care', subcategory: 'Face Wash & Cleansers', price: 199, mrp: 249, unit: '100 ml', image: unsplash('1580870069867-74c57ee1bb07') },
  { name: 'Charcoal Face Cleanser', category: 'Skin Care', subcategory: 'Face Wash & Cleansers', price: 229, mrp: 279, unit: '100 ml', image: unsplash('1585945037805-5fd82c2e60b1') },
  { name: 'Daily Moisturizer Cream', category: 'Skin Care', price: 279, mrp: 349, unit: '50 g', image: unsplash('1608571423902-eed4a5ad8108') },
  { name: 'Sunscreen Lotion SPF50', category: 'Skin Care', price: 349, mrp: 429, unit: '50 ml', image: unsplash('1619451427882-6aaaded0cc61') },
  { name: 'Body Lotion', category: 'Skin Care', price: 259, mrp: 319, unit: '200 ml', image: unsplash('1620916297397-a4a5402a3c6c') },
  { name: 'Lip Balm', category: 'Skin Care', price: 99, mrp: 129, unit: '5 g', image: unsplash('1552046122-03184de85e08') },
  { name: 'Face Serum', category: 'Skin Care', price: 399, mrp: 499, unit: '30 ml', image: unsplash('1608068811588-3a67006b7489') },
  { name: 'Aloe Vera Gel', category: 'Skin Care', price: 179, mrp: 229, unit: '150 ml', image: unsplash('1620916566398-39f1143ab7be') },

  // --- Hair Styling & Grooming (category, header: Personal Care & Beauty) ---
  { name: 'Hair Styling Gel', category: 'Hair Styling & Grooming', price: 189, mrp: 239, unit: '100 ml', image: unsplash('1701976857871-a46363644519') },
  { name: 'Hair Wax', category: 'Hair Styling & Grooming', price: 219, mrp: 269, unit: '75 g', image: unsplash('1624939461078-66a124b3539c') },
  { name: 'Hair Serum', category: 'Hair Styling & Grooming', price: 299, mrp: 379, unit: '50 ml', image: unsplash('1647140656295-61486627df99') },
  { name: 'Beard Oil', category: 'Hair Styling & Grooming', price: 249, mrp: 299, unit: '30 ml', image: unsplash('1610595426075-eed5a3f521ee') },
  { name: 'Hair Comb Set', category: 'Hair Styling & Grooming', price: 129, mrp: 159, unit: '1 set', image: unsplash('1701977082153-4ac2c0e9899d') },
  { name: 'Anti-Dandruff Hair Oil', category: 'Hair Styling & Grooming', price: 209, mrp: 259, unit: '200 ml', image: unsplash('1647140655311-b36dc374a95a') },

  // --- Laundry Care (category, header: Cleaning & Household) ---
  { name: 'Liquid Detergent 1L', category: 'Laundry Care', subcategory: 'Detergents & Fabric Care', price: 219, mrp: 269, unit: '1 L', image: unsplash('1626806819282-2c1dc01a5e0c') },
  { name: 'Detergent Powder 1kg', category: 'Laundry Care', subcategory: 'Detergents & Fabric Care', price: 169, mrp: 209, unit: '1 kg', image: unsplash('1582735689369-4fe89db7114c') },
  { name: 'Fabric Softener', category: 'Laundry Care', subcategory: 'Detergents & Fabric Care', price: 199, mrp: 249, unit: '860 ml', image: unsplash('1610557892470-55d9e80c0bce') },
  { name: 'Stain Remover Spray', category: 'Laundry Care', subcategory: 'Detergents & Fabric Care', price: 159, mrp: 199, unit: '250 ml', image: unsplash('1624372635310-01d078c05dd9') },
  { name: 'Washing Soap Bar (Pack of 4)', category: 'Laundry Care', subcategory: 'Detergents & Fabric Care', price: 89, mrp: 109, unit: '4 bars', image: unsplash('1635369306367-9d891c6c1a7c') },
  { name: 'Color Protect Detergent', category: 'Laundry Care', subcategory: 'Detergents & Fabric Care', price: 249, mrp: 299, unit: '1 kg', image: unsplash('1624372635277-283042097f31') },

  // --- Home Cleaning Essentials (category, header: Cleaning & Household) ---
  { name: 'Floor Cleaner 1L', category: 'Home Cleaning Essentials', price: 149, mrp: 189, unit: '1 L', image: unsplash('1550963295-019d8a8a61c5') },
  { name: 'Glass Cleaner Spray', category: 'Home Cleaning Essentials', price: 119, mrp: 149, unit: '500 ml', image: unsplash('1691057185806-ea8b5b9a4506') },
  { name: 'Toilet Cleaner', category: 'Home Cleaning Essentials', price: 99, mrp: 129, unit: '500 ml', image: unsplash('1584792286782-a5dc95dc2250') },
  { name: 'Dishwash Liquid', category: 'Home Cleaning Essentials', price: 139, mrp: 169, unit: '500 ml', image: unsplash('1649073005971-37babef31983') },
  { name: 'Multi-Surface Cleaner', category: 'Home Cleaning Essentials', price: 159, mrp: 199, unit: '500 ml', image: unsplash('1650964336599-a6b32f916378') },

  // --- Packaged Snacks (category, header: Snacks & Beverages) ---
  { name: 'Classic Potato Chips', category: 'Packaged Snacks', subcategory: 'Chips & Namkeen', price: 49, mrp: 60, unit: '75 g', image: unsplash('1599490659213-e2b9527bd087') },
  { name: 'Masala Namkeen Mix', category: 'Packaged Snacks', subcategory: 'Chips & Namkeen', price: 59, mrp: 70, unit: '200 g', image: unsplash('1613919113640-25732ec5e61f') },
  { name: 'Roasted Peanuts Masala', category: 'Packaged Snacks', subcategory: 'Chips & Namkeen', price: 45, mrp: 55, unit: '150 g', image: unsplash('1699666397768-0126340e880a') },
  { name: 'Butter Popcorn', category: 'Packaged Snacks', price: 69, mrp: 85, unit: '90 g', image: unsplash('1617102738820-bee2545405fd') },
  { name: 'Banana Chips', category: 'Packaged Snacks', subcategory: 'Chips & Namkeen', price: 55, mrp: 65, unit: '150 g', image: unsplash('1641693148759-843d17ceac24') },
  { name: 'Trail Mix Dry Fruits', category: 'Packaged Snacks', price: 149, mrp: 179, unit: '200 g', image: unsplash('1599493356626-9fdbdabfd9bd') },
  { name: 'Cream Biscuits Pack', category: 'Packaged Snacks', price: 39, mrp: 49, unit: '150 g', image: unsplash('1599490659101-963323d1da50') },
  { name: 'Cheese Crackers', category: 'Packaged Snacks', price: 65, mrp: 79, unit: '100 g', image: unsplash('1604565011092-c0fa4416f80f') },

  // --- Soft Drinks & Juices (category, header: Snacks & Beverages) ---
  { name: 'Cola Soft Drink 750ml', category: 'Soft Drinks & Juices', price: 45, mrp: 55, unit: '750 ml', image: unsplash('1640213505284-21352ee0d76b') },
  { name: 'Orange Juice 1L', category: 'Soft Drinks & Juices', price: 129, mrp: 159, unit: '1 L', image: unsplash('1650547001322-145ff2c0bed7') },
  { name: 'Mixed Fruit Juice', category: 'Soft Drinks & Juices', price: 119, mrp: 149, unit: '1 L', image: unsplash('1650547002496-e7ed9df4bf3c') },
  { name: 'Mango Juice 1L', category: 'Soft Drinks & Juices', price: 125, mrp: 155, unit: '1 L', image: unsplash('1650547001420-5e82dfb46e5d') },
  { name: 'Lemon Soda', category: 'Soft Drinks & Juices', price: 40, mrp: 50, unit: '600 ml', image: unsplash('1650547002676-7cd5dea3175e') },
  { name: 'Energy Drink', category: 'Soft Drinks & Juices', price: 99, mrp: 119, unit: '250 ml', image: unsplash('1620205252136-0944971c1ca2') },
  { name: 'Apple Juice 1L', category: 'Soft Drinks & Juices', price: 135, mrp: 165, unit: '1 L', image: unsplash('1698413463659-d9f5b38e1283') },
  { name: 'Grape Juice 1L', category: 'Soft Drinks & Juices', price: 129, mrp: 159, unit: '1 L', image: unsplash('1698413463861-5558d87d6c66') },
];

/** Per-seller product count alternates 12 / 11 / 10, cycling - every seller lands in "10-12". */
const COUNT_CYCLE = [12, 11, 10];

/**
 * Pick `count` DISTINCT products for a seller, rotated by the seller's position so two sellers
 * rarely end up with an identical little catalog, while every seller's picks stay spread across
 * all 6 categories rather than clumping in one.
 */
function pickForSeller(count, position) {
  const offset = (position * 7) % PRODUCT_POOL.length; // 7 is coprime with 41, spreads picks out
  const picks = [];
  for (let i = 0; i < count; i++) {
    picks.push(PRODUCT_POOL[(offset + i) % PRODUCT_POOL.length]);
  }
  return picks;
}

const skuFor = (sellerIndex, productIndexInPool) =>
  `QC-S${String(sellerIndex + 1).padStart(2, '0')}-P${String(productIndexInPool + 1).padStart(3, '0')}`;

async function resolveCategoryIds() {
  const names = new Set();
  for (const p of PRODUCT_POOL) {
    names.add(p.category);
    if (p.subcategory) names.add(p.subcategory);
  }
  const docs = await QuickCategory.find({ name: { $in: [...names] } })
    .select('name type parentId')
    .lean();
  const byName = new Map(docs.map((d) => [d.name, d]));

  const missing = [...names].filter((n) => !byName.has(n));
  if (missing.length) {
    throw new Error(
      `Missing categories: ${missing.join(', ')}. Run scripts/seedQuickCommerceCategories.js --commit first.`,
    );
  }

  // header id for a category = its own parentId (categories are direct header children here).
  const headerIdByCategoryName = new Map();
  for (const name of names) {
    const doc = byName.get(name);
    if (doc.type === 'category') headerIdByCategoryName.set(name, doc.parentId);
  }

  return { byName, headerIdByCategoryName };
}

async function seedProductsForSeller(seller, position, byName, headerIdByCategoryName) {
  const label = seller.shopName || seller.name || String(seller._id);
  const count = COUNT_CYCLE[position % COUNT_CYCLE.length];
  const picks = pickForSeller(count, position);
  const sellerApproved = seller.approvalStatus === 'approved';

  const created = [];
  const skipped = [];

  for (let i = 0; i < picks.length; i++) {
    const p = picks[i];
    const poolIndex = PRODUCT_POOL.indexOf(p);

    const existing = await QuickProduct.findOne({ sellerId: seller._id, name: p.name })
      .select('_id')
      .lean();
    if (existing) {
      skipped.push(p.name);
      continue;
    }

    const categoryDoc = byName.get(p.category);
    const subcategoryDoc = p.subcategory ? byName.get(p.subcategory) : null;
    const headerId = headerIdByCategoryName.get(p.category);

    if (COMMIT) {
      const slug = `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-s${position + 1}`;
      await QuickProduct.create({
        name: p.name,
        slug,
        image: p.image,
        mainImage: p.image,
        galleryImages: [p.image],
        categoryId: categoryDoc._id,
        subcategoryId: subcategoryDoc ? subcategoryDoc._id : null,
        headerId: headerId || null,
        description: `${p.name} - ${p.unit}. Fast delivery from ${label}.`,
        price: p.price,
        mrp: p.mrp,
        unit: p.unit,
        stock: 50,
        lowStockAlert: 5,
        salePrice: 0,
        status: 'active',
        approvalStatus: sellerApproved ? 'approved' : 'pending',
        approvedAt: sellerApproved ? new Date() : null,
        isActive: true,
        sellerId: seller._id,
        sku: skuFor(position, poolIndex),
        deliveryTime: '10 mins',
        rating: 4.2,
      });
    }
    created.push(p.name);
  }

  return { label, created, skipped, zoneId: seller?.shopInfo?.zoneId || null };
}

async function run() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI or MONGODB_URI is required in Backend/.env');
  }

  console.log(COMMIT ? '=== WRITING to DB ===' : '=== DRY RUN (pass --commit to write) ===');
  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);

  const { byName, headerIdByCategoryName } = await resolveCategoryIds();

  const sellers = await Seller.find({
    approvalStatus: 'approved',
    approved: { $ne: false },
    isActive: { $ne: false },
    isDeleted: { $ne: true },
  })
    .select('shopName name approvalStatus shopInfo.zoneId')
    .sort({ createdAt: 1 })
    .lean();

  console.log(`\nFound ${sellers.length} approved + active sellers.`);

  let totalCreated = 0;
  let totalSkipped = 0;
  const noZoneSellers = [];

  for (let i = 0; i < sellers.length; i++) {
    const result = await seedProductsForSeller(sellers[i], i, byName, headerIdByCategoryName);
    console.log(`\n${result.label}`);
    console.log(`  +${result.created.length} [${result.created.join(', ')}]` +
      (result.skipped.length ? `  (skipped, already exist: ${result.skipped.join(', ')})` : ''));
    if (!result.zoneId) {
      console.log('  NOTE: this seller has no shopInfo.zoneId set - these products will be stored but will not appear in any customer\'s zone-scoped catalog until the seller\'s zone is set.');
      noZoneSellers.push(result.label);
    }
    totalCreated += result.created.length;
    totalSkipped += result.skipped.length;
  }

  console.log('\n--- Summary ---');
  console.log(`Products: ${totalCreated} created, ${totalSkipped} skipped`);
  if (noZoneSellers.length) {
    console.log(`Sellers without a zone (products stored but not zone-visible): ${noZoneSellers.join(', ')}`);
  }
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
