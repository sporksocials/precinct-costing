import { describe, expect, it } from "vitest";
import { buildIndex, costItem, costLines, type ItemCost } from "@/lib/costing";
import { buildGelato, virtualItemId } from "@/lib/gelato";
import { catalogueGaps, checkCostGroups, checkCostRows, gpSummary, latestPortalRows, missingPriceGroups, underTarget, underTargetRows } from "@/lib/insights";
import { buildReviewChanges, defaultSelection } from "@/lib/price-review";
import { costOffer, liveOffersToCheck, liveOffersUnderTarget } from "@/lib/offers";
import { gp, parseDecimal, parseNum } from "@/lib/format";
import { parseGpInput, parsePriceInput, parseYieldInput } from "@/lib/solver";
import { parseNumberToken } from "@/lib/parse-qty";
import { DEFAULT_SETTINGS, type GelatoServe, type Ingredient, type MenuItem, type Offer, type OfferLine, type PortalPrice, type Prep, type RecipeLine, type Target, type Venue } from "@/lib/types";

/* ---------- builders ---------- */
const ing = (id: string, over: Partial<Ingredient> = {}): Ingredient =>
  ({ id, name: id, category: null, supplier_id: null, supplier_code: null, pack_size: 1, pack_unit: "kg", pack_price: 10, price_inc_gst: false, gst_free: false, rebate: 0, yield_pct: 1, venues: null, active: true, last_price_update: null, previous_price: null, source: null, notes: null, updated_at: null, ...over }) as Ingredient;
const item = (id: string, over: Partial<MenuItem> = {}): MenuItem =>
  ({ id, name: id, venue_id: 1, category: "Food", section: null, portions: 1, sell_price_inc: 22, target_override: null, hh_price_inc: null, active: true, source: null, notes: null, ...over }) as MenuItem;
const prep = (id: string, over: Partial<Prep> = {}): Prep => ({ id, name: id, venue_id: 1, prep_type: null, yield_qty: 1, yield_unit: "kg", active: true, source: null, notes: null, ...over });
let n = 0;
const line = (parentType: "item" | "prep", parent: string, compType: "ingredient" | "prep", comp: string, qty: number, unit: RecipeLine["unit"] = "kg"): RecipeLine => {
  n += 1;
  return { id: `l${n}`, parent_type: parentType, parent_id: parent, component_type: compType, component_id: comp, qty, unit, note: null, sort: n };
};
const settings = DEFAULT_SETTINGS;
const targets: Target[] = [];

function costAll(items: MenuItem[], ings: Ingredient[], preps: Prep[], lines: RecipeLine[]): Map<string, ItemCost> {
  const index = buildIndex(ings, preps, lines);
  const cache = new Map();
  return new Map(items.map((i) => [i.id, costItem(i, index, settings, targets, cache)]));
}

