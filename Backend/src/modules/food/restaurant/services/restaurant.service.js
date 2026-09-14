import { FoodRestaurant } from '../models/restaurant.model.js';
import { uploadFileBuffer } from '../../../../services/cloudinary.service.js';
import {
    normalizeImageAssetList,
    replaceCloudinaryImage,
    setRestaurantImageField,
    uploadFoodImage,
} from '../../services/foodImage.service.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { buildPaginationOptions } from '../../../../utils/helpers.js';
import {
    buildRestaurantCityFilter,
    emptyRestaurantListResponse,
    formatRestaurantListResponse,
    HOME_LIST_DEFAULT_LIMIT,
    HOME_LIST_MAX_LIMIT,
    isHomeRestaurantListScope,
} from '../../shared/utils/restaurantListQuery.js';
import { getRestaurantAddressSummary } from '../../shared/utils/restaurantAddress.js';
import { enrichRestaurantsWithDistance, formatDistanceLabel } from '../../shared/utils/restaurantDistance.js';
import { reverseGeocode } from '../../../../core/location/geocode.service.js';
import mongoose from 'mongoose';
import { FoodZone } from '../../admin/models/zone.model.js';
import { FoodOffer } from '../../admin/models/offer.model.js';
import { FoodOfferUsage } from '../../admin/models/offerUsage.model.js';
import {
    getOffersForRestaurantPage,
    getOfferAnalytics,
    getOfferUsageHistory,
    buildBaseActiveOfferFilter,
    logOfferAction,
    COUPON_CATEGORY,
} from '../../admin/services/offer.service.js';
import { FoodDiningCategory } from '../../dining/models/diningCategory.model.js';
import { FoodDiningRestaurant } from '../../dining/models/diningRestaurant.model.js';
import {
    getDefaultOutletTimingsShape,
    getOutletTimingsMapForRestaurants,
    getOutletTimingsForRestaurant,
    parseOutletTimingsInput,
    legacyRestaurantToOutletTimings,
    upsertOutletTimingsForRestaurant,
} from './outletTimings.service.js';
import {
    createRestaurant,
    CREATION_SOURCE,
    normalizeRestaurantPhone,
    normalizeRestaurantEmail,
} from './restaurantCreation.service.js';
import {
    applyCoverImageDeletionToLive,
    buildPendingProfileSet,
    computePendingFieldsFromSnapshot,
    extractApprovedSnapshot,
    getEffectiveCoverImages,
    getPendingFieldLabels,
    isCoverImageDeletionOnly,
    mergePendingProfile,
    resolvePendingUpdateReason,
    splitProfileUpdate,
} from './restaurantProfileReview.service.js';

const normalizeName = (value) =>
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/-/g, ' ')
        .replace(/\s+/g, ' ');

const normalizePhone = normalizeRestaurantPhone;

const normalizeRatingValue = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(5, Number(numeric.toFixed(1))));
};

const normalizeTotalRatingsValue = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.floor(numeric));
};

const mapRestaurantListItem = (r, extras = {}) => {
    const distanceMeters = Number.isFinite(r.distanceMeters) ? r.distanceMeters : null;
    return {
        ...r,
        restaurantId: r._id,
        id: r._id,
        name: r.restaurantName || '',
        rating: normalizeRatingValue(r.rating),
        totalRatings: normalizeTotalRatingsValue(r.totalRatings),
        addressSummary: getRestaurantAddressSummary(r),
        distanceMeters,
        distanceInKm: distanceMeters !== null
            ? Number((distanceMeters / 1000).toFixed(2))
            : (r.distanceInKm ?? null),
        distance: r.distance || (distanceMeters !== null ? formatDistanceLabel(distanceMeters) : ''),
        distanceSource: r.distanceSource || null,
        profileImage: r.profileImage ? { url: r.profileImage } : null,
        coverImages: Array.isArray(r.coverImages) ? r.coverImages : [],
        menuImages: Array.isArray(r.menuImages) ? r.menuImages : [],
        ...extras,
    };
};

const toUrl = (v) => (v && (typeof v === 'string' ? v : v.url)) ? (typeof v === 'string' ? v : v.url) : '';

const normalizeRestaurantTime = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const toHHMM = (hour, minute) => {
        const h = Number(hour);
        const m = Number(minute);
        if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
        if (h < 0 || h > 23 || m < 0 || m > 59) return '';
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    // HH:mm / H:mm
    const hhmm = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (hhmm) return toHHMM(hhmm[1], hhmm[2]);

    // hh:mm AM/PM
    const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
    if (ampm) {
        let hour = Number(ampm[1]);
        const minute = Number(ampm[2]);
        const period = ampm[3].toUpperCase();
        if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '';
        if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return '';
        if (period === 'AM') hour = hour === 12 ? 0 : hour;
        if (period === 'PM') hour = hour === 12 ? 12 : hour + 12;
        return toHHMM(hour, minute);
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
        return toHHMM(parsed.getHours(), parsed.getMinutes());
    }

    return '';
};

const timeToMinutes = (value) => {
    const normalized = normalizeRestaurantTime(value);
    if (!normalized) return null;
    const [h, m] = normalized.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
};

const parseEstimatedDeliveryMinutes = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const matches = raw.match(/\d+/g);
    if (!matches || !matches.length) return null;
    const numbers = matches.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0);
    if (!numbers.length) return null;
    return Math.round(numbers[numbers.length - 1]);
};

const toRestaurantProfile = (doc) => {
    if (!doc) return null;
    const loc = doc.location && typeof doc.location === 'object' ? doc.location : null;
    const location =
        (loc?.formattedAddress ||
            loc?.address ||
            loc?.addressLine1 ||
            loc?.addressLine2 ||
            loc?.area ||
            loc?.city ||
            loc?.state ||
            loc?.pincode ||
            loc?.landmark ||
            doc.addressLine1 ||
            doc.addressLine2 ||
            doc.area ||
            doc.city ||
            doc.state ||
            doc.pincode ||
            doc.landmark)
            ? {
                type: loc?.type || 'Point',
                coordinates: Array.isArray(loc?.coordinates) ? loc.coordinates : undefined,
                latitude: typeof loc?.latitude === 'number' ? loc.latitude : (Array.isArray(loc?.coordinates) ? loc.coordinates[1] : undefined),
                longitude: typeof loc?.longitude === 'number' ? loc.longitude : (Array.isArray(loc?.coordinates) ? loc.coordinates[0] : undefined),
                formattedAddress: loc?.formattedAddress || loc?.address || '',
                address: loc?.address || loc?.formattedAddress || '',
                addressLine1: loc?.addressLine1 || doc.addressLine1 || '',
                addressLine2: loc?.addressLine2 || doc.addressLine2 || '',
                area: loc?.area || doc.area || '',
                city: loc?.city || doc.city || '',
                state: loc?.state || doc.state || '',
                pincode: loc?.pincode || doc.pincode || '',
                landmark: loc?.landmark || doc.landmark || ''
            }
            : null;

    const menuImages = normalizeImageAssetList(doc.menuImages);
    const coverImages = normalizeImageAssetList(doc.coverImages);

    return {
        id: doc._id,
        _id: doc._id,
        restaurantId: doc.restaurantId || undefined,
        name: doc.restaurantName || '',
        restaurantName: doc.restaurantName || '',
        zoneId: doc.zoneId ? String(doc.zoneId) : '',
        cuisines: Array.isArray(doc.cuisines) ? doc.cuisines : [],
        location,
        ownerName: doc.ownerName || '',
        ownerEmail: doc.ownerEmail || '',
        ownerPhone: doc.ownerPhone || '',
        primaryContactNumber: doc.primaryContactNumber || '',
        panNumber: doc.panNumber || '',
        nameOnPan: doc.nameOnPan || '',
        panImage: doc.panImage ? { url: doc.panImage } : null,
        gstRegistered: Boolean(doc.gstRegistered),
        gstNumber: doc.gstNumber || '',
        gstLegalName: doc.gstLegalName || '',
        gstAddress: doc.gstAddress || '',
        gstImage: doc.gstImage ? { url: doc.gstImage } : null,
        fssaiNumber: doc.fssaiNumber || '',
        fssaiExpiry: doc.fssaiExpiry || null,
        fssaiImage: doc.fssaiImage ? { url: doc.fssaiImage } : null,
        accountNumber: doc.accountNumber || '',
        ifscCode: doc.ifscCode || '',
        accountHolderName: doc.accountHolderName || '',
        accountType: doc.accountType || '',
        upiId: doc.upiId || '',
        upiQrImage: doc.upiQrImage ? { url: doc.upiQrImage } : null,
        pureVegRestaurant: Boolean(doc.pureVegRestaurant),
        dietaryType: doc.dietaryType || null,
        profileImage: doc.profileImage ? { url: doc.profileImage } : null,
        menuImages,
        coverImages,
        estimatedDeliveryTime: doc.estimatedDeliveryTime || '',
        estimatedDeliveryTimeMinutes:
            Number.isFinite(Number(doc.estimatedDeliveryTimeMinutes))
                ? Number(doc.estimatedDeliveryTimeMinutes)
                : null,
        diningSettings: {
            isEnabled: doc.diningSettings?.isEnabled !== false,
            maxGuests: Math.max(1, parseInt(doc.diningSettings?.maxGuests, 10) || 6),
            diningType: String(doc.diningSettings?.diningType || 'family-dining').trim() || 'family-dining'
        },
        isAcceptingOrders: doc.isAcceptingOrders !== false,
        status: doc.status || null,
        onboardingStatus: doc.onboardingStatus || null,
        currentStep: doc.currentStep ?? null,
        completedSteps: Array.isArray(doc.completedSteps) ? doc.completedSteps : [],
        submittedAt: doc.submittedAt || null,
        verifiedAt: doc.verifiedAt || doc.approvedAt || null,
        adminRemarks: doc.adminRemarks || doc.rejectionReason || null,
        rejectionStep: doc.rejectionStep || null,
        onboarding: doc.onboarding || null,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        approvedAt: doc.approvedAt,
        pendingUpdateReason: doc.pendingUpdateReason,
        profileReviewStatus: doc.profileReviewStatus || null,
        hasPendingProfileReview: doc.profileReviewStatus === 'pending',
        isUnderReview: doc.profileReviewStatus === 'pending',
        pendingProfile: doc.pendingProfile && typeof doc.pendingProfile === 'object' ? doc.pendingProfile : null,
        pendingSubmittedFields: Array.isArray(doc.pendingProfile?.pendingFields)
            ? doc.pendingProfile.pendingFields
            : [],
        pendingSubmittedFieldLabels: getPendingFieldLabels(doc.pendingProfile?.pendingFields),
        rating: normalizeRatingValue(doc.rating),
        totalRatings: normalizeTotalRatingsValue(doc.totalRatings)
    };
};

