import mongoose from 'mongoose';

const deliveryFeeRangeSchema = new mongoose.Schema(
    {
        min: { type: Number, required: true, min: 0 },
        max: { type: Number, required: true, min: 0 },
        fee: { type: Number, required: true, min: 0 }
    },
    { _id: false }
);

const feeSettingsSchema = new mongoose.Schema(
    {
        // No defaults here; admin must explicitly configure values.
        deliveryFee: { type: Number, min: 0 },
        deliveryFeeRanges: { type: [deliveryFeeRangeSchema], default: [] },
        freeDeliveryThreshold: { type: Number, min: 0 },
        platformFee: { type: Number, min: 0 },
        packagingFee: { type: Number, min: 0 },
        gstRate: { type: Number, min: 0, max: 100 },
        tipsEnabled: { type: Boolean, default: false },
        tipPresets: { type: [Number], default: [10, 20, 30, 50] },
        tipMaxAmount: { type: Number, min: 0 },
        isActive: { type: Boolean, default: true, index: true }
    },
    { collection: 'food_fee_settings', timestamps: true }
);

feeSettingsSchema.index({ isActive: 1, createdAt: -1 });

export const FoodFeeSettings = mongoose.model('FoodFeeSettings', feeSettingsSchema);

