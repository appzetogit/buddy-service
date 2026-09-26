import { useState, useEffect, useRef, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Loader2,
  Minus,
  Plus,
  Upload,
  ChevronLeft,
  ChevronRight,
  ThumbsUp,
  Pencil,
  Utensils,
  ChevronDown
} from "lucide-react"
import RestaurantSubPageShell from "@food/components/restaurant/panel/RestaurantSubPageShell"
import RestaurantPanelModal from "@food/components/restaurant/panel/RestaurantPanelModal"
import MenuItemGridCard from "@food/components/restaurant/panel/MenuItemGridCard"
import { PanelSurface } from "@food/components/restaurant/panel/panelUi"
import InventoryToolbar from "@food/components/restaurant/inventory/InventoryToolbar"
import InventoryCategorySidebar, {
  InventoryCategoryHeader,
} from "@food/components/restaurant/inventory/InventoryCategoryNav"
import { InventoryEmptyState, InventoryStatsRow } from "@food/components/restaurant/inventory/inventoryUi"
import useMediaQuery from "@food/hooks/useMediaQuery"
import { Switch } from "@food/components/ui/switch"
import { useNavigate } from "react-router-dom"
import { restaurantAPI, uploadAPI } from "@food/api"
import { toast } from "sonner"
import { allowsNonVegFood } from "@food/utils/dietaryType"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


const INVENTORY_STORAGE_KEY = "restaurant_inventory_state"
const INVENTORY_RECOMMENDED_KEY = "restaurant_inventory_recommended_map"
const ADDON_FORM_STORAGE_KEY = "restaurant_addon_form_data"
const INVENTORY_ACTIVE_TAB_KEY = "restaurant_inventory_active_tab"
const INVENTORY_ADDON_FORM_KEY = "restaurant_inventory_addon_form"
const INVENTORY_STOCK_RULES_KEY = "restaurant_inventory_stock_rules_v1"

const MENU_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "in-stock", label: "In stock" },
  { value: "out-of-stock", label: "Out of stock" },
  { value: "recommended", label: "Recommended" },
  { value: "veg", label: "Veg" },
  { value: "non-veg", label: "Non-veg" },
]

const ADDON_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "available", label: "Available" },
  { value: "unavailable", label: "Unavailable" },
  { value: "approved", label: "Approved" },
  { value: "pending", label: "Pending" },
  { value: "rejected", label: "Rejected" },
]

const getApprovalDisplayMeta = (approvalStatus) => {
  const normalizedStatus = String(approvalStatus || "approved").toLowerCase()

  if (normalizedStatus === "rejected") {
    return {
      label: "Rejected",
      className: "bg-red-50 text-red-700 border border-red-200",
    }
  }

  if (normalizedStatus === "pending") {
    return {
      label: "Pending",
      className: "bg-amber-50 text-amber-700 border border-amber-200",
    }
  }

  return {
    label: "Approved",
    className: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  }
}

const normalizeDayName = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "")

const parseRestaurantTimeToParts = (value) => {
  const raw = String(value || "").trim()
  if (!raw) return { hours: 9, minutes: 0 }

  const hhmmMatch = raw.match(/^(\d{1,2}):(\d{2})$/)
  if (hhmmMatch) {
    return {
      hours: Math.max(0, Math.min(23, Number(hhmmMatch[1]))),
      minutes: Math.max(0, Math.min(59, Number(hhmmMatch[2]))),
    }
  }

  const meridiemMatch = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i)
  if (meridiemMatch) {
    let hours = Number(meridiemMatch[1])
    const minutes = Number(meridiemMatch[2] || 0)
    const period = meridiemMatch[3].toLowerCase()
    if (period === "pm" && hours !== 12) hours += 12
    if (period === "am" && hours === 12) hours = 0
    return {
      hours: Math.max(0, Math.min(23, hours)),
      minutes: Math.max(0, Math.min(59, minutes)),
    }
  }

  return { hours: 9, minutes: 0 }
}

const buildSpecificTimeResumeAt = (hours) => {
  const totalHours = Math.max(1, Number(hours) || 1)
  const date = new Date()
  date.setHours(date.getHours() + totalHours)
  return date.toISOString()
}

const buildCustomResumeAt = (selectedDate, selectedTime) => {
  if (!selectedDate || !selectedTime) return null

  const date = new Date(selectedDate)
  if (Number.isNaN(date.getTime())) return null

  let hours = Number(selectedTime.hour || 0)
  const minutes = Number(selectedTime.minute || 0)
  const period = String(selectedTime.period || "am").toLowerCase()

  if (period === "pm" && hours !== 12) hours += 12
  if (period === "am" && hours === 12) hours = 0

  date.setHours(hours, minutes, 0, 0)
  return date.toISOString()
}

const buildNextBusinessDayResumeAt = (restaurantProfile) => {
  const now = new Date()
  const openDays = Array.isArray(restaurantProfile?.openDays)
    ? restaurantProfile.openDays.map(normalizeDayName).filter(Boolean)
    : []
  const openingTime = parseRestaurantTimeToParts(
    restaurantProfile?.openingTime || "09:00",
  )

  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = new Date(now)
    candidate.setDate(now.getDate() + offset)
    const dayName = normalizeDayName(
      candidate.toLocaleDateString("en-US", { weekday: "long" }),
    )

    if (openDays.length > 0 && !openDays.includes(dayName)) continue

    candidate.setHours(openingTime.hours, openingTime.minutes, 0, 0)
    return candidate.toISOString()
  }

  const fallback = new Date(now)
  fallback.setDate(now.getDate() + 1)
  fallback.setHours(openingTime.hours, openingTime.minutes, 0, 0)
  return fallback.toISOString()
}

const buildStockRule = ({
  selectedOption,
  hours,
  selectedDate,
  selectedTime,
  restaurantProfile,
}) => {
  const createdAt = new Date().toISOString()

  if (selectedOption === "manual") {
    return { mode: "manual", createdAt, resumeAt: null }
  }

  if (selectedOption === "next-business-day") {
    return {
      mode: "next-business-day",
      createdAt,
      resumeAt: buildNextBusinessDayResumeAt(restaurantProfile),
    }
  }

  if (selectedOption === "custom-date-time") {
    const resumeAt = buildCustomResumeAt(selectedDate, selectedTime)
    return {
      mode: "custom-date-time",
      createdAt,
      resumeAt,
    }
  }

  return {
    mode: "specific-time",
    createdAt,
    durationHours: Math.max(1, Number(hours) || 1),
    resumeAt: buildSpecificTimeResumeAt(hours),
  }
}

const getRuleStatusLabel = (rule) => {
  if (!rule) return "No time set. Turn item in stock manually."
  if (rule.mode === "manual") {
    return "Manual off. Turn item in stock manually."
  }

  const resumeAt = new Date(rule.resumeAt || "")
  if (Number.isNaN(resumeAt.getTime())) {
    return "Out of stock"
  }

  const formatted = resumeAt.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })

  if (rule.mode === "specific-time") return `Out of stock until ${formatted}`
  if (rule.mode === "next-business-day") return `Back next business day at ${formatted}`
  if (rule.mode === "custom-date-time") return `Out of stock until ${formatted}`
  return "Out of stock"
}

