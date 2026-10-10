import { describe, expect, it } from "vitest";
import { buildIndex } from "@/lib/costing";
import { rollup, summarise, ALLERGENS, ALLERGEN_IDS, CONTAINS_IDS, ATTRIBUTE_IDS, type AllergenIndex } from "@/lib/allergens";
import { badgeModel as badgeModelP, DRINK_ALLERGEN_IDS, FULL_ALLERGENS, isDrinkItem, MENU_ONLY, seafoodBadge, showsAllergen as showsAllergenP } from "@/lib/allergen-badges";

/** the original allergen-listing behaviour, kept under test; the app default is menu-only (see the last describe) */
const badgeModel = (r: Parameters<typeof badgeModelP>[0], item?: Parameters<typeof badgeModelP>[1]) => badgeModelP(r, item, FULL_ALLERGENS);
const showsAllergen = (item: Parameters<typeof showsAllergenP>[0], id: Parameters<typeof showsAllergenP>[1]) => showsAllergenP(item, id, FULL_ALLERGENS);
import { BADGE_LABELS, DIET_OPTIONS, SEAFOOD_LETTERS, dietLegendLines, seafoodLegendLines } from "@/lib/diet-legend";
import type { Ingredient, MenuItem, Prep, RecipeLine } from "@/lib/types";

const ing = (id: string, name: string, over: Partial<Ingredient> = {}): Ingredient =>
  ({ id, name, category: "Food", supplier_id: null, supplier_code: null, pack_size: 1, pack_unit: "kg", pack_price: 1, price_inc_gst: false, gst_free: false, rebate: 0, yield_pct: 1, venues: "All", active: true, last_price_update: null, previous_price: null, source: null, notes: null, updated_at: null, ...over }) as Ingredient;
const prep = (id: string, name: string, over: Partial<Prep> = {}): Prep => ({ id, name, venue_id: 1, prep_type: null, yield_qty: 1, yield_unit: "kg", active: true, source: null, notes: null, ...over });
const item = (id: string, name: string, over: Partial<MenuItem> = {}): MenuItem => ({ id, name, venue_id: 1, category: "Food", section: null, portions: 1, sell_price_inc: 10, target_override: null, hh_price_inc: null, active: true, source: null, notes: null, ...over });
let n = 0;
const line = (parent_type: "item" | "prep", parent_id: string, component_type: "ingredient" | "prep", component_id: string): RecipeLine => ({ id: `l${++n}`, parent_type, parent_id, component_type, component_id, qty: 1, unit: "g", note: null, sort: n });
const mk = (ingredients: Ingredient[], preps: Prep[], items: MenuItem[], lines: RecipeLine[]): AllergenIndex => ({ ...buildIndex(ingredients, preps, lines), items: new Map(items.map((i) => [i.id, i])) });
const ok = (o: Partial<Ingredient> = {}): Partial<Ingredient> => ({ allergens_reviewed: true, ...o });

/** one dish "d" made of the given ingredients (all direct lines) */
function dish(ings: Ingredient[], over: Partial<MenuItem> = {}) {
  const d = item("d", "Dish", over);
  const index = mk(ings, [], [d], ings.map((i) => line("item", "d", "ingredient", i.id)));
  return { d, r: rollup({ kind: "item", id: "d" }, index) };
}
const model = (ings: Ingredient[], over: Partial<MenuItem> = {}) => {
  const { d, r } = dish(ings, over);
  return badgeModel(r, d);
};
const dietIds = (m: ReturnType<typeof badgeModel>) => m.diet.map((x) => `${x.id}:${x.state}`);

