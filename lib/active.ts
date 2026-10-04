import type { Ingredient, Offer } from "./types";

/**
 * ACTIVE vs DELETE: one rule for every kind of record (menu items, preps, ingredients, tap beers, gelato serves,
 * supplier deals, offers). Troy: "active/not active across the board, and rather than deleting things, mark them not active".
 *
 * What INACTIVE means, everywhere:
 *  - hidden from lists unless "Show Inactive" is on (rows then read dimmer and carry an "Inactive" tag);
 *  - left out of GP averages, Below Target and the other Today alerts, price suggestions, the bar and kitchen stations,
 *    specials and happy hour views, and the allergen / menu labels grid;
 *  - not offered by smart-add or in any picker when building a new recipe or offer;
 *  - demoted in search (still findable);
 *  - NEVER deleted, and NEVER breaks costing: an inactive record that active recipes still use keeps costing exactly
 *    as before. The page says so ("They keep their cost").
 *
 * What DELETE means: permanent, and only for a record nothing else uses. It always opens the impact sheet first
 * (components/active-parts.tsx DeleteRecordSheet, decided by lib/record-usage.ts deleteDecision) and offers
 * "Make Inactive Instead" before "Delete Permanently".
 *
 * Offers have no `active` column: their `status` carries it, and "retired" is the inactive state.
 */

/** The label and sub line on every Active switch. Cocktails, mocktails and cold drinks keep "Show On Drinks Station" (same flag). */
export const ACTIVE_LABEL = "Active";
export const ACTIVE_SUB = "Off hides it from lists, averages and alerts. Nothing is deleted.";
/** Tap beers keep their own label because the team asked what "On Tap" meant; the sub line explains it. */
export const TAP_ACTIVE_LABEL = "On Tap";
export const TAP_ACTIVE_SUB = "Off means this keg is not on tap. It is hidden from lists, averages and alerts. Nothing is deleted.";
/** The small tag on an inactive row. */
export const INACTIVE_TAG = "Inactive";

/** The text of the Show Inactive button: "Show Inactive (3)" / "Hide Inactive". */
export function showInactiveLabel(show: boolean, count: number): string {
  return show ? "Hide Inactive" : `Show Inactive (${count})`;
}

/** A record is active unless it says otherwise (a missing flag counts as active, like the database default). */
export const isActive = (x: { active?: boolean | null }): boolean => x.active !== false;

/** An offer is inactive once it is retired. */
export const offerIsActive = (o: Pick<Offer, "status">): boolean => o.status !== "retired";

/** How many records of `list` are inactive. */
export function countInactive<T>(list: readonly T[], active: (x: T) => boolean = (x) => isActive(x as { active?: boolean | null })): number {
  let n = 0;
  for (const x of list) if (!active(x)) n += 1;
  return n;
}

/** The records a list shows: everything when Show Inactive is on, otherwise only the active ones. */
export function visibleRecords<T>(list: readonly T[], showInactive: boolean, active: (x: T) => boolean = (x) => isActive(x as { active?: boolean | null })): T[] {
  return showInactive ? [...list] : list.filter(active);
}

/**
 * The Ingredients list. Default: active ingredients that a recipe uses (or all active ones once searching or Show Unused is on).
 * Show Inactive adds every inactive ingredient on top of that, used or not, because someone asking for them wants to see them.
 */
export function ingredientListPool(input: {
  ingredients: readonly Ingredient[];
  inUse: ReadonlySet<string>;
  showUnused: boolean;
  showInactive: boolean;
  searching: boolean;
}): Ingredient[] {
  const { ingredients, inUse, showUnused, showInactive, searching } = input;
  const out: Ingredient[] = [];
  for (const i of ingredients) {
    if (!isActive(i)) {
      if (showInactive) out.push(i);
      continue;
    }
    if (showUnused || searching || inUse.has(i.id)) out.push(i);
  }
  return out;
}
