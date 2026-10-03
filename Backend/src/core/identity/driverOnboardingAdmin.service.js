import mongoose from 'mongoose';
import { ValidationError, NotFoundError } from '../auth/errors.js';
import { BuddyIdentity } from './buddyIdentity.model.js';
import { FoodDeliveryPartner } from '../../modules/food/delivery/models/deliveryPartner.model.js';

export const ONBOARDING_SERVICES = ['food'];

const SERVICE_LABELS = {
  food: 'Food',
};

const normalizeService = (service) => {
  const svc = String(service || '').trim();
  if (!ONBOARDING_SERVICES.includes(svc)) {
    throw new ValidationError(`Invalid service. Must be one of: ${ONBOARDING_SERVICES.join(', ')}`);
  }
  return svc;
};

const normalizeListStatus = (status) => {
  const raw = String(status || 'pending').toLowerCase();
  if (raw === 'denied' || raw === 'rejected') return 'rejected';
  if (raw === 'approved') return 'approved';
  return 'pending';
};

const legacyFoodStatus = (partner) => {
  if (!partner) return 'not_enabled';
  const s = String(partner.status || 'pending').toLowerCase();
  if (s === 'rejected') return 'rejected';
  if (s === 'approved') return 'approved';
  return 'pending';
};

export const getEffectiveServiceStatus = (identity, service, partner = null) => {
  const svc = normalizeService(service);
  const stored = identity?.serviceStatuses?.[svc];
  if (stored?.status && stored.status !== 'not_enabled') {
    return {
      status: stored.status,
      rejectionReason: stored.rejectionReason || '',
      rejectedAt: stored.rejectedAt || null,
      approvedAt: stored.approvedAt || null,
    };
  }

  const selected = Array.isArray(identity?.onboardingServices)
    ? identity.onboardingServices.includes(svc)
    : false;
  if (!selected) {
    return { status: 'not_enabled', rejectionReason: '', rejectedAt: null, approvedAt: null };
  }

  const status = legacyFoodStatus(partner);
  return {
    status,
    rejectionReason: partner?.rejectionReason || '',
    rejectedAt: partner?.rejectedAt || null,
    approvedAt: partner?.approvedAt || null,
  };
};

export const setServiceStatusOnIdentity = (identity, service, patch) => {
  const svc = normalizeService(service);
  identity.serviceStatuses = identity.serviceStatuses || {};
  const current = identity.serviceStatuses[svc] || {};
  identity.serviceStatuses[svc] = {
    status: patch.status ?? current.status ?? 'not_enabled',
    rejectionReason: patch.rejectionReason ?? current.rejectionReason ?? '',
    rejectedAt: patch.rejectedAt !== undefined ? patch.rejectedAt : current.rejectedAt ?? null,
    approvedAt: patch.approvedAt !== undefined ? patch.approvedAt : current.approvedAt ?? null,
  };
  identity.markModified('serviceStatuses');
};

export const initServiceStatusesForOnboarding = (identity, services = []) => {
  const selected = Array.isArray(services) ? services : [];
  for (const svc of ONBOARDING_SERVICES) {
    if (selected.includes(svc)) {
      const existing = identity.serviceStatuses?.[svc];
      if (existing?.status === 'approved') continue;
      setServiceStatusOnIdentity(identity, svc, {
        status: 'pending',
        rejectionReason: '',
        rejectedAt: null,
        approvedAt: null,
      });
    } else {
      setServiceStatusOnIdentity(identity, svc, {
        status: 'not_enabled',
        rejectionReason: '',
        rejectedAt: null,
        approvedAt: null,
      });
    }
  }
};

export const resolveIdentityFromRequestId = async (id) => {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;

  const identity = await BuddyIdentity.findById(id);
  if (identity) return identity;

  const partner = await FoodDeliveryPartner.findById(id).select('identityId phone').lean();
  if (partner?.identityId) {
    return BuddyIdentity.findById(partner.identityId);
  }

  return null;
};

const findProfilesForIdentity = async (identityId) => {
  const partner = await FoodDeliveryPartner.findOne({ identityId }).lean();
  return { partner };
};

const formatServicesLabel = (services = []) =>
  services.map((s) => SERVICE_LABELS[s] || s).join(', ');

