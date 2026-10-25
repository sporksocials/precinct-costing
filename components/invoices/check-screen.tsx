"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { INVOICES_UNAVAILABLE } from "@/lib/invoice-data-extra";
import { Banner, cx, Empty, ListSkeleton, PageHeader } from "@/components/ui";
import { VenueFilter, useVenue } from "@/components/venue";
import { TouchBack, TouchButton, TouchLink } from "@/components/ordering/touch";
import { CheckCard } from "./check-card";
import { useCheckTasks } from "./approve-use-data";

/**
 * /invoices/check: the odd ones, as plain tasks with the answers the questions already offer. Matching lines to items and big
 * price changes are NOT here: matching has its own screen and big changes are rows in Approve Prices. `?doc=<id>` narrows the list
 * to one invoice.
 */
export function CheckScreen() {
  const store = useStore();
  const params = useSearchParams();
  const docId = params.get("doc");
  const { venue } = useVenue();
  const { data, error, loading, reload } = useCheckTasks(venue?.slug ?? null);
  const sb = useMemo(() => getSupabaseBrowser(), []);
  // answered this visit: gone at once, before the fresh copy arrives
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [last, setLast] = useState<string | null>(null);

  const all = useMemo(() => (data?.tasks ?? []).filter((t) => !gone.has(t.q.id)), [data, gone]);
  const tasks = useMemo(() => (docId ? all.filter((t) => t.doc.id === docId) : all), [all, docId]);

  const done = useCallback(
    (id: string, message: string, applied: boolean) => {
      setGone((g) => new Set([...g, id]));
      setLast(message);
      if (applied) void store.reload();
      void reload();
    },
    [reload, store],
  );

  return (
    <div className="max-w-3xl pb-8">
      <div className="pt-1 lg:pt-6">
        <TouchBack path="/invoices" fallback="/invoices">
          Invoices
        </TouchBack>
      </div>
      <PageHeader title="Check These" subtitle={loading && !data ? undefined : data?.missing ? undefined : all.length ? `${all.length} to check` : "All done"} className="!pt-0 lg:!pt-2" />

      <VenueFilter stats={false} compact />

      {docId ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-fill px-4 py-2 text-[15px] text-label-2">
          <span>Showing one invoice.</span>
          <Link href="/invoices/check" className="inline-flex min-h-[44px] items-center font-medium text-accent">
            Show All
          </Link>
        </div>
      ) : null}

      {error && !data ? <Banner action={<TouchButton onClick={() => void reload()}>Try Again</TouchButton>}>{error}</Banner> : null}
      {loading && !data && !error ? <ListSkeleton rows={4} /> : null}
      {data?.missing ? <Empty title="Invoices Are Not Set Up Yet" body={INVOICES_UNAVAILABLE} /> : null}

      {last ? (
        <p className={cx("mt-4 flex items-start gap-2 rounded-xl bg-fill px-4 py-2.5 text-[15px] text-label-2")} aria-live="polite">
          <CheckCircle2 aria-hidden className="mt-0.5 h-[18px] w-[18px] shrink-0 text-good" strokeWidth={2.25} />
          <span className="min-w-0">{last}</span>
        </p>
      ) : null}

      {data && !data.missing && tasks.length === 0 && !loading ? (
        <Empty
          title="Nothing To Check. Nice work."
          body="When an invoice has something odd, it appears here."
          action={
            <TouchLink href="/invoices" variant="tinted">
              Back To Invoices
            </TouchLink>
          }
        />
      ) : null}

      {tasks.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-3" aria-label="Things to check">
          {tasks.map((t) => (
            <CheckCard key={t.q.id} task={t} sb={sb} actor={store.userEmail ?? "unknown"} onDone={done} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
