/**
 * Invoices: the function signatures the separate modules agree on, so each can be built and tested on its own.
 * Types only (no logic). Owned by the orchestrator. An implementation exports a value of exactly the named type.
 *
 *   C  lib/invoice-engine.ts       export const analyseInvoice: AnalyseInvoice
 *   C  lib/invoice-cost-stats.ts   export const computeIngredientCosts: ComputeIngredientCosts
 *   D  lib/invoice-context.ts      export const loadAnalyseContext: LoadAnalyseContext
 *   D  lib/invoice-store.ts        export const saveAnalysis: SaveAnalysis
 *   D  lib/invoice-apply.ts        export const applyLine / applyDocumentAuto / undoChange / undoDocument
 *   D  lib/invoice-answer.ts       export const answerQuestion
 *   B  lib/invoice-pipeline.ts     export const processStep: ProcessStep
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AnalyseContext,
  ExtractedInvoice,
  IngredientInvoiceCost,
  InvoiceAnalysis,
  InvoiceLineRow,
  InvoiceSettings,
  DocStatus,
} from "./invoice-types";

/** C: pure. Same input, same output, no clock, no network. */
export type AnalyseInvoice = (extracted: ExtractedInvoice, ctx: AnalyseContext) => InvoiceAnalysis;

/** C: pure. Last cost and quantity-weighted average landed cost per ingredient, from stored invoice lines (applied or not, product lines only). */
export type ComputeIngredientCosts = (
  lines: Pick<InvoiceLineRow, "ingredient_id" | "document_id" | "invoice_date" | "line_class" | "qty" | "unit_price_ex" | "landed_total_ex" | "landed_base_ex" | "base_qty" | "base_unit" | "packs_per_unit" | "state">[],
  settings: Pick<InvoiceSettings, "averageDays">,
  today: string,
) => IngredientInvoiceCost[];

/** D: reads everything the engine needs for one venue, through any Supabase client (service role or signed-in). */
export type LoadAnalyseContext = (sb: SupabaseClient, args: { venueId: number; folderVenueId: number; today: string }) => Promise<AnalyseContext>;

/** D: writes (or, with documentId, replaces) one document's row, lines and questions from an analysis. Never touches prices. */
export type SaveAnalysis = (
  sb: SupabaseClient,
  args: {
    fileId: string;
    venueId: number;
    extracted: ExtractedInvoice;
    analysis: InvoiceAnalysis;
    pagePdfPath: string | null;
    readModel: string | null;
    /** set when re-analysing an existing document: its lines are replaced, its questions re-derived, answered questions kept */
    documentId?: string;
  },
) => Promise<{ documentId: string; status: DocStatus; lineIds: string[] }>;

export interface ApplyResult {
  lineId: string;
  ok: boolean;
  /** what happened, in words a person can read */
  message: string;
  changeIds: string[];
  /** true when the target's current price was no longer the one the plan expected, so nothing was written */
  stale?: boolean;
}

export interface UndoResult {
  ok: boolean;
  message: string;
  /** the price was changed by someone else since; call again with force: true to set it back anyway */
  needsForce?: boolean;
  currentPrice?: number | null;
}

export type ApplyLine = (sb: SupabaseClient, args: { lineId: string; actor: string; mode: "auto" | "approved" }) => Promise<ApplyResult>;
export type ApplyDocumentAuto = (sb: SupabaseClient, args: { documentId: string; actor: string }) => Promise<ApplyResult[]>;
export type UndoChange = (sb: SupabaseClient, args: { changeId: string; actor: string; force?: boolean }) => Promise<UndoResult>;
export type UndoDocument = (sb: SupabaseClient, args: { documentId: string; actor: string; force?: boolean }) => Promise<UndoResult[]>;

export interface AnswerResult {
  ok: boolean;
  message: string;
  /** lines that now have a decision or were applied after the answer */
  applied: ApplyResult[];
}
/** D: records the answer, teaches invoice_item_map when the answer is a match, re-analyses the document, applies what the rules now allow. */
export type AnswerQuestion = (sb: SupabaseClient, args: { questionId: string; optionId: string; actor: string; note?: string }) => Promise<AnswerResult>;

/** B: does ONE bounded unit of work (about 45 seconds at most) and says whether more is waiting, so the caller loops. */
export interface ProcessStepResult {
  /** nothing left to do right now */
  idle: boolean;
  fileId: string | null;
  stage: "sorted" | "read" | "failed" | "idle";
  /** documents finished by this step, with a short-lived link to their split PDF for the scanner script to save to Drive */
  documents: { id: string; supplier: string | null; invoiceNumber: string | null; invoiceDate: string | null; venueSlug: string; fileName: string; downloadUrl: string | null; status: DocStatus }[];
  message: string;
}
export type ProcessStep = (deps: unknown) => Promise<ProcessStepResult>;
