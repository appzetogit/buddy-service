import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bike, Car, Download, IndianRupee, Loader2, RefreshCw, Search, Truck, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../../shared/api/axiosInstance';

/**
 * Driver Subscription Analytics: who bought a daily pass, by vehicle class,
 * over any range of pass days, with the trend, the list, collections and
 * renewals.
 *
 * Days are pass days, 6 AM to 6 AM IST, the same as Payments > Subscribers.
 * Passes taken with the joining bonus count as subscriptions but not as
 * revenue, as no money was received for them.
 */

const CLASS_COLORS = { auto: '#1DE366', bike: '#10b981', car: '#3b82f6', truck: '#2AE56F', other: '#9ca3af' };
const CLASS_ICONS = { auto: Car, bike: Bike, car: Car, truck: Truck, other: Users };
const METHOD_LABELS = { wallet: 'Wallet', bonus: 'Joining bonus', razorpay: 'Online', online: 'Online', gateway: 'Online', upi: 'UPI' };
const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'list', label: 'Subscription List' },
  { key: 'payments', label: 'Payments' },
  { key: 'renewals', label: 'Renewals' },
  { key: 'status', label: 'Active / Expired' },
  { key: 'failed', label: 'Failed' },
];
const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Last 7 days' },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Custom' },
];
const POLL_MS = 30000;

const inputClass =
  'border border-gray-200 rounded-md px-2.5 py-1.5 text-xs text-gray-800 bg-white focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-none';
const rupees = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const dateTime = (value) =>
  value ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
const shortDay = (key) => {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};
const methodLabel = (method) => METHOD_LABELS[method] || method || '-';

/// Today's pass day, YYYY-MM-DD: the IST date, but before 6 AM it is still
/// yesterday's pass.
const passDayKey = (offsetDays = 0) =>
  new Date(Date.now() + (5.5 - 6) * 3600e3 + offsetDays * 864e5).toISOString().slice(0, 10);

const rangeFor = (preset, custom) => {
  if (preset === 'week') return { from: passDayKey(-6), to: passDayKey() };
  if (preset === 'month') return { from: `${passDayKey().slice(0, 8)}01`, to: passDayKey() };
  if (preset === 'custom') return { from: custom.from || passDayKey(), to: custom.to || custom.from || passDayKey() };
  return { from: passDayKey(), to: passDayKey() };
};

const unwrap = (res) => {
  const body = res?.data?.data || res?.data || res || {};
  return body.totals ? body : body.data || body;
};

const toCsv = (rows) => {
  const columns = [
    ['Paid at', (r) => dateTime(r.paid_at)],
    ['Pass day', (r) => r.pass_day],
    ['Driver', (r) => r.driver_name],
    ['Phone', (r) => r.phone],
    ['Vehicle class', (r) => r.vehicle_class_label],
    ['Vehicle type', (r) => r.vehicle_type],
    ['Vehicle number', (r) => r.vehicle_number],
    ['Plan', (r) => r.plan_name],
    ['Plan amount', (r) => r.amount],
    ['Collected', (r) => r.collected],
    ['Payment method', (r) => methodLabel(r.payment_method)],
    ['Payment status', (r) => r.payment_status],
    ['Pass status', (r) => r.pass_status],
    ['Valid until', (r) => dateTime(r.expires_at)],
    ['Transaction ID', (r) => r.transaction_id],
  ];
  const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return [columns.map(([h]) => cell(h)).join(','), ...rows.map((r) => columns.map(([, f]) => cell(f(r))).join(','))].join('\n');
};

const Card = ({ title, color, icon: Icon, count, sub, revenue, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`text-left bg-white border rounded-xl p-4 shadow-sm transition-all hover:shadow ${active ? 'ring-2 ring-green-500 border-transparent' : 'border-gray-100'}`}
  >
    <div className="flex items-center justify-between">
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">{title}</p>
      <span className="rounded-lg p-1.5" style={{ background: `${color}1a`, color }}>
        <Icon size={16} />
      </span>
    </div>
    <p className="mt-2 text-2xl font-black text-gray-900">{count}</p>
    <p className="text-[11px] text-gray-400">{sub}</p>
    <p className="mt-2 text-sm font-bold" style={{ color }}>{rupees(revenue)} <span className="text-[10px] font-semibold text-gray-400">revenue</span></p>
  </button>
);

