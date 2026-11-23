import mongoose from 'mongoose';
import { FoodOrder } from '../models/order.model.js';
import * as userWalletService from '../../user/services/userWallet.service.js';
import { notifyOwnersSafely } from './order.helpers.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Food: cash on delivery with an advance (shared rules: modules/common/cod).
 * The advance is refunded to the customer's WALLET (never the gateway) when the order is cancelled.
 */
const CANCELLED = ['cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin', 'rejected_by_restaurant'];
const money = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Refund the advance of one cancelled order to the wallet. Idempotent: the order is claimed atomically
 * ('paid' -> 'refunding'), so two callers (cancel handler + sweep) can never both refund.
 * @returns {Promise<number>} the amount refunded now (0 when nothing to do)
 */
export async function refundFoodCodAdvance(orderId, { reason = 'Order cancelled' } = {}) {
  const claimed = await FoodOrder.collection.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId(String(orderId)), 'payment.cod.advanceStatus': 'paid', orderStatus: { $in: CANCELLED } },
    { $set: { 'payment.cod.advanceStatus': 'refunding' } },
    { returnDocument: 'after' },
  );
  const order = claimed?.value !== undefined ? claimed.value : claimed;
  if (!order) return 0;

  const amount = money(order.payment?.cod?.advanceAmount);
  try {
    if (amount > 0) {
      await userWalletService.refundWalletBalance(
        order.userId,
        amount,
        `Advance refund for cancelled order #${order.order_id || order._id}`,
        { orderId: order._id, source: 'cod_advance_refund' },
      );
    }
    await FoodOrder.collection.updateOne(
      { _id: order._id },
      {
        $set: {
          'payment.cod.advanceStatus': 'refunded',
          'payment.cod.refundedAmount': amount,
          'payment.cod.refundedAt': new Date(),
          'payment.refund': { status: 'processed', destination: 'wallet', amount, processedAt: new Date() },
        },
      },
    );
    void notifyOwnersSafely([{ ownerType: 'USER', ownerId: order.userId }], {
      title: 'Advance refunded to wallet',
      body: `Rs ${amount} paid in advance for order #${order.order_id || order._id} has been added to your wallet. ${reason}`,
      data: { type: 'cod_advance_refund', orderId: String(order._id), amount: String(amount) },
    }).catch(() => {});
    return amount;
  } catch (err) {
    // Put it back so the sweep retries; nothing was credited.
    await FoodOrder.collection.updateOne({ _id: order._id, 'payment.cod.advanceStatus': 'refunding' }, { $set: { 'payment.cod.advanceStatus': 'paid' } });
    logger.warn(`[FoodCod] advance refund failed for ${order._id}: ${err?.message || err}`);
    return 0;
  }
}

/** Safety net: any cancelled order (whatever path cancelled it) that still holds an advance gets it refunded. */
export async function sweepFoodCodAdvanceRefunds() {
  const rows = await FoodOrder.collection
    .find({ 'payment.cod.advanceStatus': 'paid', orderStatus: { $in: CANCELLED } })
    .project({ _id: 1 })
    .limit(50)
    .toArray();
  let total = 0;
  for (const row of rows) total += await refundFoodCodAdvance(row._id);
  if (rows.length) logger.info(`[FoodCod] advance refund sweep handled ${rows.length} order(s), Rs ${total}.`);
  return total;
}

/** The rider collected the remaining cash: remember how much and when. */
export async function recordFoodCodCollected(orderId, amount) {
  await FoodOrder.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(String(orderId)), 'payment.cod.enabled': true },
    { $set: { 'payment.cod.collectedAmount': money(amount), 'payment.cod.collectedAt': new Date() } },
  );
}
