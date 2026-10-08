/**
 * Pull { lat, lng } out of any location shape the backend sends.
 *
 * A location reaches the rider app as GeoJSON (`coordinates: [lng, lat]`), as a flat
 * `{ latitude, longitude }` mirror, or as `{ lat, lng }` - and the mirror is simply absent on
 * plenty of records. Reading only one shape is why an offer card could show no distance, so
 * every distance calculation goes through this.
 *
 * Mirrors extractLatLng() in Backend core/location/location.schema.js.
 *
 * @returns {{lat: number, lng: number} | null}
 */
export const extractLatLng = (locationLike) => {
  if (!locationLike || typeof locationLike !== 'object') return null;

  if (Array.isArray(locationLike.coordinates) && locationLike.coordinates.length >= 2) {
    const lng = Number(locationLike.coordinates[0]);
    const lat = Number(locationLike.coordinates[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }

  const lat = Number(locationLike.latitude ?? locationLike.lat);
  const lng = Number(locationLike.longitude ?? locationLike.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };

  return null;
};

/**
 * Where the rider has to go to collect this order.
 *
 * For a multi-restaurant order that is the next stop still to be collected (server-assigned
 * visit order), otherwise the single restaurant. Falls back through every field an offer
 * payload, a synced trip or a socket event may carry it in.
 *
 * @returns {{lat: number, lng: number} | null}
 */
export const resolvePickupLatLng = (order) => {
  if (!order) return null;

  const pickups = Array.isArray(order.pickups) ? order.pickups : [];
  if (pickups.length > 0) {
    const remaining = pickups
      .filter(
        (p) =>
          !p?.permanentlyDropped &&
          !['picked_up', 'ready_for_handover', 'cancelled'].includes(String(p?.status || '')),
      )
      .sort((a, b) => (Number(a?.sequence) || 0) - (Number(b?.sequence) || 0));

    for (const stop of remaining) {
      const point = extractLatLng(stop?.location) || extractLatLng(stop);
      if (point) return point;
    }
  }

  return (
    extractLatLng(order.restaurantLocation) ||
    extractLatLng(order.restaurant_location) ||
    extractLatLng(order.restaurantId?.location) ||
    extractLatLng(order.restaurantId) ||
    extractLatLng({ lat: order.restaurant_lat ?? order.restaurantLat, lng: order.restaurant_lng ?? order.restaurantLng })
  );
};

/**
 * Formats metres as "1.2" km, or `fallback` when the distance is unknown.
 *
 * null / undefined / '' mean "not known yet", NOT zero: Number(null) is 0, which would render
 * "0.0 km" and tell the rider they had arrived when the app simply has no fix.
 */
export const formatKm = (meters, fallback = '--') => {
  if (meters === null || meters === undefined || meters === '') return fallback;
  const n = Number(meters);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return (n / 1000).toFixed(1);
};

/**
 * Haversine formula to calculate the distance between two points in meters.
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} Distance in meters
 */
export const getHaversineDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // Earth Radius in meters
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
};

/**
 * Calculates accurate ETA in minutes based on distance and rolling average speed.
 * @param {number} distanceInMeters 
 * @param {number} averageSpeedMetersPerSec 
 * @returns {number} ETA in minutes (minimum 1)
 */
export const calculateETA = (distanceInMeters, averageSpeedMetersPerSec) => {
    if (!distanceInMeters || distanceInMeters <= 0) return 0;
    // Fallback speed if stationary/low speed (avg human biking speed 4.5m/s approx 16km/h)
    const speed = averageSpeedMetersPerSec > 1 ? averageSpeedMetersPerSec : 4.5;
    const seconds = distanceInMeters / speed;
    return Math.max(1, Math.round(seconds / 60));
};
/**
 * Calculates the bearing (heading) between two points in degrees.
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} Angle in degrees [0, 360)
 */
export const calculateHeading = (lat1, lon1, lat2, lon2) => {
    const lat1Rad = (lat1 * Math.PI) / 180;
    const lat2Rad = (lat2 * Math.PI) / 180;
    const deltaLonRad = ((lon2 - lon1) * Math.PI) / 180;

    const y = Math.sin(deltaLonRad) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(deltaLonRad);
    
    const bearing = (Math.atan2(y, x) * 180) / Math.PI;
    return (bearing + 360) % 360;
};
