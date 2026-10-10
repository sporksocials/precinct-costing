import { currentComponents, readDishAllergens, sameComponents, signOffState } from "./dish-allergens";
import type { MenuItem, RecipeLine } from "./types";

/**
 * "Impact first" for the re-check rule (Troy, 10 Oct 2026). Pure.
 *
 * A prep is shared: many dishes use it, directly or through other preps. When somebody saves a PREP whose components change (an
 * ingredient swapped, added or removed anywhere in it), every active food dish that uses it and is currently signed off will need
 * its allergens re-checked. The prep's editor says so BEFORE saving ("Used in 3 confirmed dishes. They will need their allergens
 * re-checked.") with Save Anyway and Cancel. After saving a DISH whose own components changed while it was signed off, the editor
 * shows a nudge with an Open Allergens button.
 */

type LinesByParent = ReadonlyMap<string, readonly RecipeLine[]>;

/** Recipe lines grouped by parent (`item:<id>` / `prep:<id>`), the shape `currentComponents` reads. */
export function groupLines(lines: readonly RecipeLine[]): Map<string, RecipeLine[]> {
  const out = new Map<string, RecipeLine[]>();
  for (const l of lines) {
    const k = `${l.parent_type}:${l.parent_id}`;
    const arr = out.get(k);
    if (arr) arr.push(l);
    else out.set(k, [l]);
  }
  return out;
}

/** The same map with one record's lines replaced (the version being edited). */
export function withLines(linesByParent: LinesByParent, kind: "item" | "prep", id: string, lines: readonly RecipeLine[]): Map<string, readonly RecipeLine[]> {
  return new Map(linesByParent).set(`${kind}:${id}`, lines);
}

/** True when the prep's components (its own lines and every nested prep's) differ between two versions of its lines. Amounts and order do not count. */
export function prepComponentsChanged(prepId: string, linesByParent: LinesByParent, before: readonly RecipeLine[], after: readonly RecipeLine[]): boolean {
  return !sameComponents(currentComponents("prep", prepId, withLines(linesByParent, "prep", prepId, before)), currentComponents("prep", prepId, withLines(linesByParent, "prep", prepId, after)));
}

/** Active food dishes that use the prep (directly or through other preps) and are signed off right now. Sorted by name. */
export function confirmedDishesUsing(prepId: string, items: readonly MenuItem[], linesByParent: LinesByParent): MenuItem[] {
  return items
    .filter((i) => i.active && i.category === "Food")
    .filter((i) => {
      const comps = currentComponents("item", i.id, linesByParent);
      return comps.includes(`prep:${prepId}`) && signOffState(readDishAllergens(i.dish_allergens), comps) === "valid";
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en-AU", { sensitivity: "base" }));
}

/** What the prep's Save asks first, or null when nothing needs re-checking (no component change, or no confirmed dish uses it). */
export function prepSaveImpact(prepId: string, items: readonly MenuItem[], linesByParent: LinesByParent, before: readonly RecipeLine[], after: readonly RecipeLine[]): MenuItem[] | null {
  if (!prepComponentsChanged(prepId, linesByParent, before, after)) return null;
  const dishes = confirmedDishesUsing(prepId, items, linesByParent);
  return dishes.length ? dishes : null;
}

export const IMPACT_NAME_CAP = 8;

/** "Used in 3 confirmed dishes. They will need their allergens re-checked." */
export function impactHeadline(n: number): string {
  return `Used in ${n} confirmed ${n === 1 ? "dish" : "dishes"}. ${n === 1 ? "It" : "They"} will need ${n === 1 ? "its" : "their"} allergens re-checked.`;
}

/** The dish names to show: up to eight, then "and N more". */
export function impactNames(names: readonly string[]): { shown: string[]; more: number } {
  return { shown: names.slice(0, IMPACT_NAME_CAP), more: Math.max(0, names.length - IMPACT_NAME_CAP) };
}

/** After saving a dish: it was signed off before and is not any more because its components changed (the nudge). */
export function lostSignOff(before: { dish_allergens?: unknown; lines: readonly RecipeLine[] }, after: { dish_allergens?: unknown; lines: readonly RecipeLine[] }, itemId: string, linesByParent: LinesByParent): boolean {
  const state = (x: { dish_allergens?: unknown; lines: readonly RecipeLine[] }) => {
    const comps = currentComponents("item", itemId, withLines(linesByParent, "item", itemId, x.lines));
    return signOffState(readDishAllergens(x.dish_allergens), comps);
  };
  // "changed", not "never": a person who ticked or unticked an allergen (which clears the sign-off) already knows it needs confirming
  return state(before) === "valid" && state(after) === "changed";
}

export const NUDGE_TEXT = "Ingredients changed, so this dish needs its allergens re-checked.";
