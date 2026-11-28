import mongoose from 'mongoose';
import { SupportChatThread, SupportChatMessage, SupportChatSettings, CHAT_ROLES } from './supportChat.model.js';
import { ValidationError, ForbiddenError, NotFoundError } from '../auth/errors.js';
import { getBroadcaster, rooms } from '../../config/socket.js';
import { notifyOwnerSafely, notifyAdminsSafely } from '../notifications/firebase.service.js';
import { FoodUser } from '../users/user.model.js';
import { FoodRestaurant } from '../../modules/food/restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../../modules/food/delivery/models/deliveryPartner.model.js';
import { Seller } from '../../modules/quick-commerce/seller/models/seller.model.js';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_PAGE = 50;

/* ───────────── settings + chat-window check ───────────── */

// shortcut: per-process cache, so another server instance sees a settings change after <= TTL; use a redis key if that matters.
const SETTINGS_TTL_MS = 15_000;
let cache = { at: 0, doc: null };

async function loadSettings() {
    if (cache.doc && Date.now() - cache.at < SETTINGS_TTL_MS) return cache.doc;
    const doc = await SupportChatSettings.findOneAndUpdate(
        { key: 'main' },
        { $setOnInsert: { key: 'main' } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();
    cache = { at: Date.now(), doc };
    return doc;
}

const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** Is chat open right now, in the admin-chosen timezone? */
export function computeStatus(s, now = new Date()) {
    const base = {
        enabled: s.enabled, timezone: s.timezone, startTime: s.startTime, endTime: s.endTime,
        days: s.days, closedMessage: s.closedMessage,
    };
    if (!s.enabled) return { ...base, open: false };
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: s.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    const cur = Number(get('hour')) * 60 + Number(get('minute'));
    const start = toMinutes(s.startTime);
    const end = toMinutes(s.endTime);
    let open;
    if (start === end) open = s.days.includes(day); // same time = all day
    else if (start < end) open = s.days.includes(day) && cur >= start && cur < end;
    else open = (cur >= start && s.days.includes(day)) || (cur < end && s.days.includes((day + 6) % 7)); // runs past midnight
    return { ...base, open };
}

export async function getStatus() {
    return computeStatus(await loadSettings());
}

async function assertOpen() {
    const status = await getStatus();
    if (!status.open) throw new ForbiddenError(status.closedMessage || 'Chat is closed right now');
    return status;
}

export const getSettings = getStatus;

export async function updateSettings(body = {}) {
    const patch = {};
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
    if (body.startTime !== undefined) {
        if (!HHMM.test(body.startTime)) throw new ValidationError('startTime must be HH:mm');
        patch.startTime = body.startTime;
    }
    if (body.endTime !== undefined) {
        if (!HHMM.test(body.endTime)) throw new ValidationError('endTime must be HH:mm');
        patch.endTime = body.endTime;
    }
    if (body.timezone !== undefined) {
        try { new Intl.DateTimeFormat('en-US', { timeZone: body.timezone }); } catch { throw new ValidationError('Invalid timezone'); }
        patch.timezone = body.timezone;
    }
    if (body.days !== undefined) {
        if (!Array.isArray(body.days) || body.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
            throw new ValidationError('days must be numbers 0-6');
        }
        patch.days = [...new Set(body.days)];
    }
    if (body.closedMessage !== undefined) patch.closedMessage = String(body.closedMessage).slice(0, 200);

    const doc = await SupportChatSettings.findOneAndUpdate(
        { key: 'main' }, { $set: patch }, { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();
    cache = { at: Date.now(), doc };
    const status = computeStatus(doc);
    // Tell every connected chat screen so the input enables/disables without a refresh.
    emit([ALL_ROOM], 'support_chat:settings', status);
    return status;
}

/* ───────────── helpers ───────────── */

// Every chat screen joins this room (see config/socket.js) to hear settings changes.
export const ALL_ROOM = 'support_chat_all';

export const normalizeRole = (role) => {
    const r = String(role || '').toUpperCase();
    return r === 'DRIVER' ? 'DELIVERY_PARTNER' : r;
};

const roomFor = (role, id) => ({
    USER: rooms.user, SELLER: rooms.seller, RESTAURANT: rooms.restaurant, DELIVERY_PARTNER: rooms.delivery,
}[role]?.(id));

/** Fire-and-forget realtime emit; never lets a socket problem fail the request. */
async function emit(roomList, event, payload) {
    try {
        const b = await getBroadcaster();
        if (!b) return;
        let t = b;
        for (const r of roomList.filter(Boolean)) t = t.to(r);
        t.emit(event, payload);
    } catch { /* realtime is best-effort; clients refetch on reconnect */ }
}

const profileLoaders = {
    USER: (id) => FoodUser.findById(id).select('name phone').lean().then((d) => d && { name: d.name, phone: d.phone }),
    SELLER: (id) => Seller.findById(id).select('shopName name phone').lean().then((d) => d && { name: d.shopName || d.name, phone: d.phone }),
    RESTAURANT: (id) => FoodRestaurant.findById(id).select('restaurantName ownerPhone').lean().then((d) => d && { name: d.restaurantName, phone: d.ownerPhone }),
    DELIVERY_PARTNER: (id) => FoodDeliveryPartner.findById(id).select('name phone').lean().then((d) => d && { name: d.name, phone: d.phone }),
};

async function findOrCreateThread(role, id) {
    const existing = await SupportChatThread.findOne({ participantRole: role, participantId: id });
    if (existing) return existing;
    const profile = await profileLoaders[role](id);
    if (!profile) throw new NotFoundError('Account not found');
    try {
        return await SupportChatThread.create({
            participantRole: role, participantId: id, name: profile.name || '', phone: profile.phone || '',
        });
    } catch (e) {
        if (e.code === 11000) return SupportChatThread.findOne({ participantRole: role, participantId: id }); // lost a creation race
        throw e;
    }
}

const mapThread = (t) => ({
    id: String(t._id),
    role: t.participantRole,
    participantId: String(t.participantId),
    name: t.name,
    phone: t.phone,
    lastMessage: t.lastMessage,
    lastAt: t.lastAt,
    lastSender: t.lastSender,
    unreadForAdmin: t.unreadForAdmin,
    unreadForParticipant: t.unreadForParticipant,
});

const mapMessage = (m) => ({
    id: String(m._id),
    threadId: String(m.threadId),
    sender: m.sender,
    text: m.text,
    clientId: m.clientId || null,
    createdAt: m.createdAt,
});

const validId = (id) => {
    if (!mongoose.Types.ObjectId.isValid(id)) throw new ValidationError('Invalid id');
    return new mongoose.Types.ObjectId(id);
};

/** Cursor pagination: newest first by _id, returned oldest-first. `before` = a message id. */
async function pageMessages(threadId, { before, limit }) {
    const lim = Math.min(Math.max(parseInt(limit, 10) || 30, 1), MAX_PAGE);
    const q = { threadId };
    if (before) q._id = { $lt: validId(before) };
    const rows = await SupportChatMessage.find(q).sort({ _id: -1 }).limit(lim + 1).lean();
    const hasMore = rows.length > lim;
    return { messages: rows.slice(0, lim).reverse().map(mapMessage), hasMore };
}

/** Shared by both sides. `from` is who is sending. */
async function postMessage(thread, from, senderId, { text, clientId }) {
    const trimmed = String(text || '').trim();
    if (!trimmed) throw new ValidationError('Message text is required');
    if (trimmed.length > 2000) throw new ValidationError('Message is too long (max 2000)');
    const cid = clientId ? String(clientId).slice(0, 64) : undefined;
    await assertOpen();

    let message;
    try {
        message = await SupportChatMessage.create({ threadId: thread._id, sender: from, senderId, text: trimmed, clientId: cid });
    } catch (e) {
        if (e.code === 11000 && cid) { // retry of a message already stored: return it, do not notify twice
            const dup = await SupportChatMessage.findOne({ threadId: thread._id, clientId: cid }).lean();
            return { thread: mapThread(thread), message: mapMessage(dup), duplicate: true };
        }
        throw e;
    }

    const unreadField = from === 'ADMIN' ? 'unreadForParticipant' : 'unreadForAdmin';
    const updated = await SupportChatThread.findByIdAndUpdate(
        thread._id,
        { $set: { lastMessage: trimmed.slice(0, 200), lastAt: message.createdAt, lastSender: from }, $inc: { [unreadField]: 1 } },
        { new: true },
    ).lean();

    const payload = { thread: mapThread(updated), message: mapMessage(message) };
    // Peer + sender's other devices get it; the sender's own client dedupes by id / clientId.
    emit([rooms.adminBroadcast(), roomFor(updated.participantRole, updated.participantId)], 'support_chat:message', payload);

    try {
        if (from === 'ADMIN') {
            await notifyOwnerSafely(
                { ownerType: updated.participantRole, ownerId: String(updated.participantId) },
                { title: 'Message from support', body: trimmed.slice(0, 120), data: { type: 'support_chat', threadId: String(updated._id) } },
            );
        } else {
            await notifyAdminsSafely({
                title: updated.name || 'New support message', body: trimmed.slice(0, 120),
                data: { type: 'support_chat', threadId: String(updated._id), role: updated.participantRole },
            });
        }
    } catch { /* push is best-effort */ }

    return payload;
}

async function markRead(thread, side) {
    const field = side === 'ADMIN' ? 'unreadForAdmin' : 'unreadForParticipant';
    if (!thread[field]) return mapThread(thread); // nothing to clear: skip the write
    const updated = await SupportChatThread.findByIdAndUpdate(thread._id, { $set: { [field]: 0 } }, { new: true }).lean();
    emit([rooms.adminBroadcast(), roomFor(updated.participantRole, updated.participantId)], 'support_chat:read', {
        threadId: String(updated._id), by: side,
    });
    return mapThread(updated);
}

/* ───────────── participant side (my own thread) ───────────── */

const myParts = (reqUser) => {
    const role = normalizeRole(reqUser?.role);
    if (!CHAT_ROLES.includes(role)) throw new ForbiddenError('This account cannot use support chat');
    return { role, id: validId(reqUser.userId) };
};

export async function getMyChat(reqUser) {
    const { role, id } = myParts(reqUser);
    const [status, thread] = await Promise.all([
        getStatus(),
        SupportChatThread.findOne({ participantRole: role, participantId: id }).lean(),
    ]);
    return { status, thread: thread ? mapThread(thread) : null };
}

export async function listMyMessages(reqUser, query) {
    const { role, id } = myParts(reqUser);
    const thread = await SupportChatThread.findOne({ participantRole: role, participantId: id }).select('_id').lean();
    if (!thread) return { messages: [], hasMore: false };
    return pageMessages(thread._id, query);
}

export async function sendMyMessage(reqUser, body) {
    const { role, id } = myParts(reqUser);
    const thread = await findOrCreateThread(role, id);
    return postMessage(thread, 'PARTICIPANT', id, body);
}

export async function markMyRead(reqUser) {
    const { role, id } = myParts(reqUser);
    const thread = await SupportChatThread.findOne({ participantRole: role, participantId: id });
    if (!thread) return { thread: null };
    return { thread: await markRead(thread, 'PARTICIPANT') };
}

/* ───────────── admin side ───────────── */

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function adminListThreads({ role, q, cursor, limit, unread }) {
    const lim = Math.min(Math.max(parseInt(limit, 10) || 30, 1), MAX_PAGE);
    // Threads that never got a message (admin opened and left) stay out of the inbox.
    const filter = { lastAt: { $ne: null } };
    if (role) {
        const r = normalizeRole(role);
        if (!CHAT_ROLES.includes(r)) throw new ValidationError('Invalid role');
        filter.participantRole = r;
    }
    if (String(unread) === 'true') filter.unreadForAdmin = { $gt: 0 };
    const search = String(q || '').trim().slice(0, 50);
    if (search) {
        const rx = new RegExp(escapeRegex(search), 'i');
        filter.$or = [{ name: rx }, { phone: rx }];
    }
    if (cursor) {
        const [at, id] = String(cursor).split('_');
        const d = new Date(at);
        if (Number.isNaN(d.getTime()) || !mongoose.Types.ObjectId.isValid(id)) throw new ValidationError('Invalid cursor');
        filter.$and = [{ $or: [{ lastAt: { $lt: d } }, { lastAt: d, _id: { $lt: new mongoose.Types.ObjectId(id) } }] }];
    }
    const rows = await SupportChatThread.find(filter).sort({ lastAt: -1, _id: -1 }).limit(lim + 1).lean();
    const hasMore = rows.length > lim;
    const page = rows.slice(0, lim);
    const last = page[page.length - 1];
    return {
        threads: page.map(mapThread),
        hasMore,
        nextCursor: hasMore && last ? `${last.lastAt.toISOString()}_${last._id}` : null,
    };
}

export async function adminUnreadTotal() {
    const [row] = await SupportChatThread.aggregate([{ $group: { _id: null, n: { $sum: '$unreadForAdmin' } } }]);
    return { unread: row?.n || 0 };
}

/** Find accounts to start a conversation with (admin-initiated chat). */
export async function adminSearchParticipants({ role, q }) {
    const r = normalizeRole(role);
    if (!CHAT_ROLES.includes(r)) throw new ValidationError('Invalid role');
    const search = String(q || '').trim().slice(0, 50);
    if (search.length < 2) return { results: [] };
    const rx = new RegExp(escapeRegex(search), 'i');
    const [Model, fields] = {
        USER: [FoodUser, ['name', 'phone']],
        SELLER: [Seller, ['shopName', 'name', 'phone']],
        RESTAURANT: [FoodRestaurant, ['restaurantName', 'ownerPhone']],
        DELIVERY_PARTNER: [FoodDeliveryPartner, ['name', 'phone']],
    }[r];
    const rows = await Model.find({ $or: fields.map((f) => ({ [f]: rx })) }).select(fields.join(' ')).limit(10).lean();
    return {
        results: rows.map((d) => ({
            role: r,
            participantId: String(d._id),
            name: d.shopName || d.restaurantName || d.name || '',
            phone: d.ownerPhone || d.phone || '',
        })),
    };
}

export async function adminOpenThread({ role, participantId }) {
    const r = normalizeRole(role);
    if (!CHAT_ROLES.includes(r)) throw new ValidationError('Invalid role');
    return { thread: mapThread(await findOrCreateThread(r, validId(participantId))) };
}

async function adminThread(threadId) {
    const thread = await SupportChatThread.findById(validId(threadId));
    if (!thread) throw new NotFoundError('Conversation not found');
    return thread;
}

export async function adminListMessages(threadId, query) {
    const thread = await adminThread(threadId);
    return { thread: mapThread(thread), ...(await pageMessages(thread._id, query)) };
}

export async function adminSendMessage(reqUser, threadId, body) {
    return postMessage(await adminThread(threadId), 'ADMIN', validId(reqUser.userId), body);
}

export async function adminMarkRead(threadId) {
    return { thread: await markRead(await adminThread(threadId), 'ADMIN') };
}
