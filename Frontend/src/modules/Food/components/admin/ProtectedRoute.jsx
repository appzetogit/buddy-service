import { useEffect, useState } from "react"
import { Navigate, useLocation } from "react-router-dom"
import { isModuleAuthenticated, clearModuleAuth } from "@food/utils/auth"
import { adminAPI } from "@food/api"
import { canViewPath, firstAllowedPath, isEmployeeAdmin, storeAdminAccess } from "@food/utils/adminAccess"

export default function ProtectedRoute({ children }) {
  const location = useLocation()
  const isAuthenticated = isModuleAuthenticated("admin")
  const [, setTick] = useState(0)

  // Employees: pick up role changes (pages, zones, deactivation) made since they signed in.
  useEffect(() => {
    if (!isAuthenticated || !isEmployeeAdmin()) return undefined
    let cancelled = false
    adminAPI
      .getMyAccess()
      .then((res) => {
        const access = res?.data?.data
        if (cancelled || !access) return
        storeAdminAccess(access)
        setTick((n) => n + 1)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" state={{ from: location.pathname }} replace />
  }

  if (isEmployeeAdmin() && !canViewPath(location.pathname)) {
    const target = firstAllowedPath()
    if (target && target !== location.pathname) return <Navigate to={target} replace />
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 p-6 text-center">
        <h1 className="text-xl font-bold text-slate-900">No access</h1>
        <p className="max-w-sm text-sm text-slate-500">Your role does not give you access to any page yet. Please contact the main admin.</p>
        <button
          onClick={() => {
            clearModuleAuth("admin")
            window.location.href = "/admin/login"
          }}
          className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white"
        >
          Sign out
        </button>
      </div>
    )
  }

  return children
}
