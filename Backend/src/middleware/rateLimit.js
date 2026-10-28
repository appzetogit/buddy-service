import rateLimit from 'express-rate-limit';
import { config } from '../config/env.js';

const windowMs = config.rateLimitWindowMinutes * 60 * 1000;

export const apiRateLimiter = rateLimit({
    windowMs,
    // Dev UX: local UI can generate lots of background API calls (location, polling, etc).
    // Keep production strict, but avoid blocking local development.
    max: config.nodeEnv === 'development' ? Math.max(config.rateLimitMaxRequests, 2000) : config.rateLimitMaxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    /**
     * Never rate-limit payment webhooks.
     *
     * They arrive from the gateway's IPs, not a user, so a burst (or the gateway's own retries)
     * shares one bucket and can trip the limit. A 429 is a non-2xx, so the gateway treats it as
     * a delivery failure — meaning the requests we drop are exactly the payment.captured events
     * we cannot afford to lose. Signature verification, not rate limiting, is what protects
     * this endpoint.
     */
    skip: (req) => {
        const url = req.originalUrl || req.url || '';
        if (url.includes('/payments/webhook/')) return true;
        // /admin/* routes use their own, separately-bucketed adminApiRateLimiter (see below),
        // mounted ahead of this one in app.js — never double-count them against the public bucket.
        return /\/admin(\/|$)/.test(url);
    },
    message: {
        success: false,
        message: 'Too many requests, please try again later.'
    }
});

/**
 * Separate, higher-ceiling bucket for /admin routes (Food, Quick Commerce, Taxi).
 *
 * The office IP running the admin panels was sharing apiRateLimiter's single public-traffic
 * bucket with every customer/rider/restaurant request from that IP, and three dashboards
 * (each auto-polling on its own interval) burn through it in a couple of minutes — seen live
 * as repeated 429s on /taxi/admin/dashboard/data. Still bounded and still per-IP, just sized
 * for "a handful of staff, each with a few panels open" instead of public traffic.
 */
export const adminApiRateLimiter = rateLimit({
    windowMs,
    max: config.nodeEnv === 'development' ? 5000 : Math.max(config.rateLimitMaxRequests * 10, 2000),
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many requests, please try again later.'
    }
});

const authWindowMs = config.authRateLimitWindowMinutes * 60 * 1000;

/** Stricter rate limit for auth routes (OTP, login, refresh, logout). Applied in addition to global limiter. */
export const authRateLimiter = rateLimit({
    windowMs: authWindowMs,
    // Dev UX: login/otp testing can be frequent. Keep production strict (e.g. 30), 
    // but relax local development to avoid 429 when testing flows.
    max: config.nodeEnv === 'development' ? Math.max(config.authRateLimitMax, 100) : config.authRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many authentication attempts. Please try again later.'
    }
});


const phoneOrIpKey = (req) => {
    const phone = String(req.body?.phone || '').replace(/\D/g, '').slice(-10);
    return phone ? `phone:${phone}` : `ip:${req.ip}`;
};

/** Caps OTP sends per phone number, so rotating IPs cannot inflate SMS spend. */
export const otpRequestRateLimiter = rateLimit({
    windowMs: config.otpRateWindow * 1000,
    max: config.nodeEnv === 'development' ? Math.max(config.otpRateLimit, 50) : config.otpRateLimit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: phoneOrIpKey,
    message: { success: false, message: 'Too many OTP requests for this number. Please try again later.' }
});

/** Caps failed OTP verifications per phone number; successful attempts are not counted. */
export const otpVerifyRateLimiter = rateLimit({
    windowMs: authWindowMs,
    max: config.nodeEnv === 'development' ? Math.max(config.authRateLimitMax, 100) : config.authRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: phoneOrIpKey,
    message: { success: false, message: 'Too many failed attempts. Please request a new code.' }
});

/** Stricter limit for the Google Maps distance proxy. */
export const mapsRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: config.nodeEnv === 'development' ? 300 : Number(process.env.MAPS_RATE_LIMIT_MAX || 60),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip,
    message: { success: false, message: 'Too many map distance requests. Please try again later.' }
});
