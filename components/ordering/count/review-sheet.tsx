"use client";

import { useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { Sheet } from "@/components/ui";
import { progressText, type ReviewLists, type ReviewRow } from "@/lib/ordering-count-ui";

const SHOWN = 8;

/** A list capped at 8 rows with a Show All button, so a long list never pushes Finalise Count out of reach. */
function Section({ title, rows }: { title: string; rows: React.ReactNode[] }) {
  const [all, setAll] = useState(false);
  if (rows.length === 0) return null;
  const more = rows.length - SHOWN;
  return (
    <section className="mt-5">
      <h3 className="px-1 pb-1.5 text-[13px] font-medium text-label-2">
        {title} ({rows.length})
      </h3>
      <ul className="overflow-hidden rounded-2xl bg-surface">{all ? rows : rows.slice(0, SHOWN)}</ul>
      {more > 0 ? (
        <button type="button" className="btn-text !min-h-[44px] mt-1 px-1" aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {all ? "Show Fewer" : `Show All ${rows.length}`}
        </button>
      ) : null}
    </section>
  );
}

function JumpRow({ row, note, onJump }: { row: ReviewRow; note?: string; onJump: (productId: string) => void }) {
  return (
    <li className="[&:not(:first-child)]:border-t [&:not(:first-child)]:border-[color:var(--separator)]">
      <button type="button" onClick={() => onJump(row.product.id)} className="flex min-h-[48px] w-full touch-manipulation items-center gap-3 px-4 py-2 text-left active:bg-fill">
        <span className="min-w-0 flex-1">
          <span className="block break-words text-[16px] font-medium leading-snug">{row.product.name}</span>
          <span className="block text-[13px] text-label-2">{[row.categoryName, note].filter(Boolean).join(", ")}</span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-label-3" aria-hidden />
      </button>
    </li>
  );
}

/**
 * Finish Count: what is still not counted (tap one to jump to it), what is over Build To, and two-place products with one place
 * blank, then Finalise Count. Finalise waits for the device's taps to reach the database and says so politely.
 */
export function ReviewSheet({
  open,
  onClose,
  lists,
  blocked,
  busy,
  error,
  onJump,
  onFinalise,
  onRetry,
}: {
  open: boolean;
  onClose: () => void;
  lists: ReviewLists;
  /** why Finalise cannot run right now (offline, changes still saving), else null */
  blocked: string | null;
  busy: boolean;
  error: string | null;
  onJump: (productId: string) => void;
  onFinalise: () => void;
  onRetry: () => void;
}) {
  const nothingLeft = lists.uncounted.length === 0;
  return (
    <Sheet open={open} onClose={onClose} title="Finish Count" cancelLabel={null} size="lg">
      <div className="flex items-center justify-between gap-3">
        <p className="px-1 text-[15px] text-label-2 tnum">{progressText(lists.counted, lists.total)}</p>
        <button type="button" className="btn-text !min-h-[44px] px-2" onClick={onClose}>
          Close
        </button>
      </div>

      {nothingLeft ? (
        <p className="mt-3 flex items-center gap-2 rounded-2xl bg-good-soft px-4 py-3 text-[15px] text-good">
          <Check className="h-5 w-5 shrink-0" strokeWidth={3} aria-hidden />
          Every product has a count.
        </p>
      ) : (
        <p className="mt-1 px-1 text-[13px] text-label-2">Anything not counted gets no suggested order. Tap a product to go back to it.</p>
      )}

      <Section title="Not Counted" rows={lists.uncounted.map((r) => <JumpRow key={r.product.id} row={r} onJump={onJump} />)} />
      <Section title="Over Build To" rows={lists.overPar.map((r) => <JumpRow key={r.product.id} row={r} note={`Over by ${r.over} (${r.counted} counted, Build To ${r.product.par})`} onJump={onJump} />)} />
      <Section title="One Place Blank" rows={lists.partial.map((r) => <JumpRow key={r.product.id} row={r} note={`${r.missing} blank, counted as none`} onJump={onJump} />)} />

      <div className="sticky bottom-0 -mx-4 mt-6 bg-[#17171a] px-4 pb-1 pt-3 shadow-[0_-0.5px_0_var(--separator)]">
        {blocked ? (
          <p role="status" className="mb-3 rounded-2xl bg-warn-soft px-4 py-3 text-[15px] text-warn">
            {blocked}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mb-3 rounded-2xl bg-danger-soft px-4 py-3 text-[15px] text-danger">
            {error}
          </p>
        ) : null}
        <button type="button" className="btn-primary !min-h-[44px] w-full" disabled={busy || !!blocked} onClick={onFinalise}>
          {busy ? "Finishing..." : "Finish And Go To Orders"}
        </button>
        {blocked ? (
          <button type="button" className="btn-plain !min-h-[44px] mt-2 w-full" onClick={onRetry}>
            Try To Sync Now
          </button>
        ) : null}
        <p className="mt-3 px-1 text-[13px] text-label-2">Finishing takes you straight to your orders, made from this count. If you spot a mistake later, Edit Count on the Orders screen opens it again: every change is logged with who made it and the old number.</p>
      </div>
    </Sheet>
  );
}
