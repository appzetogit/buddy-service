import mongoose from 'mongoose';
import crypto from 'crypto';
import { Admin } from './admin.model.js';
import { AdminRole } from './adminRole.model.js';
import { ValidationError, NotFoundError } from '../auth/errors.js';
import { FoodRefreshToken } from '../refreshTokens/refreshToken.model.js';
import { FoodZone } from '../../modules/food/admin/models/zone.model.js';
import { QuickZone } from '../../modules/quick-commerce/models/quick_zone.model.js';
import { Zone as TaxiZone } from '../../modules/taxi/driver/models/Zone.js';
import { sendEmployeeCredentialsEmail } from '../../utils/email.js';
import { logger } from '../../utils/logger.js';

export const ACCESS_MODULES = ['food', 'quick', 'taxi'];
/** The admin app route each module lives under; a permission key is a page path inside one of these. */
export const MODULE_BASE = {
    food: '/admin/food',
    quick: '/admin/quick-commerce',
    taxi: '/admin/taxi',
};
const ACTIONS = ['view', 'create', 'edit', 'delete'];

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));
const toId = (v) => new mongoose.Types.ObjectId(String(v));
const clean = (v) => String(v ?? '').trim();

const loginUrl = () => process.env.ADMIN_LOGIN_URL || 'https://sooperbuddy.in/admin/login';

// ---------------------------------------------------------------------------
// Context cache: the guard runs on every admin request, so the role is read once per few seconds.
// ---------------------------------------------------------------------------
const CACHE_MS = 15000;
const cache = new Map();
export const invalidateAccessCache = () => cache.clear();

const plainPermissions = (raw) => {
    const out = {};
    const entries = raw instanceof Map ? [...raw.entries()] : Object.entries(raw || {});
    for (const [key, flags] of entries) {
        if (!key || !flags) continue;
        const f = {};
        for (const a of ACTIONS) f[a] = flags[a] === true;
        if (f.view) out[key] = f; // nothing is allowed without view
    }
    return out;
};

const plainZones = (zones = {}) => {
    const out = {};
    for (const m of ACCESS_MODULES) out[m] = (zones[m] || []).map(String);
    return out;
};

/**
 * What an admin account may do. kind 'root' = main admin (and legacy sub-admins without a role):
 * no restrictions from this layer.
 */
export const resolveAdminAccess = async (adminId) => {
    const key = String(adminId || '');
    if (!isId(key)) return { kind: 'missing' };
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

    let value;
    const admin = await Admin.findById(key).select('adminRoleId isActive active status').lean();
    if (!admin) {
        value = { kind: 'missing' };
    } else if (admin.isActive === false || admin.active === false || String(admin.status || '').toLowerCase() === 'inactive') {
        value = { kind: 'inactive' };
    } else if (!admin.adminRoleId) {
        value = { kind: 'root' };
    } else {
        const role = await AdminRole.findById(admin.adminRoleId).lean();
        if (!role || role.isActive === false) {
            value = { kind: 'inactive', reason: 'role' };
        } else {
            const zones = plainZones(role.zones);
            const taxiIds = zones.taxi;
            let taxiGeometries = [];
            if (taxiIds.length) {
                const docs = await TaxiZone.find({ _id: { $in: taxiIds.map(toId) } }).select('geometry').lean();
                taxiGeometries = docs.map((d) => d.geometry).filter((g) => g?.type === 'Polygon' && g.coordinates?.length);
            }
            value = {
                kind: 'employee',
                roleId: String(role._id),
                roleName: role.name,
                permissions: plainPermissions(role.permissions),
                zones,
                // Mongo ObjectIds for the zone filters; GeoJSON areas for taxi rides (no zone field on a ride).
                scope: {
                    zones: Object.fromEntries(ACCESS_MODULES.map((m) => [m, zones[m].map(toId)])),
                    geometries: { taxi: taxiGeometries },
                },
            };
        }
    }
    cache.set(key, { at: Date.now(), value });
    return value;
};

/** What the web app needs after login / on load. */
export const buildAccessProfile = async (adminId) => {
    const a = await resolveAdminAccess(adminId);
    if (a.kind !== 'employee') return { isEmployee: false };
    return { isEmployee: true, roleId: a.roleId, roleName: a.roleName, permissions: a.permissions, zones: a.zones };
};

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------
const cleanPermissions = (input) => {
    const out = {};
    if (!input || typeof input !== 'object') return out;
    for (const [path, flags] of Object.entries(input)) {
        const p = clean(path).replace(/\/+$/, '');
        if (!p) continue;
        if (!Object.values(MODULE_BASE).some((base) => p === base || p.startsWith(`${base}/`))) {
            throw new ValidationError(`Unknown page "${p}"`);
        }
        const f = {};
        for (const a of ACTIONS) f[a] = flags?.[a] === true;
        if (!f.view) continue; // create/edit/delete without view means nothing
        out[p] = f;
    }
    return out;
};

