import { useCallback, useEffect, useState } from "react"
import { RefreshCw, Star } from "lucide-react"
import { adminAPI } from "@food/api"
import { toast } from "sonner"

const TABS = [
  { key: "", label: "All", count: "ALL" },
  { key: "restaurant", label: "Food dishes", count: "restaurant" },
  { key: "seller", label: "Marketplace products", count: "seller" },
]
const field = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900"
const Stars = ({ value }) => (
  <span className="inline-flex gap-0.5">
    {[1, 2, 3, 4, 5].map((s) => (
      <Star key={s} className={`h-3.5 w-3.5 ${s <= value ? "fill-yellow-400 text-yellow-400" : "text-slate-300"}`} />
    ))}
  </span>
)

/** Every dish / product rating customers gave after a delivered order. Restaurant and seller scores are built from these. */
export default function ItemRatings() {
  const [ownerType, setOwnerType] = useState("")
  const [search, setSearch] = useState("")
  const [rows, setRows] = useState([])
  const [counts, setCounts] = useState({})
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const res = await adminAPI.getItemReviews({ ownerType: ownerType || undefined, search: search.trim() || undefined, page, limit: 25 })
      const d = res?.data?.data || {}
      setRows(d.items || [])
      setCounts(d.counts || {})
      setPages(d.pagination?.pages || 1)
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load ratings")
    } finally {
      setLoading(false)
    }
  }, [ownerType, page]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><Star className="h-5 w-5" /> Item Ratings</h1>
          <p className="text-sm text-slate-500">Customers rate the dishes / products they got. A restaurant's or seller's rating is the average of these ratings.</p>
        </div>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key || "all"}
            onClick={() => { setPage(1); setOwnerType(t.key) }}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${ownerType === t.key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
          >
            {t.label} <span className="ml-1 opacity-70">{counts[t.count] ?? 0}</span>
          </button>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); setPage(1); load() }} className="ml-auto flex items-center gap-2">
          <input className={field} placeholder="Search item, customer, comment, order" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Search</button>
        </form>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>{["Date", "Item", "For", "Rating", "Comment", "Customer", "Order"].map((h) => <th key={h} className="whitespace-nowrap px-4 py-3">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">{loading ? "Loading..." : "No ratings yet"}</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50/60">
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-"}</td>
                <td className="px-4 py-3 font-semibold text-slate-900">{r.itemName || "-"}</td>
                <td className="whitespace-nowrap px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${r.ownerType === "seller" ? "bg-emerald-50 text-emerald-700" : "bg-orange-50 text-orange-700"}`}>{r.ownerType === "seller" ? "Seller" : "Restaurant"}</span></td>
                <td className="px-4 py-3"><Stars value={r.rating} /></td>
                <td className="max-w-[280px] px-4 py-3 text-slate-600">{r.comment || <span className="text-slate-300">-</span>}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.customerName || "-"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-500">{r.orderRef || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-40">Prev</button>
          <span className="text-sm text-slate-500">Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  )
}
