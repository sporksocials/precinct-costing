import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { countPages } from "@/lib/invoice-pdf";
import {
  AWAITING_UPLOAD,
  INVOICE_BUCKET,
  MAX_ATTEMPTS,
  STALLED_AFTER_MS,
  buildDownloadName,
  buildPdfPath,
  processStep,
  resolveModels,
  runStep,
  safeError,
  type DocShell,
  type PipelineDeps,
  type PipelineRepo,
  type ShellInput,
} from "@/lib/invoice-pipeline";
import { AiError, type ClaudeCallArgs, type ClaudeCallResult } from "@/lib/invoice-ai";
import type { ExtractedInvoice, InvoiceAnalysis, InvoiceFileRow } from "@/lib/invoice-types";
import { analyseInvoice } from "@/lib/invoice-engine";
import { baseCtx, danielStreet51329Fixed } from "./fixtures/invoice-fixtures";

// ---------------------------------------------------------------- fixtures
const NOW = Date.parse("2026-10-24T03:00:00Z");
type FileRec = InvoiceFileRow & { updated_at: string };

async function makePdf(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([200, 200]);
  return doc.save();
}

const line = (n: number, over: Record<string, unknown> = {}) => ({ line_no: n, page: 1, item_code: String(15000 + n), description: `Item ${n}`, qty: 1, unit: "KG", unit_price: 10, line_total: 10, basis: "ex", gst: "free", class_hint: "product", ...over });
const EXTRACTS: Record<string, Record<string, unknown>> = {
  "51329": { doc_type: "invoice", supplier_name: "Daniel Street Fish Market", supplier_abn: "61151388094", invoice_number: "51329", invoice_date: "2026-10-14", due_date: null, bill_to: "DRIFT BAR AND DINING", ship_to: null, pages: [1], subtotal_ex: 215.91, gst_total: 0.59, total_inc: 216.5, lines: [line(1)], notes: [] },
  "9764204": { doc_type: "invoice", supplier_name: "Daniel Street Fish Market", supplier_abn: "61151388094", invoice_number: "9764204", invoice_date: "2026-10-17", due_date: null, bill_to: "DRIFT BAR AND DINING", ship_to: null, pages: [1], subtotal_ex: 50, gst_total: 0, total_inc: 50, lines: [line(1)], notes: [] },
  "ENV-34730": { doc_type: "invoice", supplier_name: "CD Australia Pty Ltd trading as Diablo Co", supplier_abn: "11222333444", invoice_number: "ENV-34730", invoice_date: "2026-10-22", due_date: null, bill_to: "DRIFT BAR AND DINING", ship_to: null, pages: [1], subtotal_ex: 296, gst_total: 29.6, total_inc: 325.6, lines: [line(1, { unit: "EA" })], notes: [] },
};

const sortedEntry = (page: number, over: Record<string, unknown> = {}) => ({ page, doc_type: "invoice", supplier_name: null, invoice_number: null, page_of: null, continues_previous: false, ...over });
/** Daniel p1, Daniel p2, blank p3, Diablo p4 */
const FOUR_PAGES = [
  sortedEntry(1, { supplier_name: "Daniel Street Fish Market", invoice_number: "51329" }),
  sortedEntry(2, { supplier_name: "Daniel Street Fish Market", invoice_number: "9764204" }),
  sortedEntry(3, { doc_type: "blank" }),
  sortedEntry(4, { supplier_name: "CD Australia Pty Ltd trading as Diablo Co", invoice_number: "ENV-34730" }),
];

// ---------------------------------------------------------------- the world: in-memory repo, storage, model, engine
class World {
  files: FileRec[] = [];
  docs: (DocShell & { file_id: string })[] = [];
  uploads = new Map<string, Uint8Array>();
  claudeCalls: ClaudeCallArgs[] = [];
  saves: Parameters<PipelineDeps["save"]>[1][] = [];
  autoApplied: string[] = [];
  notified: string[] = [];
  notifiedVenues: number[] = [];
  now = NOW;
  callMs = 0;
  mode: "learning" | "auto" = "learning";
  /** replies */
  sortReply: (pages: number, call: number) => unknown = () => ({ pages: FOUR_PAGES });
  readReply: (invoiceNumber: string, model: string, attempt: number) => unknown = (n) => EXTRACTS[n];
  claudeError: (() => Error | null) | null = null;
  failSaveOn: number | null = null;
  private saveCount = 0;
  private reads = new Map<string, number>();
  pdfs = new Map<string, Uint8Array>();

  addFile(over: Partial<FileRec> = {}): FileRec {
    const f: FileRec = { id: "f" + (this.files.length + 1), venue_id: 1, source_name: "scan.pdf", drive_file_id: null, storage_path: "incoming/drift/2026-10-24/abc.pdf", sha256: "abc" + this.files.length, page_count: null, status: "received", error: null, attempts: 0, received_at: "2026-10-24T01:00:00.000Z", processed_at: null, updated_at: new Date(NOW - 60_000).toISOString(), ...over };
    this.files.push(f);
    return f;
  }

