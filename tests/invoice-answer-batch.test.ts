import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerQuestion, answerQuestionsBatch, batchMessage } from "../lib/invoice-answer";
import type { AnalyseInvoice } from "../lib/invoice-interfaces";
import { descKey } from "../lib/invoice-names";
import type { AnalysedLine, AnalysedQuestion, ExtractedInvoice, InvoiceAnalysis } from "../lib/invoice-types";
import { createFakeSupabase, type FakeSupabase } from "./helpers/fake-supabase";
import { document, ingredient, IDS, line, SUPPLIER, VENUES } from "./helpers/invoice-fixtures";

const NOW = new Date("2026-10-25T02:00:00Z");
const TODAY = "2026-10-25";

/** Matches by learned code, asks about the rest. Counts how many times it is asked to look at the invoice. */
function makeEngine() {
  const state = { calls: 0 };
  const analyse: AnalyseInvoice = (ex: ExtractedInvoice, ctx): InvoiceAnalysis => {
    state.calls++;
    const supplier = ctx.suppliers.find((s) => s.abn === ex.supplier_abn || s.name === ex.supplier_name) ?? null;
    const lines: AnalysedLine[] = [];
    const questions: AnalysedQuestion[] = [];
    ex.lines.forEach((l, i) => {
      const key = descKey(l.description);
      const map = ctx.maps.find((m) => m.supplier_id === supplier?.id && ((l.item_code && m.item_code === l.item_code) || (!l.item_code && m.desc_key === key)));
      const ing = map?.ingredient_id ? ctx.ingredients.find((x) => x.id === map.ingredient_id) : undefined;
      const base = {
        source_index: i, venue_id: ctx.venueId, invoice_date: ex.invoice_date, line_no: l.line_no, page: l.page, line_class: l.class_hint ?? "product", item_code: l.item_code,
        description: l.description, qty: l.qty, unit: l.unit, unit_price_ex: l.unit_price, line_total_ex: l.line_total, gst: l.gst, gst_amount: null, math_ok: true,
        fee_share_ex: 0, landed_total_ex: null, landed_unit_ex: null, landed_base_ex: null, product_id: null, base_qty: l.qty, base_unit: "kg",
        old_product_price: null, new_product_price: null, state: "open" as const,
      };
      if (map?.rejected) {
        lines.push({ ...base, match_state: "ignored", match_method: "human", map_id: map.id, ingredient_id: null, packs_per_unit: null, old_pack_price: null, new_pack_price: null, change_pct: null, decision: "none", decision_reason: null });
      } else if (ing && l.unit_price !== null) {
        const change = (l.unit_price - ing.pack_price) / ing.pack_price;
        const decision = Math.abs(change) < 1e-9 ? "same" : "needs_approval";
        lines.push({ ...base, match_state: "matched", match_method: "human", map_id: map!.id, ingredient_id: ing.id, packs_per_unit: map!.packs_per_unit, old_pack_price: ing.pack_price, new_pack_price: l.unit_price, change_pct: change, decision, decision_reason: decision === "needs_approval" ? "Waits for a tap" : null });
      } else {
        lines.push({ ...base, match_state: "unmatched", match_method: null, map_id: null, ingredient_id: null, packs_per_unit: null, old_pack_price: null, new_pack_price: null, change_pct: null, decision: "none", decision_reason: "Not matched" });
        questions.push({ kind: "unmatched_line", line_no: l.line_no, prompt: `Which product is ${l.description}?`, options: [{ id: "np", label: "Not a product", action: "not_a_product" }] });
      }
    });
    return {
      supplier_id: supplier?.id ?? null, new_supplier: null, venue_check: "ok", price_basis: "ex", reconciled: true, recon_notes: [], fee_pool_ex: 0, lines, questions,
      duplicate_of: null, mode: "learning", status: "needs_review", summary: { products: 0, matched: 0, same: 0, to_apply: 0, need_approval: 0, unmatched: 0 },
    };
  };
  return { analyse, state };
}

