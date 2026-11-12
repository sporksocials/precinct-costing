import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CHEF_SOURCE } from "@/lib/allergens";
import { confirmAllergens, readDishAllergens, removableOverrides, removeOverride } from "@/lib/dish-allergens";

// Brendan (executive chef), 12 Nov 2026: "The rice salad does not contain fish ... I can't see how to remove that". The fish was the
// dish's own chef override (allergen_add): the editor listed it under Where These Come From but gave no way to take it off.

const cells = (m: Record<string, string[]>) => ({ cells: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { state: "contains", sources: v }])) }) as never;

describe("removableOverrides", () => {
  it("lists an allergen only the dish's own chef override gives", () => {
    const r = cells({ fish: [CHEF_SOURCE], peanuts: ["Peanuts"], chilli: [CHEF_SOURCE] });
    expect(removableOverrides({ allergen_add: ["fish", "peanuts", "chilli"] }, r)).toEqual(["fish", "chilli"]);
  });
  it("leaves out one an ingredient also gives (fix that on the ingredient)", () => {
    const r = cells({ peanuts: ["Peanuts", CHEF_SOURCE] });
    expect(removableOverrides({ allergen_add: ["peanuts"] }, r)).toEqual([]);
  });
  it("reads a legacy onion and garlic entry as both", () => {
    const r = cells({ onion: [CHEF_SOURCE], garlic: [CHEF_SOURCE] });
    expect(removableOverrides({ allergen_add: ["onion_garlic"] }, r)).toEqual(["onion", "garlic"]);
  });
  it("is empty when the dish has no override", () => {
    expect(removableOverrides({ allergen_add: null }, cells({ fish: ["Barramundi"] }))).toEqual([]);
  });
});

describe("removeOverride", () => {
  const signed = confirmAllergens(null, "brendan@example.com", "2026-11-01T00:00:00.000Z", { derived: ["fish"], components: ["ingredient:a"], ticks: {} });

  it("takes the allergen off and keeps the others", () => {
    const res = removeOverride({ allergen_add: ["chilli", "tree_nuts", "peanuts", "fish"], dish_allergens: null }, "fish");
    expect(res.allergen_add).toEqual(["chilli", "tree_nuts", "peanuts"]);
    expect(res.clearedConfirmation).toBe(false);
  });
  it("takes a sign-off away, because the ticks changed", () => {
    const res = removeOverride({ allergen_add: ["fish"], dish_allergens: signed }, "fish");
    expect(res.clearedConfirmation).toBe(true);
    expect(readDishAllergens(res.dish_allergens)?.confirmedAt).toBeNull();
  });
  it("splits a legacy onion and garlic entry so only the other one stays", () => {
    const res = removeOverride({ allergen_add: ["chilli", "onion_garlic"], dish_allergens: null }, "garlic");
    expect(res.allergen_add).toEqual(["chilli", "onion"]);
  });
  it("changes nothing for an allergen that is not on the override", () => {
    const res = removeOverride({ allergen_add: ["chilli"], dish_allergens: signed }, "fish");
    expect(res.allergen_add).toEqual(["chilli"]);
    expect(res.clearedConfirmation).toBe(false);
    expect(res.dish_allergens).toBe(signed);
  });
});

describe("the dish page offers it", () => {
  it("Dish Allergens wires the removal and the chip says Chef override", () => {
    const src = readFileSync("components/editor/dish-allergens.tsx", "utf8");
    expect(src).toContain("removableOverrides(item, check.r)");
    expect(src).toContain("onRemoveOverride={removeOwn}");
    expect(src).toContain("Chef override");
  });
});
