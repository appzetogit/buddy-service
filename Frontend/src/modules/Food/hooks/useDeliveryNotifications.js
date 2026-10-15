import { useEffect, useRef, useState, useCallback } from 'react';
import { isTaxiRide } from '@taxi/delivery/taxiDeliveryApi';
import { attachTaxiRideListeners } from '@taxi/delivery/taxiDeliverySocket';
import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';
import { API_BASE_URL } from '@food/api/config';
import { createRealtimeSocket } from '@/services/socket/createRealtimeSocket';
import { createSyncEngine } from '@/services/socket/syncEngine';
import { deliveryAPI } from '@food/api';
const alertSound = '/alert.mp3';
const originalSound = '/original.mp3';
import { dispatchNotificationInboxRefresh } from '@food/hooks/useNotificationInbox';

const shouldLogDeliverySocket = () => {
  if (typeof window === 'undefined') return import.meta.env.DEV;
  try {
    return (
      import.meta.env.DEV ||
      window.localStorage.getItem('delivery_socket_debug') === '1' ||
      window.location.search.includes('delivery_socket_debug=1')
    );
  } catch {
    return import.meta.env.DEV;
  }
};

const debugLog = (...args) => {
  if (shouldLogDeliverySocket()) {
    console.log('[DeliverySocket]', ...args);
  }
};
const debugWarn = (...args) => {
  if (shouldLogDeliverySocket()) {
    console.warn('[DeliverySocket]', ...args);
  }
};
const debugError = (...args) => {
  console.error('[DeliverySocket]', ...args);
};

if (typeof window !== 'undefined') {
  debugLog('alertSound URL:', alertSound);
  debugLog('originalSound URL:', originalSound);
}

const resolveAudioSource = (source) => {
  if (!source) return '';
  // Handle ES6 module imports where the URL might be in a 'default' property
  const url = typeof source === 'object' ? (source.default || source) : source;
  return url;
};

