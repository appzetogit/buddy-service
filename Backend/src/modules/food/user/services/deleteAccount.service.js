import mongoose from 'mongoose';
import { FoodUser } from '../../../../core/users/user.model.js';
import { FoodOrder } from '../../orders/models/order.model.js';
import { AccountDeletion } from '../../admin/models/accountDeletion.model.js';

/**
 * Permanently delete a USER account.
 * 1. Snapshot financial data into account_deletions
 * 2. Anonymize orders (keep financial fields, null out userId)
 * 3. Delete user-specific data (wallet, tickets, addresses, etc.)
 * 4. Delete the user document itself
 */
export async function deleteUserAccount(userId, opts = {}) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const user = await FoodUser.findById(userId).session(session).lean();
        if (!user) throw new Error('User not found');

        // --- 1. Collect financial snapshot ---
        let walletBalance = 0;
        try {
            const walletDoc = await mongoose.connection.db
                .collection('food_user_wallets')
                .findOne({ userId: new mongoose.Types.ObjectId(userId) });
            walletBalance = walletDoc?.balance || 0;
        } catch (_) {}

        const orderStats = await FoodOrder.aggregate([
            { $match: { userId: new mongoose.Types.ObjectId(userId) } },
            {
                $group: {
                    _id: null,
                    totalAmount: { $sum: { $ifNull: ['$pricing.total', 0] } },
                    count: { $sum: 1 },
                    pendingRefunds: {
                        $sum: {
                            $cond: [
                                { $eq: ['$refundStatus', 'pending'] },
                                { $ifNull: ['$pricing.total', 0] },
                                0
                            ]
                        }
                    }
                }
            }
        ]).session(session);

        const stats = orderStats[0] || { totalAmount: 0, count: 0, pendingRefunds: 0 };

        // --- 2. Save financial snapshot ---
        await AccountDeletion.create(
            [
                {
                    accountType: 'USER',
                    originalId: user._id,
                    phone: user.phone || '',
                    name: user.name || 'Unknown',
                    email: user.email || '',
                    financialSnapshot: {
                        totalOrderAmount: stats.totalAmount,
                        walletBalance,
                        pendingRefunds: stats.pendingRefunds
                    },
                    orderCount: stats.count,
                    source: opts.source === 'admin' ? 'admin' : 'self',
                    reason: String(opts.reason || '').slice(0, 300)
                }
            ],
            { session }
        );

        // --- 3. Anonymize orders (keep financial data intact) ---
        await FoodOrder.updateMany(
            { userId: new mongoose.Types.ObjectId(userId) },
            {
                $set: {
                    userId: null,
                    'customer.name': 'Deleted User',
                    'customer.email': '',
                    'customer.phone': '',
                    'deliveryAddress.phone': ''
                }
            },
            { session }
        );

        // --- 4. Anonymize transactions ---
        try {
            await mongoose.connection.db.collection('food_transactions').updateMany(
                { userId: new mongoose.Types.ObjectId(userId) },
                { $set: { userId: null, userName: 'Deleted User' } },
                { session }
            );
        } catch (_) {}

        // --- 5. Delete user-specific collections ---
        const collectionsToClean = [
            'food_user_wallets',
            'food_support_tickets',
            'food_safety_emergency_reports',
            'food_dining_requests',
            'food_offer_usages',
            'food_referral_logs'
        ];

        for (const col of collectionsToClean) {
            try {
                await mongoose.connection.db.collection(col).deleteMany(
                    {
                        $or: [
                            { userId: new mongoose.Types.ObjectId(userId) },
                            { user: new mongoose.Types.ObjectId(userId) },
                            { referredBy: new mongoose.Types.ObjectId(userId) },
                            { referrer: new mongoose.Types.ObjectId(userId) }
                        ]
                    },
                    { session }
                );
            } catch (_) {}
        }

        // --- 6. Delete the user document ---
        await FoodUser.deleteOne({ _id: userId }, { session });

        await session.commitTransaction();
        return { success: true, message: 'Account deleted successfully', deleted: { name: user.name || '', phone: user.phone || '' } };
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
}
