/**
 * Hand-written rows for the invoice database tests: the Daniel Street Fish Market #51329 invoice (Drift) and a Diablo Co line.
 * No client files; the numbers come from the examples in the invoice brief.
 */
import type { Row } from "./fake-supabase";

export const IDS = {
  venueDrift: 1,
  venueChiobu: 2,
  supplier: "sup-daniel",
  file: "file-1",
  doc: "doc-1",
  kingfish: "ing-kingfish",
  barra: "ing-barra",
  lychee: "ing-lychee",
  kingfishProduct: "prod-kingfish",
  lineKingfish: "line-1",
  lineBarra: "line-2",
} as const;

export const VENUES: Row[] = [
  { id: 1, name: "Drift", slug: "drift", sort: 1 },
  { id: 2, name: "Chiobu", slug: "chiobu", sort: 2 },
  { id: 3, name: "Greedy Gringo's", slug: "greedy", sort: 3 },
  { id: 4, name: "Gelato Rumba", slug: "gelato", sort: 4 },
];

export function ingredient(over: Row = {}): Row {
  return {
    id: IDS.kingfish, name: "Kingfish Fillets", category: "Food", supplier_id: 7, supplier_code: "15026", pack_size: 1, pack_unit: "kg",
    pack_price: 65, price_inc_gst: false, gst_free: true, last_price_update: "2026-10-01", previous_price: 62, source: "Daniel Street price list", active: true,
    ...over,
  };
}

export function document(over: Row = {}): Row {
  return {
    id: IDS.doc, venue_id: 1, file_id: IDS.file, supplier_id: IDS.supplier, supplier_name_read: "Daniel Street Fish Market", supplier_abn_read: "61151388094",
    doc_type: "invoice", invoice_number: "51329", invoice_date: "2026-10-14", due_date: null, pages: [1], page_pdf_path: null, bill_to: "DRIFT BAR AND DINING", ship_to: "DRIFT BAR AND DINING",
    venue_check: "ok", price_basis: "ex", subtotal_ex: 215.91, gst_total: 0.59, total_inc: 216.5, reconciled: true, recon_notes: [], fee_pool_ex: 5.91,
    status: "needs_review", mode: "learning", duplicate_of: null, read_model: "claude-sonnet-5-5",
    ...over,
  };
}

/** The kingfish line: 1.85 kg at $68.90 against $65.00 now (+6%), so it needs approval. */
export function line(over: Row = {}): Row {
  return {
    id: IDS.lineKingfish, document_id: IDS.doc, venue_id: 1, invoice_date: "2026-10-14", line_no: 1, page: 1, line_class: "product", item_code: "15026",
    description: "Kingfish fillets skin on wing off per kg", qty: 1.85, unit: "KG", unit_price_ex: 68.9, line_total_ex: 127.47, gst: "free", gst_amount: 0, math_ok: true,
    match_state: "matched", match_method: "code", map_id: null, ingredient_id: IDS.kingfish, product_id: null, packs_per_unit: 1, base_qty: 1.85, base_unit: "kg",
    fee_share_ex: 3.59, landed_total_ex: 131.06, landed_unit_ex: 70.84, landed_base_ex: 70.84,
    old_pack_price: 65, new_pack_price: 68.9, old_product_price: null, new_product_price: null, change_pct: 0.06, decision: "needs_approval", decision_reason: "Over 5%", state: "open",
    ...over,
  };
}

export function product(over: Row = {}): Row {
  return {
    id: IDS.kingfishProduct, venue_id: 1, category_id: "cat-1", name: "Kingfish Fillets", unit_name: "kg", supplier_id: "osup-1", supplier_item_code: "15026",
    price_inc_gst: 65, ingredient_id: IDS.kingfish, costing_packs_per_unit: 1, par: 0, active: true, ...over,
  };
}

export const SUPPLIER: Row = { id: IDS.supplier, name: "Daniel Street Fish Market", abn: "61151388094", aliases: [], allocation_basis: "value", auto_apply: true, active: true };

/** Settings rows: learning mode off, auto-apply under 5%. */
export const SETTINGS_AUTO: Row[] = [
  { key: "gst_rate", value: 0.1 },
  { key: "invoice_auto_apply_pct", value: 0.05 },
  { key: "invoice_learning_mode", value: 0 },
  { key: "invoice_average_days", value: 90 },
  { key: "ai_usd_to_aud", value: 1.55 },
];
