import mongoose from 'mongoose';

/**
 * Settings for automatic, demand-driven surge, edited on the admin's Price Hike
 * page. One document per vehicle type that has its own settings
 * (key "vehicle:<id>"), plus the "default" one every other vehicle follows.
 * The hexagon size (`resolution`) is read from "default" only: every vehicle
 * shares one map.
 *
 * The city is cut into H3 hexagons. Each minute every hexagon compares the
 * riders asking for a price in and around it against the free drivers in and
 * around it, and that ratio sets its multiplier. See surgeService for how the
 * fields below are used.
 */
const surgeSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: 'default',
      unique: true,
    },
    // The vehicle type these settings are for; null on "default".
    vehicle_type_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    enabled: {
      type: Boolean,
      default: false,
    },
    // H3 resolution: 7 is ~5 km2 per hexagon, 8 ~0.7 km2, 9 ~0.1 km2.
    resolution: {
      type: Number,
      default: 8,
      min: 7,
      max: 9,
    },
    // How far back demand is counted.
    window_minutes: {
      type: Number,
      default: 10,
      min: 2,
      max: 60,
    },
    // Fewest distinct riders (hexagon plus its neighbours) before a surge can
    // start at all. Keeps one or two riders from surging an area on their own.
    min_demand: {
      type: Number,
      default: 3,
      min: 1,
    },
    // Riders per free driver at which surge begins.
    trigger_ratio: {
      type: Number,
      default: 1.5,
      min: 0.5,
    },
    // Each further `ratio_step` of riders per driver adds `step` to the
    // multiplier, e.g. 0.05 per 0.5.
    ratio_step: {
      type: Number,
      default: 0.5,
      min: 0.1,
    },
    step: {
      type: Number,
      default: 0.05,
      min: 0.01,
      max: 0.5,
    },
    // Ceiling. The Motor Vehicle Aggregator Guidelines 2025 allow up to 2x the
    // base fare; some states set less.
    max_multiplier: {
      type: Number,
      default: 1.5,
      min: 1,
      max: 2,
    },
    // How long a surge holds once set, so the price does not flicker and the
    // driver map can say when it ends.
    hold_minutes: {
      type: Number,
      default: 10,
      min: 1,
      max: 60,
    },
  },
  { timestamps: true },
);

export const SurgeSetting =
  mongoose.models.TaxiSurgeSetting || mongoose.model('TaxiSurgeSetting', surgeSettingSchema);
