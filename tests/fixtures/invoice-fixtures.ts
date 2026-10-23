// Hand-written fixtures for the invoice engine tests: the Daniel Street and Diablo examples as extracted JSON, plus a base context.
// No PDFs and no client files. Every builder returns a fresh object so a test can change it freely.
import { DEFAULT_INVOICE_SETTINGS } from "../../lib/invoice-types";
import type {
  AnalyseContext,
  AnalyseIngredient,
  AnalyseProduct,
  ExtractedInvoice,
  ExtractedLine,
  InvoiceChargeRuleRow,
  InvoiceItemMapRow,
  InvoiceSupplierRow,
} from "../../lib/invoice-types";
import { descKey } from "../../lib/invoice-names";

export const DRIFT = 1;
export const CHIOBU = 2;

export const SUP_DS = "sup-daniel-street";
export const SUP_DIABLO = "sup-diablo";

export function supplierDS(over: Partial<InvoiceSupplierRow> = {}): InvoiceSupplierRow {
  return { id: SUP_DS, name: "Daniel Street Fish Market", abn: "61151388094", aliases: [], cost_supplier_id: 7, allocation_basis: "value", auto_apply: true, notes: null, active: true, ...over };
}
export function supplierDiablo(over: Partial<InvoiceSupplierRow> = {}): InvoiceSupplierRow {
  return { id: SUP_DIABLO, name: "Diablo Co", abn: null, aliases: ["CD Australia Pty Ltd"], cost_supplier_id: 9, allocation_basis: "value", auto_apply: true, notes: null, active: true, ...over };
}

export function ing(over: Partial<AnalyseIngredient> & { id: string; name: string }): AnalyseIngredient {
  return {
    supplier_id: null, supplier_code: null, pack_size: 1, pack_unit: "kg", pack_price: 10, price_inc_gst: false, gst_free: false,
    last_price_update: "2026-10-01", active: true, has_deal: false, ...over,
  };
}
export function prod(over: Partial<AnalyseProduct> & { id: string; name: string }): AnalyseProduct {
  return {
    venue_id: DRIFT, supplier_item_code: null, supplier_name: null, unit_name: "carton", price_inc_gst: null, ingredient_id: null,
    costing_packs_per_unit: null, deal_buy_qty: null, deal_free_qty: null, active: true, ...over,
  };
}

export const ING_KINGFISH = ing({ id: "ing-kingfish", name: "Kingfish Fillets (1kg)", supplier_id: 7, supplier_code: "15026", pack_price: 66.5, gst_free: true });
export const ING_BARRA = ing({ id: "ing-barra", name: "Barramundi Fillets (1kg)", supplier_id: 7, supplier_code: "15056", pack_price: 40, gst_free: true });
export const ING_GINGER = ing({ id: "ing-ginger", name: "Diablo Ginger Beer 50L Keg", supplier_id: 9, pack_size: 50, pack_unit: "L", pack_price: 355 });
export const ING_LYCHEE = ing({ id: "ing-lychee", name: "Lychee Liqueur (700ml)", supplier_id: 9, pack_size: 700, pack_unit: "ml", pack_price: 38 });

export const PROD_BARRA = prod({
  id: "prod-barra", name: "Barramundi Fillets", supplier_item_code: "15056", supplier_name: "Daniel Street Fish Market", unit_name: "kg", price_inc_gst: 45, ingredient_id: "ing-barra",
});

/** the seeded global charge rules from the migration */
export function seededRules(): InvoiceChargeRuleRow[] {
  const rows: [string, InvoiceChargeRuleRow["line_class"], boolean][] = [
    ["delivery", "delivery", true], ["freight", "fee", true], ["fuel levy", "fee", true], ["surcharge", "fee", true],
    ["deposit", "deposit", false], ["keg return", "deposit", false], ["discount", "discount", true], ["rounding", "other", false],
  ];
  return rows.map(([match_text, line_class, spread], i) => ({ id: `rule-${i}`, supplier_id: null, match_text, line_class, spread, note: null, active: true }));
}

export function mapRow(over: Partial<InvoiceItemMapRow> & { supplier_id: string }): InvoiceItemMapRow {
  return { id: `map-${Math.random().toString(36).slice(2, 8)}`, venue_id: null, item_code: null, desc_key: null, ingredient_id: null, product_id: null, packs_per_unit: 1, rejected: false, ...over };
}

