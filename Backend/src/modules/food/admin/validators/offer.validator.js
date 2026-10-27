import { z } from 'zod';
import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';

const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be in HH:mm format').or(z.literal(''));

const createOfferSchema = z.object({
    couponCode: z.string().min(1, 'Coupon code is required'),
    discountType: z.enum(['percentage', 'flat-price']).default('percentage'),
    // Free delivery stores 0; normal coupons must be > 0 (enforced after parse).
    discountValue: z.number().min(0, 'Discount value must be 0 or greater'),
    customerScope: z.enum(['all', 'first-time']).default('all'),
    restaurantScope: z.enum(['all', 'selected']).default('all'),
    restaurantId: z.string().optional(),
    endDate: z.string().optional().or(z.literal('')).or(z.undefined()),
    startDate: z.string().optional().or(z.literal('')).or(z.undefined()),
    minOrderValue: z.number().min(0).optional(),
    maxDiscount: z.number().min(0).optional(),
    usageLimit: z.number().min(0).optional(),
    perUserLimit: z.number().min(0).optional(),
    isFirstOrderOnly: z.boolean().optional(),
    couponCategory: z.enum(['normal', 'free_delivery']).optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    banner: z.string().optional(),
    terms: z.string().optional(),
    activeDays: z.array(z.number().int().min(1).max(7)).optional(),
    activeFromTime: timeOfDaySchema.optional(),
    activeToTime: timeOfDaySchema.optional(),
    newToRestaurantOnly: z.boolean().optional(),
});

const updateOfferSchema = createOfferSchema.extend({
    status: z.enum(['active', 'paused', 'inactive']).optional(),
});

function assertDiscountRules(data) {
    const isFreeDelivery = data.couponCategory === 'free_delivery';
    if (isFreeDelivery) return;
    if (!(Number(data.discountValue) > 0)) {
        throw new ValidationError('Discount value must be greater than 0');
    }
}

/** Calendar start day at 00:00:00.000Z */
function parseOfferStartDate(ymd) {
    if (!ymd) return undefined;
    const startDate = new Date(`${String(ymd).trim()}T00:00:00.000Z`);
    if (Number.isNaN(startDate.getTime())) {
        throw new ValidationError('Invalid startDate');
    }
    return startDate;
}

/** Calendar end day at 23:59:59.999Z so same-day coupons remain valid all day */
function parseOfferEndDate(ymd) {
    if (!ymd) return undefined;
    const endDate = new Date(`${String(ymd).trim()}T23:59:59.999Z`);
    if (Number.isNaN(endDate.getTime())) {
        throw new ValidationError('Invalid endDate');
    }
    return endDate;
}

function assertOfferDateOrder(startDate, endDate, { requireFutureEndDate = true } = {}) {
    // Same calendar day is allowed (end-of-day > start-of-day).
    if (endDate && startDate && endDate.getTime() < startDate.getTime()) {
        throw new ValidationError('endDate must be on or after startDate');
    }
    if (requireFutureEndDate && endDate && endDate.getTime() < Date.now()) {
        throw new ValidationError('endDate must be a future date');
    }
}

function parseOfferDates(result, { requireFutureEndDate = true } = {}) {
    const endDate = parseOfferEndDate(result.data.endDate);
    const startDate = parseOfferStartDate(result.data.startDate);
    assertOfferDateOrder(startDate, endDate, { requireFutureEndDate });

    const isFreeDelivery = result.data.couponCategory === 'free_delivery';
    let maxDiscount = result.data.maxDiscount;
    if (!isFreeDelivery && result.data.discountType === 'percentage') {
        if (maxDiscount === undefined || maxDiscount === null || Number.isNaN(Number(maxDiscount))) {
            throw new ValidationError('maxDiscount is required for percentage coupons');
        }
        maxDiscount = Math.max(0, Number(maxDiscount) || 0);
    } else {
        maxDiscount = undefined;
    }

    return { endDate, startDate, maxDiscount };
}

