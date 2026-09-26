import mongoose from 'mongoose';
import { FoodOrder } from '../models/order.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodTransaction } from '../models/foodTransaction.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { FoodDeliveryCashDeposit } from '../../delivery/models/foodDeliveryCashDeposit.model.js';
import { FoodDeliveryWithdrawal } from '../../delivery/models/foodDeliveryWithdrawal.model.js';
import { DeliveryBonusTransaction } from '../../admin/models/deliveryBonusTransaction.model.js';
import { FoodDeliveryCashLimit } from '../../admin/models/deliveryCashLimit.model.js';
import { FoodDeliveryBoySettings } from '../../admin/models/deliveryBoySettings.model.js';
import {
  ValidationError,
  ForbiddenError,
  NotFoundError,
} from '../../../../core/auth/errors.js';
import { buildPaginatedResult, buildPaginationOptions } from '../../../../utils/helpers.js';
import { logger } from '../../../../utils/logger.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { getFirebaseDB } from '../../../../config/firebase.js';
import {
  fetchRazorpayPaymentLink,
  isRazorpayConfigured,
} from '../helpers/razorpay.helper.js';
import { fetchPolyline } from '../utils/googleMaps.js';
import * as foodTransactionService from './foodTransaction.service.js';
import * as dispatchService from './order-dispatch.service.js';
import {
  isActivePickup,
  assertCanShareSecondDriver,
  isShareRequired,
  isSharedDriverJoined,
  pushSettlementSnapshot,
  canOrderTransition,
  getNextPickup,
  getPickupProgress,
  isDualLegActive,
  ensureDualLegs,
  getLegForPartner,
  getNextPickupForLeg,
  getActiveLegs,
  areAllLegsDelivered,
  getLegProgress,
  getPendingLegHandoverOtps,
  toPartnerId,
} from './order-lifecycle.policy.js';
import {
  buildOrderIdentityFilter,
  buildRestaurantScopedOrder,
  emitDeliveryDropOtpToUser,
  enqueueOrderEvent,
  generateFourDigitDeliveryOtp,
  notifyOwnerSafely,
  notifyOwnersSafely,
  notifyRestaurantNewOrder,
  pushStatusHistory,
  sanitizeOrderForExternal,
  isStatusAdvance,
  resolveRiderPayoutAmount,
  SHARE_TIMEOUT_MS,
  PICKUP_GEOFENCE_METERS,
  DROP_GEOFENCE_METERS,
  RIDER_LOCATION_STALE_MS,
  applyEmploymentAwareDualEarnings,
} from './order.helpers.js';
import { haversineMeters } from '../../../../core/location/haversine.util.js';

/**
 * Server-side anti-spoof geofence for "reached pickup" / "reached drop".
 *
 * The rider's freshest location lives in Redis (hot path); the Mongo copy can lag ~30s, so this
 * check FAILS OPEN whenever the location is missing or stale — legitimate riders are never
 * blocked. It only rejects gross spoofing (marking arrived from far away) when we have a fresh
 * fix. `targetCoords` is GeoJSON order `[lng, lat]`.
 *
 * @throws {ValidationError} when a fresh rider fix is clearly outside the geofence radius.
 */
async function assertRiderAtTarget(deliveryPartnerId, targetCoords, limitMeters, label) {
  if (!Array.isArray(targetCoords) || targetCoords.length < 2) return; // no target → skip
  const targetLng = Number(targetCoords[0]);
  const targetLat = Number(targetCoords[1]);
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) return;

  let partner = null;
  try {
    partner = await FoodDeliveryPartner.findById(deliveryPartnerId)
      .select('lastLat lastLng lastLocationAt')
      .lean();
  } catch {
    return; // fail-open on lookup error
  }

  const lat = Number(partner?.lastLat);
  const lng = Number(partner?.lastLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return; // no fix → fail-open

  const fixAgeMs = partner?.lastLocationAt
    ? Date.now() - new Date(partner.lastLocationAt).getTime()
    : Infinity;
  if (!(fixAgeMs <= RIDER_LOCATION_STALE_MS)) return; // stale → fail-open

  const distanceMeters = haversineMeters(lat, lng, targetLat, targetLng);
  if (Number.isFinite(distanceMeters) && distanceMeters > limitMeters) {
    throw new ValidationError(
      `You appear to be ${Math.round(distanceMeters)}m from the ${label}. Move closer to mark ${label} reached.`,
    );
  }
}

function normalizeOtpValue(value) {
  return String(value ?? '').replace(/\D/g, '').trim();
}

function isOtpMatch(expectedOtp, enteredOtp) {
  const expected = normalizeOtpValue(expectedOtp);
  const entered = normalizeOtpValue(enteredOtp);
  if (!expected || !entered) return false;
  if (entered === expected) return true;

  // Accept last 4 digits if client sends prefixed/padded OTP.
  if (expected.length === 4 && entered.length > 4) {
    return entered.slice(-4) === expected;
  }

  return false;
}

