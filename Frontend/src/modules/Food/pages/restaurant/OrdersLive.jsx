import { useState, useEffect, useRef, createContext, useContext } from "react";
import { useNavigate } from "react-router-dom";
import {
  checkOnboardingStatus,
  isRestaurantOnboardingComplete,
} from "@food/utils/onboardingUtils";
import { motion, AnimatePresence } from "framer-motion";
import Lenis from "lenis";
import {
  RESTAURANT_ORDERS_POLL_MS,
  RESTAURANT_BOOKINGS_POLL_MS,
  pollEnabled,
} from "@/services/socket/pollConfig";
import {
  Printer,
  Volume2,
  VolumeX,
  ChevronDown,
  ChevronUp,
  Minus,
  Plus,
  X,
  AlertCircle,
  Loader2,
  Calendar,
  Clock,
  Users,
  MessageSquare,
  FileText,
  Search,
} from "lucide-react";
import { toast } from "sonner";
;
import RestaurantNavbar from "@food/components/restaurant/RestaurantNavbar";
import RestaurantPanelHeader from "@food/components/restaurant/panel/RestaurantPanelHeader";
import RestaurantPanelModal from "@food/components/restaurant/panel/RestaurantPanelModal";
import OrderDetailPanel from "@food/components/restaurant/panel/OrderDetailPanel";
import useMediaQuery from "@food/hooks/useMediaQuery";
import useOrderFilters from "@food/hooks/useOrderFilters";
import {
  ORDER_FILTER_TABS,
  ALL_ORDERS_STATUS_PRIORITY,
  getAllOrdersTimestamp,
  transformOrderForList,
} from "@food/utils/orderLiveConfig";
const notificationSound = "/zomato_sms.mp3";
import { restaurantAPI, diningAPI } from "@food/api";
import { useRestaurantNotifications } from "@food/hooks/useRestaurantNotifications";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import ResendNotificationButton from "@food/components/restaurant/ResendNotificationButton";
import NewOrderAcceptCard from "@food/components/restaurant/NewOrderAcceptCard";
const debugLog = (...args) => {};
const debugWarn = (...args) => {};
const debugError = (...args) => {};

const ACCEPTANCE_WINDOW_SECONDS = 180;

const getQueuedOrderKeys = (orderLike) =>
  [
    orderLike?.orderMongoId,
    orderLike?.orderId,
    orderLike?.order_id,
    orderLike?._id,
    orderLike?.id,
  ]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean);

const isSameQueuedOrder = (a, b) => {
  const aKeys = new Set(getQueuedOrderKeys(a));
  return getQueuedOrderKeys(b).some((k) => aKeys.has(k));
};

const buildAcceptanceDeadline = (orderLike) => {
  if (orderLike?.acceptanceDeadlineAt) return orderLike.acceptanceDeadlineAt;
  const startRaw =
    orderLike?.restaurantNotifiedAt ||
    orderLike?.dispatch?.acceptedAt ||
    orderLike?.dispatchAcceptedAt ||
    null;
  const startMs = startRaw ? new Date(startRaw).getTime() : Date.now();
  const base = Number.isFinite(startMs) ? startMs : Date.now();
  return new Date(base + ACCEPTANCE_WINDOW_SECONDS * 1000).toISOString();
};

const normalizeIncomingOrder = (orderLike) => {
  if (!orderLike) return null;
  const orderMongoId =
    orderLike.orderMongoId || orderLike._id || orderLike.id || null;
  const orderId =
    orderLike.orderId || orderLike.order_id || orderMongoId || null;
  return {
    ...orderLike,
    orderMongoId,
    orderId,
    acceptanceWindowSeconds:
      Number(orderLike.acceptanceWindowSeconds) > 0
        ? Number(orderLike.acceptanceWindowSeconds)
        : ACCEPTANCE_WINDOW_SECONDS,
    acceptanceDeadlineAt: buildAcceptanceDeadline(orderLike),
  };
};

const STORAGE_KEY = "restaurant_online_status";

const SelectedOrderContext = createContext(null);

// Consistent Empty State Component for all order lists
function EmptyOrdersState({ message }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 bg-white rounded-2xl border border-slate-100 shadow-sm text-center my-2 mx-1">
      <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 border border-slate-100 mx-auto">
        <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      </div>
      <h3 className="text-sm font-semibold text-slate-800">{message}</h3>
      <p className="text-xs text-slate-400 mt-1">There are no orders here right now.</p>
    </div>
  );
}

