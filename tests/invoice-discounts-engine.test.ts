// Standing supplier line discounts: a negative line that shares a product's code is a discount on that product (not a goods credit),
// netted off its landed cost, never in the fee pool, never a "how many kilos" question. Plus the "not a stock item" rejection.
import { describe, expect, it } from "vitest";
import { analyseInvoice } from "../lib/invoice-engine";
import { attachDiscounts, discountKey, isGoodsReturn } from "../lib/invoice-landed";
import { buildMatcher } from "../lib/invoice-match";
import { descKey } from "../lib/invoice-names";
import type { AnalysedLine, ExtractedInvoice } from "../lib/invoice-types";
import { SUP_DS, baseCtx, danielStreet51329, danielStreet51329Fixed, ING_KINGFISH, line, mapRow, supplierDS } from "./fixtures/invoice-fixtures";

const byNo = (lines: AnalysedLine[], no: number) => lines.find((l) => l.line_no === no) as AnalysedLine;
const kinds = (a: { questions: { kind: string }[] }) => a.questions.map((q) => q.kind);
const cents = (n: number) => Math.round(n * 100);

/** Daniel Street #9764204 (17 Oct), as far as it is known: 4.57 kg barramundi at $41.50, the -$31.52 line, and an order-level ODISCOUNT. */
function danielStreet9764204(): ExtractedInvoice {
  return {
    doc_type: "invoice", supplier_name: "Daniel Street Fish Market", supplier_abn: "61151388094", invoice_number: "9764204", invoice_date: "2026-10-17", due_date: null,
    bill_to: "DRIFT BAR AND DINING", ship_to: null, pages: [2], subtotal_ex: 156.14, gst_total: 0, total_inc: 156.14, notes: [],
    lines: [
      line({ line_no: 1, page: 2, item_code: "15056", description: "Humpty Doo Barramundi fillets per kg", qty: 4.57, unit: "KG", unit_price: 41.5, line_total: 189.66, gst: "free", class_hint: "product" }),
      line({ line_no: 2, page: 2, item_code: "15056", description: "Humpty Doo Barramundi fillets per kg", line_total: -31.52, gst: "free", class_hint: "credit" }),
      line({ line_no: 3, page: 2, item_code: "ODISCOUNT", description: "ODISCOUNT", line_total: -2, gst: "free", class_hint: "discount" }),
    ],
  };
}

describe("Daniel Street #51329: the -$16.45 line is a discount on the barramundi", () => {
  const a = analyseInvoice(danielStreet51329(), baseCtx());
  const b = byNo(a.lines, 2);

  it("records the dollars, the percentage and the dollars per kilo on the product line", () => {
    expect(b.line_discount_ex).toBe(16.45);
    expect(b.discount_pct).toBeCloseTo(16.45 / 98.98, 6);
    expect(b.discount_pct).toBeCloseTo(0.1662, 4);
    expect(b.discount_per_base).toBeCloseTo(16.45 / 2.39, 4);
    expect(b.discount_per_base).toBeCloseTo(6.88, 2);
    expect(b.base_unit).toBe("kg");
  });

  it("costs the line on the NET total over the FULL quantity: 82.53 + 2.32 delivery over 2.39 kg is about $35.50 a kilo", () => {
    expect(b.fee_share_ex).toBe(2.32);
    expect(b.landed_total_ex).toBe(84.85);
    expect(b.landed_unit_ex).toBeCloseTo(35.5, 2);
    expect(b.landed_unit_ex).toBe(35.5021);
    expect(b.landed_base_ex).toBe(35.5021);
  });

  it("keeps the discount line as a discount, ignored, with no question and no share", () => {
    const d = byNo(a.lines, 3);
    expect(d).toMatchObject({ line_class: "discount", match_state: "ignored", decision: "none", fee_share_ex: 0, line_total_ex: -16.45 });
    expect(d.decision_reason).toBe("Taken off the price of Humpty Doo Barramundi fillets.");
    expect(d.line_discount_ex).toBeUndefined();
    expect(kinds(a)).not.toContain("credit_unclear");
    expect(kinds(a)).not.toContain("other");
  });

  it("never lets the discount into the fee pool: the pool is the delivery alone and the shares add up to it to the cent", () => {
    expect(a.fee_pool_ex).toBe(5.91);
    const shares = a.lines.filter((l) => l.line_class === "product").map((l) => l.fee_share_ex);
    expect(cents(shares.reduce((s, x) => s + x, 0))).toBe(591);
    // weights follow the NET value: 127.47 and 82.53
    expect(byNo(a.lines, 1).fee_share_ex).toBe(3.59);
  });

  it("leaves the plain products without discount columns", () => {
    const k = byNo(a.lines, 1);
    expect(k.line_discount_ex).toBeUndefined();
    expect(k.discount_pct).toBeUndefined();
    expect(k.discount_per_base).toBeUndefined();
  });

  it("still compares the supplier's printed unit price (the list price) with the app, not the net", () => {
    expect(b).toMatchObject({ old_pack_price: 40, new_pack_price: 41.54, old_product_price: 45, new_product_price: 41.54 });
  });

  it("does not change the reconciliation: the lines still add up exactly as before", () => {
    const fixed = analyseInvoice(danielStreet51329Fixed(), baseCtx());
    expect(fixed.reconciled).toBe(true);
    expect(fixed.recon_notes.filter((n) => !n.ok)).toEqual([]);
    const fixedBarra = byNo(fixed.lines, 2);
    expect(fixedBarra.discount_pct).toBeCloseTo(16.45 / 99.28, 6);
    expect(fixedBarra.decision_reason).not.toMatch(/credit/i);
  });
});