const toFiniteNumber = (value) => {
    const n = typeof value === 'number' ? value : parseFloat(String(value));
    return Number.isFinite(n) ? n : null;
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeCuisine = (value) => String(value || '').trim().slice(0, 80);

const parseSortBy = (value) => {
    const v = String(value || '').trim();
    const allowed = new Set(['nearest', 'rating', 'newest', 'deliveryTime', 'price-low', 'price-high', 'rating-high', 'rating-low']);
    return allowed.has(v) ? v : null;
};

const zoneToPolygon = (zoneDoc) => {
    const coords = Array.isArray(zoneDoc?.coordinates) ? zoneDoc.coordinates : [];
    if (coords.length < 3) return null;
    const ring = coords
        .map((c) => [Number(c.longitude), Number(c.latitude)])
        .filter((pair) => pair.every((n) => Number.isFinite(n)));
    if (ring.length < 3) return null;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
    return { type: 'Polygon', coordinates: [ring] };
};

const notifyAdminsAboutRestaurantProfileReview = async (restaurantId, restaurantName) => {
    try {
        const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
        void notifyAdminsSafely({
            title: 'Restaurant Profile Updated',
            body: `Restaurant "${restaurantName || 'Unknown Restaurant'}" updated its profile and is pending approval again.`,
            data: {
                type: 'restaurant_profile_updated',
                subType: 'restaurant',
                id: String(restaurantId)
            }
        });
    } catch (e) {
        console.error('Failed to notify admins of restaurant profile resubmission:', e);
    }
};

export const registerRestaurant = async (payload, files) => {
    const {
        restaurantName,
        ownerName,
        ownerEmail,
        ownerPhone,
        primaryContactNumber,
        pureVegRestaurant,
        addressLine1,
        addressLine2,
        area,
        city,
        state,
        pincode,
        landmark,
        formattedAddress,
        latitude,
        longitude,
        zoneId,
        cuisines,
        outletTimings: outletTimingsPayload,
        openingTime,
        closingTime,
        openDays,
        estimatedDeliveryTime,
        panNumber,
        nameOnPan,
        gstRegistered,
        gstNumber,
        gstLegalName,
        gstAddress,
        fssaiNumber,
        fssaiExpiry,
        accountNumber,
        ifscCode,
        accountHolderName,
        accountType
    } = payload;

    if (!ownerPhone) {
        throw new ValidationError('Owner phone is required to register a restaurant');
    }

    const { digits: ownerPhoneDigits, last10: ownerPhoneLast10 } = normalizePhone(ownerPhone);
    if (!ownerPhoneLast10) {
        throw new ValidationError('Owner phone is invalid');
    }

    const restaurantNameNormalized = normalizeName(restaurantName);
    if (!restaurantNameNormalized) {
        throw new ValidationError('Restaurant name is required to register a restaurant');
    }

    const images = {};
    const imagePublicIds = {};

    if (files?.profileImage?.[0]) {
        const asset = await uploadFoodImage(files.profileImage[0], 'food/restaurants/profile');
        setRestaurantImageField(images, 'profileImage', asset, imagePublicIds);
    }
    if (files?.panImage?.[0]) {
        const asset = await uploadFoodImage(files.panImage[0], 'food/restaurants/pan');
        setRestaurantImageField(images, 'panImage', asset, imagePublicIds);
    }
    if (files?.gstImage?.[0]) {
        const asset = await uploadFoodImage(files.gstImage[0], 'food/restaurants/gst');
        setRestaurantImageField(images, 'gstImage', asset, imagePublicIds);
    }
    if (files?.fssaiImage?.[0]) {
        const asset = await uploadFoodImage(files.fssaiImage[0], 'food/restaurants/fssai');
        setRestaurantImageField(images, 'fssaiImage', asset, imagePublicIds);
    }

    let menuImages = [];
    if (files?.menuImages?.length) {
        menuImages = await Promise.all(
            files.menuImages.map((file) => uploadFoodImage(file, 'food/restaurants/menu'))
        );
    }

    let menuPdf = '';
    if (files?.menuPdf?.[0]) {
        menuPdf = await uploadFileBuffer(files.menuPdf[0].buffer, 'food/restaurants/menu-pdf', {
            fileName: files.menuPdf[0].originalname || 'menu.pdf',
            format: 'pdf'
        });
    }

    if (!menuPdf) {
        throw new ValidationError('Menu PDF is required');
    }

    const outletTimings = parseOutletTimingsInput(outletTimingsPayload)
        || legacyRestaurantToOutletTimings({
            openDays: openDays || [],
            openingTime,
            closingTime,
        });

    const estimatedDeliveryTimeText = String(estimatedDeliveryTime || '').trim();
    const estimatedDeliveryTimeMinutes = parseEstimatedDeliveryMinutes(estimatedDeliveryTimeText);

    try {
        const latNum = toFiniteNumber(latitude);
        const lngNum = toFiniteNumber(longitude);

        const restaurant = await createRestaurant({
            restaurantName,
            restaurantNameNormalized,
            ownerName,
            ownerEmail: normalizeRestaurantEmail(ownerEmail) || undefined,
            ownerPhone,
            primaryContactNumber,
            pureVegRestaurant: pureVegRestaurant === true,
            zoneId: zoneId && mongoose.Types.ObjectId.isValid(String(zoneId).trim())
                ? new mongoose.Types.ObjectId(String(zoneId).trim())
                : undefined,
            location: {
                type: 'Point',
                coordinates: latNum !== null && lngNum !== null ? [lngNum, latNum] : undefined,
                latitude: latNum ?? undefined,
                longitude: lngNum ?? undefined,
                formattedAddress: typeof formattedAddress === 'string' ? formattedAddress.trim() : '',
                address: typeof formattedAddress === 'string' ? formattedAddress.trim() : '',
                addressLine1: addressLine1 || '',
                addressLine2: addressLine2 || '',
                area: area || '',
                city: city || '',
                state: state || '',
                pincode: pincode || '',
                landmark: landmark || ''
            },
            cuisines: cuisines || [],
            estimatedDeliveryTime: estimatedDeliveryTimeText || undefined,
            estimatedDeliveryTimeMinutes: estimatedDeliveryTimeMinutes ?? undefined,
            panNumber,
            nameOnPan,
            gstRegistered,
            gstNumber,
            gstLegalName,
            gstAddress,
            fssaiNumber,
            fssaiExpiry,
            accountNumber,
            ifscCode,
            accountHolderName,
            accountType,
            menuImages,
            menuPdf,
            imagePublicIds,
            ...images
        }, { source: CREATION_SOURCE.LEGACY_REGISTER });

        await upsertOutletTimingsForRestaurant(restaurant._id, outletTimings);

        try {
            const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
            void notifyAdminsSafely({
                title: 'New Restaurant Registration 🏪',
                body: `A new restaurant "${restaurant.restaurantName}" has registered and is pending approval.`,
                data: {
                    type: 'new_registration',
                    subType: 'restaurant',
                    id: String(restaurant._id)
                }
            });
        } catch (e) {
            console.error('Failed to notify admins of new restaurant registration:', e);
        }

        return restaurant.toObject ? restaurant.toObject() : restaurant;
    } catch (err) {
        throw err;
    }
};

export const getCurrentRestaurantProfile = async (restaurantId) => {
    if (!restaurantId) return null;
    const doc = await FoodRestaurant.findById(restaurantId)
        .select(
            [
                'restaurantName',
                'cuisines',
                'location',
                'addressLine1',
                'addressLine2',
                'area',
                'city',
                'state',
                'pincode',
                'landmark',
                'ownerName',
                'ownerEmail',
                'ownerPhone',
                'primaryContactNumber',
                'accountNumber',
                'ifscCode',
                'accountHolderName',
                'accountType',
                'upiId',
                'upiQrImage',
                'pureVegRestaurant',
                'dietaryType',
                'profileImage',
                'coverImages',
                'menuImages',
                'estimatedDeliveryTime',
                'estimatedDeliveryTimeMinutes',
                'diningSettings',
                'isAcceptingOrders',
                'status',
                'isActive',
                'bannedAt',
                'rejectionReason',
                'approvedAt',
                'pendingUpdateReason',
                'profileReviewStatus',
                'pendingProfile',
                'onboardingStatus',
                'currentStep',
                'completedSteps',
                'submittedAt',
                'verifiedAt',
                'adminRemarks',
                'rejectionStep',
                'onboarding',
                'panNumber',
                'nameOnPan',
                'panImage',
                'gstRegistered',
                'gstNumber',
                'gstLegalName',
                'gstAddress',
                'gstImage',
                'fssaiNumber',
                'fssaiExpiry',
                'fssaiImage',
                'menuPdf',
                'zoneId',
                'createdAt',
                'updatedAt'
            ].join(' ')
        )
        .lean();
    if (!doc) return null;
    const { outletTimings } = await getOutletTimingsForRestaurant(restaurantId);
    return {
        ...toRestaurantProfile(doc),
        outletTimings,
    };
};

export const updateRestaurantAcceptingOrders = async (restaurantId, isAcceptingOrders) => {
    if (!restaurantId) {
        throw new ValidationError('Invalid restaurant id');
    }
    const value = Boolean(isAcceptingOrders);

    if (value) {
        const current = await FoodRestaurant.findById(restaurantId)
            .select('status profileReviewStatus pendingUpdateReason')
            .lean();
        if (!current) {
            throw new ValidationError('Restaurant not found');
        }
        if (current.profileReviewStatus === 'pending') {
            throw new ValidationError(
                'Your profile changes are under admin review. You cannot go online until they are approved.'
            );
        }
        if (current.status !== 'approved') {
            throw new ValidationError(
                'Your restaurant is under review. You cannot go online until admin approval.'
            );
        }
    }

    const doc = await FoodRestaurant.findByIdAndUpdate(
        restaurantId,
        { $set: { isAcceptingOrders: value } },
        {
            new: true,
            runValidators: true,
            projection: [
                'restaurantName',
                'cuisines',
                'location',
                'addressLine1',
                'addressLine2',
                'area',
                'city',
                'state',
                'pincode',
                'landmark',
                'ownerName',
                'ownerEmail',
                'ownerPhone',
                'primaryContactNumber',
                'accountNumber',
                'ifscCode',
                'accountHolderName',
                'accountType',
                'upiId',
                'upiQrImage',
                'pureVegRestaurant',
                'profileImage',
                'coverImages',
                'menuImages',
                'openingTime',
                'closingTime',
                'openDays',
                'diningSettings',
                'isAcceptingOrders',
                'status',
                'approvedAt',
                'pendingUpdateReason',
                'profileReviewStatus',
                'pendingProfile',
                'createdAt',
                'updatedAt'
            ].join(' ')
        }
    ).lean();
    return toRestaurantProfile(doc);
};

export const updateCurrentRestaurantDiningSettings = async (restaurantId, body = {}) => {
    if (!restaurantId) {
        throw new ValidationError('Invalid restaurant id');
    }

    const currentRestaurant = await FoodRestaurant.findById(restaurantId)
        .select('diningSettings status')
        .lean();

    if (!currentRestaurant) {
        throw new ValidationError('Restaurant not found');
    }

    const currentDiningSettings =
        currentRestaurant.diningSettings && typeof currentRestaurant.diningSettings === 'object'
            ? currentRestaurant.diningSettings
            : {};

    const parseBoolean = (value, fallback = false) => {
        if (value === undefined || value === null) return Boolean(fallback);
        if (typeof value === 'boolean') return value;
        const normalized = String(value).trim().toLowerCase();
        if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
        if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
        return Boolean(fallback);
    };

    const maxGuests = Math.max(
        1,
        parseInt(body.maxGuests ?? currentDiningSettings.maxGuests ?? 6, 10) || 6
    );
    const normalizeDiningType = (value) => {
        if (Array.isArray(value)) {
            return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
        }
        const raw = String(value ?? '').trim();
        if (!raw) return [];
        return [...new Set(raw.split(',').map((item) => item.trim()).filter(Boolean))];
    };

    const diningTypeList = normalizeDiningType(body.diningType ?? currentDiningSettings.diningType ?? 'family-dining');
    const diningType = diningTypeList.length > 0 ? diningTypeList : ['family-dining'];

    const isEnabled = parseBoolean(body.isEnabled, currentDiningSettings.isEnabled);
    const selectedCategories = await FoodDiningCategory.find({
        slug: { $in: diningType }
    }).select('_id slug').lean();
    const categoryIds = selectedCategories.map((item) => item._id);
    
    // First, update the FoodDiningRestaurant collection to keep it synced
    await FoodDiningRestaurant.findOneAndUpdate(
        { restaurantId },
        {
            $set: {
                isEnabled,
                maxGuests,
                categoryIds,
                primaryCategoryId: categoryIds[0] || null,
            }
        },
        { upsert: true }
    );

    const doc = await FoodRestaurant.findByIdAndUpdate(
        restaurantId,
        {
            $set: {
                diningSettings: {
                    isEnabled,
                    maxGuests,
                    diningType
                }
            }
        },
        {
            new: true,
            runValidators: true,
            projection: [
                'restaurantName',
                'cuisines',
                'location',
                'addressLine1',
                'addressLine2',
                'area',
                'city',
                'state',
                'pincode',
                'landmark',
                'ownerName',
                'ownerEmail',
                'ownerPhone',
                'primaryContactNumber',
                'accountNumber',
                'ifscCode',
                'accountHolderName',
                'accountType',
                'upiId',
                'upiQrImage',
                'pureVegRestaurant',
                'profileImage',
                'coverImages',
                'menuImages',
                'openingTime',
                'closingTime',
                'openDays',
                'estimatedDeliveryTime',
                'estimatedDeliveryTimeMinutes',
                'diningSettings',
                'isAcceptingOrders',
                'status',
                'approvedAt',
                'pendingUpdateReason',
                'createdAt',
                'updatedAt'
            ].join(' ')
        }
    ).lean();

    return toRestaurantProfile(doc);
};

export const updateRestaurantProfile = async (restaurantId, body = {}) => {
    if (!restaurantId) {
        throw new ValidationError('Invalid restaurant id');
    }

    const currentRestaurant = await FoodRestaurant.findById(restaurantId)
        .select(
            'restaurantName restaurantNameNormalized ownerName ownerPhone ownerPhoneDigits ownerPhoneLast10 primaryContactNumber status profileReviewStatus pendingProfile cuisines location addressLine1 addressLine2 area city state pincode landmark pureVegRestaurant dietaryType profileImage coverImages panNumber nameOnPan fssaiNumber accountNumber ifscCode accountHolderName upiId'
        )
        .lean();

    if (!currentRestaurant) {
        throw new ValidationError('Restaurant not found');
    }

    const update = {};

    // Owner/contact fields (used by restaurant Contact Details screens)
    if (body.ownerName !== undefined) {
        const ownerName = String(body.ownerName || '').trim();
        if (!ownerName) {
            throw new ValidationError('Owner name cannot be empty');
        }
        if (ownerName.length > 120) {
            throw new ValidationError('Owner name is too long');
        }
        update.ownerName = ownerName;
    }

    if (body.ownerEmail !== undefined) {
        const ownerEmail = String(body.ownerEmail || '').trim().toLowerCase();
        if (ownerEmail) {
            const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!EMAIL_REGEX.test(ownerEmail)) {
                throw new ValidationError('Owner email is invalid');
            }
            if (ownerEmail.length > 254) {
                throw new ValidationError('Owner email is too long');
            }
            update.ownerEmail = ownerEmail;
        } else {
            update.ownerEmail = '';
        }
    }

    // Owner phone is not editable after registration; only contact number may change.
    if (body.ownerPhone !== undefined) {
        const { digits } = normalizePhone(body.ownerPhone);
        const currentOwnerPhoneDigits =
            currentRestaurant.ownerPhoneDigits ||
            normalizePhone(currentRestaurant.ownerPhone).digits ||
            '';

        if (digits && digits !== currentOwnerPhoneDigits) {
            throw new ValidationError('Owner phone number cannot be changed. Update the contact number instead.');
        }
    }

    if (body.primaryContactNumber !== undefined) {
        const { digits } = normalizePhone(body.primaryContactNumber);
        const normalizedPrimaryContact =
            digits || String(body.primaryContactNumber || '').trim();
        const currentPrimaryContact =
            currentRestaurant.primaryContactNumber != null
                ? String(currentRestaurant.primaryContactNumber).trim()
                : '';

        if (normalizedPrimaryContact !== currentPrimaryContact) {
            update.primaryContactNumber = normalizedPrimaryContact;
        }
    }

    if (body.pureVegRestaurant !== undefined) {
        if (typeof body.pureVegRestaurant === 'boolean') {
            update.pureVegRestaurant = body.pureVegRestaurant;
        } else if (typeof body.pureVegRestaurant === 'string') {
            const normalized = body.pureVegRestaurant.trim().toLowerCase();
            if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
                update.pureVegRestaurant = true;
            } else if (normalized === 'false' || normalized === '0' || normalized === 'no') {
                update.pureVegRestaurant = false;
            } else {
                throw new ValidationError('pureVegRestaurant must be a boolean');
            }
        } else {
            throw new ValidationError('pureVegRestaurant must be a boolean');
        }
    }

    if (body.zoneId !== undefined) {
        const zoneId = String(body.zoneId || '').trim();
        update.zoneId = zoneId && mongoose.Types.ObjectId.isValid(zoneId)
            ? new mongoose.Types.ObjectId(zoneId)
            : undefined;
    }

    // Bank + UPI fields (Explore -> Update Bank Details page)
    if (body.accountHolderName !== undefined) {
        update.accountHolderName = String(body.accountHolderName || '').trim();
    }
    if (body.accountNumber !== undefined) {
        update.accountNumber = String(body.accountNumber || '').replace(/\s|-/g, '').trim();
    }
    if (body.ifscCode !== undefined) {
        update.ifscCode = String(body.ifscCode || '').trim().toUpperCase();
    }
    if (body.accountType !== undefined) {
        update.accountType = String(body.accountType || '').trim();
    }
    if (body.upiId !== undefined) {
        update.upiId = String(body.upiId || '').trim();
    }
    if (body.upiQrImage !== undefined || body.upiQrCode !== undefined) {
        const qrImage = body.upiQrImage !== undefined ? body.upiQrImage : body.upiQrCode;
        update.upiQrImage = String(qrImage || '').trim();
    }

    if (body.name !== undefined || body.restaurantName !== undefined) {
        const raw = body.name !== undefined ? body.name : body.restaurantName;
        const name = String(raw || '').trim();
        if (!name) {
            throw new ValidationError('Restaurant name cannot be empty');
        }
        const normalizedName = normalizeName(name) || undefined;
        const currentName = String(currentRestaurant.restaurantName || '').trim();
        const currentNormalizedName =
            currentRestaurant.restaurantNameNormalized || normalizeName(currentName) || undefined;

        if (name !== currentName || normalizedName !== currentNormalizedName) {
            update.restaurantName = name;
            update.restaurantNameNormalized = normalizedName;
        }
    }

    if (body.cuisines !== undefined) {
        if (!Array.isArray(body.cuisines)) {
            throw new ValidationError('Cuisines must be an array of strings');
        }
        const cuisines = body.cuisines
            .map((c) => String(c || '').trim())
            .filter(Boolean)
            .slice(0, 50);
        update.cuisines = cuisines;
    }

    if (body.location !== undefined) {
        let loc = body.location && typeof body.location === 'object' ? body.location : null;
        if (!loc) {
            throw new ValidationError('Location must be an object');
        }
        const toStr = (v) => (v != null ? String(v).trim() : '');
        const lat = toFiniteNumber(loc.latitude);
        const lng = toFiniteNumber(loc.longitude);

        // Fill in missing address detail via reverse geocoding when only a
        // pin (lat/lng) was supplied - best-effort, never blocks the update.
        if (lat !== null && lng !== null && !toStr(loc.city) && !toStr(loc.formattedAddress || loc.address)) {
            try {
                const geo = await reverseGeocode(lat, lng);
                loc = {
                    ...loc,
                    formattedAddress: loc.formattedAddress || loc.address || geo.formattedAddress,
                    address: loc.address || loc.formattedAddress || geo.formattedAddress,
                    addressLine1: loc.addressLine1 || geo.addressLine1,
                    area: loc.area || geo.area,
                    city: loc.city || geo.city,
                    state: loc.state || geo.state,
                    pincode: loc.pincode || geo.pincode,
                };
            } catch {
                // Reverse geocode is best-effort - proceed with whatever was supplied.
            }
        }

        const isDeliveryPinUpdate = body.deliveryPinUpdate === true;

        if (isDeliveryPinUpdate) {
            const formattedAddress = toStr(loc.formattedAddress || loc.address);
            update.location = {
                type: 'Point',
                coordinates: lat !== null && lng !== null ? [lng, lat] : undefined,
                latitude: lat ?? undefined,
                longitude: lng ?? undefined,
                formattedAddress,
                address: formattedAddress,
            };
            update._directLocationOnly = true;
        } else {
            const formattedAddress = toStr(loc.formattedAddress || loc.address);
            update.addressLine1 = toStr(loc.addressLine1);
            update.addressLine2 = toStr(loc.addressLine2);
            update.area = toStr(loc.area);
            update.city = toStr(loc.city);
            update.state = toStr(loc.state);
            update.pincode = toStr(loc.pincode);
            update.landmark = toStr(loc.landmark);
            update.location = {
                type: 'Point',
                coordinates: lat !== null && lng !== null ? [lng, lat] : undefined,
                latitude: lat ?? undefined,
                longitude: lng ?? undefined,
                formattedAddress,
                address: formattedAddress,
                addressLine1: toStr(loc.addressLine1),
                addressLine2: toStr(loc.addressLine2),
                area: toStr(loc.area),
                city: toStr(loc.city),
                state: toStr(loc.state),
                pincode: toStr(loc.pincode),
                landmark: toStr(loc.landmark)
            };
        }
    }

    if (body.estimatedDeliveryTime !== undefined) {
        const estimatedDeliveryTimeText = String(body.estimatedDeliveryTime || '').trim();
        update.estimatedDeliveryTime = estimatedDeliveryTimeText;
        update.estimatedDeliveryTimeMinutes = parseEstimatedDeliveryMinutes(estimatedDeliveryTimeText) ?? undefined;
    }

    if (body.menuImages !== undefined) {
        if (!Array.isArray(body.menuImages)) {
            throw new ValidationError('menuImages must be an array');
        }
        const urls = body.menuImages
            .map((m) => toUrl(m))
            .filter(Boolean)
            .slice(0, 20);
        update.menuImages = urls;
    }

    if (body.menuPdf !== undefined) {
        update.menuPdf = toUrl(body.menuPdf) || '';
    }

    if (body.coverImages !== undefined) {
        if (!Array.isArray(body.coverImages)) {
            throw new ValidationError('coverImages must be an array');
        }
        const urls = body.coverImages
            .map((m) => toUrl(m))
            .filter(Boolean)
            .slice(0, 20);
        update.coverImages = urls;
    }

    if (body.profileImage !== undefined) {
        update.profileImage = toUrl(body.profileImage) || '';
    }

    if (body.panNumber !== undefined) {
        update.panNumber = String(body.panNumber || '').trim().toUpperCase();
    }
    if (body.nameOnPan !== undefined) {
        update.nameOnPan = String(body.nameOnPan || '').trim();
    }
    if (body.panImage !== undefined) {
        update.panImage = toUrl(body.panImage) || '';
    }
    if (body.gstRegistered !== undefined) {
        if (typeof body.gstRegistered === 'boolean') {
            update.gstRegistered = body.gstRegistered;
        } else if (typeof body.gstRegistered === 'string') {
            const normalized = body.gstRegistered.trim().toLowerCase();
            if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
                update.gstRegistered = true;
            } else if (normalized === 'false' || normalized === '0' || normalized === 'no') {
                update.gstRegistered = false;
            } else {
                throw new ValidationError('gstRegistered must be a boolean');
            }
        } else {
            throw new ValidationError('gstRegistered must be a boolean');
        }
    }
    if (body.gstNumber !== undefined) {
        update.gstNumber = String(body.gstNumber || '').trim().toUpperCase();
    }
    if (body.gstLegalName !== undefined) {
        update.gstLegalName = String(body.gstLegalName || '').trim();
    }
    if (body.gstAddress !== undefined) {
        update.gstAddress = String(body.gstAddress || '').trim();
    }
    if (body.gstImage !== undefined) {
        update.gstImage = toUrl(body.gstImage) || '';
    }
    if (body.fssaiNumber !== undefined) {
        update.fssaiNumber = String(body.fssaiNumber || '').trim();
    }
    if (body.fssaiExpiry !== undefined) {
        const rawExpiry = String(body.fssaiExpiry || '').trim();
        if (!rawExpiry) {
            update.fssaiExpiry = null;
        } else {
            const parsedExpiry = new Date(rawExpiry);
            if (Number.isNaN(parsedExpiry.getTime())) {
                throw new ValidationError('FSSAI expiry date is invalid');
            }
            update.fssaiExpiry = parsedExpiry;
        }
    }
    if (body.fssaiImage !== undefined) {
        update.fssaiImage = toUrl(body.fssaiImage) || '';
    }

    if (!Object.keys(update).length) {
        return getCurrentRestaurantProfile(restaurantId);
    }

    const { directUpdate, pendingUpdate } = splitProfileUpdate(update);

    const isApprovedRestaurant = currentRestaurant.status === 'approved';

    if (!isApprovedRestaurant) {
        if (update._directLocationOnly) {
            if (pendingUpdate.location) {
                directUpdate.location = pendingUpdate.location;
                delete pendingUpdate.location;
            }
            delete directUpdate._directLocationOnly;
            delete pendingUpdate._directLocationOnly;
        }
    }

    if (body.zoneSelectionUpdate === true) {
        for (const key of ['zoneId', 'city', 'area', 'location', 'addressLine1', 'addressLine2', 'state', 'pincode', 'landmark']) {
            if (pendingUpdate[key] !== undefined) {
                directUpdate[key] = pendingUpdate[key];
                delete pendingUpdate[key];
            }
        }
    }

    if (
        pendingUpdate.coverImages !== undefined &&
        isCoverImageDeletionOnly(getEffectiveCoverImages(currentRestaurant), pendingUpdate.coverImages)
    ) {
        const requestedCovers = normalizeImageAssetList(pendingUpdate.coverImages);
        const updatedLiveCovers = applyCoverImageDeletionToLive(
            currentRestaurant.coverImages,
            requestedCovers
        );
        directUpdate.coverImages = updatedLiveCovers.map((item) => item.url);

        const existingPending = currentRestaurant.pendingProfile;
        if (existingPending && existingPending.coverImages !== undefined) {
            const mergedPending = mergePendingProfile(existingPending, {
                coverImages: requestedCovers,
            });
            const snapshot =
                existingPending._approvedSnapshot || extractApprovedSnapshot(currentRestaurant);
            const pendingFields = computePendingFieldsFromSnapshot(snapshot, mergedPending);

            directUpdate['pendingProfile.coverImages'] = requestedCovers;
            directUpdate['pendingProfile.pendingFields'] = pendingFields;

            if (pendingFields.length === 0) {
                directUpdate._clearPendingProfile = true;
            }
        }

        delete pendingUpdate.coverImages;
        delete pendingUpdate.imagePublicIds;
    }

    if (isApprovedRestaurant) {
        const dbUpdate = {};
        if (Object.keys(directUpdate).length) {
            dbUpdate.$set = { ...directUpdate };
        }

        if (dbUpdate.$set?._clearPendingProfile) {
            delete dbUpdate.$set._clearPendingProfile;
            dbUpdate.$unset = {
                ...(dbUpdate.$unset || {}),
                pendingProfile: 1,
                profileReviewStatus: 1,
                pendingUpdateReason: 1,
            };
        }

        let requiresApproval = false;
        if (Object.keys(pendingUpdate).length) {
            const reason = resolvePendingUpdateReason(Object.keys(pendingUpdate));
            dbUpdate.$set = {
                ...(dbUpdate.$set || {}),
                ...buildPendingProfileSet(
                    pendingUpdate,
                    reason,
                    currentRestaurant.pendingProfile,
                    currentRestaurant
                ),
            };
            requiresApproval = true;
        }

        if (!dbUpdate.$set) {
            return getCurrentRestaurantProfile(restaurantId);
        }

        const doc = await FoodRestaurant.findByIdAndUpdate(
            restaurantId,
            dbUpdate,
            {
                new: true,
                runValidators: true,
                projection: [
                    'restaurantName',
                    'cuisines',
                    'location',
                    'addressLine1',
                    'addressLine2',
                    'area',
                    'city',
                    'state',
                    'pincode',
                    'landmark',
                    'ownerName',
                    'ownerEmail',
                    'ownerPhone',
                    'primaryContactNumber',
                    'pureVegRestaurant',
                    'profileImage',
                    'coverImages',
                    'menuImages',
                    'openingTime',
                    'closingTime',
                    'openDays',
                    'status',
                    'profileReviewStatus',
                    'pendingProfile',
                    'pendingUpdateReason',
                    'createdAt',
                    'updatedAt',
                    'panNumber',
                    'nameOnPan',
                    'panImage',
                    'gstRegistered',
                    'gstNumber',
                    'gstLegalName',
                    'gstAddress',
                    'gstImage',
                    'fssaiNumber',
                    'fssaiExpiry',
                    'fssaiImage',
                    'accountNumber',
                    'ifscCode',
                    'accountHolderName',
                    'accountType',
                    'upiId',
                    'upiQrImage',
                    'estimatedDeliveryTime',
                    'estimatedDeliveryTimeMinutes',
                    'zoneId'
                ].join(' ')
            }
        ).lean();

        if (requiresApproval) {
            void notifyAdminsAboutRestaurantProfileReview(
                restaurantId,
                pendingUpdate.restaurantName || currentRestaurant.restaurantName || doc?.restaurantName
            );
        }

        const profile = toRestaurantProfile(doc);
        if (requiresApproval) {
            profile.requiresApproval = true;
            profile.pendingSubmittedFields = profile.pendingSubmittedFields || [];
            profile.pendingSubmittedFieldLabels = getPendingFieldLabels(profile.pendingSubmittedFields);
            profile.lastSubmittedFields = Object.keys(pendingUpdate);
            profile.lastSubmittedFieldLabels = getPendingFieldLabels(Object.keys(pendingUpdate));
        }
        return profile;
    }

    const reason = resolvePendingUpdateReason(Object.keys(update));
    update.pendingUpdateReason = reason;
    update.status = 'pending';

    try {
        const doc = await FoodRestaurant.findByIdAndUpdate(
            restaurantId,
            {
                $set: update,
                $unset: {
                    rejectedAt: 1,
                    rejectionReason: 1
                }
            },
            {
                new: true,
                runValidators: true,
                projection: [
                    'restaurantName',
                    'cuisines',
                    'location',
                    'addressLine1',
                    'addressLine2',
                    'area',
                    'city',
                    'state',
                    'pincode',
                    'landmark',
                    'ownerName',
                    'ownerEmail',
                    'ownerPhone',
                    'primaryContactNumber',
                'pureVegRestaurant',
                'profileImage',
                'coverImages',
                'menuImages',
                    'openingTime',
                    'closingTime',
                    'openDays',
                    'status',
                    'createdAt',
                    'updatedAt',
                    'panNumber',
                    'nameOnPan',
                    'panImage',
                    'gstRegistered',
                    'gstNumber',
                    'gstLegalName',
                    'gstAddress',
                    'gstImage',
                    'fssaiNumber',
                    'fssaiExpiry',
                    'fssaiImage',
                    'accountNumber',
                    'ifscCode',
                    'accountHolderName',
                    'accountType',
                    'upiId',
                    'upiQrImage',
                    'estimatedDeliveryTime',
                    'estimatedDeliveryTimeMinutes',
                    'zoneId'
                ].join(' ')
            }
        ).lean();

        if (currentRestaurant.status !== 'pending') {
            const restaurantNameForNotification =
                update.restaurantName || currentRestaurant.restaurantName || doc?.restaurantName;
            void notifyAdminsAboutRestaurantProfileReview(restaurantId, restaurantNameForNotification);
        }

        return toRestaurantProfile(doc);
    } catch (err) {
        if (err && err.code === 11000) {
            throw new ValidationError('A restaurant with this name and phone already exists');
        }
        throw err;
    }
};

