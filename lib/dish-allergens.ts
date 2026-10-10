import { CONTAINS_IDS, allergenLabel, type AllergenId, type Rollup } from "./allergens";
import type { DishAllergensEntry, RecipeLine } from "./types";

/**
 * A dish's OWN allergens section (`cost_menu_items.dish_allergens`, Troy, 10 Oct 2026). Pure rules, no React, no database.
 *
 * The Allergy Matrix (lib/allergy-matrix.ts) reads ONLY this, the dish's marks and its options. It never works anything out
 * from ingredients or keyword suggestions. The roll-up is used in exactly three places, all here or in the editor and all only
 * prompts or reference:
 *  - `proposeContains`: the "Start From Ingredients" button (and Review mode) fills the chips as a PROPOSAL the chef then edits;
 *  - the hints under each chip ("from: Soy Sauce"), which only name the ingredients that suggest it;
 *  - `reviewMissing`: the quiet "Ingredients have changed since this was confirmed" warning (never edits the dish).
 *
 * Stored shape (jsonb, nullable): `{ contains: AllergenId[], without: { [id]: note }, confirmed_at, confirmed_by, components, needs_signoff }`.
 *  - `contains` is the allergens the dish contains as written on the menu, in the fixed `CONTAINS_IDS` order so the same set
 *    always compares equal (tap order never makes a change);
 *  - `without[id]` is "can be made without it, say this" and only exists for an id that is also in `contains`;
 *  - `confirmed_at` / `confirmed_by` are the sign-off. They are left OUT (not null) while the dish is not signed off;
 *  - `components` is the sorted unique list of "ingredient:<id>" and "prep:<id>" the dish was made from WHEN it was signed off,
 *    through every nested prep (see `currentComponents`). It is stored with the sign-off and only with it;
 *  - `needs_signoff` marks a NEW food dish: it starts off the menu and its Active switch stays locked until it is signed off.
 *
 * RE-CHECK RULE (Troy, 10 Oct 2026, fail safe): a sign-off is only valid while the dish's CURRENT components are exactly the
 * stored ones. Swap, add or remove an ingredient or prep anywhere in the nesting and the sign-off stops counting (every cell
 * reads Not checked until somebody confirms again); changing only amounts does not. A sign-off with no `components` (made
 * before this rule) is not valid either. The sign-off is never deleted by this, it just stops being valid. The matrix, the
 * print, the editor, the To Do hub and the alerts all decide "confirmed" through `signOffState`, and the kitchen feed applies
 * the same rule in SQL (migration 20261010170000).
 *
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
  /** the components at sign-off time, sorted and unique; null = none stored (never signed off, or signed off before the re-check rule) */
  components: string[] | null;
  /** a new food dish that has not been signed off yet (its Active switch is locked) */
  needsSignoff: boolean;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function validStamp(v: unknown): string | null {
  return typeof v === "string" && v.trim() && !Number.isNaN(new Date(v).getTime()) ? v.trim() : null;
}

const inOrder = (ids: Iterable<string>): AllergenId[] => [...new Set(ids)].filter((x): x is AllergenId => KNOWN.has(x)).sort((a, b) => (ORDER.get(a) as number) - (ORDER.get(b) as number));
const sortedUnique = (xs: Iterable<string>): string[] => [...new Set(xs)].sort();

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
  return {
    contains,
    without,
    confirmedAt: validStamp(o.confirmed_at),
    confirmedBy: typeof o.confirmed_by === "string" && o.confirmed_by.trim() ? o.confirmed_by.trim() : null,
    components: Array.isArray(o.components) ? sortedUnique(o.components.filter((x): x is string => typeof x === "string" && x.trim() !== "")) : null,
    needsSignoff: o.needs_signoff === true,
  };
}

/** The section carries a sign-off time. This says nothing about whether it is still VALID: use `signOffState` to decide. */
export function isConfirmed(da: DishAllergens | null): boolean {
  return !!da && !!da.confirmedAt;
}

/* ------------------------------------------------------------------ the re-check rule */

/** How deep into nested preps the component list reads (the dish's own lines are level 0). `cost_kitchen_matrix` uses the same number. */
export const COMPONENT_DEPTH = 8;

/** "ingredient:<id>" or "prep:<id>": one entry of the stored `components` list. */
export function componentKey(type: "ingredient" | "prep", id: string): string {
  return `${type}:${id}`;
}

type ComponentLine = Pick<RecipeLine, "component_type" | "component_id">;

/**
 * Every ingredient and prep a dish (or a prep) is made from RIGHT NOW: its own lines, then the lines of every prep they use, and
 * so on, sorted and unique. Cycle safe (a prep is read once, at its shallowest level), capped at COMPONENT_DEPTH levels (the
 * same cap as the SQL feed, so the app and the iPad agree). A blank line (no component yet) is ignored. Amounts, notes and
 * order never matter. `linesByParent` is keyed `item:<id>` / `prep:<id>` like the costing index.
 */
