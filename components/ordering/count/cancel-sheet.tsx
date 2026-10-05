"use client";

import { Sheet } from "@/components/ui";
import { progressText } from "@/lib/ordering-count-ui";

/**
 * Cancel Count: asks first, says what it does. The numbers entered so far are set aside (never deleted) and are not used for
 * any order; the next Count starts fresh. A finished count is never cancelled here (Edit Count corrects it).
 */
export function CancelSheet({ open, counted, total, busy, error, onKeep, onCancel }: { open: boolean; counted: number; total: number; busy: boolean; error: string | null; onKeep: () => void; onCancel: () => void }) {
  return (
    <Sheet open={open} onClose={onKeep} title="Cancel This Count?" cancelLabel={null}>
      <p className="px-1 text-[15px] text-label-2">
        <span className="tnum">{progressText(counted, total)}.</span> If you cancel, these numbers are set aside and no order is made from them. The next time you tap Count, it starts fresh.
      </p>
      {error ? (
        <p role="alert" className="mt-3 rounded-2xl bg-danger-soft px-4 py-3 text-[15px] text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex flex-col gap-2">
        <button type="button" className="btn-primary !min-h-[44px] w-full" disabled={busy} onClick={onKeep}>
          Keep Counting
        </button>
        <button type="button" className="btn-plain !min-h-[44px] w-full !text-danger" disabled={busy} onClick={onCancel}>
          {busy ? "Cancelling..." : "Cancel Count"}
        </button>
      </div>
    </Sheet>
  );
}
