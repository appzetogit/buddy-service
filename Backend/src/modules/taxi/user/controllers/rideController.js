import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { normalizePoint } from '../../../../utils/geo.js';
import { resolveConfiguredGatewayCredentials } from '../../services/paymentGatewayService.js';
import { Driver } from '../../driver/models/Driver.js';
import { WalletTransaction } from '../../driver/models/WalletTransaction.js';
import { applyDriverWalletAdjustment, serializeDriverWallet } from '../../driver/services/walletService.js';
import { RIDE_LIVE_STATUS, RIDE_STATUS } from '../../constants/index.js';
import {
  acceptRideBidAssignment,
  createRideRecord,
  ensureRideParticipantAccess,
  getAllowedRidePaymentMethodsForPricing,
  getActiveRideForIdentity,
  getRideDetails,
  getRideRoom,
  increaseRideBidCeiling,
  listRideBidsForUser,
  listRideHistoryForIdentity,
  serializeRideRealtime,
  saveParcelProof,
  submitRideFeedback,
  updateRideLifecycle,
} from '../../services/rideService.js';
import {
  applyUserWalletAdjustment,
  cancelRideByUser,
  emitToDriver,
  getSocketServer,
  notifyRideAccepted,
  notifyRideBiddingUpdated,
  restartRideDispatchWithLatestFare,
  startDispatchFlow,
  announceScheduledRide,
} from '../../services/dispatchService.js';
import { getTipSettings } from '../../services/appSettingsService.js';
import { getBidRideSettings, getTransportRideSettings } from '../../services/transportSettingsService.js';
import { matchDrivers } from '../../services/matchingService.js';
import { Ride } from '../models/Ride.js';
import { UserWallet } from '../models/UserWallet.js';
import { User } from '../models/User.js';
import { CodCheckout } from '../models/CodCheckout.js';
import { createDeliveryRecord, getDeliveryQuote as quoteDelivery } from '../services/deliveryService.js';
import { assertCodAllowed } from '../../../common/cod/cod.service.js';
import { hasCod, rideAmountDue } from '../../services/codAdvance.js';

const EARTH_RADIUS_METERS = 6371000;
const AVERAGE_CITY_SPEED_KMPH = 24;
const PAYMENT_PAID_STATUSES = new Set(['paid', 'captured', 'completed']);

const toRadians = (value) => (Number(value) * Math.PI) / 180;

const calculateDistanceMeters = (fromCoords = [], toCoords = []) => {
  const [fromLng, fromLat] = fromCoords;
  const [toLng, toLat] = toCoords;

  if (![fromLng, fromLat, toLng, toLat].every((value) => Number.isFinite(Number(value)))) {
    return null;
  }

  const latDelta = toRadians(toLat - fromLat);
  const lngDelta = toRadians(toLng - fromLng);
  const startLat = toRadians(fromLat);
  const endLat = toRadians(toLat);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(lngDelta / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(EARTH_RADIUS_METERS * c);
};

const estimateEtaMinutes = (distanceMeters) => {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return 1;
  }

  const metersPerMinute = (AVERAGE_CITY_SPEED_KMPH * 1000) / 60;
  return Math.max(1, Math.round(distanceMeters / metersPerMinute));
};

const normalizeMoneyAmount = (value, fieldName = 'amount') => {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, `${fieldName} must be greater than zero`);
  }

  return Math.round(amount * 100) / 100;
};

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

const ensureUserWallet = async (userId, session = null) => {
  if (!userId) return;
  await UserWallet.updateOne(
    { userId },
    { $setOnInsert: { userId, balance: 0, refundWallet: 0, transactions: [] } },
    { upsert: true, ...(session ? { session } : {}) },
  );
};

const isDriverCollectionPaid = (ride = {}) =>
  Boolean(ride?.driverPaymentCollection?.paidAt) ||
  PAYMENT_PAID_STATUSES.has(String(ride?.driverPaymentCollection?.status || '').trim().toLowerCase());

const buildCompletionAmounts = (ride, tipAmount = 0) => {
  // COD with an advance: only the rest of the fare is still owed.
  const fare = hasCod(ride) ? rideAmountDue(ride) : roundMoney(ride?.fare || 0);
  const normalizedTipAmount = roundMoney(tipAmount || 0);
  const fareDue = isDriverCollectionPaid(ride) ? 0 : fare;
  return {
    fare,
    fareDue,
    tipAmount: normalizedTipAmount,
    totalCharge: roundMoney(fareDue + normalizedTipAmount),
  };
};

const validateRideCompletionFeedback = async ({ rating, tipAmount }) => {
  const numericRating = Number(rating);
  const numericTip = roundMoney(tipAmount || 0);

  if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
    throw new ApiError(400, 'rating must be an integer between 1 and 5');
  }

  if (!Number.isFinite(numericTip) || numericTip < 0) {
    throw new ApiError(400, 'tipAmount must be zero or greater');
  }

  const tipSettings = await getTipSettings();
  const tipsEnabled = String(tipSettings.enable_tips || '1') === '1';
  const minimumTipAmount = Number(tipSettings.min_tip_amount || 0);

  if (!tipsEnabled && numericTip > 0) {
    throw new ApiError(400, 'Tips are currently disabled');
  }

  if (tipsEnabled && numericTip > 0 && minimumTipAmount > 0 && numericTip < minimumTipAmount) {
    throw new ApiError(400, `tipAmount must be at least ${minimumTipAmount}`);
  }

  return {
    rating: numericRating,
    tipAmount: numericTip,
  };
};

const loadCompletedRideForUser = async (rideId, userId, session = null) => {
  const ride = await Ride.findOne({
    _id: rideId,
    userId,
    status: RIDE_STATUS.COMPLETED,
  }).session(session);

  if (!ride) {
    throw new ApiError(404, 'Completed ride not found');
  }

  if (!ride.driverId) {
    throw new ApiError(409, 'Ride has no assigned driver');
  }

  return ride;
};

const finalizeRideCompletion = async ({
  ride,
  userId,
  rating,
  comment = '',
  tipAmount = 0,
  paymentRecord = null,
  paymentSource = '',
  session = null,
}) => {
  if (ride.feedback?.submittedAt) {
    const samePayment =
      (paymentRecord?.providerPaymentId && String(ride.driverPaymentCollection?.providerPaymentId || '') === paymentRecord.providerPaymentId) ||
      (paymentRecord?.providerPaymentId && String(ride.feedback?.tipPaymentId || '') === paymentRecord.providerPaymentId);

    if (samePayment) {
      return getRideDetails(ride._id);
    }

    throw new ApiError(409, 'Feedback already submitted for this ride');
  }

  const driver = await Driver.findById(ride.driverId).session(session);
  if (!driver) {
    throw new ApiError(404, 'Driver not found');
  }

  const { fare, fareDue, totalCharge } = buildCompletionAmounts(ride, tipAmount);
  const previousPaymentMethod = String(ride.paymentMethod || 'cash').trim().toLowerCase() === 'cash' ? 'cash' : 'online';
  const driverCreditAmount = roundMoney(
    tipAmount + (fareDue > 0 && previousPaymentMethod === 'cash' ? fare : 0),
  );

  let walletResult = null;
  if (driverCreditAmount > 0) {
    walletResult = await applyDriverWalletAdjustment({
      driverId: ride.driverId,
      rideId: ride._id,
      amount: driverCreditAmount,
      type: 'adjustment',
      description: fareDue > 0
        ? 'Ride completion payment credited from rider'
        : 'Ride tip credited from rider',
      metadata: {
        source: paymentSource || 'ride_completion',
        rideId: String(ride._id),
        userId: String(userId),
        farePortion: fareDue > 0 ? fare : 0,
        tipAmount,
        totalCharge,
        provider: paymentRecord?.provider || '',
        providerOrderId: paymentRecord?.providerOrderId || '',
        providerPaymentId: paymentRecord?.providerPaymentId || '',
      },
      session,
    });
  }

  if (fareDue > 0) {
    ride.paymentMethod = 'online';
    ride.driverPaymentCollection = {
      provider: paymentRecord?.provider || ride.driverPaymentCollection?.provider || '',
      providerId: paymentRecord?.providerId || ride.driverPaymentCollection?.providerId || paymentRecord?.providerPaymentId || '',
      providerOrderId: paymentRecord?.providerOrderId || '',
      providerPaymentId: paymentRecord?.providerPaymentId || '',
      providerMode: paymentRecord?.providerMode || ride.driverPaymentCollection?.providerMode || '',
      source: paymentRecord?.source || paymentSource || '',
      status: 'paid',
      amount: totalCharge,
      walletAmount: paymentRecord?.walletAmount || 0,
      onlineAmount: paymentRecord?.onlineAmount || 0,
      currency: paymentRecord?.currency || ride.driverPaymentCollection?.currency || 'INR',
      linkUrl: paymentRecord?.linkUrl || ride.driverPaymentCollection?.linkUrl || '',
      paidAt: paymentRecord?.paidAt || new Date(),
      updatedAt: new Date(),
    };
  } else if (paymentRecord?.providerPaymentId && !isDriverCollectionPaid(ride) && paymentRecord?.provider) {
    ride.driverPaymentCollection = {
      provider: paymentRecord.provider,
      providerId: paymentRecord.providerId || paymentRecord.providerPaymentId || '',
      providerOrderId: paymentRecord.providerOrderId || '',
      providerPaymentId: paymentRecord.providerPaymentId || '',
      providerMode: paymentRecord.providerMode || '',
      source: paymentRecord.source || paymentSource || '',
      status: 'paid',
      amount: totalCharge,
      currency: paymentRecord.currency || 'INR',
      linkUrl: paymentRecord.linkUrl || '',
      paidAt: paymentRecord.paidAt || new Date(),
      updatedAt: new Date(),
    };
  }

  ride.feedback = {
    rating,
    comment: String(comment || '').trim(),
    tipAmount,
    tipPaymentId: paymentRecord?.providerPaymentId || '',
    tipOrderId: paymentRecord?.providerOrderId || '',
    tipPaidAt: paymentRecord?.providerPaymentId ? (paymentRecord?.paidAt || new Date()) : null,
    submittedAt: new Date(),
  };

  driver.ratingCount = Number(driver.ratingCount || 0) + 1;
  driver.totalRatingScore = Number(driver.totalRatingScore || 0) + rating;
  driver.rating = Number((driver.totalRatingScore / driver.ratingCount).toFixed(1));

  await Promise.all([
    ride.save({ session }),
    driver.save({ session }),
  ]);

  return {
    ride: await getRideDetails(ride._id),
    walletResult,
  };
};

