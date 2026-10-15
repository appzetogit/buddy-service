import React, { forwardRef, useCallback, useMemo } from 'react';
import * as RR from 'react-router-dom';

/**
 * Router adapter for the taxi screens.
 *
 * The taxi admin pages were written for an app that owns `/admin/...`. Inside the platform they are
 * mounted at `/admin/taxi/...` (next to Food and Quick Commerce). Rather than editing ~150 pages,
 * every router entry point the pages use maps the path in both directions:
 *   - links / navigation:  `/admin/x`      -> `/admin/taxi/x`
 *   - location reads:      `/admin/taxi/x` -> `/admin/x`
 * Everything else (`/taxi/user/...`, relative paths, external URLs) passes through untouched.
 */
export const TAXI_ADMIN_BASE = '/admin/taxi';

const ADMIN_PREFIX = /^\/admin(?=\/|$|\?|#)/;
const TAXI_ADMIN_PREFIX = /^\/admin\/taxi(?=\/|$|\?|#)/;

// Taxi has no sign-in screens of its own: anything that used to open one goes to the platform login,
// and the taxi "home" is the platform's /taxi/user.
const PLATFORM_LOGIN = '/user/auth/login';
const TAXI_AUTH_PATH = /^(?:\/taxi\/user\/(?:login|signup|verify-otp|splash|onboarding)|\/login)(?=$|\?|#)/;

export const toPlatformPath = (to) => {
  if (typeof to === 'string') {
    if (to === '/') return '/taxi/user';
    if (TAXI_AUTH_PATH.test(to)) return to.replace(TAXI_AUTH_PATH, PLATFORM_LOGIN);
    if (TAXI_ADMIN_PREFIX.test(to)) return to;
    if (ADMIN_PREFIX.test(to)) return to.replace(ADMIN_PREFIX, TAXI_ADMIN_BASE);
    return to;
  }
  if (to && typeof to === 'object' && typeof to.pathname === 'string') {
    return { ...to, pathname: toPlatformPath(to.pathname) };
  }
  return to;
};

export const toTaxiPath = (pathname) =>
  typeof pathname === 'string' && TAXI_ADMIN_PREFIX.test(pathname)
    ? pathname.replace(TAXI_ADMIN_PREFIX, '/admin') || '/admin'
    : pathname;

export const Link = forwardRef(function TaxiLink({ to, ...rest }, ref) {
  return <RR.Link ref={ref} to={toPlatformPath(to)} {...rest} />;
});

export const NavLink = forwardRef(function TaxiNavLink({ to, ...rest }, ref) {
  return <RR.NavLink ref={ref} to={toPlatformPath(to)} {...rest} />;
});

export function Navigate({ to, ...rest }) {
  return <RR.Navigate to={toPlatformPath(to)} {...rest} />;
}

export function useNavigate() {
  const navigate = RR.useNavigate();
  return useCallback(
    (to, options) => (typeof to === 'number' ? navigate(to) : navigate(toPlatformPath(to), options)),
    [navigate],
  );
}

export function useLocation() {
  const location = RR.useLocation();
  return useMemo(
    () => ({ ...location, pathname: toTaxiPath(location.pathname) }),
    [location],
  );
}

export {
  BrowserRouter,
  MemoryRouter,
  Outlet,
  Route,
  Routes,
  createSearchParams,
  matchPath,
  useMatch,
  useOutletContext,
  useParams,
  useSearchParams,
} from 'react-router-dom';
