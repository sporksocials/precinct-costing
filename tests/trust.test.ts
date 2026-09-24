import { describe, expect, it } from "vitest";
import { buildIndex, chargePoints, costBreakdown, costItem, priceLadder, roundToEnding, suggestedPrice } from "@/lib/costing";
import { buildBeer } from "@/lib/beer";
import { buildGelato, resolveGelatoTarget } from "@/lib/gelato";
import { checkCostRows, gpSummary, happyHourRows } from "@/lib/insights";
import { DEFAULT_SETTINGS, type Beer, type BeerPrice, type BeerServe, type GelatoServe, type Ingredient, type MenuItem, type RecipeLine, type Target, type Venue } from "@/lib/types";

const ing = (id: string, over: Partial<Ingredient> = {}): Ingredient =>
  ({ id, name: id, category: null, supplier_id: null, supplier_code: null, pack_size: 1, pack_unit: "kg", pack_price: 10, price_inc_gst: false, gst_free: false, rebate: 0, yield_pct: 1, venues: null, active: true, last_price_update: null, previous_price: null, source: null, notes: null, updated_at: null, ...over }) as Ingredient;
const item = (id: string, over: Partial<MenuItem> = {}): MenuItem =>
  ({ id, name: id, venue_id: 1, category: "Food", section: null, portions: 1, sell_price_inc: 22, target_override: null, hh_price_inc: null, active: true, source: null, notes: null, ...over }) as MenuItem;
const line = (parent: string, comp: string, qty: number, unit: RecipeLine["unit"] = "kg"): RecipeLine =>
  ({ id: `${parent}-${comp}`, parent_type: "item", parent_id: parent, component_type: "ingredient", component_id: comp, qty, unit, note: null, sort: 1 });
const cost = (it: MenuItem, ings: Ingredient[], lines: RecipeLine[], targets: Target[] = []) => costItem(it, buildIndex(ings, [], lines), DEFAULT_SETTINGS, targets);

describe("cost warnings", () => {
  it("healthy item has none", () => {
    // $3 ex cost, $22 inc = $20 ex -> 85% GP
    const c = cost(item("a"), [ing("x", { pack_price: 3 })], [line("a", "x", 1)]);
    expect(c.costWarnings).toEqual([]);
    expect(c.needsCheck).toBe(false);
  });
  it("flags zero price, zero pack size, zero yield", () => {
    for (const over of [{ pack_price: 0 }, { pack_size: 0 }, { yield_pct: 0 }]) {
      const c = cost(item("a"), [ing("x", over)], [line("a", "x", 1)]);
      expect(c.needsCheck).toBe(true);
      expect(c.costWarnings.some((w) => w.startsWith("Zero cost line"))).toBe(true);
    }
  });
  it("flags no lines and portions <= 0", () => {
    expect(cost(item("a"), [], []).costWarnings[0]).toMatch(/No recipe lines/);
    const c = cost(item("a", { portions: 0 }), [ing("x", { pack_price: 3 })], [line("a", "x", 1)]);
    expect(c.costWarnings.some((w) => /Portions/.test(w))).toBe(true);
    expect(c.costPerPortion).toBeCloseTo(3);
  });
  it("flags a suspicious GP above 92%", () => {
    const c = cost(item("a"), [ing("x", { pack_price: 0.5 })], [line("a", "x", 1)]);
    expect(c.gpPct!).toBeGreaterThan(0.92);
    expect(c.costWarnings.some((w) => /check the recipe cost/.test(w))).toBe(true);
  });
  it("flags a beer serve with no keg", () => {
    const serves: BeerServe[] = [{ id: "pot", name: "Pot", sort: 1, ml: 285, active: true }];
    const beers: Beer[] = [{ id: "b", venue_id: 1, name: "B", ingredient_id: null, target_gp: null, active: true, sort: 0, notes: null }];
    const m = buildBeer({ beers, serves, prices: [] });
    const c = costItem(m.items[0], buildIndex([], [], m.lines), DEFAULT_SETTINGS, []);
    expect(c.costWarnings).toEqual(["No keg linked to this beer"]);
  });
  it("gpSummary excludes flagged items and counts them; feed lists them", () => {
    const good = cost(item("good"), [ing("x", { pack_price: 6 })], [line("good", "x", 1)]); // 70% GP
    const bad = cost(item("bad"), [], []); // no lines: cost 0, GP 100%
    const map = new Map([["good", good], ["bad", bad]]);
    const s = gpSummary(map.values());
    expect(s.count).toBe(1);
    expect(s.excluded).toBe(1);
    expect(s.avg!).toBeCloseTo(0.7);
    const rows = checkCostRows(map.values());
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("check_cost");
    expect(rows[0].cost.item.id).toBe("bad");
  });
});

