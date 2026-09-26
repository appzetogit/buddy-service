/**
 * Delivery Response Adapter
 * Translates request and response shapes between the Food Ordering and Quick Commerce (QC) formats.
 * Bypasses tightly coupling the two systems while maintaining complete frontend compatibility.
 */

import { mapQcToFoodStatus, mapFoodToQcStatus } from './qc-food-status.mapper.js';

/**
 * Adapts a Quick Commerce order into the format expected by the Food Ordering delivery frontend.
 * @param {object} qcOrder - Quick Commerce order object or document.
 * @returns {object} The adapted order object conforming to Food Ordering shapes.
 */
export function adaptQcOrderToFoodShape(qcOrder) {
    if (!qcOrder) return null;

    // Support both plain objects and mongoose documents
    const rawOrder = typeof qcOrder.toObject === 'function' ? qcOrder.toObject() : qcOrder;

    // Normalizing location coordinates
    let sellerCoordinates = [0, 0];
    if (Array.isArray(rawOrder.seller?.location?.coordinates)) {
        sellerCoordinates = rawOrder.seller.location.coordinates;
    } else if (typeof rawOrder.seller?.location?.lng === 'number' && typeof rawOrder.seller?.location?.lat === 'number') {
        sellerCoordinates = [rawOrder.seller.location.lng, rawOrder.seller.location.lat];
    }

    let customerCoordinates = [0, 0];
    if (typeof rawOrder.address?.location?.lng === 'number' && typeof rawOrder.address?.location?.lat === 'number') {
        customerCoordinates = [rawOrder.address.location.lng, rawOrder.address.location.lat];
    }

    const adapted = {
        ...rawOrder,
        _id: rawOrder._id || rawOrder.orderId,
        order_id: rawOrder.orderId,
        orderId: rawOrder.orderId,
        
        // ⚠️ SAFETY: Maintain BOTH original seller and restaurantId mappings
        seller: rawOrder.seller,
        restaurantId: rawOrder.seller ? {
            _id: rawOrder.seller._id || rawOrder.seller,
            restaurantName: rawOrder.seller.shopName || rawOrder.seller.name || 'Quick Commerce Shop',
            name: rawOrder.seller.name || rawOrder.seller.shopName || 'Quick Commerce Shop',
            phone: rawOrder.seller.phone || '',
            location: {
                type: 'Point',
                coordinates: sellerCoordinates
            }
        } : null,
        
        // Map address to deliveryAddress
        deliveryAddress: rawOrder.address ? {
            label: rawOrder.address.type || 'Home',
            name: rawOrder.address.name || '',
            fullName: rawOrder.address.name || '',
            street: rawOrder.address.address || '',
            additionalDetails: rawOrder.address.landmark || '',
            city: rawOrder.address.city || '',
            state: '',
            zipCode: '',
            phone: rawOrder.address.phone || '',
            location: {
                type: 'Point',
                coordinates: customerCoordinates
            }
        } : null,

        // Map pricing properties
        pricing: rawOrder.pricing ? {
            subtotal: rawOrder.pricing.subtotal || rawOrder.paymentBreakdown?.productSubtotal || 0,
            tax: rawOrder.pricing.gst || rawOrder.paymentBreakdown?.taxTotal || 0,
            packagingFee: rawOrder.pricing.platformFee || 0,
            deliveryFee: rawOrder.pricing.deliveryFee || rawOrder.paymentBreakdown?.deliveryFeeCharged || 0,
            platformFee: rawOrder.pricing.platformFee || rawOrder.paymentBreakdown?.handlingFeeCharged || 0,
            restaurantCommission: 0,
            discount: rawOrder.pricing.discount || rawOrder.paymentBreakdown?.discountTotal || 0,
            total: rawOrder.pricing.total || rawOrder.paymentBreakdown?.grandTotal || 0,
            currency: 'INR'
        } : null,

        // Map status
        orderStatus: mapQcToFoodStatus(rawOrder.workflowStatus || rawOrder.status),

        // Map pickups array
        pickups: rawOrder.seller ? [{
            restaurantId: rawOrder.seller._id || rawOrder.seller,
            restaurantName: rawOrder.seller.shopName || rawOrder.seller.name || 'Quick Commerce Shop',
            status: rawOrder.pickupReadyAt ? 'ready' : 'pending',
            location: {
                type: 'Point',
                coordinates: sellerCoordinates
            },
            items: (rawOrder.items || []).map(i => i.name || 'QC Item')
        }] : [],

        // Map dispatch property
        dispatch: {
            modeAtCreation: 'auto',
            status: rawOrder.deliveryBoy ? 'accepted' : 'unassigned',
            deliveryPartnerId: rawOrder.deliveryBoy || null,
            assignedAt: rawOrder.assignedAt || null,
            acceptedAt: rawOrder.acceptedAt || null,
            offeredTo: []
        },

        // Map deliveryState property
        deliveryState: {
            currentPhase: rawOrder.workflowStatus === 'out_for_delivery'
                ? 'en_route_to_delivery'
                : rawOrder.workflowStatus === 'pickup_ready'
                ? 'at_pickup'
                : rawOrder.workflowStatus === 'delivery_assigned'
                ? 'en_route_to_pickup'
                : 'en_route_to_pickup',
            reachedPickupAt: rawOrder.pickupReadyAt || null,
            pickedUpAt: rawOrder.pickupConfirmedAt || null,
            deliveredAt: rawOrder.deliveredAt || null
        }
    };

    return adapted;
}

