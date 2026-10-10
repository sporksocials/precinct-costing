import { CHEF_SOURCE, CONTAINS_IDS, allergenLabel, rollup, type AllergenId, type AllergenIndex, type Rollup } from "./allergens";
import type { DishAllergensEntry, MenuItem, RecipeLine } from "./types";

/**
 * A dish's OWN allergens section (`cost_menu_items.dish_allergens`). Pure rules, no React, no database.
 *
 * INGREDIENT FIRST (Troy, 10 Oct 2026, reversing the earlier "hand-listed per dish" rule): allergens are ticked ONLY on ingredients
 * (and, rarely, as a prep's or the dish's own chef override, which the roll-up already honours). A Food dish's allergens are WORKED
 * OUT from them, through every nested prep, and a person then CONFIRMS the result. Nobody ticks a dish's allergens by hand any more.
 *  - DERIVED = the roll-up cells in state "contains" (a confirmed tick on an ingredient, or a dish/prep override) for the 15 main ids
 *    (`CONTAINS_IDS`). A keyword guess on an unreviewed ingredient ("may_contain") NEVER counts.
 *  - A dish with any UNREVIEWED ingredient anywhere in its components cannot be confirmed (the allergens of that ingredient are not
 *    known). The editor names them and links to /allergens/review?dish=<id>.
 *  - EXTRAS (`added`): allergens the ingredients do not show but the dish carries anyway (cross-contact, the menu says it contains it).
 *    A chef can ADD, never REMOVE: to take off a derived allergen, fix the ingredient.
 *  - `without` notes ("Can Be Made Without") stay per dish, only for allergens it contains.
 *
 * Stored shape (jsonb, nullable): `{ contains, without, added, confirmed_at, confirmed_by, components, basis, ticks, needs_signoff }`.
 *  - `contains` is derived union added, in the fixed `CONTAINS_IDS` order, so the same set always compares equal. Everything
 *    downstream (matrix cells, print, kitchen iPad, the SQL feed) reads `contains`, `without` and `confirmed_at` exactly as before;
 *  - `without[id]` only exists for an id that is also in `contains`;
 *  - `added` is the dish's extras (ids the ingredients do not show), `basis` the derived ids at confirm (informational);
 *  - `confirmed_at` / `confirmed_by` are the sign-off, left OUT (not null) while the dish is not signed off;
 *  - `components` is the sorted unique list of "ingredient:<id>" and "prep:<id>" the dish was made from WHEN it was signed off, through
 *    every nested prep (see `currentComponents`);
 *  - `ticks` is THE SNAPSHOT the re-check compares: each ingredient's allergen ticks and reviewed flag, each prep's and the dish's own
 *    add and remove overrides, as they stood at confirm (see `ticksFor`);
 *  - `needs_signoff` marks a NEW food dish: it starts off the menu and its Active switch stays locked until it is signed off.
 *
 * RE-CHECK RULE (fail safe): a sign-off is valid only while the dish's CURRENT components AND ticks equal the stored ones. Swap, add or
 * remove an ingredient or prep anywhere in the nesting, change an ingredient's allergen ticks or reviewed flag, or change a prep's or
 * the dish's allergen overrides, and the sign-off stops counting (every cell reads Not checked until somebody confirms again);
 * amounts alone do not. A sign-off with no `components` or no `ticks` (made before this rule) is not valid either (state `legacy`).
 * The sign-off is never deleted by this, it just stops being valid. The matrix, the print, the editor, the To Do hub and the alerts
 * all decide "confirmed" through `signOffState`, and the kitchen feed applies the same rule in SQL.
 *
 * ANY edit to the extras or a note after a sign-off removes the sign-off. Every reader is tolerant: null, a string, an array or a
 * malformed entry reads as "no section".
 */

