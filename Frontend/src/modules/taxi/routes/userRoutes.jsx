import { Navigate, Route, Routes } from '../shared/router';
import UserProtectedRoute, { UserHomeRoute } from '../guards/UserProtectedRoute';
import RideComplete from '../modules/user/pages/ride/RideComplete';
import {
  Activity,
  AddressSettings,
  AirportCab,
  AirportCabConfirm,
  CabHome,
  Chat,
  ComingSoon,
  DeleteAccount,
  IntercityConfirm,
  IntercityDetails,
  IntercityHome,
  IntercityVehicle,
  LegalPage,
  ParcelSearchingDriver,
  ParcelTracking,
  ParcelType,
  PaymentSettings,
  Profile,
  ProfileSettings,
  PromoCodes,
  RideDetail,
  RideTracking,
  SOSContacts,
  SearchingDriver,
  SelectCategory,
  SelectLocation,
  SelectVehicle,
  SenderReceiverDetails,
  SpiritualTrip,
  SpiritualTripConfirm,
  SpiritualTripVehicle,
  Support,
  SupportTicketDetail,
  SupportTickets,
  UserAppLayout,
  UserNotifications,
  UserReferral,
  Wallet,
} from './lazyPages';

/**
 * Taxi rider screens. Mounted by the platform router at /taxi/*, so paths here are relative to that
 * (`/user/...` is /taxi/user/...). Sign-in is the platform's: UserProtectedRoute sends signed-out
 * riders to /user/auth/login.
 */
export default function TaxiUserRoutes() {
  return (
    <Routes>
      <Route path="/user/terms" element={<LegalPage />} />
      <Route path="/user/privacy" element={<LegalPage />} />
      <Route path="/user/refund" element={<LegalPage />} />
    <Route element={<UserProtectedRoute />}>
      <Route element={<UserAppLayout />}>
        <Route path="/user" element={<UserHomeRoute taxiPrefixed />} />
        <Route path="/user/activity" element={<Activity />} />
        <Route path="/user/support" element={<Support />} />
        <Route path="/user/profile" element={<Profile />} />
        <Route path="/user/referral" element={<UserReferral />} />
        <Route path="/user/promo" element={<PromoCodes />} />
        <Route path="/user/notifications" element={<UserNotifications />} />
      </Route>

      <Route path="/user/ride/select-category" element={<SelectCategory />} />
      <Route path="/user/ride/select-location" element={<SelectLocation />} />
      <Route path="/user/ride/select-vehicle" element={<SelectVehicle />} />
      <Route path="/user/ride/searching" element={<SearchingDriver />} />
      <Route path="/user/ride/tracking" element={<RideTracking />} />
      <Route path="/user/ride/complete" element={<RideComplete />} />
      <Route path="/user/ride/chat" element={<Chat />} />
      <Route path="/user/ride/detail/:id" element={<RideDetail />} />

      <Route path="/user/parcel/type" element={<ParcelType />} />
      <Route path="/user/parcel/details" element={<SenderReceiverDetails />} />
      <Route path="/user/parcel/contacts" element={<SenderReceiverDetails />} />
      <Route path="/user/parcel/searching" element={<ParcelSearchingDriver />} />
      <Route path="/user/parcel/tracking" element={<ParcelTracking />} />
      <Route path="/user/parcel/detail/:id" element={<RideDetail />} />

      <Route path="/user/intercity" element={<IntercityHome />} />
      <Route path="/user/intercity/vehicle" element={<IntercityVehicle />} />
      <Route path="/user/intercity/details" element={<IntercityDetails />} />
      <Route path="/user/intercity/confirm" element={<IntercityConfirm />} />
      <Route path="/user/cab" element={<CabHome />} />
      <Route path="/user/cab/airport" element={<AirportCab />} />
      <Route path="/user/cab/airport-confirm" element={<AirportCabConfirm />} />
      <Route path="/user/cab/spiritual" element={<SpiritualTrip />} />
      <Route path="/user/cab/spiritual-vehicle" element={<SpiritualTripVehicle />} />
      <Route path="/user/cab/spiritual-confirm" element={<SpiritualTripConfirm />} />
      <Route path="/user/tours" element={<ComingSoon />} />

      <Route path="/user/wallet" element={<Wallet />} />

      <Route path="/user/profile/settings" element={<ProfileSettings />} />
      <Route path="/user/profile/payments" element={<PaymentSettings />} />
      <Route path="/user/profile/addresses" element={<AddressSettings />} />
      <Route path="/user/profile/notifications" element={<UserNotifications />} />
      <Route path="/user/profile/delete-account" element={<DeleteAccount />} />
      <Route path="/user/safety/sos" element={<SOSContacts />} />
      <Route path="/user/support/tickets" element={<SupportTickets />} />
      <Route path="/user/support/ticket/:id" element={<SupportTicketDetail />} />
    </Route>

      <Route path="*" element={<Navigate to="/taxi/user" replace />} />
    </Routes>
  );
}
