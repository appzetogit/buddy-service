import mongoose from 'mongoose';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodFeeSettings } from '../../admin/models/feeSettings.model.js';
import { FoodDeliveryCommissionRule } from '../../admin/models/deliveryCommissionRule.model.js';
import { FoodOffer } from '../../admin/models/offer.model.js';
import { FoodItem } from '../../admin/models/food.model.js';
import { FoodAddon } from '../../restaurant/models/foodAddon.model.js';
import {
  checkOfferEligibility,
  computeOfferDiscount,
  getCreatedByType,
  isFreeDeliveryCoupon,
  logOfferAction,
  mapCouponRejectionMessage,
} from '../../admin/services/offer.service.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import {
  resolveDistanceSlabQuote,
  resolveOrderDistanceKmAsync,
  applyDeliverySurcharges,
  resolveSpeedFeeModifier,
  resolveSpeedOption,
  splitSpeedFeeShares,
  resolveActivePeakHourSurcharge,
} from './order.helpers.js';
import { FoodDeliveryBoySettings } from '../../admin/models/deliveryBoySettings.model.js';
import { validateRestaurantChainForItems } from './restaurant-chain-radius.service.js';
import {
  assertMaxRestaurants,
  assertMultiOrderAllowed,
} from './order-lifecycle.policy.js';

/**
 * Re-load cart lines from catalog. Never trust client prices / availability.
 * Returns hydrated items with server prices.
 * Supports both FoodItem (menu) and FoodAddon (complete-your-meal addons).
 */
