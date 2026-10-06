import { useState, useEffect, useMemo } from "react"
import { useSearchParams } from "react-router-dom"
import {
  Save, Loader2, DollarSign, Plus, Trash2,
  Bike, Leaf, Zap, Truck, Clock, ChevronUp, ChevronDown, Eye, Gauge,
} from "lucide-react"
import { Button } from "@food/components/ui/button"
import { adminAPI } from "@food/api"
import { toast } from "sonner"
import PartnerSettingsSection, {
  clampMultiOrderDistanceKm,
  clampMaxConcurrentOrders,
  MULTI_ORDER_DISTANCE_MAX_KM,
  MAX_CONCURRENT_ORDERS_DEFAULT,
} from "./PartnerSettingsSection"
import DistanceRulesSection from "./DistanceRulesSection"

const ADMIN_SPEED_ICONS = [
  { id: "bike", label: "Bike", Icon: Bike },
  { id: "leaf", label: "Eco", Icon: Leaf },
  { id: "zap", label: "Zap", Icon: Zap },
  { id: "truck", label: "Truck", Icon: Truck },
  { id: "clock", label: "Clock", Icon: Clock },
]

const BADGE_COLOR_PRESETS = [
  { id: "green", label: "Green", classes: "bg-green-50 text-green-700 border border-green-100" },
  { id: "orange", label: "Orange", classes: "bg-orange-50 text-orange-700 border border-orange-100" },
  { id: "amber", label: "Amber", classes: "bg-amber-50 text-amber-700 border border-amber-100" },
  { id: "blue", label: "Blue", classes: "bg-blue-50 text-blue-700 border border-blue-100" },
  { id: "purple", label: "Purple", classes: "bg-purple-50 text-purple-700 border border-purple-100" },
  { id: "slate", label: "Slate", classes: "bg-slate-100 text-slate-700 border border-slate-200" },
]

const PAGE_TABS = [
  { id: "fees", label: "Fees & Charges" },
  { id: "speed", label: "Cart Delivery Speed" },
  { id: "partner", label: "Partner Settings" },
  { id: "rules", label: "Distance Rules" },
]

const DEFAULT_PARTNER_SETTINGS = {
  multiOrderEnabled: true,
  multiOrderMaxDistance: MULTI_ORDER_DISTANCE_MAX_KM,
  multiOrderAdditionalCharge: 0,
  splitOrderEnabled: true,
  splitOrderThreshold: 20,
  maxConcurrentOrders: MAX_CONCURRENT_ORDERS_DEFAULT,
}

const getSpeedIcon = (iconId) => ADMIN_SPEED_ICONS.find((i) => i.id === iconId)?.Icon || Bike

