/**
 * Match Items: how big is ONE invoice unit, in the app's own packs? (Troy, 25 Oct 2026: "the invoice line item is PKT but we have
 * it in our system in KG. The PKT is 2.5kg.") The engine already turns an invoice unit price into the app's pack price with
 * `packs_per_unit` (costing packs in ONE invoice unit). This file works that number out from what the invoice says, shows the
 * result per kg, per L or per each beside the app's current price, and says plainly when the two disagree. Pure, no store.
 *
 * The rule that matters: an unknown conversion is NEVER 1. When the size cannot be read, or reads two ways, or does not share a
 * dimension with the app's pack (a price per kg against a pack in litres), the number is left empty and the row asks.
 */
import { ingredientExGstPackPrice } from "./costing";
import { money, packLabel } from "./format";
import { baseUnitFor, canonicalUnit, packBaseSize, plausibleFactors, type BaseUnit } from "./invoice-units";

/** Where the screen draws the line between "matches the app" and "check this" (Troy's 5%). */
export const DIFF_PCT = 0.05;

/** A pack count the screen will accept: more than zero, at most this. Matches the answer check in lib/invoice-answer. */
export const MAX_PACKS_PER_UNIT = 10_000;

/* ---------------------------------------------------------------- reading sizes out of text */

export interface SizeCandidate {
  dim: BaseUnit;
  /** the total in kg, L or each */
  amount: number;
  /** the size as the app writes it in a name: "2.5kg", "6 x 2kg", "700ml", "1L" */
  text: string;
  /** true when the text states a count of smaller items ("6x2kg", "12/250ml"): the whole case is described */
  multi: boolean;
}

const UNIT_RE = "(kgs?|kilos?|gms?|gr|g|mls?|ltrs?|lt|l|litres?|liters?|cl)";
const NUM = "(\\d+(?:[.,]\\d+)?)";
const MULTI_RE = new RegExp(`(?<![\\d.])(\\d{1,3})\\s*(?:x|×|\\/)\\s*${NUM}\\s*${UNIT_RE}\\b`, "gi");
const SINGLE_RE = new RegExp(`(?<![\\d.])${NUM}\\s*${UNIT_RE}\\b`, "gi");

