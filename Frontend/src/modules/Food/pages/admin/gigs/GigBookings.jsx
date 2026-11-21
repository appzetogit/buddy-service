import { useEffect, useState } from "react"
import { adminAPI } from "@food/api"
import { toast } from "sonner"

const SERVICE_LABEL = { food: "Food", quickCommerce: "Marketplace", taxi: "Taxi" }
const fmt12 = (m) => {
  const h = Math.floor(m / 60) % 24
  const mm = String(m % 60).padStart(2, "0")
  return `${h % 12 || 12}${mm === "00" ? "" : `:${mm}`} ${h < 12 ? "AM" : "PM"}`
}
const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
const errorOf = (e, fallback) => e?.response?.data?.message || e?.message || fallback

export default function GigBookings() {
  const [filters, setFilters] = useState({ date: "", service: "", status: "booked" })
  const [data, setData] = useState({ bookings: [], total: 0 })
  const [earn, setEarn] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    try {
      setLoading(true)
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v))
      const [b, e] = await Promise.all([adminAPI.getGigBookings({ ...params, limit: 100 }), adminAPI.getGigEarnings(filters.date ? { from: filters.date, to: filters.date } : {})])
      setData(b?.data?.data || { bookings: [], total: 0 })
      setEarn(e?.data?.data || null)
    } catch (err) {
      toast.error(errorOf(err, "Failed to load gig bookings"))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  const initials = (n) => (n || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
  const stat = (label, value, tone = "text-slate-900", sub) => (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-extrabold ${tone}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  )
  const field = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900"

  return (
    <div className="space-y-5 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Gig Bookings & Payouts</h1>
        <p className="text-sm text-slate-500">Which rider booked which gig, and the extra earning paid on gig orders (deducted from platform earning).</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stat(`Gig extra paid${filters.date ? " (that day)" : ""}`, inr(earn?.totalPaid), "text-rose-600", "deducted from admin earning")}
        {stat("Gig orders", earn?.totalOrders ?? 0)}
        {(earn?.byService || []).map((s) => stat(SERVICE_LABEL[s.service] || s.service, inr(s.amount), "text-slate-900", `${s.orders} orders`))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <input type="date" value={filters.date} onChange={(e) => setFilters({ ...filters, date: e.target.value })} className={field} />
        <select value={filters.service} onChange={(e) => setFilters({ ...filters, service: e.target.value })} className={field}>
          <option value="">All services</option>
          {Object.entries(SERVICE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className={field}>
          <option value="">All status</option>
          <option value="booked">Booked</option>
          <option value="cancelled">Cancelled</option>
        </select>
        {filters.date && <button onClick={() => setFilters({ ...filters, date: "" })} className="text-sm font-semibold text-blue-600">Clear date</button>}
        <span className="ml-auto text-xs font-semibold text-slate-400">{data.total} bookings</span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">Date</th><th className="px-4 py-3">Rider</th><th className="px-4 py-3">Slot & time</th>
              <th className="px-4 py-3">Services</th><th className="px-4 py-3 text-right">Extra/order</th><th className="px-4 py-3 text-right">Orders</th><th className="px-4 py-3 text-right">Extra earned</th><th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-14 text-center text-slate-500">Loading...</td></tr>
            ) : data.bookings.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-14 text-center"><div className="text-base font-bold text-slate-700">No bookings yet</div><div className="text-xs text-slate-400">Bookings appear here as riders book gigs.</div></td></tr>
            ) : (
              data.bookings.map((b) => (
                <tr key={b._id} className="hover:bg-slate-50/60">
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-800">{b.date}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">{initials(b.partnerName)}</span>
                      <div><div className="font-semibold text-slate-800">{b.partnerName || "—"}</div><div className="text-xs text-slate-400">{b.partnerPhone}</div></div>
                    </div>
                  </td>
                  <td className="px-4 py-3"><div className="font-semibold text-slate-800">{b.slotName}</div><div className="whitespace-nowrap text-xs text-slate-500">{fmt12(b.startMin)} - {fmt12(b.endMin)}</div></td>
                  <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{(b.services || []).map((s) => <span key={s} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{SERVICE_LABEL[s] || s}</span>)}</div></td>
                  <td className="px-4 py-3 text-right">{inr(b.extraPerOrder)}</td>
                  <td className="px-4 py-3 text-right">{b.ordersCount}</td>
                  <td className="px-4 py-3 text-right font-bold text-slate-900">{inr(b.extraEarned)}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${b.status === "booked" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{b.status === "booked" ? "Booked" : "Cancelled"}</span></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
