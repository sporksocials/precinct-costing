import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildIndex } from "@/lib/costing";
import type { AllergenIndex } from "@/lib/allergens";
import { DEFAULT_POLICY } from "@/lib/allergen-badges";
import {
  buildPrintRecipe,
  fitFontSize,
  FONT_MIN_PT,
  FONT_START_PT,
  formatUpdated,
  INVERT_LOGO_ON_PAPER,
  MAX_PRINT,
  NOT_CHECKED_LINE,
  printAmount,
  titleScale,
  toTitleCase,
  type PrintRecipe,
} from "@/lib/print-recipe";
import { CAP_MESSAGE, orderSelected, parsePrintParams, printHref, printLabel, selectAllShown, toggleSelected } from "@/lib/print-job";
import type { Ingredient, MenuItem, Prep, RecipeLine, Venue } from "@/lib/types";

const ing = (id: string, name: string, over: Partial<Ingredient> = {}): Ingredient =>
  ({ id, name, category: "Food", supplier_id: 7, supplier_code: "SUP-123", pack_size: 1, pack_unit: "kg", pack_price: 17.08, price_inc_gst: false, gst_free: false, rebate: 0.05, yield_pct: 1, venues: "All", active: true, last_price_update: null, previous_price: 16, source: null, notes: "secret supplier note", updated_at: null, allergens_reviewed: true, allergens: [], ...over }) as Ingredient;
const prep = (id: string, name: string, over: Partial<Prep> = {}): Prep => ({ id, name, venue_id: 1, prep_type: "Sauces", yield_qty: 2, yield_unit: "kg", active: true, source: null, notes: null, updated_at: "2026-10-04T23:30:00Z", ...over });
const item = (id: string, name: string, over: Partial<MenuItem> = {}): MenuItem => ({ id, name, venue_id: 1, category: "Food", section: "Burgers", portions: 1, sell_price_inc: 24, target_override: 0.7, hh_price_inc: 12, active: true, source: null, notes: null, updated_at: "2026-10-02T03:00:00Z", ...over });
let n = 0;
const line = (parent_type: "item" | "prep", parent_id: string, component_type: "ingredient" | "prep", component_id: string, qty = 1, unit: RecipeLine["unit"] = "g", note: string | null = null): RecipeLine => ({ id: `l${++n}`, parent_type, parent_id, component_type, component_id, qty, unit, note, sort: n });
const VENUES = new Map<number, Venue>([[1, { id: 1, name: "Drift Bar", slug: "drift", sort: 1 }]]);

function source(ings: Ingredient[], preps: Prep[], items: MenuItem[], lines: RecipeLine[]) {
  const index: AllergenIndex = { ...buildIndex(ings, preps, lines), items: new Map(items.map((i) => [i.id, i])) };
  return { index, venueById: VENUES };
}

/** a dish with a prep, an unreviewed ingredient and a note, plus a cocktail */
function world() {
  const ings = [ing("bun", "Brioche Bun", { allergens: ["gluten", "egg"] }), ing("chk", "Chicken Thigh (pack 5kg)"), ing("spice", "Mystery Spice", { allergens_reviewed: false }), ing("yolk", "Egg Yolk", { allergens: ["egg"] }), ing("tequila", "Tequila Blanco (700ml)", { category: "Bar" })];
  const aioli = prep("aioli", "Garlic Aioli", { kitchen_method: ["Blend", "Season"], kitchen_storage: "Fridge, 5 days" });
  const burger = item("burger", "CRISPY CHICKEN BURGER", { kitchen_method: ["Fry the chicken", "Build"], kitchen_plating: ["Wrap in paper"], kitchen_photo: "uploads/burger-1.jpg", kitchen_ready: false });
  const marg = item("marg", "margarita", { category: "Cocktail", section: null, glass: "Rocks Glass", method: ["Shake", "Strain"], garnish: ["Lime wheel", "Salt rim"], bar_photo: "uploads/marg-1.jpg" });
  const bare = item("bare", "Side Of Chips", { kitchen_method: [] });
  const lines = [
    line("item", "burger", "ingredient", "bun", 1, "each"),
    line("item", "burger", "ingredient", "chk", 0.18, "kg"),
    line("item", "burger", "ingredient", "spice", 4, "g", "pinch"),
    line("item", "burger", "prep", "aioli", 35, "g"),
    line("prep", "aioli", "ingredient", "yolk", 0.2, "kg"),
    line("item", "marg", "ingredient", "tequila", 45, "ml"),
  ];
  return source(ings, [aioli], [burger, marg, bare], lines);
}

