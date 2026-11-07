import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { buildIndex } from "@/lib/costing";
import {
  ALLERGENS,
  ALLERGEN_IDS,
  CONTAINS_IDS,
  LEGACY_ALLERGEN_IDS,
  SNAPSHOT_ALLERGEN_IDS,
  expandLegacyAllergens,
  ingredientAllergenState,
  isAllergenId,
  isLegacyAllergenId,
  rollup,
  suggestAllergens,
  summarise,
  type AllergenIndex,
} from "@/lib/allergens";
import { badgeModel, FULL_ALLERGENS } from "@/lib/allergen-badges";
import { DISH_ALLERGEN_IDS, dishCheck, liveCheck, readDishAllergens, readTicks, signOffState, confirmAllergens, sourceLines } from "@/lib/dish-allergens";
import { buildRow, cell } from "@/lib/allergy-matrix";
import { parseKitchenMatrix } from "@/lib/kitchen-matrix";
import { confirmPayload, mainOnly, proposalOnly, startingTicks, toggleTick } from "@/lib/ingredient-review";
import { SYSTEM_PROMPT, builtinItems, parseRequest, proposalPatch, remainingProposals, validateReplyDetailed } from "@/lib/allergen-assist";
import type { Ingredient, MenuItem, Prep, RecipeLine } from "@/lib/types";

/**
 * Onion and Garlic are separate allergens (Brendan, executive chef, 7 Nov 2026). `onion_garlic` stays as a hidden LEGACY id: stored on old
 * records, never shown, ticked or suggested, and read as BOTH Onion and Garlic wherever allergens are read. The re-check snapshot keeps the
 * raw id, so no existing sign-off is invalidated.
 */

const ing = (id: string, name: string, over: Partial<Ingredient> = {}): Ingredient =>
  ({ id, name, category: "Food", supplier_id: null, supplier_code: null, pack_size: 1, pack_unit: "kg", pack_price: 1, price_inc_gst: false, gst_free: false, rebate: 0, yield_pct: 1, venues: "All", active: true, last_price_update: null, previous_price: null, source: null, notes: null, updated_at: null, allergens_reviewed: true, ...over }) as Ingredient;
const prep = (id: string, name: string, over: Partial<Prep> = {}): Prep => ({ id, name, venue_id: 1, prep_type: null, yield_qty: 1, yield_unit: "kg", active: true, source: null, notes: null, ...over });
const item = (id: string, name: string, over: Partial<MenuItem> = {}): MenuItem => ({ id, name, venue_id: 1, category: "Food", section: null, portions: 1, sell_price_inc: 10, target_override: null, hh_price_inc: null, active: true, source: null, notes: null, ...over });
let n = 0;
const line = (parent_type: "item" | "prep", parent_id: string, component_type: "ingredient" | "prep", component_id: string): RecipeLine => ({ id: `l${++n}`, parent_type, parent_id, component_type, component_id, qty: 1, unit: "g", note: null, sort: n });
const mk = (ingredients: Ingredient[], preps: Prep[], items: MenuItem[], lines: RecipeLine[]): AllergenIndex => ({ ...buildIndex(ingredients, preps, lines), items: new Map(items.map((i) => [i.id, i])) });
const dishOf = (ings: Ingredient[], over: Partial<MenuItem> = {}) => {
  const d = item("d", "Dish", over);
  const index = mk(ings, [], [d], ings.map((i) => line("item", "d", "ingredient", i.id)));
  return { d, index, r: rollup({ kind: "item", id: "d" }, index) };
};