export function currentComponents(kind: "item" | "prep", id: string, linesByParent: ReadonlyMap<string, readonly ComponentLine[]>): string[] {
  const out = new Set<string>();
  const read = new Set<string>();
  let frontier = [`${kind}:${id}`];
  for (let level = 0; level <= COMPONENT_DEPTH && frontier.length; level++) {
    const next: string[] = [];
    for (const parent of frontier) {
      for (const l of linesByParent.get(parent) ?? []) {
        if (!l.component_id) continue;
        out.add(componentKey(l.component_type, l.component_id));
        if (l.component_type === "prep" && level < COMPONENT_DEPTH && !read.has(l.component_id)) {
          read.add(l.component_id);
          next.push(`prep:${l.component_id}`);
        }
      }
    }
    frontier = next;
  }
  return sortedUnique(out);
}

/** The same set of components (order and repeats do not matter). */
export function sameComponents(a: readonly string[], b: readonly string[]): boolean {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((k) => y.has(k));
}

/**
 * valid    signed off, and the dish is still made from exactly what was signed
 * changed  signed off, but an ingredient or prep was swapped, added or removed since (anywhere in the nesting): needs a re-check
 * legacy   signed off before the re-check rule existed (no stored components): treated like changed, fail safe
 * never    not signed off
 */
export type SignOffState = "valid" | "changed" | "legacy" | "never";

export function signOffState(da: DishAllergens | null, current: readonly string[]): SignOffState {
  if (!da || !da.confirmedAt) return "never";
  if (!da.components) return "legacy";
  return sameComponents(da.components, current) ? "valid" : "changed";
}

/** The ONE test of "this dish counts as confirmed". */
export function isSignOffValid(da: DishAllergens | null, current: readonly string[]): boolean {
  return signOffState(da, current) === "valid";
}

/** The section as the matrix should read it: the sign-off removed unless it is valid, so every cell reads Not checked. The lists stay. */
export function effectiveAllergens(da: DishAllergens | null, current: readonly string[]): DishAllergens | null {
  if (!da) return null;
  return isSignOffValid(da, current) ? da : { ...da, confirmedAt: null, confirmedBy: null };
}

/** The line under the status when a sign-off has stopped counting. Null for valid and never. */
export function staleSignOffText(state: SignOffState, signedOn: string): string | null {
  if (state === "changed") return `Ingredients changed since ${signedOn}. Re-check and confirm again.`;
  if (state === "legacy") return `Confirmed on ${signedOn}, before ingredient changes were tracked. Re-check and confirm again.`;
  return null;
}

/** The stored form. The sign-off keys are present only while signed off. */
export function toStored(da: DishAllergens): DishAllergensEntry {
  const out: DishAllergensEntry = { contains: [...da.contains], without: Object.fromEntries(da.contains.filter((id) => da.without[id]).map((id) => [id, da.without[id] as string])) };
  if (da.confirmedAt) {
    out.confirmed_at = da.confirmedAt;
    if (da.confirmedBy) out.confirmed_by = da.confirmedBy;
    if (da.components) out.components = [...da.components];
  } else if (da.needsSignoff) out.needs_signoff = true;
  return out;
}

const blank = (): DishAllergens => ({ contains: [], without: {}, confirmedAt: null, confirmedBy: null, components: null, needsSignoff: false });

/** The section a NEW food dish starts with: nothing ticked, not signed off, and its Active switch locked until it is. */
export function newDishAllergens(): DishAllergensEntry {
  return toStored({ ...blank(), needsSignoff: true });
}

export interface EditResult {
  next: DishAllergensEntry;
  /** the edit took a sign-off away (the editor says so in plain words) */
  clearedConfirmation: boolean;
}

