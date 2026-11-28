import mongoose from 'mongoose';
import { FoodRestaurant } from '../models/restaurant.model.js';
import { FoodOrder } from '../../orders/models/order.model.js';
import { AccountDeletion } from '../../admin/models/accountDeletion.model.js';

/**
 * Permanently delete a RESTAURANT account.
 * 1. Snapshot financial data into account_deletions
 * 2. Anonymize orders (keep financial fields, null out restaurantId)
 * 3. Delete restaurant-specific data (foods, addons, menus, wallet, tickets, etc.)
 * 4. Delete the restaurant document itself
 */
export async function deleteRestaurantAccount(userId, opts = {}) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const restaurant = await FoodRestaurant.findById(userId).session(session).lean();
        if (!restaurant) throw new Error('Restaurant not found');

        // --- 1. Collect financial snapshot ---
        let walletBalance = 0;
        let totalEarnings = 0;
        try {
            const walletDoc = await mongoose.connection.db
                .collection('food_restaurant_wallets')
                .findOne({ restaurantId: new mongoose.Types.ObjectId(userId) });
            walletBalance = walletDoc?.balance || 0;
            totalEarnings = walletDoc?.totalEarnings || 0;
        } catch (_) {}

        let pendingWithdrawals = 0;
        try {
            const withdrawalAgg = await mongoose.connection.db
                .collection('food_restaurant_withdrawals')
                .aggregate([
                    {
                        $match: {
                            restaurantId: new mongoose.Types.ObjectId(userId),
                            status: 'pending'
                        }
                    },
                    { $group: { _id: null, total: { $sum: '$amount' } } }
                ])
                .toArray();
            pendingWithdrawals = withdrawalAgg[0]?.total || 0;
        } catch (_) {}

        let totalCommissionPaid = 0;
        try {
            const commissionAgg = await mongoose.connection.db
                .collection('food_restaurant_commissions')
                .aggregate([
                    { $match: { restaurantId: new mongoose.Types.ObjectId(userId) } },
                    { $group: { _id: null, total: { $sum: '$amount' } } }
                ])
                .toArray();
            totalCommissionPaid = commissionAgg[0]?.total || 0;
        } catch (_) {}

        const orderStats = await FoodOrder.aggregate([
            { $match: { restaurantId: new mongoose.Types.ObjectId(userId) } },
            {
                $group: {
                    _id: null,
                    totalAmount: { $sum: { $ifNull: ['$pricing.total', 0] } },
                    count: { $sum: 1 }
                }
            }
        ]).session(session);

        const stats = orderStats[0] || { totalAmount: 0, count: 0 };

        // --- 2. Save financial snapshot ---
        await AccountDeletion.create(
            [
                {
                    accountType: 'RESTAURANT',
                    originalId: restaurant._id,
                    phone: restaurant.phone || '',
                    name: restaurant.restaurantName || restaurant.name || 'Unknown',
                    email: restaurant.email || '',
                    financialSnapshot: {
                        totalOrderAmount: stats.totalAmount,
                        walletBalance,
                        totalEarnings,
                        pendingWithdrawals,
                        totalCommissionPaid
                    },
                    orderCount: stats.count,
                    source: opts.source === 'admin' ? 'admin' : 'self',
                    reason: String(opts.reason || '').slice(0, 300)
                }
            ],
            { session }
        );

        // --- 3. Anonymize orders ---
        await FoodOrder.updateMany(
            { restaurantId: new mongoose.Types.ObjectId(userId) },
            {
                $set: {
                    restaurantId: null,
                    'restaurant.name': 'Deleted Restaurant',
                    'restaurant.restaurantName': 'Deleted Restaurant',
                    'restaurant.phone': ''
                }
            },
            { session }
        );

        // --- 4. Anonymize transactions ---
        try {
            await mongoose.connection.db.collection('food_transactions').updateMany(
                { restaurantId: new mongoose.Types.ObjectId(userId) },
                { $set: { restaurantId: null, restaurantName: 'Deleted Restaurant' } },
                { session }
            );
        } catch (_) {}

        // --- 5. Delete restaurant-specific data ---
        const collectionsToClean = [
            { col: 'food_restaurant_wallets', field: 'restaurantId' },
            { col: 'food_restaurant_support_tickets', field: 'restaurantId' },
            { col: 'food_restaurant_withdrawals', field: 'restaurantId' },
            { col: 'food_items', field: 'restaurantId' },
            { col: 'food_addons', field: 'restaurantId' },
            { col: 'food_restaurant_menus', field: 'restaurantId' },
            { col: 'food_restaurant_outlet_timings', field: 'restaurantId' },
            { col: 'food_restaurant_commissions', field: 'restaurantId' },
            { col: 'food_dining_restaurants', field: 'restaurantId' },
            { col: 'food_dining_requests', field: 'restaurantId' },
            { col: 'food_dining_tables', field: 'restaurantId' },
            { col: 'food_dining_time_slots', field: 'restaurantId' },
            { col: 'food_dining_bookings', field: 'restaurantId' },
            { col: 'food_dining_reviews', field: 'restaurantId' }
        ];

        for (const { col, field } of collectionsToClean) {
            try {
                await mongoose.connection.db.collection(col).deleteMany(
                    { [field]: new mongoose.Types.ObjectId(userId) },
                    { session }
                );
            } catch (_) {}
        }

        // --- 6. Delete the restaurant document ---
        await FoodRestaurant.deleteOne({ _id: userId }, { session });

        await session.commitTransaction();
        return { success: true, message: 'Account deleted successfully', deleted: { name: restaurant.restaurantName || restaurant.name || '', phone: restaurant.phone || '' } };
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
}
