import { useState, useEffect, useRef, Component, useMemo, useCallback } from "react"
import { createPortal } from "react-dom"
import { normalizePagination } from "@food/utils/pagination"
import { motion, AnimatePresence } from "framer-motion"
import { useParams, useNavigate, useSearchParams } from "react-router-dom"
import { restaurantAPI, orderAPI } from "@food/api"
import { fetchOutletTimingsCached } from "@food/utils/outletTimingsCache"
import { fetchRestaurantsCached } from "@food/utils/restaurantListCache"
import { API_BASE_URL } from "@food/api/config"
import { toast } from "sonner"
import useEffectiveDeliveryLocation from "@food/hooks/useEffectiveDeliveryLocation"
import { useZone } from "@food/hooks/useZone"
import { useAddToCartFeedback } from "@food/hooks/useAddToCartFeedback"
import { formatDistanceFromMeters, calculateDistanceKm } from "@food/utils/restaurantDisplay"
import {
  ArrowLeft,
  Search,
  MoreVertical,
  MapPin,
  Clock,
  ChevronDown,
  Info,
  Star,
  SlidersHorizontal,
  Utensils,
  Flame,
  Bookmark,
  Share2,
  Plus,
  Minus,
  X,
  RotateCcw,
  Zap,
  Check,
  Lock,
  Percent,
  Eye,
  Users,
  AlertCircle,
  Copy,
  MessageCircle,
  Send,
  Mail,
} from "lucide-react"
import { Button } from "@food/components/ui/button"
import { Badge } from "@food/components/ui/badge"
import { Checkbox } from "@food/components/ui/checkbox"
import AnimatedPage from "@food/components/user/AnimatedPage"
import { useCart } from "@food/context/CartContext"
import { useProfile } from "@food/context/ProfileContext"
import AddToCartAnimation from "@food/components/user/AddToCartAnimation"
import { getCompanyNameAsync } from "@food/utils/businessSettings"
import { isModuleAuthenticated } from "@food/utils/auth"
import { getRestaurantAvailabilityStatus } from "@food/utils/restaurantAvailability"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import {
  buildCartLineId,
  getDefaultFoodVariant,
  getFoodDisplayPrice,
  getFoodPriceLabel,
  getFoodVariants,
  hasFoodVariants,
} from "@food/utils/foodVariants"
import {
  getRestaurantFssaiImage,
  getRestaurantFssaiNumber,
  resolveFoodItemImage,
  extractImages,
  normalizeImageUrl,
} from "@food/utils/common"
import { RestaurantDetailSkeleton } from "@food/components/ui/loading-skeletons"
import {
  RestaurantHero,
  RestaurantTopBar,
  RestaurantInfoCard,
  RestaurantOfflineBanner,
  RestaurantOfferStrip,
} from "@food/components/user/restaurant-details/RestaurantHeader"
import RestaurantMenuToolbar from "@food/components/user/restaurant-details/RestaurantMenuToolbar"
import MenuSectionBlock, {
  MenuEmptyComingSoon,
  MenuEmptyNoMatches,
  RestaurantFssaiBadge,
  FssaiLogoImage,
  FloatingMenuFab,
} from "@food/components/user/restaurant-details/MenuSectionBlock"

const debugLog = (...args) => { }
const debugWarn = (...args) => { }
const debugError = (...args) => { }

const mergeMenuSections = (existingSections, newSections) => {
  const merged = [...existingSections];
  newSections.forEach(newSec => {
    const existingSec = merged.find(s => s.name === newSec.name || (s.categoryId && s.categoryId === newSec.categoryId));
    if (existingSec) {
      const existingItemIds = new Set(existingSec.items.map(item => String(item.id || item._id)));
      const uniqueNewItems = (newSec.items || []).filter(item => !existingItemIds.has(String(item.id || item._id)));
      existingSec.items = [...existingSec.items, ...uniqueNewItems];
    } else {
      merged.push(newSec);
    }
  });
  return merged;
};



const FOOD_IMAGE_FALLBACK = "https://picsum.photos/seed/food-fallback/800/600"
const RUPEE_SYMBOL = "\u20B9"
const RESTAURANT_DETAILS_FILTERS_STORAGE_KEY = "food-restaurant-details-filters"
const BACKEND_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "")

const normalizeMenuItem = (item = {}) => {
  const isRecommended =
    item.isRecommended === true ||
    item.isRecommended === 1 ||
    String(item.isRecommended) === "true"
  const isSpicy =
    item.isSpicy === true ||
    item.isSpicy === 1 ||
    String(item.isSpicy) === "true"
  let foodType = item.foodType || "Non-Veg"
  if (typeof foodType === "string") {
    if (foodType.toLowerCase() === "veg") foodType = "Veg"
    else if (
      foodType.toLowerCase() === "non-veg" ||
      foodType.toLowerCase() === "nonveg"
    ) {
      foodType = "Non-Veg"
    }
  }

  return {
    ...item,
    id: String(item.id || item._id || `${Date.now()}-${Math.random()}`),
    name: item.name || "Unnamed Item",
    image: resolveFoodItemImage(item, BACKEND_ORIGIN),
    foodType,
    isVeg: foodType === "Veg",
    price: getFoodDisplayPrice(item),
    variants: getFoodVariants(item),
    variations: getFoodVariants(item),
    isAvailable: item.isAvailable !== false,
    isRecommended,
    isSpicy,
    description: typeof item.description === "string" ? item.description : "",
  }
}

