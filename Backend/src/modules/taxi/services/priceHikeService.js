import { PriceHike } from '../admin/models/PriceHike.js';

/**
 * Fields that scale with a hike. Deliberately excludes the ones that would be
 * wrong to multiply: distance/time allowances (base_distance, free_distance,
 * free_time) are thresholds not money, and the percentage fields (service_tax,
 * every commision/commission field) already scale themselves because they are
 * applied to a fare that has grown.
 */
const SCALED_FIELDS = [
  'base_price',
  'price_per_distance',
  'time_price',
  'outstation_base_price',
  'outstation_price_per_distance',
  'outstation_time_price',
];

const SCALED_PACKAGE_FIELDS = ['base_price', 'distance_price', 'time_price'];

const toMinutes = (value) => {
  const [hour, minute] = String(value || '')
    .split(':')
    .map((part) => Number(part));

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }

  return hour * 60 + minute;
};

/**
 * Wall-clock weekday and minute-of-day in the given timezone. Intl does the
 * DST/offset work, so this stays correct without an offset table.
 */
const nowInZone = (timezone) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'Asia/Kolkata',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(new Date()).map((part) => [part.type, part.value]),
  );

  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  // Intl renders midnight as "24" in some locales/versions; normalise it.
  const hour = Number(parts.hour) % 24;

  return {
    day: weekdays[parts.weekday] ?? 0,
    minutes: hour * 60 + Number(parts.minute),
  };
};

/** Pure window test, split out from the clock so it can be checked directly. */
export const isHikeActiveAt = (hike, { day, minutes }) => {
  const start = toMinutes(hike.startTime);
  const end = toMinutes(hike.endTime);

  if (start === null || end === null || start === end) {
    return false;
  }

  const days = Array.isArray(hike.days) ? hike.days : [];

  // A window like 22:00-02:00 wraps past midnight. When we are in the small
  // hours we are inside yesterday's window, so the day check uses yesterday.
  if (end < start) {
    const inWindow = minutes >= start || minutes < end;
    if (!inWindow) {
      return false;
    }

    const owningDay = minutes < end ? (day + 6) % 7 : day;
    return days.length === 0 || days.includes(owningDay);
  }

  if (minutes < start || minutes >= end) {
    return false;
  }

  return days.length === 0 || days.includes(day);
};

const isHikeActiveNow = (hike) => isHikeActiveAt(hike, nowInZone(hike.timezone));

/**
 * Highest multiplier among the windows live right now, or 1 when none are.
 * Overlapping windows take the biggest rather than compounding — two 1.5x
 * windows overlapping should not silently become 2.25x.
 */
export const getActivePriceHikeMultiplier = async () => {
  const hikes = await PriceHike.find({ active: true })
    .select('days startTime endTime timezone multiplier')
    .lean();

  const multipliers = hikes
    .filter(isHikeActiveNow)
    .map((hike) => Number(hike.multiplier) || 1)
    .filter((value) => value > 1);

  return multipliers.length > 0 ? Math.max(...multipliers) : 1;
};

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/** Returns a copy of a serialized set-price row with fare fields scaled. */
export const applyPriceHikeToSetPrice = (row, multiplier) => {
  if (!row || !(multiplier > 1)) {
    return row;
  }

  const next = { ...row };

  for (const field of SCALED_FIELDS) {
    if (typeof next[field] === 'number') {
      next[field] = roundMoney(next[field] * multiplier);
    }
  }

  if (Array.isArray(next.package_vehicle_prices)) {
    next.package_vehicle_prices = next.package_vehicle_prices.map((price) => {
      const scaled = { ...price };
      for (const field of SCALED_PACKAGE_FIELDS) {
        if (typeof scaled[field] === 'number') {
          scaled[field] = roundMoney(scaled[field] * multiplier);
        }
      }
      return scaled;
    });
  }

  // Lets the apps badge the fare as surged instead of silently charging more.
  next.price_hike_multiplier = multiplier;

  return next;
};