const buildJoinRequestRow = (identity, service, partner, index = 0) => {
  const svcStatus = getEffectiveServiceStatus(identity, service, partner);
  const services = Array.isArray(identity.onboardingServices) ? identity.onboardingServices : [];
  const foodVehicle = identity.foodVehicle || {};

  return {
    _id: partner?._id || identity._id,
    identityId: identity._id,
    partnerId: partner?._id || null,
    sl: index + 1,
    name: identity.name || partner?.name || '',
    email: identity.email || partner?.email || '',
    phone: identity.phone || partner?.phone || '',
    zone: identity.city || partner?.city || '',
    jobType: partner?.jobType || '',
    vehicleType: foodVehicle.type || partner?.vehicleType || '',
    services,
    servicesLabel: formatServicesLabel(services),
    service,
    serviceStatus: svcStatus.status,
    status: svcStatus.status === 'rejected' ? 'denied' : svcStatus.status,
    rejectionReason: svcStatus.rejectionReason || undefined,
    isResubmission: Boolean(
      (partner?.submissionHistory?.length || 0) > 0 ||
        (identity.serviceStatuses?.[service]?.rejectedAt && svcStatus.status === 'pending'),
    ),
    profilePhoto: identity.onboardingSelfieUrl || partner?.profilePhoto || null,
    profileImage: identity.onboardingSelfieUrl
      ? { url: identity.onboardingSelfieUrl }
      : partner?.profilePhoto
        ? { url: partner.profilePhoto }
        : null,
    serviceStatuses: ONBOARDING_SERVICES.reduce((acc, svc) => {
      acc[svc] = getEffectiveServiceStatus(identity, svc, partner);
      return acc;
    }, {}),
  };
};

export async function getJoinRequests(service, query = {}) {
  const svc = normalizeService(service);
  const listStatus = normalizeListStatus(query.status);

  const filter = {
    onboardingComplete: true,
    onboardingServices: svc,
  };

  const andParts = [];
  if (query.search && typeof query.search === 'string' && query.search.trim()) {
    const term = query.search.trim();
    andParts.push({
      $or: [
        { name: { $regex: term, $options: 'i' } },
        { phone: { $regex: term, $options: 'i' } },
        { email: { $regex: term, $options: 'i' } },
      ],
    });
  }
  if (query.zone && String(query.zone).trim()) {
    const z = String(query.zone).trim();
    andParts.push({ city: { $regex: z, $options: 'i' } });
  }
  if (andParts.length) filter.$and = andParts;

  const skip = Math.max(0, (Number(query.page) || 1) - 1) * Math.max(1, Math.min(1000, Number(query.limit) || 100));
  const limitNum = Math.max(1, Math.min(1000, Number(query.limit) || 100));

  const identities = await BuddyIdentity.find(filter).sort({ updatedAt: -1 }).lean();
  const identityIds = identities.map((i) => i._id);

  const partners = await FoodDeliveryPartner.find({ identityId: { $in: identityIds } }).lean();
  const partnerByIdentity = new Map(partners.map((p) => [String(p.identityId), p]));

  const matched = [];
  for (const identity of identities) {
    const partner = partnerByIdentity.get(String(identity._id)) || null;
    const svcStatus = getEffectiveServiceStatus(identity, svc, partner);
    if (svcStatus.status !== listStatus) continue;

    if (query.vehicleType && String(query.vehicleType).trim()) {
      const vt = String(query.vehicleType).trim().toLowerCase();
      const rowType = (identity.foodVehicle?.type || partner?.vehicleType || '').toLowerCase();
      if (!rowType.includes(vt)) continue;
    }

    matched.push(buildJoinRequestRow(identity, svc, partner, matched.length));
  }

  return { requests: matched.slice(skip, skip + limitNum) };
}

