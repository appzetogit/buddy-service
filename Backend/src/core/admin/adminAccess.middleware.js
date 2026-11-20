import { resolveAdminAccess, MODULE_BASE } from './adminAccess.service.js';
import { runWithScope } from './zoneScope.js';
import { sendError } from '../../utils/response.js';

/**
 * Gate for every admin API (Food, Marketplace, Taxi).
 *
 * - Main admin (and legacy sub-admins without a role): passes untouched.
 * - Employee: the web app tells us which admin page the request comes from (x-admin-page). The
 *   request is allowed only if the employee's role grants that page, with the action the HTTP
 *   method needs (GET = view, POST = create/edit, PUT/PATCH = edit, DELETE = delete). It then runs
 *   inside the employee's zone scope, so every query is limited to their zones.
 *
 * shortcut: the page comes from a header the web app sets, so someone calling the API by hand could
 * name a page they hold; upgrade to an API-path -> page map if that matters.
 */
const ACTION_BY_METHOD = { GET: 'view', HEAD: 'view', OPTIONS: 'view', DELETE: 'delete', PUT: 'edit', PATCH: 'edit' };

// Never reachable by an employee, whatever page they name: account / access management.
const BLOCKED = /\/(admin-management|subadmins?|admin-roles?|access)(\/|$)/i;
// Always-allowed own-profile pages.
const OWN_PAGES = new Set(['/admin/food/profile', '/admin/taxi/profile', '/admin/quick-commerce/profile']);

const normalizePage = (value) => {
    let p = String(value || '').split('?')[0].split('#')[0].trim();
    if (!p.startsWith('/')) return '';
    p = p.replace(/\/+$/, '');
    return p || '/';
};

const parentOf = (key) => key.slice(0, key.lastIndexOf('/'));
const depth = (p) => p.split('/').filter(Boolean).length;

/**
 * The flags that apply to a page: the longest granted page that is the page itself or a parent of it
 * (module roots match exactly). A detail page such as /admin/food/orders/123 is not in the menu, so
 * it falls back to the granted pages of its section (/admin/food/orders/all, .../pending ...).
 */
const flagsForPage = (permissions, page, bases) => {
    let best = null;
    for (const key of Object.keys(permissions)) {
        const isRoot = bases.includes(key);
        const hit = key === page || (!isRoot && page.startsWith(`${key}/`));
        if (hit && (!best || key.length > best.length)) best = key;
    }
    if (best) return permissions[best];
    const merged = {};
    let any = false;
    for (const [key, flags] of Object.entries(permissions)) {
        const parent = parentOf(key);
        if (depth(parent) >= 3 && page.startsWith(`${parent}/`)) {
            any = true;
            for (const a of ['view', 'create', 'edit', 'delete']) merged[a] = merged[a] || flags[a] === true;
        }
    }
    return any ? merged : null;
};

// Admin pages of one module call APIs of another (Marketplace pages read Food data), so the page - not
// the API prefix - decides which module's permissions apply.
export const adminAccessGuard = async (req, res, next) => {
    try {
        const adminId = req.user?.userId || req.auth?.sub || req.auth?.id;
        const access = await resolveAdminAccess(adminId);

        if (access.kind === 'root') return next();
        if (access.kind === 'missing') return sendError(res, 401, 'Admin account not found');
        if (access.kind === 'inactive') {
            return sendError(res, 403, access.reason === 'role' ? 'Your role is inactive' : 'Admin account is inactive');
        }

        const bases = Object.values(MODULE_BASE);
        const method = String(req.method || 'GET').toUpperCase();
        const action = ACTION_BY_METHOD[method] || 'create';

        if (BLOCKED.test(req.originalUrl.split('?')[0])) {
            return sendError(res, 403, 'Only the main admin can manage accounts and roles');
        }

        const page = normalizePage(req.get('x-admin-page'));
        if (!page) {
            // Background reads carry no page (the app always sends it for user actions): view only.
            if (action === 'view' && Object.keys(access.permissions).length) return runWithScope(access.scope, next);
            return sendError(res, 403, 'You do not have permission for this action');
        }
        if (!bases.some((b) => page === b || page.startsWith(`${b}/`))) {
            return sendError(res, 403, 'This request is not allowed from this page');
        }
        if (OWN_PAGES.has(page)) return runWithScope(access.scope, next);

        const flags = flagsForPage(access.permissions, page, bases);
        const allowed = flags && flags.view && (action === 'view' || (action === 'create' ? flags.create || flags.edit : flags[action]));
        if (!allowed) return sendError(res, 403, 'You do not have permission to do this');

        return runWithScope(access.scope, next);
    } catch (err) {
        return next(err);
    }
};

/** Routes only the main admin may use (employee / role management). */
export const requireMainAdmin = async (req, res, next) => {
    try {
        const access = await resolveAdminAccess(req.user?.userId);
        if (access.kind !== 'root') return sendError(res, 403, 'Only the main admin can do this');
        return next();
    } catch (err) {
        return next(err);
    }
};
