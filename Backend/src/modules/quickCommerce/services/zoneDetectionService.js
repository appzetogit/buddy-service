import { FoodZone } from "../../food/admin/models/zone.model.js";

// Ray-casting point-in-polygon for lat/lng polygons
export const isPointInPolygon = (lat, lng, polygon) => {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = Number(polygon[i].longitude);
    const yi = Number(polygon[i].latitude);
    const xj = Number(polygon[j].longitude);
    const yj = Number(polygon[j].latitude);
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

export const detectZoneIdForCoordinates = async (lat, lng) => {
  const zones = await FoodZone.find({ isActive: true }).lean();
  for (const zone of zones) {
    if (isPointInPolygon(lat, lng, zone.coordinates)) {
      return zone._id;
    }
  }
  return null;
};
