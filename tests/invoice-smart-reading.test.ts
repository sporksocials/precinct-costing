import { describe, expect, it } from "vitest";
import { analyseInvoice } from "../lib/invoice-engine";
import { extractedFromStored } from "../lib/invoice-answer";
import { ReadError, groupPages, parseExtracted, parseSorted, READ_SYSTEM, SORT_SYSTEM, READ_SCHEMA, SORT_SCHEMA } from "../lib/invoice-read";
import { isNotSupplied, lineAmounts, lineTolerance, reconcile, settleGst } from "../lib/invoice-recon";
import type { AnalysedLine, ExtractedInvoice, InvoiceDocumentRow, InvoiceLineRow, SortedPage } from "../lib/invoice-types";
import { baseCtx } from "./fixtures/invoice-fixtures";

// ---------------------------------------------------------------- helpers: build what the reader would reply, then parse it for real
type Raw = Record<string, unknown>;
const rline = (no: number, over: Raw): Raw => ({
  line_no: no, page: 1, item_code: null, description: `Line ${no}`, qty: null, unit: null, unit_price: null, line_total: null,
  basis: "ex", gst: "taxable", class_hint: "product", ...over,
});
const reply = (over: Raw, lines: Raw[]): Raw => ({
  doc_type: "invoice", supplier_name: "Test Supplier", supplier_abn: null, invoice_number: "T-1", invoice_date: "2026-10-22", due_date: null,
  bill_to: "Drift", ship_to: null, pages: [1], subtotal_ex: null, gst_total: null, total_inc: null, lines, notes: [], ...over,
});
const analyse = (r: Raw) => analyseInvoice(parseExtracted(r), baseCtx());
const byNo = (lines: AnalysedLine[], no: number) => lines.find((l) => l.line_no === no) as AnalysedLine;
const failedNotes = (a: { recon_notes: { ok: boolean; message: string }[] }) => a.recon_notes.filter((n) => !n.ok).map((n) => n.message);
const okNotes = (a: { recon_notes: { ok: boolean; message: string }[] }) => a.recon_notes.filter((n) => n.ok).map((n) => n.message);
const questionLines = (a: { questions: { line_no: number | null }[] }) => a.questions.map((q) => q.line_no);

// ---------------------------------------------------------------- 1 a printed Discount column
const yourMates = (over: Raw = {}, lineOver: Raw = {}): Raw =>
  reply(
    { supplier_name: "Your Mates Brewing", invoice_number: "INV-34730", subtotal_ex: 296, gst_total: 29.6, total_inc: 325.6, ...over },
    [
      rline(1, { description: "Larry Pale Ale Keg 50L 4.5%", qty: 1, unit: "EA", unit_price: 345, discount_pct: 20, line_total: 276, ...lineOver }),
      rline(2, { description: "Delivery", qty: 1, unit: "EA", unit_price: 20, line_total: 20, class_hint: "delivery" }),
    ],
  );

describe("a printed line Discount column (Your Mates INV-34730, Black Flag INV-23820)", () => {
  it("Your Mates: 1 x 345.00 less 20% is 276.00, and the invoice reconciles", () => {
    const a = analyse(yourMates());
    expect(failedNotes(a)).toEqual([]);
    expect(a.reconciled).toBe(true);
    const k = byNo(a.lines, 1);
    expect(k.math_ok).toBe(true);
    expect(k).toMatchObject({ unit_price_ex: 345, line_total_ex: 276, line_discount_ex: 69, discount_pct: 0.2 });
    expect(okNotes(a)).toContain("Every line's quantity times price matches its total.");
  });

  it("the same invoice WITHOUT the discount fields is still caught by the old strict maths (nothing labels the 69.00)... unless the totals back an unlabelled 20%", () => {
    // no discount_pct: the 20% is clean, so it is inferred ONLY because the printed subtotal, GST and total all agree with it
    const a = analyse(yourMates({}, { discount_pct: undefined }));
    expect(a.reconciled).toBe(true);
    expect(okNotes(a).some((m) => m.includes("20% off $345.00 is $276.00"))).toBe(true);
    expect(byNo(a.lines, 1)).toMatchObject({ line_discount_ex: 69, discount_pct: 0.2, math_ok: true });
  });

  it("Black Flag: El Agave 50L keg 1 x 280.00 shows 252.00 (10% off)", () => {
    const r = reply({ supplier_name: "Black Flag Brewing", invoice_number: "INV-23820", subtotal_ex: 252, gst_total: 25.2, total_inc: 277.2 }, [
      rline(1, { description: "El Agave - 50L Keg", qty: 1, unit: "KEG", unit_price: 280, discount_pct: 10, line_total: 252 }),
    ]);
    const a = analyse(r);
    expect(a.reconciled).toBe(true);
    expect(byNo(a.lines, 1)).toMatchObject({ line_discount_ex: 28, discount_pct: 0.1 });
    // and the unlabelled version is accepted for the same reason
    r.lines = [rline(1, { description: "El Agave - 50L Keg", qty: 1, unit: "KEG", unit_price: 280, line_total: 252 })];
    expect(analyse(r).reconciled).toBe(true);
  });

  it("a printed discount in dollars works too, and a wrong rate still fails", () => {
    expect(analyse(yourMates({}, { discount_pct: undefined, discount_amount: 69 })).reconciled).toBe(true);
    const bad = analyse(yourMates({}, { discount_pct: 15 }));
    expect(bad.reconciled).toBe(false);
    expect(failedNotes(bad)[0]).toContain("1 x $345.00 less 15% is $293.25 but the line says $276.00.");
  });

  it("landed cost is the NET value over the full quantity, and the delivery share weighs net value", () => {
    const a = analyse(yourMates());
    expect(a.fee_pool_ex).toBe(20);
    const k = byNo(a.lines, 1);
    expect(k.fee_share_ex).toBe(20);
    expect(k.landed_total_ex).toBe(296); // 276 net + 20 delivery
    expect(k.landed_unit_ex).toBe(296);
  });

  it("a printed discount and a same-code negative discount line add up (never double counted); fee weights use the net value", () => {
    const r = reply({ subtotal_ex: 396 - 10, gst_total: 38.6, total_inc: 424.6 }, [
      rline(1, { item_code: "KEG1", description: "Keg A", qty: 1, unit: "EA", unit_price: 345, discount_pct: 20, line_total: 276 }),
      rline(2, { item_code: "KEG1", description: "Keg A rebate", qty: 0, unit_price: -10, line_total: -10, class_hint: "credit" }),
      rline(3, { item_code: "B1", description: "Keg B", qty: 1, unit: "EA", unit_price: 100, line_total: 100 }),
      rline(4, { description: "Delivery", qty: 1, unit_price: 20, line_total: 20, class_hint: "delivery" }),
    ]);
    const a = analyse(r);
    expect(failedNotes(a)).toEqual([]);
    const k = byNo(a.lines, 1);
    // 69 printed + 10 negative line = 79 off the 345 list
    expect(k.line_discount_ex).toBe(79);
    expect(k.discount_pct).toBe(0.228986);
    // net values 266 and 100: pool 20 splits 14.54 / 5.46 (a gross-weighted split would give 15.51 / 4.49)
    expect(k.fee_share_ex).toBe(14.54);
    expect(byNo(a.lines, 3).fee_share_ex).toBe(5.46);
    expect(k.landed_total_ex).toBe(280.54); // 276 - 10 + 14.54
    expect(byNo(a.lines, 2).line_class).toBe("discount");
  });
});

