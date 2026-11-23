import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  applySort,
  contactTarget,
  isActiveMaster,
  planAddSupplier,
  suppliersNotAtVenue,
  moneyInput,
  moveItem,
  nameTaken,
  parseMoney,
  parseQuantity,
  parseWhole,
  placesText,
  productGroups,
  productSub,
  resolveContact,
  secondPlaceChoice,
  sortChanges,
  supplierGap,
  suggestMethod,
  unitChoice,
} from "@/lib/ordering-setup";
import { orderingFixture, fixtureId, fixtureIngredients, linkedFixtureProducts } from "@/lib/ordering-fixture";
import { factsFrom, orderPriceShort } from "@/lib/ordering-facts";
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
  it("a product's sub line reads Counted By, supplier, and the price worked out from its ingredient (never the one stored on it)", () => {
    const names = new Map(drift.suppliers.map((s) => [s.id, s.name]));
    const ings = new Map(fixtureIngredients().map((i) => [i.id, i]));
    const factsOf = factsFrom({ ingredientById: (id) => ings.get(id), gstRate: 0.1 });
    const keg = linkedFixtureProducts(1)[0];
    expect(keg.price_inc_gst).toBeNull(); // nothing stored on the thin item
    expect(productSub(keg, names, orderPriceShort(factsOf(keg)))).toBe("Keg · Lion · $210.00");
    expect(productSub({ ...keg, supplier_id: null }, names)).toBe("Keg · No supplier");
    // a stored price is NOT read by the sub line any more: with no price handed in, none is printed
    expect(productSub(drift.products[0], names)).toBe("Keg · Lion");
  });
  it("names are unique per list, ignoring case, except the row being edited", () => {
    expect(nameTaken("lion", drift.suppliers)).toBe(true);
    expect(nameTaken("Lion", drift.suppliers, drift.suppliers.find((s) => s.name === "Lion")!.id)).toBe(false);
    expect(nameTaken("  ", drift.suppliers)).toBe(false);
  });
});

describe("the example data", () => {
  it("fixture ids differ per venue", () => {
    expect(fixtureId("prd", 1, 1)).not.toBe(fixtureId("prd", 3, 1));
  });
});

/* ------------------------------------------------------------------ one supplier list */

describe("the one supplier list on the ordering screens", () => {
  const masters = [
    { id: 9001, name: "Star" },
    { id: 9002, name: "Lion" },
    { id: 9003, name: "Diablo", active: false },
    { id: 9004, name: "Coke" },
    { id: 9005, name: "Bidfood" },
  ];
  const here = greedy.suppliers.filter((s) => s.name !== "Diablo"); // Lion and Coke at this venue

  it("Add Supplier offers the active suppliers this venue has no terms row for, A to Z", () => {
    expect(suppliersNotAtVenue(masters, here).map((m) => m.name)).toEqual(["Bidfood", "Star"]);
    expect(suppliersNotAtVenue(masters, [])).toHaveLength(4); // the switched off Diablo is never offered
    expect(suppliersNotAtVenue(masters, drift.suppliers).map((m) => m.name)).toEqual(["Bidfood"]);
  });
  it("a terms row that is switched off still counts as at this venue", () => {
    const off = here.map((s) => (s.name === "Lion" ? { ...s, active: false } : s));
    expect(suppliersNotAtVenue(masters, off).map((m) => m.name)).not.toContain("Lion");
  });
  it("a supplier with no active flag (read before the column existed) counts as active", () => {
    expect(isActiveMaster({ id: 1, name: "X" })).toBe(true);
    expect(isActiveMaster({ id: 1, name: "X", active: true })).toBe(true);
    expect(isActiveMaster({ id: 1, name: "X", active: false })).toBe(false);
  });
  describe("typing a name in Add A New Supplier", () => {
    it("asks for a name when there is none", () => {
      expect(planAddSupplier("   ", masters, here)).toMatchObject({ kind: "empty" });
    });
    it("uses a supplier the list already has, however it is typed, instead of adding it twice", () => {
      expect(planAddSupplier("bid food pty ltd", masters, here)).toEqual({ kind: "existing", master: masters[4] });
      expect(planAddSupplier("STAR", masters, here)).toEqual({ kind: "existing", master: masters[0] });
    });
    it("says so when this venue already has the supplier", () => {
      const r = planAddSupplier("lion", masters, here);
      expect(r).toMatchObject({ kind: "at_venue", message: "Lion is already one of this venue's suppliers." });
    });
    it("does not quietly use a supplier that is switched off", () => {
      const r = planAddSupplier("Diablo", masters, here);
      expect(r.kind).toBe("inactive");
      expect((r as { message: string }).message).toMatch(/Suppliers tab of Ingredients/);
    });
    it("adds a name nobody has to the list, tidied like every other name", () => {
      expect(planAddSupplier("  new   wine  co ", masters, here)).toEqual({ kind: "new", name: "New Wine Co" });
    });
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
  it("one supplier list: the supplier name is read only on a terms page, and a product's supplier is its ingredient's", () => {
    const supplierPage = readFileSync(path.join("app", "(app)", "ordering", "[venue]", "setup", "suppliers", "[id]", "page.tsx"), "utf8");
    expect(supplierPage).toContain("/ingredients?type=suppliers");
    expect(supplierPage).toContain("Renamed on the Suppliers tab of Ingredients");
    expect(supplierPage).not.toMatch(/persist\(\{\s*name/);
    // a product page writes nothing about the product but Active: it sends the person to the ingredient
    const productPage = readFileSync(path.join("app", "(app)", "ordering", "[venue]", "setup", "products", "[id]", "page.tsx"), "utf8");
    expect(productPage).toContain("ingredientOrderingHref(product.ingredient_id)");
    expect(productPage).toContain("router.replace(goTo)");
    expect(productPage).not.toMatch(/ensureTermsRow|supplier_id:/);
    expect([...productPage.matchAll(/updateProduct\(sb, id, (\{[^}]*\})\)/g)].map((m) => m[1])).toEqual(["{ active }"]);
  });
  it("no bare delete: Ordering uses Active switches, never deletes a record", () => {
    for (const f of MY_FILES) expect(readFileSync(f, "utf8"), f).not.toMatch(/\.delete\(\)/);
  });
  it("the data layer for these screens has no raw insert and imports the shared helpers", () => {
    const src = readFileSync("lib/ordering-screens-data.ts", "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src.match(/\.insert\(/g) ?? []).toHaveLength(0);
    // since Copy Products From Another Venue was removed (23 Nov 2026) these screens insert nothing at all
    expect(src).not.toMatch(/insertRows?\(/);
  });
  it("no em or en dashes in anything a person reads", () => {
    for (const f of [...MY_FILES, "lib/ordering-setup.ts", "lib/ordering-history-view.ts"]) {
      const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(src, f).not.toMatch(/[—–]/);
    }
  });
});
