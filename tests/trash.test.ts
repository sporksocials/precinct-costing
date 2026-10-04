import { describe, expect, it } from "vitest";
import type { HistoryRow } from "@/lib/change-history";
import { RESTORABLE, RESTORABLE_TABLES, buildTrash, childrenOfDelete, deletedByLabel, deletedWhen, matchesTrash, planRestore, typeOf, withChildren, type LiveView, type Row } from "@/lib/trash";

let seq = 0;
const T0 = Date.parse("2026-10-05T01:00:00Z");
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

function del(table: string, key: string, old: Row, o: { at?: number; by?: string | null; tx?: number | null; parent?: [string, string] } = {}): HistoryRow {
  seq += 1;
  return {
    id: seq,
    tx_id: o.tx === undefined ? seq : o.tx,
    table_name: table,
    row_key: key,
    op: "delete",
    old_row: old,
    new_row: null,
    changed_fields: [],
    parent_table: o.parent?.[0] ?? null,
    parent_id: o.parent?.[1] ?? null,
    changed_by: o.by === undefined ? "matt@example.com" : o.by,
    changed_at: at(o.at ?? 0),
  };
}

const drink = (id: string, name = "Margarita", venue = 1): Row => ({ id, name, venue_id: venue, category: "Cocktail", sell_price_inc: 18 });
const line = (id: string, parent: string, comp: string, extra: Row = {}): Row => ({ id, parent_type: "item", parent_id: parent, component_type: "ingredient", component_id: comp, qty: 30, unit: "ml", sort: 1, ...extra });
const lineDel = (id: string, parent: string, comp: string, o: { at?: number; tx?: number | null } = {}, extra: Row = {}) => del("cost_recipe_lines", id, line(id, parent, comp, extra), { ...o, parent: ["cost_menu_items", parent] });

const none = () => false;

describe("registry", () => {
  it("covers the six restorable parents with their children", () => {
    expect(RESTORABLE_TABLES.sort()).toEqual(["cost_beers", "cost_gelato_serves", "cost_ingredient_deals", "cost_menu_items", "cost_offers", "cost_preps"]);
    expect(RESTORABLE.cost_menu_items.children[0]).toMatchObject({ table: "cost_recipe_lines", fk: "parent_id", parentType: "item" });
    expect(RESTORABLE.cost_preps.children[0]).toMatchObject({ table: "cost_recipe_lines", parentType: "prep" });
    expect(RESTORABLE.cost_beers.children[0]).toMatchObject({ table: "cost_beer_prices", fk: "beer_id" });
    expect(RESTORABLE.cost_gelato_serves.children[0]).toMatchObject({ table: "cost_gelato_serve_lines", fk: "serve_id" });
    expect(RESTORABLE.cost_offers.children[0]).toMatchObject({ table: "cost_offer_lines", fk: "offer_id" });
    expect(RESTORABLE.cost_ingredient_deals.children).toEqual([]);
  });
  it("unique columns match the live indexes", () => {
    expect(RESTORABLE.cost_menu_items.unique).toEqual(["name", "venue_id"]);
    expect(RESTORABLE.cost_preps.unique).toEqual(["name", "venue_id"]);
    expect(RESTORABLE.cost_offers.unique).toBeUndefined();
  });
  it("names the type", () => {
    expect(typeOf("cost_menu_items", { category: "Cocktail" })).toBe("Drink");
    expect(typeOf("cost_menu_items", { category: "Food" })).toBe("Dish");
    expect(typeOf("cost_preps", {})).toBe("Prep");
    expect(typeOf("cost_beers", {})).toBe("Tap Beer");
    expect(typeOf("cost_gelato_serves", {})).toBe("Serve");
    expect(typeOf("cost_offers", {})).toBe("Offer");
    expect(typeOf("cost_ingredient_deals", {})).toBe("Deal");
  });
});

