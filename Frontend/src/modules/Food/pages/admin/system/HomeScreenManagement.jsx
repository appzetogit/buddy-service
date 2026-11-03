import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, ArrowUp, Image as ImageIcon, Loader2, Pencil, Plus, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import api from "@food/api"
import { getModuleToken } from "@food/utils/auth"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { Label } from "@food/components/ui/label"

// Home screen of the user apps (Quick Commerce / Food / Taxi). Everything here is read by the apps
// from GET /api/v1/common/home-config.
const SECTIONS = [
  { key: "hero_banner", label: "Hero Banners", hint: "Top carousel. Add as many as you like.", image: true, subtitle: false, title: "optional" },
  { key: "service_card", label: "Service Cards", hint: "The 'Choose a service' cards (Quick Commerce, Food, Taxi).", image: true, subtitle: true, title: "optional" },
  { key: "parcel_banner", label: "Parcel Banner", hint: "Banner under the service cards.", image: true, subtitle: false, title: "optional" },
  { key: "feature", label: "Bottom Options", hint: "Small icon + text options at the bottom (4 recommended).", image: false, subtitle: true, title: "required" },
]
const SERVICES = [
  { value: "quick_commerce", label: "Quick Commerce" },
  { value: "food", label: "Food" },
  { value: "taxi", label: "Taxi" },
  { value: "parcel", label: "Parcel Delivery" },
]
// The app maps these keys to its own built-in icons; an uploaded image is used instead when present.
const ICONS = ["percent", "shield-check", "headphones", "truck", "tag", "wallet", "clock", "star", "gift", "map-pin"]

const emptyForm = { title: "", subtitle: "", iconKey: "", linkType: "none", linkValue: "", isActive: true }

const authConfig = (extra = {}) => {
  const token = getModuleToken("admin")
  return { ...extra, headers: { ...(extra.headers || {}), ...(token ? { Authorization: `Bearer ${String(token).trim()}` } : {}) } }
}
const errMsg = (e) => e?.response?.data?.message || e?.message || "Something went wrong"

