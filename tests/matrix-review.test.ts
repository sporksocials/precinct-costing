import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildRows, type MatrixDish } from "@/lib/allergy-matrix";
import { confirmAllergens, dishCheck, liveCheck, readDishAllergens, signOffState } from "@/lib/dish-allergens";
import { readMarks } from "@/lib/diet-options";
import {
  REVIEW_CHANGED_TEXT,
  REVIEW_UNREVIEWED_TEXT,
  confirmPatch,
  freshVerdict,
  initialReviewDraft,
  progressText,
  reviewContains,
  reviewQueue,
  setReviewNote,
  toggleReviewExtra,
  toggleReviewMark,
  venueBreak,
} from "@/lib/matrix-review";
import { reviewHref, venueTodo } from "@/lib/matrix-todo";
import { prepSaveImpact, confirmedDishesUsing, impactHeadline, impactNames, lostSignOff } from "@/lib/allergy-recheck";
import { setupModel, marksAndOptionsSummary, SETUP_ANCHORS } from "@/lib/finish-setup";
import { buildIndex } from "@/lib/costing";
import type { AllergenIndex } from "@/lib/allergens";
import type { Ingredient, MenuItem, Prep, RecipeLine, Venue } from "@/lib/types";

const NOW = "2026-10-10T03:00:00.000Z";
const venue = (id: number, slug: string, name: string): Venue => ({ id, slug, name, sort: id }) as Venue;

