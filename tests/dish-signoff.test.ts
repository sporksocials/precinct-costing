import { describe, expect, it } from "vitest";
import {
  COMPONENT_DEPTH,
  NEW_DISH_LOCK_REASON,
  activeLockedReason,
  addExtra,
  checkIngredientsHref,
  confirmAllergens,
  confirmVerdict,
  currentComponents,
  deriveContains,
  dishCheck,
  effectiveAllergens,
  isSignOffValid,
  liveCheck,
  newDishAllergens,
  newDishCopy,
  newDishPatch,
  readDishAllergens,
  readTicks,
  sameComponents,
  sameTicks,
  setWithoutNote,
  signOffState,
  sourceLines,
  staleSignOffText,
  ticksFor,
  unconfirmedCopy,
  unreviewedIn,
  unreviewedText,
  type DishCheck,
} from "@/lib/dish-allergens";
import { buildRows } from "@/lib/allergy-matrix";
import { matrixDishFromItem } from "@/lib/allergy-matrix-store";
import { buildIndex } from "@/lib/costing";
import { rollup, type AllergenIndex } from "@/lib/allergens";
import type { Ingredient, MenuItem, Prep, RecipeLine } from "@/lib/types";

const NOW = "2026-10-10T03:00:00.000Z";

let n = 0;
const line = (parent: string, type: "item" | "prep", comp: string, ctype: "ingredient" | "prep" = "ingredient", qty = 10): RecipeLine => {
  n += 1;
  return { id: `l${n}`, parent_type: type, parent_id: parent, component_type: ctype, component_id: comp, qty, unit: "g", note: null, sort: n };
};
const byParent = (lines: RecipeLine[]) => buildIndex([], [], lines).linesByParent;
const ing = (id: string, allergens: string[] = [], reviewed = true, name = id): Ingredient =>
  ({ id, name, category: "Food", supplier_id: null, supplier_code: null, pack_size: 1, pack_unit: "kg", pack_price: 1, price_inc_gst: false, gst_free: false, rebate: 0, yield_pct: 1, venues: "All", active: true, last_price_update: null, previous_price: null, source: null, notes: null, updated_at: null, allergens, allergens_reviewed: reviewed, diet_flags: [] }) as Ingredient;
const prep = (id: string, over: Partial<Prep> = {}): Prep => ({ id, name: id, venue_id: 1, prep_type: null, yield_qty: 1, yield_unit: "kg", active: true, source: null, notes: null, ...over }) as Prep;
const item = (over: Partial<MenuItem> = {}): MenuItem => ({ id: "d", name: "Dish", venue_id: 1, category: "Food", section: "Mains", portions: 1, sell_price_inc: 20, target_override: null, hh_price_inc: null, active: true, source: null, notes: null, ...over });
const indexOf = (m: MenuItem, ingredients: Ingredient[], preps: Prep[], lines: RecipeLine[]): AllergenIndex => ({ ...buildIndex(ingredients, preps, lines), items: new Map([[m.id, m]]) });
const confirmedItem = (m: MenuItem, index: AllergenIndex, over: Partial<MenuItem> = {}): MenuItem => {
  const c = dishCheck(m, index);
  return { ...m, ...over, dish_allergens: confirmAllergens(m.dish_allergens, "chef@example.com", NOW, { derived: c.derived, components: c.live.components, ticks: c.live.ticks }) };
};