export async function validateAndHydrateCartItems(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError('No items in order');
  }

  const ids = [
    ...new Set(
      items
        .map((it) => it.itemId || it.id || it._id)
        .filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)))
        .map((id) => String(id)),
    ),
  ];

  if (ids.length === 0) {
    throw new ValidationError('Cart items are missing valid item ids');
  }

  const catalogItems = await FoodItem.find({ _id: { $in: ids } })
    .select(
      'name price variants image description foodType isAvailable preparationTime restaurantId approvalStatus',
    )
    .lean();

  const byId = new Map(catalogItems.map((doc) => [String(doc._id), { kind: 'item', doc }]));

  const missingIds = ids.filter((id) => !byId.has(id));
  if (missingIds.length > 0) {
    const addonDocs = await FoodAddon.find({
      _id: { $in: missingIds },
      isDeleted: { $ne: true },
    })
      .select('restaurantId draft published approvalStatus isAvailable')
      .lean();

    for (const addon of addonDocs) {
      byId.set(String(addon._id), { kind: 'addon', doc: addon });
    }
  }

  const hydrated = [];

  for (const line of items) {
    const itemId = String(line.itemId || line.id || line._id || '');
    const entry = byId.get(itemId);
    if (!entry) {
      throw new ValidationError(
        `Item "${line.name || itemId}" is no longer available. Please refresh your cart.`,
      );
    }

    if (entry.kind === 'addon') {
      const addon = entry.doc;
      const payload = addon.published || addon.draft;
      if (!payload) {
        throw new ValidationError(
          `Addon "${line.name || itemId}" is no longer available. Please refresh your cart.`,
        );
      }
      if (addon.approvalStatus && addon.approvalStatus !== 'approved') {
        throw new ValidationError(`"${payload.name}" is not available for ordering`);
      }
      if (addon.isAvailable === false) {
        throw new ValidationError(`"${payload.name}" is currently unavailable`);
      }

      const lineRestaurantId = String(line.restaurantId || '');
      if (lineRestaurantId && String(addon.restaurantId) !== lineRestaurantId) {
        throw new ValidationError(`"${payload.name}" does not belong to the selected restaurant`);
      }

      const unitPrice = Number(payload.price) || 0;
      const qty = Math.max(1, Number(line.quantity) || 1);
      const image =
        payload.image ||
        (Array.isArray(payload.images) ? payload.images[0] : '') ||
        line.image ||
        '';

      hydrated.push({
        ...line,
        itemId: String(addon._id),
        name: payload.name,
        price: unitPrice,
        variantId: undefined,
        variantName: undefined,
        variantPrice: unitPrice,
        quantity: qty,
        image,
        description: line.description || payload.description || '',
        isVeg: line.isVeg !== false,
        isAddon: true,
        restaurantId: String(addon.restaurantId),
      });
      continue;
    }

    const doc = entry.doc;
    if (doc.approvalStatus && doc.approvalStatus !== 'approved') {
      throw new ValidationError(`"${doc.name}" is not available for ordering`);
    }
    if (doc.isAvailable === false) {
      throw new ValidationError(`"${doc.name}" is currently unavailable`);
    }

    const lineRestaurantId = String(line.restaurantId || '');
    if (lineRestaurantId && String(doc.restaurantId) !== lineRestaurantId) {
      throw new ValidationError(`"${doc.name}" does not belong to the selected restaurant`);
    }

    let unitPrice = Number(doc.price) || 0;
    let variantName = line.variantName || undefined;
    let variantId = line.variantId ? String(line.variantId) : undefined;

    if (Array.isArray(doc.variants) && doc.variants.length > 0) {
      const normalizeName = (value) =>
        String(value || '')
          .trim()
          .toLowerCase();
      const linePrice = Number(line.variantPrice ?? line.price);

      let variant =
        (variantId && doc.variants.find((v) => String(v._id) === variantId)) ||
        (variantName &&
          doc.variants.find((v) => normalizeName(v.name) === normalizeName(variantName))) ||
        null;

      // Reorder / legacy carts may send line price without a variantId — match by price.
      if (!variant && Number.isFinite(linePrice) && linePrice > 0) {
        variant = doc.variants.find((v) => Number(v.price) === linePrice) || null;
      }

      if (!variant && (variantId || variantName)) {
        throw new ValidationError(`Selected option for "${doc.name}" is no longer available`);
      }

      if (variant) {
        unitPrice = Number(variant.price) || 0;
        variantName = variant.name;
        variantId = String(variant._id);
      }
    }

    const qty = Math.max(1, Number(line.quantity) || 1);
    hydrated.push({
      ...line,
      itemId: String(doc._id),
      name: doc.name,
      price: unitPrice,
      variantId,
      variantName,
      variantPrice: unitPrice,
      quantity: qty,
      image: line.image || doc.image || '',
      description: line.description || doc.description || '',
      isVeg: doc.foodType === 'Veg',
      isAddon: false,
      preparationTime: line.preparationTime || doc.preparationTime,
      restaurantId: String(doc.restaurantId),
    });
  }

  return hydrated;
}

function resolveRestaurantImage(restaurant) {
  if (!restaurant) return '';
  if (typeof restaurant.profileImage === 'string' && restaurant.profileImage) {
    return restaurant.profileImage;
  }
  const cover = Array.isArray(restaurant.coverImages) ? restaurant.coverImages[0] : null;
  if (typeof cover === 'string') return cover;
  if (cover && typeof cover === 'object') {
    return cover.url || cover.secure_url || cover.src || '';
  }
  return '';
}

/**
 * Group cart items by restaurant with per-restaurant subtotal + packaging.
 * Packaging: restaurant.packagingFee if set, else global feeSettings.packagingFee (once per restaurant).
 */
export function buildRestaurantGroups(items, restaurants, defaultPackagingFee = 0) {
  const restaurantById = new Map(
    (restaurants || []).map((r) => [String(r._id), r]),
  );
  const groups = [];
  const seen = new Map();

  for (const item of items || []) {
    const rid = String(item.restaurantId || '');
    if (!rid) continue;

    let group = seen.get(rid);
    if (!group) {
      const restaurant = restaurantById.get(rid);
      const packaging =
        restaurant?.packagingFee != null && Number.isFinite(Number(restaurant.packagingFee))
          ? Number(restaurant.packagingFee)
          : Number(defaultPackagingFee) || 0;

      group = {
        restaurantId: rid,
        restaurantName:
          restaurant?.restaurantName || restaurant?.name || item.restaurant || 'Restaurant',
        restaurantImage: resolveRestaurantImage(restaurant),
        items: [],
        subtotal: 0,
        packagingFee: Math.max(0, packaging),
      };
      seen.set(rid, group);
      groups.push(group);
    }

    const lineTotal = (Number(item.price) || 0) * (Number(item.quantity) || 1);
    group.items.push(item);
    group.subtotal = Number((group.subtotal + lineTotal).toFixed(2));
  }

  return groups;
}