describe("Daniel Street #9764204: -$31.52 on 4.57 kg", () => {
  const a = analyseInvoice(danielStreet9764204(), baseCtx());
  const b = byNo(a.lines, 1);

  it("is the same standing discount: 16.62% and about $6.90 a kilo", () => {
    expect(b.line_discount_ex).toBe(31.52);
    expect(b.discount_pct).toBeCloseTo(31.52 / 189.66, 6);
    expect(b.discount_pct).toBeCloseTo(0.1662, 3);
    expect(b.discount_per_base).toBeCloseTo(31.52 / 4.57, 4);
    expect(a.reconciled).toBe(true);
  });

  it("an order-level ODISCOUNT is still a pool discount and lands on the product", () => {
    expect(byNo(a.lines, 3)).toMatchObject({ line_class: "discount", match_state: "ignored" });
    expect(byNo(a.lines, 3).decision_reason).toBeNull();
    expect(a.fee_pool_ex).toBe(-2);
    expect(b.fee_share_ex).toBe(-2);
    // 189.66 - 31.52 - 2.00
    expect(b.landed_total_ex).toBe(156.14);
    expect(b.landed_unit_ex).toBeCloseTo(156.14 / 4.57, 4);
  });
});

describe("what counts as a discount", () => {
  it("an inc GST discount on an inc GST product converts both the same way", () => {
    const d = danielStreet51329Fixed();
    d.lines[1] = { ...d.lines[1], basis: "inc", gst: "taxable", unit_price: 45.694, line_total: 109.208 };
    d.lines[2] = { ...d.lines[2], basis: "inc", gst: "taxable", line_total: -18.095 };
    const b = byNo(analyseInvoice(d, baseCtx()).lines, 2);
    // 109.208 / 1.1 = 99.28 and 18.095 / 1.1 = 16.45
    expect(b.line_discount_ex).toBe(16.45);
    expect(b.discount_pct).toBeCloseTo(16.45 / 99.28, 5);
  });

  it("matches on the description when the discount line has no code", () => {
    const d = danielStreet51329Fixed();
    d.lines[2] = { ...d.lines[2], item_code: null, description: "Discount Humpty Doo Barramundi fillets per kg" };
    const a = analyseInvoice(d, baseCtx());
    expect(byNo(a.lines, 2).line_discount_ex).toBe(16.45);
    expect(byNo(a.lines, 3).line_class).toBe("discount");
    expect(kinds(a)).not.toContain("credit_unclear");
  });

  it("two discount lines on one product add up", () => {
    const d = danielStreet51329Fixed();
    d.lines.splice(3, 0, { ...d.lines[2], line_no: 9, line_total: -2 });
    d.subtotal_ex = 214.21;
    d.total_inc = 214.8;
    const b = byNo(analyseInvoice(d, baseCtx()).lines, 2);
    expect(b.line_discount_ex).toBe(18.45);
    expect(b.discount_pct).toBeCloseTo(18.45 / 99.28, 5);
  });

  it("with the base quantity unknown there is a percentage and no dollars per unit", () => {
    const d = danielStreet51329Fixed();
    // an ingredient code nobody has: the line is unmatched, so its base quantity is unknown
    d.lines[1] = { ...d.lines[1], item_code: "77777" };
    d.lines[2] = { ...d.lines[2], item_code: "77777" };
    const b = byNo(analyseInvoice(d, baseCtx({ products: [] })).lines, 2);
    expect(b.match_state).toBe("unmatched");
    expect(b.line_discount_ex).toBe(16.45);
    expect(b.discount_pct).toBeCloseTo(16.45 / 99.28, 5);
    expect(b.discount_per_base).toBeUndefined();
  });

  it("a negative line that matches no product stays a goods credit and is asked about", () => {
    const d = danielStreet51329Fixed();
    d.lines[2] = { ...d.lines[2], item_code: "ZZZ", description: "Allowance" };
    const a = analyseInvoice(d, baseCtx());
    expect(byNo(a.lines, 3).line_class).toBe("credit");
    expect(kinds(a)).toContain("credit_unclear");
    expect(byNo(a.lines, 2).line_discount_ex).toBeUndefined();
  });

  it("returned goods (a quantity and the product's own price) stay a goods credit for that quantity", () => {
    const d = danielStreet51329Fixed();
    d.lines[2] = { ...d.lines[2], qty: -0.396, unit: "KG", unit_price: 41.54, line_total: -16.45 };
    const a = analyseInvoice(d, baseCtx());
    const b = byNo(a.lines, 2);
    expect(byNo(a.lines, 3).line_class).toBe("credit");
    expect(b.line_discount_ex).toBeUndefined();
    expect(b.decision_reason).toBe("A credit of $16.45 was issued against this line.");
    // 2.39 kg billed, 0.396 kg credited: 1.994 kg kept for (99.28 - 16.45 + delivery share)
    expect(b.base_qty).toBe(2.39);
    expect(b.landed_unit_ex).not.toBeNull();
    expect(kinds(a)).not.toContain("credit_unclear");
  });

  it("returned goods in a different unit still ask how many were credited", () => {
    const d = danielStreet51329Fixed();
    d.lines[2] = { ...d.lines[2], qty: -1, unit: "EA", unit_price: 16.45, line_total: -16.45 };
    // the price is nowhere near $41.54, so this is a discount, not a return
    expect(byNo(analyseInvoice(d, baseCtx()).lines, 2).line_discount_ex).toBe(16.45);
    d.lines[2] = { ...d.lines[2], qty: -0.396, unit: "EA", unit_price: 41.54 };
    const a = analyseInvoice(d, baseCtx());
    expect(byNo(a.lines, 2).line_discount_ex).toBeUndefined();
    expect(kinds(a)).toContain("credit_unclear");
  });

  it("a credit note keeps its negative lines as credits", () => {
    const d = danielStreet51329Fixed();
    d.doc_type = "credit_note";
    const a = analyseInvoice(d, baseCtx());
    expect(a.lines.every((l) => l.line_discount_ex === undefined)).toBe(true);
  });
});

