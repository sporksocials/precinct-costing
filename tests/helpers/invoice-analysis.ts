/** Builders for ExtractedInvoice / InvoiceAnalysis fixtures (hand-written, no engine). */
import type { AnalysedLine, AnalysedQuestion, ExtractedInvoice, InvoiceAnalysis } from "../../lib/invoice-types";

export function extracted(over: Partial<ExtractedInvoice> = {}): ExtractedInvoice {
  return {
    doc_type: "invoice", supplier_name: "Daniel Street Fish Market", supplier_abn: "61 151 388 094", invoice_number: "51329", invoice_date: "2026-10-14", due_date: null,
    bill_to: "DRIFT BAR AND DINING", ship_to: "DRIFT BAR AND DINING", pages: [1], subtotal_ex: 215.91, gst_total: 0.59, total_inc: 216.5, notes: [],
    lines: [
      { line_no: 1, page: 1, item_code: "15026", description: "Kingfish fillets skin on wing off per kg", qty: 1.85, unit: "KG", unit_price: 68.9, line_total: 127.47, basis: "ex", gst: "free", class_hint: null },
      { line_no: 2, page: 1, item_code: "15056", description: "Humpty Doo Barramundi fillets per kg", qty: 2.39, unit: "KG", unit_price: 41.54, line_total: 98.98, basis: "ex", gst: "free", class_hint: null },
      { line_no: 3, page: 1, item_code: "99000", description: "Delivery order over $200", qty: 1, unit: "EA", unit_price: 5.91, line_total: 5.91, basis: "ex", gst: "taxable", class_hint: "delivery" },
    ],
    ...over,
  };
}

export function aLine(lineNo: number, over: Partial<AnalysedLine> = {}): AnalysedLine {
  return {
    source_index: lineNo - 1, venue_id: 1, invoice_date: "2026-10-14", line_no: lineNo, page: 1, line_class: "product", item_code: String(15000 + lineNo), description: `Line ${lineNo}`,
    qty: 1, unit: "KG", unit_price_ex: 10, line_total_ex: 10, gst: "free", gst_amount: 0, math_ok: true, match_state: "matched", match_method: "code", map_id: null,
    ingredient_id: "ing-kingfish", product_id: null, packs_per_unit: 1, base_qty: 1, base_unit: "kg", fee_share_ex: 0, landed_total_ex: 10, landed_unit_ex: 10, landed_base_ex: 10,
    old_pack_price: 10, new_pack_price: 11, old_product_price: null, new_product_price: null, change_pct: 0.1, decision: "needs_approval", decision_reason: "Over 5%", state: "open",
    ...over,
  };
}

export function question(lineNo: number | null, over: Partial<AnalysedQuestion> = {}): AnalysedQuestion {
  return { kind: "unmatched_line", line_no: lineNo, prompt: "Which product is this?", options: [{ id: "o1", label: "Kingfish Fillets", ingredient_id: "ing-kingfish" }, { id: "o2", label: "Ignore this line", action: "ignore_line" }], ...over };
}

export function analysis(over: Partial<InvoiceAnalysis> = {}): InvoiceAnalysis {
  return {
    supplier_id: "sup-daniel", new_supplier: null, venue_check: "ok", price_basis: "ex", reconciled: true, recon_notes: [], fee_pool_ex: 5.91, lines: [aLine(1), aLine(2, { ingredient_id: "ing-barra" })],
    questions: [], duplicate_of: null, mode: "learning", status: "needs_review",
    summary: { products: 2, matched: 2, same: 0, to_apply: 0, need_approval: 2, unmatched: 0 }, ...over,
  };
}
