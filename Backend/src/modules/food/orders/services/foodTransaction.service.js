import { FoodTransaction } from '../models/foodTransaction.model.js';
import { FoodRestaurantCommission } from '../../admin/models/restaurantCommission.model.js';
import mongoose from 'mongoose';

const RESTAURANT_COMMISSION_CACHE_MS = 60 * 1000;
let restaurantCommissionRulesCache = null;
let restaurantCommissionRulesLoadedAt = 0;

async function getActiveRestaurantCommissionRules() {
  const now = Date.now();
  if (
    restaurantCommissionRulesCache &&
    now - restaurantCommissionRulesLoadedAt < RESTAURANT_COMMISSION_CACHE_MS
  ) {
    return restaurantCommissionRulesCache;
  }

  const list = await FoodRestaurantCommission.find({
    status: { $ne: false },
  }).lean();
  restaurantCommissionRulesCache = list || [];
  restaurantCommissionRulesLoadedAt = now;
  return restaurantCommissionRulesCache;
}

export function computeRestaurantCommissionAmount(baseAmount, rule) {
  const safeBase = Math.max(0, Number(baseAmount) || 0);
  if (!Number.isFinite(safeBase) || safeBase < 0) return 0;

  const commissionType = rule?.defaultCommission?.type || 'percentage';
  const commissionValue = Math.max(
    0,
    Number(rule?.defaultCommission?.value ?? 0) || 0
  );

  let commissionAmount = 0;
  if (commissionType === 'percentage') {
    commissionAmount = safeBase * (commissionValue / 100);
  } else if (commissionType === 'amount') {
    commissionAmount = commissionValue;
  }

  // Round to 2 decimals and clamp to [0, base]
  commissionAmount = Math.round((commissionAmount || 0) * 100) / 100;
  commissionAmount = Math.max(0, Math.min(commissionAmount, safeBase));

  return { commissionAmount, commissionType, commissionValue, baseAmount: safeBase };
}

export async function getRestaurantCommissionSnapshot(orderDoc) {
  const baseAmount = Number(orderDoc?.pricing?.subtotal ?? 0) || 0;
  const restaurantIdRaw =
    orderDoc?.restaurantId?._id ?? orderDoc?.restaurantId ?? null;

  if (!restaurantIdRaw) {
    return {
      commissionAmount: 0,
      commissionType: 'percentage',
      commissionValue: 0,
      baseAmount,
    };
  }

  const rules = await getActiveRestaurantCommissionRules();
  const rule =
    rules.find((r) => String(r.restaurantId) === String(restaurantIdRaw)) ||
    // Fallback: accept legacy docs where restaurantId may be stored under `restaurant` / `restaurant_id`
    rules.find((r) => String(r.restaurant || r.restaurant_id || '') === String(restaurantIdRaw)) ||
    null;

  if (!rule) {
    return {
      commissionAmount: 0,
      commissionType: 'percentage',
      commissionValue: 0,
      baseAmount,
    };
  }

  return computeRestaurantCommissionAmount(baseAmount, rule);
}

function buildPaymentSnapshot(order) {
  return {
    method: String(order.payment?.method || 'cash'),
    status: String(order.payment?.status || 'cod_pending'),
    amountDue: Number(order.payment?.amountDue ?? order.pricing?.total ?? 0) || 0,
    razorpay: {
      orderId: String(order.payment?.razorpay?.orderId || ''),
      paymentId: String(order.payment?.razorpay?.paymentId || ''),
      signature: String(order.payment?.razorpay?.signature || ''),
    },
    qr: {
      qrId: String(order.payment?.qr?.qrId || ''),
      imageUrl: String(order.payment?.qr?.imageUrl || ''),
      paymentLinkId: String(order.payment?.qr?.paymentLinkId || ''),
      shortUrl: String(order.payment?.qr?.shortUrl || ''),
      status: String(order.payment?.qr?.status || ''),
      expiresAt: order.payment?.qr?.expiresAt || null,
    },
  };
}

function resolveSettlementRows(order) {
  const settlements = Array.isArray(order.restaurantSettlement) ? order.restaurantSettlement : [];
  if (settlements.length > 0) return settlements;
  if (order.restaurantId) {
    return [
      {
        restaurantId: order.restaurantId,
        foodAmount: Number(order.pricing?.subtotal) || 0,
        packagingFee: Number(order.pricing?.packagingFee) || 0,
        commission: Number(order.pricing?.restaurantCommission) || 0,
        restaurantPayout: null,
      },
    ];
  }
  return [];
}

/**
 * Creates initial transaction row(s) when an order is created.
 * Multi-restaurant: one FoodTransaction per restaurantSettlement row so each
 * restaurant only sees/earns its own share. Platform/rider amounts live only on
 * the primary (order.restaurantId) row to avoid double-counting admin reports.
 */
