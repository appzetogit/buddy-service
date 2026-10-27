import mongoose from 'mongoose';

const foodOfferSchema = new mongoose.Schema(
    {
        couponCode: { type: String, required: true, trim: true, uppercase: true, unique: true },
        discountType: { type: String, enum: ['percentage', 'flat-price'], default: 'percentage', index: true },
        discountValue: { type: Number, required: true, min: 0 },
        customerScope: { type: String, enum: ['all', 'first-time'], default: 'all', index: true },
        restaurantScope: { type: String, enum: ['all', 'selected'], default: 'all', index: true },
        restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodRestaurant' },
        minOrderValue: { type: Number, default: 0, min: 0 },
        maxDiscount: { type: Number, default: null, min: 0 },
        usageLimit: { type: Number, default: null, min: 0 },
        perUserLimit: { type: Number, default: null, min: 0 },
        usedCount: { type: Number, default: 0, min: 0 },
        startDate: { type: Date },
        isFirstOrderOnly: { type: Boolean, default: false },
        endDate: { type: Date },
        status: { type: String, enum: ['active', 'paused', 'inactive'], default: 'active', index: true },
        pausedBy: { type: String, enum: ['admin', 'restaurant'], default: null },
        approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved', index: true },
        rejectionReason: { type: String, trim: true, default: '' },
        rejectedAt: { type: Date },
        showInCart: { type: Boolean, default: true },
        createdBy: { type: String, enum: ['admin', 'restaurant'], default: 'admin', index: true },
        createdById: { type: mongoose.Schema.Types.ObjectId, index: true },
        couponCategory: { type: String, enum: ['normal', 'free_delivery'], default: 'normal', index: true },
        isGlobal: { type: Boolean, default: false, index: true },
        restaurantIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FoodRestaurant' }],
        name: { type: String, trim: true },
        description: { type: String, trim: true },
        banner: { type: String },
        terms: { type: String },
        isDeleted: { type: Boolean, default: false, index: true },
        totalDiscount: { type: Number, default: 0, min: 0 },
        platformSubsidy: { type: Number, default: 0, min: 0 },
        /** 1=Mon..7=Sun (ISO). Empty = every day. */
        activeDays: { type: [Number], default: [] },
        /** "HH:mm", India time. Empty = all day. End before start means the window crosses midnight. */
        activeFromTime: { type: String, default: '', trim: true },
        activeToTime: { type: String, default: '', trim: true },
        /** Only customers who have never ordered from this coupon's restaurant(s) before. */
        newToRestaurantOnly: { type: Boolean, default: false },
    },
    { collection: 'food_offers', timestamps: true }
);

foodOfferSchema.index({ restaurantId: 1, createdAt: -1 });

export const FoodOffer = mongoose.model('FoodOffer', foodOfferSchema);