/// Today's (or the range's) subscriptions per class, as bars.
const ClassBars = ({ byClass }) => {
  const max = Math.max(1, ...byClass.map((c) => c.subscribers));
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
      <p className="text-sm font-bold text-gray-900 mb-4">Subscriptions by vehicle class</p>
      <div className="flex items-end gap-4 h-48 px-2">
        {byClass.map((c) => (
          <div key={c.vehicle_class} className="flex-1 flex flex-col items-center justify-end h-full">
            <span className="text-xs font-bold text-gray-800 mb-1">{c.subscribers}</span>
            <div
              className="w-full max-w-[56px] rounded-t-md transition-all"
              style={{ height: `${(c.subscribers / max) * 100}%`, minHeight: 2, background: CLASS_COLORS[c.vehicle_class] }}
              title={`${c.label}: ${c.subscribers} (${rupees(c.revenue)})`}
            />
            <span className="mt-2 text-[11px] font-semibold text-gray-500">{c.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/// Daily subscriptions per class over the trend window, as lines.
const TrendChart = ({ trend }) => {
  const points = trend?.points || [];
  const classes = (trend?.classes || []).filter((key) => points.some((p) => p[key] > 0));
  if (!points.length) return null;
  const W = 640;
  const H = 200;
  const pad = { l: 28, r: 10, t: 10, b: 24 };
  const max = Math.max(1, ...points.map((p) => p.total));
  const x = (i) => pad.l + (points.length === 1 ? 0 : (i * (W - pad.l - pad.r)) / (points.length - 1));
  const y = (v) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const series = [...classes, 'total'];
  const every = Math.ceil(points.length / 8);
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <p className="text-sm font-bold text-gray-900">Last {points.length} days</p>
        <div className="flex flex-wrap gap-3">
          {series.map((key) => (
            <span key={key} className="flex items-center gap-1 text-[11px] font-semibold text-gray-500">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: CLASS_COLORS[key] || '#111827' }} />
              {key === 'total' ? 'Total' : trend.labels?.[key] || key}
            </span>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="#f3f4f6" />
            <text x={pad.l - 6} y={y(max * f) + 3} textAnchor="end" fontSize="9" fill="#9ca3af">{Math.round(max * f)}</text>
          </g>
        ))}
        {points.map((p, i) => (i % every === 0 || i === points.length - 1 ? (
          <text key={p.date} x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="#9ca3af">{shortDay(p.date)}</text>
        ) : null))}
        {series.map((key) => (
          <polyline
            key={key}
            fill="none"
            stroke={CLASS_COLORS[key] || '#111827'}
            strokeWidth={key === 'total' ? 2.5 : 1.75}
            points={points.map((p, i) => `${x(i)},${y(p[key] || 0)}`).join(' ')}
          >
            <title>{key}</title>
          </polyline>
        ))}
        {points.map((p, i) => (
          <circle key={p.date} cx={x(i)} cy={y(p.total)} r="2.5" fill="#111827">
            <title>{`${shortDay(p.date)}: ${p.total} passes, ${rupees(p.revenue)}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
};

const StatusBadge = ({ value }) => {
  const styles = {
    active: 'bg-green-50 text-green-700',
    paid: 'bg-green-50 text-green-700',
    expired: 'bg-gray-100 text-gray-500',
    cancelled: 'bg-red-50 text-red-600',
  };
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${styles[value] || 'bg-gray-100 text-gray-600'}`}>{value}</span>;
};

const SubscriptionTable = ({ rows, empty }) => (
  <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-x-auto">
    <table className="w-full text-xs whitespace-nowrap">
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500 border-b border-gray-100 bg-gray-50/60">
          <th className="px-3 py-2">Time</th>
          <th className="px-3 py-2">Driver</th>
          <th className="px-3 py-2">Phone</th>
          <th className="px-3 py-2">Vehicle</th>
          <th className="px-3 py-2 text-right">Plan amount</th>
          <th className="px-3 py-2">Payment method</th>
          <th className="px-3 py-2">Payment</th>
          <th className="px-3 py-2">Pass</th>
          <th className="px-3 py-2">Valid until</th>
          <th className="px-3 py-2">Transaction ID</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-400">{empty}</td></tr>
        ) : rows.map((r) => (
          <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/60">
            <td className="px-3 py-2 text-gray-600">{dateTime(r.paid_at)}</td>
            <td className="px-3 py-2 font-semibold text-gray-900">{r.driver_name}</td>
            <td className="px-3 py-2 text-gray-600">{r.phone || '-'}</td>
            <td className="px-3 py-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: CLASS_COLORS[r.vehicle_class] }} />
                <span className="font-semibold text-gray-800">{r.vehicle_class_label}</span>
                {r.vehicle_type ? <span className="text-gray-400">· {r.vehicle_type}</span> : null}
              </span>
              {r.vehicle_number ? <div className="text-[10px] text-gray-400 pl-3.5">{r.vehicle_number}</div> : null}
            </td>
            <td className="px-3 py-2 text-right font-bold text-gray-900">
              {rupees(r.amount)}
              {r.free ? <div className="text-[10px] font-semibold text-green-600">free (bonus)</div> : null}
            </td>
            <td className="px-3 py-2 text-gray-700">{methodLabel(r.payment_method)}</td>
            <td className="px-3 py-2"><StatusBadge value={r.payment_status} /></td>
            <td className="px-3 py-2"><StatusBadge value={r.pass_status} /></td>
            <td className="px-3 py-2 text-gray-600">{dateTime(r.expires_at)}</td>
            <td className="px-3 py-2 font-mono text-[11px] text-gray-500">{r.transaction_id}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const DriverSubscriptionAnalytics = () => {
  const [tab, setTab] = useState('overview');
  const [preset, setPreset] = useState('today');
  const [custom, setCustom] = useState({ from: passDayKey(), to: passDayKey() });
  const [vehicleClass, setVehicleClass] = useState('');
  const [method, setMethod] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);

  const range = useMemo(() => rangeFor(preset, custom), [preset, custom]);

  // Typing settles for a moment before it searches.
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      if (vehicleClass) params.set('vehicleClass', vehicleClass);
      if (method) params.set('method', method);
      if (status) params.set('status', status);
      if (q) params.set('q', q);
      const res = await api.get(`/admin/driver-subscriptions/analytics?${params}`);
      setData(unwrap(res));
      setError('');
      setUpdatedAt(new Date());
    } catch (err) {
      if (!quiet) setError(err?.response?.data?.message || err?.message || 'Could not load the analytics');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [range, vehicleClass, method, status, q]);

  useEffect(() => {
    load();
  }, [load]);

  // Live: new passes show up without a reload while the page is open.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load(true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const totals = data?.totals || {};
  const byClass = data?.by_class || [];
  const rows = data?.subscriptions || [];
  const paidRows = rows.filter((r) => !r.free);
  const tabRows = tab === 'payments' ? paidRows : rows;
  const rangeLabel = range.from === range.to ? shortDay(range.from) : `${shortDay(range.from)} – ${shortDay(range.to)}`;

  const exportCsv = () => {
    const list = tab === 'renewals' || tab === 'failed' ? rows : tabRows;
    if (!list.length) {
      toast.error('Nothing to export');
      return;
    }
    const blob = new Blob([`\uFEFF${toCsv(list)}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `driver-subscriptions_${range.from}_${range.to}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-gray-900">Driver Subscription Analytics</h1>
          <p className="text-xs text-gray-500">
            {rangeLabel} · pass days run {data?.range?.day_starts_hour ?? 6}:00 to {data?.range?.day_starts_hour ?? 6}:00 IST
            {updatedAt ? ` · updated ${updatedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => load()} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-50">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gray-900 rounded-md hover:bg-black">
            <Download size={13} /> Export CSV
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
        <div className="flex rounded-md border border-gray-200 overflow-hidden">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={`px-3 py-1.5 text-xs font-bold ${preset === p.key ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <>
            <input type="date" className={inputClass} value={custom.from} max={passDayKey()} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            <span className="text-xs text-gray-400">to</span>
            <input type="date" className={inputClass} value={custom.to} max={passDayKey()} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </>
        )}
        <select className={inputClass} value={vehicleClass} onChange={(e) => setVehicleClass(e.target.value)}>
          <option value="">All vehicles</option>
          <option value="auto">Auto</option>
          <option value="bike">Bike</option>
          <option value="car">Car</option>
          <option value="truck">Mini Truck</option>
          <option value="other">Other</option>
        </select>
        <select className={inputClass} value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">All payment methods</option>
          {(data?.methods || []).map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}
        </select>
        <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Active & expired</option>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
        </select>
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className={`${inputClass} w-full pl-7`}
            placeholder="Driver, phone, vehicle, transaction ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {error ? (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      {loading && !data ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-gray-400" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            {byClass.map((c) => (
              <Card
                key={c.vehicle_class}
                title={c.label}
                color={CLASS_COLORS[c.vehicle_class]}
                icon={CLASS_ICONS[c.vehicle_class] || Users}
                count={c.subscribers}
                sub={`${c.plan_amount != null ? `${rupees(c.plan_amount)} plan` : 'No paid passes'}${c.free ? ` · ${c.free} free` : ''}`}
                revenue={c.revenue}
                active={vehicleClass === c.vehicle_class}
                onClick={() => setVehicleClass(vehicleClass === c.vehicle_class ? '' : c.vehicle_class)}
              />
            ))}
            <Card
              title="Total"
              color="#46E580"
              icon={IndianRupee}
              count={totals.subscribers || 0}
              sub={`${totals.drivers || 0} drivers · ${totals.paid || 0} paid · ${totals.free || 0} free`}
              revenue={totals.revenue}
              active={false}
              onClick={() => setVehicleClass('')}
            />
          </div>

          <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2 text-xs font-bold whitespace-nowrap border-b-2 -mb-px ${tab === t.key ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
              >
                {t.label}
                {t.key === 'list' ? ` (${rows.length})` : ''}
                {t.key === 'payments' ? ` (${paidRows.length})` : ''}
                {t.key === 'renewals' ? ` (${(data?.renewals || []).length})` : ''}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.6fr] gap-4">
                <ClassBars byClass={byClass} />
                <TrendChart trend={data?.trend} />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900 mb-2">Subscriptions · {rangeLabel}</p>
                <SubscriptionTable rows={rows.slice(0, 50)} empty="No subscriptions in this range" />
                {rows.length > 50 ? (
                  <button onClick={() => setTab('list')} className="mt-2 text-xs font-bold text-green-600 hover:underline">
                    See all {rows.length} subscriptions
                  </button>
                ) : null}
              </div>
            </div>
          )}

          {tab === 'list' && <SubscriptionTable rows={rows} empty="No subscriptions in this range" />}

          {tab === 'payments' && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500">
                {paidRows.length} paid passes, {rupees(totals.revenue)} collected. Passes taken with the joining bonus are left out, as no money was received for them.
              </p>
              <SubscriptionTable rows={paidRows} empty="No paid passes in this range" />
            </div>
          )}

          {tab === 'renewals' && (
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-x-auto">
              <p className="px-3 py-2 text-xs text-gray-500 border-b border-gray-100">Drivers who bought more than one pass in {rangeLabel}.</p>
              <table className="w-full text-xs whitespace-nowrap">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500 border-b border-gray-100 bg-gray-50/60">
                    <th className="px-3 py-2">Driver</th>
                    <th className="px-3 py-2">Phone</th>
                    <th className="px-3 py-2">Vehicle</th>
                    <th className="px-3 py-2 text-right">Passes</th>
                    <th className="px-3 py-2 text-right">Collected</th>
                    <th className="px-3 py-2">Last paid</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.renewals || []).length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">
                      {preset === 'today' ? 'Renewals show over more than one day; pick Last 7 days or This month.' : 'No driver renewed in this range'}
                    </td></tr>
                  ) : data.renewals.map((r) => (
                    <tr key={r.driver_id} className="border-b border-gray-50">
                      <td className="px-3 py-2 font-semibold text-gray-900">{r.driver_name}</td>
                      <td className="px-3 py-2 text-gray-600">{r.phone || '-'}</td>
                      <td className="px-3 py-2 text-gray-700">{r.vehicle_class_label}</td>
                      <td className="px-3 py-2 text-right font-bold">{r.passes}</td>
                      <td className="px-3 py-2 text-right font-bold text-gray-900">{rupees(r.collected)}</td>
                      <td className="px-3 py-2 text-gray-600">{dateTime(r.last_paid_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'status' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 max-w-md">
                <button onClick={() => setStatus(status === 'active' ? '' : 'active')} className={`text-left rounded-xl border p-3 ${status === 'active' ? 'ring-2 ring-green-500 border-transparent' : 'border-gray-100'} bg-white`}>
                  <p className="text-[11px] font-bold uppercase text-gray-500">Active now</p>
                  <p className="text-2xl font-black text-green-600">{totals.active || 0}</p>
                </button>
                <button onClick={() => setStatus(status === 'expired' ? '' : 'expired')} className={`text-left rounded-xl border p-3 ${status === 'expired' ? 'ring-2 ring-gray-500 border-transparent' : 'border-gray-100'} bg-white`}>
                  <p className="text-[11px] font-bold uppercase text-gray-500">Expired</p>
                  <p className="text-2xl font-black text-gray-500">{totals.expired || 0}</p>
                </button>
              </div>
              <SubscriptionTable rows={rows} empty="No passes" />
            </div>
          )}

          {tab === 'failed' && (
            <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-bold">Failed payments aren't recorded yet</p>
                <p className="mt-1 text-xs leading-relaxed">
                  A pass is only saved once it is paid: when a driver's wallet is short or an online payment fails, the app shows the error
                  and nothing reaches the server. Every pass listed on this page was paid. Recording failed attempts needs a change in the
                  driver app and the server.
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default DriverSubscriptionAnalytics;