export const validateCreateOfferDto = (body) => {
    const isFreeDelivery = body?.couponCategory === 'free_delivery';
    const normalized = {
        ...body,
        couponCode: typeof body?.couponCode === 'string' ? body.couponCode.trim() : body?.couponCode,
        discountType: isFreeDelivery ? 'flat-price' : body?.discountType,
        discountValue: isFreeDelivery ? 0 : Number(body?.discountValue),
        customerScope: body?.customerScope,
        restaurantScope: body?.restaurantScope,
        restaurantId: body?.restaurantId ? String(body.restaurantId) : undefined,
        endDate: body?.endDate ? String(body.endDate) : undefined,
        startDate: body?.startDate ? String(body.startDate) : undefined,
        minOrderValue: body?.minOrderValue !== undefined ? Number(body.minOrderValue) : undefined,
        maxDiscount: isFreeDelivery
            ? undefined
            : (body?.maxDiscount !== undefined ? Number(body.maxDiscount) : undefined),
        usageLimit: body?.usageLimit !== undefined ? Number(body.usageLimit) : undefined,
        perUserLimit: body?.perUserLimit !== undefined ? Number(body.perUserLimit) : undefined,
        isFirstOrderOnly: body?.isFirstOrderOnly !== undefined ? Boolean(body.isFirstOrderOnly) : undefined,
        couponCategory: body?.couponCategory || 'normal',
        name: body?.name ? String(body.name) : undefined,
        description: body?.description ? String(body.description) : undefined,
        banner: body?.banner ? String(body.banner) : undefined,
        terms: body?.terms ? String(body.terms) : undefined,
        activeDays: Array.isArray(body?.activeDays) ? body.activeDays.map(Number) : undefined,
        activeFromTime: body?.activeFromTime !== undefined ? String(body.activeFromTime) : undefined,
        activeToTime: body?.activeToTime !== undefined ? String(body.activeToTime) : undefined,
        newToRestaurantOnly: body?.newToRestaurantOnly !== undefined ? Boolean(body.newToRestaurantOnly) : undefined,
    };

    const result = createOfferSchema.safeParse(normalized);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }

    assertDiscountRules(result.data);

    if (result.data.restaurantScope === 'selected') {
        if (!result.data.restaurantId || !mongoose.Types.ObjectId.isValid(result.data.restaurantId)) {
            throw new ValidationError('Valid restaurantId is required for selected restaurant scope');
        }
    }

    const endDate = parseOfferEndDate(result.data.endDate);
    const startDate = parseOfferStartDate(result.data.startDate);
    assertOfferDateOrder(startDate, endDate, { requireFutureEndDate: true });

    let maxDiscount = result.data.maxDiscount;
    if (!isFreeDelivery && result.data.discountType === 'percentage') {
        if (maxDiscount === undefined || maxDiscount === null || Number.isNaN(Number(maxDiscount))) {
            throw new ValidationError('maxDiscount is required for percentage coupons');
        }
        maxDiscount = Math.max(0, Number(maxDiscount) || 0);
    } else {
        maxDiscount = undefined;
    }

    return {
        couponCode: result.data.couponCode.trim().toUpperCase(),
        discountType: isFreeDelivery ? 'flat-price' : result.data.discountType,
        discountValue: isFreeDelivery ? 0 : result.data.discountValue,
        customerScope: result.data.customerScope,
        restaurantScope: result.data.restaurantScope,
        restaurantId: result.data.restaurantScope === 'selected' ? result.data.restaurantId : undefined,
        endDate,
        startDate,
        minOrderValue: result.data.minOrderValue,
        maxDiscount: isFreeDelivery ? undefined : maxDiscount,
        usageLimit: result.data.usageLimit,
        perUserLimit: result.data.perUserLimit,
        isFirstOrderOnly: result.data.isFirstOrderOnly,
        couponCategory: result.data.couponCategory || 'normal',
        name: result.data.name,
        description: result.data.description,
        banner: result.data.banner,
        terms: result.data.terms,
        activeDays: result.data.activeDays,
        activeFromTime: result.data.activeFromTime,
        activeToTime: result.data.activeToTime,
        newToRestaurantOnly: result.data.newToRestaurantOnly,
    };
};

const cartVisibilitySchema = z.object({
    itemId: z.string().min(1, 'itemId is required'),
    showInCart: z.boolean()
});

export const validateUpdateOfferCartVisibilityDto = (body) => {
    const result = cartVisibilitySchema.safeParse(body || {});
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }
    return result.data;
};

