import express from 'express';
// QC chat reuses Food's chat models/service/controller as-is — the conversation/message schemas
// are generic (orderId isn't enforced against FoodOrder at the DB level), and chat.service.js's
// assertOrderMembership() already checks QuickOrder too. No QC-specific controller needed.
import {
    listConversationsController,
    listMessagesController,
    sendMessageController,
    markConversationReadController,
} from '../../../food/chat/controllers/chat.controller.js';

const router = express.Router();

router.get('/conversations', listConversationsController);
router.get('/messages', listMessagesController);
router.post('/messages', sendMessageController);
router.patch('/conversations/:conversationId/read', markConversationReadController);

export default router;
