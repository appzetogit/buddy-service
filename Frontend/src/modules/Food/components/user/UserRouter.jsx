import { Routes, Route, Navigate } from "react-router-dom"
import UserLayout from "./UserLayout"
import { Suspense, lazy } from "react"
import Loader from "@food/components/Loader"
import ProtectedRoute from "@food/components/ProtectedRoute"
import Cart from "@food/pages/user/cart/Cart"
import { ENABLE_DINING } from "@/shared/featureFlags"

// Lazy Loading Pages

// Home & Discovery
const Home = lazy(() => import("@food/pages/user/Home"))
const Dining = lazy(() => import("@food/pages/user/Dining.jsx"))
const DiningCategory = lazy(() => import("@food/pages/user/DiningCategory"))
const DiningExplore50 = lazy(() => import("@food/pages/user/DiningExplore50"))
const DiningExploreNear = lazy(() => import("@food/pages/user/DiningExploreNear"))
const Coffee = lazy(() => import("@food/pages/user/Coffee"))
const Under250 = lazy(() => import("@food/pages/user/Under250"))
const Categories = lazy(() => import("@food/pages/user/Categories"))
const CategoryPage = lazy(() => import("@food/pages/user/CategoryPage"))
const Restaurants = lazy(() => import("@food/pages/user/restaurants/Restaurants"))
const RestaurantDetails = lazy(() => import("@food/pages/user/restaurants/RestaurantDetails"))
const DiningRestaurantDetails = lazy(() => import("@food/pages/user/dining/DiningRestaurantDetails"))
const TableBooking = lazy(() => import("@food/pages/user/dining/TableBooking"))
const TableBookingConfirmation = lazy(() => import("@food/pages/user/dining/TableBookingConfirmation"))
const TableBookingSuccess = lazy(() => import("@food/pages/user/dining/TableBookingSuccess"))
const TableModificationPolicy = lazy(() => import("@food/pages/user/dining/TableModificationPolicy"))
const TableCancellationPolicy = lazy(() => import("@food/pages/user/dining/TableCancellationPolicy"))
const TableEditUserPage = lazy(() => import("@food/pages/user/dining/TableEditUserPage"))
const MyBookings = lazy(() => import("@food/pages/user/dining/MyBookings"))
const SearchResults = lazy(() => import("@food/pages/user/search/ProfessionalSearch"))
const ProductDetail = lazy(() => import("@food/pages/user/ProductDetail"))

// Cart
const Checkout = lazy(() => import("@food/pages/user/cart/Checkout"))
const SelectAddress = lazy(() => import("@food/pages/user/cart/SelectAddress"))
const AddressSelectorPage = lazy(() => import("@food/pages/user/cart/AddressSelectorPage"))

// Orders
const Orders = lazy(() => import("@food/pages/user/orders/Orders"))
const OrderTracking = lazy(() => import("@food/pages/user/orders/OrderTracking"))
const OrderInvoice = lazy(() => import("@food/pages/user/orders/OrderInvoice"))
const UserOrderDetails = lazy(() => import("@food/pages/user/orders/UserOrderDetails"))

// Offers
const Offers = lazy(() => import("@food/pages/user/Offers"))

// Gourmet
const Gourmet = lazy(() => import("@food/pages/user/Gourmet"))


// Collections
const Collections = lazy(() => import("@food/pages/user/Collections"))
const CollectionDetail = lazy(() => import("@food/pages/user/CollectionDetail"))



// Profile — unified across Food & Taxi (see src/shared/profile/UnifiedProfile.jsx)
const UnifiedProfile = lazy(() => import("@/shared/profile/UnifiedProfile"))
// Legacy Food-only profile (kept for reference; route now uses UnifiedProfile)
// const Profile = lazy(() => import("@food/pages/user/profile/Profile"))
const EditProfile = lazy(() => import("@food/pages/user/profile/EditProfile"))
const Payments = lazy(() => import("@food/pages/user/profile/Payments"))
const AddPayment = lazy(() => import("@food/pages/user/profile/AddPayment"))
const EditPayment = lazy(() => import("@food/pages/user/profile/EditPayment"))
const Favorites = lazy(() => import("@food/pages/user/profile/Favorites"))
const Support = lazy(() => import("@food/pages/user/profile/Support"))
const Coupons = lazy(() => import("@food/pages/user/profile/Coupons"))
const About = lazy(() => import("@food/pages/user/profile/About"))
const Terms = lazy(() => import("@food/pages/user/profile/Terms"))
const Privacy = lazy(() => import("@food/pages/user/profile/Privacy"))
const Refund = lazy(() => import("@food/pages/user/profile/Refund"))
const Shipping = lazy(() => import("@food/pages/user/profile/Shipping"))
const Cancellation = lazy(() => import("@food/pages/user/profile/Cancellation"))
const ReportSafetyEmergency = lazy(() => import("@food/pages/user/profile/ReportSafetyEmergency"))
const Accessibility = lazy(() => import("@food/pages/user/profile/Accessibility"))
const Logout = lazy(() => import("@food/pages/user/profile/Logout"))
const ReferEarn = lazy(() => import("@food/pages/user/profile/ReferEarn"))

