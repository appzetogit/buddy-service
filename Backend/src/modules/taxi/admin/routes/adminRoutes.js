import { Router } from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import {
  loginRateLimit,
  otpSendRateLimit,
  otpVerifyRateLimit,
} from '../../middlewares/rateLimitMiddleware.js';
import {
  createAirport,
  createAdminAccount,
  getAdminActivitySummary,
  createAppModule,
  createGoodsType,
  createDriver,
  createDriverNeededDocument,
  bulkImportDrivers,
  createOnboardingScreen,
  createPreference,
  createRole,
  createPaymentMethod,
  createServiceLocation,
  createSetPrice,
  createUser,
  createZone,
  bulkImportUsers,
  approveUserDeletionRequest,
  approveDriverDeletionRequest,
  deleteAppModule,
  deleteDriver,
  deleteDriverNeededDocument,
  deleteGoodsType,
  deleteOnboardingScreen,
  deleteLanguage,
  deleteOngoingRide,
  cancelRideRequest,
  deleteRideRequest,
  deletePreference,
  deleteRole,
  deletePaymentMethod,
  deleteSetPrice,
  deleteServiceLocation,
  deleteUser,
  deleteZone,
  downloadDriverDutyReport,
  downloadDriverReport,
  downloadFinanceReport,
  downloadUserReport,
  forgotPassword,
  getAdminStatus,
  getAdminEarnings,
  getAdminEarningDetails,
  getAirports,
  getPriceHikes,
  getAutomaticSurge,
  updateAutomaticSurge,
  resetVehicleAutomaticSurge,
  createPriceHike,
  updatePriceHike,
  deletePriceHike,
  getAppModules,
  getCancelChart,
  getCountries,
  getDashboardData,
  getDeliveries,
  getDriver,
  getDriverNeededDocument,
  getDriverNeededDocuments,
  getDriverProfile,
  getDriverOnboarding,
  getDrivers,
  getDriverRatings,
  getDriverRatingDetail,
  getNegativeBalanceDrivers,
  getDriverWithdrawalSummaries,
  getDriverWithdrawals,
  getDriverWithdrawalContextByRequestId,
  approveDriverWithdrawalRequest,
  rejectDriverWithdrawalRequest,
  getDeletedDrivers,
  getDriverDeletionRequests,
  getGoodsTypes,
  getIntercityTrips,
  getGeneralSettingsCategory,
  getLanguages,
  getNearbyServiceLocations,
  getOngoingRides,
  getOverallEarnings,
  getPaymentMethods,
  getPreferences,
  getRideModules,
  getRoles,
  getSetPriceById,
  getSetPrices,
  getServiceLocations,
  getTodayEarnings,
  getUserOnboarding,
  getUser,
  getUsers,
  getDeletedUsers,
  getUserDeletionRequests,
  restoreDeletedUser,
  permanentlyDeleteDeletedUser,
  restoreDeletedDriver,
  permanentlyDeleteDeletedDriver,
  getAdminLandingContent,
  getWebsiteEnquiries,
  patchWebsiteEnquiry,
  saveAdminLandingContent,
  getRideRequests,
  getPayments,
  getPaymentInvoice,
  rejectUserDeletionRequest,
  rejectDriverDeletionRequest,
  getUserRequests,
  getUserWalletHistory,
  getVehiclePreferenceOptions,
  getVehicleTypeCatalog,
  getVehicleTypeById,
  getVehicleTypes,
  getWithdrawals,
  getZones,
  loginAdmin,
  resetPassword,
  verifyResetOtp,
  toggleZoneStatus,
  adjustUserWallet,
  listDriverWalletHistory,
  adjustDriverWallet,
  updateAppModule,
  updateAirport,
  updateAdminAccount,
  updateDriver,
  updateDriverNeededDocument,
  updateDriverPassword,
  updateOnboardingScreen,
  updateGoodsType,
  updateGeneralSettingsCategory,
  updateLanguageStatus,
  updatePaymentMethod,
  updatePreferenceStatus,
  updateSetPrice,
  updateServiceLocation,
  updateUser,
  updateVehicleType,
  updateZone,
  createVehicleType,
  deleteAirport,
  deleteAdminAccount,
  deleteVehicleType,
  getAdminPermissions,
  getAdmins,
  getTransportTypes,
} from '../controllers/adminController.js';
import {
  createCancellationReason,
  deleteCancellationReason,
  listCancellationReasons,
  updateCancellationReason,
} from '../controllers/cancellationReasonController.js';
import { promotionsRouter } from '../promotions/routes/index.js';
import { listSafetyAlerts, resolveSafetyAlert } from '../../safety/controllers/safetyController.js';

