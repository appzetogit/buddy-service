import { useCallback, useEffect, useState } from "react"
import { Star } from "lucide-react"
import { toast } from "sonner"
import { restaurantAPI } from "@food/api"
import RestaurantSubPageShell from "@food/components/restaurant/panel/RestaurantSubPageShell"
import { PanelSurface } from "@food/components/restaurant/panel/panelUi"
import { RESTAURANT_BASE } from "@food/utils/restaurantNavConfig"

const Stars = ({ value }) => (
  <span className="inline-flex gap-0.5">
    {[1, 2, 3, 4, 5].map((s) => (
      <Star key={s} className={`h-3.5 w-3.5 ${s <= Math.round(value) ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`} />
    ))}
  </span>
)

/** What customers rated this restaurant's dishes. The restaurant's rating is the average of these dish ratings. */
export default function DishRatings() {
  const [data, setData] = useState(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const res = await restaurantAPI.getDishRatings({ page, limit: 20 })
      setData(res?.data?.data || null)
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load dish ratings")
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => {
    load()
  }, [load])

  const summary = data?.summary || { average: 0, totalRatings: 0 }
  const items = data?.items || []
  const reviews = data?.reviews || []
  const pages = data?.pagination?.pages || 1

  return (
    <RestaurantSubPageShell
      title="Dish ratings"
      subtitle="Customers rate the dishes they ordered. Your restaurant rating is the average of these"
      backTo={`${RESTAURANT_BASE}/explore`}
    >
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <PanelSurface className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Restaurant rating</div>
          <div className="mt-1 text-2xl font-bold text-green-600">{summary.totalRatings ? `${Number(summary.average).toFixed(1)} ★` : "—"}</div>
        </PanelSurface>
        <PanelSurface className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Total ratings</div>
          <div className="mt-1 text-2xl font-bold text-gray-900">{summary.totalRatings}</div>
        </PanelSurface>
      </div>

      <PanelSurface className="mt-4">
        <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">By dish</div>
        {items.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-500">{loading ? "Loading..." : "You haven't received any dish ratings yet."}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {items.map((i) => (
              <li key={i.itemId} className="flex items-center gap-3 px-4 py-3">
                {i.image ? <img src={i.image} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <div className="h-10 w-10 rounded-lg bg-gray-100" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{i.name}</p>
                  <p className="text-xs text-gray-400">{i.count} rating{i.count === 1 ? "" : "s"}</p>
                </div>
                <div className="text-right">
                  <Stars value={i.average} />
                  <p className="text-xs font-semibold text-gray-600">{Number(i.average).toFixed(1)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PanelSurface>

      <PanelSurface className="mt-4">
        <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">Latest reviews</div>
        {reviews.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">No reviews yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {reviews.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-medium text-gray-900">{r.itemName}</p>
                  <Stars value={r.rating} />
                </div>
                {r.comment ? <p className="mt-1 text-sm text-gray-600">&ldquo;{r.comment}&rdquo;</p> : null}
                <p className="mt-1 text-[11px] text-gray-400">
                  {r.customerName || "Customer"} · {r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-4 py-3">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-gray-200 px-3 py-1 text-xs disabled:opacity-40">Prev</button>
            <span className="text-xs text-gray-500">Page {page} of {pages}</span>
            <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-gray-200 px-3 py-1 text-xs disabled:opacity-40">Next</button>
          </div>
        )}
      </PanelSurface>
    </RestaurantSubPageShell>
  )
}
