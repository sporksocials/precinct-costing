import { describe, expect, it } from "vitest";
import { buildIndex, costItem } from "@/lib/costing";
import { batchWeightKg, buildGelato, costServe, flavourName, isGelatoFlavour, parseVirtualItemId, virtualItemId } from "@/lib/gelato";
import { DEFAULT_SETTINGS, type GelatoServe, type GelatoServeLine, type Ingredient, type MenuItem, type Prep, type RecipeLine, type Venue } from "@/lib/types";

const venues: Venue[] = [
  { id: 1, slug: "drift", name: "Drift Bar" } as Venue,
  { id: 4, slug: "gelato", name: "Gelato Rumba" } as Venue,
];
const ing = (id: string, name: string, pack_size: number, pack_unit: Ingredient["pack_unit"], pack_price: number): Ingredient => ({
  id, name, category: null, supplier_id: null, supplier_code: null, pack_size, pack_unit, pack_price, price_inc_gst: false, gst_free: false, rebate: 0, yield_pct: 1,
  venues: null, active: true, last_price_update: null, previous_price: null, source: null, notes: null, updated_at: null,
} as Ingredient);
const ingredients = [ing("base", "Base", 1, "kg", 5), ing("cup", "Cup", 1, "each", 0.1), ing("spoon", "Spoon", 1, "each", 0.02)];
const prep = (id: string, name: string, over: Partial<Prep> = {}): Prep => ({ id, name, venue_id: 4, prep_type: "Gelato flavour mix", yield_qty: 1, yield_unit: "kg", active: true, source: null, notes: null, ...over });
const preps = [prep("p1", "Banana gelato mix"), prep("p2", "Choc Gelato Mix", { prep_type: "Gelato Mix" }), prep("p3", "Sauce", { prep_type: "Sauce" }), prep("p4", "Drift mix", { venue_id: 1 })];
const line = (id: string, parent_id: string, component_id: string, qty: number, unit: RecipeLine["unit"], parent_type: RecipeLine["parent_type"] = "prep"): RecipeLine =>
  ({ id, parent_type, parent_id, component_type: "ingredient", component_id, qty, unit, note: null, sort: 1 });
const lines = [line("l1", "p1", "base", 1000, "g"), line("l2", "p2", "base", 1, "kg")];
const serve = (id: string, name: string, grams: number, price: number, sort: number, active = true): GelatoServe => ({ id, venue_id: 4, name, sort, grams, sell_price_inc: price, on_menu: true, active, notes: null });
const serves = [serve("s1", "1 scoop cup", 100, 5.5, 1), serve("s2", "2 scoop cup", 200, 8.8, 2), serve("s3", "Retired", 50, 3, 3, false)];
const serveLines: GelatoServeLine[] = [
  { id: "sl1", serve_id: "s1", ingredient_id: "cup", qty: 1, unit: "each", sort: 1 },
  { id: "sl2", serve_id: "s1", ingredient_id: "spoon", qty: 1, unit: "each", sort: 2 },
  { id: "sl3", serve_id: "s2", ingredient_id: "cup", qty: 1, unit: "each", sort: 1 },
];
const oldItems: MenuItem[] = [
  { id: "old1", name: "Banana - 1 scoop cup", venue_id: 4, category: "Gelato", section: "1 Scoop Cup", portions: 1, sell_price_inc: 5.5, target_override: null, hh_price_inc: null, active: true, source: null, notes: null },
  { id: "acai", name: "Acai bowl", venue_id: 4, category: "Gelato", section: "Acai", portions: 1, sell_price_inc: 12, target_override: null, hh_price_inc: null, active: true, source: null, notes: null },
];

describe("gelato helpers", () => {
  it("recognises flavour mixes only in the gelato venue", () => {
    expect(isGelatoFlavour(preps[0], 4)).toBe(true);
    expect(isGelatoFlavour(preps[1], 4)).toBe(true);
    expect(isGelatoFlavour(preps[2], 4)).toBe(false);
    expect(isGelatoFlavour(preps[3], 4)).toBe(false);
  });
  it("names and ids round-trip", () => {
    expect(flavourName(preps[0])).toBe("Banana");
    expect(flavourName(preps[1])).toBe("Choc");
    expect(parseVirtualItemId(virtualItemId("p1", "s2"))).toEqual({ prepId: "p1", serveId: "s2" });
    expect(parseVirtualItemId("abc")).toBeNull();
  });
  it("batch weight counts weight lines only", () => {
    expect(batchWeightKg([{ qty: 900, unit: "g" }, { qty: 0.1, unit: "kg" }, { qty: 2, unit: "each" }, { qty: 50, unit: "ml" }])).toBeCloseTo(1);
  });
});

describe("buildGelato", () => {
  const g = buildGelato({ venues, preps, items: oldItems, serves, serveLines, wastage: 0.05 });

  it("makes one virtual item per flavour × active serve", () => {
    expect(g.flavours.map((f) => f.id)).toEqual(["p1", "p2"]);
    expect(g.serves.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(g.items).toHaveLength(4);
    expect(g.items[0]).toMatchObject({ id: "gelato~p1~s1", name: "Banana - 1 scoop cup", sell_price_inc: 5.5, category: "Gelato" });
  });
  it("hides old stored serve recipes but keeps other gelato items", () => {
    expect([...g.replacedItemIds]).toEqual(["old1"]);
  });
  it("costs a serve as mix grams plus wastage plus packaging", () => {
    const index = buildIndex(ingredients, preps, [...lines, ...g.lines]);
    const c = costItem(g.items[0], index, DEFAULT_SETTINGS, []);
    // 105g of a $5/kg mix = 0.525, plus cup 0.10 and spoon 0.02
    expect(c.costPerPortion).toBeCloseTo(0.645);
    const live = costServe(serves[0], serveLines, 5, 0.05, index, DEFAULT_SETTINGS, 0.72);
    expect(live.cost).toBeCloseTo(0.645);
    expect(live.gpPct).toBeCloseTo(c.gpPct!);
  });
  it("returns nothing without a gelato venue or serves", () => {
    expect(buildGelato({ venues: venues.slice(0, 1), preps, items: [], serves, serveLines, wastage: 0 }).items).toHaveLength(0);
    expect(buildGelato({ venues, preps, items: oldItems, serves: [], serveLines, wastage: 0 }).replacedItemIds.size).toBe(0);
  });
});
