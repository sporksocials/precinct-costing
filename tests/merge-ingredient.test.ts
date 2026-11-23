import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildIndex } from "@/lib/costing";
import { confirmAllergens, dishCheck, isSignOffValid, readDishAllergens } from "@/lib/dish-allergens";
import {
  MERGE_NOT_READY,
  MERGE_NO_UNDO,
  MERGE_ROW_SUB,
  MERGE_ROW_TITLE,
  carrySignOff,
  dealsMove,
  isMergeMissing,
  mergeErrorMessage,
  mergedName,
  mergedToast,
  parseMergeResult,
  perBaseText,
  planMerge,
  sameAllergenSnapshot,
  scaledPacks,
  type MergeData,
} from "@/lib/merge-ingredient";
import type { Ingredient, IngredientDeal, MenuItem, Prep, RecipeLine } from "@/lib/types";

/** Merge Into Another Ingredient (Troy, 23 Nov 2026): the plan the person reads before anything is written. The write is tested in merge-ingredient-sql. */
const ing = (id: string, name: string, over: Partial<Ingredient> = {}): Ingredient =>
  ({ id, name, category: "Food", supplier_id: 1, supplier_code: null, pack_size: 1, pack_unit: "L", pack_price: 8.75, price_inc_gst: false, gst_free: false, rebate: 0, yield_pct: 1, venues: "All", active: true, last_price_update: null, previous_price: null, source: null, notes: null, updated_at: null, allergens: ["sulphites"], allergens_reviewed: true, diet_flags: [], ...over }) as Ingredient;
const item = (id: string, name: string, over: Partial<MenuItem> = {}): MenuItem => ({ id, name, venue_id: 1, category: "Food", section: "Mains", portions: 1, sell_price_inc: 20, active: true, allergen_add: [], allergen_remove: [], dish_allergens: null, ...over }) as unknown as MenuItem;
const prep = (id: string, name: string): Prep => ({ id, name, venue_id: 1, prep_type: null, yield_qty: 1, yield_unit: "kg", active: true, allergen_add: [], allergen_remove: [] }) as unknown as Prep;
let n = 0;
const line = (ptype: "item" | "prep", parent: string, comp: string, unit: RecipeLine["unit"] = "ml", ctype: "ingredient" | "prep" = "ingredient"): RecipeLine => ({ id: `l${++n}`, parent_type: ptype, parent_id: parent, component_type: ctype, component_id: comp, qty: 30, unit, note: null, sort: n }) as RecipeLine;

const S = ing("s", "Lime Juice (L)");
const T = ing("t", "Lime Juice (2L)", { pack_size: 2, pack_price: 17.5 });
const FLOUR = ing("flour", "Flour", { pack_unit: "kg", allergens: ["gluten"] });
const base = (over: Partial<MergeData> = {}): MergeData => {
  const items = [item("d1", "Fish Tacos"), item("d2", "Green Salad"), item("d3", "Shortbread"), item("c1", "Margarita", { category: "Cocktail" })];
  const preps = [prep("p1", "Lime Dressing")];
  const lines = [line("item", "d1", "s"), line("item", "d1", "flour", "g"), line("item", "d2", "p1", "g", "prep"), line("prep", "p1", "s", "L"), line("item", "d3", "flour", "g"), line("item", "c1", "s")];
  return { lines, items, preps, ingredients: [S, T, FLOUR], gst: 0.1, today: "2026-11-23", orderProducts: [], venues: [{ id: 1, name: "Drift" }, { id: 2, name: "Chiobu" }], ...over };
};
/** the data with the given dishes confirmed by the app's own Confirm */
function confirmed(d: MergeData, ids: string[]): MergeData {
  const index = { ...buildIndex(d.ingredients as Ingredient[], d.preps as Prep[], d.lines as RecipeLine[]), items: new Map(d.items.map((i) => [i.id, i])) };
  const items = d.items.map((it) => {
    if (!ids.includes(it.id)) return it;
    const c = dishCheck(it, index);
    return { ...it, dish_allergens: confirmAllergens(null, "chef@example.com", "2026-11-20T00:00:00.000Z", { derived: c.derived, components: c.live.components, ticks: c.live.ticks }) };
  });
  return { ...d, items };
}

