import { useEffect, useState } from "react"
import { ShieldAlert, Save } from "lucide-react"
import { adminAPI } from "@food/api"
import { toast } from "sonner"

const errorOf = (e, fallback) => e?.response?.data?.message || e?.message || fallback

export default function RiderCashLimit() {
  const [form, setForm] = useState({ deliveryCashLimit: "0", deliveryWithdrawalLimit: "0" })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await adminAPI.getCashLimitSettings()
        const s = res?.data?.data?.settings || res?.data?.data || {}
        setForm({ deliveryCashLimit: String(s.deliveryCashLimit ?? 0), deliveryWithdrawalLimit: String(s.deliveryWithdrawalLimit ?? 0) })
      } catch (e) {
        toast.error(errorOf(e, "Failed to load the cash limit"))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const save = async () => {
    const limit = Number(form.deliveryCashLimit)
    const withdrawal = Number(form.deliveryWithdrawalLimit)
    if (!Number.isFinite(limit) || limit < 0 || !Number.isFinite(withdrawal) || withdrawal < 0) {
      toast.error("Enter 0 or a positive amount")
      return
    }
    try {
      setSaving(true)
      await adminAPI.updateCashLimitSettings({ deliveryCashLimit: limit, deliveryWithdrawalLimit: withdrawal })
      toast.success("Cash limit saved")
    } catch (e) {
      toast.error(errorOf(e, "Could not save the cash limit"))
    } finally {
      setSaving(false)
    }
  }

  const noLimit = Number(form.deliveryCashLimit) === 0
  return (
    <div className="space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><ShieldAlert className="h-5 w-5" /> Rider Cash Limit</h1>
          <p className="text-sm text-slate-500">How much cash a rider may hold before they must deposit it. One limit for Food, Marketplace and Taxi.</p>
        </div>
        <button onClick={save} disabled={saving || loading} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          <Save className="h-4 w-4" /> {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-slate-500">Loading...</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">Cash in hand limit (₹)</label>
            <input type="number" min="0" value={form.deliveryCashLimit} onChange={(e) => setForm({ ...form, deliveryCashLimit: e.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-lg font-bold outline-none focus:border-slate-900" />
            <p className={`mt-2 text-xs font-semibold ${noLimit ? "text-amber-600" : "text-emerald-700"}`}>{noLimit ? "0 = no limit. Riders can hold any amount of cash." : `Riders are blocked at ₹${Number(form.deliveryCashLimit).toLocaleString("en-IN")} of cash in hand.`}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">Minimum withdrawal (₹)</label>
            <input type="number" min="0" value={form.deliveryWithdrawalLimit} onChange={(e) => setForm({ ...form, deliveryWithdrawalLimit: e.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-lg font-bold outline-none focus:border-slate-900" />
            <p className="mt-2 text-xs text-slate-500">Smallest amount a rider can withdraw from their pocket.</p>
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
        <b>How it works.</b> 0 means no limit. When a rider's cash in hand reaches the limit they get <b>no new orders</b> (Food, Marketplace, Taxi) until they deposit the cash online. A cash / COD order is offered only if the rider has room for its cash amount. For COD-with-advance orders only the remaining cash counts. Cash in hand and deposits are visible under Delivery boy Wallet and Cash Deposits.
      </div>
    </div>
  )
}
