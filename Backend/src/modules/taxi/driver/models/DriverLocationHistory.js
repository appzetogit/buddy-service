import mongoose from 'mongoose';

// One row per throttled location write (same cadence as Driver.location
// itself — see DRIVER_LOCATION_WRITE_MIN_DISTANCE_METERS/MAX_INTERVAL_MS in
// socket/index.js), kept for analytics (driver activity, route replay,
// dispatch tuning). TTL-expired automatically after 30 days so this never
// needs manual pruning or grows the database unbounded.
const driverLocationHistorySchema = new mongoose.Schema(
  {
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiDriver',
      required: true,
      index: true,
    },
    rideId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiRide',
      default: null,
      index: true,
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
    heading: {
      type: Number,
      default: null,
    },
    speed: {
      type: Number,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 60 * 60 * 24 * 30,
    },
  },
  { versionKey: false },
);

driverLocationHistorySchema.index({ driverId: 1, createdAt: -1 });

export const DriverLocationHistory =
  mongoose.models.TaxiDriverLocationHistory ||
  mongoose.model('TaxiDriverLocationHistory', driverLocationHistorySchema);
