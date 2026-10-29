/**
 * Which riders a ride may be offered to, as Mongo conditions on the partner document.
 *
 *  - Vehicle: the rider's own vehicle class has to be the one the passenger booked. A rider who
 *    drives a Food bike AND a taxi car keeps the taxi one in `taxiVehicleType` (set from the taxi
 *    vehicle they registered), so either field may match.
 *  - Category: a rider picks the kinds of taxi work they want (`taxiServiceCategories`: city,
 *    outstation, parcel). A rider who never chose (registered before the choice existed) takes
 *    every kind, exactly as before.
 */

/// The kind of taxi work a ride is: a city ride, an outstation (intercity) trip or a parcel.
export const rideCategoryOf = (serviceType) => {
  const type = String(serviceType || 'ride').trim().toLowerCase();
  if (type === 'intercity' || type === 'outstation') return 'outstation';
  if (type === 'parcel') return 'parcel';
  return 'city';
};

export const TAXI_SERVICE_CATEGORIES = ['city', 'outstation', 'parcel'];

const vehicleClause = (regexes) => ({
  $or: [{ vehicleType: { $in: regexes } }, { taxiVehicleType: { $in: regexes } }],
});

const categoryClause = (category) => ({
  $or: [
    { taxiServiceCategories: { $exists: false } },
    { taxiServiceCategories: { $size: 0 } },
    { taxiServiceCategories: category },
  ],
});

/** @param regexes RegExp[] of acceptable vehicle classes (empty = any), @param serviceType the ride's serviceType */
export const driverRideFilter = ({ regexes = [], serviceType } = {}) => {
  const and = [];
  if (regexes.length) and.push(vehicleClause(regexes));
  and.push(categoryClause(rideCategoryOf(serviceType)));
  return { $and: and };
};

/** Does this rider (a lean partner doc) take rides like this one? Same rule as [driverRideFilter]. */
export const driverTakesRide = (driver, { regexes = [], serviceType } = {}) => {
  const vehicleOk = !regexes.length
    || regexes.some((m) => m.test(String(driver?.vehicleType || '')) || m.test(String(driver?.taxiVehicleType || '')));
  const cats = Array.isArray(driver?.taxiServiceCategories) ? driver.taxiServiceCategories : [];
  const categoryOk = cats.length === 0 || cats.includes(rideCategoryOf(serviceType));
  return { vehicleOk, categoryOk, ok: vehicleOk && categoryOk };
};
