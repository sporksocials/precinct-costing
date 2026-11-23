import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  addedToast,
  categoriesOf,
  countedByPlan,
  packWord,
  parseCartonQty,
  parseMultiple,
  productHistoryHref,
  linkedProductDraft,
  notOrderedSentence,
  orderableVenues,
  orderDefaults,
  fallbackUnit,
  noListSentence,
  resolvePick,
  unitForCategory,
  orderedAtSentence,
  orderingProductName,
  parsePar,
  readyPicks,
  unitChips,
  unitSuggestions,
  venueLinks,
  NO_SUPPLIER_LINE,
  type LinkCategory,
  type LinkProduct,
  type LinkTerms,
} from "@/lib/ordering-link";

const venues = [
  { id: 1, slug: "drift", name: "Drift", sort: 1 },
  { id: 2, slug: "chiobu", name: "Chiobu", sort: 2 },
  { id: 4, slug: "gelato", name: "Gelato Rumba", sort: 4 },
];
const cats: LinkCategory[] = [
  { id: "c1", venue_id: 1, name: "Spirits", unit_name: "bottle", sort: 2 },
  { id: "c2", venue_id: 1, name: "Beer", unit_name: "carton", sort: 1 },
  { id: "c3", venue_id: 2, name: "Red", unit_name: "carton", sort: 0 },
];
const prod = (over: Partial<LinkProduct>): LinkProduct => ({ id: "p1", venue_id: 2, category_id: "c3", name: "Shiraz", unit_name: "carton", supplier_id: "t1", ingredient_id: "i1", par: 0, active: true, ...over });
const terms: LinkTerms[] = [{ id: "t1", venue_id: 2, name: "DCG Wines", cost_supplier_id: 7 }];

describe("orderingProductName", () => {
  it("is the ingredient's FULL name, size in brackets included (the database forces it; nothing is tidied away)", () => {
    expect(orderingProductName("Shiraz (750ml)")).toBe("Shiraz (750ml)");
    expect(orderingProductName("  Bombay Sapphire London Dry Gin (700ml) ")).toBe("Bombay Sapphire London Dry Gin (700ml)");
    expect(orderingProductName("Jack Daniel's")).toBe("Jack Daniel's");
  });
});

describe("venues", () => {
  it("lists only venues with an ordering list, in venue order", () => {
    expect(orderableVenues(venues, cats).map((v) => v.slug)).toEqual(["drift", "chiobu"]);
    expect(orderableVenues(venues, [])).toEqual([]);
  });
  it("orders a venue's categories by shelf order", () => {
    expect(categoriesOf(cats, 1).map((c) => c.name)).toEqual(["Beer", "Spirits"]);
  });
});

describe("venue rows", () => {
  const withGreedy = [...venues.slice(0, 2), { id: 3, slug: "greedy", name: "Greedy Gringo's", sort: 3 }, venues[2]];
  it("hides Gelato and keeps a venue with no order list as a disabled row", () => {
    const rows = venueLinks({ venues: withGreedy, categories: cats, products: [], terms });
    expect(rows.map((r) => r.venue.slug)).toEqual(["drift", "chiobu", "greedy"]);
    expect(rows.map((r) => r.hasList)).toEqual([true, true, false]);
    expect(noListSentence("Greedy")).toBe("Greedy has no order list set up yet");
  });
});

