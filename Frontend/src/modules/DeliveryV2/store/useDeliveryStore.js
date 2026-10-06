import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * @typedef {Object} Location
 * @property {number} lat
 * @property {number} lng
 */

/**
 * @typedef {Object} ActiveOrder
 * @property {string} orderId
 * @property {string} status
 * @property {Location} restaurantLocation
 * @property {Location} customerLocation
 * @property {number} orderAmount
 */

/**
 * Stable key for an order across every shape the backend and sockets use for it.
 * Food sends `_id`, sockets send `orderMongoId`, Quick Commerce payloads use `orderId`.
 */
export const orderKeyOf = (order) =>
  String(order?._id || order?.orderMongoId || order?.orderId || order?.order_id || '');

/** Every id a given order may be referred to by - used to match socket events to an order. */
export const orderAliasesOf = (order) =>
  [order?._id, order?.orderMongoId, order?.orderId, order?.order_id]
    .filter(Boolean)
    .map((id) => String(id));

/**
 * useDeliveryStore - Professional Zustand store for Delivery V2
 * Handles Trip Lifecycle, Rider Status, and Admin Settings.
 *
 * ORDER STACKING
 * --------------
 * A rider may hold several accepted orders at once (backend default: 2) and deliver them in one
 * run. `activeOrders` is that whole set; `activeOrder` is the one the UI is currently driving -
 * the map route, the pickup/drop sheets and the proximity checks all follow it, exactly as they
 * did when a rider could only ever have one trip. Every pre-existing reader of `activeOrder` /
 * `tripStatus` therefore keeps working unchanged; only the focus actions below are new.
 *
 * `tripStatusByOrder` remembers each held order's own stage, so switching focus from order A
 * (picked up, heading to drop) to order B (heading to the restaurant) restores B's real stage
 * instead of leaking A's.
 */
