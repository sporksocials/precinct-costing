import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  GUEST_GROUPS,
  MATRIX_COLUMNS,
  SEE_CHEF,
  buildRow,
  buildRows,
  cell,
  guestNeeds,
  instruction,
  matrixProgress,
  matrixSections,
  progressLine,
  signedOffDate,
  uncolumnedContains,
  type MatrixColumnId,
  type MatrixDish,
} from "@/lib/allergy-matrix";
import {
  MATRIX_PRINT_CSS,
  CHARS_PER_LINE,
  MIN_BODY_PT,
  PAGE_ROW_BUDGET_MM,
  buildMatrixSheets,
  estimateRowMm,
  matrixPrintHref,
  paginate,
  pickSections,
  printedDate,
  printedLine,
} from "@/lib/allergy-matrix-print";
import { matrixDishFromItem, matrixDishesForVenue, optionWordsFor } from "@/lib/allergy-matrix-store";
import { rollup, type AllergenId, type AllergenIndex } from "@/lib/allergens";
import { DISH_ALLERGEN_IDS, applyProposal, confirmAllergens, describeDishAllergens, isConfirmed, proposeContains, readDishAllergens, reviewMissing, reviewWarningText, setWithoutNote, toStored, toggleAllergen, unconfirmedCopy } from "@/lib/dish-allergens";
import { buildIndex } from "@/lib/costing";
import { fieldLabel, patchOf } from "@/lib/draft-changes";
import { threeWay } from "@/lib/edit-conflict";
import { buildConflictView } from "@/lib/conflict-view";
import { fmtField } from "@/lib/change-history";
import { showValue } from "@/lib/undo-change";
import type { Ingredient, MenuItem, Prep, RecipeLine } from "@/lib/types";

const NOW = "2026-10-10T03:00:00.000Z";

/** a dish whose allergens section is signed off */
function dish(over: Partial<MatrixDish> & { contains?: AllergenId[]; without?: Partial<Record<AllergenId, string>>; signed?: boolean | null } = {}): MatrixDish {
  const { contains = [], without = {}, signed = true, ...rest } = over;
  const allergens = signed === null ? null : { contains, without, confirmedAt: signed ? NOW : null, confirmedBy: signed ? "chef@example.com" : null };
  return { id: "d1", name: "Test Dish", section: "Mains", allergens, marks: [], options: {}, ...rest };
}
const state = (d: MatrixDish, c: MatrixColumnId) => cell(d, c).state;

describe("columns", () => {
  it("are Troy's nine in his order, then Sulphites and Nitrites", () => {
    expect(MATRIX_COLUMNS.map((c) => c.label)).toEqual(["Gluten Free", "Onion And Garlic", "Dairy", "Seafood", "Chilli", "Eggs", "Nuts And Seeds", "Vegetarian", "Vegan", "Sulphites", "Nitrites"]);
  });
  it("map the allergens as decided: dairy is milk, seafood is fish crustacea molluscs, nuts and seeds is peanuts tree nuts seeds", () => {
    const by = Object.fromEntries(MATRIX_COLUMNS.map((c) => [c.id, c.allergens]));
    expect(by.dairy).toEqual(["milk"]);
    expect(by.seafood).toEqual(["fish", "crustacea", "molluscs"]);
    expect(by.nuts_seeds).toEqual(["peanuts", "tree_nuts", "sesame"]);
    expect(by.eggs).toEqual(["egg"]);
    expect(by.gluten_free).toEqual(["gluten"]);
    expect(by.onion_garlic).toEqual(["onion_garlic"]);
    expect(by.sulphites).toEqual(["sulphites"]);
    expect(by.nitrites).toEqual(["nitrites"]);
    expect(by.chilli).toEqual(["chilli"]);
  });
});

