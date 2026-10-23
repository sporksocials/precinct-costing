import { describe, expect, it } from "vitest";
import { decideStatus, recomputeDocumentStatus, saveAnalysis } from "../lib/invoice-store";
import { createFakeSupabase } from "./helpers/fake-supabase";
import { aLine, analysis, extracted, question } from "./helpers/invoice-analysis";
import { document, IDS, line, SUPPLIER } from "./helpers/invoice-fixtures";

const base = { fileId: "file-1", venueId: 1, pagePdfPath: "doc/1.pdf", readModel: "claude-sonnet-5-5" };
const empty = () => createFakeSupabase({ invoice_suppliers: [SUPPLIER] });

describe("saveAnalysis: a new document", () => {
  it("stores the document, its lines and its questions, and returns the new line ids", async () => {
    const f = empty();
    const a = analysis({
      lines: [aLine(1), aLine(2, { match_state: "unmatched", ingredient_id: null, decision: "none" })],
      questions: [question(2)],
    });
    const r = await saveAnalysis(f.sb, { ...base, extracted: extracted(), analysis: a });

    expect(r.status).toBe("needs_review");
    expect(f.db.invoice_documents).toHaveLength(1);
    expect(f.db.invoice_documents[0]).toMatchObject({
      id: r.documentId, venue_id: 1, file_id: "file-1", supplier_id: "sup-daniel", supplier_name_read: "Daniel Street Fish Market", supplier_abn_read: "61151388094",
      invoice_number: "51329", invoice_date: "2026-10-14", pages: [1], page_pdf_path: "doc/1.pdf", venue_check: "ok", reconciled: true, fee_pool_ex: 5.91,
      subtotal_ex: 215.91, gst_total: 0.59, total_inc: 216.5, mode: "learning", status: "needs_review", read_model: "claude-sonnet-5-5",
    });
    expect(f.db.invoice_lines).toHaveLength(2);
    expect(f.db.invoice_lines.every((l) => l.document_id === r.documentId && l.venue_id === 1)).toBe(true);
    expect(f.db.invoice_lines[0]).not.toHaveProperty("source_index");
    expect(r.lineIds).toEqual(f.db.invoice_lines.map((l) => l.id));
    expect(f.db.invoice_questions).toHaveLength(1);
    expect(f.db.invoice_questions[0]).toMatchObject({ document_id: r.documentId, line_id: f.db.invoice_lines[1].id, kind: "unmatched_line", status: "open", venue_id: 1 });
    expect(f.db.invoice_questions[0].options).toHaveLength(2);
  });

  it("writes only through insertRows: a null column is left to the database default", async () => {
    const f = empty();
    await saveAnalysis(f.sb, { ...base, extracted: extracted(), analysis: analysis({ lines: [aLine(1, { map_id: null, match_method: null })] }) });
    const inserts = f.log.filter((l) => l.op === "upsert" && l.table === "invoice_lines");
    expect(inserts).toHaveLength(1);
    const payload = inserts[0].payload[0];
    expect(Object.values(payload)).not.toContain(null);
    expect(Object.values(payload)).not.toContain(undefined);
    expect(payload).not.toHaveProperty("map_id");
  });

  it("takes the invoice date from the document when the line has none", async () => {
    const f = empty();
    await saveAnalysis(f.sb, { ...base, extracted: extracted(), analysis: analysis({ lines: [aLine(1, { invoice_date: null })] }) });
    expect(f.db.invoice_lines[0].invoice_date).toBe("2026-10-14");
  });
});

