import { describe, expect, it } from "vitest";
import { withoutNulls } from "@/lib/store";
import { blankIngredient, draftFromPortal, DEFAULT_INGREDIENT_CATEGORY, DEFAULT_INGREDIENT_VENUES } from "@/components/ingredient-sheet";
import type { PortalPrice } from "@/lib/types";

/**
 * This is the structural guard behind two live incidents (both on cost_ingredients: category, then venues):
 * a column that is NOT NULL with a server-side default only gets that default when the insert payload omits
 * the key entirely. A draft object that explicitly carries `field: null` always fails, even though the column
 * has a perfectly good default. Every store insert now goes through withoutNulls() first (see lib/store.tsx),
 * so this is the one place that failure mode gets fixed for every table, not per-field.
 */
describe("withoutNulls", () => {
  it("drops null and undefined keys, keeps everything else including falsy real values", () => {
    const row = { a: "x", b: null, c: 0, d: false, e: "", f: undefined, g: [] as string[] };
    expect(withoutNulls(row)).toEqual({ a: "x", c: 0, d: false, e: "", g: [] });
  });

  it("is a no-op on a row with no null/undefined fields", () => {
    const row = { a: 1, b: "two" };
    expect(withoutNulls(row)).toEqual(row);
  });
});

// cost_ingredients NOT NULL columns that have a server-side default (live schema, checked 2 Oct 2026):
// category -> 'Food', pack_size -> 1, pack_unit -> 'each', pack_price -> 0, price_inc_gst -> false,
// gst_free -> false, rebate -> 0, yield_pct -> 1, venues -> 'All', active -> true, allergens -> '{}',
// allergens_reviewed -> false, diet_flags -> '{}'. A draft must never set any of these to null; withoutNulls
// is the safety net if one ever does, but the draft builders themselves should already be honest about it.
describe("ingredient drafts never carry a null value for a NOT NULL column", () => {
  const notNullWithDefault = ["category", "pack_size", "pack_unit", "pack_price", "price_inc_gst", "gst_free", "rebate", "yield_pct", "venues", "active"] as const;

  it("blankIngredient", () => {
    const d = blankIngredient() as Record<string, unknown>;
    for (const k of notNullWithDefault) expect(d[k], k).not.toBeNull();
    expect(d.category).toBe(DEFAULT_INGREDIENT_CATEGORY);
    expect(d.venues).toBe(DEFAULT_INGREDIENT_VENUES);
  });

  it("draftFromPortal", () => {
    const row: PortalPrice = { supplier: "PFD", description: "Thai Basil", product_code: "123", uom: "1kg", price: 10, price_inc_gst: false, batch: null } as PortalPrice;
    const d = draftFromPortal(row, [], 0.1) as Record<string, unknown>;
    for (const k of notNullWithDefault) expect(d[k], k).not.toBeNull();
  });

  it("an override can still set a real value for any of these", () => {
    const d = blankIngredient({ category: "Spirits", venues: "Drift" });
    expect(d.category).toBe("Spirits");
    expect(d.venues).toBe("Drift");
  });
});
