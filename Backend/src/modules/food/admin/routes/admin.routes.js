import express from 'express';
import { AuthError } from '../../../../core/auth/errors.js';
import * as adminController from '../controllers/admin.controller.js';
import * as foodApprovalController from '../controllers/foodApproval.controller.js';
import * as addonsApprovalController from '../controllers/addonsApproval.controller.js';
import * as businessSettingsController from '../controllers/businessSettings.controller.js';
import * as feedbackExperienceController from '../controllers/feedbackExperience.controller.js';
import * as notificationBroadcastController from '../controllers/notificationBroadcast.controller.js';
import * as diningAdminController from '../../dining/controllers/diningAdmin.controller.js';
import * as orderController from '../../orders/controllers/order.controller.js';
import { getAdminPageController, upsertAdminPageController } from '../controllers/pageContent.controller.js';
import { upload } from '../../../../middleware/upload.js';
import { bulkUpload } from '../../../../middleware/bulkUpload.js';
import {
    bulkUploadFoodsAdmin,
    bulkUploadAddonsAdmin,
    downloadFoodTemplateAdmin,
    downloadAddonTemplateAdmin,
} from '../../shared/bulkImport.controller.js';
import {
    withFoodCacheInvalidation,
    invalidateAfterAdminRestaurantMutation,
    invalidateAfterAdminCategoryMutation,
    invalidateAfterAdminFoodMutation,
    invalidateAfterAdminAddonMutation,
    invalidateAfterOfferMutation,
    invalidateAfterZoneMutation,
    invalidateAfterDiningAdminMutation,
    invalidateAfterDeliveryBoySettingsMutation,
} from '../../utils/foodCacheInvalidation.js';

const router = express.Router();

const invRestaurant = withFoodCacheInvalidation(invalidateAfterAdminRestaurantMutation);
const invCategory = withFoodCacheInvalidation(invalidateAfterAdminCategoryMutation);
const invFood = withFoodCacheInvalidation(invalidateAfterAdminFoodMutation);
const invAddon = withFoodCacheInvalidation(invalidateAfterAdminAddonMutation);
const invOffer = withFoodCacheInvalidation(invalidateAfterOfferMutation);
const invZone = withFoodCacheInvalidation(invalidateAfterZoneMutation);
const invDining = withFoodCacheInvalidation(invalidateAfterDiningAdminMutation);
const invDeliveryBoySettings = withFoodCacheInvalidation(invalidateAfterDeliveryBoySettingsMutation);

// ----- Public Business Settings (No Admin Required) -----
router.get('/business-settings/public', businessSettingsController.getBusinessSettings);
router.get('/fee-settings/public', adminController.getPublicFeeSettings);
router.get('/peak-hour-rules/active', adminController.getActivePeakHourSurchargePublic);

const requireAdmin = (req, _res, next) => {
    const user = req.user;
    if (!user || user.role !== 'ADMIN') {
        return next(new AuthError('Admin access required'));
    }
    return next();
};

router.use(requireAdmin);

// ----- Broadcast Notifications -----
router.post('/notifications/broadcast', notificationBroadcastController.createBroadcastNotificationController);
router.get('/notifications/broadcast', notificationBroadcastController.getBroadcastNotificationsController);
router.delete('/notifications/broadcast/:id', notificationBroadcastController.deleteBroadcastNotificationController);

// ----- Customers -----
router.get('/customers', adminController.getCustomers);
router.get('/customers/:id', adminController.getCustomerById);
router.patch('/customers/:id/status', adminController.updateCustomerStatus);
router.put('/customers/bulk-cod', adminController.bulkToggleCod);

// ----- Safety / Emergency Reports -----
router.get('/safety-emergency-reports', adminController.getSafetyEmergencyReports);
router.put('/safety-emergency-reports/:id/status', adminController.updateSafetyEmergencyStatus);
router.put('/safety-emergency-reports/:id/priority', adminController.updateSafetyEmergencyPriority);
router.delete('/safety-emergency-reports/:id', adminController.deleteSafetyEmergencyReport);

// ----- Support Tickets (users) -----
router.get('/support-tickets', adminController.getSupportTicketsController);
router.patch('/support-tickets/:id', adminController.updateSupportTicketController);
router.get('/global-search', adminController.globalSearch);
router.get('/restaurants/complaints', adminController.getRestaurantComplaints);
router.patch('/restaurants/complaints/:id', adminController.updateRestaurantComplaint);

