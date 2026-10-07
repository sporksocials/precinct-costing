import { describe, expect, it } from "vitest";
import {
  BUTTON_MAX,
  NOTE_BUTTON_LONG,
  NOTE_NO_PRICE,
  brisbaneDateLabel,
  buildPosRows,
  buildPosSheets,
  buttonName,
  groupRank,
  menuGroup,
  plainNote,
  posFileName,
  sheetTabName,
  sizeRank,
  splitSize,
  titleCase,
  type PosInput,
  type PosVenue,
} from "@/lib/pos-list";
import { beerItemId } from "@/lib/beer";
import { virtualItemId } from "@/lib/gelato";
import type { Beer, BeerServe, GelatoServe, MenuItem } from "@/lib/types";

const VENUES: PosVenue[] = [
  { id: 1, slug: "drift", name: "Drift", short: "Drift" },
  { id: 2, slug: "chiobu", name: "Chiobu", short: "Chiobu" },
  { id: 3, slug: "gelato", name: "Gelato", short: "Gelato" },
];

let n = 0;
function item(p: Partial<MenuItem> & { name: string }): MenuItem {
  n += 1;
  return { id: `i${n}`, venue_id: 2, category: "Food", section: null, portions: 1, sell_price_inc: 20, target_override: null, hh_price_inc: null, active: true, source: null, notes: null, ...p };
}
const empty: PosInput = { items: [], beers: [], beerServes: [], gelatoServes: [] };
const input = (items: MenuItem[], extra: Partial<PosInput> = {}): PosInput => ({ ...empty, items, ...extra });

describe("titleCase", () => {
  it("capitalises each word and leaves spelling alone", () => {
    expect(titleCase("black pepper prawns")).toBe("Black Pepper Prawns");
    expect(titleCase("tradional espresso")).toBe("Tradional Espresso");
  });
  it("keeps small words lower case unless first", () => {
    expect(titleCase("pork and prawn wonton")).toBe("Pork and Prawn Wonton");
    expect(titleCase("the best of both")).toBe("The Best of Both");
  });
  it("keeps names and acronyms that already have capitals", () => {
    expect(titleCase("WMC Riesling")).toBe("WMC Riesling");
    expect(titleCase("Heart & Soul Rose")).toBe("Heart & Soul Rose");
    expect(titleCase("heart & soul rosé")).toBe("Heart & Soul Rosé");
    expect(titleCase("McLaren Vale shiraz")).toBe("McLaren Vale Shiraz");
  });
  it("handles hyphens, brackets and numbers", () => {
    expect(titleCase("slow-cooked beef (3)")).toBe("Slow-Cooked Beef (3)");
    expect(titleCase("150ml glass")).toBe("150ml Glass");
    expect(titleCase("  chilli   salt  fries ")).toBe("Chilli Salt Fries");
  });
});

describe("splitSize", () => {
  it("splits on the last separator", () => {
    expect(splitSize("House Red - 150ml Glass", "Wine")).toEqual({ item: "House Red", size: "150ml Glass" });
    expect(splitSize("Heart & Soul Rose - 150ml Glass", "Wine")).toEqual({ item: "Heart & Soul Rose", size: "150ml Glass" });
    expect(splitSize("Coke - Schooner", "Cold Drink")).toEqual({ item: "Coke", size: "Schooner" });
    expect(splitSize("Chiobu - House - Jug", "Wine")).toEqual({ item: "Chiobu - House", size: "Jug" });
  });
  it("leaves a name with no separator alone, and never splits food or cocktails", () => {
    expect(splitSize("Coke", "Cold Drink")).toEqual({ item: "Coke", size: "" });
    expect(splitSize("Chilli - Salt Fries", "Food")).toEqual({ item: "Chilli - Salt Fries", size: "" });
    expect(splitSize("Margarita - Jug", "Cocktail")).toEqual({ item: "Margarita - Jug", size: "" });
    expect(splitSize("Coke - ", "Cold Drink")).toEqual({ item: "Coke -", size: "" });
  });
});

