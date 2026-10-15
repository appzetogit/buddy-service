import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { ALL_MENU_PERMISSION_KEYS, buildMenuPermissionTree } from '../../constants/adminAccess';

/**
 * The fields of an admin account, shared by "Create Admin" and the inline
 * edit, which used to be two separately written forms that had drifted apart.
 *
 * What it fixes, besides that:
 *   - Every sidebar menu and sub-menu can be granted, generated from the
 *     sidebar itself. The old form listed 30 hand-picked areas, so most menus
 *     could not be given or withheld individually.
 *   - Service locations and zones can be chosen. The backend refuses a
 *     sub-admin without at least one location, and the old form had no field
 *     for it, so creating a sub-admin always failed.
 */

const labelClass = 'block text-[10px] font-semibold text-[#64748B] uppercase mb-1';

const Check = ({ checked, indeterminate = false, onChange, label, bold = false }) => (
  <label className="flex items-center gap-2 cursor-pointer select-none py-0.5">
    <input
      type="checkbox"
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate;
      }}
      onChange={onChange}
      className="h-3.5 w-3.5 accent-[#16A34A]"
    />
    <span className={`text-xs ${bold ? 'font-semibold text-[#0B1220]' : 'text-slate-600'}`}>{label}</span>
  </label>
);

const idOf = (item) => String(item?._id || item?.id || '');

