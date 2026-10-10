import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { SECTION_ORDER, compareGroups, formatQty, groupItems, isKitchenPath, isKitchenVenue, kitchenPhotoSrc, KITCHEN_VENUES, matchesName, parseKitchenData, qtyParts, scaleLabel, scaleQty, yieldText } from "@/lib/kitchen";
import { buildKitchenModel, componentsOf, dishBadges as dishBadgesP, prepBadges as prepBadgesP, usedIn } from "@/lib/kitchen-model";
import { badgeModel, FULL_ALLERGENS } from "@/lib/allergen-badges";

/** the original allergen-listing behaviour stays under test; the app default is menu-only (see "kitchen menu-only default") */
const dishBadges = (m: Parameters<typeof dishBadgesP>[0], id: string) => dishBadgesP(m, id, FULL_ALLERGENS);
const prepBadges = (m: Parameters<typeof prepBadgesP>[0], id: string) => prepBadgesP(m, id, FULL_ALLERGENS);
import { BADGE_LABELS } from "@/lib/diet-legend";
import { CARD_BG, KB } from "@/components/kitchen/palette";
import { rollup } from "@/lib/allergens";
import { stationWorkerResponse, stationWorkerSource } from "@/lib/sw-source";

const SYNCED = "2026-10-03T08:00:00Z";

/** A small feed in the shape cost_kitchen_data returns: a clear dish, a dish through an unreviewed prep, and a prep nested in a prep. */
const RAW = {
  venue: { slug: "drift", name: "Drift Bar" },
  dishes: [
    { id: "d-toast", name: "Avocado Toast", section: "Breakfast", portions: 1, method: ["Toast the bread", "Smash the avo"], plating: ["Bread on the plate first"], photo: "uploads/toast-1.jpg", allergen_add: null, allergen_remove: null, allergen_notes: null },
    { id: "d-burger", name: "Crispy Chicken Burger", section: "Burgers", portions: 1, method: [], plating: [], photo: null, allergen_add: null, allergen_remove: null, allergen_notes: { milk: "no aioli" } },
    { id: "d-tart", name: "Lemon Tart", section: "Sweets", portions: 4, method: ["Slice"], plating: [], photo: null, allergen_add: null, allergen_remove: null, allergen_notes: null },
  ],
  preps: [
    { id: "p-aioli", name: "Garlic Aioli", prep_type: "Sauces", yield_qty: 2, yield_unit: "kg", active: true, ready: true, method: ["Whisk"], storage: "Fridge, 5 days", allergen_add: null, allergen_remove: null, allergen_notes: null },
    { id: "p-pastry", name: "Sweet Pastry", prep_type: null, yield_qty: 12, yield_unit: "each", active: true, ready: true, method: [], storage: null, allergen_add: null, allergen_remove: null, allergen_notes: null },
    { id: "p-base", name: "Pastry Base", prep_type: "Doughs", yield_qty: 1, yield_unit: "kg", active: true, ready: false, method: [], storage: null, allergen_add: null, allergen_remove: null, allergen_notes: null },
  ],
  ingredients: [
    { id: "i-bread", name: "Sourdough (loaf 800g)", allergens: ["gluten"], allergens_reviewed: true, diet_flags: [] },
    { id: "i-avo", name: "Avocado", allergens: [], allergens_reviewed: true, diet_flags: null },
    { id: "i-mayo", name: "Kewpie Mayo", allergens: null, allergens_reviewed: false, diet_flags: null },
    { id: "i-flour", name: "Plain Flour", allergens: ["gluten"], allergens_reviewed: true, diet_flags: null },
    { id: "i-butter", name: "Butter", allergens: ["milk"], allergens_reviewed: true, diet_flags: ["dairy"] },
    { id: "i-chicken", name: "Chicken Thigh", allergens: [], allergens_reviewed: true, diet_flags: ["meat"] },
  ],
  lines: [
    { parent_type: "item", parent_id: "d-toast", component_type: "ingredient", component_id: "i-bread", qty: 2, unit: "each", note: "toasted", sort: 1 },
    { parent_type: "item", parent_id: "d-toast", component_type: "ingredient", component_id: "i-avo", qty: 0.12, unit: "kg", note: null, sort: 2 },
    { parent_type: "item", parent_id: "d-burger", component_type: "ingredient", component_id: "i-chicken", qty: 180, unit: "g", note: null, sort: 1 },
    { parent_type: "item", parent_id: "d-burger", component_type: "prep", component_id: "p-aioli", qty: 30, unit: "g", note: null, sort: 2 },
    { parent_type: "prep", parent_id: "p-aioli", component_type: "ingredient", component_id: "i-mayo", qty: 1.2, unit: "kg", note: null, sort: 1 },
    { parent_type: "item", parent_id: "d-tart", component_type: "prep", component_id: "p-pastry", qty: 600, unit: "g", note: null, sort: 1 },
    { parent_type: "prep", parent_id: "p-pastry", component_type: "prep", component_id: "p-base", qty: 500, unit: "g", note: null, sort: 1 },
    { parent_type: "prep", parent_id: "p-base", component_type: "ingredient", component_id: "i-flour", qty: 500, unit: "g", note: null, sort: 1 },
    { parent_type: "prep", parent_id: "p-base", component_type: "ingredient", component_id: "i-butter", qty: 250, unit: "g", note: null, sort: 2 },
  ],
};

