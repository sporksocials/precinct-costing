import { describe, expect, it } from "vitest";
import { documentPriceBasis, lineAmounts, reconcile } from "../lib/invoice-recon";
import type { ReconInput, ReconLine } from "../lib/invoice-recon";
import type { ExtractedLine, GstFlag, LineClass } from "../lib/invoice-types";

const RATE = 0.1;

function rl(
  index: number,
  over: Partial<{ cls: LineClass; description: string; qty: number | null; price: number | null; total: number | null; basis: "ex" | "inc"; gst: GstFlag }> = {},
): ReconLine {
  const basis = over.basis ?? "ex";
  const gst = over.gst ?? "taxable";
  const price = over.price === undefined ? null : over.price;
  const total = over.total === undefined ? null : over.total;
  return {
    index, line_class: over.cls ?? "product", description: over.description ?? `Line ${index}`, qty: over.qty ?? null,
    unit_price: price, line_total: total, basis, gst, amounts: lineAmounts({ unit_price: price, line_total: total, basis, gst }, RATE),
  };
}

const input = (lines: ReconLine[], printed: Partial<Pick<ReconInput, "subtotal_ex" | "gst_total" | "total_inc">>): ReconInput => ({
  lines, gstRate: RATE, subtotal_ex: null, gst_total: null, total_inc: null, ...printed,
});

describe("lineAmounts (price basis)", () => {
  const L = (basis: "ex" | "inc", gst: GstFlag, price: number | null, total: number | null): Pick<ExtractedLine, "unit_price" | "line_total" | "basis" | "gst"> => ({ unit_price: price, line_total: total, basis, gst });

  it("keeps an ex GST price as printed", () => {
    const a = lineAmounts(L("ex", "taxable", 38.62, 77.24), RATE);
    expect(a).toMatchObject({ unit_price_ex: 38.62, line_total_ex: 77.24, gst_amount: 7.724, convertible: true });
  });

  it("divides an inc GST price on a taxable line by 1.1, keeping four decimals", () => {
    const a = lineAmounts(L("inc", "taxable", 6.5, 6.5), RATE);
    expect(a.unit_price_ex).toBe(5.9091);
    expect(a.line_total_ex).toBe(5.9091);
    expect(a.gst_amount).toBe(0.5909);
  });

  it("takes an inc GST price on a GST free line as already ex", () => {
    const a = lineAmounts(L("inc", "free", 68.9, 127.47), RATE);
    expect(a).toMatchObject({ unit_price_ex: 68.9, line_total_ex: 127.47, gst_amount: 0, convertible: true });
  });

  it("cannot convert an inc GST price with unknown GST: leaves it null and says so", () => {
    const a = lineAmounts(L("inc", "unknown", 11, 22), RATE);
    expect(a).toMatchObject({ unit_price_ex: null, line_total_ex: null, gst_amount: null, convertible: false });
  });

  it("reads an ex GST price with unknown GST (only the GST amount is unknown)", () => {
    const a = lineAmounts(L("ex", "unknown", 10, 20), RATE);
    expect(a).toMatchObject({ unit_price_ex: 10, line_total_ex: 20, gst_amount: null, convertible: true });
  });

  it("a line with no price at all is still convertible", () => {
    expect(lineAmounts(L("inc", "unknown", null, null), RATE).convertible).toBe(true);
  });

  it("document price basis is ex, inc or mixed", () => {
    expect(documentPriceBasis([{ unit_price: 1, line_total: 1, basis: "ex" }])).toBe("ex");
    expect(documentPriceBasis([{ unit_price: 1, line_total: 1, basis: "inc" }])).toBe("inc");
    expect(documentPriceBasis([{ unit_price: 1, line_total: 1, basis: "inc" }, { unit_price: null, line_total: 2, basis: "ex" }])).toBe("mixed");
    expect(documentPriceBasis([{ unit_price: null, line_total: null, basis: "ex" }])).toBeNull();
  });
});