export async function getJoinRequestDetail(identityId) {
  const identity = await BuddyIdentity.findById(identityId).lean();
  if (!identity) return null;

  const { partner } = await findProfilesForIdentity(identity._id);
  const services = Array.isArray(identity.onboardingServices) ? identity.onboardingServices : [];

  const serviceStatuses = ONBOARDING_SERVICES.reduce((acc, svc) => {
    acc[svc] = getEffectiveServiceStatus(identity, svc, partner);
    return acc;
  }, {});

  return {
    identityId: identity._id,
    partnerId: partner?._id || null,
    name: identity.name || '',
    email: identity.email || '',
    phone: identity.phone || '',
    city: identity.city || '',
    state: identity.state || '',
    gender: identity.gender || '',
    onboardingServices: services,
    servicesLabel: formatServicesLabel(services),
    serviceStatuses,
    onboardingComplete: Boolean(identity.onboardingComplete),
    profilePhoto: identity.onboardingSelfieUrl || partner?.profilePhoto || null,
    profileImage: identity.onboardingSelfieUrl ? { url: identity.onboardingSelfieUrl } : null,
    kyc: identity.kyc || {},
    bank: identity.bank || {},
    foodVehicle: identity.foodVehicle || {},
    selfieUrl: identity.onboardingSelfieUrl || '',
    submissionHistory: Array.isArray(partner?.submissionHistory) ? partner.submissionHistory : [],
    partner: partner || null,
  };
}

const syncFoodPartnerForService = async (identity, service, statusPatch) => {
  const partner = await FoodDeliveryPartner.findOne({ identityId: identity._id });
  if (!partner) return null;

  if (service === 'food') {
    if (statusPatch.status === 'approved') {
      partner.status = 'approved';
      partner.approvedAt = statusPatch.approvedAt || new Date();
      partner.rejectedAt = undefined;
      partner.rejectionReason = '';
    } else if (statusPatch.status === 'rejected') {
      partner.status = 'rejected';
      partner.rejectedAt = statusPatch.rejectedAt || new Date();
      partner.rejectionReason = statusPatch.rejectionReason || '';
      partner.approvedAt = undefined;
    } else if (statusPatch.status === 'pending') {
      partner.status = 'pending';
      partner.rejectionReason = '';
      partner.rejectedAt = undefined;
      partner.approvedAt = undefined;
    }
  }

  await partner.save();
  return partner;
};

export async function approveDriverService(requestId, service) {
  const svc = normalizeService(service);
  const identity = await resolveIdentityFromRequestId(requestId);
  if (!identity) throw new NotFoundError('Driver onboarding request not found');

  const services = Array.isArray(identity.onboardingServices) ? identity.onboardingServices : [];
  if (!services.includes(svc)) {
    throw new ValidationError(`Driver did not apply for ${SERVICE_LABELS[svc] === 'Food' ? 'delivery' : SERVICE_LABELS[svc]}`);
  }

  const approvedAt = new Date();
  setServiceStatusOnIdentity(identity, svc, {
    status: 'approved',
    rejectionReason: '',
    rejectedAt: null,
    approvedAt,
  });
  await identity.save();

  if (svc === 'food') {
    await syncFoodPartnerForService(identity, svc, { status: 'approved', approvedAt });
  }

  const { partner } = await findProfilesForIdentity(identity._id);
  return buildJoinRequestRow(identity.toObject(), svc, partner);
}

export async function rejectDriverService(requestId, service, reason) {
  const svc = normalizeService(service);
  const normalizedReason = typeof reason === 'string' ? reason.trim() : '';
  if (!normalizedReason) {
    throw new ValidationError('Rejection reason is required');
  }

  const identity = await resolveIdentityFromRequestId(requestId);
  if (!identity) throw new NotFoundError('Driver onboarding request not found');

  const services = Array.isArray(identity.onboardingServices) ? identity.onboardingServices : [];
  if (!services.includes(svc)) {
    throw new ValidationError(`Driver did not apply for ${SERVICE_LABELS[svc] === 'Food' ? 'delivery' : SERVICE_LABELS[svc]}`);
  }

  const rejectedAt = new Date();
  setServiceStatusOnIdentity(identity, svc, {
    status: 'rejected',
    rejectionReason: normalizedReason,
    rejectedAt,
    approvedAt: null,
  });
  await identity.save();

  if (svc === 'food') {
    await syncFoodPartnerForService(identity, svc, {
      status: 'rejected',
      rejectionReason: normalizedReason,
      rejectedAt,
    });
  }

  const { partner } = await findProfilesForIdentity(identity._id);
  return buildJoinRequestRow(identity.toObject(), svc, partner);
}

export const summariseCapabilitiesFromIdentity = (identity, partner = null) => ({
  food: getEffectiveServiceStatus(identity, 'food', partner).status,
});
