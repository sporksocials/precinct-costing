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
import type { GstFlag, InvoiceDocumentRow, InvoiceLineRow, InvoiceQuestionRow, QuestionKind, QuestionOption } from "./invoice-types";
import { parseDescription, tidyIngredientName } from "./invoice-suggest";

/* ---------------------------------------------------------------- shapes the screen works with */

/** The document fields a card needs (a column subset, so the query stays small). */
export type QDoc = Pick<InvoiceDocumentRow, "id" | "venue_id" | "supplier_id" | "supplier_name_read" | "invoice_number" | "invoice_date" | "page_pdf_path" | "status">;
/** The line fields a card shows. */
export type QLine = Pick<InvoiceLineRow, "id" | "line_no" | "page" | "item_code" | "description" | "qty" | "unit" | "unit_price_ex" | "line_total_ex" | "ingredient_id" | "product_id"> & { gst?: GstFlag };

export interface QuestionBundle {
  q: InvoiceQuestionRow;
  doc: QDoc | null;
  line: QLine | null;
  /** the invoice supplier's name from invoice_suppliers, else null */
  supplierName: string | null;
  /** the invoice supplier's linked costing supplier (cost_suppliers.id), when it has one */
  costSupplierId?: number | null;
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

/* ================================================================ Match Lines: one review per invoice (25 Oct 2026)
 *
 * The first real invoice raised twelve "which product is this?" cards, one at a time. The review screen shows ALL of an invoice's
 * line questions together: each line gets an ingredient (a suggestion to accept, a search, or "Add As New Ingredient"), or
 * "Not In The App". Nothing is saved until Save Matches sends every choice in one go (answerQuestionsBatch).
 */

/** Questions that are "which ingredient is this line?": the ones the Match Lines table is for. */
export function isMatchKind(kind: QuestionKind): boolean {
  return kind === "unmatched_line" || kind === "ambiguous_match";
}

/** One line's choice, held on the screen until Save Matches. */
export type Decision =
  | { t: "ingredient"; ingredientId: string; name: string; via: "pick" | "suggestion" | "new" }
  | { t: "none" }
  | { t: "option"; optionId: string; label: string; note?: string };

export interface BatchAnswerLite {
  questionId: string;
  optionId: string;
  note?: string;
}

/** Splits an invoice's open questions into the Match Lines rows and everything else (units, big changes, totals, supplier). */
export function splitReview(bundles: readonly QuestionBundle[]): { match: QuestionBundle[]; other: QuestionBundle[] } {
  const match: QuestionBundle[] = [];
  const other: QuestionBundle[] = [];
  for (const b of bundles) (isMatchKind(b.q.kind) && b.q.line_id ? match : other).push(b);
  const lineNo = (b: QuestionBundle) => (b.line ? b.line.line_no : -1);
  match.sort((a, c) => lineNo(a) - lineNo(c));
  other.sort((a, c) => lineNo(a) - lineNo(c) || a.q.created_at.localeCompare(c.q.created_at));
  return { match, other };
}

export interface RowSuggestion {
  ingredientId: string;
  source: "ai" | "local";
  /** 0 to 1; null when the stored suggestion carries none */
  score: number | null;
  reason: string | null;
}

const AI_PREFIX = "suggest:";

/**
 * The suggestion for a line: the AI pass's (an option written onto the question) when there is one, else the local scorer's
 * best candidate when it is strong enough to pre-set. Null when neither has anything worth showing.
 */
export function rowSuggestion(options: readonly QuestionOption[], local: readonly { ingredientId: string; score: number; why: string }[], presetScore: number): RowSuggestion | null {
  const ai = options.find((o) => o.id.startsWith(AI_PREFIX) && o.ingredient_id) as (QuestionOption & { confidence?: unknown; reason?: unknown }) | undefined;
  if (ai?.ingredient_id) {
    return { ingredientId: ai.ingredient_id, source: "ai", score: typeof ai.confidence === "number" ? ai.confidence : null, reason: typeof ai.reason === "string" ? ai.reason : null };
  }
  const top = local[0];
  if (top && top.score >= presetScore) return { ingredientId: top.ingredientId, source: "local", score: top.score, reason: top.why };
  return null;
}

/** The answer a decision sends. Ingredient choices go as `custom:<id>` with the checked note; "Not In The App" is the standard not_a_product answer. */
export function decisionAnswer(b: QuestionBundle, d: Decision): BatchAnswerLite {
  if (d.t === "ingredient") {
    const a = ingredientAnswer(d.ingredientId);
    return { questionId: b.q.id, optionId: a.optionId, note: a.note };
  }
  if (d.t === "none") return { questionId: b.q.id, optionId: "not_a_product" };
  return d.note !== undefined ? { questionId: b.q.id, optionId: d.optionId, note: d.note } : { questionId: b.q.id, optionId: d.optionId };
}

/** Everything chosen so far, in invoice order, as the answers Save Matches sends. A question with no choice is left open. */
export function buildBatch(bundles: readonly QuestionBundle[], decisions: ReadonlyMap<string, Decision>): BatchAnswerLite[] {
  const out: BatchAnswerLite[] = [];
  for (const b of bundles) {
    const d = decisions.get(b.q.id);
    if (d) out.push(decisionAnswer(b, d));
  }
  return out;
}

export interface SuggestRow {
  id: string;
  suggestion: RowSuggestion | null;
}

/** Accept All Suggestions: every row with a suggestion and no choice yet takes its suggestion. `nameOf` is undefined for an ingredient that is gone. */
export function acceptSuggestions(rows: readonly SuggestRow[], decisions: ReadonlyMap<string, Decision>, nameOf: (ingredientId: string) => string | undefined): Map<string, Decision> {
  const next = new Map(decisions);
  for (const r of rows) {
    if (next.has(r.id) || !r.suggestion) continue;
    const name = nameOf(r.suggestion.ingredientId);
    if (name) next.set(r.id, { t: "ingredient", ingredientId: r.suggestion.ingredientId, name, via: "suggestion" });
  }
  return next;
}

/** How many rows Accept All Suggestions would take. */
export function acceptableCount(rows: readonly SuggestRow[], decisions: ReadonlyMap<string, Decision>, nameOf: (ingredientId: string) => string | undefined): number {
  return rows.filter((r) => !decisions.has(r.id) && r.suggestion && nameOf(r.suggestion.ingredientId)).length;
}

export type RowStatus = "matched" | "not_in_app" | "suggested" | "needs_choice";

/** The status for a row, shown as a word with an icon (never colour alone). */
export function rowStatus(decision: Decision | undefined, suggestion: RowSuggestion | null): RowStatus {
  if (decision?.t === "ingredient") return "matched";
  if (decision?.t === "none") return "not_in_app";
  if (suggestion) return "suggested";
  return "needs_choice";
}

export const STATUS_WORDS: Record<RowStatus, string> = { matched: "Matched", not_in_app: "Not In The App", suggested: "Suggested", needs_choice: "Needs A Choice" };

/** SHOUTING scan text in Title Case, keeping sizes ("2kg") and brackets. Text already in mixed case is left alone. */
export function readableCase(text: string | null | undefined): string {
  const s = String(text ?? "").replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, " ").trim();
  // scans print sizes in lower case ("2kg", "6x2kg") inside shouting text: letters straight after a digit do not count
  const letters = s.replace(/(\d)[a-z]+/g, "$1");
  if (!s || letters !== letters.toUpperCase() || !/[A-Z]/.test(letters)) return s;
  return s
    .toLowerCase()
    .replace(/(^|[\s(/-])([a-z])/g, (_m, pre: string, c: string) => `${pre}${c.toUpperCase()}`)
    .replace(/(\d)(kg|gr|g|ml|l|lt|ltr)\b/gi, (_m, d: string, u: string) => `${d}${u.toLowerCase()}`);
}

/** The invoice line for a review row: the description in readable case, the supplier code, and one meta line (quantity, unit, unit price ex GST). */
export function reviewLineText(line: QLine | null): { title: string; code: string | null; meta: string } {
  if (!line) return { title: "(Line no longer on the invoice)", code: null, meta: "" };
  const title = readableCase(line.description) || "(No description)";
  const qty = line.qty != null ? `${trimQty(Number(line.qty))}${line.unit ? ` ${line.unit}` : ""}` : line.unit ?? "";
  const price = line.unit_price_ex != null ? `${money(Number(line.unit_price_ex))} ex GST` : "";
  const meta = qty && price ? `${qty} @ ${price}` : qty || price;
  return { title, code: line.item_code?.trim() || null, meta };
}

/** The lines that fill the Not In The App confirmation: what will be ignored (and remembered for this supplier). */
export function ignoreList(bundles: readonly QuestionBundle[]): { id: string; title: string; code: string | null }[] {
  return bundles.map((b) => {
    const t = reviewLineText(b.line);
    return { id: b.q.id, title: t.title, code: t.code };
  });
}

/** What Save Matches says on its button. */
export function saveLabel(n: number): string {
  return n === 0 ? "Save Matches" : `Save Matches (${n})`;
}

/* ---------------------------------------------------------------- Add As New Ingredient */

export interface NewIngredientFields {
  name: string;
  supplier_id: number | null;
  supplier_code: string | null;
  pack_size: number;
  pack_unit: "kg" | "L" | "each";
  /** 0 when unsure: the sheet then shows a blank price */
  pack_price: number;
  price_inc_gst: boolean;
  gst_free: boolean;
  source: string;
  notes: string | null;
}

/**
 * The New Ingredient sheet's starting point for an invoice line. The person confirms it; nothing is created here.
 * Invoice prices are stored ex GST, so the pack price is the line's unit price ex GST (the sheet's "Price Includes GST" stays off).
 * A pack size comes from the description ("6x2kg" is 12 kg) or from a line sold by the kg or L; when neither says, the price is
 * left blank rather than guessed.
 */
export function newIngredientFields(args: { line: QLine; costSupplierId: number | null; sourceLabel: string }): NewIngredientFields {
  const { line } = args;
  const parsed = parseDescription(line.description);
  const sold = String(line.unit ?? "").trim().toLowerCase();
  const price = line.unit_price_ex != null && Number(line.unit_price_ex) > 0 ? Math.round(Number(line.unit_price_ex) * 100) / 100 : 0;
  let pack_size = 1;
  let pack_unit: "kg" | "L" | "each" = "each";
  let pack_price = 0;
  let notes: string | null = "Pack size not read from the invoice. Please check it.";
  if (sold === "kg" || sold === "l" || sold === "lt") {
    pack_unit = sold === "kg" ? "kg" : "L";
    pack_price = price;
    notes = null;
  } else if (parsed.pack) {
    pack_size = parsed.pack.size;
    pack_unit = parsed.pack.unit;
    pack_price = price;
    notes = null;
  }
  return {
    name: tidyIngredientName(line.description),
    supplier_id: args.costSupplierId,
    supplier_code: line.item_code?.trim() || null,
    pack_size,
    pack_unit,
    pack_price,
    price_inc_gst: false,
    gst_free: line.gst === "free",
    source: args.sourceLabel,
    notes,
  };
}
