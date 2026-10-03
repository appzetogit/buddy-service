import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { config } from '../../config/env.js';

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$/;

const adminSchema = new mongoose.Schema(
    {
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },
        password: {
            type: String,
            required: true,
            select: false,
        },
        name: { type: String, trim: true, default: '' },
        phone: { type: String, trim: true, default: '' },
        profileImage: { type: String, trim: true, default: '' },
        fcmTokens: {
            type: [String],
            default: [],
        },
        fcmTokenMobile: {
            type: [String],
            default: [],
        },
        role: {
            type: String,
            default: 'ADMIN',
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        servicesAccess: {
            type: [String],
            default: ['food'],
        },
        admin_type: {
            type: String,
            enum: ['superadmin', 'subadmin'],
            default: 'superadmin',
            trim: true,
        },
        permissions: {
            type: [String],
            default: [],
        },
        service_location_ids: {
            type: [
                {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'TaxiServiceLocation',
                },
            ],
            default: [],
        },
        zone_ids: {
            type: [
                {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'TaxiZone',
                },
            ],
            default: [],
        },
        active: {
            type: Boolean,
            default: true,
        },
        status: {
            type: String,
            enum: ['active', 'inactive'],
            default: 'active',
            trim: true,
        },
        resetPasswordOtp: {
            type: String,
            select: false,
        },
        resetPasswordExpires: {
            type: Date,
            select: false,
        },
        isVerified: {
            type: Boolean,
            default: true,
        },
        lastLogin: Date,
    },
    {
        collection: 'admins',
        timestamps: true,
    },
);

adminSchema.index({ servicesAccess: 1 });
adminSchema.index({ admin_type: 1, active: 1 });

adminSchema.pre('save', async function (next) {
    if (!this.isModified('password')) {
        return next();
    }

    if (BCRYPT_HASH_PATTERN.test(this.password || '')) {
        return next();
    }

    const salt = await bcrypt.genSalt(config.bcryptSaltRounds);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

adminSchema.methods.comparePassword = function (candidatePassword) {
    if (!this.password) return Promise.resolve(false);
    if (BCRYPT_HASH_PATTERN.test(this.password)) {
        return bcrypt.compare(candidatePassword, this.password);
    }
    return Promise.resolve(this.password === candidatePassword);
};

export const Admin = mongoose.models.Admin || mongoose.model('Admin', adminSchema);

export const FoodAdmin =
    mongoose.models.FoodAdmin || mongoose.model('FoodAdmin', adminSchema, 'admins');

export const TaxiAdmin =
    mongoose.models.TaxiAdmin || mongoose.model('TaxiAdmin', adminSchema, 'admins');