describe("orderDefaults", () => {
  const venueCats: LinkCategory[] = [
    { id: "sp", venue_id: 1, name: "Spirits", unit_name: "bottle", sort: 0 },
    { id: "li", venue_id: 1, name: "Liqueurs", unit_name: "bottle", sort: 1 },
    { id: "wi", venue_id: 1, name: "Wine", unit_name: "carton", sort: 2 },
    { id: "bm", venue_id: 1, name: "Bar Mixers", unit_name: "carton", sort: 3 },
    { id: "kg", venue_id: 1, name: "Kegs", unit_name: "keg", sort: 4 },
  ];
  const ingCat: Record<string, string> = { a: "Spirits", b: "Spirits", c: "Spirits", d: "Liqueurs", e: "Wine", f: "Bar consumable" };
  const of = (id: string) => ingCat[id];
  const prods = [
    { category_id: "sp", unit_name: "bottle", ingredient_id: "a" },
    { category_id: "sp", unit_name: "bottle", ingredient_id: "b" },
    { category_id: "li", unit_name: "bottle", ingredient_id: "c" }, // a spirit filed under Liqueurs: the minority
    { category_id: "li", unit_name: "bottle", ingredient_id: "d" },
    { category_id: "wi", unit_name: "carton", ingredient_id: "e" },
    { category_id: "bm", unit_name: "carton", ingredient_id: "f" },
    { category_id: "bm", unit_name: "carton", ingredient_id: null },
    { category_id: "bm", unit_name: "can", ingredient_id: null },
  ];
  const run = (ingredient: Parameters<typeof orderDefaults>[0]["ingredient"], products = prods, categories = venueCats) => orderDefaults({ ingredient, categories, products, ingredientCategoryOf: of });

  it("uses the category most used at the venue by ingredients of the same category", () => {
    const d = run({ name: "Gin", category: "Spirits", pack_unit: "L", pack_size: 0.7 });
    expect(d).toMatchObject({ categoryId: "sp", unit: "bottle", confident: true, basis: "same-ingredient-category" });
  });
  it("breaks a tie with the category whose name fits", () => {
    const tie = [{ category_id: "sp", unit_name: "bottle", ingredient_id: "a" }, { category_id: "li", unit_name: "bottle", ingredient_id: "b" }];
    expect(run({ name: "Rum", category: "Spirits" }, tie).categoryId).toBe("sp");
  });
  it("falls back to a category name that matches the ingredient category when nothing is linked yet", () => {
    expect(run({ name: "Merlot", category: "Wine" }, []).categoryId).toBe("wi");
    expect(run({ name: "Jager", category: "Liqueurs" }, []).basis).toBe("category-name");
  });
  it("matches a keg to a keg category by pack", () => {
    const d = run({ name: "Super Crisp Keg", category: "Beer Keg", pack_unit: "L", pack_size: 49.5 }, []);
    expect(d).toMatchObject({ categoryId: "kg", unit: "keg", confident: true });
  });
  it("never guesses: a weak word like Bar does not match Bar Mixers", () => {
    const d = run({ name: "Napkins", category: "Bar consumable" }, []);
    expect(d).toMatchObject({ categoryId: null, confident: false, basis: "none" });
  });
  it("does not guess when two categories fit equally", () => {
    const two: LinkCategory[] = [{ id: "w1", venue_id: 1, name: "Red Wine", unit_name: "carton", sort: 0 }, { id: "w2", venue_id: 1, name: "White Wine", unit_name: "carton", sort: 1 }];
    expect(run({ name: "Shiraz", category: "Wine" }, [], two).categoryId).toBeNull();
  });
  it("gives the most used unit in the category, then keg, bottle, carton", () => {
    expect(run({ name: "Cordial", category: "Bar consumable" }, prods, [venueCats[3]]).unit).toBe("carton");
    const noCat = run({ name: "Napkins", category: "Bar consumable" }, []);
    expect(noCat.unit).toBe("carton");
    expect(fallbackUnit({ name: "Gin (700ml)", category: "Spirits", pack_unit: "L", pack_size: 0.7 })).toBe("bottle");
    expect(fallbackUnit({ name: "Keg Lager", category: "Food" })).toBe("keg");
    expect(fallbackUnit({ name: "Flour", category: "Food", pack_unit: "kg", pack_size: 25 })).toBe("carton");
  });
  it("a unit tie goes to the category's own unit", () => {
    const cat = { id: "x", unit_name: "Carton" };
    expect(unitForCategory({ name: "X" }, cat, [{ category_id: "x", unit_name: "bottle" }, { category_id: "x", unit_name: "carton" }])).toBe("carton");
  });
  it("lets a hand choice win over the default", () => {
    const d = run({ name: "Napkins", category: "Bar consumable" }, []);
    expect(resolvePick(d, { categoryId: "bm" })).toEqual({ categoryId: "bm", unit: "carton" });
    expect(resolvePick(d, { categoryId: "bm", unit: " tray " }).unit).toBe("tray");
    expect(resolvePick(d, null).categoryId).toBeNull();
  });
});

