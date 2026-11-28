import React, { useEffect, useState } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import {
  User,
  ArrowRight,
  ArrowLeftRight,
  Bike,
  Ticket,
  ChevronRight,
  Share2,
  LogOut,
  X,
  Loader2,
  Briefcase,
  Trash2,
  AlertTriangle,
  Wallet,
  ShieldCheck
} from "lucide-react"
import { deliveryAPI } from "@food/api"
import { toast } from "sonner"
import { clearModuleAuth } from "@food/utils/auth"

/**
 * ProfileV2 - Vibrant Logo Theme.
 * Theme: Vibrant Green (#22C55E) & Deep Tech (#0F172A)
 */
export const ProfileV2 = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [logoutSubmitting, setLogoutSubmitting] = useState(false)
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false)
  const [deleteStep, setDeleteStep] = useState(1)
  const [deleteCaptcha, setDeleteCaptcha] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)

  // Fetch profile data
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        setLoading(true)
        const response = await deliveryAPI.getProfile()
        if (response?.data?.success && response?.data?.data?.profile) {
          setProfile(response.data.data.profile)
        }
      } catch (error) {
        toast.error("Failed to load profile data")
      } finally {
        setLoading(false)
      }
    }
    fetchProfile()
  }, [])



  const handleLogout = async () => {
    if (logoutSubmitting) return
    setShowLogoutConfirm(false)
    try {
      setLogoutSubmitting(true)
      await deliveryAPI.logout()
    } catch (error) {}
    clearModuleAuth("delivery")
    localStorage.removeItem("app:isOnline")
    toast.success("Logged out successfully")
    navigate("/driver/login", { replace: true })
    setLogoutSubmitting(false)
  }

  if (loading) {
    return (
      <div className="delivery-v2-theme min-h-screen flex items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-[#16A34A]" />
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Fetching Profile...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="delivery-v2-theme min-h-screen text-[#0F172A] font-sans pb-24">
      {/* Profile Header Block */}
      <div className="header-blend p-6 safe-top w-full shadow-lg rounded-b-[2.5rem] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16" />
        
        <div 
          onClick={() => navigate('/food/delivery/profile/details')}
          className="relative z-10 flex items-center justify-between cursor-pointer"
        >
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-black text-white uppercase tracking-tight">{profile?.name || "Buddy"}</h2>
              <ChevronRight className="w-5 h-5 text-white/50" />
            </div>
            <p className="text-white/60 text-[9px] font-black uppercase tracking-[0.2em]">{profile?.deliveryId || "PARTNER-ID"}</p>
          </div>
          <div className="relative shrink-0 ml-4">
            {profile?.profileImage?.url ? (
               <div className="w-14 h-14 rounded-2xl border-2 border-white/20 p-0.5 shadow-xl overflow-hidden bg-white/5">
                 <img src={profile.profileImage.url} alt="Profile" className="w-full h-full object-cover rounded-[14px]" />
               </div>
            ) : (
              <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center border border-white/20">
                <User className="w-8 h-8 text-white/20" />
              </div>
            )}
            <div className="absolute -bottom-1 -right-1 bg-white rounded-lg p-1 shadow-xl">
              <Briefcase className="w-3 h-3 text-[#16A34A]" />
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 py-6">
        {/* Quick Stats Grid */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <button 
            onClick={() => navigate('/food/delivery/pocket')}
            className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center gap-2 active:scale-95 transition-all"
          >
            <div className="rounded-xl bg-orange-50 p-2.5 text-orange-500 border border-orange-100">
              <Wallet className="w-6 h-6" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#0F172A]">My wallet</span>
          </button>
          
          <button 
            onClick={() => navigate('/food/delivery/history')}
            className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center gap-2 active:scale-95 transition-all"
          >
            <div className="rounded-xl bg-[#F0FDF4] p-2.5 text-[#16A34A] border border-[#DCFCE7]">
              <Bike className="w-6 h-6" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#0F172A]">Trips history</span>
          </button>
        </div>

        {/* Sections */}
        <div className="space-y-6">
          {/* Switch Service */}
          <button
            onClick={() => navigate("/driver/home")}
            className="w-full bg-white rounded-[1.5rem] p-5 flex items-center justify-between gap-4 shadow-sm border border-gray-100 active:scale-[0.99] transition-all"
          >
            <div className="flex items-center gap-3 min-w-0 text-left">
              <div className="w-11 h-11 rounded-2xl bg-[#0F172A] text-white flex items-center justify-center shrink-0">
                <ArrowLeftRight className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-black text-[#0F172A] uppercase tracking-tight">Switch Service</h3>
                <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mt-0.5">Go to Taxi mode or take a break</p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-300 shrink-0" />
          </button>



          {/* Support Section */}
          <div>
            <h3 className="text-gray-400 text-[10px] font-black uppercase tracking-[0.2em] mb-4 px-2 text-left">Support & Help</h3>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-6">
              <div
                onClick={() => navigate('/food/delivery/help/admin-chat')}
                className="w-full p-4 border-b border-gray-50 flex items-center justify-between active:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#F0FDF4] rounded-xl flex items-center justify-center text-[#16A34A]">
                    <Ticket className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-black text-[#0F172A] uppercase tracking-tight">Chat with Admin</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-200" />
              </div>

              <div 
                onClick={() => navigate('/food/delivery/help/tickets')}
                className="w-full p-4 border-b border-gray-50 flex items-center justify-between active:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#F0FDF4] rounded-xl flex items-center justify-center text-[#16A34A]">
                    <Ticket className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-black text-[#0F172A] uppercase tracking-tight">Support tickets</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-200" />
              </div>

              <div 
                onClick={() => navigate('/food/delivery/terms')}
                className="w-full p-4 border-b border-gray-50 flex items-center justify-between active:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center text-gray-400">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-black text-[#0F172A] uppercase tracking-tight">Terms & Conditions</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-200" />
              </div>
            </div>
          </div>

          {/* Account Management */}
          <div>
            <h3 className="text-gray-400 text-[10px] font-black uppercase tracking-[0.2em] mb-4 px-2 text-left">Account Management</h3>
            <div className="space-y-3">
               <div
                  onClick={() => { setDeleteStep(1); setDeleteCaptcha(""); setDeleteAccountOpen(true); }}
                  className="bg-white rounded-[1.5rem] p-4 flex items-center justify-between cursor-pointer border border-red-50 hover:bg-red-50/30 active:bg-red-50 transition-colors shadow-sm"
               >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center text-red-500">
                      <Trash2 className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-black text-red-500 uppercase tracking-tight">Delete Account</span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-red-200" />
               </div>

               <div 
                  onClick={() => setShowLogoutConfirm(true)}
                  className="bg-white rounded-[1.5rem] p-4 flex items-center justify-between cursor-pointer border border-red-50 hover:bg-red-50/30 active:bg-red-50 transition-colors shadow-sm"
               >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center text-red-600">
                      <LogOut className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-black text-red-600 uppercase tracking-tight">Log out</span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-red-100" />
               </div>
            </div>
          </div>
        </div>
      </div>

      {/* Popups */}
      <AnimatePresence>
        {showLogoutConfirm && (
          <div 
            className="fixed inset-0 bg-black/60 z-[1000] flex items-end sm:items-center justify-center p-4"
            onClick={() => setShowLogoutConfirm(false)}
          >
            <motion.div 
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl p-8"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-black text-[#0F172A] mb-2 uppercase tracking-tight">Ready to logout?</h3>
              <p className="text-[11px] text-gray-500 mb-8 font-bold uppercase tracking-wide">You will need to sign in again to receive new trip requests.</p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={handleLogout}
                  disabled={logoutSubmitting}
                  className="w-full h-16 rounded-2xl bg-[#16A34A] text-[#0F172A] font-black uppercase tracking-[0.2em] text-xs disabled:opacity-60 shadow-xl shadow-green-600/20"
                >
                  {logoutSubmitting ? "Logging out..." : "Yes, Logout"}
                </button>
                <button
                  onClick={() => setShowLogoutConfirm(false)}
                  className="w-full h-12 rounded-xl text-gray-400 font-black uppercase tracking-widest text-[10px]"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteAccountOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-[1000] flex items-end sm:items-center justify-center p-4"
            onClick={() => setDeleteAccountOpen(false)}
          >
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              className="bg-white w-full max-w-sm rounded-[3rem] shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {deleteStep === 1 && (
                <div className="p-8">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="bg-red-50 rounded-2xl p-4">
                      <AlertTriangle className="h-8 w-8 text-red-500" />
                    </div>
                    <h3 className="text-xl font-black text-[#0F172A] uppercase tracking-tight">Delete Account?</h3>
                  </div>
                  <div className="bg-red-50/50 rounded-3xl p-6 mb-8 border border-red-100">
                    <p className="text-[11px] font-black text-red-600 mb-4 uppercase tracking-widest">⚠️ Critical Warning</p>
                    <ul className="text-[10px] text-red-500/80 space-y-2 font-bold uppercase tracking-tight">
                      <li>• Documents will be erased</li>
                      <li>• Earnings will be forfeited</li>
                      <li>• Trip history will be lost</li>
                      <li>• This cannot be undone</li>
                    </ul>
                  </div>
                  <div className="flex flex-col gap-3">
                    <button
                      onClick={() => setDeleteStep(2)}
                      className="w-full h-16 rounded-2xl bg-red-500 text-white font-black uppercase tracking-[0.2em] text-xs shadow-xl shadow-red-500/20"
                    >
                      Understand & Continue
                    </button>
                    <button
                      onClick={() => setDeleteAccountOpen(false)}
                      className="w-full h-12 text-gray-400 font-black uppercase tracking-widest text-[10px]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {deleteStep === 2 && (
                <div className="p-8 text-left">
                  <h3 className="text-xl font-black text-[#0F172A] mb-2 uppercase tracking-tight">Final Confirmation</h3>
                  <p className="text-[11px] text-gray-500 mb-6 font-bold uppercase tracking-wide">Type <span className="text-red-500">DELETE MY ACCOUNT</span> below.</p>
                  <input
                    type="text"
                    value={deleteCaptcha}
                    onChange={(e) => setDeleteCaptcha(e.target.value)}
                    placeholder="Type here..."
                    className="w-full px-6 py-5 rounded-2xl border border-gray-100 bg-gray-50 text-[#0F172A] text-sm font-black focus:outline-none focus:ring-4 focus:ring-red-100 mb-8 uppercase"
                    autoFocus
                  />
                  <div className="flex flex-col gap-3">
                    <button
                      onClick={async () => {
                        if (isDeleting) return;
                        setIsDeleting(true);
                        try {
                          await deliveryAPI.deleteAccount();
                          toast.success("Account deleted");
                          clearModuleAuth("delivery");
                          localStorage.removeItem("app:isOnline");
                          navigate("/driver/login", { replace: true });
                        } catch (err) {
                          toast.error(err?.response?.data?.message || "Failed");
                        } finally {
                          setIsDeleting(false);
                        }
                      }}
                      disabled={deleteCaptcha.trim() !== "DELETE MY ACCOUNT" || isDeleting}
                      className="w-full h-16 rounded-2xl bg-red-600 text-white font-black uppercase tracking-[0.2em] text-xs disabled:opacity-40 shadow-xl shadow-red-600/20"
                    >
                      {isDeleting ? "Processing..." : "Delete Forever"}
                    </button>
                    <button
                      onClick={() => { setDeleteStep(1); setDeleteCaptcha(""); }}
                      className="w-full h-12 text-gray-400 font-black uppercase tracking-widest text-[10px]"
                    >
                      Go Back
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default ProfileV2;
