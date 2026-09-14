import mongoose from 'mongoose';
import { FoodOrder, FoodSettings } from '../models/order.model.js';
import { FoodCheckoutSession } from '../models/foodCheckoutSession.model.js';
// import { paymentSnapshotFromOrder } from './foodOrderPayment.service.js';
import { logger } from '../../../../utils/logger.js';
import { FoodUser } from '../../../../core/users/user.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { attachOutletTimingsToRestaurants } from '../../restaurant/services/outletTimings.service.js';
import { getRestaurantOrderableStatus } from '../../shared/utils/restaurantAvailability.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { FoodZone } from '../../admin/models/zone.model.js';
import { FoodFeeSettings } from '../../admin/models/feeSettings.model.js';
import { ValidationError, ForbiddenError, NotFoundError } from '../../../../core/auth/errors.js';
import { buildPaginationOptions, buildPaginatedResult } from '../../../../utils/helpers.js';
import { FoodOffer } from '../../admin/models/offer.model.js';
import { recordOfferRedemption } from '../../admin/services/offer.service.js';
import { FoodDeliveryCommissionRule } from '../../admin/models/deliveryCommissionRule.model.js';
import { FoodRestaurantCommission } from '../../admin/models/restaurantCommission.model.js';
import { FoodTransaction } from '../models/foodTransaction.model.js';
import { FoodOrderEvent } from '../models/foodOrderEvent.model.js';
import { FoodSupportTicket } from '../../user/models/supportTicket.model.js';
import { config } from '../../../../config/env.js';
import { FoodDeliveryBoySettings } from '../../admin/models/deliveryBoySettings.model.js';
import {
  createRazorpayOrder,
  verifyPaymentSignature,
  getRazorpayKeyId,
  isRazorpayConfigured,
  initiateRazorpayRefund
} from '../helpers/razorpay.helper.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { addOrderJob } from '../../../../queues/producers/order.producer.js';
import { fetchPolyline } from '../utils/googleMaps.js';
import { getFirebaseDB } from '../../../../config/firebase.js';
import * as foodTransactionService from './foodTransaction.service.js';
import * as userWalletService from '../../user/services/userWallet.service.js';
import { syncUserCart } from '../../user/services/userCart.service.js';
import { calculateOrderPricing } from './order-pricing.service.js';
import {
  validateRestaurantChainForItems,
  validateNewRestaurantAgainstLast,
} from './restaurant-chain-radius.service.js';
import {
  assertRestaurantOrderLimit,
  reconcileRestaurantLimitAfterInsert,
} from './active-restaurant-limit.service.js';
import * as dispatchService from './order-dispatch.service.js';
import * as checkoutService from './order-checkout.service.js';
import * as deliveryService from './order-delivery.service.js';
import * as paymentService from './order-payment.service.js';
import { getRoadDistanceMeters } from '../../../../core/location/distance.service.js';
import {
  enqueueOrderEvent,
  haversineKm,
  calculateDistanceSlabRiderFee,
  resolveOrderDistanceKmAsync,
  applyDeliverySurcharges,
  generateFourDigitDeliveryOtp,
  sanitizeOrderForExternal,
  emitDeliveryDropOtpToUser,
  notifyOwnersSafely,
  notifyOwnerSafely,
  buildRestaurantScopedOrder,
  toRestaurantOrderResponse,
  buildOrderIdentityFilter,
  toGeoPoint,
  pushStatusHistory,
  normalizeOrderForClient,
  toUserOrderResponse,
  applyAggregateRating,
  derivePickupStatusFromOrderStatus,
  buildDeliverySocketPayload,
  notifyRestaurantNewOrder,
  isStatusAdvance,
  freeOrderDispatch,
  resolveSpeedOption,
  resolveDualPayoutPool,
  applyEmploymentAwareDualEarnings,
  NO_DRIVER_AUTO_CANCEL_MS,
  SHARE_TIMEOUT_MS,
  RESTAURANT_ACK_RESEND_MS,
  RESTAURANT_ACK_TIMEOUT_MS,
} from './order.helpers.js';
import {
  assertMaxRestaurants,
  assertMultiOrderAllowed,
  assertCanCancel,
  assertCanShareSecondDriver,
  computeDroppedRestaurantRefundAmount,
  getActivePickups,
  isActivePickup,
  isShareRequired,
  pushSettlementSnapshot,
  applyCancellationSettlement,
  computeRestaurantPrepMinutes,
  computeOrderEtaMinutes,
  assignPickupSequence,
  getPickupProgress,
  buildDeliveryLegs,
  getLegProgress,
  isDualLegActive,
  getPendingLegHandoverOtps,
  getAllLegHandoverOtps,
  getLegForPartner,
  toPartnerId,
} from './order-lifecycle.policy.js';

async function clearUserCartAfterOrder(userId) {
  if (!userId) return;
  try {
    await syncUserCart(userId, { items: [], restaurantMeta: [], cartType: null });
  } catch (err) {
    logger.warn(`Failed to clear cart after order for user ${userId}: ${err?.message || err}`);
  }
}
const COMMISSION_CACHE_MS = 10 * 1000;
let commissionRulesCache = null;
let commissionRulesLoadedAt = 0;

async function getActiveCommissionRules() {
  const now = Date.now();
  if (
    commissionRulesCache &&
    now - commissionRulesLoadedAt < COMMISSION_CACHE_MS
  ) {
    return commissionRulesCache;
  }
  const list = await FoodDeliveryCommissionRule.find({
    status: { $ne: false },
  }).lean();
  commissionRulesCache = list || [];
  commissionRulesLoadedAt = now;
  return commissionRulesCache;
}

export function clearCommissionRulesCache() {
  commissionRulesCache = null;
  commissionRulesLoadedAt = 0;
}

// 🗑️ Moved to foodTransaction.service.js to centralize finance logic.


async function getRiderEarning(distanceKm) {
  const rules = await getActiveCommissionRules();
  return calculateDistanceSlabRiderFee(distanceKm, rules);
}

/** Append-only food_order_payments row; never blocks main flow on failure */
// 🗑️ Deprecated in favor of FoodTransaction system.

// ----- Settings -----
export async function getDispatchSettings() {
  return dispatchService.getDispatchSettings();
}

export async function updateDispatchSettings(dispatchMode, adminId) {
  return dispatchService.updateDispatchSettings(dispatchMode, adminId);
}

// ----- Calculate (validation + return pricing from payload) -----
export async function calculateOrder(userId, dto) {
  return calculateOrderPricing(userId, dto);
}

export async function validateRestaurantChain(anchorRestaurantId, newRestaurantId) {
  return validateNewRestaurantAgainstLast(anchorRestaurantId, newRestaurantId);
}

// ----- Create order -----
/**
 * @param {object} [options]
 * @param {{ razorpayOrderId: string, razorpayPaymentId: string, razorpaySignature: string, expectedAmount?: number }} [options.verifiedPrepaid]
 *        When set, Razorpay was already verified — create FoodOrder as paid (no unpaid order).
 */
export async function createOrder(userId, dto, options = {}) {
  const items = Array.isArray(dto.items) ? dto.items : [];
  if (items.length === 0) throw new ValidationError("No items in order");

  await validateRestaurantChainForItems(items);

  // Identify unique restaurants
  const restaurantIds = [...new Set(items.map(it => it.restaurantId).filter(Boolean))];
  if (dto.restaurantId && !restaurantIds.includes(dto.restaurantId)) {
    restaurantIds.push(dto.restaurantId);
  }

  assertMaxRestaurants(items);
  const deliveryBoySettingsEarly = await FoodDeliveryBoySettings.findOne({ isActive: true })
    .sort({ createdAt: -1 })
    .lean()
    || await FoodDeliveryBoySettings.findOne().sort({ createdAt: -1 }).lean();
  assertMultiOrderAllowed(deliveryBoySettingsEarly, restaurantIds.length);

  const restaurants = await FoodRestaurant.find({ _id: { $in: restaurantIds } })
    .select("status restaurantName zoneId location isAcceptingOrders name profileReviewStatus")
    .lean();

  if (restaurants.length === 0) throw new ValidationError("Restaurants not found");

  const restaurantsWithTimings = await attachOutletTimingsToRestaurants(restaurants);
  const now = new Date();

  for (const r of restaurantsWithTimings) {
    if (
      r.status !== "approved" ||
      r.profileReviewStatus === "pending" ||
      r.isAcceptingOrders === false
    ) {
      throw new ValidationError(`Restaurant ${r.name || r.restaurantName} is not accepting orders`);
    }

    const orderable = getRestaurantOrderableStatus(r, now);
    if (!orderable.isOrderable) {
      throw new ValidationError(
        `Restaurant ${r.name || r.restaurantName} is closed right now. Please try again during open hours.`,
      );
    }
  }

  await assertRestaurantOrderLimit(userId, restaurantIds);

  const mainRestaurant = restaurantsWithTimings[0];
  const settings = await getDispatchSettings();
  const dispatchMode = settings.dispatchMode;

  const deliveryAddress = {
    label: dto.address?.label || "Home",
    name: dto.address?.name || dto.address?.fullName || dto.customerName || "",
    fullName: dto.address?.fullName || dto.address?.name || dto.customerName || "",
    street: dto.address?.street || "",
    additionalDetails: dto.address?.additionalDetails || "",
    city: dto.address?.city || "",
    state: dto.address?.state || "",
    zipCode: dto.address?.zipCode || "",
    phone: dto.address?.phone || "",
    location: dto.address?.location?.coordinates
      ? { type: "Point", coordinates: dto.address.location.coordinates }
      : undefined,
  };

  const paymentMethod = dto.paymentMethod === "card" ? "razorpay" : dto.paymentMethod;
  const isCash = paymentMethod === "cash" || paymentMethod === "razorpay_qr";
  if (isCash) {
    throw new ValidationError('Cash on Delivery is no longer available. Please pay online or with wallet.');
  }
  const isWallet = paymentMethod === "wallet";
  const verifiedPrepaid = options.verifiedPrepaid || null;

  // Always recalculate server-side (coupon validity + fees + catalog prices) before placing
  const recalculated = await calculateOrderPricing(userId, {
    items,
    restaurantId: dto.restaurantId,
    deliveryAddress: dto.address,
    couponCode: dto.pricing?.couponCode,
    deliverySpeedOptionId: dto.deliverySpeedOptionId,
    deliveryOption: dto.deliveryOption,
  });

  // Prefer hydrated catalog lines for all downstream order creation
  const pricedItems = Array.isArray(recalculated.items) && recalculated.items.length > 0
    ? recalculated.items
    : items;

  const normalizedPricing = {
    subtotal: Number(recalculated.pricing?.subtotal ?? 0),
    foodSubtotal: Number(recalculated.pricing?.foodSubtotal ?? recalculated.pricing?.subtotal ?? 0),
    tax: Number(recalculated.pricing?.tax ?? 0),
    packagingFee: Number(recalculated.pricing?.packagingFee ?? 0),
    restaurantPackagingTotal: Number(
      recalculated.pricing?.restaurantPackagingTotal ?? recalculated.pricing?.packagingFee ?? 0,
    ),
    deliveryFee: Number(recalculated.pricing?.deliveryFee ?? 0),
    platformFee: Number(recalculated.pricing?.platformFee ?? 0),
    discount: Number(recalculated.pricing?.discount ?? 0),
    deliveryDiscount: Number(recalculated.pricing?.deliveryDiscount ?? 0),
    platformSubsidy: Number(recalculated.pricing?.platformSubsidy ?? 0),
    couponCategory: recalculated.pricing?.couponCategory || undefined,
    total: Number(recalculated.pricing?.total ?? 0),
    currency: String(recalculated.pricing?.currency || "INR"),
    restaurantCommission: Number(dto.pricing?.restaurantCommission || 0),
    couponCode: recalculated.pricing?.couponCode ? String(recalculated.pricing.couponCode).trim().toUpperCase() : undefined,
    couponCreatedBy: recalculated.pricing?.couponCreatedBy || undefined,
    offerId: recalculated.pricing?.offerId || undefined,
    deliveryFeeBreakdown: recalculated.pricing?.deliveryFeeBreakdown || null,
    restaurantGroups: recalculated.pricing?.restaurantGroups || undefined,
  };

  if (dto.pricing?.couponCode && !normalizedPricing.couponCode) {
    const msg =
      recalculated.couponError?.message ||
      recalculated.pricing?.couponError?.message ||
      "Coupon is not valid for this order";
    throw new ValidationError(msg);
  }

  if (verifiedPrepaid && Number.isFinite(Number(verifiedPrepaid.expectedAmount))) {
    const expected = Math.round(Number(verifiedPrepaid.expectedAmount) * 100);
    const actual = Math.round(normalizedPricing.total * 100);
    if (expected !== actual) {
      throw new ValidationError("Order total changed after payment. Contact support for a refund.");
    }
  }

  const couponCodeMeta = normalizedPricing.couponCode;
  if (couponCodeMeta) {
    const offerDoc = await FoodOffer.findOne({ couponCode: couponCodeMeta }).lean();
    if (offerDoc) {
      normalizedPricing.couponCreatedBy = offerDoc.createdBy || 'admin';
      normalizedPricing.offerId = offerDoc._id;
    }
  }

  // Prepaid Razorpay: validate + lock pricing in checkout session; create FoodOrder only after payment
  if (paymentMethod === "razorpay" && !verifiedPrepaid) {
    const lockedDto = {
      ...dto,
      items: pricedItems,
      pricing: {
        ...(dto.pricing || {}),
        couponCode: normalizedPricing.couponCode,
      },
    };
    const checkout = await checkoutService.createPrepaidCheckoutSession({
      userId,
      dto: lockedDto,
      pricing: normalizedPricing,
    });
    return {
      order: null,
      checkoutId: checkout.checkoutId,
      paymentType: 'PREPAID',
      amount: normalizedPricing.total,
      razorpayOrderId: checkout.razorpay?.orderId || null,
      pricing: checkout.pricing,
      razorpay: checkout.razorpay,
      expiresAt: checkout.expiresAt,
      requiresPayment: true,
    };
  }

  let deliveryBoySettings = await FoodDeliveryBoySettings.findOne({ isActive: true })
    .sort({ createdAt: -1 })
    .lean();
  if (!deliveryBoySettings) {
    deliveryBoySettings = await FoodDeliveryBoySettings.findOne()
      .sort({ createdAt: -1 })
      .lean();
  }

  const totalItemCount = pricedItems.reduce(
    (sum, item) => sum + (Number(item.quantity) || 1),
    0,
  );
  const splitEnabled = deliveryBoySettings ? (deliveryBoySettings.splitOrderEnabled !== false) : true;
  const splitThreshold = Number(deliveryBoySettings?.splitOrderThreshold ?? 20);
  const isSplitOrder = Boolean(splitEnabled && splitThreshold > 0 && totalItemCount >= splitThreshold);
  const isMultiRestaurant = restaurants.length > 1;

  const userLoc = deliveryAddress.location?.coordinates;
  const totalDistanceKm = await resolveOrderDistanceKmAsync(restaurantsWithTimings, userLoc);

  // Prefer rider fee frozen in pricing breakdown (same slab as customer userCharge)
  const breakdownRiderFee = Number(recalculated.pricing?.deliveryFeeBreakdown?.riderFee);
  const breakdownBoyFee = Number(recalculated.pricing?.deliveryFeeBreakdown?.deliveryBoyFee);
  let riderEarning;
  if (Number.isFinite(breakdownRiderFee) && breakdownRiderFee >= 0) {
    riderEarning = breakdownRiderFee;
  } else {
    const baseRiderEarning = Number.isFinite(breakdownBoyFee) && breakdownBoyFee >= 0
      ? breakdownBoyFee
      : await getRiderEarning(totalDistanceKm);
    const riderSurcharge = applyDeliverySurcharges(baseRiderEarning, {
      isMultiRestaurant,
      isSplitOrder,
      deliveryBoySettings,
    });
    riderEarning = riderSurcharge.fee;
  }

  const pickups = restaurants.map(r => {
    const restaurantItems = pricedItems.filter(
      (it) => String(it.restaurantId) === String(r._id),
    );
    return {
      restaurantId: r._id,
      restaurantName: r.name || r.restaurantName,
      status: 'pending',
      location: r.location,
      items: restaurantItems.map((it) => it.name),
      // Kitchen prep for this stop = its slowest item (menu preparationTime).
      prepMinutes: computeRestaurantPrepMinutes(restaurantItems),
    };
  });
  // Visit order: farthest-from-customer first so the final leg to the customer is shortest.
  assignPickupSequence(pickups, userLoc);
  // Fallback ETA from kitchen prep + travel (used only when no Delivery Speed Option is selected).
  const computedEtaMinutes = computeOrderEtaMinutes({ pickups }, totalDistanceKm);

  // Prefer the customer's selected Delivery Speed Option time for user-facing ETA.
  const matchedSpeedOption = resolveSpeedOption(
    deliveryBoySettings,
    dto.deliverySpeedOptionId,
    dto.deliveryOption,
  );
  const speedEtaMinutes = matchedSpeedOption
    ? Math.max(1, Number(matchedSpeedOption.estimatedTime) || 0)
    : 0;
  const speedTimeLabel = matchedSpeedOption
    ? String(matchedSpeedOption.time || '').trim()
    : '';
  const speedOptionName = matchedSpeedOption
    ? String(matchedSpeedOption.name || '').trim()
    : '';
  const orderEstimatedMinutes =
    speedEtaMinutes ||
    Math.max(1, Number(dto.estimatedTime) || 0) ||
    computedEtaMinutes ||
    30;
  const orderDeliveryTimeLabel =
    speedTimeLabel ||
    String(dto.deliveryTime || '').trim() ||
    `${orderEstimatedMinutes} mins`;
  const orderDeliveryOptionName =
    speedOptionName ||
    String(dto.deliveryOption || '').trim() ||
    'Standard Delivery';

  // Calculate restaurant commission per restaurant (sum stored on pricing for compat)
  const restaurantGroups = Array.isArray(recalculated.pricing?.restaurantGroups)
    ? recalculated.pricing.restaurantGroups
    : restaurants.map((r) => ({
      restaurantId: String(r._id),
      restaurantName: r.name || r.restaurantName,
      subtotal: pricedItems
        .filter((it) => String(it.restaurantId) === String(r._id))
        .reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 1), 0),
      packagingFee: 0,
    }));

  const breakdown = normalizedPricing.deliveryFeeBreakdown || {};
  // Speed fee is shared only between admin and driver (restaurant share removed).
  const speedShareRestaurantTotal = 0;
  const speedShareDriver = Math.max(0, Number(breakdown.speedShareDriver) || 0);
  const speedShareAdmin = Number(breakdown.speedShareAdmin) || 0;

  const isRestaurantCoupon = normalizedPricing.couponCreatedBy === 'restaurant';
  const isAdminCoupon = normalizedPricing.couponCreatedBy === 'admin';
  const foodDiscount = Number(normalizedPricing.discount) || 0;
  // Restaurant coupon: primary restaurant bears the full food discount
  const primaryRestaurantId = String(mainRestaurant._id);

  const restaurantSettlement = [];
  let totalRestaurantCommission = 0;
  for (const group of restaurantGroups) {
    const foodAmount = Number(group.subtotal) || 0;
    const packaging = Number(group.packagingFee) || 0;
    const { commissionAmount } = await foodTransactionService.getRestaurantCommissionSnapshot({
      pricing: { subtotal: foodAmount },
      restaurantId: group.restaurantId,
    });
    const commission = Number(commissionAmount) || 0;
    const commissionGST = Number((commission * 0.18).toFixed(2));
    const speedShare = 0;
    const couponDiscount =
      isRestaurantCoupon && foodDiscount > 0 && String(group.restaurantId) === primaryRestaurantId
        ? foodDiscount
        : 0;
    const restaurantPayout = Math.max(
      0,
      Number((foodAmount + packaging + speedShare - commission - couponDiscount).toFixed(2)),
    );
    totalRestaurantCommission += commission;
    restaurantSettlement.push({
      restaurantId: group.restaurantId,
      restaurantName: group.restaurantName || '',
      foodAmount,
      packagingFee: packaging,
      commission,
      commissionGST,
      speedShare,
      couponDiscount,
      restaurantPayout,
    });
  }

  normalizedPricing.restaurantCommission = totalRestaurantCommission || 0;

  const customerDeliveryFeePaid = Math.max(
    0,
    normalizedPricing.deliveryFee - Number(normalizedPricing.deliveryDiscount || 0),
  );
  const deliveryMarginBase = Math.max(
    0,
    Number(
      (
        Number(breakdown.deliveryMarginBase) ||
        Math.max(0, (Number(breakdown.baseFee) || 0) - (Number(breakdown.riderBaseFee) || 0))
      ).toFixed(2),
    ),
  );
  // Invoice delivery margin for platform = slab gap + admin's speed third (or negative speed bear)
  const deliveryMargin = Math.max(
    0,
    Number((deliveryMarginBase + Math.max(0, speedShareAdmin)).toFixed(2)),
  );

  const tipAmount = Number(dto.tip || 0) || 0;
  const driverSettlement = {
    deliveryFee: customerDeliveryFeePaid,
    tip: tipAmount,
    incentive: 0,
    driverPayout: Math.max(0, Number((riderEarning + tipAmount).toFixed(2))),
  };

  const platformRevenue = {
    platformFee: Number(normalizedPricing.platformFee) || 0,
    commission: totalRestaurantCommission || 0,
    deliveryMargin,
  };

  const adminCouponDiscount = isAdminCoupon ? foodDiscount : 0;
  const platformSubsidy = Number(normalizedPricing.platformSubsidy) || 0;
  const negativeSpeedBear = speedShareAdmin < 0 ? Math.abs(speedShareAdmin) : 0;

  // Net platform profit: use what the customer actually paid for delivery (not gross fee),
  // do not subtract platformSubsidy separately (waived delivery is already ₹0 customer charge).
  const rawPlatformProfit = Number(
    (
      Number(normalizedPricing.platformFee) +
      customerDeliveryFeePaid +
      totalRestaurantCommission -
      riderEarning -
      speedShareRestaurantTotal -
      adminCouponDiscount -
      negativeSpeedBear
    ).toFixed(2),
  );
  const platformProfit = Math.max(0, rawPlatformProfit);

  const costBearers = [];
  if (platformSubsidy > 0) {
    costBearers.push({
      type: 'free_delivery',
      amount: platformSubsidy,
      bearer: 'admin',
      note: 'Customer delivery waived; driver still receives Delivery Boy Fee',
    });
  }
  if (adminCouponDiscount > 0) {
    costBearers.push({
      type: 'admin_coupon',
      amount: adminCouponDiscount,
      bearer: 'admin',
      note: 'Admin coupon; restaurant and driver payouts unchanged',
    });
  }
  if (isRestaurantCoupon && foodDiscount > 0) {
    costBearers.push({
      type: 'restaurant_coupon',
      amount: foodDiscount,
      bearer: 'restaurant',
      note: 'Restaurant coupon deducted from restaurant payout',
    });
  }
  if (negativeSpeedBear > 0) {
    costBearers.push({
      type: 'negative_speed',
      amount: negativeSpeedBear,
      bearer: 'admin',
      note: 'Negative Cart Delivery Speed fee borne by admin',
    });
  }

  const settlementBreakdown = {
    customer: {
      paid: Number(normalizedPricing.total) || 0,
      foodSubtotal: Number(normalizedPricing.foodSubtotal || normalizedPricing.subtotal) || 0,
      packagingFee: Number(normalizedPricing.packagingFee) || 0,
      deliveryFee: Number(normalizedPricing.deliveryFee) || 0,
      deliveryPaid: customerDeliveryFeePaid,
      deliveryDiscount: Number(normalizedPricing.deliveryDiscount) || 0,
      platformFee: Number(normalizedPricing.platformFee) || 0,
      tax: Number(normalizedPricing.tax) || 0,
      discount: foodDiscount,
      couponCode: normalizedPricing.couponCode || null,
      couponCreatedBy: normalizedPricing.couponCreatedBy || null,
    },
    restaurants: restaurantSettlement.map((s) => ({
      restaurantId: s.restaurantId,
      restaurantName: s.restaurantName,
      foodAmount: s.foodAmount,
      packagingFee: s.packagingFee,
      commission: s.commission,
      speedShare: s.speedShare,
      couponDiscount: s.couponDiscount,
      payout: s.restaurantPayout,
    })),
    driver: {
      employmentType: 'per_order',
      deliveryBoyFee: Number(breakdown.deliveryBoyFee) || 0,
      riderBaseFee: Number(breakdown.riderBaseFee) || riderEarning,
      speedShare: speedShareDriver,
      tip: tipAmount,
      payout: Math.max(0, Number((riderEarning + tipAmount).toFixed(2))),
      note: 'Per-order earning from Delivery Boy Fee (+ speed share).',
    },
    platform: {
      platformFee: Number(normalizedPricing.platformFee) || 0,
      restaurantCommission: totalRestaurantCommission || 0,
      deliveryMarginBase,
      speedShare: Math.max(0, speedShareAdmin),
      adminCouponDiscount,
      freeDeliverySubsidy: platformSubsidy,
      negativeSpeedBear,
      netProfit: rawPlatformProfit,
      netProfitStored: platformProfit,
    },
    speed: {
      feeModifier: Number(breakdown.speedFeeModifier) || 0,
      admin: speedShareAdmin,
      restaurant: 0,
      driver: speedShareDriver,
      driverShareConfigured: Number(breakdown.speedDriverShareConfigured) || 0,
    },
    costBearers,
  };

  const payment = verifiedPrepaid
    ? {
      method: "razorpay",
      status: "paid",
      amountDue: normalizedPricing.total,
      razorpay: {
        orderId: verifiedPrepaid.razorpayOrderId,
        paymentId: verifiedPrepaid.razorpayPaymentId,
        signature: verifiedPrepaid.razorpaySignature,
      },
      qr: {},
    }
    : {
      method: paymentMethod,
      status: isCash ? "cod_pending" : isWallet ? "paid" : "created",
      amountDue: normalizedPricing.total,
      razorpay: {},
      qr: {},
    };

  const isScheduledOrder = dto.scheduledAt && new Date(dto.scheduledAt) > new Date();

  const order = new FoodOrder({
    userId: new mongoose.Types.ObjectId(userId),
    restaurantId: mainRestaurant._id,
    isMultiRestaurant: restaurants.length > 1,
    pickups,
    zoneId: mainRestaurant.zoneId,
    items: pricedItems,
    deliveryAddress,
    customerName: deliveryAddress.name,
    customerPhone: deliveryAddress.phone,
    pricing: normalizedPricing,
    restaurantSettlement,
    driverSettlement,
    platformRevenue,
    settlementBreakdown,
    payment,
    orderStatus: isScheduledOrder ? "scheduled" : "created",
    restaurantNote: dto.restaurantNote || "",
    note: dto.note || "",
    sendCutlery: dto.sendCutlery !== false,
    scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
    riderEarning,
    platformProfit,
    deliveryFleet: dto.deliveryFleet || "standard",
    deliveryOption: orderDeliveryOptionName,
    deliveryTime: orderDeliveryTimeLabel,
    estimatedTime: orderEstimatedMinutes,
    dispatch: { modeAtCreation: dispatchMode, status: "unassigned" },
    statusHistory: [
      {
        at: new Date(),
        byRole: "SYSTEM",
        from: "",
        to: isScheduledOrder ? "scheduled" : "created",
        note: verifiedPrepaid
          ? "Order placed after prepaid payment"
          : isScheduledOrder
            ? "Scheduled order placed"
            : "Order placed",
      },
    ],
  });

  pushSettlementSnapshot(order, 'create', 'Initial pricing and rider earning frozen at create');
  await order.save();

  await reconcileRestaurantLimitAfterInsert(userId, order._id);

  if (isWallet) {
    try {
      await userWalletService.deductWalletBalance(userId, order.pricing.total, `Payment for order #${order.order_id || order._id}`, { orderId: order._id });
    } catch (err) {
      await FoodOrder.deleteOne({ _id: order._id });
      throw err;
    }
  }

  await foodTransactionService.createInitialTransaction({
    ...(order.toObject?.() || order),
    pricing: normalizedPricing,
    payment,
  });

  if (verifiedPrepaid) {
    try {
      await foodTransactionService.updateTransactionStatus(order._id, 'captured', {
        status: 'captured',
        razorpayPaymentId: verifiedPrepaid.razorpayPaymentId,
        razorpaySignature: verifiedPrepaid.razorpaySignature,
        recordedByRole: "USER",
        recordedById: new mongoose.Types.ObjectId(userId),
        note: 'Payment verified before order create',
      });
    } catch (err) {
      logger.warn(`Failed to mark transaction captured for prepaid order ${order._id}: ${err?.message || err}`);
    }
  }

  try {
    await notifyOwnersSafely([{ ownerType: "USER", ownerId: userId }], {
      title: "Order Confirmed! 🍔",
      body: `Your order #${order.order_id || order._id} has been placed successfully.`,
      data: {
        type: "order_created",
        orderId: String(order._id),
        link: `/food/user/orders/${order._id}`,
      },
    });
  } catch { }

  const couponCode = dto.pricing?.couponCode ? String(dto.pricing.couponCode).trim().toUpperCase() : "";
  if (couponCode) {
    const offer = await FoodOffer.findOne({ couponCode, isDeleted: { $ne: true } }).lean();
    if (offer) {
      await recordOfferRedemption({ offer, order, userId });
    }
  }

  const dispatchableStatuses = ["created", "confirmed", "preparing", "ready_for_pickup", "ready", "picked_up"];
  if (
    dispatchMode === "auto"
    && (isCash || isWallet || order.payment.status === "paid" || order.payment.status === "cod_pending")
    && dispatchableStatuses.includes(order.orderStatus)
  ) {
    try {
      await dispatchService.tryAutoAssign(order._id);
    } catch { }
  }

  // Cart clear for confirmed orders (COD / wallet / prepaid-verified razorpay)
  if (isCash || isWallet || verifiedPrepaid) {
    await clearUserCartAfterOrder(userId);
  }

  const clientOrder = normalizeOrderForClient(order);
  return {
    order: clientOrder,
    orderId: String(order._id),
    orderNumber: order.order_id || clientOrder?.order_id || String(order._id),
    paymentType: verifiedPrepaid ? 'PREPAID' : (isCash ? 'COD' : (isWallet ? 'WALLET' : 'PREPAID')),
    amount: normalizedPricing.total,
    pricing: normalizedPricing,
    razorpay: null,
    requiresPayment: false,
  };
}