describe("allergen groups", () => {
  it("puts sulphites in the main list (required, after Molluscs), nitrites in the main list (chef extra, last) and alcohol in attributes", () => {
    expect(ATTRIBUTE_IDS).toEqual(["alcohol"]);
    expect(CONTAINS_IDS).not.toContain("alcohol");
    expect(CONTAINS_IDS).toEqual(["gluten", "crustacea", "egg", "fish", "milk", "peanuts", "sesame", "soy", "tree_nuts", "lupin", "molluscs", "sulphites", "chilli", "onion_garlic", "nitrites"]);
    expect(ALLERGEN_IDS).toEqual([...CONTAINS_IDS, "alcohol"]);
    expect(ALLERGENS.find((a) => a.id === "sulphites")?.group).toBe("required");
    expect(ALLERGENS.find((a) => a.id === "nitrites")?.group).toBe("extra");
    expect(ALLERGENS.find((a) => a.id === "alcohol")?.group).toBe("attribute");
    // the quiet "sensitivity" tier is gone: every group is one of the three
    expect(new Set(ALLERGENS.map((a) => a.group))).toEqual(new Set(["required", "extra", "attribute"]));
    expect(ALLERGENS.find((a) => a.id === "sulphites")?.label).toBe("Sulphites");
    expect(ALLERGENS.find((a) => a.id === "nitrites")?.label).toBe("Nitrites");
  });

  it("summarise lists sulphites with the main allergens and alcohol in its own fields", () => {
    const { r } = dish([ing("w", "Chardonnay", ok({ allergens: ["sulphites", "alcohol", "milk"] })), ing("p", "Prosciutto", ok({ allergens: ["nitrites"] }))]);
    const s = summarise(r);
    expect(s.contains).toEqual(["milk", "sulphites", "nitrites"]);
    expect(s.attributes).toEqual(["alcohol"]);
    expect(s.may).toEqual([]);
    expect("sensitivities" in s).toBe(false);
  });

  it("keeps the stored ids: a suggested wine is a may-allergen (sulphites) and a may-attribute (alcohol)", () => {
    const { r } = dish([ing("w", "Red Wine")]);
    const s = summarise(r);
    expect(s.may).toEqual(["sulphites"]);
    expect(s.attributesMay).toEqual(["alcohol"]);
  });
});

describe("badgeModel: drinks mark only egg, milk, nuts and sulphites", () => {
  const rich = () => [ing("w", "Amaretto", ok({ allergens: ["sulphites", "alcohol", "milk", "tree_nuts", "gluten", "soy", "egg", "fish"] }))];
  it("lists egg, milk, nuts and sulphites and nothing else on a cocktail (a design call, 10 Oct 2026)", () => {
    const m = model(rich(), { category: "Cocktail" });
    expect(m.contains).toEqual(["egg", "milk", "tree_nuts", "sulphites"]);
    expect(DRINK_ALLERGEN_IDS).toEqual(["egg", "milk", "peanuts", "tree_nuts", "sulphites"]);
    expect(m.attributes).toEqual([]);
    expect(m.diet).toEqual([]);
    expect(m.options).toEqual([]);
    expect(m.seafood).toBeNull();
  });
  it("never mentions gluten or gluten free on any drink category, even with a gluten option on the item", () => {
    for (const category of ["Cocktail", "Mocktail", "Cold Drink", "Wine", "Spirits", "Tap Beer", "Packaged Beer & Cider", "RTD"]) {
      const m = model([ing("b", "Lager", ok({ allergens: ["gluten"] }))], { category, diet_options: { gfo: { note: "Use a cider" } } as never });
      expect(m.contains).not.toContain("gluten");
      expect(m.diet.map((d) => d.id)).not.toContain("no_gluten_ingredients");
      expect(m.options).toEqual([]);
    }
  });
  it("an unreviewed wine drink may contain sulphites but never alcohol", () => {
    const m = model([ing("w", "Red Wine")], { category: "Wine" });
    expect(m.mayContain).toEqual(["sulphites"]);
    expect(m.attributesMay).toEqual([]);
  });
  it("nitrites, seeds and the rest are never listed on a drink, even when ticked", () => {
    const m = model([ing("b", "Bacon Jam", ok({ allergens: ["nitrites", "sesame", "soy", "gluten", "chilli"] }))], { category: "Cocktail" });
    expect(m.contains).toEqual([]);
    expect(showsAllergen({ category: "Cocktail" }, "nitrites")).toBe(false);
    expect(showsAllergen({ category: "Cocktail" }, "sesame")).toBe(false);
    expect(showsAllergen({ category: "Cocktail" }, "sulphites")).toBe(true);
  });
  it("still shows the declared allergens on food", () => {
    const m = model(rich(), { category: "Food" });
    expect(m.contains).toContain("gluten");
    expect(m.contains).toContain("fish");
    expect(m.contains).toContain("sulphites");
    expect(m.attributes).toEqual([]);
  });
  it("showsAllergen and isDrinkItem agree", () => {
    expect(isDrinkItem({ category: "Mocktail" })).toBe(true);
    expect(isDrinkItem({ category: "Cold Drink" })).toBe(true);
    expect(isDrinkItem({ category: "Food" })).toBe(false);
    expect(showsAllergen({ category: "Cocktail" }, "gluten")).toBe(false);
    expect(showsAllergen({ category: "Cocktail" }, "tree_nuts")).toBe(true);
    expect(showsAllergen({ category: "Food" }, "gluten")).toBe(true);
    expect(showsAllergen(null, "gluten")).toBe(true);
  });
});

