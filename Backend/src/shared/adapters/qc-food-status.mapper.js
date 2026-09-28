/**
 * Status Mapper Adapter
 * Maps status strings between the Food Ordering and Quick Commerce (QC) workflows.
 * Ensures the frontend and state machine logic remain aligned.
 */

export const QC_TO_FOOD_STATUS = {
    'seller_pending': 'created',
    'delivery_search': 'created',
    'delivery_assigned': 'created', // Rider accepted QC -> Food 'created'
    'seller_accepted': 'confirmed', // Seller accepted QC -> Food 'confirmed'
    'pickup_ready': 'ready_for_pickup',
    'out_for_delivery': 'picked_up',
    'delivered': 'delivered',
    'cancelled': 'cancelled_by_admin'
};

export const FOOD_TO_QC_STATUS = {
    'created': 'delivery_search',
    'scheduled': 'seller_pending',
    'confirmed': 'seller_accepted', // Food confirmed -> QC 'seller_accepted'
    'preparing': 'seller_accepted', // Food preparing -> QC 'seller_accepted'
    'ready_for_pickup': 'pickup_ready',
    'reached_pickup': 'pickup_ready',
    'picked_up': 'out_for_delivery',
    'reached_drop': 'out_for_delivery',
    'delivered': 'delivered',
    'cancelled_by_user': 'cancelled',
    'rejected_by_restaurant': 'cancelled',
    'cancelled_by_restaurant': 'cancelled',
    'cancelled_by_admin': 'cancelled'
};

/**
 * Maps a Quick Commerce workflow status to the corresponding Food Ordering status.
 * @param {string} qcStatus - The QC workflow status string.
 * @returns {string} The matching Food Ordering orderStatus.
 */
export function mapQcToFoodStatus(qcStatus) {
    if (!qcStatus) return 'created';
    const status = String(qcStatus).trim();
    return QC_TO_FOOD_STATUS[status] || 'created';
}

/**
 * Maps a Food Ordering status to the corresponding Quick Commerce workflow status.
 * Evaluates the dispatch context dynamically to differentiate unassigned from rider-accepted.
 * @param {string} foodStatus - The Food Ordering orderStatus string.
 * @param {object} [order] - The original Food Order document or object context.
 * @returns {string} The matching QC workflow status.
 */
export function mapFoodToQcStatus(foodStatus, order = null) {
    if (!foodStatus) return 'delivery_search';
    const status = String(foodStatus).trim();
    
    // Dynamic dispatch-based mapping for 'created' orders
    if (status === 'created') {
        const dispatchStatus = order?.dispatch?.status || order?.dispatchStatus;
        const partnerId = order?.dispatch?.deliveryPartnerId || order?.deliveryPartnerId;
        
        if (dispatchStatus === 'accepted' || partnerId) {
            return 'delivery_assigned';
        }
        return 'delivery_search';
    }

    return FOOD_TO_QC_STATUS[status] || 'delivery_search';
}

export default {
    QC_TO_FOOD_STATUS,
    FOOD_TO_QC_STATUS,
    mapQcToFoodStatus,
    mapFoodToQcStatus
};