// ----- Verify payment -----
/**
 * Prepaid flow: checkoutId + Razorpay proof → verify server-side → create FoodOrder.
 * Legacy: orderId (unpaid FoodOrder created before pay) still supported.
 */
export async function verifyPayment(userId, dto) {
  // New pay-then-place flow
  if (dto.checkoutId) {
    const session = await checkoutService.getCheckoutSessionForUser(dto.checkoutId, userId);

    if (session.status === 'completed' && session.foodOrderId) {
      const existing = await FoodOrder.findById(session.foodOrderId);
      if (existing) {
        return { order: normalizeOrderForClient(existing), payment: existing.payment, checkoutId: String(session._id) };
      }
    }

    const { alreadyCompleted } = await checkoutService.verifyCheckoutPayment(session, {
      razorpayOrderId: dto.razorpayOrderId,
      razorpayPaymentId: dto.razorpayPaymentId,
      razorpaySignature: dto.razorpaySignature,
    });

    if (alreadyCompleted && session.foodOrderId) {
      const existing = await FoodOrder.findById(session.foodOrderId);
      if (existing) {
        return { order: normalizeOrderForClient(existing), payment: existing.payment, checkoutId: String(session._id) };
      }
    }

    const claimed = await checkoutService.claimCheckoutForOrderCreate(session._id, {
      razorpayPaymentId: dto.razorpayPaymentId,
      razorpaySignature: dto.razorpaySignature,
    });

    if (!claimed) {
      const fresh = await checkoutService.getCheckoutSessionForUser(dto.checkoutId, userId);
      if (fresh.foodOrderId) {
        const existing = await FoodOrder.findById(fresh.foodOrderId);
        if (existing) {
          return { order: normalizeOrderForClient(existing), payment: existing.payment, checkoutId: String(fresh._id) };
        }
      }
      throw new ValidationError('Checkout is being processed. Please wait.');
    }

    const result = await createOrder(userId, claimed.orderPayload, {
      verifiedPrepaid: {
        razorpayOrderId: dto.razorpayOrderId,
        razorpayPaymentId: dto.razorpayPaymentId,
        razorpaySignature: dto.razorpaySignature,
        expectedAmount: claimed.amountDue,
      },
    });

    if (!result?.order?._id) {
      throw new ValidationError('Failed to create order after payment');
    }

    await checkoutService.markCheckoutCompleted(claimed, result.order._id);

    return {
      order: result.order,
      payment: result.order.payment,
      checkoutId: String(claimed._id),
    };
  }

  // Legacy: order already created, mark paid
  const identity = buildOrderIdentityFilter(dto.orderId);
  if (!identity) throw new ValidationError("Order id or checkoutId required");

  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!order) throw new NotFoundError("Order not found");
  if (order.payment.status === "paid")
    return { order: normalizeOrderForClient(order), payment: order.payment };

  const valid = verifyPaymentSignature(
    dto.razorpayOrderId,
    dto.razorpayPaymentId,
    dto.razorpaySignature,
  );
  if (!valid) throw new ValidationError("Payment verification failed");

  order.payment.status = "paid";
  order.payment.razorpay.paymentId = dto.razorpayPaymentId;
  order.payment.razorpay.signature = dto.razorpaySignature;
  pushStatusHistory(order, {
    byRole: "USER",
    byId: userId,
    from: order.orderStatus,
    to: "created",
    note: "Payment verified",
  });
  await order.save();

  await foodTransactionService.updateTransactionStatus(order._id, 'captured', {
    status: 'captured',
    razorpayPaymentId: dto.razorpayPaymentId,
    razorpaySignature: dto.razorpaySignature,
    recordedByRole: "USER",
    recordedById: new mongoose.Types.ObjectId(userId)
  });

  // Notify Customer about payment success
  await notifyOwnersSafely([{ ownerType: "USER", ownerId: userId }], {
    title: "Payment Successful! ✅",
    body: `We have received your payment of ₹${order.payment.amountDue} for Order #${order._id.toString()}.`,
    image: "https://i.ibb.co/3m2Yh7r/Appzeto-Brand-Image.png",
    data: {
      type: "payment_success",
      orderId: String(order._id.toString()),
      orderMongoId: String(order._id),
    },
  });

  const settings = await getDispatchSettings();
  const dispatchableStatuses = [
    "created",
    "confirmed",
    "preparing",
    "ready_for_pickup",
    "ready",
    "picked_up",
  ];
  if (settings.dispatchMode === "auto" && dispatchableStatuses.includes(order.orderStatus)) {
    try {
      await tryAutoAssign(order._id);
    } catch { }
  }

  await clearUserCartAfterOrder(userId);

  return { order: normalizeOrderForClient(order), payment: order.payment };
}

export async function cancelCheckout(userId, checkoutId) {
  const session = await checkoutService.cancelCheckoutSession(checkoutId, userId);
  return {
    checkoutId: String(session._id),
    status: session.status,
  };
}

/**
 * Webhook helper: if payment captured for a checkout session, create the FoodOrder.
 * Idempotent — safe to call alongside client verifyPayment.
 */
export async function finalizeCheckoutFromWebhook(rzOrderId, rzPaymentId) {
  const session = await checkoutService.findCheckoutByRazorpayOrderId(rzOrderId);
  if (!session) return null;
  if (session.status === 'completed' && session.foodOrderId) {
    return FoodOrder.findById(session.foodOrderId);
  }
  if (checkoutService.isCheckoutExpired(session) && session.status === 'pending_payment') {
    session.status = 'expired';
    await session.save();

    // The customer's money WAS captured — we are just past the 30-minute checkout window.
    // Silently returning here left them charged with no order and no refund. Refund it and
    // alert an admin; never keep money for an order that will not exist.
    try {
      const { initiateRazorpayRefund } = await import('../helpers/razorpay.helper.js');
      const refund = await initiateRazorpayRefund(rzPaymentId, Number(session.amountDue || 0));
      logger.warn(
        `Checkout ${session._id} expired but payment ${rzPaymentId} was captured. ` +
        `Auto-refund ${refund.success ? 'initiated' : 'FAILED'}: ${refund.refundId || refund.error}`,
      );
      await notifyOwnersSafely([{ ownerType: 'ADMIN', ownerId: 'GLOBAL' }], {
        title: refund.success ? 'Expired checkout auto-refunded' : 'Expired checkout refund FAILED',
        body: `Payment ${rzPaymentId} (₹${session.amountDue}) arrived after checkout ${session._id} expired.`,
        data: { type: 'expired_checkout_payment', checkoutId: String(session._id), paymentId: String(rzPaymentId) },
      });
    } catch (refundErr) {
      logger.error(
        `CRITICAL: expired checkout ${session._id} was paid (${rzPaymentId}) and auto-refund threw: ${refundErr.message}. Manual refund required.`,
      );
    }
    return null;
  }

  const claimed = await checkoutService.claimCheckoutForOrderCreate(session._id, {
    razorpayPaymentId: rzPaymentId,
  });
  if (!claimed) {
    const fresh = await FoodCheckoutSession.findById(session._id);
    if (fresh?.foodOrderId) return FoodOrder.findById(fresh.foodOrderId);
    return null;
  }

  const result = await createOrder(String(claimed.userId), claimed.orderPayload, {
    verifiedPrepaid: {
      razorpayOrderId: rzOrderId,
      razorpayPaymentId: rzPaymentId,
      razorpaySignature: claimed.razorpay?.signature || 'webhook',
      expectedAmount: claimed.amountDue,
    },
  });

  if (result?.order?._id) {
    await checkoutService.markCheckoutCompleted(claimed, result.order._id);
    return result.order;
  }
  return null;
}

// ----- Auto-assign -----

/**
 * Start or continue a smart cascading dispatch.
 * @param {string} orderId - Mongo ID of the order.
 * @param {object} options - Options (retry count, etc)
 */
export async function tryAutoAssign(orderId, options = {}) {
  return dispatchService.tryAutoAssign(orderId, options);
}

/**
 * Triggered by worker after 60 seconds of zero response.
 */
export async function processDispatchTimeout(orderId, partnerId, options = {}) {
  return dispatchService.processDispatchTimeout(orderId, partnerId, options);
}

