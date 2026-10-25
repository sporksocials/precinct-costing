/**
 * The invoice pipeline: "a PDF arrived" to "its invoices are read, analysed and saved". One call to `processStep` does ONE bounded
 * unit of work (it stops starting new calls after 45 seconds, so a 60 second route never times out mid-write) and says whether
 * more is waiting; the scanner script calls it again until it answers idle.
 *
 *   claim the oldest file (compare and set, so two callers never take the same one)
 *   stage 1  sort the pages (cheap model), group them into documents, write a shell row per document
 *   stage 2  per document, one at a time: split its pages out, read them, upload the split PDF, analyse, save, auto-apply when
 *            the rules allow, tell the notify hook
 *   all documents done -> file 'done'
 *
 * Resumable: a document whose row already has a read_model was saved, so the next step skips it. A crash between documents loses
 * at most the document in flight. Everything outside this file (the engine, the store, the apply layer, the clock, the model
 * calls, the database and the bucket) comes in through PipelineDeps so the tests use fakes.
 *
 * The split PDF's name needs the invoice date, supplier and number, which come from the READ, so it is uploaded after the read
 * and before the analysis (the analysis result stores its path).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnalyseInvoice, ApplyDocumentAuto, LoadAnalyseContext, ProcessStep, ProcessStepResult, SaveAnalysis } from "./invoice-interfaces";
import { DEFAULT_READ_MODEL, DEFAULT_SORT_MODEL, INVOICE_ENV, type DocStatus, type ExtractedInvoice, type InvoiceAnalysis, type InvoiceDocType, type InvoiceFileRow, type SortedPage } from "./invoice-types";
import { AiError, type ClaudeFn } from "./invoice-ai";
import { venueFromInvoice } from "./invoice-match";
import { PdfError, countPages, splitPages, toBase64 } from "./invoice-pdf";
import {
  READABLE_DOC_TYPES,
  READ_SYSTEM,
  ReadError,
  SORT_CHUNK_PAGES,
  SORT_SYSTEM,
  SORT_WHOLE_FILE_MAX,
  buildReadUserPrompt,
  buildSortUserPrompt,
  groupPages,
  mapToFilePages,
  nextStrongerModel,
  parseExtracted,
  parseSorted,
  type PageGroup,
} from "./invoice-read";

export const INVOICE_BUCKET = "invoice-pdfs";
/** stop starting new model calls after this long in one step */
export const STEP_BUDGET_MS = 45_000;
/** the route's hard limit is 60 s; a model call is never allowed to run past this point */
export const STEP_HARD_LIMIT_MS = 58_000;
export const STALLED_AFTER_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 3;
export const SIGNED_URL_SECONDS = 600;
/** a file row created for an upload that has not finished carries this attempts value; the claim ignores it */
export const AWAITING_UPLOAD = -1;

