import { adminLogin as coreAdminLogin } from '../auth/auth.service.js';
import { Admin } from './admin.model.js';
import { signAccessToken } from '../auth/token.util.js';

const sanitizeAdmin = (admin = {}) => {
  const copy = { ...(admin?.toObject ? admin.toObject() : admin) };
  delete copy.password;
  delete copy.__v;
  return copy;
};

/**
 * Unified admin login used by Food and Taxi entry points.
 */
export const unifiedAdminLogin = async (email, password) => {
  const result = await coreAdminLogin(email, password);
  const adminId = result.user?._id || result.user?.id;

  if (adminId) {
    await Admin.findByIdAndUpdate(adminId, { lastLogin: new Date() });
  }

  return result;
};

/** Food / core auth response shape */
export const toCoreAuthLoginResponse = (result) => result;


/** Taxi legacy response shape ({ token, admin }) */
export const toTaxiLoginResponse = async (result, enrichAdmin = (items) => items) => {
  const [admin] = await enrichAdmin([sanitizeAdmin(result.user)]);
  return {
    token: result.accessToken,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    admin: admin || sanitizeAdmin(result.user),
  };
};

/** Issue a taxi-compatible access token from unified login result */
export const toTaxiAccessToken = (adminId) =>
  signAccessToken({
    userId: String(adminId),
    role: 'admin',
    sub: String(adminId),
    id: String(adminId),
  });