describe("allergen columns", () => {
  it("are green when the signed-off dish does not list the allergen", () => {
    const d = dish({ contains: ["gluten"] });
    expect(state(d, "dairy")).toBe("green");
    expect(state(d, "chilli")).toBe("green");
    expect(cell(d, "dairy").why).toMatch(/not listed/);
  });
  it("are red when the dish lists it and has no way to make it without", () => {
    const d = dish({ contains: ["milk"] });
    expect(cell(d, "dairy")).toMatchObject({ state: "red" });
    expect(cell(d, "dairy").why).toBe("Contains Milk.");
  });
  it("are yellow, carrying the chef's note, when it can be made without", () => {
    const d = dish({ contains: ["milk"], without: { milk: "no aioli" } });
    expect(cell(d, "dairy")).toMatchObject({ state: "yellow", note: "no aioli" });
  });
  it("seafood: fish, crustacea and molluscs all land in the one column", () => {
    expect(state(dish({ contains: ["fish"] }), "seafood")).toBe("red");
    expect(state(dish({ contains: ["crustacea"] }), "seafood")).toBe("red");
    expect(state(dish({ contains: ["molluscs"] }), "seafood")).toBe("red");
    expect(state(dish({ contains: ["milk"] }), "seafood")).toBe("green");
  });
  it("a multi-allergen column is yellow only when EVERY allergen in it has a note, else red", () => {
    const both = dish({ contains: ["fish", "crustacea"], without: { fish: "no anchovy", crustacea: "no prawns" } });
    expect(cell(both, "seafood")).toMatchObject({ state: "yellow", note: "no anchovy; no prawns" });
    const one = dish({ contains: ["fish", "crustacea"], without: { fish: "no anchovy" } });
    expect(state(one, "seafood")).toBe("red");
  });
  it("nuts and seeds: peanuts, tree nuts and seeds (the id sesame) all count", () => {
    for (const id of ["peanuts", "tree_nuts", "sesame"] as const) expect(state(dish({ contains: [id] }), "nuts_seeds")).toBe("red");
    expect(state(dish({ contains: ["soy"] }), "nuts_seeds")).toBe("green");
    expect(cell(dish({ contains: ["sesame", "tree_nuts"], without: { sesame: "no seeds", tree_nuts: "no almonds" } }), "nuts_seeds").note).toBe("no almonds; no seeds");
  });
  it("identical notes are said once", () => {
    const d = dish({ contains: ["fish", "molluscs"], without: { fish: "no seafood topping", molluscs: "no seafood topping" } });
    expect(cell(d, "seafood").note).toBe("no seafood topping");
  });
  it("onion and garlic, chilli, eggs, sulphites and nitrites each read their own allergen", () => {
    const d = dish({ contains: ["onion_garlic", "chilli", "egg", "sulphites", "nitrites"] });
    for (const c of ["onion_garlic", "chilli", "eggs", "sulphites", "nitrites"] as const) expect(state(d, c)).toBe("red");
    expect(state(d, "dairy")).toBe("green");
  });
  it("a dairy dish with a Dairy Free Option and no note of its own is yellow with the option wording", () => {
    const d = dish({ contains: ["milk"], options: { dfo: "Leave out Butter. Add Olive Oil 10 ml. Use the dairy free bun." } });
    expect(cell(d, "dairy")).toMatchObject({ state: "yellow", note: "Leave out Butter. Add Olive Oil 10 ml. Use the dairy free bun." });
  });
  it("its own note wins over the Dairy Free Option wording", () => {
    const d = dish({ contains: ["milk"], without: { milk: "no cheese" }, options: { dfo: "Swap the butter" } });
    expect(cell(d, "dairy").note).toBe("no cheese");
  });
  it("a Dairy Free Option never softens any other allergen", () => {
    const d = dish({ contains: ["egg"], options: { dfo: "Swap the butter" } });
    expect(state(d, "eggs")).toBe("red");
  });
  it("an option with no words still turns the cell yellow and says See chef", () => {
    expect(cell(dish({ contains: ["milk"], options: { dfo: "" } }), "dairy")).toMatchObject({ state: "yellow", note: SEE_CHEF });
  });
  it("a note for an allergen the dish does not list changes nothing", () => {
    const d = dish({ contains: ["milk"], without: { egg: "no egg" } });
    expect(state(d, "eggs")).toBe("green");
  });
  it("an empty dish list signed off means green everywhere", () => {
    const d = dish({ contains: [] });
    for (const c of MATRIX_COLUMNS.filter((x) => x.kind === "allergen")) expect(state(d, c.id)).toBe("green");
  });
});

describe("not signed off", () => {
  it("every allergen column is grey, never green and never red", () => {
    for (const d of [dish({ signed: false, contains: ["milk"] }), dish({ signed: null }), dish({ signed: false, contains: [] })]) {
      for (const c of MATRIX_COLUMNS.filter((x) => x.kind === "allergen")) expect(cell(d, c.id)).toMatchObject({ state: "grey" });
    }
  });
  it("even a dish listing nothing is grey until somebody signs it off", () => {
    expect(state(dish({ signed: false, contains: [] }), "dairy")).toBe("grey");
  });
  it("a note and a Dairy Free Option do not make an unsigned dish yellow", () => {
    const d = dish({ signed: false, contains: ["milk"], without: { milk: "no cheese" }, options: { dfo: "Swap" } });
    expect(state(d, "dairy")).toBe("grey");
  });
  it("gluten free is grey with no mark and no option", () => {
    expect(state(dish({ signed: false }), "gluten_free")).toBe("grey");
    expect(state(dish({ signed: null }), "gluten_free")).toBe("grey");
  });
  it("hand-set marks and options still answer, because they are facts a person set", () => {
    expect(state(dish({ signed: false, marks: ["gf"] }), "gluten_free")).toBe("green");
    expect(cell(dish({ signed: false, options: { gfo: "Gluten free bun" } }), "gluten_free")).toMatchObject({ state: "yellow", note: "Gluten free bun" });
    expect(state(dish({ signed: null, marks: ["v"] }), "vegetarian")).toBe("green");
  });
});

describe("gluten free", () => {
  it("a GF mark is green", () => expect(state(dish({ contains: ["gluten"], marks: ["gf"] }), "gluten_free")).toBe("green"));
  it("a signed-off dish that does not list gluten is green", () => expect(state(dish({ contains: ["milk"] }), "gluten_free")).toBe("green"));
  it("a Gluten Free Option is yellow with its wording", () => {
    expect(cell(dish({ contains: ["gluten"], options: { gfo: "Leave out Brioche Bun. Add Gluten Free Bun 1." } }), "gluten_free")).toMatchObject({ state: "yellow", note: "Leave out Brioche Bun. Add Gluten Free Bun 1." });
  });
  it("a made-without note for gluten is yellow when there is no option", () => {
    expect(cell(dish({ contains: ["gluten"], without: { gluten: "GF base" } }), "gluten_free")).toMatchObject({ state: "yellow", note: "GF base" });
  });
  it("the option wording is used before the note", () => {
    expect(cell(dish({ contains: ["gluten"], without: { gluten: "GF base" }, options: { gfo: "Use the GF bun" } }), "gluten_free").note).toBe("Use the GF bun");
  });
  it("gluten with nothing to fix it is red", () => expect(state(dish({ contains: ["gluten"] }), "gluten_free")).toBe("red"));
});

