import { useEffect, useState } from "react"
import { Banknote, Save } from "lucide-react"
import { adminAPI } from "@food/api"
import { toast } from "sonner"

const SERVICES = [
  { key: "food", label: "Food", tone: "bg-orange-50 text-orange-700" },
  { key: "quickCommerce", label: "Marketplace", tone: "bg-blue-50 text-blue-700" },
  { key: "taxi", label: "Taxi", tone: "bg-violet-50 text-violet-700" },
]
const errorOf = (e, fallback) => e?.response?.data?.message || e?.message || fallback
const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`

export default function CodSettings() {
  const [form, setForm] = useState({ food: { enabled: false, advancePercent: 20 }, quickCommerce: { enabled: false, advancePercent: 20 }, taxi: { enabled: false, advancePercent: 20 } })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await adminAPI.getCodSettings()
        const s = res?.data?.data?.settings
        if (s) setForm(s)
      } catch (e) {
        toast.error(errorOf(e, "Failed to load COD settings"))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const set = (key, patch) => setForm((f) => ({ ...f, [key]: { ...f[key], ...patch } }))

  const save = async () => {
    try {
      setSaving(true)
      const payload = Object.fromEntries(SERVICES.map((s) => [s.key, { enabled: form[s.key].enabled, advancePercent: Number(form[s.key].advancePercent) }]))
      const res = await adminAPI.updateCodSettings(payload)
      if (res?.data?.data?.settings) setForm(res.data.data.settings)
      toast.success("COD settings saved")
    } catch (e) {
      toast.error(errorOf(e, "Could not save COD settings"))
    } finally {
      setSaving(false)
    }
  }

  const example = (pct) => {
    const bill = 500
    const adv = Math.min(bill, Math.max(pct > 0 ? 1 : 0, Math.round(bill * pct) / 100))
    return { adv, rem: Math.round((bill - adv) * 100) / 100 }
  }

  return (
    <div className="space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><Banknote className="h-5 w-5" /> Cash on Delivery (COD)</h1>
          <p className="text-sm text-slate-500">Switch COD on per service and set how much of the bill the customer pays now (advance). The rest is paid in cash after delivery. If the order is cancelled, the advance goes back to the customer's wallet.</p>
        </div>
        <button onClick={save} disabled={saving || loading} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          <Save className="h-4 w-4" /> {saving ? "Saving..." : "Save settings"}
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-slate-500">Loading...</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {SERVICES.map((s) => {
            const v = form[s.key]
            const ex = example(Number(v.advancePercent) || 0)
            return (
              <div key={s.key} className={`rounded-2xl border bg-white p-5 shadow-sm ${v.enabled ? "border-emerald-300" : "border-slate-200"}`}>
                <div className="flex items-center justify-between">
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${s.tone}`}>{s.label}</span>
                  <button
                    type="button"
                    onClick={() => set(s.key, { enabled: !v.enabled })}
                    className={`relative h-6 w-11 rounded-full transition ${v.enabled ? "bg-emerald-500" : "bg-slate-300"}`}
                    aria-label={`Toggle COD for ${s.label}`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${v.enabled ? "left-[22px]" : "left-0.5"}`} />
                  </button>
                </div>
                <div className="mt-3 text-sm font-semibold text-slate-800">{v.enabled ? "COD is ON" : "COD is OFF"}</div>
                <div className="text-xs text-slate-500">{v.enabled ? "Customers see Cash on Delivery at checkout." : "Customers do not see the COD option."}</div>

                <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-500">Advance to pay now (%)</label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="number" min="0" max="100" step="1"
                    value={v.advancePercent}
                    onChange={(e) => set(s.key, { advancePercent: e.target.value })}
                    disabled={!v.enabled}
                    className="w-28 rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"
                  />
                  <span className="text-sm text-slate-500">% of the bill</span>
                </div>
                <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                  On a {inr(500)} bill: pay <b className="text-slate-900">{inr(ex.adv)}</b> now, <b className="text-slate-900">{inr(ex.rem)}</b> in cash on delivery.
                </div>
              </div>
            )
          })}
        </div>
      )}
      <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-800">The advance is paid from the wallet and/or online (same as any prepaid order). Admin can still switch COD off for individual customers from the Customers page.</p>
    </div>
  )
}
