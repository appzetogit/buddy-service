import mongoose from 'mongoose';
import { QuickCheckoutSession } from '../models/quickCheckoutSession.model.js';
import { ValidationError, NotFoundError } from '../../../core/auth/errors.js';
import {
  createRazorpayOrder,
  verifyPaymentSignature,
  getRazorpayKeyId,
  isRazorpayConfigured,
  fetchRazorpayPayment,
  initiateRazorpayRefund,
} from '../../food/orders/helpers/razorpay.helper.js';
import { notifyOwnersSafely } from '../../food/orders/services/order.helpers.js';
import { logger } from '../../../utils/logger.js';

const CHECKOUT_TTL_MS = 30 * 60 * 1000; // 30 minutes, same as Food

export const isQuickCheckoutExpired = (session) =>
  !session?.expiresAt || new Date(session.expiresAt).getTime() <= Date.now();

/** Owner filter: the logged-in user, or the guest session that created the checkout. */
const ownerFilter = ({ userId = null, sessionId = '' } = {}) => {
  if (userId) return { userId: new mongoose.Types.ObjectId(String(userId)) };
  if (sessionId) return { sessionId: String(sessionId) };
  return null;
};

/** Create the session + Razorpay order for an online checkout. No QuickOrder yet. */
export async function createQuickCheckoutSession({ idQuery, requestBody, amountDue }) {
  if (!isRazorpayConfigured()) throw new ValidationError('Online payment is not configured');

  const amountPaise = Math.round(Number(amountDue || 0) * 100);
  if (amountPaise < 100) throw new ValidationError('Amount too low for online payment');

  const session = new QuickCheckoutSession({
    userId: idQuery?.userId ? new mongoose.Types.ObjectId(String(idQuery.userId)) : null,
    sessionId: idQuery?.userId ? '' : String(idQuery?.sessionId || ''),
    status: 'pending_payment',
    requestBody,
    amountDue: Number(amountDue),
    expiresAt: new Date(Date.now() + CHECKOUT_TTL_MS),
  });

  const rzOrder = await createRazorpayOrder(amountPaise, 'INR', `qchk_${session._id.toString()}`);
  session.razorpay = {
    orderId: rzOrder.id,
    paymentId: '',
    signature: '',
    amountPaise: rzOrder.amount || amountPaise,
  };
  await session.save();

  return {
    checkoutId: String(session._id),
    razorpay: {
      key: getRazorpayKeyId(),
      orderId: rzOrder.id,
      amount: rzOrder.amount || amountPaise,
      currency: rzOrder.currency || 'INR',
    },
    expiresAt: session.expiresAt,
  };
}

export async function getQuickCheckoutForOwner(checkoutId, idQuery) {
  if (!checkoutId || !mongoose.Types.ObjectId.isValid(checkoutId)) {
    throw new ValidationError('Valid checkoutId required');
  }
  const owner = ownerFilter(idQuery);
  if (!owner) throw new ValidationError('sessionId or userId is required');
  const session = await QuickCheckoutSession.findOne({ _id: checkoutId, kind: 'quick', ...owner });
  if (!session) throw new NotFoundError('Checkout session not found');
  return session;
}