describe("attachDiscounts and isGoodsReturn", () => {
  const products = [
    { index: 0, itemCode: "15026", description: "Kingfish fillets", unitPriceEx: 68.9 },
    { index: 1, itemCode: "15056", description: "Humpty Doo Barramundi fillets per kg", unitPriceEx: 41.54 },
  ];
  const neg = (over: Partial<Parameters<typeof attachDiscounts>[1][number]> & { index: number }) => ({ itemCode: null, description: "", qty: null, unitPriceEx: null, totalEx: -5, ...over });

  it("attaches by code compared with normCode, ignoring case and spaces", () => {
    const m = attachDiscounts(products, [neg({ index: 5, itemCode: " 15 056 " })]);
    expect(m.get(5)).toBe(1);
  });

  it("falls back to the description without discount words", () => {
    expect(discountKey("LESS: Humpty Doo Barramundi fillets per kg")).toBe(descKey("Humpty Doo Barramundi fillets per kg"));
    expect(attachDiscounts(products, [neg({ index: 5, description: "Rebate Kingfish fillets" })]).get(5)).toBe(0);
  });

  it("a code shared by two products is narrowed by description, else left unattached", () => {
    const twin = [...products, { index: 2, itemCode: "15056", description: "Barramundi skin on", unitPriceEx: 30 }];
    expect(attachDiscounts(twin, [neg({ index: 7, itemCode: "15056", description: "Discount Barramundi skin on" })]).get(7)).toBe(2);
    expect(attachDiscounts(twin, [neg({ index: 7, itemCode: "15056", description: "Discount" })]).get(7)).toBeNull();
  });

  it("positive or missing totals are never discounts", () => {
    expect(attachDiscounts(products, [neg({ index: 5, itemCode: "15056", totalEx: 5 })]).get(5)).toBeNull();
    expect(attachDiscounts(products, [neg({ index: 5, itemCode: "15056", totalEx: null })]).get(5)).toBeNull();
  });

  it("returned goods need a quantity, a price within 1% and quantity x price equal to the total to 2c", () => {
    const p = products[1];
    const ret = { index: 5, itemCode: "15056", description: "", qty: -2, unitPriceEx: 41.54, totalEx: -83.08 };
    expect(isGoodsReturn(ret, p)).toBe(true);
    expect(isGoodsReturn({ ...ret, unitPriceEx: 41.9, totalEx: -83.8 }, p)).toBe(true); // 0.87% off
    expect(isGoodsReturn({ ...ret, unitPriceEx: 42.2, totalEx: -84.4 }, p)).toBe(false); // 1.6% off
    expect(isGoodsReturn({ ...ret, totalEx: -90 }, p)).toBe(false); // maths do not hold
    expect(isGoodsReturn({ ...ret, qty: null }, p)).toBe(false);
    expect(isGoodsReturn({ ...ret, unitPriceEx: null }, p)).toBe(false);
  });
});