function RestaurantDetailsContent() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()
  const [searchParams] = useSearchParams()
  const showOnlyUnder250 = searchParams.get('under250') === 'true'
  const targetDishId = useMemo(() => String(searchParams.get('dish') || '').trim(), [searchParams])
  const { addToCart, updateQuantity, removeFromCart, getCartItem, cart } = useCart()
  const handleAddToCartFeedback = useAddToCartFeedback()
  const { vegMode, addDishFavorite, removeDishFavorite, isDishFavorite, getDishFavorites, getFavorites, addFavorite, removeFavorite, isFavorite } = useProfile()
  const { effectiveLocation: userLocation } = useEffectiveDeliveryLocation() // Respects saved-address vs current-GPS delivery mode
  const { zoneId, zone, loading: loadingZone, isOutOfService } = useZone(userLocation) // Get user's zone for zone-based filtering
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [quantities, setQuantities] = useState({})
  const [showManageCollections, setShowManageCollections] = useState(false)
  const [showItemDetail, setShowItemDetail] = useState(false)
  const [selectedItem, setSelectedItem] = useState(null)
  const [selectedVariantId, setSelectedVariantId] = useState("")
  const [showFilterSheet, setShowFilterSheet] = useState(false)
  const [showLocationSheet, setShowLocationSheet] = useState(false)
  const [showScheduleSheet, setShowScheduleSheet] = useState(false)
  const [showOffersSheet, setShowOffersSheet] = useState(false)
  const [selectedDate, setSelectedDate] = useState(() => {
    try {
      const stored = localStorage.getItem('scheduled_order_time')
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed.date) return parsed.date
      }
    } catch {}
    return new Date().toISOString().split('T')[0]
  })
  const [selectedTimeSlot, setSelectedTimeSlot] = useState(() => {
    try {
      const stored = localStorage.getItem('scheduled_order_time')
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed.time) return parsed.time
      }
    } catch {}
    return null
  })
  const [fulfillmentMode, setFulfillmentMode] = useState(() => {
    try {
      const stored = localStorage.getItem('scheduled_order_time')
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed.isScheduled) return "schedule"
      }
    } catch {}
    return "delivery"
  })

  const [expandedCoupons, setExpandedCoupons] = useState(new Set())
  const [showMenuSheet, setShowMenuSheet] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [availabilityTick, setAvailabilityTick] = useState(Date.now())
  const [showMenuOptionsSheet, setShowMenuOptionsSheet] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [sharePayload, setSharePayload] = useState(null)
  const [expandedAddButtons, setExpandedAddButtons] = useState(new Set())
  const [expandedSections, setExpandedSections] = useState(new Set([0])) // Default: Recommended section is expanded
  const [highlightedDishId, setHighlightedDishId] = useState(null)
  const [loadingMenuItems, setLoadingMenuItems] = useState(true)
  const [selectedMenuCategory, setSelectedMenuCategory] = useState("all")
  const dishCardRefs = useRef({})

  const [menuPagination, setMenuPagination] = useState({
    page: 1,
    limit: 15,
    total: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPreviousPage: false,
  });
  const [loadingMoreMenu, setLoadingMoreMenu] = useState(false)
  const menuLookupIdsRef = useRef([])
  const resolvedMenuLookupIdRef = useRef(null)
  const currentMenuPageRef = useRef(1)
  const menuLoadMoreRef = useRef(null)

  const getLineItemIdForDish = (item, variant = null) =>
    buildCartLineId(item?.id || item?._id || "", variant?.id || variant?._id || "")

  const getVariantForDish = (item, preferredVariantId = "") => {
    const variants = getFoodVariants(item)
    if (variants.length === 0) return null
    return variants.find((variant) => String(variant.id) === String(preferredVariantId || "")) || variants[0]
  }

  const getDishQuantity = (item, preferredVariantId = "") => {
    const variants = getFoodVariants(item)
    if (variants.length > 0 && !preferredVariantId) {
      const activeVariants = variants.map(variant => {
        const lineItemId = getLineItemIdForDish(item, variant)
        return quantities[lineItemId] || 0
      }).filter(qty => qty > 0)

      if (activeVariants.length === 0) return 0
      if (activeVariants.length > 1) {
        // Different variants exist in cart, return 1 as requested
        return 1
      }
      // Only one variant exists, return its quantity
      return activeVariants[0]
    }

    const variant = getVariantForDish(item, preferredVariantId)
    const lineItemId = getLineItemIdForDish(item, variant)
    return quantities[lineItemId] || 0
  }

  // Initialize filters from localStorage if available
  const [filters, setFilters] = useState(() => {
    if (typeof window === "undefined" || !slug) {
      return {
        sortBy: null,
        vegNonVeg: null,
        highlyReordered: false,
        spicy: false,
      }
    }
    try {
      const raw = window.localStorage.getItem(RESTAURANT_DETAILS_FILTERS_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        const savedFilters = parsed?.[slug]
        if (savedFilters && typeof savedFilters === "object") {
          return {
            sortBy:
              savedFilters.sortBy === "low-to-high" || savedFilters.sortBy === "high-to-low"
                ? savedFilters.sortBy
                : null,
            vegNonVeg:
              savedFilters.vegNonVeg === "veg" || savedFilters.vegNonVeg === "non-veg"
                ? savedFilters.vegNonVeg
                : null,
            highlyReordered: savedFilters.highlyReordered === true,
            spicy: savedFilters.spicy === true,
          }
        }
      }
    } catch (error) {
      debugWarn("Failed to initialize restaurant filters from localStorage:", error)
    }
    return {
      sortBy: null,
      vegNonVeg: null,
      highlyReordered: false,
      spicy: false,
    }
  })

  // Restaurant data state
  const [restaurant, setRestaurant] = useState(null)
  const [pageCoupons, setPageCoupons] = useState([])
  const [pageCouponsSource, setPageCouponsSource] = useState(null)
  const [loadingRestaurant, setLoadingRestaurant] = useState(true)
  const [restaurantError, setRestaurantError] = useState(null)
  const fetchedRestaurantRef = useRef(false) // Track if restaurant has been fetched for current slug
  const fetchedSlugRef = useRef(null)
  const inFlightSlugRef = useRef(null) // slug currently being fetched (blocks overlapping fetches)
  const restaurantRef = useRef(null)
  restaurantRef.current = restaurant

  const availableTimeSlots = useMemo(() => {
    if (!selectedDate || !restaurant) return []

    try {
      const targetDate = new Date(selectedDate)
      const status = getRestaurantAvailabilityStatus(restaurant, targetDate)

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
        closingHour += 24
      }

      const slots = []
      const now = new Date()
      const nowStr = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0]
      const isToday = selectedDate === nowStr
      const currentHour = now.getHours()

      for (let h = openingHour; h <= closingHour; h++) {
        const actualHour = h % 24
        if (isToday && h <= currentHour + 1) continue

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
  }, [selectedDate, restaurant])

  useEffect(() => {
    if (availableTimeSlots.length > 0) {
      const isValid = availableTimeSlots.some(slot => slot.value === selectedTimeSlot)
      if (!isValid) {
        setSelectedTimeSlot(availableTimeSlots[0].value)
      }
    } else {
      setSelectedTimeSlot(null)
    }
  }, [availableTimeSlots, selectedTimeSlot])

  useEffect(() => {
    const intervalId = setInterval(() => {
      setAvailabilityTick(Date.now())
    }, 60000)

    return () => clearInterval(intervalId)
  }, [])

  const loadMoreMenu = useCallback(async () => {
    if (loadingMoreMenu || !menuPagination.hasNextPage || !resolvedMenuLookupIdRef.current) return

    setLoadingMoreMenu(true)
    const nextPage = menuPagination.page + 1
    debugLog('? Fetching menu page:', nextPage)

    try {
      const response = await restaurantAPI.getMenuByRestaurantId(resolvedMenuLookupIdRef.current, {
        noCache: true,
        params: { page: nextPage, limit: 15 }
      })

      if (response?.data?.success && response?.data?.data?.menu) {
        const newRawSections = response.data.data.menu.sections || []
        const toArray = (value) => {
          if (Array.isArray(value)) return value
          if (!value || typeof value !== "object") return []
          return Object.values(value).filter((entry) => entry && typeof entry === "object")
        }

        const newMenuSections = toArray(newRawSections)
          .map((section, sectionIndex) => ({
            ...section,
            id: String(section.id || section._id || `section-${sectionIndex}`),
            categoryId: String(section.categoryId || section.id || section._id || `section-${sectionIndex}`),
            name: section.name || section.title || "Unnamed Section",
            itemCount: Number(section.itemCount) || toArray(section.items).length,
            sortOrder: Number(section.sortOrder) || 0,
            items: toArray(section.items).map(normalizeMenuItem),
            subsections: toArray(section.subsections).map((subsection, subsectionIndex) => ({
              ...subsection,
              id: String(subsection.id || subsection._id || `subsection-${sectionIndex}-${subsectionIndex}`),
              name: subsection.name || "Unnamed Subsection",
              items: toArray(subsection.items).map(normalizeMenuItem),
            })),
          }))

        setRestaurant(prev => {
          if (!prev) return prev
          const mergedSections = mergeMenuSections(prev.menuSections || [], newMenuSections)
          return {
            ...prev,
            menuSections: mergedSections
          }
        })

        const pagination = normalizePagination(response.data.data.menu.pagination)
        setMenuPagination(pagination)
        currentMenuPageRef.current = pagination.page
      }
    } catch (error) {
      debugError('? Error fetching more menu items:', error)
    } finally {
      setLoadingMoreMenu(false)
    }
  }, [loadingMoreMenu, menuPagination.hasNextPage, menuPagination.page])

  useEffect(() => {
    if (!menuPagination.hasNextPage || loadingMoreMenu) return
    const target = menuLoadMoreRef.current
    if (!target || typeof window === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (!entry?.isIntersecting) return
        loadMoreMenu()
      },
      {
        root: null,
        rootMargin: '300px 0px',
        threshold: 0.01,
      },
    )

    observer.observe(target)
    return () => observer.disconnect()
  }, [menuPagination.hasNextPage, loadingMoreMenu, loadMoreMenu])

  useEffect(() => {
    if (restaurant) {
      const status = getRestaurantAvailabilityStatus(restaurant)
      if (!status.isOpen && fulfillmentMode !== "schedule") {
        setFulfillmentMode("schedule")
      }
    }
  }, [restaurant, fulfillmentMode, availabilityTick])

  useEffect(() => {
    setSelectedMenuCategory("all")
  }, [slug])

  // Fetch restaurant data from API
  useEffect(() => {
    const fetchRestaurant = async () => {
      if (!slug) return

      // Prevent re-fetching for the same slug. Mobile location/zone updates can
      // trigger transient refetch failures that clear already-rendered content.
      if (fetchedRestaurantRef.current && fetchedSlugRef.current === slug && restaurantRef.current) {
        return
      }
      // A zone/location change mid-fetch used to start a 2nd overlapping fetch whose
      // failure flashed "Restaurant not found" over a page that was about to load.
      if (inFlightSlugRef.current === slug) return
      inFlightSlugRef.current = slug

      try {
        // Keep the existing page visible on background retries.
        setLoadingRestaurant(!fetchedRestaurantRef.current && !restaurantRef.current)
        setRestaurantError(null)

        debugLog('Fetching restaurant with slug:', slug)
        let response = null
        let apiRestaurant = null

        // Send the user's current location so the backend can attach the same
        // road-distance value (Google Directions, with haversine fallback) used
        // by the restaurant list page, instead of leaving distance unset.
        const locationConfig = Number.isFinite(userLocation?.latitude) && Number.isFinite(userLocation?.longitude)
          ? { params: { lat: userLocation.latitude, lng: userLocation.longitude } }
          : {}

        // Direct lookup by slug/ID (diningAPI.getRestaurantBySlug hits this same endpoint,
        // so a separate dining call only doubled the wait on failures).
        // Transient failures (timeout/5xx/network) are retried and then surfaced as a
        // load error - never as a false "Restaurant not found". Only a real 404 counts.
        let directLookupFailure = null
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            response = await restaurantAPI.getRestaurantById(slug, locationConfig)
            if (response?.data?.success && response?.data?.data) {
              apiRestaurant = response.data.data
            }
            directLookupFailure = null
            break
          } catch (lookupErr) {
            directLookupFailure = lookupErr
            if (lookupErr?.response?.status === 404) break
            await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
          }
        }
        if (!apiRestaurant && directLookupFailure && directLookupFailure.response?.status !== 404) {
          throw directLookupFailure
        }

        // Name-search fallback only when the direct lookup definitively found nothing.
        if (!apiRestaurant) {
          try {
            try {
              throw directLookupFailure || new Error('no direct match')
            } catch (directLookupError) {
              // If direct lookup fails, try searching by name.
              // Fallback without zoneId so missing live location never blocks this page.
              debugLog('? Direct lookup failed, trying search by name...')

              const searchVariants = zoneId
                ? [{ limit: 100, zoneId: zoneId, _ts: Date.now() }, { limit: 100, _ts: Date.now() }]
                : [{ limit: 100, _ts: Date.now() }]

              for (const searchParams of searchVariants) {
                try {
                  const searchResponse = await fetchRestaurantsCached(searchParams, { force: true })
                  const restaurants = searchResponse?.data?.data?.restaurants || searchResponse?.data?.data || []

                  // Try to find by slug match or name match
                  const restaurantName = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                  const matchingRestaurant = restaurants.find(r =>
                    r.slug === slug ||
                    r.name?.toLowerCase().replace(/\s+/g, '-') === slug.toLowerCase() ||
                    r.name?.toLowerCase() === restaurantName.toLowerCase()
                  )

                  if (matchingRestaurant) {
                    // Get full restaurant details by ID
                    const fullResponse = await restaurantAPI.getRestaurantById(matchingRestaurant._id || matchingRestaurant.restaurantId, locationConfig)
                    if (fullResponse.data && fullResponse.data.success && fullResponse.data.data) {
                      apiRestaurant = fullResponse.data.data
                      debugLog('? Found restaurant in restaurant API by name search:', apiRestaurant)
                      break
                    }
                  }
                } catch (searchError) {
                  debugWarn('? Search fallback failed for params:', searchParams, searchError?.message)
                }
              }
            }
          } catch (restaurantError) {
            debugError('? Restaurant not found in restaurant API either:', restaurantError)
          }
        }

        if (apiRestaurant) {
          debugLog('? Fetched restaurant from API:', apiRestaurant)
          debugLog('? Restaurant data keys:', Object.keys(apiRestaurant))
          debugLog('? Restaurant name field:', apiRestaurant?.name)
          debugLog('? Restaurant restaurantId:', apiRestaurant?.restaurantId)
          debugLog('? Restaurant _id:', apiRestaurant?._id)
          debugLog('? Restaurant.restaurant:', apiRestaurant?.restaurant)

          // Check if this is a dining restaurant with nested restaurant data
          const actualRestaurant = apiRestaurant?.restaurant || apiRestaurant

          // Helper function to format address with zone and pin code
          const formatRestaurantAddress = (locationObj) => {
            if (!locationObj) return "Location"

            // If location is a string, return it as is
            if (typeof locationObj === 'string') {
              return locationObj
            }

            // PRIORITY 1: Use formattedAddress if it's complete and has pin code
            // formattedAddress usually has the most complete information from Google Maps
            if (locationObj.formattedAddress && locationObj.formattedAddress.trim() !== "" && locationObj.formattedAddress !== "Select location") {
              const isCoordinates = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(locationObj.formattedAddress.trim())
              if (!isCoordinates) {
                const formattedAddr = locationObj.formattedAddress.trim()
                // Check if it contains a pin code (6 digit number)
                const hasPinCode = /\b\d{6}\b/.test(formattedAddr)
                // If it has pin code, it's complete - use it directly
                if (hasPinCode) {
                  // Clean up the address - remove Google Plus Code if present (e.g., "PV6X+JXX, ")
                  const cleanedAddr = formattedAddr.replace(/^[A-Z0-9]+\+[A-Z0-9]+,\s*/i, '')
                  return cleanedAddr
                }
                // If it has multiple parts (3+), it's likely complete
                if (formattedAddr.split(',').length >= 3) {
                  const cleanedAddr = formattedAddr.replace(/^[A-Z0-9]+\+[A-Z0-9]+,\s*/i, '')
                  return cleanedAddr
                }
              }
            }

            // PRIORITY 2: Build address from location object components (with zone and pin code)
            // This ensures we always show zone and pin code if available
            const addressParts = []

            // Add addressLine1 if available
            if (locationObj.addressLine1 && locationObj.addressLine1.trim() !== "") {
              addressParts.push(locationObj.addressLine1.trim())
            }

            // Add addressLine2 if available
            if (locationObj.addressLine2 && locationObj.addressLine2.trim() !== "") {
              addressParts.push(locationObj.addressLine2.trim())
            }

            // Add area (zone) if available
            if (locationObj.area && locationObj.area.trim() !== "") {
              addressParts.push(locationObj.area.trim())
            }

            // Add city if available
            if (locationObj.city && locationObj.city.trim() !== "") {
              addressParts.push(locationObj.city.trim())
            }

            // Add state if available
            if (locationObj.state && locationObj.state.trim() !== "") {
              addressParts.push(locationObj.state.trim())
            }

            // Add pin code (priority: pincode > zipCode > postalCode)
            const pinCode = locationObj.pincode || locationObj.zipCode || locationObj.postalCode
            if (pinCode && pinCode.toString().trim() !== "") {
              addressParts.push(pinCode.toString().trim())
            }

            // If we have at least 3 parts (complete address), use it
            if (addressParts.length >= 3) {
              return addressParts.join(', ')
            }

            // If we have at least 2 parts, use it
            if (addressParts.length >= 2) {
              return addressParts.join(', ')
            }

            // PRIORITY 3: Fallback to formattedAddress (even if incomplete)
            if (locationObj.formattedAddress && locationObj.formattedAddress.trim() !== "" && locationObj.formattedAddress !== "Select location") {
              const isCoordinates = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(locationObj.formattedAddress.trim())
              if (!isCoordinates) {
                const cleanedAddr = locationObj.formattedAddress.trim().replace(/^[A-Z0-9]+\+[A-Z0-9]+,\s*/i, '')
                return cleanedAddr
              }
            }

            // PRIORITY 4: Fallback to address field
            if (locationObj.address && locationObj.address.trim() !== "") {
              return locationObj.address.trim()
            }

            // PRIORITY 5: Last fallback - use area or city
            return locationObj.area || locationObj.city || "Location"
          }

          // Get location object for address formatting
          const locationObj = actualRestaurant?.location || apiRestaurant?.location
          debugLog('? Location Object for formatting:', locationObj)
          debugLog('? formattedAddress field:', locationObj?.formattedAddress)
          const formattedAddress = formatRestaurantAddress(locationObj)
          debugLog('? Final Formatted Address:', formattedAddress)

          // Get restaurant coordinates
          // Priority: latitude/longitude fields > coordinates array (GeoJSON format: [lng, lat])
          const restaurantLat = locationObj?.latitude || (locationObj?.coordinates && Array.isArray(locationObj.coordinates) ? locationObj.coordinates[1] : null)
          const restaurantLng = locationObj?.longitude || (locationObj?.coordinates && Array.isArray(locationObj.coordinates) ? locationObj.coordinates[0] : null)

          // Get user coordinates
          const userLat = userLocation?.latitude
          const userLng = userLocation?.longitude

          // Prefer the distance the backend attached to the response (same
          // road-distance/haversine-fallback pipeline the restaurant list page
          // uses, via the lat/lng sent with the request above). Only fall back
          // to a client-side straight-line estimate when the backend couldn't
          // supply one (e.g. userLocation wasn't resolved yet at fetch time).
          let calculatedDistance = actualRestaurant?.distance || apiRestaurant?.distance || null

          if (!calculatedDistance && userLat && userLng && restaurantLat && restaurantLng &&
            !isNaN(userLat) && !isNaN(userLng) && !isNaN(restaurantLat) && !isNaN(restaurantLng)) {
            const distanceInKm = calculateDistanceKm(userLat, userLng, restaurantLat, restaurantLng)
            calculatedDistance = formatDistanceFromMeters(distanceInKm * 1000)
            debugLog('? Calculated fallback straight-line distance:', calculatedDistance, 'km:', distanceInKm)
          } else {
            debugLog('? Distance resolved:', { calculatedDistance, distanceSource: actualRestaurant?.distanceSource })
          }

          // Resolve display category/cuisine with broad API compatibility
          const categoryFromArray = (list) => {
            if (!Array.isArray(list) || list.length === 0) return null
            const firstEntry = list[0]
            if (typeof firstEntry === "string") return firstEntry
            if (firstEntry && typeof firstEntry === "object") {
              return firstEntry.name || firstEntry.label || firstEntry.title || null
            }
            return null
          }

          const resolvedTopCategory =
            actualRestaurant?.topCategory ||
            apiRestaurant?.topCategory ||
            categoryFromArray(actualRestaurant?.topCategories) ||
            categoryFromArray(apiRestaurant?.topCategories) ||
            categoryFromArray(actualRestaurant?.cuisines) ||
            categoryFromArray(apiRestaurant?.cuisines) ||
            categoryFromArray(actualRestaurant?.categories) ||
            categoryFromArray(apiRestaurant?.categories) ||
            actualRestaurant?.cuisine ||
            apiRestaurant?.cuisine ||
            actualRestaurant?.category ||
            apiRestaurant?.category ||
            "Multi-cuisine"

          const onboardingStep2 = actualRestaurant?.onboarding?.step2 || apiRestaurant?.onboarding?.step2 || {}
          const onboardingStep4 = actualRestaurant?.onboarding?.step4 || apiRestaurant?.onboarding?.step4 || {}
          const normalizedProfileImage = extractImages(actualRestaurant?.profileImage || apiRestaurant?.profileImage || onboardingStep2?.profileImageUrl, BACKEND_ORIGIN)[0] || null
          const normalizedCoverImages = extractImages(
            Array.isArray(actualRestaurant?.coverImages) && actualRestaurant.coverImages.length > 0
              ? actualRestaurant.coverImages
              : Array.isArray(apiRestaurant?.coverImages) && apiRestaurant.coverImages.length > 0
                ? apiRestaurant.coverImages
                : [], BACKEND_ORIGIN)
          const normalizedMenuImages = extractImages(
            Array.isArray(actualRestaurant?.menuImages) && actualRestaurant.menuImages.length > 0
              ? actualRestaurant.menuImages
              : Array.isArray(apiRestaurant?.menuImages) && apiRestaurant.menuImages.length > 0
                ? apiRestaurant.menuImages
                : Array.isArray(onboardingStep2?.menuImageUrls)
                  ? onboardingStep2.menuImageUrls
                  : [], BACKEND_ORIGIN)
          const normalizedRestaurantOffers = actualRestaurant?.restaurantOffers || apiRestaurant?.restaurantOffers || {}

          // Transform API data to match expected format with comprehensive fallbacks
          // Handle both dining restaurant and regular restaurant data structures
          const transformedRestaurant = {
            id: actualRestaurant?.restaurantId || actualRestaurant?._id || actualRestaurant?.id || apiRestaurant?.restaurantId || apiRestaurant?._id || null,
            mongoId: actualRestaurant?._id || apiRestaurant?._id || null,
            name:
              actualRestaurant?.name ||
              actualRestaurant?.restaurantName ||
              apiRestaurant?.name ||
              apiRestaurant?.restaurantName ||
              "Unknown Restaurant",
            cuisine: resolvedTopCategory,
            topCategory: resolvedTopCategory,
            rating: actualRestaurant?.rating || apiRestaurant?.rating || actualRestaurant?.averageRating || apiRestaurant?.averageRating || 4.5,
            reviews: actualRestaurant?.totalRatings || apiRestaurant?.totalRatings || actualRestaurant?.reviewCount || apiRestaurant?.reviewCount || actualRestaurant?.reviews?.length || apiRestaurant?.reviews?.length || 0,
            deliveryTime: actualRestaurant?.estimatedDeliveryTime || apiRestaurant?.estimatedDeliveryTime || actualRestaurant?.deliveryTime || apiRestaurant?.deliveryTime || actualRestaurant?.avgDeliveryTime || apiRestaurant?.avgDeliveryTime || "25-30 mins",
            distance: calculatedDistance || actualRestaurant?.distance || apiRestaurant?.distance || actualRestaurant?.distanceFromUser || apiRestaurant?.distanceFromUser || "1.2 km",
            location: formattedAddress,
            locationObject: locationObj, // Store full location object for reference
            image: normalizedCoverImages?.[0]
              || normalizedProfileImage
              || (normalizedMenuImages.length > 0 ? normalizedMenuImages[0] : null)
              || normalizeImageUrl(actualRestaurant?.image, BACKEND_ORIGIN)
              || normalizeImageUrl(apiRestaurant?.image, BACKEND_ORIGIN)
              || null,
            priceRange: actualRestaurant?.priceRange || apiRestaurant?.priceRange || onboardingStep4?.priceRange || "$$",
            offers: Array.isArray(actualRestaurant?.offers) ? actualRestaurant.offers : (Array.isArray(apiRestaurant?.offers) ? apiRestaurant.offers : []), // Will be populated from menu/offers API later
            offerText: actualRestaurant?.offer || apiRestaurant?.offer || onboardingStep4?.offer || "FLAT 50% OFF",
            offerCount: actualRestaurant?.offerCount || apiRestaurant?.offerCount || 0,
            restaurantOffers: {
              goldOffer: {
                title: normalizedRestaurantOffers?.goldOffer?.title || "Gold exclusive offer",
                description: apiRestaurant?.restaurantOffers?.goldOffer?.description || "Free delivery above ₹99",
                unlockText: normalizedRestaurantOffers?.goldOffer?.unlockText || "join Gold to unlock",
                buttonText: apiRestaurant?.restaurantOffers?.goldOffer?.buttonText || "Add Gold - ₹1",
              },
              coupons: Array.isArray(normalizedRestaurantOffers?.coupons)
                ? normalizedRestaurantOffers.coupons
                : [],
            },
            outlets: Array.isArray(actualRestaurant?.outlets) ? actualRestaurant.outlets : (Array.isArray(apiRestaurant?.outlets) ? apiRestaurant.outlets : []),
            categories: Array.isArray(actualRestaurant?.categories) ? actualRestaurant.categories : (Array.isArray(apiRestaurant?.categories) ? apiRestaurant.categories : []),
            menu: Array.isArray(actualRestaurant?.menu) ? actualRestaurant.menu : (Array.isArray(apiRestaurant?.menu) ? apiRestaurant.menu : []),
            slug: actualRestaurant?.slug || apiRestaurant?.slug || actualRestaurant?.name?.toLowerCase().replace(/\s+/g, '-') || apiRestaurant?.name?.toLowerCase().replace(/\s+/g, '-') || slug || "unknown",
            restaurantId: actualRestaurant?.restaurantId || actualRestaurant?._id || actualRestaurant?.id || apiRestaurant?.restaurantId || apiRestaurant?._id || apiRestaurant?.id || null,
            // Add other fields with defaults
            featuredDish: actualRestaurant?.featuredDish || apiRestaurant?.featuredDish || onboardingStep4?.featuredDish || null,
            featuredPrice: actualRestaurant?.featuredPrice || apiRestaurant?.featuredPrice || onboardingStep4?.featuredPrice || null,
            // Additional safety fields
            openDays: Array.isArray(actualRestaurant?.openDays)
              ? actualRestaurant.openDays
              : (Array.isArray(apiRestaurant?.openDays) ? apiRestaurant.openDays : (Array.isArray(onboardingStep2?.openDays) ? onboardingStep2.openDays : [])),
            deliveryTimings: actualRestaurant?.deliveryTimings || apiRestaurant?.deliveryTimings || {
              openingTime: actualRestaurant?.openingTime || apiRestaurant?.openingTime || onboardingStep2?.deliveryTimings?.openingTime || "09:00",
              closingTime: actualRestaurant?.closingTime || apiRestaurant?.closingTime || onboardingStep2?.deliveryTimings?.closingTime || "22:00",
            },
            outletTimings: actualRestaurant?.outletTimings || apiRestaurant?.outletTimings || null,
            cuisines: Array.isArray(actualRestaurant?.cuisines) ? actualRestaurant.cuisines : (Array.isArray(apiRestaurant?.cuisines) ? apiRestaurant.cuisines : (Array.isArray(onboardingStep2?.cuisines) ? onboardingStep2.cuisines : [])),
            profileImage: normalizedProfileImage,
            coverImages: normalizedCoverImages,
            menuImages: normalizedMenuImages,
            // Menu sections for display (will be populated from menu API)
            menuSections: [],
            // Onboarding data including FSSAI license
            onboarding: actualRestaurant?.onboarding || apiRestaurant?.onboarding || null,
            fssaiNumber:
              actualRestaurant?.fssaiNumber ||
              apiRestaurant?.fssaiNumber ||
              actualRestaurant?.onboarding?.step3?.fssai?.registrationNumber ||
              apiRestaurant?.onboarding?.step3?.fssai?.registrationNumber ||
              "",
            fssaiImage:
              actualRestaurant?.fssaiImage ||
              apiRestaurant?.fssaiImage ||
              actualRestaurant?.onboarding?.step3?.fssai?.image ||
              apiRestaurant?.onboarding?.step3?.fssai?.image ||
              null,
            // Availability fields for grayscale styling
            isActive: actualRestaurant?.isActive !== false, // Default to true if not specified
            isAcceptingOrders: actualRestaurant?.isAcceptingOrders !== false, // Default to true if not specified
          }

          debugLog('? Transformed restaurant:', transformedRestaurant)
          debugLog('? Restaurant ID for menu fetch:', transformedRestaurant.id)

          if (!transformedRestaurant.id) {
            debugError('? No restaurant ID found! Cannot fetch menu.')
          }

          setRestaurant(transformedRestaurant)
          fetchedRestaurantRef.current = true // Mark as fetched
          fetchedSlugRef.current = slug

          // Load outlet timings from public endpoint (source of truth for daily opening slots)
          try {
            const outletRestaurantId = transformedRestaurant.mongoId || actualRestaurant?._id || apiRestaurant?._id
            if (outletRestaurantId && !transformedRestaurant.outletTimings) {
              const outletTimingsData = await fetchOutletTimingsCached(outletRestaurantId)
              if (outletTimingsData) {
                setRestaurant((prev) => ({ ...prev, outletTimings: outletTimingsData }))
              }
            }
          } catch (outletError) {
            debugWarn("Outlet timings fetch failed, falling back to delivery timings:", outletError?.message)
          }

          // Fetch menu and inventory for this restaurant
          // If no restaurant ID, try to find matching restaurant by name
          let restaurantIdForMenu = transformedRestaurant.id

          if (!restaurantIdForMenu) {
            debugWarn('? No restaurant ID available, searching for restaurant by name...')
            try {
              const searchVariants = zoneId
                ? [{ limit: 100, zoneId: zoneId, _ts: Date.now() }, { limit: 100, _ts: Date.now() }]
                : [{ limit: 100, _ts: Date.now() }]

              for (const searchParams of searchVariants) {
                const searchResponse = await fetchRestaurantsCached(searchParams, { force: true })
                const restaurants = searchResponse?.data?.data?.restaurants || searchResponse?.data?.data || []

                // Try to find by exact name match
                const matchingRestaurant = restaurants.find(r =>
                  r.name?.toLowerCase().trim() === transformedRestaurant.name?.toLowerCase().trim()
                )

                if (matchingRestaurant) {
                  restaurantIdForMenu = matchingRestaurant._id || matchingRestaurant.restaurantId || matchingRestaurant.id
                  debugLog('? Found matching restaurant by name, ID:', restaurantIdForMenu)

                  // Update the restaurant ID in state
                  setRestaurant(prev => ({
                    ...prev,
                    id: restaurantIdForMenu,
                    restaurantId: restaurantIdForMenu
                  }))
                  break
                }
              }

              if (!restaurantIdForMenu) {
                debugWarn('? No matching restaurant found by name')
              }
            } catch (searchError) {
              debugError('? Error searching for restaurant:', searchError)
            }
          }

          const normalizedLookupIds = [
            restaurantIdForMenu,
            slug,
            transformedRestaurant.id,
            transformedRestaurant.restaurantId,
            transformedRestaurant.mongoId,
            apiRestaurant?.restaurantId,
            apiRestaurant?._id,
            actualRestaurant?.restaurantId,
            actualRestaurant?._id,
            actualRestaurant?.slug,
          ]
            .filter(Boolean)
            .map((value) => String(value).trim())
            .filter((value, index, arr) => arr.indexOf(value) === index)

          setLoadingMenuItems(true)
          if (normalizedLookupIds.length > 0) {
            let hasPreviousOrderForRestaurant = false
            if (isModuleAuthenticated('user')) {
              try {
                const normalize = (value) => (value ? String(value).trim().toLowerCase() : "")
                const targetRestaurantName = normalize(transformedRestaurant.name)
                const targetRestaurantIds = new Set(
                  [
                    ...normalizedLookupIds,
                    transformedRestaurant.id,
                    transformedRestaurant.restaurantId,
                    apiRestaurant?.restaurantId,
                    apiRestaurant?._id,
                    actualRestaurant?.restaurantId,
                    actualRestaurant?._id,
                  ].map(normalize).filter(Boolean)
                )

                const ORDERS_CHECK_LIMIT = 30
                const ordersResponse = await orderAPI.getOrders({ limit: ORDERS_CHECK_LIMIT, page: 1 })
                let recentOrders = []

                if (ordersResponse?.data?.success && ordersResponse?.data?.data?.orders) {
                  recentOrders = ordersResponse.data.data.orders || []
                } else if (ordersResponse?.data?.orders) {
                  recentOrders = ordersResponse.data.orders || []
                } else if (Array.isArray(ordersResponse?.data?.data)) {
                  recentOrders = ordersResponse.data.data || []
                }

                hasPreviousOrderForRestaurant = recentOrders.some((order) => {
                  const orderRestaurantField = order?.restaurantId
                  const candidateIds = [
                    order?.restaurantId,
                    orderRestaurantField?._id,
                    orderRestaurantField?.id,
                    orderRestaurantField?.restaurantId,
                    order?.restaurant,
                    order?.restaurant_id,
                  ].map(normalize).filter(Boolean)

                  if (candidateIds.some((id) => targetRestaurantIds.has(id))) {
                    return true
                  }

                  const candidateNames = [
                    order?.restaurantName,
                    orderRestaurantField?.name,
                    order?.restaurant?.name,
                  ].map(normalize).filter(Boolean)

                  return !!targetRestaurantName && candidateNames.includes(targetRestaurantName)
                })
              } catch (orderCheckError) {
                debugWarn("Could not verify previous orders for recommendation section:", orderCheckError)
              }
            }

            try {
              debugLog('? Fetching menu for restaurant ID:', restaurantIdForMenu)
              let menuResponse = null
              let resolvedMenuLookupId = null
              menuLookupIdsRef.current = normalizedLookupIds
              for (const lookupId of normalizedLookupIds) {
                try {
                  debugLog('? Fetching menu for restaurant lookup ID:', lookupId)
                  const response = await restaurantAPI.getMenuByRestaurantId(lookupId, { 
                    noCache: true,
                    params: { page: 1, limit: 15 }
                  })
                  if (response?.data?.success) {
                    menuResponse = response
                    resolvedMenuLookupId = lookupId
                    resolvedMenuLookupIdRef.current = lookupId
                    break
                  }
                } catch (lookupError) {
                  if (lookupError?.response?.status !== 404) {
                    throw lookupError
                  }
                }
              }
              if (!menuResponse) {
                throw Object.assign(new Error('Menu not found'), { response: { status: 404 } })
              }
              debugLog('? Menu resolved using lookup ID:', resolvedMenuLookupId)
              if (menuResponse.data && menuResponse.data.success && menuResponse.data.data && menuResponse.data.data.menu) {
                const rawSections = menuResponse.data.data.menu.sections || []
                const toArray = (value) => {
                  if (Array.isArray(value)) return value
                  if (!value || typeof value !== "object") return []
                  return Object.values(value).filter((entry) => entry && typeof entry === "object")
                }
                const menuSections = toArray(rawSections)
                  .map((section, sectionIndex) => ({
                  ...section,
                  id: String(section.id || section._id || `section-${sectionIndex}`),
                  categoryId: String(section.categoryId || section.id || section._id || `section-${sectionIndex}`),
                  name: section.name || section.title || "Unnamed Section",
                  itemCount: Number(section.itemCount) || toArray(section.items).length,
                  sortOrder: Number(section.sortOrder) || 0,
                  items: toArray(section.items).map(normalizeMenuItem),
                  subsections: toArray(section.subsections).map((subsection, subsectionIndex) => ({
                    ...subsection,
                    id: String(subsection.id || subsection._id || `subsection-${sectionIndex}-${subsectionIndex}`),
                    name: subsection.name || "Unnamed Subsection",
                    items: toArray(subsection.items).map(normalizeMenuItem),
                  })),
                }))
                  .sort((a, b) => a.sortOrder - b.sortOrder)

                // Collect all recommended items from all sections
                // Only include items that are both recommended (isRecommended === true) AND available (isAvailable !== false)
                const recommendedItems = []
                menuSections.forEach(section => {
                  // Check direct items - only include if isRecommended is explicitly true (strict check) AND item is available
                  if (section.items && Array.isArray(section.items)) {
                    section.items.forEach(item => {
                      // Strict check: isRecommended must be exactly boolean true
                      // This will exclude: false, undefined, null, 0, "", and any other falsy values
                      if (isRecommendedItem(item) && item.isAvailable !== false) {
                        recommendedItems.push(item)
                      }
                    })
                  }
                  // Check subsection items - only include if isRecommended is explicitly true (strict check) AND item is available
                  if (section.subsections && Array.isArray(section.subsections)) {
                    section.subsections.forEach(subsection => {
                      if (subsection.items && Array.isArray(subsection.items)) {
                        subsection.items.forEach(item => {
                          // Strict check: isRecommended must be exactly boolean true
                          // This will exclude: false, undefined, null, 0, "", and any other falsy values
                          if (isRecommendedItem(item) && item.isAvailable !== false) {
                            recommendedItems.push(item)
                          }
                        })
                      }
                    })
                  }
                })

                // Debug log to verify recommended items and their isRecommended values
                debugLog('Recommended items collected:', recommendedItems.map(item => ({
                  name: item.name,
                  isRecommended: item.isRecommended,
                  isRecommendedType: typeof item.isRecommended,
                  preparationTime: item.preparationTime
                })))

                // Debug log to check preparationTime in menu sections
                debugLog('Menu sections with preparationTime:', menuSections.map(section => ({
                  sectionName: section.name,
                  items: section.items?.map(item => ({
                    name: item.name,
                    preparationTime: item.preparationTime
                  })) || []
                })))

                // Dynamically inject the specifically searched dish at the very top if targetDishId is present
                let searchedDishSection = null
                if (targetDishId) {
                  const allItemsInMenu = []
                  menuSections.forEach(s => {
                    if (s.items) allItemsInMenu.push(...s.items)
                    if (s.subsections) {
                      s.subsections.forEach(ss => {
                        if (ss.items) allItemsInMenu.push(...ss.items)
                      })
                    }
                  })
                  const matchedItem = allItemsInMenu.find(item => String(item.id || item._id || "").trim() === targetDishId)
                  if (matchedItem) {
                    searchedDishSection = {
                      name: "Result for your search",
                      items: [matchedItem],
                      subsections: [],
                      isSearchResult: true
                    }
                  }
                }

                let finalMenuSections = [...menuSections]
                if (hasPreviousOrderForRestaurant) {
                  finalMenuSections = [{ name: "Recommended for you", items: recommendedItems, subsections: [] }, ...finalMenuSections]
                }
                if (searchedDishSection) {
                  finalMenuSections = [searchedDishSection, ...finalMenuSections]
                }

                const rawCategories = menuResponse.data.data.menu.categories || []
                const menuCategoryNav = toArray(rawCategories)
                  .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0))
                  .map((category) => {
                    const categoryKey = String(category.categoryId || category.id || "")
                    const sectionIndex = finalMenuSections.findIndex((section) => {
                      if (isRecommendedSection(section)) return false
                      return String(section.categoryId || section.id || "") === categoryKey
                    })
                    if (sectionIndex < 0) return null
                    return {
                      id: normalizeMenuCategoryId(categoryKey || category.name),
                      name: category.name || "Category",
                      image: category.image || "",
                      count: Number(category.itemCount) || 0,
                      sectionIndex,
                    }
                  })
                  .filter(Boolean)

                 const pagination = normalizePagination(menuResponse.data.data.menu.pagination)
                setMenuPagination(pagination)
                currentMenuPageRef.current = pagination.page

                setRestaurant(prev => ({
                  ...prev,
                  menuSections: finalMenuSections,
                  menuCategoryNav,
                }))

                // Expand all visible sections by default
                const defaultExpandedSections = new Set(
                  finalMenuSections.map((_, idx) => idx)
                )
                setExpandedSections(defaultExpandedSections)

                debugLog('Fetched menu sections with recommended items:', finalMenuSections)
              }
            } catch (menuError) {
              if (menuError.response && menuError.response.status === 404) {
                debugLog('? Menu not found for this restaurant (might be a dining-only listing).')
              } else {
                debugError('? Error fetching menu:', menuError)
              }
            } finally {
              setLoadingMenuItems(false)
            }

            try {
              debugLog('? Fetching inventory for restaurant ID:', restaurantIdForMenu)
              let inventoryResponse = null
              let resolvedInventoryLookupId = null
              for (const lookupId of normalizedLookupIds) {
                try {
                  debugLog('? Fetching inventory for restaurant lookup ID:', lookupId)
                  const response = await restaurantAPI.getInventoryByRestaurantId(lookupId)
                  if (response?.data?.success) {
                    inventoryResponse = response
                    resolvedInventoryLookupId = lookupId
                    break
                  }
                } catch (lookupError) {
                  if (lookupError?.response?.status !== 404) {
                    throw lookupError
                  }
                }
              }
              if (!inventoryResponse) {
                throw Object.assign(new Error('Inventory not found'), { response: { status: 404 } })
              }
              debugLog('? Inventory resolved using lookup ID:', resolvedInventoryLookupId)
              if (inventoryResponse.data && inventoryResponse.data.success && inventoryResponse.data.data && inventoryResponse.data.data.inventory) {
                const inventoryCategories = inventoryResponse.data.data.inventory.categories || []

                // Normalize inventory categories to ensure proper structure
                const normalizedInventory = inventoryCategories.map((category, index) => ({
                  id: category.id || `category-${index}`,
                  name: category.name || "Unnamed Category",
                  description: category.description || "",
                  itemCount: category.itemCount || (category.items?.length || 0),
                  inStock: category.inStock !== undefined ? category.inStock : true,
                  items: Array.isArray(category.items) ? category.items.map(item => ({
                    id: String(item.id || Date.now() + Math.random()),
                    name: item.name || "Unnamed Item",
                    inStock: item.inStock !== undefined ? item.inStock : true,
                    isVeg: item.isVeg !== undefined ? item.isVeg : true,
                    stockQuantity: item.stockQuantity || "Unlimited",
                    unit: item.unit || "piece",
                    expiryDate: item.expiryDate || null,
                    lastRestocked: item.lastRestocked || null,
                  })) : [],
                  order: category.order !== undefined ? category.order : index,
                }))

                setRestaurant(prev => ({
                  ...prev,
                  inventory: normalizedInventory,
                }))
                debugLog('? Fetched and normalized inventory categories:', normalizedInventory)
              }
            } catch (inventoryError) {
              if (inventoryError.response && inventoryError.response.status === 404) {
                debugLog('? Inventory not found for this restaurant (might be a dining-only listing).')
              } else {
                debugError('? Error fetching inventory:', inventoryError)
              }
            }
          }
          else {
            setLoadingMenuItems(false)
          }
        } else {
          debugError('? No restaurant data found in API response')
          debugError('? Response:', response)
          debugError('? apiRestaurant:', apiRestaurant)
          if (!fetchedRestaurantRef.current) {
            setRestaurantError('Restaurant not found')
            setRestaurant(null)
          }
        }
      } catch (error) {
        // Check if it's a network error (backend not running)
        const isNetworkError = error.code === 'ERR_NETWORK' || error.message === 'Network Error'

        // Check if it's a 404 error (restaurant doesn't exist)
        const is404Error = error.response?.status === 404

        if (isNetworkError) {
          // Network error - backend is not running
          // Don't show "Restaurant not found" for network errors
          // The axios interceptor will show a toast notification
          debugError('Network error fetching restaurant (backend may not be running):', error)
          if (!fetchedRestaurantRef.current) {
            setRestaurantError('Backend server is not connected. Please make sure the backend is running.')
            setRestaurant(null)
          }
        } else if (is404Error) {
          // 404 error - restaurant doesn't exist in database
          debugLog(`Restaurant "${slug}" not found in database`)
          if (!fetchedRestaurantRef.current) {
            setRestaurantError('Restaurant not found')
            setRestaurant(null)
          }
        } else {
          // Other errors
          debugError('Error fetching restaurant:', error)
          if (!fetchedRestaurantRef.current) {
            setRestaurantError(error.message || 'Failed to load restaurant')
            setRestaurant(null)
          }
        }
      } finally {
        if (inFlightSlugRef.current === slug) inFlightSlugRef.current = null
        setLoadingRestaurant(false)
        setLoadingMenuItems(false)
      }
    }

    // Reset fetched flag only when URL slug changes.
    // Do not compare with restaurant.slug because canonical API slug may differ
    // from route slug (e.g. "restaurant-2513"), causing refetch loops.
    if (fetchedRestaurantRef.current && fetchedSlugRef.current !== slug) {
      fetchedRestaurantRef.current = false
      fetchedSlugRef.current = null
    }

    fetchRestaurant()
  }, [slug, zoneId])

  useEffect(() => {
    const restaurantId = restaurant?.mongoId || restaurant?.id || restaurant?.restaurantId
    if (!restaurantId) {
      setPageCoupons([])
      setPageCouponsSource(null)
      return
    }
    let cancelled = false
    restaurantAPI.getRestaurantPageOffers(restaurantId)
      .then((res) => {
        if (cancelled) return
        const data = res?.data?.data || res?.data || {}
        const coupons = Array.isArray(data.coupons) ? data.coupons : []
        setPageCoupons(coupons)
        setPageCouponsSource(data.source || null)
        if (coupons.length > 0) {
          setRestaurant((prev) => prev ? {
            ...prev,
            restaurantOffers: {
              ...(prev.restaurantOffers || {}),
              coupons: coupons.map((c) => ({
                id: c.id || c.offerId,
                code: c.code || c.couponCode,
                title: c.title,
                subtitle: c.subtitle,
                isFreeDelivery: c.isFreeDelivery,
                minOrderValue: c.minOrderValue,
              })),
            },
          } : prev)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPageCoupons([])
          setPageCouponsSource(null)
        }
      })
    return () => { cancelled = true }
  }, [restaurant?.mongoId, restaurant?.id, restaurant?.restaurantId])

  // Track previous values to prevent unnecessary recalculations
  const prevCoordsRef = useRef({ userLat: null, userLng: null, restaurantLat: null, restaurantLng: null })
  const prevDistanceRef = useRef(null)

  // Extract restaurant coordinates as stable values (not array references)
  const restaurantLat = restaurant?.locationObject?.latitude ||
    (restaurant?.locationObject?.coordinates && Array.isArray(restaurant.locationObject.coordinates)
      ? restaurant.locationObject.coordinates[1]
      : null)
  const restaurantLng = restaurant?.locationObject?.longitude ||
    (restaurant?.locationObject?.coordinates && Array.isArray(restaurant.locationObject.coordinates)
      ? restaurant.locationObject.coordinates[0]
      : null)

  // Recalculate distance when user location updates
  useEffect(() => {
    if (!restaurant || !userLocation?.latitude || !userLocation?.longitude) return
    if (!restaurantLat || !restaurantLng) return

    const userLat = userLocation.latitude
    const userLng = userLocation.longitude

    // Check if coordinates have actually changed (with small threshold to avoid floating point issues)
    const coordsChanged =
      Math.abs(prevCoordsRef.current.userLat - userLat) > 0.0001 ||
      Math.abs(prevCoordsRef.current.userLng - userLng) > 0.0001 ||
      Math.abs(prevCoordsRef.current.restaurantLat - restaurantLat) > 0.0001 ||
      Math.abs(prevCoordsRef.current.restaurantLng - restaurantLng) > 0.0001

    // Skip recalculation if coordinates haven't changed
    if (!coordsChanged && prevDistanceRef.current !== null) {
      return
    }

    // Update refs with current coordinates
    prevCoordsRef.current = { userLat, userLng, restaurantLat, restaurantLng }

    if (userLat && userLng && restaurantLat && restaurantLng &&
      !isNaN(userLat) && !isNaN(userLng) && !isNaN(restaurantLat) && !isNaN(restaurantLng)) {

      // Straight-line fallback only: the road distance from the backend was
      // computed once at fetch time for a fixed origin, so once the user's
      // live location moves we re-estimate locally rather than re-hitting the
      // Directions API on every GPS tick. Uses the same haversine helper the
      // restaurant list page falls back to (resolveRestaurantDistance).
      const distanceInKm = calculateDistanceKm(userLat, userLng, restaurantLat, restaurantLng)
      const calculatedDistance = formatDistanceFromMeters(distanceInKm * 1000)

      // Only update if distance actually changed
      if (calculatedDistance !== prevDistanceRef.current) {
        debugLog('? Recalculated distance from user to restaurant:', calculatedDistance, 'km:', distanceInKm)
        prevDistanceRef.current = calculatedDistance

        // Update restaurant distance
        setRestaurant(prev => {
          // Only update if distance actually changed to prevent infinite loop
          if (prev?.distance === calculatedDistance) {
            return prev
          }
          return {
            ...prev,
            distance: calculatedDistance
          }
        })
      }
    }
  }, [userLocation?.latitude, userLocation?.longitude, restaurantLat, restaurantLng])

  // Sync quantities from cart on mount and when restaurant changes
  useEffect(() => {
    if (!restaurant || !restaurant.name) return

    const cartQuantities = {}
    cart.forEach((item) => {
      if (item.restaurant === restaurant.name) {
        cartQuantities[item.id] = item.quantity || 0
      }
    })
    setQuantities(cartQuantities)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant?.name, cart])

  useEffect(() => {
    if (!selectedItem) {
      setSelectedVariantId("")
      return
    }
    const defaultVariant = getDefaultFoodVariant(selectedItem)
    setSelectedVariantId(defaultVariant?.id || "")
  }, [selectedItem])

  // Helper function to update item quantity in both local state and cart
  const updateItemQuantity = async (item, newQuantity, event = null, preferredVariant = null) => {
    // Check authentication
    if (!isModuleAuthenticated('user')) {
      toast.error("Please login to add items to cart")
      navigate('/user/auth/login', { state: { from: location.pathname } })
      return
    }

    // CRITICAL: Check if user is in service zone or restaurant is available
    if (isOutOfService) {
      toast.error('You are outside the service zone. Please select a location within the service area.');
      return;
    }

    const availability = getRestaurantAvailabilityStatus(restaurant)
    if (!availability.isOpen) {
      toast.error("Restaurant is currently offline. Please try again later.")
      return
    }

    const resolvedVariant = preferredVariant || getDefaultFoodVariant(item)
    const lineItemId = getLineItemIdForDish(item, resolvedVariant)

    // Update local state
    setQuantities((prev) => ({
      ...prev,
      [lineItemId]: newQuantity,
    }))

    // CRITICAL: Validate restaurant data before adding to cart
    if (!restaurant || !restaurant.name) {
      debugError('? Cannot add item to cart: Restaurant data is missing!');
      toast.error('Restaurant information is missing. Please refresh the page.');
      return;
    }

    // Ensure we have a valid restaurantId
    const validRestaurantId = restaurant?.restaurantId || restaurant?._id || restaurant?.id;
    if (!validRestaurantId) {
      debugError('? Cannot add item to cart: Restaurant ID is missing!', {
        restaurant: restaurant,
        restaurantId: restaurant?.restaurantId,
        _id: restaurant?._id,
        id: restaurant?.id
      });
      toast.error('Restaurant ID is missing. Please refresh the page.');
      return;
    }

    // Log for debugging
    debugLog('? Adding item to cart:', {
      itemName: item.name,
      restaurantName: restaurant.name,
      restaurantId: validRestaurantId,
      restaurant_id: restaurant._id,
      restaurant_restaurantId: restaurant.restaurantId
    });

    // Prepare cart item with all required properties
    const cartItem = {
      id: lineItemId,
      lineItemId,
      itemId: item.id,
      name: item.name,
      price: resolvedVariant?.price ?? item.price,
      variantId: resolvedVariant?.id || "",
      variantName: resolvedVariant?.name || "",
      variantPrice: resolvedVariant?.price ?? item.price,
      image: item.image,
      restaurant: restaurant.name, // Use restaurant.name directly (already validated)
      restaurantId: validRestaurantId, // Use validated restaurantId
      description: item.description,
      originalPrice: item.originalPrice,
      isVeg: item.isVeg === true, // Use strict check
      foodType: item.foodType, // Include foodType for robustness
      preparationTime: item.preparationTime, // Add preparationTime property
      priceOnOtherPlatforms: item.priceOnOtherPlatforms || null, // Include platform pricing for savings display
      otherPlatformGst: item.otherPlatformGst ?? null,
      latitude: restaurantLat,
      longitude: restaurantLng,
    }

    // Get source position for animation from event target
    // Prefer currentTarget (the button) over target (might be icon inside button)
    let sourcePosition = null
    if (event) {
      // Use currentTarget (the button element) for accurate button position
      // If currentTarget is not available, try to find the button element
      let buttonElement = event.currentTarget
      if (!buttonElement && event.target) {
        // If we clicked on an icon inside, find the closest button
        buttonElement = event.target.closest('button') || event.target
      }

      if (buttonElement) {
        // Store button reference and current viewport position
        // We'll recalculate position right before animation to account for scroll
        const rect = buttonElement.getBoundingClientRect()
        const scrollX = window.pageXOffset || window.scrollX || 0
        const scrollY = window.pageYOffset || window.scrollY || 0

        // Store both viewport position and scroll at capture time
        // This allows us to adjust for scroll changes later
        sourcePosition = {
          // Viewport-relative position at capture time
          viewportX: rect.left + rect.width / 2,
          viewportY: rect.top + rect.height / 2,
          // Scroll position at capture time
          scrollX: scrollX,
          scrollY: scrollY,
          // Store button identifier to potentially find it again
          itemId: lineItemId,
        }
      }
    }

    // Update cart context
    if (newQuantity <= 0) {
      // Pass sourcePosition and product info for removal animation
      const productInfo = {
        id: lineItemId,
        name: item.name,
        imageUrl: item.image,
      }
      removeFromCart(lineItemId, sourcePosition, productInfo)
    } else {
      const existingCartItem = getCartItem(lineItemId)
      if (existingCartItem) {
        // Prepare product info for animation
        const productInfo = {
          id: lineItemId,
          name: item.name,
          imageUrl: item.image,
        }

        // If incrementing quantity, trigger add animation with sourcePosition
        if (newQuantity > existingCartItem.quantity && sourcePosition) {
          const result = await addToCart(cartItem, sourcePosition)
          if (!handleAddToCartFeedback(result, 'Cannot add this item to cart.', restaurant?.name || '')) {
            return
          }
          if (newQuantity > existingCartItem.quantity + 1) {
            updateQuantity(lineItemId, newQuantity)
          }
        }
        // If decreasing quantity, trigger removal animation with sourcePosition
        else if (newQuantity < existingCartItem.quantity && sourcePosition) {
          updateQuantity(lineItemId, newQuantity, sourcePosition, productInfo)
        }
        // Otherwise just update quantity without animation
        else {
          updateQuantity(lineItemId, newQuantity)
        }
      } else {
        // Add to cart first (adds with quantity 1), then update to desired quantity
        // Pass sourcePosition when adding a new item
        const result = await addToCart(cartItem, sourcePosition)
        if (!handleAddToCartFeedback(result, 'Cannot add this item to cart.', restaurant?.name || '')) {
          return
        }
        if (newQuantity > 1) {
          updateQuantity(lineItemId, newQuantity)
        }
      }
    }
  }

  const isRecommendedSection = (section) => {
    const sectionName = section?.name || section?.title || ""
    if (typeof sectionName !== "string") return false
    const name = sectionName.trim().toLowerCase()
    return name === "recommended for you" || name === "result for your search"
  }

  const isRecommendedItem = (item) => {
    return item.isRecommended === true && typeof item.isRecommended === "boolean"
  }

  const getSectionDisplayName = (section) => {
    if (isRecommendedSection(section)) {
      return "Recommended for you"
    }
    if (section?.name && typeof section.name === "string" && section.name.trim()) {
      return section.name.trim()
    }
    if (section?.title && typeof section.title === "string" && section.title.trim()) {
      return section.title.trim()
    }
    return "Unnamed Section"
  }

  const normalizeMenuCategoryId = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")

  const toRenderableArray = (value) => {
    if (Array.isArray(value)) return value
    if (!value || typeof value !== "object") return []
    return Object.values(value).filter((entry) => entry && typeof entry === "object")
  }

  const getSectionCategoryImage = (section) => {
    const directImage = typeof section?.image === "string" ? section.image.trim() : ""
    if (directImage) return directImage

    const firstSectionItemImage = toRenderableArray(section?.items).find(
      (item) => typeof item?.image === "string" && item.image.trim(),
    )?.image
    if (firstSectionItemImage) return firstSectionItemImage

    const firstSubsectionImage = toRenderableArray(section?.subsections)
      .flatMap((subsection) => toRenderableArray(subsection?.items))
      .find((item) => typeof item?.image === "string" && item.image.trim())?.image

    return firstSubsectionImage || ""
  }

  // Menu categories - from API nav or fallback from sections
  const menuCategories = useMemo(() => {
    if (Array.isArray(restaurant?.menuCategoryNav) && restaurant.menuCategoryNav.length > 0) {
      return restaurant.menuCategoryNav.filter((category) => category.count > 0)
    }

    if (!restaurant?.menuSections || !Array.isArray(restaurant.menuSections)) return []

    return restaurant.menuSections
      .map((section, index) => {
        if (isRecommendedSection(section)) return null

        const sectionTitle = getSectionDisplayName(section)
        const itemCount = Array.isArray(section?.items) ? section.items.length : 0
        const subsectionCount = Array.isArray(section?.subsections)
          ? section.subsections.reduce((sum, sub) => sum + (Array.isArray(sub?.items) ? sub.items.length : 0), 0)
          : 0
        const totalCount = itemCount + subsectionCount

        if (totalCount <= 0) return null

        return {
          id: normalizeMenuCategoryId(section?.categoryId || sectionTitle || index) || `section-${index}`,
          name: sectionTitle,
          image: getSectionCategoryImage(section),
          count: totalCount,
          sectionIndex: index,
        }
      })
      .filter(Boolean)
  }, [restaurant?.menuCategoryNav, restaurant?.menuSections])

  // Count active filters
  const getActiveFilterCount = () => {
    let count = 0
    if (filters.sortBy) count++
    if (filters.vegNonVeg) count++
    if (filters.highlyReordered) count++
    if (filters.spicy) count++
    return count
  }

  const activeFilterCount = getActiveFilterCount()

  useEffect(() => {
    if (typeof window === "undefined" || !slug) return

    try {
      const raw = window.localStorage.getItem(RESTAURANT_DETAILS_FILTERS_STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : {}
      const nextState = parsed && typeof parsed === "object" ? parsed : {}
      nextState[slug] = filters
      window.localStorage.setItem(RESTAURANT_DETAILS_FILTERS_STORAGE_KEY, JSON.stringify(nextState))
    } catch (error) {
      debugWarn("Failed to persist restaurant filters:", error)
    }
  }, [filters, slug])

  useEffect(() => {
    if (selectedMenuCategory === "all") return
    const categoryStillVisible = menuCategories.some((category) => category.id === selectedMenuCategory)
    if (!categoryStillVisible) {
      setSelectedMenuCategory("all")
    }
  }, [menuCategories, selectedMenuCategory])

  // Handle bookmark click
  const handleBookmarkClick = (item) => {
    const restaurantId = restaurant?.restaurantId || restaurant?._id || restaurant?.id
    if (!restaurantId) {
      toast.error("Restaurant information is missing")
      return
    }

    const dishId = item.id || item._id
    if (!dishId) {
      toast.error("Dish information is missing")
      return
    }

    const isFavorite = isDishFavorite(dishId, restaurantId)

    if (isFavorite) {
      // If already bookmarked, remove it
      removeDishFavorite(dishId, restaurantId)
      toast.success("Dish removed from favorites")
    } else {
      // Add to favorites
      const dishData = {
        id: dishId,
        name: item.name,
        description: item.description,
        price: item.price,
        originalPrice: item.originalPrice,
        image: item.image,
        restaurantId: restaurantId,
        restaurantName: restaurant?.name || "",
        restaurantSlug: restaurant?.slug || slug || "",
        foodType: item.foodType,
        isSpicy: item.isSpicy,
        customisable: item.customisable,
      }
      addDishFavorite(dishData)
      toast.success("Dish added to favorites")
    }
  }

  // Handle add to collection
  const handleAddToCollection = () => {
    const restaurantSlug = restaurant?.slug || slug || ""

    if (!restaurantSlug) {
      toast.error("Restaurant information is missing")
      return
    }

    if (!restaurant) {
      toast.error("Restaurant data not available")
      return
    }

    const isAlreadyFavorite = isFavorite(restaurantSlug)

    if (isAlreadyFavorite) {
      // Remove from collection
      removeFavorite(restaurantSlug)
      toast.success("Restaurant removed from collection")
    } else {
      // Add to collection
      addFavorite({
        slug: restaurantSlug,
        name: restaurant.name || "",
        cuisine: restaurant.cuisine || "",
        rating: restaurant.rating || 0,
        deliveryTime: restaurant.deliveryTime || restaurant.estimatedDeliveryTime || "",
        distance: restaurant.distance || "",
        priceRange: restaurant.priceRange || "",
        image: restaurant.profileImageUrl?.url || restaurant.image || ""
      })
      toast.success("Restaurant added to collection")
    }

    setShowMenuOptionsSheet(false)
  }

  // Handle share restaurant
  const handleShareRestaurant = async () => {
    const companyName = await getCompanyNameAsync()
    const restaurantSlug = restaurant?.slug || slug || ""
    const restaurantName = restaurant?.name || "this restaurant"

    // Create share URL
    const shareUrl = `${window.location.origin}/user/restaurants/${restaurantSlug}`
    const shareText = `Check out ${restaurantName} on ${companyName}! ${shareUrl}`

    const payload = {
      title: restaurantName,
      text: shareText,
      url: shareUrl,
    }

    if (isMobileDevice()) {
      openShareModal(payload)
      setShowMenuOptionsSheet(false)
      return
    }

    const shared = await tryNativeShare(payload)
    if (shared) {
      toast.success("Restaurant shared successfully")
      setShowMenuOptionsSheet(false)
      return
    }

    openShareModal(payload)
    setShowMenuOptionsSheet(false)
  }



  // Handle share click
  const handleShareClick = async (item) => {
    const dishId = item.id || item._id
    const restaurantSlug = restaurant?.slug || slug || ""

    // Create share URL
    const shareUrl = `${window.location.origin}/user/restaurants/${restaurantSlug}?dish=${dishId}`
    const shareText = `Check out ${item.name} from ${restaurant?.name || "this restaurant"}! ${shareUrl}`

    const payload = {
      title: `${item.name} - ${restaurant?.name || ""}`,
      text: shareText,
      url: shareUrl,
    }

    if (isMobileDevice()) {
      openShareModal(payload)
      return
    }

    const shared = await tryNativeShare(payload)
    if (shared) {
      toast.success("Dish shared successfully")
      return
    }

    openShareModal(payload)
  }

  // Copy to clipboard helper
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

  const isMobileDevice = () => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false
    const mobileUA = /Android|iPhone|iPad|iPod|Windows Phone|Opera Mini|IEMobile/i.test(navigator.userAgent)
    const smallViewport = window.matchMedia?.("(max-width: 768px)")?.matches
    return Boolean(mobileUA || smallViewport)
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

  const handleSystemShareFromModal = async () => {
    if (!sharePayload) return
    const shared = await tryNativeShare(sharePayload)
    if (shared) {
      setShowShareModal(false)
      toast.success("Shared successfully")
    }
  }

  // Handle item card click
  const handleItemClick = (item) => {
    setSelectedItem(item)
    setShowItemDetail(true)
  }

  // Helper function to calculate final price after discount
  const getFinalPrice = (item) => {
    // If discount exists, calculate from originalPrice, otherwise use price directly
    if (item.originalPrice && item.discountAmount && item.discountAmount > 0) {
      // Calculate discounted price from originalPrice
      let discountedPrice = item.originalPrice;
      if (item.discountType === 'Percent') {
        discountedPrice = item.originalPrice - (item.originalPrice * item.discountAmount / 100);
      } else if (item.discountType === 'Fixed') {
        discountedPrice = item.originalPrice - item.discountAmount;
      }
      return Math.max(0, discountedPrice);
    }
    // Otherwise, use price as the final price
    return Math.max(0, item.price || 0);
  };

  // Filter menu items based on active filters
  const filterMenuItems = (items) => {
    if (!items) return items

    return items.filter((item) => {
      // Under 250 filter (when coming from Under 250 page)
      if (showOnlyUnder250) {
        const finalPrice = getFinalPrice(item);
        if (finalPrice > 250) return false;
      }

      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim()
        const itemName = item.name?.toLowerCase() || ""
        if (!itemName.includes(query)) return false
      }

      // VegMode filter - when vegMode is ON, show only Veg items
      // When vegMode is false/null/undefined, show all items (Veg and Non-Veg)
      if (vegMode === true) {
        if (item.foodType !== "Veg") return false
      }

      // Veg/Non-veg filter (local filter override)
      if (filters.vegNonVeg === "veg") {
        // Show only veg items
        if (item.foodType !== "Veg") return false
      }
      if (filters.vegNonVeg === "non-veg") {
        // Show only non-veg items
        if (item.foodType !== "Non-Veg") return false
      }

      if (filters.highlyReordered && !isRecommendedItem(item)) return false
      if (filters.spicy && item.isSpicy !== true) return false

      return true
    })
  }

  // Sort items based on sortBy filter
  const sortMenuItems = (items) => {
    if (!items) return items
    if (!filters.sortBy) return items

    const sorted = [...items]
    if (filters.sortBy === "low-to-high") {
      return sorted.sort((a, b) => getFinalPrice(a) - getFinalPrice(b))
    } else if (filters.sortBy === "high-to-low") {
      return sorted.sort((a, b) => getFinalPrice(b) - getFinalPrice(a))
    }
    return sorted
  }

  const getSectionSortValue = (section) => {
    const allItems = [
      ...toRenderableArray(section?.items),
      ...toRenderableArray(section?.subsections).flatMap((subsection) => toRenderableArray(subsection?.items)),
    ]

    if (allItems.length === 0) return null

    const prices = allItems
      .map((item) => getFinalPrice(item))
      .filter((price) => Number.isFinite(price))

    if (prices.length === 0) return null

    if (filters.sortBy === "low-to-high") {
      return Math.min(...prices)
    }

    if (filters.sortBy === "high-to-low") {
      return Math.max(...prices)
    }

    return null
  }

  // Helper function to check if a section has any items under Rs 250
  const sectionHasItemsUnder250 = (section) => {
    if (!showOnlyUnder250) return true; // If not filtering, show all sections

    // Check direct items
    if (section.items && section.items.length > 0) {
      const hasUnder250Items = section.items.some(item => {
        if (item.isAvailable === false) return false;
        const finalPrice = getFinalPrice(item);
        return finalPrice <= 250;
      });
      if (hasUnder250Items) return true;
    }

    // Check subsection items
    if (section.subsections && section.subsections.length > 0) {
      for (const subsection of section.subsections) {
        if (subsection.items && subsection.items.length > 0) {
          const hasUnder250Items = subsection.items.some(item => {
            if (item.isAvailable === false) return false;
            const finalPrice = getFinalPrice(item);
            return finalPrice <= 250;
          });
          if (hasUnder250Items) return true;
        }
      }
    }

    return false;
  }

  // Build renderable sections from the current filter state so section/subsection visibility
  // stays in sync with the actual filtered items shown on screen.
  const getFilteredSections = () => {
    if (!restaurant?.menuSections) return []

    const visibleSections = restaurant.menuSections
      .map((section, index) => {
        const filteredItems = sortMenuItems(
          filterMenuItems(
            toRenderableArray(section?.items).filter((item) => item?.isAvailable !== false)
          )
        )

        const filteredSubsections = toRenderableArray(section?.subsections)
          .map((subsection) => ({
            ...subsection,
            items: sortMenuItems(
              filterMenuItems(
                toRenderableArray(subsection?.items).filter((item) => item?.isAvailable !== false)
              )
            ),
          }))
          .filter((subsection) => subsection.items.length > 0)

        return {
          section: {
            ...section,
            items: filteredItems,
            subsections: filteredSubsections,
          },
          originalIndex: index,
        }
      })
      .filter(({ section }) => {
        if (selectedMenuCategory !== "all") {
          if (isRecommendedSection(section)) return false
          const sectionCategoryId = normalizeMenuCategoryId(section?.categoryId || getSectionDisplayName(section))
          if (sectionCategoryId !== selectedMenuCategory) {
            return false
          }
        }

        const hasVisibleItems = toRenderableArray(section?.items).length > 0
        const hasVisibleSubsections = toRenderableArray(section?.subsections).length > 0
        return hasVisibleItems || hasVisibleSubsections
      })

    if (!filters.sortBy) {
      return visibleSections
    }

    return [...visibleSections].sort((left, right) => {
      const leftValue = getSectionSortValue(left.section)
      const rightValue = getSectionSortValue(right.section)

      if (leftValue == null && rightValue == null) return 0
      if (leftValue == null) return 1
      if (rightValue == null) return -1

      return filters.sortBy === "low-to-high"
        ? leftValue - rightValue
        : rightValue - leftValue
    })
  }

  const hasActiveMenuFilters = Boolean(
    showOnlyUnder250 ||
    searchQuery.trim() ||
    vegMode === true ||
    filters.sortBy ||
    filters.vegNonVeg ||
    filters.highlyReordered ||
    filters.spicy
  )

  const filteredSections = useMemo(
    () => getFilteredSections(),
    [restaurant?.menuSections, showOnlyUnder250, searchQuery, vegMode, filters, selectedMenuCategory]
  )

  useEffect(() => {
    if (!hasActiveMenuFilters) return

    const nextExpanded = new Set()
    filteredSections.forEach(({ section, originalIndex }) => {
      nextExpanded.add(originalIndex)
      toRenderableArray(section?.subsections).forEach((_, subIndex) => {
        nextExpanded.add(`${originalIndex}-${subIndex}`)
      })
    })

    setExpandedSections(nextExpanded)
  }, [filteredSections, hasActiveMenuFilters])

  useEffect(() => {
    if (!restaurant?.menuSections || !targetDishId) return

    let matchedItem = null
    const sectionKeysToExpand = new Set()

    restaurant.menuSections.forEach((section, originalIndex) => {
      const sectionItems = toRenderableArray(section?.items)
      const matchedSectionItem = sectionItems.find(
        (item) => String(item?.id || item?._id || "").trim() === targetDishId,
      )

      if (matchedSectionItem && !matchedItem) {
        matchedItem = matchedSectionItem
        sectionKeysToExpand.add(originalIndex)
      }

      const sectionSubsections = toRenderableArray(section?.subsections)
      sectionSubsections.forEach((subsection, subIndex) => {
        const subsectionItems = toRenderableArray(subsection?.items)
        const matchedSubsectionItem = subsectionItems.find(
          (item) => String(item?.id || item?._id || "").trim() === targetDishId,
        )

        if (matchedSubsectionItem && !matchedItem) {
          matchedItem = matchedSubsectionItem
          sectionKeysToExpand.add(originalIndex)
          sectionKeysToExpand.add(`${originalIndex}-${subIndex}`)
        }
      })
    })

    if (!matchedItem) return

    setExpandedSections((prev) => {
      const next = new Set(prev)
      sectionKeysToExpand.forEach((key) => next.add(key))
      return next
    })
    setHighlightedDishId(targetDishId)

    const scrollTimer = window.setTimeout(() => {
      const targetNode = dishCardRefs.current[targetDishId]
      if (targetNode) {
        targetNode.scrollIntoView({ behavior: "smooth", block: "center" })
      }
    }, 250)

    const highlightTimer = window.setTimeout(() => {
      setHighlightedDishId((current) => (current === targetDishId ? null : current))
    }, 2600)

    return () => {
      window.clearTimeout(scrollTimer)
      window.clearTimeout(highlightTimer)
    }
  }, [restaurant, targetDishId])

  // Highlight offers/texts for the blue offer line
  const highlightOffers = [
    "Upto 50% OFF",
    restaurant?.offerText || "",
    ...(Array.isArray(restaurant?.offers) ? restaurant.offers.map((offer) => offer?.title || "") : []),
  ]
  const rotatingOffers = highlightOffers
    .map((offer) => String(offer || "").trim())
    .filter(Boolean)
  const offersForDisplay = rotatingOffers.length > 0 ? rotatingOffers : ["Offers available"]
  const activeOfferText = offersForDisplay[highlightIndex % offersForDisplay.length]
  const offerIndicatorCount = Math.min(offersForDisplay.length, 5)
  const activeOfferIndicator = offerIndicatorCount > 0 ? highlightIndex % offerIndicatorCount : 0
  const primaryPageCoupon = pageCoupons.length > 0 ? pageCoupons[0] : null
  const primaryOffer = primaryPageCoupon || (Array.isArray(restaurant?.offers) && restaurant.offers.length > 0
    ? restaurant.offers[0]
    : null)
  const offerHeadline = primaryOffer?.title || restaurant?.offerText || activeOfferText
  const offerSubline =
    primaryOffer?.subtitle ||
    primaryOffer?.description ||
    (primaryOffer?.code || primaryOffer?.couponCode ? `Use ${primaryOffer.code || primaryOffer.couponCode}` : "Tap to view all offers")
  const hasPageOffers = pageCoupons.length > 0

  // Auto-rotate images every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentImageIndex((prev) => {
        const offersLength = Array.isArray(restaurant?.offers) && restaurant.offers.length > 0
          ? restaurant.offers.length
          : 1
        return (prev + 1) % offersLength
      })
    }, 3000)
    return () => clearInterval(interval)
  }, [restaurant?.offers?.length || 0])

  // Auto-rotate highlight offer text every 2 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setHighlightIndex((prev) => (prev + 1) % highlightOffers.length)
    }, 2000)

    return () => clearInterval(interval)
  }, [highlightOffers.length])

  // Show loading state
  if (loadingRestaurant) {
    return <RestaurantDetailSkeleton />
  }

  // Show error state if restaurant not found or network error
  if (restaurantError && !restaurant) {
    const isNetworkError = restaurantError.includes('Backend server is not connected')
    const isNotFoundError = restaurantError === 'Restaurant not found'

    return (
      <AnimatedPage>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
          <div className="flex flex-col items-center gap-4 text-center">
            <AlertCircle className={`h-12 w-12 ${isNetworkError ? 'text-[#0F172A]' : 'text-red-500'}`} />
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                {isNetworkError ? 'Connection Error' : isNotFoundError ? 'Restaurant not found' : 'Error'}
              </h2>
              <p className="text-sm text-gray-600 mb-4 max-w-md">{restaurantError}</p>
              {isNetworkError && (
                <p className="text-xs text-gray-500 mb-4">
                  Make sure the backend server is running at {API_BASE_URL.replace('/api', '')}
                </p>
              )}
              <Button onClick={goBack} variant="outline">
                Go Back
              </Button>
            </div>
          </div>
        </div>
      </AnimatedPage>
    )
  }

  // No restaurant and no error yet = a fetch is about to start; never flash "not found".
  if (!restaurant) {
    return <RestaurantDetailSkeleton />
  }

  const availabilityStatus = getRestaurantAvailabilityStatus(restaurant, new Date(availabilityTick))
  const isRestaurantOffline = !availabilityStatus.isOpen
  const shouldShowGrayscale = isOutOfService

  return (
    <AnimatedPage
      id="scrollingelement"
      className={`min-h-screen bg-[#FAFAFA] dark:bg-[#0a0a0a] flex flex-col transition-all duration-300 ${shouldShowGrayscale ? 'grayscale opacity-75' : ''
        }`}
    >
      <div className="relative">
        <RestaurantHero restaurant={restaurant} />
        <RestaurantTopBar
          showSearch={showSearch}
          searchQuery={searchQuery}
          onBack={goBack}
          onSearchOpen={() => setShowSearch(true)}
          onSearchChange={setSearchQuery}
          onSearchBlur={() => { if (!searchQuery) setShowSearch(false) }}
          onMenuOptions={() => setShowMenuOptionsSheet(true)}
        />
      </div>

      <RestaurantInfoCard
        restaurant={restaurant}
        isRestaurantOffline={isRestaurantOffline}
        onOutletsClick={() => setShowLocationSheet(true)}
      />

      {hasPageOffers && (
        <RestaurantOfferStrip
          headline={offerHeadline}
          subline={offerSubline}
          indicatorCount={Math.min(pageCoupons.length, 5)}
          activeIndicator={activeOfferIndicator}
          onClick={() => setShowOffersSheet(true)}
        />
      )}

      {isRestaurantOffline && <RestaurantOfflineBanner />}

      {/* Main Content Area (Menu) */}
      <div className="min-h-[50vh] mt-2">
        <div className="max-w-7xl mx-auto space-y-0">

          {isRestaurantOffline && (
            <div className="mx-4 sm:mx-6 lg:mx-auto max-w-7xl rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-3">
              Schedule your order for when this restaurant opens.
            </div>
          )}

          <RestaurantMenuToolbar
            fulfillmentMode={fulfillmentMode}
            isRestaurantOffline={isRestaurantOffline}
            onFulfillmentChange={(mode) => {
              setFulfillmentMode(mode)
              if (mode === "schedule") {
                setShowScheduleSheet(true)
              } else {
                try {
                  localStorage.removeItem('scheduled_order_time')
                } catch {}
              }
            }}
            onFilterOpen={() => setShowFilterSheet(true)}
            activeFilterCount={activeFilterCount}
            filters={filters}
            onVegToggle={() => setFilters(prev => ({ ...prev, vegNonVeg: prev.vegNonVeg === "veg" ? null : "veg" }))}
            onNonVegToggle={() => setFilters(prev => ({ ...prev, vegNonVeg: prev.vegNonVeg === "non-veg" ? null : "non-veg" }))}
            menuCategories={menuCategories}
            selectedMenuCategory={selectedMenuCategory}
            onCategorySelect={setSelectedMenuCategory}
          />

          {/* Menu Items Section */}
          <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 space-y-3">
            {restaurant?.menuSections && Array.isArray(restaurant.menuSections) && (
              <>
                {filteredSections.length === 0 && !hasActiveMenuFilters && !loadingMenuItems && (
                  <MenuEmptyComingSoon restaurantName={restaurant?.name} />
                )}

                {filteredSections.length === 0 && hasActiveMenuFilters && (
                  <MenuEmptyNoMatches
                    onClearFilters={() => {
                      setFilters({
                        sortBy: null,
                        vegNonVeg: null,
                        highlyReordered: false,
                        spicy: false,
                      })
                      setSearchQuery("")
                    }}
                  />
                )}

                {filteredSections.map(({ section, originalIndex }, sectionIndex) => (
                  <MenuSectionBlock
                    key={`${originalIndex}-${section?.id || sectionIndex}`}
                    section={section}
                    originalIndex={originalIndex}
                    sectionIndex={sectionIndex}
                    isRecommended={isRecommendedSection(section)}
                    isExpanded={expandedSections.has(originalIndex)}
                    loadingMenuItems={loadingMenuItems}
                    sectionItems={toRenderableArray(section?.items)}
                    sectionSubsections={toRenderableArray(section?.subsections)}
                    sectionImage={getSectionCategoryImage(section)}
                    itemCount={section?.itemCount ?? toRenderableArray(section?.items).length}
                    highlightedDishId={highlightedDishId}
                    shouldShowGrayscale={shouldShowGrayscale}
                    getSectionDisplayName={getSectionDisplayName}
                    getDishQuantity={getDishQuantity}
                    getFoodPriceLabel={getFoodPriceLabel}
                    onToggleExpand={(index) => {
                      setExpandedSections(prev => {
                        const newSet = new Set(prev)
                        if (newSet.has(index)) newSet.delete(index)
                        else newSet.add(index)
                        return newSet
                      })
                    }}
                    onItemClick={handleItemClick}
                    onUpdateQuantity={updateItemQuantity}
                    dishCardRefs={dishCardRefs}
                    toRenderableArray={toRenderableArray}
                  />
                ))}
                {loadingMoreMenu && (
                  <div className="flex justify-center items-center py-6 w-full">
                    <div className="animate-spin rounded-full h-8 w-8 border-[#16A34A] dark:border-[#15803D]"></div>
                    <span className="ml-3 text-sm text-gray-500">Loading more items...</span>
                  </div>
                )}
                {menuPagination.hasNextPage && (
                  <div
                    ref={menuLoadMoreRef}
                    className="h-1 w-full"
                    aria-hidden="true"
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <RestaurantFssaiBadge
        registrationNumber={getRestaurantFssaiNumber(restaurant)}
        logoSrc={getRestaurantFssaiImage(restaurant, BACKEND_ORIGIN)}
      />

      <FloatingMenuFab
        hidden={showFilterSheet || showMenuSheet || showMenuOptionsSheet}
        onClick={() => setShowMenuSheet(true)}
        hasCart={cart && cart.length > 0}
      />

      {/* Menu Categories Bottom Sheet - Rendered via Portal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showMenuSheet && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setShowMenuSheet(false)}
                />

                {/* Menu Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[85vh] md:max-h-[90vh] md:max-w-lg w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.2, type: "spring", damping: 30, stiffness: 400 }}
                  style={{ willChange: "transform" }}
                >
                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto px-4 py-6">
                    <div className="space-y-1">
                      {menuCategories.map((category, index) => (
                        <button
                          key={index}
                          className="w-full flex items-center justify-between py-3 px-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors text-left"
                          onClick={() => {
                            setShowMenuSheet(false)
                            // Scroll to category section
                            setTimeout(() => {
                              const sectionId = `menu-section-${category.sectionIndex}`
                              const sectionElement = document.getElementById(sectionId)
                              if (sectionElement) {
                                sectionElement.scrollIntoView({
                                  behavior: 'smooth',
                                  block: 'start'
                                })
                              }
                            }, 300) // Small delay to allow sheet to close
                          }}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {category.image ? (
                              <img
                                src={category.image}
                                alt={category.name}
                                className="h-10 w-10 rounded-xl object-cover border border-gray-200"
                                onError={(event) => {
                                  event.currentTarget.style.display = "none"
                                }}
                              />
                            ) : (
                              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-sm font-bold uppercase text-gray-500">
                                {category.name?.charAt(0) || "C"}
                              </span>
                            )}
                            <span className="text-base font-medium text-gray-900 dark:text-white truncate">
                              {category.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                              {category.count}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Close Button */}
                  <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-4 bg-white dark:bg-[#1a1a1a]">
                    <Button
                      className="w-full bg-[#16A34A] hover:bg-[#15803D] text-white border-0 flex items-center justify-center gap-2 py-6 rounded-xl font-bold transition-all shadow-lg text-sm"
                      onClick={() => setShowMenuSheet(false)}
                    >
                      <X className="h-4 w-4" />
                      Close
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Filters and Sorting Bottom Sheet - Rendered via Portal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showFilterSheet && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => setShowFilterSheet(false)}
                />

                {/* Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl shadow-2xl h-[80vh] md:h-auto md:max-h-[90vh] md:max-w-lg w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.2, type: "spring", damping: 30, stiffness: 400 }}
                  style={{ willChange: "transform" }}
                >
                  {/* Header with X button */}
                  <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-gray-200 dark:border-gray-800">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Filters and Sorting</h2>
                    <button
                      onClick={() => setShowFilterSheet(false)}
                      className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
                    >
                      <X className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                    </button>
                  </div>

                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                    {/* Sort by */}
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Sort by:</h3>
                      <div className="flex flex-col gap-1.5">
                        <button
                          onClick={() =>
                            setFilters((prev) => ({
                              ...prev,
                              sortBy: prev.sortBy === "low-to-high" ? null : "low-to-high",
                            }))
                          }
                          className={`text-left px-4 py-2.5 rounded-lg border-2 transition-all ${filters.sortBy === "low-to-high"
                            ? "border-[#16A34A] dark:border-green-500 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400"
                            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                            }`}
                        >
                          Price - low to high
                        </button>
                        <button
                          onClick={() =>
                            setFilters((prev) => ({
                              ...prev,
                              sortBy: prev.sortBy === "high-to-low" ? null : "high-to-low",
                            }))
                          }
                          className={`text-left px-4 py-2.5 rounded-lg border-2 transition-all ${filters.sortBy === "high-to-low"
                            ? "border-[#16A34A] dark:border-green-500 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400"
                            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                            }`}
                        >
                          Price - high to low
                        </button>
                      </div>
                    </div>

                    {/* Veg/Non-veg preference */}
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Veg/Non-veg preference:</h3>
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            setFilters((prev) => ({
                              ...prev,
                              vegNonVeg: prev.vegNonVeg === "veg" ? null : "veg",
                            }))
                          }
                          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 transition-all flex-1 ${filters.vegNonVeg === "veg"
                            ? "border-green-600 dark:border-green-500 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                            }`}
                        >
                          <div className="h-4 w-4 rounded-full bg-green-600 dark:bg-green-500" />
                          <span className="font-medium">Veg</span>
                        </button>
                        <button
                          onClick={() =>
                            setFilters((prev) => ({
                              ...prev,
                              vegNonVeg: prev.vegNonVeg === "non-veg" ? null : "non-veg",
                            }))
                          }
                          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 transition-all flex-1 ${filters.vegNonVeg === "non-veg"
                            ? "border-red-600 dark:border-red-600 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-gray-300"
                            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                            }`}
                        >
                          <div className="h-4 w-4 rounded-full bg-red-600" />
                          <span className="font-medium">Non-veg</span>
                        </button>
                      </div>
                    </div>

                    {/* Top picks */}
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Top picks:</h3>
                      <button
                        onClick={() =>
                          setFilters((prev) => ({
                            ...prev,
                            highlyReordered: !prev.highlyReordered,
                          }))
                        }
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 transition-all w-full ${filters.highlyReordered
                          ? "border-[#16A34A] dark:border-[#16A34A] bg-green-50 dark:bg-green-950/30 text-[#16A34A] dark:text-green-400"
                          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                          }`}
                      >
                        <RotateCcw className="h-4 w-4" />
                        <span className="font-medium">Highly reordered</span>
                      </button>
                    </div>

                    {/* Dietary preference */}
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Dietary preference:</h3>
                      <button
                        onClick={() =>
                          setFilters((prev) => ({
                            ...prev,
                            spicy: !prev.spicy,
                          }))
                        }
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 transition-all w-full ${filters.spicy
                          ? "border-red-500 dark:border-red-400 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                          }`}
                      >
                        <Flame className="h-4 w-4" />
                        <span className="font-medium">Spicy</span>
                      </button>
                    </div>
                  </div>

                  {/* Bottom Action Bar */}
                  <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between bg-white dark:bg-[#1a1a1a]">
                    <button
                      onClick={() => {
                        setFilters({
                          sortBy: null,
                          vegNonVeg: null,
                          highlyReordered: false,
                          spicy: false,
                        })
                      }}
                      className="text-red-600 dark:text-red-400 font-medium text-sm hover:text-red-700 dark:hover:text-red-500"
                    >
                      Clear All
                    </button>
                    <Button
                      className="bg-[#16A34A] hover:bg-[#15803D] text-white px-6 py-2.5 rounded-lg font-bold"
                      onClick={() => setShowFilterSheet(false)}
                    >
                      Apply {activeFilterCount > 0 && `(${activeFilterCount})`}
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Location Outlets Bottom Sheet - Rendered via Portal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showLocationSheet && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setShowLocationSheet(false)}
                />

                {/* Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl shadow-2xl h-[75vh] md:h-auto md:max-h-[90vh] md:max-w-xl w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.2, type: "spring", damping: 30, stiffness: 400 }}
                  style={{ willChange: "transform" }}
                >
                  {/* Header */}
                  <div className="px-4 pt-4 pb-3 border-b border-gray-200 dark:border-gray-800">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">All delivery outlets for</p>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-red-600 dark:bg-red-500 rounded-lg flex items-center justify-center">
                        <span className="text-white font-bold text-base">{(restaurant.name || "R").charAt(0).toUpperCase()}</span>
                      </div>
                      <h2 className="text-lg font-bold text-gray-900 dark:text-white">{restaurant?.name || "Unknown Restaurant"}</h2>
                    </div>
                  </div>

                  {/* Outlets List */}
                  <div className="flex-1 overflow-y-auto px-4 py-3">
                    {restaurant?.outlets && Array.isArray(restaurant.outlets) && restaurant.outlets.length > 0 ? (
                      <div className="space-y-2">
                        {restaurant.outlets.map((outlet) => (
                          <div
                            key={outlet?.id || Math.random()}
                            className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a]"
                          >
                            {outlet?.isNearest && (
                              <div className="flex items-center gap-1.5 mb-2 px-2 py-1 bg-green-50 dark:bg-green-950/30 rounded-md">
                                <Zap className="h-3.5 w-3.5 text-[#16A34A] dark:text-green-400 fill-[#16A34A] dark:fill-green-400" />
                                <span className="text-xs font-semibold text-[#16A34A] dark:text-green-400">
                                  Nearest available outlet
                                </span>
                              </div>
                            )}
                            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                              {outlet?.location || "Location"}
                            </h3>
                            <div className="flex items-center justify-between gap-4">
                              <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-gray-400">
                                <div className="flex items-center gap-1">
                                  <Clock className="h-3.5 w-3.5" />
                                  <span>{outlet?.deliveryTime || "25-30 mins"}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <MapPin className="h-3.5 w-3.5" />
                                  <span>{outlet?.distance || "1.2 km"}</span>
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-0.5">
                                <div className="flex items-center gap-1">
                                  <Star className="h-3.5 w-3.5 text-[#8CC63F] dark:text-green-500 fill-[#8CC63F] dark:fill-green-500" />
                                  <span className="text-xs font-medium text-gray-900 dark:text-white">
                                    {outlet?.rating || 4.5}
                                  </span>
                                </div>
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  By {(outlet?.reviews || 0) >= 1000 ? `${((outlet.reviews || 0) / 1000).toFixed(1)}K+` : `${outlet?.reviews || 0}+`}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                        No outlets available
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  {restaurant?.outlets && Array.isArray(restaurant.outlets) && restaurant.outlets.length > 5 && (
                    <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-3 bg-white dark:bg-[#1a1a1a]">
                      <button className="flex items-center justify-center gap-2 text-red-600 dark:text-red-400 font-medium text-sm w-full">
                        <span>See all {restaurant.outlets.length} outlets</span>
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Manage Collections Modal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showManageCollections && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setShowManageCollections(false)}
                />

                {/* Manage Collections Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl shadow-2xl md:max-w-lg w-full md:w-auto"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.2, type: "spring", damping: 30, stiffness: 400 }}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 pt-6 pb-4 border-b border-gray-200 dark:border-gray-800">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Manage Collections</h2>
                    <button
                      onClick={() => setShowManageCollections(false)}
                      className="h-8 w-8 rounded-full bg-gray-700 dark:bg-gray-600 flex items-center justify-center hover:bg-gray-800 dark:hover:bg-gray-700 transition-colors"
                    >
                      <X className="h-4 w-4 text-white" />
                    </button>
                  </div>

                  {/* Collections List */}
                  <div className="px-4 py-4 space-y-2">
                    {/* Bookmarks Collection */}
                    <button
                      className="w-full flex items-start gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
                      onClick={(e) => {
                        e.stopPropagation()
                        // Don't close modal on click, let checkbox handle it
                      }}
                    >
                      <div className="h-12 w-12 rounded-lg bg-pink-100 dark:bg-pink-900/30 flex items-center justify-center flex-shrink-0">
                        <Bookmark className="h-6 w-6 text-red-500 dark:text-red-400 fill-red-500 dark:fill-red-400" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="flex items-center justify-between">
                          <span className="text-base font-medium text-gray-900 dark:text-white">Bookmarks</span>
                          {selectedItem && (
                            <Checkbox
                              checked={isDishFavorite(selectedItem.id, restaurant?.restaurantId || restaurant?._id || restaurant?.id)}
                              onCheckedChange={(checked) => {
                                if (!checked && selectedItem) {
                                  const restaurantId = restaurant?.restaurantId || restaurant?._id || restaurant?.id
                                  removeDishFavorite(selectedItem.id, restaurantId)
                                  setShowManageCollections(false)
                                }
                              }}
                              className="h-5 w-5 rounded border-2 border-red-500 data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500"
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
                          {!selectedItem && (
                            <div className="h-5 w-5 rounded border-2 border-red-500 bg-red-500 flex items-center justify-center">
                              <Check className="h-3 w-3 text-white" />
                            </div>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                          {getDishFavorites().length} dishes � {getFavorites().length} restaurant
                        </p>
                      </div>
                    </button>

                    {/* Create new Collection */}
                    <button
                      className="w-full flex items-start gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
                      onClick={() => setShowManageCollections(false)}
                    >
                      <div className="h-12 w-12 rounded-lg bg-pink-100 dark:bg-pink-900/30 flex items-center justify-center flex-shrink-0">
                        <Plus className="h-6 w-6 text-red-500 dark:text-red-400" />
                      </div>
                      <div className="flex-1 text-left">
                        <span className="text-base font-medium text-gray-900 dark:text-white">
                          Create new Collection
                        </span>
                      </div>
                    </button>
                  </div>

                  {/* Done Button */}
                  <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-4">
                    <Button
                      className="w-full bg-[#16A34A] hover:bg-[#15803D] text-white py-3 rounded-lg font-bold"
                      onClick={() => {
                        setShowManageCollections(false)
                      }}
                    >
                      Done
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Item Detail Modal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showItemDetail && selectedItem && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setShowItemDetail(false)}
                />

                {/* Item Detail Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[90vh] md:max-w-2xl lg:max-w-3xl w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.15, type: "spring", damping: 30, stiffness: 400 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Close Button - Top Center Above Popup with 4px gap */}
                  <div className="absolute -top-[44px] left-1/2 -translate-x-1/2 z-[10001]">
                    <motion.button
                      onClick={() => setShowItemDetail(false)}
                      className="h-10 w-10 rounded-full bg-gray-800 flex items-center justify-center hover:bg-gray-900 transition-colors shadow-lg"
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                    >
                      <X className="h-5 w-5 text-white" />
                    </motion.button>
                  </div>

                  {/* Image Section */}
                  <div className="relative w-full h-48 overflow-hidden rounded-t-2xl">
                    {selectedItem.image ? (
                      <img
                        src={selectedItem.image}
                        alt={selectedItem.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                        <span className="text-sm text-gray-400">No image available</span>
                      </div>
                    )}
                    {/* Bookmark and Share Icons Overlay */}
                    <div className="absolute bottom-4 right-4 flex items-center gap-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleBookmarkClick(selectedItem)
                        }}
                        className={`h-10 w-10 rounded-full border flex items-center justify-center transition-all duration-300 ${isDishFavorite(selectedItem.id, restaurant?.restaurantId || restaurant?._id || restaurant?.id)
                          ? "border-red-500 dark:border-red-400 bg-red-50 dark:bg-red-900/30 text-red-500 dark:text-red-400"
                          : "border-white dark:border-gray-800 bg-white/90 dark:bg-[#1a1a1a]/90 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-[#2a2a2a]"
                          }`}
                      >
                        <Bookmark
                          className={`h-5 w-5 transition-all duration-300 ${isDishFavorite(selectedItem.id, restaurant?.restaurantId || restaurant?._id || restaurant?.id) ? "fill-red-500 dark:fill-red-400" : ""
                            }`}
                        />
                      </button>
                      <button className="h-10 w-10 rounded-full border border-white dark:border-gray-800 bg-white/90 dark:bg-[#1a1a1a]/90 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-[#2a2a2a] flex items-center justify-center transition-colors">
                        <Share2 className="h-5 w-5" />
                      </button>
                    </div>
                  </div>

                  {/* Content Section */}
                  <div className="flex-1 overflow-y-auto px-3 py-3">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <div className={`h-4 w-4 rounded border-2 ${selectedItem.foodType === "Veg" ? "border-green-600 bg-green-50" : "border-red-600 bg-red-50"} dark:border-gray-600 dark:bg-gray-900/30 flex items-center justify-center flex-shrink-0`}>
                          <div className={`h-2 w-2 rounded-full ${selectedItem.foodType === "Veg" ? "bg-green-600" : "bg-red-600"}`} />
                        </div>
                        <h2 className="text-base font-semibold text-gray-900 dark:text-white leading-tight">
                          {selectedItem.name}
                        </h2>
                      </div>
                    </div>

                    {selectedItem.description ? (
                      <p className="text-xs text-gray-600 dark:text-gray-400 mb-2 leading-snug line-clamp-3">
                        {selectedItem.description}
                      </p>
                    ) : null}

                    {/* Highly Reordered Progress Bar */}
                    {isRecommendedItem(selectedItem) && (
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex-1 h-0.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div className="h-full bg-green-500 dark:bg-green-400 rounded-full" style={{ width: '50%' }} />
                        </div>
                        <span className="text-xs text-gray-600 dark:text-gray-400 font-medium whitespace-nowrap">
                          highly reordered
                        </span>
                      </div>
                    )}

                    {/* Not Eligible for Coupons */}
                    {selectedItem.notEligibleForCoupons && (
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium mb-2">
                        NOT ELIGIBLE FOR COUPONS
                      </p>
                    )}

                    {hasFoodVariants(selectedItem) && (
                      <div className="mb-2">
                        <p className="text-xs font-semibold text-gray-900 dark:text-white mb-1.5">Choose a variant</p>
                        <div className="flex flex-wrap gap-1.5">
                          {getFoodVariants(selectedItem).map((variant) => (
                            <button
                              key={variant.id}
                              type="button"
                              onClick={() => setSelectedVariantId(variant.id)}
                              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${String(selectedVariantId || "") === String(variant.id)
                                  ? "border-red-500 bg-red-50 text-red-600 dark:border-red-400 dark:bg-red-900/30 dark:text-red-200"
                                  : "border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-[#2a2a2a] dark:text-gray-300"
                                }`}
                            >
                              {variant.name} · {RUPEE_SYMBOL}{Math.round(variant.price)}{variant.unit ? ` / ${variant.unit}` : ''}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Bottom Action Bar */}
                  <div className="border-t border-gray-200 dark:border-gray-800 px-3 py-3 bg-white dark:bg-[#1a1a1a]">
                    <div className="flex items-center gap-2.5">
                      <div className={`flex items-center gap-2 border rounded-lg px-2.5 h-10 bg-white dark:bg-[#2a2a2a] ${shouldShowGrayscale
                        ? 'border-gray-300 dark:border-gray-700 opacity-50'
                        : 'border-gray-300 dark:border-gray-700'
                        }`}>
                        <button
                          onClick={(e) => {
                            if (!shouldShowGrayscale) {
                              updateItemQuantity(
                                selectedItem,
                                Math.max(0, getDishQuantity(selectedItem, selectedVariantId) - 1),
                                e,
                                getVariantForDish(selectedItem, selectedVariantId),
                              )
                            }
                          }}
                          disabled={getDishQuantity(selectedItem, selectedVariantId) === 0 || shouldShowGrayscale}
                          className={`${shouldShowGrayscale
                            ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed'
                            }`}
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className={`text-sm font-semibold min-w-[1.5rem] text-center ${shouldShowGrayscale
                          ? 'text-gray-400 dark:text-gray-600'
                          : 'text-gray-900 dark:text-white'
                          }`}>
                          {getDishQuantity(selectedItem, selectedVariantId)}
                        </span>
                        <button
                          onClick={(e) => {
                            if (!shouldShowGrayscale) {
                              updateItemQuantity(
                                selectedItem,
                                getDishQuantity(selectedItem, selectedVariantId) + 1,
                                e,
                                getVariantForDish(selectedItem, selectedVariantId),
                              )
                            }
                          }}
                          disabled={shouldShowGrayscale}
                          className={shouldShowGrayscale
                            ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                          }
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>

                      <Button
                        className={`flex-1 h-10 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 ${shouldShowGrayscale
                          ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-600 cursor-not-allowed opacity-50'
                          : 'bg-[#16A34A] hover:bg-[#15803D] text-white'
                          }`}
                        onClick={(e) => {
                          if (!shouldShowGrayscale) {
                            updateItemQuantity(
                              selectedItem,
                              getDishQuantity(selectedItem, selectedVariantId) + 1,
                              e,
                              getVariantForDish(selectedItem, selectedVariantId),
                            )
                            setShowItemDetail(false)
                          }
                        }}
                        disabled={shouldShowGrayscale}
                      >
                        <span>Add item</span>
                        <div className="flex items-center gap-1">
                          {selectedItem.originalPrice && selectedItem.originalPrice > selectedItem.price && (
                            <span className="text-sm line-through text-red-200">
                              {RUPEE_SYMBOL}{Math.round(selectedItem.originalPrice)}
                            </span>
                          )}
                          <span className="text-base font-bold">
                            {hasFoodVariants(selectedItem)
                              ? `${getVariantForDish(selectedItem, selectedVariantId)?.name || "Default"} · ${RUPEE_SYMBOL}${Math.round(getVariantForDish(selectedItem, selectedVariantId)?.price || selectedItem.price)}`
                              : `${RUPEE_SYMBOL}${Math.round(selectedItem.price)}`}
                          </span>
                        </div>
                      </Button>
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Schedule Delivery Time Modal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showScheduleSheet && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setShowScheduleSheet(false)}
                />

                {/* Schedule Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[60vh] md:max-h-[90vh] md:max-w-lg w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.15, type: "spring", damping: 30, stiffness: 400 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Close Button - Centered Overlapping */}
                  <div className="absolute -top-5 left-1/2 -translate-x-1/2 z-10">
                    <button
                      onClick={() => setShowScheduleSheet(false)}
                      className="h-10 w-10 rounded-full bg-gray-800 flex items-center justify-center hover:bg-gray-900 transition-colors shadow-lg"
                    >
                      <X className="h-5 w-5 text-white" />
                    </button>
                  </div>

                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto px-4 pt-10 pb-4">
                    {/* Title */}
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4 text-center">
                      Select your delivery time
                    </h2>

                    {/* Date Selection */}
                    <div className="flex items-center gap-3 mb-4 overflow-x-auto pb-2 scrollbar-hide">
                      {(() => {
                        const today = new Date()
                        const tomorrow = new Date(today)
                        tomorrow.setDate(tomorrow.getDate() + 1)
                        const dayAfter = new Date(today)
                        dayAfter.setDate(dayAfter.getDate() + 2)

                        const dates = [
                          { date: today, label: "Today" },
                          { date: tomorrow, label: "Tomorrow" },
                          { date: dayAfter, label: dayAfter.toLocaleDateString('en-US', { weekday: 'short' }) }
                        ]

                        return dates.map((item, index) => {
                          const dateStr = item.date.toISOString().split('T')[0]
                          const day = String(item.date.getDate()).padStart(2, '0')
                          const month = item.date.toLocaleDateString('en-US', { month: 'short' })
                          const isSelected = selectedDate === dateStr

                          return (
                            <button
                              key={index}
                              onClick={() => setSelectedDate(dateStr)}
                              className="flex flex-col items-center gap-0.5 flex-shrink-0 pb-1"
                            >
                              <span className={`text-sm font-medium ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                                {day} {month} {item.label}
                              </span>
                              {isSelected && (
                                <div className="h-0.5 w-full bg-red-500 mt-0.5" />
                              )}
                            </button>
                          )
                        })
                      })()}
                    </div>

                    {/* Time Slot Selection */}
                    <div className="space-y-2 mb-4">
                      {availableTimeSlots.length > 0 ? (
                        availableTimeSlots.map((slot, index) => {
                          const isSelected = selectedTimeSlot === slot.value
                          return (
                            <button
                              key={index}
                              onClick={() => setSelectedTimeSlot(slot.value)}
                              className={`w-full text-left px-4 py-2.5 rounded-lg transition-all ${isSelected
                                ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600"
                                : "bg-white dark:bg-[#2a2a2a] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 border border-transparent"
                                }`}
                            >
                              <span className="text-sm font-medium">{slot.label}</span>
                            </button>
                          )
                        })
                      ) : (
                        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                          No delivery slots available for this date.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Confirm Button - Fixed at bottom */}
                  <div className="px-4 pb-4 pt-2 border-t border-gray-100">
                    <Button
                      className="w-full bg-[#16A34A] hover:bg-[#15803D] text-white py-3 rounded-xl font-semibold"
                      onClick={() => {
                        if (selectedDate && selectedTimeSlot) {
                          localStorage.setItem('scheduled_order_time', JSON.stringify({
                            isScheduled: true,
                            date: selectedDate,
                            time: selectedTimeSlot
                          }))
                          toast.success(`Delivery scheduled for ${selectedDate} at ${selectedTimeSlot}`)
                        }
                        setShowScheduleSheet(false)
                      }}
                    >
                      Confirm
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Offers Bottom Sheet - Rendered via Portal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showOffersSheet && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => setShowOffersSheet(false)}
                />

                {/* Offers Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[85vh] md:max-h-[90vh] md:max-w-lg w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.2, type: "spring", damping: 30, stiffness: 400 }}
                  style={{ willChange: "transform" }}
                >
                  {/* Header */}
                  <div className="px-4 pt-6 pb-4 border-b border-gray-200 dark:border-gray-800">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                      Offers at {restaurant?.name || "Unknown Restaurant"}
                    </h2>
                  </div>

                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto px-4 py-4">
                    {/* Gold Exclusive Offer Section */}
                    {restaurant?.restaurantOffers?.goldOffer && (
                      <div className="mb-6">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                          {restaurant.restaurantOffers.goldOffer?.title || "Gold exclusive offer"}
                        </h3>
                        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 flex items-start justify-between gap-4 border border-gray-100 dark:border-gray-700 shadow-md">
                          <div className="flex items-start gap-3 flex-1">
                            <Lock className="h-5 w-5 text-yellow-600 dark:text-yellow-500 flex-shrink-0 mt-0.5" />
                            <div className="flex-1">
                              <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                                {restaurant.restaurantOffers.goldOffer?.description || "Free delivery above ₹99"}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {restaurant.restaurantOffers.goldOffer?.unlockText || "join Gold to unlock"}
                              </p>
                            </div>
                          </div>
                          <Button
                            className="bg-red-500 hover:bg-red-600 text-white text-sm px-4 py-2 rounded-lg whitespace-nowrap"
                            onClick={() => {
                              // Handle add gold
                            }}
                          >
                            {restaurant.restaurantOffers.goldOffer?.buttonText || "Add Gold - ₹1"}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Available Offers */}
                    {pageCoupons.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                          Available Offers
                          {pageCouponsSource === "restaurant" ? "" : pageCouponsSource === "admin" ? " (Platform)" : ""}
                        </h3>
                        <div className="space-y-3">
                          {pageCoupons.map((coupon, couponIndex) => {
                            const couponKey = coupon?.id || coupon?.code || `coupon-${couponIndex}`
                            const isExpanded = expandedCoupons.has(couponKey)
                            const isFreeDel = coupon?.isFreeDelivery || coupon?.couponCategory === "free_delivery"
                            return (
                              <div
                                key={couponKey}
                                className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden shadow-sm"
                              >
                                <button
                                  className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                  onClick={() => {
                                    setExpandedCoupons((prev) => {
                                      const newSet = new Set(prev)
                                      if (newSet.has(couponKey)) {
                                        newSet.delete(couponKey)
                                      } else {
                                        newSet.add(couponKey)
                                      }
                                      return newSet
                                    })
                                  }}
                                >
                                  <Percent className={`h-5 w-5 flex-shrink-0 ${isFreeDel ? "text-green-600 dark:text-green-400" : "text-blue-600 dark:text-blue-400"}`} />
                                  <div className="flex-1 text-left">
                                    <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                                      {coupon?.title || (isFreeDel ? "FREE DELIVERY" : "Offer")}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                      {coupon?.subtitle || (coupon?.minOrderValue > 0 ? `Minimum ₹${coupon.minOrderValue}` : "Use code below")}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      className="px-3 py-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-medium rounded"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        const code = coupon?.code || coupon?.couponCode
                                        if (code) {
                                          navigator.clipboard.writeText(code)
                                          toast.success("Coupon copied")
                                        }
                                      }}
                                    >
                                      {coupon?.code || coupon?.couponCode || "Copy"}
                                    </button>
                                    <ChevronDown
                                      className={`h-4 w-4 text-gray-500 dark:text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""
                                        }`}
                                    />
                                  </div>
                                </button>
                                {isExpanded && (
                                  <div className="px-4 pb-4 pt-2 border-t border-gray-100 dark:border-gray-800">
                                    <p className="text-xs text-gray-600 dark:text-gray-400">
                                      Terms and conditions apply
                                    </p>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Close Button */}
                  <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-4 bg-white dark:bg-[#1a1a1a]">
                    <Button
                      className="w-full bg-[#16A34A] hover:bg-[#15803D] text-white border-0 flex items-center justify-center gap-2 py-6 rounded-xl font-bold transition-all shadow-lg text-sm"
                      onClick={() => setShowOffersSheet(false)}
                    >
                      <X className="h-4 w-4" />
                      Close
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Menu Options Bottom Sheet - Rendered via Portal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showMenuOptionsSheet && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => setShowMenuOptionsSheet(false)}
                />

                {/* Menu Options Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[70vh] md:max-h-[90vh] md:max-w-lg w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.2, type: "spring", damping: 30, stiffness: 400 }}
                  style={{ willChange: "transform" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Header */}
                  <div className="px-4 pt-6 pb-4 border-b border-gray-200 dark:border-gray-800">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                      {restaurant?.name || "Unknown Restaurant"}
                    </h2>
                  </div>

                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto px-4 py-4">
                    {/* Menu Options List */}
                    <div className="space-y-1">
                      {/* Add to Collection */}
                      <button
                        className="w-full flex items-center gap-4 px-2 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors text-left"
                        onClick={handleAddToCollection}
                      >
                        <Bookmark className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                        <span className="text-base text-gray-900 dark:text-white">
                          {isFavorite(restaurant?.slug || slug || "") ? "Remove from Collection" : "Add to Collection"}
                        </span>
                      </button>

                      {/* Share this restaurant */}
                      <button
                        className="w-full flex items-center gap-4 px-2 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors text-left"
                        onClick={handleShareRestaurant}
                      >
                        <Share2 className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                        <span className="text-base text-gray-900 dark:text-white">Share this restaurant</span>
                      </button>

                    </div>

                    {/* Disclaimer Text */}
                    <div className="mt-6 px-2">
                      <p className="text-xs text-gray-500 leading-relaxed">
                        Menu items, prices, photos and descriptions are set directly by the restaurant. In case you see any incorrect information, please report it to us.
                      </p>
                    </div>

                    {/* FSSAI License Information */}
                    {getRestaurantFssaiNumber(restaurant) && (
                      <div className="mt-4 px-2 pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center gap-3 opacity-80 mb-2">
                        <div className="h-8 w-14 flex items-center justify-center bg-white rounded p-1 border border-gray-100">
                          <FssaiLogoImage
                            src={getRestaurantFssaiImage(restaurant, BACKEND_ORIGIN)}
                          />
                        </div>
                        <div className="flex-1">
                          <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide font-medium">
                            Lic. No.
                          </p>
                          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                            {getRestaurantFssaiNumber(restaurant)}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Bottom Handle */}
                  <div className="px-4 pb-2 pt-2 flex justify-center">
                    <div className="h-1 w-12 bg-gray-300 rounded-full" />
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

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

      {/* Add to Cart Animation Component - Rendered via Portal to prevent transform interference */}
      {typeof window !== "undefined" &&
        createPortal(
          <AddToCartAnimation
            bottomOffset={80}
            linkTo="/food/user/cart"
            hideOnPages={true}
          />,
          document.body
        )}
    </AnimatedPage>
  )
}

class RestaurantDetailsErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    debugError("RestaurantDetails crashed:", error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <AnimatedPage>
          <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
            <div className="flex flex-col items-center gap-4 text-center">
              <AlertCircle className="h-12 w-12 text-red-500" />
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                  Something went wrong
                </h2>
                <p className="text-sm text-gray-600 mb-4 max-w-md">
                  We could not load this restaurant page right now.
                </p>
                <Button onClick={() => window.location.reload()} variant="outline">
                  Reload Page
                </Button>
              </div>
            </div>
          </div>
        </AnimatedPage>
      )
    }

    return this.props.children
  }
}

export default function RestaurantDetails() {
  return (
    <RestaurantDetailsErrorBoundary>
      <RestaurantDetailsContent />
    </RestaurantDetailsErrorBoundary>
  )
}

