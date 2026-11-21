import mongoose from 'mongoose';
import { ValidationError } from '../../../core/auth/errors.js';
import { FoodDeliveryPartner } from '../../food/delivery/models/deliveryPartner.model.js';
import { FoodOrder } from '../../food/orders/models/order.model.js';
import { QuickOrder } from '../../quick-commerce/models/quickOrder.model.js';
import { Ride } from '../../taxi/user/models/Ride.js';
import { getSellerVisibleQuickOrderPaymentFilter } from '../../quick-commerce/utils/sellerOrderVisibility.helpers.js';
import { GIG_SERVICES } from './gig.model.js';
import { gigPartnerIdsForTime } from './gig.service.js';

/**
 * Scheduled orders / rides and gigs.
 *
 * A scheduled job goes only to riders who booked a gig covering its time. When nobody did (or no such
 * rider can take it) it waits here for the admin, who picks a rider by hand. This is the admin-side
 * view of that: what is waiting, who can be assigned, and the assignment itself for all three services.
 */

const oid = (v) => {
  if (!mongoose.Types.ObjectId.isValid(String(v || ''))) throw new ValidationError('Invalid id');
  return new mongoose.Types.ObjectId(String(v));
};
const ACTIVE_FOOD = ['scheduled', 'created', 'confirmed', 'preparing', 'ready_for_pickup'];
const ACTIVE_QUICK = ['scheduled', 'placed', 'created', 'confirmed', 'preparing', 'ready_for_pickup'];
const noRider = [{ 'dispatch.deliveryPartnerId': null }, { 'dispatch.deliveryPartnerId': { $exists: false } }];

/** Gig riders per (service, minute) so a long list does not query once per row. */
const makeCoverage = () => {
  const cache = new Map();
  return async (service, at) => {
    const key = `${service}:${Math.floor(new Date(at).getTime() / 60000)}`;
    if (!cache.has(key)) cache.set(key, await gigPartnerIdsForTime(service, at));
    return cache.get(key);
  };
};

const nameMap = async (ids) => {
  const clean = ids.filter(Boolean);
  if (!clean.length) return new Map();
  const rows = await FoodDeliveryPartner.find({ _id: { $in: clean } }).select('name phone').lean();
  return new Map(rows.map((r) => [String(r._id), r]));
};

