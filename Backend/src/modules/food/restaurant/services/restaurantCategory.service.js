import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodCategory } from '../../admin/models/category.model.js';
import { FoodItem } from '../../admin/models/food.model.js';
import { FoodRestaurant } from '../models/restaurant.model.js';
import { FoodZone } from '../../admin/models/zone.model.js';
import { deleteFoodImageAsset } from '../../services/foodImage.service.js';
import {
    ACTIVE_PUBLIC_CATEGORY_FILTER,
    backfillLegacyCategoryWorkflow,
    categoryAllowsFoodType,
    GLOBAL_CATEGORY_FILTER,
    normalizeCategoryFoodTypeScope,
    serializeCategoryForResponse,
    toObjectId
} from '../../shared/categoryWorkflow.js';

const escapeRegex = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const APPROVED_CATEGORY_FILTER = [
    { approvalStatus: 'approved' },
    { approvalStatus: { $exists: false }, isApproved: { $ne: false } }
];

const getRestaurantContext = async (restaurantId) => {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ValidationError('Invalid restaurant id');
    }

    const restaurant = await FoodRestaurant.findById(restaurantId)
        .select('zoneId pureVegRestaurant')
        .lean();
    if (!restaurant?._id) {
        throw new ValidationError('Restaurant not found');
    }

    return {
        restaurantId: toObjectId(restaurantId),
        zoneId: restaurant.zoneId ? String(restaurant.zoneId) : '',
        pureVegRestaurant: restaurant.pureVegRestaurant === true
    };
};

const applyZoneVisibilityFilter = (filterAndList, zoneIdRaw) => {
    if (zoneIdRaw && mongoose.Types.ObjectId.isValid(zoneIdRaw)) {
        filterAndList.push({
            $or: [
                { zoneId: new mongoose.Types.ObjectId(zoneIdRaw) },
                { zoneId: { $exists: false } },
                { zoneId: null }
            ]
        });
        return;
    }

    filterAndList.push({
        $or: [{ zoneId: { $exists: false } }, { zoneId: null }]
    });
};

