import mongoose from 'mongoose';

/**
 * Things admins did, for the Admin Management page.
 *
 * That page showed a login success rate, password resets, permission changes
 * and a recent-activity feed, all typed into the page - nothing recorded any
 * of it. This is the record those numbers are now counted from.
 *
 * Only what the page needs: who, what, to whom, when. Never a password or a
 * reset code.
 */
const adminActivitySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: [
        'login_success',
        'login_failed',
        'password_reset',
        'admin_created',
        'admin_updated',
        'permissions_changed',
        'admin_suspended',
        'admin_reactivated',
        'admin_deleted',
      ],
      index: true,
    },
    // Who did it. Empty for a failed sign-in, which has no known admin.
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiAdmin', default: null },
    actorName: { type: String, default: '' },
    // Whose account it was about, when that is someone else.
    targetId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiAdmin', default: null },
    targetName: { type: String, default: '' },
    // The email tried, for sign-ins - including ones that matched no account.
    email: { type: String, default: '' },
    ip: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

adminActivitySchema.index({ createdAt: -1 });
adminActivitySchema.index({ type: 1, createdAt: -1 });

// Kept for a year; the page looks back 30 days.
adminActivitySchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

export const AdminActivity =
  mongoose.models.TaxiAdminActivity || mongoose.model('TaxiAdminActivity', adminActivitySchema);
