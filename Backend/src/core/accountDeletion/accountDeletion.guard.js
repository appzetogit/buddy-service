import mongoose from 'mongoose';
import { FoodOrder } from '../../modules/food/orders/models/order.model.js';
import { QuickOrder } from '../../modules/quick-commerce/models/quickOrder.model.js';
import { SellerOrder } from '../../modules/quick-commerce/seller/models/sellerOrder.model.js';
import { Ride } from '../../modules/taxi/user/models/Ride.js';
import { ConflictError } from '../auth/errors.js';
import { getRiderCashSummary } from '../../modules/food/delivery/services/riderCash.service.js';
import { notifyOwnersSafely } from '../../modules/food/orders/services/order.helpers.js';
import { logger } from '../../utils/logger.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const ORDER_DONE = [
  'delivered', 'cancelled', 'completed', 'cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin',
  'rejected_by_restaurant', 'payment_failed', 'refunded',
];
const SELLER_DONE = ['delivered', 'cancelled'];
const RIDE_ACTIVE = ['searching', 'accepted', 'ongoing'];

const busy = (what) => {
  throw new ConflictError(`You still have an active ${what}. Please finish or cancel it first, then delete your account.`);
};

/**
 * An account with work in progress cannot be deleted (the other side would be left hanging).
 * @param {'USER'|'RESTAURANT'|'SELLER'|'DRIVER'} type
 */
export async function assertCanDeleteAccount(type, id) {
  const _id = oid(id);
  const active = { $nin: ORDER_DONE };
  if (type === 'USER') {
    if (await FoodOrder.exists({ userId: _id, orderStatus: active })) busy('food order');
    if (await QuickOrder.exists({ userId: _id, orderStatus: active })) busy('Marketplace order');
    if (await Ride.exists({ userId: _id, status: { $in: RIDE_ACTIVE } })) busy('taxi ride or parcel booking');
  } else if (type === 'RESTAURANT') {
    if (await FoodOrder.exists({ $or: [{ restaurantId: _id }, { 'pickups.restaurantId': _id }], orderStatus: active })) busy('order');
  } else if (type === 'SELLER') {
    if (await SellerOrder.exists({ sellerId: _id, status: { $nin: SELLER_DONE } })) busy('order');
  } else if (type === 'DRIVER') {
    if (await FoodOrder.exists({ 'dispatch.deliveryPartnerId': _id, orderStatus: active })) busy('delivery');
    if (await QuickOrder.exists({ 'dispatch.deliveryPartnerId': _id, orderStatus: active })) busy('Marketplace delivery');
    if (await Ride.exists({ driverId: _id, status: { $in: RIDE_ACTIVE } })) busy('taxi ride or parcel job');
    // Cash the rider is holding belongs to the company: it has to be deposited first.
    const cash = await getRiderCashSummary(String(id)).catch(() => null);
    const holding = Number(cash?.cashInHand || 0) + Number(cash?.pendingCash || 0);
    if (holding > 0) {
      throw new ConflictError(`You are holding cash of Rs ${holding.toFixed(2)}. Please deposit it first, then delete your account.`);
    }
  }
}

const LABEL = { USER: 'Customer', RESTAURANT: 'Restaurant', SELLER: 'Seller', DELIVERY_PARTNER: 'Driver', DRIVER: 'Driver' };

/** Tell the admin panel (bell + push) that an account was deleted. Never throws. */
export async function announceAccountDeleted({ type, name, phone, reason, source = 'self' }) {
  try {
    await notifyOwnersSafely([{ ownerType: 'ADMIN', ownerId: 'GLOBAL' }], {
      title: `${LABEL[type] || 'Account'} account deleted`,
      body: `${name || 'Unknown'}${phone ? ` (${phone})` : ''} ${source === 'admin' ? 'was deleted by an admin' : 'deleted their account'}${reason ? `: ${reason}` : '.'}`,
      data: { type: 'account_deleted', accountType: String(type) },
    });
  } catch (err) {
    logger.warn(`[AccountDeletion] admin notification failed: ${err?.message || err}`);
  }
}
