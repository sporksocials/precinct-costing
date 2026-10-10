import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { rollup } from "@/lib/allergens";
import { badgeModel, FULL_ALLERGENS, MENU_ONLY } from "@/lib/allergen-badges";
import { buildIndex } from "@/lib/costing";
import { BADGE_LABELS, DIET_MARKS, DIET_OPTIONS, dietLegendLines, markExcludedBy, markLegendLines } from "@/lib/diet-legend";
import { describeChanges } from "@/lib/draft-changes";
import { threeWay } from "@/lib/edit-conflict";
import { buildConflictView } from "@/lib/conflict-view";
import { parseKitchenData } from "@/lib/kitchen";
import { buildKitchenModel, dishBadges } from "@/lib/kitchen-model";
import { buildPrintRecipe, type PrintRecipe } from "@/lib/print-recipe";
import { showValue } from "@/lib/undo-change";
import type { DietOptionEntry, Ingredient, MenuItem, RecipeLine, Venue } from "@/lib/types";

const ing = (id: string, name: string, over: Partial<Ingredient> = {}): Ingredient =>
  ({ id, name, category: "Food", supplier_id: 7, supplier_code: "SUP-123", pack_size: 1, pack_unit: "kg", pack_price: 17.08, price_inc_gst: false, gst_free: false, rebate: 0.05, yield_pct: 1, venues: "All", active: true, last_price_update: null, previous_price: 16, source: null, notes: "secret supplier note", updated_at: null, allergens_reviewed: true, allergens: [], ...over }) as Ingredient;
const dish = (over: Partial<MenuItem> = {}): MenuItem => ({ id: "d", name: "Burger", venue_id: 1, category: "Food", section: "Burgers", portions: 1, sell_price_inc: 24, target_override: 0.7, hh_price_inc: 12, active: true, source: null, notes: null, updated_at: "2026-10-02T03:00:00Z", ...over });
const ln = (id: string, component_id: string, qty: number, unit: RecipeLine["unit"], sort: number): RecipeLine => ({ id, parent_type: "item", parent_id: "d", component_type: "ingredient", component_id, qty, unit, note: null, sort });
const VENUES = new Map<number, Venue>([[1, { id: 1, name: "Drift Bar", slug: "drift", sort: 1 }]]);

const INGS = [ing("bun", "Brioche Bun", { allergens: ["gluten"] }), ing("soy", "Soy Sauce", { allergens: ["soy", "gluten"] }), ing("patty", "Beef Patty"), ing("tamari", "Tamari", { allergens: ["soy"] }), ing("gfbun", "GF Bun")];
const LINES = [ln("l1", "bun", 1, "each", 1), ln("l2", "patty", 180, "g", 2), ln("l3", "soy", 20, "ml", 3)];
const GFO: DietOptionEntry = { note: "GF bun, tamari", removed: ["l1", "l3"], added: [{ component_type: "ingredient", component_id: "gfbun", qty: 1, unit: "each" }, { component_type: "ingredient", component_id: "tamari", qty: 15, unit: "ml" }], surcharge_inc: 2 };

function src(item: MenuItem) {
  const index = { ...buildIndex(INGS, [], LINES), items: new Map([[item.id, item]]) };
  return { index, venueById: VENUES };
}
const print = (diet_options: MenuItem["diet_options"], category = "Food") => buildPrintRecipe("item", "d", src(dish({ diet_options, category }))) as PrintRecipe;

