/**
 * Invoice line suggestions: which ingredient in the app is this invoice line? Pure (no store, no database, no clock).
 *
 * A supplier prints "POTATO WEDGES SEASONED (MCCAIN) 2kg"; the app calls it "Wedges". This file tidies the printed description
 * (pack sizes, brand in brackets, supplier shorthand such as NAS and PET are dropped), scores it against every ingredient name
 * and returns the best few. It only ever SUGGESTS: nothing here matches, ignores or applies anything. The review screen shows
 * a suggestion as "Suggested" until a person accepts it, and the engine never matches on a name alone.
 *
 * How the score works (0 to 1): words that few ingredients use count for more ("wedge" beats "potato"); an ingredient is
 * only as good as how much of ITS name the line explains; a brand in brackets that matches adds a little; a price that agrees
 * (same pack price, or the same price per kg or L) adds a little more, but only when the words already agree. An exact supplier
 * code is a score of 1.
 *
 * Known weak spots (checked on the first real Bidfood invoice, 25 Oct 2026): a tinned or processed form of something the app
 * keeps fresh ("PINEAPPLE PIECES IN JUICE" scores "Pineapple" well, but it is a different product) and any item the app does not
 * stock at all. The AI pass (lib/invoice-suggest-ai.ts) is there for those; a person always has the last word.
 */
import { parsePackFromUom } from "./costing";

export interface SuggestIngredient {
  id: string;
  name: string;
  supplier_code?: string | null;
  pack_size?: number | string | null;
  pack_unit?: string | null;
  pack_price?: number | string | null;
  price_inc_gst?: boolean | null;
  active?: boolean;
}

export interface SuggestLine {
  description: string;
  item_code?: string | null;
  unit?: string | null;
  unit_price_ex?: number | string | null;
}

export interface Candidate {
  ingredientId: string;
  /** 0 to 1 */
  score: number;
  /** a short plain reason, for a tooltip or a log */
  why: string;
}

/** A suggestion at or above this is shown in the picker ready to accept; below it the list is offered without a pre-set pick. */
export const PRESET_SCORE = 0.65;
/** Anything lower than this is not worth listing. */
export const MIN_SCORE = 0.25;

const GST = 0.1;

/* ---------------------------------------------------------------- tidying the printed description */

/** Shorthand and filler that carry no product meaning ("NAS" is no added sugar, "PET" the bottle). */
const NOISE = new Set([
  "nas", "pet", "ultrafast", "flushed", "gas", "pkt", "ctn", "ea", "each", "approx", "avg", "aust", "australian", "imported", "grade",
  "brand", "select", "pure", "premium", "natural", "bulk", "catering", "food", "service", "foodservice", "pack", "bag", "box", "carton",
  "and", "the", "of", "with", "for", "in", "a", "an", "to", "per", "x", "s",
]);

/** Words naming the FORM of a product. A line that has one the ingredient lacks is probably a different product. */
const FORMS = new Set(["ground", "powder", "juice", "syrup", "paste", "sauce", "puree", "flake", "shred", "shredded", "fillet", "mince", "minced", "cream", "oil", "vinegar", "flour"]);
/** Forms that mean the product was processed or packed (a tin of pieces is not the fresh fruit); they count against an ingredient more. */
const STRONG_FORMS = new Set(["piece", "slice", "dice", "diced", "crushed", "dried", "frozen", "canned", "tin"]);

/** Different words for one thing. The left side becomes the right side before any scoring. */
const SYNONYMS: Record<string, string> = { mayonnaise: "mayo", fry: "chip", fries: "chip", chips: "chip", roll: "bun", lt: "l", ltr: "l", litre: "l", gr: "g", gm: "g" };

/** Packing mediums: "IN JUICE", "IN SYRUP" say how a tin is packed, not what is in it. */
const MEDIUM = /\bin\s+(?:natural\s+|spring\s+)?(?:juice|syrup|brine|oil|water|vinegar)\b/gi;

/** A word folded to one form: lower case, plural gone, synonyms joined. */
export function foldWord(raw: string): string {
  let w = raw.toLowerCase();
  if (SYNONYMS[w]) return SYNONYMS[w];
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && w.endsWith("oes")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return SYNONYMS[w] ?? w;
}

const SIZE_PATTERNS: RegExp[] = [
  /\b\d+(?:\.\d+)?\s*x\s*\d+(?:\.\d+)?\s*(?:kg|gr|gm|g|ml|ltr|lt|l)\b/gi, // 6x2kg, 40x85gr
  /\b\d+(?:\.\d+)?\s*(?:kg|gr|gm|g|ml|ltr|lt|l|cl)\b/gi, // 2kg, 500gr, 2lt
  /\b\d+\s*'?s\b/gi, // 30'S
  /\b\d+(?:\.\d+)?\s*%/g, // 100%
  /\b\d+(?:\.\d+)?\s*(?:mm|cm|pk|pc|pcs)\b/gi, // 10MM
];