describe("badgeModel: reviewed and unreviewed", () => {
  it("a fully reviewed dish with no allergens: nothing in the tiers, positive diet badges, no banner", () => {
    const m = model([ing("a", "Rice", ok()), ing("b", "Salt", ok())]);
    expect(m.notReviewed).toBeNull();
    expect(m.contains).toEqual([]);
    expect(dietIds(m)).toEqual(["no_gluten_ingredients:is", "vegetarian:is", "vegan:is"]);
    expect(m.options).toEqual([]);
    expect(m.seafood).toBeNull();
  });

  it("a reviewed dish with gluten and milk: contains in fixed order, no gluten or dairy badge, vegetarian but not vegan", () => {
    const m = model([ing("f", "Plain Flour", ok({ allergens: ["gluten"] })), ing("m", "Milk", ok({ allergens: ["milk"] }))]);
    expect(m.contains).toEqual(["gluten", "milk"]);
    expect(dietIds(m)).toEqual(["vegetarian:is"]);
    expect(m.notReviewed).toBeNull();
  });

  it("an unreviewed ingredient gives the banner and no positive badge at all", () => {
    const m = model([ing("a", "Rice", ok()), ing("x", "Mystery Powder")]);
    expect(m.notReviewed).toEqual({ unreviewedNames: ["Mystery Powder"] });
    expect(m.diet.every((d) => d.state === "not_confirmed")).toBe(true);
    expect(m.diet.map((d) => d.id)).toEqual(["no_gluten_ingredients", "vegetarian", "vegan"]);
  });

  it("an unreviewed recipe that already contains gluten drops the gluten badge but keeps the banner and the known allergen", () => {
    const m = model([ing("f", "Plain Flour", { allergens: ["gluten"] }), ing("x", "Mystery Powder")]);
    expect(m.notReviewed).not.toBeNull();
    expect(m.contains).toEqual(["gluten"]);
    expect(m.diet.find((d) => d.id === "no_gluten_ingredients")).toBeUndefined();
  });

  it("a suggested (keyword) allergen on an unreviewed ingredient is mayContain, never contains", () => {
    const m = model([ing("c", "Mozzarella")]);
    expect(m.contains).toEqual([]);
    expect(m.mayContain).toEqual(["milk"]);
    // there is no dairy free badge at all (Troy, 10 Oct 2026): dairy shows only as the Dairy Free Option
    expect(m.diet.map((d) => d.id as string)).not.toContain("no_dairy_ingredients");
  });

  it("an empty recipe is not reviewed and claims nothing", () => {
    const d = item("d", "Empty");
    const r = rollup({ kind: "item", id: "d" }, mk([], [], [d], []));
    const m = badgeModel(r, d);
    expect(m.notReviewed).toEqual({ unreviewedNames: [] });
    expect(m.diet.every((x) => x.state === "not_confirmed")).toBe(true);
  });

  it("a missing component keeps it not reviewed", () => {
    const d = item("d", "Dish");
    const index = mk([ing("a", "Rice", ok())], [], [d], [line("item", "d", "ingredient", "a"), line("item", "d", "ingredient", "ghost")]);
    const m = badgeModel(rollup({ kind: "item", id: "d" }, index), d);
    expect(m.notReviewed?.unreviewedNames).toEqual(["Unknown ingredient"]);
    expect(m.diet.every((x) => x.state === "not_confirmed")).toBe(true);
  });
});