describe("happy hour", () => {
  it("computes GP against the same target and below-cost", () => {
    const ings = [ing("x", { pack_price: 6 })];
    const lines = [line("a", "x", 1)];
    const ok = cost(item("a", { hh_price_inc: 22 }), ings, lines);
    expect(ok.hhGpPct!).toBeCloseTo(0.7);
    expect(ok.hhUnderTarget).toBe(false);
    const low = cost(item("a", { hh_price_inc: 12 }), ings, lines); // ex 10.91, GP 45%
    expect(low.hhUnderTarget).toBe(true);
    expect(low.hhBelowCost).toBe(false);
    const loss = cost(item("a", { hh_price_inc: 5 }), ings, lines); // ex 4.55 < 6
    expect(loss.hhBelowCost).toBe(true);
    expect(cost(item("a"), ings, lines).hhGpPct).toBeNull();
    const rows = happyHourRows([ok, low, loss].map((c, i) => ({ ...c, item: { ...c.item, id: String(i) } })));
    expect(rows.map((r) => r.belowCost)).toEqual([true, false]);
  });
  it("beer serves use cost_beer_prices hh", () => {
    const serves: BeerServe[] = [{ id: "pot", name: "Pot", sort: 1, ml: 1000, active: true }];
    const beers: Beer[] = [{ id: "b", venue_id: 1, name: "B", ingredient_id: "keg", target_gp: null, active: true, sort: 0, notes: null }];
    const prices: BeerPrice[] = [{ id: "p", beer_id: "b", serve_id: "pot", sell_price_inc: 22, hh_price_inc: 9 }];
    const m = buildBeer({ beers, serves, prices });
    const c = costItem(m.items[0], buildIndex([ing("keg", { pack_unit: "L", pack_price: 6 })], [], m.lines), DEFAULT_SETTINGS, []);
    expect(c.hhUnderTarget).toBe(true);
    expect(c.hhBelowCost).toBe(false);
  });
});

describe("rebate basis", () => {
  it("converts rebate with the price basis", () => {
    const inc = cost(item("a"), [ing("x", { pack_price: 22, price_inc_gst: true, rebate: 2.2 })], [line("a", "x", 1)]);
    expect(inc.recipeCost).toBeCloseTo(18); // (22 - 2.2) / 1.1
  });
});

describe("gelato target", () => {
  const venue = { id: 4, slug: "gelato", name: "Gelato" } as Venue;
  const targets: Target[] = [{ venue_id: 4, category: "Gelato", target_gp: 0.65 } as Target];
  it("serve target wins, else venue category target", () => {
    expect(resolveGelatoTarget({ target_gp: 0.5 }, 4, targets)).toBe(0.5);
    expect(resolveGelatoTarget({ target_gp: null }, 4, targets)).toBe(0.65);
    expect(resolveGelatoTarget(null, 4, [])).toBe(0.7);
  });
  it("buildGelato pins the resolved target when targets are given", () => {
    const serve = { id: "s", venue_id: 4, name: "Cup", sort: 1, grams: 100, sell_price_inc: 5, on_menu: true, active: true, notes: null, target_gp: null } as GelatoServe;
    const prep = { id: "p", name: "Banana gelato mix", venue_id: 4, prep_type: "Gelato flavour mix", yield_qty: 1, yield_unit: "kg", active: true, source: null, notes: null };
    const m = buildGelato({ venues: [venue], preps: [prep as never], items: [], serves: [serve], serveLines: [], wastage: 0, targets });
    expect(m.items[0].target_override).toBe(0.65);
  });
});

