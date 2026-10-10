import { describe, expect, it } from "vitest";
import { buildIndex } from "@/lib/costing";
import { ALLERGENS, ALLERGEN_IDS, CONTAINS_IDS, allergenLabel, ingredientAllergenState, rollup, suggestAllergens, suggestDietFlags, type AllergenId, type AllergenIndex } from "@/lib/allergens";
import { badgeModel, DRINK_ALLERGEN_IDS, FULL_ALLERGENS, DEFAULT_POLICY, showsAllergen } from "@/lib/allergen-badges";
import { buildPrintRecipe, printAllergens, type PrintRecipe } from "@/lib/print-recipe";
import type { Ingredient, MenuItem, RecipeLine, Venue } from "@/lib/types";

const ids = (name: string, desc?: string): AllergenId[] => suggestAllergens(name, desc).map((s) => s.id);
const has = (name: string, id: AllergenId) => ids(name).includes(id);

describe("Seeds keyword rule (stored id sesame)", () => {
  it("matches sesame and its products, by the word sesame itself and by tahini, hummus and friends", () => {
    for (const n of ["Sesame Seeds", "Sesame Oil", "Tahini", "Tahina Paste", "Hummus", "Houmous", "Halva", "Halvah Plain", "Za'atar", "Zatar Blend", "Dukkah", "Gomasio", "Hoisin Sauce", "Furikake", "Black Sesame Paste"]) {
      expect(has(n, "sesame"), n).toBe(true);
    }
  });
  it("matches the wider seed set: sunflower, pumpkin, pepitas, poppy, chia, flax, linseed, hemp, mixed seeds, seeded bread", () => {
    for (const n of ["Sunflower Seeds", "Sunflower Seed Kernels", "Pumpkin Seeds", "Pepitas", "Poppy Seeds", "Poppyseed Dressing", "Chia Seeds", "Chia Pudding Mix", "Flaxseed Meal", "Flax Seeds", "Linseed Meal", "Hemp Seeds", "Hemp Hearts", "Mixed Seeds 1kg", "Seed Mix", "Seeded Sourdough", "Multigrain Seeded Loaf"]) {
      expect(has(n, "sesame"), n).toBe(true);
    }
  });
  it("does not match spice seeds, bare seed words or unrelated words", () => {
    for (const n of ["Cumin Seeds", "Fennel Seed", "Caraway Seeds", "Coriander Seeds", "Mustard Seeds", "Yellow Mustard Seed", "Seedless Grapes", "Seedless Watermelon", "Celery Seed", "Pomegranate Seeds", "Vanilla Bean Seeds", "Seeded Mustard", "Pumpkin", "Butternut Pumpkin", "Sunflower Oil", "Chiang Mai Sauce", "Chiabatta", "Flaxen Honey", "Hemp Milk"]) {
      expect(has(n, "sesame"), n).toBe(false);
    }
  });
  it("reports the matched word, and the label everyone sees is Seeds", () => {
    expect(suggestAllergens("Tahini")[0]).toEqual({ id: "sesame", keyword: "tahini" });
    expect(suggestAllergens("Sunflower Seeds")[0]).toEqual({ id: "sesame", keyword: "sunflower seeds" });
    expect(allergenLabel("sesame")).toBe("Seeds");
  });
  it("seeded bread is gluten too, hoisin keeps its soy and gluten", () => {
    expect(ids("Seeded Sourdough Loaf")).toEqual(expect.arrayContaining(["gluten", "sesame"]));
    expect(ids("Hoisin Sauce")).toEqual(expect.arrayContaining(["gluten", "soy", "sesame"]));
  });
});

