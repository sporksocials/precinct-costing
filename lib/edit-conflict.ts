import type { RecipeLine } from "./types";
import { describeChanges, fieldLabel, lineSig, patchOf, sameValue, type LineChanges } from "./draft-changes";

/**
 * Three-way check for the recipe editor. Two people can have the same drink, dish or prep open; this decides what
 * happens when the second one saves. Pure (no React, no database), so every case is tested.
 *
 *   base   = what this editor last loaded or saved
 *   mine   = the local draft
 *   theirs = a fresh read of the record at Save time
 *
 * Detection is by CONTENT, never timestamps: a stamp that moved without the content moving is not a conflict.
 *  - A field is a conflict only when I changed it AND they changed it AND the two results differ. A field I did not
 *    change is never a conflict and is never written (their value stays).
 *  - Ingredient lines are matched by line id. A line they added is kept (the old save deleted every stored line that was
 *    not in the person's list). A line only one side touched is not a conflict. Reordering alone is never a conflict.
 *  - Lists stored as one field (method steps, garnish, plating, allergen lists) are compared whole: either side changing
 *    a list differently is a conflict on that field. A per-step merge would need step identities the data does not have.
 *
 * Limit, by design: this narrows the window to the moments between the fresh read and the write; it cannot close it,
 * because recipe lines are written as a delete plus an upsert, not one transaction.
 */

/** Columns the database fills in. They never count as an edit and are never written by the editor. */
const IGNORED_KEYS = new Set(["id", "created_at", "updated_at", "updated_by"]);

export type Choice = "mine" | "theirs";

export interface FieldConflict {
  kind: "field";
  /** stable per label, e.g. "field:Method" */
  id: string;
  label: string;
  /** the changed fields under this label that both sides changed differently */
  keys: string[];
  /** every field under this label (so "Batch Yield" can show amount and unit together), with each side's values */
  mine: Record<string, unknown>;
  theirs: Record<string, unknown>;
}

export type LineConflictWhy = "both-edited" | "mine-removed" | "theirs-removed" | "both-added";

export interface LineConflict {
  kind: "line";
  id: string;
  why: LineConflictWhy;
  base: RecipeLine | null;
  /** null = this side removed the line */
  mine: RecipeLine | null;
  theirs: RecipeLine | null;
}

export type Conflict = FieldConflict | LineConflict;

export interface TheirChanges {
  /** the record or its lines differ from what this editor last loaded or saved */
  changed: boolean;
  /** plain labels for what they changed ("Price", "2 Ingredients Added") */
  labels: string[];
  fields: string[];
  lines: LineChanges;
  count: number;
  /** from the edit stamps; null before the stamps migration or for direct database work */
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface Resolution<R> {
  /** the changed fields to write (mine, where not settled in favour of theirs) */
  patch: Partial<R>;
  /** the ingredient lines as they should be after the save (all of them) */
  lines: RecipeLine[];
  /** the lines differ from what is stored now, so they must be written */
  linesChanged: boolean;
  /** the whole record as it will be after the save (their row with the patch applied) */
  record: R;
}

export interface ThreeWayResult<R> {
  theirs: TheirChanges;
  conflicts: Conflict[];
  /** both ways of settling every conflict; identical when there are none */
  resolutions: Record<Choice, Resolution<R>>;
}

type Plain = Record<string, unknown>;

/** The record with the database-filled columns removed. */
export function withoutStamps<T extends object>(rec: T): Partial<T> {
  const out: Plain = {};
  for (const [k, v] of Object.entries(rec as Plain)) if (!IGNORED_KEYS.has(k)) out[k] = v;
  return out as Partial<T>;
}

/** The editor's own lines: a line with no component is a blank row and is never saved. */
function realLines(ls: readonly RecipeLine[]): RecipeLine[] {
  return ls.filter((l) => l.component_id);
}

function relevantKeys(base: Plain, mine: Plain, theirs: Plain): string[] {
  const keys = new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)]);
  return [...keys].filter((k) => !IGNORED_KEYS.has(k));
}

/** A column this editor never had (an older cached copy, a column added since) is unknown, not "changed by them". */
function known(base: Plain, key: string): boolean {
  return base[key] !== undefined;
}

// ---------------------------------------------------------------- fields

interface FieldMerge {
  /** fields to write: mine where they did not change it differently */
  patch: Plain;
  /** keys both sides changed differently */
  conflictKeys: string[];
}

