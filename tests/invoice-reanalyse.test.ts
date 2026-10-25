import { describe, expect, it, vi } from "vitest";
import { ENGINE_VERSION, analyseInvoice } from "../lib/invoice-engine";
import { runStep, type PipelineDeps } from "../lib/invoice-pipeline";
import { REANALYSE_CANDIDATES, needsReanalysis, reanalyseNext, type ReanalyseDeps } from "../lib/invoice-reanalyse";
import { saveAnalysis } from "../lib/invoice-store";
import type { AnalyseInvoice } from "../lib/invoice-interfaces";
import { createFakeSupabase } from "./helpers/fake-supabase";
import { aLine, analysis, extracted } from "./helpers/invoice-analysis";
import { document, IDS, SUPPLIER } from "./helpers/invoice-fixtures";
import { baseCtx } from "./fixtures/invoice-fixtures";

const base = { fileId: "file-1", venueId: 1, pagePdfPath: "doc/1.pdf", readModel: "claude-sonnet-5-5" };

// ---------------------------------------------------------------- A saveAnalysis keeps the reading and the version
describe("saveAnalysis stores the extraction and stamps the rules version", () => {
  it("a new document keeps what the model read and ENGINE_VERSION", async () => {
    const f = createFakeSupabase({ invoice_suppliers: [SUPPLIER] });
    const ex = extracted();
    const r = await saveAnalysis(f.sb, { ...base, extracted: ex, analysis: analysis() });
    const row = f.db.invoice_documents.find((d) => d.id === r.documentId)!;
    expect(row.extracted).toEqual(ex);
    expect(row.analysis_version).toBe(ENGINE_VERSION);
    expect(ENGINE_VERSION).toBeGreaterThanOrEqual(2);
  });

  it("a re-analysis writes the new version, and the reading when it has one", async () => {
    const f = createFakeSupabase({ invoice_suppliers: [SUPPLIER], invoice_documents: [document({ status: "needs_review", analysis_version: 1 })] });
    const ex = extracted({ invoice_number: "51329" });
    await saveAnalysis(f.sb, { ...base, documentId: IDS.doc, extracted: ex, analysis: analysis() });
    expect(f.db.invoice_documents[0]).toMatchObject({ extracted: ex, analysis_version: ENGINE_VERSION });
  });

  it("keepExtracted leaves the stored reading alone (the caller rebuilt it from stored lines) but still stamps the version", async () => {
    const original = extracted({ invoice_number: "ORIGINAL" });
    const f = createFakeSupabase({ invoice_suppliers: [SUPPLIER], invoice_documents: [document({ extracted: original, analysis_version: 0 })] });
    await saveAnalysis(f.sb, { ...base, documentId: IDS.doc, extracted: extracted({ invoice_number: "REBUILT" }), analysis: analysis(), keepExtracted: true } as Parameters<typeof saveAnalysis>[1]);
    expect(f.db.invoice_documents[0].extracted).toEqual(original);
    expect(f.db.invoice_documents[0].analysis_version).toBe(ENGINE_VERSION);
  });

  it("still works on a database without the two columns (a new document and a re-analysis)", async () => {
    const f = createFakeSupabase({ invoice_suppliers: [SUPPLIER] });
    f.failNext("invoice_documents", "upsert", 'Could not find the \'extracted\' column of \'invoice_documents\' in the schema cache');
    const r = await saveAnalysis(f.sb, { ...base, extracted: extracted(), analysis: analysis() });
    const row = f.db.invoice_documents.find((d) => d.id === r.documentId)!;
    expect(row).toBeTruthy();
    expect(row).not.toHaveProperty("extracted");
    expect(row).not.toHaveProperty("analysis_version");

    f.failNext("invoice_documents", "update", 'column "analysis_version" of relation "invoice_documents" does not exist');
    await saveAnalysis(f.sb, { ...base, documentId: r.documentId, extracted: extracted(), analysis: analysis() });
    expect(f.db.invoice_documents.find((d) => d.id === r.documentId)).not.toHaveProperty("extracted");
  });

  it("any other database error is still an error", async () => {
    const f = createFakeSupabase({ invoice_suppliers: [SUPPLIER] });
    f.failNext("invoice_documents", "upsert", "connection reset");
    await expect(saveAnalysis(f.sb, { ...base, extracted: extracted(), analysis: analysis() })).rejects.toThrow(/connection reset/);
  });
});

