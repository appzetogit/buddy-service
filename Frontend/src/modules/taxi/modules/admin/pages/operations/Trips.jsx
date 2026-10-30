import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Filter,
  MoreVertical,
  Search,
  Loader2,
  ChevronRight,
  X,
  Eye,
  UserPlus,
  MapPin,
  XCircle,
  FileText,
  Trash2,
  Calendar,
  Phone,
  Mail,
  Navigation,
  Clock,
  CheckCircle2,
  AlertCircle,
  Car,
  Package,
  Compass,
  ArrowRight,
  User,
  DollarSign,
  Star,
  Copy,
  ExternalLink,
  ShieldCheck,
  CreditCard,
  Truck,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { adminService } from '../../services/adminService';
import { useNavigate } from '@taxi/shared/router';
import toast from 'react-hot-toast';

const STATUS_STYLES = {
  CANCELLED: 'bg-red-100 text-red-700 border-red-200',
  COMPLETED: 'bg-green-100 text-green-700 border-green-200',
  UPCOMING: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  SEARCHING: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  ONGOING: 'bg-blue-100 text-blue-700 border-blue-200',
  ON_TRIP: 'bg-blue-100 text-blue-700 border-blue-200',
  ACCEPTED: 'bg-cyan-100 text-cyan-800 border-cyan-200',
};

const PAYMENT_STYLES = {
  CASH: 'bg-gray-100 text-gray-800 border-gray-200',
  CARD: 'bg-gray-100 text-gray-800 border-gray-200',
  WALLET: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ONLINE: 'bg-blue-50 text-blue-700 border-blue-200',
  UPI: 'bg-purple-50 text-purple-700 border-purple-200',
};

const CATEGORY_STYLES = {
  outstation: 'bg-purple-100 text-purple-800 border-purple-200',
  parcel: 'bg-amber-100 text-amber-800 border-amber-200',
  ride: 'bg-blue-100 text-blue-800 border-blue-200',
};

const TAB_SET = ['All', 'Completed', 'Cancelled', 'Upcoming', 'On Trip'];

const SERVICE_CATEGORIES = [
  { id: 'all', label: 'All Bookings', icon: Car },
  { id: 'ride', label: 'City Rides', icon: Car },
  { id: 'outstation', label: 'Outstation Trips', icon: Compass },
  { id: 'parcel', label: 'Deliveries', icon: Package },
];

const formatDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};

const normalizeTab = (tab) => {
  if (tab === 'On Trip') return 'ongoing';
  return tab.toLowerCase();
};

const normalizeRow = (row = {}) => {
  const isIntercity = row.serviceType === 'intercity' || row.serviceType === 'outstation' || row.trip_category?.category === 'outstation';
  const isParcel = row.serviceType === 'parcel';

  let prefix = 'REQ_';
  if (isParcel) prefix = 'DEL_';
  else if (isIntercity) prefix = 'INT_';
  const fallbackReqId = `${prefix}${String(row._id || '').slice(-12).toUpperCase()}`;

  return {
    ...row,
    id: String(row._id || row.id || row.requestId || Math.random()),
    requestId: row.requestId || row.request_id || fallbackReqId,
    date: row.date || row.createdAt || row.trip_date || row.updatedAt,
    serviceCategory: isParcel ? 'parcel' : (isIntercity ? 'outstation' : 'ride'),
    serviceLabel: isParcel ? 'Parcel Delivery' : (isIntercity ? 'Outstation Trip' : 'City Ride'),
    userName: row.userName || row.user?.name || row.parcel?.senderName || '--',
    userPhone: row.userPhone || row.user?.phone || row.parcel?.senderMobile || '',
    userEmail: row.userEmail || row.user?.email || '',
    driverName: row.driverName || row.driver?.name || 'Unassigned',
    driverPhone: row.driverPhone || row.driver?.phone || '',
    driverAssigned: !!(row.driverId || (row.driverName && row.driverName !== 'Unassigned' && row.driverName !== '--')),
    transportType: row.transportType || (isParcel ? 'Parcel' : (isIntercity ? 'Outstation' : 'Taxi')),
    tripStatus: String(row.tripStatus || row.status || 'UPCOMING').toUpperCase(),
    paymentOption: String(row.paymentOption || row.paymentMethod || 'CASH').toUpperCase(),
    paymentDetail: row.paymentDetail || '',
    paymentReference: row.paymentReference || '',
    fare: Number(row.fare || 0),
    baseFare: Number(row.baseFare || 0),
    pickupAddress: row.pickupAddress || row.pickupLabel || '',
    dropAddress: row.dropAddress || row.dropLabel || '',
    routeLabel: row.routeLabel || (isIntercity && row.intercity ? [row.intercity.fromCity, row.intercity.toCity].filter(Boolean).join(' → ') : ''),
  };
};

