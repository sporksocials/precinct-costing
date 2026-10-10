import { buildRows, matrixSections, type MatrixRow } from "./allergy-matrix";
import { matrixDishesForVenue } from "./allergy-matrix-store";
import type { AllergenIndex } from "./allergens";
import { dishCheck, type UnreviewedIngredient } from "./dish-allergens";
import { ALL_SECTIONS, changedSheets, type ChangedSheet, type MatrixPrint } from "./matrix-prints";
import type { MenuItem, Venue } from "./types";

/**
 * The Allergy Matrix To Do hub and its two Home alerts (Troy, 10 Oct 2026). Pure: the costing app's matrix rows go in, lists come out.
 *
 *  a) Dishes Need Approval: active Food dishes with no VALID sign-off, split into "New, never confirmed" (never signed off) and
 *     "Ingredients changed, re-check" (signed off, but the ingredients or their allergen ticks changed since, or the sign-off was made
 *     before changes were tracked). Ingredient-first (Troy, 10 Oct 2026): a dish whose ingredients include any that nobody has reviewed
 *     cannot be confirmed yet, so the same dishes are also split into READY TO CONFIRM and WAITING ON INGREDIENTS (with the distinct
 *     ingredients to check, the work the ingredient review screen does);
 *  b) Marks Disagree: a dish with a valid sign-off whose own allergen list contradicts its GF, V or VG mark;
 *  c) Matrix Needs Reprinting: a sheet (venue and section) that changed since it was last printed. A sheet never printed is not on it.
 *
 * Two kinds of Home alert come from it: "Dishes need allergen approval" and "Matrix needs reprinting", one row per venue. They are
 * safety items, so they can never be ignored (no key is ever saved for them), and they are never part of Home's average GP or status.
 */

export const ALLERGEN_APPROVAL = "allergen_approval" as const;
export const MATRIX_REPRINT = "matrix_reprint" as const;
export type SafetyKind = typeof ALLERGEN_APPROVAL | typeof MATRIX_REPRINT;

/** A dish that needs approval but cannot be confirmed yet. */
export interface BlockedDish {
  row: MatrixRow;
  /** the ingredients in its components that nobody has reviewed, by name */
  unreviewed: UnreviewedIngredient[];
  /** the roll-up could not read everything (a loop, too deep, or something missing) */
  problems: boolean;
}

export interface VenueTodo {
  venue: Pick<Venue, "id" | "slug" | "name">;
  /** every active food dish of the venue, matrix order */
  rows: MatrixRow[];
  /** never signed off */
  never: MatrixRow[];
  /** signed off, but the ingredients changed since (or the sign-off pre-dates tracking) */
  changed: MatrixRow[];
  /** needs approval and can be confirmed now (every ingredient reviewed), matrix order */
  ready: MatrixRow[];
  /** needs approval but waits on ingredients nobody has reviewed, matrix order */
  blocked: BlockedDish[];
  /** the distinct ingredients to check across the blocked dishes, by name */
  blockedIngredients: UnreviewedIngredient[];
  /** valid sign-off whose marks disagree with its allergen list */
  marks: MatrixRow[];
  /** sheets changed since they were last printed */
  reprint: ChangedSheet[];
}

const flat = (rows: readonly MatrixRow[]): MatrixRow[] => matrixSections(rows).flatMap((s) => s.rows);

/** The To Do lists of one venue. `prints` may be null (not loaded yet): nothing is then called changed. */
export function venueTodo(
  venue: Pick<Venue, "id" | "slug" | "name">,
  rows: readonly MatrixRow[],
  prints: readonly MatrixPrint[] | null | undefined,
  nameOf?: (dishId: string) => string | null,
  /** dish id to what blocks it from being confirmed; a dish that needs approval and is not here is ready. Omitted = nothing blocks. */
  blockers?: ReadonlyMap<string, Omit<BlockedDish, "row">>,
): VenueTodo {
  const ordered = flat(rows);
  const never = ordered.filter((r) => r.signOff === "never");
  const changed = ordered.filter((r) => r.signOff === "changed" || r.signOff === "legacy");
  const waiting = new Set([...never, ...changed].map((r) => r.dish.id));
  const needing = ordered.filter((r) => waiting.has(r.dish.id));
  const blocked: BlockedDish[] = needing.flatMap((row) => {
    const b = blockers?.get(row.dish.id);
    return b ? [{ row, unreviewed: b.unreviewed, problems: b.problems }] : [];
  });
  const stuck = new Set(blocked.map((b) => b.row.dish.id));
  const distinct = new Map<string, UnreviewedIngredient>();
  for (const b of blocked) for (const u of b.unreviewed) distinct.set(u.id, u);
  return {
    venue,
    rows: ordered,
    never,
    changed,
    ready: needing.filter((r) => !stuck.has(r.dish.id)),
    blocked,
    blockedIngredients: [...distinct.values()].sort((a, b) => a.name.localeCompare(b.name, "en-AU", { sensitivity: "base" })),
    marks: ordered.filter((r) => r.confirmed && r.warnings.length > 0),
    reprint: prints ? changedSheets(prints, venue.id, ordered, nameOf) : [],
  };
}

