import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  costLines,
  countableLines,
  FORCE_BODY,
  invoiceShortName,
  isInvoiceSource,
  isUndoSource,
  ledgerByLogId,
  logIdFromKey,
  perUnit,
  undoModel,
  undoSourceText,
  type IngDocLite,
  type LedgerLite,
} from "@/lib/invoice-ingredient-view";
import { buildTimeline } from "@/lib/ingredient-history";
import type { IngredientInvoiceCost } from "@/lib/invoice-types";
import type { PriceLog } from "@/lib/types";

/* Daniel Street #51329: kingfish $68.90/kg invoiced, $70.84/kg landed (pool $5.91 spread, kingfish takes $3.59) */
const docs = new Map<string, IngDocLite>([["d1", { id: "d1", invoice_number: "51329", invoice_date: "2026-10-14", supplier_name: "Daniel Street Fish Market" }]]);
const cost: IngredientInvoiceCost = {
  ingredient_id: "ing-king",
  base_unit: "kg",
  last: { invoice_date: "2026-10-14", document_id: "d1", unit_price_base: 68.9, landed_base: 70.84 },
  average_landed_base: 69.6,
  deliveries: 6,
  window_days: 90,
};

describe("Cost From Invoices", () => {
  it("words last paid, landed and the average the way the brief does", () => {
    const lines = costLines(cost, docs, "2026-10-24");
    expect(lines.map((l) => l.text)).toEqual([
      "Last paid $68.90/kg on 14 Oct (Daniel Street 51329)",
      "Landed $70.84/kg (includes delivery and fees)",
      "90 day average $69.60/kg from 6 deliveries",
    ]);
    expect(lines[0].documentId).toBe("d1");
    expect(lines[2].documentId).toBeUndefined();
  });
  it("says when the invoice added nothing, or took something off", () => {
    expect(costLines({ ...cost, last: { ...cost.last!, landed_base: 68.9 } }, docs)[1].text).toBe("Landed $68.90/kg (no delivery or fees on that invoice)");
    expect(costLines({ ...cost, last: { ...cost.last!, landed_base: 67.5 } }, docs)[1].text).toBe("Landed $67.50/kg (after discounts)");
  });
  it("uses the singular for one delivery and the unit for each", () => {
    expect(costLines({ ...cost, deliveries: 1, window_days: 60 }, docs)[2].text).toBe("60 day average $69.60/kg from 1 delivery");
    expect(perUnit(0.5, "each")).toBe("$0.50/ea");
    expect(perUnit(3, "L")).toBe("$3.00/L");
    expect(perUnit(3, null)).toBe("$3.00");
  });
  it("shows nothing without data, and leaves out the average when it cannot be worked out", () => {
    expect(costLines(undefined, docs)).toEqual([]);
    expect(costLines({ ...cost, last: null, average_landed_base: null, deliveries: 0 }, docs)).toEqual([]);
    expect(costLines({ ...cost, average_landed_base: null }, docs).map((l) => l.key)).toEqual(["last", "landed"]);
  });
  it("names the invoice by two words of the supplier and the number, even if the invoice is unknown", () => {
    expect(invoiceShortName(docs.get("d1"))).toBe("Daniel Street 51329");
    expect(invoiceShortName(undefined)).toBe("");
    expect(costLines(cost, new Map())[0].text).toBe("Last paid $68.90/kg on 14 Oct");
  });
  it("counts only product lines for this ingredient that were not reverted or ignored", () => {
    const l = (o: Partial<{ ingredient_id: string | null; line_class: string; state: string }>) => ({ ingredient_id: "a", line_class: "product", state: "applied", ...o });
    const kept = countableLines([l({}), l({ state: "open" }), l({ state: "reverted" }), l({ state: "ignored" }), l({ line_class: "delivery" }), l({ ingredient_id: "b" }), l({ ingredient_id: null })], "a");
    expect(kept).toHaveLength(2);
  });
});

