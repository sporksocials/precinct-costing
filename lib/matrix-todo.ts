import { buildRows, matrixSections, type MatrixRow } from "./allergy-matrix";
import { matrixDishesForVenue } from "./allergy-matrix-store";
import type { AllergenIndex } from "./allergens";
import { ALL_SECTIONS, changedSheets, type ChangedSheet, type MatrixPrint } from "./matrix-prints";
import type { MenuItem, Venue } from "./types";

/**
 * The Allergy Matrix To Do hub and its two Home alerts (Troy, 10 Oct 2026). Pure: the costing app's matrix rows go in, lists come out.
 *
 *  a) Dishes Need Approval: active Food dishes with no VALID sign-off, split into "New, never confirmed" (never signed off) and
 *     "Ingredients changed, re-check" (signed off, but the ingredients changed since, or the sign-off was made before changes were tracked);
 *  b) Marks Disagree: a dish with a valid sign-off whose own allergen list contradicts its GF, V or VG mark;
 *  c) Matrix Needs Reprinting: a sheet (venue and section) that changed since it was last printed. A sheet never printed is not on it.
 *
 * Two kinds of Home alert come from it: "Dishes need allergen approval" and "Matrix needs reprinting", one row per venue. They are
 * safety items, so they can never be ignored (no key is ever saved for them), and they are never part of Home's average GP or status.
 */

export const ALLERGEN_APPROVAL = "allergen_approval" as const;
export const MATRIX_REPRINT = "matrix_reprint" as const;
export type SafetyKind = typeof ALLERGEN_APPROVAL | typeof MATRIX_REPRINT;

export interface VenueTodo {
  venue: Pick<Venue, "id" | "slug" | "name">;
  /** every active food dish of the venue, matrix order */
  rows: MatrixRow[];
  /** never signed off */
  never: MatrixRow[];
  /** signed off, but the ingredients changed since (or the sign-off pre-dates tracking) */
  changed: MatrixRow[];
  /** valid sign-off whose marks disagree with its allergen list */
  marks: MatrixRow[];
  /** sheets changed since they were last printed */
  reprint: ChangedSheet[];
}

const flat = (rows: readonly MatrixRow[]): MatrixRow[] => matrixSections(rows).flatMap((s) => s.rows);

/** The To Do lists of one venue. `prints` may be null (not loaded yet): nothing is then called changed. */
export function venueTodo(venue: Pick<Venue, "id" | "slug" | "name">, rows: readonly MatrixRow[], prints: readonly MatrixPrint[] | null | undefined, nameOf?: (dishId: string) => string | null): VenueTodo {
  const ordered = flat(rows);
  return {
    venue,
    rows: ordered,
    never: ordered.filter((r) => r.signOff === "never"),
    changed: ordered.filter((r) => r.signOff === "changed" || r.signOff === "legacy"),
    marks: ordered.filter((r) => r.confirmed && r.warnings.length > 0),
    reprint: prints ? changedSheets(prints, venue.id, ordered, nameOf) : [],
  };
}

/** Every venue's To Do lists, in venue order. */
export function allTodos(venues: readonly Pick<Venue, "id" | "slug" | "name">[], items: readonly MenuItem[], index: AllergenIndex, prints: readonly MatrixPrint[] | null | undefined): VenueTodo[] {
  const names = new Map(items.map((i) => [i.id, i.name]));
  return venues.map((v) => venueTodo(v, buildRows(matrixDishesForVenue(items, index, v.id, { review: false })), prints, (id) => names.get(id) ?? null));
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
  /** where the row opens: the To Do hub for that venue */
  href: string;
}

export const todoHref = (venueSlug: string): string => `/matrix/todo?venue=${venueSlug}`;

/** "Dishes need allergen approval": one row per venue that has any. */
export function allergenApprovalAlerts(todos: readonly VenueTodo[], venueId?: number | null): SafetyAlert[] {
  return todos
    .filter((t) => (venueId == null || t.venue.id === venueId) && approvalCount(t) > 0)
    .map((t) => ({ kind: ALLERGEN_APPROVAL, key: `${ALLERGEN_APPROVAL}:${t.venue.slug}`, venueId: t.venue.id, venueSlug: t.venue.slug, venueName: t.venue.name, count: approvalCount(t), never: t.never.length, changed: t.changed.length, href: todoHref(t.venue.slug) }));
}

/** "Matrix needs reprinting": one row per venue with any sheet changed since it was printed. */
export function reprintAlerts(todos: readonly VenueTodo[], venueId?: number | null): SafetyAlert[] {
  return todos
    .filter((t) => (venueId == null || t.venue.id === venueId) && t.reprint.length > 0)
    .map((t) => ({ kind: MATRIX_REPRINT, key: `${MATRIX_REPRINT}:${t.venue.slug}`, venueId: t.venue.id, venueSlug: t.venue.slug, venueName: t.venue.name, count: t.reprint.length, never: 0, changed: 0, href: todoHref(t.venue.slug) }));
}

/** The words for an approval alert: "5 dishes need allergen approval" / "Drift: 2 new, 3 to re-check". */
export function approvalTitle(count: number): string {
  return `${count} ${count === 1 ? "dish needs" : "dishes need"} allergen approval`;
}
export function approvalSub(a: Pick<SafetyAlert, "never" | "changed">): string {
  return [a.never ? `${a.never} new` : "", a.changed ? `${a.changed} to re-check` : ""].filter(Boolean).join(", ");
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
