import mongoose from 'mongoose';
import { FoodOffer } from '../models/offer.model.js';
import { FoodOfferUsage } from '../models/offerUsage.model.js';
import { FoodOfferUsageHistory } from '../models/offerUsageHistory.model.js';
import { FoodOrder } from '../../orders/models/order.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { nowInZone } from '../../orders/services/order.helpers.js';

export const CREATED_BY_TYPE = { ADMIN: 'admin', RESTAURANT: 'restaurant' };
export const COUPON_CATEGORY = { NORMAL: 'normal', FREE_DELIVERY: 'free_delivery' };

export function getCreatedByType(offer) {
    return offer?.createdBy === CREATED_BY_TYPE.RESTAURANT
        ? CREATED_BY_TYPE.RESTAURANT
        : CREATED_BY_TYPE.ADMIN;
}

export function isFreeDeliveryCoupon(offer) {
    return offer?.couponCategory === COUPON_CATEGORY.FREE_DELIVERY;
}

function activeDateFilter(now = new Date()) {
    return {
        $and: [
            { $or: [{ startDate: { $exists: false } }, { startDate: null }, { startDate: { $lte: now } }] },
            { $or: [{ endDate: { $exists: false } }, { endDate: null }, { endDate: { $gt: now } }] },
        ],
    };
}

export function buildBaseActiveOfferFilter(now = new Date()) {
    return {
        status: 'active',
        isDeleted: { $ne: true },
        $or: [{ approvalStatus: 'approved' }, { approvalStatus: { $exists: false } }],
        ...activeDateFilter(now),
    };
}

const toMinutesOfDay = (value) => {
    const [hour, minute] = String(value || '').split(':').map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return hour * 60 + minute;
};

/** Day/time-of-day window check for a coupon, India time. Empty activeDays = every day;
 *  empty from/to = all day; end before start wraps past midnight (mirrors peak-hour rules). */
export function isCouponActiveNow(offer, clock = nowInZone('Asia/Kolkata')) {
    const days = Array.isArray(offer?.activeDays) ? offer.activeDays : [];
    // Model stores 1=Mon..7=Sun; nowInZone's `day` is 0=Sun..6=Sat — convert to the same scale.
    const isoDay = clock.day === 0 ? 7 : clock.day;

    const start = toMinutesOfDay(offer?.activeFromTime);
    const end = toMinutesOfDay(offer?.activeToTime);
    if (start === null || end === null || start === end) {
        return days.length === 0 || days.includes(isoDay);
    }

    if (end < start) {
        const inWindow = clock.minutes >= start || clock.minutes < end;
        if (!inWindow) return false;
        const owningDay = clock.minutes < end ? (isoDay === 1 ? 7 : isoDay - 1) : isoDay;
        return days.length === 0 || days.includes(owningDay);
    }

    if (clock.minutes < start || clock.minutes >= end) return false;
    return days.length === 0 || days.includes(isoDay);
}

function offerAppliesToRestaurant(offer, restaurantId) {
    const rid = String(restaurantId || '');
    if (!rid) return false;
    if (offer.restaurantScope === 'all') return true;
    if (Array.isArray(offer.restaurantIds) && offer.restaurantIds.length > 0) {
        return offer.restaurantIds.some((id) => String(id) === rid);
    }
    return String(offer.restaurantId || '') === rid;
}

/** Orders that still count toward "already ordered" for first-time coupons. */
const FIRST_TIME_EXCLUDED_STATUSES = [
    'cancelled_by_user',
    'rejected_by_restaurant',
    'cancelled_by_restaurant',
    'cancelled_by_admin',
];

/**
 * Platform coupon → any prior order on the platform.
 * Restaurant coupon → prior order only at that restaurant (main or multi-pickup).
 * Uses exists() for O(1)-style short-circuit (no full count).
 */
export async function countPriorOrdersForFirstTimeCoupon(userId, offer) {
    if (!userId) return 0;
    const uid = new mongoose.Types.ObjectId(userId);
    const base = {
        userId: uid,
        orderStatus: { $nin: FIRST_TIME_EXCLUDED_STATUSES },
    };

    let filter = base;
    if (getCreatedByType(offer) === CREATED_BY_TYPE.RESTAURANT) {
        const rid = offer.restaurantId;
        if (rid && mongoose.Types.ObjectId.isValid(String(rid))) {
            const restaurantOid = new mongoose.Types.ObjectId(String(rid));
            filter = {
                ...base,
                $or: [
                    { restaurantId: restaurantOid },
                    { 'pickups.restaurantId': restaurantOid },
                ],
            };
        }
    }

    const found = await FoodOrder.exists(filter);
    return found ? 1 : 0;
}