// ----- Restaurants -----
router.get('/restaurants', adminController.getRestaurants);
router.get('/dashboard-stats', adminController.getDashboardStats);
router.get('/reports/restaurants', adminController.getRestaurantReport);
router.get('/reports/transactions', adminController.getTransactionReport);
router.get('/reports/tax', adminController.getTaxReport);
router.get('/reports/tax/:id', adminController.getTaxReportDetail);
router.get('/restaurants/pending', adminController.getPendingRestaurants);
router.get('/restaurants/check-phone', adminController.checkRestaurantPhone);
router.get('/restaurants/check-email', adminController.checkRestaurantEmail);
router.get('/restaurants/reviews', adminController.getRestaurantReviews);
router.get('/restaurants/:id/menu-pdf', adminController.getRestaurantMenuPdfDownloadUrl);
router.get('/restaurants/:id/download-menu-pdf', adminController.downloadRestaurantMenuPdf);
router.get('/restaurants/:id', adminController.getRestaurantById);
router.get('/restaurants/:id/analytics', adminController.getRestaurantAnalytics);
router.get('/restaurants/:id/menu', adminController.getRestaurantMenuById);
router.get('/restaurants/:id/menu-pdf', adminController.getRestaurantMenuPdfDownloadUrl);
router.post('/restaurants', invRestaurant, adminController.createRestaurant);
router.patch('/restaurants/:id', invRestaurant, adminController.updateRestaurantById);
router.patch('/restaurants/:id/status', invRestaurant, adminController.updateRestaurantStatus);
router.patch('/restaurants/:id/location', invRestaurant, adminController.updateRestaurantLocation);
router.patch('/restaurants/:id/menu', invRestaurant, adminController.updateRestaurantMenuById);
router.patch('/restaurants/:id/approve', invRestaurant, adminController.approveRestaurant);
router.patch('/restaurants/:id/reject', invRestaurant, adminController.rejectRestaurant);
router.delete('/restaurants/:id', invRestaurant, adminController.deleteRestaurant);

// ----- Restaurant Commission -----
router.get('/restaurant-commissions/bootstrap', adminController.getRestaurantCommissionBootstrap);
router.get('/restaurant-commissions', adminController.getRestaurantCommissions);
router.post('/restaurant-commissions', adminController.createRestaurantCommission);
router.get('/restaurant-commissions/:id', adminController.getRestaurantCommissionById);
router.patch('/restaurant-commissions/:id', adminController.updateRestaurantCommission);
router.delete('/restaurant-commissions/:id', adminController.deleteRestaurantCommission);
router.patch('/restaurant-commissions/:id/toggle', adminController.toggleRestaurantCommissionStatus);

// ----- Categories -----
router.get('/categories', adminController.getCategories);
router.post('/categories', invCategory, adminController.createCategory);
router.patch('/categories/:id', invCategory, adminController.updateCategory);
router.delete('/categories/:id', invCategory, adminController.deleteCategory);
router.patch('/categories/:id/toggle', invCategory, adminController.toggleCategoryStatus);
router.patch('/categories/:id/approve', invCategory, adminController.approveCategory);
router.patch('/categories/:id/reject', invCategory, adminController.rejectCategory);
router.patch('/categories/:id/make-global', invCategory, adminController.makeCategoryGlobal);

// ----- Restaurant Add-ons Approval -----
router.get('/addons', addonsApprovalController.getRestaurantAddons);
router.patch('/addons/:id', invAddon, addonsApprovalController.updateRestaurantAddon);
router.patch('/addons/:id/approve', invAddon, addonsApprovalController.approveRestaurantAddon);
router.patch('/addons/:id/reject', invAddon, addonsApprovalController.rejectRestaurantAddon);

// ----- Foods -----
router.get('/foods', adminController.getFoods);
router.post('/foods', invFood, adminController.createFood);
router.patch('/foods/:id', invFood, adminController.updateFood);
router.delete('/foods/:id', invFood, adminController.deleteFood);
router.get('/foods/pending-approvals', foodApprovalController.getPendingFoodApprovals);
router.patch('/foods/:id/approve', invFood, foodApprovalController.approveFoodItemController);
router.patch('/foods/:id/reject', invFood, foodApprovalController.rejectFoodItemController);

// ----- Bulk Upload (Excel + images) -----
router.get('/foods/bulk-template', downloadFoodTemplateAdmin);
router.post('/foods/bulk-upload', invFood, bulkUpload.fields([{ name: 'file', maxCount: 1 }, { name: 'images', maxCount: 300 }]), bulkUploadFoodsAdmin);
router.get('/addons/bulk-template', downloadAddonTemplateAdmin);
router.post('/addons/bulk-upload', invAddon, bulkUpload.fields([{ name: 'file', maxCount: 1 }, { name: 'images', maxCount: 300 }]), bulkUploadAddonsAdmin);

