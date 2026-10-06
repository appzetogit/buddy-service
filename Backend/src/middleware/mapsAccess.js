const ALLOWED_MAPS_CLIENT_ORIGINS = [
    'http://localhost:5173',
    'http://localhost:3000',
];

const isAllowedMapsClientOrigin = (value = '') => {
    const normalized = String(value || '').trim();
    if (!normalized) return false;
    return ALLOWED_MAPS_CLIENT_ORIGINS.some((pattern) => {
        if (typeof pattern === 'string') {
            return normalized === pattern || normalized.startsWith(`${pattern}/`);
        }
        return pattern.test(normalized);
    });
};

/** Restricts the maps proxy to app clients: authenticated users, QC sessions, or allowed browser origins. */
export const requireMapsApiAccess = (req, res, next) => {
    const hasAuth = /^Bearer\s+\S+/i.test(String(req.headers.authorization || ''));
    const hasQuickSession = Boolean(String(req.headers['x-quick-session'] || '').trim());
    const fromApp = isAllowedMapsClientOrigin(req.headers.origin) || isAllowedMapsClientOrigin(req.headers.referer);

    if (hasAuth || hasQuickSession || fromApp) return next();

    return res.status(403).json({
        success: false,
        message: 'Maps distance API is only available to authenticated app clients.',
    });
};
