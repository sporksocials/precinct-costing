/**
 * Invoices on the ingredient page: the pure rules. No React, no database.
 *
 *  1. "Cost From Invoices": last paid, landed and the quantity-weighted average, worded from lib/invoice-cost-stats.ts output.
 *     The ingredient's own price (what recipes cost on) is unchanged by any of this; these are for reference.
 *  2. Price History: a price log row written by the invoice system carries a source "Invoice 51329 · Daniel Street Fish Market ·
 *     14 Oct 2026". This file recognises it, finds its undo ledger row, and words the Undo question.
 */
import { money } from "./format";
import { INVOICE_SOURCE_PREFIX, type IngredientInvoiceCost, type InvoicePriceChangeRow } from "./invoice-types";
import { shortDate } from "./invoice-questions-view";

/* ---------------------------------------------------------------- Cost From Invoices */

export const COST_NOTE = "Recipes still cost on the price above. Landed cost and the average are for reference.";

export interface IngDocLite {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  supplier_name: string | null;
}

/** Invoice lines that count towards cost: product lines for this ingredient that were not reverted or ignored. */
export function countableLines<T extends { ingredient_id: string | null; line_class: string; state: string }>(lines: readonly T[], ingredientId: string): T[] {
  return lines.filter((l) => l.ingredient_id === ingredientId && l.line_class === "product" && l.state !== "reverted" && l.state !== "ignored");
}

const UNIT_WORD: Record<string, string> = { each: "ea", ea: "ea" };

/** "$68.90/kg". The cost per base unit; each is "ea". */
export function perUnit(price: number, baseUnit: string | null): string {
  const u = baseUnit ? UNIT_WORD[baseUnit.toLowerCase()] ?? baseUnit : "";
  return u ? `${money(price)}/${u}` : money(price);
}

export interface CostLine {
  key: "last" | "landed" | "average";
  text: string;
  /** the invoice this line comes from, when it names one */
  documentId?: string;
}

/** "Daniel Street 51329": the short supplier name (first two words) and the number. */
export function invoiceShortName(doc: Pick<IngDocLite, "invoice_number" | "supplier_name"> | undefined): string {
  if (!doc) return "";
  const supplier = (doc.supplier_name ?? "").trim().split(/\s+/).slice(0, 2).join(" ");
  return [supplier, doc.invoice_number?.trim()].filter(Boolean).join(" ");
}

/**
 * The lines of the block, in order: last paid, landed, average. Empty when there is nothing to say.
 * `landed` reads "includes delivery and fees" when it is above the invoice price, "after discounts" when below.
 */
export function costLines(cost: IngredientInvoiceCost | undefined, docs: ReadonlyMap<string, IngDocLite>, today?: string): CostLine[] {
  if (!cost) return [];
  const out: CostLine[] = [];
  const u = cost.base_unit;
  const last = cost.last;
  if (last) {
    const doc = docs.get(last.document_id);
    const on = shortDate(last.invoice_date, today);
    const from = invoiceShortName(doc);
    out.push({ key: "last", text: `Last paid ${perUnit(last.unit_price_base, u)}${on ? ` on ${on}` : ""}${from ? ` (${from})` : ""}`, documentId: last.document_id });
    const diff = Math.round((last.landed_base - last.unit_price_base) * 10000) / 10000;
    const why = diff > 0.005 ? "includes delivery and fees" : diff < -0.005 ? "after discounts" : "no delivery or fees on that invoice";
    out.push({ key: "landed", text: `Landed ${perUnit(last.landed_base, u)} (${why})`, documentId: last.document_id });
  }
  if (cost.average_landed_base != null && cost.deliveries > 0) {
    out.push({ key: "average", text: `${cost.window_days} day average ${perUnit(cost.average_landed_base, u)} from ${cost.deliveries} ${cost.deliveries === 1 ? "delivery" : "deliveries"}` });
  }
  return out;
}

/* ---------------------------------------------------------------- Price History */

export function isInvoiceSource(source: string | null | undefined): boolean {
  return !!source && source.trim().startsWith(INVOICE_SOURCE_PREFIX) && !isUndoSource(source);
}

/** Written when a person undoes an invoice change: "Undo: Invoice 51329 ...". */
export function isUndoSource(source: string | null | undefined): boolean {
  return !!source && /^undo\b/i.test(source.trim());
}

/** An undo row in plain words: "Undone: Invoice 51329 · Daniel Street Fish Market · 14 Oct 2026". */
export function undoSourceText(source: string): string {
  const rest = source.trim().replace(/^undo\b\s*[:\-]?\s*/i, "");
  return rest ? `Undone: ${rest}` : "Undone";
}

/** The log row id inside a timeline entry key ("p123" gives 123); null for any other kind of entry. */
export function logIdFromKey(key: string): number | null {
  const m = /^p(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}

export type LedgerLite = Pick<InvoicePriceChangeRow, "id" | "document_id" | "kind" | "status" | "old_price" | "new_price" | "old_last_price_update" | "cost_log_id">;

/** The undo ledger rows for an ingredient, keyed by the price log row each one wrote. */
export function ledgerByLogId(rows: readonly LedgerLite[]): Map<number, LedgerLite> {
  const m = new Map<number, LedgerLite>();
  for (const r of rows) if (r.cost_log_id != null) m.set(Number(r.cost_log_id), r);
  return m;
}

export interface UndoModel {
  title: string;
  body: string;
  confirm: string;
}

/** The Undo question: says exactly which price comes back. */
export function undoModel(change: Pick<LedgerLite, "kind" | "old_price" | "new_price" | "old_last_price_update">): UndoModel {
  if (change.kind === "price_confirmed") {
    return {
      title: "Undo This Price Check?",
      body: `The price stays ${change.new_price != null ? money(Number(change.new_price)) : "as it is"}. Only the date it was last checked goes back to ${change.old_last_price_update ? shortDate(change.old_last_price_update) : "never checked"}.`,
      confirm: "Undo Price Check",
    };
  }
  const from = change.new_price != null ? money(Number(change.new_price)) : "the invoice price";
  const to = change.old_price != null ? money(Number(change.old_price)) : "the earlier price";
  return { title: "Undo This Price?", body: `The price goes back from ${from} to ${to}.`, confirm: "Put The Price Back" };
}

export const FORCE_BODY = "This price was changed by someone else after the invoice set it. Putting it back replaces their change.";
