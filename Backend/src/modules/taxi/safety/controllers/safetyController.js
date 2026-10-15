import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { SafetyAlert } from '../../common/models/SafetyAlert.js';
import { Driver } from '../../driver/models/Driver.js';
import { Delivery } from '../../user/models/Delivery.js';
import { Ride } from '../../user/models/Ride.js';
import { User } from '../../user/models/User.js';
import { emitToAdmins } from '../../services/dispatchService.js';

const cleanString = (value = '') => String(value || '').trim();

const normalizeCoordinates = (value) => {
  if (Array.isArray(value) && value.length >= 2) {
    const [lng, lat] = value;
    if (Number.isFinite(Number(lng)) && Number.isFinite(Number(lat))) {
      return [Number(lng), Number(lat)];
    }
  }

  const nestedCoordinates = value?.coordinates;
  if (Array.isArray(nestedCoordinates) && nestedCoordinates.length >= 2) {
    const [lng, lat] = nestedCoordinates;
    if (Number.isFinite(Number(lng)) && Number.isFinite(Number(lat))) {
      return [Number(lng), Number(lat)];
    }
  }

  const lat = Number(value?.lat ?? value?.latitude);
  const lng = Number(value?.lng ?? value?.longitude ?? value?.lon);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return [Number(lng), Number(lat)];
  }

  return null;
};

const serializeSafetyAlert = (alert = {}) => {
  const coordinates = Array.isArray(alert?.location?.coordinates) ? alert.location.coordinates : [];
  const [lng, lat] = coordinates;

  return {
    id: String(alert?._id || ''),
    incidentType: cleanString(alert?.incidentType || 'sos').toLowerCase(),
    status: cleanString(alert?.status || 'active').toLowerCase(),
    sourceApp: cleanString(alert?.sourceApp || '').toLowerCase(),
    serviceType: cleanString(alert?.serviceType || 'general').toLowerCase(),
    riderName: cleanString(alert?.riderName),
    riderPhone: cleanString(alert?.riderPhone),
    driverName: cleanString(alert?.driverName),
    driverPhone: cleanString(alert?.driverPhone),
    vehicleLabel: cleanString(alert?.vehicleLabel),
    tripCode: cleanString(alert?.tripCode),
    pickupAddress: cleanString(alert?.pickupAddress),
    dropAddress: cleanString(alert?.dropAddress),
    locationLabel: cleanString(alert?.locationLabel),
    location:
      Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
        ? {
            lat: Number(lat),
            lng: Number(lng),
            coordinates: [Number(lng), Number(lat)],
          }
        : null,
    notes: cleanString(alert?.notes),
    triggeredBy: cleanString(alert?.snapshot?.triggeredBy) || (alert?.sourceApp === 'driver' ? 'driver' : 'rider'),
    rider: alert?.snapshot?.rider || (alert?.riderName || alert?.riderPhone
      ? { name: cleanString(alert?.riderName), phone: cleanString(alert?.riderPhone) }
      : null),
    driver: alert?.snapshot?.driver || (alert?.driverName || alert?.driverPhone
      ? { name: cleanString(alert?.driverName), phone: cleanString(alert?.driverPhone) }
      : null),
    ride: alert?.snapshot?.ride || null,
    driverLocation: alert?.snapshot?.driverLocation || null,
    createdAt: alert?.createdAt || null,
    updatedAt: alert?.updatedAt || null,
    resolvedAt: alert?.resolvedAt || null,
    rideId: alert?.rideId ? String(alert.rideId?._id || alert.rideId) : '',
    deliveryId: alert?.deliveryId ? String(alert.deliveryId?._id || alert.deliveryId) : '',
    userId: alert?.userId ? String(alert.userId?._id || alert.userId) : '',
    driverId: alert?.driverId ? String(alert.driverId?._id || alert.driverId) : '',
    logs: Array.isArray(alert?.logs)
      ? alert.logs.map((log) => ({
          id: String(log?._id || ''),
          actorRole: cleanString(log?.actorRole || 'system').toLowerCase(),
          message: cleanString(log?.message),
          createdAt: log?.createdAt || null,
        }))
      : [],
  };
};

const RIDER_FIELDS = 'name phone email profileImage emergencyContacts';
const MAX_EMERGENCY_CONTACTS = 5;

