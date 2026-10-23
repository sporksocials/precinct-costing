/**
 * Invoices: saves an analysis (document, lines, questions) and keeps the document's status honest.
 * Takes ANY Supabase client. Never touches a price: lib/invoice-apply.ts is the only module that does.
 *
 * Re-analysis rules (saveAnalysis with documentId):
 *  - A line that has been applied, confirmed or reverted is KEPT exactly as it is (a price was written from it, and the undo
 *    ledger points at it); its freshly analysed twin (same line_no) is skipped.
 *  - A line a person ignored or declined to apply keeps that state on its new row (their answer survives the re-read).
 *  - Questions: an answered one is never asked again (same kind and line number), an open one that no longer applies is
 *    dismissed, an open one that still applies is updated in place. New lines are written BEFORE the old ones are deleted so
 *    answered questions can be moved onto them (deleting a line deletes its questions).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "./invoice-context";
import { insertRow, insertRows } from "./invoice-insert";
import type { SaveAnalysis } from "./invoice-interfaces";
import type { DocStatus, InvoiceAnalysis, InvoiceLineRow, InvoiceQuestionRow, LineState } from "./invoice-types";

/** A line in one of these states has had a price written (or undone); re-analysis never replaces it. */
export const KEEP_STATES: LineState[] = ["applied", "confirmed", "reverted"];
/** A person's "leave this alone" survives re-analysis. */
export const CARRY_STATES: LineState[] = ["ignored", "approved_skip"];
/** States a status never leaves by itself: a person (or a failure) put the document there. */
const FROZEN_STATUSES: DocStatus[] = ["ignored", "duplicate", "failed"];