describe("venueLinks", () => {
  it("shows the active linked product with its category and the supplier it landed under", () => {
    const [drift, chiobu] = venueLinks({ venues, categories: cats, products: [prod({})], terms });
    expect(drift.active).toEqual([]);
    expect(drift.stopped).toBeNull();
    expect(chiobu.active).toHaveLength(1);
    expect(orderedAtSentence("Chiobu", chiobu.active[0])).toBe("Chiobu: Red, counted by the carton, DCG Wines");
  });
  it("says there is no supplier yet when the product has none", () => {
    const [, chiobu] = venueLinks({ venues, categories: cats, products: [prod({ supplier_id: null })], terms });
    expect(orderedAtSentence("Chiobu", chiobu.active[0])).toContain("no supplier yet");
  });
  it("offers Order Again for a stopped product, and not when another is active", () => {
    const stopped = prod({ id: "p2", active: false });
    const [, a] = venueLinks({ venues, categories: cats, products: [stopped], terms });
    expect(a.active).toEqual([]);
    expect(a.stopped?.product.id).toBe("p2");
    const [, b] = venueLinks({ venues, categories: cats, products: [stopped, prod({})], terms });
    expect(b.stopped).toBeNull();
    expect(b.active).toHaveLength(1);
  });
  it("never mixes venues", () => {
    const [drift] = venueLinks({ venues, categories: cats, products: [prod({ venue_id: 2 })], terms });
    expect(drift.active).toEqual([]);
  });
  it("has plain wording with no dashes", () => {
    expect(notOrderedSentence("Drift")).toBe("Not ordered at Drift");
    expect(productHistoryHref("chiobu", "abc")).toBe("/ordering/chiobu/history/products/abc");
    expect(addedToast("Chiobu", "DCG Wines")).toBe("Added to Chiobu's order list under DCG Wines");
    expect(addedToast("Chiobu", null)).toMatch(/Set a supplier on the ingredient/);
    expect(NO_SUPPLIER_LINE).toBe("Set a supplier first so it lands on the right order.");
    for (const s of [addedToast("Chiobu", null), NO_SUPPLIER_LINE]) expect(s).not.toMatch(/[–—]/);
  });
});

describe("order unit", () => {
  it("suggests a keg for a keg and a bottle for a litre pack", () => {
    expect(unitSuggestions({ name: "Super Crisp Keg", pack_unit: "L" })[0]).toBe("keg");
    expect(unitSuggestions({ name: "Vodka", pack_unit: "L" })[0]).toBe("bottle");
    expect(unitSuggestions({ name: "Chips", pack_unit: "kg" })[0]).toBe("bag");
  });
  it("leads with the category's own unit and never repeats", () => {
    const chips = unitChips({ name: "Vodka", pack_unit: "L" }, "Carton");
    expect(chips[0]).toBe("carton");
    expect(new Set(chips).size).toBe(chips.length);
    expect(chips).toEqual(expect.arrayContaining(["bottle", "keg", "bag"]));
  });
  it("then offers what that venue already counts by, most used first (tub, each), before the standard guesses", () => {
    const chips = unitChips({ name: "Vodka", pack_unit: "L" }, "bottle", ["tub", "Each", "tub", " carton ", "each", "tub"]);
    expect(chips.slice(0, 4)).toEqual(["bottle", "tub", "each", "carton"]);
    expect(new Set(chips).size).toBe(chips.length);
  });
});

describe("parsePar", () => {
  it("reads a number, treats blank as 0 and refuses text or negatives", () => {
    expect(parsePar("4")).toBe(4);
    expect(parsePar(" 2.5 ")).toBe(2.5);
    expect(parsePar("")).toBe(0);
    expect(parsePar("four")).toBeNull();
    expect(parsePar("-1")).toBeNull();
  });
});

