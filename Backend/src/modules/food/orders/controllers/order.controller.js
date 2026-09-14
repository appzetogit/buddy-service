import { sendResponse } from '../../../../utils/response.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import * as orderService from '../services/order.service.js';
import { validateNewRestaurantAgainstLast } from '../services/restaurant-chain-radius.service.js';
import { checkRestaurantEligibility } from '../services/active-restaurant-limit.service.js';
import * as foodOrderPaymentService from '../services/foodOrderPayment.service.js';
import {
    validateCalculateOrderDto,
    validateCreateOrderDto,
    validateVerifyPaymentDto,
    validateCancelOrderDto,
    validateOrderStatusDto,
    validateAssignDeliveryDto,
    validateDispatchSettingsDto,
    validateOrderRatingsDto,
    validateRestaurantChainDto
} from '../validators/order.validator.js';

export async function validateRestaurantChainController(req, res, next) {
    try {
        const dto = validateRestaurantChainDto(req.body);
        const result = await validateNewRestaurantAgainstLast(
            dto.anchorRestaurantId,
            dto.newRestaurantId,
        );
        return sendResponse(res, 200, 'Restaurant chain validated', result);
    } catch (err) {
        next(err);
    }
}

export async function restaurantEligibilityController(req, res, next) {
    try {
        const userId = req.user?.userId;
        const restaurantId = String(req.query?.restaurantId || '').trim();
        if (!restaurantId) {
            throw new ValidationError('restaurantId is required');
        }
        const result = await checkRestaurantEligibility(userId, restaurantId);
        return sendResponse(res, 200, 'Restaurant eligibility checked', result);
    } catch (err) {
        next(err);
    }
}

export async function calculateOrderController(req, res, next) {
    try {
        const userId = req.user?.userId;
        const dto = validateCalculateOrderDto(req.body);
        const result = await orderService.calculateOrder(userId, dto);
        return sendResponse(res, 200, 'Pricing calculated', result);
    } catch (err) {
        next(err);
    }
}

export async function createOrderController(req, res, next) {
    try {
        const userId = req.user?.userId;
        const dto = validateCreateOrderDto(req.body);
        const result = await orderService.createOrder(userId, dto);
        const message = result?.requiresPayment
            ? 'Checkout created. Complete payment to place order'
            : 'Order placed successfully';
        return sendResponse(res, result?.requiresPayment ? 200 : 201, message, result);
    } catch (err) {
        next(err);
    }
}

export async function verifyPaymentController(req, res, next) {
    try {
        const userId = req.user?.userId;
        const dto = validateVerifyPaymentDto(req.body);
        const result = await orderService.verifyPayment(userId, dto);
        return sendResponse(res, 200, 'Payment verified', result);
    } catch (err) {
        next(err);
    }
}

export async function cancelCheckoutController(req, res, next) {
    try {
        const userId = req.user?.userId;
        const checkoutId = req.params.checkoutId || req.body?.checkoutId;
        const result = await orderService.cancelCheckout(userId, checkoutId);
        return sendResponse(res, 200, 'Checkout cancelled', result);
    } catch (err) {
        next(err);
    }
}

export async function listOrdersUserController(req, res, next) {
    try {
        const userId = req.user?.userId;
        const result = await orderService.listOrdersUser(userId, req.query);
        return sendResponse(res, 200, 'Orders retrieved', result);
    } catch (err) {
        next(err);
    }
}

export async function getOrderByIdUserController(req, res, next) {
    try {
        const userId = req.user?.userId;
        const orderId = req.params.orderId;
        const order = await orderService.getOrderById(orderId, { userId });
        return sendResponse(res, 200, 'Order retrieved', { order });
    } catch (err) {
        next(err);
    }
}

export async function getOrderDropOtpUserController(req, res, next) {
    try {
        const userId = req.user?.userId;
        const orderId = req.params.orderId;
        const result = await orderService.getDropOtpUser(orderId, userId);
        return sendResponse(res, 200, 'Drop OTP retrieved', result);
    } catch (err) {
        next(err);
    }
}

/** Ledger rows from `food_order_payments` (append-only audit trail) */
export async function getOrderPaymentsUserController(req, res, next) {
    try {
        const userId = req.user?.userId;
        const orderId = req.params.orderId;
        const result = await foodOrderPaymentService.listFoodOrderPaymentsForUser(orderId, userId);
        return sendResponse(res, 200, 'Payment history', result);
    } catch (err) {
        next(err);
    }
}

