import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { buildIndex, costItem } from "@/lib/costing";
import { describeOptionDiff, optionCost, optionLines, staleLeftOut } from "@/lib/diet-option-cost";
import { copyDietOptions, hasSwap, optionText, printedMarks, markOff, markOn, optionOnClearsMark, pruneStaleRemoved, readMarks, readOption, readOptions, swapSentence, swapWords } from "@/lib/diet-options";
import { DEFAULT_SETTINGS, type Ingredient, type MenuItem, type Prep, type RecipeLine, type Target } from "@/lib/types";

/* a small world with round numbers: cost per recipe line is easy to check by hand */
const ing = (id: string, name: string, pack_unit: Ingredient["pack_unit"], pack_price: number, over: Partial<Ingredient> = {}): Ingredient => ({
  id, name, category: "Food", supplier_id: null, supplier_code: null, pack_size: 1, pack_unit, pack_price, price_inc_gst: false, gst_free: false, rebate: 0, yield_pct: 1, venues: "All", active: true, last_price_update: null, previous_price: null, source: null, notes: null, updated_at: null, ...over,
});
const BUN = ing("bun", "Brioche Bun", "each", 2); //        $2.00 each
const PATTY = ing("patty", "Beef Patty", "kg", 20); //       $20 per kg: 180 g = $3.60
const SOY = ing("soy", "Soy Sauce", "L", 10); //             $10 per L: 20 ml = $0.20
const TAMARI = ing("tamari", "Tamari", "L", 30); //          $30 per L: 15 ml = $0.45
const GFBUN = ing("gfbun", "Gluten Free Bun", "each", 3.5); // $3.50 each
const OAT = ing("oat", "Oat Milk", "L", 4);

const dish = (over: Partial<MenuItem> = {}): MenuItem => ({ id: "d", name: "Burger", venue_id: 1, category: "Food", section: "Burgers", portions: 1, sell_price_inc: 24, target_override: null, hh_price_inc: null, active: true, source: null, notes: null, ...over });
const L = (id: string, component_id: string, qty: number, unit: RecipeLine["unit"], component_type: RecipeLine["component_type"] = "ingredient"): RecipeLine => ({ id, parent_type: "item", parent_id: "d", component_type, component_id, qty, unit, note: null, sort: Number(id.replace(/\D/g, "")) || 1 });
const LINES = [L("l1", "bun", 1, "each"), L("l2", "patty", 180, "g"), L("l3", "soy", 20, "ml")]; // standard cost $5.80
const TARGETS: Target[] = [{ venue_id: 1, category: "Food", target_gp: 0.72 } as Target];

function ctx(extra: { ings?: Ingredient[]; preps?: Prep[]; lines?: RecipeLine[] } = {}) {
  const lines = extra.lines ?? LINES;
  const index = buildIndex([BUN, PATTY, SOY, TAMARI, GFBUN, OAT, ...(extra.ings ?? [])], extra.preps ?? [], lines);
  return { index, settings: DEFAULT_SETTINGS, targets: TARGETS };
}
const GFO = { note: "GF bun, tamari for soy", removed: ["l1", "l3"], added: [{ component_type: "ingredient", component_id: "gfbun", qty: 1, unit: "each" }, { component_type: "ingredient", component_id: "tamari", qty: 15, unit: "ml" }] };

describe("option lines", () => {
  it("is the dish's lines minus the left out ones, plus the added ones, and never touches the input", () => {
    const before = JSON.stringify(LINES);
    const out = optionLines(dish(), LINES, GFO);
    expect(out.map((l) => l.component_id)).toEqual(["patty", "gfbun", "tamari"]);
    expect(JSON.stringify(LINES)).toBe(before);
  });
  it("an option with only a note is the dish's own lines", () => {
    expect(optionLines(dish(), LINES, { note: "x" }).map((l) => l.id)).toEqual(["l1", "l2", "l3"]);
    expect(optionLines(dish(), LINES, null).map((l) => l.id)).toEqual(["l1", "l2", "l3"]);
  });
  it("a stale left-out id is ignored", () => {
    const o = { note: "x", removed: ["gone", "l2"] };
    expect(optionLines(dish(), LINES, o).map((l) => l.id)).toEqual(["l1", "l3"]);
    expect(staleLeftOut(LINES, o)).toEqual(["gone"]);
  });
});

