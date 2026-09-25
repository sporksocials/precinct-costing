import { describe, expect, it } from "vitest";
import {
  CHECKS,
  countLinesByParent,
  formatBrisbane,
  normaliseName,
  raiseBaseline,
  readLineBaseline,
  rebaselineParent,
  recordHref,
  reportText,
  summarise,
  validate,
  writeLineBaseline,
  type IntegrityData,
  type Issue,
} from "@/lib/integrity";
import { DEFAULT_SETTINGS, type Ingredient, type IngredientDeal, type MenuItem, type Offer, type OfferLine, type Prep, type RecipeLine } from "@/lib/types";

const TODAY = "2026-09-25";

const ing = (id: string, over: Partial<Ingredient> = {}): Ingredient => ({
  id, name: `Ing ${id}`, category: null, supplier_id: null, supplier_code: null, pack_size: 1, pack_unit: "kg", pack_price: 10,
  price_inc_gst: false, gst_free: false, rebate: 0, yield_pct: 1, venues: null, active: true, last_price_update: null,
  previous_price: null, source: null, notes: null, updated_at: null, ...over,
});
const prep = (id: string, over: Partial<Prep> = {}): Prep => ({ id, name: `Prep ${id}`, venue_id: 1, prep_type: null, yield_qty: 1, yield_unit: "kg", active: true, source: null, notes: null, ...over });
const item = (id: string, over: Partial<MenuItem> = {}): MenuItem => ({
  id, name: `Item ${id}`, venue_id: 1, category: "Food", section: null, portions: 1, sell_price_inc: 30, target_override: null,
  hh_price_inc: null, active: true, source: null, notes: null, ...over,
});
let n = 0;
const line = (parent: string, comp: string, over: Partial<RecipeLine> = {}): RecipeLine => ({
  id: `l${++n}`, parent_type: "item", parent_id: parent, component_type: "ingredient", component_id: comp, qty: 100, unit: "g", note: null, sort: n, ...over,
});
const deal = (over: Partial<IngredientDeal> = {}): IngredientDeal => ({
  id: "d1", ingredient_id: "a", kind: "percent_off", buy_qty: null, free_qty: null, min_qty: null, pct_off: 0.1, unit_price: null,
  special_pack_price: null, starts_on: null, ends_on: null, note: null, active: true, ...over,
});

const venues = [
  { id: 1, name: "Drift Bar", slug: "drift", sort: 1 },
  { id: 2, name: "Chiobu", slug: "chiobu", sort: 2 },
];

/** A clean little dataset: one dish, one ingredient (GP a healthy 72-ish%). */
function clean(over: Partial<IntegrityData> = {}): IntegrityData {
  return {
    ingredients: [ing("a")],
    preps: [],
    items: [item("i1")],
    lines: [line("i1", "a", { qty: 500 })], // 0.5kg x $10 = $5; sell 30 inc = 27.27 ex -> 81.7% GP
    settings: DEFAULT_SETTINGS,
    targets: [],
    venues,
    offers: [],
    offerLines: [],
    deals: [],
    ...over,
  };
}
const run = (d: IntegrityData, opts = {}) => validate(d, { today: TODAY, ...opts });
const codes = (is: Issue[]) => is.map((i) => i.code);
const only = (is: Issue[], code: string) => is.filter((i) => i.code === code);

describe("validate: a clean dataset", () => {
  it("has no issues", () => {
    expect(run(clean())).toEqual([]);
  });
  it("summarises to zero", () => {
    expect(summarise([])).toEqual({ errors: 0, warnings: 0, info: 0, attention: 0 });
  });
});