export function mapCouponRejectionMessage(reason, { minOrderValue, createdBy } = {}) {
    switch (reason) {
        case 'first_time_only':
        case 'first_order_only':
            return createdBy === CREATED_BY_TYPE.RESTAURANT
                ? 'This coupon is only for your first order at this restaurant'
                : 'This coupon is only for first-time users on the platform';
        case 'min_order':
            return Number(minOrderValue) > 0
                ? `Minimum order amount of ₹${Number(minOrderValue)} required for this coupon`
                : 'Minimum order amount not met for this coupon';
        case 'expired':
            return 'This coupon has expired';
        case 'not_started':
            return 'This coupon is not active yet';
        case 'usage_exceeded':
            return 'This coupon has reached its usage limit';
        case 'per_user_exceeded':
            return 'You have already used this coupon the maximum number of times';
        case 'restaurant_mismatch':
            return 'This coupon is not valid for the restaurant in your cart';
        case 'multi_restaurant':
            return 'This coupon cannot be used with items from multiple restaurants';
        case 'schedule':
            return 'This coupon is not active right now — check the days/hours it applies';
        case 'new_to_restaurant_only':
            return 'This coupon is only for customers who have never ordered from this restaurant';
        case 'inactive':
        case 'not_approved':
            return 'This coupon is not currently available';
        case 'invalid':
        default:
            return 'This coupon is not valid';
    }
}

function offerTitle(offer) {
    if (isFreeDeliveryCoupon(offer)) return 'FREE DELIVERY';
    if (offer.discountType === 'percentage') {
        return `${Number(offer.discountValue) || 0}% OFF`;
    }
    return `₹${Number(offer.discountValue) || 0} OFF`;
}

function offerSubtitle(offer) {
    if (isFreeDeliveryCoupon(offer)) return 'No Delivery Charge';
    const min = Number(offer.minOrderValue) || 0;
    return min > 0 ? `Minimum ₹${min}` : 'No minimum order';
}

export function mapOfferForDisplay(offer) {
    return {
        id: String(offer._id),
        offerId: String(offer._id),
        couponCode: offer.couponCode,
        code: offer.couponCode,
        title: offerTitle(offer),
        subtitle: offerSubtitle(offer),
        discountType: offer.discountType,
        discountValue: offer.discountValue,
        maxDiscount: offer.maxDiscount ?? null,
        minOrderValue: offer.minOrderValue ?? 0,
        couponCategory: offer.couponCategory || COUPON_CATEGORY.NORMAL,
        createdBy: getCreatedByType(offer),
        createdByType: getCreatedByType(offer),
        restaurantScope: offer.restaurantScope,
        restaurantId: offer.restaurantId ? String(offer.restaurantId) : null,
        endDate: offer.endDate || null,
        showInCart: offer.showInCart !== false,
        customerScope: offer.customerScope,
        isFreeDelivery: isFreeDeliveryCoupon(offer),
    };
}

