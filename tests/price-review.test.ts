import { describe, expect, it } from "vitest";
import { buildIndex, costItem } from "@/lib/costing";
import { buildGelato } from "@/lib/gelato";
import { applyPlan, buildReviewChanges, defaultSelection, gelatoServeStats, groupChangesByVenue } from "@/lib/price-review";
import { checkCostGroups, checkCostRows } from "@/lib/insights";
import { reviewChangesFromImpact } from "@/lib/price-review";
import { DEFAULT_SETTINGS, type GelatoServe, type Ingredient, type MenuItem, type Prep, type RecipeLine, type Venue } from "@/lib/types";

const GST = DEFAULT_SETTINGS.gst_rate;
const ing = (id: string, over: Partial<Ingredient> = {}): Ingredient =>
  ({ id, name: id, category: null, supplier_id: null, supplier_code: null, pack_size: 1, pack_unit: "kg", pack_price: 10, price_inc_gst: false, gst_free: false, rebate: 0, yield_pct: 1, venues: null, active: true, last_price_update: null, previous_price: null, source: null, notes: null, updated_at: null, ...over }) as Ingredient;
const item = (id: string, over: Partial<MenuItem> = {}): MenuItem =>
  ({ id, name: id, venue_id: 1, category: "Food", section: null, portions: 1, sell_price_inc: 22, target_override: null, hh_price_inc: null, active: true, source: null, notes: null, ...over }) as MenuItem;
const line = (parent: string, comp: string, qty: number): RecipeLine =>
  ({ id: `${parent}-${comp}`, parent_type: "item", parent_id: parent, component_type: "ingredient", component_id: comp, qty, unit: "kg", note: null, sort: 1 });

describe("buildReviewChanges", () => {
  // $8 of beef at the default 70% target: 8 / 0.3 * 1.1 = 29.33, rounded up to 29.5 at 50c
  const ings = [ing("beef", { pack_price: 8 }), ing("veg", { pack_price: 2 }), ing("zero", { pack_price: 0 })];
  const items = [
    item("under", { sell_price_inc: 24 }),
    item("fine", { sell_price_inc: 60 }),
    item("checkme", { sell_price_inc: 12, venue_id: 2 }),
    item("off", { sell_price_inc: 20, active: false }),
  ];
  const lines = [line("under", "beef", 1), line("fine", "veg", 1), line("checkme", "beef", 1), line("checkme", "zero", 1), line("off", "beef", 1)];
  const index = buildIndex(ings, [], lines);
  const costs = items.map((it) => costItem(it, index, DEFAULT_SETTINGS, []));

  it("lists only active under-target items with suggested price and GP before/after", () => {
    const ch = buildReviewChanges(costs, GST);
    expect(ch.map((c) => c.key).sort()).toEqual(["checkme", "under"]);
    const u = ch.find((c) => c.key === "under")!;
    expect(u.oldPrice).toBe(24);
    expect(u.newPrice).toBe(29.5);
    expect(u.gpBefore).toBeLessThan(0.7);
    expect(u.gpAfter).toBeGreaterThanOrEqual(0.7 - 1e-9);
    expect(u.kind).toBe("item");
  });

  it("switches off items whose cost needs checking by default", () => {
    const ch = buildReviewChanges(costs, GST);
    expect(ch.find((c) => c.key === "checkme")!.needsCheck).toBe(true);
    expect([...defaultSelection(ch)]).toEqual(["under"]);
  });

  it("builds the write plan from the ticked changes only", () => {
    const ch = buildReviewChanges(costs, GST);
    const plan = applyPlan(ch, new Set(["under"]));
    expect(plan).toHaveLength(1);
    expect(plan[0].c.item.id).toBe("under");
    expect(plan[0].price).toBe(29.5);
    expect(applyPlan(ch, new Set())).toEqual([]);
  });

  it("groups by venue in id order", () => {
    const groups = groupChangesByVenue(buildReviewChanges(costs, GST));
    expect(groups.map((g) => g.venueId)).toEqual([1, 2]);
  });
});