/**
 * Split payment (online only): the rider may cover part of an online payment from the Buddy Wallet.
 * Returns the wallet part (0 = no split). The wallet is debited only at verify, after the gateway
 * part is paid, so an abandoned checkout never touches the wallet.
 */
const resolveWalletSplit = async (userId, total, useWallet) => {
  // true = the rider asked for it; false = the rider opted out; not sent = use the wallet part
  // automatically (an app that never sends the flag used to charge the whole fare online while
  // the wallet money sat unused).
  const optedOut = useWallet === false || useWallet === 'false' || useWallet === 0 || useWallet === '0';
  if (optedOut) {
    return 0;
  }
  const asked = useWallet === true || useWallet === 'true' || useWallet === 1 || useWallet === '1';
  await ensureUserWallet(userId);
  const wallet = await UserWallet.findOne({ userId }).select('balance').lean();
  const walletAmount = roundMoney(Math.min(Number(wallet?.balance || 0), total));
  if (walletAmount <= 0) {
    return 0;
  }
  if (roundMoney(total - walletAmount) < 1) {
    // Wallet covers it all: an explicit request must use the wallet-only endpoint; an app that did
    // not ask keeps its normal online payment.
    if (!asked) {
      return 0;
    }
    throw new ApiError(400, 'Your wallet covers this payment. Please pay with wallet.');
  }
  return walletAmount;
};

// The wallet part is carried on the Razorpay order (server-set notes), never trusted from the client.
const walletPartOfOrder = (order) => roundMoney(Number(order?.notes?.walletAmount || 0)) || 0;

/** Debit the wallet part inside the verify transaction. Idempotent per gateway payment id. */
const debitSplitWallet = async ({ userId, walletAmount, onlineAmount, rideId, paymentId, session }) => {
  if (walletAmount <= 0) {
    return;
  }
  const result = await applyUserWalletAdjustment({
    userId,
    amount: walletAmount,
    kind: 'debit',
    title: `Ride payment (wallet part) ${String(rideId).slice(-6)}`,
    referenceKey: `ride-split:${paymentId}`,
    provider: 'ride_split_wallet',
    requireSufficientFunds: true,
    session,
  });
  if (result.status === 'insufficient_funds') {
    const error = new ApiError(409, 'Your wallet balance changed. The online payment was added to your wallet; please pay again.');
    error.refundOnline = onlineAmount;
    throw error;
  }
};

/** The gateway part is already captured but the wallet part failed: keep nothing, return it to the wallet. */
const refundOnlinePartToWallet = async ({ userId, amount, rideId, paymentId }) =>
  applyUserWalletAdjustment({
    userId,
    amount,
    kind: 'credit',
    title: `Refund for ride payment ${String(rideId).slice(-6)}`,
    referenceKey: `ride-split-refund:${paymentId}`,
    provider: 'ride_split_refund',
  });

const resolveRazorpayCredentials = async () => {
  return resolveConfiguredGatewayCredentials('razor_pay');
};

const razorpayRequest = async ({ method, path, body, keyId, keySecret }) => {
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(response.status || 502, payload?.error?.description || payload?.error?.message || 'Razorpay request failed');
  }

  return payload;
};

// The signature only proves the checkout answered; ask Razorpay itself that this payment is on this
// order and really captured (a cancelled / failed / merely authorized payment must never pass).
const assertRazorpayPaymentCaptured = async ({ paymentId, orderId, keyId, keySecret }) => {
  const payment = await razorpayRequest({
    method: 'GET',
    path: `/payments/${encodeURIComponent(paymentId)}`,
    keyId,
    keySecret,
  });
  if (String(payment?.order_id || '') !== String(orderId || '')) {
    throw new ApiError(400, 'Payment does not belong to this order');
  }
  if (payment?.status !== 'captured') {
    throw new ApiError(400, `Payment is not completed (status: ${payment?.status || 'unknown'})`);
  }
};

export const createRide = async (req, res) => {
  const { pickup, drop, pickupAddress, dropAddress, fare, estimatedDistanceMeters, estimatedDurationMinutes, vehicleTypeId, vehicleTypeIds, vehicleIconType, vehicleIconUrl, paymentMethod, serviceType, intercity, promo_code, zone_id, service_location_id, transport_type, scheduledAt, bookingMode, userMaxBidFare, bidStepAmount, platformFee, surgeMultiplier } =
    req.body;

  if (!pickup || !drop) {
    throw new ApiError(400, 'pickup and drop are required');
  }

  // Cash on delivery with an advance has its own booking flow.
  if (String(paymentMethod || '').trim().toLowerCase() === 'cod') {
    return createCodRide(req, res);
  }

  console.log('--- TEMPORARY DEBUG LOG ---');
  console.log('backend received vehicleType (ID):', vehicleTypeId);

  const resolvedVehicleTypeId = vehicleTypeId || (Array.isArray(vehicleTypeIds) ? vehicleTypeIds[0] : null);
  if (!resolvedVehicleTypeId) {
    throw new ApiError(400, 'vehicleTypeId is required');
  }

  const ride = await createRideRecord({
    userId: req.auth.sub,
    pickupCoords: normalizePoint(pickup, 'pickup'),
    dropCoords: normalizePoint(drop, 'drop'),
    pickupAddress,
    dropAddress,
    fare: Number(fare || 0),
    estimatedDistanceMeters: Number(estimatedDistanceMeters || 0),
    estimatedDurationMinutes: Number(estimatedDurationMinutes || 0),
    vehicleTypeId,
    vehicleTypeIds,
    vehicleIconType,
    vehicleIconUrl,
    paymentMethod,
    serviceType,
    intercity,
    promo_code,
    zone_id,
    service_location_id,
    transport_type,
    scheduledAt,
    bookingMode,
    userMaxBidFare,
    bidStepAmount,
    platformFee,
    surgeMultiplier,
  });

  await startDispatchFlow(ride);
  // A ride booked for later: nearby drivers can take it in advance.
  announceScheduledRide(ride).catch((error) => console.error('Scheduled ride announcement failed', error));

  res.status(201).json({
    success: true,
    data: {
      ride,
      realtime: {
        room: getRideRoom(ride._id),
        rideId: String(ride._id),
      },
    },
  });
};