export async function checkOfferEligibility(offer, {
    userId,
    restaurantIds = [],
    subtotal = 0,
    isMultiRestaurant = false,
    now = new Date(),
} = {}) {
    if (!offer || offer.isDeleted) return { eligible: false, reason: 'invalid' };
    if (offer.status !== 'active') return { eligible: false, reason: 'inactive' };
    const approvalOk = offer.approvalStatus === 'approved' || offer.approvalStatus == null;
    if (!approvalOk) return { eligible: false, reason: 'not_approved' };
    if (offer.startDate && now < new Date(offer.startDate)) return { eligible: false, reason: 'not_started' };
    if (offer.endDate && now >= new Date(offer.endDate)) return { eligible: false, reason: 'expired' };
    if (!isCouponActiveNow(offer)) return { eligible: false, reason: 'schedule' };

    const cartRestaurantIds = new Set(restaurantIds.map((id) => String(id)));
    if (offer.restaurantScope === 'selected') {
        const ids = Array.isArray(offer.restaurantIds) && offer.restaurantIds.length
            ? offer.restaurantIds.map(String)
            : [String(offer.restaurantId || '')];
        const scopeOk = ids.some((id) => cartRestaurantIds.has(id));
        if (!scopeOk) return { eligible: false, reason: 'restaurant_mismatch' };
    }

    if (isMultiRestaurant) {
        const multiOk = getCreatedByType(offer) === CREATED_BY_TYPE.ADMIN && offer.restaurantScope === 'all';
        if (!multiOk) return { eligible: false, reason: 'multi_restaurant' };
    }

    if (!isFreeDeliveryCoupon(offer)) {
        const minOk = subtotal >= (Number(offer.minOrderValue) || 0);
        if (!minOk) return { eligible: false, reason: 'min_order' };
    }

    if (Number(offer.usageLimit) > 0 && Number(offer.usedCount || 0) >= Number(offer.usageLimit)) {
        return { eligible: false, reason: 'usage_exceeded' };
    }

    if (userId && Number(offer.perUserLimit) > 0) {
        const usage = await FoodOfferUsage.findOne({
            offerId: offer._id,
            userId: new mongoose.Types.ObjectId(userId),
        }).lean();
        if (usage && Number(usage.count) >= Number(offer.perUserLimit)) {
            return { eligible: false, reason: 'per_user_exceeded' };
        }
    }

    if (userId && (offer.customerScope === 'first-time' || offer.isFirstOrderOnly === true)) {
        const prior = await countPriorOrdersForFirstTimeCoupon(userId, offer);
        if (prior > 0) {
            return {
                eligible: false,
                reason: offer.customerScope === 'first-time' ? 'first_time_only' : 'first_order_only',
            };
        }
    }

    if (userId && offer.newToRestaurantOnly && cartRestaurantIds.size > 0) {
        const priorAtRestaurant = await FoodOrder.exists({
            userId: new mongoose.Types.ObjectId(userId),
            orderStatus: { $nin: FIRST_TIME_EXCLUDED_STATUSES },
            $or: [
                { restaurantId: { $in: [...cartRestaurantIds].map((id) => new mongoose.Types.ObjectId(id)) } },
                { 'pickups.restaurantId': { $in: [...cartRestaurantIds].map((id) => new mongoose.Types.ObjectId(id)) } },
            ],
        });
        if (priorAtRestaurant) return { eligible: false, reason: 'new_to_restaurant_only' };
    }

    return { eligible: true };
}

export function computeOfferDiscount(offer, { subtotal = 0, deliveryFee = 0 } = {}) {
    if (isFreeDeliveryCoupon(offer)) {
        const waived = Math.max(0, Number(deliveryFee) || 0);
        return {
            discount: 0,
            deliveryDiscount: waived,
            platformSubsidy: waived,
            couponCategory: COUPON_CATEGORY.FREE_DELIVERY,
        };
    }

    let discount = 0;
    if (offer.discountType === 'percentage') {
        const raw = subtotal * (Number(offer.discountValue) / 100);
        const capped = Number(offer.maxDiscount)
            ? Math.min(raw, Number(offer.maxDiscount))
            : raw;
        discount = Math.max(0, Math.min(subtotal, Math.floor(capped)));
    } else {
        discount = Math.max(0, Math.min(subtotal, Math.floor(Number(offer.discountValue) || 0)));
    }

    return {
        discount,
        deliveryDiscount: 0,
        platformSubsidy: 0,
        couponCategory: COUPON_CATEGORY.NORMAL,
    };
}

export async function filterEligibleOffers(offers, context) {
    const eligible = [];
    for (const offer of offers) {
        const check = await checkOfferEligibility(offer, context);
        if (check.eligible) eligible.push(offer);
    }
    return eligible;
}

export async function getOffersForRestaurantPage(restaurantId, userId = null) {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
        return { coupons: [], source: null };
    }

    const now = new Date();
    const baseFilter = buildBaseActiveOfferFilter(now);
    const rid = new mongoose.Types.ObjectId(restaurantId);

    const restaurantOffers = await FoodOffer.find({
        ...baseFilter,
        createdBy: CREATED_BY_TYPE.RESTAURANT,
        restaurantId: rid,
    }).sort({ createdAt: -1 }).lean();

    const eligibleRestaurant = await filterEligibleOffers(restaurantOffers, {
        userId,
        restaurantIds: [restaurantId],
        subtotal: 0,
        isMultiRestaurant: false,
    });

    if (eligibleRestaurant.length > 0) {
        return {
            coupons: eligibleRestaurant.map(mapOfferForDisplay),
            source: CREATED_BY_TYPE.RESTAURANT,
        };
    }

    const adminOffers = await FoodOffer.find({
        ...baseFilter,
        createdBy: CREATED_BY_TYPE.ADMIN,
        $or: [
            { restaurantScope: 'all' },
            { restaurantId: rid },
            { restaurantIds: rid },
        ],
    }).sort({ createdAt: -1 }).lean();

    const applicableAdmin = adminOffers.filter((o) => offerAppliesToRestaurant(o, restaurantId));
    const eligibleAdmin = await filterEligibleOffers(applicableAdmin, {
        userId,
        restaurantIds: [restaurantId],
        subtotal: 0,
        isMultiRestaurant: false,
    });

    if (eligibleAdmin.length > 0) {
        return {
            coupons: eligibleAdmin.map(mapOfferForDisplay),
            source: CREATED_BY_TYPE.ADMIN,
        };
    }

    return { coupons: [], source: null };
}