function check<T extends { error: any }>(res: T, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message ?? "database error"}`);
  return res;
}

/** The document status the lines and questions add up to. Pure. */
export function decideStatus(
  lines: Pick<InvoiceLineRow, "line_class" | "decision" | "state" | "match_state">[],
  openQuestions: number,
): DocStatus {
  const settled = lines.filter((l) => l.state === "applied" || l.state === "confirmed").length;
  const pending = lines.filter((l) => l.state === "open" && (l.decision === "apply" || l.decision === "needs_approval" || l.decision === "same")).length;
  const unmatched = lines.filter((l) => l.line_class === "product" && l.state === "open" && (l.match_state === "unmatched" || l.match_state === "ambiguous")).length;
  const clear = pending === 0 && unmatched === 0 && openQuestions === 0;
  if (settled > 0) return clear ? "applied" : "partly_applied";
  return clear ? "nothing_to_apply" : "needs_review";
}

/** Re-reads a document's lines and open questions and stores the status they add up to. A frozen status (ignored, duplicate, failed) is left alone. */
export async function recomputeDocumentStatus(sb: SupabaseClient, documentId: string): Promise<DocStatus> {
  const doc = check(await sb.from("invoice_documents").select("id,status").eq("id", documentId).maybeSingle(), "Could not read the invoice").data as { id: string; status: DocStatus } | null;
  if (!doc) throw new Error("That invoice no longer exists.");
  if (FROZEN_STATUSES.includes(doc.status)) return doc.status;
  const lines = (check(await sb.from("invoice_lines").select("line_class,decision,state,match_state").eq("document_id", documentId), "Could not read the lines").data ?? []) as any[];
  const open = (check(await sb.from("invoice_questions").select("id").eq("document_id", documentId).eq("status", "open"), "Could not read the questions").data ?? []).length;
  const status = decideStatus(lines, open);
  if (status !== doc.status) check(await sb.from("invoice_documents").update({ status }).eq("id", documentId), "Could not update the invoice status");
  return status;
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const nameKey = (s: string) => s.trim().toLowerCase();

/** The invoice_suppliers id for an analysis: the one it matched, else the one with that ABN or name, else a new row. */
async function resolveSupplier(sb: SupabaseClient, analysis: InvoiceAnalysis): Promise<string | null> {
  if (analysis.supplier_id) return analysis.supplier_id;
  const ns = analysis.new_supplier;
  if (!ns || !ns.name.trim()) return null;
  const abn = digits(ns.abn) || null;
  const all = await fetchAll<{ id: string; name: string; abn: string | null }>(sb, "invoice_suppliers", "id,name,abn");
  const find = () => all.find((s) => (abn && s.abn === abn) || nameKey(s.name) === nameKey(ns.name));
  const found = find();
  if (found) return found.id;
  const { data, error } = await insertRow(sb, "invoice_suppliers", { name: ns.name.trim(), abn }).select("id").single();
  if (!error && data) return (data as { id: string }).id;
  // lost a race with another reader: the unique index (ABN or lower(name)) says it now exists
  const again = await fetchAll<{ id: string; name: string; abn: string | null }>(sb, "invoice_suppliers", "id,name,abn");
  const hit = again.find((s) => (abn && s.abn === abn) || nameKey(s.name) === nameKey(ns.name));
  if (hit) return hit.id;
  throw new Error(`Could not save the supplier: ${error?.message ?? "unknown error"}`);
}

export const saveAnalysis: SaveAnalysis = async (sb, args) => {
  const { fileId, venueId, extracted, analysis, pagePdfPath, readModel, documentId } = args;

  const existingDoc = documentId
    ? (check(await sb.from("invoice_documents").select("id,status").eq("id", documentId).maybeSingle(), "Could not read the invoice").data as { id: string; status: DocStatus } | null)
    : null;
  if (documentId && !existingDoc) throw new Error("That invoice no longer exists, so it cannot be re-checked.");

  const supplierId = await resolveSupplier(sb, analysis);
  const duplicateOf = analysis.duplicate_of && analysis.duplicate_of !== documentId ? analysis.duplicate_of : null;
  const status: DocStatus = duplicateOf ? "duplicate" : existingDoc?.status === "ignored" ? "ignored" : analysis.status;

  const fields = {
    venue_id: venueId,
    file_id: fileId,
    supplier_id: supplierId,
    supplier_name_read: extracted.supplier_name,
    supplier_abn_read: digits(extracted.supplier_abn) || null,
    doc_type: extracted.doc_type,
    invoice_number: extracted.invoice_number,
    invoice_date: extracted.invoice_date,
    due_date: extracted.due_date,
    pages: extracted.pages,
    page_pdf_path: pagePdfPath,
    bill_to: extracted.bill_to,
    ship_to: extracted.ship_to,
    venue_check: analysis.venue_check,
    price_basis: analysis.price_basis,
    subtotal_ex: extracted.subtotal_ex,
    gst_total: extracted.gst_total,
    total_inc: extracted.total_inc,
    reconciled: analysis.reconciled,
    recon_notes: analysis.recon_notes,
    fee_pool_ex: analysis.fee_pool_ex,
    status,
    mode: analysis.mode,
    duplicate_of: duplicateOf,
    read_model: readModel,
  };

  // ---- the document row
  let docId: string;
  let finalStatus: DocStatus = status;
  if (documentId) {
    const res = check(await sb.from("invoice_documents").update(fields).eq("id", documentId).select("id"), "Could not update the invoice");
    if (!res.data || res.data.length === 0) throw new Error("That invoice no longer exists, so it cannot be re-checked.");
    docId = documentId;
  } else {
    let res = await insertRow(sb, "invoice_documents", fields).select("id").single();
    if (res.error && (res.error as any).code === "23505" && fields.supplier_id && fields.invoice_number) {
      // the same invoice is already filed (a race the analysis could not see): file this one as a duplicate of it
      const other = check(
        await sb.from("invoice_documents").select("id").eq("venue_id", venueId).eq("supplier_id", fields.supplier_id).eq("invoice_number", fields.invoice_number).neq("status", "duplicate").limit(1),
        "Could not read the invoice",
      ).data?.[0] as { id: string } | undefined;
      if (other) {
        finalStatus = "duplicate";
        res = await insertRow(sb, "invoice_documents", { ...fields, status: "duplicate", duplicate_of: other.id }).select("id").single();
      }
    }
    docId = (check(res, "Could not save the invoice").data as { id: string }).id;
  }
  const isDuplicate = duplicateOf !== null || finalStatus === "duplicate";

  // ---- lines
  const oldLines = documentId
    ? ((check(await sb.from("invoice_lines").select("id,line_no,state").eq("document_id", docId), "Could not read the lines").data ?? []) as { id: string; line_no: number; state: LineState }[])
    : [];
  const kept = oldLines.filter((l) => KEEP_STATES.includes(l.state));
  const keptNos = new Set(kept.map((l) => l.line_no));
  const doomed = oldLines.filter((l) => !KEEP_STATES.includes(l.state));
  const carried = new Map<number, LineState>();
  for (const l of oldLines) if (CARRY_STATES.includes(l.state)) carried.set(l.line_no, l.state);

  const fresh = isDuplicate ? [] : analysis.lines.filter((l) => !keptNos.has(l.line_no));
  const newRows = fresh.map((l) => {
    const { source_index: _src, ...rest } = l;
    return { ...rest, document_id: docId, venue_id: venueId, invoice_date: l.invoice_date ?? extracted.invoice_date ?? null, state: carried.get(l.line_no) ?? l.state ?? "open" };
  });
  const inserted = newRows.length
    ? ((check(await insertRows(sb, "invoice_lines", newRows).select("id,line_no"), "Could not save the lines").data ?? []) as { id: string; line_no: number }[])
    : [];
  const lineIdByNo = new Map<number, string>();
  for (const k of kept) lineIdByNo.set(k.line_no, k.id);
  for (const n of inserted) lineIdByNo.set(n.line_no, n.id);
  const newIds = [...inserted].sort((a, b) => a.line_no - b.line_no).map((n) => n.id);

  // ---- questions
  try {
    await syncQuestions(sb, { docId, venueId, analysis: isDuplicate ? null : analysis, oldLines, doomedIds: new Set(doomed.map((d) => d.id)), keptNos, lineIdByNo });
    if (doomed.length) check(await sb.from("invoice_lines").delete().in("id", doomed.map((d) => d.id)), "Could not replace the old lines");
  } catch (e) {
    // do not leave two copies of every line behind
    if (newIds.length) await sb.from("invoice_lines").delete().in("id", newIds);
    throw e;
  }

  // ---- status: a fresh document trusts the analysis; a re-analysed one is worked out from what is actually on its lines now
  const final = documentId && !isDuplicate && status !== "ignored" ? await recomputeDocumentStatus(sb, docId) : finalStatus;
  return { documentId: docId, status: final, lineIds: newIds };
};

async function syncQuestions(
  sb: SupabaseClient,
  a: { docId: string; venueId: number; analysis: InvoiceAnalysis | null; oldLines: { id: string; line_no: number }[]; doomedIds: Set<string>; keptNos: Set<number>; lineIdByNo: Map<number, string> },
) {
  const existing = (check(await sb.from("invoice_questions").select("*").eq("document_id", a.docId), "Could not read the questions").data ?? []) as InvoiceQuestionRow[];
  const lineNoById = new Map(a.oldLines.map((l) => [l.id, l.line_no]));
  const keyOf = (kind: string, lineNo: number | null | undefined) => `${kind}|${lineNo ?? ""}`;
  const byKey = new Map<string, InvoiceQuestionRow[]>();
  for (const q of existing) {
    const lineNo = q.line_id ? lineNoById.get(q.line_id) ?? null : null;
    const k = keyOf(q.kind, lineNo);
    byKey.set(k, [...(byKey.get(k) ?? []), q]);
  }
  const claimed = new Set<string>();
  const toInsert: any[] = [];

  for (const q of a.analysis?.questions ?? []) {
    // a question about a line that has already been applied has nothing left to ask
    if (q.line_no !== null && a.keptNos.has(q.line_no)) continue;
    const lineId = q.line_no === null ? null : a.lineIdByNo.get(q.line_no) ?? null;
    const same = byKey.get(keyOf(q.kind, q.line_no)) ?? [];
    const answered = same.find((s) => s.status === "answered");
    if (answered) { claimed.add(answered.id); continue; }
    const open = same.find((s) => s.status === "open") ?? same.find((s) => s.status === "dismissed");
    if (open) {
      claimed.add(open.id);
      check(await sb.from("invoice_questions").update({ prompt: q.prompt, options: q.options, line_id: lineId, status: "open", answer: null, answered_by: null, answered_at: null }).eq("id", open.id), "Could not update a question");
    } else {
      toInsert.push({ venue_id: a.venueId, document_id: a.docId, line_id: lineId, kind: q.kind, prompt: q.prompt, options: q.options, status: "open" });
    }
  }

  for (const q of existing) {
    if (claimed.has(q.id)) continue;
    const patch: Record<string, any> = {};
    if (q.status === "open") patch.status = "dismissed";
    // deleting a line deletes its questions: move any that remain onto the replacement line (or none)
    if (q.line_id && a.doomedIds.has(q.line_id)) patch.line_id = a.lineIdByNo.get(lineNoById.get(q.line_id) ?? -1) ?? null;
    if (Object.keys(patch).length) check(await sb.from("invoice_questions").update(patch).eq("id", q.id), "Could not update a question");
  }
  for (const q of existing) {
    // a claimed answered question may also sit on a line about to be deleted
    if (q.status === "answered" && claimed.has(q.id) && q.line_id && a.doomedIds.has(q.line_id)) {
      check(await sb.from("invoice_questions").update({ line_id: a.lineIdByNo.get(lineNoById.get(q.line_id) ?? -1) ?? null }).eq("id", q.id), "Could not update a question");
    }
  }
  if (toInsert.length) check(await insertRows(sb, "invoice_questions", toInsert), "Could not save the questions");
}
