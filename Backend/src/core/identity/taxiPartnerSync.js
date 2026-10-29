import { ValidationError } from '../auth/errors.js';
import { FoodDeliveryPartner } from '../../modules/food/delivery/models/deliveryPartner.model.js';

/** The kinds of taxi work a driver can choose. */
export const TAXI_CATEGORIES = ['city', 'outstation', 'parcel'];

/**
 * Cleans the driver's choice. `undefined` = not sent (an older app): leave what is saved.
 * Anything else must name at least one valid kind.
 */
export const normalizeTaxiCategories = (raw) => {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw new ValidationError('serviceCategories must be a list');
  const picked = [...new Set(raw.map((c) => String(c).trim().toLowerCase()))];
  if (picked.length === 0 || picked.some((c) => !TAXI_CATEGORIES.includes(c))) {
    throw new ValidationError(`Choose at least one of: ${TAXI_CATEGORIES.join(', ')}`);
  }
  return picked;
};

/**
 * Copies the taxi vehicle and the chosen kinds of work onto the driver's partner profile, which is
 * what ride matching reads. A taxi-only driver has no Food vehicle, so the base vehicle fields (shown
 * to the passenger) are filled from the taxi vehicle when empty. Safe to call any time; it only
 * writes what the identity actually has.
 */
export const syncTaxiProfileToPartner = async (identity) => {
  if (!identity?._id) return;
  const vehicle = identity.taxiVehicle || {};
  const name = [vehicle.make, vehicle.model].filter(Boolean).join(' ').trim();
  const set = {};
  // The admin approved Taxi for this driver (identity), copied to where ride matching looks.
  if (identity.serviceStatuses?.taxi?.status === 'approved') set.taxiApproved = true;
  if (vehicle.type) set.taxiVehicleType = vehicle.type;
  if (name) set.taxiVehicleName = name;
  if (vehicle.number) set.taxiVehicleNumber = vehicle.number;
  if (Array.isArray(identity.taxiServiceCategories) && identity.taxiServiceCategories.length) {
    set.taxiServiceCategories = [...identity.taxiServiceCategories];
  }
  if (Object.keys(set).length === 0) return;

  await FoodDeliveryPartner.updateMany({ identityId: identity._id }, { $set: set });

  const empty = (field) => ({ $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: '' }] });
  if (vehicle.type) {
    await FoodDeliveryPartner.updateMany({ identityId: identity._id, ...empty('vehicleType') }, { $set: { vehicleType: vehicle.type } });
  }
  if (name) {
    await FoodDeliveryPartner.updateMany({ identityId: identity._id, ...empty('vehicleName') }, { $set: { vehicleName: name } });
  }
};
