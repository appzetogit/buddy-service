import { useState, useEffect, useMemo } from "react"
import { Eye, Printer, ArrowUpDown, Loader2, X, Bike, MoreVertical } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@food/components/ui/dropdown-menu"

const TERMINAL_ORDER_STATUSES = new Set([
  "Delivered",
  "Canceled",
  "Cancelled",
  "Cancelled by Restaurant",
  "Rejected by Restaurant",
  "Cancelled by User",
  "Cancelled by Admin",
  "Refunded",
  "Payment Failed",
])

const RESTAURANT_REJECTED_STATUSES = new Set([
  "Cancelled by Restaurant",
  "Rejected by Restaurant",
  "cancelled_by_restaurant",
  "rejected_by_restaurant",
])

const isActiveOrder = (order) => !TERMINAL_ORDER_STATUSES.has(order.orderStatus)

const canReassignDriver = (order) => {
  if (!isActiveOrder(order)) return false
  const status = String(order?.orderStatus || order?.status || "").trim()
  return !RESTAURANT_REJECTED_STATUSES.has(status)
}

const getStatusColor = (orderStatus) => {
  const colors = {
    "Delivered": "bg-emerald-100 text-emerald-700",
    "Pending": "bg-blue-100 text-blue-700",
    "Scheduled": "bg-blue-100 text-blue-700",
    "Accepted": "bg-green-100 text-green-700",
    "Processing": "bg-orange-100 text-orange-700",
    "Food On The Way": "bg-yellow-100 text-yellow-700",
    "Canceled": "bg-rose-100 text-rose-700",
    "Cancelled by Restaurant": "bg-red-100 text-red-700",
    "Rejected by Restaurant": "bg-red-100 text-red-700",
    "Cancelled by User": "bg-orange-100 text-orange-700",
    "Cancelled by Admin": "bg-red-100 text-red-700",
    "Payment Failed": "bg-red-100 text-red-700",
    "Refunded": "bg-sky-100 text-sky-700",
    "Dine In": "bg-indigo-100 text-indigo-700",
    "Offline Payments": "bg-slate-100 text-slate-700",
  }
  return colors[orderStatus] || "bg-slate-100 text-slate-700"
}

const getPaymentStatusColor = (paymentStatus) => {
  if (paymentStatus === "Paid") return "text-emerald-600"
  if (paymentStatus === "Refunded") return "text-sky-600"
  if (paymentStatus === "Unpaid" || paymentStatus === "Failed") return "text-red-600"
  return "text-slate-600"
}

