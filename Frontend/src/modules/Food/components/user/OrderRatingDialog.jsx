import { useEffect, useMemo, useState } from "react"
import { Loader2, Star } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@food/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@food/components/ui/dialog"
import { Textarea } from "@food/components/ui/textarea"
import { orderAPI } from "@food/api"

const itemKey = (item) => String(item?.itemId || item?.id || item?._id || "")

const Stars = ({ value, onChange, size = "w-8 h-8" }) => (
  <div className="flex gap-1.5">
    {[1, 2, 3, 4, 5].map((star) => (
      <button key={star} type="button" onClick={() => onChange(star)} className="p-0.5" aria-label={`${star} star`}>
        <Star className={`${size} transition-colors ${star <= (value || 0) ? "fill-yellow-400 text-yellow-400" : "text-gray-200 dark:text-gray-700"}`} />
      </button>
    ))}
  </div>
)

/**
 * After a delivered order the customer rates the dishes / products they got (each 1-5, comment optional) and the
 * delivery partner. The restaurant / seller is not rated directly: their score is built from their items' ratings.
 * Works for Food and Marketplace orders (the api client picks the right endpoint).
 */
export default function OrderRatingDialog({ open, onOpenChange, order, onRated }) {
  const [rows, setRows] = useState({})
  const [driverRating, setDriverRating] = useState(null)
  const [driverComment, setDriverComment] = useState("")
  const [saving, setSaving] = useState(false)

  const ratedIds = useMemo(() => new Set((order?.ratings?.items || []).map((r) => String(r.itemId))), [order])
  const items = useMemo(() => {
    const seen = new Set()
    return (order?.items || []).filter((it) => {
      const k = itemKey(it)
      if (!k || seen.has(k)) return false
      seen.add(k)
      return true
    })
  }, [order])
  const hasDriver = !!(order?.deliveryPartnerId || order?.deliveryPartnerName)
  const driverDone = Number.isFinite(Number(order?.ratings?.deliveryPartner?.rating || order?.deliveryPartnerRating))

  useEffect(() => {
    if (open) {
      setRows({})
      setDriverRating(null)
      setDriverComment("")
    }
  }, [open, order?.id, order?._id])

  const setRow = (key, patch) => setRows((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), ...patch } }))
  const chosen = items.filter((it) => !ratedIds.has(itemKey(it)) && rows[itemKey(it)]?.rating)
  const canSubmit = !saving && (chosen.length > 0 || (hasDriver && !driverDone && driverRating))

  const submit = async () => {
    if (!canSubmit) {
      toast.error("Please give at least one rating")
      return
    }
    try {
      setSaving(true)
      const response = await orderAPI.submitOrderRatings(order.mongoId || order._id || order.id, {
        items: chosen.map((it) => ({
          itemId: itemKey(it),
          rating: rows[itemKey(it)].rating,
          comment: (rows[itemKey(it)].comment || "").trim() || undefined,
        })),
        ...(hasDriver && !driverDone && driverRating
          ? { deliveryPartnerRating: driverRating, deliveryPartnerComment: driverComment.trim() || undefined }
          : {}),
      })
      const updated = response?.data?.data?.order || response?.data?.order || null
      toast.success("Thanks for your feedback!")
      onRated?.(updated, {
        items: chosen.map((it) => ({ itemId: itemKey(it), name: it.name, rating: rows[itemKey(it)].rating, comment: rows[itemKey(it)].comment || "" })),
        deliveryPartner: hasDriver && !driverDone && driverRating ? { rating: driverRating, comment: driverComment } : null,
      })
      onOpenChange(false)
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to submit ratings")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[95vw] overflow-y-auto rounded-3xl border-0 bg-white p-6 shadow-2xl dark:bg-[#1a1a1a] sm:max-w-md">
        <DialogHeader className="mb-1">
          <DialogTitle className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white">
            <Star className="h-6 w-6 fill-[#16A34A] text-[#16A34A]" />
            Rate your order
          </DialogTitle>
          <p className="text-xs text-gray-500">Rate what you ordered. The restaurant / shop score is made from these ratings.</p>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {items.map((it) => {
            const key = itemKey(it)
            const done = ratedIds.has(key)
            const existing = (order?.ratings?.items || []).find((r) => String(r.itemId) === key)
            return (
              <div key={key} className="rounded-2xl border border-gray-100 p-3 dark:border-gray-800">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold text-gray-800 dark:text-gray-200">
                    {it.name}{it.variantName ? ` (${it.variantName})` : ""}
                    {it.quantity > 1 ? <span className="ml-1 text-xs font-normal text-gray-400">x{it.quantity}</span> : null}
                  </p>
                  {done ? <span className="shrink-0 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-bold text-green-700">Rated {existing?.rating} ★</span> : null}
                </div>
                {!done && (
                  <>
                    <div className="mt-2"><Stars value={rows[key]?.rating} onChange={(v) => setRow(key, { rating: v })} /></div>
                    {rows[key]?.rating ? (
                      <Textarea
                        placeholder="Tell us more (optional)"
                        value={rows[key]?.comment || ""}
                        onChange={(e) => setRow(key, { comment: e.target.value })}
                        maxLength={500}
                        className="mt-2 min-h-[60px] resize-none rounded-xl border-gray-100 bg-gray-50 text-sm dark:border-gray-800 dark:bg-gray-800/50"
                      />
                    ) : null}
                  </>
                )}
              </div>
            )
          })}

          {hasDriver && !driverDone && (
            <div className="space-y-2 border-t border-gray-100 pt-4 dark:border-gray-800">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-gray-800 dark:text-gray-200">How was the delivery?</p>
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">Delivery</span>
              </div>
              <Stars value={driverRating} onChange={setDriverRating} size="w-9 h-9" />
              <Textarea
                placeholder={`How was ${order?.deliveryPartnerName || "the rider"}? (optional)`}
                value={driverComment}
                onChange={(e) => setDriverComment(e.target.value)}
                maxLength={500}
                className="min-h-[60px] resize-none rounded-xl border-gray-100 bg-gray-50 text-sm dark:border-gray-800 dark:bg-gray-800/50"
              />
            </div>
          )}

          <Button onClick={submit} disabled={!canSubmit} className="mt-2 h-14 w-full rounded-2xl bg-[#16A34A] font-bold text-white shadow-lg hover:bg-[#15803D]">
            {saving ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : "Submit Feedback"}
          </Button>
          <button onClick={() => onOpenChange(false)} className="w-full py-2 text-sm font-medium text-gray-400 hover:text-gray-600">
            Maybe later
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
