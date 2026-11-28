import { useEffect, useRef } from "react";
import io from "socket.io-client";
import apiClient from "../../services/api/axios";
import { API_BASE_URL } from "../../services/api/config";
import { resolveSocketOrigin } from "../../services/socket/createRealtimeSocket";

/** module = which logged-in app is talking: user | seller | restaurant | delivery | admin */
const TOKEN_KEYS = {
  user: ["user_accessToken", "accessToken"],
  seller: ["seller_accessToken", "auth_seller"],
  restaurant: ["restaurant_accessToken"],
  delivery: ["delivery_accessToken", "driver_accessToken"],
  admin: ["admin_accessToken"],
};

export function getChatToken(module) {
  try {
    for (const k of TOKEN_KEYS[module] || []) {
      const v = localStorage.getItem(k);
      if (v) return v;
    }
  } catch { /* storage blocked */ }
  return "";
}

const cfg = (module) => ({ contextModule: module });
const unwrap = (res) => res.data?.data;

/** Participant (user / seller / restaurant / delivery) side. */
export const chatApi = {
  me: (m) => apiClient.get("/support-chat/me", cfg(m)).then(unwrap),
  messages: (m, params) => apiClient.get("/support-chat/me/messages", { ...cfg(m), params }).then(unwrap),
  send: (m, body) => apiClient.post("/support-chat/me/messages", body, cfg(m)).then(unwrap),
  read: (m) => apiClient.patch("/support-chat/me/read", {}, cfg(m)).then(unwrap),
};

/** Admin side. URLs contain /admin/, so the axios layer picks the admin token on its own. */
export const adminChatApi = {
  threads: (params) => apiClient.get("/support-chat/admin/threads", { params }).then(unwrap),
  unread: () => apiClient.get("/support-chat/admin/unread").then(unwrap),
  participants: (params) => apiClient.get("/support-chat/admin/participants", { params }).then(unwrap),
  open: (body) => apiClient.post("/support-chat/admin/threads", body).then(unwrap),
  messages: (id, params) => apiClient.get(`/support-chat/admin/threads/${id}/messages`, { params }).then(unwrap),
  send: (id, body) => apiClient.post(`/support-chat/admin/threads/${id}/messages`, body).then(unwrap),
  read: (id) => apiClient.patch(`/support-chat/admin/threads/${id}/read`, {}).then(unwrap),
  getSettings: () => apiClient.get("/support-chat/admin/settings").then(unwrap),
  saveSettings: (body) => apiClient.put("/support-chat/admin/settings", body).then(unwrap),
};

export const errMsg = (e, fallback = "Something went wrong") => e?.response?.data?.message || e?.message || fallback;

/** Same rule as the server (the server still decides); lets the UI flip open/closed at the boundary without a request. */
export function isChatOpen(s, now = new Date()) {
  if (!s || !s.enabled) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: s.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const cur = Number(get("hour")) * 60 + Number(get("minute"));
  const mins = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3));
  const start = mins(s.startTime), end = mins(s.endTime);
  if (start === end) return s.days.includes(day);
  if (start < end) return s.days.includes(day) && cur >= start && cur < end;
  return (cur >= start && s.days.includes(day)) || (cur < end && s.days.includes((day + 6) % 7));
}

export const fmtTime = (d) => {
  try { return new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
};

export const newClientId = () =>
  (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 64);

/**
 * Keeps one socket open while the chat screen is mounted. Token is re-read on every (re)connect, so a
 * refreshed access token is picked up. `handlers` may change every render; latest ones are always used.
 * `onConnect` fires on every (re)connect: refetch there to catch anything missed while offline.
 */
export function useChatSocket(module, handlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const { origin } = resolveSocketOrigin(API_BASE_URL);
    if (!origin) return undefined;
    const socket = io(origin, {
      path: "/socket.io/",
      transports: ["polling", "websocket"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      auth: (cb) => cb({ token: getChatToken(module) }),
    });
    socket.on("connect", () => ref.current.onConnect?.());
    socket.on("disconnect", () => ref.current.onDisconnect?.());
    socket.on("support_chat:message", (p) => ref.current.onMessage?.(p));
    socket.on("support_chat:read", (p) => ref.current.onRead?.(p));
    socket.on("support_chat:settings", (p) => ref.current.onSettings?.(p));
    return () => socket.disconnect();
  }, [module]);
}
