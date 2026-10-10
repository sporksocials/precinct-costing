import { describe, expect, it } from "vitest";
import { buildRows, type MatrixDish } from "@/lib/allergy-matrix";
import { buildMatrixSheets, liveMatrixUrl, versionLine } from "@/lib/allergy-matrix-print";
import { matrixSections } from "@/lib/allergy-matrix";
import {
  ALL_SECTIONS,
  buildSnapshot,
  changedSheets,
  diffIsEmpty,
  diffSnapshot,
  diffSummary,
  dishRowHash,
  lastPrint,
  lastPrintedLine,
  latestPrints,
  nextVersion,
  printKey,
  printRow,
  printStatus,
  printedKeys,
  readPrint,
  rowsForKey,
  shortHash,
  type MatrixPrint,
} from "@/lib/matrix-prints";
import { allTodos, allergenApprovalAlerts, reprintAlerts, venueTodo } from "@/lib/matrix-todo";
import { buildIndex } from "@/lib/costing";
import type { AllergenIndex } from "@/lib/allergens";
import { confirmAllergens } from "@/lib/dish-allergens";
import type { Ingredient, MenuItem, RecipeLine, Venue } from "@/lib/types";

const NOW = "2026-10-10T03:00:00.000Z";

function dish(id: string, name: string, section: string | null, over: Partial<MatrixDish> & { contains?: string[]; signed?: boolean } = {}): MatrixDish {
  const { contains = [], signed = true, ...rest } = over;
  return { id, name, section, allergens: { contains: contains as never, without: {}, confirmedAt: signed ? NOW : null, confirmedBy: null, components: null, needsSignoff: false }, signOff: signed ? "valid" : "never", marks: [], options: {}, ...rest };
}
const rowsOf = (...d: MatrixDish[]) => buildRows(d);
const print = (venue: number, key: string, version: number, rows = rowsOf(), at = NOW): MatrixPrint => ({ id: `p${venue}${key}${version}`, venue_id: venue, section: key, version, printed_at: at, printed_by: "a@b.c", snapshot: buildSnapshot(rowsForKey(rows, key)) });

describe("hash and snapshot", () => {
  it("shortHash is stable and short", () => {
    expect(shortHash("abc")).toBe(shortHash("abc"));
    expect(shortHash("abc")).not.toBe(shortHash("abd"));
    expect(shortHash("x").length).toBeLessThanOrEqual(11);
  });
  it("a dish's hash changes with its name, section, any cell state or note, or its sign-off being valid", () => {
    const base = rowsOf(dish("a", "Burger", "Mains", { contains: ["milk"] }))[0];
    const h = dishRowHash(base);
    expect(dishRowHash(rowsOf(dish("a", "Burger", "Mains", { contains: ["milk"] }))[0])).toBe(h);
    expect(dishRowHash(rowsOf(dish("a", "Burgers", "Mains", { contains: ["milk"] }))[0])).not.toBe(h);
    expect(dishRowHash(rowsOf(dish("a", "Burger", "Snacks", { contains: ["milk"] }))[0])).not.toBe(h);
    expect(dishRowHash(rowsOf(dish("a", "Burger", "Mains", { contains: ["milk", "egg"] }))[0])).not.toBe(h);
    expect(dishRowHash(rowsOf(dish("a", "Burger", "Mains", { contains: ["milk"], signed: false }))[0])).not.toBe(h);
    const withNote = rowsOf({ ...dish("a", "Burger", "Mains", { contains: ["milk"] }), allergens: { contains: ["milk"], without: { milk: "no cheese" }, confirmedAt: NOW, confirmedBy: null, components: null, needsSignoff: false } })[0];
    expect(dishRowHash(withNote)).not.toBe(h);
  });
  it("snapshots a map of dish id to hash, for the rows of the key only", () => {
    const rows = rowsOf(dish("a", "A", "Mains"), dish("b", "B", "Snacks"));
    expect(Object.keys(buildSnapshot(rowsForKey(rows, "Mains")))).toEqual(["a"]);
    expect(Object.keys(buildSnapshot(rowsForKey(rows, ALL_SECTIONS))).sort()).toEqual(["a", "b"]);
    expect(rowsForKey(rowsOf(dish("z", "Z", null)), "Other")).toHaveLength(1);
  });
});

