export const ORDER_FILTER_TABS = [
  { id: "new", label: "New Orders" },
  { id: "all", label: "All" },
  { id: "preparing", label: "Preparing" },
  { id: "ready", label: "Ready" },
  { id: "out-for-delivery", label: "Out for delivery" },
  { id: "scheduled", label: "Scheduled" },
  { id: "table-booking", label: "Table Booking" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
]

export const ALL_ORDERS_STATUS_PRIORITY = {
  created: 0,
  pending: 0,
  confirmed: 1,
  preparing: 2,
  ready: 3,
  ready_for_pickup: 3,
  out_for_delivery: 4,
  picked_up: 4,
  scheduled: 5,
  delivered: 6,
  completed: 6,
  cancelled: 7,
}

export const getAllOrdersTimestamp = (order) =>
  order?.cancelledAt ||
  order?.deliveredAt ||
  order?.updatedAt ||
  order?.createdAt ||
  new Date().toISOString()

export const transformOrderForList = (order) => ({
  orderId: order.orderId || order._id,
  mongoId: order._id,
  status: order.status || "pending",
  customerName: order.userId?.name || order.customerName || "Customer",
  type: "Home Delivery",
  tableOrToken: null,
  timePlaced: new Date(getAllOrdersTimestamp(order)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }),
  eta: null,
  items: order.items || [],
  amount: order.pricing?.total || order.total || 0,
  itemsSummary:
    order.items?.map((item) => `${item.quantity}x ${item.name}`).join(", ") || "No items",
  photoUrl: order.items?.[0]?.image || null,
  photoAlt: order.items?.[0]?.name || "Order",
  paymentMethod: order.paymentMethod || order.payment?.method || null,
  deliveryPartnerId: order.deliveryPartnerId || null,
  dispatchStatus: order.dispatch?.status || null,
  preparingTimestamp: order.tracking?.preparing?.timestamp
    ? new Date(order.tracking.preparing.timestamp)
    : new Date(order.createdAt || Date.now()),
  initialETA: order.estimatedDeliveryTime || 30,
  sortTimestamp: new Date(getAllOrdersTimestamp(order)).getTime(),
  scheduledAt: order.scheduledAt || null,
  restaurantNote: order.restaurantNote || null,
  pickupOtp: order.pickupOtp || "",
  pickupOtpVerified: Boolean(order.pickupOtpVerified),
})
