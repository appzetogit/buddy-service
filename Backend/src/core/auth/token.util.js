import jwt from 'jsonwebtoken';
import { config } from '../../config/env.js';

export const signAccessToken = (payload) => {
    return jwt.sign(payload, config.jwtAccessSecret, {
        expiresIn: config.jwtAccessExpiresIn
    });
};

export const signRefreshToken = (payload) => {
    return jwt.sign(payload, config.jwtRefreshSecret, {
        expiresIn: config.jwtRefreshExpiresIn
    });
};

export const verifyAccessToken = (token) => {
    return jwt.verify(token, config.jwtAccessSecret);
};

export const verifyRefreshToken = (token) => {
    return jwt.verify(token, config.jwtRefreshSecret);
};

const SELLER_REGISTRATION_PURPOSE = 'seller_onboarding';

/** Short-lived token for a Quick Commerce seller mid-registration (before an account exists). */
export const verifySellerRegistrationToken = (token) => {
    const decoded = jwt.verify(token, config.jwtAccessSecret);
    if (decoded?.purpose !== SELLER_REGISTRATION_PURPOSE) {
        const err = new Error('Invalid seller registration token');
        err.name = 'JsonWebTokenError';
        throw err;
    }
    return decoded;
};

export const signSellerRegistrationToken = (phone) => {
    const digits = String(phone || '').replace(/\D/g, '');
    return jwt.sign(
        {
            purpose: SELLER_REGISTRATION_PURPOSE,
            phone: digits,
            phoneLast10: digits.slice(-10),
            role: 'SELLER',
        },
        config.jwtAccessSecret,
        { expiresIn: '2h' },
    );
};

