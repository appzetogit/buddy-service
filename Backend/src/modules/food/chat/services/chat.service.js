import mongoose from 'mongoose';
import { FoodChatConversation } from '../models/chatConversation.model.js';
import { FoodChatMessage } from '../models/chatMessage.model.js';
import { FoodOrder } from '../../orders/models/order.model.js';
import { QuickOrder } from '../../../quick-commerce/models/order.model.js';
import { ValidationError, ForbiddenError, NotFoundError } from '../../../../core/auth/errors.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { notifyOwnerSafely, notifyAdminsSafely } from '../../../../core/notifications/firebase.service.js';

const VALID_ROLES = ['USER', 'RESTAURANT', 'DELIVERY_PARTNER', 'ADMIN'];

/** "ROLE:id" for a party, or just "ADMIN" (admin chat has no single owner). */
export const buildToken = (role, id) => {
    const r = String(role || '').toUpperCase();
    if (r === 'DRIVER') return `DELIVERY_PARTNER:${String(id)}`;
    if (r === 'ADMIN') return 'ADMIN';
    return `${r}:${String(id)}`;
};

const parseToken = (token) => {
    const raw = String(token || '');
    if (raw === 'ADMIN') return { role: 'ADMIN', id: null };
    const [role, id] = raw.split(':');
    return { role, id };
};

/** Resolve the caller's own token from req.user, mapping unified DRIVER -> DELIVERY_PARTNER. */
export const myTokenFromReqUser = (reqUser) => buildToken(reqUser?.role, reqUser?.userId);

/** True when `token`'s party is one of the three people on this order. Checks FoodOrder first,
 *  then QuickOrder — same chat models/service serve both order kinds; QC orders have no single
 *  "restaurant" field (sellers live in pickupPoints), so RESTAURANT-role membership is Food-only. */
async function assertOrderMembership(orderId, token) {
    if (!mongoose.Types.ObjectId.isValid(orderId)) throw new ValidationError('Invalid orderId');
    let order = await FoodOrder.findById(orderId)
        .select('userId restaurantId pickups.restaurantId dispatch.deliveryPartnerId dispatch.sharedPartnerId')
        .lean();
    if (!order) {
        order = await QuickOrder.findById(orderId)
            .select('userId dispatch.deliveryPartnerId dispatch.sharedPartnerId')
            .lean();
    }
    if (!order) throw new NotFoundError('Order not found');

    const { role, id } = parseToken(token);
    const idStr = String(id || '');
    let isParty = false;
    if (role === 'USER') {
        isParty = String(order.userId || '') === idStr;
    } else if (role === 'RESTAURANT') {
        const restaurantIds = new Set([
            String(order.restaurantId || ''),
            ...(order.pickups || []).map((p) => String(p.restaurantId || '')),
        ]);
        isParty = restaurantIds.has(idStr);
    } else if (role === 'DELIVERY_PARTNER') {
        isParty = [order.dispatch?.deliveryPartnerId, order.dispatch?.sharedPartnerId]
            .map((v) => String(v || ''))
            .includes(idStr);
    }
    if (!isParty) throw new ForbiddenError('You are not a party to this order');
    return order;
}

/** Validate peerRole/peerId and, for order chats, that both caller and peer belong to the order. */
async function resolveConversationParties({ myToken, peerRole, peerId, orderId }) {
    const role = String(peerRole || '').toUpperCase();
    if (!VALID_ROLES.includes(role) && role !== 'DRIVER') throw new ValidationError('Invalid peerRole');
    const peerToken = buildToken(role, peerId);
    if (peerToken !== 'ADMIN' && !peerId) throw new ValidationError('peerId is required for this peerRole');
    if (peerToken === myToken) throw new ValidationError('Cannot chat with yourself');

    if (orderId) {
        await assertOrderMembership(orderId, myToken);
        if (peerToken !== 'ADMIN') await assertOrderMembership(orderId, peerToken);
    }

    const [partyAToken, partyBToken] = [myToken, peerToken].sort();
    return { partyAToken, partyBToken, peerToken };
}

