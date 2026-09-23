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

/** Parse a user-typed number; empty → null. */
export function parseNum(s: string): number | null {
  const t = s.trim().replace(/[$,%\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isNaN(n) ? null : n;
}

/** GP style percentage: 72.4% (or 72% with digits=0). */
export function gp(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${(Number(n) * 100).toFixed(digits)}%`;
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
