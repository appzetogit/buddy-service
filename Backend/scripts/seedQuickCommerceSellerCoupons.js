/**
 * Seed 5-6 Quick Commerce coupons per approved + active seller, writing the exact document
 * shape createSellerCoupon() (seller/services/sellerCoupon.service.js) produces.
 *
 * QC has no "admin creates a per-seller coupon" capability - admin's own create endpoint
 * (createAdminQuickCoupon, content.service.js) writes to a SEPARATE platform-wide `quick_coupons`
 * collection with no sellerId at all. Every per-seller coupon is always created BY the seller,
 * starting status: 'Pending'; admin's only lever on this collection is approving/rejecting via
 * updateAdminSellerCouponRequestStatus (admin.controller.js) - there is no "admin creates it
 * pre-approved" path in the real app either.
 *
 * So "admin aur seller side se" is modelled the only way this data model actually supports it:
 *   - most of each seller's coupons are seeded as status: 'Approved' - i.e. already reviewed
 *     and signed off, live and usable right now (the "admin side" outcome)
 *   - 1-2 per seller are seeded as status: 'Pending' - freshly submitted, sitting in the
 *     admin's "Seller Coupon Requests" queue (getAdminSellerCouponRequests) waiting for a real
 *     approve/reject click (the "seller side" state)
 *
 * Writes directly via the SellerCoupon model (collection: quick_seller_coupons) rather than
 * calling the controller/service, to skip unrelated cache-invalidation plumbing for a one-off
 * data seed - the document shape matches exactly what that endpoint would produce.
 *
 * Idempotent: a coupon already present for that seller (matched by sellerId + code, the model's
 * own unique index) is skipped, not duplicated. Safe to re-run.
 *
 * USAGE
 *   node scripts/seedQuickCommerceSellerCoupons.js            # preview (no writes)
 *   node scripts/seedQuickCommerceSellerCoupons.js --commit    # actually write to DB
 *
 * ENV
 *   MONGO_URI / MONGODB_URI (Backend/.env)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { SellerCoupon } from '../src/modules/quick-commerce/models/sellerCoupon.model.js';
import { Seller } from '../src/modules/quick-commerce/seller/models/seller.model.js';

dotenv.config();

const COMMIT = process.argv.includes('--commit');

const DAY_MS = 24 * 60 * 60 * 1000;
const now = () => new Date();
const daysFromNow = (n) => new Date(Date.now() + n * DAY_MS);

/** Deterministic, collision-resistant per-seller code slug (mirrors the Food coupon seed). */
function sellerSlug(seller, index) {
  const alnum = String(seller.shopName || seller.name || 'SHOP')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const base = (alnum || 'SHOP').slice(0, 4).padEnd(4, 'X');
  const idx = String(index + 1).padStart(2, '0');
  return `${idx}${base}`;
}

