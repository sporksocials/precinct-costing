/**
 * Layer 1 of the name tidy: the instant, no-AI clean-up of a name a person typed (trim, collapse spaces, Title Case).
 * Pure. It never touches spelling: spelling suggestions are lib/name-vocab.ts (layer 2) and lib/name-check.ts (layer 3).
 *
 * `titleCase` used to live in lib/pos-list.ts; the POS list imports it from here so the app has one idea of Title Case.
 */

/** Small words stay lower case unless they open the name. */
export const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "vs", "with"]);

/** Units that stay lower case straight after a number: "150 ml glass". */
const UNITS = new Set(["ml", "cl", "l", "lt", "g", "kg", "mg", "oz", "lb"]);

/** Abbreviations that stay upper case when a whole shouted name is brought down to Title Case. */
const ACRONYMS = new Set([
  "BBQ", "IPA", "XPA", "XO", "VSOP", "XXXX", "KFC", "WMC", "GF", "DF", "VG", "VO", "GFO", "DFO", "UHT", "NZ", "USA", "UK", "AU", "MSG", "PBR", "EVOO", "BLT", "VB",
  "NV", "OJ", "DOC", "DOCG", "GSM", "SSB", "SBS", "SEM", "RTD", "POS", "GST",
]);

/** Brand names with one fixed spelling wherever they are typed: the venue is always "Chiobu", never ChioBu or CHIOBU (Troy, 9 Oct 2026). */
const BRAND_SPELLINGS: ReadonlyArray<readonly [RegExp, string]> = [[/\bchiobu(?=\b|['’])/gi, "Chiobu"]];

/** Puts every brand name into its fixed spelling. */
export function brandSpelling(text: string): string {
  return BRAND_SPELLINGS.reduce((acc, [re, spelled]) => acc.replace(re, spelled), text);
}

function capFirst(s: string): string {
  const m = s.match(/^([^\p{L}\p{N}]*)(\p{L})(.*)$/u);
  return m ? `${m[1]}${m[2].toUpperCase()}${m[3]}` : s;
}

/** "o'brien" -> "O'Brien": the letter after an O' opening. Nothing else with an apostrophe is touched. */
function capAfterIrishO(s: string): string {
  return s.replace(/^([^\p{L}]*)(O['’])(\p{Ll})(?=\p{L}{2})/u, (_m, pre: string, o: string, c: string) => `${pre}${o}${c.toUpperCase()}`);
}

/**
 * Title Case for item names: capitalise each word, keep small words ("and", "of") lower case unless first, and leave
 * any word that already has a capital in it alone ("WMC", "Heart & Soul", "McIntyre"). A hyphen or slash starts a new
 * capital ("Slow-Cooked", "Salt/Pepper"); a unit straight after a number stays lower case ("150 ml"). Spelling is
 * never touched.
 */
export function titleCase(name: string): string {
  const words = name.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  return words
    .map((w, wi) => {
      const prev = wi > 0 ? words[wi - 1] : "";
      if (wi > 0 && UNITS.has(w.toLowerCase()) && /^\d+(?:[.,]\d+)?$/.test(prev)) return w.toLowerCase();
      const parts = w.split(/([-/])/);
      return parts
        .map((part, pi) => {
          if (pi % 2 === 1 || !part) return part; // a separator, or nothing between two of them
          if (/\p{Lu}/u.test(part)) return part;
          const afterSlash = pi > 0 && parts[pi - 1] === "/";
          if (!(wi === 0 && pi === 0) && !afterSlash && SMALL_WORDS.has(part.toLowerCase())) return part;
          return capAfterIrishO(capFirst(part));
        })
        .join("");
    })
    .join(" ");
}

/** True for a name typed with caps lock on: every letter upper case and at least one real (non abbreviation) word of 4 letters or more. */
function isShouting(s: string): boolean {
  if (!/\p{L}/u.test(s) || s !== s.toUpperCase() || s === s.toLowerCase()) return false;
  return s.split(" ").some((w) => (w.match(/\p{L}/gu) ?? []).length >= 4 && !ACRONYMS.has(w.replace(/[^\p{L}]/gu, "")));
}

/**
 * The tidied name: surrounding and repeated spaces gone, then Title Case. A name typed entirely in capitals is brought
 * down first (keeping abbreviations such as BBQ and IPA). Running it twice gives the same answer.
 */
export function tidyName(raw: string): string {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (isShouting(s)) {
    return brandSpelling(
      titleCase(
        s
          .split(" ")
          .map((w) => (ACRONYMS.has(w.replace(/[^\p{L}]/gu, "")) ? w : w.toLowerCase()))
          .join(" "),
      ),
    );
  }
  return brandSpelling(titleCase(s));
}

/** True when the only difference between the two is spaces (so the screen can fix it quietly, without a toast). */
export function sameButSpacing(typed: string, tidied: string): boolean {
  return typed.replace(/\s+/g, " ").trim() === tidied;
}
