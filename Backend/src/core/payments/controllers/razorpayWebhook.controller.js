import crypto from 'crypto';
import mongoose from 'mongoose';
import { FoodOrder } from '../../../modules/food/orders/models/order.model.js';
import * as foodTransactionService from '../../../modules/food/orders/services/foodTransaction.service.js';
import { finalizeCheckoutFromWebhook } from '../../../modules/food/orders/services/order.service.js';
import { config } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';

/**
 * ✅ NEW: Centralized Razorpay Webhook Handler (Core Layer)
 * Manages atomic updates for order payments and refunds across all modules.
 */
export const handleRazorpayWebhook = async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const secret = config.razorpayWebhookSecret;

    // 1. Verify Signature using raw body buffer
    if (!secret) {
        // Spell this out: an unset secret rejects EVERY webhook, so payment.captured and
        // refund events are silently never processed. That looks identical to "Razorpay isn't
        // calling us" unless the cause is named.
        logger.error(
            'Razorpay Webhook REJECTED: RAZORPAY_WEBHOOK_SECRET is not set. ' +
            'All payment/refund webhooks will fail until it matches the dashboard webhook secret.',
        );
        return res.status(400).send('Webhook secret not configured');
    }
    if (!signature || !req.rawBody) {
        logger.warn('Razorpay Webhook: Missing x-razorpay-signature header or raw body.');
        return res.status(400).send('Invalid signature');
    }

    const expected = crypto
        .createHmac('sha256', secret)
        .update(req.rawBody)
        .digest('hex');

    // Constant-time compare — a plain !== leaks the expected digest byte-by-byte via timing.
    const expectedBuf = Buffer.from(expected, 'utf8');
    const providedBuf = Buffer.from(String(signature), 'utf8');
    const signatureValid =
        expectedBuf.length === providedBuf.length &&
        crypto.timingSafeEqual(expectedBuf, providedBuf);

    if (!signatureValid) {
        logger.warn('Razorpay Webhook: Signature verification failed.');
        return res.status(400).send('Invalid signature');
    }

    const { event, payload } = req.body;
    logger.info(`Razorpay Webhook Received: ${event}`);

    try {
        // --- 🟢 Handle Payment Captured (Success) ---
        if (event === 'payment.captured') {
            const paymentObj = payload.payment.entity;
            const rzOrderId = paymentObj.order_id;
            const rzPaymentId = paymentObj.id;

            // Atomic update to mark as paid if not already
            const order = await FoodOrder.findOneAndUpdate(
                { 
                    "payment.razorpay.orderId": rzOrderId, 
                    "payment.status": { $ne: 'paid' } 
                },
                { 
                    $set: { 
                        "payment.status": 'paid', 
                        "payment.razorpay.paymentId": rzPaymentId 
                    } 
                },
                { new: true }
            );

            if (order) {
                // ✅ UPDATED: Wrapped in try-catch to prevent secondary failures from breaking the webhook response
                try {
                    await foodTransactionService.updateTransactionStatus(order._id, 'captured', {
                        status: 'captured',
                        razorpayPaymentId: rzPaymentId,
                        note: 'Payment status synced via Webhook (payment.captured)'
                    });
                } catch (ledgerErr) {
                    logger.error(`Webhook Ledger Error (Order ${order.orderId}): ${ledgerErr.message}`);
                }
                logger.info(`Webhook [payment.captured]: Synced Order ${order.orderId} (Status=paid)`);
            } else {
                // Quick Commerce pay-then-place: create the QuickOrder from its checkout session.
                try {
                    const { finalizeQuickCheckoutFromWebhook } = await import(
                        '../../../modules/quick-commerce/controllers/order.controller.js'
                    );
                    const quickOrder = await finalizeQuickCheckoutFromWebhook(rzOrderId, rzPaymentId);
                    if (quickOrder) {
                        logger.info(`Webhook [payment.captured]: Created quick order ${quickOrder.orderId || quickOrder._id} from checkout`);
                    }
                } catch (quickErr) {
                    logger.error(`Webhook quick checkout finalize error: ${quickErr.message}`);
                }

                // Pay-then-place: create FoodOrder from checkout session
                try {
                    const created = await finalizeCheckoutFromWebhook(rzOrderId, rzPaymentId);
                    if (created) {
                        logger.info(`Webhook [payment.captured]: Created order ${created._id || created.orderId} from checkout`);
                    } else {
                        logger.warn(`Webhook [payment.captured]: No order/checkout for RZ-Order: ${rzOrderId}`);
                    }
                } catch (checkoutErr) {
                    logger.error(`Webhook checkout finalize error: ${checkoutErr.message}`);
                }
            }
        }

        // --- 🔴 Handle Payment Failed ---
        //
        // Previously unhandled: only the browser's onError/onDismiss callback cancelled the
        // checkout, so a customer whose payment failed after they closed the tab (or lost
        // connectivity) left the session stuck in 'pending_payment' until its 30-minute TTL,
        // and a placed order kept payment.status 'pending' with nothing to correct it.
        if (event === 'payment.failed') {
            const paymentObj = payload?.payment?.entity || {};
            const rzOrderId = paymentObj.order_id;
            const rzPaymentId = paymentObj.id;
            const reason = paymentObj.error_description || paymentObj.error_reason || 'Payment failed';

            if (rzOrderId) {
                // Pay-then-place: close the checkout session so it is not left hanging.
                try {
                    const { FoodCheckoutSession } = await import(
                        '../../../modules/food/orders/models/foodCheckoutSession.model.js'
                    );
                    const session = await FoodCheckoutSession.findOneAndUpdate(
                        // Only a session that never completed — never downgrade a paid/completed one.
                        { 'razorpay.orderId': rzOrderId, status: 'pending_payment' },
                        { $set: { status: 'failed', failureReason: String(reason).slice(0, 300) } },
                        { new: true },
                    );
                    if (session) {
                        logger.info(`Webhook [payment.failed]: Checkout ${session._id} marked failed — ${reason}`);
                    }

                    const { QuickCheckoutSession } = await import(
                        '../../../modules/quick-commerce/models/quickCheckoutSession.model.js'
                    );
                    await QuickCheckoutSession.findOneAndUpdate(
                        { 'razorpay.orderId': rzOrderId, status: 'pending_payment' },
                        { $set: { status: 'failed', failureReason: String(reason).slice(0, 300) } },
                    );
                } catch (sessionErr) {
                    logger.error(`Webhook payment.failed checkout update error: ${sessionErr.message}`);
                }

                // Place-then-pay: an order already exists and its payment did not go through.
                try {
                    const failedOrder = await FoodOrder.findOneAndUpdate(
                        {
                            'payment.razorpay.orderId': rzOrderId,
                            'payment.status': { $nin: ['paid', 'refunded'] },
                        },
                        {
                            $set: {
                                'payment.status': 'failed',
                                'payment.failureReason': String(reason).slice(0, 300),
                                ...(rzPaymentId ? { 'payment.razorpay.paymentId': rzPaymentId } : {}),
                            },
                        },
                        { new: true },
                    );
                    if (failedOrder) {
                        logger.warn(
                            `Webhook [payment.failed]: Order ${failedOrder.order_id || failedOrder._id} payment failed — ${reason}`,
                        );
                    }
                } catch (orderErr) {
                    logger.error(`Webhook payment.failed order update error: ${orderErr.message}`);
                }
            }
        }

        // --- 🔴 Handle Refund Processed ---
        if (event === 'refund.processed') {
            const refundObj = payload.refund.entity;
            const rzPaymentId = refundObj.payment_id;
            const rzRefundId = refundObj.id;
            const refundAmount = refundObj.amount / 100; // to major unit

            // Sync refund fields in the order
            const order = await FoodOrder.findOneAndUpdate(
                { 
                    "payment.razorpay.paymentId": rzPaymentId,
                    "payment.refund.status": { $ne: 'processed' }
                },
                { 
                    $set: { 
                        "payment.status": 'refunded',
                        "payment.refund": {
                            status: 'processed',
                            amount: refundAmount,
                            refundId: rzRefundId,
                            processedAt: new Date()
                        }
                    } 
                },
                { new: true }
            );

            if (order) {
                logger.info(`Webhook [refund.processed]: Synced Order ${order.orderId} (Refunded)`);
            } else {
                // ✅ ADDED: Log warn if order not found for refund
                logger.warn(`Webhook [refund.processed]: Order not found or already refunded for RZ-Payment: ${rzPaymentId}`);
            }
        }

        res.status(200).json({ status: 'ok' });
    } catch (err) {
        logger.error(`Razorpay Webhook Logic Error: ${err.message}`);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};
