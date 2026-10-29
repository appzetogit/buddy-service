import { ValidationError, ForbiddenError } from '../auth/errors.js';
import { BuddyIdentity } from './buddyIdentity.model.js';
import { FoodDeliveryPartner } from '../../modules/food/delivery/models/deliveryPartner.model.js';
import { FoodOrder } from '../../modules/food/orders/models/order.model.js';
import { getEffectiveServiceStatus } from './driverOnboardingAdmin.service.js';
import { syncTaxiProfileToPartner } from './taxiPartnerSync.js';

const VALID_MODES = ['off', 'food', 'taxi'];
const OFF_ALIASES = new Set(['off', 'none', 'offline', '', null, undefined]);
const DELIVERY_SERVICES = ['food', 'quickCommerce', 'taxi'];
const SERVICE_LABEL = { food: 'Food', quickCommerce: 'Quick Commerce', taxi: 'Taxi' };

/**
 * `services` picks which delivery jobs the rider takes while online (food,
 * quickCommerce or both). Omitted = an older app: keep whatever was saved.
 */
const normalizeServices = (raw) => {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) throw new ValidationError('services must be an array');
  const services = [...new Set(raw.map((s) => String(s).trim()))];
  if (!services.length || services.some((s) => !DELIVERY_SERVICES.includes(s))) {
    throw new ValidationError(`services must be one or more of: ${DELIVERY_SERVICES.join(', ')}`);
  }
  return services;
};

// Quick Commerce has no activeService of its own: it rides on the food delivery
// pipeline (selected via `services`), so those aliases collapse to 'food'.
const FOOD_ALIASES = new Set(['food', 'quickcommerce', 'quick_commerce', 'quick-commerce', 'qc', 'delivery']);

const normalizeMode = (raw) => {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
  if (OFF_ALIASES.has(value)) return 'off';
  if (FOOD_ALIASES.has(value)) return 'food';
  return value;
};

export const isOffMode = (value) => OFF_ALIASES.has(typeof value === 'string' ? value.toLowerCase() : value);

const IN_FLIGHT_FOOD_STATUSES = [
  'created',
  'accepted',
  'confirmed',
  'preparing',
  'ready_for_pickup',
  'picked_up',
  'reached_drop',
];

export const setDriverMode = async (identity, mode, options = {}) => {
  const normalized = normalizeMode(mode);
  if (!VALID_MODES.includes(normalized)) {
    throw new ValidationError(`mode must be one of: ${VALID_MODES.join(', ')}`);
  }
  mode = normalized;

  if (!identity.onboardingComplete) {
    throw new ForbiddenError('Complete onboarding before going online');
  }

  const partner = await FoodDeliveryPartner.findOne({ identityId: identity._id });

  const services = mode === 'food' ? normalizeServices(options.services) : null;

  if (mode === 'food' && !partner) {
    throw new ForbiddenError('Food capability is not enabled for this driver');
  }
  if (services) {
    for (const svc of services) {
      // Food, Taxi and Quick Commerce each carry their own approval status on the
      // identity (admin approves/rejects them independently), but all three ride on
      // the same FoodDeliveryPartner profile record for KYC/vehicle/bank data.
      const { status } = getEffectiveServiceStatus(identity, svc, partner);
      if (status !== 'approved') {
        throw new ForbiddenError(`${SERVICE_LABEL[svc]} is ${status.replace('_', ' ')} — wait for admin approval`);
      }
    }
  } else if (mode === 'food' && partner.status !== 'approved') {
    throw new ForbiddenError(
      `Food capability is ${partner.status || 'pending'} — wait for admin approval`,
    );
  }

  if (mode !== 'food' && partner) {
    const activeFoodOrder = await FoodOrder.findOne({
      $or: [
        { 'dispatch.deliveryPartnerId': partner._id },
        { 'dispatch.sharedPartnerId': partner._id },
      ],
      orderStatus: { $in: IN_FLIGHT_FOOD_STATUSES },
    })
      .select('_id orderStatus')
      .lean();
    if (activeFoodOrder) {
      throw new ForbiddenError(
        'You have an active food order. Finish or cancel it before switching mode.',
      );
    }
  }

  const { latitude, longitude } = options;
  const now = new Date();

  const setIdentity = await BuddyIdentity.findOneAndUpdate(
    {
      _id: identity._id,
      activeService: identity.activeService,
    },
    { $set: { activeService: mode, lastLoginAt: now } },
    { new: true },
  );
  if (!setIdentity) {
    throw new ForbiddenError('Mode changed in another session. Please retry.');
  }

  if (partner) {
    const update = {
      availabilityStatus: mode === 'food' ? 'online' : 'offline',
    };
    if (services) update.deliveryServices = services;
    if (mode === 'food' && typeof latitude === 'number' && typeof longitude === 'number') {
      update.lastLocation = { type: 'Point', coordinates: [longitude, latitude] };
      update.lastLat = latitude;
      update.lastLng = longitude;
      update.lastLocationAt = now;
    }
    await FoodDeliveryPartner.updateOne({ _id: partner._id }, { $set: update });
    // Taxi riders registered before the taxi vehicle was copied onto the partner profile (it is what
    // ride matching reads) are put right here, the moment they switch Taxi on.
    if (mode === 'food' && (services || []).includes('taxi')) {
      await syncTaxiProfileToPartner(setIdentity).catch(() => null);
    }
  }

  return {
    activeService: mode,
    services: services || partner?.deliveryServices || null,
    taxiServiceCategories: setIdentity.taxiServiceCategories?.length ? setIdentity.taxiServiceCategories : null,
    capabilities: {
      food: partner ? partner.status || 'approved' : 'not_enabled',
      quickCommerce: getEffectiveServiceStatus(identity, 'quickCommerce', partner).status,
      taxi: getEffectiveServiceStatus(identity, 'taxi', partner).status,
    },
  };
};

export { normalizeMode };

export const getDriverMode = async (identity) => {
  const partner = await FoodDeliveryPartner.findOne({ identityId: identity._id })
    .select('status availabilityStatus deliveryServices')
    .lean();
  return {
    activeService: isOffMode(identity.activeService) ? 'off' : identity.activeService,
    services: partner?.deliveryServices?.length ? partner.deliveryServices : null,
    taxiServiceCategories: identity.taxiServiceCategories?.length ? identity.taxiServiceCategories : null,
    capabilities: {
      food: partner ? partner.status || 'approved' : 'not_enabled',
      quickCommerce: getEffectiveServiceStatus(identity, 'quickCommerce', partner).status,
      taxi: getEffectiveServiceStatus(identity, 'taxi', partner).status,
    },
    food: partner
      ? {
          status: partner.status,
          availabilityStatus: partner.availabilityStatus || 'offline',
        }
      : null,
  };
};
