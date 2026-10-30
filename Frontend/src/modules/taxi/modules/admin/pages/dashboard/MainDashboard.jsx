import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@taxi/shared/router';
import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Car,
  CircleAlert,
  Clock,
  CreditCard,
  History,
  IndianRupee,
  Search,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
  Activity,
  ChevronRight,
  ArrowRight,
  Zap,
  TrendingUp,
  BarChart3,
  RefreshCw,
  Server,
  Database,
  Cpu,
  Mail,
  MessageSquare,
  MapPin,
  Map,
  Shield,
  FileText,
  AlertTriangle,
  Award,
  Sparkles,
  Play,
  CheckCircle,
  Eye,
  Info,
  Building2,
  Loader2,
  Package,
  Compass,
  Layers,
  CheckCircle2,
  XCircle,
  Navigation,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { GoogleMap, MarkerF } from '@react-google-maps/api';
import { adminService } from '../../services/adminService';
import { BACKEND_LABEL } from '../../../../shared/api/runtimeConfig';
import { GOOGLE_MAPS_API_KEY, HAS_VALID_GOOGLE_MAPS_KEY, INDIA_CENTER, useBaseGoogleMapsLoader } from '../../utils/googleMaps';

const currency = (value) => Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 });
const DASHBOARD_REFRESH_INTERVAL_MS = 60000;

