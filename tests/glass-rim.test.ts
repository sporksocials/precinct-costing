import { describe, expect, it } from "vitest";
import { cleanOptionName, composeGlass, findOption, nextSort, optionsOf, parseGlass } from "@/lib/glass-rim";
import type { BarOption } from "@/lib/types";

const opt = (id: string, kind: "glass" | "rim", name: string, sort: number): BarOption => ({ id, kind, name, sort });

describe("parseGlass", () => {
  it("splits glass and rim on the last ', ' that ends in ' Rim'", () => {
    expect(parseGlass("High Ball Glass, Salt Rim")).toEqual({ glass: "High Ball Glass", rim: "Salt" });
    expect(parseGlass("Margarita Glass, Coconut Rim")).toEqual({ glass: "Margarita Glass", rim: "Coconut" });
    expect(parseGlass("Rocks Glass, Chilli Salt Rim")).toEqual({ glass: "Rocks Glass", rim: "Chilli Salt" });
  });

  it("a glass with no rim is all glass", () => {
    expect(parseGlass("Coupe Glass")).toEqual({ glass: "Coupe Glass", rim: "" });
  });

  it("empty, blank and null give nothing", () => {
    expect(parseGlass("")).toEqual({ glass: "", rim: "" });
    expect(parseGlass("   ")).toEqual({ glass: "", rim: "" });
    expect(parseGlass(null)).toEqual({ glass: "", rim: "" });
    expect(parseGlass(undefined)).toEqual({ glass: "", rim: "" });
  });

  it("only the last ', ' counts, so a comma inside the glass text stays in the glass", () => {
    expect(parseGlass("Tall, Frosted Glass, Sugar Rim")).toEqual({ glass: "Tall, Frosted Glass", rim: "Sugar" });
  });

  it("hand typed text that does not end in ' Rim' is never cut up", () => {
    expect(parseGlass("Coupe Glass, chilled")).toEqual({ glass: "Coupe Glass, chilled", rim: "" });
    expect(parseGlass("Rocks Glass with a big ice cube")).toEqual({ glass: "Rocks Glass with a big ice cube", rim: "" });
    expect(parseGlass("Salt Rim")).toEqual({ glass: "Salt Rim", rim: "" });
    expect(parseGlass(", Salt Rim")).toEqual({ glass: ", Salt Rim", rim: "" });
  });

  it("is case insensitive about the word Rim and trims", () => {
    expect(parseGlass("  Coupe Glass ,  Sugar rim ")).toEqual({ glass: "Coupe Glass", rim: "Sugar" });
  });
});

describe("composeGlass", () => {
  it("glass alone, or glass plus ', <Rim> Rim'", () => {
    expect(composeGlass("Coupe Glass", "")).toBe("Coupe Glass");
    expect(composeGlass("High Ball Glass", "Salt")).toBe("High Ball Glass, Salt Rim");
  });

  it("no glass stores nothing, even with a rim", () => {
    expect(composeGlass("", "")).toBeNull();
    expect(composeGlass("  ", "Salt")).toBeNull();
    expect(composeGlass(null, null)).toBeNull();
  });

  it("round trips every stored shape the station reads", () => {
    for (const t of ["Coupe Glass", "High Ball Glass, Salt Rim", "Margarita Glass, Coconut Rim", "Mason Jar, Cinnamon Sugar Rim", "Fishbowl"]) {
      const p = parseGlass(t);
      expect(composeGlass(p.glass, p.rim)).toBe(t);
    }
  });

  it("an off-list stored value survives a rim change untouched", () => {
    const p = parseGlass("Old Tiki Mug, Salt Rim");
    expect(composeGlass(p.glass, "Sugar")).toBe("Old Tiki Mug, Sugar Rim");
    expect(composeGlass(p.glass, "")).toBe("Old Tiki Mug");
  });
});

describe("cleanOptionName", () => {
  it("trims, collapses spaces and Title Cases", () => {
    expect(cleanOptionName("  tiki   mug ", "glass")).toBe("Tiki Mug");
    expect(cleanOptionName("HIGH BALL GLASS", "glass")).toBe("High Ball Glass");
    expect(cleanOptionName("chilli salt", "rim")).toBe("Chilli Salt");
  });

  it("keeps deliberate mixed case and apostrophes", () => {
    expect(cleanOptionName("McKenzie jug", "glass")).toBe("McKenzie Jug");
    expect(cleanOptionName("bartender's glass", "glass")).toBe("Bartender's Glass");
  });

  it("turns em and en dashes into hyphens and drops commas", () => {
    const n = cleanOptionName("Tall — frosted, glass", "glass");
    expect(n).toBe("Tall - Frosted Glass");
    expect(n).not.toMatch(/[–—,]/);
  });

  it("a rim loses a trailing Rim (the station text adds it)", () => {
    expect(cleanOptionName("tajin rim", "rim")).toBe("Tajin");
    expect(cleanOptionName("Rim", "rim")).toBe("Rim");
  });

  it("nothing usable gives an empty string and long names are capped", () => {
    expect(cleanOptionName("   ", "glass")).toBe("");
    expect(cleanOptionName(" , ", "glass")).toBe("");
    expect(cleanOptionName("x".repeat(80), "glass").length).toBeLessThanOrEqual(40);
  });
});

describe("option lists", () => {
  const all = [opt("c", "glass", "Rocks Glass", 2), opt("a", "glass", "Coupe Glass", 1), opt("r1", "rim", "Salt", 1), opt("b", "glass", "Carafe", 2), opt("r2", "rim", "Sugar", 2)];

  it("optionsOf: one kind, by sort then name then id", () => {
    expect(optionsOf(all, "glass").map((o) => o.name)).toEqual(["Coupe Glass", "Carafe", "Rocks Glass"]);
    expect(optionsOf(all, "rim").map((o) => o.name)).toEqual(["Salt", "Sugar"]);
  });

  it("optionsOf does not reorder the caller's array", () => {
    const copy = [...all];
    optionsOf(all, "glass");
    expect(all).toEqual(copy);
  });

  it("findOption is case insensitive, per kind, and ignores blanks", () => {
    expect(findOption(all, "glass", "rocks glass")?.id).toBe("c");
    expect(findOption(all, "rim", "ROCKS GLASS")).toBeUndefined();
    expect(findOption(all, "glass", "  ")).toBeUndefined();
  });

  it("nextSort goes after the last in that kind", () => {
    expect(nextSort(all, "glass")).toBe(3);
    expect(nextSort(all, "rim")).toBe(3);
    expect(nextSort([], "rim")).toBe(1);
  });
});