describe("option cost", () => {
  it("costs the standard dish exactly as the dish is costed", () => {
    const oc = optionCost(dish(), LINES, GFO, ctx())!;
    const std = costItem(dish(), ctx().index, DEFAULT_SETTINGS, TARGETS, new Map(), LINES);
    expect(oc.standard.costPerPortion).toBeCloseTo(std.costPerPortion, 10);
    expect(oc.standard.costPerPortion).toBeCloseTo(5.8, 6);
  });

  it("left out and added lines change the cost; the difference to the standard dish is exact", () => {
    const oc = optionCost(dish(), LINES, GFO, ctx())!;
    // patty 3.60 + gluten free bun 3.50 + tamari 0.45
    expect(oc.costPerPortion).toBeCloseTo(7.55, 6);
    expect(oc.costDiff).toBeCloseTo(1.75, 6);
    expect(oc.sameAsStandard).toBe(false);
    expect(oc.leftOutCount).toBe(2);
  });

  it("price is the sell price plus the surcharge, and GP is worked out against that price", () => {
    const oc = optionCost(dish(), LINES, { ...GFO, surcharge_inc: 2 }, ctx())!;
    expect(oc.priceInc).toBe(26);
    expect(oc.priceEx).toBeCloseTo(26 / 1.1, 8);
    expect(oc.gpPct).toBeCloseTo((26 / 1.1 - 7.55) / (26 / 1.1), 8);
    // the standard dish keeps its own price and GP
    expect(oc.standard.sellInc).toBe(24);
    expect(oc.gpDiff).toBeCloseTo((oc.gpPct as number) - (oc.standard.gpPct as number), 10);
  });

  it("no surcharge (blank, null, zero, junk) means the same price as the dish", () => {
    for (const s of [undefined, null, 0, "", "abc", -3]) {
      const oc = optionCost(dish(), LINES, { ...GFO, surcharge_inc: s }, ctx())!;
      expect(oc.priceInc).toBe(24);
      expect(oc.surcharge).toBe(0);
    }
  });

  it("a dish with no sell price has no GP for the option, but still has a cost", () => {
    for (const sell of [null, 0]) {
      const oc = optionCost(dish({ sell_price_inc: sell }), LINES, { ...GFO, surcharge_inc: 2 }, ctx())!;
      expect(oc.priceInc).toBeNull();
      expect(oc.gpPct).toBeNull();
      expect(oc.gpDiff).toBeNull();
      expect(oc.costPerPortion).toBeCloseTo(7.55, 6);
    }
  });

  it("an option with nothing left out or added costs the same as the dish", () => {
    const oc = optionCost(dish(), LINES, { note: "No cheese" }, ctx())!;
    expect(oc.sameAsStandard).toBe(true);
    expect(oc.costPerPortion).toBeCloseTo(oc.standard.costPerPortion, 10);
    expect(oc.gpPct).toBeCloseTo(oc.standard.gpPct as number, 10);
    expect(describeOptionDiff(oc, (n) => `$${n.toFixed(2)}`).same).toBe(true);
  });

  it("a surcharge alone is not 'the same as the standard dish'", () => {
    const oc = optionCost(dish(), LINES, { note: "x", surcharge_inc: 1 }, ctx())!;
    expect(oc.sameAsStandard).toBe(false);
    const d = describeOptionDiff(oc, (n) => `$${n.toFixed(2)}`);
    expect(d.cost).toBe("Same cost as the standard dish");
    expect(d.gp).toMatch(/^GP [\d.]+ points? higher$/);
  });

  it("stale left-out ids are ignored in the cost", () => {
    const oc = optionCost(dish(), LINES, { note: "x", removed: ["gone"] }, ctx())!;
    expect(oc.costPerPortion).toBeCloseTo(5.8, 6);
    expect(oc.leftOutCount).toBe(0);
    expect(oc.sameAsStandard).toBe(true);
    expect(oc.notes.join(" ")).toMatch(/removed from the dish/);
  });

  it("an added component that no longer exists costs nothing and says so; an inactive one still costs normally", () => {
    const missing = optionCost(dish(), LINES, { note: "x", added: [{ component_type: "ingredient", component_id: "nope", qty: 1, unit: "each" }] }, ctx())!;
    expect(missing.costPerPortion).toBeCloseTo(5.8, 6);
    expect(missing.notes.join(" ")).toMatch(/no longer exists/);
    const inactive = ing("oldtamari", "Old Tamari", "L", 50, { active: false });
    const oc = optionCost(dish(), LINES, { note: "x", added: [{ component_type: "ingredient", component_id: "oldtamari", qty: 10, unit: "ml" }] }, ctx({ ings: [inactive] }))!;
    expect(oc.costPerPortion).toBeCloseTo(5.8 + 0.5, 6);
    expect(oc.notes.join(" ")).toMatch(/Old Tamari is inactive, but it still costs normally/);
  });

  it("a nested prep, added to the option, is costed through the shared engine and follows a price change", () => {
    // prep "Dressing": 1 kg of oat milk-ish base (2 L oat milk = $8) yields 2 kg => $4/kg
    const dressing: Prep = { id: "dr", name: "Dressing", venue_id: 1, prep_type: "Sauces", yield_qty: 2, yield_unit: "kg", active: true, source: null, notes: null } as Prep;
    const prepLine: RecipeLine = { id: "p1", parent_type: "prep", parent_id: "dr", component_type: "ingredient", component_id: "oat", qty: 2, unit: "L", note: null, sort: 1 };
    const opt = { note: "x", added: [{ component_type: "prep", component_id: "dr", qty: 100, unit: "g" }] };
    const run = (oatPrice: number) => {
      const index = buildIndex([BUN, PATTY, SOY, { ...OAT, pack_price: oatPrice }], [dressing], [...LINES, prepLine]);
      return optionCost(dish(), LINES, opt, { index, settings: DEFAULT_SETTINGS, targets: TARGETS })!;
    };
    // 100 g of a $4/kg prep = $0.40
    expect(run(4).costPerPortion).toBeCloseTo(5.8 + 0.4, 6);
    // oat milk price doubles, so the prep ($8/kg) and the option cost move with it
    expect(run(8).costPerPortion).toBeCloseTo(5.8 + 0.8, 6);
  });

  it("zero cost lines in an option do not break anything", () => {
    const free = ing("water", "Water", "L", 0);
    const oc = optionCost(dish(), LINES, { note: "x", added: [{ component_type: "ingredient", component_id: "water", qty: 50, unit: "ml" }] }, ctx({ ings: [free] }))!;
    expect(oc.costPerPortion).toBeCloseTo(5.8, 6);
  });

  it("an ingredient price change flows through to the option", () => {
    const run = (p: number) => optionCost(dish(), LINES, GFO, { index: buildIndex([BUN, PATTY, SOY, TAMARI, { ...GFBUN, pack_price: p }], [], LINES), settings: DEFAULT_SETTINGS, targets: TARGETS })!.costPerPortion;
    expect(run(5) - run(3.5)).toBeCloseTo(1.5, 8);
  });

  it("serves from the recipe divide the option's cost per portion like the dish's", () => {
    const four = dish({ portions: 4 });
    const oc = optionCost(four, LINES, GFO, ctx())!;
    expect(oc.costPerPortion).toBeCloseTo(7.55 / 4, 8);
    expect(oc.standard.costPerPortion).toBeCloseTo(5.8 / 4, 8);
  });

  it("returns null for no option at all", () => {
    expect(optionCost(dish(), LINES, null, ctx())).toBeNull();
  });
});