// Completed Orders List Component
function CompletedOrders({ onSelectOrder, refreshToken = 0 }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const fetchOrders = async () => {
      try {
        const response = await restaurantAPI.getOrders();

        if (!isMounted) return;

        if (response.data?.success && response.data.data?.orders) {
          const completedOrders = response.data.data.orders.filter(
            (order) =>
              (order.status === "delivered" || order.status === "completed") &&
              (order.items && order.items.length > 0),
          );

          const transformedOrders = completedOrders.map((order) => ({
            orderId: order.orderId || order._id,
            mongoId: order._id,
            status: order.status || "delivered",
            customerName: order.userId?.name || order.customerName || "Customer",
            type: "Home Delivery",
            tableOrToken: null,
            timePlaced: new Date(order.createdAt).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            }),
            deliveredAt:
              order.deliveredAt || order.updatedAt || order.createdAt,
            items: order.items || [],
            itemsSummary:
              order.items
                ?.map((item) => `${item.quantity}x ${item.name}`)
                .join(", ") || "No items",
            photoUrl: order.items?.[0]?.image || null,
            photoAlt: order.items?.[0]?.name || "Order",
            amount: order.pricing?.total || order.total || 0,
            paymentMethod: order.paymentMethod || order.payment?.method || null,
          }));

          transformedOrders.sort((a, b) => {
            const dateA = new Date(a.deliveredAt);
            const dateB = new Date(b.deliveredAt);
            return dateB - dateA;
          });

          if (isMounted) {
            setOrders(transformedOrders);
            setLoading(false);
          }
        } else {
          if (isMounted) {
            setOrders([]);
            setLoading(false);
          }
        }
      } catch (error) {
        if (!isMounted) return;

        if (error.code !== "ERR_NETWORK" && error.response?.status !== 404) {
          debugError("Error fetching completed orders:", error);
        }

        if (isMounted) {
          setOrders([]);
          setLoading(false);
        }
      }
    };

    fetchOrders();

    return () => {
      isMounted = false;
    };
  }, [refreshToken]);

  if (loading) {
    return (
      <div className="pt-4 pb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-black">
            Completed orders
          </h2>
          <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        </div>
        <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="pt-4 pb-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-black">Completed orders</h2>
        <span className="text-xs text-gray-500">{orders.length} total</span>
      </div>
      {orders.length === 0 ? (
        <EmptyOrdersState message="No completed orders yet" />
      ) : (
        <div>
          {orders.map((order) => {
            const deliveredDate = order.deliveredAt
              ? new Date(order.deliveredAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "N/A";

            return (
              <div
                key={order.orderId || order.mongoId}
                className="w-full bg-white rounded-xl p-3 mb-2.5 border border-gray-100 shadow-sm transition-all">
                <button
                  type="button"
                  onClick={() =>
                    onSelectOrder?.({
                      orderId: order.orderId,
                      mongoId: order.mongoId,
                      status: "Delivered",
                      customerName: order.customerName,
                      type: order.type,
                      tableOrToken: order.tableOrToken,
                      timePlaced: deliveredDate,
                      items: order.items,
                      itemsSummary: order.itemsSummary,
                      paymentMethod: order.paymentMethod,
                      amount: order.amount,
                    })
                  }
                  className="w-full text-left flex gap-3 items-stretch">
                  <div className="h-16 w-16 rounded-lg overflow-hidden bg-gray-50 flex items-center justify-center flex-shrink-0 my-auto border border-gray-100">
                    {order.photoUrl ? (
                      <img
                        src={order.photoUrl}
                        alt={order.photoAlt}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center px-1">
                        <span className="text-[9px] font-medium text-gray-400 text-center leading-tight">
                          {order.photoAlt}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 flex flex-col justify-between min-h-[80px]">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[13px] font-bold text-slate-900 leading-none">
                          Order #{order.orderId}
                        </p>
                        <p className="text-[10px] text-gray-500 mt-1 font-medium capitalize">
                          {order.customerName}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border border-emerald-200 bg-emerald-50 text-emerald-600">
                          <span className="h-1 w-1 rounded-full bg-emerald-500" />
                          Delivered
                        </span>
                        <span className="text-[9px] text-gray-400 font-medium">
                          {deliveredDate}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2">
                      <p className="text-xs text-gray-600 line-clamp-1">
                        {order.itemsSummary}
                      </p>
                    </div>

                    <div className="mt-2 flex items-end justify-between gap-2">
                      <div className="flex flex-col gap-1">
                        <p className="text-[11px] text-gray-500">
                          {order.type}
                        </p>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-[11px] text-gray-500">
                          Amount
                        </span>
                        <span className="text-xs font-medium text-black">
                          ₹{order.amount.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Cancelled Orders List Component
function CancelledOrders({ onSelectOrder, refreshToken = 0 }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const fetchOrders = async () => {
      try {
        const response = await restaurantAPI.getOrders();

        if (!isMounted) return;

        if (response.data?.success && response.data.data?.orders) {
          // Filter cancelled orders (both restaurant and user cancelled)
          const cancelledOrders = response.data.data.orders.filter(
            (order) =>
              order.status === "cancelled" &&
              (order.items && order.items.length > 0),
          );

          const transformedOrders = cancelledOrders.map((order) => ({
            orderId: order.orderId || order._id,
            mongoId: order._id,
            status: order.status || "cancelled",
            customerName: order.userId?.name || order.customerName || "Customer",
            type: "Home Delivery",
            tableOrToken: null,
            timePlaced: new Date(order.createdAt).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            }),
            cancelledAt:
              order.cancelledAt || order.updatedAt || order.createdAt,
            cancelledBy: order.cancelledBy || "unknown",
            cancellationReason:
              order.cancellationReason || "No reason provided",
            items: order.items || [],
            itemsSummary:
              order.items
                ?.map((item) => `${item.quantity}x ${item.name}`)
                .join(", ") || "No items",
            photoUrl: order.items?.[0]?.image || null,
            photoAlt: order.items?.[0]?.name || "Order",
            amount: order.pricing?.total || order.total || 0,
            paymentMethod: order.paymentMethod || order.payment?.method || null,
            restaurantNote: order.restaurantNote || null,
          }));

          transformedOrders.sort((a, b) => {
            const dateA = new Date(a.cancelledAt);
            const dateB = new Date(b.cancelledAt);
            return dateB - dateA;
          });

          if (isMounted) {
            setOrders(transformedOrders);
            setLoading(false);
          }
        } else {
          if (isMounted) {
            setOrders([]);
            setLoading(false);
          }
        }
      } catch (error) {
        if (!isMounted) return;

        if (error.code !== "ERR_NETWORK" && error.response?.status !== 404) {
          debugError("Error fetching cancelled orders:", error);
        }

        if (isMounted) {
          setOrders([]);
          setLoading(false);
        }
      }
    };

    fetchOrders();

    return () => {
      isMounted = false;
    };
  }, [refreshToken]);

  if (loading) {
    return (
      <div className="pt-4 pb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-black">
            Cancelled orders
          </h2>
          <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        </div>
        <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="pt-4 pb-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-black">Cancelled orders</h2>
        <span className="text-xs text-gray-500">{orders.length} total</span>
      </div>
      {orders.length === 0 ? (
        <EmptyOrdersState message="No cancelled orders yet" />
      ) : (
        <div>
          {orders.map((order) => {
            const cancelledDate = order.cancelledAt
              ? new Date(order.cancelledAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "N/A";

            const cancelledByText =
              order.cancelledBy === "user"
                ? "Cancelled by User"
                : order.cancelledBy === "restaurant"
                  ? "Cancelled by Restaurant"
                  : "Cancelled";

            return (
              <div
                key={order.orderId || order.mongoId}
                className="w-full bg-white rounded-xl p-3 mb-2.5 border border-gray-100 shadow-sm transition-all">
                <button
                  type="button"
                  onClick={() =>
                    onSelectOrder?.({
                      orderId: order.orderId,
                      mongoId: order.mongoId,
                      status: "Cancelled",
                      customerName: order.customerName,
                      type: order.type,
                      tableOrToken: order.tableOrToken,
                      timePlaced: cancelledDate,
                      items: order.items,
                      itemsSummary: order.itemsSummary,
                      paymentMethod: order.paymentMethod,
                      amount: order.amount,
                      cancellationReason: order.cancellationReason,
                    })
                  }
                  className="w-full text-left flex gap-3 items-stretch">
                  <div className="h-16 w-16 rounded-lg overflow-hidden bg-gray-50 flex items-center justify-center flex-shrink-0 my-auto border border-gray-100">
                    {order.photoUrl ? (
                      <img
                        src={order.photoUrl}
                        alt={order.photoAlt}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center px-1">
                        <span className="text-[9px] font-medium text-gray-400 text-center leading-tight">
                          {order.photoAlt}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 flex flex-col justify-between min-h-[80px]">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[13px] font-bold text-slate-900 leading-none">
                          Order #{order.orderId}
                        </p>
                        <p className="text-[10px] text-gray-500 mt-1 font-medium capitalize">
                          {order.customerName}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                            order.cancelledBy === "user"
                              ? "border-orange-200 bg-orange-50 text-orange-600"
                              : "border-rose-200 bg-rose-50 text-rose-600"
                          }`}>
                          <span
                            className={`h-1 w-1 rounded-full ${
                              order.cancelledBy === "user"
                                ? "bg-orange-500"
                                : "bg-rose-500"
                            }`}
                          />
                          {cancelledByText}
                        </span>
                        <span className="text-[9px] text-gray-400 font-medium">
                          {cancelledDate}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2">
                      <p className="text-xs text-gray-600 line-clamp-1">
                        {order.itemsSummary}
                      </p>
                      {order.cancellationReason && (
                        <p className="text-[10px] text-red-600 mt-1 line-clamp-1">
                          Reason: {order.cancellationReason}
                        </p>
                      )}
                    </div>

                    <div className="mt-2 flex items-end justify-between gap-2">
                      <div className="flex flex-col gap-1">
                        <p className="text-[11px] text-gray-500">
                          {order.type}
                        </p>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-[11px] text-gray-500">
                          Amount
                        </span>
                        <span className="text-xs font-medium text-black">
                          ₹{order.amount.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Table Bookings List Component
function TableBookings() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  const handleStatusUpdate = async (bookingId, newStatus) => {
    try {
      const response = await diningAPI.updateBookingStatusRestaurant(bookingId, newStatus);
      if (response.data.success) {
        setBookings(prev => prev.map(b =>
          b._id === bookingId ? { ...b, status: newStatus } : b
        ));
        toast.success(`Booking ${newStatus === 'accepted' ? 'accepted' : 'declined'}`);
      }
    } catch (error) {
      debugError("Error updating booking status:", error);
      toast.error("Failed to update booking status");
    }
  };

  useEffect(() => {
    let isMounted = true;

    const fetchBookings = async () => {
      try {
        const res = await restaurantAPI.getCurrentRestaurant();
        const restaurant =
          res.data?.data?.restaurant || res.data?.restaurant || res.data?.data;
        const restaurantId = restaurant?._id || restaurant?.id;

        if (restaurantId) {
          const response = await diningAPI.getRestaurantBookings(restaurant);
          if (isMounted && response.data.success) {
            setBookings(response.data.data);
          }
        }
      } catch (error) {
        debugError("Error fetching table bookings:", error);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchBookings();
    // Was a hard-coded 8s. Now a slow safety net behind pollConfig — `new_dining_booking`
    // arrives over the socket, this only catches a gap.
    const interval = pollEnabled(RESTAURANT_BOOKINGS_POLL_MS)
      ? setInterval(fetchBookings, RESTAURANT_BOOKINGS_POLL_MS)
      : null;
    return () => {
      isMounted = false;
      if (interval) clearInterval(interval);
    };
  }, []);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      const res = await restaurantAPI.getCurrentRestaurant();
      const restaurant = res.data?.data?.restaurant || res.data?.restaurant || res.data?.data;
      const response = await diningAPI.getRestaurantBookings(restaurant);
      if (response.data.success) {
        setBookings(response.data.data);
        toast.success("Bookings refreshed");
      }
    } catch {
      toast.error("Refresh failed");
    } finally {
      setLoading(false);
    }
  };

  if (loading)
    return (
      <div className="text-center py-10 text-gray-400">Loading bookings...</div>
    );

  return (
    <div className="pt-4 pb-6 px-1">
      <div className="flex items-baseline justify-between mb-4 px-1">
        <h2 className="text-base font-semibold text-black">Table Bookings</h2>
        <div className="flex items-center gap-3">
           <button 
            onClick={handleRefresh}
            className="text-[10px] font-black text-primary-orange uppercase tracking-widest hover:opacity-80 transition-opacity"
          >
            Refresh
          </button>
          <span className="text-xs text-gray-500 font-medium">({bookings.length})</span>
        </div>
      </div>

      {bookings.length === 0 ? (
        <EmptyOrdersState message="No table bookings yet" />
      ) : (
        <div className="space-y-3">
          {bookings.map((booking) => (
            <div
              key={booking._id}
              className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm transition-all hover:border-gray-300">
              <div className="flex justify-between items-start mb-3">
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-gray-900">
                    {booking.user?.name}
                  </h3>
                  <p className="text-[11px] text-gray-500">
                    {booking.user?.phone || "No phone"}
                  </p>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase shadow-sm ${
                    String(booking.status || '').toLowerCase() === "pending"
                      ? "bg-amber-50 text-amber-600 border border-amber-100"
                      : ["accepted", "confirmed"].includes(String(booking.status || '').toLowerCase())
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                        : String(booking.status || '').toLowerCase() === "checked-in"
                          ? "bg-orange-100 text-orange-700"
                          : String(booking.status || '').toLowerCase() === "completed"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-rose-100 text-rose-700"
                  }`}>
                  {String(booking.status || '').toLowerCase() === "pending" ? "APPROVAL REQD" : 
                   ["accepted", "confirmed"].includes(String(booking.status || '').toLowerCase()) ? "CONFIRMED" : 
                   booking.status}
                </span>
              </div>

              <div className="flex items-center gap-4 text-[11px] text-gray-600 bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                <div className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-gray-400" />
                  <span>
                    {new Date(booking.date).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                  <span>{booking.timeSlot}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5 text-gray-400" />
                  <span>{booking.guests} Guests</span>
                </div>
              </div>

              {booking.specialRequest && (
                <div className="mt-3 p-2 bg-blue-50/50 rounded-lg border border-blue-100/50">
                  <p className="text-[10px] text-blue-700  flex items-start gap-1">
                    <MessageSquare className="w-3 h-3 mt-0.5 shrink-0" />
                    <span className="line-clamp-2">
                      {booking.specialRequest}
                    </span>
                  </p>
                </div>
              )}

              {String(booking.status || '').toLowerCase() === 'pending' && (
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => handleStatusUpdate(booking._id, 'accepted')}
                    className="flex-1 py-2 bg-emerald-600 text-white text-[11px] font-black rounded-xl hover:bg-emerald-700 transition-colors uppercase tracking-widest shadow-sm"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => handleStatusUpdate(booking._id, 'cancelled')}
                    className="flex-1 py-2 bg-white border border-rose-200 text-slate-600 text-[11px] font-black rounded-xl hover:bg-slate-50 transition-colors uppercase tracking-widest"
                  >
                    Decline
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AllOrders({ onSelectOrder, onCancel }) {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [markingReadyOrderIds, setMarkingReadyOrderIds] = useState({});

  useEffect(() => {
    let isMounted = true;
    let intervalId = null;
    let countdownIntervalId = null;

    const fetchOrders = async () => {
      try {
        const response = await restaurantAPI.getOrders();

        if (!isMounted) return;

        if (response.data?.success && response.data.data?.orders) {
          const liveOrders = response.data.data.orders.filter((order) => {
            const status = String(order.status || "").toLowerCase();
            return (
              status !== "delivered" &&
              status !== "completed" &&
              status !== "cancelled" &&
              !status.includes("cancel") &&
              !status.includes("reject") &&
              (order.items && order.items.length > 0)
            );
          });

          const transformedOrders = liveOrders
            .map(transformOrderForList)
            .sort((a, b) => {
              const priorityDiff =
                (ALL_ORDERS_STATUS_PRIORITY[a.status] ?? 999) -
                (ALL_ORDERS_STATUS_PRIORITY[b.status] ?? 999);
              if (priorityDiff !== 0) return priorityDiff;
              return b.sortTimestamp - a.sortTimestamp;
            });

          setOrders(transformedOrders);
        } else {
          setOrders([]);
        }
      } catch (error) {
        if (!isMounted) return;

        if (
          error.code !== "ERR_NETWORK" &&
          error.response?.status !== 404 &&
          error.response?.status !== 401
        ) {
          debugError("Error fetching all orders:", error);
        }

        setOrders([]);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchOrders();

    // Was a hard-coded 10s full order-list refetch — the single heaviest poll in the app, and
    // the one cursor sync exists to replace. Now a slow safety net; set
    // VITE_RESTAURANT_ORDERS_POLL_MS=0 to retire it once the sync logs are clean.
    if (pollEnabled(RESTAURANT_ORDERS_POLL_MS)) {
      intervalId = setInterval(fetchOrders, RESTAURANT_ORDERS_POLL_MS);
    }

    // Refetch immediately when a new order arrives over the socket, so lowering the poll
    // interval does not make the list feel slower — it makes it faster.
    const onSocketOrder = () => { void fetchOrders(); };
    window.addEventListener('restaurant:new_order', onSocketOrder);
    window.addEventListener('restaurantOrderStatusUpdate', onSocketOrder);

    // Pure UI clock for the countdown badges — no network, stays at 1s.
    countdownIntervalId = setInterval(() => {
      if (isMounted) {
        setCurrentTime(new Date());
      }
    }, 1000);

    return () => {
      isMounted = false;
      window.removeEventListener('restaurant:new_order', onSocketOrder);
      window.removeEventListener('restaurantOrderStatusUpdate', onSocketOrder);
      if (intervalId) clearInterval(intervalId);
      if (countdownIntervalId) clearInterval(countdownIntervalId);
    };
  }, []);

  const handleMarkReady = async ({ orderId, mongoId }) => {
    const orderKey = mongoId || orderId;
    if (!orderKey || markingReadyOrderIds[orderKey]) return;

    try {
      setMarkingReadyOrderIds((prev) => ({ ...prev, [orderKey]: true }));
      await restaurantAPI.markOrderReady(orderKey);
      setOrders((prev) =>
        prev.map((order) =>
          (order.mongoId || order.orderId) === orderKey
            ? {
                ...order,
                status: "ready",
                eta: null,
                sortTimestamp: Date.now(),
              }
            : order,
        ),
      );
      toast.success("Order marked as ready");
    } catch (error) {
      debugError("Error marking order as ready from All orders:", error);
      toast.error(
        error.response?.data?.message || "Failed to mark order as ready",
      );
    } finally {
      setMarkingReadyOrderIds((prev) => ({ ...prev, [orderKey]: false }));
    }
  };

  if (loading) {
    return (
      <div className="pt-4 pb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-black">All orders</h2>
          <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        </div>
        <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="pt-4 pb-6">
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-black">All orders</h2>
          <span className="text-xs text-gray-500">({orders.length})</span>
        </div>
        <button 
          onClick={() => navigate('/food/restaurant/orders/all')}
          className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1"
        >
          Full History
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      {orders.length === 0 ? (
        <EmptyOrdersState message="There is no live order" />
      ) : (
        <div>
          {orders.map((order) => {
            const normalizedStatus = String(order.status || "").toLowerCase();
            let etaDisplay = order.eta;

            if (normalizedStatus === "preparing" && order.preparingTimestamp) {
              const elapsedMs = currentTime - order.preparingTimestamp;
              const elapsedMinutes = Math.floor(elapsedMs / 60000);
              const remainingMinutes = Math.max(
                0,
                order.initialETA - elapsedMinutes,
              );

              if (remainingMinutes <= 0) {
                const remainingSeconds = Math.max(
                  0,
                  Math.floor(order.initialETA * 60 - elapsedMs / 1000),
                );
                etaDisplay =
                  remainingSeconds > 0 ? `${remainingSeconds} secs` : "0 mins";
              } else {
                etaDisplay = `${remainingMinutes} mins`;
              }
            }

            return (
              <OrderCard
                key={order.orderId || order.mongoId}
                {...order}
                eta={etaDisplay}
                onSelect={onSelectOrder}
                onCancel={
                  normalizedStatus === "preparing" ? onCancel : undefined
                }
                onMarkReady={
                  normalizedStatus === "preparing" ? handleMarkReady : undefined
                }
                isMarkingReady={Boolean(
                  markingReadyOrderIds[order.mongoId || order.orderId],
                )}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// Search Results Component
function SearchResults({ query, results, isLoading, onSelectOrder }) {
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary-orange mb-4" />
        <p className="text-gray-500 text-sm">Searching for "{query}"...</p>
      </div>
    );
  }

  const transformedResults = (results || []).map(transformOrderForList);

  return (
    <div className="pt-4 pb-6">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-base font-semibold text-black">Search results for</h2>
        <span className="bg-gray-200 px-2 py-0.5 rounded text-sm text-gray-700 ">"{query}"</span>
        <span className="text-xs text-gray-500 font-medium ml-1">({transformedResults.length})</span>
      </div>

      {transformedResults.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center shadow-sm">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Search className="w-8 h-8 text-gray-300" />
          </div>
          <p className="text-gray-900 font-bold mb-1">No results found</p>
          <p className="text-gray-500 text-xs">Try searching for a different order ID or customer name</p>
        </div>
      ) : (
        <div className="space-y-3">
          {transformedResults.map((order) => (
            <OrderCard
              key={order.orderId || order.mongoId}
              {...order}
              onSelect={onSelectOrder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Scheduled Orders Component
function ScheduledOrders({ onSelectOrder, refreshToken }) {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchScheduledOrders = async () => {
      try {
        setLoading(true);
        const response = await restaurantAPI.getOrders({ page: 1, limit: 100 });
        const list = response?.data?.data?.orders || [];

        // Filter for scheduled orders that are NOT yet out for delivery/delivered
        // And match 'created' or 'confirmed' status with scheduledAt
        const scheduled = list
          .filter((o) => {
            const hasScheduledDate = o.scheduledAt || o.isScheduled;
            const status = String(o.orderStatus || o.status || "").toLowerCase();
            // In Scheduled tab, show anything that is scheduled and not yet finished
            // regardless of whether the kitchen has already started "preparing" it.
            return (
              hasScheduledDate &&
              ["created", "confirmed", "preparing", "ready"].includes(status) &&
              (o.items && o.items.length > 0)
            );
          })
          .map(transformOrderForList)
          .sort((a, b) => {
            // Sort by scheduled time
            const timeA = new Date(a.scheduledAt || 0).getTime();
            const timeB = new Date(b.scheduledAt || 0).getTime();
            return timeA - timeB;
          });

        setOrders(scheduled);
      } catch (error) {
        debugError("Error fetching scheduled orders:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchScheduledOrders();
  }, [refreshToken]);

  if (loading) {
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="w-8 h-8 animate-spin text-primary-orange" />
      </div>
    );
  }

  return (
    <div className="pt-4 pb-6">
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-black">Scheduled orders</h2>
          <span className="text-xs text-gray-500">({orders.length})</span>
        </div>
        <button
          onClick={() => navigate("/food/restaurant/orders/all")}
          className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1">
          Full History
          <svg
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      </div>

      {orders.length === 0 ? (
        <EmptyOrdersState message="No scheduled orders found" />
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <OrderCard
              key={order.orderId || order.mongoId}
              {...order}
              onSelect={onSelectOrder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Helper: restaurant accept window starts when rider accepted (dispatch.acceptedAt),
// not when the customer placed the order — otherwise late rider accept auto-rejects instantly.
const getInitialCountdown = (order) => {
  const windowSeconds = 180;
  const startRaw =
    order?.restaurantNotifiedAt ||
    order?.dispatch?.acceptedAt ||
    order?.dispatchAcceptedAt ||
    null;

  // Driver-first: if we don't have rider-accept time yet, always give a fresh full window.
  // createdAt is when the customer ordered — often minutes earlier while hunting a rider.
  if (!startRaw) return windowSeconds;

  const startDate = new Date(startRaw);
  if (Number.isNaN(startDate.getTime())) return windowSeconds;

  const diffInSeconds = Math.floor((Date.now() - startDate.getTime()) / 1000);
  const remaining = windowSeconds - diffInSeconds;
  return Math.max(0, Math.min(windowSeconds, remaining));
}

export default function OrdersLive() {
  const navigate = useNavigate();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const {
    filterTabs,
    activeFilter,
    setActiveFilter,
    isTransitioning,
    setIsTransitioning,
  } = useOrderFilters("new");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const contentRef = useRef(null);
  const filterBarRef = useRef(null);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);
  const touchStartY = useRef(0);
  const isSwiping = useRef(false);
  const mouseStartX = useRef(0);
  const mouseEndX = useRef(0);
  const isMouseDown = useRef(false);

  // New orders queue (replaces single popup)
  const [pendingNewOrders, setPendingNewOrders] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [showRejectPopup, setShowRejectPopup] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [orderToReject, setOrderToReject] = useState(null);
  const [showCancelPopup, setShowCancelPopup] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [orderToCancel, setOrderToCancel] = useState(null);
  const audioRef = useRef(null);
  const shownOrdersRef = useRef(new Set()); // Track orders already queued
  const queuedOrderKeysRef = useRef(new Set());
  const pendingNewOrdersRef = useRef([]);
  const [ordersRefreshToken, setOrdersRefreshToken] = useState(0);
  const requestOrdersRefresh = () => setOrdersRefreshToken((t) => t + 1);
  const [restaurantStatus, setRestaurantStatus] = useState({
    isActive: null,
    rejectionReason: null,
    onboarding: null,
    isLoading: true,
  });
  const [isReverifying, setIsReverifying] = useState(false);
  const audioUnlockedRef = useRef(false);
  const isMutedRef = useRef(isMuted);
  const newOrderRef = useRef(null);

  // Pending counts for tabs
  const [pendingBookingsCount, setPendingBookingsCount] = useState(0);
  const [pendingOrdersCount, setPendingOrdersCount] = useState(0);
  const [pendingDiningRequest, setPendingDiningRequest] = useState(null);

  // Fetch pending counts and settings
  useEffect(() => {
    const fetchCounts = async () => {
      try {
        // Fetch current restaurant data
        const resRes = await restaurantAPI.getCurrentRestaurant();
        const restaurantData = resRes.data?.data?.restaurant || resRes.data?.restaurant || resRes.data?.data;
        
        if (restaurantData?._id || restaurantData?.id) {
          // 1. Fetch bookings
          const res = await diningAPI.getRestaurantBookings(restaurantData);
          if (res.data.success) {
            const bookings = Array.isArray(res.data.data) ? res.data.data : [];
            const pending = bookings.filter(b => String(b.status).toLowerCase() === 'pending').length;
            
            // If new pending booking found, maybe show toast
            if (pending > pendingBookingsCount) {
              toast.info(`New table booking request! Check the "Table Booking" tab.`);
              // Optional: Play sound
              if (audioRef.current && !isMutedRef.current) {
                audioRef.current.play().catch(() => {});
              }
            }
            setPendingBookingsCount(pending);
          }

          // 2. Fetch pending dining request (for restaurant's own request to enable/update dining)
          const requestRes = await restaurantAPI.getPendingDiningRequest();
          if (requestRes.data.success && requestRes.data.data) {
            setPendingDiningRequest(requestRes.data.data);
          } else {
            setPendingDiningRequest(null);
          }
        }

        // 3. Fetch pending orders
        const ordersRes = await restaurantAPI.getOrders({ page: 1, limit: 100 });
        if (ordersRes.data.success) {
          const orders = Array.isArray(ordersRes.data.data?.orders) ? ordersRes.data.data.orders : [];
          const pending = orders.filter((o) => {
            const pickupStatus = String(
              o.myPickupStatus || o.pickups?.[0]?.status || "",
            ).toLowerCase();
            const s = String(o.status || o.orderStatus || "").toLowerCase();
            const dispatchAccepted =
              String(o.dispatch?.status || "").toLowerCase() === "accepted";
            if (pickupStatus === "pending" && dispatchAccepted) return true;
            if (pickupStatus && pickupStatus !== "pending") return false;
            return (
              s === "pending" ||
              s === "created" ||
              s === "confirmed" ||
              (dispatchAccepted && (s === "created" || s === "confirmed"))
            );
          }).length;
          setPendingOrdersCount(pending);
        }
      } catch (error) {
        // Non-blocking
      }
    };

    fetchCounts();
    const interval = setInterval(fetchCounts, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, []);

  // Global search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  // Global search listener
  useEffect(() => {
    const handleSearch = (event) => {
      const { query, results, isLoading } = event.detail;
      setSearchQuery(query || "");
      setSearchResults(results || []);
      setIsSearching(isLoading || false);
    };

    window.addEventListener("restaurantSearchUpdated", handleSearch);
    return () =>
      window.removeEventListener("restaurantSearchUpdated", handleSearch);
  }, []);

  const markOrderAsShown = (orderLike) => {
    const keys = [
      orderLike?.orderMongoId,
      orderLike?.orderId,
      orderLike?._id,
      orderLike?.id,
    ]
      .map((v) => (v == null ? "" : String(v).trim()))
      .filter(Boolean);

    for (const k of keys) shownOrdersRef.current.add(k);
  };

  const hasOrderBeenShown = (orderLike) => {
    const keys = [
      orderLike?.orderMongoId,
      orderLike?.orderId,
      orderLike?._id,
      orderLike?.id,
    ]
      .map((v) => (v == null ? "" : String(v).trim()))
      .filter(Boolean);

    return keys.some((k) => shownOrdersRef.current.has(k));
  };

  const resolveOrderActionId = (orderLike) => {
    const raw =
      orderLike?.orderMongoId ||
      orderLike?._id ||
      orderLike?.orderId ||
      orderLike?.order_id ||
      orderLike?.id;
    const value = raw == null ? "" : String(raw).trim();
    return value || null;
  };

  const getCountdownRemaining = (normalized) => {
    if (!normalized?.acceptanceDeadlineAt) {
      return getInitialCountdown(normalized);
    }
    const deadlineMs = new Date(normalized.acceptanceDeadlineAt).getTime();
    if (!Number.isFinite(deadlineMs)) {
      return getInitialCountdown(normalized);
    }
    return Math.max(0, Math.floor((deadlineMs - Date.now()) / 1000));
  };

  const hasOrderBeenQueued = (orderLike) =>
    getQueuedOrderKeys(orderLike).some((k) =>
      queuedOrderKeysRef.current.has(k),
    );

  const markOrderAsQueued = (orderLike) => {
    for (const k of getQueuedOrderKeys(orderLike)) {
      queuedOrderKeysRef.current.add(k);
    }
    markOrderAsShown(orderLike);
  };

  const unmarkOrderAsQueued = (orderLike) => {
    for (const k of getQueuedOrderKeys(orderLike)) {
      queuedOrderKeysRef.current.delete(k);
    }
  };

  const removeQueuedOrder = (orderLike) => {
    unmarkOrderAsQueued(orderLike);
    setPendingNewOrders((prev) =>
      prev.filter((o) => !isSameQueuedOrder(o, orderLike)),
    );
  };

  const normalizeOrderStatusValue = (value) =>
    String(value || "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "_");

  const isUserCancelledStatus = (statusValue) =>
    normalizeOrderStatusValue(statusValue) === "cancelled_by_user";

  const isAnyCancelledStatus = (statusValue) => {
    const normalized = normalizeOrderStatusValue(statusValue);
    return (
      normalized === "cancelled" ||
      normalized === "cancelled_by_user" ||
      normalized === "cancelled_by_restaurant" ||
      normalized === "cancelled_by_admin"
    );
  };

  const enqueueNewOrder = (rawOrder, { switchToTab = true } = {}) => {
    if (!rawOrder) return false;

    if (isAnyCancelledStatus(rawOrder?.status || rawOrder?.orderStatus)) {
      return false;
    }

    if (hasOrderBeenQueued(rawOrder)) return false;

    const scheduledAt = rawOrder.scheduledAt
      ? new Date(rawOrder.scheduledAt).getTime()
      : null;
    const isFutureScheduled =
      scheduledAt && scheduledAt > Date.now() + 30 * 60000;

    if (isFutureScheduled) {
      toast.info(
        `New scheduled order received for ${new Date(scheduledAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`,
      );
      return false;
    }

    const normalized = normalizeIncomingOrder(rawOrder);
    if (!normalized) return false;

    if (getCountdownRemaining(normalized) <= 0) return false;

    markOrderAsQueued(normalized);
    setPendingNewOrders((prev) => {
      if (prev.some((o) => isSameQueuedOrder(o, normalized))) return prev;
      return [normalized, ...prev];
    });

    if (switchToTab) {
      setActiveFilter("new");
    }
    requestOrdersRefresh();
    return true;
  };

  const getPopupOrderTotal = (orderLike) => {
    if (!orderLike) return 0;

    const payout = Number(
      orderLike.restaurantPayout ?? orderLike.restaurantEarnings?.payout,
    );
    if (Number.isFinite(payout) && payout >= 0) return payout;

    const pricingTotal = Number(orderLike.pricing?.total);
    if (Number.isFinite(pricingTotal) && pricingTotal > 0) return pricingTotal;

    const directTotal = Number(orderLike.total);
    if (Number.isFinite(directTotal) && directTotal > 0) return directTotal;

    const items = Array.isArray(orderLike.items) ? orderLike.items : [];
    const itemsTotal = items.reduce((sum, item) => {
      const price = Number(item?.price || 0);
      const qty = Number(item?.quantity || 0);
      return sum + (Number.isFinite(price) ? price : 0) * (Number.isFinite(qty) ? qty : 0);
    }, 0);

    return Number.isFinite(itemsTotal) ? itemsTotal : 0;
  };

  // Restaurant notifications hook for real-time orders
  const { newOrder, clearNewOrder, isConnected } = useRestaurantNotifications();

  const rejectReasons = [
    "Restaurant is too busy",
    "Item not available",
    "Outside delivery area",
    "Kitchen closing soon",
    "Technical issue",
    "Other reason",
  ];

  // Fetch restaurant verification status
  useEffect(() => {
    const fetchRestaurantStatus = async () => {
      try {
        const response = await restaurantAPI.getCurrentRestaurant();
        const restaurant =
          response?.data?.data?.restaurant || response?.data?.restaurant;
        if (restaurant) {
          setRestaurantStatus({
            isActive: restaurant.isActive,
            status: restaurant.status,
            approvedAt: restaurant.approvedAt,
            pendingUpdateReason: restaurant.pendingUpdateReason,
            hasPendingProfileReview: Boolean(
              restaurant.hasPendingProfileReview || restaurant.profileReviewStatus === "pending",
            ),
            rejectionReason: restaurant.rejectionReason || null,
            onboarding: restaurant.onboarding || null,
            isLoading: false,
          });

          // Check if onboarding is incomplete and redirect if needed
          if (!isRestaurantOnboardingComplete(restaurant)) {
            // Onboarding is incomplete, redirect to onboarding page
            const incompleteStep = await checkOnboardingStatus();
            if (incompleteStep) {
              navigate(`/restaurant/onboarding?step=${incompleteStep}`, {
                replace: true,
              });
              return;
            }
          }
        }
      } catch (error) {
        // Only log error if it's not a network/timeout error (backend might be down/slow)
        if (
          error.code !== "ERR_NETWORK" &&
          error.code !== "ECONNABORTED" &&
          !error.message?.includes("timeout")
        ) {
          debugError("Error fetching restaurant status:", error);
        }
        // Set loading to false so UI doesn't stay in loading state
        setRestaurantStatus((prev) => ({ ...prev, isLoading: false }));
      }
    };

    fetchRestaurantStatus();

    // Listen for restaurant profile updates
    const handleProfileRefresh = () => {
      fetchRestaurantStatus();
    };

    window.addEventListener("restaurantProfileRefresh", handleProfileRefresh);

    return () => {
      window.removeEventListener(
        "restaurantProfileRefresh",
        handleProfileRefresh,
      );
    };
  }, [navigate]);

  // Handle reverify (resubmit for approval)
  const handleReverify = async () => {
    try {
      setIsReverifying(true);
      await restaurantAPI.reverify();

      // Refresh restaurant status
      const response = await restaurantAPI.getCurrentRestaurant();
      const restaurant =
        response?.data?.data?.restaurant || response?.data?.restaurant;
      if (restaurant) {
        setRestaurantStatus({
          isActive: restaurant.isActive,
          rejectionReason: restaurant.rejectionReason || null,
          onboarding: restaurant.onboarding || null,
          isLoading: false,
        });
      }

      // Trigger profile refresh event
      window.dispatchEvent(new Event("restaurantProfileRefresh"));

      alert(
        "Restaurant reverified successfully! Verification will be done in 24 hours.",
      );
    } catch (error) {
      // Don't log network/timeout errors (backend might be down)
      if (
        error.code !== "ERR_NETWORK" &&
        error.code !== "ECONNABORTED" &&
        !error.message?.includes("timeout")
      ) {
        debugError("Error reverifying restaurant:", error);
      }

      // Handle 401 Unauthorized — axios interceptor refreshes the token when possible.
      // Do not hard-redirect to login here; that logs partners out on transient auth races.
      if (error.response?.status === 401) {
        const errorMessage =
          error.response?.data?.message ||
          "Your session could not be verified. Please try again.";
        alert(errorMessage);
      } else {
        // Other errors (400, 500, etc.)
        const errorMessage =
          error.response?.data?.message ||
          "Failed to reverify restaurant. Please try again.";
        alert(errorMessage);
      }
    } finally {
      setIsReverifying(false);
    }
  };

  // Lenis smooth scrolling
  // useEffect(() => {
  //   const lenis = new Lenis({
  //     duration: 1.2,
  //     easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  //     smoothWheel: true,
  //     wheelMultiplier: 1,
  //     touchMultiplier: 1.5,
  //   });

  //   // Connect Lenis to the content container
  //   if (contentRef.current) {
  //     lenis.target = contentRef.current;
  //   }

  //   function raf(time) {
  //     lenis.raf(time);
  //     requestAnimationFrame(raf);
  //   }

  //   requestAnimationFrame(raf);

  //   return () => {
  //     lenis.destroy();
  //   };
  // }, []);

  // Enqueue new orders from Socket.IO hook (sound continues until accept/reject)
  useEffect(() => {
    if (!newOrder) return;
    debugLog("?? New order received via Socket.IO:", newOrder);

    if (isAnyCancelledStatus(newOrder?.status || newOrder?.orderStatus)) {
      clearNewOrder();
      return;
    }

    enqueueNewOrder(newOrder, { switchToTab: true });
  }, [newOrder, clearNewOrder]);

  useEffect(() => {
    const onCustomNewOrder = (event) => {
      const detail = event?.detail;
      if (detail) {
        enqueueNewOrder(detail, { switchToTab: true });
      }
    };
    window.addEventListener("restaurant:new_order", onCustomNewOrder);
    return () =>
      window.removeEventListener("restaurant:new_order", onCustomNewOrder);
  }, []);

  useEffect(() => {
    const onRestaurantOrderStatusUpdate = (event) => {
      const payload = event?.detail || {};
      const payloadStatus = payload?.orderStatus || payload?.status;

      requestOrdersRefresh();

      if (!isAnyCancelledStatus(payloadStatus)) return;

      const payloadKeys = new Set(getQueuedOrderKeys(payload));
      if (payloadKeys.size === 0) return;

      setPendingNewOrders((prev) => {
        const hit = prev.find((o) =>
          getQueuedOrderKeys(o).some((k) => payloadKeys.has(k)),
        );
        if (hit) {
          unmarkOrderAsQueued(hit);
        }
        return prev.filter(
          (o) => !getQueuedOrderKeys(o).some((k) => payloadKeys.has(k)),
        );
      });

      const hookOrder = newOrderRef.current;
      if (hookOrder && getQueuedOrderKeys(hookOrder).some((k) => payloadKeys.has(k))) {
        clearNewOrder();
      }

      const cancelledStatus = normalizeOrderStatusValue(payloadStatus);
      if (isUserCancelledStatus(cancelledStatus)) {
        toast.info("Order canceled by user");
      } else {
        toast.info("Order cancelled");
      }
    };

    window.addEventListener(
      "restaurantOrderStatusUpdate",
      onRestaurantOrderStatusUpdate,
    );

    return () => {
      window.removeEventListener(
        "restaurantOrderStatusUpdate",
        onRestaurantOrderStatusUpdate,
      );
    };
  }, [clearNewOrder]);

  useEffect(() => {
    pendingNewOrdersRef.current = pendingNewOrders;
  }, [pendingNewOrders]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    newOrderRef.current = newOrder;
  }, [newOrder]);

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio(notificationSound);
      audioRef.current.preload = "auto";
    }
  }, []);

  useEffect(() => {
    const unlockAudio = async () => {
      if (audioUnlockedRef.current || !audioRef.current) return;
      try {
        audioRef.current.muted = true;
        await audioRef.current.play();
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.muted = false;
        audioRef.current.volume = 1;
        audioUnlockedRef.current = true;

        const hasPending =
          pendingNewOrdersRef.current.length > 0 || newOrderRef.current;
        if (hasPending && !isMutedRef.current) {
          audioRef.current.loop = false;
          audioRef.current.currentTime = 0;
          audioRef.current.play().catch(() => {});
        }
      } catch (_) {
        audioRef.current.muted = false;
      }
    };

    window.addEventListener("pointerdown", unlockAudio, {
      once: true,
      passive: true,
    });
    window.addEventListener("keydown", unlockAudio, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const transformApiOrderForQueue = (orderToPopup) => ({
    orderId: orderToPopup.orderId,
    orderMongoId: orderToPopup._id,
    restaurantId: orderToPopup.restaurantId,
    restaurantName: orderToPopup.restaurantName,
    items: orderToPopup.items || [],
    total: orderToPopup.pricing?.total || 0,
    customerAddress: orderToPopup.address,
    status: orderToPopup.status,
    orderStatus: orderToPopup.orderStatus || orderToPopup.status,
    createdAt: orderToPopup.createdAt,
    restaurantNotifiedAt:
      orderToPopup.dispatch?.acceptedAt ||
      orderToPopup.restaurantNotifiedAt ||
      null,
    dispatch: orderToPopup.dispatch,
    scheduledAt: orderToPopup.scheduledAt,
    estimatedDeliveryTime: orderToPopup.estimatedDeliveryTime || 30,
    note: orderToPopup.note || "",
    restaurantNote: orderToPopup.restaurantNote,
    sendCutlery: orderToPopup.sendCutlery,
    paymentMethod:
      orderToPopup.paymentMethod || orderToPopup.payment?.method || null,
    payment: orderToPopup.payment,
    pricing: orderToPopup.pricing,
    myPickupStatus: orderToPopup.myPickupStatus,
    pickups: orderToPopup.pickups,
  });

  // Poll for awaiting-restaurant orders missed by realtime
  useEffect(() => {
    const checkOrdersToEnqueue = async () => {
      try {
        const response = await restaurantAPI.getOrders();
        if (response.data?.success && response.data.data?.orders) {
          const now = Date.now();

          const targetOrders = response.data.data.orders.filter((order) => {
            const pickupStatus = String(
              order.myPickupStatus || order.pickups?.[0]?.status || "",
            ).toLowerCase();
            const status = String(
              order.status || order.orderStatus || "",
            ).toLowerCase();
            const dispatchAccepted =
              String(
                order.dispatch?.status || order.dispatchStatus || "",
              ).toLowerCase() === "accepted";
            const awaitingByPickup = pickupStatus
              ? pickupStatus === "pending" && dispatchAccepted
              : (status === "created" || status === "confirmed") &&
                dispatchAccepted;
            const isAwaitingRestaurant = awaitingByPickup;

            if (isAwaitingRestaurant && !order.scheduledAt) {
              if (hasOrderBeenQueued(order) && pickupStatus === "pending") {
                unmarkOrderAsQueued(order);
              } else if (hasOrderBeenQueued(order)) {
                return false;
              }
              return true;
            }

            if (
              order.scheduledAt &&
              (pickupStatus === "pending" ||
                status === "created" ||
                status === "confirmed")
            ) {
              const scheduledTime = new Date(order.scheduledAt).getTime();
              if (scheduledTime <= now + 30 * 60000) return true;
            }

            return false;
          });

          for (let i = targetOrders.length - 1; i >= 0; i -= 1) {
            const orderForQueue = transformApiOrderForQueue(targetOrders[i]);
            enqueueNewOrder(orderForQueue, { switchToTab: false });
          }
        }
      } catch (error) {
        if (error.response?.status !== 401) {
          debugError("Error checking orders to enqueue:", error);
        }
      }
    };

    checkOrdersToEnqueue();
    const intervalId = setInterval(checkOrdersToEnqueue, 60000);

    return () => clearInterval(intervalId);
  }, []);

  const shouldPlayNewOrderAlert =
    (pendingNewOrders.length > 0 || newOrder) && !isMuted;

  useEffect(() => {
    if (shouldPlayNewOrderAlert) {
      if (audioRef.current) {
        audioRef.current.loop = false;
        audioRef.current.muted = false;
        audioRef.current.volume = 1;
        audioRef.current.currentTime = 0;
        audioRef.current
          .play()
          .catch((err) => debugLog("Audio play failed:", err));
      }
    } else if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, [shouldPlayNewOrderAlert]);

  const handleAcceptQueuedOrder = async (order, prepTime) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    let orderId = resolveOrderActionId(order);
    if (!orderId) {
      toast.error("Unable to accept this order: order id missing");
      return;
    }

    try {
      await restaurantAPI.acceptOrder(orderId, prepTime);
      debugLog("? Order accepted:", orderId);
      toast.success("Order accepted successfully");
      removeQueuedOrder(order);
      if (newOrder && isSameQueuedOrder(newOrder, order)) {
        clearNewOrder();
      }
      requestOrdersRefresh();
      setActiveFilter("preparing");
    } catch (error) {
      debugError("? Error accepting order:", error);
      const errorMessage =
        error.response?.data?.message ||
        error.message ||
        "Failed to accept order. Please try again.";

      if (error.response?.status === 400) {
        toast.error(errorMessage);
      } else if (error.response?.status === 404) {
        toast.error(
          "Order not found. It may have been cancelled or already processed.",
        );
        removeQueuedOrder(order);
        if (newOrder && isSameQueuedOrder(newOrder, order)) {
          clearNewOrder();
        }
      } else {
        toast.error(errorMessage);
      }
      throw error;
    }
  };

  const handleRejectQueuedClick = (order) => {
    setOrderToReject(order);
    setShowRejectPopup(true);
  };

  const handleRejectConfirm = async () => {
    if (!rejectReason || !orderToReject) return;

    const orderId = resolveOrderActionId(orderToReject);
    if (orderId) {
      try {
        await restaurantAPI.rejectOrder(orderId, rejectReason);
        debugLog("? Order rejected:", orderId);
        requestOrdersRefresh();
      } catch (error) {
        debugError("? Error rejecting order:", error);
        alert("Failed to reject order. Please try again.");
        return;
      }
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    removeQueuedOrder(orderToReject);
    if (newOrder && isSameQueuedOrder(newOrder, orderToReject)) {
      clearNewOrder();
    }
    setShowRejectPopup(false);
    setRejectReason("");
    setOrderToReject(null);
  };

  const handleRejectCancel = () => {
    setShowRejectPopup(false);
    setRejectReason("");
    setOrderToReject(null);
  };

  // Handle cancel order (for preparing orders)
  const handleCancelClick = (order) => {
    setOrderToCancel(order);
    setShowCancelPopup(true);
  };

  const handleCancelConfirm = async () => {
    if (!cancelReason.trim() || !orderToCancel) return;

    try {
      const orderId = orderToCancel.mongoId || orderToCancel.orderId;
      await restaurantAPI.rejectOrder(orderId, cancelReason.trim());
      toast.success("Order cancelled successfully");
      requestOrdersRefresh();
      setShowCancelPopup(false);
      setOrderToCancel(null);
      setCancelReason("");
    } catch (error) {
      debugError("? Error cancelling order:", error);
      toast.error(error.response?.data?.message || "Failed to cancel order");
    }
  };

  const handleCancelPopupClose = () => {
    setShowCancelPopup(false);
    setOrderToCancel(null);
    setCancelReason("");
  };

  // Toggle mute
  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (audioRef.current) {
      if (!isMuted) {
        audioRef.current.pause();
      } else {
        audioRef.current.muted = false;
        audioRef.current.volume = 1;
        audioRef.current.currentTime = 0;
        audioRef.current
          .play()
          .catch((err) => debugLog("Audio play failed:", err));
      }
    }
  };

  // Handle PDF download
  const handlePrint = async (orderArg) => {
    const orderToPrint = orderArg || newOrder;
    if (!orderToPrint) {
      debugWarn("No order data available for PDF generation");
      return;
    }

    try {
      const doc = new jsPDF();

      doc.setFont("helvetica", "bold");
      doc.setFontSize(20);
      doc.text("Order Receipt", 105, 20, { align: "center" });

      doc.setFontSize(14);
      doc.setFont("helvetica", "normal");
      doc.text(orderToPrint.restaurantName || "Restaurant", 105, 30, {
        align: "center",
      });

      // Order details
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text(`Order ID: ${orderToPrint.orderId || "N/A"}`, 20, 45);
      doc.setFont("helvetica", "normal");

      const orderDate = orderToPrint.createdAt
        ? new Date(orderToPrint.createdAt).toLocaleString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : new Date().toLocaleString("en-GB");

      doc.text(`Date: ${orderDate}`, 20, 52);

      // Customer address
      if (orderToPrint.customerAddress) {
        doc.setFont("helvetica", "bold");
        doc.text("Delivery Address:", 20, 62);
        doc.setFont("helvetica", "normal");
        const addressText =
          [
            orderToPrint.customerAddress.street,
            orderToPrint.customerAddress.city,
            orderToPrint.customerAddress.state,
          ]
            .filter(Boolean)
            .join(", ") || "Address not available";
        const addressLines = doc.splitTextToSize(addressText, 170);
        doc.text(addressLines, 20, 69);
      }

      // Items table
      let yPos = 85;
      if (orderToPrint.items && orderToPrint.items.length > 0) {
        doc.setFont("helvetica", "bold");
        doc.text("Items:", 20, yPos);
        yPos += 8;

        // Prepare table data
        const tableData = orderToPrint.items.map((item) => [
          item.name || "Item",
          item.quantity || 1,
          `₹${(item.price || 0).toFixed(2)}`,
          `₹${((item.price || 0) * (item.quantity || 1)).toFixed(2)}`,
        ]);

        autoTable(doc, {
          startY: yPos,
          head: [["Item", "Qty", "Price", "Total"]],
          body: tableData,
          theme: "striped",
          headStyles: {
            fillColor: [0, 0, 0],
            textColor: 255,
            fontStyle: "bold",
          },
          styles: { fontSize: 9 },
          columnStyles: {
            0: { cellWidth: 80 },
            1: { cellWidth: 30, halign: "center" },
            2: { cellWidth: 35, halign: "right" },
            3: { cellWidth: 35, halign: "right" },
          },
        });

        yPos = doc.lastAutoTable.finalY + 10;
      }

      // Total
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(`Total: ₹${(orderToPrint.total || 0).toFixed(2)}`, 20, yPos);

      // Payment status
      yPos += 10;
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(
        `Payment Status: ${orderToPrint.status === "confirmed" ? "Paid" : "Pending"}`,
        20,
        yPos,
      );

      // Estimated delivery time
      if (orderToPrint.estimatedDeliveryTime) {
        yPos += 8;
        doc.text(
          `Estimated Delivery: ${orderToPrint.estimatedDeliveryTime} minutes`,
          20,
          yPos,
        );
      }

      // Delivery Note
      if (orderToPrint.note) {
        yPos += 10;
        doc.setFont("helvetica", "bold");
        doc.text("Note for Delivery:", 20, yPos);
        doc.setFont("helvetica", "normal");
        const noteLines = doc.splitTextToSize(orderToPrint.note, 170);
        doc.text(noteLines, 20, yPos + 7);
        yPos += (noteLines.length * 7);
      }

      // Restaurant Note
      if (orderToPrint.restaurantNote) {
        yPos += 10;
        doc.setFont("helvetica", "bold");
        doc.text("Note for Restaurant:", 20, yPos);
        doc.setFont("helvetica", "normal");
        const restaurantNoteLines = doc.splitTextToSize(orderToPrint.restaurantNote, 170);
        doc.text(restaurantNoteLines, 20, yPos + 7);
      }

      // Cutlery preference
      yPos += 15;
      doc.setFont("helvetica", "normal");
      doc.text(
        orderToPrint.sendCutlery === false
          ? "? Don't send cutlery"
          : "? Send cutlery requested",
        20,
        yPos,
      );

      // Footer
      const pageHeight = doc.internal.pageSize.height;
      doc.setFontSize(8);
      doc.setFont("helvetica");
      doc.text(
        `Generated on ${new Date().toLocaleString("en-GB")}`,
        105,
        pageHeight - 10,
        { align: "center" },
      );

      // Download PDF
      const fileName = `Order-${orderToPrint.orderId || "Receipt"}-${Date.now()}.pdf`;
      doc.save(fileName);

      debugLog("? PDF generated successfully:", fileName);
    } catch (error) {
      debugError("? Error generating PDF:", error);
      alert("Failed to generate PDF. Please try again.");
    }
  };

  // Handle swipe gestures with smooth animations
  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    touchEndX.current = e.touches[0].clientX;
    isSwiping.current = false;
  };

  const handleTouchMove = (e) => {
    if (!isSwiping.current) {
      const deltaX = Math.abs(e.touches[0].clientX - touchStartX.current);
      const deltaY = Math.abs(e.touches[0].clientY - touchStartY.current);

      // Determine if this is a horizontal swipe
      if (deltaX > deltaY && deltaX > 10) {
        isSwiping.current = true;
      }
    }

    if (isSwiping.current) {
      touchEndX.current = e.touches[0].clientX;
    }
  };

  const handleTouchEnd = () => {
    if (!isSwiping.current) {
      touchStartX.current = 0;
      touchEndX.current = 0;
      return;
    }

    const swipeDistance = touchStartX.current - touchEndX.current;
    const minSwipeDistance = 50;
    const swipeVelocity = Math.abs(swipeDistance);

    if (swipeVelocity > minSwipeDistance && !isTransitioning) {
      const currentIndex = filterTabs.findIndex(
        (tab) => tab.id === activeFilter,
      );
      let newIndex = currentIndex;

      if (swipeDistance > 0 && currentIndex < filterTabs.length - 1) {
        // Swipe left - go to next filter (right side)
        newIndex = currentIndex + 1;
      } else if (swipeDistance < 0 && currentIndex > 0) {
        // Swipe right - go to previous filter (left side)
        newIndex = currentIndex - 1;
      }

      if (newIndex !== currentIndex) {
        setIsTransitioning(true);

        // Smooth transition with animation
        setTimeout(() => {
          setActiveFilter(filterTabs[newIndex].id);
          scrollToFilter(newIndex);

          // Reset transition state after animation
          setTimeout(() => {
            setIsTransitioning(false);
          }, 300);
        }, 50);
      }
    }

    // Reset touch positions
    touchStartX.current = 0;
    touchEndX.current = 0;
    touchStartY.current = 0;
    isSwiping.current = false;
  };

  // Scroll filter bar to show active button with smooth animation
  const scrollToFilter = (index) => {
    if (filterBarRef.current) {
      const buttons = filterBarRef.current.querySelectorAll("button");
      if (buttons[index]) {
        const button = buttons[index];
        const container = filterBarRef.current;
        const buttonLeft = button.offsetLeft;
        const buttonWidth = button.offsetWidth;
        const containerWidth = container.offsetWidth;
        const scrollLeft = buttonLeft - containerWidth / 2 + buttonWidth / 2;

        container.scrollTo({
          left: scrollLeft,
          behavior: "smooth",
        });
      }
    }
  };

  // Scroll to active filter on change with smooth animation
  useEffect(() => {
    const index = filterTabs.findIndex((tab) => tab.id === activeFilter);
    if (index >= 0) {
      // Use requestAnimationFrame for smoother scrolling
      requestAnimationFrame(() => {
        scrollToFilter(index);
      });
    }
  }, [activeFilter]);

  const handleSelectOrder = (order) => {
    setSelectedOrder(order);
    if (!isDesktop) {
      setIsSheetOpen(true);
    }
  };

  const renderContent = () => {
    if (searchQuery.trim() !== "") {
      return (
        <SearchResults
          query={searchQuery}
          results={searchResults}
          isLoading={isSearching}
          onSelectOrder={handleSelectOrder}
        />
      );
    }

    switch (activeFilter) {
      case "new":
        return (
          <div className="space-y-1 px-1">
            {pendingNewOrders.length === 0 ? (
              <EmptyOrdersState message="No new orders right now" />
            ) : (
              <AnimatePresence mode="popLayout">
                {pendingNewOrders.map((order) => (
                  <NewOrderAcceptCard
                    key={order.orderMongoId || order.orderId || order._id}
                    order={order}
                    isMuted={isMuted}
                    onToggleMute={toggleMute}
                    onPrint={(o) => handlePrint(o)}
                    onAccept={handleAcceptQueuedOrder}
                    onReject={handleRejectQueuedClick}
                    onExpired={() => requestOrdersRefresh()}
                  />
                ))}
              </AnimatePresence>
            )}
          </div>
        );
      case "all":
        return (
          <AllOrders
            onSelectOrder={handleSelectOrder}
            onCancel={handleCancelClick}
          />
        );
      case "preparing":
        return (
          <PreparingOrders
            onSelectOrder={handleSelectOrder}
            onCancel={handleCancelClick}
            refreshToken={ordersRefreshToken}
            onStatusChanged={requestOrdersRefresh}
          />
        );
      case "ready":
        return (
          <ReadyOrders
            onSelectOrder={handleSelectOrder}
            refreshToken={ordersRefreshToken}
          />
        );
      case "out-for-delivery":
        return (
          <OutForDeliveryOrders
            onSelectOrder={handleSelectOrder}
            refreshToken={ordersRefreshToken}
          />
        );
      case "scheduled":
        return (
          <ScheduledOrders
            onSelectOrder={handleSelectOrder}
            refreshToken={ordersRefreshToken}
          />
        );
      case "completed":
        return (
          <CompletedOrders
            onSelectOrder={handleSelectOrder}
            refreshToken={ordersRefreshToken}
          />
        );
      case "table-booking":
        return <TableBookings />;
      case "cancelled":
        return (
          <CancelledOrders
            onSelectOrder={handleSelectOrder}
            refreshToken={ordersRefreshToken}
          />
        );
      default:
        return <EmptyState />;
    }
  };

  return (
    <SelectedOrderContext.Provider value={selectedOrder?.orderId || null}>
    <div className="rt-panel-bg flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      <div className="hidden lg:block">
        <RestaurantPanelHeader title="Live orders" subtitle="Manage incoming and active orders" showSearch />
      </div>

      {/* Profile Update Pending Banner */}
      <AnimatePresence>
        {!restaurantStatus.isLoading &&
          (restaurantStatus.hasPendingProfileReview ||
            (restaurantStatus.status === 'pending' &&
              (restaurantStatus.approvedAt ||
                (restaurantStatus.pendingUpdateReason &&
                  restaurantStatus.pendingUpdateReason !== 'New Registration')))) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="px-4 mt-3"
            >
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3 shadow-sm">
                <div className="bg-amber-100 p-2 rounded-xl flex-shrink-0">
                  <Clock className="w-5 h-5 text-amber-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-amber-900">
                    {restaurantStatus.hasPendingProfileReview
                      ? "You are under review"
                      : restaurantStatus.pendingUpdateReason || "Update Pending"}
                  </p>
                  <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                    {restaurantStatus.hasPendingProfileReview ? (
                      <>
                        Your profile changes (
                        <strong>{restaurantStatus.pendingUpdateReason || "profile update"}</strong>) are under admin
                        review. You cannot go online until they are approved. Your current approved details remain
                        visible to customers.
                      </>
                    ) : (
                      <>
                        Your restaurant <strong>{restaurantStatus.pendingUpdateReason || "profile update"}</strong> is
                        pending approval. Please wait for admin response.
                      </>
                    )}
                  </p>
                </div>
              </div>
            </motion.div>
          )
        }
      </AnimatePresence>

        {/* Top Filter Bar - Sticky below navbar */}
        <div className="sticky top-[50px] z-40 bg-white/80 backdrop-blur-md border-b border-[var(--rt-border)] lg:top-0 lg:px-6 lg:pt-3 lg:pb-0">
          <div
            ref={filterBarRef}
            className="flex gap-1.5 overflow-x-auto scrollbar-hide px-3 py-2.5 lg:px-0 lg:py-3"
            style={{
              scrollbarWidth: "none",
              msOverflowStyle: "none",
              WebkitOverflowScrolling: "touch",
            }}
          >
            {filterTabs.map((tab, index) => {
              const isActive = activeFilter === tab.id;
              const hasBadge = (tab.id === 'table-booking' && pendingBookingsCount > 0) ||
                (tab.id === 'new' && pendingNewOrders.length > 0) ||
                (tab.id === 'all' && pendingOrdersCount > 0);

              return (
                <motion.button
                  key={tab.id}
                  onClick={() => {
                    if (!isTransitioning) {
                      setIsTransitioning(true);
                      setActiveFilter(tab.id);
                      scrollToFilter(index);
                      setTimeout(() => setIsTransitioning(false), 300);
                    }
                  }}
                  className={`relative shrink-0 rounded-full px-4 py-2 text-xs font-medium whitespace-nowrap transition-all duration-200 ${isActive
                      ? "bg-[var(--primary)] text-white shadow-lg shadow-[var(--primary)]/30 scale-[1.02]"
                      : "bg-gray-100/80 text-gray-600 hover:bg-gray-200/80 hover:text-gray-900"
                    }`}
                  animate={{
                    scale: isActive ? 1.02 : 1,
                  }}
                  transition={{
                    duration: 0.3,
                    ease: [0.25, 0.1, 0.25, 1],
                  }}
                  whileTap={{ scale: 0.95 }}
                >
                  <div className="flex items-center gap-2">
                    {/* Icon */}
                    {tab.id === 'all' && (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                      </svg>
                    )}
                    {tab.id === 'new' && (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                      </svg>
                    )}
                    {tab.id === 'preparing' && (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )}
                    {tab.id === 'ready' && (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {tab.id === 'out-for-delivery' && (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                      </svg>
                    )}
                    {tab.id === 'table-booking' && (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                      </svg>
                    )}
                    {tab.id === 'completed' && (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )}
                    {tab.id === 'cancelled' && (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                    {tab.id === 'scheduled' && (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    )}

                    <span className="font-medium">{tab.label}</span>

                    {/* Badge */}
                    {tab.id === 'new' && pendingNewOrders.length > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-red-500 text-white text-[9px] font-bold animate-pulse">
                        {pendingNewOrders.length}
                      </span>
                    )}
                    {tab.id === 'table-booking' && pendingBookingsCount > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-red-500 text-white text-[9px] font-bold animate-pulse">
                        {pendingBookingsCount}
                      </span>
                    )}
                    {tab.id === 'all' && pendingOrdersCount > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-amber-500 text-white text-[9px] font-bold">
                        {pendingOrdersCount}
                      </span>
                    )}

                    {/* Active indicator dot */}
                    {isActive && (
                      <span className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-white/70" />
                    )}
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>
     

        {/* Content Area - Split pane on desktop */}
        <div className="flex min-h-0 flex-1 overflow-hidden lg:gap-2 lg:py-1">
          {/* Left Content */}
          <div
            ref={contentRef}
            className="flex-1 overflow-y-auto px-4 pb-8 lg:max-w-none lg:px-6 lg:pb-6 scrollbar-hide"
            style={{
              overflowY: 'auto',
              overflowX: 'hidden',
              height: '100%',
              maxHeight: '100%',
              scrollBehavior: 'smooth',
              WebkitOverflowScrolling: 'touch',
            }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onMouseDown={(e) => {
              mouseStartX.current = e.clientX;
              mouseEndX.current = e.clientX;
              isMouseDown.current = true;
              isSwiping.current = false;
            }}
            onMouseMove={(e) => {
              if (isMouseDown.current) {
                if (!isSwiping.current) {
                  const deltaX = Math.abs(e.clientX - mouseStartX.current);
                  if (deltaX > 10) {
                    isSwiping.current = true;
                  }
                }
                if (isSwiping.current) {
                  mouseEndX.current = e.clientX;
                }
              }
            }}
            onMouseUp={() => {
              if (isMouseDown.current && isSwiping.current) {
                const swipeDistance = mouseStartX.current - mouseEndX.current;
                const minSwipeDistance = 50;

                if (
                  Math.abs(swipeDistance) > minSwipeDistance &&
                  !isTransitioning
                ) {
                  const currentIndex = filterTabs.findIndex(
                    (tab) => tab.id === activeFilter,
                  );
                  let newIndex = currentIndex;

                  if (swipeDistance > 0 && currentIndex < filterTabs.length - 1) {
                    newIndex = currentIndex + 1;
                  } else if (swipeDistance < 0 && currentIndex > 0) {
                    newIndex = currentIndex - 1;
                  }

                  if (newIndex !== currentIndex) {
                    setIsTransitioning(true);
                    setTimeout(() => {
                      setActiveFilter(filterTabs[newIndex].id);
                      scrollToFilter(newIndex);
                      setTimeout(() => setIsTransitioning(false), 300);
                    }, 50);
                  }
                }
              }

              isMouseDown.current = false;
              isSwiping.current = false;
              mouseStartX.current = 0;
              mouseEndX.current = 0;
            }}
            onMouseLeave={() => {
              isMouseDown.current = false;
              isSwiping.current = false;
            }}
          >
            <style>{`
      /* Custom scrollbar styling */
      .content-scroll {
        scrollbar-width: thin;
        scrollbar-color: #d1d5db transparent;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
      }
      .content-scroll::-webkit-scrollbar {
        width: 4px;
      }
      .content-scroll::-webkit-scrollbar-track {
        background: transparent;
      }
      .content-scroll::-webkit-scrollbar-thumb {
        background: #d1d5db;
        border-radius: 20px;
      }
      .content-scroll::-webkit-scrollbar-thumb:hover {
        background: #9ca3af;
      }
    `}</style>

            {/* Verification Pending Card */}
            {!restaurantStatus.isLoading &&
              !restaurantStatus.isActive &&
              restaurantStatus.onboarding?.completedSteps === 4 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.1 }}
                  className={`mt-4 mb-4 rounded-2xl shadow-sm px-6 py-4 ${restaurantStatus.rejectionReason
                      ? "bg-white border border-red-200"
                      : "bg-white border border-yellow-200"
                    }`}>
                  {restaurantStatus.rejectionReason ? (
                    <>
                      <div className="flex items-start gap-3 mb-3">
                        <div className="flex-shrink-0 rounded-full p-2 bg-red-100">
                          <AlertCircle className="w-5 h-5 text-red-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-lg font-bold text-red-600 mb-2">
                            Denied Verification
                          </h3>
                          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                            <p className="text-xs font-semibold text-red-800 mb-2">
                              Reason for Rejection:
                            </p>
                            <div className="text-xs text-red-700 space-y-1">
                              {restaurantStatus.rejectionReason
                                .split("\n")
                                .filter((line) => line.trim()).length > 1 ? (
                                <ul className="space-y-1 list-disc list-inside">
                                  {restaurantStatus.rejectionReason
                                    .split("\n")
                                    .map(
                                      (point, index) =>
                                        point.trim() && (
                                          <li key={index}>{point.trim()}</li>
                                        ),
                                    )}
                                </ul>
                              ) : (
                                <p className="text-red-700">
                                  {restaurantStatus.rejectionReason}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                      <p className="text-sm text-gray-700 mb-3">
                        Please correct the above issues and click "Reverify" to
                        resubmit your request for approval.
                      </p>
                      <button
                        onClick={handleReverify}
                        disabled={isReverifying}
                        className="w-full px-6 py-2.5 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                        {isReverifying ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Submitting...
                          </>
                        ) : (
                          "Reverify"
                        )}
                      </button>
                    </>
                  ) : (
                    <>
                      <h3 className="text-lg font-bold text-gray-900 mb-1">
                        Verification Done in 24 Hours
                      </h3>
                      <p className="text-sm text-gray-600">
                        Your account is under verification. You'll be notified once
                        approved.
                      </p>
                    </>
                  )}
                </motion.div>
              )}

            {/* Dining Approval Pending Card */}
            {pendingDiningRequest && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 mb-4 rounded-2xl shadow-sm px-6 py-4 bg-white border border-blue-200">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 rounded-full bg-blue-100">
                    <Clock className="w-4 h-4 text-blue-600" />
                  </div>
                  <h3 className="text-base font-bold text-gray-900">
                    Dining Activation Request Pending
                  </h3>
                </div>
                <p className="text-sm text-gray-600">
                  Your request to {pendingDiningRequest.requestedSettings?.isEnabled ? "enable" : "update"} dining services is being reviewed by our team. You'll be notified via SMS/Dashboard once it's approved.
                </p>
                <div className="mt-3 flex items-center gap-2 text-[10px] font-black text-blue-500 uppercase tracking-widest">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                  </span>
                  Under Review
                </div>
              </motion.div>
            )}

            <AnimatePresence mode="wait">
              <motion.div
                key={activeFilter}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}>
                {renderContent()}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Right Panel */}
          {/* Right Panel */}
          <aside className="hidden lg:flex lg:w-[420px] lg:shrink-0 lg:flex-col lg:bg-white lg:rounded-3xl lg:shadow-2xl lg:border lg:border-[var(--rt-border)] lg:mx-2 lg:my-1 lg:overflow-hidden lg:h-full">
            {selectedOrder ? (
              <OrderDetailPanel
                order={selectedOrder}
                onClose={() => setSelectedOrder(null)}
                className="rounded-3xl border-0 shadow-none"
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                  <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-gray-900">No order selected</p>
                <p className="mt-1 text-xs text-gray-500 max-w-xs">
                  Select an order from the list to view detailed information, items, and status
                </p>
              </div>
            )}
          </aside>
        </div>

      {/* Audio element */}
      <audio
        ref={audioRef}
        src={notificationSound}
        preload="auto"
        playsInline
      />

      <RestaurantPanelModal
        open={showRejectPopup}
        onClose={handleRejectCancel}
        title={`Reject Order ${orderToReject?.orderId || "#Order"}`}
        description="Please select a reason for rejecting this order"
        size="md"
        mobileMaxHeight="tall"
        zIndex={70}
        bodyClassName="max-h-[60vh] space-y-2 overflow-y-auto px-4 py-4 lg:px-5 lg:py-5"
        footer={
          <div className="flex gap-3">
            <button
              onClick={handleRejectCancel}
              className="flex-1 rounded-lg border-2 border-gray-300 bg-white py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleRejectConfirm}
              disabled={!rejectReason}
              className={`flex-1 rounded-lg py-3 text-sm font-semibold transition-colors ${
                rejectReason
                  ? "!bg-primary-orange !text-white hover:!bg-primary-orange/90"
                  : "cursor-not-allowed bg-gray-200 text-gray-400"
              }`}
            >
              Confirm Rejection
            </button>
          </div>
        }
      >
        {rejectReasons.map((reason) => (
          <button
            key={reason}
            onClick={() => setRejectReason(reason)}
            className={`w-full rounded-lg border-2 p-4 text-left transition-all ${
              rejectReason === reason
                ? "border-primary-orange bg-primary-orange/10"
                : "border-gray-200 bg-white hover:border-gray-300"
            }`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`text-sm font-medium ${
                  rejectReason === reason ? "text-primary-orange" : "text-gray-900"
                }`}
              >
                {reason}
              </span>
              {rejectReason === reason && (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-orange">
                  <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </div>
          </button>
        ))}
      </RestaurantPanelModal>

      <RestaurantPanelModal
        open={showCancelPopup && !!orderToCancel}
        onClose={handleCancelPopupClose}
        title={`Cancel Order ${orderToCancel?.orderId || "#Order"}`}
        description="Please provide a reason for cancelling this order"
        size="md"
        mobileMaxHeight="auto"
        zIndex={70}
        bodyClassName="space-y-3 px-4 py-4 lg:px-5 lg:py-5"
        footer={
          <div className="flex gap-3">
            <button
              onClick={handleCancelPopupClose}
              className="flex-1 rounded-lg border-2 border-gray-300 bg-white py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleCancelConfirm}
              disabled={!cancelReason}
              className={`flex-1 rounded-lg py-3 text-sm font-semibold transition-colors ${
                cancelReason
                  ? "!bg-red-600 !text-white hover:bg-red-700"
                  : "cursor-not-allowed bg-gray-200 text-gray-400"
              }`}
            >
              Confirm Cancellation
            </button>
          </div>
        }
      >
        {rejectReasons.map((reason) => (
          <button
            key={reason}
            type="button"
            onClick={() => setCancelReason(reason)}
            className={`w-full rounded-lg border-2 px-4 py-3 text-left transition-colors ${
              cancelReason === reason
                ? "border-red-500 bg-red-50"
                : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                  cancelReason === reason ? "border-red-500 bg-red-500" : "border-gray-300"
                }`}
              >
                {cancelReason === reason && (
                  <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <span className={`text-sm font-medium ${cancelReason === reason ? "text-red-700" : "text-gray-700"}`}>
                {reason}
              </span>
            </div>
          </button>
        ))}
      </RestaurantPanelModal>

      {!isDesktop && (
        <RestaurantPanelModal
          open={isSheetOpen && !!selectedOrder}
          onClose={() => setIsSheetOpen(false)}
          hideHeader
          mobileMaxHeight="full"
          bodyClassName="p-0"
        >
          <OrderDetailPanel
            order={selectedOrder}
            onClose={() => setIsSheetOpen(false)}
            className="max-h-[calc(90vh-2rem)]"
          />
        </RestaurantPanelModal>
      )}
    </div>
    </SelectedOrderContext.Provider>
  );
}


// Order Card Component
// Order Card Component
function OrderCard({
  orderId,
  mongoId,
  status,
  customerName,
  type,
  tableOrToken,
  timePlaced,
  eta,
  itemsSummary,
  paymentMethod,
  photoUrl,
  photoAlt,
  deliveryPartnerId,
  dispatchStatus,
  onSelect,
  onCancel,
  onMarkReady,
  isMarkingReady = false,
  scheduledAt = null,
  restaurantNote = null,
}) {
  const selectedOrderId = useContext(SelectedOrderContext);
  const isSelected = selectedOrderId != null && String(selectedOrderId) === String(orderId);
  const normalizedStatus = String(status || "").toLowerCase();
  const isReady = normalizedStatus === "ready";
  const isPreparing = normalizedStatus === "preparing";
  const brandColor = "#16A34A";

  const statusLabel = String(status || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className={`w-full rounded-xl p-3 mb-3 border shadow-sm relative overflow-hidden transition-colors ${isSelected
        ? "border-[var(--rt-primary-strong)] bg-[var(--rt-primary-soft)] ring-2 ring-[var(--rt-primary-strong)]/20"
        : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-md"
      }`}>
      <div
        className="absolute top-0 left-0 w-1 h-full"
        style={{ backgroundColor: brandColor }}
      />

      <div
        onClick={() => onSelect?.({
          orderId,
          status,
          customerName,
          type,
          tableOrToken,
          timePlaced,
          eta,
          itemsSummary,
          paymentMethod,
          scheduledAt,
          restaurantNote
        })}
        className="flex gap-3 items-start cursor-pointer pl-1"
      >
        {/* Photo Container */}
        <div className="h-14 w-14 rounded-lg overflow-hidden bg-slate-100 flex-shrink-0 border border-slate-200 mt-0.5">
          {photoUrl ? (
            <img src={photoUrl} alt={photoAlt} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full flex items-center justify-center p-1 bg-slate-100">
              <span className="text-[8px] font-bold text-slate-400 text-center leading-none uppercase">
                {photoAlt}
              </span>
            </div>
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Top Row: ID & Status Badge */}
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className="text-[13px] font-black text-slate-900 truncate">
              #<span style={{ color: brandColor }}>{orderId}</span>
            </h3>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              {scheduledAt && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200 text-[8px] font-bold uppercase">
                  <Calendar className="w-2.5 h-2.5" />
                  Scheduled
                </span>
              )}
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[8px] font-bold border uppercase tracking-wider ${isReady
                  ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                  : normalizedStatus === "confirmed" || normalizedStatus === "created"
                    ? "bg-amber-100 text-amber-700 border-amber-200"
                    : normalizedStatus === "preparing"
                      ? "bg-blue-100 text-blue-700 border-blue-200"
                      : "bg-slate-100 text-slate-700 border-slate-200"
                }`}>
                {normalizedStatus === "created" ? "New" : statusLabel}
              </span>

              {isPreparing && onCancel && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancel({ orderId, mongoId, customerName });
                  }}
                  className="p-1 rounded-full bg-rose-100 text-rose-600 hover:bg-rose-200 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Customer & Type */}
          <div className="flex items-center justify-between text-[10px] text-slate-600 font-semibold uppercase tracking-wide mb-1">
            <span className="truncate max-w-[60%]">{customerName}</span>
            <span className="whitespace-nowrap text-slate-500">{type}</span>
          </div>

          {/* Items Summary */}
          <p className="text-[11px] text-slate-700 font-medium truncate mb-1">
            {itemsSummary}
          </p>

          {restaurantNote && (
            <div className="mb-2 px-2.5 py-1.5 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-[10px] text-blue-700 font-semibold line-clamp-1">
                📝 Note: {restaurantNote}
              </p>
            </div>
          )}

          {/* Bottom Actions Row */}
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 mt-auto">
            {scheduledAt ? (
              <div className="flex flex-col gap-0.5">
                <span className="text-[8px] font-bold text-green-600 uppercase tracking-wider">Scheduled For</span>
                <span className="text-[10px] font-bold text-green-700">
                  {new Date(scheduledAt).toLocaleString("en-US", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true,
                  })}
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {!isReady && eta && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[8px] font-bold text-slate-500 uppercase tracking-wider">ETA</span>
                    <span className="text-[12px] font-bold text-slate-800">{eta}</span>
                  </div>
                )}
                <span className="text-[8px] text-slate-400 font-semibold uppercase">{timePlaced}</span>
              </div>
            )}

            <div className="flex items-center gap-1.5 flex-shrink-0">
              {(isPreparing || isReady || normalizedStatus === "confirmed") && (
                <>
                  {deliveryPartnerId && (
                    <div className="h-5 w-5 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600" title="Driver Assigned">
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}

                  {!deliveryPartnerId && isPreparing && (
                    <div className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 text-[7px] font-bold border border-amber-200 uppercase tracking-tighter">
                      No Rider
                    </div>
                  )}

                  {dispatchStatus !== "accepted" && (
                    <ResendNotificationButton
                      orderId={orderId}
                      mongoId={mongoId}
                      onSuccess={onSelect}
                    />
                  )}
                </>
              )}

              {isPreparing && onMarkReady && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMarkReady({ orderId, mongoId, customerName });
                  }}
                  disabled={isMarkingReady}
                  className="px-3 py-1.5 rounded-lg text-[9px] font-bold text-white shadow-sm transition-all hover:shadow-md active:scale-95 disabled:opacity-50"
                  style={{ backgroundColor: brandColor }}
                >
                  {isMarkingReady ? (
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    </span>
                  ) : (
                    "MARK READY"
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Preparing Orders List
function PreparingOrders({
  onSelectOrder,
  onCancel,
  refreshToken = 0,
  onStatusChanged,
}) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [markingReadyOrderIds, setMarkingReadyOrderIds] = useState({});

  useEffect(() => {
    let isMounted = true;

    const fetchOrders = async () => {
      try {
        // Fetch all orders and filter for 'preparing' status on frontend
        const response = await restaurantAPI.getOrders();

        if (!isMounted) return;

        if (response.data?.success && response.data.data?.orders) {
          // Filter orders with 'preparing' status only
          // 'confirmed' orders should only appear in popup notification, not in preparing list
          // After accepting, order status changes to 'preparing' and then appears here
          const preparingOrders = response.data.data.orders.filter(
            (order) =>
              order.status === "preparing" &&
              (order.items && order.items.length > 0),
          );

          const transformedOrders = preparingOrders.map((order) => {
            const initialETA = order.estimatedDeliveryTime || 30; // in minutes
            const preparingTimestamp = order.tracking?.preparing?.timestamp
              ? new Date(order.tracking.preparing.timestamp)
              : new Date(order.createdAt); // Fallback to createdAt if preparing timestamp not available

            return {
              orderId: order.orderId || order._id,
              mongoId: order._id,
              status: order.status || "preparing",
              customerName: order.userId?.name || "Customer",
              type:
                order.deliveryFleet === "standard"
                  ? "Home Delivery"
                  : "Express Delivery",
              tableOrToken: null,
              timePlaced: new Date(order.createdAt).toLocaleTimeString(
                "en-US",
                { hour: "2-digit", minute: "2-digit" },
              ),
              initialETA, // Store initial ETA in minutes
              preparingTimestamp, // Store when order started preparing
              itemsSummary:
                order.items
                  ?.map((item) => `${item.quantity}x ${item.name}`)
                  .join(", ") || "No items",
              photoUrl: order.items?.[0]?.image || null,
              photoAlt: order.items?.[0]?.name || "Order",
              deliveryPartnerId: order.deliveryPartnerId || null,
              dispatchStatus: order.dispatch?.status || null,
              paymentMethod:
                order.paymentMethod || order.payment?.method || null,
              scheduledAt: order.scheduledAt || null,
              restaurantNote: order.restaurantNote || null,
            };
          });

          if (isMounted) {
            setOrders(transformedOrders);
            setLoading(false);
          }
        } else {
          if (isMounted) {
            setOrders([]);
            setLoading(false);
          }
        }
      } catch (error) {
        if (!isMounted) return;

        // Don't log network errors, 404, or 401 errors
        // 401 is handled by axios interceptor (token refresh/redirect)
        // 404 means no orders found (normal)
        // ERR_NETWORK means backend is down (expected in dev)
        if (
          error.code !== "ERR_NETWORK" &&
          error.response?.status !== 404 &&
          error.response?.status !== 401
        ) {
          debugError("Error fetching preparing orders:", error);
        }

        if (isMounted) {
          setOrders([]);
          setLoading(false);
        }
      }
    };

    fetchOrders();

    // Update countdown every second
    const countdownIntervalId = setInterval(() => {
      if (isMounted) {
        setCurrentTime(new Date());
      }
    }, 1000);

    return () => {
      isMounted = false;
      if (countdownIntervalId) {
        clearInterval(countdownIntervalId);
      }
    };
  }, [refreshToken]); // Re-fetch only when parent requests it

  // Track which orders have been marked as ready to avoid duplicate API calls
  const markedReadyOrdersRef = useRef(new Set());

  // Auto-mark orders as ready when ETA reaches 0
  useEffect(() => {
    if (!currentTime || orders.length === 0) return;

    const checkAndMarkReady = async () => {
      for (const order of orders) {
        const orderKey = order.mongoId || order.orderId;

        // Skip if already marked as ready
        if (markedReadyOrdersRef.current.has(orderKey)) {
          continue;
        }

        // Calculate remaining ETA
        const elapsedMs = currentTime - order.preparingTimestamp;
        const elapsedMinutes = Math.floor(elapsedMs / 60000);
        const remainingMinutes = Math.max(0, order.initialETA - elapsedMinutes);

        // If ETA has reached 0 (or slightly past), mark as ready
        if (remainingMinutes <= 0 && order.status === "preparing") {
          const elapsedSeconds = Math.floor(elapsedMs / 1000);
          const totalETASeconds = order.initialETA * 60;

          // Mark as ready when ETA time has elapsed (with 2 second buffer)
          if (elapsedSeconds >= totalETASeconds - 2) {
            try {
              debugLog(
                `?? Auto-marking order ${order.orderId} as ready (ETA reached 0)`,
              );
              markedReadyOrdersRef.current.add(orderKey); // Mark as processing
              await restaurantAPI.markOrderReady(
                order.mongoId || order.orderId,
              );
              debugLog(`? Order ${order.orderId} marked as ready`);
              onStatusChanged?.();
              // Order will be removed from preparing list on next fetch
            } catch (error) {
              const status = error.response?.status;
              const msg = (
                error.response?.data?.message ||
                error.message ||
                ""
              ).toLowerCase();
              // If 400 and message says order cannot be marked ready (e.g. already ready),
              // treat as idempotent - backend cron or another client already marked it.
              if (
                status === 400 &&
                (msg.includes("cannot be marked as ready") ||
                  msg.includes("current status"))
              ) {
                // Keep in markedReadyOrdersRef so we don't retry; order will disappear on next fetch
              } else {
                debugError(
                  `? Failed to auto-mark order ${order.orderId} as ready:`,
                  error,
                );
                markedReadyOrdersRef.current.delete(orderKey);
              }
              // Don't show error toast - it will retry on next check (for non-idempotent errors)
            }
          }
        }
      }
    };

    // Check every 2 seconds for orders that need to be marked ready
    const readyCheckInterval = setInterval(checkAndMarkReady, 2000);

    return () => {
      clearInterval(readyCheckInterval);
    };
  }, [currentTime, orders]);

  // Clear marked orders when orders list changes (orders moved to ready)
  useEffect(() => {
    const currentOrderKeys = new Set(orders.map((o) => o.mongoId || o.orderId));
    // Remove keys that are no longer in the preparing orders list
    for (const key of markedReadyOrdersRef.current) {
      if (!currentOrderKeys.has(key)) {
        markedReadyOrdersRef.current.delete(key);
      }
    }
  }, [orders]);

  const handleMarkReady = async ({ orderId, mongoId, customerName }) => {
    const orderKey = mongoId || orderId;
    if (!orderKey || markingReadyOrderIds[orderKey]) return;

    try {
      setMarkingReadyOrderIds((prev) => ({ ...prev, [orderKey]: true }));
      await restaurantAPI.markOrderReady(orderKey);
      setOrders((prev) =>
        prev.filter((order) => (order.mongoId || order.orderId) !== orderKey),
      );
      toast.success(
        `Order ${orderId} marked ready${customerName ? ` for ${customerName}` : ""}`,
      );
      onStatusChanged?.();
    } catch (error) {
      const status = error.response?.status;
      const message =
        error.response?.data?.message || "Failed to mark order as ready";
      if (
        status === 400 &&
        String(message).toLowerCase().includes("current status")
      ) {
        setOrders((prev) =>
          prev.filter((order) => (order.mongoId || order.orderId) !== orderKey),
        );
        toast.success(`Order ${orderId} is already ready`);
        onStatusChanged?.();
      } else {
        toast.error(message);
      }
    } finally {
      setMarkingReadyOrderIds((prev) => {
        const next = { ...prev };
        delete next[orderKey];
        return next;
      });
    }
  };

  if (loading) {
    return (
      <div className="pt-4 pb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-black">
            Preparing orders
          </h2>
          <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        </div>
        <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="pt-4 pb-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-black">Preparing orders</h2>
        <span className="text-xs text-gray-500">{orders.length} active</span>
      </div>
      {orders.length === 0 ? (
        <EmptyOrdersState message="No orders in preparation" />
      ) : (
        <div>
          {orders.map((order) => {
            // Calculate remaining ETA (countdown)
            const elapsedMs = currentTime - order.preparingTimestamp;
            const elapsedMinutes = Math.floor(elapsedMs / 60000);
            const remainingMinutes = Math.max(
              0,
              order.initialETA - elapsedMinutes,
            );

            // Format ETA display
            let etaDisplay = "";
            if (remainingMinutes <= 0) {
              const remainingSeconds = Math.max(
                0,
                Math.floor(order.initialETA * 60 - elapsedMs / 1000),
              );
              if (remainingSeconds > 0) {
                etaDisplay = `${remainingSeconds} secs`;
              } else {
                etaDisplay = "0 mins";
              }
            } else {
              etaDisplay = `${remainingMinutes} mins`;
            }

            return (
              <OrderCard
                key={order.orderId || order.mongoId}
                orderId={order.orderId}
                mongoId={order.mongoId}
                status={order.status}
                customerName={order.customerName}
                type={order.type}
                tableOrToken={order.tableOrToken}
                timePlaced={order.timePlaced}
                eta={etaDisplay}
                itemsSummary={order.itemsSummary}
                photoUrl={order.photoUrl}
                photoAlt={order.photoAlt}
                paymentMethod={order.paymentMethod}
                deliveryPartnerId={order.deliveryPartnerId}
                dispatchStatus={order.dispatchStatus}
                onSelect={onSelectOrder}
                onCancel={onCancel}
                onMarkReady={handleMarkReady}
                isMarkingReady={Boolean(
                  markingReadyOrderIds[order.mongoId || order.orderId],
                )}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// Ready Orders List
function ReadyOrders({ onSelectOrder, refreshToken = 0 }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const fetchOrders = async () => {
      try {
        // Fetch all orders and filter for 'ready' status on frontend
        const response = await restaurantAPI.getOrders();

        if (!isMounted) return;

        if (response.data?.success && response.data.data?.orders) {
          // Filter orders with 'ready' status
          const readyOrders = response.data.data.orders.filter(
            (order) =>
              order.status === "ready" &&
              (order.items && order.items.length > 0),
          );

          const transformedOrders = readyOrders.map((order) => ({
            orderId: order.orderId || order._id,
            mongoId: order._id,
            status: order.status || "ready",
            customerName: order.userId?.name || "Customer",
            type:
              order.deliveryFleet === "standard"
                ? "Home Delivery"
                : "Express Delivery",
            tableOrToken: null,
            timePlaced: new Date(order.createdAt).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            }),
            eta: null, // Don't show ETA for ready orders
            itemsSummary:
              order.items
                ?.map((item) => `${item.quantity}x ${item.name}`)
                .join(", ") || "No items",
            photoUrl: order.items?.[0]?.image || null,
            photoAlt: order.items?.[0]?.name || "Order",
            paymentMethod: order.paymentMethod || order.payment?.method || null,
            deliveryPartnerId: order.deliveryPartnerId || null,
            dispatchStatus: order.dispatch?.status || null,
            scheduledAt: order.scheduledAt || null,
            restaurantNote: order.restaurantNote || null,
          }));

          if (isMounted) {
            setOrders(transformedOrders);
            setLoading(false);
          }
        } else {
          if (isMounted) {
            setOrders([]);
            setLoading(false);
          }
        }
      } catch (error) {
        if (!isMounted) return;

        // Don't log network errors repeatedly - they're expected if backend is down
        if (error.code !== "ERR_NETWORK" && error.response?.status !== 404) {
          debugError("Error fetching ready orders:", error);
        }

        if (isMounted) {
          setOrders([]);
          setLoading(false);
        }
      }
    };

    fetchOrders();

    return () => {
      isMounted = false;
    };
  }, [refreshToken]); // Re-fetch only when parent requests it

  if (loading) {
    return (
      <div className="pt-4 pb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-black">
            Ready for pickup
          </h2>
          <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        </div>
        <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="pt-4 pb-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-black">Ready for pickup</h2>
        <span className="text-xs text-gray-500">{orders.length} active</span>
      </div>
      {orders.length === 0 ? (
        <EmptyOrdersState message="No orders ready for pickup" />
      ) : (
        <div>
          {orders.map((order) => (
            <OrderCard
              key={order.orderId || order.mongoId}
              {...order}
              onSelect={onSelectOrder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Out for Delivery Orders List
const OutForDeliveryOrders = ({ onSelectOrder, refreshToken = 0 }) => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const fetchOrders = async () => {
      try {
        // Fetch all orders and filter for 'out_for_delivery' status on frontend
        const response = await restaurantAPI.getOrders();

        if (!isMounted) return;

        if (response.data?.success && response.data.data?.orders) {
          // Filter orders with 'out_for_delivery' status
          const outForDeliveryOrders = response.data.data.orders.filter(
            (order) =>
              order.status === "out_for_delivery" &&
              (order.items && order.items.length > 0),
          );

          const transformedOrders = outForDeliveryOrders.map((order) => ({
            orderId: order.orderId || order._id,
            mongoId: order._id,
            status: order.status || "out_for_delivery",
            customerName: order.userId?.name || "Customer",
            type:
              order.deliveryFleet === "standard"
                ? "Home Delivery"
                : "Express Delivery",
            tableOrToken: null,
            timePlaced: new Date(order.createdAt).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            }),
            eta: null,
            itemsSummary:
              order.items
                ?.map((item) => `${item.quantity}x ${item.name}`)
                .join(", ") || "No items",
            photoUrl: order.items?.[0]?.image || null,
            photoAlt: order.items?.[0]?.name || "Order",
            paymentMethod: order.paymentMethod || order.payment?.method || null,
            deliveryPartnerId: order.deliveryPartnerId || null,
            dispatchStatus: order.dispatch?.status || null,
            scheduledAt: order.scheduledAt || null,
            restaurantNote: order.restaurantNote || null,
          }));

          if (isMounted) {
            setOrders(transformedOrders);
            setLoading(false);
          }
        } else {
          if (isMounted) {
            setOrders([]);
            setLoading(false);
          }
        }
      } catch (error) {
        if (!isMounted) return;

        // Don't log network errors repeatedly - they're expected if backend is down
        if (error.code !== "ERR_NETWORK" && error.response?.status !== 404) {
          debugError("Error fetching out for delivery orders:", error);
        }

        if (isMounted) {
          setOrders([]);
          setLoading(false);
        }
      }
    };

    fetchOrders();

    return () => {
      isMounted = false;
    };
  }, [refreshToken]); // Re-fetch only when parent requests it

  if (loading) {
    return (
      <div className="pt-4 pb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-black">
            Out for delivery
          </h2>
          <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        </div>
        <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="pt-4 pb-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-black">Out for delivery</h2>
        <span className="text-xs text-gray-500">{orders.length} active</span>
      </div>
      {orders.length === 0 ? (
        <EmptyOrdersState message="No orders out for delivery" />
      ) : (
        <div>
          {orders.map((order) => (
            <OrderCard
              key={order.orderId || order.mongoId}
              {...order}
              onSelect={onSelectOrder}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// Empty State Component
function EmptyState({ message = "Temporarily closed" }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] py-12">
      {/* Store Illustration */}
      <div className="mb-6">
        <svg
          width="200"
          height="200"
          viewBox="0 0 200 200"
          className="text-gray-300"
          fill="none"
          xmlns="http://www.w3.org/2000/svg">
          {/* Storefront */}
          <rect
            x="40"
            y="80"
            width="120"
            height="80"
            stroke="currentColor"
            strokeWidth="2"
            fill="white"
          />
          {/* Awning */}
          <path
            d="M30 80 L100 50 L170 80"
            stroke="currentColor"
            strokeWidth="2"
            fill="white"
          />
          {/* Doors */}
          <rect
            x="60"
            y="100"
            width="30"
            height="60"
            stroke="currentColor"
            strokeWidth="2"
            fill="white"
          />
          <rect
            x="110"
            y="100"
            width="30"
            height="60"
            stroke="currentColor"
            strokeWidth="2"
            fill="white"
          />
          {/* Laptop */}
          <rect
            x="70"
            y="140"
            width="40"
            height="25"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="white"
          />
          <text
            x="85"
            y="155"
            fontSize="8"
            fill="currentColor"
            textAnchor="middle">
            CLOSED
          </text>
          {/* Sign */}
          <rect
            x="80"
            y="170"
            width="40"
            height="20"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="white"
          />
        </svg>
      </div>

      {/* Message */}
      <h2 className="text-lg font-semibold text-gray-600 mb-4 text-center">
        {message}
      </h2>

      {/* View Status Button */}
      <button 
        onClick={() => {
          // If message is related to rejection/offline, go to status page, otherwise refresh orders
          if (message?.toLowerCase().includes("rejected") || message?.toLowerCase().includes("closed")) {
            window.location.href = "/food/restaurant/outlet-timings";
          } else {
            window.location.reload();
          }
        }}
        className="bg-black text-white px-6 py-3 rounded-lg font-medium hover:bg-gray-800 transition-colors">
        View status
      </button>
    </div>
  ); 
}