const ING = { wedge: "ing-wedge", bacon: "ing-bacon", bun: "ing-bun" };

function unmatchedLine(n: number, code: string, description: string, price: number) {
  return line({ id: `L${n}`, line_no: n, item_code: code, description, qty: 2, unit: "PKT", unit_price_ex: price, line_total_ex: price * 2, gst: "taxable", match_state: "unmatched", match_method: null, ingredient_id: null, packs_per_unit: null, old_pack_price: null, new_pack_price: null, change_pct: null, decision: "none", decision_reason: "Not matched" });
}
const question = (n: number, over: Record<string, any> = {}) => ({
  id: `Q${n}`, venue_id: 1, document_id: IDS.doc, line_id: `L${n}`, kind: "unmatched_line", prompt: "x", status: "open",
  options: [{ id: "np", label: "Not a product", action: "not_a_product" }, { id: "ig", label: "Ignore this line", action: "ignore_line" }], ...over,
});

function setup(over: { doc?: Record<string, any>; extraQuestions?: Record<string, any>[] } = {}): FakeSupabase {
  const f = createFakeSupabase({
    cost_venues: VENUES,
    cost_settings: [{ key: "gst_rate", value: 0.1 }, { key: "invoice_learning_mode", value: 1 }],
    invoice_suppliers: [SUPPLIER],
    invoice_files: [{ id: "file-1", venue_id: 1, storage_path: "x.pdf", sha256: "abc", status: "done", attempts: 0, error: null }],
    invoice_documents: [document({ supplier_name_read: "Daniel Street Fish Market", ...over.doc })],
    invoice_lines: [unmatchedLine(1, "8229", "POTATO WEDGES SEASONED (MCCAIN) 2kg", 10.14), unmatchedLine(2, "217452", "BACON MIDDLE RINDLESS 2.5kg", 29.5), unmatchedLine(3, "187235", "BREAD BUNS VEGAN 40x85gr", 41.64), unmatchedLine(4, "7366", "CHEESE RICOTTA 500gr", 7.68)],
    invoice_questions: [question(1), question(2), question(3), question(4), ...(over.extraQuestions ?? [])],
    invoice_item_map: [],
    invoice_charge_rules: [],
    cost_ingredients: [
      ingredient({ id: ING.wedge, name: "Wedges", supplier_code: null, pack_price: 9.95 }),
      ingredient({ id: ING.bacon, name: "Bacon", supplier_code: null, pack_price: 29.5 }),
      ingredient({ id: ING.bun, name: "Vegan Bun", supplier_code: null, pack_price: 50.4 }),
    ],
    cost_ingredient_deals: [],
    cost_price_log: [],
    ordering_products: [],
    ordering_suppliers: [],
    ordering_price_log: [],
  });
  f.installIngredientPriceTrigger(TODAY);
  return f;
}

