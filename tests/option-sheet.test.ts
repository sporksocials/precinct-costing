import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { buildIndex } from "@/lib/costing";
import type { AllergenIndex } from "@/lib/allergens";
import { badgeModel, FULL_ALLERGENS } from "@/lib/allergen-badges";
import { rollup } from "@/lib/allergens";
import { buildPrintRecipe, type PrintRecipe } from "@/lib/print-recipe";
import { matrixDishFromItem, optionWordsFor, withOptionSwaps } from "@/lib/allergy-matrix-store";
import { cell, SEE_CHEF } from "@/lib/allergy-matrix";
import { buildKitchenModel, dishBadges as dishBadgesP, optionSwap } from "@/lib/kitchen-model";
import { parseKitchenData } from "@/lib/kitchen";
import { parseKitchenMatrix } from "@/lib/kitchen-matrix";
import { menuLabelsSummary } from "@/lib/finish-setup";
import { showValue } from "@/lib/undo-change";
import { describeOptionDiff, optionCost, optionSummary, optionWording, suggestedSurcharge } from "@/lib/diet-option-cost";
import { copyDietOptions, optionHasContent, optionText, readOfferedOptions, readOption } from "@/lib/diet-options";
import { money } from "@/lib/format";
import { DEFAULT_SETTINGS, type Ingredient, type MenuItem, type RecipeLine, type Target, type Venue } from "@/lib/types";

/**
 * The guided option sheet (Troy, 10 Oct 2026): an option is saved when it has a note OR a swap. A swap-only option (leave out
 * the base, add a gluten free base, no typing) must read right in EVERY place an option is read: badges, the print Options block,
 * the Kitchen App, the Allergy Matrix cell, the draft summary, Finish Setting Up, copies and the change history.
 */

const ing = (id: string, name: string, pack_unit: Ingredient["pack_unit"], pack_price: number, over: Partial<Ingredient> = {}): Ingredient =>
  ({ id, name, category: "Food", supplier_id: null, supplier_code: null, pack_size: 1, pack_unit, pack_price, price_inc_gst: false, gst_free: false, rebate: 0, yield_pct: 1, venues: "All", active: true, last_price_update: null, previous_price: null, source: null, notes: null, updated_at: null, allergens: [], allergens_reviewed: true, diet_flags: [], ...over }) as Ingredient;

const BASE = ing("base", "Pizza Base", "each", 2, { allergens: ["gluten"] }); //          $2.00 each
const CHEESE = ing("cheese", "Mozzarella", "kg", 12); //                                $12 per kg: 100 g = $1.20
const SAUCE = ing("sauce", "Tomato Sauce", "L", 5); //                                  $5 per L: 80 ml = $0.40
const GFBASE = ing("gfbase", "GF Pizza Base", "each", 4.5); //                          $4.50 each

const dish = (over: Partial<MenuItem> = {}): MenuItem => ({ id: "d", name: "Margherita", venue_id: 1, category: "Food", section: "Pizza", portions: 1, sell_price_inc: 24, target_override: null, hh_price_inc: null, active: true, source: null, notes: null, ...over });
const L = (id: string, component_id: string, qty: number, unit: RecipeLine["unit"]): RecipeLine => ({ id, parent_type: "item", parent_id: "d", component_type: "ingredient", component_id, qty, unit, note: null, sort: Number(id.replace(/\D/g, "")) || 1 });
const LINES = [L("l1", "base", 1, "each"), L("l2", "cheese", 100, "g"), L("l3", "sauce", 80, "ml")]; // standard cost $3.60
const TARGETS: Target[] = [{ venue_id: 1, category: "Food", target_gp: 0.72 } as Target];
const ADD_GF = { component_type: "ingredient", component_id: "gfbase", qty: 1, unit: "each" };
/** the Troy example: leave out the normal base, add a gluten free base, and not one word typed */
const SWAP_ONLY = { gfo: { note: "", removed: ["l1"], added: [ADD_GF] } };

function indexFor(items: MenuItem[]): AllergenIndex {
  return { ...buildIndex([BASE, CHEESE, SAUCE, GFBASE], [], LINES), items: new Map(items.map((m) => [m.id, m])) };
}
const ctx = () => ({ index: buildIndex([BASE, CHEESE, SAUCE, GFBASE], [], LINES), settings: DEFAULT_SETTINGS, targets: TARGETS });