export const uploadRestaurantProfileImage = async (restaurantId, file) => {
    if (!restaurantId) throw new ValidationError('Invalid restaurant id');
    if (!file?.buffer) throw new ValidationError('Image file is required');

    const currentRestaurant = await FoodRestaurant.findById(restaurantId)
        .select(
            'restaurantName status profileImage imagePublicIds pendingProfile coverImages ownerName cuisines location addressLine1 addressLine2 area city state pincode landmark pureVegRestaurant dietaryType panNumber nameOnPan fssaiNumber accountNumber ifscCode accountHolderName upiId'
        )
        .lean();
    if (!currentRestaurant) throw new ValidationError('Restaurant not found');

    const isApprovedRestaurant = currentRestaurant.status === 'approved';
    const oldPublicId = isApprovedRestaurant
        ? currentRestaurant.pendingProfile?.imagePublicIds?.profileImage
        : currentRestaurant.imagePublicIds?.profileImage;
    const oldUrl = isApprovedRestaurant
        ? currentRestaurant.pendingProfile?.profileImage
        : currentRestaurant.profileImage;

    const asset = await replaceCloudinaryImage({
        buffer: file.buffer,
        folder: 'food/restaurants/profile',
        oldPublicId,
        oldUrl,
        mimeType: file.mimetype,
    });
    const imagePublicIds = {
        ...(currentRestaurant.imagePublicIds || {}),
        profileImage: asset.publicId,
    };

    if (isApprovedRestaurant) {
        const pendingUpdate = {
            profileImage: asset.url,
            imagePublicIds,
        };
        await FoodRestaurant.findByIdAndUpdate(
            restaurantId,
            {
                $set: buildPendingProfileSet(
                    pendingUpdate,
                    'Photo/Banner Update',
                    currentRestaurant.pendingProfile,
                    currentRestaurant
                ),
            },
            { new: true }
        ).lean();

        void notifyAdminsAboutRestaurantProfileReview(restaurantId, currentRestaurant.restaurantName || '');

        return {
            profileImage: { url: asset.url, publicId: asset.publicId },
            requiresApproval: true,
            lastSubmittedFieldLabels: getPendingFieldLabels(['profileImage']),
        };
    }

    const doc = await FoodRestaurant.findByIdAndUpdate(
        restaurantId,
        {
            $set: {
                profileImage: asset.url,
                imagePublicIds,
                status: 'pending'
            },
            $unset: {
                rejectedAt: 1,
                rejectionReason: 1
            }
        },
        { new: true, projection: 'profileImage coverImages restaurantName cuisines location menuImages addressLine1 addressLine2 area city state pincode landmark ownerName ownerEmail ownerPhone primaryContactNumber pureVegRestaurant openingTime closingTime openDays status approvedAt pendingUpdateReason createdAt updatedAt' }
    ).lean();

    if (!doc) throw new ValidationError('Restaurant not found');

    if (currentRestaurant.status !== 'pending') {
        void notifyAdminsAboutRestaurantProfileReview(restaurantId, currentRestaurant.restaurantName || doc.restaurantName);
    }

    return { profileImage: { url: asset.url, publicId: asset.publicId } };
};