/** Every venue's To Do lists, in venue order. */
export function allTodos(venues: readonly Pick<Venue, "id" | "slug" | "name">[], items: readonly MenuItem[], index: AllergenIndex, prints: readonly MatrixPrint[] | null | undefined): VenueTodo[] {
  const names = new Map(items.map((i) => [i.id, i.name]));
  const byId = new Map(items.map((i) => [i.id, i]));
  return venues.map((v) => {
    const rows = buildRows(matrixDishesForVenue(items, index, v.id));
    // only the dishes that need approval are looked at for what blocks them (the roll-up is the costly part)
    const blockers = new Map<string, Omit<BlockedDish, "row">>();
    for (const r of rows) {
      const item = r.signOff === "valid" ? undefined : byId.get(r.dish.id);
      if (!item) continue;
      const c = dishCheck(item, index);
      if (c.blocked) blockers.set(item.id, { unreviewed: c.unreviewed, problems: c.problems });
    }
    return venueTodo(v, rows, prints, (id) => names.get(id) ?? null, blockers);
  });
}

/** Dishes waiting for approval (never signed plus ingredients changed). */
export const approvalCount = (t: Pick<VenueTodo, "never" | "changed">): number => t.never.length + t.changed.length;

/** A Home alert row: one per venue. Not ignorable. */
export interface SafetyAlert {
  kind: SafetyKind;
  /** stable id for lists and tests ("allergen_approval:drift"); never saved anywhere, because these cannot be ignored */
  key: string;
  venueId: number;
  venueSlug: string;
  venueName: string;
  /** dishes waiting (allergen_approval) or sheets changed (matrix_reprint) */
  count: number;
  /** allergen_approval: how many of them were never confirmed, and how many need a re-check */
  never: number;
  changed: number;
  /** allergen_approval: how many can be confirmed now, how many wait on ingredients, and how many distinct ingredients need checking */
  ready: number;
  blocked: number;
  ingredients: number;
  /** where the row opens: the To Do hub for that venue */
  href: string;
}

export const todoHref = (venueSlug: string): string => `/matrix/todo?venue=${venueSlug}`;

/** "Dishes need allergen approval": one row per venue that has any. */
export function allergenApprovalAlerts(todos: readonly VenueTodo[], venueId?: number | null): SafetyAlert[] {
  return todos
    .filter((t) => (venueId == null || t.venue.id === venueId) && approvalCount(t) > 0)
    .map((t) => ({ kind: ALLERGEN_APPROVAL, key: `${ALLERGEN_APPROVAL}:${t.venue.slug}`, venueId: t.venue.id, venueSlug: t.venue.slug, venueName: t.venue.name, count: approvalCount(t), never: t.never.length, changed: t.changed.length, ready: t.ready.length, blocked: t.blocked.length, ingredients: t.blockedIngredients.length, href: todoHref(t.venue.slug) }));
}

/** "Matrix needs reprinting": one row per venue with any sheet changed since it was printed. */
export function reprintAlerts(todos: readonly VenueTodo[], venueId?: number | null): SafetyAlert[] {
  return todos
    .filter((t) => (venueId == null || t.venue.id === venueId) && t.reprint.length > 0)
    .map((t) => ({ kind: MATRIX_REPRINT, key: `${MATRIX_REPRINT}:${t.venue.slug}`, venueId: t.venue.id, venueSlug: t.venue.slug, venueName: t.venue.name, count: t.reprint.length, never: 0, changed: 0, ready: 0, blocked: 0, ingredients: 0, href: todoHref(t.venue.slug) }));
}

/** The words for an approval alert: "5 dishes need allergen approval" / "3 ready to confirm, 2 waiting on 4 ingredients". */
export function approvalTitle(count: number): string {
  return `${count} ${count === 1 ? "dish needs" : "dishes need"} allergen approval`;
}
export function approvalSub(a: Pick<SafetyAlert, "ready" | "blocked" | "ingredients">): string {
  return [a.ready ? `${a.ready} ready to confirm` : "", a.blocked ? waitingText(a.blocked, a.ingredients) : ""].filter(Boolean).join(", ");
}
/** "2 waiting on 4 ingredients to check" (the ingredient part is left out when the wait is not on named ingredients). */
export function waitingText(dishes: number, ingredients: number): string {
  return ingredients > 0 ? `${dishes} waiting on ${ingredients} ${ingredients === 1 ? "ingredient" : "ingredients"} to check` : `${dishes} waiting on ingredients`;
}
export function reprintTitle(venueName: string): string {
  return `${venueName} matrix needs reprinting`;
}
export function reprintSub(count: number): string {
  return `${count} ${count === 1 ? "sheet has" : "sheets have"} changed since printed`;
}

/** The review queue's address: /matrix/review?venue=drift&section=* (or one section's name). */
export function reviewHref(venueSlug: string | null, section: string | null = null): string {
  const p = new URLSearchParams();
  if (venueSlug) p.set("venue", venueSlug);
  p.set("section", section ?? ALL_SECTIONS);
  return `/matrix/review?${p.toString()}`;
}
