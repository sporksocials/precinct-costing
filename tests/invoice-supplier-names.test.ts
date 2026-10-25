import { describe, expect, it } from "vitest";
import { sameSupplierName, supplierNameKeys, tidySupplierName } from "../lib/invoice-names";
import { matchSupplier } from "../lib/invoice-match";
import { analyseInvoice } from "../lib/invoice-engine";
import { READ_SCHEMA, READ_SYSTEM, SORT_SCHEMA, SORT_SYSTEM, parseExtracted } from "../lib/invoice-read";
import { saveAnalysis } from "../lib/invoice-store";
import { createFakeSupabase } from "./helpers/fake-supabase";
import { analysis, extracted } from "./helpers/invoice-analysis";
import { SUPPLIER } from "./helpers/invoice-fixtures";
import { baseCtx, danielStreet51329Fixed, supplierDS } from "./fixtures/invoice-fixtures";

const MESSY_BIDFOOD = "Bidfood Sunshine Coast (a division of Burleigh Marr Distributio)";

describe("tidySupplierName: the supplier's own short trading name", () => {
  it.each([
    [MESSY_BIDFOOD, "Bidfood Sunshine Coast"],
    ["MOOLOOLAH RIVER FISHERIES (part of Superior Food Group", "Mooloolah River Fisheries"],
    ["PRONTO PACKAGING QLD PTY LTD ABN 34147663750 Street Add", "Pronto Packaging QLD"],
    ["Simon George & Sons", "Simon George & Sons"],
    ["CD Australia Pty Ltd", "CD Australia"],
    ["CD Australia Pty Ltd trading as Diablo Co", "CD Australia"],
    ["Daniel Street Fish Market", "Daniel Street Fish Market"],
    ["DANIEL STREET FISH MARKET PTY. LTD.", "Daniel Street Fish Market"],
    ["Star Group Limited", "Star Group"],
    ["Paramount Liquor (trading as Paramount Wholesale)", "Paramount Liquor"],
    ["Fresh Co (a subsidiary of Big Corp", "Fresh Co"],
    ["Fresh Co ABN: 12 345 678 901", "Fresh Co"],
    ["Brisbane Produce 12 Smith Street Murarrie", "Brisbane Produce"],
    ["NSW MEAT CO PTY LTD", "NSW Meat Co"],
    ["  Spaced   Out   Foods  ", "Spaced Out Foods"],
    ["Foo (Qld) Pty Ltd", "Foo (Qld)"],
  ])("%s -> %s", (raw, want) => {
    expect(tidySupplierName(raw)).toBe(want);
  });

  it("keeps a real name that contains Street, and an all lower case or mixed case name as it was written", () => {
    expect(tidySupplierName("Daniel Street Fish Market")).toBe("Daniel Street Fish Market");
    expect(tidySupplierName("macpac wholesale")).toBe("macpac wholesale");
  });

  it("gives empty text back for nothing name-like, and never longer than 50 characters", () => {
    expect(tidySupplierName(null)).toBe("");
    expect(tidySupplierName("   ")).toBe("");
    expect(tidySupplierName("A Very Long Trading Name Indeed For A Small Local Supplier Of Many Things").length).toBeLessThanOrEqual(50);
  });

  it("is idempotent", () => {
    for (const raw of [MESSY_BIDFOOD, "PRONTO PACKAGING QLD PTY LTD ABN 34147663750 Street Add", "CD Australia Pty Ltd trading as Diablo Co"]) {
      const once = tidySupplierName(raw);
      expect(tidySupplierName(once)).toBe(once);
    }
  });
});