describe("Sulphites keyword rule", () => {
  it("matches wine and its relatives", () => {
    for (const n of ["Red Wine", "White Wine 750ml", "Prosecco", "Champagne Brut", "Cava", "Sparkling Wine", "Sparkling Brut", "Dry Vermouth", "Sherry Vinegar", "Port Wine", "Tawny Port", "Marsala", "Cider Apple", "Mulled Wine", "Chardonnay 750ml", "Sauvignon Blanc", "Shiraz"]) {
      expect(has(n, "sulphites"), n).toBe(true);
    }
  });
  it("matches vinegar, pickles, dried fruit and desiccated coconut", () => {
    for (const n of ["Balsamic Glaze", "Rice Vinegar", "Malt Vinegar", "Dill Pickles", "Pickled Ginger", "Gherkins", "Cornichons", "Sultanas", "Raisins", "Currants Dried", "Prunes", "Dried Apricots", "Dried Fruit Mix", "Dried Mango", "Desiccated Coconut", "Coconut Desiccated Fine", "Shredded Coconut"]) {
      expect(has(n, "sulphites"), n).toBe(true);
    }
  });
  it("matches bottled juice, cordial, fruit squash and fruit post-mix", () => {
    for (const n of ["Bottled Lemon Juice", "Lime Juice Bottled 1L", "Lemon Juice Concentrate", "Lime Cordial", "Elderflower Cordial", "Orange Juice From Concentrate", "Orange Squash", "Post Mix Lemonade", "Post-Mix Orange", "Postmix Lime"]) {
      expect(has(n, "sulphites"), n).toBe(true);
    }
  });
  it("matches mustard, sausages, prawns, jam and the preservative codes", () => {
    for (const n of ["Dijon Mustard", "English Mustard", "Pork Sausages", "Beef Snags", "Chipolata", "King Prawns", "Tiger Shrimp", "Raspberry Jam", "Orange Marmalade", "Sodium Metabisulphite", "Metabisulfite", "Sulphur Dioxide", "Sulfite", "Preservative 223", "E220", "E228 Powder"]) {
      expect(has(n, "sulphites"), n).toBe(true);
    }
    expect(ids("Sausage Mince")).toContain("sulphites");
  });
  it("does not match spirits, fresh fruit, glucose syrup, cola, sparkling water or other look-alikes", () => {
    for (const n of ["Vodka", "Gin 700ml", "Dark Rum", "Whisky", "Tequila Blanco", "Aperol", "Fresh Lime", "Fresh Lemons", "Lemon Wedges", "Strawberries", "Apricots", "Apricot Pulp", "Glucose Syrup", "Post Mix Cola", "Postmix Dark Cola", "Sparkling Water", "Sparkling Mineral Water", "Port Salut", "Blackcurrant Puree", "Red Currants Fresh", "Mustard Seeds", "Mustard Powder", "Mustard Greens", "Portobello Mushrooms", "Jamon", "Ginger Beer", "Coconut Milk", "Lime Juice Fresh Squeezed", "Peaches", "Simple Syrup"]) {
      expect(has(n, "sulphites"), n).toBe(false);
    }
  });
  it("still tags wine and spirits as alcohol, separately from sulphites", () => {
    expect(ids("Red Wine").sort()).toEqual(["alcohol", "sulphites"]);
    expect(ids("Vodka")).toEqual(["alcohol"]);
    expect(ids("Red Wine Vinegar").sort()).toEqual(["alcohol", "sulphites"]);
  });
});

describe("Nitrites keyword rule", () => {
  it("matches cured and processed meats", () => {
    for (const n of ["Streaky Bacon", "Bacon Rashers", "Middle Bacon", "Leg Ham", "Ham Shaved", "Smoked Ham", "Gammon", "Prosciutto", "Pancetta", "Salami Milano", "Pepperoni", "Chorizo", "Cabanossi", "Kransky", "Mortadella", "Speck", "Bresaola", "Jamon Iberico", "Pastrami", "Corned Beef", "Frankfurts", "Frankfurter", "Hot Dog Sausages", "Nduja", "Lap Cheong", "Deli Meat", "Smoked Chicken Breast", "Smoked Turkey", "Dry Cured Bacon", "Cured Pork Belly"]) {
      expect(has(n, "nitrites"), n).toBe(true);
    }
  });
  it("matches the curing agents themselves", () => {
    for (const n of ["Celery Salt", "Celery Powder", "Sodium Nitrite", "Potassium Nitrate", "Saltpetre", "Instacure No 1", "Curing Salt", "Prague Powder", "E249", "E250", "E251", "E252", "Preservative 250"]) {
      expect(has(n, "nitrites"), n).toBe(true);
    }
  });
  it("does not match fresh meat, smoked or cured fish, plant bacon, salt cured extras or look-alikes", () => {
    for (const n of ["Pork Mince", "Pork Belly", "Chicken Thigh", "Chicken Breast", "Beef Mince", "Sausage Mince", "Beef Brisket", "Lamb Shoulder", "Smoked Salmon", "Smoked Trout", "Smoked Cod", "Cured Salmon", "Cured Kingfish", "Salt Cured Egg Yolk", "Salt Cured Lemon", "Coconut Bacon", "Vegan Bacon", "Mushroom Bacon", "Smoked Paprika", "Smoked Cheddar", "Hamburger Bun", "Hamburger Patty", "Hampton Sauce", "Celery Sticks", "Celery Seed", "Celery Hearts", "Wham Bar", "Chilli Sauce", "Spring Onion", "Jam", "Nitro Cold Brew"]) {
      expect(has(n, "nitrites"), n).toBe(false);
    }
  });
  it("cured meats are still meat for the diet tags", () => {
    const meat = (n: string) => suggestDietFlags(n).some((f) => f.flag === "meat");
    for (const n of ["Cabanossi", "Kransky", "Bresaola", "Pastrami", "Jamon Iberico", "Frankfurts", "Bacon Rashers", "Leg Ham"]) expect(meat(n), n).toBe(true);
    expect(meat("Smoked Salmon")).toBe(false);
  });
});