describe("legend: marks, options and the dairy rule", () => {
  it("has the three marks with the wording Troy asked for", () => {
    expect(DIET_MARKS.map((m) => [m.letter, m.name])).toEqual([["GF", "Gluten Free"], ["V", "Vegetarian"], ["VG", "Vegan"]]);
    expect(markLegendLines().map((l) => `${l.letter} ${l.text}`)).toEqual(["GF Gluten Free", "V Vegetarian", "VG Vegan"]);
  });
  it("keeps GFO, VO, VGO and renames the dairy option DFO, Dairy Free Option (stored key still dfo)", () => {
    expect(DIET_OPTIONS.map((o) => [o.id, o.letter, o.label])).toEqual([
      ["gfo", "GFO", "Gluten Free Option Available"],
      ["vo", "VO", "Vegetarian Option"],
      ["vgo", "VGO", "Vegan Option"],
      ["dfo", "DFO", "Dairy Free Option"],
    ]);
    expect(dietLegendLines().map((l) => l.text)).toContain("Dairy Free Option");
  });
  it("each mark excludes its option: GF/GFO, V/VO, VG/VGO", () => {
    expect(DIET_MARKS.map((m) => [m.id, m.excludes])).toEqual([["gf", "gfo"], ["v", "vo"], ["vg", "vgo"]]);
    expect(markExcludedBy("dfo")).toBeNull(); // dairy has no mark, so turning DFO on never turns anything off
    expect(markExcludedBy("gfo")).toBe("gf");
  });
  it("no stand-alone dairy free wording survives anywhere in the badge wording", () => {
    const text = [...Object.values(BADGE_LABELS), ...DIET_OPTIONS.flatMap((o) => [o.label, o.definition, o.name]), ...DIET_MARKS.flatMap((m) => [m.label, m.definition])].join(" | ");
    expect(text).not.toMatch(/no dairy/i);
    expect(text).not.toMatch(/dairy free(?! option)/i); // only ever "Dairy Free Option"
    expect(DIET_OPTIONS.find((o) => o.id === "dfo")?.name).toBe("Dairy Free Option");
    expect(DIET_OPTIONS.some((o) => o.label === "Dairy Free" || o.letter === "DF")).toBe(false);
  });
  it("the automatic wording still never claims gluten free (only the three hand-set marks and the option say it)", () => {
    for (const text of Object.values(BADGE_LABELS)) expect(/gluten[\s-]?free(?!\s+option)/i.test(text)).toBe(false);
  });
  it("uses no em or en dashes", () => {
    for (const t of [...DIET_MARKS.flatMap((m) => [m.label, m.definition]), ...markLegendLines().map((l) => l.text)]) expect(/[–—]/.test(t)).toBe(false);
  });
});

describe("no dairy free statement for a dish can be produced", () => {
  it("whatever the ingredients, the diet badges never include a dairy entry", () => {
    const worlds: Ingredient[][] = [[ing("a", "Rice", { allergens_reviewed: true })], [ing("m", "Milk", { allergens: ["milk"] })], [ing("x", "Mystery", { allergens_reviewed: false })], []];
    for (const ings of worlds) {
      const d = dish();
      const lines = ings.map((i, k) => ln(`z${k}`, i.id, 1, "g", k));
      const index = { ...buildIndex(ings, [], lines), items: new Map([[d.id, d]]) };
      const m = badgeModel(rollup({ kind: "item", id: "d" }, index), d, FULL_ALLERGENS);
      expect(m.diet.map((x) => x.id as string).filter((id) => /dairy/i.test(id))).toEqual([]);
      expect(m.diet.map((x) => x.label).join(" ")).not.toMatch(/dairy/i);
    }
  });
  it("no source file names the old badge or its wording any more", () => {
    const out = execSync("grep -rniE 'no_dairy|noDairy|No Dairy Ingredients' lib components app || true", { encoding: "utf8" });
    expect(out.trim()).toBe("");
  });
  it("the vegetarian and vegan derivation still counts dairy as an animal product, and the Milk allergen is untouched", () => {
    const d = dish();
    const ings = [ing("m", "Milk", { allergens: ["milk"] })];
    const index = { ...buildIndex(ings, [], [ln("z", "m", 1, "g", 1)]), items: new Map([[d.id, d]]) };
    const m = badgeModel(rollup({ kind: "item", id: "d" }, index), d, FULL_ALLERGENS);
    expect(m.contains).toEqual(["milk"]);
    expect(m.diet.map((x) => x.id)).toContain("vegetarian"); // milk: vegetarian yes, vegan no
    expect(m.diet.map((x) => x.id)).not.toContain("vegan");
  });
});

