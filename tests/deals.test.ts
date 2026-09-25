import { describe, expect, it } from "vitest";
import { buildIndex, costItem, ingredientCostPerBase } from "@/lib/costing";
import { brisbaneToday, dealStatus, dealSummary, effectivePackPrice, parseDealFromText, resolveDeals, withEffectivePrice } from "@/lib/deals";
import { dealFeedRows, ingredientChangeImpact } from "@/lib/insights";
import { DEFAULT_SETTINGS, type Ingredient, type IngredientDeal, type MenuItem, type RecipeLine } from "@/lib/types";

const TODAY = "2026-09-25";

const deal = (over: Partial<IngredientDeal>): IngredientDeal => ({
  id: "d1",
  ingredient_id: "keg",
  kind: "buy_x_get_y",
  buy_qty: null,
  free_qty: null,
  min_qty: null,
  pct_off: null,
  unit_price: null,
  special_pack_price: null,
  starts_on: null,
  ends_on: null,
  note: null,
  active: true,
  ...over,
});
const bxgy = (buy: number, free: number, over: Partial<IngredientDeal> = {}) => deal({ kind: "buy_x_get_y", buy_qty: buy, free_qty: free, ...over });

const ing = (over: Partial<Ingredient> = {}): Ingredient => ({
  id: "keg",
  name: "Keg",
  category: null,
  supplier_id: null,
  supplier_code: null,
  pack_size: 50,
  pack_unit: "L",
  pack_price: 400,
  price_inc_gst: false,
  gst_free: true,
  rebate: 0,
  yield_pct: 1,
  venues: null,
  active: true,
  last_price_update: null,
  previous_price: null,
  source: null,
  notes: null,
  updated_at: null,
  ...over,
});

describe("dealStatus (Brisbane dates)", () => {
  it("covers active, upcoming, ending soon, expired and off", () => {
    expect(dealStatus({ active: true, starts_on: null, ends_on: null }, TODAY)).toBe("active");
    expect(dealStatus({ active: true, starts_on: "2026-09-26", ends_on: null }, TODAY)).toBe("upcoming");
    expect(dealStatus({ active: true, starts_on: "2026-09-01", ends_on: "2026-10-09" }, TODAY)).toBe("ending_soon"); // 14 days
    expect(dealStatus({ active: true, starts_on: "2026-09-01", ends_on: "2026-10-10" }, TODAY)).toBe("active"); // 15 days
    expect(dealStatus({ active: true, starts_on: null, ends_on: "2026-09-25" }, TODAY)).toBe("ending_soon"); // ends today is still live
    expect(dealStatus({ active: true, starts_on: null, ends_on: "2026-09-24" }, TODAY)).toBe("expired");
    expect(dealStatus({ active: false, starts_on: null, ends_on: null }, TODAY)).toBe("off");
  });
  it("brisbaneToday uses Brisbane, not UTC", () => {
    expect(brisbaneToday(new Date("2026-09-24T15:00:00Z"))).toBe("2026-09-25"); // 1am Brisbane
    expect(brisbaneToday(new Date("2026-09-25T13:59:00Z"))).toBe("2026-09-25");
  });
});

