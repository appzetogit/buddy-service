import mongoose from 'mongoose';
import { FoodDeliveryPartner } from '../models/deliveryPartner.model.js';
import { DeliverySupportTicket } from '../models/supportTicket.model.js';
import { DeliveryBonusTransaction } from '../../admin/models/deliveryBonusTransaction.model.js';
import { FoodEarningAddon } from '../../admin/models/earningAddon.model.js';
import { riderOrders } from './riderOrderSources.js';
import { ValidationError, ConflictError } from '../../../../core/auth/errors.js';
import { getDeliveryCashLimitSettings } from '../../admin/services/admin.service.js';
import { saveActorLocation } from '../../../../core/location/location.service.js';
import {
    replaceCloudinaryImage,
    uploadFoodImage,
} from '../../services/foodImage.service.js';

const applyPartnerImageUpload = async (partner, field, file, folder) => {
    const asset = await replaceCloudinaryImage({
        buffer: file.buffer,
        folder,
        oldPublicId: partner.imagePublicIds?.[field],
        oldUrl: partner[field],
        mimeType: file.mimetype,
    });
    partner[field] = asset.url;
    partner.imagePublicIds = {
        ...(partner.imagePublicIds || {}),
        [field]: asset.publicId,
    };
};
import { FoodDeliveryWithdrawal } from '../models/foodDeliveryWithdrawal.model.js';
import { resolveRiderPayoutAmount } from '../../orders/services/order.helpers.js';

const uploadPartnerImage = async (file, folder) => {
    const asset = await uploadFoodImage(file, folder);
    return asset;
};

export const registerDeliveryPartner = async (payload, files) => {
    const { 
        name, phone, email, countryCode, address, city, state, 
        vehicleType, vehicleName, vehicleNumber, drivingLicenseNumber, panNumber, aadharNumber,
        fcmToken, platform 
    } = payload;
    const refRaw = typeof payload?.ref === 'string' ? String(payload.ref).trim() : '';

    const existing = await FoodDeliveryPartner.findOne({ phone });
    if (existing) {
        if (existing.status !== 'rejected') {
            throw new ValidationError('Delivery partner with this phone already exists');
        }
        await FoodDeliveryPartner.deleteMany({ phone });
    }

    const normalizedVehicleNumber = String(vehicleNumber || '').trim().toUpperCase();
    if (normalizedVehicleNumber) {
        const vehicleConflict = await FoodDeliveryPartner.findOne({
            vehicleNumber: normalizedVehicleNumber,
        })
            .select('_id phone')
            .lean();
        if (vehicleConflict) {
            throw new ConflictError(
                `Vehicle number ${normalizedVehicleNumber} is already registered with another delivery partner`,
            );
        }
    }

    const imagePublicIds = {};
    const images = {};

    if (files?.profilePhoto?.[0]) {
        const asset = await uploadPartnerImage(files.profilePhoto[0], 'food/delivery/profile');
        images.profilePhoto = asset.url;
        imagePublicIds.profilePhoto = asset.publicId;
    }
    if (files?.aadharPhoto?.[0]) {
        const asset = await uploadPartnerImage(files.aadharPhoto[0], 'food/delivery/aadhar');
        images.aadharPhoto = asset.url;
        imagePublicIds.aadharPhoto = asset.publicId;
    }
    if (files?.panPhoto?.[0]) {
        const asset = await uploadPartnerImage(files.panPhoto[0], 'food/delivery/pan');
        images.panPhoto = asset.url;
        imagePublicIds.panPhoto = asset.publicId;
    }
    if (files?.drivingLicensePhoto?.[0]) {
        const asset = await uploadPartnerImage(files.drivingLicensePhoto[0], 'food/delivery/license');
        images.drivingLicensePhoto = asset.url;
        imagePublicIds.drivingLicensePhoto = asset.publicId;
    }

    const partner = await FoodDeliveryPartner.create({
        name,
        phone,
        email: email && String(email).trim() ? String(email).trim() : undefined,
        countryCode,
        address,
        city,
        state,
        vehicleType,
        vehicleName,
        vehicleNumber,
        drivingLicenseNumber,
        panNumber,
        aadharNumber,
        status: 'pending',
        imagePublicIds,
        ...images
    });

    // Update FCM token if provided
    if (fcmToken) {
        if (platform === 'mobile') {
            partner.fcmTokenMobile = [fcmToken];
        } else {
            partner.fcmTokens = [fcmToken];
        }
    }

    // Ensure referralCode exists for sharing.
    if (!partner.referralCode) {
        partner.referralCode = String(partner._id);
    }

    // Store referredBy (no credit here; credit happens on admin approval).
    if (refRaw && mongoose.Types.ObjectId.isValid(refRaw) && String(refRaw) !== String(partner._id)) {
        const referrer = await FoodDeliveryPartner.findById(refRaw).select('_id').lean();
        if (referrer) {
            partner.referredBy = referrer._id;
        }
    }

    await partner.save();

    try {
        const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
        void notifyAdminsSafely({
            title: 'New Delivery Partner Registration 🚲',
            body: `A new delivery partner "${partner.name}" has signed up and is pending approval.`,
            data: {
                type: 'new_registration',
                subType: 'delivery_partner',
                id: String(partner._id)
            }
        });
    } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to notify admins of new delivery partner registration:', e);
    }

    return partner.toObject();
};

