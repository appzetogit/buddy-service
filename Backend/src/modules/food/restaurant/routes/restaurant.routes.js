import express from 'express';
import { upload } from '../../../../middleware/upload.js';
import {
    registerRestaurantController,
    listApprovedRestaurantsController,
    getApprovedRestaurantController,
    getPublicFoodsController,
    listPublicOffersController,
    listOffersForRestaurantPageController,
    listDeliverySpeedOptionsController,
    getPublicCheckoutSettingsController,
    listRestaurantOffersController,
    createRestaurantOfferController,
    updateRestaurantOfferController,
    deleteRestaurantOfferController,
    reapplyRestaurantOfferController,
    getRestaurantOfferAnalyticsController,
    getRestaurantOfferUsageHistoryController,
    getCurrentRestaurantController,
    updateRestaurantProfileController,
    updateRestaurantAcceptingOrdersController,
    updateCurrentRestaurantDiningSettingsController,
    uploadRestaurantProfileImageController,
    uploadRestaurantMenuImageController,
    uploadRestaurantCoverImagesController,
    uploadRestaurantMenuImagesController,
    getRestaurantComplaintsController,
    createDiningRequestController,
    getPendingDiningRequestController
} from '../controllers/restaurant.controller.js';
import {
    createRestaurantSupportTicketController,
    listRestaurantSupportTicketsController
} from '../controllers/supportTicket.controller.js';
import {
    createWithdrawalRequestController,
    listMyWithdrawalsController
} from '../controllers/withdrawal.controller.js';
import {
    listCategoriesController,
    createCategoryController,
    updateCategoryController,
    deleteCategoryController
} from '../controllers/restaurantCategory.controller.js';
import { getMenuController, updateMenuController, getPublicRestaurantMenuController } from '../controllers/restaurantMenu.controller.js';
import { getPublicRestaurantAddonsController } from '../controllers/publicAddons.controller.js';
import * as feedbackExperienceController from '../../admin/controllers/feedbackExperience.controller.js';
import {
    getOutletTimingsByRestaurantIdController,
    getCurrentRestaurantOutletTimingsController,
    upsertCurrentRestaurantOutletTimingsController
} from '../controllers/outletTimings.controller.js';
import {
    createRestaurantFoodController,
    bulkCreateRestaurantFoodController,
    updateRestaurantFoodController,
    deleteRestaurantFoodController,
} from '../controllers/restaurantFood.controller.js';
import {
    listAddonsController,
    createAddonController,
    updateAddonController,
    deleteAddonController
} from '../controllers/restaurantAddon.controller.js';
import * as orderController from '../../orders/controllers/order.controller.js';
import { downloadRestaurantMenuPdf } from '../../admin/controllers/admin.controller.js';
import { authMiddleware } from '../../../../core/auth/auth.middleware.js';
import { sendError } from '../../../../utils/response.js';
import { getRestaurantFinanceController } from '../controllers/restaurantFinance.controller.js';
import { deleteRestaurantAccountController } from '../controllers/deleteAccount.controller.js';
import {
    getOnboardingProgressController,
    saveOnboardingStepController,
    submitOnboardingController,
} from '../controllers/restaurantOnboarding.controller.js';
import { cacheResponse } from '../../../../middleware/cache.js';
import {
    withFoodCacheInvalidation,
    invalidateAfterRestaurantProfileUpdate,
    invalidateAfterRestaurantMenuMutation,
    invalidateAfterRestaurantCategoryMutation,
} from '../../utils/foodCacheInvalidation.js';
import diningRestaurantRoutes from '../../dining/routes/dining.routes.restaurant.js';

const router = express.Router();

const requireRestaurant = (req, res, next) => {
    if (req.user?.role !== 'RESTAURANT') {
        return sendError(res, 403, 'Restaurant access required');
    }
    next();
};

const invProfile = withFoodCacheInvalidation(invalidateAfterRestaurantProfileUpdate);
const invMenu = withFoodCacheInvalidation(invalidateAfterRestaurantMenuMutation);
const invCategory = withFoodCacheInvalidation(invalidateAfterRestaurantCategoryMutation);

