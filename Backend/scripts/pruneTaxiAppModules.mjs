/**
 * Keeps only Daily Rides, Outstation and Parcel Delivery in the Taxi "App Modules"
 * list; deletes every other app module from the DB and strips the removed
 * module ids from any Vehicle.app_modules references.
 *
 *   node scripts/pruneTaxiAppModules.mjs [--dry]
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const DRY = process.argv.includes('--dry');
const KEEP = ['Daily Rides', 'Outstation', 'Parcel Delivery'];

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
const { TaxiAppModule } = await import('../src/modules/taxi/admin/models/TaxiAppModule.js');
const { Vehicle } = await import('../src/modules/taxi/admin/models/Vehicle.js');

const toRemove = await TaxiAppModule.find({ name: { $nin: KEEP } });
console.log('modules to remove:', toRemove.map((m) => m.name));

const removeIds = toRemove.map((m) => m._id);

if (!DRY && removeIds.length) {
  const pullRes = await Vehicle.updateMany(
    { app_modules: { $in: removeIds } },
    { $pull: { app_modules: { $in: removeIds } } }
  );
  console.log('vehicles updated:', pullRes.modifiedCount);

  const delRes = await TaxiAppModule.deleteMany({ _id: { $in: removeIds } });
  console.log('app modules deleted:', delRes.deletedCount);
} else {
  console.log(DRY ? '(dry run, nothing changed)' : 'nothing to remove');
}

const remaining = await TaxiAppModule.find({}, 'name').sort({ order_by: 1 });
console.log('remaining app modules:', remaining.map((m) => m.name));

await mongoose.disconnect();
