import type { AllergenIndex } from "./allergens";
import { barIngredientName } from "./bar";
import { parentKey } from "./costing";
import { optionText, readMarks, readOption, swapSentence, swapWords } from "./diet-options";
import { DIET_OPTION_IDS, type DietOptionId } from "./diet-legend";
import { effectiveAllergens, liveCheck, readDishAllergens, signOffState } from "./dish-allergens";
import type { MatrixDish } from "./allergy-matrix";
import type { MenuItem } from "./types";

/**
 * Turns the costing app's menu items into the plain dishes the Allergy Matrix rules read (lib/allergy-matrix.ts). A cell is read from
 * the dish's own allergens section, which holds what the ingredients gave when a person confirmed it (ingredient-first,
 * lib/dish-allergens.ts). Ingredient data is touched in exactly two places here:
 *  - names, so an option's swap reads "Leave out Brioche Bun. Add Tamari 15 ml." (the same words the kitchen iPad and the print use);
 *  - the live check (components and ticks), only to decide whether the sign-off is still valid. A sign-off that is not valid is removed,
 *    so every cell reads Not checked.
 */

/** The dishes the matrix lists: active Food-category menu items. Drinks, tap beer and gelato are never on it. */
export function isMatrixItem(item: Pick<MenuItem, "active" | "category">): boolean {
  return !!item.active && item.category === "Food";
}

/** The wording of every option a dish offers, built from its own recipe lines and the extra components. Never a price. */
export function optionWordsFor(item: MenuItem, index: Pick<AllergenIndex, "ingredients" | "preps" | "linesByParent">): Partial<Record<DietOptionId, string>> {
  const out: Partial<Record<DietOptionId, string>> = {};
  const own = new Map((index.linesByParent.get(parentKey("item", item.id)) ?? []).map((l) => [l.id, l]));
  const name = (type: "ingredient" | "prep", id: string): string | null => {
    if (type === "prep") return index.preps.get(id)?.name ?? null;
    const n = index.ingredients.get(id)?.name;
    return n ? barIngredientName(n) : null;
  };
  for (const id of DIET_OPTION_IDS) {
    const o = readOption(item.diet_options, id);
    if (!o) continue;
    const w = swapWords(o, {
      lineName: (lid) => {
        const l = own.get(lid);
        return l ? name(l.component_type, l.component_id) : null;
      },
      addedName: (a) => name(a.component_type, a.component_id),
    });
    out[id] = optionText(o.note, swapSentence(w));
  }
  return out;
}

/**
 * One dish for the matrix rules. The re-check rule is applied HERE: the dish's current components (through every nested prep) and
 * their ticks are compared with the ones stored at sign-off, and a sign-off that is not valid is removed from `allergens`, so every
 * cell reads Not checked.
 */
export function matrixDishFromItem(item: MenuItem, index: AllergenIndex): MatrixDish {
  const stored = readDishAllergens(item.dish_allergens);
  const live = liveCheck(item, index);
  return {
    id: item.id,
    name: item.name,
    section: item.section?.trim() || null,
    allergens: effectiveAllergens(stored, live),
    signOff: signOffState(stored, live),
    signedAt: stored?.confirmedAt ?? null,
    marks: readMarks(item.diet_options),
    options: optionWordsFor(item, index),
  };
}

/** The matrix dishes of one venue. */
export function matrixDishesForVenue(items: readonly MenuItem[], index: AllergenIndex, venueId: number): MatrixDish[] {
  return items.filter((i) => i.venue_id === venueId && isMatrixItem(i)).map((i) => matrixDishFromItem(i, index));
}
