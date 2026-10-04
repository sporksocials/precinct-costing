import { describe, expect, it } from "vitest";
import { chooseIndex, editDistance, findStepIndex, normaliseAmounts, spellFix, buildVocab, stageOf, stripDashes, tidyBuiltin, tidyStepText, TidyError, type TidyInput } from "@/lib/method-style";

const METHOD = ["Wet and rim the glass with salt", "Add 90 ml tomato juice to the glass", "Shake hard for 12 seconds", "Double strain into the glass", "Top with soda, poured in gently", "Garnish with a lime wedge"];
const ctx = { itemName: "Margarita", glass: "Coupe Glass, Salt Rim", lines: [{ name: "Tequila Blanco" }, { name: "Lime Juice (L)" }, { name: "Aperol" }, { name: "Bulcock Banger Pre-Mix" }], method: METHOD };
const input = (text: string, over: Partial<TidyInput> = {}): TidyInput => ({ ...ctx, category: "Cocktail", mode: "answer", text, ...over });
const tidy = (text: string) => tidyStepText(text, ctx);

describe("editDistance", () => {
  it("counts insertions, substitutions and swaps as one", () => {
    expect(editDistance("glas", "glass")).toBe(1);
    expect(editDistance("strian", "strain")).toBe(1);
    expect(editDistance("ise", "ice")).toBe(1);
    expect(editDistance("abc", "abc")).toBe(0);
    expect(editDistance("kitten", "sitting", 5)).toBe(3);
  });
  it("stops early above the limit", () => {
    expect(editDistance("shaker", "strawberry", 2)).toBeGreaterThan(2);
  });
});

describe("amounts and dashes", () => {
  it("puts a space before units and spells out seconds", () => {
    expect(normaliseAmounts("30ml lime, shake 12secs")).toBe("30 ml lime, shake 12 seconds");
    expect(normaliseAmounts("add 15 mls")).toBe("add 15 ml");
    expect(normaliseAmounts("stir 1 sec")).toBe("stir 1 second");
    expect(normaliseAmounts("shake for twelve seconds")).toBe("shake for 12 seconds");
    expect(normaliseAmounts("add two shots")).toBe("add 2 shots");
    expect(normaliseAmounts("stir 20-30secs")).toBe("stir 20 to 30 seconds");
    expect(normaliseAmounts("a 2.5 shots pour")).toBe("a 2.5 shots pour");
  });
  it("leaves words that only contain unit letters alone", () => {
    expect(normaliseAmounts("3 glasses and 2 shots")).toBe("3 glasses and 2 shots");
  });
  it("strips em, en and spaced dashes", () => {
    expect(stripDashes("Shake hard — then dump")).toBe("Shake hard, then dump");
    expect(stripDashes("Shake hard – then dump")).toBe("Shake hard, then dump");
    expect(stripDashes("Shake hard - then dump")).toBe("Shake hard, then dump");
    expect(stripDashes("Pre-mix")).toBe("Pre-mix");
    expect(stripDashes("- dump it")).toBe("dump it");
  });
});

describe("spellFix", () => {
  const vocab = buildVocab(ctx);
  it("fixes close misspellings from the menu's own words", () => {
    expect(spellFix("strian", vocab)).toBe("strain");
    expect(spellFix("glas", vocab)).toBe("glass");
    expect(spellFix("ise", vocab)).toBe("ice");
    expect(spellFix("sode", vocab)).toBe("soda");
    expect(spellFix("tequilla", vocab)).toBe("tequila");
    expect(spellFix("garnsh", vocab)).toBe("garnish");
  });
  it("leaves known words, short words and far-off words alone", () => {
    expect(spellFix("strain", vocab)).toBeNull();
    expect(spellFix("ml", vocab)).toBeNull();
    expect(spellFix("xylophone", vocab)).toBeNull();
    expect(spellFix("zq", vocab)).toBeNull();
  });
});

