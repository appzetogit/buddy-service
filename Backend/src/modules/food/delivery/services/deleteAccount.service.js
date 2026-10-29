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
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
        return null;
    }

    let session = null;
    try {
        session = await mongoose.startSession();
        session.startTransaction();
    } catch (_) {
        session = null;
    }

    const sessionOpt = session ? { session } : {};

    try {
        const partner = await FoodDeliveryPartner.findById(userId)
            .session(session || null)
            .lean();
        if (!partner) {
            if (session) await session.abortTransaction();
            return null;
        }

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

        let stats = { totalAmount: 0, count: 0 };
        try {
            const orderStats = await FoodOrder.aggregate([
                {
                    $match: {
                        $or: [
                            { deliveryPartnerId: new mongoose.Types.ObjectId(userId) },
                            { 'dispatch.deliveryPartnerId': new mongoose.Types.ObjectId(userId) }
                        ]
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalAmount: { $sum: { $ifNull: ['$pricing.deliveryFee', 0] } },
                        count: { $sum: 1 }
                    }
                }
            ]).session(session || null);
            stats = orderStats[0] || { totalAmount: 0, count: 0 };
        } catch (_) {}

        // --- 2. Save financial snapshot ---
        try {
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
                sessionOpt
            );
        } catch (e) {
            console.error('[deleteDeliveryAccount] Warning creating AccountDeletion snapshot:', e.message);
        }

        // --- 3. Anonymize orders ---
        await FoodOrder.updateMany(
            {
                $or: [
                    { deliveryPartnerId: new mongoose.Types.ObjectId(userId) },
                    { 'dispatch.deliveryPartnerId': new mongoose.Types.ObjectId(userId) }
                ]
            },
            {
                $set: {
                    deliveryPartnerId: null,
                    'dispatch.deliveryPartnerId': null,
                    'deliveryPartner.name': 'Deleted Partner',
                    'deliveryPartner.phone': ''
                }
            },
            sessionOpt
        );

        // --- 4. Anonymize transactions ---
        try {
            await mongoose.connection.db.collection('food_transactions').updateMany(
                { deliveryPartnerId: new mongoose.Types.ObjectId(userId) },
                { $set: { deliveryPartnerId: null, deliveryPartnerName: 'Deleted Partner' } },
                sessionOpt
            );
        } catch (_) {}

        // --- 5. Clean delivery-specific collections ---
        const collectionsToClean = [
            { col: 'food_delivery_wallets', field: 'deliveryPartnerId' },
            { col: 'delivery_support_tickets', field: 'deliveryPartnerId' },
            { col: 'food_delivery_withdrawals', field: 'deliveryPartnerId' },
            { col: 'food_delivery_cash_deposits', field: 'deliveryPartnerId' },
            { col: 'food_referral_logs', field: 'referrer' },
            { col: 'food_delivery_bonus_transactions', field: 'deliveryPartnerId' },
            { col: 'food_delivery_salary_payments', field: 'deliveryPartnerId' },
            { col: 'delivery_earning_addon_histories', field: 'deliveryPartnerId' },
            { col: 'delivery_partner_reviews', field: 'deliveryPartnerId' }
        ];

        for (const { col, field } of collectionsToClean) {
            try {
                await mongoose.connection.db.collection(col).deleteMany(
                    { [field]: new mongoose.Types.ObjectId(userId) },
                    sessionOpt
                );
            } catch (_) {}
        }

        // --- 6. Update BuddyIdentity if present ---
        try {
            const identityId = partner.identityId;
            if (identityId) {
                await mongoose.connection.db.collection('buddy_identities').updateOne(
                    { _id: new mongoose.Types.ObjectId(identityId) },
                    {
                        $pull: { roles: 'DRIVER' },
                        $set: {
                            activeService: 'off',
                            onboardingServices: [],
                            'serviceStatuses.food.status': 'not_enabled',
                            'serviceStatuses.quickCommerce.status': 'not_enabled',
                            'serviceStatuses.taxi.status': 'not_enabled'
                        }
                    },
                    sessionOpt
                );
            }
        } catch (e) {
            console.error('[deleteDeliveryAccount] Warning updating buddy_identities:', e.message);
        }

        // --- 7. Clean image assets (Cloudinary) safely ---
        try {
            const { deleteFromCloudinary } = await import('../../../../services/localUpload.service.js');
            const publicIds = [];
            if (partner.imagePublicIds && typeof partner.imagePublicIds === 'object') {
                Object.values(partner.imagePublicIds).forEach((pid) => {
                    if (pid && typeof pid === 'string') publicIds.push(pid);
                });
            }
            for (const pid of publicIds) {
                try {
                    await deleteFromCloudinary(pid, { ignoreErrors: true });
                } catch (_) {}
            }
        } catch (_) {}

        // --- 8. Delete the delivery partner document ---
        await FoodDeliveryPartner.deleteOne({ _id: userId }, sessionOpt);

        if (session) {
            await session.commitTransaction();
        }
        return { success: true, message: 'Delivery partner deleted successfully' };
    } catch (error) {
        if (session) {
            try {
                await session.abortTransaction();
            } catch (_) {}
        }
        throw error;
    } finally {
        if (session) {
            try {
                session.endSession();
            } catch (_) {}
        }
    }
}
