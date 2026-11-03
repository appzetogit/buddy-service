import { useParams, Link, useSearchParams, useNavigate, useLocation } from "react-router-dom"
import React, { useState, useEffect, useMemo, useRef, useCallback, memo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { toast } from "sonner"
import {
  ArrowLeft,
  Share2,
  Star,
  RefreshCw,
  Phone,
  User,
  ChevronRight,
  MapPin,
  Home as HomeIcon,
  MessageSquare,
  X,
  Check,
  Shield,
  Receipt,
  CircleSlash,
  Loader2,
  Clock,
  Calendar
} from "lucide-react"
import AnimatedPage from "@food/components/user/AnimatedPage"
import { Card, CardContent } from "@food/components/ui/card"
import { Button } from "@food/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@food/components/ui/dialog"
import { Textarea } from "@food/components/ui/textarea"
import { useOrders } from "@food/context/OrdersContext"
import { useCart } from "@food/context/CartContext"
import { useProfile } from "@food/context/ProfileContext"
import { useLocation as useUserLocation } from "@food/hooks/useLocation"
import DeliveryTrackingMap from "@food/components/user/DeliveryTrackingMap"
import { orderAPI, restaurantAPI } from "@food/api"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { useUserNotifications } from "@food/hooks/useUserNotifications"
import { RESTAURANT_PIN_SVG, CUSTOMER_PIN_SVG, RIDER_BIKE_SVG } from "@food/constants/mapIcons"
import { resolveEntityId } from "@food/utils/common"

// Fallback definitions in case imports fail at runtime or are shadowed
const DEFAULT_CUSTOMER_PIN = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#10B981"><path d="M12 2C8.13 2 5 5.13 5 9c0 4.17 4.42 9.92 6.24 12.11.4.48 1.08.48 1.52 0C14.58 18.92 19 13.17 19 9c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5 14.5 7.62 14.5 9 13.38 11.5 12 11.5z"/><circle cx="12" cy="9" r="3" fill="#FFFFFF"/></svg>`;
const SAFE_CUSTOMER_PIN = typeof CUSTOMER_PIN_SVG !== 'undefined' ? CUSTOMER_PIN_SVG : DEFAULT_CUSTOMER_PIN;
const DEFAULT_RESTAURANT_PIN = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#FF6B35"><path d="M12 2C8.13 2 5 5.13 5 9c0 4.17 4.42 9.92 6.24 12.11.4.48 1.08.48 1.52 0C14.58 18.92 19 13.17 19 9c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5 14.5 7.62 14.5 9 13.38 11.5 12 11.5z"/><circle cx="12" cy="9" r="3" fill="#FFFFFF"/></svg>`;
const SAFE_RESTAURANT_PIN = typeof RESTAURANT_PIN_SVG !== 'undefined' ? RESTAURANT_PIN_SVG : DEFAULT_RESTAURANT_PIN;

const debugLog = (...args) => console.log('[OrderTracking]', ...args)
const debugWarn = (...args) => console.warn('[OrderTracking]', ...args)
const debugError = (...args) => console.error('[OrderTracking]', ...args)


// Animated checkmark component
const AnimatedCheckmark = ({ delay = 0 }) => (
  <motion.svg
    width="80"
    height="80"
    viewBox="0 0 80 80"
    initial="hidden"
    animate="visible"
    className="mx-auto"
  >
    <motion.circle
      cx="40"
      cy="40"
      r="36"
      fill="none"
      stroke="#22c55e"
      strokeWidth="4"
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
    />
    <motion.path
      d="M24 40 L35 51 L56 30"
      fill="none"
      stroke="#22c55e"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ duration: 0.4, delay: delay + 0.4, ease: "easeOut" }}
    />
  </motion.svg>
)

// Real Delivery Map Component with User Live Location
const DeliveryMap = memo(({ orderId, order, isVisible, fallbackCustomerCoords = null, userLiveCoords = null, userLocationAccuracy = null, onEtaUpdate = null }) => {
  const toPointFromGeoJSON = (coords) => {
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  };

  // Memoize coordinates to prevent re-calculating on every parent render
  const restaurantCoords = useMemo(() => {
    // Try multiple sources for restaurant coordinates
    let coords = null;

    if (order?.restaurantLocation?.coordinates &&
      Array.isArray(order.restaurantLocation.coordinates) &&
      order.restaurantLocation.coordinates.length >= 2) {
      coords = order.restaurantLocation.coordinates;
    }
    else if (order?.restaurantId?.location?.coordinates &&
      Array.isArray(order.restaurantId.location.coordinates) &&
      order.restaurantId.location.coordinates.length >= 2) {
      coords = order.restaurantId.location.coordinates;
    }
    else if (order?.restaurantId?.location?.latitude && order?.restaurantId?.location?.longitude) {
      coords = [order.restaurantId.location.longitude, order.restaurantId.location.latitude];
    }
    else if (Array.isArray(order?.pickups) && order.pickups.length > 0) {
      const pickupLoc = order.pickups.find((p) =>
        Array.isArray(p?.location?.coordinates) && p.location.coordinates.length >= 2
      )?.location;
      if (pickupLoc?.coordinates) {
        coords = pickupLoc.coordinates;
      } else if (pickupLoc?.latitude != null && pickupLoc?.longitude != null) {
        coords = [pickupLoc.longitude, pickupLoc.latitude];
      }
    }

    const fromCoords = toPointFromGeoJSON(coords);
    if (fromCoords) return fromCoords;

    const fallbackLat = Number(order?.restaurantId?.location?.latitude || order?.restaurant?.location?.latitude);
    const fallbackLng = Number(order?.restaurantId?.location?.longitude || order?.restaurant?.location?.longitude);
    if (Number.isFinite(fallbackLat) && Number.isFinite(fallbackLng)) {
      return { lat: fallbackLat, lng: fallbackLng };
    }
    return null;
  }, [order?.restaurantId, order?.restaurantLocation, order?.restaurant, order?.pickups]);

  const customerCoords = useMemo(() => {
    const coords =
      order?.address?.coordinates ||
      order?.address?.location?.coordinates ||
      order?.deliveryAddress?.coordinates ||
      order?.deliveryAddress?.location?.coordinates;
    const fromCoords = toPointFromGeoJSON(coords);
    if (fromCoords) return fromCoords;

    const addr = order?.address || order?.deliveryAddress || {};
    const lat = Number(addr?.location?.latitude ?? addr?.latitude ?? addr?.lat);
    const lng = Number(addr?.location?.longitude ?? addr?.longitude ?? addr?.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }

    if (
      fallbackCustomerCoords &&
      Number.isFinite(fallbackCustomerCoords.lat) &&
      Number.isFinite(fallbackCustomerCoords.lng)
    ) {
      return fallbackCustomerCoords;
    }
    return null;
  }, [order?.address, order?.deliveryAddress, fallbackCustomerCoords]);

  // Delivery boy data
  const deliveryBoyData = useMemo(() => order?.deliveryPartner ? {
    name: order.deliveryPartner.name || 'Delivery Partner',
    avatar: order.deliveryPartner.avatar || null
  } : null, [order?.deliveryPartner]);

  const effectiveCustomerCoords = useMemo(() => {
    if (customerCoords) return customerCoords;
    if (userLiveCoords && Number.isFinite(userLiveCoords.lat) && Number.isFinite(userLiveCoords.lng)) {
      return userLiveCoords;
    }
    if (restaurantCoords) return restaurantCoords;
    return null;
  }, [customerCoords, userLiveCoords, restaurantCoords]);

  const effectiveRestaurantCoords = useMemo(() => {
    if (restaurantCoords) return restaurantCoords;
    if (effectiveCustomerCoords) return effectiveCustomerCoords;
    return null;
  }, [restaurantCoords, effectiveCustomerCoords]);

  // Firebase and backend write tracking under order.orderId (string) or mongoId; subscribe to all so we receive updates
  const orderTrackingIdsList = useMemo(() => [
    order?.orderId,
    order?.mongoId,
    order?._id,
    orderId,
    order?.id
  ].filter(Boolean), [order?.orderId, order?.mongoId, order?._id, orderId, order?.id]);

  if (!isVisible || !orderId || !order || !effectiveRestaurantCoords || !effectiveCustomerCoords) {
    return (
      <div
        className="relative h-[300px] sm:h-[450px] bg-gradient-to-b from-gray-100 to-gray-200 dark:from-[#0a0a0a] dark:to-[#1a1a1a]"
      />
    );
  }

  return (
    <div
      className="relative w-full h-[300px] sm:h-[450px] overflow-visible"
    >
      <DeliveryTrackingMap
        orderId={orderId}
        orderTrackingIds={orderTrackingIdsList}
        restaurantCoords={effectiveRestaurantCoords}
        customerCoords={effectiveCustomerCoords}
        pickups={order?.pickups}
        userLiveCoords={userLiveCoords}
        userLocationAccuracy={userLocationAccuracy}
        deliveryBoyData={deliveryBoyData}
        order={order}
        onEtaUpdate={onEtaUpdate}
      />
    </div>
  );
});

// Section item component
const SectionItem = ({ icon: Icon, iconNode, title, subtitle, onClick, showArrow = true, rightContent }) => (
  <motion.button
    onClick={onClick}
    className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-left border-b border-dashed border-gray-200 dark:border-gray-800 last:border-0"
    whileTap={{ scale: 0.99 }}
  >
    <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0 overflow-hidden">
      {iconNode ? (
        <div
          className="w-6 h-6 flex-shrink-0 flex items-center justify-center [&_svg]:w-full [&_svg]:h-full [&_svg]:block"
        >
          {iconNode}
        </div>
      ) : (
        <Icon className="w-5 h-5 text-gray-600 dark:text-gray-400 flex-shrink-0" />
      )}
    </div>
    <div className="flex-1 min-w-0">
      <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{title}</p>
      {subtitle && <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{subtitle}</p>}
    </div>
    {rightContent || (showArrow && <ChevronRight className="w-5 h-5 text-gray-400 dark:text-gray-500 flex-shrink-0" />)}
  </motion.button>
)

class MapErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    debugError('OrderTracking map render failed:', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="relative h-[300px] sm:h-[450px] bg-gray-100 dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 flex items-center justify-center">
          <p className="text-sm text-gray-600 dark:text-gray-400 px-4 text-center">Live map unavailable right now</p>
        </div>
      )
    }
    return this.props.children
  }
}

const getRestaurantCoordsFromOrder = (apiOrder, fallback = null) => {
  if (
    apiOrder?.restaurantLocation?.coordinates &&
    Array.isArray(apiOrder.restaurantLocation.coordinates) &&
    apiOrder.restaurantLocation.coordinates.length >= 2
  ) {
    return apiOrder.restaurantLocation.coordinates
  }
  if (
    apiOrder?.restaurantId?.location?.coordinates &&
    Array.isArray(apiOrder.restaurantId.location.coordinates) &&
    apiOrder.restaurantId.location.coordinates.length >= 2
  ) {
    return apiOrder.restaurantId.location.coordinates
  }
  if (apiOrder?.restaurantId?.location?.latitude && apiOrder?.restaurantId?.location?.longitude) {
    return [apiOrder.restaurantId.location.longitude, apiOrder.restaurantId.location.latitude]
  }
  if (
    apiOrder?.restaurant?.location?.coordinates &&
    Array.isArray(apiOrder.restaurant.location.coordinates) &&
    apiOrder.restaurant.location.coordinates.length >= 2
  ) {
    return apiOrder.restaurant.location.coordinates
  }
  if (Array.isArray(apiOrder?.pickups)) {
    for (const pickup of apiOrder.pickups) {
      const coords = pickup?.location?.coordinates
      if (Array.isArray(coords) && coords.length >= 2) return coords
      if (pickup?.location?.latitude != null && pickup?.location?.longitude != null) {
        return [pickup.location.longitude, pickup.location.latitude]
      }
    }
  }
  return fallback || null
}

const getRestaurantAddressFromOrder = (apiOrder, previousOrder = null, explicitRestaurantAddress = null) => {
  if (explicitRestaurantAddress && String(explicitRestaurantAddress).trim()) {
    return String(explicitRestaurantAddress).trim()
  }

  const location = apiOrder?.restaurantId?.location || apiOrder?.restaurant?.location || {}

  if (location?.formattedAddress && String(location.formattedAddress).trim()) {
    return String(location.formattedAddress).trim()
  }
  if (location?.address && String(location.address).trim()) {
    return String(location.address).trim()
  }
  if (location?.addressLine1 && String(location.addressLine1).trim()) {
    return String(location.addressLine1).trim()
  }

  const parts = [location?.street, location?.area, location?.city, location?.state, location?.zipCode]
    .map((value) => (value == null ? '' : String(value).trim()))
    .filter(Boolean)

  if (parts.length > 0) return parts.join(', ')

  return previousOrder?.restaurantAddress || apiOrder?.restaurantAddress || apiOrder?.restaurant?.address || 'Restaurant location'
}

const getCustomerCoordsFromApiOrder = (apiOrder, previousOrder = null) => {
  const addr = apiOrder?.address || apiOrder?.deliveryAddress || {}
  const fromLoc = addr?.location?.coordinates
  if (Array.isArray(fromLoc) && fromLoc.length >= 2) return fromLoc
  const flat = addr?.coordinates
  if (Array.isArray(flat) && flat.length >= 2) return flat

  // Some payloads provide plain object coordinates instead of GeoJSON arrays.
  const objectCoord = addr?.location || addr
  const objLat = Number(objectCoord?.lat ?? objectCoord?.latitude)
  const objLng = Number(objectCoord?.lng ?? objectCoord?.longitude)
  if (Number.isFinite(objLat) && Number.isFinite(objLng)) return [objLng, objLat]

  const prev = previousOrder?.address?.coordinates || previousOrder?.address?.location?.coordinates
  if (Array.isArray(prev) && prev.length >= 2) return prev
  return null
}

