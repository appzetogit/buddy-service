import mongoose from 'mongoose';

/**
 * Holds a validated Quick Commerce checkout before the QuickOrder exists.
 * Used for online (Razorpay) payments: pay first, then the order is created - the same
 * pay-then-place flow Food uses with FoodCheckoutSession.
 */
const quickCheckoutSessionSchema = new mongoose.Schema(
  {
    kind: { type: String, default: 'quick', index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodUser', default: null, index: true },
    /** Guest checkout identity (x-quick-session) when there is no logged-in user. */
    sessionId: { type: String, default: '', index: true },
    status: {
      type: String,
      enum: ['pending_payment', 'paid', 'finalizing', 'completed', 'expired', 'failed', 'cancelled'],
      default: 'pending_payment',
      index: true,
    },
    failureReason: { type: String, default: null },
    /** The place-order request body, replayed once payment is verified. */
    requestBody: { type: mongoose.Schema.Types.Mixed, required: true },
    /** Server-calculated total the customer was asked to pay (source of truth for the charge). */
    amountDue: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    razorpay: {
      orderId: { type: String, default: '' },
      paymentId: { type: String, default: '' },
      signature: { type: String, default: '' },
      amountPaise: { type: Number, default: 0 },
    },
    quickOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'QuickOrder', default: null, index: true },
    expiresAt: { type: Date, required: true, index: true },
    paidAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  // Stored in Food's checkout-session collection (database collection limit reached); `kind` tells them apart.
  { collection: 'food_checkout_sessions', timestamps: true },
);

quickCheckoutSessionSchema.index({ 'razorpay.orderId': 1 }, { sparse: true });

export const QuickCheckoutSession = mongoose.model('QuickCheckoutSession', quickCheckoutSessionSchema);
