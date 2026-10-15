import { Airport } from '../admin/models/Airport.js';
import { TaxiAppModule } from '../admin/models/TaxiAppModule.js';
import { findZoneByPickup } from './matchingService.js';

/**
 * What kind of trip a pickup and drop make, which decides the vehicles a rider
 * is offered:
 *
 *   - airport     the pickup is inside an airport the admin has drawn (and that
 *                 airport takes pickups), or the drop is (and it takes drops)
 *   - outstation  the drop is outside every zone, or in another city's zone -
 *                 Bengaluru to Mysuru is outstation though both are zones
 *   - city        pickup and drop in the same city
 *   - unserviceable  the pickup is outside every zone
 *
 * Checked in that order, so a trip to the airport from the city is an airport
 * trip, not a city one. Kept on the server so editing an airport boundary or a
 * zone in the admin panel takes effect without an app release.
 */

// An airport with a location but no drawn boundary still counts within this.
const AIRPORT_FALLBACK_RADIUS_KM = 2;
const CACHE_MS = 60 * 1000;

let airportCache = { rows: null, at: 0 };
let moduleCache = { rows: null, at: 0 };

const activeAirports = async () => {
  if (airportCache.rows && Date.now() - airportCache.at < CACHE_MS) return airportCache.rows;
  const rows = await Airport.find({ active: true, status: 'active' })
    .select('name code location boundary latitude longitude pickup_availability drop_availability airport_surge support_airport_fee')
    .lean();
  airportCache = { rows, at: Date.now() };
  return rows;
};

const activeModules = async () => {
  if (moduleCache.rows && Date.now() - moduleCache.at < CACHE_MS) return moduleCache.rows;
  const rows = await TaxiAppModule.find({}).select('name service_type transport_type active').lean();
  moduleCache = { rows: rows.filter((row) => Number(row.active) === 1 || row.active === true), at: Date.now() };
  return moduleCache.rows;
};

/// Ray casting over a GeoJSON ring of [lng, lat] points.
const insideRing = ([lng, lat], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
};

const distanceKm = ([lng1, lat1], [lng2, lat2]) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const airportAt = (airports, point) =>
  airports.find((airport) => {
    const ring = airport.boundary?.coordinates?.[0];
    if (Array.isArray(ring) && ring.length >= 4) return insideRing(point, ring);
    const centre = airport.location?.coordinates
      || (Number.isFinite(airport.longitude) && Number.isFinite(airport.latitude) ? [airport.longitude, airport.latitude] : null);
    return centre ? distanceKm(point, centre) <= AIRPORT_FALLBACK_RADIUS_KM : false;
  }) || null;

/// The app module whose vehicles a trip category offers.
const moduleFor = (modules, category) => {
  const taxi = modules.filter((row) => (row.transport_type || 'taxi') === 'taxi');
  if (category === 'outstation') return taxi.find((row) => row.service_type === 'outstation') || null;
  if (category === 'airport') return taxi.find((row) => /airport/i.test(row.name)) || null;
  return (
    taxi.find((row) => row.service_type === 'normal' && /city/i.test(row.name))
    || taxi.find((row) => row.service_type === 'normal' && !/airport/i.test(row.name))
    || null
  );
};

const serviceLocationOf = (zone) => {
  const id = zone?.service_location_id?._id || zone?.service_location_id;
  return id ? String(id) : null;
};

/**
 * @param pickup [lng, lat]
 * @param drop   [lng, lat]
 */
export const classifyTrip = async ({ pickup, drop }) => {
  const [pickupZone, dropZone, airports, modules] = await Promise.all([
    findZoneByPickup(pickup).catch(() => null),
    findZoneByPickup(drop).catch(() => null),
    activeAirports(),
    activeModules(),
  ]);

  if (!pickupZone) {
    return {
      category: 'unserviceable',
      message: "We don't serve this pickup point yet.",
      module_id: null,
      module_name: null,
      airport: null,
    };
  }

  const pickupAirport = airportAt(airports, pickup);
  const dropAirport = airportAt(airports, drop);
  const airport =
    (pickupAirport && pickupAirport.pickup_availability !== false ? { row: pickupAirport, end: 'pickup' } : null)
    || (dropAirport && dropAirport.drop_availability !== false ? { row: dropAirport, end: 'drop' } : null);

  let category = 'city';
  if (airport) {
    category = 'airport';
  } else if (!dropZone || serviceLocationOf(dropZone) !== serviceLocationOf(pickupZone)) {
    category = 'outstation';
  }

  const module = moduleFor(modules, category);
  const airportSurgeFee = Math.max(0, Number(airport?.row.airport_surge) || 0);
  const airportSupportFee = Math.max(0, Number(airport?.row.support_airport_fee) || 0);

  return {
    category,
    module_id: module ? String(module._id) : null,
    module_name: module?.name || null,
    pickup_zone: { id: String(pickupZone._id), name: pickupZone.name || '' },
    drop_zone: dropZone ? { id: String(dropZone._id), name: dropZone.name || '' } : null,
    airport: airport
      ? {
          id: String(airport.row._id),
          name: airport.row.name,
          code: airport.row.code || '',
          end: airport.end,
          // Flat charges the admin set on the airport ("airport surge fee" and
          // "support airport fee"), added once to an airport trip's fare.
          surge_fee: airportSurgeFee,
          support_fee: airportSupportFee,
          total_fee: airportSurgeFee + airportSupportFee,
        }
      : null,
  };
};
