"use client";

import { AlertTriangle } from "lucide-react";
import { money } from "@/lib/format";
import { limitText } from "@/lib/invoice-names";
import { biggestChange, overLimit, pricesWord, type ApproveRow } from "@/lib/invoice-todo-approve";
import { priceMove } from "@/lib/invoice-view";
import { TouchButton, TouchSheet } from "@/components/ordering/touch";

/** Before a bulk approve: how many, the biggest change, and the plain fact that recipes cost the new price straight away. */
export function ApproveConfirm({
  rows,
  limit,
  nameOf,
  progress,
  onConfirm,
  onClose,
}: {
  rows: ApproveRow[] | null;
  limit: number;
  nameOf: (row: ApproveRow) => string;
  /** set while the approving runs */
  progress: { done: number; total: number } | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (!rows) return null;
  const n = rows.length;
  const big = biggestChange(rows);
  const bigCount = rows.filter((r) => overLimit(r.maxPct, limit)).length;
  const running = progress !== null;
  return (
    <TouchSheet open onClose={() => (running ? undefined : onClose())} title="Approve Prices" size="sm">
      <div className="space-y-4 pb-2">
        <h3 className="text-[20px] font-semibold leading-tight">{`Approve ${n} ${n === 1 ? "Price" : "Prices"}?`}</h3>
        <div className="space-y-1.5 rounded-2xl bg-surface-2 px-4 py-3 text-[15px]">
          <p>
            <span className="font-semibold">{pricesWord(n)}</span> will be set to the invoice price.
          </p>
          {big && big.pct !== null ? (
            <p className="text-label-2">
              Biggest change: <span className="font-medium text-label">{nameOf(big)}</span>, {money(big.oldPrice)} to {money(big.newPrice)} ({priceMove(big.pct).text.toLowerCase()}).
            </p>
          ) : null}
          {bigCount > 0 ? (
            <p className="flex items-start gap-1.5 font-medium text-warn">
              <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
              <span>{`${bigCount === 1 ? "1 change is" : `${bigCount} changes are`} ${limitText(limit)} or more.`}</span>
            </p>
          ) : null}
        </div>
        <p className="text-[15px] text-label-2">Recipes using these items will cost the new price straight away. The price history says which invoice set each one, and you can undo any of them.</p>
        {running ? (
          <div role="status" aria-live="polite">
            <div className="h-2 overflow-hidden rounded-full bg-fill" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label="Approving prices">
              <div className="h-full rounded-full bg-accent-fill transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
            </div>
            <p className="mt-1.5 text-[15px] text-label-2 tnum">{`Updating ${Math.min(progress.done + 1, progress.total)} of ${progress.total}. Please keep this open.`}</p>
          </div>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <TouchButton variant="primary" disabled={running || n === 0} onClick={onConfirm} className="sm:flex-1">
            {running ? "Approving..." : `Approve ${n} ${n === 1 ? "Price" : "Prices"}`}
          </TouchButton>
          <TouchButton disabled={running} onClick={onClose} className="sm:flex-1">
            Not Yet
          </TouchButton>
        </div>
      </div>
    </TouchSheet>
  );
}
