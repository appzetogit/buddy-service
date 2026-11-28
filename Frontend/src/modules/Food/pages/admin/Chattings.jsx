import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Search, Send, Settings, Plus, X, ArrowLeft, MessageSquare, Loader2 } from "lucide-react"
import { adminChatApi, errMsg, fmt12, fmtTime, isChatOpen, newClientId, useChatSocket } from "../../../../shared/supportChat/chatCore"

const TABS = [
  { key: "", label: "All" },
  { key: "USER", label: "Customers" },
  { key: "SELLER", label: "Sellers" },
  { key: "RESTAURANT", label: "Restaurants" },
  { key: "DELIVERY_PARTNER", label: "Delivery" },
]
const ROLE_LABEL = Object.fromEntries(TABS.filter((t) => t.key).map((t) => [t.key, t.label.replace(/s$/, "")]))
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const upsert = (list, m) => {
  const i = list.findIndex((x) => x.id === m.id || (m.clientId && x.clientId === m.clientId))
  if (i === -1) return [...list, m].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
  const next = [...list]
  next[i] = { ...next[i], ...m }
  return next
}

export default function Chattings() {
  const [tab, setTab] = useState("")
  const [q, setQ] = useState("")
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [threads, setThreads] = useState([])
  const [cursor, setCursor] = useState(null)
  const [loadingList, setLoadingList] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [messages, setMessages] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [text, setText] = useState("")
  const [error, setError] = useState("")
  const [status, setStatus] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [, tick] = useState(0)
  const selectedRef = useRef(null)
  const bottomRef = useRef(null)
  const stickRef = useRef(true)
  selectedRef.current = selectedId

  const selected = useMemo(() => threads.find((t) => t.id === selectedId) || null, [threads, selectedId])
  const open = status ? isChatOpen(status) : false

  const loadThreads = useCallback(async (append = false, cur = null) => {
    try {
      const res = await adminChatApi.threads({ role: tab || undefined, q: q.trim() || undefined, unread: unreadOnly || undefined, cursor: cur || undefined, limit: 30 })
      setThreads((prev) => (append ? [...prev, ...res.threads.filter((t) => !prev.some((p) => p.id === t.id))] : res.threads))
      setCursor(res.nextCursor)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoadingList(false)
    }
  }, [tab, q, unreadOnly])

  // Debounce search typing; tab / filter changes reload straight away.
  useEffect(() => {
    setLoadingList(true)
    const t = setTimeout(() => loadThreads(false), q ? 300 : 0)
    return () => clearTimeout(t)
  }, [loadThreads, q])

  useEffect(() => { adminChatApi.getSettings().then(setStatus).catch(() => {}) }, [])
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [])

  const loadMessages = useCallback(async (id, before) => {
    try {
      const res = await adminChatApi.messages(id, { limit: 30, before: before || undefined })
      if (selectedRef.current !== id) return
      setMessages((prev) => (before ? res.messages.reduce(upsert, prev) : res.messages.reduce(upsert, prev.filter((m) => m.pending))))
      setHasMore(res.hasMore)
      setThreads((prev) => (prev.some((t) => t.id === id) ? prev : [res.thread, ...prev]))
      if (!before && res.thread.unreadForAdmin) {
        adminChatApi.read(id).catch(() => {})
        setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, unreadForAdmin: 0 } : t)))
      }
    } catch (e) {
      setError(errMsg(e))
    }
  }, [])

  const selectThread = (id) => {
    setSelectedId(id)
    setMessages([])
    setHasMore(false)
    setError("")
    stickRef.current = true
    loadMessages(id)
  }

  useChatSocket("admin", {
    onConnect: () => { loadThreads(false); if (selectedRef.current) loadMessages(selectedRef.current) },
    onSettings: setStatus,
    onRead: ({ threadId, by }) => {
      if (by === "PARTICIPANT") setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, unreadForParticipant: 0 } : t)))
    },
    onMessage: ({ thread, message }) => {
      const isOpen = selectedRef.current === thread.id
      // Open thread: the admin is reading it, so show it as read here.
      const t = isOpen ? { ...thread, unreadForAdmin: 0 } : thread
      const matches = (!tab || t.role === tab) && !(unreadOnly && !t.unreadForAdmin)
      if (matches) setThreads((prev) => [t, ...prev.filter((x) => x.id !== t.id)])
      if (isOpen) {
        setMessages((prev) => upsert(prev, message))
        if (message.sender === "PARTICIPANT") adminChatApi.read(thread.id).catch(() => {})
      }
    },
  })

  useEffect(() => {
    if (stickRef.current) bottomRef.current?.scrollIntoView({ block: "end" })
  }, [messages])

  const send = async (e) => {
    e?.preventDefault()
    const body = text.trim()
    if (!body || !selectedId || !open) return
    const clientId = newClientId()
    const id = selectedId
    stickRef.current = true
    setText("")
    setError("")
    setMessages((prev) => upsert(prev, { id: `tmp-${clientId}`, clientId, sender: "ADMIN", text: body, createdAt: new Date().toISOString(), pending: true }))
    try {
      const res = await adminChatApi.send(id, { text: body, clientId })
      setMessages((prev) => upsert(prev.filter((m) => m.id !== `tmp-${clientId}`), res.message))
      setThreads((prev) => [res.thread, ...prev.filter((t) => t.id !== res.thread.id)])
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== `tmp-${clientId}`))
      setText(body)
      setError(errMsg(err, "Message not sent"))
    }
  }

  const startChat = async (p) => {
    try {
      const { thread } = await adminChatApi.open({ role: p.role, participantId: p.participantId })
      setShowNew(false)
      setThreads((prev) => (prev.some((t) => t.id === thread.id) ? prev : [thread, ...prev]))
      selectThread(thread.id)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <div className="bg-slate-50 p-3 lg:p-6">
      <div className="mx-auto max-w-7xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid h-[calc(100vh-8rem)] grid-cols-1 lg:grid-cols-[360px_1fr]">
          {/* ───── list ───── */}
          <div className={`${selectedId ? "hidden lg:flex" : "flex"} flex-col border-r border-slate-200`}>
            <div className="space-y-3 border-b border-slate-200 p-4">
              <div className="flex items-center justify-between gap-2">
                <h1 className="text-xl font-bold text-slate-900">Chats</h1>
                <div className="flex items-center gap-1">
                  <button onClick={() => setShowSettings(true)} title="Change chat hours"
                    className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${open ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>
                    {open ? "Open" : "Closed"}{status ? ` · ${fmt12(status.startTime)} – ${fmt12(status.endTime)}` : ""}
                  </button>
                  <button onClick={() => setShowNew(true)} title="New chat" className="rounded-lg p-2 hover:bg-slate-100"><Plus className="h-4 w-4" /></button>
                  <button onClick={() => setShowSettings(true)} title="Chat hours" className="rounded-lg p-2 hover:bg-slate-100"><Settings className="h-4 w-4" /></button>
                </div>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or phone"
                  className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
              </div>
              <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div className="flex w-max items-center gap-1.5">
                  {TABS.map((t) => (
                    <button key={t.key} onClick={() => setTab(t.key)}
                      className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${tab === t.key ? "bg-blue-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300" /> Show unread only
              </label>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loadingList ? (
                <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
              ) : threads.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center p-6 text-slate-500">
                  <MessageSquare className="mb-2 h-8 w-8 text-slate-300" />
                  <p className="text-sm">No conversations yet</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {threads.map((t) => (
                    <button key={t.id} onClick={() => selectThread(t.id)}
                      className={`w-full p-3 text-left hover:bg-slate-50 ${selectedId === t.id ? "bg-blue-50" : ""}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-slate-900">{t.name || "Unnamed"}</span>
                        <span className="shrink-0 text-xs text-slate-400">{t.lastAt ? fmtTime(t.lastAt) : ""}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-slate-500">
                          <span className="mr-1 rounded bg-slate-100 px-1 text-[10px] uppercase text-slate-500">{ROLE_LABEL[t.role]}</span>
                          {t.lastSender === "ADMIN" ? "You: " : ""}{t.lastMessage}
                        </span>
                        {t.unreadForAdmin > 0 && (
                          <span className="shrink-0 rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold text-white">{t.unreadForAdmin}</span>
                        )}
                      </div>
                    </button>
                  ))}
                  {cursor && (
                    <button onClick={() => loadThreads(true, cursor)} className="w-full py-3 text-xs text-blue-600 hover:bg-slate-50">Load more</button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ───── conversation ───── */}
          <div className={`${selectedId ? "flex" : "hidden lg:flex"} min-h-0 flex-col`}>
            {!selected ? (
              <div className="flex h-full flex-col items-center justify-center text-slate-400">
                <MessageSquare className="mb-2 h-10 w-10" />
                <p className="text-sm">Select a conversation</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
                  <button onClick={() => setSelectedId(null)} className="rounded-full p-1.5 hover:bg-slate-100 lg:hidden"><ArrowLeft className="h-5 w-5" /></button>
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-slate-900">{selected.name || "Unnamed"}</h2>
                    <p className="text-xs text-slate-500">{ROLE_LABEL[selected.role]} · {selected.phone}</p>
                  </div>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 px-4 py-4"
                  onScroll={(e) => { const el = e.currentTarget; stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
                  {hasMore && (
                    <button onClick={() => { stickRef.current = false; loadMessages(selectedId, messages.find((m) => !m.pending)?.id) }}
                      className="mx-auto block rounded-full bg-white px-3 py-1 text-xs text-slate-600 shadow-sm">Load earlier messages</button>
                  )}
                  {messages.map((m) => {
                    const mine = m.sender === "ADMIN"
                    return (
                      <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[75%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm shadow-sm ${mine ? "rounded-br-sm bg-blue-600 text-white" : "rounded-bl-sm bg-white text-slate-900"} ${m.pending ? "opacity-60" : ""}`}>
                          {m.text}
                          <div className={`mt-1 text-right text-[10px] ${mine ? "text-blue-100" : "text-slate-400"}`}>{fmtTime(m.createdAt)}</div>
                        </div>
                      </div>
                    )
                  })}
                  <div ref={bottomRef} />
                </div>
                {!open && <div className="border-t bg-amber-50 px-4 py-2 text-xs text-amber-800">Chat is closed (outside chat hours). Change hours with the gear icon.</div>}
                {error && <div className="bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>}
                <form onSubmit={send} className="flex items-end gap-2 border-t border-slate-200 p-3">
                  <textarea value={text} onChange={(e) => setText(e.target.value)} disabled={!open} rows={1} maxLength={2000}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) send(e) }}
                    placeholder={open ? "Type a message" : "Chat is closed"}
                    className="max-h-28 flex-1 resize-none rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-600 disabled:bg-slate-100" />
                  <button type="submit" disabled={!open || !text.trim()} className="rounded-full bg-blue-600 p-2.5 text-white disabled:opacity-40"><Send className="h-5 w-5" /></button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>

      {showSettings && status && <SettingsModal initial={status} onClose={() => setShowSettings(false)} onSaved={(s) => { setStatus(s); setShowSettings(false) }} />}
      {showNew && <NewChatModal onClose={() => setShowNew(false)} onPick={startChat} />}
    </div>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function SettingsModal({ initial, onClose, onSaved }) {
  const [f, setF] = useState({ enabled: initial.enabled, startTime: initial.startTime, endTime: initial.endTime, days: initial.days, timezone: initial.timezone, closedMessage: initial.closedMessage })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState("")
  const toggleDay = (d) => setF((p) => ({ ...p, days: p.days.includes(d) ? p.days.filter((x) => x !== d) : [...p.days, d].sort() }))
  const save = async () => {
    setSaving(true)
    setErr("")
    try { onSaved(await adminChatApi.saveSettings(f)) } catch (e) { setErr(errMsg(e)); setSaving(false) }
  }
  return (
    <Modal title="Chat hours" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Chat enabled (turn off to close for everyone)</label>
        <div className="grid grid-cols-2 gap-3">
          <div>Start<TimeSelect12 value={f.startTime} onChange={(v) => setF({ ...f, startTime: v })} /></div>
          <div>End<TimeSelect12 value={f.endTime} onChange={(v) => setF({ ...f, endTime: v })} /></div>
        </div>
        <div>
          Days
          <div className="mt-1 flex flex-wrap gap-1">
            {DAYS.map((d, i) => (
              <button key={d} type="button" onClick={() => toggleDay(i)} className={`rounded-full px-3 py-1 text-xs ${f.days.includes(i) ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>{d}</button>
            ))}
          </div>
        </div>
        <label className="block">Timezone<input value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" /></label>
        <label className="block">Message shown when closed<input value={f.closedMessage} maxLength={200} onChange={(e) => setF({ ...f, closedMessage: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" /></label>
        {err && <p className="text-xs text-red-600">{err}</p>}
        <button onClick={save} disabled={saving} className="w-full rounded-lg bg-blue-600 py-2 text-white disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  )
}

/** 12-hour picker (hour / minute / AM-PM) that stores "HH:mm" 24h, regardless of the browser's locale. */
function TimeSelect12({ value, onChange }) {
  const [h24, m] = value.split(":").map(Number)
  const pm = h24 >= 12
  const h12 = h24 % 12 || 12
  const set = (nh12, nm, npm) => onChange(`${String((nh12 % 12) + (npm ? 12 : 0)).padStart(2, "0")}:${String(nm).padStart(2, "0")}`)
  const cls = "rounded border border-slate-300 px-1.5 py-1.5"
  return (
    <div className="mt-1 flex items-center gap-1">
      <select value={h12} onChange={(e) => set(Number(e.target.value), m, pm)} className={cls}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <span>:</span>
      <select value={m} onChange={(e) => set(h12, Number(e.target.value), pm)} className={cls}>
        {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 59].map((n) => <option key={n} value={n}>{String(n).padStart(2, "0")}</option>)}
      </select>
      <select value={pm ? "PM" : "AM"} onChange={(e) => set(h12, m, e.target.value === "PM")} className={cls}>
        <option>AM</option><option>PM</option>
      </select>
    </div>
  )
}

function NewChatModal({ onClose, onPick }) {
  const [role, setRole] = useState("USER")
  const [q, setQ] = useState("")
  const [results, setResults] = useState([])
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return undefined }
    const t = setTimeout(() => adminChatApi.participants({ role, q: q.trim() }).then((r) => setResults(r.results)).catch(() => setResults([])), 300)
    return () => clearTimeout(t)
  }, [role, q])
  return (
    <Modal title="Start a chat" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-1">
          {TABS.filter((t) => t.key).map((t) => (
            <button key={t.key} onClick={() => setRole(t.key)} className={`rounded-full px-3 py-1 text-xs ${role === t.key ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>{t.label}</button>
          ))}
        </div>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone (min 2 letters)" className="w-full rounded border border-slate-300 px-3 py-2" />
        <div className="max-h-64 divide-y overflow-y-auto">
          {results.map((r) => (
            <button key={r.participantId} onClick={() => onPick(r)} className="w-full py-2 text-left hover:bg-slate-50">
              <div className="font-medium text-slate-900">{r.name || "Unnamed"}</div>
              <div className="text-xs text-slate-500">{r.phone}</div>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}
