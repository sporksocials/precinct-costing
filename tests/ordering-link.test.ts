import { describe, expect, it } from "vitest";
import {
  addedToast,
  categoriesOf,
  linkedProductDraft,
  notOrderedSentence,
  orderableVenues,
  orderedAtSentence,
  orderingProductName,
  parsePar,
  productSetupHref,
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
  it("drops the trailing size and tidies the name", () => {
    expect(orderingProductName("Shiraz (750ml)")).toBe("Shiraz");
    expect(orderingProductName("  bombay sapphire london dry gin (700ml) ")).toBe("Bombay Sapphire London Dry Gin");
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

describe("venueLinks", () => {
  it("shows the active linked product with its category and the supplier it landed under", () => {
    const [drift, chiobu] = venueLinks({ venues, categories: cats, products: [prod({})], terms });
    expect(drift.active).toEqual([]);
    expect(drift.stopped).toBeNull();
    expect(chiobu.active).toHaveLength(1);
    expect(orderedAtSentence("Chiobu", chiobu.active[0])).toBe("Ordered at Chiobu: Red, per carton, DCG Wines");
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
    expect(productSetupHref("chiobu", "abc")).toBe("/ordering/chiobu/setup/products/abc");
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
    expect(d).toMatchObject({ name: "Shiraz", category_id: "c3", unit_name: "carton", ingredient_id: "i1", par: 3, pack_multiple: 1, active: true, supplier_id: null });
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
