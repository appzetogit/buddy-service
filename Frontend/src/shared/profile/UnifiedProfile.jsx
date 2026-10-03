import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Leaf, Moon, Sun, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import AnimatedPage from "@food/components/user/AnimatedPage";
import { Button } from "@food/components/ui/button";
import { useProfile } from "@food/context/ProfileContext";
import { useLocationSelector } from "@food/components/user/UserLayout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@food/components/ui/dialog";
import { authAPI, userAPI } from "@food/api";
import { firebaseAuth } from "@food/firebase";
import { clearModuleAuth } from "@food/utils/auth";
import { registerWebPushForCurrentModule } from "@food/utils/firebaseMessaging";

import {
  PROFILE_SERVICES,
  DEFAULT_PROFILE_SERVICE,
  PROFILE_STORAGE_KEY,
  PROFILE_SERVICE_IDS,
} from "./profileServicesConfig";
import { useUnifiedProfileData } from "./hooks/useUnifiedProfileData";
import ServiceSwitcher from "./components/ServiceSwitcher";
import ProfileHeader from "./components/ProfileHeader";
import ProfileMenuList from "./components/ProfileMenuList";
import ProfileUserCard, { ProfileAccountActions } from "./components/ProfileUserCard";
import "./profile.css";

const USER_SESSION_PREFERENCE_KEYS = ["userVegMode", "food-under-250-filters"];

function detectServiceFromPath() {
  return "food";
}

function resolveInitialService(searchParams) {
  const fromQuery = searchParams.get("service");
  if (fromQuery && PROFILE_SERVICE_IDS.includes(fromQuery)) return fromQuery;

  try {
    const stored = sessionStorage.getItem(PROFILE_STORAGE_KEY);
    if (stored && PROFILE_SERVICE_IDS.includes(stored)) return stored;
  } catch {
    // ignore
  }

  return detectServiceFromPath();
}