const safeReadJson = (key) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const decodeJwtPayload = (token) => {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((ch) => `%${(`00${ch.charCodeAt(0).toString(16)}`).slice(-2)}`)
        .join('')
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const resolveDeliveryPartnerIdFromClient = () => {
  try {
    const storedUser =
      safeReadJson('delivery_user') ||
      safeReadJson('deliveryUser') ||
      safeReadJson('user');

    const nestedCandidate =
      storedUser?.id ||
      storedUser?._id ||
      storedUser?.userId ||
      storedUser?.deliveryId ||
      storedUser?.deliveryPartnerId ||
      storedUser?.user?.id ||
      storedUser?.user?._id ||
      storedUser?.deliveryPartner?.id ||
      storedUser?.deliveryPartner?._id;

    if (nestedCandidate) return String(nestedCandidate);

    const token =
      localStorage.getItem('delivery_accessToken') ||
      localStorage.getItem('accessToken');
    const payload = decodeJwtPayload(token);
    const tokenCandidate =
      payload?.userId ||
      payload?.id ||
      payload?._id ||
      payload?.sub;

    return tokenCandidate ? String(tokenCandidate) : null;
  } catch {
    return null;
  }
};

const supportsBrowserNotifications = () =>
  typeof window !== 'undefined' && typeof Notification !== 'undefined';

const buildDeliveryOrderNotification = (orderData = {}) => {
  const orderId = orderData.orderId || orderData.orderMongoId || orderData.id || 'New';
  const itemCount = Array.isArray(orderData.items) ? orderData.items.length : 0;
  const total = Number(orderData.total || orderData.pricing?.total || orderData.orderTotal || 0);

  return {
    title: `New order #${orderId}`,
    body: itemCount > 0
      ? `${itemCount} item${itemCount === 1 ? '' : 's'} - ₹${total.toFixed(2)}`
      : 'A new order is available to accept',
    tag: `delivery-order-${orderId}`,
    data: {
      orderId,
      targetUrl: '/delivery',
    },
  };
}

const triggerWebViewNativeNotification = async (orderData = {}) => {
  if (typeof window === 'undefined') return false;

  const bridgePayload = {
    title: 'New delivery order',
    body: `Order #${orderData?.orderId || orderData?.orderMongoId || orderData?.id || ''}`.trim(),
    orderId: orderData?.orderId || orderData?.order_id || '',
    orderMongoId: orderData?.orderMongoId || orderData?.order_mongo_id || '',
    targetUrl: '/delivery',
  };

  try {
    if (
      window.flutter_inappwebview &&
      typeof window.flutter_inappwebview.callHandler === 'function'
    ) {
      const handlerNames = [
        'playNotificationSound',
        'triggerNotificationFeedback',
        'onPushNotification',
      ];

      for (const handlerName of handlerNames) {
        try {
          await window.flutter_inappwebview.callHandler(handlerName, bridgePayload);
          return true;
        } catch {
          // Try next handler name.
        }
      }
    }
  } catch {
    // Ignore bridge failures and fall back to browser/web audio.
  }

  return false;
}


export const useDeliveryNotifications = () => {
  // CRITICAL: All hooks must be called unconditionally and in the same order every render
  // Order: useRef -> useState -> useEffect -> useCallback
  
  // Step 1: All refs first (unconditional)
  const socketRef = useRef(null);
  const audioRef = useRef(null);
  const audioUnlockAttemptedRef = useRef(false);
  const activeOrderRef = useRef(null);
  const alertLoopTimerRef = useRef(null);
  const alertLoopStartedAtRef = useRef(0);
  const userInteractedRef = useRef(false);
  const lastAlertAtByOrderRef = useRef(new Map());
  const lastBrowserNotificationAtByOrderRef = useRef(new Map());
  
  // Step 2: All state hooks (unconditional)
  const [newOrder, setNewOrder] = useState(null);
  const [sharedOrder, setSharedOrder] = useState(null);
  const [orderReady, setOrderReady] = useState(null);
  const [orderStatusUpdate, setOrderStatusUpdate] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [deliveryPartnerId, setDeliveryPartnerId] = useState(null);
  const [claimedOrderId, setClaimedOrderId] = useState(null); // set when another partner claims an order
  const [adminNotification, setAdminNotification] = useState(null);
  const joinedDeliveryRoomRef = useRef(null);
  // Latest-value refs so the connection effect can run with deps [] and still call through to
  // current callbacks/state. Without these the socket was torn down and rebuilt every time
  // deliveryPartnerId resolved (null → localStorage → API), reconnecting at least twice on
  // every mount and losing any event that arrived in the gap.
  const deliveryPartnerIdRef = useRef(null);
  const recoverDeliveryStateRef = useRef(null);
  const sharedOrderRef = useRef(null);
  const syncRef = useRef(null);
  const applyOrderOfferRef = useRef(null);
  const ALERT_LOOP_INTERVAL_MS = 4500;
  const ALERT_LOOP_MAX_MS = 120000;
  // Must stay comfortably under the server's STALE_PRESENCE_MS (2 min) so a healthy rider is
  // never ranked as a ghost between pings.
  const HEARTBEAT_INTERVAL_MS = 30000;
  const ALERT_DEDUPE_MS = 15000;
  const BROWSER_NOTIFICATION_DEDUPE_MS = 20000;
  const NOTIFICATION_PERMISSION_ASKED_KEY = 'delivery_notification_permission_asked';

  // Step 3: All callbacks before effects (unconditional)
  const getOrderAlertKey = (orderData = {}) => (
    String(
      orderData?.orderMongoId ||
      orderData?.order_mongo_id ||
      orderData?.orderId ||
      orderData?.order_id ||
      orderData?._id ||
      orderData?.id ||
      ''
    ).trim()
  );

  const shouldProcessOrderAlert = (orderData = {}) => {
    const key = getOrderAlertKey(orderData);
    if (!key) return true;
    const now = Date.now();
    const last = lastAlertAtByOrderRef.current.get(key) || 0;
    if (now - last < ALERT_DEDUPE_MS) return false;
    lastAlertAtByOrderRef.current.set(key, now);
    return true;
  };

  const shouldShowBrowserNotification = (orderData = {}) => {
    const key = getOrderAlertKey(orderData);
    if (!key) return true;
    const now = Date.now();
    const last = lastBrowserNotificationAtByOrderRef.current.get(key) || 0;
    if (now - last < BROWSER_NOTIFICATION_DEDUPE_MS) return false;
    lastBrowserNotificationAtByOrderRef.current.set(key, now);
    return true;
  };

  const stopAlertLoop = useCallback(() => {
    if (alertLoopTimerRef.current) {
      clearInterval(alertLoopTimerRef.current);
      alertLoopTimerRef.current = null;
    }
    alertLoopStartedAtRef.current = 0;
  }, []);

  const startAlertLoop = useCallback((playSoundFn) => {
    stopAlertLoop();
    alertLoopStartedAtRef.current = Date.now();

    alertLoopTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - alertLoopStartedAtRef.current;
      if (elapsed >= ALERT_LOOP_MAX_MS || !activeOrderRef.current) {
        stopAlertLoop();
        return;
      }

      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        playSoundFn(activeOrderRef.current);
      }
    }, ALERT_LOOP_INTERVAL_MS);
  }, [stopAlertLoop]);
  
  const playNotificationSound = useCallback(async (orderData = {}) => {
    try {
      const usedNativeBridge = await triggerWebViewNativeNotification(orderData);

      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate([200, 100, 200, 100, 300]);
      }

      if (usedNativeBridge) {
        return;
      }

      // Get current selected sound preference from localStorage
      const selectedSound = localStorage.getItem('delivery_alert_sound') || 'zomato_tone';
      const soundFile = selectedSound === 'original'
        ? resolveAudioSource(originalSound, 'delivery-original')
        : resolveAudioSource(alertSound, 'delivery-alert');
      
      // Update audio source if preference changed or initialize if not exists
      if (audioRef.current) {
        const currentSrc = audioRef.current.src;
        const newSrc = soundFile;
        // Check if source needs to be updated
        if (!currentSrc.includes(newSrc.split('/').pop())) {
          audioRef.current.pause();
          audioRef.current.src = newSrc;
          audioRef.current.load();
          debugLog('?? Audio source updated to:', selectedSound === 'original' ? 'Original' : 'Zomato Tone');
        }
      } else {
        // Initialize audio if not exists
        audioRef.current = new Audio();
        audioRef.current.src = soundFile;
        audioRef.current.preload = 'auto';
        audioRef.current.volume = 0.9;
        audioRef.current.load();
        debugLog('?? Audio initialized with:', selectedSound === 'original' ? 'Original' : 'Zomato Tone', 'Source:', soundFile);
      }
      
      if (audioRef.current) {
        audioRef.current.muted = false;
        audioRef.current.volume = 0.9;
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(error => {
          // On strict autoplay environments, we still keep vibration/native bridge path active.
          if (!error.message?.includes('user didn\'t interact') && !error.name?.includes('NotAllowedError')) {
            debugWarn('Error playing notification sound:', error);
          }
        });
      }
    } catch (error) {
      // Don't log autoplay policy errors
      if (!error.message?.includes('user didn\'t interact') && !error.name?.includes('NotAllowedError')) {
        debugWarn('Error playing sound:', error);
      }
    }
  }, []);

  const showBackgroundOrderNotification = useCallback(async (orderData = {}) => {
    if (!shouldShowBrowserNotification(orderData)) {
      return;
    }

    if (!supportsBrowserNotifications() || Notification.permission !== 'granted') {
      return;
    }

    const notificationOptions = buildDeliveryOrderNotification(orderData);

    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
          await registration.showNotification(notificationOptions.title, {
            body: notificationOptions.body,
            tag: notificationOptions.tag,
            renotify: true,
            requireInteraction: true,
            silent: false,
            vibrate: [200, 100, 200, 100, 300],
            icon: '/favicon.ico',
            data: notificationOptions.data,
          });
          return;
        }
      }

      new Notification(notificationOptions.title, {
        body: notificationOptions.body,
        tag: notificationOptions.tag,
        requireInteraction: true,
        silent: false,
        icon: '/favicon.ico',
        data: notificationOptions.data,
      });
    } catch (error) {
      debugWarn('Error showing background delivery notification:', error);
    }
  }, []);

  const handleIncomingOrderAlert = useCallback((orderData = {}) => {
    if (!shouldProcessOrderAlert(orderData)) {
      return;
    }

    activeOrderRef.current = orderData || { id: Date.now() };
    playNotificationSound(orderData);
    startAlertLoop(playNotificationSound);

    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      showBackgroundOrderNotification(orderData);
    }
  }, [playNotificationSound, showBackgroundOrderNotification, startAlertLoop]);

  const recoverDeliveryState = useCallback(async () => {
    if (!deliveryPartnerId) return;

    try {
      const [availableResult, currentTripResult] = await Promise.allSettled([
        deliveryAPI.getOrders({ limit: 20, page: 1 }),
        deliveryAPI.getCurrentDelivery(),
      ]);

      const currentTrip =
        currentTripResult.status === 'fulfilled'
          ? currentTripResult.value?.data?.data ??
            currentTripResult.value?.data ??
            null
          : null;

      if (currentTrip) {
        debugLog('Recovered current delivery trip after reconnect/focus:', currentTrip);
        setOrderStatusUpdate({
          ...currentTrip,
          recoverySource: 'delivery_reconnect',
        });
        return;
      }

      const availablePayload =
        availableResult.status === 'fulfilled'
          ? availableResult.value?.data?.data ??
            availableResult.value?.data ??
            {}
          : {};
      const availableOrders = Array.isArray(availablePayload?.docs)
        ? availablePayload.docs
        : Array.isArray(availablePayload?.items)
          ? availablePayload.items
          : Array.isArray(availablePayload)
            ? availablePayload
            : [];

      const recoverableOrder = availableOrders.find((order) => {
        const dispatchStatus = order?.dispatch?.status;
        return (
          ['unassigned', 'assigned'].includes(dispatchStatus) &&
          ['preparing', 'ready_for_pickup'].includes(order?.orderStatus)
        );
      });

      if (recoverableOrder && !activeOrderRef.current) {
        debugLog('Recovered available delivery order after reconnect/focus:', recoverableOrder);
        setNewOrder(recoverableOrder);
        handleIncomingOrderAlert(recoverableOrder);
      }
    } catch (error) {
      debugWarn('Delivery recovery sync failed:', error?.message || error);
    }
  }, [deliveryPartnerId, handleIncomingOrderAlert]);

  // Keep the refs current on every render so the stable connection effect never reads a
  // stale callback or value.
  deliveryPartnerIdRef.current = deliveryPartnerId;
  recoverDeliveryStateRef.current = recoverDeliveryState;
  sharedOrderRef.current = sharedOrder;

  /**
   * Join this partner's delivery room. Reads the id from a ref so it stays callable from the
   * connection effect. Safe to call repeatedly — server-side `join-delivery` is idempotent and
   * `joinedDeliveryRoomRef` suppresses duplicate emits within one connection.
   */
  const joinDeliveryRoomIfPossible = useCallback(() => {
    const partnerId = deliveryPartnerIdRef.current;
    if (!socketRef.current?.connected || !partnerId) {
      return false;
    }

    if (joinedDeliveryRoomRef.current === partnerId) {
      return true;
    }

    debugLog('Joining delivery room', {
      deliveryPartnerId: partnerId,
      socketId: socketRef.current?.id,
    });
    socketRef.current.emit('join-delivery', partnerId);
    joinedDeliveryRoomRef.current = partnerId;
    return true;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    window.__deliverySocketDebug = {
      enabled: shouldLogDeliverySocket(),
      apiBaseUrl: API_BASE_URL,
      get deliveryPartnerId() {
        return deliveryPartnerId;
      },
      get isConnected() {
        return isConnected;
      },
      get socketId() {
        return socketRef.current?.id || null;
      },
      get socketConnected() {
        return Boolean(socketRef.current?.connected);
      },
      forceReconnect() {
        if (socketRef.current) {
          socketRef.current.connect();
        }
      },
      dump() {
        return {
          enabled: shouldLogDeliverySocket(),
          apiBaseUrl: API_BASE_URL,
          deliveryPartnerId,
          isConnected,
          socketId: socketRef.current?.id || null,
          socketConnected: Boolean(socketRef.current?.connected),
          socketAuthTokenPresent: Boolean(
            localStorage.getItem('delivery_accessToken') || localStorage.getItem('accessToken')
          ),
        };
      },
    };

    return () => {
      if (window.__deliverySocketDebug) {
        delete window.__deliverySocketDebug;
      }
    };
  }, [deliveryPartnerId, isConnected]);

  // Step 4: All effects (unconditional hook calls, conditional logic inside)
  useEffect(() => {
    if (!supportsBrowserNotifications()) return;

    if (Notification.permission !== 'default') return;
    if (localStorage.getItem(NOTIFICATION_PERMISSION_ASKED_KEY) === 'true') return;

    const requestPermissionOnce = async () => {
      localStorage.setItem(NOTIFICATION_PERMISSION_ASKED_KEY, 'true');
      try {
        await Notification.requestPermission();
      } catch (error) {
        debugWarn('Failed to request delivery notification permission:', error);
      }
    };

    const askOnInteraction = () => {
      requestPermissionOnce();
      window.removeEventListener('pointerdown', askOnInteraction);
      window.removeEventListener('keydown', askOnInteraction);
    };

    window.addEventListener('pointerdown', askOnInteraction, { once: true, passive: true });
    window.addEventListener('keydown', askOnInteraction, { once: true });

    return () => {
      window.removeEventListener('pointerdown', askOnInteraction);
      window.removeEventListener('keydown', askOnInteraction);
    };
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState !== 'hidden') return;
      if (!activeOrderRef.current) return;

      playNotificationSound(activeOrderRef.current);
      showBackgroundOrderNotification(activeOrderRef.current);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [playNotificationSound, showBackgroundOrderNotification]);

  // Track user interaction for autoplay policy
  useEffect(() => {
    const handleUserInteraction = async () => {
      userInteractedRef.current = true;

      const selectedSound = localStorage.getItem('delivery_alert_sound') || 'zomato_tone';
      const soundFile = selectedSound === 'original'
        ? resolveAudioSource(originalSound, 'delivery-original')
        : resolveAudioSource(alertSound, 'delivery-alert');

      if (!audioRef.current) {
        audioRef.current = new Audio(soundFile);
        audioRef.current.preload = 'auto';
        audioRef.current.volume = 0.7;
      }

      if (!audioUnlockAttemptedRef.current && audioRef.current) {
        audioUnlockAttemptedRef.current = true;
        try {
          audioRef.current.muted = true;
          // Ensure src is set even if it was just initialized
          if (!audioRef.current.src || audioRef.current.src === window.location.href) {
             const selectedSound = localStorage.getItem('delivery_alert_sound') || 'zomato_tone';
             const soundFile = selectedSound === 'original'
                ? resolveAudioSource(originalSound)
                : resolveAudioSource(alertSound);
             audioRef.current.src = soundFile;
          }
          audioRef.current.load();
          await audioRef.current.play();
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
          debugLog('?? Audio unlocked successfully');
        } catch (error) {
          audioUnlockAttemptedRef.current = false;
          if (!error.message?.includes('user didn\'t interact') && !error.name?.includes('NotAllowedError')) {
            debugWarn('Error unlocking notification audio:', error, 'Audio src:', audioRef.current?.src);
          }
        } finally {
          // Ensure audio never remains muted after unlock attempts.
          if (audioRef.current) {
            audioRef.current.muted = false;
          }
        }
      }

      // Remove listeners after first interaction
      document.removeEventListener('click', handleUserInteraction);
      document.removeEventListener('touchstart', handleUserInteraction);
      document.removeEventListener('keydown', handleUserInteraction);
      window.removeEventListener('pointerdown', handleUserInteraction);
    };
    
    // Listen for user interaction
    document.addEventListener('click', handleUserInteraction, { once: true });
    document.addEventListener('touchstart', handleUserInteraction, { once: true });
    document.addEventListener('keydown', handleUserInteraction, { once: true });
    window.addEventListener('pointerdown', handleUserInteraction, { once: true, passive: true });
    
    return () => {
      document.removeEventListener('click', handleUserInteraction);
      document.removeEventListener('touchstart', handleUserInteraction);
      document.removeEventListener('keydown', handleUserInteraction);
      window.removeEventListener('pointerdown', handleUserInteraction);
    };
  }, []);
  
  // Initialize audio on mount - use selected preference from localStorage
  useEffect(() => {
    // Get selected alert sound preference from localStorage
    const selectedSound = localStorage.getItem('delivery_alert_sound') || 'zomato_tone';
    const soundFile = selectedSound === 'original'
      ? resolveAudioSource(originalSound, 'delivery-original')
      : resolveAudioSource(alertSound, 'delivery-alert');
    
    if (!audioRef.current) {
      audioRef.current = new Audio(soundFile);
      audioRef.current.preload = 'auto';
      audioRef.current.volume = 0.7;
      debugLog('?? Audio initialized with:', selectedSound === 'original' ? 'Original' : 'Zomato Tone');
    } else {
      // Update audio source if preference changed
      const currentSrc = audioRef.current.src;
      const newSrc = soundFile;
      if (!currentSrc.includes(newSrc.split('/').pop())) {
        audioRef.current.pause();
        audioRef.current.src = newSrc;
        audioRef.current.load();
        debugLog('?? Audio updated to:', selectedSound === 'original' ? 'Original' : 'Zomato Tone');
      }
    }
    
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []); // Note: This runs once on mount. To update dynamically, we'd need to listen to storage events

  // Fetch delivery partner ID
  useEffect(() => {
    const fallbackId = resolveDeliveryPartnerIdFromClient();
    if (fallbackId) {
      setDeliveryPartnerId(fallbackId);
      debugLog('? Delivery Partner ID restored from local client auth:', fallbackId);
    }

    const fetchDeliveryPartnerId = async () => {
      try {
        const response = await deliveryAPI.getMe();
        if (response.data?.success && response.data.data) {
          const deliveryPartner = response.data.data.user || response.data.data.deliveryPartner;
          if (deliveryPartner) {
            const id = deliveryPartner.id?.toString() || 
                      deliveryPartner._id?.toString() || 
                      deliveryPartner.deliveryId;
            if (id) {
              setDeliveryPartnerId(id);
              debugLog('? Delivery Partner ID fetched:', id);
            } else {
              debugWarn('?? Could not extract delivery partner ID from response');
            }
          } else {
            debugWarn('?? No delivery partner data in API response');
          }
        } else {
          debugWarn('?? Could not fetch delivery partner ID from API');
        }
      } catch (error) {
        debugError('Error fetching delivery partner:', error);
      }
    };
    fetchDeliveryPartnerId();
  }, []);

  // Socket connection effect.
  //
  // deps [] on purpose: the connection must outlive deliveryPartnerId resolving. The server
  // decodes identity from the JWT and auto-joins the role room, so the id is only needed for
  // the explicit `join-delivery` — which the room effect below handles on the live socket.
  useEffect(() => {
    const created = createRealtimeSocket({
      apiBaseUrl: API_BASE_URL,
      module: 'delivery',
      log: debugLog,
      warn: debugWarn,
      onAuthFatal: () => {
        debugError('Socket auth could not be recovered — re-login required.');
        setIsConnected(false);
      },
    });

    if (!created) {
      setIsConnected(false);
      return undefined;
    }

    const { socket, destroy } = created;
    socketRef.current = socket;

    // Cursor sync: recovers anything the live channel dropped while this app was backgrounded,
    // offline, or killed. Replayed events are routed to the SAME handlers as live ones.
    const syncEngine = createSyncEngine({
      socket,
      module: 'delivery',
      log: debugLog,
      warn: debugWarn,
      onEvent: (type, payload, meta) => {
        if (type === 'new_order' || type === 'new_order_available') {
          applyOrderOfferRef.current?.(payload, { replayed: meta.replayed });
        }
        // Other event types fall through: the resync/getCurrentDelivery path below still
        // reconciles trip state, so nothing regresses while coverage grows.
      },
    });
    syncRef.current = syncEngine;

    socketRef.current.on('connect', () => {
      debugLog('Socket connected', {
        socketId: socketRef.current?.id,
        deliveryPartnerId: deliveryPartnerIdRef.current,
        transport: socketRef.current?.io?.engine?.transport?.name || 'unknown',
      });
      setIsConnected(true);

      joinedDeliveryRoomRef.current = null;
      if (!joinDeliveryRoomIfPossible()) {
        debugLog('Socket connected before deliveryPartnerId was ready; the room effect will join.');
      }
      debugLog('Requesting resync after connect', {
        deliveryPartnerId: deliveryPartnerIdRef.current,
        socketId: socketRef.current?.id,
      });
      socketRef.current.emit('resync');
      void recoverDeliveryStateRef.current?.();
    });

    socketRef.current.on('delivery-room-joined', (data) => {
      debugLog('Delivery room joined successfully', data);
    });

    socketRef.current.on('resync_complete', (data) => {
      debugLog('Resync completed', data);
    });

    // Auth-specific handshake failures (AUTH_MISSING / AUTH_INVALID) are handled inside
    // createRealtimeSocket, which refreshes the token and retries. This handler is for
    // reporting only.
    socketRef.current.on('connect_error', (error) => {
      debugError('Socket connection error', {
        message: error?.message,
        type: error?.type,
        description: error?.description,
        context: error?.context,
        data: error?.data,
        apiBaseUrl: API_BASE_URL,
        deliveryPartnerId: deliveryPartnerIdRef.current,
        transport: socketRef.current?.io?.engine?.transport?.name || 'unknown',
      });
      setIsConnected(false);
    });

    socketRef.current.on('disconnect', (reason) => {
      debugWarn('Socket disconnected', {
        reason,
        socketId: socketRef.current?.id,
        deliveryPartnerId: deliveryPartnerIdRef.current,
      });
      setIsConnected(false);
      joinedDeliveryRoomRef.current = null;

      if (reason === 'io server disconnect') {
        socketRef.current.connect();
      }
    });

    socketRef.current.on('reconnect_attempt', (attemptNumber) => {
      debugWarn('Reconnection attempt', {
        attemptNumber,
        deliveryPartnerId: deliveryPartnerIdRef.current,
      });
    });

    socketRef.current.on('reconnect', (attemptNumber) => {
      debugLog('Socket reconnected', {
        attemptNumber,
        socketId: socketRef.current?.id,
        deliveryPartnerId: deliveryPartnerIdRef.current,
        transport: socketRef.current?.io?.engine?.transport?.name || 'unknown',
      });
      setIsConnected(true);

      joinedDeliveryRoomRef.current = null;
      joinDeliveryRoomIfPossible();
      socketRef.current.emit('resync');
      void recoverDeliveryStateRef.current?.();
    });

    /**
     * Apply an order offer. Shared by the live socket event and by sync replay, so a rider who
     * was offline when the offer fired ends up in exactly the same state as one who was online.
     * Must stay idempotent — the same offer legitimately arrives both ways.
     */
    const applyOrderOffer = (orderData, { replayed = false } = {}) => {
      debugLog(replayed ? 'Order offer recovered via sync' : 'New order received via socket', {
        orderId: orderData?.orderId || orderData?.orderMongoId || orderData?._id,
        dispatchStatus: orderData?.dispatch?.status,
      });
      setNewOrder(orderData);
      handleIncomingOrderAlert(orderData);
    };
    applyOrderOfferRef.current = applyOrderOffer;

    socketRef.current.on('new_order', (orderData) => {
      if (syncRef.current?.noteLiveEvent(orderData)) return; // already applied via sync
      applyOrderOffer(orderData);
    });

    // Listen for priority-based order notifications (new_order_available)
    socketRef.current.on('new_order_available', (orderData) => {
      if (syncRef.current?.noteLiveEvent(orderData)) return;
      applyOrderOffer(orderData);
    });
    
    socketRef.current.on('shareable_order_available', (orderData) => {
      console.log('[SocketDebug] Frontend received shareable_order_available:', orderData);
      debugLog('Shareable order available received via socket', orderData);
      // We show this as a new type of alert
      setSharedOrder(orderData);
      handleIncomingOrderAlert(orderData);
    });

    socketRef.current.on('play_notification_sound', (data) => {
      debugLog('play_notification_sound received', {
        orderId: data?.orderId || data?.orderMongoId || data?.order_id,
      });
      const normalizedData = {
        orderId: data?.orderId || data?.order_id,
        orderMongoId: data?.orderMongoId || data?.order_mongo_id,
        ...data
      };
      // Force immediate buzz for notification events, even if dedupe would skip.
      activeOrderRef.current = normalizedData || { id: Date.now() };
      playNotificationSound(normalizedData);
      startAlertLoop(playNotificationSound);
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        showBackgroundOrderNotification(normalizedData);
      }
      handleIncomingOrderAlert(normalizedData);
    });

    socketRef.current.on('order_ready', (orderData) => {
      debugLog('order_ready received via socket', {
        orderId: orderData?.orderId || orderData?.orderMongoId || orderData?._id,
      });
      setOrderReady(orderData);
      playNotificationSound(orderData);
    });

    socketRef.current.on('order_status_update', (statusData) => {
      debugLog('?? Delivery order status update received via socket:', statusData);
      setOrderStatusUpdate(statusData || null);
      
      // If the order in status update is the same as sharedOrder, and it's delivered/cancelled, clear it.
      const status = String(statusData?.status || statusData?.orderStatus || '').toLowerCase();
      const updatedId = statusData?._id || statusData?.orderId || statusData?.orderMongoId;
      // Read through a ref: this listener is registered once, so closing over `sharedOrder`
      // would pin it to its value at mount.
      const currentShared = sharedOrderRef.current;
      const sharedId = currentShared?.orderId || currentShared?._id || currentShared?.orderMongoId;
      
      if (updatedId && sharedId && String(updatedId) === String(sharedId)) {
        if (
          status === 'delivered' ||
          status === 'deleted' ||
          status === 'cancelled' ||
          status.startsWith('cancelled_')
        ) {
          setSharedOrder(null);
          stopAlertLoop();
        }
      }
    });

    socketRef.current.on('order_cancelled', (statusData) => {
      debugLog('?? Delivery order cancelled event received via socket:', statusData);
      setOrderStatusUpdate({
        ...(statusData || {}),
        status: 'cancelled',
        orderStatus: statusData?.orderStatus || 'cancelled_by_admin',
      });
    });

    socketRef.current.on('order_deleted', (statusData) => {
      debugLog('?? Delivery order deleted event received via socket:', statusData);
      setOrderStatusUpdate({
        ...(statusData || {}),
        status: 'deleted'
      });
    });

    socketRef.current.on('order_reassigned_elsewhere', (data) => {
      debugLog('?? Order reassigned to another partner:', data);
      stopAlertLoop();
      activeOrderRef.current = null;
      setNewOrder(null);
      if (data?.orderId) setClaimedOrderId(data.orderId);
    });

    // Backend emits 'order_claimed' when another delivery boy accepts an offered order
    socketRef.current.on('order_claimed', (data) => {
      console.log('[SocketDebug] Frontend received order_claimed:', data);
      debugLog('?? order_claimed received - order taken by another partner:', data);
      stopAlertLoop();
      activeOrderRef.current = null;
      setNewOrder(null);
      setSharedOrder(null); // Clear shared order too!
      const claimedId = data?.orderId || data?.orderMongoId || data?.order_id;
      if (claimedId) setClaimedOrderId(claimedId);
    });

    // Taxi rides: offers, closed offers and passenger cancellations arrive on this same socket.
    attachTaxiRideListeners(socketRef.current, {
      onOffer: (job) => applyOrderOffer(job),
      onClosed: (rideId) => {
        stopAlertLoop();
        activeOrderRef.current = null;
        setNewOrder((current) => (current && String(current._id) === String(rideId) ? null : current));
        if (rideId) setClaimedOrderId(rideId);
      },
      onCancelled: (rideId, payload) => {
        if (!rideId) return;
        setOrderStatusUpdate({
          orderId: String(rideId),
          orderMongoId: String(rideId),
          status: 'cancelled',
          orderStatus: 'cancelled',
          message: payload?.message || 'The passenger cancelled this ride',
        });
      },
    });

    socketRef.current.on('admin_notification', (payload) => {
      debugLog('Admin broadcast received via socket', payload);
      setAdminNotification(payload);
      dispatchNotificationInboxRefresh();
    });

    // Token refresh / auth-change handling now lives in createRealtimeSocket, so the socket
    // adopts a new token without the hook having to rebuild it.

    // Re-sync whenever the app comes back to the foreground — a backgrounded webview can miss
    // events without the socket ever reporting a disconnect.
    const handleWindowFocus = () => {
      void recoverDeliveryStateRef.current?.();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void recoverDeliveryStateRef.current?.();
      }
    };

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Liveness ping so dispatch can tell a connected-but-idle rider from a ghost whose app was
    // killed while availabilityStatus still said 'online'. Cheap: no payload, no response.
    const heartbeat = window.setInterval(() => {
      if (socketRef.current?.connected) {
        socketRef.current.emit('heartbeat');
      }
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      debugLog('Cleaning up socket connection...');
      stopAlertLoop();
      joinedDeliveryRoomRef.current = null;
      window.clearInterval(heartbeat);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      syncEngine.destroy();
      syncRef.current = null;
      destroy();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Room effect: joins on the already-open socket once the partner id resolves. Kept separate
  // from the connection effect so an id arriving late can never cause a reconnect.
  useEffect(() => {
    if (!deliveryPartnerId) {
      debugLog('Waiting for deliveryPartnerId before joining the delivery room...');
      return;
    }

    joinDeliveryRoomIfPossible();

    if (socketRef.current?.connected) {
      debugLog('Requesting resync after deliveryPartnerId resolved', {
        deliveryPartnerId,
        socketId: socketRef.current?.id,
      });
      socketRef.current.emit('resync');
      void recoverDeliveryState();
    }
  }, [deliveryPartnerId, joinDeliveryRoomIfPossible, recoverDeliveryState]);

  // Helper functions
  const clearNewOrder = () => {
    stopAlertLoop();
    activeOrderRef.current = null;
    setNewOrder(null);
  };

  const clearClaimedOrderId = () => setClaimedOrderId(null);

  const clearOrderReady = () => {
    setOrderReady(null);
  };

  const clearOrderStatusUpdate = () => {
    setOrderStatusUpdate(null);
  };

  const clearAdminNotification = () => {
    setAdminNotification(null);
  };

  const clearSharedOrder = () => {
    stopAlertLoop();
    activeOrderRef.current = null;
    setSharedOrder(null);
  };

  const emitLocation = useCallback((data) => {
    if (socketRef.current && socketRef.current.connected) {
      // A taxi ride follows the rider on the ride's own room, not the food tracking room.
      const heldRide = useDeliveryStore.getState().activeOrder;
      if (isTaxiRide(heldRide) && String(data?.orderId) === String(heldRide._id)) {
        socketRef.current.emit('ride:driver-location:update', {
          rideId: String(heldRide._id),
          coordinates: [Number(data.lng), Number(data.lat)],
          heading: data.heading,
          speed: data.speed,
          accuracy: data.accuracy,
          timestamp: Date.now(),
        });
        return true;
      }
      // debugLog('? Emitting location via socket:', data);
      socketRef.current.emit('update-location', data);
      return true;
    }
    return false;
  }, []);

  return {
    newOrder,
    clearNewOrder,
    orderReady,
    clearOrderReady,
    orderStatusUpdate,
    clearOrderStatusUpdate,
    adminNotification,
    clearAdminNotification,
    claimedOrderId,
    clearClaimedOrderId,
    sharedOrder,
    clearSharedOrder,
    isConnected,
    socket: socketRef.current,
    playNotificationSound,
    emitLocation
  };
};