describe("Price History rows from invoices", () => {
  const src = "Invoice 51329 · Daniel Street Fish Market · 14 Oct 2026";
  it("tells an invoice source from an undo and from a person", () => {
    expect(isInvoiceSource(src)).toBe(true);
    expect(isInvoiceSource("Undo: " + src)).toBe(false);
    expect(isUndoSource("Undo: " + src)).toBe(true);
    expect(isUndoSource("undo invoice")).toBe(true);
    expect(isInvoiceSource("Price confirmed")).toBe(false);
    expect(isInvoiceSource(null)).toBe(false);
    expect(isUndoSource("Undone by a person")).toBe(false);
  });
  it("words an undo row plainly", () => {
    expect(undoSourceText("Undo: " + src)).toBe("Undone: " + src);
    expect(undoSourceText("Undo")).toBe("Undone");
  });
  it("finds the price log row behind a timeline entry", () => {
    const logs: PriceLog[] = [
      { id: 7, ingredient_id: "i", changed_at: "2026-10-24T01:00:00Z", old_price: 66, new_price: 68.9, source: src, entered_by: "mon@x.com", notes: null },
      { id: 8, ingredient_id: "i", changed_at: "2026-10-25T01:00:00Z", old_price: 68.9, new_price: 68.9, source: src, entered_by: "mon@x.com", notes: null },
    ];
    const t = buildTimeline(logs, []);
    expect(t.map((e) => logIdFromKey(e.key))).toEqual([8, 7]);
    expect(t[1].note).toBe(src); // the price row carries the source text the link replaces
    expect(logIdFromKey("a12")).toBeNull();
    expect(logIdFromKey("p")).toBeNull();
  });
  it("keys the undo ledger by the log row it wrote", () => {
    const rows: LedgerLite[] = [
      { id: "c1", document_id: "d1", kind: "price_change", status: "applied", old_price: 66, new_price: 68.9, old_last_price_update: "2026-10-01", cost_log_id: 7 },
      { id: "c2", document_id: "d1", kind: "price_change", status: "applied", old_price: 1, new_price: 2, old_last_price_update: null, cost_log_id: null },
    ];
    const m = ledgerByLogId(rows);
    expect(m.size).toBe(1);
    expect(m.get(7)?.id).toBe("c1");
  });
  it("the Undo question says exactly which price comes back", () => {
    expect(undoModel({ kind: "price_change", old_price: 66, new_price: 68.9, old_last_price_update: null })).toEqual({
      title: "Undo This Price?",
      body: "The price goes back from $68.90 to $66.00.",
      confirm: "Put The Price Back",
    });
    const c = undoModel({ kind: "price_confirmed", old_price: 68.9, new_price: 68.9, old_last_price_update: "2026-10-01" });
    expect(c.body).toBe("The price stays $68.90. Only the date it was last checked goes back to 1 Oct.");
    expect(undoModel({ kind: "price_confirmed", old_price: null, new_price: 68.9, old_last_price_update: null }).body).toContain("never checked");
    expect(FORCE_BODY).toMatch(/someone else/);
  });
});

