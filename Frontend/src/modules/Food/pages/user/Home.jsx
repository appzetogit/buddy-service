import { useSearchParams, Link, useNavigate } from "react-router-dom";
import React, {
  useRef,
  useEffect,
  useState,
  useMemo,
  useCallback,
  startTransition,
} from "react";
import { createPortal } from "react-dom";
import {
  Star,
  Clock,
  MapPin,
  Heart,
  Search,
  Tag,
  Flame,
  ShoppingBag,
  ShoppingCart,
  Mic,
  SlidersHorizontal,
  CheckCircle2,
  Bookmark,
  BadgePercent,
  X,
  ArrowDownUp,
  Timer,
  CalendarClock,
  ShieldCheck,
  IndianRupee,
  UtensilsCrossed,
  Leaf,
  AlertCircle,
  ArrowRight,
  Loader2,
  Plus,
  Check,
  Sparkles,
  Share2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Footer from "@food/components/user/Footer";
import AddToCartButton from "@food/components/user/AddToCartButton";
import StickyCartCard from "@food/components/user/StickyCartCard";
import RestaurantChainDistanceBadge from "@food/components/user/RestaurantChainDistanceBadge";
import { getFirstRestaurantFromCart } from "@food/utils/restaurantRadius";
import OrderTrackingCard from "@food/components/user/OrderTrackingCard";
import VegModePopups from "@food/components/user/VegModePopups";
import {
  CategoryChipRowSkeleton,
  ExploreGridSkeleton,
  HeroBannerSkeleton,
  LoadingSkeletonRegion,
  RestaurantGridSkeleton,
} from "@food/components/ui/loading-skeletons";
import { useProfile } from "@food/context/ProfileContext";
import { useCart } from "@food/context/CartContext";
import { HorizontalCarousel } from "@food/components/ui/horizontal-carousel";
import { DotPattern } from "@food/components/ui/dot-pattern";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@food/components/ui/card";
import { Button } from "@food/components/ui/button";
import { Badge } from "@food/components/ui/badge";
import { Input } from "@food/components/ui/input";
import { Switch } from "@food/components/ui/switch";
import { Checkbox } from "@food/components/ui/checkbox";
import {
  useSearchOverlay,
  useLocationSelector,
} from "@food/components/user/UserLayout";

const debugLog = (...args) => { };
const debugWarn = (...args) => { };
const debugError = (...args) => { };

// Import shared food images - prevents duplication
import { foodImages } from "@food/constants/images";

import { Avatar, AvatarFallback } from "@food/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@food/components/ui/dropdown-menu";
import { useZone } from "@food/hooks/useZone";
import { useLocation } from "@food/hooks/useLocation";
import useEffectiveDeliveryLocation from "@food/hooks/useEffectiveDeliveryLocation";
import offerImage from "@food/assets/offerimage.png";
import api, { publicGetOnce, restaurantAPI, adminAPI } from "@food/api";
import { fetchRestaurantMenuCached } from "@food/utils/restaurantMenuCache";
import { fetchRestaurantsCached } from "@food/utils/restaurantListCache";
import {
  buildRestaurantListParams,
  buildRestaurantListQueryKey,
  extractRestaurantListItems,
  HOME_RESTAURANTS_PAGE_SIZE,
  resolveUserListCity,
} from "@food/utils/restaurantListParams";
import { extractPagination } from "@food/utils/pagination";
import {
  recalculateRestaurantDistances,
  sortRestaurantsForDisplay,
  transformRestaurantApiList,
} from "@food/utils/transformHomeRestaurantPage";
import { useInfinitePagination } from "@food/hooks/useInfinitePagination";
import { API_BASE_URL } from "@food/api/config";
import OptimizedImage from "@food/components/OptimizedImage";
import { getRestaurantAvailabilityStatus } from "@food/utils/restaurantAvailability";
import {
  formatRestaurantRating,
  getRestaurantAddressLine,
  hasDisplayableRestaurantRating,
  resolveRestaurantDistance,
} from "@food/utils/restaurantDisplay";
import HomeHeader from "@food/components/user/home/HomeHeader";
import HomeDesktopShell from "@food/components/user/home/HomeDesktopShell";
import HomeMobileHero from "@food/components/user/home/HomeMobileHero";
import HomeMobileCategories from "@food/components/user/home/HomeMobileCategories";
import HomeMobileStickyBar from "@food/components/user/home/HomeMobileStickyBar";
import PromoRow from "@food/components/user/home/PromoRow";
import "@food/styles/landing.css";


// Banner images for hero carousel - will be fetched from API

// Animated placeholder for search - moved outside component to prevent recreation
const placeholders = [
  'Search "burger"',
  'Search "biryani"',
  'Search "pizza"',
  'Search "desserts"',
  'Search "chinese"',
  'Search "thali"',
  'Search "momos"',
  'Search "dosa"',
];

const HERO_TEXT_SLIDES = [
  {
    id: "premium",
    heading: "Flat ₹150 OFF",
    sub: "on Premium Dining restaurants",
    cta: "Explore now",
    badge: "Premium",
    section: "bg-gradient-to-br from-[#ACC8A2] to-[#8FA986]",
    theme: {
      text: "text-[#1A2517]",
      sub: "text-[#1A2517]/80",
      button: "bg-[#1A2517] text-white",
      badge: "bg-white/90 text-[#1A2517]",
      dotActive: "bg-[#1A2517]",
      dotInactive: "bg-[#1A2517]/30",
      icon: "text-[#1A2517]",
      iconBorder: "border-[#1A2517]/30",
    },
  },
  {
    id: "store",
    heading: "50% Cashback",
    sub: "Fresh essentials delivered fast",
    cta: "Order Store",
    badge: "Limited",
    section: "bg-gradient-to-br from-[#9CB892] to-[#809C76]",
    theme: {
      text: "text-[#1A2517]",
      sub: "text-[#1A2517]/80",
      button: "bg-[#1A2517] text-white",
      badge: "bg-white/90 text-[#1A2517]",
      dotActive: "bg-[#1A2517]",
      dotInactive: "bg-[#1A2517]/30",
      icon: "text-[#1A2517]",
      iconBorder: "border-[#1A2517]/30",
    },
  },
  {
    id: "delivery",
    heading: "Free Delivery",
    sub: "No delivery fee on all orders",
    cta: "Claim now",
    badge: "Special",
    section: "bg-gradient-to-br from-[#B5D2AA] to-[#99B68F]",
    theme: {
      text: "text-[#1A2517]",
      sub: "text-[#1A2517]/80",
      button: "bg-[#1A2517] text-white",
      badge: "bg-white/90 text-[#1A2517]",
      dotActive: "bg-[#1A2517]",
      dotInactive: "bg-[#1A2517]/30",
      icon: "text-[#1A2517]",
      iconBorder: "border-[#1A2517]/30",
    },
  },
];

const WEBVIEW_SESSION_CACHE_BUSTER = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getRestaurantDisplayName = (restaurant) => {
  const nameCandidates = [
    restaurant?.name,
    restaurant?.restaurantName,
    restaurant?.restaurantName?.english,
    restaurant?.restaurantName?.value,
    restaurant?.onboarding?.step1?.restaurantName,
  ];
  const resolvedName = nameCandidates.find(
    (candidate) =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );
  return resolvedName ? resolvedName.trim() : "Restaurant";
};

// Restaurant Image Carousel Component
const RestaurantImageCarousel = React.memo(
  ({
    restaurant,
    priority = false,
    backendOrigin = "",
    className = "h-48 sm:h-56 md:h-60 lg:h-64 xl:h-72",
    roundedClass = "rounded-t-md",
  }) => {
    const webviewSessionKeyRef = useRef(WEBVIEW_SESSION_CACHE_BUSTER);
    const imageElementRef = useRef(null);

    const withCacheBuster = useCallback(
      (url) => {
        if (typeof url !== "string" || !url) return "";
        if (/^data:/i.test(url) || /^blob:/i.test(url)) return url;

        // Resolve relative URLs (e.g. /uploads/...) so they load on mobile when backend is different from frontend.
        const isRelative = !/^(https?:|\/\/|data:|blob:)/i.test(url.trim());
        const resolvedUrl =
          backendOrigin && isRelative
            ? `${backendOrigin.replace(/\/$/, "")}${url.startsWith("/") ? url : `/${url}`}`
            : url;

        // Do not mutate signed URLs (legacy S3/Cloudfront/Firebase links can break if query changes).
        const hasSignedParams =
          /[?&](X-Amz-|Signature=|Expires=|AWSAccessKeyId=|GoogleAccessId=|token=|sig=|se=|sp=|sv=)/i.test(
            resolvedUrl,
          );
        if (hasSignedParams) return resolvedUrl;

        try {
          const parsed = new URL(resolvedUrl, window.location.origin);

          // Apply cache-buster only to app/backend-hosted URLs to avoid third-party CDN signature issues.
          const currentHost =
            typeof window !== "undefined" ? window.location.hostname : "";
          const isLocalHost = /^(localhost|127\.0\.0\.1)$/i.test(
            parsed.hostname,
          );
          const isSameHost = currentHost && parsed.hostname === currentHost;

          if (isLocalHost || isSameHost) {
            parsed.searchParams.set("_wv", webviewSessionKeyRef.current);
          }
          return parsed.toString();
        } catch {
          return resolvedUrl;
        }
      },
      [backendOrigin],
    );

    const images = useMemo(() => {
      const sourceImages =
        Array.isArray(restaurant.images) && restaurant.images.length > 0
          ? restaurant.images
          : [restaurant.image];

      const validImages = sourceImages
        .filter((img) => typeof img === "string")
        .map((img) => img.trim())
        .filter(Boolean);

      return validImages.map((img) => withCacheBuster(img));
    }, [restaurant.images, restaurant.image, withCacheBuster]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loadedBySrc, setLoadedBySrc] = useState({});
    const [, setAttemptedSrcs] = useState({});
    const [isImageUnavailable, setIsImageUnavailable] = useState(false);
    const [showShimmer, setShowShimmer] = useState(true);
    const [lastGoodSrc, setLastGoodSrc] = useState("");
    const touchStartX = useRef(0);
    const touchEndX = useRef(0);
    const isSwiping = useRef(false);

    const safeIndex =
      images.length > 0
        ? ((currentIndex % images.length) + images.length) % images.length
        : 0;
    const primarySrc = images[safeIndex] || "";
    const displaySrc = primarySrc;
    const renderSrc = displaySrc || lastGoodSrc;
    const isImageLoaded = Boolean(loadedBySrc[renderSrc] || lastGoodSrc);

    // Reset transient image state when restaurant or source list changes.
    useEffect(() => {
      setCurrentIndex(0);
      setLoadedBySrc({});
      setAttemptedSrcs({});
      setIsImageUnavailable(images.length === 0);
      setShowShimmer(images.length > 0);
    }, [restaurant?.id, restaurant?.slug, restaurant?.updatedAt, images]);

    // Clear sticky successful source only when card identity changes.
    useEffect(() => {
      setLastGoodSrc("");
    }, [restaurant?.id, restaurant?.slug]);

    // WebView can serve from cache without firing onLoad; handle already-complete images.
    useEffect(() => {
      if (!renderSrc) return;
      const imgEl = imageElementRef.current;
      if (!imgEl) return;

      setShowShimmer(true);
      const shimmerTimeout = setTimeout(() => {
        setShowShimmer(false);
      }, 2500);

      if (imgEl.complete) {
        if (imgEl.naturalWidth > 0) {
          setLoadedBySrc((prev) =>
            prev[renderSrc] ? prev : { ...prev, [renderSrc]: true },
          );
          setLastGoodSrc(renderSrc);
          setShowShimmer(false);
        } else {
          setAttemptedSrcs((prev) => ({ ...prev, [renderSrc]: true }));
        }
      }
      return () => clearTimeout(shimmerTimeout);
    }, [renderSrc]);

    // Handle touch events for swipe
    const handleTouchStart = (e) => {
      touchStartX.current = e.touches[0].clientX;
      isSwiping.current = false;
    };

    const handleTouchMove = (e) => {
      const currentX = e.touches[0].clientX;
      const diff = touchStartX.current - currentX;

      // If swipe distance is significant, mark as swiping
      if (Math.abs(diff) > 10) {
        isSwiping.current = true;
      }
    };

    const handleTouchEnd = (e) => {
      if (!isSwiping.current) return;

      touchEndX.current = e.changedTouches[0].clientX;
      const diff = touchStartX.current - touchEndX.current;
      const minSwipeDistance = 85; // Keep card swipe less sensitive on mobile

      if (Math.abs(diff) > minSwipeDistance) {
        if (diff > 0) {
          // Swipe left - next image
          setCurrentIndex((prev) => (prev + 1) % images.length);
        } else {
          // Swipe right - previous image
          setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
        }
      }

      // Reset
      isSwiping.current = false;
      touchStartX.current = 0;
      touchEndX.current = 0;
    };

    const showMultipleImages = images.length > 1;

    return (
      <div
        className={`relative ${className} w-full overflow-hidden ${roundedClass} flex-shrink-0 group`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}>
        {showShimmer && !isImageUnavailable && Boolean(renderSrc) && (
          <div className="absolute inset-0 z-[1] overflow-hidden bg-gray-200">
            <div className="h-full w-full animate-pulse bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200" />
          </div>
        )}

        <div className="absolute inset-0 transition-transform duration-700 ease-out group-hover:scale-110">
          {renderSrc && (
            <img
              ref={imageElementRef}
              src={renderSrc}
              alt={`${restaurant.name} - Image ${safeIndex + 1}`}
              className="w-full h-full object-cover"
              loading={priority ? "eager" : "lazy"}
              fetchPriority={priority ? "high" : "auto"}
              decoding="async"
              onLoad={() => {
                setLoadedBySrc((prev) => ({ ...prev, [renderSrc]: true }));
                setLastGoodSrc(renderSrc);
                setShowShimmer(false);
              }}
              onError={() => {
                setAttemptedSrcs((prev) => {
                  const next = { ...prev, [primarySrc]: true };
                  const attemptedCount = Object.keys(next).length;

                  if (attemptedCount >= images.length) {
                    setIsImageUnavailable(true);
                  } else if (images.length > 1) {
                    setCurrentIndex(
                      (prevIndex) => (prevIndex + 1) % images.length,
                    );
                  }

                  return next;
                });
                if (images.length === 1) {
                  setIsImageUnavailable(true);
                }
              }}
            />
          )}
        </div>

        {isImageUnavailable && (
          <div className="absolute inset-0 z-[2] flex items-center justify-center bg-gray-100">
            <span className="text-xs text-gray-500">Image unavailable</span>
          </div>
        )}

        {/* Image Indicators - only show if more than 1 image */}
        {showMultipleImages && (
          <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 flex items-center z-10 -space-x-2">
            {images.map((_, index) => (
              <button
                key={index}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setCurrentIndex(index);
                }}
                className="w-10 h-10 flex items-center justify-center focus:outline-none group/btn rounded-full"
                aria-label={`Go to image ${index + 1}`}>
                <div
                  className={`h-1.5 rounded-full transition-all duration-300 ${index === currentIndex
                    ? "w-6 bg-white"
                    : "w-1.5 bg-white/50 group-hover/btn:bg-white/75"
                    }`}
                />
              </button>
            ))}
          </div>
        )}

        {/* Gradient Overlay on Hover */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

        {/* Shine Effect */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full transition-transform duration-1000 group-hover:animate-shine" />
      </div>
    );
  },
);

export default function Home() {
  const HERO_BANNER_AUTO_SLIDE_MS = 3500;
  const BACKEND_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const [heroSearch, setHeroSearch] = useState("");
  const { openSearch, closeSearch, searchValue, setSearchValue } =
    useSearchOverlay();
  const { openLocationSelector } = useLocationSelector();
  const { vegMode, setVegMode: setVegModeContext } = useProfile();
  const [prevVegMode, setPrevVegMode] = useState(vegMode);
  const [showVegModePopup, setShowVegModePopup] = useState(false);
  const [showSwitchOffPopup, setShowSwitchOffPopup] = useState(false);
  const [vegModeOption, setVegModeOption] = useState("all"); // "all" or "pure-veg"
  const [isApplyingVegMode, setIsApplyingVegMode] = useState(false);
  const [isSwitchingOffVegMode, setIsSwitchingOffVegMode] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0, triangleLeft: 0 });
  const vegModeToggleRef = useRef(null);
  const vegModePopupAnchorRef = useRef(null);
  const [isStickyHeaderVisible, setIsStickyHeaderVisible] = useState(false);
  const [showStickySearch, setShowStickySearch] = useState(false);
  const [showStickyCategories, setShowStickyCategories] = useState(false);
  const lastScrollY = useRef(0);
  const scrollUpAmount = useRef(0);

  useEffect(() => {
    const handleScrollHeader = () => {
      const currentScrollY = window.scrollY;
      const categoriesSection = document.getElementById("categories-section");

      if (!categoriesSection) return;

      const rect = categoriesSection.getBoundingClientRect();
      
      // Stage 1: Show Search Bar as soon as we scroll down past the initial header (e.g. 100px)
      if (currentScrollY > 120) {
        setShowStickySearch(true);
      } else {
        setShowStickySearch(false);
      }

      // Stage 2: Show Categories when we scroll past the categories section
      if (rect.top < 60) {
        setShowStickyCategories(true);
      } else {
        setShowStickyCategories(false);
      }

      lastScrollY.current = currentScrollY;
    };

    window.addEventListener("scroll", handleScrollHeader, { passive: true });
    return () => window.removeEventListener("scroll", handleScrollHeader);
  }, []);

  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const [heroBannerImages, setHeroBannerImages] = useState([]);
  const [heroBannersData, setHeroBannersData] = useState([]); // Store full banner data with linked restaurants
  const [loadingBanners, setLoadingBanners] = useState(true);
  const [hasScrolledPastBanner, setHasScrolledPastBanner] = useState(false);
  const [landingCategories, setLandingCategories] = useState([]);
  const [landingExploreMore, setLandingExploreMore] = useState([]);
  const [festBannerVideoUrl, setFestBannerVideoUrl] = useState("");
  const [festSlideIndex, setFestSlideIndex] = useState(0);
  const [recommendedRestaurantIds, setRecommendedRestaurantIds] = useState([]);
  const [under250PriceLimit, setUnder250PriceLimit] = useState(250);
  const [
    recommendedRestaurantsFromSettings,
    setRecommendedRestaurantsFromSettings,
  ] = useState([]);
  const [loadingLandingConfig, setLoadingLandingConfig] = useState(true);
  const [realCategories, setRealCategories] = useState([]);
  const [loadingRealCategories, setLoadingRealCategories] = useState(true);
  const [menuCategories, setMenuCategories] = useState([]);
  const [loadingMenuCategories, setLoadingMenuCategories] = useState(false);
  const [, setRestaurantDietMeta] = useState({});
  const [showAllCategoriesModal, setShowAllCategoriesModal] = useState(false);
  const [availabilityTick, setAvailabilityTick] = useState(Date.now());
  const RESTAURANTS_BATCH_SIZE = HOME_RESTAURANTS_PAGE_SIZE;
  const publicCategoriesCacheRef = useRef(new Map());
  const publicCategoriesInFlightRef = useRef(new Map());
  const isHandlingSwitchOff = useRef(false);
  const heroShellRef = useRef(null);
  const stickyHeaderRef = useRef(null);
  const slugifyCategory = useCallback(
    (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, ""),
    [],
  );
  const festVideoActive =
    typeof festBannerVideoUrl === "string" && festBannerVideoUrl.trim().length > 0;
  const activeHeroSlide =
    HERO_TEXT_SLIDES[festSlideIndex % HERO_TEXT_SLIDES.length];

  // Stable list of restaurant ids for menu-category union — defined after pagination hook below.

  const normalizeImageUrl = useCallback(
    (imageUrl) => {
      if (typeof imageUrl !== "string") return "";
      const trimmed = imageUrl.trim();
      if (!trimmed) return "";
      if (/^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) {
        return trimmed;
      }
      const appProtocol =
        typeof window !== "undefined" ? window.location?.protocol : "";
      const appHost =
        typeof window !== "undefined" ? window.location?.hostname : "";
      let normalizedInput = trimmed
        .replace(/\\/g, "/")
        .replace(/^(https?):\/(?!\/)/i, "$1://")
        .replace(/^(https?:\/\/)(https?:\/\/)/i, "$1");

      if (/^\/\//.test(normalizedInput)) {
        normalizedInput = `${appProtocol || "https:"}${normalizedInput}`;
      }

      // WebView can fail on unescaped spaces/special chars; keep URLs safely encoded.
      if (/^(https?:)?\/\//i.test(normalizedInput)) {
        try {
          const parsed = new URL(normalizedInput, window.location.origin);

          // In mobile production, localhost/127.0.0.1 inside image URLs is unreachable.
          // Use BACKEND_ORIGIN (API server) for image host, not frontend host�uploads are served by the backend.
          if (
            appHost &&
            appHost !== "localhost" &&
            appHost !== "127.0.0.1" &&
            /^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname)
          ) {
            try {
              const backendUrl = new URL(BACKEND_ORIGIN);
              parsed.protocol = backendUrl.protocol;
              parsed.hostname = backendUrl.hostname;
              parsed.port = backendUrl.port;
            } catch {
              parsed.protocol = window.location.protocol;
              parsed.hostname = window.location.hostname;
              if (window.location.port) parsed.port = window.location.port;
            }
          }

          // Prevent mixed-content image blocking in HTTPS WebView.
          if (appProtocol === "https:" && parsed.protocol === "http:") {
            parsed.protocol = "https:";
          }

          const finalUrl = parsed.toString();
          // Do not encode signed URLs (S3/Cloudfront/Cloudinary); encoding query params can break signatures.
          const hasSignedParams =
            /[?&](X-Amz-|Signature=|Expires=|AWSAccessKeyId=|GoogleAccessId=|token=|sig=|se=|sp=|sv=)/i.test(
              finalUrl,
            );
          return hasSignedParams ? finalUrl : encodeURI(finalUrl);
        } catch {
          return normalizedInput;
        }
      }

      const absolutePath = normalizedInput.startsWith("/")
        ? `${BACKEND_ORIGIN}${normalizedInput}`
        : `${BACKEND_ORIGIN}/${normalizedInput.replace(/^\.?\/*/, "")}`;

      try {
        const parsed = new URL(absolutePath, window.location.origin);
        if (appProtocol === "https:" && parsed.protocol === "http:") {
          parsed.protocol = "https:";
        }
        const finalUrl = parsed.toString();
        const hasSignedParams =
          /[?&](X-Amz-|Signature=|Expires=|AWSAccessKeyId=|GoogleAccessId=|token=|sig=|se=|sp=|sv=)/i.test(
            finalUrl,
          );
        return hasSignedParams ? finalUrl : encodeURI(finalUrl);
      } catch {
        return absolutePath;
      }
    },
    [BACKEND_ORIGIN],
  );

  const extractImageFromValue = useCallback(
    (value) => {
      if (!value) return "";

      if (typeof value === "string") {
        return normalizeImageUrl(value);
      }

      if (typeof value === "object") {
        const candidate =
          value.url ||
          value.secure_url ||
          value.imageUrl ||
          value.imageURL ||
          value.image ||
          value.src ||
          value.path ||
          value.location ||
          value.link ||
          value.href ||
          "";
        return typeof candidate === "string"
          ? normalizeImageUrl(candidate)
          : "";
      }

      return "";
    },
    [normalizeImageUrl],
  );

  const buildRestaurantImageCandidates = useCallback(
    (value) => {
      const normalized = extractImageFromValue(value);
      if (!normalized) return [];

      // Mobile WebView safety: try deterministic JPEG first, then auto, then original.
      if (
        /res\.cloudinary\.com/i.test(normalized) &&
        /\/image\/upload\//i.test(normalized)
      ) {
        const hasTransform =
          /\/image\/upload\/(?:f_|q_|w_|h_|c_|dpr_|g_)/i.test(normalized);
        if (!hasTransform) {
          return Array.from(
            new Set([
              normalized.replace(
                "/image/upload/",
                "/image/upload/f_jpg,q_auto,w_1080/",
              ),
              normalized.replace(
                "/image/upload/",
                "/image/upload/f_auto,q_auto,w_1080/",
              ),
              normalized,
            ]),
          );
        }
      }

      return [normalized];
    },
    [extractImageFromValue],
  );

  const extractImages = useCallback(
    (source) => {
      if (!source) return [];

      const normalizedImages = (Array.isArray(source)
        ? source.flatMap((entry) => buildRestaurantImageCandidates(entry))
        : buildRestaurantImageCandidates(source)
      )
        .filter(Boolean)
        .map((value) => String(value).trim())
        .filter(Boolean);

      // De-duplicate image urls while preserving order.
      return normalizedImages.filter(
        (value, index) => normalizedImages.indexOf(value) === index,
      );

    },
    [buildRestaurantImageCandidates],
  );

  useEffect(() => {
    const intervalId = setInterval(() => {
      setAvailabilityTick(Date.now());
    }, 60000);

    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const heroShell = heroShellRef.current;
      const stickyHeader = stickyHeaderRef.current;

      if (!heroShell) {
        setHasScrolledPastBanner(false);
        return;
      }

      const heroRect = heroShell.getBoundingClientRect();
      const stickyHeight = stickyHeader?.getBoundingClientRect().height || 0;
      setHasScrolledPastBanner(heroRect.bottom <= stickyHeight);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, []);

  const normalizedLandingCategories = useMemo(() => {
    return (landingCategories || []).map((category, index) => ({
      id: category.id || category._id || `landing-category-${index}`,
      name: category.label || category.name || "Category",
      image:
        normalizeImageUrl(category.imageUrl || category.image) ||
        foodImages[index % foodImages.length] ||
        foodImages[0],
      slug:
        category.slug || slugifyCategory(category.label || category.name || ""),
      label: category.label || category.name || "Category",
    }));
  }, [landingCategories, normalizeImageUrl, slugifyCategory]);

  const displayCategories = useMemo(() => {
    if (realCategories.length > 0) return realCategories;
    if (menuCategories.length > 0) return menuCategories;
    return normalizedLandingCategories;
  }, [menuCategories, realCategories, normalizedLandingCategories]);

  // Swipe functionality for hero banner carousel
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchEndX = useRef(0);
  const touchEndY = useRef(0);
  const isSwiping = useRef(false);
  const autoSlideIntervalRef = useRef(null);

  // Sync prevVegMode when vegMode changes from context
  useEffect(() => {
    if (vegMode !== prevVegMode && !isHandlingSwitchOff.current) {
      setPrevVegMode(vegMode);
    }
  }, [vegMode]);

  // Keep persisted Veg Mode preference; only reset popup UI state on mount.
  useEffect(() => {
    setPrevVegMode(vegMode);
    setShowVegModePopup(false);
    setShowSwitchOffPopup(false);
    setVegModeOption("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (HERO_TEXT_SLIDES.length <= 1) return;
    const timer = setInterval(() => {
      setFestSlideIndex((prev) => (prev + 1) % HERO_TEXT_SLIDES.length);
    }, 4500);
    return () => clearInterval(timer);
  }, []);

  // Handle vegMode toggle - show popup when turned ON or OFF
  const handleVegModeChange = (newValue, options) => {
    // Skip if we're handling switch off confirmation
    if (isHandlingSwitchOff.current) {
      return;
    }

    if (newValue && !prevVegMode) {
      // Veg mode was just turned ON
      // Calculate popup position relative to toggle
      const anchorEl = options?.anchorEl || vegModeToggleRef.current;
      vegModePopupAnchorRef.current = anchorEl || null;
      if (anchorEl) {
        const rect = anchorEl.getBoundingClientRect();
        const screenWidth = window.innerWidth;
        const popupWidth = Math.min(screenWidth - 32, 320); // 320 is max-w-xs

        let left = rect.left + rect.width / 2 - popupWidth / 2;
        left = Math.max(16, Math.min(left, screenWidth - popupWidth - 16));

        const triangleLeft = rect.left + rect.width / 2 - left;

        setPopupPosition({
          top: rect.bottom + 10,
          left: left,
          triangleLeft: triangleLeft
        });
      }
      setShowVegModePopup(true);
      // Don't update context yet - wait for user to apply or cancel
    } else if (!newValue && prevVegMode) {
      // Veg mode was just turned OFF - show switch off confirmation popup
      isHandlingSwitchOff.current = true;
      setShowSwitchOffPopup(true);
      // Don't update context yet - wait for user to confirm
    } else {
      // Normal state change - update context directly
      setVegModeContext(newValue);
      setPrevVegMode(newValue);
    }
  };

  // Update popup position on scroll/resize
  useEffect(() => {
    if (!showVegModePopup) return;

    const updatePosition = () => {
      const anchorEl = vegModePopupAnchorRef.current || vegModeToggleRef.current;
      if (anchorEl) {
        const rect = anchorEl.getBoundingClientRect();
        const screenWidth = window.innerWidth;
        const popupWidth = Math.min(screenWidth - 32, 320);

        let left = rect.left + rect.width / 2 - popupWidth / 2;
        left = Math.max(16, Math.min(left, screenWidth - popupWidth - 16));

        const triangleLeft = rect.left + rect.width / 2 - left;

        setPopupPosition({
          top: rect.bottom + 10,
          left: left,
          triangleLeft: triangleLeft
        });
      }
    };

    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [showVegModePopup]);

  // Fetch hero banners from public API (no auth required)
  useEffect(() => {
    let cancelled = false;
    setLoadingBanners(true);
    publicGetOnce("/food/hero-banners/public")
      .then((response) => {
        if (cancelled) return;
        const data = response?.data?.data;
        const list = Array.isArray(data?.banners)
          ? data.banners
          : Array.isArray(data)
            ? data
            : [];
        const images = list
          .map((b) => (b && typeof b.imageUrl === "string" ? b.imageUrl : ""))
          .filter(Boolean);
        setHeroBannerImages(images);
        setHeroBannersData(list);
        setCurrentBannerIndex(0);
      })
      .catch((err) => {
        if (cancelled) return;
        debugError("Failed to fetch hero banners", err);
        setHeroBannerImages([]);
        setHeroBannersData([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingBanners(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Old backend endpoint removed: keep UI stable with empty categories.
  useEffect(() => {
    setLoadingRealCategories(true);
    setRealCategories([]);
    setLoadingRealCategories(false);
  }, []);

  // Fetch landing settings from public API — see effect after effectiveLocation is defined.

  // Keep index within current banner bounds after admin updates/reloads.
  useEffect(() => {
    setCurrentBannerIndex((prev) => {
      if (heroBannerImages.length === 0) return 0;
      return Math.min(prev, heroBannerImages.length - 1);
    });
  }, [heroBannerImages.length]);

  // Preload hero images to avoid white blink during slide transition.
  useEffect(() => {
    heroBannerImages.forEach((src) => {
      if (!src) return;
      const img = new window.Image();
      img.src = src;
    });
  }, [heroBannerImages]);

  const startHeroBannerAutoSlide = useCallback(() => {
    if (autoSlideIntervalRef.current) {
      clearInterval(autoSlideIntervalRef.current);
    }

    if (heroBannerImages.length <= 1) return;

    autoSlideIntervalRef.current = setInterval(() => {
      if (!isSwiping.current) {
        setCurrentBannerIndex((prev) => (prev + 1) % heroBannerImages.length);
      }
    }, HERO_BANNER_AUTO_SLIDE_MS);
  }, [heroBannerImages.length, HERO_BANNER_AUTO_SLIDE_MS]);

  // Auto-cycle hero banner images
  useEffect(() => {
    startHeroBannerAutoSlide();

    return () => {
      if (autoSlideIntervalRef.current) {
        clearInterval(autoSlideIntervalRef.current);
      }
    };
  }, [startHeroBannerAutoSlide]);

  // Helper function to reset auto-slide timer
  const resetAutoSlide = useCallback(() => {
    startHeroBannerAutoSlide();
  }, [startHeroBannerAutoSlide]);

  // Swipe handlers for hero banner carousel
  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isSwiping.current = true;
  };

  const handleTouchMove = (e) => {
    touchEndX.current = e.touches[0].clientX;
    touchEndY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = () => {
    if (!isSwiping.current || heroBannerImages.length === 0) return;

    const deltaX = touchEndX.current - touchStartX.current;
    const deltaY = Math.abs(touchEndY.current - touchStartY.current);
    const minSwipeDistance = 50; // Minimum distance for a swipe

    // Check if it's a horizontal swipe (not vertical scroll)
    if (Math.abs(deltaX) > minSwipeDistance && Math.abs(deltaX) > deltaY) {
      if (deltaX > 0) {
        // Swipe right - go to previous image
        setCurrentBannerIndex(
          (prev) =>
            (prev - 1 + heroBannerImages.length) % heroBannerImages.length,
        );
      } else {
        // Swipe left - go to next image
        setCurrentBannerIndex((prev) => (prev + 1) % heroBannerImages.length);
      }
      // Reset auto-slide timer after manual swipe
      resetAutoSlide();
    }

    // Reset swipe state after a short delay
    setTimeout(() => {
      isSwiping.current = false;
    }, 300);

    // Reset touch positions
    touchStartX.current = 0;
    touchStartY.current = 0;
    touchEndX.current = 0;
    touchEndY.current = 0;
  };

  // Mouse handlers for desktop drag support
  const handleMouseDown = (e) => {
    touchStartX.current = e.clientX;
    touchStartY.current = e.clientY;
    isSwiping.current = true;
  };

  const handleMouseMove = (e) => {
    if (!isSwiping.current) return;
    touchEndX.current = e.clientX;
    touchEndY.current = e.clientY;
  };

  const handleMouseUp = () => {
    if (!isSwiping.current || heroBannerImages.length === 0) return;

    const deltaX = touchEndX.current - touchStartX.current;
    const deltaY = Math.abs(touchEndY.current - touchStartY.current);
    const minSwipeDistance = 50;

    if (Math.abs(deltaX) > minSwipeDistance && Math.abs(deltaX) > deltaY) {
      if (deltaX > 0) {
        setCurrentBannerIndex(
          (prev) =>
            (prev - 1 + heroBannerImages.length) % heroBannerImages.length,
        );
      } else {
        setCurrentBannerIndex((prev) => (prev + 1) % heroBannerImages.length);
      }
      // Reset auto-slide timer after manual swipe
      resetAutoSlide();
    }

    setTimeout(() => {
      isSwiping.current = false;
    }, 300);

    touchStartX.current = 0;
    touchStartY.current = 0;
    touchEndX.current = 0;
    touchEndY.current = 0;
  };
  const [activeFilters, setActiveFilters] = useState(new Set());
  const [sortBy, setSortBy] = useState(null); // null, 'price-low', 'price-high', 'rating-high', 'rating-low'
  const [selectedCuisine, setSelectedCuisine] = useState(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState({
    activeFilters: new Set(),
    sortBy: null,
    selectedCuisine: null,
  });
  const [activeFilterTab, setActiveFilterTab] = useState("sort");
  const categoryScrollRef = useRef(null);
  const gsapAnimationsRef = useRef([]);
  // Show skeletons immediately while loading — delayed toggles caused visible layout swap (CLS).
  const showBannerSkeleton = loadingBanners;
  const showCategorySkeleton = loadingRealCategories || loadingMenuCategories;
  const showExploreSkeleton = loadingLandingConfig;
  // Safely get profile context - handle case when ProfileProvider is not available
  let profileContext = null;
  try {
    profileContext = useProfile();
  } catch (error) {
    debugWarn("ProfileProvider not available, using fallback:", error.message);
    // Fallback values when ProfileProvider is not available
    profileContext = {
      addFavorite: () => debugWarn("ProfileProvider not available"),
      removeFavorite: () => debugWarn("ProfileProvider not available"),
      isFavorite: () => false,
      getFavorites: () => [],
      getDefaultAddress: () => null,
    };
  }

  const {
    addFavorite,
    removeFavorite,
    isFavorite,
    getFavorites,
  } = profileContext;
  const { addToCart, cart } = useCart();
  const lastCartRestaurant = useMemo(
    () => getFirstRestaurantFromCart(cart),
    [cart],
  );
  const { location, loading, requestLocation } = useLocation();
  const {
    effectiveLocation,
    savedAddressText,
    defaultSavedAddress,
    defaultSavedAddressLocation,
  } = useEffectiveDeliveryLocation();
  const {
    zoneId,
    zoneStatus,
    isInService,
    isOutOfService,
    loading: zoneLoading,
    error: zoneError,
  } = useZone(location);
  const [showToast, setShowToast] = useState(false);
  const [showManageCollections, setShowManageCollections] = useState(false);
  const [selectedRestaurantSlug, setSelectedRestaurantSlug] = useState(null);

  // Fetch categories (zone-aware) for the homepage category rail.
  // Wait for location and zone detection to complete before making a single API call.
  useEffect(() => {
    // Agar location ya zone abhi bhi load ho raha hai, tab tak wait karo.
    // Yeh ensure karta hai ki sirf ek hi API call ho (zone-aware), na ki pehle
    // bina zoneId ke global call aur phir zoneId ke saath dobara call.
    if (loading || zoneLoading) return;

    let cancelled = false
    const run = async () => {
      const zoneKey = String(zoneId || "global")
      try {
        // Dedupe repeated calls (StrictMode + zone settling). Cache per zoneKey and share in-flight request.
        const cached = publicCategoriesCacheRef.current.get(zoneKey)
        if (cached) {
          if (!cancelled) setRealCategories(cached)
          return
        }

        const inFlight = publicCategoriesInFlightRef.current.get(zoneKey)
        if (inFlight) {
          const categories = await inFlight
          if (!cancelled) setRealCategories(categories)
          return
        }

        setLoadingRealCategories(true)
        const promise = (async () => {
          const res = await adminAPI.getPublicCategories(zoneId ? { zoneId } : {})
          const list =
            res?.data?.data?.categories ||
            res?.data?.categories ||
            []
          const categories = Array.isArray(list)
            ? list.map((cat, idx) => ({
              id: String(cat?.id || cat?._id || cat?.slug || idx),
              name: cat?.name || "",
              slug: cat?.slug || String(cat?.name || "").toLowerCase().replace(/\s+/g, "-"),
              image:
                normalizeImageUrl(cat?.image || cat?.imageUrl) ||
                foodImages[idx % foodImages.length] ||
                foodImages[0],
              type: cat?.type || "",
            }))
            : []

          publicCategoriesCacheRef.current.set(zoneKey, categories)
          return categories
        })()

        publicCategoriesInFlightRef.current.set(zoneKey, promise)
        const categories = await promise
        publicCategoriesInFlightRef.current.delete(zoneKey)

        if (!cancelled) setRealCategories(categories)
      } catch (err) {
        debugWarn("Failed to fetch categories:", err)
        if (!cancelled) setRealCategories([])
      } finally {
        if (!cancelled) setLoadingRealCategories(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [zoneId, loading, zoneLoading, normalizeImageUrl])

  // Memoize cartCount to prevent recalculation on every render - use cart directly
  const cartCount = useMemo(
    () => cart.reduce((total, item) => total + (item.quantity || 0), 0),
    [cart],
  );

  const cityName = location?.city || "Select";
  const stateName = location?.state || "Location";
  const hasLiveLocation = useMemo(() => {
    if (!location) return false;

    const isPlaceholder = (value) => {
      if (!value) return true;
      const normalized = String(value).trim().toLowerCase();
      return (
        !normalized ||
        normalized === "select location" ||
        normalized === "current location"
      );
    };

    const hasAddressText =
      !isPlaceholder(location.formattedAddress) ||
      !isPlaceholder(location.address);
    const hasCityState =
      !isPlaceholder(location.city) || !isPlaceholder(location.state);

    return hasAddressText || hasCityState;
  }, [location]);

  useEffect(() => {
    let cancelled = false;
    setLoadingLandingConfig(true);
    const params = new URLSearchParams();
    if (
      Number.isFinite(effectiveLocation?.latitude) &&
      Number.isFinite(effectiveLocation?.longitude)
    ) {
      params.set("lat", String(effectiveLocation.latitude));
      params.set("lng", String(effectiveLocation.longitude));
    }
    const query = params.toString();
    publicGetOnce(`/food/landing/settings/public${query ? `?${query}` : ""}`)
      .catch(() => ({ data: { data: {} } }))
      .then((settingsRes) => {
        if (cancelled) return;
        const settings = settingsRes?.data?.data || {};
        setRecommendedRestaurantIds(settings.recommendedRestaurantIds || []);
        setUnder250PriceLimit(Number(settings.under250PriceLimit) || 250);
        setRecommendedRestaurantsFromSettings(
          settings.recommendedRestaurants || [],
        );
        setFestBannerVideoUrl(typeof settings.festBannerVideoUrl === "string" ? settings.festBannerVideoUrl : "");
      })
      .catch(() => {
        if (!cancelled) {
          setRecommendedRestaurantsFromSettings([]);
          setFestBannerVideoUrl("");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingLandingConfig(false);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveLocation?.latitude, effectiveLocation?.longitude]);

  const { zoneId: effectiveZoneId } = useZone(effectiveLocation);

  const effectiveLocationRef = useRef(effectiveLocation);
  effectiveLocationRef.current = effectiveLocation;
  const effectiveZoneIdRef = useRef(effectiveZoneId);
  effectiveZoneIdRef.current = effectiveZoneId;

  const restaurantsLocationQueryKey = useMemo(() => {
    const city = String(effectiveLocation?.city || "")
      .trim()
      .toLowerCase();
    // Coarser rounding (~1.1km) avoids refetch loops from small GPS drift.
    const lat = Number.isFinite(effectiveLocation?.latitude)
      ? Math.round(effectiveLocation.latitude * 100) / 100
      : null;
    const lng = Number.isFinite(effectiveLocation?.longitude)
      ? Math.round(effectiveLocation.longitude * 100) / 100
      : null;
    // Prefer stable coords over flapping zoneId while zone resolves.
    const zonePart =
      lat != null && lng != null ? "" : String(effectiveZoneId || "");
    return `${city}|${lat ?? ""}|${lng ?? ""}|${zonePart}`;
  }, [
    effectiveLocation?.city,
    effectiveLocation?.latitude,
    effectiveLocation?.longitude,
    effectiveZoneId,
  ]);

  // Freeze the first usable location key so GPS jitter / zone settle doesn't reload the list.
  const stableRestaurantsLocationKeyRef = useRef("");
  const [stableRestaurantsLocationKey, setStableRestaurantsLocationKey] = useState("");

  useEffect(() => {
    const hasCoords = restaurantsLocationQueryKey.split("|").slice(1, 3).every(Boolean);
    const hasCity = Boolean(
      String(effectiveLocation?.city || "").trim() &&
        String(effectiveLocation?.city || "").toLowerCase() !== "current location",
    );
    if (!hasCoords && !hasCity && !effectiveZoneId) return;

    if (!stableRestaurantsLocationKeyRef.current) {
      stableRestaurantsLocationKeyRef.current = restaurantsLocationQueryKey;
      setStableRestaurantsLocationKey(restaurantsLocationQueryKey);
      return;
    }

    // Only unlock when the user explicitly changes delivery address/mode (event-driven sync
    // already updates effectiveLocation). Compare city+coarse coords; ignore zone-only flips.
    const [prevCity, prevLat, prevLng] = String(stableRestaurantsLocationKeyRef.current).split("|");
    const [nextCity, nextLat, nextLng] = String(restaurantsLocationQueryKey).split("|");
    const locationChanged =
      prevCity !== nextCity || prevLat !== nextLat || prevLng !== nextLng;

    if (locationChanged) {
      stableRestaurantsLocationKeyRef.current = restaurantsLocationQueryKey;
      setStableRestaurantsLocationKey(restaurantsLocationQueryKey);
    }
  }, [restaurantsLocationQueryKey, effectiveLocation?.city, effectiveZoneId]);

  const homeListCity = useMemo(
    () => resolveUserListCity(effectiveLocation),
    [effectiveLocation?.city],
  );

  const [restaurantsFetchReady, setRestaurantsFetchReady] = useState(false);

  useEffect(() => {
    const hasCoords =
      Number.isFinite(effectiveLocation?.latitude) &&
      Number.isFinite(effectiveLocation?.longitude);
    if (homeListCity || hasCoords || effectiveZoneId) {
      setRestaurantsFetchReady(true);
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setRestaurantsFetchReady(true);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [
    homeListCity,
    effectiveLocation?.latitude,
    effectiveLocation?.longitude,
    effectiveZoneId,
  ]);

  const {
    isOutOfService: isSavedAddressOutOfService,
    loading: savedAddressZoneLoading,
    error: savedAddressZoneError,
  } = useZone(defaultSavedAddressLocation);

  const hasSavedAddress = Boolean(defaultSavedAddress && savedAddressText);
  const shouldShowOutOfZoneHome =
    hasSavedAddress &&
    Boolean(defaultSavedAddressLocation) &&
    !savedAddressZoneLoading &&
    !savedAddressZoneError &&
    isSavedAddressOutOfService;

  // Mock points value - replace with actual points from context/store
  const userPoints = 99;

  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [activeTab, setActiveTab] = useState("food");


  // Simple filter toggle function
  const toggleFilter = (filterId) => {
    setActiveFilters((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(filterId)) {
        newSet.delete(filterId);
      } else {
        newSet.add(filterId);
      }
      return newSet;
    });
  };

  // Refs for scroll tracking
  const filterSectionRefs = useRef({});
  const [activeScrollSection, setActiveScrollSection] = useState("sort");
  const rightContentRef = useRef(null);
  const menuUnionRequestSeqRef = useRef(0);

  // Scroll tracking effect
  useEffect(() => {
    if (!isFilterOpen || !rightContentRef.current) return;

    const observerOptions = {
      root: rightContentRef.current,
      rootMargin: "-20% 0px -70% 0px",
      threshold: 0,
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const sectionId = entry.target.getAttribute("data-section-id");
          if (sectionId) {
            setActiveScrollSection(sectionId);
            setActiveFilterTab(sectionId);
          }
        }
      });
    }, observerOptions);

    // Observe all filter sections
    Object.values(filterSectionRefs.current).forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, [isFilterOpen]);

  const appliedFiltersRef = useRef(appliedFilters);
  appliedFiltersRef.current = appliedFilters;

  const restaurantListQueryKey = useMemo(
    () =>
      buildRestaurantListQueryKey(
        stableRestaurantsLocationKey || restaurantsLocationQueryKey,
        appliedFilters,
      ),
    [stableRestaurantsLocationKey, restaurantsLocationQueryKey, appliedFilters],
  );

  const fetchRestaurantPage = useCallback(
    async (page) => {
      const response = await fetchRestaurantsCached(
        buildRestaurantListParams(
          appliedFiltersRef.current,
          effectiveLocationRef.current,
          effectiveZoneIdRef.current,
          page,
          RESTAURANTS_BATCH_SIZE,
        ),
      );

      const payload = response?.data?.data;
      const restaurantsArray = extractRestaurantListItems(payload);

      if (!response?.data?.success || !payload) {
        throw new Error("Invalid restaurants response");
      }

      return {
        items: transformRestaurantApiList(restaurantsArray, {
          location: effectiveLocationRef.current,
          filters: appliedFiltersRef.current,
          extractImages,
          buildRestaurantImageCandidates,
        }),
        pagination: extractPagination(payload),
      };
    },
    [extractImages, buildRestaurantImageCandidates],
  );

  const {
    items: restaurantsData,
    pagination: restaurantsPagination,
    hasNextPage: hasMoreRestaurants,
    isLoading: loadingRestaurants,
    isLoadingMore: loadingMoreRestaurants,
    loadMoreRef: restaurantLoadMoreRef,
    loadMore: loadMoreRestaurants,
  } = useInfinitePagination({
    queryKey: restaurantListQueryKey,
    fetchPage: fetchRestaurantPage,
    getItemId: (restaurant) => restaurant.id || restaurant.mongoId,
    enabled:
      restaurantsFetchReady &&
      (Boolean(homeListCity) ||
        (Number.isFinite(effectiveLocation?.latitude) &&
          Number.isFinite(effectiveLocation?.longitude))),
    initialLimit: RESTAURANTS_BATCH_SIZE,
  });

  const showRestaurantSkeleton =
    loadingRestaurants ||
    (restaurantsFetchReady &&
      !homeListCity &&
      !(
        Number.isFinite(effectiveLocation?.latitude) &&
        Number.isFinite(effectiveLocation?.longitude)
      ));

  const menuUnionRestaurantIdsKey = useMemo(() => {
    if (!Array.isArray(restaurantsData) || restaurantsData.length === 0) {
      return "";
    }
    return restaurantsData
      .map((r) => String(r?.restaurantId || r?.id || "").trim())
      .filter(Boolean)
      .sort()
      .join(",");
  }, [restaurantsData]);

  const applyFiltersAndRefetch = useCallback(
    (
      nextActiveFilters = activeFilters,
      nextSortBy = sortBy,
      nextSelectedCuisine = selectedCuisine,
    ) => {
      setAppliedFilters({
        activeFilters: new Set(nextActiveFilters),
        sortBy: nextSortBy,
        selectedCuisine: nextSelectedCuisine,
      });
    },
    [activeFilters, sortBy, selectedCuisine],
  );

  // IMPORTANT:
  // Homepage should avoid eager N+1 menu requests. We only resolve menu metadata
  // when the UI truly needs it: Veg Mode is enabled, or admin categories are unavailable.
  useEffect(() => {
    const restaurantIds = menuUnionRestaurantIdsKey
      ? menuUnionRestaurantIdsKey.split(",").filter(Boolean)
      : [];
    const shouldFetchMenuMeta = vegMode || realCategories.length === 0;

    const fetchMenuCategories = async () => {
      const requestSeq = ++menuUnionRequestSeqRef.current;

      if (!menuUnionRestaurantIdsKey || !shouldFetchMenuMeta) {
        setMenuCategories([]);
        setRestaurantDietMeta({});
        setLoadingMenuCategories(false);
        return;
      }

      setLoadingMenuCategories(true);
      try {
        const categoryMap = new Map();
        const menuResponses = [];

        for (let index = 0; index < Math.min(restaurantIds.length, RESTAURANTS_BATCH_SIZE * 2); index += 4) {
          const batchIds = restaurantIds
            .slice(0, RESTAURANTS_BATCH_SIZE * 2)
            .slice(index, index + 4);
          const batchResponses = await Promise.all(
            batchIds.map(async (id) => {
              if (!id) return { id: null, menu: null };

              try {
                const menu = await fetchRestaurantMenuCached(id);
                return { id, menu };
              } catch {
                return { id, menu: null };
              }
            }),
          );

          if (requestSeq !== menuUnionRequestSeqRef.current) return;
          menuResponses.push(...batchResponses);
        }

        if (requestSeq !== menuUnionRequestSeqRef.current) return;

        const nextDietMeta = {};

        menuResponses.forEach(({ id, menu }) => {
          let hasVeg = false;
          let hasNonVeg = false;
          const sections = Array.isArray(menu?.sections) ? menu.sections : [];
          sections.forEach((section) => {
            const sectionItems = Array.isArray(section?.items)
              ? section.items
              : [];
            sectionItems.forEach((item) => {
              const foodType = String(item?.foodType || "")
                .trim()
                .toLowerCase();
              if (foodType === "veg") hasVeg = true;
              if (
                foodType === "non-veg" ||
                foodType === "non veg" ||
                foodType === "nonveg"
              )
                hasNonVeg = true;
            });

            const subsections = Array.isArray(section?.subsections)
              ? section.subsections
              : [];
            subsections.forEach((subsection) => {
              const subsectionItems = Array.isArray(subsection?.items)
                ? subsection.items
                : [];
              subsectionItems.forEach((item) => {
                const foodType = String(item?.foodType || "")
                  .trim()
                  .toLowerCase();
                if (foodType === "veg") hasVeg = true;
                if (
                  foodType === "non-veg" ||
                  foodType === "non veg" ||
                  foodType === "nonveg"
                )
                  hasNonVeg = true;
              });
            });

            const categoryName = String(section?.name || "").trim();
            if (!categoryName) return;

            const slug = slugifyCategory(categoryName);
            if (!slug) return;

            let image = "";
            if (Array.isArray(section?.items) && section.items.length > 0) {
              image = normalizeImageUrl(section.items[0]?.image);
            }
            if (!image && Array.isArray(section?.subsections)) {
              for (const subsection of section.subsections) {
                if (
                  Array.isArray(subsection?.items) &&
                  subsection.items.length > 0
                ) {
                  image = normalizeImageUrl(subsection.items[0]?.image);
                  if (image) break;
                }
              }
            }

            if (!categoryMap.has(slug)) {
              categoryMap.set(slug, {
                id: slug,
                name: categoryName,
                slug,
                label: categoryName,
                image: image || "",
              });
            } else if (image && !categoryMap.get(slug).image) {
              categoryMap.get(slug).image = image;
            }
          });

          if (id) {
            nextDietMeta[id] = {
              hasVeg,
              hasNonVeg,
              isPureVeg: hasVeg && !hasNonVeg,
            };
          }
        });

        const categories = Array.from(categoryMap.values())
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((category, index) => ({
            ...category,
            image:
              category.image ||
              foodImages[index % foodImages.length] ||
              foodImages[0],
          }));

        setMenuCategories(categories);
        setRestaurantDietMeta(nextDietMeta);
      } finally {
        if (requestSeq === menuUnionRequestSeqRef.current) {
          setLoadingMenuCategories(false);
        }
      }
    };

    fetchMenuCategories();
  }, [
    menuUnionRestaurantIdsKey,
    normalizeImageUrl,
    realCategories.length,
    slugifyCategory,
    vegMode,
  ]);

  const matchesVegMode = useCallback(
    (restaurant) => {
      if (!vegMode) return true;
      return restaurant?.pureVegRestaurant === true;
    },
    [vegMode],
  );

  // Filter restaurants and foods based on active filters
  const filteredRestaurants = useMemo(() => {
    // Rely on API data which is already filtered and sorted by the backend.
    // We only apply client-side Veg Mode filtering here.
    return (restaurantsData || []).filter(matchesVegMode);
  }, [restaurantsData, matchesVegMode]);

  const recommendedForYouRestaurants = useMemo(() => {
    const restaurantsByMongoId = new Map(
      (restaurantsData || [])
        .map((restaurant) => {
          const mongoId = String(restaurant.mongoId || restaurant.id || "");
          return mongoId ? [mongoId, restaurant] : null;
        })
        .filter(Boolean),
    );

    const mergeWithListData = (restaurant) => {
      const mongoId = String(restaurant.mongoId || restaurant.id || "");
      const fromList = restaurantsByMongoId.get(mongoId);
      if (!fromList) return restaurant;
      return {
        ...restaurant,
        address: fromList.address || restaurant.address,
        distance: fromList.distance || restaurant.distance,
        distanceInKm: fromList.distanceInKm ?? restaurant.distanceInKm,
        distanceMeters: fromList.distanceMeters ?? restaurant.distanceMeters,
        distanceSource: fromList.distanceSource || restaurant.distanceSource,
        rating: fromList.rating ?? restaurant.rating,
        totalRatings: fromList.totalRatings ?? restaurant.totalRatings,
        deliveryTime: fromList.deliveryTime || restaurant.deliveryTime,
      };
    };

    const idsInOrder = (recommendedRestaurantIds || []).map((id) => String(id));
    const hasIds = idsInOrder.length > 0;
    const fromSettings = Array.isArray(recommendedRestaurantsFromSettings)
      ? recommendedRestaurantsFromSettings
      : [];

    // Primary source: restaurants returned by landing settings API (already admin-selected).
    const fromSettingsMapped = fromSettings.map((restaurant) => {
      const restaurantId = restaurant?._id ? String(restaurant._id) : "";
      const cuisine =
        Array.isArray(restaurant?.cuisines) && restaurant.cuisines.length > 0
          ? restaurant.cuisines[0]
          : "Multi-cuisine";
      const imageCandidates = extractImages([
        ...(Array.isArray(restaurant?.coverImages)
          ? restaurant.coverImages
          : [restaurant?.coverImages]
        ).filter(Boolean),
        restaurant?.profileImage,
        ...(Array.isArray(restaurant?.menuImages) ? restaurant.menuImages : []),
        ...(Array.isArray(restaurant?.featuredItems)
          ? restaurant.featuredItems.map((item) => item?.image)
          : []),
      ]);
      const image = imageCandidates[0] || foodImages[0];

      const distanceMeta = resolveRestaurantDistance(restaurant, effectiveLocation);

      return {
        id: restaurant?.restaurantId || restaurantId,
        mongoId: restaurantId,
        name: getRestaurantDisplayName(restaurant),
        address: getRestaurantAddressLine(restaurant),
        cuisine,
        rating: Number(restaurant?.rating) || 0,
        totalRatings: Number(restaurant?.totalRatings) || 0,
        distance: distanceMeta.distance,
        distanceInKm: distanceMeta.distanceInKm,
        distanceMeters: Number.isFinite(restaurant?.distanceMeters)
          ? restaurant.distanceMeters
          : (distanceMeta.distanceInKm !== null ? distanceMeta.distanceInKm * 1000 : null),
        distanceSource: distanceMeta.distanceSource,
        deliveryTime: restaurant?.estimatedDeliveryTime || "",
        image: normalizeImageUrl(image) || foodImages[0],
        images: imageCandidates.length > 0 ? imageCandidates : [foodImages[0]],
        slug: restaurant?.slug || restaurant?.restaurantId || restaurantId,
        offer: null,
        pureVegRestaurant: restaurant?.pureVegRestaurant === true,
        isActive: restaurant?.isActive !== false,
        isAcceptingOrders: restaurant?.isAcceptingOrders !== false,
        outletTimings: restaurant?.outletTimings || null,
      };
    });

    // Keep admin-selected order when IDs exist.
    const orderedFromSettings = hasIds
      ? idsInOrder
        .map((id) =>
          fromSettingsMapped.find(
            (restaurant) => String(restaurant.mongoId) === id,
          ),
        )
        .filter(Boolean)
      : fromSettingsMapped;

    // Fallback: if settings payload misses some entries, recover them from fetched restaurant list by ID.
    const existingIds = new Set(
      orderedFromSettings.map((restaurant) =>
        String(restaurant.mongoId || restaurant.id),
      ),
    );
    const fromFetchedMissing = (restaurantsData || []).filter((restaurant) => {
      const mongoId = String(restaurant.mongoId || "");
      return (
        hasIds && idsInOrder.includes(mongoId) && !existingIds.has(mongoId)
      );
    });

    return [...orderedFromSettings, ...fromFetchedMissing]
      .filter(matchesVegMode)
      .map(mergeWithListData)
      .slice(0, 12);
  }, [
    recommendedRestaurantIds,
    recommendedRestaurantsFromSettings,
    restaurantsData,
    extractImages,
    normalizeImageUrl,
    matchesVegMode,
    effectiveLocation,
  ]);

  // Featured foods removed - will be handled by restaurants data from API
  const filteredFeaturedFoods = useMemo(() => {
    // Return empty array - featured foods will come from API if needed
    return [];
  }, [activeFilters, sortBy]);

  // Memoize callbacks to prevent unnecessary re-renders
  const handleLocationClick = useCallback(() => {
    openLocationSelector();
  }, [openLocationSelector]);

  const handleSearchFocus = useCallback(() => {
    navigate("/food/user/search");
  }, [navigate]);

  const handleSearchClose = useCallback(() => {
    closeSearch();
    setHeroSearch("");
  }, [closeSearch]);

  // Removed GSAP animations - using CSS and ScrollReveal components instead for better performance
  // Auto-scroll removed - manual scroll only

  // Animated placeholder cycling - same as RestaurantDetails highlight offer animation
  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % placeholders.length);
    }, 2000); // Change placeholder every 2 seconds (same as RestaurantDetails)

    return () => clearInterval(interval);
  }, []); // placeholders is a constant, no need for dependency

  // Memoized Hero Banner Component for better perf
  const HeroBannerSection = useMemo(() => {
    if (showBannerSkeleton) {
      return (
        <div className="px-4 py-2">
          <HeroBannerSkeleton className="h-36 sm:h-44 lg:h-56 rounded-2xl" />
        </div>
      );
    }

    if (heroBannerImages.length === 0) return null;

    return (
      <div className="px-4 py-2">
        <div
          ref={heroShellRef}
          data-home-hero-shell="true"
          className="relative w-full overflow-hidden aspect-[1.7/1] sm:aspect-[1.9/1] lg:aspect-[2.1/1] min-h-[180px] sm:min-h-[220px] lg:min-h-[260px] rounded-2xl shadow-sm group cursor-pointer bg-white"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div className="absolute inset-0 z-0">
            {/* Shining Glint Effect */}
            <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden">
              <motion.div
                animate={{
                  x: ['-200%', '200%'],
                }}
                transition={{
                  duration: 2.5,
                  repeat: Infinity,
                  repeatDelay: 5,
                  ease: "easeInOut"
                }}
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent skew-x-[-20deg] w-[150%] h-full"
              />
            </div>
            {heroBannerImages.map((image, index) => (
              <div
                key={`${index}-${image}`}
                className="absolute inset-0 transition-opacity duration-700 ease-in-out"
                style={{
                  opacity: currentBannerIndex === index ? 1 : 0,
                  zIndex: currentBannerIndex === index ? 2 : 1,
                  pointerEvents: "none",
                }}>
                <img
                  src={image}
                  alt={`Hero Banner ${index + 1}`}
                  className="h-full w-full object-cover"
                  loading={index === currentBannerIndex ? "eager" : "lazy"}
                  fetchPriority={index === currentBannerIndex ? "high" : "low"}
                  draggable={false}
                />
              </div>
            ))}
          </div>

          <button
            type="button"
            className="absolute inset-0 z-20 h-full w-full border-0 p-0 bg-transparent text-left"
            onClick={() => {
              const bannerData = heroBannersData[currentBannerIndex];
              const linkedRestaurants = bannerData?.linkedRestaurants || [];
              if (linkedRestaurants.length > 0) {
                const firstRestaurant = linkedRestaurants[0];
                const restaurantSlug = firstRestaurant.slug || firstRestaurant.restaurantId || firstRestaurant._id;
                navigate(`/restaurants/${restaurantSlug}`);
              }
            }}
            aria-label={`Open hero banner ${currentBannerIndex + 1}`}
          />

          {/* Indicators removed as requested */}
        </div>
      </div>
    );
  }, [heroBannerImages, currentBannerIndex, showBannerSkeleton, heroBannersData, navigate]);

  // Memoized Category Rail Component
  const CategoryRailSection = useMemo(() => {
    return (
      <section className="space-y-1 sm:space-y-1.5 lg:space-y-2 min-h-[108px] sm:min-h-[120px]">
        <div
          ref={categoryScrollRef}
          className="flex gap-3 sm:gap-4 lg:gap-5 overflow-x-auto overflow-y-visible scrollbar-hide scroll-smooth px-2 sm:px-3 py-2 sm:py-3"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {/* Meals Under 200 Card */}
          <div
            className="flex-shrink-0 flex flex-col items-center gap-2 cursor-pointer transition-transform hover:scale-105 active:scale-95"
            onClick={() => navigate("/user/under-250")}
          >
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-[#0F172A] rounded-b-full rounded-t-sm shadow-md border-t-4 border-orange-200 flex flex-col items-center justify-center p-1">
              <span className="text-[10px] sm:text-xs font-bold text-white text-center leading-tight">UNDER</span>
              <span className="text-sm sm:text-base font-extrabold text-white">₹200</span>
              <div className="w-10 h-3.5 bg-white rounded-full mt-1 flex items-center justify-center">
                <span className="text-[8px] font-bold text-[#0F172A]">Explore</span>
              </div>
            </div>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Offers</span>
          </div>

          {showCategorySkeleton ? (
            <CategoryChipRowSkeleton className="py-1" />
          ) : (
            displayCategories.slice(0, 12).map((category, index) => (
              <Link
                key={category.id || index}
                to={`/food/user/category/${category.slug || category.name.toLowerCase().replace(/\s+/g, "-")}`}
                className="flex-shrink-0 flex flex-col items-center gap-2 group transition-all duration-300 hover:-translate-y-1"
                style={{ animation: `fade-in-up 0.5s ease-out forwards ${index * 0.05}s`, opacity: 0 }}
              >
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full overflow-hidden shadow-sm border border-gray-100 dark:border-gray-800 group-hover:border-[#0F172A] transition-colors">
                  <OptimizedImage
                    src={category.image}
                    alt={category.name}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    sizes="80px"
                  />
                </div>
                <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 text-center truncate max-w-[72px]">
                  {category.name}
                </span>
              </Link>
            ))
          )}

          {displayCategories.length > 12 && !showCategorySkeleton && (
            <div
              className="flex-shrink-0 flex flex-col items-center gap-2 cursor-pointer group"
              onClick={() => navigate("/food/user/categories")}
            >
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-orange-50 dark:bg-orange-950 flex items-center justify-center border border-orange-100 group-hover:border-[#0F172A] transition-all">
                <Plus className="w-6 h-6 text-[#0F172A]" />
              </div>
              <span className="text-xs font-medium text-gray-700">See All</span>
            </div>
          )}
        </div>
      </section>
    );
  }, [displayCategories, showCategorySkeleton, navigate]);

  return (

    <div className="food-landing-page relative min-h-screen bg-background dark:bg-[#0a0a0a] pb-20 md:pb-8 overflow-x-clip">
      {shouldShowOutOfZoneHome && (
        <div className="fixed inset-0 z-[90] pointer-events-none">
          <div className="absolute inset-0 bg-slate-300/35 backdrop-blur-[1px]" />
          <div className="absolute top-20 left-1/2 -translate-x-1/2 px-4">
            <div className="rounded-xl border border-red-200 bg-red-50/95 text-red-700 px-4 py-2 shadow-sm text-sm sm:text-base font-semibold max-w-[calc(100vw-2rem)] text-center">
              You are out of zone
            </div>
          </div>
        </div>
      )}

      <div
        className={
          shouldShowOutOfZoneHome
            ? "grayscale opacity-70 transition-all duration-300"
            : "transition-all duration-300"
        }>
        {/* Unified Background for Entire Page - Vibrant Food Theme */}
        <div className="absolute top-0 left-0 right-0 bottom-0 pointer-events-none overflow-hidden z-0">
          {/* Main Background */}
          <div className="absolute inset-0 bg-white dark:bg-[#0a0a0a]"></div>
          {/* Background Elements - Reduced to 2 blobs with CSS animations for better performance */}
          <div className="absolute inset-0 overflow-hidden opacity-20">
            {/* Top right blob - CSS animation */}
            <div
              style={{
                animation: "blob 8s ease-in-out infinite",
                willChange: "transform",
              }}
            />
            {/* Bottom left blob - CSS animation */}
            <div
              style={{
                animation: "blob-reverse 10s ease-in-out infinite",
                willChange: "transform",
              }}
            />
          </div>
          {/* CSS keyframes for animations */}
          <style>{`
          @keyframes blob {
            0%, 100% {
              transform: translate(0, 0) scale(1);
            }
            50% {
              transform: translate(50px, -30px) scale(1.2);
            }
          }
          @keyframes blob-reverse {
            0%, 100% {
              transform: translate(0, 0) scale(1);
            }
            50% {
              transform: translate(-40px, 40px) scale(1.3);
            }
          }
          @keyframes fade-in {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          @keyframes gradient {
            0%, 100% {
              background-position: 0% 50%;
            }
            50% {
              background-position: 100% 50%;
            }
          }
          @keyframes fade-in-up {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          @keyframes wiggle {
            0%, 100% {
              transform: rotate(0deg);
            }
            25% {
              transform: rotate(10deg);
            }
            75% {
              transform: rotate(-10deg);
            }
          }
          @keyframes placeholderFade {
            0% {
              opacity: 0;
              transform: translateY(20px);
            }
            100% {
              opacity: 0.6;
              transform: translateY(0);
            }
          }
          @keyframes gradientShift {
            0%, 100% {
              background-position: 0% 50%;
            }
            50% {
              background-position: 100% 50%;
            }
          }
          @keyframes bannerPan {
            0% {
              background-position: 100% 50%;
            }
            100% {
              background-position: 0% 50%;
            }
          }
          @keyframes slideUp {
            0% {
              opacity: 0;
              transform: translateY(15px);
            }
            100% {
              opacity: 1;
              transform: translateY(0);
            }
          }
          .hero-banner-pan {
            background-size: 200% 200%;
            animation: bannerPan 16s linear infinite;
          }
          .red-header-bg {
            background-color: #ef4f5f;
            background-image: linear-gradient(180deg, #ef4f5f 0%, #e03546 100%);
          }
        `}</style>
        </div>

        <div className="md:hidden relative overflow-x-clip food-mobile-page">
          <div className="relative">
            <HomeMobileHero
              activeTab={activeTab}
              festSlideIndex={festSlideIndex}
              setFestSlideIndex={setFestSlideIndex}
              headerProps={{
                setActiveTab,
                location: effectiveLocation,
                savedAddressText: savedAddressText,
                handleLocationClick,
                handleSearchFocus,
                placeholderIndex,
                placeholders,
                vegMode,
                handleVegModeChange,
                hideLocation: true,
                hideActions: true,
              }}
            />

            <HomeMobileStickyBar
              visible={showStickySearch}
              showCategories={showStickyCategories}
              onSearchFocus={handleSearchFocus}
              vegMode={vegMode}
              onVegModeChange={handleVegModeChange}
              categories={displayCategories}
              activeFilters={activeFilters}
              onOpenFilters={() => setIsFilterOpen(true)}
              onToggleFilter={(filterId) => {
                const nextFilters = new Set(activeFilters);
                if (nextFilters.has(filterId)) {
                  nextFilters.delete(filterId);
                } else {
                  nextFilters.add(filterId);
                }
                setActiveFilters(nextFilters);
                void applyFiltersAndRefetch(nextFilters, sortBy, selectedCuisine);
              }}
            />
          </div>

          <AnimatePresence mode="wait">
              <motion.div
                key="food-content"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="food-mobile-content"
              >
                <div id="categories-section">
                  <HomeMobileCategories categories={displayCategories} />
                </div>

                <PromoRow
                  variant="mobile"
                  handleVegModeChange={handleVegModeChange}
                  navigate={navigate}
                  isVegMode={vegMode}
                  under250PriceLimit={under250PriceLimit}
                />

                {HeroBannerSection}

              
              </motion.div>
          </AnimatePresence>
        </div>

        <div className="hidden md:block relative z-[1]">
          <HomeDesktopShell
            displayCategories={displayCategories}
            heroBanner={HeroBannerSection}
            handleSearchFocus={handleSearchFocus}
            vegMode={vegMode}
            handleVegModeChange={handleVegModeChange}
            under250PriceLimit={under250PriceLimit}
            navigate={navigate}
            activeFilters={activeFilters}
            setActiveFilters={setActiveFilters}
            applyFiltersAndRefetch={applyFiltersAndRefetch}
            sortBy={sortBy}
            selectedCuisine={selectedCuisine}
            setIsFilterOpen={setIsFilterOpen}
            festSlideIndex={festSlideIndex}
            setFestSlideIndex={setFestSlideIndex}
          />
        </div>

        <div className="relative z-[1] max-w-7xl mx-auto w-full">
        {recommendedForYouRestaurants.length > 0 && (
          <motion.section
            className="content-auto pt-1 sm:pt-2"
            initial={false}
            animate={{ opacity: 1, y: 0 }}>
            <div className="food-landing-section pt-2 sm:pt-3">
            <p className="food-landing-eyebrow mb-1">Curated for you</p>
            <h2 className="food-landing-title mb-3 sm:mb-4">Recommended</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
              {recommendedForYouRestaurants.map((restaurant, index) => {
                const restaurantSlug =
                  restaurant.slug ||
                  restaurant.name.toLowerCase().replace(/\s+/g, "-");
                const recommendedAvailability = getRestaurantAvailabilityStatus(
                  restaurant,
                  new Date(availabilityTick),
                );
                const isRecommendedOffline = !recommendedAvailability.isOpen;
                return (
                  <motion.div
                    key={`recommended-${restaurant.mongoId || restaurant.id || restaurantSlug}`}
                    initial={{ opacity: 0, y: 12 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.35, delay: index * 0.05 }}>
                    <Link
                      to={`/user/restaurants/${restaurantSlug}`}
                      className={`block rounded-[20px] overflow-hidden border border-gray-100 dark:border-gray-800 bg-white dark:bg-[#1a1a1a] shadow-sm transition-shadow ${isRecommendedOffline ? "grayscale opacity-75" : "hover:shadow-md"}`}>
                      <div className="relative h-24 sm:h-28 md:h-32 bg-gray-50">
                        <RestaurantImageCarousel
                          restaurant={restaurant}
                          backendOrigin={BACKEND_ORIGIN}
                          className="h-40 sm:h-28 md:h-32"
                          roundedClass="rounded-t-[20px]"
                        />
                        {isRecommendedOffline && (
                          <div
                            className="absolute inset-0 z-[8] bg-white/35 dark:bg-black/35 pointer-events-none rounded-t-[20px]"
                            aria-hidden="true"
                          />
                        )}
                        <RestaurantChainDistanceBadge
                          lastCartRestaurant={lastCartRestaurant}
                          restaurant={restaurant}
                        />
                        {hasDisplayableRestaurantRating(restaurant) && (
                          <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-lg bg-black/80 backdrop-blur-md text-white font-medium text-[10px] shadow-lg border border-white/10 flex items-center gap-1">
                            <Star className="w-3 h-3 fill-white text-white" strokeWidth={0} />
                            {formatRestaurantRating(restaurant)}
                          </div>
                        )}
                      </div>
                      <div className="p-2.5 min-h-[3.25rem]">
                        <p className="text-sm font-semibold text-foreground line-clamp-2 leading-snug break-words">
                          {restaurant.name}
                        </p>
                        {restaurant.address ? (
                          <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                            {restaurant.address}
                          </p>
                        ) : null}
                        {(restaurant.distance || restaurant.deliveryTime) && (
                          <p className="text-[11px] text-primary font-semibold mt-1 flex items-center gap-1">
                            {restaurant.distance ? (
                              <>
                                <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                                <span>{restaurant.distance}</span>
                              </>
                            ) : null}
                            {restaurant.distance && restaurant.deliveryTime ? (
                              <span className="text-muted-foreground font-normal">·</span>
                            ) : null}
                            {restaurant.deliveryTime ? (
                              <>
                                <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                                <span>{restaurant.deliveryTime}</span>
                              </>
                            ) : null}
                          </p>
                        )}
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </div>
            </div>
          </motion.section>
        )}

        {/* Restaurants - Enhanced with Animations */}
        <motion.section
          className="content-auto space-y-0 pt-4 sm:pt-5 lg:pt-6 pb-8 md:pb-10"
          initial={false}
          animate={{ opacity: 1 }}>
          <div className="food-landing-section mb-3 lg:mb-4">
            <p className="food-landing-eyebrow mb-1">
              {restaurantsPagination.total > filteredRestaurants.length
                ? `${filteredRestaurants.length} of ${restaurantsPagination.total} restaurants delivering to you`
                : `${filteredRestaurants.length} restaurants delivering to you`}
            </p>
            <h2 className="food-landing-title">All restaurants</h2>
          </div>
          <div
            className={`relative ${showRestaurantSkeleton ? "min-h-[360px] sm:min-h-[420px]" : ""}`}>
            {/* Loading Overlay */}
            <AnimatePresence>
              {showRestaurantSkeleton && (
                <motion.div
                  className="absolute inset-0 z-10 rounded-lg bg-white/94 dark:bg-[#1a1a1a]/94"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}>
                  <LoadingSkeletonRegion label="Loading restaurants" className="h-full p-1 sm:p-2">
                    <RestaurantGridSkeleton
                      count={3}
                      className="grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3"
                      compact
                    />
                  </LoadingSkeletonRegion>
                </motion.div>
              )}
            </AnimatePresence>
            <div
              className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5 lg:gap-6 food-landing-section pt-1 items-stretch ${loadingRestaurants ? "opacity-50" : "opacity-100"} transition-opacity duration-300`}>
              {filteredRestaurants.map((restaurant, index) => {
                const nameStr =
                  typeof restaurant?.name === "string"
                    ? restaurant.name.trim()
                    : "";
                const fallbackSlugSource =
                  nameStr ||
                  (typeof restaurant?.restaurantName === "string"
                    ? restaurant.restaurantName.trim()
                    : "") ||
                  String(
                    restaurant?.slug ||
                    restaurant?.id ||
                    restaurant?._id ||
                    `restaurant-${index}`,
                  );

                const restaurantSlug =
                  typeof restaurant?.slug === "string" &&
                    restaurant.slug.trim()
                    ? restaurant.slug.trim()
                    : fallbackSlugSource.toLowerCase().replace(/\s+/g, "-");
                const availabilityStatus = getRestaurantAvailabilityStatus(
                  restaurant,
                  new Date(availabilityTick),
                );
                const isRestaurantOffline = !availabilityStatus.isOpen;
                const closingCountdown = availabilityStatus.closingCountdownLabel
                  ? availabilityStatus.closingCountdownLabel.replace(/closes\s+in\s*/i, "")
                  : "";
                const hasClosingCountdown =
                  availabilityStatus.isOpen &&
                  closingCountdown &&
                  availabilityStatus.openingTime &&
                  availabilityStatus.closingTime &&
                  availabilityStatus.minutesUntilClose <= 60;
                // Direct favorite check - isFavorite is already memoized in context
                const favorite = isFavorite(restaurantSlug);

                const handleToggleFavorite = (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (favorite) {
                    // If already bookmarked, show Manage Collections modal
                    setSelectedRestaurantSlug(restaurantSlug);
                    setShowManageCollections(true);
                  } else {
                    // Add to favorites and show toast
                    addFavorite({
                      slug: restaurantSlug,
                      name: restaurant.name,
                      cuisine: restaurant.cuisine,
                      rating: restaurant.rating,
                      deliveryTime: restaurant.deliveryTime,
                      distance: restaurant.distance,
                      priceRange: restaurant.priceRange,
                      image: restaurant.image,
                    });
                    setShowToast(true);
                    setTimeout(() => {
                      setShowToast(false);
                    }, 3000);
                  }
                };

                return (
                  <div
                    key={
                      restaurant?.id ||
                      restaurant?._id ||
                      restaurantSlug ||
                      index
                    }
                    className={`h-full transform transition-all duration-300 ${isRestaurantOffline ? "" : "hover:-translate-y-3 hover:scale-[1.02]"}`}
                    style={{
                      perspective: 1000,
                      animation:
                        index < 10
                          ? `fade-in-up 0.5s ease-out ${index * 0.05}s backwards`
                          : "none",
                    }}>
                    <div className="h-full group">
                      <Link
                        to={`/user/restaurants/${restaurantSlug}`}
                        className="h-full flex">
                        <Card
                          className={`overflow-hidden gap-0 cursor-pointer border-0 dark:border-gray-800 group bg-white dark:bg-[#1a1a1a] border-background transition-all duration-500 py-0 rounded-[28px] flex flex-col h-full w-full relative shadow-[0_12px_40px_rgba(26,37,23,0.12)] ${isRestaurantOffline ? "grayscale opacity-75" : "hover:shadow-[0_30px_60px_rgba(26,37,23,0.20)]"}`}>
                          {/* Image Section with Carousel */}
                          <div className="relative">
                            <RestaurantImageCarousel
                              restaurant={restaurant}
                              priority={index < 3}
                              backendOrigin={BACKEND_ORIGIN}
                              className="h-48 sm:h-40 md:h-48 lg:h-56"
                              roundedClass="rounded-t-[28px]"
                            />
                            {isRestaurantOffline && (
                              <div
                                className="absolute inset-0 z-[8] bg-white/35 dark:bg-black/35 pointer-events-none rounded-t-[28px]"
                                aria-hidden="true"
                              />
                            )}

                            {/* Featured Dish Badge - Top Left */}
                            {restaurant.featuredDish && restaurant.featuredPrice && (
                            <div className="absolute top-3 left-3 sm:top-4 sm:left-4 flex items-center z-10 transform transition-transform duration-300 group-hover:scale-105">
                              <div className="bg-black/70 backdrop-blur-lg text-white px-2.5 sm:px-4 py-1 rounded-full text-[9px] sm:text-[11px] font-medium tracking-tight flex items-center shadow-2xl border border-white/20">
                                {restaurant.featuredDish} • ₹
                                {restaurant.featuredPrice}
                              </div>
                            </div>
                            )}

                            {/* Bookmark Icon - Top Right */}
                            <div className="absolute top-3 right-3 sm:top-4 sm:right-4 z-10 transform transition-transform duration-300 group-hover:scale-110">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={handleToggleFavorite}
                                aria-label={
                                  favorite
                                    ? "Remove from favorites"
                                    : "Add to favorites"
                                }
                                className={`h-9 w-9 sm:h-11 sm:w-11 rounded-[16px] sm:rounded-[20px] shadow-xl flex items-center justify-center transition-all duration-300 ${favorite
                                  ? "bg-red-500 text-white"
                                  : "bg-white/90 backdrop-blur-sm text-gray-800 hover:bg-white"
                                  }`}>
                                <Bookmark
                                  className={`h-4 w-4 sm:h-5 sm:w-5 transition-all duration-300 ${favorite ? "fill-white" : ""
                                    }`}
                                />
                              </Button>
                            </div>

                            <RestaurantChainDistanceBadge
                              lastCartRestaurant={lastCartRestaurant}
                              restaurant={restaurant}
                            />
                          </div>

                          {/* Content Section */}
                          <div className="transform transition-transform duration-300 group-hover:-translate-y-1">
                            <CardContent className="p-2.5 sm:p-4 lg:p-5 pt-2.5 sm:pt-4 lg:pt-5 flex flex-col flex-grow">
                              {/* Restaurant Name & Rating */}
                              <div className="flex items-start justify-between gap-2 mb-2 lg:mb-3">
                                <div className="flex-1 min-w-0">
                                  <h3 className="text-base sm:text-lg font-bold text-foreground line-clamp-2 leading-tight group-hover:text-primary transition-colors break-words">
                                    {restaurant.name}
                                  </h3>
                                  {restaurant.address ? (
                                    <p className="text-xs text-muted-foreground line-clamp-1 mt-1">
                                      {restaurant.address}
                                    </p>
                                  ) : null}
                                  {hasClosingCountdown && (
                                    <div className="flex items-center gap-1 mt-2 text-[9px] sm:text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                                      <Timer className="h-3 w-3 flex-shrink-0" strokeWidth={3} />
                                      <span>
                                        Closes in {closingCountdown}
                                      </span>
                                    </div>
                                  )}
                                </div>
                                {hasDisplayableRestaurantRating(restaurant) && (
                                  <div className="flex-shrink-0 min-w-[52px] justify-center bg-primary text-primary-foreground px-2.5 sm:px-3 py-1 rounded-2xl flex items-center gap-1 shadow-sm">
                                    <span className="text-xs sm:text-sm font-bold">
                                      {formatRestaurantRating(restaurant)}
                                    </span>
                                    <Star className="h-3 w-3 sm:h-3.5 sm:w-3.5 lg:h-4.5 lg:w-4.5 fill-white text-white" strokeWidth={0} />
                                  </div>
                                )}
                              </div>

                              {/* Delivery Time & Distance */}
                              {(restaurant.deliveryTime || restaurant.distance) && (
                              <div className="flex items-center gap-1 text-xs sm:text-sm text-muted-foreground mb-2 lg:mb-3">
                                {restaurant.deliveryTime ? (
                                  <>
                                <Clock
                                  className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground"
                                  strokeWidth={1.5}
                                />
                                <span className="font-medium text-foreground/80">
                                  {restaurant.deliveryTime}
                                </span>
                                  </>
                                ) : null}
                                {restaurant.deliveryTime && restaurant.distance ? (
                                <span className="mx-1 text-border">|</span>
                                ) : null}
                                {restaurant.distance ? (
                                <span className="font-medium text-foreground/80">
                                  {restaurant.distance}
                                </span>
                                ) : null}
                              </div>
                              )}

                              {/* Offer Badge */}
                              {restaurant.offer && (
                                <div className="flex items-center gap-2 text-xs sm:text-sm mt-auto">
                                  <BadgePercent
                                    className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-primary"
                                    strokeWidth={2.5}
                                  />
                                  <span className="text-primary font-semibold text-[11px] sm:text-xs">
                                    {restaurant.offer}
                                  </span>
                                </div>
                              )}
                            </CardContent>
                          </div>

                          {/* Border Glow Effect */}
                          <div className="absolute inset-0 rounded-md pointer-events-none z-0 transition-all duration-300 border border-transparent group-hover:border-[#0F172A]/30 group-hover:shadow-[inset_0_0_0_1px_rgba(235,89,14,0.2)]" />
                        </Card>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col items-center pt-2 sm:pt-3 gap-2 food-landing-section">
            {hasMoreRestaurants && (
              <Button
                variant="outline"
                onClick={loadMoreRestaurants}
                disabled={loadingMoreRestaurants}
                className="text-sm font-medium border-gray-300 hover:border-gray-400">
                {loadingMoreRestaurants ? "Loading..." : "Load more restaurants"}
              </Button>
            )}
            <div
              ref={restaurantLoadMoreRef}
              className="h-1 w-full"
              aria-hidden="true"
            />
          </div>
        </motion.section>
        </div>
      </div>

      {/* Filter Modal - Bottom Sheet */}
      <AnimatePresence>
        {isFilterOpen && (
          <div className="fixed inset-0 z-[100]">
            {/* Backdrop */}
            <motion.div
              className="absolute inset-0 bg-black/50"
              onClick={() => setIsFilterOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            />

            {/* Modal Content */}
            <motion.div
              className="absolute bottom-0 left-0 right-0 bg-white dark:bg-[#1a1a1a] rounded-t-3xl max-h-[85vh] flex flex-col"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{
                type: "spring",
                damping: 30,
                stiffness: 400,
                duration: 0.3,
              }}>
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-4 border-b dark:border-gray-800">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                  Filters and sorting
                </h2>
                <button
                  onClick={() => {
                    setActiveFilters(new Set());
                    setSortBy(null);
                    setSelectedCuisine(null);
                  }}
                  className="text-[#0F172A] font-medium text-sm">
                  Clear all
                </button>
              </div>

              {/* Body */}
              <div className="flex flex-1 overflow-hidden">
                {/* Left Sidebar - Tabs */}
                <div className="w-24 sm:w-28 bg-gray-50 dark:bg-[#0a0a0a] border-r dark:border-gray-800 flex flex-col">
                  {[
                    { id: "sort", label: "Sort By", icon: ArrowDownUp },
                    { id: "time", label: "Time", icon: Timer },
                    { id: "rating", label: "Rating", icon: Star },
                    { id: "distance", label: "Distance", icon: MapPin },
                    { id: "price", label: "Dish Price", icon: IndianRupee },
                    { id: "offers", label: "Offers", icon: BadgePercent },
                    { id: "trust", label: "Trust", icon: ShieldCheck },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    const isActive =
                      activeScrollSection === tab.id ||
                      activeFilterTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => {
                          setActiveFilterTab(tab.id);
                          const section = filterSectionRefs.current[tab.id];
                          if (section) {
                            section.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            });
                          }
                        }}
                        className={`flex flex-col items-center gap-1 py-4 px-2 text-center relative transition-colors ${isActive
                          ? "bg-white dark:bg-[#1a1a1a] text-[#0F172A]"
                          : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                          }`}>
                        {isActive && (
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#0F172A] rounded-r" />
                        )}
                        <Icon className="h-5 w-5" strokeWidth={1.5} />
                        <span className="text-xs font-medium leading-tight">
                          {tab.label}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Right Content Area - Scrollable */}
                <div
                  ref={rightContentRef}
                  className="flex-1 overflow-y-auto p-4">
                  {/* Sort By Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["sort"] = el)}
                    data-section-id="sort"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Sort by
                    </h3>
                    <div className="flex flex-col gap-3">
                      {[
                        { id: null, label: "Relevance" },
                        { id: "price-low", label: "Price: Low to High" },
                        { id: "price-high", label: "Price: High to Low" },
                        { id: "rating-high", label: "Rating: High to Low" },
                        { id: "rating-low", label: "Rating: Low to High" },
                      ].map((option) => (
                        <button
                          key={option.id || "relevance"}
                          onClick={() => setSortBy(option.id)}
                          className={`px-4 py-3 rounded-xl border text-left transition-colors ${sortBy === option.id
                            ? "border-[#0F172A] bg-[#F0FDF420] dark:bg-green-900/20"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#0F172A]"
                            }`}>
                          <span
                            className={`text-sm font-medium ${sortBy === option.id ? "text-[#0F172A]" : "text-gray-700 dark:text-gray-300"}`}>
                            {option.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Time Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["time"] = el)}
                    data-section-id="time"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Estimated Time
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => toggleFilter("delivery-under-30")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("delivery-under-30")
                          ? "border-[#0F172A] bg-[#F0FDF420] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#0F172A]"
                          }`}>
                        <Timer
                          className={`h-6 w-6 ${activeFilters.has("delivery-under-30") ? "text-[#0F172A]" : "text-gray-600 dark:text-gray-400"}`}
                          strokeWidth={1.5}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("delivery-under-30") ? "text-[#0F172A]" : "text-gray-700 dark:text-gray-300"}`}>
                          Under 30 mins
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("delivery-under-45")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("delivery-under-45")
                          ? "border-[#0F172A] bg-[#F0FDF420] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#0F172A]"
                          }`}>
                        <Timer
                          className={`h-6 w-6 ${activeFilters.has("delivery-under-45") ? "text-[#0F172A]" : "text-gray-600 dark:text-gray-400"}`}
                          strokeWidth={1.5}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("delivery-under-45") ? "text-[#0F172A]" : "text-gray-700 dark:text-gray-300"}`}>
                          Under 45 mins
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Rating Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["rating"] = el)}
                    data-section-id="rating"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900  dark:text-white mb-4">
                      Restaurant Rating
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => toggleFilter("rating-35-plus")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("rating-35-plus")
                          ? "border-[#0F172A] bg-[#F0FDF420] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#0F172A]"
                          }`}>
                        <Star
                          className={`h-6 w-6 ${activeFilters.has("rating-35-plus") ? "text-[#0F172A] fill-[#0F172A]" : "text-gray-400 dark:text-gray-500"}`}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("rating-35-plus") ? "text-[#0F172A]" : "text-gray-700 dark:text-gray-300"}`}>
                          Rated 3.5+
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("rating-4-plus")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("rating-4-plus")
                          ? "border-[#0F172A] bg-[#F0FDF420] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#0F172A]"
                          }`}>
                        <Star
                          className={`h-6 w-6 ${activeFilters.has("rating-4-plus") ? "text-[#0F172A] fill-[#0F172A]" : "text-gray-400 dark:text-gray-500"}`}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("rating-4-plus") ? "text-[#0F172A]" : "text-gray-700 dark:text-gray-300"}`}>
                          Rated 4.0+
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("rating-45-plus")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("rating-45-plus")
                          ? "border-[#0F172A] bg-[#F0FDF420] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#0F172A]"
                          }`}>
                        <Star
                          className={`h-6 w-6 ${activeFilters.has("rating-45-plus") ? "text-[#0F172A] fill-[#0F172A]" : "text-gray-400 dark:text-gray-500"}`}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("rating-45-plus") ? "text-[#0F172A]" : "text-gray-700 dark:text-gray-300"}`}>
                          Rated 4.5+
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Distance Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["distance"] = el)}
                    data-section-id="distance"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Distance
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => toggleFilter("distance-under-1km")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("distance-under-1km")
                          ? "border-[#0F172A] bg-[#F0FDF420] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#0F172A]"
                          }`}>
                        <MapPin
                          className={`h-6 w-6 ${activeFilters.has("distance-under-1km") ? "text-[#0F172A]" : "text-gray-600 dark:text-gray-400"}`}
                          strokeWidth={1.5}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("distance-under-1km") ? "text-[#0F172A]" : "text-gray-700 dark:text-gray-300"}`}>
                          Under 1 km
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("distance-under-2km")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("distance-under-2km")
                          ? "border-[#0F172A] bg-[#F0FDF420] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#0F172A]"
                          }`}>
                        <MapPin
                          className={`h-6 w-6 ${activeFilters.has("distance-under-2km") ? "text-[#0F172A]" : "text-gray-600 dark:text-gray-400"}`}
                          strokeWidth={1.5}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("distance-under-2km") ? "text-[#0F172A]" : "text-gray-700 dark:text-gray-300"}`}>
                          Under 2 km
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Price Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["price"] = el)}
                    data-section-id="price"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Dish Price
                    </h3>
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => toggleFilter("price-under-200")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("price-under-200")
                          ? "border-[#0F172A] bg-[#F0FDF420] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#0F172A]"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("price-under-200") ? "text-[#0F172A]" : "text-gray-700 dark:text-gray-300"}`}>
                          Under ₹200
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("price-under-500")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("price-under-500")
                          ? "border-[#0F172A] bg-[#F0FDF420] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#0F172A]"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("price-under-500") ? "text-[#0F172A]" : "text-gray-700 dark:text-gray-300"}`}>
                          Under ₹500
                        </span>
                      </button>
                    </div>
                  </div>



                  {/* Trust Markers Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["trust"] = el)}
                    data-section-id="trust"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Trust Markers
                    </h3>
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => toggleFilter("top-rated")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("top-rated")
                          ? "border-[#0F172A] bg-[#F0FDF420] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#0F172A]"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("top-rated") ? "text-[#0F172A]" : "text-gray-700 dark:text-gray-300"}`}>
                          Top Rated
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("trusted")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("trusted")
                          ? "border-[#0F172A] bg-[#F0FDF420] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#0F172A]"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("trusted") ? "text-[#0F172A]" : "text-gray-700 dark:text-gray-300"}`}>
                          Trusted by 1000+ users
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Offers Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["offers"] = el)}
                    data-section-id="offers"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Offers
                    </h3>
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => toggleFilter("has-offers")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("has-offers")
                          ? "border-[#0F172A] bg-[#F0FDF420] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#0F172A]"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("has-offers") ? "text-[#0F172A]" : "text-gray-700 dark:text-gray-300"}`}>
                          Restaurants with offers
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center gap-4 px-4 py-4 border-t dark:border-gray-800 bg-white dark:bg-[#1a1a1a]">
                <button
                  onClick={() => setIsFilterOpen(false)}
                  className="flex-1 py-3 text-center font-semibold text-gray-700 dark:text-gray-300">
                  Close
                </button>
                <button
                  onClick={async () => {
                    setIsFilterOpen(false);
                    await applyFiltersAndRefetch(
                      activeFilters,
                      sortBy,
                      selectedCuisine,
                    );
                  }}
                  className={`flex-1 py-3 font-semibold rounded-xl transition-colors ${activeFilters.size > 0 || sortBy || selectedCuisine
                    ? "bg-[#0F172A] text-white hover:bg-[#15803D]"
                    : "bg-gray-200 text-gray-500"
                    }`}
                  disabled={loadingRestaurants}>
                  {loadingRestaurants
                    ? "Loading..."
                    : activeFilters.size > 0 || sortBy || selectedCuisine
                      ? `Show results`
                      : "Show results"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Unified Veg Mode Popups */}
      <VegModePopups
        showVegModePopup={showVegModePopup}
        showSwitchOffPopup={showSwitchOffPopup}
        onCloseVegPopup={() => {
          setShowVegModePopup(false);
          setIsApplyingVegMode(true);
          setVegModeContext(true);
          setPrevVegMode(true);
          setTimeout(() => setIsApplyingVegMode(false), 2000);
        }}
        onCloseSwitchOffPopup={() => {
          setShowSwitchOffPopup(false);
          isHandlingSwitchOff.current = false;
          setVegModeContext(true);
        }}
        onConfirmSwitchOff={() => {
          setShowSwitchOffPopup(false);
          setIsSwitchingOffVegMode(true);
          setTimeout(() => {
            setIsSwitchingOffVegMode(false);
            isHandlingSwitchOff.current = false;
            setVegModeContext(false);
            setPrevVegMode(false);
          }, 2000);
        }}
      />

      {/* All Categories Modal */}
      <AnimatePresence>
        {showAllCategoriesModal && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setShowAllCategoriesModal(false)}
              className="fixed inset-0 bg-black/40 z-[9998] backdrop-blur-sm"
            />

            {/* Modal - Full screen with rounded corners */}
            <motion.div
              initial={{ opacity: 0, y: "100%" }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: "100%" }}
              transition={{
                type: "spring",
                damping: 30,
                stiffness: 300,
              }}
              className="fixed inset-x-0 bottom-0 top-12 sm:top-16 md:top-20 z-[9999] bg-white dark:bg-[#1a1a1a] rounded-t-3xl shadow-2xl overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 sm:px-6 sm:py-5 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
                <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">
                  All Categories
                </h2>
                <button
                  onClick={() => setShowAllCategoriesModal(false)}
                  className="p-1.5 sm:p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  aria-label="Close">
                  <X className="w-5 h-5 sm:w-6 sm:h-6 text-gray-600 dark:text-gray-400" />
                </button>
              </div>

              {/* Categories Grid - Scrollable */}
              <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 sm:py-5">
                <div className="grid grid-cols-3 gap-4 sm:gap-5 md:gap-6">
                  {displayCategories.map((category, index) => {
                    const categoryData = {
                      name: category.name || category.label,
                      image: category.image || category.imageUrl,
                      slug: category.slug,
                    };
                    return (
                      <motion.div
                        key={category.id || index}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{
                          duration: 0.3,
                          delay: index * 0.02,
                          type: "spring",
                          stiffness: 100,
                        }}
                        whileTap={{ scale: 0.95 }}>
                        <Link
                          to={`/user/category/${categoryData.slug || categoryData.name.toLowerCase().replace(/\s+/g, "-")}`}
                          onClick={() => setShowAllCategoriesModal(false)}
                          className="block">
                          <div className="flex flex-col items-center gap-2 sm:gap-2.5 cursor-pointer w-full">
                            <div className="w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 rounded-full overflow-hidden shadow-md transition-all hover:shadow-lg flex-shrink-0">
                              <OptimizedImage
                                src={categoryData.image}
                                alt={categoryData.name}
                                className="w-full h-full bg-white rounded-full"
                                sizes="(max-width: 640px) 80px, (max-width: 768px) 96px, 112px"
                                objectFit="cover"
                                placeholder="blur"
                                onError={() => { }}
                              />
                            </div>
                            <span className="text-xs sm:text-sm font-medium text-gray-800 dark:text-gray-200 text-center leading-tight px-1 break-words w-full min-w-0">
                              {categoryData.name}
                            </span>
                          </div>
                        </Link>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isApplyingVegMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[10000] bg-white dark:bg-[#0a0a0a] flex items-center justify-center">
            <div className="relative w-32 h-32 flex items-center justify-center w-full">
              {/* Animated circles - positioned absolutely at the center */}
              {[...Array(8)].map((_, i) => {
                const baseSize = 112;
                const maxSize = 600;
                return (
                  <motion.div
                    key={i}
                    initial={{
                      scale: 1,
                      opacity: 0,
                    }}
                    animate={{
                      scale: maxSize / baseSize,
                      opacity: [0, 0.4, 0.2, 0],
                    }}
                    transition={{
                      duration: 2.5,
                      repeat: Number.POSITIVE_INFINITY,
                      ease: "easeOut",
                      delay: i * 0.15,
                    }}
                    className="absolute rounded-full border border-green-300 dark:border-green-600"
                    style={{
                      width: baseSize,
                      height: baseSize,
                    }}
                  />
                );
              })}

              {/* 100% VEG badge - absolute positioning at exact center */}
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 200,
                  damping: 15,
                  delay: 0.1,
                }}
                className="absolute z-10 w-28 h-28 rounded-full border-2 border-green-600 dark:border-green-500 bg-white dark:bg-[#1a1a1a] flex flex-col items-center justify-center shadow-sm"
              >
                <motion.div
                  className="flex flex-col items-center"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}>
                  <span className="text-green-600 dark:text-green-400 font-extrabold text-3xl leading-none">
                    100%
                  </span>
                  <span className="text-green-600 dark:text-green-400 font-extrabold text-3xl leading-none mt-0.5">
                    VEG
                  </span>
                </motion.div>
              </motion.div>

              {/* Text below badge */}
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="text-xl font-normal text-gray-800 dark:text-gray-200 text-center relative z-10 mt-56 w-full">
                Explore veg dishes from all restaurants
              </motion.p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading Screen - Switching Off Veg Mode */}
      <AnimatePresence>
        {isSwitchingOffVegMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[10000] bg-white dark:bg-[#0a0a0a] flex items-center justify-center">
            <div className="flex flex-col items-center gap-6">
              {/* Two Circles Spinning in Opposite Directions */}
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 200,
                  damping: 15,
                  delay: 0.1,
                }}
                className="relative w-16 h-16 flex items-center justify-center">
                {/* Outer Circle - Spins Clockwise */}
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{
                    rotate: {
                      duration: 1.5,
                      repeat: Infinity,
                      ease: "linear",
                    },
                  }}
                  className="absolute w-16 h-16 border-[4px] border-transparent border-t-pink-500 dark:border-t-pink-400 border-r-pink-500 dark:border-r-pink-400 rounded-full"
                />

                {/* Inner Circle - Spins Counter-clockwise */}
                <motion.div
                  animate={{ rotate: -360 }}
                  transition={{
                    rotate: {
                      duration: 1,
                      repeat: Infinity,
                      ease: "linear",
                    },
                  }}
                  className="absolute w-12 h-12 border-[4px] border-transparent border-r-pink-500 dark:border-r-pink-400 rounded-full"
                />
              </motion.div>

              {/* Loading Text */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-center">
                <motion.h2
                  className="text-xl font-normal text-gray-800 dark:text-gray-200 mb-1"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}>
                  Switching off
                </motion.h2>
                <motion.p
                  className="text-xl font-normal text-gray-800 dark:text-gray-200"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}>
                  Veg Mode for you
                </motion.p>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast Notification - Fixed to viewport bottom */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showToast && (
              <motion.div
                initial={{ y: 100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 100, opacity: 0 }}
                transition={{ duration: 0.3, type: "spring", damping: 25 }}
                className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[10001] bg-black text-white px-6 py-3 rounded-lg shadow-2xl">
                <p className="text-sm font-medium">Added to bookmark</p>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
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
                  className="fixed left-0 right-0 bottom-0 z-[10000] bg-white rounded-t-3xl shadow-2xl"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{
                    duration: 0.2,
                    type: "spring",
                    damping: 30,
                    stiffness: 400,
                  }}>
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 pt-6 pb-4 border-b border-gray-200">
                    <h2 className="text-lg font-bold text-gray-900">
                      Manage Collections
                    </h2>
                    <button
                      onClick={() => setShowManageCollections(false)}
                      className="h-8 w-8 rounded-full bg-gray-700 flex items-center justify-center hover:bg-gray-800 transition-colors">
                      <X className="h-4 w-4 text-white" />
                    </button>
                  </div>

                  {/* Collections List */}
                  <div className="px-4 py-4 space-y-2 max-h-[60vh] overflow-y-auto">
                    {/* Bookmarks Collection */}
                    <div
                      className="w-full flex items-start gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Don't close modal on click, let checkbox handle it
                      }}>
                      <div className="h-12 w-12 rounded-lg bg-pink-100 flex items-center justify-center flex-shrink-0">
                        <Bookmark className="h-6 w-6 text-red-500 fill-red-500" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="flex items-center justify-between">
                          <span className="text-base font-medium text-gray-900">
                            Bookmarks
                          </span>
                          {selectedRestaurantSlug && (
                            <div onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={isFavorite(selectedRestaurantSlug)}
                                onCheckedChange={(checked) => {
                                  if (!checked) {
                                    removeFavorite(selectedRestaurantSlug);
                                    setSelectedRestaurantSlug(null);
                                    setShowManageCollections(false);
                                  }
                                }}
                                className="h-5 w-5 rounded border-2 border-red-500 data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500"
                              />
                            </div>
                          )}
                          {!selectedRestaurantSlug && (
                            <div className="h-5 w-5 rounded border-2 border-red-500 bg-red-500 flex items-center justify-center">
                              <Check className="h-3 w-3 text-white" />
                            </div>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 mt-1">
                          {getFavorites().length} restaurant
                          {getFavorites().length !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>

                    {/* Create new Collection */}
                    <button
                      className="w-full flex items-start gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors"
                      onClick={() => setShowManageCollections(false)}>
                      <div className="h-12 w-12 rounded-lg bg-pink-100 flex items-center justify-center flex-shrink-0">
                        <Plus className="h-6 w-6 text-red-500" />
                      </div>
                      <div className="flex-1 text-left">
                        <span className="text-base font-medium text-gray-900">
                          Create new Collection
                        </span>
                      </div>
                    </button>
                  </div>

                  {/* Done Button */}
                  <div className="border-t border-gray-200 px-4 py-4">
                    <Button
                      className="w-full bg-gray-300 hover:bg-gray-400 text-gray-700 py-3 rounded-lg font-medium"
                      onClick={() => {
                        setSelectedRestaurantSlug(null);
                        setShowManageCollections(false);
                      }}>
                      Done
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )}

      <StickyCartCard />
      {/* Live order strip: only on homepage (not in UserLayout) */}
      <OrderTrackingCard hasBottomNav />
    </div>
  );
}

