import mongoose from 'mongoose';
import { buildLocationSchema } from '../../../../core/location/location.schema.js';

const normalizeRatingValue = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(5, Number(numeric.toFixed(1))));
};

const deliveryPartnerSchema = new mongoose.Schema(
    {
        identityId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'BuddyIdentity',
            default: null,
            index: true,
            sparse: true
        },
        name: {
            type: String,
            required: true,
            trim: true
        },
        phone: {
            type: String,
            required: true,
            trim: true,
            unique: true
        },
        email: { type: String, trim: true },
        countryCode: {
            type: String,
            default: '+91'
        },
        address: {
            type: String
        },
        city: {
            type: String
        },
        state: {
            type: String
        },
        vehicleType: {
            type: String
        },
        vehicleName: {
            type: String
        },
        vehicleNumber: {
            type: String,
            unique: true,
            sparse: true
        },
        panNumber: {
            type: String
        },
        aadharNumber: {
            type: String
        },
        drivingLicenseNumber: {
            type: String,
            trim: true
        },
        profilePhoto: {
            type: String
        },
        fcmTokens: {
            type: [String],
            default: []
        },
        fcmTokenMobile: {
            type: [String],
            default: []
        },
        aadharPhoto: {
            type: String
        },
        panPhoto: {
            type: String
        },
        drivingLicensePhoto: {
            type: String
        },
        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected'],
            default: 'pending'
        },
        rejectionReason: { type: String },
        rejectedAt: { type: Date },
        approvedAt: { type: Date },
        bankAccountHolderName: { type: String },
        bankAccountNumber: { type: String },
        bankIfscCode: { type: String },
        bankName: { type: String },
        upiId: { type: String },
        upiQrCode: { type: String },
        imagePublicIds: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        availabilityStatus: {
            type: String,
            enum: ['online', 'offline'],
            default: 'offline'
        },
        /**
         * Socket-derived liveness, written on connect/disconnect and refreshed by the client
         * heartbeat. `availabilityStatus` alone is an explicit API toggle with no liveness
         * signal, so a partner who force-quits the app stays 'online' forever and keeps
         * absorbing offers into the void.
         *
         * Advisory only for now: dispatch DE-PRIORITISES a partner with stale presence rather
         * than excluding them, so a bug here can never starve the rider pool. Promote to a hard
         * filter once the telemetry is trusted.
         */
        presence: {
            socketConnectedAt: { type: Date },
            lastSeenAt: { type: Date },
            _id: false,
        },
        /**
         * Single source of truth for the partner's live GPS location, written
         * exclusively via saveActorLocation(). `lastLocation`/`lastLat`/`lastLng`/
         * `location` below are deprecated read-compat fields kept only until the
         * Phase 5 cleanup migration removes them - do not write to them anymore.
         */
        currentLocation: {
            type: buildLocationSchema(),
            default: undefined
        },
        lastLocationAt: { type: Date },
        // Deprecated - superseded by currentLocation. Read-only during migration window.
        lastLocation: {
            type: { type: String, enum: ['Point'] },
            coordinates: { type: [Number] }
        },
        lastLat: { type: Number },
        lastLng: { type: Number },
        referralCode: { type: String, index: true },
        referredBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodDeliveryPartner',
            default: null,
            index: true
        },
        referralCount: { type: Number, default: 0, min: 0 },
        rating: {
            type: Number,
            default: 0,
            min: 0,
            max: 5,
            set: normalizeRatingValue
        },
        totalRatings: { type: Number, default: 0, min: 0 },
        employmentType: {
            type: String,
            enum: ['per_order', 'salary', 'seller_base'],
            default: 'per_order'
        },
        salaryDuration: {
            type: String,
            enum: ['weekly', 'monthly'],
            default: 'weekly'
        },
        /** Fixed salary amount set by admin when employmentType is salary */
        salaryAmount: {
            type: Number,
            default: 0,
            min: 0
        },
        zone: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodZone',
            default: null
        },
        isVerified: {
            type: Boolean,
            default: true
        },
        // Deprecated - superseded by currentLocation. No default: an absent
        // location must never be mistaken for a real point at [0,0] (Null Island).
        location: {
            type: {
                type: String,
                enum: ["Point"],
            },
            coordinates: {
                type: [Number],
                default: undefined,
            },
        },
        submissionHistory: {
            type: [
                {
                    submittedAt: { type: Date, default: null },
                    resubmittedAt: { type: Date, default: null },
                    previousStatus: { type: String, default: '', trim: true },
                    previousRejectionReason: { type: String, default: '', trim: true },
                    status: { type: String, default: 'pending', trim: true },
                },
            ],
            default: [],
        },
    },
    {
        collection: 'buddy_deliveries',
        timestamps: true
    }
);

// Indices
deliveryPartnerSchema.index({ currentLocation: '2dsphere' });
// Deprecated indices - kept until the deprecated fields above are dropped (Phase 5).
deliveryPartnerSchema.index({ lastLocation: '2dsphere' });
deliveryPartnerSchema.index({ location: '2dsphere' });

export const FoodDeliveryPartner = mongoose.model('FoodDeliveryPartner', deliveryPartnerSchema);

