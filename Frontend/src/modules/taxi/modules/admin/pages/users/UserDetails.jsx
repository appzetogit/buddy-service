import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  ArrowLeft, 
  ChevronRight, 
  Mail, 
  Phone, 
  Clock, 
  Filter, 
  CheckCircle2, 
  CreditCard, 
  Star, 
  Car,
  TrendingUp,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  History as HistoryIcon,
  ShieldCheck,
  ShieldAlert
} from 'lucide-react';
import { useNavigate, useParams } from '@taxi/shared/router';
import { adminService } from '../../services/adminService';

const UserDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('Request List');
  
  const [user, setUser] = useState(null);
  const [requests, setRequests] = useState([]);
  const [walletHistory, setWalletHistory] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Table filtering and pagination state
  const [statusFilter, setStatusFilter] = useState('all');
  const [tempStatusFilter, setTempStatusFilter] = useState('all');
  const [pageSize, setPageSize] = useState(15);
  const [currentPage, setCurrentPage] = useState(1);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (filterRef.current && !filterRef.current.contains(event.target)) {
        setIsFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Fetch User Info
      const userData = await adminService.getUser(id);
      let u = userData?.data?.user || userData?.data || userData;
      if (Array.isArray(u)) u = u[0];
      
      if (userData?.success && u) {
        setUser({
          id: u._id || id,
          name: u.name || u.user_id?.name || 'Anonymous',
          phone: u.phone || u.mobile || u.mobile_number || u.user_id?.mobile || 'N/A',
          email: u.email || u.user_id?.email || 'N/A',
          gender: u.gender || '',
          active: u.active ?? u.isActive ?? true,
          joined: (u.createdAt || u.user_id?.createdAt) 
            ? new Date(u.createdAt || u.user_id?.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) 
            : 'N/A',
          avatar: (u.name || u.user_id?.name || 'A').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase(),
          profileImage: u.profileImage || u.user_id?.profileImage || '',
          governmentIdProof: u.governmentIdProof || u.user_id?.governmentIdProof || null,
          stats: u.stats || {
            completed: 0, 
            cancelled: 0,
            upcoming: 0
          },
          wallet: {
            total: Number(u.wallet_balance || 0),
            spend: 0,
            balance: Number(u.wallet_balance || 0)
          },
        });

        const userReviews = Array.isArray(userData.data?.reviews)
          ? userData.data.reviews
          : Array.isArray(u?.reviews)
            ? u.reviews
            : [];
        setReviews(
          userReviews.map((review) => ({
            _id: review._id,
            rating: Number(review.rating || 0),
            comment: review.comment || '',
            createdAt: review.createdAt || null,
            driver_id: review.driver_id || null,
          })),
        );
      }

      // Fetch Requests
      try {
        const reqData = await adminService.getUserRequests(id);
        const reqList = reqData?.data?.results || reqData?.results || (Array.isArray(reqData?.data) ? reqData.data : []);
        const mappedRequests = reqList.map((r) => {
          const rawStatus = String(r.status || '').toLowerCase();
          const isComp = r.is_completed || rawStatus === 'completed';
          const isCanc = r.is_cancelled || rawStatus === 'cancelled';
          const status = isComp ? 'Completed' : isCanc ? 'Cancelled' : 'Ongoing';
          return {
            id: r.request_id || r._id || 'N/A',
            date: r.trip_start_time || r.createdAt 
              ? new Date(r.trip_start_time || r.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) 
              : 'N/A',
            user: r.user_id?.name || u?.name || 'User',
            driver: r.driver_id?.name || 'Pending',
            pickup: r.pickup_address || '',
            drop: r.drop_address || '',
            fare: Number(r.fare || 0),
            status,
            paid: (r.is_paid || isComp) ? 'Paid' : 'Not Paid',
            payment: String(r.payment_type || r.paymentMethod || 'CASH').toUpperCase()
          };
        });
        setRequests(mappedRequests);

        setUser((prev) => prev ? ({
          ...prev,
          stats: {
            completed: mappedRequests.filter((r) => r.status === 'Completed').length,
            cancelled: mappedRequests.filter((r) => r.status === 'Cancelled').length,
            upcoming: mappedRequests.filter((r) => r.status === 'Ongoing').length
          }
        }) : prev);
      } catch (reqErr) {
        console.warn('Failed to fetch user requests:', reqErr);
      }

      // Fetch Wallet History
      try {
        const walletData = await adminService.getUserWalletHistory(id);
        const walletPayload = walletData?.data || walletData || {};
        const rawHistory = walletPayload.results || [];
        const history = rawHistory.map((w) => {
          const isCredit = w.type === 'credit' || w.kind === 'credit' || w.type === 'addition' || w.transaction_alias === 'ADMIN_CREDIT' || Number(w.amount || 0) > 0;
          return {
            id: w._id,
            amount: Math.abs(Number(w.amount || 0)),
            type: isCredit ? 'credit' : 'debit',
            remarks: w.remarks || w.description || w.title || (isCredit ? 'Credit' : 'Debit'),
            date: w.createdAt 
              ? new Date(w.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) 
              : 'N/A'
          };
        });
        setWalletHistory(history);

        const totalCredit = walletPayload.total_credits !== undefined 
          ? Number(walletPayload.total_credits) 
          : history.filter((h) => h.type === 'credit').reduce((sum, h) => sum + h.amount, 0);

        const totalDebit = walletPayload.total_debits !== undefined 
          ? Number(walletPayload.total_debits) 
          : history.filter((h) => h.type === 'debit').reduce((sum, h) => sum + h.amount, 0);

        const finalBalance = walletPayload.balance !== undefined 
          ? Number(walletPayload.balance) 
          : Number(u?.wallet_balance || 0);

        setUser((prev) => prev ? ({
          ...prev,
          wallet: {
            total: totalCredit,
            spend: totalDebit,
            balance: finalBalance
          }
        }) : prev);
      } catch (walletErr) {
        console.warn('Failed to fetch user wallet history:', walletErr);
      }

    } catch (err) {
      setError('Failed to load user details');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  // Filtered requests based on status
  const filteredRequests = useMemo(() => {
    if (statusFilter === 'all') return requests;
    return requests.filter((r) => r.status.toLowerCase() === statusFilter.toLowerCase());
  }, [requests, statusFilter]);

  const paginatedRequests = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRequests.slice(start, start + pageSize);
  }, [filteredRequests, currentPage, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / pageSize));

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[600px] gap-4">
        <div className="w-10 h-10 border-4 border-gray-100 border-t-yellow-400 rounded-full animate-spin"></div>
        <p className="text-sm font-semibold text-gray-500">Loading Profile...</p>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[600px] gap-4">
        <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center text-rose-500">
          <AlertCircle size={32} />
        </div>
        <p className="text-lg font-semibold text-gray-900">{error || 'User not found'}</p>
        <button onClick={() => navigate('/admin/users')} className="px-6 py-2 bg-black text-white rounded-lg text-sm font-medium shadow-sm">
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-700 text-gray-950 font-sans p-4 lg:p-8 bg-gray-50 min-h-screen">
      {/* HEADER & BREADCRUMBS */}
      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
        <span>Users</span>
        <ChevronRight size={12} />
        <span className="text-gray-700 font-medium">User Profile</span>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => navigate('/admin/users')}
            className="p-1.5 hover:bg-white rounded-lg border border-transparent hover:border-gray-200 transition-all text-gray-500 hover:text-gray-900"
          >
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-lg font-bold text-gray-900 tracking-tight">User Profile</h1>
        </div>
      </div>

      {/* USER INFO CARD */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 md:p-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="flex flex-col md:flex-row items-center md:items-start gap-5">
            <div className="w-20 h-20 shrink-0 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 text-2xl font-bold border border-gray-200 shadow-sm">
              {user.profileImage ? (
                <img src={user.profileImage} alt={user.name} className="h-full w-full rounded-full object-cover" />
              ) : (
                user.avatar
              )}
            </div>
            <div className="text-center md:text-left space-y-1 mt-1">
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
                <h2 className="text-lg font-bold text-gray-900 tracking-tight leading-tight">{user.name}</h2>
                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  user.active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-100 text-gray-600 border border-gray-200'
                }`}>
                  {user.active ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
                  {user.active ? 'Active' : 'Suspended'}
                </span>
                {user.gender && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 capitalize">
                    {user.gender}
                  </span>
                )}
              </div>
              <div className="flex flex-col md:flex-row md:items-center gap-1.5 md:gap-4 text-sm font-medium text-gray-500">
                <div className="flex items-center justify-center md:justify-start gap-1.5">
                  <Phone size={14} className="text-gray-400" /> {user.phone}
                </div>
                <div className="hidden md:block w-1 h-1 rounded-full bg-gray-300"></div>
                <div className="flex items-center justify-center md:justify-start gap-1.5">
                  <Mail size={14} className="text-gray-400" /> {user.email || 'N/A'}
                </div>
                <div className="hidden md:block w-1 h-1 rounded-full bg-gray-300"></div>
                <div className="flex items-center justify-center md:justify-start gap-1.5">
                  <Clock size={14} className="text-gray-400" /> Joined {user.joined}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center md:justify-end gap-2 shrink-0">
            {user.profileImage ? (
              <a
                href={user.profileImage}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                View Photo
              </a>
            ) : null}
            {user.governmentIdProof?.imageUrl ? (
              <a
                href={user.governmentIdProof.imageUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                View {String(user.governmentIdProof.type || 'ID').replace(/_/g, ' ')}
              </a>
            ) : (
              <span className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600">
                ID Proof Missing
              </span>
            )}
          </div>
        </div>

        {/* PILL TABS */}
        <div className="mt-6 flex items-center gap-2 overflow-x-auto whitespace-nowrap hide-scrollbar border-t border-gray-100 pt-5">
          {['Request List', 'User Payment History', 'Review History'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                activeTab === tab 
                  ? 'bg-yellow-400 text-black shadow-sm font-semibold' 
                  : 'text-gray-500 bg-transparent hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* TAB CONTENT */}
      <div className="min-h-[400px]">
        {activeTab === 'Request List' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            {/* STAT CARDS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {[
                { label: 'Completed Rides', val: user.stats.completed, icon: CheckCircle2, color: 'emerald' },
                { label: 'Cancelled Rides', val: user.stats.cancelled, icon: AlertCircle, color: 'rose' },
                { label: 'Upcoming Rides', val: user.stats.upcoming, icon: Clock, color: 'yellow' }
              ].map((s, i) => (
                <div key={i} className="bg-white p-4 rounded-xl border border-gray-200 flex items-center justify-between shadow-sm">
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-0.5">{s.label}</p>
                    <p className="text-xl font-bold text-gray-900">{s.val}</p>
                  </div>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    s.color === 'emerald' ? 'bg-emerald-50 text-emerald-600' : 
                    s.color === 'rose' ? 'bg-rose-50 text-rose-600' : 
                    'bg-yellow-50 text-yellow-600'
                  }`}>
                    <s.icon size={18} />
                  </div>
                </div>
              ))}
            </div>

            {/* TABLE SECTION */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
              {/* TABLE CONTROLS */}
              <div className="p-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
                  Show 
                  <select 
                    value={pageSize}
                    onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                    className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-gray-900 outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 transition-all font-semibold"
                  >
                    <option value={15}>15</option>
                    <option value={30}>30</option>
                    <option value={50}>50</option>
                  </select>
                  Entries
                </div>
                
                <div className="relative" ref={filterRef}>
                  <button 
                    onClick={() => { setTempStatusFilter(statusFilter); setIsFilterOpen(!isFilterOpen); }}
                    className="flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors shadow-sm"
                  >
                    <Filter size={14} /> Filters
                    {statusFilter !== 'all' && (
                      <span className="w-2 h-2 rounded-full bg-yellow-400"></span>
                    )}
                  </button>
                  {isFilterOpen && (
                    <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-4">
                      <h4 className="text-sm font-semibold text-gray-900 mb-3">Filter Requests</h4>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
                          <select 
                            value={tempStatusFilter}
                            onChange={(e) => setTempStatusFilter(e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 outline-none focus:border-yellow-400 focus:bg-white transition-all"
                          >
                            <option value="all">All Statuses</option>
                            <option value="completed">Completed</option>
                            <option value="cancelled">Cancelled</option>
                            <option value="ongoing">Ongoing</option>
                          </select>
                        </div>
                        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                          <button 
                            onClick={() => setIsFilterOpen(false)} 
                            className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors"
                          >
                            Cancel
                          </button>
                          <button 
                            onClick={() => { setStatusFilter(tempStatusFilter); setCurrentPage(1); setIsFilterOpen(false); }} 
                            className="px-3 py-1.5 text-xs font-semibold bg-black text-white rounded-lg hover:bg-gray-900 transition-colors"
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* TABLE */}
              <div className="overflow-x-auto">
                <table className="w-full text-left whitespace-nowrap">
                  <thead>
                    <tr className="bg-gray-50 text-xs font-semibold text-gray-600 border-b border-gray-200">
                      <th className="px-4 py-3">Request Id</th>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">User Name</th>
                      <th className="px-4 py-3">Driver Name</th>
                      <th className="px-4 py-3">Trip Status</th>
                      <th className="px-4 py-3">Paid</th>
                      <th className="px-4 py-3">Payment Option</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paginatedRequests.length > 0 ? paginatedRequests.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-50 transition-colors text-sm">
                        <td className="px-4 py-3 font-medium text-gray-600">#{String(r.id).slice(-8).toUpperCase()}</td>
                        <td className="px-4 py-3 text-gray-600">{r.date}</td>
                        <td className="px-4 py-3 font-semibold text-gray-900">{r.user}</td>
                        <td className="px-4 py-3 font-semibold text-gray-900">{r.driver}</td>
                        <td className="px-4 py-3">
                          <span className={`font-semibold ${
                            r.status === 'Completed' ? 'text-emerald-600' : 
                            r.status === 'Cancelled' ? 'text-rose-600' : 'text-yellow-600'
                          }`}>{r.status}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{r.paid}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${r.payment === 'CASH' ? 'bg-gray-100 text-gray-700' : 'bg-yellow-100 text-yellow-800'}`}>
                            {r.payment}
                          </span>
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan="7" className="px-4 py-8 text-center text-gray-500 font-medium text-sm">
                          <div className="flex flex-col items-center gap-2">
                            <Car size={24} className="text-gray-300" />
                            No requests found for this user
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* PAGINATION */}
              <div className="p-4 border-t border-gray-100 flex items-center justify-between bg-white">
                <p className="text-xs font-medium text-gray-500">
                  Showing {filteredRequests.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} to {Math.min(currentPage * pageSize, filteredRequests.length)} of {filteredRequests.length} entries
                </p>
                <div className="flex items-center gap-1">
                  <button 
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-50 transition-colors"
                  >
                    Prev
                  </button>
                  <span className="w-7 h-7 rounded-lg bg-black text-white text-xs font-semibold flex items-center justify-center">
                    {currentPage}
                  </span>
                  <button 
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-50 transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'User Payment History' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            {/* PAYMENT SUMMARY */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {[
                { label: 'Total Credited', val: user.wallet.total, icon: WalletIcon, color: 'blue' },
                { label: 'Total Debited', val: user.wallet.spend, icon: TrendingUp, color: 'rose' },
                { label: 'Available Balance', val: user.wallet.balance, icon: WalletIcon, color: 'emerald' }
              ].map((s, i) => (
                <div key={i} className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-center">
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className="p-1.5 bg-gray-50 rounded-lg border border-gray-100 text-gray-600">
                      <s.icon size={16} />
                    </div>
                    <p className="text-xs font-medium text-gray-500">{s.label}</p>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">₹ {Number(s.val || 0).toFixed(2)}</p>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              {/* HEADER */}
              <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3 items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Recent Transactions</h3>
              </div>

              {/* TRANSACTION LOGS */}
              <div className="p-4">
                <div className="space-y-3">
                  {walletHistory.length > 0 ? (
                    walletHistory.map((tr, i) => (
                      <div key={i} className="bg-gray-50 rounded-lg border border-gray-100 p-4 flex items-center justify-between hover:bg-white hover:border-gray-300 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${tr.type === 'credit' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                            {tr.type === 'credit' ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-gray-900 capitalize leading-tight">{tr.remarks}</p>
                            <p className="text-xs font-medium text-gray-500 mt-1">{tr.date}</p>
                          </div>
                        </div>
                        <p className={`text-base font-bold ${tr.type === 'credit' ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {tr.type === 'credit' ? '+' : '-'} ₹{parseFloat(tr.amount).toFixed(2)}
                        </p>
                      </div>
                    ))
                  ) : (
                    <div className="py-8 flex flex-col items-center justify-center text-center">
                      <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center text-gray-300 mb-3">
                        <HistoryIcon size={24} />
                      </div>
                      <p className="text-sm font-medium text-gray-500">No recent wallet transactions found</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Review History' && (
          <div className="space-y-4 animate-in fade-in duration-300 bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-6">
            <div className="flex flex-wrap gap-4 items-center justify-between pb-4 border-b border-gray-100 mb-4">
              <h3 className="text-sm font-semibold text-gray-900">Captain Reviews</h3>
              {reviews.length > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-50 text-yellow-800 border border-yellow-200 rounded-full text-xs font-semibold">
                  <Star size={14} className="fill-yellow-500 text-yellow-500" /> {(reviews.reduce((acc, curr) => acc + curr.rating, 0) / (reviews.length || 1)).toFixed(1)} Avg Rating
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {reviews.length > 0 ? (
                reviews.map((rev, i) => (
                  <div key={rev._id || i} className="bg-gray-50 rounded-xl border border-gray-100 p-4 flex flex-col hover:bg-white hover:border-gray-200 transition-colors shadow-sm">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-600 shrink-0">
                          {rev.driver_id?.name?.charAt(0) || 'C'}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-gray-900 leading-tight">Captain {rev.driver_id?.name || 'Unknown'}</p>
                          <span className="text-[10px] font-medium text-gray-500">{rev.createdAt ? new Date(rev.createdAt).toLocaleDateString() : 'N/A'}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5">
                        {[...Array(5)].map((_, starIdx) => (
                          <Star 
                            key={starIdx} 
                            size={12} 
                            className={starIdx < rev.rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}
                          />
                        ))}
                      </div>
                    </div>
                    <p className="text-sm text-gray-700 italic border-l-2 border-gray-200 pl-3 py-1 text-wrap line-clamp-3">
                      "{rev.comment || 'No comment provided'}"
                    </p>
                  </div>
                ))
              ) : (
                <div className="col-span-full py-12 flex flex-col items-center justify-center text-center">
                  <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center text-gray-300 mb-3">
                    <Star size={24} />
                  </div>
                  <p className="text-sm font-medium text-gray-500">No reviews found for this user</p>
                </div>
              )}
            </div>
          </div>
        )}

      </div>

    </div>
  );
};

const WalletIcon = ({ size, className }) => <CreditCard size={size} className={className} />;

export default UserDetails;