/* ---------- A: $0 ingredient inside a prep ---------- */
describe("A: issues inside preps reach the dish", () => {
  const ings = [ing("Beef Mince", { pack_price: 0 }), ing("Tomato", { pack_price: 4 }), ing("Salt", { pack_price: 20 })];
  const preps = [prep("Napoli Sauce"), prep("Base Sauce"), prep("Loop A"), prep("Loop B")];
  const lines = [
    line("prep", "Napoli Sauce", "ingredient", "Beef Mince", 0.5),
    line("prep", "Napoli Sauce", "ingredient", "Tomato", 1),
    line("item", "pasta", "prep", "Napoli Sauce", 0.2),
    // nested: dish -> prep -> prep -> $0 ingredient
    line("prep", "Base Sauce", "prep", "Napoli Sauce", 1),
    line("item", "lasagne", "prep", "Base Sauce", 0.2),
    // clean dish
    line("prep", "Loop A", "ingredient", "Salt", 1),
    line("item", "salad", "prep", "Loop A", 0.1),
  ];
  const costs = costAll([item("pasta"), item("lasagne"), item("salad")], ings, preps, lines);

  it("flags the dish with the ingredient and the prep it sits in", () => {
    const c = costs.get("pasta")!;
    expect(c.needsCheck).toBe(true);
    expect(c.costWarnings).toContain("Zero cost line, Beef Mince (in Napoli Sauce): pack price is 0");
  });
  it("bubbles up through nested preps", () => {
    const c = costs.get("lasagne")!;
    expect(c.needsCheck).toBe(true);
    expect(c.costWarnings).toContain("Zero cost line, Beef Mince (in Base Sauce > Napoli Sauce): pack price is 0");
  });
  it("leaves clean dishes alone", () => {
    expect(costs.get("salad")!.needsCheck).toBe(false);
  });
  it("is cycle safe", () => {
    const cyc = [prep("Loop A"), prep("Loop B")];
    const l = [line("prep", "Loop A", "prep", "Loop B", 1), line("prep", "Loop B", "prep", "Loop A", 1), line("item", "cyc", "prep", "Loop A", 1)];
    const c = costAll([item("cyc")], [], cyc, l).get("cyc")!;
    expect(c.needsCheck).toBe(true);
    expect(c.costWarnings.some((w) => /Cycle/.test(w))).toBe(true);
  });
  it("is memo safe: a shared cache gives the same answer on the second dish", () => {
    const index = buildIndex(ings, preps, lines);
    const cache = new Map();
    const a = costItem(item("pasta"), index, settings, targets, cache);
    const b = costItem(item("pasta"), index, settings, targets, cache);
    expect(b.costWarnings).toEqual(a.costWarnings);
  });
  it("keeps the dish out of the headline, into Check Cost, and unticks Review & Apply", () => {
    // pasta is underpriced so it would be a Below Target row, and has a suggested price
    const cheap = new Map(costs);
    const pc = costItem(item("pasta", { sell_price_inc: 1 }), buildIndex(ings, preps, lines), settings, targets);
    cheap.set("pasta", pc);
    const sum = gpSummary(cheap.values());
    expect(sum.count).toBe(1); // only the clean salad
    expect(sum.excluded).toBe(2);
    expect(checkCostRows(cheap.values()).map((r) => r.cost.item.id)).toContain("pasta");
    const changes = buildReviewChanges(underTarget(cheap.values()), settings.gst_rate);
    const row = changes.find((c) => c.key === "pasta");
    expect(row?.needsCheck).toBe(true);
    expect(defaultSelection(changes).has("pasta")).toBe(false);
  });
});

/* ---------- B: other recipe warnings reach costWarnings ---------- */
describe("B: every recipe warning is a cost warning", () => {
  it("unit mismatch", () => {
    const c = costAll([item("a")], [ing("x", { pack_unit: "each" })], [], [line("item", "a", "ingredient", "x", 100, "g")]).get("a")!;
    expect(c.needsCheck).toBe(true);
    expect(c.costWarnings.some((w) => /Recipe problem, x: line is in g but it is priced per each/.test(w))).toBe(true);
  });
  it("missing component", () => {
    const c = costAll([item("a")], [], [], [line("item", "a", "ingredient", "gone", 1)]).get("a")!;
    expect(c.needsCheck).toBe(true);
    expect(c.costWarnings.some((w) => /Missing ingredient: no longer exists/.test(w))).toBe(true);
  });
  it("missing prep", () => {
    const c = costAll([item("a")], [], [], [line("item", "a", "prep", "gone", 1)]).get("a")!;
    expect(c.costWarnings.some((w) => /Missing prep/.test(w))).toBe(true);
  });
  it("a unit mismatch inside a prep reaches the dish", () => {
    const c = costAll([item("a")], [ing("x", { pack_unit: "each" })], [prep("P")], [line("prep", "P", "ingredient", "x", 100, "g"), line("item", "a", "prep", "P", 1)]).get("a")!;
    expect(c.needsCheck).toBe(true);
    expect(c.costWarnings.some((w) => /x \(in P\)/.test(w))).toBe(true);
  });
  it("depth", () => {
    const preps = Array.from({ length: 8 }, (_, i) => prep(`d${i}`));
    const lines = preps.slice(0, 7).map((p, i) => line("prep", p.id, "prep", `d${i + 1}`, 1));
    lines.push(line("prep", "d7", "ingredient", "x", 1), line("item", "a", "prep", "d0", 1));
    const c = costAll([item("a")], [ing("x")], preps, lines).get("a")!;
    expect(c.costWarnings.some((w) => /Nesting deeper/.test(w))).toBe(true);
    expect(c.needsCheck).toBe(true);
  });
});

