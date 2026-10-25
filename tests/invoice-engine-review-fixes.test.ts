// Regression tests for the independent review of the invoice engine (24 Oct 2026): each one fails on the engine as it was.
import { describe, expect, it } from "vitest";
import { analyseInvoice } from "../lib/invoice-engine";
import type { AnalyseConfirmations } from "../lib/invoice-engine";
import { findDuplicate, matchSupplier } from "../lib/invoice-match";
import { normInvoiceNumber } from "../lib/invoice-names";
import { resolvePacks } from "../lib/invoice-units";
import type { AnalyseContext, ExtractedInvoice } from "../lib/invoice-types";
import { DRIFT, SUP_DS, baseCtx, danielStreet51329Fixed, ing, line, mapRow, prod, supplierDS } from "./fixtures/invoice-fixtures";

const kingfish = (a: ReturnType<typeof analyseInvoice>) => a.lines.find((l) => l.line_no === 1)!;

describe("S3: an invoice from one supplier does not move a price costed on another", () => {
  const star = supplierDS({ id: "sup-star", name: "Star", abn: null, cost_supplier_id: 1 });
  const para = supplierDS({ id: "sup-para", name: "Paramount", abn: null, cost_supplier_id: 2, auto_apply: true });
  const vodka = (over: Partial<Parameters<typeof ing>[0]> = {}) =>
    ing({ id: "ing-vodka", name: "Vodka (700ml)", supplier_id: 1, supplier_code: "STAR1", pack_size: 700, pack_unit: "ml", pack_price: 50, price_inc_gst: true, last_price_update: "2026-10-01", ...over });
  const paraInvoice = (unitPrice: number): ExtractedInvoice => {
    const d = danielStreet51329Fixed();
    d.supplier_name = "Paramount"; d.supplier_abn = null; d.invoice_number = "P1";
    d.lines = [line({ line_no: 1, item_code: "P-77", description: "Cheap vodka 700ml", qty: 1, unit: "EA", unit_price: unitPrice, line_total: unitPrice, gst: "taxable", class_hint: "product" })];
    d.subtotal_ex = unitPrice; d.gst_total = Math.round(unitPrice * 10) / 100; d.total_inc = Math.round(unitPrice * 110) / 100;
    return d;
  };
  const ctxFor = (ingredient: ReturnType<typeof vodka>): AnalyseContext =>
    baseCtx({ suppliers: [star, para], ingredients: [ingredient], products: [], maps: [mapRow({ supplier_id: "sup-para", item_code: "P-77", ingredient_id: "ing-vodka", packs_per_unit: 1 })] });
  const REASON = "This ingredient is costed on a different supplier's price, so this invoice should not change it on its own.";

  it("a small change from the other supplier waits for a person", () => {
    // 43.30 ex is 47.63 inc, 4.7% under Star's 50
    const l = kingfish(analyseInvoice(paraInvoice(43.3), ctxFor(vodka())));
    expect(l.decision).toBe("needs_approval");
    expect(l.decision_reason).toBe(REASON);
  });

  it("an equal price from the other supplier is not confirmed either", () => {
    // 45.4545 ex is 50.00 inc
    const l = kingfish(analyseInvoice(paraInvoice(45.4545), ctxFor(vodka())));
    expect(l.decision).toBe("none");
    expect(l.decision_reason).toContain("The price matches, but it is not confirmed: this ingredient is costed on a different supplier's price");
  });

  it("an ingredient with no costing supplier at all is treated the same way", () => {
    const l = kingfish(analyseInvoice(paraInvoice(43.3), ctxFor(vodka({ supplier_id: null }))));
    expect(l.decision).toBe("needs_approval");
    expect(l.decision_reason).toBe(REASON);
  });

  it("a supplier with no costing supplier link cannot auto apply onto an ingredient", () => {
    const loose = supplierDS({ id: "sup-para", name: "Paramount", abn: null, cost_supplier_id: null, auto_apply: true });
    const ctx = ctxFor(vodka());
    const l = kingfish(analyseInvoice(paraInvoice(43.3), { ...ctx, suppliers: [star, loose] }));
    expect(l.decision).toBe("needs_approval");
    expect(l.decision_reason).toBe(REASON);
  });

  it("when the ingredient is costed on the invoice's own supplier it still applies", () => {
    const l = kingfish(analyseInvoice(paraInvoice(43.3), ctxFor(vodka({ supplier_id: 2 }))));
    expect(l.decision).toBe("apply");
  });

  it("an ordering product alone (no ingredient) is not stopped by this rule", () => {
    const p = prod({ id: "p-v", name: "Vodka", supplier_item_code: "P-77", supplier_name: "Paramount", unit_name: "each", price_inc_gst: 50, venue_id: DRIFT });
    const ctx = baseCtx({ suppliers: [star, para], ingredients: [], products: [p], maps: [] });
    const l = kingfish(analyseInvoice(paraInvoice(43.3), ctx));
    // an ordering product has no last_price_update, so it still waits, but never for the costed supplier reason
    expect(l.new_product_price).toBe(47.63);
    expect(l.decision_reason).not.toBe(REASON);
  });
});

