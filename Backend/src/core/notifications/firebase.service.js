/**
 * FCM push delivery.
 *
 * Sends via the firebase-admin SDK (initialised once in config/firebase.js). This module used
 * to hand-roll a service-account JWT, mint its own OAuth token into a private cache, and POST
 * once per token — a second, independent Firebase credential path with its own failure modes,
 * only one of which was checked at boot.
 */
import { FoodUser } from '../users/user.model.js';
import { FoodRestaurant } from '../../modules/food/restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../../modules/food/delivery/models/deliveryPartner.model.js';
import { Admin } from '../admin/admin.model.js';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

const OWNER_MODELS = {
    USER: FoodUser,
    RESTAURANT: FoodRestaurant,
    DELIVERY_PARTNER: FoodDeliveryPartner,
    ADMIN: Admin
};
const OWNER_TOKEN_FIELDS = {
    web: 'fcmTokens',
    mobile: 'fcmTokenMobile'
};
/**
 * Dedicated notification channel for time-critical driver offers. The client must create an
 * Android channel with this exact id (and a bundled `order_ring` sound) for the ring to apply;
 * otherwise Android silently falls back to the default channel behaviour.
 */
const RING_CHANNEL_ID = 'order_ring';
const RING_SOUND = 'order_ring';
const OWNER_APP_PREFIXES = {
    USER: '👤 [User]',
    RESTAURANT: '🏪 [Shop]',
    DELIVERY_PARTNER: '🛵 [Rider]',
    ADMIN: '🛡️ [Admin]'
};

/**
 * Unified identity JWT uses role=DRIVER; food push targets use DELIVERY_PARTNER.
 * Map aliases so /fcm-tokens/save works for both token shapes.
 */
export const normalizeFcmOwnerType = (ownerType) => {
    const normalized = String(ownerType || '').trim().toUpperCase();
    if (normalized === 'USER') return 'USER';
    if (normalized === 'RESTAURANT') return 'RESTAURANT';
    if (normalized === 'ADMIN') return 'ADMIN';
    if (normalized === 'DELIVERY_PARTNER' || normalized === 'DRIVER') return 'DELIVERY_PARTNER';
    return null;
};

const sanitizeString = (value) => String(value ?? '').trim();

const normalizeDataMap = (data = {}) => {
    const result = {};
    for (const [key, value] of Object.entries(data || {})) {
        if (value === undefined || value === null) continue;
        result[String(key)] = String(value);
    }
    return result;
};

const buildMessagePayload = (payload = {}, token) => {
    const message = buildMessageBody(payload);
    return token ? { ...message, token } : message;
};

/**
 * Build the FCM v1 message body WITHOUT a token, so it can be reused for a multicast send.
 * (buildMessagePayload above keeps the single-token shape for any legacy caller.)
 */
const buildMessageBody = (payload = {}) => {
    const notification = {
        title: sanitizeString(payload.title || payload.notification?.title || 'New notification'),
        body: sanitizeString(payload.body || payload.notification?.body || '')
    };
    const data = normalizeDataMap(payload.data || {});
    const image =
        sanitizeString(payload.icon || payload.notification?.image || payload.notification?.icon || data.image || data.imageUrl);

    // If payload.dataOnly is true, we omit the 'notification' block.
    // This prevents FCM from auto-displaying while allowing app code to show a 'Local Notification'.
    const message = {};

    if (!payload.dataOnly) {
        message.notification = notification;
        if (image) {
            message.notification.image = image;
        }
    }

    if (Object.keys(data).length > 0) {
        message.data = data;
    }

    // Time-critical offers (driver dispatch) ring on a dedicated max-priority channel so they
    // cut through on a killed app. NOTE: a true full-screen "ringing" UI must be implemented by
    // the client — the server can only set the channel/priority/sound fields below.
    const isRing = Boolean(payload.ring);
    if (isRing) {
        message.data = { ...(message.data || {}), ring: 'true' };
    }

    message.android = {
        priority: 'high',
        ...(isRing ? { ttl: 60 * 1000 } : {}),
        notification: {
            channel_id: isRing ? RING_CHANNEL_ID : 'default',
            sound: isRing ? RING_SOUND : 'default',
            default_light_settings: true,
            ...(isRing
                // vibrate_timings and default_vibrate_timings are mutually exclusive.
                ? {
                    vibrate_timings: ['0s', '0.8s', '0.4s', '0.8s'],
                    notification_priority: 'PRIORITY_MAX',
                    visibility: 'PUBLIC',
                }
                : { default_vibrate_timings: true }),
        }
    };

    message.apns = {
        headers: { 'apns-priority': '10' },
        payload: {
            aps: {
                sound: isRing ? `${RING_SOUND}.caf` : 'default',
                ...(isRing ? { 'interruption-level': 'time-sensitive' } : {}),
            },
        },
    };

    message.webpush = {
        headers: {
            Urgency: 'high'
        },
        notification: {
            title: notification.title,
            body: notification.body,
            icon: image || payload.icon || '/favicon.ico',
            ...(isRing ? { requireInteraction: true } : {}),
        }
    };

    return message;
};

