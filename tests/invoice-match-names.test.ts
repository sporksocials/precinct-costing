import { describe, expect, it } from "vitest";
import { carriesInvoiceName, finalName, leadWords, MAX_NAME, nameProblem, nameSizeFor, renameDefault, tidyInvoiceName } from "../lib/invoice-match-names";

const tidy = (d: string, packs: number | null = 1) => tidyInvoiceName(d, nameSizeFor(d, packs));

describe("tidyInvoiceName: real Bidfood and Markris descriptions", () => {
  it("Title Case, brand brackets kept, the size in the app's style", () => {
    expect(tidy("CHIPS 10MM SUPA CRUNCH ULTRAFAST (EDGELL) 6x2kg")).toBe("Chips 10mm Supa Crunch Ultrafast (Edgell) (6 x 2kg)");
    expect(tidy("POTATO WEDGES SEASONED (MCCAIN 2kg)")).toBe("Potato Wedges Seasoned (McCain) (2kg)");
    expect(tidy("MAYONNAISE AJICO (AJINOMOTO 1kg)")).toBe("Mayonnaise Ajico (Ajinomoto) (1kg)");
    expect(tidy("Fireball Cinnamon Whiskey 700mL 700ML")).toBe("Fireball Cinnamon Whiskey (700ml)");
    expect(tidy("SAN PELLEGRINO SPARKLING MINERAL WATER (24/250 ml C)")).toBe("San Pellegrino Sparkling Mineral Water (24 x 250ml)");
    expect(tidy("CABOOLTURE - MOZZARELLA DICED SHREDDED - (2 X 6KG) CTN")).toBe("Caboolture Mozzarella Diced Shredded (2 x 6kg)");
    expect(tidy("TOPPING CARAMEL (SUNSHINE 3lt)")).toBe("Topping Caramel (Sunshine) (3L)");
  });
  it("drops the supplier's shorthand: tildes, stars, dashes, trailing units, item numbers, house tags", () => {
    expect(tidy("BIRCH & WAITE - RICH TARTARE SAUCE ~ 10KG BUCKET ~")).toBe("Birch & Waite Rich Tartare Sauce (10kg)");
    expect(tidy("EDGELL - SHOESTRING 7mm G/FREE FRIES - 40174")).toBe("Edgell Shoestring 7mm Gluten Free Fries");
    expect(tidy("PRIMO - THINLY CUT VIRGINIAN HAM - 1KG - 01243 (MAYFAIR)")).toBe("Primo Thinly Cut Virginian Ham (Mayfair) (1kg)");
    expect(tidy("ONION BROWN LARGE KG")).toBe("Onion Brown Large");
    expect(tidy("CABBAGE RED EACH")).toBe("Cabbage Red");
    expect(tidy("BLUEBERRY 125G PUNNET")).toBe("Blueberry (125g)");
    expect(tidy("LETT MESCLUN MIX 1.5KG CASE")).toBe("Lett Mesclun Mix (1.5kg)");
    expect(tidy("BACON MIDDLE RINDLESS GAS FLUSHED (CATERERS C) 2.5kg")).toBe("Bacon Middle Rindless Gas Flushed (2.5kg)");
    expect(tidy("*EDAMAME (SHIOYUDE) BEAN SHELL ON ~ IN POD ~ (NTC)")).toBe("Edamame Bean Shell on in Pod (Shioyude)");
  });
  it("drops short supplier codes in brackets and a bracket the scan never closed", () => {
    expect(tidy("HTC - SHREDDED COCONUT MEAT STRIPPED FROZEN - 400G (green lab")).toBe("Htc Shredded Coconut Meat Stripped Frozen (400g)");
    expect(tidy("MISSION - TORTILLA PLAIN FLOUR WRAPS ** 12 INCH ** (DOZEN)")).toBe("Mission Tortilla Plain Flour Wraps 12 Inch");
  });
  it("does not say gluten free twice", () => {
    expect(tidy("MARKRIS - GLUTEN FREE PLAIN FLOUR - 1KG ~ G/FREE ~")).toBe("Markris Gluten Free Plain Flour (1kg)");
  });
  it("keeps an apostrophe and an ampersand", () => {
    expect(tidy("JIMMY'S - SATAY SAUCE - 360G JAR")).toBe("Jimmy's Satay Sauce (360g)");
  });
  it("leaves the size off when it is not given", () => {
    expect(tidy("BACON MIDDLE RINDLESS GAS FLUSHED (CATERERS C) 2.5kg", 2.5)).toBe("Bacon Middle Rindless Gas Flushed");
    expect(tidy("BACON MIDDLE RINDLESS GAS FLUSHED (CATERERS C) 2.5kg", null)).toBe("Bacon Middle Rindless Gas Flushed");
    expect(tidy("DATES PITTED")).toBe("Dates Pitted");
  });
  it("is never longer than 80 characters, cutting at a word boundary and keeping the size", () => {
    const long = "SUPER DELUXE EXTRA SPECIAL MEDITERRANEAN STYLE ROASTED CAPSICUM AND SUN DRIED TOMATO PASTE WITH BASIL (MARIGOLD) 6x2kg";
    const name = tidy(long);
    expect(name.length).toBeLessThanOrEqual(MAX_NAME);
    expect(name.endsWith("(Marigold) (6 x 2kg)")).toBe(true);
    expect(name).not.toMatch(/\s{2}/);
    expect(long.split(" ").map((w) => w.toLowerCase())).toEqual(expect.arrayContaining(name.replace(/\(.*$/, "").trim().toLowerCase().split(" ")));
  });
  it("running it on its own output changes nothing important", () => {
    const once = tidy("POTATO WEDGES SEASONED (MCCAIN 2kg)");
    expect(tidy(once)).toBe(once);
  });
  it("is empty for nothing", () => {
    expect(tidyInvoiceName(null)).toBe("");
    expect(tidyInvoiceName("  ")).toBe("");
  });
});

describe("nameSizeFor", () => {
  it("names a size only when one invoice unit is one app pack", () => {
    expect(nameSizeFor("CHIPS (EDGELL) 6x2kg", 1)).toBe("6 x 2kg");
    expect(nameSizeFor("CHIPS (EDGELL) 6x2kg", 1.004)).toBe("6 x 2kg");
    expect(nameSizeFor("CHIPS (EDGELL) 6x2kg", 6)).toBeNull();
    expect(nameSizeFor("BACON 2.5kg", 2.5)).toBeNull();
    expect(nameSizeFor("BACON 2.5kg", null)).toBeNull();
    expect(nameSizeFor("DATES PITTED", 1)).toBeNull();
  });
});

describe("renameDefault", () => {
  const all = [
    { id: "a", name: "Bacon" },
    { id: "b", name: "Chips" },
    { id: "c", name: "Bacon Middle Rindless Gas Flushed" },
  ];
  const base = { ingredientId: "a", currentName: "Bacon", newName: "Bacon Middle Rindless Gas Flushed (2.5kg)", ingredients: all, otherSuppliers: 0, takenInBatch: false };
  it("starts on for the first supplier (Troy asked for the rename)", () => {
    expect(renameDefault(base)).toEqual({ kind: "rename", rename: true, note: null });
  });
  it("does nothing when the name is already the invoice name", () => {
    expect(renameDefault({ ...base, currentName: "bacon  middle rindless gas flushed (2.5KG)" }).kind).toBe("same");
    expect(renameDefault({ ...base, currentName: "Chips", newName: "chips" }).rename).toBe(false);
  });
  it("a clash with another ingredient is refused in plain words and starts as Keep Current Name", () => {
    const r = renameDefault({ ...base, newName: "Bacon Middle Rindless Gas Flushed" });
    expect(r.kind).toBe("clash");
    expect(r.rename).toBe(false);
    expect(r.note).toBe("Another ingredient is already called Bacon Middle Rindless Gas Flushed. Pick a different name.");
  });
  it("a second row for the same ingredient in this batch keeps its name", () => {
    expect(renameDefault({ ...base, takenInBatch: true }).rename).toBe(false);
  });
  it("keeps the name when it already carries an invoice name AND another supplier is matched to it", () => {
    const carried = { ...base, currentName: "Bacon Middle Rindless Gas Flushed", newName: "Bacon Middle Rindless Gas Flushed Rashers (1kg)", ingredientId: "c" };
    expect(renameDefault({ ...carried, otherSuppliers: 0 }).rename).toBe(true);
    expect(renameDefault({ ...carried, otherSuppliers: 1 }).rename).toBe(false);
    // another supplier alone is not enough: "Bacon" has no invoice name yet
    expect(renameDefault({ ...base, otherSuppliers: 2 }).rename).toBe(true);
  });
  it("carriesInvoiceName compares the first three words", () => {
    expect(leadWords("Bacon Middle Rindless Gas Flushed (2.5kg)")).toEqual(["bacon", "middle", "rindless"]);
    expect(carriesInvoiceName("Bacon Middle Rindless Rashers", "Bacon Middle Rindless Gas Flushed")).toBe(true);
    expect(carriesInvoiceName("Bacon", "Bacon Middle Rindless Gas Flushed")).toBe(false);
    expect(carriesInvoiceName("Bacon", "")).toBe(false);
  });
});

describe("nameProblem", () => {
  const all = [
    { id: "a", name: "Bacon" },
    { id: "b", name: "Chips" },
  ];
  it("refuses blank, too long and clashing names", () => {
    expect(nameProblem("  ", "a", "Bacon", all)).toMatch(/Type a name/);
    expect(nameProblem("x".repeat(81), "a", "Bacon", all)).toMatch(/80 characters/);
    expect(nameProblem("chips", "a", "Bacon", all)).toBe("Another ingredient is already called Chips. Pick a different name.");
  });
  it("accepts its own name and a new one", () => {
    expect(nameProblem("bacon", "a", "Bacon", all)).toBeNull();
    expect(nameProblem("Bacon Middle", "a", "Bacon", all)).toBeNull();
  });
});

describe("finalName", () => {
  it("tidies what was typed and keeps the lower case x of a case", () => {
    expect(finalName("  chips 10mm  supa crunch (edgell) (6 x 2kg) ")).toBe("Chips 10mm Supa Crunch (Edgell) (6 x 2kg)");
  });
});