/// Up to five contacts with a usable phone number, from whatever the app
/// sent. Anything else is dropped rather than refused: an SOS must never fail
/// on a badly typed contact.
export const sanitizeEmergencyContacts = (list) =>
  (Array.isArray(list) ? list : [])
    .map((contact) => ({
      name: cleanString(contact?.name).slice(0, 60),
      phone: cleanString(contact?.phone).replace(/[^\d+]/g, '').slice(0, 15),
      relation: cleanString(contact?.relation || 'Other').slice(0, 30) || 'Other',
    }))
    .filter((contact) => contact.phone.replace(/\D/g, '').length >= 6)
    .slice(0, MAX_EMERGENCY_CONTACTS);
const DRIVER_FIELDS = 'name phone profileImage rating vehicleType vehicleNumber vehicleMake vehicleModel vehicleColor location';
// A ride still under way, for an SOS sent without a ride id (the driver
// app's profile screen sends none).
const LIVE_RIDE_STATUSES = ['accepted', 'ongoing'];

const findLiveRideId = async ({ sourceApp, authId }) => {
  if (!authId) return '';
  const owner = sourceApp === 'driver' ? { driverId: authId } : { userId: authId };
  const ride = await Ride.findOne({ ...owner, status: { $in: LIVE_RIDE_STATUSES } })
    .sort({ updatedAt: -1 })
    .select('_id')
    .lean();
  return ride ? String(ride._id) : '';
};

const vehicleLabelOf = (driver) =>
  [driver?.vehicleNumber, [driver?.vehicleColor, driver?.vehicleMake, driver?.vehicleModel].filter(Boolean).join(' ')]
    .map(cleanString)
    .filter(Boolean)
    .join(' - ');

const pointOf = (coordinates) => {
  const [lng, lat] = Array.isArray(coordinates) ? coordinates.map(Number) : [];
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0) ? { lat, lng } : null;
};

const buildSnapshot = ({ sourceApp, rider, driver, ride, delivery }) => ({
  triggeredBy: sourceApp === 'driver' ? 'driver' : 'rider',
  rider: rider
    ? {
        name: cleanString(rider.name),
        phone: cleanString(rider.phone),
        email: cleanString(rider.email),
        profileImage: cleanString(rider.profileImage),
        emergencyContacts: sanitizeEmergencyContacts(rider.emergencyContacts),
      }
    : null,
  driver: driver
    ? {
        name: cleanString(driver.name),
        phone: cleanString(driver.phone),
        profileImage: cleanString(driver.profileImage),
        rating: Number(driver.rating) || null,
        vehicleType: cleanString(driver.vehicleType),
        vehicleNumber: cleanString(driver.vehicleNumber),
        vehicleMake: cleanString(driver.vehicleMake),
        vehicleModel: cleanString(driver.vehicleModel),
        vehicleColor: cleanString(driver.vehicleColor),
      }
    : null,
  ride: ride || delivery
    ? {
        status: cleanString(ride?.liveStatus || ride?.status || delivery?.status),
        serviceType: cleanString(ride?.serviceType) || (delivery ? 'parcel' : 'ride'),
        fare: Number(ride?.fare ?? delivery?.fare) || null,
        paymentMethod: cleanString(ride?.paymentMethod || delivery?.paymentMethod),
        otp: cleanString(ride?.otp),
        acceptedAt: ride?.acceptedAt || null,
        startedAt: ride?.startedAt || null,
      }
    : null,
  // Where the driver's phone last reported - the car itself, which may not
  // be where the SOS was pressed.
  driverLocation: pointOf(ride?.lastDriverLocation?.coordinates) || pointOf(driver?.location?.coordinates),
});

const readRideContext = async ({ rideId, deliveryId }) => {
  let ride = null;
  let delivery = null;

  if (rideId) {
    ride = await Ride.findById(rideId)
      .populate('userId', RIDER_FIELDS)
      .populate('driverId', DRIVER_FIELDS)
      .lean();
  }

  if (deliveryId) {
    delivery = await Delivery.findById(deliveryId)
      .populate('userId', RIDER_FIELDS)
      .populate('driverId', DRIVER_FIELDS)
      .lean();
  }

  if (!delivery && ride?.deliveryId) {
    delivery = await Delivery.findById(ride.deliveryId)
      .populate('userId', RIDER_FIELDS)
      .populate('driverId', DRIVER_FIELDS)
      .lean();
  }

  if (!ride && delivery?.rideId) {
    ride = await Ride.findById(delivery.rideId)
      .populate('userId', RIDER_FIELDS)
      .populate('driverId', DRIVER_FIELDS)
      .lean();
  }

  return { ride, delivery };
};

