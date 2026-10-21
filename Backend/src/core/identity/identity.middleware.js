import { verifyAccessToken } from '../auth/token.util.js';
import { sendError } from '../../utils/response.js';
import { BuddyIdentity } from './buddyIdentity.model.js';
import { FoodUser } from '../users/user.model.js';
import { FoodDeliveryPartner } from '../../modules/food/delivery/models/deliveryPartner.model.js';

export const authenticateIdentity = (options = {}) => async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return sendError(res, 401, 'Authentication token missing');

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (_) {
      return sendError(res, 401, 'Invalid or expired token');
    }

    const identityId = payload.identityId || null;
    if (!identityId) {
      return sendError(res, 401, 'This endpoint requires the unified auth token');
    }

    const identity = await BuddyIdentity.findById(identityId);
    if (!identity) return sendError(res, 401, 'Identity not found');
    if (identity.isActive === false) {
      return sendError(res, 401, 'Account has been deactivated');
    }

    // Legacy delivery-partner logins (core/auth/auth.service.js) still issue role=DELIVERY_PARTNER
    // so they keep working against the older authMiddleware too; treat it as DRIVER here.
    const rawRole = String(payload.role || '').toUpperCase();
    const role = rawRole === 'DELIVERY_PARTNER' ? 'DRIVER' : rawRole;
    const allowedRoles = (options.roles || []).map((r) => String(r).toUpperCase());
    if (allowedRoles.length && !allowedRoles.includes(role)) {
      return sendError(res, 403, 'Insufficient permissions');
    }

    if (
      role === 'DRIVER' &&
      !options.allowOnboarding &&
      identity.onboardingComplete === false
    ) {
      return sendError(res, 403, 'Driver onboarding is not complete');
    }

    req.identity = identity;
    req.identityRole = role;
    req.user = {
      identityId: String(identity._id),
      userId: payload.userId || String(identity._id),
      role,
    };
    req.auth = {
      sub: payload.sub || payload.userId || String(identity._id),
      role: role.toLowerCase(),
      identityId: String(identity._id),
    };

    const cache = {};
    req.foodUser = async () =>
      cache.foodUser || (cache.foodUser = await FoodUser.findOne({ identityId: identity._id }));
    req.foodPartner = async () =>
      cache.foodPartner ||
      (cache.foodPartner = await FoodDeliveryPartner.findOne({ identityId: identity._id }));

    return next();
  } catch (error) {
    return sendError(res, 401, 'Authentication failed');
  }
};
