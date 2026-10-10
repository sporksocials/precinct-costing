import { describe, expect, it } from "vitest";
import {
  advance,
  confirmPayload,
  currentId,
  ingredientsToReview,
  isFinished,
  leftOver,
  mainOnly,
  needsCheckText,
  proposalOnly,
  progressText,
  skip,
  startWalk,
  startingTicks,
  stepBack,
  toggleTick,
  usedInText,
} from "@/lib/ingredient-review";
import { CONTAINS_IDS } from "@/lib/allergens";
import type { RecipeLine } from "@/lib/types";

let n = 0;
const line = (parent: string, type: "item" | "prep", comp: string, ctype: "ingredient" | "prep" = "ingredient"): RecipeLine => {
  n += 1;
  return { id: `l${n}`, parent_type: type, parent_id: parent, component_type: ctype, component_id: comp, qty: 10, unit: "g", note: null, sort: n };
};
const dish = (id: string, over: Partial<{ name: string; venue_id: number; active: boolean; category: string }> = {}) => ({ id, name: over.name ?? id, venue_id: over.venue_id ?? 1, active: over.active ?? true, category: over.category ?? "Food" });
const ing = (id: string, reviewed: boolean | null | undefined = false, name = id) => ({ id, name, category: "Food", allergens_reviewed: reviewed });
const prep = (id: string) => ({ id });

