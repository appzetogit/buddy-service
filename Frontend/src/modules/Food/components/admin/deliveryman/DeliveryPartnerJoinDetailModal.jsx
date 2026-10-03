import {
  User,
  MapPin,
  Bike,
  Car,
  CreditCard,
  FileCheck,
  ExternalLink,
  Loader2,
  ShieldCheck,
} from "lucide-react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@food/components/ui/dialog"

const formatDate = (value) => {
  if (!value) return "N/A"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "N/A"
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

const statusBadgeClass = (status) => {
  if (status === "pending") return "bg-blue-100 text-blue-700"
  if (status === "approved" || status === "active") return "bg-green-100 text-green-700"
  if (status === "blocked" || status === "rejected" || status === "denied") return "bg-red-100 text-red-700"
  return "bg-slate-100 text-slate-700"
}

function DetailField({ label, value, className = "" }) {
  return (
    <div className={className}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-900 break-words">{value || "N/A"}</p>
    </div>
  )
}

function Section({ title, icon: Icon, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-900">
        {Icon ? <Icon className="h-4 w-4 shrink-0 text-blue-600" /> : null}
        {title}
      </h3>
      {children}
    </section>
  )
}

function DocumentCard({ label, number, documentUrl, backDocumentUrl }) {
  const hasContent = number || documentUrl || backDocumentUrl
  if (!hasContent) return null

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      {number ? <p className="mt-1 text-sm text-slate-800 break-all">No. {number}</p> : null}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {documentUrl ? (
          <DocPreview title="Front" url={documentUrl} />
        ) : null}
        {backDocumentUrl ? (
          <DocPreview title="Back" url={backDocumentUrl} />
        ) : null}
      </div>
    </div>
  )
}

function DocPreview({ title, url }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
      <div className="border-b border-slate-200 px-3 py-2 text-[11px] font-semibold text-slate-600">{title}</div>
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        <img src={url} alt={title} className="h-36 w-full object-cover sm:h-40" />
      </a>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-1 px-3 py-2 text-xs font-semibold text-blue-600 hover:bg-blue-50"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        Open full size
      </a>
    </div>
  )
}

function VehicleBlock({ title, vehicle, icon: Icon }) {
  if (!vehicle) return null
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
      <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-600">
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        {title}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DetailField label="Type" value={vehicle.type} />
        <DetailField label="Number" value={vehicle.number} />
        <DetailField label="Make / Brand" value={vehicle.brand || vehicle.make} />
        <DetailField label="Model" value={vehicle.model} />
        {vehicle.color ? <DetailField label="Color" value={vehicle.color} /> : null}
      </div>
      {(vehicle.photoUrl || vehicle.rcUrl || vehicle.insuranceUrl || vehicle.commercialPermitUrl || vehicle.pucUrl) && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {vehicle.photoUrl ? <DocPreview title="Vehicle photo" url={vehicle.photoUrl} /> : null}
          {vehicle.rcUrl ? <DocPreview title="RC document" url={vehicle.rcUrl} /> : null}
          {vehicle.insuranceUrl ? <DocPreview title="Insurance" url={vehicle.insuranceUrl} /> : null}
          {vehicle.commercialPermitUrl ? <DocPreview title="Commercial permit" url={vehicle.commercialPermitUrl} /> : null}
          {vehicle.pucUrl ? <DocPreview title="PUC certificate" url={vehicle.pucUrl} /> : null}
        </div>
      )}
    </div>
  )
}

const SERVICE_LABELS = {
  food: "Food",
  taxi: "Taxi",
};

