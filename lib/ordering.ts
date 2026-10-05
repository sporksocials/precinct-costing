/**
 * Ordering module: the pure logic (no React, no database). Weekly drinks counts per venue turn into one order per supplier.
 * Everything here is per venue: callers pass one venue's products and lines. See
 * files/research/stock-and-ordering-architecture-2026-10-05.md for the decisions.
 *
 * Rules (Troy, 5 Oct 2026):
 *   - Suggested = Build To (par) minus (Store + second place), never below 0. "On order" is ignored.
 *   - Overstock reads "Over by N", never a negative order.
 *   - The ORDER quantity rounds UP to the product's pack multiple (Star spirits are sold in 6s or 12s; most products 1).
 *   - A product with no count has no suggestion (it is "uncounted", not "zero").
 *   - A supplier minimum is only ever a warning.
 *   - Prices are held inc GST; ex GST is inc / 1.1 rounded to the cent.
 */
import { money } from "./format";
import type {
  CountEdit,
  CountLineWrite,
  CountMerge,
  CountProgress,
  MoneyPair,
  OrderLineDraft,
  OrderTextLine,
  OrderTotals,
  OrderingCategory,
  OrderingCountLine,
  OrderingMethod,
  OrderingProduct,
  OrderingSupplier,
  PricedLine,
  SuggestedLine,
  Suggestion,
  SupplierOrderGroup,
} from "./ordering-types";

/* ------------------------------------------------------------------ category and unit conventions */

/**
 * The unit each kind of category is counted AND ordered in, as the Drift workbook already works. Used to default a new
 * category's unit and to sanity check an import; every product still carries its own unit_name.
 *   wine, RTDs, bottled beer and cider    carton
 *   kegs                                  keg
 *   spirits                               bottle (ordered as bottles, in the pack multiples the supplier sells: 6 or 12)
 *   post-mix soft drink                   bag (15 L at Drift, 5 L at Greedy: per venue, set on the product name or notes)
 *   soft drink bottles or cans            carton
 */
export const UNIT = { carton: "carton", keg: "keg", bag: "bag", bottle: "bottle" } as const;
export type KnownUnit = (typeof UNIT)[keyof typeof UNIT];

const UNIT_CONVENTIONS: { match: RegExp; unit: KnownUnit }[] = [
  { match: /post[\s-]?mix/i, unit: UNIT.bag },
  { match: /\bkegs?\b/i, unit: UNIT.keg },
  { match: /spirit|liqueur|whisk|bourbon|vodka|gin\b|rum\b|tequila|brandy|vermouth|aperitif|amaro/i, unit: UNIT.bottle },
  // wine, RTD, bottled beer, cider, soft drink bottles and cans, and anything unrecognised: cartons
];

/** The conventional unit for a category name ("Post-Mix" bag, "Kegs" keg, "Spirits" bottle, everything else carton). */
export function defaultUnitForCategory(categoryName: string): KnownUnit {
  const hit = UNIT_CONVENTIONS.find((c) => c.match.test(categoryName));
  return hit ? hit.unit : UNIT.carton;
}

/** GST as a rate (the same 10% as the costing setting gst_rate; prices here are held inc GST). */
export const GST_RATE = 0.1;

/* ------------------------------------------------------------------ small helpers */

/** Quantities are whole units in practice, but guard float noise (0.1 + 0.2) from ever reaching a screen or an order. */
const clean = (n: number): number => Math.round(n * 1e6) / 1e6;
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Rounds a quantity UP to the next multiple (multiple below 1 counts as 1). 0 stays 0. */
export function roundUpToMultiple(qty: number, multiple: number): number {
  const m = Math.max(1, Math.floor(Number.isFinite(multiple) ? multiple : 1));
  if (!(qty > 0)) return 0;
  return clean(Math.ceil(qty / m - 1e-9) * m);
}