describe("saveAnalysis: suppliers", () => {
  const unknown = { supplier_id: null, new_supplier: { name: "CD Australia Pty Ltd", abn: "12 345 678 901" } };

  it("creates a supplier the system has never seen, with the ABN as digits", async () => {
    const f = empty();
    const r = await saveAnalysis(f.sb, { ...base, extracted: extracted({ supplier_name: "CD Australia Pty Ltd" }), analysis: analysis(unknown) });
    expect(f.db.invoice_suppliers).toHaveLength(2);
    const created = f.db.invoice_suppliers[1];
    expect(created).toMatchObject({ name: "CD Australia Pty Ltd", abn: "12345678901" });
    expect(f.db.invoice_documents.find((d) => d.id === r.documentId)!.supplier_id).toBe(created.id);
  });

  it("reuses a supplier with the same ABN, or the same name in any case", async () => {
    const f = empty();
    await saveAnalysis(f.sb, { ...base, extracted: extracted({ invoice_number: "A1" }), analysis: analysis(unknown) });
    await saveAnalysis(f.sb, { ...base, extracted: extracted({ invoice_number: "A2" }), analysis: analysis({ ...unknown, new_supplier: { name: "Something Else", abn: "12345678901" } }) });
    await saveAnalysis(f.sb, { ...base, extracted: extracted({ invoice_number: "A3" }), analysis: analysis({ ...unknown, new_supplier: { name: "  cd australia pty ltd ", abn: null } }) });
    expect(f.db.invoice_suppliers).toHaveLength(2);
    expect(new Set(f.db.invoice_documents.map((d) => d.supplier_id)).size).toBe(1);
  });

  it("leaves the supplier empty when the analysis has none", async () => {
    const f = empty();
    await saveAnalysis(f.sb, { ...base, extracted: extracted(), analysis: analysis({ supplier_id: null }) });
    expect(f.db.invoice_documents[0].supplier_id ?? null).toBeNull();
  });
});

describe("saveAnalysis: duplicates", () => {
  it("stores a duplicate with status duplicate and no lines or questions", async () => {
    const f = empty();
    const r = await saveAnalysis(f.sb, { ...base, extracted: extracted(), analysis: analysis({ duplicate_of: "doc-original", status: "duplicate", questions: [question(1)] }) });
    expect(r.status).toBe("duplicate");
    expect(r.lineIds).toEqual([]);
    expect(f.db.invoice_documents[0]).toMatchObject({ status: "duplicate", duplicate_of: "doc-original" });
    expect(f.db.invoice_lines ?? []).toHaveLength(0);
    expect(f.db.invoice_questions ?? []).toHaveLength(0);
  });

  it("files the second copy as a duplicate when the database says the number is already taken", async () => {
    const f = empty();
    f.unique("invoice_documents", ["venue_id", "supplier_id", "invoice_number"], (row) => row.status !== "duplicate");
    const first = await saveAnalysis(f.sb, { ...base, extracted: extracted(), analysis: analysis() });
    const second = await saveAnalysis(f.sb, { ...base, extracted: extracted(), analysis: analysis() });
    expect(second.status).toBe("duplicate");
    expect(f.db.invoice_documents.find((d) => d.id === second.documentId)).toMatchObject({ status: "duplicate", duplicate_of: first.documentId });
    expect(f.db.invoice_lines).toHaveLength(2); // only the first copy's lines
  });
});