// ---------------------------------------------------------------------------------------------------------------
// Cash on delivery with an advance (see services/codAdvance.js and modules/common/cod/cod.service.js).
//
// The customer books with paymentMethod 'cod'. The server decides whether COD is allowed and what the advance is.
// The ride is created - and drivers are searched for - only once the advance is paid:
//   advance 0                    -> booked straight away
//   wallet covers it (asked)     -> wallet debited, booked straight away
//   otherwise                    -> 201 { requiresPayment: true, checkoutId, razorpay{...} }; the app pays and
//                                   calls POST /rides/cod-advance/verify, which books the ride.
// The advance is refunded to the WALLET if the ride is cancelled (dispatchService.refundCodAdvanceToWallet).
// ---------------------------------------------------------------------------------------------------------------
const COD_ADVANCE_SOURCE = 'ride_cod_advance';
const COD_CHECKOUT_TTL_MS = 30 * 60 * 1000;

/// Creates the ride for a booking request and starts the driver search. Shared by the normal COD paths.
const placeRide = async (userId, body, cod) => {
  const { pickup, drop, pickupAddress, dropAddress, fare, estimatedDistanceMeters, estimatedDurationMinutes, vehicleTypeId, vehicleTypeIds, vehicleIconType, vehicleIconUrl, serviceType, intercity, promo_code, zone_id, service_location_id, transport_type, scheduledAt, bookingMode, userMaxBidFare, bidStepAmount, platformFee, surgeMultiplier } = body;
  const ride = await createRideRecord({
    userId,
    pickupCoords: normalizePoint(pickup, 'pickup'),
    dropCoords: normalizePoint(drop, 'drop'),
    pickupAddress,
    dropAddress,
    fare: Number(fare || 0),
    estimatedDistanceMeters: Number(estimatedDistanceMeters || 0),
    estimatedDurationMinutes: Number(estimatedDurationMinutes || 0),
    vehicleTypeId,
    vehicleTypeIds,
    vehicleIconType,
    vehicleIconUrl,
    paymentMethod: 'cash',
    serviceType,
    intercity,
    promo_code,
    zone_id,
    service_location_id,
    transport_type,
    scheduledAt,
    bookingMode,
    userMaxBidFare,
    bidStepAmount,
    platformFee,
    surgeMultiplier,
    cod,
  });
  await startDispatchFlow(ride);
  announceScheduledRide(ride).catch((error) => console.error('Scheduled ride announcement failed', error));
  return ride;
};

/// A parcel booking with its advance paid. The server prices the parcel itself, same as a normal parcel booking.
const placeDelivery = (userId, body, cod) =>
  createDeliveryRecord({
    userId,
    pickup: body.pickup,
    drop: body.drop,
    pickupAddress: body.pickupAddress,
    dropAddress: body.dropAddress,
    fare: body.fare,
    vehicleTypeId: body.vehicleTypeId,
    vehicleTypeIds: body.vehicleTypeIds,
    vehicleIconType: body.vehicleIconType,
    vehicleIconUrl: body.vehicleIconUrl,
    paymentMethod: 'cash',
    parcel: body.parcel,
    cod,
    scheduledAt: body.scheduledAt,
  });

const sendBookedParcel = (res, delivery) => res.status(201).json({ success: true, data: delivery });

const sendBookedRide = (res, ride) =>
  res.status(201).json({
    success: true,
    data: { ride, realtime: { room: getRideRoom(ride._id), rideId: String(ride._id) } },
  });

const codCreditBack = (userId, amount, ref, title) =>
  applyUserWalletAdjustment({ userId, amount, kind: 'credit', title, referenceKey: ref, provider: 'ride_cod_advance_refund' });

/// Takes the wallet part, books the ride, and undoes the payment if booking fails. Idempotent per checkout.
const finalizeCodBooking = async (checkout, paid = {}) => {
  const userId = String(checkout.userId);
  if (checkout.walletAmount > 0) {
    const debit = await applyUserWalletAdjustment({
      userId,
      amount: checkout.walletAmount,
      kind: 'debit',
      title: `Ride advance (wallet part) ${String(checkout._id).slice(-6)}`,
      referenceKey: `ride-cod-advance:${checkout._id}`,
      provider: 'ride_cod_advance',
      requireSufficientFunds: true,
    });
    if (debit.status === 'insufficient_funds') {
      if (paid.paymentId && checkout.onlineAmount > 0) {
        await codCreditBack(userId, checkout.onlineAmount, `ride-cod-advance-online-back:${paid.paymentId}`, 'Ride advance returned (wallet balance changed)');
      }
      await CodCheckout.updateOne({ _id: checkout._id }, { $set: { status: 'expired' } });
      throw new ApiError(409, 'Your wallet balance changed while paying. Any online payment was added to your wallet; please book again.');
    }
  }
  try {
    const cod = {
      percent: checkout.percent,
      advanceAmount: checkout.advanceAmount,
      advanceWalletAmount: checkout.walletAmount,
      advanceOnlineAmount: checkout.onlineAmount,
      razorpayOrderId: paid.orderId || '',
      razorpayPaymentId: paid.paymentId || '',
    };
    if (checkout.kind === 'delivery') {
      const delivery = await placeDelivery(userId, checkout.payload, cod);
      const stored = JSON.parse(JSON.stringify(delivery));
      // Bookkeeping only: the booking succeeded, so a failure here must not undo the payment.
      await CodCheckout.updateOne({ _id: checkout._id }, { $set: { status: 'completed', response: stored, rideId: delivery?.rideId || delivery?._id || delivery?.id || null } }).catch(() => null);
      return { kind: 'delivery', delivery };
    }
    const ride = await placeRide(userId, checkout.payload, cod);
    await CodCheckout.updateOne({ _id: checkout._id }, { $set: { status: 'completed', rideId: ride._id } }).catch(() => null);
    return { kind: 'ride', ride };
  } catch (error) {
    // The ride could not be booked: give the whole advance back to the wallet.
    await codCreditBack(userId, checkout.advanceAmount, `ride-cod-advance-failed:${checkout._id}`, 'Ride advance returned (booking failed)').catch(() => null);
    await CodCheckout.updateOne({ _id: checkout._id }, { $set: { status: 'expired' } });
    throw error;
  }
};

const sendCodResult = (res, placed) => (placed.kind === 'delivery' ? sendBookedParcel(res, placed.delivery) : sendBookedRide(res, placed.ride));

const createCodRide = async (req, res) => {
  const body = req.body || {};
  if (!body.pickup || !body.drop) {
    throw new ApiError(400, 'pickup and drop are required');
  }
  if (!(body.vehicleTypeId || (Array.isArray(body.vehicleTypeIds) && body.vehicleTypeIds[0]))) {
    throw new ApiError(400, 'vehicleTypeId is required');
  }
  return startCodBooking(req, res, { kind: 'ride', quotedFare: roundMoney(body.fare) });
};

/// Parcel: COD books the same way; the advance is worked out from the server's own parcel price.
export const createCodDelivery = async (req, res) => {
  const body = req.body || {};
  const quote = await quoteDelivery({ vehicleTypeId: body.vehicleTypeId, pickup: body.pickup, drop: body.drop, parcel: body.parcel });
  return startCodBooking(req, res, { kind: 'delivery', quotedFare: roundMoney(quote?.total) });
};