describe("parseKitchenData", () => {
  it("normalises the database payload", () => {
    const d = parseKitchenData(RAW, SYNCED)!;
    expect(d.venue).toEqual({ slug: "drift", name: "Drift Bar" });
    expect(d.dishes.map((x) => x.name)).toEqual(["Avocado Toast", "Crispy Chicken Burger", "Lemon Tart"]);
    expect(d.dishes[0]).toMatchObject({ section: "Breakfast", photo: "uploads/toast-1.jpg", method: ["Toast the bread", "Smash the avo"], plating: ["Bread on the plate first"] });
    expect(d.dishes[1].allergenNotes).toEqual({ milk: "no aioli" });
    expect(d.preps.find((p) => p.id === "p-base")?.ready).toBe(false);
    expect(d.lines).toHaveLength(RAW.lines.length);
    expect(d.syncedAt).toBe(SYNCED);
  });

  it("is null when the venue is missing or the payload is not an object", () => {
    for (const bad of [null, undefined, "x", 4, [], {}, { venue: {} }, { venue: { slug: 3 } }]) expect(parseKitchenData(bad, SYNCED)).toBeNull();
  });

  it("copes with a payload that has no lists at all", () => {
    expect(parseKitchenData({ venue: { slug: "drift" } }, SYNCED)).toEqual({ venue: { slug: "drift", name: "drift" }, dishes: [], preps: [], ingredients: [], lines: [], syncedAt: SYNCED });
  });

  it("coerces a method that is not a list to empty, and drops blank steps", () => {
    const d = parseKitchenData({ venue: { slug: "drift" }, dishes: [{ id: "a", name: "A", method: "Whisk", plating: { 0: "x" } }, { id: "b", name: "B", method: ["Whisk", " ", 4, null, " Fold "], plating: null }] }, SYNCED)!;
    expect(d.dishes[0]).toMatchObject({ method: [], plating: [] });
    expect(d.dishes[1].method).toEqual(["Whisk", "Fold"]);
  });

  it("drops rows without an id or a name instead of failing", () => {
    const d = parseKitchenData(
      {
        venue: { slug: "drift" },
        dishes: [null, 7, "x", { name: "No id" }, { id: "a" }, { id: "b", name: "  " }, { id: 3, name: "Numeric id" }, { id: "ok", name: " Fine " }],
        preps: [{ id: "p" }, { name: "n" }, { id: "p1", name: "Stock" }],
        ingredients: [{ name: "x" }, { id: "i", name: "Salt" }],
        lines: [
          { parent_type: "item", parent_id: "a", component_type: "ingredient" },
          { parent_type: "nope", parent_id: "a", component_type: "ingredient", component_id: "i" },
          { parent_type: "item", parent_id: "ok", component_type: "ingredient", component_id: "i", qty: "abc", unit: null, note: " " },
        ],
      },
      SYNCED,
    )!;
    expect(d.dishes.map((x) => x.id)).toEqual(["3", "ok"]);
    expect(d.dishes[1].name).toBe("Fine");
    expect(d.preps.map((x) => x.id)).toEqual(["p1"]);
    expect(d.ingredients.map((x) => x.id)).toEqual(["i"]);
    expect(d.lines).toEqual([{ parentType: "item", parentId: "ok", componentType: "ingredient", componentId: "i", qty: 0, unit: "", note: null, sort: 0 }]);
  });

  it("only keeps a photo that is a valid upload path", () => {
    const photos = ["uploads/ok-1.jpg", "../x.jpg", "uploads/../x.jpg", "http://evil.test/a.jpg", "mai-tai.jpg", "uploads/a/b.jpg", "", null, 4];
    const d = parseKitchenData({ venue: { slug: "drift" }, dishes: photos.map((photo, i) => ({ id: `d${i}`, name: `Dish ${i}`, photo })) }, SYNCED)!;
    expect(d.dishes.map((x) => x.photo)).toEqual(["uploads/ok-1.jpg", null, null, null, null, null, null, null, null]);
  });

  it("never reads a missing review flag as reviewed", () => {
    const d = parseKitchenData({ venue: { slug: "drift" }, ingredients: [{ id: "a", name: "A" }, { id: "b", name: "B", allergens_reviewed: null }, { id: "c", name: "C", allergens_reviewed: "true" }, { id: "d", name: "D", allergens_reviewed: true }] }, SYNCED)!;
    expect(d.ingredients.map((i) => i.reviewed)).toEqual([false, false, false, true]);
  });

  it("defaults portions to 1 and a prep's unit to each when they are nonsense", () => {
    const d = parseKitchenData({ venue: { slug: "drift" }, dishes: [{ id: "a", name: "A", portions: 0 }, { id: "b", name: "B", portions: "x" }, { id: "c", name: "C", portions: 4 }], preps: [{ id: "p", name: "P", yield_qty: "abc", yield_unit: "bunch", ready: "yes" }] }, SYNCED)!;
    expect(d.dishes.map((x) => x.portions)).toEqual([1, 1, 4]);
    expect(d.preps[0]).toMatchObject({ yieldQty: 0, yieldUnit: "each", ready: false });
  });
});