async function getPartnerCashCapacity(deliveryPartnerId) {
  const partnerObjectId = new mongoose.Types.ObjectId(deliveryPartnerId);
  const limitDoc = await FoodDeliveryCashLimit.findOne({ isActive: true })
    .sort({ createdAt: -1 })
    .lean();

  const totalCashLimit = Number(limitDoc?.deliveryCashLimit || 0);
  if (!Number.isFinite(totalCashLimit) || totalCashLimit <= 0) {
    return {
      totalCashLimit: 0,
      cashInHand: 0,
      availableCashLimit: Number.MAX_SAFE_INTEGER,
      hasCapacity: true,
    };
  }

  const [ordersAgg, cashAgg, bonusAgg, depositsAgg, withdrawalsAgg] = await Promise.all([
    // 1. Earnings aggregation
    FoodOrder.aggregate([
      {
        $match: {
          $and: [
            {
              $or: [
                { 'dispatch.deliveryPartnerId': partnerObjectId },
                { 'dispatch.sharedPartnerId': partnerObjectId }
              ]
            },
            { orderStatus: 'delivered' }
          ]
        }
      },
      {
        $group: {
          _id: null,
          totalEarned: {
            $sum: {
              $cond: [
                { $eq: ["$dispatch.deliveryPartnerId", partnerObjectId] },
                {
                  $ifNull: [
                    "$riderEarning",
                    {
                      $ifNull: [
                        "$pricing.deliveryFeeBreakdown.riderFee",
                        {
                          $ifNull: [
                            "$settlementBreakdown.driver.payout",
                            { $ifNull: ["$pricing.deliveryFeeBreakdown.deliveryBoyFee", 0] },
                          ],
                        },
                      ],
                    },
                  ],
                },
                { $ifNull: ["$sharedRiderEarning", 0] }
              ]
            }
          }
        }
      }
    ]),
    // 2. Cash aggregation (Active orders included)
    FoodOrder.aggregate([
      {
        $match: {
          $and: [
            {
              $or: [
                { 'dispatch.deliveryPartnerId': partnerObjectId },
                { 'dispatch.sharedPartnerId': partnerObjectId }
              ]
            },
            {
              orderStatus: {
                $in: [
                  'confirmed', 'preparing', 'ready_for_pickup', 'reached_pickup', 'picked_up', 'reached_drop', 'delivered', 'completed',
                  'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'REACHED_PICKUP', 'PICKED_UP', 'REACHED_DROP', 'DELIVERED', 'COMPLETED'
                ]
              }
            },
            {
              $or: [
                { 'payment.method': { $in: ['cash', 'cod', 'CASH', 'COD'] } },
                { 'paymentMethod': { $in: ['cash', 'cod', 'CASH', 'COD'] } },
                {
                  $and: [
                    { 'payment.method': { $exists: false } },
                    { 'paymentMethod': { $exists: false } }
                  ]
                }
              ]
            }
          ]
        }
      },
      {
        $group: {
          _id: null,
          actualCashCollected: {
            $sum: {
              $cond: [
                { $in: ["$orderStatus", ["delivered", "completed", "DELIVERED", "COMPLETED"]] },
                {
                  $cond: [
                    { $gt: [{ $ifNull: ["$amountToCollect", 0] }, 0] },
                    "$amountToCollect",
                    {
                      $cond: [
                        { $gt: [{ $ifNull: ["$payment.amountDue", 0] }, 0] },
                        "$payment.amountDue",
                        { $ifNull: ["$pricing.total", { $ifNull: ["$totalAmount", 0] }] }
                      ]
                    }
                  ]
                },
                0
              ]
            }
          },
          pendingCashLiability: {
            $sum: {
              $cond: [
                { $not: { $in: ["$orderStatus", ["delivered", "completed", "DELIVERED", "COMPLETED"]] } },
                {
                  $cond: [
                    { $gt: [{ $ifNull: ["$amountToCollect", 0] }, 0] },
                    "$amountToCollect",
                    {
                      $cond: [
                        { $gt: [{ $ifNull: ["$payment.amountDue", 0] }, 0] },
                        "$payment.amountDue",
                        { $ifNull: ["$pricing.total", { $ifNull: ["$totalAmount", 0] }] }
                      ]
                    }
                  ]
                },
                0
              ]
            }
          }
        }
      }
    ]),
    // 3. Bonuses
    DeliveryBonusTransaction.aggregate([
      { $match: { deliveryPartnerId: partnerObjectId, status: 'credited' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]),
    // 4. Deposits
    FoodDeliveryCashDeposit.aggregate([
      { $match: { deliveryPartnerId: partnerObjectId, status: 'Completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]),
    // 5. Withdrawals
    FoodDeliveryWithdrawal.aggregate([
      { $match: { deliveryPartnerId: partnerObjectId, status: { $in: ['pending', 'approved', 'processed'] } } },
      { $group: { _id: '$status', total: { $sum: '$amount' } } }
    ]),
  ]);

  const totalEarned = Number(ordersAgg[0]?.totalEarned || 0);
  const totalBonus = Number(bonusAgg[0]?.total || 0);
  const actualCashCollected = Number(cashAgg[0]?.actualCashCollected || 0);
  const pendingCashLiability = Number(cashAgg[0]?.pendingCashLiability || 0);
  const depositedCash = Number(depositsAgg[0]?.total || 0);

  const withdrawalsMap = (withdrawalsAgg || []).reduce((acc, curr) => {
    acc[curr._id] = curr.total;
    return acc;
  }, {});
  const totalWithdrawn = Number(withdrawalsMap['approved'] || 0) + Number(withdrawalsMap['processed'] || 0);
  const pendingWithdrawals = Number(withdrawalsMap['pending'] || 0);

  const rawEarningsBalance = Math.max(0, totalEarned + totalBonus - (totalWithdrawn + pendingWithdrawals));
  const actualCashInHand = Math.max(0, actualCashCollected - depositedCash);

  const amountSubstituted = Math.min(rawEarningsBalance, actualCashInHand);
  const netCashInHand = actualCashInHand - amountSubstituted;

  const totalCurrentLiability = netCashInHand + pendingCashLiability;
  const availableCashLimit = Math.max(0, totalCashLimit - totalCurrentLiability);

  return {
    totalCashLimit,
    cashInHand: actualCashInHand, // Return Gross for UI transparency
    availableCashLimit,
    hasCapacity: availableCashLimit > 0,
    pocketBalance: rawEarningsBalance - amountSubstituted,
    amountSubstituted
  };
}

function emitOrderUpdate(order, deliveryPartnerId, options = {}) {
  const shouldSendMilestonePush = options?.sendMilestonePush !== false;
  try {
    const io = getIO();
    if (io) {
      const dv =
        order.deliveryVerification?.toObject?.() || order.deliveryVerification;
      // Never broadcast secret OTPs. Presence + otpVerified only.
      const publicLegs = Array.isArray(order.legs)
        ? order.legs.map((leg) => {
            const { otp, ...rest } = leg?.toObject?.() || leg || {};
            return { ...rest, hasOtp: Boolean(otp), otpVerified: Boolean(rest.otpVerified) };
          })
        : [];
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        orderStatus: order.orderStatus,
        deliveryState: order.deliveryState,
        deliveryVerification: dv,
        pickups: order.pickups || [],
        pickupProgress: getPickupProgress(order),
        isDualLeg: isDualLegActive(order),
        legs: publicLegs,
        legProgress: getLegProgress(order),
        dispatch: order.dispatch || null,
        isMultiRestaurant: Boolean(order.isMultiRestaurant),
      };
      const riderIds = [
        deliveryPartnerId,
        order.dispatch?.deliveryPartnerId,
        order.dispatch?.sharedPartnerId,
      ]
        .filter(Boolean)
        .map((id) => toPartnerId(id))
        .filter(Boolean);
      for (const riderId of [...new Set(riderIds)]) {
        io.to(rooms.delivery(riderId)).emit('order_status_update', payload);
      }
      const pickupRestaurantIds = Array.isArray(order.pickups)
        ? [...new Set(order.pickups.map((p) => String(p?.restaurantId || '')).filter(Boolean))]
        : [];
      const targetRestaurants = pickupRestaurantIds.length
        ? pickupRestaurantIds
        : [order.restaurantId].filter(Boolean).map((id) => String(id));

      for (const rid of targetRestaurants) {
        io.to(rooms.restaurant(rid)).emit('order_status_update', payload);
      }
      io.to(rooms.user(order.userId)).emit('order_status_update', payload);
    }

    // Only send push notifications for key delivery milestones when explicitly allowed.
    if (!shouldSendMilestonePush) return;

    // Only send push notifications for key delivery milestones
    const status = order.orderStatus;
    if (!['picked_up', 'reached_drop', 'delivered'].includes(status)) return;

    let userTitle = '';
    let userBody = '';
    let riderTitle = '';
    let riderBody = '';

    const orderId = order._id.toString();

    if (status === 'picked_up') {
      userTitle = 'Order on the way!';
      userBody = `Partner has picked up your order #${orderId} and is heading your way.`;
      riderTitle = 'Order picked up!';
      riderBody = `You have picked up order #${orderId}. Proceed to the customer location.`;
    } else if (status === 'reached_drop') {
      userTitle = 'Partner nearby!';
      userBody = `Your delivery partner has reached your location for order #${orderId}.`;
      riderTitle = 'Arrived at drop!';
      riderBody = `You have reached the customer location for order #${orderId}.`;
    } else if (status === 'delivered') {
      userTitle = `Order #${orderId} delivered!`;
      userBody = 'Hope you enjoyed your meal! Don\'t forget to rate your experience.';
      riderTitle = 'Delivery successful!';
      riderBody = `Order #${orderId} has been successfully delivered.`;

      if (order.payment?.method === 'cash' || order.paymentMethod === 'cash') {
        riderTitle = 'Payment collected!';
        const amt = order.pricing?.total || order.amounts?.totalCustomerPaid || 0;
        riderBody = `You have collected Rs ${amt} cash for Order #${orderId}.`;
      }
    }

    if (userTitle) {
      void notifyOwnerSafely(
        { ownerType: 'USER', ownerId: order.userId },
        {
          title: userTitle,
          body: userBody,
          dataOnly: true,
          data: {
            type: 'order_status_update',
            orderId,
            orderMongoId: order._id?.toString?.() || '',
            orderStatus: status,
          },
        },
      );
    }

    if (riderTitle) {
      void notifyOwnerSafely(
        { ownerType: 'DELIVERY_PARTNER', ownerId: deliveryPartnerId },
        {
          title: riderTitle,
          body: riderBody,
          dataOnly: true,
          data: {
            type: status === 'delivered' ? 'order_completed' : 'order_status_update',
            orderId,
            orderMongoId: order._id?.toString?.() || '',
            paymentMethod: order.payment?.method || order.paymentMethod,
            amountCollected: String(order.pricing?.total || order.amounts?.totalCustomerPaid || 0),
          },
        },
      );
    }
  } catch (error) {
    logger.error(`Error emitting delivery order update: ${error?.message || error}`);
  }
}

async function syncRazorpayQrPayment(orderDoc) {
  // Phase 2: FoodTransaction is source of truth; avoid relying on FoodOrder.payment.
  const tx = await FoodTransaction.findOne({ orderId: orderDoc?._id }).lean();
  const payment = tx?.payment || orderDoc?.payment || null;
  if (!payment) return null;
  if (payment.method !== 'razorpay_qr') return payment;
  if (payment.status === 'paid') return payment;

  const paymentLinkId = payment?.qr?.paymentLinkId;
  if (!paymentLinkId || !isRazorpayConfigured()) return payment;

  let link;
  try {
    link = await fetchRazorpayPaymentLink(paymentLinkId);
  } catch (error) {
    logger.warn(
      `Razorpay payment-link fetch failed for ${paymentLinkId}: ${error?.message || error
      }`,
    );
    return orderDoc.payment;
  }

  const linkStatus = String(link?.status || '').toLowerCase();
  if (!linkStatus) return orderDoc.payment;

  await FoodTransaction.updateOne(
    { orderId: orderDoc?._id },
    {
      $set: {
        'payment.qr.status': linkStatus,
        'payment.status': ['paid', 'captured', 'authorized'].includes(linkStatus)
          ? 'paid'
          : ['expired', 'cancelled', 'canceled', 'failed'].includes(linkStatus)
            ? 'failed'
            : (payment.status || 'pending_qr'),
      },
    },
  );

  const updatedTx = await FoodTransaction.findOne({ orderId: orderDoc?._id }).lean();
  return updatedTx?.payment || payment;
}

export async function getCurrentTripDelivery(deliveryPartnerId) {
  if (!deliveryPartnerId) {
    throw new ValidationError('Delivery partner ID required');
  }

  const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
  let order = await FoodOrder.findOne({
    $or: [
      { 'dispatch.deliveryPartnerId': partnerId },
      { 'dispatch.sharedPartnerId': partnerId }
    ],
    'dispatch.status': 'accepted',
    orderStatus: {
      $in: [
        'created',
        'accepted',
        'confirmed',
        'preparing',
        'ready_for_pickup',
        'reached_pickup',
        'picked_up',
        'reached_drop',
      ],
    },
  })
    .populate({
      path: 'restaurantId',
      select: 'restaurantName name phone location addressLine1 area city state profileImage',
    })
    .populate({ path: 'userId', select: 'name phone' })
    .populate({ path: 'dispatch.deliveryPartnerId', select: 'name fullName phone phoneNumber profileImage' })
    .populate({ path: 'dispatch.sharedPartnerId', select: 'name fullName phone phoneNumber profileImage' })
    .sort({ updatedAt: -1 })
    .lean();

  if (!order) {
    const Order = mongoose.model('Order');
    const qcOrder = await Order.findOne({
      $or: [
        { 'dispatch.deliveryPartnerId': partnerId },
        { 'deliveryBoy': partnerId }
      ],
      workflowStatus: {
        $in: ['DELIVERY_ASSIGNED', 'PICKUP_READY', 'OUT_FOR_DELIVERY'],
      },
    })
      .populate({
        path: 'seller',
        select: 'shopName name phone location address city state profileImage',
      })
      .populate({ path: 'customer', select: 'name phone' })
      .populate({ path: 'dispatch.deliveryPartnerId', select: 'name fullName phone phoneNumber profileImage' })
      .populate({ path: 'deliveryBoy', select: 'name fullName phone phoneNumber profileImage' })
      .sort({ updatedAt: -1 })
      .lean();

    if (qcOrder) {
      order = {
        ...qcOrder,
        _id: qcOrder._id,
        orderId: qcOrder.orderId,
        orderStatus: qcOrder.workflowStatus === 'OUT_FOR_DELIVERY' ? 'picked_up' : (qcOrder.workflowStatus === 'PICKUP_READY' ? 'ready_for_pickup' : 'confirmed'),
        restaurantId: {
          ...qcOrder.seller,
          restaurantName: qcOrder.seller?.shopName || qcOrder.seller?.name,
        },
        userId: qcOrder.customer,
        deliveryAddress: {
          addressLine1: qcOrder.address?.address,
          landmark: qcOrder.address?.landmark,
          location: {
            type: 'Point',
            coordinates: qcOrder.address?.location ? [qcOrder.address.location.lng, qcOrder.address.location.lat] : []
          }
        },
        paymentMethod: qcOrder.paymentMode === 'ONLINE' ? 'online' : 'cash',
        pricing: qcOrder.pricing,
        deliveryState: {
          currentPhase: qcOrder.workflowStatus === 'OUT_FOR_DELIVERY' ? 'en_route_to_delivery' : (qcOrder.workflowStatus === 'PICKUP_READY' ? 'at_pickup' : 'en_route_to_pickup'),
          status: qcOrder.workflowStatus === 'OUT_FOR_DELIVERY' ? 'picked_up' : (qcOrder.workflowStatus === 'PICKUP_READY' ? 'reached_pickup' : 'accepted'),
        },
        deliveryVerification: {
          dropOtp: {
            required: true,
            verified: !!qcOrder.otpValidatedAt
          }
        }
      };
    }
  }

  if (!order) return null;
  const tx = await FoodTransaction.findOne({ orderId: order._id }).lean();
  const out = sanitizeOrderForExternal(order);
  if (tx) {
    out.paymentMethod = tx.payment?.method || tx.paymentMethod || out.paymentMethod;
    out.payment = tx.payment || out.payment;
    out.pricing = tx.pricing || out.pricing;
    out.amounts = tx.amounts || out.amounts;
    out.transactionStatus = tx.status || out.transactionStatus;
  }
  return out;
}

export async function listOrdersAvailableDelivery(deliveryPartnerId, query) {
  const { page, limit, skip } = buildPaginationOptions(query);
  const partnerCapacity = await getPartnerCashCapacity(deliveryPartnerId);
  const cashLimit = {
    blocked: !partnerCapacity.hasCapacity,
    message: !partnerCapacity.hasCapacity
      ? 'Please deposit your amount to get new orders.'
      : '',
    totalCashLimit: Number(partnerCapacity.totalCashLimit || 0),
    cashInHand: Number(partnerCapacity.cashInHand || 0),
    availableCashLimit: Number(partnerCapacity.availableCashLimit || 0),
  };

  const activeOwnOrderFilter = {
    $or: [
      { 'dispatch.deliveryPartnerId': new mongoose.Types.ObjectId(deliveryPartnerId) },
      { 'dispatch.sharedPartnerId': new mongoose.Types.ObjectId(deliveryPartnerId) }
    ],
    orderStatus: {
      $nin: [
        'delivered',
        'cancelled_by_user',
        'cancelled_by_restaurant',
        'cancelled_by_admin',
      ],
    },
  };

  const shareableFilter = {
    'dispatch.isShared': true,
    'dispatch.sharedPartnerId': null,
    'dispatch.deliveryPartnerId': { $ne: new mongoose.Types.ObjectId(deliveryPartnerId) },
    orderStatus: { $in: ['confirmed', 'preparing', 'ready_for_pickup', 'reached_pickup', 'picked_up'] },
  };

  const filter = partnerCapacity.hasCapacity
    ? {
      $or: [
        {
          'dispatch.status': 'unassigned',
          orderStatus: { $in: ['confirmed', 'preparing', 'ready_for_pickup'] },
        },
        shareableFilter,
        activeOwnOrderFilter,
      ],
    }
    : activeOwnOrderFilter;

  const [docs, total] = await Promise.all([
    FoodOrder.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'name phone email')
      .populate(
        'restaurantId',
        'restaurantName name address phone ownerPhone location profileImage',
      )
      .populate('zoneId', 'name zoneName')
      .lean(),
    FoodOrder.countDocuments(filter),
  ]);

  const orderIds = (docs || []).map((d) => d?._id).filter(Boolean);
  const txRows = orderIds.length
    ? await FoodTransaction.find({ orderId: { $in: orderIds } }).lean()
    : [];
  const txByOrderId = new Map(txRows.map((t) => [String(t.orderId), t]));

  const partner = await FoodDeliveryPartner.findById(deliveryPartnerId)
    .select('employmentType')
    .lean();
  const employmentType = partner?.employmentType || 'per_order';
  const isSalaryPartner = employmentType === 'salary';
  const earningDisplayMode = isSalaryPartner ? 'salary' : 'per_order';

  const enriched = (docs || []).map((doc) => {
    const tx = txByOrderId.get(String(doc?._id)) || null;
    const pricing = tx?.pricing || doc.pricing;
    const orderForPayout = {
      ...doc,
      pricing,
      riderEarning: isSalaryPartner ? 0 : doc?.riderEarning,
    };
    const riderEarning = isSalaryPartner
      ? 0
      : resolveRiderPayoutAmount(orderForPayout);
    const base = tx
      ? {
        ...doc,
        paymentMethod: tx.payment?.method || tx.paymentMethod || doc.paymentMethod,
        payment: tx.payment || doc.payment,
        pricing,
        amounts: tx.amounts || doc.amounts,
        transactionStatus: tx.status || doc.transactionStatus,
      }
      : { ...doc, pricing };
    return {
      ...base,
      riderEarning,
      earnings: riderEarning,
      deliveryBoyFee: Number(pricing?.deliveryFeeBreakdown?.deliveryBoyFee ?? riderEarning) || 0,
      employmentType,
      earningDisplayMode,
    };
  });

  return {
    ...buildPaginatedResult({ docs: enriched, total, page, limit }),
    cashLimit,
  };
}

export async function acceptOrderDelivery(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);

  let existingOrder = await FoodOrder.findOne(identity)
    .select('pricing payment dispatch orderStatus riderEarning platformProfit settlementBreakdown')
    .lean();

  if (!existingOrder) {
    const Order = mongoose.model('Order');
    const qcOrder = await Order.findOne(identity).populate('customer');
    if (qcOrder) {
      const now = new Date();
      qcOrder.dispatch = qcOrder.dispatch || {};
      qcOrder.dispatch.deliveryPartnerId = partnerId;
      qcOrder.dispatch.acceptedAt = now;
      qcOrder.dispatch.assignedAt = qcOrder.dispatch.assignedAt || now;
      qcOrder.dispatch.status = 'accepted';
      qcOrder.deliveryBoy = partnerId;
      qcOrder.deliveryPartner = partnerId;
      qcOrder.workflowStatus = 'DELIVERY_ASSIGNED';

      const isUnified = process.env.ENABLE_UNIFIED_QC_DISPATCH === 'true';
      if (isUnified) {
        qcOrder.status = 'pending';
      } else {
        qcOrder.status = 'confirmed';
      }
      await qcOrder.save();

      try {
        const io = getIO();
        if (io) {
          const payload = {
            orderId: qcOrder.orderId,
            status: isUnified ? 'pending' : 'confirmed',
            workflowStatus: 'DELIVERY_ASSIGNED',
            at: now.toISOString()
          };
          io.to(`order:${qcOrder.orderId}`).emit('order:status:update', payload);
          const cid = qcOrder.customer?._id || qcOrder.customer;
          if (cid) {
            io.to(`customer:${cid.toString()}`).emit('order:status:update', payload);
          }
          const claimedPayload = {
            orderId: qcOrder.orderId,
            claimedBy: deliveryPartnerId.toString()
          };
          io.to('all_delivery').emit('order_claimed', claimedPayload);

          if (isUnified && qcOrder.seller) {
            const roomName = `seller:${qcOrder.seller.toString()}`;
            const emitPayload = {
              orderId: qcOrder.orderId,
              workflowStatus: 'DELIVERY_ASSIGNED',
            };
            io.to(roomName).emit('order:new', emitPayload);
          }
        }
      } catch (err) {
        console.warn('[acceptOrderDelivery] QC socket emit failed:', err.message);
      }

      return {
        _id: qcOrder._id,
        orderId: qcOrder.orderId,
        orderStatus: isUnified ? 'pending' : 'confirmed',
        dispatch: {
          status: 'accepted',
          deliveryPartnerId: partnerId,
          acceptedAt: now
        }
      };
    }
    throw new NotFoundError('Order not found');
  }

  const paymentMethod = String(existingOrder?.payment?.method || 'cash').toLowerCase();
  const isCashOrder = paymentMethod === 'cash';
  const orderAmount = Math.max(0, Number(existingOrder?.pricing?.total || 0));
  const offeredEntry = (existingOrder?.dispatch?.offeredTo || []).find(
    (entry) => String(entry?.partnerId || '') === String(deliveryPartnerId),
  );
  const canBypassCashLimit = Boolean(offeredEntry?.allowOverLimit);

  const partnerCapacity = await getPartnerCashCapacity(deliveryPartnerId);
  const hasAmountCapacity = Number(partnerCapacity.availableCashLimit || 0) >= orderAmount;

  // Cash-in-hand only gates CASH orders. COD is disabled at order creation, so gating prepaid /
  // wallet orders on it merely punished riders holding historical cash with a nonsensical
  // "Cash limit reached" error on an order that involves no cash at all.
  if (isCashOrder && !canBypassCashLimit) {
    if (!hasAmountCapacity) {
      throw new ValidationError('Cash limit is not enough for this order amount. Please deposit your amount to get orders.');
    }
    if (!partnerCapacity.hasCapacity) {
      throw new ValidationError('Cash limit reached. Please deposit your amount to get orders.');
    }
  }

  const now = new Date();
  const acceptedStatuses = ['created', 'confirmed', 'preparing', 'ready_for_pickup', 'picked_up'];
  const cancellableStatuses = [
    'cancelled_by_user',
    'cancelled_by_restaurant',
    'cancelled_by_admin',
  ];

  const statusHistoryEntry = {
    byRole: 'DELIVERY_PARTNER',
    byId: partnerId,
    from: 'dispatchable',
    to: 'accepted',
    note: 'Delivery partner accepted order',
    at: now,
  };

  const deliveryPartner = await FoodDeliveryPartner.findById(partnerId).lean();

  const isSalary = deliveryPartner?.employmentType === 'salary';
  const baseRiderEarning = Number(existingOrder.riderEarning) || 0;

  // Per-order: keep frozen Delivery Boy Fee (+ speed share). Salary: no order-level earning.
  // Admin commission % removed from food accept path.
  const finalRiderEarning = isSalary ? 0 : baseRiderEarning;

  const basePlatformProfit = Number(existingOrder.platformProfit) || 0;
  const earningDifference = baseRiderEarning - finalRiderEarning;
  const newPlatformProfit = Number((basePlatformProfit + earningDifference).toFixed(2));

  const existingBreakdown = existingOrder.settlementBreakdown && typeof existingOrder.settlementBreakdown === 'object'
    ? existingOrder.settlementBreakdown
    : null;
  const nextSettlementBreakdown = existingBreakdown
    ? {
      ...existingBreakdown,
      driver: {
        ...(existingBreakdown.driver || {}),
        payout: finalRiderEarning,
        employmentType: isSalary ? 'salary' : (deliveryPartner?.employmentType || 'per_order'),
        note: isSalary
          ? 'Partner is on salary; order-level rider earning is ₹0'
          : (existingBreakdown.driver?.note || 'Per-order Delivery Boy Fee'),
      },
      platform: {
        ...(existingBreakdown.platform || {}),
        netProfit: newPlatformProfit,
        salaryReclaim: isSalary ? baseRiderEarning : 0,
      },
      ...(isSalary
        ? {
          costBearers: [
            ...((existingBreakdown.costBearers || []).filter(
              (c) => String(c?.type || '') !== 'salary_reclaim',
            )),
            {
              type: 'salary_reclaim',
              bearer: 'admin',
              amount: baseRiderEarning,
              note: 'Salary partner — delivery charge retained by admin (no per-order rider payout)',
            },
          ],
        }
        : {}),
    }
    : undefined;

  const nextDriverSettlement = existingOrder.driverSettlement && typeof existingOrder.driverSettlement === 'object'
    ? {
      ...existingOrder.driverSettlement,
      driverPayout: finalRiderEarning,
      deliveryFee: isSalary
        ? Number(existingOrder.pricing?.deliveryFee || 0) || 0
        : existingOrder.driverSettlement.deliveryFee,
    }
    : undefined;

  const order = await FoodOrder.findOneAndUpdate(
    {
      ...identity,
      orderStatus: { $in: acceptedStatuses },
      $or: [
        { 'dispatch.status': 'unassigned' },
        {
          'dispatch.status': 'assigned',
          'dispatch.deliveryPartnerId': partnerId,
        },
        {
          'dispatch.status': 'offered',
          'dispatch.offeredTo': {
            $elemMatch: {
              partnerId,
              action: 'offered',
            },
          },
        },
      ],
    },
    {
      $set: {
        'dispatch.deliveryPartnerId': partnerId,
        'dispatch.status': 'accepted',
        'dispatch.assignedAt': now,
        'dispatch.acceptedAt': now,
        riderEarning: finalRiderEarning,
        platformProfit: newPlatformProfit,
        ...(nextSettlementBreakdown ? { settlementBreakdown: nextSettlementBreakdown } : {}),
        ...(nextDriverSettlement ? { driverSettlement: nextDriverSettlement } : {}),
        'dispatch.offeredTo.$[acceptedOffer].action': 'accepted',
      },
      $push: {
        statusHistory: statusHistoryEntry,
      },
    },
    {
      new: true,
      arrayFilters: [
        {
          'acceptedOffer.partnerId': partnerId,
          'acceptedOffer.action': 'offered',
        },
      ],
    },
  ).populate('restaurantId userId');

  if (!order) {
    const existing = await FoodOrder.findOne(identity)
      .select('orderStatus dispatch')
      .lean();

    if (!existing) throw new NotFoundError('Order not found');
    if (cancellableStatuses.includes(existing.orderStatus)) {
      throw new ValidationError('Order was cancelled');
    }
    if (existing.orderStatus === 'delivered') {
      throw new ValidationError('Order already delivered');
    }
    if (!acceptedStatuses.includes(existing.orderStatus)) {
      throw new ValidationError('Order not ready for delivery assignment');
    }
    if (
      existing.dispatch?.status === 'accepted' &&
      String(existing.dispatch?.deliveryPartnerId || '') === String(deliveryPartnerId)
    ) {
      const acceptedOrder = await FoodOrder.findOne(identity)
        .populate('restaurantId userId');
      return acceptedOrder
        ? sanitizeOrderForExternal(acceptedOrder)
        : null;
    }
    if (
      existing.dispatch?.status === 'accepted' &&
      String(existing.dispatch?.deliveryPartnerId || '') !== String(deliveryPartnerId)
    ) {
      throw new ForbiddenError('Order already accepted by another partner');
    }

    if (existing.dispatch?.status === 'offered') {
      const wasOffered = (existing.dispatch?.offeredTo || []).some(
        (entry) =>
          String(entry?.partnerId || '') === String(deliveryPartnerId) &&
          entry?.action === 'offered',
      );
      if (!wasOffered) {
        throw new ValidationError('This order was offered to other delivery partners');
      }
    }

    throw new ValidationError('Order is no longer available to accept');
  }

  const responseOrder = sanitizeOrderForExternal(order);

  // Settlement snapshot only — bulk/split second-driver search is opt-in via
  // "Find new driver" after the primary assesses the load at pickup.
  try {
    pushSettlementSnapshot(
      order,
      'accept',
      `Rider accepted; riderEarning=₹${Number(order.riderEarning) || 0}`,
    );
    await order.save();
  } catch (acceptErr) {
    logger.warn(`Accept settlement snapshot failed: ${acceptErr?.message || acceptErr}`);
  }

  void (async () => {
    try {
      const rest = order.restaurantId;
      const userLoc = order.deliveryAddress?.location?.coordinates;
      const restLoc = rest?.location?.coordinates;

      if (restLoc?.[0] && userLoc?.[0]) {
        const polyline = await fetchPolyline(
          { lat: restLoc[1], lng: restLoc[0] },
          { lat: userLoc[1], lng: userLoc[0] },
        );

        const db = getFirebaseDB();
        if (db) {
          const orderRef = db.ref(`active_orders/${order._id.toString()}`);
          await orderRef
            .set({
              polyline,
              lat: restLoc[1],
              lng: restLoc[0],
              boy_lat: restLoc[1],
              boy_lng: restLoc[0],
              restaurant_lat: restLoc[1],
              restaurant_lng: restLoc[0],
              customer_lat: userLoc[1],
              customer_lng: userLoc[0],
              status: 'accepted',
              last_updated: Date.now(),
            })
            .catch((error) =>
              logger.error(`Firebase orderRef set error: ${error.message}`),
            );
        }
      }
    } catch (error) {
      logger.error(
        `Error initializing Firebase order tracking: ${error?.message || error}`,
      );
    }

    try {
      await foodTransactionService.updateTransactionRider(order._id, deliveryPartnerId);
    } catch (error) {
      logger.error(
        `Error updating delivery rider transaction for ${order._id}: ${error?.message || error
        }`,
      );
    }

    try {
      const io = getIO();
      const restaurantIdStr =
        order.restaurantId?._id?.toString?.() ||
        order.restaurantId?.toString?.() ||
        String(order.restaurantId || '');
      const userIdStr =
        order.userId?._id?.toString?.() ||
        order.userId?.toString?.() ||
        String(order.userId || '');

      if (io) {
        const basePayload = {
          orderMongoId: order._id?.toString?.(),
          orderId: order.order_id || order._id.toString(),
          orderStatus: order.orderStatus,
          status: order.orderStatus,
          dispatchStatus: order.dispatch?.status,
          dispatch: order.dispatch,
          pickups: order.pickups || [],
          deliveryState: order.deliveryState || null,
          isMultiRestaurant: Boolean(order.isMultiRestaurant),
        };
        io.to(rooms.delivery(deliveryPartnerId)).emit('order_status_update', basePayload);
        const sharedId = order.dispatch?.sharedPartnerId;
        if (sharedId) {
          io.to(rooms.delivery(sharedId)).emit('order_status_update', basePayload);
        }
        if (userIdStr) {
          io.to(rooms.user(userIdStr)).emit('order_status_update', basePayload);
        }

        // Notify EVERY active pickup restaurant with THEIR scoped status (not aggregate)
        const pickupRestaurantIdsForSocket = Array.isArray(order.pickups)
          ? [...new Set(
            order.pickups
              .filter((p) => isActivePickup(p))
              .map((p) => String(p?.restaurantId || ''))
              .filter(Boolean),
          )]
          : [];
        const restaurantTargets = pickupRestaurantIdsForSocket.length
          ? pickupRestaurantIdsForSocket
          : (restaurantIdStr ? [restaurantIdStr] : []);

        for (const rid of restaurantTargets) {
          const scoped = buildRestaurantScopedOrder(order, rid);
          io.to(rooms.restaurant(rid)).emit('order_status_update', {
            ...basePayload,
            orderStatus: scoped.orderStatus,
            status: scoped.status,
            myPickupStatus: scoped.myPickupStatus,
            restaurantId: rid,
          });
        }

        // Broadcast order_claimed to ALL online delivery partners so every popup is dismissed
        const claimedPayload = {
          orderId: order._id.toString(),
          orderMongoId: order._id?.toString?.(),
          claimedBy: deliveryPartnerId.toString(),
        };
        // 1. Global broadcast to all_delivery room — covers every online delivery boy
        io.to('all_delivery').emit('order_claimed', claimedPayload);
        logger.info(`[DeliveryDispatch] Broadcasted order_claimed globally (all_delivery room) for order ${order._id.toString()}`);

      }

      await notifyOwnerSafely(
        { ownerType: 'USER', ownerId: order.userId },
        {
          title: `Delivery partner assigned`,
          body: `A delivery partner has accepted Order #${order._id.toString()}.`,
          data: {
            type: 'delivery_accepted',
            orderId: order._id.toString(),
            orderMongoId: order._id?.toString?.() || '',
            dispatchStatus: order.dispatch?.status,
            link: '/food/user/orders',
          },
        },
      );

      const pickupRestaurantIds = Array.isArray(order.pickups)
        ? [...new Set(
          order.pickups
            .filter((p) => isActivePickup(p))
            .map((p) => String(p?.restaurantId || ''))
            .filter(Boolean),
        )]
        : [];

      // notifyRestaurantNewOrder already pushes the order with its details. A second
      // id-only push here re-rendered the restaurant app's order card blank.
      if (pickupRestaurantIds.length > 0) {
        for (const rid of pickupRestaurantIds) {
          await notifyRestaurantNewOrder(order, rid);
        }
      } else {
        await notifyRestaurantNewOrder(order);
      }
    } catch (error) {
      logger.error(
        `Error notifying delivery acceptance for ${order._id}: ${error?.message || error
        }`,
      );
    }
  })();

  enqueueOrderEvent('delivery_accepted', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    dispatchStatus: order.dispatch?.status,
    orderStatus: order.orderStatus,
  });

  return responseOrder;
}

/**
 * After accept, driver chooses visit order for active multi-restaurant pickups.
 * Body: ordered restaurantId[] covering every non-dropped pickup that is not yet picked_up.
 * Already picked_up stops keep their sequence and stay before remaining stops.
 */
export async function setPickupSequenceDelivery(
  orderId,
  deliveryPartnerId,
  restaurantIds = [],
) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity);
  if (!order) throw new NotFoundError('Order not found');

  const partnerId = String(deliveryPartnerId);
  const isPrimary =
    String(order.dispatch?.deliveryPartnerId || '') === partnerId;
  const isShared =
    String(order.dispatch?.sharedPartnerId || '') === partnerId;
  if (!isPrimary && !isShared) {
    throw new ForbiddenError('Not your order');
  }
  if (!order.dispatch?.deliveryPartnerId) {
    throw new ValidationError('Accept the order before setting pickup sequence');
  }

  const active = (order.pickups || []).filter(
    (p) => !p.permanentlyDropped && String(p.status || '') !== 'cancelled',
  );
  if (active.length < 2) {
    throw new ValidationError('Pickup sequence only applies to multi-restaurant orders');
  }

  const remaining = active.filter(
    (p) => String(p.status || '') !== 'picked_up',
  );
  if (remaining.length === 0) {
    throw new ValidationError('All restaurants already picked up');
  }

  const orderedIds = (Array.isArray(restaurantIds) ? restaurantIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  if (orderedIds.length !== remaining.length) {
    throw new ValidationError(
      `Provide exactly ${remaining.length} restaurant id(s) for remaining pickups`,
    );
  }

  const remainingById = new Map(
    remaining.map((p) => [String(p.restaurantId || ''), p]),
  );
  const seen = new Set();
  for (const rid of orderedIds) {
    if (seen.has(rid)) {
      throw new ValidationError('Duplicate restaurant in pickup sequence');
    }
    seen.add(rid);
    if (!remainingById.has(rid)) {
      throw new ValidationError(`Restaurant ${rid} is not an active remaining pickup`);
    }
  }

  const alreadyPicked = active
    .filter((p) => String(p.status || '') === 'picked_up')
    .sort((a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0));

  let seq = 0;
  for (const p of alreadyPicked) {
    p.sequence = seq++;
  }
  for (const rid of orderedIds) {
    remainingById.get(rid).sequence = seq++;
  }
  order.markModified('pickups');

  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from: order.orderStatus,
    to: order.orderStatus,
    note: `Driver set pickup sequence: ${orderedIds.join(' → ')}`,
  });

  await order.save();

  try {
    const io = getIO();
    if (io) {
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        orderStatus: order.orderStatus,
        pickups: order.pickups,
        type: 'pickup_sequence_updated',
        title: 'Pickup sequence updated',
        message: 'Driver updated restaurant visit order',
      };
      io.to(rooms.user(order.userId)).emit('order_status_update', payload);
      io.to(rooms.delivery(partnerId)).emit('order_status_update', payload);
      for (const p of active) {
        const rid = String(p.restaurantId || '');
        if (rid) io.to(rooms.restaurant(rid)).emit('order_status_update', payload);
      }
    }
  } catch (err) {
    logger.warn(`setPickupSequence socket emit failed: ${err?.message || err}`);
  }

  return sanitizeOrderForExternal(order);
}