describe("supplier matching sees the tidied name too", () => {
  // the live row on 25 Oct 2026: renamed to the short name, the old messy string kept as an alias
  const bidfood = (over = {}) => supplierDS({ id: "sup-bidfood", name: "Bidfood Sunshine Coast", abn: null, aliases: [MESSY_BIDFOOD], ...over });

  it("the old messy string and the clean name both match that supplier", () => {
    const list = [supplierDS(), bidfood()];
    expect(matchSupplier({ supplier_name: MESSY_BIDFOOD, supplier_abn: null }, list)).toMatchObject({ status: "matched", supplier: { id: "sup-bidfood" } });
    expect(matchSupplier({ supplier_name: "Bidfood Sunshine Coast", supplier_abn: null }, list)).toMatchObject({ status: "matched", supplier: { id: "sup-bidfood" } });
  });

  it("a different messy copy of the letterhead matches with no alias at all", () => {
    const list = [supplierDS(), bidfood({ aliases: [] })];
    expect(matchSupplier({ supplier_name: "Bidfood Sunshine Coast (a division of Burleigh Marr Distributors Pty Ltd)", supplier_abn: null }, list)).toMatchObject({ status: "matched", supplier: { id: "sup-bidfood" } });
    expect(matchSupplier({ supplier_name: "BIDFOOD SUNSHINE COAST", supplier_abn: null }, list).supplier?.id).toBe("sup-bidfood");
  });

  it("a supplier saved under the messy name still matches the clean one", () => {
    const list = [bidfood({ name: MESSY_BIDFOOD, aliases: [] })];
    expect(matchSupplier({ supplier_name: "Bidfood Sunshine Coast", supplier_abn: null }, list).status).toBe("matched");
  });

  it("different suppliers do not share a key", () => {
    expect(sameSupplierName("Bidfood Sunshine Coast", "Bidfood Brisbane")).toBe(false);
    expect(supplierNameKeys(MESSY_BIDFOOD)).toContain("bidfood sunshine coast");
  });

  it("the engine files an invoice with the messy name under that supplier and asks nothing about the supplier", () => {
    const ex = { ...danielStreet51329Fixed(), supplier_name: MESSY_BIDFOOD, supplier_abn: null };
    const a = analyseInvoice(ex, baseCtx({ suppliers: [bidfood()] }));
    expect(a.supplier_id).toBe("sup-bidfood");
    expect(a.new_supplier).toBeNull();
    expect(a.questions.some((q) => q.kind === "new_supplier")).toBe(false);
  });
});

describe("a brand new supplier is added quietly", () => {
  it("raises no new supplier question and hands the store the short name", () => {
    const ex = { ...danielStreet51329Fixed(), supplier_name: "MOOLOOLAH RIVER FISHERIES (part of Superior Food Group", supplier_abn: "34 147 663 750" };
    const a = analyseInvoice(ex, baseCtx({ suppliers: [supplierDS()] }));
    expect(a.supplier_id).toBeNull();
    expect(a.new_supplier).toEqual({ name: "Mooloolah River Fisheries", abn: "34147663750" });
    expect(a.questions.some((q) => q.kind === "new_supplier")).toBe(false);
  });

  it("the same name with a DIFFERENT ABN still asks (the only supplier question kept for a name that fits)", () => {
    const ex = { ...danielStreet51329Fixed(), supplier_abn: "99 888 777 666" };
    const a = analyseInvoice(ex, baseCtx({ suppliers: [supplierDS()] }));
    const q = a.questions.find((x) => x.kind === "new_supplier");
    expect(q?.prompt).toMatch(/with ABN 99 888 777 666, but we have that supplier with ABN 61151388094/);
  });

  it("a name that fits two suppliers still asks which one", () => {
    const ex = { ...danielStreet51329Fixed(), supplier_abn: null };
    const a = analyseInvoice(ex, baseCtx({ suppliers: [supplierDS(), supplierDS({ id: "sup-other", abn: null, name: "Daniel Street Fish Market Wholesale", aliases: ["Daniel Street Fish Market"] })] }));
    expect(a.questions.find((x) => x.kind === "new_supplier")?.prompt).toMatch(/more than one of our suppliers/);
  });

  it("a name that cannot be read still asks someone to check the scan", () => {
    const a = analyseInvoice({ ...danielStreet51329Fixed(), supplier_name: null, supplier_abn: null }, baseCtx({ suppliers: [supplierDS()] }));
    expect(a.questions.some((q) => q.kind === "new_supplier")).toBe(true);
  });
});

