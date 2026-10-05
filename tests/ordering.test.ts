import { describe, expect, it } from "vitest";
import {
  UNASSIGNED,
  buildSupplierOrders,
  defaultUnitForCategory,
  draftLineForProduct,
  draftLinesFromSuggestions,
  exGst,
  groupProductsByCategory,
  lineTotals,
  minimumWarning,
  orderTotals,
  orderingVenueName,
  roundUpToMultiple,
  sortProducts,
  suggestOrder,
} from "@/lib/ordering";
import type { OrderingCategory, OrderingProduct, OrderingSupplier } from "@/lib/ordering-types";

const prod = (over: Partial<OrderingProduct> = {}): OrderingProduct => ({
  id: "p1", venue_id: 1, category_id: "c1", sort: 1, name: "Jim Beam", unit_name: "bottle", supplier_id: "s1", supplier_item_code: null, pack_multiple: 1,
  price_inc_gst: null, ingredient_id: null, costing_packs_per_unit: null, par: 18, notes: null, active: true, ...over,
});
const supplier = (over: Partial<OrderingSupplier> = {}): OrderingSupplier => ({
  id: "s1", venue_id: 1, name: "Star", method: "email", email_to: null, login_url: null, rep_name: null, rep_phone: null, account_no: null,
  min_order_value: null, min_order_units: null, show_prices_on_order: false, notes: null, active: true, sort: 1, ...over,
});
const cat = (id: string, sort: number, name = id): OrderingCategory => ({ id, venue_id: 1, name, sort, second_location_label: null, unit_name: "carton" });

describe("suggestOrder", () => {
  it("orders par minus (store + second place)", () => {
    const s = suggestOrder(prod({ par: 18 }), 15, 0);
    expect(s).toEqual({ uncounted: false, counted: 15, need: 3, orderQty: 3, over: 0, belowPar: true });
  });
  it("adds both places", () => {
    expect(suggestOrder(prod({ par: 10 }), 4, 3)).toMatchObject({ counted: 7, need: 3, orderQty: 3 });
  });
  it("overstock is reported as over, never a negative order", () => {
    const s = suggestOrder(prod({ par: 4 }), 6, 1);
    expect(s).toMatchObject({ counted: 7, need: -3, orderQty: 0, over: 3, belowPar: false });
  });
  it("exactly at par orders nothing and is not over", () => {
    expect(suggestOrder(prod({ par: 6 }), 4, 2)).toMatchObject({ need: 0, orderQty: 0, over: 0, belowPar: false });
  });
  it("rounds the ORDER up to the pack multiple, not the need", () => {
    expect(suggestOrder(prod({ par: 18, pack_multiple: 6 }), 15, 0)).toMatchObject({ need: 3, orderQty: 6 });
    expect(suggestOrder(prod({ par: 12, pack_multiple: 12 }), 1, 0)).toMatchObject({ need: 11, orderQty: 12 });
    expect(suggestOrder(prod({ par: 12, pack_multiple: 12 }), 0, 0)).toMatchObject({ need: 12, orderQty: 12 });
    expect(suggestOrder(prod({ par: 24, pack_multiple: 6 }), 5, 0)).toMatchObject({ need: 19, orderQty: 24 });
  });
  it("does not round an overstocked product up to a pack", () => {
    expect(suggestOrder(prod({ par: 6, pack_multiple: 6 }), 9, 0)).toMatchObject({ orderQty: 0, over: 3 });
  });
  it("no count in either place means uncounted: no suggestion at all", () => {
    for (const s of [suggestOrder(prod(), null, null), suggestOrder(prod(), undefined, undefined)]) {
      expect(s).toEqual({ uncounted: true, counted: null, need: 0, orderQty: 0, over: 0, belowPar: false });
    }
  });
  it("a deliberate zero is a count, not an absence", () => {
    const s = suggestOrder(prod({ par: 6 }), 0, null);
    expect(s).toMatchObject({ uncounted: false, counted: 0, need: 6, orderQty: 6, belowPar: true });
    expect(suggestOrder(prod({ par: 6 }), 0, 0)).toMatchObject({ uncounted: false, orderQty: 6 });
  });
  it("a place left null counts as 0 once the other place was counted", () => {
    expect(suggestOrder(prod({ par: 6 }), null, 4)).toMatchObject({ counted: 4, orderQty: 2 });
    expect(suggestOrder(prod({ par: 6 }), 4, null)).toMatchObject({ counted: 4, orderQty: 2 });
  });
  it("a par of 0 never orders", () => {
    expect(suggestOrder(prod({ par: 0 }), 0, 0)).toMatchObject({ orderQty: 0, over: 0, belowPar: false });
    expect(suggestOrder(prod({ par: 0 }), 2, 0)).toMatchObject({ orderQty: 0, over: 2 });
  });
  it("is not thrown by float noise", () => {
    expect(suggestOrder(prod({ par: 1 }), 0.1, 0.2)).toMatchObject({ counted: 0.3, need: 0.7 });
  });
  it("a pack multiple below 1 or not a number behaves as 1", () => {
    expect(suggestOrder(prod({ par: 5, pack_multiple: 0 }), 3, 0).orderQty).toBe(2);
    expect(suggestOrder(prod({ par: 5, pack_multiple: Number.NaN }), 3, 0).orderQty).toBe(2);
  });
});

