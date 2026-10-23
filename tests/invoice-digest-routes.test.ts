import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/** A small in-memory stand-in for the parts of supabase-js the digest code uses. */
function fakeSb(tables: Tables, files: Record<string, number> = {}, brokenSign: string[] = []) {
  const upserts: { table: string; row: Row }[] = [];
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let op: "select" | "update" | "upsert" = "select";
    let patch: Row = {};
    let row: Row = {};
    let orderBy: string | null = null;
    let max = Infinity;
    const b: Record<string, unknown> = {};
    const chain = (fn: (...a: never[]) => void) => (...a: never[]) => (fn(...a), b);
    b.select = chain(() => {});
    b.eq = chain(((c: string, v: unknown) => filters.push((r) => r[c] === v)) as never);
    b.in = chain(((c: string, vs: unknown[]) => filters.push((r) => vs.includes(r[c]))) as never);
    b.is = chain(((c: string, v: unknown) => filters.push((r) => (r[c] ?? null) === v)) as never);
    b.overlaps = chain(((c: string, vs: string[]) => filters.push((r) => ((r[c] as string[] | null) ?? []).some((x) => vs.includes(x)))) as never);
    b.order = chain(((c: string) => (orderBy = c)) as never);
    b.limit = chain(((n: number) => (max = n)) as never);
    b.update = chain(((p: Row) => ((op = "update"), (patch = p))) as never);
    b.upsert = chain(((r: Row) => ((op = "upsert"), (row = r))) as never);
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve()
        .then(() => {
          const t = (tables[table] ??= []);
          if (op === "upsert") {
            t.push({ ...row });
            upserts.push({ table, row: { ...row } });
            return { data: null, error: null };
          }
          const hits = t.filter((r) => filters.every((f) => f(r)));
          if (op === "update") {
            hits.forEach((r) => Object.assign(r, patch));
            return { data: null, error: null };
          }
          let out = hits.map((r) => ({ ...r }));
          if (orderBy) out = out.sort((x, y) => String(x[orderBy!]).localeCompare(String(y[orderBy!])));
          return { data: out.slice(0, max), error: null };
        })
        .then(res, rej);
    return b;
  };
  const storage = {
    from: () => ({
      list: async (_dir: string, o: { search: string }) => ({ data: o.search in files ? [{ name: o.search, metadata: { size: files[o.search] } }] : [], error: null }),
      createSignedUrl: async (path: string) => (brokenSign.includes(path) ? { data: null, error: { message: "nope" } } : { data: { signedUrl: `https://files.example/sign/${path}?token=SECRET123` }, error: null }),
    }),
  };
  return { sb: { from, storage } as never, upserts, tables };
}

const VENUES: Row[] = [
  { id: 1, name: "Drift", slug: "drift", sort: 1 },
  { id: 3, name: "Greedy Gringo's", slug: "greedy", sort: 3 },
];
const D1 = "11111111-1111-4111-8111-111111111111";
const D2 = "22222222-2222-4222-8222-222222222222";
const D3 = "33333333-3333-4333-8333-333333333333";
const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const Q1 = "bbbbbbbb-0001-4bbb-8bbb-bbbbbbbbbbbb";
const Q2 = "bbbbbbbb-0002-4bbb-8bbb-bbbbbbbbbbbb";
const Q3 = "bbbbbbbb-0003-4bbb-8bbb-bbbbbbbbbbbb";

