/**
 * Match Items: "use the invoice name" (Troy, 25 Oct 2026: "if we DO match an item to the app, we should take on the invoice
 * name and not leave the original name we put in there"). The printed description is tidied into the app's own naming style
 * and offered as the ingredient's new name. Pure: no store, no database. Nothing here renames anything; the screen asks first.
 *
 * The style comes from real names in the app: Title Case, a trailing size in brackets ("Almond Croquant (2.5kg)",
 * "Licor 43 (700ml)", "Coconut Cream Flavour (box 5x1kg)"), a brand in brackets when the invoice prints one.
 */
import { tidyName, titleCase } from "./name-tidy";
import { describedSize, stripSizes } from "./invoice-conversion";
import { findClash, clashMessage, nameKey } from "./rename";

export const MAX_NAME = 80;

/** Words printed at the END of a description that name the container or the sale unit, not the product. */
const TRAILING = new Set([
  "pkt", "pkts", "ctn", "ea", "each", "btl", "bottle", "jar", "bag", "box", "tub", "tin", "can", "punnet", "bucket", "block", "tetra", "case",
  "carton", "kg", "kgs", "slv", "squeezie", "unit",
]);

/** Small words that cannot end a name. */
const DANGLING = new Set(["in", "of", "and", "with", "for", "the", "a", "an", "to", "on", "&"]);

/** Short bracket words that are supplier codes or packaging, never a brand (NTC, GB, TAN, LAM, DOZEN, TETRA). */
const BRACKET_NOISE = new Set(["dozen", "tetra", "bucket", "carton", "case", "each", "unit", "units", "pack", "bulk", "frz", "frozen", "fresh", "aust", "lab", "label", "green", "red", "inch"]);

/** Bidfood's house-label tags: "CATERERS C", "CATERERS CHOICE". They say whose label it is, not what it is. */
const HOUSE_TAGS = /\bcaterers\s+c(?:hoice)?\b/gi;

const KEEP_UPPER = new Set(["bbq", "uht", "ipa", "xo", "vsop", "gf", "df", "vg", "nz", "usa", "uk", "msg", "iqf"]);

/** A shouted word comes down to lower case so Title Case can finish it; abbreviations stay. */
function calm(word: string): string {
  const letters = word.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2 || letters !== letters.toUpperCase()) return word;
  if (KEEP_UPPER.has(letters.toLowerCase())) return word;
  return word.toLowerCase();
}

