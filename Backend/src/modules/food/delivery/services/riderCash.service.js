import mongoose from 'mongoose';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { riderOrders } from './riderOrderSources.js';
import { FoodDeliveryCashDeposit } from '../models/foodDeliveryCashDeposit.model.js';
import { FoodDeliveryPartner } from '../models/deliveryPartner.model.js';
import { FoodDeliveryCashLimit } from '../../admin/models/deliveryCashLimit.model.js';

/**
 * ONE source of truth for a rider's cash: how much cash is in their hand, how much is still on the
 * way, the admin's limit and what is left. Food, Marketplace (QC) and Taxi all go through the unified
 * `riderOrders` view, and a COD-with-advance order/ride only counts its REMAINING cash. Dispatch, the
 * accept guards, the rider app and every admin screen use this, so they can never disagree.
 *
 *   cashInHand  = cash collected on delivered orders/rides - Completed deposits (never below 0)
 *   pendingCash = cash due on orders/rides the rider holds but has not delivered yet
 *   available   = limit > 0 ? max(0, limit - cashInHand - pendingCash) : null (no cap)
 *   blocked     = limit > 0 && cashInHand >= limit   -> no new work of any kind until a deposit
 */
export const CASH_SERVICES = ['food', 'quickCommerce', 'taxi'];

const DELIVERED = ['delivered', 'completed', 'DELIVERED', 'COMPLETED'];
const IN_FLIGHT = ['created', 'confirmed', 'preparing', 'ready_for_pickup', 'reached_pickup', 'picked_up', 'reached_drop'];
const CASH_METHODS = ['cash', 'cod', 'CASH', 'COD'];
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const oid = (v) => new mongoose.Types.ObjectId(String(v));

/** Cash due on one order/ride: COD remainder first, then the legacy amount fields. */
export const CASH_DUE_EXPR = {
  $cond: [
    { $eq: ['$payment.cod.enabled', true] },
    { $ifNull: ['$payment.amountDue', 0] },
    {
      $cond: [
        { $gt: [{ $ifNull: ['$amountToCollect', 0] }, 0] },
        '$amountToCollect',
        {
          $cond: [
            { $gt: [{ $ifNull: ['$payment.amountDue', 0] }, 0] },
            '$payment.amountDue',
            {
              $cond: [
                { $gt: [{ $ifNull: ['$payment.amount', 0] }, 0] },
                '$payment.amount',
                { $ifNull: ['$pricing.total', { $ifNull: ['$totalAmount', 0] }] },
              ],
            },
          ],
        },
      ],
    },
  ],
};