export const uploadRestaurantMenuImage = async (file) => {
    if (!file?.buffer) throw new ValidationError('Image file is required');
    const asset = await uploadFoodImage(file, 'food/restaurants/menu');
    return { menuImage: asset };
};

export const uploadRestaurantCoverImages = async (restaurantId, files = []) => {
    if (!restaurantId) throw new ValidationError('Invalid restaurant id');
    if (!Array.isArray(files) || files.length === 0) {
        throw new ValidationError('At least one image file is required');
    }

    const validFiles = files.filter((file) => file?.buffer);
    if (validFiles.length === 0) {
        throw new ValidationError('At least one valid image file is required');
    }

    const currentRestaurant = await FoodRestaurant.findById(restaurantId)
        .select(
            'restaurantName status profileImage coverImages imagePublicIds pendingProfile ownerName cuisines location addressLine1 addressLine2 area city state pincode landmark pureVegRestaurant dietaryType panNumber nameOnPan fssaiNumber accountNumber ifscCode accountHolderName upiId'
        )
        .lean();
    if (!currentRestaurant) throw new ValidationError('Restaurant not found');

    const uploadedAssets = await Promise.all(
        validFiles.slice(0, 20).map((file) => uploadFoodImage(file, 'food/restaurants/cover'))
    );
    const existingCoverImages = getEffectiveCoverImages(currentRestaurant);
    const nextCoverImages = [...existingCoverImages];

    uploadedAssets.forEach((asset) => {
        if (!nextCoverImages.some((image) => image.url === asset.url)) {
            nextCoverImages.push(asset);
        }
    });

    const isApprovedRestaurant = currentRestaurant.status === 'approved';

    if (isApprovedRestaurant) {
        const pendingCoverImages = nextCoverImages.slice(0, 20);
        const pendingUpdate = { coverImages: pendingCoverImages };

        if (!toUrl(currentRestaurant.profileImage) && uploadedAssets[0]?.url) {
            pendingUpdate.profileImage = uploadedAssets[0].url;
            pendingUpdate.imagePublicIds = {
                ...(currentRestaurant.imagePublicIds || {}),
                profileImage: uploadedAssets[0].publicId,
            };
        }

        const pendingSet = buildPendingProfileSet(
            pendingUpdate,
            'Photo/Banner Update',
            currentRestaurant.pendingProfile,
            currentRestaurant
        );

        await FoodRestaurant.findByIdAndUpdate(restaurantId, { $set: pendingSet }, { new: true }).lean();

        void notifyAdminsAboutRestaurantProfileReview(restaurantId, currentRestaurant.restaurantName || '');

        return {
            coverImages: uploadedAssets,
            profileImage: pendingUpdate.profileImage
                ? { url: pendingUpdate.profileImage, publicId: uploadedAssets[0]?.publicId || '' }
                : undefined,
            requiresApproval: true,
            lastSubmittedFieldLabels: getPendingFieldLabels(Object.keys(pendingUpdate)),
        };
    }

    const update = {
        coverImages: nextCoverImages.slice(0, 20),
        status: 'pending'
    };

    if (!toUrl(currentRestaurant.profileImage) && uploadedAssets[0]?.url) {
        update.profileImage = uploadedAssets[0].url;
        update.imagePublicIds = {
            ...(currentRestaurant.imagePublicIds || {}),
            profileImage: uploadedAssets[0].publicId,
        };
    }

    await FoodRestaurant.findByIdAndUpdate(
        restaurantId,
        {
            $set: update,
            $unset: {
                rejectedAt: 1,
                rejectionReason: 1
            }
        },
        { new: true }
    ).lean();

    if (currentRestaurant.status !== 'pending') {
        void notifyAdminsAboutRestaurantProfileReview(restaurantId, currentRestaurant.restaurantName || '');
    }

    return {
        coverImages: uploadedAssets,
        profileImage: update.profileImage ? { url: update.profileImage, publicId: update.imagePublicIds?.profileImage || '' } : undefined
    };
};

