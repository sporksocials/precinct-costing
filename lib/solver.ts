import { gpFromPrice, suggestedPrice } from "./costing";

/**
 * Linked sell-price ↔ GP% editing.
 * Edit the price → GP follows. Edit the GP → price follows, rounded UP to `roundTo` (so GP lands at or above the ask).
 */

/** GP fraction for an inc-GST sell price; null when there is no usable price. */
export function gpForPrice(cost: number, priceInc: number | null | undefined, gst: number): number | null {
  if (priceInc == null || !(Number(priceInc) > 0)) return null;
  return gpFromPrice(cost, Number(priceInc), gst).gpPct;
}

/** Inc-GST price that achieves `gp`, rounded up to `roundTo`. Null when gp is not achievable (≥ 100%). */
export function priceForGp(cost: number, gp: number, gst: number, roundTo: number): number | null {
  if (!Number.isFinite(gp) || gp >= 1) return null;
  const p = suggestedPrice(cost, gp, gst, roundTo);
  return Math.round(p * 100) / 100;
}

/** Parse a typed GP: "72", "72%", "0.72", "72.5" → 0.72 / 0.725. */
export function parseGpInput(s: string): number | null {
  const t = s.trim().replace(/[%\s]/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

/** Parse a typed price: "$18.50", "18,5", "18" → 18.5 / 18. */
export function parsePriceInput(s: string): number | null {
  const t = s.trim().replace(/[$\s]/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
