/**
 * House wording rules for a drink's method and garnish (Troy, 9 Oct 2026). Pure and applied when a drink is SAVED in the
 * recipe editor, so every route in (typing, a research note, the step tidy) ends up the same:
 *   1 A lime wheel is always a dehydrated lime wheel ("Lime wheel" becomes "Dehydrated lime wheel").
 *   2 "Fine strain" is always "double strain" (Troy, 9 Oct 2026).
 *   3 A toothpick is always a cocktail skewer (Troy, 9 Oct 2026).
 *   4 Any rim (salt, chilli salt, coconut, sugar, cinnamon sugar, anything) always says, right after the rim step, to wipe
 *     the inside of the glass rim so there is none of it on the inside (Troy, 9 Oct 2026: "we always wipe the inside").
 *   5 A garnish never says to smack mint (a garnish mint leaf is left as it is). Troy, 9 Oct 2026.
 *   6 A shake for 12 seconds always adds ", or until the shaker is frosted", and "shake hard" with no time is that same
 *     12 second shake. Troy, 9 Oct 2026. WHICH drinks say "hard" is a recipe decision, not a rule here: only a drink with a
 *     foamy top (aqua faba or aqua fibre sours, the espresso martinis) says "Shake hard for 12 seconds, or until the shaker is
 *     frosted"; every other shake says "Shake for 12 seconds, or until the shaker is frosted".
 *   7 Drift and Chiobu: a drink in a coupe glass is pre-chilled (the method starts "Chill the coupe glass"). Troy, 9 Oct 2026.
 *   9 A rim is wet on the lime juice sponge, then dipped: "Wet the rim on the lime juice sponge, then dip it in salt". Troy, 9 Oct 2026, all venues.
 *   8 The venue is always spelled "Chiobu" (never ChioBu or CHIOBU) in method and garnish text, and in names via lib/name-tidy.ts. Troy, 9 Oct 2026.
 * The rules only add or reword; they never remove a step and never touch an item that already follows them.
 */

import { brandSpelling } from "@/lib/name-tidy";

const LIME_WHEEL = /\b(fresh\s+)?(dehydrated\s+)?(lime\s+wheels?)\b/gi;

/** "Lime wheel" gives "Dehydrated lime wheel", "2 lime wheels" gives "2 dehydrated lime wheels"; already dehydrated is left alone. */
export function dehydrateLimeWheels(text: string): string {
  return text.replace(LIME_WHEEL, (match, _fresh: string | undefined, dehydrated: string | undefined, wheel: string) => {
    if (dehydrated) return match;
    const startsCapital = match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase();
    return `${startsCapital ? "Dehydrated" : "dehydrated"} ${wheel.toLowerCase()}`;
  });
}

/** "Fine strain into the glass" gives "Double strain into the glass" (the capital is kept). */
export function doubleStrain(text: string): string {
  return text.replace(/\bfine[\s-]+strain(ed|ing)?\b/gi, (match, tail: string | undefined) => {
    const cap = match[0] === match[0].toUpperCase();
    return `${cap ? "Double" : "double"} strain${tail ?? ""}`;
  });
}

/** "Toothpick" gives "cocktail skewer" ("a toothpick" and "wooden cocktail pick" read fine either way: the noun is what changes). */
export function cocktailSkewer(text: string): string {
  return text.replace(/\btoothpicks?\b/gi, (match) => {
    const cap = match[0] === match[0].toUpperCase();
    const plural = /s$/i.test(match);
    return `${cap ? "Cocktail" : "cocktail"} skewer${plural ? "s" : ""}`;
  });
}

/** "Mint (smack it between your hands first)" gives "Mint"; "Smacked mint sprig" gives "Mint sprig". Garnish lines only. */
export function noSmackedGarnish(text: string): string {
  const cleaned = text
    .replace(/\s*\((?:[^)]*\b)?smack(?:ed|ing)?\b[^)]*\)/gi, "")
    .replace(/,\s*smack(?:ed|ing)?\b[^,;]*$/i, "")
    .replace(/\bsmacked\s+/gi, "")
    .trim();
  return cleaned && cleaned[0] !== text[0] && /^[a-z]/.test(cleaned) && /^[A-Z]/.test(text) ? cleaned[0].toUpperCase() + cleaned.slice(1) : cleaned;
}

/**
 * "Shake hard" is always a 12 second shake: "Shake hard" gives "Shake hard for 12 seconds, or until the shaker is frosted",
 * and "Shake hard for 12 seconds" gets the ", or until the shaker is frosted". A step that already says frosted, or gives
 * another time, is left alone (Troy, 9 Oct 2026: "shake hard is always 12 secs or until shaker is frosted").
 */
