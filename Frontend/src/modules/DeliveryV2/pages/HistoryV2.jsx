import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2,
  History,
  MapPin,
  Navigation2,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { deliveryAPI } from '@food/api';
import { toast } from 'sonner';
import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';
import ServiceFilter, { ServiceBadge, tripService, tripPaymentLine } from '@/modules/DeliveryV2/components/ServiceFilter';

const PAGE_SIZE = 15;

function tripStatusLabel(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed' || s === 'delivered') return 'Completed';
  if (s.includes('cancel')) return 'Cancelled';
  if (s === 'pending' || s === 'active' || s === 'in_progress') return 'In progress';
  return status || 'Pending';
}

function statusTone(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed' || s === 'delivered') return 'bg-emerald-50 text-emerald-700';
  if (s.includes('cancel')) return 'bg-rose-50 text-rose-600';
  return 'bg-amber-50 text-amber-700';
}

function formatTripTime(trip) {
  if (trip?.time) return trip.time;
  const raw = trip?.deliveredAt || trip?.createdAt || trip?.orderDate;
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * HistoryV2 — active trip + paginated trip history (no income summary).
 */
export const HistoryV2 = () => {
  const navigate = useNavigate();
  const storeActiveOrder = useDeliveryStore((s) => s.activeOrder);
  const tripStatus = useDeliveryStore((s) => s.tripStatus);

  const [filter, setFilter] = useState('all');
  const [service, setService] = useState('');
  const [page, setPage] = useState(1);
  const [trips, setTrips] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, hasMore: false });
  const [loading, setLoading] = useState(false);
  const [activeTrip, setActiveTrip] = useState(null);
  const [loadingActive, setLoadingActive] = useState(true);

  const loadActiveTrip = useCallback(async () => {
    setLoadingActive(true);
    try {
      if (storeActiveOrder && tripStatus !== 'COMPLETED' && tripStatus !== 'IDLE') {
        setActiveTrip(storeActiveOrder);
        return;
      }
      const response = await deliveryAPI.getCurrentDelivery();
      const data = response?.data?.data;
      const candidate = data && Object.prototype.hasOwnProperty.call(data, 'activeOrder')
        ? data.activeOrder
        : data;
      if (!candidate || !(candidate._id || candidate.orderId || candidate.order_id)) {
        setActiveTrip(null);
        return;
      }
      const status = String(
        candidate.orderStatus || candidate.status || candidate.deliveryStatus || '',
      ).toLowerCase();
      if (
        status.startsWith('cancelled') ||
        status === 'delivered' ||
        status === 'completed' ||
        status === 'deleted'
      ) {
        setActiveTrip(null);
        return;
      }
      setActiveTrip(candidate);
    } catch {
      setActiveTrip(
        storeActiveOrder && tripStatus !== 'COMPLETED' && tripStatus !== 'IDLE'
          ? storeActiveOrder
          : null,
      );
    } finally {
      setLoadingActive(false);
    }
  }, [storeActiveOrder, tripStatus]);

  const loadTrips = useCallback(async (pageToLoad = 1) => {
    setLoading(true);
    try {
      const params = {
        period: 'all',
        page: pageToLoad,
        limit: PAGE_SIZE,
        status:
          filter === 'completed'
            ? 'Completed'
            : filter === 'cancelled'
              ? 'Cancelled'
              : filter === 'pending'
                ? 'Pending'
                : undefined,
        ...(service ? { service } : {}),
      };
      const response = await deliveryAPI.getTripHistory(params);
      const payload = response?.data?.data || {};
      if (response.data?.success) {
        setTrips(Array.isArray(payload.trips) ? payload.trips : []);
        setPagination({
          page: Number(payload.pagination?.page) || pageToLoad,
          limit: Number(payload.pagination?.limit) || PAGE_SIZE,
          total: Number(payload.pagination?.total) || 0,
          hasMore: Boolean(payload.pagination?.hasMore),
        });
      } else {
        setTrips([]);
        setPagination({ page: 1, limit: PAGE_SIZE, total: 0, hasMore: false });
      }
    } catch {
      toast.error('Failed to load trip history');
      setTrips([]);
      setPagination({ page: 1, limit: PAGE_SIZE, total: 0, hasMore: false });
    } finally {
      setLoading(false);
    }
  }, [filter, service]);

  useEffect(() => {
    loadActiveTrip();
  }, [loadActiveTrip]);

  useEffect(() => {
    setPage(1);
  }, [filter, service]);

  useEffect(() => {
    loadTrips(page);
  }, [loadTrips, page]);

  const activeTripId = useMemo(() => {
    if (!activeTrip) return null;
    return String(activeTrip._id || activeTrip.orderId || activeTrip.order_id || activeTrip.orderMongoId || '');
  }, [activeTrip]);

  const historyTrips = useMemo(() => {
    if (!activeTripId) return trips;
    return trips.filter((trip) => {
      const id = String(trip.orderId || trip._id || trip.order_id || '');
      return id !== activeTripId;
    });
  }, [trips, activeTripId]);

  const totalPages = Math.max(1, Math.ceil((pagination.total || 0) / (pagination.limit || PAGE_SIZE)));
  const canGoPrev = page > 1;
  const canGoNext = Boolean(pagination.hasMore) || page < totalPages;

  const filters = [
    { id: 'all', label: 'All' },
    { id: 'completed', label: 'Completed' },
    { id: 'cancelled', label: 'Cancelled' },
    { id: 'pending', label: 'Pending' },
  ];

  const activeRestaurant =
    activeTrip?.restaurant ||
    activeTrip?.restaurantName ||
    activeTrip?.restaurantId?.restaurantName ||
    activeTrip?.pickups?.[0]?.restaurantName ||
    'Restaurant';

  const activeOrderLabel =
    activeTrip?.orderId || activeTrip?.order_id || activeTrip?._id || 'Active order';

  const activeStatus =
    tripStatus && tripStatus !== 'IDLE'
      ? String(tripStatus).replace(/_/g, ' ')
      : tripStatusLabel(activeTrip?.orderStatus || activeTrip?.status || 'In progress');

  return (
    <div className="min-h-screen bg-[#F7F8F7] font-sans pb-32">
      <div className="sticky top-0 z-30 bg-white border-b border-gray-100 px-4 py-4">
        <h1 className="text-lg font-bold text-gray-900">Trips</h1>
        <p className="text-xs text-gray-500 mt-0.5">Active trip and history</p>
      </div>

      <div className="px-4 pt-4 space-y-4">
        {/* Active trip */}
        <section>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
            Active trip
          </p>
          {loadingActive ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#16A34A]" />
              <span className="text-xs text-gray-500">Checking…</span>
            </div>
          ) : activeTrip ? (
            <button
              type="button"
              onClick={() => navigate('/food/delivery/feed')}
              className="w-full text-left bg-white rounded-2xl border border-[#16A34A]/30 p-4 shadow-sm active:scale-[0.99] transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-[#16A34A] text-white px-2 py-0.5 rounded-full">
                      <Navigation2 className="w-3 h-3" />
                      Live
                    </span>
                    <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full capitalize">
                      {activeStatus}
                    </span>
                  </div>
                  <p className="text-sm font-bold text-gray-900 truncate">{activeOrderLabel}</p>
                  <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1 truncate">
                    <MapPin className="w-3 h-3 shrink-0" />
                    {activeRestaurant}
                  </p>
                </div>
                <span className="shrink-0 text-xs font-semibold text-[#16A34A] mt-1">Continue →</span>
              </div>
            </button>
          ) : (
            <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-4 text-center">
              <p className="text-sm text-gray-500">No active trip right now</p>
            </div>
          )}
        </section>

        {/* Filters */}
        <section className="bg-white rounded-2xl border border-gray-100 p-3">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {filters.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                  filter === item.id
                    ? 'bg-[#16A34A] text-white'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-3">
            <ServiceFilter value={service} onChange={setService} />
          </div>
        </section>

        {/* History list */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Trip history
            </p>
            <p className="text-[11px] text-gray-400">
              {pagination.total > 0
                ? `${pagination.total} total`
                : ''}
            </p>
          </div>

          {loading ? (
            <div className="py-12 flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-[#16A34A]" />
              <p className="text-xs text-gray-500">Loading trips…</p>
            </div>
          ) : historyTrips.length > 0 ? (
            <>
              <div className="space-y-2">
                {historyTrips.map((trip, idx) => {
                  const status = tripStatusLabel(trip.status);
                  const restaurant = trip.restaurant || trip.restaurantName || 'Restaurant';
                  const orderId = trip.orderId || trip._id || `Trip ${idx + 1}`;
                  const isCompleted = status === 'Completed';
                  const isCancelled = status === 'Cancelled';

                  return (
                    <div
                      key={String(orderId) + idx}
                      className="bg-white rounded-2xl border border-gray-100 px-4 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{orderId}</p>
                          <p className="text-xs text-gray-500 truncate mt-0.5">{restaurant}</p>
                          <div className="mt-1 flex items-center gap-1.5">
                            <ServiceBadge service={tripService(trip)} />
                            {tripPaymentLine(trip) && <span className="truncate text-[10px] font-semibold text-gray-500">{tripPaymentLine(trip)}</span>}
                          </div>
                          <p className="text-[11px] text-gray-400 mt-1 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatTripTime(trip)}
                          </p>
                        </div>
                        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusTone(status)}`}>
                          {isCompleted ? (
                            <CheckCircle2 className="w-3 h-3" />
                          ) : isCancelled ? (
                            <XCircle className="w-3 h-3" />
                          ) : (
                            <Clock className="w-3 h-3" />
                          )}
                          {status}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between bg-white rounded-2xl border border-gray-100 px-3 py-2.5">
                  <button
                    type="button"
                    disabled={!canGoPrev || loading}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-gray-700 bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Prev
                  </button>
                  <p className="text-xs font-medium text-gray-600">
                    Page {page} of {totalPages}
                  </p>
                  <button
                    type="button"
                    disabled={!canGoNext || loading}
                    onClick={() => setPage((p) => p + 1)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-gray-700 bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="py-14 text-center bg-white rounded-2xl border border-gray-100">
              <History className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No trips found</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default HistoryV2;
