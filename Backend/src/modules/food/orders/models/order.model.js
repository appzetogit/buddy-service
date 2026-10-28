import mongoose from 'mongoose';
import { buildLocationSchema } from '../../../../core/location/location.schema.js';

const orderItemSchema = new mongoose.Schema(
    {
        itemId: { type: String, required: true, trim: true },
        name: { type: String, required: true, trim: true },
        variantId: { type: String, trim: true, default: '' },
        variantName: { type: String, trim: true, default: '' },
        variantPrice: { type: Number, min: 0, default: 0 },
        price: { type: Number, required: true, min: 0 },
        quantity: { type: Number, required: true, min: 1 },
        isVeg: { type: Boolean, default: true },
        image: { type: String, default: '' },
        restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodRestaurant' },
        notes: { type: String, default: '' }
    },
    { _id: false }
);

const deliveryAddressSchema = new mongoose.Schema(
    {
        label: { type: String, enum: ['Home', 'Office', 'Other'], default: 'Home' },
        name: { type: String, default: '', trim: true },
        fullName: { type: String, default: '', trim: true },
        street: { type: String, required: true, trim: true },
        additionalDetails: { type: String, default: '', trim: true },
        city: { type: String, required: true, trim: true },
        state: { type: String, required: true, trim: true },
        zipCode: { type: String, default: '', trim: true },
        phone: { type: String, default: '', trim: true },
        location: {
            type: buildLocationSchema(),
            default: undefined
        }
    },
    { _id: false }
);

const pricingSchema = new mongoose.Schema(
    {
        subtotal: { type: Number, required: true, min: 0 },
        foodSubtotal: { type: Number, default: 0, min: 0 },
        tax: { type: Number, default: 0, min: 0 },
        packagingFee: { type: Number, default: 0, min: 0 },
        restaurantPackagingTotal: { type: Number, default: 0, min: 0 },
        deliveryFee: { type: Number, default: 0, min: 0 },
        platformFee: { type: Number, default: 0, min: 0 },
        restaurantCommission: { type: Number, default: 0, min: 0 },
        discount: { type: Number, default: 0, min: 0 },
        couponCode: { type: String },
        couponCreatedBy: { type: String, enum: ['admin', 'restaurant'] },
        couponCategory: { type: String, enum: ['normal', 'free_delivery'] },
        offerId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodOffer' },
        platformSubsidy: { type: Number, default: 0, min: 0 },
        deliveryDiscount: { type: Number, default: 0, min: 0 },
        total: { type: Number, required: true, min: 0 },
        currency: { type: String, default: 'INR' },
        deliveryFeeBreakdown: { type: mongoose.Schema.Types.Mixed },
        restaurantGroups: { type: mongoose.Schema.Types.Mixed },
    },
    { _id: false }
);

const restaurantSettlementSchema = new mongoose.Schema(
    {
        restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodRestaurant' },
        restaurantName: { type: String, default: '' },
        foodAmount: { type: Number, default: 0, min: 0 },
        packagingFee: { type: Number, default: 0, min: 0 },
        commission: { type: Number, default: 0, min: 0 },
        commissionGST: { type: Number, default: 0, min: 0 },
        /** Restaurant share of positive Cart Delivery Speed fee */
        speedShare: { type: Number, default: 0, min: 0 },
        /** Restaurant-funded coupon discount applied to this payout */
        couponDiscount: { type: Number, default: 0, min: 0 },
        restaurantPayout: { type: Number, default: 0, min: 0 },
    },
    { _id: false }
);

const driverSettlementSchema = new mongoose.Schema(
    {
        deliveryFee: { type: Number, default: 0, min: 0 },
        tip: { type: Number, default: 0, min: 0 },
        incentive: { type: Number, default: 0, min: 0 },
        driverPayout: { type: Number, default: 0, min: 0 },
    },
    { _id: false }
);

const platformRevenueSchema = new mongoose.Schema(
    {
        platformFee: { type: Number, default: 0, min: 0 },
        commission: { type: Number, default: 0, min: 0 },
        deliveryMargin: { type: Number, default: 0, min: 0 },
    },
    { _id: false }
);

