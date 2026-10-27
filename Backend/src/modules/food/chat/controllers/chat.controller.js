import { sendResponse } from '../../../../utils/response.js';
import { listConversations, listMessages, sendMessage, markConversationRead } from '../services/chat.service.js';

export async function listConversationsController(req, res, next) {
    try {
        const data = await listConversations(req.user, { orderId: req.query?.orderId });
        return sendResponse(res, 200, 'Conversations fetched successfully', { conversations: data });
    } catch (err) {
        next(err);
    }
}

export async function listMessagesController(req, res, next) {
    try {
        const data = await listMessages(req.user, {
            peerRole: req.query?.peerRole,
            peerId: req.query?.peerId,
            orderId: req.query?.orderId,
        });
        return sendResponse(res, 200, 'Messages fetched successfully', data);
    } catch (err) {
        next(err);
    }
}

export async function sendMessageController(req, res, next) {
    try {
        const data = await sendMessage(req.user, {
            peerRole: req.body?.peerRole,
            peerId: req.body?.peerId,
            orderId: req.body?.orderId,
            text: req.body?.text,
        });
        return sendResponse(res, 201, 'Message sent successfully', data);
    } catch (err) {
        next(err);
    }
}

export async function markConversationReadController(req, res, next) {
    try {
        const data = await markConversationRead(req.user, req.params?.conversationId);
        return sendResponse(res, 200, 'Conversation marked read', data);
    } catch (err) {
        next(err);
    }
}
