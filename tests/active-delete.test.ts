import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ACTIVE_LABEL,
  ACTIVE_SUB,
  countInactive,
  ingredientListPool,
  INACTIVE_TAG,
  isActive,
  offerIsActive,
  showInactiveLabel,
  TAP_ACTIVE_LABEL,
  TAP_ACTIVE_SUB,
  visibleRecords,
} from "@/lib/active";
import {
  deleteDecision,
  inactiveImpactLines,
  nameList,
  needsOffConfirm,
  summariseUsage,
  usageOfBeer,
  usageOfIngredient,
  usageOfItem,
  usageOfPrep,
  type UsageData,
  type UsageRef,
} from "@/lib/record-usage";
import { ingredientsInActiveUse, ingredientChangeImpact } from "@/lib/insights";
import { CHECKS } from "@/lib/integrity";
import type { Ingredient, MenuItem, Prep, RecipeLine } from "@/lib/types";

const ing = (id: string, active = true): Ingredient => ({ id, name: id, active } as Ingredient);
const item = (id: string, active = true) => ({ id, name: `Item ${id}`, active });
const prep = (id: string, active = true) => ({ id, name: `Prep ${id}`, active });
const line = (parent_type: "item" | "prep", parent_id: string, component_type: "ingredient" | "prep", component_id: string, n = 0): RecipeLine => ({
  id: `${parent_type}-${parent_id}-${component_id}-${n}`,
  parent_type,
  parent_id,
  component_type,
  component_id,
  qty: 1,
  unit: "g",
  note: null,
  sort: n,
});

const data = (over: Partial<UsageData> = {}): UsageData => ({ lines: [], items: [], preps: [], ...over });

describe("shared Active wording", () => {
  it("is one wording everywhere", () => {
    expect(ACTIVE_LABEL).toBe("Active");
    expect(ACTIVE_SUB).toBe("Off hides it from lists, averages and alerts. Nothing is deleted.");
    expect(TAP_ACTIVE_LABEL).toBe("On Tap");
    expect(TAP_ACTIVE_SUB).toBe("Off means this keg is not on tap. It is hidden from lists, averages and alerts. Nothing is deleted.");
    expect(INACTIVE_TAG).toBe("Inactive");
  });
  it("Show Inactive reads the same on every list", () => {
    expect(showInactiveLabel(false, 3)).toBe("Show Inactive (3)");
    expect(showInactiveLabel(true, 3)).toBe("Hide Inactive");
  });
  it("no em dashes in the shared wording", () => {
    for (const s of [ACTIVE_SUB, TAP_ACTIVE_SUB]) expect(s).not.toContain("—");
  });
});

describe("inactive list filtering", () => {
  it("a missing flag counts as active", () => {
    expect(isActive({})).toBe(true);
    expect(isActive({ active: null })).toBe(true);
    expect(isActive({ active: false })).toBe(false);
  });
  it("counts and hides inactive records unless asked", () => {
    const list = [{ active: true }, { active: false }, { active: false }];
    expect(countInactive(list)).toBe(2);
    expect(visibleRecords(list, false)).toHaveLength(1);
    expect(visibleRecords(list, true)).toHaveLength(3);
  });
  it("offers are inactive once retired", () => {
    expect(offerIsActive({ status: "live" })).toBe(true);
    expect(offerIsActive({ status: "draft" })).toBe(true);
    expect(offerIsActive({ status: "retired" })).toBe(false);
    expect(countInactive([{ status: "live" }, { status: "retired" }] as const, offerIsActive)).toBe(1);
  });
  it("ingredients list: default is active and in use; Show Unused and search widen it; Show Inactive adds inactive ones", () => {
    const all = [ing("used"), ing("unused"), ing("off", false), ing("offUsed", false)];
    const inUse = new Set(["used", "offUsed"]);
    const ids = (o: Partial<Parameters<typeof ingredientListPool>[0]>) => ingredientListPool({ ingredients: all, inUse, showUnused: false, showInactive: false, searching: false, ...o }).map((i) => i.id);
    expect(ids({})).toEqual(["used"]);
    expect(ids({ showUnused: true })).toEqual(["used", "unused"]);
    expect(ids({ searching: true })).toEqual(["used", "unused"]);
    expect(ids({ showInactive: true })).toEqual(["used", "off", "offUsed"]);
    expect(ids({ showInactive: true, showUnused: true })).toEqual(["used", "unused", "off", "offUsed"]);
  });
});

