import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  applySort,
  contactTarget,
  copyImpactLines,
  copyIsEmpty,
  moneyInput,
  moveItem,
  nameTaken,
  packsSentence,
  parseMoney,
  parseQuantity,
  parseWhole,
  planVenueCopy,
  placesText,
  productGroups,
  productPricing,
  productSub,
  resolveContact,
  secondPlaceChoice,
  sortChanges,
  supplierGap,
  suggestMethod,
  unitChoice,
} from "@/lib/ordering-setup";
import { orderingFixture, fixtureId } from "@/lib/ordering-fixture";
import type { OrderingProduct } from "@/lib/ordering-types";

const drift = orderingFixture(1);
const greedy = orderingFixture(3);

describe("typed values", () => {
  it("money: dollars and cents, never negative or NaN", () => {
    expect(parseMoney("$62")).toBe(62);
    expect(parseMoney("1,234.5")).toBe(1234.5);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("-3")).toBeNull();
    expect(moneyInput(62)).toBe("62.00");
    expect(moneyInput(null)).toBe("");
  });
  it("pack multiple is a whole number of at least 1", () => {
    expect(parseWhole("6")).toBe(6);
    expect(parseWhole("0")).toBeNull();
    expect(parseWhole("2.5")).toBeNull();
    expect(parseWhole("")).toBeNull();
  });
  it("quantities allow zero and decimals but not negatives", () => {
    expect(parseQuantity("0")).toBe(0);
    expect(parseQuantity("2.5")).toBe(2.5);
    expect(parseQuantity("-1")).toBeNull();
    expect(parseQuantity("x")).toBeNull();
  });
  it("units and second places map to a choice, with Other for custom words", () => {
    expect(unitChoice("Carton")).toBe("carton");
    expect(unitChoice("tray")).toBe("other");
    expect(secondPlaceChoice(null)).toBe("none");
    expect(secondPlaceChoice("Bar")).toBe("Bar");
    expect(secondPlaceChoice("Cellar")).toBe("other");
    expect(placesText(null)).toBe("Store only");
    expect(placesText("Coldroom")).toBe("Store and Coldroom");
  });
});

describe("supplier contact: an email address means Email, a web address means Login", () => {
  it("suggests the method from what is typed", () => {
    expect(suggestMethod("orders@star.com.au")).toBe("email");
    expect(suggestMethod("www.lion.com.au")).toBe("website");
    expect(suggestMethod("https://orders.coke.com.au/login")).toBe("website");
    expect(suggestMethod("call the rep")).toBeNull();
    expect(contactTarget("a@b.com")).toBe("email_to");
    expect(contactTarget("www.x.com")).toBe("login_url");
  });
  it("an email typed in the email field sets the email and the method", () => {
    const r = resolveContact("email_to", "Orders@Star.com.au; sales@star.com.au", "website");
    expect(r.error).toBeNull();
    expect(r.patch.email_to).toBe("Orders@Star.com.au, sales@star.com.au");
    expect(r.patch.method).toBe("email");
    expect(r.note).toContain("Email");
    expect(r.moved).toBe(false);
  });
  it("a web address typed in the email field moves to the login link and the method follows", () => {
    const r = resolveContact("email_to", "www.lion.com.au", "email");
    expect(r.moved).toBe(true);
    expect(r.patch).toEqual({ login_url: "https://www.lion.com.au", method: "website" });
    expect(r.note).toMatch(/web address/);
  });
  it("a value that is neither is refused with plain words and saves nothing", () => {
    const r = resolveContact("login_url", "ring Kevin", "email");
    expect(r.patch).toEqual({});
    expect(r.error).toMatch(/web address/);
    expect(resolveContact("email_to", "not an email", "email").error).toMatch(/email address/);
  });
  it("clearing a field clears it and leaves the method alone", () => {
    expect(resolveContact("email_to", "  ", "email")).toEqual({ patch: { email_to: null }, note: null, error: null, moved: false });
  });
  it("the method already matching adds no note", () => {
    expect(resolveContact("email_to", "a@b.com", "email").note).toBeNull();
  });
  it("a supplier with nothing to send to is flagged", () => {
    expect(supplierGap({ method: "email", email_to: null, login_url: null })).toMatch(/email address/);
    expect(supplierGap({ method: "website", email_to: null, login_url: null })).toMatch(/login link/);
    expect(supplierGap({ method: "app", email_to: null, login_url: null })).toBeNull();
    expect(supplierGap({ method: "email", email_to: "a@b.com", login_url: null })).toBeNull();
  });
});

