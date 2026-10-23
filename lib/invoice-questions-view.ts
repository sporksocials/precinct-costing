/**
 * Invoice questions screen (/invoices/questions): the pure rules. No React, no database.
 *
 * Mon and Matt answer here. A question is a card: the prompt in plain words, the invoice line it is about, a link to the
 * split PDF page, and answer buttons. This file groups the cards by invoice, words the line, describes each answer button
 * (a match names the ingredient and its current price), builds the two "custom" answers the buttons cannot offer (an
 * ingredient picked from a search, a pack size typed in), and words the "Saved." toast.
 *
 * The custom answers go to answerQuestion (lib/invoice-answer.ts) as an option id plus a JSON note:
 *   - an ingredient found by search:  optionId "custom:<ingredientId>",  note {"ingredient_id":"<id>","packs_per_unit"?:n}
 *   - a pack size for a matched line: optionId "custom:packs",           note {"packs_per_unit":n}
 * Everything else sends one of the question's own option ids and no note.
 */
import { indexDoc, search, type IndexedDoc } from "./search";
import { money, num, packLabel } from "./format";
import type { InvoiceDocumentRow, InvoiceLineRow, InvoiceQuestionRow, QuestionKind, QuestionOption } from "./invoice-types";

/* ---------------------------------------------------------------- shapes the screen works with */

/** The document fields a card needs (a column subset, so the query stays small). */
export type QDoc = Pick<InvoiceDocumentRow, "id" | "venue_id" | "supplier_id" | "supplier_name_read" | "invoice_number" | "invoice_date" | "page_pdf_path" | "status">;
/** The line fields a card shows. */
export type QLine = Pick<InvoiceLineRow, "id" | "line_no" | "page" | "item_code" | "description" | "qty" | "unit" | "unit_price_ex" | "line_total_ex" | "ingredient_id" | "product_id">;

export interface QuestionBundle {
  q: InvoiceQuestionRow;
  doc: QDoc | null;
  line: QLine | null;
  /** the invoice supplier's name from invoice_suppliers, else null */
  supplierName: string | null;
}

export interface QuestionGroup {
  docId: string;
  venueId: number;
  /** "Daniel Street Fish Market, invoice 51329, 14 Oct" */
  title: string;
  bundles: QuestionBundle[];
  /** newest created_at among the group's questions, for ordering */
  newest: string;
}

/** What the answer buttons need to know about an ingredient or an ordering product. */
export interface IngredientLite {
  id: string;
  name: string;
  supplier_id: number | null;
  supplier_code: string | null;
  active: boolean;
  pack_size: number;
  pack_unit: string;
  pack_price: number;
  price_inc_gst: boolean;
  gst_free: boolean;
}
export interface ProductLite {
  id: string;
  name: string;
  unit_name: string;
  price_inc_gst: number | null;
}
export interface OptionLookups {
  ingredients: ReadonlyMap<string, IngredientLite>;
  products: ReadonlyMap<string, ProductLite>;
}

/* ---------------------------------------------------------------- words */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14 Oct" from yyyy-mm-dd (the year is added when it is not the year of `today`). Calendar maths only: no time zone shifts. */
export function shortDate(date: string | null | undefined, today?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? "");
  if (!m) return "";
  const day = Number(m[3]);
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return "";
  const withYear = today && /^\d{4}/.test(today) && today.slice(0, 4) !== m[1];
  return withYear ? `${day} ${month} ${m[1]}` : `${day} ${month}`;
}

