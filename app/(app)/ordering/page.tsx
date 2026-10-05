"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useStore } from "@/lib/store";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { OrderingError } from "@/lib/ordering-data";
import { loadVenueSummaries, type VenueSummary } from "@/lib/ordering-screens-data";
import { lastCountLine } from "@/lib/ordering-history-view";
import { orderingVenueName } from "@/lib/ordering";
import { VENUE_SHORT } from "@/components/venue";
import { Banner, cx, PageHeader, Skeleton } from "@/components/ui";
import { usePersonName } from "@/components/use-person-name";
import { Tag } from "@/components/ordering/touch";

/**
 * Ordering always works one venue at a time (there is no "All"): this is the venue picker. Each card shows the last count,
 * whether a count is in progress and how many orders are waiting to be sent. Choosing a venue opens that venue's Ordering home.
 */
export default function OrderingLanding() {
  const { venues } = useStore();
  const nameOf = usePersonName();
  const sb = useMemo(() => getSupabaseBrowser(), []);
  const [summaries, setSummaries] = useState<Map<number, VenueSummary | OrderingError> | null>(null);
  const ids = venues.map((v) => v.id).join(",");

  useEffect(() => {
    let live = true;
    void loadVenueSummaries(sb, venues.map((v) => v.id)).then((m) => live && setSummaries(m));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb, ids]);

  const unavailable = summaries ? Array.from(summaries.values()).find((s): s is OrderingError => s instanceof OrderingError && s.code === "missing_table") : null;
  const sorted = [...venues].sort((a, b) => a.sort - b.sort);

  return (
    <div className="max-w-4xl">
      <PageHeader title="Ordering" subtitle="Pick a venue. Each one is separate." />
      {unavailable ? <Banner>{unavailable.message}</Banner> : null}
      <ul className="mt-4 grid gap-3 sm:grid-cols-2" aria-label="Venues">
        {sorted.map((v) => {
          const s = summaries?.get(v.id);
          const ok = s && !(s instanceof OrderingError) ? s : null;
          const name = VENUE_SHORT[v.slug] ?? orderingVenueName(v);
          return (
            <li key={v.id}>
              <Link
                href={`/ordering/${v.slug}`}
                className={cx(
                  `v-${v.slug}`,
                  "group relative flex min-h-[132px] flex-col justify-between gap-3 overflow-hidden rounded-[18px] bg-surface px-5 pb-4 pt-5 transition-[background-color,transform] duration-200 ease-ios hover:bg-surface-2 active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--label)]",
                )}
              >
                <span aria-hidden className="absolute inset-x-0 top-0 h-[4px] bg-accent-fill" />
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-[24px] font-semibold leading-tight">{name}</span>
                    <span className="mt-1 block text-[15px] text-label-2">
                      {!summaries ? <Skeleton className="mt-1 h-4 w-44" /> : s instanceof OrderingError ? "Not available yet" : ok && ok.products === 0 ? "No products yet. Set them up to start." : lastCountLine(ok?.lastCount ?? null, nameOf)}
                    </span>
                  </span>
                  <ChevronRight className="mt-1 h-6 w-6 shrink-0 text-label-3 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" strokeWidth={2.25} aria-hidden />
                </span>
                {ok ? (
                  <span className="flex flex-wrap gap-2">
                    {ok.countInProgress ? <Tag tone="accent">Counting in progress</Tag> : null}
                    {ok.draftOrders > 0 ? (
                      <Tag tone="warn">
                        {ok.draftOrders} open order{ok.draftOrders === 1 ? "" : "s"}
                      </Tag>
                    ) : null}
                    {ok.products > 0 ? <Tag>{ok.products} products</Tag> : null}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
