/**
 * Invoices: a person answers a question (tap on Home, in the weekly email's link, or a review screen). The answer is recorded,
 * what it teaches is stored (invoice_item_map), the document is re-analysed with that knowledge, and anything the rules now
 * allow is applied. Takes ANY Supabase client. The engine is passed in (`deps.analyse`) so tests can fake it; by default it is
 * loaded on demand.
 *
 * An answer is recorded only AFTER its effect worked: a stale price on "Approve This Price" leaves the question open.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { brisbaneToday } from "./deals";
import { applyDocumentAuto, applyLine } from "./invoice-apply";
import { fetchAll, loadAnalyseContext } from "./invoice-context";
import { insertRow } from "./invoice-insert";
import type { AnalyseInvoice, AnswerQuestion, AnswerResult, ApplyResult } from "./invoice-interfaces";
import { saveAnalysis } from "./invoice-store";
import type {
  ExtractedInvoice,
  ExtractedLine,
  InvoiceDocumentRow,
  InvoiceItemMapRow,
  InvoiceLineRow,
  InvoiceQuestionRow,
  QuestionOption,
  ReconNote,
} from "./invoice-types";

export interface AnswerDeps {
  /** the engine; defaults to lib/invoice-engine.ts, loaded on demand */
  analyse?: AnalyseInvoice;
  /** Brisbane yyyy-mm-dd, injected by tests */
  today?: string;
}