describe("ingredientsToReview", () => {
  it("lists unreviewed ingredients of active Food dishes, most dishes first then A to Z", () => {
    const items = [dish("d1"), dish("d2"), dish("d3")];
    const lines = [line("d1", "item", "flour"), line("d2", "item", "flour"), line("d3", "item", "flour"), line("d1", "item", "basil"), line("d2", "item", "apple"), line("d3", "item", "cumin")];
    const out = ingredientsToReview(items, lines, [ing("flour"), ing("basil"), ing("apple"), ing("cumin")], []);
    expect(out.map((o) => o.ingredientId)).toEqual(["flour", "apple", "basil", "cumin"]);
    expect(out[0].dishes.map((d) => d.id)).toEqual(["d1", "d2", "d3"]);
  });

  it("leaves out reviewed ingredients, but a null or missing flag counts as not reviewed", () => {
    const items = [dish("d1")];
    const lines = [line("d1", "item", "a"), line("d1", "item", "b"), line("d1", "item", "c"), line("d1", "item", "d")];
    const out = ingredientsToReview(items, lines, [ing("a", true), ing("b", false), ing("c", null), ing("d", undefined)], []);
    expect(out.map((o) => o.ingredientId)).toEqual(["b", "c", "d"]);
  });

  it("walks through nested preps and counts the dish for an ingredient only once", () => {
    const items = [dish("d1")];
    const lines = [line("d1", "item", "p1", "prep"), line("p1", "prep", "p2", "prep"), line("p2", "prep", "deep"), line("p1", "prep", "deep"), line("d1", "item", "deep")];
    const out = ingredientsToReview(items, lines, [ing("deep")], [prep("p1"), prep("p2")]);
    expect(out).toHaveLength(1);
    expect(out[0].dishes.map((d) => d.id)).toEqual(["d1"]);
  });

  it("is cycle safe", () => {
    const items = [dish("d1")];
    const lines = [line("d1", "item", "p1", "prep"), line("p1", "prep", "p2", "prep"), line("p2", "prep", "p1", "prep"), line("p2", "prep", "i1"), line("p1", "prep", "p1", "prep")];
    const out = ingredientsToReview(items, lines, [ing("i1")], [prep("p1"), prep("p2")]);
    expect(out.map((o) => o.ingredientId)).toEqual(["i1"]);
  });

  it("ignores inactive dishes and anything that is not Food", () => {
    const items = [dish("off", { active: false }), dish("drink", { category: "Cocktail" }), dish("gel", { category: "Gelato" }), dish("ok")];
    const lines = [line("off", "item", "a"), line("drink", "item", "b"), line("gel", "item", "c"), line("ok", "item", "d")];
    const out = ingredientsToReview(items, lines, [ing("a"), ing("b"), ing("c"), ing("d")], []);
    expect(out.map((o) => o.ingredientId)).toEqual(["d"]);
  });

  it("keeps an ingredient used by one active and one inactive dish, naming only the active dish", () => {
    const items = [dish("on"), dish("off", { active: false })];
    const lines = [line("on", "item", "x"), line("off", "item", "x")];
    const out = ingredientsToReview(items, lines, [ing("x")], []);
    expect(out[0].dishes.map((d) => d.id)).toEqual(["on"]);
  });

  it("skips ingredients that no longer exist, blank lines, and the lines of a deleted prep", () => {
    const items = [dish("d1")];
    const blank = { ...line("d1", "item", "x"), component_id: "" };
    const lines = [line("d1", "item", "gone"), blank, line("d1", "item", "ghost", "prep"), line("ghost", "prep", "hidden")];
    const out = ingredientsToReview(items, lines, [ing("hidden")], []);
    expect(out).toEqual([]);
  });

  it("filters to one dish's ingredients but still names every dish they appear in", () => {
    const items = [dish("d1"), dish("d2")];
    const lines = [line("d1", "item", "a"), line("d2", "item", "a"), line("d2", "item", "b")];
    const out = ingredientsToReview(items, lines, [ing("a"), ing("b")], [], { dishId: "d1" });
    expect(out.map((o) => o.ingredientId)).toEqual(["a"]);
    expect(out[0].dishes.map((d) => d.id)).toEqual(["d1", "d2"]);
  });

  it("filters to one venue's dishes and lists only that venue's dishes", () => {
    const items = [dish("d1", { venue_id: 1 }), dish("d2", { venue_id: 2 }), dish("d3", { venue_id: 2 })];
    const lines = [line("d1", "item", "a"), line("d2", "item", "a"), line("d3", "item", "b")];
    const out = ingredientsToReview(items, lines, [ing("a"), ing("b")], [], { venueId: 2 });
    expect(out.map((o) => [o.ingredientId, o.dishes.map((d) => d.id)])).toEqual([
      ["a", ["d2"]],
      ["b", ["d3"]],
    ]);
  });

  it("breaks ties by name regardless of case", () => {
    const items = [dish("d1")];
    const lines = [line("d1", "item", "z"), line("d1", "item", "y")];
    const out = ingredientsToReview(items, lines, [ing("z", false, "apple"), ing("y", false, "Banana")], []);
    expect(out.map((o) => o.name)).toEqual(["apple", "Banana"]);
  });

  it("does not mix up a prep id and an ingredient id that look the same", () => {
    const items = [dish("d1")];
    const lines = [line("d1", "item", "same", "prep"), line("same", "prep", "real")];
    const out = ingredientsToReview(items, lines, [ing("same"), ing("real")], [prep("same")]);
    expect(out.map((o) => o.ingredientId)).toEqual(["real"]);
  });
});

describe("text helpers", () => {
  const d = (...names: string[]) => names.map((name) => ({ name }));
  it("names up to three dishes, then how many more", () => {
    expect(usedInText(d("A"))).toBe("Used in 1 dish: A.");
    expect(usedInText(d("A", "B"))).toBe("Used in 2 dishes: A and B.");
    expect(usedInText(d("A", "B", "C"))).toBe("Used in 3 dishes: A, B and C.");
    expect(usedInText(d("A", "B", "C", "D", "E"))).toBe("Used in 5 dishes: A, B, C and 2 more.");
    expect(usedInText([])).toBe("Not used in any active dish.");
  });
  it("progress and the Ingredients list line", () => {
    expect(progressText(11, 158)).toBe("12 of 158");
    expect(progressText(200, 158)).toBe("158 of 158");
    expect(needsCheckText(0)).toBeNull();
    expect(needsCheckText(1)).toBe("1 ingredient needs their allergens checked");
    expect(needsCheckText(158)).toBe("158 ingredients need their allergens checked");
  });
});