describe("currentComponents: what a dish is made from, through every nested prep", () => {
  it("lists the dish's own ingredients and preps, sorted and unique", () => {
    const m = byParent([line("d", "item", "i2"), line("d", "item", "i1"), line("d", "item", "p1", "prep"), line("d", "item", "i1")]);
    expect(currentComponents("item", "d", m)).toEqual(["ingredient:i1", "ingredient:i2", "prep:p1"]);
  });
  it("reads the lines of a prep, and of the preps inside it", () => {
    const m = byParent([line("d", "item", "p1", "prep"), line("p1", "prep", "i1"), line("p1", "prep", "p2", "prep"), line("p2", "prep", "i2")]);
    expect(currentComponents("item", "d", m)).toEqual(["ingredient:i1", "ingredient:i2", "prep:p1", "prep:p2"]);
  });
  it("ignores a blank line that has no component yet", () => {
    const blank = { ...line("d", "item", "i1"), component_id: "" };
    expect(currentComponents("item", "d", byParent([blank, line("d", "item", "i2")]))).toEqual(["ingredient:i2"]);
  });
  it("is cycle safe: a prep that uses itself, or two preps that use each other, still finish", () => {
    const self = byParent([line("d", "item", "p1", "prep"), line("p1", "prep", "p1", "prep"), line("p1", "prep", "i1")]);
    expect(currentComponents("item", "d", self)).toEqual(["ingredient:i1", "prep:p1"]);
    const loop = byParent([line("d", "item", "p1", "prep"), line("p1", "prep", "p2", "prep"), line("p2", "prep", "p1", "prep"), line("p2", "prep", "i2")]);
    expect(currentComponents("item", "d", loop)).toEqual(["ingredient:i2", "prep:p1", "prep:p2"]);
  });
  it("stops at the depth cap (the SQL feed uses the same number)", () => {
    expect(COMPONENT_DEPTH).toBe(8);
    const lines: RecipeLine[] = [line("d", "item", "p1", "prep")];
    for (let k = 1; k <= 12; k++) {
      lines.push(line(`p${k}`, "prep", `i${k}`));
      lines.push(line(`p${k}`, "prep", `p${k + 1}`, "prep"));
    }
    const c = currentComponents("item", "d", byParent(lines));
    expect(c).toContain("ingredient:i1");
    expect(c).toContain("ingredient:i8");
    expect(c).toContain("prep:p9");
    expect(c).not.toContain("ingredient:i9");
  });
  it("works for a prep as the starting point (the impact-first check)", () => {
    const m = byParent([line("p1", "prep", "i1"), line("p1", "prep", "p2", "prep"), line("p2", "prep", "i2")]);
    expect(currentComponents("prep", "p1", m)).toEqual(["ingredient:i1", "ingredient:i2", "prep:p2"]);
  });
});

describe("derived allergens: worked out from the ingredients, never typed on the dish", () => {
  it("a confirmed tick counts; a keyword guess on an unreviewed ingredient does not", () => {
    const m = item();
    const idx = indexOf(m, [ing("bun", ["gluten", "milk"]), ing("mayo", [], false, "Egg Mayo")], [], [line("d", "item", "bun"), line("d", "item", "mayo")]);
    const c = dishCheck(m, idx);
    expect(c.derived).toEqual(["gluten", "milk"]); // Egg Mayo is unreviewed: the name suggests egg, but a guess is never contained
    expect(rollup({ kind: "item", id: "d" }, idx).cells.egg.state).toBe("may_contain");
    expect(deriveContains(rollup({ kind: "item", id: "d" }, idx))).toEqual(["gluten", "milk"]);
  });
  it("lists the 15 main ids in the fixed order and never alcohol", () => {
    const m = item();
    const idx = indexOf(m, [ing("wine", ["alcohol", "sulphites"]), ing("bacon", ["nitrites"]), ing("bun", ["gluten"])], [], [line("d", "item", "wine"), line("d", "item", "bacon"), line("d", "item", "bun")]);
    expect(dishCheck(m, idx).derived).toEqual(["gluten", "sulphites", "nitrites"]);
  });
  it("goes through nested preps, and a prep's own add override counts", () => {
    const m = item();
    const idx = indexOf(m, [ing("flour", ["gluten"]), ing("cream", ["milk"])], [prep("p1", { allergen_add: ["lupin"] }), prep("p2")], [line("d", "item", "p1", "prep"), line("p1", "prep", "p2", "prep"), line("p2", "prep", "flour"), line("p1", "prep", "cream")]);
    expect(dishCheck(m, idx).derived).toEqual(["gluten", "milk", "lupin"]);
  });
  it("the dish's own override is honoured: add counts, remove takes the allergen off", () => {
    const base = item();
    const ingredients = [ing("bun", ["gluten", "milk"])];
    const lines = [line("d", "item", "bun")];
    const added = item({ allergen_add: ["fish"] });
    expect(dishCheck(added, indexOf(added, ingredients, [], lines)).derived).toEqual(["gluten", "fish", "milk"]);
    const removed = item({ allergen_remove: ["milk"] });
    expect(dishCheck(removed, indexOf(removed, ingredients, [], lines)).derived).toEqual(["gluten"]);
    expect(dishCheck(base, indexOf(base, ingredients, [], lines)).derived).toEqual(["gluten", "milk"]);
  });
  it("survives a recipe that loops back on itself, and says it cannot be read (blocked)", () => {
    const m = item();
    const idx = indexOf(m, [ing("flour", ["gluten"])], [prep("p1"), prep("p2")], [line("d", "item", "p1", "prep"), line("p1", "prep", "p2", "prep"), line("p2", "prep", "p1", "prep"), line("p2", "prep", "flour")]);
    const c = dishCheck(m, idx);
    expect(c.problems).toBe(true);
    expect(c.blocked).toBe(true);
    expect(c.derived).toContain("gluten");
  });
  it("extras the ingredients do not show are added to the contained list, in the fixed order; a derived id is never double counted", () => {
    const m = item({ dish_allergens: { contains: [], without: {}, added: ["sesame", "milk"] } });
    const idx = indexOf(m, [ing("cream", ["milk"])], [], [line("d", "item", "cream")]);
    const c = dishCheck(m, idx);
    expect(c.derived).toEqual(["milk"]);
    expect(c.added).toEqual(["sesame"]);
    expect(c.contains).toEqual(["milk", "sesame"]);
  });
});