describe("badge model: the hand-set marks", () => {
  const model = (diet_options: MenuItem["diet_options"], category = "Food", policy = MENU_ONLY) => {
    const d = dish({ diet_options, category });
    const index = { ...buildIndex(INGS, [], LINES), items: new Map([[d.id, d]]) };
    return badgeModel(rollup({ kind: "item", id: "d" }, index), d, policy);
  };
  it("a dish with none has none (back-compat)", () => {
    for (const v of [undefined, null, {}, { gfo: { note: "x" } }]) expect(model(v as never).marks).toEqual([]);
  });
  it("prints GF, V and VG in order, with their labels, whatever the policy and whatever the ingredients", () => {
    const withGluten = model({ gf: {} });
    expect(withGluten.marks).toEqual([{ id: "gf", letter: "GF", label: "Gluten Free" }]); // the app never second-guesses a hand-set mark
    expect(model({ vg: {}, gf: {} }, "Food", FULL_ALLERGENS).marks.map((k) => k.letter)).toEqual(["GF", "VG"]);
  });
  it("V and VG together print VG only", () => {
    expect(model({ v: {}, vg: {} }).marks.map((k) => k.letter)).toEqual(["VG"]);
  });
  it("a drink carries no marks", () => {
    expect(model({ gf: {}, v: {} }, "Cocktail").marks).toEqual([]);
  });
  it("marks never change the automatic diet badges", () => {
    const a = model({}, "Food", FULL_ALLERGENS).diet;
    const b = model({ gf: {}, vg: {} }, "Food", FULL_ALLERGENS).diet;
    expect(b).toEqual(a);
  });
});

describe("print: the Options block and the marks", () => {
  it("lists options in the order GFO, VO, VGO, DFO with the swap in plain words, then the note", () => {
    const p = print({ dfo: { note: "Oat milk" }, gfo: GFO, vo: { note: "No bacon" } });
    expect(p.options.map((o) => o.letter)).toEqual(["GFO", "VO", "DFO"]);
    expect(p.options[0]).toMatchObject({ label: "Gluten Free Option Available", swap: "Leave out Brioche Bun, Soy Sauce. Add GF Bun 1 ea, Tamari 15 ml.", text: "Leave out Brioche Bun, Soy Sauce. Add GF Bun 1 ea, Tamari 15 ml. GF bun, tamari" });
    expect(p.options[1]).toMatchObject({ swap: null, text: "No bacon" });
    expect(p.options[2]).toMatchObject({ label: "Dairy Free Option", text: "Oat milk" });
  });
  it("a prep, a drink and a dish with no options have no Options block", () => {
    expect(print(undefined).options).toEqual([]);
    expect(print(GFO as never, "Cocktail").options).toEqual([]);
    expect(print({ gfo: { note: "  " } } as never).options).toEqual([]);
  });
  it("a stale or unknown left-out line is skipped, never guessed", () => {
    const p = print({ gfo: { note: "x", removed: ["gone", "l3"], added: [{ component_type: "ingredient", component_id: "ghost", qty: 1, unit: "g" }] } });
    expect(p.options[0].swap).toBe("Leave out Soy Sauce.");
  });
  it("the hand-set marks print in the allergens block as their letters, VG alone when both", () => {
    expect(print({ gf: {}, v: {}, vg: {} }).allergens.marks).toEqual([{ letter: "GF", label: "Gluten Free" }, { letter: "VG", label: "Vegan" }]);
    expect(print({}).allergens.marks).toEqual([]);
  });
  it("never any cost, price, surcharge or GP anywhere in the model, options block included", () => {
    const p = print({ gfo: GFO, dfo: { note: "Oat milk", surcharge_inc: 3, removed: ["l2"] } });
    const keys: string[] = [];
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (keys.push(k), walk(x));
      else if (typeof v === "string") strings.push(v);
    };
    walk(p);
    expect(keys.filter((k) => /price|cost|gp|margin|target|supplier|sell|rebate|pack|deal|surcharge/i.test(k))).toEqual([]);
    expect(strings.join(" | ")).not.toMatch(/\$|17\.08|SUP-123|secret supplier|surcharge|\b2\.00\b/i);
  });
  it("a long Options block still builds (the page then shrinks to the floor, or shows the too-long warning)", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ component_type: "ingredient" as const, component_id: i % 2 ? "tamari" : "gfbun", qty: 10 + i, unit: "g" as const }));
    const p = print({ gfo: { note: "A long note ".repeat(8).trim(), removed: ["l1", "l2", "l3"], added: many }, vo: { note: "No bacon", removed: ["l2"] }, vgo: { note: "Plant patty", removed: ["l2"] }, dfo: { note: "Oat milk" } });
    expect(p.options).toHaveLength(4);
    expect(p.options[0].text.length).toBeGreaterThan(250);
    expect(p.options.every((o) => !/\$/.test(o.text))).toBe(true);
  });
});