export default function OrdersTable({
  orders,
  visibleColumns,
  onViewOrder,
  onPrintOrder,
  onRefund,
  onCancelOrder,
  onReassignDriver,
  actionLoadingOrderId,
  currentPage: controlledPage,
  totalPages: controlledTotalPages,
  totalItems: controlledTotalItems,
  pageSize = 20,
  onPageChange,
}) {
  const isServerPaginated = typeof onPageChange === "function"
  const [clientPage, setClientPage] = useState(1)
  const itemsPerPage = pageSize || 20

  const currentPage = isServerPaginated
    ? Math.max(1, Number(controlledPage) || 1)
    : clientPage

  const totalItems = isServerPaginated
    ? Math.max(0, Number(controlledTotalItems) || 0)
    : orders.length

  const totalPages = isServerPaginated
    ? Math.max(0, Number(controlledTotalPages) || 0)
    : Math.ceil(orders.length / itemsPerPage)

  // Reset client page when orders change (local pagination only)
  useEffect(() => {
    if (!isServerPaginated) {
      setClientPage(1)
    }
  }, [orders.length, isServerPaginated])

  const paginatedOrders = useMemo(() => {
    if (isServerPaginated) return orders
    const start = (currentPage - 1) * itemsPerPage
    const end = start + itemsPerPage
    return orders.slice(start, end)
  }, [orders, currentPage, itemsPerPage, isServerPaginated])

  const handlePageChange = (page) => {
    const nextPage = Math.max(1, Math.min(page, Math.max(totalPages, 1)))
    if (isServerPaginated) {
      onPageChange(nextPage)
    } else {
      setClientPage(nextPage)
    }
  }

  const formatRestaurantName = (name) => {
    if (name === "Cafe Monarch") return "Café Monarch"
    return name
  }

  if (orders.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-32 h-32 bg-gradient-to-br from-slate-100 to-slate-200 rounded-2xl flex items-center justify-center mb-6 shadow-inner">
            <div className="w-20 h-20 bg-white rounded-xl flex items-center justify-center shadow-md">
              <span className="text-5xl text-orange-500 font-bold">!</span>
            </div>
          </div>
          <p className="text-lg font-semibold text-slate-700 mb-1">No Data Found</p>
          <p className="text-sm text-slate-500">There are no orders matching your criteria</p>
        </div>
      </div>
    )
  }

  const rangeStart = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1
  const rangeEnd = Math.min(currentPage * itemsPerPage, totalItems)

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden w-full max-w-full">
      <div className="overflow-x-auto">
        <table className="w-full min-w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {visibleColumns.si && (
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  <div className="flex items-center gap-2">
                    <span>SI</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                  </div>
                </th>
              )}
              {visibleColumns.orderId && (
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  <div className="flex items-center gap-2">
                    <span>Order ID</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                  </div>
                </th>
              )}
              {visibleColumns.orderDate && (
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  <div className="flex items-center gap-2">
                    <span>Order Date</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                  </div>
                </th>
              )}
              {visibleColumns.orderOtp && (
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  <div className="flex items-center gap-2">
                    <span>Order OTP</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                  </div>
                </th>
              )}
              {visibleColumns.customer && (
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  <div className="flex items-center gap-2">
                    <span>Customer Name</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                  </div>
                </th>
              )}
              {visibleColumns.restaurant && (
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  <div className="flex items-center gap-2">
                    <span>Restaurant</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                  </div>
                </th>
              )}
              {visibleColumns.foodItems && (
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider min-w-[200px]">
                  <div className="flex items-center gap-2">
                    <span>Food Items</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                  </div>
                </th>
              )}
              {visibleColumns.itemPrice && (
                <th className="px-6 py-4 text-right text-[10px] font-bold text-slate-700 uppercase tracking-wider min-w-[120px]">
                  <div className="flex items-center justify-end gap-2">
                    <span>Price</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                  </div>
                </th>
              )}
              {visibleColumns.deliveryCharge && (
                <th className="px-6 py-4 text-right text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  <div className="flex items-center justify-end gap-2">
                    <span>Delivery Charge</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                  </div>
                </th>
              )}
              {visibleColumns.totalAmount && (
                <th className="px-6 py-4 text-right text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  <div className="flex items-center justify-end gap-2">
                    <span>Price</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                  </div>
                </th>
              )}
              {visibleColumns.paymentType && (
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  <div className="flex items-center gap-2">
                    <span>Payment Type</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                  </div>
                </th>
              )}
              {visibleColumns.paymentCollectionStatus && (
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  <div className="flex items-center gap-2">
                    <span>Payment Status</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                  </div>
                </th>
              )}
              {visibleColumns.paymentMethodDetail && (
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  <div className="flex items-center gap-2">
                    <span>Payment Method</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                  </div>
                </th>
              )}
              {visibleColumns.orderStatus && (
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  <div className="flex items-center gap-2">
                    <span>Order Status</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                  </div>
                </th>
              )}
              {visibleColumns.actions && (
                <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-100">
            {paginatedOrders.map((order, index) => (
              <tr 
                key={order.orderId} 
                className="hover:bg-slate-50 transition-colors"
              >
                {visibleColumns.si && (
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm font-medium text-slate-700">{(currentPage - 1) * itemsPerPage + index + 1}</span>
                  </td>
                )}
                {visibleColumns.orderId && (
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm font-medium text-slate-900">{order.orderId}</span>
                  </td>
                )}
                {visibleColumns.orderDate && (
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm font-medium text-slate-700">{order.date}, {order.time}</span>
                  </td>
                )}
                {visibleColumns.orderOtp && (
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm font-semibold text-slate-900">
                      {order.orderOtp || "--"}
                    </span>
                  </td>
                )}
                {visibleColumns.customer && (
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm font-medium text-slate-700">{order.customerName || "N/A"}</span>
                  </td>
                )}
                {visibleColumns.restaurant && (
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm font-medium text-slate-700">{formatRestaurantName(order.restaurant)}</span>
                  </td>
                )}
                {visibleColumns.foodItems && (
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-2 min-w-[200px] max-w-md">
                      {order.items && Array.isArray(order.items) && order.items.length > 0 ? (
                        order.items.map((item, idx) => (
                          <div key={idx || item.itemId || idx} className="flex items-center gap-2 text-sm">
                            <span className="font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded min-w-[2.5rem] text-center">
                              {item.quantity || 1}x
                            </span>
                            <span className="text-slate-800 font-medium flex-1">
                              {item.name || item.itemName || item.title || 'Unknown Item'}
                            </span>
                          </div>
                        ))
                      ) : (
                        <span className="text-sm text-slate-400 italic">No items found</span>
                      )}
                    </div>
                  </td>
                )}
                {visibleColumns.itemPrice && (
                  <td className="px-6 py-4 text-right">
                    <div className="flex flex-col gap-2 min-w-[120px]">
                      {order.items && Array.isArray(order.items) && order.items.length > 0 ? (
                        order.items.map((item, idx) => {
                          const itemPrice = Number(item.price ?? 0)
                          return (
                            <div key={idx || item.itemId || `item-price-${idx}`} className="text-sm text-slate-500">
                              {`₹${itemPrice.toLocaleString(undefined, {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 2
                              })}`}
                            </div>
                          )
                        })
                      ) : (
                        <span className="text-sm text-slate-400 italic">-</span>
                      )}
                    </div>
                  </td>
                )}
                {visibleColumns.deliveryCharge && (
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <span className="text-sm font-medium text-slate-700">
                      {(() => {
                        const deliveryCharge = Number(order.deliveryCharge ?? 0)
                        return `₹${deliveryCharge.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2
                        })}`
                      })()}
                    </span>
                  </td>
                )}
                {visibleColumns.totalAmount && (
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <span className="text-sm font-semibold text-slate-900">
                      {(() => {
                        const rawAmount =
                          order.totalAmount ??
                          order.total ??
                          order.pricing?.total ??
                          0;
                        const amount = Number.isFinite(Number(rawAmount))
                          ? Number(rawAmount)
                          : 0;
                        return `₹${amount.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2
                        })}`;
                      })()}
                    </span>
                  </td>
                )}
                {visibleColumns.paymentType && (
                  <td className="px-6 py-4 whitespace-nowrap">
                    {(() => {
                      let paymentTypeDisplay = order.paymentType;
                      const paymentMethod = order.payment?.method || order.paymentMethod || order.payment?.paymentMethod;
                      
                      if (paymentMethod === 'razorpay_qr') {
                        paymentTypeDisplay = 'COD (QR)';
                      } else if (!paymentTypeDisplay) {
                        if (paymentMethod === 'cash' || paymentMethod === 'cod') {
                          paymentTypeDisplay = 'Cash on Delivery';
                        } else if (paymentMethod === 'wallet') {
                          paymentTypeDisplay = 'Wallet';
                        } else {
                          paymentTypeDisplay = 'Online';
                        }
                      }
                      
                      if (paymentMethod === 'wallet' && paymentTypeDisplay !== 'Wallet') {
                        paymentTypeDisplay = 'Wallet';
                      }
                      
                      const isCod = paymentTypeDisplay === 'Cash on Delivery' || paymentTypeDisplay === 'COD (QR)';
                      const isWallet = paymentTypeDisplay === 'Wallet';
                      
                      const codInfo = order.payment?.cod?.enabled ? order.payment.cod : null;
                      if (codInfo) {
                        return (
                          <div>
                            <span className="text-sm font-medium text-amber-600">COD + Advance</span>
                            <div className="text-[11px] text-slate-500">
                              Advance ₹{Number(codInfo.advanceAmount || 0).toFixed(0)} paid · ₹{Number(codInfo.remainingAmount || 0).toFixed(0)} on delivery
                            </div>
                          </div>
                        );
                      }
                      return (
                        <span className={`text-sm font-medium ${
                          isCod ? 'text-amber-600' : 
                          isWallet ? 'text-purple-600' : 
                          'text-emerald-600'
                        }`}>
                          {paymentTypeDisplay}
                        </span>
                      );
                    })()}
                  </td>
                )}
                {visibleColumns.paymentCollectionStatus && (
                  <td className="px-6 py-4 whitespace-nowrap">
                    {order.payment?.cod?.enabled ? (
                      <span className={`text-sm font-medium ${order.payment.cod.advanceStatus === "refunded" ? "text-sky-600" : (order.payment.cod.collectedAt || order.payment.status === "paid") ? "text-emerald-600" : "text-amber-600"}`}>
                        {order.payment.cod.advanceStatus === "refunded"
                          ? `Advance refunded ₹${Number(order.payment.cod.refundedAmount || 0).toFixed(0)}`
                          : (order.payment.cod.collectedAt || order.payment.status === "paid")
                            ? "Collected"
                            : `₹${Number(order.payment.cod.remainingAmount || 0).toFixed(0)} to collect`}
                      </span>
                    ) : (
                      <span className={`text-sm font-medium ${getPaymentStatusColor(order.paymentStatus)}`}>
                        {order.paymentStatus || "Pending"}
                      </span>
                    )}
                  </td>
                )}
                {visibleColumns.paymentMethodDetail && (
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full ${
                      (order.paymentMethodDetail === "QR" || order.paymentMethodDetail === "COD/QR")
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-100" 
                        : order.paymentMethodDetail === "Wallet"
                        ? "bg-violet-50 text-violet-700 border border-violet-100"
                        : order.paymentMethodDetail === "Online"
                        ? "bg-sky-50 text-sky-700 border border-sky-100"
                        : "bg-amber-50 text-amber-700 border border-amber-100"
                    }`}>
                      {order.paymentMethodDetail || order.paymentType || "N/A"}
                    </span>
                  </td>
                )}
                {visibleColumns.orderStatus && (
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(order.orderStatus)}`}>
                      {order.orderStatus}
                    </span>
                  </td>
                )}
                {visibleColumns.actions && (
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="p-1.5 rounded text-slate-600 hover:bg-slate-100 transition-colors">
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-50">
                        {isActiveOrder(order) && onCancelOrder && (
                          <DropdownMenuItem
                            onClick={() => onCancelOrder(order)}
                            disabled={actionLoadingOrderId === (order.id || order.orderId)}
                            className="cursor-pointer flex items-center gap-2 text-rose-600 focus:text-rose-700"
                          >
                            {actionLoadingOrderId === (order.id || order.orderId) ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <X className="w-4 h-4" />
                            )}
                            <span>Cancel Order</span>
                          </DropdownMenuItem>
                        )}
                        {canReassignDriver(order) && onReassignDriver && (
                          <DropdownMenuItem
                            onClick={() => onReassignDriver(order)}
                            disabled={actionLoadingOrderId === (order.id || order.orderId)}
                            className="cursor-pointer flex items-center gap-2 text-emerald-600 focus:text-emerald-700"
                          >
                            <Bike className="w-4 h-4" />
                            <span>Reassign Driver</span>
                          </DropdownMenuItem>
                        )}
                        {((isActiveOrder(order) && onCancelOrder) ||
                          (canReassignDriver(order) && onReassignDriver)) && (
                          <DropdownMenuSeparator />
                        )}
                        <DropdownMenuItem
                          onClick={() => onViewOrder(order)}
                          className="cursor-pointer flex items-center gap-2 text-orange-600"
                        >
                          <Eye className="w-4 h-4" />
                          <span>View Details</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => onPrintOrder(order)}
                          className="cursor-pointer flex items-center gap-2 text-blue-600"
                        >
                          <Printer className="w-4 h-4" />
                          <span>Print Invoice</span>
                        </DropdownMenuItem>
                        {(() => {
                          const isCancelled = order.orderStatus === "Cancelled by Restaurant" || 
                                            order.orderStatus === "Cancelled" || 
                                            order.orderStatus === "Canceled" ||
                                            order.orderStatus === "Cancelled by User" ||
                                            order.orderStatus === "Cancelled by Admin" ||
                                            (order.status === "cancelled" && (order.cancelledBy === "user" || order.cancelledBy === "restaurant" || order.cancelledBy === "admin"));
                          const paymentMethod = order.payment?.method || order.paymentMethod;
                          const isOnlinePayment = order.paymentType === "Online" ||
                                                (order.paymentType !== "Cash on Delivery" && 
                                                 order.payment?.method !== "cash" && 
                                                 order.payment?.method !== "cod" &&
                                                 (order.paymentMethod === "razorpay" || 
                                                  order.paymentMethod === "online" || 
                                                  order.payment?.paymentMethod === "razorpay" || 
                                                  order.payment?.method === "razorpay" ||
                                                  order.payment?.method === "online"));
                          const isWalletPayment = order.paymentType === "Wallet" || paymentMethod === "wallet";
                          return isCancelled && (isOnlinePayment || isWalletPayment);
                        })() && (
                          <>
                            <DropdownMenuSeparator />
                            {order.refundStatus === 'processed' || order.refundStatus === 'initiated' ? (
                              <DropdownMenuItem disabled className="flex items-center gap-2 text-emerald-600">
                                <span className="text-sm font-semibold">₹</span>
                                <span>{order.paymentType === "Wallet" || order.payment?.method === "wallet" ? "Wallet Refunded" : "Refunded"}</span>
                              </DropdownMenuItem>
                            ) : onRefund ? (
                              <DropdownMenuItem
                                onClick={() => onRefund(order)}
                                className="cursor-pointer flex items-center gap-2 text-blue-600 focus:text-blue-700"
                              >
                                <span className="text-sm font-semibold">₹</span>
                                <span>Refund</span>
                              </DropdownMenuItem>
                            ) : null}
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Pagination */}
      {(totalPages > 1 || (isServerPaginated && totalItems > 0)) && (
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-sm text-slate-600">
            Showing <span className="font-semibold">{rangeStart}</span> to{" "}
            <span className="font-semibold">{rangeEnd}</span> of{" "}
            <span className="font-semibold">{totalItems}</span> orders
            {isServerPaginated && (
              <span className="text-slate-400"> · {itemsPerPage} per page</span>
            )}
          </div>
          {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              Previous
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum
                if (totalPages <= 5) {
                  pageNum = i + 1
                } else if (currentPage <= 3) {
                  pageNum = i + 1
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i
                } else {
                  pageNum = currentPage - 2 + i
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => handlePageChange(pageNum)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${
                      currentPage === pageNum
                        ? "bg-emerald-500 text-white shadow-md"
                        : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {pageNum}
                  </button>
                )
              })}
            </div>
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              Next
            </button>
          </div>
          )}
        </div>
      )}
    </div>
  )
}


