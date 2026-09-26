import { MapPin, Menu, Search } from "lucide-react"
import { useRestaurantSession } from "@food/context/RestaurantSessionContext"

function formatRestaurantLocation(restaurant) {
  if (!restaurant) return ""

  const location = restaurant.location || {}
  const candidates = [
    location.formattedAddress,
    location.address,
    restaurant.address,
    restaurant.formattedAddress,
  ]

  for (const value of candidates) {
    if (typeof value !== "string") continue
    const trimmed = value.trim()
    if (!trimmed || trimmed === "Select location") continue
    if (/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(trimmed)) continue
    return trimmed
  }

  const parts = [
    location.addressLine1 || location.street,
    location.area || location.locality || location.landmark,
    location.city,
    location.state,
    location.zipCode || location.pincode || location.postalCode,
  ]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)

  return parts.join(", ")
}

export default function RestaurantPanelHeader({
  title,
  subtitle,
  showSearch = false,
  showLocation = true,
  onMenuClick,
  rightSlot = null,
  className = "",
}) {
  const { restaurant } = useRestaurantSession()

  const restaurantName =
    restaurant?.restaurantName ||
    restaurant?.name ||
    restaurant?.businessName ||
    "Your restaurant"

  const heading = title || restaurantName
  const locationText = showLocation ? formatRestaurantLocation(restaurant) : ""
  const showLocRow = Boolean(locationText)

  return (
    <header
      className={`sticky top-0 z-40 border-b border-[var(--rt-border)] bg-white/95 backdrop-blur-md ${className}`}
    >
      <div className="flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3 lg:px-6">
        {typeof onMenuClick === "function" ? (
          <button
            type="button"
            onClick={onMenuClick}
            className="inline-flex shrink-0 rounded-xl border border-[var(--rt-border)] p-2 hover:bg-gray-50 lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4 sm:h-5 sm:w-5 text-gray-700" />
          </button>
        ) : null}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-gray-900 sm:text-base lg:text-lg">
            {heading}
          </p>
          {showLocRow ? (
            <div className="mt-0.5 flex min-w-0 items-center gap-1 opacity-80">
              <MapPin className="h-2.5 w-2.5 shrink-0 text-gray-500" />
              <p className="truncate text-[10px] font-medium text-gray-500 sm:text-xs" title={locationText}>
                {locationText}
              </p>
            </div>
          ) : subtitle ? (
            <p className="truncate text-[11px] text-gray-500 sm:text-xs lg:text-sm">{subtitle}</p>
          ) : null}
        </div>

        {rightSlot}

        {showSearch ? (
          <div className="hidden max-w-sm flex-1 items-center gap-2 rounded-2xl border border-[var(--rt-border)] bg-[var(--rt-surface-muted)] px-3 py-2 md:flex">
            <Search className="h-4 w-4 text-gray-400" />
            <input
              type="search"
              placeholder="Search orders, menu..."
              className="w-full bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400"
            />
          </div>
        ) : null}
      </div>
    </header>
  )
}
