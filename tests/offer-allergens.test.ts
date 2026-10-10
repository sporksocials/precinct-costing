import { describe, expect, it } from "vitest";
import { offerAllergenBlockers, offerAllergenMessage } from "@/lib/offer-allergens";
import type { AllergenIndex } from "@/lib/allergens";
import type { MenuItem } from "@/lib/types";

const index = { ingredients: new Map(), preps: new Map(), items: new Map(), linesByParent: new Map() } as unknown as AllergenIndex;
const item = (id: string, name: string, over: Partial<MenuItem> = {}) => ({ id, name, category: "Food", venue_id: 1, active: true, dish_allergens: null, ...over }) as unknown as MenuItem;
const signed = { contains: [], without: {}, confirmed_at: "2026-10-10T00:00:00Z", confirmed_by: "a@b.c", components: [], ticks: { "item:b": { add: [], rem: [] } } }; // valid for the dish "b" with no ingredients

describe("offers follow the new dish allergen rule", () => {
  it("lists food dishes without a valid sign-off, once each, in offer order", () => {
    const items = [item("a", "Burger"), item("b", "Fries", { dish_allergens: signed as never }), item("c", "Wings")];
    const lines = [{ item_id: "c" }, { item_id: "b" }, { item_id: "a" }, { item_id: "c" }];
    expect(offerAllergenBlockers(lines, items, index)).toEqual(["Wings", "Burger"]);
  });
  it("ignores drinks, beer serves and missing dishes", () => {
    const items = [item("d", "Margarita", { category: "Cocktail" })];
    expect(offerAllergenBlockers([{ item_id: "d" }, { item_id: null }, { item_id: "gone" }], items, index)).toEqual([]);
  });
  it("a confirmed dish does not block", () => {
    expect(offerAllergenBlockers([{ item_id: "b" }], [item("b", "Fries", { dish_allergens: signed as never })], index)).toEqual([]);
  });
  it("words the refusal plainly and shortens a long list", () => {
    expect(offerAllergenMessage([])).toBe("");
    expect(offerAllergenMessage(["A", "B", "C", "D", "E", "F"])).toMatch(/^Confirm the allergens first: A, B, C, D and 2 more\./);
  });
});