export const uploadRestaurantMenuImages = async (restaurantId, files = []) => {
    if (!restaurantId) throw new ValidationError('Invalid restaurant id');
    if (!Array.isArray(files) || files.length === 0) {
        throw new ValidationError('At least one image file is required');
    }

    const validFiles = files.filter((file) => file?.buffer);
    if (validFiles.length === 0) {
        throw new ValidationError('At least one valid image file is required');
    }

    const currentRestaurant = await FoodRestaurant.findById(restaurantId)
        .select('restaurantName status menuImages')
        .lean();
    if (!currentRestaurant) throw new ValidationError('Restaurant not found');

    const uploadedAssets = await Promise.all(
        validFiles.slice(0, 20).map((file) => uploadFoodImage(file, 'food/restaurants/menu'))
    );
    const existingMenuImages = normalizeImageAssetList(currentRestaurant.menuImages);
    const nextMenuImages = [...existingMenuImages];

    uploadedAssets.forEach((asset) => {
        if (!nextMenuImages.some((image) => image.url === asset.url)) {
            nextMenuImages.push(asset);
        }
    });

    await FoodRestaurant.findByIdAndUpdate(
        restaurantId,
        {
            $set: {
                menuImages: nextMenuImages.slice(0, 20),
            },
        },
        { new: true }
    ).lean();

    return {
        menuImages: uploadedAssets
    };
};