describe("what uses a record", () => {
  it("an ingredient is used by dishes and preps that list it, once each, plus serves and tap beers", () => {
    const d = data({
      items: [item("i1"), item("i2", false)],
      preps: [prep("p1")],
      lines: [line("item", "i1", "ingredient", "a", 1), line("item", "i1", "ingredient", "a", 2), line("item", "i2", "ingredient", "a"), line("prep", "p1", "ingredient", "a"), line("item", "i1", "ingredient", "b")],
      serves: [{ id: "s1", name: "1 Scoop", active: true }],
      serveLines: [{ id: "sl", serve_id: "s1", ingredient_id: "a", qty: 1, unit: "each", sort: 0 }],
      beers: [{ id: "b1", name: "Pale Ale", active: true, ingredient_id: "a" }],
    });
    const refs = usageOfIngredient("a", d);
    expect(refs.map((r) => `${r.kind}:${r.id}`).sort()).toEqual(["beer:b1", "prep:p1", "recipe:i1", "recipe:i2", "serve:s1"]);
    expect(refs.find((r) => r.id === "i2")?.active).toBe(false);
    expect(usageOfIngredient("zzz", d)).toEqual([]);
    expect(summariseUsage(refs)).toBe("2 recipes, 1 prep, 1 tap beer and 1 serve");
  });
  it("a prep is used by dishes and other preps, never by itself", () => {
    const d = data({ items: [item("i1")], preps: [prep("p1"), prep("p2")], lines: [line("item", "i1", "prep", "p1"), line("prep", "p2", "prep", "p1"), line("prep", "p1", "prep", "p1")] });
    expect(usageOfPrep("p1", d).map((r) => r.id).sort()).toEqual(["i1", "p2"]);
    expect(usageOfPrep("p2", d)).toEqual([]);
  });
  it("a dish or tap beer is used by the offers that list it, retired ones included", () => {
    const d = data({
      offers: [
        { id: "o1", name: "Combo", status: "live" },
        { id: "o2", name: "Old", status: "retired" },
      ],
      offerLines: [
        { id: "l1", offer_id: "o1", component_kind: "item", item_id: "i1", beer_id: null, serve_id: null, qty: 1, price_inc_override: null, sort: 0 },
        { id: "l2", offer_id: "o1", component_kind: "beer_serve", item_id: null, beer_id: "b1", serve_id: "s", qty: 1, price_inc_override: null, sort: 1 },
        { id: "l3", offer_id: "o2", component_kind: "beer_serve", item_id: null, beer_id: "b1", serve_id: "s", qty: 1, price_inc_override: null, sort: 0 },
      ],
    });
    expect(usageOfItem("i1", d).map((r) => r.id)).toEqual(["o1"]);
    const beer = usageOfBeer("b1", d);
    expect(beer.map((r) => r.id).sort()).toEqual(["o1", "o2"]);
    expect(beer.find((r) => r.id === "o2")?.active).toBe(false);
    expect(usageOfItem("nope", d)).toEqual([]);
  });
});

describe("names list", () => {
  const refs = (n: number): UsageRef[] => Array.from({ length: n }, (_, i) => ({ kind: "recipe", id: `r${i}`, name: `Dish ${i + 1}`, href: "", active: true }));
  it("shows up to five names then 'and N more'", () => {
    expect(nameList(refs(2)).text).toBe("Dish 1 and Dish 2");
    expect(nameList(refs(5))).toMatchObject({ more: 0, names: ["Dish 1", "Dish 2", "Dish 3", "Dish 4", "Dish 5"] });
    const six = nameList(refs(8));
    expect(six.names).toHaveLength(5);
    expect(six.more).toBe(3);
    expect(six.text).toBe("Dish 1, Dish 2, Dish 3, Dish 4, Dish 5 and 3 more");
    expect(nameList([]).text).toBe("");
  });
  it("summarises one of a kind in the singular", () => {
    expect(summariseUsage(refs(1))).toBe("1 recipe");
    expect(summariseUsage([])).toBe("");
  });
});