export default function FeeSettings() {
  const [searchParams] = useSearchParams()
  const initialTab = PAGE_TABS.some((t) => t.id === searchParams.get("tab")) ? searchParams.get("tab") : "fees"
  const [pageTab, setPageTab] = useState(initialTab)
  const [feeSettings, setFeeSettings] = useState({
    deliveryFee: "",
    freeDeliveryThreshold: "",
    platformFee: "",
    packagingFee: "",
    gstRate: "",
  })
  const [partnerSettings, setPartnerSettings] = useState(DEFAULT_PARTNER_SETTINGS)
  const [deliverySpeedOptions, setDeliverySpeedOptions] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [togglingPartner, setTogglingPartner] = useState(false)

  const fetchAll = async () => {
    try {
      setLoading(true)
      const [feeRes, speedRes] = await Promise.all([
        adminAPI.getFeeSettings(),
        adminAPI.getDeliveryBoySettings(),
      ])

      if (feeRes.data.success) {
        const fs = feeRes.data.data.feeSettings
        if (fs) {
          setFeeSettings({
            deliveryFee: fs.deliveryFee ?? "",
            freeDeliveryThreshold: fs.freeDeliveryThreshold ?? "",
            platformFee: fs.platformFee ?? "",
            packagingFee: fs.packagingFee ?? "",
            gstRate: fs.gstRate ?? "",
          })
        } else {
          setFeeSettings({
            deliveryFee: "",
            freeDeliveryThreshold: "",
            platformFee: "",
            packagingFee: "",
            gstRate: "",
          })
        }
      }

      if (speedRes.data.success && speedRes.data.data) {
        const data = speedRes.data.data
        setDeliverySpeedOptions(data.deliverySpeedOptions || [])
        setPartnerSettings({
          multiOrderEnabled: data.multiOrderEnabled !== false,
          multiOrderMaxDistance: clampMultiOrderDistanceKm(
            data.multiOrderMaxDistance || MULTI_ORDER_DISTANCE_MAX_KM,
          ),
          multiOrderAdditionalCharge: data.multiOrderAdditionalCharge || 0,
          splitOrderEnabled: data.splitOrderEnabled !== false,
          splitOrderThreshold: data.splitOrderThreshold || 20,
          maxConcurrentOrders: clampMaxConcurrentOrders(data.maxConcurrentOrders),
        })
      }
    } catch {
      toast.error("Failed to load settings")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAll()
  }, [])

  const persistPartnerPatch = async (patch) => {
    const previous = partnerSettings
    try {
      setTogglingPartner(true)
      const response = await adminAPI.updateDeliveryBoySettings(patch)
      if (response.data?.success) {
        toast.success("Partner setting updated")
        return true
      }
      setPartnerSettings(previous)
      toast.error(response.data?.message || "Failed to update partner setting")
      return false
    } catch (error) {
      setPartnerSettings(previous)
      toast.error(error.response?.data?.message || "Failed to update partner setting")
      return false
    } finally {
      setTogglingPartner(false)
    }
  }

  const handleSave = async () => {
    if (pageTab === "rules") return
    try {
      setSaving(true)

      const feePayload = {
        deliveryFee: feeSettings.deliveryFee === "" ? undefined : Number(feeSettings.deliveryFee),
        freeDeliveryThreshold: feeSettings.freeDeliveryThreshold === "" ? undefined : Number(feeSettings.freeDeliveryThreshold),
        platformFee: feeSettings.platformFee === "" ? undefined : Number(feeSettings.platformFee),
        packagingFee: feeSettings.packagingFee === "" ? undefined : Number(feeSettings.packagingFee),
        gstRate: feeSettings.gstRate === "" ? undefined : Number(feeSettings.gstRate),
        isActive: true,
      }

      const clampedDistance = clampMultiOrderDistanceKm(partnerSettings.multiOrderMaxDistance)
      if (Number(partnerSettings.multiOrderMaxDistance) !== clampedDistance) {
        setPartnerSettings((prev) => ({ ...prev, multiOrderMaxDistance: clampedDistance }))
      }

      const partnerPayload = {
        multiOrderEnabled: Boolean(partnerSettings.multiOrderEnabled),
        multiOrderMaxDistance: clampedDistance,
        multiOrderAdditionalCharge: Number(partnerSettings.multiOrderAdditionalCharge) || 0,
        splitOrderEnabled: partnerSettings.splitOrderEnabled !== false,
        splitOrderThreshold: Number(partnerSettings.splitOrderThreshold) || 20,
        maxConcurrentOrders: clampMaxConcurrentOrders(partnerSettings.maxConcurrentOrders),
        deliverySpeedOptions: deliverySpeedOptions.map((option, index) => {
          const feeModifier = Number(option.feeModifier) || 0
          const rawDriverShare = Number(option.driverShareAmount) || 0
          return {
            ...option,
            estimatedTime: Number(option.estimatedTime) || 30,
            feeModifier,
            driverShareAmount:
              feeModifier > 0 ? Math.min(feeModifier, Math.max(0, rawDriverShare)) : 0,
            sortOrder: index,
          }
        }),
      }

      const [feeRes, partnerRes] = await Promise.all([
        adminAPI.createOrUpdateFeeSettings(feePayload),
        adminAPI.updateDeliveryBoySettings(partnerPayload),
      ])

      if (feeRes.data.success && partnerRes.data.success) {
        toast.success("Settings saved successfully")
        const saved = feeRes?.data?.data?.feeSettings
        if (saved) {
          setFeeSettings({
            deliveryFee: saved.deliveryFee ?? "",
            freeDeliveryThreshold: saved.freeDeliveryThreshold ?? "",
            platformFee: saved.platformFee ?? "",
            packagingFee: saved.packagingFee ?? "",
            gstRate: saved.gstRate ?? "",
          })
        }
        fetchAll()
      } else {
        toast.error(feeRes.data.message || partnerRes.data.message || "Failed to save settings")
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to save settings")
    } finally {
      setSaving(false)
    }
  }

  const addSpeedOption = () => {
    setDeliverySpeedOptions((prev) => [
      ...prev,
      {
        id: `speed-${prev.length + 1}`,
        name: "",
        badge: "",
        badgeColor: BADGE_COLOR_PRESETS[5].classes,
        time: "",
        estimatedTime: 30,
        feeModifier: 0,
        driverShareAmount: 0,
        description: "",
        icon: "bike",
        isEnabled: true,
        isDefault: prev.length === 0,
        sortOrder: prev.length,
      },
    ])
  }

  const updateSpeedOption = (index, field, value) => {
    setDeliverySpeedOptions((prev) => {
      const next = [...prev]
      const current = { ...next[index], [field]: value }

      if (field === "feeModifier") {
        const fee = Number(value) || 0
        if (fee <= 0) {
          current.driverShareAmount = 0
        } else {
          const driverShare = Number(current.driverShareAmount) || 0
          current.driverShareAmount = Math.min(fee, Math.max(0, driverShare))
        }
      }

      if (field === "driverShareAmount") {
        const fee = Math.max(0, Number(current.feeModifier) || 0)
        const raw = Number(value)
        current.driverShareAmount = fee <= 0
          ? 0
          : Math.min(fee, Math.max(0, Number.isFinite(raw) ? raw : 0))
      }

      next[index] = current
      if (field === "isDefault" && value) {
        return next.map((option, i) => ({ ...option, isDefault: i === index }))
      }
      return next
    })
  }

  const removeSpeedOption = (index) => {
    setDeliverySpeedOptions((prev) => prev.filter((_, i) => i !== index))
  }

  const moveSpeedOption = (index, direction) => {
    setDeliverySpeedOptions((prev) => {
      const options = [...prev]
      const target = index + direction
      if (target < 0 || target >= options.length) return prev
      ;[options[index], options[target]] = [options[target], options[index]]
      return options.map((option, i) => ({ ...option, sortOrder: i }))
    })
  }

  const enabledSpeedOptions = useMemo(
    () => deliverySpeedOptions.filter((o) => o.isEnabled !== false),
    [deliverySpeedOptions]
  )

  const sampleDeliveryBaseFee = useMemo(() => {
    const parsed = Number(feeSettings.deliveryFee)
    return Number.isFinite(parsed) ? parsed : 25
  }, [feeSettings.deliveryFee])

  return (
    <div className="min-h-full bg-slate-50">
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 lg:px-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 rounded-lg bg-gradient-to-br from-green-400 to-green-600 shrink-0">
                <DollarSign className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-slate-900 truncate">Delivery & Platform Fee</h1>
                <p className="text-xs text-slate-500">Fees, delivery speed, partner & distance rules</p>
              </div>
            </div>
            {pageTab !== "rules" && (
            <Button
              onClick={handleSave}
              disabled={saving || loading}
              className="bg-green-600 hover:bg-green-700 text-white shrink-0"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save Settings
                </>
              )}
            </Button>
            )}
          </div>
          <div className="flex gap-1 overflow-x-auto -mb-px">
            {PAGE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setPageTab(tab.id)}
                className={`px-4 py-2.5 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors ${
                  pageTab === tab.id
                    ? "border-green-600 text-green-700"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 lg:px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-green-600" />
          </div>
        ) : pageTab === "fees" ? (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                <h2 className="text-lg font-bold text-slate-900">Order Fees</h2>
                <p className="text-sm text-slate-500 mt-0.5">Platform, packaging & tax charges applied to every order</p>
              </div>
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-700">Default Delivery Fee (₹)</label>
                  <input
                    type="number"
                    value={feeSettings.deliveryFee}
                    onChange={(e) => setFeeSettings({ ...feeSettings, deliveryFee: e.target.value })}
                    min="0"
                    step="1"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
                    placeholder="0"
                  />
                  <p className="text-xs text-slate-500">Used when no Distance Rule matches the order distance (applies to both customer charge and delivery boy fee).</p>
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-700">Free Delivery Threshold (₹)</label>
                  <input
                    type="number"
                    value={feeSettings.freeDeliveryThreshold}
                    onChange={(e) => setFeeSettings({ ...feeSettings, freeDeliveryThreshold: e.target.value })}
                    min="0"
                    step="1"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
                    placeholder="149"
                  />
                  <p className="text-xs text-slate-500">Orders at or above this subtotal get free delivery</p>
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-700">Platform Fee (₹)</label>
                  <input
                    type="number"
                    value={feeSettings.platformFee}
                    onChange={(e) => setFeeSettings({ ...feeSettings, platformFee: e.target.value })}
                    min="0"
                    step="1"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
                    placeholder="5"
                  />
                  <p className="text-xs text-slate-500">Platform service fee per order</p>
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-700">Packaging Charges (₹)</label>
                  <input
                    type="number"
                    value={feeSettings.packagingFee}
                    onChange={(e) => setFeeSettings({ ...feeSettings, packagingFee: e.target.value })}
                    min="0"
                    step="1"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
                    placeholder="10"
                  />
                  <p className="text-xs text-slate-500">Packaging charges fee per order</p>
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-700">GST Rate (%)</label>
                  <input
                    type="number"
                    value={feeSettings.gstRate}
                    onChange={(e) => setFeeSettings({ ...feeSettings, gstRate: e.target.value })}
                    min="0"
                    max="100"
                    step="0.1"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
                    placeholder="5"
                  />
                  <p className="text-xs text-slate-500">GST percentage applied on order subtotal</p>
                </div>
              </div>
            </div>
          </div>
        ) : pageTab === "speed" ? (
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
            <div className="xl:col-span-3 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Gauge className="w-5 h-5 text-green-600" />
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Cart Delivery Speed</h2>
                    <p className="text-sm text-slate-500">Shown on user cart checkout</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={addSpeedOption}
                  className="px-3 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  Add
                </button>
              </div>

              {deliverySpeedOptions.length === 0 ? (
                <div className="text-center py-16 rounded-xl border-2 border-dashed border-slate-200 bg-white">
                  <Gauge className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-sm text-slate-500 mb-3">No speed options configured</p>
                  <button type="button" onClick={addSpeedOption} className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold">
                    Add first option
                  </button>
                </div>
              ) : (
                deliverySpeedOptions.map((option, index) => {
                  const IconComponent = getSpeedIcon(option.icon)
                  return (
                    <div key={`${option.id}-${index}`} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/80">
                        <div className="p-2 rounded-lg bg-green-50 text-green-600">
                          <IconComponent className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-900 truncate">{option.name || "Untitled"}</p>
                          <p className="text-xs text-slate-400">{option.id}</p>
                        </div>
                        <div className="flex items-center gap-0.5">
                          <button type="button" onClick={() => moveSpeedOption(index, -1)} disabled={index === 0} className="p-1.5 rounded hover:bg-white disabled:opacity-30">
                            <ChevronUp className="w-4 h-4 text-slate-500" />
                          </button>
                          <button type="button" onClick={() => moveSpeedOption(index, 1)} disabled={index === deliverySpeedOptions.length - 1} className="p-1.5 rounded hover:bg-white disabled:opacity-30">
                            <ChevronDown className="w-4 h-4 text-slate-500" />
                          </button>
                          <button type="button" onClick={() => removeSpeedOption(index)} className="p-1.5 rounded text-red-500 hover:bg-red-50">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="p-4 space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">Name</label>
                            <input type="text" value={option.name || ""} onChange={(e) => updateSpeedOption(index, "name", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">ID</label>
                            <input type="text" value={option.id || ""} onChange={(e) => updateSpeedOption(index, "id", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">Badge</label>
                            <input type="text" value={option.badge || ""} onChange={(e) => updateSpeedOption(index, "badge", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">ETA</label>
                            <input type="text" value={option.time || ""} onChange={(e) => updateSpeedOption(index, "time", e.target.value)} placeholder="25–35 mins" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">Est. minutes</label>
                            <input type="number" min="1" value={option.estimatedTime ?? 30} onChange={(e) => updateSpeedOption(index, "estimatedTime", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">Fee modifier (₹)</label>
                            <input type="number" value={option.feeModifier ?? 0} onChange={(e) => updateSpeedOption(index, "feeModifier", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none" />
                            <p className="text-[11px] text-slate-400 mt-1">
                              Negative = admin bears · Zero = no split · Positive = configure driver/admin below
                            </p>
                          </div>
                        </div>
                        {Number(option.feeModifier) > 0 ? (
                          <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 space-y-3">
                            <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">
                              Speed fee split (Driver + Admin only)
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1">Driver share (₹)</label>
                                <input
                                  type="number"
                                  min="0"
                                  max={Number(option.feeModifier) || 0}
                                  step="1"
                                  value={option.driverShareAmount ?? 0}
                                  onChange={(e) => updateSpeedOption(index, "driverShareAmount", e.target.value)}
                                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none bg-white"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1">Admin share (₹)</label>
                                <input
                                  type="number"
                                  readOnly
                                  value={Math.max(
                                    0,
                                    Number((Number(option.feeModifier || 0) - Number(option.driverShareAmount || 0)).toFixed(2)),
                                  )}
                                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-100 text-slate-700 outline-none"
                                />
                              </div>
                            </div>
                            <p className="text-[11px] text-slate-500">
                              Total fee ₹{Number(option.feeModifier) || 0} = Driver ₹{Number(option.driverShareAmount) || 0} + Admin ₹
                              {Math.max(0, Number((Number(option.feeModifier || 0) - Number(option.driverShareAmount || 0)).toFixed(2)))}. Restaurant gets ₹0.
                            </p>
                          </div>
                        ) : Number(option.feeModifier) < 0 ? (
                          <div className="rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-2 text-xs text-amber-800">
                            Negative fee — entire amount is borne by admin. Split configuration is not available.
                          </div>
                        ) : (
                          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                            Zero fee — no driver/admin split to configure.
                          </div>
                        )}
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">Description</label>
                          <input type="text" value={option.description || ""} onChange={(e) => updateSpeedOption(index, "description", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-2">Icon</label>
                          <div className="flex flex-wrap gap-2">
                            {ADMIN_SPEED_ICONS.map(({ id, label, Icon }) => (
                              <button key={id} type="button" onClick={() => updateSpeedOption(index, "icon", id)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium ${(option.icon || "bike") === id ? "border-green-500 bg-green-50 text-green-700" : "border-slate-200 text-slate-600"}`}>
                                <Icon className="w-3.5 h-3.5" />{label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-2">Badge color</label>
                          <div className="flex flex-wrap gap-2">
                            {BADGE_COLOR_PRESETS.map((preset) => (
                              <button key={preset.id} type="button" onClick={() => updateSpeedOption(index, "badgeColor", preset.classes)} className={`px-2 py-1 rounded text-xs font-bold ${preset.classes} ${option.badgeColor === preset.classes ? "ring-2 ring-green-500 ring-offset-1" : ""}`}>
                                {preset.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-4 text-sm">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={option.isEnabled !== false} onChange={(e) => updateSpeedOption(index, "isEnabled", e.target.checked)} />
                            Enabled
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer" title="Pre-selected on user cart when they open checkout">
                            <input type="radio" name="defaultSpeedOption" checked={Boolean(option.isDefault)} onChange={() => updateSpeedOption(index, "isDefault", true)} />
                            Default on cart
                          </label>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <div className="xl:col-span-2">
              <div className="sticky top-[7.5rem] bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <Eye className="w-4 h-4 text-slate-400" />
                  <h3 className="font-bold text-slate-900 text-sm">Cart preview</h3>
                </div>
                <p className="text-[10px] text-slate-500 mb-2">
                  Sample delivery fee uses default delivery fee (₹{sampleDeliveryBaseFee}) plus each option&apos;s modifier. Actual user cart may differ by distance and order rules.
                </p>
                <div className="rounded-xl border border-gray-100 p-3 bg-slate-50">
                  <p className="text-xs font-bold text-gray-700 mb-2">Delivery Speed Options</p>
                  {enabledSpeedOptions.length > 0 ? (
                    <div className="space-y-2">
                      {enabledSpeedOptions.map((option) => {
                        const isDefault = Boolean(option.isDefault)
                        const PreviewIcon = getSpeedIcon(option.icon)
                        const previewFee = Math.max(0, sampleDeliveryBaseFee + Number(option.feeModifier || 0))
                        return (
                          <div
                            key={option.id}
                            className={`flex items-center justify-between p-2.5 rounded-lg border text-left ${isDefault ? "border-green-600 bg-green-50" : "border-gray-100 bg-white"}`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className={`p-1 rounded ${isDefault ? "bg-green-600 text-white" : "bg-gray-100 text-gray-500"}`}>
                                <PreviewIcon className="w-3.5 h-3.5" />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1 flex-wrap">
                                  <span className="text-xs font-bold text-gray-900">{option.name || "Untitled"}</span>
                                  {option.badge && <span className={`text-[9px] font-bold px-1 rounded border ${option.badgeColor || ""}`}>{option.badge}</span>}
                                </div>
                                <p className="text-[10px] text-gray-500 truncate">{option.description}</p>
                              </div>
                            </div>
                            <div className="text-right shrink-0 ml-2">
                              <p className="text-[10px] font-bold text-green-600">{option.time || "—"}</p>
                              <p className="text-[9px] text-gray-400">{previewFee === 0 ? "FREE" : `₹${previewFee.toFixed(2)}`}</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 text-center py-6">Enable an option to preview</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : pageTab === "partner" ? (
          <PartnerSettingsSection
            settings={partnerSettings}
            onChange={setPartnerSettings}
            onPersistPatch={persistPartnerPatch}
            persisting={togglingPartner}
          />
        ) : pageTab === "rules" ? (
          <DistanceRulesSection />
        ) : null}
      </div>
    </div>
  )
}