export const validateRestaurantCreateOfferDto = (body) => {
    const normalized = {
        ...body,
        couponCode: typeof body?.couponCode === 'string' ? body.couponCode.trim() : body?.couponCode,
        discountType: body?.discountType,
        discountValue: Number(body?.discountValue),
        customerScope: body?.customerScope,
        restaurantScope: 'all',
        endDate: body?.endDate ? String(body.endDate) : undefined,
        startDate: body?.startDate ? String(body.startDate) : undefined,
        minOrderValue: body?.minOrderValue !== undefined ? Number(body.minOrderValue) : undefined,
        maxDiscount: body?.maxDiscount !== undefined ? Number(body.maxDiscount) : undefined,
        usageLimit: body?.usageLimit !== undefined ? Number(body.usageLimit) : undefined,
        perUserLimit: body?.perUserLimit !== undefined ? Number(body.perUserLimit) : undefined,
        isFirstOrderOnly: body?.isFirstOrderOnly !== undefined ? Boolean(body.isFirstOrderOnly) : undefined,
        activeDays: Array.isArray(body?.activeDays) ? body.activeDays.map(Number) : undefined,
        activeFromTime: body?.activeFromTime !== undefined ? String(body.activeFromTime) : undefined,
        activeToTime: body?.activeToTime !== undefined ? String(body.activeToTime) : undefined,
        newToRestaurantOnly: body?.newToRestaurantOnly !== undefined ? Boolean(body.newToRestaurantOnly) : undefined,
    };

    const result = createOfferSchema.safeParse(normalized);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }

    const endDate = parseOfferEndDate(result.data.endDate);
    const startDate = parseOfferStartDate(result.data.startDate);
    assertOfferDateOrder(startDate, endDate, { requireFutureEndDate: true });

    let maxDiscount = result.data.maxDiscount;
    if (result.data.discountType === 'percentage') {
        if (maxDiscount === undefined || maxDiscount === null || Number.isNaN(Number(maxDiscount))) {
            throw new ValidationError('maxDiscount is required for percentage coupons');
        }
        maxDiscount = Math.max(0, Number(maxDiscount) || 0);
    } else {
        maxDiscount = undefined;
    }

    return {
        couponCode: result.data.couponCode.trim().toUpperCase(),
        discountType: result.data.discountType,
        discountValue: result.data.discountValue,
        customerScope: result.data.customerScope,
        endDate,
        startDate,
        minOrderValue: result.data.minOrderValue,
        maxDiscount,
        usageLimit: result.data.usageLimit,
        perUserLimit: result.data.perUserLimit,
        isFirstOrderOnly: result.data.isFirstOrderOnly,
        activeDays: result.data.activeDays,
        activeFromTime: result.data.activeFromTime,
        activeToTime: result.data.activeToTime,
        newToRestaurantOnly: result.data.newToRestaurantOnly,
    };
};

export const validateUpdateOfferDto = (body) => {
    if (body && body.status && !body.couponCode) {
        const statusResult = z.object({ status: z.enum(['active', 'paused', 'inactive']) }).safeParse({ status: body.status });
        if (!statusResult.success) {
            throw new ValidationError(statusResult.error.errors[0].message);
        }
        return { status: statusResult.data.status };
    }

    const isFreeDelivery = body?.couponCategory === 'free_delivery';
    const normalized = {
        ...body,
        couponCode: typeof body?.couponCode === 'string' ? body.couponCode.trim() : body?.couponCode,
        discountType: isFreeDelivery ? 'flat-price' : body?.discountType,
        discountValue: isFreeDelivery ? 0 : Number(body?.discountValue),
        customerScope: body?.customerScope,
        restaurantScope: body?.restaurantScope,
        restaurantId: body?.restaurantId ? String(body.restaurantId) : undefined,
        endDate: body?.endDate ? String(body.endDate) : undefined,
        startDate: body?.startDate ? String(body.startDate) : undefined,
        minOrderValue: body?.minOrderValue !== undefined ? Number(body.minOrderValue) : undefined,
        maxDiscount: isFreeDelivery
            ? undefined
            : (body?.maxDiscount !== undefined ? Number(body.maxDiscount) : undefined),
        usageLimit: body?.usageLimit !== undefined ? Number(body.usageLimit) : undefined,
        perUserLimit: body?.perUserLimit !== undefined ? Number(body.perUserLimit) : undefined,
        isFirstOrderOnly: body?.isFirstOrderOnly !== undefined ? Boolean(body.isFirstOrderOnly) : undefined,
        status: body?.status,
        couponCategory: body?.couponCategory || 'normal',
        name: body?.name ? String(body.name) : undefined,
        description: body?.description ? String(body.description) : undefined,
        banner: body?.banner ? String(body.banner) : undefined,
        terms: body?.terms ? String(body.terms) : undefined,
        activeDays: Array.isArray(body?.activeDays) ? body.activeDays.map(Number) : undefined,
        activeFromTime: body?.activeFromTime !== undefined ? String(body.activeFromTime) : undefined,
        activeToTime: body?.activeToTime !== undefined ? String(body.activeToTime) : undefined,
        newToRestaurantOnly: body?.newToRestaurantOnly !== undefined ? Boolean(body.newToRestaurantOnly) : undefined,
    };

    const result = updateOfferSchema.safeParse(normalized);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }

    assertDiscountRules(result.data);

    if (result.data.restaurantScope === 'selected') {
        if (!result.data.restaurantId || !mongoose.Types.ObjectId.isValid(result.data.restaurantId)) {
            throw new ValidationError('Valid restaurantId is required for selected restaurant scope');
        }
    }

    const { endDate, startDate, maxDiscount } = parseOfferDates(result, { requireFutureEndDate: false });

    return {
        couponCode: result.data.couponCode.trim().toUpperCase(),
        discountType: isFreeDelivery ? 'flat-price' : result.data.discountType,
        discountValue: isFreeDelivery ? 0 : result.data.discountValue,
        customerScope: result.data.customerScope,
        restaurantScope: result.data.restaurantScope,
        restaurantId: result.data.restaurantScope === 'selected' ? result.data.restaurantId : undefined,
        endDate,
        startDate,
        minOrderValue: result.data.minOrderValue,
        maxDiscount: isFreeDelivery ? undefined : maxDiscount,
        usageLimit: result.data.usageLimit,
        perUserLimit: result.data.perUserLimit,
        isFirstOrderOnly: result.data.isFirstOrderOnly,
        status: result.data.status,
        couponCategory: result.data.couponCategory,
        name: result.data.name,
        description: result.data.description,
        banner: result.data.banner,
        terms: result.data.terms,
        activeDays: result.data.activeDays,
        activeFromTime: result.data.activeFromTime,
        activeToTime: result.data.activeToTime,
        newToRestaurantOnly: result.data.newToRestaurantOnly,
    };
};