export async function rejectOrderDelivery(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const isObjectId = mongoose.Types.ObjectId.isValid(orderId);
  let order = await FoodOrder.findOne(identity).select('+deliveryOtp');

  if (!order) {
    const Order = mongoose.model('Order');
    let qcOrder = await Order.findOne(identity);
    if (qcOrder) {
      const now = new Date();
      qcOrder.dispatch = qcOrder.dispatch || {};
      const offer = qcOrder.dispatch.offeredTo?.find(
        (item) => String(item.partnerId) === String(deliveryPartnerId) && item.action === 'offered'
      );
      if (offer) offer.action = 'rejected';

      qcOrder.dispatch.status = 'unassigned';
      qcOrder.dispatch.deliveryPartnerId = undefined;
      qcOrder.dispatch.assignedAt = undefined;
      qcOrder.dispatch.acceptedAt = undefined;

      qcOrder.dispatch.history = qcOrder.dispatch.history || [];
      qcOrder.dispatch.history.push({
        at: now,
        action: 'rejected',
        partnerId: new mongoose.Types.ObjectId(deliveryPartnerId),
        note: 'Rejected by rider'
      });

      await qcOrder.save();

      // Trigger rider search retry using Food dispatch engine
      void dispatchService
        .tryAutoAssign(qcOrder._id)
        .catch((error) =>
          logger.error(`SmartDispatch QC: Auto-assign after reject failed: ${error.message}`),
        );

      return { success: true, orderId: qcOrder.orderId };
    }
    throw new NotFoundError('Order not found');
  }

  const wasOffered = (order.dispatch?.offeredTo || []).some(
    (item) =>
      String(item.partnerId) === String(deliveryPartnerId) &&
      item.action === 'offered',
  );
  const isPrimary = order.dispatch?.deliveryPartnerId?.toString() === deliveryPartnerId.toString();
  const isShared = order.dispatch?.sharedPartnerId?.toString() === deliveryPartnerId.toString();
  if (!isPrimary && !isShared && !wasOffered) {
    throw new ForbiddenError('Not your order');
  }

  const offer = (order.dispatch?.offeredTo || []).find(
    (item) =>
      String(item.partnerId) === String(deliveryPartnerId) &&
      item.action === 'offered',
  );
  if (offer) offer.action = 'rejected';

  order.dispatch.status = 'unassigned';
  order.dispatch.deliveryPartnerId = undefined;
  order.dispatch.assignedAt = undefined;
  order.dispatch.acceptedAt = undefined;
  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from: 'assigned',
    to: 'unassigned',
    note: 'Rejected',
  });
  await order.save();

  enqueueOrderEvent('delivery_rejected', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
  });

  void dispatchService
    .tryAutoAssign(order._id)
    .catch((error) =>
      logger.error(`SmartDispatch: Auto-assign after reject failed: ${error.message}`),
    );

  return order.toObject();
}

