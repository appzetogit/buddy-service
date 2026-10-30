import mongoose from 'mongoose';
import { env } from '../../shared/env.js';
import { ApiError } from '../../../../utils/ApiError.js';
import { SetPrice } from '../../admin/models/SetPrice.js';
import { Vehicle } from '../../admin/models/Vehicle.js';
import { Driver } from '../models/Driver.js';
import { WalletTransaction } from '../models/WalletTransaction.js';
import { Ride } from '../../user/models/Ride.js';
import { getWalletSettings } from '../../services/appSettingsService.js';

/**
 * Which classes of vehicle a driver drives, from the catalog rather than the
 * free-text vehicleType on their record.
 */
const getDriverVehicleClasses = async (driver) => {
  const ids = [driver.vehicleTypeId, ...(driver.vehicleTypeIds || [])]
    .map((id) => String(id || '').trim())
    .filter((id) => /^[a-f\d]{24}$/i.test(id));

  if (ids.length === 0) return [String(driver.vehicleType || '').trim().toLowerCase()].filter(Boolean);

  const vehicles = await Vehicle.find({ _id: { $in: ids } }, { category: 1, name: 1 }).lean();
  const classes = vehicles.map((vehicle) => String(vehicle.category || '').trim().toLowerCase()).filter(Boolean);

  return [...new Set(classes)];
};

const normalizeAmount = (value, fieldName = 'amount') => {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    throw new ApiError(400, `${fieldName} must be a valid number`);
  }

  return Math.round(amount * 100) / 100;
};

const normalizePaymentMethod = (value) => (
  String(value || '').trim().toLowerCase() === 'cash' ? 'cash' : 'online'
);

const normalizeCommissionType = (value) => {
  const numericValue = Number(value);
  return numericValue === 1 ? 'percentage' : 'fixed';
};

const computeCommissionAmount = ({ fare, type, value }) => {
  const safeFare = normalizeAmount(fare, 'fare');
  const safeValue = Math.max(normalizeAmount(value || 0, 'commission'), 0);

  if (normalizeCommissionType(type) === 'percentage') {
    return Math.min(Math.round((safeFare * safeValue)) / 100, safeFare);
  }

  return Math.min(safeValue, safeFare);
};

const resolveCommissionConfigForRide = async (ride, session) => {
  if (ride?.pricingSnapshot?.admin_commission_from_driver !== undefined) {
    return {
      source: ride.pricingSnapshot?.setPriceId ? 'ride_snapshot' : 'ride_snapshot_fallback',
      type: Number(ride.pricingSnapshot?.admin_commission_type_from_driver ?? 1),
      value: Number(ride.pricingSnapshot?.admin_commission_from_driver ?? 0),
    };
  }

  if (ride?.vehicleTypeId) {
    const normalizedServiceType = String(ride?.serviceType || '').trim().toLowerCase();
    const savedTransportType = String(ride.transport_type || '').trim().toLowerCase();
    const normalizedTransportType =
      normalizedServiceType === 'parcel'
        ? (savedTransportType === 'delivery' || savedTransportType === 'both' ? savedTransportType : 'delivery')
        : (savedTransportType || 'taxi');
    const filters = [
      {
        vehicle_type: ride.vehicleTypeId,
        active: 1,
        status: 'active',
        ...(ride.service_location_id ? { service_location_id: ride.service_location_id } : {}),
        transport_type: normalizedTransportType,
      },
      {
        vehicle_type: ride.vehicleTypeId,
        active: 1,
        status: 'active',
        ...(ride.service_location_id ? { service_location_id: ride.service_location_id } : {}),
        transport_type: 'both',
      },
      {
        vehicle_type: ride.vehicleTypeId,
        active: 1,
        status: 'active',
        transport_type: normalizedTransportType,
      },
      {
        vehicle_type: ride.vehicleTypeId,
        active: 1,
        status: 'active',
        transport_type: 'both',
      },
    ];

    for (const filter of filters) {
      const setPrice = await SetPrice.findOne(filter).sort({ updatedAt: -1, createdAt: -1 }).session(session).lean();
      if (setPrice) {
        return {
          source: 'set_price_lookup',
          type: Number(setPrice.admin_commission_type_from_driver ?? 1),
          value: Number(setPrice.admin_commission_from_driver ?? 0),
          setPriceId: setPrice._id,
        };
      }
    }

    if (normalizedServiceType === 'parcel') {
      const vehicle = await Vehicle.findById(ride.vehicleTypeId)
        .select('admin_commission_type_from_driver admin_commission_from_driver')
        .session(session)
        .lean();

      if (vehicle) {
        return {
          source: 'vehicle_type_parcel_fallback',
          type: Number(vehicle.admin_commission_type_from_driver ?? 1),
          value: Number(vehicle.admin_commission_from_driver ?? 0),
        };
      }
    }
  }

  return {
    source: 'env_fallback',
    type: 1,
    value: Number(env.driverWallet.commissionPercent || 0),
  };
};

const toNonNegativeNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : fallback;
};

const isEnabledSetting = (value, fallback = true) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const resolveWalletRules = async () => {
  const walletSettings = await getWalletSettings();
  const configuredMinimumBalance = Number(walletSettings.driver_wallet_minimum_amount_to_get_an_order);
  const minimumBalanceForOrders = Number.isFinite(configuredMinimumBalance)
    ? Math.round(configuredMinimumBalance * 100) / 100
    : -toNonNegativeNumber(env.driverWallet.defaultCashLimit, 500);

  return {
    minimumBalanceForOrders,
    cashLimit: Math.abs(Math.min(minimumBalanceForOrders, 0)),
    minimumTopUpAmount: toNonNegativeNumber(walletSettings.minimum_amount_added_to_wallet, 0),
    minimumTransferAmount: toNonNegativeNumber(walletSettings.minimum_wallet_amount_for_transfer, 0),
    isWalletEnabled: isEnabledSetting(walletSettings.show_wallet_feature_for_driver, true),
    isTransferEnabled: isEnabledSetting(walletSettings.enable_wallet_transfer_driver, true),
  };
};

const getWalletSnapshot = async (driver) => {
  const rules = await resolveWalletRules();
  const balance = Number(driver?.wallet?.balance || 0);

  return {
    balance,
    cashLimit: rules.cashLimit,
    minimumBalanceForOrders: rules.minimumBalanceForOrders,
    availableForOrders: Math.round((balance - rules.minimumBalanceForOrders) * 100) / 100,
    isBlocked: Boolean(driver?.wallet?.isBlocked),
    rules,
  };
};

export const serializeDriverWallet = async (driver) => {
  const wallet = await getWalletSnapshot(driver);
  const isBelowMinimumBalance = wallet.balance < wallet.minimumBalanceForOrders;
  return {
    balance: wallet.balance,
    cashLimit: wallet.cashLimit,
    minimumBalanceForOrders: wallet.minimumBalanceForOrders,
    availableForOrders: wallet.availableForOrders,
    isWalletEnabled: wallet.rules.isWalletEnabled,
    isTransferEnabled: wallet.rules.isTransferEnabled,
    minimumTopUpAmount: wallet.rules.minimumTopUpAmount,
    minimumTransferAmount: wallet.rules.minimumTransferAmount,
    isBlocked: !wallet.rules.isWalletEnabled || (wallet.isBlocked || isBelowMinimumBalance),
  };
};

/**
 * Taxi has no wallet minimum of its own: the riders are the platform's delivery partners, whose
 * money (earnings, cash in hand, the cash limit) is governed by the delivery wallet, so a ride
 * is never refused on a balance here.
 */
export const ensureDriverWalletCanAcceptRide = async () => null;