describe("the ids", () => {
  it("Onion and Garlic are two chef extras between Chilli and Nitrites; the legacy id is not an allergen any more", () => {
    expect(ALLERGENS.filter((a) => a.group === "extra").map((a) => `${a.id}:${a.label}`)).toEqual(["chilli:Chilli", "onion:Onion", "garlic:Garlic", "nitrites:Nitrites"]);
    expect(CONTAINS_IDS.slice(-4)).toEqual(["chilli", "onion", "garlic", "nitrites"]);
    expect(CONTAINS_IDS).toHaveLength(16);
    expect(DISH_ALLERGEN_IDS).toEqual(CONTAINS_IDS);
    expect(isAllergenId("onion")).toBe(true);
    expect(isAllergenId("garlic")).toBe(true);
    expect(isAllergenId("onion_garlic")).toBe(false); // never offered, never accepted from a suggestion
    expect((ALLERGEN_IDS as readonly string[]).includes("onion_garlic")).toBe(false);
    expect(ALLERGENS.some((a) => (a.id as string) === "onion_garlic")).toBe(false);
  });
  it("the snapshot list is the main ids with the raw legacy id right after garlic, then nitrites", () => {
    expect([...SNAPSHOT_ALLERGEN_IDS]).toEqual(["gluten", "crustacea", "egg", "fish", "milk", "peanuts", "sesame", "soy", "tree_nuts", "lupin", "molluscs", "sulphites", "chilli", "onion", "garlic", "onion_garlic", "nitrites"]);
    // the old relative order of every old id is untouched
    const old = ["gluten", "crustacea", "egg", "fish", "milk", "peanuts", "sesame", "soy", "tree_nuts", "lupin", "molluscs", "sulphites", "chilli", "onion_garlic", "nitrites"];
    expect(SNAPSHOT_ALLERGEN_IDS.filter((x) => old.includes(x))).toEqual(old);
    expect([...LEGACY_ALLERGEN_IDS]).toEqual(["onion_garlic"]);
  });
  it("expandLegacyAllergens turns the legacy id into Onion and Garlic once each, keeps order and passes everything else through", () => {
    expect(expandLegacyAllergens(["milk", "onion_garlic", "nitrites"])).toEqual(["milk", "onion", "garlic", "nitrites"]);
    expect(expandLegacyAllergens(["onion", "onion_garlic", "garlic"])).toEqual(["onion", "garlic"]);
    expect(expandLegacyAllergens([])).toEqual([]);
    expect(expandLegacyAllergens(null)).toEqual([]);
    expect(expandLegacyAllergens(undefined)).toEqual([]);
    expect(expandLegacyAllergens(["alcohol", "bogus"])).toEqual(["alcohol", "bogus"]);
    expect(isLegacyAllergenId("onion_garlic")).toBe(true);
    expect(isLegacyAllergenId("onion")).toBe(false);
    expect(isLegacyAllergenId("toString")).toBe(false);
  });
});

describe("keyword suggestions split Onion from Garlic", () => {
  const ids = (name: string) => suggestAllergens(name).map((s) => s.id).sort();
  it("onion terms propose Onion only", () => {
    for (const w of ["Brown Onions", "Red Shallots", "Eschalots", "Leeks", "Chives", "Scallions", "Spring Onion", "French Onion Soup Mix"]) expect(ids(w), w).toEqual(expect.arrayContaining(["onion"]));
    for (const w of ["Brown Onions", "Red Shallots", "Eschalots", "Leeks", "Chives", "Scallions", "Spring Onion"]) expect(ids(w), w).not.toContain("garlic");
  });
  it("garlic proposes Garlic only", () => {
    expect(ids("Garlic Cloves")).toEqual(["garlic"]);
    expect(ids("Garlic Powder")).toEqual(["garlic"]);
    expect(ids("Black Garlic")).toEqual(["garlic"]);
  });
  it("mixed items that normally carry both propose both", () => {
    for (const w of ["Aioli", "Basil Pesto", "Tzatziki", "Sofrito", "Soffritto", "Mirepoix"]) expect(ids(w), w).toEqual(expect.arrayContaining(["onion", "garlic"]));
  });
  it("never proposes the legacy id", () => {
    for (const w of ["Aioli", "Garlic Bread", "Spring Onion", "Mirepoix"]) expect(ids(w)).not.toContain("onion_garlic");
  });
});

