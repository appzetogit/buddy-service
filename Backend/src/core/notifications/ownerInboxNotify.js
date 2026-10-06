import mongoose from 'mongoose';
import { getIO } from '../../config/socket.js';
import { createInboxNotifications } from './notification.service.js';
import { notifyOwnerSafely, notifyOwnersSafely } from './firebase.service.js';

const INBOX_OWNER_TYPES = new Set(['USER', 'RESTAURANT', 'DELIVERY_PARTNER']);

/** Offer / hunt pushes are ephemeral — keep FCM+socket, skip bell spam. */
const SKIP_INBOX_TYPES = new Set([
    'new_order_available',
    'dispatch_offer',
    'play_notification_sound',
]);

const resolveMessage = (payload = {}) =>
    String(payload.body || payload.message || '').trim();

const resolveLink = (payload = {}) =>
    String(payload.link || payload.data?.link || payload.data?.targetUrl || '').trim();

const resolveCategory = (payload = {}) =>
    String(payload.category || payload.data?.type || 'system').trim();

const resolveSource = (payload = {}) => {
    const explicit = String(payload.source || '').trim().toUpperCase();
    if (explicit) return explicit;
    return resolveCategory(payload);
};

const resolveDedupeKey = (payload = {}, ownerType, ownerId) => {
    const explicit = String(payload.dedupeKey || payload.metadata?.dedupeKey || '').trim();
    if (explicit) return explicit;
    const type = String(payload.data?.type || payload.category || '').trim();
    const orderId = String(
        payload.data?.orderId ||
            payload.data?.orderMongoId ||
            payload.data?.withdrawalId ||
            payload.data?.categoryId ||
            payload.data?.id ||
            '',
    ).trim();
    if (type && orderId) return `${type}:${orderId}:${ownerType}:${ownerId}`;
    return '';
};

const shouldSkipInbox = (payload = {}) => {
    if (payload?.skipInbox === true) return true;
    const type = String(payload?.data?.type || '').trim().toLowerCase();
    return SKIP_INBOX_TYPES.has(type);
};

/** Admin dashboard has no per-admin socket room — a single broadcast event is enough. */
export const emitAdminBellRefresh = async (extra = {}) => {
    try {
        const io = getIO();
        if (!io) return;
        io.emit('admin_notification', { type: 'refresh', ...extra });
    } catch {
        // Non-blocking
    }
};

export const notifyOwnerWithInbox = async (target = {}, payload = {}) => {
    const ownerType = String(target?.ownerType || '').toUpperCase();
    const ownerId = target?.ownerId;
    const title = String(payload?.title || 'Notification').trim();
    const message = resolveMessage(payload);
    const skipInbox = shouldSkipInbox(payload);
    const link = resolveLink(payload);

    if (
        !skipInbox &&
        ownerType &&
        ownerId &&
        INBOX_OWNER_TYPES.has(ownerType) &&
        title &&
        message &&
        mongoose.Types.ObjectId.isValid(String(ownerId))
    ) {
        const category = resolveCategory(payload);
        const source = resolveSource(payload);
        const dedupeKey = resolveDedupeKey(payload, ownerType, ownerId);
        const metadata =
            payload?.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
                ? payload.metadata
                : {};

        try {
            await createInboxNotifications({
                notifications: [
                    {
                        ownerType,
                        ownerId,
                        title,
                        message,
                        source,
                        ...(link ? { link } : {}),
                        ...(category ? { category } : {}),
                        ...(dedupeKey ? { dedupeKey } : {}),
                        metadata: {
                            ...metadata,
                            ...(payload?.data && typeof payload.data === 'object' ? { data: payload.data } : {}),
                        },
                    },
                ],
            });
        } catch (err) {
            console.error('notifyOwnerWithInbox: inbox persist failed:', err?.message || err);
        }
    }

    const pushPayload = {
        ...payload,
        ...(message ? { body: message } : {}),
    };
    delete pushPayload.skipInbox;
    delete pushPayload.dedupeKey;

    return notifyOwnerSafely(target, pushPayload);
};

export const notifyOwnersWithInbox = async (targets = [], payload = {}) => {
    const uniqueTargets = Array.isArray(targets)
        ? [...new Map(
              targets
                  .filter((t) => t?.ownerType && t?.ownerId)
                  .map((t) => [`${t.ownerType}:${t.ownerId}`, t])
          ).values()]
        : [];

    if (!uniqueTargets.length) return [];

    const message = resolveMessage(payload);
    const link = resolveLink(payload);
    const category = resolveCategory(payload);
    const source = resolveSource(payload);
    const title = String(payload?.title || 'Notification').trim();
    const skipInbox = shouldSkipInbox(payload);

    const inboxTargets = uniqueTargets.filter(
        (t) =>
            INBOX_OWNER_TYPES.has(String(t.ownerType || '').toUpperCase()) &&
            mongoose.Types.ObjectId.isValid(String(t.ownerId))
    );

    if (!skipInbox && inboxTargets.length && title && message) {
        try {
            await createInboxNotifications({
                notifications: inboxTargets.map((t) => {
                    const ownerType = String(t.ownerType).toUpperCase();
                    const dedupeKey = resolveDedupeKey(payload, ownerType, t.ownerId);
                    return {
                        ownerType,
                        ownerId: t.ownerId,
                        title,
                        message,
                        source,
                        ...(link ? { link } : {}),
                        ...(category ? { category } : {}),
                        ...(dedupeKey ? { dedupeKey } : {}),
                        metadata: {
                            ...(payload?.data && typeof payload.data === 'object' ? { data: payload.data } : {}),
                        },
                    };
                }),
            });
        } catch (err) {
            console.error('notifyOwnersWithInbox: inbox persist failed:', err?.message || err);
        }
    }

    const pushPayload = {
        ...payload,
        ...(message ? { body: message } : {}),
    };
    delete pushPayload.skipInbox;
    delete pushPayload.dedupeKey;

    return notifyOwnersSafely(uniqueTargets, pushPayload);
};
