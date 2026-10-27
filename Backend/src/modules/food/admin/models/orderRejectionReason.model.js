import mongoose from 'mongoose';

/** A reason a restaurant can pick when rejecting an order. Admin-managed so the
 *  list can be reworded or extended without shipping a release. */
const orderRejectionReasonSchema = new mongoose.Schema(
    {
        title: { type: String, required: true, trim: true },
        order_by: { type: Number, default: 0 },
        active: { type: Boolean, default: true, index: true },
    },
    { collection: 'food_order_rejection_reasons', timestamps: true }
);

orderRejectionReasonSchema.index({ active: 1, order_by: 1 });

export const FoodOrderRejectionReason = mongoose.model('FoodOrderRejectionReason', orderRejectionReasonSchema);
