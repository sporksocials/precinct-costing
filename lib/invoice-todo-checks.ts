/**
 * Invoices > To Do > Check These: the odd ones. Pure rules for which open questions belong here, the one plain sentence for each,
 * and the loader. Nothing here writes. The answers go through lib/invoice-answer.ts (answerQuestion) from the screen.
 *
 * What lands here: a pack size nobody has given (unit_unclear), totals that do not add up (totals_mismatch), a credit nobody can
 * place (credit_unclear), a charge or GST question (other), and a supplier that could be more than one of ours or whose ABN does
 * not match (new_supplier with a real choice). What does NOT land here: matching lines to items (the Match Items job), big price
 * changes (those are rows in Approve Prices, where approving them settles the question), venue questions (retired: prices are
 * shared across venues) and the old "is this a new supplier?" question (new suppliers are created silently now).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTable } from "./change-log";
import { NOT_COUNTED } from "./invoice-view";
import { plain, tidyLabel, tidySupplierName } from "./invoice-names";
import type { DocStatus, InvoiceDocumentRow, InvoiceLineRow, InvoiceQuestionRow, QuestionKind } from "./invoice-types";

/** The question kinds this screen can show. big_change and venue_mismatch are deliberately absent. */
export const CHECK_KINDS: readonly QuestionKind[] = ["unit_unclear", "totals_mismatch", "credit_unclear", "other", "new_supplier"];

export type CheckDoc = Pick<InvoiceDocumentRow, "id" | "venue_id" | "supplier_id" | "supplier_name_read" | "invoice_number" | "invoice_date" | "page_pdf_path" | "status">;
export type CheckLine = Pick<InvoiceLineRow, "id" | "line_no" | "item_code" | "description" | "qty" | "unit" | "unit_price_ex" | "line_total_ex">;

export interface CheckTask {
  q: InvoiceQuestionRow;
  doc: CheckDoc;
  line: CheckLine | null;
  supplierName: string;
  /** ONE plain sentence of what is odd */
  sentence: string;
  /** the specifics, quiet; null when the sentence says it all */
  detail: string | null;
}

/** A supplier question is worth asking only when there is a real choice or a real doubt, not for "is this a new supplier?". */
export function isSupplierDoubt(q: Pick<InvoiceQuestionRow, "kind" | "options">): boolean {
  if (q.kind !== "new_supplier") return false;
  const ids = (q.options ?? []).map((o) => o.id);
  return ids.includes("same_supplier") || ids.includes("reread") || ids.some((id) => id.startsWith("supplier:"));
}

/** True when an open question belongs on the Check These list. */
export function isCheckQuestion(q: Pick<InvoiceQuestionRow, "kind" | "options" | "status">): boolean {
  if (q.status !== "open") return false;
  if (q.kind === "new_supplier") return isSupplierDoubt(q);
  return CHECK_KINDS.includes(q.kind);
}

/** A question on an invoice that is a duplicate, failed or set aside no longer needs anyone. */
export const docCounts = (status: DocStatus | undefined): boolean => status !== undefined && !NOT_COUNTED.includes(status);

/** What the reader found wrong with the totals, from the stored prompt: "Invoice 792741 from X does not add up. <reasons> No prices change until it is checked." */
export function totalsReason(prompt: string): string | null {
  const s = plain(prompt).replace(/^.*?does not add up\.?\s*/i, "").replace(/\s*No prices change until it is checked\.?$/i, "").trim();
  return s === "" ? null : s;
}

export function checkSentence(q: Pick<InvoiceQuestionRow, "kind" | "prompt" | "options">, line: Pick<CheckLine, "description"> | null): { sentence: string; detail: string | null } {
  const prompt = plain(q.prompt);
  switch (q.kind) {
    case "totals_mismatch":
      return { sentence: "The totals do not add up.", detail: totalsReason(prompt) };
    case "unit_unclear":
      return { sentence: line ? `Pack size is unclear for ${tidyLabel(line.description, 50)}.` : "A pack size is unclear.", detail: prompt };
    case "credit_unclear":
      return { sentence: "A credit on this invoice needs a look.", detail: prompt };
    case "new_supplier": {
      const ids = (q.options ?? []).map((o) => o.id);
      if (ids.includes("same_supplier")) return { sentence: "The supplier's ABN does not match the one we have.", detail: prompt };
      if (ids.some((id) => id.startsWith("supplier:"))) return { sentence: "It could be more than one of our suppliers.", detail: prompt };
      return { sentence: "We could not read which supplier sent this.", detail: prompt };
    }
    default:
      return { sentence: prompt, detail: null };
  }
}

