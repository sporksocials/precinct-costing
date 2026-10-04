/**
 * Browser side of the method step tidy: asks /api/method-assist and, whenever that is not available (offline, signed
 * out, a server error, a reply that does not check out), tidies with the built-in engine right here. The only error
 * that reaches the person is "that text cannot be a step" (TidyError), which both paths raise the same way.
 */
import { isValidStepText } from "./method-assist";
import { tidyBuiltin, TidyError, type MethodOp, type TidyInput, type TidyResult } from "./method-style";

function okOps(ops: unknown, method: readonly string[], replaces: string | undefined): ops is MethodOp[] {
  if (!Array.isArray(ops) || ops.length !== 1) return false;
  const o = ops[0] as Partial<MethodOp> | undefined;
  if (!o || (o.op !== "insert" && o.op !== "replace") || typeof o.index !== "number" || !Number.isInteger(o.index) || !isValidStepText(o.text)) return false;
  return o.op === "insert" ? o.index >= 0 && o.index <= method.length : o.index >= 0 && o.index < method.length && !!replaces;
}

export async function requestTidy(input: TidyInput, fetchImpl: typeof fetch = fetch): Promise<TidyResult> {
  try {
    const res = await fetchImpl("/api/method-assist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(12000),
    });
    if (res.status === 422) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new TidyError(body?.error || "Could not tidy that step");
    }
    if (res.ok) {
      const body = (await res.json()) as Partial<TidyResult>;
      if (okOps(body.ops, input.method, input.replaces)) return { ops: body.ops, source: body.source === "ai" ? "ai" : "builtin", fallback: typeof body.fallback === "string" ? body.fallback.slice(0, 40) : undefined };
    }
  } catch (e) {
    if (e instanceof TidyError) throw e;
  }
  return { ...tidyBuiltin(input), fallback: "unreachable" };
}
