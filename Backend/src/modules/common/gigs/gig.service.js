import mongoose from 'mongoose';
import { ValidationError } from '../../../core/auth/errors.js';
import { logger } from '../../../utils/logger.js';
import { FoodDeliveryPartner } from '../../food/delivery/models/deliveryPartner.model.js';
import { FoodDeliveryWallet } from '../../food/delivery/models/deliveryWallet.model.js';
import { DeliveryBonusTransaction } from '../../food/admin/models/deliveryBonusTransaction.model.js';
import { GIG_SERVICES, GigBooking, GigEarning, GigSlot } from './gig.model.js';

const IST_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Riders see (and may book) this many days ahead, starting today; booking itself opens from tomorrow. */
export const BOOKING_WINDOW_DAYS = 7;
/** A job accepted inside the hour may be delivered a little after it ends and still earns the extra. */
const DELIVERY_GRACE_MS = 45 * 60 * 1000;

// ---------- time helpers (India time) ----------------------------------------------------------
export const istDate = (at = new Date()) => new Date(new Date(at).getTime() + IST_MS).toISOString().slice(0, 10);
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const dayOfWeek = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
const atMinute = (date, minute) => new Date(Date.parse(`${date}T00:00:00Z`) + minute * 60000 - IST_MS);
const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const toId = (v) => new mongoose.Types.ObjectId(String(v));
const oid = (v) => {
  if (!mongoose.Types.ObjectId.isValid(String(v || ''))) throw new ValidationError('Invalid id');
  return toId(v);
};

