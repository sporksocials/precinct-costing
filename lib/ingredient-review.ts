import { CONTAINS_IDS, type AllergenId } from "./allergens";
import { currentComponents } from "./dish-allergens";
import { parentKey } from "./costing";
import type { Ingredient, MenuItem, Prep, RecipeLine } from "./types";

/**
 * Ingredient allergen review (Troy, 10 Oct 2026, ingredient-first allergens): /allergens/review steps through the ingredients that
 * active Food dishes use and nobody has reviewed yet, one at a time, so each is checked ONCE. Allergens are ticked only on
 * ingredients; a dish's allergens are worked out from them, so a dish cannot be confirmed while one of its ingredients is
 * unreviewed. Pure rules here; the page (components/ingredient-review/review-page.tsx) draws them and the store writes the result.
 *
 * Nothing is trusted from a suggestion: the chips start from what a person already ticked plus the name and Smart Tidy suggestions
 * (shown dashed, with the word Suggested, until a person taps anything), and nothing is saved until Confirm And Next.
 */

export interface ReviewDish {
  id: string;
  name: string;
  venueId: number;
}

export interface ReviewIngredient {
  ingredientId: string;
  name: string;
  category: string;
  /** the active Food dishes that use it (directly or through preps), A to Z; in the venue filter's venue only when one is given */
  dishes: ReviewDish[];
}

export interface ReviewOptions {
  /** limit to the ingredients this one dish uses */
  dishId?: string | null;
  /** limit to the ingredients the dishes of this venue use (and list only that venue's dishes) */
  venueId?: number | null;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });

/** An active Food dish: the only kind whose allergens are worked out from its ingredients. */
export const isReviewDish = (item: Pick<MenuItem, "active" | "category">): boolean => !!item.active && item.category === "Food";

/**
 * The ingredients to review: in the component closure (own lines plus every nested prep, the same walk the dish sign-off uses) of
 * any active Food dish, and not yet reviewed (`allergens_reviewed` is not true). Most dishes first, then name A to Z. Inactive
 * dishes and non-Food items are ignored. An inactive ingredient that an active dish still uses stays in: the dish cannot be
 * confirmed without it. Cycle safe and depth capped by `currentComponents`.
 */
export function ingredientsToReview(
  items: readonly Pick<MenuItem, "id" | "name" | "venue_id" | "active" | "category">[],
  lines: readonly RecipeLine[],
  ingredients: readonly Pick<Ingredient, "id" | "name" | "category" | "allergens_reviewed">[],
  preps: readonly Pick<Prep, "id">[],
  opts: ReviewOptions = {},
): ReviewIngredient[] {
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const prepIds = new Set(preps.map((p) => p.id));
  // lines of a prep that no longer exists must not be followed
  const linesByParent = new Map<string, RecipeLine[]>();
  for (const l of lines) {
    if (l.parent_type === "prep" && !prepIds.has(l.parent_id)) continue;
    const k = parentKey(l.parent_type, l.parent_id);
    const list = linesByParent.get(k);
    if (list) list.push(l);
    else linesByParent.set(k, [l]);
  }

  const dishesFor = new Map<string, ReviewDish[]>();
  for (const item of items) {
    if (!isReviewDish(item)) continue;
    if (opts.venueId != null && item.venue_id !== opts.venueId) continue;
    const dish: ReviewDish = { id: item.id, name: item.name, venueId: item.venue_id };
    for (const key of currentComponents("item", item.id, linesByParent)) {
      if (!key.startsWith("ingredient:")) continue;
      const id = key.slice("ingredient:".length);
      const list = dishesFor.get(id);
      if (list) list.push(dish);
      else dishesFor.set(id, [dish]);
    }
  }

  const out: ReviewIngredient[] = [];
  for (const [id, dishes] of dishesFor) {
    const ing = byId.get(id);
    if (!ing || ing.allergens_reviewed === true) continue;
    // a single dish asked for: only the ingredients that dish uses, but the page still names every dish they appear in
    if (opts.dishId && !dishes.some((d) => d.id === opts.dishId)) continue;
    out.push({ ingredientId: id, name: ing.name, category: ing.category ?? "", dishes: [...dishes].sort(byName) });
  }
  return out.sort((a, b) => b.dishes.length - a.dishes.length || byName(a, b));
}

