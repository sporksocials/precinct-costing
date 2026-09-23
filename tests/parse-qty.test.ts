import { describe, expect, it } from "vitest";
import { defaultLineUnit, parseLineInput, parseNumberToken, resolveLineUnit, titleCase } from "@/lib/parse-qty";

describe("parseLineInput", () => {
  const cases: [string, number | null, string | null, string][] = [
    ["180g chicken thigh", 180, "g", "chicken thigh"],
    ["180 g chicken", 180, "g", "chicken"],
    ["chicken 180 g", 180, "g", "chicken"],
    ["chicken thigh 180g", 180, "g", "chicken thigh"],
    ["0.2 kg", 0.2, "kg", ""],
    ["0,2kg flour", 0.2, "kg", "flour"],
    ["2 eggs", 2, null, "eggs"],
    ["2 x egg", 2, "each", "egg"],
    ["2x egg", 2, "each", "egg"],
    ["3 ea lime", 3, "each", "lime"],
    ["30ml gin", 30, "ml", "gin"],
    ["1.5L milk", 1.5, "L", "milk"],
    ["1.5 l milk", 1.5, "L", "milk"],
    ["1/2 lime", 0.5, null, "lime"],
    ["½ lime", 0.5, null, "lime"],
    ["1 1/2 lemons", 1.5, null, "lemons"],
    ["1½ lemons", 1.5, null, "lemons"],
    ["2 pcs bao bun", 2, "each", "bao bun"],
    ["bacon", null, null, "bacon"],
    ["7up", null, null, "7up"],
    ["100s and 1000s", null, null, "100s and 1000s"],
    ["lime x2", 2, null, "lime"],
    ["  ", null, null, ""],
  ];
  it.each(cases)("%s", (input, qty, unit, query) => {
    const r = parseLineInput(input);
    if (qty == null) expect(r.qty).toBeNull();
    else expect(r.qty).toBeCloseTo(qty);
    expect(r.unit).toBe(unit);
    expect(r.query).toBe(query);
  });

  it("does not treat a word starting with a unit letter as a unit", () => {
    expect(parseLineInput("2 lemons")).toEqual({ qty: 2, unit: null, query: "lemons" });
    expect(parseLineInput("250 gnocchi")).toEqual({ qty: 250, unit: null, query: "gnocchi" });
  });
});

describe("parseNumberToken", () => {
  it("parses fractions and decimals", () => {
    expect(parseNumberToken("3/4")).toBeCloseTo(0.75);
    expect(parseNumberToken("¼")).toBeCloseTo(0.25);
    expect(parseNumberToken("2,5")).toBeCloseTo(2.5);
    expect(parseNumberToken("1/0")).toBeNull();
  });
});

describe("resolveLineUnit", () => {
  it("defaults by pack unit when none typed", () => {
    expect(resolveLineUnit(null, "kg")).toEqual({ unit: "g", adjusted: false });
    expect(resolveLineUnit(null, "L")).toEqual({ unit: "ml", adjusted: false });
    expect(resolveLineUnit(null, "each")).toEqual({ unit: "each", adjusted: false });
  });
  it("keeps a unit in the same family", () => {
    expect(resolveLineUnit("kg", "kg")).toEqual({ unit: "kg", adjusted: false });
    expect(resolveLineUnit("ml", "L")).toEqual({ unit: "ml", adjusted: false });
  });
  it("substitutes a sensible default on a family mismatch", () => {
    expect(resolveLineUnit("g", "each")).toEqual({ unit: "each", adjusted: true });
    expect(resolveLineUnit("ml", "kg")).toEqual({ unit: "g", adjusted: true });
  });
  it("maps pack units to line units", () => {
    expect(defaultLineUnit("kg")).toBe("g");
    expect(defaultLineUnit("L")).toBe("ml");
    expect(defaultLineUnit("each")).toBe("each");
  });
});

describe("titleCase", () => {
  it("tidies supplier descriptions", () => {
    expect(titleCase("CHICKEN THIGH FILLET S/L")).toBe("Chicken Thigh Fillet S/L");
    expect(titleCase("SPINACH BABY 1.5KG")).toBe("Spinach Baby 1.5kg");
    expect(titleCase("OIL  CANOLA 20L")).toBe("Oil Canola 20L");
  });
});