describe("gelato serves in the review list", () => {
  const venues = [{ id: 4, slug: "gelato", name: "Gelato Rumba" } as Venue];
  const prep = (id: string, name: string): Prep => ({ id, name, venue_id: 4, prep_type: "Gelato flavour mix", yield_qty: 1, yield_unit: "kg", active: true, source: null, notes: null });
  const preps = [prep("cheap", "Vanilla gelato mix"), prep("dear", "Pistachio gelato mix"), prep("mid", "Choc gelato mix")];
  const ings = [ing("vmix", { pack_price: 4 }), ing("pmix", { pack_price: 30 }), ing("cmix", { pack_price: 12 })];
  const mixLines: RecipeLine[] = [
    { id: "l1", parent_type: "prep", parent_id: "cheap", component_type: "ingredient", component_id: "vmix", qty: 1, unit: "kg", note: null, sort: 1 },
    { id: "l2", parent_type: "prep", parent_id: "dear", component_type: "ingredient", component_id: "pmix", qty: 1, unit: "kg", note: null, sort: 1 },
    { id: "l3", parent_type: "prep", parent_id: "mid", component_type: "ingredient", component_id: "cmix", qty: 1, unit: "kg", note: null, sort: 1 },
  ];
  const serve: GelatoServe = { id: "s1", venue_id: 4, name: "2 Scoop Cup", sort: 1, grams: 200, sell_price_inc: 8, on_menu: true, active: true, notes: null } as GelatoServe;
  const g = buildGelato({ venues, preps, items: [], serves: [serve], serveLines: [], wastage: 0, targets: [] });
  const index = buildIndex(ings, preps, [...mixLines, ...g.lines]);
  const costs = g.items.map((it) => costItem(it, index, DEFAULT_SETTINGS, []));

  it("finds the worst flavour and counts flavours per serve", () => {
    const stats = gelatoServeStats(costs);
    expect(stats.get("s1")!.flavours).toBe(3);
    expect(stats.get("s1")!.worst.item.name).toBe("Pistachio - 2 Scoop Cup");
  });

  it("folds under-target flavours into one change per serve, priced from the worst flavour", () => {
    const under = costs.filter((c) => c.underTarget);
    expect(under.length).toBeGreaterThan(1);
    const ch = buildReviewChanges(under, GST, gelatoServeStats(costs));
    expect(ch).toHaveLength(1);
    expect(ch[0]).toMatchObject({ key: "serve:s1", kind: "gelato_serve", name: "2 Scoop Cup" });
    expect(ch[0].note).toContain("all 3 flavours");
    expect(ch[0].note).toContain("Pistachio");
    // priced from the dearest flavour, so every flavour clears target at the new price
    for (const c of costs) expect((ch[0].newPrice / (1 + GST) - c.costPerPortion) / (ch[0].newPrice / (1 + GST))).toBeGreaterThanOrEqual(0.7 - 1e-9);
    // and the write goes through that worst flavour's serve
    expect(ch[0].cost.item.id).toBe("gelato~dear~s1");
  });

  it("uses the true worst flavour even when only a cheaper one was passed in", () => {
    const onlyMid = costs.filter((c) => c.item.id === "gelato~mid~s1");
    const ch = buildReviewChanges(onlyMid, GST, gelatoServeStats(costs));
    expect(ch[0].cost.item.id).toBe("gelato~dear~s1");
  });
});

describe("check cost groups", () => {
  const g0 = buildGelato({
    venues: [{ id: 4, slug: "gelato", name: "Gelato Rumba" } as Venue],
    preps: ["a", "b", "c"].map((id) => ({ id, name: `${id} gelato mix`, venue_id: 4, prep_type: "Gelato flavour mix", yield_qty: 1, yield_unit: "kg", active: true, source: null, notes: null }) as Prep),
    items: [],
    serves: [{ id: "s1", venue_id: 4, name: "Cup", sort: 1, grams: 100, sell_price_inc: 5, on_menu: true, active: true, notes: null } as GelatoServe],
    serveLines: [],
    wastage: 0,
    targets: [],
  });
  // the mixes have no lines, so every serve costs $0 and is flagged
  const costs = g0.items.map((it) => costItem(it, buildIndex([], [], g0.lines), DEFAULT_SETTINGS, []));
  it("folds gelato serves with the same warnings into one row", () => {
    const rows = checkCostRows(costs);
    expect(rows.length).toBe(3);
    const groups = checkCostGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ count: 3, name: "3 gelato serves", href: "/gelato" });
  });
  it("keeps normal items as their own rows", () => {
    const it = item("plain", { sell_price_inc: 10 });
    const c = costItem(it, buildIndex([], [], []), DEFAULT_SETTINGS, []);
    const groups = checkCostGroups(checkCostRows([c]));
    expect(groups).toEqual([expect.objectContaining({ id: "plain", href: "/items/plain", count: 1 })]);
  });
});

describe("reviewChangesFromImpact", () => {
  it("prices a gelato serve from the worst flavour AFTER the edit", () => {
    const venues = [{ id: 4, slug: "gelato", name: "Gelato Rumba" } as Venue];
    const prep = (id: string): Prep => ({ id, name: `${id} gelato mix`, venue_id: 4, prep_type: "Gelato flavour mix", yield_qty: 1, yield_unit: "kg", active: true, source: null, notes: null });
    const preps = [prep("x"), prep("y")];
    const mk = (xPrice: number) => {
      const ings = [ing("xm", { pack_price: xPrice }), ing("ym", { pack_price: 3 })];
      const ml: RecipeLine[] = [
        { id: "l1", parent_type: "prep", parent_id: "x", component_type: "ingredient", component_id: "xm", qty: 1, unit: "kg", note: null, sort: 1 },
        { id: "l2", parent_type: "prep", parent_id: "y", component_type: "ingredient", component_id: "ym", qty: 1, unit: "kg", note: null, sort: 1 },
      ];
      const serve = { id: "s1", venue_id: 4, name: "Cup", sort: 1, grams: 200, sell_price_inc: 8, on_menu: true, active: true, notes: null } as GelatoServe;
      const g = buildGelato({ venues, preps, items: [], serves: [serve], serveLines: [], wastage: 0, targets: [] });
      const index = buildIndex(ings, preps, [...ml, ...g.lines]);
      return g.items.map((it) => costItem(it, index, DEFAULT_SETTINGS, []));
    };
    const before = mk(3);
    const after = mk(30); // flavour x becomes the dearest
    const impact = after.filter((c) => c.item.id.includes("~x~")).map((c) => ({ after: c }));
    const ch = reviewChangesFromImpact(impact, before, GST);
    expect(ch).toHaveLength(1);
    expect(ch[0].cost.item.id).toBe("gelato~x~s1");
    expect(ch[0].newPrice).toBeGreaterThan(8);
  });
});