describe("planMerge: what moves", () => {
  it("counts the recipe lines and names the dishes, drinks and preps", () => {
    const p = planMerge(S, T, base());
    expect(p.canMerge).toBe(true);
    expect(p.unitsCompatible).toBe(true);
    expect(p.lineCount).toBe(3);
    expect(p.recipes.map((r) => r.name)).toEqual(["Fish Tacos", "Lime Dressing", "Margarita"]);
    expect(p.recipesText).toBe("3 recipes will use Lime Juice (2L) instead: Fish Tacos, Lime Dressing and Margarita.");
    expect(p.sourceText).toContain("renamed “Lime Juice (L) (merged)” and made inactive");
  });
  it("names eight, then says how many more", () => {
    const d = base();
    const items = Array.from({ length: 11 }, (_, k) => item(`x${k}`, `Dish ${String(k + 1).padStart(2, "0")}`));
    const p = planMerge(S, T, { ...d, items, lines: items.map((i) => line("item", i.id, "s")) });
    expect(p.recipesText).toBe("11 recipes will use Lime Juice (2L) instead: Dish 01, Dish 02, Dish 03, Dish 04, Dish 05, Dish 06, Dish 07, Dish 08 and 3 more.");
  });
  it("says so when nothing uses it", () => {
    const p = planMerge(S, T, base({ lines: [] }));
    expect(p.lineCount).toBe(0);
    expect(p.recipesText).toBe("Lime Juice (L) is not used in any recipe.");
    expect(p.canMerge).toBe(true);
  });
});

describe("planMerge: the unit rule", () => {
  it("refuses different kinds of unit and never converts", () => {
    const p = planMerge(S, FLOUR, base());
    expect(p.canMerge).toBe(false);
    expect(p.unitsCompatible).toBe(false);
    expect(p.blockers).toEqual(["Lime Juice (L) is priced per L and Flour per kg. They are different kinds of unit, so they cannot be merged."]);
    expect(p.price.change).toBeNull();
    expect(p.price.text).not.toMatch(/more|less|No cost change/);
  });
  it("refuses when a line that would move is in a unit the target cannot be costed in (the costing rule for a line)", () => {
    const d = base();
    const p = planMerge(S, T, { ...d, lines: [...d.lines, line("item", "d3", "s", "g")] });
    expect(p.canMerge).toBe(false);
    expect(p.blockers).toEqual(["1 recipe line uses a unit Lime Juice (2L) cannot be costed in (Shortbread). Fix that line first."]);
  });
  it("a gelato serve line counts as a line", () => {
    const p = planMerge(S, T, base({ gelatoServeLines: [{ id: "g1", ingredient_id: "s", unit: "each" }] }));
    expect(p.canMerge).toBe(false);
    expect(p.blockers[0]).toMatch(/^1 recipe line uses a unit/);
  });
  it("refuses the same ingredient and an inactive target", () => {
    expect(planMerge(S, S, base()).blockers).toEqual(["Pick a different ingredient to keep."]);
    expect(planMerge(S, { ...T, active: false }, base()).blockers).toEqual(["Lime Juice (2L) is inactive. Make it active first, or keep a different ingredient."]);
  });
});