export const updateDeliveryPartnerProfile = async (userId, payload, files) => {
    const partner = await FoodDeliveryPartner.findById(userId);
    if (!partner) {
        throw new ValidationError('Delivery partner not found');
    }

    const {
        name, countryCode, address, city, state,
        vehicleType, vehicleName, vehicleNumber, drivingLicenseNumber, panNumber, aadharNumber,
        fcmToken, platform
    } = payload;

    if (name) partner.name = name;
    if (countryCode !== undefined) partner.countryCode = countryCode;
    if (address !== undefined) partner.address = address;
    if (city !== undefined) partner.city = city;
    if (state !== undefined) partner.state = state;
    if (vehicleType !== undefined) partner.vehicleType = vehicleType;
    if (vehicleName !== undefined) partner.vehicleName = vehicleName;
    if (vehicleNumber !== undefined) partner.vehicleNumber = vehicleNumber;
    if (drivingLicenseNumber !== undefined) partner.drivingLicenseNumber = drivingLicenseNumber;

    if (fcmToken) {
        if (platform === 'mobile') {
            if (!partner.fcmTokenMobile) partner.fcmTokenMobile = [];
            if (!partner.fcmTokenMobile.includes(fcmToken)) {
                partner.fcmTokenMobile.push(fcmToken);
            }
        } else {
            if (!partner.fcmTokens) partner.fcmTokens = [];
            if (!partner.fcmTokens.includes(fcmToken)) {
                partner.fcmTokens.push(fcmToken);
            }
        }
    }

    let updatedDocsRequiringReapproval = false;

    if (files?.profilePhoto?.[0]) {
        await applyPartnerImageUpload(partner, 'profilePhoto', files.profilePhoto[0], 'food/delivery/profile');
    }

    await partner.save();
    return {
        partner: partner.toObject(),
        requiresReapproval: false
    };
};

export const updateDeliveryPartnerDetails = async (userId, payload) => {
    const partner = await FoodDeliveryPartner.findById(userId);
    if (!partner) {
        throw new ValidationError('Delivery partner not found');
    }

    const vehicle = payload?.vehicle;
    if (vehicle && typeof vehicle === 'object') {
        if (vehicle.number !== undefined) partner.vehicleNumber = String(vehicle.number || '').trim();
        if (vehicle.type !== undefined) partner.vehicleType = String(vehicle.type || '').trim();
        if (vehicle.brand !== undefined) partner.vehicleName = String(vehicle.brand || '').trim();
        if (vehicle.model !== undefined) partner.vehicleName = String(vehicle.model || '').trim();
    }

    if (payload?.profilePhoto !== undefined) {
        partner.profilePhoto = payload.profilePhoto ? String(payload.profilePhoto).trim() : '';
    }

    if (payload?.zone !== undefined) {
        partner.zone = payload.zone || null;
    }

    await partner.save();
    return partner.toObject();
};

export const updateDeliveryPartnerProfilePhotoBase64 = async (userId, payload) => {
    const partner = await FoodDeliveryPartner.findById(userId);
    if (!partner) {
        throw new ValidationError('Delivery partner not found');
    }
    const base64 = payload?.base64;
    const mimeType = payload?.mimeType || 'image/jpeg';
    if (!base64 || typeof base64 !== 'string') {
        throw new ValidationError('base64 is required');
    }
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer || !buffer.length) {
        throw new ValidationError('Invalid base64 image');
    }
    if (buffer.length > 8 * 1024 * 1024) {
        throw new ValidationError('Image too large (max 8MB)');
    }
    const asset = await replaceCloudinaryImage({
        buffer,
        folder: 'food/delivery/profile',
        oldPublicId: partner.imagePublicIds?.profilePhoto,
        oldUrl: partner.profilePhoto,
        mimeType,
    });
    partner.profilePhoto = asset.url;
    partner.imagePublicIds = {
        ...(partner.imagePublicIds || {}),
        profilePhoto: asset.publicId,
    };
    await partner.save();
    return partner.toObject();
};

