import { useEffect, useState } from "react"
import { Image, Plus, Trash2, Loader2, GripVertical } from "lucide-react"
import { adminAPI } from "@food/api"
import { toast } from "sonner"

const EMPTY_BANNER = {
  imageUrl: "",
  title: "",
  ctaLink: "",
  isActive: true,
  sortOrder: 0,
  startAt: "",
  endAt: "",
}

export default function PromotionalBanner() {
  const [banners, setBanners] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploadingId, setUploadingId] = useState(null)
  const [savingId, setSavingId] = useState(null)

  const fetchBanners = async () => {
    try {
      setLoading(true)
      const res = await adminAPI.getOfferBanners()
      if (res.data?.success) setBanners(res.data.data?.banners || [])
    } catch {
      toast.error("Failed to load offer banners")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchBanners()
  }, [])

  const addBanner = async () => {
    try {
      const res = await adminAPI.createOfferBanner({ ...EMPTY_BANNER, imageUrl: "https://placehold.co/1200x400?text=Upload+banner" })
      if (res.data?.success) {
        setBanners((prev) => [...prev, res.data.data.banner])
      }
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to add banner")
    }
  }

  const updateField = (id, field, value) => {
    setBanners((prev) => prev.map((b) => (b._id === id ? { ...b, [field]: value } : b)))
  }

  const saveBanner = async (banner) => {
    try {
      setSavingId(banner._id)
      const res = await adminAPI.updateOfferBanner(banner._id, {
        imageUrl: banner.imageUrl,
        title: banner.title,
        ctaLink: banner.ctaLink,
        isActive: banner.isActive,
        sortOrder: Number(banner.sortOrder) || 0,
        startAt: banner.startAt || null,
        endAt: banner.endAt || null,
      })
      if (res.data?.success) toast.success("Banner saved")
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to save banner")
    } finally {
      setSavingId(null)
    }
  }

  const deleteBanner = async (id) => {
    if (!window.confirm("Delete this banner?")) return
    try {
      await adminAPI.deleteOfferBanner(id)
      setBanners((prev) => prev.filter((b) => b._id !== id))
      toast.success("Banner deleted")
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to delete banner")
    }
  }

  const handleImageUpload = async (id, file) => {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file")
      return
    }
    try {
      setUploadingId(id)
      const res = await adminAPI.uploadMedia(file, { folder: "food/offer-banners" })
      const url = res?.data?.data?.url || ""
      if (url) updateField(id, "imageUrl", url)
      else toast.error("Upload failed — no URL returned")
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to upload image")
    } finally {
      setUploadingId(null)
    }
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-5xl mx-auto">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-3">
              <Image className="w-5 h-5 text-slate-600" />
              <h1 className="text-2xl font-bold text-slate-900">Offer Banners</h1>
            </div>
            <button
              type="button"
              onClick={addBanner}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            >
              <Plus className="w-4 h-4" /> Add Banner
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          ) : banners.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-16">No banners yet. Click "Add Banner" to create one.</p>
          ) : (
            <div className="space-y-4">
              {banners.map((banner) => (
                <div key={banner._id} className="border border-slate-200 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <GripVertical className="w-4 h-4 text-slate-300 shrink-0" />
                    <div className="w-32 h-16 rounded-lg overflow-hidden border border-slate-200 shrink-0 bg-slate-50">
                      <img src={banner.imageUrl} alt="" className="w-full h-full object-cover" />
                    </div>
                    <label className="text-xs font-medium text-blue-600 cursor-pointer">
                      {uploadingId === banner._id ? "Uploading..." : "Change image"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={uploadingId === banner._id}
                        onChange={(e) => handleImageUpload(banner._id, e.target.files?.[0])}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => deleteBanner(banner._id)}
                      className="ml-auto p-1.5 rounded text-red-500 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Title</label>
                      <input
                        type="text"
                        value={banner.title || ""}
                        onChange={(e) => updateField(banner._id, "title", e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Link (route or URL)</label>
                      <input
                        type="text"
                        value={banner.ctaLink || ""}
                        onChange={(e) => updateField(banner._id, "ctaLink", e.target.value)}
                        placeholder="/restaurant/123 or https://..."
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Sort order</label>
                      <input
                        type="number"
                        value={banner.sortOrder ?? 0}
                        onChange={(e) => updateField(banner._id, "sortOrder", e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer mt-6">
                      <input
                        type="checkbox"
                        checked={banner.isActive !== false}
                        onChange={(e) => updateField(banner._id, "isActive", e.target.checked)}
                      />
                      <span className="text-sm text-slate-700">Active</span>
                    </label>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Starts (optional)</label>
                      <input
                        type="datetime-local"
                        value={banner.startAt ? String(banner.startAt).slice(0, 16) : ""}
                        onChange={(e) => updateField(banner._id, "startAt", e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Ends (optional)</label>
                      <input
                        type="datetime-local"
                        value={banner.endAt ? String(banner.endAt).slice(0, 16) : ""}
                        onChange={(e) => updateField(banner._id, "endAt", e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => saveBanner(banner)}
                      disabled={savingId === banner._id}
                      className="px-4 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {savingId === banner._id ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