/* ---------- C: off-menu gelato serves and legacy hiding ---------- */
const venues: Venue[] = [{ id: 1, slug: "drift", name: "Drift" } as Venue, { id: 4, slug: "gelato", name: "Gelato" } as Venue];
const serve = (id: string, name: string, price: number | null, on_menu: boolean, over: Partial<GelatoServe> = {}): GelatoServe =>
  ({ id, venue_id: 4, name, sort: 1, grams: 100, sell_price_inc: price, on_menu, active: true, notes: null, ...over }) as GelatoServe;
const legacy = (id: string, section: string): MenuItem => item(id, { venue_id: 4, category: "Gelato", section, name: `${id} old` });
const gPreps = [prep("mixA", { venue_id: 4, prep_type: "Gelato flavour mix", name: "Banana Gelato Mix" })];
const gLines = [line("prep", "mixA", "ingredient", "base", 1)];

describe("C: gelato off-menu serves and legacy items", () => {
  const serves = [serve("s1", "1 Scoop", 5, true), serve("s2", "Wholesale Tub", 1, false)];
  const g = buildGelato({ venues, preps: gPreps, items: [], serves, serveLines: [], wastage: 0 });
  const costs = costAll(g.items, [ing("base", { pack_price: 5 })], gPreps, [...gLines, ...g.lines]);

  it("flags off-menu serves on the virtual item but keeps them costed", () => {
    const off = costs.get(virtualItemId("mixA", "s2"))!;
    expect(off.item.off_menu).toBe(true);
    expect(off.gpPct).not.toBeNull();
    expect(costs.get(virtualItemId("mixA", "s1"))!.item.off_menu).toBe(false);
  });
  it("leaves off-menu serves out of the average, under-target rows and Today", () => {
    // wholesale tub at $1 is far under target; the on-menu 1 Scoop at $5 (cost 0.5 ex) is healthy
    expect(costs.get(virtualItemId("mixA", "s2"))!.underTarget).toBe(true);
    expect(underTarget(costs.values())).toHaveLength(0);
    expect(underTargetRows(costs.values())).toHaveLength(0);
    const sum = gpSummary(costs.values());
    expect(sum.count).toBe(1);
    expect(sum.avg).toBeCloseTo(costs.get(virtualItemId("mixA", "s1"))!.gpPct!);
    expect(gpSummary(costs.values(), 4).count).toBe(1);
  });
  it("keeps off-menu serves out of Check Cost and Missing Price too", () => {
    const g2 = buildGelato({ venues, preps: gPreps, items: [], serves: [serve("s1", "1 Scoop", 5, true), serve("s2", "Tub", null, false)], serveLines: [], wastage: 0 });
    const c2 = costAll(g2.items, [ing("base", { pack_price: 0 })], gPreps, [...gLines, ...g2.lines]);
    expect(checkCostRows(c2.values()).map((r) => r.cost.item.id)).toEqual([virtualItemId("mixA", "s1")]);
    expect(missingPriceGroups(c2.values())).toHaveLength(0);
  });

  it("renaming or deactivating a serve does not resurrect hidden legacy items (explicit ids)", () => {
    const old = [legacy("old1", "1 Scoop"), legacy("old2", "1 Scoop"), item("acai", { venue_id: 4, category: "Gelato", section: "Acai" })];
    const withIds = [serve("s1", "1 Scoop", 5, true, { legacy_item_ids: ["old1", "old2"] })];
    const base = buildGelato({ venues, preps: gPreps, items: old, serves: withIds, serveLines: [], wastage: 0 });
    expect([...base.replacedItemIds].sort()).toEqual(["old1", "old2"]);
    const renamed = buildGelato({ venues, preps: gPreps, items: old, serves: [{ ...withIds[0], name: "Kids Cup!" }], serveLines: [], wastage: 0 });
    expect([...renamed.replacedItemIds].sort()).toEqual(["old1", "old2"]);
    const off = buildGelato({ venues, preps: gPreps, items: old, serves: [{ ...withIds[0], active: false }], serveLines: [], wastage: 0 });
    expect([...off.replacedItemIds].sort()).toEqual(["old1", "old2"]);
    expect(off.items).toHaveLength(0);
    expect(renamed.replacedItemIds.has("acai")).toBe(false);
  });
  it("name matching still works as the fallback, and survives deactivating the serve", () => {
    const old = [legacy("old1", "1 Scoop")];
    const off = buildGelato({ venues, preps: gPreps, items: old, serves: [serve("s1", "1 scoop", 5, true, { active: false })], serveLines: [], wastage: 0 });
    expect([...off.replacedItemIds]).toEqual(["old1"]);
  });
  it("a new serve without ids falls back to its name; a serve with ids ignores its name", () => {
    const old = [legacy("old1", "1 Scoop"), legacy("old2", "Kids Cup"), legacy("old3", "Kids Cup")];
    const g = buildGelato({
      venues, preps: gPreps, items: old, serveLines: [], wastage: 0,
      serves: [serve("s1", "1 Scoop", 5, true, { legacy_item_ids: [] }), serve("s2", "Kids Cup", 4, true, { legacy_item_ids: ["old2"] })],
    });
    // old1 by name (s1 has no ids); old2 by id; old3 shares s2's name but is not in its ids, so it is left alone
    expect([...g.replacedItemIds].sort()).toEqual(["old1", "old2"]);
  });
  it("id and name both present: ids win, and an item matched by id stays hidden even if its section changed", () => {
    const old = [legacy("old1", "Renamed Section"), legacy("old2", "1 Scoop")];
    const g = buildGelato({ venues, preps: gPreps, items: old, serves: [serve("s1", "1 Scoop", 5, true, { legacy_item_ids: ["old1", "old2"] })], serveLines: [], wastage: 0 });
    expect([...g.replacedItemIds].sort()).toEqual(["old1", "old2"]);
  });
  it("tolerates a null or missing legacy_item_ids column", () => {
    const old = [legacy("old1", "1 Scoop")];
    for (const v of [null, undefined]) {
      const g = buildGelato({ venues, preps: gPreps, items: old, serves: [serve("s1", "1 Scoop", 5, true, { legacy_item_ids: v })], serveLines: [], wastage: 0 });
      expect([...g.replacedItemIds]).toEqual(["old1"]);
    }
  });
});

