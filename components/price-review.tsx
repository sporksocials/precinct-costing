"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { useStore } from "@/lib/store";
import { gp, money } from "@/lib/format";
import { applyPlan, defaultSelection, groupChangesByVenue, type ReviewChange } from "@/lib/price-review";
import { useApplyPrices } from "./price-actions";
import { cx, Sheet } from "./ui";

/**
 * Review & Apply: every suggested price change in one list (item, old and new price, GP before
 * and after) with a tick box each. Nothing is written until "Apply N Changes"; one Undo reverts
 * the lot. Grouped by venue when the changes span more than one.
 */
export function ReviewSheet({ changes, onClose, onDone, intro }: { changes: ReviewChange[]; onClose: () => void; /** called after the ticked changes were written (before onClose) */ onDone?: () => void; intro?: string }) {
  const store = useStore();
  const applyMany = useApplyPrices();
  const [sel, setSel] = useState<Set<string>>(() => defaultSelection(changes));
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => groupChangesByVenue(changes), [changes]);
  const n = changes.filter((c) => sel.has(c.key)).length;
  const toggle = (key: string) =>
    setSel((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const allOn = n === changes.length;

  async function apply() {
    if (!n || busy) return;
    setBusy(true);
    await applyMany(applyPlan(changes, sel));
    onDone?.();
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title="Review & Apply" size="lg" action={{ label: busy ? "Applying…" : `Apply ${n}`, onClick: () => void apply(), disabled: !n || busy }}>
      <div className="pb-2 pt-2">
        <div className="flex items-center justify-between gap-3 px-1">
          <p className="text-[13px] text-label-2">{intro ?? "Untick anything you want to leave alone. Prices include GST."}</p>
          <button type="button" className="min-h-[44px] shrink-0 px-1 text-[15px] font-medium text-accent lg:min-h-[32px] lg:text-[13px]" onClick={() => setSel(allOn ? new Set() : new Set(changes.map((c) => c.key)))}>
            {allOn ? "Select None" : "Select All"}
          </button>
        </div>

        {groups.map((g) => (
          <section key={g.venueId} className="mt-3">
            {groups.length > 1 ? <h3 className="px-4 pb-1.5 text-[13px] font-medium text-label-2">{store.venueById.get(g.venueId)?.name ?? "Venue"}</h3> : null}
            <div className="group-list">
              {g.changes.map((c) => {
                const on = sel.has(c.key);
                return (
                  <button
                    key={c.key}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle(c.key)}
                    className="flex min-h-[64px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-fill hover:bg-[color:var(--fill)]"
                  >
                    <span
                      aria-hidden
                      className={cx("flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-[1.5px]", on ? "border-transparent bg-accent-fill text-accent-on" : "border-[color:var(--label-3)] text-transparent")}
                    >
                      <Check className="h-4 w-4" strokeWidth={3} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[17px] leading-snug sm:text-[15px]">{c.name}</span>
                      <span className="mt-0.5 block text-[15px] leading-snug text-label-2 tnum sm:text-[13px]">
                        {money(c.oldPrice)} → <span className="font-semibold text-label">{money(c.newPrice)}</span>
                      </span>
                      {c.note ? <span className="mt-0.5 block text-[13px] leading-snug text-label-2">{c.note}</span> : null}
                      {c.needsCheck ? <span className="mt-0.5 block text-[13px] leading-snug text-warn">Check the cost first, it looks wrong. Left unticked.</span> : null}
                    </span>
                    <span className="shrink-0 text-right text-[15px] leading-snug tnum sm:text-[13px]">
                      <span className="block text-label-2">GP {gp(c.gpBefore, 0)}</span>
                      <span className="block font-semibold text-good">→ {gp(c.gpAfter, 0)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        <button type="button" className="btn-primary mt-5 w-full" disabled={!n || busy} onClick={() => void apply()}>
          {busy ? "Applying…" : `Apply ${n} ${n === 1 ? "Change" : "Changes"}`}
        </button>
        <p className="mt-2 px-1 text-center text-[13px] text-label-2">You can undo all of them straight after.</p>
      </div>
    </Sheet>
  );
}
