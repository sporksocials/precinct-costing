import { describe, expect, it } from "vitest";
import { describeHistoryRow, NO_HISTORY_LOOKUPS, type HistoryLookups, type HistoryRow } from "@/lib/change-history";
import { HISTORY_SHOWN, applyPlanToLines, applyPlanToRecord, planUndo, recordEvents, scopeOfEventId, showValue, visibleEvents, type UndoContext } from "@/lib/undo-change";
import type { RecipeLine } from "@/lib/types";

type Row = Record<string, unknown>;
let seq = 100;
const t = (min: number) => new Date(Date.parse("2026-10-05T01:00:00Z") + min * 60_000).toISOString();

function h(table: string, key: string, op: "insert" | "update" | "delete", o: { old?: Row | null; new?: Row | null; fields?: string[]; at?: number; parent?: [string, string] }): HistoryRow {
  seq += 1;
  return { id: seq, tx_id: seq, table_name: table, row_key: key, op, old_row: o.old ?? null, new_row: o.new ?? null, changed_fields: o.fields ?? [], parent_table: o.parent?.[0] ?? null, parent_id: o.parent?.[1] ?? null, changed_by: "matt@example.com", changed_at: t(o.at ?? 0) };
}
const upd = (fields: string[], old: Row, nw: Row, at = 0) => h("cost_menu_items", "d1", "update", { old: { id: "d1", name: "Margarita", category: "Cocktail", ...old }, new: { id: "d1", name: "Margarita", category: "Cocktail", ...nw }, fields, at });
const ln = (id: string, ing: string, qty: number, sort = 1): RecipeLine => ({ id, parent_type: "item", parent_id: "d1", component_type: "ingredient", component_id: ing, qty, unit: "ml", note: null, sort });
const lineRow = (op: "insert" | "update" | "delete", l: Row, o: { old?: Row; fields?: string[]; at?: number } = {}) => h("cost_recipe_lines", String(l.id), op, { old: op === "insert" ? null : o.old ?? l, new: op === "delete" ? null : l, fields: o.fields, at: o.at, parent: ["cost_menu_items", "d1"] });

const NAMES: Record<string, string> = { i1: "Lime Juice", i2: "Tequila" };
function ctx(over: Partial<UndoContext> = {}): UndoContext {
  return { kind: "item", id: "d1", record: { id: "d1", name: "Margarita", glass: "Martini Glass" }, lines: [ln("l1", "i1", 30)], history: [], ingredientName: (id) => NAMES[id], prepName: () => undefined, ...over };
}

