"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchSellPriceLog, type SellPriceLogFilter } from "@/lib/store";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { gp, money } from "@/lib/format";
import { gpForPrice } from "@/lib/solver";
import { brisbaneDay, changePctLabel, priceChangeRows, whoLabel } from "@/lib/price-history";
import type { SellPriceLog } from "@/lib/types";
import { Group } from "../ui";

/**
 * Sell price history for one item, beer serve or gelato serve. Loaded on demand; shows the
 * empty state if the log table isn't there yet. `refreshKey` (e.g. the current sell price)
 * reloads after a price change. `cost` and `gst` let us show today's GP when the log has none.
 */
export function PriceHistory({ filter, refreshKey, cost, gst, className, serveNames }: { filter: SellPriceLogFilter; refreshKey?: unknown; cost?: number | null; gst?: number; className?: string; serveNames?: Record<string, string> }) {
  const [logs, setLogs] = useState<SellPriceLog[] | null>(null);
  const { kind, itemId, beerId, serveId, limit } = filter;

  useEffect(() => {
    let live = true;
    void fetchSellPriceLog(getSupabaseBrowser(), { kind, itemId, beerId, serveId, limit }).then((r) => {
      if (live) setLogs(r);
    });
    return () => {
      live = false;
    };
  }, [kind, itemId, beerId, serveId, limit, refreshKey]);

  const rows = useMemo(() => priceChangeRows(logs ?? []), [logs]);
  if (logs === null) return null;

  return (
    <Group title="Price History" className={className}>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-[15px] text-label-2">No price changes yet.</p>
      ) : (
        rows.map((r) => {
          const logged = r.gpPct != null;
          const gpShown = logged ? r.gpPct : r.label === "Price" && r.id === rows.find((x) => x.label === "Price")?.id && cost && gst != null ? gpForPrice(cost, r.to, gst) : null;
          const pctText = changePctLabel(r.changePct);
          return (
            <div key={`${r.id}-${r.label}`} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] tnum sm:text-[15px]">
                  {r.from != null ? money(r.from) : "None"} to {r.to != null ? money(r.to) : "None"}
                  {r.serveId && serveNames?.[r.serveId] ? <span className="ml-1.5 text-[13px] text-label-2">{serveNames[r.serveId]}</span> : null}
                  {r.label === "Happy Hour" ? <span className="ml-1.5 text-[13px] text-label-2">Happy Hour</span> : null}
                </span>
                <span className="block truncate text-[13px] text-label-2">
                  {brisbaneDay(r.at)} · {whoLabel(r.by)}
                </span>
              </span>
              <span className="text-right tnum">
                {pctText ? <span className={`block text-[15px] font-medium ${r.changePct! > 0 ? "text-label" : "text-label-2"}`}>{pctText}</span> : null}
                {gpShown != null ? <span className="block text-[13px] text-label-2">GP {gp(gpShown)}{logged ? "" : " now"}</span> : null}
              </span>
            </div>
          );
        })
      )}
    </Group>
  );
}