describe("print model: nothing about money", () => {
  /** every key and every string value of the object, walked */
  function walk(v: unknown, keys: string[] = [], strings: string[] = []) {
    if (Array.isArray(v)) v.forEach((x) => walk(x, keys, strings));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (keys.push(k), walk(x, keys, strings));
    else if (typeof v === "string") strings.push(v);
    return { keys, strings };
  }
  const BANNED_KEY = /price|cost|gp|margin|target|supplier|sell|rebate|pack|deal|portion_cost/i;

  it("has no price, cost, GP, target or supplier field anywhere, for a dish, a drink and a prep", () => {
    const src = world();
    for (const [kind, id] of [["item", "burger"], ["item", "marg"], ["prep", "aioli"]] as const) {
      const r = buildPrintRecipe(kind, id, src) as PrintRecipe;
      expect(r).not.toBeNull();
      const { keys, strings } = walk(r);
      expect(keys.filter((k) => BANNED_KEY.test(k))).toEqual([]);
      // and none of the seeded money values or supplier text leaks into any string
      const all = strings.join(" | ");
      expect(all).not.toMatch(/\$|17\.08|SUP-123|secret supplier|0\.7\b/);
    }
  });
});

describe("print model: content", () => {
  it("dish: Title Case name, kitchen method and plating, amounts as the recipe page writes them, pack sizes dropped", () => {
    const r = buildPrintRecipe("item", "burger", world()) as PrintRecipe;
    expect(r.title).toBe("Crispy Chicken Burger");
    expect(r.subtitle).toBe("Burgers");
    expect(r.method).toEqual(["Fry the chicken", "Build"]);
    expect(r.plating).toEqual(["Wrap in paper"]);
    expect(r.lines.map((l) => [l.amount.value, l.amount.unit, l.name, l.note])).toEqual([
      ["1", "ea", "Brioche Bun", null],
      ["180", "g", "Chicken Thigh", null],
      ["4", "g", "Mystery Spice", "pinch"],
      ["35", "g", "Garlic Aioli", null],
    ]);
    expect(r.photo).toBe("/kitchen/photo/uploads/burger-1.jpg");
  });

  it("prints regardless of the kitchen_ready flag", () => {
    expect(buildPrintRecipe("item", "burger", world())).not.toBeNull();
  });

  it("drink: method, garnish and glass from the bar fields, bar photo, no plating", () => {
    const r = buildPrintRecipe("item", "marg", world()) as PrintRecipe;
    expect(r.title).toBe("Margarita");
    expect(r.subtitle).toBe("Cocktail");
    expect(r.glass).toBe("Rocks Glass");
    expect(r.garnish).toEqual(["Lime wheel", "Salt rim"]);
    expect(r.method).toEqual(["Shake", "Strain"]);
    expect(r.plating).toEqual([]);
    expect(r.lines[0].name).toBe("Tequila Blanco");
    expect(r.photo).toBe("/bar/photo/uploads/marg-1.jpg");
  });

  it("prep: its own method and storage, yield, and no photo", () => {
    const r = buildPrintRecipe("prep", "aioli", world()) as PrintRecipe;
    expect(r.title).toBe("Garlic Aioli");
    expect(r.subtitle).toBe("Sauces Prep");
    expect(r.detail).toBe("Makes 2 kg");
    expect(r.method).toEqual(["Blend", "Season"]);
    expect(r.storage).toBe("Fridge, 5 days");
    expect(r.photo).toBeNull();
    expect(r.lines.map((l) => l.name)).toEqual(["Egg Yolk"]);
  });

  it("a record with no method has an empty method list, so the Method section is left out", () => {
    const r = buildPrintRecipe("item", "bare", world()) as PrintRecipe;
    expect(r.method).toEqual([]);
    expect(r.plating).toEqual([]);
    const src = readFileSync("components/print/recipe-page.tsx", "utf8");
    expect(src).toContain("recipe.method.length ?");
    expect(src).not.toMatch(/No method|not set|Nothing here/i);
  });

  it("an unknown record gives null", () => {
    expect(buildPrintRecipe("item", "nope", world())).toBeNull();
    expect(buildPrintRecipe("prep", "nope", world())).toBeNull();
  });

  it("footer: venue, two spaces, a bar, two spaces, Updated d Mmm yyyy (Brisbane); a shared prep reads the precinct", () => {
    const src = world();
    expect((buildPrintRecipe("item", "burger", src) as PrintRecipe).footer).toBe("Drift Bar  |  Updated 2 Oct 2026");
    const shared = source([], [prep("p", "Stock", { venue_id: null, updated_at: null })], [], []);
    const r = buildPrintRecipe("prep", "p", shared) as PrintRecipe;
    expect(r.venue.slug).toBeNull();
    expect(r.footer).toBe("Caloundra Food Precinct");
  });

  it("Brisbane date: 23:30 UTC on 4 Oct is already 5 Oct in Brisbane", () => {
    expect(formatUpdated("2026-10-04T23:30:00Z")).toBe("5 Oct 2026");
    expect(formatUpdated("2026-09-03T01:00:00Z")).toBe("3 Sep 2026");
    expect(formatUpdated(null)).toBeNull();
    expect(formatUpdated("nonsense")).toBeNull();
  });

  it("amounts use the recipe page's formatter: small kg and L read as g and ml, zero is blank", () => {
    expect(printAmount(0.18, "kg")).toEqual({ value: "180", unit: "g" });
    expect(printAmount(0.06, "L")).toEqual({ value: "60", unit: "ml" });
    expect(printAmount(2, "each")).toEqual({ value: "2", unit: "ea" });
    expect(printAmount(1.5, "kg")).toEqual({ value: "1.5", unit: "kg" });
    expect(printAmount(0, "g")).toEqual({ value: "", unit: "" });
  });
});