describe("planMerge: the cost difference per base unit, in plain words", () => {
  it("no change when both cost the same per litre", () => {
    const p = planMerge(S, T, base());
    expect(p.price.text).toBe("Lime Juice (L) costs $8.75 per L. Lime Juice (2L) costs $8.75 per L. No cost change.");
    expect(p.price.change).toBe(0);
  });
  it("more, less, and under one percent", () => {
    expect(planMerge(S, { ...T, pack_price: 18.2 }, base()).price.text).toBe("Lime Juice (L) costs $8.75 per L. Lime Juice (2L) costs $9.10 per L. Recipes will cost 4% more for this ingredient.");
    expect(planMerge(S, { ...T, pack_price: 14 }, base()).price.text).toBe("Lime Juice (L) costs $8.75 per L. Lime Juice (2L) costs $7.00 per L. Recipes will cost 20% less for this ingredient.");
    expect(planMerge(S, { ...T, pack_price: 17.6 }, base()).price.text).toMatch(/Recipes will cost less than 1% more for this ingredient\.$/);
  });
  it("counts yield, and reads an each price without the word per", () => {
    const a = ing("a", "Lime", { pack_unit: "each", pack_size: 10, pack_price: 5 });
    const b = ing("b", "Limes", { pack_unit: "each", pack_size: 10, pack_price: 5, yield_pct: 0.5 });
    expect(planMerge(a, b, base({ ingredients: [a, b], lines: [] })).price.text).toBe("Lime costs $0.50 each. Limes costs $1.00 each. Recipes will cost 100% more for this ingredient.");
    expect(perBaseText(8.75, "kg")).toBe("$8.75 per kg");
    // a very cheap item: two different costs never read the same, and the difference is still said
    const c = ing("c", "Napkin", { pack_unit: "each", pack_size: 1000, pack_price: 4 });
    const e = ing("e", "Napkins", { pack_unit: "each", pack_size: 1000, pack_price: 4.9 });
    expect(planMerge(c, e, base({ ingredients: [c, e], lines: [] })).price.text).toBe("Napkin costs $0.0040 each. Napkins costs $0.0049 each. Recipes will cost 23% more for this ingredient.");
  });
  it("says so when one has no price", () => {
    expect(planMerge({ ...S, pack_price: 0 }, T, base()).price.text).toBe("Lime Juice (L) has no price. Lime Juice (2L) costs $8.75 per L, so recipes will start costing that for this ingredient.");
    expect(planMerge(S, { ...T, pack_price: 0 }, base()).price.text).toMatch(/Lime Juice \(2L\) has no price yet, so recipes will cost nothing for this ingredient until it is priced\.$/);
  });
  it("a deal on the source counts in what recipes cost today, and the plan says whether it moves", () => {
    const deal = { id: "k", ingredient_id: "s", kind: "percent_off", pct_off: 0.2, buy_qty: null, free_qty: null, min_qty: null, unit_price: null, special_pack_price: null, starts_on: null, ends_on: null, note: null, active: true } as unknown as IngredientDeal;
    // different pack sizes: the deal stays behind, so recipes go from $7.00 to $8.75 per L
    const left = planMerge(S, T, base({ deals: [deal] }));
    expect(left.counts).toMatchObject({ dealsMoved: 0, dealsLeft: 1 });
    expect(left.price.text).toBe("Lime Juice (L) costs $7.00 per L. Lime Juice (2L) costs $8.75 per L. Recipes will cost 25% more for this ingredient.");
    expect(left.otherText.join(" ")).toMatch(/1 supplier deal on Lime Juice \(L\) is not moved and will stop applying\. Add it to Lime Juice \(2L\) if it still applies\./);
    // the same pack, and the target has none: it moves, and the cost stays where it was
    const same = { ...T, pack_size: 1, pack_price: 8.75 };
    const moved = planMerge(S, same, base({ deals: [deal], ingredients: [S, same, FLOUR] }));
    expect(moved.counts).toMatchObject({ dealsMoved: 1, dealsLeft: 0 });
    expect(moved.price.text).toMatch(/costs \$7\.00 per L\. Lime Juice \(2L\) costs \$7\.00 per L\. No cost change\.$/);
    expect(dealsMove(S, same, [deal])).toBe(true);
    expect(dealsMove(S, T, [deal])).toBe(false);
    expect(dealsMove(S, same, [deal, { ...deal, ingredient_id: "t" }])).toBe(false);
  });
});