const transformOrderForTracking = (apiOrder, previousOrder = null, explicitRestaurantCoords = null, explicitRestaurantAddress = null) => {
  const restaurantCoords = explicitRestaurantCoords || getRestaurantCoordsFromOrder(apiOrder, previousOrder?.restaurantLocation?.coordinates)
  const restaurantAddress = getRestaurantAddressFromOrder(apiOrder, previousOrder, explicitRestaurantAddress)
  // API returns `deliveryAddress`; some paths use `address`
  const addr = apiOrder?.address || apiOrder?.deliveryAddress || {}
  const customerCoordsResolved = getCustomerCoordsFromApiOrder(apiOrder, previousOrder)

  return {
    id: apiOrder?.orderId || apiOrder?._id,
    mongoId: apiOrder?._id || null,
    orderId: apiOrder?.orderId || apiOrder?._id,
    restaurant: apiOrder?.restaurantName || previousOrder?.restaurant || 'Restaurant',
    restaurantPhone:
      apiOrder?.restaurantPhone ||
      apiOrder?.restaurantId?.phone ||
      apiOrder?.restaurantId?.ownerPhone ||
      apiOrder?.restaurant?.phone ||
      apiOrder?.restaurant?.ownerPhone ||
      previousOrder?.restaurantPhone ||
      '',
    restaurantAddress,
    restaurantId: apiOrder?.restaurantId || previousOrder?.restaurantId || null,
    userId: apiOrder?.userId || previousOrder?.userId || null,
    userName: apiOrder?.userName || apiOrder?.userId?.name || apiOrder?.userId?.fullName || previousOrder?.userName || '',
    userPhone: apiOrder?.userPhone || apiOrder?.userId?.phone || previousOrder?.userPhone || '',
    address: {
      street: addr?.street || previousOrder?.address?.street || '',
      city: addr?.city || previousOrder?.address?.city || '',
      state: addr?.state || previousOrder?.address?.state || '',
      zipCode: addr?.zipCode || previousOrder?.address?.zipCode || '',
      additionalDetails: addr?.additionalDetails || previousOrder?.address?.additionalDetails || '',
      formattedAddress: addr?.formattedAddress ||
        (addr?.street && addr?.city
          ? `${addr.street}${addr.additionalDetails ? `, ${addr.additionalDetails}` : ''}, ${addr.city}${addr.state ? `, ${addr.state}` : ''}${addr.zipCode ? ` ${addr.zipCode}` : ''}`
          : previousOrder?.address?.formattedAddress || addr?.city || ''),
      coordinates: customerCoordsResolved || addr?.location?.coordinates || previousOrder?.address?.coordinates || null
    },
    restaurantLocation: {
      coordinates: restaurantCoords
    },
    items: apiOrder?.items?.map(item => ({
      itemId: item.itemId || item.id || item._id,
      id: item.itemId || item.id || item._id,
      name: item.name,
      variantName: item.variantName || '',
      quantity: item.quantity,
      price: item.price
    })) || previousOrder?.items || [],
    total: apiOrder?.pricing?.total || previousOrder?.total || 0,
    // Backend canonical field is orderStatus; keep legacy `status` for UI compatibility.
    status: apiOrder?.orderStatus || apiOrder?.status || previousOrder?.status || 'pending',
    deliveryOption: apiOrder?.deliveryOption || previousOrder?.deliveryOption || null,
    deliveryTime: apiOrder?.deliveryTime || previousOrder?.deliveryTime || null,
    estimatedTime:
      apiOrder?.estimatedTime ??
      apiOrder?.estimatedDeliveryTime ??
      previousOrder?.estimatedTime ??
      null,
    estimatedDeliveryTime:
      apiOrder?.estimatedDeliveryTime ??
      apiOrder?.estimatedTime ??
      previousOrder?.estimatedDeliveryTime ??
      null,
    restaurantAcceptedAt:
      apiOrder?.restaurantAcceptedAt ||
      previousOrder?.restaurantAcceptedAt ||
      null,
    deliveryPartner: apiOrder?.deliveryPartnerId || apiOrder?.dispatch?.deliveryPartnerId ? {
      name: (apiOrder.deliveryPartnerId || apiOrder.dispatch?.deliveryPartnerId)?.name
        || (apiOrder.deliveryPartnerId || apiOrder.dispatch?.deliveryPartnerId)?.fullName
        || 'Delivery Partner',
      phone: (apiOrder.deliveryPartnerId || apiOrder.dispatch?.deliveryPartnerId)?.phone
        || (apiOrder.deliveryPartnerId || apiOrder.dispatch?.deliveryPartnerId)?.phoneNumber
        || '',
      avatar: (apiOrder.deliveryPartnerId || apiOrder.dispatch?.deliveryPartnerId)?.avatar
        || (apiOrder.deliveryPartnerId || apiOrder.dispatch?.deliveryPartnerId)?.profileImage
        || null
    } : (previousOrder?.deliveryPartner || null),
    deliveryPartnerId: apiOrder?.deliveryPartnerId?._id || apiOrder?.deliveryPartnerId || apiOrder?.dispatch?.deliveryPartnerId?._id || apiOrder?.dispatch?.deliveryPartnerId || apiOrder?.assignmentInfo?.deliveryPartnerId || null,
    // Dual-driver partners for customer UI (reuse same shape as deliveryPartner)
    deliveryPartners: (() => {
      const toPartner = (ref, role) => {
        if (!ref) return null;
        const id = ref._id || ref.id || (typeof ref === 'string' ? ref : null);
        if (!id && !ref.name && !ref.fullName) return null;
        return {
          id: id ? String(id) : role,
          role,
          name: ref.name || ref.fullName || (role === 'shared' ? 'Partner Rider' : 'Delivery Partner'),
          phone: ref.phone || ref.phoneNumber || '',
          avatar: ref.avatar || ref.profileImage || null,
        };
      };
      const primary = toPartner(
        apiOrder?.dispatch?.deliveryPartnerId || apiOrder?.deliveryPartnerId,
        'primary',
      );
      const shared = toPartner(apiOrder?.dispatch?.sharedPartnerId, 'shared');
      const list = [primary, shared].filter(Boolean);
      if (list.length) return list;
      return previousOrder?.deliveryPartners || (previousOrder?.deliveryPartner
        ? [{ ...previousOrder.deliveryPartner, id: previousOrder.deliveryPartnerId, role: 'primary' }]
        : []);
    })(),
    isDualLeg: Boolean(apiOrder?.isDualLeg || apiOrder?.dispatch?.sharedPartnerId) || previousOrder?.isDualLeg || false,
    legHandoverOtps: (() => {
      const fromApi = Array.isArray(apiOrder?.legHandoverOtps) ? apiOrder.legHandoverOtps : null;
      if (fromApi?.length) return fromApi;
      return previousOrder?.legHandoverOtps || [];
    })(),
    dispatch: apiOrder?.dispatch || previousOrder?.dispatch || null,
    assignmentInfo: apiOrder?.assignmentInfo || previousOrder?.assignmentInfo || null,
    tracking: apiOrder?.tracking || previousOrder?.tracking || {},
    statusHistory: apiOrder?.statusHistory || previousOrder?.statusHistory || [],
    deliveryState: apiOrder?.deliveryState || previousOrder?.deliveryState || null,
    scheduledAt: apiOrder?.scheduledAt || previousOrder?.scheduledAt || null,
    createdAt: apiOrder?.createdAt || previousOrder?.createdAt || null,
    totalAmount: apiOrder?.pricing?.total || apiOrder?.totalAmount || previousOrder?.totalAmount || 0,
    deliveryFee: apiOrder?.pricing?.deliveryFee || apiOrder?.deliveryFee || previousOrder?.deliveryFee || 0,
    gst: apiOrder?.pricing?.tax || apiOrder?.pricing?.gst || apiOrder?.gst || apiOrder?.tax || previousOrder?.gst || 0,
    packagingFee: apiOrder?.pricing?.packagingFee || apiOrder?.packagingFee || 0,
    platformFee: apiOrder?.pricing?.platformFee || apiOrder?.platformFee || 0,
    discount: apiOrder?.pricing?.discount || apiOrder?.discount || 0,
    subtotal: apiOrder?.pricing?.subtotal || apiOrder?.subtotal || 0,
    paymentMethod: apiOrder?.paymentMethod || apiOrder?.payment?.method || previousOrder?.paymentMethod || null,
    payment: apiOrder?.payment || previousOrder?.payment || null,
    // Preserve delivery OTP code received via socket event.
    // API responses intentionally strip the secret code for security,
    // so without preserving it the UI would lose the OTP on each poll refresh.
    deliveryVerification: (() => {
      const prevDV = previousOrder?.deliveryVerification || null
      const apiDV = apiOrder?.deliveryVerification || null
      const handoverOtp = apiOrder?.handoverOtp || null
      
      if (!prevDV && !apiDV && !handoverOtp) return null

      const prevDropOtp = prevDV?.dropOtp || null
      const apiDropOtp = apiDV?.dropOtp || null
      
      const merged = {
        ...(prevDV || {}),
        ...(apiDV || {})
      }

      // Prioritize: 1. Real-time handoverOtp from current API response
      // 2. Previously preserved code in local state (from socket or earlier poll)
      // 3. Nested code field in API response (if ever present)
      // Dual-leg: never stash a single handover code — that couples both drivers.
      const isDual = Boolean(apiOrder?.isDualLeg) ||
        (Array.isArray(apiOrder?.legHandoverOtps) && apiOrder.legHandoverOtps.length > 1) ||
        (Array.isArray(previousOrder?.legHandoverOtps) && previousOrder.legHandoverOtps.length > 1)
      const finalCode = isDual
        ? null
        : (handoverOtp || prevDropOtp?.code || apiDropOtp?.code)

      if (finalCode || prevDropOtp?.required || apiDropOtp?.required) {
        merged.dropOtp = {
          ...(prevDropOtp || {}),
          ...(apiDropOtp || {}),
          ...(finalCode ? { code: finalCode } : {}),
        }
      }
      // Preserve multi-leg OTP codes across polls
      if (Array.isArray(apiOrder?.legHandoverOtps) && apiOrder.legHandoverOtps.length) {
        merged.legOtps = apiOrder.legHandoverOtps
      } else if (Array.isArray(prevDV?.legOtps) && prevDV.legOtps.length) {
        merged.legOtps = prevDV.legOtps
      }
      return merged
    })(),
    isMultiRestaurant: apiOrder?.isMultiRestaurant || (apiOrder?.pickups?.length > 1) || previousOrder?.isMultiRestaurant || false,
    pickups: apiOrder?.pickups || previousOrder?.pickups || [],
    partialRefunds: apiOrder?.partialRefunds || previousOrder?.partialRefunds || [],
    cancellationReason: apiOrder?.cancellationReason || previousOrder?.cancellationReason || null,
    ratings: apiOrder?.ratings || previousOrder?.ratings || {},
    restaurantRating: apiOrder?.ratings?.restaurant?.rating || apiOrder?.restaurantRating || previousOrder?.restaurantRating || null,
    deliveryPartnerRating: apiOrder?.ratings?.deliveryPartner?.rating || apiOrder?.deliveryPartnerRating || previousOrder?.deliveryPartnerRating || null,
    delayContext: apiOrder?.delayContext || previousOrder?.delayContext || null,
    riderToRestaurantDistanceKm:
      apiOrder?.riderToRestaurantDistanceKm ??
      previousOrder?.riderToRestaurantDistanceKm ??
      null,
    failureReason: apiOrder?.failureReason || previousOrder?.failureReason || null,
  }
}

/**
 * Backend uses `orderStatus` (created, confirmed, preparing, ready_for_pickup, picked_up, delivered, cancelled_*).
 * This page used to read legacy `status` only — so UI never updated. Map canonical + legacy values to tracking steps.
 */
function mapBackendOrderStatusToUi(raw) {
  const s = String(raw || "").toLowerCase()
  if (!s || s === "pending" || s === "created") return "placed"
  if (s === "confirmed" || s === "accepted") return "confirmed"
  if (s === "preparing" || s === "processed") return "preparing"
  if (s === "ready" || s === "ready_for_pickup" || s === "reached_pickup" || s === "order_confirmed") return "ready"
  if (s === "picked_up" || s === "out_for_delivery" || s === "en_route_to_delivery") return "on_way"
  if (s === "reached_drop" || s === "at_drop" || s === "at_delivery") return "at_drop"
  if (s === "delivered" || s === "completed") return "delivered"
  if (s.includes("cancelled") || s === "cancelled") return "cancelled"
  return "placed"
}

function mapOrderToTrackingUiStatus(orderLike) {
  if (!orderLike) return "placed"
  const statusRaw = orderLike.status || orderLike.orderStatus
  const phase = orderLike.deliveryState?.currentPhase

  // Terminal states handled first
  if (isFoodOrderCancelledStatus(statusRaw)) return "cancelled"
  if (statusRaw === "delivered" || statusRaw === "completed") return "delivered"

  const isRiderAccepted = orderLike.dispatch?.status === "accepted" || orderLike.assignmentInfo?.status === "accepted" || orderLike.deliveryPartner?.status === "accepted";
  const isSearchingDriver = !isRiderAccepted && ["created", "scheduled", "placed", "pending"].includes(String(statusRaw || "").toLowerCase())

  if (isSearchingDriver) return "finding_driver"
  if (isRiderAccepted && ["created", "scheduled", "placed", "pending"].includes(String(statusRaw || "").toLowerCase())) {
    return "awaiting_restaurant"
  }
  
  if (phase === "reached_drop" || phase === "at_drop" || statusRaw === "at_drop") return "at_drop"
  if (phase === "en_route_to_delivery" || statusRaw === "picked_up" || statusRaw === "out_for_delivery") return "on_way"
  if (phase === "at_pickup" && orderLike.deliveryPartnerId && isRiderAccepted) return "at_pickup"
  if (phase === "en_route_to_pickup" && orderLike.deliveryPartnerId && isRiderAccepted) return "assigned"

  // Fallback to basic status mapping
  return mapBackendOrderStatusToUi(statusRaw)
}

/** Prefer live delivery phase when present (socket / polling include deliveryState). */
function isFoodOrderCancelledStatus(statusRaw) {
  const s = String(statusRaw || "").toLowerCase()
  return s === "cancelled" || s.includes("cancelled")
}

function normalizeLookupId(value) {
  if (value == null) return ""
  const raw = String(value).trim()
  if (!raw || raw === "undefined" || raw === "null") return ""
  return raw
}

