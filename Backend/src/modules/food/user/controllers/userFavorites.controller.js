import { sendResponse } from '../../../../utils/response.js';
import {
    getUserFavorites,
    addFavoriteRestaurant,
    removeFavoriteRestaurant,
    addFavoriteFood,
    removeFavoriteFood
} from '../services/userFavorites.service.js';

export const getFavoritesController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const result = await getUserFavorites(userId);
        return sendResponse(res, 200, 'Favorites retrieved successfully', result);
    } catch (error) {
        next(error);
    }
};

export const addFavoriteRestaurantController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const { restaurantId } = req.params;
        await addFavoriteRestaurant(userId, restaurantId);
        return sendResponse(res, 200, 'Restaurant added to favorites', { restaurantId, isFavorite: true });
    } catch (error) {
        next(error);
    }
};

export const removeFavoriteRestaurantController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const { restaurantId } = req.params;
        await removeFavoriteRestaurant(userId, restaurantId);
        return sendResponse(res, 200, 'Restaurant removed from favorites', { restaurantId, isFavorite: false });
    } catch (error) {
        next(error);
    }
};

export const addFavoriteFoodController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const { foodId } = req.params;
        await addFavoriteFood(userId, foodId);
        return sendResponse(res, 200, 'Food added to favorites', { foodId, isFavorite: true });
    } catch (error) {
        next(error);
    }
};

export const removeFavoriteFoodController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const { foodId } = req.params;
        await removeFavoriteFood(userId, foodId);
        return sendResponse(res, 200, 'Food removed from favorites', { foodId, isFavorite: false });
    } catch (error) {
        next(error);
    }
};