/* ---------- D: missing price ---------- */
describe("D: active items with no sell price", () => {
  const ings = [ing("gin", { pack_price: 30, pack_unit: "L" }), ing("z", { pack_price: 0 })];
  const items = [
    item("Gin Spirit", { category: "Spirits", sell_price_inc: null }),
    item("Zero Spirit", { category: "Spirits", sell_price_inc: null }),
    item("Off", { category: "Spirits", sell_price_inc: null, active: false }),
    item("Priced"),
  ];
  const lines = [line("item", "Gin Spirit", "ingredient", "gin", 0.03, "L"), line("item", "Zero Spirit", "ingredient", "z", 1), line("item", "Priced", "ingredient", "gin", 0.01, "L")];
  const costs = costAll(items, ings, [], lines);
  it("lists active unpriced items only, with a suggestion only when the cost is trustworthy", () => {
    const rows = missingPriceGroups(costs.values());
    expect(rows.map((r) => r.id).sort()).toEqual(["Gin Spirit", "Zero Spirit"]);
    const gin = rows.find((r) => r.id === "Gin Spirit")!;
    expect(gin.suggestedInc).toBeGreaterThan(0);
    expect(gin.href).toBe("/items/Gin Spirit");
    expect(rows.find((r) => r.id === "Zero Spirit")!.suggestedInc).toBeNull();
  });
  it("respects the venue filter and never touches a price", () => {
    expect(missingPriceGroups(costs.values(), 2)).toHaveLength(0);
    expect(costs.get("Gin Spirit")!.item.sell_price_inc).toBeNull();
  });
});

