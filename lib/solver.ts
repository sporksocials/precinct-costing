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

/**
 * Typed percent to fraction. RULE: a bare number >= 1 is percent points ("72" -> 0.72, "1" -> 0.01,
 * "5" -> 0.05); a number strictly between 0 and 1 is already a fraction ("0.72" -> 0.72); 0 -> 0.
 * So a typed "1" is 1%, never 100%. Negative or non-finite -> null.
 */
export function percentToFraction(n: number): number | null {
  if (!Number.isFinite(n) || n < 0) return null;
  return n >= 1 ? n / 100 : n;
}

/** Parse a typed GP: "72", "72%", "0.72", "72.5" -> 0.72 / 0.725. See percentToFraction for the rule. */
export function parseGpInput(s: string): number | null {
  const t = s.trim().replace(/[%\s]/g, "").replace(",", ".");
  if (!t) return null;
  return percentToFraction(Number(t));
}

/** Same rule for yield / percent fields ("90" -> 0.9, "0.9" -> 0.9). Adopt this instead of `n > 1 ? n / 100 : n`. */
export const parsePercentInput = parseGpInput;

/** Parse a typed price: "$18.50", "18,5", "18" → 18.5 / 18. */
export function parsePriceInput(s: string): number | null {
  const t = s.trim().replace(/[$\s]/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
