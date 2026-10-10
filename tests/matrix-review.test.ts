import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildRows, type MatrixDish } from "@/lib/allergy-matrix";
import { readDishAllergens, signOffState } from "@/lib/dish-allergens";
import { readMarks } from "@/lib/diet-options";
import {
  REVIEW_CHANGED_TEXT,
  confirmPatch,
  freshVerdict,
  initialReviewDraft,
  progressText,
  reviewQueue,
  setReviewNote,
  stillSuggested,
  toggleReviewAllergen,
  toggleReviewMark,
  venueBreak,
} from "@/lib/matrix-review";
import { reviewHref, venueTodo } from "@/lib/matrix-todo";
import { prepSaveImpact, confirmedDishesUsing, impactHeadline, impactNames, lostSignOff, prepComponentsChanged, groupLines } from "@/lib/allergy-recheck";
import { setupModel, marksAndOptionsSummary, SETUP_ANCHORS } from "@/lib/finish-setup";
import type { MenuItem, RecipeLine, Venue } from "@/lib/types";

const NOW = "2026-10-10T03:00:00.000Z";
const venue = (id: number, slug: string, name: string): Venue => ({ id, slug, name, sort: id }) as Venue;

function dish(id: string, name: string, section: string | null, signed = false): MatrixDish {
  return { id, name, section, allergens: { contains: [], without: {}, confirmedAt: signed ? NOW : null, confirmedBy: null, components: null, needsSignoff: false }, signOff: signed ? "valid" : "never", marks: [], options: {} };
}
const todoFor = (v: Venue, ...d: MatrixDish[]) => venueTodo(v, buildRows(d), null);

describe("review queue", () => {
  const drift = venue(1, "drift", "Drift Bar");
  const chiobu = venue(2, "chiobu", "Chiobu");
  const todos = [
    todoFor(drift, dish("1", "Zesty Salad", "Salads"), dish("2", "Burger", "Burgers"), dish("3", "Done Dish", "Burgers", true), dish("4", "Apple Pie", "Burgers"), dish("5", "Mystery", null)),
    todoFor(chiobu, dish("6", "Gyoza", "Small Plates"), dish("7", "Bao", "Small Plates")),
  ];
  it("goes venue by venue (venue order), sections A to Z with Other last, dishes A to Z, and skips dishes already confirmed", () => {
    const q = reviewQueue(todos, {});
    expect(q.map((x) => `${x.venueSlug}:${x.section}:${x.name}`)).toEqual([
      "drift:Burgers:Apple Pie",
      "drift:Burgers:Burger",
      "drift:Salads:Zesty Salad",
      "drift:Other:Mystery",
      "chiobu:Small Plates:Bao",
      "chiobu:Small Plates:Gyoza",
    ]);
  });
  it("can be limited to one venue and one section", () => {
    expect(reviewQueue(todos, { venueId: 2 }).map((x) => x.name)).toEqual(["Bao", "Gyoza"]);
    expect(reviewQueue(todos, { section: "Burgers" }).map((x) => x.name)).toEqual(["Apple Pie", "Burger"]);
    expect(reviewQueue(todos, { section: "*" })).toHaveLength(6);
    expect(reviewQueue(todos, { venueId: 1, section: "burgers" })).toHaveLength(2);
    expect(reviewQueue(todos, { section: "Nope" })).toEqual([]);
  });
  it("says where you are: 12 of 40, Drift: Small Plates", () => {
    const q = reviewQueue(todos, {});
    expect(progressText(11, 40, { venueName: "Drift", section: "Small Plates" })).toBe("12 of 40, Drift: Small Plates");
    expect(progressText(0, q.length, q[0])).toBe("1 of 6, Drift Bar: Burgers");
  });
  it("offers the next venue when one is finished", () => {
    const q = reviewQueue(todos, {});
    expect(venueBreak(q, 3)).toEqual({ done: "Drift Bar", next: "Chiobu", count: 2 });
    expect(venueBreak(q, 0)).toBeNull();
    expect(venueBreak(q, 5)).toBeNull();
  });
  it("links to the review for a venue and section", () => {
    expect(reviewHref("drift")).toBe("/matrix/review?venue=drift&section=*");
    expect(reviewHref("drift", "Small Plates")).toBe("/matrix/review?venue=drift&section=Small+Plates");
    expect(reviewHref(null)).toBe("/matrix/review?section=*");
  });
});