describe("effectivePackPrice", () => {
  it("returns the base price with no deals", () => {
    expect(effectivePackPrice(400, [], TODAY)).toBe(400);
    expect(effectivePackPrice(400, undefined, TODAY)).toBe(400);
  });
  it("buy X get Y free: keg 8+1 and carton 10+1", () => {
    expect(effectivePackPrice(400, [bxgy(8, 1)], TODAY)).toBeCloseTo(355.56, 2);
    expect(effectivePackPrice(110, [bxgy(10, 1)], TODAY)).toBeCloseTo(100, 6);
  });
  it("volume: percentage off or a lower pack price", () => {
    expect(effectivePackPrice(100, [deal({ kind: "volume", min_qty: 5, pct_off: 0.05 })], TODAY)).toBeCloseTo(95, 6);
    expect(effectivePackPrice(100, [deal({ kind: "volume", min_qty: 5, unit_price: 92 })], TODAY)).toBe(92);
  });
  it("special price only between its dates", () => {
    const sp = deal({ kind: "special_price", special_pack_price: 80, starts_on: "2026-09-20", ends_on: "2026-09-30" });
    expect(effectivePackPrice(100, [sp], TODAY)).toBe(80);
    expect(effectivePackPrice(100, [sp], "2026-09-19")).toBe(100); // upcoming
    expect(effectivePackPrice(100, [sp], "2026-10-01")).toBe(100); // expired: reverts to base
  });
  it("standing percent off", () => {
    expect(effectivePackPrice(200, [deal({ kind: "percent_off", pct_off: 0.1 })], TODAY)).toBeCloseTo(180, 6);
  });
  it("ignores deals that are switched off", () => {
    expect(effectivePackPrice(200, [deal({ kind: "percent_off", pct_off: 0.1, active: false })], TODAY)).toBe(200);
  });
  it("does not stack: the lowest effective price wins", () => {
    const a = bxgy(10, 1, { id: "a" }); // 9.09% off
    const b = deal({ id: "b", kind: "volume", min_qty: 3, pct_off: 0.05 });
    const c = deal({ id: "c", kind: "special_price", special_pack_price: 88 });
    const r = resolveDeals(100, [a, b, c], TODAY);
    expect(r.price).toBe(88);
    expect(r.deal?.id).toBe("c");
    expect(r.savingPct).toBeCloseTo(0.12, 6);
    expect(resolveDeals(100, [a, b], TODAY).deal?.id).toBe("a");
  });
  it("standing percent off applies first, then the best other deal is worked out from it", () => {
    const standing = deal({ id: "s", kind: "percent_off", pct_off: 0.1 });
    const r = resolveDeals(100, [standing, bxgy(9, 1, { id: "x" })], TODAY); // 100 -> 90 -> 81
    expect(r.price).toBeCloseTo(81, 6);
    expect(r.deal?.id).toBe("x");
    expect(r.standing?.id).toBe("s");
    // a fixed special price is not reduced further and only wins when lower than the standing price
    expect(resolveDeals(100, [standing, deal({ id: "p", kind: "special_price", special_pack_price: 95 })], TODAY).price).toBeCloseTo(90, 6);
    expect(resolveDeals(100, [standing, deal({ id: "p", kind: "special_price", special_pack_price: 85 })], TODAY).price).toBe(85);
  });
  it("uses only the biggest of several standing percentages", () => {
    const r = resolveDeals(100, [deal({ id: "s1", kind: "percent_off", pct_off: 0.05 }), deal({ id: "s2", kind: "percent_off", pct_off: 0.1 })], TODAY);
    expect(r.price).toBeCloseTo(90, 6);
    expect(r.deal?.id).toBe("s2");
  });
  it("never returns zero, negative or above base, and warns about unusable deals", () => {
    const zero = deal({ id: "z", kind: "special_price", special_pack_price: 0 });
    const neg = deal({ id: "n", kind: "volume", min_qty: 2, unit_price: -5 });
    const over = deal({ id: "o", kind: "percent_off", pct_off: 1.5 }); // 150% off would go negative
    const r = resolveDeals(100, [zero, neg, over], TODAY);
    expect(r.price).toBe(100);
    expect(r.deal).toBeNull();
    expect(r.warnings.length).toBe(3);
    expect(effectivePackPrice(100, [deal({ kind: "special_price", special_pack_price: 130 })], TODAY)).toBe(100); // dearer than base is not a deal
    expect(effectivePackPrice(0, [bxgy(8, 1)], TODAY)).toBe(0);
  });
});

describe("dealSummary", () => {
  it("reads in words", () => {
    expect(dealSummary(bxgy(8, 1))).toBe("Buy 8 get 1 free: 11.1% off");
    expect(dealSummary(bxgy(10, 1))).toBe("Buy 10 get 1 free: 9.1% off");
    expect(dealSummary(deal({ kind: "volume", min_qty: 5, pct_off: 0.05 }))).toBe("5+ packs: 5% off");
    expect(dealSummary(deal({ kind: "volume", min_qty: 5, unit_price: 92 }))).toBe("5+ packs at $92.00 each");
    expect(dealSummary(deal({ kind: "special_price", special_pack_price: 80, starts_on: "2026-09-20", ends_on: "2026-09-30" }))).toBe("Special price $80.00 a pack, 20 Sep to 30 Sep");
    expect(dealSummary(deal({ kind: "percent_off", pct_off: 0.05 }))).toBe("5% off (standing)");
  });
});

describe("parseDealFromText", () => {
  it("spots keg and carton deals", () => {
    expect(parseDealFromText("KEG 8+1 LUC $355")).toMatchObject({ kind: "buy_x_get_y", buy_qty: 8, free_qty: 1 });
    expect(parseDealFromText("Carton 10+1")).toMatchObject({ kind: "buy_x_get_y", buy_qty: 10, free_qty: 1 });
    expect(parseDealFromText("BUY 5 GET 1 FREE")).toMatchObject({ kind: "buy_x_get_y", buy_qty: 5, free_qty: 1 });
  });
  it("spots percentage deals", () => {
    const p = parseDealFromText("Butter 5% OFF this month");
    expect(p).toMatchObject({ kind: "percent_off", pct_off: 0.05 });
    expect(parseDealFromText("2.5% discount")?.pct_off).toBeCloseTo(0.025, 6);
  });
  it("returns null when there is nothing to find", () => {
    expect(parseDealFromText("Tomato Paste 3kg")).toBeNull();
    expect(parseDealFromText("Cups 2+3 ply")).toBeNull(); // a pack size, not a deal (needs buy > free)
    expect(parseDealFromText("Milk 6x1L")).toBeNull();
    expect(parseDealFromText("")).toBeNull();
    expect(parseDealFromText(null)).toBeNull();
  });
});

