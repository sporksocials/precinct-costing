import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildOrderText, freeUnits, lineTotals, orderTotals, paidUnits } from "@/lib/ordering";
import { draftLineFromProduct, draftsToOrderLines, linePrice, textLinesFromDraft } from "@/lib/ordering-orders-ui";
import type { OrderingProduct } from "@/lib/ordering-types";

/** Star Super Crisp keg (Troy, 15 Oct 2026): buy 9 at a time, pay for 8, the 9th is free. */
const DEAL = { buy: 8, free: 1 };
const keg = {
  id: "p1", venue_id: 1, category_id: "c1", sort: 0, name: "Great Northern Super Crisp", unit_name: "keg", supplier_id: "s1", supplier_item_code: "160",
  pack_multiple: 9, price_inc_gst: 410, deal_buy_qty: 8, deal_free_qty: 1, ingredient_id: null, costing_packs_per_unit: null, par: 13, notes: null, active: true,
} as OrderingProduct;

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
    const lines = textLinesFromDraft([{ ...draftLineFromProduct(keg, null, 9) }]);
    const t = buildOrderText({ venueName: "Drift", supplier: { rep_name: null, account_no: null }, lines, showPrices: true, senderName: "Matt" });
    expect(t.body).toContain("Great Northern Super Crisp - 9 kegs (item 160) (8 paid, 1 free) @ $372.73 ex GST / $410.00 inc GST = $2,981.82 ex GST / $3,280.00 inc GST");
    expect(t.body).toContain("Total inc GST: $3,280.00");
  });
  it("says nothing extra without prices", () => {
    const lines = textLinesFromDraft([{ ...draftLineFromProduct(keg, null, 9) }]);
    const t = buildOrderText({ venueName: "Drift", supplier: { rep_name: null, account_no: null }, lines, showPrices: false, senderName: "Matt" });
    expect(t.body).toContain("Great Northern Super Crisp - 9 kegs");
    expect(t.body).not.toContain("free");
  });
});

describe("saved with the order", () => {
  it("a draft line starts at the pack multiple of 9 and the order line keeps the deal as it was", () => {
    const line = draftLineFromProduct(keg);
    expect(line.qty).toBe(9);
    expect(line.packMultiple).toBe(9);
    const saved = draftsToOrderLines([line])[0];
    expect(saved.deal_buy_qty).toBe(8);
    expect(saved.deal_free_qty).toBe(1);
  });
});

describe("where the deal lives", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("is set on the product page and mirrored in the schema", () => {
    expect(read("app/(app)/ordering/[venue]/setup/products/[id]/page.tsx")).toContain("Free Unit Deal: Buy");
    expect(read("supabase/schema.sql")).toContain("ordering_products_deal_chk");
    expect(read("supabase/migrations/20261015100000_ordering_free_unit_deal.sql")).toContain("ordering_order_lines_deal_chk");
  });
});
