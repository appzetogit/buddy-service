import { useMemo, useState } from "react";
import { Search, Edit, Trash2, MapPin, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@food/components/ui/dialog";
import { useToast } from "@shared/components/ui/Toast";

const emptyForm = {
  name: "",
  minDistance: "0",
  maxDistance: "",
  maxDistanceUnlimited: false,
  fee: "",
  deliveryBoyPerKm: "",
  deliveryBoyBasePay: "",
};

// QC's schema requires a finite `max` (unlike Food's nullable maxDistance), so "unlimited" is
// represented as this large sentinel instead of null — the distance-matching logic in
// billing.service.js already treats the highest slab's max inclusively, so this behaves as
// effectively unlimited without touching the live pricing engine.
const UNLIMITED_MAX = 99999;

function getDistanceSlabLabel(range) {
  const min = Number(range.min) || 0;
  const max = Number(range.max);
  if (!Number.isFinite(max) || max >= UNLIMITED_MAX) return `${min}+ km`;
  return `${min}-${max} km`;
}

/**
 * Distance Rules tab for Quick Commerce — same UX as Food's Distance Rules, but built on QC's
 * existing deliveryFeeRanges (min/max/fee + deliveryBoyPerKm/deliveryBoyBasePay) instead of a
 * separate flat userCharge/deliveryBoyFee model, so the live pricing engine is untouched.
 */
export default function DistanceRulesSection({ ranges, onSave, saving }) {
  const { showToast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddEditOpen, setIsAddEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState({});

  const list = Array.isArray(ranges) ? ranges : [];

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return list.map((r, i) => ({ ...r, _index: i }));
    const q = searchQuery.toLowerCase().trim();
    return list
      .map((r, i) => ({ ...r, _index: i }))
      .filter((r) => (r.name || "").toLowerCase().includes(q) || getDistanceSlabLabel(r).toLowerCase().includes(q));
  }, [list, searchQuery]);

  const handleAdd = () => {
    setEditingIndex(null);
    setFormData({ ...emptyForm });
    setFormErrors({});
    setIsAddEditOpen(true);
  };

  const handleEdit = (range, index) => {
    setEditingIndex(index);
    const isUnlimited = range.max === null || range.max === undefined || Number(range.max) >= UNLIMITED_MAX;
    setFormData({
      name: range.name || "",
      minDistance: String(range.min ?? ""),
      maxDistance: isUnlimited ? "" : String(range.max),
      maxDistanceUnlimited: isUnlimited,
      fee: String(range.fee ?? ""),
      deliveryBoyPerKm: String(range.deliveryBoyPerKm ?? "0"),
      deliveryBoyBasePay: String(range.deliveryBoyBasePay ?? "0"),
    });
    setFormErrors({});
    setIsAddEditOpen(true);
  };

  const handleDelete = (index) => {
    setEditingIndex(index);
    setIsDeleteOpen(true);
  };

  const confirmDelete = async () => {
    const next = list.filter((_, i) => i !== editingIndex);
    const ok = await onSave(next);
    if (ok) {
      showToast("Rule deleted", "success");
      setIsDeleteOpen(false);
      setEditingIndex(null);
    }
  };

  const toggleStatus = async (index) => {
    const next = list.map((r, i) => (i === index ? { ...r, status: r.status === false } : r));
    const ok = await onSave(next);
    if (ok) showToast("Rule status updated", "success");
  };

  const validateForm = () => {
    const errors = {};
    const min = parseFloat(formData.minDistance);
    const max = formData.maxDistanceUnlimited || formData.maxDistance === "" ? null : parseFloat(formData.maxDistance);
    if (formData.minDistance.trim() === "" || Number.isNaN(min) || min < 0) {
      errors.minDistance = "Minimum distance must be 0 or greater";
    }
    if (max !== null && (Number.isNaN(max) || max <= min)) {
      errors.maxDistance = "Max distance must be greater than min distance";
    }
    if (formData.fee.trim() === "" || Number(formData.fee) < 0) {
      errors.fee = "User delivery fee must be 0 or greater";
    }
    const perKm = Number(formData.deliveryBoyPerKm || 0);
    const basePay = Number(formData.deliveryBoyBasePay || 0);
    if (perKm > 0 && basePay > 0) {
      errors.deliveryBoyPerKm = "Set either Per KM or Base Pay, not both";
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;
    const min = parseFloat(formData.minDistance);
    const max = formData.maxDistanceUnlimited || formData.maxDistance === "" ? null : parseFloat(formData.maxDistance);
    const entry = {
      name: formData.name.trim() || `${min}${max == null ? "+" : `-${max}`} km`,
      min,
      max: max == null ? UNLIMITED_MAX : max,
      fee: Number(formData.fee),
      deliveryBoyPerKm: Number(formData.deliveryBoyPerKm || 0),
      deliveryBoyBasePay: Number(formData.deliveryBoyBasePay || 0),
      status: editingIndex !== null ? list[editingIndex]?.status !== false : true,
    };

    const next = editingIndex !== null
      ? list.map((r, i) => (i === editingIndex ? entry : r))
      : [...list, entry];

    const ok = await onSave(next);
    if (ok) {
      showToast(editingIndex !== null ? "Rule updated" : "Rule created", "success");
      setIsAddEditOpen(false);
      setFormData({ ...emptyForm });
      setEditingIndex(null);
    }
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Distance Rules</h2>
          <p className="text-sm text-slate-500 mt-0.5">Delivery fee slabs based on order distance</p>
        </div>
        <button
          type="button"
          onClick={handleAdd}
          className="px-4 py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-white text-sm font-semibold shadow-sm"
        >
          Add Distance Rule
        </button>
      </div>

      <div className="mb-4 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
        <div className="flex items-start gap-3">
          <MapPin className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
          <div className="text-sm text-slate-700">
            <p className="font-semibold text-emerald-900 mb-1">Delivery fee slab per distance</p>
            <p className="text-slate-600">
              <strong>User Delivery Fee</strong> = amount charged to the customer for this slab.
              <strong> DB Base Pay</strong> = flat amount paid to the rider; <strong>DB Per KM</strong> = rider pay per km (set one, not both).
              If no slab matches the order distance, the Default Delivery Fee from Fees &amp; Charges is used instead.
            </p>
          </div>
        </div>
      </div>

      <div className="mb-4 relative max-w-sm">
        <input
          type="text"
          placeholder="Search by name or distance..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 pr-4 py-2.5 w-full text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
      </div>

      <div className="overflow-x-auto bg-white rounded-xl border border-slate-200 shadow-sm">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase">Name</th>
              <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase">Distance Slab</th>
              <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase">User Fee (₹)</th>
              <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase">DB Per KM (₹)</th>
              <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase">DB Base Pay (₹)</th>
              <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase">Status</th>
              <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-700 uppercase">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-slate-500">
                  No distance rules found
                </td>
              </tr>
            ) : (
              filtered.map((range) => (
                <tr key={range._index} className="hover:bg-slate-50">
                  <td className="px-6 py-4 text-sm font-medium text-slate-900">{range.name || "—"}</td>
                  <td className="px-6 py-4 text-sm font-medium text-slate-900">{getDistanceSlabLabel(range)}</td>
                  <td className="px-6 py-4 text-sm font-semibold text-emerald-700">₹{range.fee}</td>
                  <td className="px-6 py-4 text-sm text-slate-700">{range.deliveryBoyPerKm ? `₹${range.deliveryBoyPerKm}` : "-"}</td>
                  <td className="px-6 py-4 text-sm text-slate-700">{range.deliveryBoyBasePay ? `₹${range.deliveryBoyBasePay}` : "-"}</td>
                  <td className="px-6 py-4">
                    <button
                      type="button"
                      onClick={() => toggleStatus(range._index)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        range.status !== false ? "bg-primary" : "bg-slate-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          range.status !== false ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button type="button" onClick={() => handleEdit(range, range._index)} className="p-1.5 rounded text-primary hover:bg-primary/10">
                        <Edit className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => handleDelete(range._index)} className="p-1.5 rounded text-red-600 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" />
                      </button>
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
            <DialogTitle>{editingIndex !== null ? "Edit Distance Rule" : "Add Distance Rule"}</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Rule Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary outline-none"
                placeholder="e.g., 0-3 km"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Minimum Distance (km) *</label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={formData.minDistance}
                onChange={(e) => setFormData({ ...formData, minDistance: e.target.value })}
                className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-primary outline-none ${formErrors.minDistance ? "border-red-500" : "border-slate-200"}`}
              />
              {formErrors.minDistance && <p className="text-xs text-red-500 mt-1">{formErrors.minDistance}</p>}
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Maximum Distance (km)</label>
              <label className="flex items-center gap-2 text-sm text-slate-700 mb-2">
                <input
                  type="checkbox"
                  checked={Boolean(formData.maxDistanceUnlimited)}
                  onChange={(e) => setFormData({ ...formData, maxDistanceUnlimited: e.target.checked, maxDistance: e.target.checked ? "" : formData.maxDistance })}
                />
                Unlimited
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={formData.maxDistance}
                disabled={Boolean(formData.maxDistanceUnlimited)}
                onChange={(e) => setFormData({ ...formData, maxDistanceUnlimited: false, maxDistance: e.target.value })}
                className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-primary outline-none disabled:bg-slate-100 ${formErrors.maxDistance ? "border-red-500" : "border-slate-200"}`}
              />
              {formErrors.maxDistance && <p className="text-xs text-red-500 mt-1">{formErrors.maxDistance}</p>}
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">User Delivery Fee (₹) *</label>
              <input
                type="number"
                step="1"
                min="0"
                value={formData.fee}
                onChange={(e) => setFormData({ ...formData, fee: e.target.value })}
                className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-primary outline-none ${formErrors.fee ? "border-red-500" : "border-slate-200"}`}
                placeholder="Charged to customer"
              />
              {formErrors.fee && <p className="text-xs text-red-500 mt-1">{formErrors.fee}</p>}
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Delivery Boy Per KM (₹)</label>
              <input
                type="number"
                step="1"
                min="0"
                disabled={Number(formData.deliveryBoyBasePay) > 0}
                value={formData.deliveryBoyPerKm}
                onChange={(e) => setFormData({ ...formData, deliveryBoyPerKm: e.target.value, deliveryBoyBasePay: "0" })}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary outline-none disabled:bg-slate-100"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Delivery Boy Base Pay (₹)</label>
              <input
                type="number"
                step="1"
                min="0"
                disabled={Number(formData.deliveryBoyPerKm) > 0}
                value={formData.deliveryBoyBasePay}
                onChange={(e) => setFormData({ ...formData, deliveryBoyBasePay: e.target.value, deliveryBoyPerKm: "0" })}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary outline-none disabled:bg-slate-100"
              />
              {formErrors.deliveryBoyPerKm && <p className="text-xs text-red-500 mt-1">{formErrors.deliveryBoyPerKm}</p>}
            </div>
          </div>
          <DialogFooter className="px-6 pb-6">
            <button type="button" onClick={() => setIsAddEditOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-200">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-white disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {editingIndex !== null ? "Update" : "Add"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="max-w-md bg-white p-0">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle>Delete Distance Rule</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6 text-sm text-slate-700">Delete this distance rule? This cannot be undone.</div>
          <DialogFooter className="px-6 pb-6">
            <button type="button" onClick={() => setIsDeleteOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-200">
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