describe("badgeModel: nested preps", () => {
  const build = (sauceIng: Ingredient, extra: Partial<Prep> = {}) => {
    const sauce = prep("sauce", "Sauce", extra);
    const base = prep("base", "Base", {});
    const d = item("d", "Dish");
    const index = mk(
      [sauceIng, ing("r", "Rice", ok())],
      [sauce, base],
      [d],
      [line("prep", "base", "ingredient", sauceIng.id), line("prep", "sauce", "prep", "base"), line("item", "d", "prep", "sauce"), line("item", "d", "ingredient", "r")],
    );
    return badgeModel(rollup({ kind: "item", id: "d" }, index), d);
  };

  it("gluten two preps deep still removes the positive badge and shows contains", () => {
    const m = build(ing("g", "Soy Sauce", ok({ allergens: ["gluten", "soy"] })));
    expect(m.contains).toEqual(["gluten", "soy"]);
    expect(m.diet.find((d) => d.id === "no_gluten_ingredients")).toBeUndefined();
  });

  it("an unreviewed ingredient two preps deep triggers the banner and not_confirmed", () => {
    const m = build(ing("g", "Mystery Paste"));
    expect(m.notReviewed?.unreviewedNames).toEqual(["Mystery Paste"]);
    expect(m.diet.find((d) => d.id === "no_gluten_ingredients")?.state).toBe("not_confirmed");
  });

  it("a fully reviewed nest earns the positive badges", () => {
    const m = build(ing("g", "Tomato", ok()));
    expect(m.notReviewed).toBeNull();
    expect(m.diet.find((d) => d.id === "no_gluten_ingredients")?.state).toBe("is");
  });

  it("an allergen the chef cleared by hand never earns the positive badge", () => {
    const m = build(ing("g", "Soy Sauce", ok({ allergens: ["gluten"] })), { allergen_remove: ["gluten"] });
    expect(m.contains).toEqual([]);
    expect(m.diet.find((d) => d.id === "no_gluten_ingredients")?.state).toBe("not_confirmed");
  });
});

describe("badgeModel: sulphites are listed, alcohol never is", () => {
  it("a wine with sulphites and alcohol ticked lists sulphites (not alcohol), on food and drinks", () => {
    for (const category of ["Food", "Cocktail", "Wine"]) {
      const m = model([ing("w", "Sauvignon Blanc", ok({ allergens: ["sulphites", "alcohol"] }))], { category });
      expect(m.contains).toEqual(["sulphites"]);
      expect(m.attributes).toEqual([]);
      expect(m.attributesMay).toEqual([]);
    }
  });
  it("an unreviewed wine suggests sulphites as unconfirmed and nothing for alcohol", () => {
    const m = model([ing("w", "Chardonnay Wine")]);
    expect(m.mayContain).toEqual(["sulphites"]);
    expect(m.attributesMay).toEqual([]);
  });
  it("nitrites list with the main allergens, after Onion & Garlic", () => {
    const m = model([ing("b", "Bacon", ok({ allergens: ["nitrites", "onion_garlic", "sulphites", "molluscs"] }))]);
    expect(m.contains).toEqual(["molluscs", "sulphites", "onion_garlic", "nitrites"]);
  });
  it("the ticks stay recorded in the roll-up for the record", () => {
    const { r } = dish([ing("w", "Sauvignon Blanc", ok({ allergens: ["sulphites", "alcohol"] }))]);
    expect(r.cells.sulphites.state).toBe("contains");
    expect(r.cells.alcohol.state).toBe("contains");
  });
  it("showsAllergen allows sulphites and nitrites on food and never alcohol", () => {
    expect(showsAllergen({ category: "Food" }, "sulphites")).toBe(true);
    expect(showsAllergen({ category: "Food" }, "nitrites")).toBe(true);
    expect(showsAllergen({ category: "Cocktail" }, "alcohol")).toBe(false);
    expect(showsAllergen(null, "alcohol")).toBe(false);
  });
});

