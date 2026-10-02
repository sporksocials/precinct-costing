import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { SECTION_ORDER, compareGroups, formatQty, groupItems, isKitchenPath, isKitchenVenue, kitchenPhotoSrc, KITCHEN_VENUES, matchesName, parseKitchenData, qtyParts, scaleLabel, scaleQty, yieldText } from "@/lib/kitchen";
import { allergenDisplay, buildKitchenModel, componentsOf, dishAllergens, prepAllergens, usedIn } from "@/lib/kitchen-model";
import { rollup } from "@/lib/allergens";
import { stationWorkerResponse, stationWorkerSource } from "@/lib/sw-source";

const SYNCED = "2026-10-03T08:00:00Z";

/** A small feed in the shape cost_kitchen_data returns: a clear dish, a dish through an unreviewed prep, and a prep nested in a prep. */
const RAW = {
  venue: { slug: "drift", name: "Drift Bar" },
  dishes: [
    { id: "d-toast", name: "Avocado Toast", section: "Breakfast", portions: 1, method: ["Toast the bread", "Smash the avo"], plating: ["Bread on the plate first"], photo: "uploads/toast-1.jpg", allergen_add: null, allergen_remove: null, allergen_notes: null },
    { id: "d-burger", name: "Crispy Chicken Burger", section: "Burgers", portions: 1, method: [], plating: [], photo: null, allergen_add: null, allergen_remove: null, allergen_notes: { milk: "no aioli" } },
    { id: "d-tart", name: "Lemon Tart", section: "Sweets", portions: 4, method: ["Slice"], plating: [], photo: null, allergen_add: null, allergen_remove: null, allergen_notes: null },
  ],
  preps: [
    { id: "p-aioli", name: "Garlic Aioli", prep_type: "Sauces", yield_qty: 2, yield_unit: "kg", active: true, ready: true, method: ["Whisk"], storage: "Fridge, 5 days", allergen_add: null, allergen_remove: null, allergen_notes: null },
    { id: "p-pastry", name: "Sweet Pastry", prep_type: null, yield_qty: 12, yield_unit: "each", active: true, ready: true, method: [], storage: null, allergen_add: null, allergen_remove: null, allergen_notes: null },
    { id: "p-base", name: "Pastry Base", prep_type: "Doughs", yield_qty: 1, yield_unit: "kg", active: true, ready: false, method: [], storage: null, allergen_add: null, allergen_remove: null, allergen_notes: null },
  ],
  ingredients: [
    { id: "i-bread", name: "Sourdough (loaf 800g)", allergens: ["gluten"], allergens_reviewed: true, diet_flags: [] },
    { id: "i-avo", name: "Avocado", allergens: [], allergens_reviewed: true, diet_flags: null },
    { id: "i-mayo", name: "Kewpie Mayo", allergens: null, allergens_reviewed: false, diet_flags: null },
    { id: "i-flour", name: "Plain Flour", allergens: ["gluten"], allergens_reviewed: true, diet_flags: null },
    { id: "i-butter", name: "Butter", allergens: ["milk"], allergens_reviewed: true, diet_flags: ["dairy"] },
    { id: "i-chicken", name: "Chicken Thigh", allergens: [], allergens_reviewed: true, diet_flags: ["meat"] },
  ],
  lines: [
    { parent_type: "item", parent_id: "d-toast", component_type: "ingredient", component_id: "i-bread", qty: 2, unit: "each", note: "toasted", sort: 1 },
    { parent_type: "item", parent_id: "d-toast", component_type: "ingredient", component_id: "i-avo", qty: 0.12, unit: "kg", note: null, sort: 2 },
    { parent_type: "item", parent_id: "d-burger", component_type: "ingredient", component_id: "i-chicken", qty: 180, unit: "g", note: null, sort: 1 },
    { parent_type: "item", parent_id: "d-burger", component_type: "prep", component_id: "p-aioli", qty: 30, unit: "g", note: null, sort: 2 },
    { parent_type: "prep", parent_id: "p-aioli", component_type: "ingredient", component_id: "i-mayo", qty: 1.2, unit: "kg", note: null, sort: 1 },
    { parent_type: "item", parent_id: "d-tart", component_type: "prep", component_id: "p-pastry", qty: 600, unit: "g", note: null, sort: 1 },
    { parent_type: "prep", parent_id: "p-pastry", component_type: "prep", component_id: "p-base", qty: 500, unit: "g", note: null, sort: 1 },
    { parent_type: "prep", parent_id: "p-base", component_type: "ingredient", component_id: "i-flour", qty: 500, unit: "g", note: null, sort: 1 },
    { parent_type: "prep", parent_id: "p-base", component_type: "ingredient", component_id: "i-butter", qty: 250, unit: "g", note: null, sort: 2 },
  ],
};

