import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useNavigate } from "react-router-dom"
import { 
  User,
  Utensils,
  Megaphone,
  Settings,
  Monitor,
  Plus,
  Grid3x3,
  Tag,
  FileText,
  MessageSquare,
  Shield,
  Globe,
  MessageCircle,
  CheckSquare,
  LogOut,
  LogIn,
  UserPlus,
  Trash2,
  AlertTriangle
} from "lucide-react"
import { restaurantAPI } from "@food/api"
import { toast } from "sonner"
import { clearModuleAuth } from "@food/utils/auth"

export default function MenuOverlay({ showMenu, setShowMenu }) {
  const navigate = useNavigate()
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem("restaurant_authenticated") === "true"
  })
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false)
  const [deleteStep, setDeleteStep] = useState(1)
  const [deleteCaptcha, setDeleteCaptcha] = useState("")
  const [deleteReason, setDeleteReason] = useState("");
  const [isDeleting, setIsDeleting] = useState(false)

  // Listen for authentication state changes
  useEffect(() => {
    const checkAuth = () => {
      setIsAuthenticated(localStorage.getItem("restaurant_authenticated") === "true")
    }

    // Check on mount
    checkAuth()

    // Listen for storage changes
    window.addEventListener('storage', checkAuth)
    
    // Custom event for same-tab updates
    window.addEventListener('restaurantAuthChanged', checkAuth)

    return () => {
      window.removeEventListener('storage', checkAuth)
      window.removeEventListener('restaurantAuthChanged', checkAuth)
    }
  }, [])

  // Get menu options based on authentication state
  const getMenuOptions = () => {
    const baseOptions = [
      { id: 4, name: "All Food", icon: Utensils, route: "/restaurant/food/all" },
      { id: 6, name: "Restaurant Config", icon: Settings, route: "/restaurant/config" },
      { id: 7, name: "Advertisements", icon: Monitor, route: "/restaurant/advertisements" },
      { id: 9, name: "Categories", icon: Grid3x3, route: "/restaurant/categories" },
      { id: 10, name: "Coupon", icon: Tag, route: "/restaurant/coupon" },
      { id: 11, name: "My Business Plan", icon: FileText, route: "/restaurant/business-plan" },
      { id: 12, name: "Reviews", icon: MessageSquare, route: "/restaurant/reviews" },
      { id: 14, name: "Wallet Method", icon: Settings, route: "/restaurant/wallet" },
      { id: 16, name: "Settings", icon: Settings, route: "/restaurant/settings" },
      { id: 17, name: "Conversation", icon: MessageCircle, route: "/restaurant/conversation" },
      { id: 18, name: "Privacy Policy", icon: Shield, route: "/restaurant/privacy" },
      { id: 19, name: "Terms & Condition", icon: CheckSquare, route: "/restaurant/terms" },
    ]

    if (isAuthenticated) {
      // If authenticated, show logout at the end
      return [
        ...baseOptions,
        { id: 21, name: "Delete Account", icon: Trash2, route: "/delete", isDelete: true },
        { id: 20, name: "Logout", icon: LogOut, route: "/logout", isLogout: true },
      ]
    } else {
      // If not authenticated, show only login at the top
      return [
        { id: 1, name: "Login", icon: LogIn, route: "/restaurant/login" },
        ...baseOptions
      ]
    }
  }

  const menuOptions = getMenuOptions()

  return (
    <>
    <AnimatePresence mode="wait">
      {showMenu && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={() => setShowMenu(false)}
            className="fixed inset-0 bg-black/40 z-[100] backdrop-blur-sm"
          />
          
          {/* Menu Sheet - Full bottom slide */}
          <motion.div
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ 
              type: "spring", 
              damping: 25, 
              stiffness: 300,
              mass: 0.8
            }}
            onClick={(e) => e.stopPropagation()}
            className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl shadow-2xl z-[110] max-h-[90vh] overflow-hidden"
          >
            {/* Drag Handle */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1, duration: 0.3 }}
              className="flex justify-center pt-3 pb-3"
            >
              <div className="w-12 h-1.5 bg-gray-300 rounded-full" />
            </motion.div>

            {/* Menu Grid - Improved Layout */}
            <div className="px-4 pb-20 md:pb-6 pt-2 overflow-y-auto max-h-[calc(90vh-60px)] scrollbar-hide scroll-smooth">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.15, duration: 0.3 }}
                className="grid grid-cols-3 gap-3 md:gap-4"
              >
                {menuOptions.map((option, index) => {
                  const IconComponent = option.icon
                  return (
                    <motion.button
                      key={option.id}
                      initial={{ opacity: 0, y: 20, scale: 0.9 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ 
                        duration: 0.3, 
                        delay: 0.2 + (index * 0.02),
                        type: "spring",
                        stiffness: 200,
                        damping: 20
                      }}
                      whileHover={{ scale: 1.03, y: -2 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => {
                        setShowMenu(false)
                        if (option.isDelete) {
                          setDeleteStep(1);
                          setDeleteCaptcha("");
                          setDeleteAccountOpen(true);
                        } else if (option.isLogout) {
                          // Handle logout
                          if (window.confirm("Are you sure you want to logout?")) {
                            // Clear authentication state
                            localStorage.removeItem("restaurant_authenticated")
                            localStorage.removeItem("restaurant_user")
                            setIsAuthenticated(false)
                            // Dispatch custom event for same-tab updates
                            window.dispatchEvent(new Event('restaurantAuthChanged'))
                            // Redirect to login
                            navigate("/restaurant/login")
                          }
                        } else {
                          navigate(option.route)
                        }
                      }}
                      className={`flex flex-col items-center justify-center gap-2 p-3 md:p-4 rounded-xl transition-all shadow-md hover:shadow-lg ${
                        option.isLogout || option.isDelete
                          ? "bg-red-500 hover:bg-red-600 text-white"
                          : "bg-gradient-to-br from-[#ff8100] to-[#ff9500] hover:from-[#e67300] hover:to-[#e68500] text-white"
                      }`}
                    >
                      <motion.div
                        initial={{ scale: 0, rotate: -180 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ 
                          delay: 0.25 + (index * 0.02),
                          type: "spring",
                          stiffness: 200,
                          damping: 15
                        }}
                        className="flex items-center justify-center"
                      >
                        <IconComponent className="w-5 h-5 md:w-6 md:h-6 text-white flex-shrink-0" />
                      </motion.div>
                      <motion.span 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.35 + (index * 0.02), duration: 0.2 }}
                        className="text-[10px] md:text-[11px] font-semibold text-white text-center leading-tight px-1"
                        style={{ 
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}
                      >
                        {option.name}
                      </motion.span>
                    </motion.button>
                  )
                })}
              </motion.div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>

    {/* Delete Account Confirmation */}
    {deleteAccountOpen && (
      <div
        className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center px-4"
        onClick={() => setDeleteAccountOpen(false)}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {deleteStep === 1 && (
            <div className="p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-red-100 rounded-full p-2.5">
                  <AlertTriangle className="h-6 w-6 text-red-500" />
                </div>
                <h3 className="text-base font-black text-gray-900">Delete Restaurant Account?</h3>
              </div>
              <div className="bg-red-50 rounded-xl p-3.5 mb-4 border border-red-100">
                <p className="text-sm font-semibold text-red-600 mb-2">⚠️ This action is permanent!</p>
                <ul className="text-xs text-red-500/80 space-y-1.5">
                  <li>• Your restaurant profile and all food items will be deleted</li>
                  <li>• Wallet balance and earnings will be forfeited</li>
                  <li>• Order history will be anonymized</li>
                  <li>• Menu, add-ons, and categories will be removed</li>
                  <li>• You can register again as a new restaurant</li>
                </ul>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setDeleteAccountOpen(false)}
                  className="flex-1 h-11 rounded-xl border border-gray-200 text-gray-700 font-bold"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setDeleteStep(2)}
                  className="flex-1 h-11 rounded-xl bg-red-500 text-white font-bold"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {deleteStep === 2 && (
            <div className="p-5">
              <h3 className="text-base font-black text-gray-900 mb-2">Confirm Deletion</h3>
              <p className="text-sm text-gray-500 mb-4">Type <span className="font-bold text-red-500">DELETE MY ACCOUNT</span> to confirm.</p>
              <input
                type="text"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Why are you leaving? (optional)"
                maxLength={200}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 mb-3"
                autoComplete="off"
              />

              <input
                type="text"
                value={deleteCaptcha}
                onChange={(e) => setDeleteCaptcha(e.target.value)}
                placeholder="Type here..."
                className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-400 mb-4"
                autoFocus
                autoComplete="off"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setDeleteStep(1); setDeleteCaptcha(""); }}
                  className="flex-1 h-11 rounded-xl border border-gray-200 text-gray-700 font-bold"
                >
                  Back
                </button>
                <button
                  onClick={async () => {
                    if (isDeleting) return;
                    setIsDeleting(true);
                    try {
                      await restaurantAPI.deleteAccount(deleteReason.trim());
                      toast.success("Restaurant account deleted successfully");
                      clearModuleAuth("restaurant");
                      localStorage.removeItem("restaurant_authenticated");
                      localStorage.removeItem("restaurant_user");
                      setIsAuthenticated(false);
                      window.dispatchEvent(new Event('restaurantAuthChanged'));
                      window.location.href = "/restaurant/login";
                    } catch (err) {
                      toast.error(err?.response?.data?.message || "Failed to delete account");
                    } finally {
                      setIsDeleting(false);
                    }
                  }}
                  disabled={deleteCaptcha.trim() !== "DELETE MY ACCOUNT" || isDeleting}
                  className="flex-1 h-11 rounded-xl bg-red-500 text-white font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isDeleting ? "Deleting..." : "Delete Forever"}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    )}
    </>
  )
}