export const useDeliveryStore = create(
  persist(
    (set, get) => ({
      // --- Rider Status ---
      isOnline: false,
      riderLocation: null, // { lat, lng }

      // --- Trip State ---
      activeOrder: null, // ActiveOrder | null - the focused trip
      activeOrders: [], // ActiveOrder[] - every trip in hand (order stacking)
      focusedOrderId: null, // orderKeyOf(activeOrder)
      tripStatusByOrder: {}, // { [orderKey]: tripStatus } - per-order stage
      tripStatus: 'IDLE', // 'IDLE' | 'PICKING_UP' | 'REACHED_PICKUP' | 'PICKED_UP' | 'DELIVERING' | 'REACHED_DROP' | 'COMPLETED'

      /** Rider capacity reported by the backend: { maxConcurrentOrders, ordersInHand, ... } */
      orderCapacity: null,

      // --- Admin / Business Settings ---
      settings: {
        pickupRangeLimit: 500, // meters, fallback default
        deliveryRangeLimit: 500, // meters, fallback default
      },

      // --- Actions ---
      toggleOnline: () => set((state) => ({ isOnline: !state.isOnline })),

      setOnline: (online) => set({ isOnline: online }),

      setRiderLocation: (location) => set({ riderLocation: location }),

      setSettings: (newSettings) => set((state) => ({
        settings: { ...state.settings, ...newSettings }
      })),

      setOrderCapacity: (capacity) => set({ orderCapacity: capacity || null }),

      /**
       * Add or update one held order and focus it.
       *
       * Passing null clears the focused trip (legacy behaviour kept for existing callers).
       * When the incoming order is NOT the one already focused, the trip status comes from that
       * order's own remembered stage rather than inheriting the previous order's - otherwise
       * accepting a second order while the first is picked up would drop the new rider straight
       * onto a drop screen.
       */
      setActiveOrder: (order) => set((state) => {
        if (!order) {
          return {
            activeOrder: null,
            focusedOrderId: null,
            tripStatus: 'IDLE',
          };
        }

        const key = orderKeyOf(order);
        const isSameOrder = key && key === state.focusedOrderId;
        const nextTripStatus = isSameOrder
          ? (state.tripStatus === 'IDLE' ? 'PICKING_UP' : state.tripStatus)
          : (state.tripStatusByOrder[key] || 'PICKING_UP');

        const existingIndex = state.activeOrders.findIndex((o) => orderKeyOf(o) === key);
        const activeOrders = existingIndex >= 0
          ? state.activeOrders.map((o, i) => (i === existingIndex ? order : o))
          : [...state.activeOrders, order];

        return {
          activeOrder: order,
          activeOrders,
          focusedOrderId: key || null,
          tripStatus: nextTripStatus,
          tripStatusByOrder: key
            ? { ...state.tripStatusByOrder, [key]: nextTripStatus }
            : state.tripStatusByOrder,
        };
      }),

      /**
       * Replace the whole held-order set from a server sync.
       *
       * Keeps the current focus when that order is still in hand, so a background refresh never
       * yanks the rider off the trip they are looking at. Per-order stages for orders that are
       * no longer held are dropped so the map cannot keep a finished trip's state alive.
       */
      setActiveOrders: (orders, options = {}) => set((state) => {
        const list = (Array.isArray(orders) ? orders : []).filter((o) => orderKeyOf(o));
        if (list.length === 0) {
          return {
            activeOrder: null,
            activeOrders: [],
            focusedOrderId: null,
            tripStatus: 'IDLE',
            tripStatusByOrder: {},
          };
        }

        const keys = list.map((o) => orderKeyOf(o));
        const preferred = options.focusOrderId ? String(options.focusOrderId) : null;
        const nextFocusId =
          (preferred && keys.includes(preferred) && preferred) ||
          (state.focusedOrderId && keys.includes(state.focusedOrderId) && state.focusedOrderId) ||
          keys[0];
        const focused = list[keys.indexOf(nextFocusId)];

        const tripStatusByOrder = {};
        for (const key of keys) {
          tripStatusByOrder[key] = state.tripStatusByOrder[key] || 'PICKING_UP';
        }

        return {
          activeOrder: focused,
          activeOrders: list,
          focusedOrderId: nextFocusId,
          tripStatus: tripStatusByOrder[nextFocusId],
          tripStatusByOrder,
        };
      }),

      /** Switch which held order the map and action sheets are driving. */
      focusOrder: (orderId) => set((state) => {
        const key = String(orderId || '');
        const found = state.activeOrders.find((o) => orderKeyOf(o) === key);
        if (!found || key === state.focusedOrderId) return {};
        return {
          activeOrder: found,
          focusedOrderId: key,
          tripStatus: state.tripStatusByOrder[key] || 'PICKING_UP',
        };
      }),

      updateTripStatus: (status) => set((state) => ({
        tripStatus: status,
        tripStatusByOrder: state.focusedOrderId
          ? { ...state.tripStatusByOrder, [state.focusedOrderId]: status }
          : state.tripStatusByOrder,
      })),

      /**
       * Finish the focused trip only, then promote the next held order.
       *
       * Pre-stacking this cleared the single trip outright; it still does when nothing else is
       * in hand, so existing "trip over" call sites behave the same. With a second order stacked
       * the rider is handed straight onto it instead of being dropped back to an idle screen.
       */
      clearActiveOrder: () => set((state) => {
        const closingId = state.focusedOrderId;
        const remaining = state.activeOrders.filter((o) => orderKeyOf(o) !== closingId);

        const tripStatusByOrder = { ...state.tripStatusByOrder };
        if (closingId) delete tripStatusByOrder[closingId];

        if (remaining.length === 0) {
          return {
            activeOrder: null,
            activeOrders: [],
            focusedOrderId: null,
            tripStatus: 'IDLE',
            tripStatusByOrder: {},
          };
        }

        const nextFocus = remaining[0];
        const nextKey = orderKeyOf(nextFocus);
        return {
          activeOrder: nextFocus,
          activeOrders: remaining,
          focusedOrderId: nextKey,
          tripStatus: tripStatusByOrder[nextKey] || 'PICKING_UP',
          tripStatusByOrder,
        };
      }),

      /** Hard reset of all held trips - logout, or the server reporting no active work. */
      clearAllActiveOrders: () => set({
        activeOrder: null,
        activeOrders: [],
        focusedOrderId: null,
        tripStatus: 'IDLE',
        tripStatusByOrder: {},
      }),

      /** Drop one specific held order (cancelled, or reassigned away from this rider). */
      removeActiveOrder: (orderId) => set((state) => {
        const key = String(orderId || '');
        if (!key) return {};
        const remaining = state.activeOrders.filter((o) => !orderAliasesOf(o).includes(key));
        if (remaining.length === state.activeOrders.length) return {};

        const tripStatusByOrder = { ...state.tripStatusByOrder };
        delete tripStatusByOrder[key];

        const stillFocused = remaining.some((o) => orderKeyOf(o) === state.focusedOrderId);
        if (stillFocused) {
          return { activeOrders: remaining, tripStatusByOrder };
        }

        if (remaining.length === 0) {
          return {
            activeOrder: null,
            activeOrders: [],
            focusedOrderId: null,
            tripStatus: 'IDLE',
            tripStatusByOrder: {},
          };
        }

        const nextFocus = remaining[0];
        const nextKey = orderKeyOf(nextFocus);
        return {
          activeOrder: nextFocus,
          activeOrders: remaining,
          focusedOrderId: nextKey,
          tripStatus: tripStatusByOrder[nextKey] || 'PICKING_UP',
          tripStatusByOrder,
        };
      }),

      // --- Selectors / Computed Helper ---
      canAdvanceToPickup: () => {
        const { activeOrder, tripStatus } = get();
        return activeOrder && tripStatus === 'PICKING_UP';
      },

      canAdvanceToDeliver: () => {
        const { activeOrder, tripStatus } = get();
        return activeOrder && tripStatus === 'PICKED_UP';
      },

      /**
       * Can the rider take another order right now?
       *
       * The backend is authoritative (it also counts Quick Commerce jobs and applies the admin
       * setting) and stops offering once the limit is hit. Until a capacity payload has been
       * seen, fall back to the default limit of 2 so a first-load race cannot hide a real offer.
       */
      canStackAnotherOrder: () => {
        const { orderCapacity, activeOrders } = get();
        const max = Number(orderCapacity?.maxConcurrentOrders) || 2;
        const inHand = Number.isFinite(Number(orderCapacity?.ordersInHand))
          ? Math.max(Number(orderCapacity.ordersInHand), activeOrders.length)
          : activeOrders.length;
        return inHand < max;
      }
    }),
    {
      name: 'delivery-v2-online-pref',
      // ONLY persist the 'isOnline' state, ignoring orders/location to prevent dummy order bugs
      partialize: (state) => ({ isOnline: state.isOnline }),
    }
  )
);