const startCodBooking = async (req, res, { kind, quotedFare }) => {
  const userId = req.auth.sub;
  const body = req.body || {};
  if (!(quotedFare > 0)) {
    throw new ApiError(400, 'Cash on Delivery needs a fare above zero');
  }
  const user = await User.findById(userId).select('isCodEnabled isCodAllowed').lean();
  if (!user) {
    throw new ApiError(404, 'User not found');
  }
  let allowed;
  try {
    allowed = await assertCodAllowed('taxi', { total: quotedFare, user });
  } catch (error) {
    throw new ApiError(400, error.message);
  }
  const { split } = allowed;

  // No advance asked: nothing to pay first.
  if (split.advanceAmount <= 0) {
    const noAdvance = { percent: split.percent, advanceAmount: 0 };
    if (kind === 'delivery') return sendBookedParcel(res, await placeDelivery(userId, body, noAdvance));
    return sendBookedRide(res, await placeRide(userId, body, noAdvance));
  }

  // Wallet part (same rules as every online payment: opt out with useWallet=false, wallet-only only when asked,
  // never leave the gateway less than Rs 1).
  const useWallet = body.useWallet;
  const optedOut = useWallet === false || useWallet === 'false' || useWallet === 0 || useWallet === '0';
  const asked = useWallet === true || useWallet === 'true' || useWallet === 1 || useWallet === '1';
  let walletAmount = 0;
  // The COD advance is paid online unless the customer explicitly asks for the wallet (useWallet: true).
  if (asked && !optedOut) {
    await ensureUserWallet(userId);
    const wallet = await UserWallet.findOne({ userId }).select('balance').lean();
    walletAmount = roundMoney(Math.min(Number(wallet?.balance || 0), split.advanceAmount));
    if (walletAmount > 0 && roundMoney(split.advanceAmount - walletAmount) < 1) {
      walletAmount = asked ? split.advanceAmount : 0;
    }
  }
  const onlineAmount = roundMoney(split.advanceAmount - walletAmount);

  const checkout = await CodCheckout.create({
    userId,
    kind,
    payload: body,
    percent: split.percent,
    advanceAmount: split.advanceAmount,
    walletAmount,
    onlineAmount,
    expiresAt: new Date(Date.now() + COD_CHECKOUT_TTL_MS),
  });

  // Wallet covers the whole advance: book now.
  if (onlineAmount <= 0) {
    checkout.status = 'finalizing';
    await checkout.save();
    return sendCodResult(res, await finalizeCodBooking(checkout));
  }

  const { keyId, keySecret } = await resolveRazorpayCredentials();
  const order = await razorpayRequest({
    method: 'POST',
    path: '/orders',
    body: {
      amount: Math.round(onlineAmount * 100),
      currency: 'INR',
      receipt: `ucod_${String(userId).slice(-8)}_${String(checkout._id).slice(-8)}`,
      notes: { checkoutId: String(checkout._id), userId: String(userId), walletAmount: String(walletAmount), source: COD_ADVANCE_SOURCE },
    },
    keyId,
    keySecret,
  });
  checkout.razorpayOrderId = order.id;
  await checkout.save();

  return res.status(201).json({
    success: true,
    data: {
      requiresPayment: true,
      checkoutId: String(checkout._id),
      kind,
      percent: split.percent,
      fare: quotedFare,
      advanceAmount: split.advanceAmount,
      remainingAmount: split.remainingAmount,
      walletAmount,
      onlineAmount,
      expiresAt: checkout.expiresAt,
      razorpay: { keyId, orderId: order.id, amount: order.amount, currency: order.currency || 'INR' },
    },
  });
};

/// Step 2 of a COD booking: verify the advance payment and book the ride.
export const verifyCodAdvance = async (req, res) => {
  const checkoutId = String(req.body?.checkoutId || '').trim();
  const orderId = String(req.body?.razorpay_order_id || '');
  const paymentId = String(req.body?.razorpay_payment_id || '');
  const signature = String(req.body?.razorpay_signature || '');
  if (!mongoose.Types.ObjectId.isValid(checkoutId) || !orderId || !paymentId || !signature) {
    throw new ApiError(400, 'checkoutId and the payment verification fields are required');
  }
  const userId = req.auth.sub;
  const checkout = await CodCheckout.findOne({ _id: checkoutId, userId });
  if (!checkout) {
    throw new ApiError(404, 'Booking not found');
  }
  // The app retrying after a dropped response: already booked.
  if (checkout.status === 'completed' && (checkout.rideId || checkout.response)) {
    return checkout.kind === 'delivery' ? sendBookedParcel(res, checkout.response) : sendBookedRide(res, await getRideDetails(checkout.rideId));
  }
  if (checkout.razorpayOrderId !== orderId) {
    throw new ApiError(400, 'This payment is not for this booking');
  }

  const { keyId, keySecret } = await resolveRazorpayCredentials();
  const expectedSignature = crypto.createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  if (expectedSignature !== signature) {
    throw new ApiError(400, 'Invalid payment signature');
  }
  await assertRazorpayPaymentCaptured({ paymentId, orderId, keyId, keySecret });
  const order = await razorpayRequest({ method: 'GET', path: `/orders/${encodeURIComponent(orderId)}`, keyId, keySecret });
  if (
    String(order?.notes?.checkoutId || '') !== String(checkout._id)
    || String(order?.notes?.userId || '') !== String(userId)
    || String(order?.notes?.source || '') !== COD_ADVANCE_SOURCE
    || Math.abs(roundMoney(Number(order?.amount || 0) / 100) - checkout.onlineAmount) > 0.01
  ) {
    throw new ApiError(400, 'This payment is not for this booking');
  }

  // Paid after the booking window closed: keep nothing, put the money in the wallet.
  if (checkout.status === 'expired' || (checkout.status === 'pending' && checkout.expiresAt.getTime() <= Date.now())) {
    await CodCheckout.updateOne({ _id: checkout._id }, { $set: { status: 'expired' } });
    await codCreditBack(userId, checkout.onlineAmount, `ride-cod-advance-late:${paymentId}`, 'Ride advance returned (booking window expired)');
    throw new ApiError(409, `The booking window expired. ₹${checkout.onlineAmount} was added to your wallet; please book again.`);
  }

  const claimed = await CodCheckout.findOneAndUpdate({ _id: checkout._id, status: 'pending' }, { $set: { status: 'finalizing' } }, { new: true });
  if (!claimed) {
    const again = await CodCheckout.findById(checkout._id);
    if (again?.status === 'completed' && (again.rideId || again.response)) {
      return again.kind === 'delivery' ? sendBookedParcel(res, again.response) : sendBookedRide(res, await getRideDetails(again.rideId));
    }
    throw new ApiError(409, 'This booking is already being processed');
  }
  return sendCodResult(res, await finalizeCodBooking(claimed, { orderId, paymentId }));
};

export const getRideById = async (req, res) => {
  await ensureRideParticipantAccess({
    rideId: req.params.rideId,
    role: req.auth.role,
    entityId: req.auth.sub,
  });

  const ride = await getRideDetails(req.params.rideId);

  res.json({
    success: true,
    data: ride,
  });
};

export const getMyActiveRide = async (req, res) => {
  const ride = await getActiveRideForIdentity({
    role: req.auth.role,
    entityId: req.auth.sub,
  });

  res.json({
    success: true,
    data: ride ? serializeRideRealtime(ride) : null,
  });
};

export const listMyRides = async (req, res) => {
  const history = await listRideHistoryForIdentity({
    role: req.auth.role,
    entityId: req.auth.sub,
    limit: req.query.limit,
    page: req.query.page,
    category: req.query.category,
  });

  res.json({
    success: true,
    data: {
      results: history.results,
      total: history.pagination.total,
      pagination: history.pagination,
    },
  });
};

/// Driver posts the URL of a parcel photo already uploaded through
/// `/common/upload/image`. Keeping the upload separate leaves this endpoint a
/// small JSON write and lets the app show upload progress on its own.
export const uploadParcelProof = async (req, res) => {
  const stage = String(req.body.stage || '').trim().toLowerCase();

  const ride = await saveParcelProof({
    rideId: req.params.rideId,
    driverId: req.auth.sub,
    stage,
    imageUrl: req.body.imageUrl || req.body.url || req.body.image,
  });

  // Push the fresh state to the rider so the photo shows up on their tracking
  // screen the moment it is taken, rather than at the next status change.
  try {
    const io = getSocketServer();

    if (io) {
      const populatedRide = await getRideDetails(ride._id);
      io.to(getRideRoom(populatedRide._id)).emit('ride:state', serializeRideRealtime(populatedRide));
    }
  } catch (error) {
    // A socket hiccup must not fail a write that already succeeded.
    console.error('parcel proof broadcast failed', error?.message || error);
  }

  res.json({
    success: true,
    message: stage === 'pickup' ? 'Pickup photo saved' : 'Delivery photo saved',
    results: {
      rideId: String(ride._id),
      stage,
      pickupProof: {
        url: ride.parcel?.pickupProof?.url || '',
        at: ride.parcel?.pickupProof?.at || null,
      },
      deliveryProof: {
        url: ride.parcel?.deliveryProof?.url || '',
        at: ride.parcel?.deliveryProof?.at || null,
      },
    },
  });
};

