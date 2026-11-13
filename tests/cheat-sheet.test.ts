import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildIndex } from "@/lib/costing";
import {
  buildCheatSheet,
  buildSauceKey,
  cheatAmount,
  cleanName,
  compareSections,
  DISHES_PER_PAGE,
  fitScale,
  footerLine,
  guessRole,
  HOW_TO_READ,
  pcsOf,
  ROLES,
  SCALE_MIN,
  SCALE_START,
  sauceUseText,
  stripPack,
  venueShort,
  withoutPcs,
  type CheatDishPage,
  type CheatKeyPage,
  type CheatSheet,
  type CheatSource,
} from "@/lib/cheat-sheet";
import type { Ingredient, MenuItem, Prep, RecipeLine, Venue } from "@/lib/types";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/* ------------------------------------------------------------------ fixtures */

const ing = (id: string, name: string): Ingredient =>
  ({ id, name, category: "Food", supplier_id: 7, supplier_code: "SUP-123", pack_size: 1, pack_unit: "kg", pack_price: 17.08, price_inc_gst: false, gst_free: false, rebate: 0.05, yield_pct: 1, venues: "All", active: true, last_price_update: null, previous_price: 16, source: null, notes: "secret supplier note", updated_at: null, allergens_reviewed: true, allergens: [] }) as Ingredient;
const prep = (id: string, name: string): Prep => ({ id, name, venue_id: 1, prep_type: "Sauces", yield_qty: 2, yield_unit: "kg", active: true, source: null, notes: null, updated_at: null });
const item = (id: string, name: string, over: Partial<MenuItem> = {}): MenuItem => ({ id, name, venue_id: 1, category: "Food", section: "Mains", portions: 1, sell_price_inc: 24.5, target_override: 0.71, hh_price_inc: 12, active: true, source: null, notes: null, updated_at: "2026-10-02T03:00:00Z", ...over });
let n = 0;
const line = (parent: string, type: "ingredient" | "prep", cid: string, qty: number, unit: RecipeLine["unit"]): RecipeLine => ({ id: `l${++n}`, parent_type: "item", parent_id: parent, component_type: type, component_id: cid, qty, unit, note: null, sort: n });
const VENUES = new Map<number, Venue>([
  [1, { id: 1, name: "Drift Bar", slug: "drift", sort: 1 }],
  [2, { id: 2, name: "Chiobu", slug: "chiobu", sort: 2 }],
  [3, { id: 3, name: "Greedy Gringo's", slug: "greedy", sort: 3 }],
  [4, { id: 4, name: "Gelato Rumba", slug: "gelato", sort: 4 }],
]);

function source(ings: Ingredient[], preps: Prep[], items: MenuItem[], lines: RecipeLine[]): CheatSource {
  return { items, index: buildIndex(ings, preps, lines), venueById: VENUES };
}

