import mongoose from 'mongoose';

/**
 * Gigs: admin-made working slots a rider books in advance. Shared by Food, Marketplace (quickCommerce)
 * and Taxi - a slot lists which services it covers. A booked rider only receives jobs of those
 * services inside the booked hour(s), and earns an extra amount (set per hour) on each of them.
 * Times are minutes since midnight, India time (UTC+5:30), same as the dates ("YYYY-MM-DD").
 */
export const GIG_SERVICES = ['food', 'quickCommerce', 'taxi'];

const timeSlotSchema = new mongoose.Schema(
  {
    startMin: { type: Number, required: true, min: 0, max: 1439 },
    endMin: { type: Number, required: true, min: 1, max: 1440 },
    /** Extra rupees the rider earns on every order delivered inside this hour (paid from admin earnings). */
    extraPerOrder: { type: Number, required: true, min: 0, default: 0 },
    /** How many riders may book this hour. */
    maxDrivers: { type: Number, required: true, min: 1, default: 10 },
  },
  { _id: true },
);

const gigSlotSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    services: { type: [{ type: String, enum: GIG_SERVICES }], validate: (v) => v.length > 0 },
    /** 0 = Sunday ... 6 = Saturday */
    days: { type: [{ type: Number, min: 0, max: 6 }], validate: (v) => v.length > 0 },
    timeSlots: { type: [timeSlotSchema], validate: (v) => v.length > 0 },
    isActive: { type: Boolean, default: true },
    createdByAdminId: { type: mongoose.Schema.Types.ObjectId },
  },
  { collection: 'gig_slots', timestamps: true },
);

const gigBookingSchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    slotId: { type: mongoose.Schema.Types.ObjectId, ref: 'GigSlot', required: true },
    timeSlotId: { type: mongoose.Schema.Types.ObjectId, required: true },
    date: { type: String, required: true, index: true }, // YYYY-MM-DD (IST)
    // Snapshots, so later edits of the slot never change what a rider booked or earns.
    slotName: { type: String, default: '' },
    services: { type: [String], default: [] },
    startMin: { type: Number, required: true },
    endMin: { type: Number, required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    extraPerOrder: { type: Number, default: 0 },
    status: { type: String, enum: ['booked', 'cancelled'], default: 'booked', index: true },
    ordersCount: { type: Number, default: 0 },
    extraEarned: { type: Number, default: 0 },
  },
  { collection: 'gig_bookings', timestamps: true },
);
// One rider cannot book the same hour twice; cancelled rows do not block a re-booking.
gigBookingSchema.index(
  { partnerId: 1, timeSlotId: 1, date: 1 },
  { unique: true, partialFilterExpression: { status: 'booked' } },
);
gigBookingSchema.index({ timeSlotId: 1, date: 1, status: 1 });

/** One row per order that paid a gig extra; the unique key makes the credit idempotent. */
const gigEarningSchema = new mongoose.Schema(
  {
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'GigBooking', required: true, index: true },
    partnerId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    service: { type: String, enum: GIG_SERVICES, required: true },
    orderRef: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    slotName: { type: String, default: '' },
    date: { type: String, default: '' },
  },
  { collection: 'gig_earnings', timestamps: true },
);
gigEarningSchema.index({ service: 1, orderRef: 1 }, { unique: true });

export const GigSlot = mongoose.models.GigSlot || mongoose.model('GigSlot', gigSlotSchema);
export const GigBooking = mongoose.models.GigBooking || mongoose.model('GigBooking', gigBookingSchema);
export const GigEarning = mongoose.models.GigEarning || mongoose.model('GigEarning', gigEarningSchema);
