import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Sun, Sunrise, Moon, Sunset, Check } from 'lucide-react';
import { deliveryAPI } from '@food/api';
import { toast } from 'sonner';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SERVICE_LABEL = { food: 'Food', quickCommerce: 'Marketplace', taxi: 'Taxi' };
const fmt12 = (m) => {
  const h = Math.floor(m / 60) % 24;
  const mm = String(m % 60).padStart(2, '0');
  return `${h % 12 || 12}${mm === '00' ? '' : `:${mm}`}${h < 12 ? 'am' : 'pm'}`;
};
const iconFor = (m) => (m < 660 ? Sunrise : m < 960 ? Sun : m < 1200 ? Sunset : Moon);

/** One day's gig slots with their hours: pick hours and book. Booked/full hours are shown but locked. */
export default function GigDayV2() {
  const { date } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [day, setDay] = useState(null);
  const [filter, setFilter] = useState('all');
  const [picked, setPicked] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await deliveryAPI.getGigDay(date);
      setDay(res?.data?.data || null);
      setPicked([]);
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Could not load slots');
    } finally {
      setLoading(false);
    }
  }, [date]);
  useEffect(() => {
    load();
  }, [load]);

  const toggle = (t) => {
    if (!t.canBook) return;
    setPicked((p) => (p.includes(t.timeSlotId) ? p.filter((x) => x !== t.timeSlotId) : [...p, t.timeSlotId]));
  };

  const book = async () => {
    try {
      setSaving(true);
      await deliveryAPI.bookGig({ date, timeSlotIds: picked });
      toast.success('Gig booked');
      load();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Booking failed');
      load();
    } finally {
      setSaving(false);
    }
  };

  const title = day ? `${DAYS[day.dayOfWeek]}, ${date.split('-').reverse().join('/')}` : date;
  const show = (t) => (filter === 'all' ? true : filter === 'open' ? t.canBook : t.bookedByMe);
  const extra = day ? day.slots.flatMap((s) => s.timeSlots).filter((t) => picked.includes(t.timeSlotId)) : [];

  return (
    <div className="min-h-screen bg-white pb-32">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-white px-4 py-3">
        <button onClick={() => navigate('/food/delivery/gigs')} aria-label="Back"><ArrowLeft className="h-5 w-5" /></button>
        <div className="text-base font-extrabold text-slate-900">Gigs, {title}</div>
      </div>

      <div className="flex gap-2 px-4 py-3">
        {[['all', 'All'], ['open', 'Open'], ['booked', 'Booked']].map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={`rounded-full border px-4 py-1.5 text-sm font-semibold ${filter === k ? 'border-slate-900 bg-slate-900 text-white' : 'bg-white text-slate-700'}`}>{label}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : !day || day.slots.length === 0 ? (
        <div className="px-4 py-16 text-center text-sm text-slate-500">No gigs on this day.</div>
      ) : (
        <>
          {!day.bookable && <div className="mx-4 mb-3 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-700">Gigs must be booked at least one day before. You can book from tomorrow onwards.</div>}
          <div className="space-y-4 px-4">
            {day.slots.map((slot) => {
              const rows = slot.timeSlots.filter(show);
              if (!rows.length) return null;
              const Icon = iconFor(slot.timeSlots[0].startMin);
              return (
                <div key={slot.slotId} className="overflow-hidden rounded-2xl border">
                  <div className="flex items-center justify-between bg-slate-900 px-4 py-3 text-white">
                    <div>
                      <div className="text-base font-extrabold">{slot.name}</div>
                      <div className="text-xs text-slate-300">{fmt12(slot.timeSlots[0].startMin)} - {fmt12(slot.timeSlots[slot.timeSlots.length - 1].endMin)} · {slot.timeSlots.length} Gigs · {slot.services.map((s) => SERVICE_LABEL[s] || s).join(', ')}</div>
                    </div>
                    <Icon className="h-7 w-7 text-amber-300" />
                  </div>
                  <div className="divide-y">
                    {rows.map((t) => {
                      const on = picked.includes(t.timeSlotId);
                      return (
                        <button key={t.timeSlotId} onClick={() => toggle(t)} disabled={!t.canBook} className={`flex w-full items-center justify-between px-4 py-3 text-left ${t.canBook ? '' : 'bg-slate-50'}`}>
                          <div>
                            <div className={`text-sm font-extrabold ${t.canBook ? 'text-slate-900' : 'text-slate-400'}`}>{fmt12(t.startMin)} - {fmt12(t.endMin)}</div>
                            <div className={`text-xs ${t.canBook ? 'text-slate-500' : 'text-slate-400'}`}>₹{t.extraPerOrder} extra per order</div>
                            {t.isFull && !t.bookedByMe ? (
                              <div className="text-xs font-bold text-rose-500">Gig full</div>
                            ) : (
                              <div className="text-[11px] text-slate-400">{t.bookedCount} booked · {t.remaining} left</div>
                            )}
                          </div>
                          {t.bookedByMe ? (
                            <span className="flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-bold text-green-700"><Check className="h-3.5 w-3.5" /> Booked</span>
                          ) : (
                            <span className={`flex h-6 w-6 items-center justify-center rounded border-2 ${on ? 'border-green-600 bg-green-600 text-white' : t.canBook ? 'border-slate-400' : 'border-slate-200'}`}>{on && <Check className="h-4 w-4" />}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t bg-white p-4">
        <button onClick={book} disabled={!picked.length || saving} className="w-full rounded-xl bg-green-600 py-3.5 text-base font-extrabold text-white disabled:bg-slate-200 disabled:text-slate-400">
          {saving ? 'Booking...' : picked.length ? `Book ${picked.length} gig${picked.length > 1 ? 's' : ''}${extra.length ? ` · up to ₹${Math.max(...extra.map((t) => t.extraPerOrder))}/order extra` : ''}` : 'Book now'}
        </button>
      </div>
    </div>
  );
}
