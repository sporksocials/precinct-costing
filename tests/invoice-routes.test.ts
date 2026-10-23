import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { INVOICE_SECRET_HEADER, checkInvoiceSecret, isInvoiceIngestPath, safeEqual } from "@/lib/invoice-auth";
import { handleProcess, handleUploadUrl } from "@/lib/invoice-handlers";
import { AWAITING_UPLOAD, type PipelineDeps } from "@/lib/invoice-pipeline";
import type { IngestFile, IngestStore } from "@/lib/invoice-repo";

const SECRET = "correct-horse-battery-staple-123";
const ENV = { INVOICE_INGEST_SECRET: SECRET };
const SHA = "a".repeat(64);
const FILE_ID = "11111111-2222-3333-4444-555555555555";

function req(body: unknown, secret: string | null = SECRET, raw = false): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret != null) headers[INVOICE_SECRET_HEADER] = secret;
  return new Request("http://localhost/api/invoices/x", { method: "POST", headers, body: raw ? (body as string) : JSON.stringify(body) });
}

class MemStore implements IngestStore {
  files: (IngestFile & { venue_id: number; sha256: string })[] = [];
  objects = new Set<string>();
  failCreate = false;
  async venueIdForSlug(slug: string) {
    return ({ drift: 1, chiobu: 2 } as Record<string, number>)[slug] ?? null;
  }
  async findFile(venueId: number, sha: string) {
    const f = this.files.find((x) => x.venue_id === venueId && x.sha256 === sha);
    return f ? { id: f.id, status: f.status, attempts: f.attempts, storage_path: f.storage_path } : null;
  }
  async createFile(row: { venue_id: number; storage_path: string; sha256: string; attempts: number }) {
    if (this.failCreate) throw new Error("unique violation");
    const f = { id: FILE_ID, status: "received" as const, attempts: row.attempts, storage_path: row.storage_path, venue_id: row.venue_id, sha256: row.sha256 };
    this.files.push(f);
    return f;
  }
  async getFile(id: string) {
    return this.files.find((f) => f.id === id) ?? null;
  }
  async setAttempts(id: string, attempts: number) {
    this.files.find((f) => f.id === id)!.attempts = attempts;
  }
  async signedUploadUrl(path: string) {
    return { uploadUrl: `https://storage.example/upload/${path}?token=t1`, token: "t1" };
  }
  async objectExists(path: string) {
    return this.objects.has(path);
  }
}

let store: MemStore;
const up = (body: unknown, secret: string | null = SECRET) => handleUploadUrl(req(body, secret), { getStore: () => store, env: ENV, today: () => "2026-10-24" });
const good = { venue: "drift", fileName: "Scan 24 Oct.pdf", sha256: SHA };

beforeEach(() => {
  store = new MemStore();
});

describe("secret check", () => {
  it("accepts only the exact secret", () => {
    expect(checkInvoiceSecret(SECRET, ENV)).toBe("ok");
    expect(checkInvoiceSecret(`  ${SECRET}  `, ENV)).toBe("ok");
    expect(checkInvoiceSecret("wrong", ENV)).toBe("denied");
    expect(checkInvoiceSecret(SECRET + "x", ENV)).toBe("denied");
    expect(checkInvoiceSecret(SECRET.slice(0, -1), ENV)).toBe("denied");
    expect(checkInvoiceSecret("", ENV)).toBe("denied");
    expect(checkInvoiceSecret(null, ENV)).toBe("denied");
    expect(checkInvoiceSecret(SECRET, {})).toBe("not_configured");
    expect(checkInvoiceSecret(SECRET, { INVOICE_INGEST_SECRET: "  " })).toBe("not_configured");
  });
  it("compares without caring where the first difference is", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("é", "e")).toBe(false);
  });
  it("opens the middleware for exactly the two scanner routes", () => {
    expect(isInvoiceIngestPath("/api/invoices/upload-url")).toBe(true);
    expect(isInvoiceIngestPath("/api/invoices/process")).toBe(true);
    expect(isInvoiceIngestPath("/api/invoices/process/")).toBe(true);
    expect(isInvoiceIngestPath("/api/invoices/answer")).toBe(false);
    expect(isInvoiceIngestPath("/api/invoices/process/extra")).toBe(false);
    expect(isInvoiceIngestPath("/api/invoices")).toBe(false);
    expect(isInvoiceIngestPath("/invoices")).toBe(false);
  });
  it("the middleware lets those routes through before it asks for a login", () => {
    const src = readFileSync("middleware.ts", "utf8");
    expect(src).toContain('from "./lib/invoice-auth"');
    expect(src.indexOf("isInvoiceIngestPath(request.nextUrl.pathname)")).toBeGreaterThan(0);
    expect(src.indexOf("isInvoiceIngestPath(request.nextUrl.pathname)")).toBeLessThan(src.indexOf("supabase.auth.getUser()"));
  });
});