/** a small Drift menu: two sections, a pcs dish, a dish with a photo, an inactive dish, a drink and another venue's dish */
function drift() {
  const ings = [
    ing("toast", "Toast"),
    ing("bacon", "Bacon Middle Rindless Gas Flushed"),
    ing("egg", "Eggs (Each)"),
    ing("parsley", "Parsley"),
    ing("pizza", "Pizza Base"),
    ing("mozz", "Mozzarella"),
    ing("chips", "Chips 10mm Supa Crunch Ultrafast"),
    ing("emp", "Pulled Lamb Empanada"),
    ing("tequila", "Tequila Blanco (700ml)"),
    ing("zucchini", "Zucchini Flowers"),
  ];
  const preps = [prep("holl", "Hollandaise"), prep("napoli", "Napoli Sauce"), prep("crispys", "Crispys")];
  const items = [
    item("bene", "Bacon Bene", { section: "Breakfast", kitchen_photo: "uploads/bene-1.jpg" }),
    item("empan", "Pulled Lamb Empanadas (5)", { section: "Small Plates" }),
    item("marg", "margherita", { section: "Pizzas" }),
    item("chips", "Bowl of Chips", { section: "Small Plates" }),
    item("old", "Retired Dish", { section: "Mains", active: false }),
    item("drink", "Margarita", { category: "Cocktail", section: null }),
    item("other", "Chiobu Bao", { venue_id: 2, section: "Small Chow" }),
    item("bare", "Chef Special", { section: null }),
  ];
  const lines = [
    line("bene", "ingredient", "toast", 2, "each"),
    line("bene", "ingredient", "bacon", 0.18, "kg"),
    line("bene", "ingredient", "egg", 2, "each"),
    line("bene", "prep", "holl", 0.06, "L"),
    line("bene", "ingredient", "parsley", 0.002, "kg"),
    line("empan", "ingredient", "emp", 5, "each"),
    line("empan", "prep", "crispys", 0.0217, "kg"),
    line("marg", "ingredient", "pizza", 1, "each"),
    line("marg", "prep", "napoli", 0.1314, "kg"),
    line("marg", "ingredient", "mozz", 0.14, "kg"),
    line("chips", "ingredient", "chips", 0.34, "kg"),
    line("chips", "prep", "holl", 0.06, "L"),
    line("old", "ingredient", "toast", 1, "each"),
    line("drink", "ingredient", "tequila", 45, "ml"),
    line("other", "ingredient", "zucchini", 1, "each"),
  ];
  return source(ings, preps, items, lines);
}

const sheetOf = (src: CheatSource, slug: string, now = new Date("2026-11-13T02:00:00Z")) => buildCheatSheet(slug, src, now) as CheatSheet;

/* ------------------------------------------------------------------ names */

describe("cleanName: how an ingredient reads on the pass", () => {
  it("keeps short house words and brand style as they are", () => {
    expect(cleanName("BVC")).toBe("BVC");
    expect(cleanName("bvc")).toBe("BVC");
    expect(cleanName("Kara")).toBe("Kara");
    expect(cleanName("Nahm Prik Pla")).toBe("Nahm Prik Pla");
    expect(cleanName("nahm prik pla")).toBe("Nahm Prik Pla");
    expect(cleanName("furikake")).toBe("Furikake");
    expect(cleanName("gk mayo")).toBe("GK Mayo");
    expect(cleanName("Chicken Schnitzel GF")).toBe("Chicken Schnitzel GF");
    expect(cleanName("Hollandaise")).toBe("Hollandaise");
    expect(cleanName("Crispys")).toBe("Crispys");
    expect(cleanName("Herb Salad")).toBe("Herb Salad");
  });
  it("drops the pack size the app keeps on the end of a name", () => {
    expect(cleanName("Sweet Chilli (4.5L)")).toBe("Sweet Chilli");
    expect(cleanName("Cherry Tomatoes (5kg)")).toBe("Cherry Tomatoes");
    expect(cleanName("Parmesan (Each)")).toBe("Parmesan");
    expect(cleanName("Eggs (Each)")).toBe("Eggs");
    expect(cleanName("Sesame Oil (2l)")).toBe("Sesame Oil");
    expect(stripPack("Tequila Blanco (700ml)")).toBe("Tequila Blanco");
    // a bracket that is not a size stays
    expect(stripPack("Chicken (Diced)")).toBe("Chicken (Diced)");
  });
  it("uses the kitchen's short word for supplier style names", () => {
    expect(cleanName("Bacon Middle Rindless Gas Flushed")).toBe("Bacon");
    expect(cleanName("Chips 10mm Supa Crunch Ultrafast")).toBe("Chips");
    expect(cleanName("Pomegranate Mollases")).toBe("Pomegranate Molasses");
    expect(cleanName("Shallots (kg)")).toBe("Spring Onion");
    expect(cleanName("Roti Paratha")).toBe("Roti");
    expect(cleanName("Pizza Base 7 Inch")).toBe("Pizza Base (7 inch)");
  });
  it("small words stay lower case inside a name", () => {
    expect(cleanName("pork and prawn batch")).toBe("Pork and Prawn Batch");
  });
});

