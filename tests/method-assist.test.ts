import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askModel, assist, buildUserPrompt, DEFAULT_MODEL, isValidStepText, parseRequest, SYSTEM_PROMPT, validateReply } from "@/lib/method-assist";
import { requestTidy } from "@/lib/method-assist-client";
import { TidyError, type TidyInput } from "@/lib/method-style";

const METHOD = ["Chill the glass", "Add the lime juice", "Shake hard for 12 seconds", "Double strain into the glass", "Garnish with a lime wedge"];
const INPUT: TidyInput = {
  itemName: "Margarita",
  category: "Cocktail",
  glass: "Coupe Glass",
  lines: [
    { name: "Tequila Blanco", qty: 45, unit: "ml" },
    { name: "Lime Juice (L)", qty: 30, unit: "ml" },
  ],
  method: METHOD,
  mode: "answer",
  text: "strian over ise in the glas",
  noteTitle: "Strain over ice?",
};
const reply = (o: unknown) => JSON.stringify(o);
const ok = (ops: unknown) => ({ ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: reply({ ops }) }] }) }) as unknown as Response;

describe("parseRequest", () => {
  const good = { itemName: "Margarita", category: "Cocktail", glass: "", lines: [{ name: "Lime", qty: 30, unit: "ml" }], method: ["Chill the glass"], mode: "step", text: "shake hard" };
  it("accepts a well-formed body", () => {
    expect(parseRequest(good)).toMatchObject({ itemName: "Margarita", mode: "step", method: ["Chill the glass"], lines: [{ name: "Lime", qty: 30, unit: "ml" }] });
  });
  it("rejects bad shapes and oversized bodies", () => {
    for (const bad of [null, "x", {}, { ...good, mode: "other" }, { ...good, text: "   " }, { ...good, text: "x".repeat(401) }, { ...good, method: [1] }, { ...good, method: Array(41).fill("a") }, { ...good, lines: [{ qty: 1 }] }, { ...good, itemName: 5 }, { ...good, replaces: 5 }]) {
      expect(parseRequest(bad)).toBeNull();
    }
  });
});

describe("prompt", () => {
  it("states the house style and asks for JSON only", () => {
    for (const w of ["sentence case", "Australian English", "No em dashes", "30 ml", "12 seconds", "Chill the glass", "Wet and rim the glass with salt", "Shake hard for 12 seconds", "Double strain into the glass", "Fine strain into the glass", "Dump into the glass", "Top with soda, poured in gently", "Build in the glass", "Fill with ice", "Stir in ice for 20 to 30 seconds", "Ordinary ice only", "garnish steps last", "ONLY JSON"]) {
      expect(SYSTEM_PROMPT.toLowerCase()).toContain(w.toLowerCase());
    }
  });
  it("includes the numbered method, the lines and the typed text", () => {
    const p = buildUserPrompt(INPUT);
    expect(p).toContain("0. Chill the glass");
    expect(p).toContain("4. Garnish with a lime wedge");
    expect(p).toContain("- Lime Juice (L): 30 ml");
    expect(p).toContain("strian over ise in the glas");
    expect(p).toContain("Strain over ice?");
    expect(buildUserPrompt({ ...INPUT, replaces: "Shake hard" })).toContain('replaces the existing step containing: "Shake hard"');
  });
});

describe("isValidStepText", () => {
  it("accepts a plain step and rejects dashes, links, line breaks, bad lengths and large ice", () => {
    expect(isValidStepText("Strain over ice in the glass")).toBe(true);
    expect(isValidStepText("Pre-mix goes in first")).toBe(true);
    for (const bad of ["Strain — over ice", "Strain – over ice", "Strain - over ice", "Strain\nover ice", "Go to https://x.com now", "Visit example.com", "ab", "x".repeat(141), " leading space", "Pour over a large ice cube", "Add crushed ice", 42, null]) {
      expect(isValidStepText(bad)).toBe(false);
    }
  });
});

