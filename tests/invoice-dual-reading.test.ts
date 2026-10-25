import { describe, expect, it } from "vitest";
import { analyseInvoice } from "../lib/invoice-engine";
import { parseExtracted, READ_SYSTEM } from "../lib/invoice-read";
import { lineAmounts, lineTolerance, reconcile } from "../lib/invoice-recon";
import type { AnalysedLine, ExtractedInvoice } from "../lib/invoice-types";
import { baseCtx, danielStreet51329 } from "./fixtures/invoice-fixtures";

// Helpers: build what the reader would reply, then parse it for real.
type Raw = Record<string, unknown>;
const rline = (no: number, over: Raw): Raw => ({
  line_no: no, page: 1, item_code: null, description: `Line ${no}`, qty: null, unit: null, unit_price: null, line_total: null,
  basis: "ex", gst: "free", class_hint: "product", ...over,
});
const reply = (over: Raw, lines: Raw[]): Raw => ({
  doc_type: "invoice", supplier_name: "Test Supplier", supplier_abn: null, invoice_number: "T-1", invoice_date: "2026-10-22", due_date: null,
  bill_to: "Drift", ship_to: null, pages: [1], subtotal_ex: null, gst_total: null, total_inc: null, lines, notes: [], ...over,
});
const analyse = (r: Raw, ctx = baseCtx()) => analyseInvoice(parseExtracted(r), ctx);
const byNo = (lines: AnalysedLine[], no: number) => lines.find((l) => l.line_no === no) as AnalysedLine;
const failedNotes = (a: { recon_notes: { ok: boolean; message: string }[] }) => a.recon_notes.filter((n) => !n.ok).map((n) => n.message);
const okNotes = (a: { recon_notes: { ok: boolean; message: string }[] }) => a.recon_notes.filter((n) => n.ok).map((n) => n.message);
const cents = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- Markris: the Discount column is only information
describe("a printed Discount column the price already includes (Markris 791507 and friends)", () => {
  // Two taxable lines (the Amount column includes GST: basis ex, total_basis inc) and three GST free lines. Every line prints a
  // Discount percent, and every printed PRICE is already net of it, so qty x price is the line total.
  const markrisLines = (): Raw[] => [
    rline(1, { description: "ONE TREE - BAMBOO PADDLE SKEWER 150mm", qty: 1, unit_price: 6.57, discount_pct: 10, line_total: 7.23, total_basis: "inc", gst: "taxable" }),
    rline(2, { description: "Markris - Peanuts Crushed - 1kg", qty: 2, unit_price: 7.49, discount_pct: 25.03, line_total: 16.48, total_basis: "inc", gst: "taxable" }),
    rline(3, { description: "GAROFALO - LINGUINE PASTA No.12 - 500G", qty: 4, unit_price: 3.42, discount_pct: 10, line_total: 13.68 }),
    rline(4, { description: "S/Hurst - Chick Peas - A9 Tin", qty: 4, unit_price: 7.95, discount_pct: 25, line_total: 31.8 }),
    rline(5, { description: "Caboolture - Mozzarella Diced Shredded - (2 X 6kg) Ctn", qty: 2, unit_price: 148.86, discount_pct: 22, line_total: 297.72 }),
  ];
  // subtotal ex: 6.5727 + 14.9818 + 13.68 + 31.80 + 297.72 = 364.7545 ; GST on the two taxable lines 2.155 ; total 366.91
  const totals = { subtotal_ex: 364.75, gst_total: 2.16, total_inc: 366.91 };

  it("reading B: the printed prices are already net, the invoice reconciles, ONE note says so, and no discount is stored", () => {
    const a = analyse(reply(totals, markrisLines()));
    expect(failedNotes(a)).toEqual([]);
    expect(a.reconciled).toBe(true);
    expect(okNotes(a).filter((m) => m === "The printed prices already include the discount column.")).toHaveLength(1);
    for (let n = 1; n <= 5; n++) {
      const l = byNo(a.lines, n);
      expect(l.math_ok).toBe(true);
      expect(l).not.toHaveProperty("line_discount_ex");
      expect(l).not.toHaveProperty("discount_pct");
    }
    // the printed price is the real price, and the landed cost uses it as it is
    expect(byNo(a.lines, 3)).toMatchObject({ unit_price_ex: 3.42, line_total_ex: 13.68, landed_total_ex: 13.68, landed_unit_ex: 3.42 });
    expect(byNo(a.lines, 1)).toMatchObject({ unit_price_ex: 6.57, line_total_ex: 6.5727 });
  });

  it("the reader reporting a GST rate (10) in the discount column changes nothing: reading B resolves it", () => {
    const lines: Raw[] = markrisLines().map((l) => ({ ...l, discount_pct: 10 }));
    const a = analyse(reply(totals, lines));
    expect(a.reconciled).toBe(true);
    expect(byNo(a.lines, 4)).not.toHaveProperty("discount_pct");
    // but a GST rate parked in the column of a line that does NOT add up either way still fails
    lines[3].line_total = 33.0;
    const bad = analyse(reply({ ...totals, subtotal_ex: 366.0, total_inc: 368.16 }, lines));
    expect(bad.reconciled).toBe(false);
    expect(failedNotes(bad).some((m) => m.startsWith("S/Hurst - Chick Peas"))).toBe(true);
  });

  it("reading A still works: the discount comes off a list price (Your Mates, 345.00 less 20% is 276.00)", () => {
    const a = analyse(
      reply({ subtotal_ex: 296, gst_total: 29.6, total_inc: 325.6 }, [
        rline(1, { description: "Larry Pale Ale Keg 50L", qty: 1, unit_price: 345, discount_pct: 20, line_total: 276, gst: "taxable" }),
        rline(2, { description: "Delivery", qty: 1, unit_price: 20, line_total: 20, class_hint: "delivery", gst: "taxable" }),
      ]),
    );
    expect(a.reconciled).toBe(true);
    expect(byNo(a.lines, 1)).toMatchObject({ line_discount_ex: 69, discount_pct: 0.2 });
    expect(okNotes(a)).not.toContain("The printed prices already include the discount column.");
  });

  it("one invoice can hold both readings, line by line", () => {
    const a = analyse(
      reply({ subtotal_ex: 276 + 13.68, gst_total: 0, total_inc: 276 + 13.68 }, [
        rline(1, { description: "Keg on list price", qty: 1, unit_price: 345, discount_pct: 20, line_total: 276 }),
        rline(2, { description: "Pasta already net", qty: 4, unit_price: 3.42, discount_pct: 10, line_total: 13.68 }),
      ]),
    );
    expect(failedNotes(a)).toEqual([]);
    expect(byNo(a.lines, 1)).toMatchObject({ line_discount_ex: 69 });
    expect(byNo(a.lines, 2)).not.toHaveProperty("line_discount_ex");
    expect(okNotes(a).filter((m) => m.startsWith("The printed prices already include")).length).toBe(1);
  });

  it("neither reading fits: the line fails exactly as before, and says what it worked out", () => {
    const lines = markrisLines();
    lines[3].line_total = 29.8; // 4 x 7.95 = 31.80 (B) or 23.85 (A at 25%)
    const a = analyse(reply({ subtotal_ex: 362.75, gst_total: 2.16, total_inc: 364.91 }, lines));
    expect(a.reconciled).toBe(false);
    expect(failedNotes(a)).toContain("S/Hurst - Chick Peas - A9 Tin: 4 x $7.95 less 25% is $23.85 but the line says $29.80.");
    expect(byNo(a.lines, 4).math_ok).toBe(false);
  });

  it("both readings fit (a tiny discount): reading B wins, so no discount is stored", () => {
    // 1 x 1.00 less 1% is 0.99, and 1.00 against 0.99 is inside the 2c tolerance
    const a = analyse(reply({ subtotal_ex: 0.99, gst_total: 0, total_inc: 0.99 }, [rline(1, { description: "Tiny", qty: 1, unit_price: 1, discount_pct: 1, line_total: 0.99 })]));
    expect(a.reconciled).toBe(true);
    expect(byNo(a.lines, 1)).not.toHaveProperty("line_discount_ex");
  });

  it("the same dual test applies to a discount in dollars", () => {
    const net = analyse(reply({ subtotal_ex: 40, gst_total: 0, total_inc: 40 }, [rline(1, { description: "Informational", qty: 4, unit_price: 10, discount_amount: 5, line_total: 40 })]));
    expect(net.reconciled).toBe(true);
    expect(byNo(net.lines, 1)).not.toHaveProperty("line_discount_ex");
    const off = analyse(reply({ subtotal_ex: 35, gst_total: 0, total_inc: 35 }, [rline(1, { description: "Real", qty: 4, unit_price: 10, discount_amount: 5, line_total: 35 })]));
    expect(off.reconciled).toBe(true);
    expect(byNo(off.lines, 1)).toMatchObject({ line_discount_ex: 5 });
    const wrong = analyse(reply({ subtotal_ex: 37, gst_total: 0, total_inc: 37 }, [rline(1, { description: "Wrong", qty: 4, unit_price: 10, discount_amount: 5, line_total: 37 })]));
    expect(wrong.reconciled).toBe(false);
  });

  it("the reader is told that a Discount column the price already includes is informational", () => {
    expect(READ_SYSTEM).toMatch(/informational/);
    expect(READ_SYSTEM).toMatch(/never put any other column/);
    expect(READ_SYSTEM).not.toMatch(/[–—]/);
  });

  it("reconcile() reports the line as a price_net inference with a patch that clears the discount", () => {
    const amounts = lineAmounts({ unit_price: 3.42, line_total: 13.68, basis: "ex", gst: "free" }, 0.1);
    const r = reconcile({
      lines: [{ index: 0, line_class: "product", description: "Pasta", qty: 4, unit_price: 3.42, line_total: 13.68, basis: "ex", gst: "free", amounts, discount_pct: 10 }],
      gstRate: 0.1, subtotal_ex: 13.68, gst_total: 0, total_inc: 13.68,
    });
    expect(r.reconciled).toBe(true);
    expect(r.inferred.get(0)).toMatchObject({ kind: "price_net", patch: { discount_pct: 0, discount_amount: 0 } });
  });
});

