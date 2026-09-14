import {
    registerRestaurant,
    listApprovedRestaurants,
    listPublicFoods,
    getApprovedRestaurantByIdOrSlug,
    getCurrentRestaurantProfile,
    updateRestaurantProfile,
    updateRestaurantAcceptingOrders,
    updateCurrentRestaurantDiningSettings,
    uploadRestaurantProfileImage,
    uploadRestaurantMenuImage,
    uploadRestaurantCoverImages,
    uploadRestaurantMenuImages,
    listPublicOffers,
    listOffersForRestaurantPage,
    listDeliverySpeedOptions,
    getPublicCheckoutSettings,
    listRestaurantOffers,
    createRestaurantOffer,
    updateRestaurantOffer,
    deleteRestaurantOffer,
    reapplyRestaurantOffer,
    getRestaurantOfferAnalytics,
    getRestaurantOfferUsageHistory,
    getRestaurantComplaints
} from '../services/restaurant.service.js';
import {
    createDiningRequest,
    getPendingDiningRequest
} from '../../dining/services/dining.service.js';
import { validateRestaurantRegisterDto } from '../validators/restaurant.validator.js';
import { validateRestaurantCreateOfferDto, validateRestaurantUpdateOfferDto } from '../../admin/validators/offer.validator.js';
import { sendResponse, sendError } from '../../../../utils/response.js';

export const registerRestaurantController = async (req, res, next) => {
    try {
        const validated = validateRestaurantRegisterDto(req.body);
        const restaurant = await registerRestaurant(validated, req.files);
        return sendResponse(res, 201, 'Restaurant registered successfully', restaurant);
    } catch (error) {
        next(error);
    }
};

export const listApprovedRestaurantsController = async (req, res, next) => {
    try {
        // Trigger cache refresh V5
        const data = await listApprovedRestaurants(req.query);
        return sendResponse(res, 200, 'Restaurants fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getPublicFoodsController = async (req, res, next) => {
    try {
        const data = await listPublicFoods(req.query);
        return sendResponse(res, 200, 'Foods fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getApprovedRestaurantController = async (req, res, next) => {
    try {
        const restaurant = await getApprovedRestaurantByIdOrSlug(req.params.id, {
            lat: req.query.lat,
            lng: req.query.lng
        });
        if (!restaurant) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }
        return sendResponse(res, 200, 'Restaurant fetched successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const getCurrentRestaurantController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const restaurant = await getCurrentRestaurantProfile(restaurantId);
        return sendResponse(res, 200, 'Restaurant fetched successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const updateRestaurantProfileController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const restaurant = await updateRestaurantProfile(restaurantId, req.body || {});
        return sendResponse(res, 200, 'Restaurant updated successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const updateRestaurantAcceptingOrdersController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const restaurant = await updateRestaurantAcceptingOrders(restaurantId, req.body?.isAcceptingOrders);
        return sendResponse(res, 200, 'Restaurant availability updated successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const updateCurrentRestaurantDiningSettingsController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const restaurant = await updateCurrentRestaurantDiningSettings(restaurantId, req.body || {});
        return sendResponse(res, 200, 'Dining settings updated successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantProfileImageController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const result = await uploadRestaurantProfileImage(restaurantId, req.file);
        return sendResponse(res, 200, 'Profile image uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantMenuImageController = async (req, res, next) => {
    try {
        const result = await uploadRestaurantMenuImage(req.file);
        return sendResponse(res, 200, 'Menu image uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantCoverImagesController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const result = await uploadRestaurantCoverImages(restaurantId, req.files || []);
        return sendResponse(res, 200, 'Restaurant photos uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantMenuImagesController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const result = await uploadRestaurantMenuImages(restaurantId, req.files || []);
        return sendResponse(res, 200, 'Menu photos uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const listPublicOffersController = async (req, res, next) => {
    try {
        const data = await listPublicOffers(req.query || {});
        return sendResponse(res, 200, 'Offers fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const listOffersForRestaurantPageController = async (req, res, next) => {
    try {
        const { restaurantId } = req.params;
        const userId = req.user?.userId || null;
        const data = await listOffersForRestaurantPage(restaurantId, userId);
        return sendResponse(res, 200, 'Offers fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const listDeliverySpeedOptionsController = async (req, res, next) => {
    try {
        const data = await listDeliverySpeedOptions();
        return sendResponse(res, 200, 'Delivery speed options fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getPublicCheckoutSettingsController = async (req, res, next) => {
    try {
        const data = await getPublicCheckoutSettings();
        return sendResponse(res, 200, 'Checkout settings fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const listRestaurantOffersController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const data = await listRestaurantOffers(restaurantId);
        return sendResponse(res, 200, 'Offers fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const createRestaurantOfferController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const dto = validateRestaurantCreateOfferDto(req.body || {});
        const offer = await createRestaurantOffer(restaurantId, dto);
        return sendResponse(res, 201, 'Coupon created successfully', { offer });
    } catch (error) {
        next(error);
    }
};

export const updateRestaurantOfferController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const { id } = req.params;
        const dto = validateRestaurantUpdateOfferDto(req.body || {});
        const offer = await updateRestaurantOffer(restaurantId, id, dto);
        if (!offer) {
            return sendError(res, 404, 'Coupon not found');
        }
        return sendResponse(res, 200, 'Coupon updated successfully', { offer });
    } catch (error) {
        next(error);
    }
};

export const deleteRestaurantOfferController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const { id } = req.params;
        const result = await deleteRestaurantOffer(restaurantId, id);
        if (!result) {
            return sendError(res, 404, 'Coupon not found');
        }
        return sendResponse(res, 200, 'Coupon deleted successfully', result);
    } catch (error) {
        next(error);
    }
};

export const reapplyRestaurantOfferController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const { id } = req.params;
        const offer = await reapplyRestaurantOffer(restaurantId, id);
        if (!offer) {
            return sendError(res, 404, 'Coupon not found');
        }
        return sendResponse(res, 200, 'Coupon resubmitted for approval', { offer });
    } catch (error) {
        next(error);
    }
};

export const getRestaurantOfferAnalyticsController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const { id } = req.params;
        const data = await getRestaurantOfferAnalytics(restaurantId, id);
        if (!data) return sendError(res, 404, 'Coupon not found');
        return sendResponse(res, 200, 'Analytics fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getRestaurantOfferUsageHistoryController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const { id } = req.params;
        const data = await getRestaurantOfferUsageHistory(restaurantId, id, req.query || {});
        if (!data) return sendError(res, 404, 'Coupon not found');
        return sendResponse(res, 200, 'Usage history fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getRestaurantComplaintsController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const data = await getRestaurantComplaints(restaurantId, req.query || {});
        return sendResponse(res, 200, 'Complaints fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const createDiningRequestController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const request = await createDiningRequest(restaurantId, req.body || {});
        return sendResponse(res, 201, 'Dining update request submitted successfully', request);
    } catch (error) {
        next(error);
    }
};

export const getPendingDiningRequestController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const request = await getPendingDiningRequest(restaurantId);
        return sendResponse(res, 200, 'Pending request fetched successfully', request);
    } catch (error) {
        next(error);
    }
};