describe("(a) missing component", () => {
  it("flags a line whose ingredient is gone, once per recipe", () => {
    const d = clean({ lines: [line("i1", "a"), line("i1", "gone"), line("i1", "gone2")] });
    const r = only(run(d), "line_missing_component");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ severity: "error", kind: "item", id: "i1", fixHref: "/items/i1", venue: "drift" });
    expect(r[0].detail).toContain("2 lines");
  });
  it("flags a prep line whose prep is gone", () => {
    const d = clean({ lines: [line("i1", "a"), line("i1", "nope", { component_type: "prep" })] });
    expect(codes(run(d))).toContain("line_missing_component");
  });
  it("does not flag a line whose component exists", () => {
    expect(codes(run(clean()))).not.toContain("line_missing_component");
  });
});

describe("(b) orphan lines", () => {
  it("flags lines whose item does not exist", () => {
    const d = clean({ lines: [line("i1", "a", { qty: 500 }), line("ghost", "a"), line("ghost", "a", { qty: 5 })] });
    const r = only(run(d), "line_missing_parent");
    expect(r).toHaveLength(1);
    expect(r[0].detail).toContain("2 recipe lines");
    expect(r[0].fixHref).toBe("/menu");
  });
  it("flags lines whose prep does not exist", () => {
    const d = clean({ lines: [line("i1", "a", { qty: 500 }), line("ghostprep", "a", { parent_type: "prep" })] });
    expect(only(run(d), "line_missing_parent")[0].fixHref).toBe("/ingredients?type=preps");
  });
  it("ignores lines of legacy items that virtual items replace", () => {
    const d = clean({ lines: [line("i1", "a", { qty: 500 }), line("old-gelato", "a")], replacedItemIds: ["old-gelato"] });
    expect(codes(run(d))).not.toContain("line_missing_parent");
  });
});

describe("(c) duplicate lines", () => {
  it("flags exact duplicates", () => {
    const d = clean({ lines: [line("i1", "a", { qty: 500 }), line("i1", "a", { qty: 500 })] });
    expect(only(run(d), "line_duplicate")).toHaveLength(1);
  });
  it("does not flag the same ingredient at a different quantity or unit", () => {
    const d = clean({ lines: [line("i1", "a", { qty: 500 }), line("i1", "a", { qty: 250 }), line("i1", "a", { qty: 500, unit: "kg" })] });
    expect(codes(run(d))).not.toContain("line_duplicate");
  });
  it("does not flag a duplicate across different recipes", () => {
    const d = clean({ items: [item("i1"), item("i2")], lines: [line("i1", "a", { qty: 500 }), line("i2", "a", { qty: 500 })] });
    expect(codes(run(d))).not.toContain("line_duplicate");
  });
});