export default function HomeScreenManagement() {
  const [tab, setTab] = useState(SECTIONS[0].key)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(null) // item being edited, or {} for a new one
  const [form, setForm] = useState(emptyForm)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState("")
  const fileRef = useRef(null)

  const section = SECTIONS.find((s) => s.key === tab)
  const rows = useMemo(
    () => items.filter((i) => i.section === tab).sort((a, b) => a.sortOrder - b.sortOrder),
    [items, tab],
  )

  const load = async () => {
    try {
      setLoading(true)
      const res = await api.get("/common/admin/home-config", authConfig())
      setItems(res.data?.data?.items || [])
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const closeForm = () => {
    setEditing(null)
    setForm(emptyForm)
    setFile(null)
    setPreview("")
    if (fileRef.current) fileRef.current.value = ""
  }
  const openNew = () => { closeForm(); setEditing({}) }
  const openEdit = (item) => {
    setForm({
      title: item.title || "", subtitle: item.subtitle || "", iconKey: item.iconKey || "",
      linkType: item.linkType || "none", linkValue: item.linkValue || "", isActive: item.isActive !== false,
    })
    setFile(null)
    setPreview(item.imageUrl || "")
    setEditing(item)
  }
  const pickFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))

  const save = async (e) => {
    e.preventDefault()
    const isNew = !editing?._id
    if (section.image && !file && !preview) return toast.error("Please choose an image")
    if (section.title === "required" && !form.title.trim()) return toast.error("Title is required")
    if (!section.image && !file && !preview && !form.iconKey) return toast.error("Choose an icon or upload an image")
    if (form.linkType !== "none" && !form.linkValue.trim()) return toast.error("Choose where this should open")

    const fd = new FormData()
    fd.append("section", tab)
    Object.entries(form).forEach(([k, v]) => fd.append(k, String(v)))
    if (isNew) fd.append("sortOrder", String(rows.length ? Math.max(...rows.map((r) => r.sortOrder)) + 1 : 0))
    if (file) fd.append("image", file)

    try {
      setSaving(true)
      if (isNew) await api.post("/common/admin/home-config", fd, authConfig())
      else await api.put(`/common/admin/home-config/${editing._id}`, fd, authConfig())
      toast.success(isNew ? "Added" : "Saved")
      closeForm()
      await load()
    } catch (err) {
      toast.error(errMsg(err))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item) => {
    if (!window.confirm("Delete this item?")) return
    try {
      await api.delete(`/common/admin/home-config/${item._id}`, authConfig())
      toast.success("Deleted")
      await load()
    } catch (err) {
      toast.error(errMsg(err))
    }
  }

  const toggle = async (item) => {
    const fd = new FormData()
    fd.append("isActive", String(!item.isActive))
    try {
      await api.put(`/common/admin/home-config/${item._id}`, fd, authConfig())
      await load()
    } catch (err) {
      toast.error(errMsg(err))
    }
  }

  // Renumber the whole section by position so ties (all 0) can never make the order ambiguous.
  const move = async (index, dir) => {
    const next = [...rows]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    try {
      await Promise.all(
        next.map((r, i) => {
          if (r.sortOrder === i) return null
          const fd = new FormData()
          fd.append("sortOrder", String(i))
          return api.put(`/common/admin/home-config/${r._id}`, fd, authConfig())
        }),
      )
      await load()
    } catch (err) {
      toast.error(errMsg(err))
    }
  }

  const linkLabel = (i) =>
    i.linkType === "service" ? `Opens: ${SERVICES.find((s) => s.value === i.linkValue)?.label || i.linkValue}`
      : i.linkType === "url" ? `Opens: ${i.linkValue}` : "No link"

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Home Screen</h1>
        <p className="text-sm text-slate-500">Control what the user app home screen shows. Changes go live within a minute.</p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => { setTab(s.key); closeForm() }}
            className={`px-4 py-2 rounded-lg text-sm font-semibold ${tab === s.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{section.hint}</p>
        {!editing && <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Add</Button>}
      </div>

      {editing && (
        <form onSubmit={save} className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">{editing._id ? "Edit" : "Add"} - {section.label}</h2>
            <button type="button" onClick={closeForm} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{section.image ? "Image" : "Icon image (optional)"}</Label>
              <input ref={fileRef} type="file" accept="image/*" onChange={pickFile} className="block w-full text-sm" />
              {preview && <img src={preview} alt="preview" className="h-28 rounded-lg border border-slate-200 object-contain bg-slate-50" />}
            </div>

            <div className="space-y-3">
              <div>
                <Label>Title{section.title === "required" ? " *" : " (optional)"}</Label>
                <Input value={form.title} onChange={(e) => set("title", e.target.value)} />
              </div>
              {section.subtitle && (
                <div>
                  <Label>Subtitle (optional)</Label>
                  <Input value={form.subtitle} onChange={(e) => set("subtitle", e.target.value)} />
                </div>
              )}
              {tab === "feature" && (
                <div>
                  <Label>Icon (used when no image is uploaded)</Label>
                  <select value={form.iconKey} onChange={(e) => set("iconKey", e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                    <option value="">None</option>
                    {ICONS.map((i) => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
              )}
              <div>
                <Label>When tapped</Label>
                <select value={form.linkType} onChange={(e) => { set("linkType", e.target.value); set("linkValue", "") }} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                  <option value="none">Do nothing</option>
                  <option value="service">Open a service</option>
                  <option value="url">Open a link</option>
                </select>
              </div>
              {form.linkType === "service" && (
                <select value={form.linkValue} onChange={(e) => set("linkValue", e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                  <option value="">Choose service</option>
                  {SERVICES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              )}
              {form.linkType === "url" && (
                <Input placeholder="https://..." value={form.linkValue} onChange={(e) => set("linkValue", e.target.value)} />
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} /> Show on app
              </label>
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
            <Button type="button" variant="outline" onClick={closeForm}>Cancel</Button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-500">Nothing added yet.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((item, idx) => (
            <div key={item._id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
              {item.imageUrl ? (
                <img src={item.imageUrl} alt="" className="h-16 w-28 rounded-lg object-cover bg-slate-50 border border-slate-100" />
              ) : (
                <div className="h-16 w-28 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-xs text-slate-500">
                  {item.iconKey ? item.iconKey : <ImageIcon className="h-5 w-5" />}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">{item.title || "(no title)"}</p>
                {item.subtitle && <p className="truncate text-xs text-slate-500">{item.subtitle}</p>}
                <p className="truncate text-xs text-slate-400">{linkLabel(item)}</p>
              </div>
              <label className="flex items-center gap-1 text-xs text-slate-600">
                <input type="checkbox" checked={item.isActive} onChange={() => toggle(item)} /> Active
              </label>
              <div className="flex items-center gap-1">
                <button type="button" disabled={idx === 0} onClick={() => move(idx, -1)} className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                <button type="button" disabled={idx === rows.length - 1} onClick={() => move(idx, 1)} className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                <button type="button" onClick={() => openEdit(item)} className="p-1.5 rounded hover:bg-slate-100"><Pencil className="h-4 w-4" /></button>
                <button type="button" onClick={() => remove(item)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
