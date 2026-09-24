import type { SellPriceLog } from "./types";

export interface PriceChangeRow {
  id: number;
  serveId: string | null;
  /** what changed: the sell price or the happy hour price */
  label: "Price" | "Happy Hour";
  from: number | null;
  to: number | null;
  /** fractional change, e.g. 0.05 for +5%; null when either side is missing or old is zero */
  changePct: number | null;
  /** GP after the change, from the logged value when present */
  gpPct: number | null;
  at: string;
  by: string | null;
}

export function changePct(from: number | null, to: number | null): number | null {
  if (from == null || to == null || !(from > 0)) return null;
  return to / from - 1;
}

const numOrNull = (v: number | string | null): number | null => (v == null ? null : Number(v));

/** Turn log entries into display rows, newest first. An entry that moved both prices yields two rows. */
export function priceChangeRows(logs: SellPriceLog[]): PriceChangeRow[] {
  const rows: PriceChangeRow[] = [];
  for (const l of logs) {
    const base = { id: l.id, serveId: l.serve_id, at: l.changed_at, by: l.changed_by };
    const op = numOrNull(l.old_price);
    const np = numOrNull(l.new_price);
    if (op !== np) rows.push({ ...base, label: "Price", from: op, to: np, changePct: changePct(op, np), gpPct: numOrNull(l.gp_pct) });
    const oh = numOrNull(l.old_hh_price);
    const nh = numOrNull(l.new_hh_price);
    if (oh !== nh) rows.push({ ...base, label: "Happy Hour", from: oh, to: nh, changePct: changePct(oh, nh), gpPct: null });
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
}

/** "Fri 25 Sep" in Brisbane time. */
export function brisbaneDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", weekday: "short", day: "numeric", month: "numeric" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${get("weekday").slice(0, 3)} ${get("day")} ${months[Number(get("month")) - 1] ?? ""}`;
}

/** "troy@example.com" becomes "Troy"; null becomes "Unknown". */
export function whoLabel(email: string | null): string {
  if (!email) return "Unknown";
  const name = email.split("@")[0];
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : email;
}

export function changePctLabel(p: number | null): string {
  if (p == null) return "";
  const v = Math.round(p * 1000) / 10;
  return `${v > 0 ? "+" : ""}${v}%`;
}
