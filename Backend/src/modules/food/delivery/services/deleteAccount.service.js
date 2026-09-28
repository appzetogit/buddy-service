import mongoose from 'mongoose';
import { FoodDeliveryPartner } from '../models/deliveryPartner.model.js';
import { FoodOrder } from '../../orders/models/order.model.js';
import { AccountDeletion } from '../../admin/models/accountDeletion.model.js';

/**
 * Permanently delete a DELIVERY_PARTNER account.
 * 1. Snapshot financial data into account_deletions
 * 2. Anonymize orders (keep financial fields, null out deliveryPartnerId)
 * 3. Delete delivery-specific data (wallet, tickets, deposits, etc.)
 * 4. Delete the delivery partner document itself
 */
export async function deleteDeliveryAccount(userId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const partner = await FoodDeliveryPartner.findById(userId).session(session).lean();
        if (!partner) throw new Error('Delivery partner not found');

        // --- 1. Collect financial snapshot ---
        let walletBalance = 0;
        let totalEarnings = 0;
        try {
            const walletDoc = await mongoose.connection.db
                .collection('food_delivery_wallets')
                .findOne({ deliveryPartnerId: new mongoose.Types.ObjectId(userId) });
            walletBalance = walletDoc?.balance || 0;
            totalEarnings = walletDoc?.totalEarnings || 0;
        } catch (_) {}

        let pendingWithdrawals = 0;
        try {
            const withdrawalAgg = await mongoose.connection.db
                .collection('food_delivery_withdrawals')
                .aggregate([
                    {
                        $match: {
                            deliveryPartnerId: new mongoose.Types.ObjectId(userId),
                            status: 'pending'
                        }
                    },
                    { $group: { _id: null, total: { $sum: '$amount' } } }
                ])
                .toArray();
            pendingWithdrawals = withdrawalAgg[0]?.total || 0;
        } catch (_) {}

        const orderStats = await FoodOrder.aggregate([
            { $match: { deliveryPartnerId: new mongoose.Types.ObjectId(userId) } },
            {
                $group: {
                    _id: null,
                    totalAmount: { $sum: { $ifNull: ['$pricing.deliveryFee', 0] } },
                    count: { $sum: 1 }
                }
            }
        ]).session(session);

        const stats = orderStats[0] || { totalAmount: 0, count: 0 };

        // --- 2. Save financial snapshot ---
        await AccountDeletion.create(
            [
                {
                    accountType: 'DELIVERY_PARTNER',
                    originalId: partner._id,
                    phone: partner.phone || '',
                    name: partner.name || 'Unknown',
                    email: partner.email || '',
                    financialSnapshot: {
                        totalOrderAmount: stats.totalAmount,
                        walletBalance,
                        totalEarnings,
                        pendingWithdrawals
                    },
                    orderCount: stats.count
                }
            ],
            { session }
        );

        // --- 3. Anonymize orders ---
        await FoodOrder.updateMany(
            { deliveryPartnerId: new mongoose.Types.ObjectId(userId) },
            {
                $set: {
                    deliveryPartnerId: null,
                    'deliveryPartner.name': 'Deleted Partner',
                    'deliveryPartner.phone': ''
                }
            },
            { session }
        );

        // --- 4. Anonymize transactions ---
        try {
            await mongoose.connection.db.collection('food_transactions').updateMany(
                { deliveryPartnerId: new mongoose.Types.ObjectId(userId) },
                { $set: { deliveryPartnerId: null, deliveryPartnerName: 'Deleted Partner' } },
                { session }
            );
        } catch (_) {}

        // --- 5. Delete delivery-specific data ---
        const collectionsToClean = [
            { col: 'food_delivery_wallets', field: 'deliveryPartnerId' },
            { col: 'delivery_support_tickets', field: 'deliveryPartnerId' },
            { col: 'food_delivery_withdrawals', field: 'deliveryPartnerId' },
            { col: 'food_delivery_cash_deposits', field: 'deliveryPartnerId' },
            { col: 'food_referral_logs', field: 'referrer' }
        ];

        for (const { col, field } of collectionsToClean) {
            try {
                await mongoose.connection.db.collection(col).deleteMany(
                    { [field]: new mongoose.Types.ObjectId(userId) },
                    { session }
                );
            } catch (_) {}
        }

        // --- 6. Delete the delivery partner document ---
        await FoodDeliveryPartner.deleteOne({ _id: userId }, { session });

        await session.commitTransaction();
        return { success: true, message: 'Account deleted successfully' };
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
}
