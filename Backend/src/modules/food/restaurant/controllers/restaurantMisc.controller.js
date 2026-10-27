import { FoodRestaurant } from '../models/restaurant.model.js';
import { sendError, sendResponse } from '../../../../utils/response.js';

export const getRestaurantMediaController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        if (!restaurantId) return sendError(res, 401, 'Unauthorized');

        const restaurant = await FoodRestaurant.findById(restaurantId)
            .select('coverImages profileImage')
            .lean();
        if (!restaurant) return sendError(res, 404, 'Restaurant not found');

        return sendResponse(res, 200, 'Media fetched successfully', {
            profileImage: restaurant.profileImage || '',
            coverImages: restaurant.coverImages || [],
        });
    } catch (error) {
        next(error);
    }
};

/** No subscription/billing system exists yet — stub so the app's invoices screen loads empty instead of 404ing. */
export const getRestaurantSubscriptionInvoicesController = async (req, res, next) => {
    try {
        if (!req.user?.userId) return sendError(res, 401, 'Unauthorized');
        return sendResponse(res, 200, 'Invoices fetched successfully', { invoices: [] });
    } catch (error) {
        next(error);
    }
};