async function findOrCreateConversation({ orderId, partyAToken, partyBToken }) {
    return FoodChatConversation.findOneAndUpdate(
        { orderId: orderId || null, partyAToken, partyBToken },
        { $setOnInsert: { orderId: orderId || null, partyAToken, partyBToken } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
    );
}

const unreadFieldFor = (conversation, myToken) =>
    conversation.partyAToken === myToken ? 'unreadForA' : 'unreadForB';

const peerTokenFor = (conversation, myToken) =>
    conversation.partyAToken === myToken ? conversation.partyBToken : conversation.partyAToken;

const ownerTargetFromToken = (token) => {
    const { role, id } = parseToken(token);
    if (role === 'ADMIN' || !id) return null;
    return { ownerType: role, ownerId: id };
};

export async function listConversations(reqUser, { orderId } = {}) {
    const myToken = myTokenFromReqUser(reqUser);
    const filter = { $or: [{ partyAToken: myToken }, { partyBToken: myToken }] };
    if (orderId) {
        if (!mongoose.Types.ObjectId.isValid(orderId)) throw new ValidationError('Invalid orderId');
        filter.orderId = new mongoose.Types.ObjectId(orderId);
    }

    const conversations = await FoodChatConversation.find(filter).sort({ lastAt: -1, updatedAt: -1 }).lean();
    return conversations.map((c) => ({
        conversationId: String(c._id),
        orderId: c.orderId ? String(c.orderId) : null,
        peerToken: peerTokenFor(c, myToken),
        lastMessage: c.lastMessage || '',
        lastAt: c.lastAt || null,
        unread: c[unreadFieldFor(c, myToken)] || 0,
        status: c.orderId ? 'order' : 'support',
    }));
}

export async function listMessages(reqUser, { peerRole, peerId, orderId }) {
    const myToken = myTokenFromReqUser(reqUser);
    const { partyAToken, partyBToken } = await resolveConversationParties({ myToken, peerRole, peerId, orderId });

    const conversation = await FoodChatConversation.findOne({
        orderId: orderId || null,
        partyAToken,
        partyBToken,
    }).lean();
    if (!conversation) return { conversationId: null, messages: [] };

    const messages = await FoodChatMessage.find({ conversationId: conversation._id })
        .sort({ createdAt: 1 })
        .lean();

    return {
        conversationId: String(conversation._id),
        messages: messages.map((m) => ({
            id: String(m._id),
            senderToken: m.senderToken,
            text: m.text,
            createdAt: m.createdAt,
        })),
    };
}

export async function sendMessage(reqUser, { peerRole, peerId, orderId, text }) {
    const trimmed = String(text || '').trim();
    if (!trimmed) throw new ValidationError('Message text is required');

    const myToken = myTokenFromReqUser(reqUser);
    const { partyAToken, partyBToken, peerToken } = await resolveConversationParties({
        myToken, peerRole, peerId, orderId,
    });

    const conversation = await findOrCreateConversation({
        orderId: orderId ? new mongoose.Types.ObjectId(orderId) : null,
        partyAToken,
        partyBToken,
    });

    const message = await FoodChatMessage.create({
        conversationId: conversation._id,
        senderToken: myToken,
        text: trimmed,
    });

    const peerUnreadField = unreadFieldFor(conversation, peerToken);
    conversation.lastMessage = trimmed;
    conversation.lastAt = message.createdAt;
    conversation.lastSenderToken = myToken;
    conversation[peerUnreadField] = (conversation[peerUnreadField] || 0) + 1;
    await conversation.save();

    // Real-time: drop it in the peer's room. ADMIN has no single room — broadcast to all admins.
    try {
        const io = getIO();
        if (io) {
            const { role: peerRoleResolved, id: peerIdResolved } = parseToken(peerToken);
            const payload = {
                conversationId: String(conversation._id),
                orderId: orderId ? String(orderId) : null,
                senderToken: myToken,
                peerToken: myToken, // from the peer's point of view, I am their peer
                text: trimmed,
                createdAt: message.createdAt,
            };
            if (peerRoleResolved === 'ADMIN') {
                io.to(rooms.adminBroadcast()).emit('chat:message', payload);
            } else if (peerRoleResolved === 'USER') {
                io.to(rooms.user(peerIdResolved)).emit('chat:message', payload);
            } else if (peerRoleResolved === 'RESTAURANT') {
                io.to(rooms.restaurant(peerIdResolved)).emit('chat:message', payload);
            } else if (peerRoleResolved === 'DELIVERY_PARTNER') {
                io.to(rooms.delivery(peerIdResolved)).emit('chat:message', payload);
            }
        }
    } catch {
        /* socket optional */
    }

    // Push: one notification per peer party. ADMIN peer fans out to every admin.
    try {
        if (peerToken === 'ADMIN') {
            await notifyAdminsSafely({
                title: 'New message',
                body: trimmed.slice(0, 120),
                data: { type: 'chat_message', orderId: orderId ? String(orderId) : '', peerRole: parseToken(myToken).role },
            });
        } else {
            const target = ownerTargetFromToken(peerToken);
            if (target) {
                await notifyOwnerSafely(target, {
                    title: 'New message',
                    body: trimmed.slice(0, 120),
                    data: {
                        type: 'chat_message',
                        orderId: orderId ? String(orderId) : '',
                        peerRole: parseToken(myToken).role,
                    },
                });
            }
        }
    } catch {
        /* push is best-effort */
    }

    return {
        conversationId: String(conversation._id),
        message: { id: String(message._id), senderToken: myToken, text: trimmed, createdAt: message.createdAt },
    };
}

export async function markConversationRead(reqUser, conversationId) {
    if (!mongoose.Types.ObjectId.isValid(conversationId)) throw new ValidationError('Invalid conversationId');
    const myToken = myTokenFromReqUser(reqUser);

    const conversation = await FoodChatConversation.findOne({
        _id: conversationId,
        $or: [{ partyAToken: myToken }, { partyBToken: myToken }],
    });
    if (!conversation) throw new NotFoundError('Conversation not found');

    conversation[unreadFieldFor(conversation, myToken)] = 0;
    await conversation.save();
    return { conversationId: String(conversation._id), unread: 0 };
}
