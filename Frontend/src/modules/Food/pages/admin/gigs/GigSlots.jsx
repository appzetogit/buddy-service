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

  // One row per hour between "from" and "to" - the usual way a slot like "Lunch" is made.
  const generateHourly = () => {
    const [fh] = gen.from.split(":").map(Number)
    const [th] = gen.to.split(":").map(Number)
    if (!(th > fh)) return toast.error("'To' must be later than 'From'")
    const rows = []
    for (let h = fh; h < th; h += 1) {
      rows.push({ start: `${String(h).padStart(2, "0")}:00`, end: `${String(h + 1).padStart(2, "0")}:00`, extraPerOrder: "", maxDrivers: 10 })
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
                    <span className="text-slate-600">₹{t.extraPerOrder}/order · {t.maxDrivers} drivers</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto bg-white sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit gig slot" : "New gig slot"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            <div>
              <label className="mb-1 block font-semibold text-slate-700">Slot name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Lunch" className="w-full rounded-lg border px-3 py-2" />
            </div>

            <div>
              <label className="mb-1 block font-semibold text-slate-700">Services this slot is for</label>
              <div className="flex flex-wrap gap-2">
                {SERVICES.map((s) => (
                  <button type="button" key={s.key} onClick={() => toggle("services", s.key)} className={`rounded-full border px-3 py-1.5 font-semibold ${form.services.includes(s.key) ? "border-slate-900 bg-slate-900 text-white" : "bg-white text-slate-600"}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block font-semibold text-slate-700">Days</label>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d, i) => (
                  <button type="button" key={d} onClick={() => toggle("days", i)} className={`rounded-full border px-3 py-1.5 font-semibold ${form.days.includes(i) ? "border-slate-900 bg-slate-900 text-white" : "bg-white text-slate-600"}`}>
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1 flex flex-wrap items-end justify-between gap-2">
                <label className="font-semibold text-slate-700">Time slots (1 hour each)</label>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-500">Quick fill</span>
                  <input type="time" value={gen.from} onChange={(e) => setGen({ ...gen, from: e.target.value })} className="rounded border px-2 py-1" />
                  <span>to</span>
                  <input type="time" value={gen.to} onChange={(e) => setGen({ ...gen, to: e.target.value })} className="rounded border px-2 py-1" />
                  <button type="button" onClick={generateHourly} className="rounded bg-slate-100 px-2 py-1 font-semibold">Make hourly</button>
                </div>
              </div>
              <div className="space-y-2">
                <div className="hidden grid-cols-[1fr_1fr_1fr_1fr_32px] gap-2 px-1 text-[11px] font-semibold uppercase text-slate-400 sm:grid">
                  <span>Start</span><span>End</span><span>Extra ₹ / order</span><span>Max drivers</span><span />
                </div>
                {form.timeSlots.map((t, i) => (
                  <div key={t._id || i} className="grid grid-cols-2 items-center gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_1fr_1fr_1fr_32px] sm:border-0 sm:p-0">
                    <input type="time" value={t.start} onChange={(e) => setRow(i, { start: e.target.value })} className="rounded-lg border px-2 py-2" />
                    <input type="time" value={t.end} onChange={(e) => setRow(i, { end: e.target.value })} className="rounded-lg border px-2 py-2" />
                    <input type="number" min="0" value={t.extraPerOrder} onChange={(e) => setRow(i, { extraPerOrder: e.target.value })} placeholder="₹ / order" className="rounded-lg border px-2 py-2" />
                    <input type="number" min="1" value={t.maxDrivers} onChange={(e) => setRow(i, { maxDrivers: e.target.value })} placeholder="Drivers" className="rounded-lg border px-2 py-2" />
                    <button type="button" onClick={() => removeRow(i)} disabled={form.timeSlots.length === 1} className="justify-self-end rounded p-1 text-rose-600 disabled:opacity-30" aria-label="Remove time slot"><X className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addRow} className="mt-2 text-sm font-semibold text-blue-600">+ Add time slot</button>
              <p className="mt-2 text-xs text-slate-500">The extra per order is paid to the rider on top of their normal earning and is deducted from the platform earning. Time slots cannot overlap another slot that shares a day and a service.</p>
            </div>

            <label className="flex items-center gap-2 font-semibold text-slate-700">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active (riders can see and book it)
            </label>
          </div>

          <DialogFooter>
            <button onClick={() => setOpen(false)} className="rounded-lg border px-4 py-2 text-sm font-semibold">Cancel</button>
            <button onClick={save} disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? "Saving..." : "Save slot"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