async function applyOrderRefundIfPaid(order, { recordedByRole = 'SYSTEM', recordedById = null, note = '', preferWallet = false } = {}) {
  const paymentMethod = String(order.payment?.method || 'cash').toLowerCase();
  const paymentStatus = String(order.payment?.status || 'cod_pending').toLowerCase();
  const hasRefundProcessed =
    String(order.payment?.refund?.status || 'none').toLowerCase() === 'processed';

  if (paymentStatus !== 'paid' || hasRefundProcessed) return order;

  const refundToWallet = async () => {
    await userWalletService.refundWalletBalance(
      order.userId,
      order.pricing.total,
      note || `Refund for order #${order.order_id || order._id}`,
      { orderId: order._id },
    );
    order.payment.status = 'refunded';
    order.payment.refund = {
      status: 'processed',
      destination: 'wallet',
      amount: order.pricing.total,
      processedAt: new Date(),
    };
  };

  if (paymentMethod === 'razorpay' && order.payment?.razorpay?.paymentId) {
    if (preferWallet) {
      try {
        await refundToWallet();
      } catch (err) {
        logger.warn(`applyOrderRefundIfPaid wallet (razorpay→wallet) failed for ${order._id}: ${err?.message || err}`);
        order.payment.refund = { status: 'failed', destination: 'wallet', amount: order.pricing.total };
      }
    } else {
      try {
        const refundResult = await initiateRazorpayRefund(
          order.payment.razorpay.paymentId,
          order.pricing.total,
        );
        if (refundResult.success) {
          order.payment.status = 'refunded';
          order.payment.refund = {
            status: 'processed',
            destination: 'source',
            amount: order.pricing.total,
            refundId: refundResult.refundId,
            processedAt: new Date(),
          };
        } else {
          order.payment.refund = { status: 'failed', destination: 'source', amount: order.pricing.total };
        }
      } catch (err) {
        logger.warn(`applyOrderRefundIfPaid razorpay failed for ${order._id}: ${err?.message || err}`);
        order.payment.refund = { status: 'failed', destination: 'source', amount: order.pricing.total };
      }
    }
  } else if (paymentMethod === 'wallet') {
    try {
      await refundToWallet();
    } catch (err) {
      logger.warn(`applyOrderRefundIfPaid wallet failed for ${order._id}: ${err?.message || err}`);
      order.payment.refund = { status: 'failed', destination: 'wallet', amount: order.pricing.total };
    }
  }

  try {
    const finalPaymentMethod = String(order.payment?.method || paymentMethod).toLowerCase();
    const finalPaymentStatus = String(order.payment?.status || paymentStatus).toLowerCase();
    const isOnlinePaid =
      finalPaymentMethod === 'razorpay' &&
      (finalPaymentStatus === 'paid' || finalPaymentStatus === 'refunded');
    await foodTransactionService.updateTransactionStatus(order._id, order.orderStatus, {
      status: isOnlinePaid ? 'refunded' : 'failed',
      note: note || 'Order cancelled with refund',
      recordedByRole,
      recordedById,
    });
  } catch (err) {
    logger.warn(`applyOrderRefundIfPaid transaction sync failed: ${err?.message || err}`);
  }

  return order;
}

/**
 * Cancel order when no delivery partner accepts after all dispatch retries.
 */
export async function cancelOrderNoDriverFound(orderId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) return null;

  const order = await FoodOrder.findOne({
    ...identity,
    orderStatus: { $in: ['created', 'scheduled'] },
    'dispatch.status': { $in: ['unassigned', 'offered', 'assigned'] },
  });
  if (!order) return null;

  const from = order.orderStatus;
  const cancelNote = 'No delivery partner found. Order cancelled and refund initiated where applicable.';
  order.orderStatus = 'cancelled_by_admin';
  freeOrderDispatch(order);
  pushStatusHistory(order, {
    byRole: 'SYSTEM',
    from,
    to: 'cancelled_by_admin',
    note: cancelNote,
  });

  await applyOrderRefundIfPaid(order, { note: cancelNote, preferWallet: true });
  applyCancellationSettlement(order, {
    cancelledBy: 'system',
    note: cancelNote,
  });
  pushSettlementSnapshot(order, 'admin_cancel', cancelNote);
  await order.save();

  const refundDetail =
    order.payment?.status === 'refunded'
      ? order.payment?.refund?.destination === 'wallet'
        ? ` ₹${order.pricing.total} has been credited to your wallet.`
        : ` Your refund of ₹${order.pricing.total} is being processed.`
      : '';

  try {
    const io = getIO();
    if (io) {
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        orderStatus: order.orderStatus,
        title: 'Delivery partner not found',
        message: `We couldn't find a delivery partner for your order.${refundDetail}`,
        failureReason: 'driver_not_found',
        dispatch: order.dispatch || null,
        payment: order.payment || null,
      };
      io.to(rooms.user(order.userId)).emit('order_status_update', payload);
    }
  } catch (err) {
    logger.warn(`cancelOrderNoDriverFound socket emit failed: ${err?.message || err}`);
  }

  await notifyOwnersSafely(
    [{ ownerType: 'USER', ownerId: order.userId }],
    {
      title: 'Delivery partner not found',
      body: `We couldn't find a delivery partner near you. Your order has been cancelled.${refundDetail}`,
      data: {
        type: 'driver_not_found',
        orderId: String(order._id),
        orderMongoId: String(order._id),
      },
    },
  );

  enqueueOrderEvent('order_cancelled_no_driver', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
  });

  return normalizeOrderForClient(order);
}

async function finalizeRestaurantRejectionExhausted(order, restaurantId, note = '') {
  const from = order.orderStatus;
  const assignedRiderId = order.dispatch?.deliveryPartnerId;
  const cancelNote =
    note ||
    'Restaurant rejected the order. Order cancelled, driver released, and refund initiated where applicable.';

  order.orderStatus = 'cancelled_by_restaurant';
  freeOrderDispatch(order);
  pushStatusHistory(order, {
    byRole: 'SYSTEM',
    byId: restaurantId,
    from,
    to: 'cancelled_by_restaurant',
    note: cancelNote,
  });

  await applyOrderRefundIfPaid(order, {
    recordedByRole: 'RESTAURANT',
    recordedById: restaurantId,
    note: cancelNote,
    preferWallet: true,
  });
  applyCancellationSettlement(order, {
    cancelledBy: 'restaurant',
    note: cancelNote,
  });
  pushSettlementSnapshot(order, 'admin_cancel', cancelNote);
  await order.save();

  const refundDetail =
    order.payment?.status === 'refunded'
      ? order.payment?.refund?.destination === 'wallet'
        ? ` ₹${order.pricing.total} has been credited to your wallet.`
        : ` Your refund of ₹${order.pricing.total} is being processed.`
      : '';
  const userMessage = `The restaurant is not accepting this order.${refundDetail}`;
  const riderMessage = `Restaurant rejected order #${order.order_id || order._id}. You are now free to accept new orders.`;

  try {
    const io = getIO();
    if (io) {
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        orderStatus: order.orderStatus,
        title: 'Order cancelled — restaurant rejected',
        message: userMessage,
        failureReason: 'restaurant_rejected',
      };
      io.to(rooms.user(order.userId)).emit('order_status_update', payload);
      io.to(rooms.restaurant(restaurantId)).emit('order_status_update', payload);
      if (assignedRiderId) {
        const riderPayload = { ...payload, message: riderMessage };
        io.to(rooms.delivery(assignedRiderId)).emit('order_status_update', riderPayload);
        io.to(rooms.delivery(assignedRiderId)).emit('order_cancelled', riderPayload);
      }
    }
  } catch (err) {
    logger.warn(`finalizeRestaurantRejectionExhausted socket emit failed: ${err?.message || err}`);
  }

  const notifyList = [
    { ownerType: 'USER', ownerId: order.userId },
    { ownerType: 'RESTAURANT', ownerId: restaurantId },
  ];
  if (assignedRiderId) {
    notifyList.push({ ownerType: 'DELIVERY_PARTNER', ownerId: assignedRiderId });
  }

  await notifyOwnersSafely(notifyList, {
    title: 'Order cancelled — restaurant rejected',
    body: userMessage,
    data: {
      type: 'restaurant_rejection_exhausted',
      orderId: String(order._id),
      orderMongoId: String(order._id),
    },
  });

  if (assignedRiderId) {
    await notifyOwnerSafely(
      { ownerType: 'DELIVERY_PARTNER', ownerId: assignedRiderId },
      {
        title: 'Order cancelled',
        body: riderMessage,
        data: {
          type: 'restaurant_rejection_exhausted',
          orderId: String(order._id),
          orderMongoId: String(order._id),
        },
      },
    );
  }

  enqueueOrderEvent('order_cancelled_restaurant_rejection_exhausted', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    restaurantId: String(restaurantId),
    deliveryPartnerId: assignedRiderId ? String(assignedRiderId) : null,
  });

  return order;
}

// ----- User: list, get, cancel -----
export async function listOrdersUser(userId, query) {
  const { page, limit, skip } = buildPaginationOptions(query);
  const filter = { userId: new mongoose.Types.ObjectId(userId) };
  const [docs, total] = await Promise.all([
    FoodOrder.find(filter)
      .populate(
        "restaurantId",
        "restaurantName profileImage area city location rating totalRatings",
      )
      .populate("dispatch.deliveryPartnerId", "name phone rating totalRatings")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FoodOrder.countDocuments(filter),
  ]);
  return buildPaginatedResult({
    docs: docs.map((doc) => normalizeOrderForClient(doc)),
    total,
    page,
    limit,
  });
}

export async function getOrderById(
  orderId,
  { userId, restaurantId, deliveryPartnerId, admin } = {},
) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");
  const order = await FoodOrder.findOne(identity)
    .populate(
      "restaurantId",
      "restaurantName ownerPhone profileImage area city location rating totalRatings primaryContactNumber",
    )
    .populate("dispatch.deliveryPartnerId", "name fullName phone phoneNumber rating totalRatings profileImage avatar")
    .populate("dispatch.sharedPartnerId", "name fullName phone phoneNumber rating totalRatings profileImage avatar")
    .populate("userId", "name fullName phone email")
    .select("+deliveryOtp")
    .lean();
  if (!order) throw new NotFoundError("Order not found");

  if (admin) {
    const out = normalizeOrderForClient(order);
    if (isDualLegActive(order)) {
      out.isDualLeg = true;
      out.legProgress = getLegProgress(order);
      out.legHandoverOtps = getAllLegHandoverOtps(order);
      // Prefer per-leg OTPs; avoid implying a single shared handover code.
      if (out.legHandoverOtps.length) {
        delete out.deliveryOtp;
      }
    }
    return out;
  }

  const orderUserId = order.userId?._id?.toString() || order.userId?.toString();
  const orderRestaurantId = order.restaurantId?._id?.toString() || order.restaurantId?.toString();
  const orderPartnerId = toPartnerId(order.dispatch?.deliveryPartnerId);
  const sharedPartnerId = toPartnerId(order.dispatch?.sharedPartnerId);

  if (userId && orderUserId !== userId.toString())
    throw new ForbiddenError("Not your order");

  if (deliveryPartnerId && orderPartnerId !== deliveryPartnerId.toString() && sharedPartnerId !== deliveryPartnerId.toString()) {
    throw new ForbiddenError("Not your delivery order");
  }
  if (restaurantId) {
    const restaurantIdStr = restaurantId.toString();
    const isPrimaryRestaurant = orderRestaurantId === restaurantIdStr;
    const isPickupRestaurant = (order.pickups || []).some(
      (p) => String(p.restaurantId || '') === restaurantIdStr,
    );
    if (!isPrimaryRestaurant && !isPickupRestaurant) {
      throw new ForbiddenError("Not your restaurant order");
    }

    // Enforce: Restaurant cannot see the order until a rider has accepted it.
    // Past/completed orders remain viewable (finance history, all-orders, etc.).
    const dispatchStatus = String(order.dispatch?.status || '').toLowerCase();
    const orderStatus = String(order.orderStatus || '').toLowerCase();
    const riderAssigned = Boolean(order.dispatch?.deliveryPartnerId);
    const isAccepted = dispatchStatus === 'accepted';
    const isHistorical =
      riderAssigned ||
      ['delivered', 'ready', 'ready_for_pickup', 'picked_up', 'out_for_delivery', 'preparing', 'confirmed'].includes(orderStatus) ||
      orderStatus.includes('cancel') ||
      orderStatus.includes('reject');
    if (!isAccepted && !isHistorical) {
      throw new ForbiddenError("Order is still being assigned to a delivery partner. You will see it once a rider is confirmed.");
    }
  }

  if (deliveryPartnerId && ![orderPartnerId, sharedPartnerId].includes(deliveryPartnerId.toString()))
    throw new ForbiddenError("Not assigned to you");

  if (deliveryPartnerId || restaurantId) {
    if (restaurantId) {
      const scoped = buildRestaurantScopedOrder(order, restaurantId);
      return toRestaurantOrderResponse(scoped);
    }
    return sanitizeOrderForExternal(order);
  }

  if (userId) {
    const drop = order.deliveryVerification?.dropOtp || {};
    const secret = String(order.deliveryOtp || "").trim();
    const extras = {
      deliveryVerification: {
        dropOtp: {
          required: Boolean(drop.required),
          verified: Boolean(drop.verified),
        },
      },
    };
    // Dual-driver: expose both partners + independent per-leg OTPs (available once assigned).
    if (isDualLegActive(order)) {
      extras.isDualLeg = true;
      extras.legProgress = getLegProgress(order);
      extras.legHandoverOtps = getPendingLegHandoverOtps(order, { onlyAtDrop: false });
      // Never collapse dual-leg into a single handoverOtp — that couples both drivers.
    } else if (!drop.verified && secret) {
      extras.handoverOtp = secret;
    }
    return toUserOrderResponse(order, extras);
  }

  return sanitizeOrderForExternal(order);
}

export async function getDropOtpUser(orderId, userId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");
  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  }).select("+deliveryOtp");
  if (!order) throw new NotFoundError("Order not found");

  // Dual-leg: the customer needs one code per driver, each verified independently.
  if (isDualLegActive(order)) {
    const legOtps = getPendingLegHandoverOtps(order, { onlyAtDrop: false });

    if (legOtps.length === 0) {
      throw new ValidationError(
        "OTP will appear once a delivery partner requests it at your location."
      );
    }
    return { otp: legOtps[0].otp, legOtps, isDualLeg: true };
  }

  const phase = order.deliveryState?.currentPhase;
  const isEligible = phase === "at_drop";

  if (!isEligible) {
    throw new ValidationError(
      "OTP will appear once the delivery partner requests it at your location."
    );
  }

  if (!String(order.deliveryOtp || "").trim()) {
    throw new ValidationError(
      "OTP is not available yet. Ask the delivery partner to request OTP again."
    );
  }

  return { otp: order.deliveryOtp };
}

/**
 * Watchdog: Recovers orders stuck in 'assigned' or 'preparing' status for too long.
 * Should be called on server startup.
 */
export async function recoverStuckOrders() {
  const now = new Date();
  const FIVE_MIN = 5 * 60 * 1000;
  const TWO_MIN = 2 * 60 * 1000;

  try {
    // 1. Stuck waiting on a partner who never accepted.
    //    Covers BOTH dispatch states: 'assigned' (a specific partner was locked in) and
    //    'offered' (tryAutoAssign broadcast to a batch). 'offered' was previously missing here,
    //    so the only safety net that runs without BullMQ never matched the state the dispatcher
    //    actually produces — those orders were never re-hunted, only auto-cancelled.
    const STALE_OFFER_MS = 90 * 1000; // 60s offer window + buffer
    const stuckCandidates = await FoodOrder.find({
      'dispatch.status': { $in: ['assigned', 'offered'] },
      'dispatch.acceptedAt': { $exists: false },
      orderStatus: { $nin: ['delivered', 'cancelled_by_user', 'cancelled_by_restaurant'] }
    });

    // 'assigned' carries dispatch.assignedAt; 'offered' does not, so fall back to the newest
    // offeredTo entry. Filtering in JS keeps one query for both shapes.
    const lastDispatchActivityAt = (order) => {
      const offers = Array.isArray(order.dispatch?.offeredTo) ? order.dispatch.offeredTo : [];
      const offerTimes = offers
        .map((o) => (o?.at ? new Date(o.at).getTime() : null))
        .filter((t) => Number.isFinite(t));
      const assignedAt = order.dispatch?.assignedAt
        ? new Date(order.dispatch.assignedAt).getTime()
        : null;
      const candidates = [...offerTimes, assignedAt].filter((t) => Number.isFinite(t));
      return candidates.length ? Math.max(...candidates) : null;
    };

    // Continue the escalation ladder instead of restarting at attempt 1 (which would pin the
    // search radius at 15km forever). Offers record their own attemptNumber.
    const nextDispatchAttempt = (order) => {
      const offers = Array.isArray(order.dispatch?.offeredTo) ? order.dispatch.offeredTo : [];
      const highest = offers.reduce(
        (max, o) => Math.max(max, Number(o?.attemptNumber) || 0),
        0,
      );
      return highest + 1;
    };

    const stuckAssigned = stuckCandidates.filter((order) => {
      const activeAt = lastDispatchActivityAt(order);
      const threshold =
        order.dispatch?.status === 'offered' ? STALE_OFFER_MS : TWO_MIN;
      // No timestamp at all: treat as stale so it can never sit in limbo.
      if (activeAt == null) return true;
      return now.getTime() - activeAt > threshold;
    });

    if (stuckAssigned.length > 0) {
      logger.info(`Watchdog: Healing ${stuckAssigned.length} stuck assigned/offered orders.`);
      for (const order of stuckAssigned) {
        const attempt = nextDispatchAttempt(order);
        // Reset status to unassigned and re-trigger auto-assign
        order.dispatch.status = 'unassigned';
        order.dispatch.deliveryPartnerId = null;
        await order.save();
        await tryAutoAssign(order._id, { attempt });
      }
    }

    // 2. Clear old dispatching locks (cleanup in case of crash)
    await FoodOrder.updateMany(
      { 'dispatch.dispatchingAt': { $lt: new Date(now - FIVE_MIN) } },
      { $unset: { 'dispatch.dispatchingAt': '' } }
    );

    // 3. Driver-first escalation (F-1A): a rider accepted but NO restaurant has accepted yet
    //    (orderStatus still 'created'). Tier 1 (> RESEND): re-notify the restaurant(s) + admin,
    //    once. Tier 2 (> TIMEOUT): auto-reject → refund → release the driver so they're not
    //    stranded on an order the restaurant silently ignores.
    const awaitingRestaurantAck = await FoodOrder.find({
      orderStatus: 'created',
      'dispatch.status': 'accepted',
      'dispatch.acceptedAt': { $lt: new Date(now - RESTAURANT_ACK_RESEND_MS) },
    });

    for (const order of awaitingRestaurantAck) {
      const acceptedMs = order.dispatch?.acceptedAt
        ? new Date(order.dispatch.acceptedAt).getTime()
        : null;
      if (acceptedMs == null) continue;
      const waited = now.getTime() - acceptedMs;

      // Tier 2: timed out → cancel + refund + free driver (reuses the rejection-exhausted path).
      if (waited >= RESTAURANT_ACK_TIMEOUT_MS) {
        try {
          await finalizeRestaurantRejectionExhausted(
            order,
            order.restaurantId,
            'Restaurant did not respond in time. Order auto-cancelled, driver released, and refund initiated where applicable.',
          );
        } catch (err) {
          logger.error(`Watchdog: restaurant-ack auto-cancel failed for ${order._id}: ${err.message}`);
        }
        continue;
      }

      // Tier 1: nudge the restaurant(s) once (throttled by dispatch.restaurantAckResendAt).
      const lastResent = order.dispatch?.restaurantAckResendAt
        ? new Date(order.dispatch.restaurantAckResendAt).getTime()
        : null;
      const alreadyResent =
        lastResent != null && now.getTime() - lastResent < RESTAURANT_ACK_TIMEOUT_MS;
      if (alreadyResent) continue;

      try {
        const activeRestaurantIds =
          Array.isArray(order.pickups) && order.pickups.length > 0
            ? [...new Set(
              order.pickups
                .filter((p) => isActivePickup(p))
                .map((p) => String(p.restaurantId || ''))
                .filter(Boolean),
            )]
            : [String(order.restaurantId || '')].filter(Boolean);
        for (const rid of activeRestaurantIds) {
          await notifyRestaurantNewOrder(order, rid, { freshNotify: true });
        }
        await notifyOwnersSafely([{ ownerType: 'ADMIN', ownerId: 'GLOBAL' }], {
          title: 'Restaurant not responding',
          body: `Order #${order.order_id || order._id} has a driver waiting; the restaurant has not accepted yet.`,
          data: { type: 'restaurant_ack_pending', orderId: order._id.toString() },
        });
        order.dispatch.restaurantAckResendAt = new Date();
        await order.save();
      } catch (err) {
        logger.warn(`Watchdog: restaurant-ack nudge failed for ${order._id}: ${err.message}`);
      }
    }

    // 4. Auto-cancel orders with no accepted driver (see NO_DRIVER_AUTO_CANCEL_MS)
    //
    // Age is measured from when the DRIVER HUNT started, not from createdAt, and 'scheduled'
    // orders are excluded entirely. Both matter:
    //
    //  - A scheduled order sits as orderStatus:'scheduled' until processScheduledOrderAlerts
    //    activates it (only when scheduledAt is within 30 min). Matching 'scheduled' here
    //    cancelled every future order NO_DRIVER_AUTO_CANCEL_MS after it was placed — so an
    //    order scheduled for tonight died minutes after checkout.
    //  - Once activated it becomes 'created' but keeps its original createdAt (hours old), so a
    //    createdAt-based age cancelled it instantly, before a single rider was offered.
    const huntCandidates = await FoodOrder.find({
      orderStatus: 'created',
      'dispatch.status': { $in: ['unassigned', 'offered', 'assigned'] },
      'dispatch.acceptedAt': { $exists: false },
    });

    /** When this order actually started looking for a rider. */
    const huntStartedAt = (order) => {
      const times = [new Date(order.createdAt).getTime()];
      // Scheduled orders are activated by a status transition into 'created' — that, not
      // checkout time, is when the hunt begins.
      for (const h of Array.isArray(order.statusHistory) ? order.statusHistory : []) {
        if (h?.to === 'created' && h?.at) times.push(new Date(h.at).getTime());
      }
      return Math.max(...times.filter(Number.isFinite));
    };

    const noRiderTimeout = huntCandidates.filter(
      (order) => now.getTime() - huntStartedAt(order) > NO_DRIVER_AUTO_CANCEL_MS,
    );

    if (noRiderTimeout.length > 0) {
      logger.info(`Watchdog: Auto-cancelling ${noRiderTimeout.length} orders due to no rider availability.`);
      for (const order of noRiderTimeout) {
        await cancelOrderNoDriverFound(order._id.toString());
      }
    }

  } catch (err) {
    logger.error(`Watchdog recovery error: ${err.message}`);
  }
}