/** "36", "2.5": whole numbers as they are, anything else to at most two decimals. */
export function qtyText(n: number): string {
  const v = clean(n);
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

/** Em and en dashes become plain hyphens: nothing a supplier reads should carry them. */
export function plainText(s: string | null | undefined): string {
  return (s ?? "").replace(/[—–−]/g, "-").replace(/[​‌‍﻿]/g, "").replace(/\s+/g, " ").trim();
}

/** The short venue name used in subjects and greetings: "Drift Bar" reads "Drift", "Greedy Gringo's" reads "Greedy". */
export function orderingVenueName(venue: { name: string; slug?: string | null }): string {
  const bySlug: Record<string, string> = { drift: "Drift", chiobu: "Chiobu", greedy: "Greedy", gelato: "Gelato" };
  return (venue.slug && bySlug[venue.slug.toLowerCase()]) || plainText(venue.name);
}

/* ------------------------------------------------------------------ suggestions */

type ParProduct = Pick<OrderingProduct, "par" | "pack_multiple">;

/**
 * The suggestion for one product from its count.
 *   both places null (or no count line)  uncounted: no suggestion, counted null, order 0
 *   otherwise                            counted = store + second, a place left null counts as 0 (the person counted the
 *                                        product, so an untouched place means none there)
 *   need = par - counted (before rounding, may be negative); orderQty = need rounded UP to pack_multiple, never below 0;
 *   over = counted - par when overstocked, else 0; belowPar = counted < par.
 */
export function suggestOrder(product: ParProduct, storeQty: number | null | undefined, secondQty: number | null | undefined): Suggestion {
  const store = storeQty == null || !Number.isFinite(Number(storeQty)) ? null : Number(storeQty);
  const second = secondQty == null || !Number.isFinite(Number(secondQty)) ? null : Number(secondQty);
  if (store == null && second == null) return { uncounted: true, counted: null, need: 0, orderQty: 0, over: 0, belowPar: false };
  const counted = clean((store ?? 0) + (second ?? 0));
  const par = Math.max(0, Number(product.par) || 0);
  const need = clean(par - counted);
  return {
    uncounted: false,
    counted,
    need,
    orderQty: need > 0 ? roundUpToMultiple(need, product.pack_multiple) : 0,
    over: need < 0 ? clean(-need) : 0,
    belowPar: counted < par,
  };
}

type LineQty = Pick<OrderingCountLine, "product_id" | "store_qty" | "second_qty">;

/** Products in count order: category sort, then product sort, then name. Without categories the input order is kept. */
export function sortProducts<P extends Pick<OrderingProduct, "category_id" | "sort" | "name">>(products: readonly P[], categories?: readonly Pick<OrderingCategory, "id" | "sort" | "name">[]): P[] {
  if (!categories || !categories.length) return [...products];
  const rank = new Map(categories.map((c, i) => [c.id, { sort: c.sort, i }]));
  const catRank = (id: string) => rank.get(id) ?? { sort: Number.MAX_SAFE_INTEGER, i: Number.MAX_SAFE_INTEGER };
  return [...products].sort((a, b) => {
    const ra = catRank(a.category_id);
    const rb = catRank(b.category_id);
    return ra.sort - rb.sort || ra.i - rb.i || a.sort - b.sort || a.name.localeCompare(b.name);
  });
}

/** The count screen's sections: categories in shelf order, each with its active products in order. Empty categories are left out. */
export function groupProductsByCategory(products: readonly OrderingProduct[], categories: readonly OrderingCategory[]): { category: OrderingCategory; products: OrderingProduct[] }[] {
  const active = products.filter((p) => p.active);
  return [...categories]
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
    .map((category) => ({ category, products: active.filter((p) => p.category_id === category.id).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)) }))
    .filter((g) => g.products.length > 0);
}

export interface BuildOrdersOptions {
  /** names and sort order of the groups; a product whose supplier is not in the list is grouped as "Unknown supplier" */
  suppliers?: readonly OrderingSupplier[];
  /** sorts the products into shelf order (category sort, then product sort). Without it the input order is kept. */
  categories?: readonly Pick<OrderingCategory, "id" | "sort" | "name">[];
  /** include inactive products (default false) */
  includeInactive?: boolean;
}

export const UNASSIGNED = "Unassigned";

/**
 * Groups one venue's count into one order per supplier. Products with no supplier go in an "Unassigned" group (last).
 * Within a group the product order is kept. `lines` holds what to order (quantity above 0); counted products that need
 * nothing are in `zeroLines` and products with no count in `uncountedLines`, so a screen can show them without them
 * ever reaching an order. Suppliers come out by their sort then name; a supplier with no products is left out.
 */