describe("unreviewed ingredients block the confirm", () => {
  it("lists every unreviewed ingredient in the components, through nested preps, by name", () => {
    const m = item();
    const idx = indexOf(m, [ing("a", [], false, "Bacon"), ing("b", [], true, "Flour"), ing("c", [], false, "Eggs (Each)")], [prep("p1")], [line("d", "item", "a"), line("d", "item", "b"), line("d", "item", "p1", "prep"), line("p1", "prep", "c")]);
    const c = dishCheck(m, idx);
    expect(c.unreviewed.map((u) => u.name)).toEqual(["Bacon", "Eggs (Each)"]);
    expect(c.blocked).toBe(true);
    expect(unreviewedIn(c.live.components, idx).map((u) => u.id)).toEqual(["a", "c"]);
  });
  it("an ingredient the index does not know is treated as unreviewed (its allergens cannot be known)", () => {
    const m = item();
    const c = dishCheck(m, indexOf(m, [], [], [line("d", "item", "ghost")]));
    expect(c.unreviewed).toEqual([{ id: "ghost", name: "Unknown ingredient" }]);
    expect(c.blocked).toBe(true);
  });
  it("a dish with every ingredient reviewed, or with no ingredients, is not blocked", () => {
    const m = item();
    expect(dishCheck(m, indexOf(m, [ing("a")], [], [line("d", "item", "a")])).blocked).toBe(false);
    expect(dishCheck(m, indexOf(m, [], [], [])).blocked).toBe(false);
  });
  it("names up to six, then 'and N more'", () => {
    const names = (k: number) => Array.from({ length: k }, (_, i) => ({ id: `i${i}`, name: `Item ${i + 1}` }));
    expect(unreviewedText(names(1))).toBe("Item 1 still needs its allergens checked");
    expect(unreviewedText(names(2))).toBe("Item 1 and Item 2 still need their allergens checked");
    expect(unreviewedText(names(3))).toBe("Item 1, Item 2 and Item 3 still need their allergens checked");
    expect(unreviewedText(names(9))).toBe("Item 1, Item 2, Item 3, Item 4, Item 5, Item 6 and 3 more still need their allergens checked");
    expect(unreviewedText([])).toBe("");
  });
  it("links the dish to the ingredient review", () => {
    expect(checkIngredientsHref("abc 1")).toBe("/allergens/review?dish=abc%201");
  });
});

