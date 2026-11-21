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

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Gig Bookings & Payouts</h1>
        <p className="text-sm text-slate-500">Which rider booked which gig, and the extra earning paid on gig orders (deducted from platform earning).</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border bg-white p-4"><div className="text-xs text-slate-500">Gig extra paid{filters.date ? " (that day)" : ""}</div><div className="text-xl font-bold text-rose-600">{inr(earn?.totalPaid)}</div></div>
        <div className="rounded-xl border bg-white p-4"><div className="text-xs text-slate-500">Gig orders</div><div className="text-xl font-bold">{earn?.totalOrders ?? 0}</div></div>
        {(earn?.byService || []).map((s) => (
          <div key={s.service} className="rounded-xl border bg-white p-4"><div className="text-xs text-slate-500">{SERVICE_LABEL[s.service] || s.service}</div><div className="text-xl font-bold">{inr(s.amount)}</div><div className="text-[11px] text-slate-400">{s.orders} orders</div></div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input type="date" value={filters.date} onChange={(e) => setFilters({ ...filters, date: e.target.value })} className="rounded-lg border px-3 py-2" />
        <select value={filters.service} onChange={(e) => setFilters({ ...filters, service: e.target.value })} className="rounded-lg border px-3 py-2">
          <option value="">All services</option>
          {Object.entries(SERVICE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="rounded-lg border px-3 py-2">
          <option value="">All</option>
          <option value="booked">Booked</option>
          <option value="cancelled">Cancelled</option>
        </select>
        {filters.date && <button onClick={() => setFilters({ ...filters, date: "" })} className="text-blue-600">Clear date</button>}
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Date</th><th className="px-3 py-2">Rider</th><th className="px-3 py-2">Slot</th><th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Services</th><th className="px-3 py-2">Extra/order</th><th className="px-3 py-2">Orders</th><th className="px-3 py-2">Extra earned</th><th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={9} className="px-3 py-10 text-center text-slate-500">Loading...</td></tr>
            ) : data.bookings.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-10 text-center text-slate-500">No bookings</td></tr>
            ) : (
              data.bookings.map((b) => (
                <tr key={b._id}>
                  <td className="px-3 py-2 font-medium">{b.date}</td>
                  <td className="px-3 py-2">{b.partnerName || "—"}<div className="text-xs text-slate-400">{b.partnerPhone}</div></td>
                  <td className="px-3 py-2">{b.slotName}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmt12(b.startMin)} - {fmt12(b.endMin)}</td>
                  <td className="px-3 py-2">{(b.services || []).map((s) => SERVICE_LABEL[s] || s).join(", ")}</td>
                  <td className="px-3 py-2">{inr(b.extraPerOrder)}</td>
                  <td className="px-3 py-2">{b.ordersCount}</td>
                  <td className="px-3 py-2 font-semibold">{inr(b.extraEarned)}</td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${b.status === "booked" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{b.status}</span></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-slate-400">{data.total} bookings</div>
    </div>
  )
}
