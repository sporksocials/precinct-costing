"use client";

import { useState } from "react";
import { Sheet, cx } from "./ui";
import type { RestorePlan } from "@/lib/trash";

/**
 * Trash > Restore: shows the impact FIRST (what comes back, which lines cannot), then Restore / Cancel.
 * A blocked restore (name clash, missing keg) shows the plain message and only offers Cancel.
 */
export function RestoreSheet({
  plan,
  onClose,
  onConfirm,
}: {
  plan: RestorePlan | null;
  onClose: () => void;
  onConfirm: (plan: RestorePlan) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };
  const go = async () => {
    if (!plan || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(plan);
      setBusy(false);
      onClose();
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Could not restore. Nothing was changed.");
    }
  };
  return (
    <Sheet
      open={!!plan}
      onClose={close}
      title={plan ? `Restore ${plan.entry.type}` : "Restore"}
      action={plan && !plan.blocker ? { label: busy ? "Restoring..." : "Restore", onClick: () => void go(), disabled: busy } : undefined}
      cancelLabel="Cancel"
    >
      {plan ? (
        <div className="space-y-3 px-5 pb-4 pt-1 text-[15px] leading-snug">
          {plan.blocker ? (
            <p className="rounded-xl bg-danger-soft px-3.5 py-3 font-medium text-danger" role="alert">
              {plan.blocker}
            </p>
          ) : (
            <>
              <p className="font-semibold text-label">{plan.headline}</p>
              <p className="text-label-2">It comes back exactly as it was when it was deleted. Offers and specials that used it before it was deleted are not linked back to it.</p>
            </>
          )}
          {!plan.blocker && plan.skipped.length ? (
            <div className="rounded-xl bg-fill px-3.5 py-3">
              <p className="font-semibold text-warn">
                {plan.skipped.length === 1 ? "1 line cannot come back" : `${plan.skipped.length} lines cannot come back`}
              </p>
              <ul className={cx("mt-1 space-y-0.5 text-label-2")}>
                {plan.skipped.map((s) => (
                  <li key={String(s.row.id)}>
                    {s.label}: {s.reason}.
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-label-2">Everything else is restored. Add those lines again in the recipe afterwards.</p>
            </div>
          ) : null}
          {!plan.blocker && plan.researchNote ? <p className="text-[13px] text-label-2">{plan.researchNote}</p> : null}
          {error ? (
            <p className="rounded-xl bg-danger-soft px-3.5 py-3 font-medium text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}