// ----- Offers & Coupons -----
router.get('/offers', adminController.getAllOffers);
router.post('/offers', invOffer, adminController.createAdminOffer);
router.patch('/offers/:id', invOffer, adminController.updateAdminOffer);
router.patch('/offers/:id/approve', invOffer, adminController.approveAdminOffer);
router.patch('/offers/:id/reject', invOffer, adminController.rejectAdminOffer);
router.patch('/offers/:id/cart-visibility', invOffer, adminController.updateAdminOfferCartVisibility);
router.delete('/offers/:id', invOffer, adminController.deleteAdminOffer);
router.get('/offers/:id/analytics', invOffer, adminController.getAdminOfferAnalytics);
router.get('/offers/:id/history', invOffer, adminController.getAdminOfferUsageHistory);

// ----- Feedback Experience (Admin) -----
router.get('/feedback-experiences', feedbackExperienceController.getFeedbackExperiences);
router.delete('/feedback-experiences/:id', feedbackExperienceController.deleteFeedbackExperience);

// ----- Fee Settings -----
router.get('/fee-settings', adminController.getFeeSettings);
router.put('/fee-settings', adminController.createOrUpdateFeeSettings);

// ----- Delivery Boy Settings -----
router.get('/delivery-boy-settings', adminController.getDeliveryBoySettings);
router.put('/delivery-boy-settings', invDeliveryBoySettings, adminController.upsertDeliveryBoySettings);

// ----- Referral Settings -----
router.get('/referral-settings', adminController.getReferralSettings);
router.put('/referral-settings', adminController.createOrUpdateReferralSettings);

// ----- Business Settings -----
router.get('/business-settings/public', businessSettingsController.getBusinessSettings); // Public endpoint
router.get('/business-settings', businessSettingsController.getBusinessSettings);
router.patch('/business-settings', upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'favicon', maxCount: 1 }
]), businessSettingsController.updateBusinessSettings);

// ----- Delivery Emergency Help -----
router.get('/delivery-emergency-help', adminController.getEmergencyHelp);
router.put('/delivery-emergency-help', adminController.createOrUpdateEmergencyHelp);

// ----- Withdrawals (admin) -----
router.get('/withdrawals', adminController.getWithdrawals);
router.patch('/withdrawals/:id', adminController.updateWithdrawalStatus);
router.get('/delivery/withdrawals', adminController.getDeliveryWithdrawals);
router.patch('/delivery/withdrawals/:id', adminController.updateDeliveryWithdrawalStatus);

// ----- Delivery partners & general -----
router.get('/delivery/join-requests', adminController.getDeliveryJoinRequests);
router.get('/delivery/join-requests/:identityId', adminController.getDeliveryJoinRequestDetail);
router.get('/delivery/wallets', adminController.getDeliveryWallets);
router.get('/delivery/bonus-transactions', adminController.getDeliveryPartnerBonusTransactions);
router.get('/delivery/earnings', adminController.getDeliveryEarnings);
router.get('/delivery/salary-earnings', adminController.getDeliverySalaryEarnings);
router.get('/revenue', adminController.getAdminRevenue);
router.get('/revenue/:orderId', adminController.getAdminRevenueOrder);
router.get('/delivery/:id/salary-payments', adminController.getDeliverySalaryPayments);
router.post('/delivery/salary-payments', adminController.markDeliverySalaryPaid);
router.post('/delivery/bonus', adminController.addDeliveryPartnerBonus);
router.get('/delivery/commission-rules', adminController.getDeliveryCommissionRules);
router.post('/delivery/commission-rules', adminController.createDeliveryCommissionRule);
router.patch('/delivery/commission-rules/:id', adminController.updateDeliveryCommissionRule);
router.delete('/delivery/commission-rules/:id', adminController.deleteDeliveryCommissionRule);
router.patch('/delivery/commission-rules/:id/status', adminController.toggleDeliveryCommissionRuleStatus);
router.get('/peak-hour-rules', adminController.getPeakHourRules);
router.post('/peak-hour-rules', adminController.createPeakHourRule);
router.patch('/peak-hour-rules/:id', adminController.updatePeakHourRule);
router.delete('/peak-hour-rules/:id', adminController.deletePeakHourRule);
router.patch('/peak-hour-rules/:id/status', adminController.togglePeakHourRuleStatus);
router.get('/delivery/reviews', adminController.getDeliverymanReviews);
router.get('/contact-messages', adminController.getContactMessages);
router.get('/delivery/earning-addons', adminController.getEarningAddons);
router.post('/delivery/earning-addons', adminController.createEarningAddon);
router.patch('/delivery/earning-addons/:id', adminController.updateEarningAddon);
router.delete('/delivery/earning-addons/:id', adminController.deleteEarningAddon);
router.patch('/delivery/earning-addons/:id/status', adminController.toggleEarningAddonStatus);
router.get('/delivery/earning-addon-history', adminController.getEarningAddonHistory);
router.post('/delivery/earning-addon-history/:id/credit', adminController.creditEarningToWallet);
router.post('/delivery/earning-addon-history/:id/cancel', adminController.cancelEarningAddonHistory);
router.post('/delivery/earning-addon-completions/check', adminController.checkEarningAddonCompletions);
router.get('/delivery/support-tickets/stats', adminController.getSupportTicketStats);
router.get('/delivery/support-tickets', adminController.getSupportTickets);
router.patch('/delivery/support-tickets/:id', adminController.updateSupportTicket);
router.get('/delivery/partners', adminController.getDeliveryPartners);
router.get('/delivery/:id', adminController.getDeliveryPartnerById);
router.patch('/delivery/:id', adminController.updateDeliveryPartner);
router.delete('/delivery/:id', adminController.deleteDeliveryPartner);
router.patch('/delivery/:id/approve', adminController.approveDeliveryPartner);
router.patch('/delivery/:id/reject', adminController.rejectDeliveryPartner);
router.patch('/delivery/:id/approve-all', adminController.approveDeliveryPartnerAllServices);
router.patch('/delivery/:id/reject-all', adminController.rejectDeliveryPartnerAllServices);

