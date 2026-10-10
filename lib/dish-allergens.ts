import { CONTAINS_IDS, allergenLabel, type AllergenId, type Rollup } from "./allergens";
import type { DishAllergensEntry } from "./types";

/**
 * A dish's OWN allergens section (`cost_menu_items.dish_allergens`, Troy, 10 Oct 2026). Pure rules, no React, no database.
 *
 * The Allergy Matrix (lib/allergy-matrix.ts) reads ONLY this, the dish's marks and its options. It never works anything out
 * from ingredients or keyword suggestions. The roll-up is used in exactly two places, both here and both only prompts:
 *  - `proposeContains`: the "Start From Ingredients" button fills the chips as a PROPOSAL the chef then edits (never saves by itself);
 *  - `reviewMissing`: the quiet "Ingredients have changed since this was confirmed" warning (never edits the dish).
 *
 * Stored shape (jsonb, nullable): `{ contains: AllergenId[], without: { [id]: note }, confirmed_at, confirmed_by }`.
 *  - `contains` is the allergens the dish contains as written on the menu, in the fixed `CONTAINS_IDS` order so the same set
 *    always compares equal (tap order never makes a change);
 *  - `without[id]` is "can be made without it, say this" and only exists for an id that is also in `contains`;
 *  - `confirmed_at` / `confirmed_by` are the sign-off. They are left OUT (not null) while the dish is not signed off.
 * ANY edit to `contains` or `without` after a sign-off removes the sign-off, so the dish goes back to Not checked until
 * someone confirms again. Every reader is tolerant: null, a string, an array or a malformed entry reads as "no section".
 */

/** The allergens a chef can tick on a dish: the 15 main ones (required, then chef extras). Alcohol is an attribute and is not offered. */
export const DISH_ALLERGEN_IDS: readonly AllergenId[] = CONTAINS_IDS;
const KNOWN = new Set<string>(DISH_ALLERGEN_IDS);
const ORDER = new Map(DISH_ALLERGEN_IDS.map((id, i) => [id, i] as const));

export const NOTE_MAX = 120;

