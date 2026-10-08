import { describe, expect, it } from "vitest";
import { applySuggestion, buildVocab, contextWords, editDistance, foldWord, suggestSpelling, wordsOf } from "@/lib/name-vocab";

/** Real names from the app (menu, ingredients, preps, beers), enough for the cases below. */
const NAMES = [
  "Traditional Margarita",
  "Traditional Espresso Martini",
  "Espresso Martini",
  "Black Pepper Prawns",
  "Salt & Pepper Squid",
  "Heart & Soul Rose",
  "Heart & Soul Shiraz",
  "Betel Leaf",
  "Betel Leaf Wraps",
  "Tuna Tartare",
  "Chiobu Bao",
  "Chiobu Pork Belly",
  "Pork Belly Bao",
  "Thickened Cream",
  "Mascarpone",
  "Coconut Milk",
  "Passionfruit Pulp",
  "Cabernet Sauvignon",
  "Cabernet Sauvignon Merlot",
  "Stone & Wood Pacific Ale",
  "Prawn Cutlets",
  "Prawn Toast",
  "Lemon Sorbet",
  "Rosé Spritz",
  "Chocolate Brownie",
  "Chocolate Gelato Mix",
];
const vocab = buildVocab(NAMES);
const words = (name: string, opts?: { dismissed?: ReadonlySet<string> }) => suggestSpelling(name, vocab, opts).map((s) => [s.word, s.suggestion]);

describe("wordsOf / foldWord", () => {
  it("splits a name into letter runs and keeps their place", () => {
    expect(wordsOf("Heart & Soul Rose").map((w) => [w.text, w.start])).toEqual([["Heart", 0], ["Soul", 8], ["Rose", 13]]);
    expect(wordsOf("Chef's Special").map((w) => w.key)).toEqual(["chef", "special"]);
  });
  it("marks a word that touches a digit", () => {
    const w = wordsOf("150ml glass 3d");
    expect(w.map((x) => [x.text, x.touchesDigit])).toEqual([["ml", true], ["glass", false], ["d", true]]);
  });
  it("folds accents and case", () => {
    expect(foldWord("Rosé")).toBe("rose");
    expect(foldWord("O'Brien")).toBe("obrien");
  });
});

describe("buildVocab", () => {
  it("counts each word once per name it appears in", () => {
    expect(vocab.counts.get("traditional")).toBe(2);
    expect(vocab.counts.get("heart")).toBe(2);
    expect(vocab.counts.get("pork")).toBe(2);
    expect(vocab.counts.get("sauvignon")).toBe(2);
    expect(buildVocab(["Chilli Chilli Chilli"]).counts.get("chilli")).toBe(1);
  });
  it("keeps short words out (under 3 letters) and ignores empty names", () => {
    expect(vocab.counts.has("of")).toBe(false);
    expect(buildVocab(["", "Pork"]).size).toBe(1);
  });
  it("treats an accented word as the plain one", () => {
    expect(vocab.counts.get("rose")).toBe(2); // Heart & Soul Rose and Rosé Spritz
  });
});

describe("editDistance", () => {
  it("counts a swap of neighbours as one edit, a missing letter as one", () => {
    expect(editDistance("sauvingon", "sauvignon", 2)).toBe(1);
    expect(editDistance("tradional", "traditional", 2)).toBe(2); // "ti" missing: two edits, allowed for a 9 letter word
    expect(editDistance("mascapone", "mascarpone", 2)).toBe(1);
    expect(editDistance("betle", "betel", 2)).toBe(1);
  });
  it("stops early when the words are too far apart", () => {
    expect(editDistance("abc", "abcdefgh", 2)).toBe(3);
    expect(editDistance("kitten", "sitting", 1)).toBe(2);
    expect(editDistance("same", "same")).toBe(0);
  });
});

