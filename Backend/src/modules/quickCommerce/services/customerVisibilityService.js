import Seller from "../models/seller.js";
import { calculateDistance } from "../utils/helper.js";
import { buildKey, getOrSet, getTTL } from "./cacheService.js";
import { detectZoneIdForCoordinates } from "./zoneDetectionService.js";

const MAX_SELLER_SEARCH_DISTANCE_M = 100000;

export function parseCustomerCoordinates(query = {}) {
  const lat = Number(query.lat);
  const lng = Number(query.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { valid: false, lat: null, lng: null };
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { valid: false, lat: null, lng: null };
  }

  return { valid: true, lat, lng };
}

/**
 * Round lat/lng to 4 decimal places (~11m precision) for cache key.
 * This groups nearby requests into the same cache bucket.
 */
function buildNearbySellersKey(lat, lng) {
  const rLat = Number(lat).toFixed(4);
  const rLng = Number(lng).toFixed(4);
  return buildKey("sellers", "nearby", `${rLat}:${rLng}`);
}

export async function getNearbySellerIdsForCustomer(lat, lng) {
  const fetchFn = async () => {
    const customerZoneId = await detectZoneIdForCoordinates(lat, lng);
    if (!customerZoneId) {
      return [];
    }

    const sellers = await Seller.find({
      isActive: true,
      isVerified: true,
      zoneId: customerZoneId,
    })
      .select("_id")
      .lean();

    return sellers.map((seller) => String(seller._id));
  };

  return getOrSet(buildNearbySellersKey(lat, lng), fetchFn, getTTL("nearbySellers"));
}
