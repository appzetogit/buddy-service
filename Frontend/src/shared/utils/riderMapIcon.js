// Round badge with a bold side-view vehicle, readable at a glance (like Uber / Zomato map pins).
// Drawn as SVG: sharp at any size, no image files. The badge stays upright (see riderIconRotates).
const GREEN = '#16A34A';
const wheel = (x, y, r = 5.5) =>
  `<circle cx="${x}" cy="${y}" r="${r + 1.8}" fill="${GREEN}"/><circle cx="${x}" cy="${y}" r="${r}" fill="#fff"/><circle cx="${x}" cy="${y}" r="${r * 0.38}" fill="${GREEN}"/>`;

const badge = (glyph) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="35" r="28" fill="#000" opacity=".18"/><circle cx="32" cy="32" r="29" fill="${GREEN}" stroke="#fff" stroke-width="3"/>${glyph}</svg>`,
  )}`;

const scooter = (box) =>
  badge(
    `<circle cx="31" cy="15" r="5" fill="#fff"/>` + // helmet
      `<path d="M27 21 L35 21 L38 31 L24 31 Z" fill="#fff"/>` + // rider
      `<path d="M44 21 H50" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M46 22 L48 40" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>` + // handle + fork
      `<path d="M14 36 Q14 31 20 31 H36 Q42 31 42 37 V40 H18 Q14 40 14 36 Z" fill="#fff"/>` + // body
      (box ? `<rect x="6" y="20" width="14" height="12" rx="2" fill="#F59E0B" stroke="#fff" stroke-width="1.5"/><path d="M6 26 H20 M13 20 V32" stroke="#fff" stroke-width="1.3"/>` : '') +
      wheel(18, 43) + wheel(46, 43),
  );

const autoRickshaw = () =>
  badge(
    `<path d="M11 43 V26 Q11 17 21 17 H36 Q42 17 44 23 L51 34 Q53 37 53 43 Z" fill="#fff"/>` +
      `<path d="M17 23 H30 V32 H17 Z M33 23 H38 L43 32 H33 Z" fill="${GREEN}"/>` +
      `<rect x="11" y="13" width="26" height="4" rx="2" fill="#FDE047"/>` + // roof stripe
      wheel(21, 44) + wheel(45, 44),
  );

const carSide = (suv) =>
  badge(
    `<path d="M9 40 V34 Q9 31 13 30 L20 28 L24 21 Q25 19 28 19 H${suv ? 42 : 38} Q41 19 43 21 L${suv ? 49 : 47} 28 L51 30 Q55 31 55 34 V40 Q55 42 53 42 H11 Q9 42 9 40 Z" fill="#fff"/>` +
      `<path d="M25 28 L28 22 H33 V28 Z M36 28 V22 H${suv ? 41 : 39} L${suv ? 46 : 44} 28 Z" fill="${GREEN}"/>` +
      wheel(20, 43, 5) + wheel(44, 43, 5),
  );

const truckSide = () =>
  badge(
    `<rect x="8" y="17" width="29" height="23" rx="2.5" fill="#fff"/>` +
      `<path d="M39 24 H47 L54 32 V40 H39 Z" fill="#fff"/><path d="M42 27 H46 L50 32 H42 Z" fill="${GREEN}"/>` +
      `<rect x="13" y="23" width="19" height="5" rx="2" fill="${GREEN}"/>` +
      wheel(17, 43, 5) + wheel(31, 43, 5) + wheel(47, 43, 5),
  );

const ICONS = { bike: scooter(false), parcel: scooter(true), auto: autoRickshaw(), car: carSide(false), suv: carSide(true), truck: truckSide() };

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