function dataset(): Tables {
  return {
    cost_venues: VENUES.map((v) => ({ ...v })),
    cost_settings: [{ key: "invoice_auto_apply_pct", value: 0.05 }],
    invoice_suppliers: [{ id: S1, name: "Daniel Street Fish Market" }],
    invoice_documents: [
      { id: D1, venue_id: 1, supplier_id: S1, supplier_name_read: "DANIEL ST", doc_type: "invoice", status: "needs_review", invoice_number: "51329", invoice_date: "2026-10-14", page_pdf_path: `drift/${D1}.pdf` },
      { id: D2, venue_id: 1, supplier_id: null, supplier_name_read: "CD Australia Pty Ltd trading as Diablo Co", doc_type: "invoice", status: "applied", invoice_number: "ENV-34730", invoice_date: "2026-10-22", page_pdf_path: `drift/${D2}.pdf` },
      { id: D3, venue_id: 3, supplier_id: null, supplier_name_read: "Star", doc_type: "invoice", status: "nothing_to_apply", invoice_number: "9", invoice_date: "2026-10-20", page_pdf_path: null },
    ],
    invoice_lines: [
      { document_id: D1, line_no: 1, line_class: "product", description: "Kingfish fillets", unit: "KG", unit_price_ex: 74.2, change_pct: 0.0769, old_pack_price: null, new_pack_price: null, old_product_price: null, new_product_price: null, decision: "needs_approval", state: "open" },
      { document_id: D2, line_no: 1, line_class: "product", description: "Lychee Liqueur 700ml", unit: "EA", unit_price_ex: 38.62, change_pct: 0.01, old_pack_price: null, new_pack_price: null, old_product_price: null, new_product_price: null, decision: "apply", state: "applied" },
    ],
    invoice_price_changes: [
      { document_id: D2, kind: "price_change", status: "applied" },
      { document_id: D2, kind: "price_confirmed", status: "applied" },
    ],
    invoice_questions: [
      { id: Q1, venue_id: 1, document_id: D1, kind: "unmatched_line", prompt: "Is Humpty Doo Barramundi the same as Barramundi fillets?", status: "open", emailed_at: null, created_at: "2026-10-20T01:00:00Z" },
      { id: Q2, venue_id: 1, document_id: D2, kind: "unmatched_line", prompt: "Is Lychee Liqueur 700ml our Lychee Liqueur?", status: "open", emailed_at: null, created_at: "2026-10-23T01:00:00Z" },
      { id: Q3, venue_id: 3, document_id: D3, kind: "totals_mismatch", prompt: "Do the totals match?", status: "answered", emailed_at: null, created_at: "2026-10-21T01:00:00Z" },
    ],
    invoice_digests: [],
  };
}

const SECRET = "test-secret-value-0123456789abcdef";
let current: ReturnType<typeof fakeSb>;

vi.mock("@/lib/invoice-digest-data", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/invoice-digest-data")>();
  return { ...orig, getServiceClient: () => current.sb };
});

import { INVOICE_DIGEST_PATHS, notifyDocuments, postToSlack, secretOk, checkSecret, cleanIds } from "@/lib/invoice-digest-data";
import * as digestRoute from "@/app/api/invoices/digest/route";
import * as weeklyRoute from "@/app/api/invoices/weekly/route";

const DASHES = /[—–―]/;
const okFetch = () => vi.fn(async () => ({ ok: true, status: 200 }) as Response);

