import React, { useState } from "react";
import { useToast } from "@shared/components/ui/Toast";
import { sellerApi } from "../services/sellerApi";

const PRESET_REASONS = [
  "Order is taking longer to prepare",
  "Item out of stock - arranging a replacement",
  "Store is very busy right now",
  "Packing is taking extra time",
];

const ACTIVE_STATUSES = ["confirmed", "preparing", "packed", "ready_for_pickup"];

/**
 * "Report delay" for the store: tells the customer the order will be late (same as the
 * restaurant delay report in Food). Self-contained so the order list needs no extra props.
 */
export default function OrderDelayButton({ order, className = "" }) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(PRESET_REASONS[0]);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);

  const status = String(order?.status || "").toLowerCase();
  if (!ACTIVE_STATUSES.includes(status)) return null;

  const submit = async () => {
    const text = reason === "other" ? custom.trim() : reason;
    if (!text) {
      showToast("Please enter a reason", "error");
      return;
    }
    setBusy(true);
    try {
      await sellerApi.reportOrderDelay(order.id, text);
      showToast("Customer has been told about the delay", "success");
      setOpen(false);
    } catch (error) {
      showToast(error?.response?.data?.message || "Failed to report delay", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        className={
          className ||
          "px-2 py-1 rounded-md bg-amber-50 text-amber-700 text-[10px] font-semibold uppercase tracking-wider"
        }
      >
        Report delay
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Report a delay</h3>
            <p className="mt-1 text-xs text-slate-500">The customer sees this reason on their order.</p>
            <div className="mt-3 space-y-2">
              {[...PRESET_REASONS, "other"].map((item) => (
                <label key={item} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="radio" name={`delay-${order.id}`} checked={reason === item} onChange={() => setReason(item)} />
                  {item === "other" ? "Other" : item}
                </label>
              ))}
              {reason === "other" ? (
                <input
                  value={custom}
                  onChange={(event) => setCustom(event.target.value)}
                  placeholder="Type the reason"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400"
                />
              ) : null}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-xs font-bold text-slate-500">
                Close
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={submit}
                className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-black uppercase tracking-wider text-white disabled:opacity-50"
              >
                {busy ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