export async function cancelOrderController(req, res, next) {
    try {
        const userId = req.user?.userId;
        const orderId = req.params.orderId;
        const dto = validateCancelOrderDto(req.body);
        const order = await orderService.cancelOrder(orderId, userId, dto.reason, dto.refundDestination);
        return sendResponse(res, 200, 'Order cancelled', { order });
    } catch (err) {
        next(err);
    }
}

export async function submitOrderRatingsController(req, res, next) {
    try {
        const userId = req.user?.userId;
        const orderId = req.params.orderId;
        const dto = validateOrderRatingsDto(req.body);
        const order = await orderService.submitOrderRatings(orderId, userId, dto);
        return sendResponse(res, 200, 'Ratings submitted successfully', { order });
    } catch (err) {
        next(err);
    }
}

export async function updateOrderInstructionsController(req, res, next) {
    try {
        const userId = req.user?.userId;
        const orderId = req.params.orderId;
        const instructions = req.body.instructions;
        const order = await orderService.updateOrderInstructions(orderId, userId, instructions);
        return sendResponse(res, 200, 'Instructions updated successfully', { order });
    } catch (err) {
        next(err);
    }
}

export async function getDispatchSettingsController(req, res, next) {
    try {
        const result = await orderService.getDispatchSettings();
        return sendResponse(res, 200, 'Dispatch settings retrieved', result);
    } catch (err) {
        next(err);
    }
}

export async function updateDispatchSettingsController(req, res, next) {
    try {
        const adminId = req.user?.userId;
        const dto = validateDispatchSettingsDto(req.body);
        const result = await orderService.updateDispatchSettings(dto.dispatchMode, adminId);
        return sendResponse(res, 200, 'Dispatch settings updated', result);
    } catch (err) {
        next(err);
    }
}

export async function listOrdersRestaurantController(req, res, next) {
    try {
        const restaurantId = req.user?.userId;
        const result = await orderService.listOrdersRestaurant(restaurantId, req.query);
        return sendResponse(res, 200, 'Orders retrieved', result);
    } catch (err) {
        next(err);
    }
}

export async function getOrderByIdRestaurantController(req, res, next) {
    try {
        const restaurantId = req.user?.userId;
        const orderId = req.params.orderId;
        const order = await orderService.getOrderById(orderId, { restaurantId });
        return sendResponse(res, 200, 'Order retrieved', { order });
    } catch (err) {
        next(err);
    }
}

export async function updateOrderStatusRestaurantController(req, res, next) {
    try {
        const restaurantId = req.user?.userId;
        const orderId = req.params.orderId;
        const dto = validateOrderStatusDto(req.body);
        const order = await orderService.updateOrderStatusRestaurant(orderId, restaurantId, dto.orderStatus, dto.note);
        return sendResponse(res, 200, 'Order status updated', { order });
    } catch (err) {
        next(err);
    }
}

export async function listOrdersAvailableDeliveryController(req, res, next) {
    try {
        const deliveryPartnerId = req.user?.userId;
        const result = await orderService.listOrdersAvailableDelivery(deliveryPartnerId, req.query);
        return sendResponse(res, 200, 'Orders retrieved', result);
    } catch (err) {
        next(err);
    }
}

export async function acceptOrderDeliveryController(req, res, next) {
    try {
        const deliveryPartnerId = req.user?.userId;
        const orderId = req.params.orderId;
        const order = await orderService.acceptOrderDelivery(orderId, deliveryPartnerId);
        return sendResponse(res, 200, 'Order accepted', { order });
    } catch (err) {
        next(err);
    }
}

export async function setPickupSequenceDeliveryController(req, res, next) {
    try {
        const deliveryPartnerId = req.user?.userId;
        const orderId = req.params.orderId;
        const restaurantIds =
            req.body?.restaurantIds ||
            req.body?.pickupSequence ||
            req.body?.sequence ||
            [];
        const order = await orderService.setPickupSequenceDelivery(
            orderId,
            deliveryPartnerId,
            restaurantIds,
        );
        return sendResponse(res, 200, 'Pickup sequence updated', { order });
    } catch (err) {
        next(err);
    }
}

export async function rejectOrderDeliveryController(req, res, next) {
    try {
        const deliveryPartnerId = req.user?.userId;
        const orderId = req.params.orderId;
        const order = await orderService.rejectOrderDelivery(orderId, deliveryPartnerId);
        return sendResponse(res, 200, 'Order rejected', { order });
    } catch (err) {
        next(err);
    }
}