describe("the ticks snapshot", () => {
  const m = item({ allergen_add: ["lupin"] });
  const idx = indexOf(m, [ing("a", ["milk", "gluten"]), ing("b", [], false)], [prep("p1", { allergen_add: ["fish"], allergen_remove: ["egg"] })], [line("d", "item", "a"), line("d", "item", "b"), line("d", "item", "p1", "prep")]);
  it("holds each ingredient's sorted ticks and reviewed flag, each prep's and the dish's overrides, in the fixed order", () => {
    const live = liveCheck(m, idx);
    expect(live.ticks).toEqual({
      "ingredient:a": { a: ["gluten", "milk"], r: true },
      "ingredient:b": { a: [], r: false },
      "prep:p1": { add: ["fish"], rem: ["egg"] },
      "item:d": { add: ["lupin"], rem: [] },
    });
    expect(Object.keys(live.ticks).sort()).toEqual([...live.components, "item:d"].sort());
  });
  it("only the 15 main ids are kept (alcohol is not part of the snapshot)", () => {
    const live = liveCheck(item(), indexOf(item(), [ing("w", ["alcohol", "sulphites"])], [], [line("d", "item", "w")]));
    expect(live.ticks["ingredient:w"]).toEqual({ a: ["sulphites"], r: true });
  });
  it("a missing ingredient or prep reads as empty and unreviewed", () => {
    const t = ticksFor(["ingredient:ghost", "prep:ghost"], item(), indexOf(item(), [], [], []));
    expect(t["ingredient:ghost"]).toEqual({ a: [], r: false });
    expect(t["prep:ghost"]).toEqual({ add: [], rem: [] });
  });
  it("reads a stored snapshot tolerantly and re-sorts the arrays into the fixed order", () => {
    expect(readTicks(null)).toBeNull();
    expect(readTicks("x")).toBeNull();
    expect(readTicks({ "ingredient:a": { a: ["milk", "gluten", "bogus"], r: true }, "prep:p": { add: ["fish"] }, "weird": 1 })).toEqual({ "ingredient:a": { a: ["gluten", "milk"], r: true }, "prep:p": { add: ["fish"], rem: [] } });
    expect(sameTicks({ "ingredient:a": { a: ["gluten"], r: true } }, { "ingredient:a": { a: ["gluten"], r: true } })).toBe(true);
    expect(sameTicks({ "ingredient:a": { a: ["gluten"], r: true } }, { "ingredient:a": { a: ["gluten"], r: false } })).toBe(false);
    expect(sameTicks({ "ingredient:a": { a: [], r: true } }, { "ingredient:a": { a: [], r: true }, "ingredient:b": { a: [], r: true } })).toBe(false);
  });
});