export const updateDeliveryPartnerBankDetails = async (userId, payload, files) => {
    const partner = await FoodDeliveryPartner.findById(userId);
    if (!partner) {
        throw new ValidationError('Delivery partner not found');
    }

    // Handle both nested JSON and flat FormData from multer
    let bankDetails = payload?.documents?.bankDetails;
    let panDetails = payload?.documents?.pan;

    // Multer flattens FormData keys like 'documents[bankDetails][accountNumber]'
    if (!bankDetails && payload) {
        const b = {};
        if (payload['documents[bankDetails][accountHolderName]'] !== undefined) b.accountHolderName = payload['documents[bankDetails][accountHolderName]'];
        if (payload['documents[bankDetails][accountNumber]'] !== undefined) b.accountNumber = payload['documents[bankDetails][accountNumber]'];
        if (payload['documents[bankDetails][ifscCode]'] !== undefined) b.ifscCode = payload['documents[bankDetails][ifscCode]'];
        if (payload['documents[bankDetails][bankName]'] !== undefined) b.bankName = payload['documents[bankDetails][bankName]'];
        if (payload['documents[bankDetails][upiId]'] !== undefined) b.upiId = payload['documents[bankDetails][upiId]'];
        if (Object.keys(b).length > 0) bankDetails = b;
    }

    if (!panDetails && payload?.['documents[pan][number]'] !== undefined) {
        panDetails = { number: payload['documents[pan][number]'] };
    }

    if (bankDetails) {
        const b = bankDetails;
        if (b.accountHolderName !== undefined) partner.bankAccountHolderName = b.accountHolderName ? String(b.accountHolderName).trim() : '';
        if (b.accountNumber !== undefined) partner.bankAccountNumber = b.accountNumber ? String(b.accountNumber).trim() : '';
        if (b.ifscCode !== undefined) partner.bankIfscCode = b.ifscCode ? String(b.ifscCode).trim().toUpperCase() : '';
        if (b.bankName !== undefined) partner.bankName = b.bankName ? String(b.bankName).trim() : '';
        if (b.upiId !== undefined) partner.upiId = b.upiId ? String(b.upiId).trim() : '';
    }

    if (panDetails?.number !== undefined) {
        partner.panNumber = panDetails.number ? String(panDetails.number).trim().toUpperCase() : '';
    }

    if (files?.upiQrCode?.[0]) {
        await applyPartnerImageUpload(partner, 'upiQrCode', files.upiQrCode[0], 'food/delivery/upi');
    }

    await partner.save();
    return partner.toObject();
};

function generateTicketId() {
    const n = Date.now().toString(36).slice(-6).toUpperCase();
    const r = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `TKT-${n}${r}`;
}

export const listSupportTicketsByPartner = async (deliveryPartnerId) => {
    const list = await DeliverySupportTicket.find({ deliveryPartnerId })
        .sort({ createdAt: -1 })
        .lean();
    return list;
};

export const createSupportTicket = async (deliveryPartnerId, payload) => {
    const { subject, description, category = 'other', priority = 'medium' } = payload;
    if (!subject || !description || subject.trim().length < 3) {
        throw new ValidationError('Subject is required (min 3 characters)');
    }
    if (description.trim().length < 10) {
        throw new ValidationError('Description must be at least 10 characters');
    }
    let ticketId = generateTicketId();
    let exists = await DeliverySupportTicket.findOne({ ticketId }).lean();
    while (exists) {
        ticketId = generateTicketId();
        exists = await DeliverySupportTicket.findOne({ ticketId }).lean();
    }
    const ticket = await DeliverySupportTicket.create({
        deliveryPartnerId,
        ticketId,
        subject: subject.trim(),
        description: description.trim(),
        category: ['payment', 'account', 'technical', 'order', 'other'].includes(category) ? category : 'other',
        priority: ['low', 'medium', 'high', 'urgent'].includes(priority) ? priority : 'medium',
        status: 'open'
    });
    return ticket.toObject();
};

export const getSupportTicketByIdAndPartner = async (ticketId, deliveryPartnerId) => {
    const ticket = await DeliverySupportTicket.findOne({
        _id: ticketId,
        deliveryPartnerId
    }).lean();
    return ticket;
};

