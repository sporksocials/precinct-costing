import { describe, expect, it } from "vitest";
import {
  COMPONENT_DEPTH,
  NEW_DISH_LOCK_REASON,
  activeLockedReason,
  chipHint,
  confirmAllergens,
  currentComponents,
  effectiveAllergens,
  isSignOffValid,
  newDishAllergens,
  newDishCopy,
  newDishPatch,
  readDishAllergens,
  sameComponents,
  signOffState,
  staleSignOffText,
  toggleAllergen,
  unconfirmedCopy,
  applyProposal,
  setWithoutNote,
} from "@/lib/dish-allergens";
import { buildRows } from "@/lib/allergy-matrix";
import { matrixDishFromItem } from "@/lib/allergy-matrix-store";
import { buildIndex } from "@/lib/costing";
import type { AllergenIndex } from "@/lib/allergens";
import type { Ingredient, MenuItem, Prep, RecipeLine } from "@/lib/types";

const NOW = "2026-10-10T03:00:00.000Z";

let n = 0;
const line = (parent: string, type: "item" | "prep", comp: string, ctype: "ingredient" | "prep" = "ingredient", qty = 10): RecipeLine => {
  n += 1;
  return { id: `l${n}`, parent_type: type, parent_id: parent, component_type: ctype, component_id: comp, qty, unit: "g", note: null, sort: n };
};
const byParent = (lines: RecipeLine[]) => buildIndex([], [], lines).linesByParent;

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
    // a chain d > p1 > p2 > ... > p12, each with an ingredient: only the first levels are read
    const lines: RecipeLine[] = [line("d", "item", "p1", "prep")];
    for (let k = 1; k <= 12; k++) {
      lines.push(line(`p${k}`, "prep", `i${k}`));
      lines.push(line(`p${k}`, "prep", `p${k + 1}`, "prep"));
    }
    const c = currentComponents("item", "d", byParent(lines));
    expect(c).toContain("ingredient:i1");
    expect(c).toContain("ingredient:i8"); // p8's lines are level 8, the deepest level read
    expect(c).toContain("prep:p9"); // named by p8's lines, but not opened
    expect(c).not.toContain("ingredient:i9");
  });
  it("works for a prep as the starting point (the impact-first check)", () => {
    const m = byParent([line("p1", "prep", "i1"), line("p1", "prep", "p2", "prep"), line("p2", "prep", "i2")]);
    expect(currentComponents("prep", "p1", m)).toEqual(["ingredient:i1", "ingredient:i2", "prep:p2"]);
  });
});

describe("the re-check rule: a sign-off is valid only while the components are the same", () => {
  const lines = [line("d", "item", "i1"), line("d", "item", "i2"), line("d", "item", "p1", "prep"), line("p1", "prep", "i3")];
  const signed = (comps: string[]) => readDishAllergens(confirmAllergens(toggleAllergen(null, "milk", true).next, "chef@example.com", NOW, comps));
  const base = currentComponents("item", "d", byParent(lines));

  it("is valid when nothing about the components changed", () => {
    const da = signed(base);
    expect(signOffState(da, base)).toBe("valid");
    expect(isSignOffValid(da, base)).toBe(true);
  });
  it("an amount-only change does not invalidate", () => {
    const changedAmounts = lines.map((l) => ({ ...l, qty: l.qty * 3 }));
    expect(signOffState(signed(base), currentComponents("item", "d", byParent(changedAmounts)))).toBe("valid");
  });
  it("reordering lines does not invalidate", () => {
    expect(signOffState(signed(base), currentComponents("item", "d", byParent([...lines].reverse())))).toBe("valid");
  });
  it("swapping an ingredient invalidates", () => {
    const swapped = lines.map((l) => (l.component_id === "i2" ? { ...l, component_id: "i9" } : l));
    expect(signOffState(signed(base), currentComponents("item", "d", byParent(swapped)))).toBe("changed");
  });
  it("adding an ingredient invalidates", () => {
    expect(signOffState(signed(base), currentComponents("item", "d", byParent([...lines, line("d", "item", "i7")])))).toBe("changed");
  });
  it("removing an ingredient invalidates", () => {
    expect(signOffState(signed(base), currentComponents("item", "d", byParent(lines.filter((l) => l.component_id !== "i1"))))).toBe("changed");
  });
  it("a change inside a nested prep invalidates the dish that uses it", () => {
    const deeper = [...lines, line("p1", "prep", "i-new")];
    expect(signOffState(signed(base), currentComponents("item", "d", byParent(deeper)))).toBe("changed");
    const swappedInside = lines.map((l) => (l.component_id === "i3" ? { ...l, component_id: "i4" } : l));
    expect(signOffState(signed(base), currentComponents("item", "d", byParent(swappedInside)))).toBe("changed");
  });
  it("a sign-off made before the rule (no components key) is NOT valid, and says so", () => {
    const legacy = readDishAllergens({ contains: ["milk"], without: {}, confirmed_at: NOW, confirmed_by: "chef@example.com" });
    expect(legacy?.components).toBeNull();
    expect(signOffState(legacy, base)).toBe("legacy");
    expect(isSignOffValid(legacy, base)).toBe(false);
    expect(staleSignOffText("legacy", "10 Oct 2026")).toContain("before ingredient changes were tracked");
  });
  it("never signed off is never valid", () => {
    expect(signOffState(null, [])).toBe("never");
    expect(signOffState(readDishAllergens({ contains: ["milk"], without: {} }), [])).toBe("never");
  });
  it("a dish with no ingredients can be signed off and stays valid until one is added", () => {
    expect(signOffState(signed([]), [])).toBe("valid");
    expect(signOffState(signed([]), ["ingredient:i1"])).toBe("changed");
  });
  it("the sign-off is not deleted when it stops being valid, it just stops counting; the lists stay", () => {
    const da = signed(base)!;
    const eff = effectiveAllergens(da, ["ingredient:other"])!;
    expect(eff.confirmedAt).toBeNull();
    expect(eff.confirmedBy).toBeNull();
    expect(eff.contains).toEqual(["milk"]);
    expect(da.confirmedAt).toBe(NOW); // the stored section is untouched
    expect(effectiveAllergens(da, base)).toBe(da);
    expect(effectiveAllergens(null, base)).toBeNull();
  });
  it("says in words that ingredients changed, with the date", () => {
    expect(staleSignOffText("changed", "10 Oct 2026")).toBe("Ingredients changed since 10 Oct 2026. Re-check and confirm again.");
    expect(staleSignOffText("valid", "10 Oct 2026")).toBeNull();
    expect(staleSignOffText("never", "")).toBeNull();
  });
  it("compares as sets: order and repeats never matter", () => {
    expect(sameComponents(["a", "b"], ["b", "a", "a"])).toBe(true);
    expect(sameComponents(["a"], ["a", "b"])).toBe(false);
  });
});

