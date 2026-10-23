/**
 * Invoice names and small text helpers: the description key used by the learning table, supplier name and ABN normalisers,
 * fuzzy word overlap (suggestions only, never a match), and the plain-words formatters every invoice prompt shares.
 * Pure, no store, no clock.
 */

const stripMarks = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "");

/**
 * The description key stored in `invoice_item_map.desc_key`: lower case, letters and digits only, one space between words.
 * "Lychee Liqueur 700 ml - Bottle" and "LYCHEE LIQUEUR 700ml BOTTLE" give the same key. Decimal points between digits survive
 * ("2.5kg"), and a size written with a space ("700 ml") is joined to its unit so a scan that splits it still matches.
 */
export function descKey(description: string | null | undefined): string {
  let s = stripMarks(String(description ?? "")).toLowerCase();
  s = s.replace(/['\u2019`]/g, "").replace(/&/g, " and ");
  s = s.replace(/(\d)\s+(ml|cl|l|lt|ltr|litre|litres|g|kg)\b/g, "$1$2");
  s = s.replace(/(\d)(ltr|lt|litres|litre)\b/g, "$1l");
  s = s.replace(/(\d)\.(\d)/g, "$1§$2"); // protect decimal points
  s = s.replace(/[^a-z0-9§]+/g, " ");
  return s.replace(/§/g, ".").replace(/\s+/g, " ").trim();
}

/** A supplier item code made comparable: trimmed, upper case, inner spaces removed. Null when nothing is left. */
export function normCode(code: string | null | undefined): string | null {
  const s = String(code ?? "").replace(/\s+/g, "").toUpperCase();
  return s === "" ? null : s;
}

/** An ABN as its 11 digits, or null when the text does not hold exactly 11 digits. */
export function abnDigits(abn: string | null | undefined): string | null {
  const d = String(abn ?? "").replace(/\D+/g, "");
  return d.length === 11 ? d : null;
}

const COMPANY_WORDS = new Set(["pty", "ltd", "limited", "proprietary", "inc", "incorporated"]);
const TRADING_AS = /\s*(?:\btrading\s+as\b|\bt\/as\b|\bt\/a\b|\bformerly\b|\bt\s+as\b)\s*/i;

/** One name part as a comparable key: lower case, "&" as "and", punctuation gone, Pty and Ltd words dropped. */
function nameKey(part: string): string {
  const words = stripMarks(part)
    .toLowerCase()
    .replace(/['\u2019`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w !== "" && !COMPANY_WORDS.has(w));
  return words.join(" ");
}

/**
 * The comparable keys of a supplier name. "CD Australia Pty Ltd trading as Diablo Co" gives both "cd australia" and
 * "diablo co", so an invoice that prints either one matches a supplier saved under the other as an alias.
 */
export function supplierNameKeys(name: string | null | undefined): string[] {
  const keys = String(name ?? "")
    .split(TRADING_AS)
    .map(nameKey)
    .filter((k) => k !== "");
  return Array.from(new Set(keys));
}

/** True when two names share at least one comparable key. */
export function sameSupplierName(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = supplierNameKeys(a);
  const kb = new Set(supplierNameKeys(b));
  return ka.some((k) => kb.has(k));
}

/** An invoice number made comparable for duplicate checks: trimmed, upper case, no spaces, no leading "#". */
export function normInvoiceNumber(n: string | null | undefined): string | null {
  const s = String(n ?? "").replace(/\s+/g, "").replace(/^#+/, "").toUpperCase();
  return s === "" ? null : s;
}

// ---------------------------------------------------------------- fuzzy suggestions (never a match)
const STOP = new Set(["and", "the", "of", "per", "with", "for", "a", "an", "to", "in", "on"]);

/** Words of a description for fuzzy comparison: the key's words, stop words out, a plural "s" folded away. */
export function nameTokens(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const w of descKey(text).split(" ")) {
    if (w.length < 2 || STOP.has(w)) continue;
    out.push(w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
  }
  return Array.from(new Set(out));
}

/** 0 to 1: shared words over the geometric mean of the two word counts. Needs at least one shared non-numeric word to score. */
export function tokenOverlap(a: string | null | undefined, b: string | null | undefined): number {
  const ta = nameTokens(a);
  const tb = new Set(nameTokens(b));
  if (ta.length === 0 || tb.size === 0) return 0;
  const shared = ta.filter((t) => tb.has(t));
  if (!shared.some((t) => /[a-z]/.test(t) && !/^\d+(?:\.\d+)?(?:ml|cl|l|g|kg)?$/.test(t))) return 0;
  return shared.length / Math.sqrt(ta.length * tb.size);
}

// ---------------------------------------------------------------- words and numbers for prompts
/** People read these; no em or en dashes, ever (scans can carry them). */
export function plain(text: string | null | undefined): string {
  return String(text ?? "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** "$1,234.50", "-$16.45". Two decimals, for sentences only; calculations never use this. */
export function dollars(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "unknown";
  const v = Number(n);
  const [whole, frac] = Math.abs(v).toFixed(2).split(".");
  return `${v < 0 ? "-" : ""}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

/** A quantity without trailing zeros: 2.39, 1.85, 12. */
export function qtyText(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "?";
  return String(Number(Number(n).toFixed(4)));
}

/** A percentage of a fraction, one decimal: 0.0623 gives "6.2%". */
export function pctText(fraction: number): string {
  return `${(Math.abs(fraction) * 100).toFixed(1)}%`;
}

/** The limit as a person says it: 0.05 gives "5%", 0.025 gives "2.5%". */
export function limitText(fraction: number): string {
  return `${Number((fraction * 100).toFixed(2))}%`;
}

/** A line's description tidied for a sentence: trailing "per kg" style words dropped, shouting turned into words. */
export function tidyLabel(description: string | null | undefined, max = 60): string {
  let s = plain(description).replace(/\s+(?:per|p\/)\s*(?:kg|ea|each|ctn|carton|l|lt|ltr|litre|bottle|btl|pkt|pack)\.?$/i, "");
  if (s !== "" && s === s.toUpperCase() && /[A-Z]/.test(s)) {
    s = s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  }
  if (s.length > max) s = `${s.slice(0, max - 3).trimEnd()}...`;
  return s === "" ? "This line" : s;
}

/** Round to 4 decimal places: the precision every stored money and quantity value uses. Never 2 dp inside a calculation. */
export const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** Round to 6 decimal places (for fractions such as change_pct). */
export const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