const MainDashboard = () => {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  // Timeframe filter state
  const [timeframe, setTimeframe] = useState('Today'); // Today, Week, Month, Year
  const [selectedServiceTab, setSelectedServiceTab] = useState('all'); // all, ride, parcel, outstation

  // Interactive Chart states
  const [hoveredRevenueIndex, setHoveredRevenueIndex] = useState(null);
  const [hoveredDonutSegment, setHoveredDonutSegment] = useState(null);

  // Google Maps Loader
  const { isLoaded } = useBaseGoogleMapsLoader();

  const fetchData = async (silent = false) => {
    try {
      silent ? setIsRefreshing(true) : setIsLoading(true);
      const res = await adminService.getDashboardData();
      setDashboard(res?.data || res || {});
      setDashboardError('');
      setLastUpdatedAt(new Date());
    } catch (err) {
      setDashboardError(`System offline. Connection to ${BACKEND_LABEL} failed.`);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(true), DASHBOARD_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Backend Mapped Variables
  const totalUsers = dashboard?.totalUsers || 0;
  const totalDrivers = dashboard?.totalDrivers?.total || 0;
  const approvedDrivers = dashboard?.totalDrivers?.approved || 0;

  // Counts for right now, sent uncached by the backend
  const live = dashboard?.live || {};

  const todayEarnings = dashboard?.todayEarnings || {};
  const overallEarnings = dashboard?.overallEarnings || {};
  const notifiedSos = dashboard?.notifiedSos || {};
  const todayTrips = dashboard?.todayTrips || {};
  const overallTrips = dashboard?.overallTrips || {};

  // Real Service Breakdown from Backend
  const servicesBreakdown = useMemo(() => {
    return dashboard?.servicesBreakdown || {
      ride: { total: 0, completed: 0, cancelled: 0, ongoing: 0, grossFare: 0, adminCommission: 0, driverEarnings: 0, averageFare: 0, todayTotal: 0, todayCompleted: 0, todayGrossFare: 0, todayCommission: 0 },
      parcel: { total: 0, completed: 0, cancelled: 0, ongoing: 0, grossFare: 0, adminCommission: 0, driverEarnings: 0, averageFare: 0, todayTotal: 0, todayCompleted: 0, todayGrossFare: 0, todayCommission: 0 },
      outstation: { total: 0, completed: 0, cancelled: 0, ongoing: 0, grossFare: 0, adminCommission: 0, driverEarnings: 0, averageFare: 0, todayTotal: 0, todayCompleted: 0, todayGrossFare: 0, todayCommission: 0 },
    };
  }, [dashboard]);

  // Real Recent Bookings
  const recentBookings = useMemo(() => {
    return dashboard?.recentBookings || [];
  }, [dashboard]);

  // Fleet Utilization Calculation
  const fleetUtilization = useMemo(() => {
    const online = Number(live.onlineDrivers || 0);
    if (online === 0) return 0;
    return Math.round((Number(live.driversOnTrip || 0) / online) * 100);
  }, [live.onlineDrivers, live.driversOnTrip]);

  // System Diagnostics
  const systemChecks = useMemo(() => {
    const health = live.systemHealth || {};
    const label = (value, fallback) => (value ? String(value) : fallback);
    const ok = (value) => ['operational', 'connected', 'healthy', 'active'].includes(String(value || '').toLowerCase());

    return [
      { name: 'Application API', icon: Server, status: 'Answering', healthy: true },
      { name: 'Database', icon: Database, status: label(health.database, 'unknown'), healthy: ok(health.database) },
      { name: 'Socket Server', icon: Activity, status: label(health.socket, 'unknown'), healthy: ok(health.socket) },
      { name: 'Redis Cache', icon: Cpu, status: label(health.redis, 'unknown'), healthy: ok(health.redis) },
      { name: 'Google Maps Key', icon: Map, status: label(health.maps, 'unknown'), healthy: ok(health.maps) },
    ].map((check) => ({ ...check, color: check.healthy ? 'text-emerald-500' : 'text-rose-500' }));
  }, [live.systemHealth]);

  const topDrivers = dashboard?.topDrivers || [];
  const driverPositions = live.driverPositions || [];
  const sos = live.sos || {};

  // Selected Service Metrics Helper
  const currentServiceStats = useMemo(() => {
    if (selectedServiceTab === 'ride') return servicesBreakdown.ride;
    if (selectedServiceTab === 'parcel') return servicesBreakdown.parcel;
    if (selectedServiceTab === 'outstation') return servicesBreakdown.outstation;
    return null; // 'all'
  }, [selectedServiceTab, servicesBreakdown]);

  // SVG Area Chart Points mapping for Revenue Trajectory
  const chartWidth = 500;
  const chartHeight = 150;
  const revenueChartData = useMemo(() => {
    const rawChart = overallEarnings?.chart || [];
    if (rawChart.length > 0) {
      return rawChart.map(item => ({ label: item.label, value: item.amount }));
    }
    return [];
  }, [overallEarnings]);

  const revenuePoints = useMemo(() => {
    if (revenueChartData.length === 0) return [];
    const maxVal = Math.max(...revenueChartData.map(d => d.value), 1000);
    return revenueChartData.map((d, i) => {
      const x = (i / (revenueChartData.length - 1)) * chartWidth;
      const y = chartHeight - (d.value / maxVal) * (chartHeight - 30) - 15;
      return { x, y, label: d.label, value: d.value };
    });
  }, [revenueChartData]);

  const linePath = useMemo(() => {
    if (revenuePoints.length === 0) return '';
    return 'M ' + revenuePoints.map(p => `${p.x} ${p.y}`).join(' L ');
  }, [revenuePoints]);

  const areaPath = useMemo(() => {
    if (revenuePoints.length === 0) return '';
    return `${linePath} L ${chartWidth} ${chartHeight} L 0 ${chartHeight} Z`;
  }, [revenuePoints, linePath]);

  // Donut chart segments for Booking Distribution
  const bookingDonutData = useMemo(() => {
    let completed = todayTrips.completed || 0;
    let cancelled = todayTrips.cancelled || 0;
    let pending = todayTrips.scheduled || 0;

    if (currentServiceStats) {
      completed = currentServiceStats.completed || 0;
      cancelled = currentServiceStats.cancelled || 0;
      pending = currentServiceStats.ongoing || 0;
    }

    const total = completed + cancelled + pending;
    if (total === 0) return [];

    return [
      { label: 'Completed', value: completed, color: '#22C55E', percent: Math.round((completed / total) * 100) },
      { label: 'Cancelled', value: cancelled, color: '#EF4444', percent: Math.round((cancelled / total) * 100) },
      { label: 'Pending / Active', value: pending, color: '#3B82F6', percent: Math.round((pending / total) * 100) }
    ];
  }, [todayTrips, currentServiceStats]);

  const donutRadius = 30;
  const donutCircumference = 2 * Math.PI * donutRadius;
  const donutSegments = useMemo(() => {
    let accumulatedAngle = 0;
    return bookingDonutData.map((seg) => {
      const strokeDasharray = `${(seg.percent / 100) * donutCircumference} ${donutCircumference}`;
      const strokeDashoffset = -accumulatedAngle;
      accumulatedAngle += (seg.percent / 100) * donutCircumference;
      return {
        ...seg,
        strokeDasharray,
        strokeDashoffset
      };
    });
  }, [bookingDonutData, donutCircumference]);

  // Service Volume Share
  const totalServiceBookings = (servicesBreakdown.ride.total + servicesBreakdown.parcel.total + servicesBreakdown.outstation.total) || 1;
  const rideSharePercent = Math.round((servicesBreakdown.ride.total / totalServiceBookings) * 100);
  const parcelSharePercent = Math.round((servicesBreakdown.parcel.total / totalServiceBookings) * 100);
  const outstationSharePercent = Math.round((servicesBreakdown.outstation.total / totalServiceBookings) * 100);

  return (
    <div className="min-h-screen bg-[#F6F8FC] p-6 lg:p-8 font-sans redigo-admin-root animate-in fade-in duration-300">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* EXECUTIVE HEADER */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2.5 mb-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#64748B]">Taxi Operations Hub</span>
            </div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Executive Operations Center</h1>
            <p className="text-xs text-slate-500 mt-0.5">Real-time command center for City Rides, Parcel Deliveries, and Outstation Trips.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <div className="flex items-center gap-2 px-3.5 py-2 bg-white rounded-xl border border-slate-200/80 shadow-sm">
              <Clock size={14} className="text-slate-400" />
              <span className="font-semibold text-slate-700">
                Sync: {lastUpdatedAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) || 'Connecting...'}
              </span>
            </div>
            <button
              onClick={() => fetchData(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200/80 hover:bg-slate-50 rounded-xl transition-all shadow-sm font-semibold text-slate-700 active:scale-95"
              title="Sync Cloud Data"
            >
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin text-emerald-600' : 'text-slate-600'} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* QUICK NAVIGATION ACTION PILLS */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          {[
            { label: 'Trip Requests', path: '/admin/trips', icon: Car, count: overallTrips.total || 0, color: 'text-sky-600 bg-sky-50 border-sky-200 hover:bg-sky-100' },
            { label: 'Delivery Requests', path: '/admin/deliveries', icon: Package, count: servicesBreakdown.parcel.total || 0, color: 'text-purple-600 bg-purple-50 border-purple-200 hover:bg-purple-100' },
            { label: 'Outstation Trips', path: '/admin/trips?serviceType=outstation', icon: Compass, count: servicesBreakdown.outstation.total || 0, color: 'text-emerald-600 bg-emerald-50 border-emerald-200 hover:bg-emerald-100' },
            { label: 'Ongoing Requests', path: '/admin/ongoing', icon: Activity, count: live.ongoingTrips || 0, color: 'text-blue-600 bg-blue-50 border-blue-200 hover:bg-blue-100' },
            { label: 'Admin Earnings', path: '/admin/earnings', icon: IndianRupee, count: `₹${currency(overallEarnings.total)}`, color: 'text-emerald-700 bg-emerald-50/70 border-emerald-200 hover:bg-emerald-100' },
            { label: 'SOS Center', path: '/admin/safety', icon: Shield, count: sos.active || 0, color: 'text-rose-600 bg-rose-50 border-rose-200 hover:bg-rose-100' }
          ].map((pill, idx) => (
            <button
              key={idx}
              onClick={() => navigate(pill.path)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all shrink-0 shadow-2xs ${pill.color}`}
            >
              <pill.icon size={13} strokeWidth={2.2} />
              <span>{pill.label}</span>
              <span className="px-1.5 py-0.2 rounded-full bg-white/80 text-[10px] font-black border border-black/5">
                {pill.count}
              </span>
            </button>
          ))}
        </div>

        {dashboardError && (
          <div className="rounded-xl bg-rose-50 border border-rose-100 p-4 flex items-center gap-4 animate-shake">
            <div className="h-10 w-10 bg-white rounded-lg flex items-center justify-center text-rose-500 shadow-sm shrink-0">
              <CircleAlert size={20} />
            </div>
            <div>
              <p className="text-xs font-bold text-rose-900">Communication Gateway Offline</p>
              <p className="text-[10px] text-rose-600 mt-0.5 uppercase tracking-wider">{dashboardError}</p>
            </div>
          </div>
        )}

        {/* 1. HIGH-LEVEL PLATFORM KPI CARDS */}
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Gross Platform Fare", value: `₹${currency(overallEarnings.total)}`, sub: `Today: ₹${currency(todayEarnings.total)}`, icon: IndianRupee, cardBg: "bg-gradient-to-br from-emerald-600 to-emerald-700" },
            { label: "Admin Commission", value: `₹${currency(overallEarnings.admin_commission)}`, sub: `Today: ₹${currency(todayEarnings.admin_commission)}`, icon: Wallet, cardBg: "bg-gradient-to-br from-teal-600 to-teal-700" },
            { label: "Completed Bookings", value: overallTrips.completed || 0, sub: `Today: ${todayTrips.completed || 0} completed`, icon: CheckCircle2, cardBg: "bg-gradient-to-br from-sky-600 to-sky-700" },
            { label: "Total Customers", value: totalUsers, sub: `${live.onlineCustomers ?? 0} online now`, icon: Users, cardBg: "bg-gradient-to-br from-indigo-600 to-indigo-700" },
            { label: "Verified Drivers", value: approvedDrivers, sub: `${live.onlineDrivers ?? 0} active & online`, icon: UserCheck, cardBg: "bg-gradient-to-br from-violet-600 to-violet-700" },
            { label: "Fleet Capacity", value: `${fleetUtilization}%`, sub: `${live.driversOnTrip ?? 0} on a trip`, icon: TrendingUp, cardBg: "bg-gradient-to-br from-slate-800 to-slate-900" }
          ].map((kpi, idx) => (
            <div key={idx} className={`p-4 rounded-2xl text-white shadow-md hover:scale-[1.02] transition-all ${kpi.cardBg}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold opacity-80 uppercase tracking-wider">{kpi.label}</span>
                <div className="p-1.5 rounded-lg bg-white/20 backdrop-blur-xs">
                  <kpi.icon size={15} strokeWidth={2.4} />
                </div>
              </div>
              <h3 className="text-xl font-black tracking-tight">{isLoading ? '...' : kpi.value}</h3>
              <p className="text-[10px] opacity-80 font-medium mt-1 truncate">{kpi.sub}</p>
            </div>
          ))}
        </div>

        {/* 2. MULTI-SERVICE FLOW OPERATIONS HUB (CITY RIDES, PARCEL, OUTSTATION) */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Layers size={16} className="text-emerald-600" />
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Taxi Multi-Service Operations Hub</h2>
            </div>
            <span className="text-xs text-slate-500 font-medium">Real data grouped by core transport flows</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            
            {/* CITY RIDES FLOW */}
            <div className="bg-white rounded-2xl border border-sky-100 p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between relative overflow-hidden group">
              <div className="absolute top-0 left-0 right-0 h-1 bg-sky-500" />
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center border border-sky-100">
                      <Car size={18} strokeWidth={2.2} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">City Rides</h3>
                      <span className="text-[10px] text-sky-600 font-bold uppercase tracking-wider">Intra-City & Local</span>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 text-[10px] font-bold border border-sky-200">
                    {servicesBreakdown.ride.total} Total
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 bg-slate-50/80 rounded-xl p-3 border border-slate-100 mb-4 text-center">
                  <div>
                    <span className="text-[9px] text-slate-400 uppercase font-semibold block">Completed</span>
                    <span className="text-xs font-black text-emerald-600 block mt-0.5">{servicesBreakdown.ride.completed}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-400 uppercase font-semibold block">Active</span>
                    <span className="text-xs font-black text-blue-600 block mt-0.5">{live.ongoingCityRides ?? servicesBreakdown.ride.ongoing}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-400 uppercase font-semibold block">Cancelled</span>
                    <span className="text-xs font-black text-rose-500 block mt-0.5">{servicesBreakdown.ride.cancelled}</span>
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between items-center text-slate-600">
                    <span>Gross Volume:</span>
                    <span className="font-bold text-slate-900">₹{currency(servicesBreakdown.ride.grossFare)}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-600">
                    <span>Platform Commission:</span>
                    <span className="font-bold text-emerald-600">₹{currency(servicesBreakdown.ride.adminCommission)}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-600">
                    <span>Avg Fare:</span>
                    <span className="font-semibold text-slate-700">₹{currency(servicesBreakdown.ride.averageFare)}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-600 pt-1 border-t border-slate-100">
                    <span>Today's Bookings:</span>
                    <span className="font-semibold text-slate-900">{servicesBreakdown.ride.todayTotal} rides</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => navigate('/admin/trips?serviceType=ride')}
                className="mt-4 w-full py-2 bg-sky-50 hover:bg-sky-100 text-sky-700 text-xs font-bold rounded-xl border border-sky-200 flex items-center justify-center gap-1.5 transition-colors"
              >
                <span>View City Rides</span>
                <ChevronRight size={14} />
              </button>
            </div>

            {/* PARCEL DELIVERIES FLOW */}
            <div className="bg-white rounded-2xl border border-purple-100 p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between relative overflow-hidden group">
              <div className="absolute top-0 left-0 right-0 h-1 bg-purple-500" />
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center border border-purple-100">
                      <Package size={18} strokeWidth={2.2} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Parcel Deliveries</h3>
                      <span className="text-[10px] text-purple-600 font-bold uppercase tracking-wider">Courier & Packages</span>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 text-[10px] font-bold border border-purple-200">
                    {servicesBreakdown.parcel.total} Total
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 bg-slate-50/80 rounded-xl p-3 border border-slate-100 mb-4 text-center">
                  <div>
                    <span className="text-[9px] text-slate-400 uppercase font-semibold block">Completed</span>
                    <span className="text-xs font-black text-emerald-600 block mt-0.5">{servicesBreakdown.parcel.completed}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-400 uppercase font-semibold block">Active</span>
                    <span className="text-xs font-black text-blue-600 block mt-0.5">{live.ongoingParcels ?? servicesBreakdown.parcel.ongoing}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-400 uppercase font-semibold block">Cancelled</span>
                    <span className="text-xs font-black text-rose-500 block mt-0.5">{servicesBreakdown.parcel.cancelled}</span>
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between items-center text-slate-600">
                    <span>Gross Volume:</span>
                    <span className="font-bold text-slate-900">₹{currency(servicesBreakdown.parcel.grossFare)}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-600">
                    <span>Platform Commission:</span>
                    <span className="font-bold text-emerald-600">₹{currency(servicesBreakdown.parcel.adminCommission)}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-600">
                    <span>Avg Delivery:</span>
                    <span className="font-semibold text-slate-700">₹{currency(servicesBreakdown.parcel.averageFare)}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-600 pt-1 border-t border-slate-100">
                    <span>Today's Deliveries:</span>
                    <span className="font-semibold text-slate-900">{servicesBreakdown.parcel.todayTotal} orders</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => navigate('/admin/deliveries')}
                className="mt-4 w-full py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 text-xs font-bold rounded-xl border border-purple-200 flex items-center justify-center gap-1.5 transition-colors"
              >
                <span>View Deliveries</span>
                <ChevronRight size={14} />
              </button>
            </div>

            {/* OUTSTATION / INTERCITY TRIPS FLOW */}
            <div className="bg-white rounded-2xl border border-emerald-100 p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between relative overflow-hidden group">
              <div className="absolute top-0 left-0 right-0 h-1 bg-emerald-500" />
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
                      <Compass size={18} strokeWidth={2.2} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Outstation Trips</h3>
                      <span className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider">Intercity & Long-Distance</span>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200">
                    {servicesBreakdown.outstation.total} Total
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 bg-slate-50/80 rounded-xl p-3 border border-slate-100 mb-4 text-center">
                  <div>
                    <span className="text-[9px] text-slate-400 uppercase font-semibold block">Completed</span>
                    <span className="text-xs font-black text-emerald-600 block mt-0.5">{servicesBreakdown.outstation.completed}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-400 uppercase font-semibold block">Active</span>
                    <span className="text-xs font-black text-blue-600 block mt-0.5">{live.ongoingOutstations ?? servicesBreakdown.outstation.ongoing}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-400 uppercase font-semibold block">Cancelled</span>
                    <span className="text-xs font-black text-rose-500 block mt-0.5">{servicesBreakdown.outstation.cancelled}</span>
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between items-center text-slate-600">
                    <span>Gross Volume:</span>
                    <span className="font-bold text-slate-900">₹{currency(servicesBreakdown.outstation.grossFare)}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-600">
                    <span>Platform Commission:</span>
                    <span className="font-bold text-emerald-600">₹{currency(servicesBreakdown.outstation.adminCommission)}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-600">
                    <span>Avg Outstation:</span>
                    <span className="font-semibold text-slate-700">₹{currency(servicesBreakdown.outstation.averageFare)}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-600 pt-1 border-t border-slate-100">
                    <span>Today's Trips:</span>
                    <span className="font-semibold text-slate-900">{servicesBreakdown.outstation.todayTotal} trips</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => navigate('/admin/trips?serviceType=outstation')}
                className="mt-4 w-full py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-xl border border-emerald-200 flex items-center justify-center gap-1.5 transition-colors"
              >
                <span>View Outstation</span>
                <ChevronRight size={14} />
              </button>
            </div>

          </div>
        </div>

        {/* 3. REVENUE & BOOKING ANALYTICS ROW */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
          
          {/* Interactive Revenue Analytics */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs lg:col-span-2 flex flex-col justify-between hover:shadow-md transition-shadow">
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs text-slate-900 uppercase tracking-wider font-bold">Revenue & Financial Analytics</h3>
                  <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                </div>
                
                {/* Timeframe selector */}
                <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200/80">
                  {['Today', 'Week', 'Month', 'Year'].map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setTimeframe(tab)}
                      className={`text-[10px] font-bold px-2.5 py-1 rounded-md transition-all ${timeframe === tab ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'}`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>

              {/* Service Tab selector */}
              <div className="flex items-center gap-1.5 my-2">
                {[
                  { key: 'all', label: 'All Services' },
                  { key: 'ride', label: 'City Rides' },
                  { key: 'parcel', label: 'Parcel' },
                  { key: 'outstation', label: 'Outstation' }
                ].map((sTab) => (
                  <button
                    key={sTab.key}
                    onClick={() => setSelectedServiceTab(sTab.key)}
                    className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg border transition-all ${selectedServiceTab === sTab.key ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}
                  >
                    {sTab.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-500">Platform earnings and financial transaction metrics.</p>
            </div>

            <div className="grid grid-cols-3 gap-2 my-3">
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-center">
                <span className="text-[9px] text-slate-400 block uppercase font-semibold">Total Revenue</span>
                <span className="text-sm font-black text-slate-900 block mt-0.5">
                  ₹{currency(
                    currentServiceStats
                      ? (timeframe === 'Today' ? currentServiceStats.todayGrossFare : currentServiceStats.grossFare)
                      : (timeframe === 'Today' ? todayEarnings.total : overallEarnings.total)
                  )}
                </span>
              </div>
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-center">
                <span className="text-[9px] text-emerald-600 block uppercase font-bold">Commission</span>
                <span className="text-sm font-black text-emerald-600 block mt-0.5">
                  ₹{currency(
                    currentServiceStats
                      ? (timeframe === 'Today' ? currentServiceStats.todayCommission : currentServiceStats.adminCommission)
                      : (timeframe === 'Today' ? todayEarnings.admin_commission : overallEarnings.admin_commission)
                  )}
                </span>
              </div>
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-center">
                <span className="text-[9px] text-slate-400 block uppercase font-semibold">Trips</span>
                <span className="text-sm font-black text-slate-900 block mt-0.5">
                  {currentServiceStats
                    ? (timeframe === 'Today' ? currentServiceStats.todayTotal : currentServiceStats.total)
                    : (timeframe === 'Today' ? todayTrips.total : overallTrips.total)}
                </span>
              </div>
            </div>

            {/* Interactive SVG Area Chart */}
            {revenueChartData.length === 0 ? (
              <div className="h-[150px] flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-2xl bg-slate-50/50 p-4 my-2 text-center">
                <p className="text-xs font-semibold text-slate-700">No historical data available</p>
                <p className="text-[10px] text-slate-400 mt-1">Transaction growth telemetry will automatically sync here.</p>
              </div>
            ) : (
              <>
                <div className="relative pt-2">
                  <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full overflow-visible">
                    <path d={areaPath} fill="rgba(34, 197, 94, 0.08)" />
                    <path d={linePath} fill="none" stroke="#16A34A" strokeWidth="2.5" />
                    {revenuePoints.map((pt, idx) => (
                      <circle
                        key={idx}
                        cx={pt.x}
                        cy={pt.y}
                        r={hoveredRevenueIndex === idx ? 6 : 4}
                        fill={hoveredRevenueIndex === idx ? '#16A34A' : '#FFFFFF'}
                        stroke="#16A34A"
                        strokeWidth="2"
                        className="cursor-pointer"
                        onMouseEnter={() => setHoveredRevenueIndex(idx)}
                        onMouseLeave={() => setHoveredRevenueIndex(null)}
                      />
                    ))}
                  </svg>

                  {hoveredRevenueIndex !== null && revenuePoints[hoveredRevenueIndex] && (
                    <div
                      className="absolute bg-slate-900 text-white rounded-lg px-2.5 py-1.5 text-[10px] pointer-events-none shadow-xl border border-slate-800"
                      style={{
                        left: `${(revenuePoints[hoveredRevenueIndex].x / chartWidth) * 100}%`,
                        top: `${(revenuePoints[hoveredRevenueIndex].y / chartHeight) * 100 - 35}%`,
                        transform: 'translateX(-50%)',
                      }}
                    >
                      <span className="font-semibold block">{revenuePoints[hoveredRevenueIndex].label}</span>
                      <span className="block mt-0.5 text-emerald-400 font-bold">Revenue: ₹{currency(revenuePoints[hoveredRevenueIndex].value)}</span>
                    </div>
                  )}
                </div>

                <div className="flex justify-between text-[10px] text-slate-400 pt-2 border-t border-slate-100 mt-2">
                  {revenueChartData.map((d, i) => (
                    <span key={i} className="font-medium">{d.label}</span>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Booking Analytics & Volume Distribution */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow">
            <div>
              <h3 className="text-xs text-slate-900 uppercase tracking-wider mb-1 font-bold">Booking Distribution</h3>
              <p className="text-[11px] text-slate-500 mb-3">Status split for {selectedServiceTab === 'all' ? 'all services' : selectedServiceTab}.</p>
            </div>

            {bookingDonutData.length === 0 ? (
              <div className="h-[140px] flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-2xl bg-slate-50/50 p-4 my-2 text-center">
                <p className="text-xs font-semibold text-slate-700">No booking records</p>
                <p className="text-[10px] text-slate-400 mt-1">Daily booking records will populate here.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-center relative py-1">
                  <svg width="100" height="100" viewBox="0 0 100 100" className="transform -rotate-90">
                    {donutSegments.map((seg, i) => (
                      <circle
                        key={i}
                        cx="50"
                        cy="50"
                        r={donutRadius}
                        fill="transparent"
                        stroke={seg.color}
                        strokeWidth="8"
                        strokeDasharray={seg.strokeDasharray}
                        strokeDashoffset={seg.strokeDashoffset}
                        className="cursor-pointer transition-all hover:stroke-[10px]"
                        onMouseEnter={() => setHoveredDonutSegment(seg)}
                        onMouseLeave={() => setHoveredDonutSegment(null)}
                      />
                    ))}
                  </svg>

                  <div className="absolute text-center">
                    <span className="text-[8px] text-slate-400 uppercase font-bold block">
                      {hoveredDonutSegment ? hoveredDonutSegment.label : 'Completed'}
                    </span>
                    <span className="text-sm font-black text-slate-900 block mt-0.5">
                      {hoveredDonutSegment ? `${hoveredDonutSegment.percent}%` : `${bookingDonutData[0]?.percent || 0}%`}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5 pt-2 border-t border-slate-100 mt-2">
                  {bookingDonutData.map((seg, i) => (
                    <div key={i} className="flex items-center justify-between text-[10px] text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: seg.color }} />
                        <span className="font-medium">{seg.label}</span>
                      </div>
                      <span className="font-bold text-slate-900">{seg.value} ({seg.percent}%)</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Service Volume Share comparison bar */}
            <div className="pt-3 border-t border-slate-100 mt-2">
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Service Volume Share</span>
              <div className="w-full h-2 rounded-full bg-slate-100 flex overflow-hidden">
                <div style={{ width: `${rideSharePercent}%` }} className="bg-sky-500 h-full" title={`City Rides: ${rideSharePercent}%`} />
                <div style={{ width: `${parcelSharePercent}%` }} className="bg-purple-500 h-full" title={`Parcel: ${parcelSharePercent}%`} />
                <div style={{ width: `${outstationSharePercent}%` }} className="bg-emerald-500 h-full" title={`Outstation: ${outstationSharePercent}%`} />
              </div>
              <div className="flex justify-between items-center text-[9px] text-slate-500 font-semibold mt-1">
                <span className="text-sky-600">🚕 {rideSharePercent}%</span>
                <span className="text-purple-600">📦 {parcelSharePercent}%</span>
                <span className="text-emerald-600">🛣️ {outstationSharePercent}%</span>
              </div>
            </div>
          </div>

          {/* Platform Health Diagnostics */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow">
            <div>
              <h3 className="text-xs text-slate-900 uppercase tracking-wider mb-1 font-bold">Platform Diagnostic Health</h3>
              <p className="text-[11px] text-slate-500 mb-3">Real-time system services telemetry.</p>
            </div>

            <div className="space-y-2.5 text-[10px] text-slate-600">
              {systemChecks.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="flex items-center gap-2">
                    <item.icon size={13} className="text-slate-400" />
                    <span className="font-medium text-slate-700">{item.name}</span>
                  </span>
                  <span className={`font-bold px-2 py-0.5 rounded-full text-[9px] ${item.healthy ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-rose-50 text-rose-600 border border-rose-200'}`}>
                    {item.status}
                  </span>
                </div>
              ))}
            </div>

            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-center text-[10px] text-slate-500 mt-2.5 font-medium">
              {systemChecks.every((check) => check.healthy)
                ? '✅ All platform services answering normally.'
                : `⚠️ Check: ${systemChecks.filter((check) => !check.healthy).map((check) => check.name).join(', ')}`}
            </div>
          </div>

        </div>

        {/* 4. RECENT LIVE BOOKINGS FEED & OPERATIONAL PULSE */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Recent Live Bookings Across Rides, Parcel & Outstation */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs lg:col-span-2 flex flex-col justify-between hover:shadow-md transition-shadow">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Activity size={16} className="text-emerald-600" />
                  <h3 className="text-xs text-slate-900 uppercase tracking-wider font-bold">Recent Dispatch & Booking Stream</h3>
                </div>
                <button
                  onClick={() => navigate('/admin/trips')}
                  className="text-[11px] text-emerald-600 hover:text-emerald-700 font-bold flex items-center gap-1"
                >
                  <span>All Bookings</span>
                  <ChevronRight size={13} />
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mb-4">Latest live customer bookings across City Rides, Parcels, and Outstation trips.</p>

              {recentBookings.length === 0 ? (
                <div className="py-10 text-center text-slate-400 text-xs">
                  No booking records found.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        <th className="pb-2.5">Request / Service</th>
                        <th className="pb-2.5">Customer & Driver</th>
                        <th className="pb-2.5">Route</th>
                        <th className="pb-2.5">Fare</th>
                        <th className="pb-2.5">Status</th>
                        <th className="pb-2.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {recentBookings.map((b) => {
                        const serviceBadgeClass =
                          b.serviceType === 'parcel'
                            ? 'bg-purple-50 text-purple-700 border-purple-200'
                            : b.serviceType === 'outstation'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-sky-50 text-sky-700 border-sky-200';
                        
                        const statusBadgeClass =
                          b.status === 'completed'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : b.status === 'cancelled'
                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                            : b.status === 'ongoing' || b.status === 'accepted'
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200';

                        return (
                          <tr key={b.id} className="hover:bg-slate-50/60 transition-colors">
                            <td className="py-2.5 pr-2">
                              <span className="font-bold text-slate-900 block text-[11px]">{b.requestId}</span>
                              <span className={`inline-block mt-0.5 px-1.5 py-0.2 rounded-md text-[9px] font-bold border ${serviceBadgeClass}`}>
                                {b.serviceLabel}
                              </span>
                            </td>
                            <td className="py-2.5 pr-2">
                              <span className="font-semibold text-slate-800 block text-[11px] truncate max-w-[130px]">{b.customerName}</span>
                              <span className="text-[10px] text-slate-400 block truncate max-w-[130px]">
                                👤 {b.driverName}
                              </span>
                            </td>
                            <td className="py-2.5 pr-2 max-w-[200px]">
                              <span className="text-[10px] text-slate-600 line-clamp-2" title={b.route}>
                                {b.route}
                              </span>
                            </td>
                            <td className="py-2.5 pr-2 whitespace-nowrap">
                              <span className="font-bold text-slate-900 block">₹{currency(b.fare)}</span>
                              <span className="text-[9px] text-slate-400 uppercase font-semibold block">{b.paymentMethod}</span>
                            </td>
                            <td className="py-2.5 pr-2 whitespace-nowrap">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border capitalize ${statusBadgeClass}`}>
                                {b.status}
                              </span>
                            </td>
                            <td className="py-2.5 text-right whitespace-nowrap">
                              <button
                                onClick={() => navigate(b.serviceType === 'parcel' ? '/admin/deliveries' : '/admin/trips')}
                                className="p-1 rounded-lg text-slate-500 hover:text-emerald-600 hover:bg-slate-100 transition-colors"
                                title="View Details"
                              >
                                <Eye size={15} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT NOW LIVE PULSE CARD (BUTTON REMOVED AS REQUESTED) */}
          <div className="bg-slate-900 rounded-2xl p-5 text-white shadow-lg flex flex-col justify-between border border-slate-800">
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-emerald-400" />
                  <h3 className="text-xs text-white uppercase tracking-wider font-bold">Right Now — Live Fleet Pulse</h3>
                </div>
                <span className="text-[9px] bg-emerald-500/20 text-emerald-400 font-bold px-2 py-0.5 rounded-full border border-emerald-500/30 flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                  Live
                </span>
              </div>

              <div className="space-y-3 text-xs text-slate-300">
                {[
                  { label: 'Drivers Online', value: live.onlineDrivers ?? 0, color: 'text-emerald-400 font-bold' },
                  { label: 'Drivers on a Trip', value: live.driversOnTrip ?? 0, color: 'text-sky-400 font-bold' },
                  { label: 'Active City Rides', value: live.ongoingCityRides ?? 0, color: 'text-white font-bold' },
                  { label: 'Active Parcel Deliveries', value: live.ongoingParcels ?? 0, color: 'text-white font-bold' },
                  { label: 'Active Outstation Trips', value: live.ongoingOutstations ?? 0, color: 'text-white font-bold' },
                  { label: 'Total Trips in Progress', value: live.ongoingTrips ?? 0, color: 'text-amber-400 font-black' },
                  { label: 'Customers Connected', value: live.onlineCustomers ?? 0, color: 'text-white font-bold' },
                  { label: 'Pending Driver Approvals', value: live.pendingApprovals ?? 0, color: 'text-rose-400 font-bold' }
                ].map((row, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-slate-800 pb-2 last:border-0 last:pb-0">
                    <span className="text-slate-400 font-medium">{row.label}</span>
                    <span className={row.color}>{isLoading ? '...' : row.value}</span>
                  </div>
                ))}
              </div>

              {/* Fleet Utilization Progress */}
              <div className="mt-5 pt-4 border-t border-slate-800">
                <div className="flex justify-between items-center text-xs mb-1.5">
                  <span className="text-slate-400">Live Fleet Utilization:</span>
                  <span className="font-black text-emerald-400">{fleetUtilization}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(fleetUtilization, 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Note replacing the removed button */}
            <div className="mt-4 p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60 text-[10px] text-slate-400 flex items-center justify-between">
              <span>Fleet telemetry updates automatically every 60s.</span>
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
            </div>
          </div>

        </div>

        {/* 5. LEADERBOARD & SOS RESPONSE ROW */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          
          {/* Driver Performance Leaderboard */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs text-slate-900 uppercase tracking-wider flex items-center gap-1.5 font-bold">
                  <Award size={15} className="text-emerald-600" />
                  <span>Top Performing Drivers</span>
                </h3>
                <span className="text-[10px] text-slate-400 font-semibold">Ranked by completed trips</span>
              </div>
              
              <div className="space-y-3">
                {topDrivers.length === 0 && !isLoading && (
                  <p className="text-xs text-slate-400 py-6 text-center">No completed trips records yet.</p>
                )}
                {topDrivers.map((lead, i) => (
                  <div key={i} className="flex items-center justify-between text-xs pb-2.5 border-b border-slate-100 last:border-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center font-bold text-xs text-slate-900 border border-slate-200">
                        {i + 1}
                      </div>
                      <div>
                        <span className="font-bold text-slate-900 block">{lead.name}</span>
                        <span className="text-[10px] text-slate-400 block mt-0.5">
                          {Number(lead.rating) > 0 ? `Rating: ${Number(lead.rating).toFixed(1)} ⭐` : 'New Driver'}
                          {lead.online ? ' · 🟢 online' : ''}
                        </span>
                      </div>
                    </div>
                    <span className="font-black text-emerald-600 text-xs px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200">
                      {lead.trips} trips
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* SOS Safety Monitoring & Uptime */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow relative overflow-hidden">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs text-slate-900 uppercase tracking-wider flex items-center gap-1.5 font-bold">
                  <Shield size={15} className="text-rose-500" />
                  <span>SOS Response & Safety Terminal</span>
                </h3>
                {Number(sos.active || 0) > 0 && (
                  <span className="bg-rose-100 text-rose-800 text-[9px] font-bold px-2 py-0.5 rounded-full border border-rose-200 animate-pulse">
                    ACTIVE DISTRESS
                  </span>
                )}
              </div>

              <div className="flex items-center justify-around py-3 bg-rose-50/50 rounded-2xl border border-rose-100 mb-3">
                <div className="text-center">
                  <span className="text-3xl font-black text-rose-500 block leading-none">{sos.active || 0}</span>
                  <span className="text-[9px] text-slate-500 block mt-1.5 uppercase font-bold">Pending SOS</span>
                </div>
                <div className="w-[1px] h-10 bg-rose-200" />
                <div className="text-center">
                  <span className="text-3xl font-black text-slate-900 block leading-none">{sos.resolved || 0}</span>
                  <span className="text-[9px] text-slate-500 block mt-1.5 uppercase font-bold">Resolved Signals</span>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-2 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span>Safety Support Tickets Open:</span>
                  <span className="font-bold text-slate-900">{notifiedSos.total || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tickets Assigned to Officers:</span>
                  <span className="font-bold text-slate-900">{notifiedSos.assigned || 0}</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => navigate('/admin/safety')}
              className="w-full h-9 text-xs font-bold justify-center gap-2 mt-3 rounded-xl bg-rose-600 text-white hover:bg-rose-700 flex items-center transition-colors shadow-xs"
            >
              <AlertTriangle size={14} />
              <span>Enter Emergency Terminal</span>
            </button>
          </div>

        </div>

        {/* 6. GOOGLE MAPS DISTRIBUTION & DEMAND */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs text-slate-900 uppercase tracking-wider flex items-center gap-1.5 font-bold">
              <MapPin size={15} className="text-emerald-600" />
              <span>Operational Demand & Fleet Geo-Distribution</span>
            </h3>
            <span className="text-xs text-slate-500 font-medium">Live driver locations & tracking</span>
          </div>
          <p className="text-[11px] text-slate-500 mb-4">
            {driverPositions.length > 0
              ? `${driverPositions.length} driver${driverPositions.length === 1 ? '' : 's'} online right now. Green is free, amber is on a trip.`
              : 'No drivers with active GPS coordinates online right now.'}
          </p>

          <div className="w-full h-80 rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 flex items-center justify-center relative shadow-inner">
            {isLoaded ? (
              <GoogleMap
                mapContainerClassName="w-full h-full"
                center={INDIA_CENTER}
                zoom={5}
                options={{
                  disableDefaultUI: true,
                  styles: [
                    { elementType: 'geometry', stylers: [{ color: '#f5f5f5' }] },
                    { elementType: 'labels.text.fill', stylers: [{ color: '#616161' }] },
                    { elementType: 'labels.text.stroke', stylers: [{ color: '#f5f5f5' }] },
                    { featureType: 'administrative.land_parcel', elementType: 'labels.text.fill', stylers: [{ color: '#bdbdbd' }] },
                    { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#eeeeee' }] },
                    { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
                    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
                    { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
                    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#dadada' }] },
                    { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#616161' }] },
                    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9c9c9' }] },
                    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#9e9e9e' }] }
                  ]
                }}
              >
                {driverPositions
                  .filter((driver) => Number.isFinite(driver.lat) && Number.isFinite(driver.lng))
                  .map((driver) => (
                    <MarkerF
                      key={driver.id}
                      position={{ lat: driver.lat, lng: driver.lng }}
                      title={`${driver.name}${driver.onTrip ? ' - on a trip' : ' - free'}`}
                      icon={{
                        path: window.google?.maps?.SymbolPath?.CIRCLE,
                        scale: 6,
                        fillColor: driver.onTrip ? '#1DE366' : '#22C55E',
                        fillOpacity: 1,
                        strokeColor: '#ffffff',
                        strokeWeight: 2,
                      }}
                    />
                  ))}
              </GoogleMap>
            ) : (
              <div className="text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                <Loader2 size={24} className="animate-spin text-slate-900" />
                <span>Loading Google Maps Services...</span>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default MainDashboard;
