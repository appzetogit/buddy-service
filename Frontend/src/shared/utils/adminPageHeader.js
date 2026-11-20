/**
 * Tells the backend which admin page a request comes from.
 *
 * Employee access is granted per admin page, so every API call made while an /admin page is open
 * carries `x-admin-page: <current admin path>`; the backend allows or refuses the call based on
 * what the employee's role grants on that page. Patched once at the browser level (XHR, which axios
 * uses, and fetch) because Food, Marketplace and Taxi each have their own API client.
 */
const HEADER = "x-admin-page"

const adminPage = () => {
  const path = window.location.pathname || ""
  return path === "/admin" || path.startsWith("/admin/") ? path : ""
}

// Only our own API: relative paths, this origin, or the configured API origin. A custom header on a
// third-party call (maps, analytics) would trigger a CORS preflight and could break it.
const apiOrigin = () => {
  try {
    return new URL(import.meta.env.VITE_API_BASE_URL || "/api/v1", window.location.origin).origin
  } catch {
    return window.location.origin
  }
}

const isApiUrl = (url) => {
  const u = String(url?.href || url || "")
  if (u.startsWith("//")) return false
  if (u.startsWith("/")) return true
  return u.startsWith(window.location.origin) || u.startsWith(apiOrigin())
}

export function installAdminPageHeader() {
  if (typeof window === "undefined" || window.__adminPageHeaderInstalled) return
  window.__adminPageHeaderInstalled = true

  const open = XMLHttpRequest.prototype.open
  const send = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
    this.__adminUrl = url
    return open.call(this, method, url, ...rest)
  }
  XMLHttpRequest.prototype.send = function patchedSend(body) {
    try {
      const page = adminPage()
      if (page && isApiUrl(this.__adminUrl)) this.setRequestHeader(HEADER, page)
    } catch {
      /* never break a request over a header */
    }
    return send.call(this, body)
  }

  const nativeFetch = window.fetch?.bind(window)
  if (nativeFetch) {
    window.fetch = (input, init = {}) => {
      try {
        const url = typeof input === "string" ? input : input?.url
        const page = adminPage()
        if (page && isApiUrl(url)) {
          const headers = new Headers(init.headers || (typeof input !== "string" ? input.headers : undefined))
          if (!headers.has(HEADER)) headers.set(HEADER, page)
          return nativeFetch(input, { ...init, headers })
        }
      } catch {
        /* fall through to the plain call */
      }
      return nativeFetch(input, init)
    }
  }
}