/** The allergens a dish can carry: the 15 main ones (required, then chef extras). Alcohol is an attribute and is never listed. */
export const DISH_ALLERGEN_IDS: readonly AllergenId[] = CONTAINS_IDS;
const KNOWN = new Set<string>(DISH_ALLERGEN_IDS);
const ORDER = new Map(DISH_ALLERGEN_IDS.map((id, i) => [id, i] as const));

export const NOTE_MAX = 120;

/** One entry of the `ticks` snapshot. Ingredients: their ticks (`a`) and whether they are reviewed (`r`). Preps and the dish: their overrides. */
export type TickEntry = { a: AllergenId[]; r: boolean } | { add: AllergenId[]; rem: AllergenId[] };
/** "ingredient:<id>", "prep:<id>" and "item:<dishId>" to their entry. */
export type Ticks = Record<string, TickEntry>;

export interface DishAllergens {
  /** derived union added, in the fixed order */
  contains: AllergenId[];
  without: Partial<Record<AllergenId, string>>;
  /** the dish's extras (allergens the ingredients do not show) */
  added: AllergenId[];
  /** the derived ids at sign-off (informational); null = none stored */
  basis: AllergenId[] | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  /** the components at sign-off time, sorted and unique; null = none stored (never signed off, or signed off before the re-check rule) */
  components: string[] | null;
  /** the ticks snapshot at sign-off; null = none stored (never signed off, or signed off before the ingredient-first rule) */
  ticks: Ticks | null;
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
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** A tolerant read of a stored `ticks` snapshot, or null when there is none (absent, or not an object). Arrays are re-sorted into the fixed order. */
export function readTicks(raw: unknown): Ticks | null {
  const o = obj(raw);
  if (!o) return null;
  const out: Ticks = {};
  for (const [k, v] of Object.entries(o)) {
    const e = obj(v);
    if (!e) continue;
    if (k.startsWith("ingredient:")) out[k] = { a: inOrder(strings(e.a)), r: e.r === true };
    else if (k.startsWith("prep:") || k.startsWith("item:")) out[k] = { add: inOrder(strings(e.add)), rem: inOrder(strings(e.rem)) };
  }
  return out;
}

/** The section as a tolerant read, or null when the dish has none (null, absent, or not an object). */
export function readDishAllergens(raw: unknown): DishAllergens | null {
  const o = obj(raw);
  if (!o) return null;
  const contains = inOrder(strings(o.contains));
  const wo = obj(o.without) ?? {};
  const without: Partial<Record<AllergenId, string>> = {};
  for (const id of contains) {
    const n = wo[id];
    if (typeof n === "string" && n.trim()) without[id] = n.trim().replace(/\s+/g, " ").slice(0, NOTE_MAX);
  }
  return {
    contains,
    without,
    added: inOrder(strings(o.added)),
    basis: Array.isArray(o.basis) ? inOrder(strings(o.basis)) : null,
    confirmedAt: validStamp(o.confirmed_at),
    confirmedBy: typeof o.confirmed_by === "string" && o.confirmed_by.trim() ? o.confirmed_by.trim() : null,
    components: Array.isArray(o.components) ? sortedUnique(o.components.filter((x): x is string => typeof x === "string" && x.trim() !== "")) : null,
    ticks: readTicks(o.ticks),
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

/** What the re-check reads from the live data: the dish's components and the ticks snapshot over them. */
export interface LiveCheck {
  components: string[];
  ticks: Ticks;
}

/** The slice of the allergen index the live check reads. */
export type LiveIndex = Pick<AllergenIndex, "ingredients" | "preps" | "linesByParent">;

type DishOverrides = Pick<MenuItem, "id" | "allergen_add" | "allergen_remove">;

const overrides = (add: readonly string[] | null | undefined, rem: readonly string[] | null | undefined): TickEntry => ({ add: inOrder(add ?? []), rem: inOrder(rem ?? []) });

/** One component's entry, or the dish's own: an ingredient's ticks and reviewed flag, or a prep's / the dish's overrides. */
function tickFor(key: string, index: LiveIndex): TickEntry {
  if (key.startsWith("ingredient:")) {
    const ing = index.ingredients.get(key.slice("ingredient:".length));
    return { a: inOrder(ing?.allergens ?? []), r: ing?.allergens_reviewed === true };
  }
  const prep = index.preps.get(key.slice("prep:".length));
  return overrides(prep?.allergen_add, prep?.allergen_remove);
}

/** The ticks snapshot for a list of components plus the dish itself. */
export function ticksFor(components: readonly string[], dish: DishOverrides, index: LiveIndex): Ticks {
  const out: Ticks = {};
  for (const k of components) out[k] = tickFor(k, index);
  out[`item:${dish.id}`] = overrides(dish.allergen_add, dish.allergen_remove);
  return out;
}

/** The dish's live components and ticks. The dish record passed in is used for its own overrides (so a draft counts). */
export function liveCheck(dish: DishOverrides, index: LiveIndex): LiveCheck {
  const components = currentComponents("item", dish.id, index.linesByParent);
  return { components, ticks: ticksFor(components, dish, index) };
}

/** The same snapshot: the same keys, and the same ticks, reviewed flags and overrides under each. Both sides are read through `readTicks` first. */
export function sameTicks(a: Ticks, b: Ticks): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => k in b && JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

/**
 * valid    signed off, and the dish is still made from exactly what was signed, with the same ticks on every ingredient and override
 * changed  signed off, but a component was swapped, added or removed, or a tick, reviewed flag or override changed since: needs a re-check
 * legacy   signed off before the rule existed (no stored components or no stored ticks): treated like changed, fail safe
 * never    not signed off
 */
export type SignOffState = "valid" | "changed" | "legacy" | "never";

export function signOffState(da: DishAllergens | null, live: LiveCheck): SignOffState {
  if (!da || !da.confirmedAt) return "never";
  if (!da.components || !da.ticks) return "legacy";
  if (!sameComponents(da.components, live.components)) return "changed";
  return sameTicks(da.ticks, live.ticks) ? "valid" : "changed";
}

/** The ONE test of "this dish counts as confirmed". */
export function isSignOffValid(da: DishAllergens | null, live: LiveCheck): boolean {
  return signOffState(da, live) === "valid";
}

/** The section as the matrix should read it: the sign-off removed unless it is valid, so every cell reads Not checked. The lists stay. */
export function effectiveAllergens(da: DishAllergens | null, live: LiveCheck): DishAllergens | null {
  if (!da) return null;
  return isSignOffValid(da, live) ? da : { ...da, confirmedAt: null, confirmedBy: null };
}

/** The line under the status when a sign-off has stopped counting. Null for valid and never. */
export function staleSignOffText(state: SignOffState, signedOn: string): string | null {
  if (state === "changed") return `Ingredients changed since ${signedOn}. Re-check and confirm again.`;
  if (state === "legacy") return `Confirmed on ${signedOn}, before ingredient changes were tracked. Re-check and confirm again.`;
  return null;
}

/* ------------------------------------------------------------------ what is stored */

/** The stored form. The sign-off keys (and the basis, components and ticks that go with them) are present only while signed off. */
export function toStored(da: DishAllergens): DishAllergensEntry {
  const out: DishAllergensEntry = { contains: [...da.contains], without: Object.fromEntries(da.contains.filter((id) => da.without[id]).map((id) => [id, da.without[id] as string])) };
  if (da.added.length) out.added = [...da.added];
  if (da.confirmedAt) {
    out.confirmed_at = da.confirmedAt;
    if (da.confirmedBy) out.confirmed_by = da.confirmedBy;
    if (da.components) out.components = [...da.components];
    if (da.basis) out.basis = [...da.basis];
    if (da.ticks) out.ticks = JSON.parse(JSON.stringify(da.ticks)) as NonNullable<DishAllergensEntry["ticks"]>;
  } else if (da.needsSignoff) out.needs_signoff = true;
  return out;
}

const blank = (): DishAllergens => ({ contains: [], without: {}, added: [], basis: null, confirmedAt: null, confirmedBy: null, components: null, ticks: null, needsSignoff: false });
const unsigned = (d: DishAllergens): DishAllergens => ({ ...d, basis: null, confirmedAt: null, confirmedBy: null, components: null, ticks: null });

/** The section a NEW food dish starts with: nothing added, not signed off, and its Active switch locked until it is. */
export function newDishAllergens(): DishAllergensEntry {
  return toStored({ ...blank(), needsSignoff: true });
}

export interface EditResult {
  next: DishAllergensEntry;
  /** the edit took a sign-off away (the editor says so in plain words) */
  clearedConfirmation: boolean;
}

function edited(before: DishAllergens | null, after: DishAllergens): EditResult {
  const same = !!before && JSON.stringify(toStored(unsigned(before))) === JSON.stringify(toStored(unsigned(after)));
  // an edit that changes nothing keeps the sign-off
  if (same && before) return { next: toStored(before), clearedConfirmation: false };
  const cleared = isConfirmed(before);
  return { next: toStored(unsigned(after)), clearedConfirmation: cleared };
}

/** The extras that are not already derived, in the fixed order. */
export const extrasOf = (added: readonly AllergenId[], derived: readonly AllergenId[]): AllergenId[] => inOrder(added).filter((id) => !derived.includes(id));

/** Rewrites a section for an edit: `contains` is always the live derived ids plus the extras, and notes only stay for what it contains. */
function rebuilt(cur: DishAllergens, added: readonly AllergenId[], without: Partial<Record<AllergenId, string>>, derived: readonly AllergenId[]): DishAllergens {
  const extras = extrasOf(added, derived);
  const contains = inOrder([...derived, ...extras]);
  const keep: Partial<Record<AllergenId, string>> = {};
  for (const id of contains) if (without[id]) keep[id] = without[id];
  return { ...cur, contains, added: extras, without: keep };
}

/** Adds an extra allergen the ingredients do not show. An allergen the ingredients already show is already there (no change). */
export function addExtra(raw: unknown, id: AllergenId, derived: readonly AllergenId[]): EditResult {
  const before = readDishAllergens(raw);
  const cur = before ?? blank();
  return edited(before, rebuilt(cur, [...cur.added, id], cur.without, derived));
}

/** Removes an extra. A derived allergen cannot be removed here: fix the ingredient instead (no change). */
export function removeExtra(raw: unknown, id: AllergenId, derived: readonly AllergenId[]): EditResult {
  const before = readDishAllergens(raw);
  const cur = before ?? blank();
  return edited(before, rebuilt(cur, cur.added.filter((x) => x !== id), cur.without, derived));
}

/** Set (or clear, with empty text) the "can be made without" note of an allergen the dish contains. A note for any other allergen is ignored. */
export function setWithoutNote(raw: unknown, id: AllergenId, text: string, derived: readonly AllergenId[]): EditResult {
  const before = readDishAllergens(raw);
  const cur = before ?? blank();
  const base = rebuilt(cur, cur.added, cur.without, derived);
  if (!base.contains.includes(id)) return edited(before, base);
  const without = { ...base.without };
  const t = text.trim().replace(/\s+/g, " ").slice(0, NOTE_MAX);
  if (t) without[id] = t;
  else delete without[id];
  return edited(before, { ...base, without });
}

/** What Confirm needs from the live data: the derived ids, the components and the ticks snapshot. */
export interface ConfirmBasis {
  derived: readonly AllergenId[];
  components: readonly string[];
  ticks: Ticks;
}

/**
 * The sign-off: accepts the computed result. `contains` = derived union the dish's extras (fixed order), notes kept only for what it
 * contains, and the time, the signed-in email, the components, the ticks snapshot and the derived ids ("basis") are stamped in. Clears
 * the new-dish lock. Anyone allowed to sign in can confirm; the name and date are recorded.
 */
export function confirmAllergens(raw: unknown, email: string | null | undefined, nowIso: string, basis: ConfirmBasis): DishAllergensEntry {
  const cur = readDishAllergens(raw) ?? blank();
  const derived = inOrder(basis.derived);
  const next = rebuilt(cur, cur.added, cur.without, derived);
  return toStored({ ...next, basis: derived, confirmedAt: nowIso, confirmedBy: email?.trim() || null, components: sortedUnique(basis.components), ticks: basis.ticks, needsSignoff: false });
}

/**
 * A copy for a duplicated dish: the lists carry over, the sign-off does not (a copy is a new dish and somebody has to check
 * it). Returns the input unchanged when there is nothing stored.
 */
export function unconfirmedCopy(raw: unknown): DishAllergensEntry | null | undefined {
  const da = readDishAllergens(raw);
  if (!da) return raw as null | undefined;
  return toStored(unsigned(da));
}

/**
 * The section for a copy of a FOOD dish (Duplicate, What If Save As New Dish): the lists carry over, the sign-off does not, and
 * the copy is a new dish, so it carries the new-dish lock (it starts off the menu until somebody signs it off).
 */
export function newDishCopy(raw: unknown): DishAllergensEntry {
  const da = readDishAllergens(raw) ?? blank();
  return toStored({ ...unsigned(da), needsSignoff: true });
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

/* ------------------------------------------------------------------ working the allergens out */

/** The 15 main ids whose roll-up cell is CONTAINED (a confirmed tick, or a dish or prep override). Keyword guesses never count. */
export function deriveContains(r: Pick<Rollup, "cells">): AllergenId[] {
  return DISH_ALLERGEN_IDS.filter((id) => r.cells[id]?.state === "contains");
}

/** An ingredient in the dish's components that nobody has marked as reviewed. */
export interface UnreviewedIngredient {
  id: string;
  name: string;
}

/**
 * The ingredients in the dish's components (own lines and every nested prep) whose allergens nobody has reviewed, by name. An
 * ingredient the index does not know is listed too ("Unknown ingredient"): its allergens cannot be known.
 */
export function unreviewedIn(components: readonly string[], index: Pick<LiveIndex, "ingredients">): UnreviewedIngredient[] {
  const out: UnreviewedIngredient[] = [];
  for (const k of components) {
    if (!k.startsWith("ingredient:")) continue;
    const id = k.slice("ingredient:".length);
    const ing = index.ingredients.get(id);
    if (!ing) out.push({ id, name: "Unknown ingredient" });
    else if (ing.allergens_reviewed !== true) out.push({ id, name: ing.name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "en-AU", { sensitivity: "base" }));
}

/** Everything the screens need to know about a dish's allergens right now, worked out from the ingredients. */
export interface DishCheck {
  /** from the ingredients and overrides */
  derived: AllergenId[];
  /** the dish's extras that the ingredients do not already show */
  added: AllergenId[];
  /** derived union added, in the fixed order: what Confirm would store */
  contains: AllergenId[];
  unreviewed: UnreviewedIngredient[];
  /** the roll-up could not read everything (a recipe that loops back on itself, nests too deeply, or points at something missing) */
  problems: boolean;
  live: LiveCheck;
  /** the worked-out roll-up the above came from (for the source list; screens never read allergens from it directly) */
  r: Rollup;
  /** cannot be confirmed: an ingredient is unreviewed, or the roll-up could not read it all */
  blocked: boolean;
}

/** The dish's check. `index.items` should hold the version of the dish being looked at; when it does not, it is added (a draft counts). */
export function dishCheck(item: MenuItem, index: AllergenIndex): DishCheck {
  const idx: AllergenIndex = index.items?.get(item.id) === item ? index : { ...index, items: new Map(index.items ?? []).set(item.id, item) };
  const r = rollup({ kind: "item", id: item.id }, idx);
  const derived = deriveContains(r);
  const added = extrasOf(readDishAllergens(item.dish_allergens)?.added ?? [], derived);
  const live = liveCheck(item, idx);
  const unreviewed = unreviewedIn(live.components, idx);
  const problems = r.problems.length > 0;
  return { derived, added, contains: inOrder([...derived, ...added]), unreviewed, problems, live, r, blocked: unreviewed.length > 0 || problems };
}

export const UNREADABLE_TEXT = "This recipe loops back on itself, nests too deeply or points at something that is missing, so its allergens cannot be worked out.";

/** "Bacon, Eggs (Each) and 3 more still need their allergens checked". Names up to six, then "and N more". Empty when none. */
export function unreviewedText(unreviewed: readonly UnreviewedIngredient[]): string {
  const names = unreviewed.map((u) => u.name);
  const n = names.length;
  if (!n) return "";
  if (n === 1) return `${names[0]} still needs its allergens checked`;
  const cap = 6;
  const list = n <= cap ? `${names.slice(0, -1).join(", ")} and ${names[n - 1]}` : `${names.slice(0, cap).join(", ")} and ${n - cap} more`;
  return `${list} still need their allergens checked`;
}

/** Where the "Check These Ingredients" button goes for a dish. */
export const checkIngredientsHref = (dishId: string): string => `/allergens/review?dish=${encodeURIComponent(dishId)}`;
/** Where the whole queue of unreviewed ingredients lives. */
export const CHECK_ALL_INGREDIENTS_HREF = "/allergens/review";

/** One line of the "Where These Come From" list: an allergen and what puts it on the dish. */
export interface HintLine {
  id: AllergenId;
  label: string;
  /** the ingredients or overrides that put it there, plain words ("Bacon", "Chef override"), or "Added by hand" for an extra */
  text: string;
  /** an extra the dish carries that the ingredients do not show */
  extra: boolean;
}

/**
 * The source list for the dish's allergens, in the fixed allergen order: each allergen with what causes it ("Nitrites · Bacon").
 * Derived allergens name their ingredients (or the prep's or dish's chef override); extras say they were added by hand.
 */
export function sourceLines(r: Pick<Rollup, "cells">, derived: readonly AllergenId[], added: readonly AllergenId[]): HintLine[] {
  const out: HintLine[] = [];
  for (const id of DISH_ALLERGEN_IDS) {
    if (derived.includes(id)) {
      const names = (r.cells[id]?.sources ?? []).map((s) => (s === CHEF_SOURCE ? "Chef override" : s));
      out.push({ id, label: allergenLabel(id), text: names.length ? names.join(", ") : "Ingredients", extra: false });
    } else if (added.includes(id)) out.push({ id, label: allergenLabel(id), text: "Added by hand", extra: true });
  }
  return out;
}

/** What confirming now would store, compared with what the screen showed: "ok", "unreviewed" (blocked) or "changed" (the answer moved underneath). */
export function confirmVerdict(check: Pick<DishCheck, "derived" | "blocked" | "unreviewed" | "live">, shown: { derived: readonly AllergenId[]; ticks: Ticks }): "ok" | "unreviewed" | "changed" {
  if (check.blocked) return "unreviewed";
  if (JSON.stringify(inOrder(check.derived)) !== JSON.stringify(inOrder(shown.derived))) return "changed";
  return sameTicks(check.live.ticks, shown.ticks) ? "ok" : "changed";
}

/** A short phrase for history, undo and conflict wording: "3 allergens, confirmed" or "None ticked, not confirmed". */
export function describeDishAllergens(raw: unknown): string {
  const da = readDishAllergens(raw);
  if (!da) return "None";
  const n = da.contains.length;
  const list = n ? da.contains.map(allergenLabel).join(", ") : "None listed";
  const extra = da.added.length ? ` (${da.added.length} added by hand)` : "";
  return `${list}${extra}${Object.keys(da.without).length ? ` (${Object.keys(da.without).length} can be made without)` : ""}, ${da.confirmedAt ? "confirmed" : "not confirmed"}`;
}