const getOwnerModel = (ownerType) => {
    const normalized = normalizeFcmOwnerType(ownerType);
    return normalized ? OWNER_MODELS[normalized] || null : null;
};

const getTokenFieldForPlatform = (platform) => OWNER_TOKEN_FIELDS[platform === 'mobile' ? 'mobile' : 'web'];

/**
 * Normalize a stored token array to "oldest first, most recently registered last", capped at 10.
 *
 * Dedupe keeps the LAST occurrence, not the first. This matters: `[...new Set(...)]` preserves
 * FIRST insertion order, so re-registering a token that was already in the array left it sitting
 * at its original position instead of promoting it. Combined with pickLatestTokenOnly (which
 * reads the tail), a rider returning to a previously-used device silently stopped receiving
 * pushes — they kept going to whichever device last registered a genuinely new token.
 */
const normalizeTokenList = (tokens = []) => {
    const raw = (Array.isArray(tokens) ? tokens : [tokens]).map(sanitizeString).filter(Boolean);
    const seen = new Set();
    const newestFirst = [];
    for (let i = raw.length - 1; i >= 0; i -= 1) {
        if (seen.has(raw[i])) continue;
        seen.add(raw[i]);
        newestFirst.push(raw[i]);
    }
    return newestFirst.reverse().slice(-10);
};

const pickLatestTokenOnly = (tokens = []) => {
    const normalized = normalizeTokenList(tokens);
    if (!normalized.length) return [];
    return [normalized[normalized.length - 1]];
};

const readTokensFromDoc = (doc, platform) => {
    if (!doc) return [];
    if (platform) {
        return normalizeTokenList(doc[getTokenFieldForPlatform(platform)] || []);
    }
    return normalizeTokenList([
        ...(Array.isArray(doc.fcmTokens) ? doc.fcmTokens : []),
        ...(Array.isArray(doc.fcmTokenMobile) ? doc.fcmTokenMobile : [])
    ]);
};

export const listOwnerTokens = async ({ ownerType, ownerId, platform }) => {
    if (!ownerType || !ownerId) return [];
    const model = getOwnerModel(ownerType);
    if (!model) return [];
    const doc = await model.findById(ownerId).select('fcmTokens fcmTokenMobile').lean();
    return readTokensFromDoc(doc, platform);
};

export const upsertFirebaseDeviceToken = async ({ ownerType, ownerId, token, platform = 'web' }) => {
    const normalizedToken = sanitizeString(token);
    const normalizedOwnerType = normalizeFcmOwnerType(ownerType);
    console.log(`[FCM-DEBUG] upsertFirebaseDeviceToken: ownerType=${ownerType}→${normalizedOwnerType}, ownerId=${ownerId}, platform=${platform}, tokenPreview=${normalizedToken?.slice(0, 10)}...`);

    if (!normalizedOwnerType || !ownerId || !normalizedToken) {
        console.error('[FCM-DEBUG] upsert - Missing required fields');
        throw new Error('ownerType, ownerId, and token are required.');
    }

    const normalizedPlatform = platform === 'mobile' ? 'mobile' : 'web';
    const model = getOwnerModel(normalizedOwnerType);
    if (!model) {
        console.error(`[FCM-DEBUG] upsert - Unsupported owner type: ${ownerType}`);
        throw new Error(`Unsupported owner type: ${ownerType}`);
    }

    const doc = await model.findById(ownerId);
    if (!doc) {
        console.error(`[FCM-DEBUG] upsert - Owner profile not found for id ${ownerId}`);
        throw new Error('Owner profile not found.');
    }

    const field = getTokenFieldForPlatform(normalizedPlatform);
    const existingTokens = Array.isArray(doc[field]) ? doc[field] : [];
    console.log(`[FCM-DEBUG] upsert - Current tokens in DB count: ${existingTokens.length}`);

    const tokens = normalizeTokenList([...existingTokens, normalizedToken]);
    doc[field] = tokens;

    await doc.save();
    console.log(`[FCM-DEBUG] upsert - Token list updated. New count: ${tokens.length}`);
    return { success: true, ownerType: normalizedOwnerType };
};

