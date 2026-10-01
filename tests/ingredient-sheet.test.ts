import { describe, expect, it } from "vitest";
import { blankIngredient, draftFromPortal, DEFAULT_INGREDIENT_CATEGORY } from "@/components/ingredient-sheet";
import type { PortalPrice } from "@/lib/types";

// cost_ingredients.category is NOT NULL (DB default 'Food'); Supabase sends whatever key is present
// in the insert payload, so a draft that explicitly carries `category: null` always fails the insert
// even though the column has a default. Every draft constructor must produce a non-null category.
describe("ingredient drafts never carry a null category", () => {
  it("blankIngredient defaults to Food", () => {
    expect(blankIngredient().category).toBe(DEFAULT_INGREDIENT_CATEGORY);
    expect(blankIngredient().category).not.toBeNull();
  });

  it("blankIngredient keeps an explicit override", () => {
    expect(blankIngredient({ category: "Spirits" }).category).toBe("Spirits");
  });

  it("draftFromPortal defaults to Food (no override forces it back to null)", () => {
    const row: PortalPrice = { supplier: "PFD", description: "Thai Basil", product_code: "123", uom: "1kg", price: 10, price_inc_gst: false, batch: null } as PortalPrice;
    const d = draftFromPortal(row, [], 0.1);
    expect(d.category).toBe(DEFAULT_INGREDIENT_CATEGORY);
  });
});
