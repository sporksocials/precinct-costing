import { describe, expect, it } from "vitest";
import { buildIndex } from "@/lib/costing";
import { beerItemId } from "@/lib/beer";
import { virtualItemId } from "@/lib/gelato";
import {
  dietTags,
  isFreeFrom,
  ingredientAllergenState,
  matrixRows,
  rollup,
  suggestAllergens,
  suggestDietFlags,
  withDraft,
  type AllergenIndex,
} from "@/lib/allergens";
import type { Ingredient, MenuItem, Prep, RecipeLine } from "@/lib/types";

const ids = (name: string, desc?: string) => suggestAllergens(name, desc).map((s) => s.id).sort();

describe("suggestAllergens", () => {
  it("matches the AU foodservice vocabulary", () => {
    expect(ids("Mozzarella Shredded")).toEqual(["milk"]);
    expect(ids("Parmesan Grated")).toEqual(["milk"]);
    expect(ids("Thickened Cream")).toEqual(["milk"]);
    expect(ids("Butter Unsalted")).toEqual(["milk"]);
    expect(ids("Ricotta")).toEqual(["milk"]);
    expect(ids("Plain Flour")).toEqual(["gluten"]);
    expect(ids("Panko Crumbs")).toEqual(["gluten"]);
    expect(ids("Brioche Bun")).toEqual(["egg", "gluten"]);
    expect(ids("King Prawns 16/20")).toEqual(["crustacea"]);
    expect(ids("Calamari Tubes")).toEqual(["molluscs"]);
    expect(ids("Oysters Pacific")).toEqual(["molluscs"]);
    expect(ids("Barramundi Fillet")).toEqual(["fish"]);
    expect(ids("Anchovies in Oil")).toEqual(["fish"]);
    expect(ids("Kewpie Mayo")).toEqual(["egg"]);
    expect(ids("Satay Sauce")).toEqual(["peanuts"]);
    expect(ids("Macadamia Nuts")).toEqual(["tree_nuts"]);
    expect(ids("Tahini")).toEqual(["sesame"]);
    expect(ids("Firm Tofu")).toEqual(["soy"]);
    expect(ids("Lupin Flour")).toEqual(["gluten", "lupin"]);
    expect(ids("Sriracha")).toEqual(["chilli"]);
    expect(ids("Jalapeño Pickled")).toEqual(["chilli", "sulphites"]);
    expect(ids("Red Shallots")).toEqual(["onion_garlic"]);
    expect(ids("Dark Rum")).toEqual(["alcohol"]);
    expect(ids("Red Wine Vinegar")).toEqual(["alcohol", "sulphites"]);
  });

  it("soy sauce is gluten and soy; aioli is milk, egg and garlic", () => {
    expect(ids("Soy Sauce")).toEqual(["gluten", "soy"]);
    expect(ids("Garlic Aioli")).toEqual(["egg", "milk", "onion_garlic"]);
  });

  it("uses word boundaries and plurals", () => {
    expect(ids("Eggplant")).toEqual([]);
    expect(ids("Eggs Free Range")).toEqual(["egg"]);
    expect(ids("Ginger")).toEqual([]);
    expect(ids("Gin 700ml")).toEqual(["alcohol"]);
    expect(ids("Ginger Beer")).toEqual([]);
    expect(ids("Pale Ale Keg")).toEqual(["alcohol", "gluten"]);
    expect(ids("Chickpeas")).toEqual([]);
  });

  it("does not call plant milks and flours dairy or gluten", () => {
    expect(ids("Coconut Milk")).toEqual([]);
    expect(ids("Coconut Cream")).toEqual([]);
    expect(ids("Peanut Butter")).toEqual(["peanuts"]);
    expect(ids("Rice Flour")).toEqual([]);
    expect(ids("Cornflour")).toEqual([]);
    expect(ids("Almond Milk")).toEqual(["tree_nuts"]);
    expect(ids("Gluten Free Bread")).toEqual([]);
    expect(ids("Butternut Pumpkin")).toEqual([]);
  });

  it("reads the supplier description too and reports the matched keyword", () => {
    expect(suggestAllergens("House Sauce 5L", "Contains prawn paste")).toEqual([{ id: "crustacea", keyword: "prawn" }]);
    expect(suggestAllergens("Parmesan")[0]).toEqual({ id: "milk", keyword: "parmesan" });
  });

  it("suggests animal flags", () => {
    const f = (n: string) => suggestDietFlags(n).map((s) => s.flag).sort();
    expect(f("Bacon Rashers")).toEqual(["meat"]);
    expect(f("Mozzarella")).toEqual(["dairy"]);
    expect(f("Barramundi")).toEqual(["fish"]);
    expect(f("Hot Honey")).toEqual(["honey"]);
    expect(f("Goat Cheese")).toEqual(["dairy"]);
  });
});