// ---------------------------------------------------------------- 2 Amount includes GST, the unit price does not
describe("an Amount column that includes GST while the unit price does not (Markris)", () => {
  const markris = (over: Raw): Raw[] => [
    rline(1, { description: "ONE TREE - BAMBOO PADDLE SKEWER 150mm", qty: 1, unit_price: 6.57, line_total: 7.23, ...over }),
    rline(2, { description: "GINGHAM BLACK GREASEPROOF SHEETS", qty: 1, unit_price: 9.27, line_total: 10.19, ...over }),
    rline(3, { description: "MARKRIS - PEANUTS CRUSHED - 1KG", qty: 2, unit_price: 7.49, line_total: 16.48, ...over }),
    rline(4, { description: "GAROFALO - LINGUINE PASTA", qty: 4, unit_price: 3.42, line_total: 13.68, gst: "free" }),
  ];
  const totals = { subtotal_ex: 44.5, gst_total: 3.08, total_inc: 47.58 };

  it("read correctly (total_basis inc) it reconciles with no guessing", () => {
    const a = analyse(reply(totals, markris({ basis: "ex", total_basis: "inc" })));
    expect(failedNotes(a)).toEqual([]);
    expect(a.reconciled).toBe(true);
    expect(byNo(a.lines, 1)).toMatchObject({ unit_price_ex: 6.57, line_total_ex: 6.5727, math_ok: true });
    expect(a.recon_notes.some((n) => n.message.startsWith("Amount includes GST"))).toBe(false);
  });

  it("read without the hint it is INFERRED, with a plain note, because the printed totals agree", () => {
    const a = analyse(reply(totals, markris({ basis: "ex" })));
    expect(failedNotes(a)).toEqual([]);
    expect(a.reconciled).toBe(true);
    const note = okNotes(a).find((m) => m.startsWith("Amount includes GST"));
    expect(note).toContain("BAMBOO PADDLE SKEWER");
    expect(note).toContain("Peanuts Crushed");
    expect(byNo(a.lines, 1)).toMatchObject({ unit_price_ex: 6.57, line_total_ex: 6.5727, math_ok: true, gst: "taxable" });
    expect(byNo(a.lines, 3)).toMatchObject({ unit_price_ex: 7.49, line_total_ex: 14.9818 });
    // GST free lines are untouched
    expect(byNo(a.lines, 4)).toMatchObject({ unit_price_ex: 3.42, line_total_ex: 13.68, math_ok: true });
  });

  it("the way the live reader got it wrong (both columns marked inc) is fixed the same way", () => {
    const a = analyse(reply(totals, markris({ basis: "inc" })));
    expect(a.reconciled).toBe(true);
    expect(byNo(a.lines, 1).unit_price_ex).toBe(6.57); // the price is the printed 6.57 before GST, not 6.57 / 1.1
  });

  it("Nice Biscuits 2 x 2.65 shows 5.82 and Greaseproof 1 x 9.27 shows 10.19", () => {
    const r = reply({ subtotal_ex: 14.57, gst_total: 1.46, total_inc: 16.03 }, [
      rline(1, { description: "Arnotts - Nice Biscuits - 250g", qty: 2, unit_price: 2.65, line_total: 5.82 }),
      rline(2, { description: "Gingham Greaseproof", qty: 1, unit_price: 9.27, line_total: 10.19 }),
    ]);
    expect(analyse(r).reconciled).toBe(true);
  });

  it("GST free lines keep the strict check: a free line that is 10% over does not pass", () => {
    const r = reply({ subtotal_ex: 15.3, gst_total: 0, total_inc: 15.3 }, [rline(1, { description: "Pasta", qty: 4, unit_price: 3.42, line_total: 15.05, gst: "free" })]);
    expect(analyse(r).reconciled).toBe(false);
  });

  it("is NOT inferred when the printed totals do not agree, or when nothing is printed to check against", () => {
    const wrong = analyse(reply({ ...totals, subtotal_ex: 50.0 }, markris({ basis: "ex" })));
    expect(wrong.reconciled).toBe(false);
    expect(failedNotes(wrong).some((m) => m.includes("1 x $6.57 is $6.57 but the line says $7.23."))).toBe(true);
    const bare = analyse(reply({}, markris({ basis: "ex" })));
    expect(bare.reconciled).toBe(false);
    expect(failedNotes(bare).some((m) => m.includes("no subtotal, GST or total"))).toBe(true);
    expect(failedNotes(bare).some((m) => m.includes("1 x $6.57 is $6.57 but the line says $7.23."))).toBe(true);
  });
});