export const updateRideStatus = async (req, res) => {
  if (req.auth.role !== 'driver') {
    throw new ApiError(403, 'Only drivers can update ride status');
  }

  const nextStatus = String(req.body.status || '').trim().toLowerCase();

  if (![RIDE_LIVE_STATUS.ACCEPTED, RIDE_LIVE_STATUS.ARRIVING, RIDE_LIVE_STATUS.STARTED, RIDE_LIVE_STATUS.ARRIVED, RIDE_LIVE_STATUS.COMPLETED].includes(nextStatus)) {
    throw new ApiError(400, 'status must be accepted, arriving, started, arrived, or completed');
  }

  const ride = await updateRideLifecycle({
    rideId: req.params.rideId,
    driverId: req.auth.sub,
    nextStatus,
    paymentMethod: req.body.paymentMethod,
    collectedVia: req.body.collectedVia,
  });

  try {
    const io = getSocketServer();
    if (io) {
      const populatedRide = await getRideDetails(ride._id);
      const payload = {
        rideId: String(populatedRide._id),
        status: populatedRide.status,
        liveStatus: populatedRide.liveStatus,
        acceptedAt: populatedRide.acceptedAt,
        arrivedAt: populatedRide.arrivedAt,
        startedAt: populatedRide.startedAt,
        completedAt: populatedRide.completedAt,
      };
      const room = getRideRoom(populatedRide._id);
      
      // Emit ride:status:updated
      io.to(room).emit('ride:status:updated', payload);
      
      // Emit ride:state
      const statePayload = serializeRideRealtime(populatedRide);
      io.to(room).emit('ride:state', statePayload);
      
      // Sync to Firebase/Realtime DB
      const { mirrorRideRealtimeState } = await import('../../services/rideRealtimeSyncService.js');
      mirrorRideRealtimeState(statePayload).catch(() => {});
    }
  } catch (socketError) {
    console.error('Failed to emit status update socket event from controller:', socketError);
  }

  res.json({
    success: true,
    data: serializeRideRealtime(ride),
  });
};

export const submitRideReview = async (req, res) => {
  if (req.auth.role !== 'user') {
    throw new ApiError(403, 'Only users can rate completed rides');
  }

  const ride = await submitRideFeedback({
    rideId: req.params.rideId,
    userId: req.auth.sub,
    rating: req.body.rating,
    comment: req.body.comment,
    tipAmount: req.body.tipAmount,
  });

  res.json({
    success: true,
    data: serializeRideRealtime(ride),
  });
};

export const createRazorpayRideCompletionOrder = async (req, res) => {
  const rideId = String(req.params.rideId || '').trim();
  const { tipAmount } = await validateRideCompletionFeedback({
    rating: Number(req.body?.rating || 0),
    tipAmount: req.body?.tipAmount,
  });

  const ride = await loadCompletedRideForUser(rideId, req.auth.sub);

  if (ride.feedback?.submittedAt) {
    throw new ApiError(409, 'Feedback already submitted for this ride');
  }

  const { keyId, keySecret } = await resolveRazorpayCredentials();
  const paymentAmounts = buildCompletionAmounts(ride, tipAmount);

  if (paymentAmounts.totalCharge <= 0) {
    throw new ApiError(400, 'No payable amount remains for this ride');
  }

  const walletAmount = await resolveWalletSplit(req.auth.sub, paymentAmounts.totalCharge, req.body?.useWallet);
  const onlineAmount = roundMoney(paymentAmounts.totalCharge - walletAmount);

  const compactRideId = rideId.replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'ride';
  const compactUserId = String(req.auth?.sub || '').replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'usr';
  const receipt = `uride_${compactUserId}_${compactRideId}_${Date.now().toString(36)}`;

  const order = await razorpayRequest({
    method: 'POST',
    path: '/orders',
    body: {
      amount: Math.round(onlineAmount * 100),
      currency: 'INR',
      receipt,
      notes: {
        rideId,
        userId: String(req.auth.sub),
        driverId: String(ride.driverId),
        fareDue: String(paymentAmounts.fareDue),
        tipAmount: String(tipAmount),
        walletAmount: String(walletAmount),
        source: 'ride_completion',
      },
    },
    keyId,
    keySecret,
  });

  res.status(201).json({
    success: true,
    data: {
      keyId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency || 'INR',
      fare: paymentAmounts.fare,
      fareDue: paymentAmounts.fareDue,
      tipAmount: paymentAmounts.tipAmount,
      totalCharge: paymentAmounts.totalCharge,
      walletAmount,
      onlineAmount,
    },
  });
};

export const verifyRazorpayRideCompletion = async (req, res) => {
  const rideId = String(req.params.rideId || '').trim();
  const rating = Number(req.body?.rating || 0);
  const comment = String(req.body?.comment || '');
  const { tipAmount } = await validateRideCompletionFeedback({
    rating,
    tipAmount: req.body?.tipAmount,
  });
  const orderId = String(req.body?.razorpay_order_id || '');
  const paymentId = String(req.body?.razorpay_payment_id || '');
  const signature = String(req.body?.razorpay_signature || '');

  if (!orderId || !paymentId || !signature) {
    throw new ApiError(400, 'Payment verification fields are required');
  }

  const ride = await loadCompletedRideForUser(rideId, req.auth.sub);

  if (
    ride.feedback?.submittedAt &&
    (String(ride.driverPaymentCollection?.providerPaymentId || '') === paymentId || String(ride.feedback?.tipPaymentId || '') === paymentId)
  ) {
    return res.json({
      success: true,
      data: await getRideDetails(rideId),
    });
  }

  const { keyId, keySecret } = await resolveRazorpayCredentials();
  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  if (expectedSignature !== signature) {
    throw new ApiError(400, 'Invalid payment signature');
  }
  await assertRazorpayPaymentCaptured({ paymentId: paymentId, orderId: orderId, keyId, keySecret });

  const order = await razorpayRequest({
    method: 'GET',
    path: `/orders/${encodeURIComponent(orderId)}`,
    keyId,
    keySecret,
  });

  const paymentAmounts = buildCompletionAmounts(ride, tipAmount);
  const onlineAmount = roundMoney(Number(order?.amount || 0) / 100);
  const walletAmount = walletPartOfOrder(order);
  const verifiedTotalCharge = roundMoney(onlineAmount + walletAmount);
  if (onlineAmount <= 0) {
    throw new ApiError(400, 'Invalid order amount');
  }

  if (Math.abs(verifiedTotalCharge - paymentAmounts.totalCharge) > 0.001) {
    throw new ApiError(400, 'Verified payment amount does not match the payable ride total');
  }

  const existingWalletCredit = await WalletTransaction.findOne({
    driverId: ride.driverId,
    'metadata.providerPaymentId': paymentId,
  })
    .select('_id')
    .lean();

  if (
    existingWalletCredit &&
    String(ride.driverPaymentCollection?.providerPaymentId || '') !== paymentId &&
    String(ride.feedback?.tipPaymentId || '') !== paymentId
  ) {
    throw new ApiError(409, 'This ride completion payment was already processed');
  }

  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const liveRide = await loadCompletedRideForUser(rideId, req.auth.sub, session);
    await debitSplitWallet({ userId: req.auth.sub, walletAmount, onlineAmount, rideId, paymentId, session });
    const result = await finalizeRideCompletion({
      ride: liveRide,
      userId: req.auth.sub,
      rating,
      comment,
      tipAmount,
      paymentSource: 'ride_completion_razorpay',
      paymentRecord: {
        provider: 'razorpay',
        providerId: paymentId,
        providerOrderId: orderId,
        providerPaymentId: paymentId,
        providerMode: 'razorpay_order',
        source: 'ride_completion_razorpay',
        currency: order.currency || 'INR',
        walletAmount,
        onlineAmount,
        paidAt: new Date(),
      },
      session,
    });

    await session.commitTransaction();

    // An online ride credits no extra wallet money here (its fare settles with the trip), so the
    // wallet event below often does not fire. The driver still has to hear that the rider paid.
    emitToDriver(liveRide.driverId, 'ride:payment:received', {
      rideId,
      amount: paymentAmounts.totalCharge,
      method: 'online',
      message: `Rider paid Rs ${paymentAmounts.totalCharge.toFixed(0)} online for this trip.`,
    });

    if (result.walletResult?.transaction) {
      emitToDriver(liveRide.driverId, 'driver:wallet:updated', {
        wallet: result.walletResult.wallet,
        transaction: result.walletResult.transaction,
        notification: {
          id: `ride-payment-${paymentId}`,
          title: 'Payment received',
          body: `Rs ${paymentAmounts.totalCharge.toFixed(2)} received from rider for completed ride.`,
          sentAt: new Date().toISOString(),
        },
      });
    }

    res.json({
      success: true,
      data: result.ride,
    });
  } catch (error) {
    await session.abortTransaction();
    if (error.refundOnline) {
      await refundOnlinePartToWallet({ userId: req.auth.sub, amount: error.refundOnline, rideId, paymentId });
    }
    throw error;
  } finally {
    session.endSession();
  }
};