const AdminAccountForm = ({
  form,
  setForm,
  serviceLocations = [],
  zones = [],
  mode = 'create',
  saving = false,
  onSubmit,
  onCancel,
}) => {
  const tree = useMemo(() => buildMenuPermissionTree(), []);
  const [openGroups, setOpenGroups] = useState({});
  const isSub = form.admin_type !== 'superadmin';
  const selected = useMemo(() => new Set(form.permissions || []), [form.permissions]);

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const setKeys = (keys, on) =>
    setForm((current) => {
      const next = new Set(current.permissions || []);
      keys.forEach((key) => (on ? next.add(key) : next.delete(key)));
      return { ...current, permissions: [...next] };
    });

  const toggleId = (field, id) =>
    setForm((current) => {
      const list = (current[field] || []).map(String);
      const next = list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
      const update = { ...current, [field]: next };
      // A zone only makes sense inside a chosen location; drop orphans.
      if (field === 'service_location_ids') {
        update.zone_ids = (current.zone_ids || []).map(String).filter((zoneId) => {
          const zone = zones.find((z) => idOf(z) === zoneId);
          return zone && next.includes(String(zone.service_location_id || ''));
        });
      }
      return update;
    });

  const chosenLocations = (form.service_location_ids || []).map(String);
  const visibleZones = zones.filter((zone) => chosenLocations.includes(String(zone.service_location_id || '')));
  const allSelected = ALL_MENU_PERMISSION_KEYS.every((key) => selected.has(key));

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Full name</label>
          <input required value={form.name} onChange={(e) => setField('name', e.target.value)} className="admin-input" />
        </div>
        <div>
          <label className={labelClass}>Email (login ID)</label>
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => setField('email', e.target.value)}
            className="admin-input"
          />
        </div>
        <div>
          <label className={labelClass}>Phone number</label>
          <input value={form.phone} onChange={(e) => setField('phone', e.target.value)} className="admin-input" />
        </div>
        <div>
          <label className={labelClass}>Admin role</label>
          <select value={form.role} onChange={(e) => setField('role', e.target.value)} className="admin-input">
            {['Operations Subadmin', 'Billing Subadmin', 'Support Staff'].map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
            {form.role && !['Operations Subadmin', 'Billing Subadmin', 'Support Staff'].includes(form.role) && (
              <option value={form.role}>{form.role}</option>
            )}
          </select>
        </div>
        <div>
          <label className={labelClass}>Admin type</label>
          <select
            value={form.admin_type}
            onChange={(e) => setField('admin_type', e.target.value)}
            className="admin-input"
          >
            <option value="subadmin">Sub-Admin (scoped rights)</option>
            <option value="superadmin">Super Admin (everything)</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Status</label>
          <select
            value={form.active ? 'active' : 'inactive'}
            onChange={(e) => setField('active', e.target.value === 'active')}
            className="admin-input"
          >
            <option value="active">Active</option>
            <option value="inactive">Suspended</option>
          </select>
        </div>
      </div>

      {isSub && (
        <div className="space-y-3">
          <div>
            <label className={labelClass}>Service locations <span className="text-rose-500">*</span></label>
            <p className="text-[11px] text-slate-500 mb-2">The cities this admin can manage. At least one is required.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 rounded-lg border border-[#E5E7EB] p-3 max-h-36 overflow-y-auto">
              {serviceLocations.length === 0 && <p className="text-xs text-slate-400 col-span-full">No service locations found.</p>}
              {serviceLocations.map((location) => (
                <Check
                  key={idOf(location)}
                  label={location.name || location.service_location_name || 'Location'}
                  checked={chosenLocations.includes(idOf(location))}
                  onChange={() => toggleId('service_location_ids', idOf(location))}
                />
              ))}
            </div>
          </div>

          {visibleZones.length > 0 && (
            <div>
              <label className={labelClass}>Zones (optional)</label>
              <p className="text-[11px] text-slate-500 mb-2">Leave empty to allow every zone in the chosen locations.</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 rounded-lg border border-[#E5E7EB] p-3 max-h-32 overflow-y-auto">
                {visibleZones.map((zone) => (
                  <Check
                    key={idOf(zone)}
                    label={zone.name || 'Zone'}
                    checked={(form.zone_ids || []).map(String).includes(idOf(zone))}
                    onChange={() => toggleId('zone_ids', idOf(zone))}
                  />
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={labelClass}>Menu access <span className="text-rose-500">*</span></label>
              <button
                type="button"
                onClick={() => setKeys(ALL_MENU_PERMISSION_KEYS, !allSelected)}
                className="text-[11px] font-semibold text-[#1FB757] hover:underline"
              >
                {allSelected ? 'Clear all' : 'Select all'}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mb-2">
              Every menu and sub-menu in the sidebar. The admin sees only what is ticked. {selected.size} selected.
            </p>
            <div className="rounded-lg border border-[#E5E7EB] divide-y divide-[#F1F5F9]">
              {tree.map((section) => (
                <div key={section.title} className="p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">{section.title}</p>
                  {section.groups.map((group) => {
                    const keys = group.leaves.map((leaf) => leaf.key);
                    const count = keys.filter((key) => selected.has(key)).length;
                    const groupId = `${section.title}/${group.label}`;
                    const single = group.leaves.length === 1 && group.leaves[0].label === group.label;
                    const open = openGroups[groupId];

                    if (single) {
                      return (
                        <Check
                          key={groupId}
                          bold
                          label={group.label}
                          checked={count === 1}
                          onChange={() => setKeys(keys, count === 0)}
                        />
                      );
                    }

                    return (
                      <div key={groupId}>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setOpenGroups((g) => ({ ...g, [groupId]: !g[groupId] }))}
                            className="text-slate-400 hover:text-slate-600"
                            aria-label={open ? `Collapse ${group.label}` : `Expand ${group.label}`}
                          >
                            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                          <Check
                            bold
                            label={`${group.label} (${count}/${keys.length})`}
                            checked={count === keys.length}
                            indeterminate={count > 0 && count < keys.length}
                            onChange={() => setKeys(keys, count < keys.length)}
                          />
                        </div>
                        {open && (
                          <div className="ml-8 grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                            {group.leaves.map((leaf) => (
                              <Check
                                key={leaf.key + leaf.label}
                                label={leaf.label}
                                checked={selected.has(leaf.key)}
                                onChange={() => setKeys([leaf.key], !selected.has(leaf.key))}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!isSub && (
        <p className="text-xs text-slate-500 rounded-lg bg-slate-50 border border-[#E5E7EB] p-3">
          A Super Admin sees every menu and every city.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>
            {mode === 'create' ? 'Password' : 'New password (leave empty to keep)'}
            {mode === 'create' && <span className="text-rose-500"> *</span>}
          </label>
          <input
            type="password"
            autoComplete="new-password"
            required={mode === 'create'}
            value={form.password}
            onChange={(e) => setField('password', e.target.value)}
            className="admin-input"
          />
        </div>
        <div>
          <label className={labelClass}>Confirm password</label>
          <input
            type="password"
            autoComplete="new-password"
            required={mode === 'create' || Boolean(form.password)}
            value={form.passwordConfirmation}
            onChange={(e) => setField('passwordConfirmation', e.target.value)}
            className="admin-input"
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>Notes</label>
        <textarea
          rows={2}
          value={form.notes || ''}
          onChange={(e) => setField('notes', e.target.value)}
          className="admin-input !h-auto py-2"
        />
      </div>

      <div className="flex justify-end gap-3 pt-2 border-t border-[#E5E7EB]">
        <button type="button" onClick={onCancel} className="admin-btn-secondary h-10 px-4">
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="admin-btn-primary h-10 min-w-[140px] !bg-[#16A34A] !text-[#0B1220]"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : mode === 'create' ? 'Create admin' : 'Save changes'}
        </button>
      </div>
    </form>
  );
};

export default AdminAccountForm;