describe("suggestSpelling", () => {
  it("suggests Traditional for tradional", () => {
    expect(words("tradional espresso")).toEqual([["tradional", "traditional"]]);
    expect(words("Tradional Espresso")).toEqual([["Tradional", "Traditional"]]);
    expect(applySuggestion("Tradional Espresso", suggestSpelling("Tradional Espresso", vocab)[0])).toBe("Traditional Espresso");
  });

  it("gives the position of the word so the right one is replaced", () => {
    const [s] = suggestSpelling("Espresso Tradional Martini", vocab);
    expect(s.start).toBe(9);
    expect(applySuggestion("Espresso Tradional Martini", s)).toBe("Espresso Traditional Martini");
  });

  it("finds a word two typos away only when it has 8 letters or more", () => {
    // sauvignon (9): two typos
    expect(words("Cabernet Sauvingnon")).toEqual([["Sauvingnon", "Sauvignon"]]);
    expect(words("Cabernet Sauvinon")).toEqual([["Sauvinon", "Sauvignon"]]);
    expect(words("Cabernet Sauvinyon")).toEqual([["Sauvinyon", "Sauvignon"]]);
    // three typos is too far
    expect(words("Cabernet Sovinyon")).toEqual([]);
    // a six letter word two edits from "betel" is left alone: the smart check handles those
    expect(editDistance("beetle", "betel", 2)).toBe(2);
    expect(words("tuna beetle leaf")).toEqual([]);
    // one edit away is enough for a short word
    expect(words("Tuna Betle Leaf")).toEqual([["Betle", "Betel"]]);
    expect(words("Tuna Bettel Leaf")).toEqual([["Bettel", "Betel"]]);
  });

  it("chooses the nearest word, then the most used one", () => {
    const v = buildVocab(["Lemon Sorbet", "Lemon Tart", "Lemon Curd", "Lemons", "Lemin Pie", "Leman Pie", "Lemun Pie", "Lemun Pie"]);
    // "Lemun" is in the vocab here, so it is not questioned
    expect(suggestSpelling("Lemun", v)).toEqual([]);
    // "lemmn": one edit from lemon (3 names) and from lemin (1), lemun (2): most used wins
    expect(suggestSpelling("Lemmn Cake", v).map((s) => s.suggestion)).toEqual(["Lemon"]);
    // the nearest word wins over a more common one that is further away
    const w = buildVocab(["Prawn Cutlets", "Prawn Toast", "Prawn Cracker", "Pawns Crown"]);
    expect(suggestSpelling("Prawm", w).map((s) => s.suggestion)).toEqual(["Prawn"]);
  });

  it("is silent about new words with no near match", () => {
    expect(words("Karaage Chicken")).toEqual([]);
    expect(words("Hiramasa Kingfish")).toEqual([]);
    expect(words("Massaman Curry")).toEqual([]);
    expect(words("Gochujang Glaze")).toEqual([]);
    expect(words("Okonomiyaki")).toEqual([]);
  });

  it("is silent about words already in the vocabulary, in any case", () => {
    expect(words("black pepper prawns")).toEqual([]);
    expect(words("TRADITIONAL MARGARITA")).toEqual([]);
    expect(words("rosé spritz")).toEqual([]);
    expect(words("Rose spritz")).toEqual([]);
  });

  it("leaves brand style words alone: capitals inside, all capitals, venue names", () => {
    expect(words("ChioBu Bao")).toEqual([]);
    expect(words("ChioBu Porkbelly")).toEqual([]);
    expect(words("WMC Riesling")).toEqual([]);
    expect(words("Heart & Soul Rose")).toEqual([]);
    expect(words("Chiobu Bao")).toEqual([]);
    // "Chiobo" is a typo of a word that IS in the vocabulary (Chiobu), so it is questioned
    expect(words("Chiobo Bao")).toEqual([["Chiobo", "Chiobu"]]);
    // but a brand word with a capital inside is trusted even when it is near a known word
    expect(words("ChioBo Bao")).toEqual([]);
  });

  it("never suggests for numbers, short words or sizes", () => {
    expect(words("150ml Glass")).toEqual([]);
    expect(words("2 for 1 Cocktails")).toEqual([]);
    expect(words("Pot 285")).toEqual([]);
    expect(words("Bao x2")).toEqual([]);
    // three letters and under are not questioned
    expect(words("Poke Bao Pok")).toEqual([]);
    // a size glued to letters is a size, not a word; a separate word beside a number is still checked
    expect(words("Tradional3")).toEqual([]);
    expect(words("Tradional 3d")).toEqual([["Tradional", "Traditional"]]);
  });

  it("does not take a plural for a typo", () => {
    expect(words("Prawns Cutlet")).toEqual([]);
    expect(words("Peaches")).toEqual([]);
    expect(words("Cutlets Prawn")).toEqual([]);
  });

  it("makes a short word start the same way as its match", () => {
    const v = buildVocab(["Lemon Sorbet", "Gold Coast Ale"]);
    expect(suggestSpelling("Melon Sorbet", v)).toEqual([]);
    expect(suggestSpelling("Lemin Sorbet", v).map((s) => s.suggestion)).toEqual(["Lemon"]);
  });

  it("skips a word the person already dismissed (as typed or folded)", () => {
    expect(words("Tradional Espresso", { dismissed: new Set(["tradional"]) })).toEqual([]);
    expect(words("Tradional Espresso", { dismissed: new Set(["TRADIONAL".toLowerCase()]) })).toEqual([]);
    expect(words("tradional espresso tradional", { dismissed: new Set(["tradional"]) })).toEqual([]);
  });

  it("returns one entry per misspelt word", () => {
    expect(words("tradional margarta espresso")).toEqual([["tradional", "traditional"], ["margarta", "margarita"]]);
    expect(words("Tradional Tradional")).toEqual([["Tradional", "Traditional"]]);
  });

  it("keeps an accent on the suggestion", () => {
    expect(words("Rosee Spritz")).toEqual([["Rosee", "Rosé"]]);
  });

  it("answers an empty vocabulary and an empty name with nothing", () => {
    expect(suggestSpelling("Tradional", buildVocab([]))).toEqual([]);
    expect(suggestSpelling("", vocab)).toEqual([]);
  });

  it("is fast on a large vocabulary", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const word = () => Array.from({ length: 4 + Math.floor(rnd() * 8) }, () => String.fromCharCode(97 + Math.floor(rnd() * 26))).join("");
    const names: string[] = ["Chicken", "Mascarpone", "Passionfruit", "Traditional", "Margarita"];
    for (let i = 0; i < 4000; i++) names.push(`${word()} ${word()}`);
    const big = buildVocab(names);
    expect(big.size).toBeGreaterThan(1000);
    const t = performance.now();
    for (let i = 0; i < 50; i++) suggestSpelling("Chikcen Mascarpne Pasionfruit Tradional Margarta", big);
    expect(performance.now() - t).toBeLessThan(1500);
  });
});

describe("contextWords", () => {
  it("puts the words near an unknown typed word first, so a typo can be matched", () => {
    const ctx = contextWords("tuna beetle leaf", vocab, 10);
    expect(ctx).toContain("betel");
    expect(ctx.indexOf("betel")).toBeLessThan(5);
  });
  it("fills the rest with the most used words, never repeating, never over the limit", () => {
    const ctx = contextWords("Zzzz", vocab, 30);
    expect(ctx).toHaveLength(30);
    expect(new Set(ctx).size).toBe(30);
    expect(ctx).toContain("traditional");
    expect(contextWords("Tuna Tartare", vocab, 150).length).toBeLessThanOrEqual(150);
  });
  it("writes words the usual way and skips known words as the typed word", () => {
    const ctx = contextWords("rosee spritz", vocab, 5);
    expect(ctx[0]).toBe("rosé");
  });
});
