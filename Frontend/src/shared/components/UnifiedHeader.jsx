import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, ChevronDown, Search, Mic, Bell, CheckCircle2, Tag, Gift, AlertCircle, Clock, BellOff, X, IndianRupee, UtensilsCrossed, ShoppingBag, Zap, Sparkles, Flame, Bike } from 'lucide-react';

function cn(...inputs) {
  return inputs.filter(Boolean).join(' ');
}
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@food/components/ui/popover";
import { Badge } from "@food/components/ui/badge";
import { Avatar, AvatarFallback } from "@food/components/ui/avatar";
import useNotificationInbox from "@food/hooks/useNotificationInbox";

const ICON_MAP = {
  CheckCircle2,
  Tag,
  Gift,
  AlertCircle
};

export default function UnifiedHeader({
  activeTab,
  setActiveTab,
  location,
  savedAddressText,
  handleLocationClick,
  handleSearchFocus,
  placeholderIndex,
  placeholders = ["Search for pizza", "Search for biryani", "Search for burger"],
  vegMode = false,
  handleVegModeChange,
  tone = "light",
  embedded = false,
  children,
  theme,
  hideSearch = false,
  hideLocation = false,
  hideServiceGrid = false,
  hideActions = false,
}) {
  const navigate = useNavigate();
  const [internalPlaceholderIndex, setInternalPlaceholderIndex] = useState(0);
  
  useEffect(() => {
    if (!placeholders?.length || placeholders.length <= 1) return;
    const interval = setInterval(() => {
      setInternalPlaceholderIndex(prev => (prev + 1) % placeholders.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [placeholders]);

  const isLight = tone === "light";
  const currentIndex = placeholderIndex ?? internalPlaceholderIndex;

  const textPrimary = theme?.text || (isLight ? "text-foreground" : "text-white");
  const textSecondary = theme?.sub || (isLight ? "text-muted-foreground" : "text-white/70");
  const textOnMuted = isLight ? "text-muted-foreground" : "text-white/50";

  const [notifications, setNotifications] = useState(() => {
    const saved = localStorage.getItem('food_user_notifications');
    return saved ? JSON.parse(saved) : [];
  });
  
  const {
    items: broadcastNotifications,
    unreadCount: broadcastUnreadCount,
    dismiss: dismissBroadcastNotification,
  } = useNotificationInbox("user", { limit: 20 });

  useEffect(() => {
    const syncNotifications = () => {
      const saved = localStorage.getItem('food_user_notifications');
      setNotifications(saved ? JSON.parse(saved) : []);
    };

    window.addEventListener('notificationsUpdated', syncNotifications);

    return () => window.removeEventListener('notificationsUpdated', syncNotifications);
  }, []);

  const mergedNotifications = useMemo(() => {
    const localItems = Array.isArray(notifications)
      ? notifications.map((item) => ({ ...item, source: "local" }))
      : [];
    const broadcastItems = (broadcastNotifications || []).map((item) => ({
      ...item,
      source: "broadcast",
      time: item.createdAt
        ? new Date(item.createdAt).toLocaleString("en-IN", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })
        : "Just now",
      type: "broadcast",
      icon: "Bell",
      iconColor: "text-blue-600",
    }));

    return [...broadcastItems, ...localItems].sort(
      (a, b) =>
        new Date(b.createdAt || b.timestamp || 0).getTime() -
        new Date(a.createdAt || a.timestamp || 0).getTime()
    );
  }, [broadcastNotifications, notifications]);

  const unreadCount = notifications.filter(n => !n.read).length + broadcastUnreadCount;

  const services = [
    { id: "food", label: "Food", icon: "/super-app/food.png", isImage: true, color: "bg-[#F0F9F9]", activeBg: "bg-[#E0F2F1]", path: "/food/user" },
    { id: "quick", label: "Quick Commerce", icon: "/super-app/grocery.png", isImage: true, color: "bg-[#FFF7E6]", activeBg: "bg-[#FFE8C2]", path: "/quick" },
  ];

  return (
    <div className={cn(
      "relative pt-2 px-4 transition-all duration-500 overflow-hidden",
      embedded ? "pb-1" : "pb-4",
      tone === "dark" && embedded ? "food-header-mobile-dark" : "",
      theme?.section || (
        activeTab === 'food' 
          ? 'bg-gradient-to-b from-[#1A2517]/10 to-transparent' 
          : 'bg-white'
      )
    )}>
      {/* Main Header Content */}
      <div className="relative z-10 space-y-4">
        {/* Row 1: Location & Actions */}
        <div className="flex items-center justify-between gap-3">
          {/* Location Selector */}
          {!hideLocation && (
            <div
              className="flex items-center gap-2 cursor-pointer group min-w-0"
              onClick={handleLocationClick}
            >
              <div className={cn(
                "p-2 rounded-[20px] group-active:scale-95 transition-all shadow-sm",
                isLight ? "bg-white/80 border border-black/5" : "bg-white/10"
              )}>
                <MapPin className={cn("h-4 w-4", textPrimary)} />
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-0.5 min-w-0">
                  <span className={cn("text-[13px] font-bold truncate max-w-[120px] sm:max-w-[180px]", textPrimary)}>
                    {location?.area || location?.city || "Indore"}
                  </span>
                  <ChevronDown className={cn("h-3 w-3 shrink-0", textOnMuted)} />
                </div>
                <span className={cn("text-[10px] font-semibold truncate uppercase tracking-wider", textSecondary)}>
                  {location?.city || "Indore"}
                </span>
              </div>
            </div>
          )}

          {/* Right Actions */}
          {!hideActions && (
            <div className="flex items-center gap-2 shrink-0">
              {/* Pure Veg Toggle */}
              {handleVegModeChange && (
                <button
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-all",
                    vegMode 
                      ? "bg-primary border-primary text-primary-foreground shadow-md shadow-primary/20" 
                      : (isLight ? "bg-white border-border" : "bg-white/5 border-white/10") + " text-muted-foreground"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleVegModeChange(!vegMode);
                  }}
                >
                  <div className={cn(
                    "w-3 h-3 rounded-[3px] border flex items-center justify-center transition-colors",
                    vegMode ? "border-white bg-white" : "border-gray-300 bg-transparent"
                  )}>
                    {vegMode && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                  </div>
                  <span className="text-[10px] font-semibold uppercase tracking-tight">Veg</span>
                </button>
              )}

              <Popover>
                <PopoverTrigger asChild>
                  <div className={cn(
                    "h-10 w-10 relative flex items-center justify-center rounded-2xl cursor-pointer active:scale-90 transition-all",
                    isLight ? "bg-white border border-gray-100 shadow-sm" : "bg-white/10 border border-white/10"
                  )}>
                    <Bell className={cn("h-5 w-5", isLight ? "text-gray-700" : "text-white/90")} />
                    {unreadCount > 0 && (
                      <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-rose-500 border-2 border-white" />
                    )}
                  </div>
                </PopoverTrigger>
                <PopoverContent 
                  className="w-[92vw] sm:w-[380px] p-0 overflow-hidden border-none shadow-2xl rounded-2xl z-[100]" 
                  align="end" 
                  side="bottom"
                  sideOffset={16}
                  collisionPadding={16}
                >
                  <div className="bg-white">
                    <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                      <h3 className="font-bold text-gray-900 flex items-center gap-2 text-sm">
                        Notifications
                        {unreadCount > 0 && <Badge className="bg-rose-500 text-white border-none text-[10px] h-4">{unreadCount}</Badge>}
                      </h3>
                    </div>
                    <div className="max-h-[65vh] sm:max-h-[400px] overflow-y-auto overscroll-contain">
                      {mergedNotifications.length > 0 ? (
                        mergedNotifications.slice(0, 5).map((notif) => {
                          const Icon = ICON_MAP[notif.icon] || Bell;
                          return (
                            <div key={notif.id} className="p-4 flex items-start gap-3 border-b border-gray-50 hover:bg-gray-50 transition-colors">
                              <div className="mt-1 p-2 rounded-full bg-gray-100 text-[#1A2517]">
                                <Icon className="h-3.5 w-3.5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-gray-900 truncate">{notif.title}</p>
                                <p className="text-[11px] text-gray-500 line-clamp-1">{notif.message}</p>
                              </div>
                            </div>
                          )
                        })
                      ) : (
                        <div className="p-8 text-center flex flex-col items-center gap-2">
                          <BellOff className="h-8 w-8 text-gray-200" />
                          <p className="text-xs text-gray-400 font-medium">No new notifications</p>
                        </div>
                      )}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>

        {/* Row 2: Search Bar (Full Width) */}
        {!hideSearch && (
          <div
            className={cn(
              "relative rounded-2xl flex items-center px-4 py-3 cursor-pointer active:scale-[0.99] transition-all duration-300 shadow-sm",
              isLight ? "bg-white border border-gray-200" : "bg-white/10 border border-white/5"
            )}
            onClick={handleSearchFocus}
          >
            <Search className={cn("h-4 w-4 mr-3", isLight ? "text-gray-400" : "text-white/60")} />
            <div className="flex-1 overflow-hidden relative h-5">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={currentIndex}
                  initial={{ y: 15, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -15, opacity: 0 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                  className={cn("absolute inset-0 text-sm font-bold truncate flex items-center", isLight ? "text-gray-400" : "text-white/50")}
                >
                  {placeholders?.[currentIndex] || 'Search...'}
                </motion.span>
              </AnimatePresence>
            </div>
            <Mic className={cn("h-4 w-4 ml-2", isLight ? "text-gray-400" : "text-white/40")} />
          </div>
        )}

        {/* Row 3: Service Grid */}
        {!hideServiceGrid && (
          <div className="pt-2 pb-2">
            <div className="grid grid-cols-2 gap-3">
              {services.map((service) => {
                const isActive = activeTab === service.id;
                const Icon = service.icon;
                const isDarkHero = tone === "dark";
                
                return (
                  <div key={service.id} className="flex flex-col items-center gap-1.5">
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={() => {
                        setActiveTab?.(service.id);
                        navigate(service.path);
                      }}
                      className={cn(
                        "relative w-[4.75rem] h-[4.75rem] rounded-[1.35rem] flex items-center justify-center transition-all duration-300 border-2",
                        isActive 
                          ? (isDarkHero ? "bg-white/95 border-white/30 shadow-lg shadow-black/20" : (service.activeBg || "bg-[#1A2517]") + " border-black/5 shadow-lg")
                          : (isDarkHero ? "bg-white/10 border-white/10 backdrop-blur-sm" : (isLight ? (service.color || "bg-white") : "bg-white/5") + " border-transparent")
                      )}
                    >
                      {service.isImage ? (
                        <img 
                          src={Icon} 
                          alt={service.label} 
                          className="h-14 w-14 object-contain" 
                        />
                      ) : (
                        <Icon className={cn("h-7 w-7", isActive ? "text-white" : service.iconColor)} strokeWidth={2.5} />
                      )}
                      {service.badge && (
                        <span className="absolute -top-1 -right-1 bg-[#ff4500] text-white text-[9px] font-black px-1.5 py-0.5 rounded-full z-10 shadow-sm border border-white">
                          {service.badge}
                        </span>
                      )}
                    </motion.button>
                    <span className={cn(
                      "text-[11px] font-bold tracking-wide capitalize",
                      isActive
                        ? (isDarkHero ? "text-white" : "text-primary")
                        : (isDarkHero ? "text-white/65" : "text-muted-foreground")
                    )}>
                      {service.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        {children && (
          <div className="pt-2">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
