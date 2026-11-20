import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { UserCog, Plus, Pencil, Trash2, Loader2, X, Mail, Eye, EyeOff, Wand2, Copy, ShieldCheck, KeyRound, Power } from "lucide-react"
import { toast } from "sonner"
import { adminAPI } from "@food/api"

const emptyForm = { id: "", name: "", email: "", phone: "", roleId: "", password: "", isActive: true }
const fmt = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never")
const msg = (e, fallback) => e?.response?.data?.message || e?.message || fallback

export default function AccessEmployees() {
  const [employees, setEmployees] = useState([])
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const [busyId, setBusyId] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [e, r] = await Promise.all([adminAPI.accessEmployees(), adminAPI.accessRoles()])
      setEmployees(e?.data?.data?.employees || [])
      setRoles(r?.data?.data?.roles || [])
    } catch (e) {
      toast.error(msg(e, "Could not load employees"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const activeRoles = roles.filter((r) => r.isActive)

  const generate = async () => {
    try {
      const res = await adminAPI.accessGeneratePassword()
      setForm((f) => ({ ...f, password: res?.data?.data?.password || "" }))
      setShowPw(true)
    } catch (e) {
      toast.error(msg(e, "Could not generate a password"))
    }
  }

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Copied")
    } catch {
      toast.error("Could not copy")
    }
  }

  const reportEmail = (emailSent, password, to) => {
    if (emailSent === false) {
      toast.warning(`Saved, but the login email to ${to} could not be sent. Share the password yourself, or use "Resend" once email is fixed.`, { duration: 9000 })
      if (password) copy(password)
    } else if (emailSent) {
      toast.success(`Login details emailed to ${to}`)
    }
  }

  const save = async () => {
    const isNew = !form.id
    if (!form.name.trim()) return toast.error("Enter the employee's name")
    if (isNew && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return toast.error("Enter a valid email")
    if (!form.roleId) return toast.error("Select a role")
    if (isNew && form.password.length < 8) return toast.error("Password must be at least 8 characters")
    if (!isNew && form.password && form.password.length < 8) return toast.error("Password must be at least 8 characters")
    setSaving(true)
    try {
      let res
      if (isNew) {
        res = await adminAPI.accessCreateEmployee({ name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), roleId: form.roleId, password: form.password })
        toast.success("Employee created")
      } else {
        res = await adminAPI.accessUpdateEmployee(form.id, { name: form.name.trim(), phone: form.phone.trim(), roleId: form.roleId, isActive: form.isActive, ...(form.password ? { password: form.password } : {}) })
        toast.success("Employee updated")
      }
      const data = res?.data?.data || {}
      if (isNew || form.password) reportEmail(data.emailSent, form.password, form.email)
      setForm(null)
      load()
    } catch (e) {
      toast.error(msg(e, "Could not save the employee"))
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (emp) => {
    setBusyId(emp.id)
    try {
      await adminAPI.accessUpdateEmployee(emp.id, { isActive: !emp.isActive })
      toast.success(emp.isActive ? "Employee deactivated" : "Employee activated")
      load()
    } catch (e) {
      toast.error(msg(e, "Could not update"))
    } finally {
      setBusyId("")
    }
  }

  const resend = async (emp) => {
    if (!window.confirm(`Generate a new password for ${emp.name} and email it to ${emp.email}? Their old password stops working.`)) return
    setBusyId(emp.id)
    try {
      const res = await adminAPI.accessResendCredentials(emp.id)
      const d = res?.data?.data || {}
      reportEmail(d.emailSent, d.password, emp.email)
    } catch (e) {
      toast.error(msg(e, "Could not send the credentials"))
    } finally {
      setBusyId("")
    }
  }

  const remove = async (emp) => {
    if (!window.confirm(`Delete ${emp.name}? They will no longer be able to sign in.`)) return
    setBusyId(emp.id)
    try {
      await adminAPI.accessDeleteEmployee(emp.id)
      toast.success("Employee deleted")
      load()
    } catch (e) {
      toast.error(msg(e, "Could not delete"))
    } finally {
      setBusyId("")
    }
  }

  const openNew = () => {
    setShowPw(false)
    setForm({ ...emptyForm, roleId: activeRoles[0]?.id || "" })
  }
  const openEdit = (emp) => {
    setShowPw(false)
    setForm({ id: emp.id, name: emp.name, email: emp.email, phone: emp.phone || "", roleId: emp.roleId, password: "", isActive: emp.isActive })
  }

  return (
    <div className="mx-auto max-w-6xl p-4 lg:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-100 text-sky-700"><UserCog className="h-6 w-6" /></span>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Employees</h1>
            <p className="text-sm text-slate-500">Add people to a role. Their login ID and password are emailed to them.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link to="/admin/access/roles" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <ShieldCheck className="h-4 w-4" /> Roles
          </Link>
          <button onClick={openNew} disabled={activeRoles.length === 0} title={activeRoles.length === 0 ? "Create a role first" : ""} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow hover:bg-emerald-700 disabled:opacity-50">
            <Plus className="h-4 w-4" /> Add employee
          </button>
        </div>
      </div>

      {!loading && activeRoles.length === 0 ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          There is no active role yet. <Link to="/admin/access/roles" className="font-bold underline">Create a role</Link> first, then add employees to it.
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div>
        ) : employees.length === 0 ? (
          <div className="p-14 text-center text-slate-500">No employees yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Last login</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{emp.name || "-"}</div>
                      <div className="flex items-center gap-1 text-xs text-slate-500"><Mail className="h-3 w-3" /> {emp.email}</div>
                      {emp.phone ? <div className="text-xs text-slate-400">{emp.phone}</div> : null}
                    </td>
                    <td className="px-4 py-3"><span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700">{emp.roleName || "-"}</span></td>
                    <td className="px-4 py-3 text-xs text-slate-600">{fmt(emp.lastLogin)}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${emp.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{emp.isActive ? "Active" : "Inactive"}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {busyId === emp.id ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
                          <>
                            <button onClick={() => openEdit(emp)} className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100" aria-label="Edit" title="Edit"><Pencil className="h-4 w-4" /></button>
                            <button onClick={() => resend(emp)} className="rounded-lg border border-slate-200 p-2 text-sky-600 hover:bg-sky-50" aria-label="Reset password and email" title="Reset password and email login details"><KeyRound className="h-4 w-4" /></button>
                            <button onClick={() => toggleActive(emp)} className={`rounded-lg border p-2 ${emp.isActive ? "border-amber-200 text-amber-600 hover:bg-amber-50" : "border-emerald-200 text-emerald-600 hover:bg-emerald-50"}`} aria-label={emp.isActive ? "Deactivate" : "Activate"} title={emp.isActive ? "Deactivate" : "Activate"}><Power className="h-4 w-4" /></button>
                            <button onClick={() => remove(emp)} className="rounded-lg border border-rose-200 p-2 text-rose-600 hover:bg-rose-50" aria-label="Delete" title="Delete"><Trash2 className="h-4 w-4" /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {form ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-bold text-slate-900">{form.id ? "Edit employee" : "Add employee"}</h2>
              <button onClick={() => setForm(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Full name *</span>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Email (login ID) *</span>
                <input type="email" value={form.email} disabled={Boolean(form.id)} onChange={(e) => setForm({ ...form, email: e.target.value })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50 disabled:text-slate-500" />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Phone</span>
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Role *</span>
                  <select value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100">
                    <option value="">Select role</option>
                    {(form.id ? roles : activeRoles).map((r) => <option key={r.id} value={r.id}>{r.name}{r.isActive ? "" : " (inactive)"}</option>)}
                  </select>
                </label>
              </div>
              <div>
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{form.id ? "New password (leave empty to keep)" : "Password *"}</span>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input type={showPw ? "text" : "password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Minimum 8 characters" className="h-11 w-full rounded-xl border border-slate-200 px-3 pr-10 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
                    <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 hover:text-slate-700" aria-label="Show password">{showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                  </div>
                  <button type="button" onClick={generate} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50" title="Generate a strong password"><Wand2 className="h-4 w-4" /> Generate</button>
                  {form.password ? <button type="button" onClick={() => copy(form.password)} className="rounded-xl border border-slate-200 px-3 text-slate-600 hover:bg-slate-50" aria-label="Copy password"><Copy className="h-4 w-4" /></button> : null}
                </div>
                <p className="mt-1.5 text-xs text-slate-500">{form.id ? "If you set a new password it is emailed to the employee and they are signed out." : "The login ID and this password are emailed to the employee."}</p>
              </div>
              {form.id ? (
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                  <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="h-4 w-4 accent-emerald-600" /> Account is active
                </label>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button onClick={() => setForm(null)} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">Cancel</button>
              <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {form.id ? "Save changes" : "Create & email login"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