describe("an option is kept when it has a note OR a swap", () => {
  it("a swap-only option has content; an empty one and a surcharge-only one do not", () => {
    expect(optionHasContent(readOption(SWAP_ONLY, "gfo"))).toBe(true);
    expect(optionHasContent(readOption({ gfo: { note: "No cheese" } }, "gfo"))).toBe(true);
    expect(optionHasContent(readOption({ gfo: { note: "  " } }, "gfo"))).toBe(false);
    expect(optionHasContent(readOption({ gfo: { note: "", surcharge_inc: 3 } }, "gfo"))).toBe(false);
    expect(optionHasContent(readOption({ gfo: { note: "", removed: ["l1"] } }, "gfo"))).toBe(true);
    expect(optionHasContent(null)).toBe(false);
  });
  it("readOfferedOptions lists the real options in the fixed order", () => {
    const raw = { dfo: { note: "No cheese" }, vo: { note: "" }, gfo: { note: "", added: [ADD_GF] }, gf: {} };
    expect(readOfferedOptions(raw).map((o) => o.id)).toEqual(["gfo", "dfo"]);
  });
});

describe("badges and Menu Labels", () => {
  it("a swap-only option is an option badge with an empty note, and an option with neither is reported empty", () => {
    const m = badgeModel(rollup({ kind: "item", id: "d" }, indexFor([dish()])), dish({ diet_options: { ...SWAP_ONLY, vo: { note: " " }, dfo: { note: "", surcharge_inc: 2 } } as MenuItem["diet_options"] }));
    expect(m.options.map((o) => [o.id, o.letter, o.note])).toEqual([["gfo", "GFO", ""]]);
    expect(m.optionsEmpty).toEqual(["vo", "dfo"]);
  });
  it("Finish Setting Up counts a swap-only option and never an empty one", () => {
    expect(menuLabelsSummary(SWAP_ONLY)).toBe("1 set");
    expect(menuLabelsSummary({ gfo: { note: "" } })).toBe("None set");
    expect(menuLabelsSummary({ gf: {}, gfo2: {}, ...SWAP_ONLY })).toBe("2 set");
  });
  it("the Menu Labels grid and cards get the swap sentence", () => {
    const m = dish({ diet_options: SWAP_ONLY as MenuItem["diet_options"] });
    const index = indexFor([m]);
    const model = withOptionSwaps(badgeModel(rollup({ kind: "item", id: "d" }, index), m), m, index);
    expect(model.options[0].swap).toBe("Leave out Pizza Base. Add GF Pizza Base 1 ea.");
    expect(optionText(model.options[0].note, model.options[0].swap ?? null)).toBe("Leave out Pizza Base. Add GF Pizza Base 1 ea.");
    expect(withOptionSwaps(model, null, index)).toBe(model);
  });
});

describe("the Allergy Matrix cell", () => {
  it("a swap-only GFO is a yellow cell with the swap sentence, never See chef", () => {
    const m = dish({ diet_options: SWAP_ONLY as MenuItem["diet_options"] });
    const index = indexFor([m]);
    expect(optionWordsFor(m, index).gfo).toBe("Leave out Pizza Base. Add GF Pizza Base 1 ea.");
    const d = matrixDishFromItem(m, index);
    const c = cell(d, "gluten_free");
    expect(c).toMatchObject({ state: "yellow", note: "Leave out Pizza Base. Add GF Pizza Base 1 ea." });
    expect(c.note).not.toBe(SEE_CHEF);
  });
  it("the swap comes first and the extra note follows it", () => {
    const m = dish({ diet_options: { gfo: { note: "Check the sauce", removed: ["l1"], added: [ADD_GF] } } as MenuItem["diet_options"] });
    expect(optionWordsFor(m, indexFor([m])).gfo).toBe("Leave out Pizza Base. Add GF Pizza Base 1 ea. Check the sauce");
  });
});

describe("the printed Options block", () => {
  const src = (m: MenuItem) => ({ index: indexFor([m]), venueById: new Map<number, Venue>([[1, { id: 1, name: "Drift Bar", slug: "drift", sort: 1 }]]) });
  it("prints a swap-only option as the swap sentence", () => {
    const m = dish({ diet_options: SWAP_ONLY as MenuItem["diet_options"] });
    const d = buildPrintRecipe("item", "d", src(m)) as PrintRecipe;
    expect(d.options).toEqual([{ letter: "GFO", label: "Gluten Free Option Available", note: "", swap: "Leave out Pizza Base. Add GF Pizza Base 1 ea.", text: "Leave out Pizza Base. Add GF Pizza Base 1 ea." }]);
  });
  it("never prints a price or the surcharge", () => {
    const m = dish({ diet_options: { gfo: { note: "", removed: ["l1"], added: [ADD_GF], surcharge_inc: 3.5 } } as MenuItem["diet_options"] });
    expect(JSON.stringify((buildPrintRecipe("item", "d", src(m)) as PrintRecipe).options)).not.toMatch(/3\.5|\$|surcharge/);
  });
});

