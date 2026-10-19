import mongoose from 'mongoose';

/**
 * A time window during which a flat extra charge is added to the customer's
 * delivery fee — lunch rush, evening peak, festival days, etc. Mirrors
 * Taxi's PriceHike (see priceHikeService.js) but adds a flat ₹ amount
 * instead of multiplying the fare, and the whole charge is kept by the
 * platform (no rider split), per product decision.
 *
 * Two mutually exclusive modes:
 *  - "recurring" (default): repeats on the given days of week (empty = every
 *    day), every day within startTime–endTime.
 *  - "dates": a one-off window for a fixed calendar range (a festival),
 *    active every day from startDate to startDate+endDate inclusive,
 *    within startTime–endTime each of those days. `days` is ignored.
 *
 * Times are stored as "HH:MM" wall-clock strings and dates as "YYYY-MM-DD",
 * plus the timezone they were entered in, not as UTC, so the admin panel
 * always shows what was typed regardless of where the server runs.
 */
const peakHourRuleSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: '' },
    dateMode: { type: String, enum: ['recurring', 'dates'], default: 'recurring' },
    // 0 = Sunday .. 6 = Saturday. Empty means every day. Ignored when dateMode is "dates".
    days: { type: [Number], default: [] },
    // "YYYY-MM-DD", inclusive. Only used when dateMode is "dates".
    startDate: { type: String, default: null, trim: true },
    endDate: { type: String, default: null, trim: true },
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
