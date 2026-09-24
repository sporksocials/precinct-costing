"use client";

import { useMemo } from "react";
import { Scissors, TrendingUp } from "lucide-react";
import { sellExGst, type ItemCost, type LineCost } from "@/lib/costing";
import { gp, money } from "@/lib/format";
import { formatQty } from "@/lib/parse-qty";
import type { RecipeLine } from "@/lib/types";
import { cx } from "../ui";

/** Shares of the recipe cost, biggest first. */
export function useCostShares(lines: LineCost[], total: number) {
  return useMemo(() => {
    if (!(total > 0)) return [];
    return lines
      .filter((l) => l.cost > 0)
      .map((l) => ({ lc: l, share: l.cost / total }))
      .sort((a, b) => b.share - a.share);
  }, [lines, total]);
}

const SHADES = ["opacity-100", "opacity-75", "opacity-55", "opacity-40", "opacity-30"];

/** Stacked bar of where the money goes, plus the biggest cost in words. */
export function CostBar({ lines, total }: { lines: LineCost[]; total: number }) {
  const shares = useCostShares(lines, total);
  if (shares.length < 2) return null;
  const top = shares[0];
  return (
    <div className="px-4 pb-3 pt-3.5 lg:pl-9">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-fill" role="img" aria-label="Cost Breakdown">
        {shares.map((s, i) => (
          <span
            key={s.lc.line.id}
            title={`${s.lc.componentName} ${Math.round(s.share * 100)}%`}
            className={cx("h-full border-r-[1.5px] border-[color:var(--surface)] last:border-r-0", i < 5 ? `bg-accent-fill ${SHADES[i]}` : "bg-fill-2")}
            style={{ width: `${s.share * 100}%` }}
          />
        ))}
      </div>
      <p className="mt-2 text-[13px] text-label-2">
        Biggest cost: <span className="font-medium text-label">{top.lc.componentName}</span> · {Math.round(top.share * 100)}% ({money(top.lc.cost)})
      </p>
    </div>
  );
}

/** Nice-rounded quantity below `qty` for trimming a portion (5 g / 5 ml / 0.5 each steps). */
function trimQty(qty: number, unit: RecipeLine["unit"]): number {
  if (unit === "each") return Math.floor(qty * 2) / 2;
  if (unit === "kg" || unit === "L") return Math.floor(qty * 200) / 200; // 5 g / 5 ml
  return Math.floor(qty / 5) * 5;
}

export interface TrimFix {
  line: RecipeLine;
  name: string;
  from: number;
  to: number;
  gpAfter: number;
}

/**
 * When a dish is under target: what the biggest cost would have to be trimmed to (on its own) to reach
 * the target at today's price. Null when that would take more than a third of it, which isn't a portion
 * tweak any more.
 */
export function trimFix(cost: ItemCost, lines: LineCost[], gst: number): TrimFix | null {
  if (!cost.underTarget || cost.sellInc == null) return null;
  const portions = Number(cost.item.portions) > 0 ? Number(cost.item.portions) : 1;
  const allowed = sellExGst(cost.sellInc, gst) * (1 - cost.targetGp) * portions; // max recipe cost
  const excess = cost.recipeCost - allowed;
  if (!(excess > 0)) return null;
  const big = [...lines].filter((l) => l.cost > 0 && Number(l.line.qty) > 0).sort((a, b) => b.cost - a.cost)[0];
  if (!big) return null;
  const qty = Number(big.line.qty);
  const perUnit = big.cost / qty;
  const raw = qty - excess / perUnit;
  if (raw <= qty * (2 / 3)) return null;
  const to = trimQty(raw, big.line.unit);
  if (!(to > 0) || to >= qty) return null;
  const newCost = (cost.recipeCost - (qty - to) * perUnit) / portions;
  const ex = sellExGst(cost.sellInc, gst);
  return { line: big.line, name: big.componentName, from: qty, to, gpAfter: (ex - newCost) / ex };
}

/** The two ways back to target, side by side, each one tap. */
export function FixCard({ cost, fix, onRaise, onTrim }: { cost: ItemCost; fix: TrimFix | null; onRaise: () => void; onTrim: () => void }) {
  if (!cost.underTarget || cost.gpPct == null) return null;
  const gap = Math.round((cost.targetGp - cost.gpPct) * 1000) / 10;
  return (
    <section className="mt-6 overflow-hidden rounded-2xl bg-danger-soft">
      <p className="px-4 pb-1 pt-3.5 text-[15px] font-semibold text-danger">
        {gap} points under the {gp(cost.targetGp, 0)} target
      </p>
      <p className="px-4 text-[13px] text-label-2">Two ways back. Either one is a single tap and can be changed again.</p>
      <div className="mt-3 grid gap-px bg-[color:var(--separator)] sm:grid-cols-2">
        <button type="button" onClick={onRaise} className="flex items-center gap-3 bg-surface px-4 py-3 text-left transition hover:bg-surface-2 active:scale-[0.99]">
          <TrendingUp className="h-5 w-5 shrink-0 text-accent" strokeWidth={2.25} />
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold">Raise Price to {money(cost.suggestedInc)}</span>
            <span className="block text-[13px] text-label-2">from {money(cost.sellInc)}</span>
          </span>
        </button>
        {fix ? (
          <button type="button" onClick={onTrim} className="flex items-center gap-3 bg-surface px-4 py-3 text-left transition hover:bg-surface-2 active:scale-[0.99]">
            <Scissors className="h-5 w-5 shrink-0 text-accent" strokeWidth={2.25} />
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-semibold">
                Trim {fix.name} to {formatQty(fix.to, fix.line.unit)}
              </span>
              <span className="block text-[13px] text-label-2">
                from {formatQty(fix.from, fix.line.unit)} · GP {gp(fix.gpAfter)}
              </span>
            </span>
          </button>
        ) : (
          <div className="flex items-center gap-3 bg-surface px-4 py-3">
            <Scissors className="h-5 w-5 shrink-0 text-label-3" strokeWidth={2.25} />
            <span className="text-[13px] text-label-2">A portion trim alone won’t get there. Look at the price or swap the biggest cost.</span>
          </div>
        )}
      </div>
    </section>
  );
}

