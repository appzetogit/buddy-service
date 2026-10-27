/**
 * Backfill tip fields on the active FoodFeeSettings doc so the admin Fee Settings
 * page and GET /food/tips/config have sane defaults instead of undefined.
 *
 * USAGE
 *   node scripts/seedTipFeeSettings.mjs
 *
 * ENV: MONGO_URI / MONGODB_URI (from Backend/.env)
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { FoodFeeSettings } from '../src/modules/food/admin/models/feeSettings.model.js';

dotenv.config();

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI or MONGODB_URI is required in Backend/.env');
  }
  await mongoose.connect(mongoUri);

  const doc = await FoodFeeSettings.findOne({ isActive: true }).sort({ createdAt: -1 });

  if (!doc) {
    console.log('No active FoodFeeSettings doc found — nothing to backfill. A doc is created the first time admin saves Fee Settings.');
  } else {
    console.log('Before:', {
      tipsEnabled: doc.tipsEnabled,
      tipPresets: doc.tipPresets,
      tipMaxAmount: doc.tipMaxAmount,
      freeDeliveryThreshold: doc.freeDeliveryThreshold,
    });

    let changed = false;
    if (doc.tipsEnabled === undefined) { doc.tipsEnabled = false; changed = true; }
    if (!Array.isArray(doc.tipPresets) || doc.tipPresets.length === 0) { doc.tipPresets = [10, 20, 30, 50]; changed = true; }
    // tipMaxAmount intentionally left unset (no cap) unless admin configures one.

    if (changed) {
      await doc.save();
      console.log('Updated.');
    } else {
      console.log('Already had tip fields — no change needed.');
    }

    console.log('After:', {
      tipsEnabled: doc.tipsEnabled,
      tipPresets: doc.tipPresets,
      tipMaxAmount: doc.tipMaxAmount,
      freeDeliveryThreshold: doc.freeDeliveryThreshold,
    });
  }

  const bannerCount = await mongoose.connection.db.collection('food_offer_banners').countDocuments();
  console.log('Existing offer banners:', bannerCount, '(none seeded — admin adds these via the Promotional Banner page)');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