/* ---------------------------------------------------------------- roll-up fixtures */

const ing = (id: string, name: string, over: Partial<Ingredient> = {}): Ingredient =>
  ({ id, name, category: null, supplier_id: null, supplier_code: null, pack_size: 1, pack_unit: "kg", pack_price: 1, price_inc_gst: false, gst_free: false, rebate: 0, yield_pct: 1, venues: null, active: true, last_price_update: null, previous_price: null, source: null, notes: null, updated_at: null, ...over }) as Ingredient;
const prep = (id: string, name: string, over: Partial<Prep> = {}): Prep => ({ id, name, venue_id: 1, prep_type: null, yield_qty: 1, yield_unit: "kg", active: true, source: null, notes: null, ...over });
const item = (id: string, name: string, over: Partial<MenuItem> = {}): MenuItem => ({ id, name, venue_id: 1, category: "Food", section: null, portions: 1, sell_price_inc: 10, target_override: null, hh_price_inc: null, active: true, source: null, notes: null, ...over });
let n = 0;
const line = (parent_type: "item" | "prep", parent_id: string, component_type: "ingredient" | "prep", component_id: string): RecipeLine => ({ id: `l${++n}`, parent_type, parent_id, component_type, component_id, qty: 1, unit: "g", note: null, sort: n });

function mk(ingredients: Ingredient[], preps: Prep[], items: MenuItem[], lines: RecipeLine[]): AllergenIndex {
  return { ...buildIndex(ingredients, preps, lines), items: new Map(items.map((i) => [i.id, i])) };
}

const reviewed = (o: Partial<Ingredient> = {}): Partial<Ingredient> => ({ allergens_reviewed: true, ...o });

