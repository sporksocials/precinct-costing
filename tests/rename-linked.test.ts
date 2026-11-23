import { describe, expect, it } from "vitest";
import { baseName, orderItemClashMessage, orderItemRenameClash, planLinkedRenames, plannedCount, swapLeadingBase } from "@/lib/rename-linked";

const ING = "ing-bombay";
const ingredients = [{ id: ING, name: "Bombay Sapphire London Dry Gin (700ml)" }, { id: "other", name: "Jack Daniel's (1L)" }];
const items = [
  { id: "nip-c", name: "Bombay Sapphire London Dry Gin - 30ml Nip", venue_id: 2 },
  { id: "nip-d", name: "Bombay Sapphire London Dry Gin - Nip (30ml)", venue_id: 1 },
  { id: "gt", name: "Bombay Sapphire London Dry Gin And Tonic", venue_id: 1 },
  { id: "cocktail", name: "Bombay Sapphire London Dry Gin Martini", venue_id: 1 },
];
const lines = [
  { parent_type: "item", parent_id: "nip-c", component_type: "ingredient", component_id: ING },
  { parent_type: "item", parent_id: "nip-d", component_type: "ingredient", component_id: ING },
  { parent_type: "item", parent_id: "gt", component_type: "ingredient", component_id: ING },
  { parent_type: "prep", parent_id: "nip-c", component_type: "ingredient", component_id: ING },
];
const products = [
  { id: "p-c", venue_id: 2, category_id: "c2", name: "Bombay Sapphire London Dry Gin", ingredient_id: ING },
  { id: "p-d", venue_id: 1, category_id: "c1", name: "Bombay Sapphire London Dry Gin", ingredient_id: null },
  { id: "p-x", venue_id: 1, category_id: "c1", name: "Bombay Presse", ingredient_id: null },
];
const run = (newName: string, over: Partial<Parameters<typeof planLinkedRenames>[0]> = {}) =>
  planLinkedRenames({ ingredientId: ING, oldName: "Bombay Sapphire London Dry Gin (700ml)", newName, ingredients, items, lines, products, ...over });

describe("base name", () => {
  it("drops the trailing size in brackets only", () => {
    expect(baseName("Bombay Sapphire London Dry Gin (700ml)")).toBe("Bombay Sapphire London Dry Gin");
    expect(baseName("Jack Daniel's (1L)")).toBe("Jack Daniel's");
    expect(baseName("Red Bull (250ml Can, 24 pack)")).toBe("Red Bull");
    expect(baseName("Cola")).toBe("Cola");
  });
});

describe("swapLeadingBase", () => {
  it("swaps a whole leading name, ignoring capitals and spacing", () => {
    expect(swapLeadingBase("bombay  sapphire london dry gin - 30ml Nip", "Bombay Sapphire London Dry Gin", "Bombay Gin")).toBe("Bombay Gin - 30ml Nip");
    expect(swapLeadingBase("Bombay Sapphire London Dry Gin", "Bombay Sapphire London Dry Gin", "Bombay Gin")).toBe("Bombay Gin");
    expect(swapLeadingBase("Bombay Sapphire London Dry Gin (30ml)", "Bombay Sapphire London Dry Gin", "Bombay Gin")).toBe("Bombay Gin (30ml)");
  });
  it("never swaps part of a longer name", () => {
    expect(swapLeadingBase("Bombay Sapphire London Dry Gin Martini", "Bombay Sapphire London Dry Gin", "X")).toBeNull();
    expect(swapLeadingBase("Not Bombay Sapphire London Dry Gin", "Bombay Sapphire London Dry Gin", "X")).toBeNull();
  });
});

describe("planLinkedRenames", () => {
  it("carries the new base to the nips, keeping each dish's own wording", () => {
    const p = run("Bombay Gin (700ml)");
    expect(p.dishes.map((d) => [d.from, d.to])).toEqual([
      ["Bombay Sapphire London Dry Gin - 30ml Nip", "Bombay Gin - 30ml Nip"],
      ["Bombay Sapphire London Dry Gin - Nip (30ml)", "Bombay Gin - Nip (30ml)"],
    ]);
    expect(plannedCount(p)).toBe(2);
  });
  it("never plans an order item: they carry the ingredient's name in the database (one card per product, 23 Nov 2026)", () => {
    expect(run("Bombay Gin (700ml)").products).toEqual([]);
    // not the one that points at the ingredient, not the bare-name one, and it is never linked from here
    expect(run("Bombay Gin (700ml)", { products: undefined }).products).toEqual([]);
    expect(run("Bombay Gin (700ml)").skipped.some((s) => s.kind === "product")).toBe(false);
  });
  it("leaves dishes that only share the first words, and dishes that do not use the ingredient", () => {
    const p = run("Bombay Gin (700ml)");
    expect(p.dishes.some((d) => d.id === "cocktail" || d.id === "gt")).toBe(false);
    const unused = run("Bombay Gin (700ml)", { lines: [] });
    expect(unused.dishes).toEqual([]);
  });
  it("carries nothing when only the size changes or the name is unchanged", () => {
    expect(plannedCount(run("Bombay Sapphire London Dry Gin (1L)"))).toBe(0);
    expect(plannedCount(run("BOMBAY SAPPHIRE London Dry Gin (700ml)"))).toBe(0);
  });
  it("skips a dish rename that would clash and says why", () => {
    const p = run("Bombay Gin (700ml)", { items: [...items, { id: "taken", name: "Bombay Gin - 30ml Nip", venue_id: 2 }] });
    expect(p.dishes.map((d) => d.id)).toEqual(["nip-d"]);
    expect(p.skipped.map((s) => s.kind)).toEqual(["dish"]);
  });
  it("never writes: the inputs are unchanged", () => {
    const before = JSON.stringify([items, products]);
    run("Bombay Gin (700ml)");
    expect(JSON.stringify([items, products])).toBe(before);
  });
});