const StatusBanner = ({ order }) => {
  const status = mapOrderToTrackingUiStatus(order);
  const phase = order?.deliveryState?.currentPhase;
  const delayReason = order?.delayContext?.reason;

  const getConsolingMessage = () => {
    if (status === 'delivered') return "Order delivered! Enjoy your meal. 😋";
    if (status === 'cancelled') {
      if (order?.failureReason === 'driver_not_found' || String(order?.cancellationReason || '').toLowerCase().includes('no delivery partner')) {
        return "We couldn't find a delivery partner near you. Your order was cancelled and any paid amount will be refunded.";
      }
      if (order?.failureReason === 'restaurant_rejected' || String(order?.cancellationReason || '').toLowerCase().includes('3 times')) {
        return "The restaurant couldn't accept this order after 3 attempts. Your order was cancelled and any paid amount will be refunded.";
      }
      return "This order was cancelled.";
    }

    if (status === 'finding_driver') return "Fetching a delivery partner near the restaurant... 🛵";
    if (status === 'awaiting_restaurant') return "Delivery partner assigned! Waiting for the restaurant to accept your order. 🍽️";

    const speedEta =
      String(order?.deliveryTime || '').trim() ||
      (Number(order?.estimatedTime) > 0 ? `${Number(order.estimatedTime)} mins` : '');

    // Logic for delay reasons
    if (delayReason) {
      if (delayReason.toLowerCase().includes('traffic')) {
        return `Our partner is stuck in heavy traffic but is doing their best to reach you. 🚦`;
      }
      if (delayReason.toLowerCase().includes('busy') || delayReason.toLowerCase().includes('queue')) {
        return `The restaurant is a bit busy today. Your food is being prepared with extra care! 👨‍🍳`;
      }
      return `Update: ${delayReason}`;
    }

    // Phase-based consoling
    switch (phase) {
      case 'at_pickup':
        return "Rider has reached the restaurant. Your food is being packed! 🛍️";
      case 'en_route_to_pickup':
        if (typeof order?.riderToRestaurantDistanceKm === 'number') {
          const km = order.riderToRestaurantDistanceKm;
          const distanceText = km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(km * 1000)} m`;
          return `Your delivery partner is ${distanceText} away from the restaurant. 🛵`;
        }
        return "Our partner is on the way to pick up your order. 🛵";
      case 'en_route_to_delivery':
        return "Fresh food is on its way to your doorstep! 🏎️";
      case 'at_drop':
        return "Our partner has arrived at your location! Please be ready. 📍";
      default:
        if (status === 'confirmed') {
          return speedEta
            ? `Restaurant accepted your order. Estimated delivery: ${speedEta}. 🍽️`
            : "Restaurant has accepted your order and started preparing. 🍽️";
        }
        if (status === 'preparing') {
          return speedEta
            ? `The chef is preparing your meal. Estimated delivery: ${speedEta}. 🍳`
            : "The chef is preparing your delicious meal... 🍳";
        }
        if (status === 'ready') return "Food is ready! Waiting for rider to start delivery. ✨";
        return "We've received your order and are processing it. 📝";
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-orange-50 dark:bg-orange-950/20 border-b border-orange-100 dark:border-orange-900/50 p-4"
    >
      <div className="max-w-screen-xl mx-auto flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center flex-shrink-0 animate-pulse">
          <Clock className="w-4 h-4 text-white" />
        </div>
        <p className="text-sm font-medium text-orange-900 dark:text-orange-200">
          {getConsolingMessage()}
        </p>
      </div>
    </motion.div>
  );
};

export default function OrderTracking() {
  const companyName = useCompanyName()
  const navigate = useNavigate()
  const location = useLocation()
  const { replaceCart } = useCart()
  const { orderId } = useParams()
  const [searchParams] = useSearchParams()
  const confirmed = searchParams.get("confirmed") === "true"
  const { getOrderById } = useOrders()
  const { profile, getDefaultAddress } = useProfile()
  const { location: userLiveLocation } = useUserLocation()

  const { isConnected: isSocketConnected } = useUserNotifications()
  
  // State for order data
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [showConfirmation, setShowConfirmation] = useState(confirmed)
  const [estimatedTime, setEstimatedTime] = useState(29)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [showOrderDetails, setShowOrderDetails] = useState(false)
  const [cancellationReason, setCancellationReason] = useState("")
  const [refundDestination, setRefundDestination] = useState("wallet")
  const [isCancelling, setIsCancelling] = useState(false)
  const [isInstructionsModalOpen, setIsInstructionsModalOpen] = useState(false)
  const [deliveryInstructions, setDeliveryInstructions] = useState("")
  const [isUpdatingInstructions, setIsUpdatingInstructions] = useState(false)
  const [resolvedLookupId, setResolvedLookupId] = useState("")
  const [timerNow, setTimerNow] = useState(Date.now())
  
  // Rating states
  const [showRatingModal, setShowRatingModal] = useState(false)
  const [selectedRestaurantRating, setSelectedRestaurantRating] = useState(null)
  const [selectedDeliveryRating, setSelectedDeliveryRating] = useState(null)
  const [restaurantFeedbackText, setRestaurantFeedbackText] = useState("")
  const [deliveryFeedbackText, setDeliveryFeedbackText] = useState("")
  const [submittingRating, setSubmittingRating] = useState(false)

  // Check if order is already rated
  const hasRestaurantRating = Number.isFinite(Number(order?.ratings?.restaurant?.rating || order?.restaurantRating))
  const hasDeliveryPartner = !!(order?.deliveryPartnerId || order?.deliveryPartnerName)
  const hasDeliveryRating = Number.isFinite(Number(order?.ratings?.deliveryPartner?.rating || order?.deliveryPartnerRating))
  const isOrderRated = hasRestaurantRating && (!hasDeliveryPartner || hasDeliveryRating)
  const ratingPromptedRef = useRef(false)

  const handleOpenRating = () => {
    setSelectedRestaurantRating(order?.ratings?.restaurant?.rating || order?.restaurantRating || null)
    setSelectedDeliveryRating(order?.ratings?.deliveryPartner?.rating || order?.deliveryPartnerRating || null)
    setRestaurantFeedbackText(order?.ratings?.restaurant?.comment || "")
    setDeliveryFeedbackText(order?.ratings?.deliveryPartner?.comment || "")
    setShowRatingModal(true)
  }

  const handleSubmitRating = async () => {
    const deliveryPartnerCheck = !!(order?.deliveryPartnerId || order?.deliveryPartnerName)
    const isMissingDeliveryRating = deliveryPartnerCheck && selectedDeliveryRating === null
    if (!order || selectedRestaurantRating === null || isMissingDeliveryRating) {
      toast.error("Please select all required ratings first")
      return
    }

    try {
      setSubmittingRating(true)
      const response = await orderAPI.submitOrderRatings(order.mongoId || order._id || order.id, {
        restaurantRating: selectedRestaurantRating,
        deliveryPartnerRating: deliveryPartnerCheck ? selectedDeliveryRating : undefined,
        restaurantComment: restaurantFeedbackText || undefined,
        deliveryPartnerComment: deliveryPartnerCheck ? (deliveryFeedbackText || undefined) : undefined,
      })
      
      const updatedOrderData = response?.data?.data?.order || response?.data?.order
      const nextRatings = updatedOrderData?.ratings || {
        restaurant: {
          rating: selectedRestaurantRating,
          comment: restaurantFeedbackText || '',
          ratedAt: new Date().toISOString(),
        },
        ...(deliveryPartnerCheck
          ? {
              deliveryPartner: {
                rating: selectedDeliveryRating,
                comment: deliveryFeedbackText || '',
                ratedAt: new Date().toISOString(),
              },
            }
          : {}),
      }

      setOrder((prev) => ({
        ...prev,
        ...(updatedOrderData || {}),
        ratings: nextRatings,
        restaurantRating: nextRatings?.restaurant?.rating ?? selectedRestaurantRating,
        deliveryPartnerRating: deliveryPartnerCheck
          ? (nextRatings?.deliveryPartner?.rating ?? selectedDeliveryRating)
          : prev?.deliveryPartnerRating,
      }))

      toast.success("Thanks for your feedback!")
      setShowRatingModal(false)
    } catch (error) {
      debugError("Error submitting order ratings:", error)
      toast.error(error?.response?.data?.message || "Failed to submit ratings")
    } finally {
      setSubmittingRating(false)
    }
  }

  const handleEtaUpdate = useCallback((newEta) => {
    if (typeof newEta === 'string') {
      const match = newEta.match(/(\d+)/);
      if (match) {
        setEstimatedTime(parseInt(match[1], 10));
        return;
      }
    }
    if (typeof newEta === 'number' && !isNaN(newEta)) {
      setEstimatedTime(newEta);
    }
  }, [])

  const orderStatus = useMemo(
    () => mapOrderToTrackingUiStatus(order),
    [
      order?.status,
      order?.orderStatus,
      order?.failureReason,
      order?.dispatch?.status,
      order?.deliveryState?.currentPhase,
      order?.deliveryState?.status,
    ],
  )

  // Auto-open rate restaurant + driver modal once order is delivered.
  useEffect(() => {
    if (orderStatus !== 'delivered' || isOrderRated || showRatingModal) return
    if (ratingPromptedRef.current) return

    const orderKey = String(order?.mongoId || order?._id || order?.id || '')
    if (!orderKey) return

    try {
      const stored = JSON.parse(localStorage.getItem('shownRatingForOrders') || '[]')
      if (Array.isArray(stored) && stored.includes(orderKey)) {
        ratingPromptedRef.current = true
        return
      }
      const next = Array.from(new Set([...stored, orderKey]))
      localStorage.setItem('shownRatingForOrders', JSON.stringify(next))
    } catch {
      // ignore storage errors
    }

    ratingPromptedRef.current = true
    const timer = setTimeout(() => {
      setSelectedRestaurantRating(null)
      setSelectedDeliveryRating(null)
      setRestaurantFeedbackText('')
      setDeliveryFeedbackText('')
      setShowRatingModal(true)
    }, 600)
    return () => clearTimeout(timer)
  }, [
    orderStatus,
    isOrderRated,
    showRatingModal,
    order?.mongoId,
    order?._id,
    order?.id,
  ])

  const isDriverNotFoundCancelled = useMemo(() => {
    if (orderStatus !== 'cancelled') return false
    const reason = String(order?.cancellationReason || '').toLowerCase()
    return (
      order?.failureReason === 'driver_not_found' ||
      reason.includes('no delivery partner') ||
      reason.includes('delivery partner not found')
    )
  }, [orderStatus, order?.failureReason, order?.cancellationReason])

  const handleReorder = () => {
    if (!order?.items?.length) {
      toast.error('No items available to reorder')
      return
    }
    const restaurantId = resolveEntityId(
      order.restaurantId ||
        order.items?.[0]?.restaurantId ||
        order.pickups?.[0]?.restaurantId,
    )
    const restaurantTarget = order.restaurantSlug || restaurantId
    if (!restaurantTarget) {
      toast.error('Restaurant information not available')
      return
    }
    const reorderItems = order.items
      .map((item, index) => {
        const itemId = resolveEntityId(item.itemId || item.id || item._id)
        if (!itemId) return null
        const unitPrice =
          Number(item.variantPrice) > 0
            ? Number(item.variantPrice)
            : Number(item.price) || 0
        return {
          id: itemId,
          itemId,
          name: item.name || 'Item',
          price: unitPrice,
          image: item.image || '',
          restaurant: order.restaurant || order.restaurantName || 'Restaurant',
          restaurantId: resolveEntityId(item.restaurantId) || restaurantId,
          variantId: item.variantId || item.variant?._id || item.variant?.id || '',
          variantName: item.variantName || item.variant?.name || '',
          variantPrice: unitPrice,
          description: item.description || '',
          isVeg: item.isVeg !== false,
          quantity: Math.max(1, Number(item.quantity) || 1),
          reorderIndex: index,
        }
      })
      .filter(Boolean)
    if (!reorderItems.length) {
      toast.error('No reorderable items found')
      return
    }
    replaceCart(reorderItems)
    toast.success('Items added to cart')
    navigate(`/food/user/restaurants/${restaurantTarget}`)
  }
  const trackingOrderIdsRef = useRef(new Set())
  const terminalPollStopRef = useRef(false)
  const lookupIdsRef = useRef([])
  const pollRef = useRef(null)
  const lastStatusToastRef = useRef({ key: '', at: 0 })

  const ORDER_STATUS_TOAST_ID = 'order-tracking-status-update'
  const ORDER_STATUS_TOAST_DEDUPE_MS = 4000

  // Delivery handover OTP received via socket event.
  // Kept separately so UI still renders even if the event arrives
  // before the order API poll populates `order` state.
  const [socketDropOtpCode, setSocketDropOtpCode] = useState(null)
  const [partialDropPopup, setPartialDropPopup] = useState(null)


  // OTP received via socket event (deliveryDropOtp)
  useEffect(() => {
    const handleDeliveryDropOtp = (event) => {
      const detail = event?.detail || {}
      const otp = detail?.otp != null ? String(detail.otp) : null
      const evtOrderId = detail?.orderId != null ? String(detail.orderId) : null
      const evtOrderMongoId =
        detail?.orderMongoId != null ? String(detail.orderMongoId) : null

      if (!otp) return

      const currentIds = [String(orderId)]
      if (order?.orderId) currentIds.push(String(order.orderId))
      if (order?.mongoId) currentIds.push(String(order.mongoId))
      if (order?._id) currentIds.push(String(order._id))

      const matches =
        (evtOrderId && currentIds.includes(evtOrderId)) ||
        (evtOrderMongoId && currentIds.includes(evtOrderMongoId))

      if (!matches) return

      setSocketDropOtpCode(detail?.isDualLeg ? null : otp)

      const incomingLegs = Array.isArray(detail?.legOtps) && detail.legOtps.length
        ? detail.legOtps
        : [{
            legIndex: detail?.legIndex,
            role: detail?.role || 'primary',
            partnerId: detail?.partnerId || null,
            otp,
          }]

      setOrder((prev) => {
        if (!prev) return prev
        const prevDV = prev.deliveryVerification || {}
        const prevDropOtp = prevDV.dropOtp || {}
        const prevLegs = Array.isArray(prev.legHandoverOtps) ? prev.legHandoverOtps : []
        const byKey = new Map(
          prevLegs.map((l) => [String(l.legIndex ?? l.partnerId ?? l.role), l]),
        )
        incomingLegs.forEach((l) => {
          if (!l?.otp) return
          byKey.set(String(l.legIndex ?? l.partnerId ?? l.role), l)
        })
        const mergedLegs = [...byKey.values()]
        const isDual = Boolean(detail?.isDualLeg) || prev.isDualLeg || mergedLegs.length > 1

        return {
          ...prev,
          isDualLeg: isDual,
          legHandoverOtps: mergedLegs,
          deliveryVerification: {
            ...prevDV,
            dropOtp: {
              ...prevDropOtp,
              required: true,
              verified: false,
              // Dual-leg keeps codes only in legOtps / legHandoverOtps
              ...(isDual ? {} : { code: otp }),
            },
            legOtps: mergedLegs,
          }
        }
      })
    }

    window.addEventListener('deliveryDropOtp', handleDeliveryDropOtp)
    return () => window.removeEventListener('deliveryDropOtp', handleDeliveryDropOtp)
  }, [orderId, order])

  // --- Start: Sync arrival time with selected Delivery Speed Option ---
  const getTimeRemaining = useCallback((orderData) => {
    if (!orderData) return null;

    const status = String(orderData.status || orderData.orderStatus || '').toLowerCase()
    const restaurantAccepted = [
      'confirmed',
      'accepted',
      'preparing',
      'ready',
      'ready_for_pickup',
      'picked_up',
      'out_for_delivery',
      'reached_drop',
    ].includes(status)

    // After restaurant accepts, count down from accept time using the selected speed option ETA.
    const history = Array.isArray(orderData.statusHistory) ? orderData.statusHistory : []
    const acceptHistory = [...history].reverse().find((h) =>
      ['confirmed', 'accepted', 'preparing'].includes(String(h?.to || '').toLowerCase()),
    )
    const acceptAt =
      orderData.restaurantAcceptedAt ||
      orderData.tracking?.confirmed?.timestamp ||
      acceptHistory?.at ||
      null

    const orderTime = new Date(
      (restaurantAccepted && acceptAt) ||
      orderData.scheduledAt ||
      orderData.createdAt ||
      orderData.orderDate ||
      orderData.created_at ||
      orderData.date ||
      Date.now(),
    );

    const isScheduled = !!orderData.scheduledAt && !restaurantAccepted;
    const estimatedMinutes = isScheduled
      ? 0
      : (orderData.estimatedDeliveryTime || orderData.estimatedTime || orderData.estimated_delivery_time || 35);

    // Before restaurant accepts, show the selected speed option minutes (not a countdown from create).
    if (!restaurantAccepted && !isScheduled) {
      return Math.max(0, Number(estimatedMinutes) || 0)
    }

    const deliveryTime = new Date(orderTime.getTime() + estimatedMinutes * 60000);
    return Math.max(0, Math.floor((deliveryTime - new Date()) / 60000));
  }, []);

  // Sync estimatedTime state with order data and periodic updates
  useEffect(() => {
    if (!order) return;

    const tick = () => {
      const remaining = getTimeRemaining(order);
      // Only prefer static calculation if no realtime ETA is provided by the map/driver
      // But user said "should be same" as Home page, which uses static calculation.
      // So we use static calculation as the base/sync source.
      if (remaining !== null) {
        setEstimatedTime(remaining);
      }
    };

    tick();
    const interval = setInterval(tick, 30000); // 30s sync matches home page logic
    return () => clearInterval(interval);
  }, [order, getTimeRemaining]);
  // --- End: Sync arrival time ---

  // --------------------------------------------------------------------------
  // DATA FETCHING & POLLING STABILITY (FIXED FOR HAMMERING)
  // --------------------------------------------------------------------------

  // Socket notifications include order ids — keep a set so events match this page.
  useEffect(() => {
    const s = trackingOrderIdsRef.current
    s.add(String(orderId))
    if (order?.orderId) s.add(String(order.orderId))
    if (order?.mongoId) s.add(String(order.mongoId))
    if (order?.id) s.add(String(order.id))
  }, [orderId, order?.orderId, order?.mongoId, order?.id])

  useEffect(() => {
    const ids = [
      resolvedLookupId,
      orderId,
      order?.orderId,
      order?.mongoId,
      order?._id,
      order?.id,
    ]
      .map(normalizeLookupId)
      .filter(Boolean)
    lookupIdsRef.current = Array.from(new Set(ids))
  }, [orderId, resolvedLookupId, order?.orderId, order?.mongoId, order?._id, order?.id])

  // Stability Nuke: Move function bodies into a ref-protected execute flow
  const stableOpsRef = useRef({
    resolveOrderFromList: async (rawLookupId) => {
      const needle = normalizeLookupId(rawLookupId)
      if (!needle) return null
      const maxPages = 3
      const limit = 50

      for (let page = 1; page <= maxPages; page += 1) {
        const listResponse = await orderAPI.getOrders({ page, limit })
        let orders = []
        if (listResponse?.data?.success && listResponse?.data?.data?.orders) {
          orders = listResponse.data.data.orders || []
        } else if (listResponse?.data?.orders) {
          orders = listResponse.data.orders || []
        } else if (Array.isArray(listResponse?.data?.data?.data)) {
          orders = listResponse.data.data.data || []
        } else if (Array.isArray(listResponse?.data?.data)) {
          orders = listResponse.data.data || []
        }

        const matched = (orders || []).find((o) => {
          const candidates = [o?._id, o?.id, o?.orderId, o?.mongoId].map(normalizeLookupId)
          return candidates.includes(needle)
        })
        if (matched) return matched
        const totalPages = Number(listResponse?.data?.data?.pagination?.pages) || Number(listResponse?.data?.data?.totalPages) || 1
        if (page >= totalPages) break
      }
      return null
    },
    fetchOrderDetailsWithFallback: async (options = {}) => {
      const lookupIds = lookupIdsRef.current
      if (lookupIds.length === 0) throw new Error("Order id required")
      let lastError = null
      for (const id of lookupIds) {
        try {
          // Double guard against hammer
          return await orderAPI.getOrderDetails(id, options)
        } catch (err) {
          lastError = err
          if (err?.response?.status === 400 || err?.response?.status === 404) continue
          throw err
        }
      }
      throw lastError || new Error("Failed to fetch order details")
    }
  });

  const resolveOrderFromList = useCallback((id) => stableOpsRef.current.resolveOrderFromList(id), [])
  const fetchOrderDetailsWithFallback = useCallback((opts) => stableOpsRef.current.fetchOrderDetailsWithFallback(opts), [])

  // Clear OTP when order is finalized.
  useEffect(() => {
    if (!order) return
    const status = mapOrderToTrackingUiStatus(order)
    if (status === 'delivered' || status === 'cancelled') {
      setSocketDropOtpCode(null)


      setOrder((prev) => {
        if (!prev?.deliveryVerification?.dropOtp?.code) return prev
        return {
          ...prev,
          deliveryVerification: {
            ...(prev.deliveryVerification || {}),
            dropOtp: {
              ...(prev.deliveryVerification?.dropOtp || {}),
              code: null
            }
          }
        }
      })
    }
  }, [orderStatus, order])

  const defaultAddress = getDefaultAddress()
  const fallbackCustomerCoords = useMemo(() => {
    const orderCoords = order?.address?.coordinates || order?.address?.location?.coordinates
    if (Array.isArray(orderCoords) && orderCoords.length >= 2) {
      const lng = Number(orderCoords[0])
      const lat = Number(orderCoords[1])
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng }
      }
    }

    const orderLocObj = order?.address?.location || order?.address
    const orderObjLat = Number(orderLocObj?.lat ?? orderLocObj?.latitude)
    const orderObjLng = Number(orderLocObj?.lng ?? orderLocObj?.longitude)
    if (Number.isFinite(orderObjLat) && Number.isFinite(orderObjLng)) {
      return { lat: orderObjLat, lng: orderObjLng }
    }

    const defaultCoords = defaultAddress?.location?.coordinates
    if (Array.isArray(defaultCoords) && defaultCoords.length >= 2) {
      const lng = Number(defaultCoords[0])
      const lat = Number(defaultCoords[1])
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng }
      }
    }

    const defaultLocObj = defaultAddress?.location || defaultAddress
    const defaultObjLat = Number(defaultLocObj?.lat ?? defaultLocObj?.latitude)
    const defaultObjLng = Number(defaultLocObj?.lng ?? defaultLocObj?.longitude)
    if (Number.isFinite(defaultObjLat) && Number.isFinite(defaultObjLng)) {
      return { lat: defaultObjLat, lng: defaultObjLng }
    }

    const liveLat = Number(userLiveLocation?.latitude)
    const liveLng = Number(userLiveLocation?.longitude)
    if (Number.isFinite(liveLat) && Number.isFinite(liveLng)) {
      return { lat: liveLat, lng: liveLng }
    }

    return null
  }, [
    order?.address?.coordinates,
    order?.address?.location?.coordinates,
    defaultAddress?.location?.coordinates,
    userLiveLocation?.latitude,
    userLiveLocation?.longitude
  ])

  const userLiveCoords = useMemo(() => {
    const lat = Number(userLiveLocation?.latitude)
    const lng = Number(userLiveLocation?.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { lat, lng }
  }, [userLiveLocation?.latitude, userLiveLocation?.longitude])

  const isAdminAccepted = useMemo(() => {
    const status = order?.status
    return [
      "confirmed",
      "preparing",
      "ready",
      "ready_for_pickup",
      "picked_up",
    ].includes(status)
  }, [order?.status])

  const speedEtaLabel = useMemo(() => {
    const label = String(order?.deliveryTime || '').trim()
    if (label) return label
    const mins = Number(order?.estimatedTime)
    if (Number.isFinite(mins) && mins > 0) return `${mins} mins`
    return null
  }, [order?.deliveryTime, order?.estimatedTime])

  const acceptedAtMs = useMemo(() => {
    const timestamp =
      order?.restaurantAcceptedAt ||
      order?.tracking?.confirmed?.timestamp ||
      order?.tracking?.preparing?.timestamp ||
      order?.updatedAt ||
      order?.createdAt

    const parsed = timestamp ? new Date(timestamp).getTime() : NaN
    return Number.isFinite(parsed) ? parsed : null
  }, [order?.restaurantAcceptedAt, order?.tracking?.confirmed?.timestamp, order?.tracking?.preparing?.timestamp, order?.updatedAt, order?.createdAt])

  const editWindowRemainingMs = useMemo(() => {
    if (!isAdminAccepted || !acceptedAtMs) return 0
    const remaining = 60000 - (timerNow - acceptedAtMs)
    return Math.max(0, remaining)
  }, [isAdminAccepted, acceptedAtMs, timerNow])

  const isEditWindowOpen = editWindowRemainingMs > 0

  const editWindowText = useMemo(() => {
    const totalSeconds = Math.ceil(editWindowRemainingMs / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }, [editWindowRemainingMs])

  const handleCallRestaurant = (e) => {
    // Prevent event bubbling if necessary
    if (e && e.stopPropagation) e.stopPropagation();

    const rawPhone =
      order?.restaurantPhone ||
      order?.restaurantId?.phone ||
      order?.restaurantId?.ownerPhone ||
      order?.restaurantId?.contact?.phone ||
      order?.restaurant?.phone ||
      order?.restaurant?.ownerPhone ||
      order?.restaurantId?.location?.phone ||
      '';

    const cleanPhone = String(rawPhone).replace(/[^\d+]/g, '');
    
    if (!cleanPhone || cleanPhone.length < 5) {
      toast.error('Restaurant phone number not available');
      return;
    }

    debugLog('?? Attempting to call restaurant:', cleanPhone);
    
    // Most compatible way to trigger dialer on overall mobile/web environments:
    // Create a temporary hidden anchor and programmatically click it.
    try {
      const link = document.createElement('a');
      link.href = `tel:${cleanPhone}`;
      link.setAttribute('target', '_self');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      debugError('Call failed via link click:', err);
      // Last-ditch fallback
      window.location.assign(`tel:${cleanPhone}`);
    }
  };

  const handleCallRider = (e, phoneOverride) => {
    if (e && e.stopPropagation) e.stopPropagation();
    
    const rawPhone = phoneOverride || order?.deliveryPartner?.phone || '';
    const cleanPhone = String(rawPhone).replace(/[^\d+]/g, '');

    if (!cleanPhone || cleanPhone.length < 5) {
      toast.error('Rider phone number not available');
      return;
    }

    debugLog('?? Attempting to call rider:', cleanPhone);
    
    try {
      const link = document.createElement('a');
      link.href = `tel:${cleanPhone}`;
      link.setAttribute('target', '_self');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      debugError('Call failed via link click:', err);
      window.location.assign(`tel:${cleanPhone}`);
    }
  };

  const customerDeliveryOtp = useMemo(() => {
    // Dual-leg uses per-leg OTPs only — never collapse into one shared code.
    if (order?.isDualLeg || (Array.isArray(order?.legHandoverOtps) && order.legHandoverOtps.length > 1)) {
      return null
    }
    const codeFromOrder = order?.deliveryVerification?.dropOtp?.code
    const code = codeFromOrder ?? socketDropOtpCode
    return code ? String(code) : null
  }, [
    order?.isDualLeg,
    order?.legHandoverOtps,
    order?.deliveryVerification?.dropOtp?.code,
    socketDropOtpCode,
  ])

  const customerLegOtps = useMemo(() => {
    const legs = order?.legHandoverOtps || order?.deliveryVerification?.legOtps || []
    if (Array.isArray(legs) && legs.length) {
      return legs.filter((l) => l?.otp).map((l) => ({
        ...l,
        otp: String(l.otp),
        label:
          l.role === 'shared' || l.role === 'secondary'
            ? 'Partner OTP'
            : l.role === 'primary'
              ? 'Lead rider OTP'
              : 'Delivery OTP',
      }))
    }
    if (customerDeliveryOtp) {
      return [{ otp: customerDeliveryOtp, role: 'primary', label: 'Delivery OTP' }]
    }
    return []
  }, [order?.legHandoverOtps, order?.deliveryVerification?.legOtps, customerDeliveryOtp])

  const deliveryPartnersList = useMemo(() => {
    if (Array.isArray(order?.deliveryPartners) && order.deliveryPartners.length) {
      return order.deliveryPartners
    }
    if (order?.deliveryPartnerId || order?.deliveryPartner) {
      return [{
        id: order.deliveryPartnerId || 'primary',
        role: 'primary',
        name: order.deliveryPartner?.name || 'Delivery Partner',
        phone: order.deliveryPartner?.phone || '',
        avatar: order.deliveryPartner?.avatar || null,
      }]
    }
    return []
  }, [order?.deliveryPartners, order?.deliveryPartnerId, order?.deliveryPartner])

  useEffect(() => {
    if (!isEditWindowOpen) return
    const interval = setInterval(() => {
      setTimerNow(Date.now())
    }, 1000)
    return () => clearInterval(interval)
  }, [isEditWindowOpen])

  // Poll for order updates (especially when delivery partner accepts)

  // Main fetch on orderId change; pollRef used for optional fallback refresh only.
  useEffect(() => {
    if (!orderId) return;

    let cancelled = false;

    const loadOrder = async (isInitial = false) => {
      if (cancelled) return;
      if (!isInitial && terminalPollStopRef.current) return;

      if (isInitial) {
        const rawContext = getOrderById(orderId);
        if (rawContext) {
          setOrder(transformOrderForTracking(rawContext));
        }
      }

      try {
        const response = await fetchOrderDetailsWithFallback({ force: isInitial });
        if (cancelled) return;

        let finalOrderData = null;
        if (response.data?.success && response.data.data?.order) {
          finalOrderData = response.data.data.order;
        } else if (isInitial) {
          const matchedOrder = await resolveOrderFromList(orderId);
          if (matchedOrder) finalOrderData = matchedOrder;
        }

        if (finalOrderData) {
          setOrder((prev) => {
            const transformedOrder = transformOrderForTracking(finalOrderData, prev);
            const ui = mapOrderToTrackingUiStatus(transformedOrder);
            terminalPollStopRef.current = ui === 'delivered' || ui === 'cancelled';
            return transformedOrder;
          });
          setError(null);
          return;
        }

        if (isInitial) {
          setError(response.data?.message || 'Order not found');
          terminalPollStopRef.current = true;
        }
      } catch (err) {
        if (!isInitial || cancelled) return;
        try {
          const matchedOrder = await resolveOrderFromList(orderId);
          if (matchedOrder) {
            if (cancelled) return;
            setOrder((prev) => transformOrderForTracking(matchedOrder, prev));
            setError(null);
            return;
          }
        } catch {
          // ignore list fallback errors
        }
        setError(err.response?.data?.message || 'Failed to fetch order details');
        terminalPollStopRef.current = true;
      } finally {
        if (isInitial && !cancelled) {
          setLoading(false);
        }
      }
    };

    terminalPollStopRef.current = false;
    setLoading(true);
    setError(null);
    loadOrder(true);
    pollRef.current = () => loadOrder(false);

    return () => {
      cancelled = true;
    };
  }, [orderId, fetchOrderDetailsWithFallback, resolveOrderFromList, getOrderById]);

  // Fallback polling only when socket is disconnected (live updates come from socket).
  useEffect(() => {
    if (!orderId) return;
    if (isSocketConnected || window.orderSocketConnected) return;

    const tick = () => {
      if (terminalPollStopRef.current) return;
      if (document.hidden) return;
      if (pollRef.current) pollRef.current(false);
    };

    const interval = setInterval(tick, 20000);
    return () => clearInterval(interval);
  }, [orderId, isSocketConnected]);

  useEffect(() => {
    if (!order) return
    const ui = mapOrderToTrackingUiStatus(order)
    terminalPollStopRef.current = ui === 'delivered' || ui === 'cancelled'
  }, [order])

  // Post-checkout splash only — real status comes from API / poll / socket.
  useEffect(() => {
    if (!confirmed) return
    const timer1 = setTimeout(() => setShowConfirmation(false), 3000)
    return () => clearTimeout(timer1)
  }, [confirmed])

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setEstimatedTime((prev) => Math.max(0, prev - 1))
    }, 60000)
    return () => clearInterval(timer)
  }, [])

  // Live updates via socket (no polling while connected).
  useEffect(() => {
    const handleOrderStatusNotification = (event) => {
      const payload = event?.detail || {};
      const { message, status, estimatedDeliveryTime, orderId: evtOrderId, orderMongoId } = payload;

      const evtKeys = [evtOrderId, orderMongoId, payload?._id].filter(Boolean).map(String)
      const idMatches =
        evtKeys.length === 0 ||
        evtKeys.some((k) => String(k) === String(orderId)) ||
        evtKeys.some((k) => trackingOrderIdsRef.current.has(k))

      if (!idMatches) return

      const nextStatusRaw = payload.orderStatus || status
      const isCancelled = String(nextStatusRaw || '').toLowerCase().includes('cancel')
      const isPartialDrop = payload.failureReason === 'restaurant_partially_dropped'

      if (isPartialDrop) {
        setPartialDropPopup({
          message:
            message ||
            `One restaurant rejected your order. ₹${Number(payload.refundAmount || 0).toFixed(0)} has been refunded to your wallet.`,
          refundAmount: Number(payload.refundAmount) || 0,
          restaurantName: payload.restaurantName || 'A restaurant',
        })
      }

      setOrder((prev) => {
        const apiPatch = {
          ...(prev || {}),
          orderStatus: nextStatusRaw || prev?.status,
          status: nextStatusRaw || prev?.status,
          failureReason: payload.failureReason ?? prev?.failureReason ?? null,
          cancellationReason: isCancelled && message ? message : prev?.cancellationReason,
          deliveryState: payload.deliveryState ?? prev?.deliveryState,
          dispatch: payload.dispatch ?? prev?.dispatch,
          payment: payload.payment ?? prev?.payment,
          pricing: payload.pricing ?? prev?.pricing,
          pickups: payload.pickups ?? prev?.pickups,
          partialRefunds: payload.partialRefunds ?? prev?.partialRefunds,
          items: payload.items ?? prev?.items,
        }
        const transformed = transformOrderForTracking(apiPatch, prev)
        const ui = mapOrderToTrackingUiStatus(transformed)
        terminalPollStopRef.current = ui === 'delivered' || ui === 'cancelled'
        return transformed
      })

      if (message) {
        const toastKey = `${String(evtOrderId || orderMongoId || orderId)}:${String(nextStatusRaw || '')}:${String(payload.failureReason || '')}`
        const now = Date.now()
        const isDuplicateToast =
          toastKey &&
          toastKey === lastStatusToastRef.current.key &&
          now - lastStatusToastRef.current.at < ORDER_STATUS_TOAST_DEDUPE_MS

        if (!isDuplicateToast) {
          lastStatusToastRef.current = { key: toastKey, at: now }
          toast.dismiss(ORDER_STATUS_TOAST_ID)
          const toastFn =
            isCancelled || payload.failureReason === 'driver_not_found'
              ? toast.error
              : isPartialDrop
                ? toast.message
                : toast.success
          toastFn(message, {
            id: ORDER_STATUS_TOAST_ID,
            duration: isPartialDrop ? 10000 : 6000,
            position: 'top-center',
            description: estimatedDeliveryTime
              ? `Estimated delivery in ${Math.round(estimatedDeliveryTime / 60)} minutes`
              : undefined,
          })
          if (navigator.vibrate) navigator.vibrate([200, 100, 200])
        }
      }
    };

    const handlePartialDrop = (event) => {
      const payload = event?.detail || {}
      const evtKeys = [payload.orderId, payload.orderMongoId].filter(Boolean).map(String)
      const idMatches =
        evtKeys.length === 0 ||
        evtKeys.some((k) => String(k) === String(orderId)) ||
        evtKeys.some((k) => trackingOrderIdsRef.current.has(k))
      if (!idMatches) return
      setPartialDropPopup({
        message: payload.message,
        refundAmount: Number(payload.refundAmount) || 0,
        restaurantName: payload.restaurantName || 'A restaurant',
      })
    }

    window.addEventListener('orderStatusNotification', handleOrderStatusNotification);
    window.addEventListener('orderPartialRestaurantDropped', handlePartialDrop);
    return () => {
      window.removeEventListener('orderStatusNotification', handleOrderStatusNotification);
      window.removeEventListener('orderPartialRestaurantDropped', handlePartialDrop);
    }
  }, [orderId])

  const handleCancelOrder = () => {
    if (!order) return;

    const rawStatus = String(order?.orderStatus || order?.status || '').toLowerCase()
    const canCancel =
      rawStatus === 'created' ||
      rawStatus === 'scheduled' ||
      (!isAdminAccepted && ['pending', 'placed'].includes(rawStatus))

    if (!canCancel) {
      toast.error('Order cannot be cancelled after the restaurant has accepted it. Contact support if needed.');
      return;
    }

    if (String(order.status || '').includes('cancel') || rawStatus.includes('cancel')) {
      toast.error('Order is already cancelled');
      return;
    }

    if (rawStatus === 'delivered') {
      toast.error('Cannot cancel a delivered order');
      return;
    }

    const method = String(order?.payment?.method || order?.paymentMethod || "").toLowerCase()
    const status = String(order?.payment?.status || "").toLowerCase()
    const isRazorpayPaid =
      method === "razorpay" && ["paid", "authorized", "captured", "settled", "refunded"].includes(status)

    setRefundDestination(isRazorpayPaid ? "source" : "wallet")

    setShowCancelDialog(true);
  };

  const handleConfirmCancel = async () => {
    if (!cancellationReason.trim()) {
      toast.error('Please provide a reason for cancellation');
      return;
    }

    setIsCancelling(true);
    try {
      const cancelLookupId =
        lookupIdsRef.current[0] || normalizeLookupId(orderId)
      const method = String(order?.payment?.method || order?.paymentMethod || "").toLowerCase()
      const status = String(order?.payment?.status || "").toLowerCase()
      const isRazorpayPaid =
        method === "razorpay" && ["paid", "authorized", "captured", "settled", "refunded"].includes(status)

      const payload = {
        reason: cancellationReason.trim(),
        ...(isRazorpayPaid ? { refundDestination } : {}),
      }

      const response = await orderAPI.cancelOrder(cancelLookupId, payload);
      if (response.data?.success) {
        const paymentMethod = order?.payment?.method || order?.paymentMethod;
        const successMessage = response.data?.message ||
          (paymentMethod === 'cash' || paymentMethod === 'cod'
            ? 'Order cancelled successfully. No refund required as payment was not made.'
            : refundDestination === 'wallet'
              ? 'Order cancelled successfully. Refund has been added to your wallet.'
              : 'Order cancelled successfully. Refund has been added to your wallet.');
        toast.success(successMessage);
        setShowCancelDialog(false);
        setCancellationReason("");
        setRefundDestination("wallet");
        // Refresh order data
        const orderResponse = await fetchOrderDetailsWithFallback({ force: true });
        if (orderResponse.data?.success && orderResponse.data.data?.order) {
          const apiOrder = orderResponse.data.data.order;
          setOrder(transformOrderForTracking(apiOrder, order));
        }
      } else {
        toast.error(response.data?.message || 'Failed to cancel order');
      }
    } catch (error) {
      debugError('Error cancelling order:', error);
      toast.error(error.response?.data?.message || 'Failed to cancel order');
    } finally {
      setIsCancelling(false);
    }
  };

  const handleUpdateInstructions = async () => {
    try {
      setIsUpdatingInstructions(true);
      const response = await orderAPI.updateOrderInstructions(resolvedLookupId || orderId, deliveryInstructions);
      if (response.data?.success) {
        toast.success("Delivery instructions updated");
        setIsInstructionsModalOpen(false);
        const updatedOrder = response.data.data?.order;
        if (updatedOrder) {
          setOrder(prev => transformOrderForTracking(updatedOrder, prev));
        } else {
          setOrder(prev => ({ ...prev, note: deliveryInstructions }));
        }
      } else {
        toast.error(response.data?.message || "Failed to update instructions");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update instructions");
    } finally {
      setIsUpdatingInstructions(false);
    }
  };

  const handleShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: `Track my order from ${order?.restaurant || companyName}`,
          text: `Hey! Track my order from ${order?.restaurant || companyName} with ID #${order?.orderId || order?.id}.`,
          url: window.location.href,
        });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        toast.success("Tracking link copied to clipboard!");
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        debugError('Error sharing:', error);
        toast.error("Failed to share link");
      }
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      const response = await fetchOrderDetailsWithFallback({ force: true })
      if (response.data?.success && response.data.data?.order) {
        const apiOrder = response.data.data.order

        // Extract restaurant location coordinates with multiple fallbacks
        let restaurantCoords = null;
        let restaurantAddress = null;

        // Priority 1: restaurantId.location.coordinates (GeoJSON format: [lng, lat])
        if (apiOrder.restaurantId?.location?.coordinates &&
          Array.isArray(apiOrder.restaurantId.location.coordinates) &&
          apiOrder.restaurantId.location.coordinates.length >= 2) {
          restaurantCoords = apiOrder.restaurantId.location.coordinates;
        }
        // Priority 2: restaurantId.location with latitude/longitude properties
        else if (apiOrder.restaurantId?.location?.latitude && apiOrder.restaurantId?.location?.longitude) {
          restaurantCoords = [apiOrder.restaurantId.location.longitude, apiOrder.restaurantId.location.latitude];
        }
        // Priority 3: Check nested restaurant data
        else if (apiOrder.restaurant?.location?.coordinates) {
          restaurantCoords = apiOrder.restaurant.location.coordinates;
        }
        // Priority 4: Check if restaurantId is a string ID and fetch restaurant details
        else if (typeof apiOrder.restaurantId === 'string') {
          debugLog('?? restaurantId is a string ID, fetching restaurant details...', apiOrder.restaurantId);
          try {
            const restaurantResponse = await restaurantAPI.getRestaurantById(apiOrder.restaurantId);
            if (restaurantResponse?.data?.success && restaurantResponse.data.data?.restaurant) {
              const restaurant = restaurantResponse.data.data.restaurant;
              if (restaurant.location?.coordinates && Array.isArray(restaurant.location.coordinates) && restaurant.location.coordinates.length >= 2) {
                restaurantCoords = restaurant.location.coordinates;
                debugLog('? Fetched restaurant coordinates from API:', restaurantCoords);
              }
              restaurantAddress =
                restaurant?.location?.formattedAddress ||
                restaurant?.location?.address ||
                restaurant?.address ||
                null;
            }
          } catch (err) {
            debugError('? Error fetching restaurant details:', err);
          }
        }

        setOrder(transformOrderForTracking(apiOrder, order, restaurantCoords, restaurantAddress))
      }
    } catch (err) {
      debugError('Error refreshing order:', err)
    } finally {
      setIsRefreshing(false)
    }
  }

  // --------------------------------------------------------------------------
  // RENDER (Final JSX)
  // --------------------------------------------------------------------------

  // Loading state (moved after hooks)
  if (loading) {
    return (
      <AnimatedPage className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a] p-4">
        <div className="max-w-lg mx-auto text-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-gray-600 dark:text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Loading order details...</p>
        </div>
      </AnimatedPage>
    )
  }

  // Error state (moved after hooks)
  if (error || !order) {
    return (
      <AnimatedPage className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a] p-4">
        <div className="max-w-lg mx-auto text-center py-20">
          <h1 className="text-lg sm:text-xl md:text-2xl font-bold mb-4 dark:text-gray-100">Order Not Found</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">{error || 'The order you\'re looking for doesn\'t exist.'}</p>
          <Link to="/user/orders">
            <Button>Back to Orders</Button>
          </Link>
        </div>
      </AnimatedPage>
    )
  }

  const statusConfig = {
    finding_driver: {
      title: "Fetching driver",
      subtitle: "Looking for an available rider near the restaurant",
      color: "bg-orange-600",
      iconType: 'rider'
    },
    awaiting_restaurant: {
      title: "Waiting for restaurant",
      subtitle: speedEtaLabel
        ? `Est. delivery ${speedEtaLabel} once restaurant accepts`
        : "Delivery partner assigned — restaurant will confirm soon",
      color: "bg-green-600",
      iconType: 'food'
    },
    placed: {
      title: "Order Placed",
      subtitle: "Looking for a delivery partner",
      color: "bg-green-600",
      iconType: 'food'
    },
    confirmed: {
      title: "Order Confirmed",
      subtitle: speedEtaLabel
        ? `Estimated delivery: ${speedEtaLabel}`
        : (typeof estimatedTime === 'number' ? `Arriving in ${estimatedTime} mins` : "Restaurant has accepted your order"),
      color: "bg-green-600",
      iconType: 'food'
    },
    preparing: {
      title: "Food is being prepared",
      subtitle: speedEtaLabel
        ? `Estimated delivery: ${speedEtaLabel}`
        : (typeof estimatedTime === 'number' ? `Arriving in ${estimatedTime} mins` : "Cooking your meal"),
      color: "bg-green-600",
      iconType: 'food'
    },
    assigned: {
      title: "Rider is arriving",
      subtitle: typeof order?.riderToRestaurantDistanceKm === 'number'
        ? `${order.riderToRestaurantDistanceKm >= 1 ? `${order.riderToRestaurantDistanceKm.toFixed(1)} km` : `${Math.round(order.riderToRestaurantDistanceKm * 1000)} m`} from restaurant`
        : "A delivery partner is heading to the restaurant",
      color: "bg-green-600",
      iconType: 'rider'
    },
    at_pickup: {
      title: "Rider at restaurant",
      subtitle: "Rider is waiting for your order",
      color: "bg-green-600",
      iconType: 'rider'
    },
    ready: {
      title: "Handover in progress",
      subtitle: "Rider is picking up your order",
      color: "bg-green-600",
      iconType: 'rider'
    },
    on_way: {
      title: "Out for delivery",
      subtitle: typeof estimatedTime === 'number' ? `Arriving in ${estimatedTime} mins` : "Rider is out for delivery",
      color: "bg-green-600",
      iconType: 'rider'
    },
    at_drop: {
      title: "Arrived at location",
      subtitle: "Please come to the door",
      color: "bg-green-600",
      iconType: 'rider'
    },
    delivered: {
      title: "Order delivered",
      subtitle: "Enjoy your meal!",
      color: "bg-green-600",
      iconType: 'delivered'
    },
    cancelled: {
      title: "Order cancelled",
      subtitle:
        order?.failureReason === 'driver_not_found'
          ? "No delivery partner found — order cancelled"
          : order?.cancellationReason || "This order has been cancelled",
      color: "bg-red-600",
      iconType: 'cancelled'
    }
  }

  const currentStatus = statusConfig[orderStatus] || statusConfig.placed
  const isScheduledOrder = Boolean(order?.scheduledAt) && !['delivered', 'cancelled'].includes(orderStatus)
  const scheduledDateFormatted = order?.scheduledAt
    ? new Date(order.scheduledAt).toLocaleString("en-IN", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null
  const isDeliveredOrder =
    orderStatus === "delivered" ||
    order?.status === "delivered" ||
    Boolean(order?.deliveredAt)

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-[#0a0a0a]">
      {/* Order Confirmed Modal */}
      <AnimatePresence>
        {showConfirmation && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-white dark:bg-[#1a1a1a] flex flex-col items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, type: "spring" }}
              className="text-center px-8"
            >
              <AnimatedCheckmark delay={0.3} />
              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.9 }}
                className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-6"
              >
                {isScheduledOrder ? "Order Scheduled!" : "Order Confirmed!"}
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.1 }}
                className="text-gray-600 dark:text-gray-300 mt-2"
              >
                {isScheduledOrder
                  ? `Scheduled for ${scheduledDateFormatted}`
                  : "Your order has been placed successfully"}
              </motion.p>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.5 }}
                className="mt-8"
              >
                <div className="w-8 h-8 border-2 border-[#16A34A] border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-sm text-gray-500 mt-3">Loading order details...</p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 2.0 }}
                className="mt-12 pt-8 border-t border-gray-100 dark:border-gray-800"
              >
                <div className="flex items-center justify-center gap-2 text-[#16A34A] dark:text-orange-400 font-medium cursor-pointer hover:opacity-80 transition-opacity" onClick={() => navigate('/user/profile/report-safety-emergency', { state: { returnTo: location.pathname } })}>
                  <Shield className="w-4 h-4" />
                  <span className="text-sm">Learn about delivery partner safety</span>
                </div>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Green Header */}
      <motion.div
        className={`${currentStatus.color} text-white sticky top-0 z-40`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        {/* Navigation bar */}
        <div className="flex items-center justify-between px-4 py-3">
          <Link to="/user/orders">
            <motion.button
              className="w-10 h-10 flex items-center justify-center"
              whileTap={{ scale: 0.9 }}
            >
              <ArrowLeft className="w-6 h-6" />
            </motion.button>
          </Link>
          <h2 className="font-semibold text-lg">
            {order.isMultiRestaurant ? "Multiple Restaurants" : (order.restaurant || companyName)}
          </h2>
          <motion.button
            className="w-10 h-10 flex items-center justify-center cursor-pointer"
            whileTap={{ scale: 0.9 }}
            onClick={handleShare}
          >
            <Share2 className="w-5 h-5" />
          </motion.button>
        </div>

        {/* Status section - hidden for success milestones as requested */}
        {isScheduledOrder && ['placed', 'confirmed'].includes(orderStatus) ? (
          <div className="px-4 pb-5 text-center">
            <motion.div
              className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm rounded-full px-4 py-1.5 mb-3"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
            >
              <Clock className="w-4 h-4" />
              <span className="text-sm font-semibold">Scheduled Order</span>
            </motion.div>
            <motion.h1
              className="text-2xl font-bold mb-2"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              Order Scheduled
            </motion.h1>
            <motion.div
              className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm rounded-full px-5 py-2.5"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              <Calendar className="w-4 h-4" />
              <span className="text-sm font-medium">{scheduledDateFormatted}</span>
              <span className="w-1 h-1 rounded-full bg-white/60" />
              <motion.button
                onClick={handleRefresh}
                className="ml-1"
                animate={{ rotate: isRefreshing ? 360 : 0 }}
                transition={{ duration: 0.5 }}
              >
                <RefreshCw className="w-4 h-4" />
              </motion.button>
            </motion.div>
            <motion.p
              className="text-xs mt-3 text-white/80"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
            >
              The restaurant will start preparing your order closer to the scheduled time
            </motion.p>
          </div>
        ) : !['at_pickup', 'ready', 'on_way', 'at_drop', 'delivered'].includes(orderStatus) && (
          <div className="px-4 pb-4 text-center">
            <motion.h1
              className="text-2xl font-bold mb-3"
              key={currentStatus.title}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {currentStatus.title}
            </motion.h1>

            {/* Status pill */}
            <motion.div
              className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm rounded-full px-4 py-2"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              <span className="text-sm">{currentStatus.subtitle}</span>
              {orderStatus === 'preparing' && (
                <>
                  <span className="w-1 h-1 rounded-full bg-white" />
                  <span className="text-sm text-orange-200">On time</span>
                </>
              )}
              <motion.button
                onClick={handleRefresh}
                className="ml-1"
                animate={{ rotate: isRefreshing ? 360 : 0 }}
                transition={{ duration: 0.5 }}
              >
              <RefreshCw className="w-4 h-4" />
            </motion.button>
          </motion.div>
        </div>
      )}
      </motion.div>

      {/* Smart Status Banner */}
      {order && !['delivered', 'cancelled'].includes(orderStatus) && (
        <StatusBanner order={order} />
      )}

      {/* Hero Section / Map */}
      {!isDeliveredOrder && orderStatus !== 'cancelled' && !(isScheduledOrder && ['placed', 'confirmed'].includes(orderStatus)) && (
        <MapErrorBoundary>
          <DeliveryMap
            orderId={orderId}
            order={order}
            isVisible={order !== null}
            fallbackCustomerCoords={fallbackCustomerCoords}
            userLiveCoords={userLiveCoords}
            userLocationAccuracy={userLiveLocation?.accuracy ?? null}
            onEtaUpdate={handleEtaUpdate}
          />
        </MapErrorBoundary>
      )}

      {/* Scrollable Content */}
      <div className="max-w-4xl mx-auto px-4 md:px-6 lg:px-8 py-4 md:py-6 space-y-4 md:space-y-6 pb-24 md:pb-32">
        {/* Cancellation window removed as per user request to hide immediately after acceptance */}

        {!isDeliveredOrder && orderStatus !== 'cancelled' && !isScheduledOrder && (speedEtaLabel || typeof estimatedTime === 'number') && (
          <motion.div
            className="bg-white dark:bg-[#1a1a1a] rounded-xl p-4 shadow-sm border border-green-100 dark:border-green-900/40"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-green-50 dark:bg-green-950/40 flex items-center justify-center shrink-0">
                <Clock className="w-6 h-6 text-[#16A34A]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                  {order?.deliveryOption ? `${order.deliveryOption} · Estimated delivery` : 'Estimated delivery'}
                </p>
                <p className="text-xl font-extrabold text-gray-900 dark:text-white leading-tight mt-0.5">
                  {speedEtaLabel || `${estimatedTime} mins`}
                </p>
                {['confirmed', 'preparing', 'ready', 'on_way', 'at_pickup', 'at_drop'].includes(orderStatus) &&
                  typeof estimatedTime === 'number' && (
                  <p className="text-sm text-[#16A34A] font-semibold mt-0.5">
                    Arriving in ~{estimatedTime} min{estimatedTime === 1 ? '' : 's'}
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {customerLegOtps.length > 0 && orderStatus !== 'delivered' && orderStatus !== 'cancelled' && (
          <motion.div
            className="bg-blue-50 dark:bg-blue-900/10 rounded-xl p-4 shadow-sm border border-blue-100 dark:border-blue-900/30 space-y-3"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.28 }}
          >
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wide">
              {customerLegOtps.length > 1 ? 'Delivery OTPs' : 'Delivery OTP'}
            </p>
            <div className={customerLegOtps.length > 1 ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : ''}>
              {customerLegOtps.map((leg, idx) => {
                const partner = deliveryPartnersList.find(
                  (p) =>
                    (leg.partnerId && String(p.id) === String(leg.partnerId)) ||
                    ((leg.role === 'shared' || leg.role === 'secondary') && p.role === 'shared') ||
                    (leg.role === 'primary' && p.role === 'primary'),
                ) || deliveryPartnersList[idx]
                const roleLabel =
                  partner?.role === 'shared' || leg.role === 'shared' || leg.role === 'secondary'
                    ? 'Partner rider'
                    : partner?.role === 'primary' || leg.role === 'primary'
                      ? 'Lead rider'
                      : `Rider ${idx + 1}`
                return (
                  <div
                    key={`otp-${leg.legIndex ?? leg.partnerId ?? idx}`}
                    className="bg-white/70 dark:bg-black/20 rounded-lg p-3 border border-blue-100/80 dark:border-blue-900/40"
                  >
                    <p className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                      OTP for {partner?.name || roleLabel}
                    </p>
                    <p className="text-[11px] text-blue-700/80 dark:text-blue-300/80 mt-0.5">
                      {roleLabel}
                      {partner?.phone ? ` · ${partner.phone}` : ''}
                    </p>
                    <p className="text-2xl font-extrabold text-blue-900 dark:text-blue-200 mt-1 tracking-widest">{leg.otp}</p>
                    {partner?.phone ? (
                      <button
                        type="button"
                        onClick={(e) => handleCallRider(e, partner.phone)}
                        className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        Call {partner.name?.split(' ')[0] || 'rider'}
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-blue-700 dark:text-blue-400">
              {customerLegOtps.length > 1
                ? 'Share each OTP only with the matching delivery partner named above.'
                : 'Share this 4-digit OTP with your delivery partner at drop-off.'}
            </p>
          </motion.div>
        )}

        {/* Dynamic Status Card */}
        <motion.div
          className="bg-white dark:bg-[#1a1a1a] rounded-xl p-3 sm:p-4 shadow-sm"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          {isScheduledOrder && ['placed', 'confirmed'].includes(orderStatus) ? (
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm border border-blue-100 bg-blue-50">
                <Clock className="w-7 h-7 text-blue-600" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900 dark:text-gray-100 leading-tight">Order Scheduled</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 leading-snug">
                  {scheduledDateFormatted}
                </p>
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                  We'll notify you when the restaurant starts preparing
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm border border-gray-100 dark:border-gray-800 ${
                currentStatus.iconType === 'rider' ? 'bg-blue-50 dark:bg-blue-900/20' : 
                currentStatus.iconType === 'cancelled' ? 'bg-red-50 dark:bg-red-900/20' : 
                currentStatus.iconType === 'delivered' ? 'bg-green-50 dark:bg-green-900/20' : 
                'bg-orange-50 dark:bg-orange-900/20'
              }`}>
                {currentStatus.iconType === 'rider' ? (
                  <div 
                    dangerouslySetInnerHTML={{ __html: RIDER_BIKE_SVG.replace(/width="\d+"/, 'width="100%"').replace(/height="\d+"/, 'height="100%"') }} 
                    className="w-full h-full" 
                  />
                ) : currentStatus.iconType === 'cancelled' ? (
                  <div className="w-full h-full flex items-center justify-center p-2 text-red-500">
                    <X className="w-full h-full" />
                  </div>
                ) : currentStatus.iconType === 'delivered' ? (
                  <div className="w-full h-full flex items-center justify-center p-2 text-green-500">
                    <Check className="w-full h-full" />
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center p-2 text-orange-500">
                    <Receipt className="w-full h-full" />
                  </div>
                )}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900 dark:text-gray-100 leading-tight">{currentStatus.title}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 leading-snug">{currentStatus.subtitle}</p>
              </div>
            </div>
          )}
        </motion.div>

        {/* Rating Logic: Show rating card after delivery */}
        {orderStatus === 'delivered' && !isOrderRated && (
          <motion.div
            className="bg-white dark:bg-[#1a1a1a] rounded-xl p-6 shadow-sm border-2 border-[#16A34A]/10 relative overflow-hidden group"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
          >
            {/* Background pattern decoration */}
            <div className="absolute -top-4 -right-4 w-24 h-24 bg-[#16A34A]/5 rounded-full blur-2xl group-hover:bg-[#16A34A]/10 transition-colors" />
            
            <div className="flex flex-col items-center text-center relative z-10">
              <div className="w-16 h-16 bg-[#16A34A]/10 dark:bg-[#16A34A]/20 rounded-full flex items-center justify-center mb-4 transition-transform group-hover:scale-110 duration-300">
                <Star className="w-8 h-8 text-[#16A34A] fill-[#16A34A]" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Enjoyed your food?</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 mb-6 max-w-[280px]">
                Rate <span className="font-semibold text-gray-700 dark:text-gray-300">{order?.restaurant || "the restaurant"}</span>
                {hasDeliveryPartner
                  ? ` and ${order?.deliveryPartnerName || "your delivery partner"}`
                  : ""}{" "}
                to help us improve!
              </p>
              
              <Button 
                onClick={handleOpenRating}
                className="w-full max-w-[200px] bg-[#16A34A] hover:bg-[#15803D] text-white font-bold h-12 rounded-xl border-none shadow-lg shadow-[#16A34A]/20"
              >
                Rate Restaurant & Driver
              </Button>
            </div>
          </motion.div>
        )}

        {/* Rating Summary: Show what the user rated */}
        {orderStatus === 'delivered' && isOrderRated && (
          <motion.div
            className="bg-white dark:bg-[#1a1a1a] rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-800"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-50 dark:border-gray-800/50">
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                Your Feedback
              </h3>
              <button 
                onClick={handleOpenRating}
                className="text-[10px] font-bold text-[#16A34A] dark:text-orange-400 uppercase tracking-widest hover:opacity-80 transition-opacity"
              >
                Edit Rating
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Food & Restaurant</span>
                  {order?.ratings?.restaurant?.comment && (
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 italic mt-0.5 line-clamp-1">"{order.ratings.restaurant.comment}"</span>
                  )}
                </div>
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={`res-rated-${star}`}
                      className={`w-3.5 h-3.5 ${
                        star <= (order?.ratings?.restaurant?.rating || order?.restaurantRating)
                          ? "text-yellow-400 fill-yellow-400"
                          : "text-gray-200 dark:text-gray-800"
                      }`}
                    />
                  ))}
                </div>
              </div>
              
              {hasDeliveryPartner && (
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Delivery Service</span>
                    {order?.ratings?.deliveryPartner?.comment && (
                      <span className="text-[10px] text-gray-500 dark:text-gray-400 italic mt-0.5 line-clamp-1">"{order.ratings.deliveryPartner.comment}"</span>
                    )}
                  </div>
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={`del-rated-${star}`}
                        className={`w-3.5 h-3.5 ${
                          star <= (order?.ratings?.deliveryPartner?.rating || order?.deliveryPartnerRating)
                            ? "text-yellow-400 fill-yellow-400"
                            : "text-gray-200 dark:text-gray-800"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Delivery Partner Info — one or two riders */}
        {deliveryPartnersList.length > 0 && (
          <motion.div
            className="bg-white dark:bg-[#1a1a1a] rounded-xl shadow-sm overflow-hidden"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55 }}
          >
            {deliveryPartnersList.length > 1 && (
              <div className="px-4 pt-3">
                <p className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                  2 delivery partners on this order
                </p>
              </div>
            )}
            {deliveryPartnersList.map((partner, idx) => (
              <div
                key={partner.id || idx}
                className={`flex items-center gap-3 p-4 ${idx < deliveryPartnersList.length - 1 || order?.note ? 'border-b border-dashed border-gray-200 dark:border-gray-800' : ''}`}
              >
                <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-900/20 overflow-hidden flex items-center justify-center flex-shrink-0 border border-blue-100 dark:border-blue-900/30 p-1 relative">
                  {partner.avatar ? (
                    <img src={partner.avatar} alt="Rider" className="w-full h-full object-cover" />
                  ) : (
                    <div
                      dangerouslySetInnerHTML={{ __html: RIDER_BIKE_SVG.replace(/width="\d+"/, 'width="100%"').replace(/height="\d+"/, 'height="100%"') }}
                      className="w-full h-full p-1"
                    />
                  )}
                  {deliveryPartnersList.length > 1 && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">
                      {idx + 1}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">{partner.name}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {orderStatus === 'delivered'
                      ? 'Delivered your order'
                      : deliveryPartnersList.length > 1
                        ? (partner.role === 'shared' ? 'Partner rider' : 'Lead rider')
                        : 'Your delivery partner is arriving'}
                  </p>
                  {partner.phone ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{partner.phone}</p>
                  ) : null}
                </div>
                <motion.button
                  className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center"
                  onClick={(e) => handleCallRider(e, partner.phone)}
                  whileTap={{ scale: 0.9 }}
                >
                  <Phone className="w-5 h-5 text-blue-600" />
                </motion.button>
              </div>
            ))}
            {order?.note && (
              <div className="bg-blue-50/50 dark:bg-blue-900/10 p-3 mx-4 mb-4 rounded-lg flex items-start gap-2 border border-blue-100 dark:border-blue-900/20">
                <MessageSquare className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-0.5">Instruction for Rider</p>
                  <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed font-medium">"{order.note}"</p>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* Delivery Partner Safety */}
        {orderStatus !== 'delivered' && orderStatus !== 'cancelled' && (
          <motion.button
            className="w-full bg-white dark:bg-[#1a1a1a] rounded-xl p-4 shadow-sm flex items-center gap-3"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            whileTap={{ scale: 0.99 }}
            onClick={() => navigate('/user/profile/report-safety-emergency', { state: { returnTo: location.pathname } })}
          >
            <Shield className="w-6 h-6 text-gray-600 dark:text-gray-400" />
            <span className="flex-1 text-left font-medium text-gray-900 dark:text-gray-100">
              Learn about delivery partner safety
            </span>
            <ChevronRight className="w-5 h-5 text-gray-400" />
          </motion.button>
        )}

        {/* Delivery Details Banner */}
        {orderStatus !== 'delivered' && orderStatus !== 'cancelled' && (
          <motion.div
            className="bg-yellow-50 dark:bg-yellow-900/10 rounded-xl p-4 text-center border dark:border-yellow-900/30"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.65 }}
          >
            <p className="text-yellow-800 dark:text-yellow-400 font-medium text-sm">
              All your delivery details in one place 🥡
            </p>
          </motion.div>
        )}

        {/* Contact & Address Section */}
        <motion.div
          className="bg-white dark:bg-[#1a1a1a] rounded-xl shadow-sm overflow-hidden"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
        >
          <SectionItem
            icon={User}
            title={
              order?.userName ||
              order?.userId?.fullName ||
              order?.userId?.name ||
              profile?.fullName ||
              profile?.name ||
              'Customer'
            }
            subtitle={
              order?.userPhone ||
              order?.userId?.phone ||
              profile?.phone ||
              defaultAddress?.phone ||
              'Phone number not available'
            }
            showArrow={false}
          />
          <SectionItem
            iconNode={
              <div
                dangerouslySetInnerHTML={{ __html: SAFE_CUSTOMER_PIN }}
                className="w-6 h-6 [&_svg]:w-full [&_svg]:h-full [&_svg]:block"
              />
            }
            title="Delivery at Location"
            subtitle={(() => {
              // Priority 1: Use order address formattedAddress (live location address)
              if (order?.address?.formattedAddress && order.address.formattedAddress !== "Select location") {
                return order.address.formattedAddress
              }

              // Priority 2: Build full address from order address parts
              if (order?.address) {
                const orderAddressParts = []
                if (order.address.street) orderAddressParts.push(order.address.street)
                if (order.address.additionalDetails) orderAddressParts.push(order.address.additionalDetails)
                if (order.address.city) orderAddressParts.push(order.address.city)
                if (order.address.state) orderAddressParts.push(order.address.state)
                if (order.address.zipCode) orderAddressParts.push(order.address.zipCode)
                if (orderAddressParts.length > 0) {
                  return orderAddressParts.join(', ')
                }
              }

              // Priority 3: Use defaultAddress formattedAddress (live location address)
              if (defaultAddress?.formattedAddress && defaultAddress.formattedAddress !== "Select location") {
                return defaultAddress.formattedAddress
              }

              // Priority 4: Build full address from defaultAddress parts
              if (defaultAddress) {
                const defaultAddressParts = []
                if (defaultAddress.street) defaultAddressParts.push(defaultAddress.street)
                if (defaultAddress.additionalDetails) defaultAddressParts.push(defaultAddress.additionalDetails)
                if (defaultAddress.city) defaultAddressParts.push(defaultAddress.city)
                if (defaultAddress.state) defaultAddressParts.push(defaultAddress.state)
                if (defaultAddress.zipCode) defaultAddressParts.push(defaultAddress.zipCode)
                if (defaultAddressParts.length > 0) {
                  return defaultAddressParts.join(', ')
                }
              }

              return 'Add delivery address'
            })()}
            showArrow={false}
          />
          {!isAdminAccepted && orderStatus !== 'cancelled' && orderStatus !== 'delivered' && (
            <SectionItem
              icon={MessageSquare}
              title={order?.note ? "Edit delivery instructions" : "Add delivery instructions"}
              subtitle={order?.note ? order.note.substring(0, 35) + (order.note.length > 35 ? "..." : "") : ""}
              onClick={() => {
                setDeliveryInstructions(order?.note || "");
                setIsInstructionsModalOpen(true);
              }}
            />
          )}
        </motion.div>

        {/* Restaurant Section */}
        {Array.isArray(order.partialRefunds) && order.partialRefunds.length > 0 ? (
          <motion.div
            className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl p-4"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <p className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-200 mb-2">
              Partial refunds
            </p>
            <div className="space-y-1.5">
              {order.partialRefunds.map((entry, idx) => (
                <div
                  key={`${entry.restaurantId || idx}-${entry.at || idx}`}
                  className="flex items-center justify-between gap-2 text-sm text-amber-900 dark:text-amber-100"
                >
                  <span>
                    {entry.restaurantName || 'Restaurant'} cancelled
                    {entry.status === 'failed' ? ' (refund pending)' : ''}
                  </span>
                  <span className="font-semibold">
                    ₹{Number(entry.amount || 0).toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        ) : null}
        {(order.pickups && order.pickups.length > 0 ? order.pickups : [{
          restaurantName: order.restaurant,
          restaurantAddress: order.restaurantAddress,
          phone: order.restaurantPhone
        }]).map((pickup, pIdx) => (
          <motion.div
            key={`pickup-card-${pIdx}`}
            className={`bg-white dark:bg-[#1a1a1a] rounded-xl shadow-sm overflow-hidden ${
              pickup.permanentlyDropped || String(pickup.status || '').toLowerCase() === 'cancelled'
                ? 'opacity-75'
                : ''
            }`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.75 + (pIdx * 0.05) }}
          >
            <div className="flex items-center gap-3 p-4 border-b border-dashed border-gray-200 dark:border-gray-800">
              <div className="w-12 h-12 rounded-full bg-orange-100 overflow-hidden flex items-center justify-center flex-shrink-0">
                <div
                  dangerouslySetInnerHTML={{ __html: SAFE_RESTAURANT_PIN }}
                  className="w-7 h-7 [&_svg]:w-full [&_svg]:h-full [&_svg]:block"
                />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                   <p className="font-semibold text-gray-900 dark:text-gray-100">{pickup.restaurantName || order.restaurant}</p>
                   {(pickup.permanentlyDropped || String(pickup.status || '').toLowerCase() === 'cancelled') && (
                     <span className="bg-rose-100 text-rose-700 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">Cancelled</span>
                   )}
                   {pickup.status === 'picked_up' && (
                     <span className="bg-green-100 text-green-700 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">Picked</span>
                   )}
                   {pickup.status === 'ready' && (
                     <span className="bg-blue-100 text-blue-700 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">Rider Arrived</span>
                   )}
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">{pickup.restaurantAddress || order.restaurantAddress || 'Restaurant location'}</p>
              </div>
              <motion.button
                className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center"
                onClick={() => {
                  const phone = pickup.phone || order.restaurantPhone;
                  if (phone) window.location.href = `tel:${phone}`;
                  else toast.error("Phone number not available");
                }}
                whileTap={{ scale: 0.9 }}
              >
                <Phone className="w-5 h-5 text-[#16A34A]" />
              </motion.button>
            </div>
            
            {/* If there's multiple restaurants, show items for this specific restaurant */}
            {order.isMultiRestaurant && pickup.items && pickup.items.length > 0 && (
              <div className="p-4 bg-gray-50/50 dark:bg-gray-800/20 border-b border-dashed border-gray-100 dark:border-gray-800">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Items from this restaurant</p>
                <div className="space-y-1">
                  {pickup.items.map((itemName, iIdx) => (
                    <div key={iIdx} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                      <div className="w-1 h-1 rounded-full bg-green-500" />
                      <span>{itemName}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        ))}

        {/* Order Items Card */}
        <motion.div
          className="bg-white dark:bg-[#1a1a1a] rounded-xl shadow-sm overflow-hidden"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.85 }}
        >
          <div
            className="p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
            onClick={() => setShowOrderDetails(true)}
          >
            <div className="flex items-start gap-3">
              <Receipt className="w-5 h-5 text-gray-500 mt-0.5" />
              <div className="flex-1">
                <div className="mt-2 space-y-1">
                  {order?.items?.map((item, index) => (
                    <div key={index} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <span className="w-4 h-4 rounded border border-green-600 flex items-center justify-center">
                        <span className="w-2 h-2 rounded-full bg-green-600" />
                      </span>
                      <span>{item.quantity} x {item.name}{item.variantName ? ` (${item.variantName})` : ""}</span>
                    </div>
                  ))}
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </div>
          </div>
        </motion.div>

        {isDriverNotFoundCancelled && (
          <motion.div
            className="bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/40 rounded-xl p-5 space-y-4"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <p className="text-sm text-red-800 dark:text-red-200 leading-relaxed">
              We couldn&apos;t find an available delivery partner near the restaurant.
              {order?.payment?.refund?.destination === 'wallet'
                ? ` ₹${Number(order?.pricing?.total || 0).toFixed(0)} has been credited to your wallet.`
                : order?.payment?.status === 'refunded'
                  ? ' Any prepaid amount will be refunded to your wallet.'
                  : ''}
            </p>
            <Button
              onClick={handleReorder}
              className="w-full bg-[#16A34A] hover:bg-[#15803D] text-white font-bold h-12 rounded-xl"
            >
              Re-order same items
            </Button>
          </motion.div>
        )}

        {(() => {
          const rawStatus = String(order?.orderStatus || order?.status || '').toLowerCase()
          const canUserCancel =
            (rawStatus === 'created' || rawStatus === 'scheduled') &&
            !rawStatus.includes('cancel') &&
            rawStatus !== 'delivered'
          if (!canUserCancel) return null
          return (
          <motion.div
            className="flex flex-col gap-3"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
          >
            <Button
              variant="outline"
              className="w-full text-red-600 border-red-100 hover:bg-red-50 h-12 rounded-xl font-semibold"
              onClick={handleCancelOrder}
            >
              Cancel Order
            </Button>
            <p className="text-[10px] text-gray-400 text-center px-4">
              You can cancel only while the order is created or scheduled (before restaurant acceptance).
            </p>
          </motion.div>
          )
        })()}

      </div>

      {/* Cancel Order Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent className="sm:max-w-xl w-[95%] max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-gray-900">
              Cancel Order
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-6 px-2">
            {(() => {
              const method = String(order?.payment?.method || order?.paymentMethod || "").toLowerCase()
              const status = String(order?.payment?.status || "").toLowerCase()
              const isRazorpayPaid =
                method === "razorpay" && ["paid", "authorized", "captured", "settled", "refunded"].includes(status)

              if (!isRazorpayPaid) return null

              return (
                <div className="space-y-1 rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <p className="text-sm font-semibold text-gray-900">Refund</p>
                  <p className="text-sm text-gray-700">The full amount you paid will be credited to your wallet instantly.</p>
                </div>
              )
            })()}

            <div className="space-y-2 w-full">
              <Textarea
                value={cancellationReason}
                onChange={(e) => setCancellationReason(e.target.value)}
                placeholder="e.g., Changed my mind, Wrong address, etc."
                className="w-full min-h-[100px] resize-none border-2 border-gray-300 rounded-lg px-4 py-3 text-sm focus:border-red-500 focus:ring-2 focus:ring-red-200 focus:outline-none transition-colors disabled:bg-gray-100 disabled:cursor-not-allowed disabled:border-gray-200"
                disabled={isCancelling}
              />
            </div>
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCancelDialog(false);
                  setCancellationReason("");
                  setRefundDestination("source");
                }}
                disabled={isCancelling}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmCancel}
                disabled={isCancelling || !cancellationReason.trim()}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white"
              >
                {isCancelling ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Cancelling...
                  </>
                ) : (
                  'Confirm Cancellation'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Order Details Dialog */}
      <Dialog open={showOrderDetails} onOpenChange={setShowOrderDetails}>
        <DialogContent className="max-w-[calc(100vw-32px)] sm:max-w-md bg-white dark:bg-[#1a1a1a] rounded-2xl p-0 overflow-hidden border-none outline-none">
          <DialogHeader className="p-6 pb-4 border-b border-gray-100 dark:border-gray-800 pr-12">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-xl font-bold text-gray-900">Order Details</DialogTitle>
            </div>
          </DialogHeader>

          <div className="p-6 pt-4 space-y-6 max-h-[70vh] overflow-y-auto">
            {/* Order Meta Info */}
            <div className="flex flex-col gap-1 b">
              <div className="flex items-center gap-4 mt-2">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Date & Time</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {order?.createdAt ? new Date(order.createdAt).toLocaleString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true
                    }) : 'N/A'}
                  </p>
                </div>
                <div className="h-8 w-px bg-gray-100" />
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Status</p>
                  <span className="text-sm font-bold text-green-600 uppercase">
                    {order?.status?.replace('_', ' ')}
                  </span>
                </div>
              </div>
            </div>

            {/* Delivery Instructions Section */}
            {order?.note && (
              <div className="bg-orange-50/50 rounded-xl p-4 border border-orange-100 flex gap-3">
                <MessageSquare className="w-5 h-5 text-[#16A34A] shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-#15803D font-bold uppercase tracking-wider mb-1">Delivery Instructions</p>
                  <p className="text-sm text-gray-800 leading-relaxed font-medium capitalize">
                    {order.note}
                  </p>
                </div>
              </div>
            )}

            {/* Items Section */}
            <div>
              <p className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">Order Items</p>
              <div className="space-y-4">
                {order?.items?.map((item, index) => (
                  <div key={index} className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="w-5 h-5 rounded border border-green-600 flex items-center justify-center mt-0.5 shrink-0">
                        <div className="w-2.5 h-2.5 rounded-full bg-green-600" />
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-gray-900 leading-tight">{item.name}</p>
                        {item.variantName ? (
                          <p className="text-sm text-gray-500 mt-0.5">{item.variantName}</p>
                        ) : null}
                        <p className="text-sm text-gray-500 mt-0.5">Quantity: {item.quantity}</p>
                      </div>
                    </div>
                    <p className="font-semibold text-gray-900">₹{((item?.price || 0) * (item?.quantity || 0)).toFixed(2)}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Bill Summary */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              <p className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-1">Bill Summary</p>
              
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">Item Total</span>
                <span className="text-gray-900 font-medium">₹{Number(order?.subtotal || 0).toFixed(2)}</span>
              </div>

              {Number(order?.packagingFee) > 0 && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">Packaging Charges</span>
                  <span className="text-gray-900 font-medium">₹{Number(order.packagingFee).toFixed(2)}</span>
                </div>
              )}

              {Number(order?.platformFee) > 0 && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">Platform Fee</span>
                  <span className="text-gray-900 font-medium">₹{Number(order.platformFee).toFixed(2)}</span>
                </div>
              )}

              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">Delivery Fee</span>
                <span className="text-gray-900 font-medium">₹{Number(order?.deliveryFee || 0).toFixed(2)}</span>
              </div>

              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">GST</span>
                <span className="text-gray-900 font-medium">₹{Number(order?.gst || 0).toFixed(2)}</span>
              </div>

              {Number(order?.discount) > 0 && (
                <div className="flex justify-between items-center text-sm text-green-600 font-medium">
                  <span>Discount Applied</span>
                  <span>-₹{Number(order.discount).toFixed(2)}</span>
                </div>
              )}

              <div className="pt-2 border-t border-gray-200 dark:border-gray-800 flex justify-between items-center">
                <span className="text-base font-bold text-gray-900 dark:text-white">Total Amount</span>
                <span className="text-lg font-bold text-gray-900 dark:text-white">₹{Number(order?.totalAmount || 0).toFixed(2)}</span>
              </div>
            </div>

            {/* Payment Method */}
            {order?.paymentMethod && (
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2 text-gray-600">
                  <Shield className="w-4 h-4" />
                  <span className="text-sm font-medium">Payment Method</span>
                </div>
                <span className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                  {order.paymentMethod}
                </span>
              </div>
            )}
          </div>

          <div className="p-6 border-t border-gray-100">
            <Button
              onClick={() => setShowOrderDetails(false)}
              className="w-full bg-gray-900 text-white font-bold h-12 rounded-xl"
            >
              Okay
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delivery Instructions Modal */}
      <Dialog open={isInstructionsModalOpen} onOpenChange={setIsInstructionsModalOpen}>
        <DialogContent className="sm:max-w-md w-[95vw] rounded-3xl p-6 border-0 shadow-2xl bg-white dark:bg-[#1a1a1a] max-h-[90vh] overflow-y-auto z-[200]">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-xl font-bold bg-gradient-to-r from-#15803D to-orange-400 bg-clip-text text-transparent">
              Delivery Instructions
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Add instructions for the delivery partner to help them find your address or know where to leave your order.
            </p>
            <Textarea
              value={deliveryInstructions}
              onChange={(e) => setDeliveryInstructions(e.target.value)}
              placeholder="E.g. Ring the doorbell, leave at the front desk..."
              className="min-h-[120px] resize-none border-gray-200 focus:ring-[#16A34A] rounded-xl bg-gray-50 text-base"
            />
            <Button 
              onClick={handleUpdateInstructions} 
              disabled={isUpdatingInstructions}
              className="w-full bg-gradient-to-r from-[#16A34A] to-amber-500 hover:from-#15803D hover:to-amber-600 text-white font-bold h-12 rounded-xl border-none"
            >
              {isUpdatingInstructions ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Save Instructions"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rating & Feedback Modal */}
      <Dialog open={showRatingModal} onOpenChange={setShowRatingModal}>
        <DialogContent className="sm:max-w-md w-[95vw] rounded-3xl p-6 border-0 shadow-2xl bg-white dark:bg-[#1a1a1a] max-h-[90vh] overflow-y-auto">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Star className="w-6 h-6 text-[#16A34A] fill-[#16A34A]" />
              Rate restaurant & driver
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-2">
            {/* Restaurant Rating */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-gray-800 dark:text-gray-200">How was the food?</p>
                <span className="text-xs px-2 py-0.5 bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400 rounded-full font-medium">Restaurant</span>
              </div>
              <div className="flex justify-center gap-3">
                {[1, 2, 3, 4, 5].map((star) => (
                  <motion.button
                    key={`res-star-${star}`}
                    whileHover={{ scale: 1.15 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setSelectedRestaurantRating(star)}
                    className="p-1"
                  >
                    <Star
                      className={`w-10 h-10 transition-all duration-300 ${
                        star <= selectedRestaurantRating
                          ? "text-yellow-400 fill-yellow-400 drop-shadow-sm"
                          : "text-gray-200 dark:text-gray-800"
                      }`}
                    />
                  </motion.button>
                ))}
              </div>
              <Textarea
                placeholder="Write a quick review for the food (optional)"
                value={restaurantFeedbackText}
                onChange={(e) => setRestaurantFeedbackText(e.target.value)}
                className="min-h-[80px] text-sm bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-800 resize-none rounded-xl"
              />
            </div>

            {/* Delivery Rating */}
            {hasDeliveryPartner && (
              <div className="space-y-3 pt-4 border-t border-gray-100 dark:border-gray-800">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-gray-800 dark:text-gray-200">How was the delivery?</p>
                  <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400 rounded-full font-medium">Delivery</span>
                </div>
                <div className="flex justify-center gap-3">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <motion.button
                      key={`del-star-${star}`}
                      whileHover={{ scale: 1.15 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => setSelectedDeliveryRating(star)}
                      className="p-1"
                    >
                      <Star
                        className={`w-10 h-10 transition-all duration-300 ${
                          star <= selectedDeliveryRating
                            ? "text-yellow-400 fill-yellow-400 drop-shadow-sm"
                            : "text-gray-200 dark:text-gray-800"
                        }`}
                      />
                    </motion.button>
                  ))}
                </div>
                <Textarea
                  placeholder={`How was ${order?.deliveryPartnerName || 'the rider'}? (optional)`}
                  value={deliveryFeedbackText}
                  onChange={(e) => setDeliveryFeedbackText(e.target.value)}
                  className="min-h-[80px] text-sm bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-800 resize-none rounded-xl"
                />
              </div>
            )}

            <Button
              onClick={handleSubmitRating}
              disabled={submittingRating || selectedRestaurantRating === null || (hasDeliveryPartner && selectedDeliveryRating === null)}
              className="w-full bg-[#16A34A] hover:bg-[#15803D] text-white font-bold h-14 rounded-2xl shadow-lg mt-4"
            >
              {submittingRating ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Submit Feedback"}
            </Button>
            
            <button
              onClick={() => setShowRatingModal(false)}
              className="w-full text-sm text-gray-400 dark:text-gray-500 font-medium hover:text-gray-600 dark:hover:text-gray-400 transition-colors py-2"
            >
              Maybe later
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {partialDropPopup && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-2xl">
            <h3 className="text-lg font-black text-gray-900 dark:text-white uppercase tracking-tight">
              Restaurant removed
            </h3>
            <p className="mt-3 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              {partialDropPopup.message ||
                `${partialDropPopup.restaurantName} rejected your order. ₹${Number(partialDropPopup.refundAmount || 0).toFixed(0)} has been refunded to your wallet. Your order continues with the remaining restaurant(s).`}
            </p>
            {Number(partialDropPopup.refundAmount) > 0 && (
              <p className="mt-3 text-sm font-bold text-[#16A34A]">
                ₹{Number(partialDropPopup.refundAmount).toFixed(0)} credited to wallet
              </p>
            )}
            <Button
              className="w-full mt-6 bg-[#16A34A] hover:bg-[#15803D] text-white font-bold h-12 rounded-2xl"
              onClick={() => setPartialDropPopup(null)}
            >
              Got it
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}