export const payRideCompletionWithWallet = async (req, res) => {
  const rideId = String(req.params.rideId || '').trim();
  const rating = Number(req.body?.rating || 0);
  const comment = String(req.body?.comment || '');
  const { tipAmount } = await validateRideCompletionFeedback({
    rating,
    tipAmount: req.body?.tipAmount,
  });

  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const ride = await loadCompletedRideForUser(rideId, req.auth.sub, session);
    const paymentAmounts = buildCompletionAmounts(ride, tipAmount);

    if (paymentAmounts.totalCharge <= 0) {
      throw new ApiError(400, 'No payable amount remains for this ride');
    }

    await ensureUserWallet(req.auth.sub, session);
    const userWallet = await UserWallet.findOne({ userId: req.auth.sub }).session(session);
    if (!userWallet) {
      throw new ApiError(404, 'User wallet not found');
    }

    if (Number(userWallet.balance || 0) < paymentAmounts.totalCharge) {
      throw new ApiError(400, 'Insufficient wallet balance');
    }

    const transferId = crypto.randomUUID();
    userWallet.balance = roundMoney(Number(userWallet.balance || 0) - paymentAmounts.totalCharge);
    userWallet.transactions.push({
      kind: 'debit',
      amount: paymentAmounts.totalCharge,
      title: `Ride payment for ${rideId.slice(-6)}${tipAmount > 0 ? ' with tip' : ''}`,
      provider: 'ride_completion_wallet',
      providerPaymentId: transferId,
    });
    userWallet.transactions = userWallet.transactions.slice(-50);
    await userWallet.save({ session });

    const result = await finalizeRideCompletion({
      ride,
      userId: req.auth.sub,
      rating,
      comment,
      tipAmount,
      paymentSource: 'ride_completion_wallet',
      paymentRecord: {
        provider: 'wallet',
        providerId: transferId,
        providerOrderId: '',
        providerPaymentId: transferId,
        providerMode: 'wallet_internal',
        source: 'ride_completion_wallet',
        currency: 'INR',
        paidAt: new Date(),
      },
      session,
    });

    await session.commitTransaction();

    if (result.walletResult?.transaction) {
      emitToDriver(ride.driverId, 'driver:wallet:updated', {
        wallet: result.walletResult.wallet,
        transaction: result.walletResult.transaction,
        notification: {
          id: `ride-wallet-${transferId}`,
          title: 'Payment received',
          body: `Rs ${paymentAmounts.totalCharge.toFixed(2)} received from rider wallet for completed ride.`,
          sentAt: new Date().toISOString(),
        },
      });
    }

    res.status(201).json({
      success: true,
      data: result.ride,
    });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * The rider pays a cash ride's fare online, Rapido-style, instead of paying
 * the driver's own UPI - which PhonePe and Google Pay decline when another app
 * opens it. Open from when the driver is assigned until the fare is paid,
 * before or after the trip is completed.
 *
 * The money reaches Buddy, so the driver's wallet is credited the full fare
 * the moment it is verified. The ride stays a cash ride for settlement: the
 * commission (or a pass's waiver) is taken exactly as if the driver had been
 * handed the cash, so the driver nets the same whichever way the rider paid
 * and whenever the payment lands relative to completion.
 */
const RIDER_FARE_ONLINE_SOURCE = 'rider_fare_online';

const loadRideForFarePayment = async (rideId, userId, session = null) => {
  const ride = await Ride.findOne({ _id: rideId, userId }).session(session);
  if (!ride) {
    throw new ApiError(404, 'Ride not found');
  }
  if (!ride.driverId) {
    throw new ApiError(409, 'Ride has no assigned driver yet');
  }
  if (ride.status === RIDE_STATUS.CANCELLED || ride.liveStatus === RIDE_LIVE_STATUS.CANCELLED) {
    throw new ApiError(409, 'This ride was cancelled');
  }
  return ride;
};

export const createRazorpayRideFareOrder = async (req, res) => {
  const rideId = String(req.params.rideId || '').trim();
  const ride = await loadRideForFarePayment(rideId, req.auth.sub);

  if (isDriverCollectionPaid(ride)) {
    throw new ApiError(409, 'This fare is already paid');
  }

  // COD with an advance: the rider pays only what is left after the advance.
  const fare = hasCod(ride) ? rideAmountDue(ride) : roundMoney(ride.fare || 0);
  if (fare <= 0) {
    throw new ApiError(400, 'No fare to pay for this ride');
  }

  const walletAmount = await resolveWalletSplit(req.auth.sub, fare, req.body?.useWallet);
  const onlineAmount = roundMoney(fare - walletAmount);

  const { keyId, keySecret } = await resolveRazorpayCredentials();
  const compactRideId = rideId.replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'ride';
  const compactUserId = String(req.auth?.sub || '').replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'usr';

  const order = await razorpayRequest({
    method: 'POST',
    path: '/orders',
    body: {
      amount: Math.round(onlineAmount * 100),
      currency: 'INR',
      receipt: `ufare_${compactUserId}_${compactRideId}_${Date.now().toString(36)}`,
      notes: {
        rideId,
        userId: String(req.auth.sub),
        driverId: String(ride.driverId),
        walletAmount: String(walletAmount),
        source: RIDER_FARE_ONLINE_SOURCE,
      },
    },
    keyId,
    keySecret,
  });

  res.status(201).json({
    success: true,
    data: {
      keyId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency || 'INR',
      fare,
      walletAmount,
      onlineAmount,
    },
  });
};

export const verifyRazorpayRideFare = async (req, res) => {
  const rideId = String(req.params.rideId || '').trim();
  const orderId = String(req.body?.razorpay_order_id || '');
  const paymentId = String(req.body?.razorpay_payment_id || '');
  const signature = String(req.body?.razorpay_signature || '');

  if (!orderId || !paymentId || !signature) {
    throw new ApiError(400, 'Payment verification fields are required');
  }

  const ride = await loadRideForFarePayment(rideId, req.auth.sub);

  // The app retrying after a dropped response: already done.
  if (String(ride.driverPaymentCollection?.providerPaymentId || '') === paymentId && isDriverCollectionPaid(ride)) {
    return res.json({ success: true, data: await getRideDetails(rideId) });
  }

  const { keyId, keySecret } = await resolveRazorpayCredentials();
  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  if (expectedSignature !== signature) {
    throw new ApiError(400, 'Invalid payment signature');
  }
  await assertRazorpayPaymentCaptured({ paymentId: paymentId, orderId: orderId, keyId, keySecret });

  // The order must be this ride's fare order, for this rider.
  const order = await razorpayRequest({
    method: 'GET',
    path: `/orders/${encodeURIComponent(orderId)}`,
    keyId,
    keySecret,
  });
  if (
    String(order?.notes?.rideId || '') !== rideId
    || String(order?.notes?.userId || '') !== String(req.auth.sub)
    || String(order?.notes?.source || '') !== RIDER_FARE_ONLINE_SOURCE
  ) {
    throw new ApiError(400, 'This payment is not for this ride');
  }
  const onlineAmount = roundMoney(Number(order?.amount || 0) / 100);
  if (onlineAmount <= 0) {
    throw new ApiError(400, 'Invalid order amount');
  }
  // Total settled = gateway part + the wallet part carried on the order.
  const walletAmount = walletPartOfOrder(order);
  const paidAmount = roundMoney(onlineAmount + walletAmount);

  if (isDriverCollectionPaid(ride)) {
    throw new ApiError(409, 'This fare was already paid');
  }

  const session = await mongoose.startSession();
  let walletResult = null;
  let driverId = null;
  try {
    session.startTransaction();

    await debitSplitWallet({ userId: req.auth.sub, walletAmount, onlineAmount, rideId, paymentId, session });

    // Marking the fare paid and crediting the driver happen together, and
    // only once: a second verify finds the fare already paid and stops.
    const updated = await Ride.findOneAndUpdate(
      {
        _id: rideId,
        userId: req.auth.sub,
        'driverPaymentCollection.paidAt': null,
        'driverPaymentCollection.status': { $nin: [...PAYMENT_PAID_STATUSES] },
      },
      {
        $set: {
          collectedVia: 'online',
          paymentMethod: 'online',
          driverPaymentCollection: {
            provider: 'razorpay',
            providerId: paymentId,
            providerOrderId: orderId,
            providerPaymentId: paymentId,
            providerMode: 'razorpay_order',
            source: RIDER_FARE_ONLINE_SOURCE,
            status: 'paid',
            amount: paidAmount,
            walletAmount,
            onlineAmount,
            currency: order.currency || 'INR',
            linkUrl: '',
            paidAt: new Date(),
            updatedAt: new Date(),
          },
        },
      },
      { returnDocument: 'after', session },
    );
    if (!updated) {
      throw new ApiError(409, 'This fare was already paid');
    }
    driverId = updated.driverId;

    walletResult = await applyDriverWalletAdjustment({
      driverId,
      rideId: updated._id,
      amount: paidAmount,
      type: 'adjustment',
      description: 'Ride fare paid online by rider',
      metadata: {
        source: RIDER_FARE_ONLINE_SOURCE,
        rideId,
        userId: String(req.auth.sub),
        provider: 'razorpay',
        providerOrderId: orderId,
        providerPaymentId: paymentId,
      },
      session,
    });

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    if (error.refundOnline) {
      await refundOnlinePartToWallet({ userId: req.auth.sub, amount: error.refundOnline, rideId, paymentId });
    }
    throw error;
  } finally {
    session.endSession();
  }

  // Tell the driver at once, so they do not also take cash.
  emitToDriver(driverId, 'ride:payment:received', {
    rideId,
    amount: paidAmount,
    method: 'online',
    message: `Rider paid Rs ${paidAmount.toFixed(0)} online. Do not collect cash.`,
  });
  if (walletResult?.transaction) {
    emitToDriver(driverId, 'driver:wallet:updated', {
      wallet: walletResult.wallet,
      transaction: walletResult.transaction,
      notification: {
        id: `ride-fare-${paymentId}`,
        title: 'Rider paid online',
        body: `Rs ${paidAmount.toFixed(0)} added to your wallet. Do not collect cash for this ride.`,
        sentAt: new Date().toISOString(),
      },
    });
  }

  res.json({ success: true, data: await getRideDetails(rideId) });
};

export const createRazorpayRideTipOrder = async (req, res) => {
  const rideId = String(req.params.rideId || '').trim();
  const tipAmount = normalizeMoneyAmount(req.body?.tipAmount, 'tipAmount');
  const tipSettings = await getTipSettings();
  const tipsEnabled = String(tipSettings.enable_tips || '1') === '1';
  const minimumTipAmount = Number(tipSettings.min_tip_amount || 0);

  if (!tipsEnabled) {
    throw new ApiError(403, 'Tips are currently disabled');
  }

  if (minimumTipAmount > 0 && tipAmount < minimumTipAmount) {
    throw new ApiError(400, `tipAmount must be at least ${minimumTipAmount}`);
  }

  const ride = await Ride.findOne({
    _id: rideId,
    userId: req.auth.sub,
    status: 'completed',
  }).select('_id driverId feedback');

  if (!ride) {
    throw new ApiError(404, 'Completed ride not found');
  }

  if (!ride.driverId) {
    throw new ApiError(409, 'Ride has no assigned driver');
  }

  if (ride.feedback?.submittedAt) {
    throw new ApiError(409, 'Feedback already submitted for this ride');
  }

  const { keyId, keySecret } = await resolveRazorpayCredentials();
  const amountPaise = Math.round(tipAmount * 100);
  const compactRideId = rideId.replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'ride';
  const compactUserId = String(req.auth?.sub || '').replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'usr';
  const receipt = `utip_${compactUserId}_${compactRideId}_${Date.now().toString(36)}`;

  const order = await razorpayRequest({
    method: 'POST',
    path: '/orders',
    body: {
      amount: amountPaise,
      currency: 'INR',
      receipt,
      notes: {
        rideId,
        userId: String(req.auth.sub),
        driverId: String(ride.driverId),
        kind: 'ride_tip',
      },
    },
    keyId,
    keySecret,
  });

  res.status(201).json({
    success: true,
    data: {
      keyId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency || 'INR',
      tipAmount,
    },
  });
};

export const verifyRazorpayRideTip = async (req, res) => {
  const rideId = String(req.params.rideId || '').trim();
  const rating = Number(req.body?.rating || 0);
  const comment = String(req.body?.comment || '');
  const tipAmount = normalizeMoneyAmount(req.body?.tipAmount, 'tipAmount');
  const orderId = String(req.body?.razorpay_order_id || '');
  const paymentId = String(req.body?.razorpay_payment_id || '');
  const signature = String(req.body?.razorpay_signature || '');

  if (!orderId || !paymentId || !signature) {
    throw new ApiError(400, 'Payment verification fields are required');
  }

  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    throw new ApiError(400, 'rating must be between 1 and 5');
  }

  const tipSettings = await getTipSettings();
  const tipsEnabled = String(tipSettings.enable_tips || '1') === '1';
  const minimumTipAmount = Number(tipSettings.min_tip_amount || 0);

  if (!tipsEnabled) {
    throw new ApiError(403, 'Tips are currently disabled');
  }

  if (minimumTipAmount > 0 && tipAmount < minimumTipAmount) {
    throw new ApiError(400, `tipAmount must be at least ${minimumTipAmount}`);
  }

  const ride = await Ride.findOne({
    _id: rideId,
    userId: req.auth.sub,
    status: 'completed',
  });

  if (!ride) {
    throw new ApiError(404, 'Completed ride not found');
  }

  if (!ride.driverId) {
    throw new ApiError(409, 'Ride has no assigned driver');
  }

  if (ride.feedback?.submittedAt && String(ride.feedback?.tipPaymentId || '') === paymentId) {
    const existingRide = await getRideDetails(rideId);
    res.json({
      success: true,
      data: existingRide,
    });
    return;
  }

  if (ride.feedback?.submittedAt) {
    throw new ApiError(409, 'Feedback already submitted for this ride');
  }

  const { keyId, keySecret } = await resolveRazorpayCredentials();
  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  if (expectedSignature !== signature) {
    throw new ApiError(400, 'Invalid payment signature');
  }
  await assertRazorpayPaymentCaptured({ paymentId: paymentId, orderId: orderId, keyId, keySecret });

  const order = await razorpayRequest({
    method: 'GET',
    path: `/orders/${encodeURIComponent(orderId)}`,
    keyId,
    keySecret,
  });

  const amountPaise = Number(order?.amount);
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
    throw new ApiError(400, 'Invalid order amount');
  }

  const verifiedTipAmount = Math.round(amountPaise) / 100;
  if (Math.abs(verifiedTipAmount - tipAmount) > 0.001) {
    throw new ApiError(400, 'Verified tip amount does not match selected tip');
  }

  const driver = await Driver.findById(ride.driverId);
  if (!driver) {
    throw new ApiError(404, 'Driver not found');
  }

  const existingWalletCredit = await WalletTransaction.findOne({
    driverId: ride.driverId,
    'metadata.providerPaymentId': paymentId,
  })
    .select('_id')
    .lean();

  if (existingWalletCredit && String(ride.feedback?.tipPaymentId || '') !== paymentId) {
    throw new ApiError(409, 'This tip payment was already processed');
  }

  const walletResult = existingWalletCredit
    ? {
        wallet: await serializeDriverWallet(driver),
        transaction: null,
      }
    : await applyDriverWalletAdjustment({
        driverId: ride.driverId,
        rideId: ride._id,
        amount: verifiedTipAmount,
        type: 'adjustment',
        description: 'Ride tip credited from rider',
        metadata: {
          source: 'ride_tip',
          provider: 'razorpay',
          providerOrderId: orderId,
          providerPaymentId: paymentId,
          rideId: String(ride._id),
          userId: String(req.auth.sub),
        },
      });

  ride.feedback = {
    rating,
    comment: comment.trim(),
    tipAmount: verifiedTipAmount,
    tipPaymentId: paymentId,
    tipOrderId: orderId,
    tipPaidAt: new Date(),
    submittedAt: new Date(),
  };

  driver.ratingCount = Number(driver.ratingCount || 0) + 1;
  driver.totalRatingScore = Number(driver.totalRatingScore || 0) + rating;
  driver.rating = Number((driver.totalRatingScore / driver.ratingCount).toFixed(1));

  await Promise.all([ride.save(), driver.save()]);

  if (walletResult.transaction) {
    emitToDriver(ride.driverId, 'driver:wallet:updated', {
      wallet: walletResult.wallet,
      transaction: walletResult.transaction,
      notification: {
        id: `ride-tip-${paymentId}`,
        title: 'Payment received',
        body: `Rs ${verifiedTipAmount.toFixed(2)} tip received from rider.`,
        sentAt: new Date().toISOString(),
      },
    });
  }

  const populatedRide = await getRideDetails(ride._id);

  res.json({
    success: true,
    data: populatedRide,
  });
};