describe("field update on the record", () => {
  it("puts each changed field back, with the impact sentence", () => {
    const row = upd(["glass"], { glass: "Coupe Glass" }, { glass: "Martini Glass" });
    const p = planUndo(row, null, ctx());
    expect(p.undoable).toBe(true);
    expect(p.fieldPatch).toEqual({ glass: "Coupe Glass" });
    expect(p.impact).toEqual(["This puts Glass back to Coupe Glass. It is Martini Glass now."]);
    expect(p.warnings).toEqual([]);
  });
  it("only fields in changed_fields are touched", () => {
    const row = upd(["glass"], { glass: "Coupe Glass", notes: "old" }, { glass: "Martini Glass", notes: "new" });
    expect(Object.keys(planUndo(row, null, ctx()).fieldPatch)).toEqual(["glass"]);
  });
  it("a scope limits a multi-field row to one field", () => {
    const row = upd(["glass", "notes"], { glass: "Coupe Glass", notes: "a" }, { glass: "Martini Glass", notes: "b" });
    const p = planUndo(row, "notes", ctx({ record: { id: "d1", glass: "Martini Glass", notes: "b" } }));
    expect(p.fieldPatch).toEqual({ notes: "a" });
  });
  it("warns when the field was changed again afterwards, naming the current value", () => {
    const row = upd(["glass"], { glass: "Coupe Glass" }, { glass: "Martini Glass" }, 0);
    const again = upd(["glass"], { glass: "Martini Glass" }, { glass: "Rocks Glass" }, 10);
    const p = planUndo(row, null, ctx({ record: { id: "d1", glass: "Rocks Glass" }, history: [row, again] }));
    expect(p.undoable).toBe(true);
    expect(p.warnings).toEqual(["This was changed again after this event: the current value is Rocks Glass. Undo anyway?"]);
  });
  it("a later change to a different field gives no warning", () => {
    const row = upd(["glass"], { glass: "Coupe Glass" }, { glass: "Martini Glass" }, 0);
    const other = upd(["notes"], { notes: "a" }, { notes: "b" }, 10);
    expect(planUndo(row, null, ctx({ history: [row, other] })).warnings).toEqual([]);
  });
  it("is a no-op when the draft already holds the earlier value", () => {
    const row = upd(["glass"], { glass: "Coupe Glass" }, { glass: "Martini Glass" });
    const p = planUndo(row, null, ctx({ record: { id: "d1", glass: "Coupe Glass" } }));
    expect(p).toMatchObject({ undoable: false, noop: true });
  });
  it("JSON columns go back whole", () => {
    const row = upd(["method"], { method: ["Shake", "Strain"] }, { method: ["Shake", "Strain", "Garnish"] });
    const p = planUndo(row, null, ctx({ record: { id: "d1", method: ["Shake", "Strain", "Garnish"] } }));
    expect(p.fieldPatch).toEqual({ method: ["Shake", "Strain"] });
    expect(p.impact[0]).toBe("This puts Method back to 2 steps. It is 3 steps now.");
    const dopts = upd(["diet_options"], { diet_options: { gfo: { note: "no bun" } } }, { diet_options: null });
    expect(planUndo(dopts, null, ctx({ record: { id: "d1", diet_options: null } })).fieldPatch).toEqual({ diet_options: { gfo: { note: "no bun" } } });
  });
  it("a null earlier value is put back as null", () => {
    const row = upd(["section"], { section: null }, { section: "Classics" });
    expect(planUndo(row, null, ctx({ record: { id: "d1", section: "Classics" } })).fieldPatch).toEqual({ section: null });
  });
  it("adding or deleting the record itself is not undoable here", () => {
    const ins = h("cost_menu_items", "d1", "insert", { new: { id: "d1", name: "Margarita" } });
    const del = h("cost_menu_items", "d1", "delete", { old: { id: "d1", name: "Margarita" } });
    expect(planUndo(ins, null, ctx()).undoable).toBe(false);
    expect(planUndo(del, null, ctx()).blocked).toMatch(/Trash/);
  });
  it("a row for another record is refused", () => {
    const other = h("cost_menu_items", "zzz", "update", { old: { glass: "a" }, new: { glass: "b" }, fields: ["glass"] });
    expect(planUndo(other, null, ctx()).undoable).toBe(false);
  });
});

describe("recipe line events", () => {
  it("an added line is removed from the draft", () => {
    const p = planUndo(lineRow("insert", ln("l1", "i1", 30) as unknown as Row), null, ctx());
    expect(p.removeLineIds).toEqual(["l1"]);
    expect(p.impact).toEqual(["This takes Lime Juice 30 ml out of the recipe."]);
    expect(applyPlanToLines(ctx().lines, p)).toEqual([]);
  });
  it("an added line already gone is a no-op", () => {
    expect(planUndo(lineRow("insert", ln("lx", "i2", 5) as unknown as Row), null, ctx()).noop).toBe(true);
  });
  it("a removed line comes back with its original id, values and place", () => {
    const gone = ln("l0", "i2", 45, 0);
    const p = planUndo(lineRow("delete", gone as unknown as Row), null, ctx());
    expect(p.undoable).toBe(true);
    expect(p.addLines[0]).toMatchObject({ id: "l0", component_id: "i2", qty: 45, parent_id: "d1", parent_type: "item" });
    expect(applyPlanToLines(ctx().lines, p).map((l) => l.id)).toEqual(["l0", "l1"]);
    expect(p.impact).toEqual(["This adds Tequila 45 ml back to the recipe."]);
  });
  it("a removed line whose ingredient no longer exists is not added and says so", () => {
    const p = planUndo(lineRow("delete", ln("l9", "gone", 10) as unknown as Row), null, ctx());
    expect(p.undoable).toBe(false);
    expect(p.blocked).toMatch(/no longer exists/);
    expect(p.addLines).toEqual([]);
    expect(p.skipped).toHaveLength(1);
  });
  it("a removed prep line is checked against preps", () => {
    const pl = { ...ln("lp", "p1", 1), component_type: "prep" } as unknown as Row;
    expect(planUndo(lineRow("delete", pl), null, ctx()).blocked).toMatch(/prep no longer exists/i);
    expect(planUndo(lineRow("delete", pl), null, ctx({ prepName: (id) => (id === "p1" ? "Syrup" : undefined) })).undoable).toBe(true);
  });
  it("a removed line already back is a no-op", () => {
    expect(planUndo(lineRow("delete", ln("l1", "i1", 30) as unknown as Row), null, ctx()).noop).toBe(true);
  });
  it("an amount change puts the old amount back and warns if changed again", () => {
    const row = lineRow("update", ln("l1", "i1", 45) as unknown as Row, { old: ln("l1", "i1", 30) as unknown as Row, fields: ["qty"], at: 0 });
    const later = lineRow("update", ln("l1", "i1", 60) as unknown as Row, { old: ln("l1", "i1", 45) as unknown as Row, fields: ["qty"], at: 10 });
    const c = ctx({ lines: [ln("l1", "i1", 60)], history: [row, later] });
    const p = planUndo(row, "amount", c);
    expect(p.updateLines).toEqual([{ id: "l1", patch: { qty: 30 } }]);
    expect(p.impact[0]).toBe("This puts Lime Juice 30 ml back on the line. It is Lime Juice 60 ml now.");
    expect(p.warnings[0]).toMatch(/changed again after this event/);
    expect(applyPlanToLines(c.lines, p)[0].qty).toBe(30);
  });
  it("an amount change on a line removed since cannot be undone", () => {
    const row = lineRow("update", ln("l5", "i1", 45) as unknown as Row, { old: ln("l5", "i1", 30) as unknown as Row, fields: ["qty"] });
    expect(planUndo(row, "amount", ctx()).blocked).toMatch(/removed since/);
  });
  it("swapping an ingredient back needs the old ingredient to exist", () => {
    const row = lineRow("update", ln("l1", "i2", 30) as unknown as Row, { old: ln("l1", "gone", 30) as unknown as Row, fields: ["component_id"] });
    expect(planUndo(row, null, ctx({ lines: [ln("l1", "i2", 30)] })).blocked).toMatch(/no longer exists/);
  });
});