describe("parseKitchenData", () => {
  it("normalises the database payload", () => {
    const d = parseKitchenData(RAW, SYNCED)!;
    expect(d.venue).toEqual({ slug: "drift", name: "Drift Bar" });
    expect(d.dishes.map((x) => x.name)).toEqual(["Avocado Toast", "Crispy Chicken Burger", "Lemon Tart"]);
    expect(d.dishes[0]).toMatchObject({ section: "Breakfast", photo: "uploads/toast-1.jpg", method: ["Toast the bread", "Smash the avo"], plating: ["Bread on the plate first"] });
    expect(d.dishes[1].allergenNotes).toEqual({ milk: "no aioli" });
    expect(d.preps.find((p) => p.id === "p-base")?.ready).toBe(false);
    expect(d.lines).toHaveLength(RAW.lines.length);
    expect(d.syncedAt).toBe(SYNCED);
  });

  it("is null when the venue is missing or the payload is not an object", () => {
    for (const bad of [null, undefined, "x", 4, [], {}, { venue: {} }, { venue: { slug: 3 } }]) expect(parseKitchenData(bad, SYNCED)).toBeNull();
  });

  it("copes with a payload that has no lists at all", () => {
    expect(parseKitchenData({ venue: { slug: "drift" } }, SYNCED)).toEqual({ venue: { slug: "drift", name: "drift" }, dishes: [], preps: [], ingredients: [], lines: [], syncedAt: SYNCED });
  });

  it("coerces a method that is not a list to empty, and drops blank steps", () => {
    const d = parseKitchenData({ venue: { slug: "drift" }, dishes: [{ id: "a", name: "A", method: "Whisk", plating: { 0: "x" } }, { id: "b", name: "B", method: ["Whisk", " ", 4, null, " Fold "], plating: null }] }, SYNCED)!;
    expect(d.dishes[0]).toMatchObject({ method: [], plating: [] });
    expect(d.dishes[1].method).toEqual(["Whisk", "Fold"]);
  });

  it("drops rows without an id or a name instead of failing", () => {
    const d = parseKitchenData(
      {
        venue: { slug: "drift" },
        dishes: [null, 7, "x", { name: "No id" }, { id: "a" }, { id: "b", name: "  " }, { id: 3, name: "Numeric id" }, { id: "ok", name: " Fine " }],
        preps: [{ id: "p" }, { name: "n" }, { id: "p1", name: "Stock" }],
        ingredients: [{ name: "x" }, { id: "i", name: "Salt" }],
        lines: [
          { parent_type: "item", parent_id: "a", component_type: "ingredient" },
          { parent_type: "nope", parent_id: "a", component_type: "ingredient", component_id: "i" },
          { parent_type: "item", parent_id: "ok", component_type: "ingredient", component_id: "i", qty: "abc", unit: null, note: " " },
        ],
      },
      SYNCED,
    )!;
    expect(d.dishes.map((x) => x.id)).toEqual(["3", "ok"]);
    expect(d.dishes[1].name).toBe("Fine");
    expect(d.preps.map((x) => x.id)).toEqual(["p1"]);
    expect(d.ingredients.map((x) => x.id)).toEqual(["i"]);
    expect(d.lines).toEqual([{ parentType: "item", parentId: "ok", componentType: "ingredient", componentId: "i", qty: 0, unit: "", note: null, sort: 0 }]);
  });

  it("only keeps a photo that is a valid upload path", () => {
    const photos = ["uploads/ok-1.jpg", "../x.jpg", "uploads/../x.jpg", "http://evil.test/a.jpg", "mai-tai.jpg", "uploads/a/b.jpg", "", null, 4];
    const d = parseKitchenData({ venue: { slug: "drift" }, dishes: photos.map((photo, i) => ({ id: `d${i}`, name: `Dish ${i}`, photo })) }, SYNCED)!;
    expect(d.dishes.map((x) => x.photo)).toEqual(["uploads/ok-1.jpg", null, null, null, null, null, null, null, null]);
  });

  it("never reads a missing review flag as reviewed", () => {
    const d = parseKitchenData({ venue: { slug: "drift" }, ingredients: [{ id: "a", name: "A" }, { id: "b", name: "B", allergens_reviewed: null }, { id: "c", name: "C", allergens_reviewed: "true" }, { id: "d", name: "D", allergens_reviewed: true }] }, SYNCED)!;
    expect(d.ingredients.map((i) => i.reviewed)).toEqual([false, false, false, true]);
  });

  it("defaults portions to 1 and a prep's unit to each when they are nonsense", () => {
    const d = parseKitchenData({ venue: { slug: "drift" }, dishes: [{ id: "a", name: "A", portions: 0 }, { id: "b", name: "B", portions: "x" }, { id: "c", name: "C", portions: 4 }], preps: [{ id: "p", name: "P", yield_qty: "abc", yield_unit: "bunch", ready: "yes" }] }, SYNCED)!;
    expect(d.dishes.map((x) => x.portions)).toEqual([1, 1, 4]);
    expect(d.preps[0]).toMatchObject({ yieldQty: 0, yieldUnit: "each", ready: false });
  });
});

