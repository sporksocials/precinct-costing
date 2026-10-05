"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, ClipboardCheck, History, PackageSearch, SlidersHorizontal } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { OrderingError } from "@/lib/ordering-data";
import { loadVenueSummary, type VenueSummary } from "@/lib/ordering-screens-data";
import { lastCountLine } from "@/lib/ordering-history-view";
import { Banner, cx, Empty, PageHeader, Skeleton } from "@/components/ui";
import { usePersonName } from "@/components/use-person-name";
import { useOrderingVenue } from "@/components/ordering/venue-context";
import { CopyVenueSheet } from "@/components/ordering/copy-venue-sheet";
import { Tag, TouchBack, TouchButton, TouchLink } from "@/components/ordering/touch";

/** A big, visible card to one of the venue's four areas. The whole card is the link (well over 44px tall). */
function AreaCard({ href, icon, title, help, tag, primary }: { href: string; icon: React.ReactNode; title: string; help: string; tag?: React.ReactNode; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={cx(
        "group relative flex min-h-[112px] items-start gap-4 rounded-[18px] p-5 transition-[background-color,transform] duration-200 ease-ios active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--label)]",
        primary ? "bg-accent-fill text-accent-on" : "bg-surface hover:bg-surface-2",
      )}
    >
      <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", primary ? "bg-black/15" : "bg-accent-soft text-accent")} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[20px] font-semibold leading-tight">{title}</span>
        <span className={cx("mt-1 block text-[15px] leading-snug", primary ? "opacity-80" : "text-label-2")}>{help}</span>
        {tag ? <span className="mt-2 block">{tag}</span> : null}
      </span>
      <ChevronRight className={cx("mt-1 h-6 w-6 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none", primary ? "opacity-70" : "text-label-3")} strokeWidth={2.25} aria-hidden />
    </Link>
  );
}

export default function OrderingVenueHome() {
  const { venue, name, base } = useOrderingVenue();
  const nameOf = usePersonName();
  const sb = useMemo(() => getSupabaseBrowser(), []);
  const [summary, setSummary] = useState<VenueSummary | null>(null);
  const [error, setError] = useState<OrderingError | Error | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setSummary(await loadVenueSummary(sb, venue.id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }, [sb, venue.id]);
  useEffect(() => {
    setSummary(null);
    void load();
  }, [load]);

  const empty = summary != null && summary.products === 0;
  const inProgress = !!summary?.countInProgress;

  return (
    <div className="max-w-4xl lg:pt-6">
      <TouchBack path="/ordering" fallback="/ordering">
        Ordering
      </TouchBack>
      <PageHeader title={name} subtitle={summary ? (empty ? "No products yet" : lastCountLine(summary.lastCount, nameOf)) : "Ordering"} className="lg:!pt-2" />
      {error ? <Banner>{error.message}</Banner> : null}

      {!summary && !error ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[112px] rounded-[18px]" />
          ))}
        </div>
      ) : null}

      {empty ? (
        <div className="mt-4 rounded-[18px] bg-surface">
          <Empty
            title={`${name} has no products yet`}
            body={`Add ${name}'s drinks one by one, or start from another venue's list. Each venue keeps its own list, counts and orders.`}
            action={
              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                <TouchLink href={`${base}/setup/products`} variant="primary">
                  Set Up Products
                </TouchLink>
                <TouchButton onClick={() => setCopyOpen(true)}>Copy Products From Another Venue</TouchButton>
              </div>
            }
          />
        </div>
      ) : null}

      {summary && !empty ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <AreaCard
            primary
            href={`${base}/count`}
            icon={<ClipboardCheck className="h-6 w-6" strokeWidth={2} />}
            title="Count"
            help={inProgress ? "A count is in progress. Pick it up where it was left." : "Count Store and second place stock, category by category. Finish the count and your orders are ready."}
          />
          <AreaCard
            href={`${base}/orders`}
            icon={<PackageSearch className="h-6 w-6" strokeWidth={2} />}
            title="Orders"
            help="Make supplier orders from a count, and send them."
            tag={summary.draftOrders > 0 ? <Tag tone="warn">{summary.draftOrders} not sent yet</Tag> : undefined}
          />
          <AreaCard href={`${base}/history`} icon={<History className="h-6 w-6" strokeWidth={2} />} title="History" help="Past counts and orders, and how each product has moved." />
          <AreaCard href={`${base}/setup`} icon={<SlidersHorizontal className="h-6 w-6" strokeWidth={2} />} title="Setup" help="Suppliers, categories and products with their Build To levels." tag={<Tag>{summary.products} products</Tag>} />
        </div>
      ) : null}

      {summary && !empty ? (
        <p className="mt-6 text-[13px] text-label-2">
          {name} is separate from every other venue: its own products, Build To levels, counts and orders.
        </p>
      ) : null}

      <CopyVenueSheet target={venue} open={copyOpen} onClose={() => setCopyOpen(false)} onDone={() => void load()} />
    </div>
  );
}