describe("costing with deals", () => {
  const line: RecipeLine = { id: "l1", parent_type: "item", parent_id: "it1", component_type: "ingredient", component_id: "keg", qty: 1, unit: "L", note: null, sort: 1 };
  const item: MenuItem = { id: "it1", name: "Pint", venue_id: 1, category: "Tap Beer", section: null, portions: 1, sell_price_inc: 10, target_override: null, hh_price_inc: null, active: true, source: null, notes: null };
  const data = (deals?: IngredientDeal[]) => ({ ingredients: [ing()], preps: [], lines: [line], items: [item], settings: DEFAULT_SETTINGS, targets: [], deals });

  it("old signatures still work and deals are optional", () => {
    const idx = buildIndex([ing()], [], [line]);
    expect(ingredientCostPerBase(idx.ingredients.get("keg")!, 0.1)).toBeCloseTo(8, 6);
  });
  it("the index costs at the effective pack price, and only while the deal is live", () => {
    const d = [bxgy(8, 1)];
    expect(ingredientCostPerBase(buildIndex([ing()], [], [line], d, TODAY).ingredients.get("keg")!, 0.1)).toBeCloseTo(355.56 / 50, 3);
    const dated = [bxgy(8, 1, { ends_on: "2026-09-30" })];
    expect(ingredientCostPerBase(buildIndex([ing()], [], [line], dated, "2026-10-01").ingredients.get("keg")!, 0.1)).toBeCloseTo(8, 6); // expired: base price
  });
  it("the old rebate stays a standing rebate on top of the effective price (not double counted)", () => {
    const withRebate = ing({ rebate: 20 });
    const eff = withEffectivePrice(withRebate, [bxgy(10, 1)], TODAY);
    expect(eff.pack_price).toBeCloseTo(363.64, 2);
    expect(ingredientCostPerBase(eff, 0.1)).toBeCloseTo((363.636 - 20) / 50, 3);
  });
  it("does not touch the stored ingredient or its price", () => {
    const base = ing();
    withEffectivePrice(base, [bxgy(8, 1)], TODAY);
    expect(base.pack_price).toBe(400);
  });
  it("impact preview: a new deal lowers dish cost and raises GP", () => {
    const rows = ingredientChangeImpact("keg", {}, { ...data(), dealsAfter: [bxgy(8, 1)] });
    expect(rows).toHaveLength(1);
    expect(rows[0].after.costPerPortion).toBeLessThan(rows[0].before.costPerPortion);
    const c = costItem(item, buildIndex([ing()], [], [line], [bxgy(8, 1)], TODAY), DEFAULT_SETTINGS, []);
    expect(c.costPerPortion).toBeCloseTo(355.56 / 50, 2);
  });
  it("impact preview: removing a deal makes dishes dearer", () => {
    const d = [bxgy(8, 1)];
    const rows = ingredientChangeImpact("keg", {}, { ...data(d), dealsAfter: [] });
    expect(rows[0].after.costPerPortion).toBeGreaterThan(rows[0].before.costPerPortion);
  });
});

describe("dealFeedRows", () => {
  const ings = [ing()];
  const inUse = new Set(["keg"]);
  it("lists ending and recently expired deals, not far-off ones or unused ingredients", () => {
    const rows = dealFeedRows(
      [
        bxgy(8, 1, { id: "soon", ends_on: "2026-10-02" }),
        bxgy(8, 1, { id: "gone", ends_on: "2026-09-20" }),
        bxgy(8, 1, { id: "old", ends_on: "2026-06-01" }),
        bxgy(8, 1, { id: "far", ends_on: "2027-01-01" }),
        bxgy(8, 1, { id: "open" }),
        bxgy(8, 1, { id: "other", ingredient_id: "nope", ends_on: "2026-10-02" }),
      ],
      ings,
      inUse,
      TODAY,
    );
    expect(rows.map((r) => [r.deal.id, r.kind, r.days])).toEqual([
      ["gone", "deal_expired", 5],
      ["soon", "deal_ending", 7],
    ]);
    expect(dealFeedRows([bxgy(8, 1, { ends_on: "2026-10-02" })], ings, new Set(), TODAY)).toEqual([]);
  });
});
