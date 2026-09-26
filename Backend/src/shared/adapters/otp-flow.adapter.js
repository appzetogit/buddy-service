/**
 * OTP Flow Adapter
 * Bridges the differences in OTP handshake protocols between Food Ordering and Quick Commerce.
 * Ensures compatibility and safe reuse of existing codes.
 */

import mongoose from 'mongoose';
import crypto from 'crypto';

// Dynamically load models and services to prevent circular dependency / registration timing issues
const getFoodOrderModel = () => mongoose.model('FoodOrder');
const getQcOrderModel = () => mongoose.model('Order');
const getOrderOtpModel = () => mongoose.model('OrderOtp');

/**
 * Bridges OTP generation for delivery completion.
 * Reuses existing OTP if already present and valid; generates only if missing.
 * 
 * @param {string} orderId - The order ID (Food or QC)
 * @param {number} [riderLat] - Latitude of the delivery partner
 * @param {number} [riderLng] - Longitude of the delivery partner
 * @returns {Promise<object>} Result containing success, otp, and expiresAt
 */
export async function requestOtpBridge(orderId, riderLat, riderLng) {
    if (!orderId) {
        throw new Error('Order ID is required for OTP request');
    }

    const FoodOrder = getFoodOrderModel();
    const Order = getQcOrderModel();
    const OrderOtp = getOrderOtpModel();

    const isObjectId = mongoose.Types.ObjectId.isValid(orderId);

    // 1. Try to find as Food Order
    let foodOrder = null;
    if (isObjectId) {
        foodOrder = await FoodOrder.findById(orderId).select('+deliveryOtp');
    }
    if (!foodOrder) {
        foodOrder = await FoodOrder.findOne({
            $or: [{ orderId: orderId }, { order_id: orderId }]
        }).select('+deliveryOtp');
    }

    if (foodOrder) {
        let otp = String(foodOrder.deliveryOtp || '').trim();
        const hasExisting = !!otp;

        if (!otp) {
            // Generate secure 4-digit OTP using crypto.randomInt
            otp = String(crypto.randomInt(1000, 10000));
            foodOrder.deliveryOtp = otp;
        }

        if (!foodOrder.deliveryVerification) {
            foodOrder.deliveryVerification = {};
        }
        
        foodOrder.deliveryVerification.dropOtp = {
            required: true,
            verified: false,
            ...(foodOrder.deliveryVerification?.dropOtp || {})
        };
        
        foodOrder.markModified('deliveryVerification.dropOtp');
        await foodOrder.save();

        // Notify client via Main socket
        try {
            const { getIO } = await import('../../config/socket.js');
            const io = getIO();
            if (io && foodOrder.userId) {
                io.to(`user:${foodOrder.userId.toString()}`).emit('delivery_drop_otp', {
                    orderId: foodOrder.orderId || foodOrder._id.toString(),
                    otp,
                    message: 'Share this OTP with your delivery partner.'
                });
            }
        } catch (err) {
            console.warn('[requestOtpBridge] Food Socket emission warning:', err.message);
        }

        return {
            success: true,
            otp,
            reused: hasExisting,
            orderType: 'food',
            expiresAt: new Date(Date.now() + 10 * 60 * 1000)
        };
    }

    // 2. Try to find as QC Order
    let qcOrder = null;
    if (isObjectId) {
        qcOrder = await Order.findById(orderId).populate('customer');
    }
    if (!qcOrder) {
        qcOrder = await Order.findOne({ orderId }).populate('customer');
    }

    if (qcOrder) {
        // Look for an existing, unconsumed, unexpired OTP in OrderOtp
        const existingOtp = await OrderOtp.findOne({
            orderId: qcOrder.orderId,
            type: 'delivery',
            consumedAt: null,
            expiresAt: { $gt: new Date() }
        }).sort({ lastGeneratedAt: -1, createdAt: -1 });

        if (existingOtp) {
            const otpVal = existingOtp.code;
            
            // Emit Socket events to user
            try {
                const { getIO } = await import('../../config/socket.js');
                const io = getIO();
                if (io) {
                    const otpPayload = {
                        orderId: qcOrder.orderId,
                        otp: otpVal,
                        code: otpVal,
                        expiresAt: existingOtp.expiresAt,
                        deliveryPersonNearby: true
                    };
                    const customerId = qcOrder.customer?._id || qcOrder.customer;
                    if (customerId) {
                        io.to(`customer:${customerId.toString()}`).emit('order:otp', otpPayload);
                        io.to(`customer:${customerId.toString()}`).emit('delivery:otp:generated', otpPayload);
                    }
                    io.to(`order:${qcOrder.orderId}`).emit('delivery:otp:generated', otpPayload);
                    io.to(`order:${qcOrder.orderId}`).emit('order:otp', otpPayload);
                }
            } catch (err) {
                console.warn('[requestOtpBridge] QC Socket emission warning:', err.message);
            }

            return {
                success: true,
                otp: otpVal,
                reused: true,
                orderType: 'qc',
                expiresAt: existingOtp.expiresAt
            };
        }

        // Extract or fallback location
        let location = (riderLat != null && riderLng != null) ? { lat: Number(riderLat), lng: Number(riderLng) } : null;
        if (!location && qcOrder.deliveryBoy) {
            try {
                const DeliveryModel = mongoose.model('Delivery');
                const delivery = await DeliveryModel.findById(qcOrder.deliveryBoy).select('location');
                const coords = delivery?.location?.coordinates;
                if (Array.isArray(coords) && coords.length >= 2) {
                    location = { lat: coords[1], lng: coords[0] };
                }
            } catch (err) {
                console.warn('[requestOtpBridge] Could not resolve delivery location from DB:', err.message);
            }
        }

        // Proximity validation fallback coordinate
        if (!location) {
            location = {
                lat: qcOrder.address?.location?.lat || 0,
                lng: qcOrder.address?.location?.lng || 0
            };
        }

        const { generateDeliveryOtp } = await import('../../modules/quickCommerce/services/deliveryOtpService.js');
        const result = await generateDeliveryOtp(qcOrder.orderId, location);

        if (!result.success) {
            throw new Error(result.error || 'Failed to generate OTP for Quick Commerce Order');
        }

        // Emit Socket.IO event to customer
        try {
            const { getIO } = await import('../../config/socket.js');
            const io = getIO();
            if (io) {
                const otpPayload = {
                    orderId: qcOrder.orderId,
                    otp: result.otp,
                    code: result.otp,
                    expiresAt: result.expiresAt,
                    deliveryPersonNearby: true
                };
                const customerId = qcOrder.customer?._id || qcOrder.customer;
                if (customerId) {
                    io.to(`customer:${customerId.toString()}`).emit('order:otp', otpPayload);
                    io.to(`customer:${customerId.toString()}`).emit('delivery:otp:generated', otpPayload);
                }
                io.to(`order:${qcOrder.orderId}`).emit('delivery:otp:generated', otpPayload);
                io.to(`order:${qcOrder.orderId}`).emit('order:otp', otpPayload);
            }
        } catch (err) {
            console.warn('[requestOtpBridge] QC Socket emission warning:', err.message);
        }

        return {
            success: true,
            otp: result.otp,
            reused: false,
            orderType: 'qc',
            expiresAt: result.expiresAt
        };
    }

    throw new Error(`Order ${orderId} not found in Food or QC modules`);
}

