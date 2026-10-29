import ms from 'ms';
import mongoose from 'mongoose';

import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { ValidationError, AuthError } from '../auth/errors.js';
import { signAccessToken, signRefreshToken } from '../auth/token.util.js';
import { FoodRefreshToken } from '../refreshTokens/refreshToken.model.js';
import { createOrUpdateOtp, verifyOtp, consumeOtp } from '../otp/otp.service.js';

import { BuddyIdentity } from './buddyIdentity.model.js';
import { normalizeOnboardingStepForClient } from './driverOnboarding.service.js';
import { normalizePhone, normalizeRoleKey } from './identity.helpers.js';

import { FoodUser } from '../users/user.model.js';
import { FoodDeliveryPartner } from '../../modules/food/delivery/models/deliveryPartner.model.js';

const ROLE_USER = 'USER';
const ROLE_DRIVER = 'DRIVER';
// How long a retried verify-otp call (client timeout, double-tap) is still allowed to succeed
// after the first call already consumed the OTP and logged the phone in. See verifyOtpUnified.
const RECENT_LOGIN_GRACE_MS = 60 * 1000;

const buildTokenPayload = (identity, role, ids) => ({
  identityId: String(identity._id),
  role,
  userId: String(ids?.userId || identity._id),
  sub: String(ids?.sub || ids?.userId || identity._id),
  capabilities: ids?.capabilities || {},
});

const issueTokens = async (payload) => {
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  const ttlMs = ms(config.jwtRefreshExpiresIn || '7d');
  const expiresAt = new Date(Date.now() + ttlMs);
  await FoodRefreshToken.create({
    userId: payload.userId,
    token: refreshToken,
    expiresAt,
  });
  return { accessToken, refreshToken };
};

const ensureFoodUserForIdentity = async (identity, { name } = {}) => {
  const findExisting = async () =>
    (await FoodUser.findOne({ identityId: identity._id })) ||
    (await FoodUser.findOne({ phone: identity.phone }));

  const existing = await findExisting();
  if (existing) {
    let dirty = false;
    if (!existing.identityId) {
      existing.identityId = identity._id;
      dirty = true;
    }
    if (name && !existing.name) {
      existing.name = name;
      dirty = true;
    }
    if (dirty) {
      try {
        await existing.save();
      } catch (_) {
        // Non-fatal — identity link can be repaired later.
      }
    }
    return existing;
  }

  try {
    return await FoodUser.create({
      identityId: identity._id,
      phone: identity.phone,
      countryCode: identity.countryCode || '+91',
      name: name || identity.name || '',
      ...(identity.email ? { email: identity.email } : {}),
      isVerified: true,
    });
  } catch (err) {
    if (err?.code === 11000) {
      const raced = await findExisting();
      if (raced) return raced;
    }
    throw err;
  }
};

const findFoodPartnerForIdentity = async (identity) => {
  return (
    (await FoodDeliveryPartner.findOne({ identityId: identity._id })) ||
    (await FoodDeliveryPartner.findOne({ phone: identity.phone }))
  );
};

const pushFcmToken = (identity, fcmToken, platform) => {
  if (!fcmToken) return false;
  let modified = false;
  if (platform === 'mobile') {
    identity.fcmTokenMobile = identity.fcmTokenMobile || [];
    if (!identity.fcmTokenMobile.includes(fcmToken)) {
      identity.fcmTokenMobile.push(fcmToken);
      modified = true;
    }
  } else {
    identity.fcmTokens = identity.fcmTokens || [];
    if (!identity.fcmTokens.includes(fcmToken)) {
      identity.fcmTokens.push(fcmToken);
      modified = true;
    }
  }
  return modified;
};

