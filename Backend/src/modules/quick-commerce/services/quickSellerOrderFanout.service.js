import mongoose from 'mongoose';
import { getIO, rooms } from '../../../config/socket.js';
import { logger } from '../../../utils/logger.js';
import { QuickOrder } from '../models/order.model.js';
import { SellerOrder } from '../seller/models/sellerOrder.model.js';
import { notifyOwnerSafely } from '../../../core/notifications/firebase.service.js';
import { getHeaderCommissionSnapshot } from '../admin/services/commission.service.js';
import { isQuickOrderVisibleToSeller } from '../utils/sellerOrderVisibility.helpers.js';
import { resolveQuickOrderCustomer, isGenericCustomerLabel } from '../utils/customer.helpers.js';
import { allocateQuickCouponEarnings } from '../utils/quickCouponEarnings.helpers.js';

/**
 * The one ringing, order-id-carrying push a seller gets per order leg. Sent unconditionally —
 * not just when the inbox-entry write (upsertSellerNotification) fails — so a seller app that
 * never opens the socket connection still gets woken up for a new order.
 */
const PUSH_ITEMS_LIST_MAX = 150;

// FCM data values must be strings; empty/missing values are dropped, never sent as placeholders.
export const buildNewSellerOrderPushDetails = async (sellerOrder) => {
  const details = {};
  const customerName = String(sellerOrder.customer?.name || '').trim();
  if (customerName && !isGenericCustomerLabel(customerName)) details.customerName = customerName;

  const address = String(sellerOrder.address?.address || '').trim();
  if (address) details.customerAddress = address;

  const items = Array.isArray(sellerOrder.items) ? sellerOrder.items : [];
  if (items.length) {
    details.itemCount = String(items.reduce((n, i) => n + (Number(i?.quantity) || 1), 0));
    const list = items.map((i) => `${Number(i?.quantity) || 1} x ${i?.name || ''}`.trim()).join(', ');
    if (list) details.itemsList = list.slice(0, PUSH_ITEMS_LIST_MAX);
  }

  const total = sellerOrder.pricing?.total;
  if (total !== undefined && total !== null && total !== '') details.total = String(total);

  try {
    if (sellerOrder.parentOrderId) {
      const parent = await QuickOrder.findById(sellerOrder.parentOrderId).select('payment.method').lean();
      const method = String(parent?.payment?.method || '').trim();
      if (method) details.paymentMethod = method;
    }
  } catch (err) {
    logger.warn(`New seller order push: payment lookup failed: ${err?.message || err}`);
  }
  return details;
};

const sendNewSellerOrderPush = async (sellerOrder) => {
  try {
    const details = await buildNewSellerOrderPushDetails(sellerOrder);
    await notifyOwnerSafely(
      { ownerType: 'SELLER', ownerId: sellerOrder.sellerId },
      {
        title: 'New order received',
        body: `Order ${sellerOrder.orderId} is waiting for you`,
        ring: true,
        data: {
          type: 'new_seller_order',
          orderId: String(sellerOrder.orderId),
          sellerOrderId: String(sellerOrder._id?.toString?.() || ''),
          link: '/seller/orders',
          ...details,
        },
      },
    );
  } catch (pushErr) {
    logger.warn(`New seller order push failed: ${pushErr?.message || pushErr}`);
  }
};

export const emitQuickSellerOrders = async (sellerOrders) => {
  try {
    const io = getIO();
    if (!Array.isArray(sellerOrders) || sellerOrders.length === 0) return;

    let upsertSellerNotification = null;
    try {
      ({ upsertSellerNotification } = await import('../seller/services/sellerNotify.service.js'));
    } catch (importErr) {
      logger.warn(`Seller notify import failed: ${importErr?.message || importErr}`);
    }

    for (const sellerOrder of sellerOrders) {
      if (!sellerOrder?.sellerId) continue;
      const payload = {
        orderId: sellerOrder.orderId,
        sellerOrderId: sellerOrder._id?.toString?.() || '',
        status: sellerOrder.status,
        workflowStatus: sellerOrder.workflowStatus,
        items: sellerOrder.items || [],
        pricing: sellerOrder.pricing || {},
        createdAt: sellerOrder.createdAt || new Date(),
      };

      if (io) {
        io.to(rooms.seller(sellerOrder.sellerId)).emit('new_order', payload);
        io.to(rooms.seller(sellerOrder.sellerId)).emit('order:new', payload);
        io.to(rooms.seller(sellerOrder.sellerId)).emit('play_notification_sound', {
          audience: 'seller',
          type: 'new_order',
          orderId: sellerOrder.orderId,
          sellerOrderId: sellerOrder._id?.toString?.() || '',
        });
      }

      if (typeof upsertSellerNotification === 'function') {
        await upsertSellerNotification(sellerOrder.sellerId, {
          key: `order:${sellerOrder.orderId}:new`,
          type: 'order',
          title: 'New quick order received',
          message: `Order ${sellerOrder.orderId} is waiting for seller action.`,
          link: '/seller/orders',
          metadata: {
            orderId: sellerOrder.orderId,
            sellerOrderId: sellerOrder._id?.toString?.() || '',
            orderType: 'quick',
          },
        });
      }

      void sendNewSellerOrderPush(sellerOrder);
    }
  } catch (error) {
    logger.warn(`emitQuickSellerOrders failed: ${error?.message || error}`);
  }
};