export interface ParsedDescription {
  /** the meaningful words, folded, in the order printed */
  words: string[];
  /** the meaningful words as printed (lower case, not folded), for building a name */
  plainWords: string[];
  /** words from the brackets (usually the brand), folded */
  brand: string[];
  /** what one unit holds, when the description says ("6x2kg" gives 12 kg) */
  pack: { size: number; unit: "kg" | "L" | "each" } | null;
}

/** Splits a printed description into its product words, its brand and its pack size. */
export function parseDescription(description: string | null | undefined): ParsedDescription {
  const raw = String(description ?? "").replace(/[\u2013\u2014]/g, " ");
  const brandText: string[] = [];
  let main = raw.replace(/\(([^)]*)\)/g, (_m, inner: string) => {
    brandText.push(inner);
    return " ";
  });
  const parsed = parsePackFromUom(main);
  const pack = parsed ? { size: parsed.pack_size, unit: parsed.pack_unit as "kg" | "L" | "each" } : null;
  main = main.replace(MEDIUM, " ");
  for (const re of SIZE_PATTERNS) main = main.replace(re, " ");
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/['’`]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length >= 2 && !/^\d+$/.test(w));
  const plainWords = clean(main).filter((w) => !NOISE.has(w));
  const words = unique(plainWords.map(foldWord).filter((w) => !NOISE.has(w)));
  const brand = unique(brandText.flatMap(clean).map(foldWord).filter((w) => !NOISE.has(w)));
  return { words, plainWords, brand, pack };
}

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

/* ---------------------------------------------------------------- the ingredient index */

interface IndexedIngredient {
  ing: SuggestIngredient;
  /** words of the name outside brackets */
  core: string[];
  /** words inside brackets (a brand, or a translation such as "Ananas N (Pineapple)") */
  secondary: string[];
  code: string | null;
  basePrice: number | null;
  baseFamily: "mass" | "each" | null;
  packPrice: number | null;
}

