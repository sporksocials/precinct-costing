import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AiError, FALLBACK_PRICES, loadPrices, makeClaude, priceCall, priceFor, readUsage } from "@/lib/invoice-ai";

// ---------------------------------------------------------------- cost maths
describe("priceCall", () => {
  const u = (i: number, o: number, c = 0) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: c });
  it("Sonnet 5.5 is $2 in and $10 out per million tokens", () => {
    expect(priceCall("claude-sonnet-5-5", u(1_000_000, 0))).toBe(2);
    expect(priceCall("claude-sonnet-5-5", u(0, 1_000_000))).toBe(10);
    expect(priceCall("claude-sonnet-5-5", u(20_000, 3_000))).toBe(0.07);
  });
  it("Haiku 5.5 is $0.10 in and $0.50 out", () => {
    expect(priceCall("claude-haiku-5-5", u(1_000_000, 0))).toBe(0.1);
    expect(priceCall("claude-haiku-5-5", u(0, 1_000_000))).toBe(0.5);
    expect(priceCall("claude-haiku-5-5", u(30_000, 1_200))).toBe(0.0036);
  });
  it("Opus 5.5 is $4 and $20, Fable 5.1 is $10 and $50", () => {
    expect(priceCall("claude-opus-5-5", u(1_000_000, 1_000_000))).toBe(24);
    expect(priceCall("claude-fable-5-1", u(1_000_000, 1_000_000))).toBe(60);
  });
  it("bills cached input at its own rate", () => {
    expect(priceCall("claude-sonnet-5-5", u(0, 0, 1_000_000))).toBe(0.1);
  });
  it("uses the table's price over the constants, and a family match for a dated model name", () => {
    const table = { ...FALLBACK_PRICES, "claude-sonnet-5-5": { input_per_mtok: 3, output_per_mtok: 15, cache_read_per_mtok: 0.3 } };
    expect(priceCall("claude-sonnet-5-5", u(1_000_000, 0), table)).toBe(3);
    expect(priceFor("claude-haiku-5-5-20261001")).toEqual(FALLBACK_PRICES["claude-haiku-5-5"]);
  });
  it("never understates an unknown model: the dearest known price applies", () => {
    expect(priceCall("some-new-model", u(0, 1_000_000))).toBe(50);
  });
  it("reads usage from a reply, zero for anything missing", () => {
    expect(readUsage({ usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 } })).toEqual({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 });
    expect(readUsage({})).toEqual({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 });
    expect(readUsage({ usage: { input_tokens: "x", output_tokens: -4 } }).output_tokens).toBe(0);
  });
});