const custom = (id: string, qid: string) => ({ questionId: qid, optionId: `custom:${id}`, note: JSON.stringify({ ingredient_id: id }) });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("answerQuestionsBatch", () => {
  it("records every answer, learns every match, and looks at the invoice ONCE", async () => {
    const f = setup();
    const eng = makeEngine();
    const r = await answerQuestionsBatch(
      f.sb,
      { actor: "mon@example.com", answers: [custom(ING.wedge, "Q1"), custom(ING.bacon, "Q2"), custom(ING.bun, "Q3"), { questionId: "Q4", optionId: "not_a_product" }] },
      { analyse: eng.analyse, today: TODAY },
    );
    expect(eng.state.calls).toBe(1);
    expect(r.ok).toBe(true);
    expect(r.saved).toBe(4);
    expect(r.results.map((x) => x.status)).toEqual(["saved", "saved", "saved", "saved"]);

    // every answer is recorded with who gave it
    expect(f.db.invoice_questions.filter((q) => q.status === "answered").map((q) => q.id).sort()).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(f.db.invoice_questions.find((q) => q.id === "Q1")).toMatchObject({ answered_by: "mon@example.com", answer: { option_id: `custom:${ING.wedge}` } });

    // every match is learned for the supplier and code (ingredient matches are shared across venues), the ignored one is remembered as rejected
    const maps = f.db.invoice_item_map;
    expect(maps).toHaveLength(4);
    expect(maps.find((m) => m.item_code === "8229")).toMatchObject({ supplier_id: IDS.supplier, ingredient_id: ING.wedge, rejected: false });
    expect(maps.find((m) => m.item_code === "8229")!.venue_id ?? null).toBeNull();
    expect(maps.find((m) => m.item_code === "187235")).toMatchObject({ ingredient_id: ING.bun, rejected: false });
    expect(maps.find((m) => m.item_code === "7366")).toMatchObject({ rejected: true });
    expect(maps.find((m) => m.item_code === "7366")!.ingredient_id ?? null).toBeNull();

    // the one look at the invoice used what was just learned
    const byNo = (n: number) => f.db.invoice_lines.find((l) => l.line_no === n)!;
    expect(byNo(1)).toMatchObject({ match_state: "matched", ingredient_id: ING.wedge });
    expect(byNo(3)).toMatchObject({ match_state: "matched", ingredient_id: ING.bun, decision: "needs_approval" });
    expect(byNo(4)).toMatchObject({ state: "ignored" });
    expect(f.db.invoice_questions.filter((q) => q.kind === "unmatched_line" && q.status === "open")).toHaveLength(0);

    // wedges 10.14 vs 9.95 and buns 41.64 vs 50.40 wait for a tap; bacon is the same price
    expect(r.message).toBe("Saved 3 matches. 1 line ignored. 2 prices ready to approve.");
  });

  it("looks at each of two invoices once", async () => {
    const f = setup();
    f.db.invoice_documents.push(document({ id: "doc-2", invoice_number: "999" }));
    f.db.invoice_lines.push({ ...unmatchedLine(1, "8229", "POTATO WEDGES", 10.14), id: "L21", document_id: "doc-2" });
    f.db.invoice_questions.push(question(21, { id: "Q21", document_id: "doc-2", line_id: "L21" }));
    const eng = makeEngine();
    const r = await answerQuestionsBatch(f.sb, { actor: "mon", answers: [custom(ING.wedge, "Q1"), custom(ING.bacon, "Q2"), custom(ING.wedge, "Q21")] }, { analyse: eng.analyse, today: TODAY });
    expect(r.saved).toBe(3);
    expect(eng.state.calls).toBe(2);
  });

  it("is safe to run again: an answered question is reported, not an error, and nothing is looked at twice", async () => {
    const f = setup();
    const eng = makeEngine();
    const answers = [custom(ING.wedge, "Q1"), custom(ING.bacon, "Q2")];
    await answerQuestionsBatch(f.sb, { actor: "mon", answers }, { analyse: eng.analyse, today: TODAY });
    const again = await answerQuestionsBatch(f.sb, { actor: "mon", answers }, { analyse: eng.analyse, today: TODAY });
    expect(again.ok).toBe(true);
    expect(again.results.map((x) => x.status)).toEqual(["already", "already"]);
    expect(again.message).toBe("2 lines were already answered.");
    expect(eng.state.calls).toBe(1);
    expect(f.db.invoice_item_map).toHaveLength(2);
  });

  it("reports a line that failed on its own and still saves the rest", async () => {
    const f = setup();
    const eng = makeEngine();
    const r = await answerQuestionsBatch(
      f.sb,
      { actor: "mon", answers: [custom(ING.wedge, "Q1"), custom("ing-gone", "Q2"), { questionId: "Q3", optionId: "custom:packs", note: JSON.stringify({ packs_per_unit: 6 }) }, { questionId: "Q-missing", optionId: "np" }] },
      { analyse: eng.analyse, today: TODAY },
    );
    expect(r.ok).toBe(false);
    expect(r.failed).toBe(3);
    const by = Object.fromEntries(r.results.map((x) => [x.questionId, x]));
    expect(by.Q1.status).toBe("saved");
    expect(by.Q2).toMatchObject({ status: "failed", ok: false });
    expect(by.Q2.message).toContain("could not be found");
    expect(by.Q3.message).toContain("does not fit this question");
    expect(by["Q-missing"].message).toContain("no longer exists");
    // the failed ones stay open; the good one is learned
    expect(f.db.invoice_questions.find((q) => q.id === "Q2")!.status).toBe("open");
    expect(f.db.invoice_item_map).toHaveLength(1);
    expect(r.message).toBe("Saved 1 match. 1 price ready to approve. 3 answers could not be saved.");
    expect(eng.state.calls).toBe(1);
  });

  it("checks a typed note exactly as a single answer does", async () => {
    const f = setup();
    const r = await answerQuestionsBatch(f.sb, { actor: "mon", answers: [{ questionId: "Q1", optionId: `custom:${ING.wedge}`, note: "not json" }, { questionId: "Q2", optionId: `custom:${ING.bacon}`, note: JSON.stringify({ ingredient_id: "someone-else" }) }] }, { analyse: makeEngine().analyse, today: TODAY });
    expect(r.results.map((x) => x.status)).toEqual(["failed", "failed"]);
    expect(r.results[0].message).toContain("could not be read");
    expect(f.db.invoice_item_map).toHaveLength(0);
  });

  it("Not In The App works on a question whose own list never offered it", async () => {
    const f = setup();
    f.db.invoice_questions[0].options = [{ id: "pick:x:none", label: "Wedges", ingredient_id: ING.wedge }];
    f.db.invoice_questions[0].kind = "ambiguous_match";
    const r = await answerQuestionsBatch(f.sb, { actor: "mon", answers: [{ questionId: "Q1", optionId: "not_a_product" }] }, { analyse: makeEngine().analyse, today: TODAY });
    expect(r.results[0].status).toBe("saved");
    expect(f.db.invoice_item_map[0]).toMatchObject({ item_code: "8229", rejected: true });
    // but not on a question about a unit or a price
    f.db.invoice_questions[1].kind = "unit_unclear";
    const r2 = await answerQuestionsBatch(f.sb, { actor: "mon", answers: [{ questionId: "Q2", optionId: "not_a_product" }] }, { analyse: makeEngine().analyse, today: TODAY });
    expect(r2.results[0].status).toBe("failed");
  });

  it("answers about the invoice itself go first, so a match that needs the supplier finds it", async () => {
    const f = setup({
      doc: { supplier_id: null, supplier_name_read: "Bidfood Sunshine Coast", supplier_abn_read: "12345678901" },
      extraQuestions: [{ id: "QS", venue_id: 1, document_id: IDS.doc, line_id: null, kind: "new_supplier", prompt: "New supplier?", status: "open", options: [{ id: "add_supplier", label: "Yes, add them" }] }],
    });
    const r = await answerQuestionsBatch(f.sb, { actor: "mon", answers: [custom(ING.wedge, "Q1"), { questionId: "QS", optionId: "add_supplier" }] }, { analyse: makeEngine().analyse, today: TODAY });
    expect(r.results.map((x) => x.status).sort()).toEqual(["saved", "saved"]);
    const doc = f.db.invoice_documents[0];
    expect(doc.supplier_id).toBeTruthy();
    expect(f.db.invoice_item_map[0]).toMatchObject({ supplier_id: doc.supplier_id, ingredient_id: ING.wedge });
  });

  it("does not look at an invoice again after it was set aside", async () => {
    const f = setup({ extraQuestions: [{ id: "QD", venue_id: 1, document_id: IDS.doc, line_id: null, kind: "totals_mismatch", prompt: "x", status: "open", options: [{ id: "ignore_document", label: "Ignore this invoice", action: "ignore_document" }] }] });
    const eng = makeEngine();
    const r = await answerQuestionsBatch(f.sb, { actor: "mon", answers: [custom(ING.wedge, "Q1"), { questionId: "QD", optionId: "ignore_document" }] }, { analyse: eng.analyse, today: TODAY });
    expect(r.saved).toBe(2);
    expect(eng.state.calls).toBe(0);
    expect(f.db.invoice_documents[0].status).toBe("ignored");
  });

  it("counts a question only once when it is listed twice, and does nothing for an empty list", async () => {
    const f = setup();
    const r = await answerQuestionsBatch(f.sb, { actor: "mon", answers: [custom(ING.wedge, "Q1"), custom(ING.bacon, "Q1")] }, { analyse: makeEngine().analyse, today: TODAY });
    expect(r.results).toHaveLength(1);
    expect(f.db.invoice_item_map[0].ingredient_id).toBe(ING.wedge);
    const none = await answerQuestionsBatch(f.sb, { actor: "mon", answers: [] }, {});
    expect(none).toMatchObject({ ok: true, message: "Nothing was saved.", results: [] });
  });

  it("keeps an answer even when the look at the invoice fails", async () => {
    const f = setup();
    const boom: AnalyseInvoice = () => {
      throw new Error("engine down");
    };
    const r = await answerQuestionsBatch(f.sb, { actor: "mon", answers: [custom(ING.wedge, "Q1")] }, { analyse: boom, today: TODAY });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("could not be checked again");
    expect(f.db.invoice_item_map).toHaveLength(1);
  });

  it("learns exactly what answerQuestion would have learned", async () => {
    const a = setup();
    await answerQuestion(a.sb, { questionId: "Q1", optionId: `custom:${ING.wedge}`, actor: "mon", note: JSON.stringify({ ingredient_id: ING.wedge }) }, { analyse: makeEngine().analyse, today: TODAY });
    const b = setup();
    await answerQuestionsBatch(b.sb, { actor: "mon", answers: [custom(ING.wedge, "Q1")] }, { analyse: makeEngine().analyse, today: TODAY });
    const strip = (rows: Record<string, any>[]) => rows.map(({ id, ...rest }) => rest);
    expect(strip(b.db.invoice_item_map)).toEqual(strip(a.db.invoice_item_map));
    expect(b.db.invoice_questions[0].answer).toEqual(a.db.invoice_questions[0].answer);
  });
});

