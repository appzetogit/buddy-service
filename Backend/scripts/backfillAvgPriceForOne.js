// One-off: populate the new FoodRestaurant.avgPriceForOne cache for every existing
// restaurant, so "Under ₹250" filtering works immediately instead of waiting for
// each restaurant's next menu edit (which is what keeps it in sync going forward).
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { FoodRestaurant } from '../src/modules/food/restaurant/models/restaurant.model.js';
import { recalculateAvgPriceForOne } from '../src/modules/food/restaurant/services/avgPriceForOne.service.js';

dotenv.config();

async function run() {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) throw new Error('MONGO_URI or MONGODB_URI is required in Backend/.env');
    await mongoose.connect(mongoUri);
    const restaurants = await FoodRestaurant.find({}).select('_id').lean();
    console.log(`Backfilling avgPriceForOne for ${restaurants.length} restaurants...`);
    for (const r of restaurants) {
        await recalculateAvgPriceForOne(r._id);
    }
    console.log('Done.');
    await mongoose.disconnect();
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