  repo: PipelineRepo = {
    claimFile: async ({ stalledBefore, nowIso }) => {
      const c = this.files
        .filter((f) => f.attempts >= 0 && f.attempts <= MAX_ATTEMPTS && (f.status === "received" || ((f.status === "sorting" || f.status === "reading") && f.updated_at < stalledBefore)))
        .sort((a, b) => a.received_at.localeCompare(b.received_at))[0];
      if (!c) return null;
      const seenStatus = c.status;
      const seenStamp = c.updated_at;
      await Promise.resolve(); // let a second caller interleave: the compare and set below must still pick one winner
      const still = this.files.find((f) => f.id === c.id)!;
      if (still.status !== seenStatus || still.updated_at !== seenStamp) return null;
      still.status = "sorting";
      still.updated_at = nowIso;
      return { ...still };
    },
    updateFile: async (id, patch) => {
      Object.assign(this.files.find((f) => f.id === id)!, patch, { updated_at: new Date(this.now).toISOString() });
    },
    venueSlug: async (id) => (id === 1 ? "drift" : "chiobu"),
    listDocuments: async (fileId) => this.docs.filter((d) => d.file_id === fileId).map((d) => ({ ...d })).sort((a, b) => a.pages[0] - b.pages[0]),
    createDocuments: async (fileId, _v, inputs: ShellInput[]) => {
      for (const i of inputs) this.docs.push({ id: "d" + (this.docs.length + 1), file_id: fileId, ...i, invoice_date: null, page_pdf_path: null, read_model: null, status: "needs_review" });
      return this.repo.listDocuments(fileId);
    },
    updateDocument: async (id, patch) => {
      Object.assign(this.docs.find((d) => d.id === id)!, patch);
    },
  };

  claude = async (a: ClaudeCallArgs): Promise<ClaudeCallResult> => {
    this.claudeCalls.push(a);
    this.now += this.callMs;
    const err = this.claudeError?.();
    if (err) throw err;
    const usage = { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0 };
    let reply: unknown;
    if (a.feature === "invoice_sort") {
      const pages = Number(/has (\d+) page/.exec(a.text)![1]);
      reply = this.sortReply(pages, this.claudeCalls.filter((c) => c.feature === "invoice_sort").length);
    } else {
      const doc = this.docs.find((d) => d.id === a.documentId)!;
      const key = doc.id + a.model;
      const attempt = (this.reads.get(key) ?? 0) + 1;
      this.reads.set(key, attempt);
      reply = this.readReply(doc.invoice_number!, a.model, attempt);
    }
    return { text: typeof reply === "string" ? reply : JSON.stringify(reply), usage, costUsd: 0.001, model: a.model, stopReason: "end_turn" };
  };

  analyseCtxs: unknown[] = [];
  analyse = (ex: ExtractedInvoice, ctx?: unknown): InvoiceAnalysis => {
    this.analyseCtxs.push(ctx);
    const bad = ex.notes.includes("BAD");
    const notes = [
      { check: "line_math" as const, ok: true, message: "Every line adds up." },
      { check: "subtotal" as const, ok: true, message: "Subtotal matches." },
      { check: "total" as const, ok: !bad, message: "Line 2 does not multiply out." },
    ];
    return { supplier_id: null, new_supplier: null, venue_check: "ok", price_basis: "ex", reconciled: !bad, recon_notes: bad ? notes : notes.map((n) => ({ ...n, ok: true })), fee_pool_ex: 0, lines: [], questions: [], duplicate_of: null, mode: this.mode, status: "needs_review", summary: { products: 1, matched: 0, same: 0, to_apply: 0, need_approval: 0, unmatched: 1 } };
  };

  deps(over: Partial<PipelineDeps> = {}): PipelineDeps {
    return {
      sb: {} as SupabaseClient,
      repo: this.repo,
      storage: {
        download: async (_b, path) => {
          const b = this.pdfs.get(path);
          if (!b) throw new Error("not found");
          return b;
        },
        upload: async (bucket, path, bytes) => {
          expect(bucket).toBe(INVOICE_BUCKET);
          this.uploads.set(path, bytes);
        },
        signedUrl: async (_b, path, seconds) => `https://signed.example/${path}?ttl=${seconds}`,
      },
      claude: this.claude,
      analyse: this.analyse,
      loadContext: async () => ({ marker: "ctx" }) as never,
      save: async (_sb, args) => {
        this.saves.push(args);
        if (this.failSaveOn != null && ++this.saveCount === this.failSaveOn) throw new Error("database went away");
        const d = this.docs.find((x) => x.id === args.documentId)!;
        d.read_model = args.readModel;
        d.page_pdf_path = args.pagePdfPath;
        return { documentId: d.id, status: "needs_review", lineIds: [] };
      },
      autoApply: async (_sb, a) => {
        this.autoApplied.push(a.documentId);
        return [];
      },
      notify: async (e) => {
        this.notified.push(e.documentId);
        this.notifiedVenues.push(e.venueId);
      },
      clock: { now: () => this.now, today: () => "2026-10-24" },
      models: { sort: "claude-haiku-5-5", read: "claude-sonnet-5-5" },
      ...over,
    };
  }
}

let w: World;
beforeEach(async () => {
  w = new World();
  w.pdfs.set("incoming/drift/2026-10-24/abc.pdf", await makePdf(4));
});

