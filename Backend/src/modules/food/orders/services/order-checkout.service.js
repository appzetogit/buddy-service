import mongoose from 'mongoose';
import { FoodCheckoutSession } from '../models/foodCheckoutSession.model.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import {
  createRazorpayOrder,
  verifyPaymentSignature,
  getRazorpayKeyId,
  isRazorpayConfigured,
  fetchRazorpayPayment,
} from '../helpers/razorpay.helper.js';
import { logger } from '../../../../utils/logger.js';

const CHECKOUT_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function isCheckoutExpired(session) {
  if (!session?.expiresAt) return true;
  return new Date(session.expiresAt).getTime() <= Date.now();
}

/**
 * Create a prepaid checkout session + Razorpay order (no FoodOrder yet).
 */
export async function createPrepaidCheckoutSession({
  userId,
  dto,
  pricing,
  walletAmount = 0,
}) {
  if (!isRazorpayConfigured()) {
    throw new ValidationError('Online payment is not configured');
  }

  // Wallet part is not charged here; only the remainder goes to the gateway.
  const amountDue = Math.round((Number(pricing?.total ?? 0) - Number(walletAmount || 0)) * 100) / 100;
  const amountPaise = Math.round(amountDue * 100);
  if (amountPaise < 100) {
    throw new ValidationError('Amount too low for online payment');
  }

  const expiresAt = new Date(Date.now() + CHECKOUT_TTL_MS);
  const session = new FoodCheckoutSession({
    userId: new mongoose.Types.ObjectId(userId),
    status: 'pending_payment',
    paymentMethod: 'razorpay',
    orderPayload: dto,
    pricing,
    amountDue,
    walletAmount: Number(walletAmount || 0),
    currency: String(pricing?.currency || 'INR'),
    expiresAt,
  });

  const rzOrder = await createRazorpayOrder(
    amountPaise,
    'INR',
    `chk_${session._id.toString()}`,
  );

  session.razorpay = {
    orderId: rzOrder.id,
    paymentId: '',
    signature: '',
    amountPaise: rzOrder.amount || amountPaise,
  };
  await session.save();

  return {
    checkoutId: String(session._id),
    pricing,
    walletAmount: Number(walletAmount || 0),
    onlineAmount: amountDue,
    razorpay: {
      key: getRazorpayKeyId(),
      orderId: rzOrder.id,
      amount: rzOrder.amount || amountPaise,
      currency: rzOrder.currency || 'INR',
    },
    expiresAt,
  };
}

export async function getCheckoutSessionForUser(checkoutId, userId) {
  if (!checkoutId || !mongoose.Types.ObjectId.isValid(checkoutId)) {
    throw new ValidationError('Valid checkoutId required');
  }
  const session = await FoodCheckoutSession.findOne({
    _id: checkoutId,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!session) throw new NotFoundError('Checkout session not found');
  return session;
}

/**
 * Verify Razorpay signature + gateway payment amount/status against checkout session.
 */
export async function verifyCheckoutPayment(session, {
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
}) {
  if (!session) throw new NotFoundError('Checkout session not found');

  if (session.status === 'completed' && session.foodOrderId) {
    return { alreadyCompleted: true, session };
  }

  if (session.status === 'finalizing') {
    return { alreadyCompleted: Boolean(session.foodOrderId), session };
  }

  if (session.status === 'cancelled' || session.status === 'failed') {
    throw new ValidationError('Checkout session is no longer valid');
  }

  if (isCheckoutExpired(session) && session.status === 'pending_payment') {
    session.status = 'expired';
    await session.save();
    throw new ValidationError('Checkout session expired. Please place the order again.');
  }

  if (String(session.razorpay?.orderId || '') !== String(razorpayOrderId || '')) {
    throw new ValidationError('Payment order mismatch');
  }

  const valid = verifyPaymentSignature(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  );
  if (!valid) throw new ValidationError('Payment verification failed');

  // Server-side gateway check: amount + captured/authorized
  let gatewayPayment = null;
  try {
    gatewayPayment = await fetchRazorpayPayment(razorpayPaymentId);
  } catch (err) {
    logger.warn(`fetchRazorpayPayment failed: ${err?.message || err}`);
    throw new ValidationError('Unable to verify payment with gateway');
  }

  const paidPaise = Number(gatewayPayment?.amount || 0);
  const expectedPaise = Number(session.razorpay?.amountPaise || Math.round(session.amountDue * 100));
  if (paidPaise !== expectedPaise) {
    throw new ValidationError('Paid amount does not match order total');
  }

  const rzOrderId = String(gatewayPayment?.order_id || '');
  if (rzOrderId && rzOrderId !== String(razorpayOrderId)) {
    throw new ValidationError('Payment does not belong to this checkout');
  }

  const status = String(gatewayPayment?.status || '').toLowerCase();
  if (!['captured', 'authorized'].includes(status)) {
    throw new ValidationError(`Payment not successful (status: ${status || 'unknown'})`);
  }

  session.status = 'paid';
  session.paidAt = session.paidAt || new Date();
  session.razorpay.paymentId = razorpayPaymentId;
  session.razorpay.signature = razorpaySignature;
  await session.save();

  return { alreadyCompleted: false, session, gatewayPayment };
}

export async function markCheckoutCompleted(session, foodOrderId) {
  session.status = 'completed';
  session.foodOrderId = foodOrderId;
  session.completedAt = new Date();
  await session.save();
  return session;
}

/**
 * Atomically claim a paid checkout so only one path creates the FoodOrder.
 * Returns null if already claimed/completed.
 */
export async function claimCheckoutForOrderCreate(checkoutId, {
  razorpayPaymentId,
  razorpaySignature,
} = {}) {
  const $set = {
    status: 'paid',
    paidAt: new Date(),
  };
  if (razorpayPaymentId) $set['razorpay.paymentId'] = razorpayPaymentId;
  if (razorpaySignature) $set['razorpay.signature'] = razorpaySignature;

  return FoodCheckoutSession.findOneAndUpdate(
    {
      _id: checkoutId,
      foodOrderId: null,
      status: { $in: ['pending_payment', 'paid'] },
    },
    { $set: { ...$set, status: 'finalizing' } },
    { new: true },
  );
}

export async function cancelCheckoutSession(checkoutId, userId) {
  const session = await getCheckoutSessionForUser(checkoutId, userId);
  if (session.status === 'completed') {
    throw new ValidationError('Cannot cancel a completed checkout');
  }
  if (['cancelled', 'expired', 'failed'].includes(session.status)) {
    return session;
  }
  session.status = 'cancelled';
  await session.save();
  return session;
}

/**
 * Webhook path: find pending/paid checkout by Razorpay order id.
 */
export async function findCheckoutByRazorpayOrderId(rzOrderId) {
  if (!rzOrderId) return null;
  return FoodCheckoutSession.findOne({
    'razorpay.orderId': String(rzOrderId),
    status: { $in: ['pending_payment', 'paid'] },
  });
}
