import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The dish page (Troy, 10 Oct 2026: "as easy and simple to use as possible"): sections run in the order a person works, there is ONE bar
 * at the bottom (the Save bar only while something is unsaved), and the marks and options are ONE block called Menu Labels.
 * These read the source, like the other screen guards in this repo.
 */
const read = (p: string) => readFileSync(p, "utf8");
const editor = read("components/editor/recipe-editor.tsx");
const kitchen = read("components/editor/kitchen-fields.tsx");
const diet = read("components/editor/diet-options.tsx");

describe("section order on the dish page", () => {
  it("runs Ingredients, Allergens And Dietary, kitchen, pricing, Pricing And Notes, History, Price History, Delete", () => {
    const at = (needle: string) => {
      const i = editor.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const order = [
      '<Group title="Ingredients"',
      "<AllergensDietaryCard",
      "<KitchenDisplayFields",
      "<PricePicker",
      'title={item ? "Pricing & Notes"',
      "<RecordHistory",
      "<PriceHistory",
      'Delete Menu Item',
    ].map(at);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("the kitchen block puts the method and plating before Ready For Kitchen", () => {
    expect(kitchen.indexOf('id="kitchen-method"')).toBeLessThan(kitchen.indexOf('title="Plating"'));
    expect(kitchen.indexOf('title="Plating"')).toBeLessThan(kitchen.indexOf('id="kitchen-ready"'));
    expect(kitchen.indexOf('id="kitchen-ready"')).toBeLessThan(kitchen.indexOf('label="Ready For Kitchen"'));
  });
});

describe("one bar at the bottom", () => {
  it("the Save bar (phone and desktop) only exists while the page is not saved, and a quiet Saved toast says it worked", () => {
    expect(editor).toContain('const showSaveBar = saveState !== "saved"');
    expect(editor).toMatch(/const phoneSaveBar = showSaveBar \?/);
    expect(editor).toMatch(/\{showSaveBar \? <SaveBar/);
    expect(editor).toContain('toast.show({ message: "Saved" }');
  });
  it("saving, the leave guard, the conflict check and Discard are all still wired", () => {
    expect(editor).toContain("useUnsavedGuard(dirty");
    expect(editor).toContain("useGuardedRouter()");
    expect(editor).toContain("checkedSave");
    expect(editor).toContain("<DiscardSheet");
  });
});

describe("Menu Labels is the one name for the marks and the options", () => {
  it("the editor block is one Section titled Menu Labels holding the mark toggles and the option rows", () => {
    expect(diet.match(/<Section\b/g)).toHaveLength(1);
    expect(diet).toContain('title="Menu Labels"');
    expect(diet).not.toMatch(/title="Dietary (Marks|Options)"/);
    expect(diet.indexOf("DIET_MARKS.map")).toBeLessThan(diet.indexOf("DIET_OPTIONS.map"));
    expect(diet).toContain("Menu Legend");
  });
  it("no CFP App screen calls them Dietary Marks or Dietary Options (kitchen and print wording is its own)", () => {
    const screens = [
      "components/editor/diet-options.tsx",
      "components/editor/safety-card.tsx",
      "components/editor/dish-allergens.tsx",
      "components/editor/finish-setup.tsx",
      "components/allergen-matrix.tsx",
      "components/allergen-badges.tsx",
      "components/matrix/review-page.tsx",
      "lib/finish-setup.ts",
    ];
    for (const f of screens) expect(read(f), f).not.toMatch(/Dietary Marks|Dietary Options|dietary marks|dietary options/);
  });
});
