import { io } from 'socket.io-client';
import { BACKEND_ORIGIN } from './runtimeConfig';

const SOCKET_ORIGIN = import.meta.env.VITE_SOCKET_URL || BACKEND_ORIGIN;

const isLocalLikeHostname = (hostname = '') => {
  const value = String(hostname || '').trim().toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '::1';
};

const shouldPreferWebsocketFirst = () => {
  try {
    const socketUrl = new URL(
      SOCKET_ORIGIN,
      typeof window !== 'undefined' ? window.location.origin : undefined,
    );

    if (isLocalLikeHostname(socketUrl.hostname)) {
      return true;
    }
  } catch {
    // Fall back to current window detection below.
  }

  if (typeof window !== 'undefined' && isLocalLikeHostname(window.location.hostname)) {
    return true;
  }

  return false;
};

/**
 * The taxi socket authenticates with the platform access token (the same one the Food and Quick
 * Commerce sockets use): `admin_accessToken` for admins, `user_accessToken` for riders.
 */
const readToken = (key) => {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
};

const resolveTokenForRole = (role) => {
  const normalizedRole = String(role || '').toLowerCase();
  const adminToken = readToken('admin_accessToken');
  const userToken = readToken('user_accessToken') || readToken('accessToken');

  if (normalizedRole === 'admin') return adminToken || null;
  if (normalizedRole === 'user') return userToken || null;
  return userToken || adminToken || null;
};

class SocketService {
  constructor() {
    this.socket = null;
    this.currentToken = null;
    this.listeners = new Map();
  }

  attachRegisteredListeners() {
    if (!this.socket) {
      return;
    }

    this.listeners.forEach((callbacks, event) => {
      callbacks.forEach((callback) => {
        this.socket.on(event, callback);
      });
    });
  }

  connect(options = {}) {
    const token = options.token || resolveTokenForRole(options.role);

    if (!token) {
      console.warn('[socket] missing token for role', options.role || 'unknown');
      return null;
    }

    if (this.socket && this.currentToken === token) {
      if (!this.socket.connected) {
        console.info('[socket] reconnecting existing socket', {
          role: options.role || 'unknown',
          socketId: this.socket.id || null,
        });
        this.socket.auth = { ...(this.socket.auth || {}), token };
        this.socket.connect();
      }

      console.info('[socket] reusing existing connection', {
        role: options.role || 'unknown',
        socketId: this.socket.id || null,
        connected: this.socket.connected,
      });
      return this.socket;
    }

    if (this.socket) {
      console.info('[socket] disconnecting previous socket before reconnect');
      this.socket.disconnect();
    }

    this.currentToken = token;
    const preferWebsocketFirst = shouldPreferWebsocketFirst();
    this.socket = io(SOCKET_ORIGIN, {
      auth: { token },
      // Prefer WebSocket first everywhere so realtime-heavy ride flows do not
      // pay the polling handshake cost on every connection.
      transports: preferWebsocketFirst ? ['websocket', 'polling'] : ['websocket', 'polling'],
      upgrade: true,
      rememberUpgrade: true,
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 750,
      reconnectionDelayMax: 2500,
      timeout: 10000,
    });
    this.attachRegisteredListeners();

    this.socket.on('connect', () => {
      console.info('[socket] connected', {
        role: options.role || 'unknown',
        socketId: this.socket?.id || null,
      });
    });

    this.socket.on('connect_error', (error) => {
      console.error('[socket] connect_error', {
        role: options.role || 'unknown',
        message: error?.message || 'unknown error',
        description: error?.description || null,
        context: error?.context || null,
      });
    });

    this.socket.on('disconnect', (reason) => {
      console.warn('[socket] disconnected', {
        role: options.role || 'unknown',
        reason,
      });
    });

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.currentToken = null;
    }
  }

  on(event, callback) {
    if (!event || typeof callback !== 'function') {
      return;
    }

    const callbacks = this.listeners.get(event) || new Set();
    callbacks.add(callback);
    this.listeners.set(event, callbacks);

    if (this.socket) {
      this.socket.on(event, callback);
    }
  }

  off(event, callback) {
    if (!event) {
      return;
    }

    if (callback) {
      const callbacks = this.listeners.get(event);
      callbacks?.delete(callback);

      if (callbacks?.size === 0) {
        this.listeners.delete(event);
      }
    } else {
      this.listeners.delete(event);
    }

    if (this.socket) {
      if (callback) {
        this.socket.off(event, callback);
        return;
      }

      this.socket.off(event);
    }
  }

  emit(event, data) {
    if (this.socket) {
      this.socket.emit(event, data);
    }
  }

  isConnected() {
    return Boolean(this.socket?.connected);
  }
}

export const socketService = new SocketService();
