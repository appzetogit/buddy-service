import express from 'express';
import { OrderItemReview } from './orderItemReview.model.js';
import { sendResponse } from '../../utils/response.js';

const router = express.Router();
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** GET /v1/common/admin/item-reviews?ownerType=restaurant|seller&search=&page=&limit=  - all dish / product ratings. */
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const filter = {};
    if (['restaurant', 'seller'].includes(String(req.query.ownerType))) filter.ownerType = String(req.query.ownerType);
    const q = String(req.query.search || '').trim();
    if (q) {
      const re = new RegExp(esc(q), 'i');
      filter.$or = [{ itemName: re }, { userName: re }, { comment: re }, { orderRef: re }];
    }
    const [items, total, byOwner] = await Promise.all([
      OrderItemReview.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      OrderItemReview.countDocuments(filter),
      OrderItemReview.aggregate([{ $group: { _id: '$ownerType', n: { $sum: 1 }, avg: { $avg: '$rating' } } }]),
    ]);
    const counts = { restaurant: 0, seller: 0 };
    byOwner.forEach((o) => { counts[o._id] = o.n; });
    return sendResponse(res, 200, 'Item ratings', {
      items: items.map((r) => ({
        id: String(r._id), ownerType: r.ownerType, ownerId: String(r.ownerId), itemName: r.itemName, itemType: r.itemType,
        rating: r.rating, comment: r.comment, customerName: r.userName, orderRef: r.orderRef, createdAt: r.createdAt,
      })),
      counts: { ...counts, ALL: counts.restaurant + counts.seller },
      pagination: { total, page, limit, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
