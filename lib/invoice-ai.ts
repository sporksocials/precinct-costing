/**
 * Anthropic call wrapper for the invoice reader. Plain fetch (same headers and version as lib/method-assist.ts), a PDF sent as a
 * base64 `document` block, the token usage read back from the reply, the cost worked out from the ai_model_prices rows and EVERY
 * call (good or bad) written to ai_usage_log through the service client. Prompts, keys and PDF bytes are never logged.
 * SERVER ONLY.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { INVOICE_ENV } from "./invoice-types";
import { insertRow } from "./supabase/service";

export const DEFAULT_BASE_URL = "https://api.anthropic.com";
export const CALL_TIMEOUT_MS = 40_000;

// ---------------------------------------------------------------- prices
export interface ModelPrice {
  /** US dollars per million tokens */
  input_per_mtok: number;
  output_per_mtok: number;
  cache_read_per_mtok: number;
}
export type PriceTable = Record<string, ModelPrice>;

/** Used when ai_model_prices cannot be read (checked 24 Oct 2026; the table is the source of truth). */
export const FALLBACK_PRICES: PriceTable = {
  "claude-sonnet-5-5": { input_per_mtok: 2, output_per_mtok: 10, cache_read_per_mtok: 0.1 },
  "claude-haiku-5-5": { input_per_mtok: 0.1, output_per_mtok: 0.5, cache_read_per_mtok: 0.01 },
  "claude-opus-5-5": { input_per_mtok: 4, output_per_mtok: 20, cache_read_per_mtok: 0.2 },
  "claude-fable-5-1": { input_per_mtok: 10, output_per_mtok: 50, cache_read_per_mtok: 0.25 },
};

export interface AiUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
}
export const NO_USAGE: AiUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };

/** The price row for a model: exact name, then the same model family, then the dearest known price (so cost is never understated). */
export function priceFor(model: string, prices: PriceTable = FALLBACK_PRICES): ModelPrice {
  if (prices[model]) return prices[model];
  const family = ["sonnet", "haiku", "opus", "fable"].find((f) => model.toLowerCase().includes(f));
  if (family) {
    const hit = Object.keys(prices).find((k) => k.toLowerCase().includes(family));
    if (hit) return prices[hit];
  }
  return Object.values(prices).reduce((a, b) => (b.output_per_mtok > a.output_per_mtok ? b : a));
}

