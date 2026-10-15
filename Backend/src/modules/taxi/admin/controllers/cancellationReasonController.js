import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { ApiError } from '../../../../utils/ApiError.js';
import { CancellationReason } from '../models/CancellationReason.js';

/**
 * Cancellation reasons, for the apps and for the admin panel.
 *
 * The `CancellationReason` model already existed but nothing served it, so both
 * apps fell back to "No reasons configured" while 16 perfectly good rows sat in
 * the database. This is the missing half.
 *
 * Kept in its own file rather than folded into the 1,700-line adminController
 * so the public route and the admin CRUD it depends on can never drift apart —
 * a route importing a handler that lives elsewhere is exactly how this endpoint
 * has been taken down before.
 */

const ok = (res, data, extra = {}) => res.json({ success: true, data, ...extra });

const AUDIENCES = ['user', 'driver'];

const normalizeAudience = (value, fallback = 'user') => {
  const audience = String(value || '').trim().toLowerCase();
  return AUDIENCES.includes(audience) ? audience : fallback;
};

const present = (reason) => ({
  id: String(reason._id),
  _id: String(reason._id),
  title: reason.title,
  audience: reason.audience,
  requiresNote: Boolean(reason.requiresNote),
  requires_note: Boolean(reason.requiresNote),
  order_by: Number(reason.order_by || 0),
  active: reason.active !== false,
});

/// Public: the list the rider or driver picks from when cancelling a trip.
///
/// Only active reasons, and only for the asking audience — riders and drivers
/// cancel for different reasons and one catalog serves both.
export const getPublicCancellationReasons = asyncHandler(async (req, res) => {
  const audience = normalizeAudience(req.query.audience);

  const reasons = await CancellationReason.find({ audience, active: true })
    .sort({ order_by: 1, createdAt: 1 })
    .lean();

  ok(res, { results: reasons.map(present) });
});

export const listCancellationReasons = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.audience) query.audience = normalizeAudience(req.query.audience);

  const reasons = await CancellationReason.find(query)
    .sort({ audience: 1, order_by: 1, createdAt: 1 })
    .lean();

  ok(res, { results: reasons.map(present) });
});

export const createCancellationReason = asyncHandler(async (req, res) => {
  const title = String(req.body?.title || '').trim();
  if (!title) throw new ApiError(400, 'Reason title is required');

  const reason = await CancellationReason.create({
    title,
    audience: normalizeAudience(req.body?.audience),
    requiresNote: req.body?.requiresNote === true || req.body?.requires_note === true,
    order_by: Number(req.body?.order_by || 0),
    active: req.body?.active !== false,
  });

  ok(res, present(reason.toObject()));
});

export const updateCancellationReason = asyncHandler(async (req, res) => {
  const updates = {};

  if (req.body?.title !== undefined) {
    const title = String(req.body.title || '').trim();
    if (!title) throw new ApiError(400, 'Reason title cannot be empty');
    updates.title = title;
  }
  if (req.body?.audience !== undefined) {
    updates.audience = normalizeAudience(req.body.audience);
  }
  if (req.body?.requiresNote !== undefined || req.body?.requires_note !== undefined) {
    updates.requiresNote = req.body.requiresNote === true || req.body.requires_note === true;
  }
  if (req.body?.order_by !== undefined) {
    updates.order_by = Number(req.body.order_by || 0);
  }
  if (req.body?.active !== undefined) {
    updates.active = req.body.active !== false;
  }

  const reason = await CancellationReason.findByIdAndUpdate(req.params.id, updates, {
    new: true,
    runValidators: true,
  }).lean();

  if (!reason) throw new ApiError(404, 'Cancellation reason not found');

  ok(res, present(reason));
});

export const deleteCancellationReason = asyncHandler(async (req, res) => {
  const reason = await CancellationReason.findByIdAndDelete(req.params.id).lean();
  if (!reason) throw new ApiError(404, 'Cancellation reason not found');
  ok(res, { id: String(reason._id) });
});