export async function resyncState(userId, role, options = {}) {
  const NON_ACTIVE = [
    "delivered",
    "cancelled_by_user",
    "cancelled_by_restaurant",
    "cancelled_by_admin",
  ];

  // Attach the recovery envelope: the current seq + the recent event tail (or everything after
  // `sinceSeq` when the client supplies it) so a reconnecting client can detect gaps and replay
  // any milestone it missed while offline.
  const withEvents = async (activeOrder, rawOrderId, rawEventSeq = 0) => {
    if (!activeOrder || !rawOrderId) {
      return { activeOrder: activeOrder || null, lastEventSeq: 0, recentEvents: [] };
    }
    let recentEvents = [];
    try {
      const sinceSeq = Number(options.sinceSeq);
      const query = { orderId: rawOrderId };
      if (Number.isFinite(sinceSeq) && sinceSeq > 0) query.seq = { $gt: sinceSeq };
      const rows = await FoodOrderEvent.find(query)
        .sort({ seq: -1 })
        .limit(50)
        .lean();
      recentEvents = rows
        .map((e) => ({ seq: e.seq, eventId: e.eventId, type: e.type, at: e.at, payload: e.payload }))
        .sort((a, b) => a.seq - b.seq);
    } catch (err) {
      logger.warn(`resyncState outbox read failed: ${err?.message || err}`);
    }
    const lastEventSeq =
      Number(rawEventSeq) ||
      (recentEvents.length ? recentEvents[recentEvents.length - 1].seq : 0);
    return { activeOrder, lastEventSeq, recentEvents };
  };

  if (role === "USER") {
    const order = await FoodOrder.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      orderStatus: { $nin: NON_ACTIVE },
    })
      .select("+deliveryOtp")
      .sort({ createdAt: -1 })
      .lean();

    if (order) {
      const out = normalizeOrderForClient(order);
      // Re-add handover OTP if order is picked up
      if (
        (order.deliveryState?.currentPhase === "at_drop" || order.orderStatus === "picked_up") &&
        !order.deliveryVerification?.dropOtp?.verified &&
        order.deliveryOtp
      ) {
        out.handoverOtp = order.deliveryOtp;
      }
      // Dual-leg: the customer needs the pending code for each driver independently.
      if (isDualLegActive(order)) {
        out.isDualLeg = true;
        out.legProgress = getLegProgress(order);
        out.legHandoverOtps = getPendingLegHandoverOtps(order, { onlyAtDrop: false });
        delete out.handoverOtp;
      }
      return withEvents(out, order._id, order.eventSeq);
    }
    return { activeOrder: null, lastEventSeq: 0, recentEvents: [] };
  }

  if (role === "DELIVERY_PARTNER" || role === "DRIVER") {
    const partnerObjectId = new mongoose.Types.ObjectId(userId);
    // Match the primary OR the shared (second) partner, so both legs of a shared order recover.
    const order = await FoodOrder.findOne({
      $or: [
        { "dispatch.deliveryPartnerId": partnerObjectId },
        { "dispatch.sharedPartnerId": partnerObjectId },
      ],
      "dispatch.status": { $in: ["assigned", "accepted"] },
      orderStatus: { $nin: NON_ACTIVE },
    })
      .populate("restaurantId")
      .lean();

    // Dual-leg: once this driver's own leg is delivered, they have no active trip
    // (partner may still be completing). Prevents resurrecting map/route after done.
    if (order && isDualLegActive(order)) {
      const myLeg = getLegForPartner(order, userId);
      if (myLeg && String(myLeg.status || '') === 'delivered') {
        return withEvents(null, order._id, order.eventSeq);
      }
    }

    return withEvents(order ? sanitizeOrderForExternal(order) : null, order?._id, order?.eventSeq);
  }

  return {};
}

export async function cancelOrder(orderId, userId, reason, refundDestination = "source") {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!order) throw new NotFoundError("Order not found");

  const boySettings =
    (await FoodDeliveryBoySettings.findOne({ isActive: true }).sort({ createdAt: -1 }).lean()) ||
    (await FoodDeliveryBoySettings.findOne().sort({ createdAt: -1 }).lean());
  assertCanCancel({ role: 'USER', order, settings: boySettings || {} });

  const allowed = ["created", "scheduled"];
  if (!allowed.includes(order.orderStatus))
    throw new ValidationError("Order cannot be cancelled");

  const from = order.orderStatus;
  order.orderStatus = "cancelled_by_user";
  pushStatusHistory(order, {
    byRole: "USER",
    byId: userId,
    from,
    to: "cancelled_by_user",
    note: reason || "",
  });

  const paymentMethod = String(order.payment?.method || "cash").toLowerCase();
  const paymentStatus = String(order.payment?.status || "cod_pending").toLowerCase();
  const normalizedRefundDestination =
    String(refundDestination || "source").toLowerCase() === "wallet"
      ? "wallet"
      : "source";
  const hasRefundProcessed =
    String(order.payment?.refund?.status || "none").toLowerCase() === "processed";

  // ✅ NEW: Automated Razorpay Refund on User Cancel
  if (
    paymentStatus === "paid" &&
    paymentMethod === "razorpay" &&
    order.payment?.razorpay?.paymentId &&
    !hasRefundProcessed
  ) {
    try {
      if (normalizedRefundDestination === "wallet") {
        await userWalletService.refundWalletBalance(
          userId,
          order.pricing.total,
          `Refund for cancelled order #${order.order_id || order._id}`,
          { orderId: order._id, source: "order_refund_wallet" },
        );
        order.payment.status = "refunded";
        order.payment.refund = {
          status: "processed",
          destination: "wallet",
          amount: order.pricing.total,
          refundId: "",
          processedAt: new Date()
        };
      } else {
        const refundResult = await initiateRazorpayRefund(
          order.payment.razorpay.paymentId,
          order.pricing.total
        );

        if (refundResult.success) {
          order.payment.status = "refunded";
          order.payment.refund = {
            status: "processed",
            destination: "source",
            amount: order.pricing.total,
            refundId: refundResult.refundId,
            processedAt: new Date()
          };
        } else {
          // Log failure but let order cancellation proceed
          order.payment.refund = {
            status: "failed",
            destination: "source",
            amount: order.pricing.total
          };
        }
      }
    } catch (err) {
      console.error(`Refund processing error for Order ${orderId}:`, err);
      order.payment.refund = {
        status: "failed",
        destination: normalizedRefundDestination,
        amount: order.pricing.total,
      };
    }
  } else if (
    paymentStatus === "paid" &&
    paymentMethod === "wallet" &&
    !hasRefundProcessed
  ) {
    try {
      await userWalletService.refundWalletBalance(userId, order.pricing.total, `Refund for cancelled order #${order.order_id || order._id}`, { orderId: order._id });
      order.payment.status = "refunded";
      order.payment.refund = {
        status: "processed",
        destination: "wallet",
        amount: order.pricing.total,
        processedAt: new Date()
      };
    } catch (err) {
      console.error(`Wallet refund processing error for Order ${orderId}:`, err);
      order.payment.refund = { status: "failed", destination: "wallet", amount: order.pricing.total };
    }
  }

  applyCancellationSettlement(order, {
    cancelledBy: 'user',
    note: reason || 'Order cancelled by customer',
  });
  pushSettlementSnapshot(order, 'admin_cancel', reason || 'Order cancelled by customer');

  await order.save();

  enqueueOrderEvent("order_cancelled_by_user", {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    userId,
    reason: reason || "",
  });

  // Sync transaction status
  try {
    const finalPaymentMethod = String(order.payment?.method || paymentMethod || "cash").toLowerCase();
    const finalPaymentStatus = String(order.payment?.status || paymentStatus || "cod_pending").toLowerCase();
    const isOnlinePaid =
      finalPaymentMethod === "razorpay" &&
      (finalPaymentStatus === "paid" || finalPaymentStatus === "refunded");
    await foodTransactionService.updateTransactionStatus(order._id, 'cancelled_by_user', {
      status: isOnlinePaid ? 'refunded' : 'failed',
      note: `Order cancelled by user: ${reason || "No reason"}`,
      recordedByRole: 'USER',
      recordedById: userId
    });
  } catch (err) {
    logger.warn(`cancelOrder transaction sync failed: ${err?.message || err}`);
  }

  // Notify User and Restaurant about the cancellation
  const finalPaymentMethod = String(order.payment?.method || paymentMethod || "cash").toLowerCase();
  const finalPaymentStatus = String(order.payment?.status || paymentStatus || "cod_pending").toLowerCase();
  const isOnlinePaid =
    finalPaymentMethod === "razorpay" &&
    (finalPaymentStatus === "paid" || finalPaymentStatus === "refunded");
  const settledRefundDestination =
    String(order.payment?.refund?.destination || normalizedRefundDestination || "source").toLowerCase() === "wallet"
      ? "wallet"
      : "source";
  const refundDetail = isOnlinePaid
    ? settledRefundDestination === "wallet"
      ? ` Your refund of ₹${order.pricing.total} has been credited to your wallet.`
      : ` Your refund of ₹${order.pricing.total} is being processed and will be credited to your original payment method within 5-7 working days.`
    : "";

  await notifyOwnersSafely(
    [
      { ownerType: "USER", ownerId: userId },
      { ownerType: "RESTAURANT", ownerId: order.restaurantId },
    ],
    {
      title: "Order Cancelled ❌",
      body: `Order #${order.order_id || order._id} has been cancelled successfully.${refundDetail}`,
      image: "https://i.ibb.co/3m2Yh7r/Appzeto-Brand-Image.png",
      data: {
        type: "order_cancelled",
        orderId: String(order._id.toString()),
        orderMongoId: String(order._id),
      },
    },
  );

  // Real-time: status update via socket
  try {
    const io = getIO();
    if (io) {
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        orderStatus: order.orderStatus,
        message: `Order #${order.order_id || order._id} has been cancelled successfully.${refundDetail}`
      };
      io.to(rooms.user(userId)).emit("order_status_update", payload);
      io.to(rooms.restaurant(order.restaurantId)).emit("order_status_update", payload);
    }
  } catch (err) {
    logger.warn(`cancelOrder socket emit failed: ${err?.message || err}`);
  }

  return normalizeOrderForClient(order);
}

export async function submitOrderRatings(orderId, userId, dto) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!order) throw new NotFoundError("Order not found");
  if (String(order.orderStatus) !== "delivered") {
    throw new ValidationError("You can rate only delivered orders");
  }

  const hasDeliveryPartner = !!order.dispatch?.deliveryPartnerId;
  if (hasDeliveryPartner && !dto.deliveryPartnerRating) {
    throw new ValidationError("Delivery partner rating is required");
  }

  const restaurantAlreadyRated = Number.isFinite(
    Number(order?.ratings?.restaurant?.rating),
  );
  const deliveryAlreadyRated = Number.isFinite(
    Number(order?.ratings?.deliveryPartner?.rating),
  );
  if (restaurantAlreadyRated || (hasDeliveryPartner && deliveryAlreadyRated)) {
    throw new ValidationError("Ratings already submitted for this order");
  }

  const now = new Date();
  order.ratings = order.ratings || {};
  order.ratings.restaurant = {
    rating: dto.restaurantRating,
    comment: dto.restaurantComment || "",
    ratedAt: now,
  };

  if (hasDeliveryPartner) {
    order.ratings.deliveryPartner = {
      rating: dto.deliveryPartnerRating,
      comment: dto.deliveryPartnerComment || "",
      ratedAt: now,
    };
  }

  await Promise.all([
    applyAggregateRating(
      FoodRestaurant,
      order.restaurantId,
      dto.restaurantRating,
    ),
    hasDeliveryPartner
      ? applyAggregateRating(
        FoodDeliveryPartner,
        order.dispatch.deliveryPartnerId,
        dto.deliveryPartnerRating,
      )
      : Promise.resolve(),
  ]);

  await order.save();
  enqueueOrderEvent('order_ratings_submitted', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    userId,
    restaurantRating: dto.restaurantRating,
    deliveryPartnerRating: hasDeliveryPartner ? dto.deliveryPartnerRating : null
  });
  return normalizeOrderForClient(order);
}

export async function updateOrderInstructions(orderId, userId, instructions) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!order) throw new NotFoundError("Order not found");

  const allowedStatuses = ['created', 'confirmed', 'preparing'];
  if (!allowedStatuses.includes(order.orderStatus)) {
    throw new ValidationError("Instructions can no longer be updated for this order");
  }

  order.note = String(instructions || "").trim();
  await order.save();
  return order;
}

// ----- Restaurant -----
export async function listOrdersRestaurant(restaurantId, query) {
  const { page, limit, skip } = buildPaginationOptions(query, {
    defaultLimit: 10,
    maxLimit: 50,
  });
  const restaurantObjectId = new mongoose.Types.ObjectId(restaurantId);
  // Driver-first flow: restaurant only sees orders after a rider has accepted.
  // Use $and so restaurant ownership and payment filters do not overwrite each other.
  const andClauses = [
    {
      $or: [
        { restaurantId: restaurantObjectId },
        { 'pickups.restaurantId': restaurantObjectId },
      ],
    },
    { 'dispatch.status': 'accepted' },
    {
      $or: [
        { 'payment.method': { $in: ['cash', 'wallet'] } },
        {
          'payment.status': {
            $in: ['paid', 'authorized', 'captured', 'settled', 'refunded', 'cod_pending'],
          },
        },
      ],
    },
  ];

  const startDate = query.startDate ? new Date(query.startDate) : null;
  const endDate = query.endDate ? new Date(query.endDate) : null;
  const createdAt = {};
  if (startDate && !Number.isNaN(startDate.getTime())) {
    startDate.setHours(0, 0, 0, 0);
    createdAt.$gte = startDate;
  }
  if (endDate && !Number.isNaN(endDate.getTime())) {
    endDate.setHours(23, 59, 59, 999);
    createdAt.$lte = endDate;
  }
  if (Object.keys(createdAt).length > 0) {
    andClauses.push({ createdAt });
  }

  const search = String(query.search || query.q || '').trim();
  if (search) {
    const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    andClauses.push({
      $or: [{ order_id: searchRegex }, { orderId: searchRegex }],
    });
  }

  const filter = { $and: andClauses };
  const [docs, total] = await Promise.all([
    FoodOrder.find(filter)
      .populate("userId", "name phone email profileImage")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FoodOrder.countDocuments(filter),
  ]);
  const scopedDocs = docs.map((doc) => buildRestaurantScopedOrder(doc, restaurantId));
  return buildPaginatedResult({
    docs: scopedDocs.map((d) => toRestaurantOrderResponse(d)),
    total,
    page,
    limit,
  });
}

function computeAggregateOrderStatus(orderDoc) {
  const pickups = Array.isArray(orderDoc?.pickups) ? orderDoc.pickups : [];
  if (pickups.length === 0) return orderDoc?.orderStatus || 'created';

  // Only active (non-dropped) pickups drive the aggregate status
  const active = pickups.filter((p) => isActivePickup(p));
  if (active.length === 0) {
    // All permanently dropped / cancelled — caller should full-cancel
    return 'cancelled_by_restaurant';
  }

  const statuses = active.map((p) => String(p?.status || '')).filter(Boolean);

  // Awaiting resend: at least one cancelled pickup that is NOT permanently dropped
  const awaitingResend = pickups.some(
    (p) =>
      !p.permanentlyDropped &&
      String(p.status || '') === 'cancelled',
  );
  if (awaitingResend) {
    return 'rejected_by_restaurant';
  }

  if (statuses.length && statuses.every((s) => ['ready', 'picked_up'].includes(s))) {
    return 'ready_for_pickup';
  }
  if (statuses.some((s) => s === 'preparing')) return 'preparing';
  if (statuses.some((s) => s === 'accepted')) return 'confirmed';
  if (statuses.some((s) => s === 'pending')) return 'created';
  return 'created';
}

/**
 * Permanently drop a multi-restaurant pickup (first reject when others remain,
 * or after max resend attempts when it is the last restaurant).
 * Continues order with remaining restaurants + partial wallet refund.
 * If no active pickups remain → full cancel + refund.
 */