describe("an ingredient rename that would collide on an order list is refused before saving", () => {
  // the order item of this ingredient at Drift (venue 1, category c1), and one at Chiobu (venue 2, category c2)
  const mine = [
    { id: "o-d", venue_id: 1, category_id: "c1", name: "Bombay Sapphire London Dry Gin (700ml)", ingredient_id: ING, active: true },
    { id: "o-c", venue_id: 2, category_id: "c2", name: "Bombay Sapphire London Dry Gin (700ml)", ingredient_id: ING, active: true },
  ];
  const clash = (others: Parameters<typeof orderItemRenameClash>[0]["products"], newName = "Bar Mats") => orderItemRenameClash({ ingredientId: ING, newName, products: [...mine, ...others] });

  it("an active order item of another product already has the name in the same venue category", () => {
    const c = clash([{ id: "x", venue_id: 2, category_id: "c2", name: "Bar Mats", ingredient_id: null, active: true }]);
    expect(c).toEqual({ venue_id: 2, taken_by: "Bar Mats" });
    expect(orderItemClashMessage(c!, "Chiobu")).toBe("Chiobu's order list already has a product called Bar Mats in the same category. Pick a different name, or rename that one first.");
    expect(orderItemClashMessage(c!, null)).toMatch(/^An order list already has/);
  });
  it("the same name in another category, or at a venue that does not order this ingredient, is fine", () => {
    expect(clash([{ id: "x", venue_id: 1, category_id: "c9", name: "Bar Mats", ingredient_id: null, active: true }])).toBeNull();
    expect(clash([{ id: "x", venue_id: 3, category_id: "c1", name: "Bar Mats", ingredient_id: null, active: true }])).toBeNull();
  });
  it("an INACTIVE holder never blocks (the database moves it aside as old), and an inactive item of this ingredient is not checked", () => {
    expect(clash([{ id: "x", venue_id: 1, category_id: "c1", name: "Bar Mats", ingredient_id: null, active: false }])).toBeNull();
    const stopped = [{ ...mine[0], active: false }, mine[1]];
    expect(orderItemRenameClash({ ingredientId: ING, newName: "Bar Mats", products: [...stopped, { id: "x", venue_id: 1, category_id: "c1", name: "Bar Mats", ingredient_id: null, active: true }] })).toBeNull();
  });
  it("compares the name exactly as the database does, and the ingredient's own items never clash with each other", () => {
    expect(clash([{ id: "x", venue_id: 1, category_id: "c1", name: "bar mats", ingredient_id: null, active: true }])).toBeNull();
    expect(orderItemRenameClash({ ingredientId: ING, newName: "Bombay Sapphire London Dry Gin (700ml)", products: mine })).toBeNull();
    expect(clash([], "")).toBeNull();
  });
  it("a row read without the active column counts as active", () => {
    expect(clash([{ id: "x", venue_id: 1, category_id: "c1", name: "Bar Mats", ingredient_id: "other" }])).toEqual({ venue_id: 1, taken_by: "Bar Mats" });
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("rename everywhere wiring", () => {
  it("the ingredient page renames through the linked rename, and the sheet offers Only Rename The Ingredient and one Undo", () => {
    const page = read("app/(app)/ingredients/[id]/page.tsx");
    expect(page).toContain("useLinkedRename");
    expect(page).toContain("onUndo={linked.onUndo}");
    const ui = read("components/linked-rename.tsx");
    expect(ui).toContain("Only Rename The Ingredient");
    expect(ui).toContain("Rename All");
  });
  it("the rename no longer writes an order item: it checks for a clash first and lets the database carry the name", () => {
    const ui = read("components/linked-rename.tsx");
    expect(ui).not.toMatch(/updateProduct|Ordering Products|ingredient_id: (ing\.id|null)/);
    expect(ui).toContain("orderItemRenameClash");
    // the check runs before the ingredient is saved
    expect(ui.indexOf("orderItemRenameClash({")).toBeLessThan(ui.indexOf("store.updateIngredient(ing.id, { name: next })"));
  });
  it("the pure rules import nothing that writes", () => {
    const rules = read("lib/rename-linked.ts");
    const imports = rules.split("\n").filter((l) => l.startsWith("import"));
    expect(imports).toEqual(['import { nameKey } from "./rename";']);
    expect(rules).not.toMatch(/\.update\(|\.insert\(/);
  });
});