describe("diff", () => {
  it("names added, removed and changed dishes", () => {
    const d = diffSnapshot({ a: "1", b: "2", c: "3" }, { a: "1", b: "9", d: "4" });
    expect(d).toEqual({ added: ["d"], removed: ["c"], changed: ["b"] });
    expect(diffSummary(d)).toBe("1 added, 1 removed, 1 changed");
    expect(diffIsEmpty(diffSnapshot({ a: "1" }, { a: "1" }))).toBe(true);
    expect(diffSummary({ added: ["x", "y"], removed: [], changed: ["z", "w", "v"] })).toBe("2 added, 3 changed");
  });
});

describe("version increment", () => {
  it("the first print is version 1, then previous highest plus one, per venue and per section", () => {
    expect(nextVersion([], 1, "Mains")).toBe(1);
    expect(nextVersion(null, 1, "Mains")).toBe(1);
    const prints = [print(1, "Mains", 1), print(1, "Mains", 2), print(1, "*", 4), print(2, "Mains", 7)];
    expect(nextVersion(prints, 1, "Mains")).toBe(3);
    expect(nextVersion(prints, 1, "*")).toBe(5);
    expect(nextVersion(prints, 1, "Snacks")).toBe(1);
    expect(nextVersion(prints, 2, "Mains")).toBe(8);
    expect(lastPrint(prints, 1, "Mains")?.version).toBe(2);
  });
  it("the key is * for All Sections and the section name otherwise", () => {
    expect(printKey(null)).toBe("*");
    expect(printKey("*")).toBe("*");
    expect(printKey("  ")).toBe("*");
    expect(printKey("Small Plates")).toBe("Small Plates");
  });
  it("builds the row to insert with the snapshot of just that sheet", () => {
    const rows = rowsOf(dish("a", "A", "Mains"), dish("b", "B", "Snacks"));
    const r = printRow({ venueId: 1, key: "Snacks", version: 3, by: "x@y.z", rows });
    expect(r).toMatchObject({ venue_id: 1, section: "Snacks", version: 3, printed_by: "x@y.z" });
    expect(Object.keys(r.snapshot)).toEqual(["b"]);
  });
  it("keeps only the highest version per venue and key when reading the log", () => {
    const all = [print(1, "Mains", 1), print(1, "Mains", 3), print(1, "Mains", 2), print(2, "Mains", 1)];
    expect(latestPrints(all).map((p) => `${p.venue_id}:${p.version}`).sort()).toEqual(["1:3", "2:1"]);
  });
  it("the sheet carries Sheet version N, only when there is a version", () => {
    expect(versionLine(3)).toBe("Sheet version 3");
    expect(versionLine(null)).toBeNull();
    const sections = matrixSections(rowsOf(dish("a", "A", "Mains")));
    const sheet = buildMatrixSheets({ venueName: "Drift", sections, now: new Date(NOW), version: 4, qrUrl: liveMatrixUrl("https://precinct-costing.vercel.app/", "drift") })[0];
    expect(sheet.versionLine).toBe("Sheet version 4");
    expect(sheet.qrUrl).toBe("https://precinct-costing.vercel.app/kitchen/drift/matrix");
    expect(sheet.crossContact).toBe("Shared fryer and grill: cross-contact is possible. Ask the head chef if unsure.");
    expect(buildMatrixSheets({ venueName: "Drift", sections, now: new Date(NOW) })[0].versionLine).toBeNull();
    expect(buildMatrixSheets({ venueName: "Drift", sections, now: new Date(NOW), crossContact: "  No nuts in this kitchen. " })[0].crossContact).toBe("No nuts in this kitchen.");
  });
});