describe("sections", () => {
  const dish = (name: string, section: string | null) => ({ name, section });
  it("orders Drift's sections the way the menu runs, unknown ones alphabetically, Other last", () => {
    const names = ["Zebra Board", "Sweets", null, "Mains", "Aperitivo", "breakfast", "Daily Specials", "Little Drifters", "Kids"];
    const groups = groupItems(names.map((s, i) => dish(`D${i}`, s)), (d) => d.section);
    expect(groups.map((g) => g.label)).toEqual(["breakfast", "Kids", "Little Drifters", "Mains", "Daily Specials", "Sweets", "Aperitivo", "Zebra Board", "Other"]);
  });
  it("lists the known sections in the brief's order", () => {
    expect([...SECTION_ORDER]).toEqual(["Breakfast", "Kids", "Small Plates", "Little Drifters", "Mains", "Bowls & Salads", "Grill", "Burgers", "Pizzas", "Daily Specials", "Sweets"]);
    expect(["Sweets", "Small Plates", "Breakfast"].sort((a, b) => compareGroups(a, b))).toEqual(["Breakfast", "Small Plates", "Sweets"]);
  });
  it("sorts dishes by name inside a section and treats a blank section as Other", () => {
    const g = groupItems([dish("Pancakes", "Breakfast"), dish("Avo Toast", "Breakfast"), dish("Mystery", "  ")], (d) => d.section);
    expect(g.map((x) => [x.label, x.items.map((i) => i.name)])).toEqual([["Breakfast", ["Avo Toast", "Pancakes"]], ["Other", ["Mystery"]]]);
  });
  it("groups preps alphabetically by type, Other last", () => {
    const g = groupItems([dish("a", "Sauces"), dish("b", null), dish("c", "Doughs")], (d) => d.section, []);
    expect(g.map((x) => x.label)).toEqual(["Doughs", "Sauces", "Other"]);
  });
  it("matches names case-insensitively", () => {
    expect(matchesName("Crispy Chicken Burger", " chick ")).toBe(true);
    expect(matchesName("Lemon Tart", "burger")).toBe(false);
    expect(matchesName("Lemon Tart", "")).toBe(true);
  });
});

