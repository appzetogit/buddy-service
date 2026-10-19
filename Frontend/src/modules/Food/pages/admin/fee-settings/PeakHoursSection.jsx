import { useState, useMemo, useEffect } from "react"
import { Search, Edit, Trash2, Clock, Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@food/components/ui/dialog"
import AmPmTimePicker from "@shared/components/ui/AmPmTimePicker"
import { adminAPI } from "@food/api"
import { toast } from "sonner"

const DAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
]

const emptyForm = {
  name: "",
  dateMode: "recurring",
  days: [],
  startDate: "",
  endDate: "",
  startTime: "12:00",
  endTime: "15:00",
  charge: "",
}

function formatDays(days) {
  if (!Array.isArray(days) || days.length === 0) return "Every day"
  if (days.length === 7) return "Every day"
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => DAYS.find((x) => x.value === d)?.label || "")
    .join(", ")
}

function formatTime12Hour(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value || "")
  if (!match) return value || ""
  const hour24 = Number(match[1])
  const minute = match[2]
  const period = hour24 >= 12 ? "PM" : "AM"
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return `${hour12}:${minute} ${period}`
}

function formatTimeRange(startTime, endTime) {
  return `${formatTime12Hour(startTime)} - ${formatTime12Hour(endTime)}`
}

function formatDateRange(startDate, endDate) {
  if (startDate && endDate) return `${startDate} to ${endDate}`
  if (startDate) return `From ${startDate}`
  if (endDate) return `Until ${endDate}`
  return "—"
}