const normCode = (c: string | null | undefined): string | null => {
  const s = String(c ?? "").replace(/\s+/g, "").toUpperCase();
  return s === "" ? null : s;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

function indexIngredient(ing: SuggestIngredient): IndexedIngredient {
  const p = parseDescription(ing.name);
  // "Kewpie Mayo (L)" and "Onion (Each)" put a unit word in brackets: that is a size, not a brand
  const secondary = p.brand.filter((w) => !["l", "each", "portion", "kg", "g", "ml"].includes(w));
  const size = num(ing.pack_size);
  const price = num(ing.pack_price);
  const ex = price == null ? null : ing.price_inc_gst ? price / (1 + GST) : price;
  const unit = String(ing.pack_unit ?? "").toLowerCase();
  const family = unit === "kg" || unit === "l" ? "mass" : unit === "each" ? "each" : null;
  return {
    ing,
    core: p.words,
    secondary,
    code: normCode(ing.supplier_code),
    basePrice: ex != null && size != null && size > 0 ? ex / size : null,
    baseFamily: family,
    packPrice: ex,
  };
}

export interface Suggester {
  suggest(line: SuggestLine, limit?: number): Candidate[];
}

/** Builds the scorer once for a list of ingredients (about a thousand takes a few milliseconds). Inactive ingredients are left out. */
export function buildSuggester(ingredients: readonly SuggestIngredient[]): Suggester {
  const items = ingredients.filter((i) => i.active !== false).map(indexIngredient);
  const df = new Map<string, number>();
  for (const it of items) for (const w of new Set(it.core)) df.set(w, (df.get(w) ?? 0) + 1);
  const n = Math.max(1, items.length);
  const idf = (w: string): number => Math.log(1 + n / (1 + (df.get(w) ?? 0)));
  const idfMax = Math.log(1 + n);
  // a word no ingredient uses ("ajico", "seasoned") says little: a small weight so it does not drown the words that do
  const qWeight = (w: string): number => ((df.get(w) ?? 0) > 0 ? idf(w) : idfMax * 0.25);

  function priceBonus(line: SuggestLine, p: ParsedDescription, it: IndexedIngredient): { bonus: number; why: string | null } {
    const price = num(line.unit_price_ex);
    if (price == null || !(price > 0)) return { bonus: 0, why: null };
    let best = 0;
    let why: string | null = null;
    if (it.packPrice != null && it.packPrice > 0 && Math.abs(price / it.packPrice - 1) <= 0.005) {
      best = 0.15;
      why = "same pack price";
    }
    // per kg or per L: the line's size (or the KG/L it is sold by) against the ingredient's pack
    const sold = String(line.unit ?? "").trim().toLowerCase();
    let lineBase: number | null = null;
    if (sold === "kg" || sold === "l" || sold === "lt") lineBase = price;
    else if (p.pack && p.pack.unit !== "each" && p.pack.size > 0) lineBase = price / p.pack.size;
    if (lineBase != null && it.basePrice != null && it.baseFamily === "mass" && it.basePrice > 0) {
      const off = Math.abs(lineBase / it.basePrice - 1);
      const b = off <= 0.03 ? 0.12 : off <= 0.1 ? 0.05 : 0;
      if (b > best) {
        best = b;
        why = off <= 0.03 ? "same price per kg or L" : "similar price per kg or L";
      }
    }
    return { bonus: best, why };
  }

  return {
    suggest(line, limit = 5) {
      const code = normCode(line.item_code);
      const p = parseDescription(line.description);
      const unit = String(line.unit ?? "").trim().toLowerCase();
      // a line sold by the CAN or TIN is packed that way, whatever its words say
      const q = unit === "can" || unit === "tin" ? unique([...p.words, "canned"]) : p.words;
      const out: Candidate[] = [];
      const rank = new Map<string, number>();
      for (const it of items) {
        if (code && it.code && it.code === code) {
          out.push({ ingredientId: it.ing.id, score: 1, why: "same supplier code" });
          continue;
        }
        if (!q.length || !it.core.length) continue;
        const iCore = new Set(it.core);
        const iAll = new Set([...it.core, ...it.secondary]);
        const shared = q.filter((w) => iCore.has(w));
        // a word in the ingredient's brackets counts half ("Ananas N (Pineapple)")
        const sharedSecondary = q.filter((w) => !iCore.has(w) && it.secondary.includes(w));
        let s = shared.reduce((a, w) => a + idf(w), 0) + sharedSecondary.reduce((a, w) => a + idf(w) * 0.5, 0);
        if (s <= 0) continue;
        const wi = it.core.reduce((a, w) => a + idf(w), 0) || 1;
        const wq = q.reduce((a, w) => a + qWeight(w), 0) || 1;
        s = Math.min(s, wi);
        let score = (s / wi) * (0.55 + 0.45 * Math.min(1, s / wq));
        // forms ("piece", "paste", "juice") the line has and the ingredient does not
        const missing = q.filter((w) => !iAll.has(w));
        const penalty = missing.filter((w) => STRONG_FORMS.has(w)).length * 0.2 + missing.filter((w) => FORMS.has(w)).length * 0.12;
        score -= Math.min(0.36, penalty);
        const reasons: string[] = [`shares ${[...shared, ...sharedSecondary].join(", ")}`];
        if (score >= 0.3) {
          const brandHit = p.brand.some((b) => b.length >= 3 && [...iAll].some((w) => w.length >= 3 && (w.startsWith(b) || b.startsWith(w))));
          if (brandHit) {
            score += 0.1;
            reasons.push("same brand");
          }
          const pb = priceBonus(line, p, it);
          if (pb.bonus > 0 && pb.why) {
            score += pb.bonus;
            reasons.push(pb.why);
          }
        }
        // the shown score stops short of 1 (only an exact code is certain), but the order keeps the difference a price made
        rank.set(it.ing.id, score);
        score = Math.max(0, Math.min(0.99, score));
        if (score >= MIN_SCORE) out.push({ ingredientId: it.ing.id, score: Math.round(score * 1000) / 1000, why: reasons.join("; ") });
      }
      const names = new Map(items.map((it) => [it.ing.id, it.ing.name.length]));
      const r = (c: Candidate) => rank.get(c.ingredientId) ?? c.score;
      return out.sort((a, b) => b.score - a.score || r(b) - r(a) || (names.get(a.ingredientId) ?? 0) - (names.get(b.ingredientId) ?? 0)).slice(0, limit);
    },
  };
}

/** The best candidate when it is strong enough to pre-set, else null. */
export function presetSuggestion(candidates: readonly Candidate[]): Candidate | null {
  const top = candidates[0];
  return top && top.score >= PRESET_SCORE ? top : null;
}

/* ---------------------------------------------------------------- a tidy name for a new ingredient */

/** "POTATO WEDGES SEASONED (MCCAIN) 2kg" gives "Potato Wedges Seasoned": no code, no size, no brand, no supplier shorthand. */
export function tidyIngredientName(description: string | null | undefined): string {
  const p = parseDescription(description);
  const words = p.plainWords.filter((w) => !["and", "the"].includes(w) || p.plainWords.length < 3);
  const name = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ").trim();
  if (name) return name;
  const fallback = String(description ?? "").replace(/\s+/g, " ").trim();
  return fallback.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
