import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { attachOutletTimingsToRestaurants } from '../../restaurant/services/outletTimings.service.js';
import { FoodItem } from '../../admin/models/food.model.js';
import { FoodCategory } from '../../admin/models/category.model.js';
import { ACTIVE_PUBLIC_CATEGORY_FILTER, buildFoodVisibleCategoryFilter } from '../../shared/categoryWorkflow.js';
import mongoose from 'mongoose';

const RESTAURANT_LIST_FIELDS = [
    'restaurantName',
    'slug',
    'cuisines',
    'rating',
    'estimatedDeliveryTimeMinutes',
    'pureVegRestaurant',
    'location',
    'coverImage',
    'coverImages',
    'menuImages',
    'profileImage',
    'zoneId',
    'isAcceptingOrders',
    'status',
].join(' ');

const FOOD_MATCH_FIELDS = 'name image restaurantId foodType';

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildNameMatcher(term) {
    const normalized = String(term || '').trim();
    if (!normalized) return null;
    // Prefix-style match uses indexes better than unanchored regex scans.
    return new RegExp(`^${escapeRegex(normalized)}`, 'i');
}

function attachMatchedDish(restaurant, matchedFoods) {
    const rid = restaurant._id.toString();
    const dish = matchedFoods.find((f) => f.restaurantId.toString() === rid);
    if (!dish) return { ...restaurant, matchType: 'food' };
    return {
        ...restaurant,
        matchType: 'food',
        matchedDish: dish.name,
        matchedDishImage: dish.image,
        matchedDishId: dish._id,
    };
}

/**
 * Unified Search Service
 * Searches for restaurants by name and also searches for food items,
 * returning matched restaurants with potential dish highlights.
 */