export const adminRouter = Router();

// Sign-in, password reset and OTP are the platform admin login (core/auth); taxi has none of its own.
adminRouter.get('/admin', getAdminStatus);
adminRouter.get('/admin/status', getAdminStatus);

// Public route for app branding/settings
adminRouter.get('/admin/general-settings/:category', getGeneralSettingsCategory);

adminRouter.use('/admin', authenticate(['admin']));

adminRouter.get('/admin/permissions', getAdminPermissions);
adminRouter.get('/admin/admin-management/admins', getAdmins);
adminRouter.get('/admin/admin-management/activity-summary', getAdminActivitySummary);
adminRouter.post('/admin/admin-management/admins', createAdminAccount);
adminRouter.patch('/admin/admin-management/admins/:id', updateAdminAccount);
adminRouter.delete('/admin/admin-management/admins/:id', deleteAdminAccount);

adminRouter.get('/admin/users', getUsers);
adminRouter.post('/admin/users/bulk-import', bulkImportUsers);
adminRouter.post('/admin/users', createUser);
adminRouter.get('/admin/users/deleted', getDeletedUsers);
adminRouter.patch('/admin/users/deleted/:id/restore', restoreDeletedUser);
adminRouter.delete('/admin/users/deleted/:id', permanentlyDeleteDeletedUser);
adminRouter.get('/admin/users/delete-requests', getUserDeletionRequests);
adminRouter.patch('/admin/users/delete-requests/:id/approve', approveUserDeletionRequest);
adminRouter.patch('/admin/users/delete-requests/:id/reject', rejectUserDeletionRequest);
adminRouter.get('/admin/users/:id', getUser);
adminRouter.patch('/admin/users/:id', updateUser);
adminRouter.delete('/admin/users/:id', deleteUser);
adminRouter.get('/admin/users/:id/requests', getUserRequests);
adminRouter.get('/admin/users/:id/wallet-history', getUserWalletHistory);

adminRouter.get('/admin/drivers', getDrivers);
adminRouter.post('/admin/drivers/bulk-import', bulkImportDrivers);
adminRouter.get('/admin/drivers/deleted', authenticate(['admin']), getDeletedDrivers);
adminRouter.get('/admin/drivers/delete-requests', authenticate(['admin']), getDriverDeletionRequests);
adminRouter.patch('/admin/drivers/delete-requests/:id/approve', authenticate(['admin']), approveDriverDeletionRequest);
adminRouter.patch('/admin/drivers/delete-requests/:id/reject', authenticate(['admin']), rejectDriverDeletionRequest);
adminRouter.patch('/admin/drivers/deleted/:id/restore', authenticate(['admin']), restoreDeletedDriver);
adminRouter.delete('/admin/drivers/deleted/:id', authenticate(['admin']), permanentlyDeleteDeletedDriver);
adminRouter.post('/admin/drivers', createDriver);
adminRouter.get('/admin/drivers/:id/profile', getDriverProfile);
adminRouter.get('/admin/drivers/:id', getDriver);
adminRouter.patch('/admin/drivers/:id', updateDriver);
adminRouter.patch('/admin/drivers/update-password/:id', updateDriverPassword);
adminRouter.delete('/admin/drivers/:id', deleteDriver);
adminRouter.post('/admin/wallet/users/:id/adjust', adjustUserWallet);
adminRouter.get('/admin/wallet/users/:id/history', getUserWalletHistory);

adminRouter.post('/admin/wallet/drivers/:id/adjust', adjustDriverWallet);
adminRouter.get('/admin/wallet/drivers/:id/history', listDriverWalletHistory);