describe("delete sheet decision", () => {
  const used: UsageRef[] = [
    { kind: "recipe", id: "a", name: "Parma", href: "", active: true },
    { kind: "prep", id: "b", name: "Sauce", href: "", active: true },
  ];
  it("used: Delete is not available, archive is offered and explains why", () => {
    const d = deleteDecision({ record: "prep", name: "Gravy", impact: { refs: used, notes: [] } });
    expect(d.canDelete).toBe(false);
    expect(d.archiveLabel).toBe("Make Inactive Instead");
    expect(d.usageSummary).toBe("Used in 1 recipe and 1 prep.");
    expect(d.blockedReason).toContain("cannot be deleted");
    expect(d.blockedReason).toContain("1 recipe and 1 prep");
    expect(d.names).toEqual(["Parma", "Sauce"]);
    expect(d.title).toBe("Delete “Gravy”?");
  });
  it("unused: archive is recommended and Delete Permanently carries the warning", () => {
    const d = deleteDecision({ record: "item", name: "Salad", impact: { refs: [], notes: [] } });
    expect(d.canDelete).toBe(true);
    expect(d.archiveLabel).toBe("Make Inactive Instead (Recommended)");
    expect(d.deleteLabel).toBe("Delete Permanently");
    expect(d.deleteWarning).toBe("This cannot be undone.");
    expect(d.blockedReason).toBeNull();
    expect(d.usageSummary).toBeNull();
    expect(d.lead).toContain("Nothing else uses it");
  });
  it("a plain note (a serve every flavour uses) shows but does not block", () => {
    const d = deleteDecision({ record: "serve", name: "1 Scoop", impact: { refs: [], notes: ["Every flavour (32) loses this serve."] } });
    expect(d.canDelete).toBe(true);
    expect(d.notes).toEqual(["Every flavour (32) loses this serve."]);
    expect(d.lead).not.toContain("Nothing else uses it");
  });
  it("already inactive: nothing to archive, the button keeps it that way", () => {
    const d = deleteDecision({ record: "beer", name: "Lager", impact: { refs: [], notes: [] }, alreadyInactive: true });
    expect(d.archiveLabel).toBe("Keep It Inactive");
    expect(d.archiveChangesRecord).toBe(false);
    expect(d.canDelete).toBe(true);
    const u = deleteDecision({ record: "beer", name: "Lager", impact: { refs: used, notes: [] }, alreadyInactive: true });
    expect(u.canDelete).toBe(false);
    expect(u.blockedReason).toContain("already inactive");
  });
});

describe("impact before turning off", () => {
  it("only asks when something uses the record, and promises the cost stays", () => {
    const none = { refs: [], notes: [] };
    expect(needsOffConfirm(none)).toBe(false);
    const used = { refs: [{ kind: "recipe", id: "a", name: "Parma", href: "", active: true } as UsageRef], notes: [] };
    expect(needsOffConfirm(used)).toBe(true);
    expect(inactiveImpactLines("ingredient", used)).toEqual(["Used in 1 recipe. They keep their cost, but it will not be offered for new recipes."]);
    expect(inactiveImpactLines("beer", used)[0]).toContain("They keep their cost");
    expect(needsOffConfirm({ refs: [], notes: ["x"] })).toBe(true);
  });
});

describe("audit fixes", () => {
  it("only ingredients that something active uses are 'in use' (inactive recipes raise no alerts)", () => {
    const lines = [
      line("item", "live", "ingredient", "a"),
      line("item", "dead", "ingredient", "b"),
      line("item", "live", "prep", "viaInactivePrep"),
      line("prep", "viaInactivePrep", "ingredient", "c"),
      line("prep", "deadPrep", "ingredient", "d"),
      line("prep", "loosePrep", "ingredient", "e"),
    ];
    const used = ingredientsInActiveUse(lines, [{ id: "live", active: true }, { id: "dead", active: false }], [
      { id: "viaInactivePrep", active: false },
      { id: "deadPrep", active: false },
      { id: "loosePrep", active: true },
    ]);
    expect([...used].sort()).toEqual(["a", "c", "e"]);
  });
  it("a cost-change preview leaves out inactive dishes", () => {
    const ingredient = { id: "a", name: "A", category: "Food", supplier_id: null, supplier_code: null, pack_size: 1, pack_unit: "kg", pack_price: 10, price_inc_gst: false, gst_free: false, rebate: 0, yield_pct: 1, venues: "All", active: true } as Ingredient;
    const mk = (id: string, active: boolean) => ({ id, name: id, venue_id: 1, category: "Food", section: null, portions: 1, sell_price_inc: 30, target_override: null, hh_price_inc: null, active, source: null, notes: null }) as MenuItem;
    const rows = ingredientChangeImpact(
      "a",
      { pack_price: 20 },
      {
        ingredients: [ingredient],
        preps: [] as Prep[],
        lines: [line("item", "on", "ingredient", "a"), line("item", "off", "ingredient", "a")],
        items: [mk("on", true), mk("off", false)],
        settings: { gst_rate: 0.1, round_to: 0.5, alert_pct: 0.05, gelato_wastage: 0.05 },
        targets: [],
      },
    );
    expect(rows.map((r) => r.item.id)).toEqual(["on"]);
  });
  it("an inactive ingredient that a recipe still uses is information, not a warning (it is allowed and keeps costing)", () => {
    expect(CHECKS.inactive_in_use.severity).toBe("info");
  });
});

