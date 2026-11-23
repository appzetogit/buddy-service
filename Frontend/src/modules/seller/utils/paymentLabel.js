/** Payment line for the seller: the rider (not the seller) collects any COD cash. */
export function sellerPaymentLabel(order) {
  const method = order?.payment?.method;
  if (method !== "cash" && method !== "cod") return "Online Paid";
  const c = order?.payment?.cod;
  if (!c?.enabled) return "Cash on Delivery";
  const inr = (n) => `₹${Number(n || 0).toFixed(0)}`;
  const tail =
    c.advanceStatus === "refunded"
      ? `${inr(c.refundedAmount)} refunded to the customer`
      : c.collectedAt || order?.payment?.status === "paid"
        ? "cash collected by the rider"
        : `${inr(c.remainingAmount)} to be collected by the rider`;
  return `COD · ${inr(c.advanceAmount)} paid in advance · ${tail}`;
}