/**
 * Adapts a Food Ordering order into the format expected by the Quick Commerce delivery frontend.
 * @param {object} foodOrder - Food Ordering order object or document.
 * @returns {object} The adapted order object conforming to Quick Commerce shapes.
 */
export function adaptFoodOrderToQcShape(foodOrder) {
    if (!foodOrder) return null;

    const rawOrder = typeof foodOrder.toObject === 'function' ? foodOrder.toObject() : foodOrder;

    // Normalizing location coordinates
    let sellerLat = 0;
    let sellerLng = 0;
    if (Array.isArray(rawOrder.restaurantId?.location?.coordinates) && rawOrder.restaurantId.location.coordinates.length >= 2) {
        sellerLng = rawOrder.restaurantId.location.coordinates[0];
        sellerLat = rawOrder.restaurantId.location.coordinates[1];
    }

    let customerLat = 0;
    let customerLng = 0;
    if (Array.isArray(rawOrder.deliveryAddress?.location?.coordinates) && rawOrder.deliveryAddress.location.coordinates.length >= 2) {
        customerLng = rawOrder.deliveryAddress.location.coordinates[0];
        customerLat = rawOrder.deliveryAddress.location.coordinates[1];
    }

    const adapted = {
        ...rawOrder,
        orderId: rawOrder.orderId || rawOrder.order_id || rawOrder._id,
        customer: rawOrder.userId,
        
        // ⚠️ SAFETY: Maintain BOTH original restaurantId and seller mappings
        restaurantId: rawOrder.restaurantId,
        seller: rawOrder.restaurantId ? {
            _id: rawOrder.restaurantId._id || rawOrder.restaurantId,
            shopName: rawOrder.restaurantId.restaurantName || rawOrder.restaurantId.name || 'Restaurant',
            name: rawOrder.restaurantId.name || rawOrder.restaurantId.restaurantName || 'Restaurant',
            address: rawOrder.restaurantId.addressLine1 || rawOrder.restaurantId.area || '',
            phone: rawOrder.restaurantId.phone || rawOrder.restaurantId.ownerPhone || '',
            location: {
                type: 'Point',
                coordinates: [sellerLng, sellerLat]
            }
        } : null,

        // Map deliveryAddress to address
        address: rawOrder.deliveryAddress ? {
            type: rawOrder.deliveryAddress.label || 'Home',
            name: rawOrder.deliveryAddress.name || rawOrder.deliveryAddress.fullName || '',
            address: rawOrder.deliveryAddress.street || '',
            city: rawOrder.deliveryAddress.city || '',
            phone: rawOrder.deliveryAddress.phone || '',
            landmark: rawOrder.deliveryAddress.additionalDetails || '',
            location: {
                lat: customerLat,
                lng: customerLng
            }
        } : null,

        // Map pricing parameters to paymentBreakdown
        paymentBreakdown: {
            currency: 'INR',
            productSubtotal: rawOrder.pricing?.subtotal || 0,
            deliveryFeeCharged: rawOrder.pricing?.deliveryFee || 0,
            handlingFeeCharged: rawOrder.pricing?.platformFee || 0,
            tipTotal: rawOrder.pricing?.tip || 0,
            discountTotal: rawOrder.pricing?.discount || 0,
            taxTotal: rawOrder.pricing?.tax || 0,
            grandTotal: rawOrder.pricing?.total || 0,
            sellerPayoutTotal: 0,
            riderPayoutTotal: rawOrder.riderEarning || 0
        },

        // Map status & workflowStatus
        status: rawOrder.orderStatus === 'delivered' ? 'delivered' : 'pending',
        workflowStatus: mapFoodToQcStatus(rawOrder.orderStatus, rawOrder),
        
        // Keep deliveryBoy reference
        deliveryBoy: rawOrder.dispatch?.deliveryPartnerId || null,
        deliveryPartner: rawOrder.dispatch?.deliveryPartnerId || null
    };

    return adapted;
}

export default {
    adaptQcOrderToFoodShape,
    adaptFoodOrderToQcShape
};
