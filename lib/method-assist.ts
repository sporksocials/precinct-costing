/**
 * Server side of the method step tidy (app/api/method-assist/route.ts): the smart path and its checks.
 *
 * With ANTHROPIC_API_KEY set, the model is asked for ONE step and where it goes, and the reply is only used if it passes
 * every check below. With no key, a failed call, a timeout or a reply that does not check out, the built-in engine
 * (lib/method-style.ts) answers instead. The answer shape is the same either way.
 */
import { findStepIndex, STEP_MAX, STEP_MIN, tidyBuiltin, type MethodOp, type TidyInput, type TidyLine, type TidyResult } from "./method-style";

export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
export const DEFAULT_BASE_URL = "https://api.anthropic.com";
export const TIMEOUT_MS = 8000;

// ---------------------------------------------------------------- request

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max ? v : null);

/** Reads and bounds the request body; null when it is not a usable request. */
export function parseRequest(body: unknown): TidyInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const itemName = str(b.itemName, 120);
  const text = str(b.text, 400);
  if (itemName == null || text == null || !text.trim()) return null;
  if (b.mode !== "step" && b.mode !== "answer") return null;
  const category = str(b.category ?? "", 40);
  const glass = str(b.glass ?? "", 120);
  if (category == null || glass == null) return null;
  const method = Array.isArray(b.method) ? b.method : [];
  if (method.length > 40 || method.some((m) => typeof m !== "string" || m.length > 300)) return null;
  const rawLines = Array.isArray(b.lines) ? b.lines : [];
  if (rawLines.length > 80) return null;
  const lines: TidyLine[] = [];
  for (const l of rawLines as Record<string, unknown>[]) {
    const name = str(l?.name, 120);
    if (name == null) return null;
    const qty = Number(l.qty);
    lines.push({ name, qty: Number.isFinite(qty) ? qty : undefined, unit: typeof l.unit === "string" ? l.unit.slice(0, 12) : undefined });
  }
  const replaces = b.replaces == null ? undefined : str(b.replaces, 300);
  const noteTitle = b.noteTitle == null ? undefined : str(b.noteTitle, 200);
  if (replaces === null || noteTitle === null) return null;
  return { itemName, category, glass, lines, method: method as string[], mode: b.mode, text, replaces, noteTitle };
}

// ---------------------------------------------------------------- prompt

export const SYSTEM_PROMPT = `You tidy one method step for a bar recipe card at an Australian venue. You are given the drink's recipe lines, its current method (numbered from 0) and a step someone typed or suggested. Write that one step in the house style and say where it goes.

House style:
- One short imperative sentence per step, in sentence case, in Australian English.
- No full stop at the end unless the step has two sentences.
- No em dashes or en dashes anywhere. No hyphens used as dashes.
- Amounts as numerals with units, for example 30 ml or 12 seconds.
- Use the bar verbs this menu uses: Chill the glass, Wet and rim the glass with salt, Shake hard for 12 seconds, Double strain into the glass, Fine strain into the glass, Dump into the glass, Top with soda, poured in gently, Build in the glass, Fill with ice, Stir in ice for 20 to 30 seconds.
- Ordinary ice only. Never write large ice, a large cube, crushed ice or freshly pulled espresso.
- Never invent an ingredient, amount or time that is not in the recipe lines or in the typed text. The bar verbs above are for wording only: copy a time from them only when the typed text gives that time. "A quick stir" is Stir briefly, never a number of seconds.
- Fix spelling. Keep the person's meaning.

Where it goes, by the usual order of a drink: rim and chill the glass first, then ingredients added, then shake or stir or blend, then strain or dump, then top and fill, then garnish steps last.
- "insert" puts the step at an index from 0 (the very start) to the number of current steps (the very end). The new step takes that position.
- "replace" swaps the step at that index for the new one. Use it only when the user message names a step to replace.

Reply with ONLY JSON in exactly this shape and nothing else, no code fence and no commentary:
{"ops":[{"op":"insert","index":3,"text":"Strain over ice in the glass"}]}`;

export function buildUserPrompt(input: TidyInput): string {
  const lines = input.lines.length ? input.lines.map((l) => `- ${l.name}${l.qty != null ? `: ${l.qty}${l.unit ? ` ${l.unit}` : ""}` : ""}`).join("\n") : "(none)";
  const method = input.method.length ? input.method.map((m, i) => `${i}. ${m}`).join("\n") : "(no steps yet)";
  const ask =
    input.mode === "answer"
      ? `The venue was asked${input.noteTitle ? ` "${input.noteTitle}"` : " a question about this drink"} and typed this answer. Turn it into one method step:`
      : `A suggested step${input.noteTitle ? ` (note: "${input.noteTitle}")` : ""} to tidy and place:`;
  return [
    `Drink: ${input.itemName}${input.category ? ` (${input.category})` : ""}`,
    `Glass: ${input.glass || "not set"}`,
    `Recipe lines:\n${lines}`,
    `Current method (${input.method.length} steps):\n${method}`,
    input.replaces ? `This step replaces the existing step containing: "${input.replaces}"` : "This step is added; it does not replace anything.",
    `${ask}\n"""${input.text}"""`,
  ].join("\n\n");
}

// ---------------------------------------------------------------- reply checks