// ---------------------------------------------------------------- 3 the unit price is rounded to the cent
describe("rounding: the unit price is printed to the cent, the total is worked from the unrounded price", () => {
  const rows: [string, number, number, number][] = [
    ["UHT Coconut Milk", 10, 5.77, 57.65],
    ["Mission Tortilla", 12, 6.25, 75.06],
    ["Chingu Watermelon", 40, 6.22, 249.0],
    ["Edamame Bean", 30, 2.57, 76.95],
    ["Prawn Meat", 20, 17.87, 357.3],
    ["Avocado Diced", 20, 11.82, 236.49],
    ["Potato Desiree", 8.3, 3.7, 30.75],
    ["Pak Choy", 20, 2.88, 57.52],
  ];

  it("the tolerance scales: max(2c, qty x 0.5c + 1c)", () => {
    expect(lineTolerance(1)).toBeCloseTo(0.02, 10);
    expect(lineTolerance(2)).toBeCloseTo(0.02, 10);
    expect(lineTolerance(10)).toBeCloseTo(0.06, 10);
    expect(lineTolerance(40)).toBeCloseTo(0.21, 10);
    expect(lineTolerance(null)).toBeCloseTo(0.02, 10);
  });

  it("every live rounding line passes, on its own and together", () => {
    for (const [d, q, p, t] of rows) {
      const sum = Math.round(t * 100) / 100;
      const a = analyse(reply({ subtotal_ex: sum, gst_total: 0, total_inc: sum }, [rline(1, { description: d, qty: q, unit_price: p, line_total: t, gst: "free" })]));
      expect(failedNotes(a), d).toEqual([]);
      expect(a.reconciled, d).toBe(true);
    }
    const total = Math.round(rows.reduce((s, r) => s + r[3], 0) * 100) / 100;
    const all = analyse(reply({ subtotal_ex: total, gst_total: 0, total_inc: total }, rows.map((r, i) => rline(i + 1, { description: r[0], qty: r[1], unit_price: r[2], line_total: r[3], gst: "free" }))));
    expect(all.reconciled).toBe(true);
  });

  it("a taxable line printed inc GST (Maroochy Bridge: 40 x 6.22 = 249.00) passes", () => {
    const a = analyse(reply({ subtotal_ex: null, gst_total: 22.64, total_inc: 249.0 }, [rline(1, { description: "Chingu Peach 360mL", qty: 40, unit_price: 6.22, line_total: 249.0, basis: "inc" })]));
    expect(failedNotes(a)).toEqual([]);
    expect(a.reconciled).toBe(true);
  });

  it("a genuine mismatch still fails: Daniel Street #51329 barramundi 2.39 x 41.50 = 99.185, the line says 98.98", () => {
    const r = reply({ supplier_name: "Daniel Street Fish Market", invoice_number: "51329", subtotal_ex: 98.98, gst_total: 0, total_inc: 98.98 }, [
      rline(1, { item_code: "15056", description: "Humpty Doo Barramundi fillets per kg", qty: 2.39, unit: "KG", unit_price: 41.5, line_total: 98.98, gst: "free" }),
    ]);
    const a = analyse(r);
    expect(a.reconciled).toBe(false);
    expect(failedNotes(a)).toEqual(["Humpty Doo Barramundi fillets: 2.39 x $41.50 is $99.19 but the line says $98.98."]);
    expect(byNo(a.lines, 1).math_ok).toBe(false);
  });
});

