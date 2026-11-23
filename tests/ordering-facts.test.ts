import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lineTotals, orderTotals } from "@/lib/ordering";
import {
  NO_CARTON_QTY,
  NO_INGREDIENT_PRICE,
  NO_STORED_PRICE,
  factsDeal,
  factsFrom,
  isCartonUnit,
  lineGstFree,
  orderFacts,
  orderPriceSentence,
  orderPriceShort,
  storedFactsOf,
  type FactsIngredient,
  type FactsProduct,
} from "@/lib/ordering-facts";

/**
 * ONE CARD PER PRODUCT (Troy, 23 Nov 2026). The order item is a thin shell; its price, GST, carton size and free-unit deal
 * are worked out from the ingredient in ONE pure function, lib/ordering-facts.ts `orderFacts`. These are the rules it keeps.
 */

const ing = (over: Partial<FactsIngredient> = {}): FactsIngredient => ({ id: "ing", pack_price: 17.5, price_inc_gst: false, gst_free: false, carton_qty: 6, ...over });
const item = (over: Partial<FactsProduct> = {}): FactsProduct => ({ name: "Bombay Sapphire London Dry Gin (700ml)", unit_name: "bottle", supplier_item_code: "150012", price_inc_gst: null, ingredient_id: "ing", ...over });
const G = { gstRate: 0.1 };

describe("the price of one counted unit", () => {
  it("counted by anything but the carton, one unit is ONE of the ingredient's packs", () => {
    for (const unit of ["bottle", "keg", "bag", "tub", "each"]) {
      const f = orderFacts(item({ unit_name: unit }), ing(), G);
      expect(f, unit).toMatchObject({ packsPerUnit: 1, unitEx: 17.5, unitInc: 19.25, packEx: 17.5, noPrice: null, linked: true, needsIngredient: false });
    }
  });
  it("counted by the carton, one unit is the ingredient's carton_qty packs", () => {
    const f = orderFacts(item({ unit_name: "carton" }), ing(), G);
    expect(f).toMatchObject({ packsPerUnit: 6, unitEx: 105, unitInc: 115.5, packEx: 17.5 });
    expect(orderFacts(item({ unit_name: "Cartons" }), ing({ carton_qty: 12 }), G).unitEx).toBe(210);
    expect(isCartonUnit("ctn")).toBe(true);
    expect(isCartonUnit("bottle")).toBe(false);
  });
  it("carton_qty 1 means the pack IS the carton (a 24 pack of cans)", () => {
    expect(orderFacts(item({ unit_name: "carton" }), ing({ pack_price: 56.3636, carton_qty: 1 }), G)).toMatchObject({ packsPerUnit: 1, unitInc: 62 });
  });
  it("a carton with no carton_qty has NO PRICE, never the price of one pack", () => {
    for (const carton_qty of [null, undefined, 0]) {
      const f = orderFacts(item({ unit_name: "carton" }), ing({ carton_qty }), G);
      expect(f.unitEx).toBeNull();
      expect(f.unitInc).toBeNull();
      expect(f.packsPerUnit).toBeNull();
      expect(f.noPrice).toBe(NO_CARTON_QTY);
      expect(f.packEx).toBe(17.5); // the bottle's price is still known, it just is not the carton's
    }
  });
  it("a pack price of 0 means no price", () => {
    const f = orderFacts(item(), ing({ pack_price: 0 }), G);
    expect(f).toMatchObject({ unitEx: null, unitInc: null, packEx: null, noPrice: NO_INGREDIENT_PRICE });
    expect(orderFacts(item({ unit_name: "carton" }), ing({ pack_price: 0, carton_qty: null }), G).noPrice).toBe(NO_INGREDIENT_PRICE);
  });
  it("GST free: inc is the same as ex", () => {
    expect(orderFacts(item({ unit_name: "carton" }), ing({ gst_free: true }), G)).toMatchObject({ unitEx: 105, unitInc: 105, gstFree: true });
  });
  it("prices are stored ex GST; a row still flagged inc GST is divided first, and a GST free one never is", () => {
    expect(orderFacts(item(), ing({ pack_price: 19.25, price_inc_gst: true }), G)).toMatchObject({ unitEx: 17.5, unitInc: 19.25 });
    expect(orderFacts(item(), ing({ pack_price: 19.25, price_inc_gst: true, gst_free: true }), G)).toMatchObject({ unitEx: 19.25, unitInc: 19.25 });
  });
  it("uses the costing GST rate it is given (10% when none is)", () => {
    expect(orderFacts(item(), ing({ pack_price: 100 }), { gstRate: 0.15 }).unitInc).toBe(115);
    expect(orderFacts(item(), ing({ pack_price: 100 })).unitInc).toBe(110);
  });
  it("a 4 place ex GST price comes back to the cent it was typed at", () => {
    // $62.00 inc was stored as 56.3636 ex; $96.00 a carton of 6 as 14.5455 a bottle
    expect(orderFacts(item(), ing({ pack_price: 56.3636 }), G).unitInc).toBe(62);
    expect(orderFacts(item({ unit_name: "carton" }), ing({ pack_price: 14.5455, carton_qty: 6 }), G).unitInc).toBe(96);
  });
  it("NEVER reads the price, carton size or deal typed on the order item when it has an ingredient", () => {
    const stale = item({ price_inc_gst: 23.5, deal_buy_qty: 2, deal_free_qty: 1 });
    const f = orderFacts(stale, ing({ pack_price: 24.3182 }), G); // the ingredient says $26.75 inc
    expect(f.unitInc).toBe(26.75);
    expect(f.deal).toBeNull();
  });
});

