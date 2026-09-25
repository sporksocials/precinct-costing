"use client";

import { useEffect, useMemo, useRef } from "react";
import { gp, money } from "@/lib/format";
import { ingredientBudget, priceOptions } from "@/lib/price-picker";
import type { ItemCost } from "@/lib/costing";
import type { CostingSettings } from "@/lib/types";
import { cx, useToast } from "../ui";

/**
 * Candidate sell prices with GP% at each. Tap one to set the price (undoable).
 * With no price yet this is "Set A Price", the first thing under the ingredients.
 */
export function PricePicker({ cost, settings, setPrice }: { cost: ItemCost; settings: CostingSettings; setPrice: (p: number | null) => void }) {
  const toast = useToast();
  const gst = settings.gst_rate;
  const target = cost.targetGp;
  const current = cost.sellInc != null && cost.sellInc > 0 ? cost.sellInc : null;
  const options = useMemo(
    () => priceOptions({ cost: cost.costPerPortion, target, gst, step: settings.round_to, current }),
    [cost.costPerPortion, target, gst, settings.round_to, current]
  );
  const hasPrice = current != null;
  // keep the suggested chip in view when the row first shows (horizontal only, never moves the page)
  const rowRef = useRef<HTMLDivElement>(null);
  const shown = options.length > 0;
  useEffect(() => {
    const row = rowRef.current;
    const chip = row?.querySelector<HTMLElement>("[data-suggested]");
    if (row && chip) row.scrollLeft = Math.max(0, chip.offsetLeft - row.clientWidth / 2 + chip.offsetWidth / 2);
  }, [shown]);

  function pick(price: number) {
    if (current != null && Math.abs(current - price) < 0.005) return;
    const prev = current;
    setPrice(price);
    toast.show({ message: `Price set to ${money(price)}`, action: { label: "Undo", onClick: () => setPrice(prev) } });
  }

  const budgetPrice = current ?? options.find((o) => o.kind === "suggested")?.price ?? null;
  const spend = budgetPrice != null ? ingredientBudget(budgetPrice, target, gst) : null;
  const over = spend != null && cost.costPerPortion > spend + 0.005;

  return (
    <section className="mt-6" aria-label={hasPrice ? "Price Options" : "Set A Price"}>
      <p className="section-label !px-1">{hasPrice ? "Price Options" : "Set A Price"}</p>
      {options.length === 0 ? (
        <p className="rounded-2xl bg-surface px-4 py-3 text-[15px] text-label-2">Add ingredients and prices appear here at {gp(target, 0)} target GP.</p>
      ) : (
        <div className="rounded-2xl bg-surface py-3">
          <div ref={rowRef} className="relative flex gap-2 overflow-x-auto px-3 pb-1" role="group" aria-label="Candidate prices">
            {options.map((o) => {
              const selected = current != null && Math.abs(current - o.price) < 0.005;
              return (
                <button
                  key={o.price}
                  type="button"
                  aria-pressed={selected}
                  data-suggested={o.kind === "suggested" ? "" : undefined}
                  onClick={() => pick(o.price)}
                  className={cx(
                    "flex min-h-[56px] min-w-[84px] shrink-0 flex-col items-center justify-center rounded-xl px-3 py-1.5 active:opacity-70",
                    o.belowTarget ? "bg-danger-soft text-danger" : "bg-good-soft text-good",
                    selected && "ring-2 ring-accent"
                  )}
                >
                  <span className="text-[11px] font-semibold uppercase leading-none tracking-wide">
                    {o.kind === "suggested" ? "Suggested" : o.kind === "current" ? "Current" : o.belowTarget ? "Below Target" : " "}
                  </span>
                  <span className="mt-1 text-[17px] font-semibold leading-tight tnum">{money(o.price)}</span>
                  <span className="text-[13px] leading-tight tnum">GP {gp(o.gpPct, 0, target)}</span>
                </button>
              );
            })}
          </div>
          {spend != null && budgetPrice != null ? (
            <p className="mt-2 px-4 text-[13px] text-label-2">
              To hit {gp(target, 0)} at {money(budgetPrice)} you can spend {money(spend)} on ingredients; you&rsquo;re at{" "}
              <span className={over ? "font-semibold text-danger" : "font-semibold text-label"}>{money(cost.costPerPortion)}</span>.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
