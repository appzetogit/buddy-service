import { useState, useEffect, useCallback } from "react"
import { Search, PiggyBank, Loader2, Package, RefreshCw, X } from "lucide-react"
import { adminAPI } from "@food/api"
import { toast } from "sonner"

const inr = (amount) => `₹${Number(amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const num = (v) => Number(v || 0)
const SERVICES = [
  { key: "food", label: "Food", tone: "bg-orange-50 text-orange-700" },
  { key: "quickCommerce", label: "Marketplace", tone: "bg-blue-50 text-blue-700" },
  { key: "taxi", label: "Taxi", tone: "bg-violet-50 text-violet-700" },
]
const svcLabel = (k) => SERVICES.find((s) => s.key === k)?.label || k
const rowId = (w) => w.partnerId || w.deliveryId || w._id
// Cash a rider holds for one service ("all" = every service together). Backend sends byService.{collected,pending}.
const cashFor = (w, svc) => (svc === "all" ? num(w.cashInHand) : num(w.byService?.[svc]?.collected))
const pendingFor = (w, svc) => (svc === "all" ? num(w.pendingCash) : num(w.byService?.[svc]?.pending))

function RiderCashDialog({ partner, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await adminAPI.getRiderCashDetails(rowId(partner))
        if (!cancelled) setData(res?.data?.data || null)
      } catch (e) {
        if (!cancelled) toast.error(e?.response?.data?.message || "Could not load the rider's cash details")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [partner])
  const s = data?.summary || partner
  const by = data?.byService || partner.byService || {}
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b bg-white px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{partner.name || "Rider"} · Cash</h2>
            <p className="text-xs text-slate-500">{partner.phone}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-slate-100" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
        ) : (
          <div className="space-y-5 p-6 text-sm">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Cash in hand", inr(s.cashInHand), "text-slate-900"],
                ["Pending cash", inr(s.pendingCash), "text-amber-600"],
                ["Limit", num(s.limit) > 0 ? inr(s.limit) : "No limit", "text-slate-900"],
                [s.blocked ? "Status" : "Available", s.blocked ? "Blocked" : s.available == null ? "—" : inr(s.available), s.blocked ? "text-red-600" : "text-emerald-600"],
              ].map(([label, value, tone]) => (
                <div key={label} className="rounded-xl border border-slate-200 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
                  <div className={`mt-1 text-lg font-extrabold ${tone}`}>{value}</div>
                </div>
              ))}
            </div>

            <div>
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Cash by service</div>
              <div className="grid gap-3 sm:grid-cols-3">
                {SERVICES.map((sv) => (
                  <div key={sv.key} className="rounded-xl border border-slate-200 p-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${sv.tone}`}>{sv.label}</span>
                    <div className="mt-2 text-lg font-extrabold text-slate-900">{inr(by[sv.key]?.collected)}</div>
                    <div className="text-xs text-slate-500">Pending {inr(by[sv.key]?.pending)} · {num(by[sv.key]?.orders)} orders</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Recent cash orders</div>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] font-bold uppercase text-slate-500">
                    <tr><th className="px-3 py-2">Service</th><th className="px-3 py-2">Order</th><th className="px-3 py-2">Cash</th><th className="px-3 py-2">COD advance</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Delivered</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(data?.recentOrders || []).length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">No cash orders</td></tr>
                    ) : (
                      data.recentOrders.map((o, i) => (
                        <tr key={`${o.orderRef}-${i}`}>
                          <td className="px-3 py-2">{svcLabel(o.service)}</td>
                          <td className="px-3 py-2 font-semibold text-slate-800">#{o.orderRef}</td>
                          <td className="px-3 py-2 font-semibold">{inr(o.amount)}</td>
                          <td className="px-3 py-2 text-slate-600">{num(o.codAdvance) > 0 ? `${inr(o.codAdvance)} paid in advance` : "—"}</td>
                          <td className="px-3 py-2">{o.status}</td>
                          <td className="px-3 py-2">{o.deliveredAt ? new Date(o.deliveredAt).toLocaleString("en-IN") : "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Cash deposits by this rider</div>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[480px] text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] font-bold uppercase text-slate-500">
                    <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Method</th><th className="px-3 py-2">Status</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(data?.deposits || []).length === 0 ? (
                      <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">No deposits yet</td></tr>
                    ) : (
                      data.deposits.map((d) => (
                        <tr key={d._id}>
                          <td className="px-3 py-2">{d.createdAt ? new Date(d.createdAt).toLocaleString("en-IN") : "—"}</td>
                          <td className="px-3 py-2 font-semibold">{inr(d.amount)}</td>
                          <td className="px-3 py-2">{d.method}</td>
                          <td className="px-3 py-2">{d.status}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function DeliveryBoyWallet() {
  const [wallets, setWallets] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [service, setService] = useState("all")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [summary, setSummary] = useState(null)
  const [selected, setSelected] = useState(null)
  const limit = 20

  const fetchWallets = useCallback(async (overrides = {}) => {
    const p = overrides.page ?? page
    const q = overrides.search !== undefined ? overrides.search : searchQuery
    const silent = overrides.silent ?? false
    try {
      if (!silent) setLoading(true)
      const res = await adminAPI.getDeliveryWallets({ search: q.trim() || undefined, page: p, limit })
      if (res?.data?.success) {
        const data = res.data.data
        setWallets(data?.wallets || [])
        setTotal(data?.pagination?.total || 0)
        setPages(data?.pagination?.pages || 1)
        setSummary(data?.summary || null)
      } else {
        if (!silent) toast.error(res?.data?.message || "Failed to fetch rider wallets")
        setWallets([])
      }
    } catch (err) {
      if (!silent) toast.error(err?.response?.data?.message || "Failed to fetch rider wallets")
      setWallets([])
    } finally {
      if (!silent) setLoading(false)
    }
  }, [page, searchQuery])

  useEffect(() => {
    fetchWallets()
    const interval = setInterval(() => fetchWallets({ silent: true }), 15000)
    return () => clearInterval(interval)
  }, [fetchWallets])

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1)
      fetchWallets({ page: 1, search: searchQuery })
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery])

  // Cards add up the rows on this page for the chosen service (the backend summary is used when it has the field).
  const sum = (fn) => wallets.reduce((a, w) => a + fn(w), 0)
  const cards = [
    { label: "Cash in hand", value: inr(service === "all" && summary?.totalCashInHand != null ? summary.totalCashInHand : sum((w) => cashFor(w, service))), tone: "text-blue-600" },
    { label: "Pending cash (in progress)", value: inr(service === "all" && summary?.totalPendingCash != null ? summary.totalPendingCash : sum((w) => pendingFor(w, service))), tone: "text-amber-600" },
    { label: "Deposited", value: inr(summary?.totalDeposited != null ? summary.totalDeposited : sum((w) => num(w.deposited))), tone: "text-emerald-600" },
    { label: "Blocked riders", value: String(summary?.blockedCount != null ? summary.blockedCount : wallets.filter((w) => w.blocked).length), tone: "text-red-600" },
  ]

  return (
    <div className="min-h-screen bg-slate-50 p-4 lg:p-6">
      <div className="mx-auto max-w-full">
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <PiggyBank className="h-5 w-5 text-emerald-600" />
              <h1 className="text-2xl font-bold text-slate-900">Delivery Boy Wallet &amp; Cash</h1>
            </div>
            <button onClick={() => fetchWallets()} disabled={loading} className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Cash in hand = cash collected on delivered Food, Marketplace and Taxi orders minus the rider's successful deposits. For COD-with-advance orders only the remaining cash counts.
          </p>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {cards.map((c) => (
            <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{c.label}</div>
              <div className={`mt-1 text-2xl font-extrabold ${c.tone}`}>{c.value}</div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search name or phone" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-900" />
            </div>
            <select value={service} onChange={(e) => setService(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="all">Cash: all services</option>
              {SERVICES.map((s) => <option key={s.key} value={s.key}>Cash: {s.label} only</option>)}
            </select>
          </div>

          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px]">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    {["#", "Rider", `Cash in hand${service === "all" ? "" : ` (${svcLabel(service)})`}`, "Pending", "Limit", "Available", "Status", "Deposited", "Total collected by service", "Pocket balance"].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-700">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {wallets.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-6 py-20 text-center">
                        <Package className="mx-auto mb-4 h-16 w-16 text-slate-400" />
                        <p className="text-lg font-semibold text-slate-700">No riders found</p>
                      </td>
                    </tr>
                  ) : (
                    wallets.map((w, i) => (
                      <tr key={rowId(w) || i} onClick={() => setSelected(w)} className="cursor-pointer transition-colors hover:bg-slate-50">
                        <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-500">{(page - 1) * limit + i + 1}</td>
                        <td className="whitespace-nowrap px-4 py-4">
                          <div className="text-sm font-semibold text-slate-800">{w.name || "—"}</div>
                          <div className="text-xs text-slate-500">{w.phone || "—"}</div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-sm font-bold text-slate-800">{inr(cashFor(w, service))}</td>
                        <td className="whitespace-nowrap px-4 py-4 text-sm text-amber-600">{inr(pendingFor(w, service))}</td>
                        <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">{num(w.cashLimit) > 0 ? inr(w.cashLimit) : "No limit"}</td>
                        <td className="whitespace-nowrap px-4 py-4 text-sm font-semibold text-emerald-600">{w.availableCashLimit == null || num(w.cashLimit) <= 0 ? "—" : inr(w.availableCashLimit)}</td>
                        <td className="whitespace-nowrap px-4 py-4">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${w.blocked ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"}`}>{w.blocked ? "Blocked" : "OK"}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">{inr(w.deposited)}</td>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap gap-1">
                            {SERVICES.map((s) => (
                              <span key={s.key} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.tone}`}>{s.label} {inr(w.byService?.[s.key]?.collected)}</span>
                            ))}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">{inr(w.pocketBalance ?? w.totalBalance)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {pages > 1 && (
            <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4">
              <p className="text-sm text-slate-600">Page {page} of {pages} · {total} total</p>
              <div className="flex gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Previous</button>
                <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Next</button>
              </div>
            </div>
          )}
        </div>
      </div>
      {selected && <RiderCashDialog partner={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
