/**
 * Outstation fares, one way and round trip, from a vehicle's tariff
 * (Admin -> Set Prices -> Outstation).
 *
 *   One way:     base fare
 *              + per km on the route km beyond the base km
 *              + per minute on the route time
 *
 *   Round trip:  base fare
 *              + round-trip per km (or the one-way per km when not set)
 *                  x max(km both ways, minimum km per day x days)
 *              + driver allowance per day x days
 *
 *   days = calendar days from the travel date to the return date, counted
 *          inclusively in IST (same-day return = 1 day). 1 without dates.
 *
 * Service tax (the tariff's %) is added on top and the result rounded to
 * whole rupees, never below the base fare - the same steps the rider app's
 * FareCalculator takes, which mirrors this formula so the quote and the
 * booked fare agree. The rider's platform fee and location charges are added
 * separately by the caller, as for every ride.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const money = (value) => Math.round(Number(value || 0) * 100) / 100;

const istDayNumber = (value) => {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.floor((time + IST_OFFSET_MS) / DAY_MS) : null;
};

/// Days a round trip is billed for: inclusive calendar days, at least 1.
export const outstationTripDays = (travelDate, returnDate) => {
  const start = istDayNumber(travelDate || Date.now());
  const end = istDayNumber(returnDate);
  if (start === null || end === null) return 1;
  return Math.max(1, end - start + 1);
};

export const isRoundTripType = (tripType) =>
  ['round_trip', 'round', 'roundtrip', 'two_way'].includes(String(tripType || '').trim().toLowerCase());

/// Whether this tariff can price outstation trips at all.
export const tariffSupportsOutstation = (setPrice) =>
  Boolean(setPrice)
  && (setPrice.enable_outstation_ride === true || Number(setPrice.support_outstation) === 1)
  && (num(setPrice.outstation_price_per_distance) > 0 || num(setPrice.outstation_base_price) > 0);

/**
 * @returns null when the tariff has no outstation pricing; otherwise the
 *   trip fare (`total`, whole rupees, tax included, no platform fee) and the
 *   breakdown for the ride, apps and invoice.
 */
export const computeOutstationFare = ({
  setPrice,
  distanceMeters = 0,
  durationMinutes = 0,
  tripType = 'one_way',
  travelDate = null,
  returnDate = null,
}) => {
  if (!tariffSupportsOutstation(setPrice)) return null;

  const routeKm = Math.max(0, Number(distanceMeters) || 0) / 1000;
  const base = num(setPrice.outstation_base_price);
  const perKm = num(setPrice.outstation_price_per_distance);
  const roundTrip = isRoundTripType(tripType);

  let days = 1;
  let chargeableKm;
  let ratePerKm;
  let distanceFare;
  let timeFare = 0;
  let driverAllowance = 0;
  let minKmPerDay = 0;

  if (roundTrip) {
    days = outstationTripDays(travelDate, returnDate);
    minKmPerDay = num(setPrice.outstation_min_km_per_day);
    ratePerKm = num(setPrice.outstation_round_trip_price_per_distance) || perKm;
    chargeableKm = Math.max(routeKm * 2, minKmPerDay * days);
    distanceFare = chargeableKm * ratePerKm;
    driverAllowance = num(setPrice.outstation_driver_allowance_per_day) * days;
  } else {
    ratePerKm = perKm;
    chargeableKm = Math.max(0, routeKm - num(setPrice.outstation_base_distance));
    distanceFare = chargeableKm * ratePerKm;
    timeFare = Math.max(0, Number(durationMinutes) || 0) * num(setPrice.outstation_time_price);
  }

  const subtotal = base + distanceFare + timeFare + driverAllowance;
  const serviceTax = subtotal * (num(setPrice.service_tax) / 100);
  const total = Math.round(Math.max(subtotal + serviceTax, base));

  return {
    tripType: roundTrip ? 'round_trip' : 'one_way',
    days,
    routeKm: money(routeKm),
    chargeableKm: money(chargeableKm),
    minKmPerDay,
    ratePerKm,
    baseFare: money(base),
    distanceFare: money(distanceFare),
    timeFare: money(timeFare),
    driverAllowance: money(driverAllowance),
    serviceTax: money(serviceTax),
    total,
  };
};
