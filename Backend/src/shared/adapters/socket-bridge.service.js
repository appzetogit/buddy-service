/**
 * Socket Bridge Service
 * Dual-publishes socket notifications between Food Ordering and Quick Commerce channels.
 * Intercepts events at the Socket.IO level to keep frontends aligned.
 */

import { adaptFoodOrderToQcShape } from './delivery-response.adapter.js';
import { mapFoodToQcStatus } from './qc-food-status.mapper.js';

let isInitialized = false;

/**
 * Initializes the socket bridge by wrapping the socket.io server instance.
 * Automatically intercepts and translates relevant events between Food and QC domains.
 * 
 * @param {object} io - The Socket.IO server instance
 */
export function initializeSocketBridge(io) {
    if (!io) {
        console.warn('[SocketBridge] Cannot initialize socket bridge: io instance is null or undefined');
        return;
    }
    if (isInitialized) {
        return;
    }
    isInitialized = true;

    try {
        // Dynamically extract constructors from Socket.IO instance to avoid version mismatch errors
        const Namespace = Object.getPrototypeOf(io.sockets).constructor;
        const BroadcastOperator = Object.getPrototypeOf(io.to('temp-room')).constructor;

        const origNamespaceEmit = Namespace.prototype.emit;
        const origBroadcastOperatorEmit = BroadcastOperator.prototype.emit;

        // Wrap Namespace emit (e.g. io.emit)
        Namespace.prototype.emit = function (ev, ...args) {
            const result = origNamespaceEmit.apply(this, [ev, ...args]);

            try {
                if (this.flags?.isBridgeEmit) {
                    return result;
                }
                handleInterceptedEmit(this, null, ev, args);
            } catch (err) {
                console.error('[SocketBridge] Error inside Namespace interceptor:', err);
            }

            return result;
        };

        // Wrap BroadcastOperator emit (e.g. io.to('room').emit)
        BroadcastOperator.prototype.emit = function (ev, ...args) {
            const result = origBroadcastOperatorEmit.apply(this, [ev, ...args]);

            try {
                if (this.flags?.isBridgeEmit) {
                    return result;
                }
                handleInterceptedEmit(this.namespace, this.rooms, ev, args);
            } catch (err) {
                console.error('[SocketBridge] Error inside BroadcastOperator interceptor:', err);
            }

            return result;
        };

        console.log('[SocketBridge] Socket Event Bridge Service initialized successfully.');
    } catch (err) {
        console.error('[SocketBridge] Failed to initialize Socket.IO prototype hooks:', err);
    }
}

/**
 * Core event interceptor logic.
 * Translates and publishes events to compatible channels.
 * 
 * @param {object} namespace - Socket.IO Namespace instance
 * @param {Set|null} rooms - Set of target rooms (if BroadcastOperator)
 * @param {string} ev - Event name
 * @param {Array} args - Event arguments
 */
function handleInterceptedEmit(namespace, rooms, ev, args) {
    if (!namespace || !ev || !args || args.length === 0) return;

    // 1. Map Food "new_order_available" / "new_order" -> QC "delivery:broadcast"
    if (ev === 'new_order_available' || ev === 'new_order') {
        const payload = args[0];
        if (!payload) return;

        try {
            const qcPayload = adaptFoodOrderToQcShape(payload);
            if (qcPayload) {
                const targetRooms = rooms ? Array.from(rooms) : [];
                
                // Helper to emit using original BroadcastOperator to bypass hooks and prevent infinite recursion
                const BroadcastOperator = Object.getPrototypeOf(namespace.server.to('temp')).constructor;
                const origBroadcastOperatorEmit = BroadcastOperator.prototype.emit;

                const bridgePayload = {
                    ...qcPayload,
                    at: new Date().toISOString(),
                    _viaBridge: true
                };

                if (targetRooms.length > 0) {
                    for (const room of targetRooms) {
                        const operator = namespace.server.to(room);
                        operator.flags = { ...(operator.flags || {}), isBridgeEmit: true };
                        origBroadcastOperatorEmit.apply(operator, ['delivery:broadcast', bridgePayload]);
                    }
                } else {
                    const origNamespaceEmit = Object.getPrototypeOf(namespace).constructor.prototype.emit;
                    namespace.flags = { ...(namespace.flags || {}), isBridgeEmit: true };
                    origNamespaceEmit.apply(namespace, ['delivery:broadcast', bridgePayload]);
                }
            }
        } catch (err) {
            console.error('[SocketBridge] Error bridging new_order_available:', err);
        }
    }

    // 2. Map Food "order_status_update" -> QC "order:status:update" & "order:status"
    if (ev === 'order_status_update') {
        const payload = args[0];
        if (!payload) return;

        try {
            const orderId = payload.orderId || payload.order_id || payload.orderMongoId || payload.order?._id || payload.order?.orderId;
            const foodStatus = payload.orderStatus || payload.status || payload.order?.orderStatus;
            
            if (orderId && foodStatus) {
                const qcStatus = mapFoodToQcStatus(foodStatus);
                const customerId = payload.customerId || payload.userId || payload.order?.userId;

                const body = {
                    orderId: String(orderId),
                    status: qcStatus,
                    workflowStatus: qcStatus,
                    at: new Date().toISOString(),
                    _viaBridge: true
                };

                const BroadcastOperator = Object.getPrototypeOf(namespace.server.to('temp')).constructor;
                const origBroadcastOperatorEmit = BroadcastOperator.prototype.emit;

                // Emit to order room: order:${orderId}
                const orderRoomOp = namespace.server.to(`order:${orderId}`);
                orderRoomOp.flags = { ...(orderRoomOp.flags || {}), isBridgeEmit: true };
                origBroadcastOperatorEmit.apply(orderRoomOp, ['order:status:update', body]);
                origBroadcastOperatorEmit.apply(orderRoomOp, ['order:status', body]);

                // Emit to customer room: customer:${customerId}
                if (customerId) {
                    const custRoomOp = namespace.server.to(`customer:${customerId}`);
                    custRoomOp.flags = { ...(custRoomOp.flags || {}), isBridgeEmit: true };
                    origBroadcastOperatorEmit.apply(custRoomOp, ['order:status:update', body]);
                    origBroadcastOperatorEmit.apply(custRoomOp, ['order:status', body]);
                }
            }
        } catch (err) {
            console.error('[SocketBridge] Error bridging order_status_update:', err);
        }
    }
}

export default {
    initializeSocketBridge
};