describe("S5: a saved match that never stated its packs is not read as 1", () => {
  const gin = ing({ id: "ing-gin", name: "Gin (700ml)", supplier_id: 7, supplier_code: "GIN1", pack_size: 700, pack_unit: "ml", pack_price: 30 });
  const ginInvoice = (): ExtractedInvoice => {
    const d = danielStreet51329Fixed();
    d.lines = [line({ line_no: 1, item_code: "GIN1", description: "Gin 6 x 700ml", qty: 2, unit: "CTN", unit_price: 186, line_total: 372, class_hint: "product" })];
    d.subtotal_ex = 372; d.gst_total = 37.2; d.total_inc = 409.2;
    return d;
  };

  it("a map row with packs_per_unit null leaves the pack unknown and asks", () => {
    const map = mapRow({ supplier_id: SUP_DS, item_code: "GIN1", ingredient_id: "ing-gin", packs_per_unit: null });
    const a = analyseInvoice(ginInvoice(), baseCtx({ maps: [map], ingredients: [gin], products: [] }));
    const l = kingfish(a);
    expect(l).toMatchObject({ packs_per_unit: null, new_pack_price: null, decision: "needs_approval", decision_reason: "The pack size for this unit is not known." });
    expect(a.questions.some((q) => q.kind === "unit_unclear")).toBe(true);
  });

  it("a null map value falls through to the ordering product's stated packs", () => {
    const p = prod({ id: "p-gin", name: "Gin", unit_name: "carton", costing_packs_per_unit: 6 });
    expect(resolvePacks({ mapPacks: null, product: p, ingredient: gin, invoiceUnit: "CTN" })).toMatchObject({ packs: 6, source: "product" });
  });

  it("a blank costing_packs_per_unit on the ordering product is unknown, not 1", () => {
    const p = prod({ id: "p-gin", name: "Gin", unit_name: "carton", costing_packs_per_unit: null, price_inc_gst: 200, supplier_item_code: "GIN1", supplier_name: "Daniel Street Fish Market", ingredient_id: "ing-gin" });
    expect(resolvePacks({ mapPacks: null, product: p, ingredient: gin, invoiceUnit: "CTN" })).toMatchObject({ packs: null, source: "none", conflict: null });
    const a = analyseInvoice(ginInvoice(), baseCtx({ ingredients: [gin], products: [p] }));
    const l = kingfish(a);
    // the ordering price could be read, but the ingredient's pack is unknown, so the whole line waits for an answer
    expect(l.packs_per_unit).toBeNull();
    expect(l.decision).toBe("needs_approval");
    expect(a.questions.some((q) => q.kind === "unit_unclear")).toBe(true);
  });

  it("a certain derivation still works with no saved packs (a kilo against a kilo pack)", () => {
    const a = analyseInvoice(danielStreet51329Fixed(), baseCtx({ maps: [mapRow({ supplier_id: SUP_DS, item_code: "15026", ingredient_id: "ing-kingfish", packs_per_unit: null })] }));
    expect(kingfish(a).packs_per_unit).toBe(1);
  });
});