/** Which vertical a row of the unified view came from. */
export const SERVICE_EXPR = {
  $cond: [
    { $eq: ['$orderKind', 'taxi'] },
    'taxi',
    { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$order_id', ''] } }, 0] }, 'food', 'quickCommerce'] },
  ],
};

let limitCache = null;
let limitCachedAt = 0;
export const clearCashLimitCache = () => {
  limitCache = null;
  limitCachedAt = 0;
};

/** Admin cash limit (0 = no cap) and withdrawal minimum. */
export async function getCashLimits() {
  if (limitCache && Date.now() - limitCachedAt < 10 * 1000) return limitCache;
  const doc = await FoodDeliveryCashLimit.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
  limitCache = {
    deliveryCashLimit: Number(doc?.deliveryCashLimit) || 0,
    deliveryWithdrawalLimit: Number(doc?.deliveryWithdrawalLimit) || 100,
  };
  limitCachedAt = Date.now();
  return limitCache;
}

/** A rider/driver token may carry the partner id or the unified identity id. */
export async function resolvePartnerObjectId(idOrIdentity) {
  const raw = String(idOrIdentity || '');
  if (!mongoose.Types.ObjectId.isValid(raw)) return null;
  const direct = await FoodDeliveryPartner.findById(raw).select('_id').lean();
  if (direct) return direct._id;
  const viaIdentity = await FoodDeliveryPartner.findOne({ identityId: raw }).select('_id').lean();
  return viaIdentity?._id || null;
}

const emptyService = () => ({ collected: 0, pending: 0, orders: 0 });
const emptySummary = (limit) => ({
  limit,
  cashInHand: 0,
  pendingCash: 0,
  available: limit > 0 ? limit : null,
  blocked: false,
  deposited: 0,
  lastDepositAt: null,
  byService: { food: emptyService(), quickCommerce: emptyService(), taxi: emptyService() },
});

/**
 * Cash summaries for many riders at once (dispatch asks for every candidate).
 * `excludeOrderId` leaves one order out of the pending cash (the one being offered / accepted).
 * @returns {Promise<Map<string, object>>} partnerId -> summary
 */
export async function getRiderCashSummaries(partnerIds = [], { excludeOrderId = null } = {}) {
  const ids = [...new Set(partnerIds.map((p) => String(p)).filter((p) => mongoose.Types.ObjectId.isValid(p)))];
  const { deliveryCashLimit: limit } = await getCashLimits();
  const out = new Map(ids.map((id) => [id, emptySummary(limit)]));
  if (!ids.length) return out;
  const objectIds = ids.map(oid);

  const match = {
    'dispatch.deliveryPartnerId': { $in: objectIds },
    orderStatus: { $in: [...DELIVERED, ...IN_FLIGHT] },
    'payment.method': { $in: CASH_METHODS },
  };
  if (excludeOrderId && mongoose.Types.ObjectId.isValid(String(excludeOrderId))) match._id = { $ne: oid(excludeOrderId) };

  const [rows, deposits] = await Promise.all([
    riderOrders.aggregate([
      { $match: match },
      { $addFields: { _due: CASH_DUE_EXPR, _svc: SERVICE_EXPR, _done: { $in: ['$orderStatus', DELIVERED] } } },
      {
        $group: {
          _id: { p: { $toString: '$dispatch.deliveryPartnerId' }, s: '$_svc' },
          collected: { $sum: { $cond: ['$_done', '$_due', 0] } },
          pending: { $sum: { $cond: ['$_done', 0, '$_due'] } },
          orders: { $sum: 1 },
        },
      },
    ]),
    FoodDeliveryCashDeposit.aggregate([
      { $match: { deliveryPartnerId: { $in: objectIds }, status: 'Completed' } },
      { $group: { _id: '$deliveryPartnerId', total: { $sum: '$amount' }, lastAt: { $max: '$createdAt' } } },
    ]),
  ]);

  for (const row of rows) {
    const summary = out.get(String(row._id?.p));
    const service = row._id?.s;
    if (!summary || !summary.byService[service]) continue;
    summary.byService[service] = {
      collected: round2(summary.byService[service].collected + (Number(row.collected) || 0)),
      pending: round2(summary.byService[service].pending + (Number(row.pending) || 0)),
      orders: summary.byService[service].orders + (Number(row.orders) || 0),
    };
  }
  for (const dep of deposits) {
    const summary = out.get(String(dep._id));
    if (summary) {
      summary.deposited = round2(dep.total);
      summary.lastDepositAt = dep.lastAt || null;
    }
  }
  for (const summary of out.values()) {
    const collected = CASH_SERVICES.reduce((s, k) => s + summary.byService[k].collected, 0);
    const pending = CASH_SERVICES.reduce((s, k) => s + summary.byService[k].pending, 0);
    summary.cashInHand = round2(Math.max(0, collected - summary.deposited));
    summary.pendingCash = round2(pending);
    summary.available = limit > 0 ? round2(Math.max(0, limit - summary.cashInHand - summary.pendingCash)) : null;
    summary.blocked = limit > 0 && summary.cashInHand >= limit;
  }
  return out;
}

export async function getRiderCashSummary(partnerIdOrIdentity, opts = {}) {
  const partnerId = await resolvePartnerObjectId(partnerIdOrIdentity);
  if (!partnerId) return null;
  return (await getRiderCashSummaries([partnerId], opts)).get(String(partnerId));
}

/**
 * Can this rider take new work now? `cashDue` is the cash they would have to collect on it (0 for prepaid).
 * A blocked rider gets nothing; a cash job also needs headroom.
 */
export const riderCanTakeWork = (summary, cashDue = 0) => {
  if (!summary || !(summary.limit > 0)) return true;
  if (summary.blocked) return false;
  return !(cashDue > 0 && summary.available < cashDue);
};

export const CASH_BLOCKED_MESSAGE = 'Deposit your cash to get new orders.';
export const CASH_NO_HEADROOM_MESSAGE = 'Your cash limit is not enough for this order. Deposit your cash to get new orders.';

/** Admin view of one rider: recent cash orders/rides (all three services) with the COD split. */
export async function getRiderCashOrders(partnerId, { limit = 30, service = null } = {}) {
  const match = {
    'dispatch.deliveryPartnerId': oid(partnerId),
    orderStatus: { $in: [...DELIVERED, ...IN_FLIGHT] },
    'payment.method': { $in: CASH_METHODS },
  };
  const rows = await riderOrders.find(match).sort({ createdAt: -1 }).limit(Math.min(200, Math.max(1, limit))).lean();
  const mapped = rows.map((r) => {
    const isTaxi = r.orderKind === 'taxi';
    const isFood = !isTaxi && Boolean(r.order_id);
    const cod = isTaxi ? r.cod : r.payment?.cod;
    const due = r.payment?.cod?.enabled
      ? Number(r.payment.amountDue || 0)
      : Number(r.amountToCollect || r.payment?.amountDue || r.payment?.amount || r.pricing?.total || 0);
    return {
      service: isTaxi ? 'taxi' : isFood ? 'food' : 'quickCommerce',
      id: String(r._id),
      orderRef: r.order_id || r.orderId || String(r._id),
      status: r.orderStatus,
      delivered: DELIVERED.includes(r.orderStatus),
      cashDue: round2(due),
      orderTotal: round2(r.pricing?.total || r.fare || 0),
      advanceAmount: round2(cod?.advanceAmount || 0),
      cod: cod?.enabled ? { advanceAmount: round2(cod.advanceAmount), remainingAmount: round2(cod.remainingAmount), collectedAmount: round2(cod.collectedAmount), advanceStatus: cod.advanceStatus } : null,
      date: r.deliveryState?.deliveredAt || r.deliveredAt || r.completedAt || r.createdAt,
    };
  });
  return service ? mapped.filter((m) => m.service === service) : mapped;
}

const depositDto = (d, partner) => ({
  id: String(d._id),
  partnerId: String(d.deliveryPartnerId?._id || d.deliveryPartnerId),
  partnerName: partner?.name || d.deliveryPartnerId?.name || '',
  partnerPhone: partner?.phone || d.deliveryPartnerId?.phone || '',
  amount: round2(d.amount),
  method: d.paymentMethod,
  status: d.status,
  razorpayOrderId: d.razorpayOrderId || '',
  razorpayPaymentId: d.razorpayPaymentId || '',
  note: d.adminNote || '',
  createdAt: d.createdAt,
});

/** Deposit history, paged. Rider app: own rows (partnerId). Admin: any filter, rows carry the rider's name/phone. */
export async function listCashDeposits({ partnerId, status, from, to, page = 1, limit = 20 } = {}, { withPartner = false } = {}) {
  const pg = Math.max(parseInt(page, 10) || 1, 1);
  const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);
  const match = {};
  if (partnerId) {
    if (!mongoose.Types.ObjectId.isValid(String(partnerId))) return { deposits: [], totals: { completedAmount: 0, completedCount: 0, pendingCount: 0, failedCount: 0 }, pagination: { page: pg, limit: lim, total: 0, pages: 1 } };
    match.deliveryPartnerId = oid(partnerId);
  }
  if (['Pending', 'Completed', 'Failed'].includes(status)) match.status = status;
  const range = {};
  if (from && !Number.isNaN(new Date(from).getTime())) range.$gte = new Date(from);
  if (to && !Number.isNaN(new Date(to).getTime())) { const t = new Date(to); t.setHours(23, 59, 59, 999); range.$lte = t; }
  if (range.$gte || range.$lte) match.createdAt = range;

  let q = FoodDeliveryCashDeposit.find(match).sort({ createdAt: -1 }).skip((pg - 1) * lim).limit(lim);
  if (withPartner) q = q.populate({ path: 'deliveryPartnerId', select: 'name phone' });
  const [rows, total, totalsAgg] = await Promise.all([
    q.lean(),
    FoodDeliveryCashDeposit.countDocuments(match),
    FoodDeliveryCashDeposit.aggregate([{ $match: match }, { $group: { _id: '$status', amount: { $sum: '$amount' }, n: { $sum: 1 } } }]),
  ]);
  const byStatus = Object.fromEntries(totalsAgg.map((r) => [r._id, r]));
  return {
    deposits: rows.map((d) => depositDto(d)),
    totals: {
      completedAmount: round2(byStatus.Completed?.amount || 0),
      completedCount: byStatus.Completed?.n || 0,
      pendingCount: byStatus.Pending?.n || 0,
      failedCount: byStatus.Failed?.n || 0,
    },
    pagination: { page: pg, limit: lim, total, pages: Math.ceil(total / lim) || 1 },
  };
}