const sanitizeIdentityForResponse = (identity) => ({
  id: String(identity._id),
  identityId: String(identity._id),
  phone: identity.phone,
  countryCode: identity.countryCode || '+91',
  name: identity.name || '',
  email: identity.email || '',
  profileImage: identity.profileImage || '',
  roles: Array.isArray(identity.roles) ? identity.roles : [],
  isVerified: Boolean(identity.isVerified),
  isActive: identity.isActive !== false,
  onboardingComplete: Boolean(identity.onboardingComplete),
  onboardingStep: normalizeOnboardingStepForClient(identity.onboardingStep || 'services', identity),
  activeService:
    !identity.activeService || identity.activeService === 'none' ? 'off' : identity.activeService,
});

const summariseCapabilities = (partner) => ({
  food: partner ? partner.status || 'approved' : 'not_enabled',
});

const upsertIdentity = async (phoneLast10, role, name) => {
  const identity = await BuddyIdentity.findOneAndUpdate(
    { phone: phoneLast10 },
    {
      $setOnInsert: {
        phone: phoneLast10,
        countryCode: '+91',
        isVerified: true,
        name: name || '',
      },
      $addToSet: { roles: role },
      $set: { lastLoginAt: new Date() },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  if (name && !identity.name) {
    identity.name = String(name).trim();
    await identity.save();
  }
  return identity;
};

export const requestOtpUnified = async ({ phone, role }) => {
  if (!phone) throw new ValidationError('Phone is required');
  const phoneLast10 = normalizePhone(phone);
  if (!phoneLast10 || phoneLast10.length !== 10) {
    throw new ValidationError('A valid 10-digit phone number is required');
  }

  const normalizedRole = normalizeRoleKey(role);

  if (normalizedRole === ROLE_USER) {
    const user = await FoodUser.findOne({
      $or: [
        { phone: phoneLast10 },
        { phone: { $regex: new RegExp(phoneLast10 + '$') } }
      ]
    });
    if (user && user.isActive === false) {
      throw new AuthError('Your account has been deactivated. Please contact support.');
    }
  }

  const otp = await createOrUpdateOtp(phoneLast10);
  logger.info(`[unified-auth] OTP requested for ${phoneLast10} (role=${normalizedRole})`);

  const shouldExposeOtp = config.nodeEnv !== 'production' || config.useDefaultOtp;
  return {
    phone: phoneLast10,
    role: normalizedRole,
    ...(shouldExposeOtp ? { otp } : {}),
  };
};

export const verifyOtpUnified = async ({
  phone,
  role,
  otp,
  name,
  fcmToken,
  platform,
}) => {
  const phoneLast10 = normalizePhone(phone);
  if (!phoneLast10 || phoneLast10.length !== 10) {
    throw new ValidationError('A valid 10-digit phone number is required');
  }
  const normalizedRole = normalizeRoleKey(role);
  const trimmedName = typeof name === 'string' ? name.trim() : '';

  const preIdentity = await BuddyIdentity.findOne({ phone: phoneLast10 });
  const isNewIdentity = !preIdentity;
  const needsName =
    normalizedRole === ROLE_USER &&
    !trimmedName &&
    (isNewIdentity || !String(preIdentity?.name || '').trim());

  if (needsName) {
    throw new ValidationError('Name is required for first-time signup');
  }

  const otpResult = await verifyOtp(phoneLast10, otp, { consume: false });
  if (!otpResult.valid) {
    // A retried/duplicate verify call (client timeout, double-tap) arrives after the first call
    // already succeeded and consumed the OTP — this record is correctly gone, but the login did
    // not actually fail. Treat it as a repeat of that recent success rather than a hard error,
    // instead of leaving the app stuck on a confusing "OTP not found" after it already logged in.
    if (otpResult.reason === 'OTP not found') {
      const recentIdentity = await BuddyIdentity.findOne({ phone: phoneLast10 });
      const loggedInRecently =
        recentIdentity?.lastLoginAt &&
        Date.now() - new Date(recentIdentity.lastLoginAt).getTime() < RECENT_LOGIN_GRACE_MS;
      if (!loggedInRecently) {
        throw new AuthError(otpResult.reason || 'OTP verification failed');
      }
      logger.info(`[unified-auth] Re-verify after recent success for ${phoneLast10} (role=${normalizedRole}) — reissuing tokens`);
    } else {
      throw new AuthError(otpResult.reason || 'OTP verification failed');
    }
  }

  const identity = await upsertIdentity(phoneLast10, normalizedRole, trimmedName);
  if (identity.isActive === false) {
    throw new AuthError('Your account has been deactivated. Please contact support.');
  }

  if (pushFcmToken(identity, fcmToken, platform)) {
    await identity.save();
  }

  if (normalizedRole === ROLE_USER) {
    const existingFoodUser = await FoodUser.findOne({
      $or: [
        { phone: phoneLast10 },
        { phone: { $regex: new RegExp(phoneLast10 + '$') } }
      ]
    });
    if (existingFoodUser && existingFoodUser.isActive === false) {
      throw new AuthError('Your account has been deactivated. Please contact support.');
    }

    const foodUser = await ensureFoodUserForIdentity(identity, { name: trimmedName });

    await BuddyIdentity.updateOne(
      { _id: identity._id },
      {
        $set: {
          'identityRefs.foodUserId': foodUser._id,
        },
      },
    );

    const tokenPayload = buildTokenPayload(identity, ROLE_USER, {
      userId: foodUser._id,
      sub: foodUser._id,
      capabilities: { food: 'enabled' },
    });
    const { accessToken, refreshToken } = await issueTokens(tokenPayload);

    await consumeOtp(phoneLast10);
    return {
      accessToken,
      refreshToken,
      token: accessToken,
      role: ROLE_USER,
      identity: sanitizeIdentityForResponse(identity),
      capabilities: { food: 'enabled' },
      services: ['food'],
      isNewUser: isNewIdentity,
      needsOnboarding: false,
      user: {
        id: String(foodUser._id),
        _id: String(foodUser._id),
        phone: identity.phone,
        name: identity.name || trimmedName || '',
        email: identity.email || '',
        role: 'USER',
      },
    };
  }

  if (normalizedRole === ROLE_DRIVER) {
    const partner = await findFoodPartnerForIdentity(identity);

    if (!identity.onboardingComplete) {
      const tokenPayload = buildTokenPayload(identity, ROLE_DRIVER, {
        userId: identity._id,
        sub: identity._id,
        capabilities: { food: 'not_enabled' },
      });
      const { accessToken, refreshToken } = await issueTokens(tokenPayload);
      await consumeOtp(phoneLast10);
      return {
        accessToken,
        refreshToken,
        token: accessToken,
        role: ROLE_DRIVER,
        identity: sanitizeIdentityForResponse(identity),
        capabilities: { food: 'not_enabled' },
        services: [],
        isNewUser: isNewIdentity,
        needsOnboarding: true,
        onboardingStep: normalizeOnboardingStepForClient(identity.onboardingStep || 'services', identity),
      };
    }

    const tokenPayload = buildTokenPayload(identity, ROLE_DRIVER, {
      userId: partner?._id || identity._id,
      sub: partner?._id || identity._id,
      capabilities: summariseCapabilities(partner),
    });
    const { accessToken, refreshToken } = await issueTokens(tokenPayload);

    await BuddyIdentity.updateOne(
      { _id: identity._id },
      {
        $set: {
          'identityRefs.foodPartnerId': partner?._id || null,
        },
      },
    );

    const services = partner ? ['food'] : [];

    await consumeOtp(phoneLast10);
    return {
      accessToken,
      refreshToken,
      token: accessToken,
      role: ROLE_DRIVER,
      identity: sanitizeIdentityForResponse(identity),
      capabilities: summariseCapabilities(partner),
      services,
      isNewUser: isNewIdentity,
      needsOnboarding: false,
      activeService:
        !identity.activeService || identity.activeService === 'none'
          ? 'off'
          : identity.activeService,
    };
  }

  throw new ValidationError('Unsupported role');
};

export const getIdentityById = async (id) => {
  if (!id || !mongoose.Types.ObjectId.isValid(String(id))) return null;
  return BuddyIdentity.findById(id);
};