// Time Picker Wheel Component (copied from DaySlots.jsx)
function TimePickerWheel({
  isOpen,
  onClose,
  initialHour,
  initialMinute,
  initialPeriod,
  onConfirm
}) {
  const parsedHour = Math.max(1, Math.min(12, parseInt(initialHour) || 1))
  const parsedMinute = Math.max(0, Math.min(59, parseInt(initialMinute) || 0))
  const parsedPeriod = (initialPeriod === "am" || initialPeriod === "pm") ? initialPeriod : "am"

  const [selectedHour, setSelectedHour] = useState(parsedHour)
  const [selectedMinute, setSelectedMinute] = useState(parsedMinute)
  const [selectedPeriod, setSelectedPeriod] = useState(parsedPeriod)

  const hourRef = useRef(null)
  const minuteRef = useRef(null)
  const periodRef = useRef(null)
  const scrollTimeoutRef = useRef(null)
  const isScrollingRef = useRef(false)

  const hours = Array.from({ length: 12 }, (_, i) => i + 1)
  const minutes = Array.from({ length: 60 }, (_, i) => i)
  const periods = ["am", "pm"]

  useEffect(() => {
    if (isOpen) {
      setSelectedHour(parsedHour)
      setSelectedMinute(parsedMinute)
      setSelectedPeriod(parsedPeriod)
    }
  }, [isOpen, initialHour, initialMinute, initialPeriod, parsedHour, parsedMinute, parsedPeriod])

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'

      const timer = setTimeout(() => {
        const padding = 80
        const itemHeight = 40

        const hourIndex = parsedHour - 1
        const hourScrollPos = padding + (hourIndex * itemHeight)
        if (hourRef.current) {
          hourRef.current.scrollTop = hourScrollPos
          setSelectedHour(parsedHour)
          setTimeout(() => {
            hourRef.current?.scrollTo({
              top: hourScrollPos,
              behavior: 'smooth'
            })
          }, 50)
        }

        const minuteIndex = Math.max(0, Math.min(59, parsedMinute))
        const minuteScrollPos = padding + (minuteIndex * itemHeight)
        if (minuteRef.current) {
          minuteRef.current.scrollTop = minuteScrollPos
          setSelectedMinute(minuteIndex)
          setTimeout(() => {
            minuteRef.current?.scrollTo({
              top: minuteScrollPos,
              behavior: 'smooth'
            })
          }, 50)
        }

        const periodIndex = periods.indexOf(parsedPeriod)
        const periodScrollPos = padding + (periodIndex * itemHeight)
        if (periodRef.current) {
          periodRef.current.scrollTop = periodScrollPos
          setSelectedPeriod(parsedPeriod)
          setTimeout(() => {
            periodRef.current?.scrollTo({
              top: periodScrollPos,
              behavior: 'smooth'
            })
          }, 50)
        }
      }, 150)

      return () => {
        clearTimeout(timer)
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current)
        }
        document.body.style.overflow = 'unset'
      }
    }
  }, [isOpen, parsedHour, parsedMinute, parsedPeriod])

  const handleScroll = (container, setValue, values, itemHeight) => {
    if (!container || isScrollingRef.current) return

    const padding = 80
    const scrollTop = container.scrollTop
    const index = Math.round((scrollTop - padding) / itemHeight)
    const clampedIndex = Math.max(0, Math.min(index, values.length - 1))
    const newValue = values[clampedIndex]

    if (newValue !== undefined) {
      setValue(newValue)
    }

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }

    isScrollingRef.current = true
    scrollTimeoutRef.current = setTimeout(() => {
      const finalIndex = Math.round((container.scrollTop - padding) / itemHeight)
      const finalClampedIndex = Math.max(0, Math.min(finalIndex, values.length - 1))
      const snapPosition = padding + (finalClampedIndex * itemHeight)
      container.scrollTop = snapPosition
      if (values[finalClampedIndex] !== undefined) {
        setValue(values[finalClampedIndex])
      }
      setTimeout(() => {
        container.scrollTo({
          top: snapPosition,
          behavior: 'smooth'
        })
      }, 50)

      setTimeout(() => {
        isScrollingRef.current = false
      }, 300)
    }, 150)
  }

  const handleConfirm = () => {
    const hourStr = selectedHour.toString()
    const minuteStr = selectedMinute.toString().padStart(2, '0')
    onConfirm(hourStr, minuteStr, selectedPeriod)
    onClose()
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="bg-white rounded-lg shadow-2xl w-full max-w-xs overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-center py-8 px-4 relative">
            <style>{`
              .time-picker-scroll::-webkit-scrollbar {
                display: none;
              }
              .time-picker-scroll {
                -ms-overflow-style: none;
                scrollbar-width: none;
              }
            `}</style>

            <div className="flex-1 flex flex-col items-center">
              <div
                ref={hourRef}
                className="w-full h-48 overflow-y-scroll time-picker-scroll snap-y snap-mandatory"
                style={{
                  scrollSnapType: 'y mandatory',
                  scrollBehavior: 'smooth',
                  WebkitOverflowScrolling: 'touch'
                }}
                onScroll={() => handleScroll(hourRef.current, setSelectedHour, hours, 40)}
                onTouchEnd={() => {
                  setTimeout(() => {
                    if (hourRef.current) {
                      const padding = 80
                      const itemHeight = 40
                      const scrollTop = hourRef.current.scrollTop
                      const index = Math.round((scrollTop - padding) / itemHeight)
                      const clampedIndex = Math.max(0, Math.min(index, hours.length - 1))
                      const snapPosition = padding + (clampedIndex * itemHeight)
                      hourRef.current.scrollTop = snapPosition
                      if (hours[clampedIndex] !== undefined) {
                        setSelectedHour(hours[clampedIndex])
                      }
                      setTimeout(() => {
                        hourRef.current?.scrollTo({
                          top: snapPosition,
                          behavior: 'smooth'
                        })
                      }, 50)
                    }
                  }, 100)
                }}
              >
                <div className="h-20"></div>
                {hours.map((hour) => (
                  <div
                    key={hour}
                    className="h-10 flex items-center justify-center snap-center"
                    style={{ minHeight: '40px' }}
                  >
                    <span
                      className={`text-lg transition-all duration-200 ${selectedHour === hour
                          ? 'font-bold text-gray-900 text-xl'
                          : 'font-normal text-gray-400 text-base'
                        }`}
                    >
                      {hour}
                    </span>
                  </div>
                ))}
                <div className="h-20"></div>
              </div>
            </div>

            <div className="px-2">
              <span className="text-2xl font-bold text-gray-900">:</span>
            </div>

            <div className="flex-1 flex flex-col items-center">
              <div
                ref={minuteRef}
                className="w-full h-48 overflow-y-scroll time-picker-scroll snap-y snap-mandatory"
                style={{
                  scrollSnapType: 'y mandatory',
                  scrollBehavior: 'smooth',
                  WebkitOverflowScrolling: 'touch'
                }}
                onScroll={() => handleScroll(minuteRef.current, setSelectedMinute, minutes, 40)}
                onTouchEnd={() => {
                  setTimeout(() => {
                    if (minuteRef.current) {
                      const padding = 80
                      const itemHeight = 40
                      const scrollTop = minuteRef.current.scrollTop
                      const index = Math.round((scrollTop - padding) / itemHeight)
                      const clampedIndex = Math.max(0, Math.min(index, minutes.length - 1))
                      const snapPosition = padding + (clampedIndex * itemHeight)
                      minuteRef.current.scrollTop = snapPosition
                      if (minutes[clampedIndex] !== undefined) {
                        setSelectedMinute(minutes[clampedIndex])
                      }
                      setTimeout(() => {
                        minuteRef.current?.scrollTo({
                          top: snapPosition,
                          behavior: 'smooth'
                        })
                      }, 50)
                    }
                  }, 100)
                }}
              >
                <div className="h-20"></div>
                {minutes.map((minute) => (
                  <div
                    key={minute}
                    className="h-10 flex items-center justify-center snap-center"
                    style={{ minHeight: '40px' }}
                  >
                    <span
                      className={`text-lg transition-all duration-200 ${selectedMinute === minute
                          ? 'font-bold text-gray-900 text-xl'
                          : 'font-normal text-gray-400 text-base'
                        }`}
                    >
                      {minute.toString().padStart(2, '0')}
                    </span>
                  </div>
                ))}
                <div className="h-20"></div>
              </div>
            </div>

            <div className="flex-1 flex flex-col items-center">
              <div
                ref={periodRef}
                className="w-full h-48 overflow-y-scroll time-picker-scroll snap-y snap-mandatory"
                style={{
                  scrollSnapType: 'y mandatory',
                  scrollBehavior: 'smooth',
                  WebkitOverflowScrolling: 'touch'
                }}
                onScroll={() => handleScroll(periodRef.current, setSelectedPeriod, periods, 40)}
                onTouchEnd={() => {
                  setTimeout(() => {
                    if (periodRef.current) {
                      const padding = 80
                      const itemHeight = 40
                      const scrollTop = periodRef.current.scrollTop
                      const index = Math.round((scrollTop - padding) / itemHeight)
                      const clampedIndex = Math.max(0, Math.min(index, periods.length - 1))
                      const snapPosition = padding + (clampedIndex * itemHeight)
                      periodRef.current.scrollTop = snapPosition
                      if (periods[clampedIndex] !== undefined) {
                        setSelectedPeriod(periods[clampedIndex])
                      }
                      setTimeout(() => {
                        periodRef.current?.scrollTo({
                          top: snapPosition,
                          behavior: 'smooth'
                        })
                      }, 50)
                    }
                  }, 100)
                }}
              >
                <div className="h-20"></div>
                {periods.map((period) => (
                  <div
                    key={period}
                    className="h-10 flex items-center justify-center snap-center"
                    style={{ minHeight: '40px' }}
                  >
                    <span
                      className={`text-lg transition-all duration-200 ${selectedPeriod === period
                          ? 'font-bold text-gray-900 text-xl'
                          : 'font-normal text-gray-400 text-base'
                        }`}
                    >
                      {period}
                    </span>
                  </div>
                ))}
                <div className="h-20"></div>
              </div>
            </div>

            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 pointer-events-none">
              <div className="border-t border-gray-300 mx-4"></div>
              <div className="border-b border-gray-300 mx-4 mt-10"></div>
            </div>
          </div>

          <div className="border-t border-gray-200 px-4 py-4 flex justify-center">
            <button
              onClick={handleConfirm}
              className="text-blue-600 hover:text-blue-700 font-medium text-base transition-colors"
            >
              Okay
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// Simple Calendar Component
function SimpleCalendar({ selectedDate, onDateSelect, isOpen, onClose }) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    return selectedDate ? new Date(selectedDate) : new Date()
  })
  const calendarRef = useRef(null)

  useEffect(() => {
    if (selectedDate) {
      setCurrentMonth(new Date(selectedDate))
    }
  }, [selectedDate])

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (calendarRef.current && !calendarRef.current.contains(event.target)) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])

  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()
    const firstDay = new Date(year, month, 1)
    const startDate = new Date(firstDay)
    startDate.setDate(startDate.getDate() - startDate.getDay() + (startDate.getDay() === 0 ? -6 : 1))

    const days = []
    const currentDate = new Date(startDate)

    for (let i = 0; i < 42; i++) {
      days.push(new Date(currentDate))
      currentDate.setDate(currentDate.getDate() + 1)
    }

    return days
  }, [currentMonth])

  const isCurrentMonth = (date) => {
    return date.getMonth() === currentMonth.getMonth()
  }

  const isSelected = (date) => {
    if (!selectedDate) return false
    return date.toDateString() === new Date(selectedDate).toDateString()
  }

  const isToday = (date) => {
    return date.toDateString() === new Date().toDateString()
  }

  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"]
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 z-[9998] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="bg-white rounded-lg shadow-2xl w-full max-w-sm overflow-hidden"
          onClick={(e) => e.stopPropagation()}
          ref={calendarRef}
        >
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => {
                  const prevMonth = new Date(currentMonth)
                  prevMonth.setMonth(prevMonth.getMonth() - 1)
                  setCurrentMonth(prevMonth)
                }}
                className="p-1 hover:bg-gray-100 rounded"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <h3 className="text-lg font-semibold">
                {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
              </h3>
              <button
                onClick={() => {
                  const nextMonth = new Date(currentMonth)
                  nextMonth.setMonth(nextMonth.getMonth() + 1)
                  setCurrentMonth(nextMonth)
                }}
                className="p-1 hover:bg-gray-100 rounded"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 mb-2">
              {dayNames.map(day => (
                <div key={day} className="text-center text-xs font-medium text-gray-500 py-2">
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((date, index) => {
                const isCurrent = isCurrentMonth(date)
                const isSelectedDate = isSelected(date)
                const isTodayDate = isToday(date)

                return (
                  <button
                    key={index}
                    onClick={() => {
                      onDateSelect(new Date(date))
                      onClose()
                    }}
                    className={`h-10 text-sm rounded transition-colors ${!isCurrent
                        ? 'text-gray-300'
                        : isSelectedDate
                          ? 'bg-[#16A34A] text-white'
                          : isTodayDate
                            ? 'bg-[#f9f0f7] text-[#16A34A] font-semibold'
                            : 'text-gray-700 hover:bg-gray-100'
                      }`}
                  >
                    {date.getDate()}
                  </button>
                )
              })}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export default function Inventory() {
  const navigate = useNavigate()
  const isDesktop = useMediaQuery("(min-width: 1024px)")
  const [activeCategoryPill, setActiveCategoryPill] = useState("all")
  const [activeTab, setActiveTab] = useState(() => {
    try {
      if (typeof window === "undefined") return "all-items"
      const saved = localStorage.getItem(INVENTORY_ACTIVE_TAB_KEY)
      return saved || "all-items"
    } catch {
      return "all-items"
    }
  })
  const [searchQuery, setSearchQuery] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectedFilter, setSelectedFilter] = useState("all")
  const [isLoading, setIsLoading] = useState(false)
  const [loadingInventory, setLoadingInventory] = useState(false)
  const [categories, setCategories] = useState(() => {
    try {
      if (typeof window === "undefined") return []
      const saved = localStorage.getItem(INVENTORY_STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) {
          return parsed
        }
      }
    } catch (error) {
      debugError("Error loading inventory from storage:", error)
    }
    return []
  })
  const [expandedCategories, setExpandedCategories] = useState([])
  const [togglePopupOpen, setTogglePopupOpen] = useState(false)
  const [toggleTarget, setToggleTarget] = useState(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isAddPopupOpen, setIsAddPopupOpen] = useState(false)

  // Toggle popup state
  const [selectedOption, setSelectedOption] = useState("specific-time")
  const [hours, setHours] = useState(3)
  const [selectedDate, setSelectedDate] = useState(null)
  const [selectedTime, setSelectedTime] = useState({ hour: "2", minute: "30", period: "pm" })
  const [showCalendar, setShowCalendar] = useState(false)
  const [showTimePicker, setShowTimePicker] = useState(false)
  const [restaurantProfile, setRestaurantProfile] = useState(null)
  const [stockRules, setStockRules] = useState(() => {
    try {
      if (typeof window === "undefined") return {}
      const raw = localStorage.getItem(INVENTORY_STOCK_RULES_KEY)
      const parsed = raw ? JSON.parse(raw) : {}
      return parsed && typeof parsed === "object" ? parsed : {}
    } catch (error) {
      debugWarn("Failed to load stock rules:", error)
      return {}
    }
  })

  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [isFetchingMore, setIsFetchingMore] = useState(false)
  const [totalItemsCount, setTotalItemsCount] = useState(0)
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("")

  const categoryRefs = useRef({})
  const addonImageInputRef = useRef(null)
  const loadMoreRef = useRef(null)

  // Swipe gesture refs
  const touchStartX = useRef(0)
  const touchEndX = useRef(0)
  const touchStartY = useRef(0)
  const isSwiping = useRef(false)
  const mouseStartX = useRef(0)
  const mouseEndX = useRef(0)
  const isMouseDown = useRef(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [addons, setAddons] = useState([])
  const [loadingAddons, setLoadingAddons] = useState(false)
  const [isAddAddonOpen, setIsAddAddonOpen] = useState(false)
  const [addonName, setAddonName] = useState("")
  const [addonDescription, setAddonDescription] = useState("")
  const [addonPrice, setAddonPrice] = useState("")
  const [addonImageFile, setAddonImageFile] = useState(null)
  const [addonImagePreview, setAddonImagePreview] = useState("")
  const [savingAddon, setSavingAddon] = useState(false)
  const [recommendedMap, setRecommendedMap] = useState(() => {
    try {
      if (typeof window === "undefined") return {}
      const raw = localStorage.getItem(INVENTORY_RECOMMENDED_KEY)
      const parsed = raw ? JSON.parse(raw) : {}
      return parsed && typeof parsed === "object" ? parsed : {}
    } catch (error) {
      debugWarn("Failed to load recommended map:", error)
      return {}
    }
  })

  // Inventory tabs
  const inventoryTabs = ["all-items", "add-ons"]

  // Tab bar ref for excluding swipe on topbar
  const tabBarRef = useRef(null)

  // Content container ref
  const contentContainerRef = useRef(null)

  useEffect(() => {
    const fetchRestaurantProfile = async () => {
      try {
        const response = await restaurantAPI.getCurrentRestaurant()
        const profile =
          response?.data?.data?.restaurant ||
          response?.data?.restaurant ||
          response?.data?.data ||
          null
        setRestaurantProfile(profile)
      } catch (error) {
        debugWarn("Failed to load restaurant profile for stock rules:", error)
      }
    }

    fetchRestaurantProfile()
  }, [])

  // Debounce search query
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, 400)

    return () => {
      clearTimeout(handler)
    }
  }, [searchQuery])

  // Fetch menu items from API and convert to inventory format
  const fetchMenuData = async (targetPage, shouldAppend = false) => {
    try {
      if (targetPage === 1) {
        setLoadingInventory(true)
      } else {
        setIsFetchingMore(true)
      }

      // Collect recommended IDs if active filter is recommended
      let recommendedIds = []
      if (selectedFilter === "recommended") {
        recommendedIds = Object.keys(recommendedMap).filter((id) => recommendedMap[id])
      }

      const params = {
        page: targetPage,
        limit: 15,
        search: searchQuery.trim(),
        filter: selectedFilter,
        recommendedIds: recommendedIds.join(",")
      }

      const menuResponse = await restaurantAPI.getMenu(params)

      if (menuResponse.data && menuResponse.data.success && menuResponse.data.data && menuResponse.data.data.menu) {
        const menuSections = menuResponse.data.data.menu.sections || []
        const pagination = menuResponse.data.data.menu.pagination || {}

        // Convert menu sections to inventory categories
        const newConvertedCategories = menuSections.map((section, sectionIndex) => {
          // Collect all items from section and subsections
          const allItems = []

          // Add direct items from section
          if (Array.isArray(section.items)) {
            section.items.forEach(item => {
              allItems.push({
                id: String(item.id || Date.now() + Math.random()),
                name: item.name || "Unnamed Item",
                description: item.description || "",
                image: item.image || "",
                images: item.image ? [item.image] : [],
                price: item.price ?? "",
                variants: Array.isArray(item.variants) ? item.variants : (Array.isArray(item.variations) ? item.variations : []),
                category: section.name || "",
                categoryId: section.categoryId || section.id || "",
                categoryDisabled: item.categoryDisabled === true,
                categoryDisabledByAdmin: item.categoryDisabledByAdmin === true,
                inStock: item.isAvailable !== undefined ? item.isAvailable : true,
                isAvailable: item.isAvailable !== undefined ? item.isAvailable : true,
                isVeg: item.foodType === "Veg",
                foodType: item.foodType || "Non-Veg",
                approvalStatus: String(item.approvalStatus || "approved").toLowerCase(),
                rejectionReason: item.rejectionReason || "",
                isRecommended: Boolean(recommendedMap?.[String(item.id)]),
                stockQuantity: item.stock || "Unlimited",
                unit: item.itemSizeUnit || "piece",
                expiryDate: null,
                lastRestocked: null,
              })
            })
          }

          // Add items from subsections
          if (Array.isArray(section.subsections)) {
            section.subsections.forEach(subsection => {
              if (Array.isArray(subsection.items)) {
                subsection.items.forEach(item => {
                  allItems.push({
                    id: String(item.id || Date.now() + Math.random()),
                    name: item.name || "Unnamed Item",
                    description: item.description || "",
                    image: item.image || "",
                    images: item.image ? [item.image] : [],
                    price: item.price ?? "",
                    variants: Array.isArray(item.variants) ? item.variants : (Array.isArray(item.variations) ? item.variations : []),
                    category: section.name || subsection.name || "",
                    categoryId: section.categoryId || section.id || "",
                    categoryDisabled: item.categoryDisabled === true || section.categoryDisabled === true,
                    categoryDisabledByAdmin: item.categoryDisabledByAdmin === true || section.categoryDisabledByAdmin === true,
                    inStock: item.isAvailable !== undefined ? item.isAvailable : true,
                    isAvailable: item.isAvailable !== undefined ? item.isAvailable : true,
                    isVeg: item.foodType === "Veg",
                    foodType: item.foodType || "Non-Veg",
                    approvalStatus: String(item.approvalStatus || "approved").toLowerCase(),
                    rejectionReason: item.rejectionReason || "",
                    isRecommended: Boolean(recommendedMap?.[String(item.id)]),
                    stockQuantity: item.stock || "Unlimited",
                    unit: item.itemSizeUnit || "piece",
                    expiryDate: null,
                    lastRestocked: null,
                  })
                })
              }
            })
          }

          const categoryInStock = allItems.length > 0 ? allItems.every(i => i.inStock) : true
          const itemCount = allItems.length

          return {
            id: section.id || `category-${sectionIndex}`,
            name: section.name || "Unnamed Category",
            description: section.description || "",
            itemCount: itemCount,
            inStock: categoryInStock,
            categoryDisabled: section.categoryDisabled === true,
            categoryDisabledByAdmin: section.categoryDisabledByAdmin === true,
            categoryIsActive: section.categoryIsActive !== false,
            items: allItems,
            order: section.order !== undefined ? section.order : sectionIndex,
          }
        })

        const nowMs = Date.now()
        const withStockRules = newConvertedCategories.map((category) => {
          const ruledItems = (category.items || []).map((item) => {
            const rule = stockRules?.[String(item.id)] || null
            const isActiveRule =
              rule &&
              (rule.mode === "manual" ||
                (rule.resumeAt && new Date(rule.resumeAt).getTime() > nowMs))

            if (!isActiveRule) return item
            return {
              ...item,
              inStock: false,
              isAvailable: false,
              stockRule: rule,
            }
          })

          return {
            ...category,
            items: ruledItems,
            itemCount: ruledItems.length,
            inStock: ruledItems.length > 0 ? ruledItems.every((item) => item.inStock) : true,
          }
        })

        // Merge or replace categories list
        if (shouldAppend) {
          setCategories((prevCategories) => {
            const merged = [...prevCategories]
            withStockRules.forEach((newCat) => {
              const existingCatIndex = merged.findIndex((c) => String(c.id) === String(newCat.id))
              if (existingCatIndex > -1) {
                const existingCat = merged[existingCatIndex]
                const updatedItems = [...existingCat.items]

                newCat.items.forEach((item) => {
                  if (!updatedItems.some((it) => String(it.id) === String(item.id))) {
                    updatedItems.push(item)
                  }
                })

                merged[existingCatIndex] = {
                  ...existingCat,
                  items: updatedItems,
                  itemCount: updatedItems.length,
                  inStock: updatedItems.length > 0 ? updatedItems.every((item) => item.inStock) : true
                }
              } else {
                merged.push(newCat)
              }
            })
            return merged
          })
        } else {
          setCategories(withStockRules)
          setExpandedCategories(withStockRules.map(c => c.id))
        }

        const currentPage = Number(pagination.page) || targetPage
        const totalPagesCount = Number(pagination.totalPages) || 1
        setTotalPages(totalPagesCount)
        setHasMore(currentPage < totalPagesCount)
        setTotalItemsCount(pagination.totalItems || 0)
      } else {
        if (!shouldAppend) {
          setCategories([])
          setExpandedCategories([])
        }
        setHasMore(false)
      }
    } catch (error) {
      if (error.code !== 'ERR_NETWORK' && error.code !== 'ECONNABORTED' && !error.message?.includes('timeout')) {
        debugError('Error fetching menu data:', error)
        toast.error('Failed to load menu data')
      }
      if (!shouldAppend) {
        setCategories([])
        setExpandedCategories([])
      }
      setHasMore(false)
    } finally {
      setLoadingInventory(false)
      setIsFetchingMore(false)
    }
  }

  // Load first page of data when dependencies change
  useEffect(() => {
    if (activeTab === "all-items") {
      setPage(1)
      fetchMenuData(1, false)
    }
  }, [debouncedSearchQuery, selectedFilter, activeTab])

  // Load next pages
  const loadMoreItems = () => {
    if (isFetchingMore || !hasMore || loadingInventory) return
    const nextPage = page + 1
    setPage(nextPage)
    fetchMenuData(nextPage, true)
  }

  // Setup intersection observer
  useEffect(() => {
    if (activeTab !== "all-items" || !hasMore || loadingInventory || isFetchingMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMoreItems()
        }
      },
      { threshold: 0.1 }
    )

    const target = loadMoreRef.current
    if (target) {
      observer.observe(target)
    }

    return () => {
      if (target) {
        observer.unobserve(target)
      }
    }
  }, [hasMore, page, loadingInventory, isFetchingMore, activeTab])

  // Note: Menu items are now displayed from menu API
  // Stock status updates should be managed through the menu API, not inventory API
  // Fetch add-ons when add-ons tab is active
  const fetchAddons = async (showLoading = true) => {
    try {
      if (showLoading) setLoadingAddons(true)
      const response = await restaurantAPI.getAddons()
      const data = response?.data?.data?.addons || response?.data?.addons || []
      const getAddonCreatedMs = (addon = {}) => {
        const candidates = [addon.requestedAt, addon.createdAt, addon.updatedAt]
          .map((v) => new Date(v).getTime())
          .find((ms) => Number.isFinite(ms) && ms > 0)
        if (candidates) return candidates
        const rawId = String(addon.id || "")
        const match = rawId.match(/\d{10,}/)
        if (!match) return 0
        const fromId = Number(match[0])
        return Number.isFinite(fromId) ? fromId : 0
      }
      const sortedAddons = [...data].sort((a, b) => getAddonCreatedMs(b) - getAddonCreatedMs(a))
      setAddons(sortedAddons)
    } catch (error) {
      debugError('Error fetching add-ons:', error)
      toast.error('Failed to load add-ons')
      setAddons([])
    } finally {
      if (showLoading) setLoadingAddons(false)
    }
  }

  useEffect(() => {
    if (activeTab === "add-ons") {
      fetchAddons(true)
    }
  }, [activeTab])

  // Persist active tab
  useEffect(() => {
    try {
      if (typeof window === "undefined") return
      localStorage.setItem(INVENTORY_ACTIVE_TAB_KEY, activeTab)
    } catch {}
  }, [activeTab])

  // Load persisted add-on form
  useEffect(() => {
    try {
      if (typeof window === "undefined") return
      const raw = localStorage.getItem(INVENTORY_ADDON_FORM_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        setAddonName(parsed?.name || "")
        setAddonDescription(parsed?.description || "")
        setAddonPrice(parsed?.price || "")
        if (parsed?.isOpen) setIsAddAddonOpen(true)
        if (parsed?.preview) {
          setAddonImagePreview(parsed.preview)
        }
      }
    } catch {}
  }, [])

  // Persist form state
  useEffect(() => {
    try {
      if (typeof window === "undefined") return
      const payload = {
        name: addonName,
        description: addonDescription,
        price: addonPrice,
        preview: addonImagePreview,
        isOpen: isAddAddonOpen
      }
      localStorage.setItem(INVENTORY_ADDON_FORM_KEY, JSON.stringify(payload))
    } catch {}
  }, [addonName, addonDescription, addonPrice, addonImagePreview, isAddAddonOpen])

  const resetAddonForm = () => {
    if (addonImagePreview && addonImagePreview.startsWith("blob:")) {
      URL.revokeObjectURL(addonImagePreview)
    }
    setAddonName("")
    setAddonDescription("")
    setAddonPrice("")
    setAddonImageFile(null)
    setAddonImagePreview("")
    if (addonImageInputRef.current) {
      addonImageInputRef.current.value = ""
    }
    setIsAddAddonOpen(false)
    localStorage.removeItem(INVENTORY_ADDON_FORM_KEY)
  }

  const handleAddonImageSelect = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/heic", "image/heif"]
    if (!allowed.includes(file.type)) {
      toast.error("Invalid image type. Please use PNG, JPG, JPEG, WEBP, HEIC, or HEIF.")
      e.target.value = ""
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB.")
      e.target.value = ""
      return
    }
    if (addonImagePreview && addonImagePreview.startsWith("blob:")) {
      URL.revokeObjectURL(addonImagePreview)
    }
    const preview = URL.createObjectURL(file)
    setAddonImageFile(file)
    setAddonImagePreview(preview)
    e.target.value = ""
  }

  const handleSaveAddon = async () => {
    if (!addonName.trim()) {
      toast.error("Please enter add-on name")
      return
    }
    const parsedPrice = parseFloat(addonPrice)
    if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
      toast.error("Please enter a valid price")
      return
    }
    if (!addonImageFile && !addonImagePreview) {
      toast.error("Please upload an add-on image")
      return
    }
    setSavingAddon(true)
    try {
      let imageUrl = ""
      if (addonImageFile) {
        const uploadRes = await uploadAPI.uploadMedia(addonImageFile, { folder: "appzeto/restaurant/addons" })
        imageUrl = uploadRes?.data?.data?.url || uploadRes?.data?.url || ""
      } else if (
        typeof addonImagePreview === "string" &&
        (addonImagePreview.startsWith("http://") || addonImagePreview.startsWith("https://"))
      ) {
        imageUrl = addonImagePreview
      }
      if (!imageUrl) {
        toast.error("Please upload an add-on image")
        return
      }
      const payload = {
        name: addonName.trim(),
        description: addonDescription.trim(),
        price: parsedPrice,
        image: imageUrl,
        images: [imageUrl],
      }
      await restaurantAPI.addAddon(payload)
      toast.success("Add-on submitted to admin for approval")
      resetAddonForm()
      setIsAddAddonOpen(false)
      fetchAddons(true)
    } catch (error) {
      debugError("Error saving add-on:", error)
      toast.error(error?.response?.data?.message || "Failed to save add-on")
    } finally {
      setSavingAddon(false)
    }
  }

  // Handle addon toggle
  const handleAddonToggle = async (addonId, isAvailable) => {
    try {
      // Update addon availability via API
      await restaurantAPI.updateAddon(addonId, {
        isAvailable: isAvailable
      })

      // Update local state
      setAddons(prev => prev.map(a => 
        a.id === addonId ? { ...a, isAvailable } : a
      ))

      toast.success(`Add-on ${isAvailable ? 'enabled' : 'disabled'} successfully`)
    } catch (error) {
      debugError('Error toggling addon:', error)
      toast.error('Failed to update add-on availability')
    }
  }

  // Handle swipe gestures
  const handleTouchStart = (e) => {
    const target = e.target
    // Don't handle swipe if starting on topbar
    if (tabBarRef.current?.contains(target)) return

    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    touchEndX.current = e.touches[0].clientX
    isSwiping.current = false
  }

  const handleTouchMove = (e) => {
    if (!isSwiping.current) {
      const deltaX = Math.abs(e.touches[0].clientX - touchStartX.current)
      const deltaY = Math.abs(e.touches[0].clientY - touchStartY.current)

      // Determine if this is a horizontal swipe
      if (deltaX > deltaY && deltaX > 10) {
        isSwiping.current = true
      }
    }

    if (isSwiping.current) {
      touchEndX.current = e.touches[0].clientX
    }
  }

  const handleTouchEnd = () => {
    if (!isSwiping.current) {
      touchStartX.current = 0
      touchEndX.current = 0
      return
    }

    const swipeDistance = touchStartX.current - touchEndX.current
    const minSwipeDistance = 50
    const swipeVelocity = Math.abs(swipeDistance)

    if (swipeVelocity > minSwipeDistance && !isTransitioning) {
      const currentIndex = inventoryTabs.findIndex(tab => tab === activeTab)
      let newIndex = currentIndex

      if (swipeDistance > 0 && currentIndex < inventoryTabs.length - 1) {
        // Swipe left - go to next tab
        newIndex = currentIndex + 1
      } else if (swipeDistance < 0 && currentIndex > 0) {
        // Swipe right - go to previous tab
        newIndex = currentIndex - 1
      }

      if (newIndex !== currentIndex) {
        setIsTransitioning(true)

        // Smooth transition with animation
        setTimeout(() => {
          setActiveTab(inventoryTabs[newIndex])

          // Reset transition state after animation
          setTimeout(() => {
            setIsTransitioning(false)
          }, 300)
        }, 50)
      }
    }

    // Reset touch positions
    touchStartX.current = 0
    touchEndX.current = 0
    touchStartY.current = 0
    isSwiping.current = false
  }

  // Persist categories to localStorage whenever they change
  useEffect(() => {
    try {
      if (typeof window === "undefined") return
      localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(categories))
    } catch (error) {
      debugError("Error saving inventory to storage:", error)
    }
  }, [categories])

  useEffect(() => {
    try {
      if (typeof window === "undefined") return
      localStorage.setItem(INVENTORY_STOCK_RULES_KEY, JSON.stringify(stockRules))
    } catch (error) {
      debugWarn("Failed to save stock rules:", error)
    }
  }, [stockRules])

  useEffect(() => {
    if (!stockRules || Object.keys(stockRules).length === 0) return

    const runExpiryCheck = async () => {
      const nowMs = Date.now()
      const expiredItemIds = Object.entries(stockRules)
        .filter(([, rule]) => rule?.mode !== "manual")
        .filter(([, rule]) => {
          const resumeAtMs = new Date(rule?.resumeAt || "").getTime()
          return Number.isFinite(resumeAtMs) && resumeAtMs <= nowMs
        })
        .map(([itemId]) => itemId)

      if (expiredItemIds.length === 0) return

      const affectedByCategory = new Map()
      setCategories((prev) =>
        prev.map((category) => {
          let changed = false
          const updatedItems = (category.items || []).map((item) => {
            if (!expiredItemIds.includes(String(item.id))) return item
            changed = true
            affectedByCategory.set(String(item.id), category.id)
            return {
              ...item,
              inStock: true,
              isAvailable: true,
              stockRule: null,
            }
          })

          if (!changed) return category
          return {
            ...category,
            items: updatedItems,
            inStock: updatedItems.every((item) => item.inStock),
          }
        }),
      )

      setStockRules((prev) => {
        const next = { ...prev }
        expiredItemIds.forEach((itemId) => {
          delete next[itemId]
        })
        return next
      })

      await Promise.all(
        expiredItemIds.map(async (itemId) => {
          try {
            const categoryId = affectedByCategory.get(String(itemId))
            await updateAvailabilityAPI(categoryId, itemId, true)
          } catch (error) {
            debugWarn("Failed to auto-enable scheduled inventory item:", error)
          }
        }),
      )
    }

    runExpiryCheck()
    const intervalId = setInterval(runExpiryCheck, 15000)
    return () => clearInterval(intervalId)
  }, [stockRules])

  // Calculate total items
  const totalItems = useMemo(
    () => categories.reduce((sum, cat) => sum + (cat.itemCount || (cat.items?.length || 0)), 0),
    [categories]
  )

  const inventoryStats = useMemo(() => {
    let inStock = 0
    let paused = 0
    categories.forEach((cat) => {
      ;(cat.items || []).forEach((item) => {
        if (item.inStock) inStock += 1
        else paused += 1
      })
    })

    let addonsLive = 0
    let addonsPaused = 0
    let addonsPending = 0
    addons.forEach((addon) => {
      if (addon.isAvailable !== false) addonsLive += 1
      else addonsPaused += 1
      if (String(addon.approvalStatus || "").toLowerCase() === "pending") addonsPending += 1
    })

    return {
      categories: categories.length,
      total: activeTab === "add-ons" ? addons.length : totalItemsCount,
      inStock,
      paused,
      addons: addons.length,
      addonsLive,
      addonsPaused,
      addonsPending,
    }
  }, [categories, totalItemsCount, addons, activeTab])

  const activeFilterOptions = useMemo(() => {
    if (activeTab === "add-ons") return ADDON_FILTER_OPTIONS
    if (!allowsNonVegFood(restaurantProfile)) {
      return MENU_FILTER_OPTIONS.filter((option) => option.value !== "non-veg")
    }
    return MENU_FILTER_OPTIONS
  }, [activeTab, restaurantProfile])

  useEffect(() => {
    if (!activeFilterOptions.some((option) => option.value === selectedFilter)) {
      setSelectedFilter("all")
    }
  }, [activeFilterOptions, selectedFilter])

  const filterMenuItems = (items = [], filterValue = "all") => {
    if (filterValue === "all") return items
    if (filterValue === "in-stock") return items.filter((item) => item.inStock)
    if (filterValue === "out-of-stock") return items.filter((item) => !item.inStock)
    if (filterValue === "recommended") return items.filter((item) => item.isRecommended)
    if (filterValue === "veg") return items.filter((item) => item.isVeg)
    if (filterValue === "non-veg") return items.filter((item) => !item.isVeg)
    return items
  }

  const filterAddonsList = (items = [], filterValue = "all") => {
    if (filterValue === "all") return items
    if (filterValue === "available") return items.filter((item) => item.isAvailable !== false)
    if (filterValue === "unavailable") return items.filter((item) => item.isAvailable === false)
    if (filterValue === "approved") return items.filter((item) => item.approvalStatus === "approved")
    if (filterValue === "pending") return items.filter((item) => item.approvalStatus === "pending")
    if (filterValue === "rejected") return items.filter((item) => item.approvalStatus === "rejected")
    return items
  }

  const menuFilterCounts = useMemo(
    () =>
      MENU_FILTER_OPTIONS.reduce((acc, option) => {
        acc[option.value] = categories.reduce(
          (sum, category) => sum + filterMenuItems(category.items || [], option.value).length,
          0
        )
        return acc
      }, {}),
    [categories]
  )

  const addonFilterCounts = useMemo(
    () =>
      ADDON_FILTER_OPTIONS.reduce((acc, option) => {
        acc[option.value] = filterAddonsList(addons, option.value).length
        return acc
      }, {}),
    [addons]
  )

  // Filter categories based on selected filter
  const statusFilteredCategories = useMemo(() => {
    return categories
      .map((category) => {
        const filteredItems = filterMenuItems(category.items || [], selectedFilter)
        if (filteredItems.length === 0) return null

        return {
          ...category,
          items: filteredItems,
          itemCount: filteredItems.length,
          inStock: filteredItems.every((item) => item.inStock),
        }
      })
      .filter(Boolean)
  }, [categories, selectedFilter])

  // Apply text search on categories & items
  const filteredCategories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return statusFilteredCategories

    return statusFilteredCategories
      .map(category => {
        const items = category.items || []
        const matchesCategory =
          category.name?.toLowerCase().includes(q) ||
          (category.description || "").toLowerCase().includes(q)

        const matchingItems = items.filter(item =>
          item.name?.toLowerCase().includes(q)
        )

        if (!matchesCategory && matchingItems.length === 0) {
          return null
        }

        return {
          ...category,
          items: matchingItems.length > 0 ? matchingItems : items,
          itemCount: matchingItems.length > 0 ? matchingItems.length : items.length,
          inStock: (matchingItems.length > 0 ? matchingItems : items).every((item) => item.inStock),
        }
      })
      .filter(Boolean)
  }, [statusFilteredCategories, searchQuery])

  const filteredAddons = useMemo(() => {
    const byFilter = filterAddonsList(addons, selectedFilter)
    const q = searchQuery.trim().toLowerCase()
    if (!q) return byFilter

    return byFilter.filter((addon) => {
      const status = String(addon?.approvalStatus || "").toLowerCase()
      return (
        String(addon?.name || "").toLowerCase().includes(q) ||
        String(addon?.description || "").toLowerCase().includes(q) ||
        status.includes(q)
      )
    })
  }, [addons, searchQuery, selectedFilter])

  // When on Add-ons tab, keep the list empty (no items shown)
  const listToRender = activeTab === "add-ons" ? [] : filteredCategories

  const gridMenuItems = useMemo(() => {
    const categories =
      activeCategoryPill === "all"
        ? listToRender
        : listToRender.filter((category) => String(category.id) === String(activeCategoryPill))

    return categories.flatMap((category) =>
      (category.items || []).map((item) => ({ item, category })),
    )
  }, [listToRender, activeCategoryPill])

  const activeFilterCount = activeTab === "add-ons"
    ? (addonFilterCounts[selectedFilter] || 0)
    : (menuFilterCounts[selectedFilter] || 0)

  const hasActiveTools = searchQuery.trim().length > 0 || selectedFilter !== "all"

  // Calculate out of stock count for a category
  const getOutOfStockCount = (category) => {
    return category.items.filter(item => !item.inStock).length
  }

  // Handle filter apply
  const handleFilterApply = () => {
    setIsLoading(true)
    setFilterOpen(false)

    // Simulate loading
    setTimeout(() => {
      setIsLoading(false)
    }, 1500)
  }

  // Handle filter clear
  const handleFilterClear = () => {
    setSelectedFilter("all")
    setFilterOpen(false)
  }

  // Update menu API when category/item toggles change
  const updateAvailabilityAPI = async (categoryId, itemId, isAvailable) => {
    try {
      if (!categoryId) return

      // Backend source of truth is food_items. Update availability via /food/restaurant/foods/:id.
      if (itemId) {
        await restaurantAPI.updateFood(itemId, { isAvailable: Boolean(isAvailable) })
        return
      }

      const category = categories.find((c) => c.id === categoryId)
      const items = category?.items || []
      // Bulk update all items in a category.
      await Promise.all(
        items.map((it) =>
          restaurantAPI.updateFood(it.id, { isAvailable: Boolean(isAvailable) }),
        ),
      )
    } catch (error) {
      debugError('Error updating availability:', error)
      toast.error(error?.response?.data?.message || 'Failed to update availability')
    }
  }

  const getTargetItemIds = (type, categoryId, itemId) => {
    const category = categories.find((entry) => entry.id === categoryId)
    const items = Array.isArray(category?.items) ? category.items : []

    if (type === "category") {
      return items.map((item) => String(item.id)).filter(Boolean)
    }

    return itemId ? [String(itemId)] : []
  }

  // Handle toggle click
  const handleToggleChange = async (type, categoryId, itemId, nextChecked) => {
    if (nextChecked) {
      const targetItemIds = getTargetItemIds(type, categoryId, itemId)

      // Turning ON - apply immediately without popup
      setCategories(prev =>
        prev.map(category => {
          if (category.id !== categoryId) return category
          const items = category.items || []

          if (type === "category") {
            const updatedItems = items.map(item => ({
              ...item,
              inStock: true,
              isAvailable: true,
              stockRule: null,
            }))
            return {
              ...category,
              inStock: true,
              items: updatedItems,
            }
          }

          const updatedItems = items.map(item =>
            item.id === itemId
              ? { ...item, inStock: true, isAvailable: true, stockRule: null }
              : item
          )
          // Don't automatically update category inStock when item is toggled
          // Category toggle should be independent
          return {
            ...category,
            items: updatedItems,
          }
        })
      )

      setStockRules((prev) => {
        const next = { ...prev }
        targetItemIds.forEach((id) => {
          delete next[id]
        })
        return next
      })

      // Update menu API
      if (type === "category") {
        await updateAvailabilityAPI(categoryId, null, true)
      } else {
        await updateAvailabilityAPI(categoryId, itemId, true)
      }
      return
    }

    // Turning OFF - open popup and wait for confirmation
    setToggleTarget({ type, categoryId, itemId })
    setSelectedOption("specific-time")
    setHours(3)
    setSelectedDate(null)
    setSelectedTime({ hour: "2", minute: "30", period: "pm" })
    setShowCalendar(false)
    setShowTimePicker(false)
    setTogglePopupOpen(true)
  }

  // Handle toggle confirm
  const handleToggleConfirm = async () => {
    if (!toggleTarget) {
      setTogglePopupOpen(false)
      return
    }

    const { type, categoryId, itemId } = toggleTarget
    const targetItemIds = getTargetItemIds(type, categoryId, itemId)
    const nextRule = buildStockRule({
      selectedOption,
      hours,
      selectedDate,
      selectedTime,
      restaurantProfile,
    })

    if (selectedOption === "custom-date-time") {
      if (!nextRule.resumeAt) {
        toast.error("Please select a valid custom date and time")
        return
      }

      if (new Date(nextRule.resumeAt).getTime() <= Date.now()) {
        toast.error("Custom date & time must be in the future")
        return
      }
    }

    // Apply OFF state for item or category
    setCategories(prev =>
      prev.map(category => {
        if (category.id !== categoryId) return category
        const items = category.items || []

        if (type === "category") {
          const updatedItems = items.map(item => ({
            ...item,
            inStock: false,
            isAvailable: false,
            stockRule: nextRule,
          }))
          return {
            ...category,
            inStock: false,
            items: updatedItems,
          }
        }

        const updatedItems = items.map(item =>
          item.id === itemId
            ? { ...item, inStock: false, isAvailable: false, stockRule: nextRule }
            : item
        )
        // Don't automatically update category inStock when item is toggled
        // Category toggle should be independent
        return {
          ...category,
          items: updatedItems,
        }
      })
    )

    setStockRules((prev) => {
      const next = { ...prev }
      targetItemIds.forEach((id) => {
        next[id] = nextRule
      })
      return next
    })

    // Update menu API
    if (type === "category") {
      await updateAvailabilityAPI(categoryId, null, false)
    } else {
      await updateAvailabilityAPI(categoryId, itemId, false)
    }

    setTogglePopupOpen(false)
    setToggleTarget(null)
  }

  // Get category data for popup
  const getCategoryData = () => {
    if (!toggleTarget || toggleTarget.type !== 'category') return null
    return categories.find(cat => cat.id === toggleTarget.categoryId)
  }

  // Format date for display
  const formatDate = (date) => {
    if (!date) return ""
    const day = date.getDate()
    const month = date.toLocaleString('en-US', { month: 'short' })
    const year = date.getFullYear()
    return `${day} ${month} ${year}`
  }

  // Format time for display
  const formatTime = (time) => {
    if (!time) return ""
    const minute = time.minute.padStart(2, '0')
    const period = time.period.toUpperCase()
    return `${time.hour}:${minute} ${period}`
  }

  // Handle time picker confirm
  const handleTimePickerConfirm = (hour, minute, period) => {
    setSelectedTime({ hour, minute, period })
    setShowTimePicker(false)
  }

  // Toggle category expansion
  const toggleCategory = (categoryId) => {
    setExpandedCategories(prev =>
      prev.includes(categoryId)
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId]
    )
  }

  // Update menu API when recommendation toggle changes
  // Handle item recommendation toggle
  const handleRecommendToggle = async (categoryId, itemId) => {
    // Find current recommendation status
    const category = categories.find(cat => cat.id === categoryId)
    const item = category?.items.find(i => i.id === itemId)
    const newRecommendationStatus = !item?.isRecommended

    // Update local state
    setCategories(prev =>
      prev.map(category => {
        if (category.id !== categoryId) return category
        const updatedItems = category.items.map(item =>
          item.id === itemId ? { ...item, isRecommended: newRecommendationStatus } : item
        )
        return {
          ...category,
          items: updatedItems,
        }
      })
    )

    // Persist local recommended preference (backend doesn't support it yet).
    try {
      setRecommendedMap((prev) => {
        const next = { ...(prev || {}) }
        next[String(itemId)] = Boolean(newRecommendationStatus)
        localStorage.setItem(INVENTORY_RECOMMENDED_KEY, JSON.stringify(next))
        return next
      })
    } catch (error) {
      debugWarn("Failed to persist recommended state:", error)
    }
  }

  const scrollToCategory = (categoryId) => {
    const el = categoryRefs.current[categoryId]
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ behavior: "smooth", block: "start" })
    }

    window.scrollTo({ top: el.offsetTop - 100, behavior: "smooth" })
  }

  const handleEditItem = (category, item) => {
    if (!item?.id) return

    navigate(`/food/restaurant/hub-menu/item/${item.id}`, {
      state: {
        backTo: "/food/restaurant/inventory",
        item: {
          ...item,
          category: category?.name || "",
          categoryId: category?.id || category?.categoryId || "",
          isAvailable: item.inStock,
        },
        category: category?.name || "",
        categoryId: category?.id || category?.categoryId || "",
        groupId: category?.id || category?.categoryId || "",
      },
    })
  }

  return (
    <RestaurantSubPageShell
      title="Menu inventory"
      subtitle="Manage dishes, stock, and add-ons"
      contentClassName="space-y-4 pb-28 lg:pb-8"
    >
      <InventoryStatsRow activeTab={activeTab} stats={inventoryStats} />

      <div ref={tabBarRef} className="sticky top-[52px] lg:top-0 z-30 bg-[#f4f6f9]/95 backdrop-blur-sm py-2 px-4 -mx-4 lg:px-6 lg:-mx-6 transition-all duration-200">
        <InventoryToolbar
          activeTab={activeTab}
          totalItems={activeTab === "add-ons" ? addons.length : totalItemsCount}
          addonsCount={addons.length}
          onTabChange={setActiveTab}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onOpenFilters={() => setFilterOpen(true)}
          hasActiveFilter={selectedFilter !== "all"}
          selectedFilter={selectedFilter}
          onFilterSelect={setSelectedFilter}
          filterOptions={activeFilterOptions}
          filterCounts={activeTab === "add-ons" ? addonFilterCounts : menuFilterCounts}
          hasActiveTools={hasActiveTools}
          onClearTools={() => {
            setSearchQuery("")
            setSelectedFilter("all")
          }}
          onOpenAddAddon={() => setIsAddAddonOpen((v) => !v)}
          isAddAddonOpen={isAddAddonOpen}
          isDesktop={isDesktop}
          listToRender={listToRender}
          activeCategoryPill={activeCategoryPill}
          onCategoryPillChange={setActiveCategoryPill}
          onOpenCategoryJump={() => setIsMenuOpen(true)}
        />
      </div>

      <div
        ref={contentContainerRef}
        className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-5"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={(e) => {
          const target = e.target
          if (tabBarRef.current?.contains(target)) return

          mouseStartX.current = e.clientX
          mouseEndX.current = e.clientX
          isMouseDown.current = true
          isSwiping.current = false
        }}
        onMouseMove={(e) => {
          if (isMouseDown.current) {
            if (!isSwiping.current) {
              const deltaX = Math.abs(e.clientX - mouseStartX.current)
              if (deltaX > 10) isSwiping.current = true
            }
            if (isSwiping.current) mouseEndX.current = e.clientX
          }
        }}
        onMouseUp={() => {
          if (isMouseDown.current && isSwiping.current) {
            const swipeDistance = mouseStartX.current - mouseEndX.current
            const minSwipeDistance = 50

            if (Math.abs(swipeDistance) > minSwipeDistance && !isTransitioning) {
              const currentIndex = inventoryTabs.findIndex((tab) => tab === activeTab)
              let newIndex = currentIndex

              if (swipeDistance > 0 && currentIndex < inventoryTabs.length - 1) {
                newIndex = currentIndex + 1
              } else if (swipeDistance < 0 && currentIndex > 0) {
                newIndex = currentIndex - 1
              }

              if (newIndex !== currentIndex) {
                setIsTransitioning(true)
                setTimeout(() => {
                  setActiveTab(inventoryTabs[newIndex])
                  setTimeout(() => setIsTransitioning(false), 300)
                }, 50)
              }
            }
          }

          isMouseDown.current = false
          isSwiping.current = false
          mouseStartX.current = 0
          mouseEndX.current = 0
        }}
        onMouseLeave={() => {
          isMouseDown.current = false
          isSwiping.current = false
        }}
      >
        {isDesktop && activeTab === "all-items" && listToRender.length > 0 ? (
          <InventoryCategorySidebar
            categories={listToRender}
            activeCategoryPill={activeCategoryPill}
            onSelect={setActiveCategoryPill}
            onJumpToCategory={scrollToCategory}
          />
        ) : (
          <div className="hidden lg:block" />
        )}

        <div className="min-w-0 space-y-4">
        {isDesktop && activeTab === "all-items" && gridMenuItems.length > 0 ? (
          <div className="mb-6 hidden lg:grid lg:grid-cols-2 lg:gap-4 xl:grid-cols-3">
            {gridMenuItems.map(({ item, category }) => {
              const approvalMeta = getApprovalDisplayMeta(item.approvalStatus)
              const isRejectedItem = item.approvalStatus === "rejected"
              return (
                <MenuItemGridCard
                  key={`${category.id}-${item.id}`}
                  item={item}
                  category={category}
                  approvalMeta={approvalMeta}
                  isRejectedItem={isRejectedItem}
                  onEdit={handleEditItem}
                  onRecommendToggle={handleRecommendToggle}
                  onToggleStock={(categoryId, itemId, checked) =>
                    handleToggleChange("item", categoryId, itemId, checked)
                  }
                />
              )
            })}
          </div>
        ) : null}

        {/* Categories Accordions */}
        <div className={`space-y-4 mb-6 ${isDesktop && activeTab === "all-items" ? "lg:hidden" : ""}`}>
          {activeTab === "add-ons" && (
            <>
              {isAddAddonOpen && (
                <PanelSurface className="mb-4 p-4">
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Add-on Name *</label>
                      <input
                        type="text"
                        value={addonName}
                        onChange={(e) => setAddonName(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#16A34A] focus:outline-none"
                        placeholder="e.g., Coke, Chips"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                      <textarea
                        value={addonDescription}
                        onChange={(e) => setAddonDescription(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#16A34A] focus:outline-none resize-none"
                        rows={3}
                        placeholder="Describe the add-on..."
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Price (₹) *</label>
                      <input
                        type="number"
                        value={addonPrice}
                        onChange={(e) => setAddonPrice(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#16A34A] focus:outline-none"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Image (1 only) <span className="text-red-500">*</span>
                      </label>
                      {addonImagePreview && (
                        <div className="mb-2">
                          <img
                            src={addonImagePreview}
                            alt="Preview"
                            className="w-24 h-24 object-cover rounded border"
                            onError={(e) => (e.target.style.display = "none")}
                          />
                        </div>
                      )}
                      <input
                        ref={addonImageInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleAddonImageSelect}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => addonImageInputRef.current?.click()}
                        className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-3 text-left transition-colors hover:bg-gray-100"
                      >
                        <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
                          <Upload className="h-4 w-4 text-gray-500" />
                          {addonImageFile?.name || "Upload image"}
                        </span>
                        <span className="mt-1 block text-xs text-gray-500">
                          {addonImageFile
                            ? "Image selected successfully"
                            : "Required — tap to choose 1 image from your device"}
                        </span>
                      </button>
                      <p className="text-xs text-gray-500 mt-1">PNG, JPG, WEBP, HEIC up to 5MB.</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          resetAddonForm()
                          setIsAddAddonOpen(false)
                        }}
                        className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveAddon}
                        disabled={savingAddon}
                        className="px-4 py-2 bg-[#16A34A] text-white rounded-md text-sm font-medium hover:bg-[#15803D] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {savingAddon && <Loader2 className="h-4 w-4 animate-spin" />}
                        <span>{savingAddon ? "Saving..." : "Submit for approval"}</span>
                      </button>
                    </div>
                  </div>
                </PanelSurface>
              )}
              {loadingAddons ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                </div>
              ) : filteredAddons.length === 0 ? (
                <InventoryEmptyState
                  title={hasActiveTools ? "No matching add-ons" : "No add-ons yet"}
                  description={
                    hasActiveTools
                      ? "Try changing your search or filters."
                      : "Create your first add-on using the button above."
                  }
                />
              ) : (
                <div className="space-y-4">
                  {filteredAddons.map((addon) => (
                    <div
                      key={addon.id}
                      className="rounded-xl border border-slate-100/60 bg-white p-2.5 sm:p-3 shadow-sm hover:shadow-md hover:border-slate-200 transition-all duration-300"
                    >
                      <div className="flex items-start justify-between gap-3 sm:gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="mb-1 flex items-center gap-1.5 flex-wrap">
                            <h3 className="text-xs sm:text-sm font-bold text-slate-950">{addon.name}</h3>
                            <span className={`rounded px-1.5 py-0.5 text-[8px] sm:text-[9px] font-bold uppercase tracking-wider ${
                              addon.isAvailable !== false
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-slate-100 text-slate-600"
                            }`}>
                              {addon.isAvailable !== false ? "Live" : "Paused"}
                            </span>
                            {addon.approvalStatus === 'approved' && (
                              <span className="rounded bg-green-100 px-1.5 py-0.5 text-[8px] sm:text-[9px] font-bold uppercase tracking-wider text-green-800">Approved</span>
                            )}
                            {addon.approvalStatus === 'pending' && (
                              <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[8px] sm:text-[9px] font-bold uppercase tracking-wider text-yellow-800">Pending</span>
                            )}
                            {addon.approvalStatus === 'rejected' && (
                              <span className="rounded bg-red-100 px-1.5 py-0.5 text-[8px] sm:text-[9px] font-bold uppercase tracking-wider text-red-800">Rejected</span>
                            )}
                          </div>
                          {addon.description && (
                            <p className="mb-1.5 text-[10px] sm:text-xs leading-normal text-slate-600">{addon.description}</p>
                          )}
                          <p className="text-xs sm:text-sm font-extrabold text-slate-950">Rs. {addon.price}</p>
                          {addon.approvalStatus === 'rejected' && addon.rejectionReason && (
                            <p className="mt-1.5 text-[9px] sm:text-[10px] font-medium text-red-600">Reason: {addon.rejectionReason}</p>
                          )}
                        </div>
                        <div className="flex items-start gap-2.5">
                          <div className="h-12 w-12 sm:h-14 sm:w-14 md:h-16 md:w-16 flex-shrink-0 rounded-xl overflow-hidden ring-1 ring-slate-100/50 bg-slate-50 flex items-center justify-center">
                            {addon.images && addon.images.length > 0 && addon.images[0] && typeof addon.images[0] === 'string' && addon.images[0].trim() !== '' && addon.images[0] !== 'null' && addon.images[0] !== 'undefined' ? (
                              <img
                                src={addon.images[0]}
                                alt={addon.name}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  e.target.style.display = 'none';
                                  const fallback = e.target.nextSibling;
                                  if (fallback) {
                                    fallback.style.display = 'flex';
                                  }
                                }}
                              />
                            ) : null}
                            <div
                              className="w-full h-full flex items-center justify-center bg-slate-50 text-slate-400"
                              style={{ display: (addon.images && addon.images.length > 0 && addon.images[0] && typeof addon.images[0] === 'string' && addon.images[0].trim() !== '' && addon.images[0] !== 'null' && addon.images[0] !== 'undefined') ? 'none' : 'flex' }}
                            >
                              <Utensils className="w-4 h-4 sm:w-5 sm:h-5 text-slate-300" />
                            </div>
                          </div>
                          <div className="flex items-center rounded-full bg-slate-100 px-2 py-1 scale-90">
                            <Switch
                              checked={addon.isAvailable !== false}
                              onCheckedChange={(checked) =>
                                handleAddonToggle(addon.id, checked)
                              }
                              className="data-[state=checked]:bg-green-600"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {activeTab !== "add-ons" && !loadingInventory && listToRender.length === 0 && (
            <InventoryEmptyState
              title={hasActiveTools ? "No matching categories or items" : "No menu categories yet"}
              description={
                hasActiveTools
                  ? "Try adjusting your search or filters."
                  : "Your menu categories will appear here once items are added."
              }
            />
          )}
          {listToRender.map((category, index) => {
            const isExpanded = expandedCategories.includes(category.id)
            const categoryItems = category.items || []

            return (
              <motion.div
                key={category.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: isLoading ? 0.6 : 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
                className="relative"
                ref={(el) => {
                  if (el) categoryRefs.current[category.id] = el
                }}
              >
                <PanelSurface className="overflow-hidden p-0">
                {isLoading && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="absolute inset-0 z-10 flex items-center justify-center rounded-[var(--rt-radius-lg)] bg-white/80"
                  >
                    <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                  </motion.div>
                )}

                <InventoryCategoryHeader
                  category={category}
                  isExpanded={isExpanded}
                  outOfStockCount={getOutOfStockCount(category)}
                  recommendedCount={categoryItems.filter((item) => item.isRecommended).length}
                  onToggleExpand={() => toggleCategory(category.id)}
                  onToggleStock={(checked) => handleToggleChange("category", category.id, null, checked)}
                />

                {/* Category Items */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: "circOut" }}
                      className="overflow-hidden bg-slate-50/30"
                    >
                      <div className="space-y-4 px-6 pb-6 pt-2">
                        {categoryItems.map((item) => {
                          const approvalMeta = getApprovalDisplayMeta(item.approvalStatus)
                          const isRejectedItem = item.approvalStatus === "rejected"

                          return (
                          <div key={item.id} className="group px-1">
                            <div className="flex items-start justify-between gap-3 sm:gap-4 rounded-xl border border-slate-100/60 bg-white p-2.5 sm:p-3 shadow-sm hover:shadow-md hover:border-slate-200 transition-all duration-300">
                              <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:gap-4">
                                <div className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 flex-shrink-0 rounded-xl overflow-hidden shadow-sm border border-slate-100/50 bg-slate-100 flex items-center justify-center">
                                  {item.image && typeof item.image === 'string' && item.image.trim() !== '' && item.image !== 'null' && item.image !== 'undefined' ? (
                                    <img
                                      src={item.image}
                                      alt={item.name}
                                      className="w-full h-full object-cover transform group-hover:scale-110 transition-transform duration-700"
                                      onError={(e) => {
                                        e.target.style.display = 'none';
                                        const fallback = e.target.nextSibling;
                                        if (fallback) {
                                          fallback.style.display = 'flex';
                                        }
                                      }}
                                    />
                                  ) : null}
                                  <div
                                    className="w-full h-full flex items-center justify-center bg-slate-100 text-slate-400"
                                    style={{ display: (item.image && typeof item.image === 'string' && item.image.trim() !== '' && item.image !== 'null' && item.image !== 'undefined') ? 'none' : 'flex' }}
                                  >
                                    <Utensils className="w-4 h-4 sm:w-5 sm:h-5 text-slate-300" />
                                  </div>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <h4 className="line-clamp-1 text-xs sm:text-sm md:text-base font-bold text-slate-900 tracking-tight leading-tight mb-0.5">
                                    {item.name}
                                  </h4>
                                  
                                  <p className="text-xs sm:text-sm font-extrabold text-slate-900 mb-1">
                                    ₹{Number(item.price || 0).toFixed(0)}
                                  </p>

                                  <div className="flex flex-wrap items-center gap-1 mb-1.5">
                                    <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[8px] sm:text-[9px] font-bold uppercase tracking-wider shadow-sm transition-all ${
                                      item.isVeg
                                        ? "bg-white text-green-600 border border-green-100"
                                        : "bg-white text-red-600 border border-red-100"
                                    }`}>
                                      <div className={`h-2 w-2 shrink-0 rounded-[1.5px] border flex items-center justify-center ${item.isVeg ? 'border-green-600' : 'border-red-600'}`}>
                                        <div className={`h-0.5 w-0.5 rounded-full ${item.isVeg ? 'bg-green-600' : 'bg-red-600'}`} />
                                      </div>
                                      {item.isVeg ? "Veg" : "Non-veg"}
                                    </span>
                                    <span className={`rounded px-1.5 py-0.5 text-[8px] sm:text-[9px] font-bold uppercase tracking-wider border shadow-sm ${approvalMeta.className.replace('text-', 'text-').replace('bg-', 'bg-white border-')}`}>
                                      {approvalMeta.label}
                                    </span>
                                    {item.categoryDisabled ? (
                                      <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[8px] sm:text-[9px] font-bold uppercase tracking-wider text-amber-700">
                                        {item.categoryDisabledByAdmin ? "Category disabled by admin" : "Category disabled"}
                                      </span>
                                    ) : null}
                                  </div>

                                  {item.description && (
                                    <p className="line-clamp-2 text-[9px] sm:text-xs text-slate-500 mb-1.5 leading-normal">
                                      {item.description}
                                    </p>
                                  )}

                                  <p className="text-[9px] sm:text-[10px] font-medium text-slate-500 mb-1.5">
                                    Stock: <span className="font-bold text-slate-700">{item.stockQuantity || "Unlimited"}</span> {item.stockQuantity !== "Unlimited" && item.unit ? `${item.unit}(s)` : ""}
                                  </p>

                                  {item.variants && item.variants.length > 0 && (
                                    <div className="mt-1.5 flex flex-wrap gap-1 mb-2">
                                      {item.variants.map((v, i) => (
                                        <span key={v.id || i} className="inline-flex items-center gap-1 rounded bg-slate-50 border border-slate-100 px-1.5 py-0.5 text-[8px] sm:text-[9px] font-semibold text-slate-600">
                                          {v.name}: ₹{v.price}{v.unit ? ` / ${v.unit}` : ''}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  
                                  <div className="flex items-center gap-2 mt-1">
                                    <p className={`text-[8px] sm:text-[9px] font-bold uppercase tracking-widest ${
                                      item.inStock ? "text-green-500" : "text-rose-500"
                                    }`}>
                                      {item.inStock ? "● Live" : `● ${getRuleStatusLabel(item.stockRule)}`}
                                    </p>
                                    <button
                                      type="button"
                                      onClick={() => handleEditItem(category, item)}
                                      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[8px] sm:text-[9px] font-bold uppercase tracking-widest transition-all shadow-sm ${
                                        isRejectedItem
                                          ? "bg-red-600 text-white hover:bg-red-700"
                                          : "bg-slate-100 text-slate-800 hover:bg-slate-800 hover:text-white"
                                      }`}
                                    >
                                      <Pencil className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                                      {isRejectedItem ? "Fix" : "Edit"}
                                    </button>
                                  </div>

                                  {item.approvalStatus === "rejected" && item.rejectionReason && (
                                    <p className="mt-2 text-[9px] sm:text-[10px] font-bold text-red-600 bg-red-50/50 border border-red-100/50 px-2.5 py-1 rounded-lg italic">
                                      {item.rejectionReason}
                                    </p>
                                  )}
                                </div>
                              </div>

                              <div className="flex shrink-0 flex-col items-center gap-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleRecommendToggle(category.id, item.id)
                                  }}
                                  className={`w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg transition-all shadow-sm border ${
                                    item.isRecommended
                                      ? "bg-blue-600 border-blue-600 text-white"
                                      : "bg-white border-slate-100 text-slate-300 hover:border-slate-200 hover:text-slate-600"
                                  }`}
                                >
                                  <ThumbsUp className="w-3.5 h-3.5" />
                                </button>
                                
                                <div
                                  onClick={(e) => e.stopPropagation()}
                                  className="scale-90 origin-right"
                                >
                                  <Switch
                                    checked={item.inStock}
                                    onCheckedChange={(checked) =>
                                      handleToggleChange("item", category.id, item.id, checked)
                                    }
                                    className="data-[state=checked]:bg-green-500"
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                          )
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                </PanelSurface>
              </motion.div>
            )
          })}
        </div>

        {/* Infinite Scroll Trigger */}
        {activeTab === "all-items" && (
          <div ref={loadMoreRef} className="h-12 flex items-center justify-center py-6">
            {isFetchingMore && (
              <div className="flex items-center gap-2 text-slate-500 text-sm font-medium">
                <Loader2 className="h-4 w-4 animate-spin text-[#16A34A]" />
                <span>Loading more items...</span>
              </div>
            )}
          </div>
        )}

        </div>
      </div>

      <RestaurantPanelModal
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filters"
        description={
          activeTab === "add-ons"
            ? "Refine the add-ons list by availability or approval status."
            : "Refine your inventory by stock state, recommendation, or food type."
        }
        size="md"
        mobileMaxHeight="auto"
        headerRight={
          selectedFilter !== "all" ? (
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">Active</span>
          ) : null
        }
        footer={
          <div className="flex gap-3">
            {selectedFilter !== "all" && (
              <button
                onClick={handleFilterClear}
                className="flex-1 rounded-lg border border-gray-300 py-3 font-medium text-gray-900 transition-colors hover:bg-gray-50"
              >
                Clear
              </button>
            )}
            <button
              onClick={handleFilterApply}
              className={`${selectedFilter !== "all" ? "flex-1" : "w-full"} rounded-lg bg-[#16A34A] py-3 font-medium text-white transition-colors hover:bg-[#15803D]`}
            >
              Apply
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {activeFilterOptions.map((option) => {
            const count =
              activeTab === "add-ons"
                ? addonFilterCounts[option.value] || 0
                : menuFilterCounts[option.value] || 0

            return (
              <label
                key={option.value}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-gray-200 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="filter"
                    checked={selectedFilter === option.value}
                    onChange={() => setSelectedFilter(option.value)}
                    style={{ accentColor: "#16A34A" }}
                    className="h-5 w-5 border-gray-300"
                  />
                  <span className="text-base text-gray-900">{option.label}</span>
                </div>
                <span className="flex h-7 min-w-[28px] items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-700">
                  {count}
                </span>
              </label>
            )
          })}
        </div>
      </RestaurantPanelModal>

      <RestaurantPanelModal
        open={togglePopupOpen && !!toggleTarget}
        onClose={() => setTogglePopupOpen(false)}
        title={
          toggleTarget?.type === "category" ? "Mark sub category out of stock" : "Mark item out of stock"
        }
        titleCentered
        size="md"
        mobileMaxHeight="tall"
        bodyClassName="px-5 py-4 lg:px-6"
        footer={
          <div className="flex gap-3">
            <button
              onClick={() => setTogglePopupOpen(false)}
              className="flex-1 rounded-lg border border-gray-300 py-3 font-medium text-gray-900 transition-colors hover:bg-gray-50"
            >
              Back
            </button>
            <button
              onClick={handleToggleConfirm}
              className="flex-1 rounded-lg bg-[#16A34A] py-3 font-medium text-white transition-colors hover:bg-[#15803D]"
            >
              Confirm
            </button>
          </div>
        }
      >
        {toggleTarget?.type === "category" && (() => {
          const categoryData = getCategoryData()
          if (!categoryData) return null
          return (
            <div className="mb-4">
              <h3 className="mb-3 text-base font-bold text-gray-900">{categoryData.name}</h3>
              <ul className="space-y-1 text-sm text-gray-600">
                <li>• {categoryData.name}</li>
                <li>
                  • Includes {categoryData.itemCount} item{categoryData.itemCount !== 1 ? "s" : ""}
                </li>
              </ul>
              <div className="mt-4 border-t border-gray-200" />
            </div>
          )
        })()}

        <div className="space-y-0">
          <label className="flex cursor-pointer items-center justify-between border-b border-gray-200 py-4">
            <div className="flex flex-1 items-center gap-3">
              <span className="text-base text-gray-900">For specific time</span>
              {selectedOption === "specific-time" && (
                <div className="ml-auto flex items-center justify-center gap-4 py-3">
                  <button
                    onClick={() => setHours(Math.max(1, hours - 1))}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 transition-colors hover:bg-gray-300"
                  >
                    <Minus className="h-4 w-4 text-gray-700" />
                  </button>
                  <span className="min-w-[60px] text-center text-base font-medium text-gray-900">
                    {hours} hour{hours !== 1 ? "s" : ""}
                  </span>
                  <button
                    onClick={() => setHours(hours + 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 transition-colors hover:bg-gray-300"
                  >
                    <Plus className="h-4 w-4 text-gray-700" />
                  </button>
                </div>
              )}
              <input
                type="radio"
                name="outOfStockOption"
                checked={selectedOption === "specific-time"}
                onChange={() => setSelectedOption("specific-time")}
                style={{ accentColor: "#16A34A" }}
                className="ml-auto h-5 w-5 border-gray-300"
              />
            </div>
          </label>

          <label className="flex cursor-pointer items-center justify-between border-b border-gray-200 py-4">
            <div className="flex flex-1 items-center gap-3">
              <span className="text-base text-gray-900">Next business day - Opening time</span>
              <input
                type="radio"
                name="outOfStockOption"
                checked={selectedOption === "next-business-day"}
                onChange={() => setSelectedOption("next-business-day")}
                style={{ accentColor: "#16A34A" }}
                className="ml-auto h-5 w-5 border-gray-300"
              />
            </div>
          </label>

          <label className="flex cursor-pointer items-center justify-between border-b border-gray-200 py-4">
            <div className="flex flex-1 items-center gap-3">
              <span className="text-base text-gray-900">Custom date & time</span>
              <input
                type="radio"
                name="outOfStockOption"
                checked={selectedOption === "custom-date-time"}
                onChange={() => setSelectedOption("custom-date-time")}
                style={{ accentColor: "#16A34A" }}
                className="ml-auto h-5 w-5 border-gray-300"
              />
            </div>
          </label>
          {selectedOption === "custom-date-time" && (
            <div className="ml-auto flex items-center justify-center gap-4 py-3">
              <button
                onClick={() => setShowCalendar(true)}
                className="flex flex-1 items-center justify-between rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 transition-colors hover:bg-gray-50"
              >
                <span>{selectedDate ? formatDate(selectedDate) : "15 Dec 2025"}</span>
                <ChevronDown className="h-4 w-4 text-gray-500" />
              </button>
              <button
                onClick={() => setShowTimePicker(true)}
                className="flex flex-1 items-center justify-between rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 transition-colors hover:bg-gray-50"
              >
                <span>{formatTime(selectedTime)}</span>
                <ChevronDown className="h-4 w-4 text-gray-500" />
              </button>
            </div>
          )}

          <label className="flex cursor-pointer items-center justify-between py-4">
            <div className="flex flex-1 flex-col gap-1">
              <div className="flex items-center gap-3">
                <span className="text-base text-gray-900">I will turn it on manually</span>
                <input
                  type="radio"
                  name="outOfStockOption"
                  checked={selectedOption === "manual"}
                  onChange={() => setSelectedOption("manual")}
                  style={{ accentColor: "#16A34A" }}
                  className="ml-auto h-5 w-5 border-gray-300"
                />
              </div>
              <p className="text-sm text-gray-500">
                Item won&apos;t be visible to customers on app till you mark it back in stock
              </p>
            </div>
          </label>
        </div>
      </RestaurantPanelModal>

      {/* Calendar Popup */}
      <SimpleCalendar
        selectedDate={selectedDate}
        onDateSelect={setSelectedDate}
        isOpen={showCalendar}
        onClose={() => setShowCalendar(false)}
      />

      {/* Time Picker Popup */}
      <TimePickerWheel
        isOpen={showTimePicker}
        onClose={() => setShowTimePicker(false)}
        initialHour={selectedTime.hour}
        initialMinute={selectedTime.minute}
        initialPeriod={selectedTime.period}
        onConfirm={handleTimePickerConfirm}
      />

      <RestaurantPanelModal
        open={isAddPopupOpen}
        onClose={() => setIsAddPopupOpen(false)}
        title="Add item"
        titleCentered
        size="sm"
        mobileMaxHeight="auto"
        zIndex={71}
        bodyClassName="px-4 py-2 lg:px-5"
      >
        <button
          onClick={() => {
            setIsAddPopupOpen(false)
            navigate(`/food/restaurant/hub-menu/item/new`, {
              state: {
                backTo: "/food/restaurant/inventory",
              },
            })
          }}
          className="w-full rounded-lg px-4 py-3 text-left transition-colors hover:bg-gray-50"
        >
          <span className="text-sm font-medium text-gray-900">Add item</span>
        </button>
      </RestaurantPanelModal>

      {/* Floating add button */}
      {activeTab !== "add-ons" && (
        <div className="fixed bottom-24 right-4 z-30 lg:bottom-8">
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => setIsAddPopupOpen(true)}
            className="rounded-full bg-[var(--rt-primary-strong)] px-5 py-3 text-sm font-semibold text-white shadow-lg"
          >
            + Add item
          </motion.button>
        </div>
      )}

      <RestaurantPanelModal
        open={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        title="Jump to category"
        size="sm"
        mobileMaxHeight="medium"
        bodyClassName="px-2 py-2"
      >
        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {categories.map((category) => {
            const itemCount = category.itemCount || category.items?.length || 0
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => {
                  setIsMenuOpen(false)
                  setActiveCategoryPill(String(category.id))
                  setTimeout(() => scrollToCategory(category.id), 200)
                }}
                className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm font-medium text-gray-900 hover:bg-gray-50"
              >
                <span className="truncate pr-3">{category.name}</span>
                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                  {itemCount}
                </span>
              </button>
            )
          })}
        </div>
      </RestaurantPanelModal>
    </RestaurantSubPageShell>
  )
}


