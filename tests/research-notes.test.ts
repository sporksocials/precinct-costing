import { describe, expect, it } from "vitest";
import { buildIndex } from "@/lib/costing";
import { applyChanges, cleanChanges, countByStatus, effectTone, groupNotes, notesForRecord, portionWord, researchNoteEffect, safeUrl, sortNotes } from "@/lib/research-notes";
import { DEFAULT_SETTINGS, type Ingredient, type MenuItem, type RecipeLine, type ResearchNote } from "@/lib/types";

const ing = (id: string, name: string, over: Partial<Ingredient> = {}): Ingredient => ({
  id,
  name,
  category: "Bar",
  supplier_id: null,
  supplier_code: null,
  pack_size: 1,
  pack_unit: "L",
  pack_price: 10,
  price_inc_gst: false, // ex GST, so the sums below are plain
  gst_free: false,
  rebate: 0,
  yield_pct: 1,
  venues: "All",
  active: true,
  last_price_update: null,
  previous_price: null,
  source: null,
  notes: null,
  updated_at: null,
  ...over,
});

// per ml: tequila $0.10, lime $0.012 (L), syrup $0.006; wedge $0.20 each; mystery $0 (price TBC)
const INGS: Ingredient[] = [
  ing("tequila", "Tequila Blanco", { pack_size: 0.7, pack_price: 70 }),
  ing("lime", "Lime Juice (L)", { pack_price: 12 }),
  ing("syrup", "Sugar Syrup", { pack_price: 6 }),
  ing("wedge", "Lime Wedge", { pack_unit: "each", pack_size: 100, pack_price: 20 }),
  ing("mystery", "Mystery Bitters", { pack_price: 0 }),
  ing("flour", "Flour", { pack_unit: "kg", pack_size: 10, pack_price: 20 }),
];

const item = (over: Partial<MenuItem> = {}): MenuItem => ({
  id: "m1",
  name: "Margarita",
  venue_id: 1,
  category: "Cocktail",
  section: null,
  portions: 1,
  sell_price_inc: 22,
  target_override: null,
  hh_price_inc: null,
  active: true,
  source: null,
  notes: null,
  ...over,
});

const line = (id: string, comp: string, qty: number, unit: RecipeLine["unit"], sort = 1): RecipeLine => ({
  id,
  parent_type: "item",
  parent_id: "m1",
  component_type: "ingredient",
  component_id: comp,
  qty,
  unit,
  note: null,
  sort,
});

// 45 ml tequila $4.50 + 30 ml lime $0.36 = $4.86 per drink; ex-GST sell $20.00 -> GP 75.7%
const LINES = [line("l1", "tequila", 45, "ml", 1), line("l2", "lime", 30, "ml", 2)];
const index = buildIndex(INGS, [], LINES);
const base = { item: item(), lines: LINES, index, settings: DEFAULT_SETTINGS, targets: [] };