describe("piece counts in a dish name", () => {
  it("reads (5) as 5 pieces and takes it off the title", () => {
    expect(pcsOf("Pork and Prawn Dumplings (5)")).toBe(5);
    expect(withoutPcs("Pork and Prawn Dumplings (5)")).toBe("Pork and Prawn Dumplings");
    expect(pcsOf("Crispy Pork Belly Bao (3)")).toBe(3);
    expect(pcsOf("Rendang Spring Rolls (3)")).toBe(3);
    expect(pcsOf("Wedges")).toBeNull();
    expect(withoutPcs("Wedges")).toBe("Wedges");
  });
});

/* ------------------------------------------------------------------ amounts */

describe("cheatAmount: amounts the way a chef reads them", () => {
  it("kg under 1 shows grams, L under 1 shows ml", () => {
    expect(cheatAmount(0.18, "kg")).toBe("180 g");
    expect(cheatAmount(0.0478, "kg")).toBe("48 g");
    expect(cheatAmount(0.002, "kg")).toBe("2 g");
    expect(cheatAmount(0.06, "L")).toBe("60 ml");
    expect(cheatAmount(0.0217, "kg")).toBe("22 g");
  });
  it("kg and L from 1 up, and g and ml, keep their unit", () => {
    expect(cheatAmount(1, "kg")).toBe("1 kg");
    expect(cheatAmount(1.5, "kg")).toBe("1.5 kg");
    expect(cheatAmount(2, "L")).toBe("2 L");
    expect(cheatAmount(200, "g")).toBe("200 g");
    expect(cheatAmount(30, "ml")).toBe("30 ml");
  });
  it("each shows x2, and a half shows x½", () => {
    expect(cheatAmount(2, "each")).toBe("x2");
    expect(cheatAmount(1, "each")).toBe("x1");
    expect(cheatAmount(0.5, "each")).toBe("x½");
    expect(cheatAmount(0.25, "each")).toBe("x¼");
    expect(cheatAmount(0.01, "each")).toBe("x0.01");
  });
  it("no amount is blank", () => {
    expect(cheatAmount(0, "g")).toBe("");
    expect(cheatAmount(null, "g")).toBe("");
    expect(cheatAmount(undefined, "each")).toBe("");
  });
  it("never rounds a tiny kg amount down to nothing", () => {
    expect(cheatAmount(0.0002, "kg")).toBe("0.2 g");
  });
});

/* ------------------------------------------------------------------ roles */