async function finalizeDroppedRestaurantPartialContinue(order, restaurantId, note = '') {
  const rid = String(restaurantId || '');
  const pickup = (order.pickups || []).find(
    (p) => String(p.restaurantId || '') === rid,
  );
  if (!pickup) {
    throw new ValidationError('Pickup not found for restaurant');
  }

  pickup.permanentlyDropped = true;
  pickup.status = 'cancelled';
  pickup.droppedAt = new Date();

  const active = getActivePickups(order);
  const restaurantName = pickup.restaurantName || 'a restaurant';

  // No restaurants left → full cancel
  if (active.length === 0) {
    return finalizeRestaurantRejectionExhausted(
      order,
      restaurantId,
      note || `${restaurantName} rejected the order. No restaurants remaining.`,
    );
  }

  const refundBreakdown = computeDroppedRestaurantRefundAmount(order, restaurantId);
  const refundAmount = refundBreakdown.amount;

  // Soft-reprice: reduce food/packaging/tax for dropped restaurant only.
  // Delivery fee + platform fee + rider earning stay locked at original order amounts.
  if (order.pricing) {
    const lockedDeliveryFee = Number(order.pricing.deliveryFee) || 0;
    const lockedPlatformFee = Number(order.pricing.platformFee) || 0;
    const lockedDeliveryDiscount = Number(order.pricing.deliveryDiscount) || 0;
    const prevTotal = Number(order.pricing.total) || 0;
    order.pricing.foodSubtotal = Math.max(
      0,
      Number(order.pricing.foodSubtotal || order.pricing.subtotal || 0) - refundBreakdown.foodAmount,
    );
    order.pricing.subtotal = order.pricing.foodSubtotal;
    order.pricing.packagingFee = Math.max(
      0,
      Number(order.pricing.packagingFee || 0) - refundBreakdown.packagingFee,
    );
    order.pricing.restaurantPackagingTotal = order.pricing.packagingFee;
    order.pricing.tax = Math.max(0, Number(order.pricing.tax || 0) - refundBreakdown.taxShare);
    order.pricing.deliveryFee = lockedDeliveryFee;
    order.pricing.platformFee = lockedPlatformFee;
    order.pricing.deliveryDiscount = lockedDeliveryDiscount;
    order.pricing.total = Math.max(0, Number((prevTotal - refundAmount).toFixed(2)));
    if (Array.isArray(order.pricing.restaurantGroups)) {
      order.pricing.restaurantGroups = order.pricing.restaurantGroups.filter(
        (g) => String(g?.restaurantId || '') !== rid,
      );
    }
  }

  if (Array.isArray(order.restaurantSettlement)) {
    order.restaurantSettlement = order.restaurantSettlement.filter(
      (s) => String(s?.restaurantId || '') !== rid,
    );
  }

  // Keep settlement ledger in sync with remaining restaurants after a partial drop.
  // Do NOT mark status as cancelled — the order continues.
  if (order.settlementBreakdown && typeof order.settlementBreakdown === 'object') {
    const remainingSettlements = Array.isArray(order.restaurantSettlement)
      ? order.restaurantSettlement
      : [];
    const remainingCommission = remainingSettlements.reduce(
      (sum, s) => sum + (Number(s.commission) || 0),
      0,
    );
    const partialRefundTotal = (order.partialRefunds || []).reduce(
      (sum, r) => sum + (Number(r?.amount) || 0),
      0,
    );
    const prevCustomer = order.settlementBreakdown.customer || {};
    const originalPaid =
      Number(prevCustomer.originalPaid) ||
      Number(prevCustomer.paid) ||
      Number(order.pricing?.total) + refundAmount ||
      0;
    const nextBreakdown = {
      ...order.settlementBreakdown,
      status: 'active',
      customer: {
        ...prevCustomer,
        originalPaid,
        paid: Number(order.pricing?.total) || 0,
        foodSubtotal: Number(order.pricing?.foodSubtotal ?? order.pricing?.subtotal) || 0,
        packagingFee: Number(order.pricing?.packagingFee) || 0,
        deliveryFee: Number(order.pricing?.deliveryFee) || 0,
        deliveryPaid: Math.max(
          0,
          Number(order.pricing?.deliveryFee || 0) -
            Number(order.pricing?.deliveryDiscount || 0),
        ),
        deliveryDiscount: Number(order.pricing?.deliveryDiscount) || 0,
        platformFee: Number(order.pricing?.platformFee) || 0,
        tax: Number(order.pricing?.tax) || 0,
        partialRefund: partialRefundTotal + (Number(refundAmount) || 0),
        refund: 0,
        note: `${restaurantName} removed; ₹${refundAmount} refunded to customer wallet. Order continues.`,
      },
      restaurants: remainingSettlements.map((s) => ({
        restaurantId: s.restaurantId,
        restaurantName: s.restaurantName,
        foodAmount: s.foodAmount,
        packagingFee: s.packagingFee,
        commission: s.commission,
        speedShare: s.speedShare,
        couponDiscount: s.couponDiscount,
        payout: s.restaurantPayout,
      })),
      platform: {
        ...(order.settlementBreakdown.platform || {}),
        restaurantCommission: remainingCommission,
      },
      driver: {
        ...(order.settlementBreakdown.driver || {}),
      },
    };
    delete nextBreakdown.cancellation;
    if (nextBreakdown.platform) delete nextBreakdown.platform.note;
    if (nextBreakdown.driver) delete nextBreakdown.driver.note;
    order.settlementBreakdown = nextBreakdown;
    order.markModified?.('settlementBreakdown');
    if (order.pricing) {
      order.pricing.restaurantCommission = remainingCommission;
    }
  }

  try {
    await foodTransactionService.voidRestaurantTransaction(
      order._id,
      rid,
      note || `${restaurantName} dropped from multi-restaurant order`,
    );
  } catch (err) {
    logger.warn(
      `Failed to void FoodTransaction for dropped restaurant ${rid} on order ${order._id}: ${err?.message || err}`,
    );
  }

  // Remove dropped restaurant items from active items list (keep for audit in statusHistory)
  const droppedItems = (order.items || []).filter(
    (it) => String(it?.restaurantId || '') === rid,
  );
  order.items = (order.items || []).filter(
    (it) => String(it?.restaurantId || '') !== rid,
  );
  if (order.items.length === 0) {
    // Safety: should have been caught by active.length === 0
    return finalizeRestaurantRejectionExhausted(order, restaurantId, note);
  }

  // If primary restaurantId was dropped, point to first remaining active pickup
  if (String(order.restaurantId || '') === rid) {
    order.restaurantId = active[0].restaurantId;
  }

  // Multi flag if still 2+ active
  order.isMultiRestaurant = active.length > 1;

  let refundStatus = 'processed';
  if (refundAmount > 0 && order.userId) {
    try {
      await userWalletService.refundWalletBalance(
        order.userId,
        refundAmount,
        `Partial refund: ${restaurantName} rejected order #${order.order_id || order._id}`,
        {
          orderId: order._id,
          restaurantId: rid,
          source: 'multi_restaurant_partial_drop',
        },
      );
    } catch (err) {
      refundStatus = 'failed';
      logger.warn(
        `Partial wallet refund failed for order ${order._id}: ${err?.message || err}`,
      );
    }
  }

  if (!Array.isArray(order.partialRefunds)) order.partialRefunds = [];
  order.partialRefunds.push({
    restaurantId: pickup.restaurantId,
    restaurantName,
    amount: refundAmount,
    foodAmount: refundBreakdown.foodAmount,
    packagingFee: refundBreakdown.packagingFee,
    taxShare: refundBreakdown.taxShare,
    destination: 'wallet',
    status: refundStatus,
    at: new Date(),
    note:
      note ||
      `Restaurant permanently removed from multi-restaurant order`,
  });

  const nextStatus = computeAggregateOrderStatus(order);
  const from = order.orderStatus;
  if (nextStatus && nextStatus !== 'cancelled_by_restaurant') {
    order.orderStatus = nextStatus;
  }

  // F-2 #14: if dropping this restaurant leaves every remaining pickup already picked up, the
  // driver is holding all the food — advance straight to the delivery phase so they aren't
  // stranded waiting to "pick up" a restaurant that no longer exists.
  const remainingActive = getActivePickups(order);
  const allRemainingPicked =
    remainingActive.length > 0 &&
    remainingActive.every((p) => String(p.status || '') === 'picked_up');
  if (allRemainingPicked) {
    order.orderStatus = 'picked_up';
    order.deliveryState = {
      ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
      currentPhase: 'en_route_to_delivery',
      status: 'picked_up',
      pickedUpAt: order.deliveryState?.pickedUpAt || new Date(),
    };
  }

  pushStatusHistory(order, {
    byRole: 'SYSTEM',
    byId: restaurantId,
    from,
    to: order.orderStatus,
    note: `${restaurantName} removed from order. ₹${refundAmount} refunded to wallet. Continuing with ${active.length} restaurant(s). Dropped items: ${droppedItems.map((i) => i.name).join(', ')}`,
  });

  pushSettlementSnapshot(
    order,
    'partial_drop',
    `${restaurantName} dropped; partial refund ₹${refundAmount}`,
  );
  await order.save();

  const userMessage =
    refundAmount > 0
      ? `${restaurantName} rejected your order. ₹${refundAmount.toFixed(0)} has been refunded to your wallet. Your order continues with the remaining restaurant(s).`
      : `${restaurantName} rejected your order. Your order continues with the remaining restaurant(s).`;

  const payload = {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    orderStatus: order.orderStatus,
    type: 'order_partial_restaurant_dropped',
    title: 'Restaurant removed from your order',
    message: userMessage,
    restaurantId: rid,
    restaurantName,
    refundAmount,
    refundDestination: 'wallet',
    pricing: order.pricing,
    pickups: order.pickups,
    items: order.items,
    isMultiRestaurant: Boolean(order.isMultiRestaurant),
  };

  try {
    const io = getIO();
    if (io) {
      io.to(rooms.user(order.userId)).emit('order_partial_restaurant_dropped', payload);
      io.to(rooms.user(order.userId)).emit('order_status_update', {
        ...payload,
        failureReason: 'restaurant_partially_dropped',
      });
      const riderId = order.dispatch?.deliveryPartnerId;
      if (riderId) {
        io.to(rooms.delivery(riderId)).emit('order_status_update', {
          ...payload,
          failureReason: 'restaurant_partially_dropped',
          message: `${restaurantName} was removed. Continue with remaining pickups.`,
        });
        if (order.dispatch?.sharedPartnerId) {
          io.to(rooms.delivery(order.dispatch.sharedPartnerId)).emit(
            'order_status_update',
            {
              ...payload,
              failureReason: 'restaurant_partially_dropped',
              message: `${restaurantName} was removed. Continue with remaining pickups.`,
            },
          );
        }
      }

      for (const p of order.pickups || []) {
        const restRid = String(p?.restaurantId || '').trim();
        if (!restRid) continue;
        const scoped = buildRestaurantScopedOrder(order, restRid);
        io.to(rooms.restaurant(restRid)).emit('order_status_update', {
          orderMongoId: order._id?.toString?.(),
          orderId: order._id.toString(),
          orderStatus: scoped.orderStatus || scoped.status,
          status: scoped.status || scoped.orderStatus,
          aggregateOrderStatus: order.orderStatus,
          myPickupStatus: scoped.myPickupStatus,
          restaurantId: restRid,
          pickups: order.pickups,
          pricing: scoped.pricing,
          title: 'Order updated',
          message:
            restRid === rid
              ? `${restaurantName} was removed from this order.`
              : 'Another restaurant was removed. Continue preparing your items.',
        });
      }
    }
  } catch (err) {
    logger.warn(`partial drop socket emit failed: ${err?.message || err}`);
  }

  const riderId = order.dispatch?.deliveryPartnerId
    ? String(order.dispatch.deliveryPartnerId)
    : null;
  const sharedRiderId = order.dispatch?.sharedPartnerId
    ? String(order.dispatch.sharedPartnerId)
    : null;
  const driverTargets = [];
  if (riderId) {
    driverTargets.push({ ownerType: 'DELIVERY_PARTNER', ownerId: riderId });
  }
  if (sharedRiderId && sharedRiderId !== riderId) {
    driverTargets.push({ ownerType: 'DELIVERY_PARTNER', ownerId: sharedRiderId });
  }

  await notifyOwnersSafely(
    [{ ownerType: 'USER', ownerId: order.userId }],
    {
      title: 'Restaurant removed from your order',
      body: userMessage,
      data: {
        type: 'order_partial_restaurant_dropped',
        orderId: String(order._id),
        orderMongoId: String(order._id),
        refundAmount: String(refundAmount),
        restaurantName,
        restaurantId: rid,
      },
    },
  );

  if (driverTargets.length > 0) {
    await notifyOwnersSafely(driverTargets, {
      title: 'Restaurant removed from order',
      body: `${restaurantName} was removed from order #${order.order_id || order._id}. Continue with remaining pickups.`,
      data: {
        type: 'order_partial_restaurant_dropped',
        orderId: String(order._id),
        orderMongoId: String(order._id),
        refundAmount: String(refundAmount),
        restaurantName,
        restaurantId: rid,
      },
    });
  }

  enqueueOrderEvent('order_partial_restaurant_dropped', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    restaurantId: rid,
    refundAmount,
  });

  return order;
}

/**
 * Admin drops one restaurant from a multi-restaurant order.
 * Continues with remaining restaurants + partial wallet refund (same path as restaurant reject).
 */
export async function dropRestaurantFromOrderByAdmin(
  orderId,
  restaurantId,
  adminId,
  reason = '',
) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');
  if (!restaurantId) throw new ValidationError('Restaurant id required');

  const order = await FoodOrder.findOne(identity);
  if (!order) throw new NotFoundError('Order not found');

  const terminal = [
    'delivered',
    'cancelled_by_user',
    'cancelled_by_restaurant',
    'cancelled_by_admin',
  ];
  if (terminal.includes(order.orderStatus)) {
    throw new ValidationError('Order cannot be modified in its current status');
  }

  const active = getActivePickups(order);
  const isMulti =
    Boolean(order.isMultiRestaurant) ||
    active.length > 1 ||
    (Array.isArray(order.pickups) && order.pickups.length > 1);
  if (!isMulti) {
    throw new ValidationError(
      'Use full order cancel for single-restaurant orders',
    );
  }

  const rid = String(restaurantId);
  const pickup = (order.pickups || []).find(
    (p) => String(p.restaurantId || '') === rid && !p.permanentlyDropped,
  );
  if (!pickup) {
    throw new ValidationError('Active pickup not found for this restaurant');
  }

  const restaurantName = pickup.restaurantName || 'Restaurant';
  const note =
    reason?.trim() ||
    `Admin removed ${restaurantName} from multi-restaurant order`;

  pushStatusHistory(order, {
    byRole: 'ADMIN',
    byId: adminId,
    from: order.orderStatus,
    to: order.orderStatus,
    note,
  });

  return finalizeDroppedRestaurantPartialContinue(order, restaurantId, note);
}