describe("rollup", () => {
  it("confirmed ticks are contains, keyword-only is may_contain, and both name their source", () => {
    const index = mk(
      [ing("flour", "Plain Flour", reviewed({ allergens: ["gluten"] })), ing("cheese", "Mozzarella"), ing("salt", "Salt", reviewed())],
      [],
      [item("d", "Pizza")],
      [line("item", "d", "ingredient", "flour"), line("item", "d", "ingredient", "cheese"), line("item", "d", "ingredient", "salt")],
    );
    const r = rollup({ kind: "item", id: "d" }, index);
    expect(r.cells.gluten).toMatchObject({ state: "contains", sources: ["Plain Flour"] });
    expect(r.cells.milk).toMatchObject({ state: "may_contain", sources: ["Mozzarella"] });
    expect(r.cells.egg.state).toBe("none");
    expect(r.unreviewed).toEqual(["Mozzarella"]);
    expect(r.reviewed).toBe(false);
  });

  it("never says free-from while any ingredient is unreviewed", () => {
    const index = mk([ing("a", "Salt", reviewed()), ing("b", "Mystery Powder")], [], [item("d", "Dish")], [line("item", "d", "ingredient", "a"), line("item", "d", "ingredient", "b")]);
    const r = rollup({ kind: "item", id: "d" }, index);
    expect(r.cells.peanuts.state).toBe("none");
    expect(isFreeFrom(r, "peanuts")).toBe(false);
    expect(r.unreviewedCount).toBe(1);
  });

  it("is free-from only when every ingredient is reviewed", () => {
    const index = mk([ing("a", "Salt", reviewed()), ing("b", "Flour", reviewed({ allergens: ["gluten"] }))], [], [item("d", "Dish")], [line("item", "d", "ingredient", "a"), line("item", "d", "ingredient", "b")]);
    const r = rollup({ kind: "item", id: "d" }, index);
    expect(r.reviewed).toBe(true);
    expect(isFreeFrom(r, "gluten")).toBe(false);
    expect(isFreeFrom(r, "milk")).toBe(true);
  });

  it("an empty dish is not reviewed", () => {
    const r = rollup({ kind: "item", id: "d" }, mk([], [], [item("d", "Dish")], []));
    expect(r.reviewed).toBe(false);
    expect(isFreeFrom(r, "milk")).toBe(false);
  });

  it("marking an ingredient reviewed drops its unconfirmed suggestions", () => {
    const st = ingredientAllergenState(ing("x", "Mozzarella", reviewed({ allergens: [] })));
    expect(st.suggested).toEqual([]);
    expect(ingredientAllergenState(ing("x", "Mozzarella")).suggested).toHaveLength(1);
  });

  it("rolls up through nested preps and de-duplicates ingredients", () => {
    const index = mk(
      [ing("egg", "Egg", reviewed({ allergens: ["egg"] })), ing("oil", "Oil", reviewed()), ing("nut", "Cashews", reviewed({ allergens: ["tree_nuts"] }))],
      [prep("mayo", "Mayo"), prep("sauce", "House Sauce")],
      [item("d", "Burger")],
      [
        line("prep", "mayo", "ingredient", "egg"),
        line("prep", "mayo", "ingredient", "oil"),
        line("prep", "sauce", "prep", "mayo"),
        line("prep", "sauce", "ingredient", "nut"),
        line("item", "d", "prep", "sauce"),
        line("item", "d", "prep", "mayo"),
        line("item", "d", "ingredient", "oil"),
      ],
    );
    const r = rollup({ kind: "item", id: "d" }, index);
    expect(r.cells.egg).toMatchObject({ state: "contains", sources: ["Egg"] });
    expect(r.cells.tree_nuts.state).toBe("contains");
    expect(r.ingredientCount).toBe(3);
    expect(r.reviewed).toBe(true);
  });

  it("stops on cycles and keeps the dish not reviewed", () => {
    const index = mk([ing("a", "Salt", reviewed())], [prep("p1", "P1"), prep("p2", "P2")], [item("d", "Dish")], [line("prep", "p1", "prep", "p2"), line("prep", "p2", "prep", "p1"), line("prep", "p2", "ingredient", "a"), line("item", "d", "prep", "p1")]);
    const r = rollup({ kind: "item", id: "d" }, index);
    expect(r.problems).toContain("cycle");
    expect(r.reviewed).toBe(false);
    expect(r.unreviewed.join(" ")).toContain("loops back");
    expect(rollup({ kind: "prep", id: "p1" }, index).problems).toContain("cycle");
  });

  it("stops at depth 5 and says so", () => {
    const preps = [0, 1, 2, 3, 4, 5, 6].map((i) => prep(`p${i}`, `P${i}`));
    const lines = [0, 1, 2, 3, 4, 5].map((i) => line("prep", `p${i}`, "prep", `p${i + 1}`));
    lines.push(line("prep", "p6", "ingredient", "a"), line("item", "d", "prep", "p0"));
    const r = rollup({ kind: "item", id: "d" }, mk([ing("a", "Salt", reviewed())], preps, [item("d", "Dish")], lines));
    expect(r.problems).toContain("depth");
    expect(r.reviewed).toBe(false);
  });

  it("flags a missing ingredient as unreviewed", () => {
    const r = rollup({ kind: "item", id: "d" }, mk([], [], [item("d", "Dish")], [line("item", "d", "ingredient", "ghost")]));
    expect(r.problems).toContain("missing");
    expect(r.reviewed).toBe(false);
  });

  it("ignores blank lines still being built", () => {
    const blank = { ...line("item", "d", "ingredient", ""), component_id: "" };
    const r = rollup({ kind: "item", id: "d" }, mk([ing("a", "Salt", reviewed())], [], [item("d", "Dish")], [line("item", "d", "ingredient", "a"), blank]));
    expect(r.reviewed).toBe(true);
  });

  it("chef add forces contains with source Chef", () => {
    const index = mk([ing("a", "Salt", reviewed())], [], [item("d", "Dish", { allergen_add: ["sesame"] })], [line("item", "d", "ingredient", "a")]);
    const r = rollup({ kind: "item", id: "d" }, index);
    expect(r.cells.sesame).toMatchObject({ state: "contains", sources: ["Chef"], chef: "added" });
    expect(isFreeFrom(r, "sesame")).toBe(false);
  });

  it("chef remove clears the allergen but stays visible", () => {
    const index = mk([ing("c", "Mozzarella")], [], [item("d", "Dish", { allergen_remove: ["milk"], allergen_notes: { milk: "no cheese" } })], [line("item", "d", "ingredient", "c")]);
    const r = rollup({ kind: "item", id: "d" }, index);
    expect(r.cells.milk).toMatchObject({ state: "none", chef: "removed", was: ["Mozzarella"], note: "no cheese" });
    // still not reviewed, so never "free from"
    expect(isFreeFrom(r, "milk")).toBe(false);
  });

  it("a prep's own override flows up to the dish, and another ingredient still wins", () => {
    const index = mk(
      [ing("b", "Butter", reviewed({ allergens: ["milk"] })), ing("c", "Cream", reviewed({ allergens: ["milk"] }))],
      [prep("sauce", "Sauce", { allergen_remove: ["milk"] })],
      [item("d1", "Dish 1"), item("d2", "Dish 2")],
      [line("prep", "sauce", "ingredient", "b"), line("item", "d1", "prep", "sauce"), line("item", "d2", "prep", "sauce"), line("item", "d2", "ingredient", "c")],
    );
    expect(rollup({ kind: "item", id: "d1" }, index).cells.milk).toMatchObject({ state: "none", chef: "removed" });
    expect(rollup({ kind: "item", id: "d2" }, index).cells.milk).toMatchObject({ state: "contains", sources: ["Cream"] });
  });

  it("gives a note on a yellow cell", () => {
    const index = mk([ing("a", "Aioli", reviewed({ allergens: ["egg"] }))], [], [item("d", "Dish", { allergen_notes: { egg: "no aioli" } })], [line("item", "d", "ingredient", "a")]);
    expect(rollup({ kind: "item", id: "d" }, index).cells.egg).toMatchObject({ state: "contains", note: "no aioli" });
  });

  it("withDraft rolls up the version being edited", () => {
    const base = mk([ing("a", "Salt", reviewed()), ing("n", "Cashews", reviewed({ allergens: ["tree_nuts"] }))], [], [item("d", "Dish")], [line("item", "d", "ingredient", "a")]);
    expect(rollup({ kind: "item", id: "d" }, base).cells.tree_nuts.state).toBe("none");
    const draft = withDraft(base, "item", { ...item("d", "Dish"), allergen_add: ["lupin"] }, [line("item", "d", "ingredient", "a"), line("item", "d", "ingredient", "n")]);
    const r = rollup({ kind: "item", id: "d" }, draft);
    expect(r.cells.tree_nuts.state).toBe("contains");
    expect(r.cells.lupin.chef).toBe("added");
  });

  it("copes with an unmigrated database (no allergen fields at all)", () => {
    const r = rollup({ kind: "item", id: "d" }, mk([ing("a", "Salt")], [], [item("d", "Dish")], [line("item", "d", "ingredient", "a")]));
    expect(r.reviewed).toBe(false);
    expect(r.cells.milk.state).toBe("none");
  });
});

