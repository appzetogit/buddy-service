/**
 * Self-healing geo coordinates for restaurants.
 *
 * A restaurant saved without usable coordinates has its `location` dropped entirely by the
 * model's pre-save hook (see restaurant.model.js - it is removed rather than written, so the
 * 2dsphere index never sees a malformed point). Everything downstream then has no pickup point:
 *
 *   - dispatch ranks riders from a [0, 0] fallback (Null Island), so no rider is ever "near"
 *     and the offer carries no `pickupDistanceKm`;
 *   - the rider's offer card and in-trip header have nothing to measure against, which is why
 *     they showed no distance at all.
 *
 * So when a restaurant is missing coordinates, geocode its address once, persist the result and
 * carry on. forwardGeocode is cached (Redis + Mongo), and the write means a given restaurant
 * costs at most one lookup ever.
 *
 * Every entry point FAILS SOFT: no API key, no address, a geocoder error or a write failure all
 * return null and leave the caller on exactly the path it took before this module existed.
 */
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { forwardGeocode } from '../../../../core/location/geocode.service.js';
import {
  extractLatLng,
  isValidNonZeroCoordinate,
} from '../../../../core/location/location.schema.js';
import { logger } from '../../../../utils/logger.js';

/** Restaurants we have already failed to geocode this process - do not retry in a hot loop. */
const failedLookups = new Set();

/** Build the most specific single-line address we can from a restaurant's flat fields. */
export function buildRestaurantAddress(restaurant) {
  if (!restaurant) return '';
  const loc = restaurant.location || {};
  const parts = [
    restaurant.addressLine1 || loc.addressLine1 || loc.address,
    restaurant.addressLine2 || loc.addressLine2,
    restaurant.landmark || loc.landmark,
    restaurant.area || loc.area,
    restaurant.city || loc.city,
    restaurant.state || loc.state,
    restaurant.pincode || loc.pincode,
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean);

  // De-duplicate repeated fragments ("Indore, Indore") without reordering.
  const seen = new Set();
  const unique = parts.filter((p) => {
    const key = p.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.join(', ');
}

/**
 * Usable pickup coordinates for a restaurant, geocoding and persisting them if they are missing.
 *
 * @param {object|string} restaurantLike A restaurant document/lean object, or its id.
 * @returns {Promise<{lat: number, lng: number} | null>}
 */
export async function ensureRestaurantCoordinates(restaurantLike) {
  if (!restaurantLike) return null;

  let restaurant = restaurantLike;
  const restaurantId = String(restaurantLike?._id || restaurantLike || '');

  // Called with just an id: load the fields needed to geocode.
  if (typeof restaurantLike === 'string' || !restaurantLike.location) {
    if (typeof restaurantLike !== 'string' && restaurantLike.addressLine1) {
      // Already has address fields; keep the object we were handed.
    } else if (restaurantId) {
      restaurant = await FoodRestaurant.findById(restaurantId)
        .select('location addressLine1 addressLine2 area city state pincode landmark restaurantName')
        .lean();
    }
  }
  if (!restaurant) return null;

  const existing = extractLatLng(restaurant.location);
  if (existing && isValidNonZeroCoordinate(existing.lat, existing.lng)) return existing;

  const id = String(restaurant._id || restaurantId || '');
  if (!id || failedLookups.has(id)) return null;

  const address = buildRestaurantAddress(restaurant);
  if (address.length < 3) {
    failedLookups.add(id);
    logger.warn(
      `[RestaurantGeo] ${restaurant.restaurantName || id} has no coordinates and no usable address; distance will stay unavailable.`,
    );
    return null;
  }

  let geo;
  try {
    geo = await forwardGeocode(address, { country: 'IN' });
  } catch (err) {
    failedLookups.add(id);
    logger.warn(`[RestaurantGeo] geocode failed for ${id} ("${address}"): ${err?.message || err}`);
    return null;
  }

  if (!geo || !isValidNonZeroCoordinate(geo.lat, geo.lng)) {
    failedLookups.add(id);
    return null;
  }

  // Persist so every later dispatch, socket payload and API read already has the point.
  // updateOne (not save) deliberately: it writes only `location` and cannot trip the model's
  // pre-save migration logic on unrelated fields.
  try {
    await FoodRestaurant.updateOne(
      { _id: id },
      {
        $set: {
          location: {
            type: 'Point',
            coordinates: [geo.lng, geo.lat],
            latitude: geo.lat,
            longitude: geo.lng,
            formattedAddress: geo.formattedAddress || address,
            address: geo.formattedAddress || address,
            addressLine1: restaurant.addressLine1 || geo.addressLine1 || '',
            area: restaurant.area || geo.area || '',
            city: restaurant.city || geo.city || '',
            state: restaurant.state || geo.state || '',
            pincode: restaurant.pincode || geo.pincode || '',
            placeId: geo.placeId || undefined,
          },
        },
      },
    );
    logger.info(
      `[RestaurantGeo] backfilled coordinates for ${restaurant.restaurantName || id} from "${address}".`,
    );
  } catch (err) {
    // The coordinates are still good for this request even if the write failed.
    logger.warn(`[RestaurantGeo] could not persist coordinates for ${id}: ${err?.message || err}`);
  }

  return { lat: geo.lat, lng: geo.lng };
}
