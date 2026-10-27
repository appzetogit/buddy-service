import mongoose from 'mongoose';

const offerBannerSchema = new mongoose.Schema(
    {
        imageUrl: { type: String, required: true, trim: true },
        title: { type: String, trim: true, default: '' },
        ctaLink: { type: String, trim: true, default: '' },
        zoneIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FoodZone' }],
        isActive: { type: Boolean, default: true, index: true },
        sortOrder: { type: Number, default: 0 },
        startAt: { type: Date, default: null },
        endAt: { type: Date, default: null },
    },
    { collection: 'food_offer_banners', timestamps: true }
);

offerBannerSchema.index({ isActive: 1, sortOrder: 1 });

export const FoodOfferBanner = mongoose.model('FoodOfferBanner', offerBannerSchema);