export default function UnifiedProfile() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { openLocationSelector } = useLocationSelector();
  const { setVegMode, vegMode } = useProfile();

  const [activeServiceId, setActiveServiceId] = useState("unified");

  const {
    userProfile,
    companyName,
    displayName,
    hasValidEmail,
    avatarInitial,
    appearance,
    setAppearance,
    badgeValues,
    getItemBadge,
    getItemValue,
    getItemSub,
  } = useUnifiedProfileData();

  const activeService = useMemo(
    () => PROFILE_SERVICES.find((s) => s.id === activeServiceId) || PROFILE_SERVICES[0],
    [activeServiceId],
  );

  const [vegModeOpen, setVegModeOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteStep, setDeleteStep] = useState(1);
  const [deleteCaptcha, setDeleteCaptcha] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    registerWebPushForCurrentModule().catch(console.error);
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(PROFILE_STORAGE_KEY, activeServiceId);
    } catch {
      // ignore
    }
    if (searchParams.get("service") !== activeServiceId) {
      setSearchParams({ service: activeServiceId }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeServiceId]);

  const handleServiceChange = (serviceId) => {
    setActiveServiceId(serviceId);
  };

  const handleVegModeUpdate = (nextValue) => {
    setVegMode(nextValue);
    localStorage.setItem("userVegMode", String(nextValue));
  };

  const handleMenuAction = useCallback(
    (action) => {
      switch (action) {
        case "openLocationSelector":
          openLocationSelector();
          break;
        case "openVegMode":
          setVegModeOpen(true);
          break;
        case "openAppearance":
          setAppearanceOpen(true);
          break;
        default:
          break;
      }
    },
    [openLocationSelector],
  );

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      try {
        let fcmToken = null;
        let platform = "web";
        if (window.flutter_inappwebview) {
          platform = "mobile";
        } else {
          fcmToken = localStorage.getItem("fcm_web_registered_token_user") || null;
        }
        await authAPI.logout(null, fcmToken, platform);
      } catch {
        // continue local cleanup
      }

      try {
        if (firebaseAuth?.currentUser) {
          const { signOut } = await import("firebase/auth");
          await signOut(firebaseAuth);
        }
      } catch {
        // continue
      }

      clearModuleAuth("user");
      localStorage.removeItem("accessToken");
      localStorage.removeItem("user_authenticated");
      localStorage.removeItem("user_user");
      localStorage.removeItem("user");
      localStorage.removeItem("cart");
      USER_SESSION_PREFERENCE_KEYS.forEach((key) => localStorage.removeItem(key));
      window.dispatchEvent(new Event("userAuthChanged"));
      navigate("/user/auth/login", { replace: true });
    } catch {
      clearModuleAuth("user");
      navigate("/user/auth/login", { replace: true });
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await userAPI.deleteAccount();
      toast.success("Account deleted successfully");
      clearModuleAuth("user");
      localStorage.removeItem("accessToken");
      localStorage.removeItem("user_authenticated");
      localStorage.removeItem("user_user");
      localStorage.removeItem("user");
      localStorage.removeItem("cart");
      USER_SESSION_PREFERENCE_KEYS.forEach((key) => localStorage.removeItem(key));
      window.dispatchEvent(new Event("userAuthChanged"));
      navigate("/user/auth/login", { replace: true });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to delete account.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AnimatedPage className="unified-profile min-h-screen bg-[#f5f5f5] dark:bg-[#0a0a0a]" data-service={activeServiceId}>
      <div className="max-w-md md:max-w-2xl lg:max-w-4xl xl:max-w-5xl mx-auto px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 py-4 sm:py-6 md:py-8 lg:py-10 pb-20 sm:pb-24">
        <ProfileHeader service={activeService} />



        <ProfileUserCard
          displayName={displayName}
          hasValidEmail={hasValidEmail}
          userProfile={userProfile}
          avatarInitial={avatarInitial}
          activeService={activeService}
          stats={activeService.stats}
          badgeValues={badgeValues}
        />

        <div className="mt-4">
          <ProfileMenuList
            sections={activeService.sections}
            onAction={handleMenuAction}
            getItemBadge={getItemBadge}
            getItemValue={getItemValue}
            getItemSub={getItemSub}
          />

          <ProfileAccountActions
            onLogout={() => setLogoutConfirmOpen(true)}
            onDelete={() => {
              setDeleteStep(1);
              setDeleteCaptcha("");
              setDeleteAccountOpen(true);
            }}
            isLoggingOut={isLoggingOut}
            showDelete={activeServiceId === "food"}
          />
        </div>
      </div>

      {/* Veg Mode */}
      <Dialog open={vegModeOpen} onOpenChange={setVegModeOpen}>
        <DialogContent className="max-w-sm rounded-2xl p-0 overflow-hidden">
          <DialogHeader className="p-5 pb-3">
            <DialogTitle className="text-lg font-bold">Veg Mode</DialogTitle>
            <DialogDescription className="text-sm text-gray-500">
              Filter restaurants and dishes based on your dietary preferences
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 px-5 pb-5">
            {[
              { value: true, title: "Veg Mode ON", sub: "Show only vegetarian options" },
              { value: false, title: "Veg Mode OFF", sub: "Show all options" },
            ].map((opt) => (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => {
                  handleVegModeUpdate(opt.value);
                  setVegModeOpen(false);
                }}
                className={`w-full p-3 rounded-xl border-2 transition-all flex items-center justify-between ${
                  vegMode === opt.value ? "border-green-600 bg-green-50" : "border-gray-200 bg-white"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      vegMode === opt.value ? "border-green-600 bg-green-600" : "border-gray-300"
                    }`}
                  >
                    {vegMode === opt.value && <Check className="h-3 w-3 text-white" />}
                  </div>
                  <div className="text-left">
                    <p className="font-medium text-gray-900 text-sm">{opt.title}</p>
                    <p className="text-xs text-gray-500">{opt.sub}</p>
                  </div>
                </div>
                {opt.value && <Leaf className={`h-5 w-5 ${vegMode ? "text-green-600" : "text-gray-400"}`} />}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Appearance */}
      <Dialog open={appearanceOpen} onOpenChange={setAppearanceOpen}>
        <DialogContent className="max-w-sm rounded-2xl p-0 overflow-hidden bg-white dark:bg-[#1a1a1a]">
          <DialogHeader className="p-5 pb-3">
            <DialogTitle className="text-lg font-bold text-gray-900 dark:text-white">Appearance</DialogTitle>
            <DialogDescription className="text-sm text-gray-500">Choose your preferred theme</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 px-5 pb-5">
            {[
              { value: "light", icon: Sun, label: "Light", sub: "Default light theme" },
              { value: "dark", icon: Moon, label: "Dark", sub: "Dark theme" },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setAppearance(opt.value);
                  setAppearanceOpen(false);
                }}
                className={`w-full p-3 rounded-xl border-2 transition-all flex items-center gap-3 ${
                  appearance === opt.value
                    ? "border-[#16A34A] bg-[#fdfafc] dark:bg-[#3c0f3d]/20"
                    : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    appearance === opt.value ? "border-[#16A34A] bg-[#16A34A]" : "border-gray-300"
                  }`}
                >
                  {appearance === opt.value && <Check className="h-3 w-3 text-white" />}
                </div>
                <opt.icon className="h-5 w-5 flex-shrink-0" />
                <div className="text-left">
                  <p className="font-medium text-gray-900 dark:text-white text-sm">{opt.label}</p>
                  <p className="text-xs text-gray-500">{opt.sub}</p>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Logout */}
      {logoutConfirmOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#1a1a1a] p-5 shadow-2xl border border-gray-200 dark:border-gray-800">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Log out?</h3>
            <p className="mt-1 text-sm text-gray-500">Are you sure you want to log out from {companyName}?</p>
            <div className="mt-5 flex items-center gap-3">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setLogoutConfirmOpen(false)} disabled={isLoggingOut}>
                No
              </Button>
              <Button
                className="flex-1 rounded-xl bg-[#15803D] hover:bg-[#3c0f3d] text-white"
                onClick={() => {
                  setLogoutConfirmOpen(false);
                  handleLogout();
                }}
                disabled={isLoggingOut}
              >
                Yes
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account */}
      {deleteAccountOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#1a1a1a] shadow-2xl border border-gray-200 dark:border-gray-800 overflow-hidden"
          >
            {deleteStep === 1 && (
              <div className="p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="bg-red-100 dark:bg-red-900/30 rounded-full p-2.5">
                    <AlertTriangle className="h-6 w-6 text-red-500" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">Delete Account?</h3>
                </div>
                <div className="bg-red-50 dark:bg-red-900/10 rounded-xl p-3.5 mb-4 border border-red-100">
                  <p className="text-sm font-semibold text-red-600 mb-2">This action is permanent!</p>
                  <ul className="text-xs text-red-500/80 space-y-1.5">
                    <li>• Your profile, addresses, and preferences will be deleted</li>
                    <li>• Wallet balance will be forfeited</li>
                    <li>• Order history will be anonymized</li>
                  </ul>
                </div>
                <div className="flex items-center gap-3">
                  <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setDeleteAccountOpen(false)}>
                    Cancel
                  </Button>
                  <Button className="flex-1 rounded-xl bg-red-500 hover:bg-red-600 text-white" onClick={() => setDeleteStep(2)}>
                    Continue
                  </Button>
                </div>
              </div>
            )}
            {deleteStep === 2 && (
              <div className="p-5">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Confirm Deletion</h3>
                <p className="text-sm text-gray-500 mb-4">
                  Type <span className="font-bold text-red-500">DELETE MY ACCOUNT</span> to confirm.
                </p>
                <input
                  type="text"
                  value={deleteCaptcha}
                  onChange={(e) => setDeleteCaptcha(e.target.value)}
                  placeholder="Type here..."
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-400 mb-4"
                  autoFocus
                  autoComplete="off"
                />
                <div className="flex items-center gap-3">
                  <Button variant="outline" className="flex-1 rounded-xl" onClick={() => { setDeleteStep(1); setDeleteCaptcha(""); }}>
                    Back
                  </Button>
                  <Button
                    className="flex-1 rounded-xl bg-red-500 hover:bg-red-600 text-white disabled:opacity-40"
                    disabled={deleteCaptcha.trim() !== "DELETE MY ACCOUNT" || isDeleting}
                    onClick={handleDeleteAccount}
                  >
                    {isDeleting ? "Deleting..." : "Delete Forever"}
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatedPage>
  );
}
