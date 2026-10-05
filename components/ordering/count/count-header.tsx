"use client";

import { forwardRef, useEffect, useRef } from "react";
import { Check, CircleDashed, CloudOff, RefreshCw, Search, WifiOff, X } from "lucide-react";
import { cx } from "@/components/ui";
import { progressPercent, progressText, type CategoryJump, type SyncStatus } from "@/lib/ordering-count-ui";

/** The save status in words with an icon (colour only backs it up). Announced politely when it changes. */
export function SyncPill({ status }: { status: SyncStatus }) {
  const Icon = status.kind === "saved" ? Check : status.kind === "saving" ? RefreshCw : status.kind === "offline" ? WifiOff : CloudOff;
  const warn = status.kind === "offline" || status.kind === "retrying";
  return (
    <p role="status" aria-live="polite" data-sync={status.kind} className={cx("inline-flex min-w-0 items-center gap-1.5 text-right text-[13px] font-medium leading-tight", warn ? "text-warn" : "text-label-2")}>
      <Icon className={cx("h-4 w-4 shrink-0", status.kind === "saving" && "motion-safe:animate-spin")} strokeWidth={2.25} aria-hidden />
      <span>{status.text}</span>
    </p>
  );
}

/**
 * The sticky top of the count screen: progress, save status, search, Show Uncounted and the category jump chips.
 * Its height is measured by the screen so the sticky category headers and the jump scroll sit just under it.
 */
export const CountHeader = forwardRef<
  HTMLDivElement,
  {
    counted: number;
    total: number;
    status: SyncStatus;
    query: string;
    onQuery: (q: string) => void;
    uncountedOnly: boolean;
    uncountedLeft: number;
    onUncountedOnly: (on: boolean) => void;
    jumps: CategoryJump[];
    activeCategoryId: string | null;
    onJump: (categoryId: string) => void;
  }
>(function CountHeader({ counted, total, status, query, onQuery, uncountedOnly, uncountedLeft, onUncountedOnly, jumps, activeCategoryId, onJump }, ref) {
  const chips = useRef<HTMLDivElement>(null);
  // keep the current category's chip in view as the list scrolls
  useEffect(() => {
    const box = chips.current;
    const el = box?.querySelector<HTMLElement>('[aria-current="true"]');
    if (box && el) box.scrollTo({ left: Math.max(0, el.offsetLeft - 16) });
  }, [activeCategoryId]);

  return (
    <div ref={ref} className="sticky top-[env(safe-area-inset-top,0px)] z-30 bg-bg pb-2 pt-2 hairline">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[17px] font-semibold leading-tight tnum">{progressText(counted, total)}</p>
        <SyncPill status={status} />
      </div>
      <div role="progressbar" aria-label="Products counted" aria-valuemin={0} aria-valuemax={total} aria-valuenow={counted} className="mt-1.5 h-1 overflow-hidden rounded-full bg-fill-2">
        <div className="h-full rounded-full bg-accent-fill transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${progressPercent(counted, total)}%` }} />
      </div>
      <div className="mt-2 flex gap-2">
        <label className="relative flex min-w-0 flex-1 items-center">
          <Search className="pointer-events-none absolute left-3 h-[18px] w-[18px] text-label-2" strokeWidth={2.25} aria-hidden />
          <input
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Search products"
            placeholder="Search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            className="h-11 w-full rounded-xl bg-fill pl-10 pr-11 text-[17px] text-label outline-none placeholder:text-label-2 focus:shadow-[0_0_0_2px_var(--accent-fill)] [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button type="button" aria-label="Clear search" onClick={() => onQuery("")} className="absolute right-0 flex h-11 w-11 items-center justify-center text-label-2">
              <X className="h-5 w-5" strokeWidth={2.5} aria-hidden />
            </button>
          ) : null}
        </label>
        <button
          type="button"
          aria-pressed={uncountedOnly}
          onClick={() => onUncountedOnly(!uncountedOnly)}
          className={cx(
            "inline-flex h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-[15px] font-semibold transition motion-reduce:transition-none",
            uncountedOnly ? "bg-accent-fill text-accent-on" : "bg-fill text-label",
          )}
        >
          {uncountedOnly ? <Check className="h-4 w-4" strokeWidth={3} aria-hidden /> : <CircleDashed className="h-4 w-4" strokeWidth={2.5} aria-hidden />}
          <span>Show Uncounted ({uncountedLeft})</span>
        </button>
      </div>
      {jumps.length > 1 ? (
        <nav aria-label="Jump to a category" ref={chips} className="no-scrollbar relative mt-2 flex gap-2 overflow-x-auto">
          {jumps.map((j) => {
            const on = j.id === activeCategoryId;
            const done = j.total > 0 && j.counted === j.total;
            return (
              <button
                key={j.id}
                type="button"
                aria-current={on ? "true" : undefined}
                onClick={() => onJump(j.id)}
                className={cx(
                  "inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[15px] font-medium transition motion-reduce:transition-none",
                  on ? "bg-accent-fill text-accent-on" : "bg-surface text-label shadow-[inset_0_0_0_0.5px_var(--separator)]",
                )}
              >
                {j.name}
                <span className="tnum text-[13px] opacity-80">
                  {done ? <Check className="inline h-3.5 w-3.5" strokeWidth={3} aria-label="all counted" /> : `${j.counted}/${j.total}`}
                </span>
              </button>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
});