describe("parseKitchenData: diet options and seafood", () => {
  const one = (dish: Record<string, unknown>) => parseKitchenData({ venue: { slug: "drift" }, dishes: [{ id: "d", name: "D", ...dish }] }, SYNCED)!.dishes[0];
  const ingr = (i: Record<string, unknown>) => parseKitchenData({ venue: { slug: "drift" }, ingredients: [{ id: "i", name: "I", ...i }] }, SYNCED)!.ingredients[0];

  it("keeps the four known options that have a non-empty note, trimmed", () => {
    expect(one({ diet_options: { gfo: { note: " Swap the bun for the GF roll " }, vo: { note: "No bacon" }, vgo: { note: "x" }, dfo: { note: "No cheese" } } }).dietOptions).toEqual({ gfo: { note: "Swap the bun for the GF roll" }, vo: { note: "No bacon" }, vgo: { note: "x" }, dfo: { note: "No cheese" } });
  });
  it("drops unknown keys and options without a usable string note", () => {
    const bad = { gf: { note: "x" }, gfo: { note: "" }, vo: { note: "   " }, vgo: { note: 4 }, dfo: "No cheese", extra: { note: "y" } };
    expect(one({ diet_options: bad }).dietOptions).toEqual({});
    expect(one({ diet_options: { gfo: null, vo: [] } }).dietOptions).toEqual({});
  });
  it("treats a missing or malformed diet_options as none", () => {
    for (const v of [undefined, null, "gfo", 3, [], [{ gfo: { note: "x" } }]]) expect(one({ diet_options: v }).dietOptions).toEqual({});
  });
  it("seafood_label is true only for the boolean true", () => {
    expect(one({ seafood_label: true }).seafoodLabel).toBe(true);
    for (const v of [undefined, null, false, "true", 1, "yes"]) expect(one({ seafood_label: v }).seafoodLabel).toBe(false);
  });
  it("seafood_origin is only A or I, seafood_exempt only a real true", () => {
    expect(ingr({ seafood_origin: "A" }).seafoodOrigin).toBe("A");
    expect(ingr({ seafood_origin: "I" }).seafoodOrigin).toBe("I");
    for (const v of [undefined, null, "NZ", "M", "a", "", 1, true]) expect(ingr({ seafood_origin: v }).seafoodOrigin).toBeNull();
    expect(ingr({ seafood_exempt: true }).seafoodExempt).toBe(true);
    for (const v of [undefined, null, false, "true", 1]) expect(ingr({ seafood_exempt: v }).seafoodExempt).toBe(false);
  });
  it("reads a category when the feed carries one, else null", () => {
    expect(ingr({ category: " Wine " }).category).toBe("Wine");
    expect(ingr({}).category).toBeNull();
  });
});

