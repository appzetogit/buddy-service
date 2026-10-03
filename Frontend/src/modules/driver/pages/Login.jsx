import { useEffect, useRef, useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  Loader2,
  Bike,
  ShieldCheck,
  ChevronDown,
  IndianRupee,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { identityAPI, persistDriverIdentitySession } from "@food/api";

const RESEND_COOLDOWN_SECONDS = 60;
const DRIVER_LOGIN_PHONE_KEY = "driverLoginPhone";

/**
 * Single Driver Login. Phone + OTP. Server figures out whether this
 * person needs onboarding, has approved capabilities, etc.
 *
 * After verify:
 *   needsOnboarding=true  → /driver/onboarding
 *   else                  → /driver/home
 */
export default function DriverLogin() {
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const submitting = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();
  const intendedRedirect = String(location.state?.redirect || "");

  useEffect(() => {
    try {
      if (phone) {
        sessionStorage.setItem(DRIVER_LOGIN_PHONE_KEY, phone);
      } else {
        sessionStorage.removeItem(DRIVER_LOGIN_PHONE_KEY);
      }
    } catch {
      // ignore
    }
  }, [phone]);

  useEffect(() => {
    if (step !== 2 || resendTimer <= 0) return;
    const id = setInterval(() => {
      setResendTimer((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [step, resendTimer]);

  const formatResendTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const sendOtp = async () => {
    if (phone.length !== 10) {
      toast.error("Please enter a valid 10-digit number");
      return;
    }
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    try {
      await identityAPI.requestOtp(phone, "DRIVER");
      setOtp("");
      setStep(2);
      setResendTimer(RESEND_COOLDOWN_SECONDS);
      toast.success("OTP sent to your phone");
    } catch (err) {
      toast.error(
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Failed to send OTP",
      );
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendTimer > 0 || submitting.current) return;
    submitting.current = true;
    setLoading(true);
    try {
      await identityAPI.requestOtp(phone, "DRIVER");
      setOtp("");
      setResendTimer(RESEND_COOLDOWN_SECONDS);
      toast.success("OTP resent");
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to resend");
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  const grabFcmToken = async () => {
    let fcmToken = null;
    let platform = "web";
    try {
      if (typeof window === "undefined") return { fcmToken, platform };
      if (window.flutter_inappwebview) {
        platform = "mobile";
        for (const handler of ["getFcmToken", "getFCMToken", "getPushToken", "getFirebaseToken"]) {
          try {
            const t = await window.flutter_inappwebview.callHandler(handler, { module: "driver" });
            if (t && typeof t === "string" && t.length > 20) {
              fcmToken = t.trim();
              break;
            }
          } catch { /* try next handler */ }
        }
      } else {
        fcmToken = localStorage.getItem("fcm_web_registered_token_delivery") || null;
      }
    } catch { /* ignore */ }
    return { fcmToken, platform };
  };

  const verifyOtp = async () => {
    const otpDigits = otp.replace(/\D/g, "").slice(0, 4);
    if (otpDigits.length !== 4) {
      toast.error("Enter the 4-digit OTP");
      return;
    }
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    try {
      const { fcmToken, platform } = await grabFcmToken();
      const response = await identityAPI.verifyOtp(phone, "DRIVER", otpDigits, { fcmToken, platform });
      const data = response?.data?.data || response?.data || {};

      persistDriverIdentitySession({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        identity: data.identity,
        capabilities: data.capabilities,
        activeService: data.activeService,
      });

      try {
        sessionStorage.removeItem(DRIVER_LOGIN_PHONE_KEY);
      } catch {
        // ignore
      }

      if (data?.needsOnboarding) {
        toast.success("Welcome! Let's finish your onboarding.");
        navigate("/driver/onboarding", { replace: true });
        return;
      }

      toast.success("Logged in");
      navigate(intendedRedirect || "/driver/home", { replace: true });
    } catch (err) {
      const status = err?.response?.status;
      let msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Invalid OTP. Please try again.";
      if (status === 401) msg = "Invalid or expired code. Please try again.";
      toast.error(msg);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-['Poppins'] sm:items-center sm:justify-center">
      <div className="sm:w-[420px] sm:rounded-[2.5rem] sm:shadow-2xl sm:overflow-hidden flex flex-col h-full w-full max-w-full bg-white sm:bg-white border-0 sm:border border-gray-100">
        {/* Top hero */}
        <div className="relative w-full overflow-hidden bg-gradient-to-br from-green-600 via-green-700 to-green-800 pt-6 pb-14 flex-shrink-0">
          <div className="absolute -top-10 -right-10 w-72 h-72 bg-gray-200 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-[-40px] -left-12 w-72 h-72 bg-black/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 px-6">
            <div className="mb-8 flex items-center gap-2 select-none" aria-hidden="true">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white shadow-md">
                <span className="text-xl font-black leading-none text-green-700">B</span>
              </div>
              <span className="text-lg font-black tracking-tight text-white">Buddy Partner</span>
            </div>

            <p className="uppercase text-[11px] text-green-200 font-bold tracking-[0.25em] mb-2">
              Drive · Deliver · Earn
            </p>
            <h1 className="text-white text-[30px] leading-[1.15] font-extrabold tracking-tight mb-2">
              One partner account.<br />
              Food Delivery.
            </h1>
            <p className="text-green-50 text-[13px] font-medium max-w-[290px]">
              Sign in to receive restaurant deliveries.
            </p>
          </div>
        </div>

        {/* Form sheet */}
        <div className="flex-1 bg-white -mt-6 relative z-20 rounded-t-[2rem] border-t border-gray-100 shadow-[0_-4px_20px_rgba(0,0,0,0.02)]">
          <div className="px-7 pt-8 pb-4">
            <h2 className="text-gray-900 text-[28px] font-black tracking-tight mb-1">
              Partner Sign In
            </h2>
            <p className="text-gray-500 text-[14px] font-medium mb-8">
              {step === 1 ? "We'll send a 4-digit OTP" : "Enter the OTP we just sent"}
            </p>

            <AnimatePresence mode="wait">
              {step === 1 ? (
                <motion.form
                  key="phone"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  onSubmit={(e) => { e.preventDefault(); sendOtp(); }}
                  className="space-y-6"
                >
                  <div>
                    <label className="text-gray-500 text-[12px] font-bold uppercase tracking-widest mb-2 block">
                      Mobile Number
                    </label>
                    <div className="flex items-center bg-gray-50 border border-gray-200 rounded-2xl focus-within:border-green-600 focus-within:ring-2 focus-within:ring-green-600/10 transition-all overflow-hidden h-14">
                      <div className="flex items-center gap-1.5 px-4 h-full text-white">
                        <span className="font-bold text-[15px] text-black">+91</span>
                        <ChevronDown className="w-4 h-4 text-black" strokeWidth={3} />
                      </div>
                      <div className="w-px h-6 bg-gray-200" />
                      <input
                        type="tel"
                        required
                        autoFocus
                        autoComplete="tel-national"
                        inputMode="numeric"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                        maxLength={10}
                        className="flex-1 px-4 h-full bg-transparent outline-none text-gray-900 font-bold placeholder:text-gray-400 text-[15px]"
                        placeholder="Registered partner number"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || phone.length < 10}
                    className="w-full h-14 bg-green-600 hover:bg-green-700 disabled:bg-gray-200 disabled:text-white/30 text-white rounded-2xl font-extrabold text-[16px] shadow-lg shadow-green-600/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <span>Continue</span>
                        <ArrowRight className="w-5 h-5" strokeWidth={2.5} />
                      </>
                    )}
                  </button>
                </motion.form>
              ) : (
                <motion.form
                  key="otp"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  onSubmit={(e) => { e.preventDefault(); verifyOtp(); }}
                  className="space-y-6"
                >
                  <div>
                    <label className="text-gray-500 text-[12px] font-bold uppercase tracking-widest mb-2 block">
                      Enter OTP
                    </label>
                    <div className="flex justify-between gap-3">
                      {[0, 1, 2, 3].map((i) => (
                        <input
                          key={i}
                          id={`drv-otp-${i}`}
                          type="tel"
                          inputMode="numeric"
                          required
                          autoFocus={i === 0}
                          value={otp[i] || ""}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, "").slice(-1);
                            if (!val) return;
                            const newOtp = otp.split("");
                            newOtp[i] = val;
                            const combined = newOtp.join("").slice(0, 4);
                            setOtp(combined);
                            if (i < 3 && val) {
                              document.getElementById(`drv-otp-${i + 1}`)?.focus();
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Backspace") {
                              if (!otp[i] && i > 0) {
                                document.getElementById(`drv-otp-${i - 1}`)?.focus();
                              } else {
                                const newOtp = otp.split("");
                                newOtp[i] = "";
                                setOtp(newOtp.join(""));
                              }
                            }
                          }}
                          className="w-full h-14 text-center text-2xl font-bold bg-gray-50 border border-gray-200 focus:border-green-600 focus:ring-2 focus:ring-green-600/20 rounded-2xl outline-none text-gray-900 transition-all"
                          placeholder="•"
                        />
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col items-center gap-2">
                    <div className="text-[13px] font-semibold text-gray-500">
                      {resendTimer > 0 ? (
                        <>Resend in <span className="text-green-600">{formatResendTimer(resendTimer)}</span></>
                      ) : (
                        <button type="button" onClick={handleResend} className="text-green-600 hover:underline">
                          Resend OTP
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => { setStep(1); setOtp(""); }}
                      className="text-[12px] text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      Edit phone number
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || otp.length < 4}
                    className="w-full h-14 bg-green-600 hover:bg-green-700 disabled:bg-gray-200 disabled:text-white/30 text-white rounded-2xl font-extrabold text-[16px] shadow-lg shadow-green-600/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <span>Verify & Continue</span>
                        <ArrowRight className="w-5 h-5" strokeWidth={2.5} />
                      </>
                    )}
                  </button>
                </motion.form>
              )}
            </AnimatePresence>
          </div>

          <div className="mt-auto px-7 py-6 border-t border-gray-100 shadow-[0_-4px_20px_rgba(0,0,0,0.02)]">
            <div className="grid grid-cols-2 gap-3 mb-5">
              {[
                { Icon: Bike, label: "Food" },
                { Icon: IndianRupee, label: "Earnings" },
              ].map(({ Icon, label }) => (
                <div key={label} className="rounded-2xl bg-white/5 border border-gray-100 shadow-[0_-4px_20px_rgba(0,0,0,0.02)] p-3 text-center">
                  <Icon className="w-5 h-5 text-green-600 mx-auto mb-1" />
                  <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">{label}</div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-center gap-2 text-[10px] text-gray-400 font-medium">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>
                By continuing you accept the&nbsp;
                <Link to="/food/delivery/terms" className="text-green-600 font-bold">
                  Partner Terms
                </Link>
              </span>
            </div>
            <div className="text-center mt-3 text-[11px] text-gray-400">
              Looking to order instead?{" "}
              <Link to="/user/auth/login" className="text-green-600 font-bold">
                Sign in as a Customer
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Decorative sparkle (top right) */}
      <Sparkles className="absolute top-6 right-6 w-5 h-5 text-gray-300 hidden sm:block" />
    </div>
  );
}