/** Signature + gateway check (amount, captured/authorized) against the session. */
export async function verifyQuickCheckoutPayment(session, { razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  if (!session) throw new NotFoundError('Checkout session not found');
  if (session.status === 'completed' && session.quickOrderId) return { alreadyCompleted: true, session };
  if (session.status === 'finalizing') return { alreadyCompleted: Boolean(session.quickOrderId), session };
  if (['cancelled', 'failed'].includes(session.status)) {
    throw new ValidationError('Checkout session is no longer valid');
  }
  if (isQuickCheckoutExpired(session) && session.status === 'pending_payment') {
    session.status = 'expired';
    await session.save();
    throw new ValidationError('Checkout session expired. Please place the order again.');
  }
  if (String(session.razorpay?.orderId || '') !== String(razorpayOrderId || '')) {
    throw new ValidationError('Payment order mismatch');
  }
  if (!verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    throw new ValidationError('Payment verification failed');
  }

  let gatewayPayment = null;
  try {
    gatewayPayment = await fetchRazorpayPayment(razorpayPaymentId);
  } catch (err) {
    logger.warn(`[QuickCheckout] fetchRazorpayPayment failed: ${err?.message || err}`);
    throw new ValidationError('Unable to verify payment with gateway');
  }
  const paidPaise = Number(gatewayPayment?.amount || 0);
  const expectedPaise = Number(session.razorpay?.amountPaise || Math.round(session.amountDue * 100));
  if (paidPaise !== expectedPaise) throw new ValidationError('Paid amount does not match order total');
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

/** Only one path (client verify or webhook) gets to create the order. */
export async function claimQuickCheckoutForOrderCreate(checkoutId, { razorpayPaymentId, razorpaySignature } = {}) {
  const $set = { status: 'finalizing', paidAt: new Date() };
  if (razorpayPaymentId) $set['razorpay.paymentId'] = razorpayPaymentId;
  if (razorpaySignature) $set['razorpay.signature'] = razorpaySignature;
  return QuickCheckoutSession.findOneAndUpdate(
    { _id: checkoutId, kind: 'quick', quickOrderId: null, status: { $in: ['pending_payment', 'paid'] } },
    { $set },
    { new: true },
  );
}

export async function markQuickCheckoutCompleted(session, quickOrderId) {
  session.status = 'completed';
  session.quickOrderId = quickOrderId;
  session.completedAt = new Date();
  await session.save();
  return session;
}

export async function cancelQuickCheckoutSession(checkoutId, idQuery) {
  const session = await getQuickCheckoutForOwner(checkoutId, idQuery);
  if (session.status === 'completed') throw new ValidationError('Cannot cancel a completed checkout');
  if (['cancelled', 'expired', 'failed'].includes(session.status)) return session;
  session.status = 'cancelled';
  await session.save();
  return session;
}

export async function findQuickCheckoutByRazorpayOrderId(rzOrderId) {
  if (!rzOrderId) return null;
  return QuickCheckoutSession.findOne({
    kind: 'quick',
    'razorpay.orderId': String(rzOrderId),
    status: { $in: ['pending_payment', 'paid'] },
  });
}

/**
 * The customer money was captured but no order could be created (stock gone, price changed,
 * session expired). Never keep money for an order that will not exist: refund and tell admin.
 */
export async function refundFailedQuickCheckout(session, reason) {
  const paymentId = session?.razorpay?.paymentId;
  let refundedOk = false;
  try {
    if (paymentId) {
      const refund = await initiateRazorpayRefund(paymentId, Number(session.amountDue || 0));
      refundedOk = Boolean(refund?.success);
      logger.warn(
        `[QuickCheckout] ${session._id} could not become an order (${reason}). Auto-refund ${refundedOk ? 'initiated' : 'FAILED'}: ${refund?.refundId || refund?.error}`,
      );
    }
  } catch (err) {
    logger.error(`CRITICAL: quick checkout ${session._id} paid (${paymentId}) and auto-refund threw: ${err.message}. Manual refund required.`);
  }
  session.status = 'failed';
  session.failureReason = String(reason || 'Order could not be created').slice(0, 300);
  await session.save();
  void notifyOwnersSafely([{ ownerType: 'ADMIN', ownerId: 'GLOBAL' }], {
    title: refundedOk ? 'Quick checkout auto-refunded' : 'Quick checkout refund FAILED',
    body: `Payment ${paymentId} (Rs ${session.amountDue}) could not become an order: ${reason}.`,
    data: { type: 'quick_checkout_refund', checkoutId: String(session._id), paymentId: String(paymentId || '') },
  }).catch(() => {});
  return refundedOk;
}
