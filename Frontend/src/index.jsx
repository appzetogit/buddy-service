import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import App from './app/App.jsx'
import { hasModuleSession, isModuleAuthenticated } from './modules/Food/utils/auth.js'
import './shared/styles/global.css'

const NATIVE_LAST_ROUTE_KEY = 'native_last_route'

// ─── Quick-spicy Food Module Initialization ───────────────────────────────────

// Load food module business settings (favicon, title) — non-critical
import('./modules/Food/utils/businessSettings.js')
  .then(({ loadBusinessSettings }) => loadBusinessSettings())
  .catch(() => { /* Silently fail — settings load when admin authenticates */ })

// Apply saved theme
const savedTheme = localStorage.getItem('appTheme') || 'light'
if (savedTheme === 'dark') {
  document.documentElement.classList.add('dark')
} else {
  document.documentElement.classList.remove('dark')
}

function isNativeLikeShell() {
  if (typeof window === 'undefined') return false

  const protocol = String(window.location?.protocol || '').toLowerCase()
  const userAgent = String(window.navigator?.userAgent || '').toLowerCase()

  return (
    Boolean(window.flutter_inappwebview) ||
    Boolean(window.ReactNativeWebView) ||
    protocol === 'file:' ||
    userAgent.includes(' wv') ||
    userAgent.includes('; wv')
  )
}

function getNativePathname() {
  if (typeof window === 'undefined') return '/'
  const rawPathname = String(window.location?.pathname || '')
  return rawPathname.replace(/\/index\.html$/i, '') || '/'
}

/** Portals whose server pathname must become the HashRouter location. */
function isExplicitPortalPath(pathname = '') {
  return (
    pathname.startsWith('/driver') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/food/') ||
    pathname.startsWith('/user/auth') ||
    pathname.startsWith('/restaurant') ||
    pathname.startsWith('/delivery') ||
    pathname.startsWith('/user')
  )
}

function samePortalFamily(pathname = '', hashPath = '') {
  const pathOnly = String(hashPath).split('?')[0] || ''
  if (pathname.startsWith('/driver')) return pathOnly.startsWith('/driver')
  if (pathname.startsWith('/admin')) return pathOnly.startsWith('/admin')
  if (pathname.startsWith('/food/') || pathname.startsWith('/restaurant') || pathname.startsWith('/delivery') || pathname.startsWith('/user')) {
    return (
      pathOnly.startsWith('/food/') ||
      pathOnly.startsWith('/restaurant') ||
      pathOnly.startsWith('/delivery') ||
      pathOnly.startsWith('/user')
    )
  }
  return false
}

function isRestaurantAuthEntryPath(pathname = '') {
  const path = String(pathname).split('?')[0] || ''
  return (
    path === '/food/restaurant/login' ||
    path === '/food/restaurant/welcome' ||
    path === '/food/restaurant/signup' ||
    path === '/food/restaurant/otp' ||
    path === '/food/restaurant/auth/sign-in' ||
    path === '/restaurant/login' ||
    path === '/restaurant/welcome' ||
    path === '/restaurant/signup' ||
    path === '/restaurant/otp'
  )
}

function resolveNativeInitialRoute() {
  if (typeof window === 'undefined') return '/food/user'

  const pathname = getNativePathname()
  const storedRoute = String(localStorage.getItem(NATIVE_LAST_ROUTE_KEY) || '').trim()

  // Restaurant shell often opens on /login every launch — if a session exists,
  // skip auth screens so partners stay logged in like admin/driver.
  if (
    (pathname.startsWith('/food/restaurant') || pathname.startsWith('/restaurant')) &&
    isRestaurantAuthEntryPath(pathname) &&
    hasModuleSession('restaurant')
  ) {
    if (storedRoute.startsWith('/food/restaurant') && !isRestaurantAuthEntryPath(storedRoute)) {
      return storedRoute
    }
    return '/food/restaurant'
  }

  // Always honor the URL the native shell opened — do not replace /driver/*
  // with a stale restaurant/user route from localStorage or another role's auth.
  if (pathname.startsWith('/driver')) return pathname
  if (pathname.startsWith('/food/')) return pathname
  if (pathname.startsWith('/restaurant')) return `/food${pathname}`
  if (pathname.startsWith('/delivery')) return `/food${pathname}`
  if (pathname.startsWith('/user/auth')) return pathname
  if (pathname.startsWith('/user')) return `/food${pathname}`
  if (pathname.startsWith('/admin')) return pathname

  if (
    storedRoute.startsWith('/food/') ||
    storedRoute.startsWith('/admin') ||
    storedRoute.startsWith('/driver')
  ) {
    return storedRoute
  }

  if (hasModuleSession('restaurant') || isModuleAuthenticated('restaurant')) return '/food/restaurant'
  if (hasModuleSession('delivery') || isModuleAuthenticated('delivery')) return '/food/delivery'
  if (hasModuleSession('admin') || isModuleAuthenticated('admin')) return '/admin'
  if (hasModuleSession('user') || isModuleAuthenticated('user')) return '/food/user'

  return '/food/user'
}