describe("sections", () => {
  const dish = (name: string, section: string | null) => ({ name, section });
  it("orders Drift's sections the way the menu runs, unknown ones alphabetically, Other last", () => {
    const names = ["Zebra Board", "Sweets", null, "Mains", "Aperitivo", "breakfast", "Daily Specials", "Little Drifters", "Kids"];
    const groups = groupItems(names.map((s, i) => dish(`D${i}`, s)), (d) => d.section);
    expect(groups.map((g) => g.label)).toEqual(["breakfast", "Kids", "Little Drifters", "Mains", "Daily Specials", "Sweets", "Aperitivo", "Zebra Board", "Other"]);
  });
  it("lists the known sections in the brief's order", () => {
    expect([...SECTION_ORDER]).toEqual(["Breakfast", "Kids", "Small Plates", "Little Drifters", "Mains", "Bowls & Salads", "Grill", "Burgers", "Pizzas", "Daily Specials", "Sweets"]);
    expect(["Sweets", "Small Plates", "Breakfast"].sort((a, b) => compareGroups(a, b))).toEqual(["Breakfast", "Small Plates", "Sweets"]);
  });
  it("sorts dishes by name inside a section and treats a blank section as Other", () => {
    const g = groupItems([dish("Pancakes", "Breakfast"), dish("Avo Toast", "Breakfast"), dish("Mystery", "  ")], (d) => d.section);
    expect(g.map((x) => [x.label, x.items.map((i) => i.name)])).toEqual([["Breakfast", ["Avo Toast", "Pancakes"]], ["Other", ["Mystery"]]]);
  });
  it("groups preps alphabetically by type, Other last", () => {
    const g = groupItems([dish("a", "Sauces"), dish("b", null), dish("c", "Doughs")], (d) => d.section, []);
    expect(g.map((x) => x.label)).toEqual(["Doughs", "Sauces", "Other"]);
  });
  it("matches names case-insensitively", () => {
    expect(matchesName("Crispy Chicken Burger", " chick ")).toBe(true);
    expect(matchesName("Lemon Tart", "burger")).toBe(false);
    expect(matchesName("Lemon Tart", "")).toBe(true);
  });
});

describe("formatQty", () => {
  it("reads grams, not fractions of a kilo", () => {
    expect(formatQty(150, "g")).toBe("150 g");
    expect(formatQty(0.15, "kg")).toBe("150 g");
    expect(formatQty(0.5, "g")).toBe("0.5 g");
    expect(formatQty(12.5, "g")).toBe("12.5 g");
    expect(formatQty(1500, "g")).toBe("1.5 kg");
    expect(formatQty(2, "kg")).toBe("2 kg");
    expect(formatQty(1.25, "kg")).toBe("1.25 kg");
    expect(formatQty(999.7, "g")).toBe("1 kg");
  });
  it("does the same for volumes", () => {
    expect(formatQty(500, "ml")).toBe("500 ml");
    expect(formatQty(0.25, "L")).toBe("250 ml");
    expect(formatQty(2000, "ml")).toBe("2 L");
    expect(formatQty(1.5, "L")).toBe("1.5 L");
  });
  it("reads each as a plain count", () => {
    expect(formatQty(2, "each")).toBe("2");
    expect(formatQty(1.5, "each")).toBe("1½");
    expect(formatQty(0.5, "each")).toBe("½");
    expect(formatQty(0.25, "each")).toBe("¼");
    expect(qtyParts(3, "each")).toEqual({ value: "3", unit: "" });
    expect(qtyParts(150, "g")).toEqual({ value: "150", unit: "g" });
  });
  it("shows nothing for a zero or missing amount", () => {
    expect(formatQty(0, "g")).toBe("");
    expect(formatQty(NaN, "ml")).toBe("");
  });
});

describe("scaling", () => {
  it("multiplies without float noise", () => {
    expect(scaleQty(1 / 3, 3)).toBe(1);
    expect(scaleQty(0.1, 3)).toBe(0.3);
    expect(scaleQty(150, 0.5)).toBe(75);
    expect(scaleLabel(0.5)).toBe("×½");
    expect(scaleLabel(3)).toBe("×3");
  });
  it("scales the yield text and rolls grams up to kilos", () => {
    expect(yieldText(2, "kg")).toBe("Makes 2 kg");
    expect(yieldText(2, "kg", 0.5)).toBe("Makes 1 kg");
    expect(yieldText(1, "kg", 0.5)).toBe("Makes 500 g");
    expect(yieldText(500, "g" as never, 3)).toBe("Makes 1.5 kg");
    expect(yieldText(12, "each", 2)).toBe("Makes 24");
    expect(yieldText(0, "kg")).toBe("");
  });
});

