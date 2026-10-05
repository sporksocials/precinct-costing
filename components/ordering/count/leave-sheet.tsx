"use client";

import { Sheet } from "@/components/ui";
import { progressText } from "@/lib/ordering-count-ui";

/**
 * Shown when someone taps Back to Ordering in the middle of a count. Every number is already saved as it is tapped, so
 * "save" simply leaves the count in progress for the next person (or later today) to pick up.
 */
export function LeaveSheet({ open, counted, total, busy, error, onSave, onKeep, onCancel }: { open: boolean; counted: number; total: number; busy: boolean; error: string | null; onSave: () => void; onKeep: () => void; onCancel: () => void }) {
  return (
    <Sheet open={open} onClose={onKeep} title="Leave This Count?" cancelLabel={null}>
      <p className="px-1 text-[15px] text-label-2">
        <span className="tnum">{progressText(counted, total)}.</span> Save it to carry on later, or cancel it to throw these numbers away.
      </p>
      {error ? (
        <p role="alert" className="mt-3 rounded-2xl bg-danger-soft px-4 py-3 text-[15px] text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex flex-col gap-2">
        <button type="button" className="btn-primary !min-h-[48px] w-full" disabled={busy} onClick={onSave}>
          Save Count To Continue Later
        </button>
        <button type="button" className="inline-flex min-h-[48px] w-full touch-manipulation items-center justify-center rounded-xl bg-danger-soft px-4 text-[16px] font-semibold text-danger transition active:opacity-80 disabled:opacity-40" disabled={busy} onClick={onCancel}>
          {busy ? "Cancelling..." : "Cancel Count"}
        </button>
        <button type="button" className="btn-plain !min-h-[48px] w-full" disabled={busy} onClick={onKeep}>
          Keep Counting
        </button>
      </div>
    </Sheet>
  );
}