describe("guessRole: a name based guess, real lines from the Chiobu and Drift builds", () => {
  const cases: [string, string][] = [
    // Chiobu
    ["BVC", "sauce"],
    ["Kara", "top"],
    ["Nahm Prik Pla", "sauce"],
    ["Nahm Prik Pao", "sauce"],
    ["Green Nahm Jim", "sauce"],
    ["Furikake", "top"],
    ["Soy Caramel", "sauce"],
    ["Kung Pao Sauce", "sauce"],
    ["Oyster Sauce Mayo", "sauce"],
    ["Gochujang Ketchup", "sauce"],
    ["Pumpkin Curry Base", "sauce"],
    ["3 Cup Base", "sauce"],
    ["Chilli Oil", "sauce"],
    ["steamed jasmine rice", "with"],
    ["Spring Roll Wrapper", "with"],
    ["Bao", "with"],
    ["cos", "with"],
    ["Betel", "with"],
    ["thai basil", "garn"],
    ["chiobu herb garnish", "garn"],
    ["Kaffir Lime Leaf", "garn"],
    ["Lemongrass", "garn"],
    ["Coriander", "garn"],
    ["Black Sesame", "top"],
    ["crispy shallots", "top"],
    ["Pickled Cucumber", "top"],
    ["Lime", "top"],
    ["Red Chilli", "top"],
    ["Coco Cashew", "top"],
    ["Shoestring fries", "main"],
    ["Confit Pork Belly", "main"],
    ["Kingfish Sashimi", "main"],
    ["Squid", "main"],
    ["Karaage Flour", "main"],
    // Drift
    ["Hollandaise", "sauce"],
    ["Caper Hollandaise", "sauce"],
    ["Sticky Balsamic", "sauce"],
    ["Mushroom Sauce", "sauce"],
    ["Satay Sauce", "sauce"],
    ["Pomegranate Mollases", "sauce"],
    ["Brown Butter", "sauce"],
    ["Tomato Sauce", "sauce"],
    ["Sweet Chilli (4.5L)", "sauce"],
    ["Sour Cream", "sauce"],
    ["Cream", "sauce"],
    ["Avocado Crème", "sauce"],
    ["Napoli Sauce", "sauce"],
    ["Crispys", "top"],
    ["Mozzarella", "top"],
    ["Parmesan (Each)", "top"],
    ["Feta", "top"],
    ["Cherry Tomatoes (5kg)", "top"],
    ["Whipped Ricotta", "top"],
    ["Pine Nuts", "top"],
    ["Chicken Salt", "top"],
    ["Bacon Middle Rindless Gas Flushed", "top"],
    ["Herb Salad", "garn"],
    ["Parsley", "garn"],
    ["Basil (Each)", "garn"],
    ["Pizza Base", "main"],
    ["Pizza Base 7 Inch", "main"],
    ["Chips 10mm Supa Crunch Ultrafast", "with"],
    ["Toast", "with"],
    ["Rosti", "with"],
    ["Flat Bread", "with"],
    ["Salad", "with"],
    ["Penne", "with"],
    ["Slaw", "with"],
    ["Vegan Bun", "with"],
    ["Baby Cos", "with"],
    ["Eggs (Each)", "main"],
    ["Chicken Wings", "main"],
    ["Beef Patty", "main"],
    ["Chicken Skewers 80G Skewers", "main"],
    ["Pulled Lamb Empanada", "main"],
    ["Wedges", "main"],
    ["Rib Fillet", "main"],
    ["Calamari", "main"],
    ["Prawn 21/25", "main"],
    ["Avocado", "main"],
  ];
  it.each(cases)("%s goes under %s", (name, role) => {
    expect(guessRole(name)).toBe(role);
  });

  it("is read from the name only: the pack size never changes the answer", () => {
    expect(guessRole("Cherry Tomatoes (1kg)")).toBe(guessRole("Cherry Tomatoes (5kg)"));
    expect(guessRole("Parmesan (L)")).toBe("top");
  });

  it("a name the guess cannot place goes under BUILD", () => {
    for (const name of ["Zucchini Flowers", "Mystery Item", "Quinoa", ""]) expect(guessRole(name)).toBe("main");
  });

  it("a sauce word beats a garnish word, a with word beats a topping, a protein beats a topping", () => {
    expect(guessRole("Herb Aioli")).toBe("sauce");
    expect(guessRole("Basil Pesto")).toBe("sauce");
    expect(guessRole("Chicken Breast Diced")).toBe("main");
    expect(guessRole("Caramelised Onion")).toBe("top");
  });

  it("does not match the middle of a word (Graham is not ham, Karaage is not Kara)", () => {
    expect(guessRole("Graham Crackers")).toBe("main");
    expect(guessRole("Karaage Flour")).toBe("main");
    expect(guessRole("Toasted Sesame Mix")).toBe("top");
  });

  it("Greedy Gringo's: a Mexican menu sorts sensibly", () => {
    const mex: [string, string][] = [
      ["Corn Tortilla", "with"],
      ["Flour Tortillas", "with"],
      ["Taco Shells", "with"],
      ["Tostada", "with"],
      ["Corn Chips", "with"],
      ["Nachos", "with"],
      ["Salsa Roja", "sauce"],
      ["Guacamole", "sauce"],
      ["Pico de Gallo", "sauce"],
      ["Sour Cream", "sauce"],
      ["Chipotle Mayo", "sauce"],
      ["Crema", "sauce"],
      ["Queso", "sauce"],
      ["Hot Sauce", "sauce"],
      ["Jalapenos", "top"],
      ["Pickled Red Onion", "top"],
      ["Shredded Cheese", "top"],
      ["Shredded Cabbage", "top"],
      ["Lime", "top"],
      ["Coriander", "garn"],
      ["Carnitas", "main"],
      ["Beef Brisket", "main"],
      ["Barbacoa Beef", "main"],
      ["Chicken Tinga", "main"],
      ["Grilled Prawns", "main"],
    ];
    for (const [name, role] of mex) expect(guessRole(name), name).toBe(role);
  });
});