describe("roundUpToMultiple", () => {
  it("rounds up, keeps multiples and zero", () => {
    expect(roundUpToMultiple(3, 6)).toBe(6);
    expect(roundUpToMultiple(6, 6)).toBe(6);
    expect(roundUpToMultiple(7, 6)).toBe(12);
    expect(roundUpToMultiple(0, 6)).toBe(0);
    expect(roundUpToMultiple(-2, 6)).toBe(0);
    expect(roundUpToMultiple(5, 1)).toBe(5);
  });
});

describe("buildSupplierOrders", () => {
  const star = supplier({ id: "s1", name: "Star", sort: 2 });
  const lion = supplier({ id: "s2", name: "Lion", sort: 1 });
  const products = [
    prod({ id: "a", name: "Jim Beam", supplier_id: "s1", sort: 1, par: 18, pack_multiple: 6 }),
    prod({ id: "b", name: "Keg A", supplier_id: "s2", category_id: "c0", sort: 1, par: 4, unit_name: "keg" }),
    prod({ id: "c", name: "Over", supplier_id: "s1", sort: 2, par: 2 }),
    prod({ id: "d", name: "Not Counted", supplier_id: "s1", sort: 3, par: 2 }),
    prod({ id: "e", name: "No Supplier", supplier_id: null, sort: 4, par: 3 }),
    prod({ id: "f", name: "Retired", supplier_id: "s1", sort: 5, par: 3, active: false }),
    prod({ id: "g", name: "Second Spirit", supplier_id: "s1", sort: 6, par: 12, pack_multiple: 12 }),
  ];
  const lines = [
    { product_id: "a", store_qty: 15, second_qty: 0 },
    { product_id: "b", store_qty: 1, second_qty: 1 },
    { product_id: "c", store_qty: 5, second_qty: 0 },
    { product_id: "e", store_qty: 0, second_qty: null },
    { product_id: "f", store_qty: 0, second_qty: 0 },
    { product_id: "g", store_qty: 11, second_qty: 0 },
  ];
  const groups = buildSupplierOrders(products, lines, { suppliers: [star, lion], categories: [cat("c0", 0), cat("c1", 1)] });

  it("groups by supplier by sort, Unassigned last", () => {
    expect(groups.map((g) => g.supplierName)).toEqual(["Lion", "Star", UNASSIGNED]);
    expect(groups[2].supplierId).toBeNull();
    expect(groups[2].supplier).toBeNull();
  });
  it("keeps product sort order and rounds to the pack multiple", () => {
    const starGroup = groups[1];
    expect(starGroup.lines.map((l) => [l.product.name, l.suggestion.orderQty])).toEqual([["Jim Beam", 6], ["Second Spirit", 12]]);
  });
  it("skips zero lines by default but exposes them, and exposes the uncounted ones", () => {
    const starGroup = groups[1];
    expect(starGroup.zeroLines.map((l) => l.product.name)).toEqual(["Over"]);
    expect(starGroup.zeroLines[0].suggestion.over).toBe(3);
    expect(starGroup.uncountedLines.map((l) => l.product.name)).toEqual(["Not Counted"]);
  });
  it("leaves out inactive products unless asked", () => {
    const names = (gs: typeof groups) => gs.flatMap((g) => [...g.lines, ...g.zeroLines, ...g.uncountedLines]).map((l) => l.product.name);
    expect(names(groups)).not.toContain("Retired");
    expect(names(buildSupplierOrders(products, lines, { suppliers: [star, lion], includeInactive: true }))).toContain("Retired");
  });
  it("a product with a zero count and a par is ordered in full", () => {
    expect(groups[2].lines.map((l) => [l.product.name, l.suggestion.orderQty])).toEqual([["No Supplier", 3]]);
  });
  it("names a supplier that is not in the list rather than hiding its products", () => {
    const g = buildSupplierOrders([prod({ supplier_id: "gone" })], [{ product_id: "p1", store_qty: 0, second_qty: 0 }]);
    expect(g[0].supplierName).toBe("Unknown supplier");
    expect(g[0].lines).toHaveLength(1);
  });
  it("sorts into shelf order by category when categories are given", () => {
    const keg = groups[0].lines[0];
    expect(keg.product.name).toBe("Keg A");
    expect(sortProducts(products, [cat("c1", 1), cat("c0", 0)])[0].category_id).toBe("c0");
  });
  it("makes no groups for an empty venue", () => {
    expect(buildSupplierOrders([], [])).toEqual([]);
  });
});

