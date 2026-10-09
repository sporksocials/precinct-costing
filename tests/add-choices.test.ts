import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ADD_CHOICES, NEW_ITEM_CATEGORIES, beerDefaultVenueId, destinationForCategory, guessCategory } from "../lib/add-choices";
import { MENU_CATEGORIES } from "../lib/types";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("What Are You Adding? tiles", () => {
  it("lists the eleven tiles in order, with no duplicates", () => {
    expect(ADD_CHOICES.map((c) => c.label)).toEqual(["Food", "Cocktail", "Mocktail", "Cold Drink", "Wine", "Spirits", "Packaged Beer & Cider", "RTD", "Tap Beer", "Gelato Flavour", "Prep"]);
    expect(new Set(ADD_CHOICES.map((c) => c.id)).size).toBe(ADD_CHOICES.length);
  });
  it("sends Tap Beer, Gelato Flavour and Prep to their own forms", () => {
    const dest = (label: string) => ADD_CHOICES.find((c) => c.label === label)?.destination;
    expect(dest("Tap Beer")).toEqual({ kind: "beer" });
    expect(dest("Gelato Flavour")).toEqual({ kind: "flavour" });
    expect(dest("Prep")).toEqual({ kind: "prep" });
  });
  it("sends every other tile to New Menu Item with a real category chosen", () => {
    const items = ADD_CHOICES.filter((c) => c.destination.kind === "item");
    expect(items).toHaveLength(8);
    for (const c of items) {
      const d = c.destination;
      if (d.kind !== "item") throw new Error("unreachable");
      expect(MENU_CATEGORIES as readonly string[]).toContain(d.category);
      expect(NEW_ITEM_CATEGORIES).toContain(d.category);
      expect(c.label).toBe(d.category);
    }
  });
});

describe("New Menu Item categories", () => {
  it("leaves out Tap Beer and Gelato but keeps every other stored category", () => {
    expect(NEW_ITEM_CATEGORIES).not.toContain("Tap Beer");
    expect(NEW_ITEM_CATEGORIES).not.toContain("Gelato");
    expect(NEW_ITEM_CATEGORIES).toHaveLength(MENU_CATEGORIES.length - 2);
  });
  it("does not change MENU_CATEGORIES (stored items still use Tap Beer and Gelato)", () => {
    expect(MENU_CATEGORIES).toContain("Tap Beer");
    expect(MENU_CATEGORIES).toContain("Gelato");
  });
  it("the form offers NEW_ITEM_CATEGORIES, not MENU_CATEGORIES", () => {
    const src = read("components/new-recipe.tsx");
    expect(src).toContain("NEW_ITEM_CATEGORIES");
    expect(src).not.toContain("MENU_CATEGORIES");
  });
});

describe("a category filter skips the chooser", () => {
  it("All needs the chooser", () => {
    expect(destinationForCategory("all")).toBeNull();
    expect(destinationForCategory("")).toBeNull();
  });
  it("Tap Beer and Gelato go to their own forms", () => {
    expect(destinationForCategory("Tap Beer")).toEqual({ kind: "beer" });
    expect(destinationForCategory("Gelato")).toEqual({ kind: "flavour" });
  });
  it("any other category opens New Menu Item with that category", () => {
    expect(destinationForCategory("Cocktail")).toEqual({ kind: "item", category: "Cocktail" });
    expect(destinationForCategory("Packaged Beer & Cider")).toEqual({ kind: "item", category: "Packaged Beer & Cider" });
  });
});

describe("guessCategory never returns Tap Beer or Gelato", () => {
  const forbidden = ["Tap Beer", "Gelato"];
  const it_ = (name: string, category: string) => ({ name, category });
  it("ignores the old tap and gelato keywords", () => {
    for (const n of ["Pint of Pacific", "Schooner", "Jug of Lager", "Tap Beer", "Chocolate Gelato", "Lemon Sorbet", "Two Scoop Cone", "Affogato"]) {
      expect(forbidden).not.toContain(guessCategory(n, []));
    }
  });
  it("falls back to Food with no venue items", () => {
    expect(guessCategory("", [])).toBe("Food");
    expect(guessCategory("Hollandaise Eggs", [])).toBe("Food");
  });
  it("skips a venue whose most common category is Tap Beer or Gelato", () => {
    const venue = [it_("Pacific", "Tap Beer"), it_("Lager", "Tap Beer"), it_("Pale Ale", "Tap Beer"), it_("Fish Tacos", "Food"), it_("Burger", "Food")];
    expect(guessCategory("", venue)).toBe("Food");
    expect(guessCategory("Pale Wombat", venue)).toBe("Food");
    expect(guessCategory("Pale Ale Special", [it_("Pale Ale", "Tap Beer")])).toBe("Food");
    const gelatoVenue = [it_("Vanilla", "Gelato"), it_("Mango", "Gelato")];
    expect(guessCategory("", gelatoVenue)).toBe("Food");
  });
  it("still guesses drinks from keywords and similar names", () => {
    expect(guessCategory("Espresso Martini", [])).toBe("Cocktail");
    expect(guessCategory("Virgin Mojito", [])).toBe("Mocktail");
    expect(guessCategory("Mango Smoothie", [])).toBe("Cold Drink");
    expect(guessCategory("Shiraz glass", [])).toBe("Wine");
    expect(guessCategory("Pork Belly Bao", [it_("Pork Belly Rice", "Food"), it_("Pork Cocktail Sausage", "Food")])).toBe("Food");
  });
});

describe("tap beer default venue", () => {
  const venues = [
    { id: 1, slug: "drift" },
    { id: 2, slug: "chiobu" },
    { id: 3, slug: "gelato" },
  ];
  it("uses the chosen venue unless it is Gelato", () => {
    expect(beerDefaultVenueId(venues[1], venues)).toBe(2);
    expect(beerDefaultVenueId(venues[2], venues)).toBe(1);
  });
  it("falls back to Drift, then the first venue", () => {
    expect(beerDefaultVenueId(null, venues)).toBe(1);
    expect(beerDefaultVenueId(undefined, [{ id: 9, slug: "x" }])).toBe(9);
    expect(beerDefaultVenueId(null, [])).toBeUndefined();
  });
});
