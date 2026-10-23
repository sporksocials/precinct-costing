/**
 * Supplier line discounts, found across invoices (Troy, 24 Oct 2026). Daniel Street Fish Market takes a standing agreed discount off
 * the Humpty Doo barramundi: it prints as a negative line that shares the product's code. The engine records it on the product line
 * (`line_discount_ex`, `discount_pct`, `discount_per_base`); this file groups those lines by supplier and item, says whether the
 * discount is a standing one, and words it for the owners as BOTH a percentage and dollars per kilo (or litre, or each).
 *
 * Pure: no React, no database, no clock. Nothing here changes a price or a recipe cost. A recipe only costs on the net price when a
 * person adds the app's existing "Percent Off" deal (see `dealPrefillPct`, which only fills the number in for them).
 * No em or en dashes in any text a person reads.
 */
import { money } from "./format";
import { descKey, plain, round4, tidyLabel } from "./invoice-names";
import { attachDiscounts } from "./invoice-landed";

/** One stored product line that carries a supplier discount, joined to its invoice, supplier and ingredient. */
export interface DiscountRow {
  line_id: string;
  document_id: string;
  /** the invoice_suppliers id, null when the invoice has no matched supplier */
  supplier_id: string | null;
  supplier_name: string;
  invoice_number: string | null;
  /** yyyy-mm-dd */
  invoice_date: string | null;
  ingredient_id: string | null;
  ingredient_name: string | null;
  description: string;
  /** the fraction of the gross line taken off: 0.1662 is 16.62% */
  discount_pct: number | null;
  /** dollars ex GST taken off per base unit (kg, L, each) */
  discount_per_base: number | null;
  base_unit: string | null;
  /** printed unit price ex GST (the supplier's list price), the invoice quantity and the base quantity, to work out the list cost per base unit */
  unit_price_ex: number | null;
  qty: number | null;
  base_qty: number | null;
}

export type DiscountStatus = "standing" | "seen once" | "varies";
export type Steadier = "percent" | "dollars" | "tie";

export interface DiscountInvoice {
  documentId: string;
  number: string | null;
  date: string | null;
}

export interface Range3 {
  min: number;
  mean: number;
  max: number;
}

export interface DiscountGroup {
  /** stable key: supplier and item */
  key: string;
  supplierId: string | null;
  supplier: string;
  ingredientId: string | null;
  /** what to call it: the ingredient's name, else the invoice description tidied */
  item: string;
  baseUnit: string | null;
  /** the distinct invoices, newest first */
  invoices: DiscountInvoice[];
  invoiceCount: number;
  /** fractions: 0.1662 is 16.62% */
  pct: Range3;
  /** dollars per base unit, ex GST; null when no line knew its base quantity */
  perBase: Range3 | null;
  /** max minus min of the percentage, in percentage points */
  pctSpread: number;
  /** (max minus min) of the dollars per unit, divided by their mean; null when there are none */
  perBaseSpreadRel: number | null;
  steadier: Steadier;
  status: DiscountStatus;
  /** the latest invoice's list cost per base unit, ex GST, when its price and quantities were read */
  listPerBase: number | null;
  /** list cost minus the latest invoice's discount per unit: what a unit really costs before delivery */
  netPerBase: number | null;
  /** the newest invoice */
  latest: DiscountInvoice;
}

/** Standing = two or more invoices and a steady discount: the percentage within half a point, or the dollars per unit within 2% of their mean. */
export const STANDING_PCT_POINTS = 0.5;
export const STANDING_REL = 0.02;
/** Below this relative difference between the two spreads neither measure is steadier. */
const TIE = 0.005;

const finite = (n: number | null | undefined): n is number => n != null && Number.isFinite(Number(n));
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const range = (xs: number[]): Range3 => ({ min: Math.min(...xs), mean: mean(xs), max: Math.max(...xs) });
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** The list cost per base unit on one line: printed unit price x invoice quantity / base quantity. Null when any is missing. */
export function listPerBaseOf(r: Pick<DiscountRow, "unit_price_ex" | "qty" | "base_qty">): number | null {
  if (!finite(r.unit_price_ex) || !finite(r.qty) || !finite(r.base_qty) || !(r.unit_price_ex > 0) || !(r.qty > 0) || !(r.base_qty > 0)) return null;
  return round4((r.unit_price_ex * r.qty) / r.base_qty);
}

