import platformClient from '@food/api/axios';
import { API_BASE_URL, PLATFORM_API_BASE_URL } from './runtimeConfig';

/**
 * Taxi's API client, on top of the platform client.
 *
 * Requests go through the platform axios instance (`services/api/axios.js`), so the taxi screens
 * use the platform login: the same admin / customer access tokens as Food and Quick Commerce, the
 * same silent refresh on 401. Taxi code keeps calling `api.get('/users/me')`; this adds the `/taxi`
 * prefix, picks the right session (admin or customer) from the request, and gives the response the
 * shape the taxi screens were written against.
 */

// The taxi screens read both `response.data.x` and `response.x`; this view keeps that working.
const compatibleResponseCache = new WeakMap();

const isCompatibleResponseCandidate = (value) => {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return false;
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return false;
  if (typeof FormData !== 'undefined' && value instanceof FormData) return false;
  if (value instanceof Date) return false;
  return Array.isArray(value) || Object.prototype.toString.call(value) === '[object Object]';
};

const createCompatibleResponseView = (payload) => {
  if (!isCompatibleResponseCandidate(payload)) return payload;
  if (compatibleResponseCache.has(payload)) return compatibleResponseCache.get(payload);

  const proxy = new Proxy(payload, {
    get(target, prop, receiver) {
      if (prop === '__raw') return target;

      if (prop === 'data') {
        const nestedData = target?.data;
        if (nestedData === undefined || nestedData === target) return receiver;
        return createCompatibleResponseView(nestedData);
      }

      const directValue = Reflect.get(target, prop, receiver);
      if (directValue !== undefined) return createCompatibleResponseView(directValue);

      const nestedData = target?.data;
      if (nestedData && (Array.isArray(nestedData) || Object.prototype.toString.call(nestedData) === '[object Object]')) {
        if (prop in nestedData) return createCompatibleResponseView(nestedData[prop]);
        if (prop === 'results' && Array.isArray(nestedData)) return createCompatibleResponseView(nestedData);
      }
      return undefined;
    },
    has(target, prop) {
      if (prop in target) return true;
      const nestedData = target?.data;
      return Boolean(
        nestedData &&
          (Array.isArray(nestedData) || Object.prototype.toString.call(nestedData) === '[object Object]') &&
          prop in nestedData,
      );
    },
  });

  compatibleResponseCache.set(payload, proxy);
  return proxy;
};

const normalizePath = (url = '') => {
  const value = String(url || '');
  return value.startsWith('/') ? value : `/${value}`;
};

/**
 * Which platform session a taxi request belongs to. Admin endpoints use the admin session;
 * everything a rider does uses the customer session. Chat and support are shared by both, so they
 * follow whoever is on the screen.
 */
const resolveSessionModule = (url = '') => {
  const requestPath = normalizePath(url).split('?')[0];

  if (/^\/admin(\/|$)/.test(requestPath)) return 'admin';

  if (/^\/(chats?|support)(\/|$)/.test(requestPath)) {
    let chatRole = '';
    try {
      chatRole = String(localStorage.getItem('chatRole') || '').toLowerCase();
    } catch {
      chatRole = '';
    }
    if (chatRole === 'admin') return 'admin';
    if (chatRole === 'user') return 'user';
    if (typeof window !== 'undefined' && String(window.location.pathname || '').includes('/admin')) return 'admin';
    return 'user';
  }

  return 'user';
};

const toPlatformRequest = (method, url, data, config = {}) => ({
  ...config,
  method,
  url: `/taxi${normalizePath(url)}`,
  ...(data !== undefined ? { data } : {}),
  contextModule: config.contextModule || resolveSessionModule(url),
});

/** Errors reach the taxi screens as the plain response body plus `status`, as they always did. */
const toTaxiError = (error) => {
  if (error?.response) {
    return { ...(error.response.data || {}), status: error.response.status };
  }
  return { message: 'Network error or server down.' };
};

const send = async (method, url, data, config) => {
  try {
    const response = await platformClient.request(toPlatformRequest(method, url, data, config));
    if (config?.responseType === 'blob') return response.data;
    return createCompatibleResponseView(response.data);
  } catch (error) {
    throw toTaxiError(error);
  }
};

// ---- GET de-duplication: the same lookups are fired from many components at once -------------
const DEDUPED_GET_TTL_MS = 2500;
const dedupedGetRequests = new Map();
const recentDedupedGetResponses = new Map();

const isDedupedGet = (url = '') => {
  const requestPath = String(url || '').split('?')[0];
  return (
    /^\/users\/me$/.test(requestPath) ||
    /^\/rides\/active\/me$/.test(requestPath) ||
    /^\/deliveries\/active\/me$/.test(requestPath) ||
    /^\/admin\/general-settings\/[^/]+$/.test(requestPath) ||
    /^\/common\/payment-gateway$/.test(requestPath) ||
    /^\/admin\/(countries|service-locations|notification-channels)$/.test(requestPath) ||
    /^\/(countries|common\/ride_modules)$/.test(requestPath)
  );
};

const getSessionTokenFor = (url) => {
  try {
    return localStorage.getItem(`${resolveSessionModule(url)}_accessToken`) || '';
  } catch {
    return '';
  }
};

const dedupedGetKey = (url = '', config = {}) =>
  `${String(url || '')}|${config?.params ? JSON.stringify(config.params) : ''}|${getSessionTokenFor(url)}`;

const api = {
  /** Where requests go; handy for diagnostics. */
  baseURL: API_BASE_URL,
  platformBaseURL: PLATFORM_API_BASE_URL,

  request: (config = {}) => send(config.method || 'get', config.url, config.data, config),

  get(url, config = {}) {
    if (!isDedupedGet(url)) return send('get', url, undefined, config);

    const key = dedupedGetKey(url, config);
    const cached = recentDedupedGetResponses.get(key);
    if (cached && Date.now() - cached.timestamp < DEDUPED_GET_TTL_MS) return Promise.resolve(cached.data);

    const pending = dedupedGetRequests.get(key);
    if (pending) return pending;

    const request = send('get', url, undefined, config)
      .then((data) => {
        recentDedupedGetResponses.set(key, { data, timestamp: Date.now() });
        return data;
      })
      .finally(() => dedupedGetRequests.delete(key));

    dedupedGetRequests.set(key, request);
    return request;
  },

  post: (url, data, config) => send('post', url, data, config),
  put: (url, data, config) => send('put', url, data, config),
  patch: (url, data, config) => send('patch', url, data, config),
  delete: (url, config) => send('delete', url, undefined, config),
};

export default api;