function mergeFields(base: Plain, mine: Plain, theirs: Plain): FieldMerge {
  const patch: Plain = {};
  const conflictKeys: string[] = [];
  for (const k of relevantKeys(base, mine, theirs)) {
    if (sameValue(base[k], mine[k])) continue; // I did not change it: never written, never a conflict
    if (sameValue(mine[k], theirs[k])) continue; // they already have my value
    const theirsChanged = known(base, k) ? !sameValue(base[k], theirs[k]) : theirs[k] != null;
    if (theirsChanged) conflictKeys.push(k);
    else patch[k] = mine[k];
  }
  return { patch, conflictKeys };
}

function fieldConflicts(keys: string[], mine: Plain, theirs: Plain, all: string[]): FieldConflict[] {
  const byLabel = new Map<string, string[]>();
  for (const k of keys) {
    const label = fieldLabel(k);
    byLabel.set(label, [...(byLabel.get(label) ?? []), k]);
  }
  return [...byLabel].map(([label, ks]) => {
    const group = all.filter((k) => fieldLabel(k) === label);
    return {
      kind: "field" as const,
      id: `field:${label}`,
      label,
      keys: ks,
      mine: Object.fromEntries(group.map((k) => [k, mine[k] ?? null])),
      theirs: Object.fromEntries(group.map((k) => [k, theirs[k] ?? null])),
    };
  });
}

// ---------------------------------------------------------------- lines

type LineOutcome =
  | { id: string; kind: "take"; line: RecipeLine }
  | { id: string; kind: "drop" }
  | { id: string; kind: "conflict"; conflict: LineConflict };

function classifyLine(id: string, b: RecipeLine | undefined, m: RecipeLine | undefined, t: RecipeLine | undefined): LineOutcome {
  if (b) {
    if (m && t) {
      const mc = lineSig(b) !== lineSig(m);
      const tc = lineSig(b) !== lineSig(t);
      if (!mc) return { id, kind: "take", line: t };
      if (!tc) return { id, kind: "take", line: m };
      if (lineSig(m) === lineSig(t)) return { id, kind: "take", line: t };
      return { id, kind: "conflict", conflict: { kind: "line", id, why: "both-edited", base: b, mine: m, theirs: t } };
    }
    if (!m && t) {
      if (lineSig(b) === lineSig(t)) return { id, kind: "drop" }; // I removed it, they never touched it
      return { id, kind: "conflict", conflict: { kind: "line", id, why: "mine-removed", base: b, mine: null, theirs: t } };
    }
    if (m && !t) {
      if (lineSig(b) === lineSig(m)) return { id, kind: "drop" }; // they removed it, I never touched it
      return { id, kind: "conflict", conflict: { kind: "line", id, why: "theirs-removed", base: b, mine: m, theirs: null } };
    }
    return { id, kind: "drop" };
  }
  if (m && t) {
    if (lineSig(m) === lineSig(t)) return { id, kind: "take", line: t };
    return { id, kind: "conflict", conflict: { kind: "line", id, why: "both-added", base: null, mine: m, theirs: t } };
  }
  if (m) return { id, kind: "take", line: m };
  if (t) return { id, kind: "take", line: t };
  return { id, kind: "drop" };
}

/** Did this side change the relative order of the lines it shares with the base? */
function reordered(base: RecipeLine[], side: RecipeLine[]): boolean {
  const inSide = new Set(side.map((l) => l.id));
  const inBase = new Set(base.map((l) => l.id));
  const a = base.filter((l) => inSide.has(l.id)).map((l) => l.id);
  const b = side.filter((l) => inBase.has(l.id)).map((l) => l.id);
  return a.join("|") !== b.join("|");
}

/** The order of the saved list: the side that reordered wins; with no reorder, their order stands and new lines follow. */
function orderIds(ids: Set<string>, base: RecipeLine[], mine: RecipeLine[], theirs: RecipeLine[]): string[] {
  // when both moved lines, the person saving wins; when neither did, their order is the stored order
  const primary = reordered(base, mine) ? mine : theirs;
  const secondary = primary === mine ? theirs : mine;
  const inBase = new Set(base.map((l) => l.id));
  const out: string[] = [];
  for (const l of primary) if (ids.has(l.id) && !out.includes(l.id)) out.push(l.id);
  // a line the other side removed but this result keeps goes back after the line that came before it
  for (const [list, i] of [secondary, base].flatMap((ls) => ls.map((l, idx) => [ls, idx] as const))) {
    const id = list[i].id;
    if (!ids.has(id) || out.includes(id) || !inBase.has(id)) continue;
    let after = -1;
    for (let k = i - 1; k >= 0; k--) {
      const at = out.indexOf(list[k].id);
      if (at >= 0) {
        after = at;
        break;
      }
    }
    out.splice(after + 1, 0, id);
  }
  // lines that are new (added by either side) follow in a stable order: theirs first, then mine
  for (const l of [...theirs, ...mine]) if (ids.has(l.id) && !out.includes(l.id)) out.push(l.id);
  return out;
}

