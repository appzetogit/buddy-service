import { useState, useEffect, useRef, useMemo, Fragment } from "react"
import { createPortal } from "react-dom"
import { Link, useNavigate } from "react-router-dom"
import { Plus, Minus, ArrowLeft, ChevronRight, Clock, MapPin, Phone, FileText, Utensils, Tag, Percent, Share2, ChevronUp, ChevronDown, X, Check, Settings, CreditCard, Wallet, Building2, Sparkles, Zap, CheckCircle2, MessageCircle, Send, Mail, Copy, AlertCircle, Leaf, Bike, Truck, Info } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import confetti from "canvas-confetti"

import AnimatedPage from "@food/components/user/AnimatedPage"
import { Button } from "@food/components/ui/button"
import { Badge } from "@food/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@food/components/ui/select"
import { useCart } from "@food/context/CartContext"
import { useProfile } from "@food/context/ProfileContext"
import { useOrders } from "@food/context/OrdersContext"
import { useLocation as useUserLocation } from "@food/hooks/useLocation"
import { useZone } from "@food/hooks/useZone"
import { useLocationSelector } from "@food/components/user/UserLayout"
import { orderAPI, restaurantAPI, userAPI } from "@food/api"
import { API_BASE_URL } from "@food/api/config"
import { initRazorpayPayment } from "@food/utils/razorpay"
import { toast } from "sonner"
import { getCompanyNameAsync } from "@food/utils/businessSettings"
import { calculateDistance, resolveEntityId } from "@food/utils/common"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { getRestaurantAvailabilityStatus } from "@food/utils/restaurantAvailability"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import CartEmptyState from "@food/components/user/cart/CartEmptyState"
import CartPageHeader, { CartSavingsBanner } from "@food/components/user/cart/CartPageHeader"
import CartItemsCard from "@food/components/user/cart/CartItemsCard"
import CartCheckoutBar from "@food/components/user/cart/CartCheckoutBar"
import RestaurantUnavailableModal from "@food/components/user/cart/RestaurantUnavailableModal"
import AddMoneyModal from "@food/components/user/AddMoneyModal"
import { useCartRestaurantValidation } from "@food/hooks/useCartRestaurantValidation"
import {
  setDeliveryAddressMode as persistDeliveryAddressMode,
  setUserLocationStorage,
} from "@food/utils/deliveryLocationStorage"
const zoopSound = "/zomato_sms.mp3"
const debugLog = (...args) => { }
const debugWarn = (...args) => { }
const debugError = (...args) => { }

const PRICING_CALC_DEBOUNCE_MS = 500

const DELIVERY_SPEED_ICON_MAP = {
  bike: Bike,
  leaf: Leaf,
  zap: Zap,
  truck: Truck,
  clock: Clock,
}

function mapDeliverySpeedOptions(list = []) {
  return list
    .filter((option) => option && option.isEnabled !== false)
    .map((option) => ({
      ...option,
      feeModifier: Number(option.feeModifier) || 0,
      icon: DELIVERY_SPEED_ICON_MAP[option.icon] || Bike,
    }))
}

/** Module cache — avoid remount / StrictMode duplicate hits for static config. */
let deliverySpeedOptionsCache = null
let deliverySpeedOptionsInFlight = null

async function loadDeliverySpeedOptionsOnce() {
  if (deliverySpeedOptionsCache) return deliverySpeedOptionsCache
  if (deliverySpeedOptionsInFlight) return deliverySpeedOptionsInFlight
  deliverySpeedOptionsInFlight = restaurantAPI
    .getDeliverySpeedOptions()
    .then((response) => {
      const options = mapDeliverySpeedOptions(response?.data?.data?.options || [])
      deliverySpeedOptionsCache = {
        options,
        defaultOptionId:
          response?.data?.data?.defaultOptionId ||
          options.find((o) => o.isDefault)?.id ||
          options[0]?.id ||
          null,
      }
      return deliverySpeedOptionsCache
    })
    .finally(() => {
      deliverySpeedOptionsInFlight = null
    })
  return deliverySpeedOptionsInFlight
}



// Removed hardcoded suggested items - now fetching approved addons from backend
// Coupons will be fetched from backend based on items in cart

/**
 * Format full address string from address object
 * @param {Object} address - Address object with street, additionalDetails, city, state, zipCode, or formattedAddress
 * @returns {String} Formatted address string
 */
const formatFullAddress = (address) => {
  if (!address) return ""

  const looksLikeLatLng = (s) => {
    if (!s) return false
    const v = String(s).trim()
    // Matches "12.34, 56.78" (lat,lng) with optional decimals/spaces
    return /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(v)
  }

  // Priority 1: Use formattedAddress if available (for live location addresses)
  if (address.formattedAddress && address.formattedAddress !== "Select location") {
    // If formattedAddress is still raw coordinates, don't show it as-is.
    // Fall back to composing from city/state/area instead.
    if (!looksLikeLatLng(address.formattedAddress)) {
      return address.formattedAddress
    }
  }

  // Priority 2: Build address from parts
  const addressParts = []
  if (address.street) addressParts.push(address.street)
  if (address.additionalDetails) addressParts.push(address.additionalDetails)
  if (address.city) addressParts.push(address.city)
  if (address.state) addressParts.push(address.state)
  if (address.zipCode) addressParts.push(address.zipCode)

  if (addressParts.length > 0) {
    return addressParts.join(', ')
  }

  // Priority 3: Use address field if available
  if (address.address && address.address !== "Select location") {
    return address.address
  }

  return ""
}

const RUPEE_SYMBOL = "\u20B9"
const CART_RECIPIENT_DETAILS_STORAGE_KEY = "food-cart-recipient-details-v1"
const CART_ORDER_NOTE_STORAGE_KEY = "food-cart-order-note-v1"

function isFreeDeliveryCoupon(coupon) {
  return Boolean(
    coupon?.freeDelivery
    || coupon?.isFreeDelivery
    || coupon?.couponCategory === "free_delivery"
    || coupon?.discountType === "free_delivery",
  )
}

function mapOfferToCartCoupon(o) {
  const code = o.couponCode || o.code
  if (isFreeDeliveryCoupon(o)) {
    return {
      code,
      couponCode: code,
      discountType: "free_delivery",
      discountPercentage: 0,
      discount: 0,
      minOrder: Number(o.minOrderValue ?? o.minOrder ?? 0),
      minOrderValue: Number(o.minOrderValue ?? o.minOrder ?? 0),
      maxDiscount: null,
      customerGroup: o.customerScope === "first-time" || o.customerGroup === "new" ? "new" : "all",
      isGlobalCoupon: o.restaurantScope !== "selected",
      createdBy: o.createdBy || "admin",
      restaurantScope: o.restaurantScope || "all",
      restaurantId: o.restaurantId || null,
      couponCategory: "free_delivery",
      isFreeDelivery: true,
      freeDelivery: true,
      discountDisplay: "FREE DELIVERY",
      description: "Delivery charge waived — paid by platform",
      showInCart: o.showInCart !== false,
      sourceLabel: o.createdBy === "restaurant" ? "Restaurant" : "Platform",
    }
  }

  const isPct = o.discountType === "percentage"
  const discountValue = Number(o.discountValue || o.discount || 0)
  const discountDisplay = isPct
    ? `${discountValue}% OFF`
    : `${RUPEE_SYMBOL}${discountValue} OFF`
  return {
    code,
    couponCode: code,
    discountType: isPct ? "percentage" : "flat",
    discountPercentage: isPct ? discountValue : 0,
    discount: isPct ? 0 : discountValue,
    minOrder: Number(o.minOrderValue ?? o.minOrder ?? 0),
    minOrderValue: Number(o.minOrderValue ?? o.minOrder ?? 0),
    maxDiscount: o.maxDiscount != null ? Number(o.maxDiscount) : null,
    customerGroup: o.customerScope === "first-time" || o.customerGroup === "new" ? "new" : "all",
    isGlobalCoupon: o.restaurantScope !== "selected",
    createdBy: o.createdBy || "admin",
    restaurantScope: o.restaurantScope || "all",
    restaurantId: o.restaurantId || null,
    couponCategory: o.couponCategory || "normal",
    isFreeDelivery: false,
    freeDelivery: false,
    discountDisplay,
    description: isPct
      ? `${discountValue}% OFF up to ${RUPEE_SYMBOL}${o.maxDiscount || 0}`
      : `Flat ${RUPEE_SYMBOL}${discountValue} OFF`,
    showInCart: o.showInCart !== false,
    sourceLabel: o.createdBy === "restaurant" ? "Restaurant" : "Platform",
  }
}