export function baseCtx(over: Partial<AnalyseContext> = {}): AnalyseContext {
  return {
    venueId: DRIFT,
    folderVenueId: DRIFT,
    venueNames: [
      { id: DRIFT, name: "Drift", aliases: ["Drift Bar and Dining"] },
      { id: CHIOBU, name: "Chiobu", aliases: [] },
      { id: 3, name: "Greedy Gringo's", aliases: ["Greedy Gringos"] },
      { id: 4, name: "Gelato Rumba", aliases: [] },
    ],
    settings: { ...DEFAULT_INVOICE_SETTINGS, learningMode: false },
    gstRate: 0.1,
    suppliers: [supplierDS(), supplierDiablo()],
    maps: [],
    chargeRules: seededRules(),
    ingredients: [ING_KINGFISH, ING_BARRA, ING_GINGER, ING_LYCHEE],
    products: [PROD_BARRA],
    existingDocs: [],
    today: "2026-10-24",
    ...over,
  };
}

export function line(over: Partial<ExtractedLine> & { line_no: number; description: string }): ExtractedLine {
  return { page: 1, item_code: null, qty: null, unit: null, unit_price: null, line_total: null, basis: "ex", gst: "taxable", class_hint: null, ...over };
}

/** Daniel Street #51329 as it was read: the barramundi line does not add up (2.39 x 41.54 is 99.28, the line says 98.98). */
export function danielStreet51329(): ExtractedInvoice {
  return {
    doc_type: "invoice",
    supplier_name: "Daniel Street Fish Market",
    supplier_abn: "61151388094",
    invoice_number: "51329",
    invoice_date: "2026-10-14",
    due_date: null,
    bill_to: "DRIFT BAR AND DINING",
    ship_to: null,
    pages: [1],
    subtotal_ex: 215.91,
    gst_total: 0.59,
    total_inc: 216.5,
    lines: [
      line({ line_no: 1, item_code: "15026", description: "Kingfish fillets skin on wing off per kg", qty: 1.85, unit: "KG", unit_price: 68.9, line_total: 127.47, gst: "free", class_hint: "product" }),
      line({ line_no: 2, item_code: "15056", description: "Humpty Doo Barramundi fillets per kg", qty: 2.39, unit: "KG", unit_price: 41.54, line_total: 98.98, gst: "free", class_hint: "product" }),
      line({ line_no: 3, item_code: "15056", description: "Barramundi credit", line_total: -16.45, gst: "free", class_hint: "credit" }),
      line({ line_no: 4, item_code: "99000", description: "Delivery order over $200", qty: 1, unit: "EA", unit_price: 6.5, line_total: 6.5, basis: "inc", gst: "taxable", class_hint: "delivery" }),
    ],
    notes: [],
  };
}

/** The same invoice with the barramundi line corrected (99.28), so it adds up. */
export function danielStreet51329Fixed(): ExtractedInvoice {
  const d = danielStreet51329();
  d.lines[1].line_total = 99.28;
  d.subtotal_ex = 216.21;
  d.total_inc = 216.8;
  return d;
}

/** Diablo ENV-23585: no item codes, matched by description. */
export function diabloEnv23585(): ExtractedInvoice {
  return {
    doc_type: "invoice",
    supplier_name: "CD Australia Pty Ltd trading as Diablo Co",
    supplier_abn: null,
    invoice_number: "ENV-23585",
    invoice_date: "2026-10-20",
    due_date: null,
    bill_to: "Chiobu Caloundra",
    ship_to: null,
    pages: [4],
    subtotal_ex: 436.24,
    gst_total: 43.62,
    total_inc: 479.86,
    lines: [
      line({ line_no: 1, page: 4, description: "Diablo Ginger Beer 50L Keg", qty: 1, unit: "KEG", unit_price: 359, line_total: 359, class_hint: "product" }),
      line({ line_no: 2, page: 4, description: "Lychee Liqueur 700ml Bottle", qty: 2, unit: "BTL", unit_price: 38.62, line_total: 77.24, class_hint: "product" }),
    ],
    notes: [],
  };
}

export function diabloMaps(): InvoiceItemMapRow[] {
  return [
    mapRow({ id: "map-ginger", supplier_id: SUP_DIABLO, desc_key: descKey("Diablo Ginger Beer 50L Keg"), ingredient_id: "ing-ginger", packs_per_unit: 1 }),
    mapRow({ id: "map-lychee", supplier_id: SUP_DIABLO, desc_key: descKey("Lychee Liqueur 700ml Bottle"), ingredient_id: "ing-lychee", packs_per_unit: 1 }),
  ];
}

/** Diablo's context: the folder venue is Chiobu. */
export function diabloCtx(over: Partial<AnalyseContext> = {}): AnalyseContext {
  return baseCtx({ venueId: CHIOBU, folderVenueId: CHIOBU, maps: diabloMaps(), products: [], ...over });
}