describe("planMerge: allergen sign-offs", () => {
  it("identical ticks: confirmed dishes keep their sign-off, through a nested prep too", () => {
    const d = confirmed(base(), ["d1", "d2", "d3"]);
    const p = planMerge(S, T, d);
    expect(p.sameAllergens).toBe(true);
    expect(p.kept.map((k) => k.name)).toEqual(["Fish Tacos", "Green Salad"]);
    expect(p.recheck).toEqual([]);
    expect(p.signOffText).toEqual(["2 confirmed dishes keep their allergen sign-off: Fish Tacos and Green Salad."]);
  });
  it("different ticks: those dishes are named for a re-check and nothing is carried", () => {
    const d = confirmed(base(), ["d1", "d2", "d3"]);
    const milk = { ...T, allergens: ["sulphites", "milk"] };
    const p = planMerge(S, milk, { ...d, ingredients: [S, milk, FLOUR] });
    expect(p.sameAllergens).toBe(false);
    expect(p.kept).toEqual([]);
    expect(p.recheck.map((k) => k.name)).toEqual(["Fish Tacos", "Green Salad"]);
    expect(p.signOffText).toEqual(["Lime Juice (L) and Lime Juice (2L) do not have the same allergen ticks, so 2 confirmed dishes will need their allergens re-checked: Fish Tacos and Green Salad."]);
    expect(p.canMerge).toBe(true);
  });
  it("an unreviewed target is a different snapshot", () => {
    expect(sameAllergenSnapshot(S, { ...T, allergens_reviewed: false })).toBe(false);
    expect(sameAllergenSnapshot({ ...S, allergens: ["milk", "gluten"] }, { ...T, allergens: ["gluten", "alcohol", "milk"] })).toBe(true);
    expect(sameAllergenSnapshot({ ...S, allergens: null }, { ...T, allergens: [] })).toBe(true);
  });
  it("says nothing when no confirmed dish uses it", () => {
    expect(planMerge(S, T, confirmed(base(), ["d3"])).signOffText).toEqual([]);
  });
});

describe("carrySignOff: the rewrite of one stored sign-off", () => {
  const d = confirmed(base(), ["d1"]);
  const stored = d.items.find((i) => i.id === "d1")!.dish_allergens as unknown as Record<string, any>;
  const validAfter = (raw: unknown, lines: RecipeLine[]) => {
    const it = { ...d.items.find((i) => i.id === "d1")!, dish_allergens: raw } as MenuItem;
    const index = { ...buildIndex(d.ingredients as Ingredient[], d.preps as Prep[], lines), items: new Map([[it.id, it]]) };
    return isSignOffValid(readDishAllergens(raw), dishCheck(it, index).live);
  };
  const moved = (d.lines as RecipeLine[]).map((l) => (l.component_id === "s" ? { ...l, component_id: "t" } : l));

  it("swaps the component key, moves the ticks entry, keeps everything else, and the sign-off is still valid", () => {
    const out = carrySignOff(stored, "s", "t") as Record<string, any>;
    expect(out.components).toEqual(["ingredient:flour", "ingredient:t"]);
    expect(out.ticks["ingredient:t"]).toEqual({ a: ["sulphites"], r: true });
    expect(out.ticks["ingredient:s"]).toBeUndefined();
    expect(out.confirmed_at).toBe(stored.confirmed_at);
    expect(out.confirmed_by).toBe("chef@example.com");
    expect(out.contains).toEqual(stored.contains);
    expect(validAfter(out, moved)).toBe(true);
    // without the rewrite the same dish needs a re-check: this is what merging by hand in SQL did
    expect(validAfter(stored, moved)).toBe(false);
    // the input is never changed in place
    expect(stored.components).toContain("ingredient:s");
  });
  it("when the target is already there, the source's entry is just dropped", () => {
    const both = { ...stored, components: [...stored.components, "ingredient:t"].sort(), ticks: { ...stored.ticks, "ingredient:t": { a: ["sulphites"], r: true } } };
    const out = carrySignOff(both, "s", "t") as Record<string, any>;
    expect(out.components).toEqual(["ingredient:flour", "ingredient:t"]);
    expect(Object.keys(out.ticks).sort()).toEqual(["ingredient:flour", "ingredient:t", "item:d1"]);
  });
  it("returns the same object when there is nothing to change, and tolerates anything that is not a section", () => {
    expect(carrySignOff(stored, "nope", "t")).toBe(stored);
    for (const v of [null, undefined, "x", 3, [], { contains: [] }]) expect(carrySignOff(v, "s", "t")).toBe(v);
  });
});

