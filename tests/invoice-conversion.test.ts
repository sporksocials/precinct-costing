import { describe, expect, it } from "vitest";
import {
  amountWords,
  collapsedSentence,
  compareToApp,
  comparisonSentence,
  conversionView,
  deriveConversion,
  describedSize,
  differenceNote,
  parseAmountText,
  parsePacksText,
  parseSizes,
  quickFactors,
  readUnit,
  splitProduct,
  stripSizes,
} from "../lib/invoice-conversion";

const ing = (o: Partial<{ pack_size: number; pack_unit: string; pack_price: number; price_inc_gst: boolean; gst_free: boolean }> = {}) => ({
  pack_size: 1,
  pack_unit: "kg",
  pack_price: 11.8,
  price_inc_gst: false,
  gst_free: true,
  ...o,
});

const BACON = "BACON MIDDLE RINDLESS GAS FLUSHED (CATERERS C) 2.5kg";
const CHIPS = "CHIPS 10MM SUPA CRUNCH ULTRAFAST (EDGELL) 6x2kg";

describe("parseSizes", () => {
  it("reads weights, volumes and cases as the invoice prints them", () => {
    expect(parseSizes("BACON 2.5kg")[0]).toMatchObject({ dim: "kg", amount: 2.5, text: "2.5kg", multi: false });
    expect(parseSizes("CHIPS 6x2kg")).toEqual([
      { dim: "kg", amount: 12, text: "6 x 2kg", multi: true },
      { dim: "each", amount: 6, text: "6", multi: true },
    ]);
    expect(parseSizes("BROWNIES 28x80gr")[0]).toMatchObject({ dim: "kg", amount: 2.24, text: "28 x 80g" });
    expect(parseSizes("PAVLOVA 40x40gr")[0]).toMatchObject({ dim: "kg", amount: 1.6 });
    expect(parseSizes("PAVLOVA 40x85gr")[0]).toMatchObject({ dim: "kg", amount: 3.4 });
    expect(parseSizes("SAN PELLEGRINO (24/250 ml C)")[0]).toMatchObject({ dim: "L", amount: 6, text: "24 x 250ml" });
    expect(parseSizes("INSPIRITED BITTERS (12/250 ml)")[0]).toMatchObject({ dim: "L", amount: 3 });
    expect(parseSizes("Fireball 700mL 700ML")).toEqual([{ dim: "L", amount: 0.7, text: "700ml", multi: false }]);
    expect(parseSizes("TOPPING CARAMEL SUNSHINE 3lt")[0]).toMatchObject({ dim: "L", amount: 3, text: "3L" });
    expect(parseSizes("MENU MASTER - WHITE VINEGAR BAG IN BOX - 15LT BOX")[0]).toMatchObject({ dim: "L", amount: 15 });
  });
  it("reads counts: 30'S, a dozen, Qty:1000", () => {
    expect(parseSizes("30'S")).toEqual([{ dim: "each", amount: 30, text: "30", multi: false }]);
    expect(parseSizes("Clear Lids 95mm Sipper Lids(Qty:1000)")).toEqual([{ dim: "each", amount: 1000, text: "1000", multi: false }]);
    expect(parseSizes("TORTILLA (DOZEN)")[0]).toMatchObject({ dim: "each", amount: 12 });
  });
  it("does not read other numbers as sizes (10MM, 58%, 21/25 grades, 12 INCH, item numbers)", () => {
    expect(parseSizes("CHIPS 10MM SUPA CRUNCH")).toEqual([]);
    expect(parseSizes("CHOCOLATE 58% LINDT")).toEqual([]);
    expect(parseSizes("PRAWN MEAT (21/25) ~ 700G ~").map((c) => c.text)).toEqual(["700g"]);
    expect(parseSizes("TORTILLA ** 12 INCH **")).toEqual([]);
    expect(parseSizes("BROWNIES BADASS 1-047")).toEqual([]);
  });
  it("has stripSizes and describedSize for names", () => {
    expect(stripSizes("POTATO WEDGES 2kg")).toBe("POTATO WEDGES");
    expect(describedSize("CHIPS (EDGELL) 6x2kg")).toBe("6 x 2kg");
    expect(describedSize("DATES PITTED")).toBeNull();
  });
});