describe("formatQty", () => {
  it("reads grams, not fractions of a kilo", () => {
    expect(formatQty(150, "g")).toBe("150 g");
    expect(formatQty(0.15, "kg")).toBe("150 g");
    expect(formatQty(0.5, "g")).toBe("0.5 g");
    expect(formatQty(12.5, "g")).toBe("12.5 g");
    expect(formatQty(1500, "g")).toBe("1.5 kg");
    expect(formatQty(2, "kg")).toBe("2 kg");
    expect(formatQty(1.25, "kg")).toBe("1.25 kg");
    expect(formatQty(999.7, "g")).toBe("1 kg");
  });
  it("does the same for volumes", () => {
    expect(formatQty(500, "ml")).toBe("500 ml");
    expect(formatQty(0.25, "L")).toBe("250 ml");
    expect(formatQty(2000, "ml")).toBe("2 L");
    expect(formatQty(1.5, "L")).toBe("1.5 L");
  });
  it("reads each as a plain count", () => {
    expect(formatQty(2, "each")).toBe("2");
    expect(formatQty(1.5, "each")).toBe("1½");
    expect(formatQty(0.5, "each")).toBe("½");
    expect(formatQty(0.25, "each")).toBe("¼");
    expect(qtyParts(3, "each")).toEqual({ value: "3", unit: "" });
    expect(qtyParts(150, "g")).toEqual({ value: "150", unit: "g" });
  });
  it("shows nothing for a zero or missing amount", () => {
    expect(formatQty(0, "g")).toBe("");
    expect(formatQty(NaN, "ml")).toBe("");
  });
});

describe("scaling", () => {
  it("multiplies without float noise", () => {
    expect(scaleQty(1 / 3, 3)).toBe(1);
    expect(scaleQty(0.1, 3)).toBe(0.3);
    expect(scaleQty(150, 0.5)).toBe(75);
    expect(scaleLabel(0.5)).toBe("×½");
    expect(scaleLabel(3)).toBe("×3");
  });
  it("scales the yield text and rolls grams up to kilos", () => {
    expect(yieldText(2, "kg")).toBe("Makes 2 kg");
    expect(yieldText(2, "kg", 0.5)).toBe("Makes 1 kg");
    expect(yieldText(1, "kg", 0.5)).toBe("Makes 500 g");
    expect(yieldText(500, "g" as never, 3)).toBe("Makes 1.5 kg");
    expect(yieldText(12, "each", 2)).toBe("Makes 24");
    expect(yieldText(0, "kg")).toBe("");
  });
});

