import { useState, useMemo, useEffect } from "react"
import { Search, Filter, Eye, Check, X, Package, ArrowUpDown, FileText, FileSpreadsheet, Loader2 } from "lucide-react"
import { adminAPI } from "@food/api"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@food/components/ui/dialog"
import { exportJoinRequestsToExcel, exportJoinRequestsToPDF } from "@food/components/admin/deliveryman/joinRequestExportUtils"
import DeliveryPartnerJoinDetailModal from "@food/components/admin/deliveryman/DeliveryPartnerJoinDetailModal"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


const SERVICE_TABS = [
  { value: "food", label: "Food" },
  { value: "quickCommerce", label: "Quick Commerce" },
  { value: "taxi", label: "Taxi" },
]

export default function JoinRequest() {
  const [activeTab, setActiveTab] = useState("pending")
  const [activeService, setActiveService] = useState("food")
  const [searchQuery, setSearchQuery] = useState("")
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isApproveOpen, setIsApproveOpen] = useState(false)
  const [isDenyOpen, setIsDenyOpen] = useState(false)
  const [isViewOpen, setIsViewOpen] = useState(false)
  const [selectedRequest, setSelectedRequest] = useState(null)
  const [viewDetails, setViewDetails] = useState(null)
  const [viewLoading, setViewLoading] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [processingService, setProcessingService] = useState(null)
  const [processingAll, setProcessingAll] = useState(false)
  const [rejectionReason, setRejectionReason] = useState("")
  const [filters, setFilters] = useState({
    zone: "",
    jobType: "",
    vehicleType: "",
  })
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [debouncedSearch, setDebouncedSearch] = useState("")

  // Debounce search so we don't fetch on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 500)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Fetch join requests from API (single source of truth for when to fetch)
  const fetchJoinRequests = async () => {
    try {
      setLoading(true)
      setError(null)

      const params = {
        status: activeTab === "pending" ? "pending" : "denied",
        service: activeService,
        page: 1,
        limit: 1000,
      }

      if (debouncedSearch.trim()) {
        params.search = debouncedSearch.trim()
      }
      if (filters.zone) {
        params.zone = filters.zone
      }
      if (filters.vehicleType) {
        params.vehicleType = filters.vehicleType.toLowerCase()
      }

      const response = await adminAPI.getDeliveryPartnerJoinRequests(params)
      
      if (response.data && response.data.success) {
        setRequests(response.data.data.requests || [])
      } else {
        setError("Failed to fetch join requests")
        setRequests([])
      }
    } catch (err) {
      debugError("Error fetching join requests:", err)
      
      // Better error handling
      let errorMessage = "Failed to fetch join requests. Please try again."
      
      if (err.code === 'ERR_NETWORK') {
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
      setRequests([])
    } finally {
      setLoading(false)
    }
  }

  // Single effect: fetch only when tab, debounced search, filters, or filter dialog state change (avoids multiple calls on mount)
  useEffect(() => {
    if (!isFilterOpen) {
      fetchJoinRequests()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, activeService, debouncedSearch, filters, isFilterOpen])

  const filteredRequests = useMemo(() => {
    let result = [...requests]
    
    // Client-side filtering for additional filters not supported by backend
    if (filters.jobType) {
      result = result.filter(request => request.jobType === filters.jobType)
    }

    return result
  }, [requests, filters])

  const handleApprove = (request) => {
    setSelectedRequest(request)
    setIsApproveOpen(true)
  }

  const confirmApprove = async () => {
    if (!selectedRequest) return

    try {
      setProcessing(true)
      // Approves every service the driver selected at onboarding (Food/QC/Taxi), not just
      // whichever tab happens to be open — the admin's "approve" button approves the whole
      // application in one go.
      await adminAPI.approveDeliveryPartnerAllServices(selectedRequest._id)

      // Refresh the list
      await fetchJoinRequests()

      setIsApproveOpen(false)
      setSelectedRequest(null)

      toast.success(`Successfully approved driver ${selectedRequest.name}'s join request!`)
    } catch (err) {
      debugError("Error approving request:", err)
      const msg = err.response?.data?.message ?? err.response?.data?.error ?? err?.message
      toast.error(msg || "Failed to approve driver. Please try again.")
    } finally {
      setProcessing(false)
    }
  }

  const handleDeny = (request) => {
    setSelectedRequest(request)
    setRejectionReason("")
    setIsDenyOpen(true)
  }

  const confirmDeny = async () => {
    if (!selectedRequest) return

    // Validate rejection reason
    if (!rejectionReason.trim()) {
      toast.error("Please provide a reason for rejection")
      return
    }

    try {
      setProcessing(true)
      // Rejects every service the driver selected at onboarding, with this one shared reason.
      await adminAPI.rejectDeliveryPartnerAllServices(selectedRequest._id, rejectionReason.trim())

      // Refresh the list
      await fetchJoinRequests()

      setIsDenyOpen(false)
      setSelectedRequest(null)
      setRejectionReason("")

      toast.success(`Successfully rejected driver ${selectedRequest.name}'s join request.`)
    } catch (err) {
      debugError("Error rejecting request:", err)
      const msg = err.response?.data?.message ?? err.response?.data?.error ?? err?.message
      toast.error(msg || "Failed to reject driver. Please try again.")
    } finally {
      setProcessing(false)
    }
  }

  const handleModalApprove = async (service) => {
    if (!selectedRequest) return
    try {
      setProcessingService(service)
      const approveRes = await adminAPI.approveDeliveryPartner(selectedRequest._id, service)
      await fetchJoinRequests()
      if (selectedRequest) {
        const response = await adminAPI.getDeliveryPartnerById(selectedRequest._id)
        if (response.data?.success) setViewDetails(response.data.data.delivery)
      }
      toast.success(approveRes?.data?.message || "Driver approved successfully")
    } catch (err) {
      toast.error(err.response?.data?.message || err?.message || "Failed to approve driver")
    } finally {
      setProcessingService(null)
    }
  }

  const handleModalReject = async (service) => {
    if (!selectedRequest) return
    const reason = window.prompt("Rejection reason for this driver (required):")
    if (!reason?.trim()) {
      toast.error("Rejection reason is required")
      return
    }
    try {
      setProcessingService(service)
      const rejectRes = await adminAPI.rejectDeliveryPartner(selectedRequest._id, reason.trim(), service)
      await fetchJoinRequests()
      setIsViewOpen(false)
      setViewDetails(null)
      toast.success(rejectRes?.data?.message || "Driver rejected successfully")
    } catch (err) {
      toast.error(err.response?.data?.message || err?.message || "Failed to reject driver")
    } finally {
      setProcessingService(null)
    }
  }

  const handleModalApproveAll = async () => {
    if (!selectedRequest) return
    try {
      setProcessingAll(true)
      const approveRes = await adminAPI.approveDeliveryPartnerAllServices(selectedRequest._id)
      await fetchJoinRequests()
      const response = await adminAPI.getDeliveryPartnerById(selectedRequest._id)
      if (response.data?.success) setViewDetails(response.data.data.delivery)
      toast.success(approveRes?.data?.message || "Driver's entire application approved")
    } catch (err) {
      toast.error(err.response?.data?.message || err?.message || "Failed to approve driver")
    } finally {
      setProcessingAll(false)
    }
  }

  const handleModalRejectAll = async () => {
    if (!selectedRequest) return
    const reason = window.prompt("Rejection reason for the whole application (required):")
    if (!reason?.trim()) {
      toast.error("Rejection reason is required")
      return
    }
    try {
      setProcessingAll(true)
      const rejectRes = await adminAPI.rejectDeliveryPartnerAllServices(selectedRequest._id, reason.trim())
      await fetchJoinRequests()
      setIsViewOpen(false)
      setViewDetails(null)
      toast.success(rejectRes?.data?.message || "Driver's entire application rejected")
    } catch (err) {
      toast.error(err.response?.data?.message || err?.message || "Failed to reject driver")
    } finally {
      setProcessingAll(false)
    }
  }

  const handleView = async (request) => {
    setSelectedRequest(request)
    setViewDetails(null)
    setIsViewOpen(true)
    try {
      setViewLoading(true)
      const response = await adminAPI.getDeliveryPartnerById(request._id)

      if (response.data && response.data.success) {
        setViewDetails(response.data.data.delivery)
      } else {
        toast.error("Failed to load details")
        setIsViewOpen(false)
      }
    } catch (err) {
      debugError("Error fetching details:", err)
      toast.error(err.response?.data?.message || "Failed to load details")
      setIsViewOpen(false)
    } finally {
      setViewLoading(false)
    }
  }

  const handleExportPDF = () => {
    if (filteredRequests.length === 0) {
      toast.error("No data to export")
      return
    }
    exportJoinRequestsToPDF(filteredRequests)
  }

  const handleExportExcel = () => {
    if (filteredRequests.length === 0) {
      toast.error("No data to export")
      return
    }
    exportJoinRequestsToExcel(filteredRequests)
  }

  const handleResetFilters = () => {
    setFilters({ zone: "", jobType: "", vehicleType: "" })
  }

  const handleTabChange = (tab) => {
    setActiveTab(tab)
    setSearchQuery("") // Reset search when changing tabs
    setFilters({ zone: "", jobType: "", vehicleType: "" }) // Reset filters
  }

  const activeFiltersCount = Object.values(filters).filter(v => v).length
  const zones = [...new Set(requests.map(r => r.zone))].filter(Boolean)
  const jobTypes = [...new Set(requests.map(r => r.jobType))].filter(Boolean)
  const vehicleTypes = [...new Set(requests.map(r => r.vehicleType))].filter(Boolean)

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
              <Package className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">New Joining Request</h1>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-2 border-b border-slate-200 mb-6">
            <button
              onClick={() => handleTabChange("pending")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "pending"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              Pending Delivery Man
            </button>
            <button
              onClick={() => handleTabChange("denied")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "denied"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              Denied Deliveryman
            </button>
          </div>

          {/* Service tabs — each service has its own pending/denied queue; a driver who applied
              for Food + Quick Commerce + Taxi shows up on all three until each is approved. */}
          <div className="flex items-center gap-2 mb-6">
            {SERVICE_TABS.map((svc) => (
              <button
                key={svc.value}
                onClick={() => setActiveService(svc.value)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
                  activeService === svc.value
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {svc.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <div className="relative flex-1 sm:flex-initial min-w-[200px]">
                <input
                  type="text"
                  placeholder="Search by name"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 py-2.5 w-full text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
                />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button 
                onClick={() => setIsFilterOpen(true)}
                className={`px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-2 transition-all relative ${
                  activeFiltersCount > 0 ? "border-emerald-500 bg-emerald-50" : ""
                }`}
              >
                <Filter className="w-4 h-4" />
                <span className="text-black font-bold">Filter</span>
                {activeFiltersCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 text-white rounded-full text-[10px] flex items-center justify-center font-bold">
                    {activeFiltersCount}
                  </span>
                )}
              </button>
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
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700">{error}</p>
              <button
                onClick={fetchJoinRequests}
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
                <span className="ml-3 text-sm text-slate-600">Loading requests...</span>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                      <div className="flex items-center gap-2">
                        <span>SI</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                      </div>
                    </th>
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                      <div className="flex items-center gap-2">
                        <span>Name</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                      </div>
                    </th>
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                      <div className="flex items-center gap-2">
                        <span>Contact</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                      </div>
                    </th>
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                      <div className="flex items-center gap-2">
                        <span>Zone</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                      </div>
                    </th>
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                      <div className="flex items-center gap-2">
                        <span>Job Type</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                      </div>
                    </th>
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                      <div className="flex items-center gap-2">
                        <span>Vehicle Type</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                      </div>
                    </th>
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                      Services
                    </th>
                    <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                      <div className="flex items-center gap-2">
                        <span>Availability Status</span>
                        <ArrowUpDown className="w-3 h-3 text-slate-400 cursor-pointer hover:text-slate-600" />
                      </div>
                    </th>
                    <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-700 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {filteredRequests.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-6 py-20 text-center">
                        <p className="text-sm text-slate-500">
                          {error ? "Error loading requests" : "No requests found"}
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredRequests.map((request) => (
                      <tr key={request._id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm font-medium text-slate-700">{request.sl}</span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div 
                              className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center shrink-0 overflow-hidden cursor-pointer hover:opacity-80 transition-all border border-slate-100"
                              onClick={() => handleView(request)}
                            >
                              {(request.profileImage?.url || request.profilePhoto) ? (
                                <img
                                  src={request.profileImage?.url || request.profilePhoto}
                                  alt={request.name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span className="text-sm font-medium text-slate-500">
                                  {request.name?.trim() ? request.name.slice(0, 2).toUpperCase() : "?"}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span
                                className="text-sm font-medium text-slate-900 cursor-pointer hover:text-blue-600 transition-colors"
                                onClick={() => handleView(request)}
                              >
                                {request.name}
                              </span>
                              {request.isResubmission ? (
                                <span className="mt-1 inline-flex w-fit rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">
                                  Resubmitted
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-sm text-slate-700">{request.email}</span>
                            <span className="text-xs text-slate-500">{request.phone}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm text-slate-700">{request.zone}</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm text-slate-700">{request.jobType}</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm text-slate-700">{request.vehicleType}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-slate-700">
                            {request.servicesLabel ||
                              (Array.isArray(request.services) ? request.services.join(", ") : "—")}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-1">
                            <span className={`px-3 py-1 rounded-full text-xs font-medium inline-block w-fit ${
                              request.status === "Pending" || request.status === "pending"
                                ? "bg-blue-100 text-blue-700"
                                : request.status === "Denied" || request.status === "denied" || request.status === "blocked"
                                ? "bg-red-100 text-red-700"
                                : "bg-green-100 text-green-700"
                            }`}>
                              {request.status === "blocked" || request.status === "Blocked" || request.status === "Denied" || request.status === "denied" ? "Rejected" : request.status}
                            </span>
                            {request.rejectionReason && (
                              <span className="text-xs text-red-600 italic max-w-[200px] truncate" title={request.rejectionReason}>
                                {request.rejectionReason}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => handleView(request)}
                              className="p-1.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                              title="View Details"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            {activeTab === "pending" && (
                              <>
                                <button
                                  onClick={() => handleApprove(request)}
                                  disabled={processing}
                                  className="p-1.5 rounded bg-green-50 text-green-600 hover:bg-green-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                  title="Approve"
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDeny(request)}
                                  disabled={processing}
                                  className="p-1.5 rounded bg-red-50 text-red-600 hover:bg-red-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                  title="Deny"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Approve Confirmation Dialog */}
      <Dialog open={isApproveOpen} onOpenChange={setIsApproveOpen}>
        <DialogContent className="max-w-md bg-white p-0 opacity-0 data-[state=open]:opacity-100 data-[state=closed]:opacity-0 transition-opacity duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:scale-100 data-[state=closed]:scale-100">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle>Approve Driver</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6">
            <p className="text-sm text-slate-700">
              Are you sure you want to approve driver "{selectedRequest?.name}"'s join request?
            </p>
          </div>
          <DialogFooter className="px-6 pb-6">
            <button
              onClick={() => setIsApproveOpen(false)}
              disabled={processing}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={confirmApprove}
              disabled={processing}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 transition-all shadow-md disabled:opacity-50 flex items-center gap-2"
            >
              {processing && <Loader2 className="w-4 h-4 animate-spin" />}
              Approve
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deny Confirmation Dialog */}
      <Dialog open={isDenyOpen} onOpenChange={setIsDenyOpen}>
        <DialogContent className="max-w-md bg-white p-0 opacity-0 data-[state=open]:opacity-100 data-[state=closed]:opacity-0 transition-opacity duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:scale-100 data-[state=closed]:scale-100">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle>Reject Driver</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6 space-y-4">
            <p className="text-sm text-slate-700">
              Are you sure you want to reject driver "{selectedRequest?.name}"'s join request?
            </p>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Reason for Rejection <span className="text-red-500">*</span>
              </label>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Please provide specific reasons for rejection (e.g., Invalid documents, Incomplete information, etc.)"
                rows={5}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm resize-none"
                disabled={processing}
              />
              <p className="text-xs text-slate-500 mt-1">
                This reason will be shown to the delivery partner
              </p>
            </div>
          </div>
          <DialogFooter className="px-6 pb-6">
            <button
              onClick={() => {
                setIsDenyOpen(false)
                setRejectionReason("")
              }}
              disabled={processing}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={confirmDeny}
              disabled={processing || !rejectionReason.trim()}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {processing && <Loader2 className="w-4 h-4 animate-spin" />}
              Deny
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeliveryPartnerJoinDetailModal
        open={isViewOpen}
        onOpenChange={(open) => {
          setIsViewOpen(open)
          if (!open) {
            setViewDetails(null)
            setSelectedRequest(null)
          }
        }}
        details={viewDetails}
        loading={viewLoading}
        onApproveService={activeTab === "pending" ? handleModalApprove : undefined}
        onRejectService={activeTab === "pending" ? handleModalReject : undefined}
        onApproveAll={activeTab === "pending" ? handleModalApproveAll : undefined}
        onRejectAll={activeTab === "pending" ? handleModalRejectAll : undefined}
        processingService={processingService}
        processingAll={processingAll}
      />

      {/* Filter Panel */}
      <Dialog open={isFilterOpen} onOpenChange={setIsFilterOpen}>
        <DialogContent className="max-w-md bg-white p-0 opacity-0 data-[state=open]:opacity-100 data-[state=closed]:opacity-0 transition-opacity duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:scale-100 data-[state=closed]:scale-100">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle className="flex items-center gap-2">
              <Filter className="w-5 h-5" />
              Filter Options
            </DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Zone</label>
              <select
                value={filters.zone}
                onChange={(e) => setFilters({ ...filters, zone: e.target.value })}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">All Zones</option>
                {zones.map(zone => (
                  <option key={zone} value={zone}>{zone}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Job Type</label>
              <select
                value={filters.jobType}
                onChange={(e) => setFilters({ ...filters, jobType: e.target.value })}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">All Job Types</option>
                {jobTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Vehicle Type</label>
              <select
                value={filters.vehicleType}
                onChange={(e) => setFilters({ ...filters, vehicleType: e.target.value })}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">All Vehicle Types</option>
                {vehicleTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter className="px-6 pb-6">
            <button
              onClick={handleResetFilters}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-all"
            >
              Reset
            </button>
            <button
              onClick={() => setIsFilterOpen(false)}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-md"
            >
              Apply
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}