export const updateDeliveryAvailability = async (userId, payload) => {
    let partner = await FoodDeliveryPartner.findById(userId);
    if (!partner && mongoose.Types.ObjectId.isValid(userId)) {
        partner = await FoodDeliveryPartner.findOne({ identityId: userId });
    }
    if (!partner) {
        throw new ValidationError('Delivery partner not found');
    }
    const { status, latitude, longitude } = payload || {};
    let validStatus = 'offline';
    if (status === 'online' || status === true) validStatus = 'online';
    else if (status === 'offline' || status === false) validStatus = 'offline';

    // Keep unified identity activeService in sync with food availability.
    if (partner.identityId) {
        const { BuddyIdentity } = await import('../../../../core/identity/buddyIdentity.model.js');
        const identity = await BuddyIdentity.findById(partner.identityId).select(
            '_id activeService',
        );
        if (identity) {
            await BuddyIdentity.updateOne(
                { _id: identity._id },
                {
                    $set: {
                        activeService: validStatus === 'online' ? 'food' : 'off',
                    },
                },
            );
        }
    }

    partner.availabilityStatus = validStatus;
    await FoodDeliveryPartner.updateOne(
        { _id: partner._id },
        { $set: { availabilityStatus: validStatus } }
    );

    if (typeof latitude === 'number' && typeof longitude === 'number') {
        // Single write path shared with the live-tracking socket handler -
        // keeps currentLocation (+ deprecated lastLocation/lastLat/lastLng
        // mirrors) consistent regardless of which entrypoint updated it.
        await saveActorLocation({
            actorType: 'DELIVERY_PARTNER',
            actorId: userId,
            lat: latitude,
            lng: longitude,
            reverseGeocodeIfMissingAddress: false,
        });
    }

    return { availabilityStatus: partner.availabilityStatus };
};