describe("kitchen: swaps in plain words, marks, and no price", () => {
  const RAW = (diet_options: unknown, withLineIds = true) => ({
    venue: { slug: "drift", name: "Drift Bar" },
    dishes: [{ id: "d", name: "Burger", section: "Burgers", portions: 1, method: [], plating: [], photo: null, diet_options, allergen_add: null, allergen_remove: null, allergen_notes: null }],
    preps: [],
    ingredients: INGS.map((i) => ({ id: i.id, name: i.name, allergens: i.allergens, allergens_reviewed: true, diet_flags: [] })),
    lines: LINES.map((l) => ({ ...(withLineIds ? { id: l.id } : {}), parent_type: "item", parent_id: "d", component_type: "ingredient", component_id: l.component_id, qty: l.qty, unit: l.unit, note: null, sort: l.sort })),
  });
  const build = (d: unknown, ids = true) => buildKitchenModel(parseKitchenData(RAW(d, ids), "2026-10-10T00:00:00Z")!);

  it("parses the swap, keeps the line ids, and never keeps a surcharge", () => {
    const data = parseKitchenData(RAW({ gfo: GFO, gf: { note: "n" }, vg: {} }), "x")!;
    expect(data.dishes[0].dietOptions.gfo).toEqual({ note: "GF bun, tamari", removed: ["l1", "l3"], added: GFO.added });
    expect(JSON.stringify(data)).not.toMatch(/surcharge/i);
    expect(data.dishes[0].dietMarks).toEqual(["gf", "vg"]);
    expect(data.lines.map((l) => l.lineId)).toEqual(["l1", "l2", "l3"]);
  });
  it("a note-only option is unchanged, and a feed without line ids still works (no swap words)", () => {
    const data = parseKitchenData(RAW({ vo: { note: "No bacon" } }, false), "x")!;
    expect(data.dishes[0].dietOptions).toEqual({ vo: { note: "No bacon" } });
    expect(data.lines.every((l) => l.lineId === null)).toBe(true);
    const m = build({ gfo: GFO }, false);
    expect(dishBadges(m, "d").options[0].swap).toBe("Add GF Bun 1 ea, Tamari 15 ml."); // the left-out names cannot be resolved, so they are not guessed
  });
  it("shows what is left out and added, with the option's note, and no cost", () => {
    const m = build({ gfo: GFO, dfo: { note: "Oat milk" } });
    const b = dishBadges(m, "d");
    expect(b.options.map((o) => [o.letter, o.swap])).toEqual([["GFO", "Leave out Brioche Bun, Soy Sauce. Add GF Bun 1 ea, Tamari 15 ml."], ["DFO", undefined]]);
    expect(b.options[1].label).toBe("Dairy Free Option");
    expect(JSON.stringify(b)).not.toMatch(/\$|surcharge|price|cost/i);
  });
  it("carries the hand-set marks, VG alone when both", () => {
    expect(dishBadges(build({ gf: {}, v: {}, vg: {} }), "d").marks.map((k) => k.letter)).toEqual(["GF", "VG"]);
    expect(dishBadges(build(undefined), "d").marks).toEqual([]);
  });
});