/* ---------------------------------------------------------------- static checks on the code */

const root = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

describe("Active, not Delete: static checks", () => {
  it("the recipe editor no longer hides Make Inactive / Make Active in the overflow menu, or Delete", () => {
    const src = read("components/editor/recipe-editor.tsx");
    expect(src).not.toMatch(/label: [^\n]*Make (In)?[Aa]ctive/);
    expect(src).not.toContain('label: "Delete…"');
    expect(src).toContain("<ActiveToggle");
    expect(src).toContain("<DeleteRecordSheet");
  });
  it("every delete goes through the impact sheet", () => {
    const files = [...walk("app"), ...walk("components")].filter((f) => f !== path.join("components", "active-parts.tsx"));
    const calls = /\bstore\s*\.\s*(deleteItem|deletePrep|deleteServe|deleteBeer|deleteOffer|deleteDeal)\s*\(|\.\s*(deleteItem|deletePrep|deleteServe|deleteBeer|deleteOffer|deleteDeal)\s*\(/;
    const hits = files.filter((f) => calls.test(read(f)));
    expect(hits.length).toBeGreaterThanOrEqual(5);
    for (const f of hits) {
      const src = read(f);
      expect(src, f).toContain("<DeleteRecordSheet");
      // the call sits inside an onDelete handler, never on a bare button
      for (const m of src.matchAll(/\.\s*(deleteItem|deletePrep|deleteServe|deleteBeer|deleteOffer|deleteDeal)\s*\(/g)) {
        const before = src.slice(Math.max(0, (m.index ?? 0) - 700), m.index);
        expect(before, `${f} ${m[1]}`).toMatch(/onDelete=/);
      }
      expect(src, f).not.toMatch(/confirmDelete/);
    }
  });
  it("no raw .delete( on a cost table outside the store", () => {
    for (const f of [...walk("app"), ...walk("components")]) expect(read(f), f).not.toMatch(/\.from\(\s*["']cost_[a-z_]+["']\s*\)\s*\.delete\(/);
  });
  it("every record page uses the one Active switch (Toggle label Active is gone from pages)", () => {
    for (const f of ["app/(app)/ingredients/[id]/page.tsx", "app/(app)/beers/[id]/page.tsx", "app/(app)/gelato/serves/page.tsx", "components/deal-editor.tsx", "components/offer-builder.tsx", "components/editor/recipe-editor.tsx"]) {
      const src = read(f);
      expect(src, f).toContain("<ActiveToggle");
      expect(src, f).not.toMatch(/<Toggle[^>]*label="Active"/);
    }
    expect(read("app/(app)/beers/[id]/page.tsx")).toContain("TAP_ACTIVE_SUB");
    expect(read("components/deal-editor.tsx")).not.toContain("Turn Off");
  });
  it("every list that can hold inactive records has Show Inactive", () => {
    for (const f of ["app/(app)/menu/page.tsx", "app/(app)/ingredients/page.tsx", "components/preps-list.tsx", "app/(app)/gelato/page.tsx", "app/(app)/gelato/serves/page.tsx", "app/(app)/specials/page.tsx", "components/deal-editor.tsx"]) {
      expect(read(f), f).toContain("ShowInactiveButton");
    }
  });
  it("the cocktail station switch is untouched and no Active switch is added to drinks that have it", () => {
    expect(read("components/editor/bar-fields.tsx")).toContain("Show On Cocktail Station");
    expect(read("components/editor/recipe-editor.tsx")).toContain("isBarCategory(item.category)");
  });
});