describe("vegetarian and vegan come from marks and options only, and never go grey", () => {
  it("V and VG marks make vegetarian green; VG makes vegan green", () => {
    expect(state(dish({ marks: ["v"] }), "vegetarian")).toBe("green");
    expect(state(dish({ marks: ["vg"] }), "vegetarian")).toBe("green");
    expect(state(dish({ marks: ["v"] }), "vegan")).toBe("red");
    expect(state(dish({ marks: ["vg"] }), "vegan")).toBe("green");
  });
  it("options are yellow with their wording", () => {
    const d = dish({ options: { vo: "Hold the bacon", vgo: "Hold the bacon and the aioli" } });
    expect(cell(d, "vegetarian")).toMatchObject({ state: "yellow", note: "Hold the bacon" });
    expect(cell(d, "vegan")).toMatchObject({ state: "yellow", note: "Hold the bacon and the aioli" });
  });
  it("no mark and no option is red, even for an unsigned or missing allergens section", () => {
    for (const d of [dish(), dish({ signed: false }), dish({ signed: null })]) {
      expect(state(d, "vegetarian")).toBe("red");
      expect(state(d, "vegan")).toBe("red");
    }
  });
  it("is never worked out from the allergens a dish lists", () => {
    expect(state(dish({ contains: [] }), "vegetarian")).toBe("red");
    expect(state(dish({ contains: ["fish"], marks: ["vg"] }), "vegan")).toBe("green"); // the mark is the chef's word; the staff list warns about the clash
  });
});

describe("every yellow cell carries a note", () => {
  it("across a spread of dishes", () => {
    const dishes = [
      dish({ contains: ["milk"], without: { milk: "no cheese" } }),
      dish({ contains: ["milk"], options: { dfo: "" } }),
      dish({ contains: ["gluten"], options: { gfo: "" } }),
      dish({ options: { vo: "", vgo: "" } }),
    ];
    for (const d of dishes) for (const c of MATRIX_COLUMNS) {
      const x = cell(d, c.id);
      if (x.state === "yellow") expect((x.note ?? "").trim().length).toBeGreaterThan(0);
      else expect(x.note).toBeUndefined();
    }
  });
});

describe("rows, warnings and review", () => {
  it("a row has a cell for every column and says whether the dish is signed off", () => {
    const r = buildRow(dish({ contains: ["milk"] }));
    expect(Object.keys(r.cells).sort()).toEqual(MATRIX_COLUMNS.map((c) => c.id).sort());
    expect(r.confirmed).toBe(true);
    expect(buildRow(dish({ signed: false })).confirmed).toBe(false);
  });
  it("needsReview is carried for the staff view and changes no cell", () => {
    const a = buildRow(dish({ contains: ["milk"], needsReview: false }));
    const b = buildRow(dish({ contains: ["milk"], needsReview: true }));
    expect(b.needsReview).toBe(true);
    expect(b.cells).toEqual(a.cells);
  });
  it("warns, without changing a cell, when a mark disagrees with the dish's allergens", () => {
    expect(buildRow(dish({ contains: ["gluten"], marks: ["gf"] })).warnings[0]).toMatch(/Gluten Free/);
    expect(buildRow(dish({ contains: ["milk", "egg"], marks: ["vg"] })).warnings[0]).toMatch(/Milk, Egg/);
    expect(buildRow(dish({ contains: ["fish"], marks: ["v"] })).warnings[0]).toMatch(/Vegetarian/);
    expect(buildRow(dish({ contains: ["milk"], marks: ["v"] })).warnings).toEqual([]);
    expect(buildRow(dish({ signed: false, contains: ["gluten"], marks: ["gf"] })).warnings).toEqual([]);
  });
});

describe("sections, order and progress", () => {
  const rows = buildRows([
    dish({ id: "1", name: "Zesty Salad", section: "Bowls & Salads" }),
    dish({ id: "2", name: "Burger", section: "Burgers" }),
    dish({ id: "3", name: "Waffles", section: "Breakfast", signed: false }),
    dish({ id: "4", name: "Eggs On Toast", section: "Breakfast" }),
    dish({ id: "5", name: "Mystery", section: null, signed: false }),
    dish({ id: "6", name: "Aperitivo Board", section: "Aperitivo" }),
  ]);
  it("groups by section in the kitchen's menu order, unknown sections after, Other last, dishes by name", () => {
    const s = matrixSections(rows);
    expect(s.map((x) => x.label)).toEqual(["Breakfast", "Bowls & Salads", "Burgers", "Aperitivo", "Other"]);
    expect(s[0].rows.map((r) => r.dish.name)).toEqual(["Eggs On Toast", "Waffles"]);
  });
  it("counts progress and lists what needs confirming in menu order", () => {
    const p = matrixProgress(rows);
    expect(p).toMatchObject({ total: 6, confirmed: 4 });
    expect(p.needing.map((r) => r.dish.name)).toEqual(["Waffles", "Mystery"]);
    expect(progressLine(p)).toBe("4 of 6 dishes confirmed");
    expect(progressLine({ total: 1, confirmed: 1 })).toBe("1 of 1 dish confirmed");
  });
  it("lists signed-off dishes whose ingredients changed", () => {
    const p = matrixProgress(buildRows([dish({ id: "a", needsReview: true }), dish({ id: "b", signed: false, needsReview: true })]));
    expect(p.review.map((r) => r.dish.id)).toEqual(["a"]);
  });
});