// ---------------------------------------------------------------- 4 lines that were not supplied
describe("lines that were not supplied", () => {
  const suncoast = (): Raw =>
    reply({ supplier_name: "Suncoast Fresh", invoice_number: "3431556", subtotal_ex: null, gst_total: 0.33, total_inc: 182.93 }, [
      rline(1, { item_code: "ORJ", description: "ORANGES JUICING KG", qty: 3.1, unit: "KG", unit_price: 2.63, line_total: 8.16, gst: "free" }),
      rline(2, { item_code: "BL", description: "BROCCOLINI BNCH (NA - not available)", qty: 0, unit: "BCH", gst: "free" }),
      rline(3, { item_code: "BLB", description: "BABY BROCCOLI BNCH (SU - sent as substitute)", qty: 6, unit: "BCH", unit_price: 3.41, line_total: 20.47, gst: "free" }),
      rline(4, { item_code: "TGBC", description: "TOMATO GRAPE BULK CTN (5KG) (NA - not available)", qty: 0, unit: "CTN", gst: "free" }),
      rline(5, { item_code: "MBC", description: "MUSHROOM BUTTON CTN", qty: 1, unit: "CTN", unit_price: 150.67, line_total: 150.67, gst: "free" }),
      rline(6, { description: "FUEL LEVY (*)", line_total: 3.3, class_hint: "fee" }),
    ]);

  it("the invoice reconciles, the two unsupplied lines are skipped quietly and nothing asks about them", () => {
    const a = analyse(suncoast());
    expect(failedNotes(a)).toEqual([]);
    expect(a.reconciled).toBe(true);
    for (const no of [2, 4]) {
      expect(byNo(a.lines, no)).toMatchObject({ match_state: "ignored", decision: "none", decision_reason: "Not supplied on this invoice.", math_ok: null });
      expect(questionLines(a)).not.toContain(no);
    }
    // the substitute lines that WERE delivered are ordinary products
    expect(byNo(a.lines, 3).match_state).not.toBe("ignored");
  });

  it("the unsupplied lines take no share of the delivery pool", () => {
    const a = analyse(suncoast());
    expect(byNo(a.lines, 2).fee_share_ex).toBe(0);
    expect(byNo(a.lines, 4).fee_share_ex).toBe(0);
  });

  it("recognises what was not supplied, and never skips a line that has money on it", () => {
    expect(isNotSupplied({ description: "Carrot Grated Kg", qty: 0, unit_price: null, line_total: null })).toBe(true);
    expect(isNotSupplied({ description: "Carrot Grated Kg", qty: 0, unit_price: 7.3, line_total: 0 })).toBe(true);
    expect(isNotSupplied({ description: "TOMATO (NA - not available)", qty: null, unit_price: null, line_total: null })).toBe(true);
    expect(isNotSupplied({ description: "Eggs OUT OF STOCK", qty: null, unit_price: null, line_total: null })).toBe(true);
    expect(isNotSupplied({ description: "Eggs (back order)", qty: null, unit_price: null, line_total: null })).toBe(true);
    expect(isNotSupplied({ description: "Eggs (NA - not available)", qty: 1, unit_price: 5, line_total: 5 })).toBe(false);
    expect(isNotSupplied({ description: "Sent as substitute (SU)", qty: 6, unit_price: 3.41, line_total: 20.47 })).toBe(false);
    expect(isNotSupplied({ description: "Nashi Pear", qty: null, unit_price: null, line_total: null })).toBe(false);
    expect(isNotSupplied({ description: "Banana", qty: 0, unit_price: -5, line_total: -5 })).toBe(false); // a credit with a quantity of 0 has money on it
  });

  it("Simon George: a Carrot Grated Kg line supplied 0.00 does not fail the invoice", () => {
    const r = reply({ supplier_name: "Simon George & Sons", subtotal_ex: null, gst_total: 0, total_inc: 12.6 }, [
      rline(1, { item_code: "PCARG", description: "CARROT GRATED KG", qty: 0, unit: "KG", gst: "free" }),
      rline(2, { item_code: "HCORB", description: "CORIANDER/CILANTRO BUNCH", qty: 6, unit: "BUNCH", unit_price: 2.1, line_total: 12.6, gst: "free" }),
    ]);
    const a = analyse(r);
    expect(a.reconciled).toBe(true);
    expect(byNo(a.lines, 1).match_state).toBe("ignored");
  });

  it("a line with no price that was supposed to be supplied still fails", () => {
    const r = reply({ subtotal_ex: 12.6, gst_total: 0, total_inc: 12.6 }, [
      rline(1, { description: "Mystery item", qty: 3, gst: "free" }),
      rline(2, { description: "Coriander bunch", qty: 6, unit_price: 2.1, line_total: 12.6, gst: "free" }),
    ]);
    const a = analyse(r);
    expect(a.reconciled).toBe(false);
    expect(failedNotes(a)).toEqual(["Mystery item: no price or total could be read."]);
  });
});

// ---------------------------------------------------------------- 5 GST total printed as 0.00
describe("a printed GST total of 0.00 makes every line GST free", () => {
  const simonGeorge = (over: Raw = {}): Raw =>
    reply({ supplier_name: "Simon George & Sons", invoice_number: "10208069", subtotal_ex: 58.87, gst_total: 0, total_inc: 58.87, ...over }, [
      rline(1, { description: "MINT BUNCH", qty: 5, unit: "BUNCH", unit_price: 3.65, line_total: 18.25, gst: "free" }),
      rline(2, { description: "LIME KAFFIR LEAF KG", qty: 0.2, unit: "KG", unit_price: 94.85, line_total: 18.97, gst: "taxable" }),
      rline(3, { description: "SHALLOT FRENCH GOLD PEELED KG", qty: 2, unit: "KG", unit_price: 19.95, line_total: 39.9, gst: "taxable" }),
    ]);

  it("the reader flagged two lines taxable under a (*) legend; the invoice has no GST, so they are free", () => {
    const r = simonGeorge({ subtotal_ex: 77.12, total_inc: 77.12 });
    const a = analyse(r);
    expect(failedNotes(a)).toEqual([]);
    expect(a.reconciled).toBe(true);
    expect(byNo(a.lines, 2)).toMatchObject({ gst: "free", gst_amount: 0 });
    expect(byNo(a.lines, 3).gst).toBe("free");
  });

  it("it cannot hide a real difference: a total that does not equal the subtotal still fails", () => {
    const a = analyse(simonGeorge({ subtotal_ex: 77.12, total_inc: 84.83 }));
    expect(a.reconciled).toBe(false);
    expect(failedNotes(a)[0]).toContain("The subtotal $77.12 plus GST $0.00 is $77.12 but the invoice total says $84.83.");
  });

  it("with nothing else printed to prove it, a bare 0.00 does not override the reader's flags", () => {
    const a = analyse(simonGeorge({ subtotal_ex: null, total_inc: null }));
    expect(a.reconciled).toBe(false);
    expect(failedNotes(a)[0]).toContain("GST on the taxable lines works out at $5.89 but the invoice says $0.00.");
  });

  it("a printed positive GST total leaves the flags alone", () => {
    const parsed = parseExtracted(simonGeorge({ gst_total: 5.89, total_inc: 83.01 }));
    expect(settleGst(parsed.lines, parsed).map((l) => l.gst)).toEqual(["free", "taxable", "taxable"]);
  });
});