const deriveServiceType = ({ requestedServiceType, ride, delivery }) => {
  const direct = cleanString(requestedServiceType).toLowerCase();
  if (['ride', 'parcel', 'intercity', 'general'].includes(direct)) {
    return direct;
  }

  const rideType = cleanString(ride?.serviceType || ride?.type).toLowerCase();
  if (['ride', 'parcel', 'intercity'].includes(rideType)) {
    return rideType;
  }

  if (delivery) {
    return 'parcel';
  }

  return 'general';
};

const createAlertRecord = async ({
  sourceApp,
  authId,
  rideId,
  deliveryId,
  serviceType,
  location,
  locationLabel,
  pickupAddress,
  dropAddress,
  notes,
  tripCode,
  vehicleLabel,
  emergencyContacts,
}) => {
  // No ride id sent: the person's ride in progress, if there is one, so the
  // admin still sees who the other party is.
  const effectiveRideId = rideId || (deliveryId ? '' : await findLiveRideId({ sourceApp, authId }));
  const { ride, delivery } = await readRideContext({ rideId: effectiveRideId, deliveryId });
  let actorUser = sourceApp === 'user'
    ? await User.findById(authId).select(RIDER_FIELDS).lean()
    : ride?.userId || delivery?.userId || null;
  // Contacts sent with the SOS are the freshest; they also refresh the copy on
  // the profile, which is what a driver-pressed SOS will show.
  const sentContacts = sourceApp === 'user' ? sanitizeEmergencyContacts(emergencyContacts) : [];
  if (sentContacts.length && actorUser) {
    actorUser = { ...actorUser, emergencyContacts: sentContacts };
    await User.updateOne({ _id: authId }, { $set: { emergencyContacts: sentContacts } }).catch(() => null);
  }
  const actorDriver = sourceApp === 'driver'
    ? await Driver.findById(authId).select(DRIVER_FIELDS).lean()
    : ride?.driverId || delivery?.driverId || null;
  // Where SOS was pressed; a driver's SOS sent without a position falls back
  // to where their phone last reported, before the ride's pickup.
  const coords =
    normalizeCoordinates(location)
    || (sourceApp === 'driver' ? normalizeCoordinates(actorDriver?.location) : null)
    || normalizeCoordinates(ride?.lastDriverLocation)
    || normalizeCoordinates(delivery?.pickupLocation)
    || normalizeCoordinates(ride?.pickupLocation);

  const created = await SafetyAlert.create({
    sourceApp,
    serviceType: deriveServiceType({ requestedServiceType: serviceType, ride, delivery }),
    userId: sourceApp === 'user' ? authId : actorUser?._id || null,
    driverId: sourceApp === 'driver' ? authId : actorDriver?._id || null,
    rideId: ride?._id || rideId || null,
    deliveryId: delivery?._id || deliveryId || null,
    riderName: cleanString(actorUser?.name),
    riderPhone: cleanString(actorUser?.phone),
    driverName: cleanString(actorDriver?.name),
    driverPhone: cleanString(actorDriver?.phone),
    vehicleLabel: cleanString(vehicleLabel) || vehicleLabelOf(actorDriver),
    snapshot: buildSnapshot({ sourceApp, rider: actorUser, driver: actorDriver, ride, delivery }),
    tripCode:
      cleanString(tripCode)
      || cleanString(ride?.bookingId)
      || cleanString(ride?._id)
      || cleanString(delivery?._id),
    pickupAddress:
      cleanString(pickupAddress)
      || cleanString(delivery?.pickupAddress)
      || cleanString(ride?.pickupAddress),
    dropAddress:
      cleanString(dropAddress)
      || cleanString(delivery?.dropAddress)
      || cleanString(ride?.dropAddress),
    locationLabel:
      cleanString(locationLabel)
      || cleanString(delivery?.pickupAddress)
      || cleanString(ride?.pickupAddress),
    location: coords ? { type: 'Point', coordinates: coords } : undefined,
    notes: cleanString(notes),
    logs: [
      {
        actorRole: 'system',
        message: `SOS triggered from ${sourceApp} app`,
      },
    ],
  });

  return SafetyAlert.findById(created._id).lean();
};

