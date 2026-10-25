/**
 * Invoices: the shared contract (tables, reader output, engine input and output, settings). Every other invoice module codes
 * against THIS file; it is owned by the orchestrator, so change it only by asking. Pure types and constants, no logic, no React.
 *
 * Flow:   scanned PDF -> InvoiceFile -> (sort pages) -> InvoiceDocument[] -> (read) ExtractedInvoice -> (analyse) InvoiceAnalysis
 *         -> persisted as InvoiceDocumentRow + InvoiceLineRow[] + InvoiceQuestionRow[] -> (apply) InvoicePriceChangeRow[] (the undo ledger)
 *
 * Money: dollars as JS numbers, rounded to 4 dp inside calculations and to 2 dp only for display (lib/format). Costs are ex GST.
 * Dates: yyyy-mm-dd strings, Brisbane calendar dates. Quantities are plain numbers.
 */

// ---------------------------------------------------------------- settings (cost_settings keys, numeric)
export const INVOICE_SETTING_KEYS = {
  /** price changes smaller than this (up or down, as a fraction) may apply themselves. Default 0.05 */
  autoApplyPct: "invoice_auto_apply_pct",
  /** 1 = learning mode (every price needs a tap); 0 = suppliers marked auto_apply may apply themselves. Default 1 */
  learningMode: "invoice_learning_mode",
  /** window for the quantity-weighted average cost, in days. Default 90 */
  averageDays: "invoice_average_days",
  /** US dollars to Australian dollars, for showing AI cost in AUD only. Default 1.55 (an estimate) */
  usdToAud: "ai_usd_to_aud",
} as const;

export interface InvoiceSettings {
  autoApplyPct: number;
  learningMode: boolean;
  averageDays: number;
  usdToAud: number;
}

export const DEFAULT_INVOICE_SETTINGS: InvoiceSettings = { autoApplyPct: 0.05, learningMode: true, averageDays: 90, usdToAud: 1.55 };

/** Environment variables the invoice system reads (values are never written to disk, the repo or any log). */
export const INVOICE_ENV = {
  /** shared secret the scanner script sends; compared in constant time */
  ingestSecret: "INVOICE_INGEST_SECRET",
  /** server-side database key (bypasses RLS); the scanner script has no signed-in user */
  serviceRole: "SUPABASE_SERVICE_ROLE_KEY",
  /** optional: a key from its own Anthropic Console workspace so Anthropic's billing page shows invoice cost separately */
  anthropicKey: "INVOICE_ANTHROPIC_API_KEY",
  /** fallback key, already set for the other AI features */
  anthropicKeyFallback: "ANTHROPIC_API_KEY",
  anthropicBaseUrl: "ANTHROPIC_BASE_URL",
  /** model for sorting pages (default claude-haiku-5-5) and reading lines (default claude-sonnet-5-5) */
  sortModel: "INVOICE_SORT_MODEL",
  readModel: "INVOICE_READ_MODEL",
  /** Slack incoming webhook for the digest (optional: no webhook means no Slack, the app still shows everything) */
  slackWebhook: "INVOICE_SLACK_WEBHOOK_URL",
} as const;

export const DEFAULT_SORT_MODEL = "claude-haiku-5-5";
export const DEFAULT_READ_MODEL = "claude-sonnet-5-5";

// ---------------------------------------------------------------- enums
export type InvoiceDocType = "invoice" | "credit_note" | "statement" | "delivery_docket" | "blank" | "other";
/** product = stock that is costed; the rest are charges. deposit is refundable and left out of cost by default. */
export type LineClass = "product" | "delivery" | "fee" | "deposit" | "discount" | "credit" | "other";
export type GstFlag = "taxable" | "free" | "unknown";
export type MatchState = "matched" | "unmatched" | "ambiguous" | "ignored";
export type MatchMethod = "code" | "alias" | "human";
export type LineDecision = "none" | "same" | "apply" | "needs_approval" | "skip";
export type LineState = "open" | "applied" | "confirmed" | "approved_skip" | "reverted" | "ignored";
export type VenueCheck = "ok" | "mismatch" | "unknown";
export type DocStatus = "needs_review" | "applied" | "partly_applied" | "nothing_to_apply" | "ignored" | "duplicate" | "failed";
export type FileStatus = "received" | "sorting" | "reading" | "done" | "failed";
export type QuestionKind = "unmatched_line" | "ambiguous_match" | "unit_unclear" | "big_change" | "totals_mismatch" | "venue_mismatch" | "credit_unclear" | "new_supplier" | "other";
export type ChangeTarget = "ingredient" | "ordering_product";