/** "Used in 5 dishes: Fish Tacos, Burger, Caesar Salad and 2 more." */
export function usedInText(dishes: readonly Pick<ReviewDish, "name">[], show = 3): string {
  const n = dishes.length;
  if (!n) return "Not used in any active dish.";
  const names = dishes.slice(0, show).map((d) => d.name);
  const rest = n - names.length;
  const list = rest > 0 ? `${names.join(", ")} and ${rest} more` : names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  return `Used in ${n} ${n === 1 ? "dish" : "dishes"}: ${list}.`;
}

/** "12 of 158" (`index` is 0-based). */
export function progressText(index: number, total: number): string {
  return `${Math.min(index + 1, total)} of ${total}`;
}

/** The count line on the Ingredients list. Null when nothing is waiting. */
export function needsCheckText(n: number): string | null {
  return n > 0 ? `${n} ${n === 1 ? "ingredient needs" : "ingredients need"} their allergens checked` : null;
}

/* ------------------------------------------------------------------ one ingredient's ticks */

const ORDER = new Map<AllergenId, number>(CONTAINS_IDS.map((id, i) => [id, i]));

/** Only the 15 main allergens, once each, in the fixed order. */
export function mainOnly(ids: Iterable<string>): AllergenId[] {
  return [...new Set(ids)].filter((x): x is AllergenId => ORDER.has(x as AllergenId)).sort((a, b) => (ORDER.get(a) as number) - (ORDER.get(b) as number));
}

/**
 * The chips as they first show: what a person already ticked on the ingredient, plus the proposals (name keywords and Smart Tidy).
 * Proposals never include something already ticked.
 */
export function startingTicks(confirmed: Iterable<string>, proposed: Iterable<string>): AllergenId[] {
  return mainOnly([...confirmed, ...proposed]);
}

/** Ids that are only a proposal (not already ticked by a person). */
export function proposalOnly(confirmed: Iterable<string>, proposed: Iterable<string>): AllergenId[] {
  const have = new Set(confirmed);
  return mainOnly(proposed).filter((id) => !have.has(id));
}

/** Tick or untick one chip; the result stays in the fixed order. */
export function toggleTick(ticks: readonly AllergenId[], id: AllergenId): AllergenId[] {
  return mainOnly(ticks.includes(id) ? ticks.filter((x) => x !== id) : [...ticks, id]);
}

/**
 * What Confirm And Next writes: the ticked main allergens (fixed order) and `allergens_reviewed: true`. Anything on the ingredient that
 * is not one of the 15 (the alcohol attribute) is kept exactly as it was. Nothing ticked is a valid answer: it means "contains none".
 */
export function confirmPayload(existing: readonly string[] | null | undefined, ticks: readonly string[]): { allergens: string[]; allergens_reviewed: true } {
  const kept = (existing ?? []).filter((x) => !ORDER.has(x as AllergenId));
  return { allergens: [...mainOnly(ticks), ...new Set(kept)], allergens_reviewed: true };
}

/* ------------------------------------------------------------------ the queue as the person moves through it */

export interface Walk {
  /** ingredient ids in the order they will be shown; fixed when the page opens, except Skip sends one to the end once */
  order: string[];
  /** 0-based position in `order` */
  i: number;
  /** ids already sent to the end once */
  skipped: string[];
}

export const startWalk = (ids: readonly string[]): Walk => ({ order: [...ids], i: 0, skipped: [] });

/** The current ingredient id, or null once the walk has gone past the last one. */
export const currentId = (w: Walk): string | null => w.order[w.i] ?? null;

/** After Confirm: the next one. */
export const advance = (w: Walk): Walk => ({ ...w, i: Math.min(w.i + 1, w.order.length) });

/** Back: the one before (never below the first). */
export const stepBack = (w: Walk): Walk => ({ ...w, i: Math.max(0, w.i - 1) });

/**
 * Skip: the first time, the ingredient moves to the end of the queue and the next one slides into its place. Skipping one that was
 * already sent to the end once just moves on, so skipping can never loop forever.
 */
export function skip(w: Walk): Walk {
  const id = currentId(w);
  if (id == null) return w;
  if (w.skipped.includes(id) || w.i === w.order.length - 1) return { ...w, i: w.i + 1, skipped: w.skipped.includes(id) ? w.skipped : [...w.skipped, id] };
  const order = [...w.order.slice(0, w.i), ...w.order.slice(w.i + 1), id];
  return { ...w, order, skipped: [...w.skipped, id] };
}

/** True once the walk is past the last ingredient. */
export const isFinished = (w: Walk): boolean => w.i >= w.order.length;

/** The ids in the walk that were not confirmed (skipped, or stepped over). */
export const leftOver = (w: Walk, confirmed: ReadonlySet<string>): string[] => w.order.filter((id) => !confirmed.has(id));
