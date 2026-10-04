import { describe, expect, it } from "vitest";
import { changedKeys, describeChanges, lineChanges, patchOf, sameValue } from "@/lib/draft-changes";
import type { RecipeLine } from "@/lib/types";

const line = (id: string, over: Partial<RecipeLine> = {}): RecipeLine => ({ id, parent_type: "item", parent_id: "i1", component_type: "ingredient", component_id: `c-${id}`, qty: 10, unit: "g", note: null, sort: 1, ...over });
const base = { id: "i1", name: "Margarita", sell_price_inc: 18, notes: null as string | null, method: ["Shake"] as string[], section: null as string | null };

describe("sameValue", () => {
  it("treats null and undefined as equal, and numeric strings as their number", () => {
    expect(sameValue(null, undefined)).toBe(true);
    expect(sameValue("2", 2)).toBe(true);
    expect(sameValue("", 0)).toBe(false);
    expect(sameValue(null, "")).toBe(false);
  });
  it("compares arrays and objects by content", () => {
    expect(sameValue(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameValue(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameValue({ gfo: { note: "x" } }, { gfo: { note: "x" } })).toBe(true);
    expect(sameValue({ gfo: { note: "x" } }, { gfo: { note: "y" } })).toBe(false);
  });
});

describe("dirty detection", () => {
  it("an untouched draft is clean", () => {
    const c = describeChanges(base, { ...base }, [line("a")], [line("a")]);
    expect(c.dirty).toBe(false);
    expect(c.count).toBe(0);
  });
  it("an equal copy (new array, same words) is not a change", () => {
    expect(describeChanges(base, { ...base, method: ["Shake"] }, [], []).dirty).toBe(false);
  });
  it("typing a value and putting it back is clean again", () => {
    expect(describeChanges(base, { ...base, name: "Margarita X" }, [], []).dirty).toBe(true);
    expect(describeChanges(base, { ...base, name: "Margarita" }, [], []).dirty).toBe(false);
  });
  it("counts changed fields and names them", () => {
    const c = describeChanges(base, { ...base, name: "Marg", sell_price_inc: 19, method: ["Shake", "Strain"] }, [], []);
    expect(c.count).toBe(3);
    expect(c.labels).toEqual(["Name", "Price", "Method"]);
    expect(changedKeys(base, { ...base, name: "Marg" })).toEqual(["name"]);
  });
  it("counts ingredient lines added, removed, edited and reordered", () => {
    const a = [line("a"), line("b"), line("c")];
    expect(lineChanges(a, [...a, line("d")]).added).toBe(1);
    expect(lineChanges(a, a.slice(0, 2)).removed).toBe(1);
    expect(lineChanges(a, [line("a", { qty: 12 }), line("b"), line("c")]).edited).toBe(1);
    expect(lineChanges(a, [a[1], a[0], a[2]]).reordered).toBe(true);
    const c = describeChanges(base, base, a, [line("a", { qty: 12 }), line("b"), line("d")]);
    expect(c.count).toBe(3); // one edited, one removed, one added
    expect(c.labels).toEqual(["1 Ingredient Added", "1 Ingredient Removed", "1 Ingredient Changed"]);
  });
  it("lines without a component are not saved, so they are not changes", () => {
    expect(describeChanges(base, base, [line("a")], [line("a"), line("x", { component_id: "" })]).dirty).toBe(false);
  });
  it("patchOf sends only what changed", () => {
    expect(patchOf(base, { ...base, sell_price_inc: 20, notes: "hi" })).toEqual({ sell_price_inc: 20, notes: "hi" });
  });
});

describe("discard restores the saved version", () => {
  it("the base is untouched by edits, so putting it back is exactly the saved record", () => {
    const savedLines = [line("a"), line("b")];
    const edited = { ...base, name: "Changed", method: [] as string[] };
    const editedLines = [line("a", { qty: 99 })];
    expect(describeChanges(base, edited, savedLines, editedLines).dirty).toBe(true);
    // Discard = draft := base, lines := savedLines
    const c = describeChanges(base, base, savedLines, savedLines);
    expect(c.dirty).toBe(false);
    expect(c.count).toBe(0);
  });
});
