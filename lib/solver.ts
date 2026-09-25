import { gpFromPrice, suggestedPrice } from "./costing";
import { parseDecimal } from "./format";

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

/** Parse a typed GP: "72", "72%", "0.72", "72.5", "72,5" -> 0.72 / 0.725. See percentToFraction for the rule. */
export function parseGpInput(s: string): number | null {
  const n = parseDecimal(s);
  return n == null ? null : percentToFraction(n);
}

/** Same rule for other percent fields ("90" -> 0.9, "0.9" -> 0.9). Yield fields use parseYieldInput instead. */
export const parsePercentInput = parseGpInput;

/**
 * A typed yield (usable share after trim, cook loss...) as a fraction. Same as parsePercentInput except a bare "1" (or
 * "1%") means 100%: a yield of 1% is never intended and would cost 100x. "85" -> 0.85, "0.85" -> 0.85, "100" -> 1.
 * Null for empty, zero, negative, unreadable, or anything above 300% (a typo).
 */
export function parseYieldInput(s: string): number | null {
  const n = parseDecimal(s);
  if (n == null || n === 0) return null;
  const f = n === 1 ? 1 : n > 1 ? n / 100 : n;
  return f > 0 && f <= 3 ? f : null;
}

/** Parse a typed price: "$18.50", "18,5", "1,234.50" -> 18.5 / 18.5 / 1234.5. Null for empty, negative or unreadable text. $0 parses (callers that must not accept it check > 0). */
export function parsePriceInput(s: string): number | null {
  return parseDecimal(s);
}