describe("what is stored", () => {
  it("Confirm stores the sorted unique components with the sign-off", () => {
    const e = confirmAllergens(null, "chef@example.com", NOW, ["prep:p1", "ingredient:i2", "ingredient:i2", "ingredient:i1"]);
    expect(e.components).toEqual(["ingredient:i1", "ingredient:i2", "prep:p1"]);
    expect(e.confirmed_at).toBe(NOW);
  });
  it("any edit that clears the sign-off clears the stored components too", () => {
    const signed = confirmAllergens(toggleAllergen(null, "milk", true).next, "chef@example.com", NOW, ["ingredient:i1"]);
    for (const r of [toggleAllergen(signed, "egg", true), setWithoutNote(signed, "milk", "no cheese"), applyProposal(signed, ["gluten"])]) {
      expect(r.clearedConfirmation).toBe(true);
      expect(r.next).not.toHaveProperty("components");
      expect(r.next).not.toHaveProperty("confirmed_at");
    }
  });
  it("an edit that changes nothing keeps both the sign-off and its components", () => {
    const signed = confirmAllergens(toggleAllergen(null, "milk", true).next, "chef@example.com", NOW, ["ingredient:i1"]);
    expect(toggleAllergen(signed, "milk", true).next).toEqual(signed);
  });
  it("a duplicate loses the sign-off and the components", () => {
    const signed = confirmAllergens(toggleAllergen(null, "milk", true).next, "chef@example.com", NOW, ["ingredient:i1"]);
    expect(unconfirmedCopy(signed)).toEqual({ contains: ["milk"], without: {} });
  });
  it("reads a malformed components value as none", () => {
    expect(readDishAllergens({ contains: [], confirmed_at: NOW, components: "ingredient:i1" })?.components).toBeNull();
    expect(readDishAllergens({ contains: [], confirmed_at: NOW, components: [1, "ingredient:i1", ""] })?.components).toEqual(["ingredient:i1"]);
  });
});

describe("the matrix reads the rule through the store adapter", () => {
  const ing = (id: string): Ingredient => ({ id, name: id, category: "Food", supplier_id: null, supplier_code: null, pack_size: 1, pack_unit: "kg", pack_price: 1, price_inc_gst: false, gst_free: false, rebate: 0, yield_pct: 1, venues: "All", active: true, last_price_update: null, previous_price: null, source: null, notes: null, updated_at: null, allergens: [], allergens_reviewed: true, diet_flags: [] }) as Ingredient;
  const prep = (id: string): Prep => ({ id, name: id, venue_id: 1, prep_type: null, yield_qty: 1, yield_unit: "kg", active: true, source: null, notes: null }) as Prep;
  const item = (over: Partial<MenuItem>): MenuItem => ({ id: "d", name: "Dish", venue_id: 1, category: "Food", section: "Mains", portions: 1, sell_price_inc: 20, target_override: null, hh_price_inc: null, active: true, source: null, notes: null, ...over });
  const idx = (lines: RecipeLine[], m: MenuItem): AllergenIndex => ({ ...buildIndex([ing("i1"), ing("i2"), ing("i3")], [prep("p1")], lines), items: new Map([[m.id, m]]) });

  it("a valid sign-off shows the dish's real answers; a nested prep change greys every allergen cell, and says why", () => {
    const lines = [line("d", "item", "i1"), line("d", "item", "p1", "prep"), line("p1", "prep", "i2")];
    const comps = currentComponents("item", "d", byParent(lines));
    const m = item({ dish_allergens: confirmAllergens({ contains: [], without: {} }, "chef@example.com", NOW, comps) });
    const ok = buildRows([matrixDishFromItem(m, idx(lines, m))])[0];
    expect(ok.signOff).toBe("valid");
    expect(ok.cells.dairy.state).toBe("green");
    const after = [...lines, line("p1", "prep", "i3")];
    const stale = buildRows([matrixDishFromItem(m, idx(after, m))])[0];
    expect(stale.signOff).toBe("changed");
    expect(stale.confirmed).toBe(false);
    expect(stale.cells.dairy.state).toBe("grey");
    expect(stale.cells.eggs.state).toBe("grey");
    expect(stale.dish.signedAt).toBe(NOW);
  });
  it("a legacy sign-off greys the dish (there are no signed dishes yet, so nothing is lost)", () => {
    const m = item({ dish_allergens: { contains: [], without: {}, confirmed_at: NOW, confirmed_by: "chef@example.com" } });
    const row = buildRows([matrixDishFromItem(m, idx([line("d", "item", "i1")], m))])[0];
    expect(row.signOff).toBe("legacy");
    expect(row.cells.dairy.state).toBe("grey");
  });
});