// ----- Delivery partner wallet (Pocket / requests page) -----
export const getDeliveryPartnerWallet = async (deliveryPartnerId) => {
    if (!deliveryPartnerId || !mongoose.Types.ObjectId.isValid(deliveryPartnerId)) {
        throw new ValidationError('Delivery partner not found');
    }
    const partner = await FoodDeliveryPartner.findById(deliveryPartnerId).lean();
    if (!partner) {
        throw new ValidationError('Delivery partner not found');
    }

    const cashLimitSettings = await getDeliveryCashLimitSettings();
    const totalCashLimit = Number(cashLimitSettings.deliveryCashLimit) || 0;
    const deliveryWithdrawalLimit = Number(cashLimitSettings.deliveryWithdrawalLimit) || 100;

    const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
    // Earnings paid to rider through completed deliveries
    // Also track cash collected from customers (COD total)
    const [earningsAgg, cashAgg, withdrawalAgg, bonusAgg] = await Promise.all([
        riderOrders.aggregate([
            {
                $match: {
                    $and: [
                        {
                            $or: [
                                { 'dispatch.deliveryPartnerId': partnerId },
                                { 'dispatch.sharedPartnerId': partnerId }
                            ]
                        },
                        { orderStatus: { $in: ['delivered', 'completed', 'DELIVERED', 'COMPLETED'] } }
                    ]
                }
            },
            {
                $group: {
                    _id: null,
                    totalEarned: { 
                        $sum: { 
                            $cond: [
                                { $eq: ["$dispatch.deliveryPartnerId", partnerId] },
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
        riderOrders.aggregate([
            {
                $match: {
                    $and: [
                        {
                            $or: [
                                { 'dispatch.deliveryPartnerId': partnerId },
                                { 'dispatch.sharedPartnerId': partnerId }
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
                                { 'paymentMethod': { $in: ['cash', 'cod', 'CASH', 'COD'] } }
                            ]
                        }
                    ]
                }
            },
            {
                $group: {
                    _id: null,
                    cashCollected: { 
                        $sum: { 
                            $max: [
                                { $ifNull: ['$pricing.total', 0] },
                                { $ifNull: ['$payment.amountDue', 0] },
                                { $ifNull: ['$payment.amount', 0] },
                                { $ifNull: ['$amountToCollect', 0] },
                                { $ifNull: ['$totalAmount', 0] }
                            ] 
                        } 
                    }
                }
            }
        ]),
        FoodDeliveryWithdrawal.aggregate([
            {
                $match: {
                    deliveryPartnerId: partnerId,
                    status: { $in: ['pending', 'approved', 'processed'] }
                }
            },
            {
                $group: {
                    _id: '$status',
                    total: { $sum: '$amount' }
                }
            }
        ]),
        DeliveryBonusTransaction.aggregate([
            { $match: { deliveryPartnerId: partnerId, status: 'credited' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ])
    ]);
 
    const totalEarned = Number(earningsAgg?.[0]?.totalEarned) || 0;
    const totalBonus = Number(bonusAgg?.[0]?.total) || 0;
    const grossCashCollected = Number(cashAgg?.[0]?.cashCollected) || 0;

    const depositsAgg = await FoodDeliveryCashDeposit.aggregate([
        { $match: { deliveryPartnerId: partnerId, status: 'Completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalCashDeposited = Number(depositsAgg?.[0]?.total || 0);

    const withdrawalsMap = (withdrawalAgg || []).reduce((acc, curr) => {
        acc[curr._id] = curr.total;
        return acc;
    }, {});
    const totalWithdrawn = Number(withdrawalsMap['approved'] || 0) + Number(withdrawalsMap['processed'] || 0);
    const pendingWithdrawals = Number(withdrawalsMap['pending'] || 0);

    // Lifetime Earnings = Total from orders + bonuses
    const lifetimeEarnings = totalEarned + totalBonus;
    
    // 1. Calculate raw earnings available for withdrawal/substitution
    const rawEarningsBalance = Math.max(0, lifetimeEarnings - (totalWithdrawn + pendingWithdrawals));
    
    // 2. Calculate raw cash in hand (total collected - total deposited)
    const rawCashInHand = Math.max(0, grossCashCollected - totalCashDeposited);

    // 3. Keep them independent (No Substitution)
    const pocketBalance = Number(rawEarningsBalance.toFixed(2));
    const cashInHand = Number(rawCashInHand.toFixed(2));
    const availableCashLimit = Math.max(0, totalCashLimit - cashInHand);

    // Keep transactions list reasonably small (UI only needs recent data for charts)
    const [paymentTxList, bonusTxList] = await Promise.all([
        riderOrders.find({
            $or: [
                { 'dispatch.deliveryPartnerId': partnerId },
                { 'dispatch.sharedPartnerId': partnerId }
            ],
            orderStatus: 'delivered',
        })
            .sort({ 'deliveryState.deliveredAt': -1, createdAt: -1 })
            .select('orderId riderEarning sharedRiderEarning dispatch payment orderStatus deliveryState createdAt deliveryState.deliveredAt')
            .limit(2000)
            .lean(),
        DeliveryBonusTransaction.find({ deliveryPartnerId: partnerId })
            .sort({ createdAt: -1 })
            .limit(1000)
            .lean(),
    ]);

    const paymentTransactions = (paymentTxList || []).map((o) => {
        const deliveredAt = o?.deliveryState?.deliveredAt || o?.deliveredAt || null;
        const date = deliveredAt || o?.createdAt || new Date();
        const isSharedPartner = String(o?.dispatch?.sharedPartnerId || '') === String(partnerId);
        const earningAmount = isSharedPartner
            ? (Number(o?.sharedRiderEarning) || 0)
            : (Number(o?.riderEarning) || 0);
        return {
            _id: o._id,
            type: 'payment',
            amount: earningAmount,
            status: 'Completed',
            date,
            createdAt: date,
            orderId: o.orderId || String(o._id),
            paymentMethod: o?.payment?.method || '',
            metadata: { orderId: o.orderId || String(o._id) },
            description: o?.payment?.method === 'cash' ? 'COD delivery earning' : 'Online delivery earning'
        };
    });

    const bonusTransactions = (bonusTxList || []).map((t) => ({
        _id: t._id,
        type: 'earning_addon',
        amount: Number(t.amount) || 0,
        status: 'Completed',
        date: t.createdAt,
        createdAt: t.createdAt,
        metadata: { reference: t.reference || '' },
        description: t.reference ? `Bonus - ${t.reference}` : 'Bonus'
    }));

    return {
        totalBalance: lifetimeEarnings,
        pocketBalance,
        cashInHand,
        totalWithdrawn,
        totalEarned,
        totalCashLimit,
        availableCashLimit,
        deliveryWithdrawalLimit,
        transactions: [...paymentTransactions, ...bonusTransactions].sort((a, b) => {
            const ad = a?.date ? new Date(a.date).getTime() : 0;
            const bd = b?.date ? new Date(b.date).getTime() : 0;
            return bd - ad;
        }),
        joiningBonusClaimed: false,
        joiningBonusAmount: 0
    };
};

// ----- Delivery partner earnings summary (Pocket / requests page) -----
export const getDeliveryPartnerEarnings = async (deliveryPartnerId, query = {}) => {
    if (!deliveryPartnerId || !mongoose.Types.ObjectId.isValid(deliveryPartnerId)) {
        throw new ValidationError('Delivery partner not found');
    }
    const period = String(query.period || 'week').toLowerCase();
    const date = query.date ? new Date(query.date) : new Date();
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 1000);

    const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);

    let range = null;
    if (period === 'today') {
        range = { start: toStartOfDay(date), end: toEndOfDay(date) };
    } else if (period === 'week') {
        range = getWeekRange(date);
    } else if (period === 'month') {
        range = getMonthRange(date);
    } else if (period === 'all') {
        range = null;
    } else {
        // fallback to week
        range = getWeekRange(date);
    }

    const match = {
        $and: [
            {
                $or: [
                    { 'dispatch.deliveryPartnerId': partnerId },
                    { 'dispatch.sharedPartnerId': partnerId }
                ]
            },
            { orderStatus: { $in: ['delivered', 'completed', 'DELIVERED', 'COMPLETED'] } }
        ]
    };
    if (range) {
        match['deliveryState.deliveredAt'] = { $gte: range.start, $lte: range.end };
    }

    const earningExpr = {
        $cond: [
            { $eq: ["$dispatch.deliveryPartnerId", partnerId] },
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
    };

    const [totalOrders, agg, byKindAgg] = await Promise.all([
        riderOrders.countDocuments(match),
        riderOrders.aggregate([
            { $match: match },
            {
                $group: {
                    _id: null,
                    totalEarnings: { $sum: earningExpr }
                }
            }
        ]),
        riderOrders.aggregate([
            { $match: match },
            {
                $group: {
                    // Taxi parcels are tracked separately from taxi rides; everything else groups by orderKind.
                    _id: {
                        $cond: [
                            { $and: [{ $eq: ["$orderKind", "taxi"] }, { $eq: ["$serviceType", "parcel"] }] },
                            "parcel",
                            { $ifNull: ["$orderKind", "food"] }
                        ]
                    },
                    earnings: { $sum: earningExpr },
                    orders: { $sum: 1 }
                }
            }
        ])
    ]);

    const totalEarnings = Number(agg?.[0]?.totalEarnings) || 0;

    const byKind = { food: { earnings: 0, orders: 0 }, quick: { earnings: 0, orders: 0 }, taxi: { earnings: 0, orders: 0 }, parcel: { earnings: 0, orders: 0 } };
    for (const row of byKindAgg || []) {
        const key = row?._id;
        if (byKind[key]) {
            byKind[key] = { earnings: Number(row.earnings) || 0, orders: Number(row.orders) || 0 };
        }
    }

    // Frontend only strongly relies on totalEarnings + totalOrders.
    const summary = {
        totalEarnings,
        totalOrders,
        totalHours: 0,
        totalMinutes: 0,
        orderEarning: totalEarnings,
        incentive: 0,
        otherEarnings: 0,
        byKind
    };

    return {
        summary,
        period,
        date: date.toISOString(),
        pagination: { page, limit, total: totalOrders }
    };
};

const normalizeStatusFilter = (status) => {
    if (!status) return null;
    const s = String(status || '').trim();
    if (!s || s.toUpperCase() === 'ALL TRIPS') return null;
    // UI uses Completed/Cancelled/Pending
    return s;
};

const toStartOfDay = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
};

const toEndOfDay = (d) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
};

const getWeekRange = (anchorDate) => {
    const d = new Date(anchorDate);
    const start = toStartOfDay(d);
    start.setDate(start.getDate() - start.getDay()); // Sunday
    const end = toEndOfDay(start);
    end.setDate(start.getDate() + 6);
    return { start, end };
};

const getMonthRange = (anchorDate) => {
    const d = new Date(anchorDate);
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
};

const computeRange = (period, date) => {
    const p = String(period || 'daily').toLowerCase();
    const anchor = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    if (p === 'weekly' || p === 'week') return getWeekRange(anchor);
    if (p === 'monthly' || p === 'month') return getMonthRange(anchor);
    // daily
    return { start: toStartOfDay(anchor), end: toEndOfDay(anchor) };
};

const toTripDto = (order, deliveryPartnerId) => {
    const createdAt = order?.createdAt || null;
    const deliveredAt = order?.deliveryState?.deliveredAt || order?.deliveredAt || order?.completedAt || null;
    const dateForUi = deliveredAt || createdAt || order?.updatedAt || null;

    const time = dateForUi
        ? new Date(dateForUi).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
        : '';

    const orderStatus = String(order?.orderStatus || order?.status || '').toLowerCase();
    const isDelivered = orderStatus === 'delivered' || String(order?.deliveryState?.currentPhase || '').toLowerCase() === 'delivered';
    const isCancelled = orderStatus.startsWith('cancelled') || String(order?.deliveryState?.status || '').toLowerCase().includes('cancel');

    const status = isDelivered ? 'Completed' : isCancelled ? 'Cancelled' : 'Pending';

    const restaurantName =
        order?.restaurantId?.restaurantName ||
        order?.restaurantName ||
        order?.restaurant?.restaurantName ||
        '';

    const paymentMethod = order?.payment?.method || order?.paymentMethod || '';
    const pricingTotal = Number(order?.pricing?.total) || Number(order?.totalAmount) || 0;

    const totalEarningForFallback = resolveRiderPayoutAmount(order, { partnerId: deliveryPartnerId });
    const isSharedPartner = String(order?.dispatch?.sharedPartnerId) === String(deliveryPartnerId);
    const earningAmount = totalEarningForFallback;

    const codAmount = paymentMethod === 'cash' ? Number(order?.payment?.amountDue) || 0 : 0;
    const codCollectedAmount = paymentMethod === 'cash' && order?.payment?.status === 'paid' ? codAmount : 0;

    const otherPartner = isSharedPartner ? order?.dispatch?.deliveryPartnerId : order?.dispatch?.sharedPartnerId;

    // Split info for history — never use customer deliveryFee
    const primaryPayout = resolveRiderPayoutAmount(order);
    const sharedPayout = Math.max(0, Number(order?.sharedRiderEarning) || 0);
    const splitInfo = order?.dispatch?.sharedPartnerId ? {
        isShared: true,
        otherPartner,
        primaryPartner: order?.dispatch?.deliveryPartnerId,
        sharedPartner: order?.dispatch?.sharedPartnerId,
        primaryEarning: primaryPayout,
        sharedEarning: sharedPayout
    } : null;

    const orderKind = order?.orderKind || 'food';
    const serviceType = orderKind === 'taxi' ? (order?.serviceType || 'ride') : undefined;

    return {
        id: order?._id,
        _id: order?._id,
        orderId: order?.orderId || order?._id,
        orderKind,
        serviceType,
        status,
        restaurantName,
        restaurant: restaurantName,
        items: order?.items || order?.orderItems || [],
        orderItems: order?.orderItems || order?.items || [],
        paymentMethod,
        totalAmount: pricingTotal,
        orderTotal: pricingTotal,
        codAmount: codAmount,
        codCollectedAmount,
        deliveryEarning: earningAmount,
        earningAmount: earningAmount,
        amount: earningAmount, // legacy fallback
        createdAt: order?.createdAt,
        deliveredAt: deliveredAt,
        completedAt: deliveredAt,
        date: dateForUi,
        time,
        splitInfo
    };
};

export const getDeliveryPartnerTripHistory = async (deliveryPartnerId, query = {}) => {
    if (!deliveryPartnerId || !mongoose.Types.ObjectId.isValid(deliveryPartnerId)) {
        throw new ValidationError('Delivery partner not found');
    }
    const period = query.period || 'daily';
    const date = query.date ? new Date(query.date) : new Date();
    const statusFilter = normalizeStatusFilter(query.status);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 1000);
    const skip = (page - 1) * limit;
    const periodKey = String(period || 'daily').toLowerCase();
    const isAllTime = periodKey === 'all' || periodKey === 'lifetime';

    const range = isAllTime ? null : computeRange(period, date);

    const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
    const match = {
        $or: [
            { 'dispatch.deliveryPartnerId': partnerId },
            { 'dispatch.sharedPartnerId': partnerId }
        ]
    };

    const sf = String(statusFilter || '').toLowerCase();
    if (sf === 'completed') {
        match.orderStatus = 'delivered';
        if (range) {
            match['deliveryState.deliveredAt'] = { $gte: range.start, $lte: range.end };
        }
    } else if (sf === 'cancelled') {
        match.orderStatus = { $regex: '^cancelled', $options: 'i' };
        if (range) {
            match.createdAt = { $gte: range.start, $lte: range.end };
        }
    } else if (sf === 'pending') {
        if (range) {
            match.createdAt = { $gte: range.start, $lte: range.end };
        }
        // Pending = not delivered and not cancelled
        match.$and = [
            { orderStatus: { $ne: 'delivered' } },
            { orderStatus: { $not: { $regex: '^cancelled', $options: 'i' } } },
        ];
    } else {
        // ALL TRIPS: show anything created in range, and compute earnings only for delivered orders.
        if (range) {
            match.createdAt = { $gte: range.start, $lte: range.end };
        }
    }

    const [total, orders] = await Promise.all([
        riderOrders.countDocuments(match),
        riderOrders.find(match)
            .populate({ path: 'restaurantId', select: 'restaurantName' })
            .sort({ 'deliveryState.deliveredAt': -1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean()
    ]);

    const trips = (orders || []).map(o => toTripDto(o, deliveryPartnerId));
    const hasMore = skip + trips.length < total;

    return {
        period,
        date: (date || new Date()).toISOString(),
        range: range
            ? { start: range.start.toISOString(), end: range.end.toISOString() }
            : null,
        trips,
        pagination: {
            page,
            limit,
            total,
            hasMore
        }
    };
};

export const getDeliveryPocketDetails = async (deliveryPartnerId, query = {}) => {
    if (!deliveryPartnerId || !mongoose.Types.ObjectId.isValid(deliveryPartnerId)) {
        throw new ValidationError('Delivery partner not found');
    }
    const date = query.date ? new Date(query.date) : new Date();
    const { start, end } = getWeekRange(date);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 1000, 1), 2000);

    const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);

    const orders = await riderOrders.find({
        $or: [
            { 'dispatch.deliveryPartnerId': partnerId },
            { 'dispatch.sharedPartnerId': partnerId }
        ],
        orderStatus: 'delivered',
        $or: [
            { 'deliveryState.deliveredAt': { $gte: start, $lte: end } },
            { deliveredAt: { $gte: start, $lte: end } },
            { completedAt: { $gte: start, $lte: end } },
            { updatedAt: { $gte: start, $lte: end } },
            { createdAt: { $gte: start, $lte: end } }
        ]
    })
        .populate({ path: 'restaurantId', select: 'restaurantName' })
        .populate({ path: 'dispatch.deliveryPartnerId', select: 'name fullName phone' })
        .populate({ path: 'dispatch.sharedPartnerId', select: 'name fullName phone' })
        .sort({ 'deliveryState.deliveredAt': -1, deliveredAt: -1, completedAt: -1, updatedAt: -1, createdAt: -1 })
        .limit(limit)
        .lean();

    const bonusTxList = await DeliveryBonusTransaction.find({
        deliveryPartnerId: partnerId,
        createdAt: { $gte: start, $lte: end }
    })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

    const trips = (orders || []).map(o => toTripDto(o, deliveryPartnerId));

    const paymentTransactions = (orders || []).map((o) => {
        const isSharedPartner = String(o?.dispatch?.sharedPartnerId || '') === String(partnerId);
        const earningAmount = isSharedPartner
            ? (Number(o?.sharedRiderEarning) || 0)
            : (Number(o?.riderEarning) || Number(o.pricing?.deliveryFee) || 0);

        const kind = o?.orderKind === 'taxi' && o?.serviceType === 'parcel' ? 'parcel' : (o?.orderKind || 'food');

        return {
            _id: o._id,
            type: 'payment',
            kind,
            amount: earningAmount,
            status: 'Completed',
            date: o?.deliveryState?.deliveredAt || o?.deliveredAt || o?.createdAt,
            createdAt: o?.deliveryState?.deliveredAt || o?.deliveredAt || o?.createdAt,
            orderId: o.orderId || String(o._id),
            metadata: { orderId: o.orderId || String(o._id) },
            description: o?.restaurantId?.restaurantName ? `Order earning - ${o.restaurantId.restaurantName}` : 'Order earning'
        };
    });

    const bonusTransactions = (bonusTxList || []).map((t) => ({
        _id: t._id,
        type: 'bonus',
        amount: Number(t.amount) || 0,
        status: 'Completed',
        date: t.createdAt,
        createdAt: t.createdAt,
        metadata: { reference: t.reference || '' },
        description: t.reference ? `Bonus - ${t.reference}` : 'Bonus'
    }));

    const totalEarning = paymentTransactions.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const totalBonus = bonusTransactions.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    return {
        week: { start: start.toISOString(), end: end.toISOString() },
        summary: { totalEarning, totalBonus, grandTotal: totalEarning + totalBonus },
        trips,
        transactions: {
            payment: paymentTransactions,
            bonus: bonusTransactions
        }
    };
};

export const getActiveEarningAddonsForPartner = async (deliveryPartnerId) => {
    if (!deliveryPartnerId || !mongoose.Types.ObjectId.isValid(deliveryPartnerId)) {
        throw new ValidationError('Delivery partner not found');
    }

    const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
    const now = new Date();

    const addons = await FoodEarningAddon.find({
        status: 'active',
        startDate: { $lte: now },
        endDate: { $gte: now }
    })
        .sort({ endDate: 1, createdAt: 1 })
        .lean();

    const liveAddons = (addons || []).filter((addon) => {
        if (!addon) return false;
        const maxRedemptions = Number(addon.maxRedemptions);
        if (!Number.isFinite(maxRedemptions) || maxRedemptions <= 0) return true;
        return Number(addon.currentRedemptions || 0) < maxRedemptions;
    });

    const offers = await Promise.all(
        liveAddons.map(async (addon) => {
            const startDate = addon.startDate ? new Date(addon.startDate) : null;
            const endDate = addon.endDate ? new Date(addon.endDate) : null;

            const baseMatch = {
                $or: [
                    { 'dispatch.deliveryPartnerId': partnerId },
                    { 'dispatch.sharedPartnerId': partnerId }
                ],
                orderStatus: 'delivered'
            };

            if (startDate && endDate) {
                baseMatch['deliveryState.deliveredAt'] = { $gte: startDate, $lte: endDate };
            }

            const [currentOrders, earningsAgg] = await Promise.all([
                riderOrders.countDocuments(baseMatch),
                riderOrders.aggregate([
                    { $match: baseMatch },
                    {
                        $group: {
                            _id: null,
                            total: { $sum: { $ifNull: ['$riderEarning', 0] } }
                        }
                    }
                ])
            ]);

            const currentEarnings = Number(earningsAgg?.[0]?.total) || 0;

            return {
                id: addon._id,
                title: addon.title || 'Earnings Guarantee',
                description: addon.description || '',
                targetAmount: Number(addon.earningAmount) || 0,
                targetOrders: Number(addon.requiredOrders) || 0,
                currentOrders: Number(currentOrders) || 0,
                currentEarnings,
                startDate,
                endDate,
                validTill: endDate ? endDate.toISOString() : null,
                isLive: true
            };
        })
    );

    return {
        activeOffer: offers[0] || null,
        offers
    };
};

