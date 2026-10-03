import mongoose from 'mongoose';
import { Server } from 'socket.io';
import { config } from './env.js';
import { logger } from '../utils/logger.js';
import { verifyAccessToken } from '../core/auth/token.util.js';


let io = null;

function logDeliverySocket(message, extra = {}) {
    const suffix = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : '';
    logger.info(`[DeliverySocket] ${message}${suffix}`);
}

function getTokenFromHandshake(socket) {
    const authToken = socket?.handshake?.auth?.token;
    if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();
    const header = socket?.handshake?.headers?.authorization || socket?.handshake?.headers?.Authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) return header.substring(7).trim();
    const queryToken = socket?.handshake?.query?.token;
    if (typeof queryToken === 'string' && queryToken.trim()) return queryToken.trim();
    return null;
}

function maskToken(token) {
    if (!token || typeof token !== 'string') return null;
    const trimmed = token.trim();
    if (!trimmed) return null;
    return `${trimmed.slice(0, 12)}...${trimmed.slice(-6)}`;
}

const roomNames = {
    restaurant: (id) => `restaurant:${String(id)}`,
    user: (id) => `user:${String(id)}`,
    delivery: (id) => `delivery:${String(id)}`,
    tracking: (orderId) => `tracking:${String(orderId)}`
};

/** Unified identity uses role=DRIVER; legacy food delivery JWT uses DELIVERY_PARTNER. */
const isFoodDeliveryRole = (role) =>
    role === 'DELIVERY_PARTNER' || role === 'DRIVER';

/**
 * Record socket-derived liveness for a delivery partner.
 *
 * Advisory data only — dispatch uses it to rank, never to exclude — so every failure is
 * swallowed. It must never be able to break a connection or a location update.
 *
 * @param {string} partnerId
 * @param {{ connected?: boolean }} [options] - set socketConnectedAt on a fresh connect
 */
const touchDeliveryPresence = async (partnerId, { connected = false } = {}) => {
    if (!partnerId) return;
    try {
        const { FoodDeliveryPartner } = await import(
            '../modules/food/delivery/models/deliveryPartner.model.js'
        );
        const now = new Date();
        const $set = { 'presence.lastSeenAt': now };
        if (connected) $set['presence.socketConnectedAt'] = now;
        await FoodDeliveryPartner.updateOne({ _id: partnerId }, { $set });
    } catch (err) {
        logger.warn(`Presence update skipped for ${partnerId}: ${err.message}`);
    }
};

/**
 * Initializes Socket.IO with the provided HTTP server.
 * When REDIS_ENABLED=true and REDIS_URL is set, attaches Redis adapter for horizontal scaling.
 * @param {import('http').Server} server
 * @returns {Promise<Server>}
 */
