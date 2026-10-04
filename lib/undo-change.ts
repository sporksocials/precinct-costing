/**
 * Undo This Change: turns one history event into "load the earlier values into the editor's draft". Pure.
 * Nothing here writes to the database: the plan is applied to the recipe editor's draft and the person reviews it and
 * presses Save (the normal save bar, leave guard and conflict check apply).
 *
 * Semantics per event kind (dish, drink or prep and its recipe lines):
 *  - field update on the record: each changed field (only those in changed_fields) goes back to its old_row value;
 *    JSON columns (method, garnish, plating, diet options, allergen notes) go back whole.
 *  - recipe line inserted: the line is removed from the draft.
 *  - recipe line deleted: the line is added back with its original id and values; if its ingredient or prep no longer
 *    exists it is NOT added and the plan says so.
 *  - recipe line updated: the old values go back on that line (only the fields that changed).
 *  - insert or delete of the record itself: not undoable here (a delete is what Trash restores).
 * A change made again after the event produces a warning with the current value, so the person can decide.
 */
import type { HistoryRow } from "./change-history";
import { historyFieldLabel } from "./change-history";
import { sameValue } from "./draft-changes";
import { formatQty } from "./parse-qty";
import type { LineUnit, RecipeLine } from "./types";

type R = Record<string, unknown>;
export type RecordKind = "item" | "prep";
export const RECORD_TABLE: Record<RecordKind, string> = { item: "cost_menu_items", prep: "cost_preps" };
const AMOUNT_FIELDS = ["qty", "unit", "price_inc_override"];
const STEP_NOUN: Record<string, string> = { method: "step", kitchen_method: "step", garnish: "item", kitchen_plating: "point" };

export interface UndoContext {
  kind: RecordKind;
  id: string;
  /** the draft's current values for the record */
  record: R;
  /** the draft's current recipe lines */
  lines: readonly RecipeLine[];
  /** every history row for this record and its lines that the page has loaded (used to see "changed again") */
  history: readonly HistoryRow[];
  ingredientName: (id: string) => string | undefined;
  prepName: (id: string) => string | undefined;
}

export interface UndoPlan {
  undoable: boolean;
  /** why it cannot be undone (shown instead of the button's sheet) */
  blocked: string | null;
  /** nothing would change: the draft already holds the earlier value */
  noop: boolean;
  fieldPatch: R;
  addLines: RecipeLine[];
  removeLineIds: string[];
  updateLines: { id: string; patch: Partial<RecipeLine> }[];
  /** plain sentences, impact first ("This puts Glass back to Coupe Glass. It is Martini Glass now.") */
  impact: string[];
  /** "This was changed again after this event: the current value is X. Undo anyway?" */
  warnings: string[];
  /** lines that could not be added back */
  skipped: string[];
}

const empty = (): UndoPlan => ({ undoable: false, blocked: null, noop: false, fieldPatch: {}, addLines: [], removeLineIds: [], updateLines: [], impact: [], warnings: [], skipped: [] });
const blockedPlan = (why: string): UndoPlan => ({ ...empty(), blocked: why });

const ms = (s: string): number => new Date(s).getTime();
const isLater = (a: HistoryRow, than: HistoryRow): boolean => ms(a.changed_at) > ms(than.changed_at) || (ms(a.changed_at) === ms(than.changed_at) && Number(a.id) > Number(than.id));

/** One value as short text for a sentence. */
export function showValue(field: string, v: unknown): string {
  if (v == null || v === "") return "None";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) {
    const noun = STEP_NOUN[field];
    if (noun) return `${v.length} ${noun}${v.length === 1 ? "" : "s"}`;
    return v.length ? v.map(String).join(", ") : "None";
  }
  if (typeof v === "object") {
    const keys = Object.keys(v as R);
    return keys.length ? keys.join(", ") : "None";
  }
  if (field === "sell_price_inc" || field === "hh_price_inc") return `$${Number(v).toFixed(2)}`;
  if (field === "target_override") return `${Math.round(Number(v) * 1000) / 10}%`;
  return String(v);
}

/** The fields an event covers: the whole row, or the one the event line was about ("amount" = qty, unit and override). */
export function fieldsInScope(row: HistoryRow, scope: string | null): string[] {
  const all = row.changed_fields ?? [];
  if (!scope) return all;
  const wanted = scope === "amount" ? AMOUNT_FIELDS : [scope];
  return all.filter((f) => wanted.includes(f));
}

function lineText(line: R, ctx: UndoContext): string {
  const cid = String(line.component_id ?? "");
  const name = line.component_type === "prep" ? ctx.prepName(cid) ?? "A prep" : ctx.ingredientName(cid) ?? "An ingredient";
  const q = Number(line.qty);
  return Number.isFinite(q) && line.qty != null ? `${name} ${formatQty(q, (String(line.unit || "each") as LineUnit))}` : name;
}

function componentMissing(line: R, ctx: UndoContext): boolean {
  const cid = String(line.component_id ?? "");
  if (!cid) return false;
  return line.component_type === "prep" ? ctx.prepName(cid) === undefined : ctx.ingredientName(cid) === undefined;
}

