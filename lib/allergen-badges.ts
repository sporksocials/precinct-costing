import {
  allergenLabel,
  CONTAINS_IDS,
  summarise,
  type AllergenId,
  type Rollup,
} from "./allergens";
import { BADGE_LABELS, DIET_OPTION_IDS, dietOptionDef, type DietOptionId, type SeafoodLetter } from "./diet-legend";
import { DRINK_CATEGORIES } from "./insights";
import type { MenuItem } from "./types";

/**
 * The display model for allergens, dietary status and seafood origin. PURE: it turns a roll-up (lib/allergens.ts) and a
 * menu item's own fields into the tiers a screen prints. The costing app and the kitchen iPad both read this, so the
 * safety rules live here once:
 *
 *  - A recipe with any unreviewed ingredient (through every nested prep) gets `notReviewed` set. Screens show that first
 *    and print no positive free-from or diet badge: every diet entry is `not_confirmed` until everything is reviewed.
 *  - "Gluten Free" is never claimed. `no_gluten_ingredients` is derived (fully reviewed, gluten absent through every
 *    nested prep, not cleared by hand); a dish the chef offers a swap for carries the `gfo` option instead, with its note.
 *    Same for dairy.
 *  - A diet that is definitely ruled out (the dish contains gluten, or meat for Vegetarian) has no entry at all.
 *  - Sulphites and nitrites are main allergens (in `contains` / `mayContain`, in the fixed order, when the policy lists them).
 *    Alcohol is an `attributes` entry, never in `contains`, and never listed.
 */

export type DietBadgeId = "no_gluten_ingredients" | "no_dairy_ingredients" | "vegetarian" | "vegan";

export interface DietBadge {
  id: DietBadgeId;
  label: string;
  /** `is`: fully reviewed and derived true. `not_confirmed`: not ruled out, but not everything is confirmed */
  state: "is" | "not_confirmed";
}

export interface OptionBadge {
  id: DietOptionId;
  /** the printed menu letters: GFO, VO, VGO, DFO */
  letter: string;
  label: string;
  /** what changes (always non-empty: an option without a note is not shown as an option) */
  note: string;
}

export type SeafoodBadge =
  | {
      letter: SeafoodLetter;
      /** the menu wording markets the dish as seafood, so this letter must be printed */
      required: boolean;
    }
  | {
      state: "origin_not_confirmed";
      required: boolean;
      /** the seafood ingredients with no origin set */
      missing: string[];
    };

/**
 * What a screen is allowed to list. Troy, 4 Oct 2026: ONLY what the printed menu shows is listed, and the menu shows no
 * allergens: just the option letters (GFO, VO, VGO, DF) and the seafood origin letters (A, I, M). So by default no
 * allergen, no computed "No Gluten Ingredients / Vegetarian / Vegan" badge and no "Allergens Not Reviewed" banner is
 * shown anywhere. The ingredient allergen ticks stay recorded. To list allergens again, change `DEFAULT_POLICY`.
 */
export interface BadgePolicy {
  /** allergen ids that may be listed (drinks are further limited to DRINK_ALLERGEN_IDS) */
  allergens: readonly AllergenId[];
  /** the computed No Gluten Ingredients, No Dairy Ingredients, Vegetarian and Vegan badges */
  computedDiet: boolean;
  /** the Allergens Not Reviewed banner and its review lists */
  reviewBanner: boolean;
}
export const MENU_ONLY: BadgePolicy = { allergens: [], computedDiet: false, reviewBanner: false };
export const FULL_ALLERGENS: BadgePolicy = { allergens: CONTAINS_IDS, computedDiet: true, reviewBanner: true };
export const DEFAULT_POLICY: BadgePolicy = MENU_ONLY;

export interface BadgeModel {
  /** true when allergens are listed at all (false on a menu-only screen) */
  listsAllergens: boolean;
  /** a drink: only DRINK_ALLERGEN_IDS (egg, milk, nuts, sulphites) are marked, and there are no dietary or seafood badges */
  drink: boolean;
  /** set when anything is unreviewed (or the recipe is empty): show this banner first, in every view */
  notReviewed: { unreviewedNames: string[] } | null;
  /** confirmed main allergens (required, then chef extras), fixed order */
  contains: AllergenId[];
  /** keyword guesses on unreviewed ingredients: shown, never as fact */
  mayContain: AllergenId[];
  /** alcohol: neutral attribute, outside the allergen row */
  attributes: "alcohol"[];
  attributesMay: "alcohol"[];
  diet: DietBadge[];
  options: OptionBadge[];
  /** option keys that are on but have no note: the editor must not save these, a screen must not show them */
  optionsMissingNote: DietOptionId[];
  seafood: SeafoodBadge | null;
  /** chef "made without" notes on the allergens that are shown */
  notes: { id: AllergenId; label: string; note: string }[];
}

export type BadgeItem = Pick<MenuItem, "diet_options" | "seafood_label"> & { category?: string | null };

/** Drink categories: cocktails, mocktails, wine, spirits, beer, RTD. */
export function isDrinkItem(item?: { category?: string | null } | null): boolean {
  return !!item?.category && DRINK_CATEGORIES.has(item.category);
}

