import { describe, expect, it } from "vitest";
import {
  cleanSupplierName,
  findSupplier,
  ingredientCountText,
  ingredientsToMove,
  isSupplierActive,
  moveImpactText,
  orderedAtText,
  retireBlocker,
  summariseSuppliers,
  supplierChoices,
  supplierClash,
  supplierKey,
} from "@/lib/suppliers";

describe("cleanSupplierName", () => {
  it("tidies spaces and capitals like every other name", () => {
    expect(cleanSupplierName("  bidfood   ")).toBe("Bidfood");
    expect(cleanSupplierName("PARAMOUNT LIQUOR")).toBe("Paramount Liquor");
    expect(cleanSupplierName("   ")).toBe("");
  });
});

describe("findSupplier", () => {
  const list = [
    { id: 1, name: "Bidfood" },
    { id: 2, name: "Paramount Liquor" },
    { id: 3, name: "Star Liquor Direct" },
  ];
  it("finds the same supplier ignoring capitals, spaces and punctuation", () => {
    expect(findSupplier(list, "bidfood")?.id).toBe(1);
    expect(findSupplier(list, "Paramount  Liquor")?.id).toBe(2);
    expect(findSupplier(list, "star-liquor direct")?.id).toBe(3);
  });
  it("treats Pty Ltd as noise", () => {
    expect(findSupplier(list, "Bidfood Pty Ltd")?.id).toBe(1);
    expect(supplierKey("Bid Food Pty. Ltd.")).toBe("bidfood");
  });
  it("returns nothing for a new supplier or an empty name", () => {
    expect(findSupplier(list, "Mega Chef")).toBeUndefined();
    expect(findSupplier(list, "  ")).toBeUndefined();
  });
});

describe("one supplier list", () => {
  const list = [
    { id: 1, name: "Star Liquor", active: true },
    { id: 2, name: "Paramount Liquor", active: false },
    { id: 3, name: "Bidfood" },
  ];
  it("reads a missing flag as active", () => {
    expect(isSupplierActive({})).toBe(true);
    expect(isSupplierActive({ active: false })).toBe(false);
  });
  it("leaves inactive suppliers out of pick-lists but keeps the one a record already has", () => {
    expect(supplierChoices(list, null).map((s) => s.name)).toEqual(["Bidfood", "Star Liquor"]);
    expect(supplierChoices(list, 2).map((s) => s.name)).toEqual(["Bidfood", "Paramount Liquor", "Star Liquor"]);
  });
  it("finds a clash ignoring case, spaces and Pty Ltd, never with itself", () => {
    expect(supplierClash("star  LIQUOR pty ltd", list, 3)?.id).toBe(1);
    expect(supplierClash("Star Liquor", list, 1)).toBeNull();
    expect(supplierClash("  ", list, 1)).toBeNull();
  });
  it("summarises ingredients, venues and invoice links per supplier", () => {
    const rows = summariseSuppliers({
      suppliers: list,
      ingredients: [{ supplier_id: 1, active: true }, { supplier_id: 1, active: false }, { supplier_id: 2, active: false }, { supplier_id: null }],
      terms: [
        { cost_supplier_id: 1, venue_id: 2 },
        { cost_supplier_id: 1, venue_id: 1 },
        { cost_supplier_id: 1, venue_id: 1 },
        { cost_supplier_id: 2, venue_id: 1, active: false },
      ],
      venueName: (id) => ({ 1: "Drift", 2: "Chiobu" })[id as 1 | 2],
      invoiceLinks: [3, null],
    });
    expect(rows.map((r) => r.name)).toEqual(["Bidfood", "Paramount Liquor", "Star Liquor"]);
    expect(rows.find((r) => r.id === 1)).toMatchObject({ ingredients: 2, activeIngredients: 1, venues: ["Chiobu", "Drift"], invoicesLinked: false });
    expect(rows.find((r) => r.id === 2)).toMatchObject({ ingredients: 1, activeIngredients: 0, venues: [], active: false });
    expect(rows.find((r) => r.id === 3)?.invoicesLinked).toBe(true);
  });
  it("words the counts, the order lists and the blocker plainly", () => {
    expect(ingredientCountText(1)).toBe("1 ingredient");
    expect(ingredientCountText(4)).toBe("4 ingredients");
    expect(orderedAtText([])).toBe("Not on any order list");
    expect(orderedAtText(["Drift"])).toBe("Ordered at Drift");
    expect(orderedAtText(["Chiobu", "Drift"])).toBe("Ordered at Chiobu and Drift");
    expect(orderedAtText(["A", "B", "C"])).toBe("Ordered at A, B and C");
    expect(retireBlocker(0)).toBeNull();
    expect(retireBlocker(3)).toBe("3 ingredients still use this supplier. Move its items first.");
    expect(retireBlocker(1)).toBe("1 ingredient still uses this supplier. Move its items first.");
  });
  it("shows the impact of a move before it happens, with no dashes", () => {
    expect(moveImpactText(12, "Star Liquor")).toBe("12 ingredients move to Star Liquor. They will move on every venue's order list.");
    expect(moveImpactText(1, "Star Liquor")).toBe("1 ingredient moves to Star Liquor. It will move on every venue's order list.");
    expect(moveImpactText(2, "X")).not.toMatch(/[–—]/);
  });
  it("moves every ingredient that has the supplier, active or not", () => {
    const ings = [
      { id: "a", supplier_id: 2 },
      { id: "b", supplier_id: 1 },
      { id: "c", supplier_id: 2 },
      { id: "d", supplier_id: null },
    ];
    expect(ingredientsToMove(ings, 2).map((i) => i.id)).toEqual(["a", "c"]);
  });
});