const parseMinute = (v) => {
  if (typeof v === 'number') return v;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

// ---------- admin: slot templates --------------------------------------------------------------
const cleanSlotInput = (body = {}) => {
  const name = String(body.name || '').trim();
  if (!name) throw new ValidationError('Slot name is required');
  const services = [...new Set((body.services || []).filter((s) => GIG_SERVICES.includes(s)))];
  if (!services.length) throw new ValidationError('Pick at least one service');
  const days = [...new Set((body.days || []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  if (!days.length) throw new ValidationError('Pick at least one day');

  const timeSlots = (body.timeSlots || []).map((t) => {
    const startMin = parseMinute(t.start ?? t.startMin);
    const endMin = parseMinute(t.end ?? t.endMin);
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || startMin < 0 || endMin > 1440 || endMin <= startMin) {
      throw new ValidationError('Each time slot needs a valid start and a later end time');
    }
    const extraPerOrder = Number(t.extraPerOrder);
    const maxDrivers = Math.floor(Number(t.maxDrivers));
    if (!Number.isFinite(extraPerOrder) || extraPerOrder < 0) throw new ValidationError('Extra earning per order must be 0 or more');
    if (!Number.isFinite(maxDrivers) || maxDrivers < 1) throw new ValidationError('Max drivers must be at least 1');
    return { ...(t._id && mongoose.Types.ObjectId.isValid(t._id) ? { _id: t._id } : {}), startMin, endMin, extraPerOrder, maxDrivers };
  });
  if (!timeSlots.length) throw new ValidationError('Add at least one time slot');
  return { name, services, days, timeSlots, isActive: body.isActive !== false };
};

const overlaps = (a, b) => a.startMin < b.endMin && b.startMin < a.endMin;

/** No two time slots may share a day, a service and a stretch of time - inside one slot or across slots. */
const assertNoOverlap = async (input, ignoreId = null) => {
  const sorted = [...input.timeSlots].sort((a, b) => a.startMin - b.startMin);
  for (let i = 1; i < sorted.length; i += 1) {
    if (overlaps(sorted[i - 1], sorted[i])) {
      throw new ValidationError(`Time slots ${hhmm(sorted[i - 1].startMin)}-${hhmm(sorted[i - 1].endMin)} and ${hhmm(sorted[i].startMin)}-${hhmm(sorted[i].endMin)} overlap`);
    }
  }
  if (!input.isActive) return;
  const others = await GigSlot.find({
    isActive: true,
    days: { $in: input.days },
    services: { $in: input.services },
    ...(ignoreId ? { _id: { $ne: ignoreId } } : {}),
  }).lean();
  for (const other of others) {
    for (const mine of input.timeSlots) {
      const clash = other.timeSlots.find((t) => overlaps(mine, t));
      if (clash) {
        throw new ValidationError(`${hhmm(mine.startMin)}-${hhmm(mine.endMin)} overlaps "${other.name}" (${hhmm(clash.startMin)}-${hhmm(clash.endMin)}) on the same day and service`);
      }
    }
  }
};

export const listSlots = () => GigSlot.find().sort({ createdAt: -1 }).lean();

export const createSlot = async (body, adminId) => {
  const input = cleanSlotInput(body);
  await assertNoOverlap(input);
  return (await GigSlot.create({ ...input, createdByAdminId: adminId })).toObject();
};

export const updateSlot = async (id, body) => {
  const slot = await GigSlot.findById(oid(id));
  if (!slot) throw new ValidationError('Slot not found');
  const input = cleanSlotInput(body);
  await assertNoOverlap(input, slot._id);
  // A time slot that riders already booked (today or later) cannot vanish or change its hour.
  const booked = await GigBooking.find({ slotId: slot._id, status: 'booked', date: { $gte: istDate() } }).lean();
  for (const b of booked) {
    const kept = input.timeSlots.find((t) => String(t._id) === String(b.timeSlotId));
    if (!kept || kept.startMin !== b.startMin || kept.endMin !== b.endMin) {
      throw new ValidationError('A time slot with upcoming bookings cannot be removed or moved. Deactivate the slot instead.');
    }
  }
  slot.set(input);
  await slot.save();
  return slot.toObject();
};

export const deleteSlot = async (id) => {
  const slot = await GigSlot.findById(oid(id));
  if (!slot) throw new ValidationError('Slot not found');
  const hasBookings = await GigBooking.exists({ slotId: slot._id });
  if (hasBookings) {
    slot.isActive = false; // history (bookings, earnings) keeps pointing at it
    await slot.save();
    return { deleted: false, deactivated: true };
  }
  await slot.deleteOne();
  return { deleted: true };
};

// ---------- admin: bookings & earnings ---------------------------------------------------------
export const listBookings = async ({ date, service, partnerId, status, page = 1, limit = 50 } = {}) => {
  const filter = {};
  if (date && isDate(date)) filter.date = date;
  if (service && GIG_SERVICES.includes(service)) filter.services = service;
  if (partnerId && mongoose.Types.ObjectId.isValid(partnerId)) filter.partnerId = toId(partnerId);
  if (status) filter.status = status;
  const pageNo = Math.max(1, Number(page) || 1);
  const size = Math.min(200, Math.max(1, Number(limit) || 50));
  const [rows, total] = await Promise.all([
    GigBooking.find(filter).sort({ date: -1, startMin: 1 }).skip((pageNo - 1) * size).limit(size).lean(),
    GigBooking.countDocuments(filter),
  ]);
  const partners = await FoodDeliveryPartner.find({ _id: { $in: rows.map((r) => r.partnerId) } }).select('name phone').lean();
  const byId = new Map(partners.map((p) => [String(p._id), p]));
  return {
    total,
    page: pageNo,
    bookings: rows.map((r) => ({
      ...r,
      partnerName: byId.get(String(r.partnerId))?.name || '',
      partnerPhone: byId.get(String(r.partnerId))?.phone || '',
    })),
  };
};

export const earningsSummary = async ({ from, to } = {}) => {
  const match = {};
  if (isDate(from) || isDate(to)) {
    match.date = {};
    if (isDate(from)) match.date.$gte = from;
    if (isDate(to)) match.date.$lte = to;
  }
  const [totals, byService, recent] = await Promise.all([
    GigEarning.aggregate([{ $match: match }, { $group: { _id: null, amount: { $sum: '$amount' }, orders: { $sum: 1 } } }]),
    GigEarning.aggregate([{ $match: match }, { $group: { _id: '$service', amount: { $sum: '$amount' }, orders: { $sum: 1 } } }]),
    GigEarning.find(match).sort({ createdAt: -1 }).limit(50).lean(),
  ]);
  const partners = await FoodDeliveryPartner.find({ _id: { $in: recent.map((r) => r.partnerId) } }).select('name phone').lean();
  const byId = new Map(partners.map((p) => [String(p._id), p]));
  return {
    totalPaid: totals[0]?.amount || 0,
    totalOrders: totals[0]?.orders || 0,
    byService: byService.map((s) => ({ service: s._id, amount: s.amount, orders: s.orders })),
    recent: recent.map((r) => ({ ...r, partnerName: byId.get(String(r.partnerId))?.name || '' })),
  };
};

// ---------- rider: browse & book ---------------------------------------------------------------
const partnerServices = async (partnerId) => {
  const p = await FoodDeliveryPartner.findById(partnerId).select('deliveryServices').lean();
  const own = Array.isArray(p?.deliveryServices) ? p.deliveryServices : [];
  return own.length ? own.filter((s) => GIG_SERVICES.includes(s)) : [...GIG_SERVICES];
};

const bookingBlockReason = (date, today) => {
  if (date < today) return 'past';
  if (date === today) return 'same_day'; // must be booked at least one day before
  return null;
};

/** Slots (with live booked counts) the rider may see for one date. */
const buildDay = async (partnerId, date, services) => {
  const today = istDate();
  const slots = await GigSlot.find({ isActive: true, days: dayOfWeek(date), services: { $in: services } }).lean();
  const timeSlotIds = slots.flatMap((s) => s.timeSlots.map((t) => t._id));
  const [counts, mine] = await Promise.all([
    GigBooking.aggregate([
      { $match: { date, status: 'booked', timeSlotId: { $in: timeSlotIds } } },
      { $group: { _id: '$timeSlotId', n: { $sum: 1 } } },
    ]),
    GigBooking.find({ partnerId, date, status: 'booked' }).lean(),
  ]);
  const countBy = new Map(counts.map((c) => [String(c._id), c.n]));
  const mineBy = new Map(mine.map((b) => [String(b.timeSlotId), b]));
  const blocked = bookingBlockReason(date, today);

  const out = slots
    .map((slot) => ({
      slotId: slot._id,
      name: slot.name,
      services: slot.services,
      timeSlots: [...slot.timeSlots]
        .sort((a, b) => a.startMin - b.startMin)
        .map((t) => {
          const booked = countBy.get(String(t._id)) || 0;
          const myBooking = mineBy.get(String(t._id));
          const full = booked >= t.maxDrivers;
          return {
            timeSlotId: t._id,
            start: hhmm(t.startMin),
            end: hhmm(t.endMin),
            startMin: t.startMin,
            endMin: t.endMin,
            extraPerOrder: t.extraPerOrder,
            maxDrivers: t.maxDrivers,
            bookedCount: booked,
            remaining: Math.max(0, t.maxDrivers - booked),
            isFull: full,
            bookedByMe: Boolean(myBooking),
            bookingId: myBooking?._id || null,
            canBook: !blocked && !full && !myBooking,
          };
        }),
    }))
    .sort((a, b) => a.timeSlots[0].startMin - b.timeSlots[0].startMin);
  return { date, dayOfWeek: dayOfWeek(date), bookable: !blocked, blockedReason: blocked, slots: out };
};

export const riderDays = async (partnerId) => {
  const services = await partnerServices(partnerId);
  const today = istDate();
  const days = [];
  for (let i = 0; i < BOOKING_WINDOW_DAYS; i += 1) {
    const date = addDays(today, i);
    const day = await buildDay(partnerId, date, services);
    const all = day.slots.flatMap((s) => s.timeSlots);
    days.push({
      date,
      dayOfWeek: day.dayOfWeek,
      isToday: i === 0,
      bookable: day.bookable,
      blockedReason: day.blockedReason,
      slotCount: day.slots.length,
      openCount: all.filter((t) => t.canBook).length,
      myBookingCount: all.filter((t) => t.bookedByMe).length,
      status: !day.slots.length ? 'none' : !day.bookable ? 'closed' : all.some((t) => t.canBook) ? 'open' : 'full',
    });
  }
  return { today, days };
};

export const riderDay = async (partnerId, date) => {
  if (!isDate(date)) throw new ValidationError('Invalid date');
  const today = istDate();
  if (date < today || date > addDays(today, BOOKING_WINDOW_DAYS - 1)) throw new ValidationError('That date is outside the booking window');
  return buildDay(partnerId, date, await partnerServices(partnerId));
};

export const riderBook = async (partnerId, { date, timeSlotIds } = {}) => {
  if (!isDate(date)) throw new ValidationError('Invalid date');
  const today = istDate();
  if (date <= today) throw new ValidationError('Gigs must be booked at least one day before. Pick tomorrow or a later day.');
  if (date > addDays(today, BOOKING_WINDOW_DAYS - 1)) throw new ValidationError('That date is outside the booking window');
  const wanted = [...new Set((timeSlotIds || []).map(String))];
  if (!wanted.length) throw new ValidationError('Select at least one time slot');

  const services = await partnerServices(partnerId);
  const slots = await GigSlot.find({ isActive: true, days: dayOfWeek(date), 'timeSlots._id': { $in: wanted.map(oid) } }).lean();
  const picked = [];
  for (const id of wanted) {
    const slot = slots.find((s) => s.timeSlots.some((t) => String(t._id) === id));
    const ts = slot?.timeSlots.find((t) => String(t._id) === id);
    if (!slot || !ts) throw new ValidationError('A selected time slot is not available on this day');
    if (!slot.services.some((s) => services.includes(s))) throw new ValidationError(`"${slot.name}" is not for the services you work in`);
    picked.push({ slot, ts });
  }

  // The rider cannot be in two places: chosen hours must not clash with each other or with existing bookings.
  const existing = await GigBooking.find({ partnerId, date, status: 'booked' }).lean();
  const all = [...existing.map((b) => ({ startMin: b.startMin, endMin: b.endMin })), ...picked.map((p) => p.ts)];
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      if (overlaps(all[i], all[j])) throw new ValidationError('Your selected time slots overlap with another booking');
    }
  }

  const created = [];
  try {
    for (const { slot, ts } of picked) {
      // shortcut: count-then-insert can overshoot maxDrivers by one under a simultaneous race; use a counter doc if that matters.
      const taken = await GigBooking.countDocuments({ timeSlotId: ts._id, date, status: 'booked' });
      if (taken >= ts.maxDrivers) throw new ValidationError(`${hhmm(ts.startMin)}-${hhmm(ts.endMin)} is already full`);
      created.push(
        await GigBooking.create({
          partnerId,
          slotId: slot._id,
          timeSlotId: ts._id,
          date,
          slotName: slot.name,
          services: slot.services,
          startMin: ts.startMin,
          endMin: ts.endMin,
          startAt: atMinute(date, ts.startMin),
          endAt: atMinute(date, ts.endMin),
          extraPerOrder: ts.extraPerOrder,
        }),
      );
    }
  } catch (err) {
    // All or nothing: undo what this request already booked.
    if (created.length) await GigBooking.deleteMany({ _id: { $in: created.map((c) => c._id) } });
    if (err?.code === 11000) throw new ValidationError('You have already booked one of these time slots');
    throw err;
  }
  return { bookings: created.map((c) => c.toObject()) };
};

export const riderCancel = async (partnerId, bookingId) => {
  const booking = await GigBooking.findOne({ _id: oid(bookingId), partnerId, status: 'booked' });
  if (!booking) throw new ValidationError('Booking not found');
  if (booking.date <= istDate()) throw new ValidationError('A gig can only be cancelled until the day before it starts');
  booking.status = 'cancelled';
  await booking.save();
  return { cancelled: true };
};

export const riderBookings = async (partnerId, { upcomingOnly = false } = {}) => {
  const filter = { partnerId, status: 'booked', ...(upcomingOnly ? { date: { $gte: istDate() } } : {}) };
  const [bookings, earned, recent] = await Promise.all([
    GigBooking.find(filter).sort({ date: -1, startMin: 1 }).limit(100).lean(),
    GigEarning.aggregate([{ $match: { partnerId: toId(partnerId) } }, { $group: { _id: null, amount: { $sum: '$amount' }, orders: { $sum: 1 } } }]),
    GigEarning.find({ partnerId: toId(partnerId) }).sort({ createdAt: -1 }).limit(10).select('service amount slotName orderRef createdAt').lean(),
  ]);
  return {
    recentEarnings: recent,
    bookings: bookings.map((b) => ({ ...b, start: hhmm(b.startMin), end: hhmm(b.endMin) })),
    totalGigEarnings: earned[0]?.amount || 0,
    totalGigOrders: earned[0]?.orders || 0,
  };
};

// ---------- dispatch gate ----------------------------------------------------------------------
/**
 * A rider with a gig booked for today may only work inside the booked hour(s), and only for the
 * services of that slot. A rider with no booking today is not restricted at all.
 * Returns the Set of partner ids (as strings) that may take a `service` job right now.
 */
export const eligiblePartnerIds = async (partnerIds = [], service = 'food', now = new Date(), at = null) => {
  const ids = partnerIds.map((p) => String(p)).filter((p) => mongoose.Types.ObjectId.isValid(p));
  // A scheduled job is for riders who booked the gig that covers its scheduled time - only them.
  if (at) {
    const booked = await gigPartnerIdsForTime(service, at);
    return new Set(ids.filter((id) => booked.has(id)));
  }
  const rows = ids.length
    ? await GigBooking.find({ partnerId: { $in: ids.map(toId) }, date: istDate(now), status: 'booked' })
        .select('partnerId services startAt endAt')
        .lean()
    : [];
  const restricted = new Map();
  for (const r of rows) {
    const key = String(r.partnerId);
    const open = r.startAt <= now && now <= r.endAt && r.services.includes(service);
    restricted.set(key, restricted.get(key) || open);
  }
  return new Set(ids.filter((id) => !restricted.has(id) || restricted.get(id)));
};

/** Riders (ids, as strings) who booked a gig that covers `at` for `service`. */
export const gigPartnerIdsForTime = async (service, at) => {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return new Set();
  const rows = await GigBooking.find({ status: 'booked', services: service, startAt: { $lte: when }, endAt: { $gt: when } })
    .select('partnerId')
    .lean();
  return new Set(rows.map((r) => String(r.partnerId)));
};

/** The windows (from now on) a rider booked for a service - used to list only the scheduled jobs they may take. */
export const riderGigWindows = async (partnerId, service) => {
  if (!mongoose.Types.ObjectId.isValid(String(partnerId))) return [];
  const rows = await GigBooking.find({ partnerId: toId(partnerId), status: 'booked', services: service, endAt: { $gte: new Date() } })
    .select('startAt endAt')
    .lean();
  return rows.map((r) => ({ startAt: r.startAt, endAt: r.endAt }));
};

/** Dispatch-path filter (same shape-preserving contract as the order-capacity filter). Fails open. */
export const filterPartnersByGig = async (partners = [], service = 'food', { at = null } = {}) => {
  if (!Array.isArray(partners) || partners.length === 0) return partners;
  try {
    const allowed = await eligiblePartnerIds(partners.map((p) => p?.partnerId || p?._id), service, new Date(), at);
    return partners.filter((p) => allowed.has(String(p?.partnerId || p?._id)));
  } catch (err) {
    logger.warn(`[Gigs] gig filter failed, passing candidates through: ${err?.message || err}`);
    return partners;
  }
};

export const GIG_SCHEDULED_MESSAGE = 'This scheduled order is only for riders who booked the gig slot that covers its time.';
export const GIG_BLOCKED_MESSAGE = 'You have a gig booked today. You can take orders only during your booked time slots.';

/** Accept-path guard; throws when a gig rider tries to take a job outside the booked window. Fails open. */
export const assertGigAllowsService = async (partnerId, service = 'food', { at = null } = {}) => {
  let allowed = true;
  try {
    allowed = (await eligiblePartnerIds([partnerId], service, new Date(), at)).has(String(partnerId));
  } catch (err) {
    logger.warn(`[Gigs] gig guard failed, allowing: ${err?.message || err}`);
  }
  if (!allowed) throw new ValidationError(at ? GIG_SCHEDULED_MESSAGE : GIG_BLOCKED_MESSAGE);
};

// ---------- earnings ---------------------------------------------------------------------------
/**
 * Called when a rider finishes an order/ride. If a gig booking covers that moment the rider gets the
 * hour's extra: added to their wallet and bonus history, and recorded as a gig payout (deducted from
 * the admin's earnings in the gig report). Safe to call twice for the same order. Never throws.
 */
export const recordGigEarning = async ({ partnerId, service, orderRef, at = new Date() }) => {
  try {
    if (!partnerId || !orderRef || !GIG_SERVICES.includes(service)) return null;
    const when = new Date(at);
    const booking = await GigBooking.findOne({
      partnerId: toId(partnerId),
      status: 'booked',
      services: service,
      startAt: { $lte: when },
      endAt: { $gte: new Date(when.getTime() - DELIVERY_GRACE_MS) },
    }).sort({ startAt: -1 });
    if (!booking || !(booking.extraPerOrder > 0)) return null;

    let earning;
    try {
      earning = await GigEarning.create({
        bookingId: booking._id,
        partnerId: booking.partnerId,
        service,
        orderRef: String(orderRef),
        amount: booking.extraPerOrder,
        slotName: booking.slotName,
        date: booking.date,
      });
    } catch (err) {
      if (err?.code === 11000) return null; // already paid for this order
      throw err;
    }

    await GigBooking.updateOne({ _id: booking._id }, { $inc: { ordersCount: 1, extraEarned: booking.extraPerOrder } });
    await FoodDeliveryWallet.findOneAndUpdate(
      { deliveryPartnerId: booking.partnerId },
      { $inc: { balance: booking.extraPerOrder, totalBonus: booking.extraPerOrder } },
      { upsert: true },
    );
    await DeliveryBonusTransaction.create({
      deliveryPartnerId: booking.partnerId,
      transactionId: `GIG-${String(earning._id).slice(-8).toUpperCase()}-${Date.now().toString().slice(-4)}`,
      amount: booking.extraPerOrder,
      reference: `Gig extra: ${booking.slotName} ${hhmm(booking.startMin)}-${hhmm(booking.endMin)} (${service} order ${orderRef})`,
    });
    // Tell the rider: the extra is already in their wallet, this makes it visible right away.
    try {
      const { notifyOwnerSafely } = await import('../../food/orders/services/order.helpers.js');
      void notifyOwnerSafely(
        { ownerType: 'DELIVERY_PARTNER', ownerId: String(booking.partnerId) },
        {
          title: 'Gig bonus added',
          body: `Rs ${booking.extraPerOrder} extra added for your ${booking.slotName} gig order.`,
          data: { type: 'gig_bonus', amount: String(booking.extraPerOrder), orderRef: String(orderRef) },
        },
      ).catch(() => {});
    } catch {
      /* the push is a nicety; the money is already credited */
    }
    return earning.toObject();
  } catch (err) {
    logger.warn(`[Gigs] could not record gig earning for ${service} ${orderRef}: ${err?.message || err}`);
    return null;
  }
};

/** Total gig extras paid for one service (optionally inside a date range): deducted from that service's admin earning. */
export const gigPayoutTotal = async (service, range = null) => {
  try {
    const match = { service };
    if (range?.start) match.createdAt = { ...match.createdAt, $gte: new Date(range.start) };
    if (range?.end) match.createdAt = { ...match.createdAt, $lte: new Date(range.end) };
    const rows = await GigEarning.aggregate([{ $match: match }, { $group: { _id: null, amount: { $sum: '$amount' } } }]);
    return Number(rows[0]?.amount || 0);
  } catch (err) {
    logger.warn(`[Gigs] payout total failed: ${err?.message || err}`);
    return 0;
  }
};
