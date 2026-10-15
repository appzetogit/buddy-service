import mongoose from 'mongoose';

const subscriptionPlanSchema = new mongoose.Schema({
  audience: {
    type: String,
    enum: ['driver', 'user'],
    default: 'driver',
    index: true,
  },
  name: String,
  description: String,
  amount: Number,
  duration: Number, // in days
  transport_type: String,
  vehicle_type_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiVehicle' },
  // Driver plans are priced per class of vehicle rather than per catalog
  // entry - one ₹29 pass for bike and auto, one ₹49 pass for cars - so a new
  // vehicle type does not need its own plan on the day it is added.
  vehicle_classes: { type: [String], default: [] },
  benefit_type: {
    type: String,
    enum: ['standard', 'limited', 'unlimited'],
    default: 'standard',
  },
  ride_limit: {
    type: Number,
    default: 0,
    min: 0,
  },
  how_it_works: String,
  active: { type: Boolean, default: true }
}, { timestamps: true });

export const SubscriptionPlan = mongoose.models.TaxiSubscriptionPlan || mongoose.model('TaxiSubscriptionPlan', subscriptionPlanSchema);