describe("the Kitchen App", () => {
  const SYNCED = "2026-10-10T08:00:00Z";
  const rawDish = (diet_options: unknown) => ({ id: "d", name: "Margherita", section: "Pizza", portions: 1, method: [], plating: [], photo: null, diet_options });
  const parse = (diet_options: unknown) =>
    parseKitchenData(
      {
        venue: { slug: "drift", name: "Drift" },
        dishes: [rawDish(diet_options)],
        preps: [],
        ingredients: [
          { id: "base", name: "Pizza Base", allergens: ["gluten"], allergens_reviewed: true, diet_flags: [] },
          { id: "gfbase", name: "GF Pizza Base", allergens: [], allergens_reviewed: true, diet_flags: [] },
        ],
        lines: [{ id: "l1", parent_type: "item", parent_id: "d", component_type: "ingredient", component_id: "base", qty: 1, unit: "each", note: null, sort: 1 }],
      },
      SYNCED,
    )!;
  it("keeps an option with only a swap (an empty note) and drops one with neither", () => {
    const data = parse({ gfo: { note: "", removed: ["l1"], added: [ADD_GF] }, vo: { note: "" }, dfo: { note: "  ", surcharge_inc: 3 } });
    expect(Object.keys(data.dishes[0].dietOptions)).toEqual(["gfo"]);
    expect(data.dishes[0].dietOptions.gfo).toEqual({ note: "", removed: ["l1"], added: [{ component_type: "ingredient", component_id: "gfbase", qty: 1, unit: "each" }] });
  });
  it("shows the swap sentence for a swap-only option, and no surcharge", () => {
    const model = buildKitchenModel(parse({ gfo: { note: "", removed: ["l1"], added: [ADD_GF], surcharge_inc: 3 } }));
    expect(optionSwap(model, "d", "gfo")).toEqual({ swap: "Leave out Pizza Base. Add GF Pizza Base 1 ea." });
    const b = dishBadgesP(model, "d", FULL_ALLERGENS);
    expect(b.options.map((o) => o.letter)).toEqual(["GFO"]);
    expect(JSON.stringify(b)).not.toMatch(/surcharge/);
  });
  it("the Kitchen matrix feed accepts an empty note beside left_out and added", () => {
    const d = parseKitchenMatrix({ venue: { slug: "drift", name: "Drift" }, dishes: [{ id: "d", name: "Margherita", section: "Pizza", dish_allergens: null, marks: [], options: { gfo: { note: "", left_out: ["Pizza Base (700g)"], added: [{ name: "GF Pizza Base", qty: 1, unit: "each" }] } } }] }, SYNCED)!;
    expect(d.dishes[0].options.gfo).toBe("Leave out Pizza Base. Add GF Pizza Base 1 ea.");
    expect(d.dishes[0].options.gfo).not.toBe("");
  });
});

describe("copies and history", () => {
  it("Duplicate and What If keep a swap-only option: left-out ids translate, added amounts scale", () => {
    const out = copyDietOptions(SWAP_ONLY, new Map([["l1", "n1"]]), 2) as Record<string, { note: string; removed: string[]; added: { qty: number }[] }>;
    expect(out.gfo.removed).toEqual(["n1"]);
    expect(out.gfo.added[0].qty).toBe(2);
    expect(out.gfo.note).toBe("");
  });
  it("the change history words a swap-only change by what moved, not as a bare letter", () => {
    expect(showValue("diet_options", SWAP_ONLY)).toBe("GFO (1 left out, 1 added)");
    expect(showValue("diet_options", {})).toBe("None");
  });
});