/** Admin: set the cash-in-hand limit (0 = no cap) and the withdrawal minimum. */
export async function updateCashLimits({ deliveryCashLimit, deliveryWithdrawalLimit } = {}) {
  const current = await getCashLimits();
  const next = {
    deliveryCashLimit: deliveryCashLimit === undefined ? current.deliveryCashLimit : Number(deliveryCashLimit),
    deliveryWithdrawalLimit: deliveryWithdrawalLimit === undefined ? current.deliveryWithdrawalLimit : Number(deliveryWithdrawalLimit),
  };
  for (const [k, v] of Object.entries(next)) {
    if (!Number.isFinite(v) || v < 0) throw new ValidationError(`${k} must be a number >= 0`);
  }
  await FoodDeliveryCashLimit.findOneAndUpdate({ isActive: true }, { $set: { ...next, isActive: true } }, { upsert: true, sort: { createdAt: -1 } });
  clearCashLimitCache();
  return next;
}

/** Admin: one rider's cash picture - summary, per-service split, recent cash orders and deposits. */
export async function getAdminRiderCash(partnerId) {
  const id = await resolvePartnerObjectId(partnerId);
  if (!id) throw new NotFoundError('Delivery partner not found');
  const [partner, summary, orders, deposits] = await Promise.all([
    FoodDeliveryPartner.findById(id).select('name phone').lean(),
    getRiderCashSummary(id),
    getRiderCashOrders(id, { limit: 50 }),
    listCashDeposits({ partnerId: id, limit: 20 }),
  ]);
  return { partner: { id: String(id), name: partner?.name || '', phone: partner?.phone || '' }, summary, orders, deposits: deposits.deposits, depositTotals: deposits.totals };
}
