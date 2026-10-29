import { ApiError } from '../../../utils/ApiError.js';
import { expandRiderVehicleKeys } from '../shared/vehicleClasses.js';
import { driverRideFilter } from '../shared/driverRideFilters.js';
import { normalizePoint } from '../../../utils/geo.js';
import { DISPATCH_TOP_DRIVERS } from '../constants/index.js';
import { Vehicle } from '../admin/models/Vehicle.js';
import { Driver } from '../driver/models/Driver.js';
import { Zone } from '../driver/models/Zone.js';
import { getRiderActiveLoadMap } from '../../food/orders/services/rider-capacity.service.js';
import { getDriverIdsBlockedByUpcomingScheduledRides } from './rideService.js';

const EARTH_RADIUS_METERS = 6371000;

const normalizeVehicleKey = (value = '') => String(value || '').trim().toLowerCase();

const normalizeVehicleKeys = (vehicles = []) => {
  const keys = vehicles.flatMap((vehicle) => [
    vehicle?.name,
    vehicle?.vehicle_type,
    vehicle?.icon_types,
    String(vehicle?.name || '').replace(/\s+/g, '_'),
    String(vehicle?.icon_types || '').replace(/\s+/g, '_'),
  ]);

  return [...new Set(keys.map(normalizeVehicleKey).filter(Boolean))];
};

const normalizeVehicleTypeIds = (vehicleTypeIds = [], vehicleTypeId = null) => {
  const values = Array.isArray(vehicleTypeIds) ? vehicleTypeIds : [vehicleTypeIds];

  if (vehicleTypeId) {
    values.push(vehicleTypeId);
  }

  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
};

/** A rider is only offered a ride when they are online, approved and have opted in to taxi jobs. */
const FRESH_LOCATION_MS = 5 * 60 * 1000;

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildDriverMatchFilters = ({ vehicleTypeKeys, serviceType }) => {
  const normalizedVehicleTypeKeys = Array.isArray(vehicleTypeKeys)
    ? expandRiderVehicleKeys([...new Set(vehicleTypeKeys.map(normalizeVehicleKey).filter(Boolean))])
    : [];

  return {
    status: 'approved',
    availabilityStatus: 'online',
    // Taxi is an opt-in job type (the "Jobs you want" choice in the rider app).
    deliveryServices: 'taxi',
    isOnRide: { $ne: true },
    lastLocationAt: { $gte: new Date(Date.now() - FRESH_LOCATION_MS) },
    // The rider's own vehicle (bike, auto, car...) has to be the class the passenger asked for, and
    // they must take this kind of work (city / outstation / parcel).
    ...driverRideFilter({
      regexes: normalizedVehicleTypeKeys.map((key) => new RegExp(`^${escapeRegex(key)}$`, 'i')),
      serviceType,
    }),
  };
};

const buildZoneIntersectionQuery = (coordinates) => ({
  active: { $ne: false },
  status: { $ne: 'inactive' },
  geometry: {
    $geoIntersects: {
      $geometry: {
        type: 'Point',
        coordinates,
      },
    },
  },
});

/// Rough area of a zone's outer ring in km2 - enough to rank zones by size,
/// which is all it is used for. Shoelace on a local equirectangular projection.
const approximateZoneAreaKm2 = (zone) => {
  const ring = zone?.geometry?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4) {
    return Number.POSITIVE_INFINITY;
  }

  const meanLatRadians = (ring.reduce((sum, point) => sum + Number(point[1]), 0) / ring.length) * (Math.PI / 180);
  const kmPerDegreeLng = 111.32 * Math.cos(meanLatRadians);
  const kmPerDegreeLat = 110.57;
  let twiceArea = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    twiceArea += (ring[i][0] * kmPerDegreeLng) * (ring[i + 1][1] * kmPerDegreeLat)
      - (ring[i + 1][0] * kmPerDegreeLng) * (ring[i][1] * kmPerDegreeLat);
  }
  return Math.abs(twiceArea / 2);
};

