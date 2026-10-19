import mongoose from 'mongoose';

/**
 * A recurring time window during which a flat extra charge is added to the
 * customer's delivery fee — lunch rush, evening peak, festival days, etc.
 * Mirrors Taxi's PriceHike (see priceHikeService.js) but adds a flat ₹
 * amount instead of multiplying the fare, and the whole charge is kept by
 * the platform (no rider split), per product decision.
 *
 * Times are stored as "HH:MM" wall-clock strings plus the timezone they were
 * entered in, not as UTC, so the admin panel always shows what was typed.
 */
const peakHourRuleSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: '' },
    // 0 = Sunday .. 6 = Saturday. Empty means every day.
    days: { type: [Number], default: [] },
    startTime: { type: String, default: '00:00', trim: true },
    endTime: { type: String, default: '00:00', trim: true },
    timezone: { type: String, default: 'Asia/Kolkata', trim: true },
    charge: { type: Number, default: 0, min: 0 },
    status: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0, min: 0 },
  },
  { collection: 'food_peak_hour_rules', timestamps: true },
);

peakHourRuleSchema.index({ status: 1, createdAt: -1 });

export const FoodPeakHourRule = mongoose.model('FoodPeakHourRule', peakHourRuleSchema);
