/**
 * Enable outstation pricing for a taxi vehicle in every zone that currently has none — the gap
 * diagnose-taxi-driver.js found for driver 9301988718 (Bike). Run once per vehicle that's missing
 * it; Bike, Auto and any future vehicle all use the same fix.
 *
 * Derives the outstation rate from each zone's own existing city (regular ride) rate on the same
 * SetPrice row, instead of a made-up number, and only touches rows that are currently missing
 * outstation pricing (enable_outstation_ride/support_outstation off, or both outstation price
 * fields at 0) — a row that already has outstation pricing is printed but left untouched.
 *
 * USAGE
 *   node scripts/fix-outstation-pricing.js <vehicle name>            # dry run
 *   node scripts/fix-outstation-pricing.js <vehicle name> --apply    # writes the changes
 *   node scripts/fix-outstation-pricing.js                           # defaults to Bike
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { config } from '../src/config/env.js';
import { SetPrice } from '../src/modules/taxi/admin/models/SetPrice.js';
import { Vehicle } from '../src/modules/taxi/admin/models/Vehicle.js';
import { tariffSupportsOutstation } from '../src/modules/taxi/services/outstationFareService.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const vehicleName = (process.argv[2] && process.argv[2] !== '--apply' ? process.argv[2] : 'Bike').trim();

await mongoose.connect(config.mongodbUri || config.mongoUri || process.env.MONGO_URI || process.env.MONGODB_URI);

const escapedName = vehicleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const vehicles = await Vehicle.find({
  name: { $regex: new RegExp(`^${escapedName}$`, 'i') },
  transport_type: 'taxi',
}).lean();

if (!vehicles.length) {
  console.log(`No "${vehicleName}" (taxi) vehicle catalog entry found.`);
  process.exit(0);
}

const vehicleIds = vehicles.map((v) => v._id);
const rows = await SetPrice.find({
  transport_type: 'taxi',
  vehicle_type: { $in: vehicleIds },
  pricing_scope: 'ride',
});

console.log(`Found ${rows.length} ${vehicleName} (taxi) ride-pricing row(s) across zones.\n`);

let changed = 0;
for (const row of rows) {
  const alreadySupported = tariffSupportsOutstation(row);
  const cityBase = Number(row.base_price) || 0;
  const cityPerKm = Number(row.price_per_distance) || 0;

  console.log(`zone=${row.zone_id} city base=${cityBase} city perKm=${cityPerKm} outstationSupported=${alreadySupported}`);

  if (alreadySupported) {
    console.log('  -> already has outstation pricing, leaving as is.\n');
    continue;
  }
  if (cityPerKm <= 0 && cityBase <= 0) {
    console.log('  -> this zone has no city pricing either, skipping (nothing to derive from).\n');
    continue;
  }

  // Outstation covers longer, fewer-stop trips: same per-km as the city rate is the simplest,
  // defensible default (admin can tune it from Set Prices afterwards); base fare kept the same.
  const update = {
    enable_outstation_ride: true,
    support_outstation: 1,
    outstation_base_price: cityBase,
    outstation_base_distance: 0,
    outstation_price_per_distance: cityPerKm,
    outstation_time_price: Number(row.time_price) || 0,
    outstation_round_trip_price_per_distance: cityPerKm,
    outstation_min_km_per_day: 0,
    outstation_driver_allowance_per_day: 0,
  };

  console.log(`  -> setting outstation base=${update.outstation_base_price} perKm=${update.outstation_price_per_distance}`);
  if (APPLY) {
    Object.assign(row, update);
    await row.save();
    changed += 1;
    console.log('  -> saved.\n');
  } else {
    console.log('  -> dry run, not saved (pass --apply to write).\n');
  }
}

console.log(APPLY ? `Done. ${changed} row(s) updated.` : `Dry run complete. ${rows.length} row(s) inspected, 0 written (no --apply).`);
await mongoose.disconnect();
