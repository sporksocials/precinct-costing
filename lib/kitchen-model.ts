import { ALLERGEN_IDS, allergenLabel, dietTags, rollup, summarise, type AllergenIndex, type Rollup } from "./allergens";
import { barIngredientName } from "./bar";
import { MAX_PREP_DEPTH, buildIndex, parentKey } from "./costing";
import type { KitchenData, KitchenDish, KitchenPrep } from "./kitchen";
import type { Ingredient, MenuItem, Prep, RecipeLine } from "./types";

/**
 * Kitchen station: what the screens read, built once from a `KitchenData` copy. The allergen answer on screen always comes
 * from lib/allergens.ts (the same roll-up the costing app shows): unreviewed ingredients mean a dish is never shown as clear.
 */

export interface KitchenModel {
  data: KitchenData;
  index: AllergenIndex;
  dishes: Map<string, KitchenDish>;
  preps: Map<string, KitchenPrep>;
}

/**
 * The roll-up reads only the fields below, so the database's display copy is dressed up as the full records it expects.
 * Anything the roll-up doesn't read stays at a neutral value and is never shown.
 */
export function buildKitchenModel(data: KitchenData): KitchenModel {
  const ingredients = data.ingredients.map((i) => ({ id: i.id, name: i.name, allergens: i.allergens, allergens_reviewed: i.reviewed, diet_flags: i.dietFlags }) as unknown as Ingredient);
  const preps = data.preps.map((p) => ({ id: p.id, name: p.name, allergen_add: p.allergenAdd, allergen_remove: p.allergenRemove, allergen_notes: p.allergenNotes }) as unknown as Prep);
  const items = data.dishes.map((d) => ({ id: d.id, name: d.name, allergen_add: d.allergenAdd, allergen_remove: d.allergenRemove, allergen_notes: d.allergenNotes }) as unknown as MenuItem);
  const lines = data.lines.map((l, i) => ({ id: String(i).padStart(6, "0"), parent_type: l.parentType, parent_id: l.parentId, component_type: l.componentType, component_id: l.componentId, qty: l.qty, unit: l.unit, note: l.note, sort: l.sort }) as unknown as RecipeLine);
  const index: AllergenIndex = { ...buildIndex(ingredients, preps, lines), items: new Map(items.map((m) => [m.id, m])) };
  return { data, index, dishes: new Map(data.dishes.map((d) => [d.id, d])), preps: new Map(data.preps.map((p) => [p.id, p])) };
}

/** One row of a Components list. */
export interface Component {
  kind: "ingredient" | "prep";
  id: string;
  name: string;
  qty: number;
  unit: string;
  note: string | null;
}

/** A dish's or prep's recipe lines in order, named. A component the feed doesn't carry reads as unknown rather than disappearing. */
export function componentsOf(model: KitchenModel, parentType: "item" | "prep", parentId: string): Component[] {
  return (model.index.linesByParent.get(parentKey(parentType, parentId)) ?? []).map((l) => {
    const name = l.component_type === "prep" ? model.preps.get(l.component_id)?.name ?? "Unknown prep" : barIngredientName(model.index.ingredients.get(l.component_id)?.name ?? "Unknown ingredient");
    return { kind: l.component_type, id: l.component_id, name, qty: l.qty, unit: l.unit, note: l.note };
  });
}

/** Ready dishes that use this prep, directly or through another prep (cycle-safe, as deep as the costing app allows). */
export function usedIn(model: KitchenModel, prepId: string): KitchenDish[] {
  const reaches = (parentType: "item" | "prep", parentId: string, depth: number, seen: Set<string>): boolean => {
    for (const l of model.index.linesByParent.get(parentKey(parentType, parentId)) ?? []) {
      if (l.component_type !== "prep") continue;
      if (l.component_id === prepId) return true;
      if (depth >= MAX_PREP_DEPTH || seen.has(l.component_id)) continue;
      seen.add(l.component_id);
      if (reaches("prep", l.component_id, depth + 1, seen)) return true;
    }
    return false;
  };
  return model.data.dishes.filter((d) => reaches("item", d.id, 0, new Set())).sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ allergens on screen */

export interface AllergenDisplay {
  /** confirmed allergens, as labels */
  contains: string[];
  /** keyword guesses on ingredients nobody has reviewed: shown, but never as fact */
  may: string[];
  /** true when ANY ingredient (through every nested prep) is unreviewed, missing or too deep: the screen must say so */
  notReviewed: boolean;
  /** the unreviewed ingredients by name, so the chef knows what to check */
  unreviewed: string[];
  /** only true for a fully reviewed recipe with nothing contained: the one case "no allergens listed" may be said */
  none: boolean;
  /** chef "made without" notes, e.g. "Milk: no aioli" */
  notes: { label: string; note: string }[];
  /** "Vegetarian" / "Vegan", only when the roll-up says yes (never for an unreviewed recipe) */
  diet: string[];
}

/** Turns a roll-up into what the screens print. All the rules stay in lib/allergens.ts; this only chooses words. */
export function allergenDisplay(r: Rollup): AllergenDisplay {
  const { contains, may } = summarise(r);
  const notReviewed = !r.reviewed;
  return {
    contains: contains.map(allergenLabel),
    may: may.map(allergenLabel),
    notReviewed,
    unreviewed: r.unreviewed,
    none: !notReviewed && contains.length === 0 && may.length === 0,
    notes: ALLERGEN_IDS.filter((a) => r.cells[a].note).map((a) => ({ label: allergenLabel(a), note: r.cells[a].note as string })),
    diet: dietTags(r)
      .filter((t) => t.state === "yes")
      .map((t) => t.label),
  };
}

export function dishAllergens(model: KitchenModel, dishId: string): AllergenDisplay {
  return allergenDisplay(rollup({ kind: "item", id: dishId }, model.index));
}
export function prepAllergens(model: KitchenModel, prepId: string): AllergenDisplay {
  return allergenDisplay(rollup({ kind: "prep", id: prepId }, model.index));
}