describe("reconcile", () => {
  it("passes a clean ex GST invoice (Diablo ENV-23585)", () => {
    const r = reconcile(
      input(
        [rl(0, { qty: 1, price: 359, total: 359 }), rl(1, { qty: 2, price: 38.62, total: 77.24 })],
        { subtotal_ex: 436.24, gst_total: 43.62, total_inc: 479.86 },
      ),
    );
    expect(r.reconciled).toBe(true);
    expect(r.notes.every((n) => n.ok)).toBe(true);
    expect(r.mathOk.get(0)).toBe(true);
    expect(r.mathOk.get(1)).toBe(true);
  });

  it("fails the Daniel Street #51329 barramundi line with a message a person understands", () => {
    const lines = [
      rl(0, { description: "Kingfish fillets skin on wing off per kg", qty: 1.85, price: 68.9, total: 127.47, gst: "free" }),
      rl(1, { description: "Humpty Doo Barramundi fillets per kg", qty: 2.39, price: 41.54, total: 98.98, gst: "free" }),
      rl(2, { cls: "credit", description: "Barramundi credit", total: -16.45, gst: "free" }),
      rl(3, { cls: "delivery", description: "Delivery order over $200", qty: 1, price: 6.5, total: 6.5, basis: "inc", gst: "taxable" }),
    ];
    const r = reconcile(input(lines, { subtotal_ex: 215.91, gst_total: 0.59, total_inc: 216.5 }));
    expect(r.reconciled).toBe(false);
    expect(r.mathOk.get(0)).toBe(true);
    expect(r.mathOk.get(1)).toBe(false);
    const bad = r.notes.filter((n) => !n.ok);
    expect(bad).toHaveLength(1);
    expect(bad[0].check).toBe("line_math");
    expect(bad[0].message).toBe("Humpty Doo Barramundi fillets: 2.39 x $41.54 is $99.28 but the line says $98.98.");
    // the subtotal, GST and total all agree once the delivery is read ex GST
    expect(r.notes.filter((n) => n.ok).map((n) => n.check)).toEqual(expect.arrayContaining(["subtotal", "gst", "total"]));
  });

  it("allows 2c on a line and 5c on the sums, and no more", () => {
    const ok = reconcile(input([rl(0, { qty: 3, price: 1.11, total: 3.35 })], { subtotal_ex: 3.4 }));
    expect(ok.reconciled).toBe(true);
    const lineBad = reconcile(input([rl(0, { qty: 3, price: 1.11, total: 3.37 })], { subtotal_ex: 3.37 }));
    expect(lineBad.mathOk.get(0)).toBe(false);
    expect(lineBad.reconciled).toBe(false);
    const subBad = reconcile(input([rl(0, { qty: 1, price: 10, total: 10 })], { subtotal_ex: 10.06 }));
    expect(subBad.reconciled).toBe(false);
    expect(subBad.notes.find((n) => !n.ok)?.message).toBe("The lines add up to $10.00 but the invoice subtotal says $10.06.");
  });

  it("fails when the printed GST is not the rate on the taxable lines", () => {
    const r = reconcile(input([rl(0, { qty: 1, price: 100, total: 100 })], { subtotal_ex: 100, gst_total: 12, total_inc: 112 }));
    expect(r.reconciled).toBe(false);
    expect(r.notes.find((n) => n.check === "gst" && !n.ok)?.message).toBe("GST on the taxable lines works out at $10.00 but the invoice says $12.00.");
  });

  it("fails when the total is not the subtotal plus GST", () => {
    const r = reconcile(input([rl(0, { qty: 1, price: 100, total: 100 })], { subtotal_ex: 100, gst_total: 10, total_inc: 111 }));
    expect(r.reconciled).toBe(false);
    expect(r.notes.find((n) => n.check === "total" && !n.ok)).toBeTruthy();
  });

  it("an invoice with no printed subtotal, GST or total cannot be proven", () => {
    const r = reconcile(input([rl(0, { qty: 1, price: 10, total: 10 })], {}));
    expect(r.reconciled).toBe(false);
    expect(r.notes.some((n) => !n.ok && /cannot be proven/.test(n.message))).toBe(true);
  });

  it("a product line with neither a price nor a total makes the invoice unreconciled", () => {
    const r = reconcile(input([rl(0, { description: "Mystery item", qty: 1 }), rl(1, { qty: 1, price: 10, total: 10 })], { subtotal_ex: 10 }));
    expect(r.reconciled).toBe(false);
    expect(r.notes.find((n) => !n.ok)?.message).toBe("Mystery item: no price or total could be read.");
  });

  it("a line without a quantity is not maths-checked (null), and does not fail the invoice by itself", () => {
    const r = reconcile(input([rl(0, { price: 10, total: 10 })], { subtotal_ex: 10 }));
    expect(r.mathOk.get(0)).toBeNull();
    expect(r.reconciled).toBe(true);
  });

  it("zero quantity with a zero total passes; zero quantity with a total fails", () => {
    expect(reconcile(input([rl(0, { qty: 0, price: 10, total: 0 })], { subtotal_ex: 0 })).mathOk.get(0)).toBe(true);
    expect(reconcile(input([rl(0, { qty: 0, price: 10, total: 10 })], { subtotal_ex: 10 })).mathOk.get(0)).toBe(false);
  });

  it("an inc GST invoice reconciles once converted", () => {
    // 3 x $11.00 inc = $33.00 inc = $30.00 ex; GST $3.00; total $33.00
    const r = reconcile(input([rl(0, { qty: 3, price: 11, total: 33, basis: "inc", gst: "taxable" })], { subtotal_ex: 30, gst_total: 3, total_inc: 33 }));
    expect(r.reconciled).toBe(true);
  });

  it("an unreadable GST status on an inc GST price fails the invoice and says why", () => {
    const r = reconcile(input([rl(0, { description: "Cream", qty: 1, price: 11, total: 11, basis: "inc", gst: "unknown" })], { total_inc: 11 }));
    expect(r.reconciled).toBe(false);
    expect(r.notes[0].message).toBe("Cream: the invoice does not say whether GST is included in this price, so it cannot be read.");
  });

  it("unknown GST on an ex GST line blocks the GST check but not the line maths", () => {
    const r = reconcile(input([rl(0, { qty: 2, price: 10, total: 20, gst: "unknown" })], { subtotal_ex: 20, gst_total: 2 }));
    expect(r.mathOk.get(0)).toBe(true);
    expect(r.reconciled).toBe(false);
    expect(r.notes.some((n) => n.check === "gst" && !n.ok)).toBe(true);
  });

  it("mixed GST: only the taxable lines carry GST", () => {
    const lines = [rl(0, { qty: 1, price: 100, total: 100, gst: "free" }), rl(1, { qty: 1, price: 50, total: 50, gst: "taxable" })];
    expect(reconcile(input(lines, { subtotal_ex: 150, gst_total: 5, total_inc: 155 })).reconciled).toBe(true);
    expect(reconcile(input(lines, { subtotal_ex: 150, gst_total: 15, total_inc: 165 })).reconciled).toBe(false);
  });

  it("negative lines (credits, discounts) count in the sums", () => {
    const lines = [rl(0, { qty: 2, price: 50, total: 100 }), rl(1, { cls: "discount", description: "Discount", total: -10 })];
    expect(reconcile(input(lines, { subtotal_ex: 90, gst_total: 9, total_inc: 99 })).reconciled).toBe(true);
  });

  it("with only the total printed, the lines plus computed GST must reach it", () => {
    const lines = [rl(0, { qty: 1, price: 100, total: 100 })];
    expect(reconcile(input(lines, { total_inc: 110 })).reconciled).toBe(true);
    expect(reconcile(input(lines, { total_inc: 115 })).reconciled).toBe(false);
  });

  it("with the subtotal and total but no GST printed, the total is checked against computed GST", () => {
    const lines = [rl(0, { qty: 1, price: 100, total: 100 })];
    expect(reconcile(input(lines, { subtotal_ex: 100, total_inc: 110 })).reconciled).toBe(true);
    expect(reconcile(input(lines, { subtotal_ex: 100, total_inc: 100 })).reconciled).toBe(false);
  });
});
