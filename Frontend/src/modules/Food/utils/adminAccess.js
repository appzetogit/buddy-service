import { adminSidebarMenu } from "@food/utils/adminSidebarMenu"
import { quickAdminSidebarMenu } from "@food/utils/quickAdminSidebarMenu"
import { taxiAdminSidebarMenu } from "@food/utils/taxiAdminSidebarMenu"

/**
 * Admin employee access (roles).
 *
 * A role grants pages of the three admin sidebars. A permission key is simply the page path of a
 * sidebar entry, e.g. "/admin/food/orders/all" -> { view, create, edit, delete }. The sidebars are
 * the single catalog, so a new menu entry is automatically something a role can grant.
 * The main admin has no role and is never restricted here.
 */
export const ACCESS_MODULES = [
  { key: "food", label: "Food", base: "/admin/food", menu: adminSidebarMenu },
  { key: "quick", label: "Marketplace", base: "/admin/quick-commerce", menu: quickAdminSidebarMenu },
  { key: "taxi", label: "Taxi", base: "/admin/taxi", menu: taxiAdminSidebarMenu },
]
export const ACCESS_ACTIONS = ["view", "create", "edit", "delete"]

/** Own-profile pages every admin may open. */
const OWN_PAGES = new Set(["/admin/food/profile", "/admin/taxi/profile", "/admin/quick-commerce/profile"])

const normalize = (p) => {
  const v = String(p || "").split("?")[0].split("#")[0].replace(/\/+$/, "")
  return v || "/"
}

// ---- catalog (what a role editor lists) -------------------------------------------------------
const collect = (items = [], group, parentLabel = "") => {
  const rows = []
  for (const item of items) {
    if (item.hidden) continue
    if (item.type === "section" && item.items) {
      rows.push(...collect(item.items, item.label || group))
    } else if ((item.type === "expandable" || item.subItems) && item.subItems) {
      rows.push(...collect(item.subItems.filter((s) => !s.hidden).map((s) => ({ ...s, type: "link" })), group, item.label))
    } else if (item.path) {
      rows.push({ group: group || "General", label: parentLabel ? `${parentLabel} › ${item.label}` : item.label, path: normalize(item.path) })
    }
  }
  return rows
}

/** [{ key, label, base, groups: [{ title, items: [{ label, path }] }] }] */
export const buildAccessCatalog = () =>
  ACCESS_MODULES.map((m) => {
    const flat = collect(m.menu, "General")
    const groups = []
    for (const row of flat) {
      let g = groups.find((x) => x.title === row.group)
      if (!g) groups.push((g = { title: row.group, items: [] }))
      if (!g.items.some((i) => i.path === row.path)) g.items.push({ label: row.label, path: row.path })
    }
    return { key: m.key, label: m.label, base: m.base, groups }
  })

// ---- the signed-in admin ----------------------------------------------------------------------
const readAdminUser = () => {
  try {
    return JSON.parse(localStorage.getItem("admin_user") || "null")
  } catch {
    return null
  }
}

export const getAdminAccess = () => readAdminUser()?.access || null
export const isEmployeeAdmin = () => getAdminAccess()?.isEmployee === true

/** Keeps the stored session in step with the role (called after /access/me). */
export const storeAdminAccess = (access) => {
  const user = readAdminUser()
  if (!user || !access) return
  try {
    localStorage.setItem("admin_user", JSON.stringify({ ...user, access }))
  } catch {
    /* storage full / blocked: the next login refreshes it */
  }
}

const parentOf = (key) => key.slice(0, key.lastIndexOf("/"))
const depth = (p) => p.split("/").filter(Boolean).length

/**
 * Flags that apply to a path: the longest granted page that is the path or a parent of it (module
 * roots match exactly). A detail page like /admin/food/orders/123 is not in the menu, so it falls
 * back to the granted pages of its section. Same rule as the backend guard.
 */
const flagsFor = (permissions, path) => {
  const bases = ACCESS_MODULES.map((m) => m.base)
  let best = null
  for (const key of Object.keys(permissions || {})) {
    const isRoot = bases.includes(key)
    const hit = key === path || (!isRoot && path.startsWith(`${key}/`))
    if (hit && (!best || key.length > best.length)) best = key
  }
  if (best) return permissions[best]
  const merged = {}
  let any = false
  for (const [key, flags] of Object.entries(permissions || {})) {
    const parent = parentOf(key)
    if (depth(parent) >= 3 && path.startsWith(`${parent}/`)) {
      any = true
      for (const a of ACCESS_ACTIONS) merged[a] = merged[a] || flags[a] === true
    }
  }
  return any ? merged : null
}

export const canDoOnPath = (path, action = "view") => {
  const access = getAdminAccess()
  if (!access?.isEmployee) return true // main admin
  const p = normalize(path)
  if (OWN_PAGES.has(p)) return true
  const flags = flagsFor(access.permissions, p)
  if (!flags?.view) return false
  if (action === "view") return true
  if (action === "create") return Boolean(flags.create || flags.edit)
  return Boolean(flags[action])
}

export const canViewPath = (path) => canDoOnPath(path, "view")

export const canAccessModule = (moduleKey) => {
  const access = getAdminAccess()
  if (!access?.isEmployee) return true
  const m = ACCESS_MODULES.find((x) => x.key === moduleKey)
  if (!m) return false
  return Object.keys(access.permissions || {}).some((k) => k === m.base || k.startsWith(`${m.base}/`))
}

/** First page the employee may open (for the redirect after login). */
export const firstAllowedPath = () => {
  const access = getAdminAccess()
  if (!access?.isEmployee) return "/admin/food"
  for (const m of buildAccessCatalog()) {
    for (const g of m.groups) {
      for (const item of g.items) if (canViewPath(item.path)) return item.path
    }
  }
  return null
}

/** Sidebar menu with only the entries the employee may open; empty sections are dropped. */
export const filterMenuByAccess = (menu = []) => {
  if (!isEmployeeAdmin()) return menu
  const out = []
  for (const item of menu) {
    if (item.type === "section" && item.items) {
      const items = filterMenuByAccess(item.items)
      if (items.length) out.push({ ...item, items })
    } else if (item.subItems) {
      const subItems = item.subItems.filter((s) => canViewPath(s.path))
      if (subItems.length) out.push({ ...item, subItems })
    } else if (item.path) {
      if (canViewPath(item.path)) out.push(item)
    } else {
      out.push(item)
    }
  }
  return out
}
