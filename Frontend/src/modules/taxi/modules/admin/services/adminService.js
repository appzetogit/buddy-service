import api from '../../../shared/api/axiosInstance';
import platformClient from '@food/api/axios';

export const adminService = {
  /**
   * Admin Authentication
   */
  login: (credentials) => api.post('/admin/login', credentials),
  forgotPassword: (email) => api.post('/admin/forgot-password', { email }),
  verifyResetOtp: (data) => api.post('/admin/verify-reset-otp', data),
  resetPassword: (data) => api.post('/admin/reset-password', data),
  getAdmins: () => api.get('/admin/admin-management/admins'),
  getAdminActivitySummary: () => api.get('/admin/admin-management/activity-summary'),
  createAdminAccount: (data) => api.post('/admin/admin-management/admins', data),
  updateAdminAccount: (id, data) => api.patch(`/admin/admin-management/admins/${id}`, data),
  deleteAdminAccount: (id) => api.delete(`/admin/admin-management/admins/${id}`),
  getAdminPermissions: () => api.get('/admin/permissions'),

  /**
   * User Management
   */
  getUsers: (page = 1, limit = 50, search = '', filters = {}) => {
    const params = new URLSearchParams({ page, limit });
    if (String(search || '').trim()) {
      params.set('search', String(search).trim());
    }
    return api.get(`/admin/users?${params.toString()}`);
  },
  
  getUser: (id) => api.get(`/admin/users/${id}`),
  getUserRequests: (id) => api.get(`/admin/users/${id}/requests`),
  getUserWalletHistory: (id) => api.get(`/admin/users/${id}/wallet-history`),
  updateUser: (id, userData) => api.patch(`/admin/users/${id}`, userData),

  deleteUser: (id) => api.delete(`/admin/users/${id}`),

  /**
   * Driver Management
   */
  getDrivers: (page = 1, limit = 50, filters = {}) => {
    const params = new URLSearchParams({ page, limit, ...filters }).toString();
    return api.get(`/admin/drivers?${params}`);
  },

  bulkImportDrivers: (payload) => api.post('/admin/drivers/bulk-import', payload),
  getDriver: (id) => api.get(`/admin/drivers/${id}`),
  updateDriverStatus: (id, data) => api.patch(`/admin/drivers/${id}`, data),
  /**
   * Approve a driver's full onboarding application (Food + Quick Commerce + Taxi, whichever
   * they selected) through the unified driver-onboarding approval system, instead of flipping
   * this shared driver record's status directly — that bypass left this screen's "approved"
   * state out of sync with the per-service approvals shown on the Food admin join-requests page.
   */
  approveDriverOnboarding: (id) => platformClient.patch(`/food/admin/delivery/${id}/approve-all`),
  updateDriverPassword: (id, password) => api.patch(`/admin/drivers/update-password/${id}`, { password }),
  deleteDriver: (id) => api.delete(`/admin/drivers/${id}`),
  getDriverDeleteRequests: () => api.get('/admin/drivers/delete-requests'),
  approveDriverDeleteRequest: (id) => api.patch(`/admin/drivers/delete-requests/${id}/approve`),
  rejectDriverDeleteRequest: (id, adminNote = '') => api.patch(`/admin/drivers/delete-requests/${id}/reject`, { adminNote }),
  getDriverNeededDocuments: (templateType = 'document') =>
    api.get(`/admin/driver-management/driver-needed-document?template_type=${encodeURIComponent(templateType)}`),
  getDriverNeededDocument: (id) => api.get(`/admin/driver-management/driver-needed-document/${id}`),
  createDriverNeededDocument: (data) => api.post('/admin/driver-management/driver-needed-document', data),
  updateDriverNeededDocument: (id, data) => api.patch(`/admin/driver-management/driver-needed-document/${id}`, data),
  deleteDriverNeededDocument: (id) => api.delete(`/admin/driver-management/driver-needed-document/${id}`),
  // Wallet Payment APIs
  searchUsers: (query) => api.get(`/admin/users?search=${encodeURIComponent(query)}`),
  searchDrivers: (query) => api.get(`/admin/drivers?search=${query}`),

  adjustUserWallet: (id, data) => api.post(`/admin/wallet/users/${id}/adjust`, data),
  getUserWalletHistory: (id) => api.get(`/admin/wallet/users/${id}/history`),

  adjustDriverWallet: (id, data) => api.post(`/admin/wallet/drivers/${id}/adjust`, data),
  getDriverWalletHistory: (id) => api.get(`/admin/wallet/drivers/${id}/history`),
  getDriverWithdrawalSummaries: (params = {}) => api.get('/admin/wallet/drivers/withdrawals', { params }),
  getDriverWithdrawals: (driverId, params = {}) => api.get(`/admin/wallet/drivers/${driverId}/withdrawals`, { params }),
  getDriverWithdrawalContextByRequestId: (requestId, params = {}) =>
    api.get(`/admin/wallet/drivers/withdrawals/request/${requestId}`, { params }),
  approveDriverWithdrawalRequest: (requestId) => api.patch(`/admin/wallet/drivers/withdrawals/${requestId}/approve`),
  rejectDriverWithdrawalRequest: (requestId) => api.patch(`/admin/wallet/drivers/withdrawals/${requestId}/reject`),



  
  /**
   * Common / Configuration Data
   */
  getServiceLocations: () => api.get('/admin/service-locations'),
  createServiceLocation: (data) => api.post('/admin/service-locations', data),
  updateServiceLocation: (id, data) => api.patch(`/admin/service-locations/${id}`, data),
  deleteServiceLocation: (id) => api.delete(`/admin/service-locations/${id}`),
  getServiceStores: () => api.get('/admin/service-stores'),
  getPendingServiceStores: () => api.get('/admin/service-stores/pending'),
  approvePendingServiceStore: (id) => api.patch(`/admin/service-stores/${id}/approve`),
  rejectPendingServiceStore: (id, rejectionReason = '') =>
    api.patch(`/admin/service-stores/${id}/reject`, { rejectionReason }),
  createServiceStore: (data) => api.post('/admin/service-stores', data),
  updateServiceStore: (id, data) => api.patch(`/admin/service-stores/${id}`, data),
  createServiceStoreStaff: (id, data) => api.post(`/admin/service-stores/${id}/staff`, data),
  getPendingServiceStoreStaff: () => api.get('/admin/service-stores/pending-staff'),
  approvePendingServiceStoreStaff: (id) => api.patch(`/admin/service-stores/staff/${id}/approve`),
  rejectPendingServiceStoreStaff: (id, rejectionReason = '') =>
    api.patch(`/admin/service-stores/staff/${id}/reject`, { rejectionReason }),
  deleteServiceStore: (id) => api.delete(`/admin/service-stores/${id}`),
  getCountries: () => api.get('/countries'),
  getVehicleTypes: (transportType) => api.get(`/admin/types/vehicle-types/list${transportType ? `?transport_type=${transportType}` : ''}`),
  getVehicleTypeById: (id) => api.get(`/admin/types/vehicle-types/${id}`),
  getRideModules: () => api.get('/common/ride_modules'),
  getLocationVehicleTypes: (locationId, transportType) => api.get(`/types/${locationId}?transport_type=${transportType}`),


  /**
   * Reports Management
   * PRO-TIP: We use window.open for downloads to handle the stream directly or axios with responseType: 'blob'
   */
  downloadUserReport: (params) => {
    const query = new URLSearchParams(params).toString();
    return api.get(`/admin/reports/user/download?${query}`, { responseType: 'blob' });
  },
  downloadDriverReport: (params) => {
    const query = new URLSearchParams(params).toString();
    return api.get(`/admin/reports/driver/download?${query}`, { responseType: 'blob' });
  },
  downloadDriverDutyReport: (params) => {
    const query = new URLSearchParams(params).toString();
    return api.get(`/admin/reports/driver-duty/download?${query}`, { responseType: 'blob' });
  },
  downloadFinanceReport: (params) => {
    const query = new URLSearchParams(params).toString();
    return api.get(`/admin/reports/finance/download?${query}`, { responseType: 'blob' });
  },
  getReportOptions: () => api.get('/admin/reports/options'),

  /**
   * Dashboard Stats & Data (New Parity Routes)
   */
  getDashboardPage: () => api.get('/admin/dashboard/page'),
  getDashboardData: () => api.get('/admin/dashboard/data'),
  getAdminEarnings: (params = {}) => api.get('/admin/dashboard/admin-earnings', { params }),
  getTodayEarnings: () => api.get('/admin/dashboard/today-earnings'),
  getOverallEarnings: () => api.get('/admin/dashboard/overall-earnings'),
  getCancelChart: () => api.get('/admin/dashboard/cancel-chart'),
  cancelRideRequest: (id, reason = '') => api.post(`/admin/ride-requests/${id}/cancel`, { reason }),
  deleteRideRequest: (id) => api.delete(`/admin/ride-requests/${id}`),
  getSafetyAlerts: ({ page = 1, limit = 25, status = 'active' } = {}) =>
    api.get(`/admin/safety/alerts?page=${page}&limit=${limit}&status=${encodeURIComponent(status)}`),
  resolveSafetyAlert: (id, note = '') => api.patch(`/admin/safety/alerts/${id}/resolve`, { note }),
  getOngoingRides: ({ page = 1, limit = 10, tab = 'all', search = '' } = {}) =>
    api.get(`/admin/ongoing-rides?page=${page}&limit=${limit}&tab=${encodeURIComponent(tab)}&search=${encodeURIComponent(search)}`),
  getRideRequests: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([_, v]) => v !== undefined && v !== null && v !== '')
    ).toString();
    return api.get(`/admin/ride-requests${qs ? `?${qs}` : ''}`);
  },
  listRideRequests: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([_, v]) => v !== undefined && v !== null && v !== '')
    ).toString();
    return api.get(`/admin/ride-requests${qs ? `?${qs}` : ''}`);
  },
  getDeliveries: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([_, v]) => v !== undefined && v !== null && v !== '')
    ).toString();
    return api.get(`/admin/deliveries${qs ? `?${qs}` : ''}`);
  },
  getTrips: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([_, v]) => v !== undefined && v !== null && v !== '')
    ).toString();
    return api.get(`/admin/trips${qs ? `?${qs}` : ''}`);
  },
  deleteOngoingRide: (id) => api.delete(`/admin/ongoing-rides/${id}`),

  /**
   * Wallet & Financials
   */
  getUserWallets: () => api.get('/admin/wallet/users'),
  getDriverWallets: () => api.get('/admin/wallet/drivers'),
  getWithdrawalRequests: () => api.get('/admin/wallet/withdrawals'),
  getWithdrawals: () => api.get('/admin/wallet/withdrawals'),
  updateWithdrawalStatus: (id, status) => api.patch(`/admin/wallet/withdrawals/${id}`, { status }),

  /**
   * Notifications & Banners
   */
  getPromotionsBootstrap: () => api.get('/admin/promotions/bootstrap'),
  getNotifications: () => api.get('/admin/notifications'),
  sendNotification: (data) => api.post('/admin/notifications/send', data),
  deleteNotification: (id) => api.delete(`/admin/notifications/${id}`),
  getBanners: () => api.get('/admin/banners'),

  /**
   * Geofencing & Zone Management
   */
  getZones: () => api.get('/admin/zones'),
  createZone: (zoneData) => api.post('/admin/zones', zoneData),
  updateZone: (id, zoneData) => api.patch(`/admin/zones/${id}`, zoneData),
  deleteZone: (id) => api.delete(`/admin/zones/${id}`),
  toggleZoneStatus: (id) => api.patch(`/admin/zones/${id}/toggle-status`),
  getAirports: () => api.get('/admin/airports'),
  createAirport: (airportData) => api.post('/admin/airports', airportData),
  updateAirport: (id, airportData) => api.patch(`/admin/airports/${id}`, airportData),
  deleteAirport: (id) => api.delete(`/admin/airports/${id}`),
  getRentalPackageTypes: () => api.get('/admin/types/rental-packages'),
  createRentalPackageType: (data) => api.post('/admin/types/rental-packages', data),
  updateRentalPackageType: (id, data) => api.patch(`/admin/types/rental-packages/${id}`, data),
  deleteRentalPackageType: (id) => api.delete(`/admin/types/rental-packages/${id}`),
  getSetPrices: (params = {}) => api.get('/admin/types/set-prices', { params }),
  getSetPriceById: (id) => api.get(`/admin/types/set-prices/${id}`),
  createSetPrice: (data) => api.post('/admin/types/set-prices', data),
  updateSetPrice: (id, data) => api.patch(`/admin/types/set-prices/${id}`, data),
  deleteSetPrice: (id) => api.delete(`/admin/types/set-prices/${id}`),
  getRentalVehicleTypes: () => api.get('/admin/types/rental-vehicles'),
  createRentalVehicleType: (data) => api.post('/admin/types/rental-vehicles', data),
  updateRentalVehicleType: (id, data) => api.patch(`/admin/types/rental-vehicles/${id}`, data),
  deleteRentalVehicleType: (id) => api.delete(`/admin/types/rental-vehicles/${id}`),
  getRentalBookingRequests: () => api.get('/admin/rental-booking-requests'),
  getRentalTrackingDashboard: () => api.get('/admin/rental-tracking'),
  updateRentalBookingRequest: (id, data) => api.patch(`/admin/rental-booking-requests/${id}`, data),
  getRentalQuoteRequests: () => api.get('/admin/rental-quote-requests'),
  updateRentalQuoteRequest: (id, data) => api.patch(`/admin/rental-quote-requests/${id}`, data),




  uploadImage: (image) => api.post('/admin/upload-image', { image }),

  /**
   * Public marketing site content (CMS).
   * PUT accepts a partial - only the sections present are written.
   */
  getWebsiteEnquiries: (params) => api.get('/admin/enquiries', { params }),
  updateWebsiteEnquiry: (id, payload) => api.patch(`/admin/enquiries/${id}`, payload),

  getLandingContent: () => api.get('/admin/landing-content'),
  updateLandingContent: (payload) => api.put('/admin/landing-content', payload),

  /**
   * Languages Management (Master)
   */
  getLanguages: (params) => api.get('/admin/languages', { params }),
  createLanguage: (data) => api.post('/admin/languages', data),
  getLanguage: (id) => api.get(`/admin/languages/${id}`),
  updateLanguage: (id, data) => api.patch(`/admin/languages/${id}`, data),
  updateLanguageStatus: (id, data) => api.patch(`/admin/languages/${id}/status`, data),
  deleteLanguage: (id) => api.delete(`/admin/languages/${id}`),

  /**
   * Preferences Management (Master)
   */
  getPreferences: (params) => api.get('/admin/preferences', { params: params }),
  createPreference: (data) => api.post('/admin/preferences', data),
  getPreference: (id) => api.get(`/admin/preferences/${id}`),
  updatePreference: (id, formData) => api.patch(`/admin/preferences/${id}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  updatePreferenceStatus: (id, data) => api.patch(`/admin/preferences/${id}/status`, data),
  deletePreference: (id) => api.delete(`/admin/preferences/${id}`),

  /**
   * Roles & Permissions Management
   */
  getRoles: (params) => api.get('/admin/roles', { params }),
  createRole: (roleData) => api.post('/admin/roles', roleData),
  getRole: (id) => api.get(`/admin/roles/${id}`),
  updateRole: (id, roleData) => api.patch(`/admin/roles/${id}`, roleData),
  deleteRole: (id) => api.delete(`/admin/roles/${id}`),
  getRolePermissions: (id) => api.get(`/admin/roles/${id}/permissions`),
  updateRolePermissions: (id, data) => api.put(`/roles/${id}/permissions`, data),

  getPermissions: (params) => api.get('/admin/permissions', { params }),
  createPermission: (data) => api.post('/admin/permissions', data),
  getPermission: (id) => api.get(`/admin/permissions/${id}`),
  updatePermission: (id, data) => api.patch(`/admin/permissions/${id}`, data),
  deletePermission: (id) => api.delete(`/admin/permissions/${id}`),

  /**
   * App Modules Management
   */
  getAppModules: (params) => api.get('/admin/common/app-modules', { params }),
  createAppModule: (data) => api.post('/admin/common/app-modules', data),
  updateAppModule: (id, data) => api.patch(`/admin/common/app-modules/${id}`, data),
  deleteAppModule: (id) => api.delete(`/admin/common/app-modules/${id}`),

  /**
   * Onboarding Screens Management
   */
  getOnboardingScreens: (role = 'user') => {
    const path = role === 'user' ? '/on-boarding' : `/on-boarding-${role}`;
    return api.get(path);
  },
  createOnboardingScreen: (payload) => api.post('/on-boarding', payload),
  updateOnboardingScreen: (id, payload) => api.patch(`/on-boarding/${id}`, payload),
  deleteOnboardingScreen: (id) => api.delete(`/on-boarding/${id}`),
};