function bootstrapNativeHashRoute() {
  if (!isNativeLikeShell() || typeof window === 'undefined') return

  const pathname = getNativePathname()
  const currentHash = String(window.location?.hash || '')
  const hashPath = currentHash.startsWith('#') ? currentHash.slice(1) : currentHash
  const hashPathOnly = String(hashPath).split('?')[0] || ''

  // Logged-in restaurant opened on an auth screen — land in the panel.
  if (
    hasModuleSession('restaurant') &&
    (isRestaurantAuthEntryPath(pathname) || isRestaurantAuthEntryPath(hashPathOnly))
  ) {
    const storedRoute = String(localStorage.getItem(NATIVE_LAST_ROUTE_KEY) || '').trim()
    const target =
      storedRoute.startsWith('/food/restaurant') && !isRestaurantAuthEntryPath(storedRoute)
        ? storedRoute
        : '/food/restaurant'
    const search = String(window.location?.search || '')
    window.history.replaceState(null, '', `#${target}${search}`)
    return
  }

  // Keep an existing hash only when it matches the portal the shell opened.
  // Otherwise a previous session leaves #/food/restaurant/... on /driver/login.
  if (currentHash.startsWith('#/') && isExplicitPortalPath(pathname) && samePortalFamily(pathname, hashPath)) {
    return
  }
  if (currentHash.startsWith('#/') && !isExplicitPortalPath(pathname)) {
    return
  }

  const targetPath = resolveNativeInitialRoute()
  const search = String(window.location?.search || '')
  window.history.replaceState(null, '', `#${targetPath}${search}`)
}

bootstrapNativeHashRoute()

// ─── Suppress known non-critical errors ──────────────────────────────────────

const originalError = console.error
const safeToString = (value) => {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Error) return value.message || '[Error]'
  try {
    return JSON.stringify(value)
  } catch {
    try {
      return String(value)
    } catch {
      return Object.prototype.toString.call(value)
    }
  }
}

console.error = (...args) => {
  const errorStr = args.map(safeToString).join(' ')

  if (typeof args[0] === 'string' && (
    args[0].includes('chrome-extension://') ||
    args[0].includes('_$initialUrl') ||
    args[0].includes('_$onReInit') ||
    args[0].includes('_$bindListeners')
  )) return

  if (
    errorStr.includes('Timeout expired') ||
    errorStr.includes('GeolocationPositionError') ||
    errorStr.includes('Geolocation error') ||
    errorStr.includes('User denied Geolocation') ||
    errorStr.includes('permission denied')
  ) return

  const hasNetworkError = args.some(arg =>
    arg && typeof arg === 'object' &&
    (arg.name === 'AxiosError') &&
    (arg.code === 'ERR_NETWORK' || arg.message === 'Network Error')
  )
  if (hasNetworkError) return

  if (
    errorStr.includes('🌐 Network Error') ||
    errorStr.includes('Network Error - Backend server may not be running') ||
    (errorStr.includes('ERR_NETWORK') && errorStr.includes('AxiosError'))
  ) return

  if (
    errorStr.includes('Restaurant Socket connection error') ||
    errorStr.includes('xhr poll error') ||
    (errorStr.includes('WebSocket connection to') && errorStr.includes('socket.io') && errorStr.includes('failed'))
  ) return

  originalError.call(console, errorStr)
}

window.addEventListener('unhandledrejection', (event) => {
  const error = event.reason || event
  const errorMsg = safeToString(error?.message || error)
  const errorName = error?.name || ''
  if (
    errorMsg.includes('Timeout expired') ||
    errorMsg.includes('User denied Geolocation') ||
    errorMsg.includes('permission denied') ||
    errorName === 'GeolocationPositionError'
  ) {
    event.preventDefault()
    return
  }
})

// ─────────────────────────────────────────────────────────────────────────────

import { AppProviders } from './app/providers.jsx'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element not found')

createRoot(rootElement).render(
  <AppProviders>
    <App />
  </AppProviders>
)

