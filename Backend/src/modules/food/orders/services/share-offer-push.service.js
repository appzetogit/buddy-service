import { FoodOrder } from '../models/order.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { notifyOwnersSafely } from '../../../../core/notifications/firebase.service.js';
import { logger } from '../../../../utils/logger.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { buildDeliverySocketPayload, buildOfferPushData } from './order.helpers.js';

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
  const online = await FoodDeliveryPartner.find({ status: 'approved', availabilityStatus: 'online' })
    .select('_id zone')
    .lean();
  const inZone = zoneId
    ? online.filter((p) => !p.zone || String(p.zone) === String(zoneId))
    : online;
  const targets = inZone
    .map((p) => String(p._id))
    .filter((id) => !excluded.has(id))
    .slice(0, MAX_TARGETS)
    .map((ownerId) => ({ ownerType: 'DELIVERY_PARTNER', ownerId }));

  // Always logged, so "nobody got the request" can be traced to the filter that
  // emptied the list.
  logger.info(
    `Second-driver request ${order._id}: online=${online.length} inZone=${inZone.length} ` +
      `busyOrSelf=${inZone.length - inZone.filter((p) => !excluded.has(String(p._id))).length} ` +
      `pushingTo=${targets.length}`,
  );
  if (targets.length === 0) return 0;

  // The share flow loads the order unpopulated; without the restaurant the card
  // has no pickup name or address.
  const restaurant = await FoodRestaurant.findById(order.restaurantId?._id || order.restaurantId)
    .select('restaurantName name address phone location addressLine1')
    .lean();
  const p = buildDeliverySocketPayload(order, restaurant);
  const code = order.order_id || String(order._id);
  await notifyOwnersSafely(targets, {
    title: 'Second driver needed!',
    body: `Join Order #${code} and share the delivery with another partner.`,
    ring: true,
    sendToAllDevices: true,
    data: {
      ...buildOfferPushData(p),
      isShared: 'true',
      sharedFrom: String(sharedFromId),
      zoneId: zoneId ? String(zoneId) : '',
    },
  });
  return targets.length;
}