const cleanZones = (zones = {}) => {
    const out = {};
    for (const m of ACCESS_MODULES) {
        const list = Array.isArray(zones?.[m]) ? zones[m] : [];
        const ids = [...new Set(list.map(String))];
        if (ids.some((id) => !isId(id))) throw new ValidationError('Invalid zone id');
        out[m] = ids.map(toId);
    }
    return out;
};

const roleView = (r, employeeCount = 0) => ({
    id: String(r._id),
    name: r.name,
    description: r.description || '',
    isActive: r.isActive !== false,
    permissions: plainPermissions(r.permissions),
    zones: plainZones(r.zones),
    employeeCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
});

export const listRoles = async () => {
    const [roles, counts] = await Promise.all([
        AdminRole.find({}).sort({ createdAt: -1 }).lean(),
        Admin.aggregate([{ $match: { adminRoleId: { $ne: null } } }, { $group: { _id: '$adminRoleId', c: { $sum: 1 } } }]),
    ]);
    const byRole = new Map(counts.map((c) => [String(c._id), c.c]));
    return roles.map((r) => roleView(r, byRole.get(String(r._id)) || 0));
};

export const listLoginRoles = async () => {
    const roles = await AdminRole.find({ isActive: true }).select('name').sort({ name: 1 }).lean();
    return roles.map((r) => ({ id: String(r._id), name: r.name }));
};

export const createRole = async (body, adminId) => {
    const name = clean(body?.name);
    if (name.length < 2) throw new ValidationError('Role name is required');
    const nameKey = name.toLowerCase();
    if (await AdminRole.exists({ nameKey })) throw new ValidationError('A role with this name already exists');
    const role = await AdminRole.create({
        name,
        nameKey,
        description: clean(body?.description),
        permissions: cleanPermissions(body?.permissions),
        zones: cleanZones(body?.zones),
        isActive: body?.isActive !== false,
        createdBy: isId(adminId) ? toId(adminId) : null,
    });
    invalidateAccessCache();
    return roleView(role.toObject());
};

export const updateRole = async (id, body) => {
    if (!isId(id)) throw new ValidationError('Invalid role id');
    const role = await AdminRole.findById(id);
    if (!role) throw new NotFoundError('Role not found');
    if (body?.name !== undefined) {
        const name = clean(body.name);
        if (name.length < 2) throw new ValidationError('Role name is required');
        const nameKey = name.toLowerCase();
        if (await AdminRole.exists({ nameKey, _id: { $ne: role._id } })) throw new ValidationError('A role with this name already exists');
        role.name = name;
        role.nameKey = nameKey;
    }
    if (body?.description !== undefined) role.description = clean(body.description);
    if (body?.permissions !== undefined) role.permissions = cleanPermissions(body.permissions);
    if (body?.zones !== undefined) role.zones = cleanZones(body.zones);
    if (body?.isActive !== undefined) role.isActive = body.isActive === true;
    await role.save();
    invalidateAccessCache();
    return roleView(role.toObject());
};

export const deleteRole = async (id) => {
    if (!isId(id)) throw new ValidationError('Invalid role id');
    const inUse = await Admin.countDocuments({ adminRoleId: toId(id) });
    if (inUse > 0) throw new ValidationError(`${inUse} employee(s) use this role. Move or delete them first.`);
    await AdminRole.deleteOne({ _id: toId(id) });
    invalidateAccessCache();
    return { deleted: true };
};

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------
const MIN_PASSWORD = 8;

const employeeView = (a, roleName = '') => ({
    id: String(a._id),
    name: a.name || '',
    email: a.email,
    phone: a.phone || '',
    roleId: a.adminRoleId ? String(a.adminRoleId) : '',
    roleName,
    isActive: !(a.isActive === false || a.active === false || String(a.status || '') === 'inactive'),
    lastLogin: a.lastLogin || null,
    createdAt: a.createdAt,
});

