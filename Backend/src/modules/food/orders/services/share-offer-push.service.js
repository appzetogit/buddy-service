import { FoodOrder } from '../models/order.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { notifyOwnersSafely } from '../../../../core/notifications/firebase.service.js';
import { logger } from '../../../../utils/logger.js';
import { buildDeliverySocketPayload } from './order.helpers.js';

/** Orders whose riders are busy and must not be offered a second trip. */
const ACTIVE_ORDER_STATUSES = [
  'confirmed',
  'preparing',
  'ready_for_pickup',
  'reached_pickup',
  'picked_up',
  'reached_drop',
];

/** Upper bound on riders rung for one second-driver request. */
const MAX_TARGETS = 50;

/**
 * Push a "second driver needed" offer to free riders.
 *
 * The `shareable_order_available` socket broadcast only reaches riders whose app is
 * open; a rider with the app backgrounded or killed never heard about the request.
 * This sends the same offer as an FCM ring push (`type: 'new_order'` +
 * `isShared: 'true'`) so the rider app's native alert shows it, and accepting it
 * goes through `accept-share`.
 *
 * Targets: approved riders who are online, in the order's zone (or zone-less), and
 * not already on an active trip — never the rider who opened the request.
 */
export async function pushShareableOrder(order, sharedFromId) {
  const busy = await FoodOrder.find({
    orderStatus: { $in: ACTIVE_ORDER_STATUSES },
    'dispatch.status': 'accepted',
  })
    .select('dispatch.deliveryPartnerId dispatch.sharedPartnerId')
    .lean();
  const excluded = new Set(
    busy
      .flatMap((o) => [o.dispatch?.deliveryPartnerId, o.dispatch?.sharedPartnerId])
      .filter(Boolean)
      .map(String),
  );
  excluded.add(String(sharedFromId));

  const zoneId = order.zoneId?._id || order.zoneId;
  const filter = { status: 'approved', availabilityStatus: 'online' };
  if (zoneId) filter.$or = [{ zone: zoneId }, { zone: null }, { zone: { $exists: false } }];

  const partners = await FoodDeliveryPartner.find(filter).select('_id').limit(MAX_TARGETS * 4).lean();
  const targets = partners
    .map((p) => String(p._id))
    .filter((id) => !excluded.has(id))
    .slice(0, MAX_TARGETS)
    .map((ownerId) => ({ ownerType: 'DELIVERY_PARTNER', ownerId }));
  if (targets.length === 0) return 0;

  const p = buildDeliverySocketPayload(order, order.restaurantId);
  const code = order.order_id || String(order._id);
  await notifyOwnersSafely(targets, {
    title: 'Second driver needed!',
    body: `Join Order #${code} and share the delivery with another partner.`,
    ring: true,
    sendToAllDevices: true,
    // FCM data values must be strings; these are the fields the rider app's native
    // alert renders.
    data: {
      type: 'new_order',
      isShared: 'true',
      orderId: String(order._id),
      orderMongoId: String(order._id),
      sharedFrom: String(sharedFromId),
      restaurantName: String(p.restaurantName || ''),
      restaurantAddress: String(p.restaurantAddress || ''),
      customerAddress: String(p.customerAddress || ''),
      riderEarning: String(p.riderEarning ?? ''),
      paymentMethod: String(p.paymentMethod || ''),
      zoneId: zoneId ? String(zoneId) : '',
    },
  });
  logger.info(`Second-driver request for ${order._id} pushed to ${targets.length} rider(s).`);
  return targets.length;
}