describe("researchNoteEffect", () => {
  it("prices an added ingredient with no existing line (a new line)", () => {
    const e = researchNoteEffect({ ...base, changes: [{ ingredient_id: "wedge", qty: 2, unit: "each" }] });
    expect(e.status).toBe("ok");
    expect(e.baselineCost).toBeCloseTo(4.86, 6);
    expect(e.newCost).toBeCloseTo(5.26, 6);
    expect(e.deltaCost).toBeCloseTo(0.4, 6);
    expect(e.baselineGp).toBeCloseTo(1 - 4.86 / 20, 6);
    expect(e.newGp).toBeCloseTo(1 - 5.26 / 20, 6);
    expect(e.deltaGpPoints).toBeCloseTo(-2, 6);
    expect(e.price).toBe(22);
    expect(e.text).toBe("Adds about $0.40 per drink. GP goes from 76% to 74% at $22.");
  });

  it("adds to the existing line and converts units (1 L of lime is 1000 ml)", () => {
    const e = researchNoteEffect({ ...base, changes: [{ ingredient_id: "lime", qty: 0.015, unit: "L" }] });
    expect(e.status).toBe("ok");
    expect(e.deltaCost).toBeCloseTo(15 * 0.012, 6);
    expect(e.changedLines).toEqual([{ ingredientId: "lime", name: "Lime Juice (L)", unit: "ml", from: 30, to: 45 }]);
  });

  it("a negative delta reduces the line and reads as a saving", () => {
    const e = researchNoteEffect({ ...base, changes: [{ ingredient_id: "tequila", qty: -15, unit: "ml" }] });
    expect(e.status).toBe("ok");
    expect(e.deltaCost).toBeCloseTo(-1.5, 6);
    expect(e.text).toBe("Saves about $1.50 per drink. GP goes from 76% to 83% at $22.");
    expect(effectTone(e)).toBe("good");
  });

  it("never takes a line below zero", () => {
    const e = researchNoteEffect({ ...base, changes: [{ ingredient_id: "lime", qty: -500, unit: "ml" }] });
    expect(e.status).toBe("ok");
    expect(e.newCost).toBeCloseTo(4.5, 6); // lime gone, tequila untouched
    expect(e.changedLines?.[0]).toMatchObject({ from: 30, to: 0 });
  });

  it("a negative delta on an ingredient the recipe does not use changes nothing", () => {
    const e = researchNoteEffect({ ...base, changes: [{ ingredient_id: "syrup", qty: -10, unit: "ml" }] });
    expect(e.status).toBe("no_changes");
    expect(e.text).toBe("No cost effect worked out");
  });

  it("adds up several changes at once", () => {
    const e = researchNoteEffect({
      ...base,
      changes: [
        { ingredient_id: "syrup", qty: 10, unit: "ml" }, // +0.06
        { ingredient_id: "wedge", qty: 1, unit: "each" }, // +0.20
        { ingredient_id: "tequila", qty: -5, unit: "ml" }, // -0.50
      ],
    });
    expect(e.deltaCost).toBeCloseTo(-0.24, 6);
    expect(e.changedLines).toHaveLength(3);
    expect(e.text.startsWith("Saves about $0.24 per drink.")).toBe(true);
  });

  it("empty changes: no cost effect worked out", () => {
    for (const changes of [[], null, undefined, "x", [{ ingredient_id: "wedge", qty: 0, unit: "each" }], [{ ingredient_id: "wedge", qty: 1, unit: "cups" }]]) {
      const e = researchNoteEffect({ ...base, changes });
      expect(e).toEqual({ status: "no_changes", text: "No cost effect worked out" });
    }
  });

  it("no sell price: says so, still gives the cost change", () => {
    for (const sell of [null, 0]) {
      const e = researchNoteEffect({ ...base, item: item({ sell_price_inc: sell }), changes: [{ ingredient_id: "wedge", qty: 2, unit: "each" }] });
      expect(e.status).toBe("no_price");
      expect(e.text).toBe("Add a sell price to see GP");
      expect(e.deltaCost).toBeCloseTo(0.4, 6);
    }
  });

  it("an ingredient priced at $0 is Price TBC, never a fake $0 effect", () => {
    const e = researchNoteEffect({ ...base, changes: [{ ingredient_id: "mystery", qty: 2, unit: "ml" }, { ingredient_id: "wedge", qty: 1, unit: "each" }] });
    expect(e.status).toBe("price_tbc");
    expect(e.text).toBe("Price TBC for Mystery Bitters");
    expect(e.deltaCost).toBeUndefined();
  });

  it("flags a unit that does not match how the ingredient is bought, and a vanished ingredient", () => {
    expect(researchNoteEffect({ ...base, changes: [{ ingredient_id: "lime", qty: 10, unit: "g" }] })).toMatchObject({ status: "problem", text: "The unit in this note does not match how Lime Juice (L) is bought" });
    expect(researchNoteEffect({ ...base, changes: [{ ingredient_id: "gone", qty: 10, unit: "ml" }] })).toMatchObject({ status: "problem" });
  });

  it("a prep note (no item) is text only, and a note on a missing recipe too", () => {
    expect(researchNoteEffect({ ...base, item: null, changes: [{ ingredient_id: "wedge", qty: 2, unit: "each" }] })).toEqual({ status: "text_only", text: "" });
  });

  it("uses the recipe's portions and words the unit by category", () => {
    const four = researchNoteEffect({ ...base, item: item({ portions: 4 }), changes: [{ ingredient_id: "wedge", qty: 4, unit: "each" }] });
    expect(four.deltaCost).toBeCloseTo(0.2, 6); // $0.80 over 4 portions
    expect(portionWord("Food")).toBe("dish");
    expect(portionWord("Gelato")).toBe("serve");
    expect(portionWord("Mocktail")).toBe("drink");
    const food = researchNoteEffect({ ...base, item: item({ category: "Food" }), changes: [{ ingredient_id: "wedge", qty: 2, unit: "each" }] });
    expect(food.text).toContain("per dish");
  });

  it("shows one more decimal when whole percentages would read the same", () => {
    // 1 ml of syrup: +$0.006, GP 75.7% -> 75.67%
    const e = researchNoteEffect({ ...base, changes: [{ ingredient_id: "syrup", qty: 10, unit: "ml" }] });
    expect(e.text).toBe("Adds about $0.06 per drink. GP goes from 76% to 75% at $22.");
    const tiny = researchNoteEffect({ ...base, changes: [{ ingredient_id: "syrup", qty: 0.5, unit: "ml" }] });
    expect(tiny.text).toBe("Barely changes the cost per drink. GP stays at 76% at $22.");
    const small = researchNoteEffect({ ...base, changes: [{ ingredient_id: "syrup", qty: 1, unit: "ml" }] });
    expect(small.text).toBe("Adds about $0.01 per drink. GP stays at 75.7% at $22.");
  });

  it("formats a price with cents", () => {
    const e = researchNoteEffect({ ...base, item: item({ sell_price_inc: 21.5 }), changes: [{ ingredient_id: "wedge", qty: 2, unit: "each" }] });
    expect(e.text.endsWith("at $21.50.")).toBe(true);
  });

  it("uses GST the way the app does: sell price inc GST, costs ex GST", () => {
    // same ingredient priced inc GST: $11 per wedge-pack of 100 -> $0.10 ex
    const inc = buildIndex([...INGS.filter((i) => i.id !== "wedge"), ing("wedge", "Lime Wedge", { pack_unit: "each", pack_size: 100, pack_price: 22, price_inc_gst: true })], [], LINES);
    const e = researchNoteEffect({ ...base, index: inc, changes: [{ ingredient_id: "wedge", qty: 2, unit: "each" }] });
    expect(e.deltaCost).toBeCloseTo(0.4, 6);
  });
});