describe("'this is not a stock item' is remembered", () => {
  const rejected = mapRow({ id: "rej", supplier_id: SUP_DS, item_code: "15026", ingredient_id: null, product_id: null, packs_per_unit: null, rejected: true });

  it("a target-less rejected map row for the supplier and code makes the line ignored: no match, no question", () => {
    const a = analyseInvoice(danielStreet51329Fixed(), baseCtx({ maps: [rejected] }));
    const k = byNo(a.lines, 1);
    expect(k).toMatchObject({ match_state: "ignored", ingredient_id: null, product_id: null, decision: "none", decision_reason: "A person said this is not a stock item." });
    expect(k.new_pack_price).toBeNull();
    expect(a.questions.filter((q) => q.line_no === 1)).toEqual([]);
    expect(a.summary.unmatched).toBe(0);
    // the other product is untouched
    expect(byNo(a.lines, 2).match_state).toBe("matched");
  });

  it("the same line without the rejection matches the ingredient by its supplier code, as before", () => {
    expect(byNo(analyseInvoice(danielStreet51329Fixed(), baseCtx()).lines, 1).match_state).toBe("matched");
  });

  it("by description when the line has no code (desc_key rows)", () => {
    const sup = supplierDS();
    const rej = mapRow({ id: "rd", supplier_id: SUP_DS, desc_key: descKey("Mystery bait"), packs_per_unit: null, rejected: true });
    const m = buildMatcher(baseCtx({ maps: [rej] }), sup, "Daniel Street Fish Market");
    expect(m.match({ item_code: null, description: "MYSTERY  BAIT" }).state).toBe("ignored");
    expect(m.match({ item_code: null, description: "Kingfish fillets" }).state).toBe("unmatched");
  });

  it("is scoped to the supplier: another supplier's rejection does nothing", () => {
    const other = mapRow({ id: "x", supplier_id: "sup-other", item_code: "15026", packs_per_unit: null, rejected: true });
    const m = buildMatcher(baseCtx({ maps: [other] }), supplierDS(), "Daniel Street Fish Market");
    expect(m.match({ item_code: "15026", description: "Kingfish fillets" }).state).toBe("matched");
  });

  it("is scoped to the venue: a rejection saved for another venue does nothing here", () => {
    const elsewhere = mapRow({ id: "v", supplier_id: SUP_DS, venue_id: 2, item_code: "15026", packs_per_unit: null, rejected: true });
    const m = buildMatcher(baseCtx({ maps: [elsewhere] }), supplierDS(), "Daniel Street Fish Market");
    expect(m.match({ item_code: "15026", description: "Kingfish fillets" }).state).toBe("matched");
  });

  it("a rejection that names an ingredient still only removes that candidate (not the whole line)", () => {
    const notThat = mapRow({ id: "n", supplier_id: SUP_DS, item_code: "15026", ingredient_id: ING_KINGFISH.id, packs_per_unit: null, rejected: true });
    const m = buildMatcher(baseCtx({ maps: [notThat] }), supplierDS(), "Daniel Street Fish Market");
    expect(m.match({ item_code: "15026", description: "Kingfish fillets" }).state).toBe("unmatched");
  });

  it("a match a person confirmed afterwards still wins over the older rejection", () => {
    const confirmed = mapRow({ id: "c", supplier_id: SUP_DS, item_code: "15026", ingredient_id: ING_KINGFISH.id, packs_per_unit: 1 });
    const m = buildMatcher(baseCtx({ maps: [rejected, confirmed] }), supplierDS(), "Daniel Street Fish Market");
    expect(m.match({ item_code: "15026", description: "Kingfish fillets" })).toMatchObject({ state: "matched", method: "code", mapId: "c" });
  });

  it("an ignored line still takes part in the delivery spread, so the pool is fully allocated", () => {
    const a = analyseInvoice(danielStreet51329Fixed(), baseCtx({ maps: [rejected] }));
    const shares = a.lines.filter((l) => l.line_class === "product").map((l) => l.fee_share_ex);
    expect(cents(shares.reduce((s, x) => s + x, 0))).toBe(cents(a.fee_pool_ex));
  });
});