/* ---------- E: offers ---------- */
describe("E: offers with missing components", () => {
  const ic = (id: string, cost: number, sell: number | null, extra: Partial<ItemCost> = {}): ItemCost => ({ item: { id, name: id }, costPerPortion: cost, sellInc: sell, targetGp: 0.7, needsCheck: false, ...extra }) as unknown as ItemCost;
  const costs = new Map<string, ItemCost>([["burger", ic("burger", 5, 22)], ["flag", ic("flag", 1, 10, { needsCheck: true })]]);
  const l = (id: string, item_id: string): OfferLine => ({ id, offer_id: "o1", component_kind: "item", item_id, beer_id: null, serve_id: null, qty: 1, price_inc_override: null, sort: 1 });
  const offer = (over: Partial<Offer> = {}): Offer => ({ id: "o1", name: "Combo", venue_id: 1, kind: "combo", status: "live", price_inc: 12, target_override: null, starts_on: null, ends_on: null, days_of_week: null, time_from: null, time_to: null, notes: null, ...over }) as Offer;
  it("a deleted component gives no GP, no below-target claim, and a check flag", () => {
    const o = offer();
    const c = costOffer(o, [l("a", "burger"), l("b", "gone")], { itemCosts: costs, settings });
    expect(c.gpPct).toBeNull();
    expect(c.underTarget).toBe(false);
    expect(c.belowCost).toBe(false);
    expect(c.needsCheck).toBe(true);
    expect(c.suggestedPriceInc).toBeNull();
    const map = new Map([[o.id, c]]);
    expect(liveOffersUnderTarget([o], map)).toHaveLength(0);
    expect(liveOffersToCheck([o], map)).toHaveLength(1);
  });
  it("a flagged component is never called below target", () => {
    const o = offer({ price_inc: 2 });
    const c = costOffer(o, [l("a", "flag")], { itemCosts: costs, settings });
    expect(c.needsCheck).toBe(true);
    expect(c.underTarget).toBe(false);
    expect(liveOffersUnderTarget([o], new Map([[o.id, c]]))).toHaveLength(0);
  });
  it("a complete offer is unchanged", () => {
    const c = costOffer(offer({ price_inc: 12 }), [l("a", "burger")], { itemCosts: costs, settings });
    expect(c.needsCheck).toBe(false);
    expect(c.gpPct).not.toBeNull();
    expect(c.underTarget).toBe(true);
  });
});

/* ---------- F: parsing ---------- */
describe("F: one tolerant parser", () => {
  it("handles thousands and decimal commas", () => {
    expect(parseDecimal("1,234.50")).toBe(1234.5);
    expect(parseDecimal("1,234")).toBe(1234);
    expect(parseDecimal("12,345,678")).toBe(12345678);
    expect(parseDecimal("18,5")).toBe(18.5);
    expect(parseDecimal("18,50")).toBe(18.5);
    expect(parseDecimal("0,125")).toBe(0.125);
    expect(parseDecimal("1.234,50")).toBe(1234.5);
    expect(parseDecimal(" $ 18.50 ")).toBe(18.5);
    expect(parseDecimal("72%")).toBe(72);
    expect(parseDecimal(".5")).toBe(0.5);
    expect(parseDecimal("0")).toBe(0);
  });
  it("rejects junk, negatives and NaN", () => {
    for (const bad of ["", "  ", "abc", "-5", "1,2,3", "1..2", "1.2.3", "12,3456", "NaN", "Infinity", "1e3", "$"]) expect(parseDecimal(bad)).toBeNull();
    expect(parseDecimal(null)).toBeNull();
  });
  it("is the parser behind price, GP, quantity and generic number inputs", () => {
    expect(parsePriceInput("18,5")).toBe(18.5);
    expect(parsePriceInput("1,234.50")).toBe(1234.5);
    expect(parseNum("1,234")).toBe(1234);
    expect(parseGpInput("72,5")).toBeCloseTo(0.725);
    expect(parseGpInput("72%")).toBeCloseTo(0.72);
    expect(parseGpInput("1")).toBeCloseTo(0.01); // GP and target fields keep the percent rule
    expect(parseNumberToken("2,5")).toBe(2.5);
    expect(parseNumberToken("1,250")).toBe(1250);
    expect(parseNumberToken("1/2")).toBe(0.5);
  });
  it("reads a bare 1 as 100% for yield fields", () => {
    expect(parseYieldInput("1")).toBe(1);
    expect(parseYieldInput("1%")).toBe(1);
    expect(parseYieldInput("100")).toBe(1);
    expect(parseYieldInput("85")).toBeCloseTo(0.85);
    expect(parseYieldInput("0.85")).toBeCloseTo(0.85);
    expect(parseYieldInput("85,5")).toBeCloseTo(0.855);
    expect(parseYieldInput("0")).toBeNull();
    expect(parseYieldInput("-5")).toBeNull();
    expect(parseYieldInput("9000")).toBeNull();
  });
});

