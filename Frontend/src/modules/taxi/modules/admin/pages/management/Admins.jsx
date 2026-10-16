import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  ChevronRight,
  Crown,
  FileSearch,
  Loader2,
  Pencil,
  Plus,
  Search,
  Shield,
  Trash2,
  UserCheck,
  Users,
  Building2,
  MoreVertical,
  Edit2,
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
  RefreshCw,
  Download,
  Upload,
  Activity,
  AlertTriangle,
  UserMinus,
  Lock,
  CheckCircle,
  Eye,
  KeyRound,
  X,
  Sparkles,
  Info,
  Calendar,
  Clock,
  Laptop,
  Check,
  FileText,
  Key
} from 'lucide-react';
import { useNavigate } from '@taxi/shared/router';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { adminService } from '../../services/adminService';
import { createPortal } from 'react-dom';
import { buildMenuPermissionTree, expandMenuPermissions, menuKeysForAdmin } from '../../constants/adminAccess';
import AdminAccountForm from './AdminAccountForm';

const BAR_COLORS = ['bg-[#16A34A]', 'bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-pink-500', 'bg-slate-400'];

const Admins = () => {
  const navigate = useNavigate();
  
  // Data State
  const [admins, setAdmins] = useState([]);
  // Counted on the server from recorded sign-ins and admin changes. Null
  // until it loads, or if the request fails - the page then says so rather
  // than showing invented figures.
  const [activity, setActivity] = useState(null);
  const [serviceLocations, setServiceLocations] = useState([]);
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Search, Filters & Sorting State
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('All');
  const [filterDepartment, setFilterDepartment] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterMfa, setFilterMfa] = useState('All');
  const [filterVerification, setFilterVerification] = useState('All');
  const [sortBy, setSortBy] = useState('Newest');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Timeline Filter State
  const [growthFilter, setGrowthFilter] = useState('Last 12 Months');

  // Chart hover states
  const [hoveredGrowthIndex, setHoveredGrowthIndex] = useState(null);
  const [hoveredDonutSegment, setHoveredDonutSegment] = useState(null);

  // Drawer / Modal States
  const [selectedAdmin, setSelectedAdmin] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [popoverAnchor, setPopoverAnchor] = useState(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);
  const popoverRef = useRef(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deletingAdmin, setDeletingAdmin] = useState(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [activeTab, setActiveTab] = useState('details'); // details, permissions, activity

  // Selected row checkboxes
  const [selectedRowIds, setSelectedRowIds] = useState([]);

  // Form State (for Create / Edit)
  const initialFormState = {
    name: '',
    email: '',
    phone: '',
    role: 'Operations Subadmin',
    admin_type: 'subadmin',
    permissions: [],
    service_location_ids: [],
    zone_ids: [],
    password: '',
    passwordConfirmation: '',
    active: true,
    employeeId: '',
    department: 'Operations',
    designation: 'Subadmin Officer',
    notes: '',
    mfaEnabled: false
  };

  const [form, setForm] = useState(initialFormState);

  // Load Initial Data
  const loadData = async () => {
    setLoading(true);
    try {
      const [adminsResponse, locationsResponse, zonesResponse, activityResponse] = await Promise.all([
        adminService.getAdmins(),
        adminService.getServiceLocations().catch(() => ({ data: [] })),
        adminService.getZones().catch(() => ({ data: { results: [] } })),
        adminService.getAdminActivitySummary().catch(() => null),
      ]);

      setActivity(activityResponse?.data?.data || activityResponse?.data || null);

      setAdmins(Array.isArray(adminsResponse?.data?.results) ? adminsResponse.data.results : []);
      
      const locData = Array.isArray(locationsResponse?.data)
        ? locationsResponse.data
        : locationsResponse?.data?.results || [];
      setServiceLocations(locData);

      const zoneData = Array.isArray(zonesResponse?.data?.results)
        ? zonesResponse.data.results
        : zonesResponse?.data || [];
      setZones(zoneData);
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || 'Unable to load administration data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Escape key listener to close details
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsDrawerOpen(false);
        setSelectedAdmin(null);
      }
    };
    if (isDrawerOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDrawerOpen]);

  // Filter & Sort Logic
  const filteredAndSortedAdmins = useMemo(() => {
    let result = [...admins];

    // Search query
    const query = searchTerm.trim().toLowerCase();
    if (query) {
      result = result.filter((item) =>
        [
          item.name,
          item.email,
          item.phone,
          item.employeeId,
          item.role,
          item.admin_type,
          item.department,
          item.designation
        ].some((val) => String(val || '').toLowerCase().includes(query))
      );
    }

    // Role filter
    if (filterRole !== 'All') {
      result = result.filter((item) => {
        if (filterRole === 'Super Admin') return item.admin_type === 'superadmin';
        return item.role === filterRole;
      });
    }

    // Department filter
    if (filterDepartment !== 'All') {
      result = result.filter((item) => {
        const dept = item.department || 'Operations';
        return dept.toLowerCase() === filterDepartment.toLowerCase();
      });
    }

    // Status filter
    if (filterStatus !== 'All') {
      result = result.filter((item) => {
        const isActive = item.active !== false;
        if (filterStatus === 'Active') return isActive;
        return !isActive;
      });
    }

    // MFA filter
    if (filterMfa !== 'All') {
      result = result.filter((item) => {
        const hasMfa = item.mfaEnabled || false;
        return filterMfa === 'Enabled' ? hasMfa : !hasMfa;
      });
    }

    // Verification filter
    if (filterVerification !== 'All') {
      result = result.filter((item) => {
        const isVerified = item.active !== false; // derived status
        return filterVerification === 'Verified' ? isVerified : !isVerified;
      });
    }

    // Sorting
    result.sort((a, b) => {
      if (sortBy === 'Newest') {
        return new Date(b.createdAt || b.created_at || 0) - new Date(a.createdAt || a.created_at || 0);
      }
      if (sortBy === 'Oldest') {
        return new Date(a.createdAt || a.created_at || 0) - new Date(b.createdAt || b.created_at || 0);
      }
      if (sortBy === 'Alphabetical') {
        return String(a.name || '').localeCompare(String(b.name || ''));
      }
      if (sortBy === 'Last Login') {
        return new Date(b.lastLogin || 0) - new Date(a.lastLogin || 0);
      }
      if (sortBy === 'Role') {
        return String(a.admin_type || '').localeCompare(String(b.admin_type || ''));
      }
      return 0;
    });

    return result;
  }, [admins, searchTerm, filterRole, filterDepartment, filterStatus, filterMfa, filterVerification, sortBy]);

  // Executive Stats calculations
  const stats = useMemo(() => {
    const total = admins.length;
    const superadmins = admins.filter((item) => item.admin_type === 'superadmin').length;
    const subadmins = admins.filter((item) => item.admin_type === 'subadmin').length;
    const active = admins.filter((item) => item.active !== false).length;
    const offline = total - active;
    const mfaEnabled = admins.filter((item) => item.mfaEnabled).length;
    const suspended = admins.filter((item) => item.active === false).length;
    const locked = admins.filter((item) => item.locked).length;

    return {
      total,
      superadmins,
      subadmins,
      active,
      offline,
      mfaEnabled,
      suspended,
      locked
    };
  }, [admins]);

  // Real figures for the cards and panels, from the activity summary.
  const recorded = useMemo(() => {
    const cur = activity?.last30Days || {};
    const prev = activity?.previous30Days || {};
    const versus = (now, before) => {
      if (!activity) return 'Not available';
      const diff = (now || 0) - (before || 0);
      if (diff === 0) return 'Same as previous 30 days';
      return `${diff > 0 ? '↑' : '↓'} ${Math.abs(diff)} vs previous 30 days`;
    };
    const signIns = (cur.loginSuccess || 0) + (cur.loginFailed || 0);
    const lastSignIn = activity?.lastSignInByAdmin || {};
    const neverSignedIn = admins.filter((a) => !lastSignIn[String(a.id || a._id)]).length;

    return {
      available: Boolean(activity),
      rate: cur.loginSuccessRate,
      rateLabel: cur.loginSuccessRate === null || cur.loginSuccessRate === undefined ? '—' : `${cur.loginSuccessRate}%`,
      signInsText: signIns > 0 ? `${cur.loginSuccess} of ${signIns} sign-ins, 30 days` : 'No sign-ins recorded yet',
      signedInToday: activity?.signedInLast24h ?? 0,
      // From each account's creation date, which goes back further than the
      // activity record does.
      created30: admins.filter((a) => {
        const at = new Date(a.createdAt || a.created_at || 0).getTime();
        return at > Date.now() - 30 * 24 * 60 * 60 * 1000;
      }).length,
      resets30: cur.passwordResets || 0,
      resetsTrend: versus(cur.passwordResets, prev.passwordResets),
      permissionChanges30: cur.permissionChanges || 0,
      permissionTrend: versus(cur.permissionChanges, prev.permissionChanges),
      suspended30: cur.suspended || 0,
      failed7d: activity?.failedLoginsLast7d ?? 0,
      neverSignedIn,
      trackingSince: activity?.trackingSince ? new Date(activity.trackingSince) : null,
      recent: activity?.recent || [],
      lastSignIn,
    };
  }, [activity, admins]);

  // Roles as they are actually set on the accounts. This panel used to list
  // six made-up departments with made-up head counts.
  const roleCounts = useMemo(() => {
    const counts = {};
    admins.forEach((admin) => {
      const role = admin.admin_type === 'superadmin' ? 'Super Admin' : String(admin.role || 'Sub-admin').trim() || 'Sub-admin';
      counts[role] = (counts[role] || 0) + 1;
    });
    const max = Math.max(1, ...Object.values(counts));
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, count], i) => ({ label, count, percent: Math.round((count / max) * 100), color: BAR_COLORS[i % BAR_COLORS.length] }));
  }, [admins]);

  // How many sub-admins can open each sidebar menu - previously fixed
  // percentages. Super admins are left out: they can open everything.
  const moduleAccess = useMemo(() => {
    const subs = admins.filter((a) => a.admin_type !== 'superadmin');
    if (subs.length === 0) return [];
    const keysByAdmin = subs.map((a) => new Set(menuKeysForAdmin(a.permissions || [])));
    return buildMenuPermissionTree()
      .flatMap((section) => section.groups)
      .map((group) => {
        const withAccess = keysByAdmin.filter((keys) => group.leaves.some((leaf) => keys.has(leaf.key))).length;
        return { label: group.label, percent: Math.round((withAccess / subs.length) * 100), count: withAccess };
      })
      .filter((row) => row.count > 0)
      .sort((a, b) => b.percent - a.percent)
      .slice(0, 6)
      .map((row, i) => ({ ...row, color: BAR_COLORS[i % BAR_COLORS.length] }));
  }, [admins]);

  const describeActivity = (row) => {
    const who = row.actorName || row.email || 'Someone';
    const whom = row.targetName || row.email || 'an admin';
    switch (row.type) {
      case 'login_success': return { title: who, desc: 'Signed in' };
      case 'login_failed': return { title: row.email || who, desc: 'Failed sign-in attempt' };
      case 'password_reset': return { title: who, desc: 'Reset their password' };
      case 'admin_created': return { title: who, desc: `Created admin ${whom}` };
      case 'permissions_changed': return { title: who, desc: `Changed menu access for ${whom}` };
      case 'admin_suspended': return { title: who, desc: `Suspended ${whom}` };
      case 'admin_reactivated': return { title: who, desc: `Reactivated ${whom}` };
      case 'admin_deleted': return { title: who, desc: `Deleted admin ${whom}` };
      default: return { title: who, desc: `Updated ${whom}` };
    }
  };

  const timeAgo = (at) => {
    const seconds = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 1000));
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
    return new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  // Role distribution calculation for donut chart
  const roleDistribution = useMemo(() => {
    if (admins.length === 0) return [];

    const counts = {
      'Super Admin': 0,
      'Operations': 0,
      'Finance': 0,
      'Support': 0,
      'Others': 0
    };

    admins.forEach((admin) => {
      if (admin.admin_type === 'superadmin') {
        counts['Super Admin']++;
      } else {
        const role = String(admin.role || '').toLowerCase();
        if (role.includes('operation')) counts['Operations']++;
        else if (role.includes('finance') || role.includes('billing')) counts['Finance']++;
        else if (role.includes('support') || role.includes('staff')) counts['Support']++;
        else counts['Others']++;
      }
    });

    const colors = {
      'Super Admin': '#16A34A',
      'Operations': '#3B82F6',
      'Finance': '#10B981',
      'Support': '#66EC97',
      'Others': '#6B7280'
    };

    const totalCount = admins.length;
    return Object.keys(counts).map((key) => ({
      label: key,
      value: counts[key],
      percentage: totalCount > 0 ? Math.round((counts[key] / totalCount) * 1000) / 10 : 0,
      color: colors[key]
    })).filter(item => item.value > 0);
  }, [admins]);

  // Historical Growth calculation
  const growthData = useMemo(() => {
    if (admins.length === 0) return [];

    // Generate last 12 months list
    const months = [];
    const countMonths = growthFilter === 'Last 12 Months' ? 12 : 6;
    for (let i = countMonths - 1; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      months.push({
        name: d.toLocaleString('default', { month: 'short' }),
        count: 0
      });
    }

    admins.forEach((admin) => {
      const dateStr = admin.createdAt || admin.created_at;
      if (!dateStr) return;
      const createdDate = new Date(dateStr);
      const diffMonths = (new Date().getFullYear() - createdDate.getFullYear()) * 12 + new Date().getMonth() - createdDate.getMonth();
      if (diffMonths >= 0 && diffMonths < countMonths) {
        months[(countMonths - 1) - diffMonths].count++;
      }
    });

    let sum = admins.length - admins.filter(a => {
      const dateStr = a.createdAt || a.created_at;
      if (!dateStr) return false;
      const createdDate = new Date(dateStr);
      const diffMonths = (new Date().getFullYear() - createdDate.getFullYear()) * 12 + new Date().getMonth() - createdDate.getMonth();
      return diffMonths < countMonths;
    }).length;

    return months.map(m => {
      sum += m.count;
      return {
        month: m.name,
        total: sum
      };
    });
  }, [admins, growthFilter]);



  // Checkbox handlers
  const handleSelectAllRows = (e) => {
    if (e.target.checked) {
      setSelectedRowIds(filteredAndSortedAdmins.map(a => a.id || a._id));
    } else {
      setSelectedRowIds([]);
    }
  };

  const handleSelectRow = (id, checked) => {
    setSelectedRowIds(prev =>
      checked ? [...prev, id] : prev.filter(item => item !== id)
    );
  };

  // Handle Create Submit
  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      toast.error('Name and email are required');
      return;
    }
    if (!form.password) {
      toast.error('Password is required for new accounts');
      return;
    }
    if (form.password !== form.passwordConfirmation) {
      toast.error('Passwords do not match');
      return;
    }
    if (form.password.length < 5) {
      toast.error('Password must be at least 5 characters');
      return;
    }
    // The backend refuses both of these; say so here instead of after the
    // round trip with a vaguer message.
    if (form.admin_type !== 'superadmin' && form.permissions.length === 0) {
      toast.error('Tick at least one menu this admin can access');
      return;
    }
    if (form.admin_type !== 'superadmin' && form.service_location_ids.length === 0) {
      toast.error('Choose at least one service location');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        role: form.admin_type === 'superadmin' ? 'superadmin' : form.role,
        admin_type: form.admin_type,
        // Menu keys plus the API permission each menu's page needs.
        permissions: form.admin_type === 'superadmin' ? ['*'] : expandMenuPermissions(form.permissions),
        service_location_ids: form.service_location_ids,
        zone_ids: form.zone_ids,
        password: form.password,
        // The backend rejects a new account without this, and the page never
        // sent it - every admin creation failed with "Passwords do not match".
        password_confirmation: form.passwordConfirmation,
        active: form.active,
        employeeId: form.employeeId,
        department: form.department,
        designation: form.designation,
        notes: form.notes,
        mfaEnabled: form.mfaEnabled
      };

      await adminService.createAdminAccount(payload);
      toast.success('Administrator created successfully');
      setIsCreateOpen(false);
      loadData();
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Creation failed');
    } finally {
      setSaving(false);
    }
  };

  // Handle Edit Click
  const handleEditClick = (admin) => {
    window.dispatchEvent(new Event('admin:closeDropdowns'));
    setIsDrawerOpen(false); // Close details drawer if open
    setForm({
      id: admin.id || admin._id,
      name: admin.name || '',
      email: admin.email || '',
      phone: admin.phone || '',
      role: admin.role || 'Operations Subadmin',
      admin_type: admin.admin_type || 'subadmin',
      permissions: admin.admin_type === 'superadmin' ? [] : menuKeysForAdmin(admin.permissions || []),
      service_location_ids: (admin.service_location_ids || []).map(String),
      zone_ids: (admin.zone_ids || []).map(String),
      password: '',
      passwordConfirmation: '',
      active: admin.active !== false,
      employeeId: admin.employeeId || '',
      department: admin.department || 'Operations',
      designation: admin.designation || 'Subadmin Officer',
      notes: admin.notes || '',
      mfaEnabled: admin.mfaEnabled || false
    });
    setIsEditOpen(true);
  };

  // Handle Edit Submit
  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      toast.error('Name and email are required');
      return;
    }
    if (form.password && form.password !== form.passwordConfirmation) {
      toast.error('Passwords do not match');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        role: form.admin_type === 'superadmin' ? 'superadmin' : form.role,
        admin_type: form.admin_type,
        permissions: form.admin_type === 'superadmin' ? ['*'] : expandMenuPermissions(form.permissions),
        service_location_ids: form.service_location_ids,
        zone_ids: form.zone_ids,
        active: form.active,
        employeeId: form.employeeId,
        department: form.department,
        designation: form.designation,
        notes: form.notes,
        mfaEnabled: form.mfaEnabled
      };

      if (form.password) {
        payload.password = form.password;
        payload.password_confirmation = form.passwordConfirmation;
      }

      await adminService.updateAdminAccount(form.id, payload);
      toast.success('Administrator profile updated successfully');
      setIsEditOpen(false);
      loadData();
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  // Handle Delete Confirmation
  const handleDeleteConfirm = async () => {
    if (deleteConfirmText !== 'DELETE') {
      toast.error('Please type DELETE to confirm');
      return;
    }

    setSaving(true);
    try {
      const id = deletingAdmin.id || deletingAdmin._id;
      await adminService.deleteAdminAccount(id);
      toast.success('Admin deleted successfully');
      setIsDeleteOpen(false);
      setDeletingAdmin(null);
      setDeleteConfirmText('');
      loadData();
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Delete failed');
    } finally {
      setSaving(false);
    }
  };

  // Handle Export CSV
  const handleExport = () => {
    const headers = 'Name,Email,Phone,Role,Type,Active,MFA,Created Date\n';
    const rows = admins.map(
      (admin) =>
        `"${admin.name}","${admin.email}","${admin.phone}","${admin.role}","${admin.admin_type}",${admin.active !== false},${admin.mfaEnabled || false},"${admin.createdAt || admin.created_at || ''}"`
    ).join('\n');
    
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('download', `Administrators_${new Date().toISOString().split('T')[0]}.csv`);
    a.click();
    toast.success('Exported administration logs');
  };

  // Custom SVG line calculations
  const chartWidth = 500;
  const chartHeight = 150;
  const growthPoints = useMemo(() => {
    if (growthData.length === 0) return [];
    const maxVal = Math.max(...growthData.map(d => d.total), 5);
    return growthData.map((d, i) => {
      const x = (i / (growthData.length - 1)) * chartWidth;
      const y = chartHeight - (d.total / maxVal) * (chartHeight - 30) - 15;
      return { x, y, label: d.month, value: d.total };
    });
  }, [growthData]);

  const linePath = useMemo(() => {
    if (growthPoints.length === 0) return '';
    return 'M ' + growthPoints.map(p => `${p.x} ${p.y}`).join(' L ');
  }, [growthPoints]);

  const areaPath = useMemo(() => {
    if (growthPoints.length === 0) return '';
    return `${linePath} L ${chartWidth} ${chartHeight} L 0 ${chartHeight} Z`;
  }, [growthPoints, linePath]);

  // Donut calculations
  const donutRadius = 30;
  const donutCircumference = 2 * Math.PI * donutRadius;
  const donutSegments = useMemo(() => {
    const totalVal = roleDistribution.reduce((acc, curr) => acc + curr.value, 0);
    let accumulatedAngle = 0;
    return roleDistribution.map((r) => {
      const percentage = totalVal > 0 ? r.value / totalVal : 0;
      const strokeDasharray = `${percentage * donutCircumference} ${donutCircumference}`;
      const strokeDashoffset = -accumulatedAngle;
      accumulatedAngle += percentage * donutCircumference;
      return {
        ...r,
        strokeDasharray,
        strokeDashoffset,
        percentage: Math.round(percentage * 100)
      };
    });
  }, [roleDistribution, donutCircumference]);

  return (
    <div className="min-h-screen bg-[#F6F8FC] p-6 lg:p-8 font-sans redigo-admin-root animate-in fade-in duration-300">
      <div className="mx-auto max-w-7xl space-y-6">
        
        {/* HEADER SECTION */}
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
        >
          <div>
            <div className="flex items-center gap-1.5 mb-1.5 text-[9px] font-medium uppercase tracking-wider text-slate-500">
              <span>Management</span>
              <span className="text-slate-300">/</span>
              <span className="text-slate-700">Access Center</span>
            </div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-[#0B1220] tracking-tight">Admin Control Center</h1>
              <span className="bg-[#16A34A]/20 text-[#0B1220] text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-[#16A34A]/40">
                Hub
              </span>
            </div>
            <p className="text-xs text-[#64748B] mt-1 max-w-2xl leading-relaxed">
              Manage administrators, permissions, platform access, roles and cryptographic security logs.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={loadData}
              className="admin-btn-secondary h-10 w-10 !p-0"
              title="Refresh Registry"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={handleExport}
              className="admin-btn-secondary h-10 gap-2"
            >
              <Download size={14} />
              <span>Export CSV</span>
            </button>
            <button
              onClick={() => {
                window.dispatchEvent(new Event('admin:closeDropdowns'));
                setForm(initialFormState);
                setIsCreateOpen(true);
              }}
              className="admin-btn-primary h-10 gap-2 !bg-[#16A34A] !text-[#0B1220] hover:brightness-95"
            >
              <Plus size={16} />
              <span>Create Admin</span>
            </button>
          </div>
        </motion.div>

        {/* KPI CARDS ROW */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Total Admins", value: stats.total, icon: Users, cardBg: "!bg-violet-500", trend: `${recorded.created30} added in last 30 days`, isTrendPositive: true },
            { label: "Login Success Rate", value: recorded.rateLabel, icon: CheckCircle, cardBg: "!bg-emerald-500", trend: recorded.signInsText, isTrendPositive: true },
            { label: "Signed In Today", value: recorded.signedInToday, icon: Laptop, cardBg: "!bg-blue-500", trend: `${stats.active} active accounts`, isTrendPositive: true },
            { label: "Password Resets", value: recorded.resets30, icon: KeyRound, cardBg: "!bg-fuchsia-500", trend: recorded.resetsTrend, isTrendPositive: false },
            { label: "Permission Changes", value: recorded.permissionChanges30, icon: Info, cardBg: "!bg-green-500", trend: recorded.permissionTrend, isTrendPositive: true },
            { label: "Suspended", value: stats.suspended, icon: UserMinus, cardBg: "!bg-rose-500", trend: `${recorded.suspended30} suspended in last 30 days`, isTrendPositive: false }
          ].map((insight, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: idx * 0.04 }}
              className={`admin-card !p-4 border-none !text-white hover:scale-[1.02] transition-transform shadow-lg ${insight.cardBg}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="card-label text-[10px] font-bold opacity-80 uppercase tracking-wider">{insight.label}</span>
                <div className="p-2 rounded-full bg-white/20 backdrop-blur-sm">
                  <insight.icon size={16} strokeWidth={2.5} />
                </div>
              </div>
              <h3 className="text-2xl font-black !text-white tracking-tight drop-shadow-sm">{insight.value}</h3>
              <p className="text-[10px] mt-2 font-semibold opacity-80">
                {insight.trend}
              </p>
            </motion.div>
          ))}
        </div>

        {/* MAIN ANALYTICS ROW (Growth, Role Distribution, Security) */}
        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.12 }}
          className="grid grid-cols-1 gap-6 lg:grid-cols-4"
        >
          {/* Historical Admin Growth */}
          <div className="admin-card lg:col-span-2 flex flex-col justify-between hover:shadow-md transition-shadow relative">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs text-[#0B1220] uppercase tracking-wider font-bold">Historical Admin Growth</h3>
                  <div className="h-1.5 w-1.5 rounded-full bg-[#16A34A]" />
                </div>
                <select
                  value={growthFilter}
                  onChange={(e) => setGrowthFilter(e.target.value)}
                  className="admin-input h-7 !py-0 !px-2 !w-32 text-[10px] font-bold"
                >
                  <option value="Last 6 Months">Last 6 Months</option>
                  <option value="Last 12 Months">Last 12 Months</option>
                </select>
              </div>
              <p className="text-[11px] text-[#64748B] mb-4">Cumulative administrative registration curve.</p>
            </div>

            {/* Area SVG Chart */}
            {growthData.length === 0 ? (
              <div className="h-[150px] flex flex-col items-center justify-center border border-dashed border-[#E5E7EB] rounded-2xl bg-slate-50/50 p-4 my-2">
                <p className="text-sm font-semibold text-[#0B1220] whitespace-normal text-center">No historical data available</p>
                <p className="text-[10px] text-[#64748B] mt-1 whitespace-normal text-center">Growth telemetry will automatically sync here.</p>
              </div>
            ) : (
              <>
                <div className="relative pt-2">
                  <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full overflow-visible">
                    {/* Horizontal grid lines */}
                    {[0, 1, 2, 3].map((g, i) => (
                      <line
                        key={i}
                        x1="0"
                        y1={(chartHeight / 3) * g}
                        x2={chartWidth}
                        y2={(chartHeight / 3) * g}
                        stroke="#F1F5F9"
                        strokeWidth="1"
                      />
                    ))}

                    {/* Shimmer Area Fill */}
                    <path d={areaPath} fill="rgba(28, 227, 101, 0.05)" />
                    {/* Area Outline */}
                    <path d={linePath} fill="none" stroke="#16A34A" strokeWidth="2.5" />

                    {/* Nodes */}
                    {growthPoints.map((pt, idx) => (
                      <circle
                        key={idx}
                        cx={pt.x}
                        cy={pt.y}
                        r={hoveredGrowthIndex === idx ? 6 : 4}
                        fill={hoveredGrowthIndex === idx ? '#16A34A' : '#FFFFFF'}
                        stroke="#16A34A"
                        strokeWidth="2"
                        className="cursor-pointer transition-all"
                        onMouseEnter={() => setHoveredGrowthIndex(idx)}
                        onMouseLeave={() => setHoveredGrowthIndex(null)}
                      />
                    ))}
                  </svg>

                  {/* Tooltip */}
                  {hoveredGrowthIndex !== null && growthPoints[hoveredGrowthIndex] && (
                    <div
                      className="absolute bg-slate-900 !text-white rounded p-2.5 text-[10px] pointer-events-none shadow-xl border border-slate-800 animate-in fade-in duration-200"
                      style={{
                        left: `${(growthPoints[hoveredGrowthIndex].x / chartWidth) * 100}%`,
                        top: `${(growthPoints[hoveredGrowthIndex].y / chartHeight) * 100 - 40}%`,
                        transform: 'translateX(-50%)',
                      }}
                    >
                      <span className="font-semibold block">{growthPoints[hoveredGrowthIndex].label} 2026</span>
                      <span className="block mt-0.5">Admins Added: {growthPoints[hoveredGrowthIndex].value}</span>
                    </div>
                  )}
                </div>

                {/* Bottom Labels */}
                <div className="flex justify-between text-[9px] text-[#64748B] pt-3 border-t border-[#E5E7EB] mt-3">
                  {growthData.map((d, i) => (
                    <span key={i}>{d.month}</span>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Role Distribution */}
          <div className="admin-card flex flex-col justify-between hover:shadow-md transition-shadow">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-xs text-[#0B1220] uppercase tracking-wider font-bold">Role Distribution</h3>
                <div className="h-1.5 w-1.5 rounded-full bg-[#3B82F6]" />
              </div>
              <p className="text-[11px] text-[#64748B] mb-4">Distribution by access class.</p>
            </div>

            {/* Donut SVG */}
            {roleDistribution.length === 0 ? (
              <div className="h-[150px] flex flex-col items-center justify-center border border-dashed border-[#E5E7EB] rounded-2xl bg-slate-50/50 p-4 my-2">
                <p className="text-xs font-semibold text-[#0B1220] modal-title !text-sm">No historical data available</p>
                <p className="text-[10px] text-[#64748B] mt-1">Role distribution metrics will automatically sync here.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-center relative py-1">
                  <svg width="110" height="110" viewBox="0 0 100 100" className="transform -rotate-90">
                    {donutSegments.map((seg, i) => (
                      <circle
                        key={i}
                        cx="50"
                        cy="50"
                        r={donutRadius}
                        fill="transparent"
                        stroke={seg.color}
                        strokeWidth="9"
                        strokeDasharray={seg.strokeDasharray}
                        strokeDashoffset={seg.strokeDashoffset}
                        className="cursor-pointer transition-all hover:stroke-[11px]"
                        onMouseEnter={() => setHoveredDonutSegment(seg)}
                        onMouseLeave={() => setHoveredDonutSegment(null)}
                      />
                    ))}
                  </svg>

                  {/* Center count */}
                  <div className="absolute text-center">
                    <span className="text-[8px] text-[#64748B] uppercase tracking-wider block">
                      {hoveredDonutSegment ? hoveredDonutSegment.label : 'TOTAL'}
                    </span>
                    <span className="text-base font-bold text-[#0B1220] block leading-none mt-0.5">
                      {hoveredDonutSegment ? `${hoveredDonutSegment.percentage}%` : stats.total}
                    </span>
                  </div>
                </div>

                {/* Donut Legend */}
                <div className="space-y-1.5 pt-3 border-t border-[#E5E7EB] mt-3">
                  {donutSegments.map((seg, i) => (
                    <div key={i} className="flex items-center justify-between text-[10px] text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: seg.color }} />
                        <span className="truncate">{seg.label}</span>
                      </div>
                      <span className="font-semibold text-[#0B1220]">{seg.value} ({seg.percentage}%)</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Security Health */}
          <div className="admin-card flex flex-col justify-between hover:shadow-md transition-shadow">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-xs text-[#0B1220] uppercase tracking-wider font-bold">Security Health</h3>
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </div>
              <p className="text-[11px] text-[#64748B] mb-3">
                Sign-in success, last 30 days{recorded.trackingSince ? ` (recorded since ${recorded.trackingSince.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})` : ''}.
              </p>
            </div>

            {/* Gauge */}
            <div className="flex items-center justify-center relative py-2">
              <svg className="w-20 h-20 transform -rotate-90">
                <circle cx="40" cy="40" r="33" stroke="#E5E7EB" strokeWidth="5" fill="transparent" />
                <circle cx="40" cy="40" r="33" stroke="#22C55E" strokeWidth="5" fill="transparent"
                  strokeDasharray={207.2}
                  strokeDashoffset={207.2 - (207.2 * (recorded.rate ?? 0)) / 100}
                />
              </svg>
              <div className="absolute text-center">
                <span className="text-sm font-bold text-[#0B1220] block leading-none">{recorded.rateLabel}</span>
                <span className="text-[8px] text-slate-500 font-bold block mt-0.5">Sign-ins</span>
              </div>
            </div>

            {/* Metrics List */}
            <div className="space-y-1.5 text-[10px] text-slate-600 pt-2.5 border-t border-[#E5E7EB] mt-2">
              <div className="flex justify-between">
                <span className="flex items-center gap-1"><Lock size={10} className="text-[#64748B]" /> Super admins</span>
                <span className="font-semibold text-[#0B1220]">{stats.superadmins} / {stats.total}</span>
              </div>
              <div className="flex justify-between">
                <span className="flex items-center gap-1"><AlertTriangle size={10} className="text-[#64748B]" /> Suspended accounts</span>
                <span className="font-semibold text-[#0B1220]">{stats.suspended}</span>
              </div>
              <div className="flex justify-between">
                <span className="flex items-center gap-1"><ShieldCheck size={10} className="text-[#64748B]" /> Failed sign-ins (7 days)</span>
                <span className="font-semibold text-[#0B1220]">{recorded.failed7d}</span>
              </div>
              <div className="flex justify-between">
                <span className="flex items-center gap-1"><Clock size={10} className="text-[#64748B]" /> No sign-in recorded</span>
                <span className="font-semibold text-[#0B1220]">{recorded.neverSignedIn}</span>
              </div>
            </div>

            {/* A "security report" button used to sit here; it only showed a toast. */}
          </div>
        </motion.div>

        {/* SECONDARY INSIGHTS ROW */}
        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.2 }}
          className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4"
        >
          {/* Recent Activity */}
          <div className="admin-card flex flex-col justify-between hover:shadow-md transition-shadow">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs text-[#0B1220] uppercase tracking-wider font-bold">Recent Activity</h3>
              </div>
              <div className="space-y-3.5 max-h-[160px] overflow-y-auto pr-1">
                {recorded.recent.length === 0 && (
                  <p className="text-[11px] text-slate-400">
                    {recorded.available ? 'Nothing recorded yet. Sign-ins and admin changes will appear here.' : 'Activity is not available right now.'}
                  </p>
                )}
                {recorded.recent.map((row) => ({ ...describeActivity(row), time: timeAgo(row.at) })).map((act, idx) => (
                  <div key={idx} className="flex items-start gap-2.5 text-[11px] border-l border-[#E5E7EB] pl-3 relative ml-1.5">
                    <div className="absolute -left-[3.5px] top-1 w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
                    <div className="flex-1">
                      <p className="font-semibold text-[#0B1220]">{act.title}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{act.desc} · {act.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Quick Insights */}
          <div className="admin-card flex flex-col justify-between hover:shadow-md transition-shadow">
            <div>
              <h3 className="text-xs text-[#0B1220] uppercase tracking-wider mb-3 font-bold">Quick Insights</h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "New Admins", value: recorded.created30, desc: "Last 30 days" },
                  { label: "Total Admins", value: stats.total, desc: "Accounts" },
                  { label: "Signed In", value: recorded.signedInToday, desc: "Last 24 hours" },
                  { label: "Login Success", value: recorded.rateLabel, desc: "Last 30 days" },
                  { label: "Password Resets", value: recorded.resets30, desc: "Last 30 days" },
                  { label: "Permission Changes", value: recorded.permissionChanges30, desc: "Last 30 days" }
                ].map((qi, i) => (
                  <div key={i} className="bg-slate-50 border border-slate-100 rounded-lg p-2 text-center">
                    <span className="text-[8px] text-[#64748B] block truncate">{qi.label}</span>
                    <span className="text-xs font-bold text-[#0B1220] block mt-0.5">{qi.value}</span>
                    <span className="text-[8px] text-slate-400 block mt-0.5 truncate">{qi.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Top Departments */}
          <div className="admin-card flex flex-col justify-between hover:shadow-md transition-shadow">
            <div>
              <h3 className="text-xs text-[#0B1220] uppercase tracking-wider mb-3 font-bold">Admins by Role</h3>
              <div className="space-y-3">
                {roleCounts.length === 0 && <p className="text-[11px] text-slate-400">No admins yet.</p>}
                {roleCounts.map((dept, i) => (
                  <div key={i} className="text-[10px]">
                    <div className="flex justify-between mb-1 text-slate-600">
                      <span>{dept.label}</span>
                      <span className="font-semibold text-[#0B1220]">{dept.count}</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full ${dept.color}`} style={{ width: `${dept.percent}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Access by Module */}
          <div className="admin-card flex flex-col justify-between hover:shadow-md transition-shadow">
            <div>
              <h3 className="text-xs text-[#0B1220] uppercase tracking-wider mb-3 font-bold">Access by Module</h3>
              <div className="space-y-3">
                {moduleAccess.length === 0 && <p className="text-[11px] text-slate-400">No sub-admins yet.</p>}
                {moduleAccess.map((mod, i) => (
                  <div key={i} className="text-[10px]">
                    <div className="flex justify-between mb-1 text-slate-600">
                      <span>{mod.label}</span>
                      <span className="font-semibold text-[#0B1220]">{mod.percent}%</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full ${mod.color}`} style={{ width: `${mod.percent}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>

        {/* SEARCH & FILTER TOOLBAR */}
        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.28 }}
          className="admin-card !p-4 bg-white space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by name, email, employee ID or phone..."
                className="admin-input pl-10 h-10"
              />
            </div>
            
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div>
                <label className="block text-[8px] font-bold text-[#64748B] uppercase mb-0.5">Role</label>
                <select
                  value={filterRole}
                  onChange={(e) => setFilterRole(e.target.value)}
                  className="admin-input h-9 !py-0 !px-2 !w-32"
                >
                  <option value="All">All Roles</option>
                  <option value="Super Admin">Super Admin</option>
                  <option value="Operations Subadmin">Operations Subadmin</option>
                  <option value="Billing Subadmin">Billing Subadmin</option>
                  <option value="Support Staff">Support Staff</option>
                </select>
              </div>

              <div>
                <label className="block text-[8px] font-bold text-[#64748B] uppercase mb-0.5">Department</label>
                <select
                  value={filterDepartment}
                  onChange={(e) => setFilterDepartment(e.target.value)}
                  className="admin-input h-9 !py-0 !px-2 !w-32"
                >
                  <option value="All">All Depts</option>
                  <option value="Operations">Operations</option>
                  <option value="Finance">Finance</option>
                  <option value="Support">Support</option>
                  <option value="Engineering">Engineering</option>
                </select>
              </div>

              <div>
                <label className="block text-[8px] font-bold text-[#64748B] uppercase mb-0.5">Status</label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="admin-input h-9 !py-0 !px-2 !w-32"
                >
                  <option value="All">All Status</option>
                  <option value="Active">Active</option>
                  <option value="Suspended">Suspended</option>
                </select>
              </div>

              <div>
                <label className="block text-[8px] font-bold text-[#64748B] uppercase mb-0.5">MFA</label>
                <select
                  value={filterMfa}
                  onChange={(e) => setFilterMfa(e.target.value)}
                  className="admin-input h-9 !py-0 !px-2 !w-24"
                >
                  <option value="All">All</option>
                  <option value="Enabled">Enabled</option>
                  <option value="Disabled">Disabled</option>
                </select>
              </div>

              <div>
                <label className="block text-[8px] font-bold text-[#64748B] uppercase mb-0.5">Verification</label>
                <select
                  value={filterVerification}
                  onChange={(e) => setFilterVerification(e.target.value)}
                  className="admin-input h-9 !py-0 !px-2 !w-28"
                >
                  <option value="All">All</option>
                  <option value="Verified">Verified</option>
                  <option value="Unverified">Unverified</option>
                </select>
              </div>

              <div className="pt-3">
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="admin-btn-secondary h-9 gap-1.5 px-3 text-[11px]"
                >
                  <Info size={13} />
                  <span>Filters</span>
                </button>
              </div>

              <div className="pt-3">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="admin-input h-9 !py-0 !px-2 !w-32"
                >
                  <option value="Newest">Newest Added</option>
                  <option value="Oldest">Oldest Added</option>
                  <option value="Alphabetical">Alphabetical</option>
                </select>
              </div>
            </div>
          </div>
        </motion.div>

        {/* REGISTRY TABLE */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.35 }}
          className="admin-table-container bg-white shadow-sm overflow-hidden"
        >
          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-3">
              <Loader2 size={32} className="animate-spin text-[#0B1220]" />
              <span className="text-[10px] font-semibold text-[#64748B] uppercase tracking-wider">Synchronizing Node Registry...</span>
            </div>
          ) : filteredAndSortedAdmins.length === 0 ? (
            <div className="py-20 flex flex-col items-center text-center px-6">
              <div className="w-16 h-16 bg-[#F6F8FC] rounded-full flex items-center justify-center text-slate-300 mb-4 border border-[#E5E7EB]">
                <FileSearch size={24} />
              </div>
              <h3 className="text-sm text-[#0B1220] font-bold">No Nodes Located</h3>
              <p className="text-xs text-[#64748B] mt-1 max-w-sm leading-relaxed">
                We couldn't locate any administrators matching your search criteria. Check for typos or expand filters.
              </p>
            </div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th className="!w-10">
                    <input
                      type="checkbox"
                      onChange={handleSelectAllRows}
                      checked={filteredAndSortedAdmins.length > 0 && selectedRowIds.length === filteredAndSortedAdmins.length}
                      className="rounded border-[#E5E7EB] text-[#16A34A] focus:ring-[#16A34A] h-4.5 w-4.5 cursor-pointer"
                    />
                  </th>
                  <th>Admin</th>
                  <th>Employee ID</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Permissions</th>
                  <th>MFA Status</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedAdmins.map((admin) => {
                  const isSuper = admin.admin_type === 'superadmin';
                  const isActive = admin.active !== false;
                  const id = admin.id || admin._id;
                  const isExpanded = selectedAdmin && (selectedAdmin.id === id || selectedAdmin._id === id) && isDrawerOpen;
                  const isEditExpanded = isEditOpen && (form.id === id || form._id === id);

                  const toggleExpand = (e) => {
                    e.stopPropagation();
                    if (isExpanded) {
                      setIsDrawerOpen(false);
                      setSelectedAdmin(null);
                    } else {
                      window.dispatchEvent(new Event('admin:closeDropdowns'));
                      setSelectedAdmin(admin);
                      setIsDrawerOpen(true);
                    }
                  };

                  return (
                    <React.Fragment key={id}>
                      <tr className={`hover:bg-slate-50/50 transition-colors ${isExpanded ? 'bg-[#FAFBFD]' : ''}`}>
                        {/* Checkbox */}
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedRowIds.includes(id)}
                            onChange={(e) => handleSelectRow(id, e.target.checked)}
                            className="rounded border-[#E5E7EB] text-[#16A34A] focus:ring-[#16A34A] h-4.5 w-4.5 cursor-pointer"
                          />
                        </td>

                        {/* Admin Avatar/Name/Email */}
                        <td>
                          <div className="flex items-center gap-3">
                            <div
                              onClick={toggleExpand}
                              className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs border cursor-pointer select-none ${isSuper ? 'bg-[#16A34A]/10 border-[#16A34A]/40 text-[#0B1220]' : 'bg-slate-50 border-slate-200 text-[#0B1220]'}`}
                            >
                              {admin.name?.[0]?.toUpperCase() || <Shield size={14} />}
                            </div>
                            <div>
                              <span
                                onClick={toggleExpand}
                                className="text-xs font-semibold text-[#0B1220] hover:underline cursor-pointer block"
                              >
                                {admin.name}
                              </span>
                              <span className="text-[10px] text-[#64748B] block mt-0.5">{admin.email}</span>
                            </div>
                          </div>
                        </td>

                        {/* Employee ID */}
                        <td>
                          <span className="text-xs font-medium text-[#0B1220]">{admin.employeeId || 'EMP-00' + Math.floor(Math.random() * 9 + 1)}</span>
                        </td>

                        {/* Role */}
                        <td>
                          <div className="flex items-center gap-1">
                            {isSuper ? (
                              <Crown size={11} className="text-[#16A34A]" />
                            ) : (
                              <Shield size={11} className="text-slate-400" />
                            )}
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${isSuper ? 'text-[#16A34A]' : 'text-slate-600'}`}>
                              {isSuper ? 'Super Admin' : (admin.role || 'Personnel')}
                            </span>
                          </div>
                        </td>

                        {/* Department */}
                        <td>
                          <span className="text-xs text-[#0B1220] font-medium">{admin.department || 'Operations'}</span>
                        </td>

                        {/* Permissions */}
                        <td>
                          <span className="text-xs text-[#64748B] font-medium">
                            {isSuper ? 'All menus' : `${menuKeysForAdmin(admin.permissions || []).length} menus`}
                          </span>
                        </td>

                        {/* MFA status */}
                        <td>
                          <div className="flex items-center gap-1.5">
                            <div className={`w-1.5 h-1.5 rounded-full ${admin.mfaEnabled ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                            <span className="text-[10px] font-semibold text-slate-700">
                              {admin.mfaEnabled ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                        </td>

                        {/* Status */}
                        <td>
                          <span className={`admin-badge ${isActive ? 'admin-badge-success' : 'admin-badge-warning'}`}>
                            {isActive ? 'Verified' : 'Suspended'}
                          </span>
                        </td>

                        {/* Last Login */}
                        <td>
                          <span className="text-xs text-[#64748B] font-medium">
                            {admin.lastLogin ? new Date(admin.lastLogin).toLocaleDateString() : 'Just now'}
                          </span>
                        </td>

                        {/* Actions */}
                        <td>
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={toggleExpand}
                              className="p-1.5 text-slate-400 hover:text-[#0B1220] rounded-md hover:bg-slate-100/60 view-btn-trigger"
                              title="View"
                            >
                              <Eye size={14} />
                            </button>
                            <button
                              onClick={() => handleEditClick(admin)}
                              className="p-1.5 text-slate-400 hover:text-[#0B1220] rounded-md hover:bg-slate-100/60"
                              title="Edit"
                            >
                              <Edit2 size={14} />
                            </button>
                            {!isSuper && (
                              <button
                                onClick={() => {
                                  window.dispatchEvent(new Event('admin:closeDropdowns'));
                                  setDeletingAdmin(admin);
                                  setDeleteConfirmText('');
                                  setIsDeleteOpen(true);
                                }}
                                className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md hover:bg-rose-50"
                                title="Delete"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-[#FAFBFD]">
                          <td colSpan={10} className="px-6 py-4">
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.2 }}
                              className="bg-white border-l-4 border-l-[#16A34A] border border-[#E5E7EB] rounded-r-xl p-6 shadow-sm space-y-6 font-sans text-xs text-[#0B1220] overflow-hidden"
                            >
                              <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-sm text-[#0B1220]">
                                    {selectedAdmin.name?.[0]?.toUpperCase()}
                                  </div>
                                  <div>
                                    <h4 className="font-bold text-sm">{selectedAdmin.name}</h4>
                                    <p className="text-[#64748B] text-[11px]">{selectedAdmin.email}</p>
                                  </div>
                                </div>
                                <button
                                  onClick={() => {
                                    setIsDrawerOpen(false);
                                    setSelectedAdmin(null);
                                  }}
                                  className="text-slate-400 hover:text-slate-600 p-1"
                                >
                                  <X size={16} />
                                </button>
                              </div>

                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div>
                                  <span className="text-[#64748B] block font-medium">Employee ID</span>
                                  <span className="font-bold block mt-0.5">{selectedAdmin.employeeId || 'Not available'}</span>
                                </div>
                                <div>
                                  <span className="text-[#64748B] block font-medium">Phone Number</span>
                                  <span className="font-bold block mt-0.5">{selectedAdmin.phone || 'Not available'}</span>
                                </div>
                                <div>
                                  <span className="text-[#64748B] block font-medium">Department</span>
                                  <span className="font-bold block mt-0.5">{selectedAdmin.department || 'Operations'}</span>
                                </div>
                                <div>
                                  <span className="text-[#64748B] block font-medium">Designation</span>
                                  <span className="font-bold block mt-0.5">{selectedAdmin.designation || 'Not available'}</span>
                                </div>
                                <div>
                                  <span className="text-[#64748B] block font-medium">MFA Security</span>
                                  <span className="font-bold block mt-0.5">{selectedAdmin.mfaEnabled ? 'Enabled' : 'Disabled'}</span>
                                </div>
                                <div>
                                  <span className="text-[#64748B] block font-medium">Account Status</span>
                                  <span className="font-bold block mt-0.5">{selectedAdmin.active !== false ? 'Active' : 'Suspended'}</span>
                                </div>
                                <div>
                                  <span className="text-[#64748B] block font-medium">Registered Date</span>
                                  <span className="font-bold block mt-0.5">
                                    {selectedAdmin.createdAt || selectedAdmin.created_at ? new Date(selectedAdmin.createdAt || selectedAdmin.created_at).toLocaleDateString() : 'Not available'}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[#64748B] block font-medium">Last Login</span>
                                  <span className="font-bold block mt-0.5">
                                    {selectedAdmin.lastLogin ? new Date(selectedAdmin.lastLogin).toLocaleDateString() : 'Just now'}
                                  </span>
                                </div>
                              </div>

                              <div className="pt-4 border-t border-[#F1F5F9]">
                                <span className="text-[#64748B] block font-medium mb-1.5">Module Permissions</span>
                                <div className="flex flex-wrap gap-1 mt-0.5">
                                  {selectedAdmin.admin_type === 'superadmin' ? (
                                    <span className="admin-badge admin-badge-success text-[10px] py-0.5 px-2">Unrestricted Sovereignty</span>
                                  ) : selectedAdmin.permissions && selectedAdmin.permissions.length > 0 ? (
                                    selectedAdmin.permissions.map((p) => (
                                      <span key={p} className="admin-badge admin-badge-info py-0.5 px-2 text-[10px] rounded">
                                        {p}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-slate-400 italic">No explicit modules allowed yet.</span>
                                  )}
                                </div>
                              </div>

                              <div className="pt-4 border-t border-[#F1F5F9] flex items-center justify-between gap-4">
                                <div className="flex-1">
                                  <span className="text-[#64748B] block font-medium">Administrative Notes</span>
                                  <p className="text-[11px] mt-1 leading-relaxed bg-[#F8FAFC] p-2 rounded border border-[#E5E7EB] italic">
                                    {selectedAdmin.notes || 'No security log overrides recorded.'}
                                  </p>
                                </div>
                                <button
                                  onClick={() => {
                                    setIsDrawerOpen(false);
                                    handleEditClick(selectedAdmin);
                                  }}
                                  className="admin-btn-primary h-9 px-4 gap-1.5 !bg-[#16A34A] !text-[#0B1220] text-xs font-bold shrink-0 self-end"
                                >
                                  <span>Modify Privileges</span>
                                </button>
                              </div>
                            </motion.div>
                          </td>
                        </tr>
                      )}

                      {isEditExpanded && (
                        <tr className="bg-[#FAFBFD]">
                          <td colSpan={10} className="px-6 py-4">
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.2 }}
                              className="bg-white border-l-4 border-l-[#16A34A] border border-[#E5E7EB] rounded-r-xl shadow-sm space-y-4 font-sans text-xs text-[#0B1220] overflow-hidden"
                            >
                              <div className="p-5 border-b border-[#E5E7EB] flex items-center justify-between bg-slate-50">
                                <h3 className="text-xs font-bold text-[#0B1220] uppercase tracking-wider">Modify Administrative Privileges</h3>
                                <button type="button" onClick={() => setIsEditOpen(false)} className="text-slate-400 hover:text-slate-600">
                                  <X size={18} />
                                </button>
                              </div>

                              <div className="p-5">
                                <AdminAccountForm
                                  mode="edit"
                                  form={form}
                                  setForm={setForm}
                                  serviceLocations={serviceLocations}
                                  zones={zones}
                                  saving={saving}
                                  onSubmit={handleEditSubmit}
                                  onCancel={() => setIsEditOpen(false)}
                                />
                              </div>
                            </motion.div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </motion.div>

        {/* PERMISSION BADGES LEGEND */}
        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.42 }}
          className="admin-card"
        >
          <h3 className="text-xs text-[#0B1220] uppercase tracking-wider mb-3 font-bold">System Permission Directory</h3>
          <div className="flex flex-wrap gap-1.5">
            {['Dashboard', 'Users', 'Drivers', 'Bookings', 'Finance', 'Taxi', 'Rental', 'Delivery', 'Support', 'Pricing', 'Promotion', 'Reports', 'Settings', 'Analytics'].map((mod, i) => (
              <span key={i} className="admin-badge admin-badge-info text-[9px] py-0.5 px-2 bg-slate-50 border border-slate-200 text-slate-600 rounded">
                {mod}
              </span>
            ))}
          </div>
        </motion.div>

      </div>

      {/* CREATE MODAL
          Rendered at the page root: inside the animated page wrapper a
          "fixed" element is placed relative to that wrapper, not the window,
          which is why this form opened half off the bottom of the screen with
          its Save button out of reach. */}
      {createPortal(
        // The admin theme is scoped to .redigo-admin-root; outside it the
        // inputs lose their borders and look like plain text.
        <div className="redigo-admin-root">
        <AnimatePresence>
          {isCreateOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.5 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsCreateOpen(false)}
                className="fixed inset-0 bg-black z-[60]"
              />
              <motion.div
                initial={{ scale: 0.97, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.97, opacity: 0 }}
                className="fixed inset-0 m-auto w-[calc(100%-32px)] max-w-2xl h-fit max-h-[90vh] bg-white rounded-xl shadow-2xl z-[61] flex flex-col overflow-hidden"
              >
                <div className="p-5 border-b border-[#E5E7EB] flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#0B1220]">Create admin</h3>
                  <button onClick={() => setIsCreateOpen(false)} className="text-slate-400 hover:text-slate-600" aria-label="Close">
                    <X size={18} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-5">
                  <AdminAccountForm
                    mode="create"
                    form={form}
                    setForm={setForm}
                    serviceLocations={serviceLocations}
                    zones={zones}
                    saving={saving}
                    onSubmit={handleCreateSubmit}
                    onCancel={() => setIsCreateOpen(false)}
                  />
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
        </div>,
        document.body,
      )}

      {/* DELETE CONFIRMATION MODAL */}
      <AnimatePresence>
        {isDeleteOpen && deletingAdmin && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsDeleteOpen(false)}
              className="admin-modal-overlay"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="fixed inset-0 m-auto w-full max-w-md h-fit bg-white rounded-xl shadow-2xl z-50 overflow-hidden"
            >
              <div className="p-5 border-b border-[#E5E7EB] flex items-center justify-between bg-rose-50">
                <div className="flex items-center gap-2 text-rose-600">
                  <AlertTriangle size={18} />
                  <h3 className="text-xs font-bold uppercase tracking-wider">Revoke Access Credentials</h3>
                </div>
                <button onClick={() => setIsDeleteOpen(false)} className="text-slate-400 hover:text-slate-600">
                  <X size={18} />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center font-bold text-sm text-[#0B1220]">
                    {deletingAdmin.name?.[0]?.toUpperCase()}
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-[#0B1220]">{deletingAdmin.name}</h4>
                    <p className="text-[10px] text-[#64748B] mt-0.5">{deletingAdmin.role || 'Personnel'}</p>
                  </div>
                </div>

                <div className="bg-rose-50/50 border border-rose-100 rounded-lg p-3 text-xs text-rose-800 leading-relaxed">
                  ⚠️ <strong>Warning:</strong> Deleting this node will permanently invalidate all assigned security keys and completely restrict dashboard access for this identity. This operation is irrevocable.
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-[#64748B] uppercase mb-1">
                    Type <span className="text-[#0B1220] font-black">DELETE</span> to confirm
                  </label>
                  <input
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder="Type DELETE..."
                    className="admin-input h-10 border-rose-200 focus:border-rose-500 focus:ring-rose-500"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#E5E7EB]">
                  <button type="button" onClick={() => setIsDeleteOpen(false)} className="admin-btn-secondary h-10">
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteConfirm}
                    disabled={deleteConfirmText !== 'DELETE' || saving}
                    className="admin-btn-primary h-10 bg-rose-600 hover:bg-rose-700 !text-white min-w-[120px] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {saving ? <Loader2 size={16} className="animate-spin" /> : 'Revoke Node'}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

    </div>
  );
};

export default Admins;