export async function calculateOrderPricing(userId, dto) {
  const rawItems = Array.isArray(dto.items) ? dto.items : [];
  const items = await validateAndHydrateCartItems(rawItems);

  await validateRestaurantChainForItems(items);

  // Identify unique restaurants (preserve cart order)
  const restaurantIds = [...new Set(items.map((it) => it.restaurantId).filter(Boolean))];
  if (dto.restaurantId && !restaurantIds.includes(dto.restaurantId)) {
    restaurantIds.push(dto.restaurantId);
  }

  if (restaurantIds.length === 0) throw new ValidationError('No restaurant specified');

  assertMaxRestaurants(
    restaurantIds.map((id) => ({ restaurantId: id })),
  );

  const restaurantsRaw = await FoodRestaurant.find({ _id: { $in: restaurantIds } })
    .select(
      'status location name restaurantName packagingFee profileImage coverImages isAcceptingOrders profileReviewStatus',
    )
    .lean();

  if (restaurantsRaw.length === 0) throw new ValidationError('Restaurants not found');

  const restaurantById = new Map(restaurantsRaw.map((r) => [String(r._id), r]));
  const restaurants = restaurantIds
    .map((id) => restaurantById.get(String(id)))
    .filter(Boolean);

  if (restaurants.length === 0) throw new ValidationError('Restaurants not found');

  for (const r of restaurants) {
    if (
      r.status !== 'approved' ||
      r.profileReviewStatus === 'pending' ||
      r.isAcceptingOrders === false
    ) {
      throw new ValidationError(
        `Restaurant ${r.restaurantName || r.name} is not accepting orders`,
      );
    }
  }

  const feeDoc = await FoodFeeSettings.findOne({ isActive: true })
    .sort({ createdAt: -1 })
    .lean();
  const feeSettings = feeDoc || {
    deliveryFee: 0,
    deliveryFeeRanges: [],
    freeDeliveryThreshold: 0,
    platformFee: 0,
    packagingFee: 0,
    gstRate: 0,
  };

  let deliveryBoySettings = await FoodDeliveryBoySettings.findOne({ isActive: true })
    .sort({ createdAt: -1 })
    .lean();
  if (!deliveryBoySettings) {
    deliveryBoySettings = await FoodDeliveryBoySettings.findOne()
      .sort({ createdAt: -1 })
      .lean();
  }
  assertMultiOrderAllowed(deliveryBoySettings, restaurantIds.length);

  const defaultPackagingFee =
    feeSettings.packagingFee != null ? Number(feeSettings.packagingFee) : 0;
  const platformFee = feeSettings.platformFee != null ? Number(feeSettings.platformFee) : 0;

  const restaurantGroups = buildRestaurantGroups(items, restaurants, defaultPackagingFee);
  const foodSubtotal = restaurantGroups.reduce((sum, g) => sum + (Number(g.subtotal) || 0), 0);
  const packagingFee = restaurantGroups.reduce(
    (sum, g) => sum + (Number(g.packagingFee) || 0),
    0,
  );
  // Alias: subtotal kept for backward compatibility with existing clients
  const subtotal = foodSubtotal;

  const totalItemCount = items.reduce(
    (sum, it) => sum + (Number(it.quantity) || 1),
    0,
  );

  const freeThreshold = Number(feeSettings.freeDeliveryThreshold || 0);

  const userLoc = dto?.deliveryAddress?.location?.coordinates;
  let distanceKm = await resolveOrderDistanceKmAsync(restaurants, userLoc);
  if (!Number.isFinite(distanceKm)) distanceKm = 0;

  const splitEnabled = deliveryBoySettings
    ? deliveryBoySettings.splitOrderEnabled !== false
    : true;
  const splitThreshold = Number(deliveryBoySettings?.splitOrderThreshold ?? 20);
  const isSplitOrder = Boolean(
    splitEnabled && splitThreshold > 0 && totalItemCount >= splitThreshold,
  );
  const isMultiRestaurant = restaurants.length > 1;

  let baseDeliveryFee = 0;
  let baseRiderFee = 0;
  let deliveryFeeSource = 'none';
  const isFreeByThreshold =
    Number.isFinite(freeThreshold) && freeThreshold > 0 && subtotal >= freeThreshold;
  const defaultDeliveryFee = Math.max(0, Number(feeSettings.deliveryFee) || 0);

  // Base: distance slab userCharge / deliveryBoyFee, else Default Delivery Fee.
  // Free delivery (threshold/coupon) only waives customer charge; rider still paid per slab.
  {
    const rules = await FoodDeliveryCommissionRule.find({ status: true }).lean();
    if (rules?.length > 0) {
      const quote = resolveDistanceSlabQuote(distanceKm, rules);
      if (quote.matched) {
        baseDeliveryFee = quote.userCharge;
        baseRiderFee = quote.deliveryBoyFee;
        deliveryFeeSource = isFreeByThreshold ? 'free' : 'distance';
      } else {
        baseDeliveryFee = defaultDeliveryFee;
        baseRiderFee = defaultDeliveryFee;
        deliveryFeeSource = isFreeByThreshold ? 'free' : 'default';
      }
    } else {
      baseDeliveryFee = defaultDeliveryFee;
      baseRiderFee = defaultDeliveryFee;
      deliveryFeeSource = isFreeByThreshold ? 'free' : 'default';
    }
  }

  // Order: base → Delivery Speed Options → multi-resto / split surcharges
  const speedOptions = Array.isArray(deliveryBoySettings?.deliverySpeedOptions)
    ? deliveryBoySettings.deliverySpeedOptions.filter((o) => o && o.isEnabled !== false)
    : [];
  if (speedOptions.length > 0 && (dto.deliverySpeedOptionId || dto.deliveryOption)) {
    const speedId = String(dto.deliverySpeedOptionId || '').trim();
    const speedName = String(dto.deliveryOption || '').trim().toLowerCase();
    const matched = speedOptions.find(
      (o) =>
        (speedId && String(o.id) === speedId) ||
        (speedName && String(o.name || '').trim().toLowerCase() === speedName),
    );
    if (!matched) {
      throw new ValidationError('Selected delivery speed is no longer available');
    }
  }

  const matchedSpeedOption = speedOptions.length > 0
    ? resolveSpeedOption(
      deliveryBoySettings,
      dto.deliverySpeedOptionId,
      dto.deliveryOption,
    )
    : null;
  const rawSpeedFeeModifier = matchedSpeedOption
    ? Number(matchedSpeedOption.feeModifier) || 0
    : (speedOptions.length > 0
      ? resolveSpeedFeeModifier(
        deliveryBoySettings,
        dto.deliverySpeedOptionId,
        dto.deliveryOption,
      )
      : 0);

  // Customer: base → multi-resto / split surcharges (speed applied below only when delivery is not waived)
  const multiCharge = isMultiRestaurant
    ? Math.max(0, Number(deliveryBoySettings?.multiOrderAdditionalCharge) || 0)
    : 0;
  const splitExtraCustomer = isSplitOrder ? baseDeliveryFee : 0;
  const customerSurcharge = multiCharge + splitExtraCustomer;
  const baseCustomerDeliveryFee = Math.max(0, baseDeliveryFee + customerSurcharge);

  // Free delivery (threshold or free-delivery coupon): customer pays ₹0 — speed fee must not apply.
  let deliveryWaived = isFreeByThreshold;
  const codeRaw = dto.couponCode
    ? String(dto.couponCode).trim().toUpperCase()
    : '';
  if (!deliveryWaived && codeRaw) {
    const now = new Date();
    const offer = await FoodOffer.findOne({
      couponCode: codeRaw,
      isDeleted: { $ne: true },
      $or: [{ approvalStatus: 'approved' }, { approvalStatus: { $exists: false } }],
    }).lean();
    if (offer && isFreeDeliveryCoupon(offer)) {
      const eligibility = await checkOfferEligibility(offer, {
        userId,
        restaurantIds,
        subtotal,
        isMultiRestaurant,
        now,
      });
      if (eligibility.eligible) {
        deliveryWaived = true;
      }
    }
  }

  const speedFeeModifier = deliveryWaived ? 0 : rawSpeedFeeModifier;
  const speedShares = deliveryWaived
    ? {
      speedShareAdmin: 0,
      speedShareDriver: 0,
      speedShareRestaurant: 0,
      adminBearsNegative: false,
    }
    : splitSpeedFeeShares(speedFeeModifier, {
      driverShareAmount: matchedSpeedOption?.driverShareAmount,
    });
  const speedAdjustment = Number(speedFeeModifier) || 0;

  // Peak Hour surcharge: a flat admin-kept charge during admin-configured recurring
  // windows (lunch rush, evening peak, festival days). Not split with the rider, and
  // waived whenever delivery itself is waived (threshold / free-delivery coupon).
  const peakHourSurcharge = deliveryWaived ? null : await resolveActivePeakHourSurcharge();
  const peakHourCharge = peakHourSurcharge ? Number(peakHourSurcharge.charge) || 0 : 0;

  const deliveryFee = deliveryWaived
    ? baseCustomerDeliveryFee
    : Math.max(0, baseCustomerDeliveryFee + speedAdjustment + peakHourCharge);

  // Rider: slab/default + multi/split; speed driver share only when customer delivery is not fully waived
  const riderSurchargeResult = applyDeliverySurcharges(baseRiderFee, {
    isMultiRestaurant,
    isSplitOrder,
    deliveryBoySettings,
  });
  const riderFee = Number(
    (riderSurchargeResult.fee + (deliveryWaived ? 0 : speedShares.speedShareDriver)).toFixed(2),
  );
  const deliveryMarginBase = Math.max(
    0,
    Number(
      (baseDeliveryFee + customerSurcharge - riderSurchargeResult.fee).toFixed(2),
    ),
  );

  const deliveryFeeBreakdown = {
    source: deliveryFeeSource,
    distanceKm,
    isMultiRestaurant,
    isSplitOrder,
    totalItems: totalItemCount,
    multiplier: isSplitOrder ? 2 : 1,
    additionalCharge: customerSurcharge,
    speedFeeModifier,
    speedFeeModifierSelected: deliveryWaived ? rawSpeedFeeModifier : speedFeeModifier,
    speedSkippedBecauseFreeDelivery: deliveryWaived,
    speedDriverShareConfigured: Math.max(0, Number(matchedSpeedOption?.driverShareAmount) || 0),
    speedShareAdmin: speedShares.speedShareAdmin,
    speedShareRestaurant: 0,
    speedShareDriver: speedShares.speedShareDriver,
    adminBearsNegativeSpeed: speedShares.adminBearsNegative,
    peakHourCharge,
    peakHourRuleId: peakHourSurcharge?.ruleId || null,
    peakHourRuleName: peakHourSurcharge?.name || null,
    baseFee: baseDeliveryFee,
    fee: deliveryFee,
    userCharge: baseDeliveryFee,
    deliveryBoyFee: baseRiderFee,
    riderBaseFee: riderSurchargeResult.fee,
    riderFee,
    riderAdditionalCharge: riderSurchargeResult.surcharge,
    deliveryMarginBase,
  };

  const gstRate = feeSettings.gstRate != null ? Number(feeSettings.gstRate) : 0;
  const tax =
    Number.isFinite(gstRate) && gstRate > 0
      ? Math.round(subtotal * (gstRate / 100))
      : 0;

  let discount = 0;
  let deliveryDiscount = 0;
  let platformSubsidy = 0;
  let couponCategory = null;
  let appliedCoupon = null;
  let couponError = null;

  // Free-delivery threshold: customer pays ₹0 delivery; admin bears the waived fee
  // (same accounting as a free-delivery coupon). Rider fee stays in breakdown.
  if (isFreeByThreshold && deliveryFee > 0) {
    deliveryDiscount = deliveryFee;
    platformSubsidy = deliveryFee;
  }

  if (codeRaw) {
    const now = new Date();
    const offer = await FoodOffer.findOne({
      couponCode: codeRaw,
      isDeleted: { $ne: true },
      $or: [{ approvalStatus: 'approved' }, { approvalStatus: { $exists: false } }],
    }).lean();

    if (offer) {
      const eligibility = await checkOfferEligibility(offer, {
        userId,
        restaurantIds,
        subtotal,
        isMultiRestaurant,
        now,
      });

      if (eligibility.eligible) {
        const computed = computeOfferDiscount(offer, { subtotal, deliveryFee });
        discount = computed.discount;
        // Threshold free-delivery already waived the customer fee; don't double-count subsidy.
        if (!isFreeByThreshold) {
          deliveryDiscount = computed.deliveryDiscount;
          platformSubsidy = computed.platformSubsidy;
        }
        couponCategory = computed.couponCategory;
        appliedCoupon = {
          code: codeRaw,
          discount,
          deliveryDiscount: isFreeByThreshold ? 0 : computed.deliveryDiscount,
          platformSubsidy: isFreeByThreshold ? 0 : computed.platformSubsidy,
          couponCategory,
          createdBy: getCreatedByType(offer),
          offerId: offer._id,
        };
      } else {
        const createdBy = getCreatedByType(offer);
        couponError = {
          code: codeRaw,
          reason: eligibility.reason,
          message: mapCouponRejectionMessage(eligibility.reason, {
            minOrderValue: offer.minOrderValue,
            createdBy,
          }),
        };
        logOfferAction('failed', {
          couponCode: codeRaw,
          reason: eligibility.reason,
          userId,
        });
      }
    } else {
      couponError = {
        code: codeRaw,
        reason: 'invalid',
        message: mapCouponRejectionMessage('invalid'),
      };
      logOfferAction('failed', { couponCode: codeRaw, reason: 'invalid', userId });
    }
  }

  const customerDeliveryFee = Math.max(0, deliveryFee - deliveryDiscount);
  const total = Math.max(
    0,
    foodSubtotal + packagingFee + customerDeliveryFee + platformFee + tax - discount,
  );

  return {
    items,
    couponError,
    pricing: {
      subtotal,
      foodSubtotal,
      tax,
      packagingFee,
      restaurantPackagingTotal: packagingFee,
      deliveryFee,
      deliveryDiscount,
      deliveryFeeBreakdown: deliveryFeeBreakdown || undefined,
      peakHourCharge,
      peakHourSurcharge,
      platformFee,
      discount,
      platformSubsidy,
      couponCategory,
      total,
      currency: 'INR',
      couponCode: appliedCoupon?.code || null,
      couponCreatedBy: appliedCoupon?.createdBy || null,
      offerId: appliedCoupon?.offerId || null,
      appliedCoupon,
      couponError,
      restaurantGroups: restaurantGroups.map((g) => ({
        restaurantId: g.restaurantId,
        restaurantName: g.restaurantName,
        restaurantImage: g.restaurantImage,
        subtotal: g.subtotal,
        packagingFee: g.packagingFee,
        itemCount: g.items.reduce((n, it) => n + (Number(it.quantity) || 1), 0),
      })),
    },
  };
}
