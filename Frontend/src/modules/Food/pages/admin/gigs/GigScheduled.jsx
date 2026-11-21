import { useEffect, useMemo, useState, useCallback } from "react"
import { CalendarClock, Search, Zap, MapPin, User } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@food/components/ui/dialog"
import { adminAPI } from "@food/api"
import { toast } from "sonner"

const SERVICE_LABEL = { food: "Food", quickCommerce: "Marketplace", taxi: "Taxi" }
const SERVICE_TONE = { food: "bg-orange-50 text-orange-700", quickCommerce: "bg-blue-50 text-blue-700", taxi: "bg-violet-50 text-violet-700" }
const errorOf = (e, fallback) => e?.response?.data?.message || e?.message || fallback
const when = (d) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })

export default function GigScheduled() {
  const [data, setData] = useState({ items: [], needsAttention: 0 })
  const [loading, setLoading] = useState(true)
  const [service, setService] = useState("")
  const [onlyAttention, setOnlyAttention] = useState(true)
  const [target, setTarget] = useState(null)
  const [drivers, setDrivers] = useState({ drivers: [], zoneFiltered: false })
  const [loadingDrivers, setLoadingDrivers] = useState(false)
  const [search, setSearch] = useState("")
  const [picked, setPicked] = useState("")
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const res = await adminAPI.getGigScheduled(service ? { service } : {})
      setData(res?.data?.data || { items: [], needsAttention: 0 })
    } catch (e) {
      toast.error(errorOf(e, "Failed to load scheduled orders"))
    } finally {
      setLoading(false)
    }
  }, [service])
  useEffect(() => {
    load()
  }, [load])

  const items = useMemo(() => (onlyAttention ? data.items.filter((i) => i.needsAttention) : data.items), [data, onlyAttention])

  const openAssign = async (item) => {
    setTarget(item)
    setPicked("")
    setSearch("")
    setDrivers({ drivers: [], zoneFiltered: false })
    try {
      setLoadingDrivers(true)
      const res = await adminAPI.getGigAssignableDrivers({ service: item.service, id: item.id })
      setDrivers(res?.data?.data || { drivers: [], zoneFiltered: false })
    } catch (e) {
      toast.error(errorOf(e, "Could not load drivers"))
    } finally {
      setLoadingDrivers(false)
    }
  }

  const visibleDrivers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return drivers.drivers.filter((d) => !q || d.name.toLowerCase().includes(q) || d.phone.includes(q))
  }, [drivers, search])

  const assign = async () => {
    try {
      setSaving(true)
      const res = await adminAPI.assignGigScheduled({ service: target.service, id: target.id, driverId: picked })
      toast.success(res?.data?.data?.message || "Driver assigned")
      setTarget(null)
      load()
    } catch (e) {
      toast.error(errorOf(e, "Could not assign the driver"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Scheduled — Driver Assignment</h1>
        <p className="text-sm text-slate-500">Scheduled orders and rides go only to riders who booked the gig covering their time. When nobody did, they wait here for you to pick a driver.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Need a driver</div><div className="mt-1 text-2xl font-extrabold text-rose-600">{data.needsAttention}</div></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Scheduled, unassigned</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{data.items.length}</div></div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <select value={service} onChange={(e) => setService(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
          <option value="">All services</option>
          {Object.entries(SERVICE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="flex items-center gap-2 px-2 text-sm font-semibold text-slate-700">
          <input type="checkbox" checked={onlyAttention} onChange={(e) => setOnlyAttention(e.target.checked)} className="h-4 w-4" /> Only those with no gig rider
        </label>
        <span className="ml-auto text-xs font-semibold text-slate-400">{items.length} shown</span>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-slate-500">Loading...</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-12 text-center">
          <CalendarClock className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          <div className="text-base font-bold text-slate-700">Nothing waiting for a driver</div>
          <div className="text-xs text-slate-400">Scheduled jobs covered by a gig slot are handed to the booked riders automatically.</div>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map((i) => (
            <div key={`${i.service}-${i.id}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${SERVICE_TONE[i.service]}`}>{SERVICE_LABEL[i.service]}</span>
                    <span className="text-sm font-extrabold text-slate-900">#{i.ref}</span>
                    {i.zone && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{i.zone}</span>}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-sm font-bold text-slate-800"><CalendarClock className="h-4 w-4 text-slate-400" /> {when(i.scheduledAt)}</div>
                </div>
                {i.gigRiders === 0 ? (
                  <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-600">No gig rider booked</span>
                ) : (
                  <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700"><Zap className="h-3 w-3" /> {i.gigRiders} gig rider{i.gigRiders > 1 ? "s" : ""}</span>
                )}
              </div>

              <div className="mt-3 space-y-1 text-xs text-slate-600">
                {i.from && <div className="flex gap-1.5"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /><span>{i.from}</span></div>}
                {i.to && <div className="flex gap-1.5"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" /><span>{i.to}</span></div>}
                {i.customer && <div className="flex gap-1.5"><User className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /><span>{i.customer} {i.customerPhone}</span></div>}
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="text-xs">
                  {i.preassigned ? <span className="font-semibold text-emerald-700">Driver picked: {i.preassigned}</span> : i.parked ? <span className="font-semibold text-rose-600">Waiting for admin assignment</span> : i.status === "scheduled" ? <span className="text-slate-400">Not live yet</span> : null}
                </div>
                <button onClick={() => openAssign(i)} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">{i.preassigned ? "Change driver" : "Assign driver"}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={Boolean(target)} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="lg:max-w-xl">
          <DialogHeader className="border-b px-6 pb-4 pt-4 text-left">
            <DialogTitle className="text-lg font-bold text-slate-900">Assign a driver</DialogTitle>
            {target && <p className="text-xs text-slate-500">{SERVICE_LABEL[target.service]} #{target.ref} · {when(target.scheduledAt)}{drivers.zoneFiltered ? " · drivers of this order's zone" : ""}</p>}
          </DialogHeader>
          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or phone" className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-slate-900" />
            </div>
            {loadingDrivers ? (
              <div className="py-8 text-center text-sm text-slate-500">Loading drivers...</div>
            ) : visibleDrivers.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">No drivers found</div>
            ) : (
              <div className="max-h-[50vh] divide-y overflow-y-auto rounded-xl border border-slate-200">
                {visibleDrivers.map((d) => (
                  <button key={d._id} onClick={() => setPicked(d._id)} className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left ${picked === d._id ? "bg-slate-900 text-white" : "hover:bg-slate-50"}`}>
                    <div>
                      <div className="flex items-center gap-2 text-sm font-bold">
                        <span className={`h-2 w-2 rounded-full ${d.online ? "bg-emerald-500" : "bg-slate-300"}`} />{d.name}
                      </div>
                      <div className={`text-xs ${picked === d._id ? "text-slate-300" : "text-slate-500"}`}>{d.phone}{d.vehicle ? ` · ${d.vehicle}` : ""}{d.zone ? ` · ${d.zone}` : ""}</div>
                    </div>
                    {d.gigBooked && <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700"><Zap className="h-3 w-3" /> Gig booked</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <DialogFooter className="flex-row justify-end gap-2 border-t bg-white px-6 py-3">
            <button onClick={() => setTarget(null)} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700">Cancel</button>
            <button onClick={assign} disabled={!picked || saving} className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving ? "Assigning..." : "Assign"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