describe("order lists and the rest", () => {
  it("items move; where the venue already orders the target, the source's item comes off that list", () => {
    const orderProducts = [
      { id: "o1", venue_id: 1, name: "Lime Juice (L)", active: true, ingredient_id: "s" },
      { id: "o2", venue_id: 1, name: "Lime Juice (2L)", active: true, ingredient_id: "t" },
      { id: "o3", venue_id: 2, name: "Lime Juice (L)", active: true, ingredient_id: "s" },
    ];
    const p = planMerge(S, { ...T, supplier_id: 2 }, base({ orderProducts }));
    expect(p.counts).toMatchObject({ orderItems: 2, orderItemsStopped: 1 });
    expect(p.orderText).toEqual([
      "1 order list item moves to Lime Juice (2L) (Chiobu).",
      "It will be ordered from the supplier of Lime Juice (2L).",
      "Drift already orders Lime Juice (2L), so Lime Juice (L) comes off its order list.",
    ]);
  });
  it("says so when the order lists could not be read, and nothing when there are none", () => {
    expect(planMerge(S, T, base({ orderProducts: null })).orderText).toEqual(["The order lists could not be read. Any order list item linked to it moves too."]);
    expect(planMerge(S, T, base()).orderText).toEqual([]);
  });
  it("tap beers, gelato serve lines and menu option additions are counted", () => {
    const d = base();
    const withOption = d.items.map((i) => (i.id === "d1" ? ({ ...i, diet_options: { gfo: { note: "", added: [{ component_type: "ingredient", component_id: "s", qty: 15, unit: "ml" }] } } } as unknown as MenuItem) : i));
    const p = planMerge(S, T, { ...d, items: withOption, beers: [{ id: "b1", name: "Tap A", ingredient_id: "s" }], gelatoServeLines: [{ id: "g1", ingredient_id: "s", unit: "ml" }] });
    expect(p.counts).toMatchObject({ beers: 1, serveLines: 1, optionAdds: 1 });
    expect(p.otherText).toEqual([
      "1 tap beer will pour from Lime Juice (2L): Tap A.",
      "1 gelato serve line moves too.",
      "1 menu option that adds it will add Lime Juice (2L) instead.",
      "Any invoice matches for Lime Juice (L) will point at Lime Juice (2L) from now on.",
    ]);
  });
  it("no sentence of the plan uses an em or en dash", () => {
    const d = confirmed(base({ orderProducts: [{ id: "o1", venue_id: 1, name: "Lime Juice (L)", active: true, ingredient_id: "s" }] }), ["d1"]);
    for (const p of [planMerge(S, T, d), planMerge(S, FLOUR, d), planMerge(S, { ...T, allergens: [] }, d)]) {
      expect([...p.blockers, p.recipesText, p.price.text, ...p.signOffText, ...p.orderText, ...p.otherText, p.sourceText].join(" ")).not.toMatch(/[—–]/);
    }
  });
});

describe("pack counts restated for the target's pack", () => {
  it("is exact or nothing", () => {
    expect(scaledPacks(12, 1, 2)).toBe(6);
    expect(scaledPacks(24, 0.375, 0.375)).toBe(24);
    expect(scaledPacks(1, 1, 3)).toBeNull();
    expect(scaledPacks(0, 1, 2)).toBeNull();
    expect(scaledPacks(undefined, 1, 2)).toBeNull();
    expect(scaledPacks(6, 1, 0)).toBeNull();
  });
});