export async function updateOrderStatusRestaurant(
  orderId,
  restaurantId,
  orderStatus,
  note = ""
) {
  const identity = buildOrderIdentityFilter(orderId);
  let order = await FoodOrder.findOne({
    ...identity,
    $or: [
      { restaurantId: new mongoose.Types.ObjectId(restaurantId) },
      { 'pickups.restaurantId': new mongoose.Types.ObjectId(restaurantId) },
    ],
  });
  if (!order) throw new NotFoundError("Order not found");
  const from = order.orderStatus;

  const restaurantIdStr = restaurantId.toString();
  const pickup = (order.pickups || []).find(
    (p) => String(p.restaurantId || '') === restaurantIdStr,
  );
  if (order.isMultiRestaurant && !pickup) {
    throw new ForbiddenError("Not your restaurant order");
  }
  if (pickup?.permanentlyDropped) {
    throw new ValidationError('This restaurant has already been removed from the order');
  }

  const isMulti = Boolean(order.isMultiRestaurant && pickup);
  let finalStatus = orderStatus;
  let skipRefund = false;

  const isReject =
    orderStatus === 'cancelled_by_restaurant' || orderStatus === 'rejected_by_restaurant';

  if (isReject) {
    const boySettings =
      (await FoodDeliveryBoySettings.findOne({ isActive: true }).sort({ createdAt: -1 }).lean()) ||
      (await FoodDeliveryBoySettings.findOne().sort({ createdAt: -1 }).lean());
    assertCanCancel({ role: 'RESTAURANT', order, settings: boySettings || {} });
  }

  if (isMulti) {
    if (isReject) {
      // F-2 #14: a restaurant cannot reject once its own items are already picked up, or once
      // the order has left the pickup phase (driver already collected everything and is delivering).
      if (String(pickup.status || '') === 'picked_up') {
        throw new ValidationError('These items have already been picked up and can no longer be rejected.');
      }
      if (['picked_up', 'reached_drop', 'delivered'].includes(order.orderStatus)) {
        throw new ValidationError('The order is already out for delivery and can no longer be rejected.');
      }

      pickup.status = 'cancelled';
      order.restaurantRejectionCount = (order.restaurantRejectionCount || 0) + 1;

      const finalized = await finalizeDroppedRestaurantPartialContinue(
        order,
        restaurantId,
        note,
      );
      return normalizeOrderForClient(finalized);
    } else if (orderStatus === 'confirmed') {
      pickup.status = 'accepted';
    } else if (orderStatus === 'preparing') {
      pickup.status = 'preparing';
    } else if (orderStatus === 'ready_for_pickup' || orderStatus === 'ready') {
      pickup.status = 'ready';
      pickup.readyAt = pickup.readyAt || new Date();
    } else if (orderStatus === 'picked_up') {
      pickup.status = 'picked_up';
    }

    const nextAggregate = computeAggregateOrderStatus(order);
    if (isStatusAdvance(from, nextAggregate)) {
      order.orderStatus = nextAggregate;
    } else if (
      from === 'rejected_by_restaurant' &&
      ['created', 'confirmed', 'preparing', 'ready_for_pickup'].includes(nextAggregate)
    ) {
      order.orderStatus = nextAggregate;
    } else if (nextAggregate === 'rejected_by_restaurant') {
      order.orderStatus = nextAggregate;
    }
  } else {
    if (isReject) {
      // F-2 #14: block a rejection once the order has left the pickup phase.
      if (['picked_up', 'reached_drop', 'delivered'].includes(order.orderStatus)) {
        throw new ValidationError('The order is already out for delivery and can no longer be rejected.');
      }
      const finalized = await finalizeRestaurantRejectionExhausted(
        order,
        restaurantId,
        note,
      );
      return normalizeOrderForClient(finalized);
    }

    if (!isStatusAdvance(from, finalStatus)) {
      throw new ValidationError(`Current order status '${from}' is further ahead than '${finalStatus}'. Order cannot be moved backwards.`);
    }
    order.orderStatus = finalStatus;
    // Keep the pickup row in sync for single-restaurant orders. Readers (restaurant panel,
    // scoped sockets) prefer pickup status; leaving it 'pending' made accepted orders keep
    // showing up as new ones in the restaurant panel.
    if (pickup) {
      pickup.status = derivePickupStatusFromOrderStatus(finalStatus);
    }
  }

  const historyNote = isMulti
    ? `${note ? `${note} - ` : ''}restaurant_status:${orderStatus}`
    : (note || '');
  pushStatusHistory(order, {
    byRole: "RESTAURANT",
    byId: restaurantId,
    from,
    to: order.orderStatus,
    note: historyNote
  });
  await order.save();

  // Custom messages / titles for status updates
  const statusForMessage = isMulti ? order.orderStatus : orderStatus;
  let title = `Order ${order._id.toString()} updated`;
  let body = `Status changed to ${String(statusForMessage).replace(/_/g, " ")}`;

  if (statusForMessage === "confirmed") {
    title = "Order Accepted! 🧑‍🍳";
    const etaLabel =
      String(order.deliveryTime || '').trim() ||
      (Number(order.estimatedTime) > 0 ? `${Number(order.estimatedTime)} mins` : '');
    body = etaLabel
      ? `The restaurant has accepted your order. Estimated delivery: ${etaLabel}.`
      : "The restaurant has accepted your order and is starting to prepare it.";
  } else if (statusForMessage === "preparing") {
    title = "Food is being prepared! 🍳";
    body = "Your food is currently being prepared by the restaurant.";
  } else if (statusForMessage === "ready_for_pickup") {
    title = "Food is ready! 🛍️";
    body = "Your order is ready and waiting to be picked up.";
  } else if (statusForMessage === "rejected_by_restaurant" || finalStatus === "rejected_by_restaurant") {
    title = 'Order Rejected by Restaurant ⚠️';
    body = isMulti
      ? `One restaurant rejected the order. Reason: ${note || "Not specified"}. It has been removed and your order continues with the remaining restaurant(s).`
      : `The restaurant has rejected the order. Reason: ${note || "Not specified"}. Your order has been cancelled and a refund initiated where applicable.`;
  } else if (String(statusForMessage).includes("cancel") || String(finalStatus).includes("cancel")) {
    const isOnlinePaid = order.payment.method === "razorpay" && (order.payment.status === "paid" || order.payment.status === "refunded");
    const refundDetail = isOnlinePaid ? ` Your refund of ₹${order.pricing.total} is being processed and will be credited to your original payment method within 5-7 working days.` : "";

    title = "Order Cancelled ❌";
    body = `Unfortunately, your order has been cancelled by the restaurant.${refundDetail}`;
  }

  // Real-time: status update to restaurant room.
  try {
    const io = getIO();
    if (io) {
      const actingScoped = buildRestaurantScopedOrder(order, restaurantId);
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        // Acting restaurant sees its own pickup-scoped status
        orderStatus: actingScoped.orderStatus || order.orderStatus,
        status: actingScoped.status || order.orderStatus,
        aggregateOrderStatus: order.orderStatus,
        myPickupStatus: actingScoped.myPickupStatus,
        title,
        message: body,
        pickups: order.pickups || [],
        pickupProgress: getPickupProgress(order),
        dispatch: order.dispatch || null,
        deliveryState: order.deliveryState || null,
        isMultiRestaurant: Boolean(order.isMultiRestaurant),
        restaurantId: String(restaurantId),
      };

      const restRoom = rooms.restaurant(restaurantId);
      const userRoom = rooms.user(order.userId);

      io.to(restRoom).emit("order_status_update", payload);
      // User/DP keep aggregate status
      io.to(userRoom).emit("order_status_update", {
        ...payload,
        orderStatus: order.orderStatus,
        status: order.orderStatus,
      });

      // Other multi-restaurant pickups must keep THEIR pending/accept UI — send scoped status
      if (Array.isArray(order.pickups) && order.pickups.length > 1) {
        for (const p of order.pickups) {
          const rid = String(p?.restaurantId || '').trim();
          if (!rid || rid === String(restaurantId) || !isActivePickup(p)) continue;
          const otherScoped = buildRestaurantScopedOrder(order, rid);
          io.to(rooms.restaurant(rid)).emit("order_status_update", {
            ...payload,
            orderStatus: otherScoped.orderStatus,
            status: otherScoped.status,
            myPickupStatus: otherScoped.myPickupStatus,
            restaurantId: rid,
            title: 'Multi-restaurant order update',
            message: 'Another restaurant updated this shared order. Your items still need your action.',
          });
        }
      }

      // Notify assigned riders (primary + shared) so DP UI updates without refresh
      const assignedRiderId = order.dispatch?.deliveryPartnerId;
      const sharedRiderId = order.dispatch?.sharedPartnerId;
      const riderPayload = {
        ...payload,
        orderStatus: order.orderStatus,
        status: order.orderStatus,
      };
      if (assignedRiderId) {
        const riderRoom = rooms.delivery(assignedRiderId);
        io.to(riderRoom).emit("order_status_update", riderPayload);
      }
      if (sharedRiderId) {
        io.to(rooms.delivery(sharedRiderId)).emit("order_status_update", riderPayload);
      }
    }

    const notifyList = [
      { ownerType: "USER", ownerId: order.userId },
      { ownerType: "RESTAURANT", ownerId: restaurantId },
    ];

    const assignedRiderId = order.dispatch?.deliveryPartnerId;
    if (assignedRiderId) {
      notifyList.push({ ownerType: "DELIVERY_PARTNER", ownerId: assignedRiderId });
    }

    let riderTitle = `Order #${order.order_id || order._id} updated`;
    let riderBody = `The order status is now ${String(orderStatus).replace(/_/g, " ")}.`;

    if (String(orderStatus).includes("cancel")) {
      riderTitle = "Order Cancelled ❌";
      riderBody = `Order #${order.order_id || order._id} has been cancelled. Please stop your current task.`;

      // Sync transaction status
      if (!isMulti) {
        try {
          const isOnlinePaid = order.payment.method === "razorpay" && (order.payment.status === "paid" || order.payment.status === "refunded");
          await foodTransactionService.updateTransactionStatus(order._id, 'cancelled_by_restaurant', {
            status: isOnlinePaid ? 'refunded' : 'failed',
            note: `Order cancelled by restaurant/admin`,
            recordedByRole: 'RESTAURANT',
            recordedById: restaurantId
          });
        } catch (err) {
          logger.warn(`updateOrderStatusRestaurant transaction sync failed: ${err?.message || err}`);
        }
      }
    }

    await notifyOwnersSafely(
      notifyList,
      {
        title: title,
        body: body,
        image: "https://i.ibb.co/3m2Yh7r/Appzeto-Brand-Image.png",
        data: {
          type: "order_status_update",
          orderId: order._id.toString(),
          orderMongoId: order._id?.toString?.() || "",
          orderStatus: String(statusForMessage || ""),
          link: `/food/user/orders/${order._id?.toString?.() || ""}`,
        },
      },
    );
  } catch (err) {
    console.error("[DEBUG] Error emitting status update to restaurant:", err);
  }

  // Real-time: delivery request / ready notifications.
  try {
    const io = getIO();
    if (io) {
      // Driver-first flow: only search for riders if none accepted yet
      if (
        (String(statusForMessage) === "preparing" || String(statusForMessage) === "confirmed") &&
        (String(from) !== "preparing" && String(from) !== "confirmed") &&
        order.dispatch?.status !== 'accepted'
      ) {
        try {
          await tryAutoAssign(order._id);
          // Refresh local order state after assignment search
          order = await FoodOrder.findById(order._id);
        } catch (err) {
          console.error(`[DEBUG] Auto-assign in updateOrderStatusRestaurant failed:`, err);
        }
      }

      // When ready for pickup -> ping assigned delivery partner.
      if (String(statusForMessage) === 'ready_for_pickup' && String(from) !== 'ready_for_pickup') {
        const assignedId = order.dispatch?.deliveryPartnerId?.toString?.() || order.dispatch?.deliveryPartnerId;
        if (assignedId) {
          const restaurant = await FoodRestaurant.findById(restaurantId).select('restaurantName location addressLine1 area city state').lean();
          const payload = buildDeliverySocketPayload(order, restaurant);
          logger.info(
            `[DeliveryDispatch] Emitting order_ready to ${rooms.delivery(assignedId)} for order ${order._id.toString()}`,
          );
          io.to(rooms.delivery(assignedId)).emit('order_ready', payload);
        }
      }
    }
  } catch (err) {
    console.error('[DEBUG] Error in delivery notification logic:', err);
  }

  enqueueOrderEvent('restaurant_order_status_updated', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    restaurantId,
    from,
    to: order.orderStatus
  });

  // ✅ NEW: Automated Razorpay Refund on Restaurant Cancel
  // Triggers if the restaurant sets status to a cancelled state (e.g., cancelled_by_restaurant)
  if (
    !skipRefund &&
    String(orderStatus).includes("cancel") &&
    order.payment.status === "paid" &&
    order.payment.method === "razorpay" &&
    order.payment.razorpay?.paymentId &&
    (!order.payment.refund || order.payment.refund.status !== "processed")
  ) {
    try {
      const refundResult = await initiateRazorpayRefund(
        order.payment.razorpay.paymentId,
        order.pricing.total
      );

      if (refundResult.success) {
        order.payment.status = "refunded";
        order.payment.refund = {
          status: "processed",
          amount: order.pricing.total,
          refundId: refundResult.refundId,
          processedAt: new Date()
        };
      } else {
        // Record failure so admin knows a manual refund might be needed
        order.payment.refund = {
          status: "failed",
          amount: order.pricing.total
        };
      }
    } catch (err) {
      console.error(`Automated refund failed for Order ${order._id.toString()} (Restaurant Cancel):`, err);
      order.payment.refund = { status: "failed", amount: order.pricing.total };
    }
    // Re-save order with updated payment status
    await order.save();
  } else if (
    !skipRefund &&
    String(orderStatus).includes("cancel") &&
    order.payment.status === "paid" &&
    order.payment.method === "wallet" &&
    (!order.payment.refund || order.payment.refund.status !== "processed")
  ) {
    try {
      await userWalletService.refundWalletBalance(order.userId, order.pricing.total, `Refund for order #${order.order_id || order._id} cancelled by restaurant`, { orderId: order._id });
      order.payment.status = "refunded";
      order.payment.refund = {
        status: "processed",
        amount: order.pricing.total,
        processedAt: new Date()
      };
    } catch (err) {
      console.error(`Wallet refund processing error for Order ${order._id.toString()}:`, err);
      order.payment.refund = { status: "failed", amount: order.pricing.total };
    }
    // Re-save order with updated payment status
    await order.save();
  }

  return toRestaurantOrderResponse(buildRestaurantScopedOrder(order, restaurantId));
}

/**
 * Manually re-trigger delivery partner search for a restaurant order.
 * Only allowed if status is preparing/ready and no partner has accepted yet.
 */
export async function resendDeliveryNotificationRestaurant(orderId, restaurantId) {
  return dispatchService.resendDeliveryNotificationRestaurant(orderId, restaurantId);
  const order = await FoodOrder.findOne({
    _id: new mongoose.Types.ObjectId(orderId),
    restaurantId: new mongoose.Types.ObjectId(restaurantId)
  });

  if (!order) throw new NotFoundError('Order not found');

  // Allow resend for fresh confirmed orders too, because this route is often
  // used right after restaurant confirmation when the first rider alert was missed.
  const activeStatuses = ['confirmed', 'preparing', 'ready_for_pickup', 'ready'];
  if (!activeStatuses.includes(order.orderStatus)) {
    throw new ValidationError(`Cannot resend notification for order in status: ${order.orderStatus}`);
  }

  // Guard: don't disrupt an active assignment that was already accepted
  if (order.dispatch?.status === 'accepted') {
    throw new ValidationError('A delivery partner has already accepted this order.');
  }

  // Reset dispatch state to unassigned to allow tryAutoAssign to start fresh
  order.dispatch.status = 'unassigned';
  order.dispatch.deliveryPartnerId = null;
  // Clear previously offered partners to give everyone a fresh chance when resending manually.
  order.dispatch.offeredTo = [];

  await order.save();

  // Trigger smart dispatch logic immediately
  await tryAutoAssign(order._id);

  return { success: true };
}

export async function getCurrentTripDelivery(deliveryPartnerId) {
  return deliveryService.getCurrentTripDelivery(deliveryPartnerId);
}

// ----- Delivery: available, accept, reject, status -----
export async function listOrdersAvailableDelivery(deliveryPartnerId, query) {
  return deliveryService.listOrdersAvailableDelivery(deliveryPartnerId, query);
}

export async function acceptOrderDelivery(orderId, deliveryPartnerId) {
  return deliveryService.acceptOrderDelivery(orderId, deliveryPartnerId);
}

export async function setPickupSequenceDelivery(
  orderId,
  deliveryPartnerId,
  restaurantIds,
) {
  return deliveryService.setPickupSequenceDelivery(
    orderId,
    deliveryPartnerId,
    restaurantIds,
  );
}

export async function rejectOrderDelivery(orderId, deliveryPartnerId) {
  return deliveryService.rejectOrderDelivery(orderId, deliveryPartnerId);
}

export async function confirmReachedPickupDelivery(orderId, deliveryPartnerId) {
  return deliveryService.confirmReachedPickupDelivery(orderId, deliveryPartnerId);
}

/**
 * Slide to confirm pickup (Bill uploaded)
 */
export async function confirmPickupDelivery(
  orderId,
  deliveryPartnerId,
  billImageUrl,
) {
  return deliveryService.confirmPickupDelivery(
    orderId,
    deliveryPartnerId,
    billImageUrl,
  );
}

export async function confirmReachedDropDelivery(orderId, deliveryPartnerId) {
  return deliveryService.confirmReachedDropDelivery(orderId, deliveryPartnerId);
}

export async function verifyDropOtpDelivery(orderId, deliveryPartnerId, otp) {
  return deliveryService.verifyDropOtpDelivery(orderId, deliveryPartnerId, otp);
}

export async function completeDelivery(orderId, deliveryPartnerId, body = {}) {
  return deliveryService.completeDelivery(orderId, deliveryPartnerId, body);
}



export async function updateOrderStatusDelivery(orderId, deliveryPartnerId, orderStatus) {
  return deliveryService.updateOrderStatusDelivery(orderId, deliveryPartnerId, orderStatus);
}

export async function confirmSplitDelivery(orderId, deliveryPartnerId) {
  return deliveryService.confirmSplitDelivery(orderId, deliveryPartnerId);
}

// ----- COD QR collection -----
export async function createCollectQr(
  orderId,
  deliveryPartnerId,
  customerInfo = {},
) {
  return paymentService.createCollectQr(orderId, deliveryPartnerId, customerInfo);
}

export async function getPaymentStatus(orderId, deliveryPartnerId) {
  return paymentService.getPaymentStatus(orderId, deliveryPartnerId);
}