export async function createInitialTransaction(order) {
  const { commissionAmount } = await getRestaurantCommissionSnapshot(order);

  const totalCustomerPaid = order.pricing?.total || 0;
  const riderShare = order.riderEarning || 0;
  const restaurantCommissionFromOrder = Number(order.pricing?.restaurantCommission);
  const orderLevelCommission =
    Number.isFinite(restaurantCommissionFromOrder) && restaurantCommissionFromOrder > 0
      ? restaurantCommissionFromOrder
      : (commissionAmount || 0);

  const discount = Number(order.pricing?.discount || 0) || 0;
  const platformSubsidy = Number(order.pricing?.platformSubsidy || 0) || 0;
  const couponCreatedBy = order.pricing?.couponCreatedBy || null;
  const isRestaurantCoupon = couponCreatedBy === 'restaurant';
  const speedShareRestaurant = Math.max(
    0,
    Number(order.pricing?.deliveryFeeBreakdown?.speedShareRestaurant) || 0,
  );

  const platformNetProfit = Number(
    (
      order.platformProfit ??
      (
        (order.pricing?.platformFee || 0) +
        (order.pricing?.deliveryFee || 0) +
        orderLevelCommission -
        riderShare -
        speedShareRestaurant -
        (isRestaurantCoupon ? 0 : discount) -
        platformSubsidy
      )
    ).toFixed(2),
  );

  const settlements = resolveSettlementRows(order);
  const primaryRid = String(order.restaurantId?._id || order.restaurantId || '');
  const paymentSnapshot = buildPaymentSnapshot(order);
  const paymentMethod = order.payment?.method || 'cash';
  const status = order.payment?.status === 'paid' ? 'captured' : 'pending';

  const rows = [];
  for (const settlement of settlements) {
    const rid = settlement.restaurantId?._id || settlement.restaurantId;
    if (!rid) continue;
    const isPrimary = String(rid) === primaryRid || (settlements.length === 1);
    const commission = Number(settlement.commission);
    const restaurantCommission = Number.isFinite(commission)
      ? commission
      : (isPrimary ? orderLevelCommission : 0);

    let restaurantNet = Number(settlement.restaurantPayout);
    if (!Number.isFinite(restaurantNet)) {
      restaurantNet = Number(
        (
          (Number(settlement.foodAmount) || 0) +
          (Number(settlement.packagingFee) || 0) +
          (isPrimary ? speedShareRestaurant : 0) -
          restaurantCommission -
          (isPrimary && isRestaurantCoupon ? discount : 0)
        ).toFixed(2),
      );
    }
    restaurantNet = Math.max(0, restaurantNet);

    const foodAmount = Number(settlement.foodAmount) || 0;
    const packagingFee = Number(settlement.packagingFee) || 0;
    const rowCustomerPaid = isPrimary
      ? totalCustomerPaid
      : Math.max(0, Number((foodAmount + packagingFee).toFixed(2)));

    rows.push(
      new FoodTransaction({
        orderId: order._id,
        userId: order.userId,
        restaurantId: rid,
        isPrimary,
        deliveryPartnerId: order.dispatch?.deliveryPartnerId,
        paymentMethod,
        status,
        payment: paymentSnapshot,
        pricing: {
          subtotal: isPrimary ? (Number(order.pricing?.subtotal || 0) || 0) : foodAmount,
          tax: isPrimary ? (Number(order.pricing?.tax || 0) || 0) : 0,
          packagingFee: isPrimary
            ? (Number(order.pricing?.packagingFee || 0) || 0)
            : packagingFee,
          deliveryFee: isPrimary ? (Number(order.pricing?.deliveryFee || 0) || 0) : 0,
          platformFee: isPrimary ? (Number(order.pricing?.platformFee || 0) || 0) : 0,
          restaurantCommission,
          discount: isPrimary ? (Number(order.pricing?.discount || 0) || 0) : 0,
          total: isPrimary ? (Number(order.pricing?.total || 0) || 0) : rowCustomerPaid,
          currency: String(order.pricing?.currency || order.currency || 'INR'),
        },
        amounts: {
          totalCustomerPaid: rowCustomerPaid,
          restaurantShare: restaurantNet,
          restaurantCommission,
          riderShare: isPrimary ? riderShare : 0,
          primaryRiderShare: isPrimary ? (order.riderEarning || riderShare) : 0,
          sharedRiderShare: isPrimary ? (order.sharedRiderEarning || 0) : 0,
          platformNetProfit: isPrimary ? platformNetProfit : 0,
          taxAmount: isPrimary ? (Number(order.pricing?.tax || 0) || 0) : 0,
        },
        gateway: {
          razorpayOrderId: order.payment?.razorpay?.orderId,
          qrUrl: order.payment?.qr?.imageUrl,
        },
        history: [
          {
            kind: 'created',
            amount: rowCustomerPaid,
            note: isPrimary
              ? 'Initial transaction created with order'
              : 'Per-restaurant transaction for multi-restaurant order',
          },
        ],
      }),
    );
  }

  if (rows.length === 0) {
    throw new Error('Unable to create food transaction: no restaurant settlement');
  }

  if (!rows.some((r) => r.isPrimary)) {
    rows[0].isPrimary = true;
  }

  const saved = await FoodTransaction.insertMany(rows);
  const primaryTx =
    saved.find((t) => t.isPrimary) ||
    saved.find((t) => String(t.restaurantId) === primaryRid) ||
    saved[0];

  try {
    await mongoose.model('FoodOrder').updateOne(
      { _id: order._id },
      { $set: { transactionId: primaryTx._id } },
    );
  } catch (err) {
    // Log but don't fail transaction if the backlink fails
  }

  return primaryTx;
}

