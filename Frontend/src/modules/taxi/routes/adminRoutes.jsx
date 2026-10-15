import { FileText } from 'lucide-react';
import { Navigate, Route, Routes, useLocation, useNavigate } from '../shared/router';
import TaxiAdminFrame from '../modules/admin/TaxiAdminFrame';
import {
  AdminAdminCreate,
  AdminAdmins,
  AdminAirportManagement,
  AdminAppModules,
  AdminBannerImage,
  AdminBidRideSettings,
  AdminChat,
  AdminCountryManagement,
  AdminCreatePackagePrice,
  AdminCustomizationSettings,
  AdminDashboard,
  AdminDeleteRequestUsers,
  AdminDeliveries,
  AdminDispatcherAddons,
  AdminDriverAudit,
  AdminDriverBulkUpload,
  AdminDriverCreate,
  AdminDriverDeleteRequests,
  AdminDriverDetails,
  AdminDriverDocumentForm,
  AdminDriverDutyReport,
  AdminDriverEdit,
  AdminDriverImportCreate,
  AdminDriverIncentive,
  AdminDriverList,
  AdminDriverRatingDetail,
  AdminDriverRatings,
  AdminDriverReferralSettings,
  AdminDriverReport,
  AdminDriverSubscriptionAnalytics,
  AdminDriverSubscriptionCreate,
  AdminDriverSubscriptionSettings,
  AdminDriverSubscriptions,
  AdminDriverWallet,
  AdminEarnings,
  AdminEarningsDetail,
  AdminEmployeeCreate,
  AdminEmployeeDetails,
  AdminEmployeeList,
  AdminFinance,
  AdminFinanceReport,
  AdminFirebaseSettings,
  AdminGeneralSettings,
  AdminGeoFencing,
  AdminGlobalDocuments,
  AdminGodsEye,
  AdminGoodsTypes,
  AdminHeatMap,
  AdminLanguages,
  AdminMailSettings,
  AdminMapSettings,
  AdminNegativeBalanceDrivers,
  AdminNotificationChannels,
  AdminOnboardingScreens,
  AdminOngoing,
  AdminPaymentGateways,
  AdminPaymentMethods,
  AdminPayments,
  AdminPendingDrivers,
  AdminPreferences,
  AdminPriceHike,
  AdminPromoCodes,
  AdminRechargeApiSettings,
  AdminReferralDashboard,
  AdminReferralTranslation,
  AdminRideVoiceSettings,
  AdminSMSGateways,
  AdminSafetyCenter,
  AdminSendNotification,
  AdminServiceLocation,
  AdminSetPackagePrices,
  AdminSetPrices,
  AdminSupportTicketTitle,
  AdminSupportTickets,
  AdminSurgePricing,
  AdminTipSettings,
  AdminTransportRideSettings,
  AdminTrips,
  AdminUserAppManagement,
  AdminUserBulkUpload,
  AdminUserCreate,
  AdminUserDetails,
  AdminUserImportCreate,
  AdminUserList,
  AdminUserReferralSettings,
  AdminUserReport,
  AdminUserSubscriptionCreate,
  AdminUserSubscriptions,
  AdminVehicleType,
  AdminWalletPayment,
  AdminWalletSettings,
  AdminWithdrawalRequestDetail,
  AdminWithdrawalRequestDrivers,
  AdminZoneManagement,
} from './lazyPages';

const AdminReportPlaceholder = ({ title }) => (
  <div className="flex flex-col items-center justify-center min-h-[500px] text-gray-400 bg-white rounded-[32px] border border-gray-100 shadow-sm p-10 mx-6">
    <FileText size={60} strokeWidth={1} className="mb-6 opacity-20" />
    <h2 className="text-xl font-black text-gray-900 uppercase tracking-widest">{title}</h2>
    <p className="mt-2 font-bold italic tracking-tight text-primary">Report engine initializing...</p>
  </div>
);

