import mongoose from 'mongoose';

/**
 * A COD booking waiting for its advance. The ride is NOT created (and no driver is searched for) until
 * the advance is paid and verified; this row only remembers the booking request and what was charged.
 */
const codCheckoutSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiUser', required: true, index: true },
    status: { type: String, enum: ['pending', 'finalizing', 'completed', 'expired'], default: 'pending', index: true },
    kind: { type: String, enum: ['ride', 'delivery'], default: 'ride' }, // a ride or a parcel delivery
    payload: { type: mongoose.Schema.Types.Mixed, required: true }, // the booking request body
    response: { type: mongoose.Schema.Types.Mixed, default: null }, // what a parcel booking returned, replayed on a retried verify
    percent: { type: Number, required: true },
    advanceAmount: { type: Number, required: true },
    walletAmount: { type: Number, default: 0 },
    onlineAmount: { type: Number, required: true },
    razorpayOrderId: { type: String, default: '', index: true },
    rideId: { type: mongoose.Schema.Types.ObjectId, default: null },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'taxi_cod_checkouts', timestamps: true },
);

export const CodCheckout = mongoose.models.TaxiCodCheckout || mongoose.model('TaxiCodCheckout', codCheckoutSchema);