export interface DishAllergens {
  contains: AllergenId[];
  without: Partial<Record<AllergenId, string>>;
  confirmedAt: string | null;
  confirmedBy: string | null;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function validStamp(v: unknown): string | null {
  return typeof v === "string" && v.trim() && !Number.isNaN(new Date(v).getTime()) ? v.trim() : null;
}

const inOrder = (ids: Iterable<string>): AllergenId[] => [...new Set(ids)].filter((x): x is AllergenId => KNOWN.has(x)).sort((a, b) => (ORDER.get(a) as number) - (ORDER.get(b) as number));

/** The section as a tolerant read, or null when the dish has none (null, absent, or not an object). */
export function readDishAllergens(raw: unknown): DishAllergens | null {
  const o = obj(raw);
  if (!o) return null;
  const contains = inOrder(Array.isArray(o.contains) ? o.contains.filter((x): x is string => typeof x === "string") : []);
  const wo = obj(o.without) ?? {};
  const without: Partial<Record<AllergenId, string>> = {};
  for (const id of contains) {
    const n = wo[id];
    if (typeof n === "string" && n.trim()) without[id] = n.trim().replace(/\s+/g, " ").slice(0, NOTE_MAX);
  }
  return { contains, without, confirmedAt: validStamp(o.confirmed_at), confirmedBy: typeof o.confirmed_by === "string" && o.confirmed_by.trim() ? o.confirmed_by.trim() : null };
}

/** Signed off: the section exists and carries a sign-off time. */
export function isConfirmed(da: DishAllergens | null): boolean {
  return !!da && !!da.confirmedAt;
}

/** The stored form. The sign-off keys are present only while signed off. */
export function toStored(da: DishAllergens): DishAllergensEntry {
  const out: DishAllergensEntry = { contains: [...da.contains], without: Object.fromEntries(da.contains.filter((id) => da.without[id]).map((id) => [id, da.without[id] as string])) };
  if (da.confirmedAt) {
    out.confirmed_at = da.confirmedAt;
    if (da.confirmedBy) out.confirmed_by = da.confirmedBy;
  }
  return out;
}

const blank = (): DishAllergens => ({ contains: [], without: {}, confirmedAt: null, confirmedBy: null });

export interface EditResult {
  next: DishAllergensEntry;
  /** the edit took a sign-off away (the editor says so in plain words) */
  clearedConfirmation: boolean;
}

function edited(before: DishAllergens | null, after: DishAllergens): EditResult {
  const same = !!before && JSON.stringify(toStored({ ...before, confirmedAt: null, confirmedBy: null })) === JSON.stringify(toStored({ ...after, confirmedAt: null, confirmedBy: null }));
  // an edit that changes nothing keeps the sign-off
  if (same && before) return { next: toStored(before), clearedConfirmation: false };
  const cleared = isConfirmed(before);
  return { next: toStored({ ...after, confirmedAt: null, confirmedBy: null }), clearedConfirmation: cleared };
}

/** Tick or untick one allergen. Unticking also drops its "can be made without" note. */
export function toggleAllergen(raw: unknown, id: AllergenId, on: boolean): EditResult {
  const before = readDishAllergens(raw);
  const cur = before ?? blank();
  const contains = on ? inOrder([...cur.contains, id]) : cur.contains.filter((x) => x !== id);
  const without = { ...cur.without };
  if (!on) delete without[id];
  return edited(before, { ...cur, contains, without });
}

/** Set (or clear, with empty text) the "can be made without" note of a ticked allergen. A note for an unticked allergen is ignored. */
export function setWithoutNote(raw: unknown, id: AllergenId, text: string): EditResult {
  const before = readDishAllergens(raw);
  const cur = before ?? blank();
  if (!cur.contains.includes(id)) return edited(before, cur);
  const without = { ...cur.without };
  const t = text.trim().replace(/\s+/g, " ").slice(0, NOTE_MAX);
  if (t) without[id] = t;
  else delete without[id];
  return edited(before, { ...cur, without });
}

/** Replace the ticked allergens with a proposal (notes for ids that stay are kept). Always takes a sign-off away. */
export function applyProposal(raw: unknown, ids: readonly AllergenId[]): EditResult {
  const before = readDishAllergens(raw);
  const cur = before ?? blank();
  const contains = inOrder(ids);
  const without: Partial<Record<AllergenId, string>> = {};
  for (const id of contains) if (cur.without[id]) without[id] = cur.without[id];
  return edited(before, { ...cur, contains, without });
}

/** The head chef's sign-off: stamps the time and the signed-in email into the section. */
export function confirmAllergens(raw: unknown, email: string | null | undefined, nowIso: string): DishAllergensEntry {
  const cur = readDishAllergens(raw) ?? blank();
  return toStored({ ...cur, confirmedAt: nowIso, confirmedBy: email?.trim() || null });
}

/**
 * A copy for a duplicated dish: the lists carry over, the sign-off does not (a copy is a new dish and somebody has to check
 * it). Returns the input unchanged when there is nothing stored.
 */
export function unconfirmedCopy(raw: unknown): DishAllergensEntry | null | undefined {
  const da = readDishAllergens(raw);
  if (!da) return raw as null | undefined;
  return toStored({ ...da, confirmedAt: null, confirmedBy: null });
}

/* ------------------------------------------------------------------ the only two places ingredients are looked at */

export interface Proposal {
  /** every allergen the roll-up lists as contained or suggested, in the fixed order */
  ids: AllergenId[];
  /** the ones that are only a keyword suggestion on an unreviewed ingredient (the chef must decide) */
  suggestedOnly: AllergenId[];
}

/** The chips "Start From Ingredients" fills in. A proposal for the chef to edit: it saves nothing. */
export function proposeContains(r: Pick<Rollup, "cells">): Proposal {
  const ids: AllergenId[] = [];
  const suggestedOnly: AllergenId[] = [];
  for (const id of DISH_ALLERGEN_IDS) {
    const s = r.cells[id]?.state;
    if (s === "contains") ids.push(id);
    else if (s === "may_contain") {
      ids.push(id);
      suggestedOnly.push(id);
    }
  }
  return { ids, suggestedOnly };
}

/**
 * Allergens the ingredients now list as CONTAINED (confirmed ticks, not keyword guesses) that the dish's own section does
 * not carry. A review prompt for the head chef and the staff list; it never changes a cell.
 */
export function reviewMissing(da: DishAllergens | null, r: Pick<Rollup, "cells"> | null): AllergenId[] {
  if (!da || !r) return [];
  return DISH_ALLERGEN_IDS.filter((id) => r.cells[id]?.state === "contains" && !da.contains.includes(id));
}

export const REVIEW_WARNING = "Ingredients have changed since this was confirmed.";

/** "Ingredients have changed since this was confirmed. They now list Milk, which is not ticked above." */
export function reviewWarningText(missing: readonly AllergenId[]): string {
  if (!missing.length) return "";
  return `${REVIEW_WARNING} They now list ${missing.map(allergenLabel).join(", ")}, which ${missing.length === 1 ? "is" : "are"} not ticked above. Check it and confirm again.`;
}

/** A short phrase for history, undo and conflict wording: "3 allergens, confirmed" or "None ticked, not confirmed". */
export function describeDishAllergens(raw: unknown): string {
  const da = readDishAllergens(raw);
  if (!da) return "None";
  const n = da.contains.length;
  const list = n ? da.contains.map(allergenLabel).join(", ") : "None ticked";
  return `${list}${Object.keys(da.without).length ? ` (${Object.keys(da.without).length} can be made without)` : ""}, ${da.confirmedAt ? "confirmed" : "not confirmed"}`;
}
