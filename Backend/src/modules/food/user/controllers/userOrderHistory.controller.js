import { sendResponse } from '../../../../utils/response.js';
import { getOrderedRestaurantIds } from '../services/userOrderHistory.service.js';

export const getOrderedRestaurantsController = async (req, res, next) => {
  try {
    const { userId } = req.user;
    const ids = await getOrderedRestaurantIds(userId);
    return sendResponse(res, 200, 'Ordered restaurants retrieved successfully', { ids });
  } catch (err) {
    next(err);
  }
};
