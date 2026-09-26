/**
 * Moved to Backend/src/core/location/geocode.service.js as part of
 * centralizing location/geocoding for all actors (user, restaurant, driver).
 * Re-exported here so existing importers keep working unchanged.
 */
export {
  geocodeAddress,
  geocodePlaceId,
  forwardGeocode,
  reverseGeocode,
  geocodeByPlaceId,
} from "../../../core/location/geocode.service.js";
