import mongoose from 'mongoose';

/**
 * A time window during which every vehicle's fare is multiplied — the Ola/Uber
 * style surge.
 *
 * Times are stored as "HH:MM" wall-clock strings plus the timezone they are
 * written in, NOT as UTC. The server runs UTC, so an admin entering 13:00 from
 * India means 07:30 UTC; storing the wall-clock value and converting at read
 * time keeps the admin panel showing what was typed and survives the box being
 * moved to another region.
 */
const priceHikeSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      default: '',
      trim: true,
    },
    // 0 = Sunday .. 6 = Saturday. Empty means every day.
    days: {
      type: [Number],
      default: [],
    },
    startTime: {
      type: String,
      default: '00:00',
      trim: true,
    },
    endTime: {
      type: String,
      default: '00:00',
      trim: true,
    },
    timezone: {
      type: String,
      default: 'Asia/Kolkata',
      trim: true,
    },
    // 1.5 = fares shown at 150%. Stored as a multiplier rather than a percent
    // so the fare maths is a single multiply with no unit ambiguity.
    multiplier: {
      type: Number,
      default: 1,
      min: 1,
    },
    active: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

priceHikeSchema.index({ active: 1 });

export const PriceHike =
  mongoose.models.TaxiPriceHike || mongoose.model('TaxiPriceHike', priceHikeSchema);
