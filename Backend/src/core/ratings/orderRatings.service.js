import mongoose from 'mongoose';
import { OrderItemReview } from './orderItemReview.model.js';
import { FoodItem } from '../../modules/food/admin/models/food.model.js';
import { FoodRestaurant } from '../../modules/food/restaurant/models/restaurant.model.js';
import { QuickProduct } from '../../modules/quick-commerce/models/product.model.js';
import { QuickReview } from '../../modules/quick-commerce/models/review.model.js';
import { Seller } from '../../modules/quick-commerce/seller/models/seller.model.js';
import { FoodUser } from '../users/user.model.js';
import { ValidationError } from '../auth/errors.js';
import { logger } from '../../utils/logger.js';

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));

/**
 * rating = ratingSum / totalRatings, kept exact and updated atomically (no read-modify-write, so two people
 * rating at the same moment can never lose one). Documents that only have the old `rating` + `totalRatings`
 * continue from them: their sum is rating x totalRatings.
 */
export const bumpAverage = (Model, id, rating) =>
  Model.updateOne({ _id: id }, [
    {
      $set: {
        totalRatings: { $add: [{ $ifNull: ['$totalRatings', 0] }, 1] },
        ratingSum: {
          $add: [
            { $ifNull: ['$ratingSum', { $multiply: [{ $ifNull: ['$rating', 0] }, { $ifNull: ['$totalRatings', 0] }] }] },
            Number(rating),
          ],
        },
      },
    },
    { $set: { rating: { $round: [{ $divide: ['$ratingSum', '$totalRatings'] }, 1] } } },
  ]);

/**
 * Save the customer's rating of the items in a delivered order. Each rated item raises that dish's / product's
 * average, and the same rating raises the average of the restaurant / seller it belongs to. An item can be rated
 * once per order; already-rated items in the request are skipped. Mutates `order.ratings.items` (caller saves).
 *
 * @param {'food'|'quick'} orderKind  which kind of order document this is
 * @param {Array<{itemId, rating, comment?}>} items
 * @returns {Promise<Array>} the ratings saved now
 */
export async function rateOrderItems({ orderKind, order, userId, items }) {
  const lines = Array.isArray(order.items) ? order.items : [];
  const lineById = new Map(lines.map((l) => [String(l.itemId), l]));
  const done = new Set((order.ratings?.items || []).map((r) => String(r.itemId)));
  const user = await FoodUser.findById(userId).select('name').lean().catch(() => null);
  const saved = [];

  for (const input of Array.isArray(items) ? items : []) {
    const key = String(input?.itemId || '');
    const line = lineById.get(key);
    if (!line) throw new ValidationError('One of the rated items is not part of this order');
    if (done.has(key)) continue;
    const rating = Number(input.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new ValidationError('Each item rating must be a whole number from 1 to 5');
    }
    const itemType = orderKind === 'food' ? 'food' : (line.type === 'food' ? 'food' : 'quick');
    const ownerType = itemType === 'food' ? 'restaurant' : 'seller';
    const ownerRaw = orderKind === 'food' ? line.restaurantId || order.restaurantId : line.sourceId;
    if (!isId(key) || !isId(ownerRaw)) continue; // a line we cannot attach a rating to (old / free-text item)
    const comment = String(input.comment || '').trim().slice(0, 500);

    try {
      await OrderItemReview.create({
        orderKind,
        orderId: order._id,
        orderRef: String(order.order_id || order.orderId || ''),
        userId,
        userName: user?.name || 'Customer',
        itemType,
        itemId: key,
        itemName: line.name || '',
        itemImage: line.image || '',
        ownerType,
        ownerId: ownerRaw,
        rating,
        comment,
      });
    } catch (err) {
      if (err?.code === 11000) continue; // rated a moment ago (double tap / two devices)
      throw err;
    }

    const itemModel = itemType === 'food' ? FoodItem : QuickProduct;
    const ownerModel = ownerType === 'restaurant' ? FoodRestaurant : Seller;
    await Promise.all([bumpAverage(itemModel, key, rating), bumpAverage(ownerModel, ownerRaw, rating)]);

    if (itemType === 'quick') {
      // The product page's review list reads QuickReview, so the rating shows there too.
      await QuickReview.create({
        productId: key,
        userId,
        userName: user?.name || 'Customer',
        rating,
        comment,
        orderId: order._id,
        status: 'approved',
      }).catch((e) => logger.warn(`[Ratings] product review mirror failed: ${e?.message || e}`));
    }
    saved.push({ itemId: key, itemType, name: line.name || '', rating, comment, ratedAt: new Date() });
  }

  order.ratings = order.ratings || {};
  order.ratings.items = [...(order.ratings.items || []), ...saved];
  return saved;
}

/** Dish / product ratings received by one restaurant or seller: per-item averages + the latest reviews. */
export async function getOwnerRatings(ownerType, ownerId, { page = 1, limit = 20 } = {}) {
  const match = { ownerType, ownerId: new mongoose.Types.ObjectId(String(ownerId)) };
  const pg = Math.max(parseInt(page, 10) || 1, 1);
  const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const [items, reviews, total, owner] = await Promise.all([
    OrderItemReview.aggregate([
      { $match: match },
      { $group: { _id: '$itemId', name: { $last: '$itemName' }, image: { $last: '$itemImage' }, count: { $sum: 1 }, avg: { $avg: '$rating' }, latest: { $max: '$createdAt' } } },
      { $sort: { count: -1, avg: -1 } },
      { $limit: 200 },
    ]),
    OrderItemReview.find(match).sort({ createdAt: -1 }).skip((pg - 1) * lim).limit(lim).lean(),
    OrderItemReview.countDocuments(match),
    (ownerType === 'restaurant' ? FoodRestaurant : Seller).findById(ownerId).select('rating totalRatings').lean(),
  ]);
  return {
    summary: { average: Number(owner?.rating || 0), totalRatings: Number(owner?.totalRatings || 0) },
    items: items.map((i) => ({ itemId: String(i._id), name: i.name, image: i.image, count: i.count, average: Number(i.avg.toFixed(1)), latest: i.latest })),
    reviews: reviews.map((r) => ({ id: String(r._id), itemId: String(r.itemId), itemName: r.itemName, rating: r.rating, comment: r.comment, customerName: r.userName, orderRef: r.orderRef, createdAt: r.createdAt })),
    pagination: { total, page: pg, limit: lim, pages: Math.ceil(total / lim) || 1 },
  };
}