export const validateRestaurantUpdateOfferDto = (body) => {
    if (body && body.status && !body.couponCode) {
        const statusResult = z.object({ status: z.enum(['active', 'paused', 'inactive']) }).safeParse({ status: body.status });
        if (!statusResult.success) {
            throw new ValidationError(statusResult.error.errors[0].message);
        }
        return { status: statusResult.data.status };
    }

    const normalized = {
        ...body,
        couponCode: typeof body?.couponCode === 'string' ? body.couponCode.trim() : body?.couponCode,
        discountType: body?.discountType,
        discountValue: Number(body?.discountValue),
        customerScope: body?.customerScope,
        restaurantScope: 'all',
        endDate: body?.endDate ? String(body.endDate) : undefined,
        startDate: body?.startDate ? String(body.startDate) : undefined,
        minOrderValue: body?.minOrderValue !== undefined ? Number(body.minOrderValue) : undefined,
        maxDiscount: body?.maxDiscount !== undefined ? Number(body.maxDiscount) : undefined,
        usageLimit: body?.usageLimit !== undefined ? Number(body.usageLimit) : undefined,
        perUserLimit: body?.perUserLimit !== undefined ? Number(body.perUserLimit) : undefined,
        isFirstOrderOnly: body?.isFirstOrderOnly !== undefined ? Boolean(body.isFirstOrderOnly) : undefined,
        status: body?.status,
        activeDays: Array.isArray(body?.activeDays) ? body.activeDays.map(Number) : undefined,
        activeFromTime: body?.activeFromTime !== undefined ? String(body.activeFromTime) : undefined,
        activeToTime: body?.activeToTime !== undefined ? String(body.activeToTime) : undefined,
        newToRestaurantOnly: body?.newToRestaurantOnly !== undefined ? Boolean(body.newToRestaurantOnly) : undefined,
    };

    const result = updateOfferSchema.safeParse(normalized);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }

    const { endDate, startDate, maxDiscount } = parseOfferDates(result, { requireFutureEndDate: false });

    return {
        couponCode: result.data.couponCode.trim().toUpperCase(),
        discountType: result.data.discountType,
        discountValue: result.data.discountValue,
        customerScope: result.data.customerScope,
        endDate,
        startDate,
        minOrderValue: result.data.minOrderValue,
        maxDiscount,
        usageLimit: result.data.usageLimit,
        perUserLimit: result.data.perUserLimit,
        isFirstOrderOnly: result.data.isFirstOrderOnly,
        status: result.data.status,
        activeDays: result.data.activeDays,
        activeFromTime: result.data.activeFromTime,
        activeToTime: result.data.activeToTime,
        newToRestaurantOnly: result.data.newToRestaurantOnly,
    };
};
