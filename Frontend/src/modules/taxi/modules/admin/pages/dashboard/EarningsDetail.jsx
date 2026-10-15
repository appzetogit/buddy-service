import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from '@taxi/shared/router';
import toast from 'react-hot-toast';
import api from '../../../../shared/api/axiosInstance';

/**
 * The records behind one card on Admin Earnings - every trip in "Total
 * commission", each driver in "Driver earnings", the parts of "Net platform
 * revenue", and so on. Opened from a card with the page's filters in the URL,
 * so the rows here add up to the number on the card.
 */

const PAGE_SIZE = 50;

const rupees = (value) =>
  `${Number(value || 0) < 0 ? '−' : ''}₹${Math.abs(Number(value || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const when = (value) =>
  value
    ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '-';

const formatCell = (value, type) => {
  if (type === 'money') return rupees(value);
  if (type === 'date') return when(value);
  return value === null || value === undefined || value === '' ? '-' : String(value);
};

const unwrap = (res) => {
  const body = res?.data?.data || res?.data || res || {};
  return body.rows ? body : body.data || body;
};

const FILTER_LABELS = { from: 'From', to: 'To', zone: 'Zone', vehicle: 'Vehicle', riderType: 'Type', paymentMethod: 'Payment', search: 'Search' };

const EarningsDetail = () => {
  const { metric } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [data, setData] = useState({ title: '', description: '', columns: [], rows: [], totals: [] });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const filters = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const body = unwrap(await api.get('/admin/dashboard/admin-earnings/details', { params: { ...filters, metric } }));
      setData({
        title: body.title || 'Details',
        description: body.description || '',
        columns: body.columns || [],
        rows: body.rows || [],
        totals: body.totals || [],
      });
      setPage(1);
    } catch (err) {
      console.error('Load earnings details failed:', err);
      toast.error('Could not load these records');
    } finally {
      setLoading(false);
    }
  }, [filters, metric]);

  useEffect(() => {
    load();
  }, [load]);

  const pages = Math.max(1, Math.ceil(data.rows.length / PAGE_SIZE));
  const visible = data.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const exportCsv = () => {
    const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [
      data.columns.map((c) => cell(c.label)).join(','),
      ...data.rows.map((row) => data.columns.map((c) => cell(c.type === 'date' ? when(row[c.key]) : row[c.key])).join(',')),
    ];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${metric}_${filters.from || 'all'}_${filters.to || 'now'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const backToEarnings = () => navigate(`/admin/earnings${searchParams.toString() ? `?${searchParams}` : ''}`);
  const activeFilters = Object.entries(filters).filter(([, value]) => String(value || '').trim() !== '');

  return (
    <div className="min-h-screen bg-[#F8FDFA] p-3 lg:p-4 font-sans">
      <button
        onClick={backToEarnings}
        className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-gray-900 mb-2"
      >
        <ArrowLeft size={13} /> Admin Earnings
      </button>

      <div className="mb-4 flex flex-col lg:flex-row lg:items-end justify-between gap-2 border-b border-gray-100 pb-3">
        <div>
          <h1 className="text-xl font-bold text-[#1E293B]">{loading && !data.title ? 'Loading…' : data.title}</h1>
          {data.description ? <p className="text-[11px] text-gray-500 mt-0.5">{data.description}</p> : null}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {activeFilters.length === 0 ? (
              <span className="text-[10px] text-gray-400">All time · all zones · all vehicles</span>
            ) : (
              activeFilters.map(([key, value]) => (
                <span key={key} className="text-[10px] font-semibold bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
                  {FILTER_LABELS[key] || key}: {value}
                </span>
              ))
            )}
          </div>
        </div>
        <button
          onClick={exportCsv}
          disabled={!data.rows.length}
          className="flex items-center gap-1 bg-slate-800 hover:bg-slate-900 text-white text-[11px] font-semibold px-3 py-1.5 rounded-md disabled:opacity-40 self-start lg:self-auto"
        >
          <Download size={12} /> Export CSV
        </button>
      </div>

      {data.totals.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          {data.totals.map((total) => (
            <div key={total.label} className="bg-white border border-gray-100 rounded-lg p-3 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{total.label}</p>
              <p className="text-lg font-bold text-gray-900 mt-1">{formatCell(total.value, total.type)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-lg shadow-sm overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
              {data.columns.map((c) => (
                <th key={c.key} className={`px-3 py-2 font-semibold ${c.type === 'money' ? 'text-right' : ''}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={Math.max(1, data.columns.length)} className="py-10 text-center">
                  <Loader2 size={18} className="animate-spin text-green-500 inline" />
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={Math.max(1, data.columns.length)} className="py-10 text-center text-gray-400">
                  Nothing here for these filters.
                </td>
              </tr>
            ) : (
              visible.map((row, index) => (
                <tr key={`${page}-${index}`} className="border-b border-gray-50">
                  {data.columns.map((c, colIndex) => (
                    <td
                      key={c.key}
                      className={`px-3 py-2 ${c.type === 'money' ? 'text-right font-semibold text-gray-900 whitespace-nowrap' : 'text-gray-700'} ${
                        row.indent && colIndex === 0 ? 'pl-8 text-gray-500' : ''
                      }`}
                    >
                      {formatCell(row[c.key], c.type)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data.rows.length > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2 mt-3 text-[11px] text-gray-500">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="p-1 disabled:opacity-30">
            <ChevronLeft size={14} />
          </button>
          <span>Page {page} of {pages}</span>
          <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} className="p-1 disabled:opacity-30">
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
};

export default EarningsDetail;
