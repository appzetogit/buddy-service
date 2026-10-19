import { useMemo } from "react"

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1)
const MINUTES = Array.from({ length: 60 }, (_, i) => i)

const selectClass =
  "px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none bg-white"

function to24Hour(hour12, minute, period) {
  let hour24 = hour12 % 12
  if (period === "PM") hour24 += 12
  return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function from24Hour(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value || "")
  if (!match) return { hour12: 12, minute: 0, period: "AM" }
  const hour24 = Number(match[1])
  const minute = Number(match[2])
  const period = hour24 >= 12 ? "PM" : "AM"
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return { hour12, minute, period }
}

/**
 * Hour / Minute / AM-PM dropdown trio that reads and writes a "HH:MM" 24-hour
 * string — the wire format every peak-hour rule stores and validates against.
 * Explicit dropdowns avoid relying on the browser's locale-dependent
 * <input type="time"> rendering.
 */
export default function AmPmTimePicker({ value, onChange, error, className = "" }) {
  const { hour12, minute, period } = useMemo(() => from24Hour(value), [value])

  const update = (patch) => {
    const next = { hour12, minute, period, ...patch }
    onChange(to24Hour(next.hour12, next.minute, next.period))
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <select
          value={hour12}
          onChange={(e) => update({ hour12: Number(e.target.value) })}
          className={selectClass}
          aria-label="Hour"
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
        </select>
        <span className="text-slate-400 font-semibold">:</span>
        <select
          value={minute}
          onChange={(e) => update({ minute: Number(e.target.value) })}
          className={selectClass}
          aria-label="Minute"
        >
          {MINUTES.map((m) => (
            <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
          ))}
        </select>
        <select
          value={period}
          onChange={(e) => update({ period: e.target.value })}
          className={selectClass}
          aria-label="AM or PM"
        >
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>
      {error ? <p className="text-xs text-red-500 mt-1">{error}</p> : null}
    </div>
  )
}
