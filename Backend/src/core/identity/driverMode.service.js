import { ValidationError, ForbiddenError } from '../auth/errors.js';
import { BuddyIdentity } from './buddyIdentity.model.js';
import { FoodDeliveryPartner } from '../../modules/food/delivery/models/deliveryPartner.model.js';
import { FoodOrder } from '../../modules/food/orders/models/order.model.js';

const VALID_MODES = ['off', 'food'];
const OFF_ALIASES = new Set(['off', 'none', 'offline', '', null, undefined]);

const normalizeMode = (raw) => {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
  if (OFF_ALIASES.has(value)) return 'off';
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

  if (mode === 'food' && !partner) {
    throw new ForbiddenError('Food capability is not enabled for this driver');
  }
  if (mode === 'food' && partner.status !== 'approved') {
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
    if (mode === 'food' && typeof latitude === 'number' && typeof longitude === 'number') {
      update.lastLocation = { type: 'Point', coordinates: [longitude, latitude] };
      update.lastLat = latitude;
      update.lastLng = longitude;
      update.lastLocationAt = now;
    }
    await FoodDeliveryPartner.updateOne({ _id: partner._id }, { $set: update });
  }

  return {
    activeService: mode,
    capabilities: {
      food: partner ? partner.status || 'approved' : 'not_enabled',
    },
  };
};

export { normalizeMode };

export const getDriverMode = async (identity) => {
  const partner = await FoodDeliveryPartner.findOne({ identityId: identity._id })
    .select('status availabilityStatus')
    .lean();
  return {
    activeService: isOffMode(identity.activeService) ? 'off' : identity.activeService,
    capabilities: {
      food: partner ? partner.status || 'approved' : 'not_enabled',
    },
    food: partner
      ? {
          status: partner.status,
          availabilityStatus: partner.availabilityStatus || 'offline',
        }
      : null,
  };
};
