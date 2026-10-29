import { useState, useMemo, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { Search, ChevronLeft, ChevronRight, Eye, User, Star, ArrowUpDown, Settings, FileText, FileSpreadsheet, Loader2, Check, Columns, ExternalLink, Calendar, MapPin, CreditCard, Mail, Phone, Bike, FileCheck, Save, Trash2, MoreVertical, History, DollarSign } from "lucide-react"
import { adminAPI } from "@food/api"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@food/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@food/components/ui/dialog"
import { exportDeliverymenToExcel, exportDeliverymenToPDF } from "@food/components/admin/deliveryman/deliverymanExportUtils"
import { extractPagination } from "@food/utils/pagination"
import { toast } from "sonner"
const debugError = () => {}

const PAGE_SIZE = 30

const formatCurrency = (amount) => {
  const numericAmount = Number(amount)
  if (!Number.isFinite(numericAmount)) return "\u20B90.00"
  return `\u20B9${numericAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const mergePartnersWithWallets = (partners, walletRows = []) => {
  const walletMap = new Map(
    walletRows.map((wallet) => [String(wallet.deliveryId), wallet]),
  )

  return partners.map((partner) => {
    const wallet = walletMap.get(String(partner._id))
    return {
      ...partner,
      walletSummary: wallet || null,
      pocketBalance: wallet?.pocketBalance || 0,
      cashInHand: wallet?.cashInHand || 0,
      remainingCashLimit: wallet?.remainingCashLimit || 0,
      totalEarning: wallet?.totalEarning || 0,
      bonus: wallet?.bonus || 0,
      totalWithdrawn: wallet?.totalWithdrawn || 0,
      availableCashLimit: wallet?.availableCashLimit || 0,
    }
  })
}

export default function DeliverymanList() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPartners, setTotalPartners] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [deliverymen, setDeliverymen] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isViewOpen, setIsViewOpen] = useState(false)
  const [viewDetails, setViewDetails] = useState(null)
  const [isEmploymentOpen, setIsEmploymentOpen] = useState(false)
  const [employmentDetails, setEmploymentDetails] = useState(null)
  const [employmentLoading, setEmploymentLoading] = useState(false)
  const [deletingDeliveryId, setDeletingDeliveryId] = useState(null)
  const [statusFilter, setStatusFilter] = useState("all")
  const [zoneFilter, setZoneFilter] = useState("all")
  const [visibleColumns, setVisibleColumns] = useState({
    si: true,
    name: true,
    contact: true,
    zone: true,
    totalOrders: true,
    pocketBalance: true,
    availabilityStatus: true,
    actions: true,
  })

  useEffect(() => {
    const timer = setTimeout(() => {
      const nextSearch = searchQuery.trim()
      setDebouncedSearch((prev) => {
        if (prev !== nextSearch) {
          setCurrentPage(1)
        }
        return nextSearch
      })
    }, 500)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const fetchDeliverymen = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const params = {
        page: currentPage,
        limit: PAGE_SIZE,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      }

      const [partnersResponse, walletsResponse] = await Promise.allSettled([
        adminAPI.getDeliveryPartners(params),
        adminAPI.getDeliveryBoyWallets(params),
      ])

      if (partnersResponse.status === "fulfilled" && partnersResponse.value?.data?.success) {
        const data = partnersResponse.value.data.data || {}
        const partners = data.deliveryPartners || []
        const pagination = extractPagination(data)
        const walletRows =
          walletsResponse.status === "fulfilled" && walletsResponse.value?.data?.success
            ? walletsResponse.value.data.data?.wallets || []
            : []

        setDeliverymen(mergePartnersWithWallets(partners, walletRows))
        setTotalPartners(pagination.total || 0)
        setTotalPages(
          pagination.totalPages ||
            Math.ceil((pagination.total || 0) / PAGE_SIZE) ||
            0,
        )
      } else {
        setError("Failed to fetch delivery partners")
        setDeliverymen([])
        setTotalPartners(0)
        setTotalPages(0)
      }
    } catch (err) {
      debugError("Error fetching delivery partners:", err)

      let errorMessage = "Failed to fetch delivery partners. Please try again."

      if (err.code === "ERR_NETWORK") {
        errorMessage = "Network error. Please check if backend server is running."
      } else if (err.response?.status === 401) {
        errorMessage = "Unauthorized. Please login again."
      } else if (err.response?.status === 403) {
        errorMessage = "Access denied. You don't have permission to view this."
      } else if (err.response?.data?.message) {
        errorMessage = err.response.data.message
      } else if (err.message) {
        errorMessage = err.message
      }

      setError(errorMessage)
      setDeliverymen([])
      setTotalPartners(0)
      setTotalPages(0)
    } finally {
      setLoading(false)
    }
  }, [currentPage, debouncedSearch])

  useEffect(() => {
    fetchDeliverymen()
  }, [fetchDeliverymen])

  const zonesList = useMemo(() => {
    const list = []
    const seen = new Set()
    deliverymen.forEach((dm) => {
      const z = dm.zoneName || dm.zone
      if (z) {
        const zoneStr = String(z)
        if (!seen.has(zoneStr)) {
          seen.add(zoneStr)
          list.push(zoneStr)
        }
      }
    })
    return list.sort((a, b) => a.localeCompare(b))
  }, [deliverymen])

  const filteredDeliverymen = useMemo(() => {
    let result = [...deliverymen]
    if (statusFilter !== "all") {
      result = result.filter((dm) => String(dm.status || "").toLowerCase() === statusFilter.toLowerCase())
    }
    if (zoneFilter !== "all") {
      result = result.filter((dm) => String(dm.zoneName || dm.zone || "") === zoneFilter)
    }
    return result
  }, [deliverymen, statusFilter, zoneFilter])

  const handleViewOrderHistory = (deliveryman) => {
    const partnerId = deliveryman?._id || deliveryman?.id
    if (!partnerId) {
      toast.error("Delivery partner ID not found")
      return
    }
    navigate(`/admin/food/orders/all?deliveryPartnerId=${partnerId}`)
  }

  const handleView = async (deliveryman) => {
    try {
      setLoading(true)
      const response = await adminAPI.getDeliveryPartnerById(deliveryman._id)
      
      if (response.data && response.data.success) {
        setViewDetails({
          ...response.data.data.delivery,
          walletSummary: deliveryman.walletSummary || null,
pocketBalance: deliveryman.pocketBalance || 0,
cashInHand: deliveryman.cashInHand || 0,
remainingCashLimit: deliveryman.remainingCashLimit || 0,
totalEarning: deliveryman.totalEarning || 0,
bonus: deliveryman.bonus || 0,
totalWithdrawn: deliveryman.totalWithdrawn || 0,
availableCashLimit: deliveryman.availableCashLimit || 0,
        })
        setIsViewOpen(true)
      } else {
        alert("Failed to load details")
      }
    } catch (err) {
      debugError("Error fetching details:", err)
      alert(err.response?.data?.message || "Failed to load details")
    } finally {
      setLoading(false)
    }
  }

  const [employmentUpdating, setEmploymentUpdating] = useState(false)
  const [employmentForm, setEmploymentForm] = useState({
    employmentType: "per_order",
    salaryDuration: "weekly",
    salaryAmount: "",
  })

  const handleOpenEmploymentEdit = async (deliveryman) => {
    try {
      setEmploymentLoading(true)
      setEmploymentDetails(null)
      setEmploymentForm({ employmentType: "per_order", salaryDuration: "weekly", salaryAmount: "" })
      setIsEmploymentOpen(true)
      const response = await adminAPI.getDeliveryPartnerById(deliveryman._id)
      if (response.data?.success) {
        const delivery = response.data.data.delivery
        setEmploymentDetails(delivery)
        setEmploymentForm({
          employmentType: delivery.employmentType || "per_order",
          salaryDuration: delivery.salaryDuration || "weekly",
          salaryAmount:
            delivery.salaryAmount != null && delivery.salaryAmount !== ""
              ? String(delivery.salaryAmount)
              : "",
        })
      } else {
        toast.error("Failed to load employment details")
        setIsEmploymentOpen(false)
      }
    } catch (err) {
      debugError("Error fetching employment details:", err)
      toast.error(err.response?.data?.message || "Failed to load employment details")
      setIsEmploymentOpen(false)
    } finally {
      setEmploymentLoading(false)
    }
  }

  const handleEmploymentFormChange = (field, value) => {
    setEmploymentForm((prev) => ({ ...prev, [field]: value }))
  }

  const hasEmploymentChanges = Boolean(
    employmentDetails &&
    (
      employmentForm.employmentType !== (employmentDetails.employmentType || "per_order") ||
      (employmentForm.employmentType === "salary" &&
        (employmentForm.salaryDuration !== (employmentDetails.salaryDuration || "weekly") ||
          Number(employmentForm.salaryAmount || 0) !== Number(employmentDetails.salaryAmount || 0)))
    )
  )

  const handleEmploymentSave = async () => {
    if (!employmentDetails || !employmentDetails._id || !hasEmploymentChanges) return
    if (employmentForm.employmentType === "salary") {
      const amount = Number(employmentForm.salaryAmount)
      if (!Number.isFinite(amount) || amount <= 0) {
        toast.error("Please enter a valid salary amount")
        return
      }
    }
    try {
      setEmploymentUpdating(true)
      const data = {
        employmentType: employmentForm.employmentType,
        ...(employmentForm.employmentType === "salary"
          ? {
              salaryDuration: employmentForm.salaryDuration,
              salaryAmount: Number(employmentForm.salaryAmount),
            }
          : {}),
      }
      const res = await adminAPI.updateDeliveryPartner(employmentDetails._id, data)
      if (res.data?.success) {
        setEmploymentDetails((prev) => ({ ...prev, ...data }))
        setDeliverymen((prev) =>
          prev.map((dm) =>
            dm._id === employmentDetails._id ? { ...dm, ...data } : dm
          )
        )
        setViewDetails((prev) =>
          prev && String(prev._id) === String(employmentDetails._id)
            ? { ...prev, ...data }
            : prev
        )
        toast.success("Employment settings updated successfully")
        setIsEmploymentOpen(false)
      }
    } catch (err) {
      debugError("Error updating employment:", err)
      toast.error(err.response?.data?.message || "Failed to update employment")
    } finally {
      setEmploymentUpdating(false)
    }
  }

  const handleExportPDF = () => {
    if (filteredDeliverymen.length === 0) {
      alert("No data to export")
      return
    }
    exportDeliverymenToPDF(filteredDeliverymen)
  }

  const handleExportExcel = () => {
    if (filteredDeliverymen.length === 0) {
      alert("No data to export")
      return
    }
    exportDeliverymenToExcel(filteredDeliverymen)
  }

  const toggleColumn = (columnKey) => {
    setVisibleColumns(prev => ({ ...prev, [columnKey]: !prev[columnKey] }))
  }

  const resetColumns = () => {
    setVisibleColumns({
      si: true,
      name: true,
      contact: true,
      zone: true,
      totalOrders: true,
      pocketBalance: true,
      availabilityStatus: true,
      actions: true,
    })
  }

  const columnsConfig = {
    si: "Serial Number",
    name: "Name",
    contact: "Contact",
    zone: "Zone",
    totalOrders: "Total Orders",
    pocketBalance: "Pocket Balance",
    availabilityStatus: "Availability Status",
    actions: "Actions",
  }

  const handleDelete = async (deliveryman) => {
    const deliverymanId = String(deliveryman?._id || "")
    if (!deliverymanId) {
      toast.error("Delivery partner not found")
      return
    }

    const confirmed = window.confirm(
      `Are you sure you want to delete "${deliveryman?.name || "this delivery partner"}"?\n\nThis will permanently remove the partner account and cannot be undone.`,
    )

    if (!confirmed) {
      return
    }

    try {
      setDeletingDeliveryId(deliverymanId)
      const response = await adminAPI.deleteDeliveryPartner(deliverymanId)

      if (!response?.data?.success) {
        toast.error(response?.data?.message || "Failed to delete delivery partner")
        return
      }

      const wasViewingDeletedPartner = Boolean(
        viewDetails && String(viewDetails._id) === deliverymanId,
      )
      setDeliverymen((prev) => {
        const next = prev.filter((item) => String(item._id) !== deliverymanId)
        if (next.length === 0 && currentPage > 1) {
          setCurrentPage((p) => Math.max(1, p - 1))
        }
        return next
      })
      setTotalPartners((prev) => Math.max(0, prev - 1))
      setViewDetails((prev) => (prev && String(prev._id) === deliverymanId ? null : prev))
      if (wasViewingDeletedPartner) {
        setIsViewOpen(false)
      }
      toast.success(response?.data?.message || "Delivery partner deleted successfully")
    } catch (err) {
      debugError("Error deleting delivery partner:", err)
      toast.error(err?.response?.data?.message || err?.message || "Failed to delete delivery partner")
    } finally {
      setDeletingDeliveryId(null)
    }
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <User className="w-5 h-5 text-slate-600" />
              <h1 className="text-2xl font-bold text-slate-900">Deliveryman List</h1>
            </div>

            <div className="flex items-center gap-3">
             <div className="flex items-center gap-3 flex-wrap">
               <div className="relative flex-1 sm:flex-initial min-w-[200px]">
                 <input
                   type="text"
                   placeholder="Search by name..."
                   value={searchQuery}
                   onChange={(e) => setSearchQuery(e.target.value)}
                   className="pl-10 pr-4 py-2.5 w-full text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
                 />
                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
               </div>
               <select
                 value={statusFilter}
                 onChange={(e) => setStatusFilter(e.target.value)}
                 className="px-3 py-2.5 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400 min-w-[140px]"
               >
                 <option value="all">All Statuses</option>
                 <option value="online">Online</option>
                 <option value="offline">Offline</option>
               </select>
               <select
                 value={zoneFilter}
                 onChange={(e) => setZoneFilter(e.target.value)}
                 className="px-3 py-2.5 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400 min-w-[160px]"
               >
                 <option value="all">All Zones</option>
                 {zonesList.map((z) => (
                   <option key={z} value={z}>
                     {z}
                   </option>
                 ))}
               </select>
             </div>

              <button
                onClick={handleExportPDF}
                className="px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-2 transition-all"
                title="Export as PDF"
              >
                <FileText className="w-4 h-4" />
                <span className="text-black font-bold">PDF</span>
              </button>
              <button
                onClick={handleExportExcel}
                className="px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-2 transition-all"
                title="Export as Excel"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span className="text-black font-bold">Excel</span>
              </button>
              <button 
                onClick={() => setIsSettingsOpen(true)}
                className="p-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 transition-all"
              >
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="mb-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-700">Deliveryman</span>
              <span className="px-3 py-1 rounded-full text-sm font-semibold bg-slate-100 text-slate-700">
                {totalPartners}
              </span>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700">{error}</p>
              <button
                onClick={fetchDeliverymen}
                className="mt-2 text-sm text-red-600 underline hover:text-red-800"
              >
                Retry
              </button>
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                <span className="ml-3 text-sm text-slate-600">Loading delivery partners...</span>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {visibleColumns.si && (
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                        <div className="flex items-center gap-2">
                          <span>SI</span>
                          <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                        </div>
                      </th>
                    )}
                    {visibleColumns.name && (
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                        <div className="flex items-center gap-2">
                          <span>Name</span>
                          <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                        </div>
                      </th>
                    )}
                    {visibleColumns.contact && (
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                        <div className="flex items-center gap-2">
                          <span>Contact</span>
                          <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                        </div>
                      </th>
                    )}
                    {visibleColumns.zone && (
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                        <div className="flex items-center gap-2">
                          <span>Zone</span>
                          <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                        </div>
                      </th>
                    )}
                    {visibleColumns.totalOrders && (
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                        <div className="flex items-center gap-2">
                          <span>Total Orders</span>
                          <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                        </div>
                      </th>
                    )}
                    {visibleColumns.pocketBalance && (
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                        <div className="flex items-center gap-2">
                          <span>Pocket Balance</span>
                          <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                        </div>
                      </th>
                    )}
                    {visibleColumns.availabilityStatus && (
                      <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                        <div className="flex items-center gap-2">
                          <span>Availability Status</span>
                          <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                        </div>
                      </th>
                    )}
                    {visibleColumns.actions && (
                      <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-700 uppercase tracking-wider">Action</th>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {filteredDeliverymen.length === 0 ? (
                    <tr>
                      <td colSpan={Object.values(visibleColumns).filter(v => v).length} className="px-6 py-8 text-center text-slate-500">
                        {error ? "Error loading delivery partners" : "No delivery partners found"}
                      </td>
                    </tr>
                  ) : (
                    filteredDeliverymen.map((dm) => (
                      <tr key={dm._id} className="hover:bg-slate-50 transition-colors">
                        {visibleColumns.si && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm font-medium text-slate-700">{dm.sl}</span>
                          </td>
                        )}
                        {visibleColumns.name && (
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div 
                                className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center shrink-0 overflow-hidden cursor-pointer hover:opacity-80 transition-all border border-slate-100"
                                onClick={() => handleView(dm)}
                              >
                                {(dm.profileImage?.url ?? dm.profilePhoto) ? (
                                  <img
                                    src={dm.profileImage?.url ?? dm.profilePhoto}
                                    alt={dm.name}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <span className="text-sm font-medium text-slate-500">
                                    {dm.name?.trim() ? dm.name.slice(0, 2).toUpperCase() : "?"}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span 
                                  className="text-sm font-medium text-slate-900 cursor-pointer hover:text-blue-600 transition-colors"
                                  onClick={() => handleView(dm)}
                                >
                                  {dm.name}
                                </span>
                                {dm.rating > 0 && (
                                  <div className="flex items-center gap-1">
                                    <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                                    <span className="text-xs text-slate-600">{dm.rating.toFixed(1)}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        )}
                        {visibleColumns.contact && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex flex-col">
                              <span className="text-sm text-slate-700">{dm.email}</span>
                              <span className="text-xs text-slate-500">{dm.phone}</span>
                            </div>
                          </td>
                        )}
                        {visibleColumns.zone && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-slate-700">{dm.zone}</span>
                          </td>
                        )}
                        {visibleColumns.totalOrders && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-slate-700">{dm.totalOrders || 0}</span>
                          </td>
                        )}
                        {visibleColumns.pocketBalance && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm text-slate-700">{formatCurrency(dm.pocketBalance)}</span>
                          </td>
                        )}
                        {visibleColumns.availabilityStatus && (
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className="text-xs">
                                Active Status: <span className={`${dm.status === 'Online' ? 'text-blue-600' : 'text-slate-600'} underline`}>{dm.status}</span>
                              </span>
                            </div>
                          </td>
                        )}
                        {visibleColumns.actions && (
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            <div className="flex items-center justify-center gap-2">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button className="p-1.5 rounded text-slate-600 hover:bg-slate-100 transition-colors">
                                    <MoreVertical className="w-4 h-4" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44 bg-white border border-slate-200 rounded-lg shadow-lg z-50">
                                  <DropdownMenuItem
                                    onClick={() => handleView(dm)}
                                    className="cursor-pointer flex items-center gap-2"
                                  >
                                    <Eye className="w-4 h-4 text-slate-500" />
                                    <span>View Details</span>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleViewOrderHistory(dm)}
                                    className="cursor-pointer flex items-center gap-2"
                                  >
                                    <History className="w-4 h-4 text-emerald-600" />
                                    <span>Order History</span>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => {
                                      const id = dm?._id || dm?.id
                                      if (!id) return
                                      navigate(
                                        `/admin/food/delivery-partners/earnings?deliveryPartnerId=${encodeURIComponent(String(id))}`,
                                      )
                                    }}
                                    className="cursor-pointer flex items-center gap-2"
                                  >
                                    <DollarSign className="w-4 h-4 text-green-600" />
                                    <span>Earnings</span>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleOpenEmploymentEdit(dm)}
                                    className="cursor-pointer flex items-center gap-2"
                                  >
                                    <FileText className="w-4 h-4 text-slate-500" />
                                    <span>Employment & Payout</span>
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => handleDelete(dm)}
                                    disabled={deletingDeliveryId === String(dm._id)}
                                    className="cursor-pointer flex items-center gap-2 text-red-600 hover:text-red-700 disabled:opacity-50"
                                  >
                                    {deletingDeliveryId === String(dm._id) ? (
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="w-4 h-4 text-red-500" />
                                    )}
                                    <span>Delete Partner</span>
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>

          {totalPages > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-sm text-slate-500">
                Page <span className="font-semibold text-slate-700">{currentPage}</span> of{" "}
                <span className="font-semibold text-slate-700">{totalPages}</span>
                <span className="text-slate-400"> · {PAGE_SIZE} per page</span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentPage <= 1 || loading}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </button>

                {Array.from({ length: Math.min(totalPages, 5) }).map((_, idx) => {
                  let pageNum
                  if (totalPages <= 5) {
                    pageNum = idx + 1
                  } else if (currentPage <= 3) {
                    pageNum = idx + 1
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + idx
                  } else {
                    pageNum = currentPage - 2 + idx
                  }

                  return (
                    <button
                      key={pageNum}
                      type="button"
                      disabled={loading}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`w-8 h-8 text-sm rounded-lg transition-colors ${
                        currentPage === pageNum
                          ? "bg-blue-600 text-white font-semibold"
                          : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {pageNum}
                    </button>
                  )
                })}

                <button
                  type="button"
                  disabled={currentPage >= totalPages || loading}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* View Details Dialog */}
      <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
        <DialogContent className="max-w-3xl bg-white p-0 opacity-0 data-[state=open]:opacity-100 data-[state=closed]:opacity-0 transition-opacity duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:scale-100 data-[state=closed]:scale-100 max-h-[85vh] overflow-y-auto">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-200">
            <DialogTitle className="text-xl font-bold text-slate-900">Delivery Partner Details</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6">
            {viewDetails ? (
              <div className="space-y-6 mt-4">
                {/* Profile Image & Basic Info */}
                <div className="flex items-start gap-6 pb-6 border-b border-slate-200">
                  <div className="flex-shrink-0">
                    {viewDetails.profileImage?.url ? (
                      <img 
                        src={viewDetails.profileImage.url} 
                        alt={viewDetails.name}
                        className="w-24 h-24 rounded-full object-cover border-2 border-slate-200"
                      />
                    ) : (
                      <div className="w-24 h-24 rounded-full bg-slate-200 flex items-center justify-center">
                        <User className="w-12 h-12 text-slate-400" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1">
                        <User className="w-3 h-3" /> Name
                      </label>
                      <p className="text-sm font-medium text-slate-900 mt-1">{viewDetails.name || "N/A"}</p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1">
                        <Mail className="w-3 h-3" /> Email
                      </label>
                      <p className="text-sm text-slate-900 mt-1">{viewDetails.email || "N/A"}</p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1">
                        <Phone className="w-3 h-3" /> Phone
                      </label>
                      <p className="text-sm text-slate-900 mt-1">{viewDetails.phone || "N/A"}</p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Delivery ID</label>
                      <p className="text-sm font-medium text-slate-900 mt-1">{viewDetails.deliveryId || "N/A"}</p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Status</label>
                      <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium mt-1 ${
                        viewDetails.status === 'pending' ? 'bg-blue-100 text-blue-700' :
                        viewDetails.status === 'approved' || viewDetails.status === 'active' ? 'bg-green-100 text-green-700' :
                        viewDetails.status === 'blocked' ? 'bg-red-100 text-red-700' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {viewDetails.status === 'blocked' ? 'Rejected' : (viewDetails.status?.charAt(0).toUpperCase() + viewDetails.status?.slice(1) || "N/A")}
                      </span>
                    </div>
                    {viewDetails.rejectionReason && (
                      <div className="col-span-2">
                        <label className="text-xs font-semibold text-slate-500 uppercase text-red-600">Rejection Reason</label>
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-1">
                          <p className="text-sm text-red-700 whitespace-pre-wrap">{viewDetails.rejectionReason}</p>
                        </div>
                      </div>
                    )}
                    {viewDetails.dateOfBirth && (
                      <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1">
                          <Calendar className="w-3 h-3" /> Date of Birth
                        </label>
                        <p className="text-sm text-slate-900 mt-1">
                          {new Date(viewDetails.dateOfBirth).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                    )}
                    {viewDetails.gender && (
                      <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase">Gender</label>
                        <p className="text-sm text-slate-900 mt-1 capitalize">{viewDetails.gender || "N/A"}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Location Details */}
                {viewDetails.location && (
                  <div className="pb-6 border-b border-slate-200">
                    <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                      <MapPin className="w-4 h-4" /> Location Details
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      {viewDetails.location.addressLine1 && (
                        <div className="col-span-2">
                          <label className="text-xs font-semibold text-slate-500 uppercase">Address Line 1</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.location.addressLine1}</p>
                        </div>
                      )}
                      {viewDetails.location.addressLine2 && (
                        <div className="col-span-2">
                          <label className="text-xs font-semibold text-slate-500 uppercase">Address Line 2</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.location.addressLine2}</p>
                        </div>
                      )}
                      {viewDetails.location.area && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Area</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.location.area}</p>
                        </div>
                      )}
                      {viewDetails.location.city && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">City</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.location.city}</p>
                        </div>
                      )}
                      {viewDetails.location.state && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">State</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.location.state}</p>
                        </div>
                      )}
                      {viewDetails.location.zipCode && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Zip Code</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.location.zipCode}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Vehicle Details */}
                {viewDetails.vehicle && (
                  <div className="pb-6 border-b border-slate-200">
                    <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                      <Bike className="w-4 h-4" /> Vehicle Details
                    </h3>
                    <div className="grid grid-cols-4 gap-4">
                      {viewDetails.vehicle.brand && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Brand</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.vehicle.brand}</p>
                        </div>
                      )}
                      {viewDetails.vehicle.model && (
                        <div className="text-right col-span-1">
                          <label className="text-xs font-semibold text-slate-500 uppercase">Model</label>
                          <p className="text-xs text-slate-900 mt-1">{viewDetails.vehicle.model}</p>
                        </div>
                      )}
                      {viewDetails.vehicle.number && (
                        <div className="col-span-2">
                          <label className="text-xs font-semibold text-slate-500 uppercase">Vehicle Number</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.vehicle.number}</p>
                        </div>
                      )}
                      {viewDetails.vehicle.type && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Vehicle Type</label>
                          <p className="text-sm text-slate-900 mt-1 capitalize">{viewDetails.vehicle.type}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Pocket Details */}
                <div className="pb-6 border-b border-slate-200">
                  <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                    <CreditCard className="w-4 h-4" /> Pocket Details
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Employment</label>
                      <p className="text-sm font-medium text-slate-900 mt-1 capitalize">
                        {(viewDetails.employmentType || "per_order").replace(/_/g, " ")}
                      </p>
                    </div>
                    {viewDetails.employmentType === "salary" && (
                      <>
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Salary Duration</label>
                          <p className="text-sm font-medium text-slate-900 mt-1 capitalize">
                            {viewDetails.salaryDuration || "weekly"}
                          </p>
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Fixed Salary</label>
                          <p className="text-sm font-medium text-emerald-700 mt-1">
                            {formatCurrency(viewDetails.salaryAmount || 0)}
                          </p>
                        </div>
                      </>
                    )}
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Pocket Balance</label>
                      <p className="text-sm font-medium text-slate-900 mt-1">
                        {formatCurrency(viewDetails.pocketBalance || viewDetails.walletSummary?.pocketBalance)}
                      </p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Total Earning</label>
                      <p className="text-sm font-medium text-slate-900 mt-1">
                        {formatCurrency(viewDetails.totalEarning || viewDetails.walletSummary?.totalEarning)}
                      </p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Bonus</label>
                      <p className="text-sm font-medium text-slate-900 mt-1">
                        {formatCurrency(viewDetails.bonus || viewDetails.walletSummary?.bonus)}
                      </p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Total Withdrawn</label>
                      <p className="text-sm font-medium text-slate-900 mt-1">
                        {formatCurrency(viewDetails.totalWithdrawn || viewDetails.walletSummary?.totalWithdrawn)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Documents */}
                {viewDetails.documents && (
                  <div className="pb-6 border-b border-slate-200">
                    <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                      <FileCheck className="w-4 h-4" /> Documents
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      {/* Aadhar */}
                      {viewDetails.documents.aadhar && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Aadhar Card</label>
                          <div className="mt-2">
                            {viewDetails.documents.aadhar.number && (
                              <p className="text-sm text-slate-700 mb-1">Number: {viewDetails.documents.aadhar.number}</p>
                            )}
                            {viewDetails.documents.aadhar.document && (
                              <a 
                                href={viewDetails.documents.aadhar.document} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                              >
                                <ExternalLink className="w-3 h-3" /> View Document
                              </a>
                            )}
                          </div>
                        </div>
                      )}

                      {/* PAN */}
                      {viewDetails.documents.pan && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">PAN Card</label>
                          <div className="mt-2">
                            {viewDetails.documents.pan.number && (
                              <p className="text-sm text-slate-700 mb-1">Number: {viewDetails.documents.pan.number}</p>
                            )}
                            {viewDetails.documents.pan.document && (
                              <a 
                                href={viewDetails.documents.pan.document} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                              >
                                <ExternalLink className="w-3 h-3" /> View Document
                              </a>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Driving License */}
                      {viewDetails.documents.drivingLicense && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Driving License</label>
                          <div className="mt-2">
                            {viewDetails.documents.drivingLicense.number && (
                              <p className="text-sm text-slate-700 mb-1">Number: {viewDetails.documents.drivingLicense.number}</p>
                            )}
                            {viewDetails.documents.drivingLicense.expiryDate && (
                              <p className="text-xs text-slate-500 mb-1">
                                Expiry: {new Date(viewDetails.documents.drivingLicense.expiryDate).toLocaleDateString('en-GB')}
                              </p>
                            )}
                            {viewDetails.documents.drivingLicense.document && (
                              <a 
                                href={viewDetails.documents.drivingLicense.document} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                              >
                                <ExternalLink className="w-3 h-3" /> View Document
                              </a>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Vehicle RC */}
                      {viewDetails.documents.vehicleRC && (viewDetails.documents.vehicleRC.number || viewDetails.documents.vehicleRC.document) && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Vehicle RC</label>
                          <div className="mt-2">
                            {viewDetails.documents.vehicleRC.number && (
                              <p className="text-sm text-slate-700 mb-1">Number: {viewDetails.documents.vehicleRC.number}</p>
                            )}
                            {viewDetails.documents.vehicleRC.document && (
                              <a 
                                href={viewDetails.documents.vehicleRC.document} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                              >
                                <ExternalLink className="w-3 h-3" /> View Document
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Bank Details */}
                {viewDetails.documents?.bankDetails && (
                  <div className="pb-6 border-b border-slate-200">
                    <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                      <CreditCard className="w-4 h-4" /> Bank Details
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      {viewDetails.documents.bankDetails.accountHolderName && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Account Holder Name</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.documents.bankDetails.accountHolderName}</p>
                        </div>
                      )}
                      {viewDetails.documents.bankDetails.accountNumber && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Account Number</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.documents.bankDetails.accountNumber}</p>
                        </div>
                      )}
                      {viewDetails.documents.bankDetails.ifscCode && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">IFSC Code</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.documents.bankDetails.ifscCode}</p>
                        </div>
                      )}
                      {viewDetails.documents.bankDetails.bankName && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Bank Name</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.documents.bankDetails.bankName}</p>
                        </div>
                      )}
                      {viewDetails.documents.bankDetails.branchName && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Branch</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.documents.bankDetails.branchName}</p>
                        </div>
                      )}
                      {viewDetails.documents.bankDetails.upiId && (
                        <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">UPI ID</label>
                          <p className="text-sm text-slate-900 mt-1">{viewDetails.documents.bankDetails.upiId}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Additional Info */}
                <div className="grid grid-cols-2 gap-4">
                  {viewDetails.signupMethod && (
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Signup Method</label>
                      <p className="text-sm text-slate-900 mt-1 capitalize">{viewDetails.signupMethod}</p>
                    </div>
                  )}
                  {viewDetails.phoneVerified !== undefined && (
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Phone Verified</label>
                      <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium mt-1 ${
                        viewDetails.phoneVerified ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {viewDetails.phoneVerified ? 'Verified' : 'Not Verified'}
                      </span>
                    </div>
                  )}
                  {viewDetails.createdAt && (
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Joined Date</label>
                      <p className="text-sm text-slate-900 mt-1">
                        {new Date(viewDetails.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              </div>
            )}
          </div>
          <DialogFooter className="px-6 pb-6 border-t border-slate-200 gap-2">
            <button
              onClick={() => {
                setIsViewOpen(false)
                handleViewOrderHistory(viewDetails)
              }}
              disabled={!viewDetails?._id && !viewDetails?.id}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-all inline-flex items-center gap-2 disabled:opacity-50"
            >
              <History className="w-4 h-4" />
              Order History
            </button>
            <button
              onClick={() => setIsViewOpen(false)}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-all"
            >
              Close
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Employment & Payout Dialog */}
      <Dialog open={isEmploymentOpen} onOpenChange={setIsEmploymentOpen}>
        <DialogContent className="max-w-lg bg-white p-0 opacity-0 data-[state=open]:opacity-100 data-[state=closed]:opacity-0 transition-opacity duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:scale-100 data-[state=closed]:scale-100">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-200">
            <DialogTitle className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Employment & Payout Model
            </DialogTitle>
            {employmentDetails?.name && (
              <p className="text-sm text-slate-500 mt-1">{employmentDetails.name}</p>
            )}
          </DialogHeader>
          <div className="px-6 py-6">
            {employmentLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              </div>
            ) : employmentDetails ? (
              <div className="grid grid-cols-1 gap-4">
                <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                  <label className="text-xs font-semibold text-slate-500 uppercase">Employment Type</label>
                  <select
                    value={employmentForm.employmentType}
                    onChange={(e) => handleEmploymentFormChange("employmentType", e.target.value)}
                    disabled={employmentUpdating}
                    className="mt-2 block w-full text-sm rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  >
                    <option value="per_order">Per Order</option>
                    <option value="salary">Salary</option>
                  </select>
                  <p className="text-xs text-slate-500 mt-2">
                    {employmentForm.employmentType === 'salary'
                      ? 'Partner receives a fixed salary set by admin (no per-order payout).'
                      : 'Partner earns per delivery based on distance rules.'}
                  </p>
                </div>

                {employmentForm.employmentType === 'salary' && (
                  <>
                    <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                      <label className="text-xs font-semibold text-slate-500 uppercase">Salary Duration</label>
                      <select
                        value={employmentForm.salaryDuration}
                        onChange={(e) => handleEmploymentFormChange("salaryDuration", e.target.value)}
                        disabled={employmentUpdating}
                        className="mt-2 block w-full text-sm rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      >
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                      <p className="text-xs text-slate-500 mt-2">
                        Payout cycle used when marking salary as paid.
                      </p>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                      <label className="text-xs font-semibold text-slate-500 uppercase">Fixed Salary Amount (₹)</label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={employmentForm.salaryAmount}
                        onChange={(e) => handleEmploymentFormChange("salaryAmount", e.target.value)}
                        disabled={employmentUpdating}
                        placeholder="e.g. 15000"
                        className="mt-2 block w-full text-sm rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 px-3 py-2"
                      />
                      <p className="text-xs text-slate-500 mt-2">
                        Admin-set fixed salary for this partner.
                      </p>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>
          <DialogFooter className="px-6 pb-6 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              onClick={() => setIsEmploymentOpen(false)}
              disabled={employmentUpdating}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleEmploymentSave}
              disabled={employmentUpdating || employmentLoading || !employmentDetails || !hasEmploymentChanges}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {employmentUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <DialogContent className="max-w-md bg-white p-0 opacity-0 data-[state=open]:opacity-100 data-[state=closed]:opacity-0 transition-opacity duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:scale-100 data-[state=closed]:scale-100">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Table Settings
            </DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <Columns className="w-4 h-4" />
                Visible Columns
              </h3>
              <div className="space-y-2">
                {Object.entries(columnsConfig).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={visibleColumns[key]}
                      onChange={() => toggleColumn(key)}
                      className="w-4 h-4 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500"
                    />
                    <span className="text-sm text-slate-700">{label}</span>
                    {visibleColumns[key] && (
                      <Check className="w-4 h-4 text-emerald-600 ml-auto" />
                    )}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
              <button
                onClick={resetColumns}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-all"
              >
                Reset
              </button>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-all shadow-md"
              >
                Apply
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