describe("the name and the item code", () => {
  it("are the order item row's own: the database keeps them equal to the ingredient's full name and Supplier Code", () => {
    const f = orderFacts(item({ supplier_item_code: " 150012 " }), ing(), G);
    expect(f.name).toBe("Bombay Sapphire London Dry Gin (700ml)");
    expect(f.code).toBe("150012");
    expect(orderFacts(item({ supplier_item_code: "  " }), ing(), G).code).toBeNull();
  });
});

describe("the fallback: an order item with no ingredient", () => {
  const old = item({ name: "Paper Straws", unit_name: "carton", supplier_item_code: "STRAW1", price_inc_gst: 12, ingredient_id: null });
  it("shows its stored name, code and price exactly as before, and is flagged", () => {
    const f = orderFacts(old, null, G);
    expect(f).toMatchObject({ linked: false, needsIngredient: true, ingredientId: null, name: "Paper Straws", code: "STRAW1", unit: "carton", unitInc: 12, unitEx: 10.91, gstFree: false, packsPerUnit: null, noPrice: null });
  });
  it("keeps the free-unit deal typed on it", () => {
    expect(factsDeal(orderFacts({ ...old, deal_buy_qty: 8, deal_free_qty: 1 }, null, G))).toEqual({ buy: 8, free: 1 });
    expect(orderFacts({ ...old, deal_buy_qty: 8, deal_free_qty: null }, null, G).deal).toBeNull();
  });
  it("with no stored price it simply has none", () => {
    expect(orderFacts({ ...old, price_inc_gst: null }, null, G)).toMatchObject({ unitInc: null, unitEx: null, noPrice: NO_STORED_PRICE });
    expect(orderFacts({ ...old, price_inc_gst: 0 }, null, G).unitInc).toBeNull();
  });
  it("an ingredient that is missing from the loaded list is the fallback too: it never throws", () => {
    const orphan = item({ ingredient_id: "gone", price_inc_gst: 40 });
    const factsOf = factsFrom({ ingredientById: () => undefined, gstRate: 0.1 });
    expect(factsOf(orphan)).toMatchObject({ linked: false, needsIngredient: true, unitInc: 40 });
    expect(orderFacts(orphan, undefined, G).needsIngredient).toBe(true);
    expect(storedFactsOf(item({ price_inc_gst: 40 }))).toMatchObject({ linked: false, unitInc: 40 });
    // and an ingredient handed in for an item that points at none is not used either
    expect(orderFacts(item({ ingredient_id: null, price_inc_gst: 9 }), ing(), G)).toMatchObject({ linked: false, unitInc: 9 });
  });
});