// ----- Admin -----
export async function listOrdersAdmin(query) {
  const { page, limit, skip } = buildPaginationOptions(query);
  const filter = {
    $or: [
      { "payment.method": { $in: ["cash", "wallet"] } },
      { "payment.status": { $in: ["paid", "authorized", "captured", "settled", "refunded"] } },
    ],
  };

  const rawStatus =
    typeof query.status === "string" ? query.status.trim().toLowerCase() : "";
  const cancelledBy =
    typeof query.cancelledBy === "string"
      ? query.cancelledBy.trim().toLowerCase()
      : "";
  const restaurantIdRaw =
    typeof query.restaurantId === "string" ? query.restaurantId.trim() : "";
  const userIdRaw =
    typeof query.userId === "string" ? query.userId.trim() : "";
  const deliveryPartnerIdRaw =
    typeof query.deliveryPartnerId === "string"
      ? query.deliveryPartnerId.trim()
      : "";
  const startDateRaw =
    typeof query.startDate === "string" ? query.startDate.trim() : "";
  const endDateRaw =
    typeof query.endDate === "string" ? query.endDate.trim() : "";

  if (userIdRaw && mongoose.Types.ObjectId.isValid(userIdRaw)) {
    filter.userId = new mongoose.Types.ObjectId(userIdRaw);
  }

  if (
    deliveryPartnerIdRaw &&
    mongoose.Types.ObjectId.isValid(deliveryPartnerIdRaw)
  ) {
    const partnerId = new mongoose.Types.ObjectId(deliveryPartnerIdRaw);
    // Include primary assignee (auto or admin) and shared partner trips
    filter.$and = [
      ...(filter.$and || []),
      {
        $or: [
          { "dispatch.deliveryPartnerId": partnerId },
          { "dispatch.sharedPartnerId": partnerId },
        ],
      },
    ];
  }

  if (rawStatus && rawStatus !== "all") {
    switch (rawStatus) {
      case "pending":
        filter.orderStatus = { $in: ["created", "confirmed"] };
        break;
      case "accepted":
        filter.orderStatus = "confirmed";
        break;
      case "processing":
        filter.orderStatus = { $in: ["preparing", "ready_for_pickup"] };
        break;
      case "food-on-the-way":
        filter.orderStatus = "picked_up";
        break;
      case "delivered":
        filter.orderStatus = "delivered";
        break;
      case "canceled":
      case "cancelled":
        filter.orderStatus = {
          $in: [
            "cancelled_by_user",
            "cancelled_by_restaurant",
            "cancelled_by_admin",
          ],
        };
        break;
      case "restaurant-cancelled":
        filter.orderStatus = "cancelled_by_restaurant";
        break;
      case "payment-failed":
        filter["payment.status"] = "failed";
        break;
      case "refunded":
        filter["payment.status"] = "refunded";
        break;
      case "offline-payments":
        filter["payment.method"] = "cash";
        filter.orderStatus = { $in: ["created", "confirmed", "delivered"] };
        break;
      case "scheduled":
        filter.scheduledAt = { $ne: null };
        break;
      case "live":
      case "active":
        // In-progress orders only (exclude delivered / rejected / cancelled)
        filter.orderStatus = {
          $in: [
            "created",
            "scheduled",
            "confirmed",
            "preparing",
            "ready_for_pickup",
            "reached_pickup",
            "picked_up",
            "reached_drop",
          ],
        };
        break;
      default:
        break;
    }
  }

  if (cancelledBy) {
    if (cancelledBy === "restaurant") {
      filter.orderStatus = "cancelled_by_restaurant";
    } else if (cancelledBy === "user" || cancelledBy === "customer") {
      filter.orderStatus = "cancelled_by_user";
    }
  }

  if (restaurantIdRaw && mongoose.Types.ObjectId.isValid(restaurantIdRaw)) {
    filter.restaurantId = new mongoose.Types.ObjectId(restaurantIdRaw);
  }

  if (startDateRaw || endDateRaw) {
    const createdAt = {};
    const start = startDateRaw ? new Date(startDateRaw) : null;
    const end = endDateRaw ? new Date(endDateRaw) : null;
    if (start && !Number.isNaN(start.getTime())) {
      createdAt.$gte = start;
    }
    if (end && !Number.isNaN(end.getTime())) {
      createdAt.$lte = end;
    }
    if (Object.keys(createdAt).length > 0) {
      filter.createdAt = createdAt;
    }
  }

  const [docs, total, statsRows] = await Promise.all([
    FoodOrder.find(filter)
      .select("+deliveryOtp")
      .populate("userId", "name phone email")
      .populate("restaurantId", "restaurantName area city ownerPhone")
      .populate("dispatch.deliveryPartnerId", "name phone")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FoodOrder.countDocuments(filter),
    FoodOrder.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          delivered: {
            $sum: {
              $cond: [{ $eq: ['$orderStatus', 'delivered'] }, 1, 0],
            },
          },
          cancelled: {
            $sum: {
              $cond: [
                {
                  $in: [
                    '$orderStatus',
                    [
                      'cancelled_by_user',
                      'cancelled_by_restaurant',
                      'cancelled_by_admin',
                    ],
                  ],
                },
                1,
                0,
              ],
            },
          },
          totalSpent: {
            $sum: {
              $cond: [
                { $eq: ['$orderStatus', 'delivered'] },
                { $ifNull: ['$pricing.total', 0] },
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  const statsRow = statsRows?.[0] || {};
  const statsTotal = Number(statsRow.total || 0);
  const statsDelivered = Number(statsRow.delivered || 0);
  const statsCancelled = Number(statsRow.cancelled || 0);
  const stats = {
    total: statsTotal,
    delivered: statsDelivered,
    cancelled: statsCancelled,
    inProgress: Math.max(0, statsTotal - statsDelivered - statsCancelled),
    totalSpent: Number(statsRow.totalSpent || 0),
  };

  const paginated = buildPaginatedResult({
    docs: docs.map((d) => normalizeOrderForClient(d)),
    total,
    page,
    limit,
  });
  return { ...paginated, orders: paginated.data, stats };
}

export async function assignDeliveryPartnerAdmin(
  orderId,
  deliveryPartnerId,
  adminId,
) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne(identity).populate(
    "restaurantId",
    "restaurantName location addressLine1 area city state phone",
  );
  if (!order) throw new NotFoundError("Order not found");

  const nonAssignableStatuses = [
    "delivered",
    "cancelled_by_user",
    "cancelled_by_restaurant",
    "rejected_by_restaurant",
    "cancelled_by_admin",
  ];
  if (nonAssignableStatuses.includes(order.orderStatus)) {
    throw new ValidationError(
      order.orderStatus === "rejected_by_restaurant" ||
        order.orderStatus === "cancelled_by_restaurant"
        ? "Cannot reassign driver for an order rejected by the restaurant"
        : "Cannot assign driver for this order",
    );
  }

  const previousPartnerId =
    order.dispatch?.deliveryPartnerId?.toString?.() || null;
  if (previousPartnerId === String(deliveryPartnerId)) {
    throw new ValidationError("This driver is already assigned to the order");
  }

  const partnerIdsToLoad = [
    deliveryPartnerId,
    ...(previousPartnerId ? [previousPartnerId] : []),
  ];
  const partners = await FoodDeliveryPartner.find({
    _id: { $in: partnerIdsToLoad },
  })
    .select("status name phone")
    .lean();
  const partnerById = new Map(partners.map((p) => [String(p._id), p]));

  const partner = partnerById.get(String(deliveryPartnerId));
  if (!partner || partner.status !== "approved") {
    throw new ValidationError("Delivery partner not available");
  }

  const previousPartner = previousPartnerId
    ? partnerById.get(String(previousPartnerId))
    : null;
  const isReassign = Boolean(previousPartnerId);
  const fromDispatchStatus = order.dispatch?.status || "unassigned";
  const assignedAt = new Date();

  const historyNote = isReassign
    ? `Reassigned by admin from ${previousPartner?.name || previousPartnerId} to ${partner.name || deliveryPartnerId}`
    : `Assigned by admin to ${partner.name || deliveryPartnerId}`;

  order.dispatch = order.dispatch || {};
  if (!Array.isArray(order.dispatch.assignmentHistory)) {
    order.dispatch.assignmentHistory = [];
  }
  order.dispatch.assignmentHistory.push({
    at: assignedAt,
    action: isReassign ? "reassigned" : "assigned",
    fromPartnerId: previousPartnerId
      ? new mongoose.Types.ObjectId(previousPartnerId)
      : null,
    fromPartnerName: previousPartner?.name || "",
    fromPartnerPhone: previousPartner?.phone || "",
    toPartnerId: new mongoose.Types.ObjectId(deliveryPartnerId),
    toPartnerName: partner.name || "",
    toPartnerPhone: partner.phone || "",
    byRole: "ADMIN",
    byId:
      adminId && mongoose.Types.ObjectId.isValid(adminId)
        ? new mongoose.Types.ObjectId(adminId)
        : null,
    note: historyNote,
  });

  // Capture any existing shared (second) partner BEFORE we overwrite dispatch, so we can
  // notify them and decide whether the shared slot must stay open for the new primary.
  const droppedSharedPartnerId =
    order.dispatch?.sharedPartnerId?.toString?.() || null;
  const wasShared = Boolean(order.dispatch?.isShared || droppedSharedPartnerId);

  order.dispatch.status = "assigned";
  order.dispatch.deliveryPartnerId = new mongoose.Types.ObjectId(
    deliveryPartnerId,
  );
  order.dispatch.assignedAt = assignedAt;
  // New driver has not accepted yet
  order.dispatch.acceptedAt = undefined;
  order.dispatch.sharedPartnerId = null;
  // Re-open (don't silently discard) the shared slot for bulk/shared orders, and restart the
  // share-timeout clock. Combined with the solo-complete fallback, this guarantees admin
  // reassignment can never leave a bulk order permanently un-completable.
  order.dispatch.isShared = wasShared;
  order.dispatch.shareOpenedAt = wasShared ? assignedAt : null;

  pushStatusHistory(order, {
    byRole: "ADMIN",
    byId: adminId,
    from: fromDispatchStatus,
    to: isReassign ? "reassigned" : "assigned",
    note: historyNote,
  });
  await order.save();

  const restaurant = order.restaurantId;
  const payload = buildDeliverySocketPayload(order, restaurant);

  try {
    const io = getIO();
    if (io) {
      if (previousPartnerId) {
        io.to(rooms.delivery(previousPartnerId)).emit(
          "order_reassigned_elsewhere",
          {
            orderMongoId: order._id?.toString?.(),
            orderId: order._id.toString(),
            message:
              "This order has been reassigned to another delivery partner.",
          },
        );
      }
      if (droppedSharedPartnerId && droppedSharedPartnerId !== String(deliveryPartnerId)) {
        io.to(rooms.delivery(droppedSharedPartnerId)).emit(
          "order_reassigned_elsewhere",
          {
            orderMongoId: order._id?.toString?.(),
            orderId: order._id.toString(),
            message:
              "This shared order has been reassigned by admin. You are no longer on this delivery.",
          },
        );
      }
      io.to(rooms.delivery(deliveryPartnerId)).emit("new_order_available", payload);
      io.to(rooms.delivery(deliveryPartnerId)).emit("new_order", payload);
    }
  } catch (err) {
    logger.warn(
      `assignDeliveryPartnerAdmin socket emit failed: ${err?.message || err}`,
    );
  }

  if (droppedSharedPartnerId && droppedSharedPartnerId !== String(deliveryPartnerId)) {
    await notifyOwnerSafely(
      { ownerType: "DELIVERY_PARTNER", ownerId: droppedSharedPartnerId },
      {
        title: "Order reassigned",
        body: `Order #${order.order_id || order._id} has been reassigned by admin. You are no longer on this delivery.`,
        data: {
          type: "order_reassigned_elsewhere",
          orderId: String(order._id),
          orderMongoId: String(order._id),
        },
      },
    );
  }

  if (previousPartnerId) {
    await notifyOwnerSafely(
      { ownerType: "DELIVERY_PARTNER", ownerId: previousPartnerId },
      {
        title: "Order reassigned",
        body: `Order #${order.order_id || order._id} has been reassigned to another driver.`,
        data: {
          type: "order_reassigned_elsewhere",
          orderId: String(order._id),
          orderMongoId: String(order._id),
        },
      },
    );
  }

  await notifyOwnerSafely(
    { ownerType: "DELIVERY_PARTNER", ownerId: deliveryPartnerId },
    {
      title: previousPartnerId ? "Order reassigned to you" : "New order assigned",
      body: `You have been assigned Order #${order.order_id || order._id}.`,
      data: {
        type: "new_order",
        orderId: String(order._id),
        orderMongoId: String(order._id),
      },
    },
  );

  enqueueOrderEvent("delivery_partner_assigned", {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    previousPartnerId,
    adminId,
  });
  return normalizeOrderForClient(order);
}

/**
 * Admin force-assigns a SECOND (shared) delivery partner, activating dual-leg delivery.
 * Complements the driver-initiated share flow for when no one picks up the open slot.
 */
export async function assignSecondDeliveryPartnerAdmin(orderId, deliveryPartnerId, adminId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity);
  if (!order) throw new NotFoundError('Order not found');

  const terminal = [
    'delivered',
    'cancelled_by_user',
    'cancelled_by_restaurant',
    'cancelled_by_admin',
    'rejected_by_restaurant',
  ];
  if (terminal.includes(order.orderStatus)) {
    throw new ValidationError('Cannot add a second driver to a closed order');
  }

  const primaryId = order.dispatch?.deliveryPartnerId;
  if (!primaryId) {
    throw new ValidationError('Assign a primary delivery partner first');
  }
  if (String(primaryId) === String(deliveryPartnerId)) {
    throw new ValidationError('This driver is already the primary partner for this order');
  }
  assertCanShareSecondDriver(order);

  const partner = await FoodDeliveryPartner.findById(deliveryPartnerId)
    .select('status name phone employmentType')
    .lean();
  if (!partner || partner.status !== 'approved') {
    throw new ValidationError('Delivery partner not available');
  }

  // Split the rider earning 50/50 if the share slot was never opened.
  if (!order.dispatch?.isShared && !Number(order.sharedRiderEarning)) {
    const pool = resolveDualPayoutPool(order);
    const sharedSplit = Math.round(pool / 2);
    order.sharedRiderEarning = sharedSplit;
    order.riderEarning = Math.max(0, pool - sharedSplit);
  }

  order.dispatch.sharedPartnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
  order.dispatch.isShared = false; // slot filled
  order.dispatch.shareOpenedAt = null;

  const primaryPartner = await FoodDeliveryPartner.findById(primaryId)
    .select('employmentType')
    .lean();
  applyEmploymentAwareDualEarnings(order, {
    primaryEmploymentType: primaryPartner?.employmentType || 'per_order',
    secondaryEmploymentType: partner.employmentType || 'per_order',
  });

  const { legs, splitMode } = buildDeliveryLegs(order, {
    primaryPartnerId: primaryId,
    secondaryPartnerId: deliveryPartnerId,
    primaryEarning: order.riderEarning,
    secondaryEarning: order.sharedRiderEarning,
    otpFactory: generateFourDigitDeliveryOtp,
  });
  order.legs = legs;
  order.splitMode = splitMode;
  order.isDualLeg = true;

  pushStatusHistory(order, {
    byRole: 'ADMIN',
    byId: adminId,
    from: order.orderStatus,
    to: order.orderStatus,
    note: `Admin assigned second partner ${partner.name || deliveryPartnerId}; dual-leg activated (${splitMode} split).`,
  });
  pushSettlementSnapshot(
    order,
    'share',
    `Admin second-driver assign: primary ₹${order.riderEarning}, shared ₹${order.sharedRiderEarning}`,
  );
  await order.save();

  try {
    const io = getIO();
    if (io) {
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        orderStatus: order.orderStatus,
        dispatch: order.dispatch,
        isDualLeg: true,
        legProgress: getLegProgress(order),
      };
      io.to(rooms.delivery(primaryId)).emit('order_shared_accepted', payload);
      io.to(rooms.delivery(deliveryPartnerId)).emit('order_shared_accepted', payload);
      io.to(rooms.delivery(deliveryPartnerId)).emit('order_status_update', payload);
      io.to(rooms.user(order.userId)).emit('delivery_partner_updated', payload);
      io.to('all_delivery').emit('order_claimed', { orderId: order._id.toString() });
    }
  } catch (err) {
    logger.warn(`assignSecondDeliveryPartnerAdmin socket emit failed: ${err?.message || err}`);
  }

  // Push both independent handover OTPs to the customer as soon as dual-leg activates.
  if (isDualLegActive(order)) {
    const legOtps = getPendingLegHandoverOtps(order, { onlyAtDrop: false });
    if (legOtps.length) {
      emitDeliveryDropOtpToUser(order, String(legOtps[0].otp), {
        isDualLeg: true,
        legIndex: legOtps[0].legIndex,
        role: legOtps[0].role,
        partnerId: legOtps[0].partnerId,
        legOtps,
      });
    }
  }

  await notifyOwnerSafely(
    { ownerType: 'DELIVERY_PARTNER', ownerId: deliveryPartnerId },
    {
      title: 'You have been added to a delivery',
      body: `Admin assigned you as the second partner on Order #${order.order_id || order._id}.`,
      data: {
        type: 'new_order',
        orderId: String(order._id),
        orderMongoId: String(order._id),
      },
    },
  );

  enqueueOrderEvent('second_partner_assigned', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId: String(deliveryPartnerId),
    adminId: adminId ? String(adminId) : null,
    legProgress: getLegProgress(order),
  });

  return normalizeOrderForClient(order);
}

/**
 * Admin manually cancels an order. Notifies user, restaurant, and assigned driver.
 */
export async function cancelOrderByAdmin(
  orderId,
  adminId,
  reason = "",
  refundDestination,
) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne(identity);
  if (!order) throw new NotFoundError("Order not found");

  const nonCancellableStatuses = [
    "delivered",
    "cancelled_by_user",
    "cancelled_by_restaurant",
    "cancelled_by_admin",
  ];
  if (nonCancellableStatuses.includes(order.orderStatus)) {
    throw new ValidationError("Order cannot be cancelled");
  }

  const from = order.orderStatus;
  const assignedRiderId = order.dispatch?.deliveryPartnerId;
  const restaurantId = order.restaurantId;
  const cancelNote = reason?.trim() || "Order cancelled by admin";

  order.orderStatus = "cancelled_by_admin";
  freeOrderDispatch(order);
  pushStatusHistory(order, {
    byRole: "ADMIN",
    byId: adminId,
    from,
    to: "cancelled_by_admin",
    note: cancelNote,
  });

  await applyOrderRefundIfPaid(order, {
    recordedByRole: "ADMIN",
    recordedById: adminId,
    note: cancelNote,
    preferWallet: refundDestination === "wallet",
  });
  applyCancellationSettlement(order, {
    cancelledBy: 'admin',
    note: cancelNote,
  });
  pushSettlementSnapshot(order, 'admin_cancel', cancelNote);
  await order.save();

  const refundDetail =
    order.payment?.status === "refunded"
      ? order.payment?.refund?.destination === "wallet"
        ? ` ₹${order.pricing.total} has been credited to your wallet.`
        : ` Your refund of ₹${order.pricing.total} is being processed.`
      : "";
  const userMessage = `Order #${order.order_id || order._id} has been cancelled by admin.${refundDetail}`;
  const restaurantMessage = `Order #${order.order_id || order._id} has been cancelled by admin.`;
  const riderMessage = `Order #${order.order_id || order._id} has been cancelled by admin. You are now free to accept new orders.`;

  try {
    const io = getIO();
    if (io) {
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        orderStatus: order.orderStatus,
        title: "Order cancelled by admin",
        message: userMessage,
        failureReason: "admin_cancelled",
        cancelledBy: "admin",
      };
      io.to(rooms.user(order.userId)).emit("order_status_update", payload);
      io.to(rooms.restaurant(restaurantId)).emit("order_status_update", {
        ...payload,
        message: restaurantMessage,
      });
      if (assignedRiderId) {
        io.to(rooms.delivery(assignedRiderId)).emit("order_status_update", {
          ...payload,
          message: riderMessage,
        });
        io.to(rooms.delivery(assignedRiderId)).emit("order_cancelled", {
          ...payload,
          message: riderMessage,
        });
      }
    }
  } catch (err) {
    logger.warn(`cancelOrderByAdmin socket emit failed: ${err?.message || err}`);
  }

  await notifyOwnerSafely(
    { ownerType: "USER", ownerId: order.userId },
    {
      title: "Order cancelled by admin",
      body: userMessage,
      data: {
        type: "order_cancelled_by_admin",
        orderId: String(order._id),
        orderMongoId: String(order._id),
        cancelledBy: "admin",
      },
    },
  );

  await notifyOwnerSafely(
    { ownerType: "RESTAURANT", ownerId: restaurantId },
    {
      title: "Order cancelled by admin",
      body: restaurantMessage,
      data: {
        type: "order_cancelled_by_admin",
        orderId: String(order._id),
        orderMongoId: String(order._id),
        cancelledBy: "admin",
      },
    },
  );

  if (assignedRiderId) {
    await notifyOwnerSafely(
      { ownerType: "DELIVERY_PARTNER", ownerId: assignedRiderId },
      {
        title: "Order cancelled by admin",
        body: riderMessage,
        data: {
          type: "order_cancelled_by_admin",
          orderId: String(order._id),
          orderMongoId: String(order._id),
          cancelledBy: "admin",
        },
      },
    );
  }

  try {
    await foodTransactionService.updateTransactionStatus(
      order._id,
      "cancelled_by_admin",
      {
        status:
          order.payment?.status === "refunded" ? "refunded" : "failed",
        note: cancelNote,
        recordedByRole: "ADMIN",
        recordedById: adminId,
      },
    );
  } catch (err) {
    logger.warn(`cancelOrderByAdmin transaction sync failed: ${err?.message || err}`);
  }

  enqueueOrderEvent("order_cancelled_by_admin", {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    adminId: adminId ? String(adminId) : null,
    deliveryPartnerId: assignedRiderId ? String(assignedRiderId) : null,
    reason: cancelNote,
  });

  return normalizeOrderForClient(order);
}

export async function deleteOrderAdmin(orderId, adminId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne(identity).lean();
  if (!order) throw new NotFoundError("Order not found");

  // Keep support tickets but detach deleted order reference.
  await Promise.all([
    FoodSupportTicket.updateMany(
      { orderId: order._id },
      { $set: { orderId: null } },
    ),
    FoodTransaction.deleteOne({
      $or: [{ orderId: order._id }, { orderReadableId: String(order._id.toString()) }],
    }),
    FoodOrder.deleteOne({ _id: order._id }),
  ]);

  // Remove realtime tracking node if present.
  try {
    const db = getFirebaseDB();
    if (db && order?.orderId) {
      await db.ref(`active_orders/${order._id.toString()}`).remove();
    }
  } catch (err) {
    logger.warn(`Delete order firebase cleanup failed: ${err?.message || err}`);
  }

  // Notify connected apps so stale UI entries can disappear without refresh.
  try {
    const io = getIO();
    if (io) {
      const payload = {
        orderMongoId: String(order._id),
        orderId: String(order._id.toString() || ""),
        deletedBy: "ADMIN",
        adminId: adminId ? String(adminId) : null,
      };

      if (order.userId) io.to(rooms.user(order.userId)).emit("order_deleted", payload);
      if (order.restaurantId) io.to(rooms.restaurant(order.restaurantId)).emit("order_deleted", payload);
      if (order.dispatch?.deliveryPartnerId) {
        io.to(rooms.delivery(order.dispatch.deliveryPartnerId)).emit("order_deleted", payload);
      }
    }
  } catch (err) {
    logger.warn(`Delete order socket emit failed: ${err?.message || err}`);
  }

  enqueueOrderEvent("order_deleted_by_admin", {
    orderMongoId: String(order._id),
    orderId: String(order._id.toString() || ""),
    adminId: adminId ? String(adminId) : null,
  });

  return {
    deleted: true,
    orderId: String(order._id.toString() || ""),
    orderMongoId: String(order._id),
  };
}

/**
 * Soft-cancel by admin (refund + release drivers). Prefer this over hard delete.
 */