// ---------------------------------------------------------------- 6 discount and credit lines with no GST status
describe("discount and credit lines with no GST status (Daniel Street 51449 / 9764204)", () => {
  const ds = (): Raw =>
    reply({ supplier_name: "Daniel Street Fish Market", invoice_number: "51449", subtotal_ex: 722.54, gst_total: 0.59, total_inc: 723.13 }, [
      rline(1, { item_code: "1", description: "delivery", qty: 1, unit_price: 6.5, line_total: 6.5, basis: "inc", class_hint: "delivery" }),
      rline(2, { item_code: "15056", description: "HUMPTY DOO BARRAMUNDI FILLETS SKIN ON PER KG", qty: 20.71, unit: "KG", unit_price: 41.5, line_total: 859.47, basis: "inc", gst: "free" }),
      rline(3, { item_code: "15056", description: "HUMPTY DOO BARRAMUNDI FILLETS SKIN ON PER KG", qty: 0, unit_price: -142.84, line_total: -142.84, basis: "inc", gst: "unknown", class_hint: "discount" }),
      rline(4, { item_code: "ØDISCOUNT", description: "DISCOUNT", qty: 0, unit_price: 0, line_total: 0, basis: "inc", gst: "unknown", class_hint: "discount" }),
    ]);

  it("the discount line takes the barramundi's GST status, the $0.00 line is ignored, and the invoice reconciles", () => {
    const a = analyse(ds());
    expect(failedNotes(a)).toEqual([]);
    expect(a.reconciled).toBe(true);
    expect(byNo(a.lines, 3)).toMatchObject({ line_class: "discount", gst: "free", line_total_ex: -142.84 });
    expect(byNo(a.lines, 4).decision).toBe("none");
    expect(a.questions.filter((q) => q.prompt.includes("does not say whether GST"))).toEqual([]);
    // the standing discount attaches to the barramundi as before
    expect(byNo(a.lines, 2).line_discount_ex).toBe(142.84);
  });

  it("a negative line with no same-code product is GST free; a conflicting code stays free too", () => {
    const lines = parseExtracted(reply({}, [
      rline(1, { item_code: "A", description: "Alpha", qty: 1, unit_price: 10, line_total: 10, gst: "taxable" }),
      rline(2, { item_code: "Z", description: "Mystery credit", qty: 1, unit_price: -2, line_total: -2, basis: "inc", gst: "unknown" }),
      rline(3, { item_code: "A", description: "Alpha rebate", qty: 0, unit_price: -1, line_total: -1, basis: "inc", gst: "unknown" }),
      rline(4, { item_code: "Q", description: "Positive unknown", qty: 1, unit_price: 5, line_total: 5, basis: "ex", gst: "unknown" }),
    ])).lines;
    const settled = settleGst(lines, { subtotal_ex: null, gst_total: null, total_inc: null });
    expect(settled.map((l) => l.gst)).toEqual(["taxable", "free", "taxable", "unknown"]);
  });

  it("a printed zero is convertible whatever the GST status, a printed non-zero inc price with unknown GST is not", () => {
    expect(lineAmounts({ unit_price: 0, line_total: 0, basis: "inc", gst: "unknown" }, 0.1).convertible).toBe(true);
    expect(lineAmounts({ unit_price: 5, line_total: 5, basis: "inc", gst: "unknown" }, 0.1).convertible).toBe(false);
  });
});