describe("kitchen model", () => {
  const model = buildKitchenModel(parseKitchenData(RAW, SYNCED)!);

  it("lists a dish's components in order, named, with the pack size dropped", () => {
    expect(componentsOf(model, "item", "d-toast")).toEqual([
      { kind: "ingredient", id: "i-bread", name: "Sourdough", qty: 2, unit: "each", note: "toasted" },
      { kind: "ingredient", id: "i-avo", name: "Avocado", qty: 0.12, unit: "kg", note: null },
    ]);
    expect(componentsOf(model, "item", "d-burger").map((c) => [c.kind, c.name])).toEqual([["ingredient", "Chicken Thigh"], ["prep", "Garlic Aioli"]]);
    expect(componentsOf(model, "item", "nope")).toEqual([]);
  });

  it("finds the dishes that use a prep, through nested preps", () => {
    expect(usedIn(model, "p-aioli").map((d) => d.id)).toEqual(["d-burger"]);
    expect(usedIn(model, "p-pastry").map((d) => d.id)).toEqual(["d-tart"]);
    expect(usedIn(model, "p-base").map((d) => d.id)).toEqual(["d-tart"]);
    expect(usedIn(model, "missing")).toEqual([]);
  });

  it("survives a prep that loops back on itself", () => {
    const looped = parseKitchenData({ venue: { slug: "drift" }, dishes: [{ id: "d", name: "D" }], preps: [{ id: "a", name: "A" }, { id: "b", name: "B" }], lines: [
      { parent_type: "item", parent_id: "d", component_type: "prep", component_id: "a", qty: 1, unit: "g" },
      { parent_type: "prep", parent_id: "a", component_type: "prep", component_id: "b", qty: 1, unit: "g" },
      { parent_type: "prep", parent_id: "b", component_type: "prep", component_id: "a", qty: 1, unit: "g" },
    ] }, SYNCED)!;
    const m = buildKitchenModel(looped);
    expect(usedIn(m, "b").map((d) => d.id)).toEqual(["d"]);
    expect(usedIn(m, "nowhere")).toEqual([]);
    expect(dishBadges(m, "d").notReviewed).not.toBeNull();
  });

  it("rolls allergens up through the shared badge model: a fully reviewed dish lists what it contains", () => {
    const m = dishBadges(model, "d-toast");
    expect(m.notReviewed).toBeNull();
    expect(m.contains).toEqual(["gluten"]);
    expect(m.diet).toEqual([{ id: "no_dairy_ingredients", label: "No Dairy Ingredients", state: "is" }, { id: "vegetarian", label: "Vegetarian", state: "is" }, { id: "vegan", label: "Vegan", state: "is" }]);
  });

  it("never calls a dish clear while an ingredient is unreviewed, even one buried in a prep", () => {
    const m = dishBadges(model, "d-burger");
    expect(m.notReviewed).toEqual({ unreviewedNames: ["Kewpie Mayo"] });
    expect(m.diet.every((d) => d.state === "not_confirmed")).toBe(true);
    expect(m.notes).toEqual([]); // the "no aioli" note is on milk, which nothing has confirmed
    expect(prepBadges(model, "p-aioli").notReviewed).not.toBeNull();
  });

  it("shows a chef note on an allergen that is shown", () => {
    const withMilk = parseKitchenData({ ...RAW, ingredients: [...RAW.ingredients, { id: "i-cheese", name: "Cheddar", allergens: ["milk"], allergens_reviewed: true, diet_flags: [] }], lines: [...RAW.lines, { parent_type: "item", parent_id: "d-burger", component_type: "ingredient", component_id: "i-cheese", qty: 20, unit: "g", note: null, sort: 9 }] }, SYNCED)!;
    expect(dishBadges(buildKitchenModel(withMilk), "d-burger").notes).toEqual([{ id: "milk", label: "Milk", note: "no aioli" }]);
  });

  it("rolls a nested prep's allergens into the dish that uses it", () => {
    const m = dishBadges(model, "d-tart");
    expect(m.notReviewed).toBeNull();
    expect(m.contains).toEqual(["gluten", "milk"]);
    expect(m.diet.map((d) => d.id)).toEqual(["vegetarian"]);
    expect(prepBadges(model, "p-pastry").contains).toEqual(["gluten", "milk"]);
  });

  it("treats a dish with no recipe lines, or a missing component, as not reviewed", () => {
    const empty = buildKitchenModel(parseKitchenData({ venue: { slug: "drift" }, dishes: [{ id: "d", name: "D" }, { id: "e", name: "E" }], lines: [{ parent_type: "item", parent_id: "e", component_type: "ingredient", component_id: "gone", qty: 1, unit: "g" }] }, SYNCED)!);
    for (const id of ["d", "e"]) {
      const m = dishBadges(empty, id);
      expect(m.notReviewed).not.toBeNull();
      expect(m.diet.every((d) => d.state === "not_confirmed")).toBe(true);
    }
  });

  it("a fully reviewed dish with nothing in it has no banner, no contains and positive diet badges", () => {
    const m = buildKitchenModel(parseKitchenData({ venue: { slug: "drift" }, dishes: [{ id: "d", name: "D" }], ingredients: [{ id: "i", name: "Lettuce", allergens: [], allergens_reviewed: true }], lines: [{ parent_type: "item", parent_id: "d", component_type: "ingredient", component_id: "i", qty: 50, unit: "g" }] }, SYNCED)!);
    const b = dishBadges(m, "d");
    expect(b).toMatchObject({ notReviewed: null, contains: [], mayContain: [], attributes: [] });
    expect(b.diet.map((d) => `${d.id}:${d.state}`)).toEqual(["no_gluten_ingredients:is", "no_dairy_ingredients:is", "vegetarian:is", "vegan:is"]);
  });

  it("never claims anything is free from or clear for an unreviewed recipe, whatever the allergens", () => {
    const m = buildKitchenModel(
      parseKitchenData({ venue: { slug: "drift" }, dishes: [{ id: "d", name: "D" }], ingredients: [{ id: "i", name: "Lettuce", allergens: [], allergens_reviewed: false }, { id: "j", name: "Peanut Sauce", allergens: ["peanuts"], allergens_reviewed: false }], lines: [{ parent_type: "item", parent_id: "d", component_type: "ingredient", component_id: "i", qty: 50, unit: "g" }, { parent_type: "item", parent_id: "d", component_type: "ingredient", component_id: "j", qty: 5, unit: "g" }] }, SYNCED)!,
    );
    const b = dishBadges(m, "d");
    expect(b.notReviewed).not.toBeNull();
    expect(b.contains).toEqual(["peanuts"]);
    expect(b.diet.some((d) => d.state === "is")).toBe(false);
    // the kitchen shows exactly what the costing app's badge model says for the same roll-up
    expect(b).toEqual(badgeModel(rollup({ kind: "item", id: "d" }, m.index), m.index.items?.get("d"), FULL_ALLERGENS));
  });
});