const TripDetailsModal = ({ trip, onClose, onTrack }) => {
  const [activeSubTab, setActiveSubTab] = useState('overview');
  if (!trip) return null;

  const isIntercity = trip.serviceCategory === 'outstation' || trip.serviceType === 'intercity' || trip.serviceType === 'outstation';
  const isParcel = trip.serviceCategory === 'parcel' || trip.serviceType === 'parcel';
  const intercity = trip.intercity || {};
  const parcel = trip.parcel || {};
  const isOngoing = trip.tripStatus === 'ONGOING' || trip.tripStatus === 'ACCEPTED';

  const copyToClipboard = (text, label) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    toast.success(`${label} copied!`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 bg-gray-50/70">
          <div className="flex items-center gap-3">
            <span className="font-mono text-base font-black text-gray-950 flex items-center gap-1.5">
              {trip.requestId}
              <button
                onClick={() => copyToClipboard(trip.requestId, 'Request ID')}
                className="text-gray-400 hover:text-gray-700 p-0.5 rounded transition-colors"
                title="Copy ID"
              >
                <Copy size={13} />
              </button>
            </span>
            <span className={`inline-flex items-center px-2.5 py-0.5 text-[11px] font-bold rounded-full border ${CATEGORY_STYLES[trip.serviceCategory] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
              {trip.serviceLabel}
            </span>
            <span className={`inline-flex items-center px-2.5 py-0.5 text-[11px] font-bold rounded-full border ${STATUS_STYLES[trip.tripStatus] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
              {trip.tripStatus}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-900 hover:bg-gray-200/60 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Sub-tabs inside Modal */}
        <div className="flex border-b border-gray-100 px-6 bg-white gap-6 text-xs font-bold">
          <button
            onClick={() => setActiveSubTab('overview')}
            className={`py-3 relative transition-colors ${activeSubTab === 'overview' ? 'text-black border-b-2 border-black font-extrabold' : 'text-gray-400 hover:text-gray-700'}`}
          >
            Trip Overview & Route
          </button>
          <button
            onClick={() => setActiveSubTab('financials')}
            className={`py-3 relative transition-colors ${activeSubTab === 'financials' ? 'text-black border-b-2 border-black font-extrabold' : 'text-gray-400 hover:text-gray-700'}`}
          >
            Fare & Pricing Snapshot
          </button>
          <button
            onClick={() => setActiveSubTab('history')}
            className={`py-3 relative transition-colors ${activeSubTab === 'history' ? 'text-black border-b-2 border-black font-extrabold' : 'text-gray-400 hover:text-gray-700'}`}
          >
            Status History & Timeline
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">

          {activeSubTab === 'overview' && (
            <div className="space-y-5">
              
              {/* Outstation Specific Banner */}
              {isIntercity && (
                <div className="bg-purple-50/70 border border-purple-100 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-black uppercase tracking-wider text-purple-700">Outstation Route</span>
                    <span className="text-xs font-bold text-purple-900 capitalize px-2 py-0.5 bg-purple-100 rounded-md">
                      {intercity.tripType === 'round_trip' ? 'Round Trip' : 'One Way'}
                    </span>
                  </div>
                  <div className="text-sm font-bold text-gray-900 flex items-center gap-2">
                    <span>{intercity.fromCity || trip.pickupAddress}</span>
                    <ArrowRight size={14} className="text-purple-600 shrink-0" />
                    <span>{intercity.toCity || trip.dropAddress}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-purple-100 text-xs">
                    <div>
                      <span className="text-gray-400 text-[10px] block font-bold uppercase">Travel Date</span>
                      <span className="font-semibold text-gray-800">{intercity.travelDate ? formatDate(intercity.travelDate) : '--'}</span>
                    </div>
                    {intercity.returnDate ? (
                      <div>
                        <span className="text-gray-400 text-[10px] block font-bold uppercase">Return Date</span>
                        <span className="font-semibold text-gray-800">{formatDate(intercity.returnDate)}</span>
                      </div>
                    ) : null}
                    <div>
                      <span className="text-gray-400 text-[10px] block font-bold uppercase">Distance</span>
                      <span className="font-semibold text-gray-800">{intercity.distance ? `${Number(intercity.distance).toFixed(1)} km` : '--'}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Parcel Specific Banner */}
              {isParcel && (
                <div className="bg-amber-50/70 border border-amber-100 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black uppercase tracking-wider text-amber-800">Parcel Delivery Details</span>
                    <span className="text-xs font-bold text-amber-900 capitalize px-2 py-0.5 bg-amber-100 rounded-md">
                      {parcel.category || 'Package'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className="text-gray-400 text-[10px] block font-bold uppercase">Sender</span>
                      <p className="font-bold text-gray-900">{parcel.senderName || trip.userName}</p>
                      <p className="text-gray-500">{parcel.senderMobile || trip.userPhone || '--'}</p>
                    </div>
                    <div>
                      <span className="text-gray-400 text-[10px] block font-bold uppercase">Receiver</span>
                      <p className="font-bold text-gray-900">{parcel.receiverName || '--'}</p>
                      <p className="text-gray-500">{parcel.receiverMobile || '--'}</p>
                    </div>
                  </div>
                  {parcel.description ? (
                    <p className="text-xs text-gray-600 bg-white/80 p-2.5 rounded-lg border border-amber-100">
                      <span className="font-bold text-gray-800">Note: </span>{parcel.description}
                    </p>
                  ) : null}
                </div>
              )}

              {/* Route Snapshot */}
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                <p className="text-[11px] font-black uppercase tracking-wider text-gray-400 mb-3">Pickup & Drop Route</p>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-3 h-3 rounded-full bg-green-500 mt-1 shrink-0 ring-4 ring-green-100" />
                    <div className="flex-1">
                      <p className="text-[10px] font-bold text-green-700 uppercase tracking-wider">Pickup Location</p>
                      <p className="text-xs font-bold text-gray-900 mt-0.5">{trip.pickupAddress || '--'}</p>
                    </div>
                  </div>
                  <div className="ml-1.5 w-0.5 h-4 bg-gray-200 border-l border-dashed border-gray-300" />
                  <div className="flex items-start gap-3">
                    <div className="w-3 h-3 rounded-full bg-red-500 mt-1 shrink-0 ring-4 ring-red-100" />
                    <div className="flex-1">
                      <p className="text-[10px] font-bold text-red-700 uppercase tracking-wider">Drop Location</p>
                      <p className="text-xs font-bold text-gray-900 mt-0.5">{trip.dropAddress || '--'}</p>
                    </div>
                  </div>
                </div>

                {(trip.estimatedDistanceMeters || trip.estimatedDurationMinutes) ? (
                  <div className="flex items-center gap-4 mt-4 pt-3 border-t border-gray-200/60 text-xs font-bold text-gray-600">
                    {trip.estimatedDistanceMeters ? (
                      <span className="flex items-center gap-1">
                        <Navigation size={12} className="text-gray-400" />
                        {(trip.estimatedDistanceMeters / 1000).toFixed(1)} km
                      </span>
                    ) : null}
                    {trip.estimatedDurationMinutes ? (
                      <span className="flex items-center gap-1">
                        <Clock size={12} className="text-gray-400" />
                        {Math.round(trip.estimatedDurationMinutes)} mins
                      </span>
                    ) : null}
                    {trip.otp ? (
                      <span className="ml-auto font-mono text-[11px] bg-yellow-100 text-yellow-900 px-2 py-0.5 rounded font-black">
                        Start OTP: {trip.otp}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* Customer & Driver Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Customer</span>
                    <User size={14} className="text-gray-400" />
                  </div>
                  <p className="text-sm font-bold text-gray-900">{trip.userName}</p>
                  {trip.userPhone ? (
                    <p className="text-xs font-medium text-gray-600 flex items-center gap-1">
                      <Phone size={11} className="text-gray-400" /> {trip.userPhone}
                    </p>
                  ) : null}
                  {trip.userEmail ? (
                    <p className="text-xs font-medium text-gray-600 flex items-center gap-1">
                      <Mail size={11} className="text-gray-400" /> {trip.userEmail}
                    </p>
                  ) : null}
                </div>

                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Driver</span>
                    <Truck size={14} className="text-gray-400" />
                  </div>
                  <p className="text-sm font-bold text-gray-900">
                    {trip.driverName !== '--' ? trip.driverName : <span className="text-gray-400 italic">Unassigned</span>}
                  </p>
                  {trip.driverPhone ? (
                    <p className="text-xs font-medium text-gray-600 flex items-center gap-1">
                      <Phone size={11} className="text-gray-400" /> {trip.driverPhone}
                    </p>
                  ) : null}
                  <div className="flex items-center gap-2 pt-1 text-xs">
                    <span className="bg-white px-2 py-0.5 rounded border border-gray-200 text-gray-700 font-bold capitalize">
                      {trip.transportType || 'Taxi'}
                    </span>
                    {trip.vehicleNumber ? (
                      <span className="font-mono text-gray-600 font-bold uppercase">{trip.vehicleNumber}</span>
                    ) : null}
                  </div>
                </div>
              </div>

            </div>
          )}

          {activeSubTab === 'financials' && (
            <div className="space-y-5">
              <div className="bg-gray-900 text-white rounded-xl p-5 flex items-center justify-between shadow-sm">
                <div>
                  <p className="text-xs uppercase font-bold text-gray-400 tracking-wider">Total Ride Fare</p>
                  <p className="text-3xl font-black mt-1">₹{trip.fare}</p>
                </div>
                <div className="text-right">
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${PAYMENT_STYLES[trip.paymentOption] || 'bg-gray-800 text-white'}`}>
                    {trip.paymentOption}
                  </span>
                  {trip.paymentDetail ? (
                    <p className="text-[11px] text-gray-300 mt-1 max-w-[200px] truncate">{trip.paymentDetail}</p>
                  ) : null}
                  {trip.paymentReference ? (
                    <p className="text-[10px] font-mono text-gray-400 mt-0.5">Ref: {trip.paymentReference}</p>
                  ) : null}
                </div>
              </div>

              {/* Pricing Snapshot breakdown */}
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                <p className="text-[11px] font-black uppercase tracking-wider text-gray-400 mb-3">Fare Breakdown</p>
                <div className="space-y-2.5 text-xs">
                  <div className="flex justify-between py-1 border-b border-gray-200/50">
                    <span className="text-gray-600 font-medium">Base Fare</span>
                    <span className="font-bold text-gray-900">₹{trip.baseFare || trip.fare}</span>
                  </div>
                  {trip.waitingCharge > 0 ? (
                    <div className="flex justify-between py-1 border-b border-gray-200/50">
                      <span className="text-gray-600 font-medium">Waiting Charge ({trip.waitingMinutes || 0} mins)</span>
                      <span className="font-bold text-gray-900">₹{trip.waitingCharge}</span>
                    </div>
                  ) : null}
                  {trip.commissionAmount > 0 ? (
                    <div className="flex justify-between py-1 border-b border-gray-200/50">
                      <span className="text-gray-600 font-medium">Admin Commission</span>
                      <span className="font-bold text-emerald-700">₹{trip.commissionAmount}</span>
                    </div>
                  ) : null}
                  {trip.driverEarnings > 0 ? (
                    <div className="flex justify-between py-1 border-b border-gray-200/50">
                      <span className="text-gray-600 font-medium">Driver Net Earnings</span>
                      <span className="font-bold text-gray-900">₹{trip.driverEarnings}</span>
                    </div>
                  ) : null}
                  {trip.promo?.discount_amount ? (
                    <div className="flex justify-between py-1 border-b border-gray-200/50 text-emerald-600 font-bold">
                      <span>Promo Discount ({trip.promo.code})</span>
                      <span>-₹{trip.promo.discount_amount}</span>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Outstation Tariff Pricing if available */}
              {intercity.pricing && (
                <div className="bg-purple-50/70 rounded-xl p-4 border border-purple-100">
                  <p className="text-[11px] font-black uppercase tracking-wider text-purple-700 mb-2">Outstation Rate Calculator</p>
                  <div className="grid grid-cols-2 gap-y-2 text-xs">
                    <div><span className="text-gray-500">Days: </span><span className="font-bold">{intercity.pricing.days || 1}</span></div>
                    <div><span className="text-gray-500">Rate / Km: </span><span className="font-bold">₹{intercity.pricing.ratePerKm || 0}</span></div>
                    <div><span className="text-gray-500">Chargeable Km: </span><span className="font-bold">{intercity.pricing.chargeableKm || 0} km</span></div>
                    <div><span className="text-gray-500">Driver Allowance: </span><span className="font-bold">₹{intercity.pricing.driverAllowance || 0}</span></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeSubTab === 'history' && (
            <div className="space-y-4">
              <p className="text-[11px] font-black uppercase tracking-wider text-gray-400 mb-2">Lifecycle Status Timeline</p>
              
              <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-200">
                
                {/* Booked / Created */}
                <div className="relative">
                  <div className="absolute -left-6 top-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white ring-2 ring-emerald-100" />
                  <p className="text-xs font-bold text-gray-900">Booking Requested</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{formatDate(trip.createdAt || trip.date)}</p>
                </div>

                {/* Scheduled if scheduled */}
                {trip.scheduledAt ? (
                  <div className="relative">
                    <div className="absolute -left-6 top-1 w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-white ring-2 ring-blue-100" />
                    <p className="text-xs font-bold text-gray-900">Scheduled Time</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">{formatDate(trip.scheduledAt)}</p>
                  </div>
                ) : null}

                {/* Driver Accepted */}
                <div className="relative">
                  <div className={`absolute -left-6 top-1 w-3.5 h-3.5 rounded-full border-2 border-white ring-2 ${trip.acceptedAt ? 'bg-emerald-500 ring-emerald-100' : 'bg-gray-300 ring-gray-100'}`} />
                  <p className="text-xs font-bold text-gray-900">Driver Accepted</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {trip.acceptedAt ? formatDate(trip.acceptedAt) : (trip.tripStatus === 'CANCELLED' ? 'Cancelled before driver acceptance' : 'Pending driver acceptance')}
                  </p>
                </div>

                {/* Arrived at pickup */}
                {trip.arrivedAt ? (
                  <div className="relative">
                    <div className="absolute -left-6 top-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white ring-2 ring-emerald-100" />
                    <p className="text-xs font-bold text-gray-900">Driver Arrived at Pickup</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">{formatDate(trip.arrivedAt)}</p>
                  </div>
                ) : null}

                {/* Started */}
                {trip.startedAt ? (
                  <div className="relative">
                    <div className="absolute -left-6 top-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white ring-2 ring-emerald-100" />
                    <p className="text-xs font-bold text-gray-900">Trip In Progress</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">{formatDate(trip.startedAt)}</p>
                  </div>
                ) : null}

                {/* Completed */}
                {trip.completedAt ? (
                  <div className="relative">
                    <div className="absolute -left-6 top-1 w-3.5 h-3.5 rounded-full bg-green-600 border-2 border-white ring-2 ring-green-200" />
                    <p className="text-xs font-black text-green-700">Trip Completed</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">{formatDate(trip.completedAt)}</p>
                  </div>
                ) : null}

                {/* Cancelled */}
                {trip.cancelledAt ? (
                  <div className="relative">
                    <div className="absolute -left-6 top-1 w-3.5 h-3.5 rounded-full bg-red-500 border-2 border-white ring-2 ring-red-100" />
                    <p className="text-xs font-black text-red-600">Trip Cancelled</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">{formatDate(trip.cancelledAt)}</p>
                    {trip.cancelledBy ? (
                      <p className="text-[11px] text-gray-600 mt-0.5">By: <span className="font-bold capitalize">{trip.cancelledBy}</span></p>
                    ) : null}
                    {trip.cancelReason ? (
                      <p className="text-[11px] text-red-500 mt-0.5 font-medium">Reason: {trip.cancelReason}</p>
                    ) : null}
                  </div>
                ) : null}

              </div>

              {trip.feedback?.rating ? (
                <div className="mt-5 p-4 rounded-xl bg-amber-50/70 border border-amber-100">
                  <div className="flex items-center gap-2">
                    <div className="flex text-amber-500">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} size={14} fill={i < trip.feedback.rating ? 'currentColor' : 'none'} />
                      ))}
                    </div>
                    <span className="text-xs font-bold text-gray-800">{trip.feedback.rating} / 5</span>
                  </div>
                  {trip.feedback.comment ? (
                    <p className="text-xs text-gray-700 mt-1.5 italic">"{trip.feedback.comment}"</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-6 py-4 bg-gray-50/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isOngoing && onTrack ? (
              <button
                onClick={() => { onClose(); onTrack(trip); }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <MapPin size={13} /> Live Track
              </button>
            ) : null}
          </div>
          <button
            onClick={onClose}
            className="px-6 py-2 bg-black text-white text-xs font-bold rounded-lg shadow-sm hover:bg-gray-900 transition-colors"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};

const handlePrintInvoice = (trip) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert("Please allow popups to print invoices.");
    return;
  }

  const formattedDate = formatDate(trip.date);

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Invoice - ${trip.requestId}</title>
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
          <h1 class="title">${trip.serviceLabel.toUpperCase()} INVOICE</h1>
          <p class="subtitle">Request ID: <span class="highlight">${trip.requestId}</span></p>
        </div>
        <table class="details">
          <tr><th>Date</th><td>${formattedDate}</td></tr>
          <tr><th>Category</th><td>${trip.serviceLabel}</td></tr>
          <tr><th>Customer</th><td>${trip.userName} (${trip.userPhone || 'N/A'})</td></tr>
          <tr><th>Driver</th><td>${trip.driverName} (${trip.driverPhone || 'N/A'})</td></tr>
          <tr><th>Pickup Address</th><td>${trip.pickupAddress || '--'}</td></tr>
          <tr><th>Drop Address</th><td>${trip.dropAddress || '--'}</td></tr>
          <tr><th>Vehicle / Transport</th><td style="text-transform: capitalize;">${String(trip.transportType).toLowerCase()} ${trip.vehicleNumber ? `(${trip.vehicleNumber})` : ''}</td></tr>
          <tr><th>Fare</th><td style="font-weight: 800; font-size: 18px;">₹${trip.fare}</td></tr>
          <tr><th>Payment Method</th><td style="text-transform: capitalize;">${String(trip.paymentOption).toLowerCase()}${trip.paymentDetail ? ` - ${trip.paymentDetail}` : ''}${trip.paymentReference ? ` (Ref. ${trip.paymentReference})` : ''}</td></tr>
          <tr><th>Trip Status</th><td style="text-transform: capitalize; font-weight: 700;">${String(trip.tripStatus).toLowerCase()}</td></tr>
        </table>
        <div class="footer">
          Thank you for choosing Buddy Service.<br/>
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

const ActionMenu = ({ row, onViewDetails, onPrintInvoice, onCancel, onDelete, onTrack, busy }) => {
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

  const isCompleted = row.tripStatus === 'COMPLETED';
  const isCancelled = row.tripStatus === 'CANCELLED';
  const isOngoing = row.tripStatus === 'ONGOING' || row.tripStatus === 'ACCEPTED';

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-1.5 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
      >
        <MoreVertical size={18} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-1.5 z-50 overflow-hidden">
          <button
            onClick={() => { setIsOpen(false); onViewDetails(); }}
            className="w-full text-left px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-yellow-50 hover:text-yellow-900 flex items-center gap-2"
          >
            <Eye size={14} /> View Details
          </button>
          <button
            disabled={!isOngoing}
            onClick={() => { setIsOpen(false); onTrack(); }}
            className="w-full text-left px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-yellow-50 hover:text-yellow-900 flex items-center gap-2 disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-gray-700"
          >
            <MapPin size={14} /> Track Trip
          </button>
          <button
            disabled={isCompleted || isCancelled || busy}
            onClick={() => { setIsOpen(false); onCancel(); }}
            className="w-full text-left px-4 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 flex items-center gap-2 disabled:opacity-40 disabled:hover:bg-white"
          >
            <XCircle size={14} /> Cancel Trip
          </button>
          <button
            disabled={!(isCompleted || isCancelled) || busy}
            onClick={() => { setIsOpen(false); onDelete(); }}
            title={isCompleted || isCancelled ? 'Remove this trip from the list' : 'Cancel the trip first'}
            className="w-full text-left px-4 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 flex items-center gap-2 disabled:opacity-40 disabled:hover:bg-white"
          >
            <Trash2 size={14} /> Delete Trip
          </button>
          <button
            onClick={() => { setIsOpen(false); onPrintInvoice(); }}
            className="w-full text-left px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-yellow-50 hover:text-yellow-900 flex items-center gap-2 border-t border-gray-50 mt-1 pt-2"
          >
            <FileText size={14} /> Print Invoice
          </button>
        </div>
      )}
    </div>
  );
};

const Trips = () => {
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [activeTab, setActiveTab] = useState('All');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({
    current_page: 1,
    last_page: 1,
    total: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const navigate = useNavigate();

  // Filter State
  const [showFilters, setShowFilters] = useState(false);
  const [activeFilters, setActiveFilters] = useState({
    serviceType: '',
    status: '',
    transportType: '',
    paymentOption: '',
    driverAssigned: '',
    dateFrom: '',
    dateTo: '',
  });
  const [draftFilters, setDraftFilters] = useState({
    serviceType: '',
    status: '',
    transportType: '',
    paymentOption: '',
    driverAssigned: '',
    dateFrom: '',
    dateTo: '',
  });

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearch(searchInput);
    }, 350);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [searchInput]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const response = await adminService.getRideRequests({
        page,
        limit,
        tab: normalizeTab(activeTab),
        serviceType: selectedCategory !== 'all' ? selectedCategory : (activeFilters.serviceType || ''),
        status: activeFilters.status || '',
        transportType: activeFilters.transportType || '',
        paymentOption: activeFilters.paymentOption || '',
        driverAssigned: activeFilters.driverAssigned || '',
        dateFrom: activeFilters.dateFrom || '',
        dateTo: activeFilters.dateTo || '',
        search,
      });

      const payload = response?.data?.data || response?.data || response || {};
      const results = Array.isArray(payload?.results) ? payload.results : [];
      const paginator = payload?.paginator || {
        current_page: page,
        last_page: 1,
        total: results.length,
      };

      setRows(results.map(normalizeRow));
      setPagination({
        current_page: Number(paginator.current_page || page || 1),
        last_page: Math.max(1, Number(paginator.last_page || 1)),
        total: Math.max(0, Number(paginator.total || results.length || 0)),
      });
    } catch (err) {
      setRows([]);
      setPagination({
        current_page: 1,
        last_page: 1,
        total: 0,
      });
      setError(err?.message || 'Failed to load trip requests');
    } finally {
      setLoading(false);
    }
  }, [activeTab, selectedCategory, limit, page, search, activeFilters]);

  useEffect(() => {
    setPage(1);
  }, [activeTab, selectedCategory, limit, search, activeFilters]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const rideIdOf = (row) => row.id || row._id || row.rideId;

  const cancelTrip = async (row) => {
    const reason = window.prompt(`Cancel trip ${row.requestId}? Optional reason for the rider and driver:`, '');
    if (reason === null) return;
    setBusyId(rideIdOf(row));
    try {
      await adminService.cancelRideRequest(rideIdOf(row), reason);
      toast.success(`Trip ${row.requestId} cancelled`);
      await loadRows();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not cancel the trip');
    } finally {
      setBusyId('');
    }
  };

  const deleteTrip = async (row) => {
    if (!window.confirm(`Delete trip ${row.requestId} from the list? Earnings and reports keep it.`)) return;
    setBusyId(rideIdOf(row));
    try {
      await adminService.deleteRideRequest(rideIdOf(row));
      toast.success(`Trip ${row.requestId} deleted`);
      await loadRows();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not delete the trip');
    } finally {
      setBusyId('');
    }
  };

  const trackTrip = (row) => navigate(`/admin/ongoing?ride=${encodeURIComponent(rideIdOf(row))}`);

  const applyFilters = () => {
    setActiveFilters(draftFilters);
    setShowFilters(false);
  };

  const resetFilters = () => {
    const emptyFilters = {
      serviceType: '',
      status: '',
      transportType: '',
      paymentOption: '',
      driverAssigned: '',
      dateFrom: '',
      dateTo: '',
    };
    setDraftFilters(emptyFilters);
    setActiveFilters(emptyFilters);
    setShowFilters(false);
  };

  const activeFilterCount = Object.values(activeFilters).filter(Boolean).length;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <div className="px-4 py-2 md:px-6 md:pt-2 md:pb-6 space-y-4 max-w-full">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-white rounded-xl shadow-sm border border-gray-100">
          <div>
            <h1 className="text-xl font-black tracking-tight text-gray-900">Trip Requests</h1>
            <p className="text-xs text-gray-400 font-medium">Manage and track all taxi, outstation, and parcel bookings</p>
          </div>
          <div className="hidden md:flex items-center gap-2 text-xs font-semibold text-gray-400">
            <span>Operations</span>
            <ChevronRight size={14} className="text-gray-300" />
            <span className="text-gray-700">Trip Requests</span>
          </div>
        </div>

        {/* Booking Category Selector Pills */}
        <div className="flex flex-wrap items-center gap-2 bg-white p-2 rounded-xl border border-gray-100 shadow-sm">
          {SERVICE_CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isSelected = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all ${
                  isSelected
                    ? 'bg-yellow-400 text-black shadow-sm font-black'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Icon size={14} className={isSelected ? 'text-black' : 'text-gray-400'} />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {/* Main Content Box */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm flex flex-col relative">

          {/* Controls Bar */}
          <div className="flex flex-col gap-4 border-b border-gray-100 px-4 py-3 lg:flex-row lg:items-center">

            <div className="flex items-center gap-2 text-xs font-medium text-gray-500 shrink-0">
              <span>Show</span>
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="h-8 w-16 border border-gray-200 rounded-lg bg-gray-50 px-2 outline-none focus:ring-1 focus:ring-yellow-400 focus:border-yellow-400 text-gray-700 text-xs font-bold"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </div>

            {/* Status Tabs */}
            <div className="flex flex-1 items-center gap-1 overflow-x-auto no-scrollbar border-b border-gray-100 lg:border-b-0 pb-1 lg:pb-0 lg:justify-center">
              {TAB_SET.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`relative px-4 py-2 text-xs font-bold transition-colors whitespace-nowrap rounded-t-lg lg:rounded-lg ${
                    activeTab === tab ? 'text-gray-900 bg-yellow-50 lg:bg-transparent font-black' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {tab}
                  {activeTab === tab && (
                    <motion.div layoutId="trip-tab" className="absolute -bottom-1 lg:-bottom-2 left-0 right-0 h-0.5 bg-yellow-400 rounded-t-full" />
                  )}
                </button>
              ))}
            </div>

            {/* Search & Advanced Filter Toggle */}
            <div className="flex items-center gap-3 shrink-0">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search ID, rider, driver, city..."
                  className="h-8 w-full sm:w-56 rounded-md border border-gray-200 bg-gray-50 pl-8 pr-3 text-[11px] outline-none focus:bg-white focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 transition-all font-medium"
                />
              </div>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`flex h-8 items-center gap-1.5 px-3 rounded-md text-[11px] font-bold transition-colors border relative ${
                  activeFilterCount > 0 ? 'bg-yellow-400 text-black border-yellow-400 shadow-sm font-black' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}
              >
                <Filter size={13} /> Filters
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-black text-white text-[9px] rounded-full flex items-center justify-center font-bold">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Advanced Filter Modal/Panel */}
          {showFilters && (
            <div className="absolute right-0 top-[76px] lg:top-[68px] z-40 bg-white border border-gray-200 shadow-2xl rounded-2xl p-5 w-[310px] m-4 sm:m-0 sm:mr-5 animate-in slide-in-from-top-2">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-black text-gray-900 text-xs uppercase tracking-wider">Advanced Filters</h3>
                <button onClick={() => setShowFilters(false)} className="text-gray-400 hover:text-gray-900 bg-gray-50 p-1 rounded-md"><X size={14}/></button>
              </div>

              <div className="space-y-3.5 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase">Booking Type</label>
                  <select
                    value={draftFilters.serviceType}
                    onChange={e => setDraftFilters({ ...draftFilters, serviceType: e.target.value })}
                    className="w-full h-8 border border-gray-200 rounded-md bg-gray-50 px-2 text-xs outline-none focus:border-yellow-400 font-medium"
                  >
                    <option value="">All Types</option>
                    <option value="ride">City Ride</option>
                    <option value="outstation">Outstation Trip</option>
                    <option value="parcel">Parcel Delivery</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase">Trip Status</label>
                  <select
                    value={draftFilters.status}
                    onChange={e => setDraftFilters({ ...draftFilters, status: e.target.value })}
                    className="w-full h-8 border border-gray-200 rounded-md bg-gray-50 px-2 text-xs outline-none focus:border-yellow-400 font-medium"
                  >
                    <option value="">All Statuses</option>
                    <option value="searching">Upcoming / Searching</option>
                    <option value="accepted">Driver Accepted</option>
                    <option value="ongoing">On Trip / Ongoing</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase">Transport Type</label>
                  <select
                    value={draftFilters.transportType}
                    onChange={e => setDraftFilters({ ...draftFilters, transportType: e.target.value })}
                    className="w-full h-8 border border-gray-200 rounded-md bg-gray-50 px-2 text-xs outline-none focus:border-yellow-400 font-medium"
                  >
                    <option value="">All Vehicles</option>
                    <option value="car">Car / Taxi</option>
                    <option value="auto">Auto</option>
                    <option value="bike">Bike</option>
                    <option value="suv">SUV</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase">Payment Option</label>
                  <select
                    value={draftFilters.paymentOption}
                    onChange={e => setDraftFilters({ ...draftFilters, paymentOption: e.target.value })}
                    className="w-full h-8 border border-gray-200 rounded-md bg-gray-50 px-2 text-xs outline-none focus:border-yellow-400 font-medium"
                  >
                    <option value="">All Methods</option>
                    <option value="cash">Cash</option>
                    <option value="online">Online</option>
                    <option value="wallet">Wallet</option>
                    <option value="upi">UPI</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase">Driver Assignment</label>
                  <div className="flex bg-gray-50 p-1 rounded-md border border-gray-200">
                    <button
                      type="button"
                      onClick={() => setDraftFilters({ ...draftFilters, driverAssigned: '' })}
                      className={`flex-1 py-1 text-[11px] font-bold rounded ${draftFilters.driverAssigned === '' ? 'bg-white shadow-sm text-gray-900 border border-gray-100' : 'text-gray-500'}`}
                    >All</button>
                    <button
                      type="button"
                      onClick={() => setDraftFilters({ ...draftFilters, driverAssigned: 'assigned' })}
                      className={`flex-1 py-1 text-[11px] font-bold rounded ${draftFilters.driverAssigned === 'assigned' ? 'bg-white shadow-sm text-gray-900 border border-gray-100' : 'text-gray-500'}`}
                    >Assigned</button>
                    <button
                      type="button"
                      onClick={() => setDraftFilters({ ...draftFilters, driverAssigned: 'unassigned' })}
                      className={`flex-1 py-1 text-[11px] font-bold rounded ${draftFilters.driverAssigned === 'unassigned' ? 'bg-white shadow-sm text-gray-900 border border-gray-100' : 'text-gray-500'}`}
                    >Unassigned</button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase">Date From</label>
                    <input
                      type="date"
                      value={draftFilters.dateFrom}
                      onChange={e => setDraftFilters({ ...draftFilters, dateFrom: e.target.value })}
                      className="w-full h-8 border border-gray-200 rounded-md bg-gray-50 px-2 text-xs outline-none focus:border-yellow-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase">Date To</label>
                    <input
                      type="date"
                      value={draftFilters.dateTo}
                      onChange={e => setDraftFilters({ ...draftFilters, dateTo: e.target.value })}
                      className="w-full h-8 border border-gray-200 rounded-md bg-gray-50 px-2 text-xs outline-none focus:border-yellow-400"
                    />
                  </div>
                </div>

              </div>

              <div className="mt-5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={resetFilters}
                  className="flex-1 py-2 bg-gray-100 text-gray-700 rounded-lg text-xs font-bold hover:bg-gray-200 transition-colors"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={applyFilters}
                  className="flex-1 py-2 bg-black text-white rounded-lg text-xs font-black hover:bg-gray-900 transition-colors shadow-sm"
                >
                  Apply Filters
                </button>
              </div>
            </div>
          )}

          {/* Table Container */}
          <div className="overflow-x-auto min-h-[420px]">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-100">
                  {['Request ID', 'Type', 'Date & Time', 'Customer', 'Driver', 'Route / Location', 'Trip Status', 'Payment', 'Fare', 'Action'].map((heading, i) => (
                    <th key={heading} className={`px-4 py-3 text-[11px] font-black text-gray-600 tracking-wide uppercase ${i === 9 ? 'text-right pr-5' : ''}`}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="py-24 text-center">
                      <Loader2 className="animate-spin text-gray-300 mx-auto" size={32} />
                      <p className="mt-3 text-xs font-semibold text-gray-400 uppercase tracking-widest">Loading Requests...</p>
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={10} className="py-20 text-center">
                       <div className="inline-flex items-center justify-center p-3 bg-red-50 text-red-500 rounded-full mb-3">
                          <XCircle size={24} />
                       </div>
                       <p className="text-sm font-bold text-red-600">{error}</p>
                    </td>
                  </tr>
                ) : rows.length > 0 ? (
                  rows.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50/60 transition-colors group">
                      
                      {/* Request ID */}
                      <td className="px-4 py-2.5">
                        <span className="text-[12px] font-bold text-gray-950 font-mono tracking-tight">{row.requestId}</span>
                      </td>

                      {/* Type Badge */}
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded-md border ${CATEGORY_STYLES[row.serviceCategory] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                          {row.serviceCategory === 'outstation' ? 'Outstation' : (row.serviceCategory === 'parcel' ? 'Parcel' : 'City Ride')}
                        </span>
                      </td>

                      {/* Date & Time */}
                      <td className="px-4 py-2.5 text-[12px] font-medium text-gray-500">
                        {formatDate(row.date)}
                      </td>

                      {/* Customer */}
                      <td className="px-4 py-2.5">
                        <p className="text-[12px] font-bold text-gray-800 leading-tight">{row.userName}</p>
                        {row.userPhone ? <p className="text-[10px] text-gray-400 font-medium">{row.userPhone}</p> : null}
                      </td>

                      {/* Driver */}
                      <td className="px-4 py-2.5">
                        {row.driverAssigned ? (
                          <div>
                            <p className="text-[12px] font-bold text-gray-800 leading-tight">{row.driverName}</p>
                            <p className="text-[10px] text-gray-400 font-mono uppercase">{row.vehicleNumber || row.transportType}</p>
                          </div>
                        ) : (
                          <span className="text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded font-bold">Unassigned</span>
                        )}
                      </td>

                      {/* Route / Locations */}
                      <td className="px-4 py-2.5 max-w-[220px]">
                        {row.routeLabel ? (
                          <p className="text-[12px] font-bold text-purple-900 truncate" title={row.routeLabel}>
                            {row.routeLabel}
                          </p>
                        ) : (
                          <div className="text-[11px] text-gray-600 truncate max-w-[220px]" title={`${row.pickupAddress} → ${row.dropAddress}`}>
                            <span className="font-semibold text-gray-800">{row.pickupAddress ? row.pickupAddress.slice(0, 18) : '--'}</span>
                            <span className="mx-1 text-gray-400">→</span>
                            <span>{row.dropAddress ? row.dropAddress.slice(0, 18) : '--'}</span>
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded capitalize tracking-wide border ${STATUS_STYLES[row.tripStatus] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                          {row.tripStatus ? row.tripStatus.toLowerCase().replace('_', ' ') : 'Upcoming'}
                        </span>
                      </td>

                      {/* Payment */}
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded capitalize tracking-wide border ${PAYMENT_STYLES[row.paymentOption] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                          {row.paymentOption ? row.paymentOption.toLowerCase() : 'Cash'}
                        </span>
                      </td>

                      {/* Fare */}
                      <td className="px-4 py-2.5">
                        <span className="text-[13px] font-black text-gray-900 font-mono">₹{row.fare}</span>
                      </td>

                      {/* Action Menu */}
                      <td className="px-4 py-2.5 text-right pr-5">
                        <ActionMenu
                          row={row}
                          onViewDetails={() => setSelectedTrip(row)}
                          onPrintInvoice={() => handlePrintInvoice(row)}
                          onCancel={() => cancelTrip(row)}
                          onDelete={() => deleteTrip(row)}
                          onTrack={() => trackTrip(row)}
                          busy={busyId === rideIdOf(row)}
                        />
                      </td>

                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10} className="py-24 text-center">
                      <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center text-gray-300 mx-auto mb-3">
                         <Filter size={24} />
                      </div>
                      <p className="text-sm font-bold text-gray-900">No requests found</p>
                      <p className="text-xs text-gray-400 font-medium mt-1">Try adjusting your active filters, category, or search term.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex flex-col gap-3 border-t border-gray-100 px-4 py-3 text-[12px] text-gray-500 lg:flex-row lg:items-center lg:justify-between bg-gray-50/40">
            <p className="text-center lg:text-left font-medium">
              Showing page <span className="font-bold text-gray-900">{pagination.current_page}</span> of{' '}
              <span className="font-bold text-gray-900">{pagination.last_page}</span>
              {' '}for <span className="font-bold text-gray-900">{pagination.total}</span> total entries
            </p>

            <div className="flex justify-center items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={loading || pagination.current_page <= 1}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-bold text-gray-700 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-40 disabled:hover:bg-white shadow-sm transition-all"
              >
                Previous
              </button>
              <div className="min-w-[2.5rem] text-center font-bold text-gray-900 bg-gray-100 py-1.5 px-2.5 rounded-lg text-xs">
                {pagination.current_page}
              </div>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(pagination.last_page, current + 1))}
                disabled={loading || pagination.current_page >= pagination.last_page}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-bold text-gray-700 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-40 disabled:hover:bg-white shadow-sm transition-all"
              >
                Next
              </button>
            </div>
          </div>

        </div>
      </div>

      <TripDetailsModal
        trip={selectedTrip}
        onClose={() => setSelectedTrip(null)}
        onTrack={trackTrip}
      />
    </div>
  );
};

export default Trips;