export async function recordOfferRedemption({ offer, order, userId }) {
    if (!offer?._id || !order?._id) return;

    const discountAmount = Number(order.pricing?.discount || 0) || 0;
    const platformSubsidy = Number(order.pricing?.platformSubsidy || 0) || 0;
    const deliveryCharge = Number(order.pricing?.deliveryFee || 0) || 0;
    const deliveryCovered = Number(order.pricing?.deliveryDiscount || 0) || 0;

    await FoodOffer.updateOne(
        { _id: offer._id },
        {
            $inc: {
                usedCount: 1,
                totalDiscount: discountAmount,
                platformSubsidy,
            },
        },
    );

    if (userId) {
        await FoodOfferUsage.updateOne(
            { offerId: offer._id, userId: new mongoose.Types.ObjectId(userId) },
            { $inc: { count: 1 }, $set: { lastUsedAt: new Date() } },
            { upsert: true },
        );
    }

    await FoodOfferUsageHistory.create({
        offerId: offer._id,
        userId: order.userId,
        restaurantId: order.restaurantId,
        orderId: order._id,
        couponCode: order.pricing?.couponCode || offer.couponCode,
        discountAmount,
        deliveryCharge,
        deliveryChargeCovered: deliveryCovered,
        platformSubsidy,
        orderAmount: Number(order.pricing?.subtotal || 0) + Number(order.pricing?.packagingFee || 0),
        paymentMethod: order.payment?.method || null,
        orderStatus: order.orderStatus || null,
        usedAt: new Date(),
    });

    logOfferAction('applied', {
        offerId: String(offer._id),
        orderId: String(order._id),
        couponCode: offer.couponCode,
        discountAmount,
        platformSubsidy,
        createdBy: getCreatedByType(offer),
    });
}

export function logOfferAction(action, meta = {}) {
    const entry = { action, at: new Date().toISOString(), ...meta };
    if (action === 'failed') {
        console.warn('[coupon]', entry);
    } else {
        console.info('[coupon]', entry);
    }
}

function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}

function startOfWeek(d) {
    const x = startOfDay(d);
    const day = x.getDay();
    x.setDate(x.getDate() - day);
    return x;
}

function startOfMonth(d) {
    const x = startOfDay(d);
    x.setDate(1);
    return x;
}

export async function getOfferAnalytics(offerId, { restaurantId = null } = {}) {
    if (!offerId || !mongoose.Types.ObjectId.isValid(offerId)) return null;

    const offer = await FoodOffer.findById(offerId).lean();
    if (!offer) return null;

    const historyFilter = { offerId: new mongoose.Types.ObjectId(offerId) };
    if (restaurantId) {
        historyFilter.restaurantId = new mongoose.Types.ObjectId(restaurantId);
    }

    const histories = await FoodOfferUsageHistory.find(historyFilter).lean();
    const now = new Date();
    const todayStart = startOfDay(now);
    const weekStart = startOfWeek(now);
    const monthStart = startOfMonth(now);

    const uniqueUsers = new Set(histories.map((h) => String(h.userId)));
    const userCounts = {};
    histories.forEach((h) => {
        const uid = String(h.userId);
        userCounts[uid] = (userCounts[uid] || 0) + 1;
    });
    const repeatUsers = Object.values(userCounts).filter((c) => c > 1).length;

    const totalDiscount = histories.reduce((s, h) => s + Number(h.discountAmount || 0), 0);
    const totalPlatformSubsidy = histories.reduce((s, h) => s + Number(h.platformSubsidy || 0), 0);
    const revenueGenerated = histories.reduce((s, h) => s + Number(h.orderAmount || 0), 0);
    const totalUses = histories.length;
    const avgOrderValue = totalUses > 0 ? Math.round(revenueGenerated / totalUses) : 0;

    const isExpired = Boolean(offer.endDate && now >= new Date(offer.endDate));
    const remainingUsage = Number(offer.usageLimit) > 0
        ? Math.max(0, Number(offer.usageLimit) - Number(offer.usedCount || 0))
        : null;

    const dailyUsage = {};
    const monthlyUsage = {};
    histories.forEach((h) => {
        const d = new Date(h.usedAt);
        const dayKey = d.toISOString().slice(0, 10);
        const monthKey = dayKey.slice(0, 7);
        dailyUsage[dayKey] = (dailyUsage[dayKey] || 0) + 1;
        monthlyUsage[monthKey] = (monthlyUsage[monthKey] || 0) + 1;
    });

    return {
        offerId: String(offer._id),
        couponCode: offer.couponCode,
        couponCategory: offer.couponCategory || COUPON_CATEGORY.NORMAL,
        createdBy: getCreatedByType(offer),
        status: offer.status,
        approvalStatus: offer.approvalStatus,
        isExpired,
        totalUses,
        todayUses: histories.filter((h) => new Date(h.usedAt) >= todayStart).length,
        weekUses: histories.filter((h) => new Date(h.usedAt) >= weekStart).length,
        monthUses: histories.filter((h) => new Date(h.usedAt) >= monthStart).length,
        totalDiscount,
        totalPlatformSubsidy,
        freeDeliveryCost: totalPlatformSubsidy,
        uniqueUsers: uniqueUsers.size,
        repeatUsers,
        ordersGenerated: totalUses,
        revenueGenerated,
        averageOrderValue: avgOrderValue,
        remainingUsage,
        dailyUsage,
        monthlyUsage,
    };
}