function edited(before: DishAllergens | null, after: DishAllergens): EditResult {
  const bare = (d: DishAllergens): DishAllergens => ({ ...d, confirmedAt: null, confirmedBy: null, components: null });
  const same = !!before && JSON.stringify(toStored(bare(before))) === JSON.stringify(toStored(bare(after)));
  // an edit that changes nothing keeps the sign-off
  if (same && before) return { next: toStored(before), clearedConfirmation: false };
  const cleared = isConfirmed(before);
  return { next: toStored(bare(after)), clearedConfirmation: cleared };
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

/**
 * The sign-off: stamps the time, the signed-in email and the dish's components RIGHT NOW (`currentComponents`) into the section,
 * and clears the new-dish lock. Anyone allowed to sign in can confirm; the name and date are recorded.
 */
export function confirmAllergens(raw: unknown, email: string | null | undefined, nowIso: string, components: readonly string[]): DishAllergensEntry {
  const cur = readDishAllergens(raw) ?? blank();
  return toStored({ ...cur, confirmedAt: nowIso, confirmedBy: email?.trim() || null, components: sortedUnique(components), needsSignoff: false });
}

/**
 * A copy for a duplicated dish: the lists carry over, the sign-off does not (a copy is a new dish and somebody has to check
 * it). Returns the input unchanged when there is nothing stored.
 */
export function unconfirmedCopy(raw: unknown): DishAllergensEntry | null | undefined {
  const da = readDishAllergens(raw);
  if (!da) return raw as null | undefined;
  return toStored({ ...da, confirmedAt: null, confirmedBy: null, components: null });
}

/**
 * The section for a copy of a FOOD dish (Duplicate, What If Save As New Dish): the lists carry over, the sign-off does not, and
 * the copy is a new dish, so it carries the new-dish lock (it starts off the menu until somebody signs it off).
 */
export function newDishCopy(raw: unknown): DishAllergensEntry {
  const da = readDishAllergens(raw) ?? blank();
  return toStored({ ...da, confirmedAt: null, confirmedBy: null, components: null, needsSignoff: true });
}

/**
 * What every way of making a NEW dish (New Menu Item, Duplicate, What If > Save As New Dish) gets for its allergens and its Active flag.
 * A FOOD dish is created INACTIVE with the new-dish lock (the lists of the dish it was copied from carry over, its sign-off does not),
 * so nothing reaches the menu until a person confirms its allergens. `hasColumn` = the database has cost_menu_items.dish_allergens;
 * without it the dish still starts inactive, but the lock cannot be saved. Anything that is not Food keeps its old behaviour: a
 * copy carries the lists without the sign-off, a new one gets nothing.
 */
export function newDishPatch(category: string, existing: unknown, hasColumn: boolean): { active?: false; dish_allergens?: DishAllergensEntry } {
  if (category !== "Food") {
    const copy = existing ? unconfirmedCopy(existing) : null;
    return copy ? { dish_allergens: copy } : {};
  }
  if (!hasColumn) return { active: false };
  return { active: false, dish_allergens: existing ? newDishCopy(existing) : newDishAllergens() };
}

export const NEW_DISH_LOCK_REASON = "Confirm the allergens first";
export const NEW_DISH_NOTE = "New dishes start off the menu until their allergens are confirmed";

/** A new food dish keeps its Active switch locked until a valid sign-off exists. Null = the switch works as normal. */
export function activeLockedReason(da: DishAllergens | null, state: SignOffState): string | null {
  return da?.needsSignoff && state !== "valid" ? NEW_DISH_LOCK_REASON : null;
}

/* ------------------------------------------------------------------ the only places ingredients are looked at */

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
 * The faint hint under a chip: which ingredients suggest it, in words that say how sure the app is. "ticked on: Soy Sauce" when
 * those ingredients are ticked (confirmed) with the allergen, "name suggests: Soy Sauce" when it is only a keyword guess on an
 * unreviewed ingredient. Null when nothing suggests it. A hint, never an answer: it changes nothing.
 */
export function chipHint(r: Pick<Rollup, "cells">, id: AllergenId): string | null {
  const c = r.cells[id];
  if (!c || c.state === "none") return null;
  const names = c.sources.filter((s) => s !== "Chef");
  if (!names.length) return null;
  return `${c.state === "contains" ? "ticked on" : "name suggests"}: ${names.join(", ")}`;
}

/** One line of the "Where These Come From" list under the chips. `sure` = someone ticked it on the ingredient; otherwise only the name suggests it. */
export interface HintLine {
  id: AllergenId;
  label: string;
  sure: boolean;
  text: string;
}

/**
 * The list under the allergen chips that says why the app is pointing at an allergen (replaces the faint text that used to sit
 * under each chip and pushed the chips out of line). Plain words, in the fixed allergen order, only for allergens something
 * points at. A hint, never an answer: it changes nothing.
 */
export function chipHintLines(r: Pick<Rollup, "cells">, ids: readonly AllergenId[]): HintLine[] {
  const out: HintLine[] = [];
  for (const id of ids) {
    const c = r.cells[id];
    if (!c || c.state === "none") continue;
    const names = c.sources.filter((s) => s !== "Chef");
    if (!names.length) continue;
    const sure = c.state === "contains";
    const list = names.join(", ");
    out.push({
      id,
      label: allergenLabel(id),
      sure,
      text: sure ? `Ticked on the ingredient ${list}.` : `The ingredient name suggests it: ${list}. Nobody has checked it yet.`,
    });
  }
  return out;
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
