import mongoose from 'mongoose';

/**
 * A role created by the main admin. Employees (Admin docs with adminRoleId) get exactly what the
 * role grants:
 *   permissions - { [admin page path]: { view, create, edit, delete } }, e.g.
 *                 { '/admin/food/orders/all': { view: true, edit: true } }
 *   zones       - per module, the zones the role may see. An empty list = all zones of that module.
 */
const flagSchema = new mongoose.Schema(
    { view: Boolean, create: Boolean, edit: Boolean, delete: Boolean },
    { _id: false },
);

const roleSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 60 },
        nameKey: { type: String, required: true, unique: true, lowercase: true, trim: true },
        description: { type: String, trim: true, default: '', maxlength: 300 },
        permissions: { type: Map, of: flagSchema, default: {} },
        zones: {
            food: { type: [mongoose.Schema.Types.ObjectId], default: [] },
            quick: { type: [mongoose.Schema.Types.ObjectId], default: [] },
            taxi: { type: [mongoose.Schema.Types.ObjectId], default: [] },
        },
        isActive: { type: Boolean, default: true },
        createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    },
    { collection: 'admin_roles', timestamps: true },
);

export const AdminRole = mongoose.models.AdminRole || mongoose.model('AdminRole', roleSchema);