describe("allergens", () => {
  it("lists what the dish contains from the shared roll-up, drinks only egg, milk and nuts", () => {
    const r = buildPrintRecipe("item", "burger", world()) as PrintRecipe;
    expect(r.allergens.contains).toBe("Contains: Gluten, Egg");
  });

  it("an unreviewed ingredient adds the plain line and the Contains line never says None Listed", () => {
    const r = buildPrintRecipe("item", "burger", world()) as PrintRecipe;
    expect(r.allergens.notChecked).toBe(NOT_CHECKED_LINE);
    expect(NOT_CHECKED_LINE).toBe("Some ingredients have not been checked for allergens.");
    // a dish whose only ingredient is unreviewed: nothing found yet, which is not the same as none
    const src = source([ing("x", "Mystery", { allergens_reviewed: false })], [], [item("d", "Dish")], [line("item", "d", "ingredient", "x")]);
    const d = buildPrintRecipe("item", "d", src) as PrintRecipe;
    expect(d.allergens.contains).toBe("Contains: Nothing found so far");
    expect(d.allergens.contains).not.toMatch(/none listed/i);
    expect(d.allergens.notChecked).toBe(NOT_CHECKED_LINE);
  });

  it("a fully reviewed dish with nothing to flag says None listed and has no not-checked line", () => {
    const src = source([ing("x", "Carrot")], [], [item("d", "Dish")], [line("item", "d", "ingredient", "x")]);
    const d = buildPrintRecipe("item", "d", src) as PrintRecipe;
    expect(d.allergens.contains).toBe("Contains: None listed");
    expect(d.allergens.notChecked).toBeNull();
  });

  it("an empty recipe cannot read as clear: it carries the not-checked line", () => {
    const d = buildPrintRecipe("item", "bare", world()) as PrintRecipe;
    expect(d.allergens.notChecked).toBe(NOT_CHECKED_LINE);
  });

  it("dish options print with what changes; the seafood letter only on a dish the menu markets as seafood", () => {
    const withOpt = item("d", "Dish", { diet_options: { gfo: { note: "Rice flour crumb" } }, seafood_label: true });
    const prawn = ing("pr", "Prawns", { allergens: ["crustacea"], seafood_origin: "A" });
    const src = source([prawn], [], [withOpt], [line("item", "d", "ingredient", "pr")]);
    const d = buildPrintRecipe("item", "d", src) as PrintRecipe;
    expect(d.options).toEqual([{ letter: "GFO", label: "Gluten Free Option Available", note: "Rice flour crumb", swap: null, text: "Rice flour crumb" }]);
    expect(d.allergens.seafood).toBe("Seafood Origin: A, Australian Seafood");
    const unmarketed = source([prawn], [], [{ ...withOpt, seafood_label: false }], [line("item", "d", "ingredient", "pr")]);
    expect((buildPrintRecipe("item", "d", unmarketed) as PrintRecipe).allergens.seafood).toBeNull();
  });

  it("the policy is the one switch: the menu-only default lists no allergens and no not-checked line", () => {
    const r = buildPrintRecipe("item", "burger", world(), DEFAULT_POLICY) as PrintRecipe;
    expect(r.allergens.notChecked).toBeNull();
    expect(r.allergens.contains).toMatch(/none listed/i);
  });
});