// ---------------------------------------------------------------- B the free re-check
describe("needsReanalysis", () => {
  const doc = (over: Record<string, unknown> = {}) => ({ status: "needs_review" as const, extracted: { lines: [] }, analysis_version: 1, ...over });
  it("is true for a stored reading checked by an older version", () => {
    expect(needsReanalysis(doc(), 2)).toBe(true);
    expect(needsReanalysis(doc({ analysis_version: null }), 2)).toBe(true);
    expect(needsReanalysis(doc({ status: "nothing_to_apply" }), 2)).toBe(true);
  });
  it("is false when the version is current, there is no reading, or the status says leave it", () => {
    expect(needsReanalysis(doc({ analysis_version: 2 }), 2)).toBe(false);
    expect(needsReanalysis(doc({ analysis_version: 3 }), 2)).toBe(false);
    expect(needsReanalysis(doc({ extracted: null }), 2)).toBe(false);
    expect(needsReanalysis(doc({ extracted: undefined }), 2)).toBe(false);
    for (const status of ["applied", "partly_applied", "ignored", "duplicate"]) expect(needsReanalysis(doc({ status }), 2)).toBe(false);
  });
});

describe("reanalyseNext", () => {
  const ex = extracted();
  const mkDoc = (id: string, over: Record<string, unknown> = {}, created = "2026-10-20T00:00:00Z") =>
    document({ id, invoice_number: id, status: "needs_review", extracted: { ...ex, invoice_number: id }, analysis_version: 1, created_at: created, ...over });

  function world(docs: Record<string, unknown>[]) {
    const f = createFakeSupabase({
      invoice_suppliers: [SUPPLIER],
      invoice_files: [{ id: IDS.file, venue_id: 1 }],
      invoice_documents: docs,
    });
    const analysed: string[] = [];
    const analyse: AnalyseInvoice = (e, c) => {
      analysed.push(e.invoice_number ?? "?");
      return analysis();
    };
    const deps = (over: Partial<ReanalyseDeps> = {}): ReanalyseDeps => ({
      analyse,
      loadContext: async () => baseCtx(),
      save: saveAnalysis,
      today: () => "2026-10-25",
      firstReadModel: "claude-sonnet-5-5",
      ...over,
    });
    return { f, analysed, deps };
  }

  it("re-checks ONE document per call, oldest first, with no model call, and stamps the version", async () => {
    const w = world([mkDoc("D2", {}, "2026-10-22T00:00:00Z"), mkDoc("D1", {}, "2026-10-21T00:00:00Z"), mkDoc("D3", {}, "2026-10-23T00:00:00Z")]);
    expect(await reanalyseNext(w.f.sb, w.deps())).toBe(true);
    expect(w.f.db.invoice_documents.map((d) => [d.id, d.analysis_version])).toEqual([["D2", 1], ["D1", ENGINE_VERSION], ["D3", 1]]);
    expect(await reanalyseNext(w.f.sb, w.deps())).toBe(true);
    expect(await reanalyseNext(w.f.sb, w.deps())).toBe(true);
    expect(await reanalyseNext(w.f.sb, w.deps())).toBe(false); // nothing left
    expect(w.analysed).toHaveLength(3);
    expect(w.f.db.invoice_documents.every((d) => d.analysis_version === ENGINE_VERSION)).toBe(true);
  });

  it("picks only older versions", async () => {
    const w = world([mkDoc("CURRENT", { analysis_version: ENGINE_VERSION }), mkDoc("OLD", { analysis_version: 1 })]);
    expect(await reanalyseNext(w.f.sb, w.deps())).toBe(true);
    expect(w.analysed).toEqual(["OLD"]);
    expect(await reanalyseNext(w.f.sb, w.deps())).toBe(false);
  });

  it("never touches an applied, partly applied, ignored or duplicate document, or one with no stored reading", async () => {
    const w = world([
      mkDoc("A", { status: "applied" }),
      mkDoc("P", { status: "partly_applied" }),
      mkDoc("I", { status: "ignored" }),
      mkDoc("DUP", { status: "duplicate" }),
      mkDoc("NOREAD", { extracted: null }),
    ]);
    expect(await reanalyseNext(w.f.sb, w.deps())).toBe(false);
    expect(w.analysed).toEqual([]);
    expect(w.f.db.invoice_documents.map((d) => d.analysis_version)).toEqual([1, 1, 1, 1, 1]);
    expect(w.f.log.some((l) => l.table === "invoice_documents" && (l.op === "update" || l.op === "upsert"))).toBe(false);
  });

  it("a failure leaves the version alone, is logged short, and the next candidate is tried (never the same one twice)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const w = world([mkDoc("BAD", {}, "2026-10-20T00:00:00Z"), mkDoc("GOOD", {}, "2026-10-21T00:00:00Z")]);
    const analyse: AnalyseInvoice = (e) => {
      w.analysed.push(e.invoice_number ?? "?");
      if (w.analysed.at(-1) === "BAD") throw new Error("engine fell over sk-ant-abcdefghijklmnop");
      return analysis();
    };
    expect(await reanalyseNext(w.f.sb, w.deps({ analyse }))).toBe(true);
    expect(w.analysed).toEqual(["BAD", "GOOD"]);
    const byId = Object.fromEntries(w.f.db.invoice_documents.map((d) => [d.id, d.analysis_version]));
    expect(byId).toEqual({ BAD: 1, GOOD: ENGINE_VERSION });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain("sk-ant-abcdefghijklmnop");
    warn.mockRestore();
  });

  it("tries at most REANALYSE_CANDIDATES documents in one call, and answers false when all of them fail", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const docs = Array.from({ length: 5 }, (_, i) => mkDoc(`F${i}`, {}, `2026-10-2${i}T00:00:00Z`));
    const w = world(docs);
    const analyse: AnalyseInvoice = (e) => {
      w.analysed.push(e.invoice_number ?? "?");
      throw new Error("nope");
    };
    expect(await reanalyseNext(w.f.sb, w.deps({ analyse }))).toBe(false);
    expect(w.analysed).toHaveLength(REANALYSE_CANDIDATES);
    expect(w.f.db.invoice_documents.every((d) => d.analysis_version === 1)).toBe(true);
    warn.mockRestore();
  });

  it("keeps the stored reading and the document's answered questions, and never re-reads the file", async () => {
    const original = extracted({ invoice_number: "KEEP" });
    const w = world([mkDoc("D1", { extracted: original })]);
    await reanalyseNext(w.f.sb, w.deps());
    expect(w.f.db.invoice_documents[0].extracted).toEqual(original);
    expect(w.f.log.filter((l) => l.table === "ai_usage_log")).toEqual([]);
  });

  it("a document read by a different model than the first reading was a hinted second reading and is analysed that way", async () => {
    let seen: Record<string, unknown> = {};
    const w = world([mkDoc("D1", { read_model: "claude-opus-5-5" })]);
    const analyse: AnalyseInvoice = (e, c) => {
      seen = c as unknown as Record<string, unknown>;
      return analysis();
    };
    await reanalyseNext(w.f.sb, w.deps({ analyse }));
    expect(seen.hintedReread).toBe(true);
    const w2 = world([mkDoc("D2", { read_model: "claude-sonnet-5-5" })]);
    await reanalyseNext(w2.f.sb, w2.deps({ analyse }));
    expect(seen.hintedReread).toBe(false);
  });

  it("runs the real engine end to end on a stored reading that the old rules failed", async () => {
    const stored = {
      ...extracted({ subtotal_ex: 13.68, gst_total: 0, total_inc: 13.68 }),
      lines: [{ line_no: 1, page: 1, item_code: null, description: "Pasta", qty: 4, unit: null, unit_price: 3.42, discount_pct: 10, line_total: 13.68, basis: "ex", gst: "free", class_hint: "product" }],
    };
    const w = world([mkDoc("D1", { extracted: stored, reconciled: false })]);
    expect(await reanalyseNext(w.f.sb, w.deps({ analyse: analyseInvoice, loadContext: async () => baseCtx() }))).toBe(true);
    expect(w.f.db.invoice_documents[0]).toMatchObject({ reconciled: true, analysis_version: ENGINE_VERSION });
  });
});