describe("draft, conflict, undo and history carry the swaps and marks", () => {
  const base = dish({ diet_options: { gfo: { note: "GF bun" } } });
  it("a swap-only change is an unsaved change (Diet Options); putting it back is not", () => {
    const next = dish({ diet_options: { gfo: { note: "GF bun", removed: ["l1"] } } });
    const c = describeChanges(base, next, LINES, LINES);
    expect(c.dirty).toBe(true);
    expect(c.labels).toContain("Diet Options");
    expect(describeChanges(base, dish({ diet_options: { gfo: { note: "GF bun" } } }), LINES, LINES).dirty).toBe(false);
  });
  it("a mark is an unsaved change too", () => {
    expect(describeChanges(base, dish({ diet_options: { gfo: { note: "GF bun" }, gf: {} } }), LINES, LINES).dirty).toBe(true);
  });
  it("two people changing the same option differently clash; the sheet tells the swaps apart", () => {
    const mk = (removed: string[]) => dish({ diet_options: { gfo: { note: "GF bun", removed } } });
    const r = threeWay({ base, mine: mk(["l1"]), theirs: mk(["l1", "l3"]), baseLines: LINES, mineLines: LINES, theirsLines: LINES });
    expect(r.conflicts).toHaveLength(1);
    const [v] = buildConflictView(r.conflicts, { componentName: () => "X", venueName: () => "Drift" });
    expect(v.heading).toBe("Diet Options");
    expect(v.mine).toEqual(["GFO: GF bun (1 left out)"]);
    expect(v.theirs).toEqual(["GFO: GF bun (2 left out)"]);
  });
  it("a swap by one person and a price change by another merge without a clash", () => {
    const r = threeWay({ base, mine: dish({ diet_options: { gfo: { note: "GF bun", removed: ["l1"] } } }), theirs: dish({ diet_options: base.diet_options, sell_price_inc: 25 }), baseLines: LINES, mineLines: LINES, theirsLines: LINES });
    expect(r.conflicts).toEqual([]);
  });
  it("undo text and conflict text name the letters, never the raw keys alone", () => {
    expect(showValue("diet_options", { gfo: { note: "x", removed: ["l1"] }, dfo: { note: "y" } })).toBe("GFO (1 left out), DFO");
    expect(showValue("diet_options", { gf: {} })).toBe("GF");
  });
});

describe("Menu Labels, recipe card and legend show the marks and DFO", () => {
  const src2 = (f: string) => readFileSync(f, "utf8");
  it("the grid has a Dietary Marks column beside the options column", () => {
    const t = src2("components/allergen-matrix.tsx");
    expect(t).toMatch(/Dietary Marks/);
    expect(t).toMatch(/MarksCell/);
    expect(t).toMatch(/GF, V, VG, GFO, VO, VGO, DFO/);
    expect(t).not.toMatch(/\bDF\b/);
  });
  it("the recipe card and the kitchen legend read the marks from the shared wording", () => {
    expect(src2("components/allergen-badges.tsx")).toMatch(/markLegendLines/);
    expect(src2("components/kitchen/badges.tsx")).toMatch(/markLegendLines/);
  });
});

describe("the kitchen feed migration keeps prices out of the public feed", () => {
  const mig = readFileSync("supabase/migrations/20261010120000_kitchen_diet_swaps.sql", "utf8");
  it("strips surcharge_inc from every option, sends line ids and the components an option adds", () => {
    expect(mig).toMatch(/e\.value - 'surcharge_inc'/);
    expect(mig).toMatch(/'id', ul\.id/);
    expect(mig).toMatch(/option_added/);
    expect(mig).not.toMatch(/'surcharge_inc',/); // never selected into the feed
  });
  it("is guarded against malformed jsonb so one bad dish cannot break the feed", () => {
    expect(mig).toMatch(/jsonb_typeof\(d\.diet_options\) = 'object'/);
    expect(mig).toMatch(/~\*/); // the uuid shape is checked before the cast
  });
  it("is mirrored in supabase/schema.sql", () => {
    const schema = readFileSync("supabase/schema.sql", "utf8");
    expect(schema).toContain("20261010120000_kitchen_diet_swaps.sql");
    expect(schema).toContain("e.value - 'surcharge_inc'");
  });
});
