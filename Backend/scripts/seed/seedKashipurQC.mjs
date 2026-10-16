/**
 * Seeds the Uttarakhand quick-commerce zone with 15 approved Kashipur sellers and their products
 * (real photographs hosted on the platform Cloudinary), creating any missing categories and giving
 * header categories an image.
 *
 *   node scripts/seed/seedKashipurQC.mjs [--dry]
 * Idempotent: sellers (by shop name) and products (by name + seller) that exist are left alone.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import { SELLERS, TREE } from './data/qcData2.mjs';
import { publish } from './imageBank.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes('--dry');
const ZONE_ID = '6ad0fbfa90236658a970497c';

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
const { uploadImageBuffer } = await import('../../src/services/cloudinary.service.js');
const { Seller } = await import('../../src/modules/quick-commerce/seller/models/seller.model.js');
const { QuickProduct } = await import('../../src/modules/quick-commerce/models/product.model.js');
const { QuickCategory } = await import('../../src/modules/quick-commerce/models/category.model.js');

const plan = JSON.parse(fs.readFileSync(path.join(HERE, '.cache', 'qc-plan2.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, '.cache', 'manifest.json'), 'utf8'));
const photo = (entry, folder) => publish(entry, folder, uploadImageBuffer);

const slugify = (s) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const escapeRe = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// level-2 -> header, from the shared tree (plus the wellness shelf, which sits under Personal Care)
const L2_HEADER = { 'Health & Wellness': 'Personal Care & Beauty', 'Laundry Care': 'Cleaning & Household' };
for (const [header, l2s] of Object.entries(TREE)) for (const l2 of Object.keys(l2s)) L2_HEADER[l2] ??= header;

const headers = new Map();
for (const h of await QuickCategory.find({ type: 'header' })) headers.set(h.name, h);

const cache = new Map();
async function ensureCategory(name, type, parent, imageEntry) {
  const key = `${type}|${parent?._id}|${name}`;
  if (cache.has(key)) return cache.get(key);
  let cat = await QuickCategory.findOne({ name: new RegExp(`^${escapeRe(name)}$`, 'i'), type, parentId: parent._id });
  if (!cat) {
    if (DRY) {
      console.log(`would create ${type}: ${name}`);
      return { _id: new mongoose.Types.ObjectId(), name, image: '' };
    }
    let slug = slugify(name);
    if (await QuickCategory.exists({ slug })) slug = `${slug}-${slugify(parent.name)}`;
    cat = await QuickCategory.create({
      name, slug, type, parentId: parent._id, image: imageEntry ? await photo(imageEntry, 'quick/categories') : '',
      businessType: 'quick_commerce', status: 'active', approvalStatus: 'approved', approvedAt: new Date(), isActive: true,
    });
    console.log(`category created (${type}): ${name}`);
  } else if (!cat.image && imageEntry && !DRY) {
    cat.image = await photo(imageEntry, 'quick/categories');
    await cat.save();
    console.log(`category image set: ${name}`);
  }
  cache.set(key, cat);
  return cat;
}

const entryFor = (seller, p) => {
  const id = p.kind === 'off' ? `off:${p.terms[0]}` : `gen:${p.name}`;
  const r = plan.sellers[seller.shop]?.products[id];
  return r ? { id, r, m: manifest[r.key] } : null;
};

// first resolved photo found for each shelf, used for category / header images
const firstImage = { header: new Map(), l2: new Map(), sub: new Map() };
for (const s of SELLERS) {
  for (const p of s.products) {
    const e = entryFor(s, p);
    if (!e) continue;
    const header = L2_HEADER[p.l2];
    const item = { key: e.r.key };
    if (!firstImage.header.has(header)) firstImage.header.set(header, item);
    if (!firstImage.l2.has(p.l2)) firstImage.l2.set(p.l2, item);
    if (!firstImage.sub.has(`${p.l2}|${p.sub}`)) firstImage.sub.set(`${p.l2}|${p.sub}`, item);
  }
}

for (const [name, item] of firstImage.header) {
  const h = headers.get(name);
  if (!h) throw new Error(`Header "${name}" missing`);
  if (!h.image && !DRY) {
    h.image = await photo(item, 'quick/categories');
    await h.save();
    console.log('header image set:', name);
  }
}

const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
const pan = (i, owner) =>
  `${letters[(i * 3) % 23]}${letters[(i * 5 + 2) % 23]}${letters[(i * 7 + 4) % 23]}P${owner.trim().split(/\s+/).pop()[0].toUpperCase()}${String(2000 + i * 37)}${letters[(i * 11) % 23]}`;

let si = 0;
for (const s of SELLERS) {
  const i = si++;
  const sp = plan.sellers[s.shop];
  const phone = `91000${String(10101 + i)}`;
  let seller = await Seller.findOne({ shopName: s.shop });
  if (!seller) {
    if (DRY) {
      console.log('would create seller', s.shop);
      continue;
    }
    const shopImage = sp?.shop ? await photo(sp.shop, 'quick/sellers/shop') : '';
    const [lat, lng] = s.geo;
    const panNumber = pan(i, s.owner);
    const gst = i % 2 === 0;
    const mail = slugify(s.shop).replace(/-/g, '.');
    seller = await Seller.create({
      name: s.owner,
      shopName: s.shop,
      email: `${mail}@kashipur-demo.in`,
      phone,
      role: 'SELLER',
      isVerified: true,
      isActive: true,
      approved: true,
      approvalStatus: 'approved',
      onboardingSubmitted: true,
      approvedAt: new Date(),
      wasEverApproved: true,
      rating: Number((4.0 + ((i * 7) % 9) / 10).toFixed(1)),
      totalRatings: 40 + ((i * 47) % 300),
      location: {
        latitude: lat,
        longitude: lng,
        coordinates: [lng, lat],
        address: `${s.address}, Kashipur, Uttarakhand 244713`,
        formattedAddress: `${s.address}, Kashipur, Uttarakhand 244713`,
      },
      bankInfo: {
        bankName: 'State Bank of India',
        accountHolderName: s.owner,
        accountNumber: `3${String(41000000000 + i * 1234567).slice(0, 11)}`,
        ifscCode: 'SBIN0000821',
        accountType: 'Current',
        upiId: `${slugify(s.owner).split('-')[0]}${i}@sbi`,
      },
      documents: {
        panNumber,
        gstRegistered: gst,
        gstNumber: gst ? `05${panNumber}1Z${(i % 9) + 1}` : '',
        gstLegalName: gst ? s.shop : '',
        fssaiNumber: `1222400${String(100000 + i * 7919).slice(-7)}`,
        fssaiExpiry: new Date('2028-03-31'),
        shopLicenseNumber: `UKSL/KSP/${2021 + (i % 4)}/${1000 + i * 13}`,
        isDocumentsVerified: true,
      },
      shopInfo: {
        businessType: s.type,
        alternatePhone: '',
        supportEmail: `support.${mail}@kashipur-demo.in`,
        openingHours: s.hours,
        zoneId: ZONE_ID,
        zoneSource: 'quick',
        zoneName: 'Uttarakhand',
        shopImage,
      },
    });
    console.log(`seller ${i + 1}/15 created+approved: ${s.shop}`);
  } else {
    console.log(`seller exists: ${s.shop}`);
  }

  let added = 0;
  for (const p of s.products) {
    const e = entryFor(s, p);
    if (!e) {
      console.log(`   skipped (no photo): ${p.kind === 'off' ? p.terms[0] : p.name}`);
      continue;
    }
    const name = e.r.name;
    if (await QuickProduct.exists({ sellerId: seller._id, name })) {
      added++;
      continue;
    }
    const headerName = L2_HEADER[p.l2];
    if (!headerName) throw new Error(`No header for "${p.l2}"`);
    const header = headers.get(headerName);
    const l2 = await ensureCategory(p.l2, 'category', header, firstImage.l2.get(p.l2));
    const sub = await ensureCategory(p.sub, 'subcategory', l2, firstImage.sub.get(`${p.l2}|${p.sub}`));
    if (DRY) {
      added++;
      continue;
    }
    const image = await photo({ key: e.r.key }, 'quick/products');
    const brand = p.kind === 'off' ? e.m?.brand || '' : p.brand;
    let slug = slugify(`${name}-${s.area}`);
    if (await QuickProduct.exists({ slug })) slug = `${slug}-${i + 1}`;
    await QuickProduct.create({
      name,
      slug,
      image,
      mainImage: image,
      galleryImages: [image],
      categoryId: l2._id,
      subcategoryId: sub._id,
      headerId: header._id,
      description: `${name} - ${p.size}. Sold by ${s.shop}, Kashipur.`,
      price: p.sale,
      mrp: p.mrp,
      salePrice: p.sale,
      unit: p.size,
      weight: p.size,
      brand,
      sku: `KSP${String(i + 1).padStart(2, '0')}-${String(added + 1).padStart(3, '0')}`,
      stock: p.stock,
      status: 'active',
      approvalStatus: 'approved',
      approvedAt: new Date(),
      isActive: true,
      sellerId: seller._id,
      deliveryTime: '10 mins',
      rating: Number((4.0 + (((i + added) * 3) % 9) / 10).toFixed(1)),
      tags: [p.l2, p.sub].map((t) => t.toLowerCase()),
    });
    added++;
  }
  console.log(`   ${s.shop}: ${added} products`);
}
await mongoose.disconnect();
process.exit(0);
