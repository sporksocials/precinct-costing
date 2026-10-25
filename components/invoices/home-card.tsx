"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Check, ChevronRight, Clock, Target } from "lucide-react";
import { useStore } from "@/lib/store";
import { useInvoiceHome } from "@/lib/invoice-data";
import { useMatchCounts } from "@/lib/invoice-todo-match";
import { useApproveCounts } from "@/lib/invoice-todo-approve";
import { caughtUpLine, FIRST_RUN_TEXT, homeCounts, invoicesWord, pricesWord, todoPhrase, todoTotal, weekRange } from "@/lib/invoice-view";

const CARD_DEPTH = "shadow-[0_14px_34px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(255,255,255,0.06)]";

/**
 * Home: three states of one card, all for this week (Monday to Sunday, Brisbane), all one tap to Invoices.
 * First run: "No invoices yet. Scan one and it appears here." All caught up: "All Caught Up" with one quiet line. Work to do: the two big
 * numbers ("Invoices Processed", "Prices Updated") and ONE amber line saying what waits ("41 items to match, 46 prices to approve").
 * What waits comes from the same two count hooks as the Invoices page, so the card can never disagree with the list behind it.
 * It hides itself entirely when the invoice tables cannot be read (the migration is not applied yet, or there is no connection), so
 * Home never shows an error or a row of zeros for a feature that is not on yet.
 * Colour: the number text is plain; the one amber line carries the Target icon and its words. Green is never used here.
 */
export function InvoicesHomeCard() {
  const { today } = useStore();
  const { data } = useInvoiceHome(today);
  const match = useMatchCounts(null);
  const approve = useApproveCounts(null);
  const counts = useMemo(() => (data ? homeCounts({ docs: data.docs, changes: data.changes, range: weekRange(today), totalDocs: data.totalDocs }) : null), [data, today]);
  if (!data || !counts) return null;

  const known = !!match.data && !!approve.data;
  const todo = { items: match.data?.items ?? 0, prices: approve.data?.prices ?? 0, checks: approve.data?.checks ?? 0 };
  const total = todoTotal(todo);
  const phrase = todoPhrase(todo);
  const caughtUp = known && total === 0 && !counts.firstRun;
  const href = total > 0 ? "/invoices?tab=todo" : "/invoices";

  const label = counts.firstRun
    ? `Invoices. ${FIRST_RUN_TEXT}`
    : caughtUp
      ? `Invoices. All caught up. ${caughtUpLine(counts)}${counts.reading ? `. ${counts.reading} still being read` : ""}. View all`
      : `Invoices this week: ${counts.processed} ${invoicesWord(counts.processed).toLowerCase()}, ${counts.updated} ${pricesWord(counts.updated).toLowerCase()}${counts.reading ? `, ${counts.reading} still being read` : ""}${phrase ? `, ${phrase}` : ""}. View all`;

  return (
    <section aria-labelledby="home-invoices">
      <div className="flex items-baseline justify-between px-1 pb-2">
        <h2 id="home-invoices" className="text-[22px] font-bold tracking-tight">
          Invoices
        </h2>
        {counts.firstRun ? null : <span className="text-[13px] text-label-2">This Week</span>}
      </div>
      <Link
        href={href}
        aria-label={label}
        className={`block min-h-[56px] rounded-2xl bg-surface transition-colors hover:bg-surface-2 active:bg-surface-2 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--label)] ${CARD_DEPTH}`}
      >
        {counts.firstRun ? (
          <span className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3">
            <span className="text-[17px] text-label-2 sm:text-[15px]">{FIRST_RUN_TEXT}</span>
            <ChevronRight aria-hidden className="-mr-1 h-[18px] w-[18px] shrink-0 text-label-3" strokeWidth={2.5} />
          </span>
        ) : caughtUp ? (
          <span className="flex min-h-[72px] items-center justify-between gap-3 px-4 py-3">
            <span className="block min-w-0">
              <span className="flex items-center gap-2 text-[20px] font-semibold">
                <Check aria-hidden className="h-5 w-5 shrink-0 text-label-2" strokeWidth={2.75} />
                All Caught Up
              </span>
              <span className="mt-0.5 block text-[15px] text-label-2 sm:text-[13px]">{caughtUpLine(counts)}</span>
              {counts.reading > 0 ? (
                <span className="mt-1 flex items-center gap-1.5 text-[15px] text-label-2 sm:text-[13px]">
                  <Clock aria-hidden className="h-[16px] w-[16px]" strokeWidth={2.25} />
                  {counts.reading} Still Being Read
                </span>
              ) : null}
            </span>
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
            {phrase ? (
              <span className="mx-4 mb-3 flex items-start gap-1.5 text-[17px] font-semibold text-warn sm:text-[15px]">
                <Target aria-hidden className="mt-[3px] h-[18px] w-[18px] shrink-0" strokeWidth={2.75} />
                <span>{phrase}</span>
              </span>
            ) : null}
            <span className="flex min-h-[48px] items-center justify-between border-t-[0.5px] border-sep px-4">
              <span className="text-[17px] font-semibold text-accent sm:text-[15px]">{total > 0 ? "Open To Do" : "View All"}</span>
              <ChevronRight aria-hidden className="-mr-1 h-[18px] w-[18px] text-label-3" strokeWidth={2.5} />
            </span>
          </>
        )}
      </Link>
    </section>
  );
}
