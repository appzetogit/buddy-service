import express from 'express';
import { upload } from '../../../../middleware/upload.js';
import { authMiddleware } from '../../../../core/auth/auth.middleware.js';
import { requireRoles } from '../../../../core/roles/role.middleware.js';
import * as orderController from '../../orders/controllers/order.controller.js';
import { registerDeliveryPartnerController, updateDeliveryPartnerProfileController, updateDeliveryPartnerBankDetailsController, listSupportTicketsController, createSupportTicketController, getSupportTicketByIdController, updateDeliveryPartnerDetailsController, updateDeliveryPartnerProfilePhotoBase64Controller, updateAvailabilityController, getWalletController, createWithdrawalRequestController, createCashDepositOrderController, verifyCashDepositPaymentController, getEarningsController, getTripHistoryController, getPocketDetailsController, getEmergencyHelpController, getCashLimitController, getDeliveryReferralStatsController, getActiveEarningAddonsController } from '../controllers/delivery.controller.js';
import { deleteDeliveryAccountController } from '../controllers/deleteAccount.controller.js';
import { fetchPolyline } from '../../orders/utils/googleMaps.js';

const router = express.Router();

const uploadFields = upload.fields([
    { name: 'profilePhoto', maxCount: 1 },
    { name: 'aadharPhoto', maxCount: 1 },
    { name: 'panPhoto', maxCount: 1 },
    { name: 'drivingLicensePhoto', maxCount: 1 },
    { name: 'upiQrCode', maxCount: 1 }
]);

router.post('/register', uploadFields, registerDeliveryPartnerController);

router.patch('/profile', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), uploadFields, updateDeliveryPartnerProfileController);

// JSON-only profile updates (no files) – safe for web updates like vehicle number.
router.patch('/profile/details', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), updateDeliveryPartnerDetailsController);

// Base64 profile photo update – designed for Flutter in-app WebView camera handler.
router.post('/profile/photo-base64', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), updateDeliveryPartnerProfilePhotoBase64Controller);

router.patch('/profile/bank-details', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), uploadFields, updateDeliveryPartnerBankDetailsController);

router.patch('/availability', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), updateAvailabilityController);

router.get('/support-tickets', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), listSupportTicketsController);
router.post('/support-tickets', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), createSupportTicketController);
router.get('/support-tickets/:id', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), getSupportTicketByIdController);

// Road route for the rider app's map. Google Directions via the server key (the
// app's own Maps key has no Directions access). `polyline` is '' when Google
// fails; the app then falls back to a straight line.
router.get('/route', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), async (req, res) => {
    const [oLat, oLng, dLat, dLng] = ['originLat', 'originLng', 'destLat', 'destLng'].map((k) => Number(req.query[k]));
    if (![oLat, oLng, dLat, dLng].every(Number.isFinite)) {
        return res.status(400).json({ success: false, message: 'originLat, originLng, destLat and destLng are required' });
    }
    const polyline = await fetchPolyline({ lat: oLat, lng: oLng }, { lat: dLat, lng: dLng });
    return res.json({ success: true, message: 'Route', data: { polyline } });
});

// ----- Orders -----
router.get('/orders/current', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), orderController.getCurrentTripDeliveryController);
router.get('/orders/available', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), orderController.listOrdersAvailableDeliveryController);
router.get('/orders/:orderId', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), orderController.getOrderByIdDeliveryController);
router.patch('/orders/:orderId/accept', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), orderController.acceptOrderDeliveryController);
router.patch('/orders/:orderId/pickup-sequence', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), orderController.setPickupSequenceDeliveryController);
router.patch('/orders/:orderId/reject', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), orderController.rejectOrderDeliveryController);
router.patch('/orders/:orderId/reached-pickup', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), orderController.confirmReachedPickupDeliveryController);
router.patch('/orders/:orderId/confirm-pickup', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), orderController.confirmPickupDeliveryController);
router.patch('/orders/:orderId/reached-drop', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), orderController.confirmReachedDropDeliveryController);
router.post('/orders/:orderId/verify-drop-otp', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), orderController.verifyDropOtpDeliveryController);
router.patch('/orders/:orderId/complete', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), orderController.completeDeliveryController);
router.patch('/orders/:orderId/status', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), orderController.updateOrderStatusDeliveryController);
router.post('/orders/:orderId/collect/qr', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), orderController.createCollectQrController);
router.get('/orders/:orderId/payment-status', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), orderController.getPaymentStatusController);
router.post('/orders/:orderId/share', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), orderController.shareOrderDeliveryController);
router.post('/orders/:orderId/accept-share', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), orderController.acceptSharedOrderDeliveryController);
router.patch('/orders/:orderId/confirm-split', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), orderController.confirmSplitDeliveryController);
router.post('/orders/:orderId/delay', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), orderController.reportOrderDelayController);

// ----- Earnings / Settings -----
router.get('/earning-addons/active', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), getActiveEarningAddonsController);
router.post('/reverify', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), (req, res) => res.json({ success: true, message: 'Submitted' })); // Stub

// Pocket / requests page – wallet, earnings, and admin-set delivery settings
router.get('/wallet', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), getWalletController);
router.post('/wallet/withdraw', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), createWithdrawalRequestController);
router.post('/wallet/deposit/order', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), createCashDepositOrderController);
router.post('/wallet/deposit/verify', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), verifyCashDepositPaymentController);
router.get('/earnings', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), getEarningsController);
router.get('/trip-history', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), getTripHistoryController);
router.get('/pocket-details', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), getPocketDetailsController);
router.get('/emergency-help', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), getEmergencyHelpController);
router.get('/cash-limit', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), getCashLimitController);
router.get('/referrals/stats', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), getDeliveryReferralStatsController);

// Delete account (Bearer DELIVERY_PARTNER)
router.delete('/account', authMiddleware, requireRoles('DELIVERY_PARTNER', 'DRIVER'), deleteDeliveryAccountController);

export default router;
