import mongoose from 'mongoose';

/**
 * BuddyIdentity is the single source of truth for "who is this person?"
 *
 * One row per phone number across the entire platform. Every user-facing
 * collection (FoodUser, TaxiUser, FoodDeliveryPartner, Driver) carries an
 * `identityId` that points back here. This collection owns:
 *   - identity essentials (phone, name, email, image)
 *   - which roles the same human can act as (USER, DRIVER, RESTAURANT, ADMIN)
 *   - driver-only onboarding data (KYC, bank, vehicle, selfie)
 *   - the canonical `activeService` mode flag used to keep food and taxi
 *     dispatch mutually exclusive
 *
 * The capability profiles (FoodUser etc.) keep their module-specific state
 * (addresses, wallet, ratings, in-flight rides/orders). They are not merged
 * here — they are linked.
 */

const ROLES = ['USER', 'DRIVER', 'RESTAURANT', 'ADMIN'];

// `off` is the canonical "not on duty" value going forward; `none` is kept in
// the enum so historical records (and any code still writing the legacy value)
// continue to validate. New writes should use `off`.
const ACTIVE_SERVICES = ['off', 'none', 'food', 'taxi'];

const kycDocSchema = new mongoose.Schema(
  {
    number: { type: String, default: '', trim: true },
    documentUrl: { type: String, default: '', trim: true },
    backDocumentUrl: { type: String, default: '', trim: true },
    uploadedAt: { type: Date, default: null },
  },
  { _id: false },
);

const bankDetailsSchema = new mongoose.Schema(
  {
    accountHolderName: { type: String, default: '', trim: true },
    accountNumber: { type: String, default: '', trim: true },
    ifscCode: { type: String, default: '', trim: true, uppercase: true },
    bankName: { type: String, default: '', trim: true },
    branchName: { type: String, default: '', trim: true },
    upiId: { type: String, default: '', trim: true },
    upiQrCodeUrl: { type: String, default: '', trim: true },
    updatedAt: { type: Date, default: null },
  },
  { _id: false },
);

const vehicleSchema = new mongoose.Schema(
  {
    type: { type: String, default: '', trim: true },
    make: { type: String, default: '', trim: true },
    model: { type: String, default: '', trim: true },
    vehicleTypeId: { type: String, default: '', trim: true },
    number: { type: String, default: '', trim: true },
    color: { type: String, default: '', trim: true },
    photoUrl: { type: String, default: '', trim: true },
    rcUrl: { type: String, default: '', trim: true },
    insuranceUrl: { type: String, default: '', trim: true },
    commercialPermitUrl: { type: String, default: '', trim: true },
    pucUrl: { type: String, default: '', trim: true },
  },
  { _id: false },
);

const serviceStatusSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['not_enabled', 'pending', 'approved', 'rejected'],
      default: 'not_enabled',
    },
    rejectionReason: { type: String, default: '', trim: true },
    rejectedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
  },
  { _id: false },
);

const buddyIdentitySchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    countryCode: {
      type: String,
      default: '+91',
      trim: true,
    },
    name: {
      type: String,
      default: '',
      trim: true,
    },
    email: {
      type: String,
      default: '',
      trim: true,
      lowercase: true,
    },
    profileImage: {
      type: String,
      default: '',
      trim: true,
    },
    gender: {
      type: String,
      enum: ['male', 'female', 'other', 'prefer-not-to-say', ''],
      default: '',
    },
    city: {
      type: String,
      default: '',
      trim: true,
    },
    state: {
      type: String,
      default: '',
      trim: true,
    },

    // A single human can hold multiple roles over time (e.g. customer who
    // later becomes a driver). The token's `role` claim picks one of these
    // per session.
    roles: {
      type: [String],
      enum: ROLES,
      default: ['USER'],
      index: true,
    },

    isVerified: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    // Driver-only fields below. Kept here so the driver only enters KYC once,
    // regardless of how many capabilities (food/taxi) they enable.
    onboardingComplete: {
      type: Boolean,
      default: false,
      index: true,
    },
    onboardingStep: {
      type: String,
      enum: [
        'services',
        'vehicle_food',
        'vehicle_taxi',
        'basics',
        'kyc',
        'bank',
        'vehicle',
        'selfie',
        'capabilities',
        'done',
      ],
      default: 'services',
    },
    onboardingServices: {
      type: [String],
      default: [],
    },
    serviceStatuses: {
      food: { type: serviceStatusSchema, default: () => ({ status: 'not_enabled' }) },
      taxi: { type: serviceStatusSchema, default: () => ({ status: 'not_enabled' }) },
    },
    kyc: {
      aadhaar: { type: kycDocSchema, default: () => ({}) },
      pan: { type: kycDocSchema, default: () => ({}) },
      drivingLicense: { type: kycDocSchema, default: () => ({}) },
    },
    bank: { type: bankDetailsSchema, default: () => ({}) },
    vehicle: { type: vehicleSchema, default: () => ({}) },
    foodVehicle: { type: vehicleSchema, default: () => ({}) },
    taxiVehicle: { type: vehicleSchema, default: () => ({}) },
    onboardingSelfieUrl: {
      type: String,
      default: '',
      trim: true,
    },

    // Drives mutual exclusion between food and taxi dispatch. A driver can
    // only be earning from one pipeline at a time. Mirror copies live on the
    // capability docs for cheap queries; this field is the source of truth.
    activeService: {
      type: String,
      enum: ACTIVE_SERVICES,
      default: 'off',
      index: true,
    },

    // Quick back-references for diagnostic queries. Capability docs still
    // carry their own `identityId` for the authoritative join.
    identityRefs: {
      foodUserId: { type: mongoose.Schema.Types.ObjectId, default: null },
      taxiUserId: { type: mongoose.Schema.Types.ObjectId, default: null },
      foodPartnerId: { type: mongoose.Schema.Types.ObjectId, default: null },
      driverId: { type: mongoose.Schema.Types.ObjectId, default: null },
    },

    // FCM stays per platform; tokens are added on login.
    fcmTokens: { type: [String], default: [] },
    fcmTokenMobile: { type: [String], default: [] },

    lastLoginAt: { type: Date, default: null },
  },
  {
    collection: 'buddy_identities',
    timestamps: true,
  },
);

buddyIdentitySchema.index({ phone: 1 }, { unique: true });

export const BUDDY_IDENTITY_ROLES = ROLES;
export const BUDDY_IDENTITY_ACTIVE_SERVICES = ACTIVE_SERVICES;

export const BuddyIdentity =
  mongoose.models.BuddyIdentity || mongoose.model('BuddyIdentity', buddyIdentitySchema);