describe("sizeRank", () => {
  it("orders beer sizes Pot, Schooner, Pint, Jug", () => {
    const sizes = ["Jug", "Pint", "Pot", "Schooner"];
    expect(sizes.sort((a, b) => sizeRank(a) - sizeRank(b))).toEqual(["Pot", "Schooner", "Pint", "Jug"]);
  });
  it("orders glasses by ml, bottle last", () => {
    const sizes = ["Bottle", "250ml Glass", "150ml Glass", "180ml Glass"];
    expect(sizes.sort((a, b) => sizeRank(a) - sizeRank(b))).toEqual(["150ml Glass", "180ml Glass", "250ml Glass", "Bottle"]);
    expect(sizeRank("750ml Bottle")).toBeGreaterThan(sizeRank("375ml Bottle"));
    expect(sizeRank("750ml Bottle")).toBeGreaterThan(sizeRank("1.5L Glass"));
  });
  it("puts unknown sizes between glasses and bottles", () => {
    expect(sizeRank("Bucket")).toBeGreaterThan(sizeRank("Jug"));
    expect(sizeRank("Bucket")).toBeLessThan(sizeRank("Bottle"));
  });
});

describe("menuGroup and group order", () => {
  it("uses the section when set, otherwise the category", () => {
    expect(menuGroup("Food", "Small chow")).toBe("Small chow");
    expect(menuGroup("Food", "  ")).toBe("Food");
    expect(menuGroup("Cocktail", null)).toBe("Cocktails");
    expect(menuGroup("Mocktail", null)).toBe("Mocktails");
    expect(menuGroup("Cold Drink", null)).toBe("Soft Drinks");
    expect(menuGroup("Wine", null)).toBe("Wine");
    expect(menuGroup("Tap Beer", null)).toBe("Tap Beer");
    expect(menuGroup("Spirits", null)).toBe("Spirits");
  });
  it("ranks the groups in the agreed order, others after", () => {
    const order = ["Small chow", "Salads", "Sides", "Big chow", "Food", "Cocktails", "Mocktails", "Wine", "Tap Beer", "Soft Drinks"];
    const ranks = order.map(groupRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(order.length);
    expect(groupRank("Spirits")).toBeGreaterThan(groupRank("Soft Drinks"));
    expect(groupRank("SMALL CHOW")).toBe(groupRank("Small chow"));
    expect(groupRank("Smalls")).toBe(groupRank("Small chow"));
    expect(groupRank("Mains")).toBe(groupRank("Big chow"));
  });
});

describe("buttonName", () => {
  it("leaves names that fit alone", () => {
    expect(buttonName("Kung Pao Calamari")).toEqual({ name: "Kung Pao Calamari", fits: true });
    expect(buttonName("black pepper prawns".replace(/\b\w/g, (c) => c.toUpperCase()))).toEqual({ name: "Black Pepper Prawns", fits: true });
  });
  it("applies the rules in order", () => {
    // " and " -> " & "
    expect(buttonName("Fish and Chips Basket").name).toBe("Fish & Chips Basket");
    expect(buttonName("Crispy Salt and Pepper Prawns").name).toBe("S&P Prawns");
    // leading "The "
    expect(buttonName("The Chiobu Sharing Box").name).toBe("Chiobu Sharing Box");
    // drop Chicken / Salad only when still too long
    expect(buttonName("Thai Green Chicken Curry").name).toBe("Thai Green Curry");
    expect(buttonName("Crispy Pork Salad").name).toBe("Crispy Pork Salad");
    expect(buttonName("Barramundi and Grapefruit Salad").name).toBe("Barra & Grapefruit");
    // abbreviation
    expect(buttonName("Traditional Margarita Jug").name).toBe("Margarita Jug");
    expect(buttonName("Kopu Sauvignon Blanc Reserve").name.length).toBeLessThanOrEqual(BUTTON_MAX);
  });
  it("drops a trailing count in brackets", () => {
    expect(buttonName("Crispy Rice Betel Leaf (3)").name).toBe("Rice Betel Leaf");
    expect(buttonName("Bao (3)").name).toBe("Bao (3)");
    expect(buttonName("Rendang Spring Rolls (3)").name).toBe("Rendang Spr Roll");
  });
  it("cuts at a word boundary as a last resort, never leaving a dangling connector", () => {
    const b = buttonName("Slow Braised Wagyu Beef Cheek & Potato");
    expect(b.fits).toBe(true);
    expect(b.name.length).toBeLessThanOrEqual(BUTTON_MAX);
    expect(b.name).not.toMatch(/(&|and|of|with)$/i);
    expect("Slow Braised Wagyu Beef Cheek & Potato".startsWith(b.name)).toBe(true);
  });
  it("reports a name that cannot fit at all", () => {
    const b = buttonName("Supercalifragilisticexpialidocious");
    expect(b.fits).toBe(false);
  });
  it("never produces more than 19 characters unless it says it does not fit", () => {
    const names = [
      "Roti and Satay",
      "Hiramasa Kingfish Sashimi",
      "Seared Beef Tataki",
      "Crispy Salt and Pepper Prawns",
      "Pork and Prawn Dumplings (5)",
      "Karaage Chicken Bao (3)",
      "Shiitake and Veg Spring Rolls (3)",
      "Barramundi and Grapefruit Salad",
      "Massaman Beef Cheek Curry",
      "Sizzling Taiwanese Chicken",
      "Katsu Chicken Rice Bowl",
      "Lemongrass Pina Colada",
      "Traditional Espresso Martini",
      "Masterpeace Pinot Grigio",
      "Kopu Sauvignon Blanc",
      "Heart & Soul Rose",
      "Chocolate Strawberry Milkshake Special",
      "A",
      "",
    ];
    for (const raw of names) {
      const b = buttonName(titleCase(raw));
      expect(b.fits ? b.name.length <= BUTTON_MAX : true, raw).toBe(true);
      if (!b.fits) expect(b.name.length, raw).toBeGreaterThan(BUTTON_MAX);
    }
  });
});

describe("plainNote", () => {
  it("keeps short plain notes", () => {
    expect(plainNote("Served with chips")).toBe("Served with chips");
    expect(plainNote("  Gluten free bun available  ")).toBe("Gluten free bun available");
  });
  it("drops anything long, odd or internal", () => {
    expect(plainNote(null)).toBe("");
    expect(plainNote("")).toBe("");
    expect(plainNote("x".repeat(61))).toBe("");
    expect(plainNote("Line one\nline two")).toBe("");
    expect(plainNote("Cost went up $2 from supplier")).toBe("");
    expect(plainNote("Check price with Matt")).toBe("");
    expect(plainNote("See https://example.com/menu")).toBe("");
    expect(plainNote("ask chef@drift.com.au")).toBe("");
    expect(plainNote("GP is low")).toBe("");
  });
});

describe("posFileName and dates", () => {
  it("names the file by venue and Brisbane date", () => {
    expect(posFileName("Chiobu", new Date("2026-10-07T03:00:00Z"))).toBe("Chiobu POS List (7 Oct 2026).xlsx");
    expect(posFileName(null, new Date("2026-10-07T03:00:00Z"))).toBe("All Venues POS List (7 Oct 2026).xlsx");
  });
  it("uses Brisbane time, not UTC", () => {
    // 15:00 UTC on the 6th is 01:00 on the 7th in Brisbane
    expect(brisbaneDateLabel(new Date("2026-10-06T15:00:00Z"))).toBe("7 Oct 2026");
    expect(brisbaneDateLabel(new Date("2026-12-31T14:30:00Z"))).toBe("1 Jan 2027");
  });
  it("strips characters a file name cannot hold", () => {
    expect(posFileName("A/B:C", new Date("2026-10-07T03:00:00Z"))).toBe("ABC POS List (7 Oct 2026).xlsx");
  });
  it("makes safe, unique tab names", () => {
    expect(sheetTabName("Chiobu")).toBe("Chiobu");
    expect(sheetTabName("Notes")).not.toBe("Notes");
    expect(sheetTabName("Drift", new Set(["drift"]))).toBe("Drift 2");
    expect(sheetTabName("A/B[C]").includes("/")).toBe(false);
    expect(sheetTabName("x".repeat(50)).length).toBeLessThanOrEqual(31);
  });
});

describe("buildPosRows", () => {
  it("orders groups, items alphabetically, and wine sizes by ml with the bottle last", () => {
    const rows = buildPosRows(
      input([
        item({ name: "zucchini fritters", section: "Sides" }),
        item({ name: "asian greens", section: "Sides" }),
        item({ name: "roti and satay", section: "Small chow" }),
        item({ name: "Margarita", category: "Cocktail" }),
        item({ name: "House Red - Bottle", category: "Wine", sell_price_inc: 43 }),
        item({ name: "House Red - 250ml Glass", category: "Wine", sell_price_inc: 15 }),
        item({ name: "House Red - 150ml Glass", category: "Wine", sell_price_inc: 9.5 }),
        item({ name: "Coke - Jug", category: "Cold Drink", sell_price_inc: 14 }),
        item({ name: "Coke - Pot", category: "Cold Drink", sell_price_inc: 4.3 }),
        item({ name: "Coke - Schooner", category: "Cold Drink", sell_price_inc: 5.1 }),
        item({ name: "Gin and Tonic", category: "Spirits" }),
      ]),
      2,
    );
    expect(rows.map((r) => [r.group, r.item, r.size])).toEqual([
      ["Small chow", "Roti and Satay", ""],
      ["Sides", "Asian Greens", ""],
      ["Sides", "Zucchini Fritters", ""],
      ["Cocktails", "Margarita", ""],
      ["Wine", "House Red", "150ml Glass"],
      ["Wine", "House Red", "250ml Glass"],
      ["Wine", "House Red", "Bottle"],
      ["Soft Drinks", "Coke", "Pot"],
      ["Soft Drinks", "Coke", "Schooner"],
      ["Soft Drinks", "Coke", "Jug"],
      ["Spirits", "Gin and Tonic", ""],
    ]);
  });

  it("uses the real Chiobu names", () => {
    const rows = buildPosRows(
      input([
        item({ name: "black pepper prawns", section: "Small chow", sell_price_inc: 24 }),
        item({ name: "tradional espresso", category: "Cocktail", sell_price_inc: 22 }),
        item({ name: "Heart & Soul Rose - 150ml Glass", category: "Wine", sell_price_inc: 11 }),
        item({ name: "WMC Riesling - Bottle", category: "Wine", sell_price_inc: 54 }),
        item({ name: "Coke - Schooner", category: "Cold Drink", sell_price_inc: 5.1 }),
      ]),
      2,
    );
    const by = (item: string, size = "") => rows.find((r) => r.item === item && r.size === size)!;
    expect(by("Black Pepper Prawns").button).toBe("Black Pepper Prawns");
    expect(by("Tradional Espresso").group).toBe("Cocktails");
    expect(by("Heart & Soul Rose", "150ml Glass")).toMatchObject({ group: "Wine", priceInc: 11 });
    expect(by("WMC Riesling", "Bottle").priceInc).toBe(54);
    expect(by("Coke", "Schooner")).toMatchObject({ group: "Soft Drinks", button: "Coke", priceInc: 5.1 });
  });

  it("every button name is at most 19 characters or the row is flagged", () => {
    const rows = buildPosRows(
      input([
        item({ name: "crispy salt and pepper prawns" }),
        item({ name: "barramundi and grapefruit salad" }),
        item({ name: "Supercalifragilisticexpialidocious" }),
        item({ name: "pork and prawn dumplings (5)" }),
        item({ name: "shiitake and veg spring rolls (3)" }),
      ]),
      2,
    );
    expect(rows.length).toBe(5);
    for (const r of rows) {
      if (r.buttonFits) expect(r.button.length).toBeLessThanOrEqual(BUTTON_MAX);
      else {
        expect(r.needsLook).toBe(true);
        expect(r.notes).toContain(NOTE_BUTTON_LONG);
      }
    }
    expect(rows.filter((r) => !r.buttonFits).map((r) => r.item)).toEqual(["Supercalifragilisticexpialidocious"]);
  });

  it("skips inactive items and other venues, keeps active ones", () => {
    const rows = buildPosRows(
      input([item({ name: "Live" }), item({ name: "Off", active: false }), item({ name: "Elsewhere", venue_id: 1 })]),
      2,
    );
    expect(rows.map((r) => r.item)).toEqual(["Live"]);
  });

  it("flags a missing price, and treats zero as missing", () => {
    const rows = buildPosRows(input([item({ name: "Free Thing", sell_price_inc: null }), item({ name: "Zero Thing", sell_price_inc: 0 }), item({ name: "Priced Thing" })]), 2);
    const free = rows.find((r) => r.item === "Free Thing")!;
    expect(free).toMatchObject({ priceInc: null, needsLook: true, notes: NOTE_NO_PRICE });
    expect(rows.find((r) => r.item === "Zero Thing")!.needsLook).toBe(true);
    expect(rows.find((r) => r.item === "Priced Thing")).toMatchObject({ needsLook: false, notes: "" });
  });

  it("carries happy hour and a plain note, and combines notes with flags", () => {
    const rows = buildPosRows(
      input([
        item({ name: "Pot Roast", hh_price_inc: 18, notes: "Served with gravy" }),
        item({ name: "Mystery Dish", sell_price_inc: null, notes: "Served cold" }),
        item({ name: "Internal Dish", notes: "Cost up, check supplier invoice" }),
      ]),
      2,
    );
    expect(rows.find((r) => r.item === "Pot Roast")).toMatchObject({ hhInc: 18, notes: "Served with gravy" });
    expect(rows.find((r) => r.item === "Mystery Dish")!.notes).toBe(`${NOTE_NO_PRICE}. Served cold`);
    expect(rows.find((r) => r.item === "Internal Dish")!.notes).toBe("");
  });

  it("never carries cost, GP or target anywhere", () => {
    const rows = buildPosRows(input([item({ name: "Dish", target_override: 0.72 })]), 2);
    const text = JSON.stringify(rows).toLowerCase();
    for (const bad of ["cost", "gp", "target", "margin", "0.72"]) expect(text).not.toContain(bad);
    expect(Object.keys(rows[0]).sort()).toEqual(["button", "buttonFits", "group", "hhInc", "item", "needsLook", "notes", "priceInc", "size"]);
  });

  it("lists tap beers by serve with ml, in Pot, Schooner, Pint, Jug order, with happy hour", () => {
    const beer: Beer = { id: "b1", venue_id: 2, name: "chiobu house beer", ingredient_id: null, target_gp: null, active: true, sort: 0, notes: null };
    const serves: BeerServe[] = [
      { id: "s4", name: "Jug", sort: 4, ml: 1140, active: true },
      { id: "s1", name: "Pot", sort: 1, ml: 285, active: true },
      { id: "s3", name: "Pint", sort: 3, ml: 570, active: true },
      { id: "s2", name: "Schooner", sort: 2, ml: 425, active: true },
    ];
    const price = (sid: string, p: number | null, hh: number | null = null) =>
      item({ id: beerItemId("b1", sid), name: `chiobu house beer - ${serves.find((s) => s.id === sid)!.name}`, category: "Tap Beer", section: "Tap", sell_price_inc: p, hh_price_inc: hh });
    const rows = buildPosRows(input([price("s4", 26.5), price("s1", 6.3), price("s3", 14.2), price("s2", 10.3, 7.5)], { beers: [beer], beerServes: serves }), 2);
    expect(rows.map((r) => [r.group, r.item, r.size, r.priceInc, r.hhInc])).toEqual([
      ["Tap Beer", "Chiobu House Beer", "Pot 285ml", 6.3, null],
      ["Tap Beer", "Chiobu House Beer", "Schooner 425ml", 10.3, 7.5],
      ["Tap Beer", "Chiobu House Beer", "Pint 570ml", 14.2, null],
      ["Tap Beer", "Chiobu House Beer", "Jug 1140ml", 26.5, null],
    ]);
  });

  it("skips a tap beer whose beer is switched off and a beer serve that is gone", () => {
    const beer: Beer = { id: "b1", venue_id: 2, name: "Lager", ingredient_id: null, target_gp: null, active: false, sort: 0, notes: null };
    const rows = buildPosRows(
      input(
        [
          item({ id: beerItemId("b1", "s1"), name: "Lager - Pot", category: "Tap Beer", active: false }),
          item({ id: beerItemId("b1", "gone"), name: "Lager - Gone", category: "Tap Beer" }),
        ],
        { beers: [beer], beerServes: [{ id: "s1", name: "Pot", sort: 1, ml: 285, active: true }] },
      ),
      2,
    );
    expect(rows).toEqual([]);
  });

  it("lists gelato by serve (on the menu only), with price, and never by flavour", () => {
    const serves: GelatoServe[] = [
      { id: "g2", venue_id: 3, name: "double scoop", sort: 2, grams: 160, sell_price_inc: 9, on_menu: true, active: true, notes: null },
      { id: "g1", venue_id: 3, name: "single scoop", sort: 1, grams: 80, sell_price_inc: 6, on_menu: true, active: true, notes: null },
      { id: "g9", venue_id: 3, name: "Wholesale Tub", sort: 9, grams: 4000, sell_price_inc: 80, on_menu: false, active: true, notes: null },
      { id: "g8", venue_id: 3, name: "Retired Cup", sort: 8, grams: 100, sell_price_inc: 5, on_menu: true, active: false, notes: null },
      { id: "g7", venue_id: 3, name: "No Price Cone", sort: 7, grams: 100, sell_price_inc: null, on_menu: true, active: true, notes: null },
    ];
    const flavourItem = item({ id: virtualItemId("p1", "g1"), name: "Pistachio - single scoop", venue_id: 3, category: "Gelato", sell_price_inc: 6 });
    const rows = buildPosRows(input([flavourItem], { gelatoServes: serves }), 3);
    expect(rows.map((r) => [r.group, r.item, r.size, r.priceInc, r.needsLook])).toEqual([
      ["Gelato", "Gelato", "Single Scoop", 6, false],
      ["Gelato", "Gelato", "Double Scoop", 9, false],
      ["Gelato", "Gelato", "No Price Cone", null, true],
    ]);
    // other venues get no gelato rows
    expect(buildPosRows(input([], { gelatoServes: serves }), 2)).toEqual([]);
  });
});

describe("buildPosSheets", () => {
  const items = [item({ name: "Chiobu Dish", venue_id: 2 }), item({ name: "Drift Dish", venue_id: 1 })];
  it("gives one sheet per venue that has rows, in venue order, for All", () => {
    const sheets = buildPosSheets(input(items), VENUES, null);
    expect(sheets.map((s) => s.venue.short)).toEqual(["Drift", "Chiobu"]);
  });
  it("gives just the chosen venue", () => {
    expect(buildPosSheets(input(items), VENUES, "chiobu").map((s) => s.venue.short)).toEqual(["Chiobu"]);
  });
  it("gives nothing for a venue with no rows or an unknown venue", () => {
    expect(buildPosSheets(input(items), VENUES, "gelato")).toEqual([]);
    expect(buildPosSheets(input(items), VENUES, "nope")).toEqual([]);
  });
});