export function shakeUntilFrosted(text: string): string {
  if (!/\bshake\b/i.test(text) || /\bfrost/i.test(text)) return text;
  if (!/\bsecond/i.test(text)) {
    if (!/\bshake\b[^.]*?\bhard\b|\bhard\b[^.]*?\bshake\b/i.test(text)) return text;
    return text.replace(/\bhard\b(,?\s+(?:and|then)\b)?/i, (_m, joiner: string | undefined) => (joiner ? `hard for 12 seconds, or until the shaker is frosted,${joiner.replace(/^,/, "")}` : "hard for 12 seconds, or until the shaker is frosted"));
  }
  if (!/\b12 seconds\b/i.test(text)) return text;
  return text.replace(/\b12 seconds(,?\s+(?:and|then)\b)?/i, (_m, joiner: string | undefined) => (joiner ? `12 seconds, or until the shaker is frosted,${joiner.replace(/^,/, "")}` : "12 seconds, or until the shaker is frosted"));
}

const SPONGE_RIM_OLD = /^\s*(?:wet\s+(?:and\s+)?rim|rim)\s+the\s+(?:jar|glass|[a-z]+\s+glass)\s+(?:with|in)\s+(?:the\s+|some\s+)?(.+?)\s*$/i;

/**
 * Every rim is wet on the bar's lime juice sponge, then dipped (Troy, 9 Oct 2026, all venues):
 * "Wet and rim the glass with salt" becomes "Wet the rim on the lime juice sponge, then dip it in salt".
 */
export function rimOnSponge(text: string): string {
  const m = text.match(SPONGE_RIM_OLD);
  return m ? `Wet the rim on the lime juice sponge, then dip it in ${m[1]}` : text;
}

const RIM_STEP = /^(?!\s*wipe\b).*\brim\b/i;
const RIM_MATERIAL = /\brim\b[^.]*?\b(?:with|dip it in)\s+(?:the\s+|some\s+)?(.+?)\s*$/i;
const WIPE = /\bwipe\b[^.]*\binside\b/i;

/** The wipe step for a rim step: "salt", "chilli salt", "coconut", "sugar", "cinnamon sugar" are named from the rim step itself. */
export function wipeStepFor(rimStep: string): string {
  const material = rimStep.match(RIM_MATERIAL)?.[1]?.toLowerCase().replace(/[.,;]+$/, "");
  return `Wipe the inside of the glass rim so there is ${material ? `no ${material}` : "nothing"} on the inside`;
}

/** Adds the wipe step after every rim step of any drink that does not already have one next (salt, coconut, sugar, anything). */
export function ensureRimWipe(method: readonly string[]): string[] {
  const out: string[] = [];
  method.forEach((step, i) => {
    out.push(step);
    if (RIM_STEP.test(step) && !WIPE.test(step) && !WIPE.test(method[i + 1] ?? "")) out.push(wipeStepFor(step));
  });
  return out;
}

/** Drift and Chiobu's rows in `cost_venues`. */
export const DRIFT_VENUE_ID = 1;
export const CHIOBU_VENUE_ID = 2;

/**
 * Drift and Chiobu: any drink served in a coupe glass is pre-chilled, so the method starts "Chill the coupe glass" unless it
 * already mentions chilling (Top Deck says NOT to chill, so it is left alone too). Greedy's own rule has not been given.
 */
export function ensureCoupeChilled(method: readonly string[], glass: string | null | undefined, venueId: number | null | undefined): string[] {
  if ((venueId !== DRIFT_VENUE_ID && venueId !== CHIOBU_VENUE_ID) || !/\bcoupe\b/i.test(glass ?? "") || method.length === 0) return [...method];
  if (method.some((m) => /\bchill/i.test(m))) return [...method];
  return ["Chill the coupe glass", ...method];
}

export interface HouseRuleItem {
  name: string;
  method?: string[] | null;
  garnish?: string[] | null;
  glass?: string | null;
  venue_id?: number | null;
}

/** The item with the house rules applied. Returns the same object when nothing changes, so a caller can tell. */
export function applyHouseRules<T extends HouseRuleItem>(item: T): T {
  let method = item.method ?? null;
  let garnish = item.garnish ?? null;
  if (method) method = ensureCoupeChilled(ensureRimWipe(method.map((m) => brandSpelling(shakeUntilFrosted(cocktailSkewer(doubleStrain(dehydrateLimeWheels(rimOnSponge(m)))))))), item.glass, item.venue_id);
  if (garnish) garnish = garnish.map((g) => brandSpelling(noSmackedGarnish(cocktailSkewer(dehydrateLimeWheels(g)))));
  const same = (a: readonly string[] | null, b: readonly string[] | null) => (a === b) || (!!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]));
  if (same(method, item.method ?? null) && same(garnish, item.garnish ?? null)) return item;
  return { ...item, ...(item.method ? { method } : {}), ...(item.garnish ? { garnish } : {}) };
}
