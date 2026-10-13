import { nameKey } from "./rename";

/**
 * Rename everywhere (Troy, 13 Oct 2026: "if we change the bottle name, the nips and anything else associated with it should
 * change as well as the ordering"). Renaming an ingredient offers to carry the new name to the things that are named after it:
 * the dishes that use it and start with its name (a spirit's "- 30ml Nip" menu item) and the ordering products that point at it
 * (or, when nothing points at it yet, are called exactly its name). Pure rules, no store and no database, so the preview and the
 * tests see the same plan the screen applies. Nothing here writes.
 *
 * The part of an ingredient's name that the others copy is its BASE: the name without the trailing size in brackets, so
 * "Bombay Sapphire London Dry Gin (700ml)" has the base "Bombay Sapphire London Dry Gin". A rename that keeps the base (only the
 * size changed) carries nothing.
 */

/** "Jack Daniel's (1L)" gives "Jack Daniel's"; a name with no trailing brackets is its own base. */
export function baseName(name: string): string {
  return name.trim().replace(/\s*\([^()]*\)\s*$/, "").trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The new text of `name` when its leading `oldBase` becomes `newBase`, or null when the name does not start with the old base as a whole name ("... Gin", "... Gin - Nip", "... Gin (30ml)"). */
export function swapLeadingBase(name: string, oldBase: string, newBase: string): string | null {
  const words = oldBase.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const re = new RegExp(`^\\s*${words.map(escapeRe).join("\\s+")}(?=\\s*(?:$|[-–(]))`, "i");
  if (!re.test(name)) return null;
  return name.replace(re, newBase).replace(/\s+/g, " ").trim();
}

export interface LinkedItem {
  id: string;
  name: string;
  venue_id: number | null;
}
export interface LinkedLine {
  parent_type: string;
  parent_id: string;
  component_type: string;
  component_id: string;
}
export interface LinkedProduct {
  id: string;
  venue_id: number;
  category_id: string;
  name: string;
  ingredient_id: string | null;
}

export interface LinkedDishRename {
  id: string;
  venue_id: number | null;
  from: string;
  to: string;
}
export interface LinkedProductRename {
  id: string;
  venue_id: number;
  from: string;
  to: string;
  /** the product pointed at nothing and is being matched by its name: it is linked to the ingredient as part of the rename */
  link: boolean;
}
export interface LinkedSkip {
  kind: "dish" | "product";
  from: string;
  to: string;
  venue_id: number | null;
  reason: string;
}
export interface LinkedRenamePlan {
  oldBase: string;
  newBase: string;
  dishes: LinkedDishRename[];
  products: LinkedProductRename[];
  skipped: LinkedSkip[];
}

export const EMPTY_PLAN: LinkedRenamePlan = { oldBase: "", newBase: "", dishes: [], products: [], skipped: [] };

/** How many names the plan would change besides the ingredient itself. */
export const plannedCount = (p: LinkedRenamePlan): number => p.dishes.length + p.products.length;

export function planLinkedRenames(input: {
  ingredientId: string;
  oldName: string;
  newName: string;
  /** every ingredient (to tell whether a bare name could mean more than one) */
  ingredients: readonly { id: string; name: string }[];
  items: readonly LinkedItem[];
  lines: readonly LinkedLine[];
  products: readonly LinkedProduct[];
}): LinkedRenamePlan {
  const oldBase = baseName(input.oldName);
  const newBase = baseName(input.newName);
  const none: LinkedRenamePlan = { ...EMPTY_PLAN, oldBase, newBase };
  if (!oldBase || !newBase || nameKey(oldBase) === nameKey(newBase)) return none;

  // dishes that really use this ingredient, so a cocktail that merely has the same first words is never touched
  const usedBy = new Set<string>();
  for (const l of input.lines) if (l.parent_type === "item" && l.component_type === "ingredient" && l.component_id === input.ingredientId) usedBy.add(l.parent_id);

  const plan: LinkedRenamePlan = { ...none, dishes: [], products: [], skipped: [] };
  const itemTaken = new Set(input.items.map((i) => `${i.venue_id}|${nameKey(i.name)}`));
  for (const it of input.items) {
    if (!usedBy.has(it.id)) continue;
    const to = swapLeadingBase(it.name, oldBase, newBase);
    if (!to || nameKey(to) === nameKey(it.name)) continue;
    if (itemTaken.has(`${it.venue_id}|${nameKey(to)}`)) {
      plan.skipped.push({ kind: "dish", from: it.name, to, venue_id: it.venue_id, reason: "A dish with that name already exists at this venue." });
      continue;
    }
    plan.dishes.push({ id: it.id, venue_id: it.venue_id, from: it.name, to });
  }

  // a bare name is only trusted to mean THIS ingredient when no other ingredient shares the base
  const sharesBase = input.ingredients.some((g) => g.id !== input.ingredientId && nameKey(baseName(g.name)) === nameKey(oldBase));
  const productTaken = new Set(input.products.map((p) => `${p.venue_id}|${p.category_id}|${nameKey(p.name)}`));
  for (const p of input.products) {
    const pointsHere = p.ingredient_id === input.ingredientId;
    const sameName = p.ingredient_id == null && !sharesBase && nameKey(p.name) === nameKey(oldBase);
    if (!pointsHere && !sameName) continue;
    // a linked product keeps any extra wording after the base (a product called "<base> 1L"); a bare-name match is the base alone
    const to = pointsHere ? (swapLeadingBase(p.name, oldBase, newBase) ?? (nameKey(p.name) === nameKey(oldBase) ? newBase : null)) : newBase;
    if (!to || nameKey(to) === nameKey(p.name)) continue;
    if (productTaken.has(`${p.venue_id}|${p.category_id}|${nameKey(to)}`)) {
      plan.skipped.push({ kind: "product", from: p.name, to, venue_id: p.venue_id, reason: "A product with that name already exists in that category." });
      continue;
    }
    plan.products.push({ id: p.id, venue_id: p.venue_id, from: p.name, to, link: !pointsHere });
  }
  return plan;
}