export const listScheduledPending = async ({ service } = {}) => {
  const wanted = GIG_SERVICES.includes(service) ? [service] : GIG_SERVICES;
  const coverage = makeCoverage();
  const items = [];

  if (wanted.includes('food')) {
    const rows = await FoodOrder.find({
      scheduledAt: { $ne: null },
      fulfillment: { $ne: 'pickup' },
      orderStatus: { $in: ACTIVE_FOOD },
      'payment.status': { $ne: 'failed' },
      $or: noRider,
    })
      .select('order_id scheduledAt orderStatus zoneId restaurantId userId deliveryAddress dispatch')
      .populate('restaurantId', 'restaurantName name')
      .populate('userId', 'name phone')
      .populate('zoneId', 'name zoneName')
      .sort({ scheduledAt: 1 })
      .limit(200)
      .lean();
    const pre = await nameMap(rows.map((r) => r.dispatch?.preassignedPartnerId));
    for (const r of rows) {
      const riders = await coverage('food', r.scheduledAt);
      items.push({
        service: 'food',
        id: String(r._id),
        ref: r.order_id || String(r._id),
        scheduledAt: r.scheduledAt,
        status: r.orderStatus,
        zone: r.zoneId?.name || r.zoneId?.zoneName || '',
        customer: r.userId?.name || '',
        customerPhone: r.userId?.phone || '',
        from: r.restaurantId?.restaurantName || r.restaurantId?.name || '',
        to: [r.deliveryAddress?.street, r.deliveryAddress?.city].filter(Boolean).join(', '),
        gigRiders: riders.size,
        parked: Boolean(r.dispatch?.needsAdminAssign),
        preassigned: r.dispatch?.preassignedPartnerId ? pre.get(String(r.dispatch.preassignedPartnerId))?.name || 'Rider' : '',
      });
    }
  }

  if (wanted.includes('quickCommerce')) {
    const rows = await QuickOrder.find({
      scheduledAt: { $ne: null },
      orderStatus: { $in: ACTIVE_QUICK },
      ...getSellerVisibleQuickOrderPaymentFilter(),
      $or: noRider,
    })
      .select('orderId scheduledAt orderStatus userId items dispatch deliveryAddress')
      .populate('userId', 'name phone')
      .sort({ scheduledAt: 1 })
      .limit(200)
      .lean();
    const pre = await nameMap(rows.map((r) => r.dispatch?.preassignedPartnerId));
    for (const r of rows) {
      const riders = await coverage('quickCommerce', r.scheduledAt);
      const sellers = [...new Set((r.items || []).map((i) => i?.sourceName).filter(Boolean))];
      items.push({
        service: 'quickCommerce',
        id: String(r._id),
        ref: r.orderId || String(r._id),
        scheduledAt: r.scheduledAt,
        status: r.orderStatus,
        zone: '',
        customer: r.userId?.name || '',
        customerPhone: r.userId?.phone || '',
        from: sellers.join(', '),
        to: [r.deliveryAddress?.street, r.deliveryAddress?.city].filter(Boolean).join(', '),
        gigRiders: riders.size,
        parked: Boolean(r.dispatch?.needsAdminAssign),
        preassigned: r.dispatch?.preassignedPartnerId ? pre.get(String(r.dispatch.preassignedPartnerId))?.name || 'Rider' : '',
      });
    }
  }

  if (wanted.includes('taxi')) {
    const rows = await Ride.find({
      scheduledAt: { $gte: new Date(Date.now() - 20 * 60 * 1000) },
      status: 'searching',
      driverId: null,
      bookingSource: { $ne: 'website' },
    })
      .select('scheduledAt pickupAddress dropAddress serviceType userId adminAssign')
      .populate('userId', 'name phone')
      .sort({ scheduledAt: 1 })
      .limit(200)
      .lean();
    for (const r of rows) {
      const riders = await coverage('taxi', r.scheduledAt);
      items.push({
        service: 'taxi',
        id: String(r._id),
        ref: String(r._id).slice(-8).toUpperCase(),
        scheduledAt: r.scheduledAt,
        status: 'searching',
        zone: '',
        customer: r.userId?.name || '',
        customerPhone: r.userId?.phone || '',
        from: typeof r.pickupAddress === 'string' ? r.pickupAddress : r.pickupAddress?.address || '',
        to: typeof r.dropAddress === 'string' ? r.dropAddress : r.dropAddress?.address || '',
        gigRiders: riders.size,
        parked: Boolean(r.adminAssign?.required),
        preassigned: '',
      });
    }
  }

  items.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  return {
    items: items.map((i) => ({ ...i, needsAttention: i.parked || i.gigRiders === 0 })),
    needsAttention: items.filter((i) => i.parked || i.gigRiders === 0).length,
  };
};