describe("S8: an old invoice is never automatic", () => {
  const run = (date: string, last: string, over: Partial<AnalyseContext> = {}) => {
    const d = danielStreet51329Fixed();
    d.invoice_date = date;
    const king = ing({ id: "ing-kingfish", name: "Kingfish Fillets (1kg)", supplier_id: 7, supplier_code: "15026", pack_price: 66.5, gst_free: true, last_price_update: last });
    return analyseInvoice(d, baseCtx({ ingredients: [king], products: [], ...over }));
  };

  it("an invoice from February scanned on 24 October waits for a person", () => {
    const l = kingfish(run("2026-02-15", "2026-01-10"));
    expect(l.decision).toBe("needs_approval");
    expect(l.decision_reason).toBe("This invoice is more than 45 days old, so a person should check it before its prices are used.");
  });

  it("45 days old is still fine, 46 is not", () => {
    expect(kingfish(run("2026-09-09", "2026-09-01")).decision).toBe("apply");
    expect(kingfish(run("2026-09-08", "2026-09-01")).decision).toBe("needs_approval");
  });

  it("an old invoice does not confirm an equal price either", () => {
    const d = danielStreet51329Fixed();
    d.invoice_date = "2026-02-15";
    d.lines[0].unit_price = 66.5; d.lines[0].line_total = 123.03;
    const king = ing({ id: "ing-kingfish", name: "K", supplier_id: 7, supplier_code: "15026", pack_price: 66.5, gst_free: true, last_price_update: "2026-01-10" });
    const a = analyseInvoice(d, baseCtx({ ingredients: [king], products: [] }));
    expect(kingfish(a).decision).not.toBe("same");
  });
});

describe("M4: a hinted second reading is never automatic", () => {
  it("adds a failing note, marks the invoice unreconciled and stops every line", () => {
    const ctx = { ...baseCtx(), hintedReread: true } as AnalyseContext & AnalyseConfirmations;
    const a = analyseInvoice(danielStreet51329Fixed(), ctx);
    expect(a.reconciled).toBe(false);
    const note = a.recon_notes.find((n) => n.check === "other" && !n.ok);
    expect(note?.message).toBe("This invoice was read twice because the first reading did not add up. A person needs to check the numbers before any price is used.");
    expect(a.lines.filter((l) => l.line_class === "product").every((l) => l.decision !== "apply" && l.decision !== "same")).toBe(true);
    expect(kingfish(a).decision_reason).toBe("Invoice does not add up.");
  });

  it("the same invoice without the flag applies", () => {
    const a = analyseInvoice(danielStreet51329Fixed(), baseCtx());
    expect(a.reconciled).toBe(true);
    expect(kingfish(a).decision).toBe("apply");
    expect(a.recon_notes.some((n) => n.check === "other")).toBe(false);
  });
});