describe("readUnit", () => {
  it("handles the printed oddities", () => {
    expect(readUnit("EA (KG)")).toMatchObject({ label: "EA", canon: "each", measure: null });
    expect(readUnit("KG")).toMatchObject({ measure: "kg" });
    expect(readUnit("LT")).toMatchObject({ measure: "L" });
    expect(readUnit("CTN (2 X 6KG").holdsMany).toBe(true);
    expect(readUnit("CTN (2 X 6KG").sizes[0]).toMatchObject({ amount: 12 });
    expect(readUnit("EA (700G)").sizes[0]).toMatchObject({ dim: "kg", amount: 0.7 });
    expect(readUnit(null)).toMatchObject({ label: "UNIT", holdsMany: false });
    expect(readUnit(null, "Corona Stub Carton 355mL").holdsMany).toBe(true);
  });
});

describe("deriveConversion: Troy's examples", () => {
  it("Bacon: a PKT of 2.5kg against a 1 kg pack is 2.5 packs", () => {
    const d = deriveConversion({ description: BACON, unit: "PKT", ingredient: ing() });
    expect(d.packs).toBe(2.5);
    expect(d.how).toBe("described");
    expect(d.askWhy).toBeNull();
  });
  it("Chips: a CTN of 6x2kg against a 12 kg pack is 1 pack (12 kg)", () => {
    const d = deriveConversion({ description: CHIPS, unit: "CTN", ingredient: ing({ pack_size: 12 }) });
    expect(d.packs).toBe(1);
    expect(d.unitSize).toEqual({ amount: 12, dim: "kg" });
    expect(d.sizeText).toBe("6 x 2kg");
  });
  it("Chips against an app pack of 2 kg is 6 packs", () => {
    expect(deriveConversion({ description: CHIPS, unit: "CTN", ingredient: ing({ pack_size: 2 }) }).packs).toBe(6);
  });
  it("a 700ml bottle against a 0.7 L pack is 1; against a 700 ml pack too", () => {
    expect(deriveConversion({ description: "Bundaberg Rum 700mL 700ML", unit: null, ingredient: ing({ pack_size: 0.7, pack_unit: "L" }) }).packs).toBe(1);
    expect(deriveConversion({ description: "Fireball 700mL", unit: "BTL", ingredient: ing({ pack_size: 700, pack_unit: "ml" }) }).packs).toBe(1);
  });
  it("a dimension mismatch asks, and never defaults to 1", () => {
    const d = deriveConversion({ description: "MAYONNAISE AJICO (AJINOMOTO 1kg)", unit: "BTL", ingredient: ing({ pack_size: 1, pack_unit: "L" }) });
    expect(d.packs).toBeNull();
    expect(d.askWhy).toBe("dimension");
    expect(d.hint).toMatch(/litres/);
  });
});

