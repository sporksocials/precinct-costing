/**
 * Invoices: data access for the questions screen, Settings > Invoices, the AI cost block and the ingredient page.
 * (E1 keeps its own in lib/invoice-data.ts; this file is separate so the two never clash.)
 *
 * Callers pass the Supabase client (the signed-in browser client in the app, a fake in tests). Reads that hit a table
 * that does not exist yet (the Invoices migration not applied) come back empty with `available: false`, never an error.
 * Every INSERT goes through insertRow (strips null keys, so a column with a database default gets its default).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTable } from "./change-log";
import { insertRow } from "./store";
import type { InvoiceChargeRuleRow, InvoiceLineRow, InvoiceQuestionRow, InvoiceSupplierRow } from "./invoice-types";
import type { ProductLite, QDoc, QLine, QuestionBundle } from "./invoice-questions-view";
import type { AiUsageLite } from "./invoice-settings-view";
import type { IngDocLite, LedgerLite } from "./invoice-ingredient-view";

export const INVOICES_UNAVAILABLE = "Invoices are not set up in the database yet. Ask SPORK to apply the Invoices update.";

type DbError = { code?: string; message?: string } | null | undefined;

const BUCKET = "invoice-pdfs";
const IN_CHUNK = 100;

function chunk<T>(xs: readonly T[], n = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

const uniq = <T>(xs: (T | null | undefined)[]): T[] => [...new Set(xs.filter((x): x is T => x != null))];

/** Turns a Supabase error into a plain message. A missing table is reported as unavailable by the callers, not thrown. */
function plain(error: NonNullable<DbError>, what: string): Error {
  if (error.code === "23505") return new Error(`${what} already exists with that name or ABN.`);
  return new Error(error.message ? `${what}: ${error.message}` : what);
}

/** Selects rows `in` a list of ids, a hundred at a time (a long list would overflow the request address). */
async function selectIn<T>(sb: SupabaseClient, table: string, columns: string, col: string, ids: readonly string[]): Promise<T[]> {
  const out: T[] = [];
  for (const part of chunk(ids)) {
    const { data, error } = await sb.from(table).select(columns).in(col, part);
    if (error) {
      if (isMissingTable(error)) return out;
      throw plain(error, "Could not load invoice details");
    }
    out.push(...((data ?? []) as unknown as T[]));
  }
  return out;
}

/* ---------------------------------------------------------------- questions */

const DOC_COLS = "id,venue_id,supplier_id,supplier_name_read,invoice_number,invoice_date,page_pdf_path,status";
const LINE_COLS = "id,line_no,page,item_code,description,qty,unit,unit_price_ex,line_total_ex,ingredient_id,product_id,gst";

export interface QuestionLoad {
  bundles: QuestionBundle[];
  /** false when the invoice tables are not in the database yet */
  available: boolean;
}

/**
 * Questions of one status with their invoice, line and supplier name. Open ones come newest first by when they were raised;
 * answered ones newest first by when they were answered. `venueId` and `docId` narrow the list.
 */
export async function loadQuestionBundles(sb: SupabaseClient, opts: { status: "open" | "answered"; venueId?: number | null; docId?: string | null; limit?: number }): Promise<QuestionLoad> {
  const orderCol = opts.status === "open" ? "created_at" : "answered_at";
  let q = sb.from("invoice_questions").select("*").eq("status", opts.status);
  if (opts.venueId != null) q = q.eq("venue_id", opts.venueId);
  if (opts.docId) q = q.eq("document_id", opts.docId);
  q = q.order(orderCol, { ascending: false });
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) {
    if (isMissingTable(error)) return { bundles: [], available: false };
    throw plain(error, "Could not load the questions");
  }
  const qs = (data ?? []) as InvoiceQuestionRow[];
  if (!qs.length) return { bundles: [], available: true };
  const [docs, lines] = await Promise.all([
    selectIn<QDoc>(sb, "invoice_documents", DOC_COLS, "id", uniq(qs.map((x) => x.document_id))),
    selectIn<QLine>(sb, "invoice_lines", LINE_COLS, "id", uniq(qs.map((x) => x.line_id))),
  ]);
  const suppliers = await selectIn<Pick<InvoiceSupplierRow, "id" | "name" | "cost_supplier_id">>(sb, "invoice_suppliers", "id,name,cost_supplier_id", "id", uniq(docs.map((d) => d.supplier_id)));
  const docById = new Map(docs.map((d) => [d.id, d]));
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const bundles = qs.map((row): QuestionBundle => {
    const doc = docById.get(row.document_id) ?? null;
    const sup = doc?.supplier_id ? supplierById.get(doc.supplier_id) : undefined;
    return {
      q: { ...row, options: Array.isArray(row.options) ? row.options : [] },
      doc,
      line: row.line_id ? lineById.get(row.line_id) ?? null : null,
      supplierName: sup?.name ?? null,
      costSupplierId: sup?.cost_supplier_id ?? null,
    };
  });
  return { bundles, available: true };
}

