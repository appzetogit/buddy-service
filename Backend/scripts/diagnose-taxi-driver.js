/**
 * Why is this driver not being offered taxi rides? Read-only: prints every condition ride matching
 * checks, so the failing one is obvious.
 *
 * USAGE
 *   node scripts/diagnose-taxi-driver.js 9301988718            # the driver's own state
 *   node scripts/diagnose-taxi-driver.js 9301988718 <rideId>   # ...and whether that ride would be offered
 *
 * Mirrors taxi/services/matchingService.js (buildDriverMatchFilters) and rideService accept rules.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { config } from '../src/config/env.js';
import { BuddyIdentity } from '../src/core/identity/buddyIdentity.model.js';
import { normalizePhone } from '../src/core/identity/identity.helpers.js';
import { FoodDeliveryPartner } from '../src/modules/food/delivery/models/deliveryPartner.model.js';
import { Ride } from '../src/modules/taxi/user/models/Ride.js';
import { Vehicle } from '../src/modules/taxi/admin/models/Vehicle.js';
import { driverTakesRide, rideCategoryOf } from '../src/modules/taxi/shared/driverRideFilters.js';
import { expandRiderVehicleKeys } from '../src/modules/taxi/shared/vehicleClasses.js';

dotenv.config();

const phone = normalizePhone(process.argv[2] || '');
const rideId = process.argv[3] || '';
if (phone.length !== 10) {
  console.error('Usage: node scripts/diagnose-taxi-driver.js <10-digit phone> [rideId]');
  process.exit(1);
}

const FRESH_LOCATION_MS = 5 * 60 * 1000;
const ok = (pass, label, detail = '') => console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);

await mongoose.connect(config.mongodbUri || config.mongoUri || process.env.MONGO_URI || process.env.MONGODB_URI);

const identity = await BuddyIdentity.findOne({ phone });
const partner = await FoodDeliveryPartner.findOne({ $or: [{ identityId: identity?._id }, { phone }] }).lean();

console.log(`\n== Identity ==`);
if (!identity) console.log('no BuddyIdentity for this phone (never signed in as a driver)');
else {
  console.log({
    onboardingComplete: identity.onboardingComplete,
    onboardingServices: identity.onboardingServices,
    serviceStatuses: identity.serviceStatuses,
    activeService: identity.activeService,
    taxiVehicle: { type: identity.taxiVehicle?.type, make: identity.taxiVehicle?.make, model: identity.taxiVehicle?.model, number: identity.taxiVehicle?.number },
    taxiServiceCategories: identity.taxiServiceCategories ?? '(never chosen = all)',
  });
}

console.log(`\n== Partner profile (what ride matching reads) ==`);
if (!partner) {
  console.log('NO partner profile - this driver can never be matched. Sign in again to re-register.');
  await mongoose.disconnect();
  process.exit(0);
}
console.log({
  _id: String(partner._id),
  status: partner.status,
  taxiApproved: partner.taxiApproved,
  availabilityStatus: partner.availabilityStatus,
  deliveryServices: partner.deliveryServices,
  isOnRide: partner.isOnRide,
  vehicleType: partner.vehicleType,
  taxiVehicleType: partner.taxiVehicleType,
  taxiServiceCategories: partner.taxiServiceCategories ?? '(unset = all)',
  lastLocationAt: partner.lastLocationAt,
  lastLocation: partner.lastLocation?.coordinates,
});

const ageMs = partner.lastLocationAt ? Date.now() - new Date(partner.lastLocationAt).getTime() : Infinity;
console.log(`\n== Conditions for being offered a taxi ride ==`);
ok(partner.status === 'approved' || partner.taxiApproved === true, "approved for taxi (partner.status 'approved' OR taxiApproved)", `status='${partner.status}' taxiApproved=${partner.taxiApproved}`);
ok(identity?.serviceStatuses?.taxi?.status === 'approved', "taxi service approved by admin (identity)", `is '${identity?.serviceStatuses?.taxi?.status}'`);
ok(partner.availabilityStatus === 'online', "availabilityStatus is 'online'", `is '${partner.availabilityStatus}'`);
ok((partner.deliveryServices || []).includes('taxi'), "'taxi' is in deliveryServices (Taxi switched on)", JSON.stringify(partner.deliveryServices));
ok(partner.isOnRide !== true, 'not already on a ride');
ok(ageMs <= FRESH_LOCATION_MS, 'location updated in the last 5 minutes', Number.isFinite(ageMs) ? `${Math.round(ageMs / 1000)}s ago` : 'never');
ok(Boolean(partner.lastLocation?.coordinates?.length), 'has a lastLocation point');
ok(Boolean(partner.vehicleType || partner.taxiVehicleType), 'has a vehicle type on the partner profile', `vehicleType='${partner.vehicleType || ''}' taxiVehicleType='${partner.taxiVehicleType || ''}'`);

if (rideId) {
  const ride = await Ride.findById(rideId).lean();
  console.log(`\n== Ride ${rideId} ==`);
  if (!ride) console.log('ride not found');
  else {
    const vehicles = await Vehicle.find({ _id: { $in: [ride.vehicleTypeId, ...(ride.dispatchVehicleTypeIds || [])].filter(Boolean) } }).select('name vehicle_type icon_types').lean();
    const keys = [...new Set(vehicles.flatMap((v) => [v.name, v.vehicle_type, v.icon_types]).concat([ride.vehicleIconType]).map((k) => String(k || '').trim().toLowerCase()).filter(Boolean))];
    const regexes = expandRiderVehicleKeys(keys).map((k) => new RegExp(`^${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
    const t = driverTakesRide(partner, { regexes, serviceType: ride.serviceType });
    console.log({ serviceType: ride.serviceType, kind: rideCategoryOf(ride.serviceType), status: ride.status, scheduledAt: ride.scheduledAt, vehicles: vehicles.map((v) => v.name), wantsVehicleKeys: keys });
    ok(t.vehicleOk, "driver's vehicle matches the booked vehicle");
    ok(t.categoryOk, `driver takes '${rideCategoryOf(ride.serviceType)}' rides`);
    if (ride.scheduledAt && new Date(ride.scheduledAt) > new Date()) {
      const leadMin = Number(process.env.SCHEDULED_DISPATCH_LEAD_MINUTES ?? 15);
      const offerAt = new Date(new Date(ride.scheduledAt).getTime() - leadMin * 60000);
      console.log(`NOTE  booked ahead: offered as a request only from ${offerAt.toISOString()} (${leadMin} min before pickup). Before that it is only in the driver's Scheduled rides list.`);
    }
  }
}

await mongoose.disconnect();
