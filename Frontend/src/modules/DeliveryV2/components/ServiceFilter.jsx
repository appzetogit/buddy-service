import React from 'react';

export const SERVICE_FILTERS = [
  { key: '', label: 'All' },
  { key: 'food', label: 'Food' },
  { key: 'quickCommerce', label: 'Marketplace' },
  { key: 'taxi', label: 'Taxi' },
];

export const serviceLabel = (s) => (s === 'quickCommerce' ? 'Marketplace' : s === 'taxi' ? 'Taxi' : 'Food');
const serviceTone = (s) =>
  s === 'quickCommerce' ? 'bg-blue-50 text-blue-700' : s === 'taxi' ? 'bg-violet-50 text-violet-700' : 'bg-orange-50 text-orange-700';

/** Service of a trip row (older rows carry no `service`: they are Food). */
export const tripService = (trip) => trip?.service || (trip?.orderKind === 'taxi' ? 'taxi' : trip?.orderKind === 'quick' ? 'quickCommerce' : 'food');

/** One-line payment info for a trip row: COD with advance, plain COD, or paid online. */
export const tripPaymentLine = (trip) => {
  const advance = Number(trip?.advanceAmount ?? trip?.cod?.advanceAmount) || 0;
  const collected = Number(trip?.codCollectedAmount ?? trip?.cashCollected ?? trip?.cod?.collectedAmount) || 0;
  const due = Number(trip?.codAmount ?? trip?.cod?.remainingAmount) || 0;
  const method = String(trip?.paymentMethod || '').toLowerCase();
  const isCash = method === 'cash' || method === 'cod' || collected > 0 || due > 0;
  if (advance > 0 && isCash) return `Cash collected ₹${(collected || due).toFixed(0)} (advance ₹${advance.toFixed(0)} paid online)`;
  if (isCash) return collected > 0 ? `Cash collected ₹${collected.toFixed(0)}` : due > 0 ? `Cash to collect ₹${due.toFixed(0)}` : 'Cash on delivery';
  return method ? 'Paid online' : '';
};

export const ServiceBadge = ({ service }) => (
  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${serviceTone(service)}`}>{serviceLabel(service)}</span>
);

/** All / Food / Marketplace / Taxi chips. */
export default function ServiceFilter({ value, onChange }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {SERVICE_FILTERS.map((f) => (
        <button
          key={f.key || 'all'}
          type="button"
          onClick={() => onChange(f.key)}
          className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[12px] font-bold transition ${
            value === f.key ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-600'
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
