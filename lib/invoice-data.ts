/**
 * Invoices: reads for the Home card, the Invoices list and the invoice page, and the one plain write the screens make themselves
 * (Skip a line). Every function takes the Supabase client, so a test can pass a fake and demo mode passes its in-memory client.
 * Invoice data is NOT part of the store's global blob: each screen loads what it needs, when it opens.
 *
 * Nothing here ever writes a price. Prices change only through lib/invoice-apply.ts (applyLine, undoChange, undoDocument), which
 * keeps the undo ledger and the price history.
 *
 * Before the migration is applied the invoice tables do not exist: every read then says `missing` (or, for Home, nothing) and the
 * screens show a calm empty state. In demo mode the in-memory client has no invoice tables, so lists come back empty.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSchemaMissingError } from "./health";
import { getSupabaseBrowser } from "./supabase/client";
import type {
  DocStatus,
  InvoiceChargeRuleRow,
  InvoiceDocumentRow,
  InvoiceLineRow,
  InvoicePriceChangeRow,
  InvoiceQuestionRow,
} from "./invoice-types";
import { recomputeDocumentStatus } from "./invoice-store";
import { last30Range, type ChangeLite, type DocLite } from "./invoice-view";

const PAGE_SIZE = 1000;
const CHUNK = 80;

type Res = { data: unknown[] | null; error: { message: string; code?: string } | null; count?: number | null };

class InvoiceReadError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "InvoiceReadError";
  }
}

function must(r: Res, what: string): unknown[] {
  if (r.error) throw new InvoiceReadError(`${what}: ${r.error.message}`, r.error.code);
  return r.data ?? [];
}

async function pageAll<T>(what: string, build: (from: number, to: number) => PromiseLike<Res>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const rows = must(await build(from, from + PAGE_SIZE - 1), what) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

async function inChunks<T>(what: string, ids: readonly string[], run: (chunk: string[]) => PromiseLike<Res>): Promise<T[]> {
  const uniq = [...new Set(ids)];
  const out: T[] = [];
  for (let i = 0; i < uniq.length; i += CHUNK) out.push(...(must(await run(uniq.slice(i, i + CHUNK)), what) as T[]));
  return out;
}

/** True when the error only means "the invoice tables are not in the database yet". */
export function invoiceTablesMissing(e: unknown): boolean {
  return isSchemaMissingError(e) || (e instanceof InvoiceReadError && isSchemaMissingError({ code: e.code, message: e.message }));
}

const num = (v: unknown): number | null => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const numRow = <T extends object>(row: T, keys: string[]): T => {
  const r = { ...row } as Record<string, unknown>;
  for (const k of keys) if (k in r) r[k] = num(r[k]);
  return r as T;
};
const DOC_NUMS = ["subtotal_ex", "gst_total", "total_inc", "fee_pool_ex"];
const LINE_NUMS = [
  "qty", "unit_price_ex", "line_total_ex", "gst_amount", "packs_per_unit", "base_qty", "fee_share_ex", "landed_total_ex", "landed_unit_ex", "landed_base_ex",
  "old_pack_price", "new_pack_price", "old_product_price", "new_product_price", "change_pct",
];
const CHANGE_NUMS = ["old_price", "new_price", "old_previous_price"];
export const readDoc = (r: unknown): InvoiceDocumentRow => {
  const d = numRow(r as InvoiceDocumentRow, DOC_NUMS);
  d.fee_pool_ex = d.fee_pool_ex ?? 0;
  d.recon_notes = Array.isArray(d.recon_notes) ? d.recon_notes : [];
  d.pages = Array.isArray(d.pages) ? d.pages : [];
  return d;
};
export const readLine = (r: unknown): InvoiceLineRow => {
  const l = numRow(r as InvoiceLineRow, LINE_NUMS);
  l.fee_share_ex = l.fee_share_ex ?? 0;
  return l;
};
export const readChange = (r: unknown): InvoicePriceChangeRow => numRow(r as InvoicePriceChangeRow, CHANGE_NUMS);

