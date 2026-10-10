import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  BAR_CATEGORIES,
  barChips,
  barMissing,
  glassType,
  ingredientDisplay,
  isAmountNote,
  isBarCategory,
  parseBarMenu,
  qtyText,
  usesShots,
} from "@/lib/bar";
import { DRINK_CATEGORIES, gpSummary } from "@/lib/insights";
import { isDrinkItem } from "@/lib/allergen-badges";
import { initialResearchStatus, isResearchCategory } from "@/lib/research-drink";
import { resolveTargetGp } from "@/lib/costing";
import { DEFAULT_TARGET_GP, MENU_CATEGORIES } from "@/lib/types";
import type { ItemCost } from "@/lib/costing";

const read = (p: string) => readFileSync(p, "utf8");

describe("Cold Drink category", () => {
  it("is a menu category, listed after Mocktail", () => {
    expect(MENU_CATEGORIES).toContain("Cold Drink");
    expect(MENU_CATEGORIES.indexOf("Cold Drink")).toBe(MENU_CATEGORIES.indexOf("Mocktail") + 1);
  });
  it("is carried by the drinks station", () => {
    expect([...BAR_CATEGORIES]).toEqual(["Cocktail", "Mocktail", "Cold Drink"]);
    expect(isBarCategory("Cold Drink")).toBe(true);
    expect(isBarCategory("Cold Drinks")).toBe(false);
    expect(isBarCategory("Food")).toBe(false);
  });
  it("is a drink: no menu labels, grouped with drinks in the GP split", () => {
    expect(DRINK_CATEGORIES.has("Cold Drink")).toBe(true);
    expect(isDrinkItem({ category: "Cold Drink" })).toBe(true);
    const mk = (category: string, gpPct: number) =>
      ({ item: { id: category, category, active: true, venue_id: 1, off_menu: false }, gpPct, needsCheck: false }) as unknown as ItemCost;
    const sum = gpSummary([mk("Food", 0.6), mk("Cold Drink", 0.8), mk("Cocktail", 0.7)]);
    expect(sum.food).toBeCloseTo(0.6);
    expect(sum.drinks).toBeCloseTo(0.75);
    expect(sum.count).toBe(3);
  });
  it("is never offered Research This Drink", () => {
    expect(isResearchCategory("Cold Drink")).toBe(false);
    expect(initialResearchStatus("Cold Drink")).toBeNull();
    expect(initialResearchStatus("Cocktail")).toBe("offered");
  });
  it("falls back to the default target when there is no (venue, Cold Drink) target row", () => {
    const item = { venue_id: 1, category: "Cold Drink", target_override: null };
    expect(resolveTargetGp(item, [])).toBe(DEFAULT_TARGET_GP);
    expect(resolveTargetGp(item, [{ venue_id: 1, category: "Cocktail", target_gp: 0.65 }])).toBe(DEFAULT_TARGET_GP);
    expect(resolveTargetGp(item, [{ venue_id: 1, category: "Cold Drink", target_gp: 0.7 }])).toBe(0.7);
  });
  it("needs a glass and a method to show, like every other station drink", () => {
    expect(barMissing({ glass: null, method: [] })).toEqual(["glass", "method"]);
    expect(barMissing({ glass: "Large Glass", method: ["Blend until smooth"] })).toEqual([]);
  });
  it("comes through the station payload with its category", () => {
    const m = parseBarMenu({ venue: { slug: "drift", name: "Drift Bar" }, items: [{ id: "a", name: "Banana Smoothie", category: "Cold Drink", glass: "Large Glass", method: ["Blend"], garnish: [], lines: [] }] }, "2026-10-05T00:00:00.000Z");
    expect(m?.items[0].category).toBe("Cold Drink");
  });
});

describe("barChips", () => {
  const item = (category: string) => ({ category });
  it("shows All plus one chip per category the venue has", () => {
    expect(barChips([item("Cocktail"), item("Mocktail"), item("Cold Drink")])).toEqual([
      { key: "all", label: "All" },
      { key: "Cocktail", label: "Cocktails" },
      { key: "Mocktail", label: "Mocktails" },
      { key: "Cold Drink", label: "Cold Drinks" },
    ]);
  });
  it("leaves out a category the venue has none of", () => {
    expect(barChips([item("Cocktail"), item("Cocktail"), item("Mocktail")]).map((c) => c.label)).toEqual(["All", "Cocktails", "Mocktails"]);
    expect(barChips([item("Cocktail"), item("Cold Drink")]).map((c) => c.label)).toEqual(["All", "Cocktails", "Cold Drinks"]);
  });
  it("shows no chips when there is nothing to choose between", () => {
    expect(barChips([])).toEqual([]);
    expect(barChips([item("Cocktail"), item("Cocktail")])).toEqual([]);
    expect(barChips([item("Cold Drink")])).toEqual([]);
  });
  it("ignores anything that is not a station category", () => {
    expect(barChips([item("Food"), item("Cocktail")])).toEqual([]);
  });
});