/* ---------- G: display rounding ---------- */
describe("G: gp formatter never misleads", () => {
  it("under target never reads as the target", () => {
    expect(gp(0.7196, 1, 0.72)).toBe("71.96%");
    expect(gp(0.7196, 0, 0.72)).toBe("71.9%");
    expect(gp(0.71996, 1, 0.72)).toBe("71.99%");
    expect(gp(0.72, 1, 0.72)).toBe("72.0%");
    expect(gp(0.7204, 0, 0.72)).toBe("72%");
    expect(gp(0.65, 0, 0.72)).toBe("65%");
    expect(gp(0.7196)).toBe("72.0%"); // no target, no flag, plain rounding
  });
  it("never shows 100% for less than 100%", () => {
    expect(gp(0.9995, 1)).toBe("99.95%");
    expect(gp(0.9996, 0)).toBe("99.9%");
    expect(gp(1, 0)).toBe("100%");
  });
  it("handles empty values", () => {
    expect(gp(null)).toBe("—");
    expect(gp(undefined, 0, 0.72)).toBe("—");
  });
});

/* ---------- H: catalogue matching ---------- */
describe("H: catalogue matching needs the supplier", () => {
  const portal = (id: number, supplier: string, code: string, price: number, captured_at = "2026-09-01T00:00:00Z", batch = "b1"): PortalPrice => ({ id, supplier, product_code: code, description: null, price, price_inc_gst: false, uom: "EA (1KG)", in_stock: true, category: null, captured_at, batch });
  const suppliers = [{ id: 1, name: "Elenka" }, { id: 2, name: "Cotton Tree Meats" }];
  const rows = [portal(1, "Cotton Tree Meats", "A100", 50), portal(2, "Elenka", "A100", 10.5)];
  it("does not match another supplier's code", () => {
    const i = ing("x", { supplier_id: 1, supplier_code: "A100", pack_price: 10, pack_size: 1 });
    const gaps = catalogueGaps([i], rows, 0.1, suppliers);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].portal.supplier).toBe("Elenka");
    // only the other supplier has the code: no match, not a false 400% gap
    expect(catalogueGaps([i], [rows[0]], 0.1, suppliers)).toHaveLength(0);
  });
  it("cannot verify a supplier it does not know", () => {
    expect(catalogueGaps([ing("x", { supplier_id: 9, supplier_code: "A100" })], rows, 0.1, suppliers)).toHaveLength(0);
    expect(catalogueGaps([ing("x", { supplier_id: 1, supplier_code: "A100" })], rows, 0.1)).toHaveLength(0);
  });
  it("a supplier-less code matches only when one supplier uses it", () => {
    const i = ing("x", { supplier_id: null, supplier_code: "A100", pack_price: 10 });
    expect(catalogueGaps([i], rows, 0.1, suppliers)).toHaveLength(0);
    expect(catalogueGaps([i], [rows[1]], 0.1, suppliers)).toHaveLength(1);
  });
  it("skips a code repeated with different prices inside one supplier", () => {
    const i = ing("x", { supplier_id: 1, supplier_code: "A100", pack_price: 10 });
    expect(catalogueGaps([i], [portal(1, "Elenka", "A100", 20), portal(2, "Elenka", "A100", 30)], 0.1, suppliers)).toHaveLength(0);
  });
  it("keeps both batches when timestamps tie, and drops older ones", () => {
    const all = [
      portal(1, "Simon George", "P1", 1, "2026-09-20T00:00:00Z", "produce"),
      portal(2, "Simon George", "S1", 1, "2026-09-20T00:00:00Z", "specials"),
      portal(3, "Simon George", "OLD", 1, "2026-08-01T00:00:00Z", "old"),
      portal(4, "Elenka", "E1", 1, "2026-09-02T00:00:00Z", "e"),
    ];
    expect(latestPortalRows(all).map((r) => r.id)).toEqual([1, 2, 4]);
  });
});

