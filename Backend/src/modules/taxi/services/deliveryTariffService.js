import { SetPrice } from '../admin/models/SetPrice.js';

/**
 * The delivery tariff that applies to one vehicle in one zone.
 *
 * Delivery used to price from a single tariff stored on the vehicle type, so a
 * parcel cost the same in every city — and the per-zone delivery prices an
 * admin enters under Set Prices were never read by anything that quotes or
 * books a parcel. This resolves them in the order rides already use:
 *
 *   1. a Set Prices row for this vehicle in this exact zone
 *   2. a Set Prices row for this vehicle in the zone's service location that
 *      names no zone of its own
 *   3. the vehicle's own delivery pricing — the default everywhere
 *
 * A row that names a zone only ever applies to that zone. Without that rule a
 * price entered for Bangalore would quietly become every other city's price
 * whenever it was the only row for the vehicle.
 *
 * A Set Prices row with neither a zone nor a service location is not used. For
 * delivery the vehicle's own pricing already is the default everywhere, and two
 * competing "everywhere" prices is how the old confusion started.
 *
 * The caller supplies the zone. Looking it up here would mean importing
 * matchingService, which imports rideService, which needs this module.
 */

const TRANSPORT_TYPES = ['delivery', 'both'];

const toId = (value) => {
  if (!value) return '';
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
};

const nonNegative = (value) => Math.max(0, Number(value) || 0);

/// A row that sets neither a base fare nor a per-km rate prices nothing. It is
/// treated as absent rather than as a free delivery.
const isPricedRow = (row) =>
  nonNegative(row.base_price) > 0 || nonNegative(row.price_per_distance) > 0;

const fromSetPrice = (row, source) => ({
  source,
  setPriceId: row._id,
  enabled: true,
  basePrice: nonNegative(row.base_price),
  baseDistanceKm: nonNegative(row.base_distance),
  pricePerKm: nonNegative(row.price_per_distance),
  serviceTaxPercentage: nonNegative(row.service_tax),
  waitingChargePerMinute: nonNegative(row.waiting_charge),
  freeWaitingMinutes: nonNegative(row.free_waiting_before),
});

/// The vehicle's own delivery pricing, in the same shape as a zone tariff.
export const vehicleDeliveryTariff = (vehicle = {}) => {
  const pricing = vehicle?.delivery_distance_pricing || {};
  const basePrice = nonNegative(pricing.base_price);
  const pricePerKm = nonNegative(pricing.distance_price);

  return {
    source: 'vehicle',
    setPriceId: null,
    enabled: Boolean(pricing.enabled || basePrice > 0 || pricePerKm > 0),
    basePrice,
    baseDistanceKm: nonNegative(pricing.base_distance ?? pricing.free_distance),
    pricePerKm,
    serviceTaxPercentage: nonNegative(vehicle?.service_tax),
    waitingChargePerMinute: nonNegative(pricing.time_price),
    freeWaitingMinutes: nonNegative(pricing.free_time),
  };
};

/**
 * The tariff for [vehicle] in [zone], or the vehicle's own when the zone has
 * none. [vehicle] is a lean Vehicle carrying `delivery_distance_pricing` and
 * `service_tax`; [zone] may be null for a trip outside every polygon.
 */
export const resolveDeliveryTariff = async ({ vehicle, zone = null } = {}) => {
  const fallback = vehicleDeliveryTariff(vehicle);
  const zoneId = toId(zone?._id);
  const serviceLocationId = toId(zone?.service_location_id);

  if (!vehicle?._id || (!zoneId && !serviceLocationId)) {
    return fallback;
  }

  const scopes = [];
  if (zoneId) scopes.push({ zone_id: zoneId });
  if (serviceLocationId) scopes.push({ zone_id: null, service_location_id: serviceLocationId });

  const rows = await SetPrice.find({
    vehicle_type: vehicle._id,
    transport_type: { $in: TRANSPORT_TYPES },
    pricing_scope: { $in: ['ride', null] },
    active: 1,
    status: 'active',
    $or: scopes,
  })
    .select('zone_id service_location_id transport_type base_price base_distance price_per_distance service_tax waiting_charge free_waiting_before')
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  // This zone before its service location; a delivery-only row before one
  // shared with rides. Sorting is stable, so ties go to the newest.
  const rank = (row) =>
    (zoneId && toId(row.zone_id) === zoneId ? 0 : 2) + (row.transport_type === 'delivery' ? 0 : 1);

  const best = rows.filter(isPricedRow).sort((a, b) => rank(a) - rank(b))[0];
  if (!best) {
    return fallback;
  }

  return fromSetPrice(best, zoneId && toId(best.zone_id) === zoneId ? 'zone' : 'service_location');
};
