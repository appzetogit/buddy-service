import { ValidationError, NotFoundError, ConflictError } from '../auth/errors.js';
import { BuddyIdentity } from './buddyIdentity.model.js';
import { FoodDeliveryPartner } from '../../modules/food/delivery/models/deliveryPartner.model.js';

import {
  initServiceStatusesForOnboarding,
  setServiceStatusOnIdentity,
  summariseCapabilitiesFromIdentity,
  getEffectiveServiceStatus,
  ONBOARDING_SERVICES,
} from './driverOnboardingAdmin.service.js';

const VALID_SERVICES = ONBOARDING_SERVICES;
const FOOD_VEHICLE_TYPES = ['bike', 'scooter'];
const LEGACY_VEHICLE_TYPES = ['bike', 'scooter', 'auto', 'car'];

const needsFoodVehicleStep = (services = []) =>
  services.includes('food');

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_AADHAAR = /^\d{12}$/;
const RE_PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const RE_DL = /^[A-Z]{2}[ -]?\d{2}[ -]?[A-Z0-9]{1,15}$/i;
const RE_IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const RE_UPI = /^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/;
const RE_VEHICLE = /^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{1,4}$/;
const RE_HTTP_URL = /^https?:\/\/.+/i;
const RE_PERSON_NAME = /^[A-Za-z][A-Za-z\s.'-]{1,79}$/;

const assertString = (value, label, { min = 0, max = 500, pattern, patternMessage } = {}) => {
  const text = sanitize(value);
  if (!text || text.length < min) {
    throw new ValidationError(`${label} is required${min > 1 ? ` (min ${min} characters)` : ''}`);
  }
  if (text.length > max) {
    throw new ValidationError(`${label} is too long (max ${max})`);
  }
  if (pattern && !pattern.test(text)) {
    throw new ValidationError(patternMessage || `Invalid ${label}`);
  }
  return text;
};

const assertOptionalString = (value, label, { max = 500, pattern, patternMessage } = {}) => {
  const text = sanitize(value);
  if (!text) return '';
  if (text.length > max) {
    throw new ValidationError(`${label} is too long (max ${max})`);
  }
  if (pattern && !pattern.test(text)) {
    throw new ValidationError(patternMessage || `Invalid ${label}`);
  }
  return text;
};

const assertHttpUrl = (value, label) => {
  const text = sanitize(value);
  if (!text || !RE_HTTP_URL.test(text)) {
    throw new ValidationError(`${label} is required`);
  }
  return text;
};

const assertOptionalHttpUrl = (value, label) => {
  const text = sanitize(value);
  if (!text) return '';
  if (!RE_HTTP_URL.test(text)) {
    throw new ValidationError(`Invalid ${label}`);
  }
  return text;
};

const getSelectedServices = (identity) => {
  const services = Array.isArray(identity?.onboardingServices) ? identity.onboardingServices : [];
  return services.filter((svc) => VALID_SERVICES.includes(svc));
};

const getNextStep = (identity, currentStep) => {
  const services = getSelectedServices(identity);
  const hasFoodOrQc = needsFoodVehicleStep(services);

  switch (String(currentStep || '').toLowerCase()) {
    case 'services':
      if (hasFoodOrQc) return 'vehicle_food';
      return 'basics';
    case 'vehicle_food':
      return 'basics';
    case 'basics':
      return 'kyc';
    case 'kyc':
      return 'bank';
    case 'bank':
      return 'selfie';
    case 'selfie':
      return 'done';
  // Legacy flow support
    case 'vehicle':
      return 'selfie';
    case 'capabilities':
    case 'services':
      return 'done';
    default:
      return identity.onboardingStep || 'services';
  }
};

/** Map stored step names to the wizard step the client understands. */
export const normalizeOnboardingStepForClient = (step, identity = null) => {
  const normalized = String(step || 'services').toLowerCase();
  if (normalized === 'capabilities') return 'services';
  if (normalized === 'services') {
    // Legacy: final service picker before submit (profile already filled).
    if (identity?.name && identity?.kyc?.aadhaar?.number) {
      return 'selfie';
    }
    return 'services';
  }
  if (normalized === 'vehicle') {
    if (identity?.vehicle?.number && !identity?.foodVehicle?.number) {
      return 'selfie';
    }
    const services = getSelectedServices(identity);
    const effective = services.length ? services : ['food'];
    if (needsFoodVehicleStep(effective) && !identity?.foodVehicle?.number) return 'vehicle_food';
    return 'basics';
  }
  if (normalized === 'done') return 'done';
  if (
    !getSelectedServices(identity).length &&
    !['services', 'vehicle_food'].includes(normalized)
  ) {
    return 'services';
  }
  return normalized;
};

const sanitize = (val) =>
  typeof val === 'string' ? val.trim() : val === undefined ? undefined : val;

const advanceStep = async (identity, currentStep) => {
  identity.onboardingStep = getNextStep(identity, currentStep);
  await identity.save();
};

const normalizeVehicleType = (value = '') => {
  const v = String(value || '').trim().toLowerCase();
  if (v.includes('bike') || v.includes('scooter')) return 'bike';
  if (v.includes('auto') || v.includes('rickshaw')) return 'auto';
  if (LEGACY_VEHICLE_TYPES.includes(v)) return v;
  return 'bike';
};

const normalizeVehicleNumber = (value = '') => String(value || '').trim().toUpperCase();

const excludeExistingDoc = (existingDoc) =>
  existingDoc?._id ? { _id: { $ne: existingDoc._id } } : {};

const assertUniqueVehicleNumber = async (identity, vehicleNumber) => {
  const normalized = normalizeVehicleNumber(vehicleNumber);
  if (!normalized) return;

  const existingPartner = await FoodDeliveryPartner.findOne({
    $or: [{ identityId: identity._id }, { phone: identity.phone }],
  })
    .select('_id phone')
    .lean();

  const partnerConflict = await FoodDeliveryPartner.findOne({
    vehicleNumber: normalized,
    ...excludeExistingDoc(existingPartner),
  })
    .select('phone name')
    .lean();

  if (partnerConflict) {
    throw new ConflictError(
      `Vehicle number ${normalized} is already registered with another delivery partner`,
    );
  }
};

const assertUniquePhoneForProfiles = async (identity, { food = false } = {}) => {
  const phone = String(identity.phone || '').trim();
  if (!phone) return;

  if (food) {
    const partnerConflict = await FoodDeliveryPartner.findOne({
      phone,
      identityId: { $ne: identity._id },
    })
      .select('_id')
      .lean();
    if (partnerConflict) {
      throw new ConflictError('This phone number is already registered as a delivery partner');
    }
  }
};

const normalizeFoodVehicleType = (value = '') => {
  const v = String(value || '').trim().toLowerCase();
  if (v.includes('scooter')) return 'scooter';
  return 'bike';
};

const assertCreatableProfiles = async (identity, services = []) => {
  const normalizedServices = Array.isArray(services) ? services : [];
  if (normalizedServices.includes('food')) {
    await assertUniquePhoneForProfiles(identity, { food: true });
    const foodNumber = identity.foodVehicle?.number || identity.vehicle?.number;
    await assertUniqueVehicleNumber(identity, foodNumber);
  }
};

export const updateServices = async (identity, body) => {
  const services = Array.isArray(body?.services)
    ? body.services.filter((svc) => VALID_SERVICES.includes(svc))
    : [];
  if (services.length === 0) {
    throw new ValidationError('Select at least one service to drive for');
  }
  identity.onboardingServices = services;
  identity.markModified('onboardingServices');
  await advanceStep(identity, 'services');
  return identity;
};

export const updateFoodVehicle = async (identity, body) => {
  const { type, number, make, model, color, photoUrl, rcUrl, insuranceUrl } = body || {};
  const vehicleType = normalizeFoodVehicleType(type);
  if (!FOOD_VEHICLE_TYPES.includes(vehicleType)) {
    throw new ValidationError('Select a valid food delivery vehicle type');
  }
  const vehicleNumber = assertString(number, 'Vehicle number', {
    max: 15,
    pattern: RE_VEHICLE,
    patternMessage: 'Vehicle number must look like MH12AB1234',
  });
  const vehicleMake = assertString(make, 'Vehicle make', { min: 2, max: 60, pattern: /^[A-Za-z0-9][A-Za-z0-9\s.\-/&'()]{0,59}$/ });
  const vehicleModel = assertString(model, 'Vehicle model', { min: 2, max: 60, pattern: /^[A-Za-z0-9][A-Za-z0-9\s.\-/&'()]{0,59}$/ });

  identity.foodVehicle = {
    type: vehicleType,
    make: vehicleMake,
    model: vehicleModel,
    number: normalizeVehicleNumber(vehicleNumber),
    color: assertOptionalString(color, 'Vehicle color', { max: 30 }) || '',
    photoUrl: assertOptionalHttpUrl(photoUrl, 'Vehicle photo') || '',
    rcUrl: assertOptionalHttpUrl(rcUrl, 'RC document') || '',
    insuranceUrl: assertOptionalHttpUrl(insuranceUrl, 'Insurance document') || '',
  };
  await assertUniqueVehicleNumber(identity, identity.foodVehicle.number);
  identity.markModified('foodVehicle');
  await advanceStep(identity, 'vehicle_food');
  return identity;
};

export const updateBasics = async (identity, body) => {
  const { name, email, gender, city, state, profileImage } = body || {};
  identity.name = assertString(name, 'Name', { min: 2, max: 80, pattern: RE_PERSON_NAME });
  if (email !== undefined) {
    const normalizedEmail = assertOptionalString(email, 'Email', {
      max: 120,
      pattern: RE_EMAIL,
      patternMessage: 'Enter a valid email address',
    });
    identity.email = normalizedEmail ? normalizedEmail.toLowerCase() : '';
  }
  if (gender !== undefined) {
    const normalizedGender = sanitize(gender);
    if (normalizedGender && !['male', 'female', 'other'].includes(normalizedGender)) {
      throw new ValidationError('Select a valid gender option');
    }
    identity.gender = normalizedGender || '';
  }
  if (city !== undefined) {
    identity.city = assertOptionalString(city, 'City', { max: 60 }) || '';
  }
  if (state !== undefined) {
    identity.state = assertString(state, 'State', { min: 2, max: 60 });
  }
  if (profileImage !== undefined) {
    identity.profileImage = assertOptionalHttpUrl(profileImage, 'Profile image') || '';
  }

  await advanceStep(identity, 'basics');

  // Keep pending partner docs in sync so admin View Details shows city/state.
  const profilePatch = {
    name: identity.name,
    email: identity.email || '',
    city: identity.city || '',
    state: identity.state || '',
  };
  await FoodDeliveryPartner.updateMany(
    { $or: [{ identityId: identity._id }, { phone: identity.phone }] },
    { $set: profilePatch },
  );

  return identity;
};

export const updateKyc = async (identity, body) => {
  const { aadhaar, pan, drivingLicense } = body || {};
  identity.kyc = identity.kyc || {};
  if (aadhaar) {
    const aadhaarNumber = assertString(aadhaar.number, 'Aadhaar number', {
      pattern: RE_AADHAAR,
      patternMessage: 'Aadhaar must be a 12-digit number',
    });
    const aadhaarFront = assertHttpUrl(
      aadhaar.documentUrl || identity.kyc.aadhaar?.documentUrl,
      'Aadhaar front photo',
    );
    identity.kyc.aadhaar = {
      number: aadhaarNumber,
      documentUrl: aadhaarFront,
      backDocumentUrl:
        assertOptionalHttpUrl(
          aadhaar.backDocumentUrl || identity.kyc.aadhaar?.backDocumentUrl,
          'Aadhaar back photo',
        ) || '',
      uploadedAt: new Date(),
    };
  }
  if (pan) {
    const panNumber = assertOptionalString(pan.number, 'PAN number', {
      max: 10,
      pattern: RE_PAN,
      patternMessage: 'PAN must look like ABCDE1234F',
    });
    if (panNumber) {
      identity.kyc.pan = {
        number: panNumber,
        documentUrl:
          assertHttpUrl(pan.documentUrl || identity.kyc.pan?.documentUrl, 'PAN photo'),
        uploadedAt: new Date(),
      };
    } else {
      identity.kyc.pan = {
        number: '',
        documentUrl: '',
        uploadedAt: new Date(),
      };
    }
  }
  if (drivingLicense) {
    const dlNumber = assertString(drivingLicense.number, 'Driving licence number', {
      max: 20,
      pattern: RE_DL,
      patternMessage: 'Enter a valid driving licence number',
    });
    identity.kyc.drivingLicense = {
      number: dlNumber.toUpperCase(),
      documentUrl: assertHttpUrl(
        drivingLicense.documentUrl || identity.kyc.drivingLicense?.documentUrl,
        'Driving licence photo',
      ),
      uploadedAt: new Date(),
    };
  }

  if (
    !identity.kyc.aadhaar?.number ||
    !identity.kyc.aadhaar?.documentUrl ||
    !identity.kyc.drivingLicense?.number ||
    !identity.kyc.drivingLicense?.documentUrl
  ) {
    throw new ValidationError('Aadhaar and Driving License details with photos are required');
  }

  identity.markModified('kyc');
  await advanceStep(identity, 'kyc');
  return identity;
};

export const updateBank = async (identity, body) => {
  const { accountHolderName, accountNumber, ifscCode, bankName, branchName, upiId, upiQrCodeUrl } =
    body || {};

  const normalizedUpi = assertOptionalString(upiId, 'UPI ID', {
    max: 256,
    pattern: RE_UPI,
    patternMessage: 'UPI must look like name@bank',
  });
  const normalizedAccount = sanitize(accountNumber)?.replace(/\D/g, '') || '';
  const normalizedIfsc = sanitize(ifscCode) ? String(ifscCode).trim().toUpperCase() : '';

  const hasBank = normalizedAccount && normalizedIfsc;
  const hasUpi = !!normalizedUpi;

  if (!hasBank && !hasUpi) {
    throw new ValidationError(
      'Provide either bank account details (accountNumber + ifscCode) or a UPI ID',
    );
  }

  if (hasBank) {
    if (!/^\d{9,18}$/.test(normalizedAccount)) {
      throw new ValidationError('Account number must be 9–18 digits');
    }
    if (!RE_IFSC.test(normalizedIfsc)) {
      throw new ValidationError('IFSC should look like HDFC0001234');
    }
  }

  identity.bank = {
    accountHolderName: hasBank
      ? assertString(accountHolderName, 'Account holder name', { min: 2, max: 80, pattern: RE_PERSON_NAME })
      : '',
    accountNumber: hasBank ? normalizedAccount : '',
    ifscCode: hasBank ? normalizedIfsc : '',
    bankName: hasBank
      ? assertOptionalString(bankName, 'Bank name', { max: 80 }) || ''
      : '',
    branchName: hasBank
      ? assertOptionalString(branchName, 'Branch name', { max: 80 }) || ''
      : '',
    upiId: hasUpi ? normalizedUpi : '',
    upiQrCodeUrl: hasUpi
      ? assertOptionalHttpUrl(upiQrCodeUrl, 'UPI QR code') || ''
      : '',
    updatedAt: new Date(),
  };

  identity.markModified('bank');
  await advanceStep(identity, 'bank');

  // Keep partner payout fields in sync for admin View Details.
  const bankPatch = {
    bankAccountHolderName: identity.bank.accountHolderName || '',
    bankAccountNumber: identity.bank.accountNumber || '',
    bankIfscCode: identity.bank.ifscCode || '',
    bankName: identity.bank.bankName || '',
    upiId: identity.bank.upiId || '',
    upiQrCode: identity.bank.upiQrCodeUrl || '',
  };
  await FoodDeliveryPartner.updateMany(
    { $or: [{ identityId: identity._id }, { phone: identity.phone }] },
    { $set: bankPatch },
  );

  return identity;
};

export const updateVehicle = async (identity, body) => {
  const { type, make, model, number, color, photoUrl, rcUrl, insuranceUrl } = body || {};
  if (!type || !number) {
    throw new ValidationError('Vehicle type and number are required');
  }
  identity.vehicle = {
    type: normalizeVehicleType(type),
    make: sanitize(make) || '',
    model: sanitize(model) || '',
    number: String(number || '').trim().toUpperCase(),
    color: sanitize(color) || '',
    photoUrl: sanitize(photoUrl) || '',
    rcUrl: sanitize(rcUrl) || '',
    insuranceUrl: sanitize(insuranceUrl) || '',
  };
  await assertUniqueVehicleNumber(identity, identity.vehicle.number);
  identity.markModified('vehicle');
  await advanceStep(identity, 'vehicle');
  return identity;
};

export const updateSelfie = async (identity, body) => {
  const url = assertHttpUrl(body?.selfieUrl, 'Selfie');
  identity.onboardingSelfieUrl = url;
  await advanceStep(identity, 'selfie');
  return identity;
};

/**
 * Marks onboarding complete and creates the requested capability profiles.
 *
 * `FoodDeliveryPartner` docs are created with `status: 'pending'` so admin must
 * approve them before the driver can pick up jobs. KYC + bank + vehicle data is
 * copied from the identity so the driver doesn't re-enter anything.
 */
const hasPayoutDetails = (bank = {}) => {
  const account = String(bank.accountNumber || '').replace(/\D/g, '');
  const ifsc = String(bank.ifscCode || '').trim();
  const upi = String(bank.upiId || '').trim();
  return (account && ifsc) || Boolean(upi);
};

const assertOnboardingDataComplete = (identityDoc, services = []) => {
  if (!identityDoc.name) {
    throw new ValidationError('Complete your profile details before submitting');
  }
  if (!identityDoc.kyc?.aadhaar?.number || !identityDoc.kyc?.aadhaar?.documentUrl) {
    throw new ValidationError('Aadhaar details with photo are required');
  }
  if (!identityDoc.kyc?.drivingLicense?.number || !identityDoc.kyc?.drivingLicense?.documentUrl) {
    throw new ValidationError('Driving licence details with photo are required');
  }
  if (identityDoc.kyc?.pan?.number && !identityDoc.kyc?.pan?.documentUrl) {
    throw new ValidationError('PAN photo is required when PAN number is provided');
  }
  if (!hasPayoutDetails(identityDoc.bank)) {
    throw new ValidationError('Add bank account or UPI payout details');
  }
  if (!identityDoc.onboardingSelfieUrl) {
    throw new ValidationError('Selfie is required before submitting');
  }

  if (services.includes('food')) {
    const foodVehicle = identityDoc.foodVehicle || {};
    if (!foodVehicle.number || !foodVehicle.make || !foodVehicle.model) {
      throw new ValidationError('Add your delivery vehicle details');
    }
  }
};

export const completeOnboarding = async (identity, body) => {
  const identityDoc = await BuddyIdentity.findById(identity._id);
  if (!identityDoc) throw new NotFoundError('Identity not found');

  const services = getSelectedServices(identityDoc).length
    ? getSelectedServices(identityDoc)
    : Array.isArray(body?.services)
      ? body.services.filter((svc) => VALID_SERVICES.includes(svc))
      : [];
  if (services.length === 0) {
    throw new ValidationError('Select at least one service to drive for');
  }

  assertOnboardingDataComplete(identityDoc, services);

  if (!identityDoc.onboardingServices?.length) {
    identityDoc.onboardingServices = services;
    identityDoc.markModified('onboardingServices');
  }

  await assertCreatableProfiles(identityDoc, services);

  const { partner: existingPartner } = await findPartnerProfiles(identityDoc);

  const serviceRejected = (svc) =>
    getEffectiveServiceStatus(identityDoc, svc, existingPartner).status === 'rejected';

  const isResubmit = services.includes('food') && serviceRejected('food');

  const needsPartner = services.includes('food');
  const createdPartner = needsPartner ? await ensureFoodPartner(identityDoc) : null;

  if (isResubmit) {
    for (const svc of services) {
      if (!serviceRejected(svc)) continue;
      setServiceStatusOnIdentity(identityDoc, svc, {
        status: 'pending',
        rejectionReason: '',
        rejectedAt: null,
        approvedAt: null,
      });
    }
  } else {
    initServiceStatusesForOnboarding(identityDoc, services);
  }

  identityDoc.onboardingComplete = true;
  identityDoc.onboardingStep = 'done';
  await BuddyIdentity.updateOne(
    { _id: identityDoc._id },
    {
      $set: {
        onboardingComplete: true,
        onboardingStep: 'done',
        serviceStatuses: identityDoc.serviceStatuses,
        'identityRefs.foodPartnerId': createdPartner?._id || identityDoc.identityRefs?.foodPartnerId || null,
      },
      $addToSet: { roles: 'DRIVER' },
    },
  );

  const capabilities = summariseCapabilitiesFromIdentity(
    identityDoc,
    createdPartner || existingPartner,
  );

  return {
    onboardingComplete: true,
    resubmitted: isResubmit,
    services: services,
    capabilities,
    serviceStatuses: identityDoc.serviceStatuses,
  };
};

const buildFoodPartnerFields = (identity) => ({
  identityId: identity._id,
  name: identity.name,
  phone: identity.phone,
  email: identity.email || '',
  countryCode: identity.countryCode || '+91',
  city: identity.city || '',
  state: identity.state || '',
  vehicleType: identity.foodVehicle?.type || identity.vehicle?.type || '',
  vehicleName:
    [identity.foodVehicle?.make, identity.foodVehicle?.model]
      .filter(Boolean)
      .join(' ')
      .trim() ||
    identity.vehicle?.make ||
    identity.vehicle?.model ||
    '',
  vehicleNumber: identity.foodVehicle?.number || identity.vehicle?.number || '',
  aadharNumber: identity.kyc?.aadhaar?.number || '',
  aadharPhoto: identity.kyc?.aadhaar?.documentUrl || '',
  panNumber: identity.kyc?.pan?.number || '',
  panPhoto: identity.kyc?.pan?.documentUrl || '',
  drivingLicenseNumber: identity.kyc?.drivingLicense?.number || '',
  drivingLicensePhoto: identity.kyc?.drivingLicense?.documentUrl || '',
  profilePhoto: identity.onboardingSelfieUrl || identity.profileImage || '',
  bankAccountHolderName: identity.bank?.accountHolderName || '',
  bankAccountNumber: identity.bank?.accountNumber || '',
  bankIfscCode: identity.bank?.ifscCode || '',
  bankName: identity.bank?.bankName || '',
  upiId: identity.bank?.upiId || '',
  upiQrCode: identity.bank?.upiQrCodeUrl || '',
});

const findPartnerProfiles = async (identity) => {
  const partner = await FoodDeliveryPartner.findOne({
    $or: [{ identityId: identity._id }, { phone: identity.phone }],
  });
  return { partner };
};

const summarisePartnerCapabilities = (identity, partner) =>
  summariseCapabilitiesFromIdentity(identity, partner);

const ensureFoodPartner = async (identity) => {
  const existing = await FoodDeliveryPartner.findOne({
    $or: [{ identityId: identity._id }, { phone: identity.phone }],
  });
  const fields = buildFoodPartnerFields(identity);
  const foodRejected =
    getEffectiveServiceStatus(identity, 'food', existing).status === 'rejected';

  if (existing) {
    if (!existing.identityId) {
      existing.identityId = identity._id;
    }

    const foodApproved =
      getEffectiveServiceStatus(identity, 'food', existing).status === 'approved';

    if (foodApproved && !foodRejected) {
      return existing;
    }

    if (foodRejected || existing.status === 'rejected') {
      const historyEntry = {
        submittedAt: existing.updatedAt || existing.createdAt || new Date(),
        resubmittedAt: new Date(),
        previousStatus: existing.status,
        previousRejectionReason: existing.rejectionReason || '',
        status: 'pending',
      };
      existing.set({
        ...fields,
        rejectionReason: foodRejected ? '' : existing.rejectionReason,
        rejectedAt: foodRejected ? undefined : existing.rejectedAt,
        approvedAt: foodApproved ? existing.approvedAt : undefined,
        status: foodApproved ? existing.status : 'pending',
      });
      existing.submissionHistory = Array.isArray(existing.submissionHistory)
        ? existing.submissionHistory
        : [];
      existing.submissionHistory.push(historyEntry);
      existing.markModified('submissionHistory');
      await existing.save();
      return existing;
    }

    existing.set(fields);
    await existing.save();
    return existing;
  }

  return FoodDeliveryPartner.create({
    ...fields,
    status: 'pending',
    isVerified: false,
    submissionHistory: [{ submittedAt: new Date(), status: 'pending' }],
  });
};

/**
 * Lets an already-onboarded driver (re)enable a capability. No KYC re-entry —
 * the identity already has it.
 */
export const enableCapability = async (identity, service) => {
  if (!identity.onboardingComplete) {
    throw new ValidationError('Complete onboarding before enabling a capability');
  }
  const svc = String(service || '').toLowerCase();
  if (!VALID_SERVICES.includes(svc)) {
    throw new ValidationError(`service must be one of: ${VALID_SERVICES.join(', ')}`);
  }
  if (svc === 'food') {
    await assertCreatableProfiles(identity, [svc]);
    const partner = await ensureFoodPartner(identity);
    setServiceStatusOnIdentity(identity, svc, {
      status: 'pending',
      rejectionReason: '',
      rejectedAt: null,
      approvedAt: null,
    });
    if (!identity.onboardingServices.includes(svc)) {
      identity.onboardingServices.push(svc);
      identity.markModified('onboardingServices');
    }
    await identity.save();
    return { service: svc, status: partner.status || 'pending' };
  }
  throw new ValidationError(`service must be one of: ${VALID_SERVICES.join(', ')}`);
};

export const getOnboardingState = async (identity) => {
  if (!identity) throw new NotFoundError('Identity not found');

  const { partner } = await findPartnerProfiles(identity);
  const capabilities = summarisePartnerCapabilities(identity, partner);
  const foodStatus = getEffectiveServiceStatus(identity, 'food', partner);
  const foodRejected = foodStatus.status === 'rejected';
  const resubmitAllowed = foodRejected;
  const onboardingLocked = Boolean(identity.onboardingComplete) && !resubmitAllowed;

  return {
    // Identity essentials — useful for the unified driver profile page that
    // renders this state directly (phone/joined date/active service).
    identityId: String(identity._id),
    phone: identity.phone,
    countryCode: identity.countryCode || '+91',
    name: identity.name || '',
    activeService: identity.activeService || 'off',
    isVerified: Boolean(identity.isVerified),
    isActive: identity.isActive !== false,
    lastLoginAt: identity.lastLoginAt || null,
    createdAt: identity.createdAt || null,
    updatedAt: identity.updatedAt || null,

    onboardingComplete: identity.onboardingComplete,
    onboardingLocked,
    resubmitAllowed,
    onboardingStep: normalizeOnboardingStepForClient(identity.onboardingStep, identity),
    onboardingServices: getSelectedServices(identity),
    capabilities,
    serviceStatuses: {
      food: foodStatus,
    },
    rejectedServices: [
      foodRejected ? 'food' : null,
    ].filter(Boolean),
    rejection: {
      food: foodRejected
        ? {
            reason: foodStatus.rejectionReason || '',
            rejectedAt: foodStatus.rejectedAt || null,
            partnerId: partner?._id ? String(partner._id) : null,
          }
        : null,
    },
    basics: {
      name: identity.name,
      email: identity.email,
      gender: identity.gender,
      city: identity.city,
      state: identity.state,
      profileImage: identity.profileImage,
    },
    kyc: identity.kyc || {},
    bank: identity.bank || {},
    vehicle: identity.vehicle || {},
    foodVehicle: identity.foodVehicle || {},
    selfieUrl: identity.onboardingSelfieUrl || '',
  };
};