// ---------------------------------------------------------------- reader output (what Claude returns after the checks pass)
/** Page-sorting pass (cheap model, one call per file): which pages belong together. */
export interface SortedPage {
  page: number; // 1-based
  doc_type: InvoiceDocType;
  supplier_name: string | null;
  invoice_number: string | null;
  /** "page 2 of 3" printed on the page, when present */
  page_of: { page: number; of: number } | null;
  /** true when this page continues the invoice on the page before it (no new header) */
  continues_previous: boolean;
}

/** One line exactly as printed. The reader never does arithmetic to fill a missing number; it leaves null. */
export interface ExtractedLine {
  line_no: number;
  page: number;
  item_code: string | null;
  description: string;
  qty: number | null;
  /** KG, CTN, EA, KEG, PKT... as printed (upper case) */
  unit: string | null;
  /** as printed. Whether it includes GST is `basis` */
  unit_price: number | null;
  /** as printed, negative for credits and discounts */
  line_total: number | null;
  basis: "ex" | "inc";
  gst: GstFlag;
  /** the reader's own guess at the class; the engine applies the charge rules on top */
  class_hint: LineClass | null;
  /** a printed Discount column as a percent (20 means 20%); null when none is printed */
  discount_pct?: number | null;
  /** a printed discount in dollars for this line; null when none is printed */
  discount_amount?: number | null;
  /** whether the line TOTAL (the Amount column) includes GST; `basis` is about the unit price. Absent means the same as `basis`. */
  total_basis?: "ex" | "inc" | null;
}

export interface ExtractedInvoice {
  doc_type: InvoiceDocType;
  supplier_name: string | null;
  supplier_abn: string | null; // digits only
  invoice_number: string | null;
  invoice_date: string | null; // yyyy-mm-dd (Australian day/month/year read correctly)
  due_date: string | null;
  bill_to: string | null;
  ship_to: string | null;
  /** 1-based pages of the scanned file this invoice covers */
  pages: number[];
  /** printed totals; null when not printed or unreadable */
  subtotal_ex: number | null;
  gst_total: number | null;
  total_inc: number | null;
  lines: ExtractedLine[];
  /** anything odd the reader noticed (handwriting, a stamp, a cut-off page) for a human */
  notes: string[];
}

// ---------------------------------------------------------------- database rows (mirror supabase/migrations/20261024100000_invoices.sql)
export interface InvoiceSupplierRow {
  id: string;
  name: string;
  abn: string | null;
  aliases: string[];
  cost_supplier_id: number | null;
  allocation_basis: "value" | "quantity";
  auto_apply: boolean;
  notes: string | null;
  active: boolean;
}

export interface InvoiceFileRow {
  id: string;
  venue_id: number;
  source_name: string | null;
  drive_file_id: string | null;
  storage_path: string;
  sha256: string;
  page_count: number | null;
  status: FileStatus;
  error: string | null;
  attempts: number;
  received_at: string;
  processed_at: string | null;
}

export interface ReconNote {
  /** which check */
  check: "line_math" | "subtotal" | "gst" | "total" | "pages" | "venue" | "duplicate" | "other";
  ok: boolean;
  /** plain words, written for a person */
  message: string;
}

