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
  ANSWER_COL_MM,
  ANSWER_PAD_MM,
  BODY_W_MM,
  DISH_COL_MM,
  MATRIX_PRINT_CSS,
  SHY,
  headLabel,
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
import { DISH_ALLERGEN_IDS, addExtra, confirmAllergens, describeDishAllergens, dishCheck, isConfirmed, liveCheck, readDishAllergens, removeExtra, setWithoutNote, toStored, unconfirmedCopy } from "@/lib/dish-allergens";
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
  const allergens = signed === null ? null : { contains, without, confirmedAt: signed ? NOW : null, confirmedBy: signed ? "chef@example.com" : null, added: [] as AllergenId[], basis: null, components: null, ticks: null, needsSignoff: false };
  return { id: "d1", name: "Test Dish", section: "Mains", allergens, marks: [], options: {}, ...rest };
}
const state = (d: MatrixDish, c: MatrixColumnId) => cell(d, c).state;

describe("columns", () => {
  it("are the fifteen: the fourteen Brendan asked for (Onion, Garlic, Fish, Crustacean And Molluscs, Nuts and Seeds each on their own) plus Soy after Seeds (Troy, 14 Nov 2026)", () => {
    expect(MATRIX_COLUMNS.map((c) => c.label)).toEqual(["Gluten Free", "Onion", "Garlic", "Dairy", "Fish", "Crustacean And Molluscs", "Chilli", "Eggs", "Nuts", "Seeds", "Soy", "Vegetarian", "Vegan", "Sulphites", "Nitrites"]);
    expect(MATRIX_COLUMNS.map((c) => c.id)).toEqual(["gluten_free", "onion", "garlic", "dairy", "fish", "crustacean_molluscs", "chilli", "eggs", "nuts", "seeds", "soy", "vegetarian", "vegan", "sulphites", "nitrites"]);
    expect(MATRIX_COLUMNS).toHaveLength(15);
  });
  it("map the allergens as decided: each of the 15 columns", () => {
    const by = Object.fromEntries(MATRIX_COLUMNS.map((c) => [c.id, c.allergens]));
    expect(by.gluten_free).toEqual(["gluten"]);
    expect(by.onion).toEqual(["onion"]);
    expect(by.garlic).toEqual(["garlic"]);
    expect(by.dairy).toEqual(["milk"]);
    expect(by.fish).toEqual(["fish"]);
    expect(by.crustacean_molluscs).toEqual(["crustacea", "molluscs"]);
    expect(by.chilli).toEqual(["chilli"]);
    expect(by.eggs).toEqual(["egg"]);
    expect(by.nuts).toEqual(["peanuts", "tree_nuts"]);
    expect(by.seeds).toEqual(["sesame"]);
    expect(by.soy).toEqual(["soy"]);
    expect(by.vegetarian).toEqual([]);
    expect(by.vegan).toEqual([]);
    expect(by.sulphites).toEqual(["sulphites"]);
    expect(by.nitrites).toEqual(["nitrites"]);
  });
  it("cover every dish allergen exactly once, except Lupin which has no column (molluscs never vanish, Soy got its column on 14 Nov 2026)", () => {
    const covered = MATRIX_COLUMNS.flatMap((c) => c.allergens);
    expect(new Set(covered).size).toBe(covered.length);
    expect([...DISH_ALLERGEN_IDS].filter((id) => !covered.includes(id)).sort()).toEqual(["lupin"]);
  });
  it("have a short phone label that is distinct and no longer than a word", () => {
    const shorts = MATRIX_COLUMNS.map((c) => c.short);
    expect(new Set(shorts).size).toBe(shorts.length);
    for (const s of shorts) expect(s.length).toBeLessThanOrEqual(9);
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
  it("fish is its own column: crustacea and molluscs do not touch it", () => {
    expect(state(dish({ contains: ["fish"] }), "fish")).toBe("red");
    expect(state(dish({ contains: ["crustacea"] }), "fish")).toBe("green");
    expect(state(dish({ contains: ["molluscs"] }), "fish")).toBe("green");
    expect(state(dish({ contains: ["milk"] }), "fish")).toBe("green");
  });
  it("Crustacean And Molluscs: crustacea and molluscs both land in the one column and fish does not", () => {
    expect(state(dish({ contains: ["crustacea"] }), "crustacean_molluscs")).toBe("red");
    expect(state(dish({ contains: ["molluscs"] }), "crustacean_molluscs")).toBe("red");
    expect(state(dish({ contains: ["fish"] }), "crustacean_molluscs")).toBe("green");
    expect(state(dish({ contains: ["milk"] }), "crustacean_molluscs")).toBe("green");
  });
  it("a multi-allergen column is yellow only when EVERY allergen in it has a note, else red", () => {
    const both = dish({ contains: ["molluscs", "crustacea"], without: { molluscs: "no mussels", crustacea: "no prawns" } });
    expect(cell(both, "crustacean_molluscs")).toMatchObject({ state: "yellow", note: "no prawns; no mussels" });
    const one = dish({ contains: ["molluscs", "crustacea"], without: { crustacea: "no prawns" } });
    expect(state(one, "crustacean_molluscs")).toBe("red");
  });
  it("Nuts and Seeds are separate: peanuts and tree nuts fill Nuts, seeds (the id sesame) fill Seeds", () => {
    for (const id of ["peanuts", "tree_nuts"] as const) {
      expect(state(dish({ contains: [id] }), "nuts")).toBe("red");
      expect(state(dish({ contains: [id] }), "seeds")).toBe("green");
    }
    expect(state(dish({ contains: ["sesame"] }), "seeds")).toBe("red");
    expect(state(dish({ contains: ["sesame"] }), "nuts")).toBe("green");
    expect(state(dish({ contains: ["soy"] }), "nuts")).toBe("green");
    expect(state(dish({ contains: ["soy"] }), "seeds")).toBe("green");
    expect(cell(dish({ contains: ["peanuts", "tree_nuts"], without: { peanuts: "no peanuts", tree_nuts: "no almonds" } }), "nuts").note).toBe("no peanuts; no almonds");
    expect(cell(dish({ contains: ["sesame", "tree_nuts"], without: { sesame: "no seeds" } }), "seeds").note).toBe("no seeds");
  });
  it("identical notes are said once", () => {
    const d = dish({ contains: ["crustacea", "molluscs"], without: { crustacea: "no shellfish topping", molluscs: "no shellfish topping" } });
    expect(cell(d, "crustacean_molluscs").note).toBe("no shellfish topping");
  });
  it("onion, garlic, chilli, eggs, sulphites and nitrites each read their own allergen", () => {
    const d = dish({ contains: ["onion", "garlic", "chilli", "egg", "sulphites", "nitrites"] });
    for (const c of ["onion", "garlic", "chilli", "eggs", "sulphites", "nitrites"] as const) expect(state(d, c)).toBe("red");
    expect(state(d, "dairy")).toBe("green");
  });
  it("Onion and Garlic are separate columns", () => {
    expect(state(dish({ contains: ["onion"] }), "onion")).toBe("red");
    expect(state(dish({ contains: ["onion"] }), "garlic")).toBe("green");
    expect(state(dish({ contains: ["garlic"] }), "garlic")).toBe("red");
    expect(state(dish({ contains: ["garlic"] }), "onion")).toBe("green");
    expect(cell(dish({ contains: ["garlic"], without: { garlic: "no garlic oil" } }), "garlic")).toMatchObject({ state: "yellow", note: "no garlic oil" });
    expect(state(dish({ contains: ["garlic"], without: { garlic: "no garlic oil" } }), "onion")).toBe("green");
  });
  it("a LEGACY onion_garlic on a dish reads as BOTH Onion and Garlic (fail safe), never as neither", () => {
    const legacy = dish({ contains: ["onion_garlic" as unknown as AllergenId] });
    expect(state(legacy, "onion")).toBe("red");
    expect(state(legacy, "garlic")).toBe("red");
    expect(state(legacy, "dairy")).toBe("green");
    // a dish signed off before the split reads the same through the tolerant reader
    const read = readDishAllergens({ contains: ["milk", "onion_garlic"], without: { onion_garlic: "no raw onion or garlic" }, confirmed_at: NOW })!;
    expect(read.contains).toEqual(["milk", "onion", "garlic"]);
    expect(read.without).toEqual({ onion: "no raw onion or garlic", garlic: "no raw onion or garlic" });
    expect(read.contains).not.toContain("onion_garlic");
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
  it("sorts sections A to Z with Other last, and dishes A to Z inside each (Troy: just sort alphabetically)", () => {
    const s = matrixSections(rows);
    expect(s.map((x) => x.label)).toEqual(["Aperitivo", "Bowls & Salads", "Breakfast", "Burgers", "Other"]);
    expect(s[2].rows.map((r) => r.dish.name)).toEqual(["Eggs On Toast", "Waffles"]);
  });
  it("counts progress and lists what needs confirming in the same alphabetical order", () => {
    const p = matrixProgress(rows);
    expect(p).toMatchObject({ total: 6, confirmed: 4 });
    expect(p.needing.map((r) => r.dish.name)).toEqual(["Waffles", "Mystery"]);
    expect(progressLine(p)).toBe("4 of 6 dishes confirmed");
    expect(progressLine({ total: 1, confirmed: 1 })).toBe("1 of 1 dish confirmed");
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

describe("lupin has no column but is never hidden (soy got its own on 14 Nov 2026)", () => {
  it("are reported for the detail card of a signed-off dish", () => {
    expect(uncolumnedContains(dish({ contains: ["soy", "lupin", "milk"] }).allergens)).toEqual(["lupin"]); // soy has its own column since 14 Nov 2026
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
  it("offers the 16 main allergens, Onion and Garlic included, and never alcohol or the legacy onion_garlic", () => {
    expect(DISH_ALLERGEN_IDS).toHaveLength(16);
    expect(DISH_ALLERGEN_IDS).toContain("onion");
    expect(DISH_ALLERGEN_IDS).toContain("garlic");
    expect(DISH_ALLERGEN_IDS).not.toContain("alcohol");
    expect(DISH_ALLERGEN_IDS as readonly string[]).not.toContain("onion_garlic");
  });
  it("stores the sign-off keys only while signed off", () => {
    expect(toStored(readDishAllergens({ contains: ["milk"] })!)).toEqual({ contains: ["milk"], without: {} });
    expect(Object.keys(toStored(readDishAllergens({ contains: ["milk"], confirmed_at: NOW, confirmed_by: "a@b.c" })!)).sort()).toEqual(["confirmed_at", "confirmed_by", "contains", "without"]);
  });
});

describe("dish allergens: extras, notes, confirming (ingredient first)", () => {
  const BASIS = { derived: [] as AllergenId[], components: ["ingredient:i1"], ticks: { "ingredient:i1": { a: [], r: true }, "item:m1": { add: [], rem: [] } } };
  it("an extra is added in the fixed order whatever the tap order, and only when the ingredients do not already show it", () => {
    let raw: unknown = null;
    for (const id of ["milk", "gluten", "egg"] as const) raw = addExtra(raw, id, []).next;
    expect((raw as { contains: string[]; added: string[] }).added).toEqual(["gluten", "egg", "milk"]);
    expect((raw as { contains: string[] }).contains).toEqual(["gluten", "egg", "milk"]);
    // milk is derived from the ingredients, so adding it by hand changes nothing
    const same = addExtra(null, "milk", ["milk"]);
    expect(readDishAllergens(same.next)).toMatchObject({ contains: ["milk"], added: [] });
  });
  it("contains is always derived plus extras, in the fixed order", () => {
    const raw = addExtra(null, "sesame", ["milk", "gluten"]).next;
    expect(readDishAllergens(raw)).toMatchObject({ contains: ["gluten", "milk", "sesame"], added: ["sesame"] });
  });
  it("removing an extra removes its note; a derived allergen cannot be removed", () => {
    let raw: unknown = addExtra(null, "egg", ["milk"]).next;
    raw = setWithoutNote(raw, "egg", "no egg wash", ["milk"]).next;
    expect(readDishAllergens(raw)!.without).toEqual({ egg: "no egg wash" });
    raw = removeExtra(raw, "egg", ["milk"]).next;
    expect(readDishAllergens(raw)).toMatchObject({ contains: ["milk"], added: [], without: {} });
    const derivedOnly = removeExtra(raw, "milk", ["milk"]);
    expect(readDishAllergens(derivedOnly.next)).toMatchObject({ contains: ["milk"] });
  });
  it("a note attaches to anything the dish contains (derived or extra), and empty text clears it", () => {
    expect(readDishAllergens(setWithoutNote(null, "egg", "no egg", ["milk"]).next)!.without).toEqual({});
    let raw: unknown = setWithoutNote(null, "milk", "  no   cheese ", ["milk"]).next;
    expect(readDishAllergens(raw)!.without.milk).toBe("no cheese");
    raw = setWithoutNote(raw, "milk", "   ", ["milk"]).next;
    expect(readDishAllergens(raw)!.without).toEqual({});
  });
  it("Confirm stamps the time, the signed-in email, the derived ids, the components and the ticks", () => {
    const next = confirmAllergens(null, "chef@example.com", NOW, { derived: ["milk"], components: ["prep:p1", "ingredient:i1"], ticks: BASIS.ticks });
    expect(next).toEqual({
      contains: ["milk"],
      without: {},
      confirmed_at: NOW,
      confirmed_by: "chef@example.com",
      components: ["ingredient:i1", "prep:p1"],
      basis: ["milk"],
      ticks: BASIS.ticks,
    });
    expect(isConfirmed(readDishAllergens(next))).toBe(true);
    expect(confirmAllergens(null, null, NOW, { ...BASIS, components: [] })).toEqual({ contains: [], without: {}, confirmed_at: NOW, components: [], basis: [], ticks: BASIS.ticks });
  });
  it("Confirm stores derived union extras and drops notes for allergens the dish no longer contains", () => {
    const raw = { contains: ["milk", "egg"], without: { milk: "no cheese", egg: "no egg" }, added: ["egg"] };
    const next = confirmAllergens(raw, "chef@example.com", NOW, { ...BASIS, derived: ["gluten"] });
    expect(next).toMatchObject({ contains: ["gluten", "egg"], added: ["egg"], without: { egg: "no egg" }, basis: ["gluten"] });
  });
  it("ANY edit after confirmation clears it, and says so", () => {
    const signed = confirmAllergens(addExtra(null, "egg", ["milk"]).next, "chef@example.com", NOW, { ...BASIS, derived: ["milk"] });
    const extra = addExtra(signed, "gluten", ["milk"]);
    expect(extra.clearedConfirmation).toBe(true);
    expect(isConfirmed(readDishAllergens(extra.next))).toBe(false);
    expect(extra.next).not.toHaveProperty("confirmed_at");
    expect(extra.next).not.toHaveProperty("ticks");
    expect(extra.next).not.toHaveProperty("basis");
    const note = setWithoutNote(signed, "milk", "no cheese", ["milk"]);
    expect(note.clearedConfirmation).toBe(true);
    expect(isConfirmed(readDishAllergens(note.next))).toBe(false);
    const remove = removeExtra(signed, "egg", ["milk"]);
    expect(remove.clearedConfirmation).toBe(true);
  });
  it("an edit that changes nothing keeps the sign-off", () => {
    const signed = confirmAllergens(addExtra(null, "egg", ["milk"]).next, "chef@example.com", NOW, { ...BASIS, derived: ["milk"] });
    expect(addExtra(signed, "egg", ["milk"])).toMatchObject({ clearedConfirmation: false, next: signed });
    expect(setWithoutNote(signed, "milk", "", ["milk"])).toMatchObject({ clearedConfirmation: false });
    expect(setWithoutNote(signed, "fish", "no fish", ["milk"])).toMatchObject({ clearedConfirmation: false });
    expect(removeExtra(signed, "gluten", ["milk"])).toMatchObject({ clearedConfirmation: false });
  });
  it("editing an unconfirmed section never claims it cleared a confirmation", () => {
    expect(addExtra(null, "milk", []).clearedConfirmation).toBe(false);
    expect(addExtra({ contains: ["milk"], without: {} }, "egg", []).clearedConfirmation).toBe(false);
  });
  it("a duplicate keeps the lists and loses the sign-off", () => {
    const signed = confirmAllergens(setWithoutNote(addExtra(null, "egg", ["milk"]).next, "milk", "no cheese", ["milk"]).next, "chef@example.com", NOW, { ...BASIS, derived: ["milk"] });
    const copy = unconfirmedCopy(signed) as Record<string, unknown>;
    expect(copy).toEqual({ contains: ["egg", "milk"], without: { milk: "no cheese" }, added: ["egg"] });
    expect(unconfirmedCopy(null)).toBeNull();
    expect(unconfirmedCopy(undefined)).toBeUndefined();
  });
  it("says in words what it holds", () => {
    expect(describeDishAllergens(null)).toBe("None");
    expect(describeDishAllergens({ contains: ["milk", "sesame"], without: { milk: "no cheese" }, confirmed_at: NOW })).toBe("Milk, Seeds (1 can be made without), confirmed");
    expect(describeDishAllergens({ contains: [] })).toBe("None listed, not confirmed");
    expect(describeDishAllergens({ contains: ["milk", "egg"], added: ["egg"] })).toBe("Egg, Milk (1 added by hand), not confirmed");
  });
});

/* ------------------------------------------------------------------ ingredients are a prompt, never an answer */

const ing = (id: string, name: string, allergens: string[], reviewed = true): Ingredient => ({ id, name, category: "Food", supplier_id: null, supplier_code: null, pack_size: 1, pack_unit: "kg", pack_price: 1, price_inc_gst: false, gst_free: false, rebate: 0, yield_pct: 1, venues: "All", active: true, last_price_update: null, previous_price: null, source: null, notes: null, updated_at: null, allergens, allergens_reviewed: reviewed, diet_flags: [] }) as Ingredient;
const item = (over: Partial<MenuItem> = {}): MenuItem => ({ id: "m1", name: "Burger", venue_id: 1, category: "Food", section: "Burgers", portions: 1, sell_price_inc: 20, target_override: null, hh_price_inc: null, active: true, source: null, notes: null, ...over });
const line = (id: string, parent: string, comp: string, type: "ingredient" | "prep" = "ingredient"): RecipeLine => ({ id, parent_type: "item", parent_id: parent, component_type: type, component_id: comp, qty: 10, unit: "g", note: null, sort: 1 });

function indexFor(items: MenuItem[], ingredients: Ingredient[], lines: RecipeLine[], preps: Prep[] = []): AllergenIndex {
  return { ...buildIndex(ingredients, preps, lines), items: new Map(items.map((m) => [m.id, m])) };
}

describe("the matrix reads the confirmed section, and the ingredients only decide whether the sign-off still counts", () => {
  const ingredients = [ing("i-bun", "Brioche Bun", ["gluten", "milk"]), ing("i-prawn", "Prawns", ["crustacea"]), ing("i-mayo", "Mayo", ["egg"])];
  const lines = [line("l1", "m1", "i-bun"), line("l2", "m1", "i-prawn"), line("l3", "m1", "i-mayo")];
  const plain = item();
  const base = indexFor([plain], ingredients, lines);
  // confirm exactly what the ingredients give today
  const check = dishCheck(plain, base);
  const m = item({ dish_allergens: confirmAllergens(null, "chef@example.com", NOW, { derived: check.derived, components: check.live.components, ticks: check.live.ticks }) });
  const index = indexFor([m], ingredients, lines);

  it("works the dish's allergens out from the ingredients' confirmed ticks", () => {
    expect(check.derived).toEqual(["gluten", "crustacea", "egg", "milk"]); // the fixed order
    expect(check.blocked).toBe(false);
  });
  it("a valid sign-off shows the answers the ingredients gave when it was confirmed", () => {
    const row = buildRow(matrixDishFromItem(m, index));
    expect(row.signOff).toBe("valid");
    expect(row.confirmed).toBe(true);
    expect(row.cells.dairy.state).toBe("red");
    expect(row.cells.crustacean_molluscs.state).toBe("red");
    expect(row.cells.fish.state).toBe("green");
    expect(row.cells.gluten_free.state).toBe("red");
    expect(row.cells.chilli.state).toBe("green");
  });
  it("changing an ingredient's allergen ticks greys every allergen cell: the sign-off stops counting", () => {
    const dropped = indexFor([m], [ing("i-bun", "Brioche Bun", ["gluten"]), ing("i-prawn", "Prawns", ["crustacea"]), ing("i-mayo", "Mayo", ["egg"])], lines);
    const dish = matrixDishFromItem(m, dropped);
    expect(dish.signOff).toBe("changed");
    const row = buildRow(dish);
    expect(row.confirmed).toBe(false);
    expect(row.cells.dairy.state).toBe("grey");
    expect(row.cells.crustacean_molluscs.state).toBe("grey");
  });
  it("an ingredient's reviewed flag flipping also stops the sign-off counting", () => {
    const unreviewed = indexFor([m], [ing("i-bun", "Brioche Bun", ["gluten", "milk"]), ing("i-prawn", "Prawns", ["crustacea"]), ing("i-mayo", "Mayo", ["egg"], false)], lines);
    expect(matrixDishFromItem(m, unreviewed).signOff).toBe("changed");
  });
  it("swapping an ingredient is different too: every allergen cell reads Not checked", () => {
    const swapped = indexFor([m], ingredients, [line("l1", "m1", "i-bun"), line("l2", "m1", "i-prawn")]); // Mayo removed
    const dish = matrixDishFromItem(m, swapped);
    expect(dish.signOff).toBe("changed");
    expect(buildRow(dish).cells.dairy.state).toBe("grey");
  });
  it("the dish's own allergen override counts as a tick: changing it re-checks the dish", () => {
    const overridden = { ...m, allergen_add: ["lupin"] } as MenuItem;
    expect(matrixDishFromItem(overridden, indexFor([overridden], ingredients, lines)).signOff).toBe("changed");
  });
  it("a dish nobody has signed off reads Not checked, whatever its ingredients say", () => {
    const row = buildRow(matrixDishFromItem(item({ dish_allergens: { contains: [] } }), index));
    expect(row.signOff).toBe("never");
    expect(row.cells.dairy.state).toBe("grey");
  });
  it("liveCheck is what the matrix compares: components plus a ticks snapshot with the dish's own entry", () => {
    const live = liveCheck(m, index);
    expect(live.components).toEqual(["ingredient:i-bun", "ingredient:i-mayo", "ingredient:i-prawn"]);
    expect(Object.keys(live.ticks).sort()).toEqual(["ingredient:i-bun", "ingredient:i-mayo", "ingredient:i-prawn", "item:m1"]);
  });
});

describe("the matrix modules never derive a cell from ingredients or keyword guesses", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("the rules, the print model and the kitchen parser import no roll-up, suggestion or keyword code", () => {
    for (const f of ["lib/allergy-matrix.ts", "lib/allergy-matrix-print.ts", "lib/kitchen-matrix.ts", "lib/kitchen-matrix-server.ts"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/\brollup\b|suggestAllergens|suggestDietFlags|summarise|matrixRows|ingredientAllergenState|\bbadgeModel\b|allergens_reviewed|\.allergens\b.*ingredient/);
      // the only things taken from lib/allergens are a label, the id type and the pure legacy-id reader (a stored onion_garlic reads as Onion and Garlic)
      for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\/allergens"/g)) for (const name of m[1].replace(/type /g, "").split(",").map((x) => x.trim()).filter(Boolean)) expect(["allergenLabel", "AllergenId", "expandLegacyAllergens"], `${f} imports ${name}`).toContain(name);
    }
  });
  it("the roll-up is worked out in one place (lib/dish-allergens.ts); no matrix screen, print or adapter calls it", () => {
    const users = ["lib/allergy-matrix-store.ts", "components/matrix/matrix-page.tsx", "components/matrix/parts.tsx", "components/matrix/print-view.tsx", "components/matrix/printed.tsx", "components/kitchen/matrix.tsx", "lib/matrix-prints.ts"].filter((f) => /\brollup\(|useBadgeModel|dishCheck/.test(read(f)));
    expect(users).toEqual([]);
    // the adapter only compares components and ticks to decide whether a sign-off still counts
    expect(read("lib/allergy-matrix-store.ts")).toMatch(/liveCheck\(item, index\)/);
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
    const mine = { ...base, dish_allergens: addExtra(base.dish_allergens, "egg", []).next };
    expect(Object.keys(patchOf(base, mine))).toEqual(["dish_allergens"]);
    expect(fieldLabel("dish_allergens")).toBe("Dish Allergens");
  });
  it("tap order never makes a change: the same set in a different order is the same", () => {
    const a = addExtra(addExtra(null, "milk", []).next, "egg", []).next;
    const b = addExtra(addExtra(null, "egg", []).next, "milk", []).next;
    expect(patchOf(item({ dish_allergens: a }), item({ dish_allergens: b }))).toEqual({});
  });
  it("two people changing it differently is a clash; one changing it is merged", () => {
    const run = (mine: unknown, theirs: unknown) => threeWay<MenuItem>({ base, mine: { ...base, dish_allergens: mine as MenuItem["dish_allergens"] }, theirs: { ...base, dish_allergens: theirs as MenuItem["dish_allergens"] }, baseLines: [], mineLines: [], theirsLines: [] });
    const mineEdit = addExtra(base.dish_allergens, "egg", []).next;
    const theirEdit = addExtra(base.dish_allergens, "fish", []).next;
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
  const mkRow = (i: number, note?: string) => ({ id: `r${i}`, name: `Dish ${i}`, cells: Array.from({ length: MATRIX_COLUMNS.length }, (_, k) => (note && k === 2 ? { state: "yellow" as const, word: "Swap", note } : { state: "green" as const, word: "Yes", note: null })) });
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
    expect(Number(foot?.[1])).toBe(10); // only the footer is smaller (and the QR caption under its code); no answer cell is
    expect(sizes.filter((n) => n < 11).sort((a, b) => b - a)).toEqual([10, 8]);
    expect(MATRIX_PRINT_CSS).toMatch(/\.am-cross\s*\{[^}]*font-size:\s*11pt/); // the cross-contact line is body size
  });
});

describe("print column widths (15 columns, Brendan 7 Nov 2026, Soy added 14 Nov 2026)", () => {
  // measured in Karla, the app's body face, at 11pt: the widest word a cell prints is "checked" (grey, weight 800), and the widest
  // unbroken heading word is "Molluscs" (weight 700)
  const CHECKED_MM = 15.84;
  const MOLLUSCS_MM = 16.53;
  it("the dish column and the 15 answer columns add up to exactly the page body width", () => {
    expect(MATRIX_COLUMNS).toHaveLength(15);
    expect(DISH_COL_MM + ANSWER_COL_MM * MATRIX_COLUMNS.length).toBeCloseTo(BODY_W_MM, 6);
    expect(BODY_W_MM).toBe(297 - 2 * 7);
    expect(DISH_COL_MM).toBeGreaterThanOrEqual(30); // dish names wrap to two or three lines, not five
  });
  it("an answer column holds the widest cell word at 11pt with its padding, and the heading words that stay whole", () => {
    const BORDER_MM = 0.35; // the collapsed cell border takes this much of the cell
    expect(ANSWER_COL_MM).toBeGreaterThanOrEqual(CHECKED_MM + 2 * ANSWER_PAD_MM + BORDER_MM + 0.2); // 0.2mm slack so "checked" never breaks mid-word
    expect(ANSWER_COL_MM).toBeGreaterThanOrEqual(MOLLUSCS_MM / 2 + 0.8); // "Molluscs" carries a soft hyphen now, so only half of it must fit; th padding 0.4mm each side
  });
  it("long heading words carry a soft hyphen so they break instead of running into the next column", () => {
    const [sheet] = buildMatrixSheets({ venueName: "Drift", sections: matrixSections(buildRows([dish()])), now: new Date() });
    for (const c of sheet.columns) expect(c.head.replace(new RegExp(SHY, "g"), "")).toBe(c.label);
    const heads = Object.fromEntries(sheet.columns.map((c) => [c.id, c.head]));
    expect(heads.vegetarian).toContain(SHY);
    expect(heads.sulphites).toContain(SHY);
    expect(heads.crustacean_molluscs).toContain(SHY);
    expect(heads.crustacean_molluscs).toBe(`Crusta${SHY}cean And Mol${SHY}luscs`);
    expect(heads.dairy).toBe("Dairy");
    expect(headLabel("nope", "Anything")).toBe("Anything");
  });
  it("the sheet draws one printed cell per column and every one prints its word", () => {
    const [sheet] = buildMatrixSheets({ venueName: "Drift", sections: matrixSections(buildRows([dish({ contains: ["fish", "molluscs"] }), dish({ id: "d2", name: "B", signed: false })])), now: new Date() });
    for (const r of sheet.pages[0].rows) {
      expect(r.cells).toHaveLength(15);
      for (const c of r.cells) expect(c.word.length).toBeGreaterThan(0);
    }
  });
  it("the print view draws the same widths the model says", () => {
    const src = readFileSync("components/matrix/print-view.tsx", "utf8");
    expect(src).toMatch(/width: `\$\{DISH_COL_MM\}mm`/);
    expect(src).toMatch(/width: `\$\{ANSWER_COL_MM\}mm`/);
    expect(src).toMatch(/\{c\.head\}/);
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
    expect(src).toMatch(/item && isFood \? <AllergensDietaryCard/);
    expect(src).toMatch(/<AllergensDietaryCard[^>]*onPatch=\{\(p\) => setDraft/);
  });
  it("Duplicate and What If copy the lists but not the sign-off", () => {
    expect(read("components/editor/recipe-editor.tsx")).toMatch(/newDishPatch\(rest\.category, rest\.dish_allergens/);
    expect(read("components/editor/what-if.tsx")).toMatch(/newDishPatch\(rest\.category, rest\.dish_allergens/);
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
