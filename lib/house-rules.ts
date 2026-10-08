/**
 * House wording rules for a drink's method and garnish (Troy, 9 Oct 2026). Pure and applied when a drink is SAVED in the
 * recipe editor, so every route in (typing, a research note, the step tidy) ends up the same:
 *   1 A lime wheel is always a dehydrated lime wheel ("Lime wheel" becomes "Dehydrated lime wheel").
 *   2 "Fine strain" is always "double strain" (Troy, 9 Oct 2026).
 *   3 A toothpick is always a cocktail skewer (Troy, 9 Oct 2026).
 *   4 Any rim (salt, chilli salt, coconut, sugar, cinnamon sugar, anything) always says, right after the rim step, to wipe
 *     the inside of the glass rim so there is none of it on the inside (Troy, 9 Oct 2026: "we always wipe the inside").
 * The rules only add or reword; they never remove a step and never touch an item that already follows them.
 */

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

const RIM_STEP = /^(?!\s*wipe\b).*\brim\b/i;
const RIM_MATERIAL = /\brim\b[^.]*?\bwith\s+(?:the\s+|some\s+)?(.+?)\s*$/i;
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

export interface HouseRuleItem {
  name: string;
  method?: string[] | null;
  garnish?: string[] | null;
}

/** The item with the house rules applied. Returns the same object when nothing changes, so a caller can tell. */
export function applyHouseRules<T extends HouseRuleItem>(item: T): T {
  let method = item.method ?? null;
  let garnish = item.garnish ?? null;
  if (method) method = ensureRimWipe(method.map((m) => cocktailSkewer(doubleStrain(dehydrateLimeWheels(m)))));
  if (garnish) garnish = garnish.map((g) => cocktailSkewer(dehydrateLimeWheels(g)));
  const same = (a: readonly string[] | null, b: readonly string[] | null) => (a === b) || (!!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]));
  if (same(method, item.method ?? null) && same(garnish, item.garnish ?? null)) return item;
  return { ...item, ...(item.method ? { method } : {}), ...(item.garnish ? { garnish } : {}) };
}