/* ---------- I: app-level numbers on one synthetic dataset ---------- */
describe("I: synthetic dataset, every case at once", () => {
  const ings = [
    ing("Beef Mince", { pack_price: 0 }),
    ing("Tomato", { pack_price: 4 }),
    ing("Chicken", { pack_price: 8 }),
    ing("Gin", { pack_price: 30, pack_unit: "L" }),
    ing("Milk", { pack_price: 5 }),
    ing("Cup", { pack_price: 0.2, pack_unit: "each" }),
  ];
  const preps = [prep("Napoli Sauce"), prep("Vanilla Gelato Mix", { venue_id: 4, prep_type: "Gelato flavour mix" })];
  const lines = [
    line("prep", "Napoli Sauce", "ingredient", "Beef Mince", 0.5),
    line("prep", "Napoli Sauce", "ingredient", "Tomato", 1),
    line("prep", "Vanilla Gelato Mix", "ingredient", "Milk", 1),
    line("item", "Pasta", "prep", "Napoli Sauce", 0.2), // hidden $0 through a prep
    line("item", "Chicken Plate", "ingredient", "Chicken", 0.2), // healthy: cost 1.60 against $12 inc
    line("item", "Underpriced Burger", "ingredient", "Chicken", 1), // cost 8, sell 10 -> under target
    line("item", "Gin Sour", "ingredient", "Gin", 0.03, "L"), // no price
    line("item", "Broken Unit", "ingredient", "Cup", 5, "g"), // unit mismatch
  ];
  const items = [
    item("Pasta", { sell_price_inc: 2 }),
    item("Chicken Plate", { sell_price_inc: 12 }),
    item("Underpriced Burger", { sell_price_inc: 10 }),
    item("Gin Sour", { category: "Spirits", sell_price_inc: null }),
    item("Broken Unit", { sell_price_inc: 20 }),
  ];
  const serves = [serve("s1", "1 Scoop", 6, true), serve("s2", "Tub", 1, false)];
  const g = buildGelato({ venues, preps, items: [], serves, serveLines: [], wastage: 0 });
  const index = buildIndex(ings, preps, [...lines, ...g.lines]);
  const cache = new Map();
  const all = new Map([...items, ...g.items].map((i) => [i.id, costItem(i, index, settings, targets, cache)]));

  it("headline average counts only trustworthy, on-menu, priced items", () => {
    const sum = gpSummary(all.values());
    const ids = new Set([...all.values()].filter((c) => c.item.active && c.gpPct != null && !c.needsCheck && !c.item.off_menu).map((c) => c.item.id));
    expect(sum.count).toBe(ids.size);
    expect([...ids].sort()).toEqual(["Chicken Plate", "Underpriced Burger", virtualItemId("Vanilla Gelato Mix", "s1")].sort());
    expect(sum.excluded).toBe(2); // Pasta (via prep) and Broken Unit
  });
  it("Below Target has no off-menu serve; the flagged dish is there but never pre-ticked", () => {
    expect(underTargetRows(all.values()).map((r) => r.cost.item.id).sort()).toEqual(["Pasta", "Underpriced Burger"]);
    expect(underTargetRows(all.values()).some((r) => r.cost.item.off_menu)).toBe(false);
  });
  it("Check Cost lists the hidden $0, the unit mismatch, and nothing off-menu", () => {
    const ids = checkCostRows(all.values()).map((r) => r.cost.item.id).sort();
    expect(ids).toEqual(["Broken Unit", "Pasta"]);
    const groups = checkCostGroups(checkCostRows(all.values()));
    expect(groups.find((x) => x.name === "Pasta")!.warnings[0]).toMatch(/Beef Mince \(in Napoli Sauce\): pack price is 0/);
  });
  it("Missing Price lists the unpriced spirit with a suggestion", () => {
    const rows = missingPriceGroups(all.values());
    expect(rows.map((r) => r.id)).toEqual(["Gin Sour"]);
    expect(rows[0].suggestedInc).toBeGreaterThan(0);
  });
  it("Review & Apply starts the flagged rows unticked", () => {
    const changes = buildReviewChanges(underTarget(all.values()), settings.gst_rate);
    const sel = defaultSelection(changes);
    for (const c of changes) expect(sel.has(c.key)).toBe(!c.needsCheck);
    expect(changes.find((c) => c.key === "Pasta")!.needsCheck).toBe(true);
    expect(sel.has("Pasta")).toBe(false);
    expect(sel.has("Underpriced Burger")).toBe(true);
  });
});

it("costLines on an empty list is clean", () => {
  const r = costLines([], buildIndex([], [], []), 0.1);
  expect(r.total).toBe(0);
  expect(r.warnings).toEqual([]);
});