describe("suggested price options and ladder", () => {
  it("keeps the old signature and supports step / nearest", () => {
    expect(suggestedPrice(3, 0.7, 0.1, 0.5)).toBe(11);
    expect(suggestedPrice(3.1, 0.7, 0.1, 0.5)).toBe(11.5);
    expect(suggestedPrice(3.1, 0.7, 0.1, 0.5, { mode: "nearest" })).toBe(11.5);
    expect(suggestedPrice(3.05, 0.7, 0.1, 0.5, { mode: "nearest" })).toBe(11); // raw 11.18
  });
  it("steps 0.2 / 0.5 / 1", () => {
    // raw = 3.1 / 0.3 * 1.1 = 11.3667
    expect(suggestedPrice(3.1, 0.7, 0.1, 0.5, { step: 0.2 })).toBe(11.4);
    expect(suggestedPrice(3.1, 0.7, 0.1, 0.5, { step: 1 })).toBe(12);
    expect(suggestedPrice(3.1, 0.7, 0.1, 0.5, { step: 1, mode: "nearest" })).toBe(11);
    expect(suggestedPrice(3.1, 0.7, 0.1, 0.5, { step: 0.5, mode: "nearest" })).toBe(11.5);
  });
  it("edge cases", () => {
    expect(suggestedPrice(0, 0.7, 0.1, 0.5)).toBe(0);
    expect(suggestedPrice(3, 1, 0.1, 0.5)).toBe(0);
    expect(suggestedPrice(3, 1.2, 0.1, 0.5)).toBe(0);
    expect(priceLadder(0, 0.7, 0.1, 0.5)).toEqual([]);
    expect(priceLadder(3, 1, 0.1, 0.5)).toEqual([]);
  });
  it("ladder has 2 below, suggested, 3 above with GP", () => {
    const l = priceLadder(3, 0.7, 0.1, 0.5);
    expect(l.map((p) => p.price)).toEqual([10, 10.5, 11, 11.5, 12, 12.5]);
    expect(l[2].isSuggested).toBe(true);
    expect(l[2].gpPct).toBeCloseTo(0.7);
    expect(l[2].gpDollars).toBeCloseTo(7);
    expect(l.map((p) => p.meetsTarget)).toEqual([false, false, true, true, true, true]);
    for (const step of [0.2, 0.5, 1]) {
      const s = priceLadder(3.1, 0.7, 0.1, step);
      expect(s).toHaveLength(6);
      expect(s.filter((p) => p.isSuggested)).toHaveLength(1);
    }
  });
  it("charm price endings", () => {
    expect(chargePoints(11.37)).toEqual({ whole: 12, half: 11.5, ninety: 11.9 });
    expect(chargePoints(12)).toEqual({ whole: 12, half: 12.5, ninety: 12.9 });
    expect(chargePoints(12.95)).toEqual({ whole: 13, half: 13.5, ninety: 13.9 });
    expect(roundToEnding(0, 0.5)).toBe(0);
  });
});

describe("costBreakdown", () => {
  it("returns top drivers with share of cost", () => {
    const ings = [ing("beef", { pack_price: 30 }), ing("bun", { pack_price: 5 }), ing("sauce", { pack_price: 5 })];
    const c = cost(item("a", { portions: 2 }), ings, [line("a", "beef", 1), line("a", "bun", 1), line("a", "sauce", 1)]);
    const b = costBreakdown(c, 2);
    expect(b).toHaveLength(2);
    expect(b[0].name).toBe("beef");
    expect(b[0].cost).toBeCloseTo(15);
    expect(b[0].pct).toBeCloseTo(0.75);
  });
});