/** The ordering products named by answer options (for their current prices). A failure gives none: the buttons then show no price. */
export async function loadProductsByIds(sb: SupabaseClient, ids: readonly string[]): Promise<ProductLite[]> {
  if (!ids.length) return [];
  try {
    const rows = await selectIn<ProductLite>(sb, "ordering_products", "id,name,unit_name,price_inc_gst", "id", ids);
    return rows.map((p) => ({ ...p, price_inc_gst: p.price_inc_gst == null ? null : Number(p.price_inc_gst) }));
  } catch {
    return [];
  }
}

/** A short-lived link to the split PDF of one invoice (ten minutes). Null when there is no file or the link could not be made. */
export async function signedPdfUrl(sb: SupabaseClient, path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  try {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 600);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- settings */

/** Saves one numeric setting (cost_settings key/value). Throws a plain message when it did not save. */
export async function saveNumericSetting(sb: SupabaseClient, key: string, value: number): Promise<void> {
  const { error } = await sb.from("cost_settings").upsert([{ key, value }], { onConflict: "key" });
  if (error) throw plain(error, "That did not save");
}

export interface SettingsLoad<T> {
  rows: T[];
  available: boolean;
}

export async function loadInvoiceSuppliers(sb: SupabaseClient): Promise<SettingsLoad<InvoiceSupplierRow>> {
  const { data, error } = await sb.from("invoice_suppliers").select("*").order("name", { ascending: true });
  if (error) {
    if (isMissingTable(error)) return { rows: [], available: false };
    throw plain(error, "Could not load the suppliers");
  }
  return { rows: ((data ?? []) as InvoiceSupplierRow[]).map((s) => ({ ...s, aliases: Array.isArray(s.aliases) ? s.aliases : [] })), available: true };
}

export type SupplierPatch = Partial<Pick<InvoiceSupplierRow, "name" | "abn" | "aliases" | "allocation_basis" | "auto_apply" | "notes" | "active">>;

/** Updates one invoice supplier. A write that touches no row (row level security can do that silently) is a failure. */
export async function updateInvoiceSupplier(sb: SupabaseClient, id: string, patch: SupplierPatch): Promise<InvoiceSupplierRow> {
  const { data, error } = await sb.from("invoice_suppliers").update(patch).eq("id", id).select("*");
  if (error) throw plain(error, "Supplier");
  const row = (data as InvoiceSupplierRow[] | null)?.[0];
  if (!row) throw new Error("That did not save.");
  return row;
}

export async function loadChargeRules(sb: SupabaseClient): Promise<SettingsLoad<InvoiceChargeRuleRow>> {
  const { data, error } = await sb.from("invoice_charge_rules").select("*").order("created_at", { ascending: true });
  if (error) {
    if (isMissingTable(error)) return { rows: [], available: false };
    throw plain(error, "Could not load the charge rules");
  }
  return { rows: (data ?? []) as InvoiceChargeRuleRow[], available: true };
}

export type RulePatch = Partial<Pick<InvoiceChargeRuleRow, "match_text" | "line_class" | "spread" | "note" | "active" | "supplier_id">>;

export async function updateChargeRule(sb: SupabaseClient, id: string, patch: RulePatch): Promise<InvoiceChargeRuleRow> {
  const { data, error } = await sb.from("invoice_charge_rules").update(patch).eq("id", id).select("*");
  if (error) throw plain(error, "Rule");
  const row = (data as InvoiceChargeRuleRow[] | null)?.[0];
  if (!row) throw new Error("That did not save.");
  return row;
}

export type RuleDraft = Pick<InvoiceChargeRuleRow, "match_text" | "line_class" | "spread"> & Partial<Pick<InvoiceChargeRuleRow, "note" | "supplier_id">>;

/** Adds a rule (every insert goes through insertRow). Rules are never deleted: switch Active off. */
export async function insertChargeRule(sb: SupabaseClient, draft: RuleDraft): Promise<InvoiceChargeRuleRow> {
  const { data, error } = await insertRow(sb, "invoice_charge_rules", { ...draft, active: true }).select("*");
  if (error) throw plain(error, "Rule");
  const row = (data as InvoiceChargeRuleRow[] | null)?.[0];
  if (!row) throw new Error("That did not save.");
  return row;
}

/* ---------------------------------------------------------------- AI cost */

const PAGE = 1000;
const MAX_PAGES = 10;

export interface AiUsageLoad {
  /** the signed-in person may see the AI cost (rows came back, or their email is on the viewers list) */
  visible: boolean;
  rows: AiUsageLite[];
}

/**
 * The usage log from `sinceIso` on. Row level security gives anyone but a cost viewer an empty answer, so "rows came back" is
 * the first test; a viewer with no usage yet is found through ai_cost_viewers (which only ever shows their own email).
 * Any failure reads as "not visible": the block then renders nothing at all.
 */
export async function loadAiUsage(sb: SupabaseClient, sinceIso: string): Promise<AiUsageLoad> {
  try {
    const rows: AiUsageLite[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await sb
        .from("ai_usage_log")
        .select("at,feature,cost_usd,document_id,file_id,ok")
        .gte("at", sinceIso)
        .order("at", { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) return { visible: false, rows: [] };
      const got = (data ?? []) as AiUsageLite[];
      rows.push(...got.map((r) => ({ ...r, cost_usd: Number(r.cost_usd) || 0 })));
      if (got.length < PAGE) break;
    }
    if (rows.length) return { visible: true, rows };
    const { data, error } = await sb.from("ai_cost_viewers").select("email").limit(1);
    if (error) return { visible: false, rows: [] };
    return { visible: ((data as unknown[] | null) ?? []).length > 0, rows: [] };
  } catch {
    return { visible: false, rows: [] };
  }
}

/* ---------------------------------------------------------------- ingredient page */

export type IngInvoiceLine = Pick<InvoiceLineRow, "ingredient_id" | "document_id" | "invoice_date" | "line_class" | "unit_price_ex" | "landed_total_ex" | "landed_base_ex" | "base_qty" | "base_unit" | "packs_per_unit" | "state">;

const ING_LINE_COLS = "ingredient_id,document_id,invoice_date,line_class,unit_price_ex,landed_total_ex,landed_base_ex,base_qty,base_unit,packs_per_unit,state";
const DOC_SKIP = new Set(["duplicate", "ignored", "failed"]);

/**
 * Every invoice line that names this ingredient, with the invoices they sit on. Lines on an invoice that is a duplicate, ignored
 * or failed are left out (they would be counted twice, or not be real). A missing table or any failure gives no lines.
 */
export async function loadIngredientInvoiceLines(sb: SupabaseClient, ingredientId: string): Promise<{ lines: IngInvoiceLine[]; docs: Map<string, IngDocLite> }> {
  const empty = { lines: [] as IngInvoiceLine[], docs: new Map<string, IngDocLite>() };
  try {
    const { data, error } = await sb.from("invoice_lines").select(ING_LINE_COLS).eq("ingredient_id", ingredientId).order("invoice_date", { ascending: false }).limit(500);
    if (error || !data?.length) return empty;
    const lines = (data as IngInvoiceLine[]).map((l) => ({
      ...l,
      unit_price_ex: l.unit_price_ex == null ? null : Number(l.unit_price_ex),
      landed_total_ex: l.landed_total_ex == null ? null : Number(l.landed_total_ex),
      landed_base_ex: l.landed_base_ex == null ? null : Number(l.landed_base_ex),
      base_qty: l.base_qty == null ? null : Number(l.base_qty),
      packs_per_unit: l.packs_per_unit == null ? null : Number(l.packs_per_unit),
    }));
    const docRows = await selectIn<{ id: string; invoice_number: string | null; invoice_date: string | null; supplier_id: string | null; supplier_name_read: string | null; status: string }>(
      sb,
      "invoice_documents",
      "id,invoice_number,invoice_date,supplier_id,supplier_name_read,status",
      "id",
      uniq(lines.map((l) => l.document_id)),
    );
    const suppliers = await selectIn<Pick<InvoiceSupplierRow, "id" | "name">>(sb, "invoice_suppliers", "id,name", "id", uniq(docRows.map((d) => d.supplier_id)));
    const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
    const docs = new Map<string, IngDocLite>();
    for (const d of docRows) {
      if (DOC_SKIP.has(d.status)) continue;
      docs.set(d.id, { id: d.id, invoice_number: d.invoice_number, invoice_date: d.invoice_date, supplier_name: (d.supplier_id ? supplierName.get(d.supplier_id) : null) ?? d.supplier_name_read });
    }
    return { lines: lines.filter((l) => docs.has(l.document_id)), docs };
  } catch {
    return empty;
  }
}

/** The undo ledger rows for one ingredient (empty when the table is missing or anything fails). */
export async function loadLedgerForIngredient(sb: SupabaseClient, ingredientId: string): Promise<LedgerLite[]> {
  try {
    const { data, error } = await sb
      .from("invoice_price_changes")
      .select("id,document_id,kind,status,old_price,new_price,old_last_price_update,cost_log_id")
      .eq("target", "ingredient")
      .eq("target_id", ingredientId)
      .order("applied_at", { ascending: false })
      .limit(500);
    if (error) return [];
    return ((data ?? []) as LedgerLite[]).map((r) => ({ ...r, old_price: r.old_price == null ? null : Number(r.old_price), new_price: r.new_price == null ? null : Number(r.new_price) }));
  } catch {
    return [];
  }
}