export const applyDriverWalletAdjustment = async ({
  driverId,
  amount,
  type,
  rideId = null,
  description = '',
  metadata = {},
  session = null,
}) => {
  const normalizedAmount = normalizeAmount(amount);

  if (!normalizedAmount) {
    throw new ApiError(400, 'Wallet adjustment amount cannot be zero');
  }

  const driver = await Driver.findById(driverId).session(session);

  if (!driver) {
    throw new ApiError(404, 'Driver not found');
  }

  const before = await getWalletSnapshot(driver);
  const balanceAfter = Math.round((before.balance + normalizedAmount) * 100) / 100;
  const isBlockedAfter =
    !before.rules.isWalletEnabled || balanceAfter < before.minimumBalanceForOrders;

  const updatedDriver = await Driver.findByIdAndUpdate(
    driverId,
    {
      $inc: { 'wallet.balance': normalizedAmount },
      $set: {
        'wallet.cashLimit': before.cashLimit,
        'wallet.isBlocked': isBlockedAfter,
      },
    },
    { returnDocument: 'after', session },
  );

  const [transaction] = await WalletTransaction.create(
    [
      {
        driverId,
        rideId,
        type,
        amount: normalizedAmount,
        balanceBefore: before.balance,
        balanceAfter,
        cashLimit: before.cashLimit,
        isBlockedAfter,
        description,
        metadata,
      },
    ],
    { session },
  );

  return {
    driver: updatedDriver,
    wallet: await serializeDriverWallet(updatedDriver),
    transaction,
  };
};

/**
 * One-time joining bonus, credited when a driver is first approved.
 *
 * Claims the grant before paying it: the updateOne only matches while
 * joiningBonusGrantedAt is still null, so whichever call wins the race is the
 * only one that credits. Approving twice, un-approving and re-approving, or two
 * admins clicking at the same moment across our four instances all pay once.
 *
 * Returns null when there was nothing to do, so callers can stay quiet.
 */
// Fixed on purpose, not an admin setting. A driver on several classes gets the
// richest of them; anything unrecognised falls back to DRIVER_JOINING_BONUS.
const JOINING_BONUS_BY_CLASS = { bike: 100, auto: 100, car: 150 };

const resolveJoiningBonus = async (driverId) => {
  const driver = await Driver.findById(driverId).lean();
  const classes = driver ? await getDriverVehicleClasses(driver) : [];
  const amounts = classes
    .map((vehicleClass) => JOINING_BONUS_BY_CLASS[vehicleClass])
    .filter((value) => Number.isFinite(value));

  if (amounts.length > 0) {
    return { amount: Math.max(...amounts), classes };
  }

  return { amount: normalizeAmount(env.driverWallet.joiningBonus), classes };
};

export const grantDriverJoiningBonus = async ({ driverId, grantedBy = null }) => {
  const { amount: bonusAmount, classes: bonusClasses } = await resolveJoiningBonus(driverId);
  const amount = normalizeAmount(bonusAmount);

  if (!amount || amount <= 0) {
    return null;
  }

  const claim = await Driver.updateOne(
    { _id: driverId, joiningBonusGrantedAt: null },
    { $set: { joiningBonusGrantedAt: new Date() } },
  );

  if (!claim.modifiedCount) {
    return null;
  }

  try {
    return await applyDriverWalletAdjustment({
      driverId,
      amount,
      type: 'adjustment',
      description: 'Joining bonus on approval',
      metadata: { reason: 'driver_joining_bonus', grantedBy, vehicleClasses: bonusClasses },
    });
  } catch (error) {
    // Release the claim so a retry can still pay them. Leaving it set would mark
    // the bonus as given when no money ever moved.
    await Driver.updateOne({ _id: driverId }, { $set: { joiningBonusGrantedAt: null } }).catch(() => null);
    throw error;
  }
};

export const topUpDriverWallet = async ({ driverId, amount, metadata = {} }) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const walletSettings = await getWalletSettings();
    if (!isEnabledSetting(walletSettings.show_wallet_feature_for_driver, true)) {
      throw new ApiError(403, 'Driver wallet is disabled by admin');
    }

    const minimumTopUpAmount = toNonNegativeNumber(walletSettings.minimum_amount_added_to_wallet, 0);
    const normalizedTopUpAmount = Math.abs(normalizeAmount(amount));

    if (minimumTopUpAmount > 0 && normalizedTopUpAmount < minimumTopUpAmount) {
      throw new ApiError(400, `amount must be at least ${minimumTopUpAmount}`);
    }

    const result = await applyDriverWalletAdjustment({
      driverId,
      amount: normalizedTopUpAmount,
      type: 'top_up',
      description: 'Driver wallet top-up',
      metadata: {
        ...metadata,
        minimumTopUpAmount,
      },
      session,
    });

    await session.commitTransaction();
    return result;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * What the rider will earn on a ride, before it is settled: fare minus the admin's commission and
 * the rider platform fee. Settlement computes the same figure and stores it on the ride.
 */