/* ------------------------------------------------------------------ the model */

describe("buildCheatSheet: which dishes, in what order", () => {
  const s = sheetOf(drift(), "drift");

  it("is only the venue's ACTIVE FOOD dishes", () => {
    const titles = s.pages.flatMap((p) => (p.kind === "dishes" ? p.dishes.map((d) => d.title) : []));
    expect(titles).toContain("Bacon Bene");
    expect(titles).not.toContain("Retired Dish"); // inactive
    expect(titles).not.toContain("Margarita"); // a drink
    expect(titles).not.toContain("Chiobu Bao"); // another venue
    expect(s.dishCount).toBe(5);
  });

  it("orders by section in menu order, then by name; no section reads Other and comes last", () => {
    const dishes = (s.pages[0] as CheatDishPage).dishes;
    expect(dishes.map((d) => [d.section, d.title])).toEqual([
      ["Breakfast", "Bacon Bene"],
      ["Small Plates", "Bowl of Chips"],
      ["Small Plates", "Pulled Lamb Empanadas"],
      ["Pizzas", "Margherita"],
      ["Other", "Chef Special"],
    ]);
  });

  it("section order: fixed menu order, unknown sections A to Z, Other last", () => {
    const labels = ["Sweets", "Other", "Zeta", "Burgers", "Alpha", "Small Plates", "Breakfast", "Tacos", "Big Chow", "Sides", "Daily Specials"];
    expect([...labels].sort(compareSections)).toEqual(["Breakfast", "Small Plates", "Big Chow", "Daily Specials", "Burgers", "Tacos", "Sides", "Sweets", "Alpha", "Zeta", "Other"]);
  });

  it("a (5) in the name becomes a 5 PCS badge and is removed from the title", () => {
    const d = (s.pages[0] as CheatDishPage).dishes.find((x) => x.title.startsWith("Pulled Lamb"));
    expect(d?.title).toBe("Pulled Lamb Empanadas");
    expect(d?.pcs).toBe(5);
    expect((s.pages[0] as CheatDishPage).dishes.find((x) => x.title === "Bacon Bene")?.pcs).toBeNull();
  });

  it("a dish's photo is its kitchen photo through the app's photo path; none means a null (the Photo needed tile)", () => {
    const dishes = (s.pages[0] as CheatDishPage).dishes;
    expect(dishes.find((d) => d.title === "Bacon Bene")?.photo).toBe("/kitchen/photo/uploads/bene-1.jpg");
    expect(dishes.find((d) => d.title === "Margherita")?.photo).toBeNull();
  });

  it("lines sit under the bars the guess gives, in bar order, with per-serve amounts, and only bars with lines are kept", () => {
    const bene = (s.pages[0] as CheatDishPage).dishes.find((d) => d.title === "Bacon Bene")!;
    expect(bene.groups.map((g) => g.role)).toEqual(["main", "with", "sauce", "top", "garn"]);
    const byRole = Object.fromEntries(bene.groups.map((g) => [g.role, g.lines.map((l) => [l.name, l.amount])]));
    expect(byRole.with).toEqual([["Toast", "x2"]]);
    expect(byRole.main).toEqual([["Eggs", "x2"]]);
    expect(byRole.sauce).toEqual([["Hollandaise", "60 ml"]]);
    expect(byRole.top).toEqual([["Bacon", "180 g"]]);
    expect(byRole.garn).toEqual([["Parsley", "2 g"]]);
    const chips = (s.pages[0] as CheatDishPage).dishes.find((d) => d.title === "Bowl of Chips")!;
    expect(chips.groups.map((g) => g.role)).toEqual(["with", "sauce"]); // no empty bars
  });

  it("a dish with no recipe lines has no bars", () => {
    const bare = (s.pages[0] as CheatDishPage).dishes.find((d) => d.title === "Chef Special")!;
    expect(bare.groups).toEqual([]);
  });

  it("a recipe line pointing at nothing is left off", () => {
    const src = drift();
    src.index.linesByParent.get("item:bene")!.push({ ...line("bene", "ingredient", "toast", 1, "each"), component_id: "" });
    const d = (sheetOf(src, "drift").pages[0] as CheatDishPage).dishes.find((x) => x.title === "Bacon Bene")!;
    expect(d.groups.flatMap((g) => g.lines)).toHaveLength(5);
  });
});