const SELECT_DOC = "id,venue_id,supplier_id,supplier_name_read,invoice_number,invoice_date,page_pdf_path,status";
const SELECT_LINE = "id,line_no,item_code,description,qty,unit,unit_price_ex,line_total_ex";
const CHUNK = 80;

async function inChunks<T>(sb: SupabaseClient, table: string, cols: string, ids: readonly string[]): Promise<T[]> {
  const out: T[] = [];
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const { data, error } = await sb.from(table).select(cols).in("id", uniq.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as unknown as T[]));
  }
  return out;
}

export interface CheckLoad {
  /** the invoice tables are not in the database yet */
  missing: boolean;
  tasks: CheckTask[];
}

/**
 * Every open check, newest invoice first. `venueId` null means all venues. Throws on a real failure (the caller shows it);
 * a missing table is `missing: true`.
 */
export async function loadCheckTasks(sb: SupabaseClient, venueId: number | null): Promise<CheckLoad> {
  let query = sb.from("invoice_questions").select("*").eq("status", "open").in("kind", [...CHECK_KINDS]);
  if (venueId != null) query = query.eq("venue_id", venueId);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) {
    if (isMissingTable(error)) return { missing: true, tasks: [] };
    throw new Error(error.message);
  }
  const questions = ((data ?? []) as InvoiceQuestionRow[]).map((q) => ({ ...q, options: Array.isArray(q.options) ? q.options : [] })).filter(isCheckQuestion);
  if (questions.length === 0) return { missing: false, tasks: [] };
  const [docs, lines] = await Promise.all([
    inChunks<CheckDoc>(sb, "invoice_documents", SELECT_DOC, questions.map((q) => q.document_id)),
    inChunks<CheckLine>(sb, "invoice_lines", SELECT_LINE, questions.map((q) => q.line_id).filter((x): x is string => !!x)),
  ]);
  const suppliers = await inChunks<{ id: string; name: string }>(sb, "invoice_suppliers", "id,name", docs.map((d) => d.supplier_id).filter((x): x is string => !!x));
  const docById = new Map(docs.map((d) => [d.id, d]));
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const supplierById = new Map(suppliers.map((s) => [s.id, s.name]));
  const tasks: CheckTask[] = [];
  for (const q of questions) {
    const doc = docById.get(q.document_id);
    if (!doc || !docCounts(doc.status)) continue;
    const line = q.line_id ? (lineById.get(q.line_id) ?? null) : null;
    const { sentence, detail } = checkSentence(q, line);
    tasks.push({ q, doc, line, supplierName: (doc.supplier_id ? supplierById.get(doc.supplier_id) : undefined) ?? (tidySupplierName(doc.supplier_name_read) || "Unknown supplier"), sentence, detail });
  }
  tasks.sort((a, b) => (b.doc.invoice_date ?? "").localeCompare(a.doc.invoice_date ?? "") || a.doc.id.localeCompare(b.doc.id) || (a.line?.line_no ?? -1) - (b.line?.line_no ?? -1));
  return { missing: false, tasks };
}

/** Plain labels for the answer buttons the engine offers, Title Case, by option id. Anything unknown keeps its own label, capitalised. */
const LABELS: Record<string, string> = {
  reread: "Read It Again",
  ignore_document: "Set This Invoice Aside",
  ignore_line: "Ignore This Line",
  credit_leave: "Leave It",
  spread_charge: "Spread It Over The Products",
  leave_out_charge: "Leave It Out Of Cost",
  same_supplier: "Yes, Same Supplier",
  add_supplier: "No, Add A New Supplier",
};
export function answerLabel(o: { id: string; label: string }): string {
  if (LABELS[o.id]) return LABELS[o.id];
  const t = plain(o.label);
  return t === "" ? "Answer" : t.charAt(0).toUpperCase() + t.slice(1);
}
/** Answers that end an invoice's story or cannot be taken back easily: they ask first. */
export const NEEDS_SURE: ReadonlySet<string> = new Set(["ignore_document"]);
export const SURE_TEXT: Record<string, string> = {
  ignore_document: "No prices will be read from this invoice. You can still find it in the invoice list.",
};
