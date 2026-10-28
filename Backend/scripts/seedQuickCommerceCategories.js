/**
 * Seed a demo Quick Commerce category tree: 3 headers, 6 categories ("main"), 3 subcategories
 * (12 nodes total) - admin-created, auto-approved, each level correctly linked to its parent
 * via parentId (header -> category -> subcategory), matching the exact shape
 * createCategory() in admin.controller.js produces.
 *
 * Header categories use the icon library (iconId), never a custom image - the real create
 * endpoint explicitly rejects an image upload for type: 'header'
 * (admin.controller.js: "Header categories use icons only. Custom image upload is not
 * allowed."). Category and subcategory nodes DO get a real image, which is what this script
 * provides. Every image URL was verified live (curl, 200 OK) before being written here, same
 * convention already used by the Food category/item seed scripts (Unsplash CDN,
 * `?w=400&h=300&fit=crop`).
 *
 * Writes directly via the QuickCategory model rather than calling the admin controller/service,
 * to avoid pulling in unrelated HTTP/multipart/cache-invalidation plumbing for a one-off data
 * seed - the document shape matches exactly what that endpoint would produce.
 *
 * Idempotent: a node already present (matched by name + type + parent) is skipped, not
 * duplicated. Safe to re-run.
 *
 * USAGE
 *   node scripts/seedQuickCommerceCategories.js            # preview (no writes)
 *   node scripts/seedQuickCommerceCategories.js --commit    # actually write to DB
 *
 * ENV
 *   MONGO_URI / MONGODB_URI (Backend/.env)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { QuickCategory } from '../src/modules/quick-commerce/models/category.model.js';

dotenv.config();

const COMMIT = process.argv.includes('--commit');

const unsplash = (id) => `https://images.unsplash.com/photo-${id}?w=400&h=300&fit=crop`;

/**
 * 3 headers, each with 2 categories; exactly one category per header gets a subcategory.
 * sortOrder continues past 100 to stay clear of whatever admin-entered values already exist.
 */
const TREE = [
  {
    name: 'Personal Care & Beauty',
    iconId: 'beauty',
    accentColor: '#f06292',
    categories: [
      {
        name: 'Skin Care',
        image: unsplash('1580870069867-74c57ee1bb07'),
        subcategories: [
          { name: 'Face Wash & Cleansers', image: unsplash('1585945037805-5fd82c2e60b1') },
        ],
      },
      {
        name: 'Hair Styling & Grooming',
        image: unsplash('1701976857871-a46363644519'),
        subcategories: [],
      },
    ],
  },
  {
    name: 'Cleaning & Household',
    iconId: 'cleaning',
    accentColor: '#4fc3f7',
    categories: [
      {
        name: 'Laundry Care',
        image: unsplash('1626806819282-2c1dc01a5e0c'),
        subcategories: [
          { name: 'Detergents & Fabric Care', image: unsplash('1582735689369-4fe89db7114c') },
        ],
      },
      {
        name: 'Home Cleaning Essentials',
        image: unsplash('1550963295-019d8a8a61c5'),
        subcategories: [],
      },
    ],
  },
  {
    name: 'Snacks & Beverages',
    iconId: 'snacks',
    accentColor: '#ffb74d',
    categories: [
      {
        name: 'Packaged Snacks',
        image: unsplash('1599490659213-e2b9527bd087'),
        subcategories: [
          { name: 'Chips & Namkeen', image: unsplash('1613919113640-25732ec5e61f') },
        ],
      },
      {
        name: 'Soft Drinks & Juices',
        image: unsplash('1640213505284-21352ee0d76b'),
        subcategories: [],
      },
    ],
  },
];

const now = () => new Date();

/** Base fields every node (header/category/subcategory) shares. */
const baseFields = (name, sortOrder) => ({
  name,
  description: '',
  status: 'active',
  approvalStatus: 'approved',
  approvedAt: now(),
  isActive: true,
  sortOrder,
});