describe("saveAnalysis: re-analysing a document", () => {
  function filed() {
    const f = createFakeSupabase({
      invoice_suppliers: [SUPPLIER],
      invoice_documents: [document({ status: "partly_applied" })],
      invoice_lines: [
        line({ id: "L1", line_no: 1, state: "applied" }),
        line({ id: "L2", line_no: 2, state: "open", match_state: "unmatched", ingredient_id: null, decision: "none" }),
        line({ id: "L3", line_no: 3, state: "ignored", line_class: "fee" }),
        line({ id: "L4", line_no: 4, state: "approved_skip" }),
      ],
      invoice_price_changes: [{ id: "C1", line_id: "L1", document_id: IDS.doc, status: "applied" }],
      invoice_questions: [],
    });
    return f;
  }
  const reanalysed = () =>
    analysis({
      lines: [aLine(1, { description: "twin of the applied line" }), aLine(2), aLine(3, { line_class: "fee" }), aLine(4)],
      status: "needs_review",
    });

  it("keeps an applied line exactly as it is and skips its analysed twin", async () => {
    const f = filed();
    const r = await saveAnalysis(f.sb, { ...base, documentId: IDS.doc, extracted: extracted(), analysis: reanalysed() });
    const l1 = f.db.invoice_lines.filter((l) => l.line_no === 1);
    expect(l1).toHaveLength(1);
    expect(l1[0]).toMatchObject({ id: "L1", state: "applied", description: "Kingfish fillets skin on wing off per kg" });
    expect(f.db.invoice_price_changes).toHaveLength(1);
    expect(f.db.invoice_price_changes[0].line_id).toBe("L1");
    expect(f.db.invoice_lines).toHaveLength(4);
    expect(r.lineIds).toHaveLength(3); // only the new rows
    expect(f.db.invoice_lines.find((l) => l.id === "L2")).toBeUndefined(); // replaced
  });

  it("keeps a reverted line too", async () => {
    const f = filed();
    f.db.invoice_lines[0].state = "reverted";
    await saveAnalysis(f.sb, { ...base, documentId: IDS.doc, extracted: extracted(), analysis: reanalysed() });
    expect(f.db.invoice_lines.filter((l) => l.line_no === 1)).toHaveLength(1);
    expect(f.db.invoice_lines.find((l) => l.line_no === 1)!.id).toBe("L1");
  });

  it("carries a person's ignore or decline onto the replacement line", async () => {
    const f = filed();
    await saveAnalysis(f.sb, { ...base, documentId: IDS.doc, extracted: extracted(), analysis: reanalysed() });
    expect(f.db.invoice_lines.find((l) => l.line_no === 3)!.state).toBe("ignored");
    expect(f.db.invoice_lines.find((l) => l.line_no === 4)!.state).toBe("approved_skip");
    expect(f.db.invoice_lines.find((l) => l.line_no === 2)!.state).toBe("open");
  });

  it("updates the document row and works out the status from the lines that are really there", async () => {
    const f = filed();
    const r = await saveAnalysis(f.sb, { ...base, documentId: IDS.doc, extracted: extracted({ invoice_number: "51329" }), analysis: reanalysed() });
    expect(f.db.invoice_documents).toHaveLength(1);
    expect(r.documentId).toBe(IDS.doc);
    expect(r.status).toBe("partly_applied"); // one applied, one still waiting for approval
    expect(f.db.invoice_documents[0].status).toBe("partly_applied");
  });

  it("never reopens a document a person set aside", async () => {
    const f = filed();
    f.db.invoice_documents[0].status = "ignored";
    const r = await saveAnalysis(f.sb, { ...base, documentId: IDS.doc, extracted: extracted(), analysis: reanalysed() });
    expect(r.status).toBe("ignored");
  });

  it("fails plainly when the document is gone", async () => {
    const f = empty();
    await expect(saveAnalysis(f.sb, { ...base, documentId: "nope", extracted: extracted(), analysis: analysis() })).rejects.toThrow(/no longer exists/);
  });

  describe("questions", () => {
    function withQuestions() {
      const f = filed();
      f.db.invoice_questions.push(
        { id: "Q-answered", venue_id: 1, document_id: IDS.doc, line_id: "L2", kind: "unmatched_line", prompt: "old", options: [], status: "answered", answer: { option_id: "o1" }, answered_by: "mon" },
        { id: "Q-open", venue_id: 1, document_id: IDS.doc, line_id: "L4", kind: "big_change", prompt: "old prompt", options: [], status: "open", answer: null },
        { id: "Q-stale", venue_id: 1, document_id: IDS.doc, line_id: "L3", kind: "unit_unclear", prompt: "no longer applies", options: [], status: "open", answer: null },
      );
      return f;
    }

    it("does not ask an answered question again, updates an open one that still applies, dismisses one that no longer does", async () => {
      const f = withQuestions();
      const a = reanalysed();
      a.questions = [question(2), question(4, { kind: "big_change", prompt: "new prompt" })];
      await saveAnalysis(f.sb, { ...base, documentId: IDS.doc, extracted: extracted(), analysis: a });

      const qs = f.db.invoice_questions;
      expect(qs).toHaveLength(3); // nothing new was created
      expect(qs.find((q) => q.id === "Q-answered")).toMatchObject({ status: "answered", answered_by: "mon" });
      expect(qs.find((q) => q.id === "Q-open")).toMatchObject({ status: "open", prompt: "new prompt" });
      expect(qs.find((q) => q.id === "Q-stale")!.status).toBe("dismissed");
    });

    it("moves a question onto the replacement line instead of losing it with the old line", async () => {
      const f = withQuestions();
      const a = reanalysed();
      a.questions = [question(2), question(4, { kind: "big_change" })];
      await saveAnalysis(f.sb, { ...base, documentId: IDS.doc, extracted: extracted(), analysis: a });
      const newL2 = f.db.invoice_lines.find((l) => l.line_no === 2)!;
      const newL4 = f.db.invoice_lines.find((l) => l.line_no === 4)!;
      expect(f.db.invoice_questions.find((q) => q.id === "Q-answered")!.line_id).toBe(newL2.id);
      expect(f.db.invoice_questions.find((q) => q.id === "Q-open")!.line_id).toBe(newL4.id);
      const lineIds = new Set(f.db.invoice_lines.map((l) => l.id));
      for (const q of f.db.invoice_questions) expect(lineIds.has(q.line_id)).toBe(true);
    });

    it("creates a question that is new, and skips one about a line that is already applied", async () => {
      const f = withQuestions();
      const a = reanalysed();
      a.questions = [question(2), question(4, { kind: "big_change" }), question(1, { kind: "big_change" }), question(null, { kind: "totals_mismatch", prompt: "Totals" })];
      await saveAnalysis(f.sb, { ...base, documentId: IDS.doc, extracted: extracted(), analysis: a });
      const kinds = f.db.invoice_questions.filter((q) => q.status === "open").map((q) => q.kind).sort();
      expect(kinds).toEqual(["big_change", "totals_mismatch"]);
      const totals = f.db.invoice_questions.find((q) => q.kind === "totals_mismatch")!;
      expect(totals.line_id ?? null).toBeNull();
    });

    it("reopens a dismissed question that applies again rather than adding a copy", async () => {
      const f = withQuestions();
      f.db.invoice_questions.find((q) => q.id === "Q-stale")!.status = "dismissed";
      const a = reanalysed();
      a.questions = [question(2), question(3, { kind: "unit_unclear", prompt: "back again" })];
      await saveAnalysis(f.sb, { ...base, documentId: IDS.doc, extracted: extracted(), analysis: a });
      expect(f.db.invoice_questions.filter((q) => q.kind === "unit_unclear")).toHaveLength(1);
      expect(f.db.invoice_questions.find((q) => q.id === "Q-stale")).toMatchObject({ status: "open", prompt: "back again" });
    });
  });
});