const uploadFields = upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'panImage', maxCount: 1 },
    { name: 'gstImage', maxCount: 1 },
    { name: 'fssaiImage', maxCount: 1 },
    { name: 'menuImages', maxCount: 10 },
    { name: 'menuPdf', maxCount: 1 }
]);

const onboardingUploadFields = upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'panImage', maxCount: 1 },
    { name: 'gstImage', maxCount: 1 },
    { name: 'fssaiImage', maxCount: 1 },
    { name: 'menuImages', maxCount: 10 }
]);

router.post('/register', uploadFields, registerRestaurantController);

router.get('/onboarding', authMiddleware, requireRestaurant, getOnboardingProgressController);
router.put(
    '/onboarding/step/:step',
    authMiddleware,
    requireRestaurant,
    onboardingUploadFields,
    saveOnboardingStepController
);
router.post(
    '/onboarding/submit',
    authMiddleware,
    requireRestaurant,
    onboardingUploadFields,
    submitOnboardingController
);

router.get('/restaurants', cacheResponse(300, 'restaurants'), listApprovedRestaurantsController);
router.get('/public/foods', cacheResponse(120, 'public_foods'), getPublicFoodsController);
router.get('/restaurants/:id', cacheResponse(600, 'restaurant_detail'), getApprovedRestaurantController);
router.get('/restaurants/:id/menu', cacheResponse(600, 'restaurant_menu'), getPublicRestaurantMenuController);
router.get('/restaurants/:id/outlet-timings', cacheResponse(600, 'restaurant_timings'), getOutletTimingsByRestaurantIdController);
router.get('/restaurants/:id/offers', cacheResponse(120, 'restaurant_offers'), listOffersForRestaurantPageController);
router.get('/offers', cacheResponse(300, 'offers'), listPublicOffersController);
router.get('/delivery-speed-options', cacheResponse(300, 'delivery_speed_options'), listDeliverySpeedOptionsController);
router.get('/checkout-settings/public', cacheResponse(60, 'checkout_settings'), getPublicCheckoutSettingsController);
router.get('/my-offers', authMiddleware, requireRestaurant, listRestaurantOffersController);
router.get('/my-offers/:id/analytics', authMiddleware, requireRestaurant, getRestaurantOfferAnalyticsController);
router.get('/my-offers/:id/history', authMiddleware, requireRestaurant, getRestaurantOfferUsageHistoryController);
router.post('/my-offers', authMiddleware, requireRestaurant, createRestaurantOfferController);
router.patch('/my-offers/:id/reapply', authMiddleware, requireRestaurant, reapplyRestaurantOfferController);
router.patch('/my-offers/:id', authMiddleware, requireRestaurant, updateRestaurantOfferController);
router.delete('/my-offers/:id', authMiddleware, requireRestaurant, deleteRestaurantOfferController);
router.get('/categories/public', cacheResponse(600, 'categories'), listCategoriesController);

router.get('/current', authMiddleware, requireRestaurant, getCurrentRestaurantController);
router.patch('/profile', authMiddleware, requireRestaurant, invProfile, updateRestaurantProfileController);
router.patch('/availability', authMiddleware, requireRestaurant, invProfile, updateRestaurantAcceptingOrdersController);
router.patch('/dining-settings', authMiddleware, requireRestaurant, invProfile, updateCurrentRestaurantDiningSettingsController);
router.post('/dining-settings/request', authMiddleware, requireRestaurant, createDiningRequestController);
router.get('/dining-settings/pending', authMiddleware, requireRestaurant, getPendingDiningRequestController);
router.use('/dining', authMiddleware, requireRestaurant, diningRestaurantRoutes);
router.get('/outlet-timings', authMiddleware, requireRestaurant, getCurrentRestaurantOutletTimingsController);
router.put('/outlet-timings', authMiddleware, requireRestaurant, invMenu, upsertCurrentRestaurantOutletTimingsController);
router.get('/finance', authMiddleware, requireRestaurant, getRestaurantFinanceController);
router.post('/withdraw', authMiddleware, requireRestaurant, createWithdrawalRequestController);
router.get('/withdrawals', authMiddleware, requireRestaurant, listMyWithdrawalsController);
router.post(
    '/profile/profile-image',
    authMiddleware,
    requireRestaurant,
    upload.single('file'),
    invProfile,
    uploadRestaurantProfileImageController
);
router.post(
    '/profile/menu-image',
    authMiddleware,
    requireRestaurant,
    upload.single('file'),
    invMenu,
    uploadRestaurantMenuImageController
);
router.post(
    '/profile/cover-images',
    authMiddleware,
    requireRestaurant,
    upload.array('files', 20),
    invProfile,
    uploadRestaurantCoverImagesController
);
router.post(
    '/profile/menu-images',
    authMiddleware,
    requireRestaurant,
    upload.array('files', 20),
    invMenu,
    uploadRestaurantMenuImagesController
);

