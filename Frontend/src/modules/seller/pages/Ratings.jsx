import React, { useCallback, useEffect, useState } from "react";
import { HiOutlineStar } from "react-icons/hi2";
import { toast } from "sonner";
import { sellerApi } from "../services/sellerApi";

const Stars = ({ value }) => (
  <span className="inline-flex gap-0.5" aria-label={`${value} out of 5`}>
    {[1, 2, 3, 4, 5].map((s) => (
      <HiOutlineStar key={s} className={`h-3.5 w-3.5 ${s <= Math.round(value) ? "fill-yellow-400 text-yellow-400" : "text-slate-300"}`} />
    ))}
  </span>
);

/** What customers rated this shop's products. The shop's rating is the average of these product ratings. */
export default function Ratings() {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await sellerApi.getRatings({ page, limit: 20 });
      setData(res?.data?.result || null);
    } catch (error) {
      if (error?.response?.status !== 401) toast.error("Failed to load ratings");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = data?.summary || { average: 0, totalRatings: 0 };
  const items = data?.items || [];
  const reviews = data?.reviews || [];
  const pages = data?.pagination?.pages || 1;

  return (
    <div className="space-y-5 pb-6">
      <div>
        <h1 className="text-lg font-semibold text-[#1c1c1e]">Product Ratings</h1>
        <p className="text-xs text-slate-500">Customers rate the products they received. Your shop rating is the average of all these ratings.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Shop rating</div>
          <div className="mt-1 text-2xl font-bold text-green-600">{summary.totalRatings ? `${Number(summary.average).toFixed(1)} ★` : "—"}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Total ratings</div>
          <div className="mt-1 text-2xl font-bold text-[#1c1c1e]">{summary.totalRatings}</div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-[#1c1c1e]">By product</div>
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">{loading ? "Loading..." : "No product has been rated yet."}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((i) => (
              <li key={i.itemId} className="flex items-center gap-3 px-4 py-3">
                {i.image ? <img src={i.image} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <div className="h-10 w-10 rounded-lg bg-slate-100" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[#1c1c1e]">{i.name}</p>
                  <p className="text-xs text-slate-400">{i.count} rating{i.count === 1 ? "" : "s"}</p>
                </div>
                <div className="text-right">
                  <Stars value={i.average} />
                  <p className="text-xs font-semibold text-slate-600">{Number(i.average).toFixed(1)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-[#1c1c1e]">Latest reviews</div>
        {reviews.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">No reviews yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {reviews.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-medium text-[#1c1c1e]">{r.itemName}</p>
                  <Stars value={r.rating} />
                </div>
                {r.comment ? <p className="mt-1 text-sm text-slate-600">&ldquo;{r.comment}&rdquo;</p> : null}
                <p className="mt-1 text-[11px] text-slate-400">
                  {r.customerName || "Customer"} · {r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-3">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-200 px-3 py-1 text-xs disabled:opacity-40">Prev</button>
            <span className="text-xs text-slate-500">Page {page} of {pages}</span>
            <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-200 px-3 py-1 text-xs disabled:opacity-40">Next</button>
          </div>
        )}
      </div>
    </div>
  );
}