describe("a legacy onion_garlic on an INGREDIENT reads as Onion and Garlic everywhere", () => {
  const legacy = ing("a", "Seasoning Mix", { allergens: ["onion_garlic", "nitrites"] });
  it("the ingredient state", () => {
    const st = ingredientAllergenState(legacy);
    expect(st.confirmed).toEqual(["onion", "garlic", "nitrites"]);
    expect(st.confirmed as string[]).not.toContain("onion_garlic");
  });
  it("the roll-up, summary and badges", () => {
    const { r, d } = dishOf([legacy]);
    expect(r.cells.onion.state).toBe("contains");
    expect(r.cells.garlic.state).toBe("contains");
    expect(r.cells.onion.sources).toEqual(["Seasoning Mix"]);
    expect(summarise(r).contains).toEqual(["onion", "garlic", "nitrites"]);
    const m = badgeModel(r, d, FULL_ALLERGENS);
    expect(m.contains).toEqual(["onion", "garlic", "nitrites"]);
  });
  it("a prep's or dish's chef override with the legacy id adds or removes BOTH", () => {
    const i1 = ing("i1", "Onion Powder", { allergens: ["onion", "garlic"] });
    const p = prep("p1", "Base", { allergen_remove: ["onion_garlic"] });
    const d = item("d", "Dish");
    const idx = mk([i1], [p], [d], [line("item", "d", "prep", "p1"), line("prep", "p1", "ingredient", "i1")]);
    const r = rollup({ kind: "item", id: "d" }, idx);
    expect(r.cells.onion.state).toBe("none");
    expect(r.cells.garlic.state).toBe("none");
    const p2 = prep("p2", "Base 2", { allergen_add: ["onion_garlic"] });
    const d2 = item("d2", "Dish 2");
    const r2 = rollup({ kind: "item", id: "d2" }, mk([], [p2], [d2], [line("item", "d2", "prep", "p2")]));
    expect(r2.cells.onion.state).toBe("contains");
    expect(r2.cells.garlic.state).toBe("contains");
    expect(r2.cells.onion.sources).toEqual(["Chef"]);
  });
  it("a made-without note saved under the legacy id applies to both", () => {
    const i1 = ing("i1", "Garlic Oil", { allergens: ["garlic"] });
    const d = item("d", "Dish", { allergen_notes: { onion_garlic: "no raw garlic" } } as Partial<MenuItem>);
    const r = rollup({ kind: "item", id: "d" }, mk([i1], [], [d], [line("item", "d", "ingredient", "i1")]));
    expect(r.cells.garlic.note).toBe("no raw garlic");
    expect(r.cells.onion.note).toBe("no raw garlic");
  });
  it("the dish check derives Onion and Garlic and names the ingredient", () => {
    const { d, index } = dishOf([legacy]);
    const c = dishCheck(d, index);
    expect(c.derived).toEqual(["onion", "garlic", "nitrites"]);
    expect(c.contains).toEqual(["onion", "garlic", "nitrites"]);
    const lines = sourceLines(c.r, c.derived, c.added);
    expect(lines.map((l) => `${l.label} · ${l.text}`)).toEqual(["Onion · Seasoning Mix", "Garlic · Seasoning Mix", "Nitrites · Seasoning Mix"]);
  });
});

describe("a legacy onion_garlic on a stored DISH section reads as both, in the matrix and on the iPad", () => {
  const stored = { contains: ["milk", "onion_garlic"], without: {}, confirmed_at: "2026-10-10T03:00:00.000Z" };
  it("the tolerant reader expands it", () => {
    const da = readDishAllergens(stored)!;
    expect(da.contains).toEqual(["milk", "onion", "garlic"]);
    expect(da.contains as string[]).not.toContain("onion_garlic");
    expect(readDishAllergens({ contains: ["onion_garlic"], added: ["onion_garlic"], basis: ["onion_garlic"] })).toMatchObject({ contains: ["onion", "garlic"], added: ["onion", "garlic"], basis: ["onion", "garlic"] });
  });
  it("the matrix cells: Onion red, Garlic red, everything else untouched", () => {
    const da = readDishAllergens(stored)!;
    const row = buildRow({ id: "d", name: "Dish", section: null, allergens: da, marks: [], options: {} });
    expect(row.cells.onion.state).toBe("red");
    expect(row.cells.garlic.state).toBe("red");
    expect(row.cells.dairy.state).toBe("red");
    expect(row.cells.fish.state).toBe("green");
    // even a section built by hand with the raw id (not through the reader) is read as both
    const raw = { id: "d", name: "Dish", section: null, allergens: { ...da, contains: ["onion_garlic"] as never }, marks: [], options: {} };
    expect(cell(raw, "onion").state).toBe("red");
    expect(cell(raw, "garlic").state).toBe("red");
  });
  it("the iPad parser reads the feed's stored list the same way", () => {
    const d = parseKitchenMatrix({ venue: { slug: "drift", name: "Drift Bar" }, dishes: [{ id: "x", name: "Old Dish", section: "Mains", dish_allergens: stored, marks: [], options: {} }] }, "2026-11-07T00:00:00Z")!;
    expect(d.dishes[0].allergens?.contains).toEqual(["milk", "onion", "garlic"]);
    const row = buildRow(d.dishes[0]);
    expect(row.cells.onion.state).toBe("red");
    expect(row.cells.garlic.state).toBe("red");
  });
});

