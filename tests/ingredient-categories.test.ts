import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BEER_KEG_CATEGORY, categoriesByGroup, INGREDIENT_CATEGORIES, isListedCategory, looksLikeKeg, suggestCategory } from "@/lib/ingredient-categories";
import { KEG_CATEGORY, looksLikeKeg as kegLooksLikeKeg } from "@/lib/keg";

const s = (name: string) => suggestCategory({ name });

describe("the pick-list", () => {
  it("is the 11 live values, exact strings, in the agreed order", () => {
    expect(INGREDIENT_CATEGORIES.map((c) => c.name)).toEqual([
      "Food",
      "Dairy",
      "Spirits",
      "Liqueurs",
      "Wine",
      "Beer Keg",
      "Packaged Beer / Cider / RTD",
      "Bar consumable",
      "Beverage (non-alc)",
      "Gelato Supplies",
      "Packaging",
    ]);
  });
  it("groups them Kitchen, Bar, Gelato, Other", () => {
    expect(categoriesByGroup()).toEqual([
      { group: "Kitchen", names: ["Food", "Dairy"] },
      { group: "Bar", names: ["Spirits", "Liqueurs", "Wine", "Beer Keg", "Packaged Beer / Cider / RTD", "Bar consumable", "Beverage (non-alc)"] },
      { group: "Gelato", names: ["Gelato Supplies"] },
      { group: "Other", names: ["Packaging"] },
    ]);
  });
  it("keeps the five code-bound names exactly (fining categories and the keg)", () => {
    for (const n of ["Wine", "Spirits", "Liqueurs", "Beer Keg", "Packaged Beer / Cider / RTD"]) expect(isListedCategory(n)).toBe(true);
    expect(KEG_CATEGORY).toBe("Beer Keg");
    expect(BEER_KEG_CATEGORY).toBe("Beer Keg");
  });
  it("knows a listed value from a legacy or mistyped one, and never rewrites either", () => {
    expect(isListedCategory("Spirits")).toBe(true);
    expect(isListedCategory("House-made (legacy)")).toBe(false);
    expect(isListedCategory("spirits")).toBe(false);
    expect(isListedCategory("")).toBe(false);
    expect(isListedCategory(null)).toBe(false);
  });
});

describe("suggestCategory: one case per rule", () => {
  it("keg", () => {
    expect(s("Stone & Wood Keg")).toBe("Beer Keg");
    expect(s("chiobu keg")).toBe("Beer Keg");
    expect(s("JS Ginger Beer Keg")).toBe("Beer Keg");
    expect(s("Byron Bay Seltzer Keg")).toBe("Beer Keg");
  });
  it("spirits", () => {
    for (const n of ["Smirnoff Vodka", "Tanqueray Gin", "Gin", "White Rum", "Whisky", "Whiskey", "Tequila Blanco", "Bourbon", "Brandy", "Mezcal", "Scotch", "Cognac VS"]) expect(s(n), n).toBe("Spirits");
  });
  it("liqueurs", () => {
    for (const n of ["Apricot Liqueur", "Aperol", "Campari", "Baileys Irish Cream", "Bailey's", "Cointreau", "Amaretto", "Triple Sec", "Dry Vermouth", "Kahlua", "Kahlúa", "Peach Schnapps"]) expect(s(n), n).toBe("Liqueurs");
  });
  it("wine", () => {
    for (const n of ["Prosecco", "Champagne", "House Wine", "Shiraz", "Chardonnay", "Pinot Noir", "Sauvignon Blanc", "Merlot", "Moscato"]) expect(s(n), n).toBe("Wine");
  });
  it("packaged beer, cider and RTD", () => {
    for (const n of ["Apple Cider", "Seltzer Can", "Bundy RTD", "Great Northern Stubby"]) expect(s(n), n).toBe("Packaged Beer / Cider / RTD");
  });
  it("a liqueur that names a spirit is still a liqueur", () => {
    expect(s("Coconut Rum Liqueur")).toBe("Liqueurs");
  });
  it("is case insensitive and ignores spacing around the name", () => {
    expect(s("  VODKA  ")).toBe("Spirits");
  });
});

describe("suggestCategory: it must not guess", () => {
  it("never matches part of a word", () => {
    for (const n of ["Ginger", "Ginger Beer", "Gingerbread", "Fresh Ginger", "Egg Noodles", "Brumby Flour", "Winery Tour", "Pinotage Bag", "Scotchy"]) expect(s(n), n).toBeNull();
  });
  it("does not call a food or flavouring that holds an alcohol word a drink", () => {
    for (const n of ["Rum Raisin Gelato Mix", "Rum Raisin Ice Cream", "Rum Sorbet Base", "Red Wine Vinegar", "Scotch Fillet", "Bourbon Vanilla Paste", "Brandy Sauce", "Whisky Flavour", "Amaretto Mix"]) expect(s(n), n).toBeNull();
  });
  it("never guesses food, dairy or anything else", () => {
    for (const n of ["", "   ", "Milk", "Cream", "Butter", "Egg", "Plain Flour", "Lime Juice", "Takeaway Cup", "Coke Syrup"]) expect(s(n), n).toBeNull();
  });
  it("a keg is a keg even when the name also holds a food word", () => {
    expect(s("Rum Raisin Mix Keg")).toBe("Beer Keg");
  });
});

describe("keg helpers moved without breaking", () => {
  it("lib/keg.ts still exports the same looksLikeKeg", () => {
    expect(kegLooksLikeKeg).toBe(looksLikeKeg);
    expect(looksLikeKeg("Pacific Keg")).toBe(true);
    expect(looksLikeKeg("Kegworth Pasta")).toBe(false);
  });
});

describe("category UI keeps every tap target at 44px", () => {
  const files = ["components/ingredient-category-picker.tsx", "components/ingredient-sheet.tsx"].map((f) => readFileSync(f, "utf8"));
  it("no breakpoint makes a control shorter than 44px", () => {
    for (const src of files) {
      for (const m of src.matchAll(/\b(?:sm|md|lg|xl):(?:min-)?h-(?:\[(\d+)px\]|(\d+(?:\.\d+)?))(?![\d\w%/])/g)) {
        const px = m[1] != null ? Number(m[1]) : Number(m[2]) * 4;
        expect(px, m[0]).toBeGreaterThanOrEqual(44);
      }
    }
  });
  it("the chips are at least 44px high with no shared shrinking Chips", () => {
    const picker = files[0];
    expect(picker).toMatch(/min-h-\[44px\]/);
    expect(picker).not.toMatch(/\bChips\b.*from "\.\/ui"/);
  });
  it("the New Ingredient sheet has no free-text category box or datalist", () => {
    const sheet = files[1];
    expect(sheet).not.toMatch(/<datalist/);
    expect(sheet).not.toMatch(/list="ingredient-category-options"/);
    expect(sheet).toMatch(/<CategoryChips/);
  });
});