export interface InvoiceDocumentRow {
  id: string;
  venue_id: number;
  file_id: string;
  supplier_id: string | null;
  supplier_name_read: string | null;
  supplier_abn_read: string | null;
  doc_type: InvoiceDocType;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  pages: number[];
  page_pdf_path: string | null;
  bill_to: string | null;
  ship_to: string | null;
  venue_check: VenueCheck;
  price_basis: "ex" | "inc" | "mixed" | null;
  subtotal_ex: number | null;
  gst_total: number | null;
  total_inc: number | null;
  reconciled: boolean;
  recon_notes: ReconNote[];
  fee_pool_ex: number;
  status: DocStatus;
  mode: "learning" | "auto";
  duplicate_of: string | null;
  read_model: string | null;
  created_at: string;
}

export interface InvoiceLineRow {
  id: string;
  document_id: string;
  venue_id: number;
  invoice_date: string | null;
  line_no: number;
  page: number | null;
  line_class: LineClass;
  item_code: string | null;
  description: string;
  qty: number | null;
  unit: string | null;
  unit_price_ex: number | null;
  line_total_ex: number | null;
  gst: GstFlag;
  gst_amount: number | null;
  math_ok: boolean | null;
  match_state: MatchState;
  match_method: MatchMethod | null;
  map_id: string | null;
  ingredient_id: string | null;
  product_id: string | null;
  packs_per_unit: number | null;
  base_qty: number | null;
  base_unit: string | null;
  /** a same-code negative line netted off this product (a supplier discount); absent until the migration is applied */
  line_discount_ex?: number | null;
  discount_pct?: number | null;
  discount_per_base?: number | null;
  fee_share_ex: number;
  landed_total_ex: number | null;
  landed_unit_ex: number | null;
  landed_base_ex: number | null;
  old_pack_price: number | null;
  new_pack_price: number | null;
  old_product_price: number | null;
  new_product_price: number | null;
  change_pct: number | null;
  decision: LineDecision;
  decision_reason: string | null;
  state: LineState;
}

export interface InvoiceItemMapRow {
  id: string;
  supplier_id: string;
  venue_id: number | null;
  item_code: string | null;
  desc_key: string | null;
  ingredient_id: string | null;
  product_id: string | null;
  /** costing packs in one invoice unit as a person said it; null = not said, so the engine derives it or asks */
  packs_per_unit: number | null;
  rejected: boolean;
}

export interface InvoiceChargeRuleRow {
  id: string;
  supplier_id: string | null;
  match_text: string;
  line_class: LineClass;
  /** true = spread over the products as landed cost; false = left out of cost */
  spread: boolean;
  note: string | null;
  active: boolean;
}

export interface InvoicePriceChangeRow {
  id: string;
  line_id: string;
  document_id: string;
  venue_id: number;
  target: ChangeTarget;
  target_id: string;
  kind: "price_change" | "price_confirmed";
  mode: "auto" | "approved";
  old_price: number | null;
  new_price: number | null;
  old_last_price_update: string | null;
  old_previous_price: number | null;
  old_source: string | null;
  cost_log_id: number | null;
  ordering_log_id: string | null;
  note: string | null;
  status: "applied" | "reverted";
  applied_by: string | null;
  applied_at: string;
  reverted_by: string | null;
  reverted_at: string | null;
  revert_note: string | null;
}

export interface QuestionOption {
  id: string;
  label: string;
  ingredient_id?: string | null;
  product_id?: string | null;
  /** costing packs in one invoice unit, when the answer also settles the unit */
  packs_per_unit?: number | null;
  /** a non-mapping answer: "ignore this line", "approve this price", "reject this price", "this is not a product" */
  action?: "ignore_line" | "approve_change" | "reject_change" | "not_a_product" | "confirm_venue" | "wrong_venue" | "reread" | "ignore_document";
}

export interface InvoiceQuestionRow {
  id: string;
  venue_id: number;
  document_id: string;
  line_id: string | null;
  kind: QuestionKind;
  prompt: string;
  options: QuestionOption[];
  status: "open" | "answered" | "dismissed";
  answer: { option_id: string; note?: string } | null;
  answered_by: string | null;
  answered_at: string | null;
  emailed_at: string | null;
  created_at: string;
}

export interface AiUsageRow {
  id: number;
  at: string;
  feature: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
  venue_id: number | null;
  file_id: string | null;
  document_id: string | null;
  ok: boolean;
  note: string | null;
}