adminRouter.get('/admin/wallet/drivers/negative-balance', authenticate(['admin']), getNegativeBalanceDrivers);
adminRouter.get('/admin/wallet/drivers/withdrawals', authenticate(['admin']), getDriverWithdrawalSummaries);
adminRouter.get('/admin/wallet/drivers/withdrawals/request/:requestId', authenticate(['admin']), getDriverWithdrawalContextByRequestId);
adminRouter.get('/admin/wallet/drivers/:id/withdrawals', authenticate(['admin']), getDriverWithdrawals);
adminRouter.patch('/admin/wallet/drivers/withdrawals/:requestId/approve', authenticate(['admin']), approveDriverWithdrawalRequest);
adminRouter.patch('/admin/wallet/drivers/withdrawals/:requestId/reject', authenticate(['admin']), rejectDriverWithdrawalRequest);
adminRouter.get('/admin/driver-ratings', authenticate(['admin']), getDriverRatings);
adminRouter.get('/admin/driver-ratings/:id', authenticate(['admin']), getDriverRatingDetail);


adminRouter.get('/countries', getCountries);
adminRouter.get('/admin/countries', getCountries);
adminRouter.get('/admin/service-locations', getServiceLocations);
adminRouter.get('/admin/service-locations/nearby', getNearbyServiceLocations);
adminRouter.post('/admin/service-locations', createServiceLocation);
adminRouter.patch('/admin/service-locations/:id', updateServiceLocation);
adminRouter.delete('/admin/service-locations/:id', deleteServiceLocation);
adminRouter.get('/common/ride_modules', getRideModules);
adminRouter.get('/admin/types/vehicle-types/list', getVehicleTypes);
adminRouter.get('/admin/types/vehicle-types', getVehicleTypeCatalog);
adminRouter.get('/admin/types/vehicle-types/:id', getVehicleTypeById);
adminRouter.post('/admin/types/vehicle-types', createVehicleType);
adminRouter.patch('/admin/types/vehicle-types/:id', updateVehicleType);
adminRouter.delete('/admin/types/vehicle-types/:id', deleteVehicleType);
adminRouter.get('/admin/types/set-prices', getSetPrices);
adminRouter.get('/admin/types/set-prices/:id', getSetPriceById);
adminRouter.post('/admin/types/set-prices', createSetPrice);
adminRouter.patch('/admin/types/set-prices/:id', updateSetPrice);
adminRouter.delete('/admin/types/set-prices/:id', deleteSetPrice);
adminRouter.get('/admin/airports', getAirports);
adminRouter.post('/admin/airports', createAirport);
adminRouter.patch('/admin/airports/:id', updateAirport);
adminRouter.delete('/admin/airports/:id', deleteAirport);
adminRouter.get('/admin/goods-types', getGoodsTypes);
adminRouter.post('/admin/goods-types', createGoodsType);
adminRouter.patch('/admin/goods-types/:id', updateGoodsType);
adminRouter.delete('/admin/goods-types/:id', deleteGoodsType);
adminRouter.get('/admin/types/transport-types', getTransportTypes);
adminRouter.get('/admin/vehicle_preference', getVehiclePreferenceOptions);

adminRouter.get('/admin/driver-management/driver-needed-document', getDriverNeededDocuments);
adminRouter.get('/admin/driver-management/driver-needed-document/:id', getDriverNeededDocument);
adminRouter.post('/admin/driver-management/driver-needed-document', createDriverNeededDocument);
adminRouter.patch('/admin/driver-management/driver-needed-document/:id', updateDriverNeededDocument);
adminRouter.delete('/admin/driver-management/driver-needed-document/:id', deleteDriverNeededDocument);

adminRouter.get('/admin/dashboard/data', getDashboardData);

adminRouter.get('/admin/dashboard/admin-earnings', getAdminEarnings);
adminRouter.get('/admin/dashboard/admin-earnings/details', getAdminEarningDetails);
adminRouter.get('/admin/dashboard/overall-earnings', getOverallEarnings);
adminRouter.get('/admin/dashboard/today-earnings', getTodayEarnings);
adminRouter.get('/admin/dashboard/cancel-chart', getCancelChart);
adminRouter.get('/admin/safety/alerts', authenticate(['admin']), listSafetyAlerts);
adminRouter.patch('/admin/safety/alerts/:id/resolve', authenticate(['admin']), resolveSafetyAlert);
adminRouter.get('/admin/ongoing-rides', getOngoingRides);
adminRouter.get('/admin/ride-requests', getRideRequests);
// One ledger of every payment, and an invoice PDF for each.
adminRouter.get('/admin/payments', getPayments);
adminRouter.get('/admin/payments/:kind/:id/invoice', getPaymentInvoice);
adminRouter.post('/admin/ride-requests/:id/cancel', cancelRideRequest);
adminRouter.delete('/admin/ride-requests/:id', deleteRideRequest);
adminRouter.get('/admin/enquiries', getWebsiteEnquiries);
adminRouter.patch('/admin/enquiries/:id', patchWebsiteEnquiry);
adminRouter.get('/admin/landing-content', getAdminLandingContent);
adminRouter.put('/admin/landing-content', saveAdminLandingContent);
adminRouter.delete('/admin/ongoing-rides/:id', deleteOngoingRide);
adminRouter.get('/admin/deliveries', getDeliveries);
adminRouter.get('/admin/trips', getIntercityTrips);