describe("buildTrash", () => {
  it("lists a deleted drink with who, when and its lines (lines deleted just before the parent)", () => {
    const rows = [lineDel("l1", "d1", "i1", { at: -2000, tx: 10 }), lineDel("l2", "d1", "i2", { at: -2000, tx: 10 }), del("cost_menu_items", "d1", drink("d1"), { at: 0, tx: 11 })];
    const t = buildTrash(rows, none);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ key: "d1", name: "Margarita", type: "Drink", venueId: 1, deletedBy: "matt@example.com", childCount: 2 });
    expect(withChildren(t[0])).toBe("with 2 ingredient lines");
  });
  it("leaves out records that are live again (already restored)", () => {
    const rows = [del("cost_menu_items", "d1", drink("d1"))];
    expect(buildTrash(rows, (tb, k) => tb === "cost_menu_items" && k === "d1")).toEqual([]);
  });
  it("keeps only the latest delete of a record deleted twice", () => {
    const rows = [del("cost_menu_items", "d1", drink("d1", "Old Name"), { at: -86_400_000 }), del("cost_menu_items", "d1", drink("d1", "New Name"), { at: 0 })];
    const t = buildTrash(rows, none);
    expect(t).toHaveLength(1);
    expect(t[0].name).toBe("New Name");
  });
  it("ignores deletes on tables that are not restorable and updates", () => {
    const rows = [del("cost_ingredients", "i1", { id: "i1", name: "Lime" }), { ...del("cost_menu_items", "d2", drink("d2")), op: "update" as const }];
    expect(buildTrash(rows, none)).toEqual([]);
  });
  it("orders newest delete first", () => {
    const rows = [del("cost_menu_items", "a", drink("a", "A"), { at: -5000 }), del("cost_menu_items", "b", drink("b", "B"), { at: 0 })];
    expect(buildTrash(rows, none).map((e) => e.name)).toEqual(["B", "A"]);
  });
  it("database work (no email) is kept with a null deleter", () => {
    const t = buildTrash([del("cost_menu_items", "d1", drink("d1"), { by: null })], none);
    expect(t[0].deletedBy).toBeNull();
    expect(deletedByLabel(null, () => "x")).toBe("Database");
    expect(deletedByLabel("matt@example.com", () => "Matt")).toBe("Matt");
  });
  it("a deal is named after its ingredient", () => {
    const t = buildTrash([del("cost_ingredient_deals", "9", { id: "9", ingredient_id: "i1", kind: "volume" })], none, (id) => (id === "i1" ? "Lime Juice" : undefined));
    expect(t[0]).toMatchObject({ name: "Lime Juice deal", type: "Deal", childCount: 0 });
  });
});