const AdminSectionPlaceholder = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const title = location.pathname
    .split('/')
    .filter(Boolean)
    .slice(1)
    .join(' / ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

  return (
    <div className="flex items-center justify-center min-h-[70vh]">
      <div className="max-w-xl w-full bg-white rounded-[32px] border border-gray-100 shadow-sm p-10 text-center">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-green-50 text-green-600 flex items-center justify-center mb-5">
          <FileText size={28} />
        </div>
        <h2 className="text-2xl font-black text-gray-950 uppercase tracking-tight">{title || 'Page Not Found'}</h2>
        <p className="mt-3 text-sm font-medium text-gray-500 leading-6">
          The requested page could not be found or is currently under setup. Please check the URL or return to the dashboard.
        </p>
        <button
          type="button"
          onClick={() => navigate('/admin/dashboard')}
          className="mt-8 inline-flex items-center justify-center px-6 py-3 rounded-xl bg-[#2563EB] text-white text-[12px] font-black uppercase tracking-widest shadow-lg shadow-blue-900/20"
        >
          Back to Dashboard
        </button>
      </div>
    </div>
  );
};

/**
 * Taxi admin pages, mounted by the platform admin router at /admin/taxi/*. Paths inside this file
 * are relative to that mount; links the pages build as `/admin/...` are mapped to `/admin/taxi/...`
 * by the taxi router shim, so the pages did not need to change.
 */
