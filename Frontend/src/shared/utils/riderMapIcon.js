import bike from '@taxi/assets/icons/bike.png';
import auto from '@taxi/assets/icons/auto.png';
import car from '@taxi/assets/icons/car.png';
import suv from '@taxi/assets/icons/SUV.png';
import truck from '@taxi/assets/icons/truck.png';
import delivery from '@taxi/assets/icons/Delivery.png';

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
  if (!type) return parcel ? delivery : DEFAULT_ICON;
  if (/bike|scoot|moped|cycle/.test(type)) return bike;
  if (/auto|rickshaw|tuk/.test(type)) return auto;
  if (/suv|xl|innova|van/.test(type)) return suv;
  if (/truck|lcv|tempo|pickup|mini_?truck|hcv|mcv/.test(type)) return truck;
  if (/car|cab|sedan|hatch|premium|luxur/.test(type)) return car;
  return DEFAULT_ICON;
};

export const RIDER_MAP_FALLBACK = DEFAULT_ICON;