export const generatePassword = () => {
    // 12 chars, readable alphabet (no 0/O/1/l), always with a digit, upper and lower case letter.
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const digit = '23456789';
    const all = upper + lower + digit;
    const pick = (set) => set[crypto.randomInt(set.length)];
    const chars = [pick(upper), pick(lower), pick(digit), ...Array.from({ length: 9 }, () => pick(all))];
    for (let i = chars.length - 1; i > 0; i -= 1) {
        const j = crypto.randomInt(i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
};

const assertPassword = (pw) => {
    if (clean(pw).length < MIN_PASSWORD) throw new ValidationError(`Password must be at least ${MIN_PASSWORD} characters`);
};

const assertRole = async (roleId) => {
    if (!isId(roleId)) throw new ValidationError('Select a role');
    const role = await AdminRole.findById(roleId).lean();
    if (!role) throw new ValidationError('Selected role does not exist');
    if (role.isActive === false) throw new ValidationError('Selected role is inactive');
    return role;
};

export const listEmployees = async () => {
    const [admins, roles] = await Promise.all([
        Admin.find({ adminRoleId: { $ne: null } }).sort({ createdAt: -1 }).lean(),
        AdminRole.find({}).select('name').lean(),
    ]);
    const names = new Map(roles.map((r) => [String(r._id), r.name]));
    return admins.map((a) => employeeView(a, names.get(String(a.adminRoleId)) || ''));
};

export const createEmployee = async (body, adminId) => {
    const email = clean(body?.email).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError('Enter a valid email');
    const name = clean(body?.name);
    if (name.length < 2) throw new ValidationError('Name is required');
    const password = clean(body?.password);
    assertPassword(password);
    const role = await assertRole(body?.roleId);
    if (await Admin.exists({ email })) throw new ValidationError('An account with this email already exists');

    const admin = await Admin.create({
        email,
        password, // hashed by the model on save
        name,
        phone: clean(body?.phone),
        role: 'ADMIN', // platform role: the admin guards accept it; what they may do comes from adminRoleId
        admin_type: 'subadmin',
        adminRoleId: role._id,
        permissions: ['*'], // taxi's own per-route check; the access guard does the real limiting
        servicesAccess: ['food', 'quick', 'taxi'],
        isActive: true,
        active: true,
        status: 'active',
        isVerified: true,
        createdBy: isId(adminId) ? toId(adminId) : null,
    });
    invalidateAccessCache();

    const emailSent = await sendEmployeeCredentialsEmail({
        to: email, name, roleName: role.name, password, loginUrl: loginUrl(),
    });
    return { employee: employeeView(admin.toObject(), role.name), emailSent };
};

export const updateEmployee = async (id, body) => {
    if (!isId(id)) throw new ValidationError('Invalid employee id');
    const admin = await Admin.findOne({ _id: toId(id), adminRoleId: { $ne: null } }).select('+password');
    if (!admin) throw new NotFoundError('Employee not found');

    let role = null;
    if (body?.name !== undefined) {
        const name = clean(body.name);
        if (name.length < 2) throw new ValidationError('Name is required');
        admin.name = name;
    }
    if (body?.phone !== undefined) admin.phone = clean(body.phone);
    if (body?.roleId !== undefined && String(body.roleId) !== String(admin.adminRoleId)) {
        role = await assertRole(body.roleId);
        admin.adminRoleId = role._id;
    }
    let newPassword = '';
    if (clean(body?.password)) {
        newPassword = clean(body.password);
        assertPassword(newPassword);
        admin.password = newPassword;
    }
    if (body?.isActive !== undefined) {
        const on = body.isActive === true;
        admin.isActive = on;
        admin.active = on;
        admin.status = on ? 'active' : 'inactive';
    }
    await admin.save();
    invalidateAccessCache();
    if (admin.isActive === false || newPassword) {
        // Sign out every open session: a deactivated or re-keyed employee must log in again.
        await FoodRefreshToken.deleteMany({ userId: admin._id }).catch(() => {});
    }
    role = role || (await AdminRole.findById(admin.adminRoleId).lean());

    let emailSent = null;
    if (newPassword && body?.sendEmail !== false) {
        emailSent = await sendEmployeeCredentialsEmail({
            to: admin.email, name: admin.name, roleName: role?.name || '', password: newPassword, loginUrl: loginUrl(), isReset: true,
        });
    }
    return { employee: employeeView(admin.toObject(), role?.name || ''), emailSent };
};

export const deleteEmployee = async (id) => {
    if (!isId(id)) throw new ValidationError('Invalid employee id');
    const admin = await Admin.findOne({ _id: toId(id), adminRoleId: { $ne: null } });
    if (!admin) throw new NotFoundError('Employee not found');
    await FoodRefreshToken.deleteMany({ userId: admin._id }).catch(() => {});
    await admin.deleteOne();
    invalidateAccessCache();
    return { deleted: true };
};

/** Sets a fresh random password and emails it. */
export const resendEmployeeCredentials = async (id) => {
    const password = generatePassword();
    const result = await updateEmployee(id, { password, sendEmail: true });
    return { ...result, password: result.emailSent ? undefined : password };
};

// ---------------------------------------------------------------------------
// Zones for the role form
// ---------------------------------------------------------------------------
export const listAllZones = async () => {
    const [food, quick, taxi] = await Promise.all([
        FoodZone.find({}).select('name zoneName isActive').sort({ name: 1 }).lean(),
        QuickZone.find({}).select('name isActive').sort({ name: 1 }).lean(),
        TaxiZone.find({}).select('name active status').sort({ name: 1 }).lean(),
    ]);
    const f = (z) => ({ id: String(z._id), name: z.zoneName || z.name || String(z._id) });
    return { food: food.map(f), quick: quick.map(f), taxi: taxi.map(f) };
};

logger.debug?.('[adminAccess] service loaded');