describe("buildCheatSheet: pages", () => {
  function many(count: number): CheatSource {
    const items: MenuItem[] = [];
    for (let i = 0; i < count; i++) items.push(item(`d${i}`, `Dish ${String(i).padStart(2, "0")}`, { section: "Mains" }));
    return source([], [], items, []);
  }

  it("five dishes to a page, fewer on the last, then one Sauce Key page", () => {
    expect(DISHES_PER_PAGE).toBe(5);
    const s = sheetOf(many(12), "drift");
    expect(s.pages.map((p) => p.kind)).toEqual(["dishes", "dishes", "dishes", "key"]);
    expect(s.pages.map((p) => (p.kind === "dishes" ? p.dishes.length : -1))).toEqual([5, 5, 2, -1]);
    expect(s.total).toBe(4);
    expect(s.pages.map((p) => p.n)).toEqual([1, 2, 3, 4]);
    expect(s.dishCount).toBe(12);
  });

  it("exactly five dishes is one dish page, six is two", () => {
    expect(sheetOf(many(5), "drift").pages.map((p) => p.kind)).toEqual(["dishes", "key"]);
    expect(sheetOf(many(6), "drift").pages.map((p) => p.kind)).toEqual(["dishes", "dishes", "key"]);
  });

  it("a venue with no active Food dishes has no pages", () => {
    const s = sheetOf(drift(), "gelato");
    expect(s.dishCount).toBe(0);
    expect(s.pages).toEqual([]);
    expect(s.total).toBe(0);
    expect(s.venue.name).toBe("Gelato Rumba");
  });

  it("an unknown venue is null", () => {
    expect(buildCheatSheet("nowhere", drift())).toBeNull();
  });

  it("carries the venue, a short name for the footer and the Brisbane print date", () => {
    const s = sheetOf(drift(), "drift", new Date("2026-11-12T15:30:00Z")); // 13 Nov 01:30 in Brisbane
    expect(s.venue).toEqual({ slug: "drift", name: "Drift Bar", short: "Drift" });
    expect(s.printedOn).toBe("13 Nov 2026");
    expect(venueShort("greedy", "Greedy Gringo's")).toBe("Greedy");
    expect(venueShort("gelato", "Gelato Rumba")).toBe("Gelato Rumba");
  });
});