// ----- Zones -----
router.get('/zones', adminController.getZones);
router.get('/zones/:id', adminController.getZoneById);
router.post('/zones', invZone, adminController.createZone);
router.patch('/zones/:id', invZone, adminController.updateZone);
router.delete('/zones/:id', invZone, adminController.deleteZone);

// ----- Offer banners -----
router.get('/offer-banners', adminController.getOfferBanners);
router.post('/offer-banners', adminController.createOfferBanner);
router.patch('/offer-banners/:id', adminController.updateOfferBanner);
router.delete('/offer-banners/:id', adminController.deleteOfferBanner);

// ----- Order rejection reasons -----
router.get('/order-rejection-reasons', adminController.getOrderRejectionReasons);
router.post('/order-rejection-reasons', adminController.createOrderRejectionReason);
router.patch('/order-rejection-reasons/:id', adminController.updateOrderRejectionReason);
router.delete('/order-rejection-reasons/:id', adminController.deleteOrderRejectionReason);

// ----- Dining -----
router.get('/dining/categories', diningAdminController.getDiningCategories);
router.post('/dining/categories', invDining, diningAdminController.createDiningCategory);
router.patch('/dining/categories/:id', invDining, diningAdminController.updateDiningCategory);
router.delete('/dining/categories/:id', invDining, diningAdminController.deleteDiningCategory);
router.get('/dining/restaurants', diningAdminController.getDiningRestaurants);
router.patch('/dining/restaurants/:restaurantId', invDining, diningAdminController.updateDiningRestaurant);
router.get('/dining/requests', diningAdminController.listAllDiningRequests);
router.patch('/dining/requests/:id/approve', invDining, diningAdminController.approveDiningRequest);
router.patch('/dining/requests/:id/reject', invDining, diningAdminController.rejectDiningRequest);
router.get('/dining/bookings', diningAdminController.listDiningBookings);
router.get('/dining/bookings/analytics', diningAdminController.getDiningBookingAnalytics);

// ----- Orders -----
router.get('/orders', orderController.listOrdersAdminController);
router.get('/orders/settlement-report', orderController.getMultiOrderSettlementReportController);
router.get('/orders/:orderId', orderController.getOrderByIdAdminController);
router.patch('/orders/:orderId/cancel', orderController.cancelOrderAdminController);
router.patch('/orders/:orderId/restaurants/:restaurantId/drop', orderController.dropRestaurantFromOrderAdminController);
router.patch('/orders/:orderId/assign-delivery', orderController.assignDeliveryPartnerController);
router.patch('/orders/:orderId/assign-second-delivery', orderController.assignSecondDeliveryPartnerController);
router.delete('/orders/:orderId', orderController.deleteOrderAdminController);

// ----- CMS Pages (About + legal) -----
router.get('/pages-social-media/:key', getAdminPageController);
router.put('/pages-social-media/:key', upsertAdminPageController);

router.get('/sidebar-badges', adminController.getSidebarBadges);
router.get('/notifications/fssai-expired', adminController.getExpiredFssaiNotifications);

export default router;