describe("option wording, summary and the suggested surcharge", () => {
  const oc = (entry: unknown, item = dish()) => optionCost(item, LINES, entry, ctx())!;
  it("the wording is the swap sentence, then the extra note", () => {
    expect(optionWording(oc(SWAP_ONLY.gfo))).toBe("Leave out Pizza Base. Add GF Pizza Base 1 ea.");
    expect(optionWording(oc({ note: "No cheese", removed: ["l2"] }))).toBe("Leave out Mozzarella. No cheese");
    expect(optionWording(oc({ note: "Ask for no cheese" }))).toBe("Ask for no cheese");
    expect(optionWording(oc({ note: "" }))).toBe("");
  });
  it("the summary line is the wording, the surcharge and the GP", () => {
    // cost 3.60 - 2.00 + 4.50 = 6.10; price 24 + 3 = 27; GP (27/1.1 - 6.10) / (27/1.1) = 75.1%
    expect(optionSummary(oc({ ...SWAP_ONLY.gfo, surcharge_inc: 3 }), money)).toBe("Leave out Pizza Base. Add GF Pizza Base 1 ea. +$3.00 · GP 75.1%");
    expect(optionSummary(oc(SWAP_ONLY.gfo), money)).toMatch(/^Leave out Pizza Base\. Add GF Pizza Base 1 ea\. GP \d+\.\d%$/);
    expect(optionSummary(oc({ note: "" }, dish({ sell_price_inc: null })), money)).toBe("Nothing set yet. Tap Edit.");
    // a note-only option closes its own sentence before the GP
    expect(optionSummary(oc({ note: "Ask for no cheese" }), money)).toBe("Ask for no cheese. GP 83.5%");
  });
  it("the cost compares with the standard dish in words", () => {
    const d = describeOptionDiff(oc(SWAP_ONLY.gfo), money);
    expect(d.cost).toBe("$2.50 more than the standard dish");
    expect(d.gp).toMatch(/^GP [\d.]+ points? lower$/);
  });

  describe("suggestedSurcharge: the app's suggested price for the option's cost, minus the dish price, never below zero", () => {
    it("is cost / (1 - target) x 1.1 rounded UP to the rounding step, minus the dish price", () => {
      const o = oc(SWAP_ONLY.gfo);
      // cost 6.10 / 0.28 x 1.1 = 23.96 -> rounds up to 24.00 with a 50c step: no surcharge needed on a $24 dish
      expect(suggestedSurcharge(o, 24, DEFAULT_SETTINGS)).toEqual({ price: 24, surcharge: 0 });
      // a cheaper dish price needs the difference
      expect(suggestedSurcharge(o, 22, DEFAULT_SETTINGS)).toEqual({ price: 24, surcharge: 2 });
      // the 20c step used in production
      expect(suggestedSurcharge(o, 22, { ...DEFAULT_SETTINGS, round_to: 0.2 })).toEqual({ price: 24, surcharge: 2 });
      expect(suggestedSurcharge({ costPerPortion: 8, targetGp: 0.72 }, 24, { ...DEFAULT_SETTINGS, round_to: 0.2 })).toEqual({ price: 31.6, surcharge: 7.6 });
    });
    it("the price it names reaches the target", () => {
      const o = oc(SWAP_ONLY.gfo, dish({ sell_price_inc: 20 }));
      const s = suggestedSurcharge(o, 20, DEFAULT_SETTINGS)!;
      const after = oc({ ...SWAP_ONLY.gfo, surcharge_inc: s.surcharge }, dish({ sell_price_inc: 20 }));
      expect(after.priceInc).toBe(s.price);
      expect(after.gpPct as number).toBeGreaterThanOrEqual(o.targetGp - 0.0005);
    });
    it("is null without a dish price or when the target cannot be reached", () => {
      const o = oc(SWAP_ONLY.gfo);
      expect(suggestedSurcharge(o, null, DEFAULT_SETTINGS)).toBeNull();
      expect(suggestedSurcharge(o, 0, DEFAULT_SETTINGS)).toBeNull();
      expect(suggestedSurcharge({ costPerPortion: 5, targetGp: 1 }, 24, DEFAULT_SETTINGS)).toBeNull();
    });
  });
});