/// The most specific zone containing a point: the smallest one.
///
/// Zones can nest - a city inside a state-wide catch-all - and the city is the
/// one whose prices and drivers should apply. The previous rule was "newest
/// wins", which made correctness depend on the order zones were created or
/// last edited: adding a state zone would have taken every city inside it, and
/// merely saving a city zone later would have handed it back. Newest is kept
/// only as the tie-break between zones of the same size.
const pickMostSpecificZone = (zones = []) => {
  if (!zones.length) {
    return null;
  }

  return [...zones].sort((a, b) => {
    const byArea = approximateZoneAreaKm2(a) - approximateZoneAreaKm2(b);
    if (byArea !== 0) {
      return byArea;
    }
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  })[0];
};

export const findZoneByPickup = async (pickupCoords, options = {}) => {
  const coordinates = normalizePoint(pickupCoords, 'pickupCoords');
  const normalizedServiceLocationId = String(options?.serviceLocationId || '').trim();

  if (normalizedServiceLocationId) {
    const preferredZones = await Zone.find({
      ...buildZoneIntersectionQuery(coordinates),
      service_location_id: normalizedServiceLocationId,
    });
    const preferredZone = pickMostSpecificZone(preferredZones);

    if (preferredZone) {
      return preferredZone;
    }
  }

  // Zones are authoritative for dispatch. A point rarely sits in more than two
  // or three, so fetching them all and ranking here costs next to nothing.
  return pickMostSpecificZone(await Zone.find(buildZoneIntersectionQuery(coordinates)));
};

const toLocalMeters = (origin, target) => {
  const [originLng, originLat] = origin;
  const [targetLng, targetLat] = target;
  const originLatRadians = (originLat * Math.PI) / 180;
  const metersPerDegreeLat = (Math.PI * EARTH_RADIUS_METERS) / 180;
  const metersPerDegreeLng = metersPerDegreeLat * Math.cos(originLatRadians);

  return {
    x: (targetLng - originLng) * metersPerDegreeLng,
    y: (targetLat - originLat) * metersPerDegreeLat,
  };
};

const getDistanceToSegmentMeters = (origin, segmentStart, segmentEnd) => {
  const start = toLocalMeters(origin, segmentStart);
  const end = toLocalMeters(origin, segmentEnd);
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const segmentLengthSquared = (segmentX * segmentX) + (segmentY * segmentY);

  if (segmentLengthSquared <= 0) {
    return Math.hypot(start.x, start.y);
  }

  const projection = Math.max(
    0,
    Math.min(1, -((start.x * segmentX) + (start.y * segmentY)) / segmentLengthSquared),
  );
  const closestX = start.x + (projection * segmentX);
  const closestY = start.y + (projection * segmentY);

  return Math.hypot(closestX, closestY);
};

const getZoneBoundaryCapMeters = (zone, pickupCoords) => {
  const ring = Array.isArray(zone?.geometry?.coordinates?.[0]) ? zone.geometry.coordinates[0] : [];

  if (ring.length < 3) {
    return null;
  }

  let shortestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const segmentStart = normalizePoint(ring[index], `zone.geometry.coordinates[0][${index}]`);
    const segmentEnd = normalizePoint(ring[index + 1], `zone.geometry.coordinates[0][${index + 1}]`);
    const distanceMeters = getDistanceToSegmentMeters(pickupCoords, segmentStart, segmentEnd);

    if (Number.isFinite(distanceMeters) && distanceMeters < shortestDistance) {
      shortestDistance = distanceMeters;
    }
  }

  return Number.isFinite(shortestDistance) ? Math.max(0, Math.round(shortestDistance)) : null;
};