describe("badgeModel: dietary options", () => {
  const base = [ing("a", "Bun", ok({ allergens: ["gluten"] }))];
  it("lists options in fixed order with their notes, trimmed", () => {
    const m = model(base, { diet_options: { dfo: { note: " No cheese " }, gfo: { note: "Swap the bun for a gluten free bun" }, vgo: { note: "No egg" } } });
    expect(m.options.map((o) => [o.id, o.letter, o.note])).toEqual([
      ["gfo", "GFO", "Swap the bun for a gluten free bun"],
      ["vgo", "VGO", "No egg"],
      ["dfo", "DFO", "No cheese"],
    ]);
  });
  it("the GFO label is the cautious wording and never the bare claim", () => {
    const m = model(base, { diet_options: { gfo: { note: "Swap the bun" } } });
    expect(m.options[0].label).toBe("Gluten Free Option Available");
    // a dish that contains gluten and offers a GFO still has no 'No Gluten Ingredients' badge
    expect(m.diet.find((d) => d.id === "no_gluten_ingredients")).toBeUndefined();
  });
  it("an option without a note is not shown as an option (and is reported)", () => {
    const m = model(base, { diet_options: { gfo: { note: "  " }, vo: { note: "No bacon" } } });
    expect(m.options.map((o) => o.id)).toEqual(["vo"]);
    expect(m.optionsMissingNote).toEqual(["gfo"]);
  });
  it("copes with null, empty and malformed diet_options", () => {
    expect(model(base, { diet_options: null }).options).toEqual([]);
    expect(model(base, { diet_options: {} }).options).toEqual([]);
    expect(model(base, { diet_options: { gfo: null } as unknown as MenuItem["diet_options"] }).options).toEqual([]);
  });
  it("options never need the recipe to be reviewed: they are the chef's own flag", () => {
    const m = model([ing("x", "Mystery")], { diet_options: { vo: { note: "No bacon" } } });
    expect(m.options).toHaveLength(1);
    expect(m.notReviewed).not.toBeNull();
  });
});

describe("badgeModel: seafood origin", () => {
  const sea = (id: string, name: string, allergen: string, over: Partial<Ingredient> = {}) => ing(id, name, ok({ allergens: [allergen], ...over }));
  it("all Australian is A", () => {
    const m = model([sea("p", "Prawns", "crustacea", { seafood_origin: "A" }), sea("b", "Barramundi", "fish", { seafood_origin: "A" })], { seafood_label: true });
    expect(m.seafood).toEqual({ letter: "A", required: true });
  });
  it("all imported is I (New Zealand counts as imported)", () => {
    const m = model([sea("m", "NZ Mussels", "molluscs", { seafood_origin: "I" })], { seafood_label: true });
    expect(m.seafood).toEqual({ letter: "I", required: true });
  });
  it("both is M", () => {
    const m = model([sea("p", "Prawns", "crustacea", { seafood_origin: "A" }), sea("s", "Squid", "molluscs", { seafood_origin: "I" })], { seafood_label: true });
    expect(m.seafood).toEqual({ letter: "M", required: true });
  });
  it("any non-exempt seafood with no origin makes it origin not confirmed, even if the rest are set", () => {
    const m = model([sea("p", "Prawns", "crustacea", { seafood_origin: "A" }), sea("s", "Squid", "molluscs")], { seafood_label: true });
    expect(m.seafood).toEqual({ state: "origin_not_confirmed", required: true, missing: ["Squid"] });
  });
  it("exempt ingredients are ignored (fish sauce, canned tuna)", () => {
    const m = model([sea("p", "Prawns", "crustacea", { seafood_origin: "A" }), sea("f", "Fish Sauce", "fish", { seafood_exempt: true })], { seafood_label: true });
    expect(m.seafood).toEqual({ letter: "A", required: true });
    const only = model([sea("f", "Fish Sauce", "fish", { seafood_exempt: true })], { seafood_label: true });
    expect(only.seafood).toBeNull();
  });
  it("seafood_label false: still computed, flagged not required", () => {
    const m = model([sea("p", "Prawns", "crustacea", { seafood_origin: "I" })], { seafood_label: false });
    expect(m.seafood).toEqual({ letter: "I", required: false });
    const unk = model([sea("p", "Prawns", "crustacea")]);
    expect(unk.seafood).toMatchObject({ state: "origin_not_confirmed", required: false });
  });
  it("rolls up through nested preps", () => {
    const stock = prep("stock", "Seafood Mix");
    const d = item("d", "Marinara", { seafood_label: true });
    const p = sea("p", "Prawns", "crustacea", { seafood_origin: "A" });
    const s = sea("s", "Squid", "molluscs", { seafood_origin: "I" });
    const index = mk([p, s], [stock], [d], [line("prep", "stock", "ingredient", "p"), line("item", "d", "prep", "stock"), line("item", "d", "ingredient", "s")]);
    expect(badgeModel(rollup({ kind: "item", id: "d" }, index), d).seafood).toEqual({ letter: "M", required: true });
  });
  it("a non-seafood dish has no seafood entry", () => {
    expect(model([ing("a", "Rice", ok())], { seafood_label: true }).seafood).toBeNull();
  });
  it("an unreviewed ingredient whose name says fish counts as seafood with no origin", () => {
    expect(model([ing("a", "Barramundi Fillet")]).seafood).toMatchObject({ state: "origin_not_confirmed", missing: ["Barramundi Fillet"] });
  });
  it("seafoodBadge works on a roll-up directly", () => {
    const { r } = dish([sea("p", "Prawns", "crustacea", { seafood_origin: "A" })]);
    expect(seafoodBadge(r, true)).toEqual({ letter: "A", required: true });
  });
});