function dish(id: string, name: string, section: string | null, signed = false): MatrixDish {
  return { id, name, section, allergens: { contains: [], without: {}, added: [], basis: null, confirmedAt: signed ? NOW : null, confirmedBy: null, components: null, ticks: null, needsSignoff: false }, signOff: signed ? "valid" : "never", marks: [], options: {} };
}
const todoFor = (v: Venue, ...d: MatrixDish[]) => venueTodo(v, buildRows(d), null);
/** a todo where the named dish ids are waiting on an unreviewed ingredient */
const todoBlocked = (v: Venue, blocked: string[], ...d: MatrixDish[]) => venueTodo(v, buildRows(d), null, undefined, new Map(blocked.map((id) => [id, { unreviewed: [{ id: "i-x", name: "Bacon" }], problems: false }])));

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
  it("only lists dishes that can be confirmed now: a dish waiting on an unreviewed ingredient is not in the queue", () => {
    const t = [todoBlocked(drift, ["1", "5"], dish("1", "Zesty Salad", "Salads"), dish("2", "Burger", "Burgers"), dish("5", "Mystery", null))];
    expect(reviewQueue(t, {}).map((x) => x.name)).toEqual(["Burger"]);
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

describe("review draft: the allergens come from the ingredients, a person adds extras and notes", () => {
  const item = { dish_allergens: null, diet_options: null } as Pick<MenuItem, "dish_allergens" | "diet_options">;

  it("starts with no extras, nothing touched; what the dish contains is the derived list", () => {
    const d = initialReviewDraft(item, ["egg", "milk"]);
    expect(d.added).toEqual([]);
    expect(d.touched).toBe(false);
    expect(reviewContains(d, ["egg", "milk"])).toEqual(["egg", "milk"]);
  });
  it("keeps the extras and the can-be-made-without notes the dish already had, and drops an extra the ingredients now show", () => {
    const d = initialReviewDraft({ dish_allergens: { contains: ["gluten", "milk", "sesame"], without: { gluten: "GF bun", sesame: "no seeds" }, added: ["sesame", "milk"], confirmed_at: NOW }, diet_options: null }, ["gluten", "milk"]);
    expect(d.added).toEqual(["sesame"]);
    expect(d.without).toEqual({ gluten: "GF bun", sesame: "no seeds" });
  });
  it("an extra can be added and taken off again, in the fixed order; a derived allergen cannot be switched off", () => {
    let d = initialReviewDraft(item, ["milk"]);
    d = toggleReviewExtra(d, "sesame", ["milk"]);
    d = toggleReviewExtra(d, "egg", ["milk"]);
    expect(d.touched).toBe(true);
    expect(d.added).toEqual(["egg", "sesame"]);
    expect(reviewContains(d, ["milk"])).toEqual(["egg", "milk", "sesame"]);
    expect(toggleReviewExtra(d, "milk", ["milk"])).toBe(d); // fix the ingredient instead
    d = toggleReviewExtra(d, "egg", ["milk"]);
    expect(d.added).toEqual(["sesame"]);
  });
  it("a note attaches to anything the dish contains (derived or extra); taking an extra off drops its note", () => {
    let d = initialReviewDraft(item, ["milk"]);
    d = setReviewNote(d, "milk", "  no  cheese ", ["milk"]);
    expect(d.without).toEqual({ milk: "no cheese" });
    expect(setReviewNote(d, "egg", "x", ["milk"])).toBe(d);
    d = toggleReviewExtra(d, "egg", ["milk"]);
    d = setReviewNote(d, "egg", "no wash", ["milk"]);
    expect(d.without).toEqual({ milk: "no cheese", egg: "no wash" });
    d = toggleReviewExtra(d, "egg", ["milk"]);
    expect(d.without).toEqual({ milk: "no cheese" });
  });
  it("marks toggle through the same rules as the editor; a mark pushes out the option it cannot sit beside", () => {
    let d = initialReviewDraft({ dish_allergens: null, diet_options: { gfo: { note: "GF bun" } } } as never, []);
    const r = toggleReviewMark(d, "gf");
    expect(r.clearedOption).toBe("gfo");
    d = r.draft;
    expect(d.marks).toEqual(["gf"]);
    expect(readMarks(d.dietOptions)).toEqual(["gf"]);
    expect(d.touched).toBe(true);
    expect(toggleReviewMark(d, "gf").draft.marks).toEqual([]);
  });
});

describe("confirm writes the dish's own section with the sign-off, its components and the ticks", () => {
  const ticks = { "ingredient:i1": { a: ["milk" as const], r: true }, "prep:p1": { add: [] as never[], rem: [] as never[] }, "item:d": { add: [] as never[], rem: [] as never[] } };
  const check = { derived: ["milk" as const], live: { components: ["ingredient:i1", "prep:p1"], ticks } };
  it("has the right shape: derived plus extras, notes, who, when, components, ticks, basis and the new-dish lock cleared", () => {
    const item = { dish_allergens: { contains: [], without: {}, needs_signoff: true }, diet_options: null } as Pick<MenuItem, "dish_allergens" | "diet_options">;
    let d = initialReviewDraft(item, check.derived);
    d = setReviewNote(toggleReviewExtra(d, "sesame", check.derived), "milk", "no cheese", check.derived);
    const patch = confirmPatch({ item, draft: d, email: "chef@example.com", nowIso: NOW, check });
    expect(patch).toEqual({
      dish_allergens: {
        contains: ["milk", "sesame"],
        without: { milk: "no cheese" },
        added: ["sesame"],
        confirmed_at: NOW,
        confirmed_by: "chef@example.com",
        components: ["ingredient:i1", "prep:p1"],
        basis: ["milk"],
        ticks,
      },
    });
    expect(patch).not.toHaveProperty("diet_options"); // marks untouched, so the column is not written
    const da = readDishAllergens(patch.dish_allergens);
    expect(da?.needsSignoff).toBe(false);
    expect(signOffState(da, check.live)).toBe("valid");
  });
  it("writes the marks too when they changed", () => {
    const item = { dish_allergens: null, diet_options: null } as Pick<MenuItem, "dish_allergens" | "diet_options">;
    const d = toggleReviewMark(initialReviewDraft(item, []), "vg").draft;
    const patch = confirmPatch({ item, draft: d, email: null, nowIso: NOW, check: { derived: [], live: { components: [], ticks: {} } } });
    expect(readMarks(patch.diet_options)).toEqual(["vg"]);
    expect(patch.dish_allergens).toEqual({ contains: [], without: {}, confirmed_at: NOW, components: [], basis: [], ticks: {} });
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
    expect(REVIEW_UNREVIEWED_TEXT).toContain("still need their allergens checked");
  });
  it("the store writes through the fresh read, the updated_at guard and the store's own copy (nothing is written blind)", () => {
    const src = readFileSync("lib/store.tsx", "utf8");
    const fn = src.slice(src.indexOf("const confirmDish"), src.indexOf("// Deals follow the date"));
    expect(fn).toMatch(/fetchFreshRecord/);
    expect(fn).toMatch(/freshVerdict\(fresh, shown\)/);
    // the fresh ingredients and preps are read too, and the confirm is refused when what they give moved or an ingredient is unreviewed
    expect(fn).toMatch(/from\("cost_ingredients"\)\.select\("\*"\)\.in\("id"/);
    expect(fn).toMatch(/confirmVerdict\(check, \{ derived: shown\.derived, ticks: shown\.ticks \}\)/);
    expect(fn).toMatch(/reason: "unreviewed"/);
    expect(fn).toMatch(/guardedUpdate<MenuItem>\(sb, "item", itemId, make\(check, row\), row\.updated_at/);
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
  const ing = (id: string, allergens: string[] = []): Ingredient => ({ id, name: id, category: "Food", supplier_id: null, supplier_code: null, pack_size: 1, pack_unit: "kg", pack_price: 1, price_inc_gst: false, gst_free: false, rebate: 0, yield_pct: 1, venues: "All", active: true, last_price_update: null, previous_price: null, source: null, notes: null, updated_at: null, allergens, allergens_reviewed: true, diet_flags: [] }) as Ingredient;
  const prep = (id: string, over: Partial<Prep> = {}): Prep => ({ id, name: id, venue_id: 1, prep_type: null, yield_qty: 1, yield_unit: "kg", active: true, source: null, notes: null, ...over }) as Prep;
  const m = (id: string, name: string, over: Partial<MenuItem> = {}): MenuItem => ({ id, name, venue_id: 1, category: "Food", section: "Mains", portions: 1, sell_price_inc: 20, target_override: null, hh_price_inc: null, active: true, source: null, notes: null, ...over });
  const lines = [L("item", "d1", "prep", "p1"), L("item", "d2", "prep", "p2"), L("item", "d3", "ingredient", "i9"), L("item", "d4", "prep", "p1"), L("prep", "p1", "ingredient", "i1"), L("prep", "p2", "prep", "p1"), L("prep", "p2", "ingredient", "i2")];
  const ingredients = [ing("i1", ["milk"]), ing("i2"), ing("i9"), ing("i-new")];
  const preps = [prep("p1"), prep("p2")];
  const base = (items: MenuItem[]): AllergenIndex => ({ ...buildIndex(ingredients, preps, lines), items: new Map(items.map((i) => [i.id, i])) });
  const plain = [m("d1", "Dish One"), m("d2", "Dish Two"), m("d3", "Dish Three"), m("d4", "Dish Four"), m("d5", "Off Dish", { active: false })];
  const signedFor = (id: string): MenuItem["dish_allergens"] => {
    const item = plain.find((x) => x.id === id) as MenuItem;
    const c = dishCheck(item, base(plain));
    return confirmAllergens(null, "chef@example.com", NOW, { derived: c.derived, components: c.live.components, ticks: c.live.ticks });
  };
  const items = [
    { ...plain[0], dish_allergens: signedFor("d1") },
    { ...plain[1], dish_allergens: signedFor("d2") },
    { ...plain[2], dish_allergens: signedFor("d3") },
    { ...plain[3], dish_allergens: null },
    { ...plain[4], dish_allergens: signedFor("d1") },
  ];
  const index = base(items);
  const before = lines.filter((l) => l.parent_id === "p1");

  it("no component change (amounts only) means no question", () => {
    expect(prepSaveImpact("p1", items, index, before, before.map((l) => ({ ...l, qty: 99 })))).toBeNull();
  });
  it("a swapped ingredient asks first, naming the confirmed active dishes that use the prep, directly or through another prep", () => {
    const after = [{ ...before[0], component_id: "i-new" }];
    expect(confirmedDishesUsing("p1", items, index).map((d) => d.name)).toEqual(["Dish One", "Dish Two"]);
    expect(prepSaveImpact("p1", items, index, before, after)?.map((d) => d.name)).toEqual(["Dish One", "Dish Two"]);
  });
  it("a change to the prep's own allergen override asks first too, even with the same ingredients", () => {
    expect(prepSaveImpact("p1", items, index, before, before, prep("p1", { allergen_add: ["fish"] }))?.map((d) => d.name)).toEqual(["Dish One", "Dish Two"]);
    expect(prepSaveImpact("p1", items, index, before, before, prep("p1"))).toBeNull();
  });
  it("leaves out dishes that are not signed off, are switched off, or do not use the prep", () => {
    const names = confirmedDishesUsing("p1", items, index).map((d) => d.name);
    expect(names).not.toContain("Dish Three");
    expect(names).not.toContain("Dish Four");
    expect(names).not.toContain("Off Dish");
  });
  it("no question when no confirmed dish uses the prep", () => {
    const after = [{ ...before[0], component_id: "i-new" }];
    const unsigned = items.map((i) => ({ ...i, dish_allergens: null }));
    expect(prepSaveImpact("p1", unsigned, base(unsigned), before, after)).toBeNull();
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
  it("the post-save nudge fires when a signed-off dish's ingredients changed, not when the person edited the extras or only an amount", () => {
    const one = items[2]; // Dish Three, own ingredient i9, signed
    const dLines = lines.filter((l) => l.parent_id === "d3");
    expect(lostSignOff({ item: one, lines: dLines }, { item: one, lines: [...dLines, L("item", "d3", "ingredient", "i2")] }, index)).toBe(true);
    expect(lostSignOff({ item: one, lines: dLines }, { item: one, lines: dLines.map((l) => ({ ...l, qty: 50 })) }, index)).toBe(false);
    expect(lostSignOff({ item: one, lines: dLines }, { item: { ...one, dish_allergens: { contains: ["milk"], without: {} } }, lines: dLines }, index)).toBe(false);
    expect(lostSignOff({ item: { ...one, dish_allergens: null }, lines: dLines }, { item: { ...one, dish_allergens: null }, lines: [] }, index)).toBe(false);
    // an ingredient tick changed by someone else shows up the same way
    const ticked = { ...index, ingredients: new Map(index.ingredients).set("i9", ing("i9", ["egg"])) };
    expect(signOffState(readDishAllergens(one.dish_allergens), liveCheck(one, ticked))).toBe("changed");
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
  it("ingredients nobody has checked block the confirm and are counted in the row", () => {
    const m = setupModel({ ...base, signOff: "never", unreviewed: 3 });
    expect(m.steps.find((s) => s.id === "allergens")).toMatchObject({ done: false, sub: "3 ingredients need their allergens checked first" });
    expect(setupModel({ ...base, signOff: "never", unreviewed: 1 }).steps.find((s) => s.id === "allergens")?.sub).toBe("1 ingredient needs their allergens checked first");
    expect(setupModel({ ...base, signOff: "never" }).steps.find((s) => s.id === "allergens")?.sub).toBe("Check what the ingredients give, then confirm");
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