function measure(raw: string): { dim: BaseUnit; factor: number; word: string } {
  const u = raw.toLowerCase();
  if (u.startsWith("k")) return { dim: "kg", factor: 1, word: "kg" };
  if (u === "g" || u === "gr" || u.startsWith("gm")) return { dim: "kg", factor: 0.001, word: "g" };
  if (u === "cl") return { dim: "L", factor: 0.01, word: "cl" };
  if (u.startsWith("m")) return { dim: "L", factor: 0.001, word: "ml" };
  return { dim: "L", factor: 1, word: "L" };
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;
/** 2.5 -> "2.5", 2 -> "2", 0.35 -> "0.35": no trailing zeros. */
const plain = (n: number) => String(round4(n));
const toNumber = (s: string) => Number(s.replace(",", "."));

/**
 * Every size a piece of text states: "2.5kg", "6x2kg" (12 kg, and 6 each), "12/250 ml" (3 L, and 12 each), "700mL", "1LT",
 * "30'S" (30 each), "(DOZEN)", "Qty:1000". Cases of the same size stated twice ("700mL 700ML") are one. Order is the order printed.
 */
export function parseSizes(text: string | null | undefined): SizeCandidate[] {
  let rest = String(text ?? "");
  const out: SizeCandidate[] = [];
  const add = (c: SizeCandidate) => {
    if (!out.some((o) => o.dim === c.dim && Math.abs(o.amount - c.amount) < 1e-9 && o.multi === c.multi)) out.push(c);
  };

  rest = rest.replace(MULTI_RE, (_m, n: string, s: string, u: string) => {
    const count = Number(n);
    const size = toNumber(s);
    const m = measure(u);
    if (count >= 2 && size > 0) {
      add({ dim: m.dim, amount: round4(count * size * m.factor), text: `${count} x ${plain(size)}${m.word}`, multi: true });
      add({ dim: "each", amount: count, text: `${count}`, multi: true });
    }
    return " ";
  });
  rest = rest.replace(SINGLE_RE, (_m, s: string, u: string) => {
    const size = toNumber(s);
    const m = measure(u);
    if (size > 0) add({ dim: m.dim, amount: round4(size * m.factor), text: `${plain(size)}${m.word}`, multi: false });
    return " ";
  });
  // counts of items: "30'S", "24 pack", "12pk", "Qty:1000", "(DOZEN)"
  for (const m of Array.from(rest.matchAll(/(?<![\d.])(\d{1,4})\s*(?:'s\b|’s\b|\s*(?:pk|pack|pcs|pc|ct|ea|each|units?)\b)/gi))) {
    const n = Number(m[1]);
    if (n >= 2) add({ dim: "each", amount: n, text: `${n}`, multi: false });
  }
  for (const m of Array.from(rest.matchAll(/qty\s*[:.]?\s*(\d{1,5})/gi))) {
    const n = Number(m[1]);
    if (n >= 2) add({ dim: "each", amount: n, text: `${n}`, multi: false });
  }
  if (/\bdozen\b/i.test(rest)) add({ dim: "each", amount: 12, text: "12", multi: false });
  return out;
}

/** The text with every size and count of the kinds `parseSizes` reads taken out (for building a name). */
export function stripSizes(text: string | null | undefined): string {
  return String(text ?? "")
    .replace(MULTI_RE, " ")
    .replace(SINGLE_RE, " ")
    .replace(/(?<![\d.])\d{1,4}\s*(?:'s\b|’s\b|\s*(?:pk|pack|pcs|pc|ct|ea|each|units?)\b)/gi, " ")
    .replace(/qty\s*[:.]?\s*\d{1,5}/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The size a description is known by, for a name: a stated case ("6 x 2kg") first, else the first weight or volume. Null when it states none. */
export function describedSize(description: string | null | undefined): string | null {
  const found = parseSizes(description).filter((c) => c.dim !== "each");
  return (found.find((c) => c.multi) ?? found[0])?.text ?? null;
}

/* ---------------------------------------------------------------- the invoice unit */

export interface UnitReading {
  /** "PKT", "CTN", "EA": the printed word, upper case, without the bracket ("EA (KG)" gives "EA") */
  label: string;
  canon: string;
  /** the unit IS a measure: "KG" or "L" */
  measure: "kg" | "L" | null;
  /** a case that holds several: carton, case, box, tray */
  holdsMany: boolean;
  /** sizes written inside the unit's brackets: "EA (700G)", "CTN (2 X 6KG" */
  sizes: SizeCandidate[];
}

const MANY = new Set(["carton", "box", "tray", "slv", "sleeve", "dozen", "pallet"]);

/** Reads the printed unit. A missing unit reads as a single item (label "unit"). */
export function readUnit(unit: string | null | undefined, description?: string | null): UnitReading {
  const raw = String(unit ?? "").trim();
  const head = raw.split(/[\s(]/)[0] ?? "";
  const canon = canonicalUnit(head);
  const inside = raw.includes("(") ? raw.slice(raw.indexOf("(") + 1) : "";
  const measureOf: UnitReading["measure"] = canon === "kg" ? "kg" : canon === "l" ? "L" : null;
  // a unit with no word at all but a description that says "Carton" or "CTN" is still a case
  const descMany = !raw && /\b(carton|ctn|case)\b/i.test(String(description ?? ""));
  return {
    label: head ? head.toUpperCase() : "UNIT",
    canon: canon || "unit",
    measure: measureOf,
    holdsMany: MANY.has(canon) || descMany,
    sizes: parseSizes(inside),
  };
}

/* ---------------------------------------------------------------- deriving packs per unit */

export interface ConvIngredient {
  pack_size: number;
  pack_unit: string;
  pack_price: number;
  price_inc_gst: boolean;
  gst_free: boolean;
}

export type AskWhy = "no_size" | "dimension" | "carton" | "conflict" | "no_pack";

export interface Derivation {
  /** costing packs in one invoice unit (4 dp), or null when it must be asked */
  packs: number | null;
  /** how the invoice describes its unit: "2.5kg", "6 x 2kg"; null when it says nothing */
  sizeText: string | null;
  /** the invoice unit's total size in the app's base unit, when known */
  unitSize: { amount: number; dim: BaseUnit } | null;
  how: "described" | "measure" | "each" | "ask";
  askWhy: AskWhy | null;
  /** when asking, the best single guess, offered as a one-tap button (never filled in by itself) */
  likelyPacks: number | null;
  /** the unit is a plain measure (KG against a kg pack): nothing to say unless it disagrees */
  trivial: boolean;
  /** a plain sentence about what the invoice states, for the quiet line */
  hint: string | null;
}

const ASK = (askWhy: AskWhy, extra: Partial<Derivation> = {}): Derivation => ({
  packs: null,
  sizeText: null,
  unitSize: null,
  how: "ask",
  askWhy,
  likelyPacks: null,
  trivial: false,
  hint: null,
  ...extra,
});

const dimWord = (d: BaseUnit) => (d === "kg" ? "kilos" : d === "L" ? "litres" : "items");

/**
 * Packs per invoice unit where the invoice makes it certain. `description` and `unit` are the printed ones.
 *  - KG against a pack in kg or g, L against L or ml: the unit is itself the size.
 *  - EA against a pack of eaches: one each.
 *  - A stated size in the pack's dimension ("2.5kg", "6x2kg", "12/250ml"): size divided by the pack.
 *  - A single size on a carton or case ("CTN ... 5kg") might be the item and not the case: asked, with the described size offered.
 *  - Two different sizes in the pack's dimension ("EA (360ML)" on a "360G JAR"): asked.
 *  - No size, or a size in another dimension (kg against litres): asked.
 */
export function deriveConversion(input: { description: string | null | undefined; unit: string | null | undefined; ingredient: Pick<ConvIngredient, "pack_size" | "pack_unit"> }): Derivation {
  const ing = input.ingredient;
  const packSize = packBaseSize(ing);
  const dim = baseUnitFor(ing.pack_unit);
  if (packSize == null || !dim) return ASK("no_pack", { hint: "The app has no usable pack size for this ingredient yet." });
  const u = readUnit(input.unit, input.description);
  const all = [...parseSizes(input.description), ...u.sizes];
  const done = (amount: number, how: Derivation["how"], text: string | null, trivial = false): Derivation => ({
    packs: round4(amount / packSize),
    sizeText: text,
    unitSize: { amount, dim },
    how,
    askWhy: null,
    likelyPacks: null,
    trivial,
    hint: null,
  });

  // the unit is a measure: KG or L
  if (u.measure) {
    if ((u.measure === "kg" && dim === "kg") || (u.measure === "L" && dim === "L")) return done(1, "measure", null, true);
    return ASK("dimension", { hint: `The invoice sells by the ${u.measure}, but the app's pack is in ${dimWord(dim)}.` });
  }

  // an item sold by the each against an ingredient packed in eaches: one each
  if (dim === "each" && u.canon === "each") return done(1, "each", null, true);

  const inDim = all.filter((c) => c.dim === dim);
  // two different sizes in the pack's dimension (ignoring the same size said twice)
  const distinct: SizeCandidate[] = [];
  for (const c of inDim) if (!distinct.some((d) => Math.abs(d.amount - c.amount) / Math.max(d.amount, 1e-9) < 0.01)) distinct.push(c);
  // a count from a "6x2kg" is a different statement from the weight; for an each pack, prefer the multi count
  const pool = dim === "each" && distinct.some((c) => c.multi) ? distinct.filter((c) => c.multi) : distinct;

  if (pool.length === 1) {
    const c = pool[0];
    if (u.holdsMany && !c.multi && c.dim !== "each") {
      return ASK("carton", { sizeText: c.text, unitSize: { amount: c.amount, dim }, likelyPacks: round4(c.amount / packSize), hint: `The description says ${c.text}. That may be one item, not the whole ${u.label}.` });
    }
    return done(c.amount, "described", c.text);
  }
  if (pool.length > 1) {
    return ASK("conflict", { sizeText: pool[0].text, likelyPacks: round4(pool[0].amount / packSize), hint: `The invoice gives more than one size: ${pool.map((c) => c.text).join(" and ")}.` });
  }

  // nothing in the pack's dimension
  const other = all.filter((c) => c.dim !== "each" && c.dim !== dim);
  if (other.length) return ASK("dimension", { sizeText: other[0].text, hint: `The invoice says ${other[0].text}, but the app's pack is in ${dimWord(dim)}.` });
  // a single item (a bottle, a jar, a packet) against an ingredient packed in eaches
  if (dim === "each" && !u.holdsMany) return done(1, "each", null);
  return ASK("no_size", { hint: "The invoice does not say how much is in one." });
}

/** The pack counts offered as one-tap buttons when the row asks: the best guess first, then what the description suggests. */
export function quickFactors(description: string | null | undefined, likely: number | null): number[] {
  const out: number[] = [];
  if (likely != null && likely > 0) out.push(likely);
  for (const n of plausibleFactors(description)) if (!out.includes(n)) out.push(n);
  return out.slice(0, 6);
}

/* ---------------------------------------------------------------- comparing the price with the app's */

export type CompareState = "match" | "above" | "below" | "no_app_price" | "no_invoice_price";

export interface Comparison {
  state: CompareState;
  base: BaseUnit;
  /** the invoice price per kg, L or each, ex GST (null when there is no price or no size) */
  invoicePerBase: number | null;
  /** the app's current price per kg, L or each, ex GST (null when the app has no price) */
  appPerBase: number | null;
  /** (invoice - app) / app as a fraction; null when either side is missing */
  diff: number | null;
}

/**
 * Invoice price against the app's price, both ex GST and both per base unit. `packs` is the number on the row (typed or derived),
 * so changing it changes the comparison. The invoice unit price is the supplier's ex GST price for ONE invoice unit.
 */
export function compareToApp(input: { packs: number; unitPriceEx: number | null | undefined; ingredient: ConvIngredient; gstRate: number }): Comparison {
  const { packs, unitPriceEx, ingredient, gstRate } = input;
  const base = baseUnitFor(ingredient.pack_unit) ?? "each";
  const size = packBaseSize(ingredient) ?? 0;
  const appPack = ingredientExGstPackPrice(ingredient, gstRate);
  const hasInvoice = unitPriceEx != null && Number.isFinite(Number(unitPriceEx)) && Number(unitPriceEx) > 0 && packs > 0 && size > 0;
  const hasApp = appPack > 0 && size > 0;
  const invoicePerPack = hasInvoice ? Number(unitPriceEx) / packs : null;
  const invoicePerBase = invoicePerPack != null ? invoicePerPack / size : null;
  const appPerBase = hasApp ? appPack / size : null;
  if (!hasInvoice) return { state: "no_invoice_price", base, invoicePerBase: null, appPerBase, diff: null };
  if (!hasApp) return { state: "no_app_price", base, invoicePerBase, appPerBase: null, diff: null };
  const diff = invoicePerPack! / appPack - 1;
  const state: CompareState = Math.abs(diff) >= DIFF_PCT - 1e-9 ? (diff > 0 ? "above" : "below") : "match";
  return { state, base, invoicePerBase, appPerBase, diff };
}

const baseWord = (b: BaseUnit) => (b === "each" ? "each" : b === "L" ? "L" : "kg");

/** "$29.50 a pkt" */
export function perUnitPhrase(unitPriceEx: number, unitLabel: string): string {
  return `${money(unitPriceEx)} a ${unitLabel.toLowerCase()}`;
}

/** "So $29.50 a pkt is $11.80 per kg. The app has $11.80 per kg." */
export function comparisonSentence(c: Comparison, unitPriceEx: number | null | undefined, unitLabel: string): string {
  if (c.state === "no_invoice_price" || c.invoicePerBase == null || unitPriceEx == null) return "The invoice has no price to compare.";
  const per = baseWord(c.base);
  const head = `So ${perUnitPhrase(Number(unitPriceEx), unitLabel)} is ${money(c.invoicePerBase)} per ${per}.`;
  if (c.appPerBase == null) return `${head} The app has no price for this yet.`;
  return `${head} The app has ${money(c.appPerBase)} per ${per}.`;
}

/** "The invoice is 31% above the app. Check the pack size or the app price." Null when the prices agree or one side is missing. */
export function differenceNote(c: Comparison): string | null {
  if (c.diff == null || (c.state !== "above" && c.state !== "below")) return null;
  const pct = Math.round(Math.abs(c.diff) * 100);
  return `The invoice is ${pct}% ${c.state === "above" ? "above" : "below"} the app. Check the pack size or the app price.`;
}

/** The pack the number counts: "1 kg pack", "12 kg pack", "700 ml pack" (the app's own wording). */
export function packWords(ing: Pick<ConvIngredient, "pack_size" | "pack_unit">): string {
  return `${packLabel(Number(ing.pack_size), ing.pack_unit)} pack`;
}

/** "1 PKT = " (the words before the number) */
export function unitEquals(unitLabel: string): string {
  return `1 ${unitLabel} =`;
}

/** Parses what a person typed in the number box: 0.0001 to 10000, up to 4 decimals. Anything else is null. */
export function parsePacksText(text: string): number | null {
  const raw = text.trim();
  // a comma is a thousands separator only: "1,200" is 1200, "2,5" is not a number here
  if (raw.includes(",") && !/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)) return null;
  const t = raw.replace(/,/g, "");
  if (!/^\d+(\.\d{1,4})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= MAX_PACKS_PER_UNIT ? n : null;
}

/* ---------------------------------------------------------------- the amount in one invoice unit (what the person types) */

const NUM_TXT = "\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?";
const AMOUNT_RE = new RegExp(`^(${NUM_TXT})(?:\\s*[x×*]\\s*(${NUM_TXT}))?$`);
const AMOUNT_UNIT_RE = /\s*(kgs?|kilos?|gms?|gr|g|mls?|ltrs?|lt|litres?|liters?|l|ea|each)$/;
const MAX_AMOUNT = 100_000;

/** One typed number: thousands commas allowed, at most 4 decimals. */
function amountPart(raw: string): number | null {
  const t = raw.replace(/,/g, "");
  if (!/^\d+(\.\d{1,4})?$/.test(t)) return null;
  return Number(t);
}

/**
 * What a person types for "how much is in one invoice unit", in the ingredient's base unit (kg, L or each): `12`, `2.5`,
 * `6 x 2` (six bags of 2 kg), `12kg`, `500g` (0.5 kg), `3 x 250ml`. A unit word must match the base unit's dimension.
 * Returns the total in kg, L or each, or null when it cannot be read.
 */
export function parseAmountText(text: string, dim: BaseUnit): number | null {
  let t = text.trim().toLowerCase();
  if (!t) return null;
  let factor = 1;
  const um = t.match(AMOUNT_UNIT_RE);
  if (um) {
    const w = um[1];
    const unitDim: BaseUnit = w.startsWith("k") ? "kg" : w === "g" || w === "gr" || w.startsWith("gm") ? "kg" : w.startsWith("m") ? "L" : w === "ea" || w === "each" ? "each" : "L";
    if (unitDim !== dim) return null;
    if (w === "g" || w === "gr" || w.startsWith("gm") || w.startsWith("m")) factor = 0.001;
    t = t.slice(0, t.length - um[0].length);
  }
  const m = t.match(AMOUNT_RE);
  if (!m) return null;
  const a = amountPart(m[1]);
  const b = m[2] != null ? amountPart(m[2]) : 1;
  if (a == null || b == null) return null;
  const total = round4(a * b * factor);
  return total > 0 && total <= MAX_AMOUNT ? total : null;
}

/** "6 x 2" gives ["6", "2"]; anything else is null (used by the breakdown fields). */
export function splitProduct(text: string): [string, string] | null {
  const m = text.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)$/);
  return m ? [m[1], m[2]] : null;
}

/** "12 kg", "3 L", "24 each": an amount with its base unit. */
export function amountWords(amount: number, dim: BaseUnit): string {
  return `${plain(amount)} ${dim === "each" ? "each" : dim}`;
}

/* ---------------------------------------------------------------- the whole row, in one view */

export interface ConversionView {
  /** costing packs in one invoice unit (typed amount / the app's pack size, else derived), or null while it must be asked */
  packs: number | null;
  /** the amount in one invoice unit in the base unit (kg, L or each), or null while it must be asked */
  amount: number | null;
  /** the unit the amount is in */
  base: BaseUnit;
  /** the app's pack size in the base unit (0 when it has none) */
  packSize: number;
  /** what is in the box: an amount in the base unit, or a product such as "6 x 2" */
  boxText: string;
  /** the box holds something that cannot be used (typed rubbish, zero) */
  invalid: boolean;
  derivation: Derivation;
  unitLabel: string;
  comparison: Comparison | null;
  /** the sentence under the number */
  sentence: string | null;
  /** the amber note, when the prices disagree */
  note: string | null;
  /** nothing to ask and nothing to warn: show only "Sold per kg. Matches the app." */
  collapsed: boolean;
  /** why Save Matches holds this row back, in words; null when it is fine */
  blocker: string | null;
  /** one-tap amounts (in the base unit) offered while the row asks */
  quick: number[];
}

/** The amounts offered as one-tap buttons while a row asks: the best guess, the app's own pack, then any size the description states. */
export function quickAmounts(description: string | null | undefined, likely: number | null, packSize: number, dim: BaseUnit): number[] {
  const out: number[] = [];
  const add = (n: number | null | undefined) => {
    if (n != null && n > 0 && !out.some((o) => Math.abs(o - n) / Math.max(o, 1e-9) < 0.001)) out.push(round4(n));
  };
  add(likely);
  add(packSize);
  for (const c of parseSizes(description)) if (c.dim === dim) add(c.amount);
  return out.slice(0, 4);
}

/**
 * Everything the row shows. `typed` is what the person typed in the box: the AMOUNT in one invoice unit, in the ingredient's base
 * unit (kg, L or each), as a number or a product such as "6 x 2" (undefined = they have not touched it, so the amount worked out
 * from the invoice shows). The costing pack count is that amount divided by the app's pack size. A conversion is settled only
 * when `packs` is a real number.
 */
export function conversionView(input: {
  description: string | null | undefined;
  unit: string | null | undefined;
  unitPriceEx: number | null | undefined;
  ingredient: ConvIngredient;
  gstRate: number;
  typed?: string;
}): ConversionView {
  const derivation = deriveConversion({ description: input.description, unit: input.unit, ingredient: input.ingredient });
  const unitLabel = readUnit(input.unit, input.description).label;
  const base = baseUnitFor(input.ingredient.pack_unit) ?? "each";
  const packSize = packBaseSize(input.ingredient) ?? 0;
  const touched = input.typed !== undefined;
  const derivedAmount = derivation.unitSize?.amount ?? (derivation.packs != null && packSize > 0 ? round4(derivation.packs * packSize) : null);
  const boxText = touched ? input.typed! : derivedAmount != null && derivation.packs != null ? plain(derivedAmount) : "";
  let amount: number | null = null;
  let packs: number | null = null;
  if (touched) {
    amount = parseAmountText(input.typed!, base);
    if (amount != null && packSize > 0) {
      const p = round4(amount / packSize);
      packs = p > 0 && p <= MAX_PACKS_PER_UNIT ? p : null;
      if (packs == null) amount = null;
    } else amount = null;
  } else if (derivation.packs != null) {
    packs = derivation.packs;
    amount = derivedAmount;
  }
  const invalid = touched && input.typed!.trim() !== "" && packs == null;
  const comparison = packs != null ? compareToApp({ packs, unitPriceEx: input.unitPriceEx, ingredient: input.ingredient, gstRate: input.gstRate }) : null;
  const note = comparison ? differenceNote(comparison) : null;
  const sentence = packs != null && comparison ? comparisonSentence(comparison, input.unitPriceEx ?? null, unitLabel) : null;
  const trivial = !touched && derivation.trivial && !note;
  const ask = `Tell the app how many ${base === "each" ? "items" : base} are in one ${unitLabel}.`;
  const blocker = packs == null ? (invalid ? `That cannot be used. Type how many ${base === "each" ? "items" : base} are in one ${unitLabel}, like 12 or 6 x 2.` : ask) : null;
  return {
    packs,
    amount,
    base,
    packSize,
    boxText,
    invalid,
    derivation,
    unitLabel,
    comparison,
    sentence,
    note,
    collapsed: trivial,
    blocker,
    quick: packs == null ? quickAmounts(input.description, derivation.unitSize?.amount ?? null, packSize, base) : [],
  };
}

/** "Sold per kg. Matches the app." for the collapsed state. */
export function collapsedSentence(v: ConversionView): string {
  const base = v.comparison ? baseWord(v.comparison.base) : "unit";
  if (v.comparison?.state === "no_app_price") return `Sold per ${v.unitLabel.toLowerCase()}. The app has no price for this yet.`;
  if (v.comparison?.state === "no_invoice_price") return `Sold per ${v.unitLabel.toLowerCase()}.`;
  return `Per ${base}, matches the app.`;
}