describe("the re-check snapshot keeps the RAW ids, so every existing sign-off stays valid", () => {
  const legacy = ing("a", "Seasoning Mix", { allergens: ["nitrites", "onion_garlic"] });
  it("the live snapshot holds onion_garlic as stored, never expanded", () => {
    const { d, index } = dishOf([legacy]);
    expect(liveCheck(d, index).ticks["ingredient:a"]).toEqual({ a: ["onion_garlic", "nitrites"], r: true });
  });
  it("new ids sort right before the legacy id", () => {
    const i = ing("b", "Everything", { allergens: ["nitrites", "onion_garlic", "garlic", "chilli", "onion", "alcohol", "milk"] });
    const { d, index } = dishOf([i]);
    expect(liveCheck(d, index).ticks["ingredient:b"]).toEqual({ a: ["milk", "chilli", "onion", "garlic", "onion_garlic", "nitrites"], r: true });
  });
  it("a sign-off stored before the split (raw legacy id in its snapshot) is still VALID", () => {
    const { d, index } = dishOf([legacy]);
    const live = liveCheck(d, index);
    const stored = { contains: ["onion_garlic", "nitrites"], without: {}, confirmed_at: "2026-10-10T03:00:00.000Z", confirmed_by: "chef@example.com", components: live.components, ticks: { "ingredient:a": { a: ["onion_garlic", "nitrites"], r: true }, "item:d": { add: [], rem: [] } } };
    expect(signOffState(readDishAllergens(stored), live)).toBe("valid");
  });
  it("saving the ingredient with the normal ids is a real change: the sign-off needs a re-check", () => {
    const { d, index } = dishOf([legacy]);
    const live = liveCheck(d, index);
    const stored = { contains: ["onion_garlic", "nitrites"], without: {}, confirmed_at: "2026-10-10T03:00:00.000Z", components: live.components, ticks: live.ticks };
    const after = dishOf([ing("a", "Seasoning Mix", { allergens: ["onion", "garlic", "nitrites"] })]);
    expect(signOffState(readDishAllergens(stored), liveCheck(after.d, after.index))).toBe("changed");
  });
  it("a stored snapshot is read back in the snapshot order and keeps the legacy id", () => {
    expect(readTicks({ "ingredient:a": { a: ["nitrites", "onion_garlic", "garlic", "bogus", "onion"], r: true }, "prep:p": { add: ["garlic", "onion"], rem: ["onion_garlic"] } })).toEqual({
      "ingredient:a": { a: ["onion", "garlic", "onion_garlic", "nitrites"], r: true },
      "prep:p": { add: ["onion", "garlic"], rem: ["onion_garlic"] },
    });
  });
  it("confirming derives Onion and Garlic from a legacy ingredient and stores the snapshot raw", () => {
    const { d, index } = dishOf([legacy]);
    const c = dishCheck(d, index);
    const entry = confirmAllergens(null, "chef@example.com", "2026-11-07T00:00:00.000Z", { derived: c.derived, components: c.live.components, ticks: c.live.ticks });
    expect(entry.contains).toEqual(["onion", "garlic", "nitrites"]);
    expect(entry.ticks?.["ingredient:a"]).toEqual({ a: ["onion_garlic", "nitrites"], r: true });
  });
});

