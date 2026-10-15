import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Download, Loader2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../../shared/api/axiosInstance';

/**
 * Daily-pass subscribers, Payments > Subscribers.
 *
 * A day is the pass day, 6 AM to 6 AM IST - exactly who could drive that day.
 * The 6 PM closing counts passes paid by 6:00 PM IST that day. Passes taken
 * with the joining bonus are listed as subscribers but not as collection, as
 * no money was received for them.
 */

const CLASS_LABELS = { auto: 'Auto', bike: 'Bike', car: 'Car', other: 'Other' };
const METHOD_LABELS = { wallet: 'Wallet', bonus: 'Joining bonus', razorpay: 'Online', online: 'Online', gateway: 'Online' };

const inputClass =
  'border border-gray-200 rounded-md px-2.5 py-1.5 text-xs text-gray-800 bg-white focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-none';
const rupees = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const time = (value) =>
  value ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
const unwrap = (res) => {
  const body = res?.data?.data || res?.data || res || {};
  return body.totals ? body : body.data || body;
};

const SummaryTable = ({ title, note, rows, labelOf }) => (
  <div className="bg-white border border-gray-100 rounded-lg shadow-sm overflow-x-auto">
    <div className="px-3 py-2 border-b border-gray-100">
      <p className="text-xs font-bold text-gray-800">{title}</p>
      {note ? <p className="text-[10px] text-gray-400">{note}</p> : null}
    </div>
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
          <th className="px-3 py-1.5">{title.split('-')[0].trim()}</th>
          <th className="px-3 py-1.5 text-right">₹29 plans</th>
          <th className="px-3 py-1.5 text-right">₹49 plans</th>
          <th className="px-3 py-1.5 text-right">Free (bonus)</th>
          <th className="px-3 py-1.5 text-right">Subscribers</th>
          <th className="px-3 py-1.5 text-right">Collection</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-400">No subscribers</td></tr>
        ) : rows.map((row) => (
          <tr key={labelOf(row)} className="border-b border-gray-50">
            <td className="px-3 py-1.5 font-semibold text-gray-800">{labelOf(row)}</td>
            <td className="px-3 py-1.5 text-right">{row.plan29}</td>
            <td className="px-3 py-1.5 text-right">{row.plan49}{row.otherPlans ? <span className="text-gray-400"> +{row.otherPlans}</span> : null}</td>
            <td className="px-3 py-1.5 text-right text-gray-500">{row.free}</td>
            <td className="px-3 py-1.5 text-right font-semibold">{row.subscribers}</td>
            <td className="px-3 py-1.5 text-right font-bold text-gray-900">{rupees(row.collection)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const SubscriberReport = () => {
  const [filters, setFilters] = useState({ date: '', vehicle_class: '', vehicle_type_id: '' });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [vehicles, setVehicles] = useState([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
      setReport(unwrap(await api.get('/admin/payments/subscribers', { params })));
    } catch (err) {
      console.error('Load subscribers failed:', err);
      toast.error('Could not load subscribers');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  // The "service" filter: taxi vehicle types (Non-AC, AC, Premium, Airport...).
  useEffect(() => {
    api.get('/admin/types/vehicle-types/list')
      .then((res) => {
        const body = res?.data ?? res;
        const list = body?.data?.results || body?.results || body?.data || body || [];
        setVehicles(
          (Array.isArray(list) ? list : [])
            .filter((v) => v && (v._id || v.id))
            .map((v) => ({ id: String(v._id || v.id), name: v.name || 'Vehicle' }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch((err) => console.error('Load vehicle types failed:', err));
  }, []);

  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));

  const exportCsv = () => {
    const rows = report?.subscribers || [];
    const header = ['Paid at', 'Driver', 'Mobile', 'Vehicle no.', 'Vehicle', 'Service', 'Plan', 'Amount', 'Collected', 'Payment', 'Status', 'Pass'];
    const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [
      header.map(cell).join(','),
      ...rows.map((r) =>
        [time(r.paid_at), r.driver_name, r.phone, r.vehicle_number, CLASS_LABELS[r.vehicle_class] || r.vehicle_class,
          r.vehicle_types.join(' / '), r.plan_name, r.amount, r.collected, METHOD_LABELS[r.payment_method] || r.payment_method,
          r.payment_status, r.pass_status]
          .map(cell)
          .join(','),
      ),
    ];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `subscribers_${report?.day?.date || 'today'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const dayLabel = useMemo(() => {
    if (!report?.day) return '';
    const from = new Date(report.day.starts_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    const to = new Date(report.day.ends_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `${from} → ${to}`;
  }, [report]);

  const totals = report?.totals || {};
  const closing = report?.closing || {};

  return (
    <div>
      <div className="bg-white border border-gray-100 rounded-lg p-3 shadow-sm mb-3 flex flex-wrap items-end gap-2">
        <label className="text-[10px] font-semibold text-gray-500">
          Pass day
          <input type="date" className={`${inputClass} block mt-1`} value={filters.date || report?.day?.date || ''} onChange={(e) => setFilter('date', e.target.value)} />
        </label>
        <label className="text-[10px] font-semibold text-gray-500">
          Vehicle type
          <select className={`${inputClass} block mt-1`} value={filters.vehicle_class} onChange={(e) => setFilter('vehicle_class', e.target.value)}>
            <option value="">All vehicles</option>
            <option value="auto">Auto</option>
            <option value="bike">Bike</option>
            <option value="car">Car</option>
          </select>
        </label>
        <label className="text-[10px] font-semibold text-gray-500">
          Service
          <select className={`${inputClass} block mt-1`} value={filters.vehicle_type_id} onChange={(e) => setFilter('vehicle_type_id', e.target.value)}>
            <option value="">All services</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <div className="flex-1" />
        <button onClick={load} className="flex items-center gap-1 text-[11px] font-semibold text-gray-600 hover:text-gray-900 px-2 py-1.5">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
        <button
          onClick={exportCsv}
          disabled={!report?.subscribers?.length}
          className="flex items-center gap-1 bg-slate-800 hover:bg-slate-900 text-white text-[11px] font-semibold px-3 py-1.5 rounded-md disabled:opacity-40"
        >
          <Download size={11} /> Download CSV
        </button>
      </div>

      {loading && !report ? (
        <div className="flex justify-center p-10"><Loader2 size={20} className="animate-spin text-green-500" /></div>
      ) : report ? (
        <>
          <p className="text-[11px] text-gray-500 mb-2">Pass day {dayLabel} IST</p>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            <div className="bg-white border border-gray-100 rounded-lg p-3 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Subscribers</p>
              <p className="text-lg font-bold text-gray-900 mt-1">{totals.subscribers || 0}</p>
              <p className="text-[10px] text-gray-400">{totals.plan29 || 0} on ₹29 · {totals.plan49 || 0} on ₹49</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-lg p-3 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Collection</p>
              <p className="text-lg font-bold text-gray-900 mt-1">{rupees(totals.collection)}</p>
              <p className="text-[10px] text-gray-400">Money received for passes</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-lg p-3 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Free (joining bonus)</p>
              <p className="text-lg font-bold text-gray-900 mt-1">{totals.free || 0}</p>
              <p className="text-[10px] text-gray-400">Subscribers, not collection</p>
            </div>
            <div className={`border rounded-lg p-3 shadow-sm ${report.day?.closing_done ? 'bg-emerald-50 border-emerald-100' : 'bg-green-50 border-green-100'}`}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-600 flex items-center gap-1">
                <Clock size={11} /> 6 PM closing
              </p>
              <p className="text-lg font-bold text-gray-900 mt-1">{rupees(closing.collection)}</p>
              <p className="text-[10px] text-gray-500">
                {closing.subscribers || 0} paid by 6:00 PM{report.day?.closing_done ? '' : ' (so far - closes at 6 PM)'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mb-3">
            <SummaryTable
              title="Vehicle - wise"
              rows={report.by_class || []}
              labelOf={(row) => CLASS_LABELS[row.vehicle_class] || row.vehicle_class}
            />
            <SummaryTable
              title="Service - wise"
              note="A driver enrolled in several services counts under each, so rows can add up to more than the total."
              rows={report.by_service || []}
              labelOf={(row) => row.name}
            />
          </div>

          <div className="bg-white border border-gray-100 rounded-lg shadow-sm mb-3 overflow-x-auto">
            <p className="px-3 py-2 border-b border-gray-100 text-xs font-bold text-gray-800">Plan-wise</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
                  <th className="px-3 py-1.5">Plan</th>
                  <th className="px-3 py-1.5 text-right">Price</th>
                  <th className="px-3 py-1.5 text-right">Drivers</th>
                  <th className="px-3 py-1.5 text-right">Collection</th>
                </tr>
              </thead>
              <tbody>
                {(report.by_plan || []).length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400">No subscribers</td></tr>
                ) : report.by_plan.map((plan) => (
                  <tr key={`${plan.plan_name}-${plan.amount}-${plan.free}`} className="border-b border-gray-50">
                    <td className="px-3 py-1.5 font-semibold text-gray-800">
                      {plan.plan_name}{plan.free ? <span className="ml-1 text-[10px] font-normal text-gray-400">(joining bonus)</span> : null}
                    </td>
                    <td className="px-3 py-1.5 text-right">{rupees(plan.amount)}</td>
                    <td className="px-3 py-1.5 text-right font-semibold">{plan.subscribers}</td>
                    <td className="px-3 py-1.5 text-right font-bold">{rupees(plan.collection)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white border border-gray-100 rounded-lg shadow-sm overflow-x-auto">
            <p className="px-3 py-2 border-b border-gray-100 text-xs font-bold text-gray-800">
              Subscribers ({report.subscribers?.length || 0})
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
                  <th className="px-3 py-1.5">Driver</th>
                  <th className="px-3 py-1.5">Vehicle</th>
                  <th className="px-3 py-1.5">Plan</th>
                  <th className="px-3 py-1.5">Payment</th>
                  <th className="px-3 py-1.5">Paid at</th>
                  <th className="px-3 py-1.5">Pass</th>
                </tr>
              </thead>
              <tbody>
                {(report.subscribers || []).length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">No subscribers for this day and filter.</td></tr>
                ) : report.subscribers.map((row) => (
                  <tr key={row.id} className="border-b border-gray-50 align-top">
                    <td className="px-3 py-2">
                      <p className="font-semibold text-gray-800">{row.driver_name}</p>
                      {row.phone ? <a href={`tel:${row.phone}`} className="text-[10px] text-green-600 hover:underline">{row.phone}</a> : null}
                    </td>
                    <td className="px-3 py-2">
                      <p className="font-semibold text-gray-800">{row.vehicle_number || '-'}</p>
                      <p className="text-[10px] text-gray-500">
                        {CLASS_LABELS[row.vehicle_class] || row.vehicle_class}
                        {row.vehicle_types?.length ? ` · ${row.vehicle_types.join(', ')}` : ''}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <p className="text-gray-800">{row.plan_name}</p>
                      <p className="text-[10px] font-bold text-gray-900">{rupees(row.amount)}</p>
                    </td>
                    <td className="px-3 py-2">
                      <p className="text-gray-800">{METHOD_LABELS[row.payment_method] || row.payment_method}</p>
                      <p className={`text-[10px] font-semibold capitalize ${row.free ? 'text-gray-500' : 'text-emerald-700'}`}>
                        {row.free ? 'Free' : row.payment_status}
                      </p>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600">{time(row.paid_at)}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${row.pass_status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        {row.pass_status === 'active' ? 'Active' : 'Expired'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
};

export default SubscriberReport;