router.get('/categories', authMiddleware, requireRestaurant, listCategoriesController);
router.post('/categories', authMiddleware, requireRestaurant, invCategory, createCategoryController);
router.patch('/categories/:id', authMiddleware, requireRestaurant, invCategory, updateCategoryController);
router.delete('/categories/:id', authMiddleware, requireRestaurant, invCategory, deleteCategoryController);

router.get('/menu', authMiddleware, requireRestaurant, getMenuController);
router.patch('/menu', authMiddleware, requireRestaurant, invMenu, updateMenuController);

router.post('/feedback-experience', authMiddleware, requireRestaurant, feedbackExperienceController.createFeedbackExperience);

router.get('/restaurants/:id/addons', cacheResponse(600, 'restaurant_addons'), getPublicRestaurantAddonsController);

router.post('/foods', authMiddleware, requireRestaurant, invMenu, createRestaurantFoodController);
router.post('/foods/bulk', authMiddleware, requireRestaurant, invMenu, bulkCreateRestaurantFoodController);
router.patch('/foods/:id', authMiddleware, requireRestaurant, invMenu, updateRestaurantFoodController);
router.delete('/foods/:id', authMiddleware, requireRestaurant, invMenu, deleteRestaurantFoodController);

router.get('/addons', authMiddleware, requireRestaurant, listAddonsController);
router.post('/addons', authMiddleware, requireRestaurant, invMenu, createAddonController);
router.patch('/addons/:id', authMiddleware, requireRestaurant, invMenu, updateAddonController);
router.delete('/addons/:id', authMiddleware, requireRestaurant, invMenu, deleteAddonController);

router.get('/orders', authMiddleware, requireRestaurant, orderController.listOrdersRestaurantController);
router.get('/orders/:orderId', authMiddleware, requireRestaurant, orderController.getOrderByIdRestaurantController);
router.patch('/orders/:orderId/status', authMiddleware, requireRestaurant, orderController.updateOrderStatusRestaurantController);
router.post('/orders/:orderId/resend-notification', authMiddleware, requireRestaurant, orderController.resendDeliveryNotificationRestaurantController);
router.post('/orders/:orderId/delay', authMiddleware, requireRestaurant, orderController.reportOrderDelayController);

router.get('/complaints', authMiddleware, requireRestaurant, getRestaurantComplaintsController);
router.post('/support/tickets', authMiddleware, requireRestaurant, createRestaurantSupportTicketController);
router.get('/support/tickets', authMiddleware, requireRestaurant, listRestaurantSupportTicketsController);

router.get('/download-menu-pdf/:id', authMiddleware, (req, res, next) => {
    const isAdmin = req.user?.role === 'ADMIN';
    const isOwner = req.user?.userId === req.params.id;

    if (!isAdmin && !isOwner) {
        return sendError(res, 403, 'You can only download your own restaurant menu PDF');
    }

    downloadRestaurantMenuPdf(req, res, next);
});

router.delete('/account', authMiddleware, requireRestaurant, deleteRestaurantAccountController);

export default router;
