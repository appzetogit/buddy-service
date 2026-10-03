import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  ChevronRight,
  Bike,
  Banknote,
  IdCard,
  User,
  Camera,
  Loader2,
  UploadCloud,
  ImagePlus,
  ShieldCheck,
  AlertCircle,
  LogOut,
} from "lucide-react";
import { toast } from "sonner";

import {
  driverOnboardingAPI,
  getApiErrorMessage,
  uploadAPI,
  clearIdentitySession,
} from "@food/api";
import { clearModuleAuth } from "@food/utils/auth";
import { invalidateDriverGuardCache } from "../components/DriverGuard";
import DriverPageLoader from "../components/DriverPageLoader";
import {
  FIELD_LIMITS,
  prepareOnboardingStepState,
  STEP_MEDIA_PATHS,
  setByPath,
  validateOnboardingImageFile,
  validateOnboardingStep,
} from "../utils/onboardingValidation";

const buildSteps = (services = [], resubmitServices = null) => {
  const steps = [];
  const needsFoodVehicle = services.includes("food");

  if (!resubmitServices) {
    steps.push({ key: "services", label: "Services", Icon: CheckCircle2 });
  }
  if (needsFoodVehicle && (!resubmitServices || resubmitServices.some((s) => s === "food"))) {
    steps.push({ key: "vehicle_food", label: "Delivery", Icon: Bike });
  }
  if (!resubmitServices) {
    steps.push(
      { key: "basics", label: "About You", Icon: User },
      { key: "kyc", label: "KYC", Icon: IdCard },
      { key: "bank", label: "Bank", Icon: Banknote },
    );
  }
  steps.push({ key: "selfie", label: resubmitServices ? "Submit" : "Selfie", Icon: Camera });
  return steps;
};

const STEP_META = {
  services: {
    title: "What do you want to drive for?",
    subtitle: "Your food delivery profile.",
  },
  vehicle_food: {
    title: "Delivery vehicle",
    subtitle: "Used for food deliveries.",
  },
  basics: {
    title: "Tell us about yourself",
    subtitle: "We need your legal name for verification and payouts.",
  },
  kyc: {
    title: "Identity verification",
    subtitle: "Upload clear photos of your ID documents. All data is encrypted.",
  },
  bank: {
    title: "Payout details",
    subtitle: "Add a bank account or UPI ID to receive your earnings.",
  },
  selfie: {
    title: "Take a selfie",
    subtitle: "A quick face photo speeds up approval. Use good lighting.",
  },
};

const FOOD_VEHICLE_TYPES = [
  { value: "bike", label: "Bike", Icon: Bike },
  { value: "scooter", label: "Scooter", Icon: Bike },
];

const resolveStepIndex = (onboardingStep, steps) => {
  const normalized = String(onboardingStep || "services").toLowerCase();
  const stepKey = normalized === "capabilities" ? "services" : normalized;
  if (stepKey === "done") return Math.max(steps.length - 1, 0);
  const idx = steps.findIndex((s) => s.key === stepKey);
  return idx >= 0 ? idx : 0;
};