describe("new dishes start off the menu and locked until their allergens are confirmed", () => {
  it("a new food dish is inactive with the lock marker, and nothing ticked", () => {
    expect(newDishAllergens()).toEqual({ contains: [], without: {}, needs_signoff: true });
    expect(newDishPatch("Food", null, true)).toEqual({ active: false, dish_allergens: { contains: [], without: {}, needs_signoff: true } });
  });
  it("a copy of a food dish keeps the lists, loses the sign-off, and is locked", () => {
    const signed = confirmAllergens(setWithoutNote(toggleAllergen(null, "milk", true).next, "milk", "no cheese").next, "chef@example.com", NOW, ["ingredient:i1"]);
    expect(newDishPatch("Food", signed, true)).toEqual({ active: false, dish_allergens: { contains: ["milk"], without: { milk: "no cheese" }, needs_signoff: true } });
    expect(newDishCopy(signed)).toEqual({ contains: ["milk"], without: { milk: "no cheese" }, needs_signoff: true });
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
    const signed = readDishAllergens(confirmAllergens(newDishAllergens(), "chef@example.com", NOW, []));
    expect(signed?.needsSignoff).toBe(false); // confirming clears the marker, so the switch stays free from then on
    expect(activeLockedReason(signed, "changed")).toBeNull(); // an already active dish that loses its sign-off is NOT locked off the menu
  });
  it("existing dishes (no marker) are never locked", () => {
    expect(activeLockedReason(readDishAllergens({ contains: [], without: {} }), "never")).toBeNull();
    expect(activeLockedReason(null, "never")).toBeNull();
  });
  it("ticking allergens on a new dish keeps the marker until it is signed off", () => {
    const r = toggleAllergen(newDishAllergens(), "milk", true);
    expect(r.next).toEqual({ contains: ["milk"], without: {}, needs_signoff: true });
  });
});

describe("hints under the chips only name the ingredients, in words", () => {
  const cells = (state: "contains" | "may_contain" | "none", sources: string[]) => ({ cells: { soy: { state, sources, chef: null, was: [], note: null } } as never });
  it("says ticked on for a confirmed tick and name suggests for a keyword guess", () => {
    expect(chipHint(cells("contains", ["Soy Sauce"]), "soy")).toBe("ticked on: Soy Sauce");
    expect(chipHint(cells("may_contain", ["Soy Sauce", "Tofu"]), "soy")).toBe("name suggests: Soy Sauce, Tofu");
    expect(chipHint(cells("none", []), "soy")).toBeNull();
    expect(chipHint(cells("contains", ["Chef"]), "soy")).toBeNull();
  });
});

describe("chipHintLines (Where These Come From)", () => {
  const cells = (state: "contains" | "may_contain" | "none", sources: string[]) => ({ cells: { soy: { state, sources }, egg: { state: "may_contain", sources: ["Eggs (Each)", "Hollandaise", "Chef"] } } }) as never;
  it("says ticked for a confirmed tick and that nobody has checked for a name guess, in allergen order", async () => {
    const { chipHintLines } = await import("@/lib/dish-allergens");
    const lines = chipHintLines(cells("contains", ["Soy Sauce"]), ["egg", "soy", "milk"] as never);
    expect(lines.map((l) => l.id)).toEqual(["egg", "soy"]);
    expect(lines[0].sure).toBe(false);
    expect(lines[0].text).toBe("The ingredient name suggests it: Eggs (Each), Hollandaise. Nobody has checked it yet.");
    expect(lines[1]).toMatchObject({ sure: true, text: "Ticked on the ingredient Soy Sauce." });
  });
  it("is empty when nothing points at an allergen", async () => {
    const { chipHintLines } = await import("@/lib/dish-allergens");
    expect(chipHintLines({ cells: {} } as never, ["soy"] as never)).toEqual([]);
  });
});
