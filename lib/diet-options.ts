import { DIET_MARK_IDS, DIET_OPTION_IDS, dietMarkDef, markExcludedBy, type DietMarkId, type DietOptionId } from "./diet-legend";
import { formatQty } from "./parse-qty";
import { LINE_UNITS, type ComponentType, type DietOptionAdded, type DietOptions, type LineUnit, type RecipeLine } from "./types";

/**
 * The pure rules for what `cost_menu_items.diet_options` holds (Troy, 10 Oct 2026). One jsonb column, no schema change:
 *
 *  - OPTIONS gfo, vo, vgo, dfo: `{ note, removed?, added?, surcharge_inc? }`. `removed` holds recipe line ids the option
 *    leaves out, `added` holds extra component lines, `surcharge_inc` is dollars inc GST on top of the dish price. The `note`
 *    is the OPTIONAL extra wording a person adds (it may be ""): the kitchen sentence is built from the swap, then the note
 *    (`optionText`). An option is kept when it has a note OR a swap (`optionHasContent`), so "Leave out the base, add a gluten
 *    free base" needs no typing at all. The swap and surcharge feed the option costing (lib/diet-option-cost.ts), display only.
 *  - MARKS gf, v, vg: `{ note? }`, hand-set by a person and never worked out or ticked by the app.
 *
 * Every reader here is tolerant: a row saved before the swaps and marks existed, a null entry or a malformed value reads as
 * "nothing". Every writer spreads the entry it changes, so a key it does not know about is never dropped.
 */

export type RawDietOptions = Record<string, unknown>;