describe("diet tags", () => {
  const dish = (ings: Ingredient[]) => {
    const index = mk(ings, [], [item("d", "Dish")], ings.map((i) => line("item", "d", "ingredient", i.id)));
    return dietTags(rollup({ kind: "item", id: "d" }, index));
  };
  it("vegetarian and vegan when every ingredient is reviewed and plant-only", () => {
    const [veg, vegan] = dish([ing("a", "Tomato", reviewed())]);
    expect(veg.state).toBe("yes");
    expect(vegan.state).toBe("yes");
  });
  it("dairy makes it vegetarian but not vegan", () => {
    const [veg, vegan] = dish([ing("a", "Tomato", reviewed()), ing("b", "Cheese", reviewed({ allergens: ["milk"] }))]);
    expect(veg.state).toBe("yes");
    expect(vegan).toMatchObject({ state: "no", because: ["Cheese"] });
  });
  it("meat and fish flags stop it being vegetarian", () => {
    expect(dish([ing("a", "Bacon", reviewed({ diet_flags: ["meat"] }))])[0].state).toBe("no");
    expect(dish([ing("a", "Barra", reviewed({ allergens: ["fish"] }))])[0].state).toBe("no");
  });
  it("suggested meat is maybe, and an unreviewed plant dish is unknown", () => {
    expect(dish([ing("a", "Bacon")])[0].state).toBe("maybe");
    expect(dish([ing("a", "Tomato")])[0].state).toBe("unknown");
  });
  it("honey is not vegan", () => {
    expect(dish([ing("a", "Honey", reviewed({ diet_flags: ["honey"] }))])[1].state).toBe("no");
  });
});