export const listApprovedRestaurants = async (query = {}) => {
    const homeScope = isHomeRestaurantListScope(query);
    const { page, limit, skip } = buildPaginationOptions(query, {
        defaultLimit: homeScope ? HOME_LIST_DEFAULT_LIMIT : 20,
        maxLimit: homeScope ? HOME_LIST_MAX_LIMIT : 100,
    });

    if (homeScope) {
        const cityFilter = buildRestaurantCityFilter(query.city);
        if (!cityFilter) {
            return emptyRestaurantListResponse(page, limit);
        }
    }

    const filter = { status: 'approved' };

    const cityFilter = buildRestaurantCityFilter(query.city);
    if (cityFilter) {
        filter.$and = [...(filter.$and || []), cityFilter];
    }
    if (query.area && String(query.area).trim()) {
        const area = String(query.area).trim().slice(0, 80);
        const rx = { $regex: escapeRegex(area), $options: 'i' };
        filter.$and = [...(filter.$and || []), { $or: [{ 'location.area': rx }, { area: rx }] }];
    }
    if (query.cuisine && String(query.cuisine).trim()) {
        const cuisine = normalizeCuisine(query.cuisine);
        // cuisines is an array of strings.
        filter.cuisines = { $in: [new RegExp(escapeRegex(cuisine), 'i')] };
    }
    if (query.hasOffers === 'true') {
        filter.offer = { $exists: true, $ne: null, $ne: '' };
    }
    const minRating = toFiniteNumber(query.minRating);
    if (minRating !== null) {
        filter.rating = { $gte: Math.max(0, Math.min(5, minRating)) };
    }
    const maxDeliveryTime = toFiniteNumber(query.maxDeliveryTime);
    if (maxDeliveryTime !== null) {
        filter.estimatedDeliveryTimeMinutes = { $lte: Math.max(0, Math.round(maxDeliveryTime)) };
    }
    const maxPrice = toFiniteNumber(query.maxPrice);
    if (maxPrice !== null) {
        filter.featuredPrice = { $lte: Math.max(0, maxPrice) };
    }
    if (query.topRated === 'true') {
        filter.rating = { ...(filter.rating || {}), $gte: 4.5 };
    }
    if (query.trusted === 'true') {
        filter.totalRatings = { ...(filter.totalRatings || {}), $gte: 100 };
    }
    if (query.search && String(query.search).trim()) {
        const raw = String(query.search).trim().slice(0, 80);
        const term = escapeRegex(raw);
        if (term.length >= 2) {
            filter.$or = [
                { restaurantName: { $regex: term, $options: 'i' } },
                { area: { $regex: term, $options: 'i' } },
                { city: { $regex: term, $options: 'i' } },
                { 'location.area': { $regex: term, $options: 'i' } },
                { 'location.city': { $regex: term, $options: 'i' } },
                { cuisines: { $in: [new RegExp(term, 'i')] } }
            ];
        }
    }

    // Zone filter applies to discovery views; home feed is scoped by city only.
    const zoneIdRaw = String(query.zoneId || '').trim();
    if (!homeScope && zoneIdRaw && mongoose.Types.ObjectId.isValid(zoneIdRaw)) {
        // Try fast path (precomputed restaurant.zoneId).
        filter.$or = [{ zoneId: new mongoose.Types.ObjectId(zoneIdRaw) }];
        const zoneDoc = await FoodZone.findOne({ _id: zoneIdRaw, isActive: true }).lean();
        const polygon = zoneToPolygon(zoneDoc);
        if (polygon) {
            filter.$or.push({ location: { $geoWithin: { $geometry: polygon } } });
        }
    }

    const lat = toFiniteNumber(query.lat);
    const lng = toFiniteNumber(query.lng);
    // Accept both radiusKm (preferred) and maxDistance (legacy frontend param).
    const radiusKm = toFiniteNumber(query.radiusKm) ?? toFiniteNumber(query.maxDistance);
    const sortBy = parseSortBy(query.sortBy);

    const projection = {
        restaurantName: 1,
        area: 1,
        city: 1,
        cuisines: 1,
        profileImage: 1,
        coverImages: 1,
        menuImages: 1,
        estimatedDeliveryTime: 1,
        estimatedDeliveryTimeMinutes: 1,
        offer: 1,
        featuredDish: 1,
        featuredPrice: 1,
        rating: 1,
        totalRatings: 1,
        isAcceptingOrders: 1,
        status: 1,
        pureVegRestaurant: 1,
        createdAt: 1,
        location: 1,
        openingTime: 1,
        closingTime: 1,
        openDays: 1
    };

    // Use $geoNear only when geo is explicitly needed (radius filter or nearest sorting).
    // This avoids accidentally hiding restaurants that do not have coordinates yet.
    const wantsGeo = (radiusKm !== null)
        || sortBy === 'nearest'
        || (homeScope && lat !== null && lng !== null);
    if (lat !== null && lng !== null && wantsGeo) {
        const geoNear = {
            $geoNear: {
                near: { type: 'Point', coordinates: [lng, lat] },
                distanceField: 'distanceMeters',
                spherical: true,
                query: filter
            }
        };
        if (radiusKm !== null) {
            geoNear.$geoNear.maxDistance = Math.max(0.1, radiusKm) * 1000;
        }

        const sortStage = (() => {
            if (sortBy === 'rating' || sortBy === 'rating-high') return { $sort: { rating: -1, distanceMeters: 1 } };
            if (sortBy === 'rating-low') return { $sort: { rating: 1, distanceMeters: 1 } };
            if (sortBy === 'price-low') return { $sort: { featuredPrice: 1, distanceMeters: 1 } };
            if (sortBy === 'price-high') return { $sort: { featuredPrice: -1, distanceMeters: 1 } };
            if (sortBy === 'newest') return { $sort: { createdAt: -1 } };
            if (sortBy === 'deliveryTime') return { $sort: { estimatedDeliveryTimeMinutes: 1, distanceMeters: 1 } };
            // nearest (default)
            return { $sort: { distanceMeters: 1 } };
        })();

        const basePipeline = [
            geoNear,
            {
                $addFields: {
                    distanceInKm: { $round: [{ $divide: ['$distanceMeters', 1000] }, 2] }
                }
            },
            sortStage
        ];

        const [pageDocs, totalDocs] = await Promise.all([
            FoodRestaurant.aggregate([
                ...basePipeline,
                { $project: projection },
                { $skip: skip },
                { $limit: limit }
            ]),
            FoodRestaurant.aggregate([...basePipeline, { $count: 'count' }])
        ]);

        const total = totalDocs?.[0]?.count || 0;
        const outletTimingsMap = await getOutletTimingsMapForRestaurants(
            (pageDocs || []).map((r) => r._id)
        );
        const defaultOutletTimings = getDefaultOutletTimingsShape();
        const restaurants = (pageDocs || []).map((r) => {
            const rid = String(r._id);
            return mapRestaurantListItem(r, {
                outletTimings: outletTimingsMap.get(rid) || defaultOutletTimings,
            });
        });
        const enriched = await enrichRestaurantsWithDistance(restaurants, { lat, lng });
        return formatRestaurantListResponse(enriched, { page, limit, total });
    }

    // Non-geo path: normal query + sort.
    const sort = (() => {
        if (sortBy === 'rating' || sortBy === 'rating-high') return { rating: -1, createdAt: -1 };
        if (sortBy === 'rating-low') return { rating: 1, createdAt: -1 };
        if (sortBy === 'price-low') return { featuredPrice: 1, createdAt: -1 };
        if (sortBy === 'price-high') return { featuredPrice: -1, createdAt: -1 };
        if (sortBy === 'deliveryTime') return { estimatedDeliveryTimeMinutes: 1, createdAt: -1 };
        return { createdAt: -1 };
    })();

    const [restaurantsRaw, total] = await Promise.all([
        FoodRestaurant.find(filter)
            .select(Object.keys(projection).join(' '))
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean(),
        FoodRestaurant.countDocuments(filter)
    ]);

    const restaurantIds = (restaurantsRaw || []).map((r) => r._id);
    const [featuredItemsRaw, outletTimingsMap] = await Promise.all([
        restaurantIds.length
            ? (async () => {
                const { FoodItem } = await import('../../admin/models/food.model.js');
                const { buildFoodVisibleCategoryFilter } = await import('../../shared/categoryWorkflow.js');
                const featuredFilter = {
                    restaurantId: { $in: restaurantIds },
                    approvalStatus: 'approved',
                    image: { $ne: '' }
                };
                const visibleCategoryFilter = await buildFoodVisibleCategoryFilter();
                if (visibleCategoryFilter) {
                    featuredFilter.$and = [...(featuredFilter.$and || []), visibleCategoryFilter];
                }
                return FoodItem.find(featuredFilter)
                    .select('name image price restaurantId')
                    .sort({ createdAt: -1 })
                    .lean();
            })()
            : Promise.resolve([]),
        getOutletTimingsMapForRestaurants(restaurantIds)
    ]);
    const defaultOutletTimings = getDefaultOutletTimingsShape();

    const featuredItemsMap = new Map();
    for (const item of featuredItemsRaw) {
        const rid = String(item.restaurantId);
        if (!featuredItemsMap.has(rid)) featuredItemsMap.set(rid, []);
        if (featuredItemsMap.get(rid).length < 5) {
            featuredItemsMap.get(rid).push({
                id: item._id,
                name: item.name,
                price: item.price,
                image: item.image
            });
        }
    }

    const restaurants = (restaurantsRaw || []).map((r) => {
        const rid = String(r._id);
        return mapRestaurantListItem(r, {
            featuredItems: featuredItemsMap.get(rid) || [],
            outletTimings: outletTimingsMap.get(rid) || defaultOutletTimings,
        });
    });

    const enriched = (lat !== null && lng !== null)
        ? await enrichRestaurantsWithDistance(restaurants, { lat, lng })
        : restaurants;

    return formatRestaurantListResponse(enriched, { page, limit, total });
};