// ---------------------------------------------------------------- safety: the dual reading never excuses a wrong line
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

describe("safety: a line with a printed discount that neither reading explains always fails", () => {
  it("400 random lines: the total is neither qty x price nor qty x price less the discount (within tolerance)", () => {
    const rnd = prng(20261025);
    let tried = 0;
    for (let n = 0; n < 400; n++) {
      const qty = 1 + Math.floor(rnd() * 12);
      const price = cents(2 + rnd() * 120);
      const pct = rnd() < 0.5 ? Math.round(rnd() * 400) / 10 : cents(rnd() * 60); // clean or odd, like 25.03
      const gross = qty * price;
      const tol = lineTolerance(qty);
      const netA = gross * (1 - pct / 100);
      const factor = rnd() < 0.5 ? 1 + (0.012 + rnd() * 0.4) : 1 - (0.012 + rnd() * 0.45);
      const total = cents(gross * factor);
      // skip the cases an honest reading explains (A or B within tolerance), and anything an unlabelled-discount inference could never reach
      if (Math.abs(total - gross) <= tol + 0.011 || Math.abs(total - netA) <= tol + 0.011) continue;
      tried += 1;
      const rest = cents(40 + rnd() * 60);
      const ls = [
        rline(1, { description: "Altered", qty, unit_price: price, discount_pct: pct, line_total: total }),
        rline(2, { description: "Honest", qty: 1, unit_price: rest, line_total: rest }),
      ];
      // the printed totals are rebuilt to match the altered line, the friendliest case for a wrong reading
      const sub = cents(total + rest);
      const a = analyse(reply({ subtotal_ex: sub, gst_total: 0, total_inc: sub }, ls));
      expect(a.reconciled, `${qty} x ${price} less ${pct}% shown as ${total}`).toBe(false);
      expect(byNo(a.lines, 1).math_ok).toBe(false);
    }
    expect(tried).toBeGreaterThan(300);
  });

  it("400 random lines where reading B is true: they pass, and where A is true: they pass with the discount stored", () => {
    const rnd = prng(77);
    for (let n = 0; n < 400; n++) {
      const qty = 1 + Math.floor(rnd() * 12);
      const price = cents(2 + rnd() * 120);
      const pct = cents(5 + rnd() * 40);
      const useB = rnd() < 0.5;
      const total = cents(useB ? qty * price : qty * price * (1 - pct / 100));
      const a = analyse(reply({ subtotal_ex: total, gst_total: 0, total_inc: total }, [rline(1, { description: "L", qty, unit_price: price, discount_pct: pct, line_total: total })]));
      expect(a.reconciled, `${qty} x ${price} ${pct}% ${useB ? "B" : "A"} ${total}`).toBe(true);
      const l = byNo(a.lines, 1);
      if (useB) expect(l).not.toHaveProperty("line_discount_ex");
    }
  });
});