describe("validateReply", () => {
  const v = (o: unknown, over: Partial<Pick<TidyInput, "method" | "replaces">> = {}) => validateReply(typeof o === "string" ? o : reply(o), { method: METHOD, ...over });
  it("accepts one insert inside the method (0 to length)", () => {
    expect(v({ ops: [{ op: "insert", index: 4, text: "Strain over ice in the glass" }] })).toEqual([{ op: "insert", index: 4, text: "Strain over ice in the glass" }]);
    expect(v({ ops: [{ op: "insert", index: 0, text: "Chill the glass" }] })).toHaveLength(1);
    expect(v({ ops: [{ op: "insert", index: 5, text: "Serve straight away" }] })).toHaveLength(1);
  });
  it("rejects anything that is not exactly one valid op", () => {
    expect(v("not json")).toBeNull();
    expect(v('Here you go: {"ops":[]}')).toBeNull();
    expect(v({})).toBeNull();
    expect(v({ ops: [] })).toBeNull();
    expect(v({ ops: [{ op: "insert", index: 1, text: "Add the lime" }, { op: "insert", index: 2, text: "Add the salt" }] })).toBeNull();
    expect(v({ ops: [{ op: "insert", index: 6, text: "Strain over ice" }] })).toBeNull();
    expect(v({ ops: [{ op: "insert", index: -1, text: "Strain over ice" }] })).toBeNull();
    expect(v({ ops: [{ op: "insert", index: 1.5, text: "Strain over ice" }] })).toBeNull();
    expect(v({ ops: [{ op: "insert", index: "1", text: "Strain over ice" }] })).toBeNull();
    expect(v({ ops: [{ op: "delete", index: 1, text: "Strain over ice" }] })).toBeNull();
    expect(v({ ops: [{ op: "insert", index: 1, text: "Strain — over ice" }] })).toBeNull();
    expect(v({ ops: [{ op: "insert", index: 1, text: "ab" }] })).toBeNull();
    expect(v({ ops: [{ op: "insert", index: 1, text: "x".repeat(141) }] })).toBeNull();
    // a replace is only allowed when the note names a step
    expect(v({ ops: [{ op: "replace", index: 1, text: "Add the lime juice well" }] })).toBeNull();
  });
  it("forces a replace of the named step", () => {
    const o = v({ ops: [{ op: "insert", index: 0, text: "Shake hard for 15 seconds" }] }, { replaces: "shake hard" });
    expect(o).toEqual([{ op: "replace", index: 2, text: "Shake hard for 15 seconds" }]);
  });
});

describe("askModel (mocked fetch)", () => {
  const env = { ANTHROPIC_API_KEY: "test-key", ANTHROPIC_BASE_URL: "http://localhost:9999/" };
  it("does nothing without a key", async () => {
    const f = vi.fn();
    expect(await askModel(INPUT, {}, f as never)).toBeNull();
    expect(await askModel(INPUT, { ANTHROPIC_API_KEY: "  " }, f as never)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it("calls the messages endpoint with the right headers, model and token limit", async () => {
    const f = vi.fn().mockResolvedValue(ok([{ op: "insert", index: 4, text: "Strain over ice in the glass" }]));
    const ops = await askModel(INPUT, env, f as never);
    expect(ops).toEqual([{ op: "insert", index: 4, text: "Strain over ice in the glass" }]);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:9999/v1/messages");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "x-api-key": "test-key", "anthropic-version": "2023-06-01", "content-type": "application/json" });
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(DEFAULT_MODEL);
    expect(body.max_tokens).toBe(300);
    expect(body.system).toBe(SYSTEM_PROMPT);
    expect(body.messages[0].content).toContain("0. Chill the glass");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("uses METHOD_ASSIST_MODEL and the default base URL when set", async () => {
    const f = vi.fn().mockResolvedValue(ok([{ op: "insert", index: 1, text: "Add the salt" }]));
    await askModel(INPUT, { ANTHROPIC_API_KEY: "k", METHOD_ASSIST_MODEL: "some-model" }, f as never);
    expect(f.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/messages");
    expect(JSON.parse((f.mock.calls[0][1] as RequestInit).body as string).model).toBe("some-model");
  });
  it("returns null for a failed call, an error status, no text or a bad reply", async () => {
    expect(await askModel(INPUT, env, vi.fn().mockRejectedValue(new Error("down")) as never)).toBeNull();
    expect(await askModel(INPUT, env, vi.fn().mockResolvedValue({ ok: false, status: 529, json: async () => ({}) }) as never)).toBeNull();
    expect(await askModel(INPUT, env, vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: [] }) }) as never)).toBeNull();
    expect(await askModel(INPUT, env, vi.fn().mockResolvedValue(ok([{ op: "insert", index: 99, text: "Strain over ice" }])) as never)).toBeNull();
  });
});

describe("assist (AI path and fallback)", () => {
  const env = { ANTHROPIC_API_KEY: "test-key" };
  it("uses the model's step when it checks out", async () => {
    const f = vi.fn().mockResolvedValue(ok([{ op: "insert", index: 4, text: "Strain over ice in the glass" }]));
    expect(await assist(INPUT, env, f as never)).toEqual({ ops: [{ op: "insert", index: 4, text: "Strain over ice in the glass" }], source: "ai" });
  });
  it("falls back to the built-in tidy with no key", async () => {
    const f = vi.fn();
    const r = await assist(INPUT, {}, f as never);
    expect(f).not.toHaveBeenCalled();
    expect(r.source).toBe("builtin");
    expect(r.ops).toEqual([{ op: "insert", index: 4, text: "Strain over ice in the glass" }]);
  });
  it("falls back when the call fails, times out or the reply is invalid", async () => {
    for (const f of [vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError")), vi.fn().mockResolvedValue({ ok: false, status: 500 }), vi.fn().mockResolvedValue(ok([{ op: "insert", index: 2, text: "Strain — over ice" }]))]) {
      const r = await assist(INPUT, env, f as never);
      expect(r.source).toBe("builtin");
      expect(r.ops[0].text).toBe("Strain over ice in the glass");
    }
  });
  it("still throws TidyError for text that cannot be a step", async () => {
    await expect(assist({ ...INPUT, text: "https://example.com" }, {}, vi.fn() as never)).rejects.toBeInstanceOf(TidyError);
  });
});

describe("requestTidy (browser)", () => {
  const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;
  it("returns the server's answer when it is valid", async () => {
    const f = vi.fn().mockResolvedValue(res(200, { ops: [{ op: "insert", index: 4, text: "Strain over ice in the glass" }], source: "ai" }));
    expect(await requestTidy(INPUT, f as never)).toEqual({ ops: [{ op: "insert", index: 4, text: "Strain over ice in the glass" }], source: "ai" });
    expect(f.mock.calls[0][0]).toBe("/api/method-assist");
  });
  it("tidies in the browser when the route is down, signed out or answers nonsense", async () => {
    for (const f of [vi.fn().mockRejectedValue(new Error("offline")), vi.fn().mockResolvedValue(res(401, {})), vi.fn().mockResolvedValue(res(500, {})), vi.fn().mockResolvedValue(res(200, { ops: [{ op: "insert", index: 99, text: "Strain over ice" }] }))]) {
      const r = await requestTidy(INPUT, f as never);
      expect(r.source).toBe("builtin");
      expect(r.ops[0].text).toBe("Strain over ice in the glass");
    }
  });
  it("passes on a 422 as a TidyError", async () => {
    await expect(requestTidy(INPUT, vi.fn().mockResolvedValue(res(422, { error: "A step cannot hold a link" })) as never)).rejects.toThrow("A step cannot hold a link");
  });
});

// ------------------------------------------------------------------ the route

const auth = { user: { id: "u1" } as { id: string } | null, allowed: true as boolean | null, rpcError: false };
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: () => ({
    auth: { getUser: async () => ({ data: { user: auth.user } }) },
    rpc: async () => (auth.rpcError ? { data: null, error: { message: "x" } } : { data: auth.allowed, error: null }),
  }),
}));