describe("amounts on a cold drink card", () => {
  it("reads counting units as words", () => {
    expect(qtyText(2, "scoop")).toBe("2 scoops");
    expect(qtyText(1, "scoop")).toBe("1 scoop");
    expect(qtyText(3, "pump")).toBe("3 pumps");
    expect(qtyText(1, "pumps")).toBe("1 pump");
    expect(qtyText(0.5, "scoop")).toBe("0.5 scoops");
    expect(qtyText(2, "Scoops")).toBe("2 scoops");
  });
  it("does not change the existing units", () => {
    expect(qtyText(60, "ml")).toBe("60ml");
    expect(qtyText(0.5, "g")).toBe("0.5g");
    expect(qtyText(0.2, "kg")).toBe("200g");
    expect(qtyText(2, "each")).toBe("2 each");
    expect(qtyText(1.5, "L")).toBe("1,500ml");
    expect(qtyText(5, "oz")).toBe("5oz");
    expect(qtyText(0, "scoop")).toBe("");
  });
  it("treats scoops and pumps in a note as the amount", () => {
    for (const n of ["2 scoops", "1 scoop", "3 pumps", "Scoop", "Pump of caramel", "2 cups", "1 handful"]) expect(isAmountNote(n), n).toBe(true);
    for (const n of ["Floated on top", "Blended", null]) expect(isAmountNote(n), String(n)).toBe(false);
  });
  it("turns the jigger measures off for cold drinks", () => {
    expect(usesShots("Cold Drink")).toBe(false);
    expect(usesShots("Cocktail")).toBe(true);
    expect(usesShots("Mocktail")).toBe(true);
    const milk = { name: "Milk", qty: 90, unit: "ml", note: null };
    expect(ingredientDisplay(milk).shots).toBe("3 shots");
    expect(ingredientDisplay(milk, { shots: false })).toMatchObject({ shots: null, qty: "90ml", plain: "90ml", aside: null, name: "Milk" });
  });
  it("shows a scoop or pump note as the amount, and any other note under the name", () => {
    expect(ingredientDisplay({ name: "Vanilla Gelato", qty: 100, unit: "g", note: "2 scoops" }, { shots: false })).toMatchObject({ shots: null, plain: "2 scoops", aside: null });
    expect(ingredientDisplay({ name: "Caramel Syrup", qty: 30, unit: "ml", note: "3 pumps" }, { shots: false }).plain).toBe("3 pumps");
    expect(ingredientDisplay({ name: "Espresso", qty: 60, unit: "ml", note: "Chilled" }, { shots: false })).toMatchObject({ plain: "60ml", aside: "Chilled" });
    expect(ingredientDisplay({ name: "Ice", qty: 0, unit: "g", note: "Fill the glass" }, { shots: false })).toMatchObject({ plain: "Fill the glass", aside: null });
    expect(ingredientDisplay({ name: "Banana", qty: 1, unit: "scoop", note: null }, { shots: false }).plain).toBe("1 scoop");
  });
  it("keeps cocktails exactly as they were", () => {
    expect(ingredientDisplay({ name: "Aperol (700ml)", qty: 60, unit: "ml", note: null })).toMatchObject({ shots: "2 shots", qty: "60ml", plain: "", aside: null, name: "Aperol" });
    expect(ingredientDisplay({ name: "Bitters", qty: 3, unit: "ml", note: "3 dashes" })).toMatchObject({ shots: null, plain: "3 dashes" });
  });
});

describe("glass icon for cold drink glasses", () => {
  it("draws large glasses and cups tall", () => {
    for (const g of ["Large Glass", "Pint Glass", "Smoothie Cup", "Milkshake Glass", "Takeaway Cup", "Frappe Glass", "Iced Coffee Glass", "Parfait Glass", "Tumbler"]) expect(glassType(g), g).toBe("highball");
  });
  it("keeps the existing glasses", () => {
    expect(glassType("Rocks Glass, Salt Rim")).toBe("rocks");
    expect(glassType("Large Wine Glass")).toBe("wine");
    expect(glassType("Large Coupe Glass")).toBe("coupe");
    expect(glassType("Martini Glass")).toBe("martini");
    expect(glassType("Mason Jar")).toBe("rocks");
    expect(glassType(null)).toBe("rocks");
  });
});