/** "Fri 24 Oct, 3:15 pm" in Brisbane time (fixed +10:00). Empty when the text is not a date. */
export function brisbaneStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t + 10 * 3_600_000);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const h = d.getUTCHours();
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${wd} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? "am" : "pm"}`;
}

export function supplierLabel(b: Pick<QuestionBundle, "doc" | "supplierName">): string {
  return b.supplierName?.trim() || b.doc?.supplier_name_read?.trim() || "Unknown supplier";
}

/** "Daniel Street Fish Market, invoice 51329, 14 Oct": the parts that exist, joined with commas. */
export function groupTitle(b: Pick<QuestionBundle, "doc" | "supplierName">, today?: string): string {
  const parts = [supplierLabel(b)];
  const no = b.doc?.invoice_number?.trim();
  if (no) parts.push(`invoice ${no}`);
  const d = shortDate(b.doc?.invoice_date, today);
  if (d) parts.push(d);
  return parts.join(", ");
}

/**
 * Open questions grouped by invoice. Groups run newest first (by their newest question); inside a group the invoice-wide
 * questions come first, then the line questions in invoice order.
 */
export function groupQuestions(bundles: readonly QuestionBundle[], today?: string): QuestionGroup[] {
  const by = new Map<string, QuestionGroup>();
  for (const b of bundles) {
    const key = b.q.document_id;
    const g = by.get(key);
    if (g) {
      g.bundles.push(b);
      if (b.q.created_at > g.newest) g.newest = b.q.created_at;
    } else {
      by.set(key, { docId: key, venueId: b.q.venue_id, title: groupTitle(b, today), bundles: [b], newest: b.q.created_at });
    }
  }
  const lineNo = (b: QuestionBundle) => (b.line ? b.line.line_no : -1);
  const groups = [...by.values()];
  for (const g of groups) g.bundles.sort((a, c) => lineNo(a) - lineNo(c) || a.q.created_at.localeCompare(c.q.created_at));
  return groups.sort((a, c) => c.newest.localeCompare(a.newest) || a.title.localeCompare(c.title));
}

const trimQty = (n: number) => num(n, 3);

/** The invoice line in words: a title (the description) and one meta line ("Code 15026 · 1.85 KG @ $68.90 = $127.47 ex GST"). */
export function lineText(line: QLine | null): { title: string; meta: string } | null {
  if (!line) return null;
  const parts: string[] = [];
  if (line.item_code?.trim()) parts.push(`Code ${line.item_code.trim()}`);
  const qty = line.qty != null ? `${trimQty(Number(line.qty))}${line.unit ? ` ${line.unit}` : ""}` : line.unit ?? "";
  const price = line.unit_price_ex != null ? `${money(Number(line.unit_price_ex))}` : "";
  const total = line.line_total_ex != null ? money(Number(line.line_total_ex)) : "";
  let money_ = "";
  if (qty && price) money_ = `${qty} @ ${price}`;
  else if (qty) money_ = qty;
  else if (price) money_ = price;
  if (total) money_ = money_ ? `${money_} = ${total}` : total;
  if (money_) parts.push(`${money_} ex GST`);
  if (line.page != null) parts.push(`Page ${line.page}`);
  return { title: line.description.trim() || "(No description)", meta: parts.join(" · ") };
}

/* ---------------------------------------------------------------- answer buttons */

export type OptionVariant = "primary" | "tinted" | "plain" | "danger";

export interface OptionView {
  id: string;
  label: string;
  /** a quiet second line: the current price of the thing a match option names */
  sub: string | null;
  variant: OptionVariant;
}

/** True when the answer names an ingredient or an ordering product (it teaches the system a match). */
export function isMatchOption(o: QuestionOption): boolean {
  return !!(o.ingredient_id || o.product_id);
}

/** "Now $68.90 per 1 kg pack, ex GST" for an ingredient; the basis follows the ingredient's own flags. */
export function ingredientPriceSentence(i: Pick<IngredientLite, "pack_size" | "pack_unit" | "pack_price" | "price_inc_gst" | "gst_free">): string {
  const basis = i.gst_free ? "GST free" : i.price_inc_gst ? "inc GST" : "ex GST";
  return `Now ${money(Number(i.pack_price))} per ${packLabel(Number(i.pack_size), i.pack_unit)} pack, ${basis}`;
}

export function productPriceSentence(p: Pick<ProductLite, "unit_name" | "price_inc_gst">): string {
  if (p.price_inc_gst == null) return "No ordering price set yet";
  return `Ordering price now ${money(Number(p.price_inc_gst))} per ${p.unit_name || "unit"}, inc GST`;
}

function variantFor(o: QuestionOption): OptionVariant {
  switch (o.action) {
    case "approve_change":
    case "confirm_venue":
      return "primary";
    case "ignore_line":
    case "ignore_document":
    case "not_a_product":
    case "reject_change":
    case "wrong_venue":
      return "plain";
    case "reread":
      return "tinted";
    default:
      return isMatchOption(o) ? "tinted" : "plain";
  }
}

/** One answer button: its label, and for a match the current price of what it names. */
export function describeOption(o: QuestionOption, look: OptionLookups, unit?: string | null): OptionView {
  let sub: string | null = null;
  const ing = o.ingredient_id ? look.ingredients.get(o.ingredient_id) : undefined;
  const prod = o.product_id ? look.products.get(o.product_id) : undefined;
  if (ing) sub = ingredientPriceSentence(ing);
  else if (prod) sub = productPriceSentence(prod);
  if (sub && o.packs_per_unit != null && Number(o.packs_per_unit) > 0 && Number(o.packs_per_unit) !== 1) {
    sub = `${sub} · each ${unitWord(unit)} holds ${num(Number(o.packs_per_unit), 3)}`;
  }
  // an offered ingredient is named by its own current name, whatever label the engine wrote when the question was raised
  const label = o.label?.trim() || ing?.name || prod?.name || "Choose";
  return { id: o.id, label, sub, variant: variantFor(o) };
}

const UNIT_WORDS: Record<string, string> = { ea: "unit", each: "unit", ctn: "carton", pkt: "packet", pk: "pack", btl: "bottle", bag: "bag", keg: "keg" };

/** A printed unit as a word to put in a sentence: "CTN" is "carton", "EA" is "unit", "KG" stays "kg". */
export function unitWord(unit: string | null | undefined): string {
  const u = unit?.trim().toLowerCase() ?? "";
  return u ? UNIT_WORDS[u] ?? u : "unit";
}

/** Questions where a person may search every ingredient for something the options missed. */
export function canSearchIngredients(kind: QuestionKind): boolean {
  return kind === "unmatched_line" || kind === "ambiguous_match";
}

/** Questions where the pack size (how many in one unit) is what is missing. */
export function needsPackHelper(kind: QuestionKind): boolean {
  return kind === "unit_unclear";
}

/* ---------------------------------------------------------------- custom answers */

export const CUSTOM_OPTION_PREFIX = "custom:";
export const PACKS_OPTION_ID = "custom:packs";
export const PACK_PRESETS = [1, 6, 12, 24] as const;
export const MAX_PACKS = 10_000;

export interface AnswerNote {
  ingredient_id?: string;
  packs_per_unit?: number;
}
export interface CustomAnswer {
  optionId: string;
  note: string;
}

/** "12", "12.5", "1,200" become a number; zero, negatives, words and anything above MAX_PACKS are null. */
export function parsePacks(text: string): number | null {
  const t = text.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,4})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= MAX_PACKS ? n : null;
}

/** The answer for "it is this ingredient" when the ingredient was found by search. */
export function ingredientAnswer(ingredientId: string, packsPerUnit?: number | null): CustomAnswer {
  const note: AnswerNote = { ingredient_id: ingredientId };
  if (packsPerUnit != null && packsPerUnit > 0) note.packs_per_unit = packsPerUnit;
  return { optionId: `${CUSTOM_OPTION_PREFIX}${ingredientId}`, note: JSON.stringify(note) };
}

/** The answer for "one unit holds N" on a line whose product is already known. */
export function packsAnswer(packs: number): CustomAnswer {
  return { optionId: PACKS_OPTION_ID, note: JSON.stringify({ packs_per_unit: packs } satisfies AnswerNote) };
}

/** Reads a note back (the answered list, tests). Anything that is not our JSON is null. */
export function parseAnswerNote(note: string | null | undefined): AnswerNote | null {
  if (!note) return null;
  try {
    const v = JSON.parse(note) as unknown;
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    const out: AnswerNote = {};
    if (typeof o.ingredient_id === "string" && o.ingredient_id) out.ingredient_id = o.ingredient_id;
    if (typeof o.packs_per_unit === "number" && o.packs_per_unit > 0) out.packs_per_unit = o.packs_per_unit;
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/** The ingredient id inside a custom option id ("custom:abc" gives "abc"); null for any other id, and for custom:packs. */
export function customIngredientId(optionId: string): string | null {
  if (!optionId.startsWith(CUSTOM_OPTION_PREFIX) || optionId === PACKS_OPTION_ID) return null;
  return optionId.slice(CUSTOM_OPTION_PREFIX.length) || null;
}

/* ---------------------------------------------------------------- ingredient search */

export type IngredientDoc = IndexedDoc & { ing: IngredientLite };

/** Searchable documents for the active ingredients (name first, supplier and code as extra words). */
export function ingredientSearchDocs(ingredients: readonly IngredientLite[], supplierName: (id: number) => string | undefined): IngredientDoc[] {
  return ingredients
    .filter((i) => i.active)
    .map((ing) => ({ ...indexDoc({ kind: "ingredient" as const, id: ing.id, title: ing.name, sub: "", href: "", extra: `${ing.supplier_id != null ? supplierName(ing.supplier_id) ?? "" : ""} ${ing.supplier_code ?? ""}` }), ing }));
}

/** The best matches for what was typed; nothing for fewer than two letters. */
export function findIngredients(docs: readonly IngredientDoc[], query: string, limit = 6): IngredientLite[] {
  if (query.trim().length < 2) return [];
  return search(docs as IngredientDoc[], query, limit).map((h) => h.doc.ing);
}

/* ---------------------------------------------------------------- the toast and the answered list */

/** What the system learned or did, in a short sentence. Only claims what the answer itself says. */
export function savedText(b: Pick<QuestionBundle, "doc" | "line" | "supplierName">, option: Pick<QuestionOption, "action" | "label" | "packs_per_unit">, matchedName?: string | null, packs?: number | null): string {
  const supplier = supplierLabel(b);
  const what = b.line?.item_code?.trim() ? `${supplier} code ${b.line.item_code.trim()}` : b.line?.description?.trim() ? `${supplier} ${b.line.description.trim()}` : `${supplier} line`;
  const item = b.line?.description?.trim() || "that line";
  if (packs != null && !matchedName) return `Saved. One ${unitWord(b.line?.unit)} of ${item} holds ${num(packs, 3)}.`;
  if (matchedName) return `Saved. ${what} is now ${matchedName}.`;
  switch (option.action) {
    case "ignore_line":
      return "Saved. That line will be ignored.";
    case "not_a_product":
      return "Saved. That line is not a product.";
    case "approve_change":
      return `Saved. The new price for ${item} is approved.`;
    case "reject_change":
      return `Saved. The price for ${item} stays as it was.`;
    case "confirm_venue":
      return "Saved. This invoice stays with this venue.";
    case "wrong_venue":
      return "Saved. This invoice is marked as belonging to another venue.";
    case "reread":
      return "Saved. The invoice will be read again.";
    case "ignore_document":
      return "Saved. That invoice is ignored.";
    default:
      return `Saved. ${option.label}.`;
  }
}

/** What an answered question was answered with, in words. */
export function answeredLabel(q: Pick<InvoiceQuestionRow, "options" | "answer">, ingredientName: (id: string) => string | undefined): string {
  const a = q.answer;
  if (!a) return "Answered";
  const own = q.options.find((o) => o.id === a.option_id);
  if (own?.label) return own.label;
  const note = parseAnswerNote(a.note);
  if (a.option_id === PACKS_OPTION_ID) return note?.packs_per_unit ? `One unit holds ${num(note.packs_per_unit, 3)}` : "Pack size set";
  const id = note?.ingredient_id ?? customIngredientId(a.option_id);
  const name = id ? ingredientName(id) : undefined;
  return name ? `Matched to ${name}` : "Answered";
}

/** "Open (3)" style counts for the two tabs. A capped list reads "100+". */
export function countLabel(label: string, n: number, cap?: number): string {
  return `${label} (${cap != null && n >= cap ? `${cap}+` : n})`;
}
