import mongoose from 'mongoose';

/**
 * One row of the app home screen, managed from the admin panel.
 *   hero_banner   - top carousel (many allowed)
 *   service_card  - the "Choose a service" cards (Quick Commerce / Food / Taxi ...)
 *   feature       - the small icon + text options at the bottom (Live Offers, Secure Payments ...)
 */
export const HOME_SECTIONS = ['hero_banner', 'service_card', 'feature'];
export const HOME_LINK_TYPES = ['none', 'service', 'url'];
// What a linkType 'service' may point to; the apps map these keys to their own screens.
export const HOME_SERVICE_KEYS = ['quick_commerce', 'food', 'taxi', 'parcel'];

const homeItemSchema = new mongoose.Schema(
    {
        section: { type: String, enum: HOME_SECTIONS, required: true, index: true },
        title: { type: String, trim: true, default: '' },
        subtitle: { type: String, trim: true, default: '' },
        imageUrl: { type: String, default: '' },
        publicId: { type: String, default: '' },
        /** Optional icon name the app maps to a built-in icon (used by `feature` when no image is uploaded). */
        iconKey: { type: String, trim: true, default: '' },
        linkType: { type: String, enum: HOME_LINK_TYPES, default: 'none' },
        linkValue: { type: String, trim: true, default: '' },
        sortOrder: { type: Number, default: 0 },
        isActive: { type: Boolean, default: true },
    },
    { collection: 'home_items', timestamps: true }
);

homeItemSchema.index({ section: 1, isActive: 1, sortOrder: 1 });

export const HomeItem = mongoose.models.HomeItem || mongoose.model('HomeItem', homeItemSchema);