beforeEach(() => {
  current = fakeSb(dataset(), { [`${D1}.pdf`]: 250_000, [`${D2}.pdf`]: 180_000 });
  vi.stubEnv("INVOICE_INGEST_SECRET", SECRET);
  vi.stubEnv("INVOICE_SLACK_WEBHOOK_URL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("secret check", () => {
  it("accepts only the exact secret, in constant time terms", () => {
    expect(secretOk(SECRET, SECRET)).toBe(true);
    expect(secretOk(`${SECRET} `, SECRET)).toBe(true);
    expect(secretOk("wrong", SECRET)).toBe(false);
    expect(secretOk("", SECRET)).toBe(false);
    expect(secretOk(null, SECRET)).toBe(false);
    expect(secretOk(SECRET, "")).toBe(false);
    expect(checkSecret(SECRET, { INVOICE_INGEST_SECRET: SECRET })).toBe("ok");
    expect(checkSecret("x", { INVOICE_INGEST_SECRET: SECRET })).toBe("denied");
    expect(checkSecret(SECRET, {})).toBe("not_configured");
    // a weak secret (under 24 characters) is treated as not set up, even when the caller sends exactly it
    expect(checkSecret("short-secret", { INVOICE_INGEST_SECRET: "short-secret" })).toBe("not_configured");
    expect(checkSecret("x".repeat(23), { INVOICE_INGEST_SECRET: "x".repeat(23) })).toBe("not_configured");
    expect(checkSecret("x".repeat(24), { INVOICE_INGEST_SECRET: "x".repeat(24) })).toBe("ok");
  });
  it("cleanIds keeps well formed distinct ids only", () => {
    expect(cleanIds([D1, D1, D2])).toEqual([D1, D2]);
    expect(cleanIds([D1, "nope"])).toBeNull();
    expect(cleanIds("x")).toBeNull();
    expect(cleanIds([D1, D2], 1)).toEqual([D1]);
  });
});

describe("notifyDocuments (Slack)", () => {
  it("builds one message per busy venue, posts it, and records it", async () => {
    const f = okFetch();
    const r = await notifyDocuments(current.sb, [D1, D2, D3], { webhookUrl: "https://hooks.example/abc", fetchImpl: f, now: new Date("2026-10-24T01:00:00Z"), origin: "https://precinct-costing.vercel.app" });
    expect(r.sent).toBe(true);
    expect(r.messages.map((m) => m.venueSlug)).toEqual(["drift"]); // Greedy's document did nothing: quiet
    expect(r.text).toContain("*Drift: 2 invoices processed.* 1 price updated, 1 needs approval (over 5%), 2 questions.");
    expect(r.text).toContain("Kingfish fillets, Daniel Street Fish Market: $68.90 to $74.20/kg (+7.7%)");
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://hooks.example/abc");
    expect(JSON.parse(String(init.body))).toEqual({ text: r.messages[0].text });
    expect(current.upserts).toHaveLength(1);
    expect(current.upserts[0].row).toMatchObject({ kind: "slack", venue_id: 1, document_ids: expect.arrayContaining([D1, D2]) });
  });

  it("is idempotent: a document already announced is not announced twice", async () => {
    const f = okFetch();
    const opts = { webhookUrl: "https://hooks.example/abc", fetchImpl: f, origin: "https://x.example" };
    await notifyDocuments(current.sb, [D1, D2], opts);
    const again = await notifyDocuments(current.sb, [D1, D2], opts);
    expect(again.sent).toBe(false);
    expect(again.text).toBeNull();
    expect(again.alreadyAnnounced).toBe(2);
    expect(f).toHaveBeenCalledTimes(1);
    expect(current.upserts).toHaveLength(1);
    // a new document alongside an old one only announces the new one
    current.tables.invoice_documents.push({ id: "44444444-4444-4444-8444-444444444444", venue_id: 1, supplier_id: null, supplier_name_read: "Star", doc_type: "invoice", status: "failed", invoice_number: null, invoice_date: null, page_pdf_path: null });
    const mixed = await notifyDocuments(current.sb, [D1, "44444444-4444-4444-8444-444444444444"], opts);
    expect(mixed.alreadyAnnounced).toBe(1);
    expect(mixed.text).toContain("*Drift: no invoices processed.* 1 could not be read.");
    expect(mixed.text).not.toContain("Kingfish");
  });

  it("with no webhook it returns the text, posts nothing and records nothing", async () => {
    const f = okFetch();
    const r = await notifyDocuments(current.sb, [D1, D2], { webhookUrl: null, fetchImpl: f });
    expect(r.sent).toBe(false);
    expect(r.text).toContain("Drift");
    expect(f).not.toHaveBeenCalled();
    expect(current.upserts).toHaveLength(0);
    // the same documents can still be announced once a webhook exists
    const later = await notifyDocuments(current.sb, [D1, D2], { webhookUrl: "https://hooks.example/abc", fetchImpl: f });
    expect(later.sent).toBe(true);
  });

  it("a failed post is not recorded, so the next call tries again", async () => {
    const bad = vi.fn(async () => ({ ok: false, status: 500 }) as Response);
    const r = await notifyDocuments(current.sb, [D1], { webhookUrl: "https://hooks.example/abc", fetchImpl: bad });
    expect(r.sent).toBe(false);
    expect(r.messages[0].posted).toBe(false);
    expect(current.upserts).toHaveLength(0);
    const good = okFetch();
    expect((await notifyDocuments(current.sb, [D1], { webhookUrl: "https://hooks.example/abc", fetchImpl: good })).sent).toBe(true);
  });

  it("a quiet run sends nothing at all", async () => {
    const f = okFetch();
    const r = await notifyDocuments(current.sb, [D3], { webhookUrl: "https://hooks.example/abc", fetchImpl: f });
    expect(r).toMatchObject({ sent: false, text: null, messages: [] });
    expect(f).not.toHaveBeenCalled();
  });

  it("ignores ids that are not ids", async () => {
    expect(await notifyDocuments(current.sb, ["../etc", ""], { webhookUrl: null })).toMatchObject({ sent: false, text: null });
  });

  it("postToSlack gives up quietly on a network error", async () => {
    const boom = vi.fn(async () => {
      throw new Error("down");
    });
    expect(await postToSlack("https://hooks.example/abc", "hi", boom as unknown as typeof fetch)).toBe(false);
  });
});

const req = (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) =>
  new Request(`https://app.example${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("POST and GET /api/invoices/digest", () => {
  it("rejects a missing or wrong secret, and says plainly when the server has none", async () => {
    expect((await digestRoute.POST(req("POST", "/api/invoices/digest", {}, { documentIds: [D1] }))).status).toBe(401);
    expect((await digestRoute.POST(req("POST", "/api/invoices/digest", { "x-invoice-secret": "nope" }, { documentIds: [D1] }))).status).toBe(401);
    expect((await digestRoute.GET(req("GET", `/api/invoices/digest?documentIds=${D1}`))).status).toBe(401);
    vi.stubEnv("INVOICE_INGEST_SECRET", "");
    const res = await digestRoute.POST(req("POST", "/api/invoices/digest", { "x-invoice-secret": "anything" }, { documentIds: [D1] }));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/anything/);
  });

  it("a weak server secret (under 24 characters) is a 503 on both digest routes, never a way in", async () => {
    vi.stubEnv("INVOICE_INGEST_SECRET", "weak-secret");
    for (const res of [
      await digestRoute.POST(req("POST", "/api/invoices/digest", { "x-invoice-secret": "weak-secret" }, { documentIds: [D1] })),
      await weeklyRoute.GET(req("GET", "/api/invoices/weekly", { "x-invoice-secret": "weak-secret" })),
    ]) {
      expect(res.status).toBe(503);
      expect(JSON.stringify(await res.json())).not.toContain("weak-secret");
    }
  });

  it("with the right secret and no webhook returns { sent: false, text } and records nothing", async () => {
    const res = await digestRoute.POST(req("POST", "/api/invoices/digest", { "x-invoice-secret": SECRET }, { documentIds: [D1, D2] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(false);
    expect(json.text).toContain("*Drift: 2 invoices processed.*");
    expect(current.upserts).toHaveLength(0);
  });

  it("with a webhook set it posts once and the second call is a no-op", async () => {
    vi.stubEnv("INVOICE_SLACK_WEBHOOK_URL", "https://hooks.example/abc");
    const f = okFetch();
    vi.stubGlobal("fetch", f);
    const first = await (await digestRoute.POST(req("POST", "/api/invoices/digest", { "x-invoice-secret": SECRET }, { documentIds: [D1, D2] }))).json();
    expect(first.sent).toBe(true);
    const second = await (await digestRoute.POST(req("POST", "/api/invoices/digest", { "x-invoice-secret": SECRET }, { documentIds: [D1, D2] }))).json();
    expect(second.sent).toBe(false);
    expect(second.text).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("rejects bad bodies, and the GET preview posts and records nothing", async () => {
    expect((await digestRoute.POST(req("POST", "/api/invoices/digest", { "x-invoice-secret": SECRET }, { documentIds: ["x"] }))).status).toBe(400);
    expect((await digestRoute.POST(req("POST", "/api/invoices/digest", { "x-invoice-secret": SECRET }, {}))).status).toBe(400);
    vi.stubEnv("INVOICE_SLACK_WEBHOOK_URL", "https://hooks.example/abc");
    const f = okFetch();
    vi.stubGlobal("fetch", f);
    const res = await digestRoute.GET(req("GET", `/api/invoices/digest?documentIds=${D1},${D2}`, { "x-invoice-secret": SECRET }));
    expect((await res.json()).text).toContain("Drift");
    expect(f).not.toHaveBeenCalled();
    expect(current.upserts).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});

describe("GET and POST /api/invoices/weekly", () => {
  it("needs the secret", async () => {
    expect((await weeklyRoute.GET(req("GET", "/api/invoices/weekly"))).status).toBe(401);
    expect((await weeklyRoute.GET(req("GET", "/api/invoices/weekly", { "x-invoice-secret": "bad" }))).status).toBe(401);
    expect((await weeklyRoute.POST(req("POST", "/api/invoices/weekly", {}, { questionIds: [Q1] }))).status).toBe(401);
    expect((await weeklyRoute.POST(req("POST", "/api/invoices/weekly", { "x-invoice-secret": "bad" }, { questionIds: [Q1] }))).status).toBe(401);
  });

  it("returns the email with signed PDF links for invoices that have a question, then marks them sent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T21:00:00Z"));
    const res = await weeklyRoute.GET(req("GET", "/api/invoices/weekly", { "x-invoice-secret": SECRET }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skipped).toBe(false);
    expect(json.subject).toBe("Invoice questions for the week of 26 Oct");
    expect(json.questionIds.sort()).toEqual([Q1, Q2].sort());
    expect(json.attachments).toEqual([
      { name: "Drift Daniel Street Fish Market 51329 14 Oct 2026.pdf", url: `https://files.example/sign/drift/${D1}.pdf?token=SECRET123` },
      { name: "Drift Diablo Co ENV-34730 22 Oct 2026.pdf", url: `https://files.example/sign/drift/${D2}.pdf?token=SECRET123` },
    ]);
    expect(json.text).toContain("Hi Mon and Matt,");
    expect(json.text).toContain("2 questions, 2 invoices, PDFs attached.");
    expect(json.text).not.toContain("SECRET123");
    expect(json.html).not.toContain("SECRET123");
    // the answered question (Greedy) is not asked
    expect(json.text).not.toContain("Do the totals match");
    for (const part of [json.subject, json.text, json.html]) expect(part).not.toMatch(DASHES);

    const mark = await weeklyRoute.POST(req("POST", "/api/invoices/weekly", { "x-invoice-secret": SECRET }, { questionIds: json.questionIds }));
    expect(mark.status).toBe(200);
    expect(await mark.json()).toEqual({ ok: true, marked: 2 });
    const qs = current.tables.invoice_questions;
    expect(qs.find((x) => x.id === Q1)!.emailed_at).toBe("2026-10-25T21:00:00.000Z");
    expect(qs.find((x) => x.id === Q3)!.emailed_at).toBeNull();
    expect(current.upserts).toHaveLength(1);
    expect(current.upserts[0].row).toMatchObject({ kind: "weekly_email", question_ids: json.questionIds });

    // emailed already: nothing to send
    const next = await (await weeklyRoute.GET(req("GET", "/api/invoices/weekly", { "x-invoice-secret": SECRET }))).json();
    expect(next).toEqual({ subject: "", text: "", html: "", attachments: [], questionIds: [], skipped: true });

    // still open eight days later: asked again and flagged
    vi.setSystemTime(new Date("2026-11-02T21:00:00Z"));
    const later = await (await weeklyRoute.GET(req("GET", "/api/invoices/weekly", { "x-invoice-secret": SECRET }))).json();
    expect(later.skipped).toBe(false);
    expect(later.text).toContain("Still waiting: ");
    expect(later.subject).toBe("Invoice questions for the week of 2 Nov");
  });

  it("is skipped, with no email built, when no question is open", async () => {
    current.tables.invoice_questions.forEach((x) => (x.status = "answered"));
    const json = await (await weeklyRoute.GET(req("GET", "/api/invoices/weekly", { "x-invoice-secret": SECRET }))).json();
    expect(json).toEqual({ subject: "", text: "", html: "", attachments: [], questionIds: [], skipped: true });
  });

  it("an invoice whose PDF link cannot be signed loses its attachment and the email stops naming it", async () => {
    current = fakeSb(dataset(), { [`${D1}.pdf`]: 250_000, [`${D2}.pdf`]: 180_000 }, [`drift/${D1}.pdf`]);
    const json = await (await weeklyRoute.GET(req("GET", "/api/invoices/weekly", { "x-invoice-secret": SECRET }))).json();
    expect(json.attachments.map((a: { name: string }) => a.name)).toEqual(["Drift Diablo Co ENV-34730 22 Oct 2026.pdf"]);
    expect(json.text).not.toContain("Daniel Street Fish Market 51329 14 Oct 2026.pdf");
    expect(json.text).toContain("No PDF attached, so open it in the app.");
  });

  it("POST rejects bad bodies", async () => {
    for (const body of [{}, { questionIds: [] }, { questionIds: ["x"] }, { questionIds: "x" }]) {
      expect((await weeklyRoute.POST(req("POST", "/api/invoices/weekly", { "x-invoice-secret": SECRET }, body))).status).toBe(400);
    }
  });
});

describe("what the routes leave out", () => {
  it("names the two paths the scanner script calls without a login (for the middleware list)", () => {
    expect(INVOICE_DIGEST_PATHS).toEqual(["/api/invoices/digest", "/api/invoices/weekly"]);
  });
  it("the new routes and data layer have no raw .insert( and never mention an AI product in text a person reads", () => {
    for (const f of ["lib/invoice-digest.ts", "lib/invoice-digest-data.ts", "app/api/invoices/digest/route.ts", "app/api/invoices/weekly/route.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src.split("\n").filter((l) => /\.insert\(/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l))).toEqual([]);
    }
    const strings = readFileSync("lib/invoice-digest.ts", "utf8")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && !/replace\(|plainText/.test(l))
      .join("\n");
    expect(strings).not.toMatch(/claude|anthropic/i);
  });
});