describe("kitchen menu-only default (Troy, 4 Oct 2026)", () => {
  const RAWM = { venue: { slug: "drift" }, dishes: [{ id: "d", name: "D", diet_options: { gfo: { note: "GF bun" } } }, { id: "e", name: "E" }], ingredients: [{ id: "j", name: "Peanut Sauce", allergens: ["peanuts", "milk"], allergens_reviewed: false }], lines: [{ parent_type: "item", parent_id: "d", component_type: "ingredient", component_id: "j", qty: 5, unit: "g" }] };
  it("shows no allergens, no banner and no diet badges: only the menu letters", () => {
    const m = buildKitchenModel(parseKitchenData(RAWM, SYNCED)!);
    const b = dishBadgesP(m, "d");
    expect(b.listsAllergens).toBe(false);
    expect(b.contains).toEqual([]);
    expect(b.notReviewed).toBeNull();
    expect(b.diet).toEqual([]);
    expect(b.options.map((o) => o.letter)).toEqual(["GFO"]);
  });
  it("a dish with no menu labels has nothing to show", () => {
    const m = buildKitchenModel(parseKitchenData(RAWM, SYNCED)!);
    const b = dishBadgesP(m, "e");
    expect(b.options).toEqual([]);
    expect(b.seafood).toBeNull();
    expect(b.contains).toEqual([]);
  });
});

