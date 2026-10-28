import { FoodItem } from '../../admin/models/food.model.js';
import { FoodRestaurant } from '../models/restaurant.model.js';
import { getFoodDisplayPrice } from '../../admin/services/foodVariant.service.js';

const median = (nums) => {
    if (!nums.length) return 0;
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Recomputes and persists `avgPriceForOne` (median price of a restaurant's available
 * menu items) — called whenever a food item's price/availability/approval changes,
 * so the restaurant list endpoint never has to compute this on read.
 */
export async function recalculateAvgPriceForOne(restaurantId) {
    if (!restaurantId) return;
    const items = await FoodItem.find({ restaurantId, approvalStatus: 'approved', isAvailable: true })
        .select('price variants')
        .lean();
    const prices = items.map((item) => getFoodDisplayPrice(item)).filter((p) => Number.isFinite(p) && p > 0);
    const avgPriceForOne = Math.round(median(prices));
    await FoodRestaurant.updateOne({ _id: restaurantId }, { $set: { avgPriceForOne } });
}