export const removeFirebaseDeviceToken = async ({ ownerType, ownerId, token, platform }) => {
    const normalizedToken = sanitizeString(token);
    if (!ownerType || !ownerId || !normalizedToken) {
        throw new Error('ownerType, ownerId, and token are required.');
    }
    const model = getOwnerModel(ownerType);
    if (!model) {
        throw new Error(`Unsupported owner type: ${ownerType}`);
    }
    const doc = await model.findById(ownerId);
    if (!doc) {
        return { success: false };
    }

    if (platform) {
        const field = getTokenFieldForPlatform(platform);
        doc[field] = normalizeTokenList((Array.isArray(doc[field]) ? doc[field] : []).filter((t) => t !== normalizedToken));
    } else {
        doc.fcmTokens = normalizeTokenList((Array.isArray(doc.fcmTokens) ? doc.fcmTokens : []).filter((t) => t !== normalizedToken));
        doc.fcmTokenMobile = normalizeTokenList(
            (Array.isArray(doc.fcmTokenMobile) ? doc.fcmTokenMobile : []).filter((t) => t !== normalizedToken)
        );
    }

    await doc.save();
    return { success: true };
};

/** FCM caps a multicast at 500 tokens per call. */
const MULTICAST_BATCH_SIZE = 500;

/** Admin SDK error codes that mean the token is dead and should be dropped. */
const UNREGISTERED_CODES = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/invalid-argument',
]);

/**
 * Send a push to one or more device tokens.
 *
 * Uses the Admin SDK's multicast instead of one HTTP request per token. The previous
 * implementation hand-rolled a service-account JWT, minted its own OAuth token, and issued a
 * separate `fetch` per token — so a broadcast to 50 riders was 50 round trips, on an order with
 * a 60-second offer window.
 *
 * Return shape is unchanged for callers: { successCount, failureCount, results[] }.
 */
export const sendPushNotification = async (tokens, payload = {}) => {
    const uniqueTokens = normalizeTokenList(tokens);
    if (uniqueTokens.length === 0) {
        return { successCount: 0, failureCount: 0, results: [] };
    }

    const { getFirebaseMessaging } = await import('../../config/firebase.js');
    let messaging;
    try {
        messaging = getFirebaseMessaging();
    } catch (err) {
        logger.error(`FCM send aborted — messaging not initialized: ${err.message}`);
        return {
            successCount: 0,
            failureCount: uniqueTokens.length,
            results: uniqueTokens.map((token) => ({ token, ok: false, remove: false, error: err.message })),
        };
    }

    const body = buildMessageBody(payload);
    const results = [];

    for (let i = 0; i < uniqueTokens.length; i += MULTICAST_BATCH_SIZE) {
        const batch = uniqueTokens.slice(i, i + MULTICAST_BATCH_SIZE);
        try {
            // sendEachForMulticast reports per-token success rather than failing the whole batch.
            const res = await messaging.sendEachForMulticast({ ...body, tokens: batch });
            res.responses.forEach((r, idx) => {
                if (r.success) {
                    results.push({ token: batch[idx], ok: true, response: { name: r.messageId } });
                } else {
                    const code = r.error?.code || '';
                    results.push({
                        token: batch[idx],
                        ok: false,
                        remove: UNREGISTERED_CODES.has(code),
                        error: r.error?.message || code || 'FCM send failed',
                        code,
                    });
                }
            });
        } catch (error) {
            // Whole-batch failure (network, auth, quota) — retryable, so do NOT drop tokens.
            logger.warn(`FCM multicast batch failed: ${error?.message || error}`);
            batch.forEach((token) => {
                results.push({ token, ok: false, remove: false, error: error?.message || String(error) });
            });
        }
    }

    const successCount = results.filter((r) => r.ok).length;
    return { successCount, failureCount: results.length - successCount, results };
};

