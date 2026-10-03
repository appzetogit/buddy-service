import { Admin } from './admin.model.js';
import { config } from '../../config/env.js';

const DEFAULT_ADMIN_EMAIL = 'admin@gmail.com';
const DEFAULT_ADMIN_PASSWORD = 'Admin@123';
const DEFAULT_ADMIN_NAME = 'Super Admin';

const defaultAdminFields = () => ({
    name: DEFAULT_ADMIN_NAME,
    email: DEFAULT_ADMIN_EMAIL,
    password: DEFAULT_ADMIN_PASSWORD,
    role: 'ADMIN',
    admin_type: 'superadmin',
    permissions: ['*'],
    isActive: true,
    active: true,
    status: 'active',
    isVerified: true,
    servicesAccess: ['food'],
});

/** Seed or repair the default admin in the unified admins collection. */
export const seedDefaultAdmin = async () => {
    try {
        const existing = await Admin.findOne({ email: DEFAULT_ADMIN_EMAIL }).select('+password');

        if (existing) {
            let changed = false;

            if (!(await existing.comparePassword(DEFAULT_ADMIN_PASSWORD))) {
                if (config.nodeEnv === 'production') {
                    console.log(`[seedDefaultAdmin] Default admin exists but password differs. Skipping reset in production.`);
                } else {
                    existing.password = DEFAULT_ADMIN_PASSWORD;
                    changed = true;
                    console.log('[seedDefaultAdmin] Reset default admin password for development.');
                }
            }

            const required = defaultAdminFields();
            for (const [key, value] of Object.entries(required)) {
                if (key === 'password' || key === 'email') continue;
                const current = existing[key];
                if (current === undefined || current === null || (Array.isArray(current) && current.length === 0)) {
                    existing[key] = value;
                    changed = true;
                }
            }

            if (changed) {
                await existing.save();
            }

            console.log(`[seedDefaultAdmin] Default admin ready: ${DEFAULT_ADMIN_EMAIL}`);
            return;
        }

        await Admin.create(defaultAdminFields());

        console.log(`[seedDefaultAdmin] ✅ Default admin created: ${DEFAULT_ADMIN_EMAIL}`);
        console.log(`[seedDefaultAdmin] 🔑 Default password: ${DEFAULT_ADMIN_PASSWORD}`);
        console.log(`[seedDefaultAdmin] ⚠️  Please change the password after first login.`);
    } catch (error) {
        console.error('[seedDefaultAdmin] ❌ Failed to seed default admin:', error.message);
    }
};