describe("POST /api/invoices/upload-url", () => {
  it("401 for a missing or wrong secret, and nothing is touched", async () => {
    const getStore = vi.fn(() => store);
    for (const secret of [null, "nope", SECRET + "1"]) {
      const res = await handleUploadUrl(req(good, secret), { getStore, env: ENV });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Not allowed." });
    }
    expect(getStore).not.toHaveBeenCalled();
  });
  it("503 with a plain message when the server has no secret set (never lets anyone in)", async () => {
    const res = await handleUploadUrl(req(good, "anything"), { getStore: () => store, env: {} });
    expect(res.status).toBe(503);
  });

  it.each<[string, unknown, boolean?]>([
    ["not JSON", "oops", true],
    ["a list", [1]],
    ["no venue", { ...good, venue: undefined }],
    ["a venue with a slash", { ...good, venue: "../drift" }],
    ["a short hash", { ...good, sha256: "abc" }],
    ["a non-hex hash", { ...good, sha256: "z".repeat(64) }],
    ["no file name", { ...good, fileName: "" }],
    ["a huge file name", { ...good, fileName: "x".repeat(300) }],
    ["a drive id that is not text", { ...good, driveFileId: 5 }],
    ["a page count of zero", { ...good, pageCountHint: 0 }],
    ["a page count with decimals", { ...good, pageCountHint: 2.5 }],
    ["uploaded with a bad id", { fileId: "nope", uploaded: true }],
  ])("400 for %s", async (_n, body, raw) => {
    const res = await handleUploadUrl(req(body, SECRET, raw === true), { getStore: () => store, env: ENV, today: () => "2026-10-24" });
    expect(res.status).toBe(400);
  });

  it("400 for a venue the app does not know", async () => {
    expect((await up({ ...good, venue: "nowhere" })).status).toBe(400);
  });

  it("creates the file row marked awaiting upload and returns a signed upload link for incoming/<venue>/<date>/<sha>.pdf", async () => {
    const res = await up({ ...good, driveFileId: "drv1", pageCountHint: 4 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ fileId: FILE_ID, path: `incoming/drift/2026-10-24/${SHA}.pdf`, uploadUrl: expect.stringContaining(`incoming/drift/2026-10-24/${SHA}.pdf`), token: "t1" });
    expect(store.files[0]).toMatchObject({ venue_id: 1, attempts: AWAITING_UPLOAD });
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("asking again before the PDF arrived gives a fresh link, not 'duplicate'", async () => {
    await up(good);
    const again = await (await up(good)).json();
    expect(again.duplicate).toBeUndefined();
    expect(again.uploadUrl).toBeTruthy();
    expect(store.files).toHaveLength(1);
  });

  it("'uploaded' is refused until the PDF is in the bucket, then releases the file to the reader", async () => {
    await up(good);
    const early = await up({ fileId: FILE_ID, uploaded: true });
    expect(early.status).toBe(409);
    expect(store.files[0].attempts).toBe(AWAITING_UPLOAD);
    store.objects.add(`incoming/drift/2026-10-24/${SHA}.pdf`);
    const ok = await up({ fileId: FILE_ID, uploaded: true });
    expect(await ok.json()).toEqual({ fileId: FILE_ID, ready: true });
    expect(store.files[0].attempts).toBe(0);
    // saying it twice changes nothing
    expect(await (await up({ fileId: FILE_ID, uploaded: true })).json()).toEqual({ fileId: FILE_ID, ready: true });
  });

  it("a second scan of the same file for the same venue is a duplicate; another venue is not", async () => {
    await up(good);
    store.objects.add(`incoming/drift/2026-10-24/${SHA}.pdf`);
    await up({ fileId: FILE_ID, uploaded: true });
    const dup = await up(good);
    expect(await dup.json()).toEqual({ fileId: FILE_ID, duplicate: true });
    expect(store.files).toHaveLength(1);
    const other = await (await up({ ...good, venue: "chiobu" })).json();
    expect(other.duplicate).toBeUndefined();
    expect(store.files).toHaveLength(2);
  });

  it("two uploads at the very same moment: the loser uses the winner's row", async () => {
    await up(good); // the winner's row exists
    store.failCreate = true;
    const orig = store.findFile.bind(store);
    let first = true;
    store.findFile = async (v, s) => (first ? ((first = false), null) : orig(v, s)); // the loser's first look finds nothing
    const res = await (await up(good)).json();
    expect(res.fileId).toBe(FILE_ID);
    expect(res.uploadUrl).toBeTruthy();
  });

  it("404 for an unknown file id on 'uploaded'; 500 with a neutral message when the store breaks", async () => {
    expect((await up({ fileId: "99999999-2222-3333-4444-555555555555", uploaded: true })).status).toBe(404);
    store.venueIdForSlug = async () => {
      throw new Error("connection string postgres://user:pw@host/db");
    };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await up(good);
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/postgres|pw@/);
    err.mockRestore();
  });
});

describe("POST /api/invoices/process", () => {
  const idleDeps = (): PipelineDeps =>
    ({
      sb: {},
      repo: { claimFile: async () => null },
      clock: { now: () => 1_000, today: () => "2026-10-24" },
    }) as unknown as PipelineDeps;

  it("401 without the secret and never even builds the dependencies", async () => {
    const getDeps = vi.fn(idleDeps);
    for (const secret of [null, "wrong"]) {
      const res = await handleProcess(req({}, secret), { getDeps, env: ENV });
      expect(res.status).toBe(401);
    }
    expect(getDeps).not.toHaveBeenCalled();
  });

  it("with the right secret it runs one step and returns its result", async () => {
    const res = await handleProcess(req({}), { getDeps: idleDeps, env: ENV });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ idle: true, fileId: null, stage: "idle", documents: [], message: "Nothing is waiting to be read." });
  });

  it("503 in plain words when the reader is not wired up, without naming variables or values", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleProcess(req({}), { getDeps: () => Promise.reject(new Error("SUPABASE_SERVICE_ROLE_KEY is not set.")), env: ENV });
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("SERVICE_ROLE");
    err.mockRestore();
  });

  it("500 with a neutral message when the step itself throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = { ...idleDeps(), repo: { claimFile: async () => { throw new Error("secret detail sk-ant-xyz"); } } } as unknown as PipelineDeps;
    const res = await handleProcess(req({}), { getDeps: () => boom, env: ENV });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("sk-ant");
    err.mockRestore();
  });
});

describe("route files", () => {
  it("are node runtime, never cached, 60 seconds, and only export POST plus config", () => {
    for (const f of ["app/api/invoices/upload-url/route.ts", "app/api/invoices/process/route.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src).toContain('export const runtime = "nodejs"');
      expect(src).toContain('export const dynamic = "force-dynamic"');
      expect(src).toContain("export const maxDuration = 60");
      expect(src).toContain("export async function POST");
      expect(src).not.toMatch(/export async function (GET|PUT|DELETE|PATCH)/);
    }
  });
  it("the service-role client is imported by no component or page", () => {
    // a quick guard: only lib/ and app/api/ may mention it
    const out = execSync("grep -rl 'supabase/service' components app --include=*.ts --include=*.tsx || true").toString().trim().split("\n").filter(Boolean);
    expect(out.every((f) => f.startsWith("app/api/"))).toBe(true);
  });
});