export function buildSupplierOrders(venueProducts: readonly OrderingProduct[], lines: readonly LineQty[], opts: BuildOrdersOptions = {}): SupplierOrderGroup[] {
  const byProduct = new Map<string, LineQty>();
  for (const l of lines) byProduct.set(l.product_id, l);
  const products = sortProducts(opts.includeInactive ? venueProducts : venueProducts.filter((p) => p.active), opts.categories);
  const suppliers = [...(opts.suppliers ?? [])].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));

  const groups = new Map<string, SupplierOrderGroup>();
  const groupFor = (supplierId: string | null): SupplierOrderGroup => {
    const key = supplierId ?? "";
    let g = groups.get(key);
    if (!g) {
      const supplier = supplierId ? supplierById.get(supplierId) ?? null : null;
      g = { supplierId, supplierName: supplierId ? supplier?.name ?? "Unknown supplier" : UNASSIGNED, supplier, lines: [], zeroLines: [], uncountedLines: [] };
      groups.set(key, g);
    }
    return g;
  };

  for (const product of products) {
    const l = byProduct.get(product.id);
    const storeQty = l?.store_qty ?? null;
    const secondQty = l?.second_qty ?? null;
    const suggestion = suggestOrder(product, storeQty, secondQty);
    const line: SuggestedLine = { product, storeQty, secondQty, suggestion };
    const g = groupFor(product.supplier_id);
    if (suggestion.uncounted) g.uncountedLines.push(line);
    else if (suggestion.orderQty > 0) g.lines.push(line);
    else g.zeroLines.push(line);
  }

  const rank = (g: SupplierOrderGroup) => (g.supplierId == null ? Number.MAX_SAFE_INTEGER : g.supplier ? suppliers.indexOf(g.supplier) : Number.MAX_SAFE_INTEGER - 1);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.supplierName.localeCompare(b.supplierName));
}

/** The order lines to save for a group (or any chosen lines), with quantities as shown or edited. `qtyByProduct` overrides a suggestion. */
export function draftLinesFromSuggestions(lines: readonly SuggestedLine[], qtyByProduct: Readonly<Record<string, number>> = {}): OrderLineDraft[] {
  const out: OrderLineDraft[] = [];
  for (const l of lines) {
    const qty = qtyByProduct[l.product.id] ?? l.suggestion.orderQty;
    if (!(qty > 0)) continue;
    out.push({
      product_id: l.product.id,
      product_name: l.product.name,
      supplier_item_code: l.product.supplier_item_code,
      unit_name: l.product.unit_name,
      suggested_qty: l.suggestion.uncounted ? null : l.suggestion.orderQty,
      ordered_qty: qty,
      pack_multiple: l.product.pack_multiple,
      price_inc_gst: l.product.price_inc_gst,
      sort: out.length,
    });
  }
  return out;
}

/** One typed line for a top-up order (no count, no suggestion). */
export function draftLineForProduct(product: OrderingProduct, qty: number, sort = 0): OrderLineDraft {
  return {
    product_id: product.id,
    product_name: product.name,
    supplier_item_code: product.supplier_item_code,
    unit_name: product.unit_name,
    suggested_qty: null,
    ordered_qty: qty,
    pack_multiple: product.pack_multiple,
    price_inc_gst: product.price_inc_gst,
    sort,
  };
}

/* ------------------------------------------------------------------ prices */

/** Ex GST from inc GST: divide by 1.1 (or 1 + rate), round to the cent. 29.50 inc is 26.82 ex. */
export function exGst(inc: number, rate: number = GST_RATE): number {
  return round2(inc / (1 + rate));
}

/** A line's value for a quantity at one inc GST unit price: inc is qty x price to the cent, ex is that divided by 1.1. */
export function lineTotals(qty: number, priceInc: number | null | undefined, rate: number = GST_RATE): MoneyPair | null {
  if (priceInc == null || !Number.isFinite(Number(priceInc))) return null;
  const inc = round2(qty * Number(priceInc));
  return { inc, ex: round2(inc / (1 + rate)) };
}

