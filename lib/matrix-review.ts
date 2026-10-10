import { markOff, markOn, readMarks } from "./diet-options";
import type { DietMarkId } from "./diet-legend";
import { allergenLabel, type AllergenId } from "./allergens";
import { DISH_ALLERGEN_IDS, confirmAllergens, proposeContains, readDishAllergens, toStored, type DishAllergens } from "./dish-allergens";
import { ALL_SECTIONS } from "./matrix-prints";
import type { VenueTodo } from "./matrix-todo";
import { groupLabel } from "./kitchen";
import type { DishAllergensEntry, MenuItem, RecipeLine } from "./types";
import type { Rollup } from "./allergens";

/**
 * Review mode (Troy, 10 Oct 2026): /matrix/review steps through the dishes that need approval one at a time. Pure rules; the page
 * (components/matrix/review-page.tsx) draws them and the store writes the result.
 *
 * Nothing is trusted from the ingredients: the chips are PRE-FILLED from the Start From Ingredients proposal (plus whatever the dish
 * already listed) and marked "Suggested: check every one" until a person taps something. Any tap counts as reviewing. Confirming
 * writes the dish's own allergens section with the sign-off and its components, and the three marks, after re-reading the dish from
 * the database: if it changed underneath, nothing is written ("This dish was just changed by someone else. Reload it.").
 */

export interface ReviewItem {
  dishId: string;
  name: string;
  venueId: number;
  venueSlug: string;
  venueName: string;
  /** the section label ("Other" for none) */
  section: string;
}

/**
 * The dishes to review: never confirmed and re-check dishes, venue by venue (venue order), sections A to Z ("Other" last), dishes A to Z.
 * `venueId` limits it to one venue; `section` of `*` (or nothing) is every section, otherwise that section only.
 */
export function reviewQueue(todos: readonly VenueTodo[], opts: { venueId?: number | null; section?: string | null }): ReviewItem[] {
  const want = (opts.section ?? "").trim();
  const out: ReviewItem[] = [];
  for (const t of todos) {
    if (opts.venueId != null && t.venue.id !== opts.venueId) continue;
    // todo rows are already in section then dish order; keep that order
    const waiting = new Set([...t.never, ...t.changed].map((r) => r.dish.id));
    for (const r of t.rows) {
      if (!waiting.has(r.dish.id)) continue;
      const section = groupLabel(r.dish.section);
      if (want && want !== ALL_SECTIONS && section.toLowerCase() !== want.toLowerCase()) continue;
      out.push({ dishId: r.dish.id, name: r.dish.name, venueId: t.venue.id, venueSlug: t.venue.slug, venueName: t.venue.name, section });
    }
  }
  return out;
}

/** "12 of 40, Drift: Small Plates". `index` is 0-based. */
export function progressText(index: number, total: number, item: Pick<ReviewItem, "venueName" | "section">): string {
  return `${index + 1} of ${total}, ${item.venueName}: ${item.section}`;
}

/** The first item of the next venue after `index`, or null when `index` is the last item or the next item is in the same venue. */
export function venueBreak(queue: readonly ReviewItem[], index: number): { done: string; next: string; count: number } | null {
  const cur = queue[index];
  const nxt = queue[index + 1];
  if (!cur || !nxt || cur.venueId === nxt.venueId) return null;
  return { done: cur.venueName, next: nxt.venueName, count: queue.filter((q) => q.venueId === nxt.venueId).length };
}

/* ------------------------------------------------------------------ one dish's draft */

export interface ReviewDraft {
  contains: AllergenId[];
  without: Partial<Record<AllergenId, string>>;
  marks: DietMarkId[];
  /** the diet_options column as the review leaves it (marks switched; an option a mark pushes out is dropped) */
  dietOptions: MenuItem["diet_options"];
  /** ids that came only from a keyword guess on an unreviewed ingredient */
  suggestedOnly: AllergenId[];
  /** a person tapped something: the "Suggested" warning goes away (any tap counts as reviewing) */
  touched: boolean;
}

/** The starting point for a dish: what it already lists plus the ingredient proposal, nothing confirmed, nothing touched. */
export function initialReviewDraft(item: Pick<MenuItem, "dish_allergens" | "diet_options">, rollup: Pick<Rollup, "cells">): ReviewDraft {
  const da = readDishAllergens(item.dish_allergens);
  const prop = proposeContains(rollup);
  const contains = DISH_ALLERGEN_IDS.filter((id) => (da?.contains ?? []).includes(id) || prop.ids.includes(id));
  const without: Partial<Record<AllergenId, string>> = {};
  for (const id of contains) if (da?.without[id]) without[id] = da.without[id];
  return { contains, without, marks: readMarks(item.diet_options), dietOptions: item.diet_options, suggestedOnly: prop.suggestedOnly, touched: false };
}