export async function confirmReachedPickupDeliveryController(req, res, next) {
    try {
        const deliveryPartnerId = req.user?.userId;
        const orderId = req.params.orderId;
        const order = await orderService.confirmReachedPickupDelivery(orderId, deliveryPartnerId);
        return sendResponse(res, 200, 'Reached pickup confirmed', { order });
    } catch (err) {
        next(err);
    }
}

export async function confirmPickupDeliveryController(req, res, next) {
    try {
        const deliveryPartnerId = req.user?.userId;
        const orderId = req.params.orderId;
        const { billImageUrl } = req.body;
        const order = await orderService.confirmPickupDelivery(orderId, deliveryPartnerId, billImageUrl);
        return sendResponse(res, 200, 'Pickup confirmed', { order });
    } catch (err) {
        next(err);
    }
}

export async function confirmReachedDropDeliveryController(req, res, next) {
    try {
        const deliveryPartnerId = req.user?.userId;
        const orderId = req.params.orderId;
        const order = await orderService.confirmReachedDropDelivery(orderId, deliveryPartnerId);
        return sendResponse(res, 200, 'Reached drop confirmed', { order });
    } catch (err) {
        next(err);
    }
}

export async function verifyDropOtpDeliveryController(req, res, next) {
    try {
        const deliveryPartnerId = req.user?.userId;
        const orderId = req.params.orderId;
        const { otp } = req.body;
        const result = await orderService.verifyDropOtpDelivery(orderId, deliveryPartnerId, otp);
        return sendResponse(res, 200, 'OTP verified', { order: result.order });
    } catch (err) {
        next(err);
    }
}

export async function completeDeliveryController(req, res, next) {
    try {
        const deliveryPartnerId = req.user?.userId;
        const orderId = req.params.orderId;
        const order = await orderService.completeDelivery(orderId, deliveryPartnerId, req.body || {});
        return sendResponse(res, 200, 'Delivery completed', { order });
    } catch (err) {
        next(err);
    }
}

export async function updateOrderStatusDeliveryController(req, res, next) {
    try {
        const deliveryPartnerId = req.user?.userId;
        const orderId = req.params.orderId;
        const dto = validateOrderStatusDto(req.body);
        const order = await orderService.updateOrderStatusDelivery(orderId, deliveryPartnerId, dto.orderStatus);
        return sendResponse(res, 200, 'Order status updated', { order });
    } catch (err) {
        next(err);
    }
}

export async function getCurrentTripDeliveryController(req, res, next) {
    try {
        const deliveryPartnerId = req.user?.userId;
        const order = await orderService.getCurrentTripDelivery(deliveryPartnerId);
        return sendResponse(res, 200, 'Current trip retrieved', { activeOrder: order });
    } catch (err) {
        next(err);
    }
}

export async function createCollectQrController(req, res, next) {
    try {
        const deliveryPartnerId = req.user?.userId;
        const orderId = req.params.orderId;
        const customerInfo = req.body || {};
        const result = await orderService.createCollectQr(orderId, deliveryPartnerId, customerInfo);
        return sendResponse(res, 200, 'QR created', result);
    } catch (err) {
        next(err);
    }
}

export async function getOrderByIdDeliveryController(req, res, next) {
    try {
        const deliveryPartnerId = req.user?.userId;
        const orderId = req.params.orderId;
        const order = await orderService.getOrderById(orderId, { deliveryPartnerId });
        return sendResponse(res, 200, 'Order retrieved', { order });
    } catch (err) {
        next(err);
    }
}

export async function getPaymentStatusController(req, res, next) {
    try {
        const deliveryPartnerId = req.user?.userId;
        const orderId = req.params.orderId;
        const result = await orderService.getPaymentStatus(orderId, deliveryPartnerId);
        return sendResponse(res, 200, 'Payment status retrieved', result);
    } catch (err) {
        next(err);
    }
}

export async function listOrdersAdminController(req, res, next) {
    try {
        const result = await orderService.listOrdersAdmin(req.query);
        return sendResponse(res, 200, 'Orders retrieved', result);
    } catch (err) {
        next(err);
    }
}

export async function getOrderByIdAdminController(req, res, next) {
    try {
        const orderId = req.params.orderId;
        const order = await orderService.getOrderById(orderId, { admin: true });
        return sendResponse(res, 200, 'Order retrieved', { order });
    } catch (err) {
        next(err);
    }
}