describe("deriveConversion: the units on real Bidfood and Markris lines", () => {
  it("KG against a kg pack, L against a litre pack, are the unit itself", () => {
    expect(deriveConversion({ description: "ONION BROWN LARGE KG", unit: "KG", ingredient: ing({ pack_size: 1 }) })).toMatchObject({ packs: 1, trivial: true, how: "measure" });
    expect(deriveConversion({ description: "ONION BROWN LARGE KG", unit: "KG", ingredient: ing({ pack_size: 5 }) }).packs).toBe(0.2);
    expect(deriveConversion({ description: "MILK", unit: "L", ingredient: ing({ pack_size: 2, pack_unit: "L" }) }).packs).toBe(0.5);
    expect(deriveConversion({ description: "ONION", unit: "KG", ingredient: ing({ pack_unit: "L" }) }).askWhy).toBe("dimension");
  });
  it("EA against an each pack is one each", () => {
    const d = deriveConversion({ description: "CABBAGE RED EACH", unit: "EACH", ingredient: ing({ pack_size: 1, pack_unit: "each" }) });
    expect(d).toMatchObject({ packs: 1, how: "each", trivial: true });
    expect(deriveConversion({ description: "CABBAGE RED EACH", unit: "EA", ingredient: ing({ pack_size: 10, pack_unit: "each" }) }).packs).toBe(0.1);
  });
  it("a stated size in the unit's brackets works: EA (700G)", () => {
    expect(deriveConversion({ description: "BLUE WAVE - PRAWN MEAT NO TAIL RAW (21/25) ~ 700G ~", unit: "EA (700G)", ingredient: ing({ pack_size: 1 }) }).packs).toBe(0.7);
  });
  it("the same size said twice is one size (700mL 700ML; 1KG in the name and the unit)", () => {
    expect(deriveConversion({ description: "SPEEDI - STRAWBERRIES FRZ - 1KG", unit: "EA (1KG)", ingredient: ing({ pack_size: 1 }) }).packs).toBe(1);
  });
  it("two different sizes ask (360G JAR against EA (360ML) is one; 2.2KG TIN against EA (2LT) in kg is one size)", () => {
    const d = deriveConversion({ description: "LKK - HOISIN SAUCE G/FREE ~ 2.2KG TIN (GB)", unit: "EA (2KG)", ingredient: ing({ pack_size: 1 }) });
    expect(d.packs).toBeNull();
    expect(d.askWhy).toBe("conflict");
    expect(d.likelyPacks).toBe(2.2);
  });
  it("a single size on a carton may be the item, not the case: asks, offers the described size", () => {
    const d = deriveConversion({ description: "CHOCOLATE BUTTONS DARK TUSCANY COMPOUND CADBURY 5kg", unit: "CTN", ingredient: ing({ pack_size: 5 }) });
    expect(d.packs).toBeNull();
    expect(d.askWhy).toBe("carton");
    expect(d.likelyPacks).toBe(1);
    expect(d.hint).toMatch(/5kg/);
  });
  it("a carton that states its case (5 X 2KG, 24/250ml) is settled", () => {
    expect(deriveConversion({ description: "FARM FRITES - SWEET POTATO FRIES 9MM - (5 X 2KG) CTN", unit: "CTN", ingredient: ing({ pack_size: 10 }) }).packs).toBe(1);
    expect(deriveConversion({ description: "SAN PELLEGRINO SPARKLING MINERAL WATER (24/250 ml C)", unit: "CTN", ingredient: ing({ pack_size: 0.25, pack_unit: "L" }) }).packs).toBe(24);
  });
  it("a carton of the unnamed size (Chips with no size printed) asks", () => {
    const d = deriveConversion({ description: "CHIPS 10MM SUPA CRUNCH ULTRAFAST", unit: "CTN", ingredient: ing({ pack_size: 12 }) });
    expect(d.packs).toBeNull();
    expect(d.askWhy).toBe("no_size");
  });
  it("a count on a case is the whole case: CTN of 24 against an each pack", () => {
    expect(deriveConversion({ description: "BEER 24 pack", unit: "CTN", ingredient: ing({ pack_size: 1, pack_unit: "each" }) }).packs).toBe(24);
  });
  it("a bottle with no size against an each pack is one each; a case with no size is not", () => {
    expect(deriveConversion({ description: "SAUCE FISH GLUTEN FREE", unit: "BTL", ingredient: ing({ pack_size: 1, pack_unit: "each" }) }).packs).toBe(1);
    expect(deriveConversion({ description: "PANCAKES PLAIN", unit: "CTN", ingredient: ing({ pack_size: 1, pack_unit: "each" }) }).packs).toBeNull();
  });
  it("an ingredient with no usable pack asks", () => {
    expect(deriveConversion({ description: BACON, unit: "PKT", ingredient: ing({ pack_size: 0 }) }).askWhy).toBe("no_pack");
    expect(deriveConversion({ description: BACON, unit: "PKT", ingredient: ing({ pack_unit: "box" }) }).askWhy).toBe("no_pack");
  });
});