describe("the result and its messages", () => {
  it("reads the function's reply tolerantly", () => {
    expect(parseMergeResult({ lines: 5, recipes: 4, order_items: 2, deals: 1, invoice_maps: 3, signoffs_carried: 2, signoffs_left: 0, same_allergens: true, merged_name: "Lime Juice (L) (merged)" })).toEqual({ lines: 5, recipes: 4, orderItems: 2, deals: 1, invoiceMaps: 3, signoffsCarried: 2, signoffsLeft: 0, sameAllergens: true, mergedName: "Lime Juice (L) (merged)" });
    expect(parseMergeResult(null)).toMatchObject({ lines: 0, recipes: 0, sameAllergens: false, mergedName: null });
    expect(parseMergeResult("nonsense").recipes).toBe(0);
  });
  it("the toast", () => {
    expect(mergedToast("Lime Juice (2L)", { recipes: 4 })).toBe("Merged into Lime Juice (2L). 4 recipes moved.");
    expect(mergedToast("Lime Juice (2L)", { recipes: 1 })).toBe("Merged into Lime Juice (2L). 1 recipe moved.");
    expect(mergedToast("Lime Juice (2L)", { recipes: 0 })).toBe("Merged into Lime Juice (2L). No recipes used it.");
    expect(mergedName("  Lime Juice (L) ")).toBe("Lime Juice (L) (merged)");
  });
  it("a database without the function reads Merging is not switched on yet, whatever shape the error takes", () => {
    expect(MERGE_NOT_READY).toBe("Merging is not switched on yet.");
    for (const e of [
      { code: "PGRST202", message: "Could not find the function public.cost_merge_ingredient(p_source, p_target) in the schema cache" },
      { code: "42883", message: "function does not exist" },
      { message: "function public.cost_merge_ingredient(uuid, uuid) does not exist" },
    ]) {
      expect(isMergeMissing(e), e.message).toBe(true);
      expect(mergeErrorMessage(e)).toBe(MERGE_NOT_READY);
    }
    expect(isMergeMissing({ code: "P0001", message: "Flour is inactive" })).toBe(false);
    expect(isMergeMissing(null)).toBe(false);
  });
  it("the function's own refusals pass through in plain words", () => {
    expect(mergeErrorMessage({ code: "P0001", message: "Lime Juice (2L) is inactive. Make it active first, or keep a different ingredient" })).toBe("Lime Juice (2L) is inactive. Make it active first, or keep a different ingredient. Nothing was changed.");
    expect(mergeErrorMessage({})).toBe("The merge did not go through. Nothing was changed.");
  });
});

describe("where it lives in the app", () => {
  const read = (f: string) => readFileSync(path.resolve(__dirname, "..", f), "utf8");
  it("one visible row at the bottom of the ingredient page opens the sheet, and a merge goes to the kept ingredient with a toast", () => {
    const page = read("app/(app)/ingredients/[id]/page.tsx");
    expect(MERGE_ROW_TITLE).toBe("Merge Into Another Ingredient");
    expect(MERGE_ROW_SUB).toBe("Use when this is the same product as another ingredient");
    expect(page).toMatch(/<Row title=\{MERGE_ROW_TITLE\} sub=\{MERGE_ROW_SUB\}/);
    expect(page.indexOf("MERGE_ROW_TITLE}")).toBeGreaterThan(page.indexOf("<RecordHistory"));
    expect(page).toContain("mergedToast(target.name, result)");
    expect(page).toContain("router.push(`/ingredients/${target.id}`)");
  });
  it("the sheet plans first, says there is no undo, and writes only through the store", () => {
    const sheet = read("components/merge-ingredient-sheet.tsx");
    expect(MERGE_NO_UNDO).toBe("This cannot be undone here. Every change is recorded in the Change Log.");
    expect(sheet).toContain("planMerge(");
    expect(sheet).toContain("{MERGE_NO_UNDO}");
    expect(sheet).toContain("`Merge Into ${target.name}`");
    expect(sheet).toMatch(/disabled=\{!plan\.canMerge \|\| busy \|\| reading\}/);
    expect(sheet).toContain("store.mergeIngredient(ing.id, target.id)");
    expect(sheet).not.toMatch(/\.(update|insert|upsert|delete|rpc)\(/);
    expect(sheet).not.toMatch(/[—–]/);
  });
  it("the store makes ONE call, the atomic function, and turns a missing function into the plain message", () => {
    const store = read("lib/store.tsx");
    const fn = store.slice(store.indexOf("const mergeIngredient = useCallback"), store.indexOf("const updateSetting = useCallback"));
    expect(fn).toContain('sb.rpc("cost_merge_ingredient", { p_source: sourceId, p_target: targetId })');
    expect(fn).toContain("mergeErrorMessage(error)");
    expect(fn).not.toMatch(/\.from\(/);
    expect(fn).toContain("await reload()");
  });
  it("demo mode has no such function, so a merge there fails soft with the same message", () => {
    const demo = read("lib/supabase/demo-client.ts");
    const m = demo.match(/if \(name !== "cost_data_fingerprint"[^\n]*return (\{[^\n]*\});/);
    expect(m).not.toBeNull();
    expect(m![1]).toContain('code: "42883"');
    expect(mergeErrorMessage({ code: "42883", message: "function does not exist" })).toBe(MERGE_NOT_READY);
  });
  it("adds no page, tab or menu entry", () => {
    expect(read("lib/nav.ts")).not.toMatch(/merge/i);
  });
});