/** Plans the undo of one history row (or one field-event of it, via `scope`). */
export function planUndo(row: HistoryRow, scope: string | null, ctx: UndoContext): UndoPlan {
  const ownTable = RECORD_TABLE[ctx.kind];
  if (row.table_name === ownTable && row.row_key === ctx.id) return planRecord(row, scope, ctx);
  if (row.table_name === "cost_recipe_lines" && row.parent_table === ownTable && row.parent_id === ctx.id) return planLine(row, scope, ctx);
  return blockedPlan("This change cannot be undone from here.");
}

function planRecord(row: HistoryRow, scope: string | null, ctx: UndoContext): UndoPlan {
  if (row.op === "delete") return blockedPlan("A deleted record is brought back from Trash.");
  if (row.op === "insert") return blockedPlan("Adding a record is not undone here. Delete it instead if it was a mistake.");
  const plan = empty();
  const o = row.old_row ?? {};
  const later = ctx.history.filter((h) => h.table_name === row.table_name && h.row_key === row.row_key && h.op === "update" && isLater(h, row));
  for (const f of fieldsInScope(row, scope)) {
    const before = o[f];
    const current = ctx.record[f];
    if (sameValue(before, current)) continue;
    plan.fieldPatch[f] = before === undefined ? null : before;
    const name = historyFieldLabel(f);
    plan.impact.push(`This puts ${name} back to ${showValue(f, before)}. It is ${showValue(f, current)} now.`);
    if (later.some((h) => (h.changed_fields ?? []).includes(f))) {
      plan.warnings.push(`This was changed again after this event: the current value is ${showValue(f, current)}. Undo anyway?`);
    }
  }
  plan.undoable = Object.keys(plan.fieldPatch).length > 0;
  plan.noop = !plan.undoable;
  if (plan.noop) plan.impact.push("It already has the earlier value. Nothing to undo.");
  return plan;
}

function planLine(row: HistoryRow, scope: string | null, ctx: UndoContext): UndoPlan {
  const plan = empty();
  const inDraft = ctx.lines.find((l) => l.id === row.row_key);
  const lineLater = ctx.history.filter((h) => h.table_name === "cost_recipe_lines" && h.row_key === row.row_key && isLater(h, row));
  if (row.op === "insert") {
    const text = lineText(row.new_row ?? {}, ctx);
    if (!inDraft) {
      plan.noop = true;
      plan.impact.push(`${text} is not in the recipe any more. Nothing to undo.`);
      return plan;
    }
    plan.undoable = true;
    plan.removeLineIds.push(inDraft.id);
    plan.impact.push(`This takes ${text} out of the recipe.`);
    if (lineLater.some((h) => h.op === "update")) plan.warnings.push(`This line was changed after it was added: it is ${lineText(inDraft as unknown as R, ctx)} now. Undo anyway?`);
    return plan;
  }
  if (row.op === "delete") {
    const old = (row.old_row ?? {}) as R;
    const text = lineText(old, ctx);
    if (inDraft) {
      plan.noop = true;
      plan.impact.push(`${text} is already in the recipe. Nothing to undo.`);
      return plan;
    }
    if (componentMissing(old, ctx)) {
      const who = old.component_type === "prep" ? ctx.prepName(String(old.component_id)) : ctx.ingredientName(String(old.component_id));
      plan.blocked = `${who ?? (old.component_type === "prep" ? "That prep" : "That ingredient")} no longer exists, so this line cannot be added back.`;
      plan.skipped.push(text);
      return plan;
    }
    plan.undoable = true;
    plan.addLines.push({ ...(old as unknown as RecipeLine), parent_id: ctx.id, parent_type: ctx.kind });
    plan.impact.push(`This adds ${text} back to the recipe.`);
    if (lineLater.some((h) => h.op === "insert")) plan.warnings.push("A line with the same id was added again after this event. Undo anyway?");
    return plan;
  }
  // update
  if (!inDraft) {
    plan.blocked = "That line has been removed since, so its earlier amount cannot be put back. Undo the removal first.";
    return plan;
  }
  const o = (row.old_row ?? {}) as R;
  const patch: R = {};
  for (const f of fieldsInScope(row, scope)) {
    if (f === "sort") continue;
    const cur = (inDraft as unknown as R)[f];
    if (sameValue(o[f], cur)) continue;
    patch[f] = o[f] === undefined ? null : o[f];
  }
  if (!Object.keys(patch).length) {
    plan.noop = true;
    plan.impact.push("The line already has the earlier values. Nothing to undo.");
    return plan;
  }
  const merged = { ...(inDraft as unknown as R), ...patch };
  if (("component_id" in patch || "component_type" in patch) && componentMissing(merged, ctx)) {
    plan.blocked = "The earlier ingredient no longer exists, so this change cannot be undone.";
    return plan;
  }
  plan.undoable = true;
  plan.updateLines.push({ id: inDraft.id, patch: patch as Partial<RecipeLine> });
  plan.impact.push(`This puts ${lineText(old2(o, merged), ctx)} back on the line. It is ${lineText(inDraft as unknown as R, ctx)} now.`);
  const again = lineLater.filter((h) => h.op === "update" && (h.changed_fields ?? []).some((f) => f in patch));
  if (again.length) plan.warnings.push(`This was changed again after this event: the line is ${lineText(inDraft as unknown as R, ctx)} now. Undo anyway?`);
  return plan;
}

