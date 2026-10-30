import mongoose from 'mongoose';
import { RentalQuoteRequest, RentalBookingRequest, RentalPackageType, listActiveRentalTrackingBookings, ServiceStore, ServiceCenterStaff, RentalVehicleType, buildRentalTrackingSnapshot } from '../models/UnportedFeatures.js';
import { randomBytes } from 'node:crypto';
import { ApiError } from '../../../../utils/ApiError.js';
import { uploadDataUrl } from '../../shared/fileUpload.js';
import { env } from '../../shared/env.js';
import { createDefaultAdminState } from '../data/defaultAdminState.js';
import { Admin } from '../models/Admin.js';
import { User } from '../../user/models/User.js';
import { UserWallet } from '../../user/models/UserWallet.js';
import { WalletTransaction } from '../../driver/models/WalletTransaction.js';
import { AdminBusinessSetting } from '../models/AdminBusinessSetting.js';
import { AdminAppSetting } from '../models/AdminAppSetting.js';
// AppModule import removed
import { createDefaultBusinessSettings } from '../data/defaultBusinessSettings.js';
import { createDefaultAppSettings } from '../data/defaultAppSettings.js';
import { createDefaultRideVoiceSettings } from '../data/defaultRideVoiceSettings.js';
import { Airport } from '../models/Airport.js';
import { DriverNeededDocument } from '../models/DriverNeededDocument.js';
import { AdminActivity } from '../models/AdminActivity.js';
import { GoodsType } from '../models/GoodsType.js';
import { SetPrice } from '../models/SetPrice.js';
import { describeRidePayment } from '../../services/paymentLedgerService.js';
import { ServiceLocation } from '../models/ServiceLocation.js';
import { Vehicle } from '../models/Vehicle.js';
import { Driver } from '../../driver/models/Driver.js';
import { Zone } from '../../driver/models/Zone.js';
import { Ride } from '../../user/models/Ride.js';
import { AppLanguage } from '../models/AppLanguage.js';
import { RideModule } from '../models/RideModule.js';
import { TaxiAppModule } from '../models/TaxiAppModule.js';
import { UserPreference } from '../models/UserPreference.js';
import { AdminRole } from '../models/AdminRole.js';
import { PaymentMethod } from '../models/PaymentMethod.js';
import { OnboardingScreen } from '../models/OnboardingScreen.js';
import { WithdrawalRequest } from '../models/WithdrawalRequest.js';
import { SupportTicket } from '../../support/models/SupportTicket.js';
import TaxiTransportType from '../models/TaxiTransportType.js';
import { comparePassword, hashPassword } from '../../driver/services/authService.js';
import { grantDriverJoiningBonus,
  applyDriverWalletAdjustment,
  serializeDriverWallet,
} from '../../driver/services/walletService.js';
import { RIDE_LIVE_STATUS, RIDE_STATUS, VEHICLE_TYPES } from '../../constants/index.js';
import {
  cancelRideByAdmin,
  emitToDriver,
  getSocketServer,
} from '../../services/dispatchService.js';
import { getPresenceRoleRoom } from '../../socket/presenceRooms.js';
import { SafetyAlert } from '../../common/models/SafetyAlert.js';
import { getRedisStatus } from '../../shared/redisClient.js';
import { sendEmail } from '../../services/mailService.js';
import { signAccessToken } from '../../services/tokenService.js';
import { applyPriceHikeToSetPrice, getActivePriceHikeMultiplier } from '../../services/priceHikeService.js';
import { DEFAULT_PROFILE, getSurgeProfiles, listActiveSurges, resetVehicleSurgeSettings, updateSurgeSettings } from '../../services/surgeService.js';
import { getBidRideSettings } from '../../services/transportSettingsService.js';
import { resolveCatalogDispatchType } from '../../services/biddingPolicyService.js';
import { PriceHike } from '../models/PriceHike.js';
import {
  ADMIN_PERMISSIONS,
  SUPERADMIN_PERMISSION,
  hasAdminPermission,
  normalizeAdminPermissions,
  normalizeAdminType,
} from './adminAccessService.js';

const PUBLIC_VEHICLE_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
let publicVehicleCatalogCache = {
  expiresAt: 0,
  value: null,
};
const DASHBOARD_CACHE_TTL_MS = 60 * 1000;
let dashboardCache = {
  expiresAt: 0,
  value: null,
};

const deepMerge = (target, source) => {
  const result = { ...target };
  for (const key in source) {
    if (source[key] instanceof Object && key in result && result[key] instanceof Object) {
      result[key] = deepMerge(result[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
};

const trimTrailingSlash = (value = '') => String(value || '').replace(/\/+$/, '');

const normalizeIpAddressList = (value) => {
  const source = Array.isArray(value)
    ? value
    : String(value || '')
      .split(/\r?\n|,/)
      .map((entry) => entry.trim());

  return Array.from(
    new Set(
      source
        .map((entry) => String(entry || '').trim())
        .filter(Boolean),
    ),
  );
};




const buildPaginator = (items, page = 1, limit = 50) => {
  const safePage = Number(page) || 1;
  const safeLimit = Number(limit) || 50;
  const start = (safePage - 1) * safeLimit;
  const results = items.slice(start, start + safeLimit);

  return {
    results,
    paginator: {
      current_page: safePage,
      per_page: safeLimit,
      total: items.length,
      last_page: Math.max(1, Math.ceil(items.length / safeLimit)),
    },
  };
};

const nextId = () => new mongoose.Types.ObjectId().toString();
const toObjectId = (value) => {
  if (value === null || value === undefined) return null;

  const normalized =
    typeof value === 'string'
      ? value.trim()
      : String(value).trim();

  if (!normalized || !mongoose.isValidObjectId(normalized)) {
    return null;
  }

  return new mongoose.Types.ObjectId(normalized);
};

const normalizeBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  return false;
};

const normalizeObjectIdList = (values = []) =>
  [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))]
    .map(toObjectId)
    .filter(Boolean);

const getAdminScope = (admin = {}) => ({
  adminType: normalizeAdminType(admin.admin_type || admin.role),
  serviceLocationIds: normalizeObjectIdList(admin.service_location_ids),
  zoneIds: normalizeObjectIdList(admin.zone_ids),
});

const isSuperAdmin = (admin = {}) => getAdminScope(admin).adminType === 'superadmin';

const buildNoAccessQuery = (field) => ({ [field]: { $in: [] } });

const getScopedZoneIds = async (admin = {}) => {
  const { adminType, zoneIds, serviceLocationIds } = getAdminScope(admin);

  if (adminType === 'superadmin') {
    return [];
  }

  if (zoneIds.length > 0) {
    return zoneIds;
  }

  if (serviceLocationIds.length === 0) {
    return [];
  }

  const zoneIdsFromLocations = await Zone.find({
    service_location_id: { $in: serviceLocationIds },
  }).distinct('_id');

  return zoneIdsFromLocations.map((value) => toObjectId(value)).filter(Boolean);
};

const buildServiceLocationScopeQuery = (admin = {}, field = 'service_location_id') => {
  const { adminType, serviceLocationIds } = getAdminScope(admin);

  if (adminType === 'superadmin') {
    return {};
  }

  if (serviceLocationIds.length === 0) {
    return buildNoAccessQuery(field);
  }

  return { [field]: { $in: serviceLocationIds } };
};

const buildZoneScopeQuery = async (admin = {}, field = 'zone_id') => {
  const { adminType } = getAdminScope(admin);

  if (adminType === 'superadmin') {
    return {};
  }

  const scopedZoneIds = await getScopedZoneIds(admin);

  if (scopedZoneIds.length === 0) {
    return buildNoAccessQuery(field);
  }

  return { [field]: { $in: scopedZoneIds } };
};

const assertAdminPermission = (admin, permission, label = 'resource') => {
  if (!hasAdminPermission(admin, permission)) {
    throw new ApiError(403, `You do not have permission to access ${label}`);
  }
};

const assertServiceLocationAccess = (admin = {}, serviceLocationId) => {
  if (isSuperAdmin(admin)) {
    return;
  }

  const normalizedId = String(serviceLocationId || '').trim();
  const { serviceLocationIds } = getAdminScope(admin);

  if (!normalizedId || !serviceLocationIds.some((item) => String(item) === normalizedId)) {
    throw new ApiError(403, 'Service location is outside your assigned scope');
  }
};

const assertZoneAccess = async (admin = {}, zoneId) => {
  if (isSuperAdmin(admin)) {
    return;
  }

  const normalizedId = String(zoneId || '').trim();
  if (!normalizedId) {
    throw new ApiError(403, 'Zone is outside your assigned scope');
  }

  const { zoneIds, serviceLocationIds } = getAdminScope(admin);

  if (zoneIds.length > 0) {
    if (!zoneIds.some((item) => String(item) === normalizedId)) {
      throw new ApiError(403, 'Zone is outside your assigned scope');
    }
    return;
  }

  const zone = await Zone.findById(normalizedId).select('service_location_id').lean();
  if (!zone || !serviceLocationIds.some((item) => String(item) === String(zone.service_location_id || ''))) {
    throw new ApiError(403, 'Zone is outside your assigned scope');
  }
};

const serializeAdminSummary = (admin, serviceLocationMap = new Map(), zoneMap = new Map()) => {
  const serviceLocationIds = normalizeObjectIdList(admin.service_location_ids).map(String);
  const zoneIds = normalizeObjectIdList(admin.zone_ids).map(String);

  return {
    _id: admin._id,
    id: admin._id,
    name: admin.name || '',
    email: admin.email || '',
    phone: admin.phone || '',
    role: admin.role || '',
    admin_type: normalizeAdminType(admin.admin_type || admin.role),
    permissions: normalizeAdminPermissions(admin.permissions || []),
    service_location_ids: serviceLocationIds,
    zone_ids: zoneIds,
    service_locations: serviceLocationIds
      .map((id) => serviceLocationMap.get(id))
      .filter(Boolean)
      .map((item) => ({
        id: String(item._id || item.id || ''),
        name: item.service_location_name || item.name || '',
        country: item.country || '',
      })),
    zones: zoneIds
      .map((id) => zoneMap.get(id))
      .filter(Boolean)
      .map((item) => ({
        id: String(item._id || item.id || ''),
        name: item.name || '',
        service_location_id: String(item.service_location_id || ''),
      })),
    active: admin.active !== false,
    status: admin.status || (admin.active === false ? 'inactive' : 'active'),
    createdAt: admin.createdAt || null,
    updatedAt: admin.updatedAt || null,
  };
};

const enrichAdminSummaries = async (admins = []) => {
  const serviceLocationIds = [
    ...new Set(
      admins.flatMap((admin) => normalizeObjectIdList(admin.service_location_ids).map(String)),
    ),
  ];
  const zoneIds = [
    ...new Set(
      admins.flatMap((admin) => normalizeObjectIdList(admin.zone_ids).map(String)),
    ),
  ];

  const [serviceLocations, zones] = await Promise.all([
    serviceLocationIds.length > 0
      ? ServiceLocation.find({ _id: { $in: serviceLocationIds } })
        .select('_id name service_location_name country')
        .lean()
      : [],
    zoneIds.length > 0
      ? Zone.find({ _id: { $in: zoneIds } })
        .select('_id name service_location_id')
        .lean()
      : [],
  ]);

  const serviceLocationMap = new Map(serviceLocations.map((item) => [String(item._id), item]));
  const zoneMap = new Map(zones.map((item) => [String(item._id), item]));

  return admins.map((admin) => serializeAdminSummary(admin, serviceLocationMap, zoneMap));
};

const normalizeDriverAccountType = (value) => {
  const normalized = String(value || 'individual').trim().toLowerCase();

  if (normalized === 'fleet drivers' || normalized === 'fleet_drivers' || normalized === 'fleetdrivers') {
    return 'fleet_drivers';
  }

  if (normalized === 'both') {
    return 'both';
  }

  return 'individual';
};

const normalizeDriverTemplateType = (value) => {
  const normalized = String(value || 'document').trim().toLowerCase();
  return normalized === 'vehicle_field' ? 'vehicle_field' : 'document';
};

const normalizeDriverVehicleFieldType = (value) => {
  const normalized = String(value || 'text').trim().toLowerCase();
  return ['text', 'number', 'textarea', 'select', 'multi_select', 'location_select', 'vehicle_type_select'].includes(normalized)
    ? normalized
    : 'text';
};

const DRIVER_VEHICLE_FIELD_DEFINITIONS = {
  locationId: { label: 'Operating City', field_type: 'location_select', field_group: 'common', account_type: 'both', sort_order: 10 },
  serviceCategories: { label: 'Service Category', field_type: 'multi_select', field_group: 'driver', account_type: 'individual', sort_order: 20, options: ['taxi', 'outstation', 'delivery'] },
  vehicleTypeId: { label: 'Vehicle Type', field_type: 'vehicle_type_select', field_group: 'driver', account_type: 'individual', sort_order: 30 },
  make: { label: 'Brand / Make', field_type: 'text', field_group: 'driver', account_type: 'individual', sort_order: 40, placeholder: 'e.g. Maruti Suzuki' },
  model: { label: 'Model', field_type: 'text', field_group: 'driver', account_type: 'individual', sort_order: 50, placeholder: 'Swift, Bolt' },
  year: { label: 'Year', field_type: 'number', field_group: 'driver', account_type: 'individual', sort_order: 60, placeholder: String(new Date().getFullYear()) },
  number: { label: 'Plate Number', field_type: 'text', field_group: 'driver', account_type: 'individual', sort_order: 70, placeholder: 'DL1RT1234' },
  color: { label: 'Exterior Color', field_type: 'text', field_group: 'driver', account_type: 'individual', sort_order: 80, placeholder: 'e.g. White, Black' },
};

const slugify = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `document-${Date.now()}`;

const buildDefaultDriverVehicleFieldConfigs = () =>
  Object.entries(DRIVER_VEHICLE_FIELD_DEFINITIONS).map(([field_key, meta]) => ({
    template_type: 'vehicle_field',
    field_key,
    name: meta.label,
    slug: `vehicle-field-${slugify(field_key)}`,
    account_type: meta.account_type || 'individual',
    field_type: meta.field_type || 'text',
    field_group: meta.field_group || '',
    placeholder: meta.placeholder || '',
    help_text: '',
    sort_order: Number(meta.sort_order || 0) / 10 || 0,
    options: Array.isArray(meta.options) ? meta.options : [],
    is_editable: true,
    is_required: true,
    active: true,
  }));

const toDocumentKey = (value = '') => {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim();

  if (!normalized) {
    return `document${Date.now()}`;
  }

  return normalized
    .split(/\s+/)
    .map((part, index) =>
      index === 0
        ? part.toLowerCase()
        : `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`,
    )
    .join('');
};

const normalizeVehicleTransportType = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'delivery') return 'delivery';
  if (normalized === 'both' || normalized === 'all') return 'both';
  return 'taxi';
};

const normalizeDriverRegisterFor = (value = '', fallback = 'taxi') => {
  const normalized = String(value || fallback || 'taxi').trim().toLowerCase();
  if (normalized === 'all') return 'both';
  if (normalized === 'both') return 'both';
  if (normalized === 'delivery') return 'delivery';
  if (normalized === 'outstation') return 'outstation';
  if (normalized === 'bike') return 'bike';
  if (normalized === 'auto') return 'auto';
  if (normalized === 'car') return 'car';
  return 'taxi';
};

const normalizeDriverServiceCategories = (value, fallback = 'taxi') => {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  const normalized = [...new Set(
    rawValues
      .map((item) => String(item || '').trim().toLowerCase())
      .flatMap((item) => item === 'both' ? ['taxi', 'outstation'] : item ? [item] : [])
      .filter((item) => ['taxi', 'outstation', 'delivery'].includes(item)),
  )];

  if (normalized.length > 0) {
    return normalized;
  }

  const registerFor = normalizeDriverRegisterFor(fallback);
  if (registerFor === 'both') {
    return ['taxi', 'outstation'];
  }

  return ['taxi', 'outstation', 'delivery'].includes(registerFor)
    ? [registerFor]
    : ['taxi'];
};

const normalizeDeliveryCategory = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'trucks') return 'trucks';
  if (normalized === '2wheeler' || normalized === '2_wheeler' || normalized === 'two_wheeler') return '2wheeler';
  if (normalized === 'movers' || normalized === 'packers_movers' || normalized === 'packers-and-movers') return 'movers';
  return '';
};

const normalizeDeliveryDistancePricing = (value = {}, fallback = {}) => {
  const source = value && typeof value === 'object' ? value : {};
  const defaults = fallback && typeof fallback === 'object' ? fallback : {};

  return {
    enabled: Boolean(source.enabled ?? defaults.enabled ?? false),
    base_price: Number(source.base_price ?? defaults.base_price ?? 0),
    free_distance: Number(source.free_distance ?? defaults.free_distance ?? 0),
    distance_price: Number(source.distance_price ?? defaults.distance_price ?? 0),
    free_time: Number(source.free_time ?? defaults.free_time ?? 0),
    time_price: Number(source.time_price ?? defaults.time_price ?? 0),
  };
};

// Seat-layout helpers shared with the rental vehicle blueprints.
const sanitizeBusText = (value = '', fallback = '') =>
  String(value ?? fallback).trim();

const sanitizeBusSeatPrice = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeBusSeatCell = (cell = {}) => {
  if (cell?.kind !== 'seat') {
    return {
      kind: 'aisle',
      id: '',
      label: '',
      variant: 'seat',
      status: 'available',
    };
  }

  return {
    kind: 'seat',
    id: sanitizeBusText(cell.id),
    label: sanitizeBusText(cell.label),
    variant: sanitizeBusText(cell.variant, 'seat') || 'seat',
    status: cell.status === 'blocked' ? 'blocked' : 'available',
  };
};

const normalizeBusDeck = (deckRows = []) =>
  Array.isArray(deckRows)
    ? deckRows.map((row) =>
      Array.isArray(row) ? row.map((cell) => normalizeBusSeatCell(cell)) : [],
    )
    : [];

const countSeatsInBlueprintDeck = (deckRows = []) =>
  normalizeBusDeck(deckRows).flat().filter((cell) => cell.kind === 'seat').length;

const createRentalSeatCell = (rowNumber, seatCode, variant = 'seat') => ({
  kind: 'seat',
  id: `R${rowNumber}${seatCode}`,
  label: `${rowNumber}${seatCode}`,
  variant,
  status: 'available',
});

const createRentalAisleCell = () => ({
  kind: 'aisle',
  id: '',
  label: '',
  variant: 'seat',
  status: 'available',
});

const createRentalRowFromPattern = (rowNumber, pattern = []) =>
  pattern.map((cell) => {
    if (!cell || cell === 'aisle') {
      return createRentalAisleCell();
    }

    if (typeof cell === 'string') {
      return createRentalSeatCell(rowNumber, cell, 'seat');
    }

    return createRentalSeatCell(rowNumber, cell.code, cell.variant || 'seat');
  });

const buildRentalBlueprintTemplate = (templateKey = 'compact_4') => {
  switch (templateKey) {
    case 'bike_1':
      return {
        templateKey,
        lowerDeck: [createRentalRowFromPattern(1, ['A'])],
        upperDeck: [],
      };
    case 'auto_3':
      return {
        templateKey,
        lowerDeck: [
          createRentalRowFromPattern(1, ['A']),
          createRentalRowFromPattern(2, ['B', 'aisle', 'C']),
        ],
        upperDeck: [],
      };
    case 'suv_6':
      return {
        templateKey,
        lowerDeck: [
          createRentalRowFromPattern(1, ['A', 'aisle', 'B']),
          createRentalRowFromPattern(2, ['C', 'aisle', 'D']),
          createRentalRowFromPattern(3, ['E', 'aisle', 'F']),
        ],
        upperDeck: [],
      };
    case 'suv_7':
      return {
        templateKey,
        lowerDeck: [
          createRentalRowFromPattern(1, ['A', 'aisle', 'B']),
          createRentalRowFromPattern(2, ['C', 'D', 'E']),
          createRentalRowFromPattern(3, ['F', 'aisle', 'G']),
        ],
        upperDeck: [],
      };
    case 'van_8':
      return {
        templateKey,
        lowerDeck: [
          createRentalRowFromPattern(1, ['A', 'aisle', 'B']),
          createRentalRowFromPattern(2, ['C', 'D', 'E']),
          createRentalRowFromPattern(3, ['F', 'G', 'H']),
        ],
        upperDeck: [],
      };
    case 'compact_4':
    default:
      return {
        templateKey: 'compact_4',
        lowerDeck: [
          createRentalRowFromPattern(1, ['A', 'aisle', 'B']),
          createRentalRowFromPattern(2, ['C', 'aisle', 'D']),
        ],
        upperDeck: [],
      };
  }
};

const DEFAULT_RENTAL_PRICING = [
  { id: 'pkg-6h', label: '6 Hours', durationHours: 6, price: 799, includedKm: 60, extraHourPrice: 120, extraKmPrice: 12, active: true },
  { id: 'pkg-12h', label: '12 Hours', durationHours: 12, price: 1299, includedKm: 120, extraHourPrice: 110, extraKmPrice: 11, active: true },
  { id: 'pkg-24h', label: '24 Hours', durationHours: 24, price: 1999, includedKm: 240, extraHourPrice: 95, extraKmPrice: 10, active: true },
];

const normalizeRentalPricingItem = (item = {}, index = 0) => ({
  id: sanitizeBusText(item.id, `pkg-${index + 1}`),
  label: sanitizeBusText(item.label, `${Number(item.durationHours || 0) || index + 1} Hours`),
  durationHours: Math.max(1, sanitizeBusSeatPrice(item.durationHours, index + 1)),
  price: Math.max(0, sanitizeBusSeatPrice(item.price, 0)),
  includedKm: Math.max(0, sanitizeBusSeatPrice(item.includedKm, 0)),
  extraHourPrice: Math.max(0, sanitizeBusSeatPrice(item.extraHourPrice, 0)),
  extraKmPrice: Math.max(0, sanitizeBusSeatPrice(item.extraKmPrice, 0)),
  active: item.active === undefined ? true : normalizeBoolean(item.active),
});

const normalizeRentalAdvancePayment = (value = {}, existing = {}) => {
  const paymentMode = ['full', 'percentage', 'fixed'].includes(value?.paymentMode)
    ? value.paymentMode
    : ['full', 'percentage', 'fixed'].includes(existing?.paymentMode)
      ? existing.paymentMode
      : 'percentage';

  return {
    enabled: normalizeBoolean(value?.enabled ?? existing?.enabled ?? false),
    paymentMode,
    amount: Math.max(
      0,
      sanitizeBusSeatPrice(
        value?.amount,
        existing?.amount ?? (paymentMode === 'full' ? 100 : 20),
      ),
    ),
    label: sanitizeBusText(
      value?.label,
      existing?.label || 'Advance booking payment',
    ),
    notes: sanitizeBusText(value?.notes, existing?.notes || ''),
  };
};

const normalizeRentalVehiclePayload = (payload = {}, existing = {}) => {
  const fallbackBlueprint = existing.blueprint?.lowerDeck?.length
    ? {
      templateKey: existing.blueprint?.templateKey || 'compact_4',
      lowerDeck: normalizeBusDeck(existing.blueprint?.lowerDeck || []),
      upperDeck: normalizeBusDeck(existing.blueprint?.upperDeck || []),
    }
    : buildRentalBlueprintTemplate(payload.blueprint?.templateKey || existing.blueprint?.templateKey || 'compact_4');

  const blueprint = payload.blueprint
    ? {
      templateKey: sanitizeBusText(payload.blueprint?.templateKey, fallbackBlueprint.templateKey || 'compact_4'),
      lowerDeck: normalizeBusDeck(payload.blueprint?.lowerDeck ?? fallbackBlueprint.lowerDeck ?? []),
      upperDeck: normalizeBusDeck(payload.blueprint?.upperDeck ?? fallbackBlueprint.upperDeck ?? []),
    }
    : fallbackBlueprint;

  const capacityFromBlueprint =
    countSeatsInBlueprintDeck(blueprint.lowerDeck) + countSeatsInBlueprintDeck(blueprint.upperDeck);

  return {
    transport_type: sanitizeBusText(payload.transport_type, existing.transport_type || 'rental') || 'rental',
    name: sanitizeBusText(payload.name, existing.name || ''),
    short_description: sanitizeBusText(payload.short_description, existing.short_description || ''),
    description: sanitizeBusText(payload.description, existing.description || ''),
    vehicleCategory: sanitizeBusText(payload.vehicleCategory, existing.vehicleCategory || 'Car'),
    image: sanitizeBusText(payload.image, existing.image || ''),
    coverImage: sanitizeBusText(
      payload.coverImage,
      payload.image || existing.coverImage || existing.image || '',
    ),
    galleryImages: Array.isArray(payload.galleryImages)
      ? payload.galleryImages.map((item) => sanitizeBusText(item)).filter(Boolean)
      : Array.isArray(existing.galleryImages)
        ? existing.galleryImages.map((item) => sanitizeBusText(item)).filter(Boolean)
        : [],
    map_icon: sanitizeBusText(payload.map_icon, existing.map_icon || ''),
    capacity:
      payload.capacity !== undefined
        ? Math.max(1, sanitizeBusSeatPrice(payload.capacity, capacityFromBlueprint || 1))
        : Math.max(1, capacityFromBlueprint || sanitizeBusSeatPrice(existing.capacity, 4)),
    luggageCapacity: Math.max(0, sanitizeBusSeatPrice(payload.luggageCapacity, existing.luggageCapacity || 0)),
    amenities: Array.isArray(payload.amenities)
      ? payload.amenities.map((item) => sanitizeBusText(item)).filter(Boolean)
      : Array.isArray(existing.amenities)
        ? existing.amenities
        : [],
    serviceStoreIds: Array.isArray(payload.serviceStoreIds)
      ? payload.serviceStoreIds.map((item) => String(item || '').trim()).filter(Boolean)
      : Array.isArray(existing.serviceStoreIds)
        ? existing.serviceStoreIds.map((item) => String(item || '').trim()).filter(Boolean)
        : [],
    blueprint,
    pricing: Array.isArray(payload.pricing) && payload.pricing.length
      ? payload.pricing.map((item, index) => normalizeRentalPricingItem(item, index))
      : Array.isArray(existing.pricing) && existing.pricing.length
        ? existing.pricing.map((item, index) => normalizeRentalPricingItem(item, index))
        : DEFAULT_RENTAL_PRICING.map((item, index) => normalizeRentalPricingItem(item, index)),
    advancePayment: normalizeRentalAdvancePayment(
      payload.advancePayment,
      existing.advancePayment,
    ),
    status: payload.status
      ? (payload.status === 'inactive' ? 'inactive' : 'active')
      : normalizeBoolean(payload.active ?? existing.active ?? true)
        ? 'active'
        : 'inactive',
    active: normalizeBoolean(payload.active ?? existing.active ?? true),
  };
};

const serializeRentalVehicleType = (item = {}) => ({
  id: String(item._id || item.id || ''),
  _id: item._id,
  transport_type: item.transport_type || 'rental',
  name: item.name || '',
  short_description: item.short_description || '',
  description: item.description || '',
  vehicleCategory: item.vehicleCategory || 'Car',
  image: item.image || '',
  coverImage: item.coverImage || item.image || '',
  galleryImages: Array.isArray(item.galleryImages) ? item.galleryImages.filter(Boolean) : [],
  map_icon: item.map_icon || '',
  capacity: Math.max(
    1,
    item.capacity ||
    countSeatsInBlueprintDeck(item.blueprint?.lowerDeck || []) +
    countSeatsInBlueprintDeck(item.blueprint?.upperDeck || []),
  ),
  luggageCapacity: sanitizeBusSeatPrice(item.luggageCapacity, 0),
  amenities: Array.isArray(item.amenities) ? item.amenities : [],
  serviceStoreIds: Array.isArray(item.serviceStoreIds)
    ? item.serviceStoreIds.map((storeId) => String(storeId))
    : [],
  advancePayment: normalizeRentalAdvancePayment(item.advancePayment),
  blueprint: {
    templateKey: item.blueprint?.templateKey || 'compact_4',
    lowerDeck: normalizeBusDeck(item.blueprint?.lowerDeck || []),
    upperDeck: normalizeBusDeck(item.blueprint?.upperDeck || []),
  },
  pricing: Array.isArray(item.pricing)
    ? item.pricing.map((price, index) => normalizeRentalPricingItem(price, index))
    : DEFAULT_RENTAL_PRICING.map((price, index) => normalizeRentalPricingItem(price, index)),
  status: item.status || 'active',
  active: item.active !== false && item.status !== 'inactive',
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});


const serializeRentalQuoteRequest = (item = {}) => ({
  id: String(item._id || item.id || ''),
  _id: item._id,
  userId: item.userId
    ? {
      id: String(item.userId?._id || item.userId),
      name: item.userId?.name || '',
      phone: item.userId?.phone || '',
      email: item.userId?.email || '',
    }
    : null,
  vehicleTypeId: item.vehicleTypeId
    ? {
      id: String(item.vehicleTypeId?._id || item.vehicleTypeId),
      name: item.vehicleTypeId?.name || item.vehicleName || '',
      vehicleCategory: item.vehicleTypeId?.vehicleCategory || item.vehicleCategory || '',
      image: item.vehicleTypeId?.image || '',
    }
    : null,
  vehicleName: item.vehicleName || item.vehicleTypeId?.name || '',
  vehicleCategory: item.vehicleCategory || item.vehicleTypeId?.vehicleCategory || '',
  contactName: item.contactName || '',
  contactPhone: item.contactPhone || '',
  contactEmail: item.contactEmail || '',
  requestedHours: Number(item.requestedHours || 0),
  pickupDateTime: item.pickupDateTime || null,
  returnDateTime: item.returnDateTime || null,
  seatsNeeded: Number(item.seatsNeeded || 1),
  luggageNeeded: Number(item.luggageNeeded || 0),
  pickupLocation: item.pickupLocation || '',
  dropLocation: item.dropLocation || '',
  specialRequirements: item.specialRequirements || '',
  status: item.status || 'pending',
  adminQuotedAmount: Number(item.adminQuotedAmount || 0),
  adminNote: item.adminNote || '',
  reviewedAt: item.reviewedAt || null,
  createdAt: item.createdAt || null,
  updatedAt: item.updatedAt || null,
  rentalTracking: buildRentalTrackingSnapshot(item),
});

const serializeRentalBookingRequest = (item = {}) => ({
  id: String(item._id || item.id || ''),
  _id: item._id,
  bookingReference: item.bookingReference || '',
  userId: item.userId
    ? {
      id: String(item.userId?._id || item.userId),
      name: item.userId?.name || item.contactName || '',
      phone: item.userId?.phone || item.contactPhone || '',
      email: item.userId?.email || item.contactEmail || '',
    }
    : null,
  vehicleTypeId: item.vehicleTypeId
    ? {
      id: String(item.vehicleTypeId?._id || item.vehicleTypeId),
      name: item.vehicleTypeId?.name || item.vehicleName || '',
      vehicleCategory: item.vehicleTypeId?.vehicleCategory || item.vehicleCategory || '',
      image: item.vehicleTypeId?.image || item.vehicleImage || '',
    }
    : null,
  vehicleName: item.vehicleName || item.vehicleTypeId?.name || '',
  vehicleCategory: item.vehicleCategory || item.vehicleTypeId?.vehicleCategory || '',
  vehicleImage: item.vehicleImage || item.vehicleTypeId?.image || '',
  selectedPackage: {
    packageId: item.selectedPackage?.packageId || '',
    label: item.selectedPackage?.label || '',
    durationHours: Number(item.selectedPackage?.durationHours || 0),
    price: Number(item.selectedPackage?.price || 0),
    extraHourPrice: Number(item.selectedPackage?.extraHourPrice || 0),
  },
  serviceLocation: {
    locationId: item.serviceLocation?.locationId || '',
    name: item.serviceLocation?.name || '',
    address: item.serviceLocation?.address || '',
    city: item.serviceLocation?.city || '',
    latitude: item.serviceLocation?.latitude ?? null,
    longitude: item.serviceLocation?.longitude ?? null,
    distanceKm: item.serviceLocation?.distanceKm ?? null,
  },
  pickupDateTime: item.pickupDateTime || null,
  returnDateTime: item.returnDateTime || null,
  requestedHours: Number(item.requestedHours || 0),
  totalCost: Number(item.totalCost || 0),
  payableNow: Number(item.payableNow || 0),
  advancePaymentLabel: item.advancePaymentLabel || '',
  paymentStatus: item.paymentStatus || 'pending',
  paymentMethod: item.paymentMethod || '',
  paymentMethodLabel: item.paymentMethodLabel || '',
  payment: {
    provider: item.payment?.provider || '',
    status: item.payment?.status || '',
    amount: Number(item.payment?.amount || 0),
    currency: item.payment?.currency || 'INR',
    orderId: item.payment?.orderId || '',
    paymentId: item.payment?.paymentId || '',
    signature: item.payment?.signature || '',
  },
  contactName: item.contactName || '',
  contactPhone: item.contactPhone || '',
  contactEmail: item.contactEmail || '',
  kycCompleted: Boolean(item.kycCompleted),
  assignedVehicle: {
    vehicleId: item.assignedVehicle?.vehicleId ? String(item.assignedVehicle.vehicleId) : '',
    name: item.assignedVehicle?.name || '',
    vehicleCategory: item.assignedVehicle?.vehicleCategory || '',
    image: item.assignedVehicle?.image || '',
  },
  serviceCenterIds: Array.isArray(item.serviceCenterIds)
    ? item.serviceCenterIds.map((centerId) => String(centerId))
    : [],
  commissionSnapshot: {
    serviceStoreId: item.commissionSnapshot?.serviceStoreId
      ? String(item.commissionSnapshot.serviceStoreId)
      : '',
    serviceStoreName: item.commissionSnapshot?.serviceStoreName || '',
    ownerName: item.commissionSnapshot?.ownerName || '',
    serviceStoreCommissionType:
      item.commissionSnapshot?.serviceStoreCommissionType === 'fixed' ? 'fixed' : 'percentage',
    serviceStoreCommissionValue: Number(item.commissionSnapshot?.serviceStoreCommissionValue || 0),
    ownerCommissionType:
      item.commissionSnapshot?.ownerCommissionType === 'fixed' ? 'fixed' : 'percentage',
    ownerCommissionValue: Number(item.commissionSnapshot?.ownerCommissionValue || 0),
    serviceTaxPercentage: Math.max(0, Number(item.commissionSnapshot?.serviceTaxPercentage || 0)),
  },
  assignedStaff: {
    id: item.assignedStaffId ? String(item.assignedStaffId) : '',
    name: item.assignedStaffName || '',
    phone: item.assignedStaffPhone || '',
  },
  serviceCenterNote: item.serviceCenterNote || '',
  status: item.status || 'pending',
  assignedAt: item.assignedAt || null,
  completionRequestedAt: item.completionRequestedAt || null,
  completedAt: item.completedAt || null,
  finalCharge: Number(item.finalCharge || 0),
  finalElapsedMinutes: Number(item.finalElapsedMinutes || 0),
  cancelledAt: item.cancelledAt || null,
  cancelReason: item.cancelReason || '',
  adminNote: item.adminNote || '',
  reviewedAt: item.reviewedAt || null,
  createdAt: item.createdAt || null,
  updatedAt: item.updatedAt || null,
});

const normalizeRentalCommissionRule = (rule = {}, fallbackType = 'percentage') => ({
  type: rule?.type === 'fixed' ? 'fixed' : fallbackType,
  value: Math.max(0, Number(rule?.value || 0)),
});

const computeRentalCommissionBreakdown = (snapshot = {}, grossAmount = 0) => {
  const baseAmount = Math.max(0, Number(grossAmount || 0));
  const serviceStoreRule = normalizeRentalCommissionRule(
    {
      type: snapshot?.serviceStoreCommissionType,
      value: snapshot?.serviceStoreCommissionValue,
    },
    'percentage',
  );
  const ownerRule = normalizeRentalCommissionRule(
    {
      type: snapshot?.ownerCommissionType,
      value: snapshot?.ownerCommissionValue,
    },
    'percentage',
  );

  const calculateAmount = (amount, rule) => {
    if (rule.type === 'fixed') {
      return Math.min(amount, Math.max(0, Number(rule.value || 0)));
    }

    return Math.min(amount, Math.max(0, (amount * Number(rule.value || 0)) / 100));
  };

  const serviceStoreAmountRaw = calculateAmount(baseAmount, serviceStoreRule);
  const remainingAfterStore = Math.max(0, baseAmount - serviceStoreAmountRaw);
  const ownerAmountRaw = calculateAmount(remainingAfterStore, ownerRule);
  const adminAmountRaw = Math.max(0, baseAmount - serviceStoreAmountRaw - ownerAmountRaw);
  const serviceTaxPercentage = Math.max(0, Number(snapshot?.serviceTaxPercentage || 0));
  const serviceTaxAmountRaw = (baseAmount * serviceTaxPercentage) / 100;
  const round = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

  return {
    grossAmount: round(baseAmount),
    grossAmountWithTax: round(baseAmount + serviceTaxAmountRaw),
    serviceTax: {
      percentage: round(serviceTaxPercentage),
      amount: round(serviceTaxAmountRaw),
    },
    serviceStore: {
      id: snapshot?.serviceStoreId ? String(snapshot.serviceStoreId) : '',
      name: snapshot?.serviceStoreName || '',
      type: serviceStoreRule.type,
      value: round(serviceStoreRule.value),
      amount: round(serviceStoreAmountRaw),
    },
    owner: {
      name: snapshot?.ownerName || '',
      type: ownerRule.type,
      value: round(ownerRule.value),
      amount: round(ownerAmountRaw),
    },
    admin: {
      amount: round(adminAmountRaw),
    },
  };
};




const normalizeDeliveryServiceTax = (value, fallback = 0) =>
  Math.max(0, Number(value ?? fallback ?? 0));

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_USER_GENDERS = new Set(['male', 'female', 'other', 'prefer-not-to-say']);


const findById = (items, id) => items.find((item) => String(item._id) === String(id));

const removeById = (items, id) => items.filter((item) => String(item._id) !== String(id));

const moveItemById = (items, id) => {
  const index = items.findIndex((item) => String(item._id) === String(id));

  if (index === -1) {
    return { item: null, rest: items };
  }

  return {
    item: items[index],
    rest: [...items.slice(0, index), ...items.slice(index + 1)],
  };
};

const toNullableNumber = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveRentalSelectedPackagePricing = (item = {}) => {
  const selectedPackage = item.selectedPackage || {};
  const normalizedPackageId = String(selectedPackage.packageId || '').trim();
  const vehiclePricing = Array.isArray(item.vehicleTypeId?.pricing) ? item.vehicleTypeId.pricing : [];
  const matchedPackage = vehiclePricing.find((entry) => String(entry?.id || entry?.packageId || '').trim() === normalizedPackageId);

  const includedHours = Math.max(
    Number(selectedPackage.durationHours || 0),
    Number(matchedPackage?.durationHours || 0),
    1,
  );
  const basePrice = Math.max(
    Number(selectedPackage.price || 0),
    Number(matchedPackage?.price || 0),
    0,
  );
  const extraHourPrice = Math.max(
    Number(selectedPackage.extraHourPrice || 0),
    Number(matchedPackage?.extraHourPrice || 0),
    0,
  );

  return {
    includedHours,
    basePrice,
    extraHourPrice,
  };
};

const computeRentalRideMetrics = (item = {}, endedAt = null) => {
  const startDate = item.assignedAt || item.pickupDateTime || item.createdAt;
  const startMs = startDate ? new Date(startDate).getTime() : NaN;
  const endMs = endedAt ? new Date(endedAt).getTime() : Date.now();
  const { includedHours, basePrice, extraHourPrice } = resolveRentalSelectedPackagePricing(item);
  const hourlyRate = includedHours > 0 ? basePrice / includedHours : 0;

  if (!Number.isFinite(startMs)) {
    return {
      hourlyRate: Math.max(0, hourlyRate),
      includedHours,
      basePrice,
      extraHourRate: extraHourPrice,
      elapsedMinutes: 0,
      elapsedHours: 0,
      currentCharge: Math.max(basePrice, Number(item.payableNow || 0)),
      remainingDue: Math.max(0, Math.max(basePrice, Number(item.payableNow || 0)) - Number(item.payableNow || 0)),
    };
  }

  const elapsedMs = Math.max(0, endMs - startMs);
  const elapsedMinutes = Math.max(0, Math.ceil(elapsedMs / 60000));
  const elapsedHours = elapsedMs / 3600000;
  const elapsedChargeWithinPackage = elapsedHours <= includedHours
    ? basePrice
    : basePrice + Math.ceil(Math.max(0, elapsedHours - includedHours)) * extraHourPrice;
  const uncappedCharge = Math.max(Number(item.payableNow || 0), elapsedChargeWithinPackage);
  const currentCharge = Math.round((uncappedCharge + Number.EPSILON) * 100) / 100;
  const remainingDue = Math.max(
    0,
    Math.round((currentCharge - Number(item.payableNow || 0) + Number.EPSILON) * 100) / 100,
  );

  return {
    hourlyRate: Math.max(0, Math.round((hourlyRate + Number.EPSILON) * 100) / 100),
    includedHours,
    basePrice: Math.round((basePrice + Number.EPSILON) * 100) / 100,
    extraHourRate: Math.round((extraHourPrice + Number.EPSILON) * 100) / 100,
    elapsedMinutes,
    elapsedHours: Math.round((elapsedHours + Number.EPSILON) * 100) / 100,
    currentCharge,
    remainingDue,
  };
};

const normalizeZoneCoordinates = (coordinates = []) => {
  if (!Array.isArray(coordinates) || coordinates.length < 3) {
    throw new ApiError(400, 'Zone polygon requires at least 3 points');
  }

  const ring = coordinates
    .map((point) => {
      const lat = Number(point?.lat);
      const lng = Number(point?.lng);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new ApiError(400, 'Zone polygon contains invalid coordinates');
      }

      return [lng, lat];
    });

  const [firstLng, firstLat] = ring[0];
  const [lastLng, lastLat] = ring[ring.length - 1];

  if (firstLng !== lastLng || firstLat !== lastLat) {
    ring.push([firstLng, firstLat]);
  }

  return ring;
};

const normalizeZoneCircleCenter = (payload = {}) => {
  const lat = Number(payload?.lat);
  const lng = Number(payload?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new ApiError(400, 'Zone circle center contains invalid coordinates');
  }

  return { lat, lng };
};

const normalizeZoneCircleRadius = (radius) => {
  const parsed = Number(radius);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ApiError(400, 'Zone circle radius must be greater than 0');
  }

  return parsed;
};

const buildCirclePolygonRing = (center, radiusMeters, segments = 36) => {
  const earthRadiusMeters = 6378137;
  const latRadians = (Number(center.lat) * Math.PI) / 180;
  const lngRadians = (Number(center.lng) * Math.PI) / 180;
  const angularDistance = Number(radiusMeters) / earthRadiusMeters;
  const ring = [];

  for (let index = 0; index < segments; index += 1) {
    const bearing = (2 * Math.PI * index) / segments;
    const sinLat = Math.sin(latRadians);
    const cosLat = Math.cos(latRadians);
    const sinAngular = Math.sin(angularDistance);
    const cosAngular = Math.cos(angularDistance);
    const sinBearing = Math.sin(bearing);
    const cosBearing = Math.cos(bearing);

    const pointLat = Math.asin(
      sinLat * cosAngular + cosLat * sinAngular * cosBearing,
    );
    const pointLng =
      lngRadians +
      Math.atan2(
        sinBearing * sinAngular * cosLat,
        cosAngular - sinLat * Math.sin(pointLat),
      );

    ring.push([
      Number((((pointLng * 180) / Math.PI + 540) % 360) - 180),
      Number((pointLat * 180) / Math.PI),
    ]);
  }

  if (ring.length > 0) {
    ring.push([...ring[0]]);
  }

  return ring;
};

const normalizeZoneGeometryPayload = (payload = {}, existing = {}) => {
  const boundaryMode = String(
    payload.boundary_mode || existing.boundary_mode || 'polygon',
  ).toLowerCase() === 'circle'
    ? 'circle'
    : 'polygon';

  if (boundaryMode === 'circle') {
    const center = normalizeZoneCircleCenter(payload.circle_center || existing.circle_center || {});
    const radiusMeters = normalizeZoneCircleRadius(
      payload.circle_radius_meters ?? existing.circle_radius_meters,
    );

    return {
      boundary_mode: 'circle',
      circle_center: center,
      circle_radius_meters: radiusMeters,
      geometry: {
        type: 'Polygon',
        coordinates: [buildCirclePolygonRing(center, radiusMeters)],
      },
    };
  }

  return {
    boundary_mode: 'polygon',
    circle_center: {
      lat: null,
      lng: null,
    },
    circle_radius_meters: null,
    geometry: {
      type: 'Polygon',
      coordinates: [normalizeZoneCoordinates(payload.coordinates)],
    },
  };
};

const normalizeAirportBoundary = (coordinates = []) => normalizeZoneCoordinates(coordinates);

const normalizePointLocationPayload = (payload = {}, fallback = {}) => {
  const latitude = Number(payload.latitude ?? payload.lat ?? fallback.latitude);
  const longitude = Number(payload.longitude ?? payload.lng ?? fallback.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new ApiError(400, 'A valid store location pin is required');
  }

  return {
    latitude,
    longitude,
    location: {
      type: 'Point',
      coordinates: [longitude, latitude],
    },
  };
};

const serializeZone = (zone) => ({
  _id: zone._id,
  id: zone._id,
  name: zone.name || '',
  service_location_id: zone.service_location_id?._id || zone.service_location_id || '',
  unit: zone.unit || 'km',
  peak_zone_ride_count: zone.peak_zone_ride_count,
  peak_zone_radius: zone.peak_zone_radius,
  peak_zone_selection_duration: zone.peak_zone_selection_duration,
  peak_zone_duration: zone.peak_zone_duration,
  peak_zone_surge_percentage: zone.peak_zone_surge_percentage,
  maximum_distance_for_regular_rides: zone.maximum_distance_for_regular_rides,
  maximum_distance_for_outstation_rides: zone.maximum_distance_for_outstation_rides,
  active: zone.active !== false,
  status: zone.status || (zone.active === false ? 'inactive' : 'active'),
  boundary_mode: zone.boundary_mode || 'polygon',
  circle_center:
    Number.isFinite(Number(zone.circle_center?.lat)) && Number.isFinite(Number(zone.circle_center?.lng))
      ? {
        lat: Number(zone.circle_center.lat),
        lng: Number(zone.circle_center.lng),
      }
      : null,
  circle_radius_meters: Number.isFinite(Number(zone.circle_radius_meters))
    ? Number(zone.circle_radius_meters)
    : null,
  coordinates: Array.isArray(zone.geometry?.coordinates?.[0])
    ? zone.geometry.coordinates[0].map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }))
    : [],
  createdAt: zone.createdAt,
  updatedAt: zone.updatedAt,
});

const serializeServiceStore = (store) => ({
  _id: store._id,
  id: store._id,
  name: store.name || '',
  address: store.address || '',
  owner_name: store.owner_name || '',
  owner_phone: store.owner_phone || '',
  zone_id: store.zone_id
    ? {
      _id: store.zone_id._id || store.zone_id,
      name: store.zone_id.name || '',
      service_location_id:
        store.zone_id.service_location_id?._id || store.zone_id.service_location_id || '',
    }
    : null,
  service_location_id: store.service_location_id
    ? {
      _id: store.service_location_id._id || store.service_location_id,
      name: store.service_location_id.service_location_name || store.service_location_id.name || '',
      country: store.service_location_id.country || '',
    }
    : null,
  latitude:
    Number(store.latitude ?? store.location?.coordinates?.[1] ?? null),
  longitude:
    Number(store.longitude ?? store.location?.coordinates?.[0] ?? null),
  rentalCommission: {
    serviceStore: {
      type: store.rentalCommission?.serviceStore?.type === 'fixed' ? 'fixed' : 'percentage',
      value: Number(store.rentalCommission?.serviceStore?.value || 0),
    },
    owner: {
      type: store.rentalCommission?.owner?.type === 'fixed' ? 'fixed' : 'percentage',
      value: Number(store.rentalCommission?.owner?.value || 0),
    },
    serviceTaxPercentage: Math.max(0, Number(store.rentalCommission?.serviceTaxPercentage || 0)),
  },
  approve: store.approve !== false,
  rejectionReason: store.rejectionReason || '',
  signupSource: store.signupSource || 'admin',
  onboarding: store.onboarding || null,
  status: store.status || (store.active === false ? 'inactive' : 'active'),
  active: store.active !== false,
  staff: Array.isArray(store.staff)
    ? store.staff.map((member) => ({
      _id: member._id,
      id: member._id,
      name: member.name || '',
      phone: member.phone || '',
      active: member.active !== false,
      approve: member.approve !== false,
      rejectionReason: member.rejectionReason || '',
      signupSource: member.signupSource || 'admin',
      onboarding: member.onboarding || null,
      status: member.status || (member.active === false ? 'inactive' : 'active'),
      createdAt: member.createdAt || null,
      updatedAt: member.updatedAt || null,
    }))
    : [],
  createdAt: store.createdAt,
  updatedAt: store.updatedAt,
});

const normalizeServiceStoreRentalCommission = (value = {}, existing = {}) => ({
  serviceStore: {
    type: value?.serviceStore?.type === 'fixed'
      ? 'fixed'
      : existing?.serviceStore?.type === 'fixed'
        ? 'fixed'
        : 'percentage',
    value: Math.max(
      0,
      Number(
        value?.serviceStore?.value ??
        existing?.serviceStore?.value ??
        0,
      ),
    ),
  },
  owner: {
    type: value?.owner?.type === 'fixed'
      ? 'fixed'
      : existing?.owner?.type === 'fixed'
        ? 'fixed'
        : 'percentage',
    value: Math.max(
      0,
      Number(
        value?.owner?.value ??
        existing?.owner?.value ??
        0,
      ),
    ),
  },
  serviceTaxPercentage: Math.max(
    0,
    Number(
      value?.serviceTaxPercentage ??
      existing?.serviceTaxPercentage ??
      0,
    ),
  ),
});

/** The vehicle type id of a serialized set-price row, whatever its shape. */
const setPriceVehicleId = (row) => {
  const value = row?.type_id || row?.vehicle_type;
  return value?._id || value || null;
};

const serializeSetPrice = (item) => ({
  _id: item._id,
  id: item._id,
  zone_id: item.zone_id
    ? {
      _id: item.zone_id._id || item.zone_id,
      name: item.zone_id.name || '',
    }
    : null,
  service_location_id: item.service_location_id
    ? {
      _id: item.service_location_id._id || item.service_location_id,
      name: item.service_location_id.service_location_name || item.service_location_id.name || '',
    }
    : null,
  transport_type: item.transport_type || '',
  vehicle_type: item.vehicle_type
    ? {
      _id: item.vehicle_type._id || item.vehicle_type,
      name: item.vehicle_type.name || '',
      icon: item.vehicle_type.icon || '',
    }
    : null,
  vehicle_name: item.vehicle_type?.name || '',
  icon: item.vehicle_type?.icon || item.icon || '',
  app_modules: item.app_modules ?? '',
  vehicle_preference: item.vehicle_preference ?? '',
  payment_type: Array.isArray(item.payment_type) ? item.payment_type : (typeof item.payment_type === 'string' ? item.payment_type.split(',') : []),

  // Commissions
  customer_commission_type: item.customer_commission_type || 'percentage',
  customer_commission: item.customer_commission,
  admin_commision_type: item.admin_commision_type ?? (item.customer_commission_type === 'percentage' ? 1 : 0),
  admin_commision: item.admin_commision ?? item.customer_commission,

  driver_commission_type: item.driver_commission_type || 'percentage',
  driver_commission: item.driver_commission,
  admin_commission_type_from_driver: item.admin_commission_type_from_driver ?? (item.driver_commission_type === 'percentage' ? 1 : 0),
  admin_commission_from_driver: item.admin_commission_from_driver ?? item.driver_commission,


  service_tax: item.service_tax,
  eta_sequence: item.eta_sequence,
  order_number: item.order_number ?? item.eta_sequence ?? 1,

  // Core Pricing
  base_price: item.base_price,
  base_distance: item.base_distance,
  price_per_distance: item.price_per_distance,
  time_price: item.time_price,
  waiting_charge: item.waiting_charge,
  outstation_base_price: item.outstation_base_price ?? 0,
  outstation_base_distance: item.outstation_base_distance ?? 0,
  outstation_price_per_distance: item.outstation_price_per_distance ?? 0,
  outstation_time_price: item.outstation_time_price ?? 0,
  outstation_round_trip_price_per_distance: item.outstation_round_trip_price_per_distance ?? 0,
  outstation_min_km_per_day: item.outstation_min_km_per_day ?? 0,
  outstation_driver_allowance_per_day: item.outstation_driver_allowance_per_day ?? 0,
  free_waiting_before: item.free_waiting_before,
  free_waiting_after: item.free_waiting_after,

  // Settings
  enable_airport_ride: Boolean(item.enable_airport_ride),
  enable_outstation_ride: Boolean(item.enable_outstation_ride),
  support_airport_fee: item.support_airport_fee ?? (item.enable_airport_ride ? 1 : 0),
  support_outstation: item.support_outstation ?? (item.enable_outstation_ride ? 1 : 0),

  // Cancellation
  user_cancellation_fee_type: item.user_cancellation_fee_type || 'percentage',
  user_cancellation_fee: item.user_cancellation_fee,
  driver_cancellation_fee_type: item.driver_cancellation_fee_type || 'percentage',
  driver_cancellation_fee: item.driver_cancellation_fee,
  cancellation_fee_goes_to: item.cancellation_fee_goes_to || 'admin',

  // Ride Sharing
  enable_ride_sharing: Boolean(item.enable_ride_sharing),
  enable_shared_ride: item.enable_shared_ride ?? (item.enable_ride_sharing ? 1 : 0),
  price_per_seat: item.price_per_seat,
  shared_price_per_distance: item.shared_price_per_distance,
  shared_cancel_fee: item.shared_cancel_fee,

  status: item.status || (item.active === false ? 'inactive' : 'active'),
  active: item.active !== false,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

const serializeGoodsType = (item) => ({
  _id: item._id,
  id: item.external_id || item.id || 1,
  name: item.goods_type_name || item.name || '',
  goods_type_name: item.goods_type_name || item.name || '',
  translation_dataset: item.translation_dataset || '',
  goods_types_for: item.goods_types_for || 'both',
  company_key: item.company_key || null,
  active: item.active !== undefined ? Number(item.active) : 1,
  created_at: item.createdAt,
  updated_at: item.updatedAt,
  goods_type_translation_words: item.goods_type_translation_words || [],
});

const serializeRentalPackageType = (item) => ({
  _id: item._id,
  id: item._id,
  transport_type: item.transport_type || 'taxi',
  name: item.name || '',
  short_description: item.short_description || '',
  description: item.description || '',
  status: item.status || (item.active === false ? 'inactive' : 'active'),
  active: item.active !== false,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

const normalizePackageVehiclePriceItem = (item = {}) => ({
  vehicle_type: toObjectId(item.vehicle_type?._id || item.vehicle_type?.id || item.vehicle_type || item.type_id),
  base_price: Number(item.base_price ?? 0),
  free_distance: Number(item.free_distance ?? item.base_distance ?? 0),
  distance_price: Number(item.distance_price ?? item.price_per_distance ?? 0),
  free_time: Number(item.free_time ?? 0),
  time_price: Number(item.time_price ?? 0),
  admin_commision_type: Number(item.admin_commision_type ?? 1),
  admin_commision: Number(item.admin_commision ?? 0),
  admin_commission_type_from_driver: Number(item.admin_commission_type_from_driver ?? 1),
  admin_commission_from_driver: Number(item.admin_commission_from_driver ?? 0),
  service_tax: Number(item.service_tax ?? 0),
  cancellation_fee: Number(item.cancellation_fee ?? item.user_cancellation_fee ?? 0),
  active: Number(item.active ?? 1),
});

const buildDriverDocumentFields = (item) => {
  if (item.image_type === 'front_back') {
    return [
      {
        key: item.front_key,
        label: `${item.name} Front`,
        side: 'front',
        required: item.is_required !== false,
      },
      {
        key: item.back_key,
        label: `${item.name} Back`,
        side: 'back',
        required: item.is_required !== false,
      },
    ].filter((field) => Boolean(field.key));
  }

  return [
    {
      key: item.key,
      label:
        item.image_type === 'front'
          ? `${item.name} Front`
          : item.image_type === 'back'
            ? `${item.name} Back`
            : item.name,
      side: item.image_type === 'front' ? 'front' : item.image_type === 'back' ? 'back' : 'single',
      required: item.is_required !== false,
    },
  ].filter((field) => Boolean(field.key));
};

const serializeDriverVehicleField = (item) => {
  const definition = DRIVER_VEHICLE_FIELD_DEFINITIONS[item.field_key] || {};
  const isBuiltin = Boolean(DRIVER_VEHICLE_FIELD_DEFINITIONS[item.field_key]);

  return {
    _id: item._id,
    id: item._id,
    template_type: 'vehicle_field',
    name: item.name || definition.label || '',
    account_type: item.account_type || definition.account_type || 'individual',
    field_key: item.field_key || '',
    field_type: item.field_type || definition.field_type || 'text',
    field_group: item.field_group || definition.field_group || '',
    is_builtin: isBuiltin,
    placeholder: item.placeholder || definition.placeholder || '',
    help_text: item.help_text || '',
    sort_order: Number(item.sort_order || definition.sort_order || 0),
    options: Array.isArray(item.options) ? item.options : Array.isArray(definition.options) ? definition.options : [],
    is_editable: Boolean(item.is_editable),
    is_required: Boolean(item.is_required),
    active: item.active !== false,
    status: item.active === false ? 'inactive' : 'active',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
};

const serializeDriverNeededDocument = (item) => ({
  _id: item._id,
  id: item._id,
  template_type: normalizeDriverTemplateType(item.template_type),
  name: item.name || '',
  account_type: item.account_type || 'individual',
  image_type: item.image_type || 'front_back',
  has_expiry_date: Boolean(item.has_expiry_date),
  has_identify_number: Boolean(item.has_identify_number),
  identify_number_key: item.identify_number_key || '',
  verification_type: item.verification_type || 'none',
  is_editable: Boolean(item.is_editable),
  is_required: Boolean(item.is_required),
  active: item.active !== false,
  status: item.active === false ? 'inactive' : 'active',
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

const serializeDriverNeededDocumentTemplate = (item) => ({
  ...serializeDriverNeededDocument(item),
  fields: buildDriverDocumentFields(item),
});

const LEGACY_DRIVER_DOCUMENT_SEED_SIGNATURES = [
  { slug: 'aadhar-card', front_key: 'aadharFront', back_key: 'aadharBack', key: '' },
  { slug: 'driving-license', key: 'drivingLicense', front_key: '', back_key: '' },
  { slug: 'vehicle-rc', key: 'vehicleRC', front_key: '', back_key: '' },
];

const normalizeDriverDocumentVerificationType = (value) => {
  const normalized = String(value || 'none').trim().toLowerCase();
  if (['driving_license', 'pan', 'gstin', 'rc', 'bank_account', 'none'].includes(normalized)) {
    return normalized;
  }
  return 'none';
};

const getDriverDocumentPresetConfig = (verificationType = 'none') => {
  switch (normalizeDriverDocumentVerificationType(verificationType)) {
    case 'driving_license':
      return {
        name: 'Driving License',
        image_type: 'image',
        has_expiry_date: true,
        has_identify_number: true,
        identify_number_key: 'license_no',
        key: 'drivingLicense',
      };
    case 'pan':
      return {
        name: 'PAN Card',
        image_type: 'image',
        has_expiry_date: false,
        has_identify_number: true,
        identify_number_key: 'pan_no',
        key: 'panCard',
      };
    case 'gstin':
      return {
        name: 'GST Certificate',
        image_type: 'image',
        has_expiry_date: false,
        has_identify_number: true,
        identify_number_key: 'gstin',
        key: 'gstCertificate',
      };
    case 'rc':
      return {
        name: 'Vehicle RC',
        image_type: 'image',
        has_expiry_date: false,
        has_identify_number: true,
        identify_number_key: 'rc_no',
        key: 'vehicleRC',
      };
    case 'bank_account':
      return {
        name: 'Bank Proof',
        image_type: 'image',
        has_expiry_date: false,
        has_identify_number: true,
        identify_number_key: 'bank_account',
        key: 'bankProof',
      };
    default:
      return null;
  }
};

const cleanupLegacySeededDriverNeededDocuments = async () => {
  const items = await DriverNeededDocument.find().lean();

  if (items.length !== LEGACY_DRIVER_DOCUMENT_SEED_SIGNATURES.length) {
    return;
  }

  const isLegacySeedSet = items.every((item) =>
    LEGACY_DRIVER_DOCUMENT_SEED_SIGNATURES.some(
      (seed) =>
        seed.slug === item.slug &&
        String(seed.key || '') === String(item.key || '') &&
        String(seed.front_key || '') === String(item.front_key || '') &&
        String(seed.back_key || '') === String(item.back_key || ''),
    ),
  );

  if (!isLegacySeedSet) {
    return;
  }

  await DriverNeededDocument.deleteMany({
    slug: { $in: LEGACY_DRIVER_DOCUMENT_SEED_SIGNATURES.map((item) => item.slug) },
  });
};




const cleanupLegacySeededDriverNeededDocumentsFinal = async () => {
  const items = await DriverNeededDocument.find().lean();

  if (items.length !== LEGACY_DRIVER_DOCUMENT_SEED_SIGNATURES.length) {
    return;
  }

  const isLegacySeedSet = items.every((item) =>
    LEGACY_DRIVER_DOCUMENT_SEED_SIGNATURES.some(
      (seed) =>
        seed.slug === item.slug &&
        String(seed.key || '') === String(item.key || '') &&
        String(seed.front_key || '') === String(item.front_key || '') &&
        String(seed.back_key || '') === String(item.back_key || ''),
    ),
  );

  if (!isLegacySeedSet) {
    return;
  }

  await DriverNeededDocument.deleteMany({
    slug: { $in: LEGACY_DRIVER_DOCUMENT_SEED_SIGNATURES.map((item) => item.slug) },
  });
};

const serializeAirport = (item) => ({
  _id: item._id,
  id: item._id,
  name: item.name || '',
  code: item.code || '',
  service_location_id: item.service_location_id
    ? {
      _id: item.service_location_id._id || item.service_location_id,
      name: item.service_location_id.service_location_name || item.service_location_id.name || '',
      country: item.service_location_id.country || '',
    }
    : null,
  zone_id: item.zone_id
    ? {
      _id: item.zone_id._id || item.zone_id,
      name: item.zone_id.name || '',
    }
    : null,
  terminal: item.terminal || '',
  address: item.address || '',
  contact_number: item.contact_number || '',
  latitude: item.latitude,
  longitude: item.longitude,
  boundary_coordinates: Array.isArray(item.boundary?.coordinates?.[0])
    ? item.boundary.coordinates[0].map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }))
    : [],
  airport_surge: Number(item.airport_surge ?? 0),
  support_airport_fee: Number(item.support_airport_fee ?? 0),
  status: item.status || (item.active === false ? 'inactive' : 'active'),
  active: item.active !== false,
  pickup_availability: item.pickup_availability !== false,
  drop_availability: item.drop_availability !== false,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

const toIsoString = (value) => (value instanceof Date ? value.toISOString() : value || null);

const serializeServiceLocationSnapshot = (serviceLocation, fallback = null) => {
  if (!serviceLocation && !fallback) return null;

  const source = serviceLocation || fallback;
  return {
    id: source.legacy_id || source.id || source._id || '',
    company_key: source.company_key ?? null,
    name: source.name || source.service_location_name || '',
    translation_dataset: source.translation_dataset || '',
    currency_name: source.currency_name || 'Indian rupee',
    currency_code: source.currency_code || 'INR',
    currency_symbol: source.currency_symbol || '₹',
    currency_pointer: source.currency_pointer || 'ltr',
    timezone: source.timezone || 'Asia/Kolkata',
    country: source.country ?? 102,
    active: source.active === false ? 0 : 1,
    created_at: toIsoString(source.createdAt || source.created_at),
    updated_at: toIsoString(source.updatedAt || source.updated_at),
    deleted_at: source.deleted_at || null,
  };
};

const serializeDriver = (driver) => ({
  _id: driver._id,
  name: driver.name || '',
  phone: driver.phone || '',
  mobile: driver.phone || '',
  email: driver.email || '',
  driver_code: driver.referralCode || (driver.phone ? `DRV${String(driver.phone).slice(-4)}${String(driver._id || '').slice(-6).toUpperCase()}`.replace(/\W/g, '') : ''),
  referralCode: driver.referralCode || '',
  service_location_id: driver.service_location_id || null,
  zoneId: driver.zoneId?._id || driver.zoneId || null,
  zone_name: driver.zoneId?.name || driver.zone_name || '',
  country: driver.country || null,
  profile_picture: driver.profile_picture || '',
  city: driver.city || '',
  service_location_name: driver.city || '',
  transport_type: driver.registerFor || driver.vehicleType || '',
  register_for: driver.registerFor || '',
  service_categories: Array.isArray(driver.serviceCategories) ? driver.serviceCategories : [],
  vehicle_type: driver.vehicleType || '',
  vehicle_type_id: driver.vehicleTypeId || null,
  vehicleIconType: driver.vehicleIconType || driver.vehicleType || '',
  vehicleImage: driver.vehicleImage || '',
  vehicle_make: driver.vehicleMake || '',
  vehicle_model: driver.vehicleModel || '',
  vehicle_number: driver.vehicleNumber || '',
  vehicle_color: driver.vehicleColor || '',
  rating:
    Number(driver.ratingCount || 0) > 0
      ? Number(driver.rating || 0)
      : 0,
  rating_count: Number(driver.ratingCount || 0),
  approve: Boolean(driver.approve),
  status: driver.status || (driver.approve ? 'approved' : 'pending'),
  active: driver.approve !== false && String(driver.status || '').toLowerCase() !== 'inactive',
  deletedAt: driver.deletedAt || null,
  deletionRequest: driver.deletionRequest || { status: 'none' },
  documents: driver.documents || {},
  onboarding: driver.onboarding || {},
  wallet: {
    balance: Number(driver.wallet?.balance || 0),
    cash_limit: Number(driver.wallet?.cashLimit ?? 500),
    cashLimit: Number(driver.wallet?.cashLimit ?? 500),
    is_blocked: Boolean(driver.wallet?.isBlocked),
    isBlocked: Boolean(driver.wallet?.isBlocked),
    total_credits: Number(driver.wallet?.totalCredits || 0),
    total_debits: Number(driver.wallet?.totalDebits || 0),
    updatedAt: driver.wallet?.updatedAt || null,
  },
  wallet_balance: Number(driver.wallet?.balance || 0),
  // Driver's own payment UPI/QR shown to riders at ride-end. Only the UPI
  // subfields are surfaced here — never the bank account number / IFSC.
  paymentUpi: {
    upiId: driver.bankDetails?.upiId || '',
    qrCodeImage: driver.bankDetails?.qrCodeImage || '',
    verificationStatus: driver.bankDetails?.upiVerificationStatus || 'pending',
    verifiedName: driver.bankDetails?.upiVerifiedName || '',
    verifiedAt: driver.bankDetails?.upiVerifiedAt || null,
  },
  createdAt: driver.createdAt,
  updatedAt: driver.updatedAt,
});

const DRIVER_LIST_SELECT = [
  '_id',
  'name',
  'phone',
  'email',
  'referralCode',
  'service_location_id',
  'zoneId',
  'city',
  'registerFor',
  'vehicleType',
  'vehicleTypeId',
  'vehicleIconType',
  'vehicleNumber',
  'vehicleColor',
  'rating',
  'ratingCount',
  'isOnline',
  'isOnRide',
  'onlineSelfie',
  'location',
  'wallet',
  'deletionRequest',
  'approve',
  'status',
  'createdAt',
  'updatedAt',
].join(' ');

const serializeDriverListItem = (driver) => ({
  _id: driver._id,
  id: driver._id,
  name: driver.name || '',
  phone: driver.phone || '',
  mobile: driver.phone || '',
  email: driver.email || '',
  driver_code: driver.referralCode || (driver.phone ? `DRV${String(driver.phone).slice(-4)}${String(driver._id || '').slice(-6).toUpperCase()}`.replace(/\W/g, '') : ''),
  referralCode: driver.referralCode || '',
  service_location_id: driver.service_location_id || null,
  city: driver.city || '',
  service_location_name:
    driver.service_location_id?.service_location_name ||
    driver.service_location_id?.name ||
    driver.city ||
    '',
  zone_id: driver.zoneId?._id || driver.zoneId || null,
  zone_name: driver.zoneId?.name || '',
  transport_type: driver.registerFor || driver.vehicleType || '',
  register_for: driver.registerFor || '',
  vehicle_type: driver.vehicleType || '',
  vehicle_type_id: driver.vehicleTypeId || null,
  vehicle_icon_type: driver.vehicleIconType || driver.vehicleType || '',
  vehicle_number: driver.vehicleNumber || '',
  vehicle_color: driver.vehicleColor || '',
  rating: Number(driver.rating || 0),
  rating_count: Number(driver.ratingCount || 0),
  deletionRequest: driver.deletionRequest || { status: 'none', reason: '', requestedAt: null },
  isOnline: Boolean(driver.isOnline),
  isOnRide: Boolean(driver.isOnRide),
  online_selfie_image: driver.onlineSelfie?.imageUrl || '',
  online_selfie_captured_at: driver.onlineSelfie?.capturedAt || null,
  online_selfie_for_date: driver.onlineSelfie?.forDate || '',
  location: driver.location || null,
  wallet: {
    balance: Number(driver.wallet?.balance || 0),
    cash_limit: Number(driver.wallet?.cashLimit ?? 500),
    cashLimit: Number(driver.wallet?.cashLimit ?? 500),
    is_blocked: Boolean(driver.wallet?.isBlocked),
    isBlocked: Boolean(driver.wallet?.isBlocked),
    total_credits: Number(driver.wallet?.totalCredits || 0),
    total_debits: Number(driver.wallet?.totalDebits || 0),
    updatedAt: driver.wallet?.updatedAt || null,
  },
  wallet_balance: Number(driver.wallet?.balance || 0),
  latitude: Number(driver.location?.coordinates?.[1] ?? null),
  longitude: Number(driver.location?.coordinates?.[0] ?? null),
  // Which way the vehicle is pointing, so the admin map can orient the
  // marker instead of drawing every driver facing north.
  heading: driver.heading ?? null,
  approve: Boolean(driver.approve),
  status: driver.status || (driver.approve ? 'approved' : 'pending'),
  active: driver.approve !== false && String(driver.status || '').toLowerCase() !== 'inactive',
  createdAt: driver.createdAt,
  updatedAt: driver.updatedAt,
});

const serializeUser = (user) => ({
  _id: user._id,
  id: user._id,
  name: user.name || '',
  email: user.email || '',
  gender: user.gender || '',
  profileImage: user.profileImage || '',
  governmentIdProof: user.governmentIdProof || {
    type: '',
    imageUrl: '',
    fileName: '',
    uploadedAt: null,
  },
  mobile: user.phone || user.mobile || '',
  phone: user.phone || user.mobile || '',
  wallet_balance: Number(user.wallet_balance || 0),
  active: user.active !== false && user.isActive !== false && !user.deletedAt,
  deletedAt: user.deletedAt || null,
  deletion_reason: user.deletion_reason || '',
  deletionRequest: user.deletionRequest || { status: 'none' },
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const USER_LIST_SELECT = [
  '_id',
  'name',
  'email',
  'gender',
  'profileImage',
  'governmentIdProof',
  'phone',
  'mobile',
  'wallet_balance',
  'active',
  'isActive',
  'deletedAt',
  'deletion_reason',
  'deletionRequest',
  'createdAt',
  'updatedAt',
].join(' ');

// wallet_balance never lived on the User doc itself (see UserWallet.js) — listUsers batches a
// real lookup and passes each user's balance in here instead of trusting the (always-absent) field.
const serializeUserListItem = (user, walletBalance = 0) => ({
  _id: user._id,
  id: user._id,
  name: user.name || '',
  email: user.email || '',
  gender: user.gender || '',
  profileImage: user.profileImage || '',
  governmentIdProof: user.governmentIdProof || {
    type: '',
    imageUrl: '',
    fileName: '',
    uploadedAt: null,
  },
  mobile: user.phone || user.mobile || '',
  phone: user.phone || user.mobile || '',
  wallet_balance: Number(walletBalance || 0),
  active:
    (user.active ?? user.isActive) !== false &&
    !user.deletedAt,
  deletedAt: user.deletedAt || null,
  deletion_reason: user.deletion_reason || '',
  deletionRequest: user.deletionRequest || { status: 'none' },
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const DEFAULT_SERVICE_LOCATION_CENTER = { lat: 22.7196, lng: 75.8577 };

const normalizeServiceLocationPayload = (payload = {}, fallback = {}) => {
  const latitude = Number(payload.latitude ?? fallback.latitude ?? DEFAULT_SERVICE_LOCATION_CENTER.lat);
  const longitude = Number(payload.longitude ?? fallback.longitude ?? DEFAULT_SERVICE_LOCATION_CENTER.lng);
  const name = payload.name?.trim() || fallback.name || fallback.service_location_name;
  const currencyCode = String(payload.currency_code ?? fallback.currency_code ?? 'INR').toUpperCase();
  const status = payload.status ?? fallback.status ?? 'active';

  return {
    name,
    service_location_name: name,
    address: payload.address ?? fallback.address ?? '',
    country: payload.country ?? fallback.country ?? 'India',
    currency_name: payload.currency_name ?? fallback.currency_name ?? currencyCode,
    currency_symbol: payload.currency_symbol ?? fallback.currency_symbol ?? '₹',
    currency_code: currencyCode,
    currency_symbol: payload.currency_symbol ?? fallback.currency_symbol ?? '₹',
    timezone: payload.timezone ?? fallback.timezone ?? 'Asia/Kolkata',
    unit: payload.unit ?? fallback.unit ?? 'km',
    latitude,
    longitude,
    location: {
      type: 'Point',
      coordinates: [longitude, latitude],
    },
    status,
    active: status === 'active',
  };
};

const escapeRegex = (value = '') =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const resolveServiceLocationForImport = async (value) => {
  const candidate = String(value || '').trim();
  if (!candidate) return null;

  if (mongoose.isValidObjectId(candidate)) {
    const byId = await ServiceLocation.findById(candidate).lean();
    if (byId) return byId;
  }

  return ServiceLocation.findOne({
    $or: [
      { name: new RegExp(`^${escapeRegex(candidate)}$`, 'i') },
      { service_location_name: new RegExp(`^${escapeRegex(candidate)}$`, 'i') },
    ],
  }).lean();
};

const resolveVehicleForImport = async (vehicleLabel, transportType) => {
  const candidate = String(vehicleLabel || '').trim();
  if (!candidate) return null;

  if (mongoose.isValidObjectId(candidate)) {
    const byId = await Vehicle.findById(candidate).lean();
    if (byId) return byId;
  }

  return Vehicle.findOne({
    name: new RegExp(`^${escapeRegex(candidate)}$`, 'i'),
    ...(transportType
      ? { transport_type: { $in: [normalizeVehicleTransportType(transportType), 'both'] } }
      : {}),
  }).lean();
};

const normalizeImportTransportType = (value = '') =>
  String(value || '').trim().toLowerCase() === 'delivery' ? 'delivery' : 'taxi';

const normalizeImportVehicleType = (value = '', vehicleRecord = null) => {
  const vehicleText = String(
    vehicleRecord?.icon_types || vehicleRecord?.name || value || '',
  )
    .trim()
    .toLowerCase();

  if (vehicleText.includes('bike') || vehicleText.includes('scooter')) return 'bike';
  if (vehicleText.includes('auto') || vehicleText.includes('rickshaw')) return 'auto';
  return 'car';
};

export const csvFromRows = (headers, rows) => {
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [headers.join(','), ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))].join('\n');
};

const syncSettingRows = (rows, payload) =>
  rows.map((row) => {
    if (!(row.key in payload)) return row;
    const nextValue = String(payload[row.key]);
    return {
      ...row,
      value: nextValue,
      is_active: row.key.startsWith('enable_') ? nextValue === '1' : row.is_active,
    };
  });

const DEFAULT_ADMIN_EMAIL = 'admin@gmail.com';
const DEFAULT_ADMIN_PASSWORD = '12345';
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$/;

const syncDefaultAdminRecord = async () => {
  const now = new Date();
  const existingAdmin = await Admin.findOne({ email: DEFAULT_ADMIN_EMAIL }).select('+password');
  const nextPassword =
    !existingAdmin || !BCRYPT_HASH_PATTERN.test(existingAdmin.password || '')
      ? await hashPassword(DEFAULT_ADMIN_PASSWORD)
      : undefined;

  await Admin.collection.updateOne(
    { email: DEFAULT_ADMIN_EMAIL },
    {
      $set: {
        name: 'Super Admin',
        email: DEFAULT_ADMIN_EMAIL,
        phone: '9999999999',
        // role is the auth role checked by requireAdmin/getProfile; superadmin-ness lives in admin_type.
        role: 'ADMIN',
        admin_type: 'superadmin',
        permissions: ['*'],
        active: true,
        status: 'active',
        ...(nextPassword ? { password: nextPassword } : {}),
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true },
  );
};

const LEGACY_OWNER_SERVICE_LOCATION = {
  legacy_id: '53027f5a-dad1-47fa-8417-b958dd520821',
  company_key: null,
  name: 'India',
  service_location_name: 'India',
  translation_dataset: '{"en":{"locale":"en","name":"India"}}',
  currency_name: 'Indian rupee',
  currency_code: 'INR',
  currency_symbol: '₹',
  currency_pointer: 'ltr',
  timezone: 'Asia/Kolkata',
  country: 102,
  active: true,
  status: 'active',
  createdAt: new Date('2026-02-02T11:57:30.000Z'),
  updatedAt: new Date('2026-02-02T11:57:30.000Z'),
};

const LEGACY_OWNER_ROLE = {
  id: 3,
  slug: 'owner',
  name: 'Normal Owner',
  description: 'Normal Owner with standard access',
  all: 0,
  locked: 1,
  created_by: 1,
  created_at: '2026-02-02T11:36:54.000000Z',
  updated_at: '2026-02-07T15:55:24.000000Z',
};


const seedInitialData = async () => {
  const defaults = createDefaultAdminState();

  // Seed Users
  if (await User.countDocuments() === 0) {
    await User.insertMany(defaults.users.map(u => ({ ...u, phone: u.mobile, password: 'password123' })));
  }

  // Seed Service Locations
  if (await ServiceLocation.countDocuments() === 0) {
    await ServiceLocation.insertMany(defaults.serviceLocations);
  }

  // Seed Drivers
  if (await Driver.countDocuments() === 0) {
    await Driver.insertMany(defaults.drivers.map(d => ({ ...d, phone: d.mobile })));
  }

  // Seed Languages
  if (await AppLanguage.countDocuments() === 0) {
    await AppLanguage.insertMany(defaults.languages);
  }

  // Seed Ride Modules
  if (await RideModule.countDocuments() === 0) {
    await RideModule.insertMany(defaults.rideModules);
  }

  // Seed App Modules removed (Migrated to AdminAppSetting)

  // Seed Preferences
  if (await UserPreference.countDocuments() === 0) {
    await UserPreference.insertMany(defaults.preferences);
  }

  // Seed Admin Roles
  if (await AdminRole.countDocuments() === 0) {
    await AdminRole.insertMany(defaults.roles);
  }

  // Seed Onboarding Screens
  if (await OnboardingScreen.countDocuments() === 0) {
    await OnboardingScreen.insertMany(defaults.onboardingScreens);
  }

};

export const ensureServiceLocationsSeeded = async () => {
  if (await ServiceLocation.countDocuments() === 0) {
    const defaults = createDefaultAdminState();
    await ServiceLocation.insertMany(defaults.serviceLocations);
  }
};


export const ensureAdminState = async () => {
  await syncDefaultAdminRecord();
  await seedInitialData();
  return { ready: true };
};

export const getAdminModuleInfo = async () => {
  const [
    userCount,
    deletedUserCount,
    driverCount,
    zoneCount
  ] = await Promise.all([
    User.countDocuments({ deletedAt: null }),
    User.countDocuments({ deletedAt: { $ne: null } }),
    Driver.countDocuments(),
    Zone.countDocuments(),
  ]);
  return {
    module: 'admin',
    ready: true,
    message: 'Admin module is wired with independent collections',
    snapshot: {
      users: userCount,
      deleted_users: deletedUserCount,
      drivers: driverCount,
      zones: zoneCount,
    },
  };
};

/**
 * Notes something an admin did, for the Admin Management page.
 *
 * Never allowed to break what it records: a failed write is logged and
 * dropped, so signing in or saving an admin works even if this does not.
 */
const recordAdminActivity = (entry) => {
  AdminActivity.create(entry).catch((error) => {
    console.error('[admin-activity] not recorded', entry?.type, error?.message);
  });
};

const actorOf = (admin) => ({
  actorId: admin?._id || admin?.id || null,
  actorName: String(admin?.name || admin?.email || ''),
});

export const loginAdmin = async ({ email, password, ip = '' }) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const admin = await Admin.findOne({ email: normalizedEmail }).select('+password');

  if (!admin) {
    recordAdminActivity({ type: 'login_failed', email: normalizedEmail, ip });
    throw new ApiError(401, 'Invalid admin credentials');
  }

  const passwordMatches = BCRYPT_HASH_PATTERN.test(admin.password || '')
    ? await comparePassword(password, admin.password)
    : admin.password === password;

  if (!passwordMatches) {
    recordAdminActivity({ type: 'login_failed', ...actorOf(admin), email: normalizedEmail, ip });
    throw new ApiError(401, 'Invalid admin credentials');
  }

  if (admin.active === false || String(admin.status || '').toLowerCase() === 'inactive') {
    recordAdminActivity({ type: 'login_failed', ...actorOf(admin), email: normalizedEmail, ip });
    throw new ApiError(403, 'Admin account is inactive');
  }

  recordAdminActivity({ type: 'login_success', ...actorOf(admin), email: normalizedEmail, ip });

  const [serializedAdmin] = await enrichAdminSummaries([admin]);

  return {
    // authMiddleware reads userId + the uppercase ADMIN role; sub/id kept for taxi's own consumers.
    token: signAccessToken({
      userId: String(admin._id),
      sub: String(admin._id),
      id: String(admin._id),
      role: 'ADMIN',
    }),
    admin: serializedAdmin,
  };
};

export const listAdminPermissions = async () =>
  ADMIN_PERMISSIONS.map((key) => ({ key, label: key }));

export const listAdmins = async (currentAdmin) => {
  assertAdminPermission(currentAdmin, 'subadmins.manage', 'subadmins');

  const admins = await Admin.find()
    .select('-resetPasswordOtp -resetPasswordExpires')
    .sort({ createdAt: -1 })
    .lean();

  return enrichAdminSummaries(admins);
};

const validateSubadminPayload = async (payload = {}, existingAdminId = null) => {
  const adminType = normalizeAdminType(payload.admin_type || payload.role);
  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  const phone = String(payload.phone || '').trim();
  // role is the auth role (requireAdmin/getProfile expect 'ADMIN'); adminType holds superadmin/subadmin.
  const role = 'ADMIN';
  const permissions = normalizeAdminPermissions(
    adminType === 'superadmin' ? [SUPERADMIN_PERMISSION] : payload.permissions || [],
  );
  const serviceLocationIds = normalizeObjectIdList(payload.service_location_ids);
  const zoneIds = normalizeObjectIdList(payload.zone_ids);
  const active = payload.active === undefined ? true : normalizeBoolean(payload.active);
  const status = String(payload.status || (active ? 'active' : 'inactive')).trim().toLowerCase() === 'inactive'
    ? 'inactive'
    : 'active';

  if (!name) {
    throw new ApiError(400, 'Admin name is required');
  }

  if (!email) {
    throw new ApiError(400, 'Admin email is required');
  }

  const duplicate = await Admin.findOne({
    email,
    ...(existingAdminId ? { _id: { $ne: existingAdminId } } : {}),
  }).lean();

  if (duplicate) {
    throw new ApiError(409, 'Admin email already exists');
  }

  if (adminType === 'subadmin' && permissions.length === 0) {
    throw new ApiError(400, 'Select at least one permission for the subadmin');
  }

  if (adminType === 'subadmin' && serviceLocationIds.length === 0) {
    throw new ApiError(400, 'Assign at least one service location to the subadmin');
  }

  if (serviceLocationIds.length > 0) {
    const count = await ServiceLocation.countDocuments({ _id: { $in: serviceLocationIds } });
    if (count !== serviceLocationIds.length) {
      throw new ApiError(400, 'One or more selected service locations are invalid');
    }
  }

  if (zoneIds.length > 0) {
    const zones = await Zone.find({ _id: { $in: zoneIds } }).select('_id service_location_id').lean();
    if (zones.length !== zoneIds.length) {
      throw new ApiError(400, 'One or more selected zones are invalid');
    }

    if (
      adminType === 'subadmin' &&
      zones.some((zone) => !serviceLocationIds.some((id) => String(id) === String(zone.service_location_id || '')))
    ) {
      throw new ApiError(400, 'Assigned zones must belong to the selected service locations');
    }
  }

  return {
    admin_type: adminType,
    name,
    email,
    phone,
    role,
    permissions,
    service_location_ids: adminType === 'superadmin' ? [] : serviceLocationIds,
    zone_ids: adminType === 'superadmin' ? [] : zoneIds,
    active,
    status,
  };
};

export const createAdminAccount = async (currentAdmin, payload = {}) => {
  assertAdminPermission(currentAdmin, 'subadmins.manage', 'subadmins');

  const password = String(payload.password || '').trim();
  const passwordConfirmation = String(payload.password_confirmation || payload.passwordConfirmation || '').trim();

  if (!password || password.length < 5) {
    throw new ApiError(400, 'Password must be at least 5 characters');
  }

  if (!passwordConfirmation || password !== passwordConfirmation) {
    throw new ApiError(400, 'Passwords do not match');
  }

  const validated = await validateSubadminPayload(payload);
  const created = await Admin.create({
    ...validated,
    password: await hashPassword(password),
  });

  recordAdminActivity({
    type: 'admin_created',
    ...actorOf(currentAdmin),
    targetId: created._id,
    targetName: created.name,
    email: created.email,
  });

  const [serializedAdmin] = await enrichAdminSummaries([created]);
  return serializedAdmin;
};

export const updateAdminAccount = async (currentAdmin, id, payload = {}) => {
  assertAdminPermission(currentAdmin, 'subadmins.manage', 'subadmins');

  const admin = await Admin.findById(id).select('+password');
  if (!admin) {
    throw new ApiError(404, 'Admin account not found');
  }

  if (String(admin._id) === String(currentAdmin?.id || '')) {
    throw new ApiError(400, 'Use your profile flow to update your own admin account');
  }

  const validated = await validateSubadminPayload(payload, admin._id);

  const before = {
    permissions: [...(admin.permissions || [])].map(String).sort().join(','),
    active: admin.active !== false,
  };
  const after = {
    permissions: [...(validated.permissions || [])].map(String).sort().join(','),
    active: validated.active !== false,
  };

  Object.assign(admin, validated);

  if (payload.password) {
    const password = String(payload.password || '').trim();
    const passwordConfirmation = String(payload.password_confirmation || payload.passwordConfirmation || '').trim();
    if (password.length < 5) {
      throw new ApiError(400, 'Password must be at least 5 characters');
    }
    if (password !== passwordConfirmation) {
      throw new ApiError(400, 'Passwords do not match');
    }
    admin.password = await hashPassword(password);
  }

  await admin.save();

  const target = { targetId: admin._id, targetName: admin.name, email: admin.email };
  if (before.active !== after.active) {
    recordAdminActivity({ type: after.active ? 'admin_reactivated' : 'admin_suspended', ...actorOf(currentAdmin), ...target });
  }
  if (before.permissions !== after.permissions) {
    recordAdminActivity({ type: 'permissions_changed', ...actorOf(currentAdmin), ...target });
  }
  if (before.active === after.active && before.permissions === after.permissions) {
    recordAdminActivity({ type: 'admin_updated', ...actorOf(currentAdmin), ...target });
  }

  const [serializedAdmin] = await enrichAdminSummaries([admin]);
  return serializedAdmin;
};

export const deleteAdminAccount = async (currentAdmin, id) => {
  assertAdminPermission(currentAdmin, 'subadmins.manage', 'subadmins');

  const admin = await Admin.findById(id).lean();
  if (!admin) {
    throw new ApiError(404, 'Admin account not found');
  }

  if (String(admin._id) === String(currentAdmin?.id || '')) {
    throw new ApiError(400, 'You cannot delete your own admin account');
  }

  await Admin.deleteOne({ _id: admin._id });
  recordAdminActivity({
    type: 'admin_deleted',
    ...actorOf(currentAdmin),
    targetId: admin._id,
    targetName: admin.name,
    email: admin.email,
  });
  return { deleted: true };
};

/**
 * The numbers on the Admin Management page, counted from what was recorded.
 *
 * Compared against the 30 days before, so the cards can say whether a number
 * went up or down - the page used to print trends like "+2 from last month"
 * as fixed text.
 */
export const getAdminActivitySummary = async (currentAdmin) => {
  assertAdminPermission(currentAdmin, 'subadmins.manage', 'subadmins');

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const last30 = new Date(now - 30 * day);
  const prev30 = new Date(now - 60 * day);

  const countByType = async (from, to) => {
    const rows = await AdminActivity.aggregate([
      { $match: { createdAt: { $gte: from, $lt: to } } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map((row) => [row._id, row.count]));
  };

  const [current, previous, signedInToday, failedLast7d, recent, lastSignIns, firstRecord] = await Promise.all([
    countByType(last30, new Date(now + 1)),
    countByType(prev30, last30),
    AdminActivity.distinct('actorId', { type: 'login_success', createdAt: { $gte: new Date(now - day) } }),
    AdminActivity.countDocuments({ type: 'login_failed', createdAt: { $gte: new Date(now - 7 * day) } }),
    AdminActivity.find().sort({ createdAt: -1 }).limit(8).lean(),
    AdminActivity.aggregate([
      { $match: { type: 'login_success', actorId: { $ne: null } } },
      { $group: { _id: '$actorId', at: { $max: '$createdAt' } } },
    ]),
    AdminActivity.findOne().sort({ createdAt: 1 }).select('createdAt').lean(),
  ]);

  const summarize = (counts) => {
    const success = counts.login_success || 0;
    const failed = counts.login_failed || 0;
    return {
      loginSuccess: success,
      loginFailed: failed,
      loginSuccessRate: success + failed > 0 ? Math.round((success / (success + failed)) * 1000) / 10 : null,
      passwordResets: counts.password_reset || 0,
      permissionChanges: counts.permissions_changed || 0,
      created: counts.admin_created || 0,
      suspended: counts.admin_suspended || 0,
    };
  };

  return {
    last30Days: summarize(current),
    previous30Days: summarize(previous),
    signedInLast24h: signedInToday.filter(Boolean).length,
    failedLoginsLast7d: failedLast7d,
    // When the record starts, so the page can say "since ..." instead of
    // implying it knows about sign-ins from before it existed.
    trackingSince: firstRecord?.createdAt || null,
    lastSignInByAdmin: Object.fromEntries(lastSignIns.map((row) => [String(row._id), row.at])),
    recent: recent.map((row) => ({
      id: String(row._id),
      type: row.type,
      actorName: row.actorName || '',
      targetName: row.targetName || '',
      email: row.email || '',
      at: row.createdAt,
    })),
  };
};

export const forgotPassword = async (email) => {
  const admin = await Admin.findOne({ email: email?.trim().toLowerCase() });
  if (!admin) {
    throw new ApiError(404, 'Admin with this email not found');
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  admin.resetPasswordOtp = otp;
  admin.resetPasswordExpires = otpExpires;
  await admin.save();

  // Send real email
  await sendEmail({
    to: email,
    subject: `Password Reset OTP for ${process.env.APP_NAME || 'Buddy'}`,
    text: `Your OTP for password reset is: ${otp}. It will expire in 10 minutes.`,
    html: `
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px; max-width: 500px;">
        <h2 style="color: #f97316;">Password Reset</h2>
        <p>Hello,</p>
        <p>You requested a password reset for your admin account. Use the following OTP to continue:</p>
        <div style="font-size: 32px; font-weight: bold; padding: 10px; background: #fff7ed; color: #f97316; text-align: center; border-radius: 8px; margin: 20px 0;">
          ${otp}
        </div>
        <p>This OTP is valid for 10 minutes. If you did not request this, please ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #666;">Regards,<br>Team ${process.env.APP_NAME || 'Buddy'}</p>
      </div>
    `,
  });

  console.log(`[ADMIN FORGOT PASSWORD] OTP for ${email}: ${otp}`);

  return { message: 'OTP sent to your email' };
};

export const verifyResetOtp = async ({ email, otp }) => {
  const admin = await Admin.findOne({
    email: email?.trim().toLowerCase()
  }).select('+resetPasswordOtp +resetPasswordExpires');

  if (!admin || admin.resetPasswordOtp !== otp || new Date() > admin.resetPasswordExpires) {
    throw new ApiError(400, 'Invalid or expired OTP');
  }

  return { success: true, message: 'OTP verified successfully' };
};

export const resetPassword = async ({ email, otp, password }) => {
  const admin = await Admin.findOne({
    email: email?.trim().toLowerCase()
  }).select('+resetPasswordOtp +resetPasswordExpires');

  if (!admin || admin.resetPasswordOtp !== otp || new Date() > admin.resetPasswordExpires) {
    throw new ApiError(400, 'Invalid or expired OTP');
  }

  admin.password = await hashPassword(password);
  admin.resetPasswordOtp = undefined;
  admin.resetPasswordExpires = undefined;
  await admin.save();

  recordAdminActivity({ type: 'password_reset', ...actorOf(admin), email: admin.email });

  return { success: true, message: 'Password reset successful' };
};

export const listUsers = async ({
  page = 1,
  limit = 50,
  search = '',
}) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const start = (safePage - 1) * safeLimit;
  const query = { deletedAt: null };
  const normalizedSearch = String(search || '').trim();

  if (normalizedSearch) {
    const escapedSearch = normalizedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const digits = normalizedSearch.replace(/\D/g, '');
    const regex = new RegExp(escapedSearch, 'i');
    query.$or = [{ name: regex }, { email: regex }];

    if (digits) {
      query.$or.push({ phone: new RegExp(`^${digits}`) });
    } else {
      query.$or.push({ phone: regex });
    }
  }

  const [users, total] = await Promise.all([
    User.find(query)
      .select(USER_LIST_SELECT)
      .sort({ createdAt: -1 })
      .skip(start)
      .limit(safeLimit)
      .lean(),
    User.countDocuments(query),
  ]);

  const wallets = await UserWallet.find({ userId: { $in: users.map((u) => u._id) } })
    .select('userId balance')
    .lean();
  const balanceByUserId = new Map(wallets.map((w) => [String(w.userId), w.balance]));

  return {
    results: users.map((user) => serializeUserListItem(user, balanceByUserId.get(String(user._id)))),
    paginator: {
      current_page: safePage,
      per_page: safeLimit,
      total,
      last_page: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
};

export const bulkImportDrivers = async (payload = {}) => {
  const incomingDrivers = Array.isArray(payload.drivers) ? payload.drivers : [];

  if (!incomingDrivers.length) {
    throw new ApiError(400, 'drivers array is required');
  }

  if (incomingDrivers.length > 2000) {
    throw new ApiError(400, 'Too many drivers in one import (max 2000)');
  }

  const errors = [];
  const created = [];
  const skipped = [];

  for (let index = 0; index < incomingDrivers.length; index += 1) {
    const raw = incomingDrivers[index] || {};
    const name = String(raw.name || '').trim();
    const phone = String(raw.phone || raw.mobile || '').replace(/\D/g, '');
    const email = String(raw.email || '').trim().toLowerCase();
    const gender = String(raw.gender || '').trim().toLowerCase();
    const serviceLocationInput = String(
      raw.service_location || raw.serviceLocation || '',
    ).trim();
    const transportType = normalizeImportTransportType(
      raw.transport_type || raw.transportType,
    );
    const vehicleInput = String(raw.vehicle_type || raw.vehicleType || '').trim();

    if (!name) {
      errors.push({ index, field: 'name', message: 'Name is required' });
      continue;
    }

    if (!/^\d{10}$/.test(phone)) {
      errors.push({
        index,
        field: 'phone',
        message: 'A valid 10-digit phone number is required',
      });
      continue;
    }

    if (email && !EMAIL_REGEX.test(email)) {
      errors.push({ index, field: 'email', message: 'A valid email address is required' });
      continue;
    }

    if (!serviceLocationInput) {
      errors.push({
        index,
        field: 'service_location',
        message: 'Service location is required',
      });
      continue;
    }

    const existingDriver = await Driver.findOne({ phone }).lean();
    if (existingDriver) {
      skipped.push({ index, phone, id: String(existingDriver._id) });
      continue;
    }

    const serviceLocation = await resolveServiceLocationForImport(serviceLocationInput);
    const normalizedVehicleInput = vehicleInput || transportType || 'car';
    const vehicleRecord = await resolveVehicleForImport(
      normalizedVehicleInput,
      transportType,
    );
    const vehicleType = normalizeImportVehicleType(
      normalizedVehicleInput,
      vehicleRecord,
    );

    try {
      const driver = await Driver.create({
        name,
        phone,
        email,
        gender,
        password: await hashPassword(phone),
        vehicleType,
        vehicleTypeId: vehicleRecord?._id || null,
        vehicleMake: String(raw.vehicle_make || raw.vehicleMake || '').trim(),
        vehicleModel: String(raw.vehicle_model || raw.vehicleModel || '').trim(),
        vehicleColor: String(raw.vehicle_color || raw.vehicleColor || '').trim(),
        vehicleNumber: String(raw.vehicle_number || raw.vehicleNumber || '').trim(),
        registerFor: transportType,
        city:
          serviceLocation?.service_location_name ||
          serviceLocation?.name ||
          serviceLocationInput ||
          String(raw.country || '').trim(),
        approve: raw.approve !== undefined ? Boolean(raw.approve) : true,
        status: raw.status || (raw.approve === false ? 'pending' : 'approved'),
        onboarding: {
          importCountry: String(raw.country || '').trim(),
          importServiceLocation: serviceLocationInput,
          importedByAdmin: true,
        },
      });

      created.push(serializeDriver(driver.toObject()));
    } catch (error) {
      errors.push({ index, message: error?.message || 'Failed to create driver' });
    }
  }

  return {
    created_count: created.length,
    skipped_count: skipped.length,
    error_count: errors.length,
    created,
    skipped: skipped.slice(0, 200),
    errors: errors.slice(0, 200),
  };
};

export const updateUser = async (id, payload) => {
  const update = {};

  if (payload.name !== undefined) update.name = String(payload.name || '').trim();
  if (payload.phone !== undefined || payload.mobile !== undefined) {
    update.phone = String(payload.phone || payload.mobile || '').replace(/\D/g, '');
    if (!/^\d{10}$/.test(update.phone)) {
      throw new ApiError(400, 'A valid 10-digit phone number is required');
    }
  }
  if (payload.email !== undefined) {
    update.email = String(payload.email || '').trim().toLowerCase();
    if (update.email && !EMAIL_REGEX.test(update.email)) {
      throw new ApiError(400, 'A valid email address is required');
    }
  }
  if (payload.gender !== undefined) {
    update.gender = String(payload.gender || '').trim().toLowerCase();
    if (update.gender && !VALID_USER_GENDERS.has(update.gender)) {
      throw new ApiError(400, 'A valid gender is required');
    }
  }
  if (payload.profileImage !== undefined) update.profileImage = String(payload.profileImage || '').trim();
  // Wallet balance is not a User field (see UserWallet.js) — adjust it via
  // POST /admin/wallet/users/:id/adjust, not through this profile update.
  if (payload.active !== undefined) {
    update.active = Boolean(payload.active);
    update.isActive = Boolean(payload.active);
  }
  if (payload.password) {
    update.password = await hashPassword(String(payload.password));
  }

  const user = await User.findOneAndUpdate(
    { _id: id, deletedAt: null },
    { $set: update },
    { returnDocument: 'after', runValidators: true },
  );

  if (!user) throw new ApiError(404, 'User not found');
  return serializeUser(user.toObject());
};

export const deleteUser = async (id) => {
  const user = await User.findOneAndUpdate(
    { _id: id, deletedAt: null },
    {
      $set: {
        deletedAt: new Date(),
        deletion_reason: 'admin_delete',
        active: false,
        isActive: false,
      },
    },
    { returnDocument: 'after' },
  );

  if (!user) {
    throw new ApiError(404, 'User not found');
  }
  return true;
};

export const listDeletedUsers = async ({ page = 1, limit = 50 }) => {
  const safePage = Number(page) || 1;
  const safeLimit = Number(limit) || 50;
  const start = (safePage - 1) * safeLimit;

  const [users, total] = await Promise.all([
    User.find({ deletedAt: { $ne: null } })
      .sort({ deletedAt: -1, createdAt: -1 })
      .skip(start)
      .limit(safeLimit)
      .lean(),
    User.countDocuments({ deletedAt: { $ne: null } }),
  ]);

  return {
    results: users.map(serializeUser),
    paginator: {
      current_page: safePage,
      per_page: safeLimit,
      total,
      last_page: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
};

export const restoreDeletedUser = async (id) => {
  const user = await User.findOneAndUpdate(
    { _id: id, deletedAt: { $ne: null } },
    {
      $set: {
        deletedAt: null,
        deletion_reason: '',
        active: true,
      },
    },
    { returnDocument: 'after', runValidators: true },
  );

  if (!user) {
    throw new ApiError(404, 'Deleted user not found');
  }

  return serializeUser(user.toObject());
};

export const permanentlyDeleteDeletedUser = async (id) => {
  const deleted = await User.findOneAndDelete({ _id: id, deletedAt: { $ne: null } });

  if (!deleted) {
    throw new ApiError(404, 'Deleted user not found');
  }
  return true;
};

export const getUserById = async (id) => {
  const user = await User.findById(id).lean();

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const [rides, wallet] = await Promise.all([
    Ride.find({
      userId: id,
      'feedback.rating': { $gte: 1 },
    })
      .sort({ completedAt: -1, createdAt: -1 })
      .populate('driverId', 'name')
      .lean(),
    // wallet_balance never lived on the User doc — the real figure is UserWallet.balance.
    UserWallet.findOne({ userId: id }).select('balance').lean(),
  ]);

  return {
    ...serializeUser(user),
    wallet_balance: Number(wallet?.balance || 0),
    reviews: rides.map((ride) => ({
      _id: ride._id,
      request_id: String(ride._id),
      rating: Number(ride.feedback?.rating || 0),
      comment: String(ride.feedback?.comment || '').trim(),
      createdAt: ride.feedback?.submittedAt || ride.completedAt || ride.createdAt || null,
      driver_id: ride.driverId
        ? {
          _id: ride.driverId._id || ride.driverId,
          name: ride.driverId.name || 'Unknown',
        }
        : null,
    })),
  };
};

const ensureDefaultDriverVehicleFields = async () => {
  const count = await DriverNeededDocument.countDocuments({ template_type: 'vehicle_field' });
  if (count > 0) {
    return;
  }

  await DriverNeededDocument.insertMany(buildDefaultDriverVehicleFieldConfigs(), { ordered: false });
};

export const listUserRequests = async (id) => {
  const user = await User.findById(id).lean();

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const rides = await Ride.find({ userId: id }).sort({ createdAt: -1 }).populate('driverId', 'name').lean();

  return {
    results: rides.map((ride) => ({
      request_id: String(ride._id),
      trip_start_time: ride.createdAt,
      user_id: {
        _id: String(id),
        name: user.name || '',
      },
      driver_id: ride.driverId
        ? {
          _id: ride.driverId._id || ride.driverId,
          name: ride.driverId.name || 'Pending',
        }
        : null,
      is_completed: String(ride.status).toLowerCase() === 'completed',
      is_cancelled: String(ride.status).toLowerCase() === 'cancelled',
      is_paid: String(ride.status).toLowerCase() === 'completed',
      payment_type: String(ride.paymentMethod || 'cash').toLowerCase(),
      status: ride.status,
    })),
  };
};

export const listUserWalletHistory = async (id) => {
  const user = await User.findById(id).lean();

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const wallet = await UserWallet.findOne({ userId: id }).lean();

  return {
    balance: wallet?.balance || 0,
    refundWallet: wallet?.refundWallet || 0,
    results: (wallet?.transactions || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(t => ({
      _id: String(t._id),
      amount: t.amount,
      type: t.kind || (t.type === 'deduction' ? 'debit' : 'credit'),
      description: t.title || t.description,
      createdAt: t.createdAt,
    })),
  };
};

export const adjustUserWallet = async (id, payload = {}) => {
  const amount = Number(payload.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, 'Amount must be greater than 0');
  }

  const operation = String(payload.operation || 'credit').toLowerCase();
  if (!['credit', 'debit'].includes(operation)) {
    throw new ApiError(400, 'Operation must be credit or debit');
  }

  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  let wallet = await UserWallet.findOne({ userId: id });
  if (!wallet) {
    wallet = new UserWallet({ userId: id, balance: 0, refundWallet: 0, transactions: [] });
  }

  const currentBalance = wallet.balance || 0;
  const nextBalance = operation === 'credit' ? currentBalance + amount : currentBalance - amount;

  wallet.balance = nextBalance;
  wallet.transactions.push({
    kind: operation,
    amount,
    title: payload.description || `Admin adjustment (${operation})`,
  });

  await wallet.save();
  return { balance: Number(nextBalance.toFixed(2)) };
};

export const listDrivers = async ({ page = 1, limit = 50, status, search, approve, isOnline } = {}, currentAdmin = null) => {
  const safePage = Number(page) || 1;
  const safeLimit = Number(limit) || 50;
  const start = (safePage - 1) * safeLimit;

  const query = { deletedAt: null };
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'drivers.view', 'drivers');
    Object.assign(query, buildServiceLocationScopeQuery(currentAdmin));
  }

  if (status) {
    query.status = status;
  }

  if (approve !== undefined) {
    query.approve = approve === 'true' || approve === true || approve === 1;
  }

  if (isOnline !== undefined) {
    query.isOnline = isOnline === 'true' || isOnline === true || isOnline === 1;
  }

  if (search) {
    const regex = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [
      { name: regex },
      { phone: regex },
      { email: regex },
      { vehicleNumber: regex }
    ];
  }

  const total = await Driver.countDocuments(query);

  const drivers = await Driver.find(query)
    .select(DRIVER_LIST_SELECT)
    .sort({ createdAt: -1 })
    .skip(start)
    .limit(safeLimit)
    .lean();

  const serviceLocationIds = [
    ...new Set(
      drivers
        .map((driver) => String(driver.service_location_id || ''))
        .filter(Boolean),
    ),
  ];

  const [serviceLocations] = await Promise.all([
    serviceLocationIds.length
      ? ServiceLocation.find({ _id: { $in: serviceLocationIds } })
        .select('_id service_location_name name country')
        .lean()
      : [],
  ]);

  const serviceLocationMap = new Map(
    serviceLocations.map((location) => [String(location._id), location]),
  );

  const hydratedDrivers = drivers.map((driver) => ({
    ...driver,
    service_location_id: driver.service_location_id
      ? serviceLocationMap.get(String(driver.service_location_id)) || driver.service_location_id
      : null,
  }));

  return {
    results: hydratedDrivers.map(serializeDriverListItem),
    paginator: {
      current_page: safePage,
      per_page: safeLimit,
      total,
      last_page: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
};

export const listDriverRatings = async ({ page = 1, limit = 50, search = '' }) => {
  const safePage = Number(page) || 1;
  const safeLimit = Number(limit) || 50;
  const start = (safePage - 1) * safeLimit;
  const term = String(search || '').trim();

  const query = { deletedAt: null };
  if (term) {
    const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ name: regex }, { phone: regex }, { email: regex }];
  }

  const [drivers, total] = await Promise.all([
    Driver.find(query).sort({ rating: -1, createdAt: -1 }).skip(start).limit(safeLimit).lean(),
    Driver.countDocuments(query),
  ]);

  const driverIds = drivers.map((d) => d._id);
  const rides = await Ride.find({ driverId: { $in: driverIds }, 'feedback.rating': { $gt: 0 } })
    .select('driverId feedback.rating')
    .lean();

  const ratingsByDriver = new Map();
  for (const r of rides) {
    const key = String(r.driverId);
    if (!ratingsByDriver.has(key)) {
      ratingsByDriver.set(key, []);
    }
    ratingsByDriver.get(key).push(Number(r.feedback.rating));
  }

  return {
    results: drivers.map((driver) => {
      const rideRatings = ratingsByDriver.get(String(driver._id)) || [];
      let rating = 0;
      let ratingCount = 0;
      if (rideRatings.length > 0) {
        rating = Number((rideRatings.reduce((sum, val) => sum + val, 0) / rideRatings.length).toFixed(1));
        ratingCount = rideRatings.length;
      } else if (Number(driver.rating || 0) > 0) {
        rating = Number(driver.rating);
        ratingCount = Number(driver.ratingCount || 1);
      }

      return {
        _id: driver._id,
        name: driver.name || '',
        mobile: driver.phone || '',
        phone: driver.phone || '',
        email: driver.email || '',
        rating,
        rating_count: ratingCount,
        transport_type: driver.registerFor || driver.vehicleType || 'Taxi',
      };
    }),
    paginator: {
      current_page: safePage,
      per_page: safeLimit,
      total,
      last_page: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
};

export const getDriverRatingDetail = async (id) => {
  const driver = await Driver.findById(id).lean();
  if (!driver) {
    throw new ApiError(404, 'Driver not found');
  }

  const rides = await Ride.find({ driverId: driver._id }).sort({ createdAt: -1 }).lean();
  const ratedRides = rides.filter((r) => Number(r.feedback?.rating || 0) > 0);
  const computedRating = ratedRides.length
    ? Number((ratedRides.reduce((acc, r) => acc + Number(r.feedback.rating), 0) / ratedRides.length).toFixed(1))
    : Number(driver.rating || 5);
  const computedRatingCount = ratedRides.length || Number(driver.ratingCount || (driver.rating ? 1 : 0));

  return {
    driver: {
      _id: driver._id,
      name: driver.name || '',
      phone: driver.phone || '',
      email: driver.email || '',
      rating: computedRating,
      rating_count: computedRatingCount,
      transport_type: driver.registerFor || driver.vehicleType || 'Taxi',
      vehicle_make: driver.vehicleMake || '',
      vehicle_model: driver.vehicleModel || '',
      vehicle_number: driver.vehicleNumber || '',
      image: driver.profile_image || driver.avatar || '',
      vehicle_image: driver.vehicleImage || 'https://img.freepik.com/free-vector/yellow-passenger-transport-taxi-car_1017-4886.jpg',
    },
    reviews: rides.map((ride) => ({
      _id: ride._id,
      request_id: String(ride._id),
      date: ride.completedAt || ride.createdAt,
      pickup_location: ride.pickupAddress || (ride.pickupLocation?.coordinates ? `${ride.pickupLocation.coordinates[1]}, ${ride.pickupLocation.coordinates[0]}` : 'N/A'),
      rating: Number(ride.feedback?.rating || computedRating || 5),
      comment: ride.feedback?.comment || '',
    })),
  };
};

export const listNegativeBalanceDrivers = async ({ page = 1, limit = 50, search = '' }) => {
  const safePage = Number(page) || 1;
  const safeLimit = Number(limit) || 50;
  const start = (safePage - 1) * safeLimit;
  const term = String(search || '').trim();

  const query = { deletedAt: null, 'wallet.balance': { $lt: 0 } };
  if (term) {
    const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ name: regex }, { phone: regex }, { email: regex }];
  }

  const [drivers, total, totals] = await Promise.all([
    Driver.find(query)
      .sort({ 'wallet.balance': 1, createdAt: -1 })
      .skip(start)
      .limit(safeLimit)
      .lean(),
    Driver.countDocuments(query),
    Driver.aggregate([
      { $match: query },
      { $group: { _id: null, total_outstanding: { $sum: { $abs: '$wallet.balance' } } } },
    ]),
  ]);

  const totalOutstanding = Number(totals?.[0]?.total_outstanding || 0);

  return {
    results: drivers.map((driver) => ({
      _id: driver._id,
      name: driver.name || '',
      service_location_name: driver.city || '',
      email: driver.email || '',
      mobile: driver.phone || '',
      transport_type: driver.registerFor || driver.vehicleType || '',
      approve: Boolean(driver.approve),
      status: driver.status || (driver.approve ? 'approved' : 'pending'),
      balance: Number(driver.wallet?.balance || 0),
    })),
    paginator: {
      current_page: safePage,
      per_page: safeLimit,
      total,
      last_page: Math.max(1, Math.ceil(total / safeLimit)),
    },
    summary: {
      total_outstanding: totalOutstanding,
    },
  };
};

export const listDriverWithdrawalSummaries = async ({ page = 1, limit = 50, search = '' }) => {
  const safePage = Number(page) || 1;
  const safeLimit = Number(limit) || 50;
  const start = (safePage - 1) * safeLimit;
  const term = String(search || '').trim();

  const match = { status: 'pending' };
  let matchedDriverIds = null;

  if (term) {
    const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const drivers = await Driver.find({ deletedAt: null, $or: [{ name: regex }, { phone: regex }, { email: regex }] })
      .select('_id')
      .lean();
    matchedDriverIds = drivers.map((d) => d._id);
    if (matchedDriverIds.length === 0) {
      return {
        results: [],
        paginator: { current_page: safePage, per_page: safeLimit, total: 0, last_page: 1 },
      };
    }
    match.driver_id = { $in: matchedDriverIds };
  }

  const groupPipeline = [
    { $match: match },
    {
      $group: {
        _id: '$driver_id',
        pending_count: { $sum: 1 },
        pending_amount: { $sum: '$amount' },
        last_request_at: { $max: '$createdAt' },
      },
    },
  ];

  const [groups, countRows] = await Promise.all([
    WithdrawalRequest.aggregate([
      ...groupPipeline,
      { $sort: { last_request_at: -1 } },
      { $skip: start },
      { $limit: safeLimit },
    ]),
    WithdrawalRequest.aggregate([...groupPipeline, { $count: 'total' }]),
  ]);

  const total = Number(countRows?.[0]?.total || 0);
  const driverIds = groups.map((g) => g._id).filter(Boolean);
  const drivers = await Driver.find({ _id: { $in: driverIds } }).lean();
  const latestRequests = driverIds.length
    ? await WithdrawalRequest.find({
      driver_id: { $in: driverIds },
      status: 'pending',
    })
      .sort({ createdAt: -1 })
      .lean()
    : [];
  const byId = new Map(drivers.map((d) => [String(d._id), d]));
  const latestRequestByDriverId = new Map();

  latestRequests.forEach((request) => {
    const key = String(request.driver_id || '');
    if (key && !latestRequestByDriverId.has(key)) {
      latestRequestByDriverId.set(key, request);
    }
  });

  return {
    results: groups.map((row) => {
      const driver = byId.get(String(row._id));
      const latestRequest = latestRequestByDriverId.get(String(row._id));
      return {
        driver_id: row._id,
        latest_request_id: latestRequest?._id || null,
        last_request_at: row.last_request_at,
        pending_count: Number(row.pending_count || 0),
        pending_amount: Number(row.pending_amount || 0),
        driver: driver
          ? {
            _id: driver._id,
            name: driver.name || '',
            mobile: driver.phone || '',
            email: driver.email || '',
            driver_code: driver.referralCode || (driver.phone ? `DRV${String(driver.phone).slice(-4)}${String(driver._id || '').slice(-6).toUpperCase()}`.replace(/\W/g, '') : ''),
            referralCode: driver.referralCode || '',
            bankDetails: {
              accountHolderName:
                latestRequest?.bank_details_snapshot?.accountHolderName || driver.bankDetails?.accountHolderName || '',
              upiId: latestRequest?.bank_details_snapshot?.upiId || driver.bankDetails?.upiId || '',
              qrCodeImage: latestRequest?.bank_details_snapshot?.qrCodeImage || driver.bankDetails?.qrCodeImage || '',
              accountNumber:
                latestRequest?.bank_details_snapshot?.accountNumber || driver.bankDetails?.accountNumber || '',
              ifsc: latestRequest?.bank_details_snapshot?.ifsc || driver.bankDetails?.ifsc || '',
              branchName: latestRequest?.bank_details_snapshot?.branchName || driver.bankDetails?.branchName || '',
              updatedAt:
                latestRequest?.bank_details_snapshot?.updatedAt || driver.bankDetails?.updatedAt || null,
            },
          }
          : null,
      };
    }),
    paginator: {
      current_page: safePage,
      per_page: safeLimit,
      total,
      last_page: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
};

export const listDriverWithdrawals = async ({ driverId, page = 1, limit = 50 }) => {
  const safePage = Number(page) || 1;
  const safeLimit = Number(limit) || 50;
  const start = (safePage - 1) * safeLimit;

  const driver = await Driver.findById(driverId).lean();
  if (!driver) {
    throw new ApiError(404, 'Driver not found');
  }

  const [items, total] = await Promise.all([
    WithdrawalRequest.find({ driver_id: driver._id }).sort({ createdAt: -1 }).skip(start).limit(safeLimit).lean(),
    WithdrawalRequest.countDocuments({ driver_id: driver._id }),
  ]);

  return {
    driver: {
      _id: driver._id,
      name: driver.name || '',
      mobile: driver.phone || '',
      email: driver.email || '',
      city: driver.city || '',
      vehicle_number: driver.vehicleNumber || '',
      vehicle_type: driver.vehicleType || '',
      register_for: driver.registerFor || '',
      wallet: await serializeDriverWallet(driver),
      bankDetails: {
        accountHolderName: driver.bankDetails?.accountHolderName || '',
        upiId: driver.bankDetails?.upiId || '',
        qrCodeImage: driver.bankDetails?.qrCodeImage || '',
        accountNumber: driver.bankDetails?.accountNumber || '',
        ifsc: driver.bankDetails?.ifsc || '',
        branchName: driver.bankDetails?.branchName || '',
        updatedAt: driver.bankDetails?.updatedAt || null,
      },
    },
    results: items.map((item) => ({
      _id: item._id,
      amount: Number(item.amount || 0),
      requested_currency: 'INR',
      status: item.status || 'pending',
      payment_method: item.payment_method || '',
      bank_details_snapshot: {
        accountHolderName: item.bank_details_snapshot?.accountHolderName || '',
        upiId: item.bank_details_snapshot?.upiId || '',
        qrCodeImage: item.bank_details_snapshot?.qrCodeImage || '',
        accountNumber: item.bank_details_snapshot?.accountNumber || '',
        ifsc: item.bank_details_snapshot?.ifsc || '',
        branchName: item.bank_details_snapshot?.branchName || '',
        updatedAt: item.bank_details_snapshot?.updatedAt || null,
      },
      createdAt: item.createdAt,
    })),
    paginator: {
      current_page: safePage,
      per_page: safeLimit,
      total,
      last_page: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
};

export const getDriverWithdrawalContextByRequestId = async ({ requestId, page = 1, limit = 50 }) => {
  const request = await WithdrawalRequest.findById(requestId).lean();

  if (!request || !request.driver_id) {
    throw new ApiError(404, 'Withdrawal request not found');
  }

  return listDriverWithdrawals({
    driverId: request.driver_id,
    page,
    limit,
  });
};

export const approveDriverWithdrawalRequest = async (requestId, adminId = null) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const request = await WithdrawalRequest.findById(requestId).session(session);
    if (!request || !request.driver_id) {
      throw new ApiError(404, 'Withdrawal request not found');
    }

    if (request.status !== 'pending') {
      throw new ApiError(400, 'Only pending withdrawal requests can be approved');
    }

    const driver = await Driver.findById(request.driver_id).session(session);
    if (!driver) {
      throw new ApiError(404, 'Driver not found');
    }

    const requestAmount = Math.round(Number(request.amount || 0) * 100) / 100;
    const currentBalance = Math.round(Number(driver.wallet?.balance || 0) * 100) / 100;

    if (!Number.isFinite(requestAmount) || requestAmount <= 0) {
      throw new ApiError(400, 'Withdrawal request amount is invalid');
    }

    if (currentBalance < requestAmount) {
      throw new ApiError(400, 'Driver wallet balance is not enough for this withdrawal');
    }

    const walletResult = await applyDriverWalletAdjustment({
      driverId: driver._id,
      amount: -requestAmount,
      type: 'adjustment',
      description: 'Driver withdrawal approved by admin',
      metadata: {
        withdrawalRequestId: String(request._id),
        approvedBy: adminId ? String(adminId) : null,
        paymentMethod: request.payment_method || 'bank_transfer',
      },
      session,
    });

    request.status = 'completed';
    await request.save({ session });

    await session.commitTransaction();

    emitToDriver(driver._id, 'driver:wallet:updated', {
      wallet: walletResult.wallet,
      transaction: walletResult.transaction,
    });

    return {
      request: {
        _id: request._id,
        driver_id: request.driver_id,
        amount: requestAmount,
        payment_method: request.payment_method || '',
        status: request.status,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
      },
      wallet: walletResult.wallet,
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

export const rejectDriverWithdrawalRequest = async (requestId) => {
  const request = await WithdrawalRequest.findById(requestId);
  if (!request || !request.driver_id) {
    throw new ApiError(404, 'Withdrawal request not found');
  }

  if (request.status !== 'pending') {
    throw new ApiError(400, 'Only pending withdrawal requests can be rejected');
  }

  request.status = 'cancelled';
  await request.save();

  return {
    request: {
      _id: request._id,
      driver_id: request.driver_id,
      amount: Number(request.amount || 0),
      payment_method: request.payment_method || '',
      status: request.status,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    },
  };
};

export const getDriverWalletHistory = async (driverId) => {
  const transactions = await WalletTransaction.find({ driverId }).sort({ createdAt: -1 }).lean();
  return { results: transactions, total: transactions.length };
};

export const adjustDriverWallet = async (id, payload = {}) => {
  const amount = Number(payload.amount || 0);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new ApiError(400, 'Amount must be 0 or greater');
  }

  const operation = String(payload.operation || 'credit').toLowerCase();
  if (!['credit', 'debit', 'set'].includes(operation)) {
    throw new ApiError(400, 'Operation must be credit, debit, or set');
  }

  const normalizedAmount = Math.round(amount * 100) / 100;
  const description = payload.description || `Admin adjustment (${operation})`;

  const driver = await Driver.findById(id);
  if (!driver) {
    throw new ApiError(404, 'Driver not found');
  }

  const currentBalance = Number(driver.wallet?.balance || 0);
  const cashLimit = Number(driver.wallet?.cashLimit ?? 500);

  let nextBalance;
  let signedAmount;
  if (operation === 'set') {
    nextBalance = normalizedAmount;
    signedAmount = Math.round((nextBalance - currentBalance) * 100) / 100;
  } else if (operation === 'credit') {
    signedAmount = normalizedAmount;
    nextBalance = Math.round((currentBalance + signedAmount) * 100) / 100;
  } else {
    signedAmount = -normalizedAmount;
    nextBalance = Math.round((currentBalance + signedAmount) * 100) / 100;
  }

  const isBlockedAfter = nextBalance < -cashLimit;

  driver.wallet = driver.wallet || {};
  driver.wallet.balance = nextBalance;
  driver.wallet.cashLimit = cashLimit;
  driver.wallet.isBlocked = isBlockedAfter;
  driver.wallet.updatedAt = new Date();
  driver.markModified('wallet');
  await driver.save();

  await WalletTransaction.create({
    driverId: id,
    type: 'adjustment',
    amount: signedAmount,
    balanceBefore: currentBalance,
    balanceAfter: nextBalance,
    cashLimit,
    isBlockedAfter,
    description,
    metadata: {
      source: 'admin',
      operation,
      rawAmount: normalizedAmount,
    },
  });

  return { balance: Number(nextBalance.toFixed(2)), driverId: String(driver._id) };
};

export const listDriverWalletHistory = async (id) => {
  const driver = await Driver.findById(id).lean();

  if (!driver) {
    throw new ApiError(404, 'Driver not found');
  }

  const transactions = await WalletTransaction.find({ driverId: id })
    .sort({ createdAt: -1 })
    .lean();

  return {
    balance: Number(driver.wallet?.balance || 0),
    results: transactions.map(t => ({
      _id: String(t._id),
      amount: t.amount,
      type: t.metadata?.operation || t.kind || (t.amount < 0 ? 'debit' : 'credit'),
      description: t.description || t.title || '',
      createdAt: t.createdAt,
    })),
  };
};

export const listDeletedDrivers = async ({ page = 1, limit = 50 }) => {
  const safePage = Number(page) || 1;
  const safeLimit = Number(limit) || 50;
  const start = (safePage - 1) * safeLimit;

  const [drivers, total] = await Promise.all([
    Driver.find({ deletedAt: { $ne: null } })
      .select(DRIVER_LIST_SELECT)
      .sort({ deletedAt: -1, createdAt: -1 })
      .skip(start)
      .limit(safeLimit)
      .lean(),
    Driver.countDocuments({ deletedAt: { $ne: null } }),
  ]);

  return {
    results: drivers.map(serializeDriverListItem),
    paginator: {
      current_page: safePage,
      per_page: safeLimit,
      total,
      last_page: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
};

export const listDriverDeletionRequests = async ({ page = 1, limit = 50, status = 'pending' } = {}) => {
  const safePage = Number(page) || 1;
  const safeLimit = Number(limit) || 50;
  const requestedStatus = String(status || 'pending').toLowerCase();
  const start = (safePage - 1) * safeLimit;
  const statusQuery =
    requestedStatus === 'all'
      ? { $in: ['pending', 'requested', 'approved', 'rejected'] }
      : requestedStatus === 'pending'
      ? { $in: ['pending', 'requested'] }
      : requestedStatus;

  const query = {
    'deletionRequest.status': statusQuery,
    deletedAt: null,
  };

  const [drivers, total] = await Promise.all([
    Driver.find(query)
      .select(DRIVER_LIST_SELECT)
      .sort({ 'deletionRequest.requestedAt': -1, createdAt: -1 })
      .skip(start)
      .limit(safeLimit)
      .lean(),
    Driver.countDocuments(query),
  ]);

  return {
    results: drivers.map(serializeDriverListItem),
    paginator: {
      current_page: safePage,
      per_page: safeLimit,
      total,
      last_page: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
};

export const approveDriverDeletionRequest = async (id, adminId) => {
  const now = new Date();
  const driver = await Driver.findOneAndDelete(
    { _id: id, deletedAt: null, 'deletionRequest.status': 'pending' },
  );

  if (!driver) throw new ApiError(404, 'Pending driver deletion request not found');

  const removedDriver = driver.toObject ? driver.toObject() : driver;

  return serializeDriver({
    ...removedDriver,
    deletedAt: now,
    approve: false,
    status: 'inactive',
    deletion_reason: 'driver_delete_request',
    deletionRequest: {
      ...(removedDriver.deletionRequest || {}),
      status: 'approved',
      reviewedAt: now,
      reviewedBy: adminId || null,
      adminNote: '',
    },
  });
};

export const rejectDriverDeletionRequest = async (id, payload = {}, adminId) => {
  const now = new Date();
  const adminNote = String(payload.adminNote || payload.note || '').trim();
  const driver = await Driver.findOneAndUpdate(
    { _id: id, deletedAt: null, 'deletionRequest.status': 'pending' },
    {
      $set: {
        approve: true,
        status: 'approved',
        'deletionRequest.status': 'rejected',
        'deletionRequest.reviewedAt': now,
        'deletionRequest.reviewedBy': adminId || null,
        'deletionRequest.adminNote': adminNote,
      },
    },
    { returnDocument: 'after', runValidators: true },
  );

  if (!driver) throw new ApiError(404, 'Pending driver deletion request not found');
  return serializeDriver(driver.toObject());
};

export const restoreDeletedDriver = async (id) => {
  const driver = await Driver.findOneAndUpdate(
    { _id: id, deletedAt: { $ne: null } },
    { $set: { deletedAt: null } },
    { returnDocument: 'after' },
  );

  if (!driver) {
    throw new ApiError(404, 'Deleted driver not found');
  }

  return serializeDriver(driver.toObject ? driver.toObject() : driver);
};

export const permanentlyDeleteDeletedDriver = async (id) => {
  const deleted = await Driver.findOneAndDelete({ _id: id, deletedAt: { $ne: null } });
  if (!deleted) {
    throw new ApiError(404, 'Deleted driver not found');
  }
  return true;
};

export const updateDriver = async (id, payload, currentAdmin = null) => {
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'drivers.view', 'drivers');
    const existingDriver = await Driver.findById(id).select('service_location_id').lean();
    if (!existingDriver) {
      throw new ApiError(404, 'Driver not found');
    }
    assertServiceLocationAccess(currentAdmin, existingDriver.service_location_id);
  }

  const update = {};

  if (payload.name !== undefined) {
    update.name = String(payload.name || '').trim();
  }

  const phoneValue = payload.phone ?? payload.mobile;
  if (phoneValue !== undefined) {
    update.phone = String(phoneValue || '').trim();
  }

  if (payload.email !== undefined) {
    update.email = String(payload.email || '').trim();
  }

  if (payload.gender !== undefined) {
    update.gender = String(payload.gender || '').trim();
  }

  const transportTypeValue =
    payload.transport_type ?? payload.transportType ?? payload.register_for ?? payload.registerFor;
  if (transportTypeValue !== undefined) {
    update.registerFor = normalizeDriverRegisterFor(transportTypeValue);
  }

  const vehicleTypeValue = payload.vehicle_type ?? payload.vehicleType ?? payload.car_type;
  if (vehicleTypeValue !== undefined) {
    update.vehicleType = String(vehicleTypeValue || '').trim().toLowerCase() || 'car';
  }

  const vehicleTypeId =
    payload.vehicle_type_id ?? payload.vehicleTypeId ?? payload.vehicleType?._id ?? payload.vehicleType?.id;
  if (vehicleTypeId !== undefined) {
    update.vehicleTypeId =
      vehicleTypeId && mongoose.isValidObjectId(vehicleTypeId) ? toObjectId(vehicleTypeId) : null;
  }

  if (payload.vehicle_make !== undefined || payload.vehicleMake !== undefined || payload.car_make !== undefined) {
    update.vehicleMake = String(payload.vehicle_make ?? payload.vehicleMake ?? payload.car_make ?? '').trim();
  }

  if (payload.vehicle_model !== undefined || payload.vehicleModel !== undefined || payload.car_model !== undefined) {
    update.vehicleModel = String(payload.vehicle_model ?? payload.vehicleModel ?? payload.car_model ?? '').trim();
  }

  if (payload.vehicle_color !== undefined || payload.vehicleColor !== undefined || payload.car_color !== undefined) {
    update.vehicleColor = String(payload.vehicle_color ?? payload.vehicleColor ?? payload.car_color ?? '').trim();
  }

  if (payload.vehicle_number !== undefined || payload.vehicleNumber !== undefined || payload.car_number !== undefined) {
    update.vehicleNumber = String(payload.vehicle_number ?? payload.vehicleNumber ?? payload.car_number ?? '').trim();
  }

  const serviceLocationValue = payload.service_location_id ?? payload.area ?? payload.service_location;
  if (serviceLocationValue !== undefined) {
    if (currentAdmin && serviceLocationValue) {
      assertServiceLocationAccess(currentAdmin, serviceLocationValue);
    }
    update.service_location_id =
      serviceLocationValue && mongoose.isValidObjectId(serviceLocationValue)
        ? toObjectId(serviceLocationValue)
        : null;
  }

  const zoneValue = payload.zone_id ?? payload.zoneId ?? payload.zone;
  if (zoneValue !== undefined) {
    if (currentAdmin && zoneValue) {
      await assertZoneAccess(currentAdmin, zoneValue);
    }

    if (zoneValue && mongoose.isValidObjectId(zoneValue)) {
      const zone = await Zone.findById(zoneValue).select('_id service_location_id').lean();
      if (!zone) {
        throw new ApiError(404, 'Zone not found');
      }
      update.zoneId = toObjectId(zone._id);
      update.service_location_id = zone.service_location_id ? toObjectId(zone.service_location_id) : null;
    } else {
      update.zoneId = null;
    }
  }

  if (payload.country !== undefined) {
    update.country = payload.country || null;
  }

  if ('approve' in payload) {
    update.approve = Boolean(payload.approve);
  }

  if (payload.status !== undefined) {
    update.status = String(payload.status);
  } else if ('approve' in payload) {
    update.status = update.approve ? 'approved' : 'pending';
  }

  if (payload.documents !== undefined) {
    update.documents = payload.documents;
  }

  // Admin verification of the driver's OWN payment UPI/QR (the one shown to
  // riders at ride-end). Accepts 'verified' | 'rejected' | 'pending'. Dot-paths
  // ensure only these subfields change — account number / IFSC stay untouched.
  if (payload.paymentUpiVerificationStatus !== undefined) {
    const upiStatus = String(payload.paymentUpiVerificationStatus || '').trim().toLowerCase();
    if (!['verified', 'rejected', 'pending', ''].includes(upiStatus)) {
      throw new ApiError(400, 'paymentUpiVerificationStatus must be verified, rejected, or pending');
    }
    update['bankDetails.upiVerificationStatus'] = upiStatus;
    update['bankDetails.upiVerifiedAt'] = upiStatus === 'verified' ? new Date() : null;
  }

  // Admin can also EDIT the driver's payment UPI id and/or QR scanner image.
  // Dot-paths keep account number / IFSC untouched. A data-URL QR is uploaded
  // to /uploads; an http URL (or empty string to clear) is stored as-is.
  if (payload.paymentUpiId !== undefined) {
    update['bankDetails.upiId'] = String(payload.paymentUpiId || '').trim();
  }
  if (payload.paymentQrImage !== undefined) {
    const qr = String(payload.paymentQrImage || '').trim();
    if (qr.startsWith('data:')) {
      const uploaded = await uploadDataUrl({
        dataUrl: qr,
        folder: 'driver-upi-qr',
        publicIdPrefix: `driver-upi-${id}`,
      });
      update['bankDetails.qrCodeImage'] = uploaded.secureUrl;
    } else {
      update['bankDetails.qrCodeImage'] = qr;
    }
  }

  if (payload.onboarding !== undefined) {
    update.onboarding = payload.onboarding;
  }

  const driver = await Driver.findByIdAndUpdate(id, update, { returnDocument: 'after' });
  if (!driver) throw new ApiError(404, 'Driver not found');

  // Approval is the trigger for the one-time joining bonus. Deliberately not
  // awaited into the failure path of the approval itself: the driver is already
  // approved by this point, so throwing here would tell the admin the approval
  // failed when it did not. grantDriverJoiningBonus releases its claim on error,
  // so the credit is retried the next time approval is saved.
  if (update.approve === true) {
    const bonusResult = await grantDriverJoiningBonus({ driverId: driver._id, grantedBy: currentAdmin?._id || null })
      .catch((error) => {
        console.error('Driver joining bonus failed', driver._id, error.message);
        return null;
      });

  }

  return serializeDriver(driver);
};

export const updateDriverPassword = async (id, password) => {
  if (!password || String(password).length < 4) {
    throw new ApiError(400, 'Password must be at least 4 characters');
  }
  const driver = await Driver.findByIdAndUpdate(
    id,
    {
      password: await hashPassword(password),
      password_last_updated_at: new Date(),
    },
    { returnDocument: 'after' },
  );

  if (!driver) throw new ApiError(404, 'Driver not found');
  return serializeDriver(driver);
};

export const deleteDriver = async (id) => {
  const deleted = await Driver.findByIdAndDelete(id);
  if (!deleted) {
    throw new ApiError(404, 'Driver not found');
  }
  return true;
};

export const getDriverById = async (id, currentAdmin = null) => {
  const driver = await Driver.findById(id)
    .populate({ path: 'zoneId', select: 'name service_location_id', strictPopulate: false })
    .lean();
  if (!driver) {
    throw new ApiError(404, 'Driver not found');
  }
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'drivers.view', 'drivers');
    assertServiceLocationAccess(currentAdmin, driver.service_location_id);
  }
  return serializeDriver(driver);
};

/**
 * The admin-configured name for each stored document key.
 *
 * A driver's documents are stored under the key the app uploaded them with -
 * `panCard`, `nocFront` - while the admin names the document type separately.
 * Those two drifted apart: the type named "Insurance" is configured with the
 * key `panCard`, and "RC" with `nocFront`. Showing the raw key therefore
 * labelled an insurance paper "Pan Card" on the screen an admin approves
 * drivers from.
 *
 * Built from the configured types, so renaming a document type in the admin
 * renames it everywhere it is shown.
 */
const buildDriverDocumentLabelMap = async () => {
  const templates = await DriverNeededDocument.find({}, { name: 1, key: 1, front_key: 1, back_key: 1, verification_type: 1 }).lean();
  const map = new Map();

  for (const template of templates) {
    const name = String(template.name || '').trim();
    if (!name) continue;

    for (const key of [template.key, template.front_key, template.back_key]) {
      const normalized = String(key || '').trim();
      if (!normalized) continue;
      // Front and back of the same document are told apart, so a two-sided
      // document does not show as the same title twice.
      const isBack = normalized === String(template.back_key || '').trim() && normalized !== String(template.key || '').trim();
      const isFront = normalized === String(template.front_key || '').trim() && normalized !== String(template.key || '').trim();
      map.set(normalized.toLowerCase(), {
        label: isBack ? `${name} (back)` : isFront ? `${name} (front)` : name,
        // Sent so the screen stops inferring the kind of check from the key:
        // `panCard` holds the insurance paper here, and guessing made it say
        // "PAN Verify".
        verificationType: String(template.verification_type || 'none').trim().toLowerCase(),
      });
    }
  }

  return map;
};

const labelDriverDocuments = (documents, labels) => {
  if (!documents || typeof documents !== 'object') return documents;

  const withLabel = (key, value) => {
    if (!value || typeof value !== 'object') return value;
    const template = labels.get(String(key || '').trim().toLowerCase());
    if (!template) return value;
    return { ...value, label: template.label, verification_type: template.verificationType, hasTemplate: true };
  };

  if (Array.isArray(documents)) {
    return documents.map((doc) => withLabel(doc?.fileName || doc?.name, doc));
  }

  return Object.fromEntries(
    Object.entries(documents).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.map((doc) => withLabel(key, doc)) : withLabel(key, value),
    ]),
  );
};

const buildDriverMonthlyChart = (rides = []) => {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const months = [];
  const earnings = [];
  const completed = [];
  const cancelled = [];

  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mLabel = monthNames[d.getMonth()];
    const y = d.getFullYear();
    const m = d.getMonth();

    const mRides = rides.filter((r) => {
      const rd = r.completedAt || r.createdAt;
      if (!rd) return false;
      const date = new Date(rd);
      return date.getFullYear() === y && date.getMonth() === m;
    });

    const mCompleted = mRides.filter((r) => String(r.status || '').toLowerCase() === 'completed');
    const mCancelled = mRides.filter((r) => String(r.status || '').toLowerCase() === 'cancelled');
    const mEarnings = mCompleted.reduce((sum, r) => sum + Number(r.driverEarnings || (Number(r.fare || 0) - Number(r.commissionAmount || 0))), 0);

    months.push(mLabel);
    earnings.push(Math.round(mEarnings * 100) / 100);
    completed.push(mCompleted.length);
    cancelled.push(mCancelled.length);
  }

  return {
    months,
    earnings,
    trips: { completed, cancelled },
  };
};

export const getDriverProfile = async (id) => {
  const driver = await Driver.findById(id).lean();
  if (!driver) {
    throw new ApiError(404, 'Driver not found');
  }

  const [rides, walletTransactions] = await Promise.all([
    Ride.find({ driverId: driver._id }).sort({ createdAt: -1 }).lean(),
    WalletTransaction.find({ driverId: driver._id }).sort({ createdAt: -1 }).lean(),
  ]);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const isCompleted = (ride) => String(ride.status || '').toLowerCase() === 'completed';
  const isCancelled = (ride) => String(ride.status || '').toLowerCase() === 'cancelled';
  const isOngoing = (ride) => !isCompleted(ride) && !isCancelled(ride);

  const completedRides = rides.filter(isCompleted);
  const cancelledRides = rides.filter(isCancelled);
  const ongoingRides = rides.filter(isOngoing);
  const todayRides = rides.filter((ride) => ride.createdAt && ride.createdAt >= startOfDay);
  const todayCompleted = completedRides.filter((ride) =>
    (ride.completedAt || ride.createdAt) >= startOfDay
  );
  const todayCancelled = cancelledRides.filter((ride) =>
    (ride.completedAt || ride.createdAt) >= startOfDay
  );

  const sum = (items, field) =>
    items.reduce((total, item) => total + Number(item?.[field] || 0), 0);

  const totalEarnings = sum(completedRides, 'fare');
  const todayEarnings = sum(todayCompleted, 'fare');
  const driverEarnings = completedRides.reduce((total, ride) => {
    const fare = Number(ride?.fare || 0);
    const commission = Number(ride?.commissionAmount || 0);
    const earning = Number(ride?.driverEarnings ?? Math.max(fare - commission, 0));
    return total + earning;
  }, 0);
  const adminCommission = completedRides.reduce((total, ride) => {
    const fare = Number(ride?.fare || 0);
    const explicitCommission = ride?.commissionAmount;
    const fallbackCommission = Math.max(fare - Number(ride?.driverEarnings || 0), 0);
    return total + Number(explicitCommission ?? fallbackCommission);
  }, 0);
  const byCash = sum(completedRides.filter((r) => r.paymentMethod === 'cash'), 'fare');
  const byCard = sum(completedRides.filter((r) => r.paymentMethod === 'online'), 'fare');
  const spendAmount = walletTransactions.reduce((total, item) => {
    const amount = Number(item?.amount || 0);
    return amount < 0 ? total + Math.abs(amount) : total;
  }, 0);
  const creditAmount = walletTransactions.reduce((total, item) => {
    const amount = Number(item?.amount || 0);
    return amount > 0 ? total + amount : total;
  }, 0);
  const balanceAmount = Number(driver?.wallet?.balance || 0);
  const cashLimit = Number(driver?.wallet?.cashLimit ?? 500);
  const isWalletBlocked = Boolean(driver?.wallet?.isBlocked);

  const driverLocation = driver.location?.coordinates || [];
  const lastRideLocation = rides.find((ride) => Array.isArray(ride.lastDriverLocation?.coordinates));
  const coordinates = driverLocation.length === 2 ? driverLocation : (lastRideLocation?.lastDriverLocation?.coordinates || []);

  const [lng, lat] = coordinates;
  const hasValidLocation = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

  const documentLabels = await buildDriverDocumentLabelMap();

  return {
    ...serializeDriver(driver),
    approvalStatus: driver.approvalStatus || (driver.approve ? 'approved' : 'pending'),
    vehicleType: driver.vehicleType || driver.registerFor || '',
    documents: labelDriverDocuments(driver.documents || {}, documentLabels),
    joined_at: driver.createdAt ? new Date(driver.createdAt).toLocaleString('en-IN') : 'N/A',
    vehicle: {
      type: driver.vehicleType || driver.registerFor || '',
      make: driver.vehicleMake || '',
      model: driver.vehicleModel || '',
      color: driver.vehicleColor || '',
      number: driver.vehicleNumber || '',
    },
    image: driver.profile_image || driver.avatar || '',
    online_selfie: driver.onlineSelfie || {},
    vehicle_image: driver.vehicleImage || 'https://img.freepik.com/free-vector/yellow-passenger-transport-taxi-car_1017-4886.jpg',
    stats: {
      total_trips: rides.length,
      completed_trips: completedRides.length,
      cancelled_trips: cancelledRides.length,
      ongoing_trips: ongoingRides.length,
      today_trips: todayRides.length,
      today_cancelled: todayCancelled.length,
    },
    earnings: {
      today_earnings: Number(todayEarnings.toFixed(2)),
      total_earnings: Number(totalEarnings.toFixed(2)),
      driver_earnings: Number(driverEarnings.toFixed(2)),
      admin_commission: Number(adminCommission.toFixed(2)),
      by_cash: Number(byCash.toFixed(2)),
      by_wallet: 0,
      by_card: Number(byCard.toFixed(2)),
      spend_amount: Number(spendAmount.toFixed(2)),
      balance_amount: Number(balanceAmount.toFixed(2)),
    },
    wallet: {
      balance: Number(balanceAmount.toFixed(2)),
      cash_limit: Number(cashLimit.toFixed(2)),
      is_blocked: isWalletBlocked,
      total_credits: Number(creditAmount.toFixed(2)),
      total_debits: Number(spendAmount.toFixed(2)),
      transaction_count: walletTransactions.length,
    },
    location: hasValidLocation ? { lat, lng } : null,
    requests: await Promise.all(
      rides.map(async (ride) => {
        const user = ride.userId ? await User.findById(ride.userId).select('name phone email').lean() : null;
        const paymentInfo = describeRidePayment(ride);
        return {
          _id: String(ride._id),
          request_id: String(ride._id),
          date: ride.createdAt,
          user_name: user?.name || ride.parcel?.senderName || 'Rider',
          user_phone: user?.phone || '',
          driver_name: driver.name || 'Driver',
          trip_status: String(ride.status || 'upcoming').toLowerCase(),
          paid: paymentInfo.status === 'paid',
          payment_option: paymentInfo.method || ride.paymentMethod || 'cash',
          fare: Number(ride.fare || 0),
          driver_earnings: Number(ride.driverEarnings || 0),
          commission_amount: Number(ride.commissionAmount || 0),
          pickup_address: ride.pickupAddress || '',
          drop_address: ride.dropAddress || '',
          service_type: ride.serviceType || 'ride',
        };
      })
    ),
    withdrawals: (await WithdrawalRequest.find({ driver_id: driver._id }).sort({ createdAt: -1 }).lean()).map((w) => ({
      _id: String(w._id),
      date: w.createdAt,
      name: driver.name || '',
      mobile: driver.phone || '',
      requested_amount: Number(w.amount || 0),
      status: String(w.status || 'pending').toLowerCase(),
    })),
    reviews: await Promise.all(
      rides
        .filter((r) => r.feedback?.rating || r.feedback?.comment)
        .map(async (r) => {
          const user = r.userId ? await User.findById(r.userId).select('name phone email').lean() : null;
          return {
            _id: String(r._id),
            request_id: String(r._id),
            date: r.completedAt || r.createdAt,
            rating: Number(r.feedback?.rating || 0),
            comment: r.feedback?.comment || '',
            user_name: user?.name || r.parcel?.senderName || 'Rider',
          };
        })
    ),
    chart: buildDriverMonthlyChart(rides),
  };
};






export const listServiceLocations = async (currentAdmin = null) => {
  await ensureServiceLocationsSeeded();
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'service_locations.view', 'service locations');
  }
  const query = currentAdmin ? buildServiceLocationScopeQuery(currentAdmin) : {};
  return ServiceLocation.find(query).sort({ createdAt: -1 }).lean();
};

export const listCountries = async () => {
  const locations = await listServiceLocations();
  const countriesFromLocations = locations
    .map((item) => item.country)
    .filter(Boolean)
    .map((country) =>
      typeof country === 'object'
        ? country
        : {
          _id: nextId(),
          name: String(country),
          code: String(country).slice(0, 2).toUpperCase(),
        },
    );

  const merged = [
    { _id: nextId(), name: 'India', code: 'IN' },
    { _id: nextId(), name: 'United Arab Emirates', code: 'AE' },
    { _id: nextId(), name: 'United Kingdom', code: 'GB' },
    { _id: nextId(), name: 'United States', code: 'US' },
    ...countriesFromLocations,
  ];

  return merged.filter(
    (country, index, list) =>
      list.findIndex((item) => item.name?.toLowerCase() === country.name?.toLowerCase()) === index,
  );
};

export const createServiceLocation = async (payload, currentAdmin = null) => {
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'service_locations.view', 'service locations');
    if (!isSuperAdmin(currentAdmin)) {
      throw new ApiError(403, 'Only the superadmin can create service locations');
    }
  }

  if (!payload.name?.trim()) {
    throw new ApiError(400, 'Service location name is required');
  }

  await ensureServiceLocationsSeeded();
  const persistedLocation = await ServiceLocation.create(normalizeServiceLocationPayload(payload));
  return persistedLocation.toObject();

  const location = {
    _id: nextId(),
    name: payload.name.trim(),
    service_location_name: payload.name.trim(),
    address: payload.address || '',
    country: payload.country || 'India',
    currency_name: payload.currency_name || 'Indian Rupee',
    currency_symbol: payload.currency_symbol || '₹',
    currency_code: payload.currency_code || 'INR',
    timezone: payload.timezone || 'Asia/Kolkata',
    unit: payload.unit || 'km',
    latitude: Number(payload.latitude || 22.7196),
    longitude: Number(payload.longitude || 75.8577),
    status: payload.status || 'active',
    active: payload.status ? payload.status === 'active' : true,
    createdAt: new Date(),
  };

  state.serviceLocations.unshift(location);
  await state.save();
  return location;
};

export const updateServiceLocation = async (id, payload, currentAdmin = null) => {
  await ensureServiceLocationsSeeded();
  const persistedLocation = await ServiceLocation.findById(id);
  if (!persistedLocation) {
    throw new ApiError(404, 'Service location not found');
  }
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'service_locations.view', 'service locations');
    assertServiceLocationAccess(currentAdmin, persistedLocation._id);
  }
  Object.assign(persistedLocation, normalizeServiceLocationPayload(payload, persistedLocation.toObject()));
  await persistedLocation.save();
  return persistedLocation.toObject();

  const state = await ensureAdminState();
  const location = findById(state.serviceLocations, id);

  if (!location) {
    throw new ApiError(404, 'Service location not found');
  }

  Object.assign(location, payload, {
    name: payload.name?.trim() || location.name,
    service_location_name: payload.name?.trim() || location.service_location_name,
    latitude: payload.latitude !== undefined ? Number(payload.latitude) : location.latitude,
    longitude: payload.longitude !== undefined ? Number(payload.longitude) : location.longitude,
    active: payload.status !== undefined ? payload.status === 'active' : location.active,
    status: payload.status || location.status,
  });

  await state.save();
  return location;
};

export const deleteServiceLocation = async (id, currentAdmin = null) => {
  await ensureServiceLocationsSeeded();
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'service_locations.view', 'service locations');
    assertServiceLocationAccess(currentAdmin, id);
  }
  const deleted = await ServiceLocation.findByIdAndDelete(id);
  if (!deleted) {
    throw new ApiError(404, 'Service location not found');
  }
  return true;

  const state = await ensureAdminState();
  state.serviceLocations = removeById(state.serviceLocations, id);
  await state.save();
  return true;
};

export const listNearbyServiceLocations = async ({ latitude, longitude, maxDistance = 50000, limit = 20 }) => {
  await ensureServiceLocationsSeeded();

  const lat = Number(latitude);
  const lng = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new ApiError(400, 'Valid latitude and longitude are required');
  }

  return ServiceLocation.find({
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [lng, lat],
        },
        $maxDistance: Number(maxDistance),
      },
    },
  })
    .limit(Number(limit) || 20)
    .lean();
};

export const listRideModules = async () => RideModule.find().sort({ createdAt: -1 }).lean();

const formatRidePointLabel = (point, fallback = 'Unknown') => {
  const [lng, lat] = point?.coordinates || [];

  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    return `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`;
  }

  return fallback;
};

/// How a trip was actually paid, for the Trips page: the method as a badge
/// key (CASH / ONLINE / WALLET / SUBSCRIPTION) plus a line of detail. The
/// ride row used to print CASH for every ride, and the others the booking
/// method, so a cash booking paid online still read "cash".
const tripPaymentFields = (ride) => {
  const paid = describeRidePayment(ride);
  return {
    paymentOption: paid.method.toUpperCase(),
    paymentDetail: paid.detail,
    paymentReference: paid.reference,
    paymentStatus: paid.status,
  };
};

const toAdminRideRow = (ride) => {
  const isIntercity = ride.serviceType === 'intercity' || ride.serviceType === 'outstation' || ride.trip_category?.category === 'outstation';
  const isParcel = ride.serviceType === 'parcel';

  let prefix = 'REQ_';
  if (isParcel) prefix = 'DEL_';
  else if (isIntercity) prefix = 'INT_';
  const requestCode = `${prefix}${String(ride._id).slice(-12).toUpperCase()}`;

  const status = String(ride.status || '').toLowerCase();
  const liveStatus = String(ride.liveStatus || '').toLowerCase();

  let tripStatus = 'UPCOMING';
  if (status === RIDE_STATUS.COMPLETED) {
    tripStatus = 'COMPLETED';
  } else if (status === RIDE_STATUS.CANCELLED) {
    tripStatus = 'CANCELLED';
  } else if (status === RIDE_STATUS.ONGOING || liveStatus === RIDE_LIVE_STATUS.STARTED) {
    tripStatus = 'ONGOING';
  } else if (
    status === RIDE_STATUS.ACCEPTED ||
    liveStatus === RIDE_LIVE_STATUS.ACCEPTED ||
    liveStatus === RIDE_LIVE_STATUS.ARRIVING ||
    liveStatus === RIDE_LIVE_STATUS.ARRIVED
  ) {
    tripStatus = 'ACCEPTED';
  } else if (status === RIDE_STATUS.SEARCHING) {
    tripStatus = 'UPCOMING';
  }

  const serviceCategory = isParcel ? 'parcel' : (isIntercity ? 'outstation' : 'ride');
  const serviceLabel = isParcel ? 'Parcel Delivery' : (isIntercity ? 'Outstation Trip' : 'City Ride');

  const intercity = ride.intercity || {};
  const parcel = ride.parcel || (ride.deliveryId?.parcel || {});

  let transportType = ride.driverId?.vehicleType || ride.vehicleIconType || 'Taxi';
  if (isParcel) {
    transportType = parcel.category || 'Parcel';
  } else if (isIntercity && intercity.vehicleName) {
    transportType = intercity.vehicleName;
  }

  const fromCity = String(intercity.fromCity || '').trim();
  const toCity = String(intercity.toCity || '').trim();
  const routeLabel = [fromCity, toCity].filter(Boolean).join(' → ');

  return {
    id: String(ride._id),
    requestId: requestCode,
    date: ride.createdAt,
    serviceType: ride.serviceType || 'ride',
    serviceCategory,
    serviceLabel,
    userName: ride.userId?.name || parcel.senderName || 'Unknown User',
    userPhone: ride.userId?.phone || parcel.senderMobile || '',
    userEmail: ride.userId?.email || '',
    driverName: ride.driverId?.name || 'Unassigned',
    driverPhone: ride.driverId?.phone || '',
    driverAssigned: !!ride.driverId,
    transportType,
    vehicleNumber: ride.driverId?.vehicleNumber || '',
    tripStatus,
    rideStatus: ride.status,
    liveStatus: ride.liveStatus,
    ...tripPaymentFields(ride),
    fare: Number(ride.fare || 0),
    baseFare: Number(ride.baseFare || 0),
    waitingCharge: Number(ride.waitingCharge || 0),
    waitingMinutes: Number(ride.waitingMinutes || 0),
    commissionAmount: Number(ride.commissionAmount || 0),
    driverEarnings: Number(ride.driverEarnings || 0),
    estimatedDistanceMeters: Number(ride.estimatedDistanceMeters || ride.route?.distanceMeters || (intercity.distance ? intercity.distance * 1000 : 0)),
    estimatedDurationMinutes: Number(ride.estimatedDurationMinutes || ride.route?.durationMinutes || 0),
    pickupLabel: ride.pickupAddress || formatRidePointLabel(ride.pickupLocation, 'Pickup'),
    dropLabel: ride.dropAddress || formatRidePointLabel(ride.dropLocation, 'Drop'),
    pickupAddress: ride.pickupAddress || '',
    dropAddress: ride.dropAddress || '',
    pickupLocation: ride.pickupLocation,
    dropLocation: ride.dropLocation,
    lastDriverLocation: ride.lastDriverLocation || null,
    scheduledAt: ride.scheduledAt || null,
    bookingSource: ride.bookingSource || 'app',
    bookingMode: ride.bookingMode || 'normal',
    otp: ride.otp || '',
    routeLabel,
    intercity: isIntercity ? {
      bookingId: intercity.bookingId || '',
      fromCity,
      toCity,
      tripType: intercity.tripType || 'one_way',
      travelDate: intercity.travelDate || '',
      returnDate: intercity.returnDate || '',
      passengers: Number(intercity.passengers || 1),
      distance: Number(intercity.distance || 0),
      vehicleName: intercity.vehicleName || '',
      pricing: intercity.pricing || null,
    } : null,
    parcel: isParcel ? {
      category: parcel.category || '',
      weight: parcel.weight || '',
      description: parcel.description || '',
      instructions: parcel.instructions || '',
      senderName: parcel.senderName || '',
      senderMobile: parcel.senderMobile || '',
      receiverName: parcel.receiverName || '',
      receiverMobile: parcel.receiverMobile || '',
      deliveryScope: parcel.deliveryScope || 'city',
      isOutstation: !!parcel.isOutstation,
      photos: Array.isArray(parcel.photos) ? parcel.photos : [],
      pickupProof: parcel.pickupProof?.url || '',
      deliveryProof: parcel.deliveryProof?.url || '',
      pickupProofAt: parcel.pickupProof?.at || null,
      deliveryProofAt: parcel.deliveryProof?.at || null,
    } : null,
    promo: ride.promo && ride.promo.code ? {
      code: ride.promo.code,
      discount_amount: Number(ride.promo.discount_amount || 0),
      fare_before_discount: Number(ride.promo.fare_before_discount || 0),
      fare_after_discount: Number(ride.promo.fare_after_discount || 0),
    } : null,
    surge: ride.surge || null,
    pricingSnapshot: ride.pricingSnapshot || null,
    createdAt: ride.createdAt,
    acceptedAt: ride.acceptedAt || null,
    arrivedAt: ride.arrivedAt || null,
    startedAt: ride.startedAt || null,
    completedAt: ride.completedAt || null,
    cancelledAt: ride.cancelledAt || null,
    cancelledBy: ride.cancelledBy || '',
    cancelReason: ride.cancelReason || '',
    feedback: ride.feedback ? {
      rating: ride.feedback.rating || null,
      comment: ride.feedback.comment || '',
      tipAmount: Number(ride.feedback.tipAmount || 0),
    } : null,
    user: ride.userId ? {
      id: String(ride.userId._id),
      name: ride.userId.name || '',
      phone: ride.userId.phone || '',
      email: ride.userId.email || '',
    } : null,
    driver: ride.driverId ? {
      id: String(ride.driverId._id),
      name: ride.driverId.name || '',
      phone: ride.driverId.phone || '',
      vehicleType: ride.driverId.vehicleType || '',
      vehicleNumber: ride.driverId.vehicleNumber || '',
    } : null,
  };
};

const toAdminDeliveryRow = (ride) => {
  const requestCode = `DEL_${String(ride._id).slice(-12).toUpperCase()}`;
  const status = String(ride.status || '').toLowerCase();
  const liveStatus = String(ride.liveStatus || '').toLowerCase();
  const parcel = ride.parcel || (ride.deliveryId?.parcel || {});

  let tripStatus = 'UPCOMING';
  if (status === RIDE_STATUS.COMPLETED) {
    tripStatus = 'COMPLETED';
  } else if (status === RIDE_STATUS.CANCELLED) {
    tripStatus = 'CANCELLED';
  } else if (
    status === RIDE_STATUS.ONGOING ||
    liveStatus === RIDE_LIVE_STATUS.STARTED ||
    liveStatus === RIDE_LIVE_STATUS.ARRIVED
  ) {
    tripStatus = 'ON_TRIP';
  } else if (status === RIDE_STATUS.ACCEPTED || liveStatus === RIDE_LIVE_STATUS.ACCEPTED || liveStatus === RIDE_LIVE_STATUS.ARRIVING) {
    tripStatus = 'ACCEPTED';
  }

  return {
    id: String(ride._id),
    requestId: requestCode,
    date: ride.createdAt,
    serviceType: 'parcel',
    serviceCategory: 'parcel',
    serviceLabel: 'Parcel Delivery',
    userName: ride.userId?.name || parcel.senderName || 'Unknown User',
    userPhone: ride.userId?.phone || parcel.senderMobile || '',
    userEmail: ride.userId?.email || '',
    driverName: ride.driverId?.name || 'Unassigned',
    driverPhone: ride.driverId?.phone || '',
    driverAssigned: !!ride.driverId,
    transportType: ride.driverId?.vehicleType || ride.vehicleIconType || parcel.category || 'Parcel',
    vehicleNumber: ride.driverId?.vehicleNumber || '',
    tripStatus,
    rideStatus: ride.status,
    liveStatus: ride.liveStatus,
    ...tripPaymentFields(ride),
    fare: Number(ride.fare || 0),
    baseFare: Number(ride.baseFare || 0),
    waitingCharge: Number(ride.waitingCharge || 0),
    waitingMinutes: Number(ride.waitingMinutes || 0),
    commissionAmount: Number(ride.commissionAmount || 0),
    driverEarnings: Number(ride.driverEarnings || 0),
    estimatedDistanceMeters: Number(ride.estimatedDistanceMeters || ride.route?.distanceMeters || 0),
    estimatedDurationMinutes: Number(ride.estimatedDurationMinutes || ride.route?.durationMinutes || 0),
    distance: ride.estimatedDistanceMeters ? `${(ride.estimatedDistanceMeters / 1000).toFixed(1)} km` : '-',
    pickupLabel: ride.pickupAddress || formatRidePointLabel(ride.pickupLocation, 'Pickup'),
    dropLabel: ride.dropAddress || formatRidePointLabel(ride.dropLocation, 'Drop'),
    pickupAddress: ride.pickupAddress || '',
    dropAddress: ride.dropAddress || '',
    pickupLocation: ride.pickupLocation,
    dropLocation: ride.dropLocation,
    parcel: {
      category: parcel.category || '',
      weight: parcel.weight || '',
      description: parcel.description || '',
      instructions: parcel.instructions || '',
      senderName: parcel.senderName || '',
      senderMobile: parcel.senderMobile || '',
      receiverName: parcel.receiverName || '',
      receiverMobile: parcel.receiverMobile || '',
      deliveryScope: parcel.deliveryScope || 'city',
      isOutstation: !!parcel.isOutstation,
      photos: Array.isArray(parcel.photos) && parcel.photos.length
        ? parcel.photos
        : (Array.isArray(ride.parcel?.photos) ? ride.parcel.photos : []),
      pickupProof: ride.parcel?.pickupProof?.url || parcel.pickupProof?.url || '',
      deliveryProof: ride.parcel?.deliveryProof?.url || parcel.deliveryProof?.url || '',
      pickupProofAt: ride.parcel?.pickupProof?.at || parcel.pickupProof?.at || null,
      deliveryProofAt: ride.parcel?.deliveryProof?.at || parcel.deliveryProof?.at || null,
    },
    userId: ride.userId?._id ? String(ride.userId._id) : (ride.userId ? String(ride.userId) : ''),
    driverId: ride.driverId?._id ? String(ride.driverId._id) : (ride.driverId ? String(ride.driverId) : ''),
    user: ride.userId ? {
      id: String(ride.userId._id),
      name: ride.userId.name || '',
      phone: ride.userId.phone || '',
      email: ride.userId.email || '',
    } : null,
    driver: ride.driverId ? {
      id: String(ride.driverId._id),
      name: ride.driverId.name || '',
      phone: ride.driverId.phone || '',
      vehicleType: ride.driverId.vehicleType || '',
      vehicleNumber: ride.driverId.vehicleNumber || '',
    } : null,
    createdAt: ride.createdAt,
    acceptedAt: ride.acceptedAt || null,
    arrivedAt: ride.arrivedAt || null,
    startedAt: ride.startedAt || null,
    completedAt: ride.completedAt || null,
    cancelledAt: ride.cancelledAt || null,
    cancelledBy: ride.cancelledBy || '',
    cancelReason: ride.cancelReason || '',
  };
};

const toAdminIntercityTripRow = (ride) => {
  return toAdminRideRow(ride);
};

const clampAdminRideListPageSize = (value, fallback = 10) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 100);
};

const buildRideStatusFilter = (tabOrStatus = 'all', variant = 'ride_requests') => {
  const normalizedTab = String(tabOrStatus || 'all').trim().toLowerCase();

  if (!normalizedTab || normalizedTab === 'all') {
    return {};
  }

  if (variant === 'ongoing_rides') {
    if (normalizedTab === 'accepted') {
      return {
        $or: [
          { status: RIDE_STATUS.ACCEPTED },
          { liveStatus: { $in: [RIDE_LIVE_STATUS.ACCEPTED, RIDE_LIVE_STATUS.ARRIVING] } },
        ],
      };
    }

    if (normalizedTab === 'ongoing') {
      return {
        $or: [
          { status: RIDE_STATUS.ONGOING },
          { liveStatus: RIDE_LIVE_STATUS.STARTED },
        ],
      };
    }

    if (normalizedTab === 'upcoming' || normalizedTab === 'searching') {
      return {
        status: RIDE_STATUS.SEARCHING,
      };
    }

    return {};
  }

  if (normalizedTab === 'completed') {
    return { status: RIDE_STATUS.COMPLETED };
  }

  if (normalizedTab === 'cancelled') {
    return { status: RIDE_STATUS.CANCELLED };
  }

  if (normalizedTab === 'upcoming' || normalizedTab === 'searching') {
    return { status: RIDE_STATUS.SEARCHING };
  }

  if (normalizedTab === 'accepted') {
    return {
      $or: [
        { status: RIDE_STATUS.ACCEPTED },
        { liveStatus: { $in: [RIDE_LIVE_STATUS.ACCEPTED, RIDE_LIVE_STATUS.ARRIVING] } },
      ],
    };
  }

  if (normalizedTab === 'on trip' || normalizedTab === 'on_trip' || normalizedTab === 'ongoing') {
    return {
      $or: [
        { status: { $in: [RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING] } },
        { liveStatus: { $in: [RIDE_LIVE_STATUS.ACCEPTED, RIDE_LIVE_STATUS.ARRIVING, RIDE_LIVE_STATUS.STARTED] } },
      ],
    };
  }

  return { status: normalizedTab };
};

const buildAdminRideSearchClauses = async (
  search = '',
  { includeParcel = false, includeIntercity = false } = {},
) => {
  const normalizedSearch = String(search || '').trim();
  if (!normalizedSearch) {
    return [];
  }

  const cleanHex = normalizedSearch.replace(/^(REQ_|DEL_|INT_)/i, '');
  const clauses = [];

  if (/^[a-f0-9]{24}$/i.test(cleanHex)) {
    clauses.push({ _id: new mongoose.Types.ObjectId(cleanHex) });
  }
  if (/^[a-f0-9]{4,24}$/i.test(cleanHex)) {
    clauses.push({
      $expr: {
        $regexMatch: {
          input: { $toString: '$_id' },
          regex: cleanHex,
          options: 'i',
        },
      },
    });
  }

  const regex = new RegExp(escapeRegex(normalizedSearch), 'i');
  const [matchedUsers, matchedDrivers] = await Promise.all([
    User.find({
      $or: [{ name: regex }, { phone: regex }],
    })
      .select('_id')
      .limit(100)
      .lean(),
    Driver.find({
      $or: [{ name: regex }, { phone: regex }, { vehicleType: regex }, { vehicleNumber: regex }],
    })
      .select('_id')
      .limit(100)
      .lean(),
  ]);

  clauses.push(
    { pickupAddress: regex },
    { dropAddress: regex },
    { vehicleIconType: regex },
  );

  if (matchedUsers.length > 0) {
    clauses.push({ userId: { $in: matchedUsers.map((item) => item._id) } });
  }

  if (matchedDrivers.length > 0) {
    clauses.push({ driverId: { $in: matchedDrivers.map((item) => item._id) } });
  }

  if (includeParcel) {
    clauses.push(
      { 'parcel.category': regex },
      { 'parcel.senderName': regex },
      { 'parcel.receiverName': regex },
      { 'parcel.senderMobile': regex },
      { 'parcel.receiverMobile': regex },
    );
  }

  if (includeIntercity) {
    clauses.push(
      { 'intercity.fromCity': regex },
      { 'intercity.toCity': regex },
      { 'intercity.tripType': regex },
      { 'intercity.travelDate': regex },
    );
  }

  return clauses;
};

const listAdminRides = async ({
  query = {},
  baseFilter = {},
  variant = 'ride_requests',
  serializer,
  includeParcel = false,
  includeIntercity = false,
}) => {
  const page = Math.max(Number(query.page || 1), 1);
  const limit = clampAdminRideListPageSize(query.limit, 10);
  const tab = String(query.tab || 'all').toLowerCase();
  const search = String(query.search || '').trim();

  // Status can come either from query.status or query.tab
  const statusFilter = query.status && query.status !== 'all'
    ? buildRideStatusFilter(query.status, variant)
    : buildRideStatusFilter(tab, variant);

  const mongoFilter = {
    ...baseFilter,
    ...statusFilter,
    adminDeletedAt: null,
  };

  // Service Type filter (All, Ride, Outstation, Parcel)
  const serviceTypeParam = String(query.serviceType || query.serviceCategory || '').toLowerCase();
  if (serviceTypeParam && serviceTypeParam !== 'all') {
    if (serviceTypeParam === 'ride') {
      mongoFilter.serviceType = 'ride';
      mongoFilter['trip_category.category'] = { $ne: 'outstation' };
      mongoFilter['intercity.toCity'] = { $in: [null, ''] };
    } else if (serviceTypeParam === 'outstation' || serviceTypeParam === 'intercity') {
      const outstationClause = {
        $or: [
          { serviceType: { $in: ['outstation', 'intercity'] } },
          { 'trip_category.category': 'outstation' },
          { 'intercity.toCity': { $exists: true, $ne: '' } },
          { 'parcel.isOutstation': true },
        ],
      };
      if (mongoFilter.$or) {
        mongoFilter.$and = mongoFilter.$and || [];
        mongoFilter.$and.push(outstationClause);
      } else {
        mongoFilter.$or = outstationClause.$or;
      }
    } else if (serviceTypeParam === 'parcel') {
      mongoFilter.serviceType = 'parcel';
    }
  }

  // Payment Option / Method filter (All, Cash, Online, Wallet, UPI)
  const paymentParam = String(query.paymentOption || query.paymentType || query.paymentMethod || '').toLowerCase();
  if (paymentParam && paymentParam !== 'all') {
    if (paymentParam === 'cash') {
      mongoFilter.$and = mongoFilter.$and || [];
      mongoFilter.$and.push({
        paymentMethod: 'cash',
        collectedVia: { $ne: 'online' },
        'driverPaymentCollection.status': { $nin: ['paid', 'captured', 'completed'] },
      });
    } else if (paymentParam === 'online') {
      const onlineClause = {
        $or: [
          { paymentMethod: 'online' },
          { collectedVia: 'online' },
          { 'driverPaymentCollection.status': { $in: ['paid', 'captured', 'completed'] } },
        ],
      };
      if (mongoFilter.$or) {
        mongoFilter.$and = mongoFilter.$and || [];
        mongoFilter.$and.push(onlineClause);
      } else {
        mongoFilter.$or = onlineClause.$or;
      }
    } else if (paymentParam === 'wallet') {
      mongoFilter.paymentMethod = 'wallet';
    } else if (paymentParam === 'upi') {
      mongoFilter.collectedVia = 'upi';
    }
  }

  // Driver Assignment filter (All, Assigned, Unassigned)
  const driverParam = String(query.driverAssigned || '').toLowerCase();
  if (driverParam === 'assigned') {
    mongoFilter.driverId = { $ne: null };
  } else if (driverParam === 'unassigned') {
    mongoFilter.driverId = null;
  }

  // Transport Type / Vehicle Type filter
  const transportParam = String(query.transportType || query.vehicleType || '').trim();
  if (transportParam && transportParam.toLowerCase() !== 'all') {
    const tRegex = new RegExp(escapeRegex(transportParam), 'i');
    mongoFilter.$and = mongoFilter.$and || [];
    mongoFilter.$and.push({
      $or: [
        { vehicleIconType: tRegex },
        { 'intercity.vehicleName': tRegex },
        { 'parcel.category': tRegex },
      ],
    });
  }

  // Date range filter
  if (query.dateFrom || query.dateTo) {
    const dateClause = {};
    if (query.dateFrom) {
      dateClause.$gte = new Date(`${query.dateFrom}T00:00:00+05:30`);
    }
    if (query.dateTo) {
      dateClause.$lte = new Date(`${query.dateTo}T23:59:59.999+05:30`);
    }
    mongoFilter.createdAt = dateClause;
  }

  // City filter (for outstation or address)
  const cityParam = String(query.city || '').trim();
  if (cityParam && cityParam.toLowerCase() !== 'all') {
    const cityRegex = new RegExp(escapeRegex(cityParam), 'i');
    mongoFilter.$and = mongoFilter.$and || [];
    mongoFilter.$and.push({
      $or: [
        { 'intercity.fromCity': cityRegex },
        { 'intercity.toCity': cityRegex },
        { pickupAddress: cityRegex },
        { dropAddress: cityRegex },
      ],
    });
  }

  const searchClauses = await buildAdminRideSearchClauses(search, {
    includeParcel: true,
    includeIntercity: true,
  });

  if (searchClauses.length > 0) {
    if (mongoFilter.$or) {
      mongoFilter.$and = mongoFilter.$and || [];
      mongoFilter.$and.push({ $or: searchClauses });
    } else {
      mongoFilter.$or = searchClauses;
    }
  }

  const [total, rides] = await Promise.all([
    Ride.countDocuments(mongoFilter),
    Ride.find(mongoFilter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('userId', 'name phone email')
      .populate('driverId', 'name phone vehicleType vehicleNumber')
      .populate('deliveryId')
      .lean(),
  ]);

  return buildDatabasePaginator(rides.map(serializer), page, limit, total);
};

export const listOngoingRides = async (query = {}) => {
  return listAdminRides({
    query,
    baseFilter: {
      status: { $in: [RIDE_STATUS.SEARCHING, RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING] },
    },
    variant: 'ongoing_rides',
    serializer: toAdminRideRow,
    includeParcel: true,
    includeIntercity: true,
  });
};

export const listRideRequests = async (query = {}) => {
  return listAdminRides({
    query,
    baseFilter: {},
    variant: 'ride_requests',
    serializer: toAdminRideRow,
    includeParcel: true,
    includeIntercity: true,
  });
};

export const listDeliveries = async (query = {}) => {
  const [list, stats] = await Promise.all([
    listAdminRides({
      query,
      baseFilter: {
        serviceType: 'parcel',
      },
      variant: 'deliveries',
      serializer: toAdminDeliveryRow,
      includeParcel: true,
    }),
    getDeliveryStats(),
  ]);
  return { ...list, stats };
};

/// Counts for the cards on the Deliveries page, across every delivery - the
/// page used to work them out from the ten rows on screen, and "today" was
/// half of those rows.
const getDeliveryStats = async () => {
  const base = { serviceType: 'parcel', adminDeletedAt: null };
  const count = (filter) => Ride.countDocuments({ ...base, ...filter });
  // Midnight in India, whatever the server's own timezone.
  const istDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const startOfToday = new Date(`${istDay}T00:00:00+05:30`);
  const [total, completed, cancelled, pending, onTrip, today] = await Promise.all([
    count({}),
    count({ status: RIDE_STATUS.COMPLETED }),
    count({ status: RIDE_STATUS.CANCELLED }),
    // Booked but no driver has taken it yet.
    count({ status: RIDE_STATUS.SEARCHING }),
    count({ status: { $in: [RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING] } }),
    count({ createdAt: { $gte: startOfToday } }),
  ]);
  return { total, completed, cancelled, pending, onTrip, today };
};

export const listIntercityTrips = async (query = {}) => {
  return listAdminRides({
    query,
    baseFilter: {},
    variant: 'trips',
    serializer: toAdminIntercityTripRow,
    includeIntercity: true,
    includeParcel: true,
  });
};

const FINISHED_RIDE_STATUSES = new Set([RIDE_STATUS.COMPLETED, RIDE_STATUS.CANCELLED]);

const loadRideForAdminAction = async (rideId) => {
  if (!mongoose.Types.ObjectId.isValid(String(rideId))) {
    throw new ApiError(400, 'Invalid ride id');
  }
  const ride = await Ride.findById(rideId).select('status liveStatus adminDeletedAt').lean();
  if (!ride || ride.adminDeletedAt) {
    throw new ApiError(404, 'Ride not found');
  }
  return ride;
};

/// Cancels a ride from the admin Trips page: stops the search, frees the
/// driver and rider, and tells both apps. A finished ride cannot be cancelled.
export const cancelRideRequestAsAdmin = async (rideId, { reason = '' } = {}, currentAdmin = null) => {
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'trips.view', 'trips');
  }
  const ride = await loadRideForAdminAction(rideId);
  if (ride.status === RIDE_STATUS.COMPLETED) {
    throw new ApiError(409, 'A completed trip cannot be cancelled');
  }
  if (ride.status === RIDE_STATUS.CANCELLED || ride.liveStatus === RIDE_LIVE_STATUS.CANCELLED) {
    throw new ApiError(409, 'This trip is already cancelled');
  }

  const cancelled = await cancelRideByAdmin(rideId);
  if (!cancelled) {
    throw new ApiError(404, 'Ride not found');
  }
  await Ride.updateOne(
    { _id: rideId },
    {
      $set: {
        cancelledBy: `admin:${currentAdmin?.name || currentAdmin?.email || 'admin'}`,
        cancelReason: String(reason || '').trim().slice(0, 300) || 'Cancelled by admin',
        cancelledAt: new Date(),
      },
    },
  );

  return { id: String(cancelled._id), status: cancelled.status, liveStatus: cancelled.liveStatus };
};

/// Removes a finished (completed or cancelled) trip from the admin lists. A
/// live trip must be cancelled first, so deleting can never strand a driver
/// or rider mid-ride. The record is kept for earnings and reports.
export const deleteRideRequestAsAdmin = async (rideId, currentAdmin = null) => {
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'trips.view', 'trips');
  }
  const ride = await loadRideForAdminAction(rideId);
  if (!FINISHED_RIDE_STATUSES.has(ride.status)) {
    throw new ApiError(409, 'Cancel this trip first - only completed or cancelled trips can be deleted');
  }

  await Ride.updateOne(
    { _id: rideId, adminDeletedAt: null },
    {
      $set: {
        adminDeletedAt: new Date(),
        adminDeletedBy: String(currentAdmin?.name || currentAdmin?.email || 'admin'),
      },
    },
  );
  return { id: String(rideId), deleted: true };
};

export const deleteOngoingRide = async (rideId) => {
  if (!mongoose.Types.ObjectId.isValid(String(rideId))) {
    throw new ApiError(400, 'Invalid ride id');
  }

  const deletedRide = await cancelRideByAdmin(rideId);

  if (!deletedRide) {
    throw new ApiError(404, 'Ride not found');
  }

  return {
    id: String(deletedRide._id),
    deleted: true,
    status: deletedRide.status,
    liveStatus: deletedRide.liveStatus,
  };
};

export const listVehicleTypes = async (queryParams = {}) => {
  const query = {};
  if (queryParams.transport_type) {
    const normalizedTransportType = normalizeVehicleTransportType(queryParams.transport_type);
    query.transport_type = normalizedTransportType === 'both'
      ? 'both'
      : { $in: [normalizedTransportType, 'both'] };
  }
  const items = await Vehicle.find(query)
    .select('name short_description description transport_type dispatch_type icon_types category delivery_category delivery_distance_pricing service_tax admin_commission_type_from_driver admin_commission_from_driver capacity image icon map_icon status active app_modules createdAt updatedAt')
    .sort({ createdAt: -1 })
    .lean();
  const results = items.map((item) => ({
    ...item,
    ...normalizeVehicleCommissionConfig(item),
    category: item.category || '',
    icon: item.map_icon || item.icon || item.image || '',
    map_icon: item.map_icon || item.icon || item.image || '',
    delivery_category: item.delivery_category || '',
    delivery_distance_pricing: normalizeDeliveryDistancePricing(item.delivery_distance_pricing),
    service_tax: normalizeDeliveryServiceTax(item.service_tax),
    app_modules: Array.isArray(item.app_modules) ? item.app_modules.map(String) : [],
  }));

  return {
    results,
    paginator: {
      data: results,
      total: results.length,
      current_page: 1,
      last_page: 1,
      per_page: results.length,
      from: 1,
      to: results.length
    }
  };
};


export const listVehicleCatalog = async () => {
  const items = await Vehicle.find().sort({ createdAt: -1 }).lean();

  const results = items.map((item) => ({
    ...item,
    ...normalizeVehicleCommissionConfig(item),
    id: String(item._id),
    category: item.category || '',
    icon: item.map_icon || item.icon || item.image || '',
    map_icon: item.map_icon || item.icon || item.image || '',
    delivery_category: item.delivery_category || '',
    delivery_distance_pricing: normalizeDeliveryDistancePricing(item.delivery_distance_pricing),
    supported_vehicles: Array.isArray(item.supported_other_vehicle_types)
      ? item.supported_other_vehicle_types.map((v) => String(v)).join(',')
      : '',
    icon_types_for: item.icon_types,
    trip_dispatch_type: item.dispatch_type,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  }));

  return {
    results,
    paginator: {
      data: results,
      total: results.length,
      current_page: 1,
      last_page: 1,
      per_page: 10,
      from: 1,
      to: results.length,
    }
  };
};

const buildDatabasePaginator = (results, page = 1, limit = 50, total = 0) => {
  const safePage = Number(page) || 1;
  const safeLimit = Number(limit) || 50;
  const safeTotal = Number(total) || 0;

  return {
    results,
    paginator: {
      current_page: safePage,
      per_page: safeLimit,
      total: safeTotal,
      last_page: Math.max(1, Math.ceil(safeTotal / safeLimit)),
    },
  };
};

const normalizeVehicleCommissionConfig = (item = {}) => ({
  admin_commission_type_from_driver: Number(item?.admin_commission_type_from_driver ?? 1),
  admin_commission_from_driver: Number(item?.admin_commission_from_driver ?? 0),
});


export const getVehicleTypeById = async (id) => {
  const item = await Vehicle.findById(id).lean();

  if (!item) {
    throw new ApiError(404, 'Vehicle type not found');
  }

  return {
    ...item,
    ...normalizeVehicleCommissionConfig(item),
    id: String(item._id),
    category: item.category || '',
    icon: item.map_icon || item.icon || item.image || '',
    map_icon: item.map_icon || item.icon || item.image || '',
    delivery_category: item.delivery_category || '',
    delivery_distance_pricing: normalizeDeliveryDistancePricing(item.delivery_distance_pricing),
    service_tax: normalizeDeliveryServiceTax(item.service_tax),
    supported_vehicles: Array.isArray(item.supported_other_vehicle_types)
      ? item.supported_other_vehicle_types.map((v) => String(v)).join(',')
      : '',
    icon_types_for: item.icon_types,
    trip_dispatch_type: item.dispatch_type,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
};

export const listPublicVehicleCatalog = async () => {
  if (publicVehicleCatalogCache.value && publicVehicleCatalogCache.expiresAt > Date.now()) {
    return publicVehicleCatalogCache.value;
  }

  // Only vehicles the admin has left switched on. This feeds the rider app
  // and the website's fleet, which showed every vehicle regardless - a
  // switched-off one sat in the ride list unpriced and unbookable. The admin
  // listing (listVehicleTypes) still returns them all, so one can be
  // switched back on.
  const items = await Vehicle.find({ active: { $ne: false }, status: { $nin: [0, '0'] } })
    .select('name short_description description transport_type dispatch_type icon_types category delivery_category delivery_distance_pricing service_tax admin_commission_type_from_driver admin_commission_from_driver capacity image icon map_icon status active app_modules')
    .sort({ createdAt: -1 })
    .lean();

  // Per-km rate for the public fleet listing. Ride fares live in SetPrice and
  // vary by zone, so the lowest active rate is used as a "from" figure; delivery
  // vehicles price from their own distance config instead. Without this the
  // catalog carries no price at all, and the website was filling the gap with a
  // number picked by list position.
  const ridePriceRows = await SetPrice.aggregate([
    {
      $match: {
        pricing_scope: 'ride',
        status: 'active',
        active: 1,
        vehicle_type: { $ne: null },
        price_per_distance: { $gt: 0 },
      },
    },
    {
      $group: {
        _id: '$vehicle_type',
        perKm: { $min: '$price_per_distance' },
        maxPerKm: { $max: '$price_per_distance' },
      },
    },
  ]);
  const ridePerKm = new Map(
    ridePriceRows.map((row) => [
      String(row._id),
      { perKm: Number(row.perKm) || 0, varies: Number(row.maxPerKm) > Number(row.perKm) },
    ]),
  );

  // The apps read dispatch_type to decide whether to offer bidding at all, so
  // the admin's bidding switches have to reach it here - otherwise turning
  // bidding off left the toggle sitting in the app doing nothing.
  const bidRideSettings = await getBidRideSettings();

  const results = items.map((item) => ({
    id: String(item._id),
    _id: item._id,
    name: item.name || '',
    short_description: item.short_description || '',
    description: item.description || '',
    transport_type: item.transport_type || 'taxi',
    dispatch_type: resolveCatalogDispatchType(item, bidRideSettings),
    icon_types: item.icon_types || 'car',
    category: item.category || '',
    delivery_category: item.delivery_category || '',
    // Which home-screen modules (Zi Airport, Zi City Ride, Zi Parcel, ...)
    // this vehicle is offered under. Empty means every module — see the
    // schema comment on Vehicle.app_modules for why.
    app_modules: Array.isArray(item.app_modules) ? item.app_modules.map(String) : [],
    delivery_distance_pricing: normalizeDeliveryDistancePricing(item.delivery_distance_pricing),
    service_tax: normalizeDeliveryServiceTax(item.service_tax),
    ...normalizeVehicleCommissionConfig(item),
    capacity: Number(item.capacity || 0),
    // 0 means "no price configured" — callers should omit the price rather than
    // substitute one.
    price_per_km:
      item.transport_type === 'delivery'
        ? Number(item.delivery_distance_pricing?.distance_price || 0)
        : ridePerKm.get(String(item._id))?.perKm || 0,
    // Ride fares are set per zone, so a single figure is a "from" price whenever
    // the zones disagree. Delivery prices come from one per-vehicle config.
    price_per_km_varies:
      item.transport_type === 'delivery'
        ? false
        : Boolean(ridePerKm.get(String(item._id))?.varies),
    image: item.image || '',
    map_icon: item.map_icon || item.icon || item.image || '',
    status: item.status ?? 1,
    active: item.active !== false && Number(item.status ?? 1) !== 0,
  }));

  const payload = {
    results,
    paginator: {
      data: results,
      total: results.length,
      current_page: 1,
      last_page: 1,
      per_page: results.length,
      from: results.length ? 1 : 0,
      to: results.length,
    },
  };

  publicVehicleCatalogCache = {
    value: payload,
    expiresAt: Date.now() + PUBLIC_VEHICLE_CATALOG_CACHE_TTL_MS,
  };

  return payload;
};

export const listPublicRentalVehicleCatalog = async () => {
  const items = await RentalVehicleType.find({
    active: true,
    status: 'active',
  })
    .sort({ createdAt: -1 })
    .lean();

  return items.map((item) => serializeRentalVehicleType(item));
};

export const listVehiclePreferences = async () => {
  return listPreferences();
};

/// Which home-screen modules a vehicle is offered under.
///
/// Ids are stored as plain strings, matching the schema. An empty list means
/// every module - see the comment on Vehicle.app_modules - so clearing the
/// picker restores a vehicle to the whole app rather than hiding it.
const normalizeAppModuleIds = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .map((entry) => String(entry?._id || entry || '').trim())
      .filter((entry) => mongoose.Types.ObjectId.isValid(entry)),
  )];
};

export const createVehicleType = async (payload) => {
  if (!payload.name?.trim()) {
    throw new ApiError(400, 'Vehicle name is required');
  }

  if (!payload.transport_type?.trim()) {
    throw new ApiError(400, 'Transport type is required');
  }

  const mapIcon = payload.map_icon ?? payload.mapIcon ?? payload.icon ?? payload.image ?? '';
  const transportType = normalizeVehicleTransportType(payload.transport_type);

  const vehicle = await Vehicle.create({
    name: payload.name.trim(),
    short_description: payload.short_description ?? '',
    description: payload.description ?? '',
    transport_type: transportType,
    dispatch_type: payload.dispatch_type || 'normal',
    icon_types: payload.icon_types || 'car',
    category: String(payload.category || '').trim().toLowerCase(),
    capacity: Number(payload.capacity || 0),
    size: payload.size ?? '',
    is_taxi: payload.is_taxi || transportType,
    is_accept_share_ride: Number(payload.is_accept_share_ride || 0) ? 1 : 0,
    delivery_category: ['delivery', 'both'].includes(transportType)
      ? normalizeDeliveryCategory(payload.delivery_category)
      : '',
    delivery_distance_pricing: ['delivery', 'both'].includes(transportType)
      ? normalizeDeliveryDistancePricing(payload.delivery_distance_pricing)
      : normalizeDeliveryDistancePricing(),
    service_tax: ['delivery', 'both'].includes(transportType)
      ? normalizeDeliveryServiceTax(payload.service_tax)
      : 0,
    admin_commission_type_from_driver: Number(payload.admin_commission_type_from_driver ?? 1),
    admin_commission_from_driver: Number(payload.admin_commission_from_driver ?? 0),
    image: payload.image ?? mapIcon,
    icon: mapIcon,
    map_icon: mapIcon,
    status: Number(payload.status ?? 1) ? 1 : 0,
    active: Number(payload.status ?? 1) === 1,
    supported_other_vehicle_types: Array.isArray(payload.supported_other_vehicle_types)
      ? payload.supported_other_vehicle_types.filter(Boolean).map(toObjectId)
      : [],
    vehicle_preference: Array.isArray(payload.vehicle_preference)
      ? payload.vehicle_preference.filter(Boolean).map(toObjectId)
      : [],
    app_modules: normalizeAppModuleIds(payload.app_modules),
  });

  publicVehicleCatalogCache = { value: null, expiresAt: 0 };

  return vehicle.toObject();
};

export const updateVehicleType = async (id, payload) => {
  const vehicle = await Vehicle.findById(id);
  if (!vehicle) {
    throw new ApiError(404, 'Vehicle type not found');
  }

  if (payload.name !== undefined) {
    vehicle.name = String(payload.name).trim();
  }
  if (payload.short_description !== undefined) {
    vehicle.short_description = payload.short_description ?? '';
  }
  if (payload.description !== undefined) {
    vehicle.description = payload.description ?? '';
  }
  if (payload.transport_type !== undefined) {
    vehicle.transport_type = normalizeVehicleTransportType(payload.transport_type);
  }
  if (payload.dispatch_type !== undefined) {
    vehicle.dispatch_type = payload.dispatch_type || 'normal';
  }
  if (payload.icon_types !== undefined) {
    vehicle.icon_types = payload.icon_types || 'car';
  }
  if (payload.category !== undefined) {
    vehicle.category = String(payload.category || '').trim().toLowerCase();
  }
  if (payload.image !== undefined) {
    vehicle.image = payload.image ?? '';
  }
  if (payload.icon !== undefined || payload.map_icon !== undefined || payload.mapIcon !== undefined || payload.image !== undefined) {
    const mapIcon = payload.map_icon ?? payload.mapIcon ?? payload.icon ?? payload.image ?? '';
    vehicle.icon = mapIcon;
    vehicle.map_icon = mapIcon;
  }
  if (payload.capacity !== undefined) {
    vehicle.capacity = Number(payload.capacity || 0);
  }
  if (payload.size !== undefined) {
    vehicle.size = payload.size ?? '';
  }
  if (payload.is_taxi !== undefined) {
    vehicle.is_taxi = payload.is_taxi || vehicle.transport_type;
  }
  if (payload.is_accept_share_ride !== undefined) {
    vehicle.is_accept_share_ride = Number(payload.is_accept_share_ride || 0) ? 1 : 0;
  }
  if (payload.delivery_category !== undefined || payload.transport_type !== undefined) {
    vehicle.delivery_category = ['delivery', 'both'].includes(vehicle.transport_type)
      ? normalizeDeliveryCategory(payload.delivery_category ?? vehicle.delivery_category)
      : '';
  }
  if (payload.delivery_distance_pricing !== undefined || payload.transport_type !== undefined) {
    vehicle.delivery_distance_pricing = ['delivery', 'both'].includes(vehicle.transport_type)
      ? normalizeDeliveryDistancePricing(payload.delivery_distance_pricing, vehicle.delivery_distance_pricing)
      : normalizeDeliveryDistancePricing();
  }
  if (payload.service_tax !== undefined || payload.transport_type !== undefined) {
    vehicle.service_tax = ['delivery', 'both'].includes(vehicle.transport_type)
      ? normalizeDeliveryServiceTax(payload.service_tax, vehicle.service_tax)
      : 0;
  }
  if (payload.admin_commission_type_from_driver !== undefined) {
    vehicle.admin_commission_type_from_driver = Number(payload.admin_commission_type_from_driver ?? 1);
  }
  if (payload.admin_commission_from_driver !== undefined) {
    vehicle.admin_commission_from_driver = Number(payload.admin_commission_from_driver ?? 0);
  }
  if (payload.status !== undefined) {
    vehicle.status = Number(payload.status) ? 1 : 0;
    vehicle.active = vehicle.status === 1;
  }
  if (payload.supported_other_vehicle_types !== undefined) {
    vehicle.supported_other_vehicle_types = Array.isArray(payload.supported_other_vehicle_types)
      ? payload.supported_other_vehicle_types.filter(Boolean).map(toObjectId)
      : [];
  }
  if (payload.vehicle_preference !== undefined) {
    vehicle.vehicle_preference = Array.isArray(payload.vehicle_preference)
      ? payload.vehicle_preference.filter(Boolean).map(toObjectId)
      : [];
  }
  // The admin panel has always sent this and the server has always dropped it,
  // so the module picker on the vehicle form saved nothing: every vehicle kept
  // an empty list and therefore appeared under every module.
  if (payload.app_modules !== undefined) {
    vehicle.app_modules = normalizeAppModuleIds(payload.app_modules);
  }

  await vehicle.save();
  publicVehicleCatalogCache = { value: null, expiresAt: 0 };
  return vehicle.toObject();
};

export const deleteVehicleType = async (id) => {
  const deleted = await Vehicle.findByIdAndDelete(id);
  if (!deleted) {
    throw new ApiError(404, 'Vehicle type not found');
  }
  publicVehicleCatalogCache = { value: null, expiresAt: 0 };
  return true;
};

/// `options.hikeMultiplier` overrides the scheduled Price Hike windows - the
/// rider catalog passes the larger of those and the pickup's automatic surge.
export const listSetPrices = async (queryArgs = {}, currentAdmin = null, options = {}) => {
  const scope = String(queryArgs.scope || '').trim();
  const query = scope ? { pricing_scope: scope } : {};
  const safePage = Math.max(1, Number(queryArgs.page || queryArgs.current_page || 1) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(queryArgs.limit || queryArgs.per_page || 10) || 10));
  const normalizedSearch = String(queryArgs.search || '').trim().toLowerCase();
  const normalizedTransportType = String(queryArgs.transport_type || '').trim().toLowerCase();
  const normalizedStatus = String(queryArgs.status || '').trim().toLowerCase();
  const normalizedZoneId = String(queryArgs.zone_id || '').trim();
  const normalizedVehicleTypeId = String(queryArgs.vehicle_type || '').trim();

  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'set_prices.view', 'set prices');
    const scopedZoneIds = await getScopedZoneIds(currentAdmin);
    const { serviceLocationIds } = getAdminScope(currentAdmin);

    if (!isSuperAdmin(currentAdmin)) {
      query.$or = [];
      if (scopedZoneIds.length > 0) {
        query.$or.push({ zone_id: { $in: scopedZoneIds } });
      }
      if (serviceLocationIds.length > 0) {
        query.$or.push({ service_location_id: { $in: serviceLocationIds } });
      }
      if (query.$or.length === 0) {
        query._id = { $in: [] };
      }
    }
  }

  const items = await SetPrice.find(query)
    .select([
      'pricing_scope',
      'vehicle_type',
      'service_location_id',
      'package_type_id',
      'package_destination',
      'package_availability',
      'package_vehicle_prices',
      'payment_type',
      'transport_type',
      'zone_id',
      'status',
      'active',
      'capacity',
      'enable_shared_ride',
      'service_tax',
      'admin_commision_type',
      'admin_commision',
      'base_price',
      'base_distance',
      'price_per_distance',
      'time_price',
      'waiting_charge',
      'free_waiting_before',
      'free_waiting_after',
      'enable_outstation_ride',
      'support_outstation',
      'outstation_base_price',
      'outstation_base_distance',
      'outstation_price_per_distance',
      'outstation_time_price',
      'outstation_round_trip_price_per_distance',
      'outstation_min_km_per_day',
      'outstation_driver_allowance_per_day',
      'createdAt',
      'updatedAt',
    ].join(' '))
    .populate('vehicle_type', 'name icon capacity')
    .populate('service_location_id', 'name service_location_name currency_symbol')
    .populate('package_type_id', 'name')
    .populate('package_vehicle_prices.vehicle_type', 'name')
    .populate({
      path: 'zone_id',
      select: 'name unit service_location_id',
      populate: { path: 'service_location_id' }
    })
    .sort({ createdAt: -1 })
    .lean();

  const results = items.map((item) => {
    const vType = item.vehicle_type || {};
    const zone = item.zone_id || {};
    const sl = zone.service_location_id || {};
    const directServiceLocation = item.service_location_id || {};
    const effectiveServiceLocation = directServiceLocation._id ? directServiceLocation : sl;
    const packageType = item.package_type_id || {};

    return {
      id: String(item._id),
      pricing_scope: item.pricing_scope || 'ride',
      zone_id: zone._id ? String(zone._id) : null,
      service_location_id: effectiveServiceLocation._id ? String(effectiveServiceLocation._id) : null,
      type_id: vType._id ? String(vType._id) : null,
      name: vType.name || '',
      icon: vType.icon || '',
      capacity: vType.capacity || item.capacity || 0,
      is_accept_share_ride: item.enable_shared_ride || 0,
      active: item.active || 0,
      currency: effectiveServiceLocation.currency_symbol || '?',
      unit: Number(zone.unit || 1),
      unit_in_words: 'Km',
      zone_name: zone.name || '',
      service_location_name: effectiveServiceLocation.name || effectiveServiceLocation.service_location_name || '',
      vehicle_type_name: vType.name || '',
      drop_zone_name: null,
      transport_type: item.transport_type || 'both',
      package_type_id: packageType._id ? String(packageType._id) : null,
      package_type_name: packageType.name || '',
      package_destination: item.package_destination || '',
      package_availability: item.package_availability || 'available',
      package_vehicle_prices: Array.isArray(item.package_vehicle_prices)
        ? item.package_vehicle_prices.map((price) => ({
          vehicle_type: price.vehicle_type?._id ? String(price.vehicle_type._id) : null,
          vehicle_type_name: price.vehicle_type?.name || '',
          base_price: Number(price.base_price ?? 0),
          free_distance: Number(price.free_distance ?? 0),
          distance_price: Number(price.distance_price ?? 0),
          free_time: Number(price.free_time ?? 0),
          time_price: Number(price.time_price ?? 0),
          active: Number(price.active ?? 1),
        }))
        : [],
      payment_type: Array.isArray(item.payment_type)
        ? item.payment_type
        : (item.payment_type ? String(item.payment_type).split(',') : ['cash', 'online', 'wallet']),
      status: item.status || (item.active === false ? 'inactive' : 'active'),
      service_tax: Number(item.service_tax ?? 0),
      // The per-ride fee charged to the rider on top of the trip - the client's
      // "admin charges" (platform support + third party + GST). Kept in the
      // admin_commision pair the Set Prices screen already edits as customer
      // commission, where 1 means a percentage and anything else a fixed sum.
      rider_platform_fee: Number(item.admin_commision ?? 0),
      rider_platform_fee_type: Number(item.admin_commision_type ?? 1) === 1 ? 'percentage' : 'fixed',
      base_price: Number(item.base_price ?? 0),
      base_distance: Number(item.base_distance ?? 0),
      price_per_distance: Number(item.price_per_distance ?? 0),
      time_price: Number(item.time_price ?? 0),
      waiting_charge: Number(item.waiting_charge ?? 0),
      free_waiting_before: Number(item.free_waiting_before ?? 0),
      free_waiting_after: Number(item.free_waiting_after ?? 0),
      // Whether this vehicle may be booked for an intercity trip at all. The
      // apps read exactly these two keys and the catalog never sent them, so
      // every vehicle looked city-only and the Outstation screen was always
      // empty - even where an admin had enabled it and set rates.
      enable_outstation_ride: Boolean(item.enable_outstation_ride),
      support_outstation: Number(item.support_outstation ?? 0),
      outstation_base_price: Number(item.outstation_base_price ?? 0),
      outstation_base_distance: Number(item.outstation_base_distance ?? 0),
      outstation_price_per_distance: Number(item.outstation_price_per_distance ?? 0),
      outstation_time_price: Number(item.outstation_time_price ?? 0),
      outstation_round_trip_price_per_distance: Number(item.outstation_round_trip_price_per_distance ?? 0),
      outstation_min_km_per_day: Number(item.outstation_min_km_per_day ?? 0),
      outstation_driver_allowance_per_day: Number(item.outstation_driver_allowance_per_day ?? 0),
      updatedAt: item.updatedAt,
    };
  });

  const paginatorData = items.map((item) => {
    const vType = item.vehicle_type || {};
    const zone = item.zone_id || {};
    const sl = zone.service_location_id || {};
    const directServiceLocation = item.service_location_id || {};
    const effectiveServiceLocation = directServiceLocation._id ? directServiceLocation : sl;
    const packageType = item.package_type_id || {};

    return {
      ...item,
      id: String(item._id),
      pricing_scope: item.pricing_scope || 'ride',
      vehicle_type_name: vType.name || '',
      icon: vType.icon || '',
      zone_name: zone.name || '',
      drop_zone_name: null,
      package_type_name: packageType.name || '',
      service_location_name: effectiveServiceLocation.name || effectiveServiceLocation.service_location_name || '',
      vehicle_type: vType
        ? {
          ...vType,
          id: String(vType._id),
          icon_types_for: vType.icon_types,
          trip_dispatch_type: vType.dispatch_type,
        }
        : null,
      service_location: effectiveServiceLocation
        ? {
          ...effectiveServiceLocation,
          id: String(effectiveServiceLocation._id || effectiveServiceLocation.id || ''),
        }
        : null,
      package_type: packageType
        ? {
          ...packageType,
          id: String(packageType._id || packageType.id || ''),
        }
        : null,
      package_vehicle_prices: Array.isArray(item.package_vehicle_prices)
        ? item.package_vehicle_prices.map((price, index) => ({
          ...price,
          id: String(price._id || index),
          vehicle_type: price.vehicle_type
            ? {
              ...price.vehicle_type,
              id: String(price.vehicle_type._id || price.vehicle_type.id || ''),
            }
            : null,
        }))
        : [],
      zone: zone
        ? {
          ...zone,
          id: String(zone._id),
          service_location: sl
            ? {
              ...sl,
              id: String(sl._id),
            }
            : null,
        }
        : null,
    };
  });

  const rows = results.map((result, index) => ({
    result,
    paginatorItem: paginatorData[index],
  })).filter((row) => {
    if (normalizedTransportType && String(row.result.transport_type || '').toLowerCase() !== normalizedTransportType) {
      return false;
    }

    if (normalizedStatus) {
      const rowStatus = String(row.result.status || (Number(row.result.active) === 1 ? 'active' : 'inactive')).toLowerCase();
      if (rowStatus !== normalizedStatus) {
        return false;
      }
    }

    if (normalizedZoneId) {
      // From the real _id only. `zone.id` is built as String(zone._id) off a
      // `zone_id || {}` fallback, so a row with no zone carries the literal
      // string "undefined" there - which reads as a zone and made every
      // no-zone row vanish from a zone_id=none query.
      const rawZoneId =
        row.paginatorItem?.zone?._id ||
        row.paginatorItem?.zone_id?._id ||
        row.paginatorItem?.zone_id;
      const rowZoneId = rawZoneId ? String(rawZoneId) : '';
      // 'none' asks for the rows that belong to no zone - the service-location
      // and global fallbacks the rider catalog cascades to.
      if (normalizedZoneId === 'none') {
        if (rowZoneId) {
          return false;
        }
      } else if (rowZoneId !== normalizedZoneId) {
        return false;
      }
    }

    if (normalizedVehicleTypeId) {
      const rowVehicleTypeId = String(
        row.paginatorItem?.vehicle_type?._id ||
        row.paginatorItem?.vehicle_type?.id ||
        row.paginatorItem?.vehicle_type?._id ||
        row.result?.type_id ||
        '',
      );
      if (rowVehicleTypeId !== normalizedVehicleTypeId) {
        return false;
      }
    }

    if (normalizedSearch) {
      const haystack = [
        row.result.zone_name,
        row.result.vehicle_type_name,
        row.result.transport_type,
        row.result.service_location_name,
        row.result.package_type_name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (!haystack.includes(normalizedSearch)) {
        return false;
      }
    }

    return true;
  });

  const paginated = buildPaginator(rows, safePage, safeLimit);
  const pagedRows = paginated.results;
  const total = paginated.paginator.total;
  const from = total === 0 ? 0 : (safePage - 1) * safeLimit + 1;
  const to = total === 0 ? 0 : Math.min((safePage - 1) * safeLimit + pagedRows.length, total);

  // Surge is applied to the rows riders are quoted from, and only to those:
  // admins (currentAdmin set) see and edit the base tariff. The quote is what
  // createRideRecord bills, so scaling it scales the charge.
  //
  // The multiplier is the pickup hexagon's automatic surge, passed in by the
  // rider catalog. A request with no pickup has no area to surge, so 1. The
  // scheduled Price Hike time slots are retired - surge follows demand only.
  //
  // Surge is set per vehicle type, so `options.multiplierForVehicle(id)` gives
  // each row its own; `options.hikeMultiplier` is one value for every row.
  const hikeMultiplier = Number(options.hikeMultiplier) > 0 ? Number(options.hikeMultiplier) : 1;
  const rowMultiplier = (row) => (typeof options.multiplierForVehicle === 'function'
    ? Number(options.multiplierForVehicle(setPriceVehicleId(row))) || 1
    : hikeMultiplier);
  const quotedResults = currentAdmin
    ? pagedRows.map((row) => row.result)
    : pagedRows.map((row) => applyPriceHikeToSetPrice(row.result, rowMultiplier(row.result)));

  return {
    results: quotedResults,
    price_hike_multiplier: hikeMultiplier,
    paginator: {
      ...paginated.paginator,
      data: pagedRows.map((row) => row.paginatorItem),
      from,
      to,
    }
  };
};

export const getSetPriceById = async (id, currentAdmin = null) => {
  const item = await SetPrice.findById(id)
    .populate('vehicle_type')
    .populate('service_location_id')
    .populate('package_type_id')
    .populate('package_vehicle_prices.vehicle_type')
    .populate({
      path: 'zone_id',
      populate: { path: 'service_location_id' },
    })
    .lean();

  if (!item) {
    throw new ApiError(404, 'Set Price not found');
  }

  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'set_prices.view', 'set prices');
    if (item.zone_id?._id || item.zone_id) {
      await assertZoneAccess(currentAdmin, item.zone_id?._id || item.zone_id);
    } else {
      assertServiceLocationAccess(currentAdmin, item.service_location_id?._id || item.service_location_id);
    }
  }

  return serializeSetPrice(item);
};

const resolveSetPriceVehicleAndTransportType = async ({
  vehicleTypeId = null,
  transportType = undefined,
  fallbackVehicleTypeId = null,
  fallbackTransportType = 'taxi',
}) => {
  const resolvedVehicleTypeId = toObjectId(vehicleTypeId || fallbackVehicleTypeId);

  if (!resolvedVehicleTypeId) {
    return {
      vehicleTypeId: null,
      transportType: transportType !== undefined
        ? normalizeVehicleTransportType(transportType)
        : normalizeVehicleTransportType(fallbackTransportType || 'taxi'),
    };
  }

  const vehicle = await Vehicle.findById(resolvedVehicleTypeId)
    .select('_id transport_type is_taxi')
    .lean();

  if (!vehicle) {
    throw new ApiError(404, 'Vehicle type not found');
  }

  const vehicleTransportType = normalizeVehicleTransportType(
    vehicle.transport_type || vehicle.is_taxi || 'taxi',
  );
  const requestedTransportType = transportType !== undefined
    ? normalizeVehicleTransportType(transportType)
    : normalizeVehicleTransportType(fallbackTransportType || vehicleTransportType);

  const isCompatible =
    vehicleTransportType === 'both'
      ? ['both', 'taxi', 'delivery'].includes(requestedTransportType)
      : requestedTransportType === vehicleTransportType;

  if (!isCompatible) {
    throw new ApiError(400, 'Selected vehicle type does not match the pricing transport type');
  }

  return {
    vehicleTypeId: resolvedVehicleTypeId,
    transportType:
      vehicleTransportType === 'both'
        ? requestedTransportType
        : vehicleTransportType,
  };
};

export const createSetPrice = async (payload, currentAdmin = null) => {
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'set_prices.view', 'set prices');
    if (payload.service_location_id) {
      assertServiceLocationAccess(currentAdmin, payload.service_location_id?._id || payload.service_location_id?.id || payload.service_location_id);
    }
    if (payload.zone_id) {
      await assertZoneAccess(currentAdmin, payload.zone_id?._id || payload.zone_id?.id || payload.zone_id);
    }
  }

  const payment_type = Array.isArray(payload.payment_type)
    ? payload.payment_type
    : typeof payload.payment_type === 'string'
      ? payload.payment_type.split(',').map(s => s.trim())
      : ['cash', 'online', 'wallet'];

  const zone_id = toObjectId(payload.zone_id?._id || payload.zone_id?.id || payload.zone_id);
  const requestedVehicleTypeId =
    payload.vehicle_type?._id || payload.vehicle_type?.id || payload.vehicle_type || payload.type_id;
  const payloadServiceLocationId =
    payload.service_location_id?._id
    || payload.service_location_id?.id
    || payload.service_location_id
    || payload.zone?.service_location?._id
    || payload.zone?.service_location?.id
    || payload.zone?.service_location_id;
  const zone = zone_id ? await Zone.findById(zone_id).select('_id service_location_id').lean() : null;
  const service_location_id = zone?.service_location_id
    ? toObjectId(zone.service_location_id)
    : toObjectId(payloadServiceLocationId);
  const { vehicleTypeId: vehicle_type, transportType: resolvedTransportType } =
    await resolveSetPriceVehicleAndTransportType({
      vehicleTypeId: requestedVehicleTypeId,
      transportType: payload.transport_type,
      fallbackTransportType: 'taxi',
    });

  const setPrice = await SetPrice.create({
    zone_id,
    vehicle_type,
    service_location_id,
    pricing_scope: payload.pricing_scope || 'ride',
    transport_type: resolvedTransportType,
    package_type_id: toObjectId(payload.package_type_id?._id || payload.package_type_id?.id || payload.package_type_id),
    package_destination: String(payload.package_destination || '').trim(),
    package_availability: payload.package_availability || 'available',
    package_vehicle_prices: Array.isArray(payload.package_vehicle_prices)
      ? payload.package_vehicle_prices.map((item) => normalizePackageVehiclePriceItem(item))
      : [],
    payment_type,
    active: Number(payload.active ?? 1),

    admin_commision_type: Number(payload.admin_commision_type ?? (payload.customer_commission_type === 'percentage' ? 1 : 0)),
    admin_commision: Number(payload.admin_commision ?? payload.customer_commission ?? 0),
    admin_commission_type_from_driver: Number(payload.admin_commission_type_from_driver ?? 1),
    admin_commission_from_driver: Number(payload.admin_commission_from_driver ?? 0),

    service_tax: Number(payload.service_tax ?? 0),
    airport_surge: Number(payload.airport_surge ?? 0),
    support_airport_fee: Number(payload.support_airport_fee ?? 0),
    support_outstation: Number(payload.support_outstation ?? 0),
    enable_airport_ride: payload.enable_airport_ride ?? !!payload.support_airport_fee,
    enable_outstation_ride: payload.enable_outstation_ride ?? !!payload.support_outstation,

    base_price: Number(payload.base_price ?? 0),
    base_distance: Number(payload.base_distance ?? 0),
    price_per_distance: Number(payload.price_per_distance ?? 0),
    time_price: Number(payload.time_price ?? 0),
    waiting_charge: Number(payload.waiting_charge ?? 0),
    outstation_base_price: Number(payload.outstation_base_price ?? 0),
    outstation_base_distance: Number(payload.outstation_base_distance ?? 0),
    outstation_price_per_distance: Number(payload.outstation_price_per_distance ?? 0),
    outstation_time_price: Number(payload.outstation_time_price ?? 0),
    outstation_round_trip_price_per_distance: Number(payload.outstation_round_trip_price_per_distance ?? 0),
    outstation_min_km_per_day: Number(payload.outstation_min_km_per_day ?? 0),
    outstation_driver_allowance_per_day: Number(payload.outstation_driver_allowance_per_day ?? 0),
    free_waiting_before: Number(payload.free_waiting_before ?? 0),
    free_waiting_after: Number(payload.free_waiting_after ?? 0),

    enable_shared_ride: Number(payload.enable_shared_ride ?? (payload.enable_ride_sharing ? 1 : 0)),
    enable_ride_sharing: payload.enable_ride_sharing ?? !!payload.enable_shared_ride,
    price_per_seat: Number(payload.price_per_seat ?? 0),
    shared_price_per_distance: Number(payload.shared_price_per_distance ?? 0),
    shared_cancel_fee: Number(payload.shared_cancel_fee ?? 0),

    user_cancellation_fee: Number(payload.user_cancellation_fee ?? payload.cancellation_fee_for_user ?? 0),
    driver_cancellation_fee: Number(payload.driver_cancellation_fee ?? payload.cancellation_fee_for_driver ?? 0),
    cancellation_fee_goes_to: payload.cancellation_fee_goes_to ?? payload.fee_goes_to ?? 'admin',
    user_cancellation_fee_type: payload.user_cancellation_fee_type || 'percentage',
    driver_cancellation_fee_type: payload.driver_cancellation_fee_type || 'percentage',

    order_number: Number(payload.order_number ?? payload.eta_sequence ?? 1),
    bill_status: Number(payload.bill_status ?? 1),
    status: payload.status || 'active',
  });

  publicVehicleCatalogCache = { value: null, expiresAt: 0 };
  return setPrice.toObject();
};

export const updateSetPrice = async (id, payload, currentAdmin = null) => {
  const setPrice = await SetPrice.findById(id);
  if (!setPrice) throw new ApiError(404, 'Set Price not found');
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'set_prices.view', 'set prices');
    if (setPrice.zone_id) {
      await assertZoneAccess(currentAdmin, setPrice.zone_id);
    } else {
      assertServiceLocationAccess(currentAdmin, setPrice.service_location_id);
    }
  }

  const fields = [
    'zone_id', 'vehicle_type', 'service_location_id', 'transport_type',
    'pricing_scope', 'package_type_id', 'package_destination', 'package_availability',
    'payment_type', 'active', 'admin_commision_type', 'admin_commision',
    'admin_commission_type_from_driver', 'admin_commission_from_driver',
    'service_tax', 'airport_surge', 'support_airport_fee', 'support_outstation',
    'enable_airport_ride', 'enable_outstation_ride',
    'base_price', 'base_distance', 'price_per_distance', 'time_price',
    'waiting_charge', 'outstation_base_price', 'outstation_base_distance',
    'outstation_price_per_distance', 'outstation_time_price',
    'outstation_round_trip_price_per_distance', 'outstation_min_km_per_day', 'outstation_driver_allowance_per_day',
    'free_waiting_before', 'free_waiting_after',
    'enable_shared_ride', 'enable_ride_sharing', 'price_per_seat',
    'shared_price_per_distance', 'shared_cancel_fee',
    'user_cancellation_fee', 'driver_cancellation_fee', 'cancellation_fee_goes_to',
    'user_cancellation_fee_type', 'driver_cancellation_fee_type',
    'order_number', 'bill_status', 'status'
  ];

  const nonNegativeFields = new Set([
    'admin_commision',
    'admin_commission_from_driver',
    'service_tax',
    'airport_surge',
    'support_airport_fee',
    'support_outstation',
    'base_price',
    'base_distance',
    'price_per_distance',
    'time_price',
    'waiting_charge',
    'outstation_base_price',
    'outstation_base_distance',
    'outstation_price_per_distance',
    'outstation_time_price',
    'outstation_round_trip_price_per_distance',
    'outstation_min_km_per_day',
    'outstation_driver_allowance_per_day',
    'free_waiting_before',
    'free_waiting_after',
    'price_per_seat',
    'shared_price_per_distance',
    'shared_cancel_fee',
    'user_cancellation_fee',
    'driver_cancellation_fee',
    'order_number',
  ]);

  const requestedVehicleTypeId =
    payload.vehicle_type?._id || payload.vehicle_type?.id || payload.vehicle_type || payload.type_id;
  const shouldReconcileVehicleTransport =
    payload.transport_type !== undefined || requestedVehicleTypeId !== undefined;

  let reconciledVehicleAndTransport = null;
  if (shouldReconcileVehicleTransport) {
    reconciledVehicleAndTransport = await resolveSetPriceVehicleAndTransportType({
      vehicleTypeId: requestedVehicleTypeId,
      transportType: payload.transport_type,
      fallbackVehicleTypeId: setPrice.vehicle_type,
      fallbackTransportType: setPrice.transport_type || 'taxi',
    });
  }

  for (const field of fields) {
    let value = payload[field];

    if (field === 'zone_id') value = payload.zone_id?._id || payload.zone_id?.id || payload.zone_id;
    if (field === 'vehicle_type' && reconciledVehicleAndTransport) value = reconciledVehicleAndTransport.vehicleTypeId;
    if (field === 'vehicle_type' && !reconciledVehicleAndTransport) value = payload.vehicle_type?._id || payload.vehicle_type?.id || payload.vehicle_type || payload.type_id;
    if (field === 'service_location_id') {
      const payloadServiceLocationId =
        payload.service_location_id?._id
        || payload.service_location_id?.id
        || payload.service_location_id
        || payload.zone?.service_location?._id
        || payload.zone?.service_location?.id
        || payload.zone?.service_location_id;
      const zoneValue = payload.zone_id?._id || payload.zone_id?.id || payload.zone_id || setPrice.zone_id;
      const zone = zoneValue ? await Zone.findById(zoneValue).select('_id service_location_id').lean() : null;
      value = zone?.service_location_id || payloadServiceLocationId;
    }
    if (field === 'package_type_id') value = payload.package_type_id?._id || payload.package_type_id?.id || payload.package_type_id;
    if (field === 'transport_type' && reconciledVehicleAndTransport) value = reconciledVehicleAndTransport.transportType;
    if (field === 'transport_type' && !reconciledVehicleAndTransport && value !== undefined) value = normalizeVehicleTransportType(value);

    if (currentAdmin && value !== undefined) {
      if (field === 'zone_id' && value) {
        assertZoneAccess(currentAdmin, value);
      }
      if (field === 'service_location_id' && value) {
        assertServiceLocationAccess(currentAdmin, value);
      }
    }

    if (value === undefined) {
      if (field === 'admin_commision') value = payload.customer_commission;
      if (field === 'admin_commision_type') value = payload.customer_commission_type === 'percentage' ? 1 : (payload.customer_commission_type === 'fixed' ? 0 : undefined);
      if (field === 'order_number') value = payload.eta_sequence;
      if (field === 'user_cancellation_fee') value = payload.cancellation_fee_for_user;
      if (field === 'driver_cancellation_fee') value = payload.cancellation_fee_for_driver;
      if (field === 'cancellation_fee_goes_to') value = payload.fee_goes_to;
      if (field === 'enable_ride_sharing') value = payload.enable_shared_ride !== undefined ? !!payload.enable_shared_ride : undefined;
    }

    if (value !== undefined) {
      if (field.includes('_id') || field === 'vehicle_type') {
        setPrice[field] = value ? toObjectId(value) : null;
      } else if (field === 'payment_type') {
        setPrice[field] = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(',').map(s => s.trim()) : value);
      } else if (typeof setPrice[field] === 'number' || ['admin_commision', 'service_tax', 'base_price', 'base_distance', 'price_per_distance', 'time_price', 'order_number'].includes(field)) {
        const numericValue = Number(value);
        setPrice[field] = nonNegativeFields.has(field)
          ? Math.max(0, numericValue)
          : numericValue;
      } else {
        setPrice[field] = value;
      }
    }
  }

  if (payload.package_vehicle_prices !== undefined) {
    setPrice.package_vehicle_prices = Array.isArray(payload.package_vehicle_prices)
      ? payload.package_vehicle_prices.map((item) => normalizePackageVehiclePriceItem(item))
      : [];
  }

  await setPrice.save();
  publicVehicleCatalogCache = { value: null, expiresAt: 0 };
  return setPrice.toObject();
};

export const deleteSetPrice = async (id, currentAdmin = null) => {
  if (currentAdmin) {
    const setPrice = await SetPrice.findById(id).select('service_location_id zone_id').lean();
    if (!setPrice) throw new ApiError(404, 'Set Price not found');
    assertAdminPermission(currentAdmin, 'set_prices.view', 'set prices');
    if (setPrice.zone_id) {
      await assertZoneAccess(currentAdmin, setPrice.zone_id);
    } else {
      assertServiceLocationAccess(currentAdmin, setPrice.service_location_id);
    }
  }
  const deleted = await SetPrice.findByIdAndDelete(id);
  if (!deleted) throw new ApiError(404, 'Set Price not found');
  publicVehicleCatalogCache = { value: null, expiresAt: 0 };
  return true;
};

const normalizeAdminEarningOption = (value) => String(value || '').trim();

const formatAdminEarningDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const getRideCompletedDate = (ride) => formatAdminEarningDate(ride.completedAt || ride.updatedAt || ride.createdAt);

const matchesAdminEarningDateRange = (ride, startDate, endDate) => {
  if (!startDate && !endDate) return true;

  const completedDate = getRideCompletedDate(ride);
  if (!completedDate) return false;

  if (startDate && completedDate < startDate) return false;
  if (endDate && completedDate > endDate) return false;
  return true;
};

const groupAdminEarnings = (rows, keyGetter, labelGetter) => {
  const map = new Map();

  rows.forEach((row) => {
    const key = keyGetter(row) || 'unknown';
    const label = labelGetter(row) || 'Unknown';
    const current = map.get(key) || {
      key,
      label,
      trips: 0,
      grossFare: 0,
      adminCommission: 0,
      driverEarnings: 0,
    };

    current.trips += 1;
    current.grossFare += row.grossFare;
    current.adminCommission += row.adminCommission;
    current.driverEarnings += row.driverEarnings;
    map.set(key, current);
  });

  return [...map.values()]
    .map((item) => ({
      ...item,
      grossFare: Number(item.grossFare.toFixed(2)),
      adminCommission: Number(item.adminCommission.toFixed(2)),
      driverEarnings: Number(item.driverEarnings.toFixed(2)),
    }))
    .sort((a, b) => b.adminCommission - a.adminCommission);
};

const dateMatch = (startDate, endDate) => {
  const range = {};
  if (startDate) range.$gte = startDate;
  if (endDate) range.$lte = endDate;
  return range;
};

/// Money figures that do not come from rides: refunds credited to riders, withdrawals drivers are waiting on, and what
/// sits in driver wallets. Zone and vehicle filters do not apply to these.
const getAdminEarningExtras = async ({ startDate, endDate }) => {
  const range = dateMatch(startDate, endDate);
  const [refunds, pending, wallets] = await Promise.all([
    UserWallet.aggregate([
      { $unwind: '$transactions' },
      {
        $match: {
          'transactions.kind': 'credit',
          'transactions.title': /refund/i,
          ...(Object.keys(range).length ? { 'transactions.createdAt': range } : {}),
        },
      },
      { $group: { _id: null, amount: { $sum: '$transactions.amount' }, count: { $sum: 1 } } },
    ]),
    // Every withdrawal by status. A pending request is owed now, whenever it
    // was made, so these are not limited to the date range.
    WithdrawalRequest.aggregate([
      { $group: { _id: '$status', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Driver.aggregate([
      { $match: { 'wallet.balance': { $gt: 0 } } },
      { $group: { _id: null, amount: { $sum: '$wallet.balance' } } },
    ]),
  ]);
  const money = (value) => Number(Number(value || 0).toFixed(2));
  const byStatus = (...statuses) => pending
    .filter((row) => statuses.includes(String(row._id || '').toLowerCase()))
    .reduce((acc, row) => ({ amount: acc.amount + Number(row.amount || 0), count: acc.count + row.count }), { amount: 0, count: 0 });
  const waiting = byStatus('pending', 'processing', 'approved');
  const paid = byStatus('completed', 'paid', 'success');
  const failed = byStatus('rejected', 'failed', 'declined', 'cancelled');
  return {
    withdrawalsPaid: money(paid.amount),
    withdrawalsPaidCount: paid.count,
    withdrawalsFailed: money(failed.amount),
    withdrawalsFailedCount: failed.count,
    refunds: money(refunds[0]?.amount),
    refundCount: refunds[0]?.count || 0,
    pendingSettlements: money(waiting.amount),
    pendingSettlementCount: waiting.count,
    driverWalletHeld: money(wallets[0]?.amount),
  };
};

export const getAdminEarnings = async (query = {}) => {
  const {
    from,
    to,
    zone,
    vehicle,
    riderType,
    paymentMethod,
    search,
    page = 1,
    limit = 10,
  } = query;

  const startDate = from ? new Date(from) : null;
  const endDate = to ? new Date(to) : null;

  if (startDate && Number.isNaN(startDate.getTime())) {
    throw new ApiError(400, 'Invalid from date');
  }

  if (endDate && Number.isNaN(endDate.getTime())) {
    throw new ApiError(400, 'Invalid to date');
  }

  if (endDate) {
    endDate.setHours(23, 59, 59, 999);
  }

  const rides = await Ride.find({ status: RIDE_STATUS.COMPLETED })
    .setOptions({ strictPopulate: false })
    .sort({ completedAt: -1, updatedAt: -1, createdAt: -1 })
    .populate('userId', 'name phone')
    .populate({
      path: 'driverId',
      select: 'name phone vehicleType vehicleNumber zoneId zone service_location_id',
      populate: [
        { path: 'zoneId', select: 'name', strictPopulate: false },
        { path: 'zone', select: 'name', strictPopulate: false },
      ],
      strictPopulate: false,
    })
    .populate('vehicleTypeId', 'name type_name transport_type icon_types')
    .lean();

  const zoneFilter = normalizeAdminEarningOption(zone);
  const vehicleFilter = normalizeAdminEarningOption(vehicle);
  const riderTypeFilter = normalizeAdminEarningOption(riderType).toLowerCase();
  const paymentFilter = normalizeAdminEarningOption(paymentMethod).toLowerCase();
  const searchFilter = normalizeAdminEarningOption(search).toLowerCase();

  let rows = rides
    .filter((ride) => matchesAdminEarningDateRange(ride, startDate, endDate))
    .map((ride) => {
      const vehicleDoc = ride.vehicleTypeId || {};
      const driver = ride.driverId || {};
      const zoneDoc = (driver.zoneId && typeof driver.zoneId === 'object' && driver.zoneId.name)
        ? driver.zoneId
        : (driver.zone && typeof driver.zone === 'object' && driver.zone.name)
        ? driver.zone
        : (driver.zoneId || driver.zone || {});
      const requestId = `REQ_${String(ride._id).slice(-12).toUpperCase()}`;
      const grossFare = Number(ride.fare || 0);
      const adminCommission = Number(ride.commissionAmount || 0);
      const driverEarnings = Number(ride.driverEarnings || Math.max(grossFare - adminCommission, 0));
      const completedDate = getRideCompletedDate(ride);

      return {
        id: String(ride._id),
        requestId,
        completedAt: completedDate,
        userName: ride.userId?.name || 'Unknown Rider',
        userPhone: ride.userId?.phone || '',
        driverName: driver.name || 'Unassigned Driver',
        driverPhone: driver.phone || '',
        riderType: ride.serviceType || 'ride',
        // How it was actually paid - a cash booking paid online at the end
        // counts as online, which the booking method alone got wrong.
        paymentMethod: describeRidePayment(ride).method,
        paymentDetail: describeRidePayment(ride).detail,
        driverId: driver?._id ? String(driver._id) : '',
        zoneId: zoneDoc?._id ? String(zoneDoc._id) : '',
        zoneName: zoneDoc?.name || 'Unmapped Zone',
        vehicleId: vehicleDoc?._id ? String(vehicleDoc._id) : '',
        vehicleName: vehicleDoc?.name || vehicleDoc?.type_name || ride.vehicleIconType || driver.vehicleType || 'Vehicle',
        transportType: vehicleDoc?.transport_type || ride.transport_type || 'taxi',
        grossFare: Number(grossFare.toFixed(2)),
        adminCommission: Number(adminCommission.toFixed(2)),
        driverEarnings: Number(driverEarnings.toFixed(2)),
        commissionRate: Number(ride.pricingSnapshot?.admin_commission_from_driver || 0),
        commissionType: Number(ride.pricingSnapshot?.admin_commission_type_from_driver || 1) === 1 ? 'percentage' : 'fixed',
      };
    });

  if (zoneFilter) {
    rows = rows.filter((row) => row.zoneId === zoneFilter || row.zoneName.toLowerCase() === zoneFilter.toLowerCase());
  }

  if (vehicleFilter) {
    rows = rows.filter((row) => row.vehicleId === vehicleFilter || row.vehicleName.toLowerCase() === vehicleFilter.toLowerCase());
  }

  if (riderTypeFilter) {
    rows = rows.filter((row) => String(row.riderType || '').toLowerCase() === riderTypeFilter);
  }

  if (paymentFilter) {
    rows = rows.filter((row) => String(row.paymentMethod || '').toLowerCase() === paymentFilter);
  }

  if (searchFilter) {
    rows = rows.filter((row) =>
      [
        row.requestId,
        row.userName,
        row.userPhone,
        row.driverName,
        row.driverPhone,
        row.zoneName,
        row.vehicleName,
        row.riderType,
        row.paymentMethod,
      ].some((value) => String(value || '').toLowerCase().includes(searchFilter)),
    );
  }

  const totals = rows.reduce(
    (acc, row) => {
      acc.totalTrips += 1;
      acc.grossFare += row.grossFare;
      acc.adminCommission += row.adminCommission;
      acc.driverEarnings += row.driverEarnings;
      if (row.paymentMethod === 'cash') acc.byCash += row.adminCommission;
      if (row.paymentMethod === 'online') acc.byOnline += row.adminCommission;
      return acc;
    },
    { totalTrips: 0, grossFare: 0, adminCommission: 0, driverEarnings: 0, byCash: 0, byOnline: 0 },
  );

  const roundedTotals = Object.fromEntries(
    Object.entries(totals).map(([key, value]) => [key, typeof value === 'number' ? Number(value.toFixed(2)) : value]),
  );

  // The cards that were estimates in the browser (5% / 1.5% / 8% of other
  // figures) now come from the records themselves.
  const extras = await getAdminEarningExtras({ startDate, endDate });
  const netPlatformRevenue = roundedTotals.adminCommission - extras.refunds;

  return {
    summary: {
      ...roundedTotals,
      averageCommission: rows.length ? Number((totals.adminCommission / rows.length).toFixed(2)) : 0,
      refunds: extras.refunds,
      refundCount: extras.refundCount,
      netPlatformRevenue: Number(netPlatformRevenue.toFixed(2)),
      pendingSettlements: extras.pendingSettlements,
      pendingSettlementCount: extras.pendingSettlementCount,
      driverWalletHeld: extras.driverWalletHeld,
      withdrawalsPaid: extras.withdrawalsPaid,
      withdrawalsPaidCount: extras.withdrawalsPaidCount,
      withdrawalsFailed: extras.withdrawalsFailed,
      withdrawalsFailedCount: extras.withdrawalsFailedCount,
    },
    breakdowns: {
      zones: groupAdminEarnings(rows, (row) => row.zoneId, (row) => row.zoneName),
      vehicles: groupAdminEarnings(rows, (row) => row.vehicleId, (row) => row.vehicleName),
      riderTypes: groupAdminEarnings(rows, (row) => row.riderType, (row) => row.riderType),
    },
    filters: {
      from: from || '',
      to: to || '',
      zone: zoneFilter,
      vehicle: vehicleFilter,
      riderType: riderTypeFilter,
      paymentMethod: paymentFilter,
      search: searchFilter,
    },
    ...buildPaginator(rows, Number(page) || 1, Number(limit) || 10),
  };
};

/**
 * The numbers on the dashboard that describe this moment rather than the day.
 *
 * Kept out of the 60-second snapshot cache: a minute-old count of who is
 * online is not a live count, and these are four cheap counts.
 *
 * Riders are counted from their socket connections, since - unlike drivers -
 * a rider has no online flag to read. Every socket joins a room named after
 * its owner, so counting distinct participant rooms counts people rather than
 * open tabs. fetchSockets() goes through the Redis adapter, so it sees all
 * four API processes, not just the one answering this request.
 */
const getLiveDashboardStats = async () => {
  // Whether each dependency is actually answering, rather than a panel of
  // hardcoded green "Operational" labels that stayed green during an outage.
  const checkSystemHealth = async () => {
    const io = getSocketServer();
    const mongoState = mongoose.connection?.readyState; // 1 = connected
    const redis = getRedisStatus();
    const mapKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_SERVER_KEY || '';

    return {
      database: mongoState === 1 ? 'operational' : 'down',
      socket: io ? 'connected' : 'down',
      redis: !redis.configured ? 'not configured' : redis.ready ? 'healthy' : 'down',
      maps: mapKey ? 'operational' : 'not configured',
    };
  };

  const countConnectedRiders = async () => {
    const io = getSocketServer();
    if (!io) return 0;

    const sockets = await io.in(getPresenceRoleRoom('user')).fetchSockets();
    const riders = new Set();

    for (const socket of sockets) {
      for (const room of socket.rooms) {
        if (String(room).startsWith('presence:participant:user:')) riders.add(room);
      }
    }

    return riders.size;
  };

  const [
    onlineCustomers,
    onlineDrivers,
    driversOnTrip,
    ongoingTrips,
    ongoingCityRides,
    ongoingParcels,
    ongoingOutstations,
    pendingApprovals,
    systemHealth,
    sosActive,
    sosResolved,
    driverPositions,
  ] = await Promise.all([
    countConnectedRiders().catch(() => 0),
    Driver.countDocuments({ isOnline: true }),
    Driver.countDocuments({ isOnRide: true }),
    // Live ongoing trips across all services
    Ride.countDocuments({ status: { $in: [RIDE_STATUS.SEARCHING, RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING] } }),
    Ride.countDocuments({ serviceType: 'ride', status: { $in: [RIDE_STATUS.SEARCHING, RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING] } }),
    Ride.countDocuments({ serviceType: 'parcel', status: { $in: [RIDE_STATUS.SEARCHING, RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING] } }),
    Ride.countDocuments({ serviceType: { $in: ['outstation', 'intercity'] }, status: { $in: [RIDE_STATUS.SEARCHING, RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING] } }),
    Driver.countDocuments({ approve: false }),
    checkSystemHealth().catch(() => ({})),
    SafetyAlert.countDocuments({ status: 'active' }),
    SafetyAlert.countDocuments({ status: 'resolved' }),
    Driver.find(
      { isOnline: true, 'location.coordinates.0': { $exists: true } },
      { name: 1, isOnRide: 1, vehicleType: 1, location: 1 },
    ).limit(500).lean(),
  ]);

  return {
    onlineCustomers,
    onlineDrivers,
    driversOnTrip,
    ongoingTrips,
    ongoingCityRides,
    ongoingParcels,
    ongoingOutstations,
    pendingApprovals,
    systemHealth,
    sos: { active: sosActive, resolved: sosResolved },
    driverPositions: driverPositions.map((driver) => ({
      id: String(driver._id),
      name: driver.name || 'Driver',
      onTrip: Boolean(driver.isOnRide),
      vehicleType: driver.vehicleType || '',
      lng: driver.location?.coordinates?.[0],
      lat: driver.location?.coordinates?.[1],
    })),
  };
};

export const getDashboardData = async () => {
  const live = await getLiveDashboardStats();

  if (dashboardCache.value && dashboardCache.expiresAt > Date.now()) {
    return { ...dashboardCache.value, live };
  }

  const [totalUsers, totalDrivers, approvedDrivers, rides, recentRides, supportTicketStats] = await Promise.all([
    User.countDocuments(),
    Driver.countDocuments(),
    Driver.countDocuments({ approve: true }),
    Ride.find()
      .select('status liveStatus fare paymentMethod commissionAmount driverEarnings driverId serviceType intercity parcel pickupAddress dropAddress createdAt updatedAt completedAt')
      .sort({ createdAt: -1 })
      .lean(),
    Ride.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('userId', 'name phone')
      .populate('driverId', 'name phone vehicleType vehicleNumber')
      .lean(),
    SupportTicket.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const getRideEventDate = (ride) => {
    const status = String(ride?.status || '').toLowerCase();
    if (status === RIDE_STATUS.COMPLETED) {
      return ride?.completedAt || ride?.updatedAt || ride?.createdAt || null;
    }
    if (status === RIDE_STATUS.CANCELLED) {
      return ride?.updatedAt || ride?.createdAt || null;
    }
    return ride?.createdAt || ride?.updatedAt || null;
  };

  const isWithinRange = (date, rangeStart, rangeEnd) => {
    const value = date ? new Date(date) : null;
    if (!value || Number.isNaN(value.getTime())) return false;
    return value >= rangeStart && value <= rangeEnd;
  };

  const isCompletedRide = (ride) => String(ride?.status || '').toLowerCase() === RIDE_STATUS.COMPLETED;
  const isCancelledRide = (ride) => String(ride?.status || '').toLowerCase() === RIDE_STATUS.CANCELLED;
  const isScheduledRide = (ride) => !isCompletedRide(ride) && !isCancelledRide(ride);

  const completedRides = rides.filter(isCompletedRide);
  const cancelledRides = rides.filter(isCancelledRide);
  const scheduledRides = rides.filter(isScheduledRide);

  const todayCompletedRides = completedRides.filter((ride) => isWithinRange(getRideEventDate(ride), startOfToday, endOfToday));
  const todayCancelledRides = cancelledRides.filter((ride) => isWithinRange(getRideEventDate(ride), startOfToday, endOfToday));
  const todayScheduledRides = scheduledRides.filter((ride) => isWithinRange(getRideEventDate(ride), startOfToday, endOfToday));

  const sumFare = (items) =>
    items.reduce((total, ride) => total + Number(ride?.fare || 0), 0);
  const sumCommission = (items) =>
    items.reduce((total, ride) => {
      const fare = Number(ride?.fare || 0);
      const explicitCommission = Number(ride?.commissionAmount);
      const fallbackCommission = Math.max(fare - Number(ride?.driverEarnings || 0), 0);
      return total + (Number.isFinite(explicitCommission) ? explicitCommission : fallbackCommission);
    }, 0);
  const sumDriverEarnings = (items) =>
    items.reduce((total, ride) => {
      const fare = Number(ride?.fare || 0);
      const commission = Number(ride?.commissionAmount || 0);
      const earning = Number.isFinite(Number(ride?.driverEarnings))
        ? Number(ride?.driverEarnings)
        : Math.max(fare - commission, 0);
      return total + earning;
    }, 0);

  const totalOverallFare = sumFare(completedRides);
  const totalTodayFare = sumFare(todayCompletedRides);
  const totalOverallCommission = sumCommission(completedRides);
  const totalTodayCommission = sumCommission(todayCompletedRides);
  const totalOverallDriverEarnings = sumDriverEarnings(completedRides);
  const totalTodayDriverEarnings = sumDriverEarnings(todayCompletedRides);

  const overallByCash = sumFare(completedRides.filter((ride) => String(ride?.paymentMethod || 'cash').toLowerCase() === 'cash'));
  const overallByCard = sumFare(completedRides.filter((ride) => String(ride?.paymentMethod || '').toLowerCase() === 'online'));
  const todayByCash = sumFare(todayCompletedRides.filter((ride) => String(ride?.paymentMethod || 'cash').toLowerCase() === 'cash'));
  const todayByCard = sumFare(todayCompletedRides.filter((ride) => String(ride?.paymentMethod || '').toLowerCase() === 'online'));

  const buildRecentMonthKeys = (monthCount = 4) => {
    const months = [];
    for (let index = monthCount - 1; index >= 0; index -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      months.push({
        key,
        label: date.toLocaleString('en-IN', { month: 'short' }),
      });
    }
    return months;
  };

  const recentMonths = buildRecentMonthKeys(4);
  const recentMonthMap = new Map(
    recentMonths.map((month) => [
      month.key,
      {
        ...month,
        amount: 0,
        total: 0,
        byUser: 0,
        byDriver: 0,
        noDriver: 0,
      },
    ]),
  );

  completedRides.forEach((ride) => {
    const eventDate = getRideEventDate(ride);
    if (!eventDate) return;
    const date = new Date(eventDate);
    if (Number.isNaN(date.getTime())) return;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const month = recentMonthMap.get(key);
    if (!month) return;
    month.amount += Number(ride?.fare || 0);
  });

  cancelledRides.forEach((ride) => {
    const eventDate = getRideEventDate(ride);
    if (!eventDate) return;
    const date = new Date(eventDate);
    if (Number.isNaN(date.getTime())) return;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const month = recentMonthMap.get(key);
    if (!month) return;
    month.total += 1;
    if (!ride?.driverId) {
      month.noDriver += 1;
    } else {
      month.byUser += 1;
    }
  });

  const overallChart = recentMonths.map((month) => {
    const entry = recentMonthMap.get(month.key);
    return {
      label: month.label,
      amount: Number((entry?.amount || 0).toFixed(2)),
    };
  });

  const cancelChartSeries = recentMonths.map((month) => {
    const entry = recentMonthMap.get(month.key);
    return {
      label: month.label,
      total: entry?.total || 0,
      byUser: entry?.byUser || 0,
      byDriver: entry?.byDriver || 0,
      noDriver: entry?.noDriver || 0,
    };
  });

  const supportTicketCounts = supportTicketStats.reduce(
    (acc, item) => {
      const key = String(item?._id || '').toLowerCase();
      acc[key] = Number(item?.count || 0);
      return acc;
    },
    { pending: 0, assigned: 0, closed: 0 },
  );

  const normalizeServiceCategory = (ride) => {
    const s = String(ride?.serviceType || '').toLowerCase().trim();
    if (s === 'parcel') return 'parcel';
    if (s === 'outstation' || s === 'intercity' || (ride?.intercity && (ride.intercity.toCity || ride.intercity.fromCity))) {
      return 'outstation';
    }
    return 'ride';
  };

  const createServiceStatTracker = () => ({
    total: 0,
    completed: 0,
    cancelled: 0,
    ongoing: 0,
    grossFare: 0,
    adminCommission: 0,
    driverEarnings: 0,
    averageFare: 0,
    todayTotal: 0,
    todayCompleted: 0,
    todayGrossFare: 0,
    todayCommission: 0,
  });

  const servicesBreakdown = {
    ride: createServiceStatTracker(),
    parcel: createServiceStatTracker(),
    outstation: createServiceStatTracker(),
  };

  rides.forEach((ride) => {
    const cat = normalizeServiceCategory(ride);
    const target = servicesBreakdown[cat] || servicesBreakdown.ride;
    const isComp = isCompletedRide(ride);
    const isCanc = isCancelledRide(ride);
    const isOng = !isComp && !isCanc;
    const eventDate = getRideEventDate(ride);
    const isToday = isWithinRange(eventDate, startOfToday, endOfToday);
    const fare = Number(ride.fare || 0);
    const comm = Number.isFinite(Number(ride.commissionAmount))
      ? Number(ride.commissionAmount)
      : Math.max(fare - Number(ride.driverEarnings || 0), 0);
    const driverEarn = Number.isFinite(Number(ride.driverEarnings))
      ? Number(ride.driverEarnings)
      : Math.max(fare - comm, 0);

    target.total += 1;
    if (isComp) {
      target.completed += 1;
      target.grossFare += fare;
      target.adminCommission += comm;
      target.driverEarnings += driverEarn;
    } else if (isCanc) {
      target.cancelled += 1;
    } else if (isOng) {
      target.ongoing += 1;
    }

    if (isToday) {
      target.todayTotal += 1;
      if (isComp) {
        target.todayCompleted += 1;
        target.todayGrossFare += fare;
        target.todayCommission += comm;
      }
    }
  });

  Object.keys(servicesBreakdown).forEach((k) => {
    const s = servicesBreakdown[k];
    s.grossFare = Number(s.grossFare.toFixed(2));
    s.adminCommission = Number(s.adminCommission.toFixed(2));
    s.driverEarnings = Number(s.driverEarnings.toFixed(2));
    s.averageFare = s.completed > 0 ? Number((s.grossFare / s.completed).toFixed(2)) : 0;
    s.todayGrossFare = Number(s.todayGrossFare.toFixed(2));
    s.todayCommission = Number(s.todayCommission.toFixed(2));
  });

  const recentBookings = (recentRides || []).map((r) => {
    const cat = normalizeServiceCategory(r);
    let routeSummary = '';
    if (cat === 'outstation') {
      routeSummary = `${r.intercity?.fromCity || r.pickupAddress || 'Origin'} ➔ ${r.intercity?.toCity || r.dropAddress || 'Destination'}`;
    } else {
      routeSummary = `${r.pickupAddress || 'Pickup'} ➔ ${r.dropAddress || 'Drop'}`;
    }

    return {
      id: String(r._id),
      requestId: `REQ_${String(r._id).slice(-8).toUpperCase()}`,
      serviceType: cat,
      serviceLabel: cat === 'parcel' ? 'Parcel Delivery' : cat === 'outstation' ? 'Outstation Trip' : 'City Ride',
      customerName: r.userId?.name || 'Customer',
      customerPhone: r.userId?.phone || '',
      driverName: r.driverId?.name || (r.status === RIDE_STATUS.SEARCHING ? 'Finding Driver...' : 'Unassigned'),
      driverPhone: r.driverId?.phone || '',
      fare: Number(Number(r.fare || 0).toFixed(2)),
      commissionAmount: Number(Number(r.commissionAmount || 0).toFixed(2)),
      paymentMethod: describeRidePayment(r).method,
      status: r.status,
      liveStatus: r.liveStatus || r.status,
      route: routeSummary,
      createdAt: r.createdAt,
    };
  });

  const snapshot = {
    totalUsers,
    totalDrivers: {
      total: totalDrivers,
      approved: approvedDrivers,
      declined: totalDrivers - approvedDrivers
    },
    servicesBreakdown,
    recentBookings,
    total_earnings: Number(totalOverallFare.toFixed(2)),
    payment_success_rate: 99.4,
    notifiedSos: {
      total: supportTicketCounts.pending + supportTicketCounts.assigned,
      pending: supportTicketCounts.pending,
      assigned: supportTicketCounts.assigned,
      closed: supportTicketCounts.closed,
    },
    todayTrips: {
      total: todayCompletedRides.length + todayCancelledRides.length + todayScheduledRides.length,
      completed: todayCompletedRides.length,
      cancelled: todayCancelledRides.length,
      scheduled: todayScheduledRides.length,
    },
    overallTrips: {
      total: rides.length,
      completed: completedRides.length,
      cancelled: cancelledRides.length,
      scheduled: scheduledRides.length,
    },
    todayEarnings: {
      total: Number(totalTodayFare.toFixed(2)),
      by_cash: Number(todayByCash.toFixed(2)),
      by_wallet: 0,
      by_card: Number(todayByCard.toFixed(2)),
      admin_commission: Number(totalTodayCommission.toFixed(2)),
      driver_earnings: Number(totalTodayDriverEarnings.toFixed(2)),
    },
    overallEarnings: {
      total: Number(totalOverallFare.toFixed(2)),
      by_cash: Number(overallByCash.toFixed(2)),
      by_wallet: 0,
      by_card: Number(overallByCard.toFixed(2)),
      admin_commission: Number(totalOverallCommission.toFixed(2)),
      driver_earnings: Number(totalOverallDriverEarnings.toFixed(2)),
      chart: overallChart,
    },
    cancelChart: {
      total: cancelledRides.length,
      byUser: cancelledRides.filter((ride) => ride?.driverId).length,
      byDriver: 0,
      noDriver: cancelledRides.filter((ride) => !ride?.driverId).length,
      chart: cancelChartSeries,
    },
    // The drivers who actually completed the most trips, for the leaderboard
    // that used to list four invented partners ("Rydon Driver Node A").
    topDrivers: await (async () => {
      const tripsByDriver = new Map();

      for (const ride of completedRides) {
        if (!ride?.driverId) continue;
        const key = String(ride.driverId);
        tripsByDriver.set(key, (tripsByDriver.get(key) || 0) + 1);
      }

      const ranked = [...tripsByDriver.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (ranked.length === 0) return [];

      const drivers = await Driver.find(
        { _id: { $in: ranked.map(([id]) => id) } },
        { name: 1, rating: 1, isOnline: 1 },
      ).lean();
      const byId = new Map(drivers.map((driver) => [String(driver._id), driver]));

      return ranked
        .map(([id, trips]) => {
          const driver = byId.get(id);
          if (!driver) return null;
          return {
            id,
            name: driver.name || 'Driver',
            rating: Number(driver.rating || 0),
            trips,
            online: Boolean(driver.isOnline),
          };
        })
        .filter(Boolean);
    })(),
    performance_index: rides.length
      ? Number((((completedRides.length || 0) / rides.length) * 100).toFixed(1))
      : 0,
  };

  dashboardCache = {
    expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS,
    value: snapshot,
  };

  return { ...snapshot, live };
};

export const getOverallEarnings = async () => (await getDashboardData()).overallEarnings;
export const getTodayEarnings = async () => (await getDashboardData()).todayEarnings;
export const getCancelChart = async () => (await getDashboardData()).cancelChart;

export const listWithdrawals = async () => WithdrawalRequest.find().populate('driver_id').sort({ createdAt: -1 }).lean();

export const listZones = async (currentAdmin = null) => {
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'zones.view', 'zones');
  }
  const query = currentAdmin ? buildServiceLocationScopeQuery(currentAdmin) : {};
  const zones = await Zone.find(query)
    .populate('service_location_id', 'name service_location_name country timezone')
    .sort({ createdAt: -1 })
    .lean();

  return zones.map(serializeZone);
};

export const listServiceStores = async (currentAdmin = null) => {
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'service_stores.view', 'service stores');
  }
  const query = currentAdmin ? buildServiceLocationScopeQuery(currentAdmin) : {};
  const stores = await ServiceStore.find(query)
    .populate({
      path: 'zone_id',
      select: 'name service_location_id',
    })
    .populate('service_location_id', 'name service_location_name country')
    .sort({ createdAt: -1 })
    .lean();

  const storeIds = stores.map((store) => store._id).filter(Boolean);
  const staffItems = storeIds.length
    ? await ServiceCenterStaff.find({ serviceCenterId: { $in: storeIds } })
      .sort({ createdAt: -1 })
      .lean()
    : [];

  const staffByStoreId = new Map();
  staffItems.forEach((member) => {
    const storeId = String(member.serviceCenterId || '');
    if (!staffByStoreId.has(storeId)) {
      staffByStoreId.set(storeId, []);
    }
    staffByStoreId.get(storeId).push(member);
  });

  return stores.map((store) =>
    serializeServiceStore({
      ...store,
      staff: staffByStoreId.get(String(store._id)) || [],
    }),
  );
};

export const createServiceStore = async (payload, currentAdmin = null) => {
  const name = String(payload.name || '').trim();
  if (!name) {
    throw new ApiError(400, 'Service store name is required');
  }

  if (!payload.zone_id || !mongoose.isValidObjectId(payload.zone_id)) {
    throw new ApiError(400, 'A valid zone is required');
  }

  const zone = await Zone.findById(payload.zone_id).select('_id service_location_id').lean();
  if (!zone) {
    throw new ApiError(404, 'Zone not found');
  }
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'service_stores.view', 'service stores');
    await assertZoneAccess(currentAdmin, zone._id);
  }

  const point = normalizePointLocationPayload(payload);
  const status = payload.status || 'active';

  const store = await ServiceStore.create({
    name,
    zone_id: zone._id,
    service_location_id: zone.service_location_id || null,
    address: String(payload.address || '').trim(),
    owner_name: String(payload.owner_name || '').trim(),
    owner_phone: String(payload.owner_phone || '').trim(),
    rentalCommission: normalizeServiceStoreRentalCommission(payload.rentalCommission),
    ...point,
    status,
    active: status === 'active',
    approve: payload.approve !== false,
    rejectionReason: String(payload.rejectionReason || '').trim(),
    signupSource: payload.signupSource === 'self_signup' ? 'self_signup' : 'admin',
    onboarding: payload.onboarding || null,
  });

  const populatedStore = await ServiceStore.findById(store._id)
    .populate({
      path: 'zone_id',
      select: 'name service_location_id',
    })
    .populate('service_location_id', 'name service_location_name country')
    .lean();

  return serializeServiceStore({
    ...populatedStore,
    staff: [],
  });
};

export const updateServiceStore = async (id, payload, currentAdmin = null) => {
  const store = await ServiceStore.findById(id);
  if (!store) {
    throw new ApiError(404, 'Service store not found');
  }
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'service_stores.view', 'service stores');
    assertServiceLocationAccess(currentAdmin, store.service_location_id);
  }

  if (payload.name !== undefined) {
    const name = String(payload.name || '').trim();
    if (!name) {
      throw new ApiError(400, 'Service store name is required');
    }
    store.name = name;
  }

  if (payload.zone_id !== undefined) {
    if (!payload.zone_id || !mongoose.isValidObjectId(payload.zone_id)) {
      throw new ApiError(400, 'A valid zone is required');
    }

    const zone = await Zone.findById(payload.zone_id).select('_id service_location_id').lean();
    if (!zone) {
      throw new ApiError(404, 'Zone not found');
    }
    if (currentAdmin) {
      await assertZoneAccess(currentAdmin, zone._id);
    }

    store.zone_id = zone._id;
    store.service_location_id = zone.service_location_id || null;
  }

  if (payload.address !== undefined) {
    store.address = String(payload.address || '').trim();
  }

  if (payload.owner_name !== undefined) {
    store.owner_name = String(payload.owner_name || '').trim();
  }

  if (payload.owner_phone !== undefined) {
    store.owner_phone = String(payload.owner_phone || '').trim();
  }

  if (payload.rentalCommission !== undefined) {
    store.rentalCommission = normalizeServiceStoreRentalCommission(
      payload.rentalCommission,
      store.rentalCommission,
    );
  }

  if (payload.latitude !== undefined || payload.longitude !== undefined) {
    Object.assign(store, normalizePointLocationPayload(payload, store.toObject()));
  }

  if (payload.status !== undefined) {
    store.status = payload.status || 'active';
    store.active = store.status === 'active';
  }

  if (payload.approve !== undefined) {
    store.approve = payload.approve !== false;
    if (store.approve) {
      store.rejectionReason = '';
    }
  }

  if (payload.rejectionReason !== undefined) {
    store.rejectionReason = String(payload.rejectionReason || '').trim();
  }

  await store.save();

  const populatedStore = await ServiceStore.findById(store._id)
    .populate({
      path: 'zone_id',
      select: 'name service_location_id',
    })
    .populate('service_location_id', 'name service_location_name country')
    .lean();

  const staff = await ServiceCenterStaff.find({ serviceCenterId: store._id })
    .sort({ createdAt: -1 })
    .lean();

  return serializeServiceStore({
    ...populatedStore,
    staff,
  });
};

export const createServiceStoreStaff = async (storeId, payload, currentAdmin = null) => {
  const store = await ServiceStore.findById(storeId).select('_id service_location_id').lean();
  if (!store) {
    throw new ApiError(404, 'Service store not found');
  }

  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'service_stores.view', 'service stores');
    assertServiceLocationAccess(currentAdmin, store.service_location_id);
  }

  const name = String(payload?.name || '').trim();
  const phone = String(payload?.phone || '').replace(/\D/g, '').slice(-10);

  if (!name) {
    throw new ApiError(400, 'Staff name is required');
  }

  if (!/^\d{10}$/.test(phone)) {
    throw new ApiError(400, 'Staff login number must be a valid 10-digit number');
  }

  const existing = await ServiceCenterStaff.findOne({ phone }).lean();
  if (existing) {
    throw new ApiError(409, 'A staff account already exists with this number');
  }

  const created = await ServiceCenterStaff.create({
    serviceCenterId: store._id,
    name,
    phone,
    active: true,
    status: 'active',
    approve: payload?.approve !== false,
    rejectionReason: String(payload?.rejectionReason || '').trim(),
    signupSource: payload?.signupSource === 'self_signup' ? 'self_signup' : 'admin',
    onboarding: payload?.onboarding || null,
  });

  return {
    _id: created._id,
    id: created._id,
    name: created.name || '',
    phone: created.phone || '',
    active: created.active !== false,
    approve: created.approve !== false,
    status: created.status || (created.active === false ? 'inactive' : 'active'),
    createdAt: created.createdAt || null,
    updatedAt: created.updatedAt || null,
  };
};

export const listPendingServiceStoreSignups = async (currentAdmin = null) => {
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'service_stores.view', 'service stores');
  }

  const stores = await ServiceStore.find({
    signupSource: 'self_signup',
    approve: false,
  })
    .populate('service_location_id', 'name service_location_name country')
    .sort({ createdAt: -1 })
    .lean();

  return stores.map((item) => serializeServiceStore({ ...item, staff: [] }));
};

export const approveServiceStoreSignup = async (id, currentAdmin = null) => {
  const store = await ServiceStore.findById(id);
  if (!store) {
    throw new ApiError(404, 'Service center request not found');
  }

  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'service_stores.view', 'service stores');
  }

  store.approve = true;
  store.rejectionReason = '';
  store.active = store.status !== 'inactive';
  await store.save();

  const populated = await ServiceStore.findById(store._id)
    .populate('service_location_id', 'name service_location_name country')
    .lean();

  return serializeServiceStore({ ...populated, staff: [] });
};

export const rejectServiceStoreSignup = async (id, payload = {}, currentAdmin = null) => {
  const store = await ServiceStore.findById(id);
  if (!store) {
    throw new ApiError(404, 'Service center request not found');
  }

  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'service_stores.view', 'service stores');
  }

  store.approve = false;
  store.rejectionReason = String(payload?.rejectionReason || payload?.reason || 'Rejected by admin').trim();
  await store.save();

  const populated = await ServiceStore.findById(store._id)
    .populate('service_location_id', 'name service_location_name country')
    .lean();

  return serializeServiceStore({ ...populated, staff: [] });
};

export const listPendingServiceCenterStaffSignups = async (currentAdmin = null) => {
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'service_stores.view', 'service stores');
  }

  const staff = await ServiceCenterStaff.find({
    signupSource: 'self_signup',
    approve: false,
  })
    .populate('serviceCenterId', 'name address owner_phone')
    .sort({ createdAt: -1 })
    .lean();

  return staff.map((item) => ({
    _id: item._id,
    id: item._id,
    name: item.name || '',
    phone: item.phone || '',
    approve: item.approve !== false,
    status: item.approve === false ? 'pending' : item.status,
    rejectionReason: item.rejectionReason || '',
    signupSource: item.signupSource || 'admin',
    serviceCenterId: item.serviceCenterId?._id || item.serviceCenterId || null,
    serviceCenterName: item.serviceCenterId?.name || item.onboarding?.roleDetails?.serviceCenterName || '',
    serviceCenterAddress: item.serviceCenterId?.address || item.onboarding?.roleDetails?.serviceCenterAddress || '',
    onboarding: item.onboarding || null,
    createdAt: item.createdAt || null,
  }));
};

export const approveServiceCenterStaffSignup = async (id, currentAdmin = null) => {
  const staff = await ServiceCenterStaff.findById(id);
  if (!staff) {
    throw new ApiError(404, 'Service staff request not found');
  }

  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'service_stores.view', 'service stores');
  }

  staff.approve = true;
  staff.rejectionReason = '';
  staff.active = true;
  if (!staff.status) {
    staff.status = 'active';
  }
  await staff.save();

  return {
    _id: staff._id,
    id: staff._id,
    name: staff.name || '',
    phone: staff.phone || '',
    approve: staff.approve,
    status: staff.status,
  };
};

export const rejectServiceCenterStaffSignup = async (id, payload = {}, currentAdmin = null) => {
  const staff = await ServiceCenterStaff.findById(id);
  if (!staff) {
    throw new ApiError(404, 'Service staff request not found');
  }

  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'service_stores.view', 'service stores');
  }

  staff.approve = false;
  staff.rejectionReason = String(payload?.rejectionReason || payload?.reason || 'Rejected by admin').trim();
  await staff.save();

  return {
    _id: staff._id,
    id: staff._id,
    name: staff.name || '',
    phone: staff.phone || '',
    approve: staff.approve,
    status: staff.approve === false ? 'pending' : staff.status,
    rejectionReason: staff.rejectionReason || '',
  };
};

export const deleteServiceStore = async (id, currentAdmin = null) => {
  if (currentAdmin) {
    const existingStore = await ServiceStore.findById(id).select('service_location_id').lean();
    if (!existingStore) {
      throw new ApiError(404, 'Service store not found');
    }
    assertAdminPermission(currentAdmin, 'service_stores.view', 'service stores');
    assertServiceLocationAccess(currentAdmin, existingStore.service_location_id);
  }
  const deleted = await ServiceStore.findByIdAndDelete(id);
  if (!deleted) {
    throw new ApiError(404, 'Service store not found');
  }

  return true;
};

export const createZone = async (payload, currentAdmin = null) => {
  if (!payload.name?.trim()) {
    throw new ApiError(400, 'Zone name is required');
  }
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'zones.view', 'zones');
    assertServiceLocationAccess(currentAdmin, payload.service_location_id);
  }

  const normalizedGeometry = normalizeZoneGeometryPayload(payload);

  const zone = await Zone.create({
    name: String(payload.name).trim(),
    service_location_id: payload.service_location_id ? toObjectId(payload.service_location_id) : null,
    unit: payload.unit || 'km',
    peak_zone_ride_count: toNullableNumber(payload.peak_zone_ride_count),
    peak_zone_radius: toNullableNumber(payload.peak_zone_radius),
    peak_zone_selection_duration: toNullableNumber(payload.peak_zone_selection_duration),
    peak_zone_duration: toNullableNumber(payload.peak_zone_duration),
    peak_zone_surge_percentage: toNullableNumber(payload.peak_zone_surge_percentage),
    maximum_distance_for_regular_rides: toNullableNumber(payload.maximum_distance_for_regular_rides),
    maximum_distance_for_outstation_rides: toNullableNumber(payload.maximum_distance_for_outstation_rides),
    active: payload.status ? payload.status === 'active' : true,
    status: payload.status || 'active',
    boundary_mode: normalizedGeometry.boundary_mode,
    circle_center: normalizedGeometry.circle_center,
    circle_radius_meters: normalizedGeometry.circle_radius_meters,
    geometry: normalizedGeometry.geometry,
  });

  const populatedZone = await Zone.findById(zone._id)
    .populate('service_location_id', 'name service_location_name country timezone')
    .lean();

  return serializeZone(populatedZone);
};

export const updateZone = async (id, payload, currentAdmin = null) => {
  const zone = await Zone.findById(id);
  if (!zone) throw new ApiError(404, 'Zone not found');
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'zones.view', 'zones');
    await assertZoneAccess(currentAdmin, zone._id);
  }

  if (payload.name !== undefined) {
    zone.name = String(payload.name).trim();
  }
  if (payload.service_location_id !== undefined) {
    if (currentAdmin && payload.service_location_id) {
      assertServiceLocationAccess(currentAdmin, payload.service_location_id);
    }
    zone.service_location_id = payload.service_location_id ? toObjectId(payload.service_location_id) : null;
  }
  if (payload.unit !== undefined) {
    zone.unit = payload.unit || 'km';
  }
  if (payload.peak_zone_ride_count !== undefined) {
    zone.peak_zone_ride_count = toNullableNumber(payload.peak_zone_ride_count);
  }
  if (payload.peak_zone_radius !== undefined) {
    zone.peak_zone_radius = toNullableNumber(payload.peak_zone_radius);
  }
  if (payload.peak_zone_selection_duration !== undefined) {
    zone.peak_zone_selection_duration = toNullableNumber(payload.peak_zone_selection_duration);
  }
  if (payload.peak_zone_duration !== undefined) {
    zone.peak_zone_duration = toNullableNumber(payload.peak_zone_duration);
  }
  if (payload.peak_zone_surge_percentage !== undefined) {
    zone.peak_zone_surge_percentage = toNullableNumber(payload.peak_zone_surge_percentage);
  }
  if (payload.maximum_distance_for_regular_rides !== undefined) {
    zone.maximum_distance_for_regular_rides = toNullableNumber(payload.maximum_distance_for_regular_rides);
  }
  if (payload.maximum_distance_for_outstation_rides !== undefined) {
    zone.maximum_distance_for_outstation_rides = toNullableNumber(payload.maximum_distance_for_outstation_rides);
  }
  if (payload.status !== undefined) {
    zone.status = payload.status || 'active';
    zone.active = zone.status === 'active';
  }
  if (
    payload.coordinates !== undefined ||
    payload.boundary_mode !== undefined ||
    payload.circle_center !== undefined ||
    payload.circle_radius_meters !== undefined
  ) {
    const normalizedGeometry = normalizeZoneGeometryPayload(payload, zone);
    zone.boundary_mode = normalizedGeometry.boundary_mode;
    zone.circle_center = normalizedGeometry.circle_center;
    zone.circle_radius_meters = normalizedGeometry.circle_radius_meters;
    zone.geometry = normalizedGeometry.geometry;
  }

  await zone.save();

  const populatedZone = await Zone.findById(zone._id)
    .populate('service_location_id', 'name service_location_name country timezone')
    .lean();

  return serializeZone(populatedZone);
};

export const deleteZone = async (id, currentAdmin = null) => {
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'zones.view', 'zones');
    await assertZoneAccess(currentAdmin, id);
  }
  const deleted = await Zone.findByIdAndDelete(id);
  if (!deleted) throw new ApiError(404, 'Zone not found');
  return true;
};

export const toggleZoneStatus = async (id, currentAdmin = null) => {
  const zone = await Zone.findById(id);
  if (!zone) throw new ApiError(404, 'Zone not found');
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'zones.view', 'zones');
    await assertZoneAccess(currentAdmin, zone._id);
  }
  zone.active = !zone.active;
  zone.status = zone.active ? 'active' : 'inactive';
  await zone.save();

  const populatedZone = await Zone.findById(zone._id)
    .populate('service_location_id', 'name service_location_name country timezone')
    .lean();

  return serializeZone(populatedZone);
};


export const listAirports = async (currentAdmin = null) => {
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'airports.view', 'airports');
  }
  const query = currentAdmin ? buildServiceLocationScopeQuery(currentAdmin) : {};
  const items = await Airport.find(query)
    .populate('service_location_id', 'name service_location_name country')
    .populate('zone_id', 'name')
    .sort({ createdAt: -1 })
    .lean();

  return items.map(serializeAirport);
};

export const createAirport = async (payload, currentAdmin = null) => {
  if (!payload.name?.trim()) {
    throw new ApiError(400, 'Airport name is required');
  }

  if (!payload.service_location_id) {
    throw new ApiError(400, 'Service location is required');
  }
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'airports.view', 'airports');
    assertServiceLocationAccess(currentAdmin, payload.service_location_id);
    if (payload.zone_id) {
      await assertZoneAccess(currentAdmin, payload.zone_id);
    }
  }

  const latitude = toNullableNumber(payload.latitude);
  const longitude = toNullableNumber(payload.longitude);
  const status = payload.status || (normalizeBoolean(payload.active ?? true) ? 'active' : 'inactive');

  const item = await Airport.create({
    name: String(payload.name).trim(),
    code: String(payload.code || '').trim().toUpperCase(),
    service_location_id: toObjectId(payload.service_location_id),
    zone_id: payload.zone_id ? toObjectId(payload.zone_id) : null,
    terminal: String(payload.terminal || '').trim(),
    address: String(payload.address || '').trim(),
    contact_number: String(payload.contact_number || '').trim(),
    latitude,
    longitude,
    location:
      latitude !== null && longitude !== null
        ? {
          type: 'Point',
          coordinates: [longitude, latitude],
        }
        : undefined,
    boundary:
      Array.isArray(payload.boundary_coordinates) && payload.boundary_coordinates.length >= 3
        ? {
          type: 'Polygon',
          coordinates: [normalizeAirportBoundary(payload.boundary_coordinates)],
        }
        : undefined,
    airport_surge: Math.max(0, Number(payload.airport_surge ?? 0) || 0),
    support_airport_fee: Math.max(0, Number(payload.support_airport_fee ?? 0) || 0),
    status,
    active: status === 'active',
    pickup_availability: payload.pickup_availability !== false,
    drop_availability: payload.drop_availability !== false,
  });

  const populatedItem = await Airport.findById(item._id)
    .populate('service_location_id', 'name service_location_name country')
    .populate('zone_id', 'name')
    .lean();

  return serializeAirport(populatedItem);
};

export const updateAirport = async (id, payload, currentAdmin = null) => {
  const item = await Airport.findById(id);
  if (!item) throw new ApiError(404, 'Airport not found');
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'airports.view', 'airports');
    assertServiceLocationAccess(currentAdmin, item.service_location_id);
  }

  if (payload.name !== undefined) {
    item.name = String(payload.name || '').trim();
  }
  if (payload.code !== undefined) {
    item.code = String(payload.code || '').trim().toUpperCase();
  }
  if (payload.service_location_id !== undefined) {
    if (currentAdmin && payload.service_location_id) {
      assertServiceLocationAccess(currentAdmin, payload.service_location_id);
    }
    item.service_location_id = payload.service_location_id ? toObjectId(payload.service_location_id) : null;
  }
  if (payload.zone_id !== undefined) {
    if (currentAdmin && payload.zone_id) {
      await assertZoneAccess(currentAdmin, payload.zone_id);
    }
    item.zone_id = payload.zone_id ? toObjectId(payload.zone_id) : null;
  }
  if (payload.terminal !== undefined) {
    item.terminal = String(payload.terminal || '').trim();
  }
  if (payload.address !== undefined) {
    item.address = String(payload.address || '').trim();
  }
  if (payload.contact_number !== undefined) {
    item.contact_number = String(payload.contact_number || '').trim();
  }
  if (payload.latitude !== undefined) {
    item.latitude = toNullableNumber(payload.latitude);
  }
  if (payload.longitude !== undefined) {
    item.longitude = toNullableNumber(payload.longitude);
  }
  if (payload.status !== undefined || payload.active !== undefined) {
    item.status = payload.status || (normalizeBoolean(payload.active) ? 'active' : 'inactive');
    item.active = item.status === 'active';
  }
  if (payload.boundary_coordinates !== undefined) {
    item.boundary =
      Array.isArray(payload.boundary_coordinates) && payload.boundary_coordinates.length >= 3
        ? {
          type: 'Polygon',
          coordinates: [normalizeAirportBoundary(payload.boundary_coordinates)],
        }
        : undefined;
  }
  if (payload.airport_surge !== undefined) {
    item.airport_surge = Math.max(0, Number(payload.airport_surge ?? 0) || 0);
  }
  if (payload.support_airport_fee !== undefined) {
    item.support_airport_fee = Math.max(0, Number(payload.support_airport_fee ?? 0) || 0);
  }
  if (payload.pickup_availability !== undefined) {
    item.pickup_availability = payload.pickup_availability === true || payload.pickup_availability === 'true';
  }
  if (payload.drop_availability !== undefined) {
    item.drop_availability = payload.drop_availability === true || payload.drop_availability === 'true';
  }

  item.location =
    item.latitude !== null && item.longitude !== null
      ? {
        type: 'Point',
        coordinates: [item.longitude, item.latitude],
      }
      : undefined;

  await item.save();

  const populatedItem = await Airport.findById(item._id)
    .populate('service_location_id', 'name service_location_name country')
    .populate('zone_id', 'name')
    .lean();

  return serializeAirport(populatedItem);
};

export const deleteAirport = async (id, currentAdmin = null) => {
  if (currentAdmin) {
    const existingAirport = await Airport.findById(id).select('service_location_id').lean();
    if (!existingAirport) throw new ApiError(404, 'Airport not found');
    assertAdminPermission(currentAdmin, 'airports.view', 'airports');
    assertServiceLocationAccess(currentAdmin, existingAirport.service_location_id);
  }
  const item = await Airport.findByIdAndDelete(id);
  if (!item) throw new ApiError(404, 'Airport not found');
  return true;
};

export const listRentalVehicleTypes = async () => {
  const items = await RentalVehicleType.find().sort({ createdAt: -1 }).lean();
  return items.map((item) => serializeRentalVehicleType(item));
};

export const createRentalVehicleType = async (payload = {}) => {
  const normalizedPayload = normalizeRentalVehiclePayload(payload);

  if (!normalizedPayload.name) {
    throw new ApiError(400, 'Rental vehicle name is required');
  }

  const item = await RentalVehicleType.create({
    ...normalizedPayload,
    serviceStoreIds: normalizedPayload.serviceStoreIds.map((value) => toObjectId(value)),
    active: normalizedPayload.status === 'active',
  });

  return serializeRentalVehicleType(item.toObject());
};

export const updateRentalVehicleType = async (id, payload = {}) => {
  const existingItem = await RentalVehicleType.findById(id);

  if (!existingItem) {
    throw new ApiError(404, 'Rental vehicle type not found');
  }

  const normalizedPayload = normalizeRentalVehiclePayload(payload, existingItem.toObject());

  if (!normalizedPayload.name) {
    throw new ApiError(400, 'Rental vehicle name is required');
  }

  Object.assign(existingItem, {
    ...normalizedPayload,
    serviceStoreIds: normalizedPayload.serviceStoreIds.map((value) => toObjectId(value)),
    active: normalizedPayload.status === 'active',
  });
  await existingItem.save();

  return serializeRentalVehicleType(existingItem.toObject());
};

export const deleteRentalVehicleType = async (id) => {
  const item = await RentalVehicleType.findByIdAndDelete(id);
  if (!item) throw new ApiError(404, 'Rental vehicle type not found');
  return true;
};

export const listRentalQuoteRequests = async () => {
  const items = await RentalQuoteRequest.find()
    .populate('userId', 'name phone email')
    .populate('vehicleTypeId', 'name vehicleCategory image')
    .sort({ createdAt: -1 })
    .lean();

  return items.map((item) => serializeRentalQuoteRequest(item));
};

export const updateRentalQuoteRequest = async (id, payload = {}, adminId = null) => {
  const item = await RentalQuoteRequest.findById(id);
  if (!item) {
    throw new ApiError(404, 'Rental quote request not found');
  }

  if (payload.status !== undefined) {
    if (!['pending', 'reviewing', 'quoted', 'rejected'].includes(String(payload.status))) {
      throw new ApiError(400, 'Invalid rental quote request status');
    }
    item.status = String(payload.status);
  }

  if (payload.adminQuotedAmount !== undefined) {
    item.adminQuotedAmount = Math.max(0, Number(payload.adminQuotedAmount || 0));
  }

  if (payload.adminNote !== undefined) {
    item.adminNote = String(payload.adminNote || '').trim();
  }

  item.reviewedAt = new Date();
  item.reviewedBy = adminId || null;
  await item.save();

  const populated = await RentalQuoteRequest.findById(item._id)
    .populate('userId', 'name phone email')
    .populate('vehicleTypeId', 'name vehicleCategory image')
    .lean();

  return serializeRentalQuoteRequest(populated);
};

export const listRentalBookingRequests = async () => {
  const items = await RentalBookingRequest.find()
    .populate('userId', 'name phone email')
    .populate('vehicleTypeId', 'name vehicleCategory image pricing')
    .sort({ createdAt: -1 })
    .lean();

  return items.map((item) => {
    const rideMetrics = computeRentalRideMetrics(
      item,
      item.completedAt || item.completionRequestedAt || null,
    );

    return {
      ...serializeRentalBookingRequest(item),
      rideMetrics,
      commissionBreakdown: {
        estimated: computeRentalCommissionBreakdown(item.commissionSnapshot, Number(item.totalCost || 0)),
        live: computeRentalCommissionBreakdown(
          item.commissionSnapshot,
          Number(item.finalCharge || rideMetrics.currentCharge || item.totalCost || 0),
        ),
      },
    };
  });
};

export const getRentalBookingRequestById = async (id) => {
  const item = await RentalBookingRequest.findById(id)
    .populate('userId', 'name phone email')
    .populate('vehicleTypeId', 'name vehicleCategory image pricing')
    .lean();

  if (!item) {
    throw new ApiError(404, 'Rental booking request not found');
  }

  const rideMetrics = computeRentalRideMetrics(
    item,
    item.completedAt || item.completionRequestedAt || null,
  );

  return {
    ...serializeRentalBookingRequest(item),
    rideMetrics,
    commissionBreakdown: {
      estimated: computeRentalCommissionBreakdown(item.commissionSnapshot, Number(item.totalCost || 0)),
      live: computeRentalCommissionBreakdown(
        item.commissionSnapshot,
        Number(item.finalCharge || rideMetrics.currentCharge || item.totalCost || 0),
      ),
    },
  };
};

export const getRentalTrackingDashboard = async () => {
  const results = await listActiveRentalTrackingBookings();
  const normalizeTrackingValue = (value = '') => String(value || '').trim().toLowerCase();
  const stats = results.reduce(
    (summary, item) => {
      summary.total += 1;

      const trackingStatus = normalizeTrackingValue(item?.rentalTracking?.trackingStatus);
      const zoneStatus = normalizeTrackingValue(item?.rentalTracking?.zoneStatus);
      const alertCount = Array.isArray(item?.rentalTracking?.alerts) ? item.rentalTracking.alerts.length : 0;

      if (trackingStatus === 'active') {
        summary.live += 1;
      }
      if (trackingStatus === 'location_off' || trackingStatus === 'tracking_stopped') {
        summary.locationOff += 1;
      }
      if (zoneStatus === 'outside') {
        summary.outsideZone += 1;
      }
      if (alertCount > 0) {
        summary.alerts += 1;
      }

      return summary;
    },
    {
      total: 0,
      live: 0,
      locationOff: 0,
      outsideZone: 0,
      alerts: 0,
    },
  );

  return {
    results,
    stats,
    refreshedAt: new Date().toISOString(),
  };
};

export const updateRentalBookingRequest = async (id, payload = {}, adminId = null) => {
  const item = await RentalBookingRequest.findById(id);
  if (!item) {
    throw new ApiError(404, 'Rental booking request not found');
  }

  if (payload.status !== undefined) {
    if (!['pending', 'confirmed', 'assigned', 'end_requested', 'completed', 'cancelled'].includes(String(payload.status))) {
      throw new ApiError(400, 'Invalid rental booking request status');
    }
    item.status = String(payload.status);
  }

  if (payload.assignedVehicleId !== undefined) {
    const assignedVehicleId = String(payload.assignedVehicleId || '').trim();

    if (!assignedVehicleId) {
      item.assignedVehicle = {
        vehicleId: null,
        name: '',
        vehicleCategory: '',
        image: '',
      };
      item.assignedAt = null;
    } else {
      const assignedVehicle = await RentalVehicleType.findById(assignedVehicleId)
        .select('name vehicleCategory image')
        .lean();

      if (!assignedVehicle) {
        throw new ApiError(404, 'Assigned rental vehicle not found');
      }

      item.assignedVehicle = {
        vehicleId: assignedVehicle._id,
        name: assignedVehicle.name || '',
        vehicleCategory: assignedVehicle.vehicleCategory || '',
        image: assignedVehicle.image || '',
      };
      item.assignedAt = new Date();
      item.completionRequestedAt = null;
      item.finalCharge = 0;
      item.finalElapsedMinutes = 0;

      if (
        !['end_requested', 'completed', 'cancelled'].includes(String(payload.status || item.status || ''))
      ) {
        item.status = 'assigned';
      }
    }
  }

  if (payload.cancelReason !== undefined) {
    item.cancelReason = String(payload.cancelReason || '').trim();
  }

  if (payload.adminNote !== undefined) {
    item.adminNote = String(payload.adminNote || '').trim();
  }

  if (item.status === 'cancelled') {
    item.cancelledAt = item.cancelledAt || new Date();
  } else if (payload.status !== undefined) {
    item.cancelledAt = null;
    if (payload.cancelReason === undefined) {
      item.cancelReason = item.cancelReason || '';
    }
  }

  if (item.status === 'end_requested') {
    item.completionRequestedAt = item.completionRequestedAt || new Date();
    const metrics = computeRentalRideMetrics(item, item.completionRequestedAt);
    item.finalCharge = Math.max(0, Number(item.finalCharge || metrics.currentCharge || 0));
    item.finalElapsedMinutes = Math.max(
      0,
      Number(item.finalElapsedMinutes || metrics.elapsedMinutes || 0),
    );
    item.completedAt = null;
  } else if (payload.status !== undefined) {
    item.completionRequestedAt = null;
    if (payload.status !== 'completed') {
      item.finalCharge = 0;
      item.finalElapsedMinutes = 0;
    }
  }

  if (item.status === 'completed') {
    item.completedAt = item.completedAt || new Date();
    if (!item.finalCharge || !item.finalElapsedMinutes) {
      const metrics = computeRentalRideMetrics(item, item.completedAt);
      item.finalCharge = Math.max(0, Number(item.finalCharge || metrics.currentCharge || 0));
      item.finalElapsedMinutes = Math.max(
        0,
        Number(item.finalElapsedMinutes || metrics.elapsedMinutes || 0),
      );
    }
  } else if (payload.status !== undefined && payload.status !== 'completed') {
    item.completedAt = null;
  }

  item.reviewedAt = new Date();
  item.reviewedBy = adminId || null;
  await item.save();

  const populated = await RentalBookingRequest.findById(item._id)
    .populate('userId', 'name phone email')
    .populate('vehicleTypeId', 'name vehicleCategory image')
    .lean();

  const rideMetrics = computeRentalRideMetrics(
    populated,
    populated.completedAt || populated.completionRequestedAt || null,
  );

  return {
    ...serializeRentalBookingRequest(populated),
    rideMetrics,
    commissionBreakdown: {
      estimated: computeRentalCommissionBreakdown(populated.commissionSnapshot, Number(populated.totalCost || 0)),
      live: computeRentalCommissionBreakdown(
        populated.commissionSnapshot,
        Number(populated.finalCharge || rideMetrics.currentCharge || populated.totalCost || 0),
      ),
    },
  };
};


export const listGoodsTypes = async () => {
  const items = await GoodsType.find().sort({ createdAt: -1 }).lean();
  const results = items.map(serializeGoodsType);

  return {
    success: true,
    results,
    paginator: {
      current_page: 1,
      data: results,
      first_page_url: "http://localhost:5000/api/v1/admin/goods-types?page=1",
      from: 1,
      last_page: 1,
      last_page_url: "http://localhost:5000/api/v1/admin/goods-types?page=1",
      links: [
        { url: null, label: "&laquo; Previous", active: false },
        { url: "http://localhost:5000/api/v1/admin/goods-types?page=1", label: "1", active: true },
        { url: null, label: "Next &raquo;", active: false }
      ],
      next_page_url: null,
      path: "http://localhost:5000/api/v1/admin/goods-types",
      per_page: 50,
      prev_page_url: null,
      to: results.length,
      total: results.length
    }
  };
};

export const createGoodsType = async (payload) => {
  const name = payload.goods_type_name || payload.name || '';
  if (!name.trim()) {
    throw new ApiError(400, 'Goods type name is required');
  }

  const active = payload.active !== undefined ?
    (typeof payload.active === 'boolean' ? (payload.active ? 1 : 0) : Number(payload.active)) :
    1;

  const item = await GoodsType.create({
    goods_type_name: name.trim(),
    name: name.trim(),
    goods_types_for: payload.goods_types_for || payload.goods_type_for || 'both',
    status: payload.status || (active === 1 ? 'active' : 'inactive'),
    active: active,
    translation_dataset: payload.translation_dataset || '',
  });

  return serializeGoodsType(item.toObject());
};

export const updateGoodsType = async (id, payload) => {
  const item = await GoodsType.findById(id);
  if (!item) throw new ApiError(404, 'Goods type not found');

  const name = payload.goods_type_name || payload.name;
  if (name !== undefined) {
    item.goods_type_name = name.trim();
    item.name = name.trim();
  }

  if (payload.goods_types_for !== undefined || payload.goods_type_for !== undefined) {
    item.goods_types_for = payload.goods_types_for || payload.goods_type_for || 'both';
  }

  if (payload.active !== undefined) {
    item.active = typeof payload.active === 'boolean' ? (payload.active ? 1 : 0) : Number(payload.active);
  }

  if (payload.status !== undefined) {
    item.status = payload.status;
  } else if (payload.active !== undefined) {
    item.status = item.active === 1 ? 'active' : 'inactive';
  }

  if (payload.translation_dataset !== undefined) {
    item.translation_dataset = payload.translation_dataset;
  }

  await item.save();
  return serializeGoodsType(item.toObject());
};

export const deleteGoodsType = async (id) => {
  const deleted = await GoodsType.findByIdAndDelete(id);
  if (!deleted) throw new ApiError(404, 'Goods type not found');
  return true;
};

export const listRentalPackageTypes = async () => {
  const items = await RentalPackageType.find().sort({ createdAt: -1 }).lean();
  const results = items.map(serializeRentalPackageType);

  return {
    results,
    paginator: {
      current_page: 1,
      data: results,
      total: results.length,
      last_page: 1,
      per_page: 50,
      from: 1,
      to: results.length,
      links: [
        { url: null, label: "&laquo; Previous", active: false },
        { url: "http://localhost:5000/api/v1/admin/rental-package-types?page=1", label: "1", active: true },
        { url: null, label: "Next &raquo;", active: false }
      ],
      path: "http://localhost:5000/api/v1/admin/rental-package-types"
    }
  };
};

export const createRentalPackageType = async (payload) => {
  if (!payload.name?.trim()) {
    throw new ApiError(400, 'Rental package type name is required');
  }

  if (!payload.transport_type?.trim()) {
    throw new ApiError(400, 'Transport type is required');
  }

  const status = payload.status || (normalizeBoolean(payload.active ?? true) ? 'active' : 'inactive');

  const item = await RentalPackageType.create({
    transport_type: String(payload.transport_type).trim().toLowerCase(),
    name: String(payload.name).trim(),
    short_description: String(payload.short_description || '').trim(),
    description: String(payload.description || '').trim(),
    status,
    active: status === 'active',
  });

  return serializeRentalPackageType(item.toObject());
};

export const updateRentalPackageType = async (id, payload) => {
  const item = await RentalPackageType.findById(id);
  if (!item) throw new ApiError(404, 'Rental package type not found');

  if (payload.transport_type !== undefined) {
    item.transport_type = String(payload.transport_type || 'taxi').trim().toLowerCase();
  }
  if (payload.name !== undefined) {
    item.name = String(payload.name || '').trim();
  }
  if (payload.short_description !== undefined) {
    item.short_description = String(payload.short_description || '').trim();
  }
  if (payload.description !== undefined) {
    item.description = String(payload.description || '').trim();
  }
  if (payload.status !== undefined) {
    item.status = payload.status || 'active';
    item.active = item.status === 'active';
  } else if (payload.active !== undefined) {
    item.active = normalizeBoolean(payload.active);
    item.status = item.active ? 'active' : 'inactive';
  }

  await item.save();
  return serializeRentalPackageType(item.toObject());
};

export const deleteRentalPackageType = async (id) => {
  const deleted = await RentalPackageType.findByIdAndDelete(id);
  if (!deleted) throw new ApiError(404, 'Rental package type not found');
  return true;
};

const buildDriverNeededDocumentKeys = (payload = {}, existing = null) => {
  const imageType = String(payload.image_type || existing?.image_type || 'front_back').trim();
  const verificationType = normalizeDriverDocumentVerificationType(
    payload.verification_type || existing?.verification_type,
  );
  const preset = getDriverDocumentPresetConfig(verificationType);
  const presetKey = String(preset?.key || '').trim();
  const baseKey = presetKey || toDocumentKey(payload.name || existing?.name || 'document');

  if (imageType === 'front_back') {
    return {
      key: '',
      front_key:
        existing?.front_key ||
        String(payload.front_key || '').trim() ||
        `${baseKey}Front`,
      back_key:
        existing?.back_key ||
        String(payload.back_key || '').trim() ||
        `${baseKey}Back`,
    };
  }

  const suffix = imageType === 'front' ? 'Front' : imageType === 'back' ? 'Back' : '';

  return {
    key:
      existing?.key ||
      String(payload.key || '').trim() ||
      `${baseKey}${suffix}`,
    front_key: '',
    back_key: '',
  };
};

export const listDriverNeededDocuments = async ({ activeOnly = false, includeFields = false, templateType = 'document' } = {}) => {
  await cleanupLegacySeededDriverNeededDocuments();
  await ensureDefaultDriverVehicleFields();

  const normalizedTemplateType = String(templateType || 'document').trim().toLowerCase();
  const query = {
    ...(activeOnly ? { active: true } : {}),
    ...(normalizedTemplateType === 'all'
      ? {}
      : normalizedTemplateType === 'vehicle_field'
        ? { template_type: 'vehicle_field' }
        : {
          $or: [
            { template_type: 'document' },
            { template_type: { $exists: false } },
            { template_type: null },
            { template_type: '' },
          ],
        }),
  };
  const items = await DriverNeededDocument.find(query).sort({ createdAt: -1 }).lean();
  return items.map((item) => {
    if (normalizeDriverTemplateType(item.template_type) === 'vehicle_field') {
      return serializeDriverVehicleField(item);
    }

    return includeFields ? serializeDriverNeededDocumentTemplate(item) : serializeDriverNeededDocument(item);
  });
};

export const getDriverNeededDocumentById = async (id) => {
  await cleanupLegacySeededDriverNeededDocuments();
  await ensureDefaultDriverVehicleFields();

  const item = await DriverNeededDocument.findById(id).lean();
  if (!item) {
    throw new ApiError(404, 'Driver needed document not found');
  }

  return normalizeDriverTemplateType(item.template_type) === 'vehicle_field'
    ? serializeDriverVehicleField(item)
    : serializeDriverNeededDocument(item);
};

export const listDriverVehicleFieldTemplates = async ({ activeOnly = true } = {}) =>
  listDriverNeededDocuments({ activeOnly, templateType: 'vehicle_field' });

export const listDriverDocumentUploadFields = async ({ activeOnly = true } = {}) => {
  const items = await listDriverNeededDocuments({ activeOnly, includeFields: true });
  return items.flatMap((item) =>
    item.fields.map((field) => ({
      ...field,
      template_id: item.id,
      template_name: item.name,
      account_type: item.account_type,
      image_type: item.image_type,
      has_expiry_date: item.has_expiry_date,
      has_identify_number: item.has_identify_number,
    })),
  );
};


export const createDriverNeededDocument = async (payload) => {
  if (!payload.name?.trim()) {
    throw new ApiError(400, 'Document name is required');
  }

  await cleanupLegacySeededDriverNeededDocuments();
  await ensureDefaultDriverVehicleFields();

  const templateType = normalizeDriverTemplateType(payload.template_type);

  const name = String(payload.name).trim();
  const slug = slugify(payload.slug || (templateType === 'vehicle_field' ? `vehicle-field-${payload.field_key || name}` : name));
  const existing = await DriverNeededDocument.findOne({ slug });
  if (existing) {
    throw new ApiError(409, `A driver ${templateType === 'vehicle_field' ? 'field' : 'document'} with this name already exists`);
  }

  if (templateType === 'vehicle_field') {
    const fieldKey = String(payload.field_key || '').trim();
    const definition = DRIVER_VEHICLE_FIELD_DEFINITIONS[fieldKey];
    const normalizedFieldType = normalizeDriverVehicleFieldType(payload.field_type || definition?.field_type || 'text');
    const normalizedFieldKey = fieldKey || `custom_${slugify(name).replace(/-/g, '_')}`;

    if (!normalizedFieldKey) {
      throw new ApiError(400, 'A valid vehicle field key is required');
    }

    const duplicateField = await DriverNeededDocument.findOne({
      template_type: 'vehicle_field',
      field_key: normalizedFieldKey,
    }).lean();
    if (duplicateField) {
      throw new ApiError(409, 'A vehicle field with this key already exists');
    }

    const item = await DriverNeededDocument.create({
      template_type: 'vehicle_field',
      name,
      slug,
      account_type: normalizeDriverAccountType(payload.account_type || definition?.account_type),
      image_type: 'image',
      has_expiry_date: false,
      has_identify_number: false,
      identify_number_key: '',
      verification_type: 'none',
      is_editable: payload.is_editable !== undefined ? normalizeBoolean(payload.is_editable) : true,
      is_required: payload.is_required !== undefined ? normalizeBoolean(payload.is_required) : true,
      active: payload.active !== undefined ? normalizeBoolean(payload.active) : true,
      field_key: normalizedFieldKey,
      field_type: normalizedFieldType,
      field_group: String(payload.field_group || definition?.field_group || '').trim(),
      placeholder: String(payload.placeholder || definition?.placeholder || '').trim(),
      help_text: String(payload.help_text || '').trim(),
      sort_order: Number(payload.sort_order ?? definition?.sort_order ?? 0),
      options: Array.isArray(payload.options) ? payload.options.map((item) => String(item || '').trim()).filter(Boolean) : (definition?.options || []),
      key: '',
      front_key: '',
      back_key: '',
    });

    return serializeDriverVehicleField(item.toObject());
  }

  const keys = buildDriverNeededDocumentKeys(payload);
  const verificationType = normalizeDriverDocumentVerificationType(payload.verification_type);
  const item = await DriverNeededDocument.create({
    template_type: 'document',
    name,
    slug,
    account_type: normalizeDriverAccountType(payload.account_type),
    image_type: String(payload.image_type || 'front_back').trim(),
    has_expiry_date: normalizeBoolean(payload.has_expiry_date),
    has_identify_number: normalizeBoolean(payload.has_identify_number),
    identify_number_key: normalizeBoolean(payload.has_identify_number)
      ? String(payload.identify_number_key || '').trim()
      : '',
    verification_type: verificationType,
    is_editable: normalizeBoolean(payload.is_editable),
    is_required: normalizeBoolean(payload.is_required),
    active: payload.active !== undefined ? normalizeBoolean(payload.active) : true,
    ...keys,
  });

  return serializeDriverNeededDocument(item.toObject());
};

export const updateDriverNeededDocument = async (id, payload) => {
  const item = await DriverNeededDocument.findById(id);
  if (!item) {
    throw new ApiError(404, 'Driver needed document not found');
  }

  const templateType = normalizeDriverTemplateType(item.template_type || payload.template_type);

  if (templateType === 'vehicle_field') {
    if (payload.name !== undefined) {
      item.name = String(payload.name || '').trim();
    }
    if (payload.account_type !== undefined) {
      item.account_type = normalizeDriverAccountType(payload.account_type);
    }
    if (payload.field_key !== undefined) {
      const fieldKey = String(payload.field_key || '').trim();
      if (!fieldKey) {
        throw new ApiError(400, 'A valid vehicle field key is required');
      }
      item.field_key = fieldKey;
    }
    if (payload.field_type !== undefined) {
      item.field_type = normalizeDriverVehicleFieldType(payload.field_type);
    }
    if (payload.field_group !== undefined) {
      item.field_group = String(payload.field_group || '').trim();
    }
    if (payload.placeholder !== undefined) {
      item.placeholder = String(payload.placeholder || '').trim();
    }
    if (payload.help_text !== undefined) {
      item.help_text = String(payload.help_text || '').trim();
    }
    if (payload.sort_order !== undefined) {
      item.sort_order = Number(payload.sort_order || 0);
    }
    if (payload.options !== undefined) {
      item.options = Array.isArray(payload.options)
        ? payload.options.map((entry) => String(entry || '').trim()).filter(Boolean)
        : [];
    }
    if (payload.is_editable !== undefined) {
      item.is_editable = normalizeBoolean(payload.is_editable);
    }
    if (payload.is_required !== undefined) {
      item.is_required = normalizeBoolean(payload.is_required);
    }
    if (payload.active !== undefined) {
      item.active = normalizeBoolean(payload.active);
    }

    await item.save();
    return serializeDriverVehicleField(item.toObject());
  }

  if (payload.name !== undefined) {
    item.name = String(payload.name || '').trim();
  }
  if (payload.account_type !== undefined) {
    item.account_type = normalizeDriverAccountType(payload.account_type);
  }
  if (payload.image_type !== undefined) {
    item.image_type = String(payload.image_type || 'front_back').trim();
  }
  if (payload.has_expiry_date !== undefined) {
    item.has_expiry_date = normalizeBoolean(payload.has_expiry_date);
  }
  if (payload.has_identify_number !== undefined) {
    item.has_identify_number = normalizeBoolean(payload.has_identify_number);
  }
  if (payload.identify_number_key !== undefined || payload.has_identify_number !== undefined) {
    item.identify_number_key = item.has_identify_number
      ? String(payload.identify_number_key ?? item.identify_number_key ?? '').trim()
      : '';
  }
  if (payload.verification_type !== undefined) {
    item.verification_type = normalizeDriverDocumentVerificationType(payload.verification_type);
  }
  if (payload.is_editable !== undefined) {
    item.is_editable = normalizeBoolean(payload.is_editable);
  }
  if (payload.is_required !== undefined) {
    item.is_required = normalizeBoolean(payload.is_required);
  }
  if (payload.active !== undefined) {
    item.active = normalizeBoolean(payload.active);
  }

  const keys = buildDriverNeededDocumentKeys(
    {
      ...item.toObject(),
      ...payload,
      name: item.name,
      image_type: item.image_type,
    },
    item.toObject(),
  );

  item.key = keys.key;
  item.front_key = keys.front_key;
  item.back_key = keys.back_key;

  await item.save();
  return serializeDriverNeededDocument(item.toObject());
};

export const deleteDriverNeededDocument = async (id) => {
  const deleted = await DriverNeededDocument.findByIdAndDelete(id);
  if (!deleted) {
    throw new ApiError(404, 'Driver needed document not found');
  }

  return true;
};




export const listLanguages = async () => AppLanguage.find().sort({ code: 1 }).lean();

export const updateLanguageStatus = async (id, payload) => {
  const language = await AppLanguage.findByIdAndUpdate(id, { active: Number(payload.active) }, { returnDocument: 'after' });
  if (!language) throw new ApiError(404, 'Language not found');
  return language.toObject();
};

export const deleteLanguage = async (id) => {
  const deleted = await AppLanguage.findByIdAndDelete(id);
  if (!deleted) throw new ApiError(404, 'Language not found');
  return true;
};

export const listPreferences = async () => UserPreference.find().sort({ createdAt: -1 }).lean();

export const createPreference = async (payload) => {
  const firstLetter = (payload.name || 'P').trim().charAt(0).toUpperCase() || 'P';
  const preference = await UserPreference.create({
    name: payload.name,
    icon: payload.icon || `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect rx="16" width="64" height="64" fill="%23E0E7FF"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-size="28">${firstLetter}</text></svg>`,
    active: 1,
  });
  return preference.toObject();
};

export const updatePreferenceStatus = async (id, payload) => {
  const preference = await UserPreference.findByIdAndUpdate(id, { active: Number(payload.active) }, { returnDocument: 'after' });
  if (!preference) throw new ApiError(404, 'Preference not found');
  return preference.toObject();
};

export const deletePreference = async (id) => {
  const deleted = await UserPreference.findByIdAndDelete(id);
  if (!deleted) throw new ApiError(404, 'Preference not found');
  return true;
};

export const listRoles = async () => AdminRole.find().sort({ createdAt: -1 }).lean();

export const createRole = async (payload) => {
  const role = await AdminRole.create({
    name: payload.name,
    description: payload.description || '',
    slug: payload.name?.trim().toLowerCase().replace(/\s+/g, '-') || `role-${Date.now()}`,
  });
  return role.toObject();
};

export const deleteRole = async (id) => {
  const deleted = await AdminRole.findByIdAndDelete(id);
  if (!deleted) throw new ApiError(404, 'Role not found');
  return true;
};





export const listPaymentMethods = async () =>
  PaymentMethod.find().sort({ createdAt: -1 }).lean();

export const createPaymentMethod = async (payload = {}) => {
  const name = String(payload.method_name ?? payload.name ?? '').trim();
  if (!name) {
    throw new ApiError(400, 'Method name is required');
  }

  const fields = Array.isArray(payload.fields)
    ? payload.fields
      .map((field) => ({
        type: String(field?.type || 'text'),
        name: String(field?.name || '').trim(),
        placeholder: String(field?.placeholder || '').trim(),
        is_required: Boolean(field?.is_required),
      }))
      .filter((field) => field.name)
    : [];

  const method = await PaymentMethod.create({
    name,
    fields,
    active: payload.active !== undefined ? Boolean(payload.active) : true,
  });

  return method.toObject();
};

export const updatePaymentMethod = async (id, payload = {}) => {
  const update = {};

  if (payload.method_name !== undefined || payload.name !== undefined) {
    const name = String(payload.method_name ?? payload.name ?? '').trim();
    if (!name) {
      throw new ApiError(400, 'Method name is required');
    }
    update.name = name;
  }

  if (payload.fields !== undefined) {
    const fields = Array.isArray(payload.fields)
      ? payload.fields
        .map((field) => ({
          type: String(field?.type || 'text'),
          name: String(field?.name || '').trim(),
          placeholder: String(field?.placeholder || '').trim(),
          is_required: Boolean(field?.is_required),
        }))
        .filter((field) => field.name)
      : [];
    update.fields = fields;
  }

  if (payload.active !== undefined) {
    update.active = Boolean(payload.active);
  }

  const method = await PaymentMethod.findByIdAndUpdate(id, update, {
    returnDocument: 'after',
    runValidators: true,
  });
  if (!method) {
    throw new ApiError(404, 'Payment method not found');
  }
  return method.toObject();
};

export const deletePaymentMethod = async (id) => {
  const deleted = await PaymentMethod.findByIdAndDelete(id);
  if (!deleted) {
    throw new ApiError(404, 'Payment method not found');
  }
  return true;
};















const buildDateFilter = (date_option, from_date, to_date) => {
  const filter = {};
  const now = new Date();

  if (date_option === 'today') {
    filter.$gte = new Date(now.setHours(0, 0, 0, 0));
  } else if (date_option === 'yesterday') {
    const yesterday = new Date(now.setDate(now.getDate() - 1));
    filter.$gte = new Date(yesterday.setHours(0, 0, 0, 0));
    filter.$lt = new Date(new Date().setHours(0, 0, 0, 0));
  } else if (date_option === 'this_week') {
    const first = now.getDate() - now.getDay();
    filter.$gte = new Date(now.setDate(first));
  } else if (date_option === 'this_month') {
    filter.$gte = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (date_option === 'this_year') {
    filter.$gte = new Date(now.getFullYear(), 0, 1);
  } else if (date_option === 'range' && from_date && to_date) {
    filter.$gte = new Date(new Date(from_date).setHours(0, 0, 0, 0));
    filter.$lte = new Date(new Date(to_date).setHours(23, 59, 59, 999));
  }

  return Object.keys(filter).length > 0 ? filter : null;
};

export const buildUserReport = async (query = {}) => {
  const { status, date_option, from_date, to_date } = query;
  const filter = { deletedAt: null };

  if (status === 'active') filter.active = true;
  else if (status === 'inactive') filter.active = false;

  const dateFilter = buildDateFilter(date_option, from_date, to_date);
  if (dateFilter) filter.createdAt = dateFilter;

  const users = await User.find(filter).sort({ createdAt: -1 }).lean();
  return {
    headers: ['name', 'email', 'mobile', 'active', 'createdAt'],
    rows: users.map((item) => ({
      name: item.name || '',
      email: item.email || '',
      mobile: item.phone || item.mobile || '',
      active: item.active !== false && !item.deletedAt,
      createdAt: item.createdAt ? new Date(item.createdAt).toLocaleString() : ''
    }))
  };
};

export const buildDriverReport = async (query = {}) => {
  const { transport_type, vehicle_type, status, date_option, from_date, to_date } = query;
  const filter = {};

  if (transport_type === 'both') {
    filter.registerFor = { $in: ['taxi', 'bike', 'both'] };
  } else if (transport_type) {
    filter.registerFor = transport_type;
  }

  if (vehicle_type) filter.vehicleType = vehicle_type;
  if (status) filter.status = status;

  const dateFilter = buildDateFilter(date_option, from_date, to_date);
  if (dateFilter) filter.createdAt = dateFilter;

  const items = await Driver.find(filter).lean();
  return {
    headers: ['name', 'mobile', 'city', 'transport_type', 'vehicle_type', 'status', 'createdAt'],
    rows: items.map((item) => ({
      name: item.name,
      mobile: item.phone,
      city: item.city,
      transport_type: item.registerFor,
      vehicle_type: item.vehicleType,
      status: item.status,
      createdAt: item.createdAt ? new Date(item.createdAt).toLocaleString() : ''
    }))
  };
};

export const buildDriverDutyReport = async (query = {}) => {
  const {
    service_location_id,
    driver_id,
    driver,
    status,
    date_option,
    from_date,
    to_date,
  } = query;
  const selectedDriverId = driver_id || driver;
  const driverFilter = {};

  if (service_location_id) {
    driverFilter.service_location_id = service_location_id;
  }
  if (selectedDriverId) {
    driverFilter._id = selectedDriverId;
  }

  const drivers = await Driver.find(driverFilter)
    .select('name phone city registerFor vehicleType service_location_id')
    .lean();
  const driverIds = drivers.map((item) => item._id);
  const driverMap = new Map(drivers.map((item) => [String(item._id), item]));

  if (driverIds.length === 0) {
    return {
      headers: ['ride_id', 'driver', 'driver_phone', 'transport_type', 'vehicle_type', 'pickup', 'drop', 'payment_method', 'fare', 'status', 'ride_time'],
      rows: [],
    };
  }

  const rideFilter = {
    driverId: { $in: driverIds },
  };

  if (status) {
    rideFilter.status = String(status).trim().toLowerCase();
  }

  const dateFilter = buildDateFilter(date_option, from_date, to_date);
  if (dateFilter) {
    rideFilter.createdAt = dateFilter;
  }

  const rides = await Ride.find(rideFilter)
    .sort({ createdAt: -1 })
    .select('driverId pickupAddress dropAddress paymentMethod fare status createdAt transport_type vehicleTypeId')
    .populate('vehicleTypeId', 'name type_name transport_type')
    .lean();

  return {
    headers: ['ride_id', 'driver', 'driver_phone', 'transport_type', 'vehicle_type', 'pickup', 'drop', 'payment_method', 'fare', 'status', 'ride_time'],
    rows: rides.map((ride) => {
      const rideDriver = driverMap.get(String(ride.driverId || '')) || {};
      const vehicleType =
        ride?.vehicleTypeId?.type_name ||
        ride?.vehicleTypeId?.name ||
        rideDriver?.vehicleType ||
        '';

      return {
        ride_id: String(ride._id),
        driver: rideDriver.name || 'Unknown Driver',
        driver_phone: rideDriver.phone || '',
        transport_type:
          ride?.vehicleTypeId?.transport_type ||
          ride?.transport_type ||
          rideDriver?.registerFor ||
          'taxi',
        vehicle_type: vehicleType,
        pickup: ride.pickupAddress || '',
        drop: ride.dropAddress || '',
        payment_method: ride.paymentMethod || '',
        fare: Number(ride.fare || 0),
        status: ride.status || '',
        ride_time: ride.createdAt ? new Date(ride.createdAt).toLocaleString() : '',
      };
    }),
  };
};


export const buildFinanceReport = async (query = {}) => {
  const {
    transport_type,
    vehicle_type,
    status,
    trip_status,
    payment_type,
    date_option,
    from_date,
    to_date,
  } = query;
  const rideFilter = {};
  const effectiveStatus = status || trip_status;

  if (effectiveStatus) {
    rideFilter.status = String(effectiveStatus).trim().toLowerCase();
  }
  if (payment_type) {
    rideFilter.paymentMethod = String(payment_type).trim().toLowerCase();
  }

  const dateFilter = buildDateFilter(date_option, from_date, to_date);
  if (dateFilter) {
    rideFilter.createdAt = dateFilter;
  }

  const items = await Ride.find(rideFilter)
    .sort({ createdAt: -1 })
    .select('driverId userId fare status paymentMethod createdAt transport_type commissionAmount driverEarnings')
    .populate('driverId', 'name phone registerFor vehicleType')
    .populate('userId', 'name phone')
    .lean();

  const normalizedTransportType = String(transport_type || '').trim().toLowerCase();
  const normalizedVehicleType = String(vehicle_type || '').trim().toLowerCase();

  const rows = items
    .map((item) => {
      const resolvedTransportType =
        String(
          item.transport_type ||
          item.driverId?.registerFor ||
          item.driverId?.vehicleType ||
          'taxi',
        )
          .trim()
          .toLowerCase();
      const resolvedVehicleType = String(item.driverId?.vehicleType || '').trim().toLowerCase();
      const fare = Number(item.fare || 0);
      const commission =
        item.commissionAmount !== undefined && item.commissionAmount !== null
          ? Number(item.commissionAmount || 0)
          : Math.max(fare - Number(item.driverEarnings || 0), 0);

      return {
        ride_id: String(item._id),
        driver: item.driverId?.name || 'Unassigned',
        driver_phone: item.driverId?.phone || '',
        user: item.userId?.name || '',
        user_phone: item.userId?.phone || '',
        transport_type: resolvedTransportType,
        vehicle_type: resolvedVehicleType,
        payment_method: String(item.paymentMethod || '').toLowerCase(),
        fare,
        admin_commission: Number(commission.toFixed(2)),
        driver_earnings: Number(Math.max(fare - commission, 0).toFixed(2)),
        status: item.status || '',
        createdAt: item.createdAt ? new Date(item.createdAt).toLocaleString() : '',
      };
    })
    .filter((item) => {
      const transportMatches =
        !normalizedTransportType ||
        normalizedTransportType === 'all' ||
        normalizedTransportType === 'both' ||
        item.transport_type === normalizedTransportType;
      const vehicleMatches =
        !normalizedVehicleType ||
        item.vehicle_type === normalizedVehicleType;
      return transportMatches && vehicleMatches;
    });

  return {
    headers: ['ride_id', 'driver', 'driver_phone', 'user', 'user_phone', 'transport_type', 'vehicle_type', 'payment_method', 'fare', 'admin_commission', 'driver_earnings', 'status', 'createdAt'],
    rows,
  };
};


export const ensureBusinessSettings = async () => {
  let settings = await AdminBusinessSetting.findOne({ scope: 'default' });
  if (!settings) {
    settings = await AdminBusinessSetting.create(createDefaultBusinessSettings());
  }
  return settings;
};


/**
 * Ensures a default administrative application settings document exists.
 */
export const ensureAppSettings = async () => {
  let settings = await AdminAppSetting.findOne({ scope: 'default' });
  if (!settings) {
    settings = await AdminAppSetting.create(createDefaultAppSettings());
  }
  return settings;
};

export const ensureAppModules = async () => {
  // No-op: AppModule is now nested inside AdminAppSetting
  return;
};

const businessSettingsCategoryMap = {
  customize: 'customization',
  'transport-ride': 'transport_ride',
  general: 'general',
  'user-home-management': 'user_home_settings',
};

const appSettingsCategoryMap = {
  wallet: 'wallet_setting',
};

/// Voice config is read by the rider app on every trip, so it must answer with
/// something usable even on an install whose settings document predates the
/// feature (the stored section is then simply absent). Merging the shipped
/// defaults underneath what the admin saved gives that guarantee, and also
/// means an admin who edits only the Hindi wording does not silently blank the
/// English and Kannada ones.
const mergeRideVoiceSettings = (stored) => {
  const defaults = createDefaultRideVoiceSettings();
  const saved = stored && typeof stored === 'object' ? stored : {};

  const mergeSection = (key) => ({
    ...defaults[key],
    ...(saved[key] || {}),
    messages: {
      ...defaults[key].messages,
      ...((saved[key] || {}).messages || {}),
    },
  });

  return {
    ...defaults,
    ...saved,
    welcome: mergeSection('welcome'),
    comfort: mergeSection('comfort'),
    arrival: mergeSection('arrival'),
    speech: { ...defaults.speech, ...(saved.speech || {}) },
  };
};

/// Keeps a saved voice config inside sane bounds.
///
/// The templates are free text by design (they are localized sentences), but
/// the numbers drive timers on the rider's phone, so an accidental `""` or a
/// negative delay must not reach the app.
const sanitizeRideVoiceSettings = (payload) => {
  const defaults = createDefaultRideVoiceSettings();
  const input = payload && typeof payload === 'object' ? payload : {};

  const bool = (value, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
  };

  const number = (value, fallback, { min, max }) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  };

  /// Drops non-string entries rather than storing them: the app calls
  /// `.replace()` on these and a number or object would throw there.
  const messages = (value, fallback) => {
    if (!value || typeof value !== 'object') return fallback;
    const cleaned = {};
    for (const [code, text] of Object.entries(value)) {
      const key = String(code || '').trim().toLowerCase();
      if (!key) continue;
      if (typeof text !== 'string') continue;
      if (!text.trim()) continue;
      cleaned[key] = text.trim();
    }
    return Object.keys(cleaned).length ? cleaned : fallback;
  };

  const section = (key, triggerKey, bounds) => {
    const saved = input[key] && typeof input[key] === 'object' ? input[key] : {};
    return {
      enabled: bool(saved.enabled, defaults[key].enabled),
      [triggerKey]: number(saved[triggerKey], defaults[key][triggerKey], bounds),
      messages: messages(saved.messages, defaults[key].messages),
    };
  };

  const speech = input.speech && typeof input.speech === 'object' ? input.speech : {};

  return {
    enabled: bool(input.enabled, defaults.enabled),
    fallback_language:
      String(input.fallback_language || defaults.fallback_language).trim().toLowerCase() || 'en',
    welcome: section('welcome', 'delay_minutes', { min: 0, max: 120 }),
    comfort: section('comfort', 'delay_minutes', { min: 0, max: 120 }),
    arrival: section('arrival', 'trigger_remaining_minutes', { min: 1, max: 120 }),
    speech: {
      rate: number(speech.rate, defaults.speech.rate, { min: 0.1, max: 1 }),
      pitch: number(speech.pitch, defaults.speech.pitch, { min: 0.5, max: 2 }),
      volume: number(speech.volume, defaults.speech.volume, { min: 0, max: 1 }),
    },
  };
};

const generalBusinessSettingsProjection = {
  _id: 0,
  general: {
    app_name: '$general.app_name',
    contact_phone_1: '$general.contact_phone_1',
    contact_phone_2: '$general.contact_phone_2',
    contact_booking_number: '$general.contact_booking_number',
    footer_1: '$general.footer_1',
    footer_2: '$general.footer_2',
    default_lat: '$general.default_lat',
    default_lng: '$general.default_lng',
    logo: '$general.logo',
    favicon: '$general.favicon',
    brand_logo: '$general.brand_logo',
  },
};

const getGeneralBusinessSettingsSection = async () => {
  let results = await AdminBusinessSetting.aggregate([
    { $match: { scope: 'default' } },
    { $project: generalBusinessSettingsProjection },
    { $limit: 1 },
  ]);

  if (results.length === 0) {
    const created = await AdminBusinessSetting.create(createDefaultBusinessSettings());
    return created.general || {};
  }

  return results[0]?.general || {};
};

const getProjectedSettingsSection = async (Model, defaultFactory, key) => {
  if (!Model.schema.path(key)) {
    return {};
  }

  let settings = await Model.findOne(
    { scope: 'default' },
    { [key]: 1, _id: 0 },
  ).lean();

  if (!settings) {
    const created = await Model.create(defaultFactory());
    return created[key] || {};
  }

  return settings[key] || {};
};

export const getGeneralSettings = async (category) => {
  const appKey = appSettingsCategoryMap[category];
  if (appKey === 'ride_voice') {
    return {
      settings: mergeRideVoiceSettings(
        await getProjectedSettingsSection(AdminAppSetting, createDefaultAppSettings, 'ride_voice'),
      ),
    };
  }

  if (appKey) {
    return {
      settings: await getProjectedSettingsSection(
        AdminAppSetting,
        createDefaultAppSettings,
        appKey,
      ),
    };
  }

  const businessKey = businessSettingsCategoryMap[category] || category;
  if (businessKey === 'general') {
    return {
      settings: await getGeneralBusinessSettingsSection(),
    };
  }

  return {
    settings: await getProjectedSettingsSection(
      AdminBusinessSetting,
      createDefaultBusinessSettings,
      businessKey,
    ),
  };
};

export const updateGeneralSettings = async (category, payload) => {
  const bizSettings = await ensureBusinessSettings();
  const appSettings = await ensureAppSettings();

  const newValues = payload.settings || payload;

  if (appSettingsCategoryMap[category]) {
    const key = appSettingsCategoryMap[category];
    appSettings[key] = { ...(appSettings[key] || {}), ...newValues };
    appSettings.markModified(key);
    await appSettings.save();
    return { settings: appSettings[key] };
  }

  const bizKey = businessSettingsCategoryMap[category] || category;
  if (!bizSettings.schema.path(bizKey)) {
    return { settings: {} };
  }

  bizSettings[bizKey] = { ...(bizSettings[bizKey] || {}), ...newValues };
  bizSettings.markModified(bizKey);
  await bizSettings.save();
  return { settings: bizSettings[bizKey] };
};

export const listAppModules = async (query = {}) => {
  const safePage = Number(query.page) || 1;
  const safeLimit = Number(query.limit) || 10;
  const start = (safePage - 1) * safeLimit;

  const [modules, total] = await Promise.all([
    TaxiAppModule.find()
      .sort({ order_by: 1, createdAt: -1 })
      .skip(start)
      .limit(safeLimit)
      .lean(),
    TaxiAppModule.countDocuments(),
  ]);

  const results = modules.map(m => ({
    _id: m._id,
    id: String(m._id),
    name: m.name,
    transport_type: m.transport_type,
    service_type: m.service_type,
    icon_types_for: m.icon_types_for,
    order_by: m.order_by,
    short_description: m.short_description,
    description: m.description,
    mobile_menu_icon: m.mobile_menu_icon,
    mobile_menu_cover_image: m.mobile_menu_cover_image,
    active: m.active,
    created_at: m.createdAt,
    updated_at: m.updatedAt
  }));

  return {
    results,
    paginator: {
      total,
      current_page: safePage,
      per_page: safeLimit,
      last_page: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
};

export const createAppModule = async (payload) => {
  const item = await TaxiAppModule.create({
    name: String(payload.name || '').trim(),
    transport_type: payload.transport_type || 'taxi',
    service_type: payload.service_type || 'normal',
    icon_types_for: payload.icon_types_for || null,
    order_by: Number(payload.order_by || 1),
    short_description: String(payload.short_description || '').trim(),
    description: String(payload.description || '').trim(),
    mobile_menu_icon: String(payload.mobile_menu_icon || '').trim(),
    mobile_menu_cover_image: payload.mobile_menu_cover_image || null,
    active: payload.active !== undefined ? (normalizeBoolean(payload.active) ? 1 : 0) : 1,
    company_key: payload.company_key || null
  });
  return item.toObject();
};

export const updateAppModule = async (id, payload) => {
  const update = {};
  if (payload.name !== undefined) update.name = String(payload.name).trim();
  if (payload.transport_type !== undefined) update.transport_type = payload.transport_type;
  if (payload.service_type !== undefined) update.service_type = payload.service_type;
  if (payload.icon_types_for !== undefined) update.icon_types_for = payload.icon_types_for;
  if (payload.order_by !== undefined) update.order_by = Number(payload.order_by);
  if (payload.short_description !== undefined) update.short_description = String(payload.short_description);
  if (payload.description !== undefined) update.description = String(payload.description);
  if (payload.mobile_menu_icon !== undefined) update.mobile_menu_icon = String(payload.mobile_menu_icon);
  if (payload.mobile_menu_cover_image !== undefined) update.mobile_menu_cover_image = payload.mobile_menu_cover_image;
  if (payload.active !== undefined) update.active = normalizeBoolean(payload.active) ? 1 : 0;
  if (payload.company_key !== undefined) update.company_key = payload.company_key;

  const item = await TaxiAppModule.findByIdAndUpdate(id, { $set: update }, { returnDocument: 'after' });
  if (!item) throw new ApiError(404, 'App module not found in database registry');
  return item.toObject();
};

export const deleteAppModule = async (id) => {
  const deleted = await TaxiAppModule.findByIdAndDelete(id);
  if (!deleted) throw new ApiError(404, 'App module registration not found');
  return true;
};

export const listOnboardingScreens = async (audience) => {
  const query = {};
  if (audience) {
    query.$or = [{ audience: audience }, { screen: audience }];
  }
  return OnboardingScreen.find(query).sort({ order: 1 }).lean();
};

export const createOnboardingScreen = async (payload = {}) => {
  const audience = String(payload.audience || payload.screen || 'user').trim().toLowerCase();
  if (!['user', 'driver'].includes(audience)) {
    throw new ApiError(400, 'Valid onboarding audience is required');
  }

  const title = String(payload.title || '').trim();
  if (!title) {
    throw new ApiError(400, 'Onboarding title is required');
  }

  const item = await OnboardingScreen.create({
    audience,
    screen: audience,
    order: Number(payload.order || 1),
    title,
    description: String(payload.description || '').trim(),
    active: payload.active !== undefined ? normalizeBoolean(payload.active) : true,
  });

  return item.toObject();
};

export const updateOnboardingScreen = async (id, payload = {}) => {
  const update = {};

  if (payload.audience !== undefined || payload.screen !== undefined) {
    const audience = String(payload.audience || payload.screen || '').trim().toLowerCase();
    if (!['user', 'driver'].includes(audience)) {
      throw new ApiError(400, 'Valid onboarding audience is required');
    }
    update.audience = audience;
    update.screen = audience;
  }
  if (payload.order !== undefined) {
    update.order = Number(payload.order || 1);
  }
  if (payload.title !== undefined) {
    const title = String(payload.title || '').trim();
    if (!title) {
      throw new ApiError(400, 'Onboarding title is required');
    }
    update.title = title;
  }
  if (payload.description !== undefined) {
    update.description = String(payload.description || '').trim();
  }
  if (payload.active !== undefined) {
    update.active = normalizeBoolean(payload.active);
  }

  const item = await OnboardingScreen.findByIdAndUpdate(
    id,
    { $set: update },
    { returnDocument: 'after', runValidators: true },
  );
  if (!item) {
    throw new ApiError(404, 'Onboarding screen not found');
  }

  return item.toObject();
};

export const deleteOnboardingScreen = async (id) => {
  const deleted = await OnboardingScreen.findByIdAndDelete(id);
  if (!deleted) {
    throw new ApiError(404, 'Onboarding screen not found');
  }
  return true;
};

export const listTransportTypes = async () => {
  const types = await TaxiTransportType.find({ active: true }).lean();
  if (types.length === 0) {
    return await seedTransportTypes();
  }
  return types;
};

export const seedTransportTypes = async () => {
  const defaults = [
    { name: 'taxi', display_name: 'Taxi' },
    { name: 'delivery', display_name: 'Delivery' },
    { name: 'both', display_name: 'Both' }
  ];

  const results = [];
  for (const item of defaults) {
    const existing = await TaxiTransportType.findOne({ name: item.name });
    if (!existing) {
      results.push(await TaxiTransportType.create(item));
    } else {
      results.push(existing);
    }
  }
  return results;
};

// ── Price hike (surge) ───────────────────────────────────────────────────────

const serializePriceHike = (item) => ({
  id: String(item._id),
  label: item.label || '',
  days: Array.isArray(item.days) ? item.days : [],
  start_time: item.startTime || '00:00',
  end_time: item.endTime || '00:00',
  timezone: item.timezone || 'Asia/Kolkata',
  multiplier: Number(item.multiplier ?? 1),
  active: Boolean(item.active),
  updatedAt: item.updatedAt,
});

const normalizePriceHikePayload = (payload = {}) => {
  const time = (value, fallback) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
    if (!match) return fallback;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return fallback;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  };

  const multiplier = Number(payload.multiplier);

  return {
    label: String(payload.label || '').trim(),
    days: Array.isArray(payload.days)
      ? [...new Set(payload.days.map((day) => Number(day)).filter((day) => day >= 0 && day <= 6))]
      : [],
    startTime: time(payload.start_time ?? payload.startTime, '00:00'),
    endTime: time(payload.end_time ?? payload.endTime, '00:00'),
    timezone: String(payload.timezone || 'Asia/Kolkata').trim() || 'Asia/Kolkata',
    multiplier: Number.isFinite(multiplier) && multiplier >= 1 ? multiplier : 1,
    active: normalizeBoolean(payload.active ?? false),
  };
};

export const listPriceHikes = async (currentAdmin = null) => {
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'set_prices.view', 'price hikes');
  }

  const items = await PriceHike.find({}).sort({ createdAt: -1 }).lean();

  return {
    results: items.map(serializePriceHike),
    active_multiplier: await getActivePriceHikeMultiplier(),
  };
};

export const createPriceHike = async (payload, currentAdmin = null) => {
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'set_prices.view', 'price hikes');
  }

  const data = normalizePriceHikePayload(payload);

  if (data.startTime === data.endTime) {
    throw new ApiError(400, 'Start and end time cannot be the same');
  }

  const item = await PriceHike.create(data);
  return serializePriceHike(item.toObject());
};

export const updatePriceHike = async (id, payload, currentAdmin = null) => {
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'set_prices.view', 'price hikes');
  }

  const existing = await PriceHike.findById(id);
  if (!existing) {
    throw new ApiError(404, 'Price hike not found');
  }

  // A toggle sends only { active }, so merge onto the stored row rather than
  // normalising a partial payload into defaults and wiping the schedule.
  const data = normalizePriceHikePayload({ ...serializePriceHike(existing.toObject()), ...payload });

  if (data.startTime === data.endTime) {
    throw new ApiError(400, 'Start and end time cannot be the same');
  }

  const item = await PriceHike.findByIdAndUpdate(id, data, { returnDocument: 'after' }).lean();
  return serializePriceHike(item);
};

export const deletePriceHike = async (id, currentAdmin = null) => {
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'set_prices.view', 'price hikes');
  }

  const item = await PriceHike.findByIdAndDelete(id);
  if (!item) {
    throw new ApiError(404, 'Price hike not found');
  }

  return { id: String(id) };
};

/// Automatic surge settings and the hexagons surging right now, for the
/// Price Hike page.
///
/// Surge is set per vehicle type: `settings` is the default every vehicle
/// without its own follows, and `vehicles` lists every vehicle type with the
/// settings that price it now - its own (`has_own_settings`) or default's.
const automaticSurgeState = async () => {
  const [profiles, vehicles, active] = await Promise.all([
    getSurgeProfiles({ fresh: true }),
    Vehicle.find({}).select('name status active transport_type').sort({ name: 1 }).lean(),
    listActiveSurges({ radiusKm: Infinity }),
  ]);

  return {
    settings: profiles.default,
    vehicles: vehicles.map((vehicle) => {
      const id = String(vehicle._id);
      const own = profiles.vehicles.get(id);
      return {
        vehicle_type_id: id,
        name: vehicle.name || 'Vehicle',
        transport_type: vehicle.transport_type || '',
        active: vehicle.active !== false && Number(vehicle.status ?? 1) !== 0,
        has_own_settings: Boolean(own),
        settings: own || { ...profiles.default, vehicle_type_id: null },
      };
    }),
    default_profile: DEFAULT_PROFILE,
    active,
  };
};

export const getAutomaticSurge = async (currentAdmin = null) => {
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'set_prices.view', 'price hikes');
  }
  return automaticSurgeState();
};

/// Saves the default settings, or one vehicle type's with `vehicle_type_id`.
export const updateAutomaticSurge = async (payload, currentAdmin = null) => {
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'set_prices.view', 'price hikes');
  }
  await updateSurgeSettings(payload || {});
  return automaticSurgeState();
};

/// A vehicle type stops using its own settings and follows default again.
export const resetVehicleAutomaticSurge = async (vehicleTypeId, currentAdmin = null) => {
  if (currentAdmin) {
    assertAdminPermission(currentAdmin, 'set_prices.view', 'price hikes');
  }
  await resetVehicleSurgeSettings(vehicleTypeId);
  return automaticSurgeState();
};

/// The records behind one card on the Admin Earnings page, with the same
/// filters. `metric` is the card: commission, gross-fare, driver-earnings,
/// net-revenue, average-commission, cash-commission, online-commission,
/// refunds or completed.
export const getAdminEarningDetails = async (query = {}) => {
  const metric = String(query.metric || 'commission');
  const earnings = await getAdminEarnings({ ...query, page: 1, limit: 100000 });
  const rides = earnings.results || [];
  const summary = earnings.summary || {};
  const money = (value) => Number(Number(value || 0).toFixed(2));

  const rideColumns = [
    { key: 'completedAt', label: 'Completed', type: 'date' },
    { key: 'requestId', label: 'Request' },
    { key: 'userName', label: 'Rider' },
    { key: 'driverName', label: 'Driver' },
    { key: 'vehicleName', label: 'Vehicle' },
    { key: 'paymentDetail', label: 'Paid' },
    { key: 'grossFare', label: 'Fare', type: 'money' },
    { key: 'adminCommission', label: 'Commission', type: 'money' },
    { key: 'driverEarnings', label: 'Driver earning', type: 'money' },
  ];
  const rideResult = (title, description, rows, totalLabel, totalValue) => ({
    metric,
    title,
    description,
    columns: rideColumns,
    rows,
    total: rows.length,
    totals: [{ label: totalLabel, value: totalValue, type: 'money' }, { label: 'Trips', value: rows.length }],
  });

  switch (metric) {
    case 'gross-fare':
      return rideResult('Gross ride fare', 'Every completed trip and its fare.', rides, 'Gross fare', money(summary.grossFare));
    case 'completed':
      return rideResult('Completed transactions', 'Every completed trip in the period.', rides, 'Gross fare', money(summary.grossFare));
    case 'average-commission':
      return {
        ...rideResult('Average commission', 'Total commission divided by completed trips.', rides, 'Total commission', money(summary.adminCommission)),
        totals: [
          { label: 'Average per trip', value: money(summary.averageCommission), type: 'money' },
          { label: 'Total commission', value: money(summary.adminCommission), type: 'money' },
          { label: 'Trips', value: rides.length },
        ],
      };
    case 'cash-commission': {
      const rows = rides.filter((row) => row.paymentMethod === 'cash');
      return rideResult('Cash commission', 'Commission on trips the rider paid in cash.', rows, 'Commission', money(summary.byCash));
    }
    case 'online-commission': {
      const rows = rides.filter((row) => row.paymentMethod === 'online');
      return rideResult('Online commission', 'Commission on trips paid online (including cash bookings paid online at the end).', rows, 'Commission', money(summary.byOnline));
    }
    case 'driver-earnings': {
      const byDriver = new Map();
      for (const row of rides) {
        const key = row.driverId || row.driverName;
        const entry = byDriver.get(key) || { driverName: row.driverName, driverPhone: row.driverPhone, trips: 0, grossFare: 0, adminCommission: 0, driverEarnings: 0 };
        entry.trips += 1;
        entry.grossFare += row.grossFare;
        entry.adminCommission += row.adminCommission;
        entry.driverEarnings += row.driverEarnings;
        byDriver.set(key, entry);
      }
      const rows = [...byDriver.values()]
        .map((entry) => ({ ...entry, grossFare: money(entry.grossFare), adminCommission: money(entry.adminCommission), driverEarnings: money(entry.driverEarnings) }))
        .sort((a, b) => b.driverEarnings - a.driverEarnings);
      return {
        metric,
        title: 'Driver earnings',
        description: 'What each driver earned from completed trips, after commission.',
        columns: [
          { key: 'driverName', label: 'Driver' },
          { key: 'driverPhone', label: 'Phone' },
          { key: 'trips', label: 'Trips' },
          { key: 'grossFare', label: 'Fares', type: 'money' },
          { key: 'adminCommission', label: 'Commission', type: 'money' },
          { key: 'driverEarnings', label: 'Earned', type: 'money' },
        ],
        rows,
        total: rows.length,
        totals: [{ label: 'Driver earnings', value: money(summary.driverEarnings), type: 'money' }, { label: 'Drivers', value: rows.length }],
      };
    }
    case 'net-revenue': {
      const range = dateMatch(earnings.filters?.from ? new Date(earnings.filters.from) : null, earnings.filters?.to ? new Date(`${earnings.filters.to}T23:59:59.999`) : null);
      const rows = [
        { item: 'Commission on completed trips', detail: `${rides.length} trips`, amount: money(summary.adminCommission) },
        { item: 'Refunds to riders', detail: `${summary.refundCount || 0} refunds`, amount: -money(summary.refunds) },
      ];
      return {
        metric,
        title: 'Net platform revenue',
        description: 'Commission less refunds. Zone and vehicle filters apply to commission only.',
        columns: [
          { key: 'item', label: 'Item' },
          { key: 'detail', label: 'Detail' },
          { key: 'amount', label: 'Amount', type: 'money' },
        ],
        rows,
        total: rows.length,
        totals: [{ label: 'Net platform revenue', value: money(summary.netPlatformRevenue), type: 'money' }],
      };
    }
    case 'refunds': {
      const range = dateMatch(earnings.filters?.from ? new Date(earnings.filters.from) : null, earnings.filters?.to ? new Date(`${earnings.filters.to}T23:59:59.999`) : null);
      const wallets = await UserWallet.aggregate([
        { $unwind: '$transactions' },
        { $match: { 'transactions.kind': 'credit', 'transactions.title': /refund/i, ...(Object.keys(range).length ? { 'transactions.createdAt': range } : {}) } },
        { $sort: { 'transactions.createdAt': -1 } },
        { $lookup: { from: 'taxiusers', localField: 'userId', foreignField: '_id', as: 'user' } },
      ]);
      const rows = wallets.map((w) => ({
        createdAt: w.transactions.createdAt,
        rider: w.user?.[0]?.name || 'Rider',
        phone: w.user?.[0]?.phone || '',
        title: w.transactions.title,
        amount: money(w.transactions.amount),
      }));
      return {
        metric,
        title: 'Refunds',
        description: 'Refunds credited to riders\' wallets.',
        columns: [
          { key: 'createdAt', label: 'Date', type: 'date' },
          { key: 'rider', label: 'Rider' },
          { key: 'phone', label: 'Phone' },
          { key: 'title', label: 'Reason' },
          { key: 'amount', label: 'Amount', type: 'money' },
        ],
        rows,
        total: rows.length,
        totals: [{ label: 'Refunded', value: money(summary.refunds), type: 'money' }, { label: 'Refunds', value: rows.length }],
      };
    }
    case 'commission':
    default:
      return rideResult('Total commission', 'Commission Buddy earned on each completed trip.', rides, 'Commission', money(summary.adminCommission));
  }
};