/**
 * Cross-restaurant dish feed used by the home "99 Store" rail and the
 * Store99 catalogue. `promo` maps to a price ceiling since there is no
 * separate promo-tagging system for dishes; zoneId scopes to restaurants
 * whose fast-path zoneId matches (or that fall inside the zone polygon),
 * same as listApprovedRestaurants.
 */
export const listPublicFoods = async (query = {}) => {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 200, 1), 1000);

    const restaurantFilter = { status: 'approved' };
    const zoneIdRaw = String(query.zoneId || '').trim();
    if (zoneIdRaw && mongoose.Types.ObjectId.isValid(zoneIdRaw)) {
        restaurantFilter.$or = [{ zoneId: new mongoose.Types.ObjectId(zoneIdRaw) }];
        const zoneDoc = await FoodZone.findOne({ _id: zoneIdRaw, isActive: true }).lean();
        const polygon = zoneToPolygon(zoneDoc);
        if (polygon) {
            restaurantFilter.$or.push({ location: { $geoWithin: { $geometry: polygon } } });
        }
    }

    const restaurantIds = await FoodRestaurant.find(restaurantFilter).distinct('_id');
    if (!restaurantIds.length) return { foods: [] };

    const { FoodItem } = await import('../../admin/models/food.model.js');
    const { buildFoodVisibleCategoryFilter } = await import('../../shared/categoryWorkflow.js');

    const foodFilter = {
        restaurantId: { $in: restaurantIds },
        approvalStatus: 'approved',
        isAvailable: true,
    };

    const categorySlug = String(query.categorySlug || '').trim();
    if (categorySlug && mongoose.Types.ObjectId.isValid(categorySlug)) {
        foodFilter.categoryId = new mongoose.Types.ObjectId(categorySlug);
    }

    // No dedicated promo-tagging exists on FoodItem yet, so promo slugs map to
    // the price ceiling they advertise on the client.
    if (query.promo === 'switch99') {
        foodFilter.price = { $lte: 99 };
    } else if (query.promo === 'under-250') {
        foodFilter.price = { $lte: 250 };
    }

    const visibleCategoryFilter = await buildFoodVisibleCategoryFilter();
    if (visibleCategoryFilter) {
        foodFilter.$and = [...(foodFilter.$and || []), visibleCategoryFilter];
    }

    const foods = await FoodItem.find(foodFilter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

    return { foods };
};

export const getApprovedRestaurantByIdOrSlug = async (idOrSlug, origin = {}) => {
    const value = String(idOrSlug || '').trim();
    if (!value) return null;

    let doc;
    if (/^[0-9a-fA-F]{24}$/.test(value)) {
        // ObjectId path
        doc = await FoodRestaurant.findOne({ _id: value, status: 'approved' }).lean();
    } else {
        // Slug path: use normalized field for index-friendly exact match.
        const restaurantNameNormalized = normalizeName(value);
        if (!restaurantNameNormalized) return null;
        doc = await FoodRestaurant.findOne({
            status: 'approved',
            restaurantNameNormalized
        }).lean();
    }
    if (!doc) return null;

    const timingsMap = await getOutletTimingsMapForRestaurants([doc._id]);
    const rid = String(doc._id);
    const restaurant = {
        ...doc,
        rating: normalizeRatingValue(doc.rating),
        totalRatings: normalizeTotalRatingsValue(doc.totalRatings),
        outletTimings: timingsMap.get(rid) || getDefaultOutletTimingsShape()
    };

    const lat = toFiniteNumber(origin.lat);
    const lng = toFiniteNumber(origin.lng);
    if (lat === null || lng === null) return restaurant;

    // Same road-distance pipeline used by the restaurant list endpoint, so the
    // details page shows a distance consistent with the list page instead of
    // being left for the frontend to approximate with straight-line distance.
    const [enriched] = await enrichRestaurantsWithDistance([restaurant], { lat, lng });
    return enriched;
};

export const listPublicOffers = async () => {
    const now = new Date();
    const filter = {
        ...buildBaseActiveOfferFilter(now),
    };

    const list = await FoodOffer.find(filter)
        .sort({ createdAt: -1 })
        .populate({ path: 'restaurantId', select: 'restaurantName restaurantNameNormalized profileImage estimatedDeliveryTime rating' })
        .lean();

    const allOffers = list.map((o) => {
        const restaurant = o.restaurantId && typeof o.restaurantId === 'object' ? o.restaurantId : null;
        const restaurantSlug = restaurant?.restaurantNameNormalized || undefined;
        const restaurantName =
            o.restaurantScope === 'selected'
                ? (restaurant?.restaurantName || 'Selected Restaurant')
                : 'All Restaurants';

        const title =
            o.discountType === 'percentage'
                ? `${Number(o.discountValue) || 0}% OFF`
                : `Flat ₹${Number(o.discountValue) || 0} OFF`;

        return {
            id: String(o._id),
            offerId: String(o._id),
            couponCode: o.couponCode,
            title,
            discountType: o.discountType,
            discountValue: o.discountValue,
            maxDiscount: o.maxDiscount ?? null,
            customerScope: o.customerScope,
            restaurantScope: o.restaurantScope,
            restaurantId: restaurant?._id ? String(restaurant._id) : (o.restaurantScope === 'selected' ? String(o.restaurantId) : null),
            restaurantName,
            restaurantSlug,
            restaurantImage: restaurant?.profileImage || null,
            deliveryTime: restaurant?.estimatedDeliveryTime || null,
            restaurantRating: typeof restaurant?.rating === 'number' ? restaurant.rating : 0,
            endDate: o.endDate || null,
            showInCart: o.showInCart !== false,
            minOrderValue: o.minOrderValue ?? 0,
            createdBy: o.createdBy || 'admin',
            couponCategory: o.couponCategory || COUPON_CATEGORY.NORMAL,
            isFreeDelivery: o.couponCategory === COUPON_CATEGORY.FREE_DELIVERY,
        };
    });

    return { allOffers, groupedByOffer: {} };
};

