import { API_BASE_URL, BACKEND_ORIGIN } from './runtimeConfig';

/** Taxi REST root for the few screens that call `fetch` directly (downloads, multipart forms). */
export const TAXI_API_BASE = API_BASE_URL;
export { BACKEND_ORIGIN };

/** The platform admin session token (same login as Food and Quick Commerce). */
export const getAdminToken = () => {
  try {
    return localStorage.getItem('admin_accessToken') || '';
  } catch {
    return '';
  }
};