// ---------------------------------------------------------------- the pipeline hook
describe("the quiet step", () => {
  const deps = (over: Partial<PipelineDeps>): PipelineDeps =>
    ({ repo: { claimFile: async () => null }, clock: { now: () => Date.parse("2026-10-25T00:00:00Z"), today: () => "2026-10-25" }, ...over }) as unknown as PipelineDeps;

  it("when nothing is waiting and no suggestion work was done, it re-checks one document and says it is not idle", async () => {
    const r = await runStep(deps({ suggestNext: async () => false, reanalyseNext: async () => true }));
    expect(r).toMatchObject({ idle: false, stage: "read", documents: [] });
    expect(r.message).toMatch(/Re-checked/);
  });

  it("suggestion work comes first, and the re-check is not run in the same step", async () => {
    const re = vi.fn(async () => true);
    const r = await runStep(deps({ suggestNext: async () => true, reanalyseNext: re }));
    expect(r.message).toMatch(/suggestions/);
    expect(re).not.toHaveBeenCalled();
  });

  it("answers idle when there is nothing to re-check, and when the re-check throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await runStep(deps({ reanalyseNext: async () => false }))).idle).toBe(true);
    expect((await runStep(deps({ reanalyseNext: async () => { throw new Error("db down"); } }))).idle).toBe(true);
    expect((await runStep(deps({}))).idle).toBe(true);
    warn.mockRestore();
  });

  it("a claimed file is read first: the re-check is only for a quiet step", async () => {
    const re = vi.fn(async () => true);
    const claim = vi.fn(async () => null);
    await runStep(deps({ repo: { claimFile: claim } as unknown as PipelineDeps["repo"], reanalyseNext: re }));
    expect(claim).toHaveBeenCalledTimes(1);
  });
});

void aLine;
