/**
 * Research notes: manager-only suggestions on a recipe, with the cost and GP effect worked out from the note's
 * `changes` (see cost_research_notes). Pure and framework free.
 *
 * A change's qty is a DELTA: positive adds that much of the ingredient (to the line already in the recipe, or as a new
 * line), negative takes that much off (never below zero). Costs are ex GST and sell prices inc GST, exactly as the rest
 * of the app (lib/costing.ts). A note never alters a recipe; this only prices the "what if".
 */
import { costItem, ingredientCostPerBase, unitBase, UNIT_FACTORS, type CostingIndex } from "./costing";
import { gp, money } from "./format";
import type { MethodOp } from "./method-style";
import { formatQty } from "./parse-qty";
import { LINE_UNITS, type AppliedLine, type AppliedRecord, type CostingSettings, type LineUnit, type MenuItem, type RecipeLine, type ResearchChange, type ResearchKind, type ResearchNote, type ResearchStatus, type Target } from "./types";

export const KIND_LABEL: Record<ResearchKind, string> = { suggestion: "Suggestion", difference: "Differs From Classic" };
export const STATUS_LABEL: Record<ResearchStatus, string> = { open: "Open", approved: "Approved", dismissed: "Dismissed" };

const STATUS_ORDER: Record<ResearchStatus, number> = { open: 0, approved: 1, dismissed: 2 };