/** Approved riders who work in `service`, gig-booked ones first. Food orders are limited to the order's zone. */
export const listAssignableDrivers = async ({ service, id }) => {
  if (!GIG_SERVICES.includes(service)) throw new ValidationError('Unknown service');
  let scheduledAt = null;
  let zoneId = null;
  if (service === 'food') {
    const o = await FoodOrder.findById(oid(id)).select('scheduledAt zoneId').lean();
    if (!o) throw new ValidationError('Order not found');
    scheduledAt = o.scheduledAt;
    zoneId = o.zoneId || null;
  } else if (service === 'quickCommerce') {
    const o = await QuickOrder.findById(oid(id)).select('scheduledAt').lean();
    if (!o) throw new ValidationError('Order not found');
    scheduledAt = o.scheduledAt;
  } else {
    const r = await Ride.findById(oid(id)).select('scheduledAt').lean();
    if (!r) throw new ValidationError('Ride not found');
    scheduledAt = r.scheduledAt;
  }

  const usable = service === 'quickCommerce' ? { $or: [{ status: 'approved' }, { isVerified: true }] } : { status: 'approved' };
  const worksIn = service === 'taxi'
    ? { deliveryServices: 'taxi' }
    : { $or: [{ deliveryServices: null }, { deliveryServices: { $size: 0 } }, { deliveryServices: service }] };
  const filter = { $and: [usable, worksIn, ...(zoneId ? [{ zone: zoneId }] : [])] };
  const partners = await FoodDeliveryPartner.find(filter)
    .select('name phone availabilityStatus vehicleType vehicleNumber zone')
    .populate('zone', 'name zoneName')
    .limit(300)
    .lean();
  const booked = scheduledAt ? await gigPartnerIdsForTime(service, scheduledAt) : new Set();
  const drivers = partners
    .map((p) => ({
      _id: String(p._id),
      name: p.name || 'Delivery Partner',
      phone: p.phone || '',
      online: p.availabilityStatus === 'online',
      vehicle: [p.vehicleType, p.vehicleNumber].filter(Boolean).join(' · '),
      zone: p.zone?.name || p.zone?.zoneName || '',
      gigBooked: booked.has(String(p._id)),
    }))
    .sort((a, b) => Number(b.gigBooked) - Number(a.gigBooked) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  return { scheduledAt, zoneFiltered: Boolean(zoneId), drivers };
};

export const adminAssignScheduled = async ({ service, id, driverId }, adminId) => {
  if (!GIG_SERVICES.includes(service)) throw new ValidationError('Unknown service');
  const partner = await FoodDeliveryPartner.findById(oid(driverId)).select('status isVerified name').lean();
  if (!partner || !(partner.status === 'approved' || (service === 'quickCommerce' && partner.isVerified === true))) {
    throw new ValidationError('Delivery partner not available');
  }

  if (service === 'food') {
    const order = await FoodOrder.findById(oid(id)).select('orderStatus').lean();
    if (!order) throw new ValidationError('Order not found');
    if (order.orderStatus === 'scheduled') {
      // Not live yet: remember the pick; it is handed over the moment the order activates.
      await FoodOrder.collection.updateOne({ _id: oid(id) }, { $set: { 'dispatch.preassignedPartnerId': oid(driverId), 'dispatch.needsAdminAssign': false } });
      return { mode: 'preassigned', message: `${partner.name || 'Rider'} will get this order when it goes live.` };
    }
    const { assignDeliveryPartnerAdmin } = await import('../../food/orders/services/order.service.js');
    await assignDeliveryPartnerAdmin(id, driverId, adminId);
    return { mode: 'assigned', message: `Assigned to ${partner.name || 'rider'}.` };
  }

  if (service === 'quickCommerce') {
    const order = await QuickOrder.findById(oid(id)).select('orderStatus').lean();
    if (!order) throw new ValidationError('Order not found');
    if (order.orderStatus === 'scheduled') {
      await QuickOrder.collection.updateOne({ _id: oid(id) }, { $set: { 'dispatch.preassignedPartnerId': oid(driverId), 'dispatch.needsAdminAssign': false } });
      return { mode: 'preassigned', message: `${partner.name || 'Rider'} will get this order when it goes live.` };
    }
    const { adminAssignQuickRider } = await import('../../quick-commerce/services/quickOrderFlows.service.js');
    await adminAssignQuickRider(id, driverId, adminId);
    return { mode: 'assigned', message: `Assigned to ${partner.name || 'rider'}.` };
  }

  // taxi: the driver accepts the ride on the spot (scheduled trips are held for them until due).
  const { adminAssignRideToDriver, getRideRoom } = await import('../../taxi/services/rideService.js');
  const { notifyRideAccepted, getSocketServer, stopDispatchFlow } = await import('../../taxi/services/dispatchService.js');
  stopDispatchFlow?.(id);
  const accepted = await adminAssignRideToDriver({ rideId: id, driverId });
  getSocketServer()?.in(`taxi:driver:${driverId}`).socketsJoin(getRideRoom(accepted._id));
  await notifyRideAccepted(accepted);
  return { mode: 'assigned', message: `Assigned to ${partner.name || 'driver'}.` };
};