describe("childrenOfDelete", () => {
  const parent = del("cost_menu_items", "d1", drink("d1"), { at: 0, tx: 50 });
  const spec = RESTORABLE.cost_menu_items.children[0];

  it("takes lines up to 10 minutes before and 1 minute after, not outside", () => {
    const within = lineDel("a", "d1", "i1", { at: -9 * 60_000, tx: null });
    const tooEarly = lineDel("b", "d1", "i2", { at: -11 * 60_000, tx: null });
    const after = lineDel("c", "d1", "i3", { at: 30_000, tx: null });
    const tooLate = lineDel("d", "d1", "i4", { at: 90_000, tx: null });
    expect(childrenOfDelete(parent, spec, [within, tooEarly, after, tooLate]).map((r) => r.row_key).sort()).toEqual(["a", "c"]);
  });
  it("ignores lines of another parent and lines of the other parent type", () => {
    const other = lineDel("x", "d2", "i1", { at: -1000, tx: null });
    const prepLine = del("cost_recipe_lines", "y", line("y", "d1", "i1", { parent_type: "prep" }), { at: -1000, tx: null, parent: ["cost_menu_items", "d1"] });
    expect(childrenOfDelete(parent, spec, [other, prepLine])).toEqual([]);
  });
  it("with transaction ids, an earlier editor removal is not pulled in with the dish", () => {
    const earlier = lineDel("old", "d1", "i9", { at: -5 * 60_000, tx: 30 }); // removed in an ordinary save
    const g1 = lineDel("a", "d1", "i1", { at: -1000, tx: 40 }); // the delete-all-lines statement
    const g2 = lineDel("b", "d1", "i2", { at: -1000, tx: 40 });
    expect(childrenOfDelete(parent, spec, [earlier, g1, g2]).map((r) => r.row_key).sort()).toEqual(["a", "b"]);
  });
  it("a cascade shares the parent's transaction and is always included", () => {
    const cascade = del("cost_beer_prices", "bp1", { id: "bp1", beer_id: "b1", serve_id: "s1", sort: 1 }, { at: 5, tx: 77, parent: ["cost_beers", "b1"] });
    const beer = del("cost_beers", "b1", { id: "b1", name: "XXXX", venue_id: 1 }, { at: 5, tx: 77 });
    const t = buildTrash([cascade, beer], none);
    expect(t[0].childCount).toBe(1);
    expect(withChildren(t[0])).toBe("with 1 serve price");
  });
  it("the same line deleted twice counts once (the newest)", () => {
    const a = lineDel("a", "d1", "i1", { at: -4000, tx: null });
    const b = lineDel("a", "d1", "i1", { at: -1000, tx: null });
    expect(childrenOfDelete(parent, spec, [a, b])).toHaveLength(1);
  });
  it("returns lines in their original order", () => {
    const l2 = lineDel("l2", "d1", "i2", { at: -1000, tx: 40 }, { sort: 2 });
    const l1 = lineDel("l1", "d1", "i1", { at: -1000, tx: 40 }, { sort: 1 });
    expect(childrenOfDelete(parent, spec, [l2, l1]).map((r) => r.row_key)).toEqual(["l1", "l2"]);
  });
});

/** Live view for planRestore tests */
function live(tables: Record<string, Row[]>): LiveView {
  return { has: (t, k) => (tables[t] ?? []).some((r) => String(r.id) === k), rows: (t) => tables[t] ?? [] };
}
const lk = { venueName: (id: number) => (id === 1 ? "Drift" : id === 2 ? "Chiobu" : undefined), nameOf: (t: string, k: string): string | undefined => (({ "cost_ingredients|i1": "Lime Juice", "cost_ingredients|i2": "Tequila" }) as Record<string, string>)[`${t}|${k}`] };

function entryFor(rows: HistoryRow[], key = "d1") {
  const e = buildTrash(rows, none).find((x) => x.key === key);
  if (!e) throw new Error("no entry");
  return e;
}