// ---------------------------------------------------------------- Suncoast Fresh: one consistent unlabelled discount
describe("an unlabelled discount that is the same on every line, with cents rounding (Suncoast Fresh)", () => {
  // 3437133 as stored: every product line is 2.5% under qty x price; the egg line is at full price; a taxable fuel levy.
  const productLines = (): Raw[] => [
    rline(1, { description: "ORANGES JUICING KG", qty: 2.2, unit: "KG", unit_price: 2.7, line_total: 5.79 }),
    rline(2, { description: "CORN EA", qty: 8, unit: "EA", unit_price: 2.45, line_total: 19.11 }),
    rline(3, { description: "EGGS (CATERING) CTN", qty: 1, unit: "CTN", unit_price: 62.5, line_total: 62.5 }),
    rline(4, { description: "ONIONS RED KG", qty: 2.28, unit: "KG", unit_price: 3, line_total: 6.67 }),
    rline(5, { description: "POTATO DESIREE KG", qty: 8.3, unit: "KG", unit_price: 3.8, line_total: 30.75 }),
    rline(6, { description: "ITALIAN PARSLEY BCH", qty: 6, unit: "BCH", unit_price: 2.75, line_total: 16.09 }),
    rline(7, { description: "MINT BCH", qty: 1, unit: "BCH", unit_price: 3.5, line_total: 3.41 }),
  ];
  const fuel = rline(8, { description: "FUEL LEVY (*)", line_total: 3.3, gst: "taxable", class_hint: "fee" });
  // lines add up to 144.32 + 3.30 = 147.62 ; GST 0.33 ; total 147.95
  const good = { subtotal_ex: 147.62, gst_total: 0.33, total_inc: 147.95 };

  it("accepts 2.5% on every failing line when the subtotal, GST and total all agree, and stores the discount", () => {
    const a = analyse(reply(good, [...productLines(), fuel]));
    expect(failedNotes(a)).toEqual([]);
    expect(a.reconciled).toBe(true);
    for (const n of [1, 2, 4, 5, 6, 7]) {
      expect(byNo(a.lines, n).math_ok).toBe(true);
      expect(byNo(a.lines, n).discount_pct).toBeCloseTo(0.025, 2);
    }
    expect(byNo(a.lines, 3)).not.toHaveProperty("discount_pct"); // the full price line is untouched
    expect(okNotes(a).some((m) => m.includes("MINT BCH") || m.includes("Mint Bch"))).toBe(true);
    expect(okNotes(a).some((m) => m.includes("2.5% off $3.50 is $3.41"))).toBe(true);
  });

  it("Suncoast 3431556 shape: only a total and GST printed (no subtotal) is still enough, with the small herb lines (4.60 to 4.48)", () => {
    const lines = [
      rline(1, { description: "Micro Herb Red Vein Sorrel", qty: 1, unit_price: 4.6, line_total: 4.48 }),
      rline(2, { description: "Mint Bch", qty: 1, unit_price: 3.5, line_total: 3.41 }),
      rline(3, { description: "Mushroom Button Ctn", qty: 1, unit_price: 45, line_total: 43.88 }),
      fuel,
    ];
    const sum = 4.48 + 3.41 + 43.88 + 3.3;
    const a = analyse(reply({ subtotal_ex: null, gst_total: 0.33, total_inc: cents(sum + 0.33) }, lines));
    expect(failedNotes(a)).toEqual([]);
    expect(a.reconciled).toBe(true);
  });

  it("3437133 as printed: the subtotal leaves out the fuel levy, so the invoice stays unreconciled", () => {
    // 144.32 is the product lines only; the levy is added after the subtotal (144.32 + 3.30 + 0.33 = 147.95). The checks add every
    // line to the subtotal, so this one still needs a person. It is NOT forced.
    const a = analyse(reply({ subtotal_ex: 144.32, gst_total: 0.33, total_inc: 147.95 }, [...productLines(), fuel]));
    expect(a.reconciled).toBe(false);
    const failed = failedNotes(a);
    expect(failed.some((m) => m.startsWith("The lines add up to $147.62 but the invoice subtotal says $144.32"))).toBe(true);
    // the discount is believed only when the whole document agrees; here the subtotal does not, so the lines are not excused either
    expect(failed.some((m) => m.includes(" but the line says "))).toBe(true);
  });

  it("rejected when the lines disagree (one line is 5% under, the rest 2.5%)", () => {
    const lines = productLines();
    lines[1] = rline(2, { description: "CORN EA", qty: 8, unit: "EA", unit_price: 2.45, line_total: 18.62 }); // 5% off 19.60
    const sub = cents(5.79 + 18.62 + 62.5 + 6.67 + 30.75 + 16.09 + 3.41 + 3.3);
    const a = analyse(reply({ subtotal_ex: sub, gst_total: 0.33, total_inc: cents(sub + 0.33) }, [...lines, fuel]));
    expect(a.reconciled).toBe(false);
    expect(failedNotes(a).some((m) => m.includes("CORN EA") || m.includes("Corn Ea"))).toBe(true);
  });

  it("rejected when the document does not reconcile with that reading", () => {
    const a = analyse(reply({ subtotal_ex: 150.0, gst_total: 0.33, total_inc: 150.33 }, [...productLines(), fuel]));
    expect(a.reconciled).toBe(false);
    expect(failedNotes(a).some((m) => m.includes(" but the line says "))).toBe(true);
  });

  it("rejected when nothing printed backs it (no subtotal or total, only GST)", () => {
    const a = analyse(reply({ subtotal_ex: null, gst_total: 0.33, total_inc: null }, [...productLines(), fuel]));
    expect(a.reconciled).toBe(false);
    expect(failedNotes(a).some((m) => m.includes(" but the line says "))).toBe(true);
  });

  it("a lone line must still sit very close to a clean percent (a 1.7% shortfall is not 1.5%)", () => {
    // 100 x 1.00 = 100.00; 98.30 is 1.7% under: the dollar test alone would let 1.5% (98.50, 20c away) through at a 51c tolerance
    const a = analyse(reply({ subtotal_ex: 98.3, gst_total: 0, total_inc: 98.3 }, [rline(1, { description: "Bulk", qty: 100, unit_price: 1, line_total: 98.3 })]));
    expect(a.reconciled).toBe(false);
  });
});