function sameList(a: RecipeLine[], b: RecipeLine[]): boolean {
  return a.length === b.length && a.every((l, i) => l.id === b[i].id && lineSig(l) === lineSig(b[i]));
}

interface LineMerge {
  conflicts: LineConflict[];
  build: (choice: Choice) => RecipeLine[];
}

function mergeLines(baseIn: RecipeLine[], mineIn: RecipeLine[], theirsIn: RecipeLine[]): LineMerge {
  const base = realLines(baseIn);
  const mine = realLines(mineIn);
  const theirs = realLines(theirsIn);
  const b = new Map(base.map((l) => [l.id, l]));
  const m = new Map(mine.map((l) => [l.id, l]));
  const t = new Map(theirs.map((l) => [l.id, l]));
  const ids = [...new Set([...base, ...mine, ...theirs].map((l) => l.id))];
  const outcomes = ids.map((id) => classifyLine(id, b.get(id), m.get(id), t.get(id)));
  const conflicts = outcomes.flatMap((o) => (o.kind === "conflict" ? [o.conflict] : []));
  const build = (choice: Choice): RecipeLine[] => {
    const kept = new Map<string, RecipeLine>();
    for (const o of outcomes) {
      if (o.kind === "take") kept.set(o.id, o.line);
      else if (o.kind === "conflict") {
        const pick = choice === "mine" ? o.conflict.mine : o.conflict.theirs;
        if (pick) kept.set(o.id, pick);
      }
    }
    return orderIds(new Set(kept.keys()), base, mine, theirs).map((id, i) => ({ ...kept.get(id)!, sort: i + 1 }));
  };
  return { conflicts, build };
}

// ---------------------------------------------------------------- the whole record

/** What changed underneath the editor: the record and its lines now, against what the editor last loaded or saved. */
export function theirChangesOf<R extends object>(base: R, baseLines: RecipeLine[], theirs: R, theirsLines: RecipeLine[]): TheirChanges {
  const b = base as Plain;
  const t = theirs as Plain;
  // a column this editor never had (an older cached copy, a column added since) is unknown, not "changed by them"
  const comparable: Plain = {};
  const baseCmp: Plain = {};
  for (const k of Object.keys(t)) {
    if (IGNORED_KEYS.has(k) || !known(b, k)) continue;
    comparable[k] = t[k];
    baseCmp[k] = b[k];
  }
  const d = describeChanges(baseCmp, comparable, realLines(baseLines), realLines(theirsLines));
  return {
    changed: d.dirty,
    labels: d.labels,
    fields: d.fields,
    lines: d.lines,
    count: d.count,
    updatedBy: typeof t.updated_by === "string" && t.updated_by ? t.updated_by : null,
    updatedAt: typeof t.updated_at === "string" && t.updated_at ? t.updated_at : null,
  };
}

export function threeWay<R extends object>(input: { base: R; mine: R; theirs: R; baseLines: RecipeLine[]; mineLines: RecipeLine[]; theirsLines: RecipeLine[] }): ThreeWayResult<R> {
  const base = input.base as Plain;
  const mine = input.mine as Plain;
  const theirs = input.theirs as Plain;
  const theirChanges = theirChangesOf(input.base, input.baseLines, input.theirs, input.theirsLines);

  const fm = mergeFields(base, mine, theirs);
  const lm = mergeLines(input.baseLines, input.mineLines, input.theirsLines);
  const all = relevantKeys(base, mine, theirs);
  const conflicts: Conflict[] = [...fieldConflicts(fm.conflictKeys, mine, theirs, all), ...lm.conflicts];

  const resolve = (choice: Choice): Resolution<R> => {
    const patch: Plain = { ...fm.patch };
    if (choice === "mine") for (const k of fm.conflictKeys) patch[k] = mine[k];
    const lines = lm.build(choice);
    const linesChanged = !sameList(lines, realLines(input.theirsLines));
    return { patch: patch as Partial<R>, lines, linesChanged, record: { ...(input.theirs as Plain), ...patch } as R };
  };
  return { theirs: theirChanges, conflicts, resolutions: { mine: resolve("mine"), theirs: resolve("theirs") } };
}