/**
 * Write a delivery receipt. Never throws and never blocks the send — a telemetry failure must
 * not become a notification failure.
 */
const recordPushReceipt = async ({
    ownerType, ownerId, payload = {}, status, tokensTargeted = 0,
    successCount = 0, failureCount = 0, errorCodes, error = null, attempt = 1,
}) => {
    try {
        const { PushReceipt } = await import('./pushReceipt.model.js');
        await PushReceipt.create({
            ownerType: normalizeFcmOwnerType(ownerType) || 'USER',
            ownerId: String(ownerId),
            type: sanitizeString(payload?.data?.type) || 'unknown',
            orderId: payload?.data?.orderId ? String(payload.data.orderId) : null,
            title: sanitizeString(payload?.title).slice(0, 200),
            status,
            tokensTargeted,
            successCount,
            failureCount,
            attempt: Number(attempt) || 1,
            errorCodes: errorCodes?.length ? errorCodes.slice(0, 5) : undefined,
            error: error ? String(error).slice(0, 500) : null,
        });
    } catch (err) {
        logger.warn(`Push receipt write failed: ${err.message}`);
    }
};

/**
 * @param {object}  params
 * @param {boolean} [params.options.throwOnTotalFailure] - rethrow retryable total failures so a
 *   queue worker can retry. Off by default: direct callers keep the old swallow behaviour.
 * @param {number}  [params.options.attempt] - BullMQ attempt number, recorded on the receipt.
 */
