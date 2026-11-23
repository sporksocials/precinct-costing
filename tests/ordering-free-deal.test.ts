import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildOrderText, freeUnits, lineTotals, orderTotals, paidUnits } from "@/lib/ordering";
import { factsFrom, liveFreeDeal, orderFacts, storedFactsOf } from "@/lib/ordering-facts";
import { draftLineFromProduct, draftsToOrderLines, linePrice, textLinesFromDraft } from "@/lib/ordering-orders-ui";
import type { OrderingProduct } from "@/lib/ordering-types";
import type { IngredientDeal } from "@/lib/types";

/**
 * Star Super Crisp keg (Troy, 15 Oct 2026): buy 9 at a time, pay for 8, the 9th is free. Since 23 Nov 2026 the deal is the
 * INGREDIENT's Buy X Get Y deal (cost_ingredient_deals), read by lib/ordering-facts.ts; the deal typed on the order item is
 * only the fallback for an old item with no ingredient.
 */
const DEAL = { buy: 8, free: 1 };
/** the old shape: no ingredient, its own price and deal */
const keg = {
  id: "p1", venue_id: 1, category_id: "c1", sort: 0, name: "Great Northern Super Crisp", unit_name: "keg", supplier_id: "s1", supplier_item_code: "160",
  pack_multiple: 9, price_inc_gst: 410, deal_buy_qty: 8, deal_free_qty: 1, ingredient_id: null, costing_packs_per_unit: null, par: 13, notes: null, active: true,
} as OrderingProduct;
/** the thin shape: the ingredient holds the price ($372.7273 ex GST is $410.00 inc) and the deal; a stale price and deal on the item must be ignored */
const KEG_ING = { id: "ing-keg", pack_price: 372.7273, price_inc_gst: false, gst_free: false, carton_qty: null };
const thinKeg = { ...keg, name: "Great Northern Super Crisp Keg (49.5L)", ingredient_id: "ing-keg", price_inc_gst: 999, deal_buy_qty: 2, deal_free_qty: 1 } as OrderingProduct;
const deal = (over: Partial<IngredientDeal> = {}): IngredientDeal => ({ id: "d1", ingredient_id: "ing-keg", kind: "buy_x_get_y", buy_qty: 8, free_qty: 1, min_qty: null, pct_off: null, unit_price: null, special_pack_price: null, starts_on: null, ends_on: null, note: null, active: true, ...over });
const TODAY = "2026-11-23";
const factsOf = factsFrom({ ingredientById: (id) => (id === "ing-keg" ? KEG_ING : null), dealsFor: () => [deal()], gstRate: 0.1, today: TODAY });

describe("free units on a deal", () => {
  it("every 9th keg is free: 9 gives 1, 18 gives 2, 8 gives none", () => {
    expect(freeUnits(9, DEAL)).toBe(1);
    expect(freeUnits(18, DEAL)).toBe(2);
    expect(freeUnits(8, DEAL)).toBe(0);
    expect(freeUnits(17, DEAL)).toBe(1);
    expect(paidUnits(9, DEAL)).toBe(8);
    expect(paidUnits(18, DEAL)).toBe(16);
  });
  it("no deal, half a deal or a zero changes nothing", () => {
    expect(freeUnits(9)).toBe(0);
    expect(freeUnits(9, { buy: 8, free: null })).toBe(0);
    expect(freeUnits(9, { buy: 0, free: 1 })).toBe(0);
    expect(paidUnits(9, null)).toBe(9);
  });
});

describe("money with a deal", () => {
  it("9 kegs at $410 is paid as 8: $3,280.00 inc GST", () => {
    expect(lineTotals(9, 410, undefined, DEAL)?.inc).toBe(3280);
    expect(lineTotals(9, 410)?.inc).toBe(3690); // without the deal
  });
  it("the order total leaves the free keg out", () => {
    const t = orderTotals([{ ordered_qty: 9, price_inc_gst: 410, deal_buy_qty: 8, deal_free_qty: 1 }, { ordered_qty: 2, price_inc_gst: 50 }]);
    expect(t.inc).toBe(3380);
    expect(t.units).toBe(11); // units ordered still counts the free one
  });
  it("the line shows the total paid and says how many are free", () => {
    expect(linePrice(9, 410, undefined, DEAL)).toEqual({ total: "$3,280.00", each: "$410.00 each, 1 free" });
    expect(linePrice(9, 410)).toEqual({ total: "$3,690.00", each: "$410.00 each" });
  });
});

