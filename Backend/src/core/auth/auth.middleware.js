import { verifyAccessToken } from './token.util.js';
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