export const sendNotificationToOwner = async ({ ownerType, ownerId, payload, platform, options = {} } = {}) => {
    // 💡 Clone the payload to avoid side-effects (e.g. adding multiple prefixes to the same object during broadcasting)
    const enrichedPayload = { ...payload };

    // 🏷️ Add Highlighter Prefix to the Title
    if (enrichedPayload && !enrichedPayload.skipHighlighter) {
        const typeKey = String(ownerType || '').toUpperCase();
        const prefix = OWNER_APP_PREFIXES[typeKey] || '';

        if (prefix) {
            // Get original title from any potential field
            let originalTitle = enrichedPayload.title || enrichedPayload.notification?.title || 'New notification';

            // Safety: Ensure we don't ADD the prefix if it's already there (defensive check)
            if (!originalTitle.includes(prefix)) {
                enrichedPayload.title = `${prefix} ${originalTitle}`.trim();
            } else {
                enrichedPayload.title = originalTitle;
            }
        }
    }

    const tokens = await listOwnerTokens({ ownerType, ownerId, platform });
    // Default behavior: send to latest active token only to avoid duplicate pushes
    // from stale token history on the same device/account.
    const shouldFanoutAllDevices = payload?.sendToAllDevices === true;
    const targetTokens = shouldFanoutAllDevices ? normalizeTokenList(tokens) : pickLatestTokenOnly(tokens);
    if (!targetTokens.length) {
        // A recipient with no registered token is itself a delivery failure worth seeing —
        // it is the difference between "push failed" and "push was never possible".
        await recordPushReceipt({
            ownerType, ownerId, payload: enrichedPayload,
            status: 'failed', tokensTargeted: 0, successCount: 0, failureCount: 0,
            error: 'no registered device token',
            attempt: options.attempt,
        });
        return { successCount: 0, failureCount: 0, results: [] };
    }
    try {
        console.log(`[FCM] Sending to ${ownerType}:${ownerId}. Title: "${enrichedPayload.title || 'Data Only'}"`);
        const response = await sendPushNotification(targetTokens, enrichedPayload);

        await recordPushReceipt({
            ownerType, ownerId, payload: enrichedPayload,
            status: response.successCount > 0
                ? (response.failureCount > 0 ? 'partial' : 'sent')
                : 'failed',
            tokensTargeted: targetTokens.length,
            successCount: response.successCount,
            failureCount: response.failureCount,
            errorCodes: [...new Set((response.results || [])
                .filter((r) => !r.ok)
                .map((r) => r.code || r.error)
                .filter(Boolean))],
            attempt: options.attempt,
        });

        // A send where every token failed for a RETRYABLE reason must surface to the caller so
        // the queue can retry it. Unregistered-token failures are terminal and must not.
        if (response.successCount === 0 && response.failureCount > 0) {
            const allTerminal = (response.results || []).every((r) => r.ok || r.remove);
            if (!allTerminal && options.throwOnTotalFailure) {
                throw new Error(
                    `FCM delivery failed for all ${response.failureCount} token(s): ` +
                    `${response.results?.find((r) => !r.ok)?.error || 'unknown'}`,
                );
            }
        }

        const invalidTokens = (response.results || [])
            .filter((item) => !item.ok && item.remove)
            .map((item) => item.token)
            .filter(Boolean);
        // Pruning dead tokens is housekeeping, and must not be able to rewrite the outcome of
        // a send that already happened: a validation error on an unrelated field of the owner
        // document used to fall through to the catch below and log the whole push as failed.
        if (invalidTokens.length > 0) {
            try {
                const model = getOwnerModel(ownerType);
                const doc = model ? await model.findById(ownerId) : null;
                if (doc) {
                    const fieldNames = platform
                        ? [getTokenFieldForPlatform(platform)]
                        : [OWNER_TOKEN_FIELDS.web, OWNER_TOKEN_FIELDS.mobile];
                    for (const field of fieldNames) {
                        doc[field] = normalizeTokenList((Array.isArray(doc[field]) ? doc[field] : []).filter((t) => !invalidTokens.includes(t)));
                    }
                    // validateModifiedOnly: never block token cleanup on pre-existing invalid
                    // data elsewhere in the profile.
                    await doc.save({ validateModifiedOnly: true });
                }
            } catch (pruneErr) {
                logger.warn(`Dead-token prune failed for ${ownerType}:${ownerId}: ${pruneErr.message}`);
            }
        }
        logger.info(
            `FCM push sent to ${ownerType}:${ownerId} (${platform || 'all'}). Success=${response.successCount}, Failure=${response.failureCount}${response.failureCount ? " errors=" + JSON.stringify([...new Set((response.results || []).filter((r) => !r.ok).map((r) => (r.code || "") + ": " + (r.error || "")))]) : ""}`
        );
        return response;
    } catch (error) {
        logger.warn(`FCM push failed for ${ownerType}:${ownerId}: ${error.message}`);
        await recordPushReceipt({
            ownerType, ownerId, payload: enrichedPayload,
            status: 'failed', tokensTargeted: targetTokens.length,
            successCount: 0, failureCount: targetTokens.length,
            error: error.message, attempt: options.attempt,
        });
        // Rethrow when the caller is a retrying queue worker; otherwise preserve the previous
        // swallow-and-return-shape behaviour so no existing call site changes.
        if (options.throwOnTotalFailure) throw error;
        return { successCount: 0, failureCount: targetTokens.length, error: error.message };
    }
};

/** Cap on concurrent per-owner sends, so a large broadcast cannot exhaust the socket pool. */
const FANOUT_CONCURRENCY = 20;

export const sendNotificationToOwners = async (targets = [], payload = {}, options = {}) => {
    // 🔍 Tip #6: Deduplicate targets by ownerType:ownerId before sending
    // This prevents duplicate notifications if the same person is listed twice (e.g. as USER and partner)
    const uniqueTargets = Array.isArray(targets)
        ? [...new Map(targets.filter(t => t?.ownerType && t?.ownerId).map(t => [`${t.ownerType}:${t.ownerId}`, t])).values()]
        : [];
    if (uniqueTargets.length === 0) return [];

    // Bounded-concurrency fan-out. This was a sequential `for … await` loop, so notifying 50
    // riders meant 50 serial round trips — tens of seconds on an order with a 60s offer window.
    const results = new Array(uniqueTargets.length);
    let cursor = 0;
    const runWorker = async () => {
        for (;;) {
            const index = cursor++;
            if (index >= uniqueTargets.length) return;
            const target = uniqueTargets[index];
            results[index] = await sendNotificationToOwner({
                ownerType: target.ownerType,
                ownerId: target.ownerId,
                platform: target.platform,
                payload,
                options,
            });
        }
    };
    await Promise.all(
        Array.from({ length: Math.min(FANOUT_CONCURRENCY, uniqueTargets.length) }, runWorker),
    );
    return results;
};

