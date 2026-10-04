import { describe, expect, it } from "vitest";
import { buildIndex } from "@/lib/costing";
import { rollup, summarise, ALLERGENS, CONTAINS_IDS, SENSITIVITY_IDS, ATTRIBUTE_IDS, type AllergenIndex } from "@/lib/allergens";
import { badgeModel, seafoodBadge } from "@/lib/allergen-badges";
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
  it("puts sulphites in sensitivities and alcohol in attributes, never in the main list", () => {
    expect(SENSITIVITY_IDS).toEqual(["sulphites"]);
    expect(ATTRIBUTE_IDS).toEqual(["alcohol"]);
    expect(CONTAINS_IDS).not.toContain("sulphites");
    expect(CONTAINS_IDS).not.toContain("alcohol");
    expect(CONTAINS_IDS.slice(0, 11)).toEqual(["gluten", "crustacea", "egg", "fish", "milk", "peanuts", "sesame", "soy", "tree_nuts", "lupin", "molluscs"]);
    expect(CONTAINS_IDS.slice(11)).toEqual(["chilli", "onion_garlic"]);
    expect(ALLERGENS.find((a) => a.id === "sulphites")?.group).toBe("sensitivity");
    expect(ALLERGENS.find((a) => a.id === "alcohol")?.group).toBe("attribute");
  });

  it("summarise returns sulphites and alcohol in their own fields", () => {
    const { r } = dish([ing("w", "Chardonnay", ok({ allergens: ["sulphites", "alcohol", "milk"] })), ing("p", "Prosciutto", {})]);
    const s = summarise(r);
    expect(s.contains).toEqual(["milk"]);
    expect(s.sensitivities).toEqual(["sulphites"]);
    expect(s.attributes).toEqual(["alcohol"]);
    expect(s.may).toEqual([]);
  });

  it("keeps the stored ids: a suggested wine is a may-sensitivity and may-attribute, not a may-allergen", () => {
    const { r } = dish([ing("w", "Red Wine")]);
    const s = summarise(r);
    expect(s.may).toEqual([]);
    expect(s.sensitivitiesMay).toEqual(["sulphites"]);
    expect(s.attributesMay).toEqual(["alcohol"]);
  });
});

describe("badgeModel: drinks never show sulphites or alcohol", () => {
  const wine = () => [ing("w", "Chardonnay", ok({ allergens: ["sulphites", "alcohol", "milk"] }))];
  it("hides both tiers on a cocktail but keeps real allergens", () => {
    const m = model(wine(), { category: "Cocktail" });
    expect(m.sensitivities).toEqual([]);
    expect(m.sensitivitiesMay).toEqual([]);
    expect(m.attributes).toEqual([]);
    expect(m.attributesMay).toEqual([]);
    expect(m.contains).toEqual(["milk"]);
  });
  it("hides the suggested (may) tiers too, for every drink category", () => {
    for (const category of ["Cocktail", "Mocktail", "Wine", "Spirits", "Tap Beer", "Packaged Beer & Cider", "RTD"]) {
      const m = model([ing("w", "Red Wine")], { category });
      expect(m.sensitivitiesMay).toEqual([]);
      expect(m.attributesMay).toEqual([]);
    }
  });
  it("still shows them on food", () => {
    const m = model(wine(), { category: "Food" });
    expect(m.sensitivities).toEqual(["sulphites"]);
    expect(m.attributes).toEqual(["alcohol"]);
  });
});

describe("badgeModel: reviewed and unreviewed", () => {
  it("a fully reviewed dish with no allergens: nothing in the tiers, positive diet badges, no banner", () => {
    const m = model([ing("a", "Rice", ok()), ing("b", "Salt", ok())]);
    expect(m.notReviewed).toBeNull();
    expect(m.contains).toEqual([]);
    expect(m.sensitivities).toEqual([]);
    expect(dietIds(m)).toEqual(["no_gluten_ingredients:is", "no_dairy_ingredients:is", "vegetarian:is", "vegan:is"]);
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
    expect(m.diet.map((d) => d.id)).toEqual(["no_gluten_ingredients", "no_dairy_ingredients", "vegetarian", "vegan"]);
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
    expect(m.diet.find((d) => d.id === "no_dairy_ingredients")?.state).toBe("not_confirmed");
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

describe("badgeModel: sensitivities and alcohol", () => {
  it("a wine with sulphites: a sensitivity and Contains Alcohol, nothing in the allergen row", () => {
    const m = model([ing("w", "Sauvignon Blanc", ok({ allergens: ["sulphites", "alcohol"] }))]);
    expect(m.contains).toEqual([]);
    expect(m.sensitivities).toEqual(["sulphites"]);
    expect(m.attributes).toEqual(["alcohol"]);
    expect(m.notReviewed).toBeNull();
  });

  it("a spirit with alcohol only", () => {
    const m = model([ing("g", "Gin", ok({ allergens: ["alcohol"] }))]);
    expect(m.contains).toEqual([]);
    expect(m.sensitivities).toEqual([]);
    expect(m.attributes).toEqual(["alcohol"]);
  });

  it("unreviewed wine: suggestions land in the may-tiers only", () => {
    const m = model([ing("w", "Chardonnay Wine")]);
    expect(m.mayContain).toEqual([]);
    expect(m.sensitivitiesMay).toEqual(["sulphites"]);
    expect(m.attributesMay).toEqual(["alcohol"]);
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
    expect(m.options[0].label).toBe("Gluten Free Option, cross-contact possible");
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
    expect(DIET_OPTIONS[0].label).toBe("Gluten Free Option, cross-contact possible");
  });
  it("uses no em dashes", () => {
    const all = [...Object.values(BADGE_LABELS), ...DIET_OPTIONS.flatMap((o) => [o.label, o.definition]), ...SEAFOOD_LETTERS.flatMap((s) => [s.label, s.definition])];
    for (const text of all) expect(text.includes("—")).toBe(false);
  });
});