const DASH = /[‒-―−]|(^|\s)-+(\s|$)/;
const URLISH = /https?:\/\/|www\.|\.com\b|\.au\b/i;

/** True when `text` can be shown as a method step (length, no dashes, line breaks or links). */
export function isValidStepText(text: unknown): text is string {
  if (typeof text !== "string") return false;
  const t = text.trim();
  if (t !== text || t.length < STEP_MIN || t.length > STEP_MAX) return false;
  if (/[\r\n\t]/.test(t) || DASH.test(t) || URLISH.test(t)) return false;
  if (/\b(?:large|big) (?:ice )?(?:cube|block|ice)\b|\bcrushed ice\b/i.test(t)) return false;
  return true;
}

/** Pulls the JSON object out of a reply, even when the model wrapped it in a code fence or added a sentence around it. */
export function extractJson(raw: string): unknown {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const from = t.indexOf("{");
    const to = t.lastIndexOf("}");
    if (from < 0 || to <= from) return undefined;
    try {
      return JSON.parse(t.slice(from, to + 1));
    } catch {
      return undefined;
    }
  }
}

/**
 * Parses and validates the model's reply: JSON (a code fence or a sentence around it is tolerated), exactly one op, the
 * index inside the method (an index just past either end is pulled in), a valid step text. When the note names a step to
 * replace and it is found, the op is forced to replace that step. `reason` says which check failed.
 */
export function validateReplyDetailed(raw: string, input: Pick<TidyInput, "method" | "replaces">): { ops: MethodOp[] } | { reason: string } {
  const json = extractJson(raw);
  if (!json || typeof json !== "object") return { reason: "bad_reply_json" };
  const ops = (json as { ops?: unknown }).ops;
  if (!Array.isArray(ops) || ops.length !== 1) return { reason: "bad_reply_ops" };
  const o = ops[0] as Record<string, unknown>;
  if (!o || (o.op !== "insert" && o.op !== "replace")) return { reason: "bad_reply_op" };
  if (typeof o.index !== "number" || !Number.isInteger(o.index)) return { reason: "bad_reply_index" };
  const text = typeof o.text === "string" ? o.text.trim().replace(/^["“]|["”]$/g, "").trim() : o.text;
  if (!isValidStepText(text)) return { reason: "bad_reply_text" };
  const n = input.method.length;
  const at = findStepIndex(input.method, input.replaces);
  if (at >= 0) {
    // the note names the step it replaces: that is where the new step goes, whatever the model chose
    return { ops: [{ op: "replace", index: at, text }] };
  }
  if (o.op !== "insert") return { reason: "bad_reply_op" };
  if (o.index < 0 || o.index > n) return { reason: "bad_reply_index" };
  return { ops: [{ op: "insert", index: o.index, text }] };
}

/** The validated ops, or null on any failure. */
export function validateReply(raw: string, input: Pick<TidyInput, "method" | "replaces">): MethodOp[] | null {
  const r = validateReplyDetailed(raw, input);
  return "ops" in r ? r.ops : null;
}

// ---------------------------------------------------------------- the call

export interface AssistEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_BASE_URL?: string;
  METHOD_ASSIST_MODEL?: string;
}

/** Asks the model; `ops` is the validated step, or null with a `reason` (no key, network, timeout, API error, bad reply). */
export async function askModelDetailed(input: TidyInput, env: AssistEnv, fetchImpl: typeof fetch = fetch): Promise<{ ops: MethodOp[] | null; reason?: string }> {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) return { ops: null, reason: "no_key" };
  const base = (env.ANTHROPIC_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  try {
    const res = await fetchImpl(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: env.METHOD_ASSIST_MODEL?.trim() || DEFAULT_MODEL,
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(input) }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      let body = null as { error?: { message?: string } } | null;
      try {
        body = (await res.json()) as typeof body;
      } catch {
        body = null;
      }
      return { ops: null, reason: /credit balance/i.test(body?.error?.message ?? "") ? "credits" : `http_${res.status}` };
    }
    const data = (await res.json()) as { content?: { type?: string; text?: string }[] };
    const text = (data.content ?? []).find((c) => c?.type === "text" && typeof c.text === "string")?.text;
    if (!text) return { ops: null, reason: "bad_reply_empty" };
    const r = validateReplyDetailed(text, input);
    return "ops" in r ? { ops: r.ops } : { ops: null, reason: r.reason };
  } catch (e) {
    return { ops: null, reason: e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "timeout" : "network" };
  }
}

/** Asks the model; returns the validated ops, or null for any failure (no key, network, timeout, bad reply). */
export async function askModel(input: TidyInput, env: AssistEnv, fetchImpl: typeof fetch = fetch): Promise<MethodOp[] | null> {
  return (await askModelDetailed(input, env, fetchImpl)).ops;
}

/** The answer for a request: the model's step when it passes the checks, else the built-in tidy. May throw TidyError. */
export async function assist(input: TidyInput, env: AssistEnv = process.env as AssistEnv, fetchImpl: typeof fetch = fetch): Promise<TidyResult> {
  const { ops, reason } = await askModelDetailed(input, env, fetchImpl);
  if (ops) return { ops, source: "ai" };
  return { ...tidyBuiltin(input), fallback: reason };
}