// ---------------------------------------------------------------- Home

export interface HomeData {
  docs: DocLite[];
  changes: ChangeLite[];
  /** one entry per open question and per line waiting for approval, with its document's status */
  waiting: { status: DocStatus }[];
  /** every document ever filed (a head count), so "no data at all" is known without loading them */
  totalDocs: number;
}

/** What waits on a person, from the two tables, with each item's document status. */
async function loadWaiting(sb: SupabaseClient): Promise<{ questions: { id: string; document_id: string }[]; lines: { id: string; document_id: string }[]; status: Map<string, DocStatus> }> {
  const [questions, lines] = await Promise.all([
    pageAll<{ id: string; document_id: string }>("invoice_questions", (a, b) => sb.from("invoice_questions").select("id,document_id").eq("status", "open").range(a, b)),
    pageAll<{ id: string; document_id: string }>("invoice_lines", (a, b) => sb.from("invoice_lines").select("id,document_id").eq("decision", "needs_approval").eq("state", "open").range(a, b)),
  ]);
  const ids = [...questions.map((q) => q.document_id), ...lines.map((l) => l.document_id)];
  const docs = await inChunks<{ id: string; status: DocStatus }>("invoice_documents", ids, (c) => sb.from("invoice_documents").select("id,status").in("id", c));
  return { questions, lines, status: new Map(docs.map((d) => [d.id, d.status])) };
}

/**
 * The Home card's data. Returns null when it cannot be read for ANY reason (the tables are not applied yet, no network, no
 * permission): the card then hides itself rather than showing zeros or an error on the Home screen.
 */