adminRouter.get('/admin/wallet/withdrawals', getWithdrawals);

adminRouter.get('/admin/zones', getZones);
adminRouter.post('/admin/zones', createZone);
adminRouter.patch('/admin/zones/:id', updateZone);
adminRouter.delete('/admin/zones/:id', deleteZone);
adminRouter.patch('/admin/zones/:id/toggle-status', toggleZoneStatus);

adminRouter.get('/admin/languages', getLanguages);
adminRouter.patch('/admin/languages/:id/status', updateLanguageStatus);
adminRouter.delete('/admin/languages/:id', deleteLanguage);

adminRouter.get('/admin/preferences', getPreferences);
adminRouter.post('/admin/preferences', createPreference);
adminRouter.patch('/admin/preferences/:id/status', updatePreferenceStatus);
adminRouter.delete('/admin/preferences/:id', deletePreference);

adminRouter.get('/admin/roles', getRoles);
adminRouter.post('/admin/roles', createRole);
adminRouter.delete('/admin/roles/:id', deleteRole);

adminRouter.get('/admin/common/app-modules', getAppModules);
adminRouter.post('/admin/common/app-modules', createAppModule);
adminRouter.patch('/admin/common/app-modules/:id', updateAppModule);
adminRouter.delete('/admin/common/app-modules/:id', deleteAppModule);



adminRouter.get('/admin/payment-methods', authenticate(['admin']), getPaymentMethods);
adminRouter.post('/admin/payment-methods', authenticate(['admin']), createPaymentMethod);
adminRouter.patch('/admin/payment-methods/:id', authenticate(['admin']), updatePaymentMethod);
adminRouter.delete('/admin/payment-methods/:id', authenticate(['admin']), deletePaymentMethod);


adminRouter.get('/admin/general-settings/:category', getGeneralSettingsCategory);
adminRouter.patch('/admin/general-settings/:category', updateGeneralSettingsCategory);

adminRouter.get('/admin/cancellation-reasons', listCancellationReasons);
adminRouter.post('/admin/cancellation-reasons', createCancellationReason);
adminRouter.patch('/admin/cancellation-reasons/:id', updateCancellationReason);
adminRouter.delete('/admin/cancellation-reasons/:id', deleteCancellationReason);

adminRouter.get('/on-boarding', getUserOnboarding);
adminRouter.post('/on-boarding', createOnboardingScreen);
adminRouter.patch('/on-boarding/:id', updateOnboardingScreen);
adminRouter.delete('/on-boarding/:id', deleteOnboardingScreen);
adminRouter.get('/on-boarding-driver', getDriverOnboarding);

adminRouter.get('/admin/reports/user/download', downloadUserReport);
adminRouter.get('/admin/reports/driver/download', downloadDriverReport);
adminRouter.get('/admin/reports/driver-duty/download', downloadDriverDutyReport);
adminRouter.get('/admin/reports/finance/download', downloadFinanceReport);

adminRouter.use('/', promotionsRouter);

// Price hike (surge). Sits under the authenticate(['admin']) mount above.
adminRouter.get('/admin/price-hikes', getPriceHikes);
adminRouter.get('/admin/surge', getAutomaticSurge);
adminRouter.patch('/admin/surge', updateAutomaticSurge);
adminRouter.delete('/admin/surge/vehicles/:vehicleTypeId', resetVehicleAutomaticSurge);
adminRouter.post('/admin/price-hikes', createPriceHike);
adminRouter.patch('/admin/price-hikes/:id', updatePriceHike);
adminRouter.delete('/admin/price-hikes/:id', deletePriceHike);