export async function confirmReachedPickupDelivery(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  let order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  let isQcOrder = false;
  if (!order) {
    const Order = mongoose.model('Order');
    order = await Order.findOne(identity);
    if (!order) throw new NotFoundError('Order not found');
    isQcOrder = true;
  }

  if (isQcOrder) {
    const isPrimary = (order.dispatch?.deliveryPartnerId?.toString() === deliveryPartnerId.toString()) || (order.deliveryBoy?.toString() === deliveryPartnerId.toString());
    if (!isPrimary) {
      throw new ForbiddenError('Not your order');
    }
    if (order.workflowStatus === 'DELIVERED' || order.status === 'delivered') {
      throw new ValidationError('Order already delivered');
    }

    if (order.workflowStatus !== 'PICKUP_READY') {
      order.workflowStatus = 'PICKUP_READY';
      order.status = 'confirmed';
      order.orderStatus = 'confirmed';
      order.pickupReadyAt = new Date();
      order.deliveryRiderStep = 2;
      await order.save();

      try {
        const io = getIO();
        if (io) {
          const payload = {
            orderId: order.orderId,
            workflowStatus: 'PICKUP_READY',
            status: 'confirmed',
            at: new Date().toISOString()
          };
          io.to(`order:${order.orderId}`).emit('order:status:update', payload);
          const cid = order.customer?._id || order.customer;
          if (cid) {
            io.to(`customer:${cid.toString()}`).emit('order:status:update', payload);
          }
        }
      } catch (err) {
        console.warn('[confirmReachedPickupDelivery] QC socket emit failed:', err.message);
      }
    }
    return order.toObject();
  }

  const isPrimary = order.dispatch?.deliveryPartnerId?.toString() === deliveryPartnerId.toString();
  const isShared = order.dispatch?.sharedPartnerId?.toString() === deliveryPartnerId.toString();
  if (!isPrimary && !isShared) {
    throw new ForbiddenError('Not your order');
  }
  if (order.orderStatus === 'delivered') {
    throw new ValidationError('Order already delivered');
  }

  // Anti-spoof geofence against the stop the driver is actually due at (sequence-aware, and
  // scoped to this driver's own leg once the order is running dual-leg).
  ensureDualLegs(order, generateFourDigitDeliveryOtp);
  const callerLeg = isDualLegActive(order) ? getLegForPartner(order, deliveryPartnerId) : null;
  const nextStop = callerLeg ? getNextPickupForLeg(order, callerLeg) : getNextPickup(order);
  let pickupCoords = nextStop?.location?.coordinates || null;
  if (!pickupCoords) {
    const rest = await FoodRestaurant.findById(order.restaurantId).select('location').lean();
    pickupCoords = rest?.location?.coordinates || null;
  }
  await assertRiderAtTarget(deliveryPartnerId, pickupCoords, PICKUP_GEOFENCE_METERS, 'restaurant');

  // Waiting state: the driver arrived before the food was marked ready. Derived from the single
  // source of truth so single- and multi-restaurant orders are both handled correctly.
  const isWaitingForFood = getPickupProgress(order).isWaitingForFood;

  // Dual-leg: never short-circuit on parent phase — each driver must mark their own arrival.
  if (callerLeg) {
    if (['at_pickup', 'picked_up', 'at_drop', 'delivered'].includes(String(callerLeg.status || ''))) {
      emitOrderUpdate(order, deliveryPartnerId, { sendMilestonePush: false });
      return sanitizeOrderForExternal(order);
    }
    const from = order.deliveryState?.status || order.deliveryState?.currentPhase || order.orderStatus;
    callerLeg.status = 'at_pickup';
    callerLeg.reachedPickupAt = callerLeg.reachedPickupAt || new Date();
    order.markModified('legs');
    // Parent phase is informational only; trip UI derives from each driver's leg.
    if (!order.deliveryState?.reachedPickupAt) {
      order.deliveryState = {
        ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
        currentPhase: 'at_pickup',
        status: isWaitingForFood ? 'waiting_for_food' : 'reached_pickup',
        reachedPickupAt: new Date(),
      };
    }
    pushStatusHistory(order, {
      byRole: 'DELIVERY_PARTNER',
      byId: deliveryPartnerId,
      from,
      to: 'reached_pickup',
      note: isWaitingForFood
        ? `Leg ${callerLeg.legIndex} reached ${nextStop?.restaurantName || 'pickup'} — waiting for food`
        : `Leg ${callerLeg.legIndex} reached pickup (independent of partner)`,
    });
    await order.save();
    emitOrderUpdate(order, deliveryPartnerId);
    enqueueOrderEvent('leg_reached_pickup', {
      orderMongoId: order._id?.toString?.(),
      orderId: order._id.toString(),
      deliveryPartnerId,
      legIndex: callerLeg.legIndex,
      legProgress: getLegProgress(order),
    });
    return sanitizeOrderForExternal(order);
  }

  const currentPhase = order.deliveryState?.currentPhase || '';
  const currentStatus = order.deliveryState?.status || '';
  if (currentPhase === 'at_pickup' || currentStatus === 'reached_pickup') {
    return order.toObject();
  }

  const from = currentStatus || currentPhase || order.orderStatus;
  order.deliveryState = {
    ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
    currentPhase: 'at_pickup',
    status: isWaitingForFood ? 'waiting_for_food' : 'reached_pickup',
    reachedPickupAt: order.deliveryState?.reachedPickupAt || new Date(),
  };
  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from,
    to: 'reached_pickup',
    note: isWaitingForFood
      ? `Reached ${nextStop?.restaurantName || 'pickup'} — waiting for food to be ready`
      : 'Reached pickup location',
  });
  await order.save();

  emitOrderUpdate(order, deliveryPartnerId);

  try {
    const restaurant = await FoodRestaurant.findById(order.restaurantId)
      .select('restaurantName')
      .lean();
    const partner = await FoodDeliveryPartner.findById(deliveryPartnerId)
      .select('name')
      .lean();

    await notifyOwnersSafely(
      [{ ownerType: 'RESTAURANT', ownerId: order.restaurantId }],
      {
        title: 'Rider arrived!',
        body: `${partner?.name || 'The delivery partner'} has arrived at ${restaurant?.restaurantName || 'your restaurant'
          } to pick up Order #${order._id.toString()}.`,
        data: {
          type: 'rider_arrived',
          orderId: String(order._id.toString()),
          orderMongoId: String(order._id),
          partnerName: partner?.name || '',
        },
      },
    );
  } catch (error) {
    logger.error(
      `Error notifying restaurant about rider arrival for ${order._id}: ${error?.message || error
      }`,
    );
  }

  enqueueOrderEvent('reached_pickup', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    orderStatus: order.orderStatus,
    deliveryPhase: order.deliveryState?.currentPhase,
    deliveryStatus: order.deliveryState?.status,
    isWaitingForFood,
    pickupProgress: getPickupProgress(order),
  });
  return order.toObject();
}