export default function OnboardingWizard() {
  const navigate = useNavigate();
  const scrollRef = useRef(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [furthestIdx, setFurthestIdx] = useState(0);
  const [bankMode, setBankMode] = useState("bank");

  const [state, setState] = useState({
    onboardingServices: [],
    foodVehicle: { type: "bike", number: "", make: "", model: "", color: "", photoUrl: "", rcUrl: "", insuranceUrl: "" },
    basics: { name: "", email: "", gender: "", city: "", state: "" },
    kyc: {
      aadhaar: { number: "", documentUrl: "", backDocumentUrl: "" },
      pan: { number: "", documentUrl: "" },
      drivingLicense: { number: "", documentUrl: "" },
    },
    bank: {
      accountHolderName: "",
      accountNumber: "",
      ifscCode: "",
      bankName: "",
      branchName: "",
      upiId: "",
      upiQrCodeUrl: "",
    },
    selfie: { selfieUrl: "" },
  });

  const [touched, setTouched] = useState({});
  const [errors, setErrors] = useState({});
  const [bootLoading, setBootLoading] = useState(true);
  const [stepLoading, setStepLoading] = useState(false);
  const [pendingUploads, setPendingUploads] = useState({});
  const [resubmitMode, setResubmitMode] = useState(false);
  const [rejectedServices, setRejectedServices] = useState([]);

  useEffect(() => {
    let cancelled = false;
    driverOnboardingAPI
      .getState()
      .then((res) => {
        if (cancelled) return;
        const data = res?.data?.data || res?.data || {};

        if (data?.onboardingLocked) {
          navigate("/driver/home", { replace: true });
          return;
        }

        if (data?.onboardingComplete && !data?.resubmitAllowed) {
          navigate("/driver/home", { replace: true });
          return;
        }

        setResubmitMode(Boolean(data?.resubmitAllowed));
        setRejectedServices(
          Array.isArray(data?.rejectedServices)
            ? data.rejectedServices
            : [],
        );

        const services = (Array.isArray(data?.onboardingServices) ? data.onboardingServices : [])
          .filter((service) => service !== "taxi");
        const steps = buildSteps(services, data?.resubmitAllowed ? data.rejectedServices || [] : null);
        const stepIdx = data?.resubmitAllowed
          ? 0
          : resolveStepIndex(data?.onboardingStep, steps);
        setActiveIdx(stepIdx);
        setFurthestIdx(stepIdx);

        const hasUpi = Boolean(data?.bank?.upiId);
        const hasBank = Boolean(data?.bank?.accountNumber || data?.bank?.ifscCode);
        if (hasUpi && !hasBank) setBankMode("upi");

        const legacyVehicle = data?.vehicle || {};
        const foodVehicle = data?.foodVehicle?.number
          ? data.foodVehicle
          : { type: legacyVehicle.type || "bike", number: legacyVehicle.number || "" };

        setState((prev) => ({
          ...prev,
          onboardingServices: services,
          foodVehicle: {
            type: foodVehicle.type || "bike",
            number: foodVehicle.number || "",
            make: foodVehicle.make || "",
            model: foodVehicle.model || "",
            color: foodVehicle.color || "",
            photoUrl: foodVehicle.photoUrl || "",
            rcUrl: foodVehicle.rcUrl || "",
            insuranceUrl: foodVehicle.insuranceUrl || "",
          },
          basics: {
            name: data?.basics?.name || prev.basics.name,
            email: data?.basics?.email || prev.basics.email,
            gender: data?.basics?.gender || prev.basics.gender,
            city: data?.basics?.city || prev.basics.city,
            state: data?.basics?.state || prev.basics.state,
          },
          kyc: {
            aadhaar: {
              number: data?.kyc?.aadhaar?.number || "",
              documentUrl: data?.kyc?.aadhaar?.documentUrl || "",
              backDocumentUrl: data?.kyc?.aadhaar?.backDocumentUrl || "",
            },
            pan: {
              number: data?.kyc?.pan?.number || "",
              documentUrl: data?.kyc?.pan?.documentUrl || "",
            },
            drivingLicense: {
              number: data?.kyc?.drivingLicense?.number || "",
              documentUrl: data?.kyc?.drivingLicense?.documentUrl || "",
            },
          },
          bank: {
            accountHolderName: data?.bank?.accountHolderName || "",
            accountNumber: data?.bank?.accountNumber || "",
            ifscCode: data?.bank?.ifscCode || "",
            bankName: data?.bank?.bankName || "",
            branchName: data?.bank?.branchName || "",
            upiId: data?.bank?.upiId || "",
            upiQrCodeUrl: data?.bank?.upiQrCodeUrl || "",
          },
          selfie: { selfieUrl: data?.selfieUrl || "" },
        }));
      })
      .catch((err) => {
        const status = err?.response?.status;
        if (status === 401 || status === 403) {
          navigate("/driver/login", { replace: true });
        }
      })
      .finally(() => {
        if (!cancelled) setBootLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeIdx]);

  const steps = useMemo(
    () => buildSteps(state.onboardingServices, resubmitMode ? rejectedServices : null),
    [state.onboardingServices, resubmitMode, rejectedServices],
  );

  useEffect(() => {
    setActiveIdx((idx) => Math.min(idx, Math.max(steps.length - 1, 0)));
    setFurthestIdx((idx) => Math.min(idx, Math.max(steps.length - 1, 0)));
  }, [steps.length]);

  const current = steps[activeIdx] ?? steps[0] ?? { key: "services", label: "Services", Icon: CheckCircle2 };
  const meta = STEP_META[current.key] || STEP_META.services;
  const progressPct = Math.round(((activeIdx + 1) / steps.length) * 100);

  const validateStep = (stepKey) => validateOnboardingStep(state, stepKey, { bankMode });

  const stepErrors = useMemo(() => validateStep(current.key), [current.key, state, bankMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const showErr = (path) => (touched[path] ? stepErrors[path] || errors[path] || "" : "");

  const markTouched = (path) =>
    setTouched((prev) => ({ ...prev, [path]: true }));

  const setField = (path, value) => {
    setState((prev) => setByPath(prev, path, value));
  };

  const goToStep = (idx) => {
    if (stepLoading || idx < 0 || idx > furthestIdx || idx === activeIdx) return;
    setActiveIdx(idx);
  };

  const persistAndAdvance = async (apiCall, payload) => {
    setStepLoading(true);
    try {
      await apiCall(payload);
      toast.success("Saved");
      const nextIdx = Math.min(activeIdx + 1, steps.length - 1);
      setFurthestIdx((prev) => Math.max(prev, nextIdx));
      setActiveIdx(nextIdx);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not save"));
    } finally {
      setStepLoading(false);
    }
  };

  const handleUploadChange = (path, url, file) => {
    setField(path, url);
    markTouched(path);
    if (file) {
      setPendingUploads((prev) => ({ ...prev, [path]: file }));
    } else {
      setPendingUploads((prev) => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
    }
  };

  const handleNext = async () => {
    const freshErrors = validateStep(current.key);

    setTouched((prev) => {
      const next = { ...prev };
      Object.keys(freshErrors).forEach((p) => {
        next[p] = true;
      });
      return next;
    });

    if (Object.keys(freshErrors).length > 0) {
      const firstMsg = Object.values(freshErrors)[0] || "Please fix the highlighted fields";
      toast.error(firstMsg);
      return;
    }

    let finalState = { ...state };
    const stepMediaPaths = STEP_MEDIA_PATHS[current.key] || [];
    const hasStepMedia = stepMediaPaths.length > 0;

    if (hasStepMedia) {
      setStepLoading(true);
      try {
        finalState = await prepareOnboardingStepState(
          finalState,
          current.key,
          pendingUploads,
          uploadAPI.uploadMedia,
        );
        setState(finalState);
        setPendingUploads((prev) => {
          const next = { ...prev };
          stepMediaPaths.forEach((path) => {
            delete next[path];
          });
          Object.keys(next).forEach((path) => {
            if (path.startsWith(`${current.key}.`)) delete next[path];
          });
          return next;
        });
      } catch (err) {
        toast.error(err.message || "Failed to upload files. Please try again.");
        setStepLoading(false);
        return;
      }
      setStepLoading(false);
    }

    if (current.key === "services") {
      await persistAndAdvance(driverOnboardingAPI.saveServices, finalState.onboardingServices);
    } else if (current.key === "vehicle_food") {
      await persistAndAdvance(driverOnboardingAPI.saveFoodVehicle, {
        type: finalState.foodVehicle.type,
        number: finalState.foodVehicle.number,
        make: finalState.foodVehicle.make,
        model: finalState.foodVehicle.model,
      });
    } else if (current.key === "basics") {
      await persistAndAdvance(driverOnboardingAPI.saveBasics, finalState.basics);
    } else if (current.key === "kyc") {
      await persistAndAdvance(driverOnboardingAPI.saveKyc, {
        aadhaar: {
          number: finalState.kyc.aadhaar.number,
          documentUrl: finalState.kyc.aadhaar.documentUrl,
          backDocumentUrl: finalState.kyc.aadhaar.backDocumentUrl || "",
        },
        pan: finalState.kyc.pan.number
          ? {
            number: finalState.kyc.pan.number,
            documentUrl: finalState.kyc.pan.documentUrl,
          }
          : undefined,
        drivingLicense: {
          number: finalState.kyc.drivingLicense.number,
          documentUrl: finalState.kyc.drivingLicense.documentUrl,
        },
      });
    } else if (current.key === "bank") {
      const bankPayload =
        bankMode === "upi"
          ? { upiId: finalState.bank.upiId }
          : {
            accountHolderName: finalState.bank.accountHolderName,
            accountNumber: finalState.bank.accountNumber,
            ifscCode: finalState.bank.ifscCode,
            bankName: finalState.bank.bankName,
            branchName: finalState.bank.branchName,
          };
      await persistAndAdvance(driverOnboardingAPI.saveBank, bankPayload);
    } else if (current.key === "selfie") {
      setStepLoading(true);
      try {
        await driverOnboardingAPI.saveSelfie({ selfieUrl: finalState.selfie.selfieUrl });
        const completeRes = await driverOnboardingAPI.complete(finalState.onboardingServices);
        const wasResubmit = Boolean(
          completeRes?.data?.data?.resubmitted ?? completeRes?.data?.resubmitted,
        );
        invalidateDriverGuardCache();
        toast.success(
          wasResubmit || resubmitMode
            ? "Application resubmitted for approval"
            : "Onboarding submitted for approval",
        );
        navigate("/driver/home", { replace: true });
      } catch (err) {
        toast.error(getApiErrorMessage(err, "Could not submit"));
      } finally {
        setStepLoading(false);
      }
    }
  };

  const handleBack = () => {
    if (stepLoading) return;
    setActiveIdx((idx) => Math.max(0, idx - 1));
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
    return <DriverPageLoader label="Loading your progress…" />;
  }

  return (
    <div className="h-[100dvh] bg-gray-50 text-gray-900 font-['Poppins'] flex flex-col overflow-hidden sm:items-center sm:justify-center sm:p-4">
      <div className="w-full max-w-md mx-auto flex flex-col h-full sm:h-[min(90dvh,900px)] sm:rounded-3xl sm:shadow-2xl sm:overflow-hidden sm:border sm:border-gray-100">
        {/* Header — sticky */}
        <div className="sticky top-0 z-20 shrink-0 bg-gradient-to-br from-green-600 via-green-700 to-green-800 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] text-green-200 font-bold uppercase tracking-[0.2em]">
              {resubmitMode ? "Update & Resubmit" : "Partner Onboarding"}
            </p>
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-bold text-gray-500 bg-white px-2.5 py-1 rounded-full">
                {activeIdx + 1}/{steps.length}
              </span>
              <button
                onClick={handleLogout}
                className="w-7 h-7 rounded-full bg-white hover:bg-white flex items-center justify-center transition-colors text-red-500"
                title="Logout"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="h-1.5 bg-gray-50 rounded-full overflow-hidden mb-4">
            <motion.div
              className="h-full bg-white rounded-full"
              initial={false}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.35, ease: "easeOut" }}
            />
          </div>

          <div className="flex gap-1 mb-4 overflow-x-auto no-scrollbar pb-0.5">
            {steps.map((s, idx) => {
              const done = idx < activeIdx;
              const active = idx === activeIdx;
              const reachable = idx <= furthestIdx;
              return (
                <button
                  key={s.key}
                  type="button"
                  disabled={!reachable || stepLoading}
                  onClick={() => goToStep(idx)}
                  className={[
                    "flex-1 min-w-0 py-1.5 px-1 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-all truncate",
                    active
                      ? "bg-white text-green-700"
                      : done
                        ? "bg-white/20 text-gray-900 hover:bg-gray-100"
                        : reachable
                          ? "bg-gray-50 text-gray-600 hover:bg-white/20"
                          : "bg-white shadow-sm text-gray-400 cursor-not-allowed",
                  ].join(" ")}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          <h2 className="text-xl font-black tracking-tight">{meta.title}</h2>
          <p className="text-[13px] text-green-50 mt-1 leading-relaxed">{meta.subtitle}</p>
          {resubmitMode ? (
            <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-500/20 px-3 py-2 text-[12px] font-medium text-amber-50">
              Update the fields flagged by admin, then submit again. Your existing application will be
              updated — no new account is created.
            </p>
          ) : null}
        </div>

        {/* Step body — scrollable middle */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain p-5 space-y-4 bg-gray-50">
          <AnimatePresence mode="wait">
            <motion.div
              key={current.key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              {current.key === "services" && (
                <>
                  <ServiceToggle
                    checked={state.onboardingServices.includes("food")}
                    onChange={(checked) => {
                      markTouched("onboardingServices");
                      setState((s) => ({
                        ...s,
                        onboardingServices: checked
                          ? Array.from(new Set([...s.onboardingServices, "food"]))
                          : s.onboardingServices.filter((x) => x !== "food"),
                      }));
                    }}
                    Icon={Bike}
                    title="Food Delivery"
                    subtitle="Deliver restaurant orders"
                  />
                  {showErr("onboardingServices") ? (
                    <p className="text-[11px] font-semibold text-red-400">{showErr("onboardingServices")}</p>
                  ) : null}
                  <div className="rounded-2xl bg-white shadow-sm border border-gray-200 p-3 text-[11px] text-gray-400 leading-relaxed">
                    You'll receive food delivery requests when online.
                  </div>
                </>
              )}

              {current.key === "vehicle_food" && (
                <>
                  <div>
                    <label className="text-[11px] text-gray-400 font-bold uppercase tracking-widest mb-2 block">
                      Vehicle Type <span className="text-red-400">*</span>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {FOOD_VEHICLE_TYPES.map(({ value, label, Icon }) => {
                        const selected = state.foodVehicle.type === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => {
                              setField("foodVehicle.type", value);
                              markTouched("foodVehicle.type");
                            }}
                            className={[
                              "flex flex-col items-center gap-1.5 p-4 rounded-xl border transition-all",
                              selected
                                ? "bg-green-600/15 border-green-600 text-gray-900"
                                : "bg-white shadow-sm border-gray-200 text-gray-400 hover:border-gray-200",
                            ].join(" ")}
                          >
                            <Icon className={["w-6 h-6", selected ? "text-green-600" : ""].join(" ")} />
                            <span className="text-[12px] font-bold">{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <Field
                    label="Vehicle Number"
                    required
                    value={state.foodVehicle.number}
                    onChange={(v) => setField("foodVehicle.number", v.toUpperCase().replace(/\s+/g, "").slice(0, FIELD_LIMITS.vehicleNumber))}
                    onBlur={() => markTouched("foodVehicle.number")}
                    error={showErr("foodVehicle.number")}
                    placeholder="MH12AB1234"
                  />
                  <Field
                    label="Make / Brand"
                    required
                    value={state.foodVehicle.make}
                    onChange={(v) => setField("foodVehicle.make", v.slice(0, FIELD_LIMITS.vehicleMake))}
                    onBlur={() => markTouched("foodVehicle.make")}
                    error={showErr("foodVehicle.make")}
                    placeholder="e.g. Honda, Hero"
                  />
                  <Field
                    label="Model"
                    required
                    value={state.foodVehicle.model}
                    onChange={(v) => setField("foodVehicle.model", v.slice(0, FIELD_LIMITS.vehicleModel))}
                    onBlur={() => markTouched("foodVehicle.model")}
                    error={showErr("foodVehicle.model")}
                    placeholder="e.g. Activa, Splendor"
                  />
                </>
              )}

              {current.key === "basics" && (
                <>
                  <Field
                    label="Full Name"
                    required
                    value={state.basics.name}
                    onChange={(v) => setField("basics.name", v.slice(0, FIELD_LIMITS.name))}
                    onBlur={() => markTouched("basics.name")}
                    error={showErr("basics.name")}
                    placeholder="As per government ID"
                  />
                  <Field
                    label="Email"
                    value={state.basics.email}
                    onChange={(v) => setField("basics.email", v.trimStart().slice(0, FIELD_LIMITS.email))}
                    onBlur={() => markTouched("basics.email")}
                    error={showErr("basics.email")}
                    placeholder="you@example.com (optional)"
                    type="email"
                  />
                  <Select
                    label="Gender"
                    value={state.basics.gender}
                    onChange={(v) => setField("basics.gender", v)}
                    options={[
                      { value: "", label: "Prefer not to say" },
                      { value: "male", label: "Male" },
                      { value: "female", label: "Female" },
                      { value: "other", label: "Other" },
                    ]}
                  />
                  <Field
                    label="City"
                    value={state.basics.city}
                    onChange={(v) => setField("basics.city", v.slice(0, FIELD_LIMITS.city))}
                    placeholder="e.g. Indore (optional)"
                  />
                  <Field
                    label="State"
                    required
                    value={state.basics.state}
                    onChange={(v) => setField("basics.state", v.slice(0, FIELD_LIMITS.state))}
                    onBlur={() => markTouched("basics.state")}
                    error={showErr("basics.state")}
                    placeholder="e.g. Madhya Pradesh"
                  />
                </>
              )}

              {current.key === "kyc" && (
                <>
                  <SectionCard title="Aadhaar" required>
                    <Field
                      label="Aadhaar Number"
                      required
                      value={formatAadhaar(state.kyc.aadhaar.number)}
                      onChange={(v) => setField("kyc.aadhaar.number", v.replace(/\D/g, "").slice(0, 12))}
                      onBlur={() => markTouched("kyc.aadhaar.number")}
                      error={showErr("kyc.aadhaar.number")}
                      placeholder="XXXX XXXX XXXX"
                      inputMode="numeric"
                    />
                    <DocumentUpload
                      label="Aadhaar front photo"
                      hint="Clear photo of the front side"
                      value={state.kyc.aadhaar.documentUrl}
                      onChange={(url, file) => handleUploadChange("kyc.aadhaar.documentUrl", url, file)}
                      error={showErr("kyc.aadhaar.documentUrl")}
                    />
                    <DocumentUpload
                      label="Aadhaar back photo"
                      hint="Optional but recommended"
                      value={state.kyc.aadhaar.backDocumentUrl}
                      onChange={(url, file) => handleUploadChange("kyc.aadhaar.backDocumentUrl", url, file)}
                      optional
                    />
                  </SectionCard>

                  <SectionCard title="Driving Licence" required>
                    <Field
                      label="Licence Number"
                      required
                      value={state.kyc.drivingLicense.number}
                      onChange={(v) => setField("kyc.drivingLicense.number", v.toUpperCase().slice(0, FIELD_LIMITS.dl))}
                      onBlur={() => markTouched("kyc.drivingLicense.number")}
                      error={showErr("kyc.drivingLicense.number")}
                      placeholder="e.g. MH12 20230012345"
                    />
                    <DocumentUpload
                      label="Licence photo"
                      hint="Front side of your driving licence"
                      value={state.kyc.drivingLicense.documentUrl}
                      onChange={(url, file) => handleUploadChange("kyc.drivingLicense.documentUrl", url, file)}
                      error={showErr("kyc.drivingLicense.documentUrl")}
                    />
                  </SectionCard>

                  <SectionCard title="PAN Card" optional>
                    <Field
                      label="PAN Number"
                      value={state.kyc.pan.number}
                      onChange={(v) => setField("kyc.pan.number", v.toUpperCase().replace(/\s+/g, "").slice(0, 10))}
                      onBlur={() => markTouched("kyc.pan.number")}
                      error={showErr("kyc.pan.number")}
                      placeholder="ABCDE1234F"
                    />
                    <DocumentUpload
                      label="PAN photo"
                      value={state.kyc.pan.documentUrl}
                      onChange={(url, file) => handleUploadChange("kyc.pan.documentUrl", url, file)}
                      error={showErr("kyc.pan.documentUrl")}
                      optional
                    />
                  </SectionCard>
                </>
              )}

              {current.key === "bank" && (
                <>
                  <div className="flex rounded-xl bg-white shadow-sm p-1 border border-gray-200">
                    {[
                      { key: "bank", label: "Bank Account" },
                      { key: "upi", label: "UPI ID" },
                    ].map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => {
                          setBankMode(tab.key);
                          markTouched("bank.mode");
                        }}
                        className={[
                          "flex-1 py-2.5 rounded-lg text-[12px] font-bold transition-all",
                          bankMode === tab.key
                            ? "bg-green-600 text-white shadow-sm"
                            : "text-gray-400 hover:text-gray-600",
                        ].join(" ")}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {showErr("bank.mode") && (
                    <div className="flex items-center gap-2 text-[12px] font-semibold text-red-400 bg-red-400/10 border border-red-400/20 rounded-xl px-3 py-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      {showErr("bank.mode")}
                    </div>
                  )}

                  {bankMode === "bank" ? (
                    <SectionCard title="Bank account details">
                      <Field
                        label="Account Holder Name"
                        value={state.bank.accountHolderName}
                        onChange={(v) => setField("bank.accountHolderName", v.slice(0, FIELD_LIMITS.accountHolderName))}
                        onBlur={() => markTouched("bank.accountHolderName")}
                        error={showErr("bank.accountHolderName")}
                        placeholder="As per bank passbook"
                      />
                      <Field
                        label="Account Number"
                        value={state.bank.accountNumber}
                        onChange={(v) => setField("bank.accountNumber", v.replace(/\D/g, "").slice(0, FIELD_LIMITS.accountNumber))}
                        onBlur={() => {
                          markTouched("bank.accountNumber");
                          markTouched("bank.mode");
                        }}
                        error={showErr("bank.accountNumber")}
                        placeholder="Numbers only"
                        inputMode="numeric"
                      />
                      <Field
                        label="IFSC Code"
                        value={state.bank.ifscCode}
                        onChange={(v) => setField("bank.ifscCode", v.toUpperCase().replace(/\s+/g, "").slice(0, 11))}
                        onBlur={() => {
                          markTouched("bank.ifscCode");
                          markTouched("bank.mode");
                        }}
                        error={showErr("bank.ifscCode")}
                        placeholder="HDFC0001234"
                      />
                      <Field
                        label="Bank Name"
                        value={state.bank.bankName}
                        onChange={(v) => setField("bank.bankName", v.slice(0, FIELD_LIMITS.bankName))}
                        placeholder="e.g. HDFC Bank (optional)"
                      />
                    </SectionCard>
                  ) : (
                    <SectionCard title="UPI details">
                      <Field
                        label="UPI ID"
                        value={state.bank.upiId}
                        onChange={(v) => setField("bank.upiId", v.trim().slice(0, FIELD_LIMITS.upiId))}
                        onBlur={() => {
                          markTouched("bank.upiId");
                          markTouched("bank.mode");
                        }}
                        error={showErr("bank.upiId")}
                        placeholder="yourname@bank"
                      />
                      <p className="text-[11px] text-gray-400 leading-relaxed">
                        Earnings will be sent to this UPI ID. Make sure it is active.
                      </p>
                    </SectionCard>
                  )}
                </>
              )}

              {current.key === "selfie" && (
                <>
                  <DocumentUpload
                    label="Your selfie"
                    hint="Face the camera in good lighting. Hold your ID if possible."
                    value={state.selfie.selfieUrl}
                    onChange={(url, file) => handleUploadChange("selfie.selfieUrl", url, file)}
                    error={showErr("selfie.selfieUrl")}
                    capture="user"
                    variant="selfie"
                  />
                  <div className="flex items-start gap-2.5 rounded-xl bg-green-600/5 border border-green-600/20 p-3">
                    <ShieldCheck className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-[#cfe3c6] leading-relaxed">
                      Your photo is only used for identity verification and is never shared publicly.
                    </p>
                  </div>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer actions — sticky */}
        <div className="sticky bottom-0 z-20 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] bg-gray-50 border-t border-gray-100 flex gap-3 shrink-0">
          <button
            type="button"
            onClick={handleBack}
            disabled={activeIdx === 0 || stepLoading}
            className="flex-1 h-12 rounded-2xl bg-white shadow-sm border border-gray-200 text-gray-900/80 disabled:text-gray-900/25 font-bold disabled:bg-transparent transition-colors"
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleNext}
            disabled={stepLoading || Object.keys(stepErrors).length > 0}
            className="flex-[2] h-12 rounded-2xl bg-green-600 hover:bg-green-700 disabled:bg-gray-50 disabled:text-gray-300 text-white font-extrabold flex items-center justify-center gap-2 transition-colors active:scale-[0.98]"
          >
            {stepLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <span>{activeIdx === steps.length - 1 ? (resubmitMode ? "Resubmit for Approval" : "Submit for Approval") : "Save & Continue"}</span>
                <ChevronRight className="w-5 h-5" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- helpers -------------------------------- */

function formatAadhaar(digits) {
  const clean = String(digits || "").replace(/\D/g, "");
  return clean.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

function Field({ label, value, onChange, onBlur, placeholder, type = "text", inputMode, error, required: isRequired, maxLength }) {
  const invalid = Boolean(error);
  return (
    <div>
      <label className="text-[11px] text-gray-400 font-bold uppercase tracking-widest mb-1.5 block">
        {label}
        {isRequired && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      <input
        type={type}
        inputMode={inputMode}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={invalid}
        className={[
          "w-full h-12 bg-white shadow-sm rounded-xl px-4 text-gray-900 font-semibold outline-none placeholder:text-gray-300 transition-colors",
          invalid
            ? "border border-red-400 focus:ring-2 focus:ring-red-400/30"
            : "border border-gray-200 focus:border-green-600 focus:ring-2 focus:ring-[#88c170]/20",
        ].join(" ")}
      />
      {invalid && (
        <p className="text-[11px] font-semibold text-red-400 mt-1.5">{error}</p>
      )}
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <div>
      <label className="text-[11px] text-gray-400 font-bold uppercase tracking-widest mb-1.5 block">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-12 bg-white shadow-sm border border-gray-200 rounded-xl px-4 text-gray-900 font-semibold outline-none focus:border-green-600"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-gray-50">
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function SectionCard({ title, required: isRequired, optional, children }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-bold text-gray-900">{title}</h3>
        {isRequired && <span className="text-[9px] font-bold uppercase tracking-wider text-green-600 bg-green-600/10 px-1.5 py-0.5 rounded">Required</span>}
        {optional && <span className="text-[9px] font-bold uppercase tracking-wider text-gray-300">Optional</span>}
      </div>
      {children}
    </div>
  );
}

function DocumentUpload({
  label,
  hint,
  value,
  onChange,
  error,
  optional,
  capture,
  variant = "document",
}) {
  const inputRef = useRef(null);
  const cameraRef = useRef(null);
  const [validating, setValidating] = useState(false);
  const invalid = Boolean(error);
  const isSelfie = variant === "selfie";
  const busy = validating;

  const handleFile = async (file) => {
    if (!file) return;
    setValidating(true);
    try {
      const check = await validateOnboardingImageFile(file);
      if (!check.ok) {
        toast.error(check.message);
        return;
      }
      const url = URL.createObjectURL(file);
      onChange(url, file);
    } finally {
      setValidating(false);
    }
  };

  return (
    <div>
      <label className="text-[11px] text-gray-400 font-bold uppercase tracking-widest mb-1.5 block">
        {label}
        {!optional && <span className="text-red-400 ml-0.5">*</span>}
      </label>

      {value ? (
        <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm">
          <img
            src={value}
            alt={label}
            className={["w-full object-cover", isSelfie ? "h-52" : "h-36"].join(" ")}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => (capture ? cameraRef : inputRef).current?.click()}
              className="flex-1 h-9 rounded-lg bg-white/20 backdrop-blur text-gray-900 text-[11px] font-bold hover:bg-gray-100 transition-colors"
            >
              Retake
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onChange("", null)}
              className="h-9 px-3 rounded-lg bg-red-500/80 backdrop-blur text-gray-900 text-[11px] font-bold hover:bg-red-500 transition-colors"
            >
              Remove
            </button>
          </div>
          <div className="absolute top-2 right-2 bg-green-600 text-white rounded-full p-1">
            <CheckCircle2 className="w-4 h-4" />
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => (capture ? cameraRef : inputRef).current?.click()}
          className={[
            "w-full rounded-xl border-2 border-dashed transition-all flex flex-col items-center justify-center gap-2",
            isSelfie ? "h-44" : "h-28",
            invalid
              ? "border-red-400/50 bg-red-400/5"
              : "border-gray-200 bg-gray-50 hover:border-green-600/50 hover:bg-green-600/5",
            busy ? "opacity-60" : "",
          ].join(" ")}
        >
          {busy ? (
            <Loader2 className="w-6 h-6 animate-spin text-green-600" />
          ) : isSelfie ? (
            <>
              <div className="w-14 h-14 rounded-full bg-green-600/15 flex items-center justify-center">
                <Camera className="w-7 h-7 text-green-600" />
              </div>
              <span className="text-[12px] font-bold text-gray-600">Tap to take selfie</span>
            </>
          ) : (
            <>
              <UploadCloud className="w-6 h-6 text-gray-400" />
              <span className="text-[11px] font-bold text-gray-400">Tap to upload photo</span>
            </>
          )}
          {hint && !busy && (
            <span className="text-[10px] text-gray-300 px-4 text-center">{hint}</span>
          )}
        </button>
      )}

      {!value && !isSelfie && (
        <button
          type="button"
          disabled={busy}
          onClick={() => cameraRef.current?.click()}
          className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 text-[11px] font-bold text-green-600 hover:text-green-700"
        >
          <ImagePlus className="w-3.5 h-3.5" />
          Use camera instead
        </button>
      )}

      {invalid && <p className="text-[11px] font-semibold text-red-400 mt-1.5">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="hidden"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        capture={capture || "environment"}
        className="hidden"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function ServiceToggle({ checked, onChange, Icon, title, subtitle }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={[
        "w-full text-left p-4 rounded-2xl border transition-all flex items-center gap-3 active:scale-[0.99]",
        checked
          ? "bg-green-600/10 border-green-600 shadow-[0_0_0_2px_rgba(136,193,112,0.15)]"
          : "bg-white shadow-sm border-gray-200 hover:border-gray-200",
      ].join(" ")}
    >
      <div
        className={[
          "w-11 h-11 rounded-xl flex items-center justify-center shrink-0",
          checked ? "bg-green-600 text-white" : "bg-gray-50 text-gray-500",
        ].join(" ")}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-gray-900 font-bold">{title}</div>
        <div className="text-[12px] text-gray-400">{subtitle}</div>
      </div>
      <div
        className={[
          "w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0",
          checked ? "border-green-600 bg-green-600 text-white" : "border-gray-200",
        ].join(" ")}
      >
        {checked && <CheckCircle2 className="w-4 h-4" />}
      </div>
    </button>
  );
}