function Cart() {
  const companyName = useCompanyName()
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()
  const orderSuccessAudioRef = useRef(null)
  const hasRestoredRecipientRef = useRef(false)
  const hasRestoredNoteRef = useRef(false)
  const hasManuallyRemovedCouponRef = useRef(false)
  const pricingRequestIdRef = useRef(0)

  // Defensive check: Ensure CartProvider is available
  let cartContext;
  try {
    cartContext = useCart();
  } catch (error) {
    debugError('? CartProvider not found. Make sure Cart component is rendered within UserLayout.');
    // Return early with error message
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f5] dark:bg-[#0a0a0a]">
        <div className="text-center p-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Cart Error</h2>
          <p className="text-gray-600 dark:text-gray-400">
            Cart functionality is not available. Please refresh the page.
          </p>
          <button
            onClick={() => navigate('/')}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  const {
    cart,
    updateQuantity,
    addToCart,
    getCartCount,
    clearCart,
    cleanCartForRestaurant,
    restaurantMeta,
    setRestaurantMeta,
    removeItemsByRestaurantIds,
  } = cartContext;

  const {
    closedRestaurants,
    showAvailabilityModal,
    isValidating,
    validateRestaurants,
    handleRemoveClosedRestaurantItems,
    handleContinueReviewingCart,
  } = useCartRestaurantValidation({
    cart,
    restaurantMeta,
    setRestaurantMeta,
    removeItemsByRestaurantIds,
  });

  const hasValidatedOnLoadRef = useRef(false)

  useEffect(() => {
    if (cart.length === 0 || hasValidatedOnLoadRef.current) return
    hasValidatedOnLoadRef.current = true
    validateRestaurants({ force: false })
  }, [cart.length, validateRestaurants])

  const hasClosedRestaurants = closedRestaurants.length > 0
  const { getDefaultAddress, getDefaultPaymentMethod, setDefaultAddress, addresses, paymentMethods, userProfile } = useProfile()
  const { createOrder } = useOrders()
  const { openLocationSelector } = useLocationSelector()
  const { location: currentLocation, loading: currentLocationLoading } = useUserLocation() // Get live location address

  const [appliedCoupon, setAppliedCoupon] = useState(null)
  const [couponCode, setCouponCode] = useState("")
  const [couponErrorPopup, setCouponErrorPopup] = useState({ open: false, message: "" })
  const [speedOptionInfo, setSpeedOptionInfo] = useState(null)
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("razorpay")
  const [showPaymentSheet, setShowPaymentSheet] = useState(false)
  const [walletBalance, setWalletBalance] = useState(0)
  const [isLoadingWallet, setIsLoadingWallet] = useState(false)
  const [showAddMoneyModal, setShowAddMoneyModal] = useState(false)
  const [restaurantNote, setRestaurantNote] = useState(() => {
    try {
      if (typeof window === "undefined") return ""
      const raw = window.localStorage.getItem(CART_ORDER_NOTE_STORAGE_KEY)
      if (!raw) return ""
      const stored = JSON.parse(raw)
      return String(stored?.restaurantNote || "")
    } catch {
      return ""
    }
  })
  const [showRestaurantNoteInput, setShowRestaurantNoteInput] = useState(() => {
    try {
      if (typeof window === "undefined") return false
      const raw = window.localStorage.getItem(CART_ORDER_NOTE_STORAGE_KEY)
      if (!raw) return false
      const stored = JSON.parse(raw)
      const storedRestaurantNote = String(stored?.restaurantNote || "")
      return Boolean(stored?.showRestaurantNoteInput) || storedRestaurantNote.trim().length > 0
    } catch {
      return false
    }
  })
  const [showShareModal, setShowShareModal] = useState(false)
  const [sharePayload, setSharePayload] = useState(null)
  const [isEditingRecipient, setIsEditingRecipient] = useState(false)
  const [recipientDetails, setRecipientDetails] = useState({
    name: "",
    phone: "",
  })

  const [sendCutlery, setSendCutlery] = useState(true)
  const [isPlacingOrder, setIsPlacingOrder] = useState(false)
  const placeOrderInFlightRef = useRef(false)
  const [showBillDetails, setShowBillDetails] = useState(true)
  const [deliveryOption, setDeliveryOption] = useState("standard")
  const [configuredSpeedOptions, setConfiguredSpeedOptions] = useState([])
  const [loadingSpeedOptions, setLoadingSpeedOptions] = useState(true)
  const [isScheduled, setIsScheduled] = useState(() => {
    try {
      const stored = localStorage.getItem('scheduled_order_time')
      if (stored) {
        const parsed = JSON.parse(stored)
        return parsed.isScheduled || false
      }
    } catch { }
    return false
  })
  const [scheduledDate, setScheduledDate] = useState(() => {
    try {
      const stored = localStorage.getItem('scheduled_order_time')
      if (stored) {
        const parsed = JSON.parse(stored)
        return parsed.date || ""
      }
    } catch { }
    return ""
  })
  const [scheduledTime, setScheduledTime] = useState(() => {
    try {
      const stored = localStorage.getItem('scheduled_order_time')
      if (stored) {
        const parsed = JSON.parse(stored)
        return parsed.time || ""
      }
    } catch { }
    return ""
  })
  const [showSavingsCongrats, setShowSavingsCongrats] = useState(false)
  const [congratsSavingsAmount, setCongratssSavingsAmount] = useState(0)
  const [congratsSavingsPercentage, setCongratssSavingsPercentage] = useState(0)
  const [congratsSavingsItems, setCongratssSavingsItems] = useState([])
  const [showOrderSuccess, setShowOrderSuccess] = useState(false)
  const [orderSuccessSavingsAmount, setOrderSuccessSavingsAmount] = useState(0)
  const [placedOrderId, setPlacedOrderId] = useState(null)
  const [selectedAddressId, setSelectedAddressId] = useState(null)
  const [deliveryAddressMode, setDeliveryAddressMode] = useState(() => {
    try {
      if (typeof window === "undefined") return "saved"
      return localStorage.getItem("deliveryAddressMode") || "saved"
    } catch {
      return "saved"
    }
  })

  useEffect(() => {
    const audio = new Audio(zoopSound)
    audio.preload = "auto"
    audio.volume = 0.8
    orderSuccessAudioRef.current = audio

    return () => {
      if (orderSuccessAudioRef.current) {
        orderSuccessAudioRef.current.pause()
        orderSuccessAudioRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!showOrderSuccess || !orderSuccessAudioRef.current) return

    orderSuccessAudioRef.current.currentTime = 0
    orderSuccessAudioRef.current.play().catch((error) => {
      debugWarn("Order success sound blocked by browser:", error?.message || error)
    })
  }, [showOrderSuccess])

  // Auto-transition from savings congratulations to order success after 3 seconds
  useEffect(() => {
    if (!showSavingsCongrats) return
    const timer = setTimeout(() => {
      setShowSavingsCongrats(false)
      setShowOrderSuccess(true)
    }, 3000)
    return () => clearTimeout(timer)
  }, [showSavingsCongrats])

  // Cleanup savings data when showing order success
  useEffect(() => {
    if (showOrderSuccess) {
      setCongratssSavingsAmount(0)
      setCongratssSavingsPercentage(0)
      setCongratssSavingsItems([])
    }
  }, [showOrderSuccess])

  // Restaurant and pricing state
  const [restaurantData, setRestaurantData] = useState(null)
  const [loadingRestaurant, setLoadingRestaurant] = useState(false)
  const [pricing, setPricing] = useState(null)
  const [loadingPricing, setLoadingPricing] = useState(false)

  // Addons state
  const [addons, setAddons] = useState([])
  const [loadingAddons, setLoadingAddons] = useState(false)

  // Coupons state - fetched from backend
  const [availableCoupons, setAvailableCoupons] = useState([])
  const [loadingCoupons, setLoadingCoupons] = useState(false)
  const [userOrderCount, setUserOrderCount] = useState(0)

  // Soft local defaults only while calculateOrder loads — no delivery fee fallback.
  const feeSettings = {
    deliveryFee: 0,
    deliveryFeeRanges: [],
    freeDeliveryThreshold: 0,
    platformFee: 0,
    packagingFee: 0,
    gstRate: 0,
  }

  const subtotal = pricing?.subtotal || cart.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 1), 0)


  const availableTimeSlots = useMemo(() => {
    if (!isScheduled || !scheduledDate || !restaurantData) return []

    try {
      const targetDate = new Date(scheduledDate)
      const status = getRestaurantAvailabilityStatus(restaurantData, targetDate)

      let openingHour = 9
      let closingHour = 22

      if (status.openingTime) {
        const [h] = status.openingTime.split(':')
        openingHour = parseInt(h, 10)
      }

      if (status.closingTime) {
        const [h] = status.closingTime.split(':')
        closingHour = parseInt(h, 10)
      }

      if (closingHour < openingHour) {
        closingHour += 24 // Handle overnight slots
      }

      const slots = []
      const now = new Date()
      // Fix timezone date comparison by comparing date strings YYYY-MM-DD
      const nowStr = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0]
      const targetStr = scheduledDate
      const isToday = targetStr === nowStr
      const currentHour = now.getHours()

      for (let h = openingHour; h <= closingHour; h++) {
        const actualHour = h % 24
        // Skip past hours if today. Add 1 hour buffer so they can't order right at the boundary
        if (isToday && h <= currentHour) continue

        const period = actualHour >= 12 ? 'PM' : 'AM'
        const display12 = actualHour % 12 || 12
        const timeString = `${String(actualHour).padStart(2, '0')}:00`
        const displayString = `${display12}:00 ${period}`

        slots.push({ value: timeString, label: displayString })
      }

      return slots
    } catch {
      return []
    }
  }, [isScheduled, scheduledDate, restaurantData])

  // Reset scheduledTime if it's no longer valid in the new slots
  useEffect(() => {
    if (isScheduled && availableTimeSlots.length > 0) {
      const isValid = availableTimeSlots.some(slot => slot.value === scheduledTime)
      if (!isValid) {
        setScheduledTime(availableTimeSlots[0].value)
      }
    } else if (!isScheduled) {
      setScheduledDate("")
      setScheduledTime("")
    }
  }, [isScheduled, availableTimeSlots, scheduledTime])

  const cartCount = getCartCount()
  const LARGE_CART_ITEM_THRESHOLD = 20
  const isLargeCart = cartCount >= LARGE_CART_ITEM_THRESHOLD
  const getAddressId = (address) => address?.id || address?._id || null
  const normalizeAddressLabel = (label) => {
    if (!label) return ""
    const value = String(label).trim().toLowerCase()
    if (value === "work" || value === "office") return "office"
    if (value === "home") return "home"
    if (value === "other") return "other"
    return value
  }
  const getDisplayAddressLabel = (label) => {
    const normalized = normalizeAddressLabel(label)
    if (normalized === "office") return "Work"
    if (normalized === "home") return "Home"
    if (normalized === "other") return "Other"
    return label || "Saved address"
  }
  const sanitizeRecipientPhone = (value) => String(value || "").replace(/[^\d+]/g, "").slice(0, 14)
  const savedAddress = getDefaultAddress()
  const selectedAddress = addresses.find((addr) => getAddressId(addr) && getAddressId(addr) === selectedAddressId)

  const currentLocationAddress = useMemo(() => {
    // `LocationSelectorOverlay` updates backend + localStorage, but Cart's live hook might lag.
    // So we fall back to `localStorage.userLocation` when `currentLocation` doesn't have a usable payload yet.
    let locFromStorage = null
    try {
      const storedRaw = localStorage.getItem("userLocation")
      locFromStorage = storedRaw ? JSON.parse(storedRaw) : null
    } catch {
      locFromStorage = null
    }

    const loc = currentLocation?.latitude && currentLocation?.longitude ? currentLocation : locFromStorage
    if (!loc?.latitude || !loc?.longitude) return null

    const formattedAddress = loc?.formattedAddress || loc?.address || ""
    if (!formattedAddress || formattedAddress === "Select location") return null

    return {
      // Backend deliveryAddressSchema expects label in ['Home','Office','Other'].
      label: "Home",
      formattedAddress,
      address: formattedAddress,
      street: loc?.street || loc?.address || loc?.area || "Current Location",
      additionalDetails: loc?.area || "",
      city: loc?.city || loc?.area || "Current City",
      state: loc?.state || loc?.city || "Current State",
      zipCode: loc?.postalCode || loc?.zipCode || "",
      phone: userProfile?.phone || "",
      location: {
        type: "Point",
        coordinates: [loc.longitude, loc.latitude], // [lng, lat]
      },
    }
  }, [
    currentLocation?.latitude,
    currentLocation?.longitude,
    currentLocation?.formattedAddress,
    currentLocation?.address,
    currentLocation?.street,
    currentLocation?.area,
    currentLocation?.city,
    currentLocation?.state,
    currentLocation?.postalCode,
    currentLocation?.zipCode,
    userProfile?.phone,
    // Re-evaluate derived address when mode changes (overlay closes -> Cart rerenders).
    deliveryAddressMode,
  ])

  const defaultAddress = useMemo(() => {
    return deliveryAddressMode === "current"
      ? currentLocationAddress || selectedAddress || savedAddress || null
      : selectedAddress || savedAddress || currentLocationAddress || null
  }, [deliveryAddressMode, currentLocationAddress, selectedAddress, savedAddress])

  const hasSavedAddress = Boolean(defaultAddress && formatFullAddress(defaultAddress))
  const recipientName = String(recipientDetails.name || "").trim() || userProfile?.name || "Your Name"
  const recipientPhone = sanitizeRecipientPhone(recipientDetails.phone || "") || userProfile?.phone || ""
  const selectedAddressCoordinates = defaultAddress?.location?.coordinates
  const zoneLocation = selectedAddressCoordinates?.length === 2
    ? {
      latitude: selectedAddressCoordinates[1],
      longitude: selectedAddressCoordinates[0]
    }
    : currentLocation
  const { zoneId } = useZone(zoneLocation) // Prefer selected/saved address zone
  const defaultPayment = getDefaultPaymentMethod()

  useEffect(() => {
    // Sync delivery mode from overlay/localStorage changes.
    // No dependency array: overlay open/close re-renders Cart via provider state update,
    // even when GPS coords don't move enough to update `currentLocation`.
    try {
      const mode = localStorage.getItem("deliveryAddressMode") || "saved"
      setDeliveryAddressMode((prev) => (prev === mode ? prev : mode))
    } catch {
      // ignore
    }
  })

  useEffect(() => {
    if (typeof window === "undefined") return

    try {
      const raw = window.localStorage.getItem(CART_RECIPIENT_DETAILS_STORAGE_KEY)
      if (!raw) {
        hasRestoredRecipientRef.current = true
        return
      }

      const stored = JSON.parse(raw)
      setRecipientDetails({
        name: stored?.name || "",
        phone: sanitizeRecipientPhone(stored?.phone || ""),
      })
      setIsEditingRecipient(Boolean(stored?.isEditingRecipient))
    } catch {
      setRecipientDetails({ name: "", phone: "" })
      setIsEditingRecipient(false)
    } finally {
      hasRestoredRecipientRef.current = true
    }
  }, [])

  useEffect(() => {
    setRecipientDetails((prev) => ({
      name: prev.name || userProfile?.name || "",
      phone: prev.phone || userProfile?.phone || "",
    }))
  }, [userProfile?.name, userProfile?.phone])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!hasRestoredRecipientRef.current) return

    try {
      window.localStorage.setItem(
        CART_RECIPIENT_DETAILS_STORAGE_KEY,
        JSON.stringify({
          name: recipientDetails.name || "",
          phone: sanitizeRecipientPhone(recipientDetails.phone || ""),
          isEditingRecipient,
        })
      )
    } catch {
      // Ignore storage errors and keep cart flow working.
    }
  }, [recipientDetails, isEditingRecipient])

  useEffect(() => {
    hasRestoredNoteRef.current = true
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!hasRestoredNoteRef.current) return

    try {
      window.localStorage.setItem(
        CART_ORDER_NOTE_STORAGE_KEY,
        JSON.stringify({
          restaurantNote,
          showRestaurantNoteInput,
        })
      )
    } catch {
      // Ignore storage errors and keep note flow working.
    }
  }, [restaurantNote, showRestaurantNoteInput])

  useEffect(() => {
    if (deliveryAddressMode === "current") {
      setSelectedAddressId(null)
    }
  }, [deliveryAddressMode])

  useEffect(() => {
    const defaultId = getAddressId(savedAddress)
    if (deliveryAddressMode !== "current" && !selectedAddressId && defaultId) {
      setSelectedAddressId(defaultId)
    }
  }, [savedAddress, selectedAddressId, deliveryAddressMode])

  // Get restaurant ID from cart or restaurant data
  // Priority: restaurantData > cart[0].restaurantId
  // DO NOT use cart[0].restaurant as slug fallback - it creates wrong slugs
  const restaurantId = cart.length > 0
    ? (restaurantData?._id || restaurantData?.restaurantId || cart[0]?.restaurantId || null)
    : null

  // Stable restaurant ID for addons fetch (memoized to prevent dependency array issues)
  // Prefer restaurantData IDs (more reliable) over slug from cart
  const restaurantIdForAddons = useMemo(() => {
    // Only use restaurantData if it's loaded, otherwise wait
    if (restaurantData) {
      return restaurantData._id || restaurantData.restaurantId || null
    }
    // If restaurantData is not loaded yet, return null to wait
    return null
  }, [restaurantData])



  // Lock body scroll and scroll to top when any full-screen modal opens
  useEffect(() => {
    if (showOrderSuccess || showSavingsCongrats) {
      // Lock body scroll
      document.body.style.overflow = 'hidden'
      document.body.style.position = 'fixed'
      document.body.style.width = '100%'
      document.body.style.top = `-${window.scrollY}px`

      // Scroll window to top
      window.scrollTo({ top: 0, behavior: 'instant' })
    } else {
      // Restore body scroll
      const scrollY = document.body.style.top
      document.body.style.overflow = ''
      document.body.style.position = ''
      document.body.style.width = ''
      document.body.style.top = ''
      if (scrollY) {
        window.scrollTo(0, parseInt(scrollY || '0') * -1)
      }
    }

    return () => {
      // Cleanup on unmount
      document.body.style.overflow = ''
      document.body.style.position = ''
      document.body.style.width = ''
      document.body.style.top = ''
    }
  }, [showOrderSuccess, showSavingsCongrats])

  // Fetch restaurant data when cart has items
  useEffect(() => {
    const fetchRestaurantData = async () => {
      if (cart.length === 0) {
        setRestaurantData(null)
        return
      }

      // If we already have restaurantData, don't fetch again
      if (restaurantData) {
        return
      }

      setLoadingRestaurant(true)

      // Strategy 1: Try using restaurantId from cart if available
      if (cart[0]?.restaurantId) {
        try {
          const cartRestaurantId = resolveEntityId(cart[0].restaurantId);
          if (!cartRestaurantId) {
            setLoadingRestaurant(false)
            return
          }
          const cartRestaurantName = cart[0].restaurant;

          debugLog("?? Fetching restaurant data by restaurantId from cart:", cartRestaurantId)
          const response = await restaurantAPI.getRestaurantById(cartRestaurantId)
          const data = response?.data?.data?.restaurant || response?.data?.restaurant

          if (data) {
            // CRITICAL: Validate that fetched restaurant matches cart items
            const fetchedRestaurantId = data.restaurantId || data._id?.toString();
            const fetchedRestaurantName = data.name;

            // Check if restaurantId matches
            const restaurantIdMatches =
              fetchedRestaurantId === cartRestaurantId ||
              data._id?.toString() === cartRestaurantId ||
              data.restaurantId === cartRestaurantId;

            // Check if restaurant name matches (if available in cart)
            const restaurantNameMatches =
              !cartRestaurantName ||
              fetchedRestaurantName?.toLowerCase().trim() === cartRestaurantName.toLowerCase().trim();

            if (!restaurantIdMatches) {
              debugError('? CRITICAL: Fetched restaurant ID does not match cart restaurantId!', {
                cartRestaurantId: cartRestaurantId,
                fetchedRestaurantId: fetchedRestaurantId,
                fetched_id: data._id?.toString(),
                fetched_restaurantId: data.restaurantId,
                cartRestaurantName: cartRestaurantName,
                fetchedRestaurantName: fetchedRestaurantName
              });
              // Don't set restaurantData if IDs don't match - this prevents wrong restaurant assignment
              setLoadingRestaurant(false);
              return;
            }

            if (!restaurantNameMatches) {
              debugWarn('?? WARNING: Restaurant name mismatch:', {
                cartRestaurantName: cartRestaurantName,
                fetchedRestaurantName: fetchedRestaurantName
              });
              // Still proceed but log warning
            }

            debugLog("? Restaurant data loaded from cart restaurantId:", {
              _id: data._id,
              restaurantId: data.restaurantId,
              name: data.name,
              cartRestaurantId: cartRestaurantId,
              cartRestaurantName: cartRestaurantName
            })
            setRestaurantData(data)
            setLoadingRestaurant(false)
            return
          }
        } catch (error) {
          debugWarn("?? Failed to fetch by cart restaurantId, trying fallback...", error)
        }
      }

      // Strategy 2: If no restaurantId in cart, search by restaurant name
      if (cart[0]?.restaurant && !restaurantData) {
        try {
          debugLog("?? Searching restaurant by name:", cart[0].restaurant)
          const searchResponse = await restaurantAPI.getRestaurants({ limit: 100 })
          const restaurants = searchResponse?.data?.data?.restaurants || searchResponse?.data?.data || []
          debugLog("?? Fetched", restaurants.length, "restaurants for name search")

          // Try exact match first
          let matchingRestaurant = restaurants.find(r =>
            r.name?.toLowerCase().trim() === cart[0].restaurant?.toLowerCase().trim()
          )

          // If no exact match, try partial match
          if (!matchingRestaurant) {
            debugLog("?? No exact match, trying partial match...")
            matchingRestaurant = restaurants.find(r =>
              r.name?.toLowerCase().includes(cart[0].restaurant?.toLowerCase().trim()) ||
              cart[0].restaurant?.toLowerCase().trim().includes(r.name?.toLowerCase())
            )
          }

          if (matchingRestaurant) {
            // CRITICAL: Validate that the found restaurant matches cart items
            const cartRestaurantName = cart[0]?.restaurant?.toLowerCase().trim();
            const foundRestaurantName = matchingRestaurant.name?.toLowerCase().trim();

            if (cartRestaurantName && foundRestaurantName && cartRestaurantName !== foundRestaurantName) {
              debugError("? CRITICAL: Restaurant name mismatch!", {
                cartRestaurantName: cart[0]?.restaurant,
                foundRestaurantName: matchingRestaurant.name,
                cartRestaurantId: cart[0]?.restaurantId,
                foundRestaurantId: matchingRestaurant.restaurantId || matchingRestaurant._id
              });
              // Don't set restaurantData if names don't match - this prevents wrong restaurant assignment
              setLoadingRestaurant(false);
              return;
            }

            debugLog("? Found restaurant by name:", {
              name: matchingRestaurant.name,
              _id: matchingRestaurant._id,
              restaurantId: matchingRestaurant.restaurantId,
              slug: matchingRestaurant.slug,
              cartRestaurantName: cart[0]?.restaurant
            })
            setRestaurantData(matchingRestaurant)
            setLoadingRestaurant(false)
            return
          } else {
            debugWarn("?? Restaurant not found even by name search. Searched in", restaurants.length, "restaurants")
            if (restaurants.length > 0) {
              debugLog("?? Available restaurant names:", restaurants.map(r => r.name).slice(0, 10))
            }
          }
        } catch (searchError) {
          debugWarn("?? Error searching restaurants by name:", searchError)
        }
      }

      // If all strategies fail, set to null
      setRestaurantData(null)
      setLoadingRestaurant(false)
    }

    fetchRestaurantData()
  }, [cart.length, cart[0]?.restaurantId, cart[0]?.restaurant])

  // Fetch approved addons for the restaurant
  useEffect(() => {
    const fetchAddonsWithId = async (idToUse) => {

      debugLog("?? Addons fetch - Using ID:", {
        restaurantData: restaurantData ? {
          _id: restaurantData._id,
          restaurantId: restaurantData.restaurantId,
          name: restaurantData.name
        } : 'Not loaded',
        cartRestaurantId: restaurantId,
        idToUse: idToUse
      })

      // Convert to string for validation
      const idString = String(idToUse)
      debugLog("?? Restaurant ID string:", idString, "Type:", typeof idString, "Length:", idString.length)

      // Validate ID format (should be ObjectId or restaurantId format)
      const isValidIdFormat = /^[a-zA-Z0-9\-_]+$/.test(idString) && idString.length >= 3

      if (!isValidIdFormat) {
        debugWarn("?? Restaurant ID format invalid:", idString)
        setAddons([])
        return
      }

      try {
        setLoadingAddons(true)
        debugLog("?? Fetching addons for restaurant ID:", idString)
        const response = await restaurantAPI.getAddonsByRestaurantId(idString)
        debugLog("? Addons API response received:", response?.data)
        debugLog("?? Response structure:", {
          success: response?.data?.success,
          data: response?.data?.data,
          addons: response?.data?.data?.addons,
          directAddons: response?.data?.addons
        })

        const data = response?.data?.data?.addons || response?.data?.addons || []
        debugLog("?? Fetched addons count:", data.length)
        debugLog("?? Fetched addons data:", JSON.stringify(data, null, 2))

        if (data.length === 0) {
          debugWarn("?? No addons returned from API. Response:", response?.data)
        } else {
          debugLog("? Successfully fetched", data.length, "addons:", data.map(a => a.name))
        }

        setAddons(data)
      } catch (error) {
        // Log error for debugging
        debugError("? Addons fetch error:", {
          code: error.code,
          status: error.response?.status,
          message: error.message,
          url: error.config?.url,
          data: error.response?.data
        })
        // Silently handle network errors and 404 errors
        // Network errors (ERR_NETWORK) happen when backend is not running - this is OK for development
        // 404 errors mean restaurant might not have addons or restaurant not found - also OK
        if (error.code !== 'ERR_NETWORK' && error.response?.status !== 404) {
          debugError("Error fetching addons:", error)
        }
        // Continue with cart even if addons fetch fails
        setAddons([])
      } finally {
        setLoadingAddons(false)
      }
    }

    const fetchAddons = async () => {
      if (cart.length === 0) {
        setAddons([])
        return
      }

      // Wait for restaurantData to be loaded (including fallback search)
      if (loadingRestaurant) {
        debugLog("? Waiting for restaurantData to load (including fallback search)...")
        return
      }

      // Must have restaurantData to fetch addons
      if (!restaurantData) {
        debugWarn("?? No restaurantData available for addons fetch")
        setAddons([])
        return
      }

      // Use restaurantData ID (most reliable)
      const idToUse = restaurantData._id || restaurantData.restaurantId
      if (!idToUse) {
        debugWarn("?? No valid restaurant ID in restaurantData")
        setAddons([])
        return
      }

      debugLog("? Using restaurantData ID for addons:", idToUse)
      fetchAddonsWithId(idToUse)
    }

    fetchAddons()
  }, [restaurantData, cart.length, loadingRestaurant])

  // Fetch available coupons once when cart first becomes ready (not on qty changes).
  const couponsFetchedRef = useRef(false)
  useEffect(() => {
    if (cart.length === 0 || !restaurantId) {
      setAvailableCoupons([])
      couponsFetchedRef.current = false
      return undefined
    }

    if (couponsFetchedRef.current) return undefined

    let cancelled = false
    const fetchCouponsForCartItems = async () => {
      const cartRestaurantIds = [...new Set(
        cart.map((item) => String(item.restaurantId || item.restaurant || "")).filter(Boolean)
      )]
      const multiRestaurant = cartRestaurantIds.length > 1

      try {
        setLoadingCoupons(true)
        debugLog(`[CART-COUPONS] Loading offers for cart (once)`)
        const response = await restaurantAPI.getCouponsByItemIdPublic(cartRestaurantIds)
        if (cancelled) return
        const list = response?.data?.data?.coupons || []
        const coupons = list
          .filter((o) => o.showInCart !== false)
          .filter((o) => {
            if (multiRestaurant) {
              return o.createdBy === "admin" && o.restaurantScope === "all"
            }
            if (String(o.restaurantScope) === "selected") {
              return cartRestaurantIds.includes(String(o.restaurantId || ""))
            }
            return true
          })
          .map(mapOfferToCartCoupon)
        setAvailableCoupons(coupons)
        couponsFetchedRef.current = true
      } catch (error) {
        if (cancelled) return
        debugError("[CART-COUPONS] Failed to load offers:", error)
        setAvailableCoupons([])
      } finally {
        if (!cancelled) setLoadingCoupons(false)
      }
    }

    fetchCouponsForCartItems()
    return () => {
      cancelled = true
    }
    // Only when cart becomes non-empty / restaurant is known — not on quantity updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, cart.length > 0])

  useEffect(() => {
    if (!appliedCoupon || loadingCoupons) return
    const stillListed = availableCoupons.some((c) => c.code === appliedCoupon.code)
    const minOk = isFreeDeliveryCoupon(appliedCoupon)
      || subtotal >= (Number(appliedCoupon.minOrder) || 0)
    // Platform first-time: block on any prior platform order.
    // Restaurant first-time: backend validates per-restaurant — don't strip here using global count.
    const isRestaurantCoupon = appliedCoupon.createdBy === "restaurant"
    const newOk = appliedCoupon.customerGroup !== "new"
      || isRestaurantCoupon
      || userOrderCount === 0
    if (!stillListed || !minOk || !newOk) {
      setAppliedCoupon(null)
      setCouponCode("")
    }
  }, [appliedCoupon, availableCoupons, subtotal, userOrderCount, loadingCoupons])

  // Calculate pricing only when cart/address/coupon/speed meaningfully change (stable fingerprint).
  const pricingRequestKey = useMemo(() => {
    if (cart.length === 0 || !hasSavedAddress) return ""
    const coords = defaultAddress?.location?.coordinates
    return JSON.stringify({
      items: cart.map((item) => ({
        itemId: String(item.itemId || item.id || ""),
        variantId: String(item.variantId || ""),
        quantity: Number(item.quantity) || 1,
        price: Number(item.price) || 0,
        restaurantId: resolveEntityId(
          item.restaurantId || item.restaurant?._id || item.restaurant,
        ),
      })),
      restaurantId: resolveEntityId(
        restaurantData?.restaurantId || restaurantData?._id || restaurantId,
      ),
      couponCode: String(couponCode || appliedCoupon?.code || "").trim().toUpperCase(),
      deliveryOption: String(deliveryOption || ""),
      addressId: String(defaultAddress?._id || defaultAddress?.id || ""),
      coords: Array.isArray(coords) ? coords : null,
    })
  }, [
    cart,
    hasSavedAddress,
    defaultAddress,
    appliedCoupon?.code,
    couponCode,
    restaurantId,
    restaurantData?.restaurantId,
    restaurantData?._id,
    deliveryOption,
  ])

  const lastPricingKeyRef = useRef("")

  useEffect(() => {
    if (!pricingRequestKey) {
      setPricing(null)
      setLoadingPricing(false)
      lastPricingKeyRef.current = ""
      return undefined
    }

    if (placeOrderInFlightRef.current || isPlacingOrder) {
      return undefined
    }

    // Same inputs as last successful/failed request — skip duplicate calculate
    if (pricingRequestKey === lastPricingKeyRef.current) {
      setLoadingPricing(false)
      return undefined
    }

    let cancelled = false
    const requestId = ++pricingRequestIdRef.current
    const keyForRequest = pricingRequestKey
    // Disable place order as soon as cart inputs change (before debounce fires)
    setLoadingPricing(true)

    const timer = setTimeout(async () => {
      if (placeOrderInFlightRef.current) return
      try {
        setLoadingPricing(true)
        const items = cart.map(item => ({
          itemId: item.itemId || item.id,
          name: item.name,
          price: item.price,
          variantId: item.variantId || undefined,
          variantName: item.variantName || undefined,
          variantPrice: item.variantPrice || item.price,
          quantity: item.quantity || 1,
          image: item.image || item.imageUrl,
          description: item.description,
          isVeg: item.isVeg !== false,
          isAddon: Boolean(item.isAddon || item.itemType === "addon"),
          restaurantId: resolveEntityId(
            item.restaurantId || item.restaurant?._id || item.restaurant,
          ) || undefined,
        }))

        const resolvedRestaurantId =
          resolveEntityId(
            restaurantData?.restaurantId || restaurantData?._id || restaurantId,
          ) || undefined

        const selectedSpeed = configuredSpeedOptions.find((opt) => opt.id === deliveryOption)
          || configuredSpeedOptions.find((opt) => opt.isDefault)
          || configuredSpeedOptions[0]

        const response = await orderAPI.calculateOrder({
          items,
          restaurantId: resolvedRestaurantId,
          deliveryAddress: defaultAddress,
          couponCode: couponCode || appliedCoupon?.code || undefined,
          deliverySpeedOptionId: deliveryOption || undefined,
          deliveryOption: selectedSpeed?.name || undefined,
        })

        if (cancelled || requestId !== pricingRequestIdRef.current || placeOrderInFlightRef.current) return

        if (response?.data?.success && response?.data?.data?.pricing) {
          lastPricingKeyRef.current = keyForRequest
          const pricingData = response.data.data.pricing
          const couponErr =
            response.data.data.couponError ||
            pricingData.couponError ||
            null
          setPricing(pricingData)

          if (couponErr?.message) {
            setAppliedCoupon(null)
            setCouponCode("")
            setCouponErrorPopup({
              open: true,
              message: couponErr.message,
            })
          } else if (pricingData.appliedCoupon && !appliedCoupon) {
            const coupon = availableCoupons.find(c => c.code === pricingData.appliedCoupon.code)
            if (coupon) {
              setAppliedCoupon(coupon)
            }
          }
        }
      } catch (error) {
        if (cancelled || requestId !== pricingRequestIdRef.current) return
        if (error.code !== 'ERR_NETWORK' && error.response?.status !== 404) {
          debugError("Error calculating pricing:", error)
        }
        // Mark this key as attempted so we don't spin forever on the same failing cart.
        lastPricingKeyRef.current = keyForRequest
        setPricing(null)
        const message =
          error?.response?.data?.message ||
          error?.message ||
          "Unable to calculate bill. Please try again."
        toast.error(message)
      } finally {
        if (!cancelled && requestId === pricingRequestIdRef.current) {
          setLoadingPricing(false)
        }
      }
    }, PRICING_CALC_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [pricingRequestKey, isPlacingOrder])

  const refreshWalletBalance = async () => {
    try {
      setIsLoadingWallet(true)
      const response = await userAPI.getWallet()
      if (response?.data?.success && response?.data?.data?.wallet) {
        const balance = response.data.data.wallet.balance || 0
        setWalletBalance(balance)
        return balance
      }
      return walletBalance
    } catch (error) {
      debugError("Error fetching wallet balance:", error)
      return walletBalance
    } finally {
      setIsLoadingWallet(false)
    }
  }

  // Fetch wallet when user selects Wallet, or when opening the payment sheet (to show balance / low-balance CTA)
  useEffect(() => {
    if (selectedPaymentMethod !== "wallet" && !showPaymentSheet) return undefined

    let cancelled = false
    const fetchWalletBalance = async () => {
      try {
        setIsLoadingWallet(true)
        const response = await userAPI.getWallet()
        if (cancelled) return
        if (response?.data?.success && response?.data?.data?.wallet) {
          setWalletBalance(response.data.data.wallet.balance || 0)
        }
      } catch (error) {
        if (cancelled) return
        debugError("Error fetching wallet balance:", error)
        setWalletBalance(0)
      } finally {
        if (!cancelled) setIsLoadingWallet(false)
      }
    }
    fetchWalletBalance()
    return () => { cancelled = true }
  }, [selectedPaymentMethod, showPaymentSheet])

  // Fetch user order count (used for first-time coupon eligibility)
  useEffect(() => {
    const fetchOrderCount = async () => {
      try {
        const response = await userAPI.getOrders({ page: 1, limit: 1 })
        if (response?.data?.success) {
          const totalOrders = response?.data?.data?.pagination?.total || 0
          setUserOrderCount(totalOrders)
        }
      } catch (error) {
        debugError("Error fetching user order count:", error)
        setUserOrderCount(0)
      }
    }

    fetchOrderCount()
  }, [])

  // Delivery speed options once (cached). Do NOT refetch on focus — that fired during Razorpay checkout.
  useEffect(() => {
    let cancelled = false
    const fetchDeliverySpeedOptions = async () => {
      try {
        setLoadingSpeedOptions(true)
        const data = await loadDeliverySpeedOptionsOnce()
        if (cancelled) return
        setConfiguredSpeedOptions(data.options)
        if (data.defaultOptionId) {
          setDeliveryOption((prev) => (
            data.options.some((o) => o.id === prev) ? prev : data.defaultOptionId
          ))
        }
      } catch (error) {
        if (cancelled) return
        debugError("Error fetching delivery speed options:", error)
        setConfiguredSpeedOptions([])
      } finally {
        if (!cancelled) setLoadingSpeedOptions(false)
      }
    }

    fetchDeliverySpeedOptions()
    return () => { cancelled = true }
  }, [])

  // Use backend pricing if available; otherwise 0 (no flat delivery fee fallback).
  const fallbackDeliveryFee = 0

  const deliveryOptions = configuredSpeedOptions.length > 0
    ? configuredSpeedOptions
    : []

  const selectedDeliveryOption = deliveryOptions.find(opt => opt.id === deliveryOption) || deliveryOptions.find(opt => opt.isDefault) || deliveryOptions[0]

  const speedFeeModifier = deliveryOptions.length > 0
    ? (Number(selectedDeliveryOption?.feeModifier) || 0)
    : 0
  const deliveryFeeBreakdown = pricing?.deliveryFeeBreakdown || null
  const backendSpeedModifier = Number(deliveryFeeBreakdown?.speedFeeModifier) || 0
  const peakHourCharge = Number(deliveryFeeBreakdown?.peakHourCharge ?? pricing?.peakHourCharge) || 0
  const peakHourRuleName = deliveryFeeBreakdown?.peakHourRuleName || pricing?.peakHourSurcharge?.name || null
  const deliveryFeeBeforeSpeed = pricing != null
    ? Math.max(0, (Number(pricing.deliveryFee) || 0) - backendSpeedModifier - peakHourCharge)
    : fallbackDeliveryFee
  const deliveryFee = pricing != null
    ? (Number(pricing.deliveryFee) || 0)
    : Math.max(0, fallbackDeliveryFee + speedFeeModifier)
  const deliveryDiscount = pricing != null
    ? (Number(pricing.deliveryDiscount) || 0)
    : (isFreeDeliveryCoupon(appliedCoupon) ? deliveryFee : 0)
  const customerDeliveryFee = Math.max(0, deliveryFee - deliveryDiscount)
  const isDeliveryFreeForCustomer =
    customerDeliveryFee === 0 &&
    (deliveryDiscount > 0 || Number(pricing?.platformSubsidy) > 0 || deliveryFeeBreakdown?.speedSkippedBecauseFreeDelivery)
  const deliveryBaseBeforeMultiplier = deliveryFeeBreakdown?.baseFee != null
    ? Number(deliveryFeeBreakdown.baseFee)
    : deliveryFeeBeforeSpeed
  // Multi-restaurant uses additionalCharge (multiplier stays 1). Split/large orders use multiplier > 1.
  const deliveryMultiplierSurcharge = (() => {
    const additional = Number(deliveryFeeBreakdown?.additionalCharge) || 0
    if (additional > 0) return additional
    if (deliveryFeeBreakdown?.multiplier > 1) {
      return Math.max(0, deliveryFeeBeforeSpeed - deliveryBaseBeforeMultiplier)
    }
    return 0
  })()
  const hasDistanceDeliveryBreakdown =
    Number.isFinite(Number(deliveryFeeBreakdown?.distanceKm)) &&
    (deliveryFeeBreakdown?.source === "distance" || deliveryFeeBreakdown?.source === "free")
  const deliveryFeeBreakdownText = hasDistanceDeliveryBreakdown
    ? `Distance ${Number(deliveryFeeBreakdown.distanceKm).toFixed(1)} km${isDeliveryFreeForCustomer ? " · delivery free" : ""}`
    : (isDeliveryFreeForCustomer ? "Delivery free on this order" : null)

  // Detect multi-restaurant order
  const uniqueRestaurantIds = [...new Set(cart
    .map(item => item.restaurantId || item.restaurant)
    .filter(Boolean)
    .map(id => String(id).trim())
  )]
  const isMultiRestaurantOrder = uniqueRestaurantIds.length > 1

  useEffect(() => {
    if (!isMultiRestaurantOrder || !appliedCoupon) return
    if (appliedCoupon.createdBy === "restaurant" || appliedCoupon.restaurantScope === "selected") {
      setAppliedCoupon(null)
      setCouponCode("")
      toast.info("Restaurant coupons cannot be used with items from multiple restaurants")
    }
  }, [isMultiRestaurantOrder, appliedCoupon])

  const platformFee = pricing != null ? (pricing.platformFee ?? 0) : (feeSettings.platformFee ?? 0)
  const packagingFee = pricing != null
    ? (pricing.packagingFee ?? 0)
    : (feeSettings.packagingFee ?? 0) * Math.max(1, uniqueRestaurantIds.length)
  const gstCharges = pricing != null ? (pricing.tax ?? 0) : Math.round(subtotal * ((feeSettings.gstRate ?? 0) / 100))

  // Calculate discount from backend pricing or applied coupon
  const discount = (() => {
    if (pricing?.discount) {
      return pricing.discount
    }
    if (appliedCoupon) {
      if (appliedCoupon.discountType === "percentage") {
        const pctDiscount = subtotal * (appliedCoupon.discountPercentage / 100)
        const capped = appliedCoupon.maxDiscount ? Math.min(pctDiscount, appliedCoupon.maxDiscount) : pctDiscount
        return Math.max(0, Math.min(subtotal, Math.floor(capped)))
      } else {
        return Math.max(0, Math.min(subtotal, Math.floor(appliedCoupon.discount || 0)))
      }
    }
    return 0
  })()

  const billDiscount = pricing != null ? (Number(pricing.discount) || 0) : discount
  const billSubtotal = pricing != null ? (Number(pricing.subtotal) || subtotal) : subtotal
  const billPlatformFee = pricing != null ? (Number(pricing.platformFee) ?? platformFee) : platformFee
  const billPackagingFee = pricing != null ? (Number(pricing.packagingFee) ?? packagingFee) : packagingFee
  const billTax = pricing != null ? (Number(pricing.tax) ?? gstCharges) : gstCharges
  const totalCouponSavings = billDiscount + deliveryDiscount
  const totalBeforeDiscount = billSubtotal + deliveryFee + billPlatformFee + billPackagingFee + billTax
  const total = pricing != null
    ? Math.max(0, Number(pricing.total) || 0)
    : Math.max(0, totalBeforeDiscount - billDiscount - deliveryDiscount)
  const savings = Math.max(0, totalBeforeDiscount - total)

  // Calculate platform pricing comparison savings
  const platformPricingSavings = useMemo(() => {
    let totalPlatformPrice = 0
    let totalPlatformGst = 0
    let totalFoodelloPrice = 0
    let comparison = []
    let hasAnyPlatformPrice = false

    cart.forEach(item => {
      debugLog('Cart item:', item.name, 'priceOnOtherPlatforms:', item.priceOnOtherPlatforms, 'price:', item.price)
      if (item.priceOnOtherPlatforms && item.priceOnOtherPlatforms > 0) {
        hasAnyPlatformPrice = true
        const itemQuantity = item.quantity || 1
        const platformPrice = (item.priceOnOtherPlatforms || 0) * itemQuantity
        const platformGstRate = Number(item.otherPlatformGst || 0)
        const platformGst = platformGstRate > 0
          ? Math.round(platformPrice * (platformGstRate / 100))
          : 0
        const foodelloPrice = (item.price || 0) * itemQuantity
        const itemSavings = Math.max(0, platformPrice + platformGst - foodelloPrice)

        totalPlatformPrice += platformPrice
        totalPlatformGst += platformGst
        totalFoodelloPrice += foodelloPrice

        comparison.push({
          name: item.name,
          foodelloPrice: (item.price || 0),
          platformPrice: item.priceOnOtherPlatforms,
          platformGstRate,
          platformGst,
          savings: itemSavings,
          quantity: itemQuantity
        })
      }
    })

    const totalPlatformPriceWithGst = totalPlatformPrice + totalPlatformGst
    const totalSavings = Math.max(0, totalPlatformPriceWithGst - total)
    const savingsPercentage = totalPlatformPriceWithGst > 0
      ? ((totalSavings / totalPlatformPriceWithGst) * 100).toFixed(1)
      : 0

    debugLog('Platform pricing savings:', { hasPlatformPricing: hasAnyPlatformPrice, totalSavings, savingsPercentage })

    return {
      hasPlatformPricing: hasAnyPlatformPrice,
      totalPlatformPrice,
      totalPlatformGst,
      totalPlatformPriceWithGst,
      totalSavings,
      savingsPercentage,
      items: comparison
    }
  }, [cart, total])
  const selectedPaymentLabel =
    selectedPaymentMethod === "wallet"
      ? "Wallet"
      : "Online Payment"

  // Restaurant name from data or cart
  const restaurantName = isMultiRestaurantOrder
    ? "Multi-Restaurant Order"
    : (restaurantData?.name || cart[0]?.restaurant || "Restaurant")

  const handleShare = async () => {
    const restaurantNameStr = restaurantName || companyName || "this restaurant"
    const shareUrl = window.location.href
    const shareText = `Check out what I'm ordering from ${restaurantNameStr}! ${shareUrl}`

    const payload = {
      title: `My Cart at ${restaurantNameStr}`,
      text: shareText,
      url: shareUrl,
    }

    if (isMobileDevice()) {
      openShareModal(payload)
      return
    }

    const shared = await tryNativeShare(payload)
    if (shared) {
      toast.success("Link shared successfully")
      return
    }

    openShareModal(payload)
  }

  const openShareModal = (payload) => {
    setSharePayload(payload)
    setShowShareModal(true)
  }

  const tryNativeShare = async (payload) => {
    if (typeof navigator === "undefined" || !navigator.share) return false
    try {
      await navigator.share(payload)
      return true
    } catch (error) {
      if (error?.name === "AbortError") return true
      return false
    }
  }

  const isMobileDevice = () => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false
    const mobileUA = /Android|iPhone|iPad|iPod|Windows Phone|Opera Mini|IEMobile/i.test(navigator.userAgent)
    const smallViewport = window.matchMedia?.("(max-width: 768px)")?.matches
    return Boolean(mobileUA || smallViewport)
  }

  const openShareTarget = (target) => {
    if (!sharePayload?.url) return

    const text = sharePayload.text || ""
    const url = sharePayload.url
    const encodedText = encodeURIComponent(text)
    const encodedUrl = encodeURIComponent(url)

    let shareLink = ""

    if (target === "whatsapp") {
      shareLink = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`
    } else if (target === "telegram") {
      shareLink = `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`
    } else if (target === "email") {
      shareLink = `mailto:?subject=${encodeURIComponent(sharePayload.title || "Check this out")}&body=${encodeURIComponent(`${text}\n\n${url}`)}`
    }

    if (shareLink) {
      window.open(shareLink, "_blank", "noopener,noreferrer")
      setShowShareModal(false)
    }
  }

  const copyShareLink = async () => {
    if (!sharePayload?.url) return
    await copyToClipboard(sharePayload.url)
    setShowShareModal(false)
  }

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Link copied to clipboard!")
    } catch (error) {
      // Fallback for older browsers
      const textArea = document.createElement("textarea")
      textArea.value = text
      textArea.style.position = "fixed"
      textArea.style.opacity = "0"
      document.body.appendChild(textArea)
      textArea.select()
      try {
        document.execCommand("copy")
        toast.success("Link copied to clipboard!")
      } catch (err) {
        toast.error("Failed to copy link")
      }
      document.body.removeChild(textArea)
    }
  }

  const handleSystemShareFromModal = async () => {
    if (!sharePayload) return
    const shared = await tryNativeShare(sharePayload)
    if (shared) {
      setShowShareModal(false)
      toast.success("Shared successfully")
    }
  }

  const handleBack = () => {
    // Priority: slug > restaurantId (both work for the restaurant details route)
    const idOrSlug = restaurantData?.slug || restaurantId
    if (idOrSlug) {
      navigate(`/food/user/restaurants/${idOrSlug}`)
    } else {
      goBack()
    }
  }

  // Handler to select address by label (Home, Office, Other)
  const handleSelectAddressByLabel = async (label) => {
    try {
      // Find address with matching label
      const targetLabel = normalizeAddressLabel(label)
      const address = addresses.find(addr => normalizeAddressLabel(addr.label) === targetLabel)

      if (!address) {
        // Always keep chips clickable — open selector to add/select that label
        openLocationSelector()
        toast.info(`Add a ${label} address to use it for delivery`)
        return
      }

      await handleSelectSavedAddress(address)
    } catch (error) {
      debugError(`Error selecting ${label} address:`, error)
      toast.error(`Failed to select ${label} address. Please try again.`)
    }
  }

  const handleSelectSavedAddress = async (address) => {
    try {
      const addressId = getAddressId(address)
      if (addressId) {
        setSelectedAddressId(addressId)
        setDefaultAddress(addressId)
      }

      // Get coordinates from address location
      const coordinates = address.location?.coordinates || []
      const longitude = coordinates[0]
      const latitude = coordinates[1]

      if (!latitude || !longitude) {
        toast.error(`Invalid coordinates for ${address.label || "saved"} address`)
        return
      }

      // Update location in backend
      await userAPI.updateLocation({
        latitude,
        longitude,
        address: `${address.street}, ${address.city}`,
        city: address.city,
        state: address.state,
        area: address.additionalDetails || "",
        formattedAddress: address.additionalDetails
          ? `${address.additionalDetails}, ${address.street}, ${address.city}, ${address.state}${address.zipCode ? ` ${address.zipCode}` : ''}`
          : `${address.street}, ${address.city}, ${address.state}${address.zipCode ? ` ${address.zipCode}` : ''}`
      })

      // Update the location in localStorage
      const locationData = {
        city: address.city,
        state: address.state,
        address: `${address.street}, ${address.city}`,
        area: address.additionalDetails || "",
        zipCode: address.zipCode,
        latitude,
        longitude,
        formattedAddress: address.additionalDetails
          ? `${address.additionalDetails}, ${address.street}, ${address.city}, ${address.state}${address.zipCode ? ` ${address.zipCode}` : ''}`
          : `${address.street}, ${address.city}, ${address.state}${address.zipCode ? ` ${address.zipCode}` : ''}`
      }
      setUserLocationStorage(locationData)
      // User selected a saved address from Cart; prefer saved mode.
      persistDeliveryAddressMode("saved")
      setDeliveryAddressMode("saved")

      toast.success(`${address.label || "Saved"} address selected!`)
    } catch (error) {
      debugError("Error selecting saved address:", error)
      toast.error("Failed to select address. Please try again.")
    }
  }

  const showCouponError = (message) => {
    setCouponErrorPopup({
      open: true,
      message: message || "This coupon is not valid",
    })
  }

  const handleApplyCoupon = (coupon) => {
    // Quick UX guard for platform first-time only (restaurant first-time is validated server-side).
    if (
      coupon?.customerGroup === "new" &&
      coupon?.createdBy !== "restaurant" &&
      userOrderCount > 0
    ) {
      showCouponError("This coupon is only for first-time users on the platform")
      return
    }

    if (!isFreeDeliveryCoupon(coupon) && subtotal < (Number(coupon.minOrder) || 0)) {
      showCouponError(`Minimum order amount of ${RUPEE_SYMBOL}${Number(coupon.minOrder || 0)} required for this coupon`)
      return
    }

    const isReplacing = Boolean(appliedCoupon?.code && appliedCoupon.code !== coupon.code)
    setAppliedCoupon(coupon)
    setCouponCode(coupon.code)
    hasManuallyRemovedCouponRef.current = false
    toast.success(isReplacing ? "Coupon changed" : "Coupon applied")
  }

  const releasePlaceOrderLock = () => {
    placeOrderInFlightRef.current = false
    setIsPlacingOrder(false)
  }

  const finalizeSuccessfulOrder = (order) => {
    setPlacedOrderId(order?._id || order?.orderId || order?.id || null)
    setOrderSuccessSavingsAmount(platformPricingSavings.totalSavings > 0 ? platformPricingSavings.totalSavings : 0)
    if (platformPricingSavings.totalSavings > 0) {
      setCongratssSavingsAmount(platformPricingSavings.totalSavings)
      setCongratssSavingsPercentage(platformPricingSavings.savingsPercentage)
      setCongratssSavingsItems(platformPricingSavings.items)
      setShowSavingsCongrats(true)
    } else {
      setShowOrderSuccess(true)
    }
    window.dispatchEvent(new CustomEvent("order-placed", { detail: { order } }))
    // Skip client→server cart sync; server already cleared cart on successful order.
    clearCart({ skipServerSync: true })
    setRestaurantNote("")
    setShowRestaurantNoteInput(false)
    try {
      window.localStorage.removeItem(CART_ORDER_NOTE_STORAGE_KEY)
      window.localStorage.removeItem("scheduled_order_time")
    } catch {
      // ignore
    }
  }

  const handlePlaceOrder = async () => {
    if (placeOrderInFlightRef.current || isPlacingOrder) {
      return
    }

    if (loadingPricing || pricing == null) {
      toast.error("Please wait while we calculate your bill")
      return
    }

    if (!hasSavedAddress) {
      toast.error("Please choose a delivery location to continue")
      openLocationSelector()
      return
    }

    if (cart.length === 0) {
      alert("Your cart is empty")
      return
    }

    if (isScheduled) {
      if (!scheduledDate || !scheduledTime) {
        toast.error("Please select both date and time to schedule your order")
        return
      }
      const scheduleString = `${scheduledDate}T${scheduledTime}:00`
      const scheduleDateObj = new Date(scheduleString)
      if (scheduleDateObj < new Date()) {
        toast.error("Scheduled time must be in the future")
        return
      }
    }

    const finalRestaurantId =
      resolveEntityId(
        restaurantData?.restaurantId ||
        restaurantData?._id ||
        cart[0]?.restaurantId ||
        restaurantId,
      ) || null
    const finalRestaurantName = restaurantData?.name || cart[0]?.restaurant || null

    if (!finalRestaurantId) {
      toast.error("Restaurant information is missing. Please refresh and try again.")
      return
    }

    const invalidItems = cart.filter(
      (item) => !resolveEntityId(item.restaurantId || item.restaurant),
    )
    if (invalidItems.length > 0) {
      toast.error("Some items are missing restaurant information. Please refresh and try again.")
      return
    }

    placeOrderInFlightRef.current = true
    setIsPlacingOrder(true)

    try {
      const orderPricing = {
        couponCode: appliedCoupon?.code || pricing?.couponCode || null,
        couponCreatedBy: appliedCoupon?.createdBy || pricing?.couponCreatedBy || null,
        offerId: pricing?.offerId || null,
      }

      const orderItems = cart.map((item) => ({
        itemId: item.itemId || item.id,
        name: item.name,
        price: item.price,
        variantId: item.variantId || undefined,
        variantName: item.variantName || undefined,
        variantPrice: item.variantPrice || item.price,
        quantity: item.quantity || 1,
        image: item.image || "",
        description: item.description || "",
        isVeg: item.isVeg === true || item.foodType === "Veg",
        isAddon: Boolean(item.isAddon || item.itemType === "addon"),
        preparationTime: item.preparationTime,
        restaurantId: resolveEntityId(
          item.restaurantId || item.restaurant?._id || item.restaurant,
        ),
      }))

      const orderPayload = {
        items: orderItems,
        address: {
          ...defaultAddress,
          phone: recipientPhone || defaultAddress?.phone || "",
          name: recipientName,
          fullName: recipientName,
        },
        customerName: recipientName,
        customerPhone: recipientPhone || defaultAddress?.phone || "",
        restaurantId: finalRestaurantId,
        restaurantName: finalRestaurantName || undefined,
        isMultiRestaurant: isMultiRestaurantOrder,
        pricing: orderPricing,
        note: "",
        restaurantNote: restaurantNote || "",
        sendCutlery: sendCutlery !== false,
        paymentMethod: selectedPaymentMethod,
        // `useZone()` can return `null`. Zod expects string/undefined, not null.
        zoneId: zoneId || undefined,
        scheduledAt: isScheduled ? new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString() : undefined,
        deliveryOption: selectedDeliveryOption?.name || "Standard Delivery",
        deliverySpeedOptionId: selectedDeliveryOption?.id || deliveryOption || undefined,
        deliveryTime: selectedDeliveryOption?.time || "",
        estimatedTime: selectedDeliveryOption?.estimatedTime || 30,
      };
      // Log final order details (including paymentMethod for COD debugging)
      debugLog('?? FINAL: Sending order to backend with:', {
        restaurantId: finalRestaurantId,
        restaurantName: finalRestaurantName,
        itemCount: orderItems.length,
        paymentMethod: orderPayload.paymentMethod,
        deliverySpeedOptionId: orderPayload.deliverySpeedOptionId,
        couponCode: orderPricing.couponCode,
      });

      // Check wallet balance if wallet payment selected (UI guard; server re-validates)
      if (selectedPaymentMethod === "wallet" && walletBalance < total) {
        toast.error(`Insufficient wallet balance. Required: ${RUPEE_SYMBOL}${total.toFixed(0)}, Available: ${RUPEE_SYMBOL}${walletBalance.toFixed(0)}`)
        releasePlaceOrderLock()
        return
      }

      // Single create-order call — server validates, prices, and places wallet/prepaid order
      const orderResponse = await orderAPI.createOrder(orderPayload)

      debugLog("? Order/checkout response:", orderResponse.data)

      const {
        order,
        razorpay,
        checkoutId,
        requiresPayment,
        paymentType,
      } = orderResponse.data.data || {}

      // Wallet flow: order placed with wallet payment (already processed in backend)
      if (selectedPaymentMethod === "wallet" || paymentType === "WALLET") {
        toast.success("Order placed with Wallet payment")
        finalizeSuccessfulOrder(order)
        releasePlaceOrderLock()
        try {
          const walletResponse = await userAPI.getWallet()
          if (walletResponse?.data?.success && walletResponse?.data?.data?.wallet) {
            setWalletBalance(walletResponse.data.data.wallet.balance || 0)
          }
        } catch (error) {
          debugError("Error refreshing wallet balance:", error)
        }
        return
      }

      // Prepaid: pay first, then backend creates FoodOrder on verify
      if (!razorpay || !razorpay.orderId || !razorpay.key || !checkoutId) {
        debugError("? Razorpay checkout initialization failed:", { razorpay, checkoutId, order, requiresPayment })
        throw new Error(razorpay ? "Razorpay payment gateway is not configured. Please contact support." : "Failed to initialize payment")
      }

      debugLog("?? Razorpay checkout created:", {
        checkoutId,
        orderId: razorpay.orderId,
        amount: razorpay.amount,
        currency: razorpay.currency,
        keyPresent: !!razorpay.key
      })

      // Get user info for Razorpay prefill
      const userInfo = userProfile || {}
      const userPhone = recipientPhone || userInfo.phone || defaultAddress?.phone || ""
      const userEmail = userInfo.email || ""
      const userName = recipientName || userInfo.name || ""

      // Format phone number (remove non-digits, take last 10 digits)
      const formattedPhone = userPhone.replace(/\D/g, "").slice(-10)

      debugLog("?? User info for payment:", {
        name: userName,
        email: userEmail,
        phone: formattedPhone
      })

      // Get company name for Razorpay
      const companyName = await getCompanyNameAsync()

      // Flag to prevent double-cancellation (Razorpay can fire both onError + onClose)
      let paymentHandled = false

      const cancelAbandonedCheckout = async (reason) => {
        try {
          await orderAPI.cancelCheckout(checkoutId)
          debugLog("Checkout cancelled:", reason)
        } catch (cancelErr) {
          debugError("Failed to cancel checkout:", cancelErr)
        }
      }

      // Initialize Razorpay payment
      await initRazorpayPayment({
        key: razorpay.key,
        amount: razorpay.amount, // Already in paise from backend
        currency: razorpay.currency || 'INR',
        order_id: razorpay.orderId,
        name: companyName,
        description: `Checkout ${checkoutId} - ${RUPEE_SYMBOL}${(razorpay.amount / 100).toFixed(2)}`,
        prefill: {
          name: userName,
          email: userEmail,
          contact: formattedPhone
        },
        notes: {
          checkoutId,
          userId: userInfo.id || "",
          restaurantId: restaurantId || "unknown"
        },
        handler: async (response) => {
          paymentHandled = true
          try {
            debugLog("? Payment successful, verifying...", {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              checkoutId,
            })

            const verifyResponse = await orderAPI.verifyPayment({
              checkoutId,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature
            })

            debugLog("? Payment verification response:", verifyResponse.data)

            if (verifyResponse.data.success) {
              const placedOrder = verifyResponse.data.data?.order
              finalizeSuccessfulOrder(placedOrder)
              releasePlaceOrderLock()
            } else {
              throw new Error(verifyResponse.data.message || "Payment verification failed")
            }
          } catch (error) {
            debugError("? Payment verification error:", error)
            const errorMessage =
              error?.response?.data?.message ||
              error?.response?.data?.error?.message ||
              error?.response?.data?.errors?.[0]?.message ||
              error?.message ||
              "Payment verification failed. Please contact support."
            alert(errorMessage)
            releasePlaceOrderLock()
          }
        },
        onError: async (error) => {
          if (paymentHandled) return
          paymentHandled = true
          debugError("? Razorpay payment error:", error)
          await cancelAbandonedCheckout("Payment failed or was not completed")
          if (error?.code !== 'PAYMENT_CANCELLED' && error?.message !== 'PAYMENT_CANCELLED') {
            const errorMessage = error?.description || error?.message || "Payment failed. Please try again."
            alert(errorMessage)
          } else {
            toast.info("Payment was cancelled. No order has been placed.")
          }
          releasePlaceOrderLock()
        },
        onClose: async () => {
          if (paymentHandled) return
          paymentHandled = true
          debugLog("?? Payment modal closed by user")
          await cancelAbandonedCheckout("User closed payment gateway without paying")
          toast.info("Payment was not completed. No order has been placed.")
          releasePlaceOrderLock()
        }
      })
    } catch (error) {
      debugError("? Order creation error:", error)

      let errorMessage = "Failed to create order. Please try again."

      // Handle network errors
      if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
        const backendUrl = API_BASE_URL.replace('/api', '');
        errorMessage = `Network Error: Cannot connect to backend server.\n\n` +
          `Expected backend URL: ${backendUrl}\n\n` +
          `Please check:\n` +
          `1. Backend server is running\n` +
          `2. Backend is accessible at ${backendUrl}\n` +
          `3. Check browser console (F12) for more details\n\n` +
          `If backend is not running, start it with:\n` +
          `cd appzetofood/backend && npm start`

        debugError("?? Network Error Details:", {
          code: error.code,
          message: error.message,
          config: {
            url: error.config?.url,
            baseURL: error.config?.baseURL,
            fullUrl: error.config?.baseURL + error.config?.url,
            method: error.config?.method
          },
          backendUrl: backendUrl,
          apiBaseUrl: API_BASE_URL
        })

        // Backend disconnected - no health check (new backend in progress)
      }
      // Handle timeout errors
      else if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        errorMessage = "Request timed out. The server is taking too long to respond. Please try again."
      }
      // Handle other axios errors
      else if (error.response) {
        // Server responded with error status
        errorMessage =
          error.response.data?.message ||
          error.response.data?.error?.message ||
          error.response.data?.errors?.[0]?.message ||
          `Server error: ${error.response.status}`
      }
      // Handle other errors
      else if (error.message) {
        errorMessage = error.message
      }

      const looksLikeCouponError = /coupon/i.test(String(errorMessage || ""))
      if (looksLikeCouponError) {
        setAppliedCoupon(null)
        setCouponCode("")
        showCouponError(errorMessage)
      } else {
        toast.error(errorMessage)
      }
      releasePlaceOrderLock()
    }
  }

  const handleGoToOrders = () => {
    setShowOrderSuccess(false)
    setShowSavingsCongrats(false)
    setCongratssSavingsAmount(0)
    setCongratssSavingsPercentage(0)
    setCongratssSavingsItems([])
    setOrderSuccessSavingsAmount(0)
    navigate(`/user/orders/${placedOrderId}?confirmed=true`)
  }

  // Empty cart state - but don't show if order success or placing order modal is active
  if (cart.length === 0 && !showOrderSuccess && !showSavingsCongrats) {
    return <CartEmptyState onBack={handleBack} />
  }

  const headerAddressLabel = defaultAddress
    ? formatFullAddress(defaultAddress) || defaultAddress?.formattedAddress || defaultAddress?.address || defaultAddress?.city || "Select address"
    : "Select delivery address"

  return (
    <AnimatedPage className="relative min-h-screen bg-[#FAFAFA] dark:bg-[#0a0a0a]">
      {couponErrorPopup.open && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          onClick={() => setCouponErrorPopup({ open: false, message: "" })}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#1a1a1a] shadow-2xl border border-gray-100 dark:border-gray-800 p-5 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/40">
              <AlertCircle className="h-6 w-6 text-red-500" />
            </div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white mb-2">
              Coupon not applied
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-5 leading-relaxed">
              {couponErrorPopup.message}
            </p>
            <button
              type="button"
              className="w-full rounded-xl bg-[#16A34A] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#15803D]"
              onClick={() => setCouponErrorPopup({ open: false, message: "" })}
            >
              OK
            </button>
          </div>
        </div>,
        document.body,
      )}

      {speedOptionInfo && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          onClick={() => setSpeedOptionInfo(null)}
        >
          <div
            className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-white dark:bg-[#1a1a1a] shadow-2xl border border-gray-100 dark:border-gray-800 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {speedOptionInfo.image && (
              <img src={speedOptionInfo.image} alt="" className="w-full h-40 object-cover" />
            )}
            <div className="p-5">
            <div className="flex items-start justify-between gap-3 mb-2">
              <h3 className="text-base font-bold text-gray-900 dark:text-white">
                {speedOptionInfo.detailTitle}
              </h3>
              <button
                type="button"
                onClick={() => setSpeedOptionInfo(null)}
                className="shrink-0 p-1 -m-1 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-5 leading-relaxed whitespace-pre-line">
              {speedOptionInfo.description}
            </p>
            <button
              type="button"
              className="w-full rounded-xl bg-[#16A34A] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#15803D]"
              onClick={() => setSpeedOptionInfo(null)}
            >
              Got it
            </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <CartPageHeader
        restaurantName={restaurantName}
        deliveryTime={restaurantData?.estimatedDeliveryTime || "25-35 mins"}
        addressLabel={headerAddressLabel}
        onBack={handleBack}
        onShare={handleShare}
        onAddressClick={openLocationSelector}
      />

      <CartSavingsBanner amount={savings} rupeeSymbol={RUPEE_SYMBOL} />

      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-44 md:pb-52">
        <div className="mx-auto max-w-5xl px-4 py-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column: Items, Notes, Addons */}
            <div className="lg:col-span-7 space-y-4">
              <CartItemsCard
                items={cart}
                rupeeSymbol={RUPEE_SYMBOL}
                onUpdateQuantity={updateQuantity}
                onAddMore={handleBack}
                restaurantGroups={pricing?.restaurantGroups || []}
              />

              {/* Note & Cutlery */}
              <div className="rounded-2xl border border-gray-100 bg-white p-2.5 shadow-xs dark:border-gray-800 dark:bg-[#141414] flex gap-2 items-center">
                <button
                  type="button"
                  onClick={() => setShowRestaurantNoteInput(!showRestaurantNoteInput)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <Utensils className="h-3.5 w-3.5 text-[#16A34A]" />
                  <span className="truncate">{restaurantNote || "Add note for restaurant"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSendCutlery(!sendCutlery)}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 border rounded-xl text-xs font-semibold transition-colors ${sendCutlery ? 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300' : 'border-[#16A34A] dark:border-[#16A34A]/50 text-[#16A34A] bg-[#16A34A05] dark:bg-[#16A34A10]'}`}
                >
                  <Utensils className="h-3.5 w-3.5 text-[#16A34A]" />
                  <span className="whitespace-nowrap">
                    {sendCutlery ? "Send cutlery" : "Don't send"}
                  </span>
                </button>
              </div>

              {/* Restaurant Note Input */}
              {showRestaurantNoteInput && (
                <div className="bg-white dark:bg-[#1a1a1a] p-3 rounded-2xl border border-slate-100 dark:border-gray-800 shadow-xs">
                  <p className="text-[10px] font-black uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                    Restaurant instructions
                  </p>
                  <textarea
                    value={restaurantNote}
                    onChange={(e) => setRestaurantNote(e.target.value)}
                    placeholder="Eg. Don't add onions, make it extra spicy, etc."
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-xl p-2.5 text-xs resize-none h-16 focus:outline-none focus:border-[#16A34A] dark:focus:border-[#16A34A] bg-white dark:bg-[#0a0a0a] text-gray-900 dark:text-gray-100"
                    maxLength={240}
                  />
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <p className="text-[10px] text-gray-400 dark:text-gray-500">
                      Note for restaurant.
                    </p>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
                      {restaurantNote.length}/240
                    </span>
                  </div>
                </div>
              )}

              {/* Complete your meal section - Approved Addons */}
              {addons.length > 0 && (
                <div className="rounded-2xl border border-gray-100 bg-white px-3.5 py-3 shadow-xs dark:border-gray-800 dark:bg-[#141414]">
                  <div className="flex items-center gap-2 mb-2.5">
                    <div className="w-6 h-6 bg-gray-100 dark:bg-gray-800 rounded flex items-center justify-center">
                      <Sparkles className="h-3.5 w-3.5 text-[#16A34A]" />
                    </div>
                    <span className="text-xs font-black uppercase tracking-wider text-gray-500 dark:text-gray-400">Complete your meal with</span>
                  </div>
                  {loadingAddons ? (
                    <div className="flex gap-3 overflow-x-auto pb-1 -mx-3.5 px-3.5 scrollbar-hide">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="flex-shrink-0 w-20 md:w-24 animate-pulse">
                          <div className="w-full h-20 md:h-24 bg-gray-200 dark:bg-gray-700 rounded-lg" />
                          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded mt-1.5" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex gap-3 overflow-x-auto pb-1 -mx-3.5 px-3.5 scrollbar-hide">
                      {addons.map((addon) => (
                        <div key={addon.id} className="flex-shrink-0 w-20 md:w-24">
                          <div className="relative bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden">
                            <img
                              src={addon.image || (addon.images && addon.images[0]) || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=120&h=120&fit=crop"}
                              alt={addon.name}
                              className="w-full h-20 md:h-24 object-cover rounded-lg"
                              onError={(e) => {
                                e.target.onerror = null
                                e.target.src = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=120&h=120&fit=crop"
                              }}
                            />
                            <div className="absolute top-0.5 left-0.5">
                              <div className="w-2.5 h-2.5 bg-white border border-green-600 flex items-center justify-center rounded-[3px]">
                                <div className="w-1.5 h-1.5 rounded-full bg-green-600" />
                              </div>
                            </div>
                            <button
                              onClick={() => {
                                const cartRestaurantId = cart[0]?.restaurantId || restaurantId;
                                const cartRestaurantName = cart[0]?.restaurant || restaurantName;

                                if (!cartRestaurantId || !cartRestaurantName) {
                                  debugError('? Cannot add addon: Missing restaurant information', {
                                    cartRestaurantId,
                                    cartRestaurantName,
                                    restaurantId,
                                    restaurantName,
                                    cartItem: cart[0]
                                  });
                                  toast.error('Restaurant information is missing. Please refresh the page.');
                                  return;
                                }

                                addToCart({
                                  id: addon.id,
                                  name: addon.name,
                                  price: addon.price,
                                  image: addon.image || (addon.images && addon.images[0]) || "",
                                  description: addon.description || "",
                                  isVeg: true,
                                  isAddon: true,
                                  itemType: "addon",
                                  restaurant: cartRestaurantName,
                                  restaurantId: cartRestaurantId
                                });
                              }}
                              className="absolute bottom-1 right-1 w-5 h-5 bg-white border border-[#16A34A] rounded flex items-center justify-center shadow-xs hover:bg-[#16A34A05] dark:hover:bg-[#16A34A10] transition-colors"
                            >
                              <Plus className="h-3 w-3 text-[#16A34A]" />
                            </button>
                          </div>
                          <p className="text-[10px] font-bold text-gray-800 dark:text-gray-200 mt-1 line-clamp-1 leading-tight">{addon.name}</p>
                          <p className="text-[10px] text-gray-900 dark:text-gray-100 font-extrabold mt-0.5">{RUPEE_SYMBOL}{addon.price}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right Column: Coupon, Delivery, Address, Contact, Bill Details */}
            <div className="lg:col-span-5 space-y-3">
              {/* Coupon Section */}
              <div className="rounded-2xl border border-gray-100 bg-white shadow-xs dark:border-gray-800 dark:bg-[#141414] flex flex-col">
                {customerDeliveryFee === 0 && (deliveryFee > 0 || deliveryDiscount > 0) && (
                  <div className="px-4 py-2.5 md:px-5 md:py-3 border-b border-dashed border-gray-200 dark:border-gray-800 flex items-center gap-3 bg-[#f4fcf7] dark:bg-green-900/10">
                    <CheckCircle2 className="h-4.5 w-4.5 text-green-600 fill-green-600/20" />
                    <span className="text-xs md:text-sm font-bold text-gray-800 dark:text-gray-200">
                      You saved {RUPEE_SYMBOL}{(deliveryDiscount || deliveryFee || 0).toFixed(0)} on delivery
                    </span>
                  </div>
                )}

                <div className="px-4 py-2.5 md:px-5 md:py-3 flex flex-col gap-2">
                  <div className="flex items-start gap-3">
                    <Percent className="h-5 w-5 text-gray-700 dark:text-gray-300 mt-2 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                        {loadingCoupons
                          ? "Loading coupons..."
                          : isMultiRestaurantOrder
                            ? "Platform coupons only (multi-restaurant cart)"
                            : "Select a coupon (one per order)"}
                      </p>
                      {loadingCoupons ? (
                        <div className="h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0a0a0a] animate-pulse" />
                      ) : availableCoupons.length > 0 ? (
                        <>
                          <Select
                            value={appliedCoupon?.code || "__none__"}
                            onValueChange={(value) => {
                              if (value === "__none__") {
                                if (appliedCoupon) {
                                  setAppliedCoupon(null)
                                  setCouponCode("")
                                  hasManuallyRemovedCouponRef.current = true
                                }
                                return
                              }
                              const coupon = availableCoupons.find((c) => c.code === value)
                              if (coupon) handleApplyCoupon(coupon)
                            }}
                          >
                            <SelectTrigger className="w-full h-10 text-sm">
                              <SelectValue placeholder="Choose a coupon" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">No coupon</SelectItem>
                              {availableCoupons.map((coupon) => {
                                const isPlatformFirstTimeBlocked =
                                  coupon.customerGroup === "new" &&
                                  coupon.createdBy !== "restaurant" &&
                                  userOrderCount > 0
                                const isEligible = (isFreeDeliveryCoupon(coupon) || subtotal >= (Number(coupon.minOrder) || 0))
                                  && !isPlatformFirstTimeBlocked
                                const source = coupon.sourceLabel || (coupon.createdBy === "restaurant" ? "Restaurant" : "Platform")
                                return (
                                  <SelectItem
                                    key={coupon.code}
                                    value={coupon.code}
                                    disabled={!isEligible}
                                  >
                                    {coupon.code} — {coupon.discountDisplay || `Save ${RUPEE_SYMBOL}${coupon.discount}`} ({source})
                                  </SelectItem>
                                )
                              })}
                            </SelectContent>
                          </Select>
                          {appliedCoupon && (
                            <p className="text-xs text-[#16A34A] font-medium mt-1.5">
                              '{appliedCoupon.code}' applied
                              {totalCouponSavings > 0
                                ? ` · You saved ${RUPEE_SYMBOL}${totalCouponSavings.toFixed(0)}`
                                : isFreeDeliveryCoupon(appliedCoupon)
                                  ? " · Free delivery applied"
                                  : ""}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-gray-500">No offers available</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Delivery Speed Options */}
              <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3.5 md:py-4 shadow-xs dark:border-gray-800 dark:bg-[#141414]">
                <div className="flex items-center gap-2 mb-3">
                  <div className="bg-[#16A34A05] dark:bg-[#16A34A10] p-1.5 rounded-lg shrink-0">
                    <Bike className="h-4 w-4 text-[#16A34A]" />
                  </div>
                  <span className="text-sm font-extrabold text-gray-800 dark:text-gray-200 tracking-tight">Delivery Speed Options</span>
                </div>

                {loadingSpeedOptions ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-[58px] rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
                    ))}
                  </div>
                ) : !isScheduled && deliveryOptions.length > 0 ? (
                  <div className="space-y-2">
                    {deliveryOptions.map((option) => {
                      const isSelected = deliveryOption === option.id
                      const IconComponent = option.icon
                      const feeAmount = isDeliveryFreeForCustomer
                        ? 0
                        : Math.max(0, deliveryFeeBeforeSpeed + (Number(option.feeModifier) || 0))

                      return (
                        <div
                          key={option.id}
                          className={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer border transition-all ${isSelected
                            ? "border-[#16A34A] bg-[#16A34A]/5 dark:bg-[#16A34A]/10 shadow-xs"
                            : "border-gray-100 hover:border-green-200 dark:border-gray-800 dark:hover:border-gray-700 bg-white dark:bg-[#141414]"
                            }`}
                          onClick={() => setDeliveryOption(option.id)}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className={`p-1.5 rounded-lg transition-colors shrink-0 ${isSelected
                              ? "bg-[#16A34A] text-white"
                              : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                              }`}>
                              <IconComponent className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0 text-left">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold text-xs md:text-sm text-gray-900 dark:text-white leading-none">
                                  {option.name}
                                </span>
                                {option.badge && (
                                  <span className={`text-[9px] font-extrabold px-1.5 py-0 rounded border ${option.badgeColor}`}>
                                    {option.badge}
                                  </span>
                                )}
                                {option.detailTitle && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setSpeedOptionInfo(option)
                                    }}
                                    className="p-0.5 rounded-full text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                                    aria-label={`What is ${option.name}?`}
                                  >
                                    <Info className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                              <p className="text-[10px] text-gray-500 mt-0.5 leading-none">
                                {option.description}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right">
                              <p className="text-xs font-bold text-[#16A34A] leading-none">
                                {option.time}
                              </p>
                              <p className="text-[10px] font-semibold text-gray-400 mt-0.5 leading-none">
                                {isDeliveryFreeForCustomer || feeAmount === 0
                                  ? "FREE"
                                  : `${RUPEE_SYMBOL}${feeAmount.toFixed(2)}`}
                              </p>
                              {isDeliveryFreeForCustomer && (
                                <p className="text-[9px] text-emerald-600 mt-0.5 leading-none">
                                  ETA only
                                </p>
                              )}
                            </div>
                            <div className={`h-3.5 w-3.5 rounded-full border flex items-center justify-center shrink-0 ${isSelected ? "border-[#16A34A] bg-[#16A34A]" : "border-gray-300 dark:border-gray-600"
                              }`}>
                              {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : isScheduled ? (
                  <div className="bg-slate-50 dark:bg-slate-900/40 p-2.5 rounded-xl mb-2 text-center border border-slate-100 dark:border-slate-800">
                    <p className="text-xs font-bold text-slate-850 dark:text-slate-200">Scheduled Order Mode</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">Delivery will arrive at the scheduled time chosen below</p>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 text-center py-2">No delivery speed options available</p>
                )}

                <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-gray-800/80">
                  <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                    Want this later?
                    <button onClick={() => {
                      const next = !isScheduled
                      setIsScheduled(next)
                      if (next && !scheduledDate) {
                        // Auto-set today's date so time slots populate immediately
                        const now = new Date()
                        const todayStr = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0]
                        setScheduledDate(todayStr)
                      }
                    }} className="border-b border-dashed border-gray-500 font-bold outline-none">
                      {isScheduled ? "Cancel schedule" : "Schedule it"}
                    </button>
                  </p>
                </div>

                {isScheduled && (
                  <div className="mt-3 flex flex-col sm:flex-row gap-2.5 pt-2.5 border-t border-gray-100 dark:border-gray-800">
                    <div className="flex-1">
                      <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-1">Date</label>
                      <input
                        type="date"
                        min={new Date().toLocaleDateString('en-CA')}
                        max={new Date(Date.now() + 86400000).toLocaleDateString('en-CA')}
                        value={scheduledDate}
                        onChange={(e) => setScheduledDate(e.target.value)}
                        className="w-full text-xs p-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-[#0a0a0a] text-gray-800 dark:text-gray-200 focus:outline-none focus:border-[#16A34A]"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-1">Time</label>
                      {availableTimeSlots.length > 0 ? (
                        <div className="relative">
                          <select
                            value={scheduledTime}
                            onChange={(e) => setScheduledTime(e.target.value)}
                            className="w-full text-xs p-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-[#0a0a0a] text-gray-800 dark:text-gray-200 focus:outline-none focus:border-[#16A34A] appearance-none pr-8"
                          >
                            {availableTimeSlots.map(slot => (
                              <option key={slot.value} value={slot.value}>{slot.label}</option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500 pointer-events-none" />
                        </div>
                      ) : (
                        <div className="w-full text-xs p-2 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded-md text-center border border-gray-200 dark:border-gray-700">
                          {scheduledDate ? "No slots available" : "Select date first"}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Delivery Address */}
              <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3.5 shadow-xs dark:border-gray-800 dark:bg-[#141414]">
                <div className="flex items-center justify-between w-full text-left">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="bg-[#16A34A05] dark:bg-[#16A34A10] p-1.5 rounded-lg">
                      <MapPin className="h-5 w-5 text-[#16A34A]" />
                    </div>
                    <div className="flex-1">
                      <div className="flex flex-col">
                        <p className="text-sm md:text-base text-gray-800 dark:text-gray-200">
                          Delivery at{" "}
                          <span className="font-semibold">
                            {deliveryAddressMode === "current" ? "Current location" : "Location"}
                          </span>
                        </p>
                        {deliveryAddressMode === "current" ? (
                          <div className="mt-1">
                            {currentLocationLoading || !currentLocationAddress ? (
                              <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 animate-pulse">
                                Finding your current address...
                              </p>
                            ) : (
                              <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                                {formatFullAddress(currentLocationAddress) ||
                                  currentLocationAddress?.formattedAddress ||
                                  currentLocationAddress?.address ||
                                  "Add delivery address"}
                              </p>
                            )}
                            <div className="mt-1 flex items-center gap-2">
                              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] md:text-[11px] font-semibold bg-[#16A34A05] text-[#16A34A] dark:bg-[#16A34A10] dark:text-[#16A34A] border border-[#16A34A]/30">
                                GPS enabled
                              </span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2 pr-4">
                            {defaultAddress ? (formatFullAddress(defaultAddress) || defaultAddress?.formattedAddress || defaultAddress?.address || "Add delivery address") : "Add delivery address"}
                          </p>
                        )}
                      </div>
                      {!hasSavedAddress && (
                        <p className="text-sm text-[#16A34A] mt-2 font-medium">
                          Select a delivery location to continue
                        </p>
                      )}
                      {/* Address Selection Buttons */}
                      <div className="flex flex-wrap gap-2 mt-3">
                        {["Home", "Work", "Other"].map((label) => {
                          const normalizedLabel = normalizeAddressLabel(label)
                          const addressExists = addresses.some(addr => normalizeAddressLabel(addr.label) === normalizedLabel)
                          const activeAddress =
                            deliveryAddressMode === "current"
                              ? null
                              : (selectedAddress || savedAddress)
                          const isSelected =
                            Boolean(activeAddress) &&
                            normalizeAddressLabel(activeAddress.label) === normalizedLabel
                          return (
                            <button
                              key={label}
                              type="button"
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                handleSelectAddressByLabel(label)
                              }}
                              className={`text-xs px-4 py-1.5 rounded-full font-semibold transition-all ${isSelected
                                ? "bg-[#16A34A] text-white"
                                : addressExists
                                  ? "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-gray-800 dark:text-gray-300"
                                  : "bg-white text-slate-600 border border-dashed border-slate-300 hover:border-[#16A34A] hover:text-[#16A34A] dark:bg-gray-900 dark:border-gray-700"
                                }`}
                            >
                              {label}
                            </button>
                          )
                        })}
                      </div>
                      {addresses.length > 0 && (
                        <div className="mt-4 space-y-3">
                          {addresses.map((address) => {
                            const addressId = getAddressId(address)
                            const isSelected = addressId && addressId === selectedAddressId
                            return (
                              <button
                                key={addressId || `${address.label}-${address.street}-${address.city}`}
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  handleSelectSavedAddress(address)
                                }}
                                className={`w-full text-left rounded-xl border-2 p-3 transition-colors ${isSelected
                                  ? "border-[#16A34A] bg-[#16A34A05] dark:bg-[#16A34A]/5"
                                  : "border-slate-100 dark:border-gray-800 hover:border-slate-200"
                                  }`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                                      {getDisplayAddressLabel(address.label)}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-1">
                                      {formatFullAddress(address) || address.address || "Address details"}
                                    </p>
                                  </div>
                                  {isSelected && (
                                    <span className="text-[10px] bg-[#16A34A] text-white px-2 py-0.5 rounded uppercase font-bold tracking-wider whitespace-nowrap">
                                      Selected
                                    </span>
                                  )}
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={openLocationSelector}
                    className="p-2 text-[#16A34A] bg-[#16A34A05] rounded-full hover:bg-[#16A34A10] transition-colors dark:bg-[#16A34A15] dark:hover:bg-[#16A34A20]"
                    aria-label="Open location selector"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Contact */}
              <div className="rounded-3xl border border-gray-100 bg-white px-4 md:px-6 py-4 shadow-sm dark:border-gray-800 dark:bg-[#141414]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 md:gap-4 flex-1 min-w-0">
                    <Phone className="h-4 w-4 md:h-5 md:w-5 text-gray-500 dark:text-gray-400 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm md:text-base text-gray-800 dark:text-gray-200 font-medium">
                        {recipientName}, <span className="font-semibold">{recipientPhone || "+91-XXXXXXXXXX"}</span>
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Order recipient details
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsEditingRecipient((prev) => !prev)}
                    className="text-[#16A34A] text-xs md:text-sm font-semibold whitespace-nowrap"
                  >
                    {isEditingRecipient ? "Done" : "Change"}
                  </button>
                </div>

                {isEditingRecipient && (
                  <div className="mt-4 pt-4 border-t border-dashed border-gray-200 dark:border-gray-800 space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                        Name
                      </label>
                      <input
                        type="text"
                        value={recipientDetails.name}
                        onChange={(e) =>
                          setRecipientDetails((prev) => ({
                            ...prev,
                            name: e.target.value,
                          }))
                        }
                        placeholder="Enter recipient name"
                        className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#111111] px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-[#16A34A]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        value={recipientDetails.phone}
                        onChange={(e) =>
                          setRecipientDetails((prev) => ({
                            ...prev,
                            phone: sanitizeRecipientPhone(e.target.value),
                          }))
                        }
                        placeholder="Enter recipient phone"
                        className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#111111] px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-[#16A34A]"
                      />
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      Ordering for someone else? Save their name and phone number here.
                    </p>
                  </div>
                )}
              </div>

              {/* Order size & large-cart delivery notice */}
              <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3.5 shadow-xs dark:border-gray-800 dark:bg-[#141414]">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 dark:bg-orange-950/30">
                      <Bike className="h-5 w-5 text-[#23361A] dark:text-orange-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-900 dark:text-white">Items in your cart</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {cartCount} item{cartCount === 1 ? "" : "s"} total (qty incl. variants)
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-xl bg-gray-100 dark:bg-gray-800 px-3 py-1.5 text-lg font-extrabold text-gray-900 dark:text-white tabular-nums">
                    {cartCount}
                  </span>
                </div>

                {isLargeCart && (
                  <div className="mt-3 rounded-xl border-2 border-amber-300/70 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 dark:from-amber-950/30 dark:via-orange-950/20 dark:to-amber-950/30 dark:border-amber-600/40 p-3.5">
                    <div className="flex items-start gap-2.5">
                      <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div className="space-y-1.5">
                        <p className="text-sm font-bold text-amber-900 dark:text-amber-100">
                          Large order — delivery update
                        </p>
                        <p className="text-xs leading-relaxed text-amber-900/90 dark:text-amber-100/90">
                          Your cart has more than {LARGE_CART_ITEM_THRESHOLD} items. If one delivery partner cannot complete the order, our system may automatically assign up to two partners — this depends entirely on partner availability. Estimated delivery time may be different than usual.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Bill Details */}
              <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3.5 shadow-xs dark:border-gray-800 dark:bg-[#141414]">
                <button
                  onClick={() => setShowBillDetails(!showBillDetails)}
                  className="flex items-center justify-between w-full"
                >
                  <div className="flex items-center gap-3 md:gap-4">
                    <FileText className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                    <div className="text-left">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="text-base text-gray-800 dark:text-gray-200 font-semibold tracking-wide">To Pay</span>
                        {platformPricingSavings.hasPlatformPricing && (
                          <span className="text-base text-gray-400 dark:text-gray-500 line-through font-medium">
                            {RUPEE_SYMBOL}{platformPricingSavings.totalPlatformPriceWithGst.toFixed(2)}
                          </span>
                        )}
                        <span className="text-base font-bold text-gray-900 dark:text-white">
                          {RUPEE_SYMBOL}{total.toFixed(2)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Incl. taxes and charges</p>
                    </div>
                  </div>
                  <ChevronRight className={`h-5 w-5 text-gray-400 transition-transform ${showBillDetails ? 'rotate-90' : ''}`} />
                </button>

                {showBillDetails && (
                  <div className="mt-3 pt-3 border-t border-dashed border-gray-200 dark:border-gray-800 space-y-2">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-600 dark:text-gray-400">Food Total</span>
                      <span className="text-gray-800 dark:text-gray-200 font-medium">{RUPEE_SYMBOL}{billSubtotal.toFixed(2)}</span>
                    </div>

                    {(deliveryFeeBreakdown != null || speedFeeModifier !== 0 || deliveryMultiplierSurcharge > 0) ? (
                      <>
                        {deliveryBaseBeforeMultiplier > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600 dark:text-gray-400">Base Delivery Fee</span>
                            <span className="text-gray-800 dark:text-gray-200 font-medium">
                              {RUPEE_SYMBOL}{deliveryBaseBeforeMultiplier.toFixed(2)}
                            </span>
                          </div>
                        )}
                        {deliveryMultiplierSurcharge > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600 dark:text-gray-400">
                              {deliveryFeeBreakdown?.isMultiRestaurant
                                ? "Multi-restaurant delivery surcharge"
                                : "Large order delivery surcharge"}
                            </span>
                            <span className="text-gray-800 dark:text-gray-200 font-medium">
                              {RUPEE_SYMBOL}{deliveryMultiplierSurcharge.toFixed(2)}
                            </span>
                          </div>
                        )}
                        {speedFeeModifier !== 0 && selectedDeliveryOption && !isDeliveryFreeForCustomer && (
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600 dark:text-gray-400">
                              {speedFeeModifier > 0
                                ? `${selectedDeliveryOption.name} surcharge`
                                : `${selectedDeliveryOption.name} discount`}
                            </span>
                            <span className={speedFeeModifier < 0 ? "text-[#16A34A] font-medium" : "text-gray-800 dark:text-gray-200 font-medium"}>
                              {speedFeeModifier < 0 ? "-" : ""}{RUPEE_SYMBOL}{Math.abs(speedFeeModifier).toFixed(2)}
                            </span>
                          </div>
                        )}
                        {peakHourCharge > 0 && !isDeliveryFreeForCustomer && (
                          <div className="flex justify-between text-sm">
                            <span className="text-amber-700 dark:text-amber-400 flex items-center gap-1">
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
                              {peakHourRuleName || "Peak hour charge"}
                            </span>
                            <span className="text-amber-700 dark:text-amber-400 font-medium">
                              +{RUPEE_SYMBOL}{peakHourCharge.toFixed(2)}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between text-sm font-semibold">
                          <span className="text-gray-700 dark:text-gray-300">Total Delivery Fee</span>
                          <span className="flex items-center gap-2">
                            {deliveryDiscount > 0 && deliveryFee > 0 && (
                              <span className="text-gray-400 line-through text-xs font-normal">
                                {RUPEE_SYMBOL}{deliveryFee.toFixed(2)}
                              </span>
                            )}
                            <span className={customerDeliveryFee === 0 ? "text-[#16A34A]" : "text-gray-900 dark:text-white"}>
                              {customerDeliveryFee === 0 ? "FREE" : `${RUPEE_SYMBOL}${customerDeliveryFee.toFixed(2)}`}
                            </span>
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-400">Delivery Fee</span>
                        <span className="flex items-center gap-2">
                          {deliveryDiscount > 0 && deliveryFee > 0 && (
                            <span className="text-gray-400 line-through text-xs font-normal">
                              {RUPEE_SYMBOL}{deliveryFee.toFixed(2)}
                            </span>
                          )}
                          <span className={customerDeliveryFee === 0 ? "text-[#16A34A] font-medium" : "text-gray-800 dark:text-gray-200 font-medium"}>
                            {customerDeliveryFee === 0 ? "FREE" : `${RUPEE_SYMBOL}${customerDeliveryFee.toFixed(2)}`}
                          </span>
                        </span>
                      </div>
                    )}
                    {deliveryFeeBreakdownText && (
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 -mt-1.5 ml-1 border-l-2 border-gray-100 pl-2">
                        {deliveryFeeBreakdownText}
                      </div>
                    )}
                    {isMultiRestaurantOrder && (
                      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-lg p-2.5 -mx-1 mt-1">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-[11px] font-semibold text-amber-900 dark:text-amber-100">
                              Multiple restaurants selected
                            </p>
                            <p className="text-[10px] text-amber-800 dark:text-amber-200 mt-0.5">
                              Delivery fee includes a surcharge for orders from multiple restaurants
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">Platform Fee</span>
                      <span className="text-gray-800 dark:text-gray-200 font-medium">{RUPEE_SYMBOL}{billPlatformFee.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">Packaging Total</span>
                      <span className="text-gray-800 dark:text-gray-200 font-medium">{RUPEE_SYMBOL}{billPackagingFee.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">GST</span>
                      <span className="text-gray-800 dark:text-gray-200 font-medium">{RUPEE_SYMBOL}{billTax.toFixed(2)}</span>
                    </div>
                    {billDiscount > 0 && (
                      <div className="flex justify-between text-sm text-[#16A34A] font-medium">
                        <span>Coupon Discount</span>
                        <span>-{RUPEE_SYMBOL}{billDiscount.toFixed(2)}</span>
                      </div>
                    )}
                    {deliveryDiscount > 0 && (
                      <div className="flex justify-between text-sm text-[#16A34A] font-medium">
                        <span>Free Delivery (Coupon)</span>
                        <span>-{RUPEE_SYMBOL}{deliveryDiscount.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center text-sm font-bold border-t border-gray-200 dark:border-gray-700 pt-2 mt-1">
                      <span className="text-gray-900 dark:text-white">Grand Total</span>
                      <span className="text-gray-900 dark:text-white">{RUPEE_SYMBOL}{total.toFixed(2)}</span>
                    </div>

                    {/* Platform Pricing Comparison - Bottom */}
                    {platformPricingSavings.hasPlatformPricing && (
                      <div className="rounded-lg bg-gradient-to-r from-[#16A34A]/5 via-[#16A34A]/12 to-[#16A34A]/5 dark:from-[#16A34A]/10 dark:via-[#16A34A]/15 dark:to-[#16A34A]/10 border border-[#16A34A]/20 p-3 space-y-2 mt-2 shadow-sm animate-pulse">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-[#16A34A]" />
                            <span className="font-semibold text-[#16A34A]">Other platform total</span>
                          </div>
                          <span className="text-gray-700 dark:text-gray-300 font-medium">{RUPEE_SYMBOL}{platformPricingSavings.totalPlatformPrice.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                          <span>GST on other platforms</span>
                          <span className="font-medium">{RUPEE_SYMBOL}{platformPricingSavings.totalPlatformGst.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm font-semibold text-gray-800 dark:text-gray-200">
                          <span>Other platform total (incl. GST)</span>
                          <span>{RUPEE_SYMBOL}{platformPricingSavings.totalPlatformPriceWithGst.toFixed(2)}</span>
                        </div>
                        {platformPricingSavings.items.length > 0 && (
                          <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1 border-t border-[#16A34A]/15 pt-2">
                            {platformPricingSavings.items.slice(0, 2).map((item, idx) => (
                              <div key={idx} className="flex justify-between">
                                <span>{item.name} x{item.quantity}</span>
                                <span className="font-medium text-[#16A34A]">-{RUPEE_SYMBOL}{item.savings.toFixed(0)}</span>
                              </div>
                            ))}
                            {platformPricingSavings.items.length > 2 && (
                              <div className="text-center font-semibold text-[#16A34A]">
                                +{platformPricingSavings.items.length - 2} more items
                              </div>
                            )}
                          </div>
                        )}
                        <div className="flex items-center justify-between text-xs font-bold text-white bg-[#16A34A] rounded px-2 py-1.5 -mx-3 -mb-3">
                          <span>You save approx</span>
                          <span>{RUPEE_SYMBOL}{platformPricingSavings.totalSavings.toFixed(0)} ({platformPricingSavings.savingsPercentage}%)</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <CartCheckoutBar
        rupeeSymbol={RUPEE_SYMBOL}
        total={total}
        selectedPaymentMethod={selectedPaymentMethod}
        selectedPaymentLabel={selectedPaymentLabel}
        walletBalance={walletBalance}
        isPlacingOrder={isPlacingOrder}
        isCalculatingPricing={loadingPricing}
        hasSavedAddress={hasSavedAddress}
        disabled={
          isPlacingOrder ||
          isValidating ||
          loadingPricing ||
          (hasSavedAddress && cart.length > 0 && pricing == null) ||
          hasClosedRestaurants ||
          (selectedPaymentMethod === "wallet" && walletBalance < total)
        }
        onOpenPayment={() => setShowPaymentSheet(true)}
        onPlaceOrder={handlePlaceOrder}
      />

      <RestaurantUnavailableModal
        open={showAvailabilityModal}
        closedRestaurants={closedRestaurants}
        onRemoveClosedItems={handleRemoveClosedRestaurantItems}
        onContinueReviewing={handleContinueReviewingCart}
      />

      <AddMoneyModal
        open={showAddMoneyModal}
        onOpenChange={setShowAddMoneyModal}
        initialAmount={Math.max(1, Math.ceil(Math.max(0, total - walletBalance)))}
        onSuccess={async () => {
          const balance = await refreshWalletBalance()
          if (balance >= total) {
            setSelectedPaymentMethod("wallet")
            setShowPaymentSheet(false)
          }
        }}
      />

      {/* Savings Congratulations Page */}
      {showSavingsCongrats && (
        <div
          className="fixed inset-0 z-[70] bg-gradient-to-br from-green-50 to-emerald-50 dark:from-[#0a1a0a] dark:to-[#0a2a0a] flex flex-col items-center justify-center h-screen w-screen overflow-hidden"
          style={{ animation: 'fadeIn 0.3s ease-out' }}
        >
          {/* Confetti Animation */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {[...Array(40)].map((_, i) => (
              <div
                key={i}
                className="absolute w-2 h-2 rounded-full"
                style={{
                  left: `${Math.random() * 100}%`,
                  top: `-10%`,
                  backgroundColor: ['#22c55e', '#10b981', '#34d399', '#6ee7b7'][Math.floor(Math.random() * 4)],
                  animation: `confettiFall ${2.5 + Math.random() * 1.5}s linear ${Math.random() * 1}s infinite`,
                  transform: `rotate(${Math.random() * 360}deg)`,
                }}
              />
            ))}
          </div>

          {/* Content */}
          <div className="relative z-10 flex flex-col items-center px-6 py-12">
            {/* Trophy/Congrats Icon */}
            <div
              className="mb-8"
              style={{ animation: 'bounce 0.8s ease-in-out infinite' }}
            >
              <div className="w-24 h-24 bg-gradient-to-br from-yellow-400 to-yellow-500 rounded-full flex items-center justify-center shadow-2xl shadow-yellow-300/60 dark:shadow-yellow-900/40">
                <span className="text-5xl">🎉</span>
              </div>
            </div>

            {/* Congratulations Text */}
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4 text-center">
              Congratulations!
            </h1>

            {/* Savings Amount */}
            <div className="text-center">
              <p className="text-gray-600 dark:text-gray-300 text-lg mb-2">You saved approx</p>
              <div className="text-5xl md:text-6xl font-bold text-green-600 dark:text-green-400 mb-4">
                {RUPEE_SYMBOL}{congratsSavingsAmount.toFixed(0)}
              </div>
              <p className="text-gray-600 dark:text-gray-400 text-base">
                {congratsSavingsPercentage}% cheaper than other platforms
              </p>
            </div>

            {/* Items breakdown */}
            {congratsSavingsItems.length > 0 && (
              <div className="mt-8 max-w-sm bg-white dark:bg-[#1a1a1a] rounded-lg p-4 border border-green-200 dark:border-green-900/50">
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 text-center">Savings on your items:</p>
                <div className="space-y-2">
                  {congratsSavingsItems.slice(0, 3).map((item, idx) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">{item.name}</span>
                      <span className="font-semibold text-green-600 dark:text-green-400">-{RUPEE_SYMBOL}{item.savings.toFixed(0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Order Success Celebration Page */}
      {showOrderSuccess && (
        <div
          className="fixed inset-0 z-[70] bg-white dark:bg-[#0a0a0a] flex flex-col items-center justify-center h-screen w-screen overflow-hidden"
          style={{ animation: 'fadeIn 0.3s ease-out' }}
        >
          {/* Confetti Background */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {/* Animated confetti pieces */}
            {[...Array(50)].map((_, i) => (
              <div
                key={i}
                className="absolute w-3 h-3 rounded-sm"
                style={{
                  left: `${Math.random() * 100}%`,
                  top: `-10%`,
                  backgroundColor: ['#16A34A', '#3b82f6', '#f59e0b', '#ef4444', '#15803D', '#ec4899'][Math.floor(Math.random() * 6)],
                  animation: `confettiFall ${2 + Math.random() * 2}s linear ${Math.random() * 2}s infinite`,
                  transform: `rotate(${Math.random() * 360}deg)`,
                }}
              />
            ))}
          </div>

          {/* Success Content */}
          <div className="relative z-10 flex flex-col items-center px-6">
            {/* Success Tick Circle */}
            <div
              className="relative mb-8"
              style={{ animation: 'scaleIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s both' }}
            >
              {/* Outer ring animation */}
              <div
                className="absolute inset-0 w-32 h-32 rounded-full border-4 border-green-500 dark:border-green-400"
                style={{
                  animation: 'ringPulse 1.5s ease-out infinite',
                  opacity: 0.3
                }}
              />
              {/* Main circle */}
              <div className="w-32 h-32 bg-gradient-to-br from-green-500 to-green-600 dark:from-green-500 dark:to-emerald-500 rounded-full flex items-center justify-center shadow-2xl shadow-green-200/60 dark:shadow-green-900/40">
                <svg
                  className="w-16 h-16 text-white"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ animation: 'checkDraw 0.5s ease-out 0.5s both' }}
                >
                  <path d="M5 12l5 5L19 7" className="check-path" />
                </svg>
              </div>
              {/* Sparkles */}
              {[...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className="absolute w-2 h-2 bg-yellow-400 dark:bg-yellow-300 rounded-full"
                  style={{
                    top: '50%',
                    left: '50%',
                    animation: `sparkle 0.6s ease-out ${0.3 + i * 0.1}s both`,
                    transform: `rotate(${i * 60}deg) translateY(-80px)`,
                  }}
                />
              ))}
            </div>

            {/* Location Info */}
            <div
              className="text-center"
              style={{ animation: 'slideUp 0.5s ease-out 0.6s both' }}
            >
              <div className="flex items-center justify-center gap-2 mb-2">
                <div className="w-5 h-5 text-red-500 dark:text-red-400">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {defaultAddress?.city || "Your Location"}
                </h2>
              </div>
              <p className="text-gray-500 dark:text-gray-400 text-base">
                {defaultAddress ? (formatFullAddress(defaultAddress) || defaultAddress?.formattedAddress || defaultAddress?.address || "Delivery Address") : "Delivery Address"}
              </p>
            </div>

            {/* Order Placed Message */}
            <div
              className="mt-12 text-center"
              style={{ animation: 'slideUp 0.5s ease-out 0.8s both' }}
            >
              <h3 className="text-3xl font-bold text-[#16A34A] dark:text-[#B4D957] mb-2">Order Placed!</h3>
              <p className="text-gray-600 dark:text-gray-300">Your delicious food is on its way</p>
              {orderSuccessSavingsAmount > 0 && (
                <p className="mt-2 text-sm text-[#16A34A] dark:text-[#B4D957]">
                  You save approx {RUPEE_SYMBOL}{orderSuccessSavingsAmount.toFixed(0)} on this order
                </p>
              )}
            </div>

            {/* Platform Pricing Savings Celebration */}
            {platformPricingSavings.hasPlatformPricing && platformPricingSavings.totalSavings > 0 && (
              <motion.div
                className="mt-8 w-full max-w-sm bg-gradient-to-br from-[#16A34A]/10 to-[#16A34A]/5 dark:from-[#16A34A]/20 dark:to-[#16A34A]/10 border border-[#16A34A]/30 rounded-2xl p-4"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6, delay: 1.0 }}
              >
                <div className="flex items-center justify-center gap-2 mb-3">
                  <Sparkles className="h-5 w-5 text-[#16A34A]" />
                  <span className="font-bold text-[#16A34A]">You Saved on this Order</span>
                </div>
                <div className="text-center space-y-1">
                  <div className="text-4xl font-black text-[#16A34A]">
                    {RUPEE_SYMBOL}{platformPricingSavings.totalSavings.toFixed(0)}
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {platformPricingSavings.savingsPercentage}% cheaper than other platforms
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
                    By ordering with us instead of Swiggy, Zomato, & others
                  </p>
                </div>
              </motion.div>
            )}

            {/* Action Button */}
            <button
              onClick={handleGoToOrders}
              className="mt-10 bg-[#16A34A] hover:bg-[#15803D] text-white font-semibold py-4 px-12 rounded-xl shadow-lg shadow-[#16A34A]/20 dark:shadow-[#16A34A]/40 transition-all hover:shadow-xl hover:scale-105"
              style={{ animation: 'slideUp 0.5s ease-out 1s both' }}
            >
              Track Your Order
            </button>
          </div>
        </div>
      )}

      {/* Payment Selection Bottom Sheet */}
      <AnimatePresence>
        {showPaymentSheet && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPaymentSheet(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 350 }}
              className="fixed bottom-0 left-0 right-0 bg-white dark:bg-[#1a1a1a] rounded-t-[2rem] z-[101] shadow-2xl overflow-hidden max-h-[82vh] md:max-h-[60vh] flex flex-col"
              style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
            >
              <div className="p-5 md:p-6 flex flex-col h-full min-h-0">
                {/* Compact Drag handle */}
                <div className="w-10 h-1 bg-gray-200 dark:bg-gray-800 rounded-full mx-auto mb-5" />

                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h2 className="text-xl font-extrabold text-gray-900 dark:text-white leading-none">Payment Method</h2>
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-tighter mt-1">Select how you want to pay</p>
                  </div>
                  <button
                    onClick={() => setShowPaymentSheet(false)}
                    className="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  >
                    <X className="w-4 h-4 text-gray-500" />
                  </button>
                </div>

                <div className="space-y-3 overflow-y-auto pr-1 custom-scrollbar pb-4 flex-1 min-h-0">
                  {[
                    {
                      id: 'razorpay',
                      name: 'Online Payment',
                      description: 'UPI, Cards, Netbanking',
                      icon: <Zap className="w-5 h-5" />,
                      color: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400',
                      selectedColor: 'bg-emerald-500 text-white',
                      badge: 'SECURE'
                    },
                    {
                      id: 'wallet',
                      name: 'Quick Wallet',
                      description: 'Pay from your wallet',
                      icon: <Wallet className="w-5 h-5" />,
                      color: 'bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400',
                      selectedColor: 'bg-blue-500 text-white',
                      subInfo: isLoadingWallet
                        ? 'Loading…'
                        : `Bal: ${RUPEE_SYMBOL}${walletBalance.toFixed(0)}`,
                      disabled: !isLoadingWallet && walletBalance < total,
                      disabledText: 'Low Balance',
                      allowAddMoney: !isLoadingWallet && walletBalance < total,
                    },
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        if (option.allowAddMoney) {
                          setShowPaymentSheet(false)
                          setShowAddMoneyModal(true)
                          return
                        }
                        if (!option.disabled) {
                          setSelectedPaymentMethod(option.id)
                          setShowPaymentSheet(false)
                        }
                      }}
                      className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all duration-300 group ${selectedPaymentMethod === option.id
                        ? 'border-[#16A34A] bg-[#16A34A] shadow-lg shadow-[#16A34A]/30'
                        : option.allowAddMoney
                          ? 'border-amber-200 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-950/20 hover:border-amber-400 dark:hover:border-amber-600 shadow-sm cursor-pointer active:scale-[0.98]'
                          : 'border-gray-100 dark:border-gray-800/80 bg-white dark:bg-[#222222] hover:border-[#16A34A]/30 dark:hover:border-[#16A34A]/30 shadow-sm'
                        } ${option.disabled && !option.allowAddMoney ? 'opacity-40 grayscale-[0.8] cursor-not-allowed' : option.allowAddMoney ? '' : 'cursor-pointer active:scale-[0.98]'}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-300 ${selectedPaymentMethod === option.id
                          ? 'bg-white/20 text-white'
                          : option.color
                          }`}>
                          {option.icon}
                        </div>
                        <div className="text-left">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-black tracking-tight leading-none transition-colors ${selectedPaymentMethod === option.id ? 'text-white' : 'text-gray-900 dark:text-gray-100'
                              }`}>
                              {option.name}
                            </span>
                            {option.badge && (
                              <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full shadow-sm tracking-wider ${selectedPaymentMethod === option.id
                                ? 'bg-white/20 text-white'
                                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                }`}>
                                {option.badge}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-1">
                            <p className={`text-[11px] font-bold transition-colors ${selectedPaymentMethod === option.id ? 'text-white/80' : 'text-gray-400'
                              }`}>
                              {option.description}
                            </p>
                            {option.subInfo && (
                              <>
                                <span className={`w-1 h-1 rounded-full ${selectedPaymentMethod === option.id ? 'bg-white/40' : 'bg-orange-300 dark:bg-orange-700'
                                  }`} />
                                <p className={`text-[10px] font-black uppercase tracking-tighter transition-colors ${selectedPaymentMethod === option.id
                                  ? 'text-white'
                                  : option.allowAddMoney
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-green-600 dark:text-green-500'
                                  }`}>
                                  {option.subInfo}
                                </p>
                              </>
                            )}
                          </div>
                          {option.allowAddMoney && (
                            <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 mt-1.5">
                              {option.disabledText} · Tap to add money
                            </p>
                          )}
                          {option.disabled && !option.allowAddMoney && (
                            <p className="text-[9px] font-black text-red-500 mt-1 uppercase tracking-wide">
                              {option.disabledText}
                            </p>
                          )}
                        </div>
                      </div>

                      {option.allowAddMoney ? (
                        <span className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#16A34A] text-white text-[11px] font-bold shadow-sm shrink-0">
                          <Plus className="w-3.5 h-3.5" />
                          Add
                        </span>
                      ) : (
                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${selectedPaymentMethod === option.id
                          ? 'bg-white border-white'
                          : 'border-gray-200 dark:border-gray-700'
                          }`}>
                          {selectedPaymentMethod === option.id && <Check className="w-3.5 h-3.5 text-[#16A34A]" strokeWidth={4} />}
                        </div>
                      )}
                    </button>
                  ))}
                </div>

                <div
                  className="mt-auto pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center gap-4 bg-white dark:bg-[#1a1a1a]"
                  style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom, 0px))" }}
                >
                  <div className="flex-shrink-0">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">Total Pay</p>
                    <p className="text-xl font-black text-[#16A34A] tabular-nums">{RUPEE_SYMBOL}{total.toFixed(0)}</p>
                  </div>
                  <Button
                    onClick={() => setShowPaymentSheet(false)}
                    className="flex-1 bg-[#16A34A] hover:bg-[#15803D] text-white h-11 rounded-xl text-sm font-bold shadow-lg shadow-[#16A34A]/20 transition-all active:scale-[0.98]"
                  >
                    Confirm Order
                  </Button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Animation Styles */}
      <style>{`
        @keyframes fadeInBackdrop {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUpBannerSmooth {
          from { transform: translateY(100%) scale(0.95); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes slideUpBanner {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes shimmerBanner {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes scaleInBounce {
          0% { transform: scale(0); opacity: 0; }
          50% { transform: scale(1.1); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes pulseRing {
          0% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.4); opacity: 0; }
          100% { transform: scale(1); opacity: 0; }
        }
        @keyframes checkMarkDraw {
          0% { stroke-dasharray: 100; stroke-dashoffset: 100; opacity: 0; }
          50% { opacity: 1; }
          100% { stroke-dasharray: 100; stroke-dashoffset: 0; opacity: 1; }
        }
        @keyframes slideUpFull {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        @keyframes slideUpModal {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleIn {
          from { transform: scale(0); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @keyframes checkDraw {
          0% { stroke-dasharray: 100; stroke-dashoffset: 100; }
          100% { stroke-dasharray: 100; stroke-dashoffset: 0; }
        }
        @keyframes ringPulse {
          0% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.3); opacity: 0; }
          100% { transform: scale(1); opacity: 0; }
        }
        @keyframes sparkle {
          0% { transform: rotate(var(--rotation, 0deg)) translateY(0) scale(0); opacity: 1; }
          100% { transform: rotate(var(--rotation, 0deg)) translateY(-80px) scale(1); opacity: 0; }
        }
        @keyframes slideUp {
          from { transform: translateY(30px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes confettiFall {
          0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
        }
        .animate-slideUpFull {
          animation: slideUpFull 0.3s ease-out;
        }
        .check-path {
          stroke-dasharray: 100;
          stroke-dashoffset: 0;
        }
      `}</style>

      {/* Share Modal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showShareModal && sharePayload && (
              <>
                <motion.div
                  className="fixed inset-0 bg-black/50 z-[10020]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowShareModal(false)}
                />
                <motion.div
                  className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[10021] w-[92vw] max-w-md bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-2xl"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.16 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-5 pt-5 pb-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">Share</h3>
                    <button
                      className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                      onClick={() => setShowShareModal(false)}
                      aria-label="Close share modal"
                    >
                      <X className="h-4 w-4 text-gray-600 dark:text-gray-300" />
                    </button>
                  </div>

                  <div className="px-5 py-4 space-y-2">
                    {typeof navigator !== "undefined" && navigator.share && (
                      <button
                        className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                        onClick={handleSystemShareFromModal}
                      >
                        <Share2 className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">Share via system apps</span>
                      </button>
                    )}
                    <button
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      onClick={() => openShareTarget("whatsapp")}
                    >
                      <MessageCircle className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">WhatsApp</span>
                    </button>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      onClick={() => openShareTarget("telegram")}
                    >
                      <Send className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Telegram</span>
                    </button>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      onClick={() => openShareTarget("email")}
                    >
                      <Mail className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Email</span>
                    </button>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      onClick={copyShareLink}
                    >
                      <Copy className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Copy link</span>
                    </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}
    </AnimatedPage>
  )
}

export default Cart