/// The admin's negotiation bands, so the apps step fares the way the server
/// expects rather than guessing.
///
/// Public for the same reason the tip settings are: the rider needs the
/// increment before a ride exists, while they are still deciding whether to
/// name their own price.
export const getRideBiddingSettings = async (_req, res) => {
  const settings = await getBidRideSettings();

  const toNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  res.json({
    success: true,
    data: {
      settings: {
        // What a driver may bid, as a percentage either side of the fare.
        driverLowPercentage: toNumber(settings.bidding_low_percentage, 10),
        driverHighPercentage: toNumber(settings.bidding_high_percentage, 20),
        driverStepAmount: toNumber(settings.bidding_amount_increase_or_decrease, 10),
        // What a rider may set as their own ceiling, above the quoted fare.
        userLowPercentage: toNumber(settings.user_bidding_low_percentage, 10),
        userHighPercentage: toNumber(settings.user_bidding_high_percentage, 20),
        userStepAmount: toNumber(settings.user_bidding_amount_increase_or_decrease, 10),
        userFareIncreaseWaitMinutes: toNumber(settings.user_fare_increase_wait_minutes, 2),
      },
    },
  });
};

export const getRideAppTipSettings = async (_req, res) => {
  const tipSettings = await getTipSettings();

  res.json({
    success: true,
    data: {
      settings: tipSettings,
    },
  });
};