describe("groups, labels and order", () => {
  it("Sulphites follows Molluscs in the required list, Nitrites ends the chef extras, Alcohol is the only attribute", () => {
    expect(CONTAINS_IDS).toEqual(["gluten", "crustacea", "egg", "fish", "milk", "peanuts", "sesame", "soy", "tree_nuts", "lupin", "molluscs", "sulphites", "chilli", "onion_garlic", "nitrites"]);
    expect(ALLERGENS.filter((a) => a.group === "required").map((a) => a.id).slice(-2)).toEqual(["molluscs", "sulphites"]);
    expect(ALLERGENS.filter((a) => a.group === "extra").map((a) => a.id)).toEqual(["chilli", "onion_garlic", "nitrites"]);
    expect(ALLERGENS.filter((a) => a.group === "attribute").map((a) => a.id)).toEqual(["alcohol"]);
    expect(ALLERGEN_IDS).toHaveLength(16);
    expect(allergenLabel("sulphites")).toBe("Sulphites");
    expect(allergenLabel("nitrites")).toBe("Nitrites");
  });
  it("the stored ids are unchanged, so ticked records keep working", () => {
    const state = ingredientAllergenState({ name: "Chardonnay", allergens: ["sulphites", "sesame", "nitrites", "nonsense"], allergens_reviewed: true, diet_flags: [] });
    expect(state.confirmed).toEqual(["sulphites", "sesame", "nitrites"]);
  });
  it("suggestions only apply to unreviewed ingredients: reviewed means the ticks are the truth", () => {
    const base = { name: "Streaky Bacon", allergens: [] as string[], diet_flags: [] as string[] };
    expect(ingredientAllergenState({ ...base, allergens_reviewed: false }).suggested.map((s) => s.id)).toEqual(["nitrites"]);
    expect(ingredientAllergenState({ ...base, allergens_reviewed: true }).suggested).toEqual([]);
    expect(ingredientAllergenState({ ...base, allergens: ["nitrites"], allergens_reviewed: false }).suggested).toEqual([]);
  });
});

describe("drinks list egg, milk and nuts only", () => {
  it("DRINK_ALLERGEN_IDS is egg, milk and nuts, and showsAllergen follows it", () => {
    expect([...DRINK_ALLERGEN_IDS]).toEqual(["egg", "milk", "peanuts", "tree_nuts"]);
    for (const id of CONTAINS_IDS) expect(showsAllergen({ category: "Cocktail" }, id, FULL_ALLERGENS), id).toBe(DRINK_ALLERGEN_IDS.includes(id));
    expect(showsAllergen({ category: "Food" }, "nitrites", FULL_ALLERGENS)).toBe(true);
    expect(showsAllergen({ category: "Food" }, "sulphites", FULL_ALLERGENS)).toBe(true);
    expect(showsAllergen({ category: "Food" }, "alcohol", FULL_ALLERGENS)).toBe(false);
  });
});

describe("menu-only screens stay menu-only", () => {
  it("the default policy lists no allergen at all, new ones included, on food or drinks", () => {
    expect(DEFAULT_POLICY.allergens).toEqual([]);
    for (const category of ["Food", "Cocktail"]) for (const id of ["sulphites", "nitrites", "sesame"] as const) expect(showsAllergen({ category }, id)).toBe(false);
  });
});

/* ---------------------------------------------------------------- the printed sheet */

const ing = (id: string, name: string, over: Partial<Ingredient> = {}): Ingredient =>
  ({ id, name, category: "Food", supplier_id: 7, supplier_code: "SUP-1", pack_size: 1, pack_unit: "kg", pack_price: 17.08, price_inc_gst: false, gst_free: false, rebate: 0, yield_pct: 1, venues: "All", active: true, last_price_update: null, previous_price: null, source: null, notes: null, updated_at: null, allergens_reviewed: true, allergens: [], ...over }) as Ingredient;
