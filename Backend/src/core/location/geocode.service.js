import { Client } from "@googlemaps/google-maps-services-js";
import crypto from "crypto";
import { getRedisClient } from "./sharedRedisClient.js";
import GeocodeCache from "./geocodeCache.model.js";

/**
 * Centralized geocoding service (forward + reverse), the single backend
 * geocoder shared by all Food-module actors (user, restaurant, delivery
 * partner).
 *
 * Deliberately keeps using an ioredis-based client (not the project-root
 * `redis` package client in Backend/src/config/redis.js) - the two are
 * different clients with different `.set(...)` call conventions, and this
 * preserves the cache's existing behavior exactly.
 */

const client = new Client({});

const GEOCODE_CACHE_TTL_SEC = () =>
  parseInt(process.env.GEOCODE_CACHE_TTL_SEC || "2592000", 10); // 30d

function getApiKey() {
  return (
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_SERVER_KEY?.trim() ||
    process.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ||
    ""
  );
}

function requireApiKey() {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error(
      "Google Maps API key missing. Set GOOGLE_MAPS_API_KEY (Geocoding API).",
    );
    err.statusCode = 500;
    err.code = "MAPS_KEY_MISSING";
    throw err;
  }
  return apiKey;
}

function cacheKeyAddress(address, country) {
  const raw = `geocode:v2:addr:${country || ""}:${address || ""}`.toLowerCase();
  const h = crypto.createHash("sha1").update(raw).digest("hex");
  return `geocode:v2:${h}`;
}

function cacheKeyPlaceId(placeId) {
  const raw = `geocode:v2:pid:${placeId || ""}`.toLowerCase();
  const h = crypto.createHash("sha1").update(raw).digest("hex");
  return `geocode:v2:${h}`;
}

function cacheKeyReverse(lat, lng, country) {
  // Round to 5 decimals (~1.1m) so GPS jitter still hits the same cache entry.
  const roundedLat = Math.round(Number(lat) * 1e5) / 1e5;
  const roundedLng = Math.round(Number(lng) * 1e5) / 1e5;
  const raw = `geocode:v2:rev:${country || ""}:${roundedLat},${roundedLng}`.toLowerCase();
  const h = crypto.createHash("sha1").update(raw).digest("hex");
  return `geocode:v2:${h}`;
}

async function readCache(key) {
  const redis = getRedisClient();
  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached) return JSON.parse(cached);
    } catch {
      // ignore cache errors
    }
  }

  try {
    const doc = await GeocodeCache.findOne({ key }).lean();
    if (doc && doc.expiresAt && doc.expiresAt > new Date()) {
      return {
        lat: doc.lat,
        lng: doc.lng,
        formattedAddress: doc.formattedAddress || "",
        placeId: doc.placeId || null,
        types: Array.isArray(doc.types) ? doc.types : [],
        addressLine1: doc.addressLine1 || "",
        area: doc.area || "",
        city: doc.city || "",
        state: doc.state || "",
        pincode: doc.pincode || "",
        country: doc.country || "",
      };
    }
  } catch {
    // ignore cache errors
  }

  return null;
}

async function writeCache(key, result) {
  const redis = getRedisClient();
  const expiresAt = new Date(Date.now() + GEOCODE_CACHE_TTL_SEC() * 1000);

  if (redis) {
    try {
      await redis.set(key, JSON.stringify(result), "EX", GEOCODE_CACHE_TTL_SEC());
    } catch {
      // ignore cache errors
    }
  }

  try {
    await GeocodeCache.updateOne(
      { key },
      { $set: { ...result, expiresAt } },
      { upsert: true },
    );
  } catch {
    // ignore mongo cache errors
  }
}

/** Parses Google's address_components into our canonical field set. */
function parseAddressComponents(components = []) {
  const find = (type) => components.find((c) => Array.isArray(c.types) && c.types.includes(type));

  const area =
    find("sublocality_level_1")?.long_name ||
    find("sublocality")?.long_name ||
    find("neighborhood")?.long_name ||
    "";
  const city =
    find("locality")?.long_name ||
    find("administrative_area_level_2")?.long_name ||
    "";
  const state = find("administrative_area_level_1")?.long_name || "";
  const pincode = find("postal_code")?.long_name || "";
  const country = find("country")?.long_name || "";

  return { area, city, state, pincode, country };
}

/**
 * Forward geocode an address string -> { lat, lng, formattedAddress, addressLine1, area, city, state, pincode, country, placeId }.
 */