describe("kitchen model", () => {
  const model = buildKitchenModel(parseKitchenData(RAW, SYNCED)!);

  it("lists a dish's components in order, named, with the pack size dropped", () => {
    expect(componentsOf(model, "item", "d-toast")).toEqual([
      { kind: "ingredient", id: "i-bread", name: "Sourdough", qty: 2, unit: "each", note: "toasted" },
      { kind: "ingredient", id: "i-avo", name: "Avocado", qty: 0.12, unit: "kg", note: null },
    ]);
    expect(componentsOf(model, "item", "d-burger").map((c) => [c.kind, c.name])).toEqual([["ingredient", "Chicken Thigh"], ["prep", "Garlic Aioli"]]);
    expect(componentsOf(model, "item", "nope")).toEqual([]);
  });

  it("finds the dishes that use a prep, through nested preps", () => {
    expect(usedIn(model, "p-aioli").map((d) => d.id)).toEqual(["d-burger"]);
    expect(usedIn(model, "p-pastry").map((d) => d.id)).toEqual(["d-tart"]);
    expect(usedIn(model, "p-base").map((d) => d.id)).toEqual(["d-tart"]);
    expect(usedIn(model, "missing")).toEqual([]);
  });

  it("survives a prep that loops back on itself", () => {
    const looped = parseKitchenData({ venue: { slug: "drift" }, dishes: [{ id: "d", name: "D" }], preps: [{ id: "a", name: "A" }, { id: "b", name: "B" }], lines: [
      { parent_type: "item", parent_id: "d", component_type: "prep", component_id: "a", qty: 1, unit: "g" },
      { parent_type: "prep", parent_id: "a", component_type: "prep", component_id: "b", qty: 1, unit: "g" },
      { parent_type: "prep", parent_id: "b", component_type: "prep", component_id: "a", qty: 1, unit: "g" },
    ] }, SYNCED)!;
    const m = buildKitchenModel(looped);
    expect(usedIn(m, "b").map((d) => d.id)).toEqual(["d"]);
    expect(usedIn(m, "nowhere")).toEqual([]);
    expect(dishAllergens(m, "d").notReviewed).toBe(true);
  });

  it("rolls allergens up with lib/allergens: a fully reviewed dish lists what it contains", () => {
    const a = dishAllergens(model, "d-toast");
    expect(a.notReviewed).toBe(false);
    expect(a.contains).toEqual(["Gluten"]);
    expect(a.none).toBe(false);
    expect(a.diet).toEqual(["Vegetarian", "Vegan"]);
  });

  it("never calls a dish clear while an ingredient is unreviewed, even one buried in a prep", () => {
    const a = dishAllergens(model, "d-burger");
    expect(a.notReviewed).toBe(true);
    expect(a.none).toBe(false);
    expect(a.unreviewed).toEqual(["Kewpie Mayo"]);
    expect(a.diet).toEqual([]);
    expect(a.notes).toEqual([{ label: "Milk", note: "no aioli" }]);
    expect(prepAllergens(model, "p-aioli").notReviewed).toBe(true);
  });

  it("rolls a nested prep's allergens into the dish that uses it", () => {
    const a = dishAllergens(model, "d-tart");
    expect(a.notReviewed).toBe(false);
    expect(a.contains).toEqual(["Gluten", "Milk"]);
    expect(a.diet).toEqual(["Vegetarian"]);
    expect(prepAllergens(model, "p-pastry").contains).toEqual(["Gluten", "Milk"]);
  });

  it("treats a dish with no recipe lines, or a missing component, as not reviewed", () => {
    const empty = buildKitchenModel(parseKitchenData({ venue: { slug: "drift" }, dishes: [{ id: "d", name: "D" }, { id: "e", name: "E" }], lines: [{ parent_type: "item", parent_id: "e", component_type: "ingredient", component_id: "gone", qty: 1, unit: "g" }] }, SYNCED)!);
    for (const id of ["d", "e"]) {
      const a = dishAllergens(empty, id);
      expect(a.notReviewed).toBe(true);
      expect(a.none).toBe(false);
      expect(a.diet).toEqual([]);
    }
  });

  it("only says 'no allergens listed' for a fully reviewed dish with nothing in it", () => {
    const m = buildKitchenModel(parseKitchenData({ venue: { slug: "drift" }, dishes: [{ id: "d", name: "D" }], ingredients: [{ id: "i", name: "Lettuce", allergens: [], allergens_reviewed: true }], lines: [{ parent_type: "item", parent_id: "d", component_type: "ingredient", component_id: "i", qty: 50, unit: "g" }] }, SYNCED)!);
    expect(dishAllergens(m, "d")).toMatchObject({ none: true, notReviewed: false, contains: [] });
  });

  it("never claims anything is free from or clear for an unreviewed recipe, whatever the allergens", () => {
    const m = buildKitchenModel(
      parseKitchenData({ venue: { slug: "drift" }, dishes: [{ id: "d", name: "D" }], ingredients: [{ id: "i", name: "Lettuce", allergens: [], allergens_reviewed: false }, { id: "j", name: "Peanut Sauce", allergens: ["peanuts"], allergens_reviewed: false }], lines: [{ parent_type: "item", parent_id: "d", component_type: "ingredient", component_id: "i", qty: 50, unit: "g" }, { parent_type: "item", parent_id: "d", component_type: "ingredient", component_id: "j", qty: 5, unit: "g" }] }, SYNCED)!,
    );
    const a = dishAllergens(m, "d");
    expect(a).toMatchObject({ notReviewed: true, none: false, diet: [], contains: ["Peanuts"] });
    // the display is built from the same roll-up the costing app shows
    const r = rollup({ kind: "item", id: "d" }, m.index);
    expect(allergenDisplay(r)).toEqual(a);
    expect(r.reviewed).toBe(false);
  });
});