/** the line as it was: the old row's values over the line's current ones (an old row holds every column) */
function old2(o: R, merged: R): R {
  return { ...merged, ...o };
}

/* ------------------------------------------------------------------ applying a plan to the draft */

/** The draft's lines after the plan: removals, updates, then re-added lines in their original place (by sort). */
export function applyPlanToLines(lines: readonly RecipeLine[], plan: UndoPlan): RecipeLine[] {
  const gone = new Set(plan.removeLineIds);
  const patches = new Map(plan.updateLines.map((u) => [u.id, u.patch]));
  let out = lines.filter((l) => !gone.has(l.id)).map((l) => (patches.has(l.id) ? { ...l, ...patches.get(l.id)! } : l));
  for (const add of plan.addLines) {
    if (out.some((l) => l.id === add.id)) continue;
    const at = out.findIndex((l) => Number(l.sort) > Number(add.sort));
    out = at === -1 ? [...out, add] : [...out.slice(0, at), add, ...out.slice(at)];
  }
  return out;
}

/** The record's draft after the plan (a new object; the input is not touched). */
export function applyPlanToRecord<T extends R>(record: T, plan: UndoPlan): T {
  return { ...record, ...plan.fieldPatch };
}

/* ------------------------------------------------------------------ the History group's list */

export interface RecordEvent {
  /** the event id (unique per row and field) */
  key: string;
  at: string;
  who: string | null;
  /** "Changed Glass: Coupe Glass to Martini Glass", "Removed Lime Juice 30 ml" */
  summary: string;
  row: HistoryRow;
  /** which part of a multi-field row this event is about (null = the whole row) */
  scope: string | null;
  /** false for informational events (the record itself added or deleted): shown without the button */
  canUndo: boolean;
}

/** "hist:12:glass" -> "glass"; "hist:12" -> null */
export function scopeOfEventId(id: string, rowId: number | string): string | null {
  const rest = id.startsWith(`hist:${rowId}`) ? id.slice(`hist:${rowId}`.length) : "";
  return rest.startsWith(":") ? rest.slice(1) : null;
}

const afterColon = (title: string): string => {
  const i = title.indexOf(": ");
  return i === -1 ? title : title.slice(i + 2);
};

/** One plain line for an event (see RecordEvent.summary). */
export function summaryOf(row: HistoryRow, e: { title: string; oldValue: string; newValue: string }): string {
  const rest = afterColon(e.title);
  if (row.table_name === "cost_recipe_lines") {
    if (row.op === "insert") return `Added ${rest.replace(/ added$/, "")} ${e.newValue}`.trim();
    if (row.op === "delete") return `Removed ${rest.replace(/ removed$/, "")} ${e.oldValue}`.trim();
    return `Changed ${rest}: ${e.oldValue} to ${e.newValue}`;
  }
  if (row.op !== "update") return e.title;
  if (/, (step|item|point)s? /.test(rest) || /reordered$/.test(rest)) return `${rest}: ${e.newValue !== "None" ? e.newValue : e.oldValue}`;
  return `Changed ${rest}: ${e.oldValue} to ${e.newValue}`;
}

/** Display text for a record's history, newest first. `describe` is describeHistoryRow with the page's lookups. */
export function recordEvents(
  rows: readonly HistoryRow[],
  kind: RecordKind,
  id: string,
  describe: (row: HistoryRow) => { id: string; title: string; oldValue: string; newValue: string }[],
): RecordEvent[] {
  const ownTable = RECORD_TABLE[kind];
  const mine = rows.filter((r) => (r.table_name === ownTable && r.row_key === id) || (r.parent_table === ownTable && r.parent_id === id));
  const sorted = [...mine].sort((a, b) => (ms(b.changed_at) - ms(a.changed_at)) || Number(b.id) - Number(a.id));
  const out: RecordEvent[] = [];
  for (const row of sorted) {
    const own = row.table_name === ownTable;
    for (const e of describe(row)) {
      out.push({ key: e.id, at: row.changed_at, who: row.changed_by, summary: summaryOf(row, e), row, scope: scopeOfEventId(e.id, row.id), canUndo: !(own && row.op !== "update") });
    }
  }
  return out;
}

/** "Show More" / "Show Fewer": the latest 10, then all loaded. */
export const HISTORY_SHOWN = 10;
export function visibleEvents<T>(events: readonly T[], expanded: boolean): { shown: T[]; canExpand: boolean } {
  return { shown: expanded ? [...events] : events.slice(0, HISTORY_SHOWN), canExpand: events.length > HISTORY_SHOWN };
}
