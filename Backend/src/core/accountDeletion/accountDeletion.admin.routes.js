import express from 'express';
import { AccountDeletion } from '../../modules/food/admin/models/accountDeletion.model.js';
import { sendResponse } from '../../utils/response.js';

const router = express.Router();
const TYPES = ['USER', 'SELLER', 'RESTAURANT', 'DELIVERY_PARTNER'];
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** GET /v1/common/admin/account-deletions?type=&search=&page=&limit=  - every deleted account, newest first. */
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const filter = {};
    if (TYPES.includes(String(req.query.type))) filter.accountType = String(req.query.type);
    const q = String(req.query.search || '').trim();
    if (q) {
      const re = new RegExp(esc(q), 'i');
      filter.$or = [{ name: re }, { phone: re }, { email: re }, { 'details.shopName': re }];
    }
    const [items, total, counts] = await Promise.all([
      AccountDeletion.find(filter).sort({ deletedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AccountDeletion.countDocuments(filter),
      AccountDeletion.aggregate([{ $group: { _id: '$accountType', n: { $sum: 1 } } }]),
    ]);
    const byType = Object.fromEntries(TYPES.map((t) => [t, 0]));
    counts.forEach((c) => { byType[c._id] = c.n; });
    return sendResponse(res, 200, 'Deleted accounts', {
      items: items.map((d) => ({
        id: String(d._id),
        accountType: d.accountType,
        originalId: String(d.originalId),
        name: d.name || '',
        phone: d.phone || '',
        email: d.email || '',
        shopName: d.details?.shopName || '',
        deletedAt: d.deletedAt || d.createdAt,
        source: d.source || 'self',
        reason: d.reason || '',
        orderCount: d.orderCount || 0,
        financialSnapshot: d.financialSnapshot || {},
      })),
      counts: { ...byType, ALL: Object.values(byType).reduce((a, b) => a + b, 0) },
      pagination: { total, page, limit, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