export async function assignDeliveryPartnerController(req, res, next) {
    try {
        const adminId = req.user?.userId;
        const orderId = req.params.orderId;
        const dto = validateAssignDeliveryDto(req.body);
        const order = await orderService.assignDeliveryPartnerAdmin(orderId, dto.deliveryPartnerId, adminId);
        return sendResponse(res, 200, 'Delivery partner assigned', { order });
    } catch (err) {
        next(err);
    }
}

export async function assignSecondDeliveryPartnerController(req, res, next) {
    try {
        const adminId = req.user?.userId;
        const orderId = req.params.orderId;
        const dto = validateAssignDeliveryDto(req.body);
        const order = await orderService.assignSecondDeliveryPartnerAdmin(orderId, dto.deliveryPartnerId, adminId);
        return sendResponse(res, 200, 'Second delivery partner assigned', { order });
    } catch (err) {
        next(err);
    }
}

export async function cancelOrderAdminController(req, res, next) {
    try {
        const adminId = req.user?.userId;
        const orderId = req.params.orderId;
        const dto = validateCancelOrderDto(req.body || {});
        const order = await orderService.cancelOrderAdmin(
            orderId,
            adminId,
            dto.reason || '',
        );
        return sendResponse(res, 200, 'Order cancelled by admin successfully', { order });
    } catch (err) {
        next(err);
    }
}

export async function dropRestaurantFromOrderAdminController(req, res, next) {
    try {
        const adminId = req.user?.userId;
        const orderId = req.params.orderId;
        const restaurantId = req.params.restaurantId || req.body?.restaurantId;
        const reason = String(req.body?.reason || '').trim();
        const order = await orderService.dropRestaurantFromOrderByAdmin(
            orderId,
            restaurantId,
            adminId,
            reason,
        );
        return sendResponse(res, 200, 'Restaurant removed from order', { order });
    } catch (err) {
        next(err);
    }
}

export async function deleteOrderAdminController(req, res, next) {
    try {
        const adminId = req.user?.userId;
        const orderId = req.params.orderId;
        const result = await orderService.deleteOrderAdmin(orderId, adminId);
        return sendResponse(res, 200, 'Order deleted successfully', result);
    } catch (err) {
        next(err);
    }
}

export async function getMultiOrderSettlementReportController(req, res, next) {
    try {
        const data = await orderService.getMultiOrderSettlementReport(req.query || {});
        return sendResponse(res, 200, 'Multi-order settlement report fetched', data);
    } catch (err) {
        next(err);
    }
}

export async function resendDeliveryNotificationRestaurantController(req, res, next) {
    try {
        const restaurantId = req.user?.userId;
        const orderId = req.params.orderId;
        const result = await orderService.resendDeliveryNotificationRestaurant(orderId, restaurantId);
        return sendResponse(res, 200, 'Notification resent successfully', result);
    } catch (err) {
        next(err);
    }
}


export async function shareOrderDeliveryController(req, res, next) {
    try {
        const deliveryPartnerId = req.user?.userId;
        const orderId = req.params.orderId;
        const order = await orderService.shareOrderDelivery(orderId, deliveryPartnerId);
        return sendResponse(res, 200, 'Order marked as shared', { order });
    } catch (err) {
        next(err);
    }
}

export async function confirmSplitDeliveryController(req, res, next) {
    try {
        const deliveryPartnerId = req.user?.userId;
        const orderId = req.params.orderId;
        const order = await orderService.confirmSplitDelivery(orderId, deliveryPartnerId);
        return sendResponse(res, 200, 'Earnings split confirmed successfully', { order });
    } catch (err) {
        next(err);
    }
}

export async function acceptSharedOrderDeliveryController(req, res, next) {
    try {
        const deliveryPartnerId = req.user?.userId;
        const orderId = req.params.orderId;
        const order = await orderService.acceptSharedOrderDelivery(orderId, deliveryPartnerId);
        return sendResponse(res, 200, 'Shared order accepted', { order });
    } catch (err) {
        next(err);
    }
}

export async function reportOrderDelayController(req, res, next) {
    try {
        const userId = req.user?.userId;
        const role = req.user?.role;
        const orderId = req.params.orderId;
        const { reason } = req.body;
        const order = await orderService.reportOrderDelay(orderId, userId, role, reason);
        return sendResponse(res, 200, 'Order delay reported', { order });
    } catch (err) {
        next(err);
    }
}