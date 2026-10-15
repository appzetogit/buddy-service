/**
 * Taxi route authentication, on the platform's own login.
 *
 * Taxi has no login of its own: a rider is a normal customer (role USER) and an admin is a
 * normal platform admin (role ADMIN), both holding the same access token the Food / Quick
 * Commerce apps already use. This keeps the `authenticate(['user'])` / `authenticate(['admin'])`
 * contract the taxi controllers were written against and fills in `req.auth` for them.
 */
import { verifyAccessToken } from '../../../core/auth/token.util.js';
import { ApiError } from '../../../utils/ApiError.js';
import { Admin } from '../admin/models/Admin.js';
import { Driver } from '../driver/models/Driver.js';
import { resolvePartnerFromAccountId } from '../shared/partner.js';
import { User } from '../user/models/User.js';
import { normalizeAdminPermissions, normalizeAdminType } from '../admin/services/adminAccessService.js';

/** Platform roles -> the role names the taxi controllers check for. */
const PLATFORM_ROLE_TO_TAXI_ROLE = {
  ADMIN: 'admin',
  USER: 'user',
  DRIVER: 'driver',
  // Legacy login of a delivery partner: same person, same rider account.
  DELIVERY_PARTNER: 'driver',
};

const normalizeTaxiRole = (role = '') => {
  const value = String(role || '').toLowerCase();
  return value === 'super-admin' ? 'admin' : value;
};

const readBearerToken = (req) => {
  const [scheme, token] = String(req.headers.authorization || '').split(' ');
  return /^Bearer$/i.test(scheme || '') ? token : '';
};

const decodeToken = (token) => {
  try {
    return verifyAccessToken(token);
  } catch {
    throw new ApiError(401, 'Invalid or expired token');
  }
};

const buildAdminContext = (entity) => ({
  id: String(entity._id),
  email: entity.email || '',
  name: entity.name || '',
  role: entity.role || '',
  admin_type: normalizeAdminType(entity.admin_type || entity.role),
  permissions: normalizeAdminPermissions(entity.permissions || []),
  service_location_ids: Array.isArray(entity.service_location_ids)
    ? entity.service_location_ids.map((item) => String(item))
    : [],
  zone_ids: Array.isArray(entity.zone_ids) ? entity.zone_ids.map((item) => String(item)) : [],
  active: entity.active !== false,
  status: entity.status || 'active',
});

export const authenticate = (allowedRoles = []) => async (req, _res, next) => {
  try {
    const token = readBearerToken(req);
    if (!token) throw new ApiError(401, 'Authorization token is required');

    const payload = decodeToken(token);
    const platformRole = String(payload.role || '').toUpperCase();
    const taxiRole = PLATFORM_ROLE_TO_TAXI_ROLE[platformRole] || '';
    const accountId = payload.userId || payload.sub || payload.id;

    if (!taxiRole || !accountId) throw new ApiError(401, 'Unsupported auth role');

    const allowed = allowedRoles.map(normalizeTaxiRole);
    if (allowed.length > 0 && !allowed.includes(taxiRole)) {
      throw new ApiError(403, 'Insufficient permissions for this resource');
    }

    // A rider is a delivery partner: their account id is the delivery-partner id.
    if (taxiRole === 'driver') {
      const partner = await resolvePartnerFromAccountId(accountId);
      if (!partner) throw new ApiError(403, 'Delivery partner profile not found');
      if (partner.status && partner.status !== 'approved') {
        throw new ApiError(403, 'Your delivery account is not approved yet');
      }
      const riderId = String(partner._id);
      req.user = { userId: riderId, role: platformRole };
      req.auth = { sub: riderId, role: 'driver', originalRole: 'driver', entity: await Driver.findById(riderId) };
      return next();
    }

    const entity = await (taxiRole === 'admin' ? Admin : User).findById(accountId);
    if (!entity) throw new ApiError(401, 'Authenticated account no longer exists');

    if (taxiRole === 'user' && (entity.deletedAt || entity.isActive === false || entity.active === false)) {
      throw new ApiError(401, 'User account is not active');
    }

    req.user = { userId: String(accountId), role: platformRole };
    req.auth = { sub: String(accountId), role: taxiRole, originalRole: taxiRole, entity };

    if (taxiRole === 'admin') {
      req.auth.admin = buildAdminContext(entity);
      if (req.auth.admin.active === false || String(req.auth.admin.status).toLowerCase() === 'inactive') {
        throw new ApiError(403, 'Admin account is inactive');
      }
    }

    next();
  } catch (error) {
    next(error);
  }
};