describe("review draft: pre-filled, marked Suggested until a person taps", () => {
  const rollup = (cells: Record<string, "contains" | "may_contain" | "none">) => ({ cells: new Proxy({}, { get: (_t, k: string) => ({ state: cells[k] ?? "none", sources: [] }) }) as never });
  const item = { dish_allergens: null, diet_options: null } as Pick<MenuItem, "dish_allergens" | "diet_options">;

  it("starts from the ingredient proposal, nothing touched, the guesses flagged", () => {
    const d = initialReviewDraft(item, rollup({ milk: "contains", egg: "may_contain" }));
    expect(d.contains).toEqual(["egg", "milk"]);
    expect(d.suggestedOnly).toEqual(["egg"]);
    expect(d.touched).toBe(false);
    expect(stillSuggested(d)).toEqual(["egg", "milk"]); // every pre-filled chip is a suggestion until a person taps
  });
  it("keeps what the dish already listed and its can-be-made-without notes", () => {
    const d = initialReviewDraft({ dish_allergens: { contains: ["gluten"], without: { gluten: "GF bun" }, confirmed_at: NOW }, diet_options: null }, rollup({ milk: "contains" }));
    expect(d.contains).toEqual(["gluten", "milk"]);
    expect(d.without).toEqual({ gluten: "GF bun" });
  });
  it("any tap counts as reviewing: the Suggested warning goes away", () => {
    let d = initialReviewDraft(item, rollup({ milk: "may_contain" }));
    expect(stillSuggested(d)).toEqual(["milk"]);
    d = toggleReviewAllergen(d, "egg");
    expect(d.touched).toBe(true);
    expect(stillSuggested(d)).toEqual([]);
    expect(d.contains).toEqual(["egg", "milk"]);
    d = toggleReviewAllergen(d, "milk");
    expect(d.contains).toEqual(["egg"]);
  });
  it("a note only attaches to a ticked allergen; unticking drops it", () => {
    let d = initialReviewDraft(item, rollup({ milk: "contains" }));
    d = setReviewNote(d, "milk", "  no  cheese ");
    expect(d.without).toEqual({ milk: "no cheese" });
    expect(setReviewNote(d, "egg", "x")).toBe(d);
    d = toggleReviewAllergen(d, "milk");
    expect(d.without).toEqual({});
  });
  it("marks toggle through the same rules as the editor; a mark pushes out the option it cannot sit beside", () => {
    let d = initialReviewDraft({ dish_allergens: null, diet_options: { gfo: { note: "GF bun" } } } as never, rollup({}));
    const r = toggleReviewMark(d, "gf");
    expect(r.clearedOption).toBe("gfo");
    d = r.draft;
    expect(d.marks).toEqual(["gf"]);
    expect(readMarks(d.dietOptions)).toEqual(["gf"]);
    expect(d.touched).toBe(true);
    expect(toggleReviewMark(d, "gf").draft.marks).toEqual([]);
  });
});

