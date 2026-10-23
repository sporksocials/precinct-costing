/**
 * Invoices: reads for the supplier line discounts (Discounts We Found, and the ingredient page line). Read only: nothing here
 * writes a thing, and no price or recipe cost is ever touched. Callers pass the Supabase client (the signed-in browser client in the
 * app, a fake in tests).
 *
 * Before the Invoices migration, or before the discount columns were added to invoice_lines, the read fails inside the database;
 * any failure comes back empty with `available: false`, never an error: the screens then show their calm empty state.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { findDiscounts, type DiscountGroup, type DiscountRow } from "./invoice-discounts";

const CHUNK = 80;
const LIMIT = 1000;
/** Documents in these states are copies, set aside or unreadable: their lines are not real purchases. */
const DOC_SKIP = new Set(["duplicate", "ignored", "failed"]);

export interface DiscountLoad {
  groups: DiscountGroup[];
  /** false when the invoice tables or the discount columns are not in the database yet (or the read failed) */
  available: boolean;
}

export interface DiscountLoadOptions {
  /** only invoices for this venue */
  venueId?: number | null;
  /** only lines for this ingredient */
  ingredientId?: string | null;
  /** the ingredient's name from the store, so a group reads as the app calls it */
  ingredientName?: (id: string) => string | null | undefined;
}

type LineRow = {
  id: string;
  document_id: string;
  venue_id: number;
  ingredient_id: string | null;
  description: string;
  qty: number | null;
  unit_price_ex: number | null;
  base_qty: number | null;
  base_unit: string | null;
  discount_pct: number | null;
  discount_per_base: number | null;
  state: string;
};
type DocRow = { id: string; invoice_number: string | null; invoice_date: string | null; supplier_id: string | null; supplier_name_read: string | null; status: string };

const num = (v: unknown): number | null => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

async function inList<T>(sb: SupabaseClient, table: string, columns: string, ids: readonly string[]): Promise<T[]> {
  const out: T[] = [];
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const { data, error } = await sb.from(table).select(columns).in("id", uniq.slice(i, i + CHUNK));
    if (error) throw new Error(error.message ?? "Could not load the invoices");
    out.push(...((data ?? []) as unknown as T[]));
  }
  return out;
}

/** Every discounted product line, grouped by supplier and item. Any failure gives no groups. */
export async function loadDiscountGroups(sb: SupabaseClient, opts: DiscountLoadOptions = {}): Promise<DiscountLoad> {
  try {
    let q = sb
      .from("invoice_lines")
      .select("id,document_id,venue_id,ingredient_id,description,qty,unit_price_ex,base_qty,base_unit,discount_pct,discount_per_base,state")
      .eq("line_class", "product")
      .gt("discount_pct", 0);
    if (opts.venueId != null) q = q.eq("venue_id", opts.venueId);
    if (opts.ingredientId) q = q.eq("ingredient_id", opts.ingredientId);
    const { data, error } = await q.order("invoice_date", { ascending: false }).limit(LIMIT);
    if (error) return { groups: [], available: false };
    const lines = ((data ?? []) as LineRow[]).filter((l) => l.state !== "ignored");
    if (!lines.length) return { groups: [], available: true };

    const docs = await inList<DocRow>(sb, "invoice_documents", "id,invoice_number,invoice_date,supplier_id,supplier_name_read,status", lines.map((l) => l.document_id));
    const live = new Map(docs.filter((d) => !DOC_SKIP.has(d.status)).map((d) => [d.id, d]));
    const supplierIds = [...new Set([...live.values()].map((d) => d.supplier_id).filter((x): x is string => !!x))];
    const suppliers = supplierIds.length ? await inList<{ id: string; name: string }>(sb, "invoice_suppliers", "id,name", supplierIds) : [];
    const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));

    const rows: DiscountRow[] = [];
    for (const l of lines) {
      const d = live.get(l.document_id);
      if (!d) continue;
      rows.push({
        line_id: l.id,
        document_id: l.document_id,
        supplier_id: d.supplier_id,
        supplier_name: (d.supplier_id ? supplierName.get(d.supplier_id) : null) ?? d.supplier_name_read ?? "",
        invoice_number: d.invoice_number,
        invoice_date: d.invoice_date,
        ingredient_id: l.ingredient_id,
        ingredient_name: l.ingredient_id ? (opts.ingredientName?.(l.ingredient_id) ?? null) : null,
        description: l.description,
        discount_pct: num(l.discount_pct),
        discount_per_base: num(l.discount_per_base),
        base_unit: l.base_unit,
        unit_price_ex: num(l.unit_price_ex),
        qty: num(l.qty),
        base_qty: num(l.base_qty),
      });
    }
    return { groups: findDiscounts(rows), available: true };
  } catch {
    return { groups: [], available: false };
  }
}