describe("the order text", () => {
  it("names the paid and free kegs when prices are on", () => {
    const lines = textLinesFromDraft([{ ...draftLineFromProduct(thinKeg, factsOf, null, 9) }]);
    const t = buildOrderText({ venueName: "Drift", supplier: { rep_name: null, account_no: null }, lines, showPrices: true, senderName: "Matt" });
    expect(t.body).toContain("Great Northern Super Crisp Keg (49.5L) - 9 kegs #160 (8 paid, 1 free) @ $372.73 ex GST / $410.00 inc GST = $2,981.82 ex GST / $3,280.00 inc GST");
    expect(t.body).toContain("Total inc GST: $3,280.00");
  });
  it("says nothing extra without prices (what every order email is)", () => {
    const lines = textLinesFromDraft([{ ...draftLineFromProduct(thinKeg, factsOf, null, 9) }]);
    const t = buildOrderText({ venueName: "Drift", supplier: { rep_name: null, account_no: null }, lines, showPrices: false, senderName: "Matt" });
    expect(t.body).toContain("Great Northern Super Crisp Keg (49.5L) - 9 kegs #160");
    expect(t.body).not.toContain("free");
    expect(t.body).not.toContain("$");
  });
});

describe("saved with the order", () => {
  it("a draft line starts at the pack multiple of 9 and the order line keeps the INGREDIENT's deal and derived price as they were", () => {
    const line = draftLineFromProduct(thinKeg, factsOf);
    expect(line.qty).toBe(9);
    expect(line.packMultiple).toBe(9);
    expect(line.price).toBe(410); // from the ingredient, not the 999 left on the item
    const saved = draftsToOrderLines([line])[0];
    expect(saved).toMatchObject({ deal_buy_qty: 8, deal_free_qty: 1, price_inc_gst: 410, product_name: "Great Northern Super Crisp Keg (49.5L)", supplier_item_code: "160" });
  });
  it("an old item with no ingredient still uses the deal typed on it", () => {
    const saved = draftsToOrderLines([draftLineFromProduct(keg, storedFactsOf)])[0];
    expect(saved).toMatchObject({ deal_buy_qty: 8, deal_free_qty: 1, price_inc_gst: 410 });
  });
});

describe("the deal comes from the ingredient", () => {
  it("is the ingredient's live Buy X Get Y deal", () => {
    expect(liveFreeDeal([deal()], TODAY)).toEqual({ buy: 8, free: 1 });
    expect(orderFacts(thinKeg, KEG_ING, { deals: [deal()], today: TODAY }).deal).toEqual({ buy: 8, free: 1 });
  });
  it("a deal that is switched off, not started or finished gives no free units", () => {
    expect(liveFreeDeal([deal({ active: false })], TODAY)).toBeNull();
    expect(liveFreeDeal([deal({ starts_on: "2026-12-01" })], TODAY)).toBeNull();
    expect(liveFreeDeal([deal({ ends_on: "2026-11-01" })], TODAY)).toBeNull();
    expect(orderFacts(thinKeg, KEG_ING, { deals: [], today: TODAY }).deal).toBeNull(); // never the 2 + 1 left on the item
  });
  it("other kinds of deal change costing, not what is paid for on an order line", () => {
    expect(liveFreeDeal([deal({ kind: "percent_off", pct_off: 0.1, buy_qty: null, free_qty: null }), deal({ kind: "special_price", special_pack_price: 300 })], TODAY)).toBeNull();
  });
  it("of several, the one that gives the most away", () => {
    expect(liveFreeDeal([deal({ buy_qty: 10, free_qty: 1 }), deal({ id: "d2", buy_qty: 5, free_qty: 1 })], TODAY)).toEqual({ buy: 5, free: 1 });
  });
  it("the list price is not discounted: the deal only leaves the free units out", () => {
    const f = orderFacts(thinKeg, KEG_ING, { deals: [deal()], today: TODAY });
    expect(f.unitInc).toBe(410);
    expect(lineTotals(9, f.unitInc, 0.1, f.deal)?.inc).toBe(3280);
  });
});

describe("where the deal lives", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("is no longer typed on the product page (it is a deal on the ingredient), and the columns stay in the schema", () => {
    expect(read("app/(app)/ordering/[venue]/setup/products/[id]/page.tsx")).not.toMatch(/Free Unit Deal|deal_buy_qty|deal_free_qty/);
    expect(read("components/ingredient-ordering.tsx")).not.toMatch(/deal_buy_qty|deal_free_qty/);
    expect(read("supabase/schema.sql")).toContain("ordering_products_deal_chk");
    expect(read("supabase/migrations/20261015100000_ordering_free_unit_deal.sql")).toContain("ordering_order_lines_deal_chk");
  });
});