export async function confirmPickupDelivery(orderId, deliveryPartnerId, billImageUrl) {
  const identity = buildOrderIdentityFilter(orderId);
  let order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  let isQcOrder = false;
  if (!order) {
    const Order = mongoose.model('Order');
    order = await Order.findOne(identity);
    if (!order) throw new NotFoundError('Order not found');
    isQcOrder = true;
  }

  if (isQcOrder) {
    const isPrimary = (order.dispatch?.deliveryPartnerId?.toString() === deliveryPartnerId.toString()) || (order.deliveryBoy?.toString() === deliveryPartnerId.toString());
    if (!isPrimary) {
      throw new ForbiddenError('Not your order');
    }

    const prePickup = ['DELIVERY_ASSIGNED', 'PICKUP_READY'];
    if (!prePickup.includes(order.workflowStatus)) {
      throw new ValidationError('Invalid state for pickup confirmation');
    }

    const now = new Date();
    order.workflowStatus = 'OUT_FOR_DELIVERY';
    order.status = 'out_for_delivery';
    order.orderStatus = 'out_for_delivery';
    order.pickupConfirmedAt = now;
    order.outForDeliveryAt = now;
    order.deliveryRiderStep = 3;
    await order.save();

    try {
      const io = getIO();
      if (io) {
        const payload = {
          orderId: order.orderId,
          workflowStatus: 'OUT_FOR_DELIVERY',
          status: 'out_for_delivery',
          at: now.toISOString()
        };
        io.to(`order:${order.orderId}`).emit('order:status:update', payload);
        const cid = order.customer?._id || order.customer;
        if (cid) {
          io.to(`customer:${cid.toString()}`).emit('order:status:update', payload);
        }
      }
    } catch (err) {
      console.warn('[confirmPickupDelivery] QC socket emit failed:', err.message);
    }
    return order.toObject();
  }

  const isPrimary = order.dispatch?.deliveryPartnerId?.toString() === deliveryPartnerId.toString();
  const isShared = order.dispatch?.sharedPartnerId?.toString() === deliveryPartnerId.toString();
  if (!isPrimary && !isShared) {
    throw new ForbiddenError('Not your order');
  }

  // Under dual-leg each driver collects their own leg; otherwise only the primary may confirm.
  ensureDualLegs(order, generateFourDigitDeliveryOtp);
  const pickupLeg = isDualLegActive(order) ? getLegForPartner(order, deliveryPartnerId) : null;
  if (isShared && !isPrimary && !pickupLeg) {
    throw new ForbiddenError('Only the primary partner can confirm order pickup.');
  }

  const from = order.orderStatus;
  const nextStatus = 'picked_up';

  // Handle Multi-Restaurant Pickup Logic
  if (order.isMultiRestaurant && Array.isArray(order.pickups) && order.pickups.length > 0) {
    // 1. Find the current pending pickup (first active one that isn't picked_up)
    // Sequence-aware, and scoped to this driver's own leg when running dual-leg.
    const currentPickup = pickupLeg
      ? getNextPickupForLeg(order, pickupLeg)
      : getNextPickup(order);

    // F-1C: a pickup can only be collected once that restaurant has marked its items ready.
    if (currentPickup && String(currentPickup.status || '') !== 'ready') {
      throw new ValidationError(
        `Cannot pick up from ${currentPickup.restaurantName || 'this restaurant'} until it marks the food ready.`,
      );
    }

    if (currentPickup) {
      currentPickup.status = 'picked_up';
      currentPickup.pickedAt = new Date();
      if (billImageUrl) currentPickup.billImageUrl = billImageUrl;
    }

    // This driver's leg is collected once none of ITS stops remain.
    if (pickupLeg && !getNextPickupForLeg(order, pickupLeg)) {
      pickupLeg.status = 'picked_up';
      pickupLeg.pickedAt = pickupLeg.pickedAt || new Date();
      order.markModified('legs');
    }

    // 2. All non-dropped pickups must be picked_up before leaving for drop
    const remaining = order.pickups.filter(
      (p) => !p.permanentlyDropped && String(p.status || '') !== 'cancelled',
    );
    const allPicked =
      remaining.length > 0 &&
      remaining.every((p) => String(p.status) === 'picked_up');

    if (allPicked) {
      // Final restaurant picked up - advance to delivery phase
      order.orderStatus = nextStatus;
      order.deliveryState = {
        ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
        currentPhase: 'en_route_to_delivery',
        status: 'picked_up',
        pickedUpAt: new Date(),
        billImageUrl,
      };
    } else {
      // More restaurants to visit — stay in pickup phase and require bill at next stop
      order.deliveryState = {
        ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
        currentPhase: 'en_route_to_pickup',
        status: 'ready_for_pickup',
        billImageUrl: null,
        lastPickupBillImageUrl: billImageUrl || null,
      };

      // We mark this history entry as a partial pickup
      pushStatusHistory(order, {
        byRole: 'DELIVERY_PARTNER',
        byId: deliveryPartnerId,
        from,
        to: 'ready_for_pickup',
        note: `Picked up items from ${currentPickup?.restaurantName || 'one restaurant'}. Heading to next pickup.`,
      });

      await order.save();
      emitOrderUpdate(order, deliveryPartnerId);
      // Intermediate leg is a real milestone ("picked up 1 of 2") — record it in the outbox
      // so the customer gets progress and a reconnecting client can replay it.
      enqueueOrderEvent('pickup_leg_completed', {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        deliveryPartnerId,
        restaurantId: String(currentPickup?.restaurantId || ''),
        restaurantName: currentPickup?.restaurantName || '',
        pickupProgress: getPickupProgress(order),
      });
      return order.toObject();
    }
  } else {
    // Single restaurant flow.
    // F-1C: pickup is only allowed once the restaurant has marked the order ready.
    if (from !== 'ready_for_pickup' && !pickupLeg) {
      throw new ValidationError(
        'You can only pick up the order after the restaurant marks it ready for pickup.',
      );
    }

    // Item-split dual-leg: both drivers collect from the same restaurant, so hold the parent
    // at ready_for_pickup until BOTH legs have been collected.
    if (pickupLeg) {
      if (from !== 'ready_for_pickup' && from !== 'picked_up') {
        throw new ValidationError(
          'You can only pick up the order after the restaurant marks it ready for pickup.',
        );
      }
      pickupLeg.status = 'picked_up';
      pickupLeg.pickedAt = pickupLeg.pickedAt || new Date();
      if (billImageUrl) order.deliveryState = {
        ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
        lastPickupBillImageUrl: billImageUrl,
      };
      order.markModified('legs');

      const allLegsCollected = getActiveLegs(order).every((leg) =>
        ['picked_up', 'at_drop', 'delivered'].includes(String(leg?.status || '')),
      );
      if (!allLegsCollected) {
        pushStatusHistory(order, {
          byRole: 'DELIVERY_PARTNER',
          byId: deliveryPartnerId,
          from,
          to: from,
          note: `Leg ${pickupLeg.legIndex} collected. Waiting for the other partner to collect their items.`,
        });
        await order.save();
        emitOrderUpdate(order, deliveryPartnerId);
        enqueueOrderEvent('leg_picked_up', {
          orderMongoId: order._id?.toString?.(),
          orderId: order._id.toString(),
          deliveryPartnerId,
          legIndex: pickupLeg.legIndex,
          legProgress: getLegProgress(order),
        });
        return order.toObject();
      }
    }

    if (!isStatusAdvance(from, nextStatus)) {
      throw new ValidationError(`Order is already at status '${from}'. Cannot re-mark as '${nextStatus}'.`);
    }
    order.orderStatus = nextStatus;
    // Keep single-restaurant pickup row in sync so restaurant-scoped reads see the handover.
    const soloPickup = (order.pickups || [])[0];
    if (soloPickup) {
      soloPickup.status = 'picked_up';
      soloPickup.pickedAt = soloPickup.pickedAt || new Date();
      if (billImageUrl) soloPickup.billImageUrl = billImageUrl;
    }
    order.deliveryState = {
      ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
      currentPhase: 'en_route_to_delivery',
      status: 'picked_up',
      pickedUpAt: new Date(),
      billImageUrl,
    };
  }

  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from,
    to: 'picked_up',
    note: 'Order picked up',
  });
  await order.save();

  emitOrderUpdate(order, deliveryPartnerId);
  enqueueOrderEvent('picked_up', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    billImageUrl: billImageUrl || null,
    pickupProgress: getPickupProgress(order),
  });
  return order.toObject();
}

