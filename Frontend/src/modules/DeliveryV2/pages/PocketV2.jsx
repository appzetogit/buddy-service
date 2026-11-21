import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wallet,
  IndianRupee,
  Package,
  ChevronRight,
  FileText,
  User,
  Loader2,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { deliveryAPI } from '@food/api';
import { toast } from 'sonner';
import { formatCurrency } from '@food/utils/currency';

const TRIPS_PAGE_SIZE = 10;

/**
 * PocketV2 — simplified partner wallet:
 * balance, earnings, delivery history, withdraw CTA.
 */
export const PocketV2 = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('week');
  const [bankDetailsFilled, setBankDetailsFilled] = useState(false);
  const [balance, setBalance] = useState(0);
  const [earnings, setEarnings] = useState(0);
  const [ordersCount, setOrdersCount] = useState(0);
  const [gigExtra, setGigExtra] = useState({ amount: 0, orders: 0, recent: [] });
  const [trips, setTrips] = useState([]);
  const [tripsPage, setTripsPage] = useState(1);
  const [tripsTotal, setTripsTotal] = useState(0);
  const [hasMoreTrips, setHasMoreTrips] = useState(false);
  const [loadingMoreTrips, setLoadingMoreTrips] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState(null);

  const getTripPeriod = (p) => {
    if (p === 'today') return 'daily';
    if (p === 'all') return 'all';
    return p;
  };

  const fetchTrips = useCallback(async (page, { append = false, currentPeriod = period } = {}) => {
    const tripsRes = await deliveryAPI.getTripHistory({
      period: getTripPeriod(currentPeriod),
      status: 'Completed',
      page,
      limit: TRIPS_PAGE_SIZE,
    });

    const payload = tripsRes?.data?.data || {};
    const tripList = Array.isArray(payload.trips) ? payload.trips : [];
    const pagination = payload.pagination || {};
    const total = Number(pagination.total) || tripList.length;
    const hasMore =
      typeof pagination.hasMore === 'boolean'
        ? pagination.hasMore
        : page * TRIPS_PAGE_SIZE < total;

    setTrips((prev) => (append ? [...prev, ...tripList] : tripList));
    setTripsPage(page);
    setTripsTotal(total);
    setHasMoreTrips(hasMore);
  }, [period]);

  useEffect(() => {
    let cancelled = false;

    const fetchWallet = async () => {
      try {
        const walletRes = await deliveryAPI.getWallet();
        if (cancelled) return;
        const wallet = walletRes?.data?.data?.wallet || {};
        setBalance(Number(wallet.pocketBalance) || 0);
      } catch {
        if (!cancelled) setBalance(0);
      }
    };

    fetchWallet();
    // Gig extra earned on gig orders (already part of the balance above; shown separately here).
    deliveryAPI
      .getMyGigBookings()
      .then((res) => {
        const d = res?.data?.data || {};
        if (!cancelled) setGigExtra({ amount: Number(d.totalGigEarnings) || 0, orders: Number(d.totalGigOrders) || 0, recent: Array.isArray(d.recentEarnings) ? d.recentEarnings : [] });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchPeriodData = async () => {
      try {
        setLoading(true);
        setTrips([]);
        setTripsPage(1);
        setHasMoreTrips(false);
        setTripsTotal(0);

        const [profileRes, earningsRes] = await Promise.all([
          deliveryAPI.getProfile().catch(() => null),
          deliveryAPI.getEarnings({ period }),
        ]);

        if (cancelled) return;

        const profile = profileRes?.data?.data?.profile || {};
        const summary = earningsRes?.data?.data?.summary || {};

        const bankDetails = profile?.documents?.bankDetails;
        setBankDetailsFilled(!!bankDetails?.accountNumber);
        setEarnings(Number(summary.totalEarnings) || 0);
        setOrdersCount(Number(summary.totalOrders) || 0);

        await fetchTrips(1, { append: false, currentPeriod: period });
      } catch (err) {
        if (!cancelled) toast.error('Failed to load earnings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchPeriodData();
    return () => {
      cancelled = true;
    };
  }, [period, fetchTrips]);

  const handleLoadMore = async () => {
    if (loadingMoreTrips || !hasMoreTrips) return;
    try {
      setLoadingMoreTrips(true);
      await fetchTrips(tripsPage + 1, { append: true, currentPeriod: period });
    } catch (err) {
      toast.error('Failed to load more deliveries');
    } finally {
      setLoadingMoreTrips(false);
    }
  };

  useEffect(() => {
    if (selectedTrip) {
      window.dispatchEvent(new Event('hideDeliveryBottomNav'));
    } else {
      window.dispatchEvent(new Event('showDeliveryBottomNav'));
    }
    return () => {
      window.dispatchEvent(new Event('showDeliveryBottomNav'));
    };
  }, [selectedTrip]);

  const getPeriodLabel = () => {
    switch (period) {
      case 'today':
        return 'Today';
      case 'month':
        return 'This Month';
      case 'all':
        return 'Lifetime';
      default:
        return 'This Week';
    }
  };

  const formatTripDate = (trip) => {
    const raw = trip.deliveredAt || trip.date || trip.createdAt;
    if (!raw) return trip.time || '';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return trip.time || '';
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };


  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center font-['Poppins']">
        <div className="w-10 h-10 border-4 border-green-600 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
          Loading Wallet...
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-['Poppins'] pb-24 flex flex-col sm:items-center">
      <div className="w-full max-w-md mx-auto flex flex-col h-full sm:h-[min(90dvh,900px)] sm:rounded-3xl sm:shadow-2xl sm:overflow-hidden sm:border sm:border-gray-100 bg-gray-50">
        
        {/* Header */}
        <div className="bg-gradient-to-br from-green-600 via-green-700 to-green-800 px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-8 relative overflow-hidden shrink-0 rounded-b-[2.5rem] shadow-sm">
          <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -mr-16 -mt-16 blur-2xl" />
          <div className="absolute bottom-[-20px] left-[-20px] w-32 h-32 bg-black/10 rounded-full blur-2xl" />
          
          <div className="relative z-10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                onClick={() => navigate('/driver/profile')}
                className="w-11 h-11 rounded-2xl bg-white/20 flex items-center justify-center text-white backdrop-blur-sm shadow-sm cursor-pointer active:scale-95 transition-all"
              >
                <User className="w-5 h-5" />
              </div>
              <div className="text-left">
                <h1 className="text-xl font-bold text-white tracking-tight">Wallet</h1>
                <p className="text-green-200 text-[10px] font-semibold uppercase tracking-[0.2em]">
                  Manage Earnings
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-6 space-y-5 -mt-6 relative z-20 flex-1 overflow-y-auto no-scrollbar">
          
          {/* Missing Bank Details Alert */}
          {!bankDetailsFilled && (
            <div className="bg-amber-50 rounded-2xl p-4 flex items-center gap-3 border border-amber-200 shadow-sm">
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600 shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-[12px] font-bold text-gray-900 mb-0.5">
                  Bank Details Missing
                </h3>
                <p className="text-[10px] text-gray-500 font-medium">Add details to receive payouts</p>
              </div>
              <button
                onClick={() => navigate('/food/delivery/profile/details')}
                className="bg-black text-white px-4 py-2 rounded-xl font-bold text-[10px] uppercase tracking-wider active:scale-95 transition-all shadow-md"
              >
                Add Now
              </button>
            </div>
          )}

          {/* Available Balance Card */}
          <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-gray-100">
            <div className="flex items-start justify-between gap-3 mb-6">
              <div>
                <p className="text-gray-400 text-[10px] font-semibold uppercase tracking-widest mb-1.5">
                  Available Balance
                </p>
                <h2 className="text-[40px] leading-none font-bold text-gray-900 tracking-tighter">
                  {formatCurrency(balance)}
                </h2>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-green-50 border border-green-100 flex items-center justify-center text-green-600 shadow-sm">
                <Wallet className="w-6 h-6" />
              </div>
            </div>
            <button
              onClick={() => navigate('/food/delivery/pocket/withdraw')}
              className="w-full h-14 bg-black hover:bg-gray-900 text-white rounded-2xl font-extrabold text-[15px] shadow-lg shadow-black/10 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              Withdraw Funds
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Earnings Overview & Delivery History */}
          <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <p className="text-gray-400 text-[10px] font-semibold uppercase tracking-widest">
                Earnings Overview
              </p>
              <div className="relative bg-gray-50 p-1 rounded-xl flex items-center border border-gray-100">
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  className="appearance-none bg-transparent text-[11px] font-semibold text-gray-700 pl-3 pr-8 py-1 outline-none cursor-pointer"
                >
                  <option value="today">Today</option>
                  <option value="week">This Week</option>
                  <option value="month">This Month</option>
                  <option value="all">Lifetime</option>
                </select>
                <div className="absolute right-2 pointer-events-none text-gray-400">
                  <ChevronRight className="w-3.5 h-3.5 rotate-90" />
                </div>
              </div>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <h2 className="text-3xl font-bold text-gray-900 tracking-tight">
                  {formatCurrency(earnings)}
                </h2>
                <p className="text-[12px] font-medium text-gray-500 mt-1">
                  from <span className="font-semibold text-gray-900">{ordersCount}</span> {ordersCount === 1 ? 'delivery' : 'deliveries'}
                </p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-400">
                <IndianRupee className="w-5 h-5" />
              </div>
            </div>
            {gigExtra.amount > 0 && (
              <div className="mt-4 flex items-center justify-between rounded-xl bg-green-50 px-3 py-2 text-[12px] font-semibold text-green-800">
                <span>Gig extra earned (all time, {gigExtra.orders} {gigExtra.orders === 1 ? 'order' : 'orders'})</span>
                <span className="font-extrabold">+{formatCurrency(gigExtra.amount)}</span>
              </div>
            )}
            {gigExtra.recent.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {gigExtra.recent.slice(0, 5).map((g) => (
                  <div key={g._id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-[12px]">
                    <span className="text-gray-600">Gig bonus · {g.slotName} · {g.service === 'quickCommerce' ? 'Marketplace' : g.service === 'taxi' ? 'Taxi' : 'Food'} · {new Date(g.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                    <span className="font-bold text-green-700">+{formatCurrency(g.amount)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="h-px bg-gray-100 my-6" />

            {/* Delivery History */}
            <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-[13px] font-semibold text-gray-900 tracking-tight">
                  Recent Deliveries
                </h3>
                <span className="bg-gray-50 text-gray-500 px-3 py-1 rounded-full text-[10px] font-semibold shadow-sm">
                  {trips.length}
                  {tripsTotal > trips.length ? ` of ${tripsTotal}` : ''}
                </span>
              </div>

              {trips.length === 0 ? (
                <div className="bg-gray-50 rounded-2xl border border-gray-100 p-8 text-center shadow-sm">
                  <div className="w-14 h-14 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm border border-gray-100">
                    <Package className="w-6 h-6 text-gray-300" />
                  </div>
                  <p className="text-[13px] font-semibold text-gray-900 mb-1">No deliveries yet</p>
                  <p className="text-[11px] text-gray-500">
                    Completed deliveries for {getPeriodLabel().toLowerCase()} will show here
                  </p>
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    {trips.map((trip, idx) => {
                      const oid = trip.orderId || trip._id || trip.id;
                      const earning = Number(trip.deliveryEarning ?? trip.earningAmount ?? trip.amount) || 0;
                      return (
                        <motion.div
                          key={`${String(oid)}-${idx}`}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: Math.min((idx % TRIPS_PAGE_SIZE) * 0.03, 0.3) }}
                          className="bg-gray-50 rounded-2xl border border-gray-100 p-3 flex items-center justify-between shadow-sm cursor-pointer hover:bg-gray-100 active:scale-[0.98] transition-all"
                          onClick={() => setSelectedTrip(trip)}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center text-green-600 shrink-0">
                              <Package className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[13px] font-semibold text-gray-900 truncate mb-0.5">
                                {trip.restaurantName || trip.restaurant || 'Delivery'}
                              </p>
                              <p className="text-[11px] font-medium text-gray-500 truncate">
                                ID: {String(oid).slice(-6).toUpperCase()} • {formatTripDate(trip)}
                              </p>
                            </div>
                          </div>
                          <p className="text-[14px] font-semibold text-green-600 shrink-0 ml-3 bg-white px-2 py-1 rounded-lg border border-green-100">
                            +{formatCurrency(earning)}
                          </p>
                        </motion.div>
                      );
                    })}
                  </div>

                  {hasMoreTrips ? (
                    <button
                      type="button"
                      onClick={handleLoadMore}
                      disabled={loadingMoreTrips}
                      className="w-full h-12 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-2xl text-[12px] font-semibold text-gray-700 active:scale-[0.98] transition-all disabled:opacity-60 flex items-center justify-center gap-2 shadow-sm"
                    >
                      {loadingMoreTrips ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        'Load more'
                      )}
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Trip Details Popup */}
      <AnimatePresence>
        {selectedTrip && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100]"
              onClick={() => setSelectedTrip(null)}
            />
            <motion.div
              initial={{ opacity: 0, y: 100, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 100, scale: 0.95 }}
              className="fixed bottom-0 left-0 right-0 sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl z-[101] overflow-hidden"
            >
              <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <h3 className="text-lg font-bold text-gray-900 tracking-tight">Delivery Details</h3>
                <button
                  onClick={() => setSelectedTrip(null)}
                  className="w-8 h-8 rounded-full bg-white hover:bg-gray-100 flex items-center justify-center text-gray-500 transition-colors shadow-sm border border-gray-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-6 space-y-5">
                <div className="flex items-center justify-between bg-gray-50 p-4 rounded-2xl border border-gray-100 shadow-sm">
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-1">Earning</p>
                    <p className="text-2xl font-black text-green-600">
                      {formatCurrency(Number(selectedTrip.deliveryEarning ?? selectedTrip.earningAmount ?? selectedTrip.amount) || 0)}
                    </p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center shadow-sm border border-gray-100 text-green-600">
                    <IndianRupee className="w-6 h-6" />
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Order ID</p>
                    <p className="text-sm font-bold text-gray-900">{selectedTrip.orderId || selectedTrip._id || selectedTrip.id}</p>
                  </div>
                  
                  <div>
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Date & Time</p>
                    <p className="text-sm font-bold text-gray-900">{formatTripDate(selectedTrip)}</p>
                  </div>

                  <div>
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Restaurant / Pickup</p>
                    <p className="text-sm font-bold text-gray-900">{selectedTrip.restaurantName || selectedTrip.restaurant || 'Delivery'}</p>
                  </div>

                  {selectedTrip.distance && (
                    <div>
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Distance</p>
                      <p className="text-sm font-bold text-gray-900">{selectedTrip.distance} km</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default PocketV2;