describe("confirm writes the dish's own section with the sign-off and its components", () => {
  const rollup = { cells: new Proxy({}, { get: () => ({ state: "none", sources: [] }) }) as never };
  it("has the right shape: lists, notes, who, when, components, and the new-dish lock cleared", () => {
    const item = { dish_allergens: { contains: [], without: {}, needs_signoff: true }, diet_options: null } as Pick<MenuItem, "dish_allergens" | "diet_options">;
    let d = initialReviewDraft(item, rollup);
    d = setReviewNote(toggleReviewAllergen(d, "milk"), "milk", "no cheese");
    const patch = confirmPatch({ item, draft: d, email: "chef@example.com", nowIso: NOW, components: ["prep:p1", "ingredient:i1"] });
    expect(patch).toEqual({ dish_allergens: { contains: ["milk"], without: { milk: "no cheese" }, confirmed_at: NOW, confirmed_by: "chef@example.com", components: ["ingredient:i1", "prep:p1"] } });
    expect(patch).not.toHaveProperty("diet_options"); // marks untouched, so the column is not written
    const da = readDishAllergens(patch.dish_allergens);
    expect(da?.needsSignoff).toBe(false);
    expect(signOffState(da, ["ingredient:i1", "prep:p1"])).toBe("valid");
  });
  it("writes the marks too when they changed", () => {
    const item = { dish_allergens: null, diet_options: null } as Pick<MenuItem, "dish_allergens" | "diet_options">;
    const d = toggleReviewMark(initialReviewDraft(item, rollup), "vg").draft;
    const patch = confirmPatch({ item, draft: d, email: null, nowIso: NOW, components: [] });
    expect(readMarks(patch.diet_options)).toEqual(["vg"]);
    expect(patch.dish_allergens).toEqual({ contains: [], without: {}, confirmed_at: NOW, components: [] });
  });
});

