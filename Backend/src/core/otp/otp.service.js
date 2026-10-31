import crypto from 'crypto';
import ms from 'ms';
import { FoodOtp } from './otp.model.js';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { ValidationError } from '../auth/errors.js';
import { sendWhatsappOtp } from '../../utils/whatsapp.js';

const generateOtpCode = () => {
    const code = crypto.randomInt(1000, 9999);
    return String(code);
};

export const createOrUpdateOtp = async (phone) => {
    const existing = await FoodOtp.findOne({ phone });
    const now = new Date();

    // Rate Limiting Logic
    if (existing) {
        const windowMs = (config.otpRateWindow || 600) * 1000;
        const isInWindow = now - existing.lastRequestAt < windowMs;

        if (isInWindow) {
            if (existing.requestCount >= (config.otpRateLimit || 3)) {
                logger.warn(`Rate limit exceeded for phone ${phone}`);
                throw new ValidationError(`Too many OTP requests. Please try again after ${Math.ceil(windowMs / 60000)} minutes.`);
            }
            existing.requestCount += 1;
        } else {
            // Reset count if window has passed
            existing.requestCount = 1;
        }
    }

    let otp;
    if (config.useDefaultOtp) {
        otp = '1234';
        logger.info(`Default OTP mode enabled – OTP is ${otp} for phone ${phone}`);
    } else {
        otp = generateOtpCode();
    }

    // Expiry calculation: prioritize seconds, then minutes, then fallback to MS string
    let ttlMs;
    if (config.otpExpirySeconds) {
        ttlMs = config.otpExpirySeconds * 1000;
    } else if (config.otpExpiryMinutes) {
        ttlMs = config.otpExpiryMinutes * 60 * 1000;
    } else {
        ttlMs = ms(config.otpExpiry || '5m');
    }
    const expiresAt = new Date(now.getTime() + ttlMs);

    if (existing) {
        existing.otp = otp;
        existing.expiresAt = expiresAt;
        existing.attempts = 0;
        existing.lastRequestAt = now;
        await existing.save();
    } else {
        await FoodOtp.create({
            phone,
            otp,
            expiresAt,
            requestCount: 1,
            lastRequestAt: now
        });
    }

    // USE_DEFAULT_OTP=true -> fixed 1234, nothing sent. Otherwise the OTP goes out on WhatsApp.
    // Failure is logged, not thrown: the OTP is already stored and the user can resend.
    if (!config.useDefaultOtp) {
        await sendWhatsappOtp(phone, otp);
    }

    return otp;
};

export const verifyOtp = async (phone, otp, { consume = true } = {}) => {
    const record = await FoodOtp.findOne({ phone });
    if (!record) {
        return { valid: false, reason: 'OTP not found' };
    }

    if (record.expiresAt < new Date()) {
        return { valid: false, reason: 'OTP expired' };
    }

    if (record.attempts >= config.otpMaxAttempts) {
        return { valid: false, reason: 'Max attempts exceeded' };
    }

    record.attempts += 1;

    if (record.otp !== otp) {
        await record.save();
        return { valid: false, reason: 'Invalid OTP' };
    }

    if (consume) {
        await record.deleteOne();
    }

    return { valid: true, record };
};

export const consumeOtp = async (phone) => {
    await FoodOtp.deleteOne({ phone });
};

