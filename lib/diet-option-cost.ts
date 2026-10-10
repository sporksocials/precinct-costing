import { costItem, type CostingIndex, type ItemCost, type PrepCost } from "./costing";
import type { DietOptionId } from "./diet-legend";
import { addedAsLines, readOption, type OptionRead } from "./diet-options";
import type { CostingSettings, MenuItem, RecipeLine, Target } from "./types";

/**
 * The separate costing of a dietary OPTION (GFO, VO, VGO, DFO), Troy 10 Oct 2026. DISPLAY ONLY: the recipe editor's option
 * card is the one reader. Home, alerts, GP averages, the Menu list, price suggestions and every other consumer stay on the
 * STANDARD dish (a test pins that lib/insights.ts, lib/dashboard.ts and the Menu page never read these fields).
 *
 * It uses the same engine as the dish (`costItem` with its line override): units, yields, prep costs, deals, GST and
 * rounding are not forked, so a price change on an ingredient or prep flows through. The option's lines are the dish's own
 * lines minus the ones the option leaves out, plus the lines it adds. Its price is the dish's sell price inc GST plus the
 * optional surcharge; GP is worked out against that price. Amounts are per recipe, like the dish's own lines.
 */

export interface OptionCost {
  option: OptionRead;
  /** the lines the option is made from (the dish's lines minus the left out ones, plus the added ones) */
  lines: RecipeLine[];
  /** how many of the option's left-out ids matched a line of the dish (a stale id is ignored) */
  leftOutCount: number;
  /** the option costed as a dish, at its own price */
  cost: ItemCost;
  /** the standard dish, for the comparison */
  standard: ItemCost;
  /** dollars inc GST on top of the dish price, 0 when none */
  surcharge: number;
  /** cost per portion, ex GST */
  costPerPortion: number;
  /** the option's price inc GST (dish price plus surcharge), or null when the dish has no sell price */
  priceInc: number | null;
  priceEx: number | null;
  gpPct: number | null;
  targetGp: number;
  /** option cost minus the standard dish cost, per portion, ex GST */
  costDiff: number;
  /** option GP minus standard GP, as a fraction (0.03 = 3 points); null when either has no price */
  gpDiff: number | null;
  /** nothing left out, nothing added, no surcharge: the option is the standard dish */
  sameAsStandard: boolean;
  /** plain reasons the option cost cannot be fully trusted (an added component that is missing or inactive, a stale left-out line) */
  notes: string[];
}

export interface OptionCostContext {
  index: CostingIndex;
  settings: CostingSettings;
  targets: Target[];
}

/** The dish's lines with the option's left-out lines removed and its added lines appended. The input is not touched. */
export function optionLines(item: Pick<MenuItem, "id">, lines: readonly RecipeLine[], option: unknown): RecipeLine[] {
  const o = asRead(option);
  const out = o ? lines.filter((l) => !o.removed.includes(l.id)) : [...lines];
  if (!o || !o.added.length) return out;
  const maxSort = lines.reduce((m, l) => Math.max(m, Number(l.sort) || 0), 0);
  return [...out, ...addedAsLines(o.added, item.id, maxSort)];
}

/** Accepts an already read option, a raw entry or null. */
function asRead(option: unknown): OptionRead | null {
  if (option && typeof option === "object" && "removed" in (option as object) && "added" in (option as object) && "surcharge" in (option as object)) return option as OptionRead;
  return option ? readOption({ x: option }, "x" as DietOptionId) : null;
}

/** Line ids the option leaves out that are not lines of the dish (any more). */
export function staleLeftOut(lines: readonly RecipeLine[], option: unknown): string[] {
  const o = asRead(option);
  if (!o) return [];
  const live = new Set(lines.map((l) => l.id));
  return o.removed.filter((id) => !live.has(id));
}

export function optionCost(item: MenuItem, lines: readonly RecipeLine[], option: unknown, ctx: OptionCostContext): OptionCost | null {
  const o = asRead(option);
  if (!o) return null;
  const standard = costItem(item, ctx.index, ctx.settings, ctx.targets, new Map<string, PrepCost>(), [...lines]);
  const live = new Set(lines.map((l) => l.id));
  const leftOutCount = o.removed.filter((id) => live.has(id)).length;
  const own = optionLines(item, lines, o);
  const base = item.sell_price_inc != null ? Number(item.sell_price_inc) : null;
  const priceInc = base != null && base > 0 ? Math.round((base + o.surcharge) * 100) / 100 : null;
  const asDish: MenuItem = { ...item, sell_price_inc: priceInc };
  const cost = costItem(asDish, ctx.index, ctx.settings, ctx.targets, new Map<string, PrepCost>(), own);

  const notes: string[] = [];
  const addedLines = own.slice(own.length - o.added.length);
  o.added.forEach((a, i) => {
    const lc = cost.recipe.lines.find((c) => c.line.id === addedLines[i].id);
    if (lc?.warning?.kind === "missing_component") notes.push(`${a.component_type === "prep" ? "An added prep" : "An added ingredient"} no longer exists, so it costs nothing here.`);
    else {
      const inactive = a.component_type === "ingredient" ? ctx.index.ingredients.get(a.component_id)?.active === false : ctx.index.preps.get(a.component_id)?.active === false;
      if (inactive) notes.push(`${lc?.componentName ?? "An added item"} is inactive, but it still costs normally.`);
    }
  });
  if (o.removed.length > leftOutCount) notes.push("A line left out here has been removed from the dish, so it is ignored.");

  const sameAsStandard = leftOutCount === 0 && o.added.length === 0 && o.surcharge === 0;
  return {
    option: o,
    lines: own,
    leftOutCount,
    cost,
    standard,
    surcharge: o.surcharge,
    costPerPortion: cost.costPerPortion,
    priceInc,
    priceEx: cost.sellEx,
    gpPct: cost.gpPct,
    targetGp: cost.targetGp,
    costDiff: cost.costPerPortion - standard.costPerPortion,
    gpDiff: cost.gpPct != null && standard.gpPct != null ? cost.gpPct - standard.gpPct : null,
    sameAsStandard,
    notes,
  };
}

/** "1 point", "3 points", "1.5 points": whole points when whole, one decimal otherwise. */
function pointsText(pts: number): string {
  const r = Math.round(Math.abs(pts) * 10) / 10;
  const t = Number.isInteger(r) ? String(r) : r.toFixed(1);
  return `${t} ${r === 1 ? "point" : "points"}`;
}

/**
 * The plain sentences under the option costing card: how the cost and the GP compare with the standard dish. `fmt` formats a
 * dollar amount (the screens pass `money`). Null lines mean "nothing to say" (no change, or no price to compare).
 */
export function describeOptionDiff(oc: Pick<OptionCost, "costDiff" | "gpDiff" | "sameAsStandard">, fmt: (n: number) => string): { cost: string | null; gp: string | null; same: boolean } {
  if (oc.sameAsStandard) return { cost: null, gp: null, same: true };
  const cents = Math.round(oc.costDiff * 100);
  const cost = cents === 0 ? "Same cost as the standard dish" : `${fmt(Math.abs(cents) / 100)} ${cents > 0 ? "more" : "less"} than the standard dish`;
  const pts = oc.gpDiff == null ? null : Math.round(oc.gpDiff * 1000) / 10;
  const gp = pts == null ? null : pts === 0 ? "Same GP as the standard dish" : `GP ${pointsText(pts)} ${pts > 0 ? "higher" : "lower"}`;
  return { cost, gp, same: false };
}
