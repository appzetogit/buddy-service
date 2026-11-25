// Colourful 3D top-view vehicle pictures for the live map (the same artwork the admin uses for Taxi vehicles).
// Files live in /public/map-vehicles so they load instantly and never depend on a third-party host.
const BASE = '/map-vehicles';
const DEFAULT_ICON = '/MapRider.png'; // the Buddy Service delivery rider (Food / Marketplace)

/**
 * The picture shown on the map for a rider. Order of preference:
 *  1. an icon URL the admin set for the vehicle (Taxi vehicle "map icon"),
 *  2. the picture for the vehicle type the rider actually drives,
 *  3. the Buddy delivery rider, so nothing ever renders blank.
 * `parcel: true` = a Food / Marketplace delivery rider: a bike then shows the Buddy delivery rider.
 * `vehicle` is a type string ("bike") or an object with iconUrl / vehicleIconUrl / vehicleIconType / vehicleType.
 */
export const riderMapIcon = (vehicle, { parcel = false } = {}) => {
  const v = typeof vehicle === 'string' ? { vehicleType: vehicle } : vehicle || {};
  const url = String(v.iconUrl || v.vehicleIconUrl || v.map_icon || '').trim();
  if (/^(https?:|data:image\/|\/)/i.test(url)) return url;

  const type = String(
    v.vehicleIconType || (Array.isArray(v.vehicleType) ? v.vehicleType[0] : v.vehicleType) || '',
  ).toLowerCase();
  if (!type) return DEFAULT_ICON;
  if (/bike|scoot|moped|cycle/.test(type)) return parcel ? DEFAULT_ICON : `${BASE}/bike.webp`;
  if (/auto|rickshaw|tuk/.test(type)) return `${BASE}/auto.webp`;
  if (/suv|xl|innova|van/.test(type)) return `${BASE}/suv.webp`;
  if (/lcv|tempo|pickup|mini_?truck/.test(type)) return `${BASE}/minitruck.webp`;
  if (/truck|hcv|mcv/.test(type)) return `${BASE}/truck.webp`;
  if (/luxur|luxary/.test(type)) return `${BASE}/luxury.webp`;
  if (/premium/.test(type)) return `${BASE}/premium.webp`;
  if (/car|cab|sedan|hatch/.test(type)) return `${BASE}/car.webp`;
  return DEFAULT_ICON;
};

/** These pictures are top-views, so they turn with the rider's heading. */
export const riderIconRotates = () => true;

export const RIDER_MAP_FALLBACK = DEFAULT_ICON;
