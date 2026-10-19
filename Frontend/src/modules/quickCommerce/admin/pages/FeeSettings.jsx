import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Save, Loader2, IndianRupee, Plus, Trash2,
  Bike, Leaf, Zap, Truck, Clock, ChevronUp, ChevronDown, Eye, Gauge,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@shared/components/ui/Toast";
import { adminApi } from "../services/adminApi";
import DistanceRulesSection from "./billing/DistanceRulesSection";
import PeakHoursSection from "./billing/PeakHoursSection";

const SPEED_ICONS = [
  { id: "bike", label: "Bike", Icon: Bike },
  { id: "leaf", label: "Eco", Icon: Leaf },
  { id: "zap", label: "Zap", Icon: Zap },
  { id: "truck", label: "Truck", Icon: Truck },
  { id: "clock", label: "Clock", Icon: Clock },
];

const BADGE_COLOR_PRESETS = [
  { id: "green", label: "Green", classes: "bg-green-50 text-green-700 border border-green-100" },
  { id: "orange", label: "Orange", classes: "bg-orange-50 text-orange-700 border border-orange-100" },
  { id: "amber", label: "Amber", classes: "bg-amber-50 text-amber-700 border border-amber-100" },
  { id: "blue", label: "Blue", classes: "bg-blue-50 text-blue-700 border border-blue-100" },
  { id: "purple", label: "Purple", classes: "bg-purple-50 text-purple-700 border border-purple-100" },
  { id: "slate", label: "Slate", classes: "bg-slate-100 text-slate-700 border border-slate-200" },
];

const PAGE_TABS = [
  { id: "fees", label: "Fees & Charges" },
  { id: "speed", label: "Cart Delivery Speed" },
  { id: "partner", label: "Partner Settings" },
  { id: "rules", label: "Distance Rules" },
  { id: "peak", label: "Peak Hours" },
];

const getSpeedIcon = (iconId) => SPEED_ICONS.find((i) => i.id === iconId)?.Icon || Bike;

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60",
        checked ? "bg-primary" : "bg-slate-300",
      )}
    >
      <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white transition-transform", checked ? "translate-x-6" : "translate-x-1")} />
    </button>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-bold uppercase text-slate-500">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

const inputClass = "w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none text-sm";

/**
 * Quick Commerce counterpart of Food's "Delivery & Platform Fee" admin page — same 4 tabs,
 * same cart preview. Fees & Charges and Distance Rules save to QuickFeeSettings; Cart Delivery
 * Speed and Partner Settings save to QuickDeliverySettings (both already shared QC backends).
 */