describe("changed since printed", () => {
  const before = rowsOf(dish("a", "Alpha", "Mains"), dish("b", "Bravo", "Mains"), dish("c", "Charlie", "Mains"));
  const prints = [print(1, "Mains", 2, before, "2026-10-09T03:00:00Z"), print(1, "*", 1, before)];
  it("a sheet never printed reads Not printed yet and is not an alert", () => {
    expect(printStatus(prints, 1, "Snacks", before)).toEqual({ state: "never" });
    expect(printStatus(prints, 2, "Mains", before)).toEqual({ state: "never" });
    expect(printStatus(null, 1, "Mains", before)).toEqual({ state: "never" });
    expect(changedSheets([], 1, before)).toEqual([]);
  });
  it("an unchanged sheet reads Last printed with the date and version (Brisbane time)", () => {
    const s = printStatus(prints, 1, "Mains", before);
    expect(s).toMatchObject({ state: "current", version: 2, line: "Last printed 9 Oct 2026, version 2" });
    expect(lastPrintedLine({ printed_at: "2026-10-09T15:00:00Z", version: 1 })).toBe("Last printed 10 Oct 2026, version 1");
  });
  it("2 added, 1 removed, 3 changed, with the dish names", () => {
    const now = rowsOf(
      dish("a", "Alpha", "Mains", { contains: ["milk"] }), // changed
      dish("c", "Charlie", "Mains", { signed: false }), // changed
      dish("d", "Delta", "Mains"), // added
      dish("e", "Echo", "Mains"), // added
    );
    // b removed; a and c changed. Add one more change so the numbers are 2, 1, 2
    const s = printStatus(prints, 1, "Mains", now, (id) => (id === "b" ? "Bravo" : null));
    expect(s.state).toBe("changed");
    if (s.state !== "changed") return;
    expect(s.summary).toBe("Changed since printed: 2 added, 1 removed, 2 changed");
    expect(s.added).toEqual(["Delta", "Echo"]);
    expect(s.removed).toEqual(["Bravo"]);
    expect(s.changed).toEqual(["Alpha", "Charlie"]);
  });
  it("a removed dish that is gone from everywhere still gets a plain name", () => {
    const s = printStatus(prints, 1, "Mains", rowsOf(dish("a", "Alpha", "Mains"), dish("c", "Charlie", "Mains")));
    expect(s.state === "changed" && s.removed).toEqual(["A dish that is no longer on the menu"]);
  });
  it("a dish whose sign-off stopped being valid counts as changed (its cells went grey)", () => {
    const now = rowsOf(dish("a", "Alpha", "Mains"), dish("b", "Bravo", "Mains", { signed: false }), dish("c", "Charlie", "Mains"));
    const s = printStatus(prints, 1, "Mains", now);
    expect(s.state === "changed" && s.changed).toEqual(["Bravo"]);
  });
  it("a dish in another section does not change this section's sheet, but does change All Sections", () => {
    const now = rowsOf(dish("a", "Alpha", "Mains"), dish("b", "Bravo", "Mains"), dish("c", "Charlie", "Mains"), dish("z", "Zulu", "Snacks"));
    expect(printStatus(prints, 1, "Mains", now).state).toBe("current");
    expect(printStatus(prints, 1, ALL_SECTIONS, now).state).toBe("changed");
  });
  it("lists every changed sheet of a venue, All Sections first", () => {
    const now = rowsOf(dish("a", "Alpha", "Mains", { contains: ["milk"] }), dish("b", "Bravo", "Mains"), dish("c", "Charlie", "Mains"));
    expect(printedKeys(prints, 1)).toEqual(["*", "Mains"]);
    expect(changedSheets(prints, 1, now).map((s) => s.key)).toEqual(["*", "Mains"]);
  });
  it("reads a malformed log row without crashing", () => {
    expect(readPrint(null)).toBeNull();
    expect(readPrint({ venue_id: 1, version: 1, section: "Mains", printed_at: NOW, snapshot: "oops" })?.snapshot).toEqual({});
    expect(readPrint({ venue_id: "x", version: 1 })).toBeNull();
  });
});

/* ------------------------------------------------------------------ the To Do hub and the alerts built on it */

const venue = (id: number, slug: string, name: string): Venue => ({ id, slug, name, sort: id }) as Venue;
const V = [venue(1, "drift", "Drift Bar"), venue(2, "chiobu", "Chiobu")];
const ing = (id: string): Ingredient => ({ id, name: id, category: "Food", supplier_id: null, supplier_code: null, pack_size: 1, pack_unit: "kg", pack_price: 1, price_inc_gst: false, gst_free: false, rebate: 0, yield_pct: 1, venues: "All", active: true, last_price_update: null, previous_price: null, source: null, notes: null, updated_at: null, allergens: [], allergens_reviewed: true, diet_flags: [] }) as Ingredient;
const item = (id: string, name: string, venue_id: number, over: Partial<MenuItem> = {}): MenuItem => ({ id, name, venue_id, category: "Food", section: "Mains", portions: 1, sell_price_inc: 20, target_override: null, hh_price_inc: null, active: true, source: null, notes: null, ...over });
const ln = (parent: string, comp: string, id = `${parent}-${comp}`): RecipeLine => ({ id, parent_type: "item", parent_id: parent, component_type: "ingredient", component_id: comp, qty: 5, unit: "g", note: null, sort: 1 });