// ---------------------------------------------------------------- a fake database that records usage rows and serves prices
function fakeSb(prices?: Record<string, unknown>[] | "error") {
  const rows: Record<string, unknown>[] = [];
  const sb = {
    from(table: string) {
      return {
        upsert: async (row: Record<string, unknown> | Record<string, unknown>[]) => {
          if (table === "ai_usage_log") rows.push(...(Array.isArray(row) ? row : [row]));
          return { data: null, error: null };
        },
        select: async () => {
          if (table !== "ai_model_prices") return { data: null, error: null };
          return prices === "error" ? { data: null, error: { message: "denied" } } : { data: prices ?? [], error: null };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { sb, rows };
}

// ---------------------------------------------------------------- a local mock of the Anthropic API
interface Seen {
  headers: IncomingMessage["headers"];
  body: Record<string, unknown>;
}
let server: Server;
let base = "";
let seen: Seen[] = [];
let respond: (n: number) => { status: number; body: unknown; delayMs?: number };

beforeEach(async () => {
  seen = [];
  respond = () => ({ status: 200, body: { content: [{ type: "text", text: "{}" }], usage: { input_tokens: 1000, output_tokens: 200 }, stop_reason: "end_turn" } });
  server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      seen.push({ headers: req.headers, body: JSON.parse(data || "{}") });
      const r = respond(seen.length);
      setTimeout(() => {
        res.writeHead(r.status, { "content-type": "application/json" });
        res.end(JSON.stringify(r.body));
      }, r.delayMs ?? 0);
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise<void>((ok) => server.close(() => ok()));
});

const args = { model: "claude-sonnet-5-5", system: "SYS", text: "read it", maxTokens: 500, feature: "invoice_read", venueId: 1, fileId: "f1", documentId: "d1" };

describe("makeClaude against a local mock server", () => {
  it("sends the PDF as a document block with the right headers, reads usage and writes a usage row", async () => {
    const { sb, rows } = fakeSb();
    const claude = makeClaude({ sb, env: { ANTHROPIC_API_KEY: "test-key", ANTHROPIC_BASE_URL: base + "/" } });
    const r = await claude({ ...args, pdfBase64: "QUJD" });
    expect(r.text).toBe("{}");
    expect(r.usage).toEqual({ input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0 });
    expect(r.costUsd).toBe(0.004); // 1000 x $2/M + 200 x $10/M
    expect(seen[0].headers["x-api-key"]).toBe("test-key");
    expect(seen[0].headers["anthropic-version"]).toBe("2023-06-01");
    expect(seen[0].body.model).toBe("claude-sonnet-5-5");
    expect(seen[0].body.max_tokens).toBe(500);
    expect(seen[0].body.system).toBe("SYS");
    const content = (seen[0].body.messages as { content: Record<string, unknown>[] }[])[0].content;
    expect(content[0]).toEqual({ type: "document", source: { type: "base64", media_type: "application/pdf", data: "QUJD" } });
    expect(content[1]).toEqual({ type: "text", text: "read it" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ feature: "invoice_read", model: "claude-sonnet-5-5", input_tokens: 1000, output_tokens: 200, cache_read_tokens: 0, cost_usd: 0.004, venue_id: 1, file_id: "f1", document_id: "d1", ok: true });
    expect(rows[0].note).toBeUndefined(); // null keys are stripped
  });

  it("prefers INVOICE_ANTHROPIC_API_KEY over the shared key", async () => {
    const { sb } = fakeSb();
    await makeClaude({ sb, env: { INVOICE_ANTHROPIC_API_KEY: "invoice-key", ANTHROPIC_API_KEY: "shared", ANTHROPIC_BASE_URL: base } })(args);
    expect(seen[0].headers["x-api-key"]).toBe("invoice-key");
  });

  it("uses prices from the table when it can be read", async () => {
    const { sb, rows } = fakeSb([{ model: "claude-sonnet-5-5", input_per_mtok: 4, output_per_mtok: 20, cache_read_per_mtok: 0.4 }]);
    await makeClaude({ sb, env: { ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: base } })(args);
    expect(rows[0].cost_usd).toBe(0.008);
  });

  it("falls back to the constants when the price table cannot be read", async () => {
    const { sb, rows } = fakeSb("error");
    expect(await loadPrices(sb)).toEqual(FALLBACK_PRICES);
    await makeClaude({ sb, env: { ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: base } })({ ...args, model: "claude-haiku-5-5" });
    expect(rows[0].cost_usd).toBe(0.0002); // 1000 x $0.10/M + 200 x $0.50/M
  });

  it("writes a usage row for an API error (ok false, no tokens) and throws a plain AiError", async () => {
    respond = () => ({ status: 529, body: { error: { message: "Overloaded" } } });
    const { sb, rows } = fakeSb();
    const claude = makeClaude({ sb, env: { ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: base } });
    await expect(claude(args)).rejects.toMatchObject({ name: "AiError", reason: "http_529" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ok: false, note: "http_529", input_tokens: 0, cost_usd: 0 });
  });

  it("names an out-of-credit account in plain words", async () => {
    respond = () => ({ status: 400, body: { error: { message: "Your credit balance is too low to access the Anthropic API." } } });
    const { sb, rows } = fakeSb();
    await expect(makeClaude({ sb, env: { ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: base } })(args)).rejects.toThrow(/out of credit/);
    expect(rows[0]).toMatchObject({ ok: false, note: "credits" });
  });

  it("writes a usage row for a timeout", async () => {
    respond = () => ({ status: 200, body: {}, delayMs: 400 });
    const { sb, rows } = fakeSb();
    const claude = makeClaude({ sb, env: { ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: base } });
    await expect(claude({ ...args, timeoutMs: 50 })).rejects.toMatchObject({ reason: "timeout" });
    expect(rows[0]).toMatchObject({ ok: false, note: "timeout" });
  });

  it("writes a usage row when the server cannot be reached", async () => {
    const { sb, rows } = fakeSb();
    await expect(makeClaude({ sb, env: { ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: "http://127.0.0.1:9" } })(args)).rejects.toMatchObject({ reason: "network" });
    expect(rows[0]).toMatchObject({ ok: false, note: "network" });
  });

  it("bills a reply that came back empty (the tokens were spent) and marks it failed", async () => {
    respond = () => ({ status: 200, body: { content: [], usage: { input_tokens: 500, output_tokens: 0 } } });
    const { sb, rows } = fakeSb();
    await expect(makeClaude({ sb, env: { ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: base } })(args)).rejects.toBeInstanceOf(AiError);
    expect(rows[0]).toMatchObject({ ok: false, note: "empty_reply", input_tokens: 500 });
  });

  it("with no key, logs a failed row and never calls out", async () => {
    const { sb, rows } = fakeSb();
    await expect(makeClaude({ sb, env: { ANTHROPIC_BASE_URL: base } })(args)).rejects.toMatchObject({ reason: "no_key" });
    expect(seen).toHaveLength(0);
    expect(rows[0]).toMatchObject({ ok: false, note: "no_key" });
  });

  it("a failing usage log never breaks the read, and the key is never in an error message", async () => {
    const sb = { from: () => ({ upsert: async () => { throw new Error("db down"); }, select: async () => ({ data: null, error: null }) }) } as unknown as SupabaseClient;
    const r = await makeClaude({ sb, env: { ANTHROPIC_API_KEY: "super-secret-key", ANTHROPIC_BASE_URL: base } })(args);
    expect(r.text).toBe("{}");
    respond = () => ({ status: 401, body: { error: { message: "invalid x-api-key super-secret-key" } } });
    await expect(makeClaude({ sb, env: { ANTHROPIC_API_KEY: "super-secret-key", ANTHROPIC_BASE_URL: base } })(args)).rejects.toSatisfy((e: unknown) => !(e as Error).message.includes("super-secret-key"));
  });
});
