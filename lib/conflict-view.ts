import type { Conflict, FieldConflict, LineConflict, TheirChanges } from "./edit-conflict";
import { gp, money } from "./format";
import { formatQty } from "./parse-qty";
import { fieldLabel } from "./draft-changes";
import type { RecipeLine } from "./types";

/**
 * Words for the "Changed While You Were Editing" sheet, the quiet notice and the save toast. Pure: the component hands in
 * names and costs, this decides what is said. Dates are Brisbane time.
 */

export interface ViewCtx {
  /** the ingredient or prep a line points at */
  componentName: (l: RecipeLine) => string;
  venueName: (id: number | null | undefined) => string;
}

export interface ConflictItemView {
  id: string;
  /** "Price", or the ingredient name */
  heading: string;
  /** one short sentence about how the two edits collided */
  note: string;
  mine: string[];
  theirs: string[];
}

const STEP_KEYS = new Set(["method", "kitchen_method", "kitchen_plating"]);

function valueLines(key: string, v: unknown, ctx: ViewCtx): string[] {
  if (v == null || v === "") return ["None"];
  if (key === "venue_id") return [ctx.venueName(Number(v))];
  if (key === "sell_price_inc" || key === "hh_price_inc") return [money(Number(v))];
  if (key === "target_override") return [gp(Number(v), 1)];
  if (typeof v === "boolean") return [v ? "Yes" : "No"];
  if (Array.isArray(v)) {
    if (!v.length) return ["None"];
    const parts = v.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
    return STEP_KEYS.has(key) ? parts.map((p, i) => `${i + 1}. ${p}`) : [parts.join(", ")];
  }
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    if (!entries.length) return ["None"];
    return entries.map(([k, x]) => {
      const note = x && typeof x === "object" && "note" in (x as object) ? String((x as { note: unknown }).note ?? "") : x == null ? "" : String(x);
      const name = k.length <= 3 ? k.toUpperCase() : k; // diet option codes (gfo, vo) read as capitals
      return note ? `${name}: ${note}` : name;
    });
  }
  return [String(v)];
}

function fieldView(c: FieldConflict, ctx: ViewCtx): ConflictItemView {
  // "Batch Yield" is two fields (amount and unit): show them together
  const yieldPair = c.label === "Batch Yield";
  const side = (rec: Record<string, unknown>) => (yieldPair ? [[rec.yield_qty == null ? "None" : String(rec.yield_qty), rec.yield_unit == null ? "" : String(rec.yield_unit)].filter(Boolean).join(" ")] : c.keys.flatMap((k) => valueLines(k, rec[k], ctx)));
  return { id: c.id, heading: c.label, note: "You both changed this.", mine: side(c.mine), theirs: side(c.theirs) };
}

function lineText(l: RecipeLine | null): string[] {
  if (!l) return ["Removed"];
  const amount = Number(l.qty) ? formatQty(l.qty, l.unit) : "No quantity";
  return [l.note ? `${amount} · ${l.note}` : amount];
}

const LINE_NOTE: Record<LineConflict["why"], string> = {
  "both-edited": "You both changed this ingredient.",
  "mine-removed": "You removed this ingredient and they changed it.",
  "theirs-removed": "They removed this ingredient and you changed it.",
  "both-added": "You both added this ingredient.",
};

function lineView(c: LineConflict, ctx: ViewCtx): ConflictItemView {
  const l = c.mine ?? c.theirs ?? c.base;
  const componentChanged = c.mine && c.theirs && (c.mine.component_id !== c.theirs.component_id || c.mine.component_type !== c.theirs.component_type);
  const withName = (x: RecipeLine | null) => (x && componentChanged ? [`${ctx.componentName(x)}, ${lineText(x)[0]}`] : lineText(x));
  return { id: c.id, heading: l ? ctx.componentName(l) : "Ingredient", note: LINE_NOTE[c.why], mine: withName(c.mine), theirs: withName(c.theirs) };
}

/** One entry per conflict, in the order they should be shown: fields first, then ingredients. */
export function buildConflictView(conflicts: readonly Conflict[], ctx: ViewCtx): ConflictItemView[] {
  return conflicts.map((c) => (c.kind === "field" ? fieldView(c, ctx) : lineView(c, ctx)));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What each button does, before anyone taps it. */
export function choiceImpact(conflictCount: number, theirs: Pick<TheirChanges, "count">): { keepMine: string; useTheirs: string; cancel: string } {
  const these = conflictCount === 1 ? "the clash" : `all ${conflictCount} clashes`;
  const kept = theirs.count > conflictCount ? " Everything else they changed is kept." : "";
  return {
    keepMine: `Your version wins ${these}.${kept}`,
    useTheirs: `Their version wins ${these}. Your other changes are still saved.`,
    cancel: "Nothing is saved. Your edits stay on the page.",
  };
}

// ---------------------------------------------------------------- who and when

const TZ = "Australia/Brisbane";

function brisbaneDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** "1:38pm" today in Brisbane, "Sat 3 Oct, 1:38pm" on another day. Empty when the stamp is missing or not a date. */
export function formatWhen(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(d).replace(/\s/g, "").toLowerCase();
  if (brisbaneDay(d) === brisbaneDay(now)) return time;
  const day = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(d).replace(",", "");
  return `${day}, ${time}`;
}

/** "Brendan", "You in another window" when it was this login, "Someone" when the stamp has no name. */
export function whoLabel(name: string | null | undefined, opts: { isMe?: boolean } = {}): string {
  if (opts.isMe) return "You in another window";
  return name?.trim() || "Someone";
}

function atTime(iso: string | null | undefined, now?: Date): string {
  const t = formatWhen(iso, now);
  return t ? ` at ${t}` : "";
}

/** The toast after a save that also kept someone else's changes. */
export function mergedToast(who: string, iso: string | null | undefined, now?: Date): string {
  return `Saved. Also kept changes made by ${who}${atTime(iso, now)}`;
}

/** The quiet line under the save bar while someone else's save is waiting to be reviewed. */
export function staleNotice(who: string, iso: string | null | undefined, now?: Date): string {
  return `${who} saved changes to this${atTime(iso, now)}. You can keep editing; you will be asked to review when you save.`;
}

/** The first line of the conflict sheet. */
export function conflictIntro(who: string, iso: string | null | undefined, now?: Date): string {
  return `${who} changed this${atTime(iso, now)}, after you opened it. You both changed the items below. Choose whose version to keep.`;
}

const LINE_LABEL = /^\d+ Ingredients? (Added|Removed|Changed)$|^Ingredient Order$/;

/**
 * What they changed that is NOT one of the clashes shown, for "kept either way": "Price · 1 Ingredient Added".
 * A field that clashes is left out; when ingredients clash too, the ingredient counts are left out (they would mix the two).
 */
export function keptChangeList(labels: readonly string[], conflicts: readonly Conflict[]): string {
  const clashing = new Set(conflicts.flatMap((c) => (c.kind === "field" ? [c.label] : [])));
  const lineClash = conflicts.some((c) => c.kind === "line");
  return labels.filter((l) => !clashing.has(l) && !(lineClash && LINE_LABEL.test(l))).join(" · ");
}

export { fieldLabel };