describe("product pricing and the linked-ingredient sentence", () => {
  it("shows the ex GST price and the price of one costing pack", () => {
    const p = productPricing(62, 24);
    expect(p.ex).toBe(56.36);
    expect(p.perPackInc).toBe(2.58);
    expect(p.perPackEx).toBe(2.35);
  });
  it("no price or no pack count gives nulls, never NaN", () => {
    expect(productPricing(null, 24)).toEqual({ ex: null, perPackInc: null, perPackEx: null });
    expect(productPricing(62, null).perPackInc).toBeNull();
    expect(productPricing(62, 0).perPackInc).toBeNull();
  });
  it("the sentence names the unit, the pack count and the per-pack price", () => {
    expect(packsSentence("carton", 62, 24)).toBe("One carton holds 24 packs, so each pack costs $2.58 inc GST ($2.35 ex GST).");
    expect(packsSentence("keg", 62, 1)).toContain("holds 1 pack,");
    expect(packsSentence("carton", null, 24)).toBeNull();
  });
});

describe("reordering", () => {
  const rows = [
    { id: "a", sort: 1 },
    { id: "b", sort: 2 },
    { id: "c", sort: 3 },
    { id: "d", sort: 4 },
  ];
  it("moveItem moves one row and leaves the input alone", () => {
    expect(moveItem(rows, 0, 2).map((r) => r.id)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(rows, 3, 0).map((r) => r.id)).toEqual(["d", "a", "b", "c"]);
    expect(moveItem(rows, 1, 99).map((r) => r.id)).toEqual(["a", "c", "d", "b"]);
    expect(moveItem(rows, 1, 1)).toEqual(rows);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("sortChanges returns only the rows whose sort changes", () => {
    expect(sortChanges(moveItem(rows, 2, 3))).toEqual([
      { id: "d", sort: 3 },
      { id: "c", sort: 4 },
    ]);
    expect(sortChanges(rows)).toEqual([]);
  });
  it("tied sorts (all 0, as an import can leave them) are renumbered 1..n", () => {
    const tied = [{ id: "x", sort: 0 }, { id: "y", sort: 0 }, { id: "z", sort: 0 }];
    expect(sortChanges(tied)).toEqual([{ id: "x", sort: 1 }, { id: "y", sort: 2 }, { id: "z", sort: 3 }]);
  });
  it("applySort updates only the named rows", () => {
    const out = applySort(rows, [{ id: "b", sort: 9 }]);
    expect(out.find((r) => r.id === "b")?.sort).toBe(9);
    expect(out.find((r) => r.id === "a")?.sort).toBe(1);
  });
});

describe("the Products list", () => {
  const input = { products: drift.products, categories: drift.categories, suppliers: drift.suppliers, categoryId: "", query: "", showInactive: false };
  it("groups by category in count order, products in their own order", () => {
    const g = productGroups(input);
    expect(g.map((x) => x.category.name)).toEqual(["Kegs", "Beer & RTD", "Wine", "Spirits", "Post-Mix", "Soft Drink"]);
    expect(g[0].products.map((p) => p.name)).toEqual(["XXXX Gold Keg", "Pale Ale Keg", "Ginger Beer Keg"]);
  });
  it("a category chip shows only that category", () => {
    const spirits = drift.categories.find((c) => c.name === "Spirits")!;
    const g = productGroups({ ...input, categoryId: spirits.id });
    expect(g).toHaveLength(1);
    expect(g[0].products).toHaveLength(3);
  });
  it("search matches the name, supplier, item code and category, every word", () => {
    expect(productGroups({ ...input, query: "bourbon" }).flatMap((g) => g.products.map((p) => p.name))).toEqual(["Bourbon Bottle"]);
    expect(productGroups({ ...input, query: "300302" }).flatMap((g) => g.products.map((p) => p.name))).toEqual(["Aperol Bottle"]);
    expect(productGroups({ ...input, query: "diablo" }).flatMap((g) => g.products.map((p) => p.name))).toEqual(["Ginger Beer Keg"]);
    expect(productGroups({ ...input, query: "spirits star" }).flatMap((g) => g.products)).toHaveLength(3);
    expect(productGroups({ ...input, query: "zzz" })).toEqual([]);
  });
  it("inactive products are hidden until Show Inactive", () => {
    const off: OrderingProduct[] = drift.products.map((p, i) => (i === 0 ? { ...p, active: false } : p));
    const hidden = productGroups({ ...input, products: off }).flatMap((g) => g.products);
    expect(hidden.some((p) => p.name === "XXXX Gold Keg")).toBe(false);
    const shown = productGroups({ ...input, products: off, showInactive: true }).flatMap((g) => g.products);
    expect(shown.some((p) => p.name === "XXXX Gold Keg")).toBe(true);
  });
  it("a product's sub line reads unit, supplier, price", () => {
    const names = new Map(drift.suppliers.map((s) => [s.id, s.name]));
    expect(productSub(drift.products[0], names)).toBe("Keg · Lion · $210.00");
    expect(productSub({ ...drift.products[0], supplier_id: null, price_inc_gst: null }, names)).toBe("Keg · No supplier");
  });
  it("names are unique per list, ignoring case, except the row being edited", () => {
    expect(nameTaken("lion", drift.suppliers)).toBe(true);
    expect(nameTaken("Lion", drift.suppliers, drift.suppliers.find((s) => s.name === "Lion")!.id)).toBe(false);
    expect(nameTaken("  ", drift.suppliers)).toBe(false);
  });
});

describe("Copy Products From Another Venue", () => {
  const empty = { suppliers: [], categories: [], products: [] };
  it("copies categories, suppliers and active products into an empty venue, and nothing venue specific", () => {
    const plan = planVenueCopy(drift, empty);
    expect(plan.categories.map((c) => c.name)).toEqual(["Kegs", "Beer & RTD", "Wine", "Spirits", "Post-Mix", "Soft Drink"]);
    expect(plan.suppliers.map((s) => s.name).sort()).toEqual(["Coke", "Diablo", "Lion", "Star"]);
    expect(plan.products).toHaveLength(drift.products.length);
    for (const s of plan.suppliers) expect(s.account_no).toBeNull();
    for (const p of plan.products) {
      expect(p.draft.par).toBe(0);
      expect(p.draft.price_inc_gst).toBeNull();
      expect(p.draft.ingredient_id).toBeNull();
      expect(p.draft.costing_packs_per_unit).toBeNull();
    }
    const vodka = plan.products.find((p) => p.draft.name === "Vodka Bottle")!;
    expect(vodka).toMatchObject({ categoryName: "Spirits", supplierName: "Star" });
    expect(vodka.draft.pack_multiple).toBe(12);
    expect(vodka.draft.supplier_item_code).toBe("300303");
  });
  it("the plan holds names, not ids, so nothing from the source venue can leak into the target", () => {
    const json = JSON.stringify(planVenueCopy(drift, empty));
    expect(json).not.toContain("venue_id");
    for (const p of drift.products) expect(json).not.toContain(p.id);
    for (const c of drift.categories) expect(json).not.toContain(c.id);
  });
  it("leaves inactive products behind", () => {
    const off = { ...drift, products: drift.products.map((p, i) => (i < 2 ? { ...p, active: false } : p)) };
    expect(planVenueCopy(off, empty).products).toHaveLength(drift.products.length - 2);
  });
  it("matches by name, so a second copy adds nothing and a partial venue only gets what is missing", () => {
    // Greedy already has its own list: copying Drift adds only the Star supplier and the 15 L Lift bag (Greedy's is 5 L)
    const plan = planVenueCopy(drift, greedy);
    expect(plan.categories).toEqual([]);
    expect(plan.suppliers.map((s) => s.name)).toEqual(["Star"]);
    expect(plan.skipped.categories).toBe(6);
    expect(plan.skipped.suppliers).toBe(3);
    const copied = plan.products.map((p) => p.draft.name).sort();
    expect(copied).toEqual(["Lift Post-Mix Bag (15 L)"]);
    expect(plan.skipped.products).toBe(drift.products.length - 1);
    // the new product goes after the last product Greedy already has in Post-Mix
    expect(plan.products[0].draft.sort).toBe(13);
  });
  it("new rows continue the target's sort order", () => {
    const target = { suppliers: [], categories: [{ ...drift.categories[0], id: "t1", sort: 7, name: "Kegs" }], products: [] };
    const plan = planVenueCopy(drift, target);
    expect(plan.categories[0].name).toBe("Beer & RTD");
    expect(plan.categories[0].sort).toBe(8);
  });
  it("copy again immediately: nothing to add", () => {
    const first = planVenueCopy(drift, empty);
    // pretend the target now holds what the plan added
    const cats = first.categories.map((c, i) => ({ ...drift.categories[0], ...c, id: `c${i}`, venue_id: 9 }));
    const sups = first.suppliers.map((s, i) => ({ ...drift.suppliers[0], ...s, id: `s${i}`, venue_id: 9 }));
    const prods = first.products.map((p, i) => ({ ...drift.products[0], ...p.draft, id: `p${i}`, venue_id: 9, category_id: cats.find((c) => c.name === p.categoryName)!.id }));
    const again = planVenueCopy(drift, { categories: cats, suppliers: sups, products: prods });
    expect(copyIsEmpty(again)).toBe(true);
  });
  it("the impact lines say what is added and what is left behind", () => {
    const lines = copyImpactLines(planVenueCopy(drift, empty), "Drift", "Chiobu");
    expect(lines[0]).toBe("This adds 6 categories, 4 suppliers, 14 products from Drift to Chiobu.");
    expect(lines.join(" ")).toMatch(/Counts, orders, prices and account numbers are not copied/);
    expect(lines.join(" ")).toMatch(/independent/);
    expect(lines.join(" ")).not.toMatch(/[—–]/);
  });
  it("fixture ids differ per venue", () => {
    expect(fixtureId("prd", 1, 1)).not.toBe(fixtureId("prd", 3, 1));
  });
});

/* ------------------------------------------------------------------ source guards for the Setup, History and Home screens */

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}
const MY_FILES = [
  ...walk("components/ordering").filter((f) => !/[\\/](count|orders)[\\/]/.test(f)),
  path.join("app", "(app)", "ordering", "page.tsx"),
  path.join("app", "(app)", "ordering", "[venue]", "layout.tsx"),
  path.join("app", "(app)", "ordering", "[venue]", "page.tsx"),
  ...walk(path.join("app", "(app)", "ordering", "[venue]", "setup")),
  ...walk(path.join("app", "(app)", "ordering", "[venue]", "history")),
];

describe("Ordering home, Setup and History screens: house rules", () => {
  it("no control shrinks below 44px at any breakpoint", () => {
    const bad: string[] = [];
    for (const f of MY_FILES) {
      const src = readFileSync(f, "utf8");
      // sm:min-h-[36px], lg:h-9 ... any breakpoint-prefixed height under 44px (a shrunk tap target)
      for (const m of src.matchAll(/\b(?:sm|md|lg|xl):(?:min-)?h-(?:\[(\d+)px\]|(\d+(?:\.\d+)?))(?![\d\w%/])/g)) {
        const px = m[1] != null ? Number(m[1]) : Number(m[2]) * 4;
        if (px < 44) bad.push(`${f}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it("no bare delete: Ordering uses Active switches, never deletes a record", () => {
    for (const f of MY_FILES) expect(readFileSync(f, "utf8"), f).not.toMatch(/\.delete\(\)/);
  });
  it("the data layer for these screens has no raw insert and imports the shared helpers", () => {
    const src = readFileSync("lib/ordering-screens-data.ts", "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src.match(/\.insert\(/g) ?? []).toHaveLength(0);
    expect(src).toContain("insertRows");
  });
  it("no em or en dashes in anything a person reads", () => {
    for (const f of [...MY_FILES, "lib/ordering-setup.ts", "lib/ordering-history-view.ts"]) {
      const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(src, f).not.toMatch(/[—–]/);
    }
  });
});