describe("groupProductsByCategory", () => {
  it("returns categories in shelf order with their active products, leaving empty ones out", () => {
    const g = groupProductsByCategory(
      [prod({ id: "1", category_id: "c2", sort: 2, name: "B" }), prod({ id: "2", category_id: "c2", sort: 1, name: "A" }), prod({ id: "3", category_id: "c1", sort: 1, name: "C", active: false })],
      [cat("c2", 2), cat("c1", 1), cat("c3", 3)],
    );
    expect(g.map((x) => x.category.id)).toEqual(["c2"]);
    expect(g[0].products.map((p) => p.name)).toEqual(["A", "B"]);
  });
});

describe("order lines to save", () => {
  const p = prod({ id: "a", supplier_item_code: "170240", pack_multiple: 6, price_inc_gst: 29.5, unit_name: "bottle" });
  it("snapshots the product and skips zero lines", () => {
    const sug: ReturnType<typeof buildSupplierOrders>[number]["lines"] = [{ product: p, storeQty: 15, secondQty: 0, suggestion: suggestOrder(p, 15, 0) }];
    const drafts = draftLinesFromSuggestions(sug);
    expect(drafts).toEqual([{ product_id: "a", product_name: "Jim Beam", supplier_item_code: "170240", unit_name: "bottle", suggested_qty: 6, ordered_qty: 6, pack_multiple: 6, price_inc_gst: 29.5, sort: 0 }]);
    expect(draftLinesFromSuggestions(sug, { a: 0 })).toEqual([]);
    expect(draftLinesFromSuggestions(sug, { a: 12 })[0]).toMatchObject({ ordered_qty: 12, suggested_qty: 6 });
  });
  it("a top-up line has no suggestion", () => {
    expect(draftLineForProduct(p, 5, 2)).toMatchObject({ suggested_qty: null, ordered_qty: 5, sort: 2 });
  });
});

describe("prices", () => {
  it("ex GST is inc divided by 1.1 to the cent", () => {
    expect(exGst(29.5)).toBe(26.82);
    expect(exGst(55)).toBe(50);
    expect(exGst(0)).toBe(0);
    expect(exGst(110, 0.1)).toBe(100);
  });
  it("line totals", () => {
    expect(lineTotals(36, 29.5)).toEqual({ inc: 1062, ex: 965.45 });
    expect(lineTotals(3, 19.99)).toEqual({ inc: 59.97, ex: 54.52 });
    expect(lineTotals(2, null)).toBeNull();
  });
  it("order totals: inc is the sum, ex agrees with it, unpriced lines are counted not valued", () => {
    const t = orderTotals([
      { ordered_qty: 36, price_inc_gst: 29.5 },
      { ordered_qty: 6, price_inc_gst: 45 },
      { ordered_qty: 2, price_inc_gst: null },
      { ordered_qty: 0, price_inc_gst: 100 },
    ]);
    expect(t).toEqual({ inc: 1332, ex: 1210.91, pricedLines: 2, unpricedLines: 1, units: 44 });
  });
  it("an empty order totals zero", () => {
    expect(orderTotals([])).toEqual({ inc: 0, ex: 0, pricedLines: 0, unpricedLines: 0, units: 0 });
  });
});

