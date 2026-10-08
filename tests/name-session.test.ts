import { describe, expect, it } from "vitest";
import { createNameSession, pickSuggestion, planBlur, planCommit, recordKeepMine, recordUndo, settleName, textKey, type AiAnswer, type SpellAnswer } from "@/lib/name-session";

describe("planBlur (leaving a name field)", () => {
  it("tidies a name that changed since the field was entered, with a toast", () => {
    const s = createNameSession();
    expect(planBlur("black pepper prawns", "", s)).toEqual({ tidied: "Black Pepper Prawns", quiet: false });
  });
  it("fixes only spacing quietly, with no toast", () => {
    const s = createNameSession();
    expect(planBlur("  Black Pepper  Prawns ", "", s)).toEqual({ tidied: "Black Pepper Prawns", quiet: true });
  });
  it("leaves an existing name alone when nobody edited it", () => {
    const s = createNameSession();
    expect(planBlur("old name in lower case", "old name in lower case", s)).toBeNull();
  });
  it("does nothing for a blank name or one that is already tidy", () => {
    const s = createNameSession();
    expect(planBlur("   ", "", s)).toBeNull();
    expect(planBlur("", "x", s)).toBeNull();
    expect(planBlur("Black Pepper Prawns", "", s)).toBeNull();
  });
  it("never tidies a text again after the person undid it", () => {
    const s = createNameSession();
    expect(planBlur("black pepper prawns", "", s)).not.toBeNull();
    recordUndo(s, "black pepper prawns");
    expect(planBlur("black pepper prawns", "", s)).toBeNull();
    // only that exact text: another text, or the same words typed differently, is tidied as usual
    expect(planBlur("black pepper prawn", "", s)).not.toBeNull();
    expect(planBlur("black  pepper prawns", "", s)).not.toBeNull();
  });
});

describe("planCommit (a field that saves when it is left)", () => {
  it("returns the tidied name to save and says so when more than spacing changed", () => {
    const s = createNameSession();
    expect(planCommit("lamb  rump", s)).toEqual({ name: "Lamb Rump", announce: true });
    expect(planCommit("  Lamb Rump ", s)).toEqual({ name: "Lamb Rump", announce: false });
    expect(planCommit("Lamb Rump", s)).toEqual({ name: "Lamb Rump", announce: false });
  });
  it("saves blank as blank, and an undone text as typed", () => {
    const s = createNameSession();
    expect(planCommit("   ", s)).toEqual({ name: "", announce: false });
    recordUndo(s, "lamb rump");
    expect(planCommit("lamb rump", s)).toEqual({ name: "lamb rump", announce: false });
    expect(planCommit(" lamb rump", s)).toEqual({ name: "Lamb Rump", announce: true });
  });
});

describe("settleName (Enter pressed before the field was left)", () => {
  it("tidies, unless that exact text was undone", () => {
    const s = createNameSession();
    expect(settleName("  black pepper prawns ", s)).toBe("Black Pepper Prawns");
    recordUndo(s, "black pepper prawns");
    expect(settleName("black pepper prawns", s)).toBe("black pepper prawns");
  });
});

describe("pickSuggestion", () => {
  const spell: SpellAnswer = { full: "Traditional Espresso", words: ["tradional"] };
  const ai = (over: Partial<AiAnswer> = {}): AiAnswer => ({ text: "Tradional Espresso", corrected: "Traditional Espresso", reason: "Traditional was missing ti.", words: ["tradional"], ...over });
  const base = { tidied: "Tradional Espresso", touched: true, session: createNameSession(), ai: null as AiAnswer | null, spell: null as SpellAnswer | null };

  it("shows nothing for a name the person has not changed", () => {
    expect(pickSuggestion({ ...base, touched: false, spell, ai: ai() })).toBeNull();
  });
  it("shows the vocabulary suggestion when that is all there is", () => {
    expect(pickSuggestion({ ...base, spell })).toEqual({ full: "Traditional Espresso", source: "dictionary", words: ["tradional"] });
  });
  it("shows the smart suggestion instead of the vocabulary one", () => {
    const p = pickSuggestion({ ...base, spell: { full: "Tradional Espressos", words: ["x"] }, ai: ai() });
    expect(p).toMatchObject({ full: "Traditional Espresso", source: "ai", reason: "Traditional was missing ti." });
  });
  it("shows only one suggestion at a time", () => {
    expect(pickSuggestion({ ...base, spell, ai: ai() })?.source).toBe("ai");
  });
  it("ignores a smart answer for text that is no longer in the field, and one that changes nothing", () => {
    expect(pickSuggestion({ ...base, spell, ai: ai({ text: "Tradional Espress" }) })?.source).toBe("dictionary");
    expect(pickSuggestion({ ...base, ai: ai({ corrected: "Tradional Espresso" }) })).toBeNull();
    expect(pickSuggestion({ ...base, spell: { full: "Tradional Espresso", words: [] } })).toBeNull();
  });
  it("tidies the smart answer's capitals the same way as the field", () => {
    expect(pickSuggestion({ ...base, ai: ai({ corrected: "traditional espresso" }) })?.full).toBe("Traditional Espresso");
  });
  it("Keep Mine silences every suggestion for that text, and remembers the words", () => {
    const s = createNameSession();
    const sug = pickSuggestion({ ...base, session: s, spell })!;
    recordKeepMine(s, sug, "Tradional Espresso", "tradional espresso");
    expect(pickSuggestion({ ...base, session: s, spell, ai: ai() })).toBeNull();
    expect(s.words.has("tradional")).toBe(true);
    expect(s.texts.has(textKey("tradional  espresso"))).toBe(true);
    // a different text is not silenced
    expect(pickSuggestion({ ...base, session: s, tidied: "Tradional Espresso Martini", spell: { full: "Traditional Espresso Martini", words: [] } })).not.toBeNull();
  });
});
