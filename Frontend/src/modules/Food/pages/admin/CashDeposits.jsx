import { useCallback, useEffect, useState } from "react"
import { Landmark, RefreshCw } from "lucide-react"
import { adminAPI } from "@food/api"
import { toast } from "sonner"

const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const STATUS_TONE = { Completed: "bg-emerald-50 text-emerald-700", Pending: "bg-amber-50 text-amber-700", Failed: "bg-red-50 text-red-600" }
const field = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900"

export default function CashDeposits() {
  const [filters, setFilters] = useState({ search: "", status: "", from: "", to: "" })
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState({ total: 0, totals: null })
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const limit = 25

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const params = { page, limit, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) }
      // the backend filters by rider id; a typed name/phone is matched client-side below
      delete params.search
      const res = await adminAPI.getCashDeposits(params)
      const d = res?.data?.data || {}
      setRows(d.deposits || [])
      setMeta({ total: d.pagination?.total ?? d.total ?? 0, totals: d.totals || null })
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load cash deposits")
    } finally {
      setLoading(false)
    }
  }, [filters.status, filters.from, filters.to, page]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load()
  }, [load])

  const q = filters.search.trim().toLowerCase()
  const shown = q ? rows.filter((r) => `${r.partnerName || ""} ${r.partnerPhone || ""}`.toLowerCase().includes(q)) : rows
  const pages = Math.max(1, Math.ceil(meta.total / limit))

  return (
    <div className="space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><Landmark className="h-5 w-5" /> Cash Deposits</h1>
          <p className="text-sm text-slate-500">Cash riders have deposited online. A completed deposit reduces their cash in hand.</p>
        </div>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Completed deposits</div><div className="mt-1 text-2xl font-extrabold text-emerald-600">{inr(meta.totals?.completedAmount)}</div></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Records</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{meta.total}</div></div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Rider name or phone (this page)" className={`${field} min-w-[220px]`} />
        <select value={filters.status} onChange={(e) => { setPage(1); setFilters({ ...filters, status: e.target.value }) }} className={field}>
          <option value="">All status</option>
          <option value="Completed">Completed</option>
          <option value="Pending">Pending</option>
          <option value="Failed">Failed</option>
        </select>
        <input type="date" value={filters.from} onChange={(e) => { setPage(1); setFilters({ ...filters, from: e.target.value }) }} className={field} />
        <span className="text-slate-400">to</span>
        <input type="date" value={filters.to} onChange={(e) => { setPage(1); setFilters({ ...filters, to: e.target.value }) }} className={field} />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Rider</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3">Method</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Razorpay payment</th><th className="px-4 py-3">Note</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-14 text-center text-slate-500">Loading...</td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-14 text-center text-slate-500">No deposits found</td></tr>
            ) : (
              shown.map((r) => (
                <tr key={r._id}>
                  <td className="whitespace-nowrap px-4 py-3">{r.createdAt ? new Date(r.createdAt).toLocaleString("en-IN") : "—"}</td>
                  <td className="px-4 py-3"><div className="font-semibold text-slate-800">{r.partnerName || "—"}</div><div className="text-xs text-slate-400">{r.partnerPhone}</div></td>
                  <td className="px-4 py-3 text-right font-bold">{inr(r.amount)}</td>
                  <td className="px-4 py-3 capitalize">{r.method || "—"}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_TONE[r.status] || "bg-slate-100 text-slate-600"}`}>{r.status}</span></td>
                  <td className="px-4 py-3 text-xs text-slate-500">{r.razorpayPaymentId || "—"}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{r.note || ""}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>Page {page} of {pages}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg border border-slate-300 bg-white px-4 py-2 disabled:opacity-50">Previous</button>
            <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} className="rounded-lg border border-slate-300 bg-white px-4 py-2 disabled:opacity-50">Next</button>
          </div>
        </div>
      )}
    </div>
  )
}
