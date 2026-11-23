import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import {
  ArrowLeft,
  ShoppingBag,
  Phone,
  Copy,
  Download,
  User,
  CreditCard,
  Calendar,
  MapPin,
  RotateCcw,
  FileText,
} from "lucide-react"
import { orderAPI, restaurantAPI } from "@food/api"
import { useCart } from "@food/context/CartContext"
import { toast } from "sonner"
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { getCompanyNameAsync } from "@food/utils/businessSettings"
import { resolveEntityId } from "@food/utils/common"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


export default function UserOrderDetails() {
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()
  const { replaceCart } = useCart()
  const { orderId } = useParams()
  const [order, setOrder] = useState(null)
  const [restaurant, setRestaurant] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchOrderDetails = async () => {
      try {
        setLoading(true)
        // Fetch using the ID from params (which will now be the MongoDB _id)
        const response = await orderAPI.getOrderDetails(orderId)

        let orderData = null
        if (response?.data?.success && response.data.data?.order) {
          orderData = response.data.data.order
        } else if (response?.data?.order && typeof response.data.order === 'object') {
          orderData = response.data.order
        } else {
          toast.error("Order not found")
          navigate("/user/orders")
          return
        }

        setOrder(orderData)

        // If restaurantId is just a string (not populated), fetch restaurant details separately
        const restaurantIdValue = orderData.restaurantId
        const restaurantId =
          typeof restaurantIdValue === "string"
            ? restaurantIdValue
            : resolveEntityId(restaurantIdValue)
        if (restaurantId && !orderData.restaurant) {
          try {
            const restaurantResponse = await restaurantAPI.getRestaurantById(restaurantId)
            if (restaurantResponse?.data?.success && restaurantResponse.data.data?.restaurant) {
              setRestaurant(restaurantResponse.data.data.restaurant)
            } else if (restaurantResponse?.data?.restaurant) {
              setRestaurant(restaurantResponse.data.restaurant)
            }
          } catch (restaurantError) {
            debugWarn("Failed to fetch restaurant details:", restaurantError)
            // Don't show error toast, just log it - order details can still be shown
          }
        }
      } catch (error) {
        debugError("Error fetching order details:", error)
        toast.error(
          error?.response?.data?.message || "Failed to load order details"
        )
        navigate("/user/orders")
      } finally {
        setLoading(false)
      }
    }

    fetchOrderDetails()
  }, [orderId, navigate])

  const handleCopyOrderId = async () => {
    if (!order) return
    const id = order.orderId || order._id || orderId
    try {
      await navigator.clipboard.writeText(String(id))
      toast.success("Order ID copied")
    } catch {
      toast.error("Failed to copy Order ID")
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a] flex items-center justify-center">
        <p className="text-gray-600 dark:text-gray-400 text-sm">Loading order details...</p>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-gray-700 dark:text-gray-300 text-sm font-medium">Order not found</p>
          <button
            onClick={() => navigate("/user/orders")}
            className="px-4 py-2 rounded-lg bg-[#16A34A] text-white text-sm font-semibold hover:bg-[#15803D] transition-all active:scale-95 shadow-md"
          >
            Back to Orders
          </button>
        </div>
      </div>
    )
  }

  const orderIdDisplay = order.orderId || order._id || orderId
  // Use fetched restaurant data if available, otherwise use order.restaurantId or order.restaurant
  const restaurantObj = restaurant || order.restaurantId || order.restaurant || {}
  const restaurantName = order.isMultiRestaurant || (order.pickups && order.pickups.length > 1)
    ? "Multiple Restaurants"
    : (order.restaurantName || restaurantObj.name || "Restaurant")

  // Build restaurant address (try restaurant fields first, then fall back)
  const restaurantLocation = (() => {
    const loc = restaurantObj.location || {}

    // Priority 1: direct address on restaurant object
    if (restaurantObj.address) return restaurantObj.address

    // Priority 2: formattedAddress from location
    if (loc.formattedAddress) return loc.formattedAddress

    // Priority 3: generic address / street-style fields
    if (loc.address) return loc.address

    if (loc.street || loc.city) {
      const parts = [
        loc.street,
        loc.area,
        loc.city,
        loc.state,
        loc.zipCode || loc.pincode || loc.postalCode,
      ].filter(Boolean)
      if (parts.length) return parts.join(", ")
    }

    // Priority 4: addressLine1 / addressLine2 style
    if (loc.addressLine1) {
      const parts = [
        loc.addressLine1,
        loc.addressLine2,
        loc.city,
        loc.state,
      ].filter(Boolean)
      if (parts.length) return parts.join(", ")
    }

    // Priority 5: order-level restaurantAddress if present
    if (order.restaurantAddress) return order.restaurantAddress

    // Don't fallback to user delivery address - show empty or "Address not available"
    return "Address not available"
  })()

  const items = Array.isArray(order.items) ? order.items : []
  const pricing = order.pricing || {}
  const sendsCutlery = order.sendCutlery !== false

  const userName = order.userName || ""
  const userPhone = order.userPhone || ""
  const paymentMethod = order.payment?.method || "Online"
  const paymentDate = order.createdAt
    ? new Date(order.createdAt).toLocaleString("en-IN", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
    : ""

  const addressText =
    order.address?.formattedAddress ||
    [order.address?.street, order.address?.city, order.address?.state, order.address?.zipCode]
      .filter(Boolean)
      .join(", ")

  const savings =
    (pricing.discount || 0) +
    (pricing.originalItemTotal || 0) -
    (pricing.subtotal || 0)

  // Restaurant phone (multiple fallbacks) - use fetched restaurant data first
  const restaurantPhone =
    restaurantObj.primaryContactNumber ||
    restaurantObj.phone ||
    restaurantObj.contactNumber ||
    order.restaurantPhone ||
    ""

  const handleCallRestaurant = () => {
    if (!restaurantPhone) {
      toast.error("Restaurant phone number not available")
      return
    }
    window.location.href = `tel:${restaurantPhone}`
  }

  const handleDownloadSummary = async () => {
    try {
      const companyName = await getCompanyNameAsync()
      // Create new PDF document
      const doc = new jsPDF()

      // Title
      doc.setFontSize(16)
      doc.setFont('helvetica', 'bold')
      doc.text(`${companyName} Order: Summary and Receipt`, 105, 20, { align: 'center' })

      // Order details section
      let yPos = 35
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')

      // Order ID
      doc.setFont('helvetica', 'bold')
      doc.text('Order ID:', 20, yPos)
      doc.setFont('helvetica', 'normal')
      doc.text(orderIdDisplay, 60, yPos)
      yPos += 7

      // Order Time
      doc.setFont('helvetica', 'bold')
      doc.text('Order Time:', 20, yPos)
      doc.setFont('helvetica', 'normal')
      const orderTimeLines = doc.splitTextToSize(paymentDate || 'N/A', 130)
      doc.text(orderTimeLines, 60, yPos)
      yPos += orderTimeLines.length * 7

      // Customer Name
      doc.setFont('helvetica', 'bold')
      doc.text('Customer Name:', 20, yPos)
      doc.setFont('helvetica', 'normal')
      doc.text(userName || 'Customer', 60, yPos)
      yPos += 7

      // Delivery Address
      doc.setFont('helvetica', 'bold')
      doc.text('Delivery Address:', 20, yPos)
      doc.setFont('helvetica', 'normal')
      const addressLines = doc.splitTextToSize(addressText || 'N/A', 130)
      doc.text(addressLines, 60, yPos)
      yPos += addressLines.length * 7

      // Restaurant Name
      doc.setFont('helvetica', 'bold')
      doc.text('Restaurant Name:', 20, yPos)
      doc.setFont('helvetica', 'normal')
      doc.text(restaurantName, 60, yPos)
      yPos += 7

      // Restaurant Address
      doc.setFont('helvetica', 'bold')
      doc.text('Restaurant Address:', 20, yPos)
      doc.setFont('helvetica', 'normal')
      const restaurantAddressLines = doc.splitTextToSize(restaurantLocation || 'N/A', 130)
      doc.text(restaurantAddressLines, 60, yPos)
      yPos += restaurantAddressLines.length * 7 + 5

      // Items table
      const tableData = items.map(item => [
        item.variantName ? `${item.name || 'Item'} (${item.variantName})` : (item.name || 'Item'),
        String(item.quantity || item.qty || 1),
        `?${Number(item.price || 0).toFixed(2)}`,
        `?${Number((item.price || 0) * (item.quantity || item.qty || 1)).toFixed(2)}`
      ])

      autoTable(doc, {
        startY: yPos,
        head: [['Item', 'Quantity', 'Unit Price', 'Total Price']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [0, 0, 0], textColor: 255, fontStyle: 'bold', fontSize: 10 },
        styles: { fontSize: 9 },
        columnStyles: {
          0: { cellWidth: 80 },
          1: { cellWidth: 30, halign: 'center' },
          2: { cellWidth: 35, halign: 'right' },
          3: { cellWidth: 35, halign: 'right', fontStyle: 'bold' }
        }
      })

      // Get final Y position after table (autoTable adds lastAutoTable property)
      const finalY = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY : yPos + (tableData.length * 8) + 20

      // Total
      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.text('Total:', 145, finalY + 10, { align: 'right' })
      doc.text(`?${Number(pricing.total || 0).toFixed(2)}`, 195, finalY + 10, { align: 'right' })

      // Save PDF instantly
      const fileName = `Order_Summary_${orderIdDisplay}_${Date.now()}.pdf`
      doc.save(fileName)

      toast.success("Summary downloaded successfully!")
    } catch (error) {
      debugError("Error generating PDF:", error)
      toast.error("Failed to download summary")
    }
  }

  const handleReorder = (currentOrder) => {
    const restaurantId = resolveEntityId(
      restaurantObj._id ||
        restaurantObj.restaurantId ||
        currentOrder?.restaurantId ||
        items?.[0]?.restaurantId ||
        currentOrder?.pickups?.[0]?.restaurantId,
    )
    const restaurantTarget = restaurantObj.slug || restaurantId

    if (!restaurantTarget || !items.length) {
      toast.error("Order items or restaurant information not available")
      return
    }

    const reorderItems = items
      .map((item, index) => {
        const itemId = resolveEntityId(item.itemId || item.id || item._id)
        if (!itemId) return null

        const unitPrice =
          Number(item.variantPrice) > 0
            ? Number(item.variantPrice)
            : Number(item.price) || 0

        return {
          id: itemId,
          itemId,
          name: item.name || item.foodName || "Item",
          price: unitPrice,
          image: item.image || "",
          restaurant: restaurantName,
          restaurantId: resolveEntityId(item.restaurantId) || restaurantId,
          variantId: item.variantId || item.variant?._id || item.variant?.id || "",
          variantName: item.variantName || item.variant?.name || "",
          variantPrice: unitPrice,
          description: item.description || "",
          isVeg: item.isVeg === true || item.foodType === 'Veg',
          quantity: Math.max(1, Number(item.quantity || item.qty) || 1),
          reorderIndex: index,
        }
      })
      .filter(Boolean)

    if (!reorderItems.length) {
      toast.error("No reorderable items found in this order")
      return
    }

    replaceCart(reorderItems)
    toast.success("Items added to cart")
    navigate(`/food/user/restaurants/${restaurantTarget}`)
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a] pb-24 font-sans relative">
      {/* Header */}
      <div className="bg-white dark:bg-[#121212] p-4 flex items-center sticky top-0 z-20 shadow-sm border-b dark:border-gray-800">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <ArrowLeft className="w-6 h-6 text-gray-700 dark:text-gray-300 cursor-pointer" />
          </button>
          <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Order Details</h1>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="p-4 space-y-4">
        {/* Status Card */}
        <div className="bg-white dark:bg-[#121212] p-4 rounded-xl flex items-center gap-3 shadow-sm border dark:border-gray-800">
          <div className="bg-gray-100 dark:bg-gray-800 p-2 rounded-lg">
            <ShoppingBag className="w-6 h-6 text-gray-600 dark:text-gray-400" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-800 dark:text-gray-100">
              {order.status === "delivered"
                ? "Order was delivered"
                : (order.status === "cancelled" || order.status === "cancelled_by_restaurant" || order.status === "restaurant_cancelled" || order.status?.includes('cancel')) 
                  ? "Order was cancelled"
                  : "Order status: " + (order.status || "Processing")}
            </h2>
            {(order.status === "cancelled" || order.status === "cancelled_by_restaurant" || order.status === "restaurant_cancelled" || order.status?.includes('cancel')) && (
              <div className="mt-2 p-3 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-xl">
                  <p className="text-sm text-red-700 dark:text-red-400 font-bold mb-1">Cancellation Reason:</p>
                  <p className="text-sm text-red-600 dark:text-red-300 font-medium">
                    {order.cancellationReason || "The restaurant was unable to fulfill this order."}
                  </p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-2">Refund will be initiated to your source payment method.</p>
              </div>
            )}
          </div>
        </div>

        {/* Restaurant Info Card */}
        <div className="bg-white dark:bg-[#121212] p-4 rounded-xl shadow-sm border dark:border-gray-800">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <img
                src={
                  // Prefer the food image from the first ordered item
                  (Array.isArray(items) && items[0]?.image) ||
                  restaurantObj.profileImage?.url ||
                  restaurantObj.profileImage ||
                  order.restaurantImage ||
                  "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=100&q=80"
                }
                alt={restaurantName}
                className="w-10 h-10 rounded-lg object-cover"
              />
              <div>
                <h3 className="font-semibold text-gray-800 dark:text-gray-100">{restaurantName}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">{restaurantLocation}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleCallRestaurant}
              className="w-8 h-8 rounded-full border border-[#16A34A]/20 flex items-center justify-center text-[#16A34A] hover:bg-[#16A34A]/5"
            >
              <Phone className="w-4 h-4" />
            </button>
          </div>

          {/* Show all restaurants for multi-pickup orders */}
          {order.pickups && order.pickups.length > 1 && (
            <div className="mb-4 space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1 h-4 bg-orange-500 rounded-full" />
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Pickup Locations</p>
              </div>
              {order.pickups.map((pickup, pIdx) => (
                <div key={pIdx} className="flex items-center justify-between bg-gray-50 dark:bg-gray-800/50 p-3 rounded-xl border border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-orange-600 dark:text-orange-400 font-bold text-xs shadow-sm">
                      {pIdx + 1}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{pickup.restaurantName}</p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 line-clamp-1">{pickup.location?.address || pickup.restaurantAddress || restaurantLocation}</p>
                    </div>
                  </div>
                  {pickup.status === 'picked_up' && (
                    <span className="text-[9px] font-black text-green-600 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded-full border border-green-200 dark:border-green-800 uppercase tracking-tighter">Picked</span>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-medium">
              Order ID: #{orderIdDisplay}
            </span>
            <button type="button" onClick={handleCopyOrderId}>
              <Copy className="w-3 h-3 text-gray-400 dark:text-gray-500 cursor-pointer" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${sendsCutlery
                  ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                  : "bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-800"
                }`}
            >
              {sendsCutlery ? "Send cutlery" : "Don't send cutlery"}
            </span>
            {order.note && (
              <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                Note: {order.note}
              </span>
            )}
          </div>

          <div className="border-t border-dashed border-gray-200 dark:border-gray-800 my-3" />

          {/* Items */}
          {items.map((item, idx) => (
            <div key={idx} className="flex justify-between items-start mt-4 first:mt-0">
              <div className="flex items-center gap-3">
                {item.image && (
                  <div className="w-16 h-16 md:w-20 md:h-20 flex-shrink-0 rounded-xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-800">
                    <img 
                      src={item.image} 
                      alt={item.name} 
                      className="w-full h-full object-cover transform hover:scale-110 transition-transform duration-500"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3 h-3 border ${item.isVeg === true || item.foodType === 'Veg' ? "border-green-600" : "border-red-600"
                        } flex items-center justify-center p-[1px]`}
                    >
                      <div
                        className={`w-full h-full rounded-full ${item.isVeg === true || item.foodType === 'Veg' ? "bg-green-600" : "bg-red-600"
                          }`}
                      />
                    </div>
                    <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                      {item.quantity || item.qty || 1} x {item.name}{item.variantName ? ` (${item.variantName})` : ""}
                    </span>
                  </div>
                </div>
              </div>
              <span className="text-sm text-gray-800 dark:text-gray-200 font-medium whitespace-nowrap">
                ₹{(item.price || 0).toFixed(2)}
              </span>
            </div>
          ))}
        </div>

        {/* Bill Summary Card */}
        <div className="bg-white dark:bg-[#121212] rounded-xl shadow-sm overflow-hidden border dark:border-gray-800">
          <div className="p-4 flex justify-between items-center border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              <h3 className="font-semibold text-gray-800 dark:text-gray-100">Bill Summary</h3>
            </div>
            <button
              type="button"
              onClick={handleDownloadSummary}
              className="w-7 h-7 rounded-full bg-[#16A34A]/10 flex items-center justify-center text-[#16A34A] hover:bg-[#16A34A]/20 transition-colors"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Item total</span>
              <div>
                {pricing.originalItemTotal && (
                  <span className="text-gray-400 dark:text-gray-500 line-through mr-1">
                    ₹{Number(pricing.originalItemTotal).toFixed(2)}
                  </span>
                )}
                <span className="text-gray-800 dark:text-gray-200">
                  ₹{Number(pricing.subtotal || pricing.total || 0).toFixed(2)}
                </span>
              </div>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">GST (govt. taxes)</span>
              <span className="text-gray-800 dark:text-gray-200">
                ₹{Number(pricing.tax || 0).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400 dark:text-gray-500 font-medium">Delivery fee</span>
              {pricing.deliveryFee === 0 && (
                <span className="text-[#16A34A] text-[10px] font-bold border border-[#16A34A] px-1 rounded ml-1">
                  FREE
                </span>
              )}
              <span className="text-[#16A34A] dark:text-[#a04882] font-medium uppercase">
                {pricing.deliveryFee ? `₹${Number(pricing.deliveryFee).toFixed(2)}` : "Free"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Platform fee</span>
              <span className="text-gray-800 dark:text-gray-200">
                ₹{Number(pricing.platformFee || 0).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Subscription / other fees</span>
              <span className="text-gray-800 dark:text-gray-200">
                ₹{Number(pricing.subscriptionFee || 0).toFixed(2)}
              </span>
            </div>

            <div className="border-t border-gray-100 dark:border-gray-800 my-2 pt-2 flex justify-between items-center">
              <span className="font-bold text-gray-800 dark:text-gray-100">Paid</span>
              <span className="font-bold text-gray-800 dark:text-gray-100">
                ₹{Number(pricing.total || 0).toFixed(2)}
              </span>
            </div>
          </div>

          {/* Savings Banner */}
          {savings > 0 && (
            <div className="relative bg-[#16A34A]/5 p-3 pb-4 mt-2">
              <div className="absolute -top-1.5 left-0 w-full overflow-hidden leading-none">
                <svg
                  className="relative block w-[calc(100%+1.3px)] h-[8px]"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 1200 120"
                  preserveAspectRatio="none"
                >
                  <path
                    d="M0,0V46.29c47,0,47,69.5,94,69.5s47-69.5,94-69.5,47,69.5,94,69.5,47-69.5,94-69.5,47,69.5,94,69.5,47-69.5,94-69.5,47,69.5,94,69.5,47-69.5,94-69.5,47,69.5,94,69.5V0Z"
                    fill="#ffffff"
                    className="fill-white"
                  />
                </svg>
              </div>

              <div className="flex items-center justify-center gap-2 pt-1 text-[#16A34A] font-bold text-sm">
                <span></span>
                <span>
                  You saved ₹{Number(savings).toFixed(2)} on this order!
                </span>
              </div>
            </div>
          )}
        </div>

        {/* User & Delivery Details */}
        <div className="bg-white dark:bg-[#121212] p-4 rounded-xl shadow-sm space-y-5 border dark:border-gray-800">
          {/* User */}
          <div className="flex gap-3">
            <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-800 flex items-center justify-center">
              <User className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </div>
            <div>
              <h4 className="font-semibold text-gray-800 dark:text-gray-200 text-sm">
                {userName || "Customer"}
              </h4>
              <p className="text-gray-500 dark:text-gray-400 text-xs">{userPhone}</p>
            </div>
          </div>

          {/* Payment */}
          <div className="flex gap-3">
            <div className="mt-0.5">
              <CreditCard className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </div>
            <div>
              <h4 className="font-semibold text-gray-800 dark:text-gray-200 text-sm">
                Payment method
              </h4>
              {order.payment?.cod?.enabled ? (
                <div className="mt-0.5 space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                  <p className="font-semibold text-gray-700 dark:text-gray-200">Cash on Delivery (advance + cash)</p>
                  <p>
                    Paid in advance: ₹{Number(order.payment.cod.advanceAmount || 0).toFixed(2)}
                    {Number(order.payment.cod.advanceWalletAmount) > 0 || Number(order.payment.cod.advanceOnlineAmount) > 0
                      ? ` (Wallet ₹${Number(order.payment.cod.advanceWalletAmount || 0).toFixed(2)} + Online ₹${Number(order.payment.cod.advanceOnlineAmount || 0).toFixed(2)})`
                      : ""}
                  </p>
                  {order.payment.cod.advanceStatus === "refunded" ? (
                    <p className="font-semibold text-emerald-600">
                      Advance ₹{Number(order.payment.cod.refundedAmount || 0).toFixed(2)} refunded to your wallet
                    </p>
                  ) : order.payment.cod.collectedAt || order.payment.status === "paid" ? (
                    <p className="font-semibold text-emerald-600">Paid in cash on delivery: ₹{Number(order.payment.cod.collectedAmount || order.payment.cod.remainingAmount || 0).toFixed(2)}</p>
                  ) : (
                    <p className="font-semibold text-amber-600">To pay in cash on delivery: ₹{Number(order.payment.cod.remainingAmount || 0).toFixed(2)}</p>
                  )}
                </div>
              ) : (
                <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">
                  Paid via: {paymentMethod.toUpperCase()}
                </p>
              )}
            </div>
          </div>

          {/* Date */}
          <div className="flex gap-3">
            <div className="mt-0.5">
              <Calendar className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </div>
            <div>
              <h4 className="font-semibold text-gray-800 dark:text-gray-200 text-sm">
                Payment date
              </h4>
              <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">{paymentDate}</p>
            </div>
          </div>

          {/* Address */}
          <div className="flex gap-3">
            <div className="mt-0.5">
              <MapPin className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </div>
            <div>
              <h4 className="font-semibold text-gray-800 dark:text-gray-200 text-sm">
                Delivery address
              </h4>
              <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5 leading-relaxed">
                {addressText || "Address not available"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Fixed Bottom Buttons */}
      <div className="fixed bottom-0 w-full bg-white dark:bg-[#121212] border-t border-gray-200 dark:border-gray-800 p-4 flex gap-3 z-20">
        <button
          type="button"
          onClick={() => handleReorder(order)}
          className="flex-1 bg-[#16A34A] text-white py-3 rounded-lg font-semibold flex items-center justify-center gap-2 hover:bg-[#15803D] transition-all active:scale-95 shadow-md"
        >
          <RotateCcw className="w-4 h-4" />
          Reorder
        </button>
        <button
          type="button"
          onClick={handleDownloadSummary}
          className="flex-1 bg-white dark:bg-[#1a1a1a] border border-[#16A34A] text-[#16A34A] py-3 rounded-lg font-semibold flex items-center justify-center gap-2 hover:bg-[#16A34A]/5 transition-colors"
        >
          <Download className="w-4 h-4" />
          Invoice
        </button>
      </div>

      {/* Restaurant Complaint Button - Below Order Details */}
      {order && (
        <div className="p-4 pb-24">
          <button
            type="button"
            onClick={() => {
              // Use MongoDB _id (ObjectId) for the API call - backend complaint controller expects ObjectId
              // Priority: order._id (MongoDB ObjectId) > orderId from route params
              const orderMongoId = order._id || orderId

              if (!orderMongoId) {
                debugError("Order ID not available:", {
                  order: order ? { _id: order._id, orderId: order.orderId } : null,
                  routeOrderId: orderId
                })
                toast.error("Order ID not available. Please refresh the page.")
                return
              }

              // Convert to string if it's an ObjectId object
              const orderIdString = typeof orderMongoId === 'object' && orderMongoId.toString
                ? orderMongoId.toString()
                : String(orderMongoId)

              debugLog("Navigating to complaint page with orderId:", orderIdString)
              navigate(`/user/complaints/submit/${encodeURIComponent(orderIdString)}`)
            }}
            className="w-full bg-[#16A34A]/5 border border-[#16A34A]/20 text-[#16A34A] py-3 rounded-lg font-semibold flex items-center justify-center gap-2 hover:bg-[#16A34A]/10 transition-colors"
          >
            <FileText className="w-4 h-4" />
            Restaurant Complaint
          </button>
        </div>
      )}
    </div>
  )
}




