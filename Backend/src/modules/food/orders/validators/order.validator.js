import { z } from 'zod';
import { ValidationError } from '../../../../core/auth/errors.js';

const orderItemSchema = z.object({
    itemId: z.string().min(1, 'Item id required'),
    name: z.string().min(1, 'Item name required'),
    variantId: z.string().optional(),
    variantName: z.string().optional(),
    variantPrice: z.number().min(0).optional(),
    price: z.number().min(0),
    quantity: z.number().int().min(1),
    isVeg: z.boolean().optional().default(true),
    image: z.string().optional(),
    notes: z.string().optional(),
    restaurantId: z.string().optional()
});

const addressSchema = z.object({
    label: z.enum(['Home', 'Office', 'Other']).optional(),
    name: z.string().optional(),
    fullName: z.string().optional(),
    street: z.string().min(1, 'Street required'),
    additionalDetails: z.string().optional(),
    city: z.string().min(1, 'City required'),
    state: z.string().min(1, 'State required'),
    zipCode: z.string().optional(),
    phone: z.string().optional(),
    location: z
        .object({
            type: z.literal('Point').optional(),
            coordinates: z.tuple([z.number(), z.number()]).optional()
        })
        .optional()
});

const pricingSchema = z.object({
    // Client-sent totals are ignored; server recalculates. Kept optional for backward compat.
    subtotal: z.number().min(0).optional(),
    tax: z.number().min(0).optional(),
    packagingFee: z.number().min(0).optional(),
    deliveryFee: z.number().min(0).optional(),
    platformFee: z.number().min(0).optional(),
    discount: z.number().min(0).optional(),
    total: z.number().min(0).optional(),
    currency: z.string().optional(),
    couponCode: z.string().optional().nullable(),
    couponCreatedBy: z.string().optional().nullable(),
    offerId: z.string().optional().nullable(),
});

export function validateCalculateOrderDto(body) {
    const schema = z.object({
        items: z.array(orderItemSchema).min(1, 'At least one item required'),
        restaurantId: z.string().min(1, 'Restaurant id required'),
        deliveryAddress: z
            .object({
                location: z
                    .object({
                        type: z.literal('Point').optional(),
                        coordinates: z.tuple([z.number(), z.number()]).optional()
                    })
                    .optional()
            })
            .optional(),
        deliveryAddressId: z.string().optional(),
        zoneId: z.string().optional(),
        couponCode: z.string().optional(),
        deliveryFleet: z.string().optional(),
        deliverySpeedOptionId: z.string().optional(),
        deliveryOption: z.string().optional(),
        tip: z.number().min(0).optional(),
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        const first = result.error.issues?.[0];
        const path = first?.path?.length ? first.path.join('.') : '';
        const msg = path ? `${path}: ${first?.message || 'Validation failed'}` : first?.message || 'Validation failed';
        throw new ValidationError(msg);
    }
    return result.data;
}

export function validateCreateOrderDto(body) {
    const schema = z.object({
        items: z.array(orderItemSchema).min(1, 'At least one item required'),
        address: addressSchema,
        restaurantId: z.string().min(1, 'Restaurant id required'),
        restaurantName: z.string().optional(),
        customerName: z.string().optional(),
        customerPhone: z.string().optional(),
        pricing: pricingSchema,
        deliveryFleet: z.string().optional(),
        note: z.string().optional(),
        restaurantNote: z.string().optional(),
        deliveryInstructions: z.string().trim().max(240).optional(),
        tip: z.number().min(0).optional(),
        sendCutlery: z.boolean().optional(),
        // COD (cash / razorpay_qr-at-delivery) is disabled — prepaid only.
        paymentMethod: z.enum(['razorpay', 'card', 'wallet']),
        zoneId: z.string().nullable().optional(),
        scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
        deliveryOption: z.string().optional(),
        deliverySpeedOptionId: z.string().optional(),
        deliveryTime: z.string().optional(),
        estimatedTime: z.number().optional()
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        const msg = result.error.errors?.[0]?.message || 'Validation failed';
        throw new ValidationError(msg);
    }
    return result.data;
}

export function validateVerifyPaymentDto(body) {
    const schema = z.object({
        checkoutId: z.string().min(1).optional(),
        orderId: z.string().min(1).optional(),
        razorpayOrderId: z.string().min(1, 'Razorpay order id required'),
        razorpayPaymentId: z.string().min(1, 'Razorpay payment id required'),
        razorpaySignature: z.string().min(1, 'Razorpay signature required')
    }).refine((data) => Boolean(data.checkoutId || data.orderId), {
        message: 'checkoutId or orderId required',
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        const msg = result.error.errors?.[0]?.message || 'Validation failed';
        throw new ValidationError(msg);
    }
    return result.data;
}

export function validateCancelOrderDto(body) {
    const schema = z.object({
        reason: z.string().optional(),
        refundDestination: z.enum(['source', 'wallet']).optional()
    });
    const result = schema.safeParse(body || {});
    if (!result.success) {
        throw new ValidationError(result.error.errors?.[0]?.message || 'Validation failed');
    }
    return result.data;
}

export function validateOrderStatusDto(body) {
    const schema = z.object({
        orderStatus: z.enum([
            'confirmed',
            'preparing',
            'ready_for_pickup',
            'picked_up',
            'delivered',
            'cancelled_by_restaurant'
        ]),
        note: z.string().optional(),
        packingMinutes: z.number().int().min(0).optional()
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(result.error.errors?.[0]?.message || 'Validation failed');
    }
    return result.data;
}

export function validateAssignDeliveryDto(body) {
    const schema = z.object({
        deliveryPartnerId: z.string().min(1, 'Delivery partner id required')
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(result.error.errors?.[0]?.message || 'Validation failed');
    }
    return result.data;
}

export function validateDispatchSettingsDto(body) {
    const schema = z.object({
        dispatchMode: z.enum(['auto', 'manual'])
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(result.error.errors?.[0]?.message || 'Validation failed');
    }
    return result.data;
}

export function validateRestaurantChainDto(body) {
    const schema = z.object({
        // Preferred: first restaurant already in cart (anchor A)
        anchorRestaurantId: z.string().min(1).optional(),
        // Legacy alias — treated as the same anchor id
        lastRestaurantId: z.string().min(1).optional(),
        newRestaurantId: z.string().min(1, 'New restaurant id required'),
    }).refine(
        (data) => Boolean(data.anchorRestaurantId || data.lastRestaurantId),
        { message: 'First restaurant id required' },
    );
    const result = schema.safeParse(body || {});
    if (!result.success) {
        const first = result.error.issues?.[0];
        throw new ValidationError(first?.message || 'Validation failed');
    }
    return {
        ...result.data,
        anchorRestaurantId: result.data.anchorRestaurantId || result.data.lastRestaurantId,
    };
}

export function validateOrderRatingsDto(body) {
    const schema = z.object({
        restaurantRating: z.number().min(1).max(5),
        deliveryPartnerRating: z.number().min(1).max(5).optional(),
        restaurantComment: z.string().max(500).optional(),
        deliveryPartnerComment: z.string().max(500).optional()
    });
    const result = schema.safeParse(body || {});
    if (!result.success) {
        throw new ValidationError(result.error.errors?.[0]?.message || 'Validation failed');
    }
    return result.data;
}
