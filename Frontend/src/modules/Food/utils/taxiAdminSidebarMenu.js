import { ADMIN_SIDEBAR_SECTIONS } from "@taxi/modules/admin/constants/adminSidebar"

/**
 * Taxi admin menu, in the same shape the platform sidebar renders for Food and Quick Commerce.
 * It is derived from the taxi module's own menu definition (single source of truth), with every
 * path moved under /admin/taxi and icons passed by name.
 */
const TAXI_BASE = "/admin/taxi"

const toPath = (path) => {
  if (!path) return path
  const value = String(path)
  if (value.startsWith(TAXI_BASE)) return value
  return value.replace(/^\/admin(?=\/|$)/, TAXI_BASE)
}

const iconName = (icon) => (typeof icon === "string" ? icon : icon?.displayName || icon?.name || "Car")

// The platform sidebar renders two levels; a third level (e.g. Driver > Driver Wallet > ...) is
// flattened into its parent group, prefixed with the group name so entries stay distinguishable.
const flattenSubItems = (subItems = [], prefix = "") =>
  subItems.flatMap((sub) =>
    sub.subItems?.length
      ? flattenSubItems(sub.subItems, `${prefix}${sub.label} - `)
      : [{ label: `${prefix}${sub.label}`, path: toPath(sub.path) }]
  )

const toItem = (item) => {
  if (item.subItems?.length) {
    return {
      type: "expandable",
      label: item.label,
      icon: iconName(item.icon),
      subItems: flattenSubItems(item.subItems),
    }
  }
  return { type: "link", label: item.label, icon: iconName(item.icon), path: toPath(item.path) }
}

export const taxiAdminSidebarMenu = ADMIN_SIDEBAR_SECTIONS.map((section) => ({
  type: "section",
  label: String(section.title || "").toUpperCase(),
  items: (section.items || []).filter((item) => item.path || item.subItems?.length).map(toItem),
}))

export const TAXI_ADMIN_HOME_PATH = `${TAXI_BASE}/dashboard`