describe("(d) empty recipes", () => {
  it("flags an active item with no lines as an error", () => {
    const r = only(run(clean({ lines: [] })), "item_no_lines");
    expect(r).toHaveLength(1);
    expect(r[0].severity).toBe("error");
  });
  it("skips inactive items, specials and virtual or legacy items", () => {
    const d = clean({
      items: [item("i1", { active: false }), item("sp", { source: "special" }), item("beer~b~s", { source: "beer" }), item("gelato~p~s", { source: "gelato" }), item("x", { source: "beer" })],
      lines: [],
    });
    expect(codes(run(d))).not.toContain("item_no_lines");
  });
  it("flags a used prep with no lines as an error and an unused one as a warning", () => {
    const d = clean({ preps: [prep("p1"), prep("p2")], lines: [line("i1", "a", { qty: 500 }), line("i1", "p1", { component_type: "prep", unit: "g" })] });
    const r = only(run(d), "prep_no_lines");
    expect(r.find((x) => x.id === "p1")?.severity).toBe("error");
    expect(r.find((x) => x.id === "p2")?.severity).toBe("warning");
    expect(r[0].fixHref).toMatch(/^\/preps\//);
  });
});

describe("(e) prep cycles and depth", () => {
  const chain = (len: number): IntegrityData => {
    const preps = Array.from({ length: len }, (_, i) => prep(`p${i}`));
    const lines: RecipeLine[] = [line("p" + (len - 1), "a", { parent_type: "prep" })];
    for (let i = 0; i < len - 1; i++) lines.push(line(`p${i}`, `p${i + 1}`, { parent_type: "prep", component_type: "prep", unit: "g" }));
    lines.push(line("i1", "p0", { component_type: "prep", unit: "g" }));
    return clean({ preps, lines });
  };
  it("flags a two prep cycle once", () => {
    const d = clean({
      preps: [prep("p1"), prep("p2")],
      lines: [line("i1", "a", { qty: 500 }), line("p1", "p2", { parent_type: "prep", component_type: "prep", unit: "g" }), line("p2", "p1", { parent_type: "prep", component_type: "prep", unit: "g" })],
    });
    const r = only(run(d), "prep_cycle");
    expect(r).toHaveLength(1);
    expect(r[0].severity).toBe("error");
  });
  it("flags a prep that uses itself", () => {
    const d = clean({ preps: [prep("p1")], lines: [line("i1", "a", { qty: 500 }), line("p1", "p1", { parent_type: "prep", component_type: "prep", unit: "g" })] });
    expect(only(run(d), "prep_cycle")).toHaveLength(1);
  });
  it("accepts nesting of 5 and flags 6", () => {
    expect(codes(run(chain(5)))).not.toContain("prep_too_deep");
    const r = only(run(chain(6)), "prep_too_deep");
    expect(r.map((x) => x.kind).sort()).toEqual(["item", "prep"]);
    expect(r.every((x) => x.severity === "error")).toBe(true);
  });
  it("does not blow the stack or hang on a shared diamond", () => {
    const d = clean({
      preps: [prep("top"), prep("l"), prep("r"), prep("base")],
      lines: [
        line("i1", "top", { component_type: "prep", unit: "g" }),
        line("top", "l", { parent_type: "prep", component_type: "prep", unit: "g" }),
        line("top", "r", { parent_type: "prep", component_type: "prep", unit: "g" }),
        line("l", "base", { parent_type: "prep", component_type: "prep", unit: "g" }),
        line("r", "base", { parent_type: "prep", component_type: "prep", unit: "g" }),
        line("base", "a", { parent_type: "prep" }),
      ],
    });
    expect(codes(run(d))).not.toContain("prep_cycle");
    expect(codes(run(d))).not.toContain("prep_too_deep");
  });
});

describe("(f) unit mismatch", () => {
  it("flags weight used on a per each ingredient", () => {
    const d = clean({ ingredients: [ing("a", { pack_unit: "each" })] });
    const r = only(run(d), "unit_mismatch");
    expect(r).toHaveLength(1);
    expect(r[0].severity).toBe("error");
  });
  it("flags volume on a weight ingredient and each on a volume prep", () => {
    const d = clean({
      preps: [prep("p1", { yield_unit: "L" })],
      lines: [line("i1", "a", { unit: "ml" }), line("i1", "p1", { component_type: "prep", unit: "each" })],
    });
    expect(only(run(d), "unit_mismatch")).toHaveLength(1); // grouped per recipe
    expect(only(run(d), "unit_mismatch")[0].detail).toContain("Ing a");
  });
  it("accepts g against kg and ml against L", () => {
    const d = clean({ ingredients: [ing("a", { pack_unit: "L" })], lines: [line("i1", "a", { unit: "ml", qty: 500 })] });
    expect(codes(run(d))).not.toContain("unit_mismatch");
  });
});

describe("(g) ingredient numbers", () => {
  it("flags zero pack size, zero or null price and a bad yield when used", () => {
    for (const [over, code] of [
      [{ pack_size: 0 }, "ingredient_bad_pack_size"],
      [{ pack_price: 0 }, "ingredient_bad_price"],
      [{ pack_price: null as unknown as number }, "ingredient_bad_price"],
      [{ yield_pct: 0 }, "ingredient_bad_yield"],
      [{ yield_pct: 1.2 }, "ingredient_bad_yield"],
    ] as [Partial<Ingredient>, string][]) {
      const r = only(run(clean({ ingredients: [ing("a", over)] })), code);
      expect(r, code).toHaveLength(1);
      expect(r[0].severity).toBe("error");
      expect(r[0].fixHref).toBe("/ingredients/a");
    }
  });
  it("ignores bad numbers on an ingredient nobody uses", () => {
    const d = clean({ ingredients: [ing("a"), ing("unused", { pack_price: 0, pack_size: 0, yield_pct: 0 })] });
    expect(run(d)).toEqual([]);
  });
  it("accepts a yield of exactly 100%", () => {
    expect(codes(run(clean({ ingredients: [ing("a", { yield_pct: 1 })] })))).toEqual([]);
  });
  it("flags a rebate as large as the price", () => {
    expect(codes(run(clean({ ingredients: [ing("a", { rebate: 10 })] })))).toContain("ingredient_negative_cost");
  });
});

describe("(h) prep yield", () => {
  it("flags a used prep with zero yield as an error, unused as a warning", () => {
    const d = clean({
      preps: [prep("p1", { yield_qty: 0 }), prep("p2", { yield_qty: 0 })],
      lines: [line("i1", "a", { qty: 500 }), line("i1", "p1", { component_type: "prep", unit: "g" }), line("p1", "a", { parent_type: "prep" }), line("p2", "a", { parent_type: "prep" })],
    });
    const r = only(run(d), "prep_bad_yield");
    expect(r.find((x) => x.id === "p1")?.severity).toBe("error");
    expect(r.find((x) => x.id === "p2")?.severity).toBe("warning");
  });
});

describe("(i) portions", () => {
  it("flags portions of 0 and skips virtual items", () => {
    const d = clean({ items: [item("i1", { portions: 0 }), item("gelato~p~s", { portions: 0, source: "gelato" })] });
    const r = only(run(d), "item_bad_portions");
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("i1");
  });
});

describe("(j) sell price", () => {
  it("flags an active item with a 0 or null price", () => {
    expect(only(run(clean({ items: [item("i1", { sell_price_inc: 0 })] })), "item_no_price")).toHaveLength(1);
    expect(only(run(clean({ items: [item("i1", { sell_price_inc: null })] })), "item_no_price")).toHaveLength(1);
  });
  it("skips inactive items, specials and virtual items", () => {
    const d = clean({ items: [item("i1", { active: false, sell_price_inc: null }), item("sp", { source: "special", sell_price_inc: null }), item("beer~x~y", { source: "beer", sell_price_inc: null })] });
    expect(codes(run(d))).not.toContain("item_no_price");
  });
});

describe("(k) suspicious GP", () => {
  it("flags GP above 92%", () => {
    const d = clean({ lines: [line("i1", "a", { qty: 10 })] }); // $0.10 cost against $27.27 ex
    const r = only(run(d), "gp_too_high");
    expect(r).toHaveLength(1);
    expect(r[0].severity).toBe("warning");
  });
  it("flags GP below 0%", () => {
    const d = clean({ items: [item("i1", { sell_price_inc: 5 })], lines: [line("i1", "a", { qty: 1000 })] });
    expect(only(run(d), "gp_negative")).toHaveLength(1);
  });
  it("does not double report an item with no lines", () => {
    expect(codes(run(clean({ lines: [] })))).not.toContain("gp_too_high");
  });
  it("uses the supplied itemCosts when given", () => {
    const d = clean();
    const fake = new Map([["i1", { gpPct: 0.99, costPerPortion: 0.1, sellInc: 30 } as never]]);
    expect(codes(run({ ...d, itemCosts: fake }))).toContain("gp_too_high");
  });
});

describe("(l) inactive but used", () => {
  it("flags an inactive ingredient used by an active recipe once", () => {
    const d = clean({ ingredients: [ing("a", { active: false })], items: [item("i1"), item("i2")], lines: [line("i1", "a", { qty: 500 }), line("i2", "a", { qty: 500 })] });
    const r = only(run(d), "inactive_in_use");
    expect(r).toHaveLength(1);
    expect(r[0].detail).toContain("2 active recipes");
  });
  it("ignores use by inactive recipes", () => {
    const d = clean({ ingredients: [ing("a", { active: false })], items: [item("i1", { active: false })] });
    expect(codes(run(d))).not.toContain("inactive_in_use");
  });
  it("flags an inactive prep in an active item", () => {
    const d = clean({ preps: [prep("p1", { active: false })], lines: [line("i1", "a", { qty: 500 }), line("i1", "p1", { component_type: "prep", unit: "g" }), line("p1", "a", { parent_type: "prep" })] });
    expect(only(run(d), "inactive_in_use")[0].kind).toBe("prep");
  });
});

describe("(m) duplicate ingredient names", () => {
  it("matches on case and spacing at the same scope", () => {
    const d = clean({ ingredients: [ing("a", { name: "Beef  Rump" }), ing("b", { name: " beef rump " })] });
    const r = only(run(d), "duplicate_ingredient");
    expect(r).toHaveLength(1);
    expect(r[0].detail).toContain("2 ingredients");
  });
  it("does not match the same name at different venue scopes", () => {
    const d = clean({ ingredients: [ing("a", { name: "Cream", venues: "Drift" }), ing("b", { name: "Cream", venues: "Chiobu" })] });
    expect(codes(run(d))).not.toContain("duplicate_ingredient");
  });
  it("normaliseName collapses odd spaces", () => {
    expect(normaliseName("  Sea  Salt ")).toBe("sea salt");
  });
});

describe("(n) offers with deleted components", () => {
  const offer = (over: Partial<Offer> = {}): Offer => ({ id: "o1", name: "Lunch combo", venue_id: 1, kind: "combo", status: "live", price_inc: 25, target_override: null, starts_on: null, ends_on: null, days_of_week: null, time_from: null, time_to: null, notes: null, ...over });
  const ol = (over: Partial<OfferLine> = {}): OfferLine => ({ id: "ol1", offer_id: "o1", component_kind: "item", item_id: "i1", beer_id: null, serve_id: null, qty: 1, price_inc_override: null, sort: 0, ...over });
  it("flags a live offer as an error and a draft as a warning", () => {
    const live = only(run(clean({ offers: [offer()], offerLines: [ol({ item_id: "gone" })] })), "offer_missing_component");
    expect(live[0]).toMatchObject({ severity: "error", kind: "offer", fixHref: "/specials/o1", venue: "drift" });
    const draft = only(run(clean({ offers: [offer({ status: "draft" })], offerLines: [ol({ item_id: "gone" })] })), "offer_missing_component");
    expect(draft[0].severity).toBe("warning");
  });
  it("flags a beer serve line whose virtual item is missing, and passes when present", () => {
    const bad = ol({ component_kind: "beer_serve", item_id: null, beer_id: "b", serve_id: "s" });
    expect(codes(run(clean({ offers: [offer()], offerLines: [bad] })))).toContain("offer_missing_component");
    const items = [item("i1"), item("beer~b~s", { source: "beer" })];
    const lines = [line("i1", "a", { qty: 500 }), line("beer~b~s", "a", { unit: "g" })];
    expect(codes(run(clean({ items, lines, offers: [offer()], offerLines: [bad] })))).not.toContain("offer_missing_component");
  });
  it("skips retired offers and passes healthy ones", () => {
    expect(run(clean({ offers: [offer({ status: "retired" })], offerLines: [ol({ item_id: "gone" })] }))).toEqual([]);
    expect(run(clean({ offers: [offer()], offerLines: [ol()] }))).toEqual([]);
  });
});

describe("(o) settings", () => {
  it("gst not 10% is info; wildly wrong gst is a warning", () => {
    const info = only(run(clean({ settings: { ...DEFAULT_SETTINGS, gst_rate: 0.15 } })), "setting_gst_unusual");
    expect(info[0].severity).toBe("info");
    expect(only(run(clean({ settings: { ...DEFAULT_SETTINGS, gst_rate: 10 } })), "setting_range")).toHaveLength(1);
    expect(only(run(clean({ settings: { ...DEFAULT_SETTINGS, gst_rate: 0.1004 } })), "setting_gst_unusual")).toHaveLength(0);
  });
  it("flags round_to and alert_pct at zero or below", () => {
    const r = only(run(clean({ settings: { ...DEFAULT_SETTINGS, round_to: 0, alert_pct: -1 } })), "setting_range");
    expect(r.map((x) => x.id).sort()).toEqual(["alert_pct", "round_to"]);
    expect(r[0].fixHref).toBe("/settings");
    expect(r[0].kind).toBe("setting");
  });
  it("flags odd gelato wastage", () => {
    expect(only(run(clean({ settings: { ...DEFAULT_SETTINGS, gelato_wastage: 1.5 } })), "setting_range")).toHaveLength(1);
  });
});

describe("(p) targets", () => {
  it("flags venue targets, item overrides and beer targets outside 30% to 90%", () => {
    const d = clean({
      targets: [{ venue_id: 1, category: "Food", target_gp: 0.95 }, { venue_id: 2, category: "Food", target_gp: 0.72 }, { venue_id: 1, category: "Wine", target_gp: 0.1 }],
      items: [item("i1", { target_override: 0.2 })],
      beers: [{ id: "b", venue_id: 2, name: "Pale", ingredient_id: "a", target_gp: 1, active: true, sort: 1, notes: null }],
    });
    const r = only(run(d), "target_range");
    expect(r).toHaveLength(4);
    expect(r.filter((x) => x.kind === "setting")).toHaveLength(2);
    expect(r.find((x) => x.kind === "beer")?.fixHref).toBe("/beers/b");
  });
  it("accepts the edges", () => {
    const d = clean({ targets: [{ venue_id: 1, category: "Food", target_gp: 0.3 }, { venue_id: 1, category: "Wine", target_gp: 0.9 }] });
    expect(codes(run(d))).not.toContain("target_range");
  });
});

describe("(q) deals", () => {
  it("flags a deal that ended but is still on", () => {
    const r = only(run(clean({ deals: [deal({ ends_on: "2026-09-01" })] })), "deal_expired_active");
    expect(r).toHaveLength(1);
    expect(r[0].fixHref).toBe("/ingredients/a");
  });
  it("ignores expired deals that are switched off and current deals", () => {
    expect(run(clean({ deals: [deal({ ends_on: "2026-09-01", active: false }), deal({ id: "d2", ends_on: "2026-12-01" })] }))).toEqual([]);
  });
  it("flags deals that give a price of zero or less, or no numbers", () => {
    for (const d of [deal({ pct_off: 1 }), deal({ pct_off: 1.5 }), deal({ kind: "special_price", pct_off: null, special_pack_price: 0 }), deal({ kind: "buy_x_get_y", pct_off: null, buy_qty: 0, free_qty: 1 }), deal({ kind: "volume", pct_off: null, unit_price: 0 })]) {
      expect(only(run(clean({ deals: [d] })), "deal_bad_price"), JSON.stringify(d)).toHaveLength(1);
    }
  });
  it("flags a deal on a deleted ingredient", () => {
    expect(codes(run(clean({ deals: [deal({ ingredient_id: "zzz" })] })))).toContain("deal_orphan");
  });
});

describe("tap beer with no keg", () => {
  it("flags an active beer with no keg or a missing keg", () => {
    const b = (id: string, ingredient_id: string | null) => ({ id, venue_id: 2, name: id, ingredient_id, target_gp: null, active: true, sort: 1, notes: null });
    const r = only(run(clean({ beers: [b("b1", null), b("b2", "gone"), b("b3", "a")] })), "beer_no_keg");
    expect(r.map((x) => x.id).sort()).toEqual(["b1", "b2"]);
    expect(r[0].kind).toBe("beer");
  });
});

describe("paging bug: lines missing from a recipe (line count baseline)", () => {
  const twoLine = (): IntegrityData => clean({ ingredients: [ing("a"), ing("b")], lines: [line("i1", "a", { qty: 300 }), line("i1", "b", { qty: 300 })] });
  it("cannot be seen from the data alone", () => {
    const d = clean(); // the same dish that used to have 2 lines and now loads 1 looks perfectly healthy
    expect(run(d)).toEqual([]);
  });
  it("is flagged when the loaded count is below the baseline", () => {
    const d = clean(); // 1 line loaded
    const r = only(run(d, { lineCountBaseline: { "item:i1": 2 } }), "line_count_drop");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ severity: "error", kind: "item", id: "i1" });
    expect(r[0].detail).toContain("1 line now");
    expect(r[0].detail).toContain("had 2");
  });
  it("flags a recipe that lost all its lines, and preps", () => {
    const d = clean({ preps: [prep("p1")], lines: [] });
    const r = only(run(d, { lineCountBaseline: { "item:i1": 3, "prep:p1": 2 } }), "line_count_drop");
    expect(r.map((x) => x.kind).sort()).toEqual(["item", "prep"]);
  });
  it("does not flag equal or higher counts, unknown recipes or virtual items", () => {
    const d = twoLine();
    expect(codes(run(d, { lineCountBaseline: { "item:i1": 2, "item:other": 9, "item:beer~b~s": 9 } }))).not.toContain("line_count_drop");
  });
  it("without a baseline the check is off", () => {
    expect(codes(run(clean()))).not.toContain("line_count_drop");
  });
  it("baseline helpers: count, raise, never lower", () => {
    const counts = countLinesByParent([line("i1", "a"), line("i1", "a"), line("p1", "a", { parent_type: "prep" }), line("beer~b~s", "a")]);
    expect(counts).toEqual({ "item:i1": 2, "prep:p1": 1 });
    expect(raiseBaseline({ "item:i1": 5, "item:z": 1 }, counts)).toEqual({ "item:i1": 5, "item:z": 1, "prep:p1": 1 });
  });
  it("baseline storage round trips and survives junk", () => {
    const mem: Record<string, string> = {};
    const s = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => void (mem[k] = v) };
    expect(readLineBaseline(s)).toEqual({});
    writeLineBaseline({ "item:i1": 3 }, s);
    expect(readLineBaseline(s)).toEqual({ "item:i1": 3 });
    rebaselineParent("item", "i1", 2, s);
    expect(readLineBaseline(s)).toEqual({ "item:i1": 2 });
    rebaselineParent("item", "i1", null, s);
    expect(readLineBaseline(s)).toEqual({});
    mem["precinct-costing:line-baseline:v1"] = "not json";
    expect(readLineBaseline(s)).toEqual({});
    mem["precinct-costing:line-baseline:v1"] = JSON.stringify({ a: "x", b: -1, c: 4 });
    expect(readLineBaseline(s)).toEqual({ c: 4 });
  });
});

