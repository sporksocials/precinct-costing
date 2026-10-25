/**
 * The free re-check (Troy, 25 Oct 2026). Every read invoice keeps the reading the model gave (`invoice_documents.extracted`) and the
 * version of the checking rules that last looked at it (`analysis_version`, ENGINE_VERSION in lib/invoice-engine.ts). When the rules
 * improve and the version is bumped, a quiet step runs the stored reading through the engine again: no PDF, no model call, no cost.
 *
 * One document per call. A document whose prices were already applied, one a person ignored and a duplicate are never touched; a
 * document read before the reading was stored has no `extracted` and is left alone (it needs a real re-read). saveAnalysis keeps
 * applied, confirmed and reverted lines and every answered question, and stamps the new version. A failure leaves the version as it
 * was, is logged short, and the next candidate is tried (at most REANALYSE_CANDIDATES in one call, never the same document twice).
 * Pure apart from the Supabase client it is given.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ENGINE_VERSION } from "./invoice-engine";
import type { AnalyseInvoice, ApplyDocumentAuto, LoadAnalyseContext, SaveAnalysis } from "./invoice-interfaces";
import { safeError } from "./invoice-pipeline";
import type { DocStatus, ExtractedInvoice } from "./invoice-types";

/** Documents tried in one call. */
export const REANALYSE_CANDIDATES = 3;

/** A document with one of these statuses is never re-checked by itself (prices were applied, or a person or the filing said leave it). */
export const REANALYSE_SKIP_STATUSES: DocStatus[] = ["applied", "partly_applied", "ignored", "duplicate"];

export interface StoredReading {
  id: string;
  venue_id: number;
  file_id: string;
  status: DocStatus;
  extracted?: unknown;
  analysis_version?: number | null;
  read_model?: string | null;
  page_pdf_path?: string | null;
}

const isReading = (v: unknown): v is ExtractedInvoice => !!v && typeof v === "object" && Array.isArray((v as { lines?: unknown }).lines);

/** Does this stored document want another look under the rules at `version`? Needs a stored reading, an older version and a status that allows it. */
export function needsReanalysis(doc: Pick<StoredReading, "status" | "extracted" | "analysis_version">, version: number): boolean {
  if (doc.extracted == null || typeof doc.extracted !== "object") return false;
  if (REANALYSE_SKIP_STATUSES.includes(doc.status)) return false;
  return (doc.analysis_version ?? 0) < version;
}

export interface ReanalyseDeps {
  analyse: AnalyseInvoice;
  loadContext: LoadAnalyseContext;
  save: SaveAnalysis;
  /** applies what the rules now allow (the same step the reader runs after a save); a failure is logged and ignored */
  autoApply?: ApplyDocumentAuto;
  /** today's Brisbane date, yyyy-mm-dd */
  today: () => string;
  /** the model an ordinary first reading uses; a document read by any other model was a hinted second reading */
  firstReadModel?: string | null;
}

async function reanalyseOne(sb: SupabaseClient, deps: ReanalyseDeps, doc: StoredReading): Promise<void> {
  if (!isReading(doc.extracted)) throw new Error("The stored reading is not usable.");
  const extracted = doc.extracted;
  const file = await sb.from("invoice_files").select("venue_id").eq("id", doc.file_id).maybeSingle();
  if (file.error) throw new Error(`Could not read the file: ${file.error.message}`);
  const answered = await sb.from("invoice_questions").select("kind,answer").eq("document_id", doc.id).eq("status", "answered");
  if (answered.error) throw new Error(`Could not read the questions: ${answered.error.message}`);
  // what people already said is replayed, as the answer path does
  const supplierConfirmed = ((answered.data ?? []) as { kind: string; answer: { option_id?: string } | null }[]).some(
    (q) => q.kind === "new_supplier" && q.answer?.option_id === "same_supplier",
  );
  const hintedReread = doc.read_model != null && deps.firstReadModel != null && doc.read_model !== deps.firstReadModel;

  const folderVenue = (file.data as { venue_id: number } | null)?.venue_id ?? doc.venue_id;
  const ctx = await deps.loadContext(sb, { venueId: doc.venue_id, folderVenueId: folderVenue, today: deps.today() });
  // this document is already filed: it must not be seen as a duplicate of itself
  ctx.existingDocs = ctx.existingDocs.filter((d) => d.id !== doc.id);
  Object.assign(ctx, { supplierConfirmed, hintedReread }); // the engine's AnalyseConfirmations
  const analysis = deps.analyse(extracted, ctx);
  await deps.save(sb, {
    fileId: doc.file_id,
    venueId: doc.venue_id,
    extracted,
    analysis,
    pagePdfPath: doc.page_pdf_path ?? null,
    readModel: doc.read_model ?? null,
    documentId: doc.id,
  });
  if (deps.autoApply) {
    try {
      await deps.autoApply(sb, { documentId: doc.id, actor: "invoice reader" });
    } catch (e) {
      console.warn(`Invoice auto-apply after a re-check failed: ${safeError(e)}`);
    }
  }
}

/**
 * Re-checks ONE stored invoice with the current rules. True when a document was re-checked (and its version stamped), false when
 * nothing needs it or every candidate failed. Never calls a model.
 */
export async function reanalyseNext(sb: SupabaseClient, deps: ReanalyseDeps, version: number = ENGINE_VERSION): Promise<boolean> {
  const { data, error } = await sb
    .from("invoice_documents")
    .select("id,venue_id,file_id,status,extracted,analysis_version,read_model,page_pdf_path")
    .not("extracted", "is", null)
    .lt("analysis_version", version)
    .not("status", "in", `(${REANALYSE_SKIP_STATUSES.join(",")})`)
    .order("created_at", { ascending: true })
    .limit(REANALYSE_CANDIDATES);
  if (error) throw new Error(`Could not look for invoices to re-check: ${error.message}`);
  const tried = new Set<string>();
  for (const doc of (data ?? []) as StoredReading[]) {
    if (tried.has(doc.id) || !needsReanalysis(doc, version)) continue;
    tried.add(doc.id);
    try {
      await reanalyseOne(sb, deps, doc);
      return true;
    } catch (e) {
      console.warn(`Invoice re-check failed for one document: ${safeError(e)}`);
    }
  }
  return false;
}