describe("kitchen routes and photos", () => {
  it("opens only the kitchen routes", () => {
    for (const p of ["/kitchen", "/kitchen/drift", "/kitchen/setup", "/kitchen/manifest.webmanifest", "/kitchen/sw.js", "/kitchen/photo/uploads/a-1.jpg", "/api/kitchen/drift"]) expect(isKitchenPath(p)).toBe(true);
    for (const p of ["/", "/kitchens", "/kitchenette", "/menu", "/api/kitchen-data", "/items/kitchen", "/bar", "/api/bar/drift"]) expect(isKitchenPath(p)).toBe(false);
  });
  it("starts with Drift only, one line to add a venue", () => {
    expect([...KITCHEN_VENUES]).toEqual(["drift"]);
    expect(isKitchenVenue("drift")).toBe(true);
    expect(isKitchenVenue("chiobu")).toBe(false);
    expect(isKitchenVenue("../drift")).toBe(false);
  });
  it("serves uploaded photos through /kitchen/photo/ and nothing else", () => {
    expect(kitchenPhotoSrc("uploads/abc-1x.jpg")).toBe("/kitchen/photo/uploads/abc-1x.jpg");
    for (const bad of [null, undefined, "", "mai-tai.jpg", "uploads/../x.jpg", "/uploads/x.jpg", "uploads/x.svg", "https://x.test/a.jpg"]) expect(kitchenPhotoSrc(bad)).toBeNull();
  });
});

describe("station service workers", () => {
  const kitchen = stationWorkerSource({ scope: "/kitchen", cachePrefix: "kitchen", photoPrefixes: ["/kitchen/photo/"] });
  const bar = stationWorkerSource({ scope: "/bar", cachePrefix: "bar", photoPrefixes: ["/bar/cocktails/", "/bar/photo/"] });
  it("each keeps to its own scope, cache names and photos", () => {
    expect(kitchen).toContain('const SCOPE = "/kitchen"');
    expect(kitchen).toContain('const PREFIX = "kitchen-"');
    expect(kitchen).toContain('"/kitchen/photo/"');
    expect(kitchen).not.toMatch(/"\/bar|"bar-/);
    expect(bar).toContain('const SCOPE = "/bar"');
    expect(bar).toContain('const PREFIX = "bar-"');
    expect(bar).toContain('"/bar/cocktails/"');
    expect(bar).not.toMatch(/"\/kitchen|"kitchen-/);
  });
  it("is allowed to control only its station", async () => {
    expect(stationWorkerResponse({ scope: "/kitchen", cachePrefix: "kitchen", photoPrefixes: [] }).headers.get("Service-Worker-Allowed")).toBe("/kitchen");
    expect(stationWorkerResponse({ scope: "/bar", cachePrefix: "bar", photoPrefixes: [] }).headers.get("Service-Worker-Allowed")).toBe("/bar");
  });
});

describe("kitchen screens text contrast", () => {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  it("keeps every light text colour at 4.5:1 or better on the lightest card state (WCAG AA)", () => {
    const worstCard = "#232327"; // a pressed tile or the no-photo block
    const files = [...readdirSync("components/kitchen").map((f) => `components/kitchen/${f}`), "app/kitchen/page.tsx", "app/kitchen/setup/page.tsx"].filter((f) => f.endsWith(".tsx"));
    expect(files.length).toBeGreaterThan(3);
    const found = new Set<string>();
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(/(?:text|placeholder:text|stroke)-\[(#[0-9a-fA-F]{6})\]/g)) found.add(m[1].toUpperCase());
    }
    const light = [...found].filter((c) => lum(c) > 0.2); // dark text sits on light accent fills, checked by hand
    expect(light.length).toBeGreaterThan(0);
    for (const c of light) expect({ c, ratio: ratio(c, worstCard) >= 4.5 }).toEqual({ c, ratio: true });
  });
  it("keeps the amber warning, contains and diet chips readable on their own tinted backgrounds", () => {
    for (const [text, bg] of [["#F2C46D", "#2B2210"], ["#FFB3BC", "#2E1F23"], ["#8FD9A4", "#172619"]]) expect({ text, ok: ratio(text, bg) >= 4.5 }).toEqual({ text, ok: true });
  });
});