// ---------------------------------------------------------------- 7 totals on a second page
describe("totals on a second page belong to the first page's invoice (Markris)", () => {
  const sp = (page: number, over: Partial<SortedPage> = {}): SortedPage => ({
    page, doc_type: "invoice", supplier_name: "Markris Wholesale Foods", invoice_number: "793108", page_of: null, continues_previous: false, ...over,
  });

  it("the same supplier and the same invoice number on the next page is one invoice, even when the sorter said new document", () => {
    expect(groupPages([sp(1), sp(2)])).toEqual([{ doc_type: "invoice", supplier_name: "Markris Wholesale Foods", invoice_number: "793108", pages: [1, 2] }]);
  });

  it("matches the number once punctuation and capitals are gone, and the supplier by a shorter name", () => {
    const g = groupPages([sp(1, { invoice_number: "I-793108" }), sp(2, { invoice_number: "i793108", supplier_name: "Markris Wholesale" })]);
    expect(g.map((x) => x.pages)).toEqual([[1, 2]]);
  });

  it("a remittance page with no number of its own (totals_only) joins the invoice before it", () => {
    const g = groupPages([sp(1, { invoice_number: "793637" }), sp(2, { invoice_number: null, supplier_name: null, totals_only: true } as Partial<SortedPage>)]);
    expect(g.map((x) => x.pages)).toEqual([[1, 2]]);
  });

  it("a totals_only page that prints a DIFFERENT number or another supplier does not join", () => {
    expect(groupPages([sp(1), sp(2, { invoice_number: "793637", totals_only: true } as Partial<SortedPage>)]).map((x) => x.pages)).toEqual([[1], [2]]);
    expect(groupPages([sp(1), sp(2, { supplier_name: "Bidfood Sunshine Coast", invoice_number: null, totals_only: true } as Partial<SortedPage>)]).map((x) => x.pages)).toEqual([[1], [2]]);
  });

  it("different invoice numbers from the same supplier stay separate, and a blank back between two pages changes nothing", () => {
    expect(groupPages([sp(1), sp(2, { invoice_number: "793637" })]).map((x) => x.pages)).toEqual([[1], [2]]);
    expect(groupPages([sp(1), sp(2, { doc_type: "blank", supplier_name: null, invoice_number: null }), sp(3)]).map((x) => x.pages)).toEqual([[1, 3]]);
  });

  it("a statement that mentions the number is not folded into the invoice", () => {
    expect(groupPages([sp(1), sp(2, { doc_type: "statement" })]).map((x) => x.doc_type)).toEqual(["invoice", "statement"]);
  });

  it("the sort prompt and shape tell the model about continuation pages, and parseSorted keeps totals_only", () => {
    expect(SORT_SYSTEM).toMatch(/remittance/i);
    expect(SORT_SYSTEM).toMatch(/belongs to the invoice on the page before/);
    expect(SORT_SCHEMA.pages[0]).toHaveProperty("totals_only");
    const raw = {
      pages: [
        { page: 1, doc_type: "invoice", supplier_name: "Markris", invoice_number: "793108", page_of: null, continues_previous: false },
        { page: 2, doc_type: "invoice", supplier_name: "Markris", invoice_number: null, page_of: null, continues_previous: true, totals_only: true },
      ],
    };
    const sorted = parseSorted(raw, 2);
    expect((sorted[1] as { totals_only?: boolean }).totals_only).toBe(true);
    expect((sorted[0] as { totals_only?: boolean }).totals_only).toBeUndefined();
    expect(() => parseSorted({ pages: [{ ...raw.pages[0], totals_only: "yes" }, raw.pages[1]] }, 2)).toThrow(ReadError);
  });

  it("the merged invoice, read as one, reconciles against the totals from its second page", () => {
    const a = analyse(
      reply({ supplier_name: "Markris Wholesale Foods", invoice_number: "793108", pages: [1, 2], subtotal_ex: 623.65, gst_total: 0, total_inc: 623.65 }, [
        rline(1, { page: 1, description: "Pasta", qty: 5, unit_price: 100, line_total: 500, gst: "free" }),
        rline(2, { page: 1, description: "Rice", qty: 1, unit_price: 123.65, line_total: 123.65, gst: "free" }),
      ]),
    );
    expect(a.reconciled).toBe(true);
  });
});