/** The plain "save what I changed" patch, for callers that already know nothing changed underneath. */
export { patchOf };

// ---------------------------------------------------------------- the save decision

/** What a fresh read of the record and its lines holds. `row` is null when someone deleted it. */
export interface Fresh<R> {
  row: R | null;
  lines: RecipeLine[];
}

export type CheckedOutcome<R> =
  | { status: "saved"; record: R; lines: RecipeLine[]; theirs: TheirChanges; resolved: Conflict[] }
  | { status: "conflict"; conflicts: Conflict[]; theirs: TheirChanges; result: ThreeWayResult<R>; fresh: Fresh<R> }
  | { status: "gone" };

export interface CommitArgs {
  /** changed fields to write (may be empty) */
  patch: Plain;
  /** the full list to write, or undefined when the stored lines already are the result */
  lines: RecipeLine[] | undefined;
  /** the updated_at the fresh read saw; the field update only lands if the row still has it. null when the column is missing */
  guard: string | null;
  /** the lines as stored when read, so the delete step removes exactly the stored lines that are not in the result */
  freshLines: RecipeLine[];
  /** the lines the record will have afterwards */
  finalLines: RecipeLine[];
  /** the whole record afterwards (their row with my changes applied), for the local copy */
  record: Plain;
}

export interface CheckDeps<R> {
  fetchFresh: () => Promise<Fresh<R>>;
  /** stale = the guard did not match (someone saved between the read and the write); nothing was written */
  commit: (args: CommitArgs) => Promise<{ stale: boolean }>;
}

/** Thrown when two saves keep racing. The caller shows it as a failed save with Retry. */
export class SaveRaceError extends Error {
  constructor() {
    super("Someone else saved this at the same moment. Try again.");
    this.name = "SaveRaceError";
  }
}

/** Thrown to code that writes through the draft and then saves (Research Notes), so it can say why nothing was applied. */
export class SaveConflictError extends Error {
  constructor(message = "Someone else changed this recipe. Check their changes, then try again.") {
    super(message);
    this.name = "SaveConflictError";
  }
}

export interface CheckInput<R> {
  base: R;
  baseLines: RecipeLine[];
  mine: R;
  mineLines: RecipeLine[];
  /** the person has settled these conflicts (by id) one way; any other conflict still stops the save */
  settle?: { choice: Choice; ids: string[] };
}

/**
 * The save: read fresh, compare, then write or ask. Up to two attempts: if the guarded field update finds the row moved
 * since the read (someone saved in between), it reads again and re-checks once before giving up.
 *  - nothing changed underneath: writes exactly what the person changed (the old save);
 *  - others changed things but nothing clashes: writes the merge, so their lines survive;
 *  - conflicts: writes nothing and returns them, unless the person has already settled exactly those.
 */
export async function checkedSave<R extends object>(deps: CheckDeps<R>, input: CheckInput<R>): Promise<CheckedOutcome<R>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const fresh = await deps.fetchFresh();
    if (!fresh.row) return { status: "gone" };
    const result = threeWay<R>({ base: input.base, mine: input.mine, theirs: fresh.row, baseLines: input.baseLines, mineLines: input.mineLines, theirsLines: fresh.lines });
    const settled = input.settle && result.conflicts.every((c) => input.settle!.ids.includes(c.id));
    if (result.conflicts.length && !settled) return { status: "conflict", conflicts: result.conflicts, theirs: result.theirs, result, fresh };
    const res = result.resolutions[result.conflicts.length ? input.settle!.choice : "mine"];
    const guard = fresh.row && typeof (fresh.row as Plain).updated_at === "string" ? ((fresh.row as Plain).updated_at as string) : null;
    const hasPatch = Object.keys(res.patch).length > 0;
    if (hasPatch || res.linesChanged) {
      const r = await deps.commit({ patch: res.patch as Plain, lines: res.linesChanged ? res.lines : undefined, guard, freshLines: fresh.lines, finalLines: res.lines, record: res.record as Plain });
      if (r.stale) continue;
    } else {
      // nothing to write (their copy already holds everything I changed): the local copy only needs to catch up
      await deps.commit({ patch: {}, lines: undefined, guard: null, freshLines: fresh.lines, finalLines: res.lines, record: res.record as Plain });
    }
    return { status: "saved", record: res.record, lines: res.lines, theirs: result.theirs, resolved: result.conflicts };
  }
  throw new SaveRaceError();
}