describe("minimumWarning", () => {
  const totals = (inc: number, units: number, unpricedLines = 0) => ({ inc, ex: exGst(inc), units, unpricedLines });
  it("says how far short in dollars (ex GST by default)", () => {
    expect(minimumWarning({ totals: totals(0, 5) }, supplier({ min_order_value: 650 }))).toBe("Order is $650.00 short of the $650.00 minimum");
    expect(minimumWarning({ totals: { inc: 572, ex: 520, units: 8, unpricedLines: 0 } }, supplier({ min_order_value: 650 }))).toBe("Order is $130.00 short of the $650.00 minimum");
  });
  it("can compare inc GST instead", () => {
    expect(minimumWarning({ totals: { inc: 572, ex: 520, units: 8, unpricedLines: 0 }, basis: "inc" }, supplier({ min_order_value: 650 }))).toBe("Order is $78.00 short of the $650.00 minimum");
  });
  it("says how far short in units, with the unit named", () => {
    expect(minimumWarning({ totals: totals(0, 6), unitName: "carton" }, supplier({ min_order_units: 10 }))).toBe("Order is 4 cartons short of the 10 carton minimum");
    expect(minimumWarning({ totals: totals(0, 3), unitName: "keg" }, supplier({ min_order_units: 4 }))).toBe("Order is 1 keg short of the 4 keg minimum");
    expect(minimumWarning({ totals: totals(0, 1), unitName: "ctn" }, supplier({ min_order_units: 10 }))).toBe("Order is 9 cartons short of the 10 carton minimum");
    expect(minimumWarning({ totals: totals(0, 1) }, supplier({ min_order_units: 3 }))).toBe("Order is 2 units short of the 3 unit minimum");
  });
  it("joins both when both are short", () => {
    expect(minimumWarning({ totals: { inc: 110, ex: 100, units: 6, unpricedLines: 0 }, unitName: "carton" }, supplier({ min_order_value: 650, min_order_units: 10 }))).toBe(
      "Order is $550.00 short of the $650.00 minimum and 4 cartons short of the 10 carton minimum",
    );
  });
  it("is null when the minimum is met, exactly met, or not set", () => {
    expect(minimumWarning({ totals: { inc: 800, ex: 727.27, units: 12, unpricedLines: 0 } }, supplier({ min_order_value: 650, min_order_units: 10 }))).toBeNull();
    expect(minimumWarning({ totals: { inc: 715, ex: 650, units: 10, unpricedLines: 0 } }, supplier({ min_order_value: 650, min_order_units: 10 }))).toBeNull();
    expect(minimumWarning({ totals: totals(10, 1) }, supplier())).toBeNull();
    expect(minimumWarning({ totals: totals(10, 1) }, null)).toBeNull();
  });
  it("does not check the dollar minimum while a line has no price, but still checks units", () => {
    expect(minimumWarning({ totals: totals(0, 3, 2) }, supplier({ min_order_value: 650 }))).toBeNull();
    expect(minimumWarning({ totals: totals(0, 3, 2), unitName: "carton" }, supplier({ min_order_value: 650, min_order_units: 10 }))).toBe("Order is 7 cartons short of the 10 carton minimum");
  });
  it("an empty order has nothing to warn about", () => {
    expect(minimumWarning({ totals: totals(0, 0) }, supplier({ min_order_value: 650, min_order_units: 10 }))).toBeNull();
  });
});

describe("conventions", () => {
  it("default units by category", () => {
    expect(defaultUnitForCategory("Wine")).toBe("carton");
    expect(defaultUnitForCategory("RTD")).toBe("carton");
    expect(defaultUnitForCategory("Bottled Beer")).toBe("carton");
    expect(defaultUnitForCategory("Cider")).toBe("carton");
    expect(defaultUnitForCategory("Kegs")).toBe("keg");
    expect(defaultUnitForCategory("Spirits")).toBe("bottle");
    expect(defaultUnitForCategory("Bourbon")).toBe("bottle");
    expect(defaultUnitForCategory("Post-Mix")).toBe("bag");
    expect(defaultUnitForCategory("Postmix Bag")).toBe("bag");
    expect(defaultUnitForCategory("Soft Drink")).toBe("carton");
    expect(defaultUnitForCategory("Syrups")).toBe("carton");
  });
  it("short venue names", () => {
    expect(orderingVenueName({ name: "Drift Bar", slug: "drift" })).toBe("Drift");
    expect(orderingVenueName({ name: "Greedy Gringo's", slug: "greedy" })).toBe("Greedy");
    expect(orderingVenueName({ name: "Somewhere New" })).toBe("Somewhere New");
  });
});