describe("POST /api/method-assist", () => {
  const post = async (body: unknown, raw = false) => {
    const { POST } = await import("@/app/api/method-assist/route");
    return POST(new Request("http://localhost/api/method-assist", { method: "POST", body: raw ? (body as string) : JSON.stringify(body) }));
  };
  const reqBody = { itemName: "Margarita", category: "Cocktail", glass: "Coupe Glass", lines: [], method: METHOD, mode: "answer", text: "strian over ise in the glas" };
  const saved = { ...process.env };
  beforeEach(() => {
    auth.user = { id: "u1" };
    auth.allowed = true;
    auth.rpcError = false;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.NEXT_PUBLIC_DEMO;
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.unstubAllGlobals();
  });

  it("answers with the built-in tidy when there is no key", async () => {
    const r = await post(reqBody);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ops: [{ op: "insert", index: 4, text: "Strain over ice in the glass" }], source: "builtin" });
  });
  it("answers with the model's step when a key is set (mock fetch)", async () => {
    process.env.ANTHROPIC_API_KEY = "dummy";
    process.env.ANTHROPIC_BASE_URL = "http://localhost:9/";
    const f = vi.fn().mockResolvedValue(ok([{ op: "insert", index: 4, text: "Strain over ice in the glass" }]));
    vi.stubGlobal("fetch", f);
    const r = await post(reqBody);
    expect(await r.json()).toMatchObject({ source: "ai" });
    expect(f.mock.calls[0][0]).toBe("http://localhost:9/v1/messages");
  });
  it("falls back to the built-in tidy when the model call fails", async () => {
    process.env.ANTHROPIC_API_KEY = "dummy";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    expect(await (await post(reqBody)).json()).toMatchObject({ source: "builtin" });
  });
  it("refuses anyone who is not signed in, or not on the allow-list (and fails closed)", async () => {
    auth.user = null;
    expect((await post(reqBody)).status).toBe(401);
    auth.user = { id: "u1" };
    auth.allowed = false;
    expect((await post(reqBody)).status).toBe(401);
    auth.allowed = true;
    auth.rpcError = true;
    expect((await post(reqBody)).status).toBe(401);
  });
  it("never calls the model for a refused request", async () => {
    process.env.ANTHROPIC_API_KEY = "dummy";
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    auth.user = null;
    await post(reqBody);
    expect(f).not.toHaveBeenCalled();
  });
  it("400 for bad JSON or a bad body, 422 for text that cannot be a step", async () => {
    expect((await post("{nope", true)).status).toBe(400);
    expect((await post({ ...reqBody, mode: "x" })).status).toBe(400);
    const r = await post({ ...reqBody, text: "go to https://example.com" });
    expect(r.status).toBe(422);
    expect(await r.json()).toHaveProperty("error");
  });
  it("demo mode skips sign-in (local visual QA only)", async () => {
    process.env.NEXT_PUBLIC_DEMO = "1";
    auth.user = null;
    expect((await post(reqBody)).status).toBe(200);
  });
});
