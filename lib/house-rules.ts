/**
 * House wording rules for a drink's method and garnish (Troy, 9 Oct 2026). Pure and applied when a drink is SAVED in the
 * recipe editor, so every route in (typing, a research note, the step tidy) ends up the same:
 *   1 A lime wheel is always a dehydrated lime wheel ("Lime wheel" becomes "Dehydrated lime wheel").
 *   2 "Fine strain" is always "double strain" (Troy, 9 Oct 2026).
 *   3 A margarita with a salted rim (salt or chilli salt) always says, right after the rim step, to wipe the inside of
 *     the glass rim so there is no salt on the inside.
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

const SALT_RIM = /\brim\b[^.]*\bsalt\b|\bsalt(?:ed)?\s+rim\b/i;
const WIPE = /\bwipe\b[^.]*\binside\b/i;

/** The wipe step for a salted rim: "chilli salt" when the rim step says chilli salt, else "salt". */
export function wipeStepFor(rimStep: string): string {
  const salt = /\bchilli\s+salt\b/i.test(rimStep) ? "chilli salt" : "salt";
  return `Wipe the inside of the glass rim so there is no ${salt} on the inside`;
}

/** Adds the wipe step after every salted rim step of a margarita that does not already have one next. */
export function ensureRimWipe(method: readonly string[], itemName: string): string[] {
  if (!/marg/i.test(itemName)) return [...method];
  const out: string[] = [];
  method.forEach((step, i) => {
    out.push(step);
    if (SALT_RIM.test(step) && !WIPE.test(step) && !WIPE.test(method[i + 1] ?? "")) out.push(wipeStepFor(step));
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
  if (method) method = ensureRimWipe(method.map((m) => doubleStrain(dehydrateLimeWheels(m))), item.name);
  if (garnish) garnish = garnish.map(dehydrateLimeWheels);
  const same = (a: readonly string[] | null, b: readonly string[] | null) => (a === b) || (!!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]));
  if (same(method, item.method ?? null) && same(garnish, item.garnish ?? null)) return item;
  return { ...item, ...(item.method ? { method } : {}), ...(item.garnish ? { garnish } : {}) };
}