describe("decideStatus", () => {
  const L = (state: string, decision: string, extra: Record<string, any> = {}) => ({ line_class: "product", match_state: "matched", state, decision, ...extra }) as any;
  it("works the status out from the lines and open questions", () => {
    expect(decideStatus([L("applied", "apply"), L("confirmed", "same")], 0)).toBe("applied");
    expect(decideStatus([L("applied", "apply"), L("open", "needs_approval")], 0)).toBe("partly_applied");
    expect(decideStatus([L("applied", "apply")], 1)).toBe("partly_applied");
    expect(decideStatus([L("open", "needs_approval")], 0)).toBe("needs_review");
    expect(decideStatus([L("open", "none", { match_state: "unmatched" })], 0)).toBe("needs_review");
    expect(decideStatus([L("open", "none")], 1)).toBe("needs_review");
    expect(decideStatus([L("open", "none"), L("ignored", "needs_approval")], 0)).toBe("nothing_to_apply");
    expect(decideStatus([L("reverted", "apply")], 0)).toBe("nothing_to_apply");
    expect(decideStatus([], 0)).toBe("nothing_to_apply");
    // a fee line that is unmatched is not a product waiting for a match
    expect(decideStatus([L("open", "none", { line_class: "delivery", match_state: "unmatched" })], 0)).toBe("nothing_to_apply");
  });
});

describe("recomputeDocumentStatus", () => {
  it("stores the status and leaves a set-aside document alone", async () => {
    const f = createFakeSupabase({ invoice_documents: [document()], invoice_lines: [line({ state: "applied" })], invoice_questions: [] });
    expect(await recomputeDocumentStatus(f.sb, IDS.doc)).toBe("applied");
    expect(f.db.invoice_documents[0].status).toBe("applied");
    f.db.invoice_documents[0].status = "ignored";
    expect(await recomputeDocumentStatus(f.sb, IDS.doc)).toBe("ignored");
  });
});