/**
 * Bridges OTP verification for delivery completion.
 * 
 * @param {string} orderId - The order ID (Food or QC)
 * @param {string} enteredCode - The OTP code inputted by the rider
 * @param {string} deliveryPartnerId - Delivery partner ID performing the validation
 * @returns {Promise<object>} Result containing success, order details, and orderType
 */
export async function verifyOtpBridge(orderId, enteredCode, deliveryPartnerId) {
    if (!orderId || !enteredCode) {
        throw new Error('Order ID and entered OTP code are required for verification');
    }

    const FoodOrder = getFoodOrderModel();
    const Order = getQcOrderModel();

    const isObjectId = mongoose.Types.ObjectId.isValid(orderId);

    // 1. Try to find as Food Order
    let foodOrder = null;
    if (isObjectId) {
        foodOrder = await FoodOrder.findById(orderId);
    }
    if (!foodOrder) {
        foodOrder = await FoodOrder.findOne({
            $or: [{ orderId: orderId }, { order_id: orderId }]
        });
    }

    if (foodOrder) {
        const { verifyDropOtpDelivery } = await import('../../modules/food/orders/services/order-delivery.service.js');
        const result = await verifyDropOtpDelivery(foodOrder._id.toString(), deliveryPartnerId, enteredCode);
        return {
            success: true,
            order: result.order,
            orderType: 'food'
        };
    }

    // 2. Try to find as QC Order
    let qcOrder = null;
    if (isObjectId) {
        qcOrder = await Order.findById(orderId).populate('customer');
    }
    if (!qcOrder) {
        qcOrder = await Order.findOne({ orderId }).populate('customer');
    }

    if (qcOrder) {
        const { validateDeliveryOtp: validateOtp } = await import('../../modules/quickCommerce/services/deliveryOtpService.js');
        const result = await validateOtp(qcOrder.orderId, enteredCode);

        if (!result.valid) {
            throw new Error(result.message || 'OTP validation failed');
        }

        const now = new Date();
        let validationLocation = null;

        if (deliveryPartnerId) {
            try {
                const DeliveryModel = mongoose.model('Delivery');
                const delivery = await DeliveryModel.findById(deliveryPartnerId).select('location');
                if (delivery?.location?.coordinates) {
                    validationLocation = {
                        lng: delivery.location.coordinates[0],
                        lat: delivery.location.coordinates[1]
                    };
                }
            } catch (err) {
                console.warn('[verifyOtpBridge] Location lookup error:', err.message);
            }
        }

        const updatedOrder = await Order.findOneAndUpdate(
            { orderId: qcOrder.orderId },
            {
                $set: {
                    workflowStatus: 'delivered',
                    status: 'delivered',
                    deliveredAt: now,
                    otpValidatedAt: now,
                    otpValidationLocation: validationLocation
                }
            },
            { new: true }
        );

        if (updatedOrder) {
            try {
                const { applyDeliveredSettlement } = await import('../../modules/quickCommerce/services/orderSettlement.js');
                await applyDeliveredSettlement(updatedOrder, qcOrder.orderId);
            } catch (settlementError) {
                console.error('[verifyOtpBridge] QC Settlement sync failed:', settlementError.message);
            }
        }

        // Emit Socket.IO event to customer
        try {
            const { getIO } = await import('../../config/socket.js');
            const io = getIO();
            if (io) {
                const customerId = qcOrder.customer?._id || qcOrder.customer;
                if (customerId) {
                    io.to(`customer:${customerId.toString()}`).emit('delivery:otp:validated', {
                        orderId: qcOrder.orderId,
                        status: 'delivered',
                        deliveredAt: now.toISOString()
                    });
                }
                io.to(`order:${qcOrder.orderId}`).emit('delivery:otp:validated', {
                    orderId: qcOrder.orderId,
                    status: 'delivered',
                    deliveredAt: now.toISOString()
                });
            }
        } catch (err) {
            console.warn('[verifyOtpBridge] QC Socket emission warning:', err.message);
        }

        return {
            success: true,
            order: updatedOrder,
            orderType: 'qc'
        };
    }

    throw new Error(`Order ${orderId} not found in Food or QC modules`);
}

export default {
    requestOtpBridge,
    verifyOtpBridge
};