describe("the re-check rule: a sign-off is valid only while the components AND the ticks are the same", () => {
  const ingredients = [ing("i1", ["milk"]), ing("i2", []), ing("i3", ["gluten"])];
  const lines = [line("d", "item", "i1"), line("d", "item", "i2"), line("d", "item", "p1", "prep"), line("p1", "prep", "i3")];
  const preps = [prep("p1")];
  const m0 = item();
  const idx0 = indexOf(m0, ingredients, preps, lines);
  const signed = confirmedItem(m0, idx0);
  const stateOf = (m: MenuItem, index: AllergenIndex) => signOffState(readDishAllergens(m.dish_allergens), liveCheck(m, index));

  it("is valid when nothing changed, and an amount-only or order-only change does not invalidate", () => {
    expect(stateOf(signed, indexOf(signed, ingredients, preps, lines))).toBe("valid");
    expect(stateOf(signed, indexOf(signed, ingredients, preps, lines.map((l) => ({ ...l, qty: l.qty * 3 }))))).toBe("valid");
    expect(stateOf(signed, indexOf(signed, ingredients, preps, [...lines].reverse()))).toBe("valid");
  });
  it("swapping, adding or removing a component invalidates", () => {
    const ix = (ls: RecipeLine[]) => indexOf(signed, ingredients, preps, ls);
    expect(stateOf(signed, ix(lines.map((l) => (l.component_id === "i2" ? { ...l, component_id: "i1" } : l))))).toBe("changed");
    expect(stateOf(signed, ix([...lines, line("d", "item", "i9")]))).toBe("changed");
    expect(stateOf(signed, ix(lines.filter((l) => l.component_id !== "i1")))).toBe("changed");
  });
  it("a change inside a nested prep invalidates the dish that uses it", () => {
    expect(stateOf(signed, indexOf(signed, ingredients, preps, [...lines, line("p1", "prep", "i-new")]))).toBe("changed");
    expect(stateOf(signed, indexOf(signed, [...ingredients, ing("i4")], preps, lines.map((l) => (l.component_id === "i3" ? { ...l, component_id: "i4" } : l))))).toBe("changed");
  });
  it("changing an ingredient's allergen ticks invalidates, even with the same components", () => {
    expect(stateOf(signed, indexOf(signed, [ing("i1", ["milk", "egg"]), ing("i2"), ing("i3", ["gluten"])], preps, lines))).toBe("changed");
    expect(stateOf(signed, indexOf(signed, [ing("i1", []), ing("i2"), ing("i3", ["gluten"])], preps, lines))).toBe("changed");
  });
  it("flipping an ingredient's reviewed flag invalidates, even when its ticks are the same", () => {
    expect(stateOf(signed, indexOf(signed, [ing("i1", ["milk"], false), ing("i2"), ing("i3", ["gluten"])], preps, lines))).toBe("changed");
  });
  it("changing a prep's allergen override invalidates", () => {
    expect(stateOf(signed, indexOf(signed, ingredients, [prep("p1", { allergen_add: ["fish"] })], lines))).toBe("changed");
    expect(stateOf(signed, indexOf(signed, ingredients, [prep("p1", { allergen_remove: ["gluten"] })], lines))).toBe("changed");
  });
  it("changing the dish's own allergen override invalidates", () => {
    const edited = { ...signed, allergen_add: ["lupin"] } as MenuItem;
    expect(stateOf(edited, indexOf(edited, ingredients, preps, lines))).toBe("changed");
  });
  it("swapping it all back makes it valid again (the sign-off is never deleted)", () => {
    const away = indexOf(signed, [ing("i1", ["milk", "egg"]), ing("i2"), ing("i3", ["gluten"])], preps, lines);
    expect(stateOf(signed, away)).toBe("changed");
    expect(stateOf(signed, indexOf(signed, ingredients, preps, lines))).toBe("valid");
  });
  it("a sign-off with no ticks (made before the ticks rule) is legacy, and so is one with no components", () => {
    const noTicks = readDishAllergens({ contains: ["milk"], without: {}, confirmed_at: NOW, confirmed_by: "chef@example.com", components: liveCheck(m0, idx0).components });
    expect(noTicks?.ticks).toBeNull();
    expect(signOffState(noTicks, liveCheck(m0, idx0))).toBe("legacy");
    const noComponents = readDishAllergens({ contains: [], without: {}, confirmed_at: NOW, ticks: liveCheck(m0, idx0).ticks });
    expect(signOffState(noComponents, liveCheck(m0, idx0))).toBe("legacy");
    expect(isSignOffValid(noTicks, liveCheck(m0, idx0))).toBe(false);
    expect(staleSignOffText("legacy", "10 Oct 2026")).toContain("before ingredient changes were tracked");
  });
  it("never signed off is never valid", () => {
    expect(signOffState(null, liveCheck(m0, idx0))).toBe("never");
    expect(signOffState(readDishAllergens({ contains: ["milk"], without: {} }), liveCheck(m0, idx0))).toBe("never");
  });
  it("a dish with no ingredients can be signed off and stays valid until one is added", () => {
    const empty = item();
    const e = indexOf(empty, [], [], []);
    const s = confirmedItem(empty, e);
    expect(stateOf(s, e)).toBe("valid");
    expect(stateOf(s, indexOf(s, [ing("i1")], [], [line("d", "item", "i1")]))).toBe("changed");
  });
  it("the sign-off is not deleted when it stops being valid, it just stops counting; the lists stay", () => {
    const da = readDishAllergens(signed.dish_allergens)!;
    const away = liveCheck(m0, indexOf(m0, ingredients, preps, [...lines, line("d", "item", "i9")]));
    const eff = effectiveAllergens(da, away)!;
    expect(eff.confirmedAt).toBeNull();
    expect(eff.confirmedBy).toBeNull();
    expect(eff.contains).toEqual(["gluten", "milk"]);
    expect(da.confirmedAt).toBe(NOW);
    expect(effectiveAllergens(da, liveCheck(m0, idx0))).toBe(da);
    expect(effectiveAllergens(null, liveCheck(m0, idx0))).toBeNull();
  });
  it("says in words that ingredients changed, with the date", () => {
    expect(staleSignOffText("changed", "10 Oct 2026")).toBe("Ingredients changed since 10 Oct 2026. Re-check and confirm again.");
    expect(staleSignOffText("valid", "10 Oct 2026")).toBeNull();
    expect(staleSignOffText("never", "")).toBeNull();
  });
  it("compares components as sets: order and repeats never matter", () => {
    expect(sameComponents(["a", "b"], ["b", "a", "a"])).toBe(true);
    expect(sameComponents(["a"], ["a", "b"])).toBe(false);
  });
});