const newestFirst = (a: DiscountRow, b: DiscountRow) =>
  (b.invoice_date ?? "").localeCompare(a.invoice_date ?? "") || b.document_id.localeCompare(a.document_id) || b.line_id.localeCompare(a.line_id);

/** Which measure moves less from invoice to invoice, compared like for like (spread divided by its own mean). */
function steadierOf(pctRel: number, perBaseRel: number | null, invoices: number): Steadier {
  if (invoices < 2) return "tie";
  if (perBaseRel == null) return "percent";
  if (Math.abs(pctRel - perBaseRel) <= TIE) return "tie";
  return pctRel < perBaseRel ? "percent" : "dollars";
}

/**
 * Group discounted product lines by supplier and item (the ingredient when the line is matched, else the description) and describe
 * each group. Rows with no usable percentage are ignored. Sorted: standing first, then varies, then seen once; inside a status the
 * bigger percentage first, then the item name.
 */
export function findDiscounts(rows: readonly DiscountRow[]): DiscountGroup[] {
  const groups = new Map<string, DiscountRow[]>();
  for (const r of rows) {
    if (!finite(r.discount_pct) || !(Number(r.discount_pct) > 0)) continue;
    const who = r.supplier_id ?? `name:${descKey(r.supplier_name)}`;
    const what = r.ingredient_id ? `ing:${r.ingredient_id}` : `desc:${descKey(r.description)}`;
    const key = `${who}|${what}`;
    groups.set(key, [...(groups.get(key) ?? []), { ...r, discount_pct: Number(r.discount_pct) }]);
  }

  const out: DiscountGroup[] = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort(newestFirst);
    const latestRow = sorted[0];
    const seen = new Map<string, DiscountInvoice>();
    for (const r of sorted) if (!seen.has(r.document_id)) seen.set(r.document_id, { documentId: r.document_id, number: r.invoice_number, date: r.invoice_date });
    const invoices = Array.from(seen.values());

    const pcts = range(sorted.map((r) => r.discount_pct as number));
    const perBases = sorted.map((r) => r.discount_per_base).filter(finite).map(Number).filter((n) => n > 0);
    const perBase = perBases.length ? range(perBases) : null;
    const pctSpread = round6((pcts.max - pcts.min) * 100);
    const perBaseSpreadRel = perBase && perBase.mean > 0 ? round6((perBase.max - perBase.min) / perBase.mean) : null;
    const pctRel = pcts.mean > 0 ? (pcts.max - pcts.min) / pcts.mean : 0;

    const status: DiscountStatus =
      invoices.length < 2 ? "seen once" : pctSpread < STANDING_PCT_POINTS || (perBaseSpreadRel != null && perBaseSpreadRel < STANDING_REL) ? "standing" : "varies";

    const listPerBase = listPerBaseOf(latestRow);
    const latestPerBase = finite(latestRow.discount_per_base) && latestRow.discount_per_base > 0 ? Number(latestRow.discount_per_base) : null;
    const netPerBase = listPerBase != null && latestPerBase != null && listPerBase > latestPerBase ? round4(listPerBase - latestPerBase) : null;

    const named = sorted.find((r) => plain(r.ingredient_name) !== "");
    out.push({
      key,
      supplierId: latestRow.supplier_id,
      supplier: plain(latestRow.supplier_name) || "A supplier",
      ingredientId: latestRow.ingredient_id,
      item: named ? plain(named.ingredient_name) : tidyLabel(latestRow.description),
      baseUnit: sorted.find((r) => plain(r.base_unit) !== "")?.base_unit ?? null,
      invoices,
      invoiceCount: invoices.length,
      pct: { min: round6(pcts.min), mean: round6(pcts.mean), max: round6(pcts.max) },
      perBase: perBase ? { min: round4(perBase.min), mean: round4(perBase.mean), max: round4(perBase.max) } : null,
      pctSpread,
      perBaseSpreadRel,
      steadier: steadierOf(pctRel, perBaseSpreadRel, invoices.length),
      status,
      listPerBase,
      netPerBase,
      latest: invoices[0],
    });
  }

  const rank: Record<DiscountStatus, number> = { standing: 0, varies: 1, "seen once": 2 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || b.pct.mean - a.pct.mean || a.item.localeCompare(b.item) || a.supplier.localeCompare(b.supplier));
}

