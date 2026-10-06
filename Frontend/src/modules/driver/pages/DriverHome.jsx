import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Bike,
  Loader2,
  LogOut,
  Sparkles,
  AlertCircle,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";

import {
  driverModeAPI,
  driverOnboardingAPI,
  clearIdentitySession,
  getApiErrorMessage,
} from "@food/api";
import { clearModuleAuth } from "@food/utils/auth";

const OFF_VALUES = new Set(["off", "none", "offline", "", null, undefined]);
const normalizeMode = (raw) => (OFF_VALUES.has(raw) ? "off" : raw);

const SERVICE_STATUS_CARDS = [
  { key: "food", label: "Food", Icon: Bike, accent: "text-orange-400" },
];

/**
 * Single home for a food-delivery partner. Toggle food mode on/off
 * and open the food-delivery portal when approved.
 */
export default function DriverHome() {
  const navigate = useNavigate();
  const [mode, setMode] = useState("off");
  const [capabilities, setCapabilities] = useState({
    food: "not_enabled",
  });
  const [identity, setIdentity] = useState(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [latLng, setLatLng] = useState(null);
  // Which job types the rider takes while online. null = never chosen: stay silent so the
  // server keeps its saved value (and food-only riders are never locked out).
  const [services, setServices] = useState(null);
  const [rejection, setRejection] = useState({ food: null });
  const [resubmitAllowed, setResubmitAllowed] = useState(false);

  useEffect(() => {
    const token =
      localStorage.getItem("driver_accessToken") ||
      localStorage.getItem("delivery_accessToken") ||
      localStorage.getItem("driverToken");
    if (!token) {
      navigate("/driver/login", { replace: true });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [stateRes, modeRes] = await Promise.all([
          driverOnboardingAPI.getState().catch(() => null),
          driverModeAPI.get().catch(() => null),
        ]);
        if (cancelled) return;
        const onboardingState = stateRes?.data?.data || stateRes?.data || {};
        const modeState = modeRes?.data?.data || modeRes?.data || {};
        if (onboardingState && onboardingState.onboardingComplete === false) {
          navigate("/driver/onboarding", { replace: true });
          return;
        }
        setResubmitAllowed(Boolean(onboardingState?.resubmitAllowed));
        setRejection(onboardingState?.rejection || { food: null });
        setIdentity(onboardingState?.identity || onboardingState || null);
        if (onboardingState?.capabilities) setCapabilities(onboardingState.capabilities);
        if (modeState?.capabilities) setCapabilities((prev) => ({ ...prev, ...modeState.capabilities }));
        if (modeState?.activeService) setMode(normalizeMode(modeState.activeService));
        if (Array.isArray(modeState?.services) && modeState.services.length) setServices(modeState.services);
      } catch (err) {
        if (err?.response?.status === 401) navigate("/driver/login", { replace: true });
      } finally {
        if (!cancelled) setBootLoading(false);
      }
    })();

    if (navigator?.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLatLng({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => {},
        { enableHighAccuracy: true, timeout: 5000 },
      );
    }
    return () => { cancelled = true; };
  }, [navigate]);

  const foodRejected = capabilities?.food === "rejected";
  const anyRejected = foodRejected;
  const foodEnabled = capabilities?.food && capabilities.food !== "not_enabled";
  const foodApproved = capabilities?.food === "approved" || capabilities?.food === "enabled" || capabilities?.food === "active";
  const deliveryApproved = foodApproved;
  const deliveryEnabled = foodEnabled;

  const applyMode = async (next, chosenServices = services) => {
    setSwitching(true);
    try {
      const res = await driverModeAPI.set(next, {
        ...(latLng || {}),
        ...(next === "food" && chosenServices ? { services: chosenServices } : {}),
      });
      const data = res?.data?.data || res?.data || {};
      setMode(normalizeMode(data?.activeService) || "off");
      if (data?.capabilities) setCapabilities(data.capabilities);
      if (Array.isArray(data?.services) && data.services.length) setServices(data.services);
      if (next === "off") {
        toast.success("You're offline — not receiving jobs");
      } else if (next === "food") {
        toast.success("You're online — receiving food orders");
      }
    } catch (err) {
      const msg = getApiErrorMessage(err, "Could not switch mode — finish your current job first");
      toast.error(msg);
    } finally {
      setSwitching(false);
    }
  };

  const toggleFoodMode = async (turningOn) => {
    if (switching) return;

    if (!deliveryEnabled) {
      toast.error("Complete onboarding to enable delivery.");
      return;
    }
    if (deliveryEnabled && !deliveryApproved) {
      toast.info("Delivery profile is pending admin approval.");
      return;
    }

    if (turningOn) {
      await applyMode("food");
      return;
    }

    if (mode === "food") {
      await applyMode("off");
    }
  };

  const handleLogout = () => {
    clearModuleAuth("driver");
    clearModuleAuth("delivery");
    clearIdentitySession();
    ["driverToken", "token", "driverInfo", "role", "driverRole", "chatRole"].forEach((k) =>
      localStorage.removeItem(k),
    );
    navigate("/driver/login", { replace: true });
  };

  if (bootLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-900">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const isOffline = mode === "off";
  const foodActive = mode === "food";

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-['Poppins']">
      <div className="max-w-md mx-auto p-5 pb-24">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="uppercase text-[10px] text-green-600 font-bold tracking-[0.25em]">
              Buddy Partner
            </p>
            <h1 className="text-gray-900 text-2xl font-black mt-1">
              {identity?.name ? `Hi, ${identity.name.split(" ")[0]}` : "Welcome back"}
            </h1>
            <p className="text-gray-500 text-[12px] font-medium">+91 {identity?.phone || "—"}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-10 h-10 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-gray-500 hover:text-gray-900 shadow-sm"
            aria-label="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        <div className="rounded-3xl bg-white border border-gray-100 shadow-sm p-5 mb-5">
          <p className="text-[12px] uppercase tracking-widest font-bold text-green-600 mb-3">
            Service status
          </p>
          <div className="space-y-2">
            {SERVICE_STATUS_CARDS.map(({ key, label, Icon, accent }) => {
              const status = capabilities?.[key] || "not_enabled";
              const rejected = status === "rejected";
              const approved = status === "approved" || status === "enabled" || status === "active";
              const pending = status === "pending";
              const notEnabled = status === "not_enabled";
              const reason = rejection?.[key]?.reason;
              return (
                <div key={key} className="rounded-2xl border border-gray-100 bg-gray-50 p-3 flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center shrink-0 ${accent}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-[13px]">{label}</span>
                      {approved ? (
                        <span className="text-[10px] uppercase tracking-widest text-green-600">Approved</span>
                      ) : pending ? (
                        <span className="text-[10px] uppercase tracking-widest text-amber-400">Pending</span>
                      ) : rejected ? (
                        <span className="text-[10px] uppercase tracking-widest text-red-400">Rejected</span>
                      ) : notEnabled ? (
                        <span className="text-[10px] uppercase tracking-widest text-gray-500">Not selected</span>
                      ) : null}
                    </div>
                    {rejected && reason ? (
                      <p className="text-[12px] text-red-200/90 mt-1 leading-relaxed">{reason}</p>
                    ) : null}
                    {rejected && resubmitAllowed ? (
                      <button
                        type="button"
                        onClick={() => navigate("/driver/onboarding")}
                        className="mt-2 text-[11px] font-bold text-red-300 underline"
                      >
                        Edit & Resubmit
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {anyRejected && resubmitAllowed ? (
          <div className="rounded-3xl border border-red-500/30 bg-red-500/10 p-5 mb-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5 text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] uppercase tracking-widest font-bold text-red-300">
                  Action required
                </p>
                <p className="text-gray-900 font-bold text-[15px] mt-1">
                  One or more services were rejected
                </p>
                <p className="text-[13px] text-red-100/70 mt-2">
                  Update the rejected service details and resubmit for admin review.
                </p>
                <button
                  type="button"
                  onClick={() => navigate("/driver/onboarding")}
                  className="mt-4 w-full sm:w-auto h-11 px-5 rounded-2xl bg-red-500 hover:bg-red-600 text-white font-extrabold text-[13px] flex items-center justify-center gap-2 transition-colors active:scale-[0.98]"
                >
                  <Pencil className="w-4 h-4" />
                  Edit & Resubmit
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="rounded-3xl bg-white border border-gray-100 shadow-sm p-5 mb-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-green-600" />
              <span className="text-[12px] uppercase tracking-widest font-bold text-green-600">
                Delivery Mode
              </span>
            </div>
            <span
              className={[
                "text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full",
                isOffline
                  ? "bg-gray-100 text-gray-500"
                  : "bg-green-100 text-green-600",
              ].join(" ")}
            >
              {isOffline ? "Offline" : "Food Active"}
            </span>
          </div>
          <p className="text-[13px] text-gray-500 mb-4 leading-relaxed">
            Turn on delivery mode to receive food orders.
          </p>

          <div
            className={[
              "rounded-2xl border p-4 flex items-center gap-3 transition-all",
              foodActive ? "bg-green-50 border-green-500/30" : "bg-gray-50 border-gray-100",
              !deliveryEnabled ? "opacity-60" : "",
            ].join(" ")}
          >
            <div className="w-11 h-11 rounded-xl bg-gray-50 flex items-center justify-center shrink-0 text-orange-400">
              <Bike className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-[14px] flex items-center gap-2 flex-wrap">
                Food Delivery
                {deliveryEnabled && !deliveryApproved && !foodRejected && (
                  <span className="text-[10px] uppercase tracking-widest text-amber-400">Pending</span>
                )}
                {foodRejected && (
                  <span className="text-[10px] uppercase tracking-widest text-red-400">Rejected</span>
                )}
                {!deliveryEnabled && (
                  <span className="text-[10px] uppercase tracking-widest text-gray-500">Not Enrolled</span>
                )}
              </div>
              <div className="text-gray-400 text-[12px] mt-0.5">
                Restaurant orders
              </div>
            </div>
            <label className="relative inline-flex items-center shrink-0 cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={foodActive}
                disabled={!deliveryEnabled || (deliveryEnabled && !deliveryApproved) || foodRejected || switching}
                onChange={(e) => toggleFoodMode(e.target.checked)}
              />
              <div
                className={[
                  "w-12 h-7 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-green-600/40",
                  !deliveryEnabled || switching ? "bg-white/10 cursor-not-allowed" : "bg-gray-200 peer-checked:bg-green-600",
                ].join(" ")}
              />
              <div
                className={[
                  "absolute left-0.5 top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform",
                  foodActive ? "translate-x-5" : "translate-x-0",
                  switching ? "opacity-60" : "",
                ].join(" ")}
              />
            </label>
          </div>

          {deliveryEnabled && deliveryApproved && !foodRejected && (
            <div className="mt-3 rounded-2xl border border-gray-100 bg-gray-50 p-3">
              <div className="text-[11px] uppercase tracking-widest text-gray-400 font-bold">
                Jobs you want
              </div>
              <div className="flex items-center gap-2 mt-2">
                {[
                  { id: "food", label: "Food" },
                  { id: "quickCommerce", label: "Quick Commerce" },
                ].map((svc) => {
                  // No saved choice yet = taking everything, so show both as on.
                  const selected = !services || services.includes(svc.id);
                  return (
                    <button
                      key={svc.id}
                      type="button"
                      disabled={switching}
                      onClick={() => {
                        const current = services || ["food", "quickCommerce"];
                        const next = current.includes(svc.id)
                          ? current.filter((s) => s !== svc.id)
                          : [...current, svc.id];
                        if (!next.length) {
                          toast.error("Pick at least one kind of job");
                          return;
                        }
                        setServices(next);
                        // Persist straight away only while online; otherwise it rides along on go-online.
                        if (foodActive) applyMode("food", next);
                      }}
                      className={[
                        "px-3 py-1.5 rounded-xl text-[12px] font-bold border transition-colors",
                        selected
                          ? "bg-green-50 border-green-500/40 text-green-700"
                          : "bg-white border-gray-200 text-gray-400",
                        switching ? "opacity-60" : "",
                      ].join(" ")}
                    >
                      {svc.label}
                    </button>
                  );
                })}
              </div>
              <div className="text-gray-400 text-[11px] mt-2">
                Quick Commerce needs its own admin approval.
              </div>
            </div>
          )}

          {switching && (
            <div className="flex items-center justify-center gap-2 mt-4 text-[12px] text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Updating delivery mode…
            </div>
          )}
        </div>

        <CapabilityCard
          Icon={Bike}
          title="Food Delivery"
          status={capabilities.food}
          enabled={deliveryEnabled}
          href="/food/delivery"
        />
      </div>
    </div>
  );
}

function CapabilityCard({ Icon, title, status, enabled, href }) {
  const normalized = String(status || "").toLowerCase();
  const label = !enabled
    ? "Not enrolled"
    : normalized === "rejected"
      ? "Rejected"
      : String(status || "active").replace(/_/g, " ");
  const isReady = enabled && (normalized === "approved" || normalized === "enabled" || normalized === "active");
  const isPending = enabled && !isReady && normalized !== "rejected";
  const isRejected = enabled && normalized === "rejected";
  const target = !enabled || isRejected ? null : isPending ? "/driver/home" : href;

  const className = [
    "block rounded-2xl border p-4 transition-all",
    isReady
      ? "bg-green-50 border-green-500/30"
      : isRejected
        ? "bg-red-500/10 border-red-500/30"
        : "bg-gray-50 border-gray-100",
    !enabled ? "opacity-70" : "",
  ].join(" ");

  const content = (
    <>
      <Icon className={["w-5 h-5 mb-2", isReady ? "text-green-600" : "text-gray-500"].join(" ")} />
      <div className="text-gray-900 font-bold text-[13px]">{title}</div>
      <div className="text-[11px] text-gray-500 mt-1 capitalize">{label}</div>
    </>
  );

  if (!target) {
    return <div className={className}>{content}</div>;
  }

  return (
    <Link to={target} className={className}>
      {content}
    </Link>
  );
}