export default function TaxiAdminRoutes() {
  return (
    <TaxiAdminFrame>
      <Routes>
      <Route index element={<Navigate to="/admin/dashboard" />} />
      <Route path="dashboard" element={<AdminDashboard />} />
      <Route path="earnings" element={<AdminEarnings />} />
      <Route path="earnings/:metric" element={<AdminEarningsDetail />} />
      <Route path="payments" element={<AdminPayments />} />
      <Route path="driver-subscription/analytics" element={<AdminDriverSubscriptionAnalytics />} />
      <Route path="chat" element={<AdminChat />} />
      <Route path="trips" element={<AdminTrips />} />
      <Route path="deliveries" element={<AdminDeliveries />} />
      <Route path="ongoing" element={<AdminOngoing />} />
      <Route path="wallet/payment" element={<AdminWalletPayment />} />
      <Route path="users" element={<AdminUserList />} />
      <Route path="users/create" element={<AdminUserCreate />} />
      <Route path="users/subscriptions" element={<AdminUserSubscriptions />} />
      <Route path="users/subscriptions/create" element={<AdminUserSubscriptionCreate />} />
      <Route path="users/:id" element={<AdminUserDetails />} />
      <Route path="users/delete-requests" element={<AdminDeleteRequestUsers />} />
      <Route path="users/bulk-upload" element={<AdminUserBulkUpload />} />
      <Route path="user-import/create" element={<AdminUserImportCreate />} />

      <Route path="drivers" element={<AdminDriverList />} />
      <Route path="drivers/active" element={<AdminDriverList mode="active" />} />
      <Route path="drivers/create" element={<AdminDriverCreate />} />
      <Route path="drivers/edit/:id" element={<AdminDriverEdit />} />
      <Route path="drivers/:id" element={<AdminDriverDetails />} />
      <Route path="drivers/pending" element={<AdminPendingDrivers />} />
      <Route path="drivers/subscription" element={<AdminDriverSubscriptions />} />
      <Route path="drivers/subscription/create" element={<AdminDriverSubscriptionCreate />} />
      <Route path="drivers/ratings" element={<AdminDriverRatings />} />
      <Route path="drivers/ratings/:id" element={<AdminDriverRatingDetail />} />
      <Route path="drivers/wallet" element={<AdminDriverWallet />} />
      <Route path="drivers/wallet/negative" element={<AdminNegativeBalanceDrivers />} />
      <Route path="drivers/wallet/withdrawals" element={<AdminWithdrawalRequestDrivers />} />
      <Route path="drivers/wallet/withdrawals/:id" element={<AdminWithdrawalRequestDetail />} />
      <Route path="drivers/delete-requests" element={<AdminDriverDeleteRequests />} />
      <Route path="drivers/documents" element={<AdminGlobalDocuments />} />
      <Route path="drivers/documents/create" element={<AdminDriverDocumentForm />} />
      <Route path="drivers/documents/edit/:id" element={<AdminDriverDocumentForm />} />
      <Route path="drivers/bulk-upload" element={<AdminDriverBulkUpload />} />
      <Route path="driver-import/create" element={<AdminDriverImportCreate />} />
      <Route path="drivers/payment-methods" element={<AdminPaymentMethods />} />
      <Route path="drivers/audit/:id" element={<AdminDriverAudit />} />
      <Route path="employees" element={<AdminEmployeeList />} />
      <Route path="employees/create" element={<AdminEmployeeCreate />} />
      <Route path="employees/edit/:id" element={<AdminEmployeeCreate />} />
      <Route path="employees/:id" element={<AdminEmployeeDetails />} />
      <Route path="referrals/dashboard" element={<AdminReferralDashboard />} />
      <Route path="referrals/user-settings" element={<AdminUserReferralSettings />} />
      <Route path="referrals/driver-settings" element={<AdminDriverReferralSettings />} />
      <Route path="referrals/translation" element={<AdminReferralTranslation />} />
      <Route path="promotions/promo-codes" element={<AdminPromoCodes />} />
      <Route path="promotions/promo-codes/create" element={<AdminPromoCodes />} />
      <Route path="promotions/promo-codes/edit/:id" element={<AdminPromoCodes />} />
      <Route path="promotions/send-notification" element={<AdminSendNotification />} />
      <Route path="promotions/send-notification/create" element={<AdminSendNotification />} />
      <Route path="promotions/banner-image" element={<AdminBannerImage />} />
      <Route path="promotions/banner-image/create" element={<AdminBannerImage />} />

      <Route path="management/admins" element={<AdminAdmins />} />
      <Route path="management/admins/create" element={<AdminAdminCreate />} />
      <Route path="management/admins/edit/:id" element={<AdminAdminCreate />} />

      <Route
        path="referrals/config"
        element={
          <div className="flex items-center justify-center min-h-[500px] text-gray-400 font-bold uppercase tracking-widest">
            Referral Configuration - Under Setup
          </div>
        }
      />
      <Route
        path="referrals/active"
        element={
          <div className="flex items-center justify-center min-h-[500px] text-gray-400 font-bold uppercase tracking-widest">
            Active Referrals Logs - Under Setup
          </div>
        }
      />
      <Route path="geo/heatmap" element={<AdminHeatMap />} />
      <Route path="geo/gods-eye" element={<AdminGodsEye />} />
      <Route path="geo/peak-zone" element={<AdminGeoFencing />} />
      <Route path="geo/*" element={<AdminGeoFencing />} />
      <Route path="finance" element={<AdminFinance />} />
      <Route path="pricing">
        <Route index element={<Navigate to="service-location" />} />
        <Route path="service-location" element={<AdminServiceLocation />} />
        <Route path="service-location/jurisdictions" element={<AdminServiceLocation mode="jurisdictions" />} />
        <Route path="service-location/jurisdictions/:jurisdictionName" element={<AdminServiceLocation mode="jurisdictions" />} />
        <Route path="service-location/add" element={<AdminServiceLocation mode="create" />} />
        <Route path="service-location/edit/:id" element={<AdminServiceLocation mode="edit" />} />
        <Route path="app-modules" element={<AdminAppModules />} />
        <Route path="app-modules/create" element={<AdminAppModules mode="create" />} />
        <Route path="app-modules/edit/:id" element={<AdminAppModules mode="edit" />} />
        <Route path="zone" element={<AdminZoneManagement />} />
        <Route path="zone/create" element={<AdminZoneManagement mode="create" />} />
        <Route path="zone/edit/:id" element={<AdminZoneManagement mode="edit" />} />
        <Route path="zone/view/:id" element={<AdminZoneManagement mode="view" />} />
        <Route path="airport" element={<AdminAirportManagement />} />
        <Route path="airport/create" element={<AdminAirportManagement mode="create" />} />
        <Route path="airport/edit/:id" element={<AdminAirportManagement mode="edit" />} />
        <Route path="vehicle-type" element={<AdminVehicleType />} />
        <Route path="vehicle-type/create" element={<AdminVehicleType mode="create" />} />
        <Route path="vehicle-type/edit/:id" element={<AdminVehicleType mode="edit" />} />
        <Route path="set-price" element={<AdminSetPrices />} />
        <Route path="set-price/create" element={<AdminSetPrices mode="create" />} />
        <Route path="set-price/edit/:id" element={<AdminSetPrices mode="edit" />} />
        <Route path="set-price/packages/:id" element={<AdminSetPackagePrices />} />
        <Route path="set-price/packages/create/:id" element={<AdminCreatePackagePrice mode="create" />} />
        <Route path="set-price/packages/edit/:packageId" element={<AdminCreatePackagePrice mode="edit" />} />
        <Route path="package-pricing" element={<AdminSetPackagePrices />} />
        <Route path="package-pricing/create" element={<AdminCreatePackagePrice mode="create" />} />
        <Route path="package-pricing/edit/:packageId" element={<AdminCreatePackagePrice mode="edit" />} />
        <Route path="set-price/incentive/:id" element={<AdminDriverIncentive />} />
        <Route path="set-price/surge/:id" element={<AdminSurgePricing />} />
        <Route path="price-hike" element={<AdminPriceHike />} />
        <Route path="goods-types" element={<AdminGoodsTypes />} />
        <Route path="goods-types/create" element={<AdminGoodsTypes mode="create" />} />
        <Route path="goods-types/edit/:id" element={<AdminGoodsTypes mode="edit" />} />
      </Route>
      <Route path="safety" element={<AdminSafetyCenter />} />
      <Route path="support/ticket-title" element={<AdminSupportTicketTitle />} />
      <Route path="support/tickets" element={<AdminSupportTickets />} />

      <Route path="reports/user" element={<AdminUserReport />} />
      <Route path="reports/driver" element={<AdminDriverReport />} />
      <Route path="reports/driver-duty" element={<AdminDriverDutyReport />} />
      <Route path="reports/finance" element={<AdminFinanceReport />} />

      <Route path="masters/languages" element={<AdminLanguages />} />
      <Route path="masters/countries" element={<AdminCountryManagement />} />
      <Route path="masters/preferences" element={<AdminPreferences />} />
      <Route path="masters/roles" element={<Navigate to="/admin/management/admins" replace />} />

      <Route path="settings/business/general" element={<AdminGeneralSettings />} />
      <Route path="settings/business/customization" element={<AdminCustomizationSettings />} />
      <Route path="settings/business/transport-ride" element={<AdminTransportRideSettings />} />
      <Route path="settings/business/bid-ride" element={<AdminBidRideSettings />} />
      <Route path="settings/business/driver-subscription" element={<AdminDriverSubscriptionSettings />} />

      <Route path="settings/app/wallet" element={<AdminWalletSettings />} />
      <Route path="settings/app/tip" element={<AdminTipSettings />} />
      <Route path="settings/app/ride-voice" element={<AdminRideVoiceSettings />} />
      <Route path="settings/app/country" element={<AdminCountryManagement />} />
      <Route path="settings/app/onboard" element={<AdminOnboardingScreens />} />

      <Route path="settings/user-app/home-sections" element={<AdminUserAppManagement tab="home-sections" />} />
      <Route path="settings/user-app/everything-in-minutes" element={<AdminUserAppManagement tab="everything" />} />
      <Route path="settings/user-app/explore-cards" element={<AdminUserAppManagement tab="explore" />} />
      <Route path="settings/user-app/promo-banners" element={<AdminUserAppManagement tab="promos" />} />
      <Route path="settings/user-app/go-places" element={<AdminUserAppManagement tab="go-places" />} />
      <Route path="settings/user-app/footer-content" element={<AdminUserAppManagement tab="footer" />} />

      <Route path="settings/business/*" element={<AdminGeneralSettings />} />
      <Route path="settings/app/*" element={<AdminGeneralSettings />} />

      <Route path="settings/third-party/payment" element={<AdminPaymentGateways />} />
      <Route path="settings/third-party/sms" element={<AdminSMSGateways />} />
      <Route path="settings/third-party/firebase" element={<AdminFirebaseSettings />} />
      <Route path="settings/third-party/map-apis" element={<AdminMapSettings />} />
      <Route path="settings/third-party/mail" element={<AdminMailSettings />} />
      <Route path="settings/third-party/notification-channel" element={<AdminNotificationChannels />} />
      <Route path="settings/third-party/recharge-api" element={<AdminRechargeApiSettings />} />
      <Route path="settings/addons/dispatcher" element={<AdminDispatcherAddons />} />

      <Route path="*" element={<AdminSectionPlaceholder />} />
      </Routes>
    </TaxiAdminFrame>
  );
}
