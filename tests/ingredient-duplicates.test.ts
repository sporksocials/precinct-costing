import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { alreadyExistsText, duplicateKey, findSimilarIngredients } from "@/lib/ingredient-duplicates";

/** Duplicate guard on New Ingredient (Troy, 23 Nov 2026): the same product must not be entered twice under another size or spelling. */
const ing = (id: string, name: string, active = true) => ({ id, name, active });

describe("duplicateKey", () => {
  it("drops a size in brackets, at the end or in the middle", () => {
    for (const n of ["Lime Juice (2L)", "Lime Juice (L)", "Lime Juice (700ml)", "Lime Juice (Each)", "Lime Juice (kg)", "Lime Juice (3kg)", "Lime Juice (6 x 2kg)", "Lime (2 L) Juice", "lime  juice", "LIME-JUICE"]) {
      expect(duplicateKey(n), n).toBe("limejuice");
    }
  });
  it("keeps brackets that name a different product", () => {
    expect(duplicateKey("Chicken (Thigh)")).toBe("chickenthigh");
    expect(duplicateKey("Chicken (Breast)")).toBe("chickenbreast");
    expect(duplicateKey("Great Northern (Keg)")).toBe("greatnorthernkeg");
    expect(duplicateKey("Coke (Can)")).toBe("cokecan");
  });
  it("reads & as and, drops accents and everything that is not a letter or digit", () => {
    expect(duplicateKey("Salt & Pepper")).toBe(duplicateKey("Salt and Pepper"));
    expect(duplicateKey("Jalapeño")).toBe("jalapeno");
    expect(duplicateKey("7-Up 1.25L")).toBe("7up125l");
    expect(duplicateKey("  ")).toBe("");
  });
});

describe("findSimilarIngredients", () => {
  const list = [
    ing("a", "Lime Juice (L)"),
    ing("b", "Lime Juice (2L)"),
    ing("c", "Lime Juice Cordial"),
    ing("d", "Lime"),
    ing("e", "Lemon (L)"),
    ing("f", "Lemon Juice"),
    ing("g", "Old Lime Juice", false),
    ing("h", "Lime Juice (5L)", false),
    ing("i", "Salt"),
    ing("j", "Chicken Thigh"),
  ];
  it("finds the same product under another size, exact keys before longer names", () => {
    expect(findSimilarIngredients("Lime Juice", list).map((i) => i.name)).toEqual(["Lime Juice (2L)", "Lime Juice (L)", "Lime Juice Cordial"]);
    expect(findSimilarIngredients("lime juice (700ml)", list, { limit: 2 }).map((i) => i.name)).toEqual(["Lime Juice (2L)", "Lime Juice (L)"]);
  });
  it("lists the most used first when usage is to hand", () => {
    const usage = (id: string) => ({ a: 12, b: 3 })[id] ?? 0;
    expect(findSimilarIngredients("Lime Juice", list, { usage }).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
  it("never suggests an inactive ingredient, and never an ingredient against itself", () => {
    expect(findSimilarIngredients("Lime Juice (5L)", list).some((i) => i.id === "h" || i.id === "g")).toBe(false);
    expect(findSimilarIngredients("Lime Juice (L)", list, { selfId: "a" }).map((i) => i.id)).toEqual(["b", "c"]);
  });
  it("a short key is never matched as the start of a longer one", () => {
    // "lime" (4) is the start of "limejuice", and "salt" of "saltedbutter": too short to mean the same product
    expect(findSimilarIngredients("Lime", list).map((i) => i.id)).toEqual(["d"]);
    expect(findSimilarIngredients("Salted Butter", list)).toEqual([]);
    // "lemon" (5) and "lemonjuice" are not flagged against each other either: only an exact key is
    expect(findSimilarIngredients("Lemon", list).map((i) => i.id)).toEqual(["e"]);
    expect(findSimilarIngredients("Lemon Juice (2L)", list).map((i) => i.id)).toEqual(["f"]);
  });
  it("a longer name that starts the same way is flagged from six characters", () => {
    expect(findSimilarIngredients("Chicken", list).map((i) => i.id)).toEqual(["j"]);
    expect(findSimilarIngredients("Chicken Thigh Fillet", list).map((i) => i.id)).toEqual(["j"]);
  });
  it("nothing for an empty name or under three letters", () => {
    expect(findSimilarIngredients("", list)).toEqual([]);
    expect(findSimilarIngredients("Li", list)).toEqual([]);
    expect(findSimilarIngredients("12 (L)", list)).toEqual([]);
    expect(findSimilarIngredients("A new thing nobody has", list)).toEqual([]);
  });
  it("returns three at most by default", () => {
    const many = Array.from({ length: 6 }, (_, k) => ing(`x${k}`, `Tomato Sauce (${k + 1}L)`));
    expect(findSimilarIngredients("Tomato Sauce", many)).toHaveLength(3);
  });
  it("words the row plainly", () => {
    expect(alreadyExistsText("Lime Juice (2L)")).toBe("Lime Juice (2L) already exists.");
  });
});

describe("the New Ingredient sheet uses the guard without blocking the form", () => {
  const src = readFileSync(path.resolve(__dirname, "../components/ingredient-sheet.tsx"), "utf8");
  it("shows the look-alikes with Use It and one Add Anyway, and hands an existing ingredient back through onSaved", () => {
    expect(src).toContain("findSimilarIngredients");
    expect(src).toContain("Use It");
    expect(src).toContain("Add Anyway");
    expect(src).toMatch(/onSaved\(\{ id: s\.id, pack_unit: s\.pack_unit, name: s\.name, existing: true \}\)/);
  });
  it("one block at a time: the duplicate block wins over the Did You Mean row", () => {
    expect(src).toMatch(/similar\.length \? \([\s\S]*?\) : \(\s*<NameSuggestRow/);
  });
  it("still refuses an identical name in plain words before saving", () => {
    expect(src).toContain("findClash");
    expect(src).toContain("clashMessage");
  });
  it("the two controls are 44px at every width and the text has no dashes", () => {
    expect(src).toMatch(/min-h-\[44px\]/);
    const block = src.slice(src.indexOf("data-duplicate-guard"), src.indexOf("<NameSuggestRow"));
    expect(block).not.toMatch(/[—–]/);
  });
});
