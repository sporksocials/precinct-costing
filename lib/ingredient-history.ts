import type { PriceLog } from "./types";

/** One row of cost_audit_log as the ingredient page reads it. */
export interface AuditRow {
  id: number;
  column_name: string | null;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_at: string;
}

const LABELS: Record<string, string> = {
  pack_size: "Pack size",
  pack_unit: "Pack unit",
  yield_pct: "Yield",
  rebate: "Rebate per pack",
  price_inc_gst: "Price includes GST",
  gst_free: "GST-free",
  active: "Active",
  name: "Name",
  supplier_id: "Supplier",
  supplier_code: "Supplier code",
};

/** Plain-words label for an audited column ("pack_size" becomes "Pack size"). Unknown columns are humanised. */
export function fieldLabel(column: string | null): string {
  if (!column) return "Change";
  if (LABELS[column]) return LABELS[column];
  const t = column.replace(/_/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const trimNum = (n: number, dp: number) => String(Math.round(n * 10 ** dp) / 10 ** dp);

/** Human-readable value for an audited column. Empty means "None". */
export function fieldValue(column: string | null, raw: string | null, supplierName?: (id: number) => string | undefined): string {
  if (raw == null || raw === "") return "None";
  const n = Number(raw);
  switch (column) {
    case "yield_pct":
      return Number.isFinite(n) ? `${trimNum(n * 100, 1)}%` : raw;
    case "rebate":
      return Number.isFinite(n) ? `$${n.toFixed(2)}` : raw;
    case "pack_size":
      return Number.isFinite(n) ? trimNum(n, 3) : raw;
    case "price_inc_gst":
    case "gst_free":
    case "active":
      return raw === "true" ? "Yes" : raw === "false" ? "No" : raw;
    case "supplier_id":
      return (Number.isFinite(n) ? supplierName?.(n) : undefined) ?? `Supplier ${raw}`;
    default:
      return raw;
  }
}

export type TimelineKind = "price" | "confirmed" | "field";

export interface TimelineEntry {
  key: string;
  kind: TimelineKind;
  at: string;
  by: string | null;
  /** "Pack size", "Price", "Price confirmed" */
  title: string;
  /** formatted old value; null when there was none (or for a confirmation) */
  from: string | null;
  to: string | null;
  note: string | null;
}

/** Source text the app writes on a same-price row when someone confirms a price. */
export const CONFIRMED_SOURCE = "Price confirmed";

const price = (v: number | null) => (v == null ? null : `$${Number(v).toFixed(2)}`);

/**
 * Merge price changes (cost_price_log) and other field changes (cost_audit_log) into one timeline, newest first.
 * A price row whose old and new price match is a confirmation ("still right"), not a change. Rows for which
 * `skip` returns true (alternate prices from the source sheets) are dropped.
 */
export function buildTimeline(prices: PriceLog[], audits: AuditRow[], supplierName?: (id: number) => string | undefined, skip: (l: PriceLog) => boolean = () => false): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const l of prices) {
    if (l.new_price == null || skip(l)) continue;
    const same = l.old_price != null && Number(l.old_price) === Number(l.new_price);
    out.push({
      key: `p${l.id}`,
      kind: same ? "confirmed" : "price",
      at: l.changed_at,
      by: l.entered_by,
      title: same ? "Price confirmed" : "Price",
      from: same ? null : price(l.old_price),
      to: price(l.new_price),
      note: same ? null : l.source,
    });
  }
  for (const a of audits) {
    out.push({
      key: `a${a.id}`,
      kind: "field",
      at: a.changed_at,
      by: a.changed_by,
      title: fieldLabel(a.column_name),
      from: a.old_value == null ? null : fieldValue(a.column_name, a.old_value, supplierName),
      to: fieldValue(a.column_name, a.new_value, supplierName),
      note: null,
    });
  }
  return out.sort((x, y) => (Date.parse(y.at) || 0) - (Date.parse(x.at) || 0) || y.key.localeCompare(x.key));
}
