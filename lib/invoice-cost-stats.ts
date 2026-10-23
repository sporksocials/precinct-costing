/**
 * Ingredient cost from invoices: the LAST cost (the latest invoice's price and landed cost per base unit) and the quantity-weighted
 * AVERAGE landed cost over a window (default 90 days): total landed dollars divided by total base quantity, so a big delivery
 * counts for more than a small one. Product lines only; reverted or ignored lines never count; a line dated after today is bad
 * data and is left out. Money is rounded to 4 dp. An empty window gives null, never zero. Pure, no store, no clock.
 */
import type { ComputeIngredientCosts } from "./invoice-interfaces";
import type { IngredientInvoiceCost, InvoiceLineRow, InvoiceSettings } from "./invoice-types";
import { round4 } from "./invoice-names";

/** The columns the stats read. `qty` is optional in the type but needed for the unit price per base unit; full rows carry it. */
export type CostStatLine = Pick<
  InvoiceLineRow,
  "ingredient_id" | "document_id" | "invoice_date" | "line_class" | "unit_price_ex" | "landed_total_ex" | "landed_base_ex" | "base_qty" | "base_unit" | "packs_per_unit" | "state"
> &
  Partial<Pick<InvoiceLineRow, "qty">>;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dayMs = 86400000;
const toMs = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const validDate = (s: string | null): s is string => !!s && ISO.test(s) && !Number.isNaN(toMs(s));

const positive = (n: number | null | undefined): n is number => n != null && Number.isFinite(n) && n > 0;

/**
 * The base quantity a line really carries. Normally base_qty. When a credit with a known quantity was netted off, the landed cost
 * per base unit was worked out on the smaller quantity, so the quantity is recovered from the two stored landed numbers.
 */
function effectiveBaseQty(r: CostStatLine): number | null {
  if (!positive(r.base_qty)) return null;
  if (positive(r.landed_total_ex) && positive(r.landed_base_ex)) {
    const implied = r.landed_total_ex / r.landed_base_ex;
    if (Math.abs(implied - r.base_qty) > 0.005 * r.base_qty) return implied;
  }
  return r.base_qty;
}

/** Price per base unit on the invoice (ex GST, before fees): unit price x invoice quantity / base quantity. */
function unitPriceBase(r: CostStatLine): number | null {
  if (!positive(r.unit_price_ex) || !positive(r.qty) || !positive(r.base_qty)) return null;
  return round4((r.unit_price_ex * r.qty) / r.base_qty);
}

export const computeIngredientCosts: ComputeIngredientCosts = (lines: CostStatLine[], settings: Pick<InvoiceSettings, "averageDays">, today: string): IngredientInvoiceCost[] => {
  const days = settings.averageDays;
  const todayMs = validDate(today) ? toMs(today) : null;
  const windowStart = todayMs == null ? null : todayMs - days * dayMs;

  const byIngredient = new Map<string, CostStatLine[]>();
  for (const r of lines) {
    if (r.line_class !== "product" || !r.ingredient_id) continue;
    if (r.state === "reverted" || r.state === "ignored") continue;
    if (!validDate(r.invoice_date)) continue;
    if (todayMs != null && toMs(r.invoice_date) > todayMs) continue;
    const list = byIngredient.get(r.ingredient_id) ?? [];
    list.push(r);
    byIngredient.set(r.ingredient_id, list);
  }

  const out: IngredientInvoiceCost[] = [];
  for (const id of Array.from(byIngredient.keys()).sort()) {
    const rows = byIngredient.get(id) as CostStatLine[];

    // average: landed dollars over base quantity, lines inside the window that carry both
    let dollars = 0;
    let qty = 0;
    const docs = new Set<string>();
    for (const r of rows) {
      if (windowStart != null && toMs(r.invoice_date as string) < windowStart) continue;
      const q = effectiveBaseQty(r);
      if (q == null || !positive(r.landed_total_ex) || !positive(r.landed_base_ex)) continue;
      dollars += r.landed_total_ex;
      qty += q;
      docs.add(r.document_id);
    }

    // last: the latest invoice line that has both its price and its landed cost per base unit
    const candidates = rows
      .map((r) => ({ r, price: unitPriceBase(r) }))
      .filter((c) => c.price != null && positive(c.r.landed_base_ex))
      .sort((a, b) => {
        const d = (a.r.invoice_date as string).localeCompare(b.r.invoice_date as string);
        if (d !== 0) return d;
        const doc = a.r.document_id.localeCompare(b.r.document_id);
        if (doc !== 0) return doc;
        return (a.price as number) - (b.price as number) || (a.r.landed_base_ex as number) - (b.r.landed_base_ex as number);
      });
    const lastRow = candidates[candidates.length - 1];
    const latestAny = [...rows].sort((a, b) => (a.invoice_date as string).localeCompare(b.invoice_date as string)).pop() as CostStatLine;

    out.push({
      ingredient_id: id,
      base_unit: (lastRow?.r.base_unit ?? latestAny.base_unit) ?? null,
      last: lastRow
        ? { invoice_date: lastRow.r.invoice_date as string, document_id: lastRow.r.document_id, unit_price_base: lastRow.price as number, landed_base: round4(lastRow.r.landed_base_ex as number) }
        : null,
      average_landed_base: qty > 0 ? round4(dollars / qty) : null,
      deliveries: docs.size,
      window_days: days,
    });
  }
  return out;
};
