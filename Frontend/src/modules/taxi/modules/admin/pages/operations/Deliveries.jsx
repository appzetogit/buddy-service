import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Filter, LoaderCircle, MoreVertical, Search, CheckCircle, Clock, XCircle, MapPin, Truck, ChevronRight, X, FileText, Eye, Download, User, CreditCard, Image as ImageIcon, Info, Maximize2 } from 'lucide-react';
import { adminService } from '../../services/adminService';
import { useNavigate } from '@taxi/shared/router';
import toast from 'react-hot-toast';
import { TAXI_API_BASE, BACKEND_ORIGIN, getAdminToken } from '@taxi/shared/api/session';

const STATUS_STYLES = {
  COMPLETED: 'bg-green-100 text-green-700 border border-green-200',
  CANCELLED: 'bg-red-100 text-red-700 border border-red-200',
  PENDING: 'bg-yellow-100 text-yellow-700 border border-yellow-200',
  UPCOMING: 'bg-yellow-100 text-yellow-700 border border-yellow-200',
  ON_TRIP: 'bg-blue-100 text-blue-700 border border-blue-200',
  ONGOING: 'bg-blue-100 text-blue-700 border border-blue-200',
  ASSIGNED: 'bg-purple-100 text-purple-700 border border-purple-200',
};

const PAYMENT_STYLES = {
  CASH: 'bg-gray-100 text-gray-700 border border-gray-200',
  ONLINE: 'bg-blue-50 text-blue-600 border border-blue-100',
  UPI: 'bg-green-50 text-green-600 border border-green-100',
  CARD: 'bg-purple-50 text-purple-600 border border-purple-100',
  WALLET: 'bg-teal-50 text-teal-600 border border-teal-100',
  COD: 'bg-green-50 text-green-600 border border-green-100',
};

const formatDate = (dateStr) => {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const optionsDate = { day: '2-digit', month: 'short', year: 'numeric' };
  const optionsTime = { hour: '2-digit', minute: '2-digit', hour12: true };
  const dPart = d.toLocaleDateString('en-GB', optionsDate);
  const tPart = d.toLocaleTimeString('en-US', optionsTime);
  return `${dPart} • ${tPart}`;
};