export const searchUnified = async (query = {}) => {
    const {
        q,
        lat,
        lng,
        categoryId,
        minRating,
        maxDeliveryTime,
        isVeg,
        page = 1,
        limit = 20,
        zoneId,
    } = query;

    const skip = (page - 1) * limit;
    const term = String(q || '').trim();
    const nameMatcher = buildNameMatcher(term);

    const restaurantFilter = { status: 'approved' };

    if (zoneId && mongoose.Types.ObjectId.isValid(zoneId)) {
        restaurantFilter.zoneId = new mongoose.Types.ObjectId(zoneId);
    }

    if (isVeg === 'true') {
        restaurantFilter.pureVegRestaurant = true;
    }

    if (minRating) {
        restaurantFilter.rating = { $gte: parseFloat(minRating) };
    }

    if (maxDeliveryTime) {
        restaurantFilter.estimatedDeliveryTimeMinutes = { $lte: parseInt(maxDeliveryTime, 10) };
    }

    let restaurantIds = new Set();
    let restaurantDetailsMap = new Map();

    if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
        const category = await FoodCategory.findOne({
            _id: new mongoose.Types.ObjectId(categoryId),
            ...ACTIVE_PUBLIC_CATEGORY_FILTER
        }).select('_id').lean();
        if (!category?._id) {
            return {
                success: true,
                data: { restaurants: [], total: 0, page: parseInt(page, 10), limit: parseInt(limit, 10) },
            };
        }

        const catFoodItems = await FoodItem.find({
            categoryId: category._id,
            approvalStatus: 'approved',
        })
            .select('restaurantId')
            .lean();

        const catRestaurantIds = [...new Set(catFoodItems.map((f) => f.restaurantId.toString()))];
        if (catRestaurantIds.length > 0) {
            restaurantFilter._id = { $in: catRestaurantIds.map((id) => new mongoose.Types.ObjectId(id)) };
        } else {
            return {
                success: true,
                data: { restaurants: [], total: 0, page: parseInt(page, 10), limit: parseInt(limit, 10) },
            };
        }
    }

    if (nameMatcher) {
        const restaurantNameQuery = {
            ...restaurantFilter,
            $or: [
                { restaurantName: nameMatcher },
                { cuisines: nameMatcher },
            ],
        };

        const matchedRestaurants = await FoodRestaurant.find(restaurantNameQuery)
            .select(RESTAURANT_LIST_FIELDS)
            .limit(limit * 2)
            .lean();

        matchedRestaurants.forEach((r) => {
            restaurantIds.add(r._id.toString());
            restaurantDetailsMap.set(r._id.toString(), { ...r, matchType: 'restaurant' });
        });

        const foodFilters = { approvalStatus: 'approved', name: nameMatcher };
        if (isVeg === 'true') foodFilters.foodType = 'Veg';
        const visibleCategoryFilter = await buildFoodVisibleCategoryFilter();
        if (visibleCategoryFilter) {
            foodFilters.$and = [...(foodFilters.$and || []), visibleCategoryFilter];
        }

        const matchedFoods = await FoodItem.find(foodFilters)
            .select(FOOD_MATCH_FIELDS)
            .limit(limit * 2)
            .lean();

        const foodRestaurantIds = matchedFoods.map((f) => f.restaurantId.toString());
        const unmatchedIds = foodRestaurantIds.filter((id) => !restaurantIds.has(id));

        if (unmatchedIds.length > 0) {
            const rsForFoods = await FoodRestaurant.find({
                ...restaurantFilter,
                _id: { $in: unmatchedIds.map((id) => new mongoose.Types.ObjectId(id)) },
            })
                .select(RESTAURANT_LIST_FIELDS)
                .lean();

            rsForFoods.forEach((r) => {
                restaurantIds.add(r._id.toString());
                restaurantDetailsMap.set(
                    r._id.toString(),
                    attachMatchedDish(r, matchedFoods),
                );
            });
        }
    } else {
        const allMatching = await FoodRestaurant.find(restaurantFilter)
            .select(RESTAURANT_LIST_FIELDS)
            .sort({ rating: -1, createdAt: -1 })
            .limit(limit * 2)
            .lean();

        allMatching.forEach((r) => {
            restaurantIds.add(r._id.toString());
            restaurantDetailsMap.set(r._id.toString(), r);
        });
    }

    let results = await attachOutletTimingsToRestaurants(
        Array.from(restaurantDetailsMap.values()),
    );

    if (lat && lng && results.length > 0) {
        const latNum = Number(lat);
        const lngNum = Number(lng);
        results.forEach((res) => {
            if (res.location?.latitude && res.location?.longitude) {
                const dLat = (res.location.latitude - latNum) * Math.PI / 180;
                const dLon = (res.location.longitude - lngNum) * Math.PI / 180;
                const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                    + Math.cos(latNum * Math.PI / 180) * Math.cos(res.location.latitude * Math.PI / 180)
                    * Math.sin(dLon / 2) * Math.sin(dLon / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                res.distanceScore = 6371 * c;
            } else {
                res.distanceScore = 999;
            }
        });
        results.sort((a, b) => (a.distanceScore || 999) - (b.distanceScore || 999));
    }

    const finalResult = {
        success: true,
        data: {
            restaurants: results.slice(skip, skip + limit),
            total: results.length,
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
            zoneFiltered: !!(zoneId && mongoose.Types.ObjectId.isValid(zoneId)),
        },
    };

    if (results.length === 0 && zoneId && mongoose.Types.ObjectId.isValid(zoneId)) {
        const fallbackResults = await searchUnified({ ...query, zoneId: null });
        if (fallbackResults.data.total > 0) {
            fallbackResults.data.wasFallback = true;
            return fallbackResults;
        }
    }

    return finalResult;
};

/**
 * Fetch Admin-only categories
 */
export const getAdminCategories = async (query = {}) => {
    const filter = {
        ...ACTIVE_PUBLIC_CATEGORY_FILTER,
        isApproved: true,
        $or: [
            { restaurantId: { $exists: false } },
            { restaurantId: null },
            { restaurantId: { $eq: undefined } },
        ],
    };

    if (query.zoneId && mongoose.Types.ObjectId.isValid(query.zoneId)) {
        filter.$or = [
            { zoneId: new mongoose.Types.ObjectId(query.zoneId) },
            { zoneId: { $exists: false } },
            { zoneId: null },
        ];
    }

    return FoodCategory.find(filter)
        .select('name image sortOrder zoneId')
        .sort({ sortOrder: 1, name: 1 })
        .lean();
};
