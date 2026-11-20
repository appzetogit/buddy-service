import { Router } from 'express';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { adminAccessGuard } from '../../../../core/admin/adminAccess.middleware.js';
import {
  adminCreateSupportTitle,
  adminDeleteSupportTitle,
  adminGetSupportTicketDetail,
  adminListSupportTickets,
  adminListSupportTitles,
  adminReplySupportTicket,
  adminSupportTicketStats,
  adminUpdateSupportTicket,
  adminUpdateSupportTitle,
  createSupportTicket,
  getMySupportTicketDetail,
  getSupportTitlesForRequester,
  listMySupportTickets,
  replyMySupportTicket,
} from '../controllers/supportController.js';

export const supportRouter = Router();

supportRouter.get(
  '/support/titles',
  authenticate(['admin', 'user', 'driver']),
  asyncHandler(getSupportTitlesForRequester),
);
supportRouter.post(
  '/support/tickets',
  authenticate(['user', 'driver']),
  asyncHandler(createSupportTicket),
);
supportRouter.get(
  '/support/tickets/my',
  authenticate(['user', 'driver']),
  asyncHandler(listMySupportTickets),
);
supportRouter.get(
  '/support/tickets/:ticketCode',
  authenticate(['user', 'driver']),
  asyncHandler(getMySupportTicketDetail),
);
supportRouter.post(
  '/support/tickets/:ticketCode/reply',
  authenticate(['user', 'driver']),
  asyncHandler(replyMySupportTicket),
);

supportRouter.get(
  '/admin/support/titles',
  authenticate(['admin']), adminAccessGuard,
  asyncHandler(adminListSupportTitles),
);
supportRouter.post(
  '/admin/support/titles',
  authenticate(['admin']), adminAccessGuard,
  asyncHandler(adminCreateSupportTitle),
);
supportRouter.patch(
  '/admin/support/titles/:titleId',
  authenticate(['admin']), adminAccessGuard,
  asyncHandler(adminUpdateSupportTitle),
);
supportRouter.delete(
  '/admin/support/titles/:titleId',
  authenticate(['admin']), adminAccessGuard,
  asyncHandler(adminDeleteSupportTitle),
);

supportRouter.get(
  '/admin/support/tickets/stats',
  authenticate(['admin']), adminAccessGuard,
  asyncHandler(adminSupportTicketStats),
);
supportRouter.get(
  '/admin/support/tickets',
  authenticate(['admin']), adminAccessGuard,
  asyncHandler(adminListSupportTickets),
);
supportRouter.get(
  '/admin/support/tickets/:ticketCode',
  authenticate(['admin']), adminAccessGuard,
  asyncHandler(adminGetSupportTicketDetail),
);
supportRouter.patch(
  '/admin/support/tickets/:ticketCode',
  authenticate(['admin']), adminAccessGuard,
  asyncHandler(adminUpdateSupportTicket),
);
supportRouter.post(
  '/admin/support/tickets/:ticketCode/reply',
  authenticate(['admin']), adminAccessGuard,
  asyncHandler(adminReplySupportTicket),
);