describe("ticks and the Confirm payload", () => {
  it("keeps only the 15 main allergens, once, in the fixed order", () => {
    expect(mainOnly(["soy", "alcohol", "gluten", "soy", "nonsense", "sesame"])).toEqual(["gluten", "sesame", "soy"]);
    expect(CONTAINS_IDS).toContain("sesame");
  });
  it("starts from what a person ticked plus proposals, and knows which are only proposals", () => {
    expect(startingTicks(["milk"], ["gluten", "milk", "alcohol"])).toEqual(["gluten", "milk"]);
    expect(proposalOnly(["milk"], ["gluten", "milk", "alcohol"])).toEqual(["gluten"]);
  });
  it("toggles a chip on and off and stays in order", () => {
    expect(toggleTick(["gluten"], "egg")).toEqual(["gluten", "egg"]);
    expect(toggleTick(["gluten", "egg"], "gluten")).toEqual(["egg"]);
    expect(toggleTick(["soy"], "gluten")).toEqual(["gluten", "soy"]);
  });
  it("writes the ticks and the reviewed flag", () => {
    expect(confirmPayload(["milk"], ["soy", "gluten"])).toEqual({ allergens: ["gluten", "soy"], allergens_reviewed: true });
  });
  it("accepts nothing ticked: it means the ingredient contains none of them", () => {
    expect(confirmPayload([], [])).toEqual({ allergens: [], allergens_reviewed: true });
    expect(confirmPayload(null, [])).toEqual({ allergens: [], allergens_reviewed: true });
  });
  it("keeps the alcohol attribute and drops an old tick that was unticked", () => {
    expect(confirmPayload(["alcohol", "milk"], ["egg"])).toEqual({ allergens: ["egg", "alcohol"], allergens_reviewed: true });
  });
  it("never writes an id outside the allergen list", () => {
    expect(confirmPayload([], ["milk", "made_up"]).allergens).toEqual(["milk"]);
  });
});

describe("walking the queue", () => {
  it("moves forward on confirm, back on Back, and is finished past the end", () => {
    let w = startWalk(["a", "b"]);
    expect(currentId(w)).toBe("a");
    w = advance(w);
    expect(currentId(w)).toBe("b");
    w = stepBack(w);
    expect(currentId(w)).toBe("a");
    expect(stepBack(w).i).toBe(0);
    w = advance(advance(w));
    expect(isFinished(w)).toBe(true);
    expect(currentId(w)).toBeNull();
  });
  it("Skip sends an ingredient to the end once and the next one takes its place", () => {
    let w = startWalk(["a", "b", "c"]);
    w = skip(w);
    expect(w.order).toEqual(["b", "c", "a"]);
    expect(currentId(w)).toBe("b");
    expect(w.order).toHaveLength(3);
  });
  it("skipping can never loop forever", () => {
    let w = startWalk(["a", "b"]);
    let steps = 0;
    while (!isFinished(w) && steps < 20) {
      w = skip(w);
      steps += 1;
    }
    expect(isFinished(w)).toBe(true);
    expect(steps).toBeLessThan(10);
    expect(leftOver(w, new Set()).sort()).toEqual(["a", "b"]);
  });
  it("lists what was left over", () => {
    let w = startWalk(["a", "b", "c"]);
    const done = new Set<string>();
    done.add("a");
    w = advance(w);
    w = skip(w);
    w = advance(w);
    expect(leftOver(w, done).sort()).toEqual(["b", "c"]);
  });
  it("skipping the last one finishes the walk and leaves it over", () => {
    let w = startWalk(["a"]);
    w = skip(w);
    expect(isFinished(w)).toBe(true);
    expect(leftOver(w, new Set())).toEqual(["a"]);
  });
});