/** The description as the item map stores it: lower case, letters and digits only (see invoice_item_map.desc_key). */
export function descKey(description: string): string {
  return description.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function check<T extends { error: any }>(res: T, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message ?? "database error"}`);
  return res;
}

/**
 * Rebuilds the reader's output from what is stored, so a document can be analysed again without reading the PDF again.
 * Stored prices are already ex GST, so every line comes back with basis "ex". The reader's free-text notes are not stored.
 */
export function extractedFromStored(doc: InvoiceDocumentRow, lines: InvoiceLineRow[]): ExtractedInvoice {
  const sorted = [...lines].sort((a, b) => a.line_no - b.line_no);
  return {
    doc_type: doc.doc_type,
    supplier_name: doc.supplier_name_read,
    supplier_abn: doc.supplier_abn_read,
    invoice_number: doc.invoice_number,
    invoice_date: doc.invoice_date,
    due_date: doc.due_date,
    bill_to: doc.bill_to,
    ship_to: doc.ship_to,
    pages: doc.pages ?? [],
    subtotal_ex: numOrNull(doc.subtotal_ex),
    gst_total: numOrNull(doc.gst_total),
    total_inc: numOrNull(doc.total_inc),
    lines: sorted.map((l): ExtractedLine => ({
      line_no: l.line_no,
      page: l.page ?? 1,
      item_code: l.item_code,
      description: l.description,
      qty: numOrNull(l.qty),
      unit: l.unit,
      unit_price: numOrNull(l.unit_price_ex),
      line_total: numOrNull(l.line_total_ex),
      basis: "ex",
      gst: l.gst,
      class_hint: l.line_class,
    })),
    notes: [],
  };
}

function numOrNull(v: unknown): number | null {
  return v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);
}

type MapTarget = { ingredientId: string | null; productId: string | null };

/** Remembers a match (or a "not a product") for this supplier and item code, or description when the line has no code. */
async function learnMap(
  sb: SupabaseClient,
  a: { supplierId: string; venueId: number | null; line: InvoiceLineRow; target: MapTarget; packs: number; rejected: boolean; actor: string },
): Promise<void> {
  const code = a.line.item_code?.trim() || null;
  const dkey = code ? null : descKey(a.line.description);
  if (!code && !dkey) throw new Error("This line has no item code or description to remember.");
  const rows = await fetchAll<InvoiceItemMapRow>(sb, "invoice_item_map", "id,supplier_id,venue_id,item_code,desc_key,ingredient_id,product_id,packs_per_unit,rejected", (q) => q.eq("supplier_id", a.supplierId));
  const forKey = rows.filter((m) => (m.item_code ?? null) === code && (m.desc_key ?? null) === dkey);
  const sameTarget = (m: InvoiceItemMapRow) => (m.ingredient_id ?? null) === a.target.ingredientId && (m.product_id ?? null) === a.target.productId;
  const fields = { venue_id: a.venueId, ingredient_id: a.target.ingredientId, product_id: a.target.productId, packs_per_unit: a.packs, rejected: a.rejected };

  if (a.rejected && !a.target.ingredientId && !a.target.productId) {
    // "not a product": a learned match for the same code would contradict it, so the person's newer answer replaces it
    const positives = forKey.filter((m) => !m.rejected);
    if (positives.length) check(await sb.from("invoice_item_map").delete().in("id", positives.map((m) => m.id)), "Could not replace the earlier match");
    if (forKey.some((m) => m.rejected && !m.ingredient_id && !m.product_id)) return;
  } else {
    const hit = forKey.find(sameTarget) ?? (a.rejected ? undefined : forKey.find((m) => !m.rejected));
    if (hit) {
      check(await sb.from("invoice_item_map").update({ ...fields, updated_by: a.actor }).eq("id", hit.id), "Could not update what was learned");
      return;
    }
  }
  check(await insertRow(sb, "invoice_item_map", { supplier_id: a.supplierId, item_code: code, desc_key: dkey, ...fields, created_by: a.actor }), "Could not remember the match");
}

async function nameOf(sb: SupabaseClient, option: QuestionOption): Promise<string> {
  if (option.ingredient_id) {
    const r = await sb.from("cost_ingredients").select("name").eq("id", option.ingredient_id).maybeSingle();
    if ((r.data as { name?: string } | null)?.name) return (r.data as { name: string }).name;
  }
  if (option.product_id) {
    const r = await sb.from("ordering_products").select("name").eq("id", option.product_id).maybeSingle();
    if ((r.data as { name?: string } | null)?.name) return (r.data as { name: string }).name;
  }
  return option.label;
}

/** The engine reads bill-to and ship-to for the venue check; after a person says "yes, this is for this venue", it is shown the venue's own name. */
function withVenueConfirmed(extracted: ExtractedInvoice, venueName: string): ExtractedInvoice {
  return { ...extracted, bill_to: venueName, ship_to: venueName };
}

async function reanalyse(sb: SupabaseClient, documentId: string, actor: string, deps: AnswerDeps): Promise<{ applied: ApplyResult[] }> {
  const doc = check(await sb.from("invoice_documents").select("*").eq("id", documentId).maybeSingle(), "Could not read the invoice").data as InvoiceDocumentRow | null;
  if (!doc) throw new Error("That invoice no longer exists.");
  if (doc.status === "ignored" || doc.status === "duplicate" || doc.status === "failed") return { applied: [] };
  const lines = await fetchAll<InvoiceLineRow>(sb, "invoice_lines", "*", (q) => q.eq("document_id", documentId));
  const file = check(await sb.from("invoice_files").select("venue_id").eq("id", doc.file_id).maybeSingle(), "Could not read the file").data as { venue_id: number } | null;
  const questions = (check(await sb.from("invoice_questions").select("*").eq("document_id", documentId).eq("status", "answered"), "Could not read the questions").data ?? []) as InvoiceQuestionRow[];
  const venueConfirmed = questions.some((q) => q.kind === "venue_mismatch" && q.options.find((o) => o.id === q.answer?.option_id)?.action === "confirm_venue");

  const analyse = deps.analyse ?? (await loadEngine());
  const ctx = await loadAnalyseContext(sb, { venueId: doc.venue_id, folderVenueId: file?.venue_id ?? doc.venue_id, today: deps.today ?? brisbaneToday() });
  // this document is already filed: it must not be seen as a duplicate of itself
  ctx.existingDocs = ctx.existingDocs.filter((d) => d.id !== doc.id);
  const extracted = extractedFromStored(doc, lines);
  const venueName = ctx.venueNames.find((v) => v.id === doc.venue_id)?.name;
  const analysis = analyse(venueConfirmed && venueName ? withVenueConfirmed(extracted, venueName) : extracted, ctx);
  await saveAnalysis(sb, { fileId: doc.file_id, venueId: doc.venue_id, extracted, analysis, pagePdfPath: doc.page_pdf_path, readModel: doc.read_model, documentId });
  return { applied: await applyDocumentAuto(sb, { documentId, actor }) };
}

async function loadEngine(): Promise<AnalyseInvoice> {
  const mod = await import("./invoice-engine");
  return mod.analyseInvoice;
}

export async function answerQuestion(
  sb: SupabaseClient,
  args: { questionId: string; optionId: string; actor: string; note?: string },
  deps: AnswerDeps = {},
): Promise<AnswerResult> {
  const fail = (message: string, applied: ApplyResult[] = []): AnswerResult => ({ ok: false, message, applied });
  try {
    return await answerInner(sb, args, deps, fail);
  } catch (e) {
    return fail(`Nothing was saved. ${e instanceof Error ? e.message : "Something went wrong."}`);
  }
}
// compile-time check that this matches the contract in lib/invoice-interfaces.ts (the optional third argument is ours)
const contract: AnswerQuestion = answerQuestion;
void contract;

async function answerInner(
  sb: SupabaseClient,
  args: { questionId: string; optionId: string; actor: string; note?: string },
  deps: AnswerDeps,
  fail: (message: string, applied?: ApplyResult[]) => AnswerResult,
): Promise<AnswerResult> {
  const { questionId, optionId, actor, note } = args;
  const q = check(await sb.from("invoice_questions").select("*").eq("id", questionId).maybeSingle(), "Could not read the question").data as InvoiceQuestionRow | null;
  if (!q) return fail("That question no longer exists.");
  if (q.status !== "open") return fail(q.status === "answered" ? "This question has already been answered." : "This question no longer needs an answer.");
  const option = (q.options ?? []).find((o) => o.id === optionId);
  if (!option) return fail("That is not one of the choices for this question.");
  const doc = check(await sb.from("invoice_documents").select("*").eq("id", q.document_id).maybeSingle(), "Could not read the invoice").data as InvoiceDocumentRow | null;
  if (!doc) return fail("The invoice for this question no longer exists.");
  const line = q.line_id ? (check(await sb.from("invoice_lines").select("*").eq("id", q.line_id).maybeSingle(), "Could not read the line").data as InvoiceLineRow | null) : null;

  const parts: string[] = [];
  const applied: ApplyResult[] = [];
  let reanalyseAfter = true;
  let autoUpdated = 0;
  const needLine = () => {
    if (!line) throw new Error("This answer is about a line, but the line is no longer on the invoice.");
    return line;
  };

  switch (option.action) {
    case "approve_change": {
      const r = await applyLine(sb, { lineId: needLine().id, actor, mode: "approved" });
      if (!r.ok) return fail(r.message, [r]);
      applied.push(r);
      parts.push(r.message);
      break;
    }
    case "reject_change":
    case "ignore_line": {
      const l = needLine();
      check(await sb.from("invoice_lines").update({ state: "ignored" }).eq("id", l.id), "Could not update the line");
      parts.push(option.action === "reject_change" ? `That price change for ${l.description} was left alone.` : `${l.description} will be ignored.`);
      break;
    }
    case "not_a_product": {
      const l = needLine();
      if (doc.supplier_id) await learnMap(sb, { supplierId: doc.supplier_id, venueId: null, line: l, target: { ingredientId: null, productId: null }, packs: 1, rejected: true, actor });
      check(await sb.from("invoice_lines").update({ state: "ignored", match_state: "ignored" }).eq("id", l.id), "Could not update the line");
      parts.push(`${l.description} is not a product, and it will be ignored from now on.`);
      break;
    }
    case "confirm_venue": {
      check(await sb.from("invoice_documents").update({ venue_check: "ok" }).eq("id", doc.id), "Could not update the invoice");
      parts.push("This invoice is confirmed for this venue.");
      break;
    }
    case "wrong_venue": {
      const notes: ReconNote[] = [...(doc.recon_notes ?? []), { check: "venue", ok: false, message: `Marked as not for this venue by ${actor}.` }];
      check(await sb.from("invoice_documents").update({ status: "ignored", recon_notes: notes }).eq("id", doc.id), "Could not update the invoice");
      parts.push("This invoice is set aside because it is not for this venue.");
      reanalyseAfter = false;
      break;
    }
    case "ignore_document": {
      check(await sb.from("invoice_documents").update({ status: "ignored" }).eq("id", doc.id), "Could not update the invoice");
      parts.push("This invoice is set aside.");
      reanalyseAfter = false;
      break;
    }
    case "reread": {
      check(await sb.from("invoice_files").update({ status: "received", attempts: 0, error: null }).eq("id", doc.file_id), "Could not queue the file");
      parts.push("This invoice will be read again.");
      reanalyseAfter = false;
      break;
    }
    default: {
      if (option.ingredient_id || option.product_id) {
        const l = needLine();
        if (!doc.supplier_id) throw new Error("This invoice has no supplier yet, so the match cannot be remembered.");
        const packs = option.packs_per_unit ?? numOrNull(l.packs_per_unit) ?? 1;
        await learnMap(sb, {
          supplierId: doc.supplier_id,
          venueId: option.product_id ? doc.venue_id : null,
          line: l,
          target: { ingredientId: option.ingredient_id ?? null, productId: option.product_id ?? null },
          packs,
          rejected: false,
          actor,
        });
        const sup = check(await sb.from("invoice_suppliers").select("name").eq("id", doc.supplier_id).maybeSingle(), "Could not read the supplier").data as { name: string } | null;
        const who = sup?.name ?? doc.supplier_name_read ?? "This supplier";
        const what = l.item_code?.trim() ? `code ${l.item_code.trim()}` : `"${l.description}"`;
        parts.push(`${who} ${what} is now ${await nameOf(sb, option)}.`);
      } else {
        parts.push("Answer noted.");
      }
    }
  }

  // ---- record the answer (only the first answer wins)
  const marked = await sb
    .from("invoice_questions")
    .update({ status: "answered", answer: note ? { option_id: optionId, note } : { option_id: optionId }, answered_by: actor, answered_at: new Date().toISOString() })
    .eq("id", questionId)
    .eq("status", "open")
    .select("id");
  if (marked.error) throw new Error(marked.error.message);
  if (!marked.data || marked.data.length === 0) return fail("Someone else answered this question first.", applied);

  // ---- look at the invoice again with what was just learned
  if (reanalyseAfter) {
    try {
      const again = await reanalyse(sb, doc.id, actor, deps);
      applied.push(...again.applied);
      autoUpdated = again.applied.filter((a) => a.ok && a.changeIds.length > 0).length;
    } catch (e) {
      parts.push("The answer is saved, but the invoice could not be checked again just now.");
    }
  }
  if (autoUpdated > 0) parts.push(`${autoUpdated} more ${autoUpdated === 1 ? "line was" : "lines were"} applied automatically.`);
  return { ok: true, message: ["Saved.", ...parts].join(" "), applied };
}