describe("guest needs", () => {
  const rows = buildRows([
    dish({ id: "g", name: "Green Bowl", contains: [] }),
    dish({ id: "y", name: "Yellow Pasta", contains: ["milk"], without: { milk: "no parmesan" } }),
    dish({ id: "r", name: "Red Burger", contains: ["milk"] }),
    dish({ id: "u", name: "Unchecked Soup", signed: false }),
  ]);
  it("sorts every dish into Can Eat, Can Eat With Changes, Cannot Eat and Not Checked, keeping matrix order", () => {
    const n = guestNeeds(rows, "dairy");
    expect(n.column.label).toBe("Dairy");
    expect(n.green.map((e) => e.row.dish.name)).toEqual(["Green Bowl"]);
    expect(n.yellow.map((e) => [e.row.dish.name, e.cell.note])).toEqual([["Yellow Pasta", "no parmesan"]]);
    expect(n.red.map((e) => e.row.dish.name)).toEqual(["Red Burger"]);
    expect(n.grey.map((e) => e.row.dish.name)).toEqual(["Unchecked Soup"]);
    expect(GUEST_GROUPS.map((g) => g.title)).toEqual(["Can Eat", "Can Eat With Changes", "Cannot Eat", "Not Checked"]);
  });
  it("every dish lands in exactly one group", () => {
    for (const c of MATRIX_COLUMNS) {
      const n = guestNeeds(rows, c.id);
      expect(n.green.length + n.yellow.length + n.red.length + n.grey.length).toBe(rows.length);
    }
  });
  it("the plain instruction reads as an instruction", () => {
    expect(instruction(cell(dish({ contains: ["milk"], without: { milk: "no cheese" } }), "dairy"))).toBe("Only with a change: no cheese");
    expect(instruction(cell(dish({ contains: ["milk"] }), "dairy"))).toMatch(/^No\./);
    expect(instruction(cell(dish({ signed: false }), "dairy"))).toMatch(/^Not checked\. Ask the head chef/);
    expect(instruction(cell(dish({ contains: [] }), "dairy"))).toMatch(/^Yes\./);
  });
});