const paymentSchema = new mongoose.Schema(
    {
        method: {
            type: String,
            enum: ['cash', 'razorpay', 'razorpay_qr', 'wallet'],
            required: true
        },
        status: {
            type: String,
            enum: [
                'cod_pending',
                'created',
                'authorized',
                'paid',
                'failed',
                'refunded',
                'pending_qr'
            ],
            default: 'cod_pending'
        },
        /** Populated from the payment.failed webhook so a failure is diagnosable after the fact. */
        failureReason: { type: String, default: null },
        amountDue: { type: Number, min: 0 },
        razorpay: {
            orderId: { type: String },
            paymentId: { type: String },
            signature: { type: String }
        },
        qr: {
            qrId: { type: String },
            imageUrl: { type: String },
            paymentLinkId: { type: String },
            shortUrl: { type: String },
            status: { type: String },
            expiresAt: { type: Date }
        },
        // ✅ NEW: Added refund object to track refund status without breaking existing flow
        refund: {
            status: {
                type: String,
                enum: ['none', 'pending', 'processed', 'failed'],
                default: 'none'
            },
            destination: {
                type: String,
                enum: ['source', 'wallet'],
                default: 'source'
            },
            amount: { type: Number, default: 0 },
            refundId: { type: String, default: '' },
            processedAt: { type: Date }
        }
    },
    { _id: false }
);

const dispatchSchema = new mongoose.Schema(
    {
        modeAtCreation: { type: String, enum: ['auto'], default: 'auto' },
        status: {
            type: String,
            enum: ['unassigned', 'offered', 'assigned', 'accepted', 'rejected', 'cancelled', 'timed_out'],
            default: 'unassigned'
        },
        deliveryPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodDeliveryPartner', default: null },
        assignedAt: { type: Date },
        acceptedAt: { type: Date },
        /** List of partners who were offered this order (to avoid repeats and track timeouts) */
        offeredTo: [{
            partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodDeliveryPartner' },
            at: { type: Date, default: Date.now },
            action: { type: String, enum: ['offered', 'accepted', 'rejected', 'timeout'], default: 'offered' },
            allowOverLimit: { type: Boolean, default: false },
            requiredCashForOrder: { type: Number, default: 0 }
        }],
        /** Admin (and system) driver assign/reassign audit trail */
        assignmentHistory: [{
            at: { type: Date, default: Date.now },
            action: {
                type: String,
                enum: ['assigned', 'reassigned'],
                default: 'assigned'
            },
            fromPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodDeliveryPartner', default: null },
            fromPartnerName: { type: String, default: '' },
            fromPartnerPhone: { type: String, default: '' },
            toPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodDeliveryPartner', default: null },
            toPartnerName: { type: String, default: '' },
            toPartnerPhone: { type: String, default: '' },
            byRole: {
                type: String,
                enum: ['USER', 'RESTAURANT', 'DELIVERY_PARTNER', 'ADMIN', 'SYSTEM'],
                default: 'ADMIN'
            },
            byId: { type: mongoose.Schema.Types.ObjectId, default: null },
            note: { type: String, default: '' }
        }],
        isShared: { type: Boolean, default: false },
        sharedPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodDeliveryPartner', default: null },
        /** When the second-driver (share) slot was opened; drives the solo-complete timeout fallback. */
        shareOpenedAt: { type: Date, default: null },
        /** When the driver-first restaurant-acknowledgement nudge was last resent (escalation throttle). */
        restaurantAckResendAt: { type: Date, default: null },
        dispatchingAt: { type: Date }
    },
    { _id: false }
);