describe("the ingredient review and the ingredient page", () => {
  it("a legacy ingredient starts with BOTH the Onion and Garlic chips ticked", () => {
    const st = ingredientAllergenState(ing("a", "Seasoning Mix", { allergens: ["onion_garlic", "milk"] }));
    expect(startingTicks(st.confirmed, [])).toEqual(["milk", "onion", "garlic"]);
    // even when the raw stored ids are passed straight in
    expect(mainOnly(["nitrites", "onion_garlic"])).toEqual(["onion", "garlic", "nitrites"]);
    expect(proposalOnly(["onion_garlic"], ["onion", "garlic", "chilli"])).toEqual(["chilli"]);
  });
  it("Confirm writes the normal ids and drops onion_garlic, so a chef can untick one", () => {
    const start = startingTicks(ingredientAllergenState(ing("a", "x", { allergens: ["onion_garlic"] })).confirmed, []);
    expect(start).toEqual(["onion", "garlic"]);
    expect(confirmPayload(["onion_garlic", "alcohol"], start)).toEqual({ allergens: ["onion", "garlic", "alcohol"], allergens_reviewed: true });
    const onlyOnion = toggleTick(start, "garlic");
    expect(confirmPayload(["onion_garlic"], onlyOnion)).toEqual({ allergens: ["onion"], allergens_reviewed: true });
    expect(confirmPayload(["onion_garlic"], toggleTick(onlyOnion, "onion")).allergens).toEqual([]);
  });
  it("the review screen has 16 chips: it draws CONTAINS_IDS", () => {
    const src = readFileSync("components/ingredient-review/review-page.tsx", "utf8");
    expect(src).toMatch(/CONTAINS_IDS\.map/);
    expect(src).toMatch(/The 16 main allergen chips/);
  });
});

describe("Smart Tidy and the built-in name check", () => {
  const req = (allergens: string[] = []) => ({ ingredients: [{ key: "a", name: "Aioli", category: "Sauces", allergens, dietFlags: [] }] });
  it("the prompt offers Onion and Garlic as two ids and never mentions the legacy id", () => {
    expect(SYSTEM_PROMPT).toMatch(/- onion: Onion \(chef extra\)/);
    expect(SYSTEM_PROMPT).toMatch(/- garlic: Garlic \(chef extra\)/);
    expect(SYSTEM_PROMPT).not.toMatch(/onion_garlic/);
    expect(SYSTEM_PROMPT).not.toMatch(/alcohol: Alcohol/); // still not offered
    expect(SYSTEM_PROMPT).not.toMatch(/[–—]/);
  });
  it("accepts a reply with onion and garlic", () => {
    const input = parseRequest(req())!;
    const reply = JSON.stringify({ items: [{ key: "a", allergens: [{ id: "garlic", reason: "Aioli is made with garlic." }, { id: "egg", reason: "Aioli is made with egg." }], diet: [] }] });
    const r = validateReplyDetailed(reply, input);
    expect("items" in r && r.items[0].allergens.map((a) => a.id)).toEqual(["garlic", "egg"]);
  });
  it("is still strict: a reply that uses the legacy id, alcohol or an unknown id is rejected or dropped", () => {
    const input = parseRequest(req())!;
    const legacy = JSON.stringify({ items: [{ key: "a", allergens: [{ id: "onion_garlic", reason: "Aioli has garlic." }], diet: [] }] });
    expect(validateReplyDetailed(legacy, input)).toEqual({ reason: "bad_reply_allergen" });
    const alcohol = JSON.stringify({ items: [{ key: "a", allergens: [{ id: "alcohol", reason: "Contains alcohol." }], diet: [] }] });
    const r = validateReplyDetailed(alcohol, input);
    expect("items" in r && r.items[0].allergens).toEqual([]);
    const dupe = JSON.stringify({ items: [{ key: "a", allergens: [{ id: "onion", reason: "Has onion." }, { id: "onion", reason: "Has onion." }], diet: [] }] });
    expect(validateReplyDetailed(dupe, input)).toEqual({ reason: "bad_reply_allergen" });
  });
  it("a legacy tick counts as already ticked for both ids, so neither is proposed again", () => {
    const input = parseRequest(req(["onion_garlic"]))!;
    expect(input.ingredients[0].allergens).toEqual(["onion", "garlic"]);
    const reply = JSON.stringify({ items: [{ key: "a", allergens: [{ id: "garlic", reason: "Aioli is made with garlic." }, { id: "egg", reason: "Aioli is made with egg." }], diet: [] }] });
    const r = validateReplyDetailed(reply, input);
    expect("items" in r && r.items[0].allergens.map((a) => a.id)).toEqual(["egg"]);
    const left = remainingProposals({ allergens: ["onion_garlic"], diet_flags: [] }, { allergens: [{ id: "garlic", reason: "Garlic." }, { id: "egg", reason: "Egg." }], diet: [] });
    expect(left.allergens.map((a) => a.id)).toEqual(["egg"]);
  });
  it("accepting a proposal on a legacy ingredient writes the normal ids and Undo restores the stored value", () => {
    const res = proposalPatch({ allergens: ["onion_garlic"], diet_flags: [] }, { allergens: [{ id: "egg", reason: "Egg." }], diet: [] })!;
    expect(res.patch.allergens).toEqual(["onion", "garlic", "egg"]);
    expect(res.previous.allergens).toEqual(["onion_garlic"]);
  });
  it("the built-in check proposes Onion and Garlic separately and both for the mixed items", () => {
    const run = (name: string) => builtinItems({ ingredients: [{ key: "a", name, category: "", allergens: [], dietFlags: [] }] })[0].allergens.map((a) => a.id).sort();
    expect(run("Red Onion")).toEqual(["onion"]);
    expect(run("Garlic Cloves")).toEqual(["garlic"]);
    expect(run("Tzatziki")).toEqual(expect.arrayContaining(["garlic", "onion"]));
    expect(run("Aioli")).toEqual(expect.arrayContaining(["garlic", "onion", "egg"]));
    for (const w of ["Red Onion", "Garlic Cloves", "Tzatziki", "Aioli"]) expect(run(w)).not.toContain("onion_garlic");
  });
});

