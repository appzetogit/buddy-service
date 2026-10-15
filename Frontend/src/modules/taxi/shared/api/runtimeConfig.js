/**
 * Where the taxi screens talk to.
 *
 * Taxi is served by the platform backend: its REST API lives under `<platform api>/taxi` and its
 * realtime events come over the platform Socket.IO server. Nothing here is taxi-specific config -
 * it is derived from the same `VITE_API_BASE_URL` / `VITE_SOCKET_URL` the Food and Quick Commerce
 * apps already use.
 */
const trimTrailingSlash = (value = '') => value.replace(/\/+$/, '');

const resolveOrigin = (origin) => {
  if (typeof window === 'undefined') return origin;
  const { hostname } = window.location;
  // Opened through an IP / real hostname while the config says localhost: point at the same host so
  // a phone on the LAN reaches the dev machine.
  if (hostname !== 'localhost' && hostname !== '127.0.0.1' && origin.includes('localhost')) {
    return origin.replace('localhost', hostname);
  }
  return origin;
};

/** Platform API root, e.g. http://localhost:9000/api/v1 (or the relative /api/v1 behind the dev proxy). */
export const PLATFORM_API_BASE_URL = trimTrailingSlash(
  resolveOrigin(import.meta.env.VITE_API_BASE_URL || '/api/v1'),
);

/** Taxi API root: every taxi request path is relative to this. */
export const API_BASE_URL = `${PLATFORM_API_BASE_URL}/taxi`;

export const BACKEND_ORIGIN = trimTrailingSlash(
  resolveOrigin(
    import.meta.env.VITE_SOCKET_URL ||
      import.meta.env.VITE_BACKEND_ORIGIN ||
      import.meta.env.VITE_ASSET_BASE_URL ||
      (PLATFORM_API_BASE_URL.startsWith('http')
        ? PLATFORM_API_BASE_URL.replace(/\/api(?:\/v1)?$/, '')
        : ''),
  ),
);

export const BACKEND_LABEL = BACKEND_ORIGIN || 'platform backend';