/** A dietary option read tolerantly. `note` is trimmed and may be empty (a swap-only option has no note). */
export interface OptionRead {
  id: DietOptionId;
  note: string;
  removed: string[];
  added: DietOptionAdded[];
  /** dollars inc GST on top of the dish price, 0 when none */
  surcharge: number;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** The whole column as a plain object, or {} when it is null, a string, an array or anything else. */
export function rawOptions(v: unknown): RawDietOptions {
  return obj(v) ?? {};
}

function readAdded(v: unknown): DietOptionAdded[] {
  if (!Array.isArray(v)) return [];
  const out: DietOptionAdded[] = [];
  for (const x of v) {
    const a = obj(x);
    if (!a) continue;
    const type = a.component_type;
    const id = typeof a.component_id === "string" ? a.component_id.trim() : "";
    const qty = Number(a.qty);
    const unit = a.unit;
    if ((type !== "ingredient" && type !== "prep") || !id) continue;
    if (!Number.isFinite(qty) || qty < 0) continue;
    if (typeof unit !== "string" || !LINE_UNITS.includes(unit as LineUnit)) continue;
    const note = typeof a.note === "string" && a.note.trim() ? a.note.trim() : null;
    out.push({ component_type: type as ComponentType, component_id: id, qty, unit: unit as LineUnit, ...(note ? { note } : {}) });
  }
  return out;
}

/** One option, or null when the key is absent or not an object. */
export function readOption(raw: unknown, id: DietOptionId): OptionRead | null {
  const e = obj(rawOptions(raw)[id]);
  if (!e) return null;
  const removed = Array.isArray(e.removed) ? [...new Set(e.removed.filter((x): x is string => typeof x === "string" && x.trim() !== ""))] : [];
  const s = Number(e.surcharge_inc);
  return {
    id,
    note: typeof e.note === "string" ? e.note.trim() : "",
    removed,
    added: readAdded(e.added),
    surcharge: e.surcharge_inc != null && e.surcharge_inc !== "" && Number.isFinite(s) && s > 0 ? s : 0,
  };
}

/** Every option present, in the fixed order GFO, VO, VGO, DFO. */
export function readOptions(raw: unknown): OptionRead[] {
  const out: OptionRead[] = [];
  for (const id of DIET_OPTION_IDS) {
    const o = readOption(raw, id);
    if (o) out.push(o);
  }
  return out;
}

export function hasSwap(o: Pick<OptionRead, "removed" | "added">): boolean {
  return o.removed.length > 0 || o.added.length > 0;
}

/**
 * True when an option says something: its own note, or a swap (something left out or added). This is THE rule for "the dish
 * offers this option" in every reader (badges, print, kitchen, matrix, Finish Setting Up). A surcharge alone is not enough, it
 * only prices a change. The editor never saves an option that fails it.
 */
export function optionHasContent(o: Pick<OptionRead, "note" | "removed" | "added"> | null | undefined): boolean {
  return !!o && (o.note.trim() !== "" || hasSwap(o));
}

/** The options a dish really offers (present and with content), in the fixed order GFO, VO, VGO, DFO. */
export function readOfferedOptions(raw: unknown): OptionRead[] {
  return readOptions(raw).filter(optionHasContent);
}

/** The marks that are set (a key holding an object), in the fixed order GF, V, VG. */
export function readMarks(raw: unknown): DietMarkId[] {
  const r = rawOptions(raw);
  return DIET_MARK_IDS.filter((id) => obj(r[id]) !== null);
}

/**
 * The marks that PRINT: GF, V and VG in that order, but VG implies vegetarian, so a dish marked both prints VG only (it is
 * shown once). The editor still allows both.
 */
export function printedMarks(raw: unknown): DietMarkId[] {
  const set = readMarks(raw);
  return set.includes("vg") ? set.filter((id) => id !== "v") : set;
}

/* ------------------------------------------------------------------ editing rules (marks and options exclude each other) */

/** Turn a mark on. The option it excludes is removed from the column (the caller also clears that option's pending state). */
export function markOn(raw: unknown, id: DietMarkId): { next: DietOptions; clearedOption: DietOptionId | null } {
  const next: RawDietOptions = { ...rawOptions(raw) };
  const opt = dietMarkDef(id).excludes;
  const had = obj(next[opt]) !== null;
  delete next[opt];
  next[id] = obj(next[id]) ?? {};
  return { next: next as DietOptions, clearedOption: had ? opt : null };
}

export function markOff(raw: unknown, id: DietMarkId): DietOptions {
  const next: RawDietOptions = { ...rawOptions(raw) };
  delete next[id];
  return next as DietOptions;
}

/** Turning an option ON removes the mark it excludes. Returns the mark that was turned off, if there was one. */
export function optionOnClearsMark(raw: unknown, id: DietOptionId): { next: DietOptions; clearedMark: DietMarkId | null } {
  const mark = markExcludedBy(id);
  const next: RawDietOptions = { ...rawOptions(raw) };
  if (!mark) return { next: next as DietOptions, clearedMark: null };
  const had = obj(next[mark]) !== null;
  delete next[mark];
  return { next: next as DietOptions, clearedMark: had ? mark : null };
}

/* ------------------------------------------------------------------ stale lines, copies and scaling */

/**
 * Drops `removed` ids that no longer match a line of the dish (the line was deleted). Returns the same object when nothing
 * is stale, so an unchanged column is never seen as an edit. Unknown keys inside an entry are kept.
 */
export function pruneStaleRemoved(raw: unknown, lineIds: Iterable<string>): DietOptions | null | undefined {
  const r = obj(raw);
  if (!r) return raw as null | undefined;
  const live = new Set(lineIds);
  let changed = false;
  const out: RawDietOptions = { ...r };
  for (const id of DIET_OPTION_IDS) {
    const e = obj(r[id]);
    if (!e || !Array.isArray(e.removed)) continue;
    const keep = e.removed.filter((x) => typeof x === "string" && live.has(x));
    if (keep.length === e.removed.length) continue;
    changed = true;
    const entry: Record<string, unknown> = { ...e };
    if (keep.length) entry.removed = keep;
    else delete entry.removed;
    out[id] = entry;
  }
  return changed ? (out as DietOptions) : (raw as DietOptions);
}

/**
 * A copy of the column for a copied dish: each `removed` line id is translated through `idMap` (old line id to the copy's
 * line id; an id with no match is dropped), and `scale` multiplies the added amounts (What If's portion change). Marks and
 * every other key are copied as they are.
 */
export function copyDietOptions(raw: unknown, idMap: ReadonlyMap<string, string>, scale = 1): DietOptions | null | undefined {
  const r = obj(raw);
  if (!r) return raw as null | undefined;
  const out: RawDietOptions = { ...r };
  for (const id of DIET_OPTION_IDS) {
    const e = obj(r[id]);
    if (!e) continue;
    const entry: Record<string, unknown> = { ...e };
    if (Array.isArray(e.removed)) {
      const mapped = e.removed.map((x) => (typeof x === "string" ? idMap.get(x) : undefined)).filter((x): x is string => !!x);
      if (mapped.length) entry.removed = mapped;
      else delete entry.removed;
    }
    if (scale !== 1 && Array.isArray(e.added)) {
      entry.added = e.added.map((a) => {
        const x = obj(a);
        return x ? { ...x, qty: Math.round(Number(x.qty) * scale * 1000) / 1000 } : a;
      });
    }
    out[id] = entry;
  }
  return out as DietOptions;
}

/* ------------------------------------------------------------------ plain words (kitchen and print: never a cost) */

export interface SwapNames {
  /** the name of one of the dish's own recipe lines, or null when the line is gone (it is then left out of the words) */
  lineName: (lineId: string) => string | null;
  /** the name of an added component, or null when it no longer exists */
  addedName: (a: DietOptionAdded) => string | null;
}

export interface SwapWords {
  leftOut: string[];
  added: string[];
}

export function swapWords(o: Pick<OptionRead, "removed" | "added">, names: SwapNames): SwapWords {
  const leftOut: string[] = [];
  for (const id of o.removed) {
    const n = names.lineName(id);
    if (n) leftOut.push(n);
  }
  const added: string[] = [];
  for (const a of o.added) {
    const n = names.addedName(a);
    if (!n) continue;
    added.push(a.qty > 0 ? `${n} ${formatQty(a.qty, a.unit)}` : n);
  }
  return { leftOut, added };
}

/** "Leave out Soy Sauce, Garlic. Add Tamari 15 ml." or null when nothing changes. Never a price. */
export function swapSentence(w: SwapWords): string | null {
  const parts: string[] = [];
  if (w.leftOut.length) parts.push(`Leave out ${w.leftOut.join(", ")}.`);
  if (w.added.length) parts.push(`Add ${w.added.join(", ")}.`);
  return parts.length ? parts.join(" ") : null;
}

/** The line printed on a recipe sheet and shown on the kitchen iPad after the option's name: the swap words, then its own note. */
export function optionText(note: string, swap: string | null): string {
  const n = note.trim();
  return [swap, n].filter(Boolean).join(" ");
}

/** Synthetic recipe lines for an option's added components (ids `opt-add-<index>`), costed like any other line. */
export function addedAsLines(added: readonly DietOptionAdded[], parentId: string, firstSort: number): RecipeLine[] {
  return added.map((a, i) => ({
    id: addedLineId(i),
    parent_type: "item" as const,
    parent_id: parentId,
    component_type: a.component_type,
    component_id: a.component_id,
    qty: a.qty,
    unit: a.unit,
    note: a.note ?? null,
    sort: firstSort + i + 1,
  }));
}

export const ADDED_LINE_PREFIX = "opt-add-";
export function addedLineId(index: number): string {
  return `${ADDED_LINE_PREFIX}${index}`;
}