// Auth — login + OTP are now centralized in `modules/auth/pages/Login`.
// We keep the AuthCallback (used by 3rd-party OAuth flows) and redirect
// the rest into the unified `/user/auth/login`.
const AuthCallback = lazy(() => import("@food/pages/user/auth/AuthCallback"))

// Help
const Help = lazy(() => import("@food/pages/user/help/Help"))
const OrderHelp = lazy(() => import("@food/pages/user/help/OrderHelp"))

// Notifications
const Notifications = lazy(() => import("@food/pages/user/Notifications"))

// Wallet
const Wallet = lazy(() => import("@food/pages/user/Wallet"))

// Complaints
const SubmitComplaint = lazy(() => import("@food/pages/user/complaints/SubmitComplaint"))

export default function UserRouter() {
  return (
    <Suspense fallback={<Loader />}>
      <Routes>
        {/* Public legal pages (login + shared links) */}
        <Route path="terms" element={<Terms />} />
        <Route path="privacy" element={<Privacy />} />
        <Route path="refund" element={<Refund />} />
        <Route path="shipping" element={<Shipping />} />
        <Route path="cancellation" element={<Cancellation />} />
        <Route path="about" element={<About />} />


        <Route element={<UserLayout />}>
          {/* Home & Discovery */}
          <Route path="" element={<Home />} />
          {ENABLE_DINING ? (
            <>
              <Route path="dining" element={<Dining />} />
              <Route path="dining/:category" element={<DiningCategory />} />
              <Route path="dining/explore/upto50" element={<DiningExplore50 />} />
              <Route path="dining/explore/near-rated" element={<DiningExploreNear />} />
              <Route path="dining/coffee" element={<Coffee />} />
              <Route path="dining/:diningType/:slug" element={<DiningRestaurantDetails />} />
              <Route path="dining/book/:slug" element={<TableBooking />} />
              <Route path="dining/book-confirmation" element={<TableBookingConfirmation />} />
              <Route path="dining/book-success" element={<TableBookingSuccess />} />
              <Route path="dining/modification-policy" element={<TableModificationPolicy />} />
              <Route path="dining/cancellation-policy" element={<TableCancellationPolicy />} />
              <Route path="dining/edit-user" element={<TableEditUserPage />} />
              <Route
                path="bookings"
                element={
                  <ProtectedRoute requiredRole="user" loginPath="/user/auth/login">
                    <MyBookings />
                  </ProtectedRoute>
                }
              />
            </>
          ) : (
            <>
              <Route path="dining/*" element={<Navigate to="/food/user" replace />} />
              <Route path="bookings" element={<Navigate to="/food/user" replace />} />
            </>
          )}
          <Route path="under-250" element={<Under250 />} />
          <Route path="categories" element={<Categories />} />
          <Route path="category/:category" element={<CategoryPage />} />
          <Route path="restaurants" element={<Restaurants />} />
          <Route path="restaurants/:slug" element={<RestaurantDetails />} />
          <Route path="search" element={<SearchResults />} />
          <Route path="product/:id" element={<ProductDetail />} />

          {/* Cart - Now Public */}
          <Route path="cart" element={<Cart />} />
          <Route path="cart/checkout" element={<Checkout />} />
          <Route path="cart/select-address" element={<SelectAddress />} />
          <Route path="address-selector" element={<AddressSelectorPage />} />

          {/* Orders - Protected (require user auth) */}
          <Route
            path="orders"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/user/auth/login">
                <Orders />
              </ProtectedRoute>
            }
          />
          <Route
            path="orders/:orderId"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/user/auth/login">
                <OrderTracking />
              </ProtectedRoute>
            }
          />
          <Route
            path="orders/:orderId/invoice"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/user/auth/login">
                <OrderInvoice />
              </ProtectedRoute>
            }
          />
          <Route
            path="orders/:orderId/details"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/user/auth/login">
                <UserOrderDetails />
              </ProtectedRoute>
            }
          />

          {/* Offers */}
          <Route path="offers" element={<Offers />} />

          {/* Gourmet */}
          <Route path="gourmet" element={<Gourmet />} />


          {/* Collections */}
          <Route path="collections" element={<Collections />} />
          <Route path="collections/:id" element={<CollectionDetail />} />



          {/* Profile - Protected (require user auth) */}
          <Route
            path="profile"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/user/auth/login">
                <UnifiedProfile />
              </ProtectedRoute>
            }
          />
          {/* Legacy: <Profile /> — replaced by UnifiedProfile */}
          <Route
            path="profile/edit"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/user/auth/login">
                <EditProfile />
              </ProtectedRoute>
            }
          />
          <Route
            path="profile/payments"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/user/auth/login">
                <Payments />
              </ProtectedRoute>
            }
          />
          <Route
            path="profile/payments/new"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/user/auth/login">
                <AddPayment />
              </ProtectedRoute>
            }
          />
          <Route
            path="profile/payments/:id/edit"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/user/auth/login">
                <EditPayment />
              </ProtectedRoute>
            }
          />
          <Route
            path="profile/favorites"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/user/auth/login">
                <Favorites />
              </ProtectedRoute>
            }
          />
          <Route
            path="profile/support"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/user/auth/login">
                <Support />
              </ProtectedRoute>
            }
          />
          <Route
            path="profile/coupons"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/user/auth/login">
                <Coupons />
              </ProtectedRoute>
            }
          />
          <Route
            path="profile/about"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/user/auth/login">
                <About />
              </ProtectedRoute>
            }
          />

          <Route
            path="profile/report-safety-emergency"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/user/auth/login">
                <ReportSafetyEmergency />
              </ProtectedRoute>
            }
          />
          <Route
            path="profile/accessibility"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/user/auth/login">
                <Accessibility />
              </ProtectedRoute>
            }
          />
          <Route
            path="profile/logout"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/user/auth/login">
                <Logout />
              </ProtectedRoute>
            }
          />
          <Route
            path="profile/refer-earn"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/user/auth/login">
                <ReferEarn />
              </ProtectedRoute>
            }
          />
          <Route
            path="profile/dining-bookings"
            element={
              ENABLE_DINING ? (
                <ProtectedRoute requiredRole="user" loginPath="/user/auth/login">
                  <MyBookings />
                </ProtectedRoute>
              ) : (
                <Navigate to="/food/user/profile" replace />
              )
            }
          />

          {/* Public Legal Policies (stay public) */}
          <Route path="profile/terms" element={<Terms />} />
          <Route path="profile/privacy" element={<Privacy />} />
          <Route path="profile/refund" element={<Refund />} />
          <Route path="profile/shipping" element={<Shipping />} />
          <Route path="profile/cancellation" element={<Cancellation />} />

          {/* Auth - User login is centralized at /user/auth/login */}
          <Route path="auth/login" element={<Navigate to="/user/auth/login" replace />} />
          <Route path="auth/sign-in" element={<Navigate to="/user/auth/login" replace />} />
          <Route path="auth/otp" element={<Navigate to="/user/auth/login" replace />} />
          <Route path="auth/callback" element={<AuthCallback />} />

          {/* Help */}
          <Route path="help" element={<Help />} />
          <Route path="help/orders/:orderId" element={<OrderHelp />} />

          {/* Notifications - Protected (user auth) */}
          <Route
            path="notifications"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/user/auth/login">
                <Notifications />
              </ProtectedRoute>
            }
          />

          {/* Wallet - Protected (user auth) */}
          <Route
            path="wallet"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/user/auth/login">
                <Wallet />
              </ProtectedRoute>
            }
          />

          {/* Complaints - Protected (user auth) */}
          <Route
            path="complaints/submit/:orderId"
            element={
              <ProtectedRoute requiredRole="user" loginPath="/user/auth/login">
                <SubmitComplaint />
              </ProtectedRoute>
            }
          />
        </Route>
      </Routes>
    </Suspense>
  )
}

