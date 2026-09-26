/**
 * QC Dispatch Adapter
 * Normalizes pickup locations and order metadata to integrate QC orders with the Food dispatch engine.
 */

import mongoose from 'mongoose';

/**
 * Creates a normalized pickup location object from either a Food or QC order context.
 * Bypasses faking restaurantId.
 * 
 * @param {object} order - The order document or raw object
 * @param {string} type - Explicitly provide "food" or "quick", or derived from fields
 * @returns {object} Normalized pickup object
 */
export function normalizePickupForDispatch(order, type = null) {
    if (!order) return null;

    const derivedType = type || (order.seller ? 'quick' : 'food');

    if (derivedType === 'quick') {
        const seller = order.seller || {};
        let coordinates = [0, 0];
        
        if (Array.isArray(seller.location?.coordinates)) {
            coordinates = seller.location.coordinates;
        } else if (seller.location?.lng != null && seller.location?.lat != null) {
            coordinates = [Number(seller.location.lng), Number(seller.location.lat)];
        }

        return {
            entityId: seller._id || seller,
            entityName: seller.shopName || seller.name || 'Quick Commerce Shop',
            location: {
                type: 'Point',
                coordinates
            },
            type: 'quick'
        };
    } else {
        // Food Order
        const restaurant = order.restaurantId || {};
        let coordinates = [0, 0];

        if (Array.isArray(restaurant.location?.coordinates)) {
            coordinates = restaurant.location.coordinates;
        } else if (restaurant.location?.longitude != null && restaurant.location?.latitude != null) {
            coordinates = [Number(restaurant.location.longitude), Number(restaurant.location.latitude)];
        }

        return {
            entityId: restaurant._id || restaurant,
            entityName: restaurant.restaurantName || restaurant.name || 'Food Restaurant',
            location: {
                type: 'Point',
                coordinates
            },
            type: 'food'
        };
    }
}

export default {
    normalizePickupForDispatch
};
