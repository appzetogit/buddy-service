import mongoose from 'mongoose';
import { FoodRestaurant } from '../restaurant/models/restaurant.model.js';
import { FoodZone } from '../admin/models/zone.model.js';
import { isPointInPolygon } from '../../../utils/geo.js';

/// Whether [restaurant] belongs to the zone: assigned to it, or (active zone) located inside it.
export const isRestaurantInZone = (restaurant, zoneId, coordinates = []) => {
    if (restaurant?.zoneId && String(restaurant.zoneId) === String(zoneId)) return true;
    if (!Array.isArray(coordinates) || coordinates.length < 3) return false;
    const loc = restaurant?.location || {};
    const [gLng, gLat] = Array.isArray(loc.coordinates) ? loc.coordinates : [];
    const lat = Number(gLat ?? loc.latitude);
    const lng = Number(gLng ?? loc.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    return isPointInPolygon(lat, lng, coordinates);
};

/**
 * Ids of the approved restaurants in a zone; null when [zoneIdRaw] is not a zone id (= no zone filter).
 *
 * Checked here rather than with $geoWithin: an admin can draw a zone whose outline crosses itself, which
 * MongoDB rejects, and the whole listing then failed with a 500.
 */
// ponytail: reads every approved restaurant's location; use a 2dsphere query on repaired polygons if there are thousands.
export const zoneRestaurantIds = async (zoneIdRaw) => {
    const zoneId = String(zoneIdRaw || '').trim();
    if (!zoneId || !mongoose.Types.ObjectId.isValid(zoneId)) return null;
    const [zone, restaurants] = await Promise.all([
        FoodZone.findOne({ _id: zoneId, isActive: true }).select('coordinates').lean(),
        FoodRestaurant.find({ status: 'approved' }).select('zoneId location').lean(),
    ]);
    return restaurants
        .filter((r) => isRestaurantInZone(r, zoneId, zone?.coordinates))
        .map((r) => r._id);
};
