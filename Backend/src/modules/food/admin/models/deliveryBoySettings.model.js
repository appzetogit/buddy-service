import mongoose from 'mongoose';

const salarySlabSchema = new mongoose.Schema(
    {
        orderCount: { type: Number, required: true, min: 0 },
        salaryAmount: { type: Number, required: true, min: 0 }
    },
    { _id: false }
);

const deliverySpeedOptionSchema = new mongoose.Schema(
    {
        id: { type: String, required: true, trim: true },
        name: { type: String, required: true, trim: true },
        badge: { type: String, default: '', trim: true },
        badgeColor: { type: String, default: 'bg-slate-100 text-slate-700 border border-slate-200' },
        time: { type: String, default: '', trim: true },
        estimatedTime: { type: Number, default: 30, min: 1 },
        feeModifier: { type: Number, default: 0 },
        /**
         * Of a positive feeModifier, how much goes to the driver (₹).
         * Admin gets the remainder. Ignored when feeModifier <= 0 (admin bears).
         */
        driverShareAmount: { type: Number, default: 0, min: 0 },
        description: { type: String, default: '', trim: true },
        icon: { type: String, enum: ['bike', 'leaf', 'zap', 'truck', 'clock'], default: 'bike' },
        isEnabled: { type: Boolean, default: true },
        isDefault: { type: Boolean, default: false },
        sortOrder: { type: Number, default: 0, min: 0 },
    },
    { _id: false }
);

const deliveryBoySettingsSchema = new mongoose.Schema(
    {
        adminCommissionPercentage: { type: Number, default: 0, min: 0, max: 100 },
        weeklySalarySlabs: { type: [salarySlabSchema], default: [] },
        monthlySalarySlabs: { type: [salarySlabSchema], default: [] },
        // Multi-Restaurant Order Settings
        multiOrderEnabled: { type: Boolean, default: true },
        multiOrderMaxDistance: { type: Number, default: 5, min: 2, max: 5 }, // max road km between R1 and R2 (2–5)
        multiOrderAdditionalCharge: { type: Number, default: 0, min: 0 }, // extra fee for 2nd pickup
        // Order Sharing Settings
        splitOrderEnabled: { type: Boolean, default: true },
        splitOrderThreshold: { type: Number, default: 20, min: 1 },
        deliverySpeedOptions: { type: [deliverySpeedOptionSchema], default: [] },
        isActive: { type: Boolean, default: true }
    },
    { collection: 'food_delivery_boy_settings', timestamps: true }
);

export const FoodDeliveryBoySettings = mongoose.model('FoodDeliveryBoySettings', deliveryBoySettingsSchema);
