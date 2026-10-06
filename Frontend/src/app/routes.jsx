// Routing file
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Suspense, lazy, useEffect } from 'react'
import { AppShellSkeleton } from '@food/components/ui/loading-skeletons'
import ProtectedRoute from '@core/guards/ProtectedRoute'
import RoleGuard from '@core/guards/RoleGuard'
import { UserRole } from '@core/constants/roles'
import { SettingsProvider } from '@core/context/SettingsContext'
import { useAuth } from '@core/context/AuthContext'

const NATIVE_LAST_ROUTE_KEY = 'native_last_route'

const FoodApp = lazy(() => import('../modules/Food/routes'))
const AuthApp = lazy(() => import('../modules/auth/routes'))
const DriverApp = lazy(() => import('../modules/driver/routes'))
const QuickCommerceApp = lazy(() => import('../modules/quickCommerce/routes'))
const SellerApp = lazy(() => import('../modules/seller/routes'))
const SellerAuthPage = lazy(() => import('../modules/seller/pages/Auth'))

const PageLoader = () => <AppShellSkeleton />

const THEME_VARS = ['--primary', '--secondary', '--primary-color', '--secondary-color']

// Quick Commerce and Seller settings write theme vars onto <html>; restore them on exit so Food keeps its colors.
const ScopedSettings = ({ children }) => {
  useEffect(() => {
    const root = document.documentElement
    const saved = THEME_VARS.map((name) => [name, root.style.getPropertyValue(name)])
    return () => saved.forEach(([name, value]) => (value ? root.style.setProperty(name, value) : root.style.removeProperty(name)))
  }, [])
  return <SettingsProvider>{children}</SettingsProvider>
}

const QuickCommerceAppWrapper = () => (
  <ScopedSettings>
    <Suspense fallback={<PageLoader />}>
      <QuickCommerceApp />
    </Suspense>
  </ScopedSettings>
)

const RedirectLegacyQuickCommerce = () => {
  const location = useLocation()
  const suffix = location.pathname.replace(/^\/quick-commerce(?:\/user)?/, '')
  const normalizedSuffix = suffix && suffix !== '/' ? suffix : ''
  return <Navigate to={`/quick${normalizedSuffix}${location.search}`} replace />
}

const SellerAppWrapper = () => (
  <ScopedSettings>
    <Suspense fallback={<PageLoader />}>
      <ProtectedRoute>
        <RoleGuard allowedRoles={[UserRole.SELLER]}>
          <SellerApp />
        </RoleGuard>
      </ProtectedRoute>
    </Suspense>
  </ScopedSettings>
)

const SellerAuthEntry = () => {
  const { isAuthenticated, role } = useAuth()
  if (isAuthenticated && role === UserRole.SELLER) return <Navigate to="/seller" replace />
  return (
    <ScopedSettings>
      <Suspense fallback={<PageLoader />}>
        <SellerAuthPage />
      </Suspense>
    </ScopedSettings>
  )
}

const UserProfilePathRedirect = () => {
  const location = useLocation()
  const suffix = location.pathname.replace(/^\/user\/profile\/?/, "")
  const target = suffix
    ? `/food/user/profile/${suffix}${location.search}`
    : `/food/user/profile${location.search}`
  return <Navigate to={target} replace />
}

const FoodAppWrapper = () => {
  return (
    <Suspense fallback={<PageLoader />}>
      <FoodApp />
    </Suspense>
  )
}

const AdminRouter = lazy(() => import('../modules/Food/components/admin/AdminRouter'))

const AppRoutes = () => {
  const location = useLocation()
  useEffect(() => {
    if (typeof window === 'undefined') return

    const foodAdminToken = localStorage.getItem('admin_accessToken');
    if (foodAdminToken && !localStorage.getItem('adminToken')) {
      localStorage.setItem('adminToken', foodAdminToken);
    }

    const generalToken = localStorage.getItem('user_accessToken') || localStorage.getItem('token') || localStorage.getItem('accessToken');
    if (generalToken && !localStorage.getItem('userToken')) {
      try {
        const payload = JSON.parse(atob(generalToken.split('.')[1]));
        if (String(payload?.role || '').toLowerCase() === 'user') {
          localStorage.setItem('userToken', generalToken);
        }
      } catch (e) {}
    }
    const foodAdminInfo = localStorage.getItem('adminInfo');
    if (foodAdminInfo) {
      try {
        const parsed = JSON.parse(foodAdminInfo);
        if (parsed && (!parsed.permissions || parsed.permissions.length === 0 || !parsed.admin_type)) {
          parsed.permissions = ['*'];
          parsed.admin_type = 'superadmin';
          localStorage.setItem('adminInfo', JSON.stringify(parsed));
        }
      } catch (e) {
        // Ignore
      }
    }

    const protocol = String(window.location?.protocol || '').toLowerCase()
    const userAgent = String(window.navigator?.userAgent || '').toLowerCase()
    const isNativeLikeShell =
      Boolean(window.flutter_inappwebview) ||
      Boolean(window.ReactNativeWebView) ||
      protocol === 'file:' ||
      userAgent.includes(' wv') ||
      userAgent.includes('; wv')

    if (!isNativeLikeShell) return

    const route = `${location.pathname || ''}${location.search || ''}`
    if (
      route.startsWith('/food/') ||
      route.startsWith('/admin') ||
      route.startsWith('/driver')
    ) {
      localStorage.setItem(NATIVE_LAST_ROUTE_KEY, route)
    }
  }, [location.pathname, location.search])

  return (
    <Routes>
      <Route path="/user/profile" element={<Navigate to="/food/user/profile" replace />} />
      <Route path="/user/profile/*" element={<UserProfilePathRedirect />} />

      <Route path="/user/auth/*" element={<AuthApp />} />

      <Route path="/driver/*" element={<Suspense fallback={<PageLoader />}><DriverApp /></Suspense>} />

      <Route path="/quick/*" element={<QuickCommerceAppWrapper />} />
      <Route path="/quick-commerce/*" element={<RedirectLegacyQuickCommerce />} />
      <Route path="/seller/auth" element={<SellerAuthEntry />} />
      <Route path="/seller" element={<SellerAppWrapper />} />
      <Route path="/seller/*" element={<SellerAppWrapper />} />

      <Route path="/food/*" element={<FoodAppWrapper />} />


      <Route path="/admin/*" element={<AdminRouter />} />

      <Route path="/rental/*" element={<Navigate to="/food/user" replace />} />
      <Route path="/ride/*" element={<Navigate to="/food/user" replace />} />
      <Route path="/parcel/*" element={<Navigate to="/food/user" replace />} />
      <Route path="/cab/*" element={<Navigate to="/food/user" replace />} />
      <Route path="/intercity/*" element={<Navigate to="/food/user" replace />} />
      <Route path="/bus/*" element={<Navigate to="/food/user" replace />} />
      <Route path="/taxi/*" element={<Navigate to="/food/user" replace />} />

      <Route path="/*" element={<FoodAppWrapper />} />
    </Routes>
  )
}

export default AppRoutes