describe("what Confirm stores", () => {
  const m = item();
  const idx = indexOf(m, [ing("flour", ["gluten"]), ing("cream", ["milk"])], [prep("p1")], [line("d", "item", "flour"), line("d", "item", "p1", "prep"), line("p1", "prep", "cream")]);
  const c = dishCheck(m, idx);
  it("derived union extras as contains, plus basis, extras, components and the ticks snapshot, with the signer and time", () => {
    const withExtra = addExtra(null, "sesame", c.derived).next;
    const stored = confirmAllergens(withExtra, "chef@example.com", NOW, { derived: c.derived, components: c.live.components, ticks: c.live.ticks });
    expect(stored).toMatchObject({
      contains: ["gluten", "milk", "sesame"],
      added: ["sesame"],
      basis: ["gluten", "milk"],
      confirmed_at: NOW,
      confirmed_by: "chef@example.com",
      components: ["ingredient:cream", "ingredient:flour", "prep:p1"],
    });
    expect(stored.ticks).toEqual(c.live.ticks);
    expect(stored).not.toHaveProperty("needs_signoff");
  });
  it("clears the new-dish lock", () => {
    const stored = confirmAllergens(newDishAllergens(), "chef@example.com", NOW, { derived: c.derived, components: c.live.components, ticks: c.live.ticks });
    expect(readDishAllergens(stored)?.needsSignoff).toBe(false);
  });
  it("after confirming from the live check the dish is valid", () => {
    const signed = { ...m, dish_allergens: confirmAllergens(null, null, NOW, { derived: c.derived, components: c.live.components, ticks: c.live.ticks }) };
    expect(signOffState(readDishAllergens(signed.dish_allergens), liveCheck(signed, indexOf(signed, [ing("flour", ["gluten"]), ing("cream", ["milk"])], [prep("p1")], [line("d", "item", "flour"), line("d", "item", "p1", "prep"), line("p1", "prep", "cream")])))).toBe("valid");
  });
  it("any edit that clears the sign-off clears the stored components, ticks and basis too", () => {
    const signed = confirmAllergens(null, "chef@example.com", NOW, { derived: c.derived, components: c.live.components, ticks: c.live.ticks });
    for (const r of [addExtra(signed, "fish", c.derived), setWithoutNote(signed, "milk", "no cheese", c.derived)]) {
      expect(r.clearedConfirmation).toBe(true);
      for (const k of ["components", "confirmed_at", "ticks", "basis"]) expect(r.next).not.toHaveProperty(k);
    }
  });
  it("a duplicate loses the sign-off, the components, the ticks and the basis", () => {
    const signed = confirmAllergens(addExtra(null, "fish", c.derived).next, "chef@example.com", NOW, { derived: c.derived, components: c.live.components, ticks: c.live.ticks });
    expect(unconfirmedCopy(signed)).toEqual({ contains: ["gluten", "fish", "milk"], without: {}, added: ["fish"] });
  });
  it("reads a malformed components or ticks value as none", () => {
    expect(readDishAllergens({ contains: [], confirmed_at: NOW, components: "ingredient:i1" })?.components).toBeNull();
    expect(readDishAllergens({ contains: [], confirmed_at: NOW, components: [1, "ingredient:i1", ""] })?.components).toEqual(["ingredient:i1"]);
    expect(readDishAllergens({ contains: [], confirmed_at: NOW, ticks: "x" })?.ticks).toBeNull();
  });
});