describe("the drinks station wording", () => {
  const files = [
    "app/bar/page.tsx",
    "app/bar/layout.tsx",
    "app/bar/setup/page.tsx",
    "app/bar/manifest.webmanifest/route.ts",
    "app/bar/[venue]/page.tsx",
    "components/bar/station.tsx",
    "components/bar/premix.tsx",
    "components/editor/bar-fields.tsx",
    "components/editor/research-notes.tsx",
    "app/(app)/research-notes/page.tsx",
    "lib/active.ts",
  ];
  it("never calls it the cocktail station", () => {
    for (const f of files) {
      expect(read(f), f).not.toMatch(/cocktail station/i);
      expect(read(f), f).not.toMatch(/all cocktails/i);
    }
  });
  it("says Drinks Station and Back To All Drinks", () => {
    expect(read("app/bar/page.tsx")).toContain("DRINKS STATION");
    expect(read("app/bar/layout.tsx")).toContain('title: "Drinks Station"');
    expect(read("app/bar/manifest.webmanifest/route.ts")).toContain('name: "Drinks Station"');
    expect(read("app/bar/setup/page.tsx")).toContain("Set up each drinks station iPad once");
    expect(read("components/bar/station.tsx")).toContain("BACK TO ALL DRINKS");
    expect(read("components/bar/premix.tsx")).toContain("BACK TO ALL DRINKS");
    expect(read("components/bar/station.tsx")).toContain('placeholder="Search drinks"');
    expect(read("components/bar/station.tsx")).toContain("No Drinks On This Screen Yet");
    expect(read("components/editor/bar-fields.tsx")).toContain("Show On Drinks Station");
    expect(read("components/editor/bar-fields.tsx")).toContain("Shown on the drinks station.");
    expect(read("app/bar/page.tsx")).toContain("No drinks added yet");
    expect(read("components/editor/research-notes.tsx")).toContain("Never shown on the drinks station");
  });
  it("shows the venue's drink count, not a cocktail count", () => {
    expect(read("app/bar/page.tsx")).toContain('"drink" : "drinks"');
  });
});

describe("migration 20261005200000_bar_menu_cold_drinks", () => {
  const sql = read("supabase/migrations/20261005200000_bar_menu_cold_drinks.sql");
  const schema = read("supabase/schema.sql");
  it("redefines both public station functions with Cold Drink added", () => {
    expect(sql).toMatch(/create or replace function public\.cost_bar_menu\(p_venue text\)/);
    expect(sql).toMatch(/create or replace function public\.cost_bar_premix\(p_venue text\)/);
    expect(sql.match(/mi\.category in \('Cocktail', 'Mocktail', 'Cold Drink'\)/g)).toHaveLength(3);
    expect(sql).not.toMatch(/in \('Cocktail', 'Mocktail'\)/);
  });
  it("keeps the glass and method rule and the security settings", () => {
    expect(sql).toContain("btrim(coalesce(mi.glass, '')) <> ''");
    expect(sql).toContain("coalesce(mi.method, '[]'::jsonb) <> '[]'::jsonb");
    expect(sql.match(/security definer/g)).toHaveLength(2);
    expect(sql.match(/grant execute on function public\.cost_bar_(menu|premix)\(text\) to anon, authenticated/g)).toHaveLength(2);
  });
  it("is mirrored in schema.sql", () => {
    expect(schema).toContain("20261005200000_bar_menu_cold_drinks.sql");
    // three from the cold drinks update itself, plus one in the later redefinition that adds the menu group (20261010110000)
    expect(schema.match(/mi\.category in \('Cocktail', 'Mocktail', 'Cold Drink'\)/g)).toHaveLength(4);
  });
  it("changes nothing but the category list from the previous definitions", () => {
    const strip = (s: string) =>
      s
        .replace(/'Cold Drink'/g, "")
        .replace(/'Mocktail',\s*\)/g, "'Mocktail')")
        .replace(/--.*$/gm, "")
        .replace(/comment on function[^;]*;/g, "")
        .replace(/\s+/g, " ");
    const fn = (s: string, name: string) => {
      const start = s.lastIndexOf(`create or replace function public.${name}`);
      const end = s.indexOf("$$;", s.indexOf("as $$", start));
      return strip(s.slice(start, end));
    };
    const menuPrev = read("supabase/migrations/20261004210000_bar_menu_needs_glass_and_method.sql");
    const premixPrev = read("supabase/migrations/20261004140000_bar_premix_active.sql");
    expect(fn(sql, "cost_bar_menu")).toBe(fn(menuPrev, "cost_bar_menu"));
    expect(fn(sql, "cost_bar_premix")).toBe(fn(premixPrev, "cost_bar_premix"));
  });
});
