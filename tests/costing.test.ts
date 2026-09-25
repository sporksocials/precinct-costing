import { describe, expect, it } from "vitest";
import {
  buildIndex,
  costItem,
  costPrep,
  ingredientCostPerBase,
  ingredientExGstPackPrice,
  parsePackFromUom,
  suggestedPrice,
} from "@/lib/costing";
import { DEFAULT_SETTINGS, type Ingredient, type MenuItem, type Prep, type RecipeLine } from "@/lib/types";

const ing = (over: Partial<Ingredient>): Ingredient => ({
  id: "i1",
  name: "Flour",
  category: "Dry",
  supplier_id: null,
  supplier_code: null,
  pack_size: 10,
  pack_unit: "kg",
  pack_price: 22,
  price_inc_gst: true,
  gst_free: false,
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

describe("ingredient pricing", () => {
  it("handles GST flags", () => {
    expect(ingredientExGstPackPrice(ing({ pack_price: 11, price_inc_gst: true }), 0.1)).toBeCloseTo(10);
    expect(ingredientExGstPackPrice(ing({ pack_price: 11, price_inc_gst: false }), 0.1)).toBeCloseTo(11);
    expect(ingredientExGstPackPrice(ing({ pack_price: 11, price_inc_gst: true, gst_free: true }), 0.1)).toBeCloseTo(11);
  });
  it("computes cost per base unit with rebate and yield", () => {
    // inc-GST basis: rebate is inc-GST too. (22 - 2) / 1.1 = 18.18 ex, /10kg, /0.9 yield → 2.0202
    expect(ingredientCostPerBase(ing({ rebate: 2, yield_pct: 0.9 }), 0.1)).toBeCloseTo(2.0202, 3);
    // ex-GST price: rebate used as entered. (20 - 2) / 10 / 0.9 = 2
    expect(ingredientCostPerBase(ing({ pack_price: 20, price_inc_gst: false, rebate: 2, yield_pct: 0.9 }), 0.1)).toBeCloseTo(2);
    // GST-free price: no conversion either
    expect(ingredientCostPerBase(ing({ pack_price: 20, gst_free: true, rebate: 2, yield_pct: 0.9 }), 0.1)).toBeCloseTo(2);
  });
});

describe("suggested price", () => {
  it("rounds up to nearest 50c", () => {
    // cost 3 at 70% → 10 ex → 11 inc → 11.00
    expect(suggestedPrice(3, 0.7, 0.1, 0.5)).toBe(11);
    // cost 3.1 → 10.333 ex → 11.367 inc → 11.5
    expect(suggestedPrice(3.1, 0.7, 0.1, 0.5)).toBe(11.5);
  });
});

describe("recipes", () => {
  const flour = ing({ id: "flour", name: "Flour", pack_price: 22 }); // $2/kg ex
  const milk = ing({ id: "milk", name: "Milk", pack_unit: "L", pack_size: 2, pack_price: 4, gst_free: true }); // $2/L
  const batter: Prep = { id: "batter", name: "Batter", venue_id: 1, prep_type: null, yield_qty: 2, yield_unit: "kg", active: true, source: null, notes: null };
  const superBatter: Prep = { ...batter, id: "super", name: "Super batter", yield_qty: 1 };
  const lines: RecipeLine[] = [
    { id: "l1", parent_type: "prep", parent_id: "batter", component_type: "ingredient", component_id: "flour", qty: 1000, unit: "g", note: null, sort: 1 },
    { id: "l2", parent_type: "prep", parent_id: "batter", component_type: "ingredient", component_id: "milk", qty: 1, unit: "L", note: null, sort: 2 },
    { id: "l3", parent_type: "prep", parent_id: "super", component_type: "prep", component_id: "batter", qty: 500, unit: "g", note: null, sort: 1 },
    { id: "l4", parent_type: "item", parent_id: "pancake", component_type: "prep", component_id: "super", qty: 200, unit: "g", note: null, sort: 1 },
    { id: "l5", parent_type: "item", parent_id: "pancake", component_type: "ingredient", component_id: "milk", qty: 50, unit: "g", note: null, sort: 2 },
  ];
  const index = buildIndex([flour, milk], [batter, superBatter], lines);

  it("costs preps recursively", () => {
    const pc = costPrep(batter, index, 0.1);
    expect(pc.batchCost).toBeCloseTo(4); // 1kg flour $2 + 1L milk $2
    expect(pc.costPerUnit).toBeCloseTo(2);
    const sp = costPrep(superBatter, index, 0.1);
    expect(sp.batchCost).toBeCloseTo(1); // 0.5kg × $2
    expect(sp.costPerUnit).toBeCloseTo(1);
    expect(sp.recipe.nested).toBe(false);
  });

  it("costs an item and flags unit mismatch and nesting", () => {
    const item: MenuItem = { id: "pancake", name: "Pancake", venue_id: 1, category: "Food", section: null, portions: 2, sell_price_inc: 11, target_override: null, hh_price_inc: null, active: true, source: null, notes: null };
    const ic = costItem(item, index, DEFAULT_SETTINGS, []);
    // 0.2kg super batter $0.20 + 50g milk (mismatch, factor 0.001 → 0.05 × $2 = 0.10) = 0.30 / 2 portions = 0.15
    expect(ic.recipeCost).toBeCloseTo(0.3);
    expect(ic.costPerPortion).toBeCloseTo(0.15);
    expect(ic.recipe.warnings.some((w) => w.kind === "unit_mismatch")).toBe(true);
    expect(ic.recipe.nested).toBe(true);
    expect(ic.sellEx).toBeCloseTo(10);
    expect(ic.gpPct).toBeCloseTo(0.985);
    expect(ic.targetGp).toBe(0.72);
    expect(ic.underTarget).toBe(false);
  });

  it("guards cycles", () => {
    const a: Prep = { ...batter, id: "a", name: "A" };
    const b: Prep = { ...batter, id: "b", name: "B" };
    const cyc: RecipeLine[] = [
      { id: "c1", parent_type: "prep", parent_id: "a", component_type: "prep", component_id: "b", qty: 1, unit: "kg", note: null, sort: 1 },
      { id: "c2", parent_type: "prep", parent_id: "b", component_type: "prep", component_id: "a", qty: 1, unit: "kg", note: null, sort: 1 },
    ];
    const idx = buildIndex([], [a, b], cyc);
    const pc = costPrep(a, idx, 0.1);
    expect(pc.recipe.warnings.some((w) => w.kind === "cycle")).toBe(true);
    expect(Number.isFinite(pc.batchCost)).toBe(true);
  });
});

describe("parsePackFromUom", () => {
  it("parses common supplier UOM strings", () => {
    expect(parsePackFromUom("EA (2KG)")).toEqual({ pack_size: 2, pack_unit: "kg" });
    expect(parsePackFromUom("CTN (2 X 6KG)")).toEqual({ pack_size: 12, pack_unit: "kg" });
    expect(parsePackFromUom("/ Kg")).toEqual({ pack_size: 1, pack_unit: "kg" });
    expect(parsePackFromUom("12 X 330ML")).toEqual({ pack_size: 3.96, pack_unit: "L" });
    expect(parsePackFromUom("CTN 24 EA")).toEqual({ pack_size: 24, pack_unit: "each" });
    expect(parsePackFromUom("Bunch")).toBeNull();
  });
});
