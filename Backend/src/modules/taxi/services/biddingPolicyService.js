/// Bidding is permanently disabled on this installation.
export const BIDDING_SERVICES = Object.freeze([
  { key: 'city', label: 'City ride (includes airport)' },
  { key: 'outstation', label: 'Outstation' },
  { key: 'parcel', label: 'Parcel and delivery' },
]);

const BIDDING_SERVICE_KEYS = BIDDING_SERVICES.map((service) => service.key);

export const resolveBiddingServiceKey = (serviceType) => {
  const normalized = String(serviceType || 'ride').trim().toLowerCase();

  if (normalized === 'intercity' || normalized === 'outstation') {
    return 'outstation';
  }

  if (normalized === 'parcel') {
    return 'parcel';
  }

  return 'city';
};

export const parseBiddingServices = () => [];

export const isBiddingEnabled = () => false;

export const appliesToAllVehicles = () => false;

export const resolveBiddingPolicy = async ({ serviceType = 'ride', distanceMeters = 0 } = {}) => ({
  allowed: false,
  mode: 'none',
  serviceKey: resolveBiddingServiceKey(serviceType),
  reason: 'disabled_globally',
  maxDistanceKm: 0,
});

export const resolveCatalogDispatchType = () => 'normal';

export const isBiddingOfferedAnywhere = async () => false;
