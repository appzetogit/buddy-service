import { useCallback, useEffect, useState } from "react"
import { RefreshCw, UserX } from "lucide-react"
import { adminAPI } from "@food/api"
import { toast } from "sonner"

const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const TABS = [
  { key: "", label: "All", count: "ALL" },
  { key: "USER", label: "Customers", count: "USER" },
  { key: "SELLER", label: "Sellers", count: "SELLER" },
  { key: "RESTAURANT", label: "Restaurants", count: "RESTAURANT" },
  { key: "DELIVERY_PARTNER", label: "Drivers", count: "DELIVERY_PARTNER" },
]
const TYPE_LABEL = { USER: "Customer", SELLER: "Seller", RESTAURANT: "Restaurant", DELIVERY_PARTNER: "Driver" }
const TYPE_TONE = {
  USER: "bg-sky-50 text-sky-700",
  SELLER: "bg-emerald-50 text-emerald-700",
  RESTAURANT: "bg-orange-50 text-orange-700",
  DELIVERY_PARTNER: "bg-violet-50 text-violet-700",
}
const field = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900"

export default function DeletedAccounts() {
  const [type, setType] = useState("")
  const [search, setSearch] = useState("")
  const [rows, setRows] = useState([])
  const [counts, setCounts] = useState({})
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const limit = 25

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const res = await adminAPI.getDeletedAccounts({ type: type || undefined, search: search.trim() || undefined, page, limit })
      const d = res?.data?.data || {}
      setRows(d.items || [])
      setCounts(d.counts || {})
      setPages(d.pagination?.pages || 1)
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load deleted accounts")
    } finally {
      setLoading(false)
    }
  }, [type, page]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><UserX className="h-5 w-5" /> Deleted Accounts</h1>
          <p className="text-sm text-slate-500">Customers, sellers, restaurants and drivers who deleted their account. Their listings (foods, products) are no longer shown to customers; order and money history is kept.</p>
        </div>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key || "all"}
            onClick={() => { setPage(1); setType(t.key) }}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${type === t.key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
          >
            {t.label} <span className="ml-1 opacity-70">{counts[t.count] ?? 0}</span>
          </button>
        ))}
        <form
          onSubmit={(e) => { e.preventDefault(); setPage(1); load() }}
          className="ml-auto flex items-center gap-2"
        >
          <input className={field} placeholder="Search name, phone, email" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Search</button>
        </form>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              {["Deleted on", "Account", "Type", "Phone / Email", "Deleted by", "Reason", "Orders", "Wallet", "Pending payout"].map((h) => (
                <th key={h} className="whitespace-nowrap px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">{loading ? "Loading..." : "No deleted accounts"}</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50/60">
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.deletedAt ? new Date(r.deletedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-"}</td>
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-900">{r.name || "-"}</div>
                  {r.shopName ? <div className="text-xs text-slate-500">{r.shopName}</div> : null}
                </td>
                <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${TYPE_TONE[r.accountType] || "bg-slate-100 text-slate-600"}`}>{TYPE_LABEL[r.accountType] || r.accountType}</span></td>
                <td className="px-4 py-3 text-slate-600"><div>{r.phone || "-"}</div><div className="text-xs text-slate-400">{r.email}</div></td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.source === "admin" ? "Admin" : "The user"}</td>
                <td className="max-w-[240px] px-4 py-3 text-slate-600">{r.reason || <span className="text-slate-300">-</span>}</td>
                <td className="px-4 py-3 text-slate-700">{r.orderCount}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-700">{inr(r.financialSnapshot?.walletBalance)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-700">{inr(r.financialSnapshot?.pendingWithdrawals)}</td>
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