describe("the fresh check Review mode and the store make before they write", () => {
  const m = item();
  const ingredients = [ing("flour", ["gluten"]), ing("cream", ["milk"])];
  const lines = [line("d", "item", "flour"), line("d", "item", "cream")];
  const shown = dishCheck(m, indexOf(m, ingredients, [], lines));
  const verdict = (fresh: DishCheck) => confirmVerdict(fresh, { derived: shown.derived, ticks: shown.live.ticks });

  it("goes ahead when what the ingredients give is what the screen showed", () => {
    expect(verdict(dishCheck(m, indexOf(m, ingredients, [], lines)))).toBe("ok");
  });
  it("refuses when the fresh dish has an unreviewed ingredient", () => {
    expect(verdict(dishCheck(m, indexOf(m, [ing("flour", ["gluten"], false), ing("cream", ["milk"])], [], lines)))).toBe("unreviewed");
  });
  it("refuses when the derived allergens moved underneath", () => {
    expect(verdict(dishCheck(m, indexOf(m, [ing("flour", ["gluten", "egg"]), ing("cream", ["milk"])], [], lines)))).toBe("changed");
  });
  it("refuses when only a tick that does not change the derived list moved (the snapshot differs)", () => {
    const withOverride = item({ allergen_remove: ["fish"] });
    expect(verdict(dishCheck(withOverride, indexOf(withOverride, ingredients, [], lines)))).toBe("changed");
  });
});

describe("the matrix reads the rule through the store adapter", () => {
  const ingredients = [ing("i1", ["milk"]), ing("i2"), ing("i3")];
  it("a valid sign-off shows the dish's real answers; a nested prep change greys every allergen cell, and says why", () => {
    const lines = [line("d", "item", "i1"), line("d", "item", "p1", "prep"), line("p1", "prep", "i2")];
    const m0 = item();
    const m = confirmedItem(m0, indexOf(m0, ingredients, [prep("p1")], lines));
    const ok = buildRows([matrixDishFromItem(m, indexOf(m, ingredients, [prep("p1")], lines))])[0];
    expect(ok.signOff).toBe("valid");
    expect(ok.cells.dairy.state).toBe("red");
    expect(ok.cells.eggs.state).toBe("green");
    const after = [...lines, line("p1", "prep", "i3")];
    const stale = buildRows([matrixDishFromItem(m, indexOf(m, ingredients, [prep("p1")], after))])[0];
    expect(stale.signOff).toBe("changed");
    expect(stale.confirmed).toBe(false);
    expect(stale.cells.dairy.state).toBe("grey");
    expect(stale.cells.eggs.state).toBe("grey");
    expect(stale.dish.signedAt).toBe(NOW);
  });
  it("a legacy sign-off greys the dish (no components or no ticks)", () => {
    const m = item({ dish_allergens: { contains: [], without: {}, confirmed_at: NOW, confirmed_by: "chef@example.com" } });
    const row = buildRows([matrixDishFromItem(m, indexOf(m, ingredients, [], [line("d", "item", "i1")]))])[0];
    expect(row.signOff).toBe("legacy");
    expect(row.cells.dairy.state).toBe("grey");
  });
});