describe("option wording under the card", () => {
  const money = (n: number) => `$${n.toFixed(2)}`;
  it("says how much more or less and how many GP points", () => {
    const more = describeOptionDiff({ costDiff: 0.45, gpDiff: -0.03, sameAsStandard: false }, money);
    expect(more).toEqual({ cost: "$0.45 more than the standard dish", gp: "GP 3 points lower", same: false });
    const less = describeOptionDiff({ costDiff: -1.2, gpDiff: 0.015, sameAsStandard: false }, money);
    expect(less.cost).toBe("$1.20 less than the standard dish");
    expect(less.gp).toBe("GP 1.5 points higher");
    expect(describeOptionDiff({ costDiff: 0.2, gpDiff: -0.01, sameAsStandard: false }, money).gp).toBe("GP 1 point lower");
  });
  it("no GP line when there is no price to compare", () => {
    expect(describeOptionDiff({ costDiff: 0.2, gpDiff: null, sameAsStandard: false }, money).gp).toBeNull();
  });
});

describe("what diet_options holds: back-compat and tolerance", () => {
  it("a note-only option reads exactly as before", () => {
    const raw = { gfo: { note: " Swap the bun " }, vo: { note: "No bacon" } };
    expect(readOptions(raw).map((o) => [o.id, o.note, o.removed, o.added, o.surcharge])).toEqual([
      ["gfo", "Swap the bun", [], [], 0],
      ["vo", "No bacon", [], [], 0],
    ]);
    expect(hasSwap(readOption(raw, "gfo")!)).toBe(false);
  });
  it("copes with null, junk and malformed entries", () => {
    for (const raw of [null, undefined, "x", 3, [], [{ gfo: { note: "x" } }], { gfo: null }, { gfo: "x" }, { gfo: { note: "x", removed: "no", added: "no", surcharge_inc: {} } }]) {
      expect(() => readOptions(raw)).not.toThrow();
    }
    const o = readOption({ gfo: { note: "x", removed: [1, "", "a", "a"], added: [{ component_type: "x", component_id: "y", qty: 1, unit: "g" }, { component_type: "ingredient", component_id: "t", qty: -1, unit: "g" }, { component_type: "ingredient", component_id: "t", qty: 5, unit: "tsp" }, { component_type: "prep", component_id: "ok", qty: 2, unit: "kg" }] } }, "gfo")!;
    expect(o.removed).toEqual(["a"]);
    expect(o.added).toEqual([{ component_type: "prep", component_id: "ok", qty: 2, unit: "kg" }]);
  });
  it("pruning drops only stale ids, keeps unknown keys, and returns the same object when nothing is stale", () => {
    const raw = { gfo: { note: "x", removed: ["l1", "gone"], extra: 1 }, gf: {}, future: { a: 1 } };
    const pruned = pruneStaleRemoved(raw, ["l1", "l2"]) as typeof raw;
    expect(pruned.gfo).toEqual({ note: "x", removed: ["l1"], extra: 1 });
    expect(pruned.gf).toEqual({});
    expect((pruned as Record<string, unknown>).future).toEqual({ a: 1 });
    expect(pruneStaleRemoved(raw, ["l1", "gone"])).toBe(raw);
    expect((pruneStaleRemoved({ gfo: { note: "x", removed: ["gone"] } }, []) as Record<string, { removed?: string[] }>).gfo.removed).toBeUndefined();
    expect(pruneStaleRemoved(null, [])).toBeNull();
  });
  it("copying a dish translates left-out ids, drops ones with no match, scales added amounts and keeps marks", () => {
    const raw = { gfo: { note: "x", removed: ["l1", "zz"], added: [{ component_type: "ingredient", component_id: "t", qty: 15, unit: "ml" }], surcharge_inc: 2 }, vg: {} };
    const out = copyDietOptions(raw, new Map([["l1", "n1"]]), 2) as Record<string, any>;
    expect(out.gfo.removed).toEqual(["n1"]);
    expect(out.gfo.added[0].qty).toBe(30);
    expect(out.gfo.surcharge_inc).toBe(2);
    expect(out.vg).toEqual({});
    expect(raw.gfo.removed).toEqual(["l1", "zz"]); // the original is untouched
    expect(copyDietOptions(null, new Map())).toBeNull();
  });
});

