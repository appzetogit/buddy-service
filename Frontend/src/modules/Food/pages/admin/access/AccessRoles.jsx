import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { ShieldCheck, Plus, Pencil, Trash2, Loader2, X, MapPin, Users } from "lucide-react"
import { toast } from "sonner"
import { adminAPI } from "@food/api"
import { ACCESS_ACTIONS, buildAccessCatalog } from "@food/utils/adminAccess"

const ACTION_LABEL = { view: "View", create: "Create", edit: "Edit", delete: "Delete" }
const emptyForm = { id: "", name: "", description: "", isActive: true, permissions: {}, zones: { food: [], quick: [], taxi: [] } }

const countPages = (permissions) => Object.keys(permissions || {}).length

const Check = ({ checked, onChange, disabled, label }) => (
  <input
    type="checkbox"
    aria-label={label}
    checked={checked}
    disabled={disabled}
    onChange={(e) => onChange(e.target.checked)}
    className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
  />
)

export default function AccessRoles() {
  const catalog = useMemo(() => buildAccessCatalog(), [])
  const [roles, setRoles] = useState([])
  const [zones, setZones] = useState({ food: [], quick: [], taxi: [] })
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(null) // null = closed
  const [moduleTab, setModuleTab] = useState("food")
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [r, z] = await Promise.all([adminAPI.accessRoles(), adminAPI.accessZones()])
      setRoles(r?.data?.data?.roles || [])
      setZones(z?.data?.data || { food: [], quick: [], taxi: [] })
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not load roles")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const openNew = () => {
    setForm({ ...emptyForm, permissions: {}, zones: { food: [], quick: [], taxi: [] } })
    setModuleTab("food")
  }
  const openEdit = (role) => {
    setForm({
      id: role.id,
      name: role.name,
      description: role.description || "",
      isActive: role.isActive !== false,
      permissions: JSON.parse(JSON.stringify(role.permissions || {})),
      zones: { food: [...(role.zones?.food || [])], quick: [...(role.zones?.quick || [])], taxi: [...(role.zones?.taxi || [])] },
    })
    setModuleTab("food")
  }

  // --- permission editing -------------------------------------------------------------------
  const setFlag = (path, action, on) =>
    setForm((f) => {
      const cur = { view: false, create: false, edit: false, delete: false, ...(f.permissions[path] || {}) }
      if (action === "view" && !on) {
        cur.view = cur.create = cur.edit = cur.delete = false
      } else {
        cur[action] = on
        if (on) cur.view = true // any action needs the page to be viewable
      }
      const permissions = { ...f.permissions }
      if (cur.view) permissions[path] = cur
      else delete permissions[path]
      return { ...f, permissions }
    })

  const setRow = (path, on) =>
    setForm((f) => {
      const permissions = { ...f.permissions }
      if (on) permissions[path] = { view: true, create: true, edit: true, delete: true }
      else delete permissions[path]
      return { ...f, permissions }
    })

  const setColumn = (items, action, on) => items.forEach((i) => setFlag(i.path, action, on))
  const setGroup = (items, on) => items.forEach((i) => setRow(i.path, on))

  const toggleZone = (moduleKey, id) =>
    setForm((f) => {
      const list = f.zones[moduleKey] || []
      return { ...f, zones: { ...f.zones, [moduleKey]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] } }
    })

  const save = async () => {
    if (!form.name.trim()) return toast.error("Enter a role name")
    if (!countPages(form.permissions)) return toast.error("Give this role access to at least one page")
    setSaving(true)
    try {
      const body = { name: form.name.trim(), description: form.description.trim(), isActive: form.isActive, permissions: form.permissions, zones: form.zones }
      if (form.id) await adminAPI.accessUpdateRole(form.id, body)
      else await adminAPI.accessCreateRole(body)
      toast.success(form.id ? "Role updated" : "Role created")
      setForm(null)
      load()
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not save the role")
    } finally {
      setSaving(false)
    }
  }

  const remove = async (role) => {
    if (!window.confirm(`Delete the role "${role.name}"?`)) return
    try {
      await adminAPI.accessDeleteRole(role.id)
      toast.success("Role deleted")
      load()
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not delete the role")
    }
  }

  const zoneNames = (moduleKey, ids) => {
    if (!ids?.length) return "All zones"
    const byId = new Map((zones[moduleKey] || []).map((z) => [z.id, z.name]))
    return ids.map((id) => byId.get(id) || "?").join(", ")
  }

  const current = catalog.find((m) => m.key === moduleTab)

  return (
    <div className="mx-auto max-w-6xl p-4 lg:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><ShieldCheck className="h-6 w-6" /></span>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Roles</h1>
            <p className="text-sm text-slate-500">Decide which pages a role can open and what it can do there, and which zones it sees.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link to="/admin/access/employees" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <Users className="h-4 w-4" /> Employees
          </Link>
          <button onClick={openNew} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow hover:bg-emerald-700">
            <Plus className="h-4 w-4" /> Create role
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div>
        ) : roles.length === 0 ? (
          <div className="p-14 text-center text-slate-500">No roles yet. Create the first role, then add employees to it.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Pages</th>
                  <th className="px-4 py-3">Zones</th>
                  <th className="px-4 py-3">Employees</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {roles.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{r.name}</div>
                      {r.description ? <div className="text-xs text-slate-500">{r.description}</div> : null}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{countPages(r.permissions)} pages</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <div className="flex items-start gap-1"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <div>
                          <div>Food: {zoneNames("food", r.zones?.food)}</div>
                          <div>Marketplace: {zoneNames("quick", r.zones?.quick)}</div>
                          <div>Taxi: {zoneNames("taxi", r.zones?.taxi)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{r.employeeCount}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${r.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{r.isActive ? "Active" : "Inactive"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => openEdit(r)} className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100" aria-label="Edit role"><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => remove(r)} className="rounded-lg border border-rose-200 p-2 text-rose-600 hover:bg-rose-50" aria-label="Delete role"><Trash2 className="h-4 w-4" /></button>
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
          <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-bold text-slate-900">{form.id ? "Edit role" : "Create role"}</h2>
              <button onClick={() => setForm(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Role name *</span>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Indore Support Manager" className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Description</span>
                  <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What this role is for" className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
                </label>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                <Check checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label="Active" /> Role is active (employees can sign in)
              </label>

              <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
                {catalog.map((m) => {
                  const n = Object.keys(form.permissions).filter((k) => k === m.base || k.startsWith(`${m.base}/`)).length
                  return (
                    <button key={m.key} onClick={() => setModuleTab(m.key)} className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold transition ${moduleTab === m.key ? "bg-white text-slate-900 shadow" : "text-slate-500 hover:text-slate-800"}`}>
                      {m.label}{n ? <span className="ml-1.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">{n}</span> : null}
                    </button>
                  )
                })}
              </div>

              {current ? (
                <>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-800"><MapPin className="h-4 w-4 text-emerald-600" /> {current.label} zones</div>
                    <p className="mb-3 text-xs text-slate-500">Employees with this role see only the data of the selected zones in every {current.label} section. Select none for all zones.</p>
                    {(zones[current.key] || []).length === 0 ? (
                      <p className="text-xs text-slate-400">No zones created yet for {current.label}.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {(zones[current.key] || []).map((z) => {
                          const on = form.zones[current.key]?.includes(z.id)
                          return (
                            <button key={z.id} type="button" onClick={() => toggleZone(current.key, z.id)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${on ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-emerald-300"}`}>{z.name}</button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {current.groups.map((g) => {
                    const items = g.items
                    const colAll = (a) => items.every((i) => form.permissions[i.path]?.[a])
                    return (
                      <div key={g.title} className="overflow-hidden rounded-xl border border-slate-200">
                        <div className="flex items-center justify-between bg-slate-50 px-4 py-2.5">
                          <label className="flex cursor-pointer items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-700">
                            <Check checked={items.every((i) => ACCESS_ACTIONS.every((a) => form.permissions[i.path]?.[a]))} onChange={(v) => setGroup(items, v)} label={`All in ${g.title}`} />
                            {g.title}
                          </label>
                          <div className="hidden gap-6 pr-1 text-[11px] font-bold uppercase text-slate-400 sm:flex">
                            {ACCESS_ACTIONS.map((a) => (
                              <label key={a} className="flex w-16 cursor-pointer items-center justify-center gap-1.5">
                                <Check checked={colAll(a)} onChange={(v) => setColumn(items, a, v)} label={`${ACTION_LABEL[a]} all`} /> {ACTION_LABEL[a]}
                              </label>
                            ))}
                          </div>
                        </div>
                        <div className="divide-y divide-slate-100">
                          {items.map((i) => {
                            const p = form.permissions[i.path] || {}
                            return (
                              <div key={i.path} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                                <label className="flex min-w-0 cursor-pointer items-center gap-2 text-sm text-slate-800">
                                  <Check checked={ACCESS_ACTIONS.every((a) => p[a])} onChange={(v) => setRow(i.path, v)} label={`All on ${i.label}`} />
                                  <span className="truncate">{i.label}</span>
                                </label>
                                <div className="flex gap-3 sm:gap-6">
                                  {ACCESS_ACTIONS.map((a) => (
                                    <label key={a} className="flex w-14 cursor-pointer flex-col items-center gap-0.5 text-[10px] font-semibold uppercase text-slate-400 sm:w-16 sm:flex-row sm:justify-center sm:text-[0px]">
                                      <Check checked={Boolean(p[a])} onChange={(v) => setFlag(i.path, a, v)} label={`${ACTION_LABEL[a]} ${i.label}`} />
                                      <span className="sm:hidden">{ACTION_LABEL[a]}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <span className="text-xs text-slate-500">{countPages(form.permissions)} page(s) granted</span>
              <div className="flex gap-2">
                <button onClick={() => setForm(null)} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">Cancel</button>
                <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {form.id ? "Save changes" : "Create role"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
