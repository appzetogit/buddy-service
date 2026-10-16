import { createDefaultBusinessSettings } from '../admin/data/defaultBusinessSettings.js';
import { AdminBusinessSetting } from '../admin/models/AdminBusinessSetting.js';
import { getOrLoadCachedValue } from '../shared/cache.js';

const defaultTransportRideSettings = createDefaultBusinessSettings().transport_ride || {};
const defaultBidRideSettings = createDefaultBusinessSettings().bid_ride || {};
const SETTINGS_CACHE_TTL_MS = 30_000;

const toPositiveNumber = (value, fallback) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback;
};

export const getTransportRideSettings = async () => {
  return getOrLoadCachedValue(
    'cache:settings:transport_ride',
    {
      ttlMs: SETTINGS_CACHE_TTL_MS,
      load: async () => {
        const businessSettings = await AdminBusinessSetting.findOne({ scope: 'default' })
          .select('transport_ride')
          .lean();

        return {
          ...defaultTransportRideSettings,
          ...(businessSettings?.transport_ride || {}),
        };
      },
    },
  );
};

export const getBidRideSettings = async () => {
  return getOrLoadCachedValue(
    'cache:settings:bid_ride',
    {
      ttlMs: SETTINGS_CACHE_TTL_MS,
      load: async () => {
        const businessSettings = await AdminBusinessSetting.findOne({ scope: 'default' })
          .select('bid_ride')
          .lean();

        return {
          ...defaultBidRideSettings,
          ...(businessSettings?.bid_ride || {}),
        };
      },
    },
  );
};

/// Dispatch timing for one search.
///
/// A ride being bid on gets its own two timers. They have always been in the
/// settings document and were read by nothing, so a bidding ride was searched
/// on the regular ride's clock; pass `bidding` and the admin's bidding timers
/// are the ones that apply.
export const resolveTransportDispatchConfig = async ({ bidding = false } = {}) => {
  const settings = await getTransportRideSettings();
  const driverSearchRadiusKm = toPositiveNumber(
    settings.driver_search_radius,
    toPositiveNumber(defaultTransportRideSettings.driver_search_radius, 5),
  );
  const retryWindowSeconds = bidding
    ? toPositiveNumber(
        settings.maximum_time_for_accept_reject_bidding_ride,
        toPositiveNumber(defaultTransportRideSettings.maximum_time_for_accept_reject_bidding_ride, 60),
      )
    : toPositiveNumber(
        settings.trip_accept_reject_duration_for_driver,
        toPositiveNumber(defaultTransportRideSettings.trip_accept_reject_duration_for_driver, 15),
      );
  const maxSearchSeconds = bidding
    ? toPositiveNumber(
        settings.maximum_time_for_find_drivers_for_bitting_ride,
        toPositiveNumber(defaultTransportRideSettings.maximum_time_for_find_drivers_for_bitting_ride, 300),
      )
    : toPositiveNumber(
        settings.maximum_time_for_find_drivers_for_regular_ride,
        toPositiveNumber(defaultTransportRideSettings.maximum_time_for_find_drivers_for_regular_ride, 300),
      );

  return {
    settings,
    bidding: Boolean(bidding),
    dispatchType: String(settings.trip_dispatch_type || defaultTransportRideSettings.trip_dispatch_type) === '2'
      ? 'broadcast'
      : 'one_by_one',
    baseDistanceMeters: Math.round(driverSearchRadiusKm * 1000),
    maxDistanceMeters: Math.round(driverSearchRadiusKm * 1000),
    retryWindowSeconds,
    retryDelayMs: Math.round(retryWindowSeconds * 1000),
    maxSearchSeconds,
    maxAttempts: Math.max(1, Math.ceil(maxSearchSeconds / retryWindowSeconds)),
  };
};