describe("Title Case", () => {
  it("capitalises words, keeps small words low and acronyms as written", () => {
    expect(toTitleCase("chicken burger")).toBe("Chicken Burger");
    expect(toTitleCase("CRISPY CHICKEN BURGER")).toBe("Crispy Chicken Burger");
    expect(toTitleCase("fish and chips")).toBe("Fish and Chips");
    expect(toTitleCase("the big breakfast")).toBe("The Big Breakfast");
    expect(toTitleCase("slow-cooked lamb shoulder")).toBe("Slow-Cooked Lamb Shoulder");
    expect(toTitleCase("BBQ Pulled Pork")).toBe("BBQ Pulled Pork");
    expect(toTitleCase("GF chicken wrap")).toBe("GF Chicken Wrap");
    expect(toTitleCase("greedy gringo's nachos")).toBe("Greedy Gringo's Nachos");
    expect(toTitleCase("mac & cheese")).toBe("Mac & Cheese");
    expect(toTitleCase("  extra   spaces  ")).toBe("Extra Spaces");
    expect(toTitleCase("")).toBe("");
  });
  it("the title steps down for a long name", () => {
    expect(titleScale("Margarita")).toBeGreaterThan(titleScale("Slow-Cooked Beef Brisket Sunday Roast"));
    expect(titleScale("x".repeat(80))).toBeLessThan(titleScale("x".repeat(30)));
  });
});

describe("fitFontSize", () => {
  it("fits at the top size: tries one size and keeps it", () => {
    const tried: number[] = [];
    const r = fitFontSize((s) => (tried.push(s), true));
    expect(r).toEqual({ size: FONT_START_PT, fits: true });
    expect(tried).toEqual([FONT_START_PT]);
  });

  it("steps down in quarter points until it fits", () => {
    const tried: number[] = [];
    const r = fitFontSize((s) => (tried.push(s), s <= 14.5));
    expect(r).toEqual({ size: 14.5, fits: true });
    expect(tried).toEqual([15, 14.75, 14.5]);
  });

  it("stops at the floor and reports it did not fit, leaving the floor size as the last one tried", () => {
    const tried: number[] = [];
    const r = fitFontSize((s) => (tried.push(s), false));
    expect(r).toEqual({ size: FONT_MIN_PT, fits: false });
    expect(tried[tried.length - 1]).toBe(FONT_MIN_PT);
    expect(Math.min(...tried)).toBe(FONT_MIN_PT);
    expect(tried).toEqual([15, 14.75, 14.5, 14.25, 14]);
  });

  it("fits exactly at the floor", () => {
    expect(fitFontSize((s) => s <= FONT_MIN_PT)).toEqual({ size: FONT_MIN_PT, fits: true });
  });

  it("never goes below the floor whatever the step or options", () => {
    const tried: number[] = [];
    fitFontSize((s) => (tried.push(s), false), { start: 15, min: 14, step: 0.3 });
    expect(Math.min(...tried)).toBe(14);
    expect(Math.max(...tried)).toBe(15);
    expect(fitFontSize(() => false, { start: 10 })).toEqual({ size: FONT_MIN_PT, fits: false });
  });

  it("the floor is 14pt and the start is 15pt", () => {
    expect(FONT_MIN_PT).toBe(14);
    expect(FONT_START_PT).toBe(15);
  });
});