describe("kitchen badges for the new feed fields", () => {
  const feed = (over: { dishes?: Record<string, unknown>[]; ingredients?: Record<string, unknown>[]; lines?: Record<string, unknown>[] }) =>
    buildKitchenModel(parseKitchenData({ venue: { slug: "drift" }, dishes: over.dishes ?? [], preps: [], ingredients: over.ingredients ?? [], lines: over.lines ?? [] }, SYNCED)!);
  const rev = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, allergens: [], allergens_reviewed: true, diet_flags: [], ...extra });
  const ln = (dish: string, ing: string, sort = 1) => ({ parent_type: "item", parent_id: dish, component_type: "ingredient", component_id: ing, qty: 100, unit: "g", note: null, sort });

  it("a wine-only dish lists sulphites as a main allergen under the full policy but never alcohol, and vegan is Not Confirmed", () => {
    const m = feed({ dishes: [{ id: "d", name: "Wine Jus" }], ingredients: [rev("w", "Red Wine", { allergens: ["sulphites", "alcohol"] })], lines: [ln("d", "w")] });
    const b = dishBadges(m, "d");
    expect(b.contains).toEqual(["sulphites"]);
    expect(b.attributes).toEqual([]);
    expect(b.diet.filter((d) => d.id === "vegetarian" || d.id === "vegan").every((d) => d.state === "not_confirmed")).toBe(true);
  });
  it("the Kitchen Station stays menu-only: sulphites, nitrites and seeds are never listed by default", () => {
    const m = feed({
      dishes: [{ id: "d", name: "Ham And Wine Toastie" }],
      ingredients: [rev("w", "Red Wine", { allergens: ["sulphites", "alcohol"] }), rev("h", "Leg Ham", { allergens: ["nitrites", "sesame"] })],
      lines: [ln("d", "w"), ln("d", "h", 2)],
    });
    const b = dishBadgesP(m, "d");
    expect(b.listsAllergens).toBe(false);
    expect(b.contains).toEqual([]);
    expect(b.mayContain).toEqual([]);
  });

  it("a wine sauce with only the alcohol tick (no category in the feed) is never Vegan or Vegetarian", () => {
    const m = feed({ dishes: [{ id: "d", name: "Sauce" }], ingredients: [rev("a", "Stock Concentrate", { allergens: ["alcohol"] })], lines: [ln("d", "a")] });
    expect(dishBadges(m, "d").diet.map((d) => `${d.id}:${d.state}`)).toEqual(["no_gluten_ingredients:is", "no_dairy_ingredients:is", "vegetarian:not_confirmed", "vegan:not_confirmed"]);
  });

  it("carries a GFO and a VGO option with their notes", () => {
    const m = feed({ dishes: [{ id: "d", name: "Burger", diet_options: { gfo: { note: "Use the GF bun" }, vgo: { note: "Plant patty, no aioli" }, vo: { note: "" } } }], ingredients: [rev("b", "Bun", { allergens: ["gluten"] })], lines: [ln("d", "b")] });
    expect(dishBadges(m, "d").options.map((o) => [o.letter, o.note])).toEqual([["GFO", "Use the GF bun"], ["VGO", "Plant patty, no aioli"]]);
  });

  it("seafood letters: all A is A, all I is I, both is M, an unset origin is Origin Not Confirmed, an exempt fish sauce is ignored", () => {
    const sea = (id: string, name: string, origin: string | null, extra: Record<string, unknown> = {}) => rev(id, name, { allergens: ["crustacea"], seafood_origin: origin, ...extra });
    const m = feed({
      dishes: ["a", "i", "m", "u", "x"].map((k) => ({ id: k, name: k, seafood_label: true })),
      ingredients: [sea("pa", "Prawns A", "A"), sea("ps", "Squid I", "I"), sea("pu", "Mussels", null), rev("fs", "Fish Sauce", { allergens: ["fish"], seafood_exempt: true })],
      lines: [ln("a", "pa"), ln("i", "ps"), ln("m", "pa"), ln("m", "ps", 2), ln("u", "pa"), ln("u", "pu", 2), ln("x", "fs")],
    });
    expect(dishBadges(m, "a").seafood).toEqual({ letter: "A", required: true });
    expect(dishBadges(m, "i").seafood).toEqual({ letter: "I", required: true });
    expect(dishBadges(m, "m").seafood).toEqual({ letter: "M", required: true });
    expect(dishBadges(m, "u").seafood).toMatchObject({ state: "origin_not_confirmed", missing: ["Mussels"] });
    expect(dishBadges(m, "x").seafood).toBeNull();
    expect(dishBadges(m, "x").contains).toContain("fish"); // exempt from the origin label, still an allergen
  });

  it("a prep carries no options and no required seafood letter", () => {
    const m = buildKitchenModel(parseKitchenData({ venue: { slug: "drift" }, preps: [{ id: "p", name: "P" }], ingredients: [rev("pa", "Prawns", { allergens: ["crustacea"], seafood_origin: "A" })], lines: [{ parent_type: "prep", parent_id: "p", component_type: "ingredient", component_id: "pa", qty: 1, unit: "kg" }] }, SYNCED)!);
    const b = prepBadges(m, "p");
    expect(b.options).toEqual([]);
    expect(b.seafood).toEqual({ letter: "A", required: false });
  });
});

describe("kitchen routes and photos", () => {
  it("opens only the kitchen routes", () => {
    for (const p of ["/kitchen", "/kitchen/drift", "/kitchen/setup", "/kitchen/manifest.webmanifest", "/kitchen/sw.js", "/kitchen/photo/uploads/a-1.jpg", "/api/kitchen/drift"]) expect(isKitchenPath(p)).toBe(true);
    for (const p of ["/", "/kitchens", "/kitchenette", "/menu", "/api/kitchen-data", "/items/kitchen", "/bar", "/api/bar/drift"]) expect(isKitchenPath(p)).toBe(false);
  });
  it("starts with Drift only, one line to add a venue", () => {
    expect([...KITCHEN_VENUES]).toEqual(["drift"]);
    expect(isKitchenVenue("drift")).toBe(true);
    expect(isKitchenVenue("chiobu")).toBe(false);
    expect(isKitchenVenue("../drift")).toBe(false);
  });
  it("serves uploaded photos through /kitchen/photo/ and nothing else", () => {
    expect(kitchenPhotoSrc("uploads/abc-1x.jpg")).toBe("/kitchen/photo/uploads/abc-1x.jpg");
    for (const bad of [null, undefined, "", "mai-tai.jpg", "uploads/../x.jpg", "/uploads/x.jpg", "uploads/x.svg", "https://x.test/a.jpg"]) expect(kitchenPhotoSrc(bad)).toBeNull();
  });
});