export async function listRestaurantCategories(restaurantId, query = {}) {
    const context = await getRestaurantContext(restaurantId);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 1000, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const includeInactive = query.includeInactive === 'true' || query.includeInactive === '1';
    const withCounts = query.withCounts === 'true' || query.withCounts === '1';
    const compact = query.compact === 'true' || query.compact === '1';
    const ownedOnly = query.ownedOnly === 'true' || query.ownedOnly === '1';
    const zoneIdRaw = typeof query.zoneId === 'string' ? query.zoneId.trim() : context.zoneId;

    const filter = {};
    if (!includeInactive) filter.isActive = true;

    const visibilityFilter = ownedOnly
        ? {
            $or: [
                { restaurantId: context.restaurantId },
                { createdByRestaurantId: context.restaurantId }
            ]
        }
        : compact
        ? {
            $or: [
                {
                    $and: [
                        { $or: GLOBAL_CATEGORY_FILTER },
                        { $or: APPROVED_CATEGORY_FILTER }
                    ]
                },
                {
                    restaurantId: context.restaurantId,
                    $or: APPROVED_CATEGORY_FILTER
                }
            ]
        }
        : {
            $or: [
                {
                    $and: [
                        { $or: GLOBAL_CATEGORY_FILTER },
                        { $or: APPROVED_CATEGORY_FILTER }
                    ]
                },
                { restaurantId: context.restaurantId },
                { createdByRestaurantId: context.restaurantId }
            ]
        };

    filter.$and = [visibilityFilter];
    if (search) {
        const term = escapeRegex(search.slice(0, 80));
        filter.$and.push({ name: { $regex: term, $options: 'i' } });
    }
    applyZoneVisibilityFilter(filter.$and, zoneIdRaw);

    if (compact && context.pureVegRestaurant) {
        filter.$and.push({ foodTypeScope: 'Veg' });
    }

    const queryBuilder = FoodCategory.find(filter)
        .sort({ sortOrder: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select(
            compact
                ? 'name image type foodTypeScope approvalStatus rejectionReason zoneId restaurantId createdByRestaurantId isActive adminDeactivated sortOrder requestedAt approvedAt rejectedAt globalizedAt'
                : 'name image type foodTypeScope approvalStatus rejectionReason zoneId restaurantId createdByRestaurantId isActive adminDeactivated sortOrder requestedAt approvedAt rejectedAt globalizedAt createdAt updatedAt'
        );

    const [list, total] = await Promise.all([
        queryBuilder.lean(),
        FoodCategory.countDocuments(filter)
    ]);

    const statsById = await backfillLegacyCategoryWorkflow(list);
    const restaurantIds = !compact
        ? Array.from(
            new Set(
                list
                    .flatMap((category) => [category?.restaurantId, category?.createdByRestaurantId])
                    .map((value) => (value ? String(value) : ''))
                    .filter(Boolean)
            )
        )
        : [];
    const restaurants = restaurantIds.length
        ? await FoodRestaurant.find({ _id: { $in: restaurantIds } })
            .select('restaurantName ownerName ownerPhone')
            .lean()
        : [];
    const restaurantMap = new Map(restaurants.map((restaurant) => [String(restaurant._id), restaurant]));

    const hydratedList = !compact
        ? list.map((category) => ({
            ...category,
            restaurantId: category?.restaurantId ? restaurantMap.get(String(category.restaurantId)) || category.restaurantId : category.restaurantId,
            createdByRestaurantId: category?.createdByRestaurantId ? restaurantMap.get(String(category.createdByRestaurantId)) || category.createdByRestaurantId : category.createdByRestaurantId
        }))
        : list;

    const categories = hydratedList.map((category) =>
        serializeCategoryForResponse(category, {
            currentRestaurantId: restaurantId,
            includeCounts: withCounts || !compact,
            statsById
        })
    );

    let summary = null;
    if (ownedOnly) {
        const activeFilter = { ...filter, isActive: true };
        const inactiveFilter = { ...filter, isActive: false };
        const [active, inactive] = await Promise.all([
            FoodCategory.countDocuments(activeFilter),
            FoodCategory.countDocuments(inactiveFilter)
        ]);
        summary = { active, inactive };
    }

    return { categories, total, page, limit, ...(summary ? { summary } : {}) };
}

export async function listPublicCategories(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 1000, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const zoneIdRaw = typeof query.zoneId === 'string' ? query.zoneId.trim() : '';

    // Active, approved restaurants (in caller's zone when zoneId is passed)
    const restaurantFilter = {
        status: 'approved',
        isActive: { $ne: false },
        isDeleted: { $ne: true }
    };

    if (zoneIdRaw && mongoose.Types.ObjectId.isValid(zoneIdRaw)) {
        const zoneObjId = new mongoose.Types.ObjectId(zoneIdRaw);
        restaurantFilter.$or = [{ zoneId: zoneObjId }];
        const zoneDoc = await FoodZone.findOne({ _id: zoneIdRaw, isActive: true }).lean();
        const coords = Array.isArray(zoneDoc?.coordinates) ? zoneDoc.coordinates : [];
        if (coords.length >= 3) {
            const ring = coords
                .map((c) => [Number(c.longitude), Number(c.latitude)])
                .filter((pair) => pair.every((n) => Number.isFinite(n)));
            if (ring.length >= 3) {
                const first = ring[0];
                const last = ring[ring.length - 1];
                if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
                restaurantFilter.$or.push({ location: { $geoWithin: { $geometry: { type: 'Polygon', coordinates: [ring] } } } });
            }
        }
    }

    const activeRestaurantIds = await FoodRestaurant.find(restaurantFilter).distinct('_id');

    // One aggregation on the food items collection
    const countMap = new Map();
    if (activeRestaurantIds.length > 0) {
        const counts = await FoodItem.aggregate([
            {
                $match: {
                    restaurantId: { $in: activeRestaurantIds },
                    approvalStatus: 'approved',
                    isAvailable: true,
                    categoryId: { $ne: null }
                }
            },
            {
                $group: {
                    _id: '$categoryId',
                    count: { $sum: 1 }
                }
            }
        ]);
        for (const row of counts) {
            if (row._id) {
                countMap.set(String(row._id), Number(row.count) || 0);
            }
        }
    }

    const filter = {
        ...ACTIVE_PUBLIC_CATEGORY_FILTER,
        $and: [{ $or: GLOBAL_CATEGORY_FILTER }, { $or: APPROVED_CATEGORY_FILTER }]
    };

    if (search) {
        const term = escapeRegex(search.slice(0, 80));
        filter.$and.push({ name: { $regex: term, $options: 'i' } });
    }
    applyZoneVisibilityFilter(filter.$and, zoneIdRaw);

    const [list, total] = await Promise.all([
        FoodCategory.find(filter)
            .sort({ sortOrder: 1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select('name image type foodTypeScope zoneId sortOrder createdAt updatedAt')
            .lean(),
        FoodCategory.countDocuments(filter)
    ]);

    await backfillLegacyCategoryWorkflow(list);
    const categories = list.map((category) => {
        const serialized = serializeCategoryForResponse(category);
        serialized.productCount = Number(countMap.get(String(category._id)) || 0);
        return serialized;
    });

    return { categories, total, page, limit };
}

export async function createRestaurantCategory(restaurantId, body = {}) {
    const context = await getRestaurantContext(restaurantId);

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new ValidationError('Category name is required');
    if (name.length > 200) throw new ValidationError('Category name is too long');

    const foodTypeScopeRaw = typeof body.foodTypeScope === 'string' ? body.foodTypeScope.trim() : '';
    if (!foodTypeScopeRaw) {
        throw new ValidationError('Category diet type is required');
    }
    const foodTypeScope = normalizeCategoryFoodTypeScope(foodTypeScopeRaw, '');
    if (!foodTypeScope) {
        throw new ValidationError('Invalid category diet type');
    }
    if (context.pureVegRestaurant && foodTypeScope !== 'Veg') {
        throw new ValidationError('Pure veg restaurants can only create veg categories');
    }

    const doc = new FoodCategory({
        name,
        image: typeof body.image === 'string' ? body.image.trim() : '',
        type: typeof body.type === 'string' ? body.type.trim() : '',
        foodTypeScope,
        isActive: body.isActive !== false,
        sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
        restaurantId: context.restaurantId,
        createdByRestaurantId: context.restaurantId,
        approvalStatus: 'pending',
        isApproved: false,
        rejectionReason: '',
        requestedAt: new Date(),
        zoneId: context.zoneId && mongoose.Types.ObjectId.isValid(context.zoneId)
            ? new mongoose.Types.ObjectId(context.zoneId)
            : undefined
    });
    await doc.save();
    return doc.toObject();
}

export async function updateRestaurantCategory(restaurantId, id, body = {}) {
    const context = await getRestaurantContext(restaurantId);
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('Invalid category id');
    }

    const doc = await FoodCategory.findOne({ _id: id, restaurantId: context.restaurantId });
    if (!doc) return null;

    const nextFoodTypeScope = body.foodTypeScope !== undefined
        ? normalizeCategoryFoodTypeScope(body.foodTypeScope, '')
        : normalizeCategoryFoodTypeScope(doc.foodTypeScope, 'Both');
    if (body.foodTypeScope !== undefined && !nextFoodTypeScope) {
        throw new ValidationError('Invalid category diet type');
    }
    if (context.pureVegRestaurant && nextFoodTypeScope !== 'Veg') {
        throw new ValidationError('Pure veg restaurants can only keep veg categories');
    }

    if (body.name !== undefined) {
        const name = String(body.name || '').trim();
        if (!name) throw new ValidationError('Category name is required');
        if (name.length > 200) throw new ValidationError('Category name is too long');
        doc.name = name;
    }
    if (body.image !== undefined) doc.image = String(body.image || '').trim();
    if (body.type !== undefined) doc.type = String(body.type || '').trim();
    if (body.isActive !== undefined) {
        const nextActive = body.isActive !== false;
        if (nextActive && doc.adminDeactivated === true) {
            throw new ValidationError('This category was deactivated by admin and cannot be reactivated');
        }
        doc.isActive = nextActive;
    }
    if (body.sortOrder !== undefined) doc.sortOrder = Number(body.sortOrder) || 0;
    if (body.foodTypeScope !== undefined) {
        const incompatibleFoods = nextFoodTypeScope === 'Both'
            ? 0
            : await FoodItem.countDocuments({
                categoryId: doc._id,
                foodType: nextFoodTypeScope === 'Veg' ? 'Non-Veg' : 'Veg'
            });
        if (incompatibleFoods > 0) {
            throw new ValidationError(`This category already has ${incompatibleFoods} food item(s) outside the selected diet type`);
        }
        doc.foodTypeScope = nextFoodTypeScope;
    }

    const requiresReapproval = (
        body.name !== undefined ||
        body.image !== undefined ||
        body.type !== undefined ||
        body.foodTypeScope !== undefined
    );
    if (requiresReapproval) {
        doc.createdByRestaurantId = doc.createdByRestaurantId || context.restaurantId;
        doc.approvalStatus = 'pending';
        doc.isApproved = false;
        doc.rejectionReason = '';
        doc.requestedAt = new Date();
        doc.approvedAt = undefined;
        doc.rejectedAt = undefined;
    }

    await doc.save();
    return doc.toObject();
}

export async function deleteRestaurantCategory(restaurantId, id) {
    const context = await getRestaurantContext(restaurantId);
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('Invalid category id');
    }

    const existing = await FoodCategory.findOne({ _id: id, restaurantId: context.restaurantId }).lean();
    if (!existing?._id) return null;

    const inUse = await FoodItem.countDocuments({ categoryId: id, restaurantId: context.restaurantId });
    if (inUse > 0) {
        throw new ValidationError('Cannot delete category while it has items');
    }

    await deleteFoodImageAsset({
        publicId: existing.imagePublicId,
        url: existing.image,
    });
    await FoodCategory.findOneAndDelete({ _id: id, restaurantId: context.restaurantId });
    return { id };
}
