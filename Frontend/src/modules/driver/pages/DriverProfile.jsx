/**
 * Unified driver profile.
 *
 * Single profile for food-delivery partners. Pulls identity +
 * capability state from onboarding/mode, and enriches with delivery profile
 * (partner ID, zone, rating) when food is enrolled.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeftRight,
  BadgePercent,
  Bike,
  Camera,
  ChevronRight,
  FileText,
  Gift,
  HandCoins,
  HelpCircle,
  History,
  Info,
  Landmark,
  Loader2,
  LogOut,
  MapPin,
  Phone,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  User as UserIcon,
  Wallet,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";

import {
  clearIdentitySession,
  deliveryAPI,
  driverModeAPI,
  driverOnboardingAPI,
} from "@food/api";
import { clearModuleAuth } from "@food/utils/auth";

const OFF_VALUES = new Set(["off", "none", "offline", "", null, undefined]);
const normalizeMode = (raw) => (OFF_VALUES.has(raw) ? "off" : raw);

const CAP_READY = new Set(["approved", "enabled", "active"]);
const isCapabilityReady = (cap) => CAP_READY.has(String(cap || "").toLowerCase());
const isCapabilityEnrolled = (cap) =>
  cap && String(cap).toLowerCase() !== "not_enabled";

const capabilityLabel = (cap) => {
  const value = String(cap || "").toLowerCase();
  if (!value || value === "not_enabled") return "Not enrolled";
  if (value === "pending") return "Awaiting approval";
  if (value === "rejected") return "Rejected";
  if (CAP_READY.has(value)) return "Active";
  return value.replace(/_/g, " ");
};

const formatPhone = (phone) => {
  if (!phone) return "—";
  const digits = String(phone).replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return phone;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
};

const capitaliseFirst = (value) => {
  const str = String(value || "");
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/-/g, " ");
};

const maskNumber = (value, keepLast = 4) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.length <= keepLast) return raw;
  const tail = raw.slice(-keepLast);
  const lead = raw.length - keepLast;
  return `${"•".repeat(Math.min(lead, 12))} ${tail}`;
};

const parseNumericValue = (...values) => {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return null;
};

const getRiderLevel = (ratingValue, ratingCount) => {
  if (!Number.isFinite(ratingValue) || ratingValue <= 0 || ratingCount <= 0) {
    return "New Rider";
  }
  if (ratingValue >= 4.8 && ratingCount >= 100) return "Champion";
  if (ratingValue >= 4.6 && ratingCount >= 50) return "Elite";
  if (ratingValue >= 4.3 && ratingCount >= 20) return "Pro";
  if (ratingValue >= 4.0 && ratingCount >= 10) return "Rising";
  return "Starter";
};

const LEGAL_CONTENT = {
  terms: {
    title: "Terms & Conditions",
    Icon: FileText,
    description: "General rules for using the Buddy Service platform.",
    body: `By using the Buddy Service platform, you agree to comply with all applicable
transport regulations and our safety standards.

Highlights:
• Professionalism: Drivers must maintain a high standard of service.
• Vehicle Readiness: All vehicles listed must be in active, roadworthy condition.
• Compliance: You must ensure all permits and insurance are valid.
• Platform Fees: Buddy Service charges a service fee for every successful booking.
• Account Security: You are responsible for keeping your credentials secure.`,
  },
  privacy: {
    title: "Privacy Policy",
    Icon: Shield,
    description: "How we handle your data.",
    body: `Buddy Service takes data security seriously. We collect specific information
to ensure safety and service quality.

Data we collect:
• Identity & KYC documents (encrypted at rest).
• Live location during active jobs only.
• Phone and email for booking updates and support.

We never share your KYC documents with third-party advertising networks.`,
  },
  refund: {
    title: "Refund Policy",
    Icon: HandCoins,
    description: "Cancellation and refund guidelines.",
    body: `Booking Cancellations:
• Customer-initiated: Refund varies based on how close the pickup time is.
• Operator-initiated: If a vehicle fails inspection, a full refund is processed
  to the customer.

Processing Time: Refunds are typically credited back to the original payment
method within 5–7 working days.`,
  },
};

export default function DriverProfile() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState(null);
  const [deliveryProfile, setDeliveryProfile] = useState(null);
  const [capabilities, setCapabilities] = useState({
    food: "not_enabled",
  });
  const [activeService, setActiveService] = useState("off");
  const [error, setError] = useState("");
  const [legalModal, setLegalModal] = useState(null);
  const [showLogout, setShowLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteStep, setDeleteStep] = useState(1);
  const [deleteCaptcha, setDeleteCaptcha] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

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
        setLoading(true);
        const [stateRes, modeRes] = await Promise.all([
          driverOnboardingAPI.getState().catch(() => null),
          driverModeAPI.get().catch(() => null),
        ]);
        if (cancelled) return;

        const stateData = stateRes?.data?.data || stateRes?.data || {};
        const modeData = modeRes?.data?.data || modeRes?.data || {};

        if (stateData?.onboardingComplete === false) {
          navigate("/driver/onboarding", { replace: true });
          return;
        }

        setState(stateData || null);

        const nextCaps = {
          food: "not_enabled",
          ...(stateData?.capabilities || {}),
          ...(modeData?.capabilities || {}),
        };
        setCapabilities(nextCaps);

        if (stateData?.activeService) {
          setActiveService(normalizeMode(stateData.activeService));
        }
        if (modeData?.activeService) {
          setActiveService(normalizeMode(modeData.activeService));
        }

        // Enrich with delivery partner details when food is enrolled.
        if (isCapabilityEnrolled(nextCaps.food)) {
          try {
            const deliveryRes = await deliveryAPI.getProfile();
            if (cancelled) return;
            const profile = deliveryRes?.data?.data?.profile;
            if (profile) setDeliveryProfile(profile);
          } catch {
            /* optional enrichment — ignore */
          }
        }
      } catch (err) {
        if (cancelled) return;
        if (err?.response?.status === 401) {
          navigate("/driver/login", { replace: true });
          return;
        }
        setError(err?.response?.data?.message || err?.message || "Unable to load profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const basics = state?.basics || {};
  const kyc = state?.kyc || {};
  const bank = state?.bank || {};
  const vehicle = state?.vehicle || {};
  const foodVehicle = state?.foodVehicle || {};

  const driverName = useMemo(() => {
    const name = String(
      basics?.name || deliveryProfile?.name || state?.name || "",
    ).trim();
    return name || "Buddy Partner";
  }, [basics?.name, deliveryProfile?.name, state?.name]);

  const driverPhone = useMemo(
    () => formatPhone(state?.phone || deliveryProfile?.phone),
    [deliveryProfile?.phone, state?.phone],
  );
  const driverEmail = useMemo(() => basics?.email || "—", [basics?.email]);
  const profileImage = useMemo(() => {
    return (
      basics?.profileImage ||
      state?.selfieUrl ||
      deliveryProfile?.profileImage?.url ||
      deliveryProfile?.documents?.photo ||
      null
    );
  }, [
    basics?.profileImage,
    deliveryProfile?.documents?.photo,
    deliveryProfile?.profileImage?.url,
    state?.selfieUrl,
  ]);

  const partnerId = useMemo(() => {
    return (
      deliveryProfile?.deliveryId ||
      state?.identityId?.slice?.(-8)?.toUpperCase?.() ||
      ""
    );
  }, [deliveryProfile?.deliveryId, state?.identityId]);

  const zoneName = useMemo(() => {
    const zone = deliveryProfile?.zone;
    if (!zone) return "";
    if (typeof zone === "string") return zone;
    return zone?.name || "";
  }, [deliveryProfile?.zone]);

  const ratingValue = useMemo(
    () =>
      parseNumericValue(
        deliveryProfile?.metrics?.rating,
        deliveryProfile?.ratings?.average,
        deliveryProfile?.averageRating,
        deliveryProfile?.rating,
        deliveryProfile?.stats?.averageRating,
      ),
    [deliveryProfile],
  );

  const ratingCount = useMemo(
    () =>
      Number(
        deliveryProfile?.metrics?.ratingCount ||
          deliveryProfile?.ratings?.count ||
          deliveryProfile?.totalRatings ||
          deliveryProfile?.reviewCount ||
          deliveryProfile?.stats?.totalRatings ||
          0,
      ),
    [deliveryProfile],
  );

  const riderLevel = useMemo(
    () => getRiderLevel(ratingValue, ratingCount),
    [ratingCount, ratingValue],
  );

  const ratingDisplay = ratingValue
    ? `${ratingValue.toFixed(1)}${ratingCount > 0 ? ` (${ratingCount})` : ""}`
    : "—";

  const joinedAt = useMemo(() => {
    if (!state?.createdAt) return "";
    try {
      return new Date(state.createdAt).toLocaleDateString("en-IN", {
        month: "short",
        year: "numeric",
      });
    } catch {
      return "";
    }
  }, [state?.createdAt]);

  const personalDetails = useMemo(() => {
    const items = [];
    if (basics?.gender) items.push({ label: "Gender", value: capitaliseFirst(basics.gender) });
    if (basics?.city || deliveryProfile?.location?.city) {
      items.push({
        label: "City",
        value: basics?.city || deliveryProfile?.location?.city,
      });
    }
    if (basics?.state || deliveryProfile?.location?.state) {
      items.push({
        label: "State",
        value: basics?.state || deliveryProfile?.location?.state,
      });
    }
    if (joinedAt) items.push({ label: "Joined", value: joinedAt });
    if (state?.isVerified || deliveryProfile?.status) {
      const approved = ["approved", "active"].includes(
        String(deliveryProfile?.status || "").toLowerCase(),
      );
      items.push({
        label: "Status",
        value: approved || state?.isVerified ? "Verified" : capitaliseFirst(deliveryProfile?.status) || "Pending",
      });
    }
    return items;
  }, [
    basics?.city,
    basics?.state,
    basics?.gender,
    deliveryProfile?.location?.city,
    deliveryProfile?.location?.state,
    deliveryProfile?.status,
    joinedAt,
    state?.isVerified,
  ]);

  const kycRows = useMemo(
    () => [
      { id: "aadhaar", label: "Aadhaar", doc: kyc?.aadhaar },
      { id: "pan", label: "PAN", doc: kyc?.pan },
      { id: "dl", label: "Driving Licence", doc: kyc?.drivingLicense },
    ],
    [kyc?.aadhaar, kyc?.drivingLicense, kyc?.pan],
  );

  const displayVehicle = useMemo(() => {
    const fromDelivery = deliveryProfile?.vehicle || {};
    return {
      type: vehicle?.type || foodVehicle?.type || fromDelivery?.type || "",
      make: vehicle?.make || foodVehicle?.brand || fromDelivery?.brand || "",
      model: vehicle?.model || "",
      color: vehicle?.color || "",
      number: vehicle?.number || foodVehicle?.number || fromDelivery?.number || "",
      photoUrl: vehicle?.photoUrl || "",
      rcUrl: vehicle?.rcUrl || "",
      insuranceUrl: vehicle?.insuranceUrl || "",
    };
  }, [deliveryProfile?.vehicle, foodVehicle, vehicle]);

  const hasVehicle = Boolean(
    displayVehicle.type ||
      displayVehicle.make ||
      displayVehicle.model ||
      displayVehicle.number,
  );

  const displayBank = useMemo(() => {
    const fromDelivery = deliveryProfile?.documents?.bankDetails || {};
    return {
      accountHolderName: bank?.accountHolderName || fromDelivery?.accountHolderName || "",
      accountNumber: bank?.accountNumber || fromDelivery?.accountNumber || "",
      ifscCode: bank?.ifscCode || fromDelivery?.ifscCode || "",
      bankName: bank?.bankName || fromDelivery?.bankName || "",
      branchName: bank?.branchName || "",
      upiId: bank?.upiId || fromDelivery?.upiId || "",
      upiQrCodeUrl: bank?.upiQrCodeUrl || fromDelivery?.upiQrCode?.url || fromDelivery?.upiQrCode || "",
    };
  }, [bank, deliveryProfile?.documents?.bankDetails]);

  const hasBank = Boolean(
    displayBank.accountHolderName ||
      displayBank.accountNumber ||
      displayBank.ifscCode ||
      displayBank.upiId,
  );

  const foodEnrolled = isCapabilityEnrolled(capabilities.food);

  const links = useMemo(
    () => ({
      home: "/food/delivery",
      editProfile: "/food/delivery/profile/details",
      wallet: "/food/delivery/pocket",
      history: "/food/delivery/history",
      bank: "/food/delivery/profile/bank",
      documents: "/food/delivery/profile/documents",
      vehicle: "/food/delivery/profile/details",
      notifications: "/food/delivery/notifications",
      referral: "/driver/home",
      incentives: "/driver/home",
      sos: "/food/delivery/help/tickets",
      help: "/food/delivery/help/tickets",
      deleteAccount: null,
    }),
    [],
  );

  const clearSessionLocally = () => {
    clearModuleAuth("driver");
    clearModuleAuth("delivery");
    clearIdentitySession();
    [
      "driverToken",
      "token",
      "driverInfo",
      "role",
      "driverRole",
      "chatRole",
      "buddy_identity",
      "driver_capabilities",
      "driver_activeService",
      "app:isOnline",
    ].forEach((k) => {
      try {
        localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    });
  };

  const goLogout = async () => {
    if (loggingOut) return;
    try {
      setLoggingOut(true);
      if (foodEnrolled) {
        try {
          await deliveryAPI.logout();
        } catch {
          /* still clear locally */
        }
      }
      clearSessionLocally();
      toast.success("Logged out");
      navigate("/driver/login", { replace: true });
    } finally {
      setLoggingOut(false);
      setShowLogout(false);
    }
  };

  const openDeleteAccount = () => {
    if (links.deleteAccount) {
      navigate(links.deleteAccount);
      return;
    }
    setDeleteStep(1);
    setDeleteCaptcha("");
    setDeleteAccountOpen(true);
  };

  const confirmDeleteAccount = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await deliveryAPI.deleteAccount();
      toast.success("Account deleted");
      clearSessionLocally();
      navigate("/driver/login", { replace: true });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to delete account");
    } finally {
      setIsDeleting(false);
    }
  };

  const sections = useMemo(
    () => [
      {
        title: "Account",
        items: [
          {
            id: "personal",
            label: "Personal Information",
            sub: "Photo, name, phone & details",
            icon: <UserIcon size={20} />,
            path: links.editProfile,
          },
          {
            id: "bank",
            label: "Bank Details",
            sub: hasBank ? "UPI, QR, Account" : "Add payout details",
            icon: <Landmark size={20} />,
            path: links.bank,
          },
          {
            id: "documents",
            label: "Documents",
            sub: "KYC, RC, License",
            icon: <FileText size={20} />,
            path: links.documents,
          },
          ...(foodEnrolled
            ? [
                {
                  id: "zone",
                  label: "Delivery Zone",
                  sub: zoneName || "Set your service area",
                  icon: <MapPin size={20} />,
                  path: links.editProfile,
                },
              ]
            : []),
        ],
      },
      {
        title: "Activity",
        items: [
          {
            id: "wallet",
            label: "Wallet & Earnings",
            sub: "Food delivery wallet",
            icon: <Wallet size={20} />,
            path: links.wallet,
          },
          {
            id: "history",
            label: "Order History",
            sub: "Delivery history",
            icon: <History size={20} />,
            path: links.history,
          },
          {
            id: "incentives",
            label: "Incentives",
            sub: "Bonuses and milestones",
            icon: <BadgePercent size={20} />,
            path: links.incentives,
          },
        ],
      },
      {
        title: "Preferences",
        items: [
          {
            id: "notifications",
            label: "Notifications",
            icon: <ShieldCheck size={20} />,
            path: links.notifications,
          },
          {
            id: "refer",
            label: "Refer & Earn",
            sub: "Invite friends to Buddy",
            icon: <Gift size={20} />,
            path: links.referral,
          },
          {
            id: "sos",
            label: "Emergency SOS",
            icon: <Shield size={20} />,
            path: links.sos,
          },
        ],
      },
      {
        title: "Support & Legal",
        items: [
          {
            id: "help",
            label: "Help & Support",
            sub: "Tickets & assistance",
            icon: <HelpCircle size={20} />,
            path: links.help,
          },
          {
            id: "terms",
            label: "Terms & Conditions",
            icon: <FileText size={20} />,
            action: () => setLegalModal(LEGAL_CONTENT.terms),
          },
          {
            id: "privacy",
            label: "Privacy Policy",
            icon: <Shield size={20} />,
            action: () => setLegalModal(LEGAL_CONTENT.privacy),
          },
          {
            id: "refund",
            label: "Refund Policy",
            icon: <HandCoins size={20} />,
            action: () => setLegalModal(LEGAL_CONTENT.refund),
          },
        ],
      },
    ],
    [
      foodEnrolled,
      hasBank,
      links.bank,
      links.documents,
      links.editProfile,
      links.help,
      links.history,
      links.incentives,
      links.notifications,
      links.referral,
      links.sos,
      links.wallet,
    ],
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-7 h-7 animate-spin text-[#88B04B]" />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            Loading profile…
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans select-none pb-28">
      {/* Header */}
      <header className="px-5 pt-4 pb-6 bg-white border-b border-slate-100 rounded-b-[28px] shadow-[0_8px_30px_-18px_rgba(15,23,42,0.25)]">
        <div className="flex items-center justify-between mb-5">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="text-[12px] font-semibold text-slate-500"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => navigate(links.help)}
            className="flex items-center gap-1.5 text-[#88B04B] font-bold text-[13px]"
          >
            <Info size={16} />
            Help
          </button>
        </div>

        <div className="flex items-start gap-4">
          <button
            type="button"
            onClick={() => navigate(links.editProfile)}
            className="relative w-[72px] h-[72px] rounded-[22px] overflow-hidden bg-slate-100 border border-slate-200 shrink-0 active:scale-95 transition-transform"
            aria-label="Edit profile photo"
          >
            {profileImage ? (
              <img
                src={profileImage}
                alt={driverName}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <UserIcon size={30} className="text-slate-400" />
              </div>
            )}
            <span className="absolute inset-x-0 bottom-0 h-7 bg-black/45 flex items-center justify-center">
              <Camera size={13} className="text-white" />
            </span>
            <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-lg bg-emerald-500 border-2 border-white flex items-center justify-center">
              <ShieldCheck size={11} className="text-white" strokeWidth={3} />
            </span>
          </button>

          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h1 className="text-[22px] font-bold text-slate-900 leading-tight truncate">
                  {driverName}
                </h1>
                <div className="flex items-center gap-2 text-[12px] text-slate-500 mt-0.5">
                  <Phone size={12} />
                  <span className="font-medium">{driverPhone}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigate(links.editProfile)}
                className="shrink-0 text-[11px] font-bold text-[#88B04B] uppercase tracking-widest px-3 py-1.5 rounded-full bg-[#88B04B]/10 border border-[#88B04B]/20"
              >
                Edit
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {partnerId && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-slate-900 text-white text-[10px] font-bold uppercase tracking-wider">
                  ID · {partnerId}
                </span>
              )}
              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold uppercase tracking-wider capitalize">
                {activeService === "off" ? "Offline" : `${activeService} mode`}
              </span>
            </div>
          </div>
        </div>

        {/* Identity mini-card */}
        <div className="mt-5 rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3 grid grid-cols-2 gap-x-3 gap-y-3 text-left">
          <div className="col-span-2 sm:col-span-1">
            <p className="text-[10px] font-medium text-slate-400 uppercase tracking-widest">Email</p>
            <p className="text-[12px] font-bold text-slate-900 break-all">{driverEmail}</p>
          </div>
          {personalDetails.map((item) => (
            <div key={item.label}>
              <p className="text-[10px] font-medium text-slate-400 uppercase tracking-widest">{item.label}</p>
              <p className="text-[12px] font-bold text-slate-900">{item.value}</p>
            </div>
          ))}
        </div>

        {error && (
          <p className="mt-3 text-[11px] font-medium text-rose-500">{error}</p>
        )}
      </header>

      {/* Quick actions */}
      <section className="px-5 pt-5">
        <div className="grid grid-cols-2 gap-3">
          <QuickAction
            icon={<Wallet size={22} />}
            label="My Wallet"
            tone="orange"
            onClick={() => navigate(links.wallet)}
          />
          <QuickAction
            icon={<History size={22} />}
            label="Order History"
            tone="green"
            onClick={() => navigate(links.history)}
          />
        </div>
      </section>

      {/* Rider stats (food partners) */}
      {foodEnrolled && (
        <section className="px-5 pt-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white border border-slate-100 p-4 text-center shadow-sm">
              <p className="text-[10px] font-medium text-slate-400 uppercase tracking-widest mb-1">
                Rider Level
              </p>
              <p className="text-[16px] font-bold text-slate-900">{riderLevel}</p>
            </div>
            <div className="rounded-2xl bg-white border border-slate-100 p-4 text-center shadow-sm">
              <p className="text-[10px] font-medium text-slate-400 uppercase tracking-widest mb-1 flex items-center justify-center gap-1">
                <Star size={11} className="text-amber-400" /> Rating
              </p>
              <p className="text-[16px] font-bold text-slate-900">{ratingDisplay}</p>
            </div>
          </div>
        </section>
      )}

      {/* Service capability + switch */}
      <section className="px-5 pt-6">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-[#88B04B]" />
          <h2 className="text-[12px] font-bold text-slate-500 uppercase tracking-widest">
            Your Services
          </h2>
        </div>

        <CapabilityCard
          Icon={Bike}
          title="Food Delivery"
          capability={capabilities.food}
          active={activeService === "food"}
          onClick={() =>
            isCapabilityReady(capabilities.food)
              ? navigate("/food/delivery")
              : navigate("/driver/home")
          }
        />

        <button
          type="button"
          onClick={() => navigate("/driver/home")}
          className="mt-3 w-full bg-slate-900 text-white rounded-2xl px-5 py-4 flex items-center justify-between active:scale-[0.99] transition-transform"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              <ArrowLeftRight size={18} />
            </div>
            <div className="text-left">
              <p className="text-[14px] font-bold leading-tight">Delivery Mode</p>
              <p className="text-[11px] text-white/60 font-medium">
                Go online or offline for deliveries
              </p>
            </div>
          </div>
          <ChevronRight size={18} className="text-white/60" />
        </button>
      </section>

      {/* Delivery zone */}
      {foodEnrolled && (
        <section className="px-5 pt-7">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[12px] font-bold text-slate-500 uppercase tracking-widest">
              Delivery Zone
            </h2>
            <button
              type="button"
              onClick={() => navigate(links.editProfile)}
              className="text-[11px] font-bold text-[#88B04B] uppercase tracking-widest"
            >
              {zoneName ? "Change" : "Set"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => navigate(links.editProfile)}
            className="w-full rounded-2xl border border-slate-100 bg-white p-4 flex items-center justify-between text-left shadow-sm active:scale-[0.99] transition-transform"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
                <MapPin size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-[14px] font-bold text-slate-900 truncate">
                  {zoneName || "No zone selected"}
                </p>
                <p className="text-[11px] font-medium text-slate-500">
                  {zoneName ? "Orders in this service area" : "Required to receive deliveries"}
                </p>
              </div>
            </div>
            {!zoneName && (
              <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-amber-50 text-amber-600">
                Required
              </span>
            )}
          </button>
        </section>
      )}

      {/* KYC details */}
      <section className="px-5 pt-7">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[12px] font-bold text-slate-500 uppercase tracking-widest">
            KYC Documents
          </h2>
          <button
            type="button"
            onClick={() => navigate(links.documents)}
            className="text-[11px] font-bold text-[#88B04B] uppercase tracking-widest"
          >
            Manage
          </button>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white divide-y divide-slate-100 overflow-hidden shadow-sm">
          {kycRows.map(({ id, label, doc }) => {
            const number = doc?.number || "";
            const uploaded = Boolean(doc?.documentUrl || doc?.backDocumentUrl);
            const ok = Boolean(number && uploaded);
            return (
              <div key={id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[12px] font-bold text-slate-900">{label}</p>
                  <p className="text-[11px] font-medium text-slate-500 truncate">
                    {number ? maskNumber(number) : "Not provided"}
                  </p>
                </div>
                <span
                  className={[
                    "text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full",
                    ok
                      ? "bg-emerald-50 text-emerald-600"
                      : number
                        ? "bg-amber-50 text-amber-600"
                        : "bg-slate-100 text-slate-500",
                  ].join(" ")}
                >
                  {ok ? "Verified" : number ? "Awaiting Upload" : "Pending"}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Vehicle details */}
      <section className="px-5 pt-7">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[12px] font-bold text-slate-500 uppercase tracking-widest">
            Vehicle
          </h2>
          <button
            type="button"
            onClick={() => navigate(links.vehicle)}
            className="text-[11px] font-bold text-[#88B04B] uppercase tracking-widest"
          >
            {hasVehicle ? "Edit" : "Add"}
          </button>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          {hasVehicle ? (
            <>
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden">
                  {displayVehicle.photoUrl ? (
                    <img src={displayVehicle.photoUrl} alt="vehicle" className="w-full h-full object-cover" />
                  ) : (
                    <Car size={22} className="text-slate-400" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-[14px] font-bold text-slate-900 truncate">
                    {[displayVehicle.make, displayVehicle.model].filter(Boolean).join(" ") ||
                      capitaliseFirst(displayVehicle.type) ||
                      "Registered Vehicle"}
                  </p>
                  <p className="text-[11px] font-medium text-slate-500 truncate">
                    {[capitaliseFirst(displayVehicle.type), capitaliseFirst(displayVehicle.color)]
                      .filter(Boolean)
                      .join(" • ") || "Type & colour not set"}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-left">
                <div>
                  <p className="text-[10px] font-medium text-slate-400 uppercase tracking-widest">Number</p>
                  <p className="text-[12px] font-bold text-slate-900">{displayVehicle.number || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium text-slate-400 uppercase tracking-widest">RC</p>
                  <p className="text-[12px] font-bold text-slate-900">{displayVehicle.rcUrl ? "Uploaded" : "Pending"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium text-slate-400 uppercase tracking-widest">Insurance</p>
                  <p className="text-[12px] font-bold text-slate-900">{displayVehicle.insuranceUrl ? "Uploaded" : "Pending"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium text-slate-400 uppercase tracking-widest">Photo</p>
                  <p className="text-[12px] font-bold text-slate-900">{displayVehicle.photoUrl ? "Uploaded" : "Pending"}</p>
                </div>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => navigate(links.vehicle)}
              className="w-full py-6 flex flex-col items-center gap-2 text-slate-400"
            >
              <Car size={24} />
              <p className="text-[13px] font-semibold text-slate-600">Add your vehicle</p>
              <p className="text-[11px] font-medium">Required to go online</p>
            </button>
          )}
        </div>
      </section>

      {/* Bank details */}
      <section className="px-5 pt-7">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[12px] font-bold text-slate-500 uppercase tracking-widest">
            Bank Account
          </h2>
          <button
            type="button"
            onClick={() => navigate(links.bank)}
            className="text-[11px] font-bold text-[#88B04B] uppercase tracking-widest"
          >
            {hasBank ? "Edit" : "Add"}
          </button>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          {hasBank ? (
            <>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center">
                  <Landmark size={20} className="text-slate-700" />
                </div>
                <div className="min-w-0">
                  <p className="text-[14px] font-bold text-slate-900 truncate">
                    {displayBank.accountHolderName || "Account holder"}
                  </p>
                  <p className="text-[11px] font-medium text-slate-500 truncate">
                    {displayBank.bankName || displayBank.branchName || "Linked bank"}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-left">
                <div>
                  <p className="text-[10px] font-medium text-slate-400 uppercase tracking-widest">A/C No.</p>
                  <p className="text-[12px] font-bold text-slate-900">
                    {displayBank.accountNumber ? maskNumber(displayBank.accountNumber) : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-medium text-slate-400 uppercase tracking-widest">IFSC</p>
                  <p className="text-[12px] font-bold text-slate-900">{displayBank.ifscCode || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium text-slate-400 uppercase tracking-widest">UPI</p>
                  <p className="text-[12px] font-bold text-slate-900 truncate">{displayBank.upiId || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium text-slate-400 uppercase tracking-widest">UPI QR</p>
                  <p className="text-[12px] font-bold text-slate-900">{displayBank.upiQrCodeUrl ? "Uploaded" : "—"}</p>
                </div>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => navigate(links.bank)}
              className="w-full py-6 flex flex-col items-center gap-2 text-slate-400"
            >
              <Landmark size={24} />
              <p className="text-[13px] font-semibold text-slate-600">Add bank & UPI</p>
              <p className="text-[11px] font-medium">Needed for payouts</p>
            </button>
          )}
        </div>
      </section>

      {/* Settings list */}
      <main className="mt-2">
        {sections.map((section) => (
          <div key={section.title} className="pt-6">
            <h3 className="px-6 text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">
              {section.title}
            </h3>
            <div className="mx-5 rounded-2xl bg-white border border-slate-100 overflow-hidden shadow-sm">
              {section.items.map((item, itemIdx) => (
                <motion.div
                  key={item.id}
                  whileTap={{ backgroundColor: "#F8F9FA" }}
                  onClick={() => {
                    if (item.action) item.action();
                    else if (item.path) navigate(item.path);
                  }}
                  className={[
                    "flex items-center justify-between px-4 py-3.5 group cursor-pointer",
                    itemIdx < section.items.length - 1 ? "border-b border-slate-50" : "",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-slate-50 text-slate-500 flex items-center justify-center shrink-0 group-hover:text-slate-900 transition-colors">
                      {item.icon}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-[14px] font-medium text-slate-800 tracking-tight">
                        {item.label}
                      </h4>
                      {item.sub && (
                        <p className="text-[11px] text-slate-400 font-medium truncate">
                          {item.sub}
                        </p>
                      )}
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-slate-300 shrink-0" />
                </motion.div>
              ))}
            </div>
          </div>
        ))}
      </main>

      {/* Danger zone */}
      <section className="px-5 pt-8 space-y-3">
        <h3 className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2 px-1">
          Danger Zone
        </h3>
        <button
          type="button"
          onClick={openDeleteAccount}
          className="w-full flex items-center justify-between px-4 py-4 rounded-2xl border border-rose-100 bg-white hover:bg-rose-50 transition-colors shadow-sm"
        >
          <span className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-rose-100 text-rose-500 flex items-center justify-center">
              <Trash2 size={18} />
            </span>
            <span className="text-[13px] font-bold text-rose-500">Delete Account</span>
          </span>
          <ChevronRight size={16} className="text-rose-200" />
        </button>
        <button
          type="button"
          onClick={() => setShowLogout(true)}
          className="w-full flex items-center justify-between px-4 py-4 rounded-2xl border border-rose-100 bg-white hover:bg-rose-50 transition-colors shadow-sm"
        >
          <span className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-rose-100 text-rose-500 flex items-center justify-center">
              <LogOut size={18} />
            </span>
            <span className="text-[13px] font-bold text-rose-500">Logout</span>
          </span>
          <ChevronRight size={16} className="text-rose-200" />
        </button>
      </section>

      {/* Logout modal */}
      <AnimatePresence>
        {showLogout && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 px-5 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="w-full max-w-xs rounded-[28px] bg-white p-6 shadow-2xl border border-slate-100"
            >
              <div className="space-y-2 text-center">
                <h3 className="text-[18px] font-bold text-slate-900 tracking-tight">Logout?</h3>
                <p className="text-[13px] font-medium text-slate-500">
                  You'll need to sign in again to receive new jobs.
                </p>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setShowLogout(false)}
                  className="h-12 rounded-2xl border border-slate-200 text-slate-700 font-bold text-[13px]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={goLogout}
                  disabled={loggingOut}
                  className="h-12 rounded-2xl bg-rose-500 text-white font-bold text-[13px] disabled:opacity-60"
                >
                  {loggingOut ? "Logging out..." : "Logout"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete account modal */}
      <AnimatePresence>
        {deleteAccountOpen && (
          <div
            className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/50 px-4 pb-6 sm:pb-0 backdrop-blur-sm"
            onClick={() => setDeleteAccountOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              className="w-full max-w-sm rounded-[28px] bg-white shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {deleteStep === 1 ? (
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center">
                      <AlertTriangle className="w-6 h-6 text-rose-500" />
                    </div>
                    <h3 className="text-[18px] font-bold text-slate-900">Delete Account?</h3>
                  </div>
                  <div className="rounded-2xl bg-rose-50 border border-rose-100 p-4 mb-5">
                    <p className="text-[11px] font-bold text-rose-600 uppercase tracking-widest mb-2">
                      This cannot be undone
                    </p>
                    <ul className="text-[12px] text-rose-600/90 space-y-1.5 font-medium">
                      <li>• Documents will be erased</li>
                      <li>• Earnings may be forfeited</li>
                      <li>• Trip history will be lost</li>
                    </ul>
                  </div>
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setDeleteStep(2)}
                      className="w-full h-12 rounded-2xl bg-rose-500 text-white font-bold text-[13px]"
                    >
                      Understand & Continue
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteAccountOpen(false)}
                      className="w-full h-11 text-slate-400 font-bold text-[12px]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-6 text-left">
                  <h3 className="text-[18px] font-bold text-slate-900 mb-2">Final Confirmation</h3>
                  <p className="text-[12px] text-slate-500 mb-4 font-medium">
                    Type <span className="text-rose-500 font-bold">DELETE MY ACCOUNT</span> below.
                  </p>
                  <input
                    type="text"
                    value={deleteCaptcha}
                    onChange={(e) => setDeleteCaptcha(e.target.value)}
                    placeholder="Type here..."
                    className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 bg-slate-50 text-slate-900 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-rose-100 mb-5"
                    autoFocus
                  />
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={confirmDeleteAccount}
                      disabled={deleteCaptcha.trim() !== "DELETE MY ACCOUNT" || isDeleting}
                      className="w-full h-12 rounded-2xl bg-rose-600 text-white font-bold text-[13px] disabled:opacity-40"
                    >
                      {isDeleting ? "Processing..." : "Delete Forever"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteStep(1);
                        setDeleteCaptcha("");
                      }}
                      className="w-full h-11 text-slate-400 font-bold text-[12px]"
                    >
                      Go Back
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Legal modal */}
      <AnimatePresence>
        {legalModal && (
          <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/45 backdrop-blur-sm px-4 pb-8 sm:items-center sm:pb-0">
            <motion.div
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              className="w-full max-w-lg overflow-hidden rounded-[32px] bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-8">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-[20px] bg-slate-50 text-slate-900 border border-slate-100">
                    <legalModal.Icon size={28} />
                  </div>
                  <button
                    type="button"
                    onClick={() => setLegalModal(null)}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition"
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="mt-6">
                  <h3 className="text-2xl font-bold text-slate-950">{legalModal.title}</h3>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    {legalModal.description}
                  </p>
                </div>
                <div className="mt-6 max-h-[40vh] overflow-y-auto pr-2">
                  <div className="whitespace-pre-line text-sm leading-7 text-slate-700 font-medium">
                    {legalModal.body}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setLegalModal(null)}
                  className="mt-8 w-full rounded-2xl bg-slate-950 py-4 text-sm font-bold text-white transition hover:bg-slate-800 active:scale-95"
                >
                  Got it
                </button>
              </div>
            </motion.div>
            <div className="absolute inset-0 -z-10" onClick={() => setLegalModal(null)} />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function QuickAction({ icon, label, tone, onClick }) {
  const tones = {
    orange: "bg-orange-50 text-orange-500 border-orange-100",
    green: "bg-emerald-50 text-emerald-600 border-emerald-100",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center gap-2 active:scale-95 transition-all"
    >
      <div className={`rounded-xl p-2.5 border ${tones[tone] || tones.green}`}>
        {icon}
      </div>
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-800">
        {label}
      </span>
    </button>
  );
}

function CapabilityCard({ Icon, title, capability, active, onClick }) {
  const enrolled = isCapabilityEnrolled(capability);
  const ready = isCapabilityReady(capability);
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-2xl border p-4 text-left transition-colors shadow-sm",
        ready
          ? "bg-emerald-50 border-emerald-100"
          : enrolled
            ? "bg-amber-50 border-amber-100"
            : "bg-white border-slate-100",
      ].join(" ")}
    >
      <div className="flex items-center justify-between">
        <Icon
          size={20}
          className={
            ready
              ? "text-emerald-600"
              : enrolled
                ? "text-amber-600"
                : "text-slate-400"
          }
        />
        {active && (
          <span className="text-[9px] uppercase tracking-widest font-black text-emerald-600">
            Active
          </span>
        )}
      </div>
      <p className="mt-3 text-[14px] font-bold text-slate-900">{title}</p>
      <p
        className={[
          "text-[11px] font-medium mt-0.5 capitalize",
          ready
            ? "text-emerald-700"
            : enrolled
              ? "text-amber-700"
              : "text-slate-500",
        ].join(" ")}
      >
        {capabilityLabel(capability)}
      </p>
    </button>
  );
}