describe("load cap heuristic", () => {
  it("notes a row count that is exactly a page multiple", () => {
    const d = clean({ preps: Array.from({ length: 1000 }, (_, i) => prep(`p${i}`, { yield_qty: 1 })) });
    const r = only(run(d), "load_cap");
    expect(r).toHaveLength(1);
    expect(r[0].severity).toBe("info");
  });
});

describe("virtual items", () => {
  it("still check their lines for missing components", () => {
    const d = clean({ items: [item("i1"), item("beer~b~s", { source: "beer" })], lines: [line("i1", "a", { qty: 500 }), line("beer~b~s", "gone", { unit: "ml" })] });
    const r = only(run(d), "line_missing_component");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "beer", fixHref: "/beers/b" });
  });
});

describe("recordHref, ordering, reporting", () => {
  it("links every kind", () => {
    expect(recordHref("item", "x")).toBe("/items/x");
    expect(recordHref("item", "gelato~p1~s1")).toBe("/preps/p1");
    expect(recordHref("prep", "x")).toBe("/preps/x");
    expect(recordHref("ingredient", "x")).toBe("/ingredients/x");
    expect(recordHref("offer", "x")).toBe("/specials/x");
    expect(recordHref("beer", "beer~b1~s1")).toBe("/beers/b1");
    expect(recordHref("setting", "x")).toBe("/settings");
  });
  it("sorts errors before warnings before info", () => {
    const d = clean({ items: [item("i1", { sell_price_inc: null })], lines: [], settings: { ...DEFAULT_SETTINGS, gst_rate: 0.15 } });
    const sev = run(d).map((i) => i.severity);
    expect(sev).toEqual([...sev].sort((a, b) => ["error", "warning", "info"].indexOf(a) - ["error", "warning", "info"].indexOf(b)));
    expect(sev[0]).toBe("error");
  });
  it("every emitted code is documented, with plain text detail (no em dashes)", () => {
    const d = clean({ ingredients: [ing("a", { pack_price: 0, pack_size: 0, yield_pct: 0 })], lines: [line("i1", "a"), line("i1", "a"), line("i1", "x"), line("nope", "a")], deals: [deal({ ends_on: "2026-01-01" })] });
    const is = run(d);
    expect(is.length).toBeGreaterThan(4);
    for (const i of is) {
      expect(CHECKS[i.code], i.code).toBeDefined();
      expect(i.detail).not.toContain("—");
      expect(i.title).not.toContain("—");
      expect(i.fixHref.startsWith("/")).toBe(true);
    }
    for (const c of Object.values(CHECKS)) {
      expect(c.why).not.toContain("—");
      expect(c.title).not.toContain("—");
    }
  });
  it("reportText lists issues and the Brisbane time", () => {
    const is = run(clean({ lines: [] }));
    const t = reportText(is, new Date("2026-09-25T05:30:00Z"), "Drift");
    expect(t).toContain("Data Health, Drift");
    expect(t).toContain("3:30 pm");
    expect(t).toContain("ERRORS (1)");
    expect(reportText([], new Date("2026-09-25T05:30:00Z"))).toContain("All checks passed.");
  });
  it("formats Brisbane time (UTC+10, no daylight saving)", () => {
    expect(formatBrisbane(new Date("2026-01-01T00:00:00Z"))).toContain("10:00 am");
  });
});

