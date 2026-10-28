import mongoose from 'mongoose';

const foodVariantSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        price: { type: Number, required: true, min: 0 },
        unit: { type: String, trim: true, default: '' }
    },
    { _id: true }
);

const foodSchema = new mongoose.Schema(
    {
        restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodRestaurant', required: true, index: true },
        categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodCategory', index: true },
        categoryName: { type: String, trim: true, default: '' },
        name: { type: String, required: true, trim: true, index: true },
        description: { type: String, trim: true, default: '' },
        price: { type: Number, required: true, min: 0 },
        variants: { type: [foodVariantSchema], default: [] },
        image: { type: String, trim: true, default: '' },
        imagePublicId: { type: String, trim: true, default: '' },
        foodType: { type: String, enum: ['Veg', 'Non-Veg'], default: 'Non-Veg' },
        isAvailable: { type: Boolean, default: true, index: true },
        preparationTime: { type: String, trim: true, default: '' },
        approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved', index: true },
        rejectionReason: { type: String, trim: true, default: '' },
        requestedAt: { type: Date },
        approvedAt: { type: Date },
        rejectedAt: { type: Date }
    },
    {
        collection: 'food_items',
        timestamps: true
    }
);

foodSchema.index({ restaurantId: 1, createdAt: -1 });
foodSchema.index({ approvalStatus: 1, createdAt: -1 });
foodSchema.index({ approvalStatus: 1, requestedAt: -1 });
foodSchema.index({ restaurantId: 1, approvalStatus: 1, createdAt: -1 });
foodSchema.index({ approvalStatus: 1, name: 1 });
foodSchema.index({ name: 'text', description: 'text' }, { weights: { name: 10, description: 2 } });

// Keep the restaurant's cached "price for one" (median of available items) in sync
// with every create/update/delete, however it happens, instead of hooking every
// call site across admin + restaurant services.
async function syncAvgPriceForOne(restaurantId) {
    if (!restaurantId) return;
    try {
        const { recalculateAvgPriceForOne } = await import('../../restaurant/services/avgPriceForOne.service.js');
        await recalculateAvgPriceForOne(restaurantId);
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[FoodItem] avgPriceForOne recalculation failed:', err?.message || err);
    }
}

foodSchema.post('save', function (doc) {
    void syncAvgPriceForOne(doc.restaurantId);
});
foodSchema.post('findOneAndUpdate', function (doc) {
    void syncAvgPriceForOne(doc?.restaurantId || this.getQuery()?.restaurantId);
});
foodSchema.post('findOneAndDelete', function (doc) {
    void syncAvgPriceForOne(doc?.restaurantId);
});
foodSchema.post('deleteOne', { document: true, query: false }, function (doc) {
    void syncAvgPriceForOne(doc?.restaurantId);
});

export const FoodItem = mongoose.model('FoodItem', foodSchema);