export async function forwardGeocode(address, { country } = {}) {
  if (!address || typeof address !== "string" || address.trim().length < 3) {
    const err = new Error("address is required");
    err.statusCode = 400;
    throw err;
  }

  const apiKey = requireApiKey();
  const addr = address.trim();
  const key = cacheKeyAddress(addr, country);

  const cached = await readCache(key);
  if (cached) return cached;

  const params = { address: addr, key: apiKey };
  if (country && typeof country === "string" && country.trim()) {
    params.components = `country:${country.trim().toUpperCase()}`;
  } else if (process.env.MAPS_DEFAULT_COUNTRY?.trim()) {
    params.components = `country:${process.env.MAPS_DEFAULT_COUNTRY.trim().toUpperCase()}`;
  }

  const resp = await client.geocode({ params, timeout: 10000 });
  const status = resp.data?.status;
  if (status && status !== "OK") {
    const msg = resp.data?.error_message || status;
    const err = new Error(`Geocoding failed: ${msg}`);
    err.statusCode = status === "ZERO_RESULTS" ? 404 : 502;
    err.code = status;
    throw err;
  }

  const first = resp.data?.results?.[0];
  const loc = first?.geometry?.location;
  if (!first || !loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") {
    const err = new Error("Geocoding returned no coordinates");
    err.statusCode = 404;
    err.code = "ZERO_RESULTS";
    throw err;
  }

  const parsed = parseAddressComponents(first.address_components);
  const result = {
    lat: loc.lat,
    lng: loc.lng,
    formattedAddress: first.formatted_address || addr,
    addressLine1: "",
    ...parsed,
    placeId: first.place_id || null,
    types: Array.isArray(first.types) ? first.types : [],
  };

  await writeCache(key, result);
  return result;
}

/** Reverse geocode lat/lng -> { lat, lng, formattedAddress, addressLine1, area, city, state, pincode, country, placeId }. */
export async function reverseGeocode(lat, lng, { country } = {}) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    const err = new Error("lat/lng are required");
    err.statusCode = 400;
    throw err;
  }

  const apiKey = requireApiKey();
  const key = cacheKeyReverse(latitude, longitude, country);

  const cached = await readCache(key);
  if (cached) return cached;

  const resp = await client.reverseGeocode({
    params: { latlng: `${latitude},${longitude}`, key: apiKey },
    timeout: 10000,
  });

  const status = resp.data?.status;
  if (status && status !== "OK") {
    const msg = resp.data?.error_message || status;
    const err = new Error(`Reverse geocoding failed: ${msg}`);
    err.statusCode = status === "ZERO_RESULTS" ? 404 : 502;
    err.code = status;
    throw err;
  }

  const first = resp.data?.results?.[0];
  if (!first) {
    const err = new Error("Reverse geocoding returned no results");
    err.statusCode = 404;
    err.code = "ZERO_RESULTS";
    throw err;
  }

  const parsed = parseAddressComponents(first.address_components);
  const result = {
    lat: latitude,
    lng: longitude,
    formattedAddress: first.formatted_address || "",
    addressLine1: "",
    ...parsed,
    placeId: first.place_id || null,
    types: Array.isArray(first.types) ? first.types : [],
  };

  await writeCache(key, result);
  return result;
}

/** Reverse-lookup by Google placeId -> same shape as forwardGeocode/reverseGeocode. */
export async function geocodeByPlaceId(placeId) {
  if (!placeId || typeof placeId !== "string" || placeId.trim().length < 5) {
    const err = new Error("placeId is required");
    err.statusCode = 400;
    throw err;
  }

  const apiKey = requireApiKey();
  const pid = placeId.trim();
  const key = cacheKeyPlaceId(pid);

  const cached = await readCache(key);
  if (cached) return cached;

  const resp = await client.geocode({
    params: { place_id: pid, key: apiKey },
    timeout: 10000,
  });

  const status = resp.data?.status;
  if (status && status !== "OK") {
    const msg = resp.data?.error_message || status;
    const err = new Error(`Geocoding failed: ${msg}`);
    err.statusCode = status === "ZERO_RESULTS" ? 404 : 502;
    err.code = status;
    throw err;
  }

  const first = resp.data?.results?.[0];
  const loc = first?.geometry?.location;
  if (!first || !loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") {
    const err = new Error("Geocoding returned no coordinates");
    err.statusCode = 404;
    err.code = "ZERO_RESULTS";
    throw err;
  }

  const parsed = parseAddressComponents(first.address_components);
  const result = {
    lat: loc.lat,
    lng: loc.lng,
    formattedAddress: first.formatted_address || "",
    addressLine1: "",
    ...parsed,
    placeId: first.place_id || pid,
    types: Array.isArray(first.types) ? first.types : [],
  };

  await writeCache(key, result);
  return result;
}

export const geocodeAddress = forwardGeocode;
export const geocodePlaceId = geocodeByPlaceId;