// ---------------------------------------------------------------- dependencies
export interface PipelineStorage {
  download(bucket: string, path: string): Promise<Uint8Array>;
  upload(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  signedUrl(bucket: string, path: string, seconds: number): Promise<string | null>;
}

/** A document row as the pipeline needs it. */
export interface DocShell {
  id: string;
  pages: number[];
  doc_type: InvoiceDocType;
  supplier_name_read: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  page_pdf_path: string | null;
  /** set by saveAnalysis (or by the pipeline for a statement); a document with one is finished */
  read_model: string | null;
  status: DocStatus;
}

export interface ShellInput {
  doc_type: InvoiceDocType;
  supplier_name_read: string | null;
  invoice_number: string | null;
  pages: number[];
}

/** The pipeline's database operations on invoice_files and invoice_documents (lib/invoice-repo.ts is the Supabase version). */
export interface PipelineRepo {
  /**
   * compare and set: the oldest 'received' file, or a 'sorting'/'reading' file untouched since `stalledBefore`, whose attempts are 0 to MAX_ATTEMPTS
   * (a file AT MAX_ATTEMPTS is handed back only so the pipeline can mark it failed: it was claimed that many times and never finished).
   * Null when nothing is waiting or another caller won. The returned row still holds the attempts it had BEFORE this claim.
   */
  claimFile(args: { stalledBefore: string; nowIso: string }): Promise<InvoiceFileRow | null>;
  updateFile(id: string, patch: Partial<Pick<InvoiceFileRow, "status" | "error" | "attempts" | "page_count" | "processed_at">>): Promise<void>;
  venueSlug(venueId: number): Promise<string>;
  listDocuments(fileId: string): Promise<DocShell[]>;
  createDocuments(fileId: string, venueId: number, docs: ShellInput[]): Promise<DocShell[]>;
  updateDocument(id: string, patch: Partial<Pick<DocShell, "page_pdf_path" | "read_model" | "status">>): Promise<void>;
}

export interface NotifyEvent {
  type: "document_done";
  fileId: string;
  documentId: string;
  venueId: number;
  venueSlug: string;
  status: DocStatus;
  supplier: string | null;
  invoiceNumber: string | null;
  analysis: InvoiceAnalysis | null;
}

export interface PipelineClock {
  /** milliseconds since the epoch */
  now(): number;
  /** today's Brisbane calendar date, yyyy-mm-dd */
  today(): string;
}

export interface PipelineDeps {
  /** service-role client, handed to loadContext / save / autoApply */
  sb: SupabaseClient;
  repo: PipelineRepo;
  storage: PipelineStorage;
  claude: ClaudeFn;
  analyse: AnalyseInvoice;
  loadContext: LoadAnalyseContext;
  save: SaveAnalysis;
  autoApply: ApplyDocumentAuto;
  notify?: (event: NotifyEvent) => Promise<void>;
  clock: PipelineClock;
  /** defaults come from the environment (INVOICE_SORT_MODEL, INVOICE_READ_MODEL) */
  models?: { sort: string; read: string };
  env?: Record<string, string | undefined>;
}

export function brisbaneToday(ms: number): string {
  return new Date(ms + 10 * 3600_000).toISOString().slice(0, 10);
}

export const realClock: PipelineClock = { now: () => Date.now(), today: () => brisbaneToday(Date.now()) };

export function resolveModels(env: Record<string, string | undefined> = process.env): { sort: string; read: string } {
  return { sort: env[INVOICE_ENV.sortModel]?.trim() || DEFAULT_SORT_MODEL, read: env[INVOICE_ENV.readModel]?.trim() || DEFAULT_READ_MODEL };
}

// ---------------------------------------------------------------- small helpers
/** Error text that is short and cannot carry a key. */
export function safeError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[hidden]")
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]{6,}/gi, "[hidden]")
    .replace(/sbp_[A-Za-z0-9]{10,}/g, "[hidden]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}(\.[A-Za-z0-9_-]+)*/g, "[hidden]")
    .replace(/Bearer\s+\S+/gi, "[hidden]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

const slugify = (s: string | null | undefined, max: number, fallback: string) => {
  const t = (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "");
  return t || fallback;
};

/** `<venueSlug>/<yyyy-mm>/<yyyy-mm-dd>_<supplier-slug>_<invoice-number>.pdf`. No slashes can come from the supplier or number. */
export function buildPdfPath(a: { venueSlug: string; date: string; supplier: string | null; invoiceNumber: string | null; firstPage: number }): string {
  const number = a.invoiceNumber ? slugify(a.invoiceNumber, 40, "") : "";
  return `${a.venueSlug}/${a.date.slice(0, 7)}/${a.date}_${slugify(a.supplier, 40, "unknown-supplier")}_${number || `no-number-p${a.firstPage}`}.pdf`;
}

/** The name the scanner script saves to Drive: `2026-10-14 Daniel Street Fish Market 51329.pdf`. No slashes or other path characters. */
export function buildDownloadName(a: { date: string; supplier: string | null; invoiceNumber: string | null }): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  return `${[a.date, clean(a.supplier ?? "") || "Unknown Supplier", clean(a.invoiceNumber ?? "") || "no number"].join(" ")}.pdf`.slice(0, 160);
}

const passing = (a: InvoiceAnalysis) => a.recon_notes.filter((n) => n.ok).length;

// ---------------------------------------------------------------- the model passes
async function callWithRetry<T>(call: (retryError?: string) => Promise<string>, parse: (text: string) => T): Promise<T> {
  const first = await call();
  try {
    return parse(first);
  } catch (e) {
    if (!(e instanceof ReadError)) throw e;
    const second = await call(e.message);
    try {
      return parse(second);
    } catch (e2) {
      if (e2 instanceof ReadError) throw new ReadError(`The reader's answer did not pass the checks twice (${e2.message})`);
      throw e2;
    }
  }
}

/** Seconds a model call may still run: the usual limit, cut short near the end of the step. */
function callTimeout(deps: PipelineDeps, start: number): number {
  return Math.max(5_000, Math.min(40_000, STEP_HARD_LIMIT_MS - (deps.clock.now() - start)));
}

async function sortPages(deps: PipelineDeps, file: InvoiceFileRow, bytes: Uint8Array, total: number, start: number): Promise<SortedPage[]> {
  const models = deps.models ?? resolveModels(deps.env);
  // Up to 100 pages go in one call. A longer file is sorted 40 pages at a time and the results are joined (see groupPages).
  const chunks: number[][] = [];
  if (total <= SORT_WHOLE_FILE_MAX) chunks.push(Array.from({ length: total }, (_, i) => i + 1));
  else for (let from = 1; from <= total; from += SORT_CHUNK_PAGES) chunks.push(Array.from({ length: Math.min(SORT_CHUNK_PAGES, total - from + 1) }, (_, i) => from + i));

  const all: SortedPage[] = [];
  for (const [chunkIndex, pages] of chunks.entries()) {
    const pdf = chunks.length === 1 ? bytes : await splitPages(bytes, pages);
    const b64 = toBase64(pdf);
    const sorted = await callWithRetry(
      async (retryError) =>
        (
          await deps.claude({
            model: models.sort,
            system: SORT_SYSTEM,
            pdfBase64: b64,
            text: buildSortUserPrompt(pages.length) + (retryError ? `\n\nYour previous answer was rejected because: ${retryError} Reply again with corrected JSON only.` : ""),
            maxTokens: Math.min(8000, 120 * pages.length + 800),
            feature: "invoice_sort",
            venueId: file.venue_id,
            fileId: file.id,
            timeoutMs: callTimeout(deps, start),
          })
        ).text,
      (text) => parseSorted(text, pages.length, { firstMayContinue: chunkIndex > 0 }),
    );
    for (const s of sorted) all.push({ ...s, page: pages[s.page - 1] });
  }
  return all;
}

async function readPages(
  deps: PipelineDeps,
  file: InvoiceFileRow,
  doc: DocShell,
  pdf: Uint8Array,
  model: string,
  start: number,
  failedChecks?: string[],
): Promise<ExtractedInvoice> {
  const b64 = toBase64(pdf);
  const parsed = await callWithRetry(
    async (retryError) =>
      (
        await deps.claude({
          model,
          system: READ_SYSTEM,
          pdfBase64: b64,
          text: buildReadUserPrompt({ pageCount: doc.pages.length, retryError, failedChecks }),
          maxTokens: 16000,
          feature: failedChecks ? "invoice_reread" : "invoice_read",
          venueId: file.venue_id,
          fileId: file.id,
          documentId: doc.id,
          timeoutMs: callTimeout(deps, start),
        })
      ).text,
    (text) => parseExtracted(text, { pageCount: doc.pages.length }),
  );
  return mapToFilePages(parsed, doc.pages);
}

// ---------------------------------------------------------------- one step
type Finished = ProcessStepResult["documents"][number];

const idleResult = (): ProcessStepResult => ({ idle: true, fileId: null, stage: "idle", documents: [], message: "Nothing is waiting to be read." });

export async function runStep(deps: PipelineDeps): Promise<ProcessStepResult> {
  const start = deps.clock.now();
  const elapsed = () => deps.clock.now() - start;
  const { repo, storage } = deps;

  const file = await repo.claimFile({ stalledBefore: new Date(start - STALLED_AFTER_MS).toISOString(), nowIso: new Date(start).toISOString() });
  if (!file) return idleResult();

  const finished: Finished[] = [];
  try {
    // A file that was claimed MAX_ATTEMPTS times and never finished (a step killed by the platform timeout never reaches the catch
    // below) is not tried again: it is marked failed, with its unread documents.
    if (file.attempts >= MAX_ATTEMPTS) {
      const text = `This file did not finish after ${MAX_ATTEMPTS} tries (a step ran out of time).`;
      await failFile(repo, file.id, MAX_ATTEMPTS, text);
      return { idle: false, fileId: file.id, stage: "failed", documents: [], message: `Could not read this file after ${MAX_ATTEMPTS} tries. ${text}` };
    }
    // The attempt is counted when the file is CLAIMED, not when something throws: a step killed mid-way still used one.
    await repo.updateFile(file.id, { attempts: file.attempts + 1 });
    const venueSlug = await repo.venueSlug(file.venue_id);
    let fileBytes: Uint8Array | null = null;
    const getBytes = async () => (fileBytes ??= await storage.download(INVOICE_BUCKET, file.storage_path));

    let docs = await repo.listDocuments(file.id);
    let sortedNow = false;
    if (docs.length === 0) {
      const bytes = await getBytes();
      const total = await countPages(bytes);
      if (total < 1) throw new PdfError("That file has no pages.");
      const groups: PageGroup[] = groupPages(await sortPages(deps, file, bytes, total, start));
      await repo.updateFile(file.id, { page_count: total });
      if (groups.length === 0) {
        await repo.updateFile(file.id, { status: "done", processed_at: new Date(deps.clock.now()).toISOString(), error: null });
        return { idle: false, fileId: file.id, stage: "read", documents: [], message: "Every page in that file was blank, so there was nothing to read." };
      }
      docs = await repo.createDocuments(
        file.id,
        file.venue_id,
        groups.map((g) => ({ doc_type: g.doc_type, supplier_name_read: g.supplier_name, invoice_number: g.invoice_number, pages: g.pages })),
      );
      sortedNow = true;
    }
    await repo.updateFile(file.id, { status: "reading" });

    const todo = docs.filter((d) => d.read_model == null);
    let budgetHit = false;
    for (const doc of todo) {
      if (elapsed() >= STEP_BUDGET_MS) {
        budgetHit = true;
        break;
      }
      finished.push(await processDocument(deps, file, venueSlug, doc, getBytes, start));
    }

    if (budgetHit) {
      // claimable again straight away: the shells exist, so the next claim goes straight to reading. A step that made progress is
      // not a failed attempt, so its claim is handed back (otherwise a long file would run out of attempts by being read in pieces).
      await repo.updateFile(file.id, { status: "received", ...(finished.length > 0 || sortedNow ? { attempts: file.attempts } : {}) });
      return {
        idle: false,
        fileId: file.id,
        stage: finished.length === 0 && sortedNow ? "sorted" : "read",
        documents: finished,
        message: `Read ${finished.length} of ${todo.length} remaining invoices in this file. More are waiting.`,
      };
    }

    await repo.updateFile(file.id, { status: "done", processed_at: new Date(deps.clock.now()).toISOString(), error: null });
    return {
      idle: false,
      fileId: file.id,
      stage: "read",
      documents: finished,
      message: `${sortedNow ? `Sorted the pages into ${docs.length} document${docs.length === 1 ? "" : "s"}. ` : ""}Read ${finished.length} document${finished.length === 1 ? "" : "s"}.`,
    };
  } catch (e) {
    const attempts = file.attempts + 1;
    const dead = attempts >= MAX_ATTEMPTS;
    const text = e instanceof AiError || e instanceof ReadError || e instanceof PdfError ? safeError(e) : `Something went wrong reading this file: ${safeError(e)}`;
    try {
      if (dead) await failFile(repo, file.id, attempts, text);
      else await repo.updateFile(file.id, { status: "received", attempts, error: text });
    } catch {
      // the claim goes stale after 10 minutes and the file is picked up again
    }
    return { idle: false, fileId: file.id, stage: "failed", documents: finished, message: dead ? `Could not read this file after ${MAX_ATTEMPTS} tries. ${text}` : `That file hit a problem and will be tried again. ${text}` };
  }
}

/** Marks a file failed with a short error, and every document of it that was never read. */
async function failFile(repo: PipelineRepo, fileId: string, attempts: number, text: string): Promise<void> {
  await repo.updateFile(fileId, { status: "failed", attempts, error: text });
  for (const d of await repo.listDocuments(fileId)) if (d.read_model == null) await repo.updateDocument(d.id, { status: "failed" });
}

async function processDocument(deps: PipelineDeps, file: InvoiceFileRow, venueSlug: string, doc: DocShell, getBytes: () => Promise<Uint8Array>, start: number): Promise<Finished> {
  const { repo, storage } = deps;
  const models = deps.models ?? resolveModels(deps.env);
  const pdf = await splitPages(await getBytes(), doc.pages);
  const fallbackDate = (file.received_at ?? "").slice(0, 10) || deps.clock.today();

  const link = async (path: string) => {
    try {
      return await storage.signedUrl(INVOICE_BUCKET, path, SIGNED_URL_SECONDS);
    } catch {
      return null;
    }
  };

  // statements, delivery dockets and anything else that is not a priced invoice: file the PDF, read nothing
  if (!READABLE_DOC_TYPES.includes(doc.doc_type)) {
    const date = fallbackDate;
    const path = buildPdfPath({ venueSlug, date, supplier: doc.supplier_name_read, invoiceNumber: doc.invoice_number, firstPage: doc.pages[0] });
    await storage.upload(INVOICE_BUCKET, path, pdf, "application/pdf");
    await repo.updateDocument(doc.id, { page_pdf_path: path, read_model: "not_read", status: "nothing_to_apply" });
    return {
      id: doc.id,
      supplier: doc.supplier_name_read,
      invoiceNumber: doc.invoice_number,
      invoiceDate: null,
      venueSlug,
      fileName: buildDownloadName({ date, supplier: doc.supplier_name_read, invoiceNumber: doc.invoice_number }),
      downloadUrl: await link(path),
      status: "nothing_to_apply",
    };
  }

  let readModel = models.read;
  let extracted = await readPages(deps, file, doc, pdf, readModel, start);
  const path = buildPdfPath({ venueSlug, date: extracted.invoice_date ?? fallbackDate, supplier: extracted.supplier_name ?? doc.supplier_name_read, invoiceNumber: extracted.invoice_number ?? doc.invoice_number, firstPage: doc.pages[0] });
  await storage.upload(INVOICE_BUCKET, path, pdf, "application/pdf");

  // Which venue the document belongs to: the one its bill-to / ship-to names when it names exactly one of ours, else the folder it
  // arrived in. Prices are shared across venues, so this never blocks or asks anything; it only decides where the invoice is filed
  // and whose ordering products it looks at. The context is loaded for the folder venue first (it carries the venue names), and
  // again for the named venue only when that is a different one.
  const analyseWith = async (ex: ExtractedInvoice, hinted = false) => {
    const today = deps.clock.today();
    const folderCtx = await deps.loadContext(deps.sb, { venueId: file.venue_id, folderVenueId: file.venue_id, today });
    const venueId = venueFromInvoice(ex, folderCtx.venueNames ?? []) ?? file.venue_id;
    const ctx = venueId === file.venue_id ? folderCtx : await deps.loadContext(deps.sb, { venueId, folderVenueId: file.venue_id, today });
    // hintedReread (the engine's AnalyseConfirmations): the reader was told which checks failed, so no line of it may apply itself
    const analysis = deps.analyse(ex, hinted ? ({ ...ctx, hintedReread: true } as typeof ctx & { hintedReread: true }) : ctx);
    return { analysis, venueId };
  };
  let { analysis, venueId: docVenueId } = await analyseWith(extracted);

  // not reconciled: read it once more with the next stronger model and keep whichever reading passes more checks
  if (!analysis.reconciled) {
    const stronger = nextStrongerModel(readModel);
    if (stronger && deps.clock.now() - start < STEP_BUDGET_MS) {
      try {
        const failedChecks = analysis.recon_notes.filter((n) => !n.ok).map((n) => n.message);
        const second = await readPages(deps, file, doc, pdf, stronger, start, failedChecks.length ? failedChecks : ["The totals did not add up."]);
        const secondAnalysis = (await analyseWith(second)).analysis;
        if ((secondAnalysis.reconciled && !analysis.reconciled) || passing(secondAnalysis) > passing(analysis)) {
          extracted = second;
          // the kept reading came from a hinted re-read: analyse it again with that flag so none of its lines is automatic
          ({ analysis, venueId: docVenueId } = await analyseWith(second, true));
          readModel = stronger;
        }
      } catch {
        // the first reading stands; the engine keeps an unreconciled invoice off auto-apply and raises the question
      }
    }
  }

  const saved = await deps.save(deps.sb, { fileId: file.id, venueId: docVenueId, extracted, analysis, pagePdfPath: path, readModel, documentId: doc.id });
  // Always asked, in learning mode too: the apply layer itself refuses real price changes while learning mode is on and only
  // confirms prices that are the same as today's. A failure is logged short and never fails the file.
  if (saved.status !== "duplicate" && saved.status !== "failed" && saved.status !== "ignored") {
    try {
      await deps.autoApply(deps.sb, { documentId: saved.documentId, actor: "invoice reader" });
    } catch (e) {
      // the invoice is saved and waits for a tap like any other; nothing was half-applied that the undo ledger does not hold
      console.warn(`Invoice auto-apply failed for a document: ${safeError(e)}`);
    }
  }
  // the document's venue (not the folder's) is the one that gets the digest and the answer
  const docVenueSlug = docVenueId === file.venue_id ? venueSlug : await deps.repo.venueSlug(docVenueId);
  if (deps.notify) {
    try {
      await deps.notify({ type: "document_done", fileId: file.id, documentId: saved.documentId, venueId: docVenueId, venueSlug: docVenueSlug, status: saved.status, supplier: extracted.supplier_name, invoiceNumber: extracted.invoice_number, analysis });
    } catch {
      // a Slack hiccup never fails a document
    }
  }

  const date = extracted.invoice_date ?? fallbackDate;
  return {
    id: saved.documentId,
    supplier: extracted.supplier_name,
    invoiceNumber: extracted.invoice_number,
    invoiceDate: extracted.invoice_date,
    venueSlug: docVenueSlug,
    fileName: buildDownloadName({ date, supplier: extracted.supplier_name, invoiceNumber: extracted.invoice_number }),
    downloadUrl: await link(path),
    status: saved.status,
  };
}

/** The ProcessStep the interfaces file names. `deps` must be a PipelineDeps. */
export const processStep: ProcessStep = (deps) => runStep(deps as PipelineDeps);