/**
 * An order's totals. Lines with no quantity are ignored; lines with a quantity but no price are counted in `unpricedLines`
 * and left out of the money. Total ex is the total inc divided by 1.1 (not the sum of rounded line values), so inc and ex
 * always agree with each other.
 */
export function orderTotals(lines: readonly PricedLine[], rate: number = GST_RATE): OrderTotals {
  let rawInc = 0;
  let priced = 0;
  let unpriced = 0;
  let units = 0;
  for (const l of lines) {
    if (!(l.ordered_qty > 0)) continue;
    units += l.ordered_qty;
    if (l.price_inc_gst == null) unpriced += 1;
    else {
      priced += 1;
      rawInc += l.ordered_qty * Number(l.price_inc_gst);
    }
  }
  const inc = round2(rawInc);
  return { inc, ex: round2(inc / (1 + rate)), pricedLines: priced, unpricedLines: unpriced, units: clean(units) };
}

/* ------------------------------------------------------------------ minimum order */

function unitWord(unit: string | null | undefined, n: number): string {
  const u = plainText(unit).toLowerCase();
  if (!u) return n === 1 ? "unit" : "units";
  const base = u === "ctn" || u === "ctns" || u === "cartons" ? "carton" : u.endsWith("s") && u.length > 3 ? u.slice(0, -1) : u;
  if (n === 1) return base;
  return /(s|x|ch|sh)$/.test(base) ? `${base}es` : `${base}s`;
}

export interface MinimumCheck {
  totals: Pick<OrderTotals, "inc" | "ex" | "units" | "unpricedLines">;
  /** the unit to name when the minimum is in units (the products' common unit, e.g. "carton") */
  unitName?: string | null;
  /** compare the dollar minimum with the total ex GST (default, how wholesalers quote) or inc GST */
  basis?: "ex" | "inc";
}

/**
 * Plain-English warning when an order is under the supplier's minimum, else null (met, or no minimum set). Only ever a
 * warning. Examples:
 *   "Order is $120.00 short of the $650.00 minimum"
 *   "Order is 4 cartons short of the 10 carton minimum"
 *   "Order is $120.00 short of the $650.00 minimum and 4 cartons short of the 10 carton minimum"
 * The dollar minimum is not checked while any ordered line has no price (the total would be wrong); the unit minimum is.
 * An empty order (no units) has nothing to warn about.
 */
export function minimumWarning(check: MinimumCheck, supplier: Pick<OrderingSupplier, "min_order_value" | "min_order_units"> | null | undefined): string | null {
  if (!supplier) return null;
  const { totals } = check;
  if (!(totals.units > 0)) return null;
  const clauses: string[] = [];
  const minValue = supplier.min_order_value;
  if (minValue != null && minValue > 0 && totals.unpricedLines === 0) {
    const have = check.basis === "inc" ? totals.inc : totals.ex;
    const short = round2(minValue - have);
    if (short > 0) clauses.push(`${money(short)} short of the ${money(minValue)} minimum`);
  }
  const minUnits = supplier.min_order_units;
  if (minUnits != null && minUnits > 0) {
    const short = clean(minUnits - totals.units);
    if (short > 0) clauses.push(`${qtyText(short)} ${unitWord(check.unitName, short)} short of the ${qtyText(minUnits)} ${unitWord(check.unitName, 1)} minimum`);
  }
  return clauses.length ? `Order is ${clauses.join(" and ")}` : null;
}

/* ------------------------------------------------------------------ the order text */

