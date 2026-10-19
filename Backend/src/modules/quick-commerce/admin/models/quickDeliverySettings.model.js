import mongoose from 'mongoose';

/**
 * Quick Commerce delivery / dispatch settings, edited from the QC admin panel.
 *
 * Food keeps the equivalent knobs on `FoodDeliveryBoySettings` (speed options, split threshold,
 * multi-restaurant) and in code constants (dispatch rounds, restaurant-ack timers). QC gets its own
 * document so the two verticals can be tuned independently; nothing here is read by Food.
 */
const deliverySpeedOptionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    badge: { type: String, default: '', trim: true },
    badgeColor: { type: String, default: 'bg-slate-100 text-slate-700 border border-slate-200' },
    time: { type: String, default: '', trim: true },
    estimatedTime: { type: Number, default: 30, min: 1 },
    feeModifier: { type: Number, default: 0 },
    /** Of a positive feeModifier, how much goes to the rider; admin keeps the rest. */
    driverShareAmount: { type: Number, default: 0, min: 0 },
    description: { type: String, default: '', trim: true },
    icon: { type: String, enum: ['bike', 'leaf', 'zap', 'truck', 'clock'], default: 'bike' },
    isEnabled: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

/**
 * A time window during which a flat extra charge is added to the customer's
 * delivery fee — mirrors Food's FoodPeakHourRule (and Taxi's PriceHike)
 * adapted to a flat ₹ amount. Kept entirely by the platform, not split with
 * the rider. See `resolveActiveQuickPeakHourSurcharge` for the match logic.
 *
 * "recurring" repeats on the given days of week (empty = every day); "dates"
 * applies only within a fixed calendar range (a festival) and ignores days.
 */
const peakHourRuleSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: '' },
    dateMode: { type: String, enum: ['recurring', 'dates'], default: 'recurring' },
    days: { type: [Number], default: [] },
    startDate: { type: String, default: null, trim: true },
    endDate: { type: String, default: null, trim: true },
    startTime: { type: String, default: '00:00', trim: true },
    endTime: { type: String, default: '00:00', trim: true },
    timezone: { type: String, default: 'Asia/Kolkata', trim: true },
    charge: { type: Number, default: 0, min: 0 },
    status: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0, min: 0 },
  },
  { _id: true },
);

const quickDeliverySettingsSchema = new mongoose.Schema(
  {
    // ---- Payments ----
    /** Food has Cash on Delivery switched off; QC follows unless an admin turns it back on here. */
    codEnabled: { type: Boolean, default: false },

    // ---- Rider hunt ----
    offerTimeoutSec: { type: Number, default: 60, min: 15, max: 180 },
    /** Hunt round from which the offer goes to every eligible rider instead of the 3 nearest. */
    broadcastFromAttempt: { type: Number, default: 3, min: 1, max: 10 },
    adminAlertFromAttempt: { type: Number, default: 6, min: 1, max: 20 },
    maxDispatchAttempts: { type: Number, default: 10, min: 1, max: 30 },
    /** An order with no rider after this long is cancelled and refunded. */
    noRiderCancelMinutes: { type: Number, default: 8, min: 1, max: 120 },

    // ---- Store (seller) response after a rider accepted ----
    sellerAckResendMinutes: { type: Number, default: 2, min: 1, max: 30 },
    sellerAckTimeoutMinutes: { type: Number, default: 5, min: 2, max: 60 },

    // ---- Scheduled orders ----
    scheduleEnabled: { type: Boolean, default: true },
    /** The order goes live (rider hunt starts) this many minutes before the slot. */
    scheduleLeadMinutes: { type: Number, default: 30, min: 5, max: 240 },
    scheduleMinAheadMinutes: { type: Number, default: 20, min: 5, max: 240 },
    scheduleMaxDays: { type: Number, default: 7, min: 1, max: 30 },

    // ---- Sharing a bulky order between two riders ----
    splitOrderEnabled: { type: Boolean, default: true },
    splitOrderThreshold: { type: Number, default: 20, min: 1 },
    /** How long the primary rider waits for a second rider before finishing alone. */
    shareTimeoutMinutes: { type: Number, default: 5, min: 1, max: 60 },

    // ---- Several stores in one order (off by default: QC has always been one store per order) ----
    multiOrderEnabled: { type: Boolean, default: false },
    multiOrderMaxDistance: { type: Number, default: 5, min: 1, max: 10 },
    multiOrderAdditionalCharge: { type: Number, default: 0, min: 0 },
    maxSellersPerOrder: { type: Number, default: 2, min: 2, max: 3 },

    // ---- Cart delivery speed ----
    deliverySpeedOptions: { type: [deliverySpeedOptionSchema], default: [] },

    // ---- Peak hour / festival surcharges ----
    peakHourRules: { type: [peakHourRuleSchema], default: [] },

    isActive: { type: Boolean, default: true },
  },
  // Shares the existing `quick_fee_settings` document (the database is at its collection limit, so no new
  // collection can be created). Each model only reads and writes its own fields of that document.
  { collection: 'quick_fee_settings', timestamps: true },
);

export const QuickDeliverySettings = mongoose.model('QuickDeliverySettings', quickDeliverySettingsSchema);