export async function getOfferUsageHistory(offerId, { restaurantId = null, page = 1, limit = 20 } = {}) {
    if (!offerId || !mongoose.Types.ObjectId.isValid(offerId)) return null;

    const offer = await FoodOffer.findById(offerId).select('_id couponCode createdBy restaurantId').lean();
    if (!offer) return null;

    const filter = { offerId: new mongoose.Types.ObjectId(offerId) };
    if (restaurantId) {
        filter.restaurantId = new mongoose.Types.ObjectId(restaurantId);
    }

    const skip = (Math.max(1, page) - 1) * limit;
    const [items, total] = await Promise.all([
        FoodOfferUsageHistory.find(filter)
            .sort({ usedAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate({ path: 'userId', select: 'name phone' })
            .populate({ path: 'restaurantId', select: 'restaurantName' })
            .lean(),
        FoodOfferUsageHistory.countDocuments(filter),
    ]);

    const history = items.map((h) => ({
        orderId: String(h.orderId),
        customerId: String(h.userId?._id || h.userId),
        customerName: h.userId?.name || '—',
        customerPhone: h.userId?.phone || '—',
        restaurant: h.restaurantId?.restaurantName || '—',
        restaurantId: String(h.restaurantId?._id || h.restaurantId),
        couponUsed: h.couponCode,
        discountAmount: h.discountAmount,
        orderAmount: h.orderAmount,
        deliveryCharge: h.deliveryCharge,
        platformSubsidy: h.platformSubsidy,
        paymentMethod: h.paymentMethod,
        orderStatus: h.orderStatus,
        usedAt: h.usedAt,
    }));

    return {
        offerId: String(offerId),
        couponCode: offer.couponCode,
        history,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) || 0 },
    };
}

export function buildAdminOfferUpdate(existing, body, adminId) {
    const isRestaurantCoupon = getCreatedByType(existing) === CREATED_BY_TYPE.RESTAURANT;

    if (isRestaurantCoupon) {
        const allowed = {
            couponCode: body.couponCode,
            status: body.status,
        };
        if (!allowed.couponCode && !allowed.status) throw new ValidationError('At least one editable field is required');
        return allowed;
    }

    const isFreeDelivery = body.couponCategory === COUPON_CATEGORY.FREE_DELIVERY;
    return {
        couponCode: body.couponCode,
        discountType: isFreeDelivery ? 'flat-price' : body.discountType,
        discountValue: isFreeDelivery ? 0 : body.discountValue,
        customerScope: body.customerScope,
        restaurantScope: body.restaurantScope,
        restaurantId: body.restaurantScope === 'selected' ? body.restaurantId : null,
        restaurantIds: body.restaurantIds,
        minOrderValue: body.minOrderValue ?? 0,
        maxDiscount: isFreeDelivery ? null : (body.maxDiscount ?? null),
        usageLimit: body.usageLimit ?? null,
        perUserLimit: body.perUserLimit ?? null,
        startDate: body.startDate,
        isFirstOrderOnly: body.isFirstOrderOnly ?? false,
        endDate: body.endDate,
        name: body.name,
        description: body.description,
        banner: body.banner,
        terms: body.terms,
        couponCategory: body.couponCategory || COUPON_CATEGORY.NORMAL,
        isGlobal: body.restaurantScope === 'all',
        createdById: adminId,
        activeDays: body.activeDays ?? [],
        activeFromTime: body.activeFromTime ?? '',
        activeToTime: body.activeToTime ?? '',
        newToRestaurantOnly: body.newToRestaurantOnly ?? false,
    };
}