// ---------------------------------------------------------------- end to end
describe("processStep end to end", () => {
  it("sorts a 4 page file into three documents, reads each, files the split PDFs and finishes the file", async () => {
    const file = w.addFile();
    const result = await processStep(w.deps());
    expect(result).toMatchObject({ idle: false, fileId: file.id, stage: "read" });
    expect(result.documents.map((d) => d.invoiceNumber)).toEqual(["51329", "9764204", "ENV-34730"]);
    expect(result.documents[0]).toMatchObject({
      supplier: "Daniel Street Fish Market",
      invoiceDate: "2026-10-14",
      venueSlug: "drift",
      fileName: "2026-10-14 Daniel Street Fish Market 51329.pdf",
      status: "needs_review",
    });
    expect(result.documents[0].fileName).not.toMatch(/[\\/]/);
    expect(result.documents[0].downloadUrl).toBe("https://signed.example/drift/2026-10/2026-10-14_daniel-street-fish-market_51329.pdf?ttl=600");
    expect(result.documents[2].fileName).toBe("2026-10-22 CD Australia Pty Ltd trading as Diablo Co ENV-34730.pdf");
    expect([...w.uploads.keys()].sort()).toEqual([
      "drift/2026-10/2026-10-14_daniel-street-fish-market_51329.pdf",
      "drift/2026-10/2026-10-17_daniel-street-fish-market_9764204.pdf",
      "drift/2026-10/2026-10-22_cd-australia-pty-ltd-trading-as-diablo-c_env-34730.pdf",
    ]);
    for (const bytes of w.uploads.values()) expect(await countPages(bytes)).toBe(1);
    expect(w.files[0]).toMatchObject({ status: "done", page_count: 4, error: null });
    expect(w.files[0].processed_at).toBeTruthy();
    // one sort call (whole file) and three reads, with the right models, features and ids
    expect(w.claudeCalls.map((c) => [c.feature, c.model])).toEqual([
      ["invoice_sort", "claude-haiku-5-5"],
      ["invoice_read", "claude-sonnet-5-5"],
      ["invoice_read", "claude-sonnet-5-5"],
      ["invoice_read", "claude-sonnet-5-5"],
    ]);
    expect(w.claudeCalls[1]).toMatchObject({ venueId: 1, fileId: file.id, documentId: "d1" });
    // saved against the shell, with file page numbers and the PDF path
    expect(w.saves).toHaveLength(3);
    expect(w.saves[2]).toMatchObject({ fileId: file.id, venueId: 1, documentId: "d3", readModel: "claude-sonnet-5-5", pagePdfPath: "drift/2026-10/2026-10-22_cd-australia-pty-ltd-trading-as-diablo-c_env-34730.pdf" });
    expect(w.saves[2].extracted.pages).toEqual([4]);
    expect(w.saves[2].extracted.lines[0].page).toBe(4);
    expect(w.notified).toEqual(["d1", "d2", "d3"]);
    // learning mode: the apply layer is still asked (it refuses real changes itself and only confirms same prices)
    expect(w.autoApplied).toEqual(["d1", "d2", "d3"]);
    // next step: nothing to do
    expect(await processStep(w.deps())).toMatchObject({ idle: true, stage: "idle", documents: [] });
  });

  it("asks the apply layer in auto mode too, as the invoice reader, and a notify hook that throws changes nothing", async () => {
    w.addFile();
    w.mode = "auto";
    const result = await runStep(w.deps({ notify: async () => { throw new Error("slack is down"); } }));
    expect(result.stage).toBe("read");
    expect(w.autoApplied).toEqual(["d1", "d2", "d3"]);
    expect(w.files[0].status).toBe("done");
  });

  it("calls autoApply for every saved document with the actor 'invoice reader', in learning mode as well", async () => {
    w.addFile();
    const actors: string[] = [];
    await runStep(w.deps({ autoApply: async (_sb, a) => { actors.push(a.actor); w.autoApplied.push(a.documentId); return []; } }));
    expect(actors).toEqual(["invoice reader", "invoice reader", "invoice reader"]);
  });

  it("does not call autoApply for a duplicate, failed or ignored document", async () => {
    w.addFile();
    const statuses = ["duplicate", "failed", "ignored"] as const;
    let n = 0;
    await runStep(
      w.deps({
        save: async (_sb, args) => {
          const d = w.docs.find((x) => x.id === args.documentId)!;
          d.read_model = args.readModel;
          return { documentId: d.id, status: statuses[n++], lineIds: [] };
        },
      }),
    );
    expect(w.autoApplied).toEqual([]);
    expect(w.files[0].status).toBe("done");
  });

  it("an autoApply failure does not fail the document", async () => {
    w.addFile();
    w.mode = "auto";
    const result = await runStep(w.deps({ autoApply: async () => { throw new Error("apply broke"); } }));
    expect(result.documents).toHaveLength(3);
    expect(w.files[0].status).toBe("done");
  });

  it("files a statement without reading it", async () => {
    w.addFile();
    w.sortReply = () => ({ pages: [sortedEntry(1, { doc_type: "statement", supplier_name: "Star Group" }), sortedEntry(2, { supplier_name: "Daniel Street Fish Market", invoice_number: "51329" }), sortedEntry(3, { doc_type: "blank" }), sortedEntry(4, { doc_type: "blank" })] });
    const result = await runStep(w.deps());
    expect(result.documents.map((d) => d.status)).toEqual(["nothing_to_apply", "needs_review"]);
    expect(w.claudeCalls.filter((c) => c.feature === "invoice_read")).toHaveLength(1);
    expect(w.docs[0]).toMatchObject({ read_model: "not_read", status: "nothing_to_apply" });
    expect(w.docs[0].page_pdf_path).toBe("drift/2026-10/2026-10-24_star-group_no-number-p1.pdf");
  });

  it("an all-blank file finishes with no documents", async () => {
    w.addFile();
    w.sortReply = () => ({ pages: [1, 2, 3, 4].map((p) => sortedEntry(p, { doc_type: "blank" })) });
    const result = await runStep(w.deps());
    expect(result.documents).toEqual([]);
    expect(w.files[0].status).toBe("done");
    expect(w.docs).toHaveLength(0);
  });

  it("sorts a file of more than 100 pages in chunks of 40 and joins an invoice across the boundary", async () => {
    const big = await makePdf(101);
    w.pdfs.set("incoming/drift/2026-10-24/abc.pdf", big);
    w.addFile();
    w.sortReply = (pages, call) =>
      ({
        pages: Array.from({ length: pages }, (_, i) =>
          call === 2 && i === 0 ? sortedEntry(i + 1, { supplier_name: "Big Supplier", continues_previous: true }) : call === 1 && i === 39 ? sortedEntry(i + 1, { supplier_name: "Big Supplier", invoice_number: "BIG1" }) : sortedEntry(i + 1, { doc_type: "blank" }),
        ),
      });
    w.readReply = () => EXTRACTS["51329"];
    const result = await runStep(w.deps());
    expect(w.claudeCalls.filter((c) => c.feature === "invoice_sort")).toHaveLength(3);
    expect(w.docs).toHaveLength(1);
    expect(w.docs[0].pages).toEqual([40, 41]);
    expect(result.stage).toBe("read");
    expect(w.files[0].page_count).toBe(101);
  });
});