export async function confirmReachedDropDelivery(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  let order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  let isQcOrder = false;
  if (!order) {
    const Order = mongoose.model('Order');
    order = await Order.findOne(identity);
    if (!order) throw new NotFoundError('Order not found');
    isQcOrder = true;
  }

  if (isQcOrder) {
    const isPrimary = (order.dispatch?.deliveryPartnerId?.toString() === deliveryPartnerId.toString()) || (order.deliveryBoy?.toString() === deliveryPartnerId.toString());
    if (!isPrimary) {
      throw new ForbiddenError('Not your order');
    }

    if (order.workflowStatus !== 'OUT_FOR_DELIVERY') {
      throw new ValidationError('Order not ready for OTP');
    }

    const OrderOtp = mongoose.model('OrderOtp');
    const code = String(Math.floor(1000 + Math.random() * 9000));
    const codeHash = OrderOtp.hashCode(code);
    const expiresAt = new Date(Date.now() + 300000); // 5 minutes

    await OrderOtp.deleteMany({ orderId: order.orderId, consumedAt: null });
    await OrderOtp.create({
      orderId: order.orderId,
      orderMongoId: order._id,
      codeHash,
      code,
      expiresAt,
      lastGeneratedAt: new Date()
    });

    order.deliveryRiderStep = 4;
    await order.save();

    try {
      const io = getIO();
      if (io) {
        const cid = order.customer?.toString();
        if (cid) {
          io.to(`customer:${cid}`).emit('order:otp', { orderId: order.orderId, code, expiresAt });
          io.to(`customer:${cid}`).emit('delivery:otp:generated', {
            orderId: order.orderId,
            otp: code,
            expiresAt,
            deliveryPersonNearby: true
          });
        }
        const payload = {
          orderId: order.orderId,
          otpSent: true,
          at: new Date().toISOString()
        };
        io.to(`order:${order.orderId}`).emit('order:status:update', payload);
      }
    } catch (err) {
      console.warn('[confirmReachedDropDelivery] QC socket emit failed:', err.message);
    }

    const resOrder = order.toObject();
    resOrder.deliveryVerification = {
      dropOtp: { required: true, verified: false }
    };
    return resOrder;
  }

  const isPrimary = toPartnerId(order.dispatch?.deliveryPartnerId) === toPartnerId(deliveryPartnerId);
  const isShared = toPartnerId(order.dispatch?.sharedPartnerId) === toPartnerId(deliveryPartnerId);
  if (!isPrimary && !isShared) {
    throw new ForbiddenError('Not your order');
  }

  // Repair dual-leg if second driver is present but legs were never built.
  ensureDualLegs(order, generateFourDigitDeliveryOtp);

  // Anti-spoof geofence: rider must be near the customer to request the drop OTP.
  await assertRiderAtTarget(
    deliveryPartnerId,
    order.deliveryAddress?.location?.coordinates || null,
    DROP_GEOFENCE_METERS,
    'delivery location',
  );

  // Dual-leg: each leg is verified independently with its OWN handover OTP.
  // Do NOT short-circuit on order-level dropOtp.verified — that flag is only for single-driver.
  if (isDualLegActive(order)) {
    const dropLeg = getLegForPartner(order, deliveryPartnerId);
    if (!dropLeg) {
      throw new ForbiddenError('No delivery leg assigned to you on this shared order');
    }
    if (dropLeg.otpVerified) {
      emitOrderUpdate(order, deliveryPartnerId, { sendMilestonePush: false });
      return sanitizeOrderForExternal(order);
    }
    if (!dropLeg.otp) dropLeg.otp = generateFourDigitDeliveryOtp();
    dropLeg.status = 'at_drop';
    dropLeg.reachedDropAt = dropLeg.reachedDropAt || new Date();
    order.markModified('legs');
    // Parent phase reflects "someone is at drop"; each leg still has its own OTP/status.
    order.deliveryState = {
      ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
      currentPhase: 'at_drop',
      status: 'reached_drop',
      reachedDropAt: order.deliveryState?.reachedDropAt || new Date(),
    };
    await order.save();

    const pendingLegOtps = getPendingLegHandoverOtps(order, { onlyAtDrop: false });

    emitDeliveryDropOtpToUser(order, String(dropLeg.otp || '').trim(), {
      legIndex: dropLeg.legIndex,
      role: dropLeg.role,
      partnerId: toPartnerId(deliveryPartnerId),
      isDualLeg: true,
      legOtps: pendingLegOtps,
    });
    emitOrderUpdate(order, deliveryPartnerId);
    enqueueOrderEvent('leg_reached_drop', {
      orderMongoId: order._id?.toString?.(),
      orderId: order._id.toString(),
      deliveryPartnerId,
      legIndex: dropLeg.legIndex,
      legProgress: getLegProgress(order),
    });
    return sanitizeOrderForExternal(order);
  }

  if (order.deliveryVerification?.dropOtp?.verified) {
    emitOrderUpdate(order, deliveryPartnerId);
    return sanitizeOrderForExternal(order);
  }

  const alreadyAtDrop =
    order.deliveryState?.currentPhase === 'at_drop' ||
    order.deliveryState?.status === 'reached_drop';
  const fromPhase =
    order.deliveryState?.status ||
    order.deliveryState?.currentPhase ||
    order.orderStatus ||
    '';

  const existingOtp = String(order.deliveryOtp || '').trim();

  // Idempotency: if already reached drop and OTP exists, avoid duplicate push notifications.
  if (alreadyAtDrop && existingOtp) {
    const hasDropOtpMeta = Boolean(order.deliveryVerification?.dropOtp);
    if (!hasDropOtpMeta) {
      order.deliveryVerification = {
        ...(order.deliveryVerification?.toObject?.() ||
          order.deliveryVerification ||
          {}),
        dropOtp: { required: true, verified: false },
      };
      await order.save();
    }
    // Rider explicitly requested OTP again at drop, re-emit same OTP without regenerating.
    emitDeliveryDropOtpToUser(order, existingOtp);
    return sanitizeOrderForExternal(order);
  }

  if (!existingOtp) {
    order.deliveryOtp = generateFourDigitDeliveryOtp();
  }

  if (!order.deliveryVerification?.dropOtp) {
    order.deliveryVerification = {
      ...(order.deliveryVerification?.toObject?.() ||
        order.deliveryVerification ||
        {}),
      dropOtp: { required: true, verified: false },
    };
  }

  order.deliveryState = {
    ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
    currentPhase: 'at_drop',
    status: 'reached_drop',
    reachedDropAt: order.deliveryState?.reachedDropAt || new Date(),
  };

  if (!alreadyAtDrop) {
    pushStatusHistory(order, {
      byRole: 'DELIVERY_PARTNER',
      byId: deliveryPartnerId,
      from: fromPhase,
      to: 'reached_drop',
      note: 'Reached drop location',
    });
  }

  await order.save();

  emitDeliveryDropOtpToUser(order, String(order.deliveryOtp || '').trim());
  emitOrderUpdate(order, deliveryPartnerId);
  enqueueOrderEvent('reached_drop', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    dropOtpRequired: order.deliveryVerification?.dropOtp?.required ?? true,
    dropOtpVerified: order.deliveryVerification?.dropOtp?.verified ?? false,
  });
  return sanitizeOrderForExternal(order);
}