export const initSocket = async (server) => {
    io = new Server(server, {
        cors: {
            origin: config.socketCorsOrigin,
            methods: ['GET', 'POST']
        }
    });

    // Socket auth middleware (Bearer token).
    io.use((socket, next) => {
        try {
            const token = getTokenFromHandshake(socket);
            if (!token) {
                logger.warn(`Socket auth failed: token missing for socket ${socket.id}`);
                logger.warn(`[DeliverySocket] Handshake auth missing`, {
                    socketId: socket.id,
                    origin: socket?.handshake?.headers?.origin || null,
                    host: socket?.handshake?.headers?.host || null,
                    userAgent: socket?.handshake?.headers?.['user-agent'] || null,
                    hasAuthToken: Boolean(socket?.handshake?.auth?.token),
                    hasAuthorizationHeader: Boolean(
                        socket?.handshake?.headers?.authorization || socket?.handshake?.headers?.Authorization
                    ),
                    hasQueryToken: Boolean(socket?.handshake?.query?.token),
                });
                return next(new Error('AUTH_MISSING'));
            }
            logger.info(`[DeliverySocket] Handshake token received`, {
                socketId: socket.id,
                origin: socket?.handshake?.headers?.origin || null,
                host: socket?.handshake?.headers?.host || null,
                transport: socket?.handshake?.query?.transport || null,
                tokenPreview: maskToken(token),
            });
            const decoded = verifyAccessToken(token);
            const userId = decoded.userId || decoded.id || decoded._id;
            console.log(`[SOCKET AUTH DEBUG] role: ${decoded.role}, resolvedUserId: ${userId}, tokenPayload: ${JSON.stringify(decoded)}`);
            socket.user = { userId, role: decoded.role };
            logger.info(`Socket auth success: ${decoded.role}:${userId} for socket ${socket.id}`);
            return next();
        } catch (err) {
            logger.error(`Socket auth failed for socket ${socket.id}: ${err.message}`);
            logger.error(`[DeliverySocket] Handshake auth invalid`, {
                socketId: socket.id,
                origin: socket?.handshake?.headers?.origin || null,
                host: socket?.handshake?.headers?.host || null,
                transport: socket?.handshake?.query?.transport || null,
                tokenPreview: maskToken(getTokenFromHandshake(socket)),
                errorMessage: err.message,
                errorName: err.name || null,
            });
            return next(new Error('AUTH_INVALID'));
        }
    });

    if (config.redisEnabled && config.redisUrl) {
        try {
            const { createAdapter } = await import('@socket.io/redis-adapter');
            const { createClient } = await import('redis');
            const pubClient = createClient({ url: config.redisUrl });
            const subClient = pubClient.duplicate();
            pubClient.on('error', (err) => logger.error(`Socket.IO Redis pub client: ${err.message}`));
            subClient.on('error', (err) => logger.error(`Socket.IO Redis sub client: ${err.message}`));
            await Promise.all([pubClient.connect(), subClient.connect()]);
            // `key` namespaces the pub/sub channels. Redis pub/sub is global — it is NOT scoped
            // by db index — so without this, a second app using the default 'socket.io' key on
            // the same Redis would receive (and rebroadcast) this app's room events.
            io.adapter(createAdapter(pubClient, subClient, { key: `${config.redisKeyPrefix}:socket.io` }));
            logger.info(
                `Socket.IO Redis adapter attached for horizontal scaling (key=${config.redisKeyPrefix}:socket.io)`,
            );
        } catch (err) {
            logger.warn(`Socket.IO Redis adapter skipped (using in-memory): ${err.message}`);
        }
    }

    io.on('connection', (socket) => {
        const userId = socket.user?.userId;
        const role = socket.user?.role;
        logger.info(`Socket client connected: ${socket.id} (${role || 'UNKNOWN'}:${userId || '-'})`);

        // Auto-join role rooms (lets us emit without a custom join).
        if (userId && role) {
            if (role === 'RESTAURANT') socket.join(roomNames.restaurant(userId));
            if (role === 'USER') socket.join(roomNames.user(userId));
            if (isFoodDeliveryRole(role)) {
                socket.join(roomNames.delivery(userId));
                socket.join('all_delivery'); // Global delivery broadcast room
                logger.info(`[SocketDebug] Delivery Partner ${userId} connected and joined 'all_delivery' room. SocketId: ${socket.id}`);
                logDeliverySocket('Auto-joined delivery room on connect', {
                    socketId: socket.id,
                    deliveryPartnerId: String(userId),
                    room: roomNames.delivery(userId),
                });
                void touchDeliveryPresence(userId, { connected: true });
            }
        }

        // Explicit join (used by existing restaurant client hook).
        socket.on('join-restaurant', (restaurantId) => {
            if (socket.user?.role !== 'RESTAURANT') return;
            // Security: only join your own restaurant room.
            if (String(socket.user?.userId) !== String(restaurantId)) return;
            socket.join(roomNames.restaurant(restaurantId));
            socket.emit('restaurant-room-joined', { room: roomNames.restaurant(restaurantId), restaurantId: String(restaurantId) });
        });

        // Explicit join (used by existing delivery client hook).
        socket.on('join-delivery', (deliveryPartnerId) => {
            if (!isFoodDeliveryRole(socket.user?.role)) {
                logDeliverySocket('Rejected join-delivery for non-delivery role', {
                    socketId: socket.id,
                    role: socket.user?.role || 'UNKNOWN',
                    requestedDeliveryPartnerId: String(deliveryPartnerId || ''),
                });
                return;
            }
            // Security: only join your own delivery room.
            if (String(socket.user?.userId) !== String(deliveryPartnerId)) {
                logDeliverySocket('Rejected join-delivery due to user mismatch', {
                    socketId: socket.id,
                    authDeliveryPartnerId: String(socket.user?.userId || ''),
                    requestedDeliveryPartnerId: String(deliveryPartnerId || ''),
                });
                return;
            }
            const room = roomNames.delivery(deliveryPartnerId);
            socket.join(room);
            const roomSize = io?.sockets?.adapter?.rooms?.get(room)?.size || 0;
            logDeliverySocket('Delivery room joined', {
                socketId: socket.id,
                deliveryPartnerId: String(deliveryPartnerId),
                room,
                roomSize,
            });
            socket.emit('delivery-room-joined', { room, deliveryPartnerId: String(deliveryPartnerId) });
        });

        // ─── Live Tracking Events ───────────────────────────────────────

        // Users / restaurants subscribe to an order's real-time tracking room.
        socket.on('join-tracking', (orderId) => {
            if (!orderId) return;
            const role = socket.user?.role;
            if (role !== 'USER' && role !== 'RESTAURANT' && !isFoodDeliveryRole(role)) return;
            const room = roomNames.tracking(orderId);
            socket.join(room);
            logger.info(`Socket ${socket.id} (${role}:${userId}) joined tracking room ${room}`);
            socket.emit('tracking-room-joined', { room, orderId: String(orderId) });
        });

        // Delivery partner emits live GPS location for an active order.
        // Broadcasts to the tracking room so users see the bike move in real time.
        socket.on('update-location', async (data) => {
            if (!isFoodDeliveryRole(socket.user?.role)) return;
            if (!data || !data.orderId) return;

            const lat = Number(data.lat);
            const lng = Number(data.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
            if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

            const heading = Number.isFinite(Number(data.heading)) ? Number(data.heading) : 0;
            const speed = Number.isFinite(Number(data.speed)) ? Number(data.speed) : 0;
            const accuracy = Number.isFinite(Number(data.accuracy)) ? Number(data.accuracy) : null;
            const now = Date.now();

            const rawOrderId = String(data.orderId).trim();
            const orderIdentityFilter = mongoose.isValidObjectId(rawOrderId)
                ? { _id: new mongoose.Types.ObjectId(rawOrderId) }
                : { $or: [{ order_id: rawOrderId }, { orderId: rawOrderId }] };

            const { FoodOrder } = await import('../modules/food/orders/models/order.model.js');

            // Authorization: only the delivery partner actually assigned to this
            // order may broadcast/persist a location for it - previously any
            // authenticated delivery partner could spoof any orderId here.
            try {
                const assignedOrder = await FoodOrder.findOne({
                    ...orderIdentityFilter,
                    $or: [
                        { 'dispatch.deliveryPartnerId': userId },
                        { 'dispatch.sharedPartnerId': userId },
                    ],
                }).select('_id').lean();
                if (!assignedOrder) {
                    logDeliverySocket('Rejected update-location: partner not assigned to order', {
                        socketId: socket.id,
                        deliveryPartnerId: String(userId),
                        orderId: rawOrderId,
                    });
                    return;
                }
            } catch (err) {
                logger.error(`update-location authorization check failed: ${err.message}`);
                return;
            }

            const { getRedisClient } = await import('../config/redis.js');
            const redis = getRedisClient();

            // Throttle per order+partner so dual drivers don't block each other.
            if (redis) {
                try {
                    const acquired = await redis.set(
                        `throttle:loc:${rawOrderId}:${userId}`,
                        '1',
                        { NX: true, PX: 2000 },
                    );
                    if (!acquired) return;
                } catch (err) {
                    logger.warn(`Location throttle check failed, proceeding without throttle: ${err.message}`);
                }
            }

            const payload = {
                orderId: String(data.orderId),
                deliveryPartnerId: String(userId),
                lat,
                lng,
                boy_lat: lat, // Add boy_lat/lng for compatibility
                boy_lng: lng,
                riderLocation: [lat, lng], // Add array format for safety
                heading,
                speed,
                accuracy,
                timestamp: now
            };

            logDeliverySocket('Location update received', {
                socketId: socket.id,
                deliveryPartnerId: String(userId),
                orderId: String(data.orderId),
                lat,
                lng,
                status: data.status || 'on_the_way',
            });

            // Broadcast to tracking room (all users watching this order)
            const trackingRoom = roomNames.tracking(data.orderId);
            socket.to(trackingRoom).emit('location-update', payload);

            // Also emit to the specific user room if userId is provided
            if (data.userId) {
                socket.to(roomNames.user(data.userId)).emit('location-update', payload);
            }

            if (data.restaurantId) {
                socket.to(roomNames.restaurant(data.restaurantId)).emit('location-update', payload);
            }

            // ─── Scalable Persistence (BullMQ + Redis "Hot" Buffering) ───
            try {
                const { getTrackingQueue } = await import('../queues/index.js');
                const trackingQueue = getTrackingQueue();

                if (trackingQueue && redis) {
                    const coordString = JSON.stringify({ lat, lng, timestamp: now });

                    // 1. Immediately buffer the newest location in high-speed Redis Hash (HOT storage)
                    await Promise.all([
                        redis.hSet('rider:locations:hot', String(userId), coordString),
                        redis.hSet('order:locations:hot', String(data.orderId), coordString)
                    ]);

                    // 2. Schedule a deferred MongoDB write (COLD storage)
                    // jobId debulks updates: if a job is already waiting, BullMQ ignores the new add()
                    // Delay (30s) ensures we don't spam MongoDB while the rider is moving fast
                    const syncJobId = `sync:loc:${data.orderId}`;
                    trackingQueue.add('sync-hot-locations',
                        { userId, orderId: data.orderId },
                        { jobId: syncJobId, delay: 30000, removeOnComplete: true }
                    ).catch(e => logger.error(`BullMQ sync schedule failed: ${e.message}`));
                } else {
                    // Redis/BullMQ unavailable - degrade to a direct, unbuffered
                    // write rather than silently dropping location persistence
                    // (previously this branch just did nothing).
                    logger.warn('Redis/BullMQ unavailable - falling back to direct location write, hot-path buffering disabled');
                    const { FoodDeliveryPartner } = await import('../modules/food/delivery/models/deliveryPartner.model.js');
                    const point = { type: 'Point', coordinates: [lng, lat] };
                    await Promise.all([
                        FoodDeliveryPartner.updateOne({ _id: userId }, {
                            $set: {
                                currentLocation: { ...point, latitude: lat, longitude: lng },
                                lastLocationAt: new Date(),
                                lastLocation: point,
                                lastLat: lat,
                                lastLng: lng,
                            },
                        }).catch((e) => logger.error(`Direct delivery partner location write failed: ${e.message}`)),
                        FoodOrder.updateOne(orderIdentityFilter, {
                            $set: { lastRiderLocation: point },
                        }).catch((e) => logger.error(`Direct order location write failed: ${e.message}`)),
                    ]);
                }
            } catch (err) {
                logger.error(`Real-time persistence layer error: ${err.message}`);
            }
        });

        // Leave tracking room on user navigation away.
        socket.on('leave-tracking', (orderId) => {
            if (!orderId) return;
            const room = roomNames.tracking(orderId);
            socket.leave(room);
        });

        // Client liveness ping. Cheap enough to take on the socket rather than an HTTP route,
        // and it keeps presence fresh for a rider who is connected but idle (no location
        // updates because they have no active trip).
        socket.on('heartbeat', () => {
            if (!isFoodDeliveryRole(socket.user?.role)) return;
            void touchDeliveryPresence(userId);
        });

        socket.on('disconnect', () => {
            logger.info(`Socket client disconnected: ${socket.id}`);
            if (isFoodDeliveryRole(role)) {
                logDeliverySocket('Delivery socket disconnected', {
                    socketId: socket.id,
                    deliveryPartnerId: String(userId || ''),
                });
                // Stamp the moment we lost them so dispatch can age them out.
                void touchDeliveryPresence(userId);
            }
        });

        /**
         * Cursor sync — the replacement for order polling.
         *
         * One handler for USER / RESTAURANT / DELIVERY_PARTNER; only the recipient filter
         * differs. Unlike `resync` below (which is scoped to the caller's single ACTIVE order,
         * and has no RESTAURANT branch at all), this answers "what was addressed to me since
         * cursor N?" — so a rider who was offered an order while offline, and therefore has no
         * active order, still recovers the offer.
         *
         * Client contract:
         *   emit('sync', { since }, ack?)  →  ack/emit('sync_batch', { events, nextCursor, hasMore })
         * Events are ordered by cursor and carry an eventId for client-side dedupe.
         *
         * `resync` is intentionally left untouched and still live: apps in the field call it.
         */
        socket.on('sync', async (data, ack) => {
            const respond = (payload) => {
                if (typeof ack === 'function') ack(payload);
                else socket.emit('sync_batch', payload);
            };

            try {
                // Dynamic import: order.helpers.js imports getIO/getBroadcaster from this
                // module, so a static import here would close the cycle at module-eval time.
                const { readSyncBatch, recipientKindForRole } = await import(
                    '../modules/food/orders/services/order.helpers.js'
                );
                const kind = recipientKindForRole(role);
                if (!kind || !userId) {
                    return respond({ events: [], nextCursor: Number(data?.since) || 0, hasMore: false });
                }

                const since = Number(data?.since) || 0;
                const batch = await readSyncBatch({ kind, id: userId }, since, data?.limit);

                if (batch.events.length > 0) {
                    logger.info(
                        `[Sync] ${kind}:${userId} recovered ${batch.events.length} event(s) ` +
                        `from cursor ${since} → ${batch.nextCursor}${batch.hasMore ? ' (more pending)' : ''}`,
                    );
                }
                return respond(batch);
            } catch (err) {
                logger.error(`Sync failed for ${role}:${userId} — ${err.message}`);
                return respond({ events: [], nextCursor: Number(data?.since) || 0, hasMore: false });
            }
        });

        /**
         * Client confirms it applied up to `cursor`. Advisory: the client is the authority on
         * its own cursor (it persists it), so this exists purely for observability.
         */
        socket.on('sync_ack', (data) => {
            const cursor = Number(data?.cursor);
            if (!Number.isFinite(cursor)) return;
            logger.info(`[Sync] ${role}:${userId} acked cursor ${cursor}`);
        });

        // 🆕 Resync State on Reconnect
        socket.on('resync', async (data) => {
          try {
            if (isFoodDeliveryRole(role)) {
              logDeliverySocket('Resync requested', {
                socketId: socket.id,
                deliveryPartnerId: String(userId || ''),
              });
            }
            const { resyncState } = await import('../modules/food/orders/services/order.service.js');
            const sinceSeq = Number(data?.sinceSeq);
            const state = await resyncState(
              userId,
              role,
              Number.isFinite(sinceSeq) ? { sinceSeq } : {},
            );
            if (state.activeOrder) {
              const eventName = role === 'USER' ? 'order_state' : 'active_order';
              socket.emit(eventName, state.activeOrder);
              if (isFoodDeliveryRole(role)) {
                logDeliverySocket('Resync emitted active order', {
                  socketId: socket.id,
                  deliveryPartnerId: String(userId || ''),
                  orderId: String(
                    state.activeOrder?.orderId ||
                    state.activeOrder?.orderMongoId ||
                    ''
                  ),
                  eventName,
                });
              }
              
              // Re-emit OTP if user is in drop phase
              if (role === 'USER' && state.activeOrder.handoverOtp) {
                socket.emit('delivery_drop_otp', {
                  orderId: state.activeOrder.orderId,
                  otp: state.activeOrder.handoverOtp,
                  message: 'Share this OTP with your delivery partner.'
                });
              }
            }
            socket.emit('resync_complete', {
              timestamp: Date.now(),
              lastEventSeq: state.lastEventSeq || 0,
              missedEvents: state.recentEvents || [],
            });
            if (isFoodDeliveryRole(role)) {
              logDeliverySocket('Resync complete', {
                socketId: socket.id,
                deliveryPartnerId: String(userId || ''),
                hasActiveOrder: Boolean(state.activeOrder),
              });
            }
          } catch (err) {
            logger.error(`Resync failed for ${role}:${userId} — ${err.message}`);
          }
        });
    });

    logger.info('Socket.IO infrastructure initialized');
    return io;
};

/**
 * Returns the initialized Socket.IO instance.
 *
 * NOTE: this is null in any process that did not call initSocket() — notably the standalone
 * BullMQ workers in ecosystem.config.cjs. Use getBroadcaster() when you only need to emit.
 * @returns {Server | null}
 */
export const getIO = (silent = false) => {
    if (!io && !silent) {
        logger.warn('Socket.IO not initialized');
    }
    return io;
};

let redisEmitter = null;
let redisEmitterInit = null;

/**
 * Lazily build a Redis-backed emitter for processes that have no Socket.IO server.
 *
 * The BullMQ workers run dispatch (processDispatchTimeout → tryAutoAssign → emit 'new_order'),
 * but getIO() is null there, so every `if (io)` guard silently skipped and the offer reached
 * nobody. The emitter publishes to the same adapter channels the web process subscribes to,
 * so the emit is delivered for real.
 *
 * Requires the SAME `key` as the adapter above, or the web process never sees the message.
 */
const getRedisEmitter = async () => {
    if (redisEmitter) return redisEmitter;
    if (!config.redisEnabled || !config.redisUrl) return null;
    if (redisEmitterInit) return redisEmitterInit;

    redisEmitterInit = (async () => {
        try {
            const { Emitter } = await import('@socket.io/redis-emitter');
            const { createClient } = await import('redis');
            const client = createClient({ url: config.redisUrl });
            client.on('error', (err) => logger.error(`Socket.IO emitter Redis error: ${err.message}`));
            await client.connect();
            redisEmitter = new Emitter(client, { key: `${config.redisKeyPrefix}:socket.io` });
            logger.info(
                `Socket.IO Redis emitter ready (key=${config.redisKeyPrefix}:socket.io) — this process can emit without a Socket.IO server`,
            );
            return redisEmitter;
        } catch (err) {
            logger.warn(`Socket.IO Redis emitter unavailable: ${err.message}`);
            return null;
        } finally {
            redisEmitterInit = null;
        }
    })();

    return redisEmitterInit;
};

/**
 * Something that can `.to(room).emit(event, payload)`.
 *
 * Returns the real Socket.IO server when this process has one, otherwise a Redis emitter.
 * Callers that need server-only APIs (room membership, socket iteration) must use getIO().
 *
 * @returns {Promise<{to: Function} | null>}
 */
export const getBroadcaster = async () => {
    if (io) return io;
    return getRedisEmitter();
};

/** Close the emitter's Redis client (graceful shutdown in worker processes). */
export const closeRedisEmitter = async () => {
    const client = redisEmitter?.redisClient;
    redisEmitter = null;
    if (client?.quit) {
        try { await client.quit(); } catch { /* already closing */ }
    }
};

export const rooms = roomNames;