describe("station service workers", () => {
  const kitchen = stationWorkerSource({ scope: "/kitchen", cachePrefix: "kitchen", photoPrefixes: ["/kitchen/photo/"] });
  const bar = stationWorkerSource({ scope: "/bar", cachePrefix: "bar", photoPrefixes: ["/bar/cocktails/", "/bar/photo/"] });
  it("each keeps to its own scope, cache names and photos", () => {
    expect(kitchen).toContain('const SCOPE = "/kitchen"');
    expect(kitchen).toContain('const PREFIX = "kitchen-"');
    expect(kitchen).toContain('"/kitchen/photo/"');
    expect(kitchen).not.toMatch(/"\/bar|"bar-/);
    expect(bar).toContain('const SCOPE = "/bar"');
    expect(bar).toContain('const PREFIX = "bar-"');
    expect(bar).toContain('"/bar/cocktails/"');
    expect(bar).not.toMatch(/"\/kitchen|"kitchen-/);
  });
  it("is allowed to control only its station", async () => {
    expect(stationWorkerResponse({ scope: "/kitchen", cachePrefix: "kitchen", photoPrefixes: [] }).headers.get("Service-Worker-Allowed")).toBe("/kitchen");
    expect(stationWorkerResponse({ scope: "/bar", cachePrefix: "bar", photoPrefixes: [] }).headers.get("Service-Worker-Allowed")).toBe("/bar");
  });
});

describe("kitchen screens text contrast", () => {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  it("keeps every light text colour at 4.5:1 or better on the lightest card state (WCAG AA)", () => {
    const worstCard = "#232327"; // a pressed tile or the no-photo block
    const files = [...readdirSync("components/kitchen").map((f) => `components/kitchen/${f}`), "app/kitchen/page.tsx", "app/kitchen/setup/page.tsx"].filter((f) => f.endsWith(".tsx"));
    expect(files.length).toBeGreaterThan(3);
    const found = new Set<string>();
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(/(?:text|placeholder:text|stroke)-\[(#[0-9a-fA-F]{6})\]/g)) found.add(m[1].toUpperCase());
    }
    const light = [...found].filter((c) => lum(c) > 0.2); // dark text sits on light accent fills, checked by hand
    expect(light.length).toBeGreaterThan(0);
    for (const c of light) expect({ c, ratio: ratio(c, worstCard) >= 4.5 }).toEqual({ c, ratio: true });
  });
  it("keeps the amber warning, contains and diet chips readable on their own tinted backgrounds", () => {
    for (const [text, bg] of [["#F2C46D", "#2B2210"], ["#FFB3BC", "#2E1F23"], ["#8FD9A4", "#172619"]]) expect({ text, ok: ratio(text, bg) >= 4.5 }).toEqual({ text, ok: true });
  });
  it("keeps every allergen, dietary and seafood badge text at AA on its fill and on both stripes of a hatched fill", () => {
    for (const [name, t] of Object.entries(KB)) {
      const fills = [t.bg, "stripe" in t ? t.stripe : null].filter((c): c is string => !!c);
      for (const bg of fills) expect({ name, bg, ok: ratio(t.fg, bg) >= 4.5 }).toEqual({ name, bg, ok: true });
    }
    // the Contains badge is the loudest thing on the screen: well past AA (7:1, AAA)
    expect(ratio(KB.contains.fg, KB.contains.bg)).toBeGreaterThanOrEqual(7);
  });
  it("keeps every badge outline at 3:1 against the card it sits on (WCAG 1.4.11)", () => {
    for (const [name, t] of Object.entries(KB)) expect({ name, ok: !t.edge || ratio(t.edge, CARD_BG) >= 3 }).toEqual({ name, ok: true });
  });
  it("keeps the extra text greys used by the badge block at AA on the card", () => {
    for (const c of ["#9B9890", "#D0CCC2", "#EBD9B8", "#F5F3EE", "#F2C46D"]) expect({ c, ok: ratio(c, "#232327") >= 4.5 }).toEqual({ c, ok: true });
  });
  it("sets badge wording in one place: no em dashes and no bare Gluten Free claim", () => {
    for (const text of Object.values(BADGE_LABELS)) {
      expect(text.includes("—")).toBe(false);
      expect(/gluten[\s-]?free(?!\s+option)/i.test(text)).toBe(false);
    }
  });
});
