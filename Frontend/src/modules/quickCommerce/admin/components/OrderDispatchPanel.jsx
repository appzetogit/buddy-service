import React, { useState } from 'react';
import { Ban, Clock, Loader2, Truck, UserPlus, Users, X } from 'lucide-react';
import Card from '@shared/components/ui/Card';
import Badge from '@shared/components/ui/Badge';
import { adminApi } from '../services/adminApi';

const CLOSED_STATUSES = [
    'delivered',
    'cancelled_by_user',
    'cancelled_by_restaurant',
    'cancelled_by_admin',
    'cancelled_by_system',
];

const formatDateTime = (value) => {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return 'NA';
    return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const errorMessage = (error, fallback) =>
    error?.response?.data?.message || error?.response?.data?.error || error?.message || fallback;

/**
 * Admin dispatch controls for a Quick Commerce order - the same actions Food's admin has:
 * assign / reassign the rider, add a second rider, cancel the order. Also shows the hunt state,
 * the scheduled slot and any delay the rider or store reported.
 */
export default function OrderDispatchPanel({ order, onChanged, showToast }) {
    const [picker, setPicker] = useState(null); // 'primary' | 'second' | null
    const [riders, setRiders] = useState([]);
    const [ridersLoading, setRidersLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [cancelOpen, setCancelOpen] = useState(false);
    const [cancelReason, setCancelReason] = useState('');

    if (!order) return null;

    const orderKey = order._id || order.orderId;
    const orderStatus = String(order.orderStatus || '').toLowerCase();
    const closed = CLOSED_STATUSES.includes(orderStatus);
    const dispatch = order.dispatch || {};
    const primaryAccepted = Boolean(dispatch.acceptedAt);
    const hasPrimary = Boolean(order.deliveryBoy || order.deliveryPartner);
    const hasSecond = Boolean(dispatch.sharedPartnerId || order.sharedDeliveryBoy);
    const canReassign = !closed && orderStatus !== 'picked_up' && orderStatus !== 'scheduled';
    const canAddSecond = !closed && primaryAccepted && !hasSecond;
    const sharedBoy = order.sharedDeliveryBoy;

    const openPicker = async (mode) => {
        setPicker(mode);
        setRidersLoading(true);
        try {
            const response = await adminApi.getAssignableRiders(orderKey);
            setRiders(response.data?.data?.riders || response.data?.riders || []);
        } catch (error) {
            showToast?.(errorMessage(error, 'Failed to load riders'), 'error');
            setRiders([]);
        } finally {
            setRidersLoading(false);
        }
    };

    const choose = async (rider) => {
        setBusy(true);
        try {
            if (picker === 'second') {
                await adminApi.assignSecondRider(orderKey, rider._id);
                showToast?.(`${rider.name} added as second rider`, 'success');
            } else {
                await adminApi.assignRider(orderKey, rider._id);
                showToast?.(`Order assigned to ${rider.name}. Waiting for them to accept.`, 'success');
            }
            setPicker(null);
            await onChanged?.();
        } catch (error) {
            showToast?.(errorMessage(error, 'Action failed'), 'error');
        } finally {
            setBusy(false);
        }
    };

    const confirmCancel = async () => {
        setBusy(true);
        try {
            await adminApi.cancelOrder(orderKey, cancelReason.trim());
            showToast?.('Order cancelled. Refund started where applicable.', 'success');
            setCancelOpen(false);
            setCancelReason('');
            await onChanged?.();
        } catch (error) {
            showToast?.(errorMessage(error, 'Failed to cancel order'), 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <Card className="border-none shadow-xl ring-1 ring-slate-100 bg-white rounded-xl p-6 text-left">
                <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                            <Truck className="h-3.5 w-3.5" /> Dispatch Control
                        </h4>
                        <Badge className="bg-slate-100 text-slate-700 border-none text-[8px] font-black uppercase tracking-widest">
                            {String(dispatch.status || 'unassigned').replace(/_/g, ' ')}
                        </Badge>
                    </div>

                    {order.scheduledAt ? (
                        <div className="flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 text-[11px] font-bold text-indigo-700">
                            <Clock className="h-3.5 w-3.5" />
                            Scheduled for {formatDateTime(order.scheduledAt)}
                        </div>
                    ) : null}

                    {order.delayContext?.reason ? (
                        <div className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800">
                            Delay reported by {String(order.delayContext.reportedBy || '').toLowerCase()}: {order.delayContext.reason}
                        </div>
                    ) : null}

                    <div className="grid grid-cols-2 gap-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        <div>Hunt rounds<p className="text-sm font-black text-slate-900 normal-case">{dispatch.dispatchAttempt || 0}</p></div>
                        <div>Riders asked<p className="text-sm font-black text-slate-900 normal-case">{dispatch.offeredCount || 0}</p></div>
                    </div>

                    {hasSecond ? (
                        <div className="rounded-xl border border-slate-100 p-3">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                <Users className="h-3.5 w-3.5" /> Second rider
                            </p>
                            <p className="mt-1 text-sm font-black text-slate-900">{sharedBoy?.name || 'Delivery Partner'}</p>
                            <p className="text-[10px] font-bold text-slate-400">
                                {sharedBoy?.phone || ''} · Primary ₹{order.riderEarning ?? 0} / Second ₹{order.sharedRiderEarning ?? 0}
                            </p>
                        </div>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            disabled={!canReassign || busy}
                            onClick={() => openPicker('primary')}
                            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40"
                        >
                            <Truck className="h-3.5 w-3.5" />
                            {hasPrimary ? 'Reassign rider' : 'Assign rider'}
                        </button>
                        <button
                            type="button"
                            disabled={!canAddSecond || busy}
                            onClick={() => openPicker('second')}
                            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-700 ring-1 ring-slate-200 disabled:opacity-40"
                        >
                            <UserPlus className="h-3.5 w-3.5" />
                            Add second rider
                        </button>
                        <button
                            type="button"
                            disabled={closed || busy}
                            onClick={() => setCancelOpen(true)}
                            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40"
                        >
                            <Ban className="h-3.5 w-3.5" />
                            Cancel order
                        </button>
                    </div>
                </div>
            </Card>

            {picker ? (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">
                                {picker === 'second' ? 'Choose second rider' : 'Choose rider'}
                            </h3>
                            <button type="button" onClick={() => setPicker(null)} className="text-slate-400"><X className="h-4 w-4" /></button>
                        </div>
                        <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">
                            {ridersLoading ? (
                                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
                            ) : riders.length === 0 ? (
                                <p className="py-6 text-center text-xs font-bold text-slate-400">No online riders available right now.</p>
                            ) : (
                                riders.map((rider) => (
                                    <button
                                        key={rider._id}
                                        type="button"
                                        disabled={busy}
                                        onClick={() => choose(rider)}
                                        className="flex w-full items-center justify-between rounded-xl border border-slate-100 px-3 py-2.5 text-left hover:bg-slate-50 disabled:opacity-50"
                                    >
                                        <span>
                                            <span className="block text-sm font-black text-slate-900">{rider.name}</span>
                                            <span className="block text-[10px] font-bold text-slate-400">
                                                {rider.phone} {rider.vehicleType ? `· ${rider.vehicleType}` : ''}
                                            </span>
                                        </span>
                                        <span className="text-[10px] font-black text-slate-500">
                                            {rider.distanceKm != null ? `${Number(rider.distanceKm).toFixed(1)} km` : '-'}
                                        </span>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            ) : null}

            {cancelOpen ? (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
                        <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Cancel this order?</h3>
                        <p className="mt-1 text-xs font-bold text-slate-500">
                            The customer is refunded where they paid, the store and rider are released, and stock is restored.
                        </p>
                        <textarea
                            value={cancelReason}
                            onChange={(event) => setCancelReason(event.target.value)}
                            placeholder="Reason (shown to the customer)"
                            rows={3}
                            className="mt-3 w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-rose-400"
                        />
                        <div className="mt-4 flex justify-end gap-2">
                            <button type="button" onClick={() => setCancelOpen(false)} className="rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                Keep order
                            </button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={confirmCancel}
                                className="rounded-xl bg-rose-600 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
                            >
                                {busy ? 'Cancelling...' : 'Cancel order'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </>
    );
}
