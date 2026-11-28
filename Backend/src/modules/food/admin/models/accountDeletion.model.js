import mongoose from 'mongoose';

/**
 * Financial snapshot preserved when an account is deleted.
 * This ensures admin money calculations remain accurate even
 * after user/delivery/restaurant data is purged.
 */
const accountDeletionSchema = new mongoose.Schema(
    {
        accountType: {
            type: String,
            enum: ['USER', 'DELIVERY_PARTNER', 'RESTAURANT', 'SELLER'],
            required: true,
            index: true
        },
        originalId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true
        },
        phone: { type: String, default: '' },
        name: { type: String, default: 'Deleted Account' },
        email: { type: String, default: '' },
        deletedAt: { type: Date, default: Date.now },
        financialSnapshot: {
            totalOrderAmount: { type: Number, default: 0 },
            walletBalance: { type: Number, default: 0 },
            pendingRefunds: { type: Number, default: 0 },
            totalEarnings: { type: Number, default: 0 },
            pendingWithdrawals: { type: Number, default: 0 },
            totalCommissionPaid: { type: Number, default: 0 }
        },
        orderCount: { type: Number, default: 0 },
        // Who deleted it and why (shown to the admin on the Deleted Accounts page).
        source: { type: String, enum: ['self', 'admin'], default: 'self' },
        reason: { type: String, default: '' },
        // Extra labels worth keeping, e.g. a seller's shop name.
        details: { type: mongoose.Schema.Types.Mixed, default: null }
    },
    {
        collection: 'account_deletions',
        timestamps: true
    }
);

export const AccountDeletion = mongoose.model('AccountDeletion', accountDeletionSchema);