export default function DeliveryPartnerJoinDetailModal({
  open,
  onOpenChange,
  details,
  loading,
  adminService = "food",
  onApproveService,
  onRejectService,
  processingService = null,
}) {
  const profileUrl = details?.profileImage?.url || details?.profilePhoto || null
  const bank = details?.documents?.bankDetails
  const services = Array.isArray(details?.onboardingServices) ? details.onboardingServices : []
  const serviceStatuses = details?.serviceStatuses || {}

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex w-full max-h-[92dvh] flex-col p-0 sm:max-h-[90vh] lg:max-w-4xl">
        <DialogHeader className="shrink-0 border-b border-slate-200 px-4 pb-4 pt-2 sm:px-6 sm:pt-4">
          <DialogTitle className="pr-8 text-left text-lg font-bold text-slate-900 sm:text-xl">
            Delivery Partner Details
          </DialogTitle>
          {details?.deliveryId ? (
            <p className="text-left text-xs text-slate-500">ID: {details.deliveryId}</p>
          ) : null}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
              <span className="ml-3 text-sm text-slate-600">Loading details…</span>
            </div>
          ) : details ? (
            <div className="space-y-4 sm:space-y-5">
              {/* Profile header */}
              <div className="flex flex-col items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-start sm:p-5">
                <div className="shrink-0">
                  {profileUrl ? (
                    <img
                      src={profileUrl}
                      alt={details.name}
                      className="h-24 w-24 rounded-full border-2 border-slate-200 object-cover sm:h-28 sm:w-28"
                    />
                  ) : (
                    <div className="flex h-24 w-24 items-center justify-center rounded-full bg-slate-200 sm:h-28 sm:w-28">
                      <User className="h-10 w-10 text-slate-400" />
                    </div>
                  )}
                </div>
                <div className="w-full flex-1">
                  <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                    <h2 className="text-lg font-bold text-slate-900 sm:text-xl">{details.name || "N/A"}</h2>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(details.status)}`}
                    >
                      {details.status === "blocked" ? "Rejected" : details.status || "N/A"}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <DetailField label="Phone" value={`${details.countryCode || ""} ${details.phone || ""}`.trim()} />
                    <DetailField label="Email" value={details.email} />
                    <DetailField label="City" value={details.city} />
                    <DetailField label="State" value={details.state} />
                    <DetailField label="Gender" value={details.gender} />
                    <DetailField label="Joined" value={formatDate(details.createdAt)} />
                    <DetailField label="Availability" value={details.availabilityStatus} />
                  </div>
                  {services.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Services</p>
                      <div className="flex flex-wrap gap-2">
                        {services.map((svc) => {
                          const status = serviceStatuses?.[svc]?.status || "pending"
                          return (
                            <span
                              key={svc}
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${statusBadgeClass(status === "denied" ? "rejected" : status)}`}
                            >
                              {SERVICE_LABELS[svc] || svc} · {status}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}
                  {details.rejectionReason ? (
                    <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
                      <p className="text-[10px] font-bold uppercase text-red-600">Rejection reason</p>
                      <p className="mt-1 text-sm whitespace-pre-wrap text-red-700">{details.rejectionReason}</p>
                    </div>
                  ) : null}
                </div>
              </div>

              {details.location ? (
                <Section title="Location" icon={MapPin}>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {details.location.addressLine1 ? (
                      <DetailField className="sm:col-span-2" label="Address" value={details.location.addressLine1} />
                    ) : null}
                    <DetailField label="City" value={details.location.city} />
                    <DetailField label="State" value={details.location.state} />
                  </div>
                </Section>
              ) : null}

              {(details.vehicle || details.taxiVehicle) && (
                <Section title="Vehicle Details" icon={Bike}>
                  <div className="space-y-3">
                    <VehicleBlock title="Food delivery vehicle" vehicle={details.vehicle} icon={Bike} />
                    <VehicleBlock title="Taxi vehicle" vehicle={details.taxiVehicle} icon={Car} />
                  </div>
                </Section>
              )}

              <Section title="KYC Documents" icon={FileCheck}>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <DocumentCard
                    label="Aadhaar"
                    number={details.documents?.aadhar?.number}
                    documentUrl={details.documents?.aadhar?.document}
                    backDocumentUrl={details.documents?.aadhar?.backDocument}
                  />
                  <DocumentCard
                    label="PAN"
                    number={details.documents?.pan?.number}
                    documentUrl={details.documents?.pan?.document}
                  />
                  <DocumentCard
                    label="Driving licence"
                    number={details.documents?.drivingLicense?.number}
                    documentUrl={details.documents?.drivingLicense?.document}
                  />
                  {details.documents?.selfie?.document ? (
                    <DocumentCard label="Selfie" documentUrl={details.documents.selfie.document} />
                  ) : null}
                </div>
                {!details.documents?.aadhar &&
                !details.documents?.pan &&
                !details.documents?.drivingLicense &&
                !details.documents?.selfie ? (
                  <p className="text-sm text-slate-500">No documents uploaded.</p>
                ) : null}
              </Section>

              <Section title="Payout details" icon={CreditCard}>
                {bank ? (
                  <div className="space-y-3">
                    <DetailField
                      label="Payout method"
                      value={
                        bank.accountNumber && bank.upiId
                          ? "Bank account + UPI"
                          : bank.accountNumber || bank.ifscCode
                            ? "Bank account"
                            : bank.upiId
                              ? "UPI"
                              : null
                      }
                    />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {bank.accountHolderName ? (
                        <DetailField label="Account holder" value={bank.accountHolderName} />
                      ) : null}
                      {bank.accountNumber ? (
                        <DetailField label="Account number" value={bank.accountNumber} />
                      ) : null}
                      {bank.ifscCode ? <DetailField label="IFSC" value={bank.ifscCode} /> : null}
                      {bank.bankName ? <DetailField label="Bank name" value={bank.bankName} /> : null}
                      {bank.branchName ? <DetailField label="Branch" value={bank.branchName} /> : null}
                      {bank.upiId ? <DetailField label="UPI ID" value={bank.upiId} /> : null}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No payout details provided.</p>
                )}
                {bank?.upiQrCode ? (
                  <div className="mt-3 max-w-xs">
                    <DocPreview title="UPI QR code" url={bank.upiQrCode} />
                  </div>
                ) : null}
              </Section>

              <Section title="Additional info" icon={ShieldCheck}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <DetailField label="Employment type" value={details.employmentType} />
                  <DetailField label="Onboarding complete" value={details.onboardingComplete ? "Yes" : "No"} />
                  <DetailField
                    label="Approved at"
                    value={
                      details.approvedAt
                        ? formatDate(details.approvedAt)
                        : details.status === "pending"
                          ? "Pending approval"
                          : null
                    }
                  />
                  {details.rejectedAt || details.status === "blocked" || details.status === "rejected" ? (
                    <DetailField label="Rejected at" value={formatDate(details.rejectedAt)} />
                  ) : null}
                </div>
              </Section>

              {Array.isArray(details.submissionHistory) && details.submissionHistory.length > 0 ? (
                <Section title="Submission history" icon={ShieldCheck}>
                  <div className="space-y-3">
                    {details.submissionHistory.map((entry, index) => (
                      <div
                        key={`${entry.resubmittedAt || entry.submittedAt || index}`}
                        className="rounded-lg border border-slate-200 bg-white p-3 text-sm"
                      >
                        <p className="font-semibold text-slate-900">
                          Submission {index + 1}
                          {entry.status ? ` · ${entry.status}` : ""}
                        </p>
                        {entry.submittedAt ? (
                          <p className="mt-1 text-slate-600">
                            Submitted: {formatDate(entry.submittedAt)}
                          </p>
                        ) : null}
                        {entry.resubmittedAt ? (
                          <p className="mt-1 text-slate-600">
                            Resubmitted: {formatDate(entry.resubmittedAt)}
                          </p>
                        ) : null}
                        {entry.previousRejectionReason ? (
                          <p className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-red-700">
                            Previous rejection: {entry.previousRejectionReason}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </Section>
              ) : null}
            </div>
          ) : (
            <p className="py-12 text-center text-sm text-slate-500">No details available.</p>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-slate-200 px-4 py-4 sm:px-6">
          {details && onApproveService && onRejectService && services.includes(adminService) ? (
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={processingService === adminService}
                onClick={() => onRejectService(adminService)}
                className="w-full rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100 sm:w-auto disabled:opacity-60"
              >
                Reject Driver
              </button>
              <button
                type="button"
                disabled={processingService === adminService}
                onClick={() => onApproveService(adminService)}
                className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 sm:w-auto disabled:opacity-60"
              >
                Approve Driver
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 sm:w-auto"
          >
            Close
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