export default function FeeSettings() {
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const initialTab = PAGE_TABS.some((t) => t.id === searchParams.get("tab")) ? searchParams.get("tab") : "fees";
  const [pageTab, setPageTab] = useState(initialTab);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rulesSaving, setRulesSaving] = useState(false);

  const [feeSettings, setFeeSettings] = useState({
    platformFee: "",
    freeDeliveryThreshold: "",
    deliveryFeeRanges: [],
  });
  const [deliverySettings, setDeliverySettings] = useState(null);
  const [activePeakHourSurcharge, setActivePeakHourSurcharge] = useState(null);

  const fetchActivePeakHourSurcharge = async () => {
    try {
      const res = await adminApi.getActivePeakHourSurcharge();
      setActivePeakHourSurcharge(res?.data?.data?.surcharge || null);
    } catch {
      setActivePeakHourSurcharge(null);
    }
  };

  const load = async () => {
    try {
      setLoading(true);
      const [feeRes, deliveryRes] = await Promise.all([adminApi.getFeeSettings(), adminApi.getDeliverySettings()]);
      const fs = feeRes?.data?.data?.feeSettings;
      setFeeSettings({
        platformFee: fs?.platformFee ?? "",
        freeDeliveryThreshold: fs?.freeDeliveryThreshold ?? "",
        deliveryFeeRanges: Array.isArray(fs?.deliveryFeeRanges) ? fs.deliveryFeeRanges : [],
      });
      const ds = deliveryRes?.data?.data?.settings || deliveryRes?.data?.settings || {};
      setDeliverySettings(ds);
      fetchActivePeakHourSurcharge();
    } catch (error) {
      showToast(error?.response?.data?.message || "Failed to load settings", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const options = Array.isArray(deliverySettings?.deliverySpeedOptions) ? deliverySettings.deliverySpeedOptions : [];
  const updateDelivery = (patch) => setDeliverySettings((prev) => ({ ...prev, ...patch }));

  const updateOption = (index, field, value) => {
    setDeliverySettings((prev) => {
      const next = [...(prev.deliverySpeedOptions || [])];
      const current = { ...next[index], [field]: value };

      if (field === "feeModifier") {
        const fee = Number(value) || 0;
        if (fee <= 0) current.driverShareAmount = 0;
        else {
          const driverShare = Number(current.driverShareAmount) || 0;
          current.driverShareAmount = Math.min(fee, Math.max(0, driverShare));
        }
      }
      if (field === "driverShareAmount") {
        const fee = Math.max(0, Number(current.feeModifier) || 0);
        const raw = Number(value);
        current.driverShareAmount = fee <= 0 ? 0 : Math.min(fee, Math.max(0, Number.isFinite(raw) ? raw : 0));
      }

      next[index] = current;
      if (field === "isDefault" && value) {
        return { ...prev, deliverySpeedOptions: next.map((o, i) => ({ ...o, isDefault: i === index })) };
      }
      return { ...prev, deliverySpeedOptions: next };
    });
  };

  const addOption = () => {
    const next = [
      ...options,
      {
        id: `option-${options.length + 1}`,
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
        isDefault: options.length === 0,
        sortOrder: options.length,
      },
    ];
    updateDelivery({ deliverySpeedOptions: next });
  };

  const removeOption = (index) => {
    updateDelivery({ deliverySpeedOptions: options.filter((_, i) => i !== index) });
  };

  const moveOption = (index, direction) => {
    const next = [...options];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    updateDelivery({ deliverySpeedOptions: next.map((o, i) => ({ ...o, sortOrder: i })) });
  };

  const enabledOptions = useMemo(() => options.filter((o) => o.isEnabled !== false), [options]);

  const sampleDeliveryBaseFee = useMemo(() => {
    const baseRange = (feeSettings.deliveryFeeRanges || []).find((r) => Number(r.min) === 0 && r.status !== false);
    const parsed = Number(baseRange?.fee);
    return Number.isFinite(parsed) ? parsed : 25;
  }, [feeSettings.deliveryFeeRanges]);

  const activePeakHourCharge = Number(activePeakHourSurcharge?.charge) || 0;

  const handleSaveFeesAndSpeed = async () => {
    try {
      setSaving(true);
      const feePayload = {
        platformFee: feeSettings.platformFee === "" ? undefined : Number(feeSettings.platformFee),
        freeDeliveryThreshold: feeSettings.freeDeliveryThreshold === "" ? undefined : Number(feeSettings.freeDeliveryThreshold),
        deliveryFeeRanges: feeSettings.deliveryFeeRanges,
        isActive: true,
      };
      const deliveryPayload = {
        ...deliverySettings,
        deliverySpeedOptions: options.map((option, index) => {
          const feeModifier = Number(option.feeModifier) || 0;
          const rawDriverShare = Number(option.driverShareAmount) || 0;
          return {
            ...option,
            estimatedTime: Number(option.estimatedTime) || 30,
            feeModifier,
            driverShareAmount: feeModifier > 0 ? Math.min(feeModifier, Math.max(0, rawDriverShare)) : 0,
            sortOrder: index,
          };
        }),
      };

      const [feeRes, deliveryRes] = await Promise.all([
        adminApi.createOrUpdateFeeSettings(feePayload),
        adminApi.updateDeliverySettings(deliveryPayload),
      ]);

      const savedFee = feeRes?.data?.data?.feeSettings;
      if (savedFee) {
        setFeeSettings({
          platformFee: savedFee.platformFee ?? "",
          freeDeliveryThreshold: savedFee.freeDeliveryThreshold ?? "",
          deliveryFeeRanges: Array.isArray(savedFee.deliveryFeeRanges) ? savedFee.deliveryFeeRanges : [],
        });
      }
      const savedDelivery = deliveryRes?.data?.data?.settings || deliveryRes?.data?.settings;
      if (savedDelivery) setDeliverySettings(savedDelivery);

      showToast("Settings saved successfully", "success");
    } catch (error) {
      showToast(error?.response?.data?.message || "Failed to save settings", "error");
    } finally {
      setSaving(false);
    }
  };

  const saveDistanceRules = async (nextRanges) => {
    try {
      setRulesSaving(true);
      const response = await adminApi.createOrUpdateFeeSettings({
        platformFee: feeSettings.platformFee === "" ? undefined : Number(feeSettings.platformFee),
        freeDeliveryThreshold: feeSettings.freeDeliveryThreshold === "" ? undefined : Number(feeSettings.freeDeliveryThreshold),
        deliveryFeeRanges: nextRanges,
        isActive: true,
      });
      const saved = response?.data?.data?.feeSettings;
      setFeeSettings((prev) => ({
        ...prev,
        deliveryFeeRanges: Array.isArray(saved?.deliveryFeeRanges) ? saved.deliveryFeeRanges : nextRanges,
      }));
      return true;
    } catch (error) {
      showToast(error?.response?.data?.message || "Failed to save distance rule", "error");
      return false;
    } finally {
      setRulesSaving(false);
    }
  };

  if (loading || !deliverySettings) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-sm -mx-4 md:-mx-6 px-4 md:px-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 shrink-0">
              <IndianRupee className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-slate-900 truncate">Delivery & Platform Fee</h1>
              <p className="text-xs text-slate-500">Fees, delivery speed, partner & distance rules</p>
            </div>
          </div>
          {pageTab !== "rules" && pageTab !== "peak" && (
            <button
              type="button"
              onClick={handleSaveFeesAndSpeed}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-primary hover:bg-primary/90 text-white px-5 py-2.5 text-sm font-bold disabled:opacity-60 shrink-0"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Settings
            </button>
          )}
        </div>
        <div className="flex gap-1 overflow-x-auto -mb-px">
          {PAGE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setPageTab(tab.id)}
              className={cn(
                "px-4 py-2.5 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors",
                pageTab === tab.id ? "border-primary text-primary" : "border-transparent text-slate-500 hover:text-slate-700",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="py-6">
        {pageTab === "fees" ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
              <h2 className="text-lg font-bold text-slate-900">Order Fees</h2>
              <p className="text-sm text-slate-500 mt-0.5">Platform fee & free-delivery threshold applied to every order</p>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-700">Platform Fee (₹)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={feeSettings.platformFee}
                  onChange={(e) => setFeeSettings((prev) => ({ ...prev, platformFee: e.target.value }))}
                  className={inputClass}
                  placeholder="0"
                />
                <p className="text-xs text-slate-500">Flat fee added to every Quick Commerce order total</p>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-700">Free Delivery Threshold (₹)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={feeSettings.freeDeliveryThreshold}
                  onChange={(e) => setFeeSettings((prev) => ({ ...prev, freeDeliveryThreshold: e.target.value }))}
                  className={inputClass}
                  placeholder="0"
                />
                <p className="text-xs text-slate-500">Set 0 to disable. When cart subtotal reaches this amount, delivery fee is waived.</p>
              </div>
            </div>
          </div>
        ) : pageTab === "speed" ? (
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
            <div className="xl:col-span-3 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Gauge className="w-5 h-5 text-primary" />
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Cart Delivery Speed</h2>
                    <p className="text-sm text-slate-500">Shown on user cart checkout</p>
                  </div>
                </div>
                <button type="button" onClick={addOption} className="px-3 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white text-sm font-semibold flex items-center gap-1.5">
                  <Plus className="w-4 h-4" /> Add
                </button>
              </div>

              {options.length === 0 ? (
                <div className="text-center py-16 rounded-xl border-2 border-dashed border-slate-200 bg-white">
                  <Gauge className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-sm text-slate-500 mb-3">No speed options configured</p>
                  <button type="button" onClick={addOption} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold">
                    Add first option
                  </button>
                </div>
              ) : (
                options.map((option, index) => {
                  const IconComponent = getSpeedIcon(option.icon);
                  return (
                    <div key={`${option.id}-${index}`} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/80">
                        <div className="p-2 rounded-lg bg-primary/10 text-primary">
                          <IconComponent className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-900 truncate">{option.name || "Untitled"}</p>
                          <p className="text-xs text-slate-400">{option.id}</p>
                        </div>
                        <div className="flex items-center gap-0.5">
                          <button type="button" onClick={() => moveOption(index, -1)} disabled={index === 0} className="p-1.5 rounded hover:bg-white disabled:opacity-30">
                            <ChevronUp className="w-4 h-4 text-slate-500" />
                          </button>
                          <button type="button" onClick={() => moveOption(index, 1)} disabled={index === options.length - 1} className="p-1.5 rounded hover:bg-white disabled:opacity-30">
                            <ChevronDown className="w-4 h-4 text-slate-500" />
                          </button>
                          <button type="button" onClick={() => removeOption(index)} className="p-1.5 rounded text-red-500 hover:bg-red-50">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="p-4 space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Field label="Name">
                            <input type="text" value={option.name || ""} onChange={(e) => updateOption(index, "name", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary outline-none" />
                          </Field>
                          <Field label="Id">
                            <input type="text" value={option.id || ""} onChange={(e) => updateOption(index, "id", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary outline-none" />
                          </Field>
                          <Field label="Badge">
                            <input type="text" value={option.badge || ""} onChange={(e) => updateOption(index, "badge", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary outline-none" />
                          </Field>
                          <Field label="ETA">
                            <input type="text" value={option.time || ""} onChange={(e) => updateOption(index, "time", e.target.value)} placeholder="10-15 mins" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary outline-none" />
                          </Field>
                          <Field label="Est. minutes">
                            <input type="number" min="1" value={option.estimatedTime ?? 30} onChange={(e) => updateOption(index, "estimatedTime", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary outline-none" />
                          </Field>
                          <Field label="Fee modifier (₹)" hint="Negative = admin bears · Zero = no split · Positive = configure driver/admin below">
                            <input type="number" value={option.feeModifier ?? 0} onChange={(e) => updateOption(index, "feeModifier", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary outline-none" />
                          </Field>
                        </div>
                        {Number(option.feeModifier) > 0 ? (
                          <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 space-y-3">
                            <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">Speed fee split (Rider + Admin only)</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <Field label="Rider share (₹)">
                                <input
                                  type="number"
                                  min="0"
                                  max={Number(option.feeModifier) || 0}
                                  step="1"
                                  value={option.driverShareAmount ?? 0}
                                  onChange={(e) => updateOption(index, "driverShareAmount", e.target.value)}
                                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary outline-none bg-white"
                                />
                              </Field>
                              <Field label="Admin share (₹)">
                                <input
                                  type="number"
                                  readOnly
                                  value={Math.max(0, Number((Number(option.feeModifier || 0) - Number(option.driverShareAmount || 0)).toFixed(2)))}
                                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-100 text-slate-700 outline-none"
                                />
                              </Field>
                            </div>
                          </div>
                        ) : Number(option.feeModifier) < 0 ? (
                          <div className="rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-2 text-xs text-amber-800">
                            Negative fee — entire amount is borne by admin. Split configuration is not available.
                          </div>
                        ) : (
                          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                            Zero fee — no rider/admin split to configure.
                          </div>
                        )}
                        <Field label="Description">
                          <input type="text" value={option.description || ""} onChange={(e) => updateOption(index, "description", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary outline-none" />
                        </Field>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-2">Icon</label>
                          <div className="flex flex-wrap gap-2">
                            {SPEED_ICONS.map(({ id, label, Icon }) => (
                              <button
                                key={id}
                                type="button"
                                onClick={() => updateOption(index, "icon", id)}
                                className={cn(
                                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium",
                                  (option.icon || "bike") === id ? "border-primary bg-primary/10 text-primary" : "border-slate-200 text-slate-600",
                                )}
                              >
                                <Icon className="w-3.5 h-3.5" />
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-2">Badge color</label>
                          <div className="flex flex-wrap gap-2">
                            {BADGE_COLOR_PRESETS.map((preset) => (
                              <button
                                key={preset.id}
                                type="button"
                                onClick={() => updateOption(index, "badgeColor", preset.classes)}
                                className={cn("px-2 py-1 rounded text-xs font-bold", preset.classes, option.badgeColor === preset.classes ? "ring-2 ring-primary ring-offset-1" : "")}
                              >
                                {preset.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-4 text-sm">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={option.isEnabled !== false} onChange={(e) => updateOption(index, "isEnabled", e.target.checked)} />
                            Enabled
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer" title="Pre-selected on user cart when they open checkout">
                            <input type="radio" name="defaultSpeedOption" checked={Boolean(option.isDefault)} onChange={() => updateOption(index, "isDefault", true)} />
                            Default on cart
                          </label>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="xl:col-span-2">
              <div className="sticky top-[9.5rem] bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <Eye className="w-4 h-4 text-slate-400" />
                  <h3 className="font-bold text-slate-900 text-sm">Cart preview</h3>
                </div>
                <p className="text-[10px] text-slate-500 mb-2">
                  Sample delivery fee uses the base distance slab fee (₹{sampleDeliveryBaseFee}){activePeakHourCharge > 0 ? ` + active Peak Hour charge (₹${activePeakHourCharge})` : ""} plus each option&apos;s modifier. Actual user cart may differ by distance and order rules.
                </p>
                {activePeakHourCharge > 0 && (
                  <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] text-amber-800 flex items-center gap-1.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    <span>
                      <strong>{activePeakHourSurcharge?.name || "Peak Hour"}</strong> is live right now — +₹{activePeakHourCharge} is included below.
                    </span>
                  </div>
                )}
                <div className="rounded-xl border border-gray-100 p-3 bg-slate-50">
                  <p className="text-xs font-bold text-gray-700 mb-2">Delivery Speed Options</p>
                  {enabledOptions.length > 0 ? (
                    <div className="space-y-2">
                      {enabledOptions.map((option) => {
                        const isDefault = Boolean(option.isDefault);
                        const PreviewIcon = getSpeedIcon(option.icon);
                        const previewFee = Math.max(0, sampleDeliveryBaseFee + Number(option.feeModifier || 0) + activePeakHourCharge);
                        return (
                          <div
                            key={option.id}
                            className={cn("flex items-center justify-between p-2.5 rounded-lg border text-left", isDefault ? "border-primary bg-primary/5" : "border-gray-100 bg-white")}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className={cn("p-1 rounded", isDefault ? "bg-primary text-white" : "bg-gray-100 text-gray-500")}>
                                <PreviewIcon className="w-3.5 h-3.5" />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1 flex-wrap">
                                  <span className="text-xs font-bold text-gray-900">{option.name || "Untitled"}</span>
                                  {option.badge && <span className={cn("text-[9px] font-bold px-1 rounded border", option.badgeColor)}>{option.badge}</span>}
                                </div>
                                <p className="text-[10px] text-gray-500 truncate">{option.description}</p>
                              </div>
                            </div>
                            <div className="text-right shrink-0 ml-2">
                              <p className="text-[10px] font-bold text-primary">{option.time || "—"}</p>
                              <p className="text-[9px] text-gray-400">{previewFee === 0 ? "FREE" : `₹${previewFee.toFixed(2)}`}</p>
                            </div>
                          </div>
                        );
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900 mb-2">Payments</h2>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Allow Cash on Delivery</span>
                <Toggle checked={Boolean(deliverySettings.codEnabled)} onChange={(v) => updateDelivery({ codEnabled: v })} />
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900 mb-2">Rider Search</h2>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Offer window (sec)" hint="Time a rider has to accept">
                  <input type="number" min="15" max="180" className={inputClass} value={deliverySettings.offerTimeoutSec ?? ""} onChange={(e) => updateDelivery({ offerTimeoutSec: e.target.value })} />
                </Field>
                <Field label="Cancel if no rider (min)" hint="Order is cancelled and refunded">
                  <input type="number" min="1" max="120" className={inputClass} value={deliverySettings.noRiderCancelMinutes ?? ""} onChange={(e) => updateDelivery({ noRiderCancelMinutes: e.target.value })} />
                </Field>
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900 mb-2">Split Large Orders</h2>
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-slate-600">Enable split delivery for large carts</span>
                <Toggle checked={deliverySettings.splitOrderEnabled !== false} onChange={(v) => updateDelivery({ splitOrderEnabled: v })} />
              </div>
              <Field label="Item count threshold">
                <input type="number" min="1" className={cn(inputClass, "max-w-[200px]")} value={deliverySettings.splitOrderThreshold ?? ""} onChange={(e) => updateDelivery({ splitOrderThreshold: e.target.value })} />
              </Field>
              <p className="text-xs text-slate-500 mt-1">At or above this item count, delivery fee and rider payout are doubled</p>
            </div>

            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900 mb-2">Several Stores in One Order</h2>
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-slate-600">Allow items from more than one store</span>
                <Toggle checked={Boolean(deliverySettings.multiOrderEnabled)} onChange={(v) => updateDelivery({ multiOrderEnabled: v })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Max stores">
                  <select className={inputClass} value={deliverySettings.maxSellersPerOrder ?? 2} onChange={(e) => updateDelivery({ maxSellersPerOrder: e.target.value })}>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </Field>
                <Field label="Extra charge (₹)" hint="Added for each multi-store order">
                  <input type="number" min="0" className={inputClass} value={deliverySettings.multiOrderAdditionalCharge ?? ""} onChange={(e) => updateDelivery({ multiOrderAdditionalCharge: e.target.value })} />
                </Field>
              </div>
            </div>
          </div>
        ) : pageTab === "rules" ? (
          <DistanceRulesSection ranges={feeSettings.deliveryFeeRanges} onSave={saveDistanceRules} saving={rulesSaving} />
        ) : pageTab === "peak" ? (
          <PeakHoursSection onRuleChange={fetchActivePeakHourSurcharge} />
        ) : null}
      </div>
    </div>
  );
}
