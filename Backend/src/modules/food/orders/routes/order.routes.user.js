import express from 'express';
import {
    calculateOrderController,
    createOrderController,
    verifyPaymentController,
    cancelCheckoutController,
    listOrdersUserController,
    getOrderPaymentsUserController,
    getOrderByIdUserController,
    cancelOrderController,
    submitOrderRatingsController,
    getOrderDropOtpUserController,
    updateOrderInstructionsController,
    validateRestaurantChainController,
    restaurantEligibilityController,
} from '../controllers/order.controller.js';

const router = express.Router();

router.post('/validate-restaurant-chain', validateRestaurantChainController);
router.post('/calculate', calculateOrderController);
router.post('/', createOrderController);
router.post('/verify-payment', verifyPaymentController);
router.post('/checkout/:checkoutId/cancel', cancelCheckoutController);
router.get('/', listOrdersUserController);
router.get('/restaurant-eligibility', restaurantEligibilityController);
router.get('/:orderId/payments', getOrderPaymentsUserController);
router.get('/:orderId/drop-otp', getOrderDropOtpUserController);
router.get('/:orderId', getOrderByIdUserController);
router.patch('/:orderId/cancel', cancelOrderController);
router.patch('/:orderId/ratings', submitOrderRatingsController);
router.patch('/:orderId/instructions', updateOrderInstructionsController);

export default router;