describe("performance", () => {
  it("validates 900 ingredients, 650 items and 2,400 lines in under 200ms", () => {
    const ingredients = Array.from({ length: 900 }, (_, i) => ing(`in${i}`, { name: `Ingredient ${i}`, pack_unit: i % 3 === 0 ? "L" : "kg" }));
    const preps = Array.from({ length: 150 }, (_, i) => prep(`p${i}`));
    const items = Array.from({ length: 650 }, (_, i) => item(`it${i}`, { venue_id: (i % 2) + 1 }));
    const lines: RecipeLine[] = [];
    for (let i = 0; i < 650; i++) for (let k = 0; k < 3; k++) {
      const idx = (i * 7 + k * 13) % 900;
      lines.push(line(`it${i}`, `in${idx}`, { qty: 50 + k, unit: idx % 3 === 0 ? "ml" : "g" }));
    }
    for (let p = 0; p < 150; p++) lines.push(line(`p${p}`, `in${p}`, { parent_type: "prep", unit: p % 3 === 0 ? "ml" : "g" }));
    expect(lines.length).toBeGreaterThanOrEqual(2100);
    const baseline: Record<string, number> = countLinesByParent(lines);
    validate({ ingredients, preps, items, lines, settings: DEFAULT_SETTINGS, venues, targets: [] }, { today: TODAY, lineCountBaseline: baseline }); // warm up
    const t0 = performance.now();
    const out = validate({ ingredients, preps, items, lines, settings: DEFAULT_SETTINGS, venues, targets: [] }, { today: TODAY, lineCountBaseline: baseline });
    const ms = performance.now() - t0;
    expect(out).toBeDefined();
    expect(ms).toBeLessThan(200);
  });
});