async function findExisting(name, type, parentId) {
  return QuickCategory.findOne({ name, type, parentId: parentId || null }).select('_id').lean();
}

async function generateUniqueSlug(name) {
  const base = String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  let candidate = base;
  let n = 2;
  // Mirrors generateUniqueSlug() in category.helpers.js (not imported directly, to keep this
  // script's only dependency on the app the QuickCategory model itself).
  while (await QuickCategory.findOne({ slug: candidate }).select('_id').lean()) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

/**
 * Create-or-find one node. `parentDoc` is the already-resolved parent (or null for a header).
 * Returns { doc, wasCreated } - `doc` is null in dry-run for a genuinely new node (nothing was
 * actually inserted, so there is no real _id yet), which is fine: findExisting() against a
 * null parentId simply finds nothing, so every descendant correctly reports "would create" too
 * instead of being misreported as blocked on a missing parent.
 */
async function upsertNode({ name, type, parentDoc, extraFields = {}, sortOrder }) {
  const parentId = parentDoc?._id || null;
  const existing = await findExisting(name, type, parentId);
  if (existing) {
    return { doc: existing, wasCreated: false, alreadyExisted: true };
  }

  if (!COMMIT) {
    return { doc: null, wasCreated: true, alreadyExisted: false };
  }

  const slug = await generateUniqueSlug(name);
  const doc = await QuickCategory.create({
    ...baseFields(name, sortOrder),
    slug,
    type,
    parentId,
    ...extraFields,
  });
  return { doc, wasCreated: true, alreadyExisted: false };
}

async function seedTree() {
  const created = [];
  const skipped = [];
  let sortOrder = 200; // stay clear of existing admin-entered sortOrder values

  for (const header of TREE) {
    sortOrder += 10;
    const headerResult = await upsertNode({
      name: header.name,
      type: 'header',
      parentDoc: null,
      sortOrder,
      extraFields: {
        iconId: header.iconId,
        businessType: 'quick_commerce',
        accentColor: header.accentColor,
        headerColor: header.accentColor,
        adminCommission: 0,
        gst: 0,
        handlingFees: 0,
        returnsEnabled: true,
        returnWindowHours: 72,
      },
    });
    (headerResult.alreadyExisted ? skipped : created).push(
      `[header] ${header.name}${headerResult.alreadyExisted ? ' (already exists)' : ''}`,
    );

    for (const category of header.categories) {
      sortOrder += 10;
      const categoryResult = await upsertNode({
        name: category.name,
        type: 'category',
        parentDoc: headerResult.doc,
        sortOrder,
        extraFields: { image: category.image, accentColor: header.accentColor },
      });
      (categoryResult.alreadyExisted ? skipped : created).push(
        `  [category] ${category.name} (under ${header.name})${categoryResult.alreadyExisted ? ' (already exists)' : ''}`,
      );

      for (const sub of category.subcategories) {
        sortOrder += 10;
        const subResult = await upsertNode({
          name: sub.name,
          type: 'subcategory',
          parentDoc: categoryResult.doc,
          sortOrder,
          extraFields: { image: sub.image, accentColor: header.accentColor },
        });
        (subResult.alreadyExisted ? skipped : created).push(
          `    [subcategory] ${sub.name} (under ${category.name})${subResult.alreadyExisted ? ' (already exists)' : ''}`,
        );
      }
    }
  }

  return { created, skipped };
}

async function run() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI or MONGODB_URI is required in Backend/.env');
  }

  console.log(COMMIT ? '=== WRITING to DB ===' : '=== DRY RUN (pass --commit to write) ===');
  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);

  const { created, skipped } = await seedTree();

  console.log('\n--- Created ---');
  created.forEach((n) => console.log(`  + ${n}`));
  console.log('\n--- Skipped (already exist) ---');
  skipped.forEach((n) => console.log(`  = ${n}`));

  console.log(`\nSummary: ${created.length} created, ${skipped.length} skipped`);
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