describe("legend wording", () => {
  it("has the four options and three seafood letters, and no NZ letter", () => {
    expect(DIET_OPTIONS.map((o) => o.letter)).toEqual(["GFO", "VO", "VGO", "DFO"]);
    expect(SEAFOOD_LETTERS.map((s) => s.letter)).toEqual(["A", "I", "M"]);
    expect(dietLegendLines()).toHaveLength(4);
    expect(seafoodLegendLines()).toHaveLength(3);
  });
  it("never prints the bare claim 'Gluten Free' anywhere in the shared wording", () => {
    const all = [...Object.values(BADGE_LABELS), ...DIET_OPTIONS.flatMap((o) => [o.label, o.definition]), ...SEAFOOD_LETTERS.flatMap((s) => [s.label, s.definition])];
    for (const text of all) expect(/gluten[\s-]?free(?!\s+option)/i.test(text)).toBe(false);
    expect(BADGE_LABELS.noGlutenIngredients).toBe("No Gluten Ingredients");
    expect(DIET_OPTIONS[0].label).toBe("Gluten Free Option Available");
  });
  it("uses no em dashes", () => {
    const all = [...Object.values(BADGE_LABELS), ...DIET_OPTIONS.flatMap((o) => [o.label, o.definition]), ...SEAFOOD_LETTERS.flatMap((s) => [s.label, s.definition])];
    for (const text of all) expect(text.includes("—")).toBe(false);
  });
});

describe("menu-only default (Troy, 4 Oct 2026): only what the printed menu shows", () => {
  const wine = () => [ing("w", "Amaretto Cream", ok({ allergens: ["milk", "tree_nuts", "gluten", "egg", "fish", "sulphites", "alcohol"] }))];
  it("lists no allergen, no computed diet badge and no review banner, on food or drinks", () => {
    for (const category of ["Food", "Cocktail", "Wine"]) {
      const { d, r } = dish(wine(), { category });
      const m = badgeModelP(r, d);
      expect(m.listsAllergens).toBe(false);
      expect(m.contains).toEqual([]);
      expect(m.mayContain).toEqual([]);
      expect(m.attributes).toEqual([]);
      expect(m.diet).toEqual([]);
      expect(m.notes).toEqual([]);
      expect(m.notReviewed).toBeNull();
    }
  });
  it("an unreviewed dish shows no banner", () => {
    const { d, r } = dish([ing("x", "Mystery")]);
    expect(badgeModelP(r, d).notReviewed).toBeNull();
    expect(badgeModelP(r, d, FULL_ALLERGENS).notReviewed).not.toBeNull();
  });
  it("still shows the option letters and the seafood letter, in the menu's wording", () => {
    const { d, r } = dish([ing("p", "Prawns", ok({ allergens: ["crustacea"], seafood_origin: "I" as never }))], { seafood_label: true, diet_options: { gfo: { note: "GF bun" }, dfo: { note: "No cheese" } } as never });
    const m = badgeModelP(r, d);
    expect(m.options.map((o) => [o.letter, o.label])).toEqual([["GFO", "Gluten Free Option Available"], ["DFO", "Dairy Free Option"]]);
    expect(m.seafood).toEqual({ letter: "I", required: true });
  });
  it("drinks carry no option letters or seafood", () => {
    const { d, r } = dish(wine(), { category: "Cocktail", seafood_label: true, diet_options: { gfo: { note: "x" } } as never });
    const m = badgeModelP(r, d);
    expect(m.options).toEqual([]);
    expect(m.seafood).toBeNull();
  });
  it("showsAllergen is false for everything by default, and the policy is one switch", () => {
    expect(showsAllergenP({ category: "Food" }, "milk")).toBe(false);
    expect(MENU_ONLY.allergens).toEqual([]);
    expect(showsAllergenP({ category: "Food" }, "milk", FULL_ALLERGENS)).toBe(true);
  });
  it("the ticks stay recorded in the roll-up", () => {
    const { r } = dish(wine());
    expect(r.cells.milk.state).toBe("contains");
  });
});
