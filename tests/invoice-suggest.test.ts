import { describe, expect, it } from "vitest";
import { buildSuggester, MIN_SCORE, parseDescription, PRESET_SCORE, presetSuggestion, tidyIngredientName } from "../lib/invoice-suggest";
import { BIDFOOD_LINES, FIXTURE_INGREDIENTS, idOf } from "./fixtures/invoice-ingredients";

const suggester = buildSuggester(FIXTURE_INGREDIENTS);
const nameOf = (id: string) => FIXTURE_INGREDIENTS.find((i) => i.id === id)!.name;

describe("parsing a printed description", () => {
  it("drops pack sizes, percentages and shorthand, and keeps the brand apart", () => {
    const p = parseDescription("JUICE ORANGE NAS 100% PET (GOLDEN CIR) 2lt");
    expect(p.words).toEqual(["juice", "orange"]);
    expect(p.brand).toEqual(["golden", "cir"]);
    expect(p.pack).toEqual({ size: 2, unit: "L" });
  });
  it("reads a multi-pack as the whole carton", () => {
    expect(parseDescription("CHIPS 10MM SUPA CRUNCH ULTRAFAST (EDGELL) 6x2kg").pack).toEqual({ size: 12, unit: "kg" });
    expect(parseDescription("BREAD BUNS MILK BURGER ROLLS SLICED VEGAN (NOMAD BREA) 40x85gr").pack).toEqual({ size: 3.4, unit: "kg" });
    expect(parseDescription("BREAD ROTI PARATHA 30'S (KATOOMBA) 1.2kg").pack).toEqual({ size: 1.2, unit: "kg" });
  });
  it("folds plurals and synonyms so the app's wording meets the supplier's", () => {
    expect(parseDescription("POTATO WEDGES SEASONED").words).toContain("wedge");
    expect(parseDescription("MAYONNAISE").words).toEqual(["mayo"]);
    expect(parseDescription("Kewpie Mayo (L)").words).toEqual(["kewpie", "mayo"]);
  });
  it("treats a packing medium as packing, not as the product", () => {
    expect(parseDescription("PINEAPPLE PIECES IN JUICE (GOLDEN CIR) 440gr").words).toEqual(["pineapple", "piece"]);
  });
});

describe("the first real Bidfood invoice (I71910723.SUN, 25 Oct 2026)", () => {
  for (const l of BIDFOOD_LINES.filter((x) => x.expect)) {
    it(`${l.description.slice(0, 34)}... suggests ${l.expect}`, () => {
      const c = suggester.suggest({ description: l.description, item_code: l.code, unit: l.unit, unit_price_ex: l.price }, 5);
      expect(nameOf(c[0].ingredientId)).toBe(l.expect);
      expect(presetSuggestion(c)?.ingredientId).toBe(idOf(l.expect!));
      expect(c.length).toBeLessThanOrEqual(5);
      expect(c.every((x) => x.score >= MIN_SCORE && x.score <= 1)).toBe(true);
    });
  }
  it("does not pre-set a tin of pineapple pieces as the fresh pineapple (the product is not in the app)", () => {
    const l = BIDFOOD_LINES.find((x) => x.expect === null)!;
    const c = suggester.suggest({ description: l.description, item_code: l.code, unit: l.unit, unit_price_ex: l.price }, 5);
    expect(presetSuggestion(c)).toBeNull();
    // it may still be listed for a person to look at, but never above the preset bar
    expect(c.every((x) => x.score < PRESET_SCORE)).toBe(true);
  });
  it("hits the right ingredient first on 11 of the 11 lines the app does stock", () => {
    let right = 0;
    for (const l of BIDFOOD_LINES.filter((x) => x.expect)) {
      const c = suggester.suggest({ description: l.description, item_code: l.code, unit: l.unit, unit_price_ex: l.price }, 1);
      if (c[0] && nameOf(c[0].ingredientId) === l.expect) right++;
    }
    expect(right).toBe(11);
  });
});

describe("how the score behaves", () => {
  it("prefers the rarer word: wedges over potato", () => {
    const c = suggester.suggest({ description: "POTATO WEDGES SEASONED (MCCAIN) 2kg" });
    expect(nameOf(c[0].ingredientId)).toBe("Wedges");
    expect(nameOf(c[1].ingredientId)).toBe("Potato");
  });
  it("a price that agrees breaks a tie between look-alikes", () => {
    const base = { description: "MAYO KEWPIE 1kg" };
    const withPrice = suggester.suggest({ ...base, unit: "BTL", unit_price_ex: 8.75 }, 3);
    expect(nameOf(withPrice[0].ingredientId)).toBe("Kewpie Mayo (L)");
    expect(withPrice[0].why).toContain("same pack price");
  });
  it("a price alone is never enough: with no shared word nothing is suggested", () => {
    expect(suggester.suggest({ description: "ZZZ UNKNOWN THING 1kg", unit: "KG", unit_price_ex: 11.8 })).toEqual([]);
  });
  it("an exact supplier code is a certain match", () => {
    const c = suggester.suggest({ description: "SOMETHING ELSE ENTIRELY", item_code: "22022" });
    expect(c[0]).toMatchObject({ ingredientId: idOf("Juice Mango Nectar (Golden Circle) 2lt"), score: 1 });
  });
  it("leaves inactive ingredients out", () => {
    const s = buildSuggester([{ id: "a", name: "Wedges", active: false }, { id: "b", name: "Wedges Seasoned", active: true }]);
    expect(s.suggest({ description: "POTATO WEDGES" }).map((x) => x.ingredientId)).toEqual(["b"]);
  });
  it("handles empty input and an empty app without throwing", () => {
    expect(suggester.suggest({ description: "" })).toEqual([]);
    expect(buildSuggester([]).suggest({ description: "BACON" })).toEqual([]);
  });
  it("is quick enough for the whole list on a phone (a thousand ingredients, twelve lines)", () => {
    const many = Array.from({ length: 1100 }, (_, i) => ({ id: `x${i}`, name: `Ingredient ${i % 97} Thing ${i % 41}`, pack_size: 1, pack_unit: "kg", pack_price: 5 }));
    const t = Date.now();
    const s = buildSuggester(many);
    for (const l of BIDFOOD_LINES) s.suggest({ description: l.description, item_code: l.code, unit: l.unit, unit_price_ex: l.price });
    expect(Date.now() - t).toBeLessThan(1500);
  });
});

describe("a tidy name for a new ingredient", () => {
  it("drops codes, sizes, brands and supplier shorthand", () => {
    expect(tidyIngredientName("POTATO WEDGES SEASONED (MCCAIN) 2kg")).toBe("Potato Wedges Seasoned");
    expect(tidyIngredientName("JUICE ORANGE NAS 100% PET (GOLDEN CIR) 2lt")).toBe("Juice Orange");
    expect(tidyIngredientName("CHIPS 10MM SUPA CRUNCH ULTRAFAST (EDGELL) 6x2kg")).toBe("Chips Supa Crunch");
    expect(tidyIngredientName("PASTE CURRY MASSAMAN (MAEPLOY) 1kg")).toBe("Paste Curry Massaman");
  });
  it("falls back to the printed words when everything would be dropped", () => {
    expect(tidyIngredientName("2kg")).toBe("2kg");
    expect(tidyIngredientName("")).toBe("");
  });
});