describe("the Sauce Key", () => {
  it("lists every sauce line from every dish, alphabetical, each with the dishes and amounts", () => {
    const s = sheetOf(drift(), "drift");
    const key = s.pages[s.pages.length - 1] as CheatKeyPage;
    expect(key.kind).toBe("key");
    expect(key.entries.map((e) => e.name)).toEqual(["Hollandaise", "Napoli Sauce"]);
    const holl = key.entries[0];
    expect(holl.uses.map(sauceUseText)).toEqual(["Bacon Bene 60 ml", "Bowl of Chips 60 ml"]);
    expect(key.entries[1].uses.map(sauceUseText)).toEqual(["Margherita 131 g"]);
  });

  it("groups the same sauce across dishes whatever its capitals, and keeps a dish's name without its piece count", () => {
    const key = buildSauceKey([
      { id: "a", title: "Wings", section: "S", pcs: null, photo: null, groups: [{ role: "sauce", lines: [{ name: "Aioli", amount: "60 ml" }] }] },
      { id: "b", title: "Dumplings", section: "S", pcs: 5, photo: null, groups: [{ role: "sauce", lines: [{ name: "aioli", amount: "20 ml" }] }, { role: "top", lines: [{ name: "Crispys", amount: "10 g" }] }] },
    ]);
    expect(key).toHaveLength(1);
    expect(key[0].uses.map(sauceUseText)).toEqual(["Wings 60 ml", "Dumplings 20 ml"]);
  });

  it("is empty, not missing, when no dish has a sauce line", () => {
    const s = sheetOf(source([], [], [item("a", "Plain Dish")], []), "drift");
    expect((s.pages[1] as CheatKeyPage).entries).toEqual([]);
  });
});

/* ------------------------------------------------------------------ fit */

describe("fitScale: each page fits its own text", () => {
  it("starts at 1.25, steps down by 0.02 and stops at the first scale that fits", () => {
    const tried: number[] = [];
    const r = fitScale((s) => (tried.push(s), s <= 0.99));
    expect(r).toEqual({ scale: 0.99, fits: true });
    expect(tried[0]).toBe(SCALE_START);
    expect(tried[0]).toBe(1.25);
    expect(tried[1]).toBe(1.23);
    expect(tried.length).toBe(14);
  });
  it("a page that fits at once keeps 1.25", () => {
    expect(fitScale(() => true)).toEqual({ scale: 1.25, fits: true });
  });
  it("never goes below 0.55 and says it did not fit", () => {
    const tried: number[] = [];
    const r = fitScale((s) => (tried.push(s), false));
    expect(r).toEqual({ scale: 0.55, fits: false });
    expect(Math.min(...tried)).toBe(SCALE_MIN);
    expect(SCALE_MIN).toBe(0.55);
  });
  it("fits exactly at the floor", () => {
    expect(fitScale((s) => s <= 0.55)).toEqual({ scale: 0.55, fits: true });
  });
});

/* ------------------------------------------------------------------ text and money */

describe("the sheet's words", () => {
  it("footer: venue, printed date, per serve note", () => {
    expect(footerLine("Drift", "13 Nov 2026")).toBe("Drift Kitchen Cheat Sheet  |  Printed 13 Nov 2026  |  Amounts are per serve, from the costed recipes");
  });
  it("has no em or en dashes, and no word about corrections, Brendan or red flags", () => {
    const all = [HOW_TO_READ, footerLine("Drift", "13 Nov 2026"), ...ROLES.map((r) => r.label)].join(" | ");
    expect(all).not.toMatch(/[–—]/);
    expect(all).not.toMatch(/brendan|correct|\bred\b|\?\?|check this/i);
  });
  it("every bar carries its word, so a black and white print still reads", () => {
    expect(ROLES.map((r) => r.label)).toEqual(["BUILD", "WITH", "SAUCE", "TOP WITH", "GARNISH"]);
    expect(ROLES.map((r) => r.bg)).toEqual(["#0A3848", "#3b6c8c", "#8F5F56", "#f0b13a", "#2f8a4b"]);
  });
});