export const listOffersForRestaurantPage = async (restaurantId, userId = null) => {
    return getOffersForRestaurantPage(restaurantId, userId);
};

export const listDeliverySpeedOptions = async () => {
    const { getPublicDeliverySpeedOptions } = await import('../../admin/services/admin.service.js');
    return getPublicDeliverySpeedOptions();
};

export const getPublicCheckoutSettings = async () => {
    const { getPublicCheckoutSettings: getSettings } = await import('../../admin/services/admin.service.js');
    return getSettings();
};

export async function listRestaurantOffers(restaurantId) {
    if (!restaurantId) return { offers: [] };
    const list = await FoodOffer.find({ restaurantId, createdBy: 'restaurant', isDeleted: { $ne: true } })
        .sort({ createdAt: -1 })
        .lean();
    const offers = list.map((o, index) => ({
        sl: index + 1,
        offerId: String(o._id),
        couponCode: o.couponCode,
        discountType: o.discountType,
        discountValue: o.discountValue,
        customerScope: o.customerScope,
        minOrderValue: o.minOrderValue ?? 0,
        maxDiscount: o.maxDiscount ?? null,
        usageLimit: o.usageLimit ?? null,
        perUserLimit: o.perUserLimit ?? null,
        usedCount: o.usedCount ?? 0,
        startDate: o.startDate || null,
        endDate: o.endDate || null,
        status: o.status,
        approvalStatus: o.approvalStatus || (o.createdBy === 'restaurant' ? 'pending' : 'approved'),
        showInCart: o.showInCart !== false,
        isFirstOrderOnly: o.isFirstOrderOnly ?? false,
        rejectionReason: o.rejectionReason || '',
        rejectedAt: o.rejectedAt || null,
        pausedBy: o.pausedBy || null,
        createdAt: o.createdAt,
    }));
    return { offers };
}

export async function createRestaurantOffer(restaurantId, body) {
    const existing = await FoodOffer.findOne({ couponCode: body.couponCode }).lean();
    if (existing) {
        throw new ValidationError('Coupon code already exists');
    }

    const isFirstTime = body.customerScope === 'first-time';
    const perUserLimit = body.perUserLimit ?? (isFirstTime ? 1 : null);

    const doc = await FoodOffer.create({
        couponCode: body.couponCode,
        discountType: body.discountType,
        discountValue: body.discountValue,
        customerScope: body.customerScope,
        restaurantScope: 'selected',
        restaurantId,
        minOrderValue: body.minOrderValue ?? 0,
        maxDiscount: body.maxDiscount ?? null,
        usageLimit: body.usageLimit ?? null,
        perUserLimit,
        startDate: body.startDate,
        isFirstOrderOnly: body.isFirstOrderOnly ?? isFirstTime,
        endDate: body.endDate,
        approvalStatus: 'pending',
        status: 'paused',
        showInCart: true,
        createdBy: 'restaurant',
        createdById: restaurantId,
        couponCategory: COUPON_CATEGORY.NORMAL,
    });

    logOfferAction('created', { offerId: String(doc._id), couponCode: doc.couponCode, createdBy: 'restaurant', restaurantId: String(restaurantId) });
    return doc.toObject();
}

export async function updateRestaurantOffer(restaurantId, offerId, body) {
    if (!offerId || !mongoose.Types.ObjectId.isValid(offerId)) return null;

    const existing = await FoodOffer.findOne({
        _id: offerId,
        restaurantId,
        createdBy: 'restaurant',
    }).lean();
    if (!existing) return null;

    if (existing.pausedBy === 'admin' && existing.status === 'paused') {
        throw new ValidationError('This coupon was paused by admin and cannot be modified');
    }

    if (body.status) {
        if (body.status === 'active' && existing.pausedBy === 'admin') {
            throw new ValidationError('This coupon was paused by admin');
        }
        const statusUpdate = {
            status: body.status,
            pausedBy: body.status === 'paused' ? 'restaurant' : null,
        };
        const updated = await FoodOffer.findOneAndUpdate(
            { _id: offerId, restaurantId, createdBy: 'restaurant' },
            { $set: statusUpdate },
            { new: true }
        ).lean();
        logOfferAction('status_changed', { offerId, editedBy: 'restaurant', status: body.status, restaurantId: String(restaurantId) });
        return updated;
    }

    if (body.couponCode) {
        const duplicate = await FoodOffer.findOne({
            couponCode: body.couponCode,
            _id: { $ne: offerId },
        }).lean();
        if (duplicate) {
            throw new ValidationError('Coupon code already exists');
        }
    }

    const endTs = body.endDate ? new Date(body.endDate).getTime() : null;
    const isFirstTime = (body.customerScope ?? existing.customerScope) === 'first-time';
    const perUserLimit = body.perUserLimit !== undefined
        ? body.perUserLimit
        : (isFirstTime && existing.perUserLimit == null ? 1 : existing.perUserLimit ?? null);
    const status = endTs && endTs <= Date.now()
        ? 'inactive'
        : (existing.status === 'active' ? 'paused' : 'paused');

    const updated = await FoodOffer.findOneAndUpdate(
        { _id: offerId, restaurantId, createdBy: 'restaurant' },
        {
            $set: {
                couponCode: body.couponCode ?? existing.couponCode,
                discountType: body.discountType ?? existing.discountType,
                discountValue: body.discountValue ?? existing.discountValue,
                customerScope: body.customerScope ?? existing.customerScope,
                minOrderValue: body.minOrderValue ?? existing.minOrderValue ?? 0,
                maxDiscount: body.maxDiscount ?? existing.maxDiscount ?? null,
                usageLimit: body.usageLimit !== undefined ? body.usageLimit : existing.usageLimit ?? null,
                perUserLimit,
                startDate: body.startDate ?? existing.startDate ?? undefined,
                isFirstOrderOnly: body.isFirstOrderOnly ?? isFirstTime ?? existing.isFirstOrderOnly ?? false,
                endDate: body.endDate ?? existing.endDate ?? undefined,
                status,
                approvalStatus: 'pending',
            },
        },
        { new: true }
    ).lean();

    logOfferAction('edited', { offerId, editedBy: 'restaurant', restaurantId: String(restaurantId) });
    return updated;
}

export async function reapplyRestaurantOffer(restaurantId, offerId) {
    if (!offerId || !mongoose.Types.ObjectId.isValid(offerId)) return null;

    const existing = await FoodOffer.findOne({
        _id: offerId,
        restaurantId,
        createdBy: 'restaurant',
        isDeleted: { $ne: true },
    }).lean();
    if (!existing) return null;
    if (existing.approvalStatus !== 'rejected') {
        throw new ValidationError('Only rejected coupons can be resubmitted for approval');
    }

    const updated = await FoodOffer.findOneAndUpdate(
        { _id: offerId, restaurantId, createdBy: 'restaurant' },
        { $set: { approvalStatus: 'pending', status: 'paused' } },
        { new: true }
    ).lean();

    logOfferAction('reapplied', { offerId, restaurantId: String(restaurantId) });
    return updated;
}

export async function getRestaurantOfferAnalytics(restaurantId, offerId) {
    if (!offerId || !mongoose.Types.ObjectId.isValid(offerId)) return null;
    const offer = await FoodOffer.findOne({
        _id: offerId,
        restaurantId,
        createdBy: 'restaurant',
    }).lean();
    if (!offer) return null;
    return getOfferAnalytics(offerId, { restaurantId });
}

export async function getRestaurantOfferUsageHistory(restaurantId, offerId, query = {}) {
    if (!offerId || !mongoose.Types.ObjectId.isValid(offerId)) return null;
    const offer = await FoodOffer.findOne({
        _id: offerId,
        restaurantId,
        createdBy: 'restaurant',
    }).lean();
    if (!offer) return null;
    return getOfferUsageHistory(offerId, {
        restaurantId,
        page: Number(query.page) || 1,
        limit: Number(query.limit) || 20,
    });
}

export async function deleteRestaurantOffer(restaurantId, offerId) {
    if (!offerId || !mongoose.Types.ObjectId.isValid(offerId)) return null;

    const existing = await FoodOffer.findOne({
        _id: offerId,
        restaurantId,
        createdBy: 'restaurant',
        isDeleted: { $ne: true },
    }).lean();
    if (!existing) return null;
    if (existing.pausedBy === 'admin' && existing.status === 'paused') {
        throw new ValidationError('This coupon was paused by admin and cannot be deleted');
    }

    const deleted = await FoodOffer.findOneAndUpdate(
        {
            _id: offerId,
            restaurantId,
            createdBy: 'restaurant',
        },
        { $set: { isDeleted: true, status: 'inactive' } },
        { new: true }
    ).lean();
    if (!deleted) return null;
    logOfferAction('deleted', { offerId, deletedBy: 'restaurant', restaurantId: String(restaurantId) });
    return { id: offerId };
}

/**
 * List complaints for a restaurant.
 * Calls adminService.getRestaurantComplaints with fixed restaurantId.
 */
export const getRestaurantComplaints = async (restaurantId, query = {}) => {
    const { getRestaurantComplaints: getComplaintsInternal } = await import('../../admin/services/admin.service.js');
    return getComplaintsInternal({ ...query, restaurantId });
};