describe("applying and listing", () => {
  it("applyPlanToRecord returns a new object", () => {
    const rec = { glass: "Martini Glass", name: "Margarita" };
    const p = planUndo(upd(["glass"], { glass: "Coupe Glass" }, { glass: "Martini Glass" }), null, ctx());
    expect(applyPlanToRecord(rec, p)).toEqual({ glass: "Coupe Glass", name: "Margarita" });
    expect(rec.glass).toBe("Martini Glass");
  });
  const lk: HistoryLookups = { ...NO_HISTORY_LOOKUPS, itemName: (id) => (id === "d1" ? { name: "Margarita", venueId: 1 } : undefined), venueName: () => "Drift", ingredientName: (id) => NAMES[id] };
  const rows = [
    upd(["glass"], { glass: "Coupe Glass" }, { glass: "Martini Glass" }, 5),
    lineRow("delete", ln("l2", "i2", 15) as unknown as Row, { at: 4 }),
    lineRow("insert", ln("l1", "i1", 30) as unknown as Row, { at: 1 }),
    h("cost_menu_items", "other", "update", { old: { name: "x" }, new: { name: "y" }, fields: ["name"], at: 9 }),
  ];
  it("lists this record's and its lines' events newest first with plain summaries", () => {
    const ev = recordEvents(rows, "item", "d1", (r) => describeHistoryRow(r, lk));
    expect(ev.map((e) => e.summary)).toEqual(["Changed Glass: Coupe Glass to Martini Glass", "Removed Tequila 15 ml", "Added Lime Juice 30 ml"]);
    expect(ev.every((e) => e.canUndo)).toBe(true);
  });
  it("marks the record's own add and delete as informational", () => {
    const ev = recordEvents([h("cost_menu_items", "d1", "insert", { new: { id: "d1", name: "Margarita", category: "Cocktail" } })], "item", "d1", (r) => describeHistoryRow(r, lk));
    expect(ev[0].canUndo).toBe(false);
  });
  it("scopeOfEventId reads the field suffix", () => {
    expect(scopeOfEventId("hist:12:glass", 12)).toBe("glass");
    expect(scopeOfEventId("hist:12", 12)).toBeNull();
  });
  it("shows the latest 10 and Show More expands", () => {
    const many = Array.from({ length: 14 }, (_, i) => i);
    expect(visibleEvents(many, false)).toEqual({ shown: many.slice(0, HISTORY_SHOWN), canExpand: true });
    expect(visibleEvents(many, true).shown).toHaveLength(14);
    expect(visibleEvents([1, 2], false).canExpand).toBe(false);
  });
  it("formats values for sentences", () => {
    expect(showValue("sell_price_inc", 18)).toBe("$18.00");
    expect(showValue("glass", null)).toBe("None");
    expect(showValue("active", false)).toBe("No");
  });
});
