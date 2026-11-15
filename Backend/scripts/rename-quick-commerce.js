/**
 * Renames "Quick Commerce" to "Marketplace" in the admin-managed hub content
 * (Banner Settings > App Home Screen: service cards, hero banners, features),
 * which the apps show as-is. Only titles / subtitles are touched.
 *
 * USAGE
 *   node scripts/rename-quick-commerce.js           # dry run: lists what would change
 *   node scripts/rename-quick-commerce.js --apply   # writes the changes
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { config } from '../src/config/env.js';
import { HomeItem } from '../src/modules/common/models/homeItem.model.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const OLD = /quick[\s-]*commerce/gi; // for replace()
const MATCH = /quick[\s-]*commerce/i; // for the query (MongoDB has no g flag)
const NEW = 'Marketplace';

await mongoose.connect(config.mongodbUri || config.mongoUri || process.env.MONGO_URI || process.env.MONGODB_URI);

const items = await HomeItem.find({ $or: [{ title: MATCH }, { subtitle: MATCH }] }).lean();
if (!items.length) console.log('Nothing to rename.');

for (const item of items) {
  const title = String(item.title || '').replace(OLD, NEW);
  const subtitle = String(item.subtitle || '').replace(OLD, NEW);
  console.log(`[${item.section}] "${item.title}" -> "${title}"${item.subtitle !== subtitle ? ` | subtitle -> "${subtitle}"` : ''}`);
  if (APPLY) await HomeItem.updateOne({ _id: item._id }, { $set: { title, subtitle } });
}

console.log(APPLY ? `Renamed ${items.length} item(s).` : `Dry run: ${items.length} item(s). Re-run with --apply to write.`);
await mongoose.disconnect();
