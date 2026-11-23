import { nameKey } from "./rename";

/**
 * Rename everywhere (Troy, 13 Oct 2026: "if we change the bottle name, the nips and anything else associated with it should
 * change as well as the ordering"). Renaming an ingredient offers to carry the new name to the DISHES that are named after it:
 * the ones that use it and start with its name (a spirit's "- 30ml Nip" menu item). Pure rules, no store and no database, so
 * the preview and the tests see the same plan the screen applies. Nothing here writes.
 *
 * ORDER ITEMS are not part of the plan any more (one card per product, Troy, 23 Nov 2026): an order item that has an
 * ingredient carries the ingredient's FULL name, kept by the database (trigger ordering_products_follow_ingredient), so they
 * follow every rename by themselves at every venue. The plan's `products` list is therefore always empty (it is kept so the
 * callers that read it keep working). What this file does for order items is the CHECK BEFORE SAVING: `orderItemRenameClash`
 * says in plain words when the new name is already taken on a venue's order list, so the rename is refused before the
 * database refuses it.
 *
 * The part of an ingredient's name that the dishes copy is its BASE: the name without the trailing size in brackets, so
 * "Bombay Sapphire London Dry Gin (700ml)" has the base "Bombay Sapphire London Dry Gin". A rename that keeps the base (only the
 * size changed) carries nothing to the dishes.
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
  /** absent on rows read without it: such a row counts as active */
  active?: boolean | null;
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
  /** always empty since 23 Nov 2026: order items follow the ingredient's name in the database */
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
  /** not read any more (order items follow in the database); accepted so older callers need no change */
  products?: readonly LinkedProduct[];
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

  return plan;
}

/* ------------------------------------------------------------------ order items: the check before saving */

export interface OrderItemClash {
  venue_id: number;
  /** the order item that already holds the new name on that venue's list */
  taken_by: string;
}

/**
 * Would renaming this ingredient collide on a venue's order list? An order item carries its ingredient's full name and a name
 * is unique within a venue's category, so the database would refuse the rename when an ACTIVE order item of this ingredient
 * sits in the same category as ANOTHER active order item that already has the new name (an item with no ingredient that was
 * typed with that name, in practice). An inactive holder never blocks: the database moves it aside (" (old)"). Names compare
 * exactly as the database compares them, capitals and all. Returns the first clash, or null.
 */
export function orderItemRenameClash(input: { ingredientId: string; newName: string; products: readonly LinkedProduct[] }): OrderItemClash | null {
  const name = input.newName.trim();
  if (!name) return null;
  const mine = input.products.filter((p) => p.ingredient_id === input.ingredientId && p.active !== false);
  for (const m of mine) {
    const other = input.products.find((p) => p.id !== m.id && p.ingredient_id !== input.ingredientId && p.active !== false && p.venue_id === m.venue_id && p.category_id === m.category_id && p.name === name);
    if (other) return { venue_id: m.venue_id, taken_by: other.name };
  }
  return null;
}

/** "Drift's order list already has a product called Coke in the same category. Pick a different name, or rename that one first." */
export function orderItemClashMessage(clash: OrderItemClash, venueName: string | null | undefined): string {
  const where = venueName ? `${venueName}'s order list` : "An order list";
  return `${where} already has a product called ${clash.taken_by} in the same category. Pick a different name, or rename that one first.`;
}