// ---------------------------------------------------------------- resume, budget, race
describe("resuming, time budget and claim race", () => {
  it("resumes after a crash between documents: finished documents are skipped, nothing is sorted twice", async () => {
    const file = w.addFile();
    w.failSaveOn = 2; // the second save throws once
    const first = await runStep(w.deps());
    expect(first.stage).toBe("failed");
    expect(first.documents.map((d) => d.invoiceNumber)).toEqual(["51329"]); // the script still gets the one that finished
    expect(first.message).toMatch(/tried again/);
    expect(w.files[0]).toMatchObject({ status: "received", attempts: 1 });
    expect(w.files[0].error).toContain("database went away");
    const readsBefore = w.claudeCalls.filter((c) => c.feature === "invoice_read").length;
    expect(readsBefore).toBe(2);

    const second = await runStep(w.deps());
    expect(second.fileId).toBe(file.id);
    expect(second.stage).toBe("read");
    expect(second.documents.map((d) => d.invoiceNumber)).toEqual(["9764204", "ENV-34730"]);
    expect(w.claudeCalls.filter((c) => c.feature === "invoice_sort")).toHaveLength(1); // not sorted again
    expect(w.claudeCalls.filter((c) => c.feature === "invoice_read")).toHaveLength(4); // 2 + the 2 left, document 1 not re-read
    expect(w.docs).toHaveLength(3); // no duplicate shells
    expect(w.files[0].status).toBe("done");
  });

  it("stops starting new reads after 45 seconds and carries on in the next step", async () => {
    w.addFile();
    w.callMs = 20_000;
    const first = await runStep(w.deps());
    // sort 20s, document 1 at 40s, document 2 starts (40 < 45) and ends at 60s, document 3 must wait
    expect(first.stage).toBe("read");
    expect(first.documents).toHaveLength(2);
    expect(first.idle).toBe(false);
    expect(w.files[0].status).toBe("received");
    expect(w.claudeCalls.every((c) => (c.timeoutMs ?? 0) <= 40_000 && (c.timeoutMs ?? 0) >= 5_000)).toBe(true);
    // the later calls were given less than 40 s so the step cannot pass the route's 60 s
    expect(w.claudeCalls[2].timeoutMs).toBeLessThan(40_000);
    const second = await runStep(w.deps());
    expect(second.documents.map((d) => d.invoiceNumber)).toEqual(["ENV-34730"]);
    expect(w.files[0].status).toBe("done");
  });

  it("reports 'sorted' when the whole budget went on sorting", async () => {
    w.addFile();
    w.callMs = 46_000;
    const first = await runStep(w.deps());
    expect(first).toMatchObject({ stage: "sorted", documents: [] });
    expect(w.docs).toHaveLength(3);
    expect(w.files[0].status).toBe("received");
  });

  it("two callers at once never take the same file", async () => {
    w.addFile();
    const [a, b] = await Promise.all([runStep(w.deps()), runStep(w.deps())]);
    const winners = [a, b].filter((r) => !r.idle);
    expect(winners).toHaveLength(1);
    expect([a, b].filter((r) => r.idle)).toHaveLength(1);
    expect(w.claudeCalls.filter((c) => c.feature === "invoice_sort")).toHaveLength(1);
    expect(w.docs).toHaveLength(3);
  });

  it("claims the oldest file first, takes a stalled one, and leaves fresh, finished and awaiting-upload files alone", async () => {
    w.pdfs.set("p/new.pdf", await makePdf(4));
    w.pdfs.set("p/old.pdf", await makePdf(4));
    const newer = w.addFile({ id: "new", storage_path: "p/new.pdf", received_at: "2026-10-24T02:00:00.000Z" });
    const older = w.addFile({ id: "old", storage_path: "p/old.pdf", received_at: "2026-10-24T00:30:00.000Z" });
    w.addFile({ id: "busy", status: "reading", updated_at: new Date(NOW - 60_000).toISOString(), received_at: "2026-10-23T00:00:00.000Z" });
    w.addFile({ id: "waiting", attempts: AWAITING_UPLOAD, received_at: "2026-10-22T00:00:00.000Z" });
    w.addFile({ id: "finished", status: "done", received_at: "2026-10-21T00:00:00.000Z" });
    expect((await runStep(w.deps())).fileId).toBe(older.id);
    expect((await runStep(w.deps())).fileId).toBe(newer.id);
    expect((await runStep(w.deps())).idle).toBe(true);
    // ten minutes later the 'reading' file is stalled and gets picked up
    w.files.find((f) => f.id === "busy")!.updated_at = new Date(NOW - STALLED_AFTER_MS - 1000).toISOString();
    w.pdfs.set("incoming/drift/2026-10-24/abc.pdf", await makePdf(4));
    expect((await runStep(w.deps())).fileId).toBe("busy");
  });
});

