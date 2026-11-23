/**
 * Stopping the same product being entered twice (Troy, 23 Nov 2026: "Lime Juice (L)", "Lime Juice (2L)" and a PFD "Lime Juice" were
 * one product entered three times, which split its cost, supplier and order lists). Pure rules, no React, no database.
 *
 * The exact-name rule (lib/rename.ts `findClash`: an ingredient name is unique across the app) only catches the identical name. This
 * catches the SAME PRODUCT under a different size or spelling, and only ever warns: the New Ingredient sheet shows the look-alikes
 * with "Use It" and "Add Anyway", and never blocks the form.
 */

/**
 * A size or unit of measure in brackets: "(2L)", "(700ml)", "(Each)", "(L)", "(kg)", "(3kg)", "(6 x 2kg)". Any other bracket stays,
 * because it names a different product: "Chicken (Thigh)", "Great Northern (Keg)", "Coke (Can)".
 */
const SIZE_BRACKET = /\(\s*(?:\d+(?:[.,]\d+)?\s*(?:x\s*\d+(?:[.,]\d+)?\s*)?)?(?:ml|mls|l|lt|ltr|litres?|liters?|g|gm|gms|grams?|kg|kgs|kilos?|each|ea)\s*\)/gi;

/**
 * What two names of the same product share: lower case, any size in brackets taken out, "&" read as "and", accents dropped, then
 * everything that is not a letter or a digit removed. "Lime Juice (2L)", "lime  juice" and "Lime-Juice (L)" are all "limejuice".
 */
export function duplicateKey(name: string): string {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(SIZE_BRACKET, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "");
}

/** A key shorter than this is never matched as the START of another (so "Lime" does not flag "Lime Juice", or "Salt" "Salted Butter"). */
export const PREFIX_MIN_KEY = 6;
/** A typed name needs this many letters before anything is suggested. */
export const MIN_LETTERS = 3;
export const SIMILAR_LIMIT = 3;

export interface SimilarCandidate {
  id: string;
  name: string;
  active?: boolean | null;
}

export interface SimilarOptions {
  /** how many to return (default 3) */
  limit?: number;
  /** how many recipes use an ingredient, when the caller has it to hand: the most used look-alike is listed first */
  usage?: (id: string) => number;
  /** the record being edited, which never matches itself */
  selfId?: string | null;
}

/**
 * ACTIVE ingredients that look like the same product as the typed name: the same key, or (when both keys have 6 or more characters)
 * one key starts with the other. Same-key matches first, then the most used, then A to Z. Nothing for an empty name or one with
 * fewer than three letters. An inactive ingredient (including one that was merged away) is never suggested.
 */
export function findSimilarIngredients<T extends SimilarCandidate>(name: string, ingredients: readonly T[], opts: SimilarOptions = {}): T[] {
  const key = duplicateKey(name);
  if (key.replace(/[^a-z]/g, "").length < MIN_LETTERS) return [];
  const limit = Math.max(0, opts.limit ?? SIMILAR_LIMIT);
  const hits: { ing: T; exact: boolean; used: number }[] = [];
  for (const ing of ingredients) {
    if (ing.active === false) continue;
    if (opts.selfId && ing.id === opts.selfId) continue;
    const k = duplicateKey(ing.name);
    if (!k) continue;
    const exact = k === key;
    const prefix = !exact && Math.min(k.length, key.length) >= PREFIX_MIN_KEY && (k.startsWith(key) || key.startsWith(k));
    if (!exact && !prefix) continue;
    hits.push({ ing, exact, used: opts.usage ? opts.usage(ing.id) || 0 : 0 });
  }
  hits.sort((a, b) => Number(b.exact) - Number(a.exact) || b.used - a.used || a.ing.name.localeCompare(b.ing.name, "en-AU", { sensitivity: "base" }));
  return hits.slice(0, limit).map((h) => h.ing);
}

/** "Lime Juice (2L) already exists." */
export const alreadyExistsText = (name: string): string => `${name} already exists.`;