describe("the model: nothing about money, no flags", () => {
  function walk(v: unknown, keys: string[] = [], strings: string[] = []) {
    if (Array.isArray(v)) v.forEach((x) => walk(x, keys, strings));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (keys.push(k), walk(x, keys, strings));
    else if (typeof v === "string") strings.push(v);
    return { keys, strings };
  }
  const BANNED_KEY = /price|cost|gp|margin|target|supplier|sell|rebate|pack|deal|portion|flag|check|warn/i;

  it("has no price, cost, GP, target, supplier or flag field anywhere, and none of the seeded money values leak", () => {
    const s = sheetOf(drift(), "drift");
    const { keys, strings } = walk(s);
    expect(keys.filter((k) => BANNED_KEY.test(k))).toEqual([]);
    const all = strings.join(" | ");
    expect(all).not.toMatch(/\$|17\.08|24\.5|SUP-123|secret supplier|0\.71/);
    expect(all).not.toContain("??");
  });
});

/* ------------------------------------------------------------------ wiring */

describe("the Menu page button", () => {
  const menu = read("app/(app)/menu/page.tsx");
  const button = read("components/cheat-sheet-button.tsx");

  it("sits beside Download POS List on the Menu page", () => {
    expect(menu).toContain('import { CheatSheetButton } from "@/components/cheat-sheet-button"');
    expect(menu).toMatch(/<PosListButton \/>\s*<CheatSheetButton \/>/);
  });
  it("reads Print Cheat Sheet and is a 44px target", () => {
    expect(button).toContain('"Print Cheat Sheet"');
    expect(button).toContain("min-h-[44px] min-w-[44px]");
  });
  it("opens the preview for the chosen venue", () => {
    expect(button).toContain("/print/cheat-sheet?venue=");
    expect(button).toMatch(/<Link href=\{cheatSheetHref\(venue\.slug\)\}/);
  });
  it("with All chosen it stays visible but disabled, with the reason written beside it", () => {
    expect(button).toMatch(/if \(!venue\)/);
    expect(button).toMatch(/<button type="button" disabled/);
    expect(button).toContain('"Choose a venue first"');
    expect(button).toContain("aria-describedby");
  });
  it("is not a new sidebar entry, tab or menu row", () => {
    expect(read("components/app-shell.tsx")).not.toMatch(/cheat/i);
    expect(read("app/(app)/more/page.tsx")).not.toMatch(/cheat/i);
  });
});

describe("the print screen", () => {
  it("uses the shared print machinery: a body layer, data-print-job, the shared shell CSS, A4 landscape with no margin", () => {
    const view = read("components/print/cheat-sheet-view.tsx");
    expect(view).toContain('el.id = "print-root"');
    expect(view).toContain('setAttribute("data-print-job"');
    expect(view).toContain("window.print()");
    expect(view).toContain("document.fonts");
    const css = read("components/print/cheat-sheet-css.ts");
    expect(css).toContain("PRINT_SHELL_CSS");
    expect(css).toMatch(/@page\s*\{\s*size:\s*A4 landscape;\s*margin:\s*0/);
    expect(css).toMatch(/print-color-adjust:\s*exact/);
  });
  it("the page component takes props only and never reads the store", () => {
    const page = read("components/print/cheat-sheet-page.tsx");
    expect(page).not.toMatch(/useStore|@\/lib\/store/);
  });
  it("is a read only screen: no database writes, no schema, no API route", () => {
    for (const f of ["lib/cheat-sheet.ts", "components/print/cheat-sheet-view.tsx", "components/print/cheat-sheet-page.tsx", "components/cheat-sheet-button.tsx"]) {
      expect(read(f), f).not.toMatch(/insertRow|\.insert\(|\.update\(|\.upsert\(|\.from\(|supabase|fetch\(/);
    }
  });
  it("ink on white: the only colours in the sheet CSS besides the greys are the role bars", () => {
    const css = read("components/print/cheat-sheet-css.ts");
    const hex = new Set([...css.matchAll(/#[0-9a-fA-F]{3,6}\b/g)].map((m) => m[0].toLowerCase()));
    expect([...hex].sort()).toEqual(["#8f5f56", "#e3dccf", "#f2f1eb", "#fff", "#6b665f"].sort());
  });
});
