/**
 * Candidate sell prices around the suggestion, with GP% at each.
 * Local helper for the price picker; can later be swapped for costing.ts `priceLadder`.
 * Costs are ex GST, sell prices inc GST.
 */

export type PriceOptionKind = "suggested" | "charm" | "current";

export interface PriceOption {
  price: number;
  gpPct: number;
  gpDollars: number;
  kind: PriceOptionKind;
  belowTarget: boolean;
}

const EPS = 1e-9;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** GP fraction and dollars (ex GST) for an inc-GST price. */
export function gpAt(cost: number, priceInc: number, gst: number): { gpPct: number; gpDollars: number } {
  const ex = priceInc / (1 + gst);
  return { gpPct: ex > 0 ? (ex - cost) / ex : 0, gpDollars: ex - cost };
}

/** Most the ingredients can cost (ex GST) at this price and target GP. */
export function ingredientBudget(priceInc: number, target: number, gst: number): number {
  return (priceInc / (1 + gst)) * (1 - target);
}

/** Suggested price at target GP, rounded UP to the venue step. */
export function suggestedAt(cost: number, target: number, gst: number, step: number): number {
  if (!(cost > 0) || target >= 1) return 0;
  const raw = (cost / (1 - target)) * (1 + gst);
  if (step <= 0) return round2(raw);
  return round2(Math.ceil(raw / step - EPS) * step);
}

/** Psychological points: .00, .50 and .90 in each dollar, ascending. */
export function charmPoints(from: number, to: number): number[] {
  const out: number[] = [];
  for (let d = Math.max(0, Math.floor(from) - 1); d <= Math.ceil(to) + 1; d++) {
    for (const c of [0, 0.5, 0.9]) {
      const p = round2(d + c);
      if (p > 0) out.push(p);
    }
  }
  return out;
}

/**
 * The suggestion, up to `below` charm points under it and `above` over it, sorted ascending.
 * A current price that is not already listed is added as kind "current".
 * Empty when there is no cost to price from.
 */
export function priceOptions(opts: { cost: number; target: number; gst: number; step: number; current?: number | null; below?: number; above?: number }): PriceOption[] {
  const { cost, target, gst, step, current } = opts;
  const suggested = suggestedAt(cost, target, gst, step);
  if (!(suggested > 0)) return [];
  const nBelow = opts.below ?? 2;
  const nAbove = opts.above ?? 3;
  const pts = charmPoints(suggested - 4, suggested + 6);
  const below = pts.filter((p) => p < suggested - 0.005).slice(-nBelow);
  const above = pts.filter((p) => p > suggested + 0.005).slice(0, nAbove);
  const mk = (price: number, kind: PriceOptionKind): PriceOption => {
    const g = gpAt(cost, price, gst);
    return { price, ...g, kind, belowTarget: g.gpPct < target - EPS };
  };
  const list = [...below.map((p) => mk(p, "charm")), mk(suggested, "suggested"), ...above.map((p) => mk(p, "charm"))];
  if (current != null && current > 0 && !list.some((o) => Math.abs(o.price - current) < 0.005)) {
    list.push(mk(round2(current), "current"));
    list.sort((a, b) => a.price - b.price);
  }
  return list;
}