/** "Mark Holden" reads "Mark", "Dan G" reads "Dan"; null for no name. */
export function firstName(full: string | null | undefined): string | null {
  const first = plainText(full).split(" ")[0]?.replace(/[^\p{L}\p{M}'’-]/gu, "") ?? "";
  return first || null;
}

/** "1 ctn", "3 ctns", "1 keg", "2 bags", "6 bottles". Cartons are abbreviated; keg, bag and bottle are written out. */
export function qtyWithUnit(qty: number, unit: string | null | undefined): string {
  const q = qtyText(qty);
  const u = plainText(unit).toLowerCase();
  if (!u) return q;
  if (u === "carton" || u === "cartons" || u === "ctn" || u === "ctns") return `${q} ${qty === 1 ? "ctn" : "ctns"}`;
  return `${q} ${unitWord(u, qty)}`;
}

export interface OrderTextInput {
  /** short venue name, e.g. "Drift" (see orderingVenueName) */
  venueName: string;
  supplier: Pick<OrderingSupplier, "rep_name" | "account_no">;
  lines: readonly OrderTextLine[];
  showPrices: boolean;
  /** the signed-in person's first name; the sign-off is left out without one */
  senderName?: string | null;
  /** reserved: the text carries no date today, but callers may pass it so a date line can be added without changing them */
  today?: Date | string;
}
export interface OrderText {
  subject: string;
  /** plain text with \n line breaks (convert with toCrlf, or let mailtoUrl do it) */
  body: string;
}

/**
 * The exact text of an order. Subject "<Venue> Order". Body:
 *   Hi <rep first name>,                      (just "Hi," with no rep)
 *   Order for <Venue>, account <no>:          (", account <no>" only when set)
 *   <name> - <qty> <unit>                     one line per product with a quantity above 0, in the order given
 *   Thanks, / <sender>
 * With showPrices each line adds the item code (when there is one) and `@ $X ex GST / $Y inc GST = $A ex GST / $B inc GST`,
 * and the body ends with the order total ex and inc GST. No em or en dashes anywhere (they become hyphens).
 */
export function buildOrderText(input: OrderTextInput): OrderText {
  const venue = plainText(input.venueName);
  const rep = firstName(input.supplier.rep_name);
  const account = plainText(input.supplier.account_no);
  const lines = input.lines.filter((l) => l.ordered_qty > 0);
  const out: string[] = [];
  out.push(rep ? `Hi ${rep},` : "Hi,", "");
  out.push(`Order for ${venue}${account ? `, account ${account}` : ""}:`, "");
  for (const l of lines) {
    let text = `${plainText(l.product_name)} - ${qtyWithUnit(l.ordered_qty, l.unit_name)}`;
    if (input.showPrices) {
      const code = plainText(l.supplier_item_code);
      if (code) text += ` (item ${code})`;
      const v = lineTotals(l.ordered_qty, l.price_inc_gst);
      if (v && l.price_inc_gst != null) text += ` @ ${money(exGst(l.price_inc_gst))} ex GST / ${money(l.price_inc_gst)} inc GST = ${money(v.ex)} ex GST / ${money(v.inc)} inc GST`;
    }
    out.push(text);
  }
  if (input.showPrices) {
    const t = orderTotals(lines);
    out.push("", `Total ex GST: ${money(t.ex)}`, `Total inc GST: ${money(t.inc)}`);
    if (t.unpricedLines > 0) out.push(`(${t.unpricedLines} ${t.unpricedLines === 1 ? "item has" : "items have"} no price and ${t.unpricedLines === 1 ? "is" : "are"} not in the total.)`);
  }
  out.push("", "Thanks,");
  const sender = plainText(input.senderName);
  if (sender) out.push(sender);
  return { subject: `${venue} Order`, body: out.join("\n") };
}

/** Line breaks as \r\n (what an email body and Windows apps expect); already-correct text is unchanged. */
export function toCrlf(text: string): string {
  return text.replace(/\r\n|\r|\n/g, "\r\n");
}

/* ------------------------------------------------------------------ delivery links */

/** Above this many characters an email link can be silently cut off by the browser or mail app: fall back to Copy. */
export const MAX_LINK_LENGTH = 1900;

export interface ComposeLink {
  url: string;
  /** the link is longer than MAX_LINK_LENGTH: the screen should offer Copy instead of (or beside) opening the draft */
  tooLong: boolean;
}

/** Splits "a@x.com; b@y.com" into clean addresses. */
function addressList(to: string | null | undefined): string[] {
  return plainText(to).replace(/^mailto:/i, "").split(/[;,\s]+/).filter(Boolean);
}
const enc = (s: string) => encodeURIComponent(toCrlf(s));

/** mailto: link with %0D%0A line breaks. */
export function mailtoUrl(p: { to: string | null | undefined; subject: string; body: string }): ComposeLink {
  const to = addressList(p.to).map((a) => a.replace(/[^A-Za-z0-9@.+_'-]/g, encodeURIComponent)).join(",");
  const url = `mailto:${to}?subject=${enc(p.subject)}&body=${enc(p.body)}`;
  return { url, tooLong: url.length > MAX_LINK_LENGTH };
}

/**
 * Outlook on the web compose link (the venues use Microsoft 365). Parameters to, subject and body (also cc and bcc) are the
 * documented deep link; sources: Microsoft Q&A "Want to pre populate to, cc, subject, body by passing values to query
 * parameters of outlook on the web deep link" and the community gist "URLs for linking to specific tasks in Outlook Web
 * Access (deeplinks)", checked 5 Oct 2026. Spaces are encoded as %20 and line breaks as %0D%0A. Known quirk (Microsoft Tech
 * Community): when the person is not yet signed in, Outlook can show "+" for spaces after the sign-in redirect, so Copy
 * stays the safe fallback. Not verified against a live Microsoft 365 tenant from this codebase.
 */
export function outlookWebUrl(p: { to: string | null | undefined; subject: string; body: string }): ComposeLink {
  const to = encodeURIComponent(addressList(p.to).join(","));
  const url = `https://outlook.office.com/mail/deeplink/compose?to=${to}&subject=${enc(p.subject)}&body=${enc(p.body)}`;
  return { url, tooLong: url.length > MAX_LINK_LENGTH };
}

/* ------------------------------------------------------------------ supplier contact values (import and editing) */

/** "a@x.com", "mailto:a@x.com", "a@x.com; b@y.com" -> "a@x.com, b@y.com". Null when no address is there. */
export function cleanEmailList(value: string | null | undefined): string | null {
  const parts = addressList(value).filter((a) => /^[^@\s]+@[^@\s]+$/.test(a));
  return parts.length ? parts.join(", ") : null;
}

/** "www.x.com" -> "https://www.x.com"; http(s) links are kept; anything that is not a web address is null. */
export function cleanUrl(value: string | null | undefined): string | null {
  const v = plainText(value);
  if (!v || /\s/.test(v) || v.includes("@")) return null;
  if (/^https?:\/\/\S+$/i.test(v)) return v;
  if (/^www\.\S+$/i.test(v) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v)) return `https://${v}`;
  return null;
}

/** An email address means email, a web address (http, https, www) means website; anything else is unknown (null). */
export function supplierMethodFromContact(value: string | null | undefined): OrderingMethod | null {
  const v = plainText(value);
  if (!v) return null;
  if (/^https?:\/\//i.test(v) || /^www\./i.test(v)) return "website";
  if (/^mailto:/i.test(v) || addressList(v).some((a) => /^[^@\s]+@[^@\s]+$/.test(a))) return "email";
  return null;
}

/** The workbook's Method column: "E-mail", "Online", "App". */
export function methodFromLabel(label: string | null | undefined): OrderingMethod | null {
  const v = plainText(label).toLowerCase();
  if (!v) return null;
  if (/e-?mail/.test(v)) return "email";
  if (/online|web|login|portal/.test(v)) return "website";
  if (/\bapp\b|ordermentum|orderment/.test(v)) return "app";
  return null;
}

/** One contact value split into where it belongs: { method, email_to, login_url } (unknown values leave all three null). */
export function parseContactValue(value: string | null | undefined): { method: OrderingMethod | null; email_to: string | null; login_url: string | null } {
  const method = supplierMethodFromContact(value);
  return { method, email_to: method === "email" ? cleanEmailList(value) : null, login_url: method === "website" ? cleanUrl(value) : null };
}

/* ------------------------------------------------------------------ count sessions */

/** A count line has a quantity in at least one place. */
export function isCounted(l: Pick<OrderingCountLine, "store_qty" | "second_qty"> | null | undefined): boolean {
  return !!l && (l.store_qty != null || l.second_qty != null);
}

/**
 * Where a count stands: how many active products have been counted, which have not, which are over par, and (with the
 * categories) which have a second place but only one of the two places counted. Over par uses the product's CURRENT par.
 */
export function countProgress(products: readonly OrderingProduct[], lines: readonly LineQty[], categories: readonly Pick<OrderingCategory, "id" | "second_location_label">[] = []): CountProgress {
  const byProduct = new Map<string, LineQty>();
  for (const l of lines) byProduct.set(l.product_id, l);
  const hasSecond = new Set(categories.filter((c) => c.second_location_label).map((c) => c.id));
  const active = products.filter((p) => p.active);
  const uncounted: OrderingProduct[] = [];
  const overPar: CountProgress["overPar"] = [];
  const partial: CountProgress["partial"] = [];
  let counted = 0;
  for (const p of active) {
    const l = byProduct.get(p.id);
    if (!isCounted(l)) {
      uncounted.push(p);
      continue;
    }
    counted += 1;
    const s = suggestOrder(p, l?.store_qty, l?.second_qty);
    if (s.over > 0 && s.counted != null) overPar.push({ product: p, counted: s.counted, over: s.over });
    if (hasSecond.has(p.category_id)) {
      if (l?.store_qty == null) partial.push({ product: p, missing: "store" });
      else if (l?.second_qty == null) partial.push({ product: p, missing: "second" });
    }
  }
  return { total: active.length, counted, uncounted, overPar, partial };
}

const ms = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/**
 * The offline queue meeting the server: last write wins by the device's clock, a zero stays distinct from null, and a
 * retried edit never applies twice.
 *   - Edits are applied per (session, product), oldest first (queue order breaks ties).
 *   - An edit whose client_uuid the server line already carries is skipped (the retry of an edit that did save).
 *   - An edit older than the server line's counted_at is skipped (someone counted it more recently).
 *   - An edit changes only the places it names (undefined keeps the current value; null clears; 0 is a real zero), and
 *     stamps the line with its time, person and client_uuid.
 * Pure: nothing is written. `writes` are the lines to upsert on (session_id, product_id); `lines` is every line afterwards.
 */
export function mergeCountEdits(serverLines: readonly OrderingCountLine[], localQueue: readonly CountEdit[]): CountMerge {
  const key = (session: string, product: string) => `${session}|${product}`;
  const lines = new Map<string, CountLineWrite>();
  for (const s of serverLines) {
    lines.set(key(s.session_id, s.product_id), {
      venue_id: s.venue_id,
      session_id: s.session_id,
      product_id: s.product_id,
      store_qty: s.store_qty,
      second_qty: s.second_qty,
      counted_by: s.counted_by,
      counted_at: s.counted_at,
      client_uuid: s.client_uuid,
      product_name: s.product_name,
      par_at_count: s.par_at_count,
      unit_name: s.unit_name,
    });
  }
  const changed = new Set<string>();
  const skipped: string[] = [];
  const seen = new Set<string>();
  const queue = localQueue.map((e, i) => ({ e, i })).sort((a, b) => ms(a.e.at) - ms(b.e.at) || a.i - b.i);
  for (const { e } of queue) {
    const k = key(e.session_id, e.product_id);
    const cur = lines.get(k);
    if (seen.has(e.client_uuid) || cur?.client_uuid === e.client_uuid) {
      skipped.push(e.client_uuid);
      continue;
    }
    if (cur?.counted_at && ms(e.at) < ms(cur.counted_at)) {
      skipped.push(e.client_uuid);
      continue;
    }
    seen.add(e.client_uuid);
    lines.set(k, {
      venue_id: e.venue_id,
      session_id: e.session_id,
      product_id: e.product_id,
      store_qty: e.store_qty !== undefined ? e.store_qty : cur?.store_qty ?? null,
      second_qty: e.second_qty !== undefined ? e.second_qty : cur?.second_qty ?? null,
      counted_by: e.by,
      counted_at: e.at,
      client_uuid: e.client_uuid,
      product_name: e.product_name !== undefined ? e.product_name : cur?.product_name ?? null,
      par_at_count: e.par_at_count !== undefined ? e.par_at_count : cur?.par_at_count ?? null,
      unit_name: e.unit_name !== undefined ? e.unit_name : cur?.unit_name ?? null,
    });
    changed.add(k);
  }
  return { lines: [...lines.values()], writes: [...changed].map((k) => lines.get(k) as CountLineWrite), skipped };
}