describe("print jobs", () => {
  it("builds and reads the preview address, one of each id, capped at 60", () => {
    expect(printHref("item", ["a", "b"])).toBe("/print?kind=item&ids=a,b");
    expect(parsePrintParams("prep", "a,b,a, ,c")).toEqual({ kind: "prep", ids: ["a", "b", "c"], capped: false });
    expect(parsePrintParams("junk", null)).toEqual({ kind: "item", ids: [], capped: false });
    const many = Array.from({ length: 75 }, (_, i) => `id${i}`).join(",");
    const p = parsePrintParams("item", many);
    expect(p.ids).toHaveLength(MAX_PRINT);
    expect(p.capped).toBe(true);
    expect(MAX_PRINT).toBe(60);
  });

  it("keeps the selection in the order the list shows, with anything filtered out last", () => {
    expect(orderSelected(["a", "b", "c", "d"], ["d", "b"])).toEqual(["b", "d"]);
    expect(orderSelected(["a", "b"], ["z", "b", "y"])).toEqual(["b", "z", "y"]);
  });

  it("refuses the 61st tick with the plain message, and Select All Shown stops at 60", () => {
    const sixty = Array.from({ length: 60 }, (_, i) => `id${i}`);
    const r = toggleSelected(sixty, "extra");
    expect(r.selected).toHaveLength(60);
    expect(r.message).toBe(CAP_MESSAGE);
    expect(toggleSelected(sixty, "id3").selected).toHaveLength(59);
    const shown = Array.from({ length: 90 }, (_, i) => `s${i}`);
    const all = selectAllShown([], shown);
    expect(all.selected).toHaveLength(60);
    expect(all.selected[0]).toBe("s0");
    expect(all.message).toBe(CAP_MESSAGE);
    expect(selectAllShown([], shown.slice(0, 5)).message).toBeNull();
  });

  it("button wording is Title Case", () => {
    expect(printLabel(1)).toBe("Print 1 Recipe");
    expect(printLabel(12)).toBe("Print 12 Recipes");
  });

  it("the logos drawn cream for the dark app are turned dark on paper", () => {
    expect([...INVERT_LOGO_ON_PAPER].sort()).toEqual(["drift", "greedy"]);
  });
});

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("house rules for the print files", () => {
  const FILES = [...walkFiles("components/print"), "lib/print-recipe.ts", "lib/print-job.ts", path.join("app", "(app)", "print", "page.tsx")];

  it("no control shrinks below 44px at any breakpoint", () => {
    const bad: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\b(?:sm|md|lg|xl):(?:min-)?h-(?:\[(\d+)px\]|(\d+(?:\.\d+)?))(?![\d\w%/])/g)) {
        const px = m[1] != null ? Number(m[1]) : Number(m[2]) * 4;
        if (px < 44) bad.push(`${f}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("no em or en dashes in anything a person reads", () => {
    for (const f of FILES) expect(readFileSync(f, "utf8"), f).not.toMatch(/[–—]/);
  });

  it("never reads costing money, never writes: no costing output, store mutation or database call", () => {
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/itemCosts|prepCosts|costItem|suggested|gpPct|money\(/);
      expect(src, f).not.toMatch(/supabase|\.from\(|insertRow|updateItem|updatePrep|saveLines|deleteItem|deletePrep/);
    }
  });

  it("the page is black on white: no grey or colour fills in the print stylesheet's page rules", () => {
    const css = readFileSync("components/print/print-css.ts", "utf8");
    const page = css.slice(css.indexOf(".pr-page {"), css.indexOf("@media print"));
    const colours = [...page.matchAll(/(?:^|[;{\s])(?:background(?:-color)?|color|border(?:-[a-z]+)?)\s*:[^;}]*/g)].flatMap((m) => m[0].match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) ?? []);
    expect(colours.length).toBeGreaterThan(0);
    expect([...new Set(colours.map((c) => c.toLowerCase()))].sort()).toEqual(["#000", "#fff"]);
  });
});