describe("factsFrom: one function per screen, built from the loaded costing data", () => {
  it("looks the ingredient and its deals up by id", () => {
    const factsOf = factsFrom({
      ingredientById: (id) => (id === "ing" ? ing() : null),
      dealsFor: (id) => (id === "ing" ? [{ id: "d", ingredient_id: "ing", kind: "buy_x_get_y", buy_qty: 5, free_qty: 1, min_qty: null, pct_off: null, unit_price: null, special_pack_price: null, starts_on: null, ends_on: null, note: null, active: true }] : []),
      gstRate: 0.1,
      today: "2026-11-23",
    });
    expect(factsOf(item({ unit_name: "carton" }))).toMatchObject({ unitInc: 115.5, deal: { buy: 5, free: 1 }, ingredientId: "ing" });
  });
});

describe("totals add ex and inc line by line, so GST free lines are right", () => {
  it("a GST free line adds the same to both", () => {
    expect(lineTotals(2, 20, 0.1, null, true)).toEqual({ inc: 40, ex: 40 });
    expect(lineTotals(2, 22, 0.1, null, false)).toEqual({ inc: 44, ex: 40 });
    const t = orderTotals([
      { ordered_qty: 2, price_inc_gst: 20, gst_free: true },
      { ordered_qty: 1, price_inc_gst: 110 },
    ]);
    expect(t).toMatchObject({ inc: 150, ex: 140 });
  });
  it("an order of ordinary lines still reads ex = inc / 1.1", () => {
    const t = orderTotals([
      { ordered_qty: 36, price_inc_gst: 29.5 },
      { ordered_qty: 6, price_inc_gst: 45 },
    ]);
    expect(t).toMatchObject({ inc: 1332, ex: 1210.91 });
  });
  it("a saved order line keeps only its inc GST price: GST free is read from its ingredient as it is now", () => {
    const products = [{ id: "p1", ingredient_id: "water" }, { id: "p2", ingredient_id: "gin" }, { id: "p3", ingredient_id: null }];
    const byId = (id: string) => ({ water: { gst_free: true }, gin: { gst_free: false } })[id];
    expect(lineGstFree("p1", products, byId)).toBe(true);
    expect(lineGstFree("p2", products, byId)).toBe(false);
    expect(lineGstFree("p3", products, byId)).toBe(false);
    expect(lineGstFree("nope", products, byId)).toBe(false);
    expect(lineGstFree(null, products, byId)).toBe(false); // a typed line
  });
});

describe("the order price in plain words", () => {
  it("by the carton, with what one pack costs", () => {
    expect(orderPriceSentence(orderFacts(item({ unit_name: "carton" }), ing(), G), "bottle")).toBe("Ordered by the carton: $115.50 inc GST ($17.50 a bottle ex GST)");
    expect(orderPriceSentence(orderFacts(item({ unit_name: "carton" }), ing({ gst_free: true }), G), "bottle")).toBe("Ordered by the carton: $105.00, GST free ($17.50 a bottle)");
  });
  it("by the pack itself, with the ex GST price beside it", () => {
    expect(orderPriceSentence(orderFacts(item(), ing(), G), "bottle")).toBe("Ordered by the bottle: $19.25 inc GST ($17.50 ex GST)");
    expect(orderPriceSentence(orderFacts(item(), ing({ gst_free: true }), G), "bottle")).toBe("Ordered by the bottle: $17.50, GST free");
    expect(orderPriceSentence(orderFacts(item({ unit_name: "carton" }), ing({ pack_price: 56.3636, carton_qty: 1 }), G))).toBe("Ordered by the carton: $62.00 inc GST ($56.36 ex GST)");
  });
  it("says why there is no price", () => {
    expect(orderPriceSentence(orderFacts(item({ unit_name: "carton" }), ing({ carton_qty: null }), G))).toBe("No price: say how many a carton holds");
    expect(orderPriceSentence(orderFacts(item(), ing({ pack_price: 0 }), G))).toBe("No price: the ingredient has no price yet");
  });
  it("names a free-unit deal, and has no dashes", () => {
    const f = orderFacts(item({ unit_name: "keg" }), ing({ pack_price: 372.7273 }), { ...G, deals: [{ id: "d", ingredient_id: "ing", kind: "buy_x_get_y", buy_qty: 8, free_qty: 1, min_qty: null, pct_off: null, unit_price: null, special_pack_price: null, starts_on: null, ends_on: null, note: null, active: true }], today: "2026-11-23" });
    const s = orderPriceSentence(f, "keg");
    expect(s).toBe("Ordered by the keg: $410.00 inc GST ($372.73 ex GST). Buy 8, get 1 free");
    expect(s).not.toMatch(/[–—]/);
    expect(orderPriceShort(f)).toBe("$410.00");
    expect(orderPriceShort({ unitInc: null })).toBe("");
  });
});

