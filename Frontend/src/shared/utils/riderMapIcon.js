// Clean top-view vehicle markers (all pointing up, rotated by the map with the rider's heading).
// Drawn as SVG so they stay sharp at any size and need no image files.
const G = '#16A34A'; // body
const GD = '#0F7A37'; // darker edge
const GL = '#34C46A'; // highlight
const GLASS = '#1F2937';
const SHADOW = '<ellipse cx="24" cy="52" rx="17" ry="44" fill="#000" opacity=".09"/>';
const LIGHTS = (y1, y2, x1 = 12, x2 = 36) =>
  `<rect x="${x1}" y="${y1}" width="6" height="3" rx="1.5" fill="#FDE047"/><rect x="${x2 - 6}" y="${y1}" width="6" height="3" rx="1.5" fill="#FDE047"/>` +
  `<rect x="${x1}" y="${y2}" width="6" height="3" rx="1.5" fill="#EF4444"/><rect x="${x2 - 6}" y="${y2}" width="6" height="3" rx="1.5" fill="#EF4444"/>`;
const WHEEL = (x, y, h = 14) => `<rect x="${x}" y="${y}" width="5" height="${h}" rx="2.5" fill="#111827"/>`;

const svg = (inner) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 100">${SHADOW}${inner}</svg>`)}`;

const car = (wide = 0, long = 0) => {
  const x = 8 - wide, w = 32 + wide * 2, y = 8 - long, h = 84 + long * 2;
  return svg(
    WHEEL(x - 2, y + 14) + WHEEL(x + w - 3, y + 14) + WHEEL(x - 2, y + h - 30) + WHEEL(x + w - 3, y + h - 30) +
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="15" fill="${G}" stroke="${GD}" stroke-width="1.5"/>` +
      `<path d="M${x + 5} ${y + 26} Q24 ${y + 17} ${x + w - 5} ${y + 26} L${x + w - 7} ${y + 38} L${x + 7} ${y + 38} Z" fill="${GLASS}"/>` +
      `<rect x="${x + 5}" y="${y + 38}" width="${w - 10}" height="${h - 66 - long}" rx="6" fill="${GL}"/>` +
      `<path d="M${x + 7} ${y + h - 28} L${x + w - 7} ${y + h - 28} L${x + w - 5} ${y + h - 20} Q24 ${y + h - 14} ${x + 5} ${y + h - 20} Z" fill="${GLASS}"/>` +
      `<rect x="${x - 3}" y="${y + 30}" width="4" height="7" rx="2" fill="${GD}"/><rect x="${x + w - 1}" y="${y + 30}" width="4" height="7" rx="2" fill="${GD}"/>` +
      LIGHTS(y + 3, y + h - 6, x + 3, x + w - 3),
  );
};

const bike = (box = false) =>
  svg(
    `<rect x="21.5" y="6" width="5" height="26" rx="2.5" fill="#111827"/>` + // front wheel
      `<rect x="21.5" y="66" width="5" height="26" rx="2.5" fill="#111827"/>` + // rear wheel
      `<rect x="5" y="24" width="38" height="3.5" rx="1.75" fill="#374151"/>` + // handlebar
      `<rect x="3" y="22.5" width="5" height="6.5" rx="2.5" fill="#111827"/><rect x="40" y="22.5" width="5" height="6.5" rx="2.5" fill="#111827"/>` +
      `<path d="M16 30 Q24 24 32 30 L33 54 Q24 60 15 54 Z" fill="${G}" stroke="${GD}" stroke-width="1.5"/>` + // body
      `<rect x="15" y="52" width="18" height="20" rx="7" fill="${GL}" stroke="${GD}" stroke-width="1.2"/>` + // seat
      `<ellipse cx="24" cy="48" rx="9" ry="10" fill="${GLASS}"/>` + // rider body
      `<circle cx="24" cy="41" r="7.5" fill="#F9FAFB" stroke="${GD}" stroke-width="1.5"/>` + // helmet
      `<path d="M19.5 38.5 Q24 35.5 28.5 38.5 L28 41 L20 41 Z" fill="${GLASS}"/>` +
      (box ? `<rect x="10" y="68" width="28" height="22" rx="4" fill="#F59E0B" stroke="#B45309" stroke-width="1.5"/><path d="M10 79 H38 M24 68 V90" stroke="#B45309" stroke-width="1.2"/>` : '') +
      `<rect x="20" y="7" width="8" height="3" rx="1.5" fill="#FDE047"/>`,
  );

const auto = () =>
  svg(
    WHEEL(21.5, 10, 12) + WHEEL(7, 66, 14) + WHEEL(36, 66, 14) +
      `<path d="M24 6 Q36 6 37 26 L40 88 Q40 94 34 94 L14 94 Q8 94 8 88 L11 26 Q12 6 24 6 Z" fill="${G}" stroke="${GD}" stroke-width="1.5"/>` +
      `<path d="M15 24 Q24 18 33 24 L34 36 L14 36 Z" fill="${GLASS}"/>` +
      `<rect x="11" y="40" width="26" height="46" rx="6" fill="#FDE047" stroke="#CA8A04" stroke-width="1.2"/>` + // canopy
      `<path d="M16 46 H32 M16 54 H32 M16 62 H32 M16 70 H32" stroke="#CA8A04" stroke-width="1"/>` +
      `<rect x="20" y="7" width="8" height="3" rx="1.5" fill="#FDE047"/><rect x="14" y="90" width="6" height="3" rx="1.5" fill="#EF4444"/><rect x="28" y="90" width="6" height="3" rx="1.5" fill="#EF4444"/>`,
  );

const truck = () =>
  svg(
    WHEEL(4, 14, 14) + WHEEL(39, 14, 14) + WHEEL(4, 68, 18) + WHEEL(39, 68, 18) +
      `<rect x="8" y="4" width="32" height="28" rx="9" fill="${G}" stroke="${GD}" stroke-width="1.5"/>` + // cab
      `<path d="M12 14 Q24 8 36 14 L36 22 L12 22 Z" fill="${GLASS}"/>` +
      `<rect x="9" y="34" width="30" height="62" rx="4" fill="#F3F4F6" stroke="#9CA3AF" stroke-width="1.5"/>` + // cargo
      `<path d="M9 50 H39 M9 66 H39 M9 82 H39" stroke="#D1D5DB" stroke-width="1.2"/><rect x="14" y="40" width="20" height="4" rx="2" fill="${G}"/>` +
      `<rect x="12" y="5" width="6" height="3" rx="1.5" fill="#FDE047"/><rect x="30" y="5" width="6" height="3" rx="1.5" fill="#FDE047"/>`,
  );

const ICONS = { bike: bike(), parcel: bike(true), auto: auto(), car: car(), suv: car(2, 3), truck: truck() };

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
