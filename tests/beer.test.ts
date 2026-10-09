import { describe, expect, it } from "vitest";
import { buildIndex, costItem } from "@/lib/costing";
import { beerItemId, buildBeer, parseBeerItemId, serveOffered, serveSoldAt, servesAt } from "@/lib/beer";
import { isVirtualItemId, parseVirtualItemId } from "@/lib/gelato";
import { DEFAULT_SETTINGS, type Beer, type BeerPrice, type BeerServe, type Ingredient } from "@/lib/types";

const keg = { id: "keg", name: "XXXX Gold keg", category: "Food", supplier_id: null, supplier_code: null, pack_size: 50, pack_unit: "L", pack_price: 300, price_inc_gst: false, gst_free: false, rebate: 0, yield_pct: 0.99, venues: "All", active: true, last_price_update: null, previous_price: null, source: null, notes: null, updated_at: null } as Ingredient;
const serves: BeerServe[] = [
  { id: "pot", name: "Pot", sort: 1, ml: 285, active: true },
  { id: "sch", name: "Schooner", sort: 2, ml: 425, active: true },
  { id: "old", name: "Middy", sort: 3, ml: 200, active: false },
];
const beers: Beer[] = [{ id: "b1", venue_id: 1, name: "XXXX Gold", ingredient_id: "keg", target_gp: 0.73, active: true, sort: 0, notes: null }];
const prices: BeerPrice[] = [
  { id: "p1", beer_id: "b1", serve_id: "pot", sell_price_inc: 5.2, hh_price_inc: null, legacy_item_id: "old-pot" },
  { id: "p2", beer_id: "b1", serve_id: "sch", sell_price_inc: 8.1, hh_price_inc: 7.5, legacy_item_id: "old-sch" },
];

describe("tap beer", () => {
  const m = buildBeer({ beers, serves, prices });
  it("makes one item per beer x active serve with the beer's prices and target", () => {
    expect(m.items.map((i) => i.name)).toEqual(["XXXX Gold - Pot", "XXXX Gold - Schooner"]);
    expect(m.items[1]).toMatchObject({ sell_price_inc: 8.1, hh_price_inc: 7.5, target_override: 0.73, category: "Tap Beer" });
    expect([...m.replacedItemIds].sort()).toEqual(["old-pot", "old-sch"]);
  });
  it("costs a serve from the keg per ml, wastage via the keg's yield", () => {
    const index = buildIndex([keg], [], m.lines);
    const c = costItem(m.items[0], index, DEFAULT_SETTINGS, []);
    // $300 / 50 L / 0.99 yield = $6.0606/L; 285 ml = $1.727
    expect(c.costPerPortion).toBeCloseTo(1.7273, 3);
  });
  it("ids round-trip and count as virtual, not gelato", () => {
    const id = beerItemId("b1", "pot");
    expect(parseBeerItemId(id)).toEqual({ beerId: "b1", serveId: "pot" });
    expect(isVirtualItemId(id)).toBe(true);
    expect(parseVirtualItemId(id)).toBeNull();
  });
});

describe("serves a venue does not pour", () => {
  const four: BeerServe[] = [
    { id: "pot", name: "Pot", sort: 1, ml: 285, active: true, not_sold_at: [2, 3] },
    { id: "sch", name: "Schooner", sort: 2, ml: 425, active: true },
    { id: "pint", name: "Pint", sort: 3, ml: 570, active: true, not_sold_at: [2, 3] },
    { id: "jug", name: "Jug", sort: 4, ml: 1140, active: true, not_sold_at: [] },
  ];
  it("sells a serve everywhere unless the venue is listed", () => {
    expect(serveSoldAt(four[0], 1)).toBe(true);
    expect(serveSoldAt(four[0], 2)).toBe(false);
    expect(serveSoldAt(four[0], 3)).toBe(false);
    expect(serveSoldAt(four[1], 2)).toBe(true);
    expect(serveSoldAt({ id: "x", name: "X", sort: 1, ml: 1, active: true }, 2)).toBe(true);
    expect(serveSoldAt(four[0], null)).toBe(true);
    expect(servesAt(four, 3).map((s) => s.name)).toEqual(["Schooner", "Jug"]);
    expect(servesAt(four, 1).map((s) => s.name)).toEqual(["Pot", "Schooner", "Pint", "Jug"]);
  });
  it("makes Chiobu and Greedy beers only in the serves they pour, and Drift beers in all", () => {
    const venueBeers: Beer[] = [
      { id: "d", venue_id: 1, name: "Drift Lager", ingredient_id: "keg", target_gp: null, active: true, sort: 0, notes: null },
      { id: "c", venue_id: 2, name: "Chiobu", ingredient_id: "keg", target_gp: null, active: true, sort: 0, notes: null },
      { id: "g", venue_id: 3, name: "Greedy Lager", ingredient_id: "keg", target_gp: null, active: true, sort: 0, notes: null },
    ];
    const m = buildBeer({ beers: venueBeers, serves: four, prices: [] });
    expect(m.items.filter((i) => i.venue_id === 1).map((i) => i.name)).toEqual(["Drift Lager - Pot", "Drift Lager - Schooner", "Drift Lager - Pint", "Drift Lager - Jug"]);
    expect(m.items.filter((i) => i.venue_id === 2).map((i) => i.name)).toEqual(["Chiobu - Schooner", "Chiobu - Jug"]);
    expect(m.items.filter((i) => i.venue_id === 3).map((i) => i.name)).toEqual(["Greedy Lager - Schooner", "Greedy Lager - Jug"]);
  });
});

describe("a beer that pours only some serves (Tiger at Chiobu)", () => {
  const all: BeerServe[] = [
    { id: "pot", name: "Pot", sort: 1, ml: 285, active: true, not_sold_at: [1, 2, 3] },
    { id: "sch", name: "Schooner", sort: 2, ml: 425, active: true },
    { id: "g500", name: "500ml Glass", sort: 3, ml: 500, active: true, not_sold_at: [1, 2, 3] },
    { id: "jug", name: "Jug", sort: 5, ml: 1140, active: true },
  ];
  const tiger: Beer = { id: "t", venue_id: 2, name: "Tiger", ingredient_id: "keg", target_gp: null, active: true, sort: 0, notes: null, only_serves: ["jug", "g500"] };
  const usual: Beer = { id: "u", venue_id: 2, name: "Rice Lager", ingredient_id: "keg", target_gp: null, active: true, sort: 0, notes: null };
  it("pours exactly the serves it lists, even ones no venue usually sells", () => {
    expect(all.filter((s) => serveOffered(s, tiger)).map((s) => s.name)).toEqual(["500ml Glass", "Jug"]);
  });
  it("falls back to the venue's usual serves with no list or an empty one", () => {
    expect(all.filter((s) => serveOffered(s, usual)).map((s) => s.name)).toEqual(["Schooner", "Jug"]);
    expect(all.filter((s) => serveOffered(s, { ...usual, only_serves: [] })).map((s) => s.name)).toEqual(["Schooner", "Jug"]);
  });
  it("builds items only for the serves each beer pours", () => {
    const m = buildBeer({ beers: [tiger, usual], serves: all, prices: [] });
    expect(m.items.filter((i) => i.name.startsWith("Tiger")).map((i) => i.name)).toEqual(["Tiger - 500ml Glass", "Tiger - Jug"]);
    expect(m.items.filter((i) => i.name.startsWith("Rice")).map((i) => i.name)).toEqual(["Rice Lager - Schooner", "Rice Lager - Jug"]);
  });
});