describe("the fresh read before a confirm", () => {
  const own = ["ingredient:i1", "prep:p1"];
  const lines = (...pairs: [string, string][]) => pairs.map(([t, id]) => ({ component_type: t as "ingredient" | "prep", component_id: id }));
  it("goes ahead when the dish is unchanged", () => {
    expect(freshVerdict({ row: { updated_at: "t1" }, lines: lines(["ingredient", "i1"], ["prep", "p1"]) }, { updatedAt: "t1", ownComponents: own })).toEqual({ ok: true });
  });
  it("refuses when someone else changed the dish (updated_at moved)", () => {
    expect(freshVerdict({ row: { updated_at: "t2" }, lines: lines(["ingredient", "i1"], ["prep", "p1"]) }, { updatedAt: "t1", ownComponents: own })).toEqual({ ok: false, reason: "changed" });
  });
  it("refuses when a line was swapped or added underneath even if the stamp matches", () => {
    expect(freshVerdict({ row: { updated_at: "t1" }, lines: lines(["ingredient", "i1"], ["prep", "p9"]) }, { updatedAt: "t1", ownComponents: own })).toMatchObject({ ok: false });
    expect(freshVerdict({ row: { updated_at: "t1" }, lines: lines(["ingredient", "i1"], ["prep", "p1"], ["ingredient", "i2"]) }, { updatedAt: "t1", ownComponents: own })).toMatchObject({ ok: false });
  });
  it("refuses when the dish is gone", () => {
    expect(freshVerdict({ row: null, lines: [] }, { updatedAt: "t1", ownComponents: own })).toEqual({ ok: false, reason: "gone" });
  });
  it("says it plainly", () => {
    expect(REVIEW_CHANGED_TEXT).toBe("This dish was just changed by someone else. Reload it.");
  });
  it("the store writes through the fresh read, the updated_at guard and the store's own copy (nothing is written blind)", () => {
    const src = readFileSync("lib/store.tsx", "utf8");
    const fn = src.slice(src.indexOf("const confirmDish"), src.indexOf("// Deals follow the date"));
    expect(fn).toMatch(/fetchFreshRecord/);
    expect(fn).toMatch(/freshVerdict\(fresh, shown\)/);
    expect(fn).toMatch(/guardedUpdate<MenuItem>\(sb, "item", itemId, make\(components, row\), row\.updated_at/);
    expect(fn).toMatch(/setData\(/);
    expect(fn).not.toMatch(/\.insert\(/);
  });
});

/* ------------------------------------------------------------------ impact first */

describe("impact first on shared prep edits", () => {
  let n = 0;
  const L = (parentType: "item" | "prep", parent: string, ctype: "ingredient" | "prep", comp: string): RecipeLine => {
    n += 1;
    return { id: `l${n}`, parent_type: parentType, parent_id: parent, component_type: ctype, component_id: comp, qty: 5, unit: "g", note: null, sort: n };
  };
  const m = (id: string, name: string, over: Partial<MenuItem> = {}): MenuItem => ({ id, name, venue_id: 1, category: "Food", section: "Mains", portions: 1, sell_price_inc: 20, target_override: null, hh_price_inc: null, active: true, source: null, notes: null, ...over });
  const lines = [L("item", "d1", "prep", "p1"), L("item", "d2", "prep", "p2"), L("item", "d3", "ingredient", "i9"), L("item", "d4", "prep", "p1"), L("prep", "p1", "ingredient", "i1"), L("prep", "p2", "prep", "p1"), L("prep", "p2", "ingredient", "i2")];
  const map = groupLines(lines);
  const comps = (id: string) => (id === "d1" ? ["ingredient:i1", "prep:p1"] : id === "d2" ? ["ingredient:i1", "ingredient:i2", "prep:p1", "prep:p2"] : id === "d3" ? ["ingredient:i9"] : ["ingredient:i1", "prep:p1"]);
  const signed = (id: string) => ({ contains: [], without: {}, confirmed_at: NOW, components: comps(id) });
  const items = [m("d1", "Dish One", { dish_allergens: signed("d1") }), m("d2", "Dish Two", { dish_allergens: signed("d2") }), m("d3", "Dish Three", { dish_allergens: signed("d3") }), m("d4", "Dish Four", { dish_allergens: null }), m("d5", "Off Dish", { active: false, dish_allergens: signed("d1") })];
  const before = lines.filter((l) => l.parent_id === "p1");

  it("no component change (amounts only) means no question", () => {
    expect(prepComponentsChanged("p1", map, before, before.map((l) => ({ ...l, qty: 99 })))).toBe(false);
    expect(prepSaveImpact("p1", items, map, before, before.map((l) => ({ ...l, qty: 99 })))).toBeNull();
  });
  it("a swapped ingredient asks first, naming the confirmed active dishes that use the prep, directly or through another prep", () => {
    const after = [{ ...before[0], component_id: "i-new" }];
    expect(prepComponentsChanged("p1", map, before, after)).toBe(true);
    expect(confirmedDishesUsing("p1", items, map).map((d) => d.name)).toEqual(["Dish One", "Dish Two"]);
    expect(prepSaveImpact("p1", items, map, before, after)?.map((d) => d.name)).toEqual(["Dish One", "Dish Two"]);
  });
  it("leaves out dishes that are not signed off, are switched off, or do not use the prep", () => {
    const names = confirmedDishesUsing("p1", items, map).map((d) => d.name);
    expect(names).not.toContain("Dish Three");
    expect(names).not.toContain("Dish Four");
    expect(names).not.toContain("Off Dish");
  });
  it("no question when no confirmed dish uses the prep", () => {
    const after = [{ ...before[0], component_id: "i-new" }];
    expect(prepSaveImpact("p1", items.map((i) => ({ ...i, dish_allergens: null })), map, before, after)).toBeNull();
  });
  it("reads: Used in N confirmed dishes. They will need their allergens re-checked.", () => {
    expect(impactHeadline(3)).toBe("Used in 3 confirmed dishes. They will need their allergens re-checked.");
    expect(impactHeadline(1)).toBe("Used in 1 confirmed dish. It will need its allergens re-checked.");
  });
  it("lists up to 8 names, then and N more", () => {
    const names = Array.from({ length: 11 }, (_, i) => `Dish ${i}`);
    expect(impactNames(names)).toEqual({ shown: names.slice(0, 8), more: 3 });
    expect(impactNames(["a"])).toEqual({ shown: ["a"], more: 0 });
  });
  it("the post-save nudge fires when a signed-off dish's ingredients changed, not when the person unticked something", () => {
    const dLines = [L("item", "dx", "ingredient", "i1")];
    const sign = { contains: [], without: {}, confirmed_at: NOW, components: ["ingredient:i1"] };
    const empty = new Map<string, RecipeLine[]>();
    expect(lostSignOff({ dish_allergens: sign, lines: dLines }, { dish_allergens: sign, lines: [...dLines, L("item", "dx", "ingredient", "i2")] }, "dx", empty)).toBe(true);
    expect(lostSignOff({ dish_allergens: sign, lines: dLines }, { dish_allergens: sign, lines: dLines.map((l) => ({ ...l, qty: 50 })) }, "dx", empty)).toBe(false);
    expect(lostSignOff({ dish_allergens: sign, lines: dLines }, { dish_allergens: { contains: ["milk"], without: {} }, lines: dLines }, "dx", empty)).toBe(false);
    expect(lostSignOff({ dish_allergens: null, lines: dLines }, { dish_allergens: null, lines: [] }, "dx", empty)).toBe(false);
  });
  it("the editor asks before saving a prep and offers Save Anyway and Cancel", () => {
    const src = readFileSync("components/editor/recipe-editor.tsx", "utf8");
    expect(src).toMatch(/prepSaveImpact\(id, s\.items/);
    expect(src).toContain("Save Anyway");
    expect(src).toMatch(/if \(!\(await gateImpact\(\)\)\) return false;/);
    expect(src).toContain("Open Allergens");
  });
});

/* ------------------------------------------------------------------ the checklist */

describe("Finish Setting Up This Dish", () => {
  const base = { lineCount: 3, signOff: "valid" as const, dietOptions: null, kitchenMethod: ["Toast the bun"], kitchenReady: true };
  it("is complete only when every step is done, and then it hides", () => {
    const m = setupModel(base);
    expect(m.complete).toBe(true);
    expect(m.next).toBeNull();
    expect(m.doneCount).toBe(5);
  });
  it("highlights the first step not done, in order", () => {
    expect(setupModel({ ...base, lineCount: 0, signOff: "never", kitchenMethod: null, kitchenReady: false }).next).toBe("ingredients");
    expect(setupModel({ ...base, signOff: "never", kitchenMethod: null, kitchenReady: false }).next).toBe("allergens");
    expect(setupModel({ ...base, kitchenMethod: [" "], kitchenReady: false }).next).toBe("method");
    expect(setupModel({ ...base, kitchenReady: false }).next).toBe("ready");
  });
  it("an allergen sign-off whose ingredients changed is not done, and the row says re-check", () => {
    const m = setupModel({ ...base, signOff: "changed" });
    expect(m.steps.find((s) => s.id === "allergens")).toMatchObject({ done: false, sub: "Ingredients changed. Re-check and confirm again" });
    expect(setupModel({ ...base, signOff: "legacy" }).complete).toBe(false);
  });
  it("Dietary Marks And Options is informational, done once the allergens are confirmed, with no flag of its own", () => {
    expect(marksAndOptionsSummary(null)).toBe("None set");
    expect(marksAndOptionsSummary({ gf: {}, gfo: { note: "x" }, dfo: { note: "y" } })).toBe("3 set");
    const steps = setupModel({ ...base, dietOptions: { vg: {} } }).steps;
    expect(steps.find((s) => s.id === "marks")).toMatchObject({ done: true, sub: "1 set" });
    expect(setupModel({ ...base, signOff: "never" }).steps.find((s) => s.id === "marks")?.done).toBe(false);
  });
  it("each row scrolls to its section; allergens and dietary go to the one shared card", () => {
    expect(SETUP_ANCHORS.allergens).toBe("allergens-dietary");
    expect(SETUP_ANCHORS.marks).toBe("allergens-dietary");
    const editor = readFileSync("components/editor/recipe-editor.tsx", "utf8");
    const kitchen = readFileSync("components/editor/kitchen-fields.tsx", "utf8");
    expect(editor).toContain('id="setup-ingredients"');
    expect(kitchen).toContain('id="kitchen-ready"');
    expect(kitchen).toContain('id="kitchen-method"');
    expect(readFileSync("components/editor/safety-card.tsx", "utf8")).toContain("data-flash");
  });
  it("rows are at least 44px and the list sits in the page flow, not over the Save bar", () => {
    const src = readFileSync("components/editor/finish-setup.tsx", "utf8");
    expect(src).toContain("min-h-[52px]");
    expect(src).not.toMatch(/\bfixed\b|\bsticky\b/);
  });
});