describe("compareToApp", () => {
  it("Bacon: $29.50 a PKT of 2.5 packs is $11.80 per kg, the app has $11.80: 0%", () => {
    const c = compareToApp({ packs: 2.5, unitPriceEx: 29.5, ingredient: ing(), gstRate: 0.1 });
    expect(c.state).toBe("match");
    expect(c.base).toBe("kg");
    expect(c.invoicePerBase).toBeCloseTo(11.8, 6);
    expect(c.appPerBase).toBeCloseTo(11.8, 6);
    expect(c.diff).toBeCloseTo(0, 6);
    expect(comparisonSentence(c, 29.5, "PKT")).toBe("So $29.50 a pkt is $11.80 per kg. The app has $11.80 per kg.");
    expect(differenceNote(c)).toBeNull();
  });
  it("Chips: 12 kg pack, per kg matches when the prices agree", () => {
    const c = compareToApp({ packs: 1, unitPriceEx: 58.19, ingredient: ing({ pack_size: 12, pack_price: 58.19, gst_free: false }), gstRate: 0.1 });
    expect(c.state).toBe("match");
    expect(c.invoicePerBase).toBeCloseTo(4.8492, 3);
  });
  it("the real chips line is 11% under the app: below, with the plain note", () => {
    const c = compareToApp({ packs: 1, unitPriceEx: 51.7, ingredient: ing({ pack_size: 12, pack_price: 58.19, gst_free: false }), gstRate: 0.1 });
    expect(c.state).toBe("below");
    expect(differenceNote(c)).toBe("The invoice is 11% below the app. Check the pack size or the app price.");
  });
  it("5% or more is flagged, under 5% is a match", () => {
    const base = { packs: 1, ingredient: ing({ pack_price: 100, gst_free: false }), gstRate: 0.1 };
    expect(compareToApp({ ...base, unitPriceEx: 104.99 }).state).toBe("match");
    expect(compareToApp({ ...base, unitPriceEx: 105 }).state).toBe("above");
    expect(compareToApp({ ...base, unitPriceEx: 95 }).state).toBe("below");
    expect(compareToApp({ ...base, unitPriceEx: 95.01 }).state).toBe("match");
    expect(differenceNote(compareToApp({ ...base, unitPriceEx: 131 }))).toBe("The invoice is 31% above the app. Check the pack size or the app price.");
  });
  it("compares ex GST on both sides: a GST-inclusive ingredient is taken to its ex GST price", () => {
    // app pack $22.00 inc GST = $20.00 ex; invoice $20.00 ex GST
    const c = compareToApp({ packs: 1, unitPriceEx: 20, ingredient: ing({ pack_price: 22, price_inc_gst: true, gst_free: false }), gstRate: 0.1 });
    expect(c.state).toBe("match");
    expect(c.appPerBase).toBeCloseTo(20, 6);
    // a GST-free ingredient is not divided
    const f = compareToApp({ packs: 1, unitPriceEx: 22, ingredient: ing({ pack_price: 22, price_inc_gst: true, gst_free: true }), gstRate: 0.1 });
    expect(f.state).toBe("match");
    expect(f.appPerBase).toBeCloseTo(22, 6);
  });
  it("per litre and per each use the pack in base units", () => {
    expect(compareToApp({ packs: 1, unitPriceEx: 43.64, ingredient: ing({ pack_size: 700, pack_unit: "ml", pack_price: 43.64, gst_free: false }), gstRate: 0.1 }).invoicePerBase).toBeCloseTo(62.34, 1);
    const e = compareToApp({ packs: 1, unitPriceEx: 6, ingredient: ing({ pack_size: 1, pack_unit: "each", pack_price: 6, gst_free: false }), gstRate: 0.1 });
    expect(e.base).toBe("each");
  });
  it("says so when a price is missing", () => {
    expect(compareToApp({ packs: 1, unitPriceEx: null, ingredient: ing(), gstRate: 0.1 }).state).toBe("no_invoice_price");
    expect(compareToApp({ packs: 1, unitPriceEx: 5, ingredient: ing({ pack_price: 0 }), gstRate: 0.1 }).state).toBe("no_app_price");
    expect(comparisonSentence(compareToApp({ packs: 1, unitPriceEx: 5, ingredient: ing({ pack_price: 0 }), gstRate: 0.1 }), 5, "BTL")).toContain("The app has no price for this yet.");
  });
});