describe("plain words for the kitchen and the print (never a cost)", () => {
  const names = { lineName: (id: string) => ({ l1: "Brioche Bun", l3: "Soy Sauce" })[id] ?? null, addedName: (a: { component_id: string }) => ({ tamari: "Tamari", gfbun: "Gluten Free Bun" })[a.component_id] ?? null };
  it("leave out and add, in the formatter the ingredients use", () => {
    const w = swapWords(readOption({ gfo: GFO }, "gfo")!, names);
    expect(w).toEqual({ leftOut: ["Brioche Bun", "Soy Sauce"], added: ["Gluten Free Bun 1 ea", "Tamari 15 ml"] });
    expect(swapSentence(w)).toBe("Leave out Brioche Bun, Soy Sauce. Add Gluten Free Bun 1 ea, Tamari 15 ml.");
  });
  it("only leave out, only add, nothing, and lines or components that are gone are skipped", () => {
    expect(swapSentence(swapWords({ removed: ["l3"], added: [] }, names))).toBe("Leave out Soy Sauce.");
    expect(swapSentence(swapWords({ removed: [], added: [{ component_type: "ingredient", component_id: "tamari", qty: 0.5, unit: "L" }] }, names))).toBe("Add Tamari 500 ml.");
    expect(swapSentence(swapWords({ removed: ["gone"], added: [{ component_type: "ingredient", component_id: "gone", qty: 1, unit: "g" }] }, names))).toBeNull();
  });
  it("the option text is the swap, then the option's own note", () => {
    expect(optionText("Use the GF bun", "Leave out Brioche Bun.")).toBe("Leave out Brioche Bun. Use the GF bun");
    expect(optionText("Use the GF bun", null)).toBe("Use the GF bun");
    expect(optionText("", "Leave out Soy Sauce.")).toBe("Leave out Soy Sauce.");
  });
});