describe("new dishes start off the menu and locked until their allergens are confirmed", () => {
  const BASIS = { derived: [], components: ["ingredient:i1"], ticks: {} };
  it("a new food dish is inactive with the lock marker, and nothing added", () => {
    expect(newDishAllergens()).toEqual({ contains: [], without: {}, needs_signoff: true });
    expect(newDishPatch("Food", null, true)).toEqual({ active: false, dish_allergens: { contains: [], without: {}, needs_signoff: true } });
  });
  it("a copy of a food dish keeps the lists, loses the sign-off, and is locked", () => {
    const signed = confirmAllergens(setWithoutNote(addExtra(null, "milk", []).next, "milk", "no cheese", []).next, "chef@example.com", NOW, BASIS);
    expect(newDishPatch("Food", signed, true)).toEqual({ active: false, dish_allergens: { contains: ["milk"], without: { milk: "no cheese" }, added: ["milk"], needs_signoff: true } });
    expect(newDishCopy(signed)).toEqual({ contains: ["milk"], without: { milk: "no cheese" }, added: ["milk"], needs_signoff: true });
  });
  it("without the dish_allergens column the dish still starts inactive, but no lock can be saved", () => {
    expect(newDishPatch("Food", null, false)).toEqual({ active: false });
  });
  it("drinks, preps and the rest are untouched: no inactive start, no lock", () => {
    expect(newDishPatch("Cocktail", null, true)).toEqual({});
    expect(newDishPatch("Wine", undefined, true)).toEqual({});
    expect(newDishPatch("Cocktail", { contains: ["milk"], without: {}, confirmed_at: NOW }, true)).toEqual({ dish_allergens: { contains: ["milk"], without: {} } });
  });
  it("the Active switch is locked with a plain reason until a valid sign-off exists, then works as normal", () => {
    const fresh = readDishAllergens(newDishAllergens());
    expect(activeLockedReason(fresh, "never")).toBe(NEW_DISH_LOCK_REASON);
    expect(NEW_DISH_LOCK_REASON).toBe("Confirm the allergens first");
    expect(activeLockedReason(fresh, "changed")).toBe(NEW_DISH_LOCK_REASON);
    expect(activeLockedReason(fresh, "valid")).toBeNull();
    const signed = readDishAllergens(confirmAllergens(newDishAllergens(), "chef@example.com", NOW, BASIS));
    expect(signed?.needsSignoff).toBe(false);
    expect(activeLockedReason(signed, "changed")).toBeNull();
  });
  it("existing dishes (no marker) are never locked", () => {
    expect(activeLockedReason(readDishAllergens({ contains: [], without: {} }), "never")).toBeNull();
    expect(activeLockedReason(null, "never")).toBeNull();
  });
  it("adding an extra to a new dish keeps the marker until it is signed off", () => {
    const r = addExtra(newDishAllergens(), "milk", []);
    expect(r.next).toEqual({ contains: ["milk"], without: {}, added: ["milk"], needs_signoff: true });
  });
});

describe("the source list ('Where These Come From')", () => {
  const cells = (over: Record<string, { state: string; sources: string[] }>) => ({ cells: over }) as never;
  it("names the ingredient behind each allergen in the fixed order, an override as Chef override, and extras as added by hand", () => {
    const lines = sourceLines(cells({ nitrites: { state: "contains", sources: ["Bacon"] }, gluten: { state: "contains", sources: ["Brioche", "Flour"] }, fish: { state: "contains", sources: ["Chef"] } }), ["gluten", "fish", "nitrites"], ["sesame"]);
    expect(lines.map((l) => `${l.label} · ${l.text}`)).toEqual(["Gluten · Brioche, Flour", "Fish · Chef override", "Seeds · Added by hand", "Nitrites · Bacon"]);
    expect(lines.find((l) => l.id === "sesame")?.extra).toBe(true);
  });
  it("is empty when the dish contains nothing", () => {
    expect(sourceLines(cells({}), [], [])).toEqual([]);
  });
});