describe("M6: duplicates survive a different way of writing the number", () => {
  it("normalises the number", () => {
    expect(normInvoiceNumber("INV-51329")).toBe("51329");
    expect(normInvoiceNumber("#0051329")).toBe("51329");
    expect(normInvoiceNumber("51329")).toBe("51329");
    expect(normInvoiceNumber("Tax Invoice 51329")).toBe("51329");
    expect(normInvoiceNumber("invoice 0051329")).toBe("51329");
    expect(normInvoiceNumber("51329-1")).toBe("513291");
    expect(normInvoiceNumber("51329-1")).not.toBe(normInvoiceNumber("51329"));
    expect(normInvoiceNumber("ENV-23585")).toBe("env23585");
    expect(normInvoiceNumber("000")).toBe("0");
    expect(normInvoiceNumber("  ")).toBeNull();
    expect(normInvoiceNumber(null)).toBeNull();
  });

  const existing = (over: Partial<AnalyseContext["existingDocs"][number]> = {}): AnalyseContext["existingDocs"] => [
    { id: "doc-1", venue_id: DRIFT, supplier_id: SUP_DS, invoice_number: "51329", status: "applied" as never, invoice_date: "2026-10-14", total_inc: 216.8, ...over },
  ];

  it("INV-51329 against a filed 51329 is a repeat", () => {
    expect(findDuplicate("INV-51329", SUP_DS, existing())).toBe("doc-1");
    expect(findDuplicate("#0051329", SUP_DS, existing())).toBe("doc-1");
    expect(findDuplicate("51329-1", SUP_DS, existing())).toBeNull();
  });

  it("same supplier, date and total is a repeat even when the number differs or is unreadable", () => {
    expect(findDuplicate("9999", SUP_DS, existing(), "2026-10-14", 216.8)).toBe("doc-1");
    expect(findDuplicate(null, SUP_DS, existing(), "2026-10-14", 216.81)).toBe("doc-1");
    expect(findDuplicate("9999", SUP_DS, existing(), "2026-10-14", 216.82)).toBeNull();
    expect(findDuplicate("9999", SUP_DS, existing(), "2026-10-15", 216.8)).toBeNull();
  });

  it("the fingerprint needs a known supplier, ignores the venue, and ignores duplicate and failed documents", () => {
    expect(findDuplicate("9999", null, existing(), "2026-10-14", 216.8)).toBeNull();
    expect(findDuplicate("9999", SUP_DS, existing({ venue_id: 2 }), "2026-10-14", 216.8)).toBe("doc-1");
    expect(findDuplicate("9999", SUP_DS, existing({ status: "duplicate" }), "2026-10-14", 216.8)).toBeNull();
    expect(findDuplicate("9999", SUP_DS, existing({ status: "failed" }), "2026-10-14", 216.8)).toBeNull();
    expect(findDuplicate("9999", SUP_DS, existing({ invoice_date: undefined, total_inc: undefined }), "2026-10-14", 216.8)).toBeNull();
  });

  it("the engine marks it a duplicate and decides nothing", () => {
    const d = danielStreet51329Fixed();
    d.invoice_number = "INV-0051329";
    const a = analyseInvoice(d, baseCtx({ existingDocs: existing() }));
    expect(a.duplicate_of).toBe("doc-1");
    expect(a.status).toBe("duplicate");
    expect(a.lines.every((l) => l.decision === "none")).toBe(true);
    const e = danielStreet51329Fixed();
    e.invoice_number = "55555";
    const b = analyseInvoice(e, baseCtx({ existingDocs: existing() }));
    expect(b.duplicate_of).toBe("doc-1");
  });
});

describe("M7: a switched off supplier is not a match", () => {
  it("matches by ABN and by name only among active suppliers", () => {
    const off = supplierDS({ active: false });
    expect(matchSupplier({ supplier_name: "Daniel Street Fish Market", supplier_abn: "61151388094" }, [off]).status).toBe("new");
    expect(matchSupplier({ supplier_name: "Daniel Street Fish Market", supplier_abn: null }, [off]).status).toBe("new");
    const twin = supplierDS({ id: "sup-ds-2", name: "Daniel Street Fish Market", abn: null });
    const m = matchSupplier({ supplier_name: "Daniel Street Fish Market", supplier_abn: null }, [off, twin]);
    expect(m).toMatchObject({ status: "matched" });
    expect(m.supplier?.id).toBe("sup-ds-2");
  });

  it("an invoice from an inactive supplier asks about a new supplier and applies nothing", () => {
    const a = analyseInvoice(danielStreet51329Fixed(), baseCtx({ suppliers: [supplierDS({ active: false })] }));
    expect(a.supplier_id).toBeNull();
    expect(a.questions.some((q) => q.kind === "new_supplier")).toBe(true);
    expect(a.lines.every((l) => l.decision !== "apply")).toBe(true);
  });
});