/** US dollars for one call, to 6 decimal places (the column's precision). Cached input is billed at its own rate. */
export function priceCall(model: string, usage: AiUsage, prices: PriceTable = FALLBACK_PRICES): number {
  const p = priceFor(model, prices);
  const usd = (usage.input_tokens * p.input_per_mtok + usage.output_tokens * p.output_per_mtok + usage.cache_read_input_tokens * p.cache_read_per_mtok) / 1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/** Loads ai_model_prices once (call this once per step). Falls back to the constants when the table cannot be read. */
export async function loadPrices(sb: SupabaseClient): Promise<PriceTable> {
  try {
    const { data, error } = await sb.from("ai_model_prices").select("*");
    if (error || !Array.isArray(data) || data.length === 0) return FALLBACK_PRICES;
    const out: PriceTable = { ...FALLBACK_PRICES };
    for (const r of data as Record<string, unknown>[]) {
      const input = Number(r.input_per_mtok);
      const output = Number(r.output_per_mtok);
      const cache = Number(r.cache_read_per_mtok ?? 0);
      if (typeof r.model === "string" && Number.isFinite(input) && Number.isFinite(output)) {
        out[r.model] = { input_per_mtok: input, output_per_mtok: output, cache_read_per_mtok: Number.isFinite(cache) ? cache : 0 };
      }
    }
    return out;
  } catch {
    return FALLBACK_PRICES;
  }
}

// ---------------------------------------------------------------- the call
export interface ClaudeCallArgs {
  model: string;
  system: string;
  /** the PDF to read, base64 */
  pdfBase64?: string;
  text: string;
  maxTokens: number;
  /** ai_usage_log.feature: invoice_sort, invoice_read, invoice_reread */
  feature: string;
  venueId?: number | null;
  fileId?: string | null;
  documentId?: string | null;
  /** overrides the 40 second default (the pipeline shortens it near the end of its time budget) */
  timeoutMs?: number;
}

export interface ClaudeCallResult {
  text: string;
  usage: AiUsage;
  costUsd: number;
  model: string;
  stopReason: string | null;
}

/** A failed call, in words a person can read. `reason` is short and has no secrets. */
export class AiError extends Error {
  constructor(
    message: string,
    public reason: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export type ClaudeFn = (args: ClaudeCallArgs) => Promise<ClaudeCallResult>;

export interface ClaudeOptions {
  sb: SupabaseClient;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  prices?: PriceTable;
}

const toCount = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);

/** Reads `usage` from a reply body. Anything missing counts as zero. */
export function readUsage(body: unknown): AiUsage {
  const u = (body as { usage?: Record<string, unknown> } | null)?.usage;
  if (!u || typeof u !== "object") return NO_USAGE;
  // cache writes are billed like input; the call never asks for caching, but count them rather than hide them
  return {
    input_tokens: toCount(u.input_tokens) + toCount(u.cache_creation_input_tokens),
    output_tokens: toCount(u.output_tokens),
    cache_read_input_tokens: toCount(u.cache_read_input_tokens),
  };
}

/** The key for invoice reading: its own workspace key when set, else the shared one. Never returned to a caller or logged. */
function apiKey(env: Record<string, string | undefined>): string | null {
  return env[INVOICE_ENV.anthropicKey]?.trim() || env[INVOICE_ENV.anthropicKeyFallback]?.trim() || null;
}

/** Builds the function the pipeline calls. One call = one usage row, whether it worked or not. */
export function makeClaude(opts: ClaudeOptions): ClaudeFn {
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const doFetch = opts.fetchImpl ?? fetch;
  let prices = opts.prices;

  async function logUsage(a: ClaudeCallArgs, usage: AiUsage, ok: boolean, note: string | null) {
    try {
      prices ??= await loadPrices(opts.sb);
      await insertRow(opts.sb, "ai_usage_log", {
        feature: a.feature,
        model: a.model,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_read_tokens: usage.cache_read_input_tokens,
        cost_usd: priceCall(a.model, usage, prices),
        venue_id: a.venueId ?? null,
        file_id: a.fileId ?? null,
        document_id: a.documentId ?? null,
        ok,
        note,
      });
    } catch {
      // a failed log must never break the read; the next call tries again
    }
  }

  return async (a) => {
    const key = apiKey(env);
    if (!key) {
      await logUsage(a, NO_USAGE, false, "no_key");
      throw new AiError("The invoice reader has no Anthropic key set.", "no_key");
    }
    const base = (env[INVOICE_ENV.anthropicBaseUrl]?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
    const content: unknown[] = [];
    if (a.pdfBase64) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: a.pdfBase64 } });
    content.push({ type: "text", text: a.text });

    let res: Response;
    try {
      res = await doFetch(`${base}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: a.model, max_tokens: a.maxTokens, system: a.system, messages: [{ role: "user", content }] }),
        signal: AbortSignal.timeout(a.timeoutMs ?? CALL_TIMEOUT_MS),
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      const reason = timedOut ? "timeout" : "network";
      await logUsage(a, NO_USAGE, false, reason);
      throw new AiError(timedOut ? "The reader took too long to answer." : "The reader could not be reached.", reason);
    }

    if (!res.ok) {
      let message = "";
      try {
        message = String(((await res.json()) as { error?: { message?: string } })?.error?.message ?? "");
      } catch {
        message = "";
      }
      const reason = /credit balance/i.test(message) ? "credits" : `http_${res.status}`;
      await logUsage(a, NO_USAGE, false, reason);
      throw new AiError(reason === "credits" ? "The Anthropic account is out of credit." : `The reader could not answer (error ${res.status}).`, reason);
    }

    type Reply = { content?: { type?: string; text?: string }[]; stop_reason?: string };
    let body: Reply | null;
    try {
      body = (await res.json()) as Reply;
    } catch {
      body = null;
    }
    const usage = readUsage(body);
    const text = (body?.content ?? []).find((c) => c?.type === "text" && typeof c.text === "string")?.text;
    if (!text) {
      await logUsage(a, usage, false, "empty_reply");
      throw new AiError("The reader sent back nothing.", "empty_reply");
    }
    await logUsage(a, usage, true, null);
    prices ??= await loadPrices(opts.sb);
    return { text, usage, costUsd: priceCall(a.model, usage, prices), model: a.model, stopReason: body?.stop_reason ?? null };
  };
}