const getDistanceBetweenMeters = (origin, target) => {
  const [originLng, originLat] = origin;
  const [targetLng, targetLat] = target;

  const dLat = ((targetLat - originLat) * Math.PI) / 180;
  const dLng = ((targetLng - originLng) * Math.PI) / 180;
  const lat1 = (originLat * Math.PI) / 180;
  const lat2 = (targetLat * Math.PI) / 180;

  const a =
    (Math.sin(dLat / 2) ** 2) +
    (Math.cos(lat1) * Math.cos(lat2) * (Math.sin(dLng / 2) ** 2));

  return Math.round(2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

/** Where a delivery partner is right now, whichever location field the platform last wrote. */
const getPartnerCoordinates = (driver = {}) => {
  const candidates = [
    driver?.lastLocation?.coordinates,
    driver?.currentLocation?.coordinates,
    driver?.location?.coordinates,
    Number.isFinite(Number(driver?.lastLng)) && Number.isFinite(Number(driver?.lastLat))
      ? [Number(driver.lastLng), Number(driver.lastLat)]
      : null,
  ];
  return candidates.find((c) => Array.isArray(c) && c.length === 2 && c.every((n) => Number.isFinite(Number(n)))) || null;
};

const getDriverMatchCoordinates = (driver = {}) => {
  const anchorCoordinates = Array.isArray(driver?.routeBooking?.anchorLocation?.coordinates)
    ? driver.routeBooking.anchorLocation.coordinates
    : [];

  if (driver?.routeBooking?.enabled && anchorCoordinates.length === 2) {
    return normalizePoint(anchorCoordinates, 'driver.routeBooking.anchorLocation.coordinates');
  }

  const partnerCoordinates = getPartnerCoordinates(driver);
  return partnerCoordinates ? normalizePoint(partnerCoordinates, 'driver.location.coordinates') : null;
};

const isPointInsidePolygonRing = (point, ring = []) => {
  if (!Array.isArray(ring) || ring.length < 3) {
    return false;
  }

  const [pointLng, pointLat] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [lng1, lat1] = normalizePoint(ring[i], `zone.geometry.coordinates[0][${i}]`);
    const [lng2, lat2] = normalizePoint(ring[j], `zone.geometry.coordinates[0][${j}]`);
    const intersects =
      ((lat1 > pointLat) !== (lat2 > pointLat)) &&
      (pointLng < ((lng2 - lng1) * (pointLat - lat1)) / ((lat2 - lat1) || Number.EPSILON) + lng1);

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
};

const isDriverWithinMatchedZone = (driver, zone) => {
  if (!zone?._id) {
    return true;
  }

  const coordinates = getDriverMatchCoordinates(driver);
  if (!coordinates) {
    return false;
  }

  const ring = Array.isArray(zone?.geometry?.coordinates?.[0]) ? zone.geometry.coordinates[0] : [];
  if (!ring.length) {
    return String(driver?.zoneId || '') === String(zone._id);
  }

  return isPointInsidePolygonRing(coordinates, ring);
};

const filterDriversForMatchedZone = ({ drivers = [], zone = null, pickupCoords, maxDistance }) =>
  drivers.filter((driver) => {
    const coordinates = getDriverMatchCoordinates(driver);
    if (!coordinates) {
      return false;
    }

    if (!isDriverWithinMatchedZone(driver, zone)) {
      return false;
    }

    if (Number.isFinite(maxDistance) && maxDistance > 0) {
      return getDistanceBetweenMeters(pickupCoords, coordinates) <= maxDistance;
    }

    return true;
  });

const buildGeoNearFilter = (field, coordinates, maxDistance) => ({
  [field]: {
    $near: {
      $geometry: {
        type: 'Point',
        coordinates,
      },
      $maxDistance: maxDistance,
    },
  },
});

const getDispatchAnchorCoordinates = (driver = {}) => {
  const routeCoordinates = Array.isArray(driver?.routeBooking?.anchorLocation?.coordinates)
    ? driver.routeBooking.anchorLocation.coordinates
    : [];

  if (driver?.routeBooking?.enabled && routeCoordinates.length === 2) {
    return routeCoordinates;
  }

  return getPartnerCoordinates(driver) || [];
};

const sortDriversByDispatchAnchorDistance = (drivers = [], pickupCoords) =>
  [...drivers]
    .map((driver) => {
      const anchorCoordinates = getDispatchAnchorCoordinates(driver);
      return {
        driver,
        distanceMeters:
          anchorCoordinates.length === 2
            ? getDistanceBetweenMeters(pickupCoords, anchorCoordinates)
            : Number.POSITIVE_INFINITY,
      };
    })
    .sort((left, right) => left.distanceMeters - right.distanceMeters)
    .map(({ driver }) => driver);

const findDriversForZone = async ({
  zoneId,
  serviceLocationId,
  coordinates,
  effectiveMaxDistance,
  limit,
  normalizedVehicleTypeIds,
  vehicleTypeKeys,
  serviceType,
  strictZoneOnly = false,
}) => {
  const commonFilters = buildDriverMatchFilters({ vehicleTypeKeys, serviceType });
  const selectedFields =
    'name phone vehicleType vehicleName vehicleNumber rating profilePhoto lastLocation currentLocation lastLat lastLng lastLocationAt isOnRide deliveryServices';

  const nearby = await Driver.find({
    ...commonFilters,
    ...(strictZoneOnly ? {} : buildGeoNearFilter('lastLocation', coordinates, effectiveMaxDistance)),
  })
    .limit(limit * 3)
    .select(selectedFields);

  // A rider already carrying Food / Quick Commerce work is not free for a passenger.
  const loadMap = await getRiderActiveLoadMap(nearby.map((driver) => driver._id)).catch(() => new Map());
  const free = nearby.filter((driver) => !(loadMap.get(String(driver._id)) > 0)).slice(0, limit);

  // Downstream ranking reads `driver.location`; point it at wherever the partner really is.
  const placed = free.map((driver) => {
    const plain = driver.toObject({ virtuals: true });
    const at = getPartnerCoordinates(plain);
    return { ...plain, id: String(driver._id), location: at ? { type: 'Point', coordinates: at.map(Number) } : undefined };
  });

  return sortDriversByDispatchAnchorDistance(placed, coordinates).slice(0, limit);
};

export const matchDrivers = async (pickupCoords, options = {}) => {
  const coordinates = normalizePoint(pickupCoords, 'pickupCoords');
  const {
    maxDistance = 3000,
    limit = DISPATCH_TOP_DRIVERS,
    vehicleTypeId,
    vehicleTypeIds,
    serviceLocationId = null,
    allowCrossZoneFallback = true,
    strictZoneOnly = false,
    // The kind of ride (ride / intercity / parcel): riders only get the kinds of work they chose.
    serviceType,
  } = options;
  const normalizedVehicleTypeIds = normalizeVehicleTypeIds(vehicleTypeIds, vehicleTypeId);
  const allowedVehicles = normalizedVehicleTypeIds.length
    ? await Vehicle.find({ _id: { $in: normalizedVehicleTypeIds } }).select('name vehicle_type icon_types').lean()
    : [];
  const vehicleTypeKeys = normalizeVehicleKeys(allowedVehicles);

  const zone = await findZoneByPickup(coordinates, { serviceLocationId });
  const zoneBoundaryCapMeters = zone ? getZoneBoundaryCapMeters(zone, coordinates) : null;
  const effectiveMaxDistance = Number.isFinite(zoneBoundaryCapMeters) && zoneBoundaryCapMeters >= 0
    ? Math.min(Math.max(1, Math.round(maxDistance)), Math.max(1, zoneBoundaryCapMeters))
    : Math.max(1, Math.round(maxDistance));

  let drivers = await findDriversForZone({
    zoneId: zone?._id || null,
    serviceLocationId,
    coordinates,
    effectiveMaxDistance,
    limit,
    normalizedVehicleTypeIds,
    vehicleTypeKeys,
    serviceType,
    strictZoneOnly,
  });
  drivers = filterDriversForMatchedZone({
    drivers,
    zone,
    pickupCoords: coordinates,
    maxDistance: effectiveMaxDistance,
  });

  const blockedDriverIds = await getDriverIdsBlockedByUpcomingScheduledRides(
    drivers.map((driver) => String(driver?._id || '')),
  );
  drivers = drivers.filter((driver) => !blockedDriverIds.has(String(driver?._id || '')));

  if (allowCrossZoneFallback && drivers.length === 0 && zone?._id) {
    drivers = await findDriversForZone({
      zoneId: null,
      serviceLocationId,
      coordinates,
      effectiveMaxDistance,
      limit,
      normalizedVehicleTypeIds,
      vehicleTypeKeys,
      serviceType,
      strictZoneOnly,
    });
    drivers = filterDriversForMatchedZone({
      drivers,
      zone: null,
      pickupCoords: coordinates,
      maxDistance: effectiveMaxDistance,
    });

    const fallbackBlockedDriverIds = await getDriverIdsBlockedByUpcomingScheduledRides(
      drivers.map((driver) => String(driver?._id || '')),
    );
    drivers = drivers.filter((driver) => !fallbackBlockedDriverIds.has(String(driver?._id || '')));
  }

  return {
    zone,
    drivers,
    searchRadiusMeters: effectiveMaxDistance,
    zoneBoundaryCapMeters,
  };
};