export const estimateRideDriverEarnings = async (ride) => {
  const fare = Math.max(0, Number(ride?.fare) || 0);
  if (!fare) return { commission: 0, earnings: 0 };
  try {
    const config = await resolveCommissionConfigForRide(ride, null);
    const commission = computeCommissionAmount({ fare, type: config.type, value: config.value });
    const platformFee = Math.min(Math.max(0, Number(ride?.pricingSnapshot?.rider_platform_fee) || 0), fare);
    const total = Math.min(Math.round((commission + platformFee) * 100) / 100, fare);
    return { commission: total, earnings: Math.max(Math.round((fare - total) * 100) / 100, 0) };
  } catch {
    return { commission: 0, earnings: fare };
  }
};

export const settleCompletedRideWallet = async ({ rideId }) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const ride = await Ride.findOneAndUpdate(
      { _id: rideId, walletSettledAt: null, driverId: { $ne: null } },
      { $set: { walletSettledAt: new Date() } },
      { returnDocument: 'after', session },
    );

    if (!ride) {
      await session.commitTransaction();
      return null;
    }

    const fare = normalizeAmount(ride.fare || 0, 'fare');
    const commissionConfig = await resolveCommissionConfigForRide(ride, session);
    const tripCommission = computeCommissionAmount({
      fare,
      type: commissionConfig.type,
      value: commissionConfig.value,
    });
    // The rider's per-ride platform fee was collected inside the fare but was
    // never the driver's money: it goes to admin with the commission. Zero on
    // every ride booked by an app that doesn't charge one, so those settle
    // exactly as before. Read here, before the snapshot is replaced below.
    const platformFee = Math.min(Math.max(0, Number(ride.pricingSnapshot?.rider_platform_fee) || 0), fare);

    const commissionAmount = Math.min(Math.round((tripCommission + platformFee) * 100) / 100, fare);
    const paymentMethod = normalizePaymentMethod(ride.paymentMethod);
    const driverEarnings = Math.max(Math.round((fare - commissionAmount) * 100) / 100, 0);
    const amount = paymentMethod === 'cash' ? -commissionAmount : driverEarnings;
    const type = paymentMethod === 'cash' ? 'commission_deduction' : 'ride_earning';

    ride.paymentMethod = paymentMethod;
    ride.commissionAmount = commissionAmount;
    ride.driverEarnings = driverEarnings;
    ride.pricingSnapshot = {
      setPriceId: ride.pricingSnapshot?.setPriceId || commissionConfig.setPriceId || null,
      admin_commission_type_from_driver: Number(commissionConfig.type ?? ride.pricingSnapshot?.admin_commission_type_from_driver ?? 1),
      admin_commission_from_driver: Number(commissionConfig.value ?? ride.pricingSnapshot?.admin_commission_from_driver ?? 0),
      rider_platform_fee: platformFee,
      resolvedAt: ride.pricingSnapshot?.resolvedAt || new Date(),
    };
    await ride.save({ session });

    let walletResult = null;
    if (amount) {
      walletResult = await applyDriverWalletAdjustment({
        driverId: ride.driverId,
        amount,
        type,
        rideId: ride._id,
        description: paymentMethod === 'cash'
          ? `Admin commission for trip #${String(ride._id).slice(-8).toUpperCase()}`
          : `Earnings for trip #${String(ride._id).slice(-8).toUpperCase()}`,
        session,
      });
    }

    await session.commitTransaction();
    return { ride, wallet: walletResult?.wallet || null, transaction: walletResult?.transaction || null };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};
