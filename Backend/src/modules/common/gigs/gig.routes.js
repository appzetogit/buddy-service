import express from 'express';
import { authMiddleware } from '../../../core/auth/auth.middleware.js';
import { requireRoles } from '../../../core/roles/role.middleware.js';
import { adminAccessGuard } from '../../../core/admin/adminAccess.middleware.js';
import { sendResponse } from '../../../utils/response.js';
import { ValidationError } from '../../../core/auth/errors.js';
import { resolvePartnerFromAccountId } from '../../taxi/shared/partner.js';
import * as gigs from './gig.service.js';
import * as scheduled from './gig.scheduled.service.js';

const wrap = (fn, status = 200, message = 'OK') => async (req, res, next) => {
  try {
    return sendResponse(res, status, message, await fn(req));
  } catch (err) {
    return next(err);
  }
};

/** Mounted at /v1/gigs/admin (main admin and employees whose role grants the Gigs pages). */
export const gigAdminRouter = express.Router();
gigAdminRouter.use(authMiddleware, requireRoles('ADMIN'), adminAccessGuard);
gigAdminRouter.get('/slots', wrap(async () => ({ slots: await gigs.listSlots() })));
gigAdminRouter.post('/slots', wrap(async (req) => ({ slot: await gigs.createSlot(req.body, req.user?.userId) }), 201, 'Gig slot created'));
gigAdminRouter.put('/slots/:id', wrap(async (req) => ({ slot: await gigs.updateSlot(req.params.id, req.body) }), 200, 'Gig slot updated'));
gigAdminRouter.delete('/slots/:id', wrap(async (req) => gigs.deleteSlot(req.params.id), 200, 'Gig slot removed'));
gigAdminRouter.get('/bookings', wrap(async (req) => gigs.listBookings(req.query)));
gigAdminRouter.get('/earnings', wrap(async (req) => gigs.earningsSummary(req.query)));
// Scheduled orders / rides: what waits for a manual driver, who can be assigned, and the assignment.
gigAdminRouter.get('/scheduled', wrap(async (req) => scheduled.listScheduledPending(req.query)));
gigAdminRouter.get('/scheduled/assignable-drivers', wrap(async (req) => scheduled.listAssignableDrivers(req.query)));
gigAdminRouter.post('/scheduled/assign', wrap(async (req) => scheduled.adminAssignScheduled(req.body || {}, req.user?.userId), 200, 'Driver assigned'));

/** Mounted at /v1/gigs/rider - the same rider account is used for Food, Marketplace and Taxi. */
export const gigRiderRouter = express.Router();
gigRiderRouter.use(authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'));

const withPartner = (fn) => wrap(async (req) => {
  const partner = await resolvePartnerFromAccountId(req.user?.userId);
  if (!partner) throw new ValidationError('Rider account not found');
  return fn(partner._id, req);
});

gigRiderRouter.get('/days', withPartner((id) => gigs.riderDays(id)));
gigRiderRouter.get('/days/:date', withPartner((id, req) => gigs.riderDay(id, req.params.date)));
gigRiderRouter.get('/bookings', withPartner((id, req) => gigs.riderBookings(id, { upcomingOnly: req.query.upcoming === 'true' })));
gigRiderRouter.post('/book', withPartner((id, req) => gigs.riderBook(id, req.body)));
gigRiderRouter.delete('/bookings/:id', withPartner((id, req) => gigs.riderCancel(id, req.params.id)));
