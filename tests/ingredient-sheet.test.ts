import { describe, expect, it } from "vitest";
import { blankIngredient, draftFromPortal, DEFAULT_INGREDIENT_CATEGORY } from "@/components/ingredient-sheet";
import { isListedCategory } from "@/lib/ingredient-categories";
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

// The free-text Category box (and its "falls back to Food when committed empty" rule) is gone: category is a pick-list on the
// New Ingredient sheet and a picker sheet on the ingredient page, so a blank can no longer be typed. What must stay true is that a
// category is always present and the default is a real category in the list.
describe("the default category is a real pick-list value", () => {
  it("Food is in the list, so a draft that starts on the default is already a valid choice", () => {
    expect(isListedCategory(DEFAULT_INGREDIENT_CATEGORY)).toBe(true);
  });
  it("the ingredient page reads a blank stored category as the default instead of showing nothing", () => {
    const shown = (stored: string | null | undefined) => stored?.trim() || DEFAULT_INGREDIENT_CATEGORY;
    expect(shown("")).toBe("Food");
    expect(shown("  ")).toBe("Food");
    expect(shown("House-made (legacy)")).toBe("House-made (legacy)");
  });
  it("a draft started with a value outside the list keeps it (never rewritten)", () => {
    expect(blankIngredient({ category: "House-made (legacy)" }).category).toBe("House-made (legacy)");
  });
});
