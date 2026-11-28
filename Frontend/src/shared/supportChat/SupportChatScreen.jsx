import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Send, Clock, Loader2 } from "lucide-react";
import { chatApi, errMsg, fmtTime, isChatOpen, newClientId, useChatSocket } from "./chatCore";

/** Add/replace by id or clientId so socket echo + HTTP response + refetch never duplicate a bubble. */
const upsert = (list, m) => {
  const i = list.findIndex((x) => x.id === m.id || (m.clientId && x.clientId === m.clientId));
  if (i === -1) return [...list, m].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const next = [...list];
  next[i] = { ...next[i], ...m };
  return next;
};

/**
 * Participant-side chat with admin. Same screen for all four apps.
 * @param {"user"|"seller"|"restaurant"|"delivery"} module
 */
export default function SupportChatScreen({ module, title = "Chat with Admin" }) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [, tick] = useState(0);
  const bottomRef = useRef(null);
  const scrollerRef = useRef(null);
  const stickRef = useRef(true);

  const open = status ? isChatOpen(status) : false;

  const markRead = useCallback(() => {
    if (document.visibilityState === "visible") chatApi.read(module).catch(() => {});
  }, [module]);

  const loadLatest = useCallback(async () => {
    try {
      const [me, page] = await Promise.all([chatApi.me(module), chatApi.messages(module, { limit: 30 })]);
      setStatus(me.status);
      setMessages((prev) => page.messages.reduce(upsert, prev.filter((m) => m.pending)));
      setHasMore(page.hasMore);
      if (me.thread?.unreadForParticipant) markRead();
      setError("");
    } catch (e) {
      setError(errMsg(e, "Could not load chat"));
    } finally {
      setLoading(false);
    }
  }, [module, markRead]);

  useEffect(() => { loadLatest(); }, [loadLatest]);

  useChatSocket(module, {
    onConnect: () => { setConnected(true); loadLatest(); }, // catch up on anything missed while offline
    onDisconnect: () => setConnected(false),
    onSettings: setStatus,
    onMessage: ({ message }) => {
      setMessages((prev) => upsert(prev, message));
      if (message.sender === "ADMIN") markRead();
    },
  });

  // Socket down → poll lightly so the chat never goes stale; socket up → no polling at all.
  useEffect(() => {
    if (connected) return undefined;
    const t = setInterval(loadLatest, 10000);
    return () => clearInterval(t);
  }, [connected, loadLatest]);

  // Re-evaluate chat hours every 30s so the input flips at the boundary, and refresh on tab focus.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    const onVis = () => { if (document.visibilityState === "visible") loadLatest(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [loadLatest]);

  useEffect(() => {
    if (stickRef.current) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const loadEarlier = async () => {
    const first = messages.find((m) => !m.pending);
    if (!first || loadingMore) return;
    setLoadingMore(true);
    stickRef.current = false;
    try {
      const page = await chatApi.messages(module, { limit: 30, before: first.id });
      setMessages((prev) => page.messages.reduce(upsert, prev));
      setHasMore(page.hasMore);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoadingMore(false);
    }
  };

  const send = async (e) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || !open) return;
    const clientId = newClientId();
    stickRef.current = true;
    setText("");
    setError("");
    setMessages((prev) => upsert(prev, { id: `tmp-${clientId}`, clientId, sender: "PARTICIPANT", text: body, createdAt: new Date().toISOString(), pending: true }));
    try {
      const res = await chatApi.send(module, { text: body, clientId });
      setMessages((prev) => upsert(prev.filter((m) => m.id !== `tmp-${clientId}`), res.message));
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== `tmp-${clientId}`));
      setText(body); // give the text back so nothing is lost
      setError(errMsg(err, "Message not sent"));
      if (err?.response?.status === 403) loadLatest(); // hours changed under us
    }
  };

  return (
    <div className="flex h-[100dvh] flex-col bg-slate-50">
      <header className="flex items-center gap-3 border-b bg-white px-4 py-3">
        <button onClick={() => navigate(-1)} aria-label="Back" className="rounded-full p-1.5 hover:bg-slate-100">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-slate-900">{title}</h1>
          {status && (
            <p className="flex items-center gap-1 text-xs text-slate-500">
              <span className={`h-2 w-2 rounded-full ${open ? "bg-green-500" : "bg-slate-400"}`} />
              {open ? "Open" : "Closed"} · {status.startTime}–{status.endTime}
            </p>
          )}
        </div>
      </header>

      <div ref={scrollerRef} onScroll={onScroll} className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
        {loading && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>}
        {hasMore && (
          <button onClick={loadEarlier} disabled={loadingMore} className="mx-auto block rounded-full bg-white px-3 py-1 text-xs text-slate-600 shadow-sm">
            {loadingMore ? "Loading…" : "Load earlier messages"}
          </button>
        )}
        {!loading && messages.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-500">
            {open ? "Say hello — the admin team will reply here." : "No messages yet."}
          </p>
        )}
        {messages.map((m) => {
          const mine = m.sender === "PARTICIPANT";
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm shadow-sm ${mine ? "rounded-br-sm bg-green-600 text-white" : "rounded-bl-sm bg-white text-slate-900"} ${m.pending ? "opacity-60" : ""}`}>
                {m.text}
                <div className={`mt-1 text-right text-[10px] ${mine ? "text-green-100" : "text-slate-400"}`}>{fmtTime(m.createdAt)}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {status && !open && (
        <div className="flex items-start gap-2 border-t bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{status.enabled ? `${status.closedMessage} Chat hours: ${status.startTime}–${status.endTime}.` : status.closedMessage}</span>
        </div>
      )}
      {error && <div className="bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>}

      <form onSubmit={send} className="flex items-end gap-2 border-t bg-white p-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) send(e); }}
          disabled={!open}
          maxLength={2000}
          rows={1}
          placeholder={open ? "Type a message" : "Chat is closed"}
          className="max-h-28 flex-1 resize-none rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-green-600 disabled:bg-slate-100"
        />
        <button type="submit" disabled={!open || !text.trim()} aria-label="Send" className="rounded-full bg-green-600 p-2.5 text-white disabled:opacity-40">
          <Send className="h-5 w-5" />
        </button>
      </form>
    </div>
  );
}