export async function cancelOrderAdmin(orderId, adminId, reason = '') {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity);
  if (!order) throw new NotFoundError('Order not found');

  assertCanCancel({ role: 'ADMIN', order });

  const from = order.orderStatus;
  const assignedRiderId = order.dispatch?.deliveryPartnerId
    ? String(order.dispatch.deliveryPartnerId)
    : null;
  const sharedRiderId = order.dispatch?.sharedPartnerId
    ? String(order.dispatch.sharedPartnerId)
    : null;
  const cancelNote = reason || 'Order cancelled by admin';

  order.orderStatus = 'cancelled_by_admin';
  freeOrderDispatch(order);
  // currentPhase enum is delivery workflow only (no 'cancelled'); mark status instead
  if (order.deliveryState) {
    order.deliveryState.status = 'cancelled';
  }
  pushStatusHistory(order, {
    byRole: 'ADMIN',
    byId: adminId,
    from,
    to: 'cancelled_by_admin',
    note: cancelNote,
  });

  await applyOrderRefundIfPaid(order, {
    recordedByRole: 'ADMIN',
    recordedById: adminId,
    note: cancelNote,
    preferWallet: true,
  });
  applyCancellationSettlement(order, {
    cancelledBy: 'admin',
    note: cancelNote,
  });
  pushSettlementSnapshot(order, 'admin_cancel', cancelNote);
  await order.save();

  const refundDetail =
    order.payment?.status === 'refunded' || order.payment?.refund?.status === 'processed'
      ? order.payment?.refund?.destination === 'wallet'
        ? ` ₹${order.pricing?.total || 0} has been credited to your wallet.`
        : ` Your refund of ₹${order.pricing?.total || 0} is being processed.`
      : '';
  const userMessage = `Your order was cancelled by support.${refundDetail}`;
  const riderMessage = `Order #${order.order_id || order._id} was cancelled by admin. You are free to accept new orders.`;

  const payload = {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    order_id: order.order_id || null,
    orderStatus: 'cancelled_by_admin',
    status: 'cancelled',
    title: 'Order cancelled by admin',
    message: userMessage,
    failureReason: 'cancelled_by_admin',
    cancelledBy: 'admin',
  };

  try {
    const io = getIO();
    if (io) {
      io.to(rooms.user(order.userId)).emit('order_status_update', payload);
      if (order.restaurantId) {
        io.to(rooms.restaurant(order.restaurantId)).emit('order_status_update', payload);
      }
      for (const p of order.pickups || []) {
        if (p?.restaurantId) {
          io.to(rooms.restaurant(p.restaurantId)).emit('order_status_update', payload);
        }
      }
      for (const riderId of [assignedRiderId, sharedRiderId].filter(Boolean)) {
        const riderPayload = { ...payload, message: riderMessage };
        io.to(rooms.delivery(riderId)).emit('order_status_update', riderPayload);
        // Dedicated event so Delivery V2 clears live trip immediately
        io.to(rooms.delivery(riderId)).emit('order_cancelled', riderPayload);
      }
    }
  } catch (err) {
    logger.warn(`cancelOrderAdmin socket emit failed: ${err?.message || err}`);
  }

  await notifyOwnersSafely(
    [{ ownerType: 'USER', ownerId: order.userId }],
    {
      title: 'Order cancelled by admin',
      body: userMessage,
      data: {
        type: 'order_cancelled_by_admin',
        orderId: String(order._id),
        orderMongoId: String(order._id),
        cancelledBy: 'admin',
      },
    },
  );

  const riderNotifyTargets = [assignedRiderId, sharedRiderId].filter(Boolean);
  for (const riderId of riderNotifyTargets) {
    await notifyOwnersSafely(
      [{ ownerType: 'DELIVERY_PARTNER', ownerId: riderId }],
      {
        title: 'Order cancelled by admin',
        body: riderMessage,
        data: {
          type: 'order_cancelled_by_admin',
          orderId: String(order._id),
          orderMongoId: String(order._id),
          cancelledBy: 'admin',
        },
      },
    );
  }

  enqueueOrderEvent('order_cancelled_by_admin', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    adminId: adminId ? String(adminId) : null,
  });

  return normalizeOrderForClient(order);
}

/**
 * Admin report: multi-restaurant drops, partial refunds, fee-stack / settlement snapshots.
 */
export async function getMultiOrderSettlementReport(query = {}) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);
  const skip = (page - 1) * limit;

  const filter = {
    $or: [
      { isMultiRestaurant: true },
      { 'partialRefunds.0': { $exists: true } },
      { 'settlementSnapshots.event': { $in: ['partial_drop', 'share', 'complete'] } },
      { 'pricing.deliveryFeeBreakdown.isSplitOrder': true },
    ],
  };

  if (query.fromDate || query.toDate) {
    filter.createdAt = {};
    if (query.fromDate) {
      const from = new Date(query.fromDate);
      if (!Number.isNaN(from.getTime())) {
        from.setHours(0, 0, 0, 0);
        filter.createdAt.$gte = from;
      }
    }
    if (query.toDate) {
      const to = new Date(query.toDate);
      if (!Number.isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = to;
      }
    }
  }

  if (query.onlyPartialRefunds === 'true' || query.onlyPartialRefunds === true) {
    filter['partialRefunds.0'] = { $exists: true };
  }

  const [docs, total] = await Promise.all([
    FoodOrder.find(filter)
      .select(
        'order_id orderId userId restaurantId isMultiRestaurant orderStatus pricing riderEarning sharedRiderEarning platformProfit partialRefunds settlementSnapshots pickups createdAt dispatch',
      )
      .populate('userId', 'name phone')
      .populate('restaurantId', 'restaurantName name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FoodOrder.countDocuments(filter),
  ]);

  const rows = (docs || []).map((o) => {
    const breakdown = o.pricing?.deliveryFeeBreakdown || {};
    const partialTotal = (o.partialRefunds || []).reduce(
      (sum, r) => sum + (Number(r?.amount) || 0),
      0,
    );
    return {
      orderId: o.order_id || o.orderId || String(o._id),
      orderMongoId: String(o._id),
      createdAt: o.createdAt,
      orderStatus: o.orderStatus,
      isMultiRestaurant: Boolean(o.isMultiRestaurant),
      isSplitOrder: Boolean(breakdown.isSplitOrder),
      deliveryFee: Number(o.pricing?.deliveryFee) || 0,
      deliveryFeeBreakdown: breakdown,
      total: Number(o.pricing?.total) || 0,
      riderEarning: Number(o.riderEarning) || 0,
      sharedRiderEarning: Number(o.sharedRiderEarning) || 0,
      platformProfit: Number(o.platformProfit) || 0,
      partialRefundTotal: partialTotal,
      partialRefunds: o.partialRefunds || [],
      settlementSnapshots: o.settlementSnapshots || [],
      droppedPickups: (o.pickups || []).filter((p) => p.permanentlyDropped),
      customer: o.userId
        ? { name: o.userId.name, phone: o.userId.phone }
        : null,
      primaryRestaurant: o.restaurantId
        ? {
          name: o.restaurantId.restaurantName || o.restaurantId.name,
          id: String(o.restaurantId._id || o.restaurantId),
        }
        : null,
    };
  });

  const summary = {
    totalOrders: total,
    withPartialRefunds: rows.filter((r) => r.partialRefundTotal > 0).length,
    withShareSplit: rows.filter((r) => (r.sharedRiderEarning || 0) > 0).length,
    multiRestaurant: rows.filter((r) => r.isMultiRestaurant).length,
    splitBulk: rows.filter((r) => r.isSplitOrder).length,
    partialRefundAmountSum: rows.reduce((s, r) => s + (r.partialRefundTotal || 0), 0),
  };

  return {
    summary,
    orders: rows,
    page,
    limit,
    total,
    pages: Math.ceil(total / limit) || 1,
  };
}

// NOTE: resendOrderToRestaurant (the driver-initiated 3-strike "resend to restaurant" flow)
// was removed in Phase 3. The reject policy is now immediate-drop: a restaurant rejection
// permanently drops that restaurant (multi) or cancels the order (single) with refund — there
// is nothing to resend. The legitimate "re-search for a driver" action lives in
// resendDeliveryNotificationRestaurant and is unaffected.

export async function reportOrderDelay(orderId, userId, role, reason) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne(identity);
  if (!order) throw new NotFoundError("Order not found");

  // Validate permission
  if (role === 'DELIVERY_PARTNER') {
    if (String(order.dispatch?.deliveryPartnerId) !== String(userId)) {
      throw new ForbiddenError("Not assigned to you");
    }
  } else if (role === 'RESTAURANT') {
    const isPrimary = String(order.restaurantId) === String(userId);
    const isPickup = (order.pickups || []).some(p => String(p.restaurantId) === String(userId));
    if (!isPrimary && !isPickup) throw new ForbiddenError("Not your restaurant");
  }

  order.delayContext = {
    reason: String(reason || "").trim(),
    reportedBy: role,
    reportedAt: new Date()
  };

  await order.save();

  // Socket notification to user
  try {
    const io = getIO();
    if (io) {
      io.to(rooms.user(order.userId)).emit("order_delay_update", {
        orderId: order._id.toString(),
        reason: order.delayContext.reason,
        reportedBy: role
      });
    }
  } catch { }

  return order;
}

/**
 * Marks an order as shared so other delivery partners can accept it.
 */
export async function shareOrderDelivery(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne({
    ...identity,
    "dispatch.deliveryPartnerId": new mongoose.Types.ObjectId(deliveryPartnerId)
  });

  if (!order) throw new NotFoundError("Order not found or not assigned to you");

  const currentStatus = order.orderStatus;
  // Must match FoodOrder.orderStatus enum (order.model.js) — 'accepted' is not a valid
  // orderStatus for this model, and 'confirmed'/'reached_pickup' were missing, which
  // blocked "Find new driver" for orders still at the restaurant/pickup stage.
  const sharedStatuses = ['confirmed', 'preparing', 'ready_for_pickup', 'reached_pickup', 'picked_up'];

  if (!sharedStatuses.includes(currentStatus)) {
    throw new ValidationError(`Order in status '${currentStatus}' cannot be shared.`);
  }

  if (order.dispatch?.sharedPartnerId) {
    throw new ValidationError('Order already has a shared partner');
  }
  assertCanShareSecondDriver(order);

  // Only bulk orders (item count >= configured threshold) may request a second driver.
  // Primary opens this manually via "Find new driver" after assessing load at pickup.
  const shareSettings =
    (await FoodDeliveryBoySettings.findOne({ isActive: true }).sort({ createdAt: -1 }).lean()) ||
    (await FoodDeliveryBoySettings.findOne().sort({ createdAt: -1 }).lean());
  if (!isShareRequired(order, shareSettings || {})) {
    throw new ValidationError('This order is not large enough to request a second delivery partner.');
  }

  if (order.dispatch?.isShared) {
    throw new ValidationError('A second-driver search is already open for this order.');
  }

  // Set sharing flags — do NOT provisional 50/50 here.
  // Splitting early while salary primary has riderEarning=0 freezes only half the slab
  // into sharedRiderEarning and underpays the per-order joiner. Employment-aware split runs on join.
  order.dispatch.isShared = true;
  order.dispatch.shareOpenedAt = new Date();
  order.dispatch.sharedPartnerId = null; // Ensure it's null so another partner can join

  const pool = resolveDualPayoutPool(order);

  pushStatusHistory(order, {
    byRole: "DELIVERY_PARTNER",
    byId: deliveryPartnerId,
    from: currentStatus,
    to: currentStatus,
    note: "Primary requested a second delivery partner (Find new driver)"
  });

  pushSettlementSnapshot(
    order,
    'share',
    `Second-driver search opened; slab pool ₹${pool} (employment-aware split on join)`,
  );
  await order.save();

  // Notify nearby riders via socket (broadcast to all_delivery room)
  try {
    const io = getIO();
    if (io) {
      const payload = buildDeliverySocketPayload(order, order.restaurantId);
      io.to('all_delivery').emit('shareable_order_available', {
        ...payload,
        sharedFrom: deliveryPartnerId,
        shareRequired: false,
      });
    }
  } catch (err) {
    logger.error(`Socket notification failed for shared order: ${err.message}`);
  }

  return normalizeOrderForClient(order);
}

/**
 * Allows another delivery partner to join a shared order.
 */
export async function acceptSharedOrderDelivery(orderId, newPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  const sharedObjectId = new mongoose.Types.ObjectId(newPartnerId);

  // Atomic claim: the conditional filter (isShared + open slot + not the primary) guarantees
  // only ONE partner can win an open shared slot even under simultaneous joins. Previously this
  // was a read-then-save, which let two partners both "join" and silently overwrite each other.
  const order = await FoodOrder.findOneAndUpdate(
    {
      ...identity,
      'dispatch.isShared': true,
      'dispatch.sharedPartnerId': null,
      'dispatch.deliveryPartnerId': { $ne: sharedObjectId },
    },
    {
      $set: {
        'dispatch.sharedPartnerId': sharedObjectId,
        'dispatch.isShared': false, // Closed for further joining
      },
    },
    { new: true },
  );

  if (!order) {
    const existing = await FoodOrder.findOne(identity)
      .select('dispatch.isShared dispatch.sharedPartnerId dispatch.deliveryPartnerId')
      .lean();
    if (!existing) {
      throw new NotFoundError('Shared order not found or no longer available');
    }
    if (String(existing.dispatch?.deliveryPartnerId || '') === String(newPartnerId)) {
      throw new ValidationError('You already have this order assigned.');
    }
    if (String(existing.dispatch?.sharedPartnerId || '') === String(newPartnerId)) {
      // Idempotent: this partner already joined (e.g. network retry). Return current state.
      const joined = await FoodOrder.findOne(identity).populate([
        { path: 'restaurantId' },
        { path: 'userId' },
        { path: 'dispatch.deliveryPartnerId', select: 'name fullName phone phoneNumber profileImage' },
        { path: 'dispatch.sharedPartnerId', select: 'name fullName phone phoneNumber profileImage' },
      ]);
      return joined ? normalizeOrderForClient(joined) : null;
    }
    throw new ValidationError('This shared order has already been taken by another partner.');
  }

  const oldPartnerId = order.dispatch.deliveryPartnerId;
  const currentStatus = order.orderStatus;

  // Flow 3: the order now runs as two independent legs. Divide the work (stop-level across
  // restaurants, or item-level within one restaurant) and give each leg its own handover OTP.
  try {
    // Salary partners get ₹0 wallet credit; per-order partners keep their share.
    const [primaryPartner, secondaryPartner] = await Promise.all([
      FoodDeliveryPartner.findById(oldPartnerId).select('employmentType').lean(),
      FoodDeliveryPartner.findById(newPartnerId).select('employmentType').lean(),
    ]);
    applyEmploymentAwareDualEarnings(order, {
      primaryEmploymentType: primaryPartner?.employmentType || 'per_order',
      secondaryEmploymentType: secondaryPartner?.employmentType || 'per_order',
    });

    const { legs, splitMode } = buildDeliveryLegs(order, {
      primaryPartnerId: oldPartnerId,
      secondaryPartnerId: newPartnerId,
      primaryEarning: order.riderEarning,
      secondaryEarning: order.sharedRiderEarning,
      otpFactory: generateFourDigitDeliveryOtp,
    });
    order.legs = legs;
    order.splitMode = splitMode;
    order.isDualLeg = true;
    pushStatusHistory(order, {
      byRole: 'SYSTEM',
      byId: newPartnerId,
      from: currentStatus,
      to: currentStatus,
      note: `Dual-leg activated (${splitMode} split): leg 0 → primary, leg 1 → shared partner.`,
    });
  } catch (err) {
    logger.error(`Failed to build delivery legs for ${order._id}: ${err?.message || err}`);
  }

  // Slot claimed atomically above; maintain separate earnings (already split during 'share'
  // call) and record the join in history.
  pushStatusHistory(order, {
    byRole: "DELIVERY_PARTNER",
    byId: newPartnerId,
    from: currentStatus,
    to: currentStatus,
    note: `Shared order slot joined by partner ${newPartnerId}`
  });

  await order.save();

  // Sync shared partner to transaction
  try {
    await foodTransactionService.updateTransactionStatus(order._id, 'shared_partner_assigned', {
      sharedPartnerId: newPartnerId,
      primaryRiderShare: order.riderEarning,
      sharedRiderShare: order.sharedRiderEarning,
      note: `Partner ${newPartnerId} joined the delivery. Earning will be split.`
    });
  } catch (err) {
    logger.error(`Failed to sync shared partner to transaction: ${err.message}`);
  }

  // Notify both partners and user (with populated partner contact info)
  try {
    await order.populate([
      { path: 'dispatch.deliveryPartnerId', select: 'name fullName phone phoneNumber profileImage' },
      { path: 'dispatch.sharedPartnerId', select: 'name fullName phone phoneNumber profileImage' },
    ]);
  } catch (popErr) {
    logger.warn(`Shared-order populate failed: ${popErr?.message || popErr}`);
  }

  // Push both independent handover OTPs to the customer as soon as dual-leg activates.
  if (isDualLegActive(order)) {
    const legOtps = getPendingLegHandoverOtps(order, { onlyAtDrop: false });
    if (legOtps.length) {
      emitDeliveryDropOtpToUser(order, String(legOtps[0].otp), {
        isDualLeg: true,
        legIndex: legOtps[0].legIndex,
        role: legOtps[0].role,
        partnerId: legOtps[0].partnerId,
        legOtps,
      });
    }
  }

  try {
    const io = getIO();
    if (io) {
      const payload = {
        orderId: order._id.toString(),
        orderStatus: order.orderStatus,
        isDualLeg: Boolean(order.isDualLeg),
        splitMode: order.splitMode || null,
        legs: (order.legs || []).map((leg) => {
          const { otp, ...rest } = leg?.toObject?.() || leg || {};
          return { ...rest, hasOtp: Boolean(otp) };
        }),
        dispatch: order.dispatch,
      };
      io.to(rooms.delivery(oldPartnerId)).emit('order_shared_accepted', payload);
      io.to(rooms.delivery(newPartnerId)).emit('order_shared_accepted', payload);
      io.to(rooms.delivery(oldPartnerId)).emit('order_status_update', payload);
      io.to(rooms.delivery(newPartnerId)).emit('order_status_update', payload);
      io.to(rooms.user(order.userId)).emit('delivery_partner_updated', payload);

      // Also notify all riders that the shareable slot is no longer available
      io.to('all_delivery').emit('order_claimed', { orderId: order._id.toString() });
    }
  } catch (err) { }

  await order.populate([
    { path: 'restaurantId' },
    { path: 'userId' },
    { path: 'dispatch.deliveryPartnerId', select: 'name fullName phone phoneNumber profileImage' },
    { path: 'dispatch.sharedPartnerId', select: 'name fullName phone phoneNumber profileImage' }
  ]);
  return normalizeOrderForClient(order);
}

/**
 * Background job to process scheduled orders that are due in 30 minutes or less.
 * Activated by server.js interval.
 */
export async function processScheduledOrderAlerts() {
  const now = new Date();
  const triggerWindow = new Date(now.getTime() + 30 * 60 * 1000); // 30 mins from now

  try {
    const scheduledOrders = await FoodOrder.find({
      orderStatus: 'scheduled',
      scheduledAt: { $lte: triggerWindow },
      'payment.status': { $ne: 'failed' } // skip failed payment orders
    });

    if (scheduledOrders.length === 0) {
      return;
    }

    logger.info(`[ScheduledOrders] Found ${scheduledOrders.length} orders to activate.`);

    for (const order of scheduledOrders) {
      const from = order.orderStatus;
      order.orderStatus = 'created';
      order.restaurantNotifiedForSchedule = true;

      order.statusHistory.push({
        at: new Date(),
        byRole: 'SYSTEM',
        from,
        to: 'created',
        note: 'Scheduled order activated (30-minute buffer reached).'
      });

      await order.save();

      // Emit socket status updates
      try {
        const io = getIO();
        if (io) {
          const payload = {
            orderMongoId: order._id.toString(),
            orderId: order.order_id || order._id.toString(),
            orderStatus: 'created',
            message: `Your scheduled order #${order.order_id || order._id} is now being processed.`
          };
          io.to(rooms.user(order.userId)).emit("order_status_update", payload);
          io.to(rooms.restaurant(order.restaurantId)).emit("order_status_update", payload);
        }
      } catch (socketErr) {
        logger.warn(`[ScheduledOrders] Socket emission failed for order ${order._id}: ${socketErr.message}`);
      }

      // Send push notification to user
      try {
        await notifyOwnersSafely([{ ownerType: "USER", ownerId: order.userId }], {
          title: "Scheduled Order Activated! 🍔",
          body: `Your scheduled order #${order.order_id || order._id} is now active and we are searching for a rider.`,
          data: {
            type: "order_created",
            orderId: String(order._id),
            link: `/food/user/orders/${order._id}`,
          },
        });
      } catch (notificationErr) {
        logger.warn(`[ScheduledOrders] Push notification failed for user ${order.userId}: ${notificationErr.message}`);
      }

      // Trigger automatic rider assignment
      const settings = await dispatchService.getDispatchSettings();
      if (settings.dispatchMode === "auto") {
        try {
          await tryAutoAssign(order._id);
        } catch (assignErr) {
          logger.error(`[ScheduledOrders] Auto-assign failed for activated order ${order._id}: ${assignErr.message}`);
        }
      }
    }
  } catch (err) {
    logger.error(`Error in processScheduledOrderAlerts: ${err.message}`);
  }
}

