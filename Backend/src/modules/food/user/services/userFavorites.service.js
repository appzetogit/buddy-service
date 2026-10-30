import mongoose from 'mongoose';
import { FoodUserFavorite } from '../models/foodUserFavorite.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodItem } from '../../admin/models/food.model.js';

export const getUserFavorites = async (userId) => {
    if (!userId) {
        return { restaurantIds: [], foodIds: [], restaurants: [], foods: [] };
    }

    const doc = await FoodUserFavorite.findOne({ userId }).lean();
    const restaurantIds = (doc?.restaurantIds || []).map((id) => String(id).trim()).filter(Boolean);
    const foodIds = (doc?.foodIds || []).map((id) => String(id).trim()).filter(Boolean);

    const rObjectIds = restaurantIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

    const fObjectIds = foodIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

    const [restaurants, foods] = await Promise.all([
        rObjectIds.length ? FoodRestaurant.find({ _id: { $in: rObjectIds } }).lean() : [],
        fObjectIds.length ? FoodItem.find({ _id: { $in: fObjectIds } }).lean() : []
    ]);

    return {
        restaurantIds,
        foodIds,
        restaurants,
        foods
    };
};

export const addFavoriteRestaurant = async (userId, restaurantId) => {
    const resIdStr = String(restaurantId || '').trim();
    if (!userId || !resIdStr) return;

    return await FoodUserFavorite.findOneAndUpdate(
        { userId },
        { $addToSet: { restaurantIds: resIdStr } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
};

export const removeFavoriteRestaurant = async (userId, restaurantId) => {
    const resIdStr = String(restaurantId || '').trim();
    if (!userId || !resIdStr) return;

    return await FoodUserFavorite.findOneAndUpdate(
        { userId },
        { $pull: { restaurantIds: resIdStr } },
        { new: true }
    );
};

export const addFavoriteFood = async (userId, foodId) => {
    const foodIdStr = String(foodId || '').trim();
    if (!userId || !foodIdStr) return;

    return await FoodUserFavorite.findOneAndUpdate(
        { userId },
        { $addToSet: { foodIds: foodIdStr } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
};

export const removeFavoriteFood = async (userId, foodId) => {
    const foodIdStr = String(foodId || '').trim();
    if (!userId || !foodIdStr) return;

    return await FoodUserFavorite.findOneAndUpdate(
        { userId },
        { $pull: { foodIds: foodIdStr } },
        { new: true }
    );
};