export async function confirmSplitDelivery(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne(identity);
  if (!order) throw new NotFoundError('Order not found');

  const pid = order.dispatch?.deliveryPartnerId?.toString();
  const sid = order.dispatch?.sharedPartnerId?.toString();
  const currentId = deliveryPartnerId.toString();

  logger.info(`[confirmSplit] Order: ${orderId}, Partner: ${currentId}, Primary: ${pid}, Shared: ${sid}`);

  if (!sid) {
    throw new ValidationError('This is not a shared order, split not required.');
  }

  if (pid !== currentId) {
    throw new ForbiddenError('Only the primary partner can confirm the earnings split.');
  }

  if (order.deliveryState?.isSplitConfirmed) {
    return sanitizeOrderForExternal(order);
  }

  order.deliveryState = {
    ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
    isSplitConfirmed: true
  };

  await order.save();
  emitOrderUpdate(order, deliveryPartnerId);

  return sanitizeOrderForExternal(order);
}

export async function verifyDropOtpDelivery(orderId, deliveryPartnerId, otp) {
  const identity = buildOrderIdentityFilter(orderId);
  let order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  let isQcOrder = false;
  if (!order) {
    const Order = mongoose.model('Order');
    order = await Order.findOne(identity);
    if (!order) throw new NotFoundError('Order not found');
    isQcOrder = true;
  }

  if (isQcOrder) {
    const isPrimary = (order.dispatch?.deliveryPartnerId?.toString() === deliveryPartnerId.toString()) || (order.deliveryBoy?.toString() === deliveryPartnerId.toString());
    if (!isPrimary) {
      throw new ForbiddenError('Not your order');
    }

    if (order.workflowStatus !== 'OUT_FOR_DELIVERY') {
      throw new ValidationError('Invalid state for OTP verification');
    }

    const otpStr = String(otp || '').trim();
    if (!otpStr) throw new ValidationError('OTP is required');

    const OrderOtp = mongoose.model('OrderOtp');
    const otpDoc = await OrderOtp.findOne({
      orderId: order.orderId,
      consumedAt: null,
    }).sort({ createdAt: -1 });

    if (!otpDoc) {
      throw new ValidationError('No active OTP');
    }
    if (otpDoc.expiresAt < new Date()) {
      throw new ValidationError('OTP expired');
    }
    if (otpDoc.attempts >= otpDoc.maxAttempts) {
      throw new ValidationError('Too many OTP attempts');
    }

    const match = OrderOtp.hashCode(otpStr) === otpDoc.codeHash;
    if (!match) {
      await OrderOtp.updateOne({ _id: otpDoc._id }, { $inc: { attempts: 1 } });
      throw new ValidationError('Invalid OTP');
    }

    await OrderOtp.updateOne(
      { _id: otpDoc._id },
      { $set: { consumedAt: new Date() } },
    );

    order.otpValidatedAt = new Date();
    await order.save();

    const resOrder = order.toObject();
    resOrder.deliveryVerification = {
      dropOtp: { required: true, verified: true }
    };
    return { order: resOrder };
  }

  const isPrimary = toPartnerId(order.dispatch?.deliveryPartnerId) === toPartnerId(deliveryPartnerId);
  const isShared = toPartnerId(order.dispatch?.sharedPartnerId) === toPartnerId(deliveryPartnerId);
  if (!isPrimary && !isShared) {
    throw new ForbiddenError('Not your order');
  }

  const otpStr = normalizeOtpValue(otp);
  if (!otpStr) throw new ValidationError('OTP is required');

  // Repair dual-leg if shared partner exists but legs were never built.
  ensureDualLegs(order, generateFourDigitDeliveryOtp);

  // Dual-leg: verify THIS driver's leg OTP; the other leg is unaffected.
  if (isDualLegActive(order)) {
    const verifyLeg = getLegForPartner(order, deliveryPartnerId);
    if (!verifyLeg) {
      throw new ForbiddenError('No delivery leg assigned to you on this shared order');
    }
    if (verifyLeg.otpVerified) {
      return { order: sanitizeOrderForExternal(order) };
    }
    if (!isOtpMatch(verifyLeg.otp, otpStr)) {
      throw new ValidationError(
        'Invalid OTP. Ask the customer for the code shown in their app for this delivery.',
      );
    }
    verifyLeg.otpVerified = true;
    order.markModified('legs');
    // Never flip order-level dropOtp.verified here — that would mark the other driver done.
    await order.save();

    emitOrderUpdate(order, deliveryPartnerId, { sendMilestonePush: false });
    enqueueOrderEvent('leg_drop_otp_verified', {
      orderMongoId: order._id?.toString?.(),
      orderId: order._id.toString(),
      deliveryPartnerId,
      legIndex: verifyLeg.legIndex,
      legProgress: getLegProgress(order),
    });
    return { order: sanitizeOrderForExternal(order) };
  }

  if (!order.deliveryVerification?.dropOtp?.required) {
    const hasSecretOtp = Boolean(normalizeOtpValue(order.deliveryOtp));
    if (!hasSecretOtp) {
      throw new ValidationError(
        'OTP verification is not active for this order. Confirm reached drop first.',
      );
    }

    if (!order.deliveryVerification) order.deliveryVerification = {};
    order.deliveryVerification.dropOtp = {
      required: true,
      verified: false,
      ...(order.deliveryVerification?.dropOtp || {}),
    };
    order.markModified('deliveryVerification.dropOtp');
    await order.save();
  }
  if (order.deliveryVerification?.dropOtp?.verified) {
    return { order: sanitizeOrderForExternal(order) };
  }

  if (!isOtpMatch(order.deliveryOtp, otpStr)) {
    throw new ValidationError(
      'Invalid OTP. Ask the customer for the code shown in their app.',
    );
  }

  if (!order.deliveryVerification) order.deliveryVerification = { dropOtp: {} };
  order.deliveryVerification.dropOtp.verified = true;
  order.markModified('deliveryVerification.dropOtp.verified');
  await order.save();

  // OTP verification does not advance order status; suppress milestone push to avoid duplicates.
  emitOrderUpdate(order, deliveryPartnerId, { sendMilestonePush: false });
  enqueueOrderEvent('drop_otp_verified', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
  });
  return { order: sanitizeOrderForExternal(order) };
}

