import { useEffect, useState, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Link, useLocation, useNavigate } from "react-router-dom"
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Utensils,
  ShoppingBag,
  IndianRupee,
  ChevronDown,
  ShieldCheck,
  Zap,
  BadgeCheck,
  User,
} from "lucide-react"
import { toast } from "sonner"
import logoImage from "@/assets/logo.png"
import { userAPI, identityAPI, persistUserIdentitySession } from "@food/api" 
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@food/components/ui/dialog"
import { Input } from "@food/components/ui/input"
import { Label } from "@food/components/ui/label"

export default function UnifiedOTPFastLogin() {
  const RESEND_COOLDOWN_SECONDS = 60
  const USER_LOGIN_PHONE_KEY = "userLoginPhone"
  const [phoneNumber, setPhoneNumber] = useState(() => {
    try {
      return sessionStorage.getItem(USER_LOGIN_PHONE_KEY) || ""
    } catch {
      return ""
    }
  })
  const [otp, setOtp] = useState("")
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [resendTimer, setResendTimer] = useState(0)
  const [showNameModal, setShowNameModal] = useState(false)
  const [newName, setNewName] = useState("")
  const [isUpdatingName, setIsUpdatingName] = useState(false)
  const [tempAuth, setTempAuth] = useState(null)
  const [pendingVerify, setPendingVerify] = useState(null)
  const [deactivatedError, setDeactivatedError] = useState(false)
  const navigate = useNavigate()
  const loginLocation = useLocation()
  const submitting = useRef(false)

  useEffect(() => {
    try {
      if (phoneNumber) {
        sessionStorage.setItem(USER_LOGIN_PHONE_KEY, phoneNumber)
      } else {
        sessionStorage.removeItem(USER_LOGIN_PHONE_KEY)
      }
    } catch {
      /* ignore */
    }
  }, [phoneNumber])

  const normalizedPhone = () => {
    const digits = String(phoneNumber).replace(/\D/g, "").slice(-15)
    return digits.length >= 8 ? digits : ""
  }

  const handleSendOTP = async (e) => {
    e.preventDefault()
    const phone = normalizedPhone()
    if (phone.length < 10) {
      toast.error("Please enter a valid 10-digit phone number")
      return
    }
    if (submitting.current) return
    submitting.current = true
    setLoading(true)
    try {
      await identityAPI.requestOtp(phoneNumber, "USER")
      setOtp("")
      setStep(2)
      setResendTimer(RESEND_COOLDOWN_SECONDS)
      toast.success("OTP sent successfully!")
    } catch (err) {
      const status = err?.response?.status
      let msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        "Failed to send OTP."
      
      if (status === 401 && /deactivat(ed|e)/i.test(String(msg))) {
        setDeactivatedError(true)
      } else {
        toast.error(msg)
      }
    } finally {
      setLoading(false)
      submitting.current = false
    }
  }

  const handleResendOTP = async () => {
    const phone = normalizedPhone()
    if (phone.length < 10) {
      toast.error("Please enter a valid phone number")
      return
    }
    if (resendTimer > 0 || submitting.current) return
    submitting.current = true
    setLoading(true)
    try {
      await identityAPI.requestOtp(phoneNumber, "USER")
      setOtp("")
      setResendTimer(RESEND_COOLDOWN_SECONDS)
      toast.success("OTP resent successfully.")
    } catch (err) {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        "Failed to resend OTP."
      toast.error(msg)
    } finally {
      setLoading(false)
      submitting.current = false
    }
  }

  const handleEditNumber = () => {
    setStep(1)
    setOtp("")
    setResendTimer(0)
    setPendingVerify(null)
    setShowNameModal(false)
    setNewName("")
  }

  const handleVerifyOTP = async (e) => {
    e.preventDefault()
    const otpDigits = String(otp).replace(/\D/g, "").slice(0, 4)
    if (otpDigits.length !== 4) {
      toast.error("Please enter the 4-digit OTP")
      return
    }
    if (submitting.current) return
    submitting.current = true
    setLoading(true)
    let fcmToken = null
    let platform = "web"
    try {
      try {
        if (typeof window !== "undefined") {
          if (window.flutter_inappwebview) {
            platform = "mobile"
            const handlerNames = ["getFcmToken", "getFCMToken", "getPushToken", "getFirebaseToken"]
            for (const handlerName of handlerNames) {
              try {
                const t = await window.flutter_inappwebview.callHandler(handlerName, { module: "user" })
                if (t && typeof t === "string" && t.length > 20) {
                  fcmToken = t.trim()
                  break
                }
              } catch {
                /* try next handler */
              }
            }
          } else {
            fcmToken = localStorage.getItem("fcm_web_registered_token_user") || null
          }
        }
      } catch (e) {
        console.warn("Failed to get FCM token during login", e)
      }

      const response = await identityAPI.verifyOtp(phoneNumber, "USER", otpDigits, { fcmToken, platform })
      const data = response?.data?.data || response?.data || {}
      const accessToken = data.accessToken
      const refreshToken = data.refreshToken || null
      const user = data.user || data.identity || {}

      persistUserIdentitySession({
        accessToken,
        refreshToken,
        user,
        identity: data.identity,
      })

      try {
        sessionStorage.removeItem(USER_LOGIN_PHONE_KEY)
      } catch {
        /* ignore */
      }

      if (!user?.name || String(user.name).trim() === "") {
        setTempAuth({ accessToken, user, refreshToken, identity: data.identity })
        setShowNameModal(true)
      } else {
        toast.success("Welcome back!")
        navigate("/user/auth/portal", { replace: true })
      }
    } catch (err) {
      const status = err?.response?.status
      let msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Invalid OTP. Please try again."
      const nameRequired = /name\s+is\s+required.*first[- ]?time|first[- ]?time.*name\s+is\s+required|first[- ]?time\s*sign\s*up/i.test(
        String(msg),
      )
      if (nameRequired) {
        setPendingVerify({
          phone: normalizedPhone() || phoneNumber,
          otp: otpDigits,
          fcmToken,
          platform,
        })
        setShowNameModal(true)
        return
      }
      if (status === 401) {
        if (/deactivat(ed|e)/i.test(String(msg))) {
          setDeactivatedError(true)
          return
        } else {
          msg = "Invalid or expired code, or account not active."
        }
      }
      toast.error(msg)
    } finally {
      setLoading(false)
      submitting.current = false
    }
  }

  const handleNameSubmit = async (e) => {
    e.preventDefault()
    if (!newName.trim()) {
      toast.error("Please enter your name")
      return
    }
    if (submitting.current || isUpdatingName) return
    submitting.current = true

    try {
      setIsUpdatingName(true)
      if (pendingVerify) {
        const runVerify = () =>
          identityAPI.verifyOtp(pendingVerify.phone, "USER", pendingVerify.otp, {
            name: newName.trim(),
            fcmToken: pendingVerify.fcmToken,
            platform: pendingVerify.platform,
          })

        let response
        try {
          response = await runVerify()
        } catch (firstErr) {
          const firstMsg = String(
            firstErr?.response?.data?.message ||
              firstErr?.response?.data?.error ||
              "",
          )
          // Rare leftover race: phone row exists from a prior partial attempt.
          // Retry once so first-time signup still completes with tokens.
          if (/already registered/i.test(firstMsg)) {
            response = await runVerify()
          } else {
            throw firstErr
          }
        }

        const data = response?.data?.data || response?.data || {}
        const accessToken = data.accessToken
        const refreshToken = data.refreshToken || null
        const user = data.user || data.identity || {}

        if (!accessToken) {
          throw new Error("Login failed. Please try again.")
        }

        persistUserIdentitySession({
          accessToken,
          refreshToken,
          user,
          identity: data.identity,
        })
        try {
          sessionStorage.removeItem(USER_LOGIN_PHONE_KEY)
        } catch {
          /* ignore */
        }
        setPendingVerify(null)
        toast.success(`Welcome, ${newName.trim()}!`)
        setShowNameModal(false)
        navigate("/user/auth/portal", { replace: true })
        return
      }

      await userAPI.updateProfile({ name: newName.trim() })

      const updatedUser = { ...tempAuth.user, name: newName.trim() }
      persistUserIdentitySession({
        accessToken: tempAuth.accessToken,
        refreshToken: tempAuth.refreshToken,
        user: updatedUser,
        identity: tempAuth.identity,
      })

      try {
        sessionStorage.removeItem(USER_LOGIN_PHONE_KEY)
      } catch {
        /* ignore */
      }

      toast.success(`Welcome, ${newName.trim()}!`)
      setShowNameModal(false)
      navigate("/user/auth/portal", { replace: true })
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Failed to complete signup."

      if (/otp not found|otp expired|invalid or expired code/i.test(String(msg))) {
        toast.error("OTP expired. Please request a new code and try again.")
        setShowNameModal(false)
        setPendingVerify(null)
        setStep(2)
        setOtp("")
        return
      }

      toast.error(msg)
    } finally {
      setIsUpdatingName(false)
      submitting.current = false
    }
  }

  const [keyboardOpen, setKeyboardOpen] = useState(false)

  useEffect(() => {
    if (step !== 2 || resendTimer <= 0) return
    const intervalId = setInterval(() => {
      setResendTimer((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => clearInterval(intervalId)
  }, [step, resendTimer])

  // Flutter/WebView: when keyboard opens, hide hero so it doesn't sit above the keyboard.
  useEffect(() => {
    if (typeof window === "undefined") return undefined

    const updateFromViewport = () => {
      const vv = window.visualViewport
      if (!vv) return
      const inset = Math.max(0, window.innerHeight - vv.height - (vv.offsetTop || 0))
      setKeyboardOpen(inset > 100)
    }

    // Fallback for wrappers that don't shrink visualViewport: hide hero while
    // a text field is focused (keyboard is almost certainly open).
    const onFocusIn = (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      if (!t.matches("input, textarea, select")) return
      if (window.matchMedia("(min-width: 640px)").matches) return
      setKeyboardOpen(true)
      window.setTimeout(() => {
        t.scrollIntoView({ block: "center", behavior: "smooth" })
      }, 250)
    }
    const onFocusOut = () => {
      window.setTimeout(() => {
        const active = document.activeElement
        if (active && active.matches?.("input, textarea, select")) return
        updateFromViewport()
        if (!window.visualViewport) setKeyboardOpen(false)
      }, 150)
    }

    updateFromViewport()
    window.visualViewport?.addEventListener("resize", updateFromViewport)
    window.visualViewport?.addEventListener("scroll", updateFromViewport)
    document.addEventListener("focusin", onFocusIn)
    document.addEventListener("focusout", onFocusOut)
    return () => {
      window.visualViewport?.removeEventListener("resize", updateFromViewport)
      window.visualViewport?.removeEventListener("scroll", updateFromViewport)
      document.removeEventListener("focusin", onFocusIn)
      document.removeEventListener("focusout", onFocusOut)
    }
  }, [])

  const formatResendTimer = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
  }

  return (
    <div
      className={`flex flex-col bg-gray-50 font-[family-name:var(--font-poppins)] sm:min-h-dvh sm:items-center sm:justify-center sm:overflow-auto sm:p-4 md:p-6 ${
        keyboardOpen
          ? "h-auto min-h-0 overflow-y-auto"
          : "h-dvh max-h-dvh overflow-hidden sm:h-auto sm:max-h-none"
      }`}
    >
      <div
        className={`flex w-full max-w-full flex-col sm:max-w-[420px] sm:rounded-[2.5rem] sm:bg-white sm:shadow-2xl md:max-w-[440px] ${
          keyboardOpen ? "min-h-0" : "h-full min-h-0 overflow-hidden sm:h-auto sm:max-h-[min(760px,100dvh)]"
        }`}
      >
        {/* Hero — collapse when keyboard is open so it hides behind/under the keyboard */}
        <div
          className={`relative w-full shrink-0 overflow-hidden bg-gradient-to-br from-primary via-[#15803d] to-[#166534] transition-[max-height,opacity,padding] duration-200 ${
            keyboardOpen
              ? "pointer-events-none max-h-0 opacity-0 py-0"
              : "max-h-[420px] opacity-100 pb-3 pt-[max(0.5rem,env(safe-area-inset-top))]"
          }`}
          aria-hidden={keyboardOpen}
        >
          <div className="absolute top-[-30%] left-[-20%] z-0 h-[120%] w-[140%] rounded-br-[50%] bg-gradient-to-br from-white/25 via-white/10 to-transparent" />

          <button
            type="button"
            onClick={() => navigate("/")}
            className="absolute left-4 top-[max(0.5rem,env(safe-area-inset-top))] z-20 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/25 bg-white/15 text-white shadow-sm backdrop-blur-sm transition hover:bg-white/25 sm:left-5"
            aria-label="Go back to home"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div className="relative z-10 flex flex-col items-center px-4 pb-2 pt-9 text-center sm:px-5 sm:pt-10">
            <button
              type="button"
              onClick={() => navigate("/")}
              className="mb-1.5 flex flex-col items-center gap-1 transition hover:opacity-90"
              aria-label="Go to home"
            >
              <img
                src={logoImage}
                alt="Buddy Service"
                className="h-9 w-9 rounded-xl bg-white object-contain p-0.5 shadow-md sm:h-10 sm:w-10"
              />
              <span className="text-sm font-black tracking-tight text-white sm:text-base">
                Buddy Service
              </span>
            </button>

            <h1 className="mb-3 text-[22px] font-extrabold leading-tight tracking-tight text-white sm:mb-3.5 sm:text-[24px]">
              One App. Everything You Need.
            </h1>

            <div className="flex w-full items-center rounded-2xl border border-white/20 bg-white/15 px-2 py-2 shadow-lg backdrop-blur-md sm:rounded-3xl sm:px-3 sm:py-2.5">
              <div className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white shadow-sm sm:h-10 sm:w-10">
                  <Utensils className="h-4 w-4 text-primary sm:h-5 sm:w-5" strokeWidth={2} />
                </div>
                <span className="text-[9px] font-semibold text-white sm:text-[10px]">Food</span>
              </div>

              <div className="h-6 w-px bg-white/20" />

              <div className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white shadow-sm sm:h-10 sm:w-10">
                  <ShoppingBag className="h-4 w-4 text-primary sm:h-5 sm:w-5" strokeWidth={2} />
                </div>
                <span className="text-center text-[9px] font-semibold leading-tight text-white sm:text-[10px]">
                  Quick
                  <br />
                  Commerce
                </span>
              </div>

              <div className="h-6 w-px bg-white/20" />

              <div className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white shadow-sm sm:h-10 sm:w-10">
                  <IndianRupee className="h-4 w-4 text-primary sm:h-5 sm:w-5" strokeWidth={2} />
                </div>
                <span className="text-[9px] font-semibold text-white sm:text-[10px]">Rewards</span>
              </div>
            </div>
          </div>
        </div>

        <div
          className={`relative z-20 -mt-1 flex min-h-0 flex-1 flex-col rounded-t-[1.75rem] bg-white ${
            keyboardOpen ? "" : "overflow-hidden"
          }`}
        >
          <div
            className={`min-h-0 flex-1 px-5 pb-3 pt-4 sm:px-6 sm:pt-5 ${
              keyboardOpen ? "overflow-visible pb-[max(1rem,env(safe-area-inset-bottom))]" : "overflow-y-auto"
            }`}
          >
            <h2 className="mb-0.5 text-[22px] font-black text-foreground sm:text-[26px]">Welcome!</h2>
            <p className="mb-4 text-sm font-medium text-gray-500 sm:mb-5">
              {step === 1 ? "Login to continue" : `Enter OTP sent on WhatsApp to +91 ${phoneNumber}`}
            </p>

            <AnimatePresence mode="wait">
              {step === 1 ? (
                <motion.form
                  key="step-1"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  onSubmit={handleSendOTP}
                  className="space-y-4"
                >
                  <div>
                    <Label className="mb-1.5 ml-1 block text-[13px] font-bold text-foreground">
                      Mobile Number
                    </Label>
                    <div className="flex h-12 items-center overflow-hidden rounded-[14px] border border-gray-200 bg-white shadow-sm transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
                      <div className="flex h-full shrink-0 items-center gap-1.5 px-3 text-gray-800">
                        <span className="text-sm font-bold">+91</span>
                        <ChevronDown className="hidden h-4 w-4 text-gray-400 sm:block" strokeWidth={3} />
                      </div>
                      <div className="h-6 w-px bg-gray-200" />
                      <input
                        type="tel"
                        required
                        autoFocus
                        autoComplete="tel-national"
                        value={phoneNumber}
                        onChange={(e) =>
                          setPhoneNumber(e.target.value.replace(/\D/g, "").slice(0, 10))
                        }
                        maxLength={10}
                        inputMode="numeric"
                        className="login-phone-input h-full min-w-0 flex-1 bg-white px-3 text-sm font-bold text-gray-900 outline-none placeholder:text-gray-400"
                        placeholder="Enter mobile number"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || phoneNumber.length < 10}
                    className="relative flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-[14px] bg-primary text-base font-bold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:bg-primary/90 active:scale-[0.98] disabled:bg-gray-200 disabled:text-gray-400"
                  >
                    {loading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        <span>Get OTP</span>
                        <ArrowRight className="absolute right-4 h-5 w-5" strokeWidth={2.5} />
                      </>
                    )}
                  </button>
                </motion.form>
              ) : (
                <motion.form
                  key="step-2"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  onSubmit={handleVerifyOTP}
                  className="space-y-4"
                >
                  <div>
                    <Label className="mb-1.5 ml-1 block text-[13px] font-bold text-foreground">
                      Enter OTP Code
                    </Label>
                    <div className="grid grid-cols-4 gap-2">
                      {[0, 1, 2, 3].map((index) => (
                        <input
                          key={index}
                          id={`otp-${index}`}
                          type="tel"
                          inputMode="numeric"
                          required
                          autoFocus={index === 0}
                          value={otp[index] || ""}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, "").slice(-1)
                            if (!val) return
                            const newOtp = otp.split("")
                            newOtp[index] = val
                            const combined = newOtp.join("").slice(0, 4)
                            setOtp(combined)
                            if (index < 3 && val) {
                              document.getElementById(`otp-${index + 1}`)?.focus()
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Backspace") {
                              if (!otp[index] && index > 0) {
                                document.getElementById(`otp-${index - 1}`)?.focus()
                              } else {
                                const newOtp = otp.split("")
                                newOtp[index] = ""
                                setOtp(newOtp.join(""))
                              }
                            }
                          }}
                          className="h-12 w-full rounded-[14px] border border-primary/40 bg-white text-center text-xl font-bold text-gray-900 shadow-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
                          placeholder="•"
                          aria-label={`OTP digit ${index + 1}`}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col items-center gap-2">
                    <div className="flex items-center gap-2 text-[13px] font-semibold">
                      {resendTimer > 0 ? (
                        <span className="text-gray-400">
                          Resend code in{" "}
                          <span className="text-primary">{formatResendTimer(resendTimer)}</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={handleResendOTP}
                          className="text-primary hover:underline"
                        >
                          Didn&apos;t receive code? Resend
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={handleEditNumber}
                      className="text-[13px] text-gray-400 transition-colors hover:text-primary"
                    >
                      Edit phone number
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || otp.length < 4}
                    className="relative flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-[14px] bg-primary text-base font-bold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:bg-primary/90 active:scale-[0.98] disabled:bg-gray-200 disabled:text-gray-400"
                  >
                    {loading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        <span>Verify & Continue</span>
                        <ArrowRight className="absolute right-4 h-5 w-5" strokeWidth={2.5} />
                      </>
                    )}
                  </button>
                </motion.form>
              )}
            </AnimatePresence>
          </div>

          <div
            className={`mt-auto flex shrink-0 flex-col items-center rounded-t-[1.5rem] bg-secondary px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-4 ${
              keyboardOpen ? "hidden" : ""
            }`}
          >
            <div className="mb-2 flex w-full max-w-sm justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-primary" strokeWidth={1.5} />
                <span className="text-[9px] font-semibold leading-tight text-gray-600">
                  Secure
                  <br />
                  & Safe
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Zap className="h-4 w-4 text-primary" strokeWidth={1.5} />
                <span className="text-[9px] font-semibold leading-tight text-gray-600">
                  Fast
                  <br />
                  Delivery
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <BadgeCheck className="h-4 w-4 text-primary" strokeWidth={1.5} />
                <span className="text-[9px] font-semibold leading-tight text-gray-600">
                  Trusted by
                  <br />
                  Millions
                </span>
              </div>
            </div>

            <p className="max-w-[280px] text-center text-[10px] font-medium text-gray-500">
              By continuing, you agree to our{" "}
              <Link
                to="/terms"
                state={{ from: `${loginLocation.pathname}${loginLocation.search}` }}
                className="font-semibold text-primary hover:underline"
              >
                Terms & Conditions
              </Link>{" "}
              and{" "}
              <Link
                to="/privacy"
                state={{ from: `${loginLocation.pathname}${loginLocation.search}` }}
                className="font-semibold text-primary hover:underline"
              >
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </div>
      </div>

      {/* Name modal */}
      <Dialog open={showNameModal} onOpenChange={setShowNameModal}>
        <DialogContent
          className="w-[calc(100%-2rem)] sm:w-full sm:max-w-[425px] mx-auto rounded-3xl border-none p-0 overflow-hidden bg-white"
          showCloseButton={false}
        >
          <div className="bg-primary p-6 sm:p-8 text-center relative">
            <div className="absolute top-[-20%] right-[-10%] w-32 h-32 bg-white/10 rounded-full blur-2xl" />
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="w-16 h-16 sm:w-20 sm:h-20 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center mx-auto mb-4 border border-white/30"
            >
              <User className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
            </motion.div>
            <DialogTitle className="text-xl sm:text-2xl font-bold text-white mb-2">
              Almost there!
            </DialogTitle>
            <DialogDescription className="text-white/80 text-sm sm:text-base">
              We&apos;d love to know your name to personalize your experience.
            </DialogDescription>
          </div>

          <form onSubmit={handleNameSubmit} className="p-6 sm:p-8 pt-5 sm:pt-6 space-y-6">
            <div className="space-y-4">
              <Label htmlFor="name" className="text-sm font-medium text-gray-700 ml-1">
                Full Name
              </Label>
              <Input
                id="name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Enter your name"
                className="pl-4 h-12 sm:h-14 bg-gray-50 border-gray-200 rounded-[14px] focus:ring-2 focus:ring-primary transition-all"
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-3">
              <button
                type="submit"
                disabled={isUpdatingName}
                className="w-full h-12 sm:h-14 bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground rounded-[14px] font-bold text-base sm:text-lg shadow-lg shadow-primary/25 transition-all active:scale-[0.98] flex items-center justify-center"
              >
                {isUpdatingName ? <Loader2 className="h-5 w-5 animate-spin" /> : "Complete Profile"}
              </button>
              {!pendingVerify ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowNameModal(false)
                    navigate("/user/auth/portal", { replace: true })
                  }}
                  className="text-sm text-gray-400 hover:text-gray-600 transition-colors py-2"
                >
                  Skip for now
                </button>
              ) : (
                <p className="text-xs text-gray-400 text-center">
                  Name is required to complete signup.
                </p>
              )}
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {/* Deactivated Account Modal */}
      <Dialog open={deactivatedError} onOpenChange={setDeactivatedError}>
        <DialogContent className="sm:max-w-[400px] w-[calc(100%-2rem)] mx-auto p-0 overflow-hidden border-0 bg-white rounded-[24px] sm:rounded-[2rem]">
          <div className="bg-red-50 p-6 flex flex-col items-center justify-center border-b border-red-100">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
              <ShieldCheck className="w-8 h-8 text-red-600" />
            </div>
            <DialogTitle className="text-xl sm:text-2xl font-bold text-gray-900 text-center m-0">
              Account Deactivated
            </DialogTitle>
          </div>
          <div className="p-6">
            <DialogDescription className="text-center text-[15px] sm:text-base text-gray-600 mb-6">
              Your account has been temporarily deactivated by the admin. You won't be able to log in at this time.
            </DialogDescription>
            <button
              type="button"
              onClick={() => setDeactivatedError(false)}
              className="w-full h-12 sm:h-14 bg-red-600 hover:bg-red-700 text-white rounded-xl sm:rounded-2xl font-bold text-[15px] sm:text-base transition-all active:scale-[0.98] shadow-sm"
            >
              Close
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
