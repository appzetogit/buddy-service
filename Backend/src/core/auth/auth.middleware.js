import { verifyAccessToken, verifySellerRegistrationToken } from './token.util.js';
import { sendError } from '../../utils/response.js';
import { FoodUser } from '../users/user.model.js';
import { FoodRestaurant } from '../../modules/food/restaurant/models/restaurant.model.js';
import { isRestaurantBanned } from '../../modules/food/restaurant/utils/restaurantBan.util.js';

export const requireAdmin = (req, res, next) => {
    if (req.user?.role !== 'ADMIN') {
        return sendError(res, 403, 'Admin access required');
    }
    next();
};

/** Seller onboarding/profile APIs accept a full seller session or a short-lived OTP registration token. */
export const sellerProfileAuth = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token) {
        return sendError(res, 401, 'Authentication token missing');
    }

    try {
        let decoded;
        try {
            decoded = verifySellerRegistrationToken(token);
        } catch {
            decoded = verifyAccessToken(token);
        }

        if (decoded?.purpose === 'seller_onboarding') {
            const phoneDigits = String(decoded.phone || decoded.phoneLast10 || '').replace(/\D/g, '');
            const phoneLast10 = String(decoded.phoneLast10 || phoneDigits).replace(/\D/g, '').slice(-10);
            if (!phoneLast10) {
                return sendError(res, 401, 'Invalid seller registration token');
            }
            req.sellerOnboarding = { phone: phoneDigits || phoneLast10, phoneDigits: phoneDigits || phoneLast10, phoneLast10 };
            req.user = { role: 'SELLER' };
            return next();
        }

        if (decoded.role === 'SELLER' && decoded.userId) {
            req.user = { userId: decoded.userId, role: decoded.role };
            return next();
        }

        return sendError(res, 403, 'Seller access required');
    } catch {
        return sendError(res, 401, 'Invalid or expired token');
    }
};

/** Sets req.user when a valid Bearer token is present; continues without error when absent. */
export const optionalAuthMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
    if (!token) return next();

    try {
        const decoded = verifyAccessToken(token);
        req.user = { userId: decoded.userId, role: decoded.role };
    } catch {
        // Ignore invalid tokens for public endpoints
    }
    return next();
};

export const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token) {
        return sendError(res, 401, 'Authentication token missing');
    }

    try {
        const decoded = verifyAccessToken(token);
        req.user = {
            userId: decoded.userId,
            role: decoded.role
        };
        if (decoded.role === 'USER') {
            // Enforce active status in real-time - deactivated users are logged out on next request.
            FoodUser.findById(decoded.userId).select('isActive').lean().then((doc) => {
                if (!doc || doc.isActive === false) {
                    return sendError(res, 401, 'User account is deactivated');
                }
                next();
            }).catch(() => sendError(res, 401, 'Authentication failed'));
            return;
        }
        if (decoded.role === 'RESTAURANT') {
            FoodRestaurant.findById(decoded.userId).select('status isActive rejectionReason bannedAt').lean().then((doc) => {
                if (!doc || isRestaurantBanned(doc)) {
                    return sendError(res, 403, 'Restaurant account has been banned');
                }
                next();
            }).catch(() => sendError(res, 401, 'Authentication failed'));
            return;
        }
        return next();
    } catch (error) {
        return sendError(res, 401, 'Invalid or expired token');
    }
};
