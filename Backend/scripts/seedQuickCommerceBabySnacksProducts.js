/**
 * Seed 15 demo products into the existing "Baby Snacks" subcategory
 * (Baby Care header -> Baby Food category -> Baby Snacks subcategory), spread round-robin
 * across every approved + active ("present") seller so the subcategory page shows a real,
 * multi-seller catalog instead of the "No products found in this category" empty state.
 *
 * Writes directly to the QuickProduct model - the same underlying `quick_products` collection
 * the live seller-add-product flow (SellerProduct, same collection via its `collection:
 * 'quick_products'` override) and the customer catalog both already read. See
 * seedQuickCommerceSellerProducts.js for the full reasoning; this script follows the exact same
 * conventions, just scoped to one subcategory that had zero products.
 *
 * Every image URL was verified live (curl, 200 OK) before being written here.
 *
 * Idempotent: a product already present for its seller (matched by sellerId + name) is
 * skipped, not duplicated. Safe to re-run.
 *
 * USAGE
 *   node scripts/seedQuickCommerceBabySnacksProducts.js            # preview (no writes)
 *   node scripts/seedQuickCommerceBabySnacksProducts.js --commit    # actually write to DB
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

const SUBCATEGORY_NAME = 'Baby Snacks';
const CATEGORY_NAME = 'Baby Food';
const HEADER_NAME = 'Baby Care';

/** 15 products, each with its own verified image. */
const PRODUCTS = [
  { name: 'Baby Cereal Mix', price: 199, mrp: 239, unit: '300 g', image: unsplash('1760267982929-b038bf9b82e0') },
  { name: 'Wheat & Dal Baby Cereal', price: 209, mrp: 249, unit: '300 g', image: unsplash('1774436080124-3ccdcffdafa2') },
  { name: 'Multigrain Baby Porridge', price: 219, mrp: 259, unit: '300 g', image: unsplash('1624896273913-26bdde98b870') },
  { name: 'Ragi Baby Cereal', price: 189, mrp: 229, unit: '300 g', image: unsplash('1548289227-b7d966b70003') },
  { name: 'Rice Baby Cereal', price: 179, mrp: 219, unit: '300 g', image: unsplash('1760267978902-b34c1cc0c0af') },
  { name: 'Baby Biscuits (Milk Flavour)', price: 89, mrp: 109, unit: '150 g', image: unsplash('1491013516836-7db643ee125a') },
  { name: 'Teething Rusk Sticks', price: 99, mrp: 119, unit: '200 g', image: unsplash('1601154564839-2f4d77afec58') },
  { name: 'Baby Cookies Pack', price: 95, mrp: 115, unit: '150 g', image: unsplash('1603194556500-bdd4c947a952') },
  { name: 'Wheat Rusk for Babies', price: 79, mrp: 99, unit: '200 g', image: unsplash('1595179094206-f84e36714b2c') },
  { name: 'Vanilla Baby Biscuits', price: 89, mrp: 109, unit: '150 g', image: unsplash('1745793434491-508bd59fe09e') },
  { name: 'Baby Infant Formula Milk Powder', price: 449, mrp: 529, unit: '400 g', image: unsplash('1529567054786-fc5235fdd39e') },
  { name: 'Follow-up Formula Milk Powder', price: 469, mrp: 549, unit: '400 g', image: unsplash('1623707430616-d9f956bcac2b') },
  { name: 'Baby Teething Biscuits', price: 85, mrp: 105, unit: '150 g', image: unsplash('1664463759760-ee539aeebc1a') },
  { name: 'Milk Rusk Pack', price: 75, mrp: 95, unit: '200 g', image: unsplash('1636995973906-5af7d9832adb') },
  { name: 'Baby Snack Bites', price: 99, mrp: 125, unit: '100 g', image: unsplash('1546171912-333ae81c8f4c') },
];

async function resolveSubcategory() {
  const sub = await QuickCategory.findOne({ name: SUBCATEGORY_NAME, type: 'subcategory' })
    .select('_id parentId')
    .lean();
  if (!sub) {
    throw new Error(`Subcategory "${SUBCATEGORY_NAME}" not found - nothing to seed into.`);
  }
  const category = await QuickCategory.findOne({ _id: sub.parentId, type: 'category' })
    .select('_id name parentId')
    .lean();
  if (!category || category.name !== CATEGORY_NAME) {
    throw new Error(`Expected "${SUBCATEGORY_NAME}" to sit under "${CATEGORY_NAME}", found something else.`);
  }
  const header = await QuickCategory.findOne({ _id: category.parentId, type: 'header' })
    .select('_id name')
    .lean();
  if (!header || header.name !== HEADER_NAME) {
    throw new Error(`Expected "${CATEGORY_NAME}" to sit under "${HEADER_NAME}", found something else.`);
  }
  return { subcategoryId: sub._id, categoryId: category._id, headerId: header._id };
}

const skuFor = (sellerIndex, productIndex) =>
  `QC-BS-S${String(sellerIndex + 1).padStart(2, '0')}-P${String(productIndex + 1).padStart(2, '0')}`;

async function run() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI or MONGODB_URI is required in Backend/.env');
  }

  console.log(COMMIT ? '=== WRITING to DB ===' : '=== DRY RUN (pass --commit to write) ===');
  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);

  const { subcategoryId, categoryId, headerId } = await resolveSubcategory();

  const sellers = await Seller.find({
    approvalStatus: 'approved',
    approved: { $ne: false },
    isActive: { $ne: false },
    isDeleted: { $ne: true },
  })
    .select('shopName name approvalStatus shopInfo.zoneId')
    .sort({ createdAt: 1 })
    .lean();

  if (!sellers.length) {
    throw new Error('No approved + active sellers found - nothing to attach these products to.');
  }

  console.log(`Found ${sellers.length} approved + active sellers. Round-robin assigning ${PRODUCTS.length} products.\n`);

  let created = 0;
  let skipped = 0;
  const noZoneSellers = new Set();

  for (let i = 0; i < PRODUCTS.length; i++) {
    const p = PRODUCTS[i];
    const seller = sellers[i % sellers.length];
    const label = seller.shopName || seller.name || String(seller._id);

    const existing = await QuickProduct.findOne({ sellerId: seller._id, name: p.name })
      .select('_id')
      .lean();
    if (existing) {
      console.log(`  = ${p.name} (${label}) - already exists, skipped`);
      skipped++;
      continue;
    }

    const sellerApproved = seller.approvalStatus === 'approved';

    if (COMMIT) {
      const slug = `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-bs${i + 1}`;
      await QuickProduct.create({
        name: p.name,
        slug,
        image: p.image,
        mainImage: p.image,
        galleryImages: [p.image],
        categoryId,
        subcategoryId,
        headerId,
        description: `${p.name} - ${p.unit}. Sold by ${label}.`,
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
        sku: skuFor(i % sellers.length, Math.floor(i / sellers.length)),
        deliveryTime: '10 mins',
        rating: 4.2,
      });
    }

    if (!seller?.shopInfo?.zoneId) noZoneSellers.add(label);
    console.log(`  + ${p.name} -> ${label}`);
    created++;
  }

  console.log('\n--- Summary ---');
  console.log(`Products: ${created} created, ${skipped} skipped`);
  if (noZoneSellers.size) {
    console.log(`Sellers without a zone (products stored but not zone-visible): ${[...noZoneSellers].join(', ')}`);
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
