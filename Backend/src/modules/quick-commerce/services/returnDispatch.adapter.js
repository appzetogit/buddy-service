import { FoodDeliveryPartner } from '../../food/delivery/models/deliveryPartner.model.js';
import { getIO, rooms } from '../../../config/socket.js';
import { logger } from '../../../utils/logger.js';
import {
  loadReturnPickupContext,
  buildReturnDeliverySocketPayload,
} from '../utils/returnPickup.helpers.js';

/**
 * Re-offers an in-progress return pickup to the riders it was already offered to
 * (used when a return document is touched while a dispatch offer is still live).
 *
 * ponytail: no cash-collection-limit filtering here (Buddy's Food dispatch doesn't
 * have that feature) — upgrade if QC return pickups need cash-limit gating too.
 */
const ACTIVE_OFFER_ACTIONS = new Set(['offered', 'assigned']);

const getActiveOfferedPartnerIds = (offeredTo = []) =>
  (Array.isArray(offeredTo) ? offeredTo : [])
    .filter((entry) => ACTIVE_OFFER_ACTIONS.has(String(entry?.action || 'offered')))
    .map((entry) => String(entry?.partnerId || ''))
    .filter(Boolean);

const loadOnlinePartnersByIds = async (partnerIds = []) => {
  const uniqueIds = [...new Set(partnerIds.map((id) => String(id)).filter(Boolean))];
  if (!uniqueIds.length) return [];

  const allowedStatuses =
    process.env.NODE_ENV === 'production' ? ['approved'] : ['approved', 'pending'];
  const rows = await FoodDeliveryPartner.find({
    _id: { $in: uniqueIds },
    availabilityStatus: 'online',
    status: { $in: allowedStatuses },
  })
    .select('_id status')
    .lean();

  return rows.map((p) => ({ partnerId: p._id, distanceKm: null, status: p.status }));
};

const emitDispatchOffer = (io, roomName, payload) => {
  if (!io || !roomName) return;
  io.to(roomName).emit('new_order_available', payload);
  io.to(roomName).emit('play_notification_sound', {
    audience: 'delivery',
    type: 'new_order_available',
    documentType: payload.documentType,
    returnId: payload.returnId,
  });
};

export const renotifyExistingReturnPickupOffers = async (returnDoc, { context = null } = {}) => {
  const activeIds = getActiveOfferedPartnerIds(returnDoc?.dispatch?.offeredTo);
  if (!activeIds.length) {
    return { notifiedCount: 0, socketEmitCount: 0, partnerPoolCount: 0, partnerIds: [] };
  }

  const partners = await loadOnlinePartnersByIds(activeIds);
  if (!partners.length) {
    return { notifiedCount: 0, socketEmitCount: 0, partnerPoolCount: 0, partnerIds: activeIds };
  }

  const ctx = context || (await loadReturnPickupContext(returnDoc));
  const payload = await buildReturnDeliverySocketPayload(returnDoc, ctx);
  const io = getIO();
  let socketEmitCount = 0;

  for (const p of partners) {
    const roomName = rooms.delivery(p.partnerId);
    if (io) {
      emitDispatchOffer(io, roomName, { ...payload, pickupDistanceKm: p.distanceKm });
      socketEmitCount += 1;
    }
  }

  logger.info(
    `[QC ReturnDispatch] renotify returnId=${returnDoc?._id} activeOffers=${activeIds.length} partnerPool=${partners.length} socketEmitCount=${socketEmitCount}`,
  );

  return {
    notifiedCount: partners.length,
    socketEmitCount,
    partnerPoolCount: partners.length,
    renotifiedCount: partners.length,
    partnerIds: partners.map((p) => String(p.partnerId)),
  };
};
