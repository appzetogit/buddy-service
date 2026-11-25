// Round badge with a clear vehicle icon (Google Material icon paths, same family the app already uses).
// Drawn as SVG: sharp at any size, no image files. The badge stays upright (see riderIconRotates).
const GREEN = '#16A34A';
const PATHS = {
  bike: 'M20 11c-.18 0-.36.03-.53.05L17.41 9H20V6l-3.72 1.86L13.41 5H9v2h3.59l2 2H11l-4 2-2-2H0v2h4c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4l2 2h3l3.49-6.1 1.01 1.01c-.91.73-1.5 1.84-1.5 3.09 0 2.21 1.79 4 4 4s4-1.79 4-4-1.79-4-4-4M4 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2m16 0c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2',
  delivery: 'M19 7c0-1.1-.9-2-2-2h-3v2h3v2.65L13.52 14H10V9H6c-2.21 0-4 1.79-4 4v3h2c0 1.66 1.34 3 3 3s3-1.34 3-3h4.48L19 10.35zM7 17c-.55 0-1-.45-1-1h2c0 .55-.45 1-1 1M5 6h5v2H5zm14 7c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3m0 4c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1',
  auto: 'M21 11.18V9.72c0-.47-.16-.92-.46-1.28L16.6 3.72c-.38-.46-.94-.72-1.54-.72H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h.18C3.6 16.16 4.7 17 6 17s2.4-.84 2.82-2h8.37c.41 1.16 1.51 2 2.82 2 1.66 0 3-1.34 3-3-.01-1.3-.85-2.4-2.01-2.82M18.4 9H16V6.12zM3 5h4v4H3zm3 10c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1m3-2v-2h3V9H9V5h5v8zm11 2c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1M7 20h4v-2l6 3h-4v2z',
  car: 'M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16m11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5M5 11l1.5-4.5h11L19 11z',
  suv: 'M17 5H3c-1.1 0-2 .89-2 2v9h2c0 1.65 1.34 3 3 3s3-1.35 3-3h5.5c0 1.65 1.34 3 3 3s3-1.35 3-3H23v-5zM3 11V7h4v4zm3 6.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5m7-6.5H9V7h4zm4.5 6.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5M15 11V7h1l4 4z',
  truck: 'M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5m13.5-9 1.96 2.5H17V9.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5',
};

const badge = (d) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="35" r="28" fill="#000" opacity=".18"/><circle cx="32" cy="32" r="29" fill="${GREEN}" stroke="#fff" stroke-width="3"/><g transform="translate(11 11) scale(1.75)" fill="#fff"><path d="${d}"/></g></svg>`,
  )}`;

const ICONS = Object.fromEntries(Object.entries(PATHS).map(([k, d]) => [k, badge(d)]));
ICONS.parcel = ICONS.delivery;

/** Badges stay upright; only the old top-view pictures (admin URL / MapRider.png) turn with the heading. */
export const riderIconRotates = (src) => !String(src || '').startsWith('data:image/svg+xml');

const DEFAULT_ICON = '/MapRider.png';

/**
 * The picture shown on the map for a rider. Order of preference:
 *  1. an icon URL the admin set for the vehicle (Taxi vehicle "map icon"),
 *  2. the picture for the vehicle type the rider actually drives (bike / scooter, auto, car, SUV, truck),
 *  3. the original rider picture, so nothing ever renders blank.
 * `vehicle` is a type string ("bike") or an object with iconUrl / vehicleIconUrl / vehicleIconType / vehicleType.
 */
export const riderMapIcon = (vehicle, { parcel = false } = {}) => {
  const v = typeof vehicle === 'string' ? { vehicleType: vehicle } : vehicle || {};
  const url = String(v.iconUrl || v.vehicleIconUrl || v.map_icon || '').trim();
  if (/^(https?:|data:image\/|\/)/i.test(url)) return url;

  const type = String(
    v.vehicleIconType || (Array.isArray(v.vehicleType) ? v.vehicleType[0] : v.vehicleType) || '',
  ).toLowerCase();
  if (!type) return parcel ? ICONS.parcel : DEFAULT_ICON;
  if (/bike|scoot|moped|cycle/.test(type)) return parcel ? ICONS.parcel : ICONS.bike;
  if (/auto|rickshaw|tuk/.test(type)) return ICONS.auto;
  if (/suv|xl|innova|van/.test(type)) return ICONS.suv;
  if (/truck|lcv|tempo|pickup|mini_?truck|hcv|mcv/.test(type)) return ICONS.truck;
  if (/car|cab|sedan|hatch|premium|luxur/.test(type)) return ICONS.car;
  return DEFAULT_ICON;
};

export const RIDER_MAP_FALLBACK = DEFAULT_ICON;