export const notifyAdminsSafely = async (payload = {}) => {
    try {
        const admins = await Admin.find({ isActive: true }).select('_id').lean();
        if (!admins.length) return [];

        const targets = admins.map(a => ({
            ownerType: 'ADMIN',
            ownerId: String(a._id)
        }));

        return await sendNotificationToOwners(targets, payload);
    } catch (e) {
        logger.error(`Error notifying admins: ${e.message}`);
        return [];
    }
};

export const sendTestNotification = async ({ ownerType, ownerId, platform }) => {
    return sendNotificationToOwner({
        ownerType,
        ownerId,
        platform,
        payload: {
            title: 'Test Notification',
            body: 'This is a test notification from Firebase push',
            data: {
                type: 'test',
                link: '/'
            }
        }
    });
};
/**
 * Hand a push to the notification queue so BullMQ owns the retry + dead-letter, falling back to
 * a direct send when the queue is unavailable.
 *
 * The queue is what turns a transient FCM 5xx or quota rejection from a permanently lost
 * notification into a retried one.
 *
 * @returns {Promise<boolean>} true when the job was queued
 */
let workerProbeAt = 0;
let workerProbeResult = false;
const WORKER_PROBE_TTL_MS = 30000;

/**
 * Is anything actually consuming the notification queue?
 *
 * Without this, enabling BullMQ while the notification worker is not running would queue every
 * push into a void — pushes would stop entirely and silently. Probed at most once per 30s and
 * cached, so it costs nothing on the hot path and self-heals when a worker starts or dies.
 */
const hasLiveNotificationWorker = async (queue) => {
    const now = Date.now();
    if (now - workerProbeAt < WORKER_PROBE_TTL_MS) return workerProbeResult;
    workerProbeAt = now;
    try {
        const workers = await queue.getWorkers();
        workerProbeResult = Array.isArray(workers) && workers.length > 0;
        if (!workerProbeResult) {
            logger.warn('No notification worker is consuming the queue — sending pushes inline.');
        }
    } catch {
        workerProbeResult = false;
    }
    return workerProbeResult;
};

const tryQueuePush = async (targets, payload) => {
    try {
        const { getNotificationQueue } = await import('../../queues/index.js');
        const queue = getNotificationQueue();
        if (!queue) return false;
        if (!(await hasLiveNotificationWorker(queue))) return false;

        const { addNotificationJob } = await import('../../queues/producers/notification.producer.js');
        const job = await addNotificationJob(
            { action: 'send-push', targets, payload },
            {
                attempts: 4,
                backoff: { type: 'exponential', delay: 2000 },
                removeOnComplete: { count: 500 },
                // Keep failures for a week: this IS the dead-letter queue.
                removeOnFail: { age: 7 * 24 * 3600 },
            },
        );
        return Boolean(job);
    } catch (err) {
        logger.warn(`Push enqueue failed, sending inline: ${err.message}`);
        return false;
    }
};

export const notifyOwnerSafely = async (target = {}, payload = {}) => {
    if (!target?.ownerType || !target?.ownerId) return null;
    if (await tryQueuePush([target], payload)) return { queued: true };
    try {
        return await sendNotificationToOwner({ ...target, payload });
    } catch (error) {
        logger.warn(`FCM individual push failed: ${error.message}`);
        return null;
    }
};

export const notifyOwnersSafely = async (targets = [], payload = {}) => {
    if (!Array.isArray(targets) || targets.length === 0) return [];
    if (await tryQueuePush(targets, payload)) return [{ queued: true }];
    try {
        return await sendNotificationToOwners(targets, payload);
    } catch (error) {
        logger.warn(`FCM broadcast push failed: ${error.message}`);
        return [];
    }
};