export default function PeakHoursSection() {
  const [searchQuery, setSearchQuery] = useState("")
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [isAddEditOpen, setIsAddEditOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [selectedRule, setSelectedRule] = useState(null)
  const [formData, setFormData] = useState(emptyForm)
  const [formErrors, setFormErrors] = useState({})

  const filteredRules = useMemo(() => {
    if (!searchQuery.trim()) return rules
    const query = searchQuery.toLowerCase().trim()
    return rules.filter(
      (rule) =>
        (rule.name || "").toLowerCase().includes(query) ||
        formatDays(rule.days).toLowerCase().includes(query)
    )
  }, [rules, searchQuery])

  useEffect(() => {
    fetchRules()
  }, [])

  const fetchRules = async () => {
    try {
      setLoading(true)
      const response = await adminAPI.getPeakHourRules()
      const list = response?.data?.data?.rules
      setRules(Array.isArray(list) ? list : [])
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to fetch peak hour rules")
      setRules([])
    } finally {
      setLoading(false)
    }
  }

  const handleToggleStatus = async (rule) => {
    try {
      const newStatus = !rule.status
      await adminAPI.togglePeakHourRuleStatus(rule._id, newStatus)
      setRules(rules.map((r) => (r._id === rule._id ? { ...r, status: newStatus } : r)))
      toast.success("Rule status updated")
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to update status")
    }
  }

  const handleAdd = () => {
    setSelectedRule(null)
    setFormData({ ...emptyForm })
    setFormErrors({})
    setIsAddEditOpen(true)
  }

  const handleEdit = (rule) => {
    setSelectedRule(rule)
    setFormData({
      name: rule.name || "",
      dateMode: rule.dateMode === "dates" ? "dates" : "recurring",
      days: Array.isArray(rule.days) ? rule.days : [],
      startDate: rule.startDate || "",
      endDate: rule.endDate || "",
      startTime: rule.startTime || "12:00",
      endTime: rule.endTime || "15:00",
      charge: String(rule.charge ?? ""),
    })
    setFormErrors({})
    setIsAddEditOpen(true)
  }

  const handleDelete = (rule) => {
    setSelectedRule(rule)
    setIsDeleteOpen(true)
  }

  const confirmDelete = async () => {
    if (!selectedRule) return
    try {
      setDeleting(true)
      await adminAPI.deletePeakHourRule(selectedRule._id)
      setRules(rules.filter((r) => r._id !== selectedRule._id))
      setIsDeleteOpen(false)
      setSelectedRule(null)
      toast.success("Rule deleted")
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to delete rule")
    } finally {
      setDeleting(false)
    }
  }

  const toggleDay = (day) => {
    setFormData((prev) => ({
      ...prev,
      days: prev.days.includes(day) ? prev.days.filter((d) => d !== day) : [...prev.days, day],
    }))
  }

  const validateForm = () => {
    const errors = {}
    if (formData.startTime === formData.endTime) {
      errors.endTime = "End time must be different from start time"
    }
    if (formData.dateMode === "dates") {
      if (!formData.startDate && !formData.endDate) {
        errors.startDate = "Pick a start date, an end date, or both"
      }
      if (formData.startDate && formData.endDate && formData.startDate > formData.endDate) {
        errors.endDate = "End date must be on or after the start date"
      }
    }
    if (formData.charge === "" || parseFloat(formData.charge) < 0) {
      errors.charge = "Charge must be 0 or greater"
    }
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSave = async () => {
    if (!validateForm()) return
    try {
      setSaving(true)
      const isDatesMode = formData.dateMode === "dates"
      const ruleData = {
        name: formData.name.trim() || formatTimeRange(formData.startTime, formData.endTime),
        dateMode: formData.dateMode,
        days: isDatesMode ? [] : formData.days,
        startDate: isDatesMode ? (formData.startDate || null) : null,
        endDate: isDatesMode ? (formData.endDate || null) : null,
        startTime: formData.startTime,
        endTime: formData.endTime,
        charge: parseFloat(formData.charge),
        status: selectedRule ? selectedRule.status : true,
      }

      const extractRule = (response) => response?.data?.data?.rule || null

      if (selectedRule) {
        const response = await adminAPI.updatePeakHourRule(selectedRule._id, ruleData)
        const rule = extractRule(response)
        if (rule) {
          setRules(rules.map((r) => (r._id === selectedRule._id ? rule : r)))
          toast.success("Rule updated")
        }
      } else {
        const response = await adminAPI.createPeakHourRule(ruleData)
        const rule = extractRule(response)
        if (rule) {
          setRules([...rules, rule])
          toast.success("Rule created")
        }
      }
      setIsAddEditOpen(false)
      setFormData({ ...emptyForm })
      setSelectedRule(null)
      await fetchRules()
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to save rule")
    } finally {
      setSaving(false)
    }
  }

  const isDatesMode = formData.dateMode === "dates"

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Peak Hours</h2>
          <p className="text-sm text-slate-500 mt-0.5">Extra charge during busy time windows or festival days</p>
        </div>
        <button type="button" onClick={handleAdd} className="px-4 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold shadow-sm">
          Add Peak Hour Rule
        </button>
      </div>

      <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
        <div className="flex items-start gap-3">
          <Clock className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm text-slate-700">
            <p className="font-semibold text-amber-900 mb-1">Flat extra charge during a window</p>
            <p className="text-slate-600">
              A <strong>Recurring</strong> rule repeats on the days you pick (or every day) between the start and end
              time. A <strong>Festival dates</strong> rule applies only within a fixed calendar range, every day in
              that range, during the same time window. Either way, the charge is added to the customer&apos;s delivery
              fee and shown on their cart, and kept entirely by the platform — not split with the delivery partner.
              When two windows overlap, only the higher charge applies.
            </p>
          </div>
        </div>
      </div>

      <div className="mb-4 relative max-w-sm">
        <input
          type="text"
          placeholder="Search by name or day..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 pr-4 py-2.5 w-full text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
        />
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
      </div>

      <div className="overflow-x-auto bg-white rounded-xl border border-slate-200 shadow-sm">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase">Name</th>
              <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase">Days / Dates</th>
              <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase">Time Window</th>
              <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase">Charge (₹)</th>
              <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase">Status</th>
              <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-700 uppercase">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Loading rules...
                  </div>
                </td>
              </tr>
            ) : filteredRules.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-slate-500">No peak hour rules found</td>
              </tr>
            ) : (
              filteredRules.map((rule) => (
                <tr key={rule._id} className="hover:bg-slate-50">
                  <td className="px-6 py-4 text-sm font-medium text-slate-900">{rule.name}</td>
                  <td className="px-6 py-4 text-sm text-slate-700">
                    {rule.dateMode === "dates" ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-100">FESTIVAL</span>
                        {formatDateRange(rule.startDate, rule.endDate)}
                      </span>
                    ) : (
                      formatDays(rule.days)
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-slate-900">{formatTimeRange(rule.startTime, rule.endTime)}</td>
                  <td className="px-6 py-4 text-sm font-semibold text-green-700">₹{rule.charge}</td>
                  <td className="px-6 py-4">
                    <button type="button" onClick={() => handleToggleStatus(rule)} className={`relative inline-flex h-6 w-11 items-center rounded-full ${rule.status ? "bg-green-600" : "bg-slate-300"}`}>
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white ${rule.status ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button type="button" onClick={() => handleEdit(rule)} className="p-1.5 rounded text-green-600 hover:bg-green-50"><Edit className="w-4 h-4" /></button>
                      <button type="button" onClick={() => handleDelete(rule)} className="p-1.5 rounded text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={isAddEditOpen} onOpenChange={setIsAddEditOpen}>
        <DialogContent className="max-w-md bg-white p-0">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle>{selectedRule ? "Edit Peak Hour Rule" : "Add Peak Hour Rule"}</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Rule Name</label>
              <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-500 outline-none" placeholder="e.g., Lunch Rush or Diwali" />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Rule Type</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, dateMode: "recurring" })}
                  className={`px-3 py-2 rounded-lg border text-sm font-semibold ${
                    !isDatesMode ? "border-green-600 bg-green-50 text-green-700" : "border-slate-200 text-slate-600"
                  }`}
                >
                  Recurring
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, dateMode: "dates" })}
                  className={`px-3 py-2 rounded-lg border text-sm font-semibold ${
                    isDatesMode ? "border-green-600 bg-green-50 text-green-700" : "border-slate-200 text-slate-600"
                  }`}
                >
                  Festival dates
                </button>
              </div>
            </div>

            {isDatesMode ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Start Date</label>
                  <input type="date" value={formData.startDate} onChange={(e) => setFormData({ ...formData, startDate: e.target.value })} className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-green-500 outline-none ${formErrors.startDate ? "border-red-500" : "border-slate-200"}`} />
                  {formErrors.startDate && <p className="text-xs text-red-500 mt-1">{formErrors.startDate}</p>}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">End Date</label>
                  <input type="date" value={formData.endDate} onChange={(e) => setFormData({ ...formData, endDate: e.target.value })} className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-green-500 outline-none ${formErrors.endDate ? "border-red-500" : "border-slate-200"}`} />
                  {formErrors.endDate && <p className="text-xs text-red-500 mt-1">{formErrors.endDate}</p>}
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Days</label>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((day) => (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => toggleDay(day.value)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${
                        formData.days.includes(day.value) ? "border-green-600 bg-green-50 text-green-700" : "border-slate-200 text-slate-600"
                      }`}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-1">Leave all unselected to apply every day</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Start Time *</label>
                <AmPmTimePicker value={formData.startTime} onChange={(v) => setFormData({ ...formData, startTime: v })} error={formErrors.startTime} />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">End Time *</label>
                <AmPmTimePicker value={formData.endTime} onChange={(v) => setFormData({ ...formData, endTime: v })} error={formErrors.endTime} />
              </div>
            </div>
            <p className="text-xs text-slate-500 -mt-2">An end time earlier than the start time (e.g. 10:00 PM–2:00 AM) wraps past midnight.</p>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Extra Charge (₹) *</label>
              <input type="number" step="1" min="0" value={formData.charge} onChange={(e) => setFormData({ ...formData, charge: e.target.value })} className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-green-500 outline-none ${formErrors.charge ? "border-red-500" : "border-slate-200"}`} placeholder="Added to delivery fee" />
              <p className="text-xs text-slate-500 mt-1">Added on top of the delivery fee while this rule is active. Kept entirely by the platform.</p>
              {formErrors.charge && <p className="text-xs text-red-500 mt-1">{formErrors.charge}</p>}
            </div>
          </div>
          <DialogFooter className="px-6 pb-6">
            <button type="button" onClick={() => setIsAddEditOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-200">Cancel</button>
            <button type="button" onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-green-600 text-white disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {selectedRule ? "Update" : "Add"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="max-w-md bg-white p-0">
          <DialogHeader className="px-6 pt-6 pb-4"><DialogTitle>Delete Peak Hour Rule</DialogTitle></DialogHeader>
          <div className="px-6 pb-6 text-sm text-slate-700">Delete &quot;{selectedRule?.name}&quot;? This cannot be undone.</div>
          <DialogFooter className="px-6 pb-6">
            <button type="button" onClick={() => setIsDeleteOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-200">Cancel</button>
            <button type="button" onClick={confirmDelete} disabled={deleting} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white disabled:opacity-50 flex items-center gap-2">
              {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
