import React, { useEffect, useState } from 'react';
import api from '../../../shared/api/axiosInstance';

const FALLBACK = [
  'Driver is taking too long',
  'Booked by mistake',
  'Changed my plan',
  'Found another ride',
  'Other',
].map((title) => ({ id: title, title, requiresNote: title === 'Other' }));

/**
 * Reason for cancelling a trip. The list is the admin-managed catalog (audience "user"); the built-in
 * list is only a fallback when it cannot be loaded. `text` is what to send as `reason` ('' = not ready yet).
 */
export const useCancelReason = () => {
  const [reasons, setReasons] = useState(FALLBACK);
  const [picked, setPicked] = useState(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    api
      .get('/users/cancellation-reasons', { params: { audience: 'user' } })
      .then((res) => {
        const rows = res?.data?.data?.results || res?.data?.results || [];
        if (rows.length) setReasons(rows);
      })
      .catch(() => {});
  }, []);

  const text = !picked ? '' : picked.requiresNote ? (note.trim() ? `${picked.title}: ${note.trim()}` : '') : picked.title;
  return { reasons, picked, setPicked, note, setNote, text };
};

const CancelReasonPicker = ({ reasons, picked, setPicked, note, setNote }) => (
  <div className="mb-5 max-h-56 space-y-2 overflow-y-auto text-left">
    {reasons.map((reason) => {
      const active = picked?.id === reason.id;
      return (
        <button
          key={reason.id}
          type="button"
          onClick={() => setPicked(reason)}
          className={`w-full rounded-[14px] border px-4 py-3 text-left text-[13px] font-bold transition ${active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-700'}`}
        >
          {reason.title}
        </button>
      );
    })}
    {picked?.requiresNote ? (
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={2}
        maxLength={200}
        placeholder="Tell us why"
        className="w-full rounded-[14px] border border-slate-200 p-3 text-[13px] font-semibold text-slate-800 outline-none"
      />
    ) : null}
  </div>
);

export default CancelReasonPicker;