describe("applyChanges", () => {
  it("does not mutate the recipe it was given", () => {
    const copy = JSON.stringify(LINES);
    applyChanges(LINES, [{ ingredient_id: "lime", qty: 10, unit: "ml" }], { type: "item", id: "m1" });
    expect(JSON.stringify(LINES)).toBe(copy);
  });
  it("a negative delta spreads across repeated lines of the same ingredient", () => {
    const two = [line("a", "lime", 20, "ml", 1), line("b", "lime", 20, "ml", 2)];
    const r = applyChanges(two, [{ ingredient_id: "lime", qty: -30, unit: "ml" }], { type: "item", id: "m1" });
    expect(r.lines.map((l) => l.qty)).toEqual([0, 10]);
  });
});

describe("cleanChanges", () => {
  it("keeps only well-formed, non-zero changes", () => {
    expect(cleanChanges([{ ingredient_id: "a", qty: "3", unit: "g" }, { ingredient_id: "", qty: 1, unit: "g" }, { qty: 1, unit: "g" }, { ingredient_id: "a", qty: 0, unit: "g" }, { ingredient_id: "a", qty: 1, unit: "oz" }, null])).toEqual([{ ingredient_id: "a", qty: 3, unit: "g" }]);
  });
});

const note = (id: string, over: Partial<ResearchNote> = {}): ResearchNote => ({
  id,
  item_id: "m1",
  prep_id: null,
  kind: "suggestion",
  title: id,
  body: "",
  changes: [],
  sources: [],
  status: "open",
  created_at: "2026-10-04T00:00:00Z",
  updated_at: "2026-10-04T00:00:00Z",
  ...over,
});

describe("note lists", () => {
  it("sorts open first, then approved, then dismissed, oldest first", () => {
    const n = [note("d", { status: "dismissed" }), note("b", { created_at: "2026-10-05T00:00:00Z" }), note("a"), note("c", { status: "approved" })];
    expect(sortNotes(n).map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("finds a record's notes (an item's, or a prep's)", () => {
    const n = [note("a"), note("b", { item_id: null, prep_id: "p1" }), note("c", { item_id: "m2" })];
    expect(notesForRecord(n, "item", "m1").map((x) => x.id)).toEqual(["a"]);
    expect(notesForRecord(n, "prep", "p1").map((x) => x.id)).toEqual(["b"]);
  });
  it("counts by status", () => {
    expect(countByStatus([note("a"), note("b", { status: "dismissed" }), note("c")])).toEqual({ open: 2, approved: 0, dismissed: 1, all: 3 });
  });
  it("groups by venue (in venue order), then by recipe name", () => {
    const recs: Record<string, { name: string; venueId: number | null; href: string }> = {
      m1: { name: "Margarita", venueId: 2, href: "/items/m1" },
      m2: { name: "Daiquiri", venueId: 1, href: "/items/m2" },
      m3: { name: "Alpha", venueId: 2, href: "/items/m3" },
    };
    const n = [note("a"), note("b", { item_id: "m2" }), note("c", { item_id: "m3" }), note("d", { item_id: "m1" }), note("e", { item_id: "zz" })];
    const g = groupNotes(n, (x) => recs[x.item_id ?? ""] ?? null, [1, 2]);
    expect(g.map((v) => v.venueId)).toEqual([1, 2, null]);
    expect(g[1].drinks.map((d) => d.name)).toEqual(["Alpha", "Margarita"]);
    expect(g[1].drinks[1].notes.map((x) => x.id)).toEqual(["a", "d"]);
    expect(g[2].drinks[0]).toMatchObject({ name: "(Recipe not found)", href: null });
    expect(g.map((v) => v.count)).toEqual([1, 3, 1]);
  });
});

describe("safeUrl", () => {
  it("allows only http and https links", () => {
    expect(safeUrl("https://iba-world.com/x")).toBe("https://iba-world.com/x");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });
});