describe("soy and lupin have no column but are never hidden", () => {
  it("are reported for the detail card of a signed-off dish", () => {
    expect(uncolumnedContains(dish({ contains: ["soy", "lupin", "milk"] }).allergens)).toEqual(["soy", "lupin"]);
    expect(uncolumnedContains(dish({ signed: false, contains: ["soy"] }).allergens)).toEqual([]);
    expect(uncolumnedContains(null)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ the dish's own allergens section: editor rules */

describe("dish allergens: reading", () => {
  it("is tolerant: null, strings, arrays and junk read as no section", () => {
    for (const v of [null, undefined, "x", 3, [], [1, 2]]) expect(readDishAllergens(v)).toBeNull();
  });
  it("keeps only known allergens in the fixed order, notes only for ticked ones, and a valid sign-off time", () => {
    const da = readDishAllergens({ contains: ["milk", "gluten", "nope", "alcohol", 4, "milk"], without: { milk: "  no   cheese ", egg: "x", gluten: "" }, confirmed_at: NOW, confirmed_by: "a@b.c" })!;
    expect(da.contains).toEqual(["gluten", "milk"]);
    expect(da.without).toEqual({ milk: "no cheese" });
    expect(da.confirmedAt).toBe(NOW);
    expect(readDishAllergens({ contains: [], confirmed_at: "not a date" })!.confirmedAt).toBeNull();
    expect(isConfirmed(readDishAllergens({ contains: [] }))).toBe(false);
    expect(isConfirmed(null)).toBe(false);
  });
  it("offers the 15 main allergens and never alcohol", () => {
    expect(DISH_ALLERGEN_IDS).toHaveLength(15);
    expect(DISH_ALLERGEN_IDS).not.toContain("alcohol");
  });
  it("stores the sign-off keys only while signed off", () => {
    expect(toStored(readDishAllergens({ contains: ["milk"] })!)).toEqual({ contains: ["milk"], without: {} });
    expect(Object.keys(toStored(readDishAllergens({ contains: ["milk"], confirmed_at: NOW, confirmed_by: "a@b.c" })!)).sort()).toEqual(["confirmed_at", "confirmed_by", "contains", "without"]);
  });
});

describe("dish allergens: ticking, notes, confirming", () => {
  it("tapping starts a section, in the fixed order whatever the tap order", () => {
    let raw: unknown = null;
    for (const id of ["milk", "gluten", "egg"] as const) raw = toggleAllergen(raw, id, true).next;
    expect((raw as { contains: string[] }).contains).toEqual(["gluten", "egg", "milk"]);
  });
  it("unticking removes the allergen and its note", () => {
    let raw: unknown = toggleAllergen(null, "milk", true).next;
    raw = setWithoutNote(raw, "milk", "no cheese").next;
    expect(readDishAllergens(raw)!.without).toEqual({ milk: "no cheese" });
    raw = toggleAllergen(raw, "milk", false).next;
    expect(readDishAllergens(raw)).toMatchObject({ contains: [], without: {} });
  });
  it("a note only attaches to a ticked allergen, and empty text clears it", () => {
    expect(readDishAllergens(setWithoutNote(null, "milk", "no cheese").next)).toMatchObject({ contains: [], without: {} });
    let raw: unknown = toggleAllergen(null, "milk", true).next;
    raw = setWithoutNote(raw, "milk", "  no   cheese ").next;
    expect(readDishAllergens(raw)!.without.milk).toBe("no cheese");
    raw = setWithoutNote(raw, "milk", "   ").next;
    expect(readDishAllergens(raw)!.without).toEqual({});
  });
  it("Confirm stamps the time and the signed-in email", () => {
    const next = confirmAllergens(toggleAllergen(null, "milk", true).next, "chef@example.com", NOW);
    expect(next).toEqual({ contains: ["milk"], without: {}, confirmed_at: NOW, confirmed_by: "chef@example.com" });
    expect(isConfirmed(readDishAllergens(next))).toBe(true);
    expect(confirmAllergens(null, null, NOW)).toEqual({ contains: [], without: {}, confirmed_at: NOW });
  });
  it("ANY edit after confirmation clears it, and says so", () => {
    const signed = confirmAllergens(toggleAllergen(null, "milk", true).next, "chef@example.com", NOW);
    const tick = toggleAllergen(signed, "egg", true);
    expect(tick.clearedConfirmation).toBe(true);
    expect(isConfirmed(readDishAllergens(tick.next))).toBe(false);
    expect(tick.next).not.toHaveProperty("confirmed_at");
    const note = setWithoutNote(signed, "milk", "no cheese");
    expect(note.clearedConfirmation).toBe(true);
    expect(isConfirmed(readDishAllergens(note.next))).toBe(false);
    const untick = toggleAllergen(signed, "milk", false);
    expect(untick.clearedConfirmation).toBe(true);
    const prop = applyProposal(signed, ["gluten"]);
    expect(prop.clearedConfirmation).toBe(true);
  });
  it("an edit that changes nothing keeps the sign-off", () => {
    const signed = confirmAllergens(toggleAllergen(null, "milk", true).next, "chef@example.com", NOW);
    expect(toggleAllergen(signed, "milk", true)).toMatchObject({ clearedConfirmation: false, next: signed });
    expect(setWithoutNote(signed, "milk", "")).toMatchObject({ clearedConfirmation: false });
    expect(setWithoutNote(signed, "egg", "no egg")).toMatchObject({ clearedConfirmation: false });
  });
  it("editing an unconfirmed section never claims it cleared a confirmation", () => {
    expect(toggleAllergen(null, "milk", true).clearedConfirmation).toBe(false);
    expect(toggleAllergen({ contains: ["milk"], without: {} }, "egg", true).clearedConfirmation).toBe(false);
  });
  it("a duplicate keeps the lists and loses the sign-off", () => {
    const signed = confirmAllergens(setWithoutNote(toggleAllergen(null, "milk", true).next, "milk", "no cheese").next, "chef@example.com", NOW);
    const copy = unconfirmedCopy(signed) as Record<string, unknown>;
    expect(copy).toEqual({ contains: ["milk"], without: { milk: "no cheese" } });
    expect(unconfirmedCopy(null)).toBeNull();
    expect(unconfirmedCopy(undefined)).toBeUndefined();
  });
  it("says in words what it holds", () => {
    expect(describeDishAllergens(null)).toBe("None");
    expect(describeDishAllergens({ contains: ["milk", "sesame"], without: { milk: "no cheese" }, confirmed_at: NOW })).toBe("Milk, Seeds (1 can be made without), confirmed");
    expect(describeDishAllergens({ contains: [] })).toBe("None ticked, not confirmed");
  });
});

/* ------------------------------------------------------------------ ingredients are a prompt, never an answer */

const ing = (id: string, name: string, allergens: string[], reviewed = true): Ingredient => ({ id, name, category: "Food", supplier_id: null, supplier_code: null, pack_size: 1, pack_unit: "kg", pack_price: 1, price_inc_gst: false, gst_free: false, rebate: 0, yield_pct: 1, venues: "All", active: true, last_price_update: null, previous_price: null, source: null, notes: null, updated_at: null, allergens, allergens_reviewed: reviewed, diet_flags: [] }) as Ingredient;
const item = (over: Partial<MenuItem> = {}): MenuItem => ({ id: "m1", name: "Burger", venue_id: 1, category: "Food", section: "Burgers", portions: 1, sell_price_inc: 20, target_override: null, hh_price_inc: null, active: true, source: null, notes: null, ...over });
const line = (id: string, parent: string, comp: string, type: "ingredient" | "prep" = "ingredient"): RecipeLine => ({ id, parent_type: "item", parent_id: parent, component_type: type, component_id: comp, qty: 10, unit: "g", note: null, sort: 1 });

function indexFor(items: MenuItem[], ingredients: Ingredient[], lines: RecipeLine[], preps: Prep[] = []): AllergenIndex {
  return { ...buildIndex(ingredients, preps, lines), items: new Map(items.map((m) => [m.id, m])) };
}

describe("ingredients feed only the proposal and the review prompt", () => {
  const ingredients = [ing("i-bun", "Brioche Bun", ["gluten", "milk"]), ing("i-prawn", "Prawns", ["crustacea"]), ing("i-mayo", "Mayo", [], false)];
  const m = item({ dish_allergens: { contains: ["gluten"], without: {}, confirmed_at: NOW } });
  const index = indexFor([m], ingredients, [line("l1", "m1", "i-bun"), line("l2", "m1", "i-prawn"), line("l3", "m1", "i-mayo")]);
  const r = rollup({ kind: "item", id: "m1" }, index);

  it("Start From Ingredients proposes what the roll-up lists, and marks the guesses", () => {
    const p = proposeContains(r);
    expect(p.ids).toEqual(["gluten", "crustacea", "egg", "milk"]); // the fixed badge order
    expect(p.suggestedOnly).toContain("egg"); // Mayo is unreviewed and the name suggests egg
    expect(p.suggestedOnly).not.toContain("gluten");
  });
  it("the review prompt lists confirmed ticks the dish section lacks, and ignores keyword guesses", () => {
    const da = readDishAllergens(m.dish_allergens);
    expect(reviewMissing(da, r)).toEqual(["crustacea", "milk"]);
    expect(reviewMissing(null, r)).toEqual([]);
    expect(reviewWarningText(["milk"])).toBe("Ingredients have changed since this was confirmed. They now list Milk, which is not ticked above. Check it and confirm again.");
    expect(reviewWarningText([])).toBe("");
  });
  it("the matrix cells ignore the ingredients completely: same dish section, different recipe, same cells", () => {
    const withBun = indexFor([m], ingredients, [line("l1", "m1", "i-bun"), line("l2", "m1", "i-prawn")]);
    const empty = indexFor([m], ingredients, []);
    const a = buildRow(matrixDishFromItem(m, withBun)).cells;
    const b = buildRow(matrixDishFromItem(m, empty)).cells;
    expect(a).toEqual(b);
    expect(a.dairy.state).toBe("green"); // the bun has milk in its ingredients, but the dish section does not list it
    expect(a.seafood.state).toBe("green");
    expect(a.gluten_free.state).toBe("red");
  });
  it("an ingredient change flags the dish for review and still changes no cell", () => {
    const a = matrixDishFromItem(m, index);
    const b = matrixDishFromItem(m, indexFor([m], ingredients, []));
    expect(a.needsReview).toBe(true);
    expect(b.needsReview).toBe(false);
    expect(buildRow(a).cells).toEqual(buildRow(b).cells);
  });
  it("a dish nobody has signed off is not even checked against its ingredients", () => {
    expect(matrixDishFromItem(item({ dish_allergens: { contains: [] } }), index).needsReview).toBe(false);
  });
});

describe("the matrix modules never derive a cell from ingredients or keyword guesses", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("the rules, the print model and the kitchen parser import no roll-up, suggestion or keyword code", () => {
    for (const f of ["lib/allergy-matrix.ts", "lib/allergy-matrix-print.ts", "lib/kitchen-matrix.ts", "lib/kitchen-matrix-server.ts"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/\brollup\b|suggestAllergens|suggestDietFlags|summarise|matrixRows|ingredientAllergenState|\bbadgeModel\b|allergens_reviewed|\.allergens\b.*ingredient/);
      // the only thing taken from lib/allergens is a label and the id type
      for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\/allergens"/g)) for (const name of m[1].replace(/type /g, "").split(",").map((x) => x.trim()).filter(Boolean)) expect(["allergenLabel", "AllergenId"], `${f} imports ${name}`).toContain(name);
    }
  });
  it("the roll-up is used only where the plan allows: the store adapter (review prompt) and the editor panel (proposal)", () => {
    const users = ["lib/allergy-matrix-store.ts", "components/editor/dish-allergens.tsx", "components/matrix/matrix-page.tsx", "components/matrix/parts.tsx", "components/matrix/print-view.tsx", "components/kitchen/matrix.tsx"].filter((f) => /\brollup\b|useBadgeModel/.test(read(f)));
    expect(users.sort()).toEqual(["components/editor/dish-allergens.tsx", "lib/allergy-matrix-store.ts"]);
    // in the store adapter the roll-up result only ever reaches reviewMissing
    const store = read("lib/allergy-matrix-store.ts");
    expect(store.match(/rollup\(/g)).toHaveLength(1);
    expect(store).toMatch(/reviewMissing\(allergens, rollup\(/);
  });
  it("there is no override: no component writes a cell, and the matrix screens never write to the database", () => {
    for (const f of ["components/matrix/matrix-page.tsx", "components/matrix/parts.tsx", "components/matrix/print-view.tsx", "components/kitchen/matrix.tsx"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/updateItem|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/);
    }
  });
});

/* ------------------------------------------------------------------ options become words from the dish's own lines */

describe("option wording from the costing app's data", () => {
  const ingredients = [ing("i-bun", "Brioche Bun (700g)", ["gluten"]), ing("i-tamari", "Tamari", ["soy"])];
  const m = item({
    diet_options: {
      gf: {},
      gfo: { note: "Check the sauce", removed: ["l1"], added: [{ component_type: "ingredient", component_id: "i-tamari", qty: 15, unit: "ml" }], surcharge_inc: 2.5 },
      dfo: { note: "No butter" },
    },
  });
  const index = indexFor([m], ingredients, [line("l1", "m1", "i-bun")]);
  it("says what is left out and added, then the note, and never a price", () => {
    const w = optionWordsFor(m, index);
    expect(w.gfo).toBe("Leave out Brioche Bun. Add Tamari 15 ml. Check the sauce");
    expect(w.dfo).toBe("No butter");
    expect(JSON.stringify(w)).not.toMatch(/2\.5|\$|surcharge/);
  });
  it("builds a matrix dish with its marks, options and section", () => {
    const d = matrixDishFromItem(m, index);
    expect(d).toMatchObject({ id: "m1", name: "Burger", section: "Burgers", marks: ["gf"] });
    expect(Object.keys(d.options).sort()).toEqual(["dfo", "gfo"]);
  });
  it("lists only the venue's active Food dishes", () => {
    const items = [item({ id: "a" }), item({ id: "b", active: false }), item({ id: "c", category: "Cocktail" }), item({ id: "d", venue_id: 2 }), item({ id: "e", category: "Tap Beer" })];
    expect(matrixDishesForVenue(items, indexFor(items, [], []), 1).map((x) => x.id)).toEqual(["a"]);
  });
});

/* ------------------------------------------------------------------ the draft, the conflict check, history and undo carry the column */

describe("dish_allergens travels like any other column", () => {
  const base = item({ dish_allergens: { contains: ["milk"], without: {}, confirmed_at: NOW, confirmed_by: "a@b.c" } });
  it("a change is a change (patchOf) and is labelled", () => {
    const mine = { ...base, dish_allergens: toggleAllergen(base.dish_allergens, "egg", true).next };
    expect(Object.keys(patchOf(base, mine))).toEqual(["dish_allergens"]);
    expect(fieldLabel("dish_allergens")).toBe("Dish Allergens");
  });
  it("tap order never makes a change: the same set in a different order is the same", () => {
    const a = toggleAllergen(toggleAllergen(null, "milk", true).next, "egg", true).next;
    const b = toggleAllergen(toggleAllergen(null, "egg", true).next, "milk", true).next;
    expect(patchOf(item({ dish_allergens: a }), item({ dish_allergens: b }))).toEqual({});
  });
  it("two people changing it differently is a clash; one changing it is merged", () => {
    const run = (mine: unknown, theirs: unknown) => threeWay<MenuItem>({ base, mine: { ...base, dish_allergens: mine as MenuItem["dish_allergens"] }, theirs: { ...base, dish_allergens: theirs as MenuItem["dish_allergens"] }, baseLines: [], mineLines: [], theirsLines: [] });
    const mineEdit = toggleAllergen(base.dish_allergens, "egg", true).next;
    const theirEdit = toggleAllergen(base.dish_allergens, "fish", true).next;
    const clash = run(mineEdit, theirEdit);
    expect(clash.conflicts).toHaveLength(1);
    expect(clash.conflicts[0]).toMatchObject({ kind: "field", label: "Dish Allergens" });
    const view = buildConflictView(clash.conflicts, { componentName: () => "", venueName: () => "" });
    expect(view[0].mine[0]).toMatch(/Egg/);
    expect(view[0].theirs[0]).toMatch(/Fish/);
    const merged = run(mineEdit, base.dish_allergens);
    expect(merged.conflicts).toEqual([]);
    expect(merged.resolutions.mine.patch).toEqual({ dish_allergens: mineEdit });
  });
  it("a record loaded without the column (migration not applied) still works and is never written", () => {
    const old = item();
    expect("dish_allergens" in old).toBe(false);
    const r = threeWay<MenuItem>({ base: old, mine: { ...old, name: "Renamed" }, theirs: old, baseLines: [], mineLines: [], theirsLines: [] });
    expect(r.resolutions.mine.patch).toEqual({ name: "Renamed" });
    expect(readDishAllergens(old.dish_allergens)).toBeNull();
    const row = buildRow(matrixDishFromItem(old, indexFor([old], [], [])));
    expect(row.confirmed).toBe(false);
    expect(row.cells.dairy.state).toBe("grey");
  });
  it("history and undo describe it in words", () => {
    expect(fmtField("dish_allergens", base.dish_allergens)).toBe("Milk, confirmed");
    expect(showValue("dish_allergens", base.dish_allergens)).toBe("Milk, confirmed");
    expect(showValue("dish_allergens", null)).toBe("None");
  });
});

/* ------------------------------------------------------------------ the printed sheet */

describe("print model", () => {
  const rows = buildRows([
    dish({ id: "1", name: "Eggs On Toast", section: "Breakfast", contains: ["egg", "gluten"], without: { gluten: "GF toast" } }),
    dish({ id: "2", name: "Waffles", section: "Breakfast", signed: false }),
    dish({ id: "3", name: "Burger", section: "Burgers", contains: ["gluten", "milk"], options: { gfo: "Leave out Brioche Bun. Add Gluten Free Bun 1." } }),
  ]);
  const sheets = buildMatrixSheets({ venueName: "Drift", sections: matrixSections(rows), now: new Date("2026-10-10T03:00:00Z") });

  it("makes one sheet per section, titled for the venue", () => {
    expect(sheets.map((s) => s.sectionLabel)).toEqual(["Breakfast", "Burgers"]);
    expect(sheets.every((s) => s.title === "Drift Allergy Matrix")).toBe(true);
    expect(sheets[0].columns.map((c) => c.label)).toEqual(MATRIX_COLUMNS.map((c) => c.label));
  });
  it("leaves out a section with no dishes", () => {
    expect(buildMatrixSheets({ venueName: "Drift", sections: [{ label: "Empty", rows: [] }], now: new Date() })).toEqual([]);
  });
  it("gives every cell its word so a black and white print still reads", () => {
    const cells = sheets.flatMap((s) => s.pages.flatMap((p) => p.rows.flatMap((r) => r.cells)));
    expect(new Set(cells.map((c) => c.word))).toEqual(new Set(["No", "Swap", "Yes", "Not checked"]));
    for (const c of cells) {
      expect(c.word.length).toBeGreaterThan(0);
      if (c.state === "yellow") expect((c.note ?? "").length).toBeGreaterThan(0);
      else expect(c.note).toBeNull();
    }
    const waffles = sheets[0].pages[0].rows.find((r) => r.name === "Waffles")!;
    expect(waffles.cells.find((c) => c.word === "Not checked")).toBeTruthy();
    expect(sheets[0].notCheckedCount).toBe(1);
  });
  it("carries the legend, the Brisbane printed date and the head chef line", () => {
    expect(sheets[0].legend).toBe("Red = cannot eat. Yellow = must be substituted, see the note. Green = can eat with no substitutions. Grey = not checked, ask the head chef.");
    expect(sheets[0].printedLine).toBe("Printed 10 Oct 2026, Brisbane time");
    expect(sheets[0].footerNote).toBe("Confirm with the head chef if unsure");
    expect(printedDate(new Date("2026-10-09T15:00:00Z"))).toBe("10 Oct 2026"); // 1am Brisbane the next day
    expect(printedLine(new Date("2026-10-10T03:00:00Z"))).toBe("Printed 10 Oct 2026, Brisbane time");
  });
  it("holds no cost, price, GP, target, surcharge or supplier", () => {
    const walk = (v: unknown, path: string[] = []): string[] => {
      if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => [...(/cost|price|gp|target|surcharge|supplier|sell|margin/i.test(k) ? [[...path, k].join(".")] : []), ...walk(x, [...path, k])]);
      return [];
    };
    expect(walk(sheets)).toEqual([]);
    expect(JSON.stringify(sheets)).not.toMatch(/\$\d/);
  });
  it("has no em or en dashes in anything printed", () => {
    expect(JSON.stringify(sheets) + MATRIX_PRINT_CSS).not.toMatch(/[–—]/);
  });
  it("addresses a print job by venue and section", () => {
    expect(matrixPrintHref("drift", "Bowls & Salads")).toBe("/matrix/print?venue=drift&section=Bowls+%26+Salads");
    expect(matrixPrintHref("drift", null)).toBe("/matrix/print?venue=drift&section=*");
    const secs = matrixSections(rows);
    expect(pickSections(secs, "*").map((s) => s.label)).toEqual(["Breakfast", "Burgers"]);
    expect(pickSections(secs, null)).toHaveLength(2);
    expect(pickSections(secs, "burgers").map((s) => s.label)).toEqual(["Burgers"]);
    expect(pickSections(secs, "Nope")).toEqual([]);
  });
});

describe("print paging", () => {
  const mkRow = (i: number, note?: string) => ({ id: `r${i}`, name: `Dish ${i}`, cells: Array.from({ length: 11 }, (_, k) => (note && k === 2 ? { state: "yellow" as const, word: "Swap", note } : { state: "green" as const, word: "Yes", note: null })) });
  it("estimates a plain row at the minimum and a long note taller", () => {
    expect(estimateRowMm(mkRow(1))).toBeGreaterThanOrEqual(11);
    expect(estimateRowMm(mkRow(1, "Leave out Brioche Bun. Add Gluten Free Bun 1. Check the sauce with the head chef"))).toBeGreaterThan(estimateRowMm(mkRow(1)) * 2);
    expect(CHARS_PER_LINE).toBeGreaterThan(4);
  });
  it("keeps a short list on one page and splits a long one, with no row lost or repeated", () => {
    expect(paginate(Array.from({ length: 5 }, (_, i) => mkRow(i)))).toHaveLength(1);
    const many = Array.from({ length: 60 }, (_, i) => mkRow(i, i % 3 === 0 ? "no aioli, no butter, no cheese" : undefined));
    const pages = paginate(many);
    expect(pages.length).toBeGreaterThan(2);
    expect(pages.flat().map((r) => r.id)).toEqual(many.map((r) => r.id));
    for (const p of pages) expect(p.reduce((s, r) => s + estimateRowMm(r), 0)).toBeLessThanOrEqual(PAGE_ROW_BUDGET_MM + 0.001);
  });
  it("gives an empty list one page and a single very tall row a page of its own", () => {
    expect(paginate([])).toEqual([[]]);
    const tall = mkRow(1, "word ".repeat(80));
    const pages = paginate([mkRow(0), tall, mkRow(2)]);
    expect(pages.map((p) => p.length)).toEqual([1, 1, 1]);
  });
  it("numbers the pages of a sheet", () => {
    const rows = Array.from({ length: 60 }, (_, i) => buildRow(dish({ id: `d${i}`, name: `Dish ${i}`, section: "Mains", contains: ["milk"], without: { milk: "no aioli no butter" } })));
    const [sheet] = buildMatrixSheets({ venueName: "Drift", sections: matrixSections(rows), now: new Date() });
    expect(sheet.pages.length).toBeGreaterThan(1);
    expect(sheet.pages.map((p) => p.number)).toEqual(sheet.pages.map((_, i) => i + 1));
    expect(sheet.pages.every((p) => p.of === sheet.pages.length)).toBe(true);
  });
});

describe("print stylesheet", () => {
  it("is A4 landscape with colour kept, a repeating heading and rows that never split", () => {
    expect(MATRIX_PRINT_CSS).toMatch(/@page\s*\{\s*size:\s*A4 landscape/);
    expect(MATRIX_PRINT_CSS).toMatch(/print-color-adjust:\s*exact/);
    expect(MATRIX_PRINT_CSS).toMatch(/thead\s*\{\s*display:\s*table-header-group/);
    expect(MATRIX_PRINT_CSS).toMatch(/tr\s*\{\s*break-inside:\s*avoid/);
    expect(MATRIX_PRINT_CSS).toMatch(/break-after:\s*page/);
  });
  it("hides everything but the sheet when printing, and the toolbar never prints", () => {
    expect(MATRIX_PRINT_CSS).toMatch(/html\[data-print-job\] body > \*:not\(#print-root\)\s*\{\s*display:\s*none/);
    expect(MATRIX_PRINT_CSS).toMatch(/\.am-noprint\s*\{\s*display:\s*none/);
  });
  it("keeps every cell at 11pt or larger", () => {
    expect(MIN_BODY_PT).toBeGreaterThanOrEqual(11);
    const sizes = [...MATRIX_PRINT_CSS.matchAll(/font-size:\s*([\d.]+)pt/g)].map((m) => Number(m[1]));
    const foot = MATRIX_PRINT_CSS.match(/\.am-foot[^}]*font-size:\s*([\d.]+)pt/);
    expect(Number(foot?.[1])).toBe(10); // only the footer is smaller
    expect(sizes.filter((n) => n < 11)).toEqual([10]);
  });
});

describe("sign-off date", () => {
  it("is shown in Brisbane time", () => {
    expect(signedOffDate("2026-10-09T15:00:00Z")).toBe("10 Oct 2026");
    expect(signedOffDate(null)).toBe("");
    expect(signedOffDate("junk")).toBe("");
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("the editor shows Dish Allergens on Food dishes only, through the draft", () => {
    const src = read("components/editor/recipe-editor.tsx");
    expect(src).toMatch(/item\.category === "Food" \? <DishAllergensGroup/);
    expect(src).toMatch(/<DishAllergensGroup[^>]*onPatch=\{\(p\) => setDraft/);
  });
  it("Duplicate and What If copy the lists but not the sign-off", () => {
    expect(read("components/editor/recipe-editor.tsx")).toMatch(/dish_allergens: unconfirmedCopy\(rest\.dish_allergens\)/);
    expect(read("components/editor/what-if.tsx")).toMatch(/dish_allergens: unconfirmedCopy\(rest\.dish_allergens\)/);
  });
  it("the matrix is linked from the sidebar, the More page, the Menu page and Menu Labels", () => {
    expect(read("components/app-shell.tsx")).toContain('href: "/matrix"');
    expect(read("app/(app)/more/page.tsx")).toContain('href="/matrix"');
    expect(read("app/(app)/menu/page.tsx")).toContain("/matrix");
    expect(read("components/allergen-matrix.tsx")).toContain("/matrix");
  });
  it("the editor panel uses plain 44px chips and never saves by itself", () => {
    const src = read("components/editor/dish-allergens.tsx");
    expect(src).toContain("min-h-[44px]");
    expect(src).not.toMatch(/updateItem|\.insert\(|\.update\(|\.upsert\(/);
  });
});
