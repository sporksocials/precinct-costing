export function money(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  const s = Math.abs(v).toLocaleString("en-AU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return v < 0 ? `-$${s}` : `$${s}`;
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${(Number(n) * 100).toFixed(digits)}%`;
}

export function num(n: number | null | undefined, digits = 3): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  return v.toLocaleString("en-AU", { maximumFractionDigits: digits });
}

export function dateShort(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-AU", sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

export function daysAgo(s: string | null | undefined): number | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

/**
 * The ONE tolerant number parser for anything typed (money, quantities, percents). Returns null for empty, negative or
 * unreadable text, never NaN.
 *   "18.5", "$18.50", " 18 "  -> as written           "1,234.50", "1,234"      -> 1234.5 / 1234 (thousands commas)
 *   "18,5", "18,50"           -> 18.5 (one decimal comma)  "1.234,50"              -> 1234.5 (European)
 *   "0,125"                    -> 0.125                    "1,2,3", "-5", "abc"     -> null
 * A single comma followed by exactly three digits is a thousands separator ("1,234" is 1234), except after a leading 0.
 * $, %, and spaces are ignored.
 */
export function parseDecimal(input: string | null | undefined): number | null {
  if (input == null) return null;
  let t = String(input).trim().replace(/[\$%\s\u00a0]/g, "");
  if (t === "" || t.startsWith("-") || t.startsWith("+")) return null;
  const dots = (t.match(/\./g) ?? []).length;
  const commas = (t.match(/,/g) ?? []).length;
  if (commas > 0) {
    const lastComma = t.lastIndexOf(",");
    const lastDot = t.lastIndexOf(".");
    if (dots > 0) {
      if (lastComma > lastDot) {
        // 1.234,50 : dots are thousands, the comma is the decimal
        if (!/^\d{1,3}(\.\d{3})+,\d+$/.test(t)) return null;
        t = t.replace(/\./g, "").replace(",", ".");
      } else {
        // 1,234.50 : commas are thousands
        if (!/^\d{1,3}(,\d{3})+\.\d+$/.test(t)) return null;
        t = t.replace(/,/g, "");
      }
    } else if (commas > 1) {
      if (!/^\d{1,3}(,\d{3})+$/.test(t)) return null;
      t = t.replace(/,/g, "");
    } else {
      const [head, tail] = t.split(",");
      if (!/^\d+$/.test(head) || !/^\d+$/.test(tail)) return null;
      if (tail.length === 3 && head !== "0" && head.length <= 3) t = head + tail; // 1,234
      else if (tail.length <= 2) t = `${head}.${tail}`; // 18,5 / 18,50
      else if (head === "0") t = `${head}.${tail}`; // 0,125
      else return null;
    }
  }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Parse a user-typed number; empty -> null. Same rules as parseDecimal. */
export function parseNum(s: string): number | null {
  return parseDecimal(s);
}

/**
 * GP style percentage: 72.4% (or 72% with digits=0). Never shows a misleading round:
 *  - a value under 100% never reads 100% (99.95% shows 99.9%); a value above 0 never reads 0%.
 *  - pass the target and a value that is BELOW it never reads as the target: 71.96% against 72% shows 71.9% (one more
 *    decimal, truncated) instead of 72% or 72.0%, so the red flag and the number agree.
 * Anything else rounds normally.
 */
export function gp(n: number | null | undefined, digits = 1, target?: number | null): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n) * 100;
  const rounded = Number(v.toFixed(digits));
  const tgt = target != null && !Number.isNaN(Number(target)) ? Number(target) * 100 : null;
  const below = tgt != null && Number(n) < Number(target) - 1e-9;
  const misleading = (below && rounded >= Number(tgt!.toFixed(digits))) || (v < 100 && rounded >= 100) || (v > 0 && rounded <= 0 && digits < 2);
  if (!misleading) return `${v.toFixed(digits)}%`;
  // one more decimal, truncated toward zero (never rounded up past the truth)
  const d = Math.min(digits + 1, 3);
  const f = 10 ** d;
  let t = Math.floor(v * f + 1e-7) / f;
  if (below && tgt != null && t >= tgt) t = Math.floor((tgt * f) - 1) / f; // still equal after truncating: step below
  return `${t.toFixed(d)}%`;
}

/** Signed percent move: +18% / −6% */
export function movePct(n: number, digits = 0): string {
  const v = Math.abs(n * 100).toFixed(digits);
  return `${n >= 0 ? "+" : "−"}${v}%`;
}

/** Pack description: "2 kg", "12 each", "1 L" */
export function packLabel(size: number, unit: string): string {
  const s = num(size, 2);
  return unit === "each" ? `${s} ea` : `${s} ${unit}`;
}

export function unitShort(unit: string): string {
  return unit === "each" ? "ea" : unit;
}