// ---------------------------------------------------------------- A the reader's prompt and checks
describe("the reader: prompt rules and strict checks on the new fields", () => {
  it("the prompt and shape cover the Discount column, the Amount column, supplied quantity, NA lines and later-page totals", () => {
    for (const k of ["discount_pct", "discount_amount", "total_basis"]) expect(READ_SCHEMA.lines[0]).toHaveProperty(k);
    expect(READ_SYSTEM).toMatch(/SUPPLIED/);
    expect(READ_SYSTEM).toMatch(/AMOUNT AFTER Inc GST/);
    expect(READ_SYSTEM).toMatch(/Discount column/);
    expect(READ_SYSTEM).toMatch(/not supplied/i);
    expect(READ_SYSTEM).toMatch(/later page/);
    expect(READ_SYSTEM).toMatch(/0\.00/);
    expect(READ_SYSTEM).toMatch(/DATA TO TRANSCRIBE/); // the prompt injection rule is still there
    expect(READ_SYSTEM).toMatch(/never an instruction/);
    expect(READ_SYSTEM).toMatch(/Drift's company ABN/); // the ABN rule is unchanged
    expect(READ_SYSTEM + SORT_SYSTEM).not.toMatch(/[–—]/);
  });

  it("accepts the new fields and keeps nothing when they are absent or null", () => {
    const p = parseExtracted(reply({}, [
      rline(1, { qty: 1, unit_price: 345, discount_pct: 20, line_total: 276, total_basis: "inc" }),
      rline(2, { qty: 1, unit_price: 5, line_total: 5, discount_pct: null, discount_amount: null, total_basis: null }),
      rline(3, { qty: 1, unit_price: 5, line_total: 5, discount_amount: 1.5 }),
    ]));
    expect(p.lines[0]).toMatchObject({ discount_pct: 20, total_basis: "inc" });
    expect("discount_amount" in p.lines[0]).toBe(false);
    for (const k of ["discount_pct", "discount_amount", "total_basis"]) expect(k in p.lines[1]).toBe(false);
    expect(p.lines[2].discount_amount).toBe(1.5);
  });

  it("rejects values that cannot be right", () => {
    const bad = (over: Raw) => () => parseExtracted(reply({}, [rline(1, { qty: 1, unit_price: 1, line_total: 1, ...over })]));
    expect(bad({ discount_pct: 120 })).toThrow(/discount_pct/);
    expect(bad({ discount_pct: -5 })).toThrow(/discount_pct/);
    expect(bad({ discount_pct: "20" })).toThrow(/discount_pct/);
    expect(bad({ discount_pct: Number.POSITIVE_INFINITY })).toThrow(/discount_pct/);
    expect(bad({ discount_amount: -3 })).toThrow(/discount_amount/);
    expect(bad({ discount_amount: "3" })).toThrow(/discount_amount/);
    expect(bad({ total_basis: "maybe" })).toThrow(/total_basis/);
    expect(bad({ discount_pct: 0 })).not.toThrow();
    expect(bad({ discount_pct: 100 })).not.toThrow();
  });
});

// ---------------------------------------------------------------- inference needs the document to confirm it
describe("an unlabelled discount is only believed when the whole document agrees", () => {
  it("accepted: 20% off, and the printed subtotal, GST and total all agree", () => {
    const a = analyse(yourMates({}, { discount_pct: undefined }));
    expect(a.reconciled).toBe(true);
  });

  it("rejected: the same 20% short line when the printed subtotal does not agree", () => {
    const a = analyse(yourMates({ subtotal_ex: 316, gst_total: 31.6, total_inc: 347.6 }, { discount_pct: undefined }));
    expect(a.reconciled).toBe(false);
    expect(failedNotes(a).some((m) => m.endsWith("1 x $345.00 is $345.00 but the line says $276.00."))).toBe(true);
    expect(failedNotes(a).some((m) => m.startsWith("The lines add up to $296.00 but the invoice subtotal says $316.00"))).toBe(true);
    expect(byNo(a.lines, 1)).not.toHaveProperty("line_discount_ex");
  });

  it("rejected: nothing printed to check against", () => {
    const a = analyse(yourMates({ subtotal_ex: null, gst_total: null, total_inc: null }, { discount_pct: undefined }));
    expect(a.reconciled).toBe(false);
    expect(failedNotes(a).some((m) => m.includes("but the line says $276.00"))).toBe(true);
  });

  it("rejected: a shortfall that is not a clean percent (19.86%)", () => {
    const a = analyse(yourMates({ subtotal_ex: 296.5, gst_total: 29.65, total_inc: 326.15 }, { discount_pct: undefined, line_total: 276.5 }));
    expect(a.reconciled).toBe(false);
  });

  it("rejected: a shortfall under 1%, and one over 50%", () => {
    expect(analyse(yourMates({ subtotal_ex: 362, gst_total: 36.2, total_inc: 398.2 }, { discount_pct: undefined, line_total: 342 })).reconciled).toBe(false);
    expect(analyse(yourMates({ subtotal_ex: 170, gst_total: 17, total_inc: 187 }, { discount_pct: undefined, line_total: 150 })).reconciled).toBe(false);
  });

  it("a printed discount is never second guessed by inference: a wrong printed rate fails even when the totals agree with the net", () => {
    expect(analyse(yourMates({}, { discount_pct: 25 })).reconciled).toBe(false);
  });
});

// ---------------------------------------------------------------- safety: a changed line never slips through
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("safety: an invoice with a line altered by a non-clean amount never reconciles", () => {
  const cents = (n: number) => Math.round(n * 100) / 100;

  /** an alteration an honest explanation could cover: a clean percent off (1% to 50%), 10% over (GST), or inside the line tolerance */
  function explainable(gross: number, qty: number, total: number): boolean {
    if (Math.abs(total - gross) <= lineTolerance(qty) + 0.011) return true;
    const off = ((gross - total) / gross) * 100;
    const clean = Math.round(off / 0.5) * 0.5;
    if (off >= 0.9 && Math.abs(off - clean) <= 0.08) return true;
    const ratio = total / gross;
    return Math.abs(total - gross * 1.1) <= lineTolerance(qty) * 1.1 + 0.02 || Math.abs(ratio - 1.1) < 0.002;
  }

  for (const mode of ["lines altered, printed totals untouched", "lines altered, printed totals rebuilt to match"] as const) {
    it(`300 random invoices: ${mode}`, () => {
      const rnd = prng(mode.length * 7919);
      let tried = 0;
      for (let n = 0; n < 300; n++) {
        const count = 2 + Math.floor(rnd() * 4);
        const lines = Array.from({ length: count }, (_, i) => {
          const qty = 1 + Math.floor(rnd() * 12);
          const price = cents(2 + rnd() * 120);
          return { qty, price, total: cents(qty * price), gst: rnd() < 0.5 ? ("taxable" as const) : ("free" as const), i };
        });
        const sumOf = (ls: typeof lines) => cents(ls.reduce((s, l) => s + l.total, 0));
        const gstOf = (ls: typeof lines) => cents(ls.filter((l) => l.gst === "taxable").reduce((s, l) => s + l.total, 0) * 0.1);
        const original = { subtotal_ex: sumOf(lines), gst_total: gstOf(lines), total_inc: cents(sumOf(lines) + gstOf(lines)) };

        // the untouched invoice reconciles (so the alteration is what breaks it)
        const build = (ls: typeof lines, totals: typeof original) =>
          reply(totals, ls.map((l) => rline(l.i + 1, { description: `Item ${l.i}`, qty: l.qty, unit_price: l.price, line_total: l.total, gst: l.gst })));
        expect(analyse(build(lines, original)).reconciled).toBe(true);

        const k = Math.floor(rnd() * count);
        const gross = lines[k].qty * lines[k].price;
        const factor = rnd() < 0.5 ? 1 + (0.012 + rnd() * 0.4) : 1 - (0.012 + rnd() * 0.45);
        const altered = cents(gross * factor);
        if (explainable(gross, lines[k].qty, altered)) continue;
        tried += 1;
        const changed = lines.map((l, i) => (i === k ? { ...l, total: altered } : l));
        const totals = mode.startsWith("lines altered, printed totals untouched")
          ? original
          : { subtotal_ex: sumOf(changed), gst_total: gstOf(changed), total_inc: cents(sumOf(changed) + gstOf(changed)) };
        const a = analyse(build(changed, totals));
        expect(a.reconciled, `gross ${gross} altered to ${altered}`).toBe(false);
      }
      expect(tried).toBeGreaterThan(150);
    });
  }
});

// ---------------------------------------------------------------- D re-analysis from stored rows
describe("re-analysis from stored rows never re-fails the maths", () => {
  const doc = {
    id: "d1", file_id: "f1", venue_id: 1, doc_type: "invoice", supplier_name_read: "Your Mates Brewing", supplier_abn_read: null, invoice_number: "INV-34730",
    invoice_date: "2026-10-22", due_date: null, bill_to: "Drift", ship_to: null, pages: [4], subtotal_ex: 296, gst_total: 29.6, total_inc: 325.6,
  } as unknown as InvoiceDocumentRow;
  const row = (over: Partial<InvoiceLineRow>): InvoiceLineRow =>
    ({ id: "x", document_id: "d1", venue_id: 1, line_no: 1, page: 4, line_class: "product", item_code: null, description: "Larry Pale Ale Keg 50L 4.5%", qty: 1, unit: "EA",
      unit_price_ex: 345, line_total_ex: 276, gst: "taxable", math_ok: true, line_discount_ex: 69, discount_pct: 0.2, ...over }) as unknown as InvoiceLineRow;
  const delivery = row({ line_no: 2, line_class: "delivery", description: "Delivery", unit_price_ex: 20, line_total_ex: 20, line_discount_ex: null, discount_pct: null });

  it("a stored list price, net total and discount carry back as a printed discount, and the invoice still reconciles", () => {
    const ex: ExtractedInvoice = extractedFromStored(doc, [row({}), delivery]);
    expect(ex.lines[0]).toMatchObject({ unit_price: 345, line_total: 276, discount_amount: 69, total_basis: "ex" });
    const a = analyseInvoice(ex, baseCtx());
    expect(a.reconciled).toBe(true);
    expect(byNo(a.lines, 1)).toMatchObject({ unit_price_ex: 345, line_total_ex: 276, line_discount_ex: 69, discount_pct: 0.2 });
  });

  it("a negative-line discount (the line total is still gross) is not turned into a second, printed discount", () => {
    const ex = extractedFromStored(doc, [row({ line_total_ex: 345, line_discount_ex: 10, discount_pct: 0.029 })]);
    expect("discount_amount" in ex.lines[0]).toBe(false);
  });

  it("a line whose maths failed before is not explained by a stored discount, and a gap bigger than the discount stays unexplained", () => {
    expect("discount_amount" in extractedFromStored(doc, [row({ math_ok: false })]).lines[0]).toBe(false);
    expect("discount_amount" in extractedFromStored(doc, [row({ line_discount_ex: 30 })]).lines[0]).toBe(false);
    // with no discount to explain it, the line is judged like any other: it adds up only if the document's own totals back a clean percent
    const off = { ...doc, subtotal_ex: 300 } as unknown as InvoiceDocumentRow;
    expect(analyseInvoice(extractedFromStored(off, [row({ line_discount_ex: 30 }), delivery]), baseCtx()).reconciled).toBe(false);
  });

  it("a not supplied line and a GST inclusive amount rebuild without a question", () => {
    const skipped = row({ line_no: 3, description: "Broccolini (NA - not available)", qty: 0, unit_price_ex: null, line_total_ex: null, line_discount_ex: null, discount_pct: null, math_ok: null });
    const ex = extractedFromStored(doc, [row({}), delivery, skipped]);
    const a = analyseInvoice(ex, baseCtx());
    expect(a.reconciled).toBe(true);
    expect(byNo(a.lines, 3)).toMatchObject({ match_state: "ignored", decision_reason: "Not supplied on this invoice." });
  });
});

// ---------------------------------------------------------------- recon unit checks for the new line fields
describe("reconcile with the new line fields", () => {
  it("a skipped line is left out of every check", () => {
    const amounts = lineAmounts({ unit_price: null, line_total: null, basis: "ex", gst: "free" }, 0.1);
    const r = reconcile({
      lines: [{ index: 0, line_class: "product", description: "Gone", qty: 0, unit_price: null, line_total: null, basis: "ex", gst: "free", amounts, skip: true }],
      gstRate: 0.1, subtotal_ex: 0, gst_total: 0, total_inc: 0,
    });
    expect(r.notes.filter((n) => !n.ok)).toEqual([]);
    expect(r.mathOk.get(0)).toBeNull();
  });

  it("lineAmounts reads the Amount column by its own basis", () => {
    const a = lineAmounts({ unit_price: 7.49, line_total: 16.48, basis: "ex", total_basis: "inc", gst: "taxable" }, 0.1);
    expect(a).toMatchObject({ unit_price_ex: 7.49, line_total_ex: 14.9818, gst_amount: 1.4982, convertible: true });
    expect(lineAmounts({ unit_price: 7.49, line_total: 16.48, basis: "ex", total_basis: "inc", gst: "unknown" }, 0.1).convertible).toBe(false);
  });
});
