export const MULTI_ORDER_DISTANCE_MIN_KM = 2
export const MULTI_ORDER_DISTANCE_MAX_KM = 5

/** Mirrors clampMaxConcurrentOrders in Backend rider-capacity.service.js. */
export const MAX_CONCURRENT_ORDERS_MIN = 1
export const MAX_CONCURRENT_ORDERS_MAX = 5
export const MAX_CONCURRENT_ORDERS_DEFAULT = 2

export function clampMultiOrderDistanceKm(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return MULTI_ORDER_DISTANCE_MAX_KM
  return Math.min(
    MULTI_ORDER_DISTANCE_MAX_KM,
    Math.max(MULTI_ORDER_DISTANCE_MIN_KM, n),
  )
}

export function clampMaxConcurrentOrders(value) {
  if (value === null || value === undefined || value === "") {
    return MAX_CONCURRENT_ORDERS_DEFAULT
  }
  const n = Number(value)
  if (!Number.isFinite(n)) return MAX_CONCURRENT_ORDERS_DEFAULT
  return Math.min(
    MAX_CONCURRENT_ORDERS_MAX,
    Math.max(MAX_CONCURRENT_ORDERS_MIN, Math.trunc(n)),
  )
}

export default function PartnerSettingsSection({
  settings,
  onChange,
  onPersistPatch,
  persisting = false,
}) {
  const update = (patch) => onChange({ ...settings, ...patch })

  const toggleAndPersist = async (field) => {
    const nextValue = !settings[field]
    update({ [field]: nextValue })
    if (typeof onPersistPatch === "function") {
      await onPersistPatch({ [field]: nextValue })
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900 mb-2">Multi-Restaurant Settings</h2>
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm text-slate-600">Enable Multi-Restaurant Orders</span>
          <button
            type="button"
            disabled={persisting}
            onClick={() => toggleAndPersist("multiOrderEnabled")}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60 ${
              settings.multiOrderEnabled ? "bg-green-600" : "bg-slate-300"
            }`}
            aria-pressed={Boolean(settings.multiOrderEnabled)}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                settings.multiOrderEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Max Road Distance (KM)
            </label>
            <input
              type="number"
              min={MULTI_ORDER_DISTANCE_MIN_KM}
              max={MULTI_ORDER_DISTANCE_MAX_KM}
              step="0.5"
              value={settings.multiOrderMaxDistance}
              onChange={(e) => update({ multiOrderMaxDistance: e.target.value })}
              onBlur={(e) => {
                const clamped = clampMultiOrderDistanceKm(e.target.value)
                update({ multiOrderMaxDistance: clamped })
              }}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none focus:ring-1 focus:ring-green-500"
              placeholder="5"
            />
            <p className="text-xs text-slate-500 mt-1">
              Allowed range: {MULTI_ORDER_DISTANCE_MIN_KM}–{MULTI_ORDER_DISTANCE_MAX_KM} km from
              the first restaurant in the cart
            </p>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Extra Charge (₹)</label>
            <input
              type="number"
              value={settings.multiOrderAdditionalCharge}
              onChange={(e) => update({ multiOrderAdditionalCharge: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 outline-none focus:ring-1 focus:ring-green-500"
              placeholder="0"
            />
            <p className="text-xs text-slate-500 mt-1">Added to delivery fee for multi-restaurant orders</p>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900 mb-2">Split Large Orders</h2>
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm text-slate-600">Enable split delivery for large carts</span>
          <button
            type="button"
            disabled={persisting}
            onClick={() => toggleAndPersist("splitOrderEnabled")}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60 ${
              settings.splitOrderEnabled !== false ? "bg-green-600" : "bg-slate-300"
            }`}
            aria-pressed={settings.splitOrderEnabled !== false}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                settings.splitOrderEnabled !== false ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Item Count Threshold</label>
          <input
            type="number"
            min="1"
            value={settings.splitOrderThreshold}
            onChange={(e) => update({ splitOrderThreshold: e.target.value })}
            className="w-full max-w-[200px] px-3 py-2 rounded-lg border border-slate-200 outline-none focus:ring-1 focus:ring-green-500"
            placeholder="20"
          />
          <p className="text-xs text-slate-500 mt-1">At or above this item count, base delivery fee is doubled</p>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900 mb-2">Rider Order Stacking</h2>
        <p className="text-sm text-slate-600 mb-4">
          How many orders one delivery partner may carry at the same time. At 2, a rider can
          accept a second order while the first is still running, deliver both, and only then
          becomes eligible for a third.
        </p>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
            Max Orders Per Rider
          </label>
          <input
            type="number"
            min={MAX_CONCURRENT_ORDERS_MIN}
            max={MAX_CONCURRENT_ORDERS_MAX}
            step="1"
            value={settings.maxConcurrentOrders ?? MAX_CONCURRENT_ORDERS_DEFAULT}
            onChange={(e) => update({ maxConcurrentOrders: e.target.value })}
            onBlur={(e) => update({ maxConcurrentOrders: clampMaxConcurrentOrders(e.target.value) })}
            className="w-full max-w-[200px] px-3 py-2 rounded-lg border border-slate-200 outline-none focus:ring-1 focus:ring-green-500"
            placeholder={String(MAX_CONCURRENT_ORDERS_DEFAULT)}
          />
          <p className="text-xs text-slate-500 mt-1">
            Allowed range: {MAX_CONCURRENT_ORDERS_MIN}–{MAX_CONCURRENT_ORDERS_MAX}. Counts Food
            and Quick Commerce jobs together. Set to 1 to go back to one trip at a time.
          </p>
        </div>
      </div>
    </div>
  )
}