/**
 * The ONLY allergens marked on a drink: egg, milk and nuts (Troy, 4 Oct 2026) plus sulphites (design call, 10 Oct 2026:
 * wine, prosecco, vermouth and cider based drinks genuinely contain them, and sulphites became a main allergen). Nitrites,
 * gluten, seeds and the rest are not listed on drinks, and there are no dietary badges. The ingredient data stays recorded.
 * This one list drives the printed sheet (showsAllergen), the allergen suggestions for a drink's ingredients
 * (components/allergen-suggest.tsx) and the dish card's suggestion chips (components/allergen-picker.tsx).
 */
export const DRINK_ALLERGEN_IDS: readonly AllergenId[] = ["egg", "milk", "peanuts", "tree_nuts", "sulphites"];

/**
 * True when this allergen may be listed on this item under the policy. Alcohol is never listed. Drinks list only
 * DRINK_ALLERGEN_IDS, and only if the policy lists allergens at all.
 */
export function showsAllergen(item: { category?: string | null } | null | undefined, id: AllergenId, policy: BadgePolicy = DEFAULT_POLICY): boolean {
  if (!CONTAINS_IDS.includes(id) || !policy.allergens.includes(id)) return false;
  return !isDrinkItem(item) || DRINK_ALLERGEN_IDS.includes(id);
}

/** Dish seafood letter from the ingredient origins: all A is A, all I is I, both is M. Null when there is no seafood. */
export function seafoodBadge(r: Rollup, required: boolean): SeafoodBadge | null {
  if (r.seafood.length === 0) return null;
  const missing = r.seafood.filter((s) => s.origin === null).map((s) => s.name);
  if (missing.length) return { state: "origin_not_confirmed", required, missing };
  const hasA = r.seafood.some((s) => s.origin === "A");
  const hasI = r.seafood.some((s) => s.origin === "I");
  return { letter: hasA && hasI ? "M" : hasA ? "A" : "I", required };
}

/** `is` / `not_confirmed` for "no ingredient contains X", or null when the dish does contain X. */
function absentState(r: Rollup, id: AllergenId): "is" | "not_confirmed" | null {
  const c = r.cells[id];
  if (c.state === "contains") return null;
  // a hand-cleared allergen still has the ingredient in the recipe, so it never earns the positive badge
  if (!r.reviewed || c.state === "may_contain" || c.chef === "removed" || r.problems.length) return "not_confirmed";
  return "is";
}

export function badgeModel(r: Rollup, item?: BadgeItem | null, policy: BadgePolicy = DEFAULT_POLICY): BadgeModel {
  const s = { ...summarise(r) };
  const diet: DietBadge[] = [];
  const gluten = absentState(r, "gluten");
  if (gluten) diet.push({ id: "no_gluten_ingredients", label: BADGE_LABELS.noGlutenIngredients, state: gluten });
  const milk = absentState(r, "milk");
  if (milk) diet.push({ id: "no_dairy_ingredients", label: BADGE_LABELS.noDairyIngredients, state: milk });
  for (const t of [r.diet.vegetarian, r.diet.vegan]) {
    if (t.state === "no") continue;
    diet.push({ id: t.id, label: t.label, state: t.state === "yes" ? "is" : "not_confirmed" });
  }

  const options: OptionBadge[] = [];
  const optionsMissingNote: DietOptionId[] = [];
  const raw = item?.diet_options && typeof item.diet_options === "object" ? item.diet_options : {};
  for (const id of DIET_OPTION_IDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, id) || raw[id] == null) continue;
    const note = typeof raw[id]?.note === "string" ? (raw[id]?.note as string).trim() : "";
    if (!note) {
      optionsMissingNote.push(id);
      continue;
    }
    const def = dietOptionDef(id);
    options.push({ id, letter: def.letter, label: def.label, note });
  }

  const drink = isDrinkItem(item);
  // alcohol is not an allergen and is never listed (the ingredient data stays recorded)
  s.attributes = [];
  s.attributesMay = [];
  s.contains = s.contains.filter((id) => showsAllergen(item, id, policy));
  s.may = s.may.filter((id) => showsAllergen(item, id, policy));
  if (!policy.computedDiet) diet.length = 0;
  if (drink) {
    diet.length = 0;
    options.length = 0;
    optionsMissingNote.length = 0;
  }
  const shown = new Set<AllergenId>([...s.contains, ...s.may, ...s.attributes, ...s.attributesMay]);
  const notes = [...CONTAINS_IDS, ...s.attributes]
    .filter((id) => shown.has(id) && r.cells[id].note)
    .map((id) => ({ id, label: allergenLabel(id), note: r.cells[id].note as string }));

  return {
    drink,
    listsAllergens: policy.allergens.length > 0,
    notReviewed: !policy.reviewBanner || r.reviewed ? null : { unreviewedNames: r.unreviewed },
    contains: s.contains,
    mayContain: s.may,
    attributes: s.attributes.filter((a): a is "alcohol" => a === "alcohol"),
    attributesMay: s.attributesMay.filter((a): a is "alcohol" => a === "alcohol"),
    diet,
    options,
    optionsMissingNote,
    seafood: drink ? null : seafoodBadge(r, !!item?.seafood_label),
    notes,
  };
}
