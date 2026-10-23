/**
 * Wires the real modules into PipelineDeps for the reader's routes. SERVER ONLY.
 * Slack is not called per document: the scanner script posts the ids finished in one run to /api/invoices/digest, so a busy
 * scan sends one message per venue, not one per invoice.
 */
import { loadPrices, makeClaude } from "./invoice-ai";
import { applyDocumentAuto } from "./invoice-apply";
import { loadAnalyseContext } from "./invoice-context";
import { analyseInvoice } from "./invoice-engine";
import { realClock, resolveModels, type PipelineDeps } from "./invoice-pipeline";
import { supabaseRepo, supabaseStorage } from "./invoice-repo";
import { saveAnalysis } from "./invoice-store";
import { getServiceClient } from "./supabase/service";

export async function defaultDeps(env: Record<string, string | undefined> = process.env): Promise<PipelineDeps> {
  const sb = getServiceClient(env);
  return {
    sb,
    repo: supabaseRepo(sb),
    storage: supabaseStorage(sb),
    claude: makeClaude({ sb, env, prices: await loadPrices(sb) }),
    analyse: analyseInvoice,
    loadContext: loadAnalyseContext,
    save: saveAnalysis,
    autoApply: applyDocumentAuto,
    clock: realClock,
    models: resolveModels(env),
    env,
  };
}
