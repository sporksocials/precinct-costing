import { describe, expect, it } from "vitest";
import { applyKegHint, kegNameFor, looksLikeKeg, KEG_CATEGORY, KEG_YIELD } from "@/lib/keg";

const blank = { name: "", category: "Food", pack_size: 1, pack_unit: "kg", yield_pct: 1 };

describe("keg defaults", () => {
  it("knows a keg by the word keg", () => {
    expect(looksLikeKeg("Stone & Wood Keg")).toBe(true);
    expect(looksLikeKeg("Chiobu keg")).toBe(true);
    expect(looksLikeKeg("Kegworth Pasta")).toBe(false);
    expect(looksLikeKeg("Plain Flour")).toBe(false);
  });
  it("names the keg after the beer", () => {
    expect(kegNameFor("Stone & Wood Pacific")).toBe("Stone & Wood Pacific Keg");
    expect(kegNameFor("Hahn Super Dry Keg")).toBe("Hahn Super Dry Keg");
    expect(kegNameFor("  ")).toBe("");
  });
  it("gives a blank new ingredient called a keg the keg defaults", () => {
    const out = applyKegHint({ ...blank, name: "Stone & Wood Keg" }, "1");
    expect(out.draft).toMatchObject({ category: KEG_CATEGORY, pack_size: 50, pack_unit: "L", yield_pct: KEG_YIELD });
    expect(out.sizeText).toBe("50");
  });
  it("leaves anything the person already changed, and non-kegs, alone", () => {
    const changed = { ...blank, name: "Pacific Keg", category: "Spirits" };
    expect(applyKegHint(changed, "1").draft).toBe(changed);
    const sized = { ...blank, name: "Pacific Keg" };
    expect(applyKegHint(sized, "30").draft).toBe(sized);
    const flour = { ...blank, name: "Plain Flour" };
    expect(applyKegHint(flour, "1").draft).toBe(flour);
  });
});