describe("planRestore", () => {
  const rows = [lineDel("l1", "d1", "i1", { at: -1000, tx: 40 }), lineDel("l2", "d1", "i2", { at: -1000, tx: 40 }), del("cost_menu_items", "d1", drink("d1"), { tx: 41 })];

  it("restores the parent and every line, impact sentence first", () => {
    const p = planRestore(entryFor(rows), live({ cost_ingredients: [{ id: "i1" }, { id: "i2" }] }), lk);
    expect(p.blocker).toBeNull();
    expect(p.headline).toBe("Restores Margarita (Drift) and its 2 ingredient lines.");
    expect(p.children.map((c) => c.row.id)).toEqual(["l1", "l2"]);
    expect(p.children[0].label).toBe("Lime Juice 30 ml");
    expect(p.skipped).toEqual([]);
    expect(p.researchNote).toMatch(/Research Notes/);
  });
  it("a name clash blocks the restore with the plain message", () => {
    const p = planRestore(entryFor(rows), live({ cost_ingredients: [{ id: "i1" }, { id: "i2" }], cost_menu_items: [{ id: "other", name: "Margarita", venue_id: 1 }] }), lk);
    expect(p.clash).toBe(true);
    expect(p.blocker).toBe("A drink with this name already exists at Drift. Rename or remove it first, then restore.");
  });
  it("the same name at another venue is not a clash", () => {
    const p = planRestore(entryFor(rows), live({ cost_ingredients: [{ id: "i1" }, { id: "i2" }], cost_menu_items: [{ id: "other", name: "Margarita", venue_id: 2 }] }), lk);
    expect(p.blocker).toBeNull();
  });
  it("a line whose ingredient is gone is skipped and listed; the rest still come back", () => {
    const p = planRestore(entryFor(rows), live({ cost_ingredients: [{ id: "i2" }] }), lk);
    expect(p.blocker).toBeNull();
    expect(p.children.map((c) => c.row.id)).toEqual(["l2"]);
    expect(p.skipped).toHaveLength(1);
    expect(p.skipped[0]).toMatchObject({ label: "Lime Juice 30 ml", reason: "Lime Juice no longer exists" });
    expect(p.headline).toBe("Restores Margarita (Drift) and its 1 ingredient line.");
  });
  it("a prep line is checked against preps, not ingredients", () => {
    const r = [del("cost_recipe_lines", "lp", line("lp", "d1", "p1", { component_type: "prep" }), { at: -1000, tx: 40, parent: ["cost_menu_items", "d1"] }), del("cost_menu_items", "d1", drink("d1"), { tx: 41 })];
    const gone = planRestore(entryFor(r), live({ cost_ingredients: [{ id: "p1" }] }), lk);
    expect(gone.skipped).toHaveLength(1);
    const there = planRestore(entryFor(r), live({ cost_preps: [{ id: "p1" }] }), lk);
    expect(there.skipped).toHaveLength(0);
  });
  it("a record already live reads as already back", () => {
    const p = planRestore(entryFor(rows), live({ cost_menu_items: [{ id: "d1", name: "Margarita", venue_id: 1 }] }), lk);
    expect(p.blocker).toMatch(/already back/);
  });
  it("a tap beer whose keg ingredient is gone cannot be restored yet", () => {
    const r = [del("cost_beers", "b1", { id: "b1", name: "XXXX Gold", venue_id: 1, ingredient_id: "i1" })];
    const p = planRestore(entryFor(r, "b1"), live({}), lk);
    expect(p.blocker).toMatch(/keg ingredient Lime Juice no longer exists/);
  });
  it("a prep with no venue never clashes", () => {
    const r = [del("cost_preps", "p1", { id: "p1", name: "Syrup", venue_id: null })];
    const p = planRestore(entryFor(r, "p1"), live({ cost_preps: [{ id: "p2", name: "Syrup", venue_id: null }] }), lk);
    expect(p.blocker).toBeNull();
  });
  it("an offer has no unique name and no research note line", () => {
    const r = [del("cost_offers", "o1", { id: "o1", name: "Happy Hour", venue_id: 1 })];
    const p = planRestore(entryFor(r, "o1"), live({ cost_offers: [] }), lk);
    expect(p.blocker).toBeNull();
    expect(p.researchNote).toBeNull();
    expect(p.headline).toBe("Restores Happy Hour (Drift).");
  });
});

describe("list helpers", () => {
  const e = buildTrash([del("cost_menu_items", "d1", drink("d1")), del("cost_preps", "p1", { id: "p1", name: "Syrup", venue_id: 2 })], none);
  it("filters by search, type and venue", () => {
    const mar = e.find((x) => x.key === "d1")!;
    const syr = e.find((x) => x.key === "p1")!;
    expect(matchesTrash(mar, "marg", "all", null)).toBe(true);
    expect(matchesTrash(mar, "syrup", "all", null)).toBe(false);
    expect(matchesTrash(mar, "", "Prep", null)).toBe(false);
    expect(matchesTrash(syr, "", "Prep", null)).toBe(true);
    expect(matchesTrash(mar, "", "all", 2)).toBe(false);
    expect(matchesTrash(syr, "", "all", 2)).toBe(true);
  });
  it("shows Brisbane time", () => {
    expect(deletedWhen("2026-10-05T04:14:00Z")).toBe("Mon 5 Oct, 2:14 pm");
  });
});