const handlePrintInvoice = (delivery) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert("Please allow popups to print invoices.");
    return;
  }
  
  const formattedDate = formatDate(delivery.date);
  
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Delivery Invoice - ${delivery.requestId}</title>
        <style>
          body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 40px; color: #1f2937; max-width: 800px; margin: 0 auto; }
          .header { text-align: center; border-bottom: 2px solid #e5e7eb; padding-bottom: 30px; margin-bottom: 30px; }
          .title { font-size: 28px; font-weight: 800; margin: 0; color: #111827; letter-spacing: 1px; }
          .subtitle { color: #6b7280; font-size: 14px; margin-top: 8px; }
          .details { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
          .details th, .details td { padding: 16px 12px; border-bottom: 1px solid #f3f4f6; text-align: left; }
          .details th { width: 35%; color: #6b7280; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; }
          .details td { font-size: 15px; font-weight: 500; }
          .footer { text-align: center; color: #9ca3af; font-size: 13px; margin-top: 60px; padding-top: 20px; border-top: 1px dashed #e5e7eb; }
          .highlight { font-weight: bold; color: #000; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="header">
          <h1 class="title">DELIVERY INVOICE</h1>
          <p class="subtitle">Request ID: <span class="highlight">${delivery.requestId || 'N/A'}</span></p>
        </div>
        <table class="details">
          <tr><th>Date</th><td>${formattedDate}</td></tr>
          <tr><th>Customer</th><td>${delivery.userName || 'N/A'}</td></tr>
          <tr><th>Driver</th><td>${delivery.driverName || 'N/A'}</td></tr>
          <tr><th>Transport Type</th><td style="text-transform: capitalize;">${String(delivery.transportType || '').toLowerCase()}</td></tr>
          <tr><th>Payment Method</th><td style="text-transform: capitalize;">${String(delivery.paymentOption || '').toLowerCase()}</td></tr>
          <tr><th>Delivery Status</th><td style="text-transform: capitalize;">${String(delivery.tripStatus || '').toLowerCase()}</td></tr>
        </table>
        <div class="footer">
          Thank you for choosing our service.<br/>
          This is a computer generated invoice and requires no signature.
        </div>
        <script>
          window.onload = () => { 
            setTimeout(() => { window.print(); window.close(); }, 300);
          }
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
};

const DeliveryDetailsDrawer = ({ delivery, onClose }) => {
  if (!delivery) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-md shadow-2xl flex flex-col rounded-xl overflow-hidden max-h-[90vh] animate-in slide-in-from-bottom-4">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-5">
          <h2 className="text-xl font-bold text-gray-900 tracking-tight">Delivery Details</h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          
          {/* Status & ID */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider font-bold text-gray-400 mb-1">Request ID</p>
              <p className="text-[14px] font-bold text-gray-900 font-mono">{delivery.requestId || 'N/A'}</p>
            </div>
            <span className={`inline-flex items-center px-3 py-1 text-[11px] font-bold rounded-full capitalize tracking-wide ${STATUS_STYLES[delivery.tripStatus] || 'bg-gray-100 text-gray-600'}`}>
              {String(delivery.tripStatus || '').toLowerCase()}
            </span>
          </div>

          {/* Core Info */}
          <div className="grid grid-cols-2 gap-y-6 gap-x-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
            <div>
              <p className="text-[11px] uppercase tracking-wider font-bold text-gray-400 mb-1">Date & Time</p>
              <p className="text-[13px] font-bold text-gray-900">{formatDate(delivery.date)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider font-bold text-gray-400 mb-1">Transport</p>
              <p className="text-[13px] font-bold text-gray-900 capitalize flex items-center gap-1">
                <Truck size={14} className="text-gray-400"/>
                {String(delivery.transportType || '').toLowerCase()}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider font-bold text-gray-400 mb-1">Customer</p>
              <p className="text-[13px] font-bold text-gray-900 flex items-center gap-1">
                <User size={14} className="text-gray-400"/>
                {delivery.userName || 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider font-bold text-gray-400 mb-1">Driver</p>
              <p className="text-[13px] font-bold text-gray-900 flex items-center gap-1">
                <User size={14} className="text-gray-400"/>
                {delivery.driverName || 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider font-bold text-gray-400 mb-1">Payment Option</p>
              <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded capitalize tracking-wide ${PAYMENT_STYLES[delivery.paymentOption] || 'bg-gray-100 text-gray-600'}`}>
                {String(delivery.paymentOption || '').toLowerCase()}
              </span>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider font-bold text-gray-400 mb-1">Distance / Fare</p>
              <p className="text-[13px] font-bold text-gray-900">{delivery.distance || '-'} / {delivery.fare || '-'}</p>
            </div>
          </div>

          {/* Parcel photos: the sender's own photos + the driver's pickup /
              delivery proof, so the admin can see what was sent and handed over. */}
          {(() => {
            const parcel = delivery.parcel || {};
            const resolveUrl = (u) =>
              !u ? '' : (String(u).startsWith('http') ? u : `${BACKEND_ORIGIN}${u}`);
            const senderPhotos = Array.isArray(parcel.photos) ? parcel.photos.filter(Boolean) : [];
            const proofs = [
              { label: 'Picked up', url: parcel.pickupProof },
              { label: 'Delivered', url: parcel.deliveryProof },
            ].filter((p) => p.url);
            if (!senderPhotos.length && !proofs.length) return null;
            return (
              <div className="space-y-4">
                {senderPhotos.length > 0 && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wider font-bold text-gray-400 mb-2">Sender's parcel photos</p>
                    <div className="flex flex-wrap gap-3">
                      {senderPhotos.map((u, i) => (
                        <a key={i} href={resolveUrl(u)} target="_blank" rel="noreferrer">
                          <img src={resolveUrl(u)} alt="Parcel" className="h-24 w-24 rounded-lg border border-gray-200 object-cover" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                {proofs.length > 0 && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wider font-bold text-gray-400 mb-2">Handover proof</p>
                    <div className="flex flex-wrap gap-3">
                      {proofs.map((p, i) => (
                        <div key={i} className="text-center">
                          <a href={resolveUrl(p.url)} target="_blank" rel="noreferrer">
                            <img src={resolveUrl(p.url)} alt={p.label} className="h-24 w-24 rounded-lg border border-gray-200 object-cover" />
                          </a>
                          <p className="text-[11px] font-semibold text-gray-500 mt-1">{p.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

        </div>
        <div className="border-t border-gray-100 p-5 bg-white flex justify-end gap-3">
          <button onClick={() => handlePrintInvoice(delivery)} className="px-5 py-2 text-sm font-bold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2">
            <FileText size={16} /> Print
          </button>
          <button onClick={onClose} className="px-5 py-2 text-sm font-bold text-white bg-black rounded-lg shadow-sm hover:bg-gray-900 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const resolveMediaUrl = (u) =>
  !u ? '' : (String(u).startsWith('http') ? u : `${BACKEND_ORIGIN}${u}`);

/// The server's numbered invoice PDF for a completed delivery, as on the
/// Payments page.
const downloadInvoice = async (row) => {
  try {
    const token = getAdminToken();
    const res = await fetch(
      `${TAXI_API_BASE}/admin/payments/ride/${row.id}/invoice`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (!res.ok) throw new Error(`Invoice failed (${res.status})`);
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || `${row.requestId}.pdf`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error(err);
    toast.error('Could not download the invoice');
  }
};

const MenuItem = ({ icon: Icon, label, onClick, disabled, danger, title }) => (
  <button
    type="button"
    disabled={disabled}
    title={title}
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    className={`w-full flex items-center gap-2.5 px-3 py-2 text-[12px] font-semibold text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'
    }`}
  >
    <Icon size={14} className={danger ? 'text-red-500' : 'text-gray-400'} />
    {label}
  </button>
);

const ActionMenu = ({ row, onViewDetails, onPrintInvoice, onProofPhotos, onPaymentDetails, onCancel, onTrack, onCustomer, onDriver }) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const run = (fn) => () => { setIsOpen(false); fn(); };
  const isCompleted = row.tripStatus === 'COMPLETED';
  const isCancelled = row.tripStatus === 'CANCELLED';
  const isOngoing = row.tripStatus === 'ON_TRIP' || row.tripStatus === 'ONGOING';
  const hasDriver = Boolean(row.driverId);
  const hasProof = Boolean(row.parcel?.pickupProof || row.parcel?.deliveryProof || row.parcel?.photos?.length);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
        className="p-1.5 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-yellow-400"
        aria-label="Actions"
        aria-expanded={isOpen}
      >
        <MoreVertical size={18} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl shadow-lg border border-gray-100 py-1.5 z-50 text-left">
          <MenuItem icon={Eye} label="View Details" onClick={run(onViewDetails)} />
          <MenuItem icon={ImageIcon} label="Delivery Proof Photos" onClick={run(onProofPhotos)} disabled={!hasProof} title={hasProof ? '' : 'No photos uploaded yet'} />
          <MenuItem icon={MapPin} label="Track Delivery" onClick={run(onTrack)} disabled={!isOngoing} title={isOngoing ? '' : 'Only while the delivery is on its way'} />
          <div className="my-1 border-t border-gray-100" />
          <MenuItem icon={User} label="Customer Details" onClick={run(onCustomer)} disabled={!row.userId} />
          <MenuItem icon={Truck} label="Driver Details" onClick={run(onDriver)} disabled={!hasDriver} title={hasDriver ? '' : 'No driver assigned'} />
          <MenuItem icon={CreditCard} label="Payment Details" onClick={run(onPaymentDetails)} />
          <div className="my-1 border-t border-gray-100" />
          <MenuItem icon={FileText} label="Print Invoice" onClick={run(onPrintInvoice)} />
          <MenuItem icon={Download} label="Download Invoice" onClick={run(() => downloadInvoice(row))} disabled={!isCompleted} title={isCompleted ? '' : 'Available once delivered'} />
          {!isCompleted && !isCancelled && (
            <>
              <div className="my-1 border-t border-gray-100" />
              <MenuItem icon={XCircle} label="Cancel Delivery" onClick={run(onCancel)} danger />
            </>
          )}
        </div>
      )}
    </div>
  );
};

const photoTime = (value) =>
  value ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

/// "Delivery Proof Photos": the driver's pickup and delivery photos, and the
/// sender's own parcel photos, with the delivery's key facts.
const ProofPhotosDrawer = ({ delivery, onClose }) => {
  if (!delivery) return null;
  const parcel = delivery.parcel || {};
  const shots = [
    { label: 'Pickup Photo', url: parcel.pickupProof, at: parcel.pickupProofAt },
    { label: 'Delivery Confirmation Photo', url: parcel.deliveryProof, at: parcel.deliveryProofAt },
  ];
  const senderPhotos = Array.isArray(parcel.photos) ? parcel.photos.filter(Boolean) : [];
  const facts = [
    ['Request ID', delivery.requestId],
    ['Trip Status', String(delivery.tripStatus || '').replace('_', ' ').toLowerCase()],
    ['Transport Type', delivery.transportType],
    ['Driver Name', delivery.driverName],
    ['User Name', delivery.userName],
    ['Date & Time', photoTime(delivery.date)],
  ];

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-md bg-white shadow-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900"><ImageIcon size={18} /> Delivery Proof Photos</h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-5">
          <div className="flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2.5 text-[12px] text-blue-800">
            <Info size={14} className="mt-0.5 shrink-0" />
            Photos the driver took at pickup and delivery, and any the customer added when booking.
          </div>
          <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-[13px]">
            {facts.map(([label, value]) => (
              <React.Fragment key={label}>
                <dt className="text-gray-500">{label}</dt>
                <dd className="font-semibold text-gray-900 capitalize">{value || '-'}</dd>
              </React.Fragment>
            ))}
          </dl>
          {shots.map((shot) => (
            <div key={shot.label}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[13px] font-bold text-gray-900 border-l-4 border-blue-600 pl-2">{shot.label}</p>
                <span className="text-[11px] text-gray-500">{photoTime(shot.at)}</span>
              </div>
              {shot.url ? (
                <div className="relative">
                  <img src={resolveMediaUrl(shot.url)} alt={shot.label} className="w-full max-h-72 object-cover rounded-lg border border-gray-200" />
                  <a
                    href={resolveMediaUrl(shot.url)}
                    target="_blank"
                    rel="noreferrer"
                    className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/70 px-2 py-1 text-[11px] font-semibold text-white hover:bg-black"
                  >
                    <Maximize2 size={12} /> View Full Image
                  </a>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-gray-200 py-8 text-center text-[12px] text-gray-400">Not uploaded yet</div>
              )}
            </div>
          ))}
          {senderPhotos.length > 0 && (
            <div>
              <p className="text-[13px] font-bold text-gray-900 border-l-4 border-green-500 pl-2 mb-2">Customer's Parcel Photos</p>
              <div className="grid grid-cols-3 gap-2">
                {senderPhotos.map((u, i) => (
                  <a key={i} href={resolveMediaUrl(u)} target="_blank" rel="noreferrer">
                    <img src={resolveMediaUrl(u)} alt="Parcel" className="h-24 w-full rounded-lg border border-gray-200 object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/// How the delivery was paid - by how it actually was, not just the booking.
const PaymentDetailsModal = ({ delivery, onClose }) => {
  if (!delivery) return null;
  const rows = [
    ['Fare', `₹${Number(delivery.fare || 0).toLocaleString('en-IN')}`],
    ['Method', String(delivery.paymentOption || 'cash').toLowerCase()],
    ['Detail', delivery.paymentDetail],
    ['Status', delivery.paymentStatus],
    ['Reference', delivery.paymentReference],
  ];
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h2 className="flex items-center gap-2 text-base font-bold text-gray-900"><CreditCard size={16} /> Payment Details</h2>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-900 rounded-full" aria-label="Close"><X size={16} /></button>
        </div>
        <dl className="grid grid-cols-[100px_1fr] gap-y-2 px-5 py-4 text-[13px]">
          {rows.map(([label, value]) => (
            <React.Fragment key={label}>
              <dt className="text-gray-500">{label}</dt>
              <dd className="font-semibold text-gray-900 capitalize break-all">{value || '-'}</dd>
            </React.Fragment>
          ))}
        </dl>
        <p className="px-5 pb-4 text-[11px] text-gray-400">{delivery.requestId}</p>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, icon: Icon, colorClass }) => (
  <div className="bg-white rounded-xl border border-gray-100 p-3 shadow-sm flex items-center gap-3 transition-transform hover:-translate-y-0.5 duration-200">
    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${colorClass}`}>
      <Icon size={14} />
    </div>
    <div>
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">{title}</p>
      <p className="text-base font-black text-gray-900 leading-none">{value}</p>
    </div>
  </div>
);

const Deliveries = () => {
  const [selectedDelivery, setSelectedDelivery] = useState(null);
  const [activeTab, setActiveTab] = useState('All');
  const [pageSize, setPageSize] = useState('10');
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [listTotal, setListTotal] = useState(0);
  const [proofDelivery, setProofDelivery] = useState(null);
  const [paymentDelivery, setPaymentDelivery] = useState(null);
  const navigate = useNavigate();

  // Stats
  const [stats, setStats] = useState({
    total: 0,
    completed: 0,
    pending: 0,
    cancelled: 0,
    onTrip: 0,
    today: 0,
  });

  const [draftFilters, setDraftFilters] = useState({
    status: '',
    transportType: '',
    paymentType: '',
    driverAssigned: '',
    dateFrom: '',
    dateTo: '',
    city: ''
  });
  
  const [activeFilters, setActiveFilters] = useState({
    status: '',
    transportType: '',
    paymentType: '',
    driverAssigned: '',
    dateFrom: '',
    dateTo: '',
    city: ''
  });

  useEffect(() => {
    let active = true;
    const loadDeliveries = async () => {
      setIsLoading(true);
      setError('');
      try {
        const response = await adminService.getDeliveries({
          page,
          limit: Number(pageSize) || 10,
          tab: activeTab.toLowerCase(),
          search,
          ...activeFilters // if API supports them
        });
        
        const payload = response?.data || response || {};
        const results = payload?.results || [];
        
        if (!active) return;
        setRows(results);
        
        setListTotal(Number(payload?.paginator?.total ?? results.length) || 0);
        // Across every delivery, from the server - these used to be counted
        // from the rows on this page, with "today" as half of them.
        if (payload?.stats) setStats(payload.stats);
      } catch (loadError) {
        if (active) {
          setRows([]);
          setError(loadError?.message || 'Could not load deliveries.');
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };
    loadDeliveries();
    return () => { active = false; };
  }, [activeTab, pageSize, search, activeFilters, page, reloadKey]);

  // A new tab, search or filter starts again from the first page.
  useEffect(() => {
    setPage(1);
  }, [activeTab, pageSize, search, activeFilters]);

  const totalPages = Math.max(1, Math.ceil(listTotal / (Number(pageSize) || 10)));

  const cancelDelivery = async (row) => {
    const reason = window.prompt(`Cancel ${row.requestId}? Give a reason:`, 'Cancelled by admin');
    if (reason === null) return;
    try {
      await adminService.cancelRideRequest(row.id, reason);
      toast.success('Delivery cancelled');
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not cancel the delivery');
    }
  };

  const applyFilters = () => {
    setActiveFilters(draftFilters);
    setShowFilters(false);
  };

  const resetFilters = () => {
    const emptyFilters = { status: '', transportType: '', paymentType: '', driverAssigned: '', dateFrom: '', dateTo: '', city: '' };
    setDraftFilters(emptyFilters);
    setActiveFilters(emptyFilters);
    setShowFilters(false);
  };

  const activeFilterCount = Object.values(activeFilters).filter(Boolean).length;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <div className="px-4 py-2 md:px-6 md:pt-2 md:pb-6 space-y-4 max-w-full">
        
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-white rounded-xl shadow-sm border border-gray-100">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-gray-900">Delivery Requests</h1>
            <p className="text-xs text-gray-500 mt-0.5 font-medium">Manage and monitor all delivery requests across the platform.</p>
          </div>
          <div className="hidden md:flex items-center gap-2 text-xs font-medium text-gray-400">
            <span>Operations</span>
            <ChevronRight size={14} className="text-gray-300" />
            <span className="text-gray-600">Delivery Requests</span>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCard title="Total Requests" value={stats.total} icon={Truck} colorClass="bg-gray-100 text-gray-700" />
          <StatCard title="Completed" value={stats.completed} icon={CheckCircle} colorClass="bg-green-100 text-green-600" />
          <StatCard title="Pending" value={stats.pending} icon={Clock} colorClass="bg-yellow-100 text-yellow-600" />
          <StatCard title="Cancelled" value={stats.cancelled} icon={XCircle} colorClass="bg-red-100 text-red-600" />
          <StatCard title="On Trip" value={stats.onTrip} icon={MapPin} colorClass="bg-blue-100 text-blue-600" />
          <StatCard title="Today" value={stats.today} icon={Clock} colorClass="bg-purple-100 text-purple-600" />
        </div>

        {/* Main Content Box */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm flex flex-col relative">
          
          {/* Controls Bar */}
          <div className="flex flex-col gap-4 border-b border-gray-100 px-4 py-3 lg:flex-row lg:items-center">
            
            <div className="flex items-center gap-2 text-xs font-medium text-gray-500 shrink-0">
              <span>Show</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(e.target.value)}
                className="h-8 w-14 border border-gray-200 rounded-md bg-gray-50 px-1.5 outline-none focus:ring-1 focus:ring-yellow-400 focus:border-yellow-400 text-gray-700 font-bold text-[11px]"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
              <span>Entries</span>
            </div>

            {/* Tabs */}
            <div className="flex flex-1 items-center gap-1 overflow-x-auto no-scrollbar border-b border-gray-100 lg:border-b-0 pb-1 lg:pb-0 lg:justify-center">
              {['All', 'Completed', 'Cancelled', 'Upcoming', 'On Trip'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`relative px-3 py-1.5 text-xs font-bold transition-colors whitespace-nowrap rounded-t-md lg:rounded-md ${
                    activeTab === tab ? 'text-gray-900 bg-yellow-50 lg:bg-transparent' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {tab}
                  {activeTab === tab && (
                    <div className="absolute -bottom-1 lg:-bottom-2 left-0 right-0 h-0.5 bg-yellow-400 rounded-t-full hidden lg:block" />
                  )}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <div className="relative w-full sm:w-48">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search deliveries..."
                  className="h-8 w-full rounded-md border border-gray-200 bg-gray-50 pl-8 pr-3 text-[11px] outline-none focus:bg-white focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 transition-all font-medium"
                />
              </div>
              <button 
                onClick={() => setShowFilters(!showFilters)}
                className={`flex h-8 items-center gap-1.5 px-3 rounded-md text-[11px] font-bold transition-colors border relative ${activeFilterCount > 0 ? 'bg-yellow-400 text-black border-yellow-400 shadow-sm' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
              >
                <Filter size={13} /> Filters
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-black text-white text-[9px] rounded-full flex items-center justify-center font-bold">
                    {activeFilterCount}
                  </span>
                )}
              </button>
              <button 
                onClick={() => setReloadKey((k) => k + 1)}
                className="hidden sm:flex h-8 items-center justify-center px-3 rounded-md border border-gray-200 bg-white text-[11px] font-bold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Refresh
              </button>
            </div>
          </div>

          {/* Filter Dropdown */}
          {showFilters && (
            <div className="absolute right-0 top-[110px] lg:top-[60px] z-40 bg-white border border-gray-200 shadow-xl rounded-xl p-4 w-72 max-w-[calc(100vw-2rem)] mr-4 lg:mr-6 animate-in slide-in-from-top-2">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-gray-900 border-l-2 border-yellow-400 pl-2">Advanced Filters</h3>
                <button onClick={() => setShowFilters(false)} className="text-gray-400 hover:text-gray-800"><X size={16}/></button>
              </div>
              
              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1">Status</label>
                  <select 
                    value={draftFilters.status} 
                    onChange={e => setDraftFilters({...draftFilters, status: e.target.value})}
                    className="w-full h-8 border border-gray-200 rounded-md bg-gray-50 px-2 text-xs outline-none focus:border-yellow-400 font-medium"
                  >
                    <option value="">All Statuses</option>
                    <option value="pending">Pending</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="on_trip">On Trip</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1">Transport Type</label>
                  <select 
                    value={draftFilters.transportType} 
                    onChange={e => setDraftFilters({...draftFilters, transportType: e.target.value})}
                    className="w-full h-8 border border-gray-200 rounded-md bg-gray-50 px-2 text-xs outline-none focus:border-yellow-400 font-medium"
                  >
                    <option value="">All Types</option>
                    <option value="bike">Bike</option>
                    <option value="van">Van</option>
                    <option value="truck">Truck</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1">Payment Type</label>
                  <select 
                    value={draftFilters.paymentType} 
                    onChange={e => setDraftFilters({...draftFilters, paymentType: e.target.value})}
                    className="w-full h-8 border border-gray-200 rounded-md bg-gray-50 px-2 text-xs outline-none focus:border-yellow-400 font-medium"
                  >
                    <option value="">All Methods</option>
                    <option value="cash">Cash</option>
                    <option value="online">Online</option>
                    <option value="wallet">Wallet</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1">Driver Assignment</label>
                  <div className="flex bg-gray-50 p-1 rounded-md border border-gray-200">
                    <button onClick={() => setDraftFilters({...draftFilters, driverAssigned: ''})} className={`flex-1 py-1 text-[11px] font-bold rounded ${draftFilters.driverAssigned === '' ? 'bg-white shadow-sm text-gray-900 border border-gray-100' : 'text-gray-500'}`}>All</button>
                    <button onClick={() => setDraftFilters({...draftFilters, driverAssigned: 'assigned'})} className={`flex-1 py-1 text-[11px] font-bold rounded ${draftFilters.driverAssigned === 'assigned' ? 'bg-white shadow-sm text-gray-900 border border-gray-100' : 'text-gray-500'}`}>Assigned</button>
                    <button onClick={() => setDraftFilters({...draftFilters, driverAssigned: 'unassigned'})} className={`flex-1 py-1 text-[11px] font-bold rounded ${draftFilters.driverAssigned === 'unassigned' ? 'bg-white shadow-sm text-gray-900 border border-gray-100' : 'text-gray-500'}`}>Unassigned</button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 mb-1">Date From</label>
                    <input type="date" value={draftFilters.dateFrom} onChange={e => setDraftFilters({...draftFilters, dateFrom: e.target.value})} className="w-full h-8 border border-gray-200 rounded-md bg-gray-50 px-2 text-[10px] outline-none focus:border-yellow-400 font-medium" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 mb-1">Date To</label>
                    <input type="date" value={draftFilters.dateTo} onChange={e => setDraftFilters({...draftFilters, dateTo: e.target.value})} className="w-full h-8 border border-gray-200 rounded-md bg-gray-50 px-2 text-[10px] outline-none focus:border-yellow-400 font-medium" />
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2">
                <button onClick={resetFilters} className="flex-1 py-1 bg-gray-100 text-gray-700 rounded text-[11px] font-bold hover:bg-gray-200 transition-colors">Clear Filters</button>
                <button onClick={applyFilters} className="flex-1 py-1 bg-black text-white rounded text-[11px] font-bold hover:bg-gray-900 transition-colors shadow-sm">Apply Filters</button>
              </div>
            </div>
          )}

          {/* Table Container */}
          <div className="overflow-x-auto min-h-[400px]">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead className="sticky top-0 z-10 bg-white">
                <tr className="bg-gray-50/80 border-b border-gray-100">
                  {['Request ID', 'Date', 'User Name', 'Driver Name', 'Transport Type', 'Trip Status', 'Payment Option', 'Actions'].map((heading, i) => (
                    <th key={heading} className={`px-4 py-2.5 text-[11px] font-bold text-gray-600 tracking-wide ${i === 7 ? 'text-right pr-6' : ''}`}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="py-24 text-center">
                      <LoaderCircle className="animate-spin text-yellow-400 mx-auto" size={32} />
                      <p className="mt-3 text-xs font-bold text-gray-400 uppercase tracking-widest">Loading Deliveries...</p>
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={8} className="py-24 text-center">
                      <div className="bg-red-50 text-red-500 p-4 rounded-lg inline-block border border-red-100">
                        <XCircle size={24} className="mx-auto mb-2" />
                        <p className="text-sm font-bold">{error}</p>
                        <button onClick={() => window.location.reload()} className="mt-3 px-4 py-1.5 bg-red-100 text-red-700 rounded text-xs font-bold hover:bg-red-200">
                          Retry
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-24 text-center">
                      <div className="mx-auto flex flex-col items-center justify-center opacity-50">
                        <Truck size={48} className="text-gray-300 mb-3" />
                        <p className="text-sm font-bold text-gray-500">No delivery requests found</p>
                        <p className="text-xs text-gray-400 font-medium mt-1">Try adjusting your filters or search term.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id || row.requestId || Math.random()} className="hover:bg-yellow-50/30 transition-colors group cursor-pointer" onClick={() => setSelectedDelivery(row)}>
                      <td className="px-4 py-2 text-[13px] font-bold text-gray-900 font-mono">{row.requestId || '-'}</td>
                      <td className="px-4 py-2 text-[12px] font-medium text-gray-600">{formatDate(row.date)}</td>
                      <td className="px-4 py-2 text-[13px] font-bold text-gray-800">{row.userName || '-'}</td>
                      <td className="px-4 py-2 text-[13px] font-medium text-gray-700">{row.driverName || '--'}</td>
                      <td className="px-4 py-2 text-[13px] font-bold text-gray-700 capitalize">{String(row.transportType || '').toLowerCase()}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded capitalize tracking-wide ${STATUS_STYLES[row.tripStatus] || 'bg-gray-100 text-gray-600 border border-gray-200'}`}>
                          {row.tripStatus ? String(row.tripStatus).replace('_', ' ').toLowerCase() : 'Unknown'}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded capitalize tracking-wide ${PAYMENT_STYLES[row.paymentOption] || 'bg-gray-100 text-gray-600 border border-gray-200'}`}>
                          {row.paymentOption ? String(row.paymentOption).toLowerCase() : 'Cash'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <ActionMenu
                          row={row}
                          onViewDetails={() => setSelectedDelivery(row)}
                          onPrintInvoice={() => handlePrintInvoice(row)}
                          onProofPhotos={() => setProofDelivery(row)}
                          onPaymentDetails={() => setPaymentDelivery(row)}
                          onCancel={() => cancelDelivery(row)}
                          onTrack={() => navigate('/admin/ongoing')}
                          onCustomer={() => navigate(`/admin/users/${row.userId}`)}
                          onDriver={() => navigate(`/admin/drivers/${row.driverId}`)}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {!isLoading && rows.length > 0 && (
            <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/50 flex flex-col sm:flex-row items-center justify-between gap-3">
              <span className="text-xs font-medium text-gray-500">
                Showing <span className="font-bold text-gray-900">{(page - 1) * (Number(pageSize) || 10) + 1}–{(page - 1) * (Number(pageSize) || 10) + rows.length}</span> of <span className="font-bold text-gray-900">{listTotal}</span> entries
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 text-xs font-bold text-gray-600 bg-white border border-gray-200 rounded hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="px-2 text-xs font-semibold text-gray-500">Page {page} of {totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 text-xs font-bold text-white bg-black rounded hover:bg-gray-900 transition-colors shadow-sm disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <DeliveryDetailsDrawer
        delivery={selectedDelivery}
        onClose={() => setSelectedDelivery(null)}
      />
      <ProofPhotosDrawer delivery={proofDelivery} onClose={() => setProofDelivery(null)} />
      <PaymentDetailsModal delivery={paymentDelivery} onClose={() => setPaymentDelivery(null)} />
    </div>
  );
};

export default Deliveries;
