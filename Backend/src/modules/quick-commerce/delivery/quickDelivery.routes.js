import express from 'express';
import { authMiddleware } from '../../../core/auth/auth.middleware.js';
import { requireRoles } from '../../../core/roles/role.middleware.js';
import {
  listAvailableQuickOrders,
  listCurrentQuickOrders,
  getQuickOrderDetails,
  acceptQuickOrderController,
  rejectQuickOrderController,
  reachedPickupController,
  confirmPickupController,
  reachedDropController,
  verifyDropOtpController,
  completeQuickOrderController,
} from './quickDelivery.controller.js';

const router = express.Router();

// Same rider accounts as Food: DELIVERY_PARTNER (legacy food login) or DRIVER (unified identity).
const riderOnly = [authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER')];

router.get('/orders/available', ...riderOnly, listAvailableQuickOrders);
router.get('/orders/current', ...riderOnly, listCurrentQuickOrders);
router.get('/orders/:orderId', ...riderOnly, getQuickOrderDetails);
router.patch('/orders/:orderId/accept', ...riderOnly, acceptQuickOrderController);
router.patch('/orders/:orderId/reject', ...riderOnly, rejectQuickOrderController);
router.patch('/orders/:orderId/reached-pickup', ...riderOnly, reachedPickupController);
router.patch('/orders/:orderId/confirm-pickup', ...riderOnly, confirmPickupController);
router.patch('/orders/:orderId/reached-drop', ...riderOnly, reachedDropController);
router.post('/orders/:orderId/verify-drop-otp', ...riderOnly, verifyDropOtpController);
router.patch('/orders/:orderId/complete', ...riderOnly, completeQuickOrderController);

export default router;