// ---------------------------------------------------------------- engine (pure): input and output
/** What the engine needs to know. Built by the caller from the store (screens) or the database (the reader). */
export interface AnalyseContext {
  venueId: number;
  /** the venue the file arrived under (its Drive folder), for the venue check */
  folderVenueId: number;
  venueNames: { id: number; name: string; aliases: string[] }[];
  settings: InvoiceSettings;
  gstRate: number;
  suppliers: InvoiceSupplierRow[];
  maps: InvoiceItemMapRow[];
  chargeRules: InvoiceChargeRuleRow[];
  /** the minimal ingredient and ordering-product fields the engine reads */
  ingredients: AnalyseIngredient[];
  products: AnalyseProduct[];
  /** invoices already filed, for duplicate detection: venue + supplier + number */
  existingDocs: { id: string; venue_id: number; supplier_id: string | null; invoice_number: string | null; status: DocStatus; invoice_date?: string | null; total_inc?: number | null }[];
  /** today's Brisbane date, injected so tests are deterministic */
  today: string;
}

export interface AnalyseIngredient {
  id: string;
  name: string;
  supplier_id: number | null;
  supplier_code: string | null;
  pack_size: number;
  pack_unit: string; // g | kg | ml | L | each
  pack_price: number;
  price_inc_gst: boolean;
  gst_free: boolean;
  last_price_update: string | null;
  active: boolean;
  /** buy-X-get-Y deal rows are looked at by the caller; true means a deal changes the effective price, so never auto-apply */
  has_deal: boolean;
}

export interface AnalyseProduct {
  id: string;
  venue_id: number;
  name: string;
  supplier_item_code: string | null;
  supplier_name: string | null;
  unit_name: string;
  price_inc_gst: number | null;
  ingredient_id: string | null;
  costing_packs_per_unit: number | null;
  deal_buy_qty: number | null;
  deal_free_qty: number | null;
  active: boolean;
}

export interface AnalysedLine extends Omit<InvoiceLineRow, "id" | "document_id" | "created_at"> {
  /** index into ExtractedInvoice.lines */
  source_index: number;
}

export interface AnalysedQuestion {
  kind: QuestionKind;
  /** line_no this is about, or null for the whole document */
  line_no: number | null;
  prompt: string;
  options: QuestionOption[];
}

export interface InvoiceAnalysis {
  supplier_id: string | null;
  /** a supplier the system has never seen: the caller creates it (and asks a new_supplier question) */
  new_supplier: { name: string; abn: string | null } | null;
  venue_check: VenueCheck;
  price_basis: "ex" | "inc" | "mixed" | null;
  reconciled: boolean;
  recon_notes: ReconNote[];
  fee_pool_ex: number;
  lines: AnalysedLine[];
  questions: AnalysedQuestion[];
  /** duplicate of an invoice already filed */
  duplicate_of: string | null;
  mode: "learning" | "auto";
  status: DocStatus;
  summary: { products: number; matched: number; same: number; to_apply: number; need_approval: number; unmatched: number };
}

// ---------------------------------------------------------------- the apply and undo contract (lib/invoice-apply.ts)
export interface PlannedChange {
  line_id: string;
  document_id: string;
  venue_id: number;
  target: ChangeTarget;
  target_id: string;
  kind: "price_change" | "price_confirmed";
  old_price: number | null;
  new_price: number;
  /** the label the price log shows: "Invoice 51329 · Daniel Street Fish Market · 14 Oct 2026" */
  source_label: string;
}

/** Average and last cost per ingredient, worked out from invoice lines (lib/invoice-cost-stats.ts). */
export interface IngredientInvoiceCost {
  ingredient_id: string;
  base_unit: string | null;
  last: { invoice_date: string; document_id: string; unit_price_base: number; landed_base: number } | null;
  /** quantity-weighted over the window: total landed dollars / total base quantity */
  average_landed_base: number | null;
  deliveries: number;
  window_days: number;
}

/** Strings used on the price log and in history, so every screen words it the same. */
export const INVOICE_SOURCE_PREFIX = "Invoice";
