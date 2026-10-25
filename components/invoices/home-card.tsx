"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ChevronRight, Clock, Target } from "lucide-react";
import { useStore } from "@/lib/store";
import { useInvoiceHome } from "@/lib/invoice-data";
import { homeCounts, invoicesWord, needYouText, pricesWord, weekRange } from "@/lib/invoice-view";

const CARD_DEPTH = "shadow-[0_14px_34px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(255,255,255,0.06)]";

/**
 * Home: "12 Invoices Processed, 31 Prices Updated" for this week (Monday to Sunday, Brisbane), with how many things need a person.
 * The whole card is one tap to the Invoices list. It hides itself entirely when the invoice tables cannot be read (the migration is
 * not applied yet, or there is no connection), so Home never shows an error or a row of zeros for a feature that is not on yet.
 * Colour: the number text is plain; the one amber line ("3 Need You") is the existing warn token and always carries the Target icon
 * and its words. Green is never used here.
 */
export function InvoicesHomeCard() {
  const { today } = useStore();
  const { data } = useInvoiceHome(today);
  const counts = useMemo(
    () => (data ? homeCounts({ docs: data.docs, changes: data.changes, range: weekRange(today), waiting: data.waiting, totalDocs: data.totalDocs }) : null),
    [data, today],
  );
  if (!data || !counts) return null;

  const label = counts.firstRun
    ? "Invoices. No invoices yet."
    : `Invoices this week: ${counts.processed} ${invoicesWord(counts.processed).toLowerCase()}, ${counts.updated} ${pricesWord(counts.updated).toLowerCase()}${counts.reading ? `, ${counts.reading} still being read` : ""}${counts.needYou ? `, ${needYouText(counts.needYou)}` : ""}. View all`;

  return (
    <section aria-labelledby="home-invoices">
      <div className="flex items-baseline justify-between px-1 pb-2">
        <h2 id="home-invoices" className="text-[22px] font-bold tracking-tight">
          Invoices
        </h2>
        {counts.firstRun ? null : <span className="text-[13px] text-label-2">This Week</span>}
      </div>
      <Link
        href="/invoices"
        aria-label={label}
        className={`block min-h-[56px] rounded-2xl bg-surface transition-colors hover:bg-surface-2 active:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--label)] ${CARD_DEPTH}`}
      >
        {counts.firstRun ? (
          <span className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3">
            <span className="text-[17px] text-label-2 sm:text-[15px]">No invoices yet. Scan one and it appears here.</span>
            <ChevronRight aria-hidden className="-mr-1 h-[18px] w-[18px] shrink-0 text-label-3" strokeWidth={2.5} />
          </span>
        ) : (
          <>
            <span className="grid grid-cols-2 gap-3 px-4 pb-3 pt-4">
              <span className="block">
                <span className="display block text-[56px] leading-none tnum">{counts.processed}</span>
                <span className="mt-1 block text-[15px] text-label-2 sm:text-[13px]">{invoicesWord(counts.processed)}</span>
              </span>
              <span className="block">
                <span className="display block text-[56px] leading-none tnum">{counts.updated}</span>
                <span className="mt-1 block text-[15px] text-label-2 sm:text-[13px]">{pricesWord(counts.updated)}</span>
              </span>
            </span>
            {counts.reading > 0 ? (
              <span className="mx-4 mb-2 flex items-center gap-1.5 text-[15px] text-label-2 sm:text-[13px]">
                <Clock aria-hidden className="h-[16px] w-[16px]" strokeWidth={2.25} />
                {counts.reading} Still Being Read
              </span>
            ) : null}
            {counts.needYou > 0 ? (
              <span className="mx-4 mb-3 flex items-center gap-1.5 text-[17px] font-semibold text-warn sm:text-[15px]">
                <Target aria-hidden className="h-[18px] w-[18px]" strokeWidth={2.75} />
                {needYouText(counts.needYou)}
              </span>
            ) : null}
            <span className="flex min-h-[48px] items-center justify-between border-t-[0.5px] border-sep px-4">
              <span className="text-[17px] font-semibold text-accent sm:text-[15px]">View All</span>
              <ChevronRight aria-hidden className="-mr-1 h-[18px] w-[18px] text-label-3" strokeWidth={2.5} />
            </span>
          </>
        )}
      </Link>
    </section>
  );
}
