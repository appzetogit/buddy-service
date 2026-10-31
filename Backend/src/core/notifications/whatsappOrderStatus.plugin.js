import mongoose from 'mongoose';
import { sendWhatsappOrderStatus } from '../../utils/whatsapp.js';
import { logger } from '../../utils/logger.js';

/**
 * Sends the customer a WhatsApp "order_status" message when an order is Placed, Delivered,
 * Cancelled or Refunded - for every flow that uses the schema (food, quick-commerce, taxi).
 *
 * Hooks save() and findOneAndUpdate(), which is how these models change status today.
 * shortcut: updateOne/updateMany/bulkWrite status writes are not seen; move such a write to
 * save()/findOneAndUpdate() (or call notify directly) if one is added.
 *
 * options:
 *   statusPath  - field holding the status ('orderStatus' | 'status')
 *   delivered   - statuses meaning delivered/completed
 *   cancelled   - statuses meaning cancelled
 *   refundPath  - optional field that becomes 'processed' when a refund is done
 *   orderIdOf   - (doc) => text shown as the order number
 */
// shortcut: in-process dedupe only; with several server instances a rare duplicate message is possible.
const recent = new Map();

export const whatsappOrderStatusPlugin = (schema, { statusPath, delivered, cancelled, refundPath, orderIdOf }) => {
    const eventFor = (status) =>
        delivered.includes(status) ? 'Delivered' : cancelled.includes(status) ? 'Cancelled' : null;

    const notify = (doc, event) => {
        // Same event for the same order within 10 min (e.g. webhook + save both fire) goes out once.
        const key = `${doc._id}:${event}`;
        if (recent.has(key)) return;
        recent.set(key, setTimeout(() => recent.delete(key), 600000).unref());
        // Fire and forget: a WhatsApp problem must never fail or slow the order itself.
        (async () => {
            const User = mongoose.models.FoodUser;
            if (!User || !doc?.userId) return;
            const user = await User.findById(doc.userId).select('name phone').lean();
            if (!user?.phone) return;
            await sendWhatsappOrderStatus({
                phone: user.phone,
                name: user.name,
                orderId: orderIdOf(doc),
                status: event,
            });
        })().catch((error) => logger.error(`[WhatsApp] order status failed: ${error.message}`));
    };

    schema.pre('save', function captureChange(next) {
        this.$locals.waChange = {
            isNew: this.isNew,
            status: this.isModified(statusPath),
            refund: refundPath ? this.isModified(refundPath) : false,
        };
        next();
    });

    schema.post('save', (doc) => {
        const change = doc.$locals.waChange;
        if (!change) return;
        if (change.isNew) notify(doc, 'Placed');
        else if (change.status) {
            const event = eventFor(doc.get(statusPath));
            if (event) notify(doc, event);
        }
        if (change.refund && doc.get(refundPath) === 'processed') notify(doc, 'Refunded');
    });

    schema.post('findOneAndUpdate', function afterUpdate(doc) {
        if (!doc) return;
        const set = this.getUpdate()?.$set || {};
        const event = eventFor(set[statusPath]);
        if (event) notify(doc, event);
        // The refund is written either as 'payment.refund.status' or as the whole 'payment.refund' object.
        const refundStatus = refundPath && (set[refundPath] ?? set[refundPath.replace(/\.[^.]+$/, '')]?.status);
        if (refundStatus === 'processed') notify(doc, 'Refunded');
    });
};
