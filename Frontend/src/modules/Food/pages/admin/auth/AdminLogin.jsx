import { useState, useRef, useEffect } from "react"
import { useNavigate, Link } from "react-router-dom"
import { motion } from "framer-motion"
import { adminAPI } from "@food/api"
import { setAuthData } from "@food/utils/auth"
import { firstAllowedPath } from "@food/utils/adminAccess"
import {
  ShieldCheck,
  ArrowRight,
  Loader2,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Heart,
  UserCog,
} from "lucide-react"
import logoImage from "@/assets/logo.png"
import { toast } from "sonner"

export default function AdminLogin() {
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const submitting = useRef(false)
  // "Sign in as": the main admin or one of the employee roles (names come from the backend).
  const [roles, setRoles] = useState([])
  const [loginAs, setLoginAs] = useState("main")

  useEffect(() => {
    adminAPI
      .getLoginRoles()
      .then((res) => setRoles(res?.data?.data?.roles || []))
      .catch(() => {})
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    if (!email || !password) {
      toast.error("Please fill in all fields")
      return
    }
    if (submitting.current) return
    submitting.current = true
    setLoading(true)

    try {
      const response = await adminAPI.login(email.trim(), password, loginAs)
      const data = response?.data?.data || response?.data || {}

      const accessToken = data.accessToken
      const adminUser = data.user || data.admin
      const refreshToken = data.refreshToken ?? null

      if (!accessToken || !adminUser || !refreshToken) {
        throw new Error("Invalid response from server")
      }

      setAuthData("admin", accessToken, adminUser, refreshToken)
      toast.success(adminUser?.access?.isEmployee ? `Welcome, ${adminUser.name || "team member"}` : "Welcome, Administrator")
      // An employee lands on the first page their role allows.
      navigate(firstAllowedPath() || "/admin/food", { replace: true })
    } catch (err) {
      const msg =
        err?.response?.data?.message || err?.message || "Login failed. Check your credentials."
      toast.error(msg)
    } finally {
      setLoading(false)
      submitting.current = false
    }
  }

  return (
    <div className="min-h-screen min-h-dvh bg-gray-50 font-[family-name:var(--font-poppins)] lg:grid lg:grid-cols-2">
      {/* Brand panel — desktop */}
      <div className="hidden lg:flex relative overflow-hidden bg-gradient-to-br from-primary via-[#15803d] to-[#0f172a] text-white p-10 xl:p-14 flex-col justify-center">
        <div className="absolute top-0 right-0 w-72 h-72 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-white/5 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4" />

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-10">
            <img
              src={logoImage}
              alt="Buddy Service"
              className="w-11 h-11 rounded-xl bg-white p-1 object-contain shadow-lg"
            />
            <span className="text-lg font-bold tracking-tight">Buddy Service</span>
          </div>

          <h1 className="text-4xl xl:text-5xl font-bold leading-tight tracking-tight mb-4 max-w-md">
            Admin dashboard access
          </h1>
          <p className="text-white/80 text-base leading-relaxed max-w-md mb-10">
            Manage orders, menus, riders, and business settings from one secure workspace.
          </p>

          <ul className="space-y-4">
            {[
              { icon: ShieldCheck, label: "Secure admin access" },
              { icon: UserCog, label: "Manage food operations" },
              { icon: Lock, label: "Role-based permissions" },
            ].map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3 text-sm font-medium text-white/90">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 border border-white/10">
                  <Icon className="h-4 w-4" />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-col items-center justify-center px-5 py-10 sm:px-8 lg:px-12 xl:px-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          {/* Mobile brand */}
          <div className="lg:hidden text-center mb-8">
            <img
              src={logoImage}
              alt="Buddy Service"
              className="w-24 h-24 sm:w-28 sm:h-28 object-contain mx-auto mb-3 drop-shadow-lg"
            />
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-muted-foreground">
              Admin Panel
            </p>
          </div>

          <div className="bg-white rounded-3xl border border-border shadow-xl shadow-slate-200/60 p-6 sm:p-8 lg:p-10">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-2 hidden lg:block">
              Admin panel
            </p>
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight mb-1">
              Sign in
            </h2>
            <p className="text-sm text-muted-foreground mb-8">
              Authorized access only. Use your admin credentials.
            </p>

            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="admin-login-as" className="text-sm font-semibold text-foreground">
                  Sign in as
                </label>
                <div className="relative flex items-center h-12 sm:h-14 rounded-xl border border-border bg-white focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 transition-all">
                  <UserCog className="absolute left-4 h-5 w-5 text-muted-foreground pointer-events-none" />
                  <select
                    id="admin-login-as"
                    value={loginAs}
                    onChange={(e) => setLoginAs(e.target.value)}
                    className="w-full h-full pl-12 pr-4 bg-transparent text-sm sm:text-base font-medium text-foreground outline-none appearance-none cursor-pointer"
                  >
                    <option value="main">Main Admin</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="admin-email" className="text-sm font-semibold text-foreground">
                  Email address
                </label>
                <div className="relative flex items-center h-12 sm:h-14 rounded-xl border border-border bg-white focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 transition-all">
                  <Mail className="absolute left-4 h-5 w-5 text-muted-foreground pointer-events-none" />
                  <input
                    id="admin-email"
                    type="email"
                    required
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@example.com"
                    className="w-full h-full pl-12 pr-4 bg-transparent text-sm sm:text-base font-medium text-foreground outline-none placeholder:text-muted-foreground/70"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="admin-password" className="text-sm font-semibold text-foreground">
                    Password
                  </label>
                  <Link
                    to="/admin/forgot-password"
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative flex items-center h-12 sm:h-14 rounded-xl border border-border bg-white focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 transition-all">
                  <Lock className="absolute left-4 h-5 w-5 text-muted-foreground pointer-events-none" />
                  <input
                    id="admin-password"
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full h-full pl-12 pr-12 bg-transparent text-sm sm:text-base font-medium text-foreground outline-none placeholder:text-muted-foreground/70"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 p-1 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-12 sm:h-14 flex items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground font-semibold text-base shadow-lg shadow-primary/25 transition-all active:scale-[0.99]"
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <span>Enter dashboard</span>
                    <ArrowRight className="h-5 w-5" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-8 pt-6 border-t border-border flex flex-wrap justify-center gap-4 sm:gap-6">
              <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <ShieldCheck className="h-4 w-4" />
                Secure access
              </span>
              <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Heart className="h-4 w-4" />
                Admin control
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