export const cancelRide = async (req, res) => {
  const ride = await cancelRideByUser({
    rideId: req.params.rideId,
    userId: req.auth.sub,
  });

  if (!ride) {
    throw new ApiError(404, 'Ride not found');
  }

  res.json({
    success: true,
    data: {
      rideId: String(ride._id),
      status: ride.status,
      liveStatus: ride.liveStatus,
    },
  });
};

export const listAvailableDrivers = async (req, res) => {
  const { vehicleTypeId, lat, lng, maxDistance, limit = 30, service_location_id, transport_type } = req.query;
  const latitude = Number(lat);
  const longitude = Number(lng);
  const distance = Number(maxDistance);

  // Optional on purpose: a specific vehicle type narrows the search (the
  // fare/ETA screen asks "how far is the closest Sedan"), but the map's
  // ambient nearby-driver markers ask a different question — "who's online
  // near here at all" — and have no vehicle type to offer yet. `matchDrivers`
  // already treats an absent vehicleTypeId as "any type"; this used to block
  // that case before it ever reached there, which is why the map never had
  // a driver on it to click failed with "vehicleTypeId is required" and the
  // client silently rendered zero markers.
  if (vehicleTypeId && !mongoose.Types.ObjectId.isValid(vehicleTypeId)) {
    throw new ApiError(400, 'vehicleTypeId is invalid');
  }

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new ApiError(400, 'lat and lng are required');
  }

  const normalizedServiceLocationId =
    service_location_id && mongoose.Types.ObjectId.isValid(service_location_id)
      ? new mongoose.Types.ObjectId(service_location_id)
      : null;

  // Two callers, two meanings. With a vehicle type this is the fare screen
  // asking how far the closest Sedan is, and it needs the full search range or
  // it reports no driver at all. Without one it is the map's ambient markers,
  // and the admin decides how wide "around me" is - the client wants one km,
  // so a driver eight km away no longer appears beside the rider's pin.
  const transportSettings = await getTransportRideSettings();
  const markerRadiusMeters = Math.max(
    100,
    Math.round((Number(transportSettings.nearby_driver_marker_radius) || 1) * 1000),
  );
  const requestedDistance = Number.isFinite(distance) && distance > 0 ? Math.min(distance, 25000) : 25000;

  const matchOptions = {
    maxDistance: vehicleTypeId ? requestedDistance : Math.min(requestedDistance, markerRadiusMeters),
    limit: Math.min(Number(limit) || 30, 50),
    ...(vehicleTypeId ? { vehicleTypeId } : {}),
  };

  let matchResult = await matchDrivers([longitude, latitude], {
    ...matchOptions,
    serviceLocationId: normalizedServiceLocationId,
  });

  if (!matchResult.drivers.length && normalizedServiceLocationId) {
    matchResult = await matchDrivers([longitude, latitude], {
      ...matchOptions,
      serviceLocationId: null,
    });
  }

  const { drivers } = matchResult;

  const enrichedDrivers = drivers.map((driver) => {
    const distanceMeters = calculateDistanceMeters([longitude, latitude], driver.location?.coordinates || []);
    const etaMinutes = estimateEtaMinutes(distanceMeters);

    return {
      id: driver._id,
      name: driver.name,
      vehicleTypeId: driver.vehicleTypeId,
      vehicleType: driver.vehicleType,
      vehicleIconType: driver.vehicleIconType,
      vehicleNumber: driver.vehicleNumber,
      vehicleColor: driver.vehicleColor,
      vehicleMake: driver.vehicleMake,
      vehicleModel: driver.vehicleModel,
      rating: driver.rating,
      location: driver.location,
      distanceMeters,
      etaMinutes,
    };
  });

  const closestDriver = enrichedDrivers[0] || null;
  const { allowedPaymentMethods } = await getAllowedRidePaymentMethodsForPricing({
    serviceLocationId: normalizedServiceLocationId,
    transportType: transport_type || 'taxi',
    vehicleTypeId,
  });

  res.json({
    success: true,
    data: {
      totalDrivers: enrichedDrivers.length,
      closestDriverDistanceMeters: closestDriver?.distanceMeters ?? null,
      closestDriverEtaMinutes: closestDriver?.etaMinutes ?? null,
      allowedPaymentMethods,
      drivers: enrichedDrivers,
    },
  });
};

export const getRideBids = async (req, res) => {
  const result = await listRideBidsForUser({
    rideId: req.params.rideId,
    userId: req.auth.sub,
  });

  res.json({
    success: true,
    data: result,
  });
};

export const acceptRideBid = async (req, res) => {
  const ride = await acceptRideBidAssignment({
    rideId: req.params.rideId,
    bidId: req.params.bidId,
    userId: req.auth.sub,
  });

  await notifyRideAccepted(ride);

  res.json({
    success: true,
    data: {
      rideId: String(ride._id),
      status: ride.status,
      liveStatus: ride.liveStatus,
      acceptedAt: ride.acceptedAt,
    },
  });
};

export const updateRideBidCeiling = async (req, res) => {
  const ride = await increaseRideBidCeiling({
    rideId: req.params.rideId,
    userId: req.auth.sub,
    incrementSteps: req.body.incrementSteps,
  });

  await notifyRideBiddingUpdated(ride.rideId || req.params.rideId);
  if (ride.pricingNegotiationMode === 'user_increment_only') {
    await restartRideDispatchWithLatestFare(ride.rideId || req.params.rideId);
  }

  res.json({
    success: true,
    data: ride,
  });
};
