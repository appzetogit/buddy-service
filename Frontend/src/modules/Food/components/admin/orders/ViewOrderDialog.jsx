import { useEffect, useMemo, useState } from "react"
import {
  Eye,
  MapPin,
  Package,
  User,
  Phone,
  Clock,
  Truck,
  CreditCard,
  Receipt,
  CheckCircle2,
  FileText,
  ChevronDown,
  Store,
  History,
  Tag,
  Loader2,
  Star,
  X,
} from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@food/components/ui/dialog"
import { adminAPI } from "@food/api"

const money = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return "₹0.00"
  return `₹${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const formatDateTime = (value) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
    .toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    .toUpperCase()
}

const humanizeStatus = (status) => {
  if (!status) return "Unknown"
  const map = {
    created: "Order Created",
    scheduled: "Scheduled",
    confirmed: "Restaurant Accepted",
    preparing: "Preparing",
    ready_for_pickup: "Ready for Pickup",
    reached_pickup: "Rider Reached Pickup",
    picked_up: "Picked Up / On the Way",
    reached_drop: "Rider Reached Drop",
    delivered: "Delivered",
    cancelled_by_user: "Cancelled by User",
    cancelled_by_restaurant: "Cancelled by Restaurant",
    rejected_by_restaurant: "Rejected by Restaurant",
    cancelled_by_admin: "Cancelled by Admin",
    cancelled: "Cancelled",
    pending: "Pending",
    accepted: "Accepted",
    ready: "Ready",
    assigned: "Delivery Partner Assigned",
    unassigned: "Unassigned",
    rejected: "Rejected",
    reassigned: "Driver Reassigned",
    en_route_to_pickup: "En Route to Pickup",
    at_pickup: "At Pickup",
    en_route_to_delivery: "En Route to Delivery",
    at_drop: "At Drop",
    completed: "Completed",
  }
  const key = String(status).toLowerCase().trim()
  if (map[key]) return map[key]
  return String(status)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

const getStatusColor = (orderStatus) => {
  const colors = {
    Delivered: "bg-emerald-100 text-emerald-700",
    Pending: "bg-blue-100 text-blue-700",
    Scheduled: "bg-blue-100 text-blue-700",
    Accepted: "bg-green-100 text-green-700",
    Processing: "bg-orange-100 text-orange-700",
    "Food On The Way": "bg-yellow-100 text-yellow-700",
    Canceled: "bg-rose-100 text-rose-700",
    "Cancelled by Restaurant": "bg-red-100 text-red-700",
    "Rejected by Restaurant": "bg-red-100 text-red-700",
    "Cancelled by User": "bg-orange-100 text-orange-700",
    "Payment Failed": "bg-red-100 text-red-700",
    Refunded: "bg-sky-100 text-sky-700",
    "Dine In": "bg-indigo-100 text-indigo-700",
    "Offline Payments": "bg-slate-100 text-slate-700",
  }
  return colors[orderStatus] || "bg-slate-100 text-slate-700"
}

const getPaymentStatusColor = (paymentStatus) => {
  if (paymentStatus === "Paid" || paymentStatus === "Collected") return "text-emerald-600"
  if (paymentStatus === "Not Collected") return "text-amber-600"
  if (paymentStatus === "Unpaid" || paymentStatus === "Failed") return "text-red-600"
  return "text-slate-600"
}

const idOf = (value) => {
  if (!value) return ""
  if (typeof value === "string") return value
  if (typeof value === "object") return String(value._id || value.id || "")
  return String(value)
}

const formatAddress = (address) => {
  if (!address || typeof address !== "object") return "N/A"

  const formattedAddress = String(address.formattedAddress || "").trim()
  const rawAddress = String(address.address || "").trim()
  const parts = [
    formattedAddress,
    rawAddress,
    address.label,
    address.street,
    address.additionalDetails,
    address.landmark,
    address.addressLine1,
    address.addressLine2,
    address.area,
    address.city,
    address.state,
    address.zipCode,
    address.postalCode,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)

  const uniqueParts = []
  parts.forEach((part) => {
    const key = part.toLowerCase()
    const isContained = uniqueParts.some((existingPart) => {
      const existingKey = existingPart.toLowerCase()
      return existingKey === key || existingKey.includes(key) || key.includes(existingKey)
    })
    if (isContained) return
    uniqueParts.push(part)
  })

  return uniqueParts.length > 0 ? uniqueParts.join(", ") : "Address not available"
}

const getCoordinates = (address) => {
  if (
    address?.location?.coordinates &&
    Array.isArray(address.location.coordinates) &&
    address.location.coordinates.length === 2
  ) {
    const [lng, lat] = address.location.coordinates
    return `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`
  }
  return null
}

function AccordionSection({ id, title, icon: Icon, open, onToggle, badge, children }) {
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {Icon ? <Icon className="w-4 h-4 text-orange-600 shrink-0" /> : null}
          <span className="text-sm font-semibold text-slate-800">{title}</span>
          {badge != null && badge !== "" ? (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              {badge}
            </span>
          ) : null}
        </div>
        <ChevronDown
          className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? <div className="px-4 pb-4 pt-1 border-t border-slate-100">{children}</div> : null}
    </div>
  )
}

function DetailRow({ label, value, mono = false }) {
  if (value == null || value === "") return null
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{label}</p>
      <p className={`text-sm font-medium text-slate-900 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  )
}

function PriceRow({ label, value, emphasize, negative, freeLabel }) {
  const n = Number(value)
  const show = Number.isFinite(n)
  if (!show && !freeLabel) return null
  return (
    <div className={`flex justify-between text-sm ${emphasize ? "pt-2 border-t border-slate-200" : ""}`}>
      <span className={emphasize ? "text-base font-semibold text-slate-700" : "text-slate-600"}>
        {label}
      </span>
      <span
        className={
          emphasize
            ? "text-lg font-bold text-emerald-600"
            : negative
              ? "font-medium text-emerald-600"
              : "font-medium text-slate-900"
        }
      >
        {freeLabel && (!show || n <= 0)
          ? freeLabel
          : negative
            ? `-${money(Math.abs(n))}`
            : money(n)}
      </span>
    </div>
  )
}