export function toggleReviewAllergen(d: ReviewDraft, id: AllergenId): ReviewDraft {
  const on = d.contains.includes(id);
  const contains = DISH_ALLERGEN_IDS.filter((x) => (x === id ? !on : d.contains.includes(x)));
  const without = { ...d.without };
  if (on) delete without[id];
  return { ...d, contains, without, touched: true };
}

export function setReviewNote(d: ReviewDraft, id: AllergenId, text: string): ReviewDraft {
  if (!d.contains.includes(id)) return d;
  const without = { ...d.without };
  const t = text.trim().replace(/\s+/g, " ").slice(0, 120);
  if (t) without[id] = t;
  else delete without[id];
  return { ...d, without, touched: true };
}

/** Turns a mark on or off. A mark that cannot sit beside an option the dish already offers removes that option (`clearedOption`). */
export function toggleReviewMark(d: ReviewDraft, id: DietMarkId): { draft: ReviewDraft; clearedOption: string | null } {
  if (d.marks.includes(id)) {
    const next = markOff(d.dietOptions, id);
    return { draft: { ...d, marks: readMarks(next), dietOptions: next, touched: true }, clearedOption: null };
  }
  const { next, clearedOption } = markOn(d.dietOptions, id);
  return { draft: { ...d, marks: readMarks(next), dietOptions: next, touched: true }, clearedOption };
}

/**
 * The chips that are still only a suggestion: until a person taps something, EVERY pre-filled chip is one (filled in from the
 * ingredients and the dish's old list, "Suggested: check every one"). `suggestedOnly` says which of them are a name guess alone.
 */
export function stillSuggested(d: ReviewDraft): AllergenId[] {
  return d.touched ? [] : [...d.contains];
}

/* ------------------------------------------------------------------ writing */

/** The patch a confirm writes: the dish's own allergens section with the sign-off and its components, and the marks if they changed. */
export function confirmPatch(args: { item: Pick<MenuItem, "dish_allergens" | "diet_options">; draft: ReviewDraft; email: string | null; nowIso: string; components: readonly string[] }): Pick<MenuItem, "dish_allergens"> & Partial<Pick<MenuItem, "diet_options">> {
  const cur = readDishAllergens(args.item.dish_allergens);
  const section: DishAllergens = {
    contains: args.draft.contains,
    without: args.draft.without,
    confirmedAt: null,
    confirmedBy: null,
    components: null,
    needsSignoff: cur?.needsSignoff ?? false,
  };
  const dish_allergens: DishAllergensEntry = confirmAllergens(toStored(section), args.email, args.nowIso, args.components);
  const marksChanged = JSON.stringify(args.draft.dietOptions ?? null) !== JSON.stringify(args.item.diet_options ?? null);
  return marksChanged ? { dish_allergens, diet_options: args.draft.dietOptions } : { dish_allergens };
}

export type FreshVerdict = { ok: true } | { ok: false; reason: "gone" | "changed" };

export const REVIEW_CHANGED_TEXT = "This dish was just changed by someone else. Reload it.";
export const REVIEW_GONE_TEXT = "This dish is no longer there. Skip it.";

/**
 * The check before a confirm writes: the dish was read fresh from the database. It must still exist, still carry the updated_at the
 * review showed, and still be made from the same own components (a line added or swapped by someone else means the person is
 * confirming something they have not seen).
 */
export function freshVerdict(fresh: { row: Pick<MenuItem, "updated_at"> | null; lines: readonly Pick<RecipeLine, "component_type" | "component_id">[] }, shown: { updatedAt: string | null | undefined; ownComponents: readonly string[] }): FreshVerdict {
  if (!fresh.row) return { ok: false, reason: "gone" };
  if ((fresh.row.updated_at ?? null) !== (shown.updatedAt ?? null)) return { ok: false, reason: "changed" };
  const own = new Set(fresh.lines.filter((l) => l.component_id).map((l) => `${l.component_type}:${l.component_id}`));
  const was = new Set(shown.ownComponents);
  if (own.size !== was.size || [...own].some((k) => !was.has(k))) return { ok: false, reason: "changed" };
  return { ok: true };
}

/** "Milk, Egg" for the confirmation line. */
export function listText(ids: readonly AllergenId[]): string {
  return ids.length ? ids.map(allergenLabel).join(", ") : "None";
}