describe("the sheet and the screens (source guards)", () => {
  const read = (f: string) => readFileSync(f, "utf8");
  const sheet = read("components/editor/option-sheet.tsx");
  const group = read("components/editor/diet-options.tsx");
  const prices = read("components/editor/option-prices.tsx");
  const editor = read("components/editor/recipe-editor.tsx");
  const summary = read("components/editor/summary.tsx");

  it("the sheet has four numbered steps in order, then Done, with the plain reason while it is disabled", () => {
    const at = (s: string) => {
      const i = sheet.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    const order = ['title="Leave Out"', 'title="Add"', 'title="Price"', 'title="Note (Optional)"', "Done\n          </button>"].map(at);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(sheet).toContain("Tick what to leave out, add something, or write a note.");
    expect(sheet).toContain("disabled={!canDone}");
    expect(sheet).toContain("Tick the ingredients this option does not use.");
    expect(sheet).toContain("The kitchen sees");
    expect(sheet).toContain("Set {money(sug.surcharge)}");
    expect(sheet).toContain("Undo");
  });
  it("Done writes to the draft through onPatch and Cancel writes nothing; the sheet never touches the database", () => {
    expect(sheet).toContain("onPatch({ diet_options:");
    expect(sheet).toContain("onClose={onCancel}");
    expect(sheet).not.toMatch(/updateItem|\.insert\(|\.update\(|\.upsert\(|\.rpc\(|insertRow/);
  });
  it("the old note-first box, its warning and the inline swap panel are gone", () => {
    for (const s of [group, sheet, prices]) {
      expect(s).not.toContain("Not saved yet");
      expect(s).not.toContain("What changes?");
      expect(s).not.toContain("OptionSwapPanel");
    }
    expect(group).not.toContain("NoteInput");
    expect(group).not.toContain("needs a note");
  });
  it("an option row on the dish card is the switch, one summary line and an Edit button", () => {
    expect(group).toContain("option-summary-");
    expect(group).toMatch(/aria-label=\{`Edit \$\{o\.name\}`\}/);
    expect(group).toContain("editor?.edit(o.id)");
    expect(group).toContain("!min-h-[44px]");
  });
  it("the Options list sits under the GP in the desktop price card and in the phone pricing section, and opens the sheet", () => {
    expect(editor).toMatch(/<ItemSummaryCard[\s\S]*?<OptionPrices item=\{item\} lines=\{lines\} \/>[\s\S]*?<\/ItemSummaryCard>/);
    expect(editor).toMatch(/<OptionPrices item=\{item\} lines=\{lines\} className="[^"]*lg:hidden"/);
    expect(editor.indexOf("lg:hidden\" /> : null}\n          {itemCost && item ? <PricePicker")).toBeGreaterThan(-1);
    expect(summary).toContain("{children}");
    expect(prices).toContain("editor?.edit(id)");
    expect(prices).toContain("data-testid=\"option-prices\"");
    // the bottom Cost / Price / GP bar is the standard dish only and does not take the list
    expect(summary).not.toMatch(/ItemSummaryBar[\s\S]{0,40}children/);
  });
  it("each option row shows the status word and an icon beside the colour, never colour alone", () => {
    expect(prices).toMatch(/status\.word/);
    expect(prices).toMatch(/<Icon aria-hidden/);
    expect(prices).toContain("gpStatus(");
  });
  it("the option costing stays display only: only the dish page's option files import it, and no consumer reads the new files", () => {
    const importers = execSync(`grep -rlE 'diet-option-cost"' app components lib tests --include=*.ts --include=*.tsx || true`, { encoding: "utf8" }).split("\n").filter(Boolean).sort();
    expect(importers).toEqual(["components/editor/option-prices.tsx", "components/editor/option-sheet.tsx", "tests/diet-option-cost.test.ts", "tests/option-sheet.test.ts"].sort());
    const users = execSync(`grep -rlE '(option-prices|option-sheet)"' app components lib --include=*.ts --include=*.tsx || true`, { encoding: "utf8" }).split("\n").filter(Boolean).sort();
    expect(users).toEqual(["components/editor/diet-options.tsx", "components/editor/option-prices.tsx", "components/editor/recipe-editor.tsx"].sort());
    for (const f of ["lib/insights.ts", "lib/dashboard.ts", "lib/costing.ts", "lib/store.tsx", "lib/pos-list.ts", "lib/price-review.ts", "lib/matrix-todo.ts", "components/dashboard.tsx", "components/today-feed.tsx", "components/matrix/todo-page.tsx", "app/(app)/menu/page.tsx", "app/(app)/page.tsx"]) {
      let text = "";
      try {
        text = read(f);
      } catch {
        continue;
      }
      expect(text, f).not.toMatch(/option-prices|option-sheet|optionCost|suggestedSurcharge|optionSummary|OptionPrices/);
    }
  });
  it("food dishes and other menu items share one provider; drinks get none", () => {
    expect(editor).toContain("<OptionEditorProvider");
    expect(editor).toMatch(/item && !isDrinkItem\(item\) \? \(\s*<OptionEditorProvider/);
  });
});
