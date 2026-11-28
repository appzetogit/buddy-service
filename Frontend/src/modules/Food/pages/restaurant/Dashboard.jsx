import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { createPortal } from "react-dom"
import { motion } from "framer-motion"
import {
  FileText,
  Package,
  IndianRupee,
  LifeBuoy,
  ChevronRight,
  Loader2,
  Power,
  Star,
  Calendar,
  MessageSquare,
  RefreshCw,
  TrendingUp,
} from "lucide-react"
import RestaurantPanelHeader from "@food/components/restaurant/panel/RestaurantPanelHeader"
import PanelCard from "@food/components/restaurant/panel/PanelCard"
import useRestaurantDashboardData from "@food/hooks/useRestaurantDashboardData"
import { RESTAURANT_BASE } from "@food/utils/restaurantNavConfig"
import { ENABLE_DINING } from "@/shared/featureFlags"
import { restaurantAPI } from "@food/api"
import { Switch } from "@food/components/ui/switch"
import { toast } from "sonner"

const formatCurrency = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0)

function MetricPill({ label, value, sublabel, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        min-w-[108px] sm:min-w-[132px] shrink-0 rounded-2xl sm:rounded-[20px] border px-3 py-2 sm:px-4 sm:py-3 text-left transition
        ${active ? "rt-pill-active shadow-sm" : "border-[var(--rt-border)] bg-white hover:bg-gray-50"}
      `}
    >
      <p className="text-[10px] sm:text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-0.5 text-base sm:mt-1 sm:text-lg font-bold text-gray-900 leading-tight">{value}</p>
      {sublabel ? <p className="mt-0.5 text-[10px] sm:text-[11px] text-gray-400">{sublabel}</p> : null}
    </button>
  )
}

// Same switch as Outlet timings -> Online status; the backend enforces the approval/review rules.
function AcceptingOrdersToggle({ checked, busy, onChange, className = "" }) {
  return (
    <label
      className={`inline-flex items-center gap-2 rounded-xl border border-[var(--rt-border)] bg-white px-2.5 py-1.5 shadow-sm ${className}`}
    >
      <span className="whitespace-nowrap text-[11px] font-semibold text-gray-700 sm:text-xs">
        {checked ? "Accepting orders" : "Not accepting"}
      </span>
      <Switch
        checked={checked}
        disabled={busy}
        onCheckedChange={onChange}
        aria-label="Accepting orders"
        className="data-[state=checked]:bg-[var(--rt-primary-strong)] data-[state=unchecked]:bg-gray-300 disabled:opacity-60"
      />
    </label>
  )
}

function QuickTile({ icon: Icon, title, subtitle, onClick, badge }) {
  return (
    <PanelCard onClick={onClick} hoverable padding="p-0" className="overflow-hidden">
      <div className="flex h-full flex-col p-2.5 sm:p-4">
        <div className="mb-1.5 sm:mb-3 flex items-start justify-between gap-1.5 sm:gap-2">
          <div className="flex h-8 w-8 sm:h-11 sm:w-11 items-center justify-center rounded-xl sm:rounded-2xl bg-[var(--rt-primary-soft)] text-[var(--rt-primary-strong)]">
            <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
          {badge ? (
            <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] sm:px-2 sm:text-[11px] font-bold text-white">
              {badge}
            </span>
          ) : null}
        </div>
        <p className="text-sm sm:text-base font-semibold text-gray-900 leading-tight">{title}</p>
        <p className="mt-0.5 sm:mt-1 line-clamp-2 text-[11px] sm:text-sm text-gray-500 leading-snug">{subtitle}</p>
        <div className="mt-auto flex items-center justify-end pt-1.5 sm:pt-3 text-[var(--rt-primary-strong)]">
          <ChevronRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </div>
      </div>
    </PanelCard>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const {
    restaurant,
    isOnline,
    todayOrders,
    todayRevenue,
    liveOrders,
    preparingCount,
    readyCount,
    availableBalance,
    openComplaints,
    upcomingReservations,
    averageRating,
    loading,
    refreshing,
    error,
    refresh,
  } = useRestaurantDashboardData()

  const [online, setOnline] = useState(Boolean(isOnline))
  const [togglingOnline, setTogglingOnline] = useState(false)
  useEffect(() => setOnline(Boolean(isOnline)), [isOnline])

  const handleOnlineChange = async (checked) => {
    const previous = online
    setOnline(checked)
    setTogglingOnline(true)
    try {
      await restaurantAPI.updateAcceptingOrders(checked)
      try {
        localStorage.setItem("restaurant_online_status", JSON.stringify(checked))
      } catch {}
      window.dispatchEvent(new CustomEvent("restaurantStatusChanged", { detail: { isOnline: checked } }))
    } catch (err) {
      setOnline(previous)
      toast.error(err?.response?.data?.message || "Could not update online status")
    } finally {
      setTogglingOnline(false)
    }
  }

  const restaurantName =
    restaurant?.restaurantName ||
    restaurant?.name ||
    restaurant?.businessName ||
    "Your restaurant"

  const attentionItems = [
    liveOrders > 0 && { label: `${liveOrders} live orders`, route: `${RESTAURANT_BASE}/orders/live` },
    preparingCount > 0 && { label: `${preparingCount} preparing`, route: `${RESTAURANT_BASE}/orders/live` },
    readyCount > 0 && { label: `${readyCount} ready`, route: `${RESTAURANT_BASE}/orders/live` },
    openComplaints > 0 && {
      label: `${openComplaints} complaints`,
      route: `${RESTAURANT_BASE}/feedback?tab=complaints`,
    },
  ].filter(Boolean)

  return (
    <div
      className={`rt-panel-bg min-h-screen lg:pb-8 ${
        attentionItems.length > 0
          ? "pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:pb-[calc(5rem+env(safe-area-inset-bottom))]"
          : "pb-6 sm:pb-8"
      }`}
    >
      <div className="hidden lg:block">
        <RestaurantPanelHeader
          title={restaurantName}
          subtitle={online ? "Accepting orders" : "Currently offline"}
          showSearch
        />
      </div>

      <div className="mx-auto max-w-7xl px-4 py-4 lg:px-6 lg:py-6">
        <div className="mb-5 flex items-start justify-between gap-3 lg:hidden">
          <div>
            <p className="text-sm font-medium text-[var(--rt-primary-strong)]">Dashboard</p>
            <h1 className="text-2xl font-bold text-gray-900">{restaurantName}</h1>
            <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-[var(--rt-border)] bg-white px-3 py-1 text-sm">
              <span
                className={`h-2.5 w-2.5 rounded-full ${online ? "bg-[var(--rt-primary-strong)]" : "bg-gray-400"}`}
              />
              <span className="font-medium text-gray-700">
                {online ? "Accepting orders" : "Currently offline"}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--rt-border)] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 shadow-sm disabled:opacity-60 sm:text-xs"
              aria-label="Refresh dashboard"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <AcceptingOrdersToggle checked={online} busy={togglingOnline} onChange={handleOnlineChange} />
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-[40vh] sm:min-h-[50vh] items-center justify-center">
            <Loader2 className="h-7 w-7 sm:h-8 sm:w-8 animate-spin text-[var(--rt-primary-strong)]" />
          </div>
        ) : (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3.5 sm:space-y-6">
            {error ? (
              <div className="rounded-xl sm:rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 sm:px-4 sm:py-3 text-xs sm:text-sm text-amber-800">
                {error}
              </div>
            ) : null}

            <section>
              <div className="mb-2 sm:mb-3 flex items-center justify-between">
                <h2 className="text-sm sm:text-base font-bold text-gray-900">Today at a glance</h2>
                <div className="hidden items-center gap-3 lg:flex">
                  <AcceptingOrdersToggle checked={online} busy={togglingOnline} onChange={handleOnlineChange} />
                  <button
                    type="button"
                    onClick={refresh}
                    disabled={refreshing}
                    className="inline-flex items-center gap-1 rounded-xl px-2 py-1 text-sm text-gray-500 hover:bg-white"
                  >
                    <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                    Refresh
                  </button>
                </div>
              </div>
              <div className="flex gap-2 sm:gap-3 overflow-x-auto pb-0.5 scrollbar-hide">
                <MetricPill
                  label="Orders"
                  value={todayOrders}
                  sublabel="Today"
                  active
                  onClick={() => navigate(`${RESTAURANT_BASE}/orders/all`)}
                />
                <MetricPill
                  label="Revenue"
                  value={formatCurrency(todayRevenue)}
                  sublabel="Today"
                  onClick={() => navigate(`${RESTAURANT_BASE}/hub-finance`)}
                />
                <MetricPill
                  label="Payout"
                  value={formatCurrency(availableBalance)}
                  sublabel="Available"
                  onClick={() => navigate(`${RESTAURANT_BASE}/hub-finance`)}
                />
                <MetricPill
                  label="Rating"
                  value={averageRating ? `${averageRating.toFixed(1)} ★` : "—"}
                  sublabel="Average"
                  onClick={() => navigate(`${RESTAURANT_BASE}/feedback`)}
                />
              </div>
            </section>

            <section>
              <h2 className="mb-2 sm:mb-3 text-sm sm:text-base font-bold text-gray-900">Quick actions</h2>
              <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">
                <QuickTile
                  icon={FileText}
                  title="Live orders"
                  subtitle="Accept and manage incoming orders"
                  badge={liveOrders > 0 ? String(liveOrders) : null}
                  onClick={() => navigate(`${RESTAURANT_BASE}/orders/live`)}
                />
                <QuickTile
                  icon={Package}
                  title="Menu"
                  subtitle="Edit dishes, prices and availability"
                  onClick={() => navigate(`${RESTAURANT_BASE}/inventory`)}
                />
                <QuickTile
                  icon={IndianRupee}
                  title="Accounting"
                  subtitle="Payouts, invoices and bank details"
                  onClick={() => navigate(`${RESTAURANT_BASE}/hub-finance`)}
                />
                {ENABLE_DINING ? (
                  <QuickTile
                    icon={Calendar}
                    title="Reservations"
                    subtitle="Table bookings and dining queue"
                    badge={upcomingReservations > 0 ? String(upcomingReservations) : null}
                    onClick={() => navigate(`${RESTAURANT_BASE}/reservations`)}
                  />
                ) : null}
                <QuickTile
                  icon={Power}
                  title="Online status"
                  subtitle="Go online or schedule off time"
                  onClick={() => navigate(`${RESTAURANT_BASE}/outlet-timings`)}
                />
                <QuickTile
                  icon={MessageSquare}
                  title="Feedback"
                  subtitle="Reviews and customer complaints"
                  badge={openComplaints > 0 ? String(openComplaints) : null}
                  onClick={() => navigate(`${RESTAURANT_BASE}/feedback`)}
                />
                <QuickTile
                  icon={MessageSquare}
                  title="Chat with Admin"
                  subtitle="Talk to the support team live"
                  onClick={() => navigate(`${RESTAURANT_BASE}/admin-chat`)}
                />
                <QuickTile
                  icon={LifeBuoy}
                  title="Support"
                  subtitle="Get help from partner team"
                  onClick={() => navigate(`${RESTAURANT_BASE}/help-centre/support`)}
                />
                <QuickTile
                  icon={Star}
                  title="All settings"
                  subtitle="Outlet, delivery, finance and more"
                  onClick={() => navigate(`${RESTAURANT_BASE}/explore`)}
                />
              </div>
            </section>

            <section className="grid gap-2.5 sm:gap-4 lg:grid-cols-2">
              <PanelCard padding="p-3 sm:p-5">
                <div className="mb-2 sm:mb-3 flex items-center gap-1.5 sm:gap-2">
                  <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 text-[var(--rt-primary-strong)]" />
                  <h3 className="text-sm sm:text-base font-bold text-gray-900">Operations summary</h3>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:gap-3 text-xs sm:text-sm">
                  <div className="rounded-xl sm:rounded-2xl bg-[var(--rt-surface-muted)] px-2.5 py-2 sm:px-3 sm:py-3">
                    <p className="text-gray-500">Live queue</p>
                    <p className="text-lg sm:text-xl font-bold text-gray-900 leading-tight">{liveOrders}</p>
                  </div>
                  {ENABLE_DINING ? (
                    <div className="rounded-xl sm:rounded-2xl bg-[var(--rt-surface-muted)] px-2.5 py-2 sm:px-3 sm:py-3">
                      <p className="text-gray-500">Reservations</p>
                      <p className="text-lg sm:text-xl font-bold text-gray-900 leading-tight">{upcomingReservations}</p>
                    </div>
                  ) : (
                    <div className="rounded-xl sm:rounded-2xl bg-[var(--rt-surface-muted)] px-2.5 py-2 sm:px-3 sm:py-3">
                      <p className="text-gray-500">Complaints</p>
                      <p className="text-lg sm:text-xl font-bold text-gray-900 leading-tight">{openComplaints}</p>
                    </div>
                  )}
                  <div className="rounded-xl sm:rounded-2xl bg-[var(--rt-surface-muted)] px-2.5 py-2 sm:px-3 sm:py-3">
                    <p className="text-gray-500">Preparing</p>
                    <p className="text-lg sm:text-xl font-bold text-gray-900 leading-tight">{preparingCount}</p>
                  </div>
                  <div className="rounded-xl sm:rounded-2xl bg-[var(--rt-surface-muted)] px-2.5 py-2 sm:px-3 sm:py-3">
                    <p className="text-gray-500">Ready</p>
                    <p className="text-lg sm:text-xl font-bold text-gray-900 leading-tight">{readyCount}</p>
                  </div>
                </div>
              </PanelCard>

              <PanelCard padding="p-3 sm:p-5">
                <h3 className="mb-2 sm:mb-3 text-sm sm:text-base font-bold text-gray-900">Shortcuts</h3>
                <div className="space-y-1.5 sm:space-y-2">
                  {[
                    { label: "Order history", route: `${RESTAURANT_BASE}/orders/all` },
                    { label: "Delivery settings", route: `${RESTAURANT_BASE}/delivery-settings` },
                    { label: "Outlet information", route: `${RESTAURANT_BASE}/outlet-info` },
                    { label: "Zone setup", route: `${RESTAURANT_BASE}/zone-setup` },
                  ].map((item) => (
                    <button
                      key={item.route}
                      type="button"
                      onClick={() => navigate(item.route)}
                      className="flex w-full items-center justify-between rounded-xl sm:rounded-2xl border border-[var(--rt-border)] px-2.5 py-2 sm:px-3 sm:py-2.5 text-left text-xs sm:text-sm font-medium text-gray-700 hover:bg-[var(--rt-surface-muted)]"
                    >
                      {item.label}
                      <ChevronRight className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-gray-400" />
                    </button>
                  ))}
                </div>
              </PanelCard>
            </section>
          </motion.div>
        )}
      </div>

      {attentionItems.length > 0 && typeof document !== "undefined"
        ? createPortal(
            <div
              className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] lg:left-[270px]"
              style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
            >
              <div className="pointer-events-auto px-3 pb-2 pt-1 sm:px-4 sm:pb-3">
                <div className="mx-auto flex max-w-4xl gap-1.5 overflow-x-auto rounded-xl border border-[var(--rt-border)] bg-white/95 p-1.5 shadow-[0_-4px_24px_rgba(15,23,42,0.12)] backdrop-blur-md scrollbar-hide sm:gap-2 sm:rounded-2xl sm:p-2">
                  {attentionItems.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => navigate(item.route)}
                      className="shrink-0 rounded-lg bg-[var(--rt-primary-soft)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--rt-primary-strong)] sm:rounded-xl sm:px-3 sm:py-2 sm:text-xs"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