describe("hand-set marks and how they sit beside the options", () => {
  it("reads marks in the fixed order and ignores junk", () => {
    expect(readMarks({ vg: {}, gf: { note: "x" }, v: {} })).toEqual(["gf", "v", "vg"]);
    expect(readMarks({ gf: null, v: "x", vg: [] })).toEqual([]);
    expect(readMarks(null)).toEqual([]);
  });
  it("VG implies vegetarian: a dish with both prints VG only", () => {
    expect(printedMarks({ v: {}, vg: {} })).toEqual(["vg"]);
    expect(printedMarks({ gf: {}, v: {}, vg: {} })).toEqual(["gf", "vg"]);
    expect(printedMarks({ v: {} })).toEqual(["v"]);
    expect(printedMarks({})).toEqual([]);
  });
  it("turning a mark on removes the option it excludes, and says which; turning an option on removes the mark", () => {
    const start = { gfo: { note: "swap", removed: ["l1"] }, vo: { note: "n" } };
    const on = markOn(start, "gf");
    expect(on.clearedOption).toBe("gfo");
    expect(on.next).toEqual({ vo: { note: "n" }, gf: {} });
    expect(start.gfo).toBeDefined(); // the input is not touched
    expect(markOn({ vo: { note: "n" } }, "gf").clearedOption).toBeNull();
    expect(markOn({ vgo: { note: "n" } }, "vg").clearedOption).toBe("vgo");
    expect(markOn({ vo: { note: "n" } }, "v").clearedOption).toBe("vo");
    const off = optionOnClearsMark({ gf: {}, v: {} }, "gfo");
    expect(off).toEqual({ next: { v: {} }, clearedMark: "gf" });
    expect(optionOnClearsMark({ v: {} }, "gfo").clearedMark).toBeNull();
    expect(markOff({ gf: { note: "x" }, v: {} }, "gf")).toEqual({ v: {} });
  });
  it("marking keeps a note someone already put on the mark", () => {
    expect(markOn({ gf: { note: "kept" } }, "gf").next.gf).toEqual({ note: "kept" });
  });
});

describe("the option costing is display only", () => {
  const src = (f: string) => readFileSync(f, "utf8");
  it("Home, alerts, averages, the Menu list and price suggestions never read the option fields", () => {
    const consumers = ["lib/insights.ts", "lib/dashboard.ts", "lib/costing.ts", "lib/store.tsx", "lib/pos-list.ts", "lib/price-review.ts", "components/dashboard.tsx", "components/today-feed.tsx", "app/(app)/menu/page.tsx", "app/(app)/page.tsx"];
    for (const f of consumers) {
      let text = "";
      try {
        text = src(f);
      } catch {
        continue; // a file this branch does not have
      }
      expect(text, f).not.toMatch(/diet_options|surcharge|diet-option-cost|diet-options/);
    }
  });
  it("only the dish page's option sheet and Options list import the option costing", () => {
    const out = execSync(`grep -rlE 'diet-option-cost"' app components lib tests --include=*.ts --include=*.tsx || true`, { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .sort();
    expect(out).toEqual(["components/editor/option-prices.tsx", "components/editor/option-sheet.tsx", "tests/diet-option-cost.test.ts", "tests/option-sheet.test.ts"].sort());
  });
});
