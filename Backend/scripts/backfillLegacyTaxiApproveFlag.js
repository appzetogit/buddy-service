// One-off: the taxi admin's Pending/Approved Drivers lists filter the shared delivery-partner
// collection by a legacy `approve`/`status` pair that only ever got written when a driver was
// approved/rejected via the "approve all services" action. A driver approved for taxi through
// the per-service approve endpoint (the common path — most drivers pick one or two services, not
// all) never had these fields set, so they were invisible on those screens even though
// BuddyIdentity.serviceStatuses.taxi.status is correctly 'approved'/'rejected'. Going forward,
// approveDriverService/rejectDriverService now sync this too; this backfills existing identities.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { BuddyIdentity } from '../src/core/identity/buddyIdentity.model.js';
import { syncLegacyTaxiApproveFlag } from '../src/core/identity/driverOnboardingAdmin.service.js';

dotenv.config();

async function run() {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) throw new Error('MONGO_URI or MONGODB_URI is required in Backend/.env');
    await mongoose.connect(mongoUri);

    const identities = await BuddyIdentity.find({
        'serviceStatuses.taxi.status': { $in: ['approved', 'rejected'] },
    }).select('_id serviceStatuses.taxi.status').lean();

    console.log(`Backfilling legacy taxi approve flag for ${identities.length} identities...`);
    for (const identity of identities) {
        await syncLegacyTaxiApproveFlag(identity._id, identity.serviceStatuses.taxi.status === 'approved');
    }
    console.log('Done.');
    await mongoose.disconnect();
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
