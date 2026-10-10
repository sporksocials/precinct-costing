import { markOff, markOn, readMarks } from "./diet-options";
import type { DietMarkId } from "./diet-legend";
import { allergenLabel, type AllergenId } from "./allergens";
import { DISH_ALLERGEN_IDS, NOTE_MAX, confirmAllergens, extrasOf, readDishAllergens, type DishCheck } from "./dish-allergens";
import { ALL_SECTIONS } from "./matrix-prints";
import type { VenueTodo } from "./matrix-todo";
import { groupLabel } from "./kitchen";
import type { DishAllergensEntry, MenuItem, RecipeLine } from "./types";

/**
 * Review mode (Troy, 10 Oct 2026): /matrix/review steps through the dishes that need approval one at a time. Pure rules; the page
 * (components/matrix/review-page.tsx) draws them and the store writes the result.
 *
 * Ingredient first (Troy, 10 Oct 2026): the dish's allergens are worked out from its ingredients, so Review mode shows them as read-only chips
 * (nobody ticks them), lets a person add an EXTRA allergen, fill the can-be-made-without notes and set the three marks, then Confirm And Next
 * accepts the computed result. A dish with any unreviewed ingredient cannot be confirmed (the page names them and links to the ingredient
 * review). Confirming writes the dish's allergens section with the sign-off, its components and the ticks snapshot, after re-reading the
 * dish and its ingredients from the database: if the dish changed underneath, or what the ingredients give is no longer what was shown,
 * nothing is written ("This dish was just changed by someone else. Reload it.").
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
 * The dishes to review: never confirmed and re-check dishes that are READY (every ingredient reviewed), venue by venue (venue order), sections A to Z ("Other" last), dishes A to Z.
 * `venueId` limits it to one venue; `section` of `*` (or nothing) is every section, otherwise that section only.
 */
export function reviewQueue(todos: readonly VenueTodo[], opts: { venueId?: number | null; section?: string | null }): ReviewItem[] {
  const want = (opts.section ?? "").trim();
  const out: ReviewItem[] = [];
  for (const t of todos) {
    if (opts.venueId != null && t.venue.id !== opts.venueId) continue;
    // todo rows are already in section then dish order; keep that order
    // only dishes that can be confirmed now (every ingredient reviewed): a dish waiting on ingredients cannot be confirmed here
    const waiting = new Set(t.ready.map((r) => r.dish.id));
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
  /** the dish's extras: allergens the ingredients do not show (the only allergen edit a person makes) */
  added: AllergenId[];
  without: Partial<Record<AllergenId, string>>;
  marks: DietMarkId[];
  /** the diet_options column as the review leaves it (marks switched; an option a mark pushes out is dropped) */
  dietOptions: MenuItem["diet_options"];
  /** a person changed something on this dish (an extra, a note or a mark) */
  touched: boolean;
}

/** What the dish contains right now: derived from the ingredients plus the draft's extras, in the fixed order. */
export function reviewContains(d: Pick<ReviewDraft, "added">, derived: readonly AllergenId[]): AllergenId[] {
  return DISH_ALLERGEN_IDS.filter((id) => derived.includes(id) || d.added.includes(id));
}

/** The starting point for a dish: its stored extras and notes. The allergens themselves come from the ingredients, not from here. */
export function initialReviewDraft(item: Pick<MenuItem, "dish_allergens" | "diet_options">, derived: readonly AllergenId[]): ReviewDraft {
  const da = readDishAllergens(item.dish_allergens);
  const added = extrasOf(da?.added ?? [], derived);
  const without: Partial<Record<AllergenId, string>> = {};
  for (const id of reviewContains({ added }, derived)) if (da?.without[id]) without[id] = da.without[id];
  return { added, without, marks: readMarks(item.diet_options), dietOptions: item.diet_options, touched: false };
}

/** Adds or removes an EXTRA allergen. An allergen the ingredients show cannot be switched off here: fix the ingredient. */
export function toggleReviewExtra(d: ReviewDraft, id: AllergenId, derived: readonly AllergenId[]): ReviewDraft {
  if (derived.includes(id)) return d;
  const on = d.added.includes(id);
  const added = DISH_ALLERGEN_IDS.filter((x) => (x === id ? !on : d.added.includes(x)));
  const without = { ...d.without };
  if (on) delete without[id];
  return { ...d, added, without, touched: true };
}

export function setReviewNote(d: ReviewDraft, id: AllergenId, text: string, derived: readonly AllergenId[]): ReviewDraft {
  if (!reviewContains(d, derived).includes(id)) return d;
  const without = { ...d.without };
  const t = text.trim().replace(/\s+/g, " ").slice(0, NOTE_MAX);
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

/* ------------------------------------------------------------------ writing */

/**
 * The patch a confirm writes: the dish's allergens section (derived from the ingredients, plus the extras and notes in the draft)
 * with the sign-off, the components and the ticks snapshot, and the marks if they changed. `check` is the dish's check worked out
 * from the FRESH data in the store, never from what the screen showed.
 */
export function confirmPatch(args: { item: Pick<MenuItem, "dish_allergens" | "diet_options">; draft: ReviewDraft; email: string | null; nowIso: string; check: Pick<DishCheck, "derived" | "live"> }): Pick<MenuItem, "dish_allergens"> & Partial<Pick<MenuItem, "diet_options">> {
  const { derived, live } = args.check;
  const cur = readDishAllergens(args.item.dish_allergens);
  const section: DishAllergensEntry = { contains: reviewContains(args.draft, derived), without: args.draft.without, added: args.draft.added, ...(cur?.needsSignoff ? { needs_signoff: true } : {}) };
  const dish_allergens: DishAllergensEntry = confirmAllergens(section, args.email, args.nowIso, { derived, components: live.components, ticks: live.ticks });
  const marksChanged = JSON.stringify(args.draft.dietOptions ?? null) !== JSON.stringify(args.item.diet_options ?? null);
  return marksChanged ? { dish_allergens, diet_options: args.draft.dietOptions } : { dish_allergens };
}

export type FreshVerdict = { ok: true } | { ok: false; reason: "gone" | "changed" | "unreviewed" };

export const REVIEW_CHANGED_TEXT = "This dish was just changed by someone else. Reload it.";
export const REVIEW_UNREVIEWED_TEXT = "This dish has ingredients that still need their allergens checked, so it cannot be confirmed yet.";
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