/** The groups for one ingredient, best first (a second supplier can discount the same ingredient). */
export function discountsForIngredient(groups: readonly DiscountGroup[], ingredientId: string): DiscountGroup[] {
  return groups.filter((g) => g.ingredientId === ingredientId);
}

// ---------------------------------------------------------------- words

const UNIT_WORD: Record<string, string> = { each: "ea", ea: "ea" };

/** "$6.88/kg": a dollar amount per base unit; each is "ea". */
export function perUnitText(dollars: number, baseUnit: string | null): string {
  const u = baseUnit ? (UNIT_WORD[baseUnit.toLowerCase()] ?? baseUnit) : "";
  return u ? `${money(dollars)}/${u}` : money(dollars);
}

/** 0.1662 gives "16.6%". */
export function pctOff(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

/** The one line the invoice page shows: "Discount 16.6% ($6.88/kg off)", or "Discount 16.6%" when the unit is not known. */
export function lineDiscountText(l: { discount_pct?: number | null; discount_per_base?: number | null; base_unit?: string | null; line_discount_ex?: number | null }): string | null {
  const pct = finite(l.discount_pct) ? Number(l.discount_pct) : null;
  const per = finite(l.discount_per_base) && Number(l.discount_per_base) > 0 ? Number(l.discount_per_base) : null;
  if (pct == null && per == null) {
    const ex = finite(l.line_discount_ex) && Number(l.line_discount_ex) > 0 ? Number(l.line_discount_ex) : null;
    return ex == null ? null : `Discount ${money(ex)}`;
  }
  const dollars = per != null ? `${perUnitText(per, l.base_unit ?? null)} off` : null;
  if (pct == null) return `Discount ${dollars}`;
  return dollars ? `Discount ${pctOff(pct)} (${dollars})` : `Discount ${pctOff(pct)}`;
}

/** "Net $34.66/kg after the discount", or null when it cannot be worked out. */
export function netText(netPerBase: number | null | undefined, baseUnit: string | null): string | null {
  return finite(netPerBase) && Number(netPerBase) > 0 ? `Net ${perUnitText(Number(netPerBase), baseUnit)} after the discount` : null;
}

/** The net price per base unit on one invoice line: the list cost per base unit minus the discount per base unit. */
export function lineNetPerBase(l: { unit_price_ex?: number | null; qty?: number | null; base_qty?: number | null; discount_per_base?: number | null }): number | null {
  const list = listPerBaseOf({ unit_price_ex: l.unit_price_ex ?? null, qty: l.qty ?? null, base_qty: l.base_qty ?? null });
  const per = finite(l.discount_per_base) && Number(l.discount_per_base) > 0 ? Number(l.discount_per_base) : null;
  return list != null && per != null && list > per ? round4(list - per) : null;
}

/** "16.6% off, $6.88/kg off": both are always shown (the dollars part only when the unit cost was worked out). */
export function groupSizeText(g: Pick<DiscountGroup, "pct" | "perBase" | "baseUnit">): string {
  const pct = `${pctOff(g.pct.mean)} off`;
  return g.perBase ? `${pct}, ${perUnitText(g.perBase.mean, g.baseUnit)} off` : pct;
}

/** "Seen on 4 invoices". */
export function seenText(count: number): string {
  return `Seen on ${count} ${count === 1 ? "invoice" : "invoices"}`;
}

export const STATUS_WORD: Record<DiscountStatus, string> = { standing: "Standing", "seen once": "Seen Once", varies: "Varies" };

/** The quiet line saying which way of stating the discount holds still. Null when neither does better (or there is one invoice). */
export function steadierText(g: Pick<DiscountGroup, "steadier" | "baseUnit">): string | null {
  if (g.steadier === "percent") return "Steadier as a percentage";
  if (g.steadier === "dollars") return `Steadier as dollars per ${g.baseUnit ? (UNIT_WORD[g.baseUnit.toLowerCase()] ?? g.baseUnit) : "unit"}`;
  return null;
}

/** "Daniel Street": the first two words of the supplier name. */
export function shortSupplier(name: string): string {
  return plain(name).split(/\s+/).slice(0, 2).join(" ") || "The supplier";
}

/**
 * The ingredient page sentence. A standing discount: "Daniel Street takes 16.6% ($6.88/kg) off every delivery. Seen on 4 invoices."
 * One invoice: "Daniel Street took 16.6% ($6.88/kg) off on 14 Oct. Seen on 1 invoice." A varying one gives the range instead.
 */
export function ingredientDiscountText(g: Pick<DiscountGroup, "supplier" | "pct" | "perBase" | "baseUnit" | "invoiceCount" | "status" | "latest">): string {
  const who = shortSupplier(g.supplier);
  const size = g.perBase ? `${pctOff(g.pct.mean)} (${perUnitText(g.perBase.mean, g.baseUnit)})` : pctOff(g.pct.mean);
  if (g.status === "varies") return `${who} takes between ${pctOff(g.pct.min)} and ${pctOff(g.pct.max)} off. ${seenText(g.invoiceCount)}.`;
  if (g.status === "seen once") {
    const on = shortDay(g.latest?.date);
    return `${who} took ${size} off${on ? ` on ${on}` : ""}. ${seenText(g.invoiceCount)}.`;
  }
  return `${who} takes ${size} off every delivery. ${seenText(g.invoiceCount)}.`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "14 Oct" from a yyyy-mm-dd date; empty when there is none. */
function shortDay(date: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? "");
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month}` : "";
}

/** The percentage to put in the Percent Off deal form: one decimal, as the owners see it ("16.6"). */
export function dealPrefillPct(g: Pick<DiscountGroup, "pct">): string {
  return (g.pct.mean * 100).toFixed(1);
}

/**
 * The address that opens the ingredient page with the Percent Off deal form already filled in: `?deal=percent_off&pct=16.6`.
 * The form (components/deal-editor.tsx) shows the effect on the dishes before anything is saved; this link saves nothing.
 */
export function dealPrefillHref(ingredientId: string, g: Pick<DiscountGroup, "pct">): string {
  return `/ingredients/${encodeURIComponent(ingredientId)}?deal=percent_off&pct=${dealPrefillPct(g)}`;
}

// ---------------------------------------------------------------- the lines of one invoice

type LineLike = {
  id: string;
  line_class: string;
  item_code: string | null;
  description: string;
  qty: number | null;
  unit_price_ex: number | null;
  line_total_ex: number | null;
  line_discount_ex?: number | null;
};

/**
 * On one invoice: which negative line was taken off which product line. Keyed by the negative line's id, value the product line's id.
 * Uses the same rule as the engine, over the lines as stored (only a product line that carries a stored discount can be a target).
 */
export function productDiscountTargets(lines: readonly LineLike[]): Map<string, string> {
  const products = lines.filter((l) => l.line_class === "product" && finite(l.line_discount_ex) && Number(l.line_discount_ex) > 0);
  const negatives = lines.filter((l) => (l.line_class === "discount" || l.line_class === "credit") && finite(l.line_total_ex) && Number(l.line_total_ex) < 0);
  const attach = attachDiscounts(
    products.map((l, i) => ({ index: i, itemCode: l.item_code, description: l.description, unitPriceEx: finite(l.unit_price_ex) ? Number(l.unit_price_ex) : null })),
    negatives.map((l, i) => ({ index: i, itemCode: l.item_code, description: l.description, qty: finite(l.qty) ? Number(l.qty) : null, unitPriceEx: finite(l.unit_price_ex) ? Number(l.unit_price_ex) : null, totalEx: Number(l.line_total_ex) })),
  );
  const out = new Map<string, string>();
  negatives.forEach((n, i) => {
    const pi = attach.get(i);
    if (pi != null) out.set(n.id, products[pi].id);
  });
  return out;
}