/**
 * Updates all transaction rows for an order (captured, settled, etc).
 */
export async function updateTransactionStatus(orderId, kind, details = {}) {
  const transactions = await FoodTransaction.find({ orderId });
  if (!transactions.length) return null;

  for (const transaction of transactions) {
    if (details.status) transaction.status = details.status;
    if (details.razorpayPaymentId) {
      transaction.gateway = transaction.gateway || {};
      transaction.gateway.razorpayPaymentId = details.razorpayPaymentId;
    }
    if (details.razorpaySignature) {
      transaction.gateway = transaction.gateway || {};
      transaction.gateway.razorpaySignature = details.razorpaySignature;
    }

    if (details.paymentMethod) {
      transaction.paymentMethod = details.paymentMethod;
      transaction.payment = transaction.payment || {};
      transaction.payment.method = details.paymentMethod;
    }

    if (details.sharedPartnerId && transaction.isPrimary) {
      transaction.sharedPartnerId = details.sharedPartnerId;
    }

    if (details.primaryRiderShare !== undefined && transaction.isPrimary) {
      transaction.amounts.primaryRiderShare = details.primaryRiderShare;
    }

    if (details.sharedRiderShare !== undefined && transaction.isPrimary) {
      transaction.amounts.sharedRiderShare = details.sharedRiderShare;
    }

    transaction.history.push({
      kind,
      amount: transaction.amounts.totalCustomerPaid,
      at: new Date(),
      note: details.note || `Transaction updated: ${kind}`,
      recordedBy: { role: details.recordedByRole || 'SYSTEM', id: details.recordedById },
    });

    await transaction.save();
  }

  if (details.paymentMethod || details.status) {
    try {
      const updateFields = {};
      if (details.paymentMethod) updateFields['payment.method'] = details.paymentMethod;
      if (details.status === 'captured') updateFields['payment.status'] = 'paid';

      await mongoose.model('FoodOrder').updateOne(
        { _id: orderId },
        { $set: updateFields },
      );
    } catch (err) {
      console.error('Failed to sync transaction status to order:', err.message);
    }
  }

  return transactions.find((t) => t.isPrimary) || transactions[0];
}

/**
 * Updates the rider on all transaction rows when an order is accepted.
 */
export async function updateTransactionRider(orderId, riderId) {
  await FoodTransaction.updateMany(
    { orderId },
    { $set: { deliveryPartnerId: riderId } },
  );
  return FoodTransaction.findOne({ orderId, isPrimary: true }) ||
    FoodTransaction.findOne({ orderId });
}

/**
 * Void / mark refunded the transaction row for a dropped restaurant in a multi-resto order.
 * Reassigns isPrimary to another remaining row when needed.
 */
export async function voidRestaurantTransaction(orderId, restaurantId, note = '') {
  const rid = String(restaurantId || '');
  if (!rid || !orderId) return null;

  const tx = await FoodTransaction.findOne({
    orderId,
    restaurantId: mongoose.Types.ObjectId.isValid(rid)
      ? new mongoose.Types.ObjectId(rid)
      : rid,
  });
  if (!tx) {
    // Legacy single-tx multi-resto: reduce primary share by dropped restaurant amount if possible
    return null;
  }

  const wasPrimary = Boolean(tx.isPrimary);
  tx.status = 'refunded';
  tx.amounts.restaurantShare = 0;
  tx.history.push({
    kind: 'refunded',
    amount: 0,
    at: new Date(),
    note: note || 'Restaurant dropped from multi-restaurant order',
    recordedBy: { role: 'SYSTEM' },
  });
  tx.isPrimary = false;
  await tx.save();

  if (wasPrimary) {
    const nextPrimary = await FoodTransaction.findOne({
      orderId,
      restaurantId: { $ne: rid },
      status: { $nin: ['refunded', 'failed'] },
    }).sort({ createdAt: 1 });
    if (nextPrimary) {
      nextPrimary.isPrimary = true;
      await nextPrimary.save();
      try {
        await mongoose.model('FoodOrder').updateOne(
          { _id: orderId },
          { $set: { transactionId: nextPrimary._id } },
        );
      } catch (err) {
        // ignore backlink failure
      }
    }
  }

  return tx;
}

/**
 * Marks restaurant as settled in the finance record.
 */
export async function settleRestaurant(orderId, adminId) {
  return await updateTransactionStatus(orderId, 'settled', {
    status: 'captured', // Ensure it's marked as captured if it was pending cash
    note: 'Restaurant payout settled by admin',
    recordedByRole: 'ADMIN',
    recordedById: adminId,
  });
}
