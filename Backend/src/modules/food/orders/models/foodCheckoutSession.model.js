import mongoose from 'mongoose';

/**
 * Holds a validated cart + server pricing before FoodOrder exists.
 * Used for prepaid (Razorpay): pay first → then create order.
 */
const foodCheckoutSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FoodUser',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending_payment', 'paid', 'finalizing', 'completed', 'expired', 'failed', 'cancelled'],
      default: 'pending_payment',
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: ['razorpay'],
      default: 'razorpay',
    },
    /** Why the session ended in 'failed' — set from the payment.failed webhook. */
    failureReason: { type: String, default: null },
    /** Full create-order DTO snapshot (items, address, notes, delivery options, etc.) */
    orderPayload: { type: mongoose.Schema.Types.Mixed, required: true },
    /** Server-recalculated pricing (source of truth for amount charged) */
    pricing: { type: mongoose.Schema.Types.Mixed, required: true },
    amountDue: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    razorpay: {
      // Indexed via schema.index below (sparse) — avoid duplicate index:true here.
      orderId: { type: String, default: '' },
      paymentId: { type: String, default: '' },
      signature: { type: String, default: '' },
      amountPaise: { type: Number, default: 0 },
    },
    foodOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FoodOrder',
      default: null,
      index: true,
    },
    expiresAt: { type: Date, required: true, index: true },
    paidAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { collection: 'food_checkout_sessions', timestamps: true },
);

foodCheckoutSessionSchema.index({ 'razorpay.orderId': 1 }, { sparse: true });
foodCheckoutSessionSchema.index({ userId: 1, status: 1, createdAt: -1 });

export const FoodCheckoutSession = mongoose.model(
  'FoodCheckoutSession',
  foodCheckoutSessionSchema,
);