const deliveryStateSchema = new mongoose.Schema(
    {
        currentPhase: {
            type: String,
            enum: [
                'en_route_to_pickup',
                'at_pickup',
                'en_route_to_delivery',
                'at_drop',
                'delivered',
                'completed'
            ],
            default: 'en_route_to_pickup'
        },
        status: { type: String, default: '' },
        isSplitConfirmed: { type: Boolean, default: false },
        reachedPickupAt: { type: Date, default: null },
        reachedDropAt: { type: Date, default: null },
        pickedUpAt: { type: Date, default: null },
        deliveredAt: { type: Date, default: null }
    },
    { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
    {
        at: { type: Date, default: Date.now },
        byRole: { type: String, enum: ['USER', 'RESTAURANT', 'DELIVERY_PARTNER', 'ADMIN', 'SYSTEM'] },
        byId: { type: mongoose.Schema.Types.ObjectId },
        from: { type: String },
        to: { type: String },
        note: { type: String, default: '' }
    },
    { _id: false }
);

const orderEntityRatingSchema = new mongoose.Schema(
    {
        rating: { type: Number, min: 1, max: 5 },
        comment: { type: String, default: '', trim: true },
        ratedAt: { type: Date, default: Date.now }
    },
    { _id: false }
);

const orderRatingsSchema = new mongoose.Schema(
    {
        restaurant: { type: orderEntityRatingSchema, default: undefined },
        deliveryPartner: { type: orderEntityRatingSchema, default: undefined }
    },
    { _id: false }
);

const deliveryVerificationSchema = new mongoose.Schema(
    {
        dropOtp: {
            required: { type: Boolean, default: false },
            verified: { type: Boolean, default: false }
        }
    },
    { _id: false }
);

const pickupSchema = new mongoose.Schema(
    {
        restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodRestaurant', required: true },
        restaurantName: { type: String, default: '' },
        status: {
            type: String,
            enum: ['pending', 'accepted', 'preparing', 'ready', 'picked_up', 'cancelled'],
            default: 'pending'
        },
        location: {
            type: buildLocationSchema(),
            default: undefined
        },
        items: [String], // Array of item names or IDs belonging to this pickup
        /** Visit order for this stop (0-based). Lower = visited earlier; nearest-to-customer is last. */
        sequence: { type: Number, default: 0 },
        /** Estimated kitchen prep time (minutes) for this restaurant's items, from menu preparationTime. */
        prepMinutes: { type: Number, default: 0, min: 0 },
        /** Restaurant-entered packing/prep time (minutes), given when they confirm the order. */
        packingMinutes: { type: Number, default: null, min: 0 },
        /** Set when this restaurant marks its items ready — drives waiting-state + ready-time ordering. */
        readyAt: { type: Date, default: null },
        /** Legacy strike counter (unused since Phase 3 immediate-drop policy); kept for back-compat. */
        rejectionAttempts: { type: Number, default: 0, min: 0 },
        /** Set on rejection — restaurant is dropped immediately; order continues without it (or cancels if none remain). */
        permanentlyDropped: { type: Boolean, default: false },
        pickedAt: { type: Date, default: null },
        droppedAt: { type: Date, default: null },
        billImageUrl: { type: String, default: null },
        /** Restaurant-side handover OTP for this pickup stop, shown to the restaurant and
         *  entered by the rider alongside the bill photo. Mirrors the drop-off OTP pattern. */
        pickupOtp: { type: String, default: '' },
        pickupOtpVerified: { type: Boolean, default: false },
    },
    { _id: false }
);

/**
 * One independent delivery leg. Legs exist only once a second driver joins (Flow 3);
 * single-driver orders keep using `deliveryState` and never populate this array.
 * Each leg is picked up, driven and OTP-verified independently, and the parent order is only
 * DELIVERED when every non-cancelled leg is delivered.
 */
const deliveryLegSchema = new mongoose.Schema(
    {
        legIndex: { type: Number, required: true },
        role: { type: String, enum: ['primary', 'secondary'], required: true },
        partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodDeliveryPartner', default: null },
        status: {
            type: String,
            enum: [
                'assigned',
                'en_route_to_pickup',
                'at_pickup',
                'picked_up',
                'at_drop',
                'delivered',
                'cancelled',
            ],
            default: 'assigned'
        },
        /** Stop-level split (multi-restaurant): the restaurants this leg collects from. */
        restaurantIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FoodRestaurant' }],
        /**
         * Item-level split (single restaurant): which order.items lines and how many units of
         * each this leg carries. Quantity-aware so a single line of qty 20 can still be halved.
         */
        itemSplits: [
            {
                itemIndex: { type: Number, required: true },
                quantity: { type: Number, required: true, min: 1 },
                _id: false,
            },
        ],
        /** Per-leg handover OTP — every leg is verified independently at the drop. */
        otp: { type: String, default: '' },
        otpVerified: { type: Boolean, default: false },
        earning: { type: Number, default: 0, min: 0 },
        assignedAt: { type: Date, default: Date.now },
        reachedPickupAt: { type: Date, default: null },
        pickedAt: { type: Date, default: null },
        reachedDropAt: { type: Date, default: null },
        deliveredAt: { type: Date, default: null },
    },
    { _id: false }
);

const partialRefundSchema = new mongoose.Schema(
    {
        restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodRestaurant' },
        restaurantName: { type: String, default: '' },
        amount: { type: Number, default: 0, min: 0 },
        foodAmount: { type: Number, default: 0, min: 0 },
        packagingFee: { type: Number, default: 0, min: 0 },
        taxShare: { type: Number, default: 0, min: 0 },
        destination: { type: String, enum: ['wallet', 'source'], default: 'wallet' },
        status: { type: String, enum: ['processed', 'failed'], default: 'processed' },
        at: { type: Date, default: Date.now },
        note: { type: String, default: '' },
    },
    { _id: false }
);

const orderSchema = new mongoose.Schema(
    {
        order_id: {
            type: String,
            unique: true,
            sparse: true,
            index: true
        },
        /** Compatibility alias: satisfies rogue unique index 'orderId_1' found in legacy deployments. */
        orderId: {
            type: String,
            unique: true,
            sparse: true,
            index: true
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodUser',
            required: true
        },
        restaurantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodRestaurant',
            required: true
        },
        isMultiRestaurant: { type: Boolean, default: false },
        pickups: {
            type: [pickupSchema],
            default: []
        },
        zoneId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodZone',
            index: true
        },
        transactionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodTransaction',
            index: true
        },
        items: {
            type: [orderItemSchema],
            required: true,
            validate: (v) => Array.isArray(v) && v.length > 0
        },
        deliveryAddress: {
            type: deliveryAddressSchema,
            required: true
        },
        customerName: { type: String, default: '', trim: true },
        customerPhone: { type: String, default: '', trim: true },
        pricing: {
            type: pricingSchema,
            required: false
        },
        restaurantSettlement: {
            type: [restaurantSettlementSchema],
            default: [],
        },
        driverSettlement: {
            type: driverSettlementSchema,
            default: undefined,
        },
        platformRevenue: {
            type: platformRevenueSchema,
            default: undefined,
        },
        /**
         * Full who-got-what ledger for admin invoice:
         * customer / restaurants / driver / platform / speed / costBearers
         */
        settlementBreakdown: {
            type: mongoose.Schema.Types.Mixed,
            default: undefined,
        },
        /**
         * Denormalized payment snapshot for fast reads & legacy clients.
         * Authoritative audit trail: collection `food_order_payments` (FoodOrderPayment model).
         */
        payment: {
            type: paymentSchema,
            required: false
        },
        orderStatus: {
            type: String,
            enum: [
                'created',
                'scheduled',
                'confirmed',
                'preparing',
                'ready_for_pickup',
                'reached_pickup',
                'picked_up',
                'reached_drop',
                'delivered',
                'cancelled_by_user',
                'rejected_by_restaurant',
                'cancelled_by_restaurant',
                'cancelled_by_admin'
            ],
            default: 'created'
        },
        dispatch: {
            type: dispatchSchema,
            default: () => ({})
        },
        deliveryState: {
            type: deliveryStateSchema,
            default: () => ({})
        },
        statusHistory: {
            type: [statusHistorySchema],
            default: []
        },
        ratings: {
            type: orderRatingsSchema,
            default: () => ({})
        },
        restaurantNote: { type: String, default: '', trim: true },
        deliveryInstructions: { type: String, default: '', trim: true, maxlength: 240 },
        note: { type: String, default: '', trim: true },
        sendCutlery: { type: Boolean, default: true },
        deliveryFleet: { type: String, default: 'standard', trim: true },
        scheduledAt: { type: Date, default: null },
        deliveryOption: { type: String, default: 'Standard Delivery', trim: true },
        deliveryTime: { type: String, default: '25–35 mins', trim: true },
        estimatedTime: { type: Number, default: 30 },
        /** Restaurant-entered packing/prep time (minutes) for single-restaurant orders, set on confirm. */
        packingMinutes: { type: Number, default: null, min: 0 },
        riderEarning: { type: Number, default: 0, min: 0 },
        sharedRiderEarning: { type: Number, default: 0, min: 0 },
        platformProfit: { type: Number, default: 0, min: 0 },
        /** Plain 4-digit OTP for handover; cleared after successful verify (never expose to partner in API responses). */
        deliveryOtp: { type: String, default: '', select: false },
        deliveryVerification: {
            type: deliveryVerificationSchema,
            default: () => ({})
        },
        /** Latest rider location for this specific order (GeoJSON Point) */
        lastRiderLocation: {
            type: { type: String, enum: ['Point'] },
            coordinates: { type: [Number] }
        },
        /** Track how many times the restaurant has rejected this order while a rider is assigned */
        restaurantRejectionCount: { type: Number, default: 0 },
        /** Partial wallet refunds when a multi-restaurant pickup is permanently dropped */
        partialRefunds: {
            type: [partialRefundSchema],
            default: [],
        },
        /**
         * Immutable settlement snapshots for audits:
         * create / share / partial_drop / complete
         */
        settlementSnapshots: {
            type: [
                {
                    at: { type: Date, default: Date.now },
                    event: {
                        type: String,
                        enum: ['create', 'accept', 'share', 'partial_drop', 'complete', 'admin_cancel'],
                        required: true,
                    },
                    pricing: { type: mongoose.Schema.Types.Mixed },
                    riderEarning: { type: Number, default: 0 },
                    sharedRiderEarning: { type: Number, default: 0 },
                    platformProfit: { type: Number, default: 0 },
                    driverSettlement: { type: mongoose.Schema.Types.Mixed },
                    platformRevenue: { type: mongoose.Schema.Types.Mixed },
                    deliveryFeeBreakdown: { type: mongoose.Schema.Types.Mixed },
                    isMultiRestaurant: { type: Boolean, default: false },
                    isSplitOrder: { type: Boolean, default: false },
                    activePickupCount: { type: Number, default: 0 },
                    partialRefundAmount: { type: Number, default: 0 },
                    note: { type: String, default: '' },
                },
            ],
            default: [],
        },
        /** Flag to track if the 30-minute pre-alert has been sent to the restaurant */
        restaurantNotifiedForSchedule: { type: Boolean, default: false },
        /** ✅ NEW: Contextual delay information for the end-user */
        delayContext: {
            reason: { type: String, default: '' },
            reportedBy: { type: String, enum: ['RESTAURANT', 'DELIVERY_PARTNER', 'SYSTEM'] },
            reportedAt: { type: Date }
        },
        /** Monotonic per-order event sequence counter; allocated via $inc for the event outbox. */
        eventSeq: { type: Number, default: 0 },
        /** True once a second driver joined and the order runs as two independent legs. */
        isDualLeg: { type: Boolean, default: false },
        /** How work was divided: per-restaurant stop, or per-item within a single restaurant. */
        splitMode: { type: String, enum: ['none', 'stop', 'item'], default: 'none' },
        legs: { type: [deliveryLegSchema], default: [] }
    },

    {
        collection: 'food_orders',
        timestamps: true
    }
);