export const triggerUserSosAlert = asyncHandler(async (req, res) => {
  const alert = await createAlertRecord({
    sourceApp: 'user',
    authId: req.auth.sub,
    rideId: cleanString(req.body?.rideId),
    deliveryId: cleanString(req.body?.deliveryId),
    serviceType: req.body?.serviceType,
    location: req.body?.location,
    locationLabel: req.body?.locationLabel,
    pickupAddress: req.body?.pickupAddress,
    dropAddress: req.body?.dropAddress,
    notes: req.body?.notes,
    tripCode: req.body?.tripCode,
    vehicleLabel: req.body?.vehicleLabel,
    emergencyContacts: req.body?.emergencyContacts,
  });

  const payload = serializeSafetyAlert(alert);
  emitToAdmins('new_sos', payload);
  emitToAdmins('safety:alert:new', payload);

  res.json({ success: true, data: payload });
});

/// The rider's emergency contacts, so a new phone can restore them.
export const getMyEmergencyContacts = asyncHandler(async (req, res) => {
  const user = await User.findById(req.auth.sub).select('emergencyContacts').lean();
  res.json({ success: true, data: { contacts: sanitizeEmergencyContacts(user?.emergencyContacts) } });
});

/// Replaces the rider's emergency contacts with the app's list.
export const saveMyEmergencyContacts = asyncHandler(async (req, res) => {
  const contacts = sanitizeEmergencyContacts(req.body?.contacts);
  await User.updateOne({ _id: req.auth.sub }, { $set: { emergencyContacts: contacts } });
  res.json({ success: true, data: { contacts } });
});

export const triggerDriverSosAlert = asyncHandler(async (req, res) => {
  const alert = await createAlertRecord({
    sourceApp: 'driver',
    authId: req.auth.sub,
    rideId: cleanString(req.body?.rideId),
    deliveryId: cleanString(req.body?.deliveryId),
    serviceType: req.body?.serviceType,
    location: req.body?.location,
    locationLabel: req.body?.locationLabel,
    pickupAddress: req.body?.pickupAddress,
    dropAddress: req.body?.dropAddress,
    notes: req.body?.notes,
    tripCode: req.body?.tripCode,
    vehicleLabel: req.body?.vehicleLabel,
  });

  const payload = serializeSafetyAlert(alert);
  emitToAdmins('new_sos', payload);
  emitToAdmins('safety:alert:new', payload);

  res.json({ success: true, data: payload });
});

export const listSafetyAlerts = asyncHandler(async (req, res) => {
  const status = cleanString(req.query?.status || 'active').toLowerCase();
  const page = Math.max(1, Number(req.query?.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 25)));
  const query = {};

  if (status && status !== 'all') {
    query.status = status;
  }

  const [results, total] = await Promise.all([
    SafetyAlert.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    SafetyAlert.countDocuments(query),
  ]);

  res.json({
    success: true,
    data: {
      results: results.map(serializeSafetyAlert),
      paginator: {
        current_page: page,
        last_page: Math.max(1, Math.ceil(total / limit)),
        total,
      },
    },
  });
});

export const resolveSafetyAlert = asyncHandler(async (req, res) => {
  const alert = await SafetyAlert.findById(req.params.id);

  if (!alert) {
    res.status(404).json({
      success: false,
      message: 'Safety alert not found',
    });
    return;
  }

  alert.status = 'resolved';
  alert.resolvedAt = new Date();
  alert.resolvedByAdminId = cleanString(req.auth?.sub);
  alert.logs.push({
    actorRole: 'admin',
    message: cleanString(req.body?.note) || 'Incident marked as resolved by admin',
  });

  await alert.save();

  const payload = serializeSafetyAlert(alert.toObject());
  emitToAdmins('safety:alert:updated', payload);

  res.json({ success: true, data: payload });
});
