import { Router } from 'express';
import {
  getVehicleMapIconImage,
  getVehicleMapIcons,
} from '../controllers/vehicleMapIconController.js';
import { getPublicBanners } from '../../admin/promotions/controllers/promotionsController.js';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/authMiddleware.js';
import {
  loginRateLimit,
  routeRateLimit,
  otpSendRateLimit,
  otpVerifyRateLimit,
  paymentOrderRateLimit,
} from '../../middlewares/rateLimitMiddleware.js';
import {
  createRazorpayWalletTopupOrder,
  createPhonePeWalletTopupOrder,
  handleUserRazorpayWalletTopupCallback,
  getUserWallet,
  getCurrentUser,
  getUserNotifications,
  deleteUserNotification,
  getIntercityPackageCatalog,
  clearAllUserNotifications,
  listPublicServiceLocations,
  loginUser,
  registerUser,
  requestAccountDeletion,
  saveUserFcmToken,
  submitWebsiteBooking,
  signupUser,
  startUserOtpRequest,
  transferUserWalletToDriver,
  transferUserWallet,
  updateCurrentUser,
  uploadUserProfileImage,
  verifyRazorpayWalletTopup,
  verifyPhonePeWalletTopup,
  verifyUserOtpRequest,
  verifyUserPhoneForOtpLogin,
  getRoute,
  getSetPrices,
  getTripCategory,
  getZones,
} from '../controllers/userController.js';
import { getAppBootstrap, getAppModules, getGeneralSettingsCategory, getGoodsTypes, getPublicVehicleTypeCatalog, getPublicLandingContent, getPublicLegalContent, submitWebsiteEnquiry } from '../../admin/controllers/adminController.js';
import { getPublicCancellationReasons } from '../../admin/controllers/cancellationReasonController.js';
import { getMyEmergencyContacts, saveMyEmergencyContacts, triggerUserSosAlert } from '../../safety/controllers/safetyController.js';

export const userRouter = Router();

userRouter.get('/bootstrap', asyncHandler(getAppBootstrap));
userRouter.get('/app-modules', asyncHandler(getAppModules));
userRouter.get('/settings/:category', asyncHandler(getGeneralSettingsCategory));
// Admin-managed reasons the rider picks from when cancelling a trip.
userRouter.get('/cancellation-reasons', getPublicCancellationReasons);
userRouter.get('/intercity-packages', asyncHandler(getIntercityPackageCatalog));
userRouter.get('/goods-types', asyncHandler(getGoodsTypes));
userRouter.get('/vehicle-types', asyncHandler(getPublicVehicleTypeCatalog));
userRouter.get('/landing-content', asyncHandler(getPublicLandingContent));
// Marker art for the map. The controller has existed since the marker work
// landed but was never routed, so both apps 404'd and silently fell back to
// bundled silhouettes - admin-uploaded vehicle art never reached a map.
userRouter.get('/vehicle-map-icons', asyncHandler(getVehicleMapIcons));
userRouter.get('/vehicle-map-icons/:vehicleId/image', asyncHandler(getVehicleMapIconImage));
// Home-screen promo banners, which were only exposed under /admin, so the
// app's request 404'd and the carousel stayed empty.
userRouter.get('/banners', asyncHandler(getPublicBanners));
userRouter.get('/legal-content', asyncHandler(getPublicLegalContent));
userRouter.get('/set-prices', asyncHandler(getSetPrices));
// City, airport or outstation for a pickup and drop - decides the vehicles offered.
userRouter.get('/trip-category', getTripCategory);
// Road routes for the maps. Authenticated and rate limited because every
// cache miss is a billed Directions call.
userRouter.get('/route', authenticate(['user', 'driver']), routeRateLimit, asyncHandler(getRoute));
userRouter.get('/zones', asyncHandler(getZones));
userRouter.get('/service-locations', asyncHandler(listPublicServiceLocations));
// Sign-up, login, OTP and push-token registration are the platform's customer auth (core/auth,
// core/notifications); taxi riders are ordinary platform customers and have no login of their own.

// Public: booking enquiry from the marketing site. Rate limited because it
// is unauthenticated and writes a record.
// Public marketing forms. Same rate limit as the booking form - both are
// unauthenticated and equally worth spamming.
userRouter.get('/me', authenticate(['user']), asyncHandler(getCurrentUser));
userRouter.patch('/me', authenticate(['user']), asyncHandler(updateCurrentUser));
userRouter.post('/me/delete-request', authenticate(['user']), asyncHandler(requestAccountDeletion));
userRouter.get('/notifications', authenticate(['user']), asyncHandler(getUserNotifications));
userRouter.delete('/notifications/:id', authenticate(['user']), asyncHandler(deleteUserNotification));
userRouter.delete('/notifications', authenticate(['user']), asyncHandler(clearAllUserNotifications));
userRouter.post('/sos', authenticate(['user']), asyncHandler(triggerUserSosAlert));
userRouter.get('/emergency-contacts', authenticate(['user']), getMyEmergencyContacts);
userRouter.put('/emergency-contacts', authenticate(['user']), saveMyEmergencyContacts);
// The app's API client sends PATCH.
userRouter.patch('/emergency-contacts', authenticate(['user']), saveMyEmergencyContacts);
userRouter.get('/wallet', authenticate(['user']), asyncHandler(getUserWallet));
// No manual wallet top-up: it credited any amount without a payment. Money only enters the wallet
// through the Razorpay top-up below (shared with Food / Quick Commerce).
userRouter.post('/wallet/transfer', authenticate(['user']), asyncHandler(transferUserWallet));
userRouter.post('/wallet/transfer/driver', authenticate(['user']), asyncHandler(transferUserWalletToDriver));
userRouter.post('/wallet/razorpay/order', authenticate(['user']), paymentOrderRateLimit, asyncHandler(createRazorpayWalletTopupOrder));
userRouter.post('/wallet/razorpay/verify', authenticate(['user']), asyncHandler(verifyRazorpayWalletTopup));
userRouter.post('/wallet/razorpay/callback', asyncHandler(handleUserRazorpayWalletTopupCallback));
userRouter.get('/wallet/razorpay/callback', asyncHandler(handleUserRazorpayWalletTopupCallback));
userRouter.post('/wallet/phonepe/order', authenticate(['user']), paymentOrderRateLimit, asyncHandler(createPhonePeWalletTopupOrder));
userRouter.get('/wallet/phonepe/status/:merchantTransactionId', authenticate(['user']), asyncHandler(verifyPhonePeWalletTopup));