orderSchema.index({ 'deliveryAddress.location': '2dsphere' });
orderSchema.index({ lastRiderLocation: '2dsphere' });
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ restaurantId: 1, orderStatus: 1, createdAt: -1 });
orderSchema.index({ 'dispatch.deliveryPartnerId': 1, orderStatus: 1 });
orderSchema.index({ 'dispatch.status': 1, orderStatus: 1 });
orderSchema.index({ 'dispatch.status': 1, orderStatus: 1, updatedAt: -1 });
orderSchema.index({ 'dispatch.deliveryPartnerId': 1, 'dispatch.status': 1, updatedAt: -1 });
orderSchema.index({ 'payment.status': 1, createdAt: -1 });
orderSchema.index({ 'payment.method': 1, createdAt: -1 });

orderSchema.pre('save', async function (next) {
    if (!this.order_id) {
        const timestamp = Date.now().toString().slice(-4);
        const random = Math.floor(100 + Math.random() * 900);
        this.order_id = `FOD-${timestamp}${random}`;
    }
    // Synchronize camelCase alias to satisfy unique index 'orderId_1'
    if (this.order_id) {
        this.orderId = this.order_id;
    }
    next();
});

export const FoodOrder = mongoose.model('FoodOrder', orderSchema);

const settingsSchema = new mongoose.Schema(
    {
        key: { type: String, required: true, unique: true, trim: true },
        dispatchMode: { type: String, enum: ['auto'], default: 'auto' },
        updatedBy: {
            role: { type: String },
            adminId: { type: mongoose.Schema.Types.ObjectId },
            at: { type: Date }
        }
    },
    { collection: 'food_settings', timestamps: true }
);

export const FoodSettings = mongoose.model('FoodSettings', settingsSchema);
