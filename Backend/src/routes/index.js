import express from 'express';
import authRoutes from '../core/auth/auth.routes.js';
import deliveryRoutes from '../modules/food/delivery/routes/delivery.routes.js';
import restaurantRoutes from '../modules/food/restaurant/routes/restaurant.routes.js';
import landingRoutes from '../modules/food/landing/routes/landing.routes.js';
import {
  getPublicDiningCategories,
  getPublicDiningRestaurants,
  getPublicDiningHome,
} from '../modules/food/dining/controllers/diningPublic.controller.js';
import uploadRoutes from '../modules/uploads/routes/upload.routes.js';
import restaurantAdminRoutes from '../modules/food/admin/routes/admin.routes.js';
import userRoutes from '../modules/food/user/routes/user.routes.js';
import orderUserRoutes from '../modules/food/orders/routes/order.routes.user.js';
import diningUserRoutes from '../modules/food/dining/routes/dining.routes.user.js';
import paymentRoutes from '../core/payments/payment.routes.js';
import fcmRoutes from '../core/notifications/fcm.routes.js';
import notificationRoutes from '../core/notifications/notification.routes.js';
import { authMiddleware } from '../core/auth/auth.middleware.js';
import * as businessSettingsController from '../modules/food/admin/controllers/businessSettings.controller.js';
import { requireRoles } from '../core/roles/role.middleware.js';
import { getQueuesController } from '../controllers/admin.controller.js';
import { getPublicEnvController } from '../modules/food/landing/controllers/publicEnv.controller.js';
import webhookRoutes from '../core/payments/routes/webhook.routes.js'; // ✅ NEW
import searchRoutes from '../modules/food/search/routes/search.routes.js';
import masterProfileRoutes from '../core/profile/profile.routes.js';
import identityRoutes from '../core/identity/identity.routes.js';
import driverOnboardingRoutes from '../core/identity/driverOnboarding.routes.js';
import driverModeRoutes from '../core/identity/driverMode.routes.js';
import { cacheResponse } from '../middleware/cache.js';
import locationRoutes from '../core/location/routes/location.routes.js';

const router = express.Router();

// ... (previous routes)

router.get('/v1/health', (req, res) => {
    res.status(200).json({ status: 'UP', message: 'Server is healthy' });
});

// Food-prefixed auth routes (preferred)
router.use('/v1/food/auth', authRoutes);

// Backward-compatible auth routes (legacy)
router.use('/v1/auth', authRoutes);

// Unified identity-based auth (new). One pair of endpoints serves both
// customers and drivers. Legacy endpoints above stay
// alive during the migration window.
router.use('/v1/auth', identityRoutes);

// Driver onboarding wizard + capability enable. Token issued by /verify-otp
// with role=DRIVER works here.
router.use('/v1/driver/onboarding', driverOnboardingRoutes);
router.use('/v1/driver', driverModeRoutes);
router.use('/v1/food/delivery', deliveryRoutes);
router.use('/v1/food/restaurant', restaurantRoutes);
// Landing & hero-banners for Food user app (paths start with /food/hero-banners/...)
router.use('/v1/food', landingRoutes);
router.use('/v1/food/search', searchRoutes);
router.get('/v1/food/dining/home/public', cacheResponse(120, 'food_dining'), getPublicDiningHome);
router.get('/v1/food/dining/categories/public', cacheResponse(300, 'food_dining'), getPublicDiningCategories);
router.get('/v1/food/dining/restaurants/public', cacheResponse(120, 'food_dining'), getPublicDiningRestaurants);
router.use('/v1/uploads', uploadRoutes);

// Mark business-settings/public as truly public (must be before protected admin block)
router.get('/v1/food/admin/business-settings/public', businessSettingsController.getBusinessSettings);

router.use('/v1/food/admin', authMiddleware, requireRoles('ADMIN'), restaurantAdminRoutes);
router.use('/v1/food/user', authMiddleware, requireRoles('USER'), userRoutes);
router.use('/v1/profile', authMiddleware, requireRoles('USER'), masterProfileRoutes);

router.use('/v1/food/notifications', authMiddleware, requireRoles('USER', 'RESTAURANT', 'DELIVERY_PARTNER'), notificationRoutes);
router.use('/v1/location', authMiddleware, requireRoles('USER', 'RESTAURANT', 'DELIVERY_PARTNER'), locationRoutes);
router.use('/v1/food/orders', authMiddleware, requireRoles('USER'), orderUserRoutes);
router.use('/v1/food/dining', authMiddleware, requireRoles('USER'), diningUserRoutes);
router.use('/v1/food/payments', authMiddleware, paymentRoutes);
router.use('/v1/payments/webhook', webhookRoutes); // ✅ NEW: Public Webhook
router.use('/v1/fcm-tokens', fcmRoutes);
router.use('/fcm-tokens', fcmRoutes);

// router.get('/v1/env/public', getPublicEnvController);
// router.get('/env/public', getPublicEnvController);

router.get('/v1/admin/queues', authMiddleware, requireRoles('ADMIN'), getQueuesController);

export default router;
