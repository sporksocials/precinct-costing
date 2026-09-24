import { describe, expect, it } from "vitest";
import { buildIndex, costItem } from "@/lib/costing";
import { beerItemId, buildBeer, parseBeerItemId } from "@/lib/beer";
import { isVirtualItemId, parseVirtualItemId } from "@/lib/gelato";
import { DEFAULT_SETTINGS, type Beer, type BeerPrice, type BeerServe, type Ingredient } from "@/lib/types";

const keg = { id: "keg", name: "XXXX Gold keg", category: null, supplier_id: null, supplier_code: null, pack_size: 50, pack_unit: "L", pack_price: 300, price_inc_gst: false, gst_free: false, rebate: 0, yield_pct: 0.99, venues: null, active: true, last_price_update: null, previous_price: null, source: null, notes: null, updated_at: null } as Ingredient;
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