function ItemRow({ item }) {
  const qty = item.quantity || 1
  const unit = Number(item.price || 0)
  return (
    <div className="flex items-start justify-between gap-3 p-3 bg-slate-50 rounded-lg">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-slate-700 bg-white px-2 py-1 rounded">
            {qty}x
          </span>
          <p className="text-sm font-medium text-slate-900">
            {item.name || item.foodName || "Unknown Item"}
            {item.variantName ? ` (${item.variantName})` : ""}
          </p>
          {item.isVeg !== undefined && (
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${
                item.isVeg ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
              }`}
            >
              {item.isVeg ? "Veg" : "Non-Veg"}
            </span>
          )}
        </div>
        {(item.notes || item.description) && (
          <p className="text-xs text-slate-500 mt-1 ml-8">{item.notes || item.description}</p>
        )}
      </div>
      <p className="text-sm font-semibold text-slate-900 shrink-0">{money(unit * qty)}</p>
    </div>
  )
}

export default function ViewOrderDialog({ isOpen, onOpenChange, order }) {
  const [detailOrder, setDetailOrder] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [detailError, setDetailError] = useState("")
  const [droppingRestaurantId, setDroppingRestaurantId] = useState("")
  const [openSections, setOpenSections] = useState({
    summary: true,
    customer: false,
    restaurants: true,
    items: true,
    history: true,
    pricing: true,
    settlementLedger: true,
    deliveryPartner: false,
    address: false,
    bill: false,
  })

  useEffect(() => {
    if (!isOpen || !order) {
      setDetailOrder(null)
      setDetailError("")
      setLoadingDetail(false)
      return undefined
    }

    const orderKey =
      order.orderMongoId ||
      order._id ||
      order.id ||
      order.orderId ||
      order.order_id ||
      ""

    let cancelled = false
    const fetchDetail = async () => {
      if (!orderKey) {
        setDetailOrder(order)
        return
      }
      setLoadingDetail(true)
      setDetailError("")
      try {
        const response = await adminAPI.getOrderById(orderKey)
        const payload = response?.data?.data?.order || response?.data?.order || response?.order || response?.data
        const full = payload && typeof payload === "object" ? payload : null
        if (!cancelled) {
          if (!full) {
            setDetailOrder(order)
            return
          }
          // Keep list-mapped display fields; prefer full API payload for everything else
          setDetailOrder({
            ...order,
            ...full,
            date: order.date,
            time: order.time,
            customerName:
              order.customerName ||
              full.customerName ||
              full.userId?.name ||
              full.userId?.fullName,
            customerPhone:
              order.customerPhone || full.customerPhone || full.userId?.phone,
            customerEmail:
              order.customerEmail || full.customerEmail || full.userId?.email,
            orderStatus: order.orderStatus || full.orderStatus || full.status,
            paymentStatus: order.paymentStatus || full.paymentStatus,
            paymentType: order.paymentType,
            paymentMethodDetail: order.paymentMethodDetail,
            totalItemAmount:
              order.totalItemAmount ??
              full.pricing?.foodSubtotal ??
              full.pricing?.subtotal,
            couponDiscount: order.couponDiscount ?? full.pricing?.discount,
            deliveryCharge: order.deliveryCharge ?? full.pricing?.deliveryFee,
            platformFee: order.platformFee ?? full.pricing?.platformFee,
            vatTax: order.vatTax ?? full.pricing?.tax,
            totalAmount: order.totalAmount ?? full.pricing?.total,
            deliveryPartnerName:
              order.deliveryPartnerName ||
              full.dispatch?.deliveryPartnerId?.name ||
              full.dispatch?.deliveryPartnerId?.fullName,
            deliveryPartnerPhone:
              order.deliveryPartnerPhone ||
              full.dispatch?.deliveryPartnerId?.phone ||
              full.dispatch?.deliveryPartnerId?.phoneNumber,
            orderOtp: full.deliveryOtp || order.orderOtp || order.deliveryOtp,
            legHandoverOtps: Array.isArray(full.legHandoverOtps)
              ? full.legHandoverOtps
              : order.legHandoverOtps,
            isDualLeg: Boolean(full.isDualLeg || order.isDualLeg),
            legs: Array.isArray(full.legs) ? full.legs : order.legs,
            address:
              full.deliveryAddress ||
              full.address ||
              order.address ||
              order.deliveryAddress,
          })
        }
      } catch (err) {
        if (!cancelled) {
          setDetailError(err?.response?.data?.message || err?.message || "Failed to load full order details")
          setDetailOrder(order)
        }
      } finally {
        if (!cancelled) setLoadingDetail(false)
      }
    }

    fetchDetail()
    return () => {
      cancelled = true
    }
  }, [isOpen, order])

  const data = detailOrder || order

  const pricing = data?.pricing || {}
  const items = Array.isArray(data?.items) ? data.items : []
  const pickups = Array.isArray(data?.pickups) ? data.pickups : []
  const restaurantGroups = Array.isArray(pricing.restaurantGroups) ? pricing.restaurantGroups : []
  const statusHistory = Array.isArray(data?.statusHistory) ? data.statusHistory : []
  const cancellationInfo = useMemo(() => {
    const rawStatus = String(data?.orderStatus || data?.status || "").toLowerCase()
    const isCancelled =
      rawStatus.includes("cancelled") ||
      rawStatus.includes("canceled") ||
      rawStatus === "rejected_by_restaurant"
    const partialRefunds = Array.isArray(data?.partialRefunds) ? data.partialRefunds : []
    if (!isCancelled && partialRefunds.length === 0) return null

    const cancelEntry =
      [...statusHistory]
        .reverse()
        .find((entry) => String(entry?.to || "").toLowerCase().includes("cancel")) ||
      null
    const refund = data?.payment?.refund || {}

    const cancelledByLabel = (() => {
      if (!isCancelled && partialRefunds.length > 0) return "Partial (multi-restaurant)"
      if (rawStatus === "cancelled_by_user") return "Customer"
      if (rawStatus === "cancelled_by_restaurant" || rawStatus === "rejected_by_restaurant") {
        return "Restaurant"
      }
      if (rawStatus === "cancelled_by_admin") {
        const note = String(cancelEntry?.note || data?.cancellationReason || "").toLowerCase()
        if (note.includes("no delivery partner") || data?.failureReason === "driver_not_found") {
          return "System (No driver found)"
        }
        return "Admin"
      }
      if (cancelEntry?.byRole) return humanizeStatus(cancelEntry.byRole)
      return humanizeStatus(rawStatus)
    })()

    const partialTotal = partialRefunds.reduce(
      (sum, entry) => sum + (Number(entry?.amount) || 0),
      0,
    )

    return {
      isFullCancel: isCancelled,
      cancelledBy: cancelledByLabel,
      reason: data?.cancellationReason || cancelEntry?.note || "",
      cancelledAt: cancelEntry?.at || cancelEntry?.createdAt || null,
      refundStatus:
        refund.status ||
        (partialRefunds.some((p) => p.status === "processed")
          ? "processed"
          : String(data?.payment?.status || "").toLowerCase() === "refunded"
            ? "processed"
            : partialRefunds.length
              ? "partial"
              : "none"),
      refundDestination: refund.destination || (partialRefunds.length ? "wallet" : null),
      refundAmount:
        refund.amount ??
        (isCancelled
          ? data?.pricing?.total ?? data?.totalAmount ?? null
          : partialTotal || null),
      refundProcessedAt: refund.processedAt || null,
      refundId: refund.refundId || null,
      partialRefunds,
    }
  }, [data, statusHistory])
  const isMulti =
    Boolean(data?.isMultiRestaurant) ||
    pickups.length > 1 ||
    restaurantGroups.length > 1

  const restaurantBlocks = useMemo(() => {
    if (!data) return []

    if (pickups.length > 0) {
      return pickups.map((pickup, index) => {
        const rid = idOf(pickup.restaurantId)
        const group = restaurantGroups.find((g) => idOf(g.restaurantId) === rid)
        const settlement = (data.restaurantSettlement || []).find(
          (s) => idOf(s.restaurantId) === rid,
        )
        const restroItems = items.filter((item) => idOf(item.restaurantId) === rid)
        const primary = data.restaurantId
        const isPrimary = rid && idOf(primary) === rid
        const primaryObj = primary && typeof primary === "object" ? primary : null

        return {
          key: rid || `pickup-${index}`,
          restaurantId: rid,
          permanentlyDropped: Boolean(pickup.permanentlyDropped),
          name:
            pickup.restaurantName ||
            group?.restaurantName ||
            (isPrimary && (primaryObj?.restaurantName || data.restaurant)) ||
            `Restaurant ${index + 1}`,
          status: pickup.status,
          location: pickup.location,
          phone:
            (isPrimary &&
              (primaryObj?.ownerPhone ||
                primaryObj?.primaryContactNumber ||
                primaryObj?.phone)) ||
            "",
          area: isPrimary ? primaryObj?.area : pickup.location?.area,
          city: isPrimary ? primaryObj?.city : pickup.location?.city,
          items:
            restroItems.length > 0
              ? restroItems
              : !items.some((it) => it.restaurantId) && index === 0
                ? items
                : [],
          group,
          settlement,
          index,
        }
      })
    }

    const primary = data.restaurantId
    const primaryObj = primary && typeof primary === "object" ? primary : null
    return [
      {
        key: idOf(primary) || "primary",
        name:
          data.restaurant ||
          data.restaurantName ||
          primaryObj?.restaurantName ||
          "Restaurant",
        status: data.orderStatus || data.status,
        location: primaryObj?.location,
        phone:
          primaryObj?.ownerPhone ||
          primaryObj?.primaryContactNumber ||
          primaryObj?.phone ||
          "",
        area: primaryObj?.area,
        city: primaryObj?.city,
        items,
        group: restaurantGroups[0],
        settlement: (data.restaurantSettlement || [])[0],
        index: 0,
      },
    ]
  }, [data, items, pickups, restaurantGroups])

  const terminalStatuses = new Set([
    "delivered",
    "cancelled_by_user",
    "cancelled_by_restaurant",
    "cancelled_by_admin",
    "cancelled",
  ])
  const canDropRestaurant =
    isMulti &&
    data &&
    !terminalStatuses.has(String(data.orderStatus || data.status || "").toLowerCase())

  const refreshOrderDetail = async () => {
    const orderKey =
      data?.orderMongoId ||
      data?._id ||
      data?.id ||
      data?.orderId ||
      data?.order_id ||
      order?.orderMongoId ||
      order?._id ||
      order?.id ||
      order?.orderId ||
      ""
    if (!orderKey) return
    try {
      const response = await adminAPI.getOrderById(orderKey)
      const payload =
        response?.data?.data?.order || response?.data?.order || response?.order || response?.data
      if (payload && typeof payload === "object") {
        setDetailOrder((prev) => ({ ...(prev || order || {}), ...payload }))
      }
    } catch (err) {
      console.warn("Failed to refresh order detail", err)
    }
  }

  const handleDropRestaurant = async (block) => {
    const restaurantId = block?.restaurantId || block?.key
    if (!restaurantId || !canDropRestaurant) return
    const orderKey =
      data?.orderMongoId ||
      data?._id ||
      data?.id ||
      data?.orderId ||
      data?.order_id ||
      ""
    if (!orderKey) {
      toast.error("Order id missing")
      return
    }
    const confirmed = window.confirm(
      `Remove "${block.name}" from this multi-restaurant order?\n\nThe customer will get a partial wallet refund for that restaurant's items. The order continues with remaining restaurants.`,
    )
    if (!confirmed) return
    setDroppingRestaurantId(restaurantId)
    try {
      const response = await adminAPI.dropRestaurantFromOrder(orderKey, restaurantId, {
        reason: `Admin removed ${block.name} from multi-restaurant order`,
      })
      const updated =
        response?.data?.data?.order || response?.data?.order || response?.order || null
      if (updated) {
        setDetailOrder((prev) => ({ ...(prev || {}), ...updated }))
      } else {
        await refreshOrderDetail()
      }
      toast.success(`${block.name} removed. Partial refund issued to customer wallet.`)
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Failed to remove restaurant"
      toast.error(msg)
    } finally {
      setDroppingRestaurantId("")
    }
  }

  const deliveryPartner = useMemo(() => {
    if (!data) return null
    const dp =
      data.dispatch?.deliveryPartnerId && typeof data.dispatch.deliveryPartnerId === "object"
        ? data.dispatch.deliveryPartnerId
        : data.deliveryPartnerId && typeof data.deliveryPartnerId === "object"
          ? data.deliveryPartnerId
          : null

    const name =
      data.deliveryPartnerName ||
      dp?.name ||
      dp?.fullName ||
      ""
    const phone =
      data.deliveryPartnerPhone ||
      dp?.phone ||
      dp?.phoneNumber ||
      ""

    if (!name && !phone && !data.dispatch) return null

    return {
      name: name || "N/A",
      phone: phone || "N/A",
      rating: dp?.rating,
      totalRatings: dp?.totalRatings,
      dispatchStatus: data.dispatch?.status,
      assignedAt: data.dispatch?.assignedAt,
      acceptedAt: data.dispatch?.acceptedAt,
      riderEarning: data.riderEarning ?? data.driverSettlement?.driverPayout,
      phase: data.deliveryState?.currentPhase,
      partnerId: idOf(dp) || idOf(data.dispatch?.deliveryPartnerId),
    }
  }, [data])

  const sharedDeliveryPartner = useMemo(() => {
    if (!data) return null
    const sp =
      data.dispatch?.sharedPartnerId && typeof data.dispatch.sharedPartnerId === "object"
        ? data.dispatch.sharedPartnerId
        : null
    if (!sp && !data.dispatch?.sharedPartnerId) return null
    return {
      name: sp?.name || sp?.fullName || "Partner rider",
      phone: sp?.phone || sp?.phoneNumber || "N/A",
      rating: sp?.rating,
      totalRatings: sp?.totalRatings,
      riderEarning: data.sharedRiderEarning,
      partnerId: idOf(sp) || idOf(data.dispatch?.sharedPartnerId),
      role: "shared",
    }
  }, [data])

  const isMultiDriver = Boolean(
    sharedDeliveryPartner || data?.isDualLeg || data?.dispatch?.sharedPartnerId,
  )

  const timelineEvents = useMemo(() => {
    if (!data) return []
    const events = []

    if (Array.isArray(statusHistory) && statusHistory.length > 0) {
      statusHistory.forEach((entry) => {
        events.push({
          at: entry.at,
          title: humanizeStatus(entry.to || entry.from),
          from: entry.from,
          to: entry.to,
          byRole: entry.byRole,
          note: entry.note,
        })
      })
    } else {
      if (data.createdAt) {
        events.push({ at: data.createdAt, title: "Order Created", byRole: "USER" })
      }
      if (data.dispatch?.assignedAt) {
        events.push({
          at: data.dispatch.assignedAt,
          title: "Delivery Partner Assigned",
          byRole: "SYSTEM",
        })
      }
      if (data.dispatch?.acceptedAt) {
        events.push({
          at: data.dispatch.acceptedAt,
          title: "Delivery Partner Accepted",
          byRole: "DELIVERY_PARTNER",
        })
      }
      if (data.deliveryState?.reachedPickupAt) {
        events.push({
          at: data.deliveryState.reachedPickupAt,
          title: "Reached Pickup",
          byRole: "DELIVERY_PARTNER",
        })
      }
      if (data.deliveryState?.pickedUpAt) {
        events.push({
          at: data.deliveryState.pickedUpAt,
          title: "Order Picked Up",
          byRole: "DELIVERY_PARTNER",
        })
      }
      if (data.deliveryState?.reachedDropAt) {
        events.push({
          at: data.deliveryState.reachedDropAt,
          title: "Reached Drop",
          byRole: "DELIVERY_PARTNER",
        })
      }
      if (data.deliveredAt || data.deliveryState?.deliveredAt) {
        events.push({
          at: data.deliveredAt || data.deliveryState.deliveredAt,
          title: "Delivered",
          byRole: "DELIVERY_PARTNER",
        })
      }
    }

    return events
      .filter((e) => e.at)
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  }, [data, statusHistory])

  const toggleSection = (id) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  if (!isOpen || !order) return null

  const address = data?.address || data?.deliveryAddress || data?.customerAddress
  const billUrl =
    data?.billImageUrl || data?.billImage || data?.deliveryState?.billImageUrl
  const deliveryBreakdown = pricing.deliveryFeeBreakdown || null

  const paymentDisplay =
    data?.paymentType === "Cash on Delivery" ||
    data?.payment?.method === "cash" ||
    data?.payment?.method === "cod"
      ? data?.paymentCollectionStatus || data?.status === "delivered" || data?.orderStatus === "Delivered"
        ? "Collected"
        : "Not Collected"
      : data?.paymentStatus

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl max-h-[90vh] bg-white p-0 overflow-y-auto"
        showCloseButton={false}
      >
        <DialogHeader className="px-6 pt-6 pb-4 pr-14 border-b border-slate-200 sticky top-0 bg-white z-10 relative">
          <DialogClose
            type="button"
            aria-label="Close order details"
            className="absolute right-4 top-4 rounded-full p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-200"
          >
            <X className="h-5 w-5" />
          </DialogClose>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-orange-600" />
            Order Details
            {loadingDetail ? (
              <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
            ) : null}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <span>View complete information about this order</span>
            {isMulti ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-orange-100 text-orange-700">
                Multi-restaurant
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-3">
          {detailError ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              {detailError}. Showing available list data.
            </p>
          ) : null}

          {/* Summary always visible */}
          <AccordionSection
            id="summary"
            title="Order Summary"
            icon={Package}
            open={openSections.summary}
            onToggle={toggleSection}
            badge={data?.orderStatus}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <DetailRow
                label="Order ID"
                value={data?.orderId || data?.id || data?.subscriptionId}
                mono
              />
              <DetailRow
                label="Order Date"
                value={
                  data?.date
                    ? `${data.date}${data.time ? `, ${data.time}` : ""}`
                    : formatDateTime(data?.createdAt)
                }
              />
              {Array.isArray(data?.legHandoverOtps) && data.legHandoverOtps.length > 0 ? (
                <div className="md:col-span-2 space-y-2">
                  <p className="text-[11px] font-semibold text-orange-600 uppercase tracking-wider flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {data.legHandoverOtps.length > 1 ? "Per-driver handover OTPs" : "Handover OTP"}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {data.legHandoverOtps.map((leg, idx) => (
                      <div
                        key={`admin-otp-${leg.legIndex ?? leg.partnerId ?? idx}`}
                        className="rounded-lg border border-orange-100 bg-orange-50/60 px-3 py-2"
                      >
                        <p className="text-[10px] font-semibold text-orange-700 uppercase tracking-wider">
                          {leg.role === "secondary" || leg.role === "shared"
                            ? "Second rider"
                            : leg.role === "primary"
                              ? "Lead rider"
                              : `Rider ${idx + 1}`}
                          {leg.otpVerified ? " · verified" : ""}
                        </p>
                        <p className="text-lg font-bold text-slate-950 tracking-[0.2em]">
                          {leg.otp}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : data?.orderOtp || data?.deliveryOtp ? (
                <div className="space-y-0.5">
                  <p className="text-[11px] font-semibold text-orange-600 uppercase tracking-wider flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Handover OTP
                  </p>
                  <p className="text-lg font-bold text-slate-950 tracking-[0.2em]">
                    {data.orderOtp || data.deliveryOtp}
                  </p>
                </div>
              ) : null}
              <DetailRow
                label="Estimated Delivery"
                value={
                  data?.estimatedDeliveryTime
                    ? `${data.estimatedDeliveryTime} minutes`
                    : null
                }
              />
              <DetailRow label="Delivered At" value={formatDateTime(data?.deliveredAt || data?.deliveryState?.deliveredAt)} />
              {data?.orderStatus ? (
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    Status
                  </p>
                  <span
                    className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(data.orderStatus)}`}
                  >
                    {data.orderStatus}
                  </span>
                  {data.cancellationReason || cancellationInfo?.reason ? (
                    <p className="text-xs text-red-600 mt-1">
                      Reason: {data.cancellationReason || cancellationInfo?.reason}
                    </p>
                  ) : null}
                  {cancellationInfo?.cancelledBy ? (
                    <p className="text-xs text-slate-600 mt-1">
                      Cancelled by: {cancellationInfo.cancelledBy}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {(data?.paymentStatus || data?.paymentCollectionStatus != null) && (
                <div className="space-y-0.5">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                    <CreditCard className="w-3.5 h-3.5" />
                    Payment Status
                  </p>
                  <p className={`text-sm font-medium ${getPaymentStatusColor(paymentDisplay)}`}>
                    {paymentDisplay}
                  </p>
                </div>
              )}
              {data?.payment?.cod?.enabled && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-1">
                  <p className="font-bold uppercase tracking-wider text-[11px]">Cash on Delivery (advance)</p>
                  <p>Advance paid: ₹{Number(data.payment.cod.advanceAmount || 0).toFixed(2)} ({data.payment.cod.percent}%) — Wallet ₹{Number(data.payment.cod.advanceWalletAmount || 0).toFixed(2)} + Online ₹{Number(data.payment.cod.advanceOnlineAmount || 0).toFixed(2)}</p>
                  <p>Remaining on delivery: ₹{Number(data.payment.cod.remainingAmount || 0).toFixed(2)}{data.payment.cod.collectedAt ? ` — collected ₹${Number(data.payment.cod.collectedAmount || 0).toFixed(2)}` : " — not collected yet"}</p>
                  {data.payment.cod.advanceStatus === "refunded" && (
                    <p className="font-semibold text-sky-700">Advance ₹{Number(data.payment.cod.refundedAmount || 0).toFixed(2)} refunded to the customer's wallet</p>
                  )}
                </div>
              )}
              <DetailRow
                label="Payment Method"
                value={
                  data?.paymentType || data?.paymentMethodDetail
                    ? `${data?.paymentType || data?.paymentMethodDetail}${
                        data?.paymentMethodDetail &&
                        data?.paymentType &&
                        data.paymentMethodDetail !== data.paymentType
                          ? ` (${data.paymentMethodDetail})`
                          : ""
                      }`
                    : data?.payment?.method
                      ? humanizeStatus(data.payment.method)
                      : null
                }
              />
              <DetailRow label="Delivery Type" value={data?.deliveryType || "Home Delivery"} />
            </div>
          </AccordionSection>

          <AccordionSection
            id="customer"
            title="Customer Details"
            icon={User}
            open={openSections.customer}
            onToggle={toggleSection}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <DetailRow
                label="Name"
                value={
                  data?.customerName ||
                  data?.userId?.name ||
                  data?.userId?.fullName ||
                  "N/A"
                }
              />
              <DetailRow
                label="Phone"
                value={data?.customerPhone || data?.userId?.phone}
              />
              <DetailRow
                label="Email"
                value={data?.customerEmail || data?.userId?.email}
              />
            </div>
            {data?.note ? (
              <div className="mt-3 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-1 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Note for Restaurant
                </p>
                <p className="text-sm text-blue-900 italic">"{data.note}"</p>
              </div>
            ) : null}
          </AccordionSection>

          <AccordionSection
            id="restaurants"
            title={isMulti ? "Restaurants (Multi-pickup)" : "Restaurant Details"}
            icon={Store}
            open={openSections.restaurants}
            onToggle={toggleSection}
            badge={isMulti ? `${restaurantBlocks.length} restaurants` : null}
          >
            <div className="space-y-3">
              {restaurantBlocks.map((block) => (
                <div
                  key={block.key}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {isMulti ? `${block.index + 1}. ` : ""}
                        {block.name}
                      </p>
                      {(block.area || block.city) && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          {[block.area, block.city].filter(Boolean).join(", ")}
                        </p>
                      )}
                    </div>
                    {block.status ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full bg-white border border-slate-200 text-slate-700">
                        {humanizeStatus(block.status)}
                      </span>
                    ) : null}
                  </div>
                  {block.location && (
                    <p className="text-xs text-slate-600 flex items-start gap-1.5">
                      <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" />
                      {formatAddress(block.location)}
                    </p>
                  )}
                  {block.phone ? (
                    <p className="text-xs text-slate-600 flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-slate-400" />
                      {block.phone}
                    </p>
                  ) : null}
                  {block.group ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-1 text-xs">
                      <div>
                        <span className="text-slate-500">Items subtotal</span>
                        <p className="font-semibold text-slate-800">{money(block.group.subtotal)}</p>
                      </div>
                      <div>
                        <span className="text-slate-500">Packaging</span>
                        <p className="font-semibold text-slate-800">{money(block.group.packagingFee)}</p>
                      </div>
                      {block.group.itemCount != null ? (
                        <div>
                          <span className="text-slate-500">Item count</span>
                          <p className="font-semibold text-slate-800">{block.group.itemCount}</p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {block.settlement ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-1 text-xs border-t border-slate-200">
                      <div>
                        <span className="text-slate-500">Food amount</span>
                        <p className="font-medium">{money(block.settlement.foodAmount)}</p>
                      </div>
                      {Number(block.settlement.commission) > 0 ? (
                        <div>
                          <span className="text-slate-500">Commission</span>
                          <p className="font-medium">{money(block.settlement.commission)}</p>
                        </div>
                      ) : null}
                      {Number(block.settlement.commissionGST) > 0 ? (
                        <div>
                          <span className="text-slate-500">Commission GST</span>
                          <p className="font-medium">{money(block.settlement.commissionGST)}</p>
                        </div>
                      ) : null}
                      <div>
                        <span className="text-slate-500">Payout</span>
                        <p className="font-semibold text-emerald-700">
                          {money(block.settlement.restaurantPayout)}
                        </p>
                      </div>
                    </div>
                  ) : null}
                  {canDropRestaurant &&
                  block.restaurantId &&
                  !block.permanentlyDropped &&
                  String(block.status || "").toLowerCase() !== "cancelled" ? (
                    <div className="pt-2 border-t border-slate-200">
                      <button
                        type="button"
                        disabled={droppingRestaurantId === block.restaurantId}
                        onClick={() => handleDropRestaurant(block)}
                        className="text-xs font-semibold text-rose-700 hover:text-rose-800 disabled:opacity-50"
                      >
                        {droppingRestaurantId === block.restaurantId
                          ? "Removing…"
                          : "Cancel this restaurant (partial refund)"}
                      </button>
                    </div>
                  ) : null}
                  {block.permanentlyDropped ||
                  String(block.status || "").toLowerCase() === "cancelled" ? (
                    <div className="pt-2 border-t border-rose-100 space-y-1">
                      <p className="text-xs font-medium text-rose-700">
                        This restaurant was cancelled / removed from the order.
                      </p>
                      {(() => {
                        const refund = (data?.partialRefunds || []).find(
                          (r) => idOf(r.restaurantId) === block.restaurantId,
                        )
                        return refund ? (
                          <p className="text-xs font-semibold text-amber-800">
                            Customer refund: {money(refund.amount)} →{" "}
                            {refund.destination || "wallet"} ({humanizeStatus(refund.status || "processed")})
                          </p>
                        ) : null
                      })()}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </AccordionSection>

          <AccordionSection
            id="items"
            title="Order Items"
            icon={Package}
            open={openSections.items}
            onToggle={toggleSection}
            badge={`${items.length} items`}
          >
            {isMulti && restaurantBlocks.length > 1 ? (
              <div className="space-y-4">
                {restaurantBlocks.map((block) => (
                  <div key={`items-${block.key}`} className="space-y-2">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      {block.name}
                    </p>
                    {(block.items || []).length > 0 ? (
                      block.items.map((item, idx) => (
                        <ItemRow key={`${block.key}-${idx}`} item={item} />
                      ))
                    ) : (
                      <p className="text-xs text-slate-400">No items linked to this restaurant</p>
                    )}
                  </div>
                ))}
              </div>
            ) : items.length > 0 ? (
              <div className="space-y-2">
                {items.map((item, index) => (
                  <ItemRow key={index} item={item} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No items found</p>
            )}
          </AccordionSection>

          {cancellationInfo ? (
            <AccordionSection
              id="cancellationRefund"
              title={
                cancellationInfo.isFullCancel
                  ? "Cancellation & Refund"
                  : "Partial restaurant refunds"
              }
              icon={Receipt}
              open={openSections.cancellationRefund ?? true}
              onToggle={toggleSection}
              badge={
                cancellationInfo.partialRefunds?.length
                  ? `${cancellationInfo.partialRefunds.length} partial`
                  : cancellationInfo.refundStatus === "processed"
                    ? "Refunded"
                    : cancellationInfo.refundStatus === "failed"
                      ? "Refund failed"
                      : "Cancelled"
              }
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {cancellationInfo.isFullCancel ? (
                  <>
                    <DetailRow label="Cancelled By" value={cancellationInfo.cancelledBy} />
                    <DetailRow
                      label="Cancelled At"
                      value={formatDateTime(cancellationInfo.cancelledAt)}
                    />
                    <DetailRow
                      label="Cancellation Reason"
                      value={cancellationInfo.reason || "N/A"}
                    />
                  </>
                ) : (
                  <DetailRow
                    label="Note"
                    value="Order continues with remaining restaurants. Amounts below were refunded to the customer wallet."
                  />
                )}
                <DetailRow
                  label="Refund Status"
                  value={humanizeStatus(cancellationInfo.refundStatus || "none")}
                />
                <DetailRow
                  label="Refund Destination"
                  value={
                    cancellationInfo.refundDestination === "wallet"
                      ? "Customer Wallet"
                      : cancellationInfo.refundDestination === "source"
                        ? "Original Payment Method"
                        : cancellationInfo.refundDestination
                          ? humanizeStatus(cancellationInfo.refundDestination)
                          : "N/A"
                  }
                />
                <DetailRow
                  label="Refund Amount"
                  value={
                    cancellationInfo.refundAmount != null
                      ? money(cancellationInfo.refundAmount)
                      : "N/A"
                  }
                />
                <DetailRow
                  label="Refund Processed At"
                  value={formatDateTime(cancellationInfo.refundProcessedAt)}
                />
                {cancellationInfo.refundId ? (
                  <DetailRow label="Refund ID" value={cancellationInfo.refundId} />
                ) : null}
              </div>

              {cancellationInfo.partialRefunds.length > 0 ? (
                <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50/60 p-3 space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-amber-800">
                    Partial refunds (multi-restaurant)
                  </p>
                  {cancellationInfo.partialRefunds.map((entry, idx) => (
                    <div
                      key={`${entry.restaurantId || idx}-${entry.processedAt || entry.at || idx}`}
                      className="rounded-md bg-white/70 border border-amber-100 px-3 py-2 text-xs text-amber-900 space-y-1"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">
                          {entry.restaurantName || entry.note || `Restaurant ${idx + 1}`}
                        </span>
                        <span className="font-bold">{money(entry.amount)}</span>
                      </div>
                      <div className="flex flex-wrap gap-2 text-[11px] text-amber-800/80">
                        <span>To: {entry.destination || "wallet"}</span>
                        <span>Status: {humanizeStatus(entry.status || "processed")}</span>
                        {entry.at || entry.processedAt ? (
                          <span>{formatDateTime(entry.at || entry.processedAt)}</span>
                        ) : null}
                      </div>
                      {entry.note ? (
                        <p className="text-[11px] italic text-amber-800/70">{entry.note}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </AccordionSection>
          ) : null}

          <AccordionSection
            id="history"
            title="Order History"
            icon={History}
            open={openSections.history}
            onToggle={toggleSection}
            badge={`${timelineEvents.length} events`}
          >
            {timelineEvents.length === 0 ? (
              <p className="text-sm text-slate-500">No status history available</p>
            ) : (
              <div className="relative pl-2">
                <div className="absolute left-6 top-1 bottom-1 w-0.5 bg-slate-200" />
                <div className="space-y-4">
                  {timelineEvents.map((event, index) => (
                    <div key={`${event.at}-${index}`} className="relative flex items-start gap-3">
                      <div className="relative z-10 flex items-center justify-center w-8 h-8 rounded-full border-2 border-orange-200 bg-orange-50 text-orange-700 shrink-0">
                        <Clock className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0 pt-0.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-900">{event.title}</p>
                          <p className="text-xs text-slate-500">{formatDateTime(event.at)}</p>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500">
                          {event.byRole ? (
                            <span className="px-2 py-0.5 rounded-full bg-slate-100">
                              By: {humanizeStatus(event.byRole)}
                            </span>
                          ) : null}
                          {event.from && event.to && event.from !== event.to ? (
                            <span className="px-2 py-0.5 rounded-full bg-slate-100">
                              {humanizeStatus(event.from)} → {humanizeStatus(event.to)}
                            </span>
                          ) : null}
                        </div>
                        {event.note ? (
                          <p className="text-xs text-slate-600 mt-1 italic">{event.note}</p>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(data?.dispatch?.assignedAt ||
              data?.dispatch?.acceptedAt ||
              data?.deliveryState?.reachedPickupAt ||
              data?.deliveryState?.pickedUpAt ||
              data?.deliveryState?.deliveredAt) && (
              <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <DetailRow label="Partner Assigned At" value={formatDateTime(data?.dispatch?.assignedAt)} />
                <DetailRow label="Partner Accepted At" value={formatDateTime(data?.dispatch?.acceptedAt)} />
                <DetailRow
                  label="Reached Pickup At"
                  value={formatDateTime(data?.deliveryState?.reachedPickupAt)}
                />
                <DetailRow label="Picked Up At" value={formatDateTime(data?.deliveryState?.pickedUpAt)} />
                <DetailRow
                  label="Reached Drop At"
                  value={formatDateTime(data?.deliveryState?.reachedDropAt)}
                />
                <DetailRow
                  label="Delivered At"
                  value={formatDateTime(data?.deliveredAt || data?.deliveryState?.deliveredAt)}
                />
              </div>
            )}
          </AccordionSection>

          <AccordionSection
            id="pricing"
            title="Pricing Breakdown"
            icon={Tag}
            open={openSections.pricing}
            onToggle={toggleSection}
            badge={money(data?.totalAmount ?? pricing.total ?? data?.total)}
          >
            <div className="space-y-2">
              <PriceRow
                label="Item Subtotal"
                value={
                  data?.totalItemAmount ??
                  pricing.foodSubtotal ??
                  pricing.subtotal ??
                  data?.subtotal
                }
              />
              {(Number(pricing.packagingFee) > 0 ||
                Number(pricing.restaurantPackagingTotal) > 0) && (
                <PriceRow
                  label="Packaging Fee"
                  value={pricing.packagingFee || pricing.restaurantPackagingTotal}
                />
              )}
              <PriceRow
                label="Delivery Charge"
                value={
                  Number(data?.deliveryCharge) > 0
                    ? data.deliveryCharge
                    : pricing.deliveryFee
                }
                freeLabel={<span className="text-emerald-600">Free delivery</span>}
              />
              {deliveryBreakdown ? (
                <div className="ml-3 pl-3 border-l-2 border-slate-200 space-y-1 text-xs text-slate-500">
                  {deliveryBreakdown.baseFee != null && (
                    <div className="flex justify-between">
                      <span>Base fee</span>
                      <span>{money(deliveryBreakdown.baseFee)}</span>
                    </div>
                  )}
                  {deliveryBreakdown.distanceKm != null && (
                    <div className="flex justify-between">
                      <span>Distance</span>
                      <span>{Number(deliveryBreakdown.distanceKm).toFixed(1)} km</span>
                    </div>
                  )}
                  {deliveryBreakdown.distanceFee != null && (
                    <div className="flex justify-between">
                      <span>Distance fee</span>
                      <span>{money(deliveryBreakdown.distanceFee)}</span>
                    </div>
                  )}
                  {(Number(deliveryBreakdown.additionalCharge) > 0 ||
                    Number(deliveryBreakdown.multiRestaurantCharge) > 0 ||
                    Boolean(deliveryBreakdown.isMultiRestaurant)) && (
                    <div className="flex justify-between text-orange-700">
                      <span>Multi-restaurant charge</span>
                      <span>
                        {money(
                          deliveryBreakdown.additionalCharge ??
                            deliveryBreakdown.multiRestaurantCharge ??
                            0,
                        )}
                      </span>
                    </div>
                  )}
                  {deliveryBreakdown.speedFeeModifier != null &&
                    Number(deliveryBreakdown.speedFeeModifier) !== 0 && (
                      <div className="flex justify-between">
                        <span>Speed modifier</span>
                        <span>{money(deliveryBreakdown.speedFeeModifier)}</span>
                      </div>
                    )}
                  {deliveryBreakdown.speedShareAdmin != null &&
                    Number(deliveryBreakdown.speedFeeModifier) !== 0 && (
                      <div className="ml-2 space-y-0.5 text-[11px] text-slate-400">
                        <div className="flex justify-between">
                          <span>→ Admin</span>
                          <span>{money(deliveryBreakdown.speedShareAdmin)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>→ Driver</span>
                          <span>{money(deliveryBreakdown.speedShareDriver)}</span>
                        </div>
                      </div>
                    )}
                  {deliveryBreakdown.userCharge != null && (
                    <div className="flex justify-between">
                      <span>User Charge (slab)</span>
                      <span>{money(deliveryBreakdown.userCharge)}</span>
                    </div>
                  )}
                  {deliveryBreakdown.deliveryBoyFee != null && (
                    <div className="flex justify-between">
                      <span>Delivery Boy Fee (slab)</span>
                      <span>{money(deliveryBreakdown.deliveryBoyFee)}</span>
                    </div>
                  )}
                  {deliveryBreakdown.multiplier != null &&
                    Number(deliveryBreakdown.multiplier) !== 1 && (
                      <div className="flex justify-between">
                        <span>Multiplier</span>
                        <span>×{deliveryBreakdown.multiplier}</span>
                      </div>
                    )}
                  {deliveryBreakdown.isMultiRestaurant ? (
                    <p className="text-[11px] text-orange-600">
                      Multi-restaurant delivery pricing
                      {Number(deliveryBreakdown.additionalCharge) > 0
                        ? ` (includes ${money(deliveryBreakdown.additionalCharge)} multi charge)`
                        : ""}
                    </p>
                  ) : null}
                  {deliveryBreakdown.source ? (
                    <p className="text-[11px]">Source: {deliveryBreakdown.source}</p>
                  ) : null}
                </div>
              ) : isMulti ? (
                <div className="ml-3 pl-3 border-l-2 border-orange-200 text-xs text-orange-700">
                  Multi-restaurant order — delivery charge includes multi-pickup surcharge
                  when configured.
                </div>
              ) : null}
              <PriceRow
                label="Platform Fee"
                value={data?.platformFee ?? pricing.platformFee}
              />
              {(Number(data?.vatTax) > 0 || Number(pricing.tax) > 0) && (
                <PriceRow label="Tax (GST)" value={data?.vatTax ?? pricing.tax} />
              )}
              {Number(data?.itemDiscount) > 0 && (
                <PriceRow label="Item Discount" value={data.itemDiscount} negative />
              )}
              {(Number(data?.couponDiscount) > 0 ||
                Number(pricing.discount) > 0 ||
                pricing.couponCode) && (
                <div className="space-y-1">
                  <PriceRow
                    label={
                      pricing.couponCode
                        ? `Coupon (${pricing.couponCode})`
                        : "Coupon / Offer Discount"
                    }
                    value={
                      Number(data?.couponDiscount) > 0
                        ? data.couponDiscount
                        : pricing.discount
                    }
                    negative
                  />
                  {(pricing.couponCategory || pricing.couponCreatedBy || pricing.offerId) && (
                    <div className="ml-3 text-xs text-slate-500 flex flex-wrap gap-2">
                      {pricing.couponCategory ? (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                          {humanizeStatus(pricing.couponCategory)}
                        </span>
                      ) : null}
                      {pricing.couponCreatedBy ? (
                        <span className="px-2 py-0.5 rounded-full bg-slate-100">
                          Created by: {humanizeStatus(pricing.couponCreatedBy)}
                        </span>
                      ) : null}
                      {pricing.offerId ? (
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 font-mono">
                          Offer: {idOf(pricing.offerId)}
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              )}
              {Number(pricing.deliveryDiscount) > 0 && (
                <PriceRow label="Delivery Discount" value={pricing.deliveryDiscount} negative />
              )}
              {Number(pricing.platformSubsidy) > 0 && (
                <div className="space-y-1">
                  <PriceRow
                    label="Admin-borne delivery (pocket)"
                    value={pricing.platformSubsidy}
                    negative
                  />
                  <p className="ml-3 text-[11px] text-rose-600">
                    Customer delivery was free. Admin pays riders from pocket for this order.
                    {data?.riderEarning != null || data?.sharedRiderEarning != null
                      ? ` Rider payout: ₹${(
                          Number(data?.riderEarning || 0) + Number(data?.sharedRiderEarning || 0)
                        ).toFixed(0)}.`
                      : ""}
                  </p>
                </div>
              )}

              {restaurantGroups.length > 1 && (
                <div className="mt-3 pt-3 border-t border-dashed border-slate-200 space-y-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Per-restaurant totals
                  </p>
                  {restaurantGroups.map((group, idx) => (
                    <div
                      key={idOf(group.restaurantId) || idx}
                      className="flex justify-between text-xs text-slate-600"
                    >
                      <span>{group.restaurantName || `Restaurant ${idx + 1}`}</span>
                      <span>
                        Subtotal {money(group.subtotal)}
                        {Number(group.packagingFee) > 0
                          ? ` + pkg ${money(group.packagingFee)}`
                          : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <PriceRow
                label="Total Amount"
                value={data?.totalAmount ?? pricing.total ?? data?.total}
                emphasize
              />
            </div>
          </AccordionSection>

          <AccordionSection
            id="settlementLedger"
            title="Settlement Invoice (Who Got What)"
            icon={Receipt}
            open={openSections.settlementLedger}
            onToggle={toggleSection}
            badge={
              data?.settlementBreakdown?.status === "cancelled" ||
              cancellationInfo?.isFullCancel
                ? `Refund ${money(
                    data?.settlementBreakdown?.customer?.refund ??
                      cancellationInfo?.refundAmount ??
                      data?.pricing?.total ??
                      data?.totalAmount,
                  )}`
                : cancellationInfo?.partialRefunds?.length
                  ? `Partial ${money(cancellationInfo.refundAmount)}`
                  : data?.settlementBreakdown?.platform?.netProfit != null
                    ? `Platform ${money(data.settlementBreakdown.platform.netProfit)}`
                    : money(data?.platformProfit)
            }
          >
            {(() => {
              const sb = data?.settlementBreakdown
              const orderStatusLower = String(data?.orderStatus || data?.status || "").toLowerCase()
              const cancelLedger = sb?.cancellation || null
              const partialRefunds = Array.isArray(data?.partialRefunds)
                ? data.partialRefunds
                : cancellationInfo?.partialRefunds || []
              const partialRefundTotal = partialRefunds.reduce(
                (sum, entry) => sum + (Number(entry?.amount) || 0),
                0,
              )
              const isFullOrderCancelled =
                Boolean(cancellationInfo?.isFullCancel) ||
                (orderStatusLower.includes("cancelled") && partialRefunds.length === 0)
              // Only show the reversed/cancelled ledger for FULL order cancel.
              // Partial restaurant drops must use the live settlement (remaining restos + driver + platform).
              const isCancelledSettlement = Boolean(isFullOrderCancelled)
              const customerRefund =
                sb?.customer?.refund ??
                cancelLedger?.refundAmount ??
                (isFullOrderCancelled ? cancellationInfo?.refundAmount : null) ??
                null
              const customerPaid = sb?.customer?.paid ?? pricing.total

              if (isCancelledSettlement) {
                const restaurants =
                  Array.isArray(sb?.restaurants) && sb.restaurants.length
                    ? sb.restaurants
                    : (data?.restaurantSettlement || []).map((s) => ({
                        restaurantName: s.restaurantName,
                        originalPayout: s.restaurantPayout,
                        payout: 0,
                      }))

                return (
                  <div className="space-y-4 text-sm">
                    <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3 space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-rose-700">
                        Order cancelled — settlement reversed
                      </p>
                      <p className="text-xs text-rose-800">
                        {sb?.customer?.note ||
                          "Full paid amount is returned to the customer. Restaurant, driver, and platform receive nothing."}
                      </p>
                      {cancelLedger?.cancelledBy ? (
                        <p className="text-xs text-rose-700">
                          Cancelled by: {humanizeStatus(cancelLedger.cancelledBy)}
                          {cancelLedger.reason ? ` — ${cancelLedger.reason}` : ""}
                        </p>
                      ) : null}
                    </div>

                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                        Customer (refund recipient)
                      </p>
                      <PriceRow label="Amount paid" value={customerPaid} />
                      <PriceRow
                        label={
                          sb?.customer?.refundDestination === "wallet" ||
                          cancellationInfo?.refundDestination === "wallet"
                            ? "Refunded to wallet"
                            : sb?.customer?.refundDestination === "source"
                              ? "Refunded to original payment"
                              : "Refund amount"
                        }
                        value={customerRefund ?? 0}
                        emphasize
                      />
                      <PriceRow
                        label="Customer net cost"
                        value={sb?.customer?.netCost ?? Math.max(0, Number(customerPaid) - Number(customerRefund || 0))}
                      />
                      {(sb?.customer?.refundStatus || cancellationInfo?.refundStatus) && (
                        <p className="text-xs text-emerald-700">
                          Refund status:{" "}
                          {humanizeStatus(
                            sb?.customer?.refundStatus || cancellationInfo?.refundStatus || "none",
                          )}
                        </p>
                      )}
                    </div>

                    <div className="rounded-xl border border-slate-200 p-3 space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Restaurant payouts
                      </p>
                      {restaurants.length === 0 ? (
                        <p className="text-xs text-slate-400">No restaurant settlement</p>
                      ) : (
                        restaurants.map((r, idx) => (
                          <div
                            key={idx}
                            className="border-b border-slate-100 last:border-0 pb-2 last:pb-0 space-y-1"
                          >
                            <p className="font-medium text-slate-800">
                              {r.restaurantName || `Restaurant ${idx + 1}`}
                            </p>
                            {Number(r.originalPayout) > 0 ? (
                              <p className="text-xs text-slate-400 line-through">
                                Would have received {money(r.originalPayout)}
                              </p>
                            ) : null}
                            <PriceRow label="Actual payout" value={0} emphasize />
                            <p className="text-[11px] text-slate-500">
                              {r.note || "Order cancelled — no payout"}
                            </p>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="rounded-xl border border-slate-200 p-3 space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Driver payout
                      </p>
                      {Number(sb?.driver?.originalPayout) > 0 ? (
                        <p className="text-xs text-slate-400 line-through">
                          Would have received {money(sb.driver.originalPayout)}
                          {Number(sb?.driver?.originalSharedPayout) > 0
                            ? ` (+ shared ${money(sb.driver.originalSharedPayout)})`
                            : ""}
                        </p>
                      ) : null}
                      <PriceRow label="Actual payout" value={0} emphasize />
                      <p className="text-[11px] text-slate-500">
                        {sb?.driver?.note || "Order cancelled — no driver payout"}
                      </p>
                    </div>

                    <div className="rounded-xl border border-slate-200 p-3 space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Platform
                      </p>
                      {Number(sb?.platform?.originalNetProfit) > 0 ? (
                        <p className="text-xs text-slate-400 line-through">
                          Would have earned {money(sb.platform.originalNetProfit)}
                        </p>
                      ) : null}
                      <PriceRow label="Platform net" value={0} emphasize />
                      <p className="text-[11px] text-slate-500">
                        {sb?.platform?.note || "Order cancelled — platform retains no profit"}
                      </p>
                    </div>
                  </div>
                )
              }

              const driverPayout =
                sb?.driver?.payout ??
                Number(data?.riderEarning || 0) + Number(data?.sharedRiderEarning || 0)
              // Only treat as salary when employmentType is explicitly salary.
              // Do not infer from note text — create-time notes mention "Salary partners…" for all orders.
              const isSalary = sb?.driver?.employmentType === "salary"
              // Prefer live restaurantSettlement after partial drops (more accurate than a stale ledger).
              const restaurantsFromSettlement = (data?.restaurantSettlement || []).map((s) => ({
                restaurantName: s.restaurantName,
                foodAmount: s.foodAmount,
                packagingFee: s.packagingFee,
                commission: s.commission,
                speedShare: s.speedShare,
                couponDiscount: s.couponDiscount,
                payout: s.restaurantPayout,
              }))
              const restaurants =
                restaurantsFromSettlement.length > 0
                  ? restaurantsFromSettlement
                  : Array.isArray(sb?.restaurants) && sb.restaurants.length
                    ? sb.restaurants
                    : []
              const speed = sb?.speed || {
                feeModifier: deliveryBreakdown?.speedFeeModifier,
                admin: deliveryBreakdown?.speedShareAdmin,
                restaurant: deliveryBreakdown?.speedShareRestaurant,
                driver: deliveryBreakdown?.speedShareDriver,
              }
              const costBearers = Array.isArray(sb?.costBearers) ? sb.costBearers : []

              return (
                <div className="space-y-4 text-sm">
                  {partialRefunds.length > 0 ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-amber-800">
                        Partial restaurant drop — order continues
                      </p>
                      <p className="text-xs text-amber-900">
                        {money(partialRefundTotal)} refunded to customer wallet for removed
                        restaurant(s). Remaining restaurants, driver, and platform keep their
                        settlement for the continuing order.
                      </p>
                      {partialRefunds.map((entry, idx) => (
                        <div
                          key={`${entry.restaurantId || idx}-${entry.at || idx}`}
                          className="flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900"
                        >
                          <span>
                            {entry.restaurantName || `Restaurant ${idx + 1}`} cancelled
                          </span>
                          <span className="font-semibold">{money(entry.amount)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Customer paid
                    </p>
                    <PriceRow label="Order total" value={sb?.customer?.paid ?? pricing.total} />
                    {partialRefundTotal > 0 ? (
                      <PriceRow
                        label="Partial refunds (wallet)"
                        value={partialRefundTotal}
                        negative
                      />
                    ) : null}
                    <PriceRow
                      label="Food subtotal"
                      value={
                        sb?.customer?.foodSubtotal ??
                        pricing.foodSubtotal ??
                        pricing.subtotal
                      }
                    />
                    {(Number(sb?.customer?.packagingFee ?? pricing.packagingFee) > 0) && (
                      <PriceRow
                        label="Packaging"
                        value={sb?.customer?.packagingFee ?? pricing.packagingFee}
                      />
                    )}
                    <PriceRow
                      label="Delivery paid"
                      value={sb?.customer?.deliveryPaid ?? Math.max(0, Number(pricing.deliveryFee || 0) - Number(pricing.deliveryDiscount || 0))}
                    />
                    {Number(deliveryBreakdown?.additionalCharge) > 0 ? (
                      <div className="ml-2 flex justify-between text-[11px] text-orange-700">
                        <span>Includes multi-restaurant charge</span>
                        <span>{money(deliveryBreakdown.additionalCharge)}</span>
                      </div>
                    ) : null}
                    {(Number(sb?.customer?.tax ?? data?.vatTax ?? pricing.tax) > 0) && (
                      <PriceRow
                        label="GST (on food)"
                        value={sb?.customer?.tax ?? data?.vatTax ?? pricing.tax}
                      />
                    )}
                    {Number(sb?.customer?.platformFee ?? pricing.platformFee) > 0 && (
                      <PriceRow
                        label="Platform fee"
                        value={sb?.customer?.platformFee ?? pricing.platformFee}
                      />
                    )}
                    {Number(sb?.customer?.discount || pricing.discount) > 0 && (
                      <PriceRow
                        label={`Coupon${sb?.customer?.couponCode || pricing.couponCode ? ` (${sb?.customer?.couponCode || pricing.couponCode})` : ""}`}
                        value={sb?.customer?.discount ?? pricing.discount}
                        negative
                      />
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 p-3 space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Restaurant payouts
                    </p>
                    {restaurants.length === 0 ? (
                      <p className="text-xs text-slate-400">No restaurant settlement recorded</p>
                    ) : (
                      restaurants.map((r, idx) => (
                        <div key={idx} className="border-b border-slate-100 last:border-0 pb-2 last:pb-0 space-y-1">
                          <p className="font-medium text-slate-800">
                            {r.restaurantName || `Restaurant ${idx + 1}`}
                          </p>
                          <div className="text-xs text-slate-500 flex flex-wrap gap-x-3 gap-y-1">
                            <span>Food {money(r.foodAmount)}</span>
                            <span>Pkg {money(r.packagingFee)}</span>
                            {Number(r.commission) > 0 && (
                              <span>Commission −{money(r.commission)}</span>
                            )}
                            {Number(r.speedShare) > 0 && <span>Speed +{money(r.speedShare)}</span>}
                            {Number(r.couponDiscount) > 0 && (
                              <span>Coupon −{money(r.couponDiscount)}</span>
                            )}
                          </div>
                          <PriceRow label="Payout" value={r.payout} emphasize />
                        </div>
                      ))
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 p-3 space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Driver payout
                    </p>
                    {isSalary ? (
                      <p className="text-sm font-semibold text-amber-700">
                        On salary — order earning ₹0
                      </p>
                    ) : (
                      <>
                        {sb?.driver?.deliveryBoyFee != null && (
                          <PriceRow label="Delivery Boy Fee (slab)" value={sb.driver.deliveryBoyFee} />
                        )}
                        {Number(sb?.driver?.speedShare) > 0 && (
                          <PriceRow label="Speed share" value={sb.driver.speedShare} />
                        )}
                        <PriceRow label="Primary rider" value={data?.riderEarning ?? driverPayout} emphasize />
                        {Number(data?.sharedRiderEarning) > 0 && (
                          <PriceRow label="Shared rider" value={data.sharedRiderEarning} />
                        )}
                      </>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 p-3 space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Platform
                    </p>
                    <PriceRow
                      label="Platform fee"
                      value={sb?.platform?.platformFee ?? pricing.platformFee}
                    />
                    {Number(sb?.platform?.restaurantCommission ?? pricing.restaurantCommission) > 0 ? (
                      <PriceRow
                        label="Restaurant commission"
                        value={sb?.platform?.restaurantCommission ?? pricing.restaurantCommission}
                      />
                    ) : null}
                    {(sb?.platform?.deliveryMarginBase != null ||
                      data?.platformRevenue?.deliveryMargin != null) && (
                      <PriceRow
                        label="Delivery margin (User Charge − Boy Fee)"
                        value={
                          sb?.platform?.deliveryMarginBase ?? data?.platformRevenue?.deliveryMargin
                        }
                      />
                    )}
                    {Number(sb?.platform?.speedShare) > 0 && (
                      <PriceRow label="Speed share (admin)" value={sb.platform.speedShare} />
                    )}
                    {isSalary && Number(sb?.platform?.salaryReclaim) > 0 && (
                      <PriceRow
                        label="Salary reclaim (full rider fee → admin)"
                        value={sb.platform.salaryReclaim}
                      />
                    )}
                    {Number(sb?.platform?.adminCouponDiscount) > 0 && (
                      <PriceRow
                        label="Admin coupon borne"
                        value={sb.platform.adminCouponDiscount}
                        negative
                      />
                    )}
                    {Number(sb?.platform?.freeDeliverySubsidy) > 0 && (
                      <PriceRow
                        label="Free delivery subsidy"
                        value={sb.platform.freeDeliverySubsidy}
                        negative
                      />
                    )}
                    {Number(sb?.platform?.negativeSpeedBear) > 0 && (
                      <PriceRow
                        label="Negative speed borne"
                        value={sb.platform.negativeSpeedBear}
                        negative
                      />
                    )}
                    <PriceRow
                      label="Platform net"
                      value={sb?.platform?.netProfit ?? data?.platformProfit}
                      emphasize
                    />
                  </div>

                  {(Number(speed?.feeModifier) !== 0 ||
                    Number(speed?.admin) !== 0 ||
                    Number(speed?.restaurant) !== 0 ||
                    Number(speed?.driver) !== 0) && (
                    <div className="rounded-xl border border-slate-200 p-3 space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Cart Delivery Speed split
                      </p>
                      <PriceRow label="Speed fee charged" value={speed.feeModifier} />
                      <PriceRow label="Admin share" value={speed.admin} />
                      <PriceRow label="Driver share" value={speed.driver} />
                    </div>
                  )}

                  {costBearers.length > 0 && (
                    <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-3 space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-rose-600">
                        Cost bearers
                      </p>
                      {costBearers.map((c, idx) => (
                        <div key={idx} className="flex justify-between gap-2 text-xs text-slate-700">
                          <span>
                            {humanizeStatus(c.type)} → {humanizeStatus(c.bearer)}
                            {c.note ? ` · ${c.note}` : ""}
                          </span>
                          <span className="font-semibold shrink-0">{money(c.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })()}
          </AccordionSection>

          <AccordionSection
            id="deliveryPartner"
            title={isMultiDriver ? "Delivery Partners (2)" : "Delivery Partner"}
            icon={Truck}
            open={openSections.deliveryPartner}
            onToggle={toggleSection}
            badge={
              isMultiDriver
                ? "Multi-driver"
                : deliveryPartner?.dispatchStatus
                  ? humanizeStatus(deliveryPartner.dispatchStatus)
                  : null
            }
          >
            {deliveryPartner ? (
              <div className="space-y-4">
                <div>
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    {isMultiDriver ? "Lead rider" : "Assigned rider"}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <DetailRow label="Name" value={deliveryPartner.name} />
                <DetailRow label="Phone" value={deliveryPartner.phone} />
                {deliveryPartner.partnerId ? (
                  <DetailRow label="Partner ID" value={deliveryPartner.partnerId} mono />
                ) : null}
                {deliveryPartner.rating != null ? (
                  <div className="space-y-0.5">
                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      Rating
                    </p>
                    <p className="text-sm font-medium text-slate-900 flex items-center gap-1">
                      <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                      {deliveryPartner.rating}
                      {deliveryPartner.totalRatings != null
                        ? ` (${deliveryPartner.totalRatings})`
                        : ""}
                    </p>
                  </div>
                ) : null}
                <DetailRow
                  label="Dispatch Status"
                  value={
                    deliveryPartner.dispatchStatus
                      ? humanizeStatus(deliveryPartner.dispatchStatus)
                      : null
                  }
                />
                <DetailRow
                  label="Current Phase"
                  value={deliveryPartner.phase ? humanizeStatus(deliveryPartner.phase) : null}
                />
                <DetailRow label="Assigned At" value={formatDateTime(deliveryPartner.assignedAt)} />
                <DetailRow label="Accepted At" value={formatDateTime(deliveryPartner.acceptedAt)} />
                {deliveryPartner.riderEarning != null && (
                  <DetailRow label="Rider Earning" value={money(deliveryPartner.riderEarning)} />
                )}
                  </div>
                </div>

                {sharedDeliveryPartner && (
                  <div className="pt-4 border-t border-slate-100">
                    <p className="text-[11px] font-semibold text-indigo-600 uppercase tracking-wider mb-2">
                      Second rider
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <DetailRow label="Name" value={sharedDeliveryPartner.name} />
                      <DetailRow label="Phone" value={sharedDeliveryPartner.phone} />
                      {sharedDeliveryPartner.partnerId ? (
                        <DetailRow label="Partner ID" value={sharedDeliveryPartner.partnerId} mono />
                      ) : null}
                      {sharedDeliveryPartner.riderEarning != null && (
                        <DetailRow
                          label="Rider Earning"
                          value={money(sharedDeliveryPartner.riderEarning)}
                        />
                      )}
                    </div>
                  </div>
                )}

                {isMultiDriver && Array.isArray(data?.legs) && data.legs.length > 0 && (
                  <div className="pt-4 border-t border-slate-100">
                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      Dual-leg status
                    </p>
                    <div className="space-y-2">
                      {data.legs.map((leg, idx) => {
                        const matchingOtp = Array.isArray(data?.legHandoverOtps)
                          ? data.legHandoverOtps.find(
                              (o) =>
                                Number(o.legIndex) === Number(leg.legIndex) ||
                                String(o.partnerId || '') === String(leg.partnerId || ''),
                            )
                          : null
                        return (
                          <div
                            key={leg.legIndex ?? idx}
                            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs flex flex-wrap gap-3 justify-between"
                          >
                            <span className="font-semibold text-slate-700">
                              Leg {(leg.legIndex ?? idx) + 1} · {leg.role || "driver"}
                            </span>
                            <span className="text-slate-600">
                              {humanizeStatus(leg.status || "pending")}
                              {leg.otpVerified || matchingOtp?.otpVerified ? " · OTP ✓" : matchingOtp?.otp ? ` · OTP ${matchingOtp.otp}` : ""}
                              {leg.earning != null ? ` · ${money(leg.earning)}` : ""}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No delivery partner assigned yet</p>
            )}

            {Array.isArray(data?.dispatch?.assignmentHistory) &&
              data.dispatch.assignmentHistory.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
                    Assignment history
                  </p>
                  <div className="space-y-3">
                    {[...data.dispatch.assignmentHistory]
                      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
                      .map((entry, index) => {
                        const isReassign = entry.action === "reassigned"
                        return (
                          <div
                            key={`${entry.at}-${index}`}
                            className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                  isReassign
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-emerald-100 text-emerald-800"
                                }`}
                              >
                                {isReassign ? "Reassigned" : "Assigned"}
                              </span>
                              <span className="text-xs text-slate-500">
                                {formatDateTime(entry.at)}
                              </span>
                            </div>
                            {isReassign ? (
                              <p className="text-sm text-slate-800">
                                <span className="font-medium">
                                  {entry.fromPartnerName || "Previous driver"}
                                </span>
                                {entry.fromPartnerPhone ? (
                                  <span className="text-slate-500">
                                    {" "}
                                    ({entry.fromPartnerPhone})
                                  </span>
                                ) : null}
                                <span className="text-slate-400"> → </span>
                                <span className="font-medium">
                                  {entry.toPartnerName || "New driver"}
                                </span>
                                {entry.toPartnerPhone ? (
                                  <span className="text-slate-500">
                                    {" "}
                                    ({entry.toPartnerPhone})
                                  </span>
                                ) : null}
                              </p>
                            ) : (
                              <p className="text-sm text-slate-800">
                                Assigned to{" "}
                                <span className="font-medium">
                                  {entry.toPartnerName || "Driver"}
                                </span>
                                {entry.toPartnerPhone ? (
                                  <span className="text-slate-500">
                                    {" "}
                                    ({entry.toPartnerPhone})
                                  </span>
                                ) : null}
                              </p>
                            )}
                            <p className="text-[11px] text-slate-500 mt-1">
                              By {humanizeStatus(entry.byRole || "ADMIN")}
                              {entry.note ? ` · ${entry.note}` : ""}
                            </p>
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}
          </AccordionSection>

          {address ? (
            <AccordionSection
              id="address"
              title="Delivery Address"
              icon={MapPin}
              open={openSections.address}
              onToggle={toggleSection}
            >
              <div className="space-y-2 p-3 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-900">{formatAddress(address)}</p>
                {getCoordinates(address) ? (
                  <p className="text-xs text-slate-500">
                    <span className="font-medium">Coordinates:</span> {getCoordinates(address)}
                  </p>
                ) : null}
                {address.label ? (
                  <p className="text-xs text-slate-500">
                    <span className="font-medium">Label:</span> {address.label}
                  </p>
                ) : null}
              </div>
            </AccordionSection>
          ) : null}

          {billUrl ? (
            <AccordionSection
              id="bill"
              title="Bill Image (Delivery Boy)"
              icon={Receipt}
              open={openSections.bill}
              onToggle={toggleSection}
            >
              <div className="space-y-3">
                <div className="relative w-full max-w-2xl border-2 border-slate-300 rounded-xl overflow-hidden bg-white">
                  <img
                    src={billUrl}
                    alt="Order Bill"
                    className="w-full h-auto object-contain max-h-[500px] mx-auto block"
                    loading="lazy"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <a
                    href={billUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                  >
                    <Eye className="w-4 h-4" />
                    View Full Size
                  </a>
                  <a
                    href={billUrl}
                    download
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                  >
                    <Package className="w-4 h-4" />
                    Download
                  </a>
                </div>
              </div>
            </AccordionSection>
          ) : null}

        </div>
      </DialogContent>
    </Dialog>
  )
}