describe("conversionView", () => {
  const base = { description: BACON, unit: "PKT", unitPriceEx: 29.5, ingredient: ing(), gstRate: 0.1 };
  it("fills the box with the derived number and shows the sentence", () => {
    const v = conversionView(base);
    expect(v.packs).toBe(2.5);
    expect(v.boxText).toBe("2.5");
    expect(v.unitLabel).toBe("PKT");
    expect(v.sentence).toContain("$11.80 per kg");
    expect(v.note).toBeNull();
    expect(v.blocker).toBeNull();
    expect(v.collapsed).toBe(false);
  });
  it("a typed amount wins and changes the comparison", () => {
    const v = conversionView({ ...base, typed: "1" });
    expect(v.packs).toBe(1);
    expect(v.amount).toBe(1);
    expect(v.note).toBe("The invoice is 150% above the app. Check the pack size or the app price.");
  });
  it("the box holds the amount in the base unit: the derived 2.5 kg for the bacon", () => {
    const v = conversionView(base);
    expect(v.amount).toBe(2.5);
    expect(v.base).toBe("kg");
  });
  it("Troy's chips: a CTN with no size asks how many kg; 6 x 2 is 12 kg, one whole 12 kg pack", () => {
    const chips = { description: "CHIPS 10MM SUPA CRUNCH ULTRAFAST", unit: "CTN", unitPriceEx: 51.7, ingredient: ing({ pack_size: 12, pack_price: 58.19, gst_free: false }), gstRate: 0.1 };
    const ask = conversionView(chips);
    expect(ask.packs).toBeNull();
    expect(ask.blocker).toBe("Tell the app how many kg are in one CTN.");
    expect(ask.quick).toEqual([12]);
    const v = conversionView({ ...chips, typed: "6 x 2" });
    expect(v.amount).toBe(12);
    expect(v.packs).toBe(1);
    expect(v.comparison?.invoicePerBase).toBeCloseTo(4.3083, 3);
    expect(v.note).toBe("The invoice is 11% below the app. Check the pack size or the app price.");
    expect(conversionView({ ...chips, typed: "12" }).packs).toBe(1);
    expect(conversionView({ ...chips, typed: "24kg" }).packs).toBe(2);
    expect(conversionView({ ...chips, typed: "6" }).packs).toBe(0.5);
  });
  it("unknown conversion: empty box, a blocker, and quick buttons in the base unit", () => {
    const v = conversionView({ ...base, description: "CHOCOLATE BUTTONS 5kg", unit: "CTN", ingredient: ing({ pack_size: 5 }) });
    expect(v.packs).toBeNull();
    expect(v.boxText).toBe("");
    expect(v.blocker).toBe("Tell the app how many kg are in one CTN.");
    expect(v.quick[0]).toBe(5);
    expect(v.sentence).toBeNull();
  });
  it("litres and eaches ask in their own words", () => {
    const v = conversionView({ description: "SAUCE", unit: "CTN", unitPriceEx: 40, ingredient: ing({ pack_size: 1, pack_unit: "L" }), gstRate: 0.1 });
    expect(v.blocker).toBe("Tell the app how many L are in one CTN.");
    expect(conversionView({ description: "BEER", unit: "CTN", unitPriceEx: 40, ingredient: ing({ pack_size: 1, pack_unit: "each" }), gstRate: 0.1 }).blocker).toBe("Tell the app how many items are in one CTN.");
    expect(conversionView({ description: "BEER", unit: "CTN", unitPriceEx: 40, ingredient: ing({ pack_size: 1, pack_unit: "each" }), gstRate: 0.1, typed: "24" }).packs).toBe(24);
  });
  it("rubbish or zero typed counts as not settled", () => {
    for (const t of ["", "0", "-2", "abc", "1.23456", "10001"]) {
      const v = conversionView({ ...base, typed: t });
      expect(v.packs, t).toBeNull();
      expect(v.blocker, t).toBeTruthy();
    }
    expect(conversionView({ ...base, typed: "abc" }).invalid).toBe(true);
    expect(conversionView({ ...base, typed: "" }).invalid).toBe(false);
  });
  it("KG against a kg ingredient is collapsed when it matches", () => {
    const v = conversionView({ description: "ONION BROWN LARGE KG", unit: "KG", unitPriceEx: 11.8, ingredient: ing(), gstRate: 0.1 });
    expect(v.collapsed).toBe(true);
    expect(collapsedSentence(v)).toBe("Per kg, matches the app.");
  });
  it("a KG line that disagrees with the app is not collapsed (the amber note shows)", () => {
    const v = conversionView({ description: "ONION BROWN LARGE KG", unit: "KG", unitPriceEx: 20, ingredient: ing(), gstRate: 0.1 });
    expect(v.collapsed).toBe(false);
    expect(v.note).toContain("above the app");
  });
});

describe("small helpers", () => {
  it("parsePacksText", () => {
    expect(parsePacksText("2.5")).toBe(2.5);
    expect(parsePacksText(" 1,200 ")).toBe(1200);
    expect(parsePacksText("0")).toBeNull();
    expect(parsePacksText("2,5")).toBeNull();
  });
  it("parseAmountText reads numbers, products and units, in the base unit's dimension", () => {
    expect(parseAmountText("12", "kg")).toBe(12);
    expect(parseAmountText("6 x 2", "kg")).toBe(12);
    expect(parseAmountText("6x2.5", "kg")).toBe(15);
    expect(parseAmountText("6 × 2kg", "kg")).toBe(12);
    expect(parseAmountText("500g", "kg")).toBe(0.5);
    expect(parseAmountText("12 x 250ml", "L")).toBe(3);
    expect(parseAmountText("1,200", "kg")).toBe(1200);
    expect(parseAmountText("24", "each")).toBe(24);
    for (const bad of ["", "0", "-2", "abc", "1.23456", "6 x", "12L", "6 x 2 x 3", "200000"]) expect(parseAmountText(bad, "kg"), bad).toBeNull();
    expect(parseAmountText("12kg", "L")).toBeNull();
  });
  it("splitProduct and amountWords", () => {
    expect(splitProduct("6 x 2")).toEqual(["6", "2"]);
    expect(splitProduct("12")).toBeNull();
    expect(amountWords(12, "kg")).toBe("12 kg");
    expect(amountWords(24, "each")).toBe("24 each");
  });
  it("quickFactors puts the guess first and stays short", () => {
    expect(quickFactors("CHIPS 6x2kg", 2.5)).toEqual([2.5, 6, 1, 12, 24]);
    expect(quickFactors("x", null)).toEqual([1, 6, 12, 24]);
  });
});