describe("nothing reads the raw legacy id by itself", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      if (f === "node_modules" || f === ".next" || f.startsWith(".")) return [];
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
    });
  // strip comments so a mention in a doc comment is not a read
  const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  it("the quoted legacy id appears in code only in lib/allergens.ts (the one expansion) and lib/dish-allergens.ts (the snapshot and the legacy note)", () => {
    const hits = ["lib", "components", "app"].flatMap(walk).filter((p) => /["'`]onion_garlic["'`]/.test(code(p))).map((p) => p.replace(/\\/g, "/"));
    expect(hits.sort()).toEqual(["lib/allergens.ts", "lib/dish-allergens.ts"]);
  });
  it("every module that reads a stored allergen list goes through the one helper", () => {
    // the readers: the roll-up (cleanAllergens), the dish section reader (inOrder), the matrix, the review rules, the assist route and the editors
    expect(code("lib/allergens.ts")).toMatch(/cleanAllergens[\s\S]{0,200}expandLegacyAllergens/);
    expect(code("lib/dish-allergens.ts")).toMatch(/inOrder[\s\S]{0,200}expandLegacyAllergens/);
    expect(code("lib/allergy-matrix.ts")).toMatch(/containsOf[\s\S]{0,200}expandLegacyAllergens/);
    expect(code("lib/ingredient-review.ts")).toMatch(/mainOnly[\s\S]{0,200}expandLegacyAllergens/);
    expect(code("lib/allergen-assist.ts")).toMatch(/expandLegacyAllergens/);
    expect(code("components/allergen-picker.tsx")).toMatch(/expandLegacyAllergens\(rec\.allergen_add\)/);
  });
  it("no screen offers the legacy id as a chip: every chip list is built from CONTAINS_IDS or ALLERGENS", () => {
    for (const f of ["components/allergen-picker.tsx", "components/editor/dish-allergens.tsx", "components/ingredient-review/review-page.tsx"]) {
      expect(readFileSync(f, "utf8"), f).toMatch(/ALLERGENS|CONTAINS_IDS|DISH_ALLERGEN_IDS/);
    }
  });
});
