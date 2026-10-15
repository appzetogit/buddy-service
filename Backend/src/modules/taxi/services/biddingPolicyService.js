import { getBidRideSettings, getTransportRideSettings } from './transportSettingsService.js';

/// Which services the admin can switch bidding on and off for.
///
/// These are the services a ride can actually be identified as once it reaches
/// the server. The rider app also has an Airport screen, but an airport booking
/// arrives as an ordinary city ride - nothing in the request says which
/// home-screen module it came from - so airport rides follow the city rule
/// until the app starts sending its module.
export const BIDDING_SERVICES = Object.freeze([
  { key: 'city', label: 'City ride (includes airport)' },
  { key: 'outstation', label: 'Outstation' },
  { key: 'parcel', label: 'Parcel and delivery' },
]);

const BIDDING_SERVICE_KEYS = BIDDING_SERVICES.map((service) => service.key);

/// The ride's own serviceType, mapped onto the keys the admin sees.
export const resolveBiddingServiceKey = (serviceType) => {
  const normalized = String(serviceType || 'ride').trim().toLowerCase();

  if (normalized === 'intercity') {
    return 'outstation';
  }

  if (normalized === 'parcel') {
    return 'parcel';
  }

  return 'city';
};

/// Stored as a comma separated list so it fits the settings document, which is
/// a flat bag of strings. An absent value means "every service", so an existing
/// install keeps behaving the way it did before this setting existed; an empty
/// string means the admin cleared every box and bidding is off everywhere.
export const parseBiddingServices = (value) => {
  if (value === undefined || value === null) {
    return [...BIDDING_SERVICE_KEYS];
  }

  const list = Array.isArray(value) ? value : String(value).split(',');

  return list
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter((entry) => BIDDING_SERVICE_KEYS.includes(entry));
};

export const isBiddingEnabled = (settings = {}) =>
  String(settings.bidding_enabled ?? '1').trim() !== '0';

const toNonNegativeNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : fallback;
};

/// Whether the admin has switched bidding on for every vehicle at once.
///
/// Without it, bidding only appears on a vehicle whose type carries a bidding
/// dispatch type, which means adding a vehicle silently leaves bidding off it.
export const appliesToAllVehicles = (settings = {}) =>
  String(settings.bidding_all_vehicles ?? '1').trim() === '1';

const supportsBiddingDispatch = (vehicle, settings) =>
  appliesToAllVehicles(settings) ||
  ['bidding', 'both'].includes(String(vehicle?.dispatch_type || '').trim().toLowerCase());

/// Whether this particular booking may be negotiated, and how.
///
/// One place decides it, so the booking path, the rider catalog and anything
/// added later cannot drift apart. Every "no" carries a reason, which is what
/// the apps need in order to explain themselves rather than silently dropping
/// the rider back to a fixed fare.
export const resolveBiddingPolicy = async ({
  vehicle,
  serviceType,
  distanceMeters = 0,
  bidSettings = null,
  transportSettings = null,
} = {}) => {
  const [bidRide, transportRide] = await Promise.all([
    bidSettings ? Promise.resolve(bidSettings) : getBidRideSettings(),
    transportSettings ? Promise.resolve(transportSettings) : getTransportRideSettings(),
  ]);

  const serviceKey = resolveBiddingServiceKey(serviceType);
  const enabledServices = parseBiddingServices(bidRide.bidding_services);
  // 0 (or blank) means no limit. It is applied to city and parcel bookings
  // only: an outstation trip is long by definition, and a 50 km cap would
  // switch off bidding for the one service that uses driver bids.
  const maxDistanceKm = toNonNegativeNumber(transportRide.bidding_ride_maximum_distance, 0);
  const distanceKm = Math.max(0, Number(distanceMeters) || 0) / 1000;

  const deny = (reason) => ({
    allowed: false,
    mode: 'none',
    serviceKey,
    reason,
    maxDistanceKm,
  });

  if (!isBiddingEnabled(bidRide)) {
    return deny('disabled_globally');
  }

  if (!enabledServices.includes(serviceKey)) {
    return deny('service_not_enabled');
  }

  if (!supportsBiddingDispatch(vehicle, bidRide)) {
    return deny('vehicle_not_biddable');
  }

  if (serviceKey !== 'outstation' && maxDistanceKm > 0 && distanceKm > maxDistanceKm) {
    return deny('distance_above_limit');
  }

  return {
    allowed: true,
    // One negotiation model, everywhere: the rider raises their own fare by
    // the admin's step. Drivers naming their own price ('driver_bid') was only
    // ever reachable on an outstation booking, and the client does not want
    // it - a driver quoting a number is a different product from a rider
    // sweetening the one they were quoted.
    //
    // The driver-bid path is left in the codebase rather than torn out: the
    // RideBid model, the offer screens and the accept endpoint all still work,
    // so bringing it back is a one-line change here rather than a rebuild.
    mode: 'user_increment_only',
    serviceKey,
    reason: null,
    maxDistanceKm,
  };
};

/// The dispatch type the rider catalog should report for a vehicle.
///
/// The app decides whether to show its bid toggle from this one field, and it
/// asks for the catalog without saying which service it is booking - so the
/// master switch and the all-vehicles switch are honoured here, and the
/// per-service rule is applied when the booking is created.
export const resolveCatalogDispatchType = (vehicle, settings = {}) => {
  const stored = String(vehicle?.dispatch_type || 'normal').trim().toLowerCase() || 'normal';

  if (!isBiddingEnabled(settings) || parseBiddingServices(settings.bidding_services).length === 0) {
    return 'normal';
  }

  if (appliesToAllVehicles(settings)) {
    return stored === 'bidding' ? 'bidding' : 'both';
  }

  return stored;
};

/// Whether any service at all may be bid on right now.
///
/// The rider app decides whether to show its bid toggle from the vehicle's
/// dispatch_type in the catalog, and that catalog is not asked for per service.
/// So the master switch can be honoured there; the per-service rule is enforced
/// when the booking is created.
export const isBiddingOfferedAnywhere = async (bidSettings = null) => {
  const bidRide = bidSettings || (await getBidRideSettings());

  return isBiddingEnabled(bidRide) && parseBiddingServices(bidRide.bidding_services).length > 0;
};