export async function loadInvoiceHome(sb: SupabaseClient, today: string): Promise<HomeData | null> {
  try {
    const since = `${last30Range(today).from}T00:00:00+10:00`;
    const [docs, changes, total, waiting] = await Promise.all([
      pageAll<DocLite>("invoice_documents", (a, b) => sb.from("invoice_documents").select("id,status,created_at").gte("created_at", since).order("created_at", { ascending: false }).range(a, b)),
      pageAll<ChangeLite>("invoice_price_changes", (a, b) => sb.from("invoice_price_changes").select("kind,status,applied_at").gte("applied_at", since).order("applied_at", { ascending: false }).range(a, b)),
      (async () => (await sb.from("invoice_documents").select("id", { count: "exact", head: true })) as unknown as Res)(),
      loadWaiting(sb),
    ]);
    if (total.error) return null;
    const waits = [...waiting.questions, ...waiting.lines].map((w) => ({ status: waiting.status.get(w.document_id) ?? ("needs_review" as DocStatus) }));
    return { docs, changes, waiting: waits, totalDocs: total.count ?? docs.length };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the list

export interface ListData {
  /** the invoice tables are not in the database yet */
  missing: boolean;
  documents: InvoiceDocumentRow[];
  supplierNames: Map<string, string>;
  questions: { id: string; document_id: string }[];
  approvalLines: { id: string; document_id: string }[];
  changes: InvoicePriceChangeRow[];
}
const EMPTY_LIST: ListData = { missing: false, documents: [], supplierNames: new Map(), questions: [], approvalLines: [], changes: [] };

export async function loadInvoiceList(sb: SupabaseClient): Promise<ListData> {
  try {
    const [documents, suppliers, waiting, changes] = await Promise.all([
      pageAll<unknown>("invoice_documents", (a, b) => sb.from("invoice_documents").select("*").order("created_at", { ascending: false }).range(a, b)),
      pageAll<{ id: string; name: string }>("invoice_suppliers", (a, b) => sb.from("invoice_suppliers").select("id,name").range(a, b)),
      loadWaiting(sb),
      pageAll<unknown>("invoice_price_changes", (a, b) => sb.from("invoice_price_changes").select("*").order("applied_at", { ascending: false }).range(a, b)),
    ]);
    return {
      missing: false,
      documents: documents.map(readDoc),
      supplierNames: new Map(suppliers.map((s) => [s.id, s.name])),
      questions: waiting.questions,
      approvalLines: waiting.lines,
      changes: changes.map(readChange),
    };
  } catch (e) {
    if (invoiceTablesMissing(e)) return { ...EMPTY_LIST, missing: true };
    throw e;
  }
}

export interface ChangeLookups {
  lines: Map<string, { description: string; item_code: string | null }>;
  products: Map<string, { name: string; price: number | null }>;
}
/** The line text and ordering-product names behind a page of price changes. Missing names just stay out of the maps. */
export async function loadChangeLookups(sb: SupabaseClient, changes: readonly InvoicePriceChangeRow[]): Promise<ChangeLookups> {
  const out: ChangeLookups = { lines: new Map(), products: new Map() };
  try {
    const [lines, products] = await Promise.all([
      inChunks<{ id: string; description: string; item_code: string | null }>("invoice_lines", changes.map((c) => c.line_id), (c) => sb.from("invoice_lines").select("id,description,item_code").in("id", c)),
      inChunks<{ id: string; name: string; price_inc_gst: unknown }>("ordering_products", changes.filter((c) => c.target === "ordering_product").map((c) => c.target_id), (c) => sb.from("ordering_products").select("id,name,price_inc_gst").in("id", c)),
    ]);
    for (const l of lines) out.lines.set(l.id, { description: l.description, item_code: l.item_code });
    for (const p of products) out.products.set(p.id, { name: p.name, price: num(p.price_inc_gst) });
  } catch {
    /* names are a nicety: the rows still show the invoice line */
  }
  return out;
}

// ---------------------------------------------------------------- one invoice

export interface DetailData {
  missing: boolean;
  doc: InvoiceDocumentRow | null;
  supplierName: string | null;
  lines: InvoiceLineRow[];
  changes: InvoicePriceChangeRow[];
  /** open questions for this document */
  questions: InvoiceQuestionRow[];
  chargeRules: InvoiceChargeRuleRow[];
  products: Map<string, { name: string; price: number | null }>;
  pdfUrl: string | null;
}
const EMPTY_DETAIL: DetailData = { missing: false, doc: null, supplierName: null, lines: [], changes: [], questions: [], chargeRules: [], products: new Map(), pdfUrl: null };

/** A short-lived link to the invoice's own PDF (10 minutes). Null when there is no file or the link could not be made. */
export async function signedPdfUrl(sb: SupabaseClient, path: string | null): Promise<string | null> {
  if (!path) return null;
  try {
    const { data, error } = await sb.storage.from("invoice-pdfs").createSignedUrl(path, 600);
    return error ? null : (data?.signedUrl ?? null);
  } catch {
    return null;
  }
}

export async function loadInvoiceDetail(sb: SupabaseClient, id: string): Promise<DetailData> {
  try {
    const docRows = must((await sb.from("invoice_documents").select("*").eq("id", id)) as Res, "invoice_documents");
    if (!docRows.length) return { ...EMPTY_DETAIL };
    const doc = readDoc(docRows[0]);
    const [lines, changes, questions, rules, supplier] = await Promise.all([
      pageAll<unknown>("invoice_lines", (a, b) => sb.from("invoice_lines").select("*").eq("document_id", id).order("line_no", { ascending: true }).range(a, b)),
      pageAll<unknown>("invoice_price_changes", (a, b) => sb.from("invoice_price_changes").select("*").eq("document_id", id).order("applied_at", { ascending: true }).range(a, b)),
      pageAll<InvoiceQuestionRow>("invoice_questions", (a, b) => sb.from("invoice_questions").select("*").eq("document_id", id).eq("status", "open").order("created_at", { ascending: true }).range(a, b)),
      pageAll<InvoiceChargeRuleRow>("invoice_charge_rules", (a, b) => sb.from("invoice_charge_rules").select("*").eq("active", true).range(a, b)),
      doc.supplier_id ? (async () => (await sb.from("invoice_suppliers").select("id,name").eq("id", doc.supplier_id as string)) as unknown as Res)() : Promise.resolve({ data: [], error: null } as Res),
    ]);
    const lineRows = lines.map(readLine);
    const products = new Map<string, { name: string; price: number | null }>();
    try {
      const prods = await inChunks<{ id: string; name: string; price_inc_gst: unknown }>("ordering_products", lineRows.map((l) => l.product_id).filter((x): x is string => !!x), (c) => sb.from("ordering_products").select("id,name,price_inc_gst").in("id", c));
      for (const p of prods) products.set(p.id, { name: p.name, price: num(p.price_inc_gst) });
    } catch {
      /* product names are a nicety */
    }
    const supplierRow = must(supplier as Res, "invoice_suppliers")[0] as { name: string } | undefined;
    return {
      missing: false,
      doc,
      supplierName: supplierRow?.name ?? null,
      lines: lineRows,
      changes: changes.map(readChange),
      questions,
      chargeRules: rules,
      products,
      pdfUrl: await signedPdfUrl(sb, doc.page_pdf_path),
    };
  } catch (e) {
    if (invoiceTablesMissing(e)) return { ...EMPTY_DETAIL, missing: true };
    throw e;
  }
}

// ---------------------------------------------------------------- the one plain write: skip a line

export interface WriteResult {
  ok: boolean;
  message: string;
}
/**
 * Skip: a person says "leave the app's price alone" for one waiting line. A plain update of invoice_lines.state; no price is touched
 * and nothing is written to the undo ledger. The `from` state is part of the filter, so two people tapping at once cannot clash.
 */
async function setLineState(sb: SupabaseClient, lineId: string, from: "open" | "approved_skip", to: "open" | "approved_skip"): Promise<WriteResult> {
  const { data, error } = await sb.from("invoice_lines").update({ state: to }).eq("id", lineId).eq("state", from).select("id, document_id");
  if (error) return { ok: false, message: "That did not save. Check the connection and try again." };
  if (!data?.length) return { ok: false, message: "Someone else has already dealt with this line." };
  // the document's status follows its lines (a skipped last line can finish the invoice)
  try {
    await recomputeDocumentStatus(sb, (data[0] as { document_id: string }).document_id);
  } catch {
    // the skip itself is saved; the status catches up on the next change
  }
  return { ok: true, message: to === "approved_skip" ? "Skipped. The app's price stays as it is." : "Back on the list." };
}
export const skipLine = (sb: SupabaseClient, lineId: string) => setLineState(sb, lineId, "open", "approved_skip");
export const unskipLine = (sb: SupabaseClient, lineId: string) => setLineState(sb, lineId, "approved_skip", "open");

// ---------------------------------------------------------------- hooks

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  /** first load in flight (a reload keeps showing the data) */
  loading: boolean;
  reload: () => Promise<void>;
}

function useLoaded<T>(load: ((sb: SupabaseClient) => Promise<T>) | null, key: string): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const run = useCallback(async () => {
    const fn = loadRef.current;
    if (!fn) return;
    const mine = ++seq.current;
    try {
      const d = await fn(getSupabaseBrowser());
      if (mine !== seq.current) return;
      setData(d);
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e instanceof Error ? e.message : "Could not load invoices.");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    setLoading(true);
    void run();
    const onShow = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      seq.current++;
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [run, key]);
  return { data, error, loading, reload: run };
}

export function useInvoiceHome(today: string): Loaded<HomeData | null> {
  return useLoaded<HomeData | null>((sb) => loadInvoiceHome(sb, today), today);
}
export function useInvoiceList(): Loaded<ListData> {
  return useLoaded<ListData>(loadInvoiceList, "list");
}
export function useInvoiceDetail(id: string): Loaded<DetailData> {
  return useLoaded<DetailData>((sb) => loadInvoiceDetail(sb, id), id);
}
