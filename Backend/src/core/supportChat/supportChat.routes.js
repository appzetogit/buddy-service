import express from 'express';
import rateLimit from 'express-rate-limit';
import { requireRoles } from '../roles/role.middleware.js';
import { sendResponse } from '../../utils/response.js';
import * as svc from './supportChat.service.js';

const wrap = (fn, status = 200, msg = 'OK') => async (req, res, next) => {
    try {
        return sendResponse(res, status, msg, await fn(req));
    } catch (err) {
        next(err);
    }
};

// 30 messages/min per account (keyed by user id) - stops a stuck client or script from flooding the inbox.
const sendLimiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.user?.userId || 'anon'),
    message: { success: false, message: 'Too many messages, slow down' },
});

const router = express.Router();

const admin = express.Router();
admin.use(requireRoles('ADMIN'));
admin.get('/threads', wrap((r) => svc.adminListThreads(r.query)));
admin.get('/unread', wrap(() => svc.adminUnreadTotal()));
admin.get('/participants', wrap((r) => svc.adminSearchParticipants(r.query)));
admin.post('/threads', wrap((r) => svc.adminOpenThread(r.body || {}), 201, 'Conversation ready'));
admin.get('/threads/:threadId/messages', wrap((r) => svc.adminListMessages(r.params.threadId, r.query)));
admin.post('/threads/:threadId/messages', sendLimiter, wrap((r) => svc.adminSendMessage(r.user, r.params.threadId, r.body || {}), 201, 'Message sent'));
admin.patch('/threads/:threadId/read', wrap((r) => svc.adminMarkRead(r.params.threadId)));
admin.get('/settings', wrap(() => svc.getSettings()));
admin.put('/settings', wrap((r) => svc.updateSettings(r.body || {})));
router.use('/admin', admin);

const me = express.Router();
me.use(requireRoles('USER', 'SELLER', 'RESTAURANT', 'DELIVERY_PARTNER'));
me.get('/', wrap((r) => svc.getMyChat(r.user)));
me.get('/messages', wrap((r) => svc.listMyMessages(r.user, r.query)));
me.post('/messages', sendLimiter, wrap((r) => svc.sendMyMessage(r.user, r.body || {}), 201, 'Message sent'));
me.patch('/read', wrap((r) => svc.markMyRead(r.user)));
router.use('/me', me);

export default router;