// ---------------------------------------------------------------- reconcile retry
describe("reconcile retry with a stronger model", () => {
  it("re-reads once with Opus when the analysis does not reconcile, and keeps the reading that passes more checks", async () => {
    w.addFile();
    w.readReply = (n, model) => (n === "51329" && model === "claude-sonnet-5-5" ? { ...EXTRACTS[n], notes: ["BAD"] } : EXTRACTS[n]);
    await runStep(w.deps());
    const reread = w.claudeCalls.filter((c) => c.feature === "invoice_reread");
    expect(reread).toHaveLength(1);
    expect(reread[0].model).toBe("claude-opus-5-5");
    expect(reread[0].text).toContain("Line 2 does not multiply out.");
    expect(w.saves[0].readModel).toBe("claude-opus-5-5");
    expect(w.saves[0].analysis.reconciled).toBe(true);
    expect(w.saves[1].readModel).toBe("claude-sonnet-5-5"); // the others reconciled first time and are not re-read
  });

  it("keeps the first reading when the stronger one is no better, and does not try a third time", async () => {
    w.addFile();
    w.readReply = (n) => ({ ...EXTRACTS[n], notes: ["BAD"] });
    await runStep(w.deps());
    expect(w.claudeCalls.filter((c) => c.feature === "invoice_reread")).toHaveLength(3); // once per document
    expect(w.saves.every((s) => s.readModel === "claude-sonnet-5-5")).toBe(true);
    expect(w.saves.every((s) => !s.analysis.reconciled)).toBe(true); // saved as is for the engine to hold back and ask
  });

  it("a failing re-read leaves the first reading standing", async () => {
    w.addFile();
    w.readReply = (n, model) => (model === "claude-opus-5-5" ? "not json" : { ...EXTRACTS[n], notes: ["BAD"] });
    const r = await runStep(w.deps());
    expect(r.stage).toBe("read");
    expect(w.saves).toHaveLength(3);
  });

  it("does not re-read when the read model is already Opus, or when the time budget is spent", async () => {
    w.addFile();
    w.readReply = (n) => ({ ...EXTRACTS[n], notes: ["BAD"] });
    await runStep(w.deps({ models: { sort: "claude-haiku-5-5", read: "claude-opus-5-5" } }));
    expect(w.claudeCalls.filter((c) => c.feature === "invoice_reread")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- bad replies and failures
describe("bad replies and failures", () => {
  it("sends a rejected reading back once with the reason, then accepts the corrected one", async () => {
    w.addFile();
    w.readReply = (n, _m, attempt) => (n === "51329" && attempt === 1 ? { ...EXTRACTS[n], invoice_date: "14/10/2026" } : EXTRACTS[n]);
    await runStep(w.deps());
    const reads = w.claudeCalls.filter((c) => c.documentId === "d1");
    expect(reads).toHaveLength(2);
    expect(reads[1].text).toContain("rejected");
    expect(reads[1].text).toContain("invoice_date must be a real date");
    expect(w.files[0].status).toBe("done");
  });

  it("fails the step when the reply is rejected twice", async () => {
    w.addFile();
    w.readReply = () => "I cannot read this";
    const r = await runStep(w.deps());
    expect(r.stage).toBe("failed");
    expect(r.message).toMatch(/did not pass the checks twice/);
    expect(w.files[0]).toMatchObject({ status: "received", attempts: 1 });
  });

  it("marks the file failed after 3 attempts, keeps a short error free of secrets, and fails the unread documents", async () => {
    w.addFile();
    w.claudeError = () => new AiError("The reader could not answer (error 500). key sk-ant-api03-abcdefghijklmnop Bearer abc.def", "http_500");
    const r1 = await runStep(w.deps());
    expect(r1.stage).toBe("failed");
    expect(w.files[0]).toMatchObject({ status: "received", attempts: 1 });
    await runStep(w.deps());
    expect(w.files[0]).toMatchObject({ status: "received", attempts: 2 });
    const r3 = await runStep(w.deps());
    expect(r3.message).toMatch(/after 3 tries/);
    expect(w.files[0]).toMatchObject({ status: "failed", attempts: 3 });
    expect(w.files[0].error).not.toMatch(/sk-ant|Bearer abc/);
    expect(w.files[0].error!.length).toBeLessThanOrEqual(220);
    expect((await runStep(w.deps())).idle).toBe(true);
  });

  it("a file that is not a PDF fails with a plain message", async () => {
    w.pdfs.set("incoming/drift/2026-10-24/abc.pdf", new TextEncoder().encode("nope"));
    w.addFile();
    const r = await runStep(w.deps());
    expect(r.stage).toBe("failed");
    expect(w.files[0].error).toMatch(/not a PDF/);
  });

  it("a missing object in the bucket is a failure, not a crash", async () => {
    w.pdfs.clear();
    w.addFile();
    expect((await runStep(w.deps())).stage).toBe("failed");
  });

  it("when the database cannot record the failure, the step still answers", async () => {
    w.addFile();
    w.claudeError = () => new AiError("down", "network");
    const deps = w.deps();
    deps.repo = { ...w.repo, updateFile: vi.fn().mockImplementation(async (id, patch) => { if (patch.status === "received" || patch.status === "failed") throw new Error("db"); return w.repo.updateFile(id, patch); }) };
    expect((await runStep(deps)).stage).toBe("failed");
  });
});

// ---------------------------------------------------------------- hinted re-read
describe("a hinted re-read is never automatic", () => {
  it("analyses the kept re-read again with hintedReread set, and leaves a normal read alone", async () => {
    w.addFile();
    w.readReply = (n, model) => (n === "51329" && model === "claude-sonnet-5-5" ? { ...EXTRACTS[n], notes: ["BAD"] } : EXTRACTS[n]);
    await runStep(w.deps());
    const flagged = w.analyseCtxs.filter((c) => (c as { hintedReread?: boolean } | undefined)?.hintedReread === true);
    expect(flagged).toHaveLength(1);
    expect((flagged[0] as { marker: string }).marker).toBe("ctx"); // the rest of the context is carried over
    // the saved analysis for the re-read document is the hinted one (the last analyse call for it)
    expect(w.saves[0].readModel).toBe("claude-opus-5-5");
    expect(w.analyseCtxs.slice(0, 2).map((c) => (c as { hintedReread?: boolean }).hintedReread ?? false)).toEqual([false, false]);
    expect(w.analyseCtxs.filter((c) => (c as { hintedReread?: boolean }).hintedReread).length).toBe(1);
  });

  it("does not set the flag when the first reading is kept", async () => {
    w.addFile();
    w.readReply = (n) => ({ ...EXTRACTS[n], notes: ["BAD"] });
    await runStep(w.deps());
    expect(w.analyseCtxs.some((c) => (c as { hintedReread?: boolean } | undefined)?.hintedReread)).toBe(false);
  });

  it("does not set the flag when nothing needed a re-read", async () => {
    w.addFile();
    await runStep(w.deps());
    expect(w.analyseCtxs.some((c) => (c as { hintedReread?: boolean } | undefined)?.hintedReread)).toBe(false);
  });
});

// ---------------------------------------------------------------- poison files
describe("a step that never finishes still uses up an attempt", () => {
  const hang = () => new Promise<never>(() => {});
  async function waitForCall(count: number) {
    for (let i = 0; i < 200 && w.claudeCalls.length < count; i++) await new Promise((r) => setTimeout(r, 5));
    expect(w.claudeCalls.length).toBeGreaterThanOrEqual(count);
  }

  it("counts the attempt when the file is claimed, before anything can hang", async () => {
    w.addFile();
    const stuck = runStep(w.deps({ claude: async (a) => { w.claudeCalls.push(a); return hang(); } }));
    void stuck; // never settles: the platform killed it
    await waitForCall(1);
    expect(w.files[0]).toMatchObject({ status: "sorting", attempts: 1 });
  });

  it("after 3 claims that never finished, the 4th look marks the file failed and its unread documents failed", async () => {
    w.addFile();
    const hung = () => w.deps({ claude: async (a) => { w.claudeCalls.push(a); return hang(); } });
    for (let claim = 1; claim <= 3; claim++) {
      void runStep(hung());
      await waitForCall(claim);
      expect(w.files[0]).toMatchObject({ status: "sorting", attempts: claim });
      // ten minutes pass with no progress: the claim is stale
      w.files[0].updated_at = new Date(NOW - STALLED_AFTER_MS - 1000).toISOString();
    }
    const calls = w.claudeCalls.length;
    // make shells exist so the documents can be failed too
    w.docs.push({ id: "dx", file_id: w.files[0].id, doc_type: "invoice", supplier_name_read: "S", invoice_number: "1", invoice_date: null, pages: [1], page_pdf_path: null, read_model: null, status: "needs_review" });
    w.docs.push({ id: "dy", file_id: w.files[0].id, doc_type: "invoice", supplier_name_read: "S", invoice_number: "2", invoice_date: null, pages: [2], page_pdf_path: null, read_model: "claude-sonnet-5-5", status: "needs_review" });
    const r = await runStep(w.deps());
    expect(r).toMatchObject({ stage: "failed", idle: false });
    expect(r.message).toMatch(/after 3 tries/);
    expect(w.claudeCalls).toHaveLength(calls); // nothing was read on the fourth look
    expect(w.files[0]).toMatchObject({ status: "failed", attempts: 3 });
    expect(w.docs.find((d) => d.id === "dx")!.status).toBe("failed");
    expect(w.docs.find((d) => d.id === "dy")!.status).toBe("needs_review"); // already read: left alone
    expect((await runStep(w.deps())).idle).toBe(true);
  });

  it("a long file read in several steps is not charged an attempt for each step", async () => {
    w.addFile();
    w.callMs = 20_000;
    await runStep(w.deps());
    expect(w.files[0]).toMatchObject({ status: "received", attempts: 0 });
    await runStep(w.deps());
    expect(w.files[0]).toMatchObject({ status: "done" });
  });

  it("the awaiting-upload sentinel is still never claimed, and the claim counts from zero once released", async () => {
    w.addFile({ id: "waiting", attempts: AWAITING_UPLOAD });
    expect((await runStep(w.deps())).idle).toBe(true);
    expect(w.files[0].attempts).toBe(AWAITING_UPLOAD);
    w.files[0].attempts = 0; // the upload route releases it
    await runStep(w.deps());
    expect(w.files[0]).toMatchObject({ status: "done", attempts: 1 });
  });
});

// ---------------------------------------------------------------- helpers
describe("helpers", () => {
  it("builds the bucket path from venue, month, date, supplier and number with no slashes", () => {
    expect(buildPdfPath({ venueSlug: "drift", date: "2026-10-14", supplier: "Daniel Street Fish Market", invoiceNumber: "51329", firstPage: 1 })).toBe("drift/2026-10/2026-10-14_daniel-street-fish-market_51329.pdf");
    const p = buildPdfPath({ venueSlug: "drift", date: "2026-10-14", supplier: "A/B \\ C: Co.", invoiceNumber: "12/34", firstPage: 2 });
    expect(p.split("/")).toHaveLength(3);
    expect(p).toBe("drift/2026-10/2026-10-14_a-b-c-co_12-34.pdf");
    expect(buildPdfPath({ venueSlug: "drift", date: "2026-10-14", supplier: null, invoiceNumber: null, firstPage: 3 })).toBe("drift/2026-10/2026-10-14_unknown-supplier_no-number-p3.pdf");
  });
  it("names the download like the Drive files, with no path characters", () => {
    expect(buildDownloadName({ date: "2026-10-14", supplier: "Daniel Street Fish Market", invoiceNumber: "51329" })).toBe("2026-10-14 Daniel Street Fish Market 51329.pdf");
    expect(buildDownloadName({ date: "2026-10-14", supplier: "A/B", invoiceNumber: null })).toBe("2026-10-14 A B no number.pdf");
  });
  it("safeError hides keys and caps length", () => {
    expect(safeError(new Error("bad sk-ant-api03-abcdefghijk key"))).not.toContain("sk-ant");
    expect(safeError(new Error("x".repeat(500)))).toHaveLength(200);
  });
  it("safeError hides the new Supabase secret and publishable key formats", () => {
    const samples = [
      "request failed with key sb" + "_secret_AbCdEf0123456789_xyz-QRSTUV",
      "apikey=sb" + "_publishable_9f8e7d6c5b4a39281706f5e4d3c2b1a0 rejected",
      "SB_SECRET_UPPERCASE1234567890abcdef in a header",
      "token sbp" + "_0123456789abcdef0123456789abcdef01234567 expired",
      "mixed eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig and sb" + "_secret_ZZZZZZZZZZZZZZ",
    ];
    for (const m of samples) {
      const out = safeError(new Error(m));
      expect(out).not.toMatch(/sb_(secret|publishable)_[A-Za-z0-9]{6}|sbp_0123|eyJhbGci/i);
      expect(out).toContain("[hidden]");
    }
    expect(safeError(new Error("The scan is for sb_ordering_products, which is fine"))).toBe("The scan is for sb_ordering_products, which is fine");
  });
  it("reads model names from the environment with the documented defaults", () => {
    expect(resolveModels({})).toEqual({ sort: "claude-haiku-5-5", read: "claude-sonnet-5-5" });
    expect(resolveModels({ INVOICE_SORT_MODEL: "s", INVOICE_READ_MODEL: "r" })).toEqual({ sort: "s", read: "r" });
  });
});

// ---------------------------------------------------------------- venue attribution (Troy, 25 Oct 2026)
// Prices are shared across venues, so the venue never blocks or asks anything: an invoice that names exactly one of our venues
// belongs to that venue whatever pile it was scanned in; otherwise it stays with the folder's venue.
describe("venue attribution", () => {
  const venueNames = [
    { id: 1, name: "Drift", aliases: ["drift bar and dining"] },
    { id: 2, name: "Chiobu", aliases: [] },
    { id: 3, name: "Greedy Gringo's", aliases: ["greedy gringos"] },
  ];
  const oneDoc = [sortedEntry(1, { supplier_name: "Daniel Street Fish Market", invoice_number: "51329" }), sortedEntry(2, { doc_type: "blank" }), sortedEntry(3, { doc_type: "blank" }), sortedEntry(4, { doc_type: "blank" })];
  const withAddress = (bill_to: string | null, ship_to: string | null = null) => (n: string) => ({ ...EXTRACTS[n], bill_to, ship_to });
  const loads: { venueId: number; folderVenueId: number }[] = [];

  /** a Chiobu-folder file (venue 2) holding the one Daniel Street invoice */
  async function run(over: Partial<PipelineDeps> = {}) {
    loads.length = 0;
    w.sortReply = () => ({ pages: oneDoc });
    w.addFile({ venue_id: 2 });
    return runStep(
      w.deps({
        loadContext: (async (_sb: unknown, a: { venueId: number; folderVenueId: number }) => {
          loads.push({ venueId: a.venueId, folderVenueId: a.folderVenueId });
          return { venueId: a.venueId, folderVenueId: a.folderVenueId, venueNames } as never;
        }) as never,
        ...over,
      }),
    );
  }

  it("an invoice naming Drift in a Chiobu-folder file is filed under Drift: saved, analysed and notified as Drift", async () => {
    w.readReply = withAddress("DRIFT BAR AND DINING");
    const r = await run();
    expect(r.documents[0]).toMatchObject({ id: "d1", venueSlug: "drift" });
    expect(w.saves[0]).toMatchObject({ venueId: 1 });
    // the folder's context is loaded first (it carries the venue names), then Drift's, which is what the engine analyses
    expect(loads).toEqual([{ venueId: 2, folderVenueId: 2 }, { venueId: 1, folderVenueId: 2 }]);
    expect((w.analyseCtxs[0] as { venueId: number }).venueId).toBe(1);
    expect(w.notifiedVenues).toEqual([1]);
    // the split PDF is still filed under the folder the scan arrived in, and the file keeps its folder venue
    expect([...w.uploads.keys()]).toEqual(["chiobu/2026-10/2026-10-14_daniel-street-fish-market_51329.pdf"]);
    expect(w.files[0]).toMatchObject({ venue_id: 2, status: "done" });
  });

  it("an invoice naming no venue stays with the folder venue and loads one context", async () => {
    w.readReply = withAddress("Some Company Pty Ltd");
    const r = await run();
    expect(r.documents[0].venueSlug).toBe("chiobu");
    expect(w.saves[0]).toMatchObject({ venueId: 2 });
    expect(loads).toEqual([{ venueId: 2, folderVenueId: 2 }]);
    expect(w.notifiedVenues).toEqual([2]);
  });

  it("an invoice naming two venues stays with the folder venue", async () => {
    w.readReply = withAddress("Drift Bar and Dining", "Chiobu");
    await run();
    expect(w.saves[0]).toMatchObject({ venueId: 2 });
    expect(loads).toEqual([{ venueId: 2, folderVenueId: 2 }]);
  });

  it("an invoice naming the folder's own venue is unchanged", async () => {
    w.readReply = withAddress("Chiobu");
    await run();
    expect(w.saves[0]).toMatchObject({ venueId: 2 });
    expect(loads).toHaveLength(1);
  });
});

describe("venue attribution with the real engine", () => {
  const sortOne = [sortedEntry(1, { supplier_name: "Daniel Street Fish Market", invoice_number: "51329" }), sortedEntry(2, { doc_type: "blank" }), sortedEntry(3, { doc_type: "blank" }), sortedEntry(4, { doc_type: "blank" })];
  const reading = (bill_to: string | null) => () => ({ ...danielStreet51329Fixed(), bill_to, ship_to: null });
  const deps = () =>
    w.deps({
      analyse: analyseInvoice,
      loadContext: (async (_sb: unknown, a: { venueId: number; folderVenueId: number }) => baseCtx({ venueId: a.venueId, folderVenueId: a.folderVenueId })) as never,
    });

  it("a Drift invoice scanned in Chiobu's pile: document venue, line venue and ordering products are all Drift's, and nothing is asked about the venue", async () => {
    w.sortReply = () => ({ pages: sortOne });
    w.readReply = reading("DRIFT BAR AND DINING");
    w.addFile({ venue_id: 2 });
    await runStep(deps());
    const { venueId, analysis } = w.saves[0];
    expect(venueId).toBe(1);
    expect(analysis.venue_check).toBe("ok");
    expect(analysis.lines.every((l) => l.venue_id === 1)).toBe(true);
    // the barramundi line finds Drift's ordering product (the ordering list is per venue)
    expect(analysis.lines.find((l) => l.item_code === "15056" && l.line_class === "product")).toMatchObject({ product_id: "prod-barra" });
    expect(analysis.questions.map((q) => q.kind)).not.toContain("venue_mismatch");
  });

  it("the same scan with no venue named stays Chiobu's, finds no Drift product, and nothing about the venue blocks or is asked", async () => {
    w.sortReply = () => ({ pages: sortOne });
    w.readReply = reading("Some Company Pty Ltd");
    w.addFile({ venue_id: 2 });
    await runStep(deps());
    const { venueId, analysis } = w.saves[0];
    expect(venueId).toBe(2);
    expect(analysis.venue_check).toBe("unknown");
    expect(analysis.lines.every((l) => l.venue_id === 2)).toBe(true);
    expect(analysis.lines.find((l) => l.item_code === "15056" && l.line_class === "product")?.product_id).toBeNull();
    expect(analysis.questions.map((q) => q.kind)).not.toContain("venue_mismatch");
    expect(analysis.lines.some((l) => /venue/i.test(l.decision_reason ?? ""))).toBe(false);
  });

  it("the same invoice scanned into Chiobu's pile and again into Drift's pile is a duplicate the second time", async () => {
    w.sortReply = () => ({ pages: sortOne });
    w.readReply = reading("DRIFT BAR AND DINING");
    w.addFile({ venue_id: 2 });
    await runStep(deps());
    const first = w.saves[0];
    // what the database now holds for the first, which the second scan's context sees across all venues
    const filed = { id: "d1", venue_id: first.venueId, supplier_id: first.analysis.supplier_id, invoice_number: "51329", status: first.analysis.status, invoice_date: "2026-10-14", total_inc: 216.8 };
    w.docs = [];
    w.addFile({ venue_id: 1, sha256: "second" });
    await runStep(
      w.deps({
        analyse: analyseInvoice,
        loadContext: (async (_sb: unknown, a: { venueId: number; folderVenueId: number }) => baseCtx({ venueId: a.venueId, folderVenueId: a.folderVenueId, existingDocs: [filed] as never })) as never,
      }),
    );
    expect(w.saves[1].venueId).toBe(1);
    expect(w.saves[1].analysis.status).toBe("duplicate");
    expect(w.saves[1].analysis.duplicate_of).toBe("d1");
  });
});
