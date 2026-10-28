import ResendNotificationButton from "@food/components/restaurant/ResendNotificationButton";

export default function OrderDetailPanel({ order, onClose, className = "" }) {
  if (!order) return null;

  const status = String(order.status || "").toLowerCase();
  const isReady = status === "ready";
  const isPreparing = status === "preparing";

  const rawPayment = order.paymentMethod;
  const normalizedPayment =
    rawPayment != null ? String(rawPayment).toLowerCase().trim() : "";
  const isCod = normalizedPayment === "cash" || normalizedPayment === "cod";

  return (
    <div className={`flex flex-col bg-white h-full overflow-hidden rounded-3xl ${className}`}>
      {/* Header */}
      <div className="border-b border-[var(--rt-border)] px-5 py-3 bg-gradient-to-b from-gray-50/30 to-white flex-shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-gray-900 tracking-tight">
              Order #{order.orderId}
            </p>
            <p className="mt-0.5 text-xs font-medium text-gray-700">
              {order.customerName}
            </p>
            <p className="text-[10px] text-gray-500">
              {order.type}
              {order.tableOrToken ? ` • ${order.tableOrToken}` : ""}
            </p>
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[9px] font-semibold shadow-sm ${isReady
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : status === "cancelled"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : status === "rejected"
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : status === "delivered" || status === "completed"
                      ? "border-blue-200 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-gray-50 text-gray-800"
              }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${isReady
                  ? "bg-emerald-500"
                  : status === "cancelled"
                    ? "bg-red-500"
                    : status === "rejected"
                      ? "bg-amber-500"
                      : status === "delivered" || status === "completed"
                        ? "bg-blue-500"
                        : "bg-gray-500"
                }`}
            />
            {String(order.status || "")
              .replace(/_/g, " ")
              .replace(/\b\w/g, (c) => c.toUpperCase())}
          </span>
        </div>
        <p className="mt-1.5 text-[10px] text-gray-400 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {order.timePlaced || "Just now"}
        </p>
      </div>

      {/* Content - Scrollable with hidden scrollbar */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 scrollbar-hide">
        {/* Items Section */}
        <section>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Items
          </p>
          <div className="rounded-xl bg-[var(--rt-surface-muted)] px-4 py-3 text-xs text-gray-700 border border-[var(--rt-border)]">
            {order.items && order.items.length > 0 ? (
              <div className="space-y-3">
                {order.items.map((item, index) => (
                  <div key={index} className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${item.isVeg ? "bg-green-500" : "bg-red-500"}`} />
                      <span className="font-semibold text-slate-800">{item.quantity} x {item.name}</span>
                    </div>
                    {item.price && <span className="text-slate-600 font-medium">₹{(item.price * item.quantity).toFixed(2)}</span>}
                  </div>
                ))}
              </div>
            ) : (
              <div>{order.itemsSummary}</div>
            )}
          </div>
        </section>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-2.5">
          {order.amount != null && order.amount > 0 ? (
            <div className="rounded-xl border border-[var(--rt-border)] px-3.5 py-2.5 bg-white shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                You get
              </p>
              <p className="mt-1 font-bold text-gray-900 text-base">
                ₹{Number(order.amount).toFixed(2)}
              </p>
            </div>
          ) : null}
          {!isReady && order.eta ? (
            <div className="rounded-xl border border-[var(--rt-border)] px-3.5 py-2.5 bg-white shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                ETA
              </p>
              <p className="mt-1 font-bold text-gray-900 text-base">
                {order.eta}
              </p>
            </div>
          ) : null}
          <div className={`rounded-xl border border-[var(--rt-border)] px-3.5 py-2.5 bg-white shadow-sm ${(!order.amount && (!order.eta || isReady)) ? "col-span-2" : ""}`}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              Payment
            </p>
            <p className={`mt-1 font-semibold text-base ${isCod ? "text-amber-700" : "text-gray-900"}`}>
              {isCod ? (
                <span className="flex items-center gap-1.5">
                  <span>Cash on Delivery</span>
                  <span className="text-[9px] font-normal text-amber-500 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                    COD
                  </span>
                </span>
              ) : (
                "Paid Online"
              )}
            </p>
          </div>
        </div>

        {/* Cancellation Reason */}
        {status === "cancelled" && order.cancellationReason && (
          <div className="rounded-xl border border-red-200 bg-red-50/70 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-red-500 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Cancellation Reason
            </p>
            <p className="mt-1 text-sm text-red-700 font-medium">
              {order.cancellationReason}
            </p>
          </div>
        )}

        {/* Rejection Reason */}
        {status === "rejected" && order.rejectionReason && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Rejection Reason
            </p>
            <p className="mt-1 text-sm text-amber-700 font-medium">
              {order.rejectionReason}
            </p>
          </div>
        )}

        {/* Pickup OTP */}
        {order.pickupOtp && !order.pickupOtpVerified && (
          <div className="rounded-xl border border-orange-200 bg-orange-50/70 px-4 py-3 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-wider text-orange-600">
              Pickup OTP — share with rider
            </p>
            <p className="text-lg font-black tracking-widest text-orange-700">{order.pickupOtp}</p>
          </div>
        )}

        {/* Restaurant Note */}
        {order.restaurantNote && (
          <div className="rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
              Note for Restaurant
            </p>
            <p className="mt-1 text-sm text-blue-700 font-medium">
              {order.restaurantNote}
            </p>
          </div>
        )}

        {/* Resend Notification Button */}
        {(isPreparing || isReady) && !order.deliveryPartnerId && (
          <div className="pt-1">
            <ResendNotificationButton
              orderId={order.orderId}
              mongoId={order.mongoId}
              onSuccess={onClose}
            />
          </div>
        )}
      </div>

      {/* Footer - Full width button */}
      {onClose && (
        <div className="border-t border-[var(--rt-border)] px-5 py-3.5 bg-gray-50/30 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 text-sm font-semibold rounded-xl bg-gray-900 text-white hover:bg-gray-800 transition-all duration-200 shadow-sm hover:shadow-md active:scale-[0.98]"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}