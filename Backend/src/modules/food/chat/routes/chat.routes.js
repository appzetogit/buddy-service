import express from 'express';
import {
    listConversationsController,
    listMessagesController,
    sendMessageController,
    markConversationReadController,
} from '../controllers/chat.controller.js';

const router = express.Router();

router.get('/conversations', listConversationsController);
router.get('/messages', listMessagesController);
router.post('/messages', sendMessageController);
router.patch('/conversations/:conversationId/read', markConversationReadController);

export default router;