/** Notes in the order people read them: open first, then approved, then dismissed; oldest first inside each. */
export function sortNotes<T extends Pick<ResearchNote, "status" | "created_at" | "title" | "id">>(notes: readonly T[]): T[] {
  return [...notes].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.created_at.localeCompare(b.created_at) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

export function notesForRecord(notes: readonly ResearchNote[], kind: "item" | "prep", id: string): ResearchNote[] {
  return sortNotes(notes.filter((n) => (kind === "item" ? n.item_id === id : n.item_id == null && n.prep_id === id)));
}

export function countByStatus(notes: readonly Pick<ResearchNote, "status">[]): Record<ResearchStatus | "all", number> {
  const out = { open: 0, approved: 0, dismissed: 0, all: 0 };
  for (const n of notes) {
    out[n.status] += 1;
    out.all += 1;
  }
  return out;
}

/** Only http(s) links are ever rendered as links. */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- cost effect

export type EffectStatus =
  | "ok"
  /** the menu item has no sell price */
  | "no_price"
  /** an ingredient in the note prices at $0 */
  | "price_tbc"
  /** empty, unreadable or do-nothing changes */
  | "no_changes"
  /** an ingredient in the note is gone, or its unit does not match how it is bought */
  | "problem"
  /** a prep note, or a recipe that cannot be found: no effect is worked out */
  | "text_only";

export interface ChangedLine {
  ingredientId: string;
  name: string;
  unit: LineUnit;
  from: number;
  to: number;
}

export interface NoteEffect {
  status: EffectStatus;
  /** the sentence to show; empty for a prep note */
  text: string;
  /** per portion, ex GST (set for ok, and for no_price) */
  baselineCost?: number;
  newCost?: number;
  deltaCost?: number;
  /** at the menu sell price (ok only) */
  baselineGp?: number;
  newGp?: number;
  /** percentage points, new minus old (ok only) */
  deltaGpPoints?: number;
  price?: number;
  changedLines?: ChangedLine[];
}

export interface EffectInput {
  changes: unknown;
  /** the menu item the note sits on; null for a prep note (text only) */
  item: MenuItem | null | undefined;
  /** the item's recipe lines as saved */
  lines: RecipeLine[];
  index: CostingIndex;
  settings: CostingSettings;
  targets: Target[];
}

/** "drink" for the bar, "dish" for food, "serve" for gelato. */
export function portionWord(category: string | null | undefined): string {
  if (category === "Food") return "dish";
  if (category === "Gelato") return "serve";
  return "drink";
}

/** Reads the jsonb `changes` defensively: only well-formed, non-zero changes survive. */
export function cleanChanges(raw: unknown): ResearchChange[] {
  if (!Array.isArray(raw)) return [];
  const out: ResearchChange[] = [];
  for (const c of raw as Partial<ResearchChange>[]) {
    const qty = Number(c?.qty);
    if (!c || typeof c.ingredient_id !== "string" || !c.ingredient_id) continue;
    if (!Number.isFinite(qty) || qty === 0) continue;
    if (!LINE_UNITS.includes(c.unit as LineUnit)) continue;
    out.push({ ingredient_id: c.ingredient_id, qty, unit: c.unit as LineUnit });
  }
  return out;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function joinNames(names: string[]): string {
  const u = [...new Set(names)];
  return u.length <= 1 ? (u[0] ?? "") : `${u.slice(0, -1).join(", ")} and ${u[u.length - 1]}`;
}

/**
 * Applies the changes to a copy of the recipe: a positive delta adds to the first line of that ingredient (converting
 * units) or becomes a new line; a negative delta reduces matching lines in order, never below zero.
 */
export function applyChanges(lines: RecipeLine[], changes: ResearchChange[], parent: { type: "item" | "prep"; id: string }, makeId?: () => string): { lines: RecipeLine[]; touched: Map<string, { unit: LineUnit; from: number; to: number }> } {
  const work: RecipeLine[] = lines.map((l) => ({ ...l }));
  const touched = new Map<string, { unit: LineUnit; from: number; to: number }>();
  const record = (id: string, unit: LineUnit, from: number, to: number) => {
    const t = touched.get(id);
    if (t) t.to = to;
    else touched.set(id, { unit, from, to });
  };
  let n = 0;
  for (const c of changes) {
    const base = unitBase(c.unit);
    const matching = work.filter((l) => l.component_type === "ingredient" && l.component_id === c.ingredient_id && unitBase(l.unit) === base);
    const sum = () => matching.reduce((s, l) => s + (Number(l.qty) || 0) * UNIT_FACTORS[l.unit], 0);
    const shownUnit = matching[0]?.unit ?? c.unit;
    const from = matching.length ? round6(sum() / UNIT_FACTORS[shownUnit]) : 0;
    if (c.qty > 0) {
      if (matching.length) {
        const l = matching[0];
        l.qty = round6((Number(l.qty) || 0) + (c.qty * UNIT_FACTORS[c.unit]) / UNIT_FACTORS[l.unit]);
      } else {
        n += 1;
        const line: RecipeLine = { id: makeId ? makeId() : `research:${n}`, parent_type: parent.type, parent_id: parent.id, component_type: "ingredient", component_id: c.ingredient_id, qty: c.qty, unit: c.unit, note: null, sort: 1000 + n };
        work.push(line);
        matching.push(line);
      }
    } else {
      let remaining = Math.abs(c.qty) * UNIT_FACTORS[c.unit];
      for (const l of matching) {
        if (remaining <= 0) break;
        const have = (Number(l.qty) || 0) * UNIT_FACTORS[l.unit];
        const take = Math.min(have, remaining);
        l.qty = round6(Math.max(0, (have - take) / UNIT_FACTORS[l.unit]));
        remaining -= take;
      }
    }
    const to = matching.length ? round6(sum() / UNIT_FACTORS[shownUnit]) : 0;
    if (to !== from) record(c.ingredient_id, shownUnit, from, to);
  }
  return { lines: work, touched };
}

/**
 * What a note would do to the cost and GP of its menu item, in a sentence plus the numbers behind it.
 * Cannot-work-it-out cases return a clear status instead of a guess:
 *   empty / do-nothing changes -> "No cost effect worked out"      an ingredient priced at $0 -> "Price TBC for <name>"
 *   no menu sell price         -> "Add a sell price to see GP"     a prep note -> text only (no effect line)
 */
export function researchNoteEffect(input: EffectInput): NoteEffect {
  const { item, lines, index, settings, targets } = input;
  const changes = cleanChanges(input.changes);
  if (!item) return { status: "text_only", text: "" };
  if (!changes.length) return { status: "no_changes", text: "No cost effect worked out" };

  const missing: string[] = [];
  const mismatch: string[] = [];
  const tbc: string[] = [];
  for (const c of changes) {
    const ing = index.ingredients.get(c.ingredient_id);
    if (!ing) {
      missing.push(c.ingredient_id);
      continue;
    }
    if (unitBase(c.unit) !== ing.pack_unit) mismatch.push(ing.name);
    else if (!(ingredientCostPerBase(ing, settings.gst_rate) > 0)) tbc.push(ing.name);
  }
  if (missing.length) return { status: "problem", text: "An ingredient in this note no longer exists" };
  if (mismatch.length) return { status: "problem", text: `The unit in this note does not match how ${joinNames(mismatch)} is bought` };
  const applied = applyChanges(lines, changes, { type: "item", id: item.id });
  if (!applied.touched.size) return { status: "no_changes", text: "No cost effect worked out" };
  const changedLines: ChangedLine[] = [...applied.touched.entries()].map(([id, t]) => ({ ingredientId: id, name: index.ingredients.get(id)?.name ?? "", unit: t.unit, from: t.from, to: t.to }));
  // an unpriced ingredient: no cost or GP can be worked out, but the quantity change itself can still be applied
  if (tbc.length) return { status: "price_tbc", text: `Price TBC for ${joinNames(tbc)}`, changedLines };

  const before = costItem(item, index, settings, targets, new Map(), lines);
  const after = costItem(item, index, settings, targets, new Map(), applied.lines);
  const deltaCost = after.costPerPortion - before.costPerPortion;
  const base = { baselineCost: before.costPerPortion, newCost: after.costPerPortion, deltaCost, changedLines };

  if (before.sellInc == null || !(before.sellInc > 0) || before.gpPct == null || after.gpPct == null) {
    return { status: "no_price", text: "Add a sell price to see GP", ...base };
  }
  const price = before.sellInc;
  const baselineGp = before.gpPct;
  const newGp = after.gpPct;
  const word = portionWord(item.category);
  const cents = Math.round(Math.abs(deltaCost) * 100);
  let a = gp(baselineGp, 0);
  let b = gp(newGp, 0);
  if (a === b && cents > 0) {
    a = gp(baselineGp, 1);
    b = gp(newGp, 1);
  }
  const priceText = money(price, Number.isInteger(price) ? 0 : 2);
  const gpText = a === b ? `GP stays at ${a} at ${priceText}.` : `GP goes from ${a} to ${b} at ${priceText}.`;
  const lead = cents === 0 ? `Barely changes the cost per ${word}.` : deltaCost > 0 ? `Adds about ${money(Math.abs(deltaCost))} per ${word}.` : `Saves about ${money(Math.abs(deltaCost))} per ${word}.`;
  return { status: "ok", text: `${lead} ${gpText}`, ...base, baselineGp, newGp, deltaGpPoints: (newGp - baselineGp) * 100, price };
}

/** A phrase for the cost effect's tone: more cost reads as a warning, savings as good. */
export function effectTone(e: NoteEffect): "warn" | "good" | "neutral" {
  if (e.status !== "ok") return "neutral";
  const d = e.deltaCost ?? 0;
  if (Math.abs(d) < 0.005) return "neutral";
  return d > 0 ? "warn" : "good";
}

// ---------------------------------------------------------------- review page grouping

export interface NoteRecord {
  name: string;
  venueId: number | null;
  href: string;
}

export interface DrinkGroup {
  key: string;
  name: string;
  href: string | null;
  notes: ResearchNote[];
}

export interface VenueGroup {
  venueId: number | null;
  drinks: DrinkGroup[];
  count: number;
}

/**
 * Groups notes by venue (in the given venue order, "no venue" last), then by recipe name. `resolve` says which recipe a
 * note belongs to; a note whose recipe cannot be found is kept, under "(Recipe not found)" with no link.
 */
export function groupNotes(notes: readonly ResearchNote[], resolve: (n: ResearchNote) => NoteRecord | null, venueOrder: readonly number[]): VenueGroup[] {
  const byVenue = new Map<number | null, Map<string, DrinkGroup>>();
  for (const n of sortNotes(notes)) {
    const r = resolve(n);
    const vid = r?.venueId ?? null;
    const key = n.item_id ? `item:${n.item_id}` : n.prep_id ? `prep:${n.prep_id}` : `note:${n.id}`;
    let drinks = byVenue.get(vid);
    if (!drinks) byVenue.set(vid, (drinks = new Map()));
    let g = drinks.get(key);
    if (!g) drinks.set(key, (g = { key, name: r?.name ?? "(Recipe not found)", href: r?.href ?? null, notes: [] }));
    g.notes.push(n);
  }
  const order = (v: number | null) => (v == null ? Number.MAX_SAFE_INTEGER : venueOrder.indexOf(v) === -1 ? Number.MAX_SAFE_INTEGER - 1 : venueOrder.indexOf(v));
  return [...byVenue.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([venueId, drinks]) => {
      const list = [...drinks.values()].sort((a, b) => a.name.localeCompare(b.name));
      return { venueId, drinks: list, count: list.reduce((s, d) => s + d.notes.length, 0) };
    });
}

// ---------------------------------------------------------------- Approve applies the note

/** Done notes (approved or dismissed) sit under one "Done (n)" row; open ones stay in the list. */
export function partitionNotes<T extends Pick<ResearchNote, "status">>(notes: readonly T[]): { open: T[]; done: T[] } {
  return { open: notes.filter((n) => n.status === "open"), done: notes.filter((n) => n.status !== "open") };
}

export interface ApplyKinds {
  /** the note has priced changes that would update recipe lines */
  lines: boolean;
  /** the note adds or replaces a method step (a suggested step, or a typed answer) */
  method: boolean;
  /** the note is a question: Approve first asks for a short typed answer */
  question: boolean;
  /** anything at all to apply; false means Approve simply closes the note */
  any: boolean;
}

/**
 * What Approve would do for this note. A prep note is text only (its recipe is not edited from a note), so it never
 * applies anything; neither does a note whose recipe cannot be found.
 */
export function applyKinds(note: Pick<ResearchNote, "item_id" | "changes" | "method_step" | "answer_prompt">, itemFound: boolean): ApplyKinds {
  if (!note.item_id || !itemFound) return { lines: false, method: false, question: false, any: false };
  const question = !!note.answer_prompt?.trim();
  const method = question || !!note.method_step?.trim();
  const lines = cleanChanges(note.changes).length > 0;
  return { lines, method, question, any: lines || method };
}

/** Which effect statuses let the priced changes be written to the recipe. */
export function effectCanApply(e: NoteEffect | undefined): boolean {
  return !!e && (e.status === "ok" || e.status === "no_price" || e.status === "price_tbc") && !!e.changedLines?.length;
}

const round6b = (n: number) => Math.round(n * 1e6) / 1e6;

/** A copy of the method with the op applied; the index is kept inside the list. */
export function applyMethodOp(method: readonly string[], op: MethodOp): string[] {
  const next = [...method];
  if (op.op === "replace") {
    if (op.index >= 0 && op.index < next.length) next[op.index] = op.text;
    else next.push(op.text);
  } else {
    next.splice(Math.max(0, Math.min(op.index, next.length)), 0, op.text);
  }
  return next;
}

export interface MethodOpText {
  /** "Add to the method after step 3" */
  headline: string;
  /** the step being replaced, for a replace */
  old?: string;
  /** the new step */
  text: string;
  /** one sentence, used for the Done list and Undo toast */
  sentence: string;
}

/** The plain wording of a method op against the method it will change. */
export function describeMethodOp(method: readonly string[], op: MethodOp): MethodOpText {
  if (op.op === "replace") {
    const old = method[op.index] ?? "";
    return { headline: `Replace step ${op.index + 1}`, old, text: op.text, sentence: `Replace step ${op.index + 1}: ${old} to ${op.text}` };
  }
  const idx = Math.max(0, Math.min(op.index, method.length));
  const headline = !method.length ? "Add to the method as the first step" : idx === 0 ? "Add to the method as step 1" : `Add to the method after step ${idx}`;
  return { headline, text: op.text, sentence: `${headline}: ${op.text}` };
}

/** True when the op would add a step that is already in the method (so there is nothing to change). */
export function opIsNoop(method: readonly string[], op: MethodOp): boolean {
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  if (op.op === "replace") return same(method[op.index] ?? "", op.text);
  return method.some((m) => same(m, op.text));
}

export interface PlanInput {
  note: Pick<ResearchNote, "changes">;
  item: MenuItem;
  /** the recipe lines as they are right now (the editor's draft, or the store) */
  lines: RecipeLine[];
  /** the method as it is right now */
  method: readonly string[];
  /** the note's cost effect against `lines` (researchNoteEffect) */
  effect: NoteEffect | undefined;
  /** the tidied step, when the note has one to apply */
  op?: MethodOp | null;
  makeId: () => string;
  now: string;
}

export interface ApplyPlan {
  lines: RecipeLine[];
  method: string[];
  linesChanged: boolean;
  methodChanged: boolean;
  applied: AppliedRecord;
}

/**
 * The recipe after the note is applied, and the record that lets Undo put it back exactly. Priced changes add their
 * delta to the existing line of that ingredient (units converted) or create a line, never below zero; a method op adds
 * or replaces one step. Pure: nothing is saved here.
 */
export function planApply(input: PlanInput): ApplyPlan {
  const { item, effect, op } = input;
  let lines = input.lines;
  const recorded: AppliedLine[] = [];
  const summary: string[] = [];
  let linesChanged = false;
  if (effectCanApply(effect)) {
    const changes = cleanChanges(input.note.changes);
    const out = applyChanges(input.lines, changes, { type: "item", id: item.id }, input.makeId);
    const before = new Map(input.lines.map((l) => [l.id, l]));
    const top = input.lines.reduce((m, l) => Math.max(m, l.sort), 0);
    let created = 0;
    lines = out.lines.map((l) => {
      const b = before.get(l.id);
      if (!b) {
        created += 1;
        recorded.push({ created_line_id: l.id });
        return { ...l, sort: top + created };
      }
      if (round6b(Number(b.qty) || 0) !== round6b(Number(l.qty) || 0)) recorded.push({ line_id: l.id, before_qty: Number(b.qty) || 0, after_qty: Number(l.qty) || 0 });
      return l;
    });
    linesChanged = recorded.length > 0;
    if (linesChanged) {
      for (const c of effect!.changedLines ?? []) summary.push(c.from === 0 ? `Recipe: add ${c.name} ${formatQty(c.to, c.unit)}` : `Recipe: ${c.name} ${formatQty(c.from, c.unit)} to ${formatQty(c.to, c.unit)}`);
      if (effect!.status === "ok" || effect!.status === "no_price") summary.push(effect!.text);
    }
  }
  let method = [...input.method];
  let methodChanged = false;
  if (op && !opIsNoop(method, op)) {
    method = applyMethodOp(method, op);
    methodChanged = true;
    summary.push(describeMethodOp(input.method, op).sentence);
  }
  const applied: AppliedRecord = { at: input.now, lines: recorded, summary };
  if (methodChanged) {
    applied.method_before = [...input.method];
    applied.method_after = [...method];
  }
  return { lines, method, linesChanged, methodChanged, applied };
}

/** True when an applied record actually changed something (so Undo has something to put back). */
export function hasApplied(note: Pick<ResearchNote, "applied">): boolean {
  const a = note.applied;
  return !!a && (a.lines?.length > 0 || (Array.isArray(a.method_before) && Array.isArray(a.method_after)));
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export interface UndoResult {
  lines: RecipeLine[];
  method: string[];
  /** parts that could not be put back because the recipe has changed since (shown to the person) */
  skipped: string[];
}

/**
 * Puts back what an applied record changed. When the recipe is exactly as the note left it the result is exactly what it
 * was before. If it has been edited since, each part is reversed on its own: a quantity by the amount the note added,
 * a created line removed, the one step added or swapped found again by its text. Parts that cannot be found are skipped.
 */
export function undoApplied(lines: RecipeLine[], method: readonly string[], applied: AppliedRecord): UndoResult {
  const skipped: string[] = [];
  let nextLines = lines.map((l) => ({ ...l }));
  for (const a of applied.lines ?? []) {
    if ("created_line_id" in a) {
      const had = nextLines.length;
      nextLines = nextLines.filter((l) => l.id !== a.created_line_id);
      if (nextLines.length === had) skipped.push("An ingredient line the note added is already gone");
    } else {
      const l = nextLines.find((x) => x.id === a.line_id);
      if (!l) {
        skipped.push("An ingredient line the note changed is already gone");
        continue;
      }
      const now = Number(l.qty) || 0;
      l.qty = now === a.after_qty ? a.before_qty : Math.max(0, round6b(now - (a.after_qty - a.before_qty)));
    }
  }
  let nextMethod = [...method];
  const before = applied.method_before;
  const after = applied.method_after;
  if (Array.isArray(before) && Array.isArray(after)) {
    if (sameList(nextMethod, after)) nextMethod = [...before];
    else {
      let i = 0;
      while (i < before.length && i < after.length && before[i] === after[i]) i++;
      const placed = after[i];
      const at = placed == null ? -1 : nextMethod.indexOf(placed);
      if (at < 0) skipped.push("The method step is already gone");
      else if (after.length === before.length + 1) nextMethod.splice(at, 1);
      else if (after.length === before.length && before[i] != null) nextMethod[at] = before[i];
      else skipped.push("The method has changed since");
    }
  }
  return { lines: nextLines, method: nextMethod, skipped };
}
