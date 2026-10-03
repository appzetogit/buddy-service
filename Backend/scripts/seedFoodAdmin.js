/**
 * Seed the Food platform admin (food_admins collection).
 *
 * USAGE
 *   node scripts/seedFoodAdmin.js
 *   node scripts/seedFoodAdmin.js --force   # reset password if admin exists
 *
 * ENV (optional)
 *   FOOD_ADMIN_EMAIL      default: admin@foodelo.com
 *   FOOD_ADMIN_PASSWORD   default: Admin@12345
 *   FOOD_ADMIN_NAME       default: Super Admin
 *   FOOD_ADMIN_PHONE      default: 9999999999
 *   FOOD_ADMIN_SERVICES   default: food,taxi
 *   MONGO_URI / MONGODB_URI
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { FoodAdmin } from '../src/core/admin/admin.model.js';
import { FoodAdminWallet } from '../src/modules/food/admin/models/adminWallet.model.js';

dotenv.config();

const FORCE = process.argv.includes('--force');

const parseServices = (raw) => {
  const allowed = new Set(['food']);
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => allowed.has(item));
};

async function seedAdminWallet() {
  const wallet = await FoodAdminWallet.findOneAndUpdate(
    { key: 'platform' },
    {
      $setOnInsert: {
        key: 'platform',
        balance: 0,
        totalRevenue: 0,
        totalPayouts: 0,
        totalRefunds: 0,
      },
    },
    { upsert: true, new: true },
  );

  console.log(`Platform wallet ready (balance: ${wallet.balance})`);
}

async function seedAdmin() {
  const email = (process.env.FOOD_ADMIN_EMAIL || process.env.ADMIN_SEED_EMAIL || 'admin@foodelo.com')
    .trim()
    .toLowerCase();
  const password = process.env.FOOD_ADMIN_PASSWORD || process.env.ADMIN_SEED_PASSWORD || 'Admin@12345';
  const name = (process.env.FOOD_ADMIN_NAME || 'Super Admin').trim();
  const phone = (process.env.FOOD_ADMIN_PHONE || '9999999999').trim();
  const servicesAccess = parseServices(
    process.env.FOOD_ADMIN_SERVICES || 'food,taxi',
  );

  if (password.length < 6) {
    throw new Error('Admin password must be at least 6 characters');
  }

  const existing = await FoodAdmin.findOne({ email });

  if (existing) {
    if (!FORCE) {
      console.log(`Admin already exists for ${email}. Skipping (use --force to reset password).`);
      return existing;
    }

    existing.password = password;
    existing.name = name;
    existing.phone = phone;
    existing.role = 'ADMIN';
    existing.isActive = true;
    existing.servicesAccess = servicesAccess.length ? servicesAccess : ['food'];
    await existing.save();

    console.log(`Updated admin: ${email}`);
    return existing;
  }

  const admin = await FoodAdmin.create({
    email,
    password,
    name,
    phone,
    role: 'ADMIN',
    isActive: true,
    servicesAccess: servicesAccess.length ? servicesAccess : ['food'],
  });

  console.log(`Created admin: ${admin.email}`);
  return admin;
}

async function run() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI or MONGODB_URI is required in Backend/.env');
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);

  await seedAdmin();
  await seedAdminWallet();

  console.log('\n--- Food admin seed complete ---');
  console.log(`Login: POST /api/v1/food/auth/admin/login`);
  console.log(`Email: ${(process.env.FOOD_ADMIN_EMAIL || process.env.ADMIN_SEED_EMAIL || 'admin@foodelo.com').toLowerCase()}`);
  console.log(`Password: ${process.env.FOOD_ADMIN_PASSWORD || process.env.ADMIN_SEED_PASSWORD || 'Admin@12345'}`);
  if (!FORCE) {
    console.log('Tip: run with --force to reset an existing admin password.');
  }

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Admin seed failed:', err.message || err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect errors
  }
  process.exit(1);
});
