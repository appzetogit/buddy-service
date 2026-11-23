import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Banknote, History, Loader2, X } from 'lucide-react';
import { deliveryAPI } from '@food/api';
import { formatCurrency } from '@food/utils/currency';
import DepositPopup from './DepositPopup';

const SERVICES = [
  { key: 'food', label: 'Food' },
  { key: 'quickCommerce', label: 'Marketplace' },
  { key: 'taxi', label: 'Taxi' },
];

const num = (v) => Number(v) || 0;

/** Fetches /food/delivery/cash-summary and refreshes whenever a deposit succeeds anywhere in the app. */
export function useCashSummary() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const res = await deliveryAPI.getCashSummary();
      setSummary(res?.data?.data || null);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
    window.addEventListener('deliveryWalletStateUpdated', load);
    return () => window.removeEventListener('deliveryWalletStateUpdated', load);
  }, [load]);
  return { summary, loading, reload: load };
}

const Sheet = ({ title, onClose, children }) => (
  <AnimatePresence>
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[120] bg-black/40 backdrop-blur-sm" onClick={onClose} />
    <motion.div
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 80, opacity: 0 }}
      className="fixed bottom-0 left-0 right-0 z-[121] mx-auto max-w-md rounded-t-3xl bg-white shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <h3 className="text-base font-bold text-gray-900">{title}</h3>
        <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-500" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto pb-4">{children}</div>
    </motion.div>
  </AnimatePresence>
);

/** Deposit sheet. Reads the live cash in hand itself, so it works from any screen (home alert, pocket). */
export function DepositSheet({ onClose, onDone }) {
  const { summary, loading, reload } = useCashSummary();
  return (
    <Sheet title="Deposit cash" onClose={onClose}>
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
      ) : (
        <DepositPopup
          cashInHand={num(summary?.cashInHand)}
          onSuccess={() => {
            reload();
            onDone?.();
            onClose?.();
          }}
        />
      )}
    </Sheet>
  );
}

const statusTone = (s) => {
  const v = String(s || '').toLowerCase();
  if (v === 'completed') return 'bg-green-50 text-green-700';
  if (v === 'failed') return 'bg-red-50 text-red-600';
  return 'bg-amber-50 text-amber-700';
};

function DepositHistory({ onClose }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    deliveryAPI
      .getCashDeposits({ limit: 30 })
      .then((res) => {
        const d = res?.data?.data || {};
        setRows(d.deposits || d.rows || d.transactions || (Array.isArray(d) ? d : []));
      })
      .catch(() => setRows([]));
  }, []);
  return (
    <Sheet title="Deposit history" onClose={onClose}>
      {rows === null ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
      ) : rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-gray-500">No deposits yet</p>
      ) : (
        <div className="divide-y divide-gray-100 px-5">
          {rows.map((r) => (
            <div key={r._id || r.id} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-bold text-gray-900">{formatCurrency(num(r.amount))}</p>
                <p className="text-[11px] text-gray-500">
                  {new Date(r.createdAt || r.date).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                  {r.method || r.paymentMethod ? ` · ${String(r.method || r.paymentMethod).toUpperCase()}` : ''}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusTone(r.status)}`}>{r.status || 'Completed'}</span>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

/** "Cash in hand" card for the Pocket tab. */
export default function CashCard() {
  const { summary, loading, reload } = useCashSummary();
  const [showDeposit, setShowDeposit] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  if (loading) return null;
  if (!summary) return null;

  const limit = num(summary.limit);
  const inHand = num(summary.cashInHand);
  const pending = num(summary.pendingCash);
  const capped = limit > 0;
  const pct = capped ? Math.min(100, Math.round(((inHand + pending) / limit) * 100)) : 0;
  const blocked = Boolean(summary.blocked);

  return (
    <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Cash in hand</p>
        <button onClick={() => setShowHistory(true)} className="flex items-center gap-1 text-[11px] font-semibold text-gray-500">
          <History className="h-3.5 w-3.5" /> History
        </button>
      </div>

      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-gray-900">{formatCurrency(inHand)}</h2>
          <p className="mt-1 text-[12px] font-medium text-gray-500">
            {capped ? <>Limit <b className="text-gray-900">{formatCurrency(limit)}</b> · Available <b className="text-gray-900">{formatCurrency(num(summary.available))}</b></> : 'No cash limit set'}
            {pending > 0 ? <> · Pending <b className="text-gray-900">{formatCurrency(pending)}</b></> : null}
          </p>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-100 bg-amber-50 text-amber-600">
          <Banknote className="h-6 w-6" />
        </div>
      </div>

      {capped && (
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div className={`h-full rounded-full ${blocked ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${pct}%` }} />
        </div>
      )}

      {blocked && (
        <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700">
          Cash limit reached. Deposit your cash to get new orders.
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2">
        {SERVICES.map((s) => {
          const row = summary.byService?.[s.key] || {};
          return (
            <div key={s.key} className="rounded-xl bg-gray-50 p-2.5 text-center">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{s.label}</p>
              <p className="mt-0.5 text-[13px] font-extrabold text-gray-900">{formatCurrency(num(row.collected))}</p>
              {num(row.pending) > 0 && <p className="text-[10px] font-semibold text-amber-600">+{formatCurrency(num(row.pending))} pending</p>}
            </div>
          );
        })}
      </div>

      <button
        onClick={() => setShowDeposit(true)}
        disabled={inHand <= 0}
        className="mt-4 flex h-12 w-full items-center justify-center rounded-2xl bg-black text-[14px] font-extrabold text-white active:scale-[0.98] disabled:opacity-40"
      >
        Deposit cash
      </button>
      {num(summary.deposited) > 0 && <p className="mt-2 text-center text-[11px] text-gray-400">Deposited so far {formatCurrency(num(summary.deposited))}</p>}

      {showDeposit && <DepositSheet onClose={() => setShowDeposit(false)} onDone={reload} />}
      {showHistory && <DepositHistory onClose={() => setShowHistory(false)} />}
    </div>
  );
}
