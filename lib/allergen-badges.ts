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
 *  - Sulphites are a quiet `sensitivities` tier and alcohol an `attributes` entry: neither is in `contains`.
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

export interface BadgeModel {
  /** a drink: only egg, milk and nuts are marked, and there are no dietary or seafood badges */
  drink: boolean;
  /** set when anything is unreviewed (or the recipe is empty): show this banner first, in every view */
  notReviewed: { unreviewedNames: string[] } | null;
  /** confirmed main allergens (required, then chef extras), fixed order */
  contains: AllergenId[];
  /** keyword guesses on unreviewed ingredients: shown, never as fact */
  mayContain: AllergenId[];
  /** sulphites: the quiet tier */
  sensitivities: AllergenId[];
  sensitivitiesMay: AllergenId[];
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
 * The only allergens marked on a drink (Troy, 4 Oct 2026): egg, milk and nuts. Nothing else is listed on drinks: no
 * gluten or gluten free, no dietary badges. The ingredient data stays recorded.
 */
export const DRINK_ALLERGEN_IDS: readonly AllergenId[] = ["egg", "milk", "peanuts", "tree_nuts"];

/**
 * True when this allergen is marked on this item. Only what the menus show is listed (Troy, 4 Oct 2026): sulphites and
 * alcohol are never listed anywhere, on food or drinks. Food shows the declared allergens and chef extras, drinks only
 * egg, milk and nuts.
 */
export function showsAllergen(item: { category?: string | null } | null | undefined, id: AllergenId): boolean {
  if (!CONTAINS_IDS.includes(id)) return false;
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

export function badgeModel(r: Rollup, item?: BadgeItem | null): BadgeModel {
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
  // sulphites and alcohol are not on the menu, so they are never listed (the ingredient data stays recorded)
  s.sensitivities = [];
  s.sensitivitiesMay = [];
  s.attributes = [];
  s.attributesMay = [];
  if (drink) {
    s.contains = s.contains.filter((id) => DRINK_ALLERGEN_IDS.includes(id));
    s.may = s.may.filter((id) => DRINK_ALLERGEN_IDS.includes(id));
    diet.length = 0;
    options.length = 0;
    optionsMissingNote.length = 0;
  }
  const shown = new Set<AllergenId>([...s.contains, ...s.may, ...s.sensitivities, ...s.sensitivitiesMay, ...s.attributes, ...s.attributesMay]);
  const notes = [...CONTAINS_IDS, ...s.sensitivities, ...s.attributes]
    .filter((id) => shown.has(id) && r.cells[id].note)
    .map((id) => ({ id, label: allergenLabel(id), note: r.cells[id].note as string }));

  return {
    drink,
    notReviewed: r.reviewed ? null : { unreviewedNames: r.unreviewed },
    contains: s.contains,
    mayContain: s.may,
    sensitivities: s.sensitivities,
    sensitivitiesMay: s.sensitivitiesMay,
    attributes: s.attributes.filter((a): a is "alcohol" => a === "alcohol"),
    attributesMay: s.attributesMay.filter((a): a is "alcohol" => a === "alcohol"),
    diet,
    options,
    optionsMissingNote,
    seafood: drink ? null : seafoodBadge(r, !!item?.seafood_label),
    notes,
  };
}
