/**
 * Wires the real modules into PipelineDeps for the reader's routes. SERVER ONLY.
 * Slack is not called per document: the scanner script posts the ids finished in one run to /api/invoices/digest, so a busy
 * scan sends one message per venue, not one per invoice.
 */
import { loadPrices, makeClaude } from "./invoice-ai";
import { addSuggestions } from "./invoice-suggest-ai";
import { applyDocumentAuto } from "./invoice-apply";
import { loadAnalyseContext } from "./invoice-context";
import { analyseInvoice } from "./invoice-engine";
import { realClock, resolveModels, type PipelineDeps } from "./invoice-pipeline";
import { reanalyseNext } from "./invoice-reanalyse";
import { supabaseRepo, supabaseStorage } from "./invoice-repo";
import { saveAnalysis } from "./invoice-store";
import { getServiceClient } from "./supabase/service";

/**
 * Older documents whose open unmatched-line questions never had suggestions asked for (no invoice_suggest AI call is logged for them),
 * a few at a time. Asking is recorded by the call itself, so a document where the model found nothing is not asked again.
 */
async function documentsToSuggest(sb: ReturnType<typeof getServiceClient>): Promise<string[]> {
  const open = await sb.from("invoice_questions").select("document_id").eq("status", "open").eq("kind", "unmatched_line").limit(500);
  const docIds = [...new Set(((open.data ?? []) as { document_id: string }[]).map((r) => r.document_id))];
  if (docIds.length === 0) return [];
  const asked = await sb.from("ai_usage_log").select("document_id").eq("feature", "invoice_suggest").in("document_id", docIds);
  const done = new Set(((asked.data ?? []) as { document_id: string }[]).map((r) => r.document_id));
  return docIds.filter((id) => !done.has(id)).slice(0, 6);
}

export async function defaultDeps(env: Record<string, string | undefined> = process.env): Promise<PipelineDeps> {
  const sb = getServiceClient(env);
  const claude = makeClaude({ sb, env, prices: await loadPrices(sb) });
  return {
    sb,
    repo: supabaseRepo(sb),
    storage: supabaseStorage(sb),
    claude,
    suggest: async (documentId) => {
      await addSuggestions(sb, claude, documentId, { env });
    },
    suggestNext: async () => {
      // the first document that really needed a model call; documents that needed none (already suggested, nothing to ask) are passed over
      for (const id of await documentsToSuggest(sb)) {
        const out = await addSuggestions(sb, claude, id, { env });
        if (out.asked > 0) return true;
      }
      return false;
    },
    reanalyseNext: () =>
      reanalyseNext(sb, {
        analyse: analyseInvoice,
        loadContext: loadAnalyseContext,
        save: saveAnalysis,
        autoApply: applyDocumentAuto,
        today: () => realClock.today(),
        firstReadModel: resolveModels(env).read,
      }),
    analyse: analyseInvoice,
    loadContext: loadAnalyseContext,
    save: saveAnalysis,
    autoApply: applyDocumentAuto,
    clock: realClock,
    models: resolveModels(env),
    env,
  };
}