describe("linkedProductDraft", () => {
  it("links the ingredient, starts active with pack multiple 1 and leaves the supplier to the database", () => {
    const d = linkedProductDraft({ ingredientId: "i1", ingredientName: "Shiraz (750ml)", categoryId: "c3", unit: " carton ", par: 3 });
    expect(d).toMatchObject({ name: "Shiraz (750ml)", category_id: "c3", unit_name: "carton", ingredient_id: "i1", par: 3, pack_multiple: 1, active: true, supplier_id: null });
  });
  it("switching an ingredient on at a venue sends no price, item code, carton size or deal: those are the ingredient's", () => {
    const d = linkedProductDraft({ ingredientId: "i1", ingredientName: "Shiraz (750ml)", categoryId: "c3", unit: "carton", par: 0 });
    expect(d).toMatchObject({ price_inc_gst: null, supplier_item_code: null, costing_packs_per_unit: null, deal_buy_qty: null, deal_free_qty: null });
    expect(Object.keys(d).some((k) => k.startsWith("alt_"))).toBe(false);
  });
});

describe("a carton", () => {
  it("names one of the ingredient's packs by what a venue counts it by, else a guess, else pack", () => {
    expect(packWord({ name: "Bombay Sapphire (700ml)", pack_unit: "L", pack_size: 0.7 }, ["carton", "Bottle"])).toBe("bottle");
    expect(packWord({ name: "Bombay Sapphire (700ml)", pack_unit: "L", pack_size: 0.7 }, ["carton"])).toBe("bottle"); // guessed from the size
    expect(packWord({ name: "Super Crisp Keg", pack_unit: "L", pack_size: 49.5 })).toBe("keg");
    expect(packWord({ name: "Coke Cans (24 x 375ml)", pack_unit: "each", pack_size: 24 }, ["carton"])).toBe("pack"); // the 24 pack IS the pack
    expect(packWord({ name: "Chips", pack_unit: "kg", pack_size: 12 }, ["each"])).toBe("pack");
    expect(packWord({ name: "Yoghurt", pack_unit: "kg", pack_size: 2 }, ["tub"])).toBe("tub");
  });
  it("reads a carton size: empty clears it, zero and words are refused", () => {
    expect(parseCartonQty("6")).toBe(6);
    expect(parseCartonQty(" 4.5 ")).toBe(4.5);
    expect(parseCartonQty("")).toBeNull();
    expect(parseCartonQty("0")).toBeUndefined();
    expect(parseCartonQty("six")).toBeUndefined();
    expect(parseCartonQty("-2")).toBeUndefined();
  });
  it("reads a pack multiple: a whole number of 1 or more, blank is 1", () => {
    expect(parseMultiple("6")).toBe(6);
    expect(parseMultiple("")).toBe(1);
    expect(parseMultiple("0")).toBeNull();
    expect(parseMultiple("1.5")).toBeNull();
  });
});