/** Title Case, then the small repairs a shouted scan needs: "Mccain" is McCain, "G/Free" is Gluten Free. */
function polish(text: string): string {
  const calmed = text
    .split(" ")
    .map(calm)
    .join(" ")
    .replace(/\bg\/free\b/gi, "gluten free")
    .replace(/\bfrz\b/gi, "frozen");
  return titleCase(calmed)
    .replace(/\bMc([a-z])(?=[a-z]{2})/g, (_m, c: string) => `Mc${c.toUpperCase()}`)
    .replace(/(\bGluten Free\b)(.*)\bGluten Free\b/, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

const words = (s: string) => s.split(" ").filter(Boolean);

/**
 * The tidied invoice name. `size` is the text to put in the trailing brackets ("2.5kg", "6 x 2kg") or null for none; the caller
 * decides, because a size only belongs in the name when it is the app's pack (see `nameSizeFor`). Brand brackets are kept,
 * sizes inside brackets are lifted out, supplier codes and container words are dropped. Never longer than MAX_NAME: the product
 * words are cut at a word boundary, the brand and size stay.
 */
export function tidyInvoiceName(description: string | null | undefined, size: string | null = null): string {
  let text = String(description ?? "")
    .replace(/[\u2013\u2014]/g, " - ")
    .replace(/\([^)]*$/, " ") // a bracket the scan never closed
    .replace(HOUSE_TAGS, " ");
  const brands: string[] = [];
  text = text.replace(/\(([^)]*)\)/g, (_m, inner: string) => {
    const rest = stripSizes(inner).replace(/[^A-Za-z0-9&' ]+/g, " ").replace(/\s+/g, " ").trim();
    const ws = words(rest);
    const real = ws.some((w) => w.replace(/[^A-Za-z]/g, "").length >= 4 && !BRACKET_NOISE.has(w.toLowerCase()));
    if (real && !ws.some((w) => BRACKET_NOISE.has(w.toLowerCase()))) brands.push(rest);
    return " ";
  });
  text = stripSizes(text)
    .replace(/[~*]+/g, " ")
    .replace(/\s+[-]+\s+/g, " ")
    .replace(/(^|\s)-+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let ws = words(text);
  // a bare item number on the end ("- 40174", "- 01243") is the supplier's, not part of the name
  while (ws.length > 1 && /^\d{4,}$/.test(ws[ws.length - 1])) ws.pop();
  // container words on the end go, and so does any "in" or "of" they leave dangling ("BAG IN BOX" is not a product name)
  const last = () => ws[ws.length - 1].toLowerCase().replace(/[^a-z]/g, "");
  while (ws.length > 1 && (TRAILING.has(last()) || DANGLING.has(last()))) ws.pop();
  ws = ws.filter((w, i) => !(i > 0 && w.toLowerCase() === ws[i - 1].toLowerCase()));

  const tail = [...dedupe(brands.map(polish)).map((b) => ` (${b})`), size ? ` (${size})` : ""].join("");
  let body = polish(ws.join(" "));
  if (body.length + tail.length > MAX_NAME) {
    const kept: string[] = [];
    for (const w of words(body)) {
      if ([...kept, w].join(" ").length + tail.length > MAX_NAME) break;
      kept.push(w);
    }
    body = kept.join(" ") || body.slice(0, Math.max(1, MAX_NAME - tail.length));
  }
  const out = `${body}${tail}`.trim();
  return out.length > MAX_NAME ? out.slice(0, MAX_NAME).trim() : out;
}

function dedupe(xs: string[]): string[] {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(nameKey(x)) ? false : (seen.add(nameKey(x)), true)));
}

/**
 * The size that goes in the name. The app's ingredient is priced per ITS pack, so the invoice's size belongs in the name only
 * when one invoice unit is one app pack (packs within 1% of 1). A 2.5 kg packet against a 1 kg app pack names no size: the app
 * prices that one per kg.
 */
export function nameSizeFor(description: string | null | undefined, packs: number | null): string | null {
  if (packs == null || Math.abs(packs - 1) > 0.01) return null;
  return describedSize(description);
}

/** The name a typed name becomes: spaces and Title Case tidied, the "6 x 2kg" of a case kept lower case. */
export function finalName(text: string): string {
  return tidyName(text).replace(/(\d) X (\d)/g, "$1 x $2");
}

/** The first three product words of an invoice name, lower case, letters and digits only. */
export function leadWords(name: string): string[] {
  const body = name.replace(/\([^)]*\)/g, " ");
  const ws = body
    .toLowerCase()
    .replace(/[^a-z0-9&' ]+/g, " ")
    .split(" ")
    .filter(Boolean);
  return ws.slice(0, 3);
}

/** True when the ingredient's current name already carries the invoice's first three words: it was named from an invoice already. */
export function carriesInvoiceName(currentName: string, invoiceName: string): boolean {
  const lead = leadWords(invoiceName);
  if (lead.length === 0) return false;
  const have = new Set(
    currentName
      .toLowerCase()
      .replace(/[^a-z0-9&' ]+/g, " ")
      .split(" ")
      .filter(Boolean),
  );
  return lead.every((w) => have.has(w));
}

export type RenameKind = "same" | "clash" | "rename";

export interface RenameChoice {
  kind: RenameKind;
  /** the toggle starts on (rename) or off (keep the current name) */
  rename: boolean;
  /** a plain sentence for the row: why it is off, or what is wrong */
  note: string | null;
}

/**
 * What the "Keep Current Name" toggle starts as for a row (Troy asked for the rename, so on is the default).
 *  - the tidied name is the ingredient's name already: nothing to do
 *  - another ingredient already has that name: keep, and say so
 *  - another row on this screen is already renaming this ingredient: keep
 *  - the ingredient already carries an invoice name AND other suppliers' items point at it: keep (the first supplier names it)
 */
export function renameDefault(input: {
  ingredientId: string;
  currentName: string;
  newName: string;
  ingredients: readonly { id: string; name: string }[];
  /** how many OTHER active suppliers have an item matched to this ingredient */
  otherSuppliers: number;
  /** another row in this batch already renames this ingredient */
  takenInBatch: boolean;
}): RenameChoice {
  const { currentName, newName } = input;
  if (!newName.trim() || nameKey(currentName) === nameKey(newName)) return { kind: "same", rename: false, note: "The app already uses this name." };
  const clash = findClash(newName, input.ingredients, input.ingredientId);
  if (clash) return { kind: "clash", rename: false, note: clashMessage("ingredient", clash) };
  if (input.takenInBatch) return { kind: "rename", rename: false, note: "Another item on this list is already renaming this ingredient." };
  if (input.otherSuppliers > 0 && carriesInvoiceName(currentName, newName)) {
    return { kind: "rename", rename: false, note: "Another supplier's item is matched to this ingredient, so its name stays." };
  }
  return { kind: "rename", rename: true, note: null };
}

/** The check made again on the name the person typed. A blank name or a clash is refused in plain words; null means fine. */
export function nameProblem(name: string, ingredientId: string, currentName: string, ingredients: readonly { id: string; name: string }[]): string | null {
  const t = name.replace(/\s+/g, " ").trim();
  if (!t) return "Type a name, or switch on Keep Current Name.";
  if (t.length > MAX_NAME) return `Keep the name to ${MAX_NAME} characters or fewer.`;
  if (nameKey(t) === nameKey(currentName)) return null;
  const clash = findClash(t, ingredients, ingredientId);
  return clash ? clashMessage("ingredient", clash) : null;
}