/* ------------------------------------------------------------------ source guards */

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("one place works a price out", () => {
  const SCREENS = [...walk("components/ordering"), ...walk(path.join("app", "(app)", "ordering")), "components/ingredient-ordering.tsx"];
  it("no ordering screen reads a price, deal or carton size stored on an order item: they all go through the facts", () => {
    const bad: string[] = [];
    for (const f of SCREENS) {
      const src = strip(readFileSync(f, "utf8"));
      // a saved ORDER LINE's price_inc_gst (l.price_inc_gst) is the snapshot and is fine; a PRODUCT's is not
      for (const m of src.matchAll(/\b(?:product|p|c\.product|s\.product|l\.product)\.(price_inc_gst|costing_packs_per_unit|deal_buy_qty|deal_free_qty|alt_\w+)\b/g)) bad.push(`${f}: ${m[0]}`);
      if (/show_prices_on_order/.test(src)) bad.push(`${f}: show_prices_on_order`);
    }
    // the ingredient page and its Counted By sheet hand the stored price to orderFacts as the fallback input, nothing else
    expect(bad.filter((b) => !/ingredient-ordering\.tsx: (p|product)\.price_inc_gst/.test(b))).toEqual([]);
  });
  it("the order screens, the Products list and the ingredient page all use lib/ordering-facts.ts", () => {
    expect(readFileSync("components/ordering/use-order-facts.ts", "utf8")).toContain("factsFrom(");
    for (const f of ["components/ordering/orders/orders-screen.tsx", path.join("app", "(app)", "ordering", "[venue]", "setup", "products", "page.tsx"), path.join("app", "(app)", "ordering", "[venue]", "setup", "products", "[id]", "page.tsx")]) {
      expect(readFileSync(f, "utf8"), f).toContain("useOrderFacts()");
    }
    expect(readFileSync("components/ingredient-ordering.tsx", "utf8")).toContain("orderFacts(");
    expect(readFileSync("lib/ordering-orders-ui.ts", "utf8")).toContain("factsOf(product)");
  });
  it("the facts are pure: no React, no database, no store", () => {
    const imports = readFileSync("lib/ordering-facts.ts", "utf8").split("\n").filter((l) => l.startsWith("import"));
    expect(imports.join("\n")).not.toMatch(/react|supabase|store|ordering-data/);
  });
  it("the count screen is untouched by all of this: it reads plain product rows and never the ingredients", () => {
    for (const f of walk("components/ordering/count")) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/ordering-facts|useOrderFacts|store\.ingredients|carton_qty/);
    }
    // the device copy and the queue keep their names, so a phone that is half way through a count carries on
    expect(readFileSync("lib/ordering-data.ts", "utf8")).toContain("`precinct-ordering-queue-v1:${venueId}`");
    const device = readFileSync("lib/ordering-count-device.ts", "utf8");
    expect(device).toContain('"precinct-ordering"');
  });
});