/** Up to 6 coupon templates per seller. Last one only used for sellers getting 6. */
function buildTemplates(slug) {
  return [
    {
      code: `WELCOME${slug}`,
      discountType: 'percentage',
      discountValue: 10,
      minOrderValue: 199,
      maxDiscount: 60,
      usageLimit: null,
      perUserLimit: 1,
      firstOrderOnly: true,
      description: 'Flat 10% off on your first order from this shop.',
      status: 'Approved',
    },
    {
      code: `SAVE${slug}20`,
      discountType: 'percentage',
      discountValue: 20,
      minOrderValue: 299,
      maxDiscount: 100,
      usageLimit: 200,
      perUserLimit: 2,
      firstOrderOnly: false,
      description: 'Save 20% on orders above ₹299.',
      status: 'Approved',
    },
    {
      code: `FLAT${slug}50`,
      discountType: 'fixed',
      discountValue: 50,
      minOrderValue: 249,
      maxDiscount: undefined,
      usageLimit: 300,
      perUserLimit: 3,
      firstOrderOnly: false,
      description: 'Flat ₹50 off on orders above ₹249.',
      status: 'Approved',
    },
    {
      code: `FREEDEL${slug}`,
      discountType: 'free_delivery',
      discountValue: 0,
      minOrderValue: 149,
      maxDiscount: undefined,
      usageLimit: 150,
      perUserLimit: 1,
      firstOrderOnly: false,
      description: 'Free delivery on orders above ₹149.',
      status: 'Pending', // fresh seller submission, awaiting admin review
    },
    {
      code: `MEGA${slug}30`,
      discountType: 'percentage',
      discountValue: 30,
      minOrderValue: 499,
      maxDiscount: 150,
      usageLimit: 100,
      perUserLimit: 1,
      firstOrderOnly: false,
      description: 'Save 30% on big orders above ₹499.',
      status: 'Pending', // fresh seller submission, awaiting admin review
    },
    {
      code: `FLAT${slug}100`,
      discountType: 'fixed',
      discountValue: 100,
      minOrderValue: 599,
      maxDiscount: undefined,
      usageLimit: 80,
      perUserLimit: 1,
      firstOrderOnly: false,
      description: 'Flat ₹100 off on orders above ₹599.',
      status: 'Approved',
    },
  ];
}

async function seedCouponsForSeller(seller, index) {
  const slug = sellerSlug(seller, index);
  const label = seller.shopName || seller.name || String(seller._id);
  const count = index % 2 === 0 ? 6 : 5;
  const templates = buildTemplates(slug).slice(0, count);

  const created = [];
  const skipped = [];

  for (const t of templates) {
    const existing = await SellerCoupon.findOne({ sellerId: seller._id, code: t.code })
      .select('_id')
      .lean();
    if (existing) {
      skipped.push(`${t.code} (${t.status})`);
      continue;
    }

    if (COMMIT) {
      const doc = {
        sellerId: seller._id,
        sellerName: label,
        code: t.code,
        discountType: t.discountType,
        couponType: t.discountType === 'free_delivery'
          ? 'free_delivery'
          : (t.minOrderValue > 0 ? 'min_order_value' : 'generic'),
        discountValue: t.discountValue,
        minOrderValue: t.minOrderValue,
        validFrom: now(),
        validTill: daysFromNow(90),
        usageLimit: t.usageLimit,
        perUserLimit: t.perUserLimit,
        usedCount: 0,
        firstOrderOnly: t.firstOrderOnly,
        description: t.description,
        status: t.status,
        isActive: true,
      };
      if (t.maxDiscount !== undefined) doc.maxDiscount = t.maxDiscount;
      await SellerCoupon.create(doc);
    }
    created.push(`${t.code} (${t.status})`);
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

  const sellers = await Seller.find({
    approvalStatus: 'approved',
    approved: { $ne: false },
    isActive: { $ne: false },
    isDeleted: { $ne: true },
  })
    .select('shopName name approvalStatus')
    .sort({ createdAt: 1 })
    .lean();

  console.log(`\nFound ${sellers.length} approved + active sellers.`);

  let totalCreated = 0;
  let totalSkipped = 0;
  let totalApproved = 0;
  let totalPending = 0;

  for (let i = 0; i < sellers.length; i++) {
    const result = await seedCouponsForSeller(sellers[i], i);
    console.log(`\n${result.label}`);
    console.log(`  +${result.created.length} [${result.created.join(', ')}]` +
      (result.skipped.length ? `  (skipped: ${result.skipped.join(', ')})` : ''));
    totalCreated += result.created.length;
    totalSkipped += result.skipped.length;
    totalApproved += result.created.filter((c) => c.includes('Approved')).length;
    totalPending += result.created.filter((c) => c.includes('Pending')).length;
  }

  console.log('\n--- Summary ---');
  console.log(`Coupons: ${totalCreated} created (${totalApproved} Approved / live, ${totalPending} Pending admin review), ${totalSkipped} skipped`);
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