describe("tidyStepText (house style)", () => {
  it("fixes a misspelt answer into one clean step", () => {
    expect(tidy("strian over ise in the glas")).toBe("Strain over ice in the glass");
  });
  it("capitalises, drops the full stop and normalises amounts", () => {
    expect(tidy("  shake   hard for 12secs.  ")).toBe("Shake hard for 12 seconds");
    expect(tidy("add 30ml of lime juice")).toBe("Add 30 ml of lime juice");
    expect(tidy("STIR 20-30 SECS")).toBe("Stir 20 to 30 seconds");
  });
  it("rewrites should-be phrasing as an instruction", () => {
    expect(tidy("The drink should be strained over ice in the glass.")).toBe("Strain over ice in the glass");
    expect(tidy("it needs to be double strained")).toBe("Double strain");
    expect(tidy("the glass should be chilled first")).toBe("Chill the glass first");
    expect(tidy("you need to top with soda")).toBe("Top with soda");
    expect(tidy("make sure to fill with ice")).toBe("Fill with ice");
    expect(tidy("please straining into the glass")).toBe("Strain into the glass");
    expect(tidy("Double Strained Into The Glass")).toBe("Double strain into the glass");
  });
  it("removes dashes and bullets", () => {
    expect(tidy("- shake hard — 12 seconds")).toBe("Shake hard, 12 seconds");
    expect(tidy("2) dump into the glass")).toBe("Dump into the glass");
  });
  it("keeps names capitalised and everything else sentence case", () => {
    expect(tidy("Pour in the APEROL then top with SODA")).toBe("Pour in the Aperol then top with soda");
    expect(tidy("add 60 ml bulcock banger pre-mix")).toBe("Add 60 ml Bulcock Banger Pre-Mix");
    expect(tidy("Add a splash of Pete's prosecco")).toBe("Add a splash of Pete's prosecco");
  });
  it("restores apostrophes in common contractions", () => {
    expect(tidy("strain over ice, dont dump it")).toBe("Strain over ice, don't dump it");
  });
  it("keeps a full stop between two sentences", () => {
    expect(tidy("dump into the glass. never shake the tomato juice")).toBe("Dump into the glass. Never shake the tomato juice.");
  });
  it("never invents words it does not know", () => {
    expect(tidy("add a pinch of za'atar")).toBe("Add a pinch of za'atar");
  });
  it("refuses empty text, links and unusable text", () => {
    expect(() => tidy("   ")).toThrow(TidyError);
    expect(() => tidy("see https://example.com/steps")).toThrow(TidyError);
    expect(() => tidy("12 - 30")).toThrow(TidyError);
    expect(() => tidy("ok")).toThrow(TidyError);
  });
  it("keeps long text to one short step", () => {
    const out = tidy("shake ".repeat(60));
    expect(out.length).toBeLessThanOrEqual(140);
    expect(out).not.toMatch(/\s$/);
  });
  it("never leaves a dash in the output", () => {
    for (const t of ["a – b step here", "shake — hard", "shake - hard", "double-strain it"]) expect(tidy(t)).not.toMatch(/[–—]|\s-\s/);
  });
});

describe("placement", () => {
  it("classifies steps by stage", () => {
    expect(stageOf("Chill the glass")).toBe(0);
    expect(stageOf("Wet and rim the glass with salt")).toBe(0);
    expect(stageOf("Add the lime juice")).toBe(1);
    expect(stageOf("Clap the mint into the jar")).toBe(1);
    expect(stageOf("Shake hard for 12 seconds")).toBe(2);
    expect(stageOf("Strain over ice in the glass")).toBe(3);
    expect(stageOf("Dump into the glass")).toBe(3);
    expect(stageOf("Top with soda, poured in gently")).toBe(4);
    expect(stageOf("Add a splash of soda, poured in slowly down the side")).toBe(4);
    expect(stageOf("Garnish with a lime wedge")).toBe(5);
    expect(stageOf("Press the mint gently in the jar")).toBe(1);
    expect(stageOf("Wiggle it about")).toBeNull();
  });
  it("puts a strain step after the shake and before the topper", () => {
    expect(chooseIndex(METHOD, "Strain over ice in the glass")).toBe(4); // after "Double strain", before "Top with soda"
    expect(chooseIndex(["Chill the glass", "Shake hard", "Garnish with mint"], "Strain over ice in the glass")).toBe(2);
  });
  it("glass prep goes first, garnish last, unknown goes to the end", () => {
    expect(chooseIndex(["Add the lime juice", "Shake hard"], "Chill the glass")).toBe(0);
    expect(chooseIndex(METHOD, "Garnish with a mint sprig")).toBe(6);
    expect(chooseIndex(METHOD, "Wiggle it about")).toBe(6);
    expect(chooseIndex([], "Shake hard")).toBe(0);
  });
  it("an add step goes after the other ingredient steps", () => {
    expect(chooseIndex(METHOD, "Add the agave")).toBe(2);
  });
  it("copes with a method that is out of order", () => {
    expect(chooseIndex(["Add syrup", "Garnish with mint", "Shake hard"], "Strain over ice")).toBe(3);
  });
});

describe("findStepIndex", () => {
  it("finds a step by a piece of its text, ignoring case and punctuation", () => {
    expect(findStepIndex(METHOD, "shake hard")).toBe(2);
    expect(findStepIndex(METHOD, "Top with SODA, poured in")).toBe(4);
    expect(findStepIndex(METHOD, "stir")).toBe(-1);
    expect(findStepIndex(METHOD, "")).toBe(-1);
    expect(findStepIndex(METHOD, undefined)).toBe(-1);
  });
});

describe("tidyBuiltin", () => {
  it("returns one insert op with the step and its position", () => {
    expect(tidyBuiltin(input("strian over ise in the glas"))).toEqual({ ops: [{ op: "insert", index: 4, text: "Strain over ice in the glass" }], source: "builtin" });
  });
  it("replaces the named step when the note says which", () => {
    const r = tidyBuiltin(input("shake HARD for 15 secs", { mode: "step", replaces: "shake hard for 12" }));
    expect(r.ops).toEqual([{ op: "replace", index: 2, text: "Shake HARD for 15 seconds".replace("HARD", "hard") }]);
  });
  it("falls back to an insert when the named step is not there", () => {
    const r = tidyBuiltin(input("fine strain into the glass", { mode: "step", replaces: "stir gently" }));
    expect(r.ops[0].op).toBe("insert");
  });
  it("throws for text that cannot be a step", () => {
    expect(() => tidyBuiltin(input("   "))).toThrow(TidyError);
  });
  it("works on an empty method", () => {
    expect(tidyBuiltin(input("shake hard", { method: [] })).ops).toEqual([{ op: "insert", index: 0, text: "Shake hard" }]);
  });
});