describe("To Do lists and the two Home alerts", () => {
  const lines = [ln("a", "i1"), ln("b", "i1"), ln("c", "i1"), ln("d", "i1"), ln("e", "i1"), ln("x", "i1")];
  const signedA = confirmAllergens({ contains: [], without: {} }, "c@d.e", NOW, ["ingredient:i1"]); // valid
  const signedB = confirmAllergens({ contains: [], without: {} }, "c@d.e", NOW, ["ingredient:i-old"]); // ingredients changed
  const legacyC = { contains: [], without: {}, confirmed_at: NOW }; // before the rule
  const signedMarks = confirmAllergens({ contains: ["milk"], without: {} }, "c@d.e", NOW, ["ingredient:i1"]);
  const items = [
    item("a", "Alpha", 1, { dish_allergens: signedA }),
    item("b", "Bravo", 1, { dish_allergens: signedB }),
    item("c", "Charlie", 1, { dish_allergens: legacyC }),
    item("d", "Delta", 1, { dish_allergens: null }),
    item("e", "Echo", 1, { dish_allergens: signedMarks, diet_options: { vg: { } } as never }), // vegan mark, but milk is ticked
    item("x", "Chiobu Dish", 2, { dish_allergens: signedA }),
    item("off", "Switched Off", 1, { active: false }),
    item("drink", "Mojito", 1, { category: "Cocktail" }),
  ];
  const idx: AllergenIndex = { ...buildIndex([ing("i1")], [], lines), items: new Map(items.map((m) => [m.id, m])) };
  const todos = allTodos(V, items, idx, null);
  const drift = todos[0];

  it("lists only active food dishes, split into new and re-check, A to Z", () => {
    expect(drift.rows.map((r) => r.dish.name)).toEqual(["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);
    expect(drift.never.map((r) => r.dish.name)).toEqual(["Delta"]);
    expect(drift.changed.map((r) => r.dish.name)).toEqual(["Bravo", "Charlie"]); // ingredients changed + signed before tracking
  });
  it("Marks Disagree lists a signed dish whose allergens contradict its mark", () => {
    expect(drift.marks.map((r) => r.dish.name)).toEqual(["Echo"]);
    expect(drift.marks[0].warnings[0]).toContain("Marked Vegan");
  });
  it("one allergen approval alert per venue that has any, with the counts in it", () => {
    const a = allergenApprovalAlerts(todos);
    expect(a.map((x) => `${x.venueSlug}:${x.count}:${x.never}:${x.changed}`)).toEqual(["drift:3:1:2"]); // chiobu's one dish is valid
    expect(a[0].href).toBe("/matrix/todo?venue=drift");
    expect(a[0].key).toBe("allergen_approval:drift");
    expect(allergenApprovalAlerts(todos, 2)).toEqual([]);
    expect(allergenApprovalAlerts(todos, 1)).toHaveLength(1);
  });
  it("matrix needs reprinting: only a sheet that was printed and has changed, one row per venue", () => {
    expect(reprintAlerts(todos)).toEqual([]); // nothing printed yet is never an alert
    const rows = drift.rows;
    const old = [print(1, "Mains", 1, rows), print(1, "*", 1, rows)];
    expect(reprintAlerts(allTodos(V, items, idx, old))).toEqual([]); // printed and unchanged
    const changedItems = items.map((m) => (m.id === "d" ? { ...m, name: "Delta Renamed" } : m));
    const idx2: AllergenIndex = { ...buildIndex([ing("i1")], [], lines), items: new Map(changedItems.map((m) => [m.id, m])) };
    const a = reprintAlerts(allTodos(V, changedItems, idx2, old));
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: "matrix_reprint", venueSlug: "drift", count: 2, href: "/matrix/todo?venue=drift" }); // All Sections and Mains
  });
  it("a Home count equals the list behind it: the hub's rows are the alert's count", () => {
    const a = allergenApprovalAlerts(todos)[0];
    expect(a.count).toBe(drift.never.length + drift.changed.length);
  });
  it("venueTodo with no prints loaded reports no reprints", () => {
    expect(venueTodo(V[0], drift.rows, null).reprint).toEqual([]);
  });
});
