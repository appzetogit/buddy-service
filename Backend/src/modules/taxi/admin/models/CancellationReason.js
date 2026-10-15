import mongoose from 'mongoose';

/// A reason offered to the rider (or driver) when they cancel a trip.
///
/// Managed from the admin panel rather than hardcoded in the apps, so the list
/// can be reworded or extended without shipping a release.
const cancellationReasonSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    /// Who is shown this reason. Riders and drivers cancel for different
    /// reasons, so one catalog serves both without them bleeding into each
    /// other.
    audience: {
      type: String,
      enum: ['user', 'driver'],
      default: 'user',
      trim: true,
      index: true,
    },
    /// Set for the catch-all entry ("Other"), which asks the person to type
    /// something instead of just recording the label.
    requiresNote: {
      type: Boolean,
      default: false,
    },
    order_by: {
      type: Number,
      default: 0,
    },
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true },
);

cancellationReasonSchema.index({ audience: 1, active: 1, order_by: 1 });

export const CancellationReason =
  mongoose.models.TaxiCancellationReason ||
  mongoose.model('TaxiCancellationReason', cancellationReasonSchema);
