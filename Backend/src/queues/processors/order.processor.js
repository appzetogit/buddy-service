import { logger } from '../../utils/logger.js';
import { addPaymentJob } from '../producers/payment.producer.js';

/**
 * BullMQ processor for order lifecycle jobs.
 *
 * @param {import('bullmq').Job} job
 */
export const processOrderJob = async (job) => {
    const data = job?.data || {};
    const action = data.action || 'unknown';
    const orderId = data.orderId || '';
    const orderMongoId = data.orderMongoId || '';

    logger.info(
        `[BullMQ:order] action=${action} jobId=${job.id} orderId=${orderId} orderMongoId=${orderMongoId}`
    );

    // Handle Smart Dispatch Timeout
    if (action === 'DISPATCH_TIMEOUT_CHECK') {
        try {
            const { processDispatchTimeout } = await import('../../modules/food/orders/services/order.service.js');
            // Pass full data object to allow attempt count and other options
            await processDispatchTimeout(orderMongoId, data.partnerId, data);
        } catch (err) {
            logger.error(`[BullMQ:order] DISPATCH_TIMEOUT_CHECK failed: ${err.message}`);
        }
    }

    // Forward settlement to payment queue (single source: order.riderEarning / platformProfit)
    if (action === 'delivery_completed') {
        try {
            await addPaymentJob({
                ...data,
                action: 'delivery_completed',
            });
        } catch (err) {
            logger.error(`[BullMQ:order] Failed to enqueue payment settlement: ${err.message}`);
            throw err;
        }
    }

    return { processed: true, action, jobId: job.id };
};
