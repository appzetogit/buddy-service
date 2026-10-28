import { FoodOrder } from '../../orders/models/order.model.js';

const CANCELLED_STATUSES = ['cancelled_by_user', 'rejected_by_restaurant', 'cancelled_by_restaurant', 'cancelled_by_admin'];

/** Restaurant ids this user has ordered from before (any non-cancelled order, full history). */
export async function getOrderedRestaurantIds(userId) {
    const orders = await FoodOrder.find({
        userId,
        orderStatus: { $nin: CANCELLED_STATUSES },
    })
        .select('restaurantId pickups.restaurantId')
        .lean();

    const ids = new Set();
    for (const order of orders) {
        if (order.restaurantId) ids.add(String(order.restaurantId));
        for (const pickup of order.pickups || []) {
            if (pickup?.restaurantId) ids.add(String(pickup.restaurantId));
        }
    }
    return [...ids];
}
