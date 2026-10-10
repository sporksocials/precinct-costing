import { rollup, type AllergenIndex } from "./allergens";
import type { DietOptionId } from "./diet-legend";
import { badgeModel, type BadgeModel, type BadgePolicy } from "./allergen-badges";
import { barIngredientName } from "./bar";
import { MAX_PREP_DEPTH, buildIndex, parentKey } from "./costing";
import type { KitchenData, KitchenDish, KitchenPrep } from "./kitchen";
import { swapSentence, swapWords } from "./diet-options";
import type { Ingredient, MenuItem, Prep, RecipeLine } from "./types";

/**
 * Kitchen station: what the screens read, built once from a `KitchenData` copy. The allergen answer on screen always comes
 * from lib/allergens.ts and lib/allergen-badges.ts (the same roll-up and badge model the costing app shows): unreviewed
 * ingredients mean a dish is never shown as clear.
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
  const ingredients = data.ingredients.map(
    (i) => ({ id: i.id, name: i.name, category: i.category ?? "", allergens: i.allergens, allergens_reviewed: i.reviewed, diet_flags: i.dietFlags, seafood_origin: i.seafoodOrigin, seafood_exempt: i.seafoodExempt }) as unknown as Ingredient,
  );
  const preps = data.preps.map((p) => ({ id: p.id, name: p.name, allergen_add: p.allergenAdd, allergen_remove: p.allergenRemove, allergen_notes: p.allergenNotes }) as unknown as Prep);
  const items = data.dishes.map(
    (d) => ({ id: d.id, name: d.name, allergen_add: d.allergenAdd, allergen_remove: d.allergenRemove, allergen_notes: d.allergenNotes, diet_options: { ...d.dietOptions, ...Object.fromEntries(d.dietMarks.map((m) => [m, {}])) }, seafood_label: d.seafoodLabel }) as unknown as MenuItem,
  );
  const lines = data.lines.map((l, i) => ({ id: l.lineId ?? String(i).padStart(6, "0"), parent_type: l.parentType, parent_id: l.parentId, component_type: l.componentType, component_id: l.componentId, qty: l.qty, unit: l.unit, note: l.note, sort: l.sort }) as unknown as RecipeLine);
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

/**
 * What the screens print for a dish or prep: the shared badge model (lib/allergen-badges.ts), the same one the costing app
 * reads, so the kitchen and the editor can never disagree. All the safety rules live there and in lib/allergens.ts.
 */
export function dishBadges(model: KitchenModel, dishId: string, policy?: BadgePolicy): BadgeModel {
  const m = badgeModel(rollup({ kind: "item", id: dishId }, model.index), model.index.items?.get(dishId), policy);
  if (!m.options.length) return m;
  return { ...m, options: m.options.map((o) => ({ ...o, ...optionSwap(model, dishId, o.id) })) };
}

/**
 * What an option changes in plain words ("Leave out Soy Sauce. Add Tamari 15 ml."), from the dish's own lines and the extra
 * components, for the kitchen screens. Never a cost or a price: the feed carries none. A line or component the feed does not
 * hold is left out of the words rather than guessed.
 */
export function optionSwap(model: KitchenModel, dishId: string, optionId: DietOptionId): { swap?: string } {
  const opt = model.dishes.get(dishId)?.dietOptions[optionId];
  if (!opt) return {};
  const own = new Map((model.index.linesByParent.get(parentKey("item", dishId)) ?? []).map((l) => [l.id, l]));
  const componentName = (type: "ingredient" | "prep", id: string): string | null =>
    type === "prep" ? model.preps.get(id)?.name ?? null : (model.index.ingredients.get(id)?.name ? barIngredientName(model.index.ingredients.get(id)!.name) : null);
  const words = swapWords(
    { removed: opt.removed ?? [], added: opt.added ?? [] },
    {
      lineName: (id) => {
        const l = own.get(id);
        return l ? componentName(l.component_type, l.component_id) : null;
      },
      addedName: (a) => componentName(a.component_type, a.component_id),
    },
  );
  const swap = swapSentence(words);
  return swap ? { swap } : {};
}
/** A prep's roll-up has no menu fields (options, seafood label), so it carries no options and no required seafood letter. */
export function prepBadges(model: KitchenModel, prepId: string, policy?: BadgePolicy): BadgeModel {
  return badgeModel(rollup({ kind: "prep", id: prepId }, model.index), null, policy);
}