export const buildQuickSellerOrderDocsFromParent = async (parentOrder) => {
  const quickItems = (Array.isArray(parentOrder?.items) ? parentOrder.items : [])
    .filter((item) => item?.type === 'quick');

  const sellerBuckets = new Map();
  // @deprecated multi-seller bucketing — ONE ORDER = ONE SELLER; kept for SellerOrder fan-out compatibility.
  quickItems.forEach((item) => {
    const sellerId = String(item?.sourceId || '').trim();
    if (!sellerId || !mongoose.isValidObjectId(sellerId)) return;
    if (!sellerBuckets.has(sellerId)) sellerBuckets.set(sellerId, []);
    sellerBuckets.get(sellerId).push(item);
  });

  if (!sellerBuckets.size) return [];

  const deliveryAddress = parentOrder?.deliveryAddress || {};
  const deliveryFee = Number(parentOrder?.pricing?.deliveryFee || 0);
  const subtotal = Number(parentOrder?.pricing?.subtotal || 0);
  const totalPackagingFee = Number(parentOrder?.pricing?.packagingFee || 0);
  const paymentMethod = String(parentOrder?.payment?.method || '').trim().toLowerCase();
  const sellerPaymentMode = ['cash', 'cod'].includes(paymentMethod) ? 'cash' : 'online';
  const customer = resolveQuickOrderCustomer(parentOrder);

  return Promise.all(
    Array.from(sellerBuckets.entries()).map(async ([sellerId, sellerItems]) => {
      const sellerSubtotal = sellerItems.reduce(
        (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
        0,
      );
      const allocatedDeliveryFee = Number(
        ((deliveryFee * sellerSubtotal) / Math.max(subtotal, 1)).toFixed(2),
      );
      const { commissionAmount } = await getHeaderCommissionSnapshot(
        sellerItems.map((item) => ({
          productId: item.itemId || item.productId,
          price: item.price,
          quantity: item.quantity,
        })),
      );
      const appliedCoupon = parentOrder?.pricing?.appliedCoupon;
      const allocatedPackingFee = subtotal > 0
        ? Number(((totalPackagingFee * sellerSubtotal) / subtotal).toFixed(2))
        : totalPackagingFee;
      const sellerPackingFee = Number(allocatedPackingFee || 0);
      const {
        sellerDiscount,
        productEarnings: sellerProductEarnings,
        receivable,
      } = allocateQuickCouponEarnings({
        couponSource: appliedCoupon?.source,
        discount: appliedCoupon?.discount || parentOrder?.pricing?.discount || 0,
        sellerSubtotal,
        commission: commissionAmount,
        packingFee: sellerPackingFee,
      });

      return {
        orderType: 'quick',
        parentOrderId: parentOrder._id,
        sellerId,
        orderId: parentOrder.orderId,
        customer: {
          name: customer.name,
          phone: customer.phone,
        },
        items: sellerItems.map((item) => ({
          productId: item.itemId || item.productId,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          image: item.image || '',
          variantName: item.variantName || item.notes || '',
        })),
        pricing: {
          subtotal: sellerSubtotal,
          commission: commissionAmount,
          productEarnings: sellerProductEarnings,
          packingFee: sellerPackingFee,
          couponDiscount: sellerDiscount,
          total: sellerSubtotal + allocatedDeliveryFee,
          receivable,
        },
        status: 'pending',
        workflowStatus: 'SELLER_PENDING',
        sellerPendingExpiresAt: new Date(Date.now() + 2 * 60 * 1000),
        address: {
          address: deliveryAddress?.street || deliveryAddress?.address || '',
          city: deliveryAddress?.city || '',
          ...(deliveryAddress?.state ? { state: deliveryAddress.state } : {}),
          ...(deliveryAddress?.zipCode ? { zipCode: deliveryAddress.zipCode } : {}),
          ...(Array.isArray(deliveryAddress?.location?.coordinates)
            ? {
                location: {
                  lat: deliveryAddress.location.coordinates[1],
                  lng: deliveryAddress.location.coordinates[0],
                },
              }
            : {}),
        },
        payment: {
          method: sellerPaymentMode,
        },
      };
    }),
  );
};

export const fanOutQuickSellerOrdersForParent = async (parentOrder) => {
  if (!parentOrder || !isQuickOrderVisibleToSeller(parentOrder)) {
    return [];
  }

  let hydratedOrder = parentOrder?.toObject ? parentOrder.toObject() : parentOrder;
  const preliminaryCustomer = resolveQuickOrderCustomer(hydratedOrder);
  if (isGenericCustomerLabel(preliminaryCustomer.name) && hydratedOrder?.userId) {
    const withUser = await QuickOrder.findById(hydratedOrder._id)
      .populate('userId', 'name phone email')
      .lean();
    if (withUser) hydratedOrder = withUser;
  }

  const sellerOrders = await buildQuickSellerOrderDocsFromParent(hydratedOrder);
  if (!sellerOrders.length) return [];

  const upserts = await Promise.all(
    sellerOrders.map((doc) =>
      SellerOrder.findOneAndUpdate(
        { sellerId: doc.sellerId, orderId: doc.orderId },
        { $set: doc },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ),
    ),
  );

  const created = upserts.filter(Boolean);
  await emitQuickSellerOrders(created);
  return created;
};
