import { Admin } from "../../../core/admin/admin.model.js";
import { unifiedAdminLogin, toQcLoginResponse } from "../../../core/admin/adminAuth.adapter.js";
import handleResponse from "../utils/helper.js";
import {
  bootstrapAdminSchema,
  loginAdminSchema,
  validateSchema,
} from "../validation/adminAuthValidation.js";

const PUBLIC_ADMIN_SIGNUP_ENABLED = () =>
  process.env.ENABLE_PUBLIC_ADMIN_SIGNUP === "true";

function sanitizeAdmin(adminDoc) {
  const admin = adminDoc?.toObject ? adminDoc.toObject() : { ...(adminDoc || {}) };
  delete admin.password;
  delete admin.__v;
  return admin;
}

function readBootstrapSecret(req) {
  return String(
    req.headers["x-admin-bootstrap-secret"] ||
      req.body?.adminSecret ||
      "",
  ).trim();
}

export const bootstrapAdmin = async (req, res) => {
  try {
    const configuredSecret = String(process.env.ADMIN_BOOTSTRAP_SECRET || "").trim();
    if (!configuredSecret) {
      return handleResponse(res, 503, "Admin bootstrap is not configured");
    }

    const suppliedSecret = readBootstrapSecret(req);
    if (!suppliedSecret || suppliedSecret !== configuredSecret) {
      return handleResponse(res, 403, "Invalid admin bootstrap secret");
    }

    const existingCount = await Admin.countDocuments({});
    if (existingCount > 0) {
      return handleResponse(res, 409, "Admin bootstrap is disabled after initial setup");
    }

    const payload = validateSchema(bootstrapAdminSchema, req.body || {});
    const duplicate = await Admin.findOne({ email: payload.email }).lean();
    if (duplicate) {
      return handleResponse(res, 409, "Admin already exists");
    }

    const admin = await Admin.create({
      name: payload.name,
      email: payload.email,
      password: payload.password,
      role: "ADMIN",
      admin_type: "superadmin",
      permissions: ["*"],
      isActive: true,
      active: true,
      status: "active",
      isVerified: true,
      servicesAccess: ["food", "quickCommerce"],
    });

    const loginResult = await unifiedAdminLogin(payload.email, payload.password);
    return handleResponse(res, 201, "Admin bootstrapped successfully", toQcLoginResponse(loginResult));
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const signupAdmin = async (req, res) => {
  try {
    if (!PUBLIC_ADMIN_SIGNUP_ENABLED()) {
      return handleResponse(
        res,
        403,
        "Public admin signup is disabled. Use secure bootstrap flow.",
      );
    }

    const existingCount = await Admin.countDocuments({});
    if (existingCount > 0) {
      return handleResponse(res, 403, "Public admin signup is disabled after bootstrap");
    }

    const payload = validateSchema(bootstrapAdminSchema, req.body || {});
    await Admin.create({
      name: payload.name,
      email: payload.email,
      password: payload.password,
      role: "ADMIN",
      admin_type: "superadmin",
      permissions: ["*"],
      isActive: true,
      active: true,
      status: "active",
      isVerified: true,
      servicesAccess: ["food", "quickCommerce"],
    });

    const loginResult = await unifiedAdminLogin(payload.email, payload.password);
    return handleResponse(res, 201, "Admin registered successfully", toQcLoginResponse(loginResult));
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const loginAdmin = async (req, res) => {
  try {
    const payload = validateSchema(loginAdminSchema, req.body || {});
    const loginResult = await unifiedAdminLogin(payload.email, payload.password);
    return handleResponse(res, 200, "Login successful", toQcLoginResponse(loginResult));
  } catch (error) {
    const status = error.statusCode || (error.name === "AuthError" ? 401 : 500);
    return handleResponse(res, status, error.message || "Login failed");
  }
};