describe("changing Counted By (never the unit alone)", () => {
  it("bottles to cartons: says what the Build To is about, from the ingredient's carton size", () => {
    const p = countedByPlan({ fromUnit: "bottle", toUnit: "carton", par: 30, packMultiple: 1, cartonQty: 6 });
    expect(p).toMatchObject({ same: false, suggestedPar: 5 });
    expect(p.parSentence).toBe("Build To 30 bottles is about 5 cartons (a carton holds 6).");
    expect(p.multipleSentence).toBeNull();
    // never zero cartons for a real Build To
    expect(countedByPlan({ fromUnit: "bottle", toUnit: "carton", par: 2, cartonQty: 12 }).suggestedPar).toBe(1);
  });
  it("cartons to bottles: multiplies", () => {
    const p = countedByPlan({ fromUnit: "Carton", toUnit: " bottle ", par: 5, cartonQty: 6 });
    expect(p.suggestedPar).toBe(30);
    expect(p.parSentence).toBe("Build To 5 cartons is 30 bottles (a carton holds 6).");
  });
  it("with no carton size, or between two units that are not the carton, the person types it: nothing is guessed", () => {
    const noQty = countedByPlan({ fromUnit: "bottle", toUnit: "carton", par: 30, cartonQty: null });
    expect(noQty.suggestedPar).toBeNull();
    expect(noQty.parSentence).toBe("Build To is 30 bottles now. Type the new Build To in cartons.");
    expect(countedByPlan({ fromUnit: "bottle", toUnit: "keg", par: 4, cartonQty: 6 }).suggestedPar).toBeNull();
    expect(countedByPlan({ fromUnit: "bottle", toUnit: "carton", par: 0, cartonQty: null })).toMatchObject({ suggestedPar: 0 });
  });
  it("says what happens to a pack multiple, which goes back to 1 unless it is kept", () => {
    const p = countedByPlan({ fromUnit: "bottle", toUnit: "carton", par: 18, packMultiple: 6, cartonQty: 6 });
    expect(p.multipleSentence).toBe("Orders go in multiples of 6 bottles today. That goes back to one carton at a time unless you keep it.");
  });
  it("picking the same unit is no change", () => {
    expect(countedByPlan({ fromUnit: "Bottle", toUnit: "bottle", par: 30, cartonQty: 6 })).toMatchObject({ same: true, suggestedPar: 30, multipleSentence: null });
    expect(countedByPlan({ fromUnit: "bottle", toUnit: "", par: 30 }).same).toBe(true);
  });
  it("no dashes in any sentence", () => {
    for (const p of [countedByPlan({ fromUnit: "bottle", toUnit: "carton", par: 30, packMultiple: 6, cartonQty: 6 }), countedByPlan({ fromUnit: "bottle", toUnit: "keg", par: 4 })]) {
      expect(`${p.parSentence} ${p.multipleSentence ?? ""}`).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

describe("the ingredient page is the only editor of an order item", () => {
  const ui = readFileSync("components/ingredient-ordering.tsx", "utf8");
  it("shows A Carton Holds and the supplier item code once, above the venues, and saves them on the INGREDIENT", () => {
    expect(ui).toContain('label="A Carton Holds"');
    expect(ui).toContain("saveIngredient({ carton_qty: v })");
    expect(ui).toContain('label="Supplier Item Code"');
    expect(ui).toContain("saveIngredient({ supplier_code:");
  });
  it("shows Category, Counted By, Build To, the pack multiple and a note per venue, and the order price in words", () => {
    for (const label of ['label="Category"', 'label="Counted By"', 'label="Build To"', 'label="Order In Multiples Of"', 'label="Count Note (Optional)"']) expect(ui, label).toContain(label);
    expect(ui).toContain("orderPriceSentence(facts, pack)");
  });
  it("never changes Counted By alone: the unit is only ever written with a new Build To and pack multiple, from the one sheet", () => {
    const writes = [...ui.matchAll(/unit_name: ([^,}]+)[,}]/g)].map((m) => m[0]);
    // the one write (and its Undo) carry all three; every other mention reads the unit
    expect(ui).toContain("onSave({ unit_name: next, par, pack_multiple: keep ? multiple : 1 }, { unit_name: product.unit_name, par: product.par ?? 0, pack_multiple: multiple })");
    expect(ui).not.toMatch(/changeOrderingProduct\(sb, [^)]*\{ unit_name: [^,}]*\}/);
    expect(ui).not.toMatch(/saveField\([^)]*\{ unit_name: [^,}]*\}/);
    expect(writes.length).toBeGreaterThan(0);
    expect(ui).toContain("countedByPlan(");
  });
  it("writes nothing about the product itself on an order item: no price, code, name, supplier or deal", () => {
    expect(ui).not.toMatch(/price_inc_gst: (?!p\.|product\.)|supplier_item_code: (?!p\.|product\.)|costing_packs_per_unit|deal_buy_qty|deal_free_qty|alt_/);
    expect(ui).not.toMatch(/Open Product Setup|setup\/products/);
  });
  it("every control is at least 44px and nothing shrinks at a breakpoint", () => {
    expect(ui).not.toMatch(/\b(?:sm|md|lg|xl):(?:min-)?h-(?:\[(?:[0-3]?\d|4[0-3])px\]|\d(?:\.\d)?\b|10\b)/);
    expect(ui).toContain("h-11 min-h-[44px]");
    expect(ui).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("readyPicks", () => {
  it("keeps finished picks and counts unfinished ones", () => {
    expect(
      readyPicks([
        { venueId: 1, categoryId: "c1", unit: "bottle" },
        { venueId: 2, categoryId: "", unit: "carton" },
      ]),
    ).toEqual({ ready: [{ venueId: 1, categoryId: "c1", unit: "bottle" }], unfinished: 1 });
    expect(readyPicks([])).toEqual({ ready: [], unfinished: 0 });
  });
});