describe("the store saves the short name and reuses a supplier by name, alias or ABN", () => {
  const base = { fileId: "file-1", venueId: 1, pagePdfPath: "doc/1.pdf", readModel: "claude-sonnet-5-5" };

  it("creates the supplier under the tidied name", async () => {
    const f = createFakeSupabase({ invoice_suppliers: [SUPPLIER] });
    await saveAnalysis(f.sb, { ...base, extracted: extracted(), analysis: analysis({ supplier_id: null, new_supplier: { name: MESSY_BIDFOOD, abn: null } }) });
    expect(f.db.invoice_suppliers.map((s) => s.name)).toContain("Bidfood Sunshine Coast");
  });

  it("reuses a supplier whose alias is the messy string, and does not add a second row", async () => {
    const f = createFakeSupabase({ invoice_suppliers: [SUPPLIER, { id: "sup-bidfood", name: "Bidfood Sunshine Coast", abn: null, aliases: [MESSY_BIDFOOD], active: true }] });
    await saveAnalysis(f.sb, { ...base, extracted: extracted(), analysis: analysis({ supplier_id: null, new_supplier: { name: "Bidfood Sunshine Coast (a division of Burleigh Marr Distributors)", abn: null } }) });
    expect(f.db.invoice_suppliers).toHaveLength(2);
    expect(f.db.invoice_documents[0].supplier_id).toBe("sup-bidfood");
  });
});

describe("the reader's output is tidied and the prompts say what a supplier name and ABN are", () => {
  const raw = (over: Record<string, unknown>) => ({
    doc_type: "invoice", supplier_name: "X", supplier_abn: null, invoice_number: "1", invoice_date: "2026-10-14", due_date: null, bill_to: null, ship_to: null,
    pages: [1], subtotal_ex: 10, gst_total: 1, total_inc: 11, lines: [], notes: [], ...over,
  });

  it("parseExtracted cuts the letterhead copy back to the short name", () => {
    expect(parseExtracted(raw({ supplier_name: MESSY_BIDFOOD })).supplier_name).toBe("Bidfood Sunshine Coast");
    expect(parseExtracted(raw({ supplier_name: "PRONTO PACKAGING QLD PTY LTD ABN 34147663750 Street Add" })).supplier_name).toBe("Pronto Packaging QLD");
    expect(parseExtracted(raw({ supplier_name: "Simon George & Sons" })).supplier_name).toBe("Simon George & Sons");
    expect(parseExtracted(raw({ supplier_name: null })).supplier_name).toBeNull();
  });

  it("the read prompt: short trading name, no division text, the supplier's own ABN, never the customer's", () => {
    expect(READ_SYSTEM).toMatch(/SHORT/);
    expect(READ_SYSTEM).toMatch(/about 40 characters/);
    expect(READ_SYSTEM).toMatch(/a division of/);
    expect(READ_SYSTEM).toMatch(/trading as/);
    expect(READ_SYSTEM).toMatch(/Bill To, Invoice To, Deliver To, Ship To, Sold To or a Customer Number/);
    expect(READ_SYSTEM).toMatch(/CUSTOMER/);
    expect(READ_SYSTEM).toContain("97 620 145 020");
    expect(READ_SYSTEM).toMatch(/use null/);
    expect(JSON.stringify(READ_SCHEMA)).toMatch(/40 characters at most/);
    expect(JSON.stringify(READ_SCHEMA)).toMatch(/SUPPLIER/);
  });

  it("the sort prompt asks for the same short name", () => {
    expect(SORT_SYSTEM).toMatch(/short trading name/);
    expect(JSON.stringify(SORT_SCHEMA)).toMatch(/short trading name/);
  });
});