const item = (id: string, name: string, over: Partial<MenuItem> = {}): MenuItem => ({ id, name, venue_id: 1, category: "Food", section: null, portions: 1, sell_price_inc: 24, target_override: null, hh_price_inc: null, active: true, source: null, notes: null, updated_at: null, ...over });
let n = 0;
const line = (parent_id: string, component_id: string): RecipeLine => ({ id: `l${++n}`, parent_type: "item", parent_id, component_type: "ingredient", component_id, qty: 1, unit: "g", note: null, sort: n });
const VENUES = new Map<number, Venue>([[1, { id: 1, name: "Drift Bar", slug: "drift", sort: 1 }]]);
function printOf(ings: Ingredient[], dish: MenuItem): PrintRecipe {
  const index: AllergenIndex = { ...buildIndex(ings, [], ings.map((i) => line(dish.id, i.id))), items: new Map([[dish.id, dish]]) };
  return buildPrintRecipe("item", dish.id, { index, venueById: VENUES }) as PrintRecipe;
}

describe("the printed recipe sheet", () => {
  it("lists Sulphites and Nitrites on the Contains line in the fixed order", () => {
    const r = printOf(
      [ing("a", "Streaky Bacon", { allergens: ["nitrites", "onion_garlic"] }), ing("b", "White Wine", { allergens: ["sulphites", "alcohol"] }), ing("c", "Tahini", { allergens: ["sesame"] }), ing("d", "Cream", { allergens: ["milk"] })],
      item("burger", "Bacon Burger"),
    );
    expect(r.allergens.contains).toBe("Contains: Milk, Seeds, Sulphites, Onion & Garlic, Nitrites");
    expect(r.allergens.contains).not.toMatch(/alcohol|sesame/i);
    expect(r.allergens.mayContain).toBeNull();
  });
  it("shows an unreviewed bacon and wine as May Contain (Unconfirmed), with the not-checked line", () => {
    const r = printOf([ing("a", "Streaky Bacon", { allergens_reviewed: false }), ing("b", "White Wine", { allergens_reviewed: false }), ing("c", "Sunflower Seeds", { allergens_reviewed: false })], item("d", "Salad"));
    expect(r.allergens.contains).toBe("Contains: Nothing found so far");
    expect(r.allergens.mayContain).toBe("May contain (unconfirmed): Seeds, Sulphites, Nitrites");
    expect(r.allergens.notChecked).toMatch(/not been checked/);
  });
  it("a drink prints egg but not sulphites, nitrites, seeds or alcohol", () => {
    const r = printOf([ing("w", "Prosecco", { allergens: ["sulphites", "alcohol", "nitrites", "sesame"] }), ing("e", "Egg White", { allergens: ["egg"] })], item("sour", "Prosecco Sour", { category: "Cocktail" }));
    expect(r.allergens.contains).toBe("Contains: Egg");
  });
  it("the print model still carries no price, cost or supplier text", () => {
    const r = printOf([ing("a", "Streaky Bacon", { allergens: ["nitrites"], notes: "secret supplier note" })], item("d", "Toastie"));
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/17\.08|24|secret supplier|SUP-1/);
  });
  it("printAllergens takes the labels straight from the badge model", () => {
    const index: AllergenIndex = { ...buildIndex([ing("a", "Ham", { allergens: ["nitrites"] })], [], [line("x", "a")]), items: new Map([["x", item("x", "Ham Toastie")]]) };
    expect(printAllergens(badgeModel(rollup({ kind: "item", id: "x" }, index), item("x", "Ham Toastie"), FULL_ALLERGENS)).contains).toBe("Contains: Nitrites");
  });
});

describe("Shellfish keyword rules: look-alikes are not shellfish (Chiobu check, 10 Oct 2026)", () => {
  it("oyster mushrooms and oyster blade are not molluscs, scalloped potatoes are not scallops, crab apples are not crab", () => {
    for (const n of ["Oyster Mushroom", "Oyster Mushrooms (King)", "Beef Oyster Blade", "Scalloped Potato", "Scallop Squash", "Crab Apple", "Crabapple Jelly"]) {
      expect(ids(n), n).not.toContain("molluscs");
      expect(ids(n), n).not.toContain("crustacea");
    }
  });
  it("real shellfish and oyster sauce still match", () => {
    expect(has("Oysters Pacific", "molluscs")).toBe(true);
    expect(has("Oyster Sauce", "molluscs")).toBe(true);
    expect(has("Scallops (Hokkaido)", "molluscs")).toBe(true);
    expect(has("Blue Swimmer Crab Meat", "crustacea")).toBe(true);
    expect(has("Fish Sauce", "fish")).toBe(true);
  });
});
