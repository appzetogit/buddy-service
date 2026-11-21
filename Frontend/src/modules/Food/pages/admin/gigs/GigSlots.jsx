import { useEffect, useState } from "react"
import { Plus, Edit, Trash2, X, Zap } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@food/components/ui/dialog"
import { adminAPI } from "@food/api"
import { toast } from "sonner"

const SERVICES = [
  { key: "food", label: "Food" },
  { key: "quickCommerce", label: "Marketplace" },
  { key: "taxi", label: "Taxi" },
]
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const toHHMM = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
const fmt12 = (m) => {
  const h = Math.floor(m / 60) % 24
  const mm = String(m % 60).padStart(2, "0")
  return `${h % 12 || 12}${mm === "00" ? "" : `:${mm}`} ${h < 12 ? "AM" : "PM"}`
}
const errorOf = (e, fallback) => e?.response?.data?.message || e?.message || fallback

const emptyForm = () => ({
  id: null,
  name: "",
  services: ["food", "quickCommerce", "taxi"],
  days: [1, 2, 3, 4, 5, 6, 0],
  isActive: true,
  timeSlots: [{ start: "10:00", end: "11:00", extraPerOrder: "", maxDrivers: 10 }],
})

export default function GigSlots() {
  const [slots, setSlots] = useState([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [gen, setGen] = useState({ from: "09:00", to: "12:00" })

  const load = async () => {
    try {
      setLoading(true)
      const res = await adminAPI.getGigSlots()
      setSlots(res?.data?.data?.slots || [])
    } catch (e) {
      toast.error(errorOf(e, "Failed to load gig slots"))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
  }, [])

  const openNew = () => {
    setForm(emptyForm())
    setOpen(true)
  }
  const openEdit = (slot) => {
    setForm({
      id: slot._id,
      name: slot.name,
      services: slot.services,
      days: slot.days,
      isActive: slot.isActive !== false,
      timeSlots: slot.timeSlots.map((t) => ({ _id: t._id, start: toHHMM(t.startMin), end: toHHMM(t.endMin), extraPerOrder: t.extraPerOrder, maxDrivers: t.maxDrivers })),
    })
    setOpen(true)
  }

  const toggle = (field, value) =>
    setForm((f) => ({ ...f, [field]: f[field].includes(value) ? f[field].filter((v) => v !== value) : [...f[field], value] }))
  const setRow = (i, patch) => setForm((f) => ({ ...f, timeSlots: f.timeSlots.map((t, idx) => (idx === i ? { ...t, ...patch } : t)) }))
  const removeRow = (i) => setForm((f) => ({ ...f, timeSlots: f.timeSlots.filter((_, idx) => idx !== i) }))
  const addRow = () =>
    setForm((f) => {
      const last = f.timeSlots[f.timeSlots.length - 1]
      const start = last?.end || "10:00"
      const [h, m] = start.split(":").map(Number)
      const end = `${String(Math.min(23, h + 1)).padStart(2, "0")}:${String(m).padStart(2, "0")}`
      return { ...f, timeSlots: [...f.timeSlots, { start, end, extraPerOrder: last?.extraPerOrder ?? "", maxDrivers: last?.maxDrivers ?? 10 }] }
    })

  // One row per full hour between "from" and "to" (minutes kept: 10:30 to 12:30 -> 10:30-11:30, 11:30-12:30).
  const generateHourly = () => {
    const toMin = (v) => {
      const [h, m] = String(v).split(":").map(Number)
      return h * 60 + (m || 0)
    }
    const from = toMin(gen.from)
    const to = toMin(gen.to)
    if (!(to - from >= 60)) return toast.error("'To' must be at least one hour after 'From'")
    const rows = []
    for (let m = from; m + 60 <= to; m += 60) {
      rows.push({ start: toHHMM(m), end: toHHMM(m + 60), extraPerOrder: "", maxDrivers: 10 })
    }
    setForm((f) => ({ ...f, timeSlots: rows }))
  }

  const save = async () => {
    const payload = {
      name: form.name,
      services: form.services,
      days: form.days,
      isActive: form.isActive,
      timeSlots: form.timeSlots.map((t) => ({ ...(t._id ? { _id: t._id } : {}), start: t.start, end: t.end, extraPerOrder: Number(t.extraPerOrder), maxDrivers: Number(t.maxDrivers) })),
    }
    try {
      setSaving(true)
      if (form.id) await adminAPI.updateGigSlot(form.id, payload)
      else await adminAPI.createGigSlot(payload)
      toast.success(form.id ? "Gig slot updated" : "Gig slot created")
      setOpen(false)
      load()
    } catch (e) {
      toast.error(errorOf(e, "Could not save the gig slot"))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (slot) => {
    if (!window.confirm(`Remove gig slot "${slot.name}"?`)) return
    try {
      const res = await adminAPI.deleteGigSlot(slot._id)
      toast.success(res?.data?.data?.deactivated ? "Slot has bookings, so it was deactivated instead" : "Gig slot removed")
      load()
    } catch (e) {
      toast.error(errorOf(e, "Could not remove the slot"))
    }
  }

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Gig Slots</h1>
          <p className="text-sm text-slate-500">Working slots riders book a day ahead. A booked rider gets orders only in the booked hours and earns the extra set per hour.</p>
        </div>
        <button onClick={openNew} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
          <Plus className="h-4 w-4" /> New slot
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-slate-500">Loading...</div>
      ) : slots.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-slate-500">No gig slots yet. Create one, for example "Lunch" with hourly time slots.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {slots.map((slot) => (
            <div key={slot._id} className={`rounded-xl border bg-white p-4 shadow-sm ${slot.isActive ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 text-base font-bold text-slate-900">
                    <Zap className="h-4 w-4 text-amber-500" /> {slot.name}
                    {!slot.isActive && <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Inactive</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {slot.services.map((s) => (
                      <span key={s} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{SERVICES.find((x) => x.key === s)?.label || s}</span>
                    ))}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{[...slot.days].sort((a, b) => a - b).map((d) => DAYS[d]).join(", ")}</div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(slot)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Edit"><Edit className="h-4 w-4" /></button>
                  <button onClick={() => remove(slot)} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
              <div className="mt-3 divide-y rounded-lg border text-sm">
                {[...slot.timeSlots].sort((a, b) => a.startMin - b.startMin).map((t) => (
                  <div key={t._id} className="flex items-center justify-between px-3 py-2">
                    <span className="font-semibold text-slate-800">{fmt12(t.startMin)} - {fmt12(t.endMin)}</span>
                    <span className="text-slate-600">₹{t.extraPerOrder}/order · {t.maxDrivers} driver{t.maxDrivers > 1 ? "s" : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="lg:max-w-3xl">
          <DialogHeader className="border-b px-6 pb-4 pt-4 text-left">
            <DialogTitle className="text-lg font-bold text-slate-900">{form.id ? "Edit gig slot" : "New gig slot"}</DialogTitle>
            <p className="text-xs text-slate-500">Riders book these hours a day ahead and earn the extra on every order in the hour.</p>
          </DialogHeader>

          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5 text-sm">
            <section>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Slot name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Lunch" className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-slate-900" />
            </section>

            <div className="grid gap-6 sm:grid-cols-2">
              <section>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Services</label>
                <div className="flex flex-wrap gap-2">
                  {SERVICES.map((s) => (
                    <button type="button" key={s.key} onClick={() => toggle("services", s.key)} className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${form.services.includes(s.key) ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Days</label>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map((d, i) => (
                    <button type="button" key={d} onClick={() => toggle("days", i)} className={`h-9 w-11 rounded-lg border text-xs font-bold transition ${form.days.includes(i) ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"}`}>
                      {d}
                    </button>
                  ))}
                </div>
              </section>
            </div>

            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Time slots · {form.timeSlots.length} hour{form.timeSlots.length > 1 ? "s" : ""}</label>
                <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs">
                  <span className="font-semibold text-slate-500">Quick fill</span>
                  <input type="time" value={gen.from} onChange={(e) => setGen({ ...gen, from: e.target.value })} className="rounded-lg border border-slate-200 bg-white px-2 py-1" />
                  <span className="text-slate-400">to</span>
                  <input type="time" value={gen.to} onChange={(e) => setGen({ ...gen, to: e.target.value })} className="rounded-lg border border-slate-200 bg-white px-2 py-1" />
                  <button type="button" onClick={generateHourly} className="rounded-lg bg-slate-900 px-3 py-1 font-semibold text-white">Make hourly</button>
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200">
                <div className="hidden grid-cols-[1.2fr_1.2fr_1fr_1fr_40px] gap-3 bg-slate-50 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-400 sm:grid">
                  <span>Start</span><span>End</span><span>Extra ₹ / order</span><span>Max drivers</span><span />
                </div>
                <div className="divide-y divide-slate-100">
                  {form.timeSlots.map((t, i) => (
                    <div key={t._id || i} className="grid grid-cols-2 items-center gap-2 px-3 py-2.5 sm:grid-cols-[1.2fr_1.2fr_1fr_1fr_40px] sm:gap-3">
                      <input type="time" value={t.start} onChange={(e) => setRow(i, { start: e.target.value })} className="min-w-0 rounded-lg border border-slate-200 px-2.5 py-2" />
                      <input type="time" value={t.end} onChange={(e) => setRow(i, { end: e.target.value })} className="min-w-0 rounded-lg border border-slate-200 px-2.5 py-2" />
                      <div className="relative min-w-0">
                        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">₹</span>
                        <input type="number" min="0" value={t.extraPerOrder} onChange={(e) => setRow(i, { extraPerOrder: e.target.value })} placeholder="0" className="w-full min-w-0 rounded-lg border border-slate-200 py-2 pl-6 pr-2" />
                      </div>
                      <input type="number" min="1" value={t.maxDrivers} onChange={(e) => setRow(i, { maxDrivers: e.target.value })} placeholder="Drivers" className="min-w-0 rounded-lg border border-slate-200 px-2.5 py-2" />
                      <button type="button" onClick={() => removeRow(i)} disabled={form.timeSlots.length === 1} className="col-span-2 justify-self-end rounded-lg p-2 text-rose-500 hover:bg-rose-50 disabled:opacity-30 sm:col-span-1" aria-label="Remove time slot"><X className="h-4 w-4" /></button>
                    </div>
                  ))}
                </div>
              </div>
              <button type="button" onClick={addRow} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-blue-600"><Plus className="h-4 w-4" /> Add time slot</button>
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">The extra per order is paid to the rider on top of their normal earning and is deducted from the platform earning. Time slots cannot overlap another slot that shares a day and a service.</p>
            </section>

            <label className="flex items-center gap-2 font-semibold text-slate-700">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="h-4 w-4" /> Active (riders can see and book it)
            </label>
          </div>

          <DialogFooter className="flex-row justify-end gap-2 border-t bg-white px-6 py-3">
            <button onClick={() => setOpen(false)} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700">Cancel</button>
            <button onClick={save} disabled={saving} className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? "Saving..." : "Save slot"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
