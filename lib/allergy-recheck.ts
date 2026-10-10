import { isSignOffValid, liveCheck, readDishAllergens, signOffState, type LiveIndex } from "./dish-allergens";
import type { MenuItem, Prep, RecipeLine } from "./types";

/**
 * "Impact first" for the re-check rule (Troy, 10 Oct 2026). Pure.
 *
 * A prep is shared: many dishes use it, directly or through other preps. When somebody saves a PREP whose components change (an
 * ingredient swapped, added or removed anywhere in it) or whose allergen overrides change, every active food dish that uses it and
 * is currently signed off will need its allergens re-checked. The prep's editor says so BEFORE saving ("Used in 3 confirmed dishes.
 * They will need their allergens re-checked.") with Save Anyway and Cancel. After saving a DISH whose ingredients (or their ticks)
 * changed while it was signed off, the editor shows a nudge with an Open Allergens button.
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

const byName = (a: MenuItem, b: MenuItem) => a.name.localeCompare(b.name, "en-AU", { sensitivity: "base" });

/** The index with one prep's lines (and, when given, the prep record) replaced by another version. */
function withPrep(index: LiveIndex, prepId: string, lines: readonly RecipeLine[], prep?: Prep): LiveIndex {
  return { ingredients: index.ingredients, preps: prep ? new Map(index.preps).set(prepId, prep) : index.preps, linesByParent: withLines(index.linesByParent, "prep", prepId, lines) as LiveIndex["linesByParent"] };
}

/** Active food dishes that use the prep (directly or through other preps) and are signed off, and still valid, right now. Sorted by name. */
export function confirmedDishesUsing(prepId: string, items: readonly MenuItem[], index: LiveIndex): MenuItem[] {
  return items
    .filter((i) => i.active && i.category === "Food")
    .filter((i) => {
      const live = liveCheck(i, index);
      return live.components.includes(`prep:${prepId}`) && isSignOffValid(readDishAllergens(i.dish_allergens), live);
    })
    .sort(byName);
}

/**
 * What the prep's Save asks first, or null when nothing needs re-checking. A confirmed dish needs a re-check when the new version of
 * the prep changes what it is made from (an ingredient swapped, added or removed anywhere in it) OR the allergens the prep gives (its
 * own allergen overrides). `afterPrep` is the prep record being saved; leave it out when only its lines can have changed.
 */
export function prepSaveImpact(prepId: string, items: readonly MenuItem[], index: LiveIndex, before: readonly RecipeLine[], after: readonly RecipeLine[], afterPrep?: Prep): MenuItem[] | null {
  const was = withPrep(index, prepId, before);
  const now = withPrep(index, prepId, after, afterPrep);
  const hit = confirmedDishesUsing(prepId, items, was).filter((i) => !isSignOffValid(readDishAllergens(i.dish_allergens), liveCheck(i, now)));
  return hit.length ? hit : null;
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

/** After saving a dish: it was signed off before and is not any more because its ingredients or their ticks changed (the nudge). */
export function lostSignOff(before: { item: MenuItem; lines: readonly RecipeLine[] }, after: { item: MenuItem; lines: readonly RecipeLine[] }, index: LiveIndex): boolean {
  const state = (x: { item: MenuItem; lines: readonly RecipeLine[] }) => {
    const idx: LiveIndex = { ...index, linesByParent: withLines(index.linesByParent, "item", x.item.id, x.lines) as LiveIndex["linesByParent"] };
    return signOffState(readDishAllergens(x.item.dish_allergens), liveCheck(x.item, idx));
  };
  // "changed", not "never": a person who edited the extras or a note (which clears the sign-off) already knows it needs confirming
  return state(before) === "valid" && state(after) === "changed";
}

export const NUDGE_TEXT = "Ingredients changed, so this dish needs its allergens re-checked.";