// ---------------------------------------------------------------- the invoices that MUST keep failing
describe("invoices that must keep failing", () => {
  it("Daniel Street 51329: the barramundi line still does not add up", () => {
    const a = analyseInvoice(danielStreet51329(), baseCtx());
    expect(a.reconciled).toBe(false);
    expect(failedNotes(a).some((m) => m.includes("Barramundi") && m.includes("but the line says $98.98"))).toBe(true);
  });

  it("Daniel Street 9764204: kingfish per side 1.31 x 68.90 shows 89.91 (0.4% under, not a discount)", () => {
    const a = analyse(
      reply({ subtotal_ex: 251.35, gst_total: 0.59, total_inc: 251.94 }, [
        rline(1, { description: "KINGFISH FILLETS SKIN ON WING OFF PER SIDE", qty: 1.31, unit: "KG", unit_price: 68.9, line_total: 89.91 }),
        rline(2, { description: "Other fish", qty: 1, unit_price: 161.44, line_total: 161.44 }),
      ]),
    );
    expect(a.reconciled).toBe(false);
    expect(failedNotes(a).some((m) => m.includes("1.31 x $68.90") && m.includes("$89.91"))).toBe(true);
  });

  it("Paramount 5689234: a reading kept from the second, stronger pass is never reconciled", () => {
    const ex = reply({ subtotal_ex: null, gst_total: 57.97, total_inc: 637.66 }, [
      rline(1, { description: "Spirit", qty: 1, unit_price: 579.69, line_total: 579.69, gst: "taxable" }),
    ]);
    const normal = analyse(ex);
    expect(normal.reconciled).toBe(true);
    const hinted = analyseInvoice(parseExtracted(ex), { ...baseCtx(), hintedReread: true } as ReturnType<typeof baseCtx>);
    expect(hinted.reconciled).toBe(false);
    expect(failedNotes(hinted).some((m) => m.includes("read twice"))).toBe(true);
  });

  it("Markris 793634: every line adds up, but no totals are printed anywhere", () => {
    const a = analyse(
      reply({}, [
        rline(1, { description: "Pasta", qty: 4, unit_price: 3.42, discount_pct: 10, line_total: 13.68 }),
        rline(2, { description: "Chick Peas", qty: 4, unit_price: 7.95, discount_pct: 25, line_total: 31.8 }),
      ]),
    );
    expect(a.reconciled).toBe(false);
    expect(failedNotes(a)).toEqual(["The invoice shows no subtotal, GST or total to check the lines against, so it cannot be proven to add up."]);
  });

  it("Markris 793383: the lines (read two ways now) add up to far less than the subtotal, whose lines are in another scan", () => {
    const a = analyse(
      reply({ subtotal_ex: 1089.32, gst_total: 0.96, total_inc: 1090.28 }, [
        rline(1, { description: "Madam Wong - Coconut Meat Shredded Frozen - 500g", qty: 5, unit_price: 9.32, discount_pct: 10, line_total: 46.6 }),
        rline(2, { description: "Spring Roll Wraps - 8.5 Inch", qty: 20, unit_price: 2.34, discount_pct: 10, line_total: 46.8 }),
        rline(3, { description: "EDGELL - SHOESTRING 7mm G/FREE FRIES", qty: 2, unit_price: 47.14, discount_pct: 25, line_total: 94.28 }),
      ]),
    );
    expect(a.reconciled).toBe(false);
    expect(failedNotes(a).some((m) => m.startsWith("The lines add up to $187.68 but the invoice subtotal says $1,089.32"))).toBe(true);
    expect(byNo(a.lines, 1).math_ok).toBe(true); // the discount column no longer fails the line itself
  });
});

// keep the type import used
const _check: ExtractedInvoice | null = null;
void _check;
