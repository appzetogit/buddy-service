import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Lock, Star, CalendarCheck } from 'lucide-react';
import { deliveryAPI } from '@food/api';
import { toast } from 'sonner';

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SERVICE_LABEL = { food: 'Food', quickCommerce: 'Marketplace', taxi: 'Taxi' };
const fmt12 = (m) => {
  const h = Math.floor(m / 60) % 24;
  const mm = String(m % 60).padStart(2, '0');
  return `${h % 12 || 12}${mm === '00' ? '' : `:${mm}`} ${h < 12 ? 'AM' : 'PM'}`;
};
const parts = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m: m - 1, d };
};
const niceDate = (date) => {
  const { y, m, d } = parts(date);
  return `${DAYS[new Date(y, m, d).getDay()]}, ${d} ${MONTHS[m].slice(0, 3)[0]}${MONTHS[m].slice(1, 3).toLowerCase()}`;
};
const dayStyle = (status) =>
  status === 'open' ? 'bg-green-600 text-white' : status === 'full' ? 'bg-amber-500 text-white' : 'bg-slate-400 text-white';

/** Gigs tab: the next days with their booking state, plus the rider's upcoming bookings. */
export default function GigsV2() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState([]);
  const [mine, setMine] = useState({ bookings: [], totalGigEarnings: 0 });
  const [today, setToday] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [d, b] = await Promise.all([deliveryAPI.getGigDays(), deliveryAPI.getMyGigBookings({ upcoming: true })]);
      setDays(d?.data?.data?.days || []);
      setToday(d?.data?.data?.today || '');
      setMine(b?.data?.data || { bookings: [], totalGigEarnings: 0 });
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Could not load gigs');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const cancel = async (id) => {
    if (!window.confirm('Cancel this gig booking?')) return;
    try {
      await deliveryAPI.cancelGigBooking(id);
      toast.success('Booking cancelled');
      load();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Could not cancel');
    }
  };

  let lastMonth = null;
  return (
    <div className="min-h-screen bg-slate-100 px-4 pb-32 pt-5">
      <h1 className="text-lg font-extrabold text-slate-900">Gigs</h1>
      <p className="mb-4 text-xs text-slate-500">Book hourly slots a day ahead. In a booked hour you get only gig orders and earn extra on every order.</p>

      {mine.totalGigEarnings > 0 && (
        <div className="mb-4 rounded-2xl bg-white p-3 text-sm shadow-sm">
          Gig extra earned so far: <span className="font-extrabold text-green-700">₹{mine.totalGigEarnings}</span>
        </div>
      )}

      {mine.bookings.length > 0 && (
        <div className="mb-5">
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500"><CalendarCheck className="h-4 w-4" /> My bookings</div>
          <div className="space-y-2">
            {mine.bookings.map((b) => (
              <div key={b._id} className="flex items-center justify-between rounded-2xl bg-white p-3 shadow-sm">
                <div>
                  <div className="text-sm font-bold text-slate-900">{b.slotName}</div>
                  <div className="text-xs text-slate-500">{niceDate(b.date)} · {fmt12(b.startMin)} - {fmt12(b.endMin)}</div>
                  <div className="text-[11px] font-semibold text-green-700">₹{b.extraPerOrder} extra / order · {(b.services || []).map((s) => SERVICE_LABEL[s] || s).join(', ')}</div>
                </div>
                {today && b.date > today ? (
                  <button onClick={() => cancel(b._id)} className="rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-600">Cancel</button>
                ) : (
                  <span className="rounded-lg bg-green-50 px-3 py-1.5 text-xs font-bold text-green-700">{b.date === today ? 'Today' : 'Done'}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : (
        <div className="space-y-3">
          {days.map((day) => {
            const p = parts(day.date);
            const header = lastMonth !== p.m ? MONTHS[p.m] : null;
            lastMonth = p.m;
            const tappable = day.status === 'open' || day.status === 'full';
            return (
              <React.Fragment key={day.date}>
                {header && (
                  <div className="flex items-center gap-3 pt-2 text-xs font-extrabold tracking-[0.3em] text-slate-500">
                    <span className="h-px flex-1 bg-slate-300" />{header}<span className="h-px flex-1 bg-slate-300" />
                  </div>
                )}
                <button
                  disabled={!tappable && day.status !== 'closed'}
                  onClick={() => navigate(`/food/delivery/gigs/${day.date}`)}
                  className="flex w-full overflow-hidden rounded-2xl bg-white text-left shadow-sm active:scale-[0.99]"
                >
                  <div className={`flex w-24 shrink-0 flex-col items-center justify-center py-5 ${dayStyle(day.status)}`}>
                    <span className="text-2xl font-extrabold leading-none">{p.d}</span>
                    <span className="text-sm font-bold">{DAYS[day.dayOfWeek]}</span>
                  </div>
                  <div className="flex flex-1 items-center justify-between gap-2 px-4 py-3">
                    <div>
                      <div className="text-base font-extrabold text-slate-800">
                        {day.status === 'open' && 'Booking open'}
                        {day.status === 'full' && 'All slots full'}
                        {day.status === 'closed' && (day.isToday ? 'Booking closed for today' : 'Booking closed')}
                        {day.status === 'none' && 'No gigs'}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                        {day.status === 'open' && (<><Star className="h-3.5 w-3.5" /> {day.slotCount} slot{day.slotCount > 1 ? 's' : ''} · {day.openCount} hour{day.openCount > 1 ? 's' : ''} available</>)}
                        {day.status === 'full' && 'Try another day'}
                        {day.status === 'closed' && 'Gigs must be booked a day before'}
                        {day.status === 'none' && 'Nothing scheduled for you'}
                      </div>
                      {day.myBookingCount > 0 && <div className="mt-1 inline-block rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-bold text-green-700">{day.myBookingCount} hour{day.myBookingCount > 1 ? 's' : ''} booked by you</div>}
                    </div>
                    {(day.status === 'closed' || day.status === 'none') && <Lock className="h-4 w-4 shrink-0 text-slate-500" />}
                  </div>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
