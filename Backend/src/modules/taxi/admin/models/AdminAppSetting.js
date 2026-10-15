import mongoose from 'mongoose';

const adminAppSettingSchema = new mongoose.Schema(
  {
    scope: {
      type: String,
      required: true,
      unique: true,
      default: 'default',
    },
    wallet_setting: { type: mongoose.Schema.Types.Mixed, default: {} },
    tip_setting: { type: mongoose.Schema.Types.Mixed, default: {} },
    country: { type: mongoose.Schema.Types.Mixed, default: {} },
    onboarding_screens: { type: [mongoose.Schema.Types.Mixed], default: [] },
    /// In-ride voice announcements (welcome + arrival), keyed by language code.
    /// Mixed on purpose: adding a language must never be a schema migration.
    ride_voice: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    minimize: false,
  },
);

export const AdminAppSetting =
  mongoose.models.TaxiAdminAppSetting || mongoose.model('TaxiAdminAppSetting', adminAppSettingSchema);