export async function completeDelivery(orderId, deliveryPartnerId, body = {}) {
  const identity = buildOrderIdentityFilter(orderId);
  let order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  let isQcOrder = false;
  if (!order) {
    const Order = mongoose.model('Order');
    order = await Order.findOne(identity);
    if (!order) throw new NotFoundError('Order not found');
    isQcOrder = true;
  }

  if (isQcOrder) {
    const isPrimary = (order.dispatch?.deliveryPartnerId?.toString() === deliveryPartnerId.toString()) || (order.deliveryBoy?.toString() === deliveryPartnerId.toString());
    if (!isPrimary) {
      throw new ForbiddenError('Not your order');
    }

    if (order.workflowStatus !== 'OUT_FOR_DELIVERY') {
      throw new ValidationError('Invalid state for delivery completion');
    }

    const OrderOtp = mongoose.model('OrderOtp');
    const otpDoc = await OrderOtp.findOne({
      orderId: order.orderId,
    }).sort({ createdAt: -1 });

    if (!order.otpValidatedAt) {
      const { otp } = body;
      if (!otp) {
        throw new ValidationError('Customer handover OTP is required. Verify the OTP from the customer before completing delivery.');
      }
      if (!otpDoc || otpDoc.consumedAt) {
        if (!otpDoc || OrderOtp.hashCode(String(otp)) !== otpDoc.codeHash) {
          throw new ValidationError('Invalid handover OTP provided.');
        }
      } else {
        if (otpDoc.expiresAt < new Date()) {
          throw new ValidationError('OTP expired');
        }
        if (otpDoc.attempts >= otpDoc.maxAttempts) {
          throw new ValidationError('Too many OTP attempts');
        }
        const match = OrderOtp.hashCode(String(otp)) === otpDoc.codeHash;
        if (!match) {
          await OrderOtp.updateOne({ _id: otpDoc._id }, { $inc: { attempts: 1 } });
          throw new ValidationError('Invalid handover OTP provided.');
        }
        await OrderOtp.updateOne(
          { _id: otpDoc._id },
          { $set: { consumedAt: new Date() } }
        );
      }
    }

    const now = new Date();
    order.workflowStatus = 'DELIVERED';
    order.status = 'delivered';
    order.orderStatus = 'delivered';
    order.deliveredAt = now;
    await order.save();

    try {
      const { applyDeliveredSettlement } = await import("../../../../quickCommerce/services/orderSettlement.js");
      await applyDeliveredSettlement(order, order.orderId);
    } catch (settleErr) {
      console.error('[completeDelivery] QC settlement failed:', settleErr.message);
    }

    try {
      const io = getIO();
      if (io) {
        const payload = {
          orderId: order.orderId,
          workflowStatus: 'DELIVERED',
          status: 'delivered',
          at: now.toISOString()
        };
        io.to(`order:${order.orderId}`).emit('order:status:update', payload);
        const cid = order.customer?._id || order.customer;
        if (cid) {
          io.to(`customer:${cid.toString()}`).emit('order:status:update', payload);
        }
      }
    } catch (err) {
      console.warn('[completeDelivery] QC socket emit failed:', err.message);
    }

    const resOrder = order.toObject();
    resOrder.deliveryVerification = {
      dropOtp: { required: true, verified: true }
    };
    return resOrder;
  }

  const pid = order.dispatch?.deliveryPartnerId?.toString();
  const sid = order.dispatch?.sharedPartnerId?.toString();
  const currentId = deliveryPartnerId.toString();

  if (pid !== currentId && sid !== currentId) {
    logger.warn(`Auth failed for completeDelivery. Order: ${orderId}, Partner: ${currentId}, Primary: ${pid}, Shared: ${sid}`);
    throw new ForbiddenError('Not your order');
  }

  const isShared = Boolean(order.dispatch?.sharedPartnerId);
  const isPrimaryRider = order.dispatch?.deliveryPartnerId?.toString() === deliveryPartnerId.toString();

  const { otp, ratings, paymentMethod: selectedPaymentMethod } = body;

  // 0. Dual-leg: this driver completes THEIR leg only. The parent order can never be closed by
  //    a single driver — it is DELIVERED only once every active leg is delivered.
  ensureDualLegs(order, generateFourDigitDeliveryOtp);
  const completeLeg = isDualLegActive(order) ? getLegForPartner(order, deliveryPartnerId) : null;
  if (isDualLegActive(order) && !completeLeg) {
    throw new ForbiddenError('No delivery leg assigned to you on this shared order');
  }
  if (completeLeg) {
    if (String(completeLeg.status || '') === 'delivered') {
      return sanitizeOrderForExternal(order); // idempotent re-submit
    }

    if (!completeLeg.otpVerified) {
      const providedOtp = normalizeOtpValue(otp);
      if (!providedOtp) {
        throw new ValidationError(
          'Customer handover OTP is required. Verify the OTP for your delivery before completing.',
        );
      }
      if (!isOtpMatch(completeLeg.otp, providedOtp)) {
        throw new ValidationError('Invalid handover OTP provided.');
      }
      completeLeg.otpVerified = true;
    }

    completeLeg.status = 'delivered';
    completeLeg.deliveredAt = new Date();
    order.markModified('legs');

    if (!areAllLegsDelivered(order)) {
      // Other leg still out — record this one and stop short of settlement.
      pushStatusHistory(order, {
        byRole: 'DELIVERY_PARTNER',
        byId: deliveryPartnerId,
        from: order.orderStatus,
        to: order.orderStatus,
        note: `Leg ${completeLeg.legIndex} delivered. Waiting for the other partner to finish.`,
      });
      await order.save();
      emitOrderUpdate(order, deliveryPartnerId);
      enqueueOrderEvent('leg_delivered', {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        deliveryPartnerId,
        legIndex: completeLeg.legIndex,
        legProgress: getLegProgress(order),
      });
      return sanitizeOrderForExternal(order);
    }

    // Final leg — re-apply salary/per-order payouts so wallets never credit salary partners.
    try {
      const [primaryPartner, sharedPartner] = await Promise.all([
        FoodDeliveryPartner.findById(order.dispatch?.deliveryPartnerId).select('employmentType').lean(),
        FoodDeliveryPartner.findById(order.dispatch?.sharedPartnerId).select('employmentType').lean(),
      ]);
      applyEmploymentAwareDualEarnings(order, {
        primaryEmploymentType: primaryPartner?.employmentType || 'per_order',
        secondaryEmploymentType: sharedPartner?.employmentType || 'per_order',
      });
    } catch (earnErr) {
      logger.warn(`Employment-aware dual earnings failed: ${earnErr?.message || earnErr}`);
    }

    // Satisfy the legacy single-driver gates below (per-leg OTPs already verified,
    // and the legs themselves ARE the split) so settlement runs exactly once.
    if (!order.deliveryVerification) order.deliveryVerification = {};
    order.deliveryVerification.dropOtp = {
      ...(order.deliveryVerification?.dropOtp || {}),
      required: true,
      verified: true,
    };
    order.markModified('deliveryVerification.dropOtp');
    order.deliveryState = {
      ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
      isSplitConfirmed: true,
    };
  }

  // 1. Handover OTP Verification
  if (
    otp &&
    order.deliveryVerification?.dropOtp?.required &&
    !order.deliveryVerification?.dropOtp?.verified
  ) {
    const orderWithSecret = await FoodOrder.findById(order._id).select('+deliveryOtp');
    if (isOtpMatch(orderWithSecret?.deliveryOtp, otp)) {
      order.deliveryVerification.dropOtp.verified = true;
      order.markModified('deliveryVerification.dropOtp.verified');
    } else {
      throw new ValidationError('Invalid handover OTP provided.');
    }
  }

  if (
    order.deliveryVerification?.dropOtp?.required &&
    !order.deliveryVerification?.dropOtp?.verified &&
    !otp
  ) {
    throw new ValidationError(
      'Customer handover OTP is required. Verify the OTP from the customer before completing delivery.',
    );
  }

  const from = order.orderStatus;
  const nextStatus = 'delivered';
  if (!isStatusAdvance(from, nextStatus)) {
    throw new ValidationError(`Order is already at status '${from}'. Cannot re-mark as '${nextStatus}'.`);
  }
  // 4A: adjacency guard — 'delivered' may only follow 'picked_up'. Closes the rank-only hole
  // where ready_for_pickup → delivered (skipping pickup) was accepted because 80 > 40.
  if (!canOrderTransition(from, nextStatus)) {
    throw new ValidationError('Cannot complete delivery: the order must be picked up first.');
  }

  // Blocking check for split confirmation on shared orders
  if (isShared && !order.deliveryState?.isSplitConfirmed) {
    throw new ValidationError('Earnings split must be confirmed by the primary partner before completing the delivery.');
  }

  const boySettings =
    (await FoodDeliveryBoySettings.findOne({ isActive: true }).sort({ createdAt: -1 }).lean()) ||
    (await FoodDeliveryBoySettings.findOne().sort({ createdAt: -1 }).lean());
  // Bulk second-driver is optional: primary may complete alone unless they opened a
  // share slot that is still waiting within SHARE_TIMEOUT_MS.
  if (isShareRequired(order, boySettings || {}) && !isSharedDriverJoined(order)) {
    const shareOpenedAt = order.dispatch?.shareOpenedAt
      ? new Date(order.dispatch.shareOpenedAt).getTime()
      : null;
    const shareWasOpened =
      Boolean(order.dispatch?.isShared) || shareOpenedAt != null;
    const shareTimedOut =
      shareOpenedAt != null && Date.now() - shareOpenedAt >= SHARE_TIMEOUT_MS;

    if (shareWasOpened && !shareTimedOut) {
      throw new ValidationError(
        'Waiting for a second delivery partner. If no one joins, you can complete alone after the search times out.',
      );
    }

    if (shareWasOpened) {
      const restoredEarning =
        Number(order.riderEarning || 0) + Number(order.sharedRiderEarning || 0);
      order.riderEarning = restoredEarning;
      order.sharedRiderEarning = 0;
      order.dispatch.isShared = false;
      order.dispatch.shareOpenedAt = null;
      pushStatusHistory(order, {
        byRole: 'SYSTEM',
        byId: deliveryPartnerId,
        from: order.orderStatus,
        to: order.orderStatus,
        note: `No second partner joined within ${Math.round(
          SHARE_TIMEOUT_MS / 60000,
        )} min; primary completing solo with full earning ₹${restoredEarning}.`,
      });
      try {
        await notifyOwnersSafely(
          [{ ownerType: 'ADMIN', ownerId: 'GLOBAL' }],
          {
            title: 'Bulk order completed solo',
            body: `Order #${order.order_id || order._id} had no second driver join in time; the primary partner is completing it alone.`,
            data: {
              type: 'bulk_solo_complete',
              orderId: order._id.toString(),
              orderMongoId: order._id?.toString?.() || '',
            },
          },
        );
      } catch (err) {
        logger.warn(`Bulk solo-complete admin alert failed: ${err?.message || err}`);
      }
    }
  }

  // 2. Financial Context Resolution
  const tx = await FoodTransaction.findOne({ orderId: order._id }).lean();
  const prevPayStatus = String(tx?.payment?.status || order?.payment?.status || 'cod_pending');
  const payMethod = String(tx?.payment?.method || order?.payment?.method || order?.paymentMethod || 'cash');

  /**
   * Final Payment Method Logic:
   * - If rider chose 'qr', we force 'razorpay_qr'.
   * - If rider chose 'cash', we force 'cash'. 
   * - Otherwise, we keep the original method.
   */
  let finalPayMethod = payMethod;
  if (selectedPaymentMethod === 'qr') finalPayMethod = 'razorpay_qr';
  else if (selectedPaymentMethod === 'cash') {
    if (isShared && !isPrimaryRider) {
      throw new ValidationError('Only the primary partner can collect cash payments.');
    }
    finalPayMethod = 'cash';
  }

  // 3. QR Payment Verification (Blocking)
  if (finalPayMethod === 'razorpay_qr') {
    const syncedPayment = await syncRazorpayQrPayment(order);
    if (String(syncedPayment?.status || '').toLowerCase() !== 'paid') {
      throw new ValidationError('Please wait for the customer to complete the QR payment. Payment not verified yet.');
    }
  }

  // 4. Update Order State
  order.orderStatus = 'delivered';
  order.deliveryState = {
    ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
    currentPhase: 'delivered',
    status: 'delivered',
    deliveredAt: new Date(),
  };

  if (ratings) {
    order.ratings = {
      ...(order.ratings?.toObject?.() || order.ratings || {}),
      ...ratings,
    };
  }

  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from,
    to: 'delivered',
    note: `Delivery completed by ${isPrimaryRider ? 'Primary' : 'Shared'} Partner using ${finalPayMethod}.`,
  });

  pushSettlementSnapshot(
    order,
    'complete',
    `Delivered via ${finalPayMethod}; primary ₹${Number(order.riderEarning) || 0}, shared ₹${Number(order.sharedRiderEarning) || 0}`,
  );
  await order.save();

  // 5. Update Financial Ledger (FoodTransaction)
  // This triggers the sync back to FoodOrder.payment.method which updates the Rider's Cash Limit (if cash) or Pocket (always).
  const ledgerKind =
    finalPayMethod === 'cash'
      ? 'cod_marked_paid_on_delivery'
      : (finalPayMethod === 'razorpay_qr' ? 'cod_collect_qr_settled' : 'payment_snapshot_sync');

  await foodTransactionService.updateTransactionStatus(order._id, ledgerKind, {
    status: 'captured', // This marks payment as 'paid'
    paymentMethod: finalPayMethod,
    recordedByRole: 'DELIVERY_PARTNER',
    recordedById: deliveryPartnerId,
    primaryRiderShare: order.riderEarning,
    sharedRiderShare: order.sharedRiderEarning,
    note: `Rider finalized payment as ${finalPayMethod}. Order is now delivered.`,
  });

  // Notify both partners about completion and split
  try {
    const io = getIO();
    if (io) {
      const splitPayload = {
        orderId: order._id.toString(),
        totalEarnings: (order.riderEarning || 0) + (order.sharedRiderEarning || 0),
        primaryShare: order.riderEarning,
        sharedShare: order.sharedRiderEarning,
        deliveryPartnerId: order.dispatch?.deliveryPartnerId,
        sharedPartnerId: order.dispatch?.sharedPartnerId
      };
      if (order.dispatch?.deliveryPartnerId) {
        io.to(rooms.delivery(order.dispatch.deliveryPartnerId)).emit('order_earnings_split', splitPayload);
      }
      if (order.dispatch?.sharedPartnerId) {
        io.to(rooms.delivery(order.dispatch.sharedPartnerId)).emit('order_earnings_split', splitPayload);
      }
    }
  } catch (err) { }

  emitOrderUpdate(order, deliveryPartnerId);

  enqueueOrderEvent('delivery_completed', {
    orderMongoId: order._id?.toString?.(),
    orderId: order.orderId || order._id.toString(),
    deliveryPartnerId,
    restaurantId: order.restaurantId?._id?.toString?.() || order.restaurantId?.toString?.(),
    riderEarning: Number(order.riderEarning) || 0,
    sharedRiderEarning: Number(order.sharedRiderEarning) || 0,
    platformProfit: Number(order.platformProfit) || 0,
    payMethod: finalPayMethod,
    paymentMethod: finalPayMethod,
    prevPayStatus,
    paymentStatus: 'paid'
  });

  return sanitizeOrderForExternal(order);
}


export async function updateOrderStatusDelivery(orderId, deliveryPartnerId, orderStatus) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  let order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  let isQcOrder = false;
  if (!order) {
    const Order = mongoose.model('Order');
    order = await Order.findOne(identity);
    if (!order) throw new NotFoundError('Order not found');
    isQcOrder = true;
  }

  if (isQcOrder) {
    const isPrimary = (order.dispatch?.deliveryPartnerId?.toString() === deliveryPartnerId.toString()) || (order.deliveryBoy?.toString() === deliveryPartnerId.toString());
    if (!isPrimary) {
      throw new ForbiddenError('Not your order');
    }

    order.orderStatus = orderStatus;
    order.status = orderStatus;
    await order.save();
    return order.toObject();
  }

  const isPrimary = order.dispatch?.deliveryPartnerId?.toString() === deliveryPartnerId.toString();
  const isShared = order.dispatch?.sharedPartnerId?.toString() === deliveryPartnerId.toString();
  if (!isPrimary && !isShared) {
    throw new ForbiddenError('Not your order');
  }

  const from = order.orderStatus;
  if (!isStatusAdvance(from, orderStatus)) {
    throw new ValidationError(`Current order status '${from}' is further ahead than '${orderStatus}'. Order cannot be moved backwards.`);
  }
  order.orderStatus = orderStatus;
  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from,
    to: orderStatus,
  });
  await order.save();

  enqueueOrderEvent('delivery_status_updated', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    from,
    to: orderStatus,
  });
  return order.toObject();
}