describe("batchMessage", () => {
  const zero = { matches: 0, ignored: 0, approved: 0, other: 0, already: 0, failed: 0, waiting: 0, autoApplied: 0 };
  it("says only what happened, in the right numbers", () => {
    expect(batchMessage({ ...zero, matches: 9, ignored: 3, waiting: 2 })).toBe("Saved 9 matches. 3 lines ignored. 2 prices ready to approve.");
    expect(batchMessage({ ...zero, matches: 1, ignored: 1, waiting: 1 })).toBe("Saved 1 match. 1 line ignored. 1 price ready to approve.");
    expect(batchMessage({ ...zero, ignored: 4 })).toBe("4 lines ignored.");
    expect(batchMessage({ ...zero, matches: 2, autoApplied: 1, other: 1, approved: 1 })).toBe("Saved 2 matches. 1 price approved. 1 other answer saved. 1 price applied automatically.");
    expect(batchMessage({ ...zero, already: 1 })).toBe("1 line was already answered.");
    expect(batchMessage(zero)).toBe("Nothing was saved.");
  });
  it("has no em or en dashes", () => {
    expect(batchMessage({ ...zero, matches: 3, ignored: 2, already: 1, failed: 1, waiting: 2 })).not.toMatch(/[–—]/);
  });
});
