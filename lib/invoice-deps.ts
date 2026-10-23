/**
 * Wires the real modules into PipelineDeps. The engine, the store and the apply layer are written by other modules, so they are
 * loaded here by name at run time. The `webpackInclude` comment limits the bundler to exactly those files; once they exist the
 * orchestrator may swap the four lookups below for plain static imports.
 * SERVER ONLY.
 */
import type { AnalyseInvoice, ApplyDocumentAuto, LoadAnalyseContext, SaveAnalysis } from "./invoice-interfaces";
import { loadPrices, makeClaude } from "./invoice-ai";
import { realClock, resolveModels, type PipelineDeps } from "./invoice-pipeline";
import { supabaseRepo, supabaseStorage } from "./invoice-repo";
import { getServiceClient } from "./supabase/service";

type Mod = Record<string, unknown>;

async function loadModule(name: "invoice-engine" | "invoice-context" | "invoice-store" | "invoice-apply"): Promise<Mod> {
  try {
    return (await import(/* webpackInclude: /invoice-(engine|context|store|apply)\.tsx?$/ */ `./${name}`)) as Mod;
  } catch {
    throw new Error(`The ${name} module is not installed yet.`);
  }
}

function pick<T>(mod: Mod, name: string): T {
  if (typeof mod[name] !== "function") throw new Error(`${name} is missing from the invoice modules.`);
  return mod[name] as T;
}

export async function defaultDeps(env: Record<string, string | undefined> = process.env): Promise<PipelineDeps> {
  const sb = getServiceClient(env);
  const [engine, context, store, apply] = await Promise.all([loadModule("invoice-engine"), loadModule("invoice-context"), loadModule("invoice-store"), loadModule("invoice-apply")]);
  return {
    sb,
    repo: supabaseRepo(sb),
    storage: supabaseStorage(sb),
    claude: makeClaude({ sb, env, prices: await loadPrices(sb) }),
    analyse: pick<AnalyseInvoice>(engine, "analyseInvoice"),
    loadContext: pick<LoadAnalyseContext>(context, "loadAnalyseContext"),
    save: pick<SaveAnalysis>(store, "saveAnalysis"),
    autoApply: pick<ApplyDocumentAuto>(apply, "applyDocumentAuto"),
    // no notify hook yet: the Slack digest reads the saved documents instead
    clock: realClock,
    models: resolveModels(env),
    env,
  };
}
