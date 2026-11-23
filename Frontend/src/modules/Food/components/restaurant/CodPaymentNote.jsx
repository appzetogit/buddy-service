const inr = (n) => `₹${Number(n || 0).toFixed(0)}`

/** What the restaurant needs to know about payment: the rider (not the restaurant) collects any cash. */
export default function CodPaymentNote({ order, className = "" }) {
  const cod = order?.payment?.cod || order?.cod
  if (!cod?.enabled) return null
  const refunded = cod.advanceStatus === "refunded"
  const collected = Boolean(cod.collectedAt) || order?.payment?.status === "paid"
  return (
    <p className={`text-[11px] font-semibold leading-snug text-amber-700 ${className}`}>
      COD · customer paid {inr(cod.advanceAmount)} in advance
      {refunded
        ? ` (refunded ${inr(cod.refundedAmount)} to the customer's wallet)`
        : collected
          ? ` · rider collected ${inr(cod.collectedAmount || cod.remainingAmount)} cash`
          : ` · ${inr(cod.remainingAmount)} to be collected by the rider`}
    </p>
  )
}
