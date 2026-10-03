import { Client } from '@googlemaps/google-maps-services-js';
import { logger } from '../../utils/logger.js';
import { getRedisClient } from './sharedRedisClient.js';
import { haversineMeters, formatDistanceLabel } from './haversine.util.js';

/**
 * Centralized road-distance service, moved from
 * Backend/src/modules/food/shared/utils/restaurantDistance.js and
 * generalized from "restaurant list" to "any two points" so it can serve all
 * three legs: user<->restaurant, restaurant<->driver, driver<->user.
 *
 * Uses the same ioredis client as geocode.service.js, with
 * an in-memory Map fallback so a distance lookup never hard-fails just
 * because the cache is unavailable.
 */

export { formatDistanceLabel };

const mapsClient = new Client({});

const getGoogleMapsApiKey = () => (
    process.env.GOOGLE_MAPS_API_KEY?.trim()
    || process.env.GOOGLE_MAPS_SERVER_KEY?.trim()
    || process.env.VITE_GOOGLE_MAPS_API_KEY?.trim()
    || ''
);

export const MAX_BATCH_SIZE = parseInt(process.env.DISTANCE_MATRIX_MAX_BATCH || '25', 10);

const CACHE_TTL_SEC = 15 * 60; // 15 min
const REDIS_KEY_PREFIX = 'roadDist:v1:';

/** @type {Map<string, { ts: number, meters: number }>} */
const memoryCache = new Map();

const roundCoord = (value) => Math.round(Number(value) * 1e4) / 1e4;

const buildCacheKey = (origin, dest) => (
    `${roundCoord(origin.lat)},${roundCoord(origin.lng)}|${roundCoord(dest.lat)},${roundCoord(dest.lng)}`
);

const readCachedDistance = async (origin, dest) => {
    const key = buildCacheKey(origin, dest);

    const redis = getRedisClient();
    if (redis) {
        try {
            const cached = await redis.get(`${REDIS_KEY_PREFIX}${key}`);
            if (cached !== null && cached !== undefined) {
                const meters = Number(cached);
                if (Number.isFinite(meters)) return meters;
            }
        } catch {
            // fall through to memory cache
        }
    }

    const hit = memoryCache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.ts > CACHE_TTL_SEC * 1000) {
        memoryCache.delete(key);
        return null;
    }
    return hit.meters;
};

const writeCachedDistance = async (origin, dest, meters) => {
    if (!Number.isFinite(meters)) return;
    const key = buildCacheKey(origin, dest);

    const redis = getRedisClient();
    if (redis) {
        try {
            await redis.set(`${REDIS_KEY_PREFIX}${key}`, String(meters), 'EX', CACHE_TTL_SEC);
        } catch {
            // fall through to memory cache
        }
    }

    memoryCache.set(key, { ts: Date.now(), meters });
};

const fetchDrivingDistanceDirections = async (origin, dest, apiKey) => {
    const cached = await readCachedDistance(origin, dest);
    if (Number.isFinite(cached)) return cached;

    try {
        const resp = await mapsClient.directions({
            params: {
                origin: `${origin.lat},${origin.lng}`,
                destination: `${dest.lat},${dest.lng}`,
                mode: 'driving',
                key: apiKey,
            },
            timeout: 8000,
        });
        const meters = resp.data?.routes?.[0]?.legs?.[0]?.distance?.value;
        if (Number.isFinite(meters)) {
            await writeCachedDistance(origin, dest, meters);
            return meters;
        }
    } catch (err) {
        logger.warn(`Directions distance failed: ${err.message}`);
    }
    return null;
};

const fetchDrivingDistancesBatch = async (origin, destinations, apiKey) => {
    if (!destinations.length) return [];

    const cachedResults = await Promise.all(destinations.map((dest) => readCachedDistance(origin, dest)));
    const uncachedIndexes = [];
    cachedResults.forEach((value, index) => {
        if (!Number.isFinite(value)) uncachedIndexes.push(index);
    });

    if (uncachedIndexes.length === 0) {
        return cachedResults;
    }

    const uncachedDestinations = uncachedIndexes.map((index) => destinations[index]);

    try {
        const resp = await mapsClient.distancematrix({
            params: {
                origins: [{ lat: origin.lat, lng: origin.lng }],
                destinations: uncachedDestinations.map((d) => ({ lat: d.lat, lng: d.lng })),
                mode: 'driving',
                units: 'metric',
                key: apiKey,
            },
            timeout: 10000,
        });

        const status = resp.data?.status;
        const elements = resp.data?.rows?.[0]?.elements;
        if (status === 'OK' && Array.isArray(elements)) {
            await Promise.all(elements.map(async (element, batchIndex) => {
                const destIndex = uncachedIndexes[batchIndex];
                const dest = destinations[destIndex];
                let meters = null;

                if (element?.status === 'OK' && Number.isFinite(element.distance?.value)) {
                    meters = element.distance.value;
                } else {
                    meters = await fetchDrivingDistanceDirections(origin, dest, apiKey);
                }

                if (Number.isFinite(meters)) {
                    await writeCachedDistance(origin, dest, meters);
                    cachedResults[destIndex] = meters;
                }
            }));
            return cachedResults;
        }

        logger.warn(`Distance Matrix status: ${status || 'unknown'}`);
    } catch (err) {
        logger.warn(`Distance Matrix failed: ${err.message}`);
    }

    await Promise.all(uncachedIndexes.map(async (destIndex) => {
        const dest = destinations[destIndex];
        const meters = await fetchDrivingDistanceDirections(origin, dest, apiKey);
        if (Number.isFinite(meters)) {
            cachedResults[destIndex] = meters;
        }
    }));

    return cachedResults;
};

/**
 * Road distance in meters between two { lat, lng } points, via Directions/
 * Distance Matrix API with an automatic haversine fallback (tagged via the
 * returned `source`) when the API key is missing, the request fails, or the
 * API returns no route.
 * @returns {Promise<{ meters: number, source: 'road'|'straight' }>}
 */
export async function getRoadDistanceMeters(origin, destination) {
    const apiKey = getGoogleMapsApiKey();
    let meters = null;

    if (apiKey) {
        const cached = await readCachedDistance(origin, destination);
        meters = Number.isFinite(cached)
            ? cached
            : await fetchDrivingDistanceDirections(origin, destination, apiKey);
    }

    if (Number.isFinite(meters)) {
        return { meters, source: 'road' };
    }

    return {
        meters: haversineMeters(origin.lat, origin.lng, destination.lat, destination.lng),
        source: 'straight',
    };
}

/**
 * Batched road distance in meters from one origin to many destinations.
 * Callers are responsible for chunking to MAX_BATCH_SIZE per call (mirrors
 * existing restaurant-distance enrichment behavior).
 * @returns {Promise<Array<{ meters: number, source: 'road'|'straight' }>>}
 */
export async function getRoadDistanceBatch(origin, destinations) {
    if (!destinations?.length) return [];

    const apiKey = getGoogleMapsApiKey();
    const rawMeters = apiKey
        ? await fetchDrivingDistancesBatch(origin, destinations, apiKey)
        : destinations.map(() => null);

    return destinations.map((dest, i) => {
        if (Number.isFinite(rawMeters[i])) {
            return { meters: rawMeters[i], source: 'road' };
        }
        return {
            meters: haversineMeters(origin.lat, origin.lng, dest.lat, dest.lng),
            source: 'straight',
        };
    });
}

const resolveRestaurantCoords = (restaurant = {}) => {
    const loc = restaurant.location || {};
    const lat = typeof loc.latitude === 'number'
        ? loc.latitude
        : (Array.isArray(loc.coordinates) ? loc.coordinates[1] : null);
    const lng = typeof loc.longitude === 'number'
        ? loc.longitude
        : (Array.isArray(loc.coordinates) ? loc.coordinates[0] : null);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
};

/** Preserved for existing importers (restaurant.service.js, publicLanding.controller.js). Unchanged behavior. */
export const enrichRestaurantsWithDistance = async (restaurants = [], origin = {}) => {
    const userLat = Number(origin.lat);
    const userLng = Number(origin.lng);
    if (!Number.isFinite(userLat) || !Number.isFinite(userLng) || !restaurants.length) {
        return restaurants;
    }

    const apiKey = getGoogleMapsApiKey();
    const indexed = restaurants.map((restaurant, index) => {
        const coords = resolveRestaurantCoords(restaurant);
        return { restaurant, index, coords };
    });

    const withCoords = indexed.filter((item) => item.coords);
    const results = [...restaurants];
    const originPoint = { lat: userLat, lng: userLng };

    for (let i = 0; i < withCoords.length; i += MAX_BATCH_SIZE) {
        const batch = withCoords.slice(i, i + MAX_BATCH_SIZE);
        const distances = apiKey
            ? await getRoadDistanceBatch(originPoint, batch.map((item) => item.coords))
            : [];

        batch.forEach((item, batchIndex) => {
            const resolved = distances[batchIndex];
            const distanceMeters = resolved
                ? resolved.meters
                : haversineMeters(userLat, userLng, item.coords.lat, item.coords.lng);
            const distanceSource = resolved ? resolved.source : 'straight';

            results[item.index] = {
                ...item.restaurant,
                distanceMeters,
                distanceInKm: Number((distanceMeters / 1000).toFixed(2)),
                distance: formatDistanceLabel(distanceMeters),
                distanceSource,
            };
        });
    }

    indexed
        .filter((item) => !item.coords)
        .forEach((item) => {
            results[item.index] = {
                ...item.restaurant,
                distanceMeters: null,
                distanceInKm: null,
                distance: '',
                distanceSource: 'none',
            };
        });

    return results;
};