describe("virtual items and matrix rows", () => {
  it("gelato virtual items resolve through the flavour mix; rows collapse to one per flavour", () => {
    const mix = prep("mix1", "Gelato Vanilla", { prep_type: "Gelato flavour mix" });
    const vid = virtualItemId("mix1", "s1");
    const vid2 = virtualItemId("mix1", "s2");
    const g1 = item(vid, "Vanilla - Scoop", { category: "Gelato", venue_id: 4 });
    const g2 = item(vid2, "Vanilla - Cone", { category: "Gelato", venue_id: 4 });
    const index = mk(
      [ing("m", "Whole Milk", reviewed({ allergens: ["milk"] })), ing("cone", "Waffle Cone", reviewed({ allergens: ["gluten"] }))],
      [mix],
      [g1, g2],
      [line("prep", "mix1", "ingredient", "m"), line("item", vid, "prep", "mix1"), line("item", vid2, "prep", "mix1"), line("item", vid2, "ingredient", "cone")],
    );
    expect(rollup({ kind: "item", id: vid }, index).cells.milk.state).toBe("contains");
    expect(rollup({ kind: "item", id: vid2 }, index).cells.gluten.state).toBe("contains");
    const rows = matrixRows([g1, g2], index);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Gelato Vanilla", mixOnly: true, href: "/preps/mix1" });
  });

  it("tap beer suggests gluten and alcohol from the keg, until the keg is reviewed", () => {
    const bid = beerItemId("b1", "s1");
    const bid2 = beerItemId("b1", "s2");
    const b1 = item(bid, "Balter XPA - Pot", { category: "Tap Beer" });
    const b2 = item(bid2, "Balter XPA - Pint", { category: "Tap Beer" });
    const keg = ing("k", "Balter XPA 50L");
    const index = mk([keg], [], [b1, b2], [line("item", bid, "ingredient", "k"), line("item", bid2, "ingredient", "k")]);
    const r = rollup({ kind: "item", id: bid }, index);
    expect(r.cells.gluten).toMatchObject({ state: "may_contain", sources: ["Balter XPA 50L"] });
    expect(r.cells.alcohol.state).toBe("may_contain");
    expect(matrixRows([b1, b2], index)).toHaveLength(1);
    expect(matrixRows([b1, b2], index)[0].name).toBe("Balter XPA");
    const done = mk([ing("k", "Balter XPA 50L", reviewed({ allergens: ["gluten", "alcohol"] }))], [], [b1], [line("item", bid, "ingredient", "k")]);
    const r2 = rollup({ kind: "item", id: bid }, done);
    expect(r2.cells.gluten.state).toBe("contains");
    expect(r2.reviewed).toBe(true);
  });
});