describe("the data layer (in-memory database)", () => {
  let sb: SupabaseClient;
  beforeAll(async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({}) }));
    const { createDemoClient } = await import("@/lib/supabase/demo-client");
    sb = createDemoClient();
    await sb.from("invoice_suppliers").insert([{ id: "s1", name: "Daniel Street Fish Market" }]);
    await sb.from("invoice_documents").insert([
      { id: "d1", supplier_id: "s1", invoice_number: "51329", invoice_date: "2026-10-14", supplier_name_read: "DSFM", status: "applied" },
      { id: "d2", supplier_id: "s1", invoice_number: "51329", invoice_date: "2026-10-14", supplier_name_read: "DSFM", status: "duplicate" },
      { id: "d3", supplier_id: null, invoice_number: "ENV-34730", invoice_date: "2026-10-22", supplier_name_read: "CD Australia Pty Ltd", status: "needs_review" },
    ]);
    const line = (o: object) => ({ ingredient_id: "ing-king", line_class: "product", state: "applied", invoice_date: "2026-10-14", unit_price_ex: "68.9", landed_total_ex: "130.88", landed_base_ex: "70.84", base_qty: "1.85", base_unit: "kg", packs_per_unit: "1", ...o });
    await sb.from("invoice_lines").insert([line({ id: "a", document_id: "d1" }), line({ id: "b", document_id: "d2" }), line({ id: "c", document_id: "d3", invoice_date: "2026-10-22" }), line({ id: "x", document_id: "d1", ingredient_id: "other" })]);
    await sb.from("invoice_price_changes").insert([
      { id: "ch1", document_id: "d1", target: "ingredient", target_id: "ing-king", kind: "price_change", status: "applied", old_price: "66", new_price: "68.9", old_last_price_update: "2026-10-01", cost_log_id: 7, applied_at: "2026-10-24T01:00:00Z" },
      { id: "ch2", document_id: "d1", target: "ordering_product", target_id: "ing-king", kind: "price_change", status: "applied", old_price: 1, new_price: 2, cost_log_id: null, applied_at: "2026-10-24T01:00:00Z" },
    ]);
  });
  it("loads this ingredient's lines, with their invoices, leaving out duplicate invoices", async () => {
    const { loadIngredientInvoiceLines } = await import("@/lib/invoice-data-extra");
    const r = await loadIngredientInvoiceLines(sb, "ing-king");
    expect(r.lines.map((l) => l.document_id).sort()).toEqual(["d1", "d3"]);
    expect(typeof r.lines[0].unit_price_ex).toBe("number");
    expect(r.docs.get("d1")).toMatchObject({ invoice_number: "51329", supplier_name: "Daniel Street Fish Market" });
    expect(r.docs.get("d3")?.supplier_name).toBe("CD Australia Pty Ltd"); // no supplier row: the name as read
    expect(r.docs.has("d2")).toBe(false);
  });
  it("gives nothing for an ingredient with no invoice lines", async () => {
    const { loadIngredientInvoiceLines } = await import("@/lib/invoice-data-extra");
    const r = await loadIngredientInvoiceLines(sb, "ing-none");
    expect(r.lines).toEqual([]);
    expect(r.docs.size).toBe(0);
  });
  it("loads only the ingredient's own undo ledger rows, with numbers as numbers", async () => {
    const { loadLedgerForIngredient } = await import("@/lib/invoice-data-extra");
    const rows = await loadLedgerForIngredient(sb, "ing-king");
    expect(rows.map((r) => r.id)).toEqual(["ch1"]);
    expect(rows[0].old_price).toBe(66);
  });
  it("any failure reads as no data, never a crash", async () => {
    const { loadIngredientInvoiceLines, loadLedgerForIngredient } = await import("@/lib/invoice-data-extra");
    const boom = { from: () => { throw new Error("offline"); } } as unknown as SupabaseClient;
    expect((await loadIngredientInvoiceLines(boom, "x")).lines).toEqual([]);
    expect(await loadLedgerForIngredient(boom, "x")).toEqual([]);
  });
});

describe("how the ingredient page is wired", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("shows the cost block once, right under the price section", () => {
    const page = read("app/(app)/ingredients/[id]/page.tsx");
    expect((page.match(/<IngInvoiceCosts /g) ?? []).length).toBe(1);
    expect(page.indexOf("<IngInvoiceCosts")).toBeGreaterThan(page.indexOf("Confirm Price"));
    expect(page.indexOf("<IngInvoiceCosts")).toBeLessThan(page.indexOf('title="Category"'));
  });
  it("routes the history rows through the invoice hook, with its sheet", () => {
    const h = read("components/ingredient-history.tsx");
    expect(h).toContain("useInvoiceHistory(");
    expect(h).toContain("invoice.row(");
    expect(h).toContain("{invoice.sheet}");
  });
  it("undoes through undoChange and offers the explicit second button", () => {
    const s = read("components/invoices/ing-price-source.tsx");
    expect(s).toContain("undoChange(");
    expect(s).toContain("needsForce");
    expect(s).toContain("Put It Back Anyway");
  });
  it("keeps recipes costing on the ingredient's own price: the block never writes", () => {
    for (const f of ["components/invoices/ing-invoice-costs.tsx", "lib/invoice-ingredient-view.ts"]) expect(read(f), f).not.toMatch(/\.(insert|update|upsert|delete)\(|updateIngredient/);
  });
  it("has no em or en dashes in anything a person reads", () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const f of ["components/invoices/ing-invoice-costs.tsx", "components/invoices/ing-price-source.tsx", "lib/invoice-ingredient-view.ts"]) expect(strip(read(f)), f).not.toMatch(/[–—]/);
  });
});
