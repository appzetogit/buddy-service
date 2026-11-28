import mongoose from 'mongoose';

/**
 * One customer rating of one item (a Food dish or a Marketplace product) from one delivered order.
 * The dish/product average, and through it the restaurant / seller average, is built from these.
 * (orderId + itemType + itemId) is unique, so an item can be rated once per order.
 */
const orderItemReviewSchema = new mongoose.Schema(
  {
    orderKind: { type: String, enum: ['food', 'quick'], required: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    orderRef: { type: String, default: '' },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    userName: { type: String, default: '' },
    itemType: { type: String, enum: ['food', 'quick'], required: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    itemName: { type: String, default: '' },
    itemImage: { type: String, default: '' },
    ownerType: { type: String, enum: ['restaurant', 'seller'], required: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    comment: { type: String, default: '', trim: true, maxlength: 500 },
  },
  { timestamps: true, collection: 'order_item_reviews' },
);

orderItemReviewSchema.index({ orderId: 1, itemType: 1, itemId: 1 }, { unique: true });
orderItemReviewSchema.index({ ownerType: 1, ownerId: 1, createdAt: -1 });

export const OrderItemReview =
  mongoose.models.OrderItemReview || mongoose.model('OrderItemReview', orderItemReviewSchema);
