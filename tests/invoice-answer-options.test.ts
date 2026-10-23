import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerQuestion } from "../lib/invoice-answer";
import { loadAnalyseContext } from "../lib/invoice-context";
import { analyseInvoice } from "../lib/invoice-engine";
import type { AnalyseInvoice } from "../lib/invoice-interfaces";
import { saveAnalysis } from "../lib/invoice-store";
import type { InvoiceAnalysis, QuestionOption } from "../lib/invoice-types";
import { createFakeSupabase, type FakeSupabase } from "./helpers/fake-supabase";
import { document, ingredient, IDS, line, SUPPLIER, VENUES } from "./helpers/invoice-fixtures";
import { ING_BARRA, ING_KINGFISH, danielStreet51329Fixed, seededRules, supplierDS } from "./fixtures/invoice-fixtures";

const NOW = new Date("2026-10-24T02:00:00Z");
const TODAY = "2026-10-24";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

/** An engine that changes nothing and records what it was given, so the tests can see what an answer passes on. */
function recorder() {
  const seen: Record<string, unknown>[] = [];
  const analyse: AnalyseInvoice = (_ex, ctx) => {
    seen.push({ venueConfirmed: (ctx as any).venueConfirmed, supplierConfirmed: (ctx as any).supplierConfirmed, existing: ctx.existingDocs.length });
    return {
      supplier_id: ctx.suppliers[0]?.id ?? null, new_supplier: null, venue_check: "ok", price_basis: "ex", reconciled: true, recon_notes: [], fee_pool_ex: 0, lines: [], questions: [],
      duplicate_of: null, mode: "learning", status: "needs_review", summary: { products: 0, matched: 0, same: 0, to_apply: 0, need_approval: 0, unmatched: 0 },
    } satisfies InvoiceAnalysis;
  };
  return { analyse, seen };
}

const q = (id: string, kind: string, options: QuestionOption[], over: Record<string, any> = {}) => ({
  id, venue_id: 1, document_id: IDS.doc, line_id: "L1", kind, prompt: "?", status: "open", options, answer: null, ...over,
});

function setup(over: { doc?: Record<string, any>; lines?: Record<string, any>[]; questions?: Record<string, any>[]; suppliers?: Record<string, any>[]; rules?: Record<string, any>[] } = {}): FakeSupabase {
  const f = createFakeSupabase({
    cost_venues: VENUES,
    cost_settings: [{ key: "gst_rate", value: 0.1 }],
    invoice_suppliers: over.suppliers ?? [SUPPLIER],
    invoice_files: [{ id: "file-1", venue_id: 1, storage_path: "x.pdf", sha256: "abc", status: "done", attempts: 2 }],
    invoice_documents: [document(over.doc)],
    invoice_lines: over.lines ?? [line({ id: "L1" })],
    invoice_questions: over.questions ?? [],
    invoice_item_map: [],
    invoice_charge_rules: over.rules ?? [],
    cost_ingredients: [ingredient(), ingredient({ id: IDS.lychee, name: "Lychee Liqueur", pack_price: 38.62 })],
    cost_ingredient_deals: [],
    ordering_products: [],
    ordering_suppliers: [],
  });
  return f;
}
const ask = (f: FakeSupabase, id: string, optionId: string, note?: string, analyse?: AnalyseInvoice) =>
  answerQuestion(f.sb, { questionId: id, optionId, actor: "mon@example.com", note }, { analyse: analyse ?? recorder().analyse, today: TODAY });

// ================================================================================================== packs:<n>
describe("packs:<n> (unit_unclear)", () => {
  const opts: QuestionOption[] = [{ id: "packs:12", label: "12 per carton", packs_per_unit: 12 }, { id: "ignore_line", label: "Ignore this line", action: "ignore_line" }];

  it("saves the pack count against the line's own match and says so", async () => {
    const f = setup({ questions: [q("Q1", "unit_unclear", opts)], lines: [line({ id: "L1", unit: "CTN" })] });
    const r = await ask(f, "Q1", "packs:12");
    expect(r.ok).toBe(true);
    expect(r.message).toBe("Saved. Daniel Street Fish Market code 15026 is counted as 12 per carton.");
    expect(f.db.invoice_item_map).toHaveLength(1);
    expect(f.db.invoice_item_map[0]).toMatchObject({ supplier_id: IDS.supplier, item_code: "15026", ingredient_id: IDS.kingfish, packs_per_unit: 12, rejected: false });
    expect(f.db.invoice_questions[0].status).toBe("answered");
  });

  it("updates the pack count of a match that already exists", async () => {
    const f = setup({ questions: [q("Q1", "unit_unclear", opts)] });
    f.db.invoice_item_map.push({ id: "m1", supplier_id: IDS.supplier, venue_id: null, item_code: "15026", desc_key: null, ingredient_id: IDS.kingfish, product_id: null, packs_per_unit: 1, rejected: false });
    await ask(f, "Q1", "packs:12");
    expect(f.db.invoice_item_map).toHaveLength(1);
    expect(f.db.invoice_item_map[0]).toMatchObject({ id: "m1", packs_per_unit: 12 });
  });

  it("an ordering product's line is remembered for that venue", async () => {
    const f = setup({ questions: [q("Q1", "unit_unclear", opts)], lines: [line({ id: "L1", ingredient_id: null, product_id: "prod-9" })] });
    await ask(f, "Q1", "packs:12");
    expect(f.db.invoice_item_map[0]).toMatchObject({ venue_id: 1, product_id: "prod-9", packs_per_unit: 12 });
  });

  it("refuses when the line is not matched to anything, and leaves the question open", async () => {
    const f = setup({ questions: [q("Q1", "unit_unclear", opts)], lines: [line({ id: "L1", match_state: "unmatched", ingredient_id: null })] });
    const r = await ask(f, "Q1", "packs:12");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("not matched to a product");
    expect(f.db.invoice_item_map).toHaveLength(0);
    expect(f.db.invoice_questions[0].status).toBe("open");
  });
});

// ================================================================================================== supplier answers
describe("supplier:<id>", () => {
  const opts: QuestionOption[] = [{ id: `supplier:${IDS.supplier}`, label: "Daniel Street Fish Market" }, { id: "add_supplier", label: "Add a new supplier" }];
  const sq = () => q("Q1", "new_supplier", opts, { line_id: null });
  const read = { supplier_name_read: "D Street Fish Mkt", supplier_abn_read: "61 151 388 094", supplier_id: null };

  it("records the name as it is written as an alias, fills a missing ABN and attaches the invoice", async () => {
    const f = setup({ suppliers: [{ ...SUPPLIER, abn: null }], doc: read, questions: [sq()] });
    const r = await ask(f, "Q1", `supplier:${IDS.supplier}`);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('"D Street Fish Mkt" is recorded as Daniel Street Fish Market');
    expect(f.db.invoice_suppliers[0]).toMatchObject({ aliases: ["D Street Fish Mkt"], abn: "61151388094" });
    expect(f.db.invoice_documents[0].supplier_id).toBe(IDS.supplier);
  });

  it("adds no duplicate alias (any case), no alias equal to the name, and never overwrites an ABN", async () => {
    const f = setup({ suppliers: [{ ...SUPPLIER, aliases: ["d street fish mkt"] }], doc: read, questions: [sq()] });
    await ask(f, "Q1", `supplier:${IDS.supplier}`);
    expect(f.db.invoice_suppliers[0].aliases).toEqual(["d street fish mkt"]);
    expect(f.db.invoice_suppliers[0].abn).toBe("61151388094");
    const g = setup({ doc: { ...read, supplier_name_read: "daniel street fish market" }, questions: [sq()] });
    await ask(g, "Q1", `supplier:${IDS.supplier}`);
    expect(g.db.invoice_suppliers[0].aliases).toEqual([]);
  });

  it("does not take an ABN another supplier already has", async () => {
    const other = { id: "sup-other", name: "Other Fish", abn: "61151388094", aliases: [], active: true };
    const f = setup({ suppliers: [{ ...SUPPLIER, abn: null }, other], doc: read, questions: [sq()] });
    await ask(f, "Q1", `supplier:${IDS.supplier}`);
    expect(f.db.invoice_suppliers[0].abn ?? null).toBeNull();
  });

  it("fails plainly when that supplier is gone", async () => {
    const f = setup({ doc: read, questions: [q("Q1", "new_supplier", [{ id: "supplier:gone", label: "Gone" }], { line_id: null })] });
    const r = await ask(f, "Q1", "supplier:gone");
    expect(r.ok).toBe(false);
    expect(f.db.invoice_questions[0].status).toBe("open");
  });
});

describe("add_supplier and same_supplier", () => {
  const opts: QuestionOption[] = [{ id: "add_supplier", label: "Yes, add them" }, { id: "same_supplier", label: "Same supplier" }];
  const nq = () => q("Q1", "new_supplier", opts, { line_id: null });

  it("add_supplier only records the answer when the supplier already exists", async () => {
    const f = setup({ questions: [nq()] });
    const r = await ask(f, "Q1", "add_supplier");
    expect(r.ok).toBe(true);
    expect(f.db.invoice_suppliers).toHaveLength(1);
    expect(f.db.invoice_questions[0].status).toBe("answered");
  });

  it("add_supplier creates the supplier from the name and ABN read when the invoice still has none", async () => {
    const f = setup({ suppliers: [], doc: { supplier_id: null, supplier_name_read: "CD Australia Pty Ltd", supplier_abn_read: "12 345 678 901" }, questions: [nq()] });
    const r = await ask(f, "Q1", "add_supplier");
    expect(r.ok).toBe(true);
    expect(f.db.invoice_suppliers).toHaveLength(1);
    expect(f.db.invoice_suppliers[0]).toMatchObject({ name: "CD Australia Pty Ltd", abn: "12345678901" });
    expect(f.db.invoice_documents[0].supplier_id).toBe(f.db.invoice_suppliers[0].id);
  });

  it("add_supplier reuses a supplier with that ABN instead of adding a second", async () => {
    const f = setup({ doc: { supplier_id: null }, questions: [nq()] });
    await ask(f, "Q1", "add_supplier");
    expect(f.db.invoice_suppliers).toHaveLength(1);
    expect(f.db.invoice_documents[0].supplier_id).toBe(IDS.supplier);
  });

  it("same_supplier is passed to the engine on this look and on every later one", async () => {
    const f = setup({ questions: [nq()] });
    const rec = recorder();
    await ask(f, "Q1", "same_supplier", undefined, rec.analyse);
    f.db.invoice_questions.push(q("Q2", "credit_unclear", [{ id: "approve_change", label: "Go on" }], { line_id: null })); // a later question, answered later
    await ask(f, "Q2", "approve_change", undefined, rec.analyse);
    expect(rec.seen).toHaveLength(2);
    expect(rec.seen.map((s) => s.supplierConfirmed)).toEqual([true, true]);
    expect(rec.seen.map((s) => s.venueConfirmed)).toEqual([false, false]);
  });

  it("is not confirmed when a different option was chosen", async () => {
    const f = setup({ questions: [nq()] });
    const rec = recorder();
    await ask(f, "Q1", "add_supplier", undefined, rec.analyse);
    expect(rec.seen[0].supplierConfirmed).toBe(false);
  });

  it("confirm_venue is passed to the engine as a flag, and the scan text is left alone", async () => {
    const f = setup({ doc: { bill_to: "SOME OTHER CAFE", ship_to: null }, questions: [q("Q1", "venue_mismatch", [{ id: "confirm_venue", label: "Yes", action: "confirm_venue" }], { line_id: null })] });
    const rec = recorder();
    await ask(f, "Q1", "confirm_venue", undefined, rec.analyse);
    expect(rec.seen[0].venueConfirmed).toBe(true);
    expect(f.db.invoice_documents[0].bill_to).toBe("SOME OTHER CAFE");
  });
});

// ================================================================================================== charges
describe("spread_charge and leave_out_charge", () => {
  const delivery = line({ id: "L1", line_no: 4, line_class: "fee", item_code: "99000", description: "  Fuel Recovery Charge Over $200  ", match_state: "unmatched", ingredient_id: null, decision: "none" });
  const opts: QuestionOption[] = [{ id: "spread_charge", label: "Yes, spread it" }, { id: "leave_out_charge", label: "No, leave it out", action: "not_a_product" }];
  const cq = () => q("Q1", "other", opts, { line_id: "L1" });

  it("spread_charge saves a supplier rule that spreads, then looks at the invoice again", async () => {
    const f = setup({ lines: [delivery], questions: [cq()] });
    const rec = recorder();
    const r = await ask(f, "Q1", "spread_charge", undefined, rec.analyse);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('"Fuel Recovery Charge Over $200" will be spread over the products');
    expect(f.db.invoice_charge_rules).toHaveLength(1);
    expect(f.db.invoice_charge_rules[0]).toMatchObject({ supplier_id: IDS.supplier, match_text: "fuel recovery charge over $200", line_class: "fee", spread: true, note: "Added from an answer", active: true });
    expect(rec.seen).toHaveLength(1);
    expect(f.db.invoice_item_map).toHaveLength(0);
  });

  it("keeps a delivery, fee, discount or deposit class, and turns an unclear one into a fee so the spread works", async () => {
    for (const [cls, expected] of [["delivery", "delivery"], ["discount", "discount"], ["deposit", "deposit"], ["other", "fee"], ["product", "fee"]] as const) {
      const f = setup({ lines: [{ ...delivery, line_class: cls }], questions: [cq()] });
      await ask(f, "Q1", "spread_charge");
      expect(f.db.invoice_charge_rules[0].line_class, cls).toBe(expected);
    }
  });

  it("cuts the rule text to 60 characters", async () => {
    const f = setup({ lines: [{ ...delivery, description: "A".repeat(90) }], questions: [cq()] });
    await ask(f, "Q1", "spread_charge");
    expect(f.db.invoice_charge_rules[0].match_text).toBe("a".repeat(60));
  });

  it("does not add a rule that already exists", async () => {
    const f = setup({
      lines: [delivery],
      questions: [cq()],
      rules: [{ id: "r1", supplier_id: IDS.supplier, match_text: "fuel recovery charge over $200", line_class: "fee", spread: true, note: null, active: true }],
    });
    const r = await ask(f, "Q1", "spread_charge");
    expect(r.ok).toBe(true);
    expect(f.db.invoice_charge_rules).toHaveLength(1);
  });

  it("leave_out_charge saves a rule that leaves it out, with no rejected map row and no ignored line", async () => {
    const f = setup({ lines: [delivery], questions: [cq()] });
    const r = await ask(f, "Q1", "leave_out_charge");
    expect(r.ok).toBe(true);
    expect(r.message).toContain("will be left out of cost");
    expect(f.db.invoice_charge_rules[0]).toMatchObject({ supplier_id: IDS.supplier, line_class: "other", spread: false });
    expect(f.db.invoice_item_map).toHaveLength(0);
    expect(f.log.filter((l) => l.table === "invoice_lines" && l.op === "update")).toHaveLength(0);
  });

  it("refuses to make a rule for an invoice with no supplier (it would apply to every supplier)", async () => {
    const f = setup({ doc: { supplier_id: null }, lines: [delivery], questions: [cq()] });
    const r = await ask(f, "Q1", "spread_charge");
    expect(r.ok).toBe(false);
    expect(f.db.invoice_charge_rules).toHaveLength(0);
    expect(f.db.invoice_questions[0].status).toBe("open");
  });
});

describe("credit_leave", () => {
  it("records the answer and does not look at the invoice again", async () => {
    const f = setup({ questions: [q("Q1", "credit_unclear", [{ id: "credit_leave", label: "Not sure" }])] });
    const rec = recorder();
    const r = await ask(f, "Q1", "credit_leave", undefined, rec.analyse);
    expect(r.ok).toBe(true);
    expect(rec.seen).toHaveLength(0);
    expect(f.db.invoice_questions[0]).toMatchObject({ status: "answered", answer: { option_id: "credit_leave" } });
  });
});

// ================================================================================================== what the screens send
describe("custom:<ingredientId> from the search box", () => {
  const unmatched = () => q("Q1", "unmatched_line", [{ id: `pick:${IDS.kingfish}:none`, label: "Kingfish", ingredient_id: IDS.kingfish }]);
  const unmatchedLine = () => line({ id: "L1", match_state: "unmatched", match_method: null, ingredient_id: null, packs_per_unit: null });

  it("is a match to that ingredient, with the pack size from the note", async () => {
    const f = setup({ lines: [unmatchedLine()], questions: [unmatched()] });
    const note = JSON.stringify({ ingredient_id: IDS.lychee, packs_per_unit: 6 });
    const rec = recorder();
    const r = await ask(f, "Q1", `custom:${IDS.lychee}`, note, rec.analyse);
    expect(r.ok).toBe(true);
    expect(r.message).toBe("Saved. Daniel Street Fish Market code 15026 is now Lychee Liqueur.");
    expect(f.db.invoice_item_map[0]).toMatchObject({ supplier_id: IDS.supplier, item_code: "15026", ingredient_id: IDS.lychee, packs_per_unit: 6, rejected: false });
    expect(f.db.invoice_questions[0]).toMatchObject({ status: "answered", answer: { option_id: `custom:${IDS.lychee}`, note } }); // stored unchanged
    expect(rec.seen).toHaveLength(1);
  });

  it("uses the line's pack count when the note has none, else stores NO pack count (never 1); works for ambiguous_match too", async () => {
    const f = setup({ lines: [{ ...unmatchedLine(), packs_per_unit: 24 }], questions: [{ ...unmatched(), kind: "ambiguous_match" }] });
    await ask(f, "Q1", `custom:${IDS.lychee}`, JSON.stringify({ ingredient_id: IDS.lychee }));
    expect(f.db.invoice_item_map[0].packs_per_unit).toBe(24);
    const g = setup({ lines: [unmatchedLine()], questions: [unmatched()] });
    await ask(g, "Q1", `custom:${IDS.lychee}`); // no note at all
    expect(g.db.invoice_item_map[0].packs_per_unit ?? null).toBeNull(); // nobody stated it, so the engine asks the unit question
  });

  it("checks that the ingredient exists", async () => {
    const f = setup({ lines: [unmatchedLine()], questions: [unmatched()] });
    const r = await ask(f, "Q1", "custom:nope", JSON.stringify({ ingredient_id: "nope" }));
    expect(r.ok).toBe(false);
    expect(r.message).toContain("could not be found");
    expect(f.db.invoice_item_map).toHaveLength(0);
    expect(f.db.invoice_questions[0].status).toBe("open");
  });

  it("refuses a note that names a different ingredient than the option id", async () => {
    const f = setup({ lines: [unmatchedLine()], questions: [unmatched()] });
    const r = await ask(f, "Q1", `custom:${IDS.lychee}`, JSON.stringify({ ingredient_id: IDS.kingfish }));
    expect(r.ok).toBe(false);
    expect(f.db.invoice_item_map).toHaveLength(0);
  });

  it("refuses a note that is not JSON, and a pack size that is not a positive number", async () => {
    for (const note of ["not json", "[1]", '"x"', JSON.stringify({ packs_per_unit: 0 }), JSON.stringify({ packs_per_unit: -3 }), JSON.stringify({ packs_per_unit: "12" }), JSON.stringify({ packs_per_unit: 1e9 })]) {
      const f = setup({ lines: [unmatchedLine()], questions: [unmatched()] });
      const r = await ask(f, "Q1", `custom:${IDS.lychee}`, note);
      expect(r.ok, note).toBe(false);
      expect(f.db.invoice_item_map, note).toHaveLength(0);
      expect(f.db.invoice_questions[0].status, note).toBe("open");
    }
  });

  it("is refused on any other kind of question", async () => {
    for (const kind of ["unit_unclear", "big_change", "new_supplier", "other", "credit_unclear"]) {
      const f = setup({ lines: [unmatchedLine()], questions: [{ ...unmatched(), kind }] });
      const r = await ask(f, "Q1", `custom:${IDS.lychee}`, JSON.stringify({ ingredient_id: IDS.lychee }));
      expect(r.ok, kind).toBe(false);
      expect(r.message, kind).toContain("does not fit this question");
      expect(f.db.invoice_item_map).toHaveLength(0);
    }
  });
});

describe("custom:packs from the pack size box", () => {
  const uq = (kind = "unit_unclear") => q("Q1", kind, [{ id: "packs:12", label: "12 per carton", packs_per_unit: 12 }]);

  it("acts exactly like packs:<n> on the line's existing match", async () => {
    const f = setup({ questions: [uq()], lines: [line({ id: "L1", unit: "CTN" })] });
    const r = await ask(f, "Q1", "custom:packs", '{"packs_per_unit":12}');
    expect(r.ok).toBe(true);
    expect(r.message).toBe("Saved. Daniel Street Fish Market code 15026 is counted as 12 per ctn.");
    expect(f.db.invoice_item_map[0]).toMatchObject({ item_code: "15026", ingredient_id: IDS.kingfish, packs_per_unit: 12 });
    expect(f.db.invoice_questions[0].answer).toEqual({ option_id: "custom:packs", note: '{"packs_per_unit":12}' });
  });

  it("is refused on a kind other than unit_unclear, with no pack size, or with a bad one", async () => {
    const cases: [string, string | undefined][] = [["big_change", '{"packs_per_unit":12}'], ["unit_unclear", undefined], ["unit_unclear", "{}"], ["unit_unclear", '{"packs_per_unit":0}'], ["unit_unclear", '{"packs_per_unit":"x"}'], ["unit_unclear", "oops"]];
    for (const [kind, note] of cases) {
      const f = setup({ questions: [uq(kind)] });
      const r = await ask(f, "Q1", "custom:packs", note);
      expect(r.ok, `${kind} ${note}`).toBe(false);
      expect(f.db.invoice_item_map).toHaveLength(0);
      expect(f.db.invoice_questions[0].status).toBe("open");
    }
  });
});

// ================================================================================================== end to end with the real engine
describe("end to end with the real analyseInvoice (Daniel Street #51329)", () => {
  /** The database as the app has it: the engine's own fixture suppliers, rules and ingredients, in learning mode (no setting rows). */
  async function filed(ings: Record<string, any>[], tweak?: (e: ReturnType<typeof danielStreet51329Fixed>) => void) {
    const f = createFakeSupabase({
      cost_venues: VENUES,
      cost_settings: [{ key: "gst_rate", value: 0.1 }],
      invoice_suppliers: [supplierDS()],
      invoice_files: [{ id: "file-1", venue_id: 1, storage_path: "x.pdf", sha256: "abc", status: "done", attempts: 1 }],
      invoice_documents: [],
      invoice_lines: [],
      invoice_questions: [],
      invoice_item_map: [],
      invoice_charge_rules: seededRules(),
      cost_ingredients: ings,
      cost_ingredient_deals: [],
      ordering_products: [],
      ordering_suppliers: [],
      cost_price_log: [],
    });
    f.installIngredientPriceTrigger(TODAY);
    const ctx = await loadAnalyseContext(f.sb, { venueId: 1, folderVenueId: 1, today: TODAY });
    const extracted = danielStreet51329Fixed();
    tweak?.(extracted);
    const analysis = analyseInvoice(extracted, ctx);
    const saved = await saveAnalysis(f.sb, { fileId: "file-1", venueId: 1, extracted, analysis, pagePdfPath: null, readModel: "test", documentId: undefined });
    return { f, saved, analysis };
  }
  const dbIng = (i: typeof ING_KINGFISH, over: Record<string, any> = {}) => ({ ...i, category: "Food", ...over });
  const real = { analyse: analyseInvoice, today: TODAY };
  const openQs = (f: FakeSupabase, kind: string) => f.db.invoice_questions.filter((x) => x.kind === kind && x.status === "open");

  it("an unmatched line: ask, answer from the search box, learn the code, match it, apply nothing in learning mode", async () => {
    const { f, saved } = await filed([dbIng(ING_KINGFISH, { supplier_code: null }), dbIng(ING_BARRA)]);
    expect(saved.status).toBe("needs_review");
    const [question] = openQs(f, "unmatched_line");
    expect(question).toBeTruthy();
    const kingfishLine = f.db.invoice_lines.find((l) => l.line_no === 1)!;
    expect(kingfishLine.match_state).not.toBe("matched");
    expect(question.line_id).toBe(kingfishLine.id);

    const note = JSON.stringify({ ingredient_id: "ing-kingfish" });
    const r = await answerQuestion(f.sb, { questionId: question.id, optionId: "custom:ing-kingfish", actor: "mon@example.com", note }, real);
    expect(r.ok).toBe(true);
    expect(r.message).toContain("code 15026 is now");

    expect(f.db.invoice_item_map).toHaveLength(1);
    expect(f.db.invoice_item_map[0]).toMatchObject({ supplier_id: "sup-daniel-street", item_code: "15026", ingredient_id: "ing-kingfish", created_by: "mon@example.com" });

    const after = f.db.invoice_lines.find((l) => l.line_no === 1)!;
    expect(after).toMatchObject({ match_state: "matched", ingredient_id: "ing-kingfish", old_pack_price: 66.5, new_pack_price: 68.9, state: "open" });
    expect(after.decision).not.toBe("apply"); // learning mode: every price waits for a tap
    expect(after.map_id).toBeTruthy();
    expect(f.db.invoice_lines.filter((l) => l.line_no === 1)).toHaveLength(1);

    // answered once, never asked again
    expect(openQs(f, "unmatched_line")).toHaveLength(0);
    expect(f.db.invoice_questions.find((x) => x.id === question.id)!.status).toBe("answered");
    // and nothing was written to any price
    expect(f.db.cost_ingredients.find((i) => i.id === "ing-kingfish")!.pack_price).toBe(66.5);
    expect(f.db.invoice_price_changes ?? []).toHaveLength(0);
    expect(f.db.cost_price_log).toHaveLength(0);
    expect(f.db.invoice_documents[0].status).toBe("needs_review");
  });

  it("a unit question: answer the pack size, and the line gets packs_per_unit and a decision (still nothing applied)", async () => {
    // a fillet counted as "each" cannot be priced by the kilo without being told how many are in a kilo
    const { f } = await filed([dbIng(ING_KINGFISH, { pack_unit: "each", pack_size: 1 }), dbIng(ING_BARRA)]);
    const [question] = openQs(f, "unit_unclear");
    expect(question).toBeTruthy();
    const before = f.db.invoice_lines.find((l) => l.line_no === 1)!;
    expect(before.packs_per_unit ?? null).toBeNull();
    expect(before.match_state).toBe("matched");

    const r = await answerQuestion(f.sb, { questionId: question.id, optionId: "custom:packs", actor: "mon@example.com", note: '{"packs_per_unit":2}' }, real);
    expect(r.ok).toBe(true);
    expect(r.message).toContain("is counted as 2 per kg");

    expect(f.db.invoice_item_map).toHaveLength(1);
    expect(f.db.invoice_item_map[0]).toMatchObject({ item_code: "15026", ingredient_id: "ing-kingfish", packs_per_unit: 2 });

    const after = f.db.invoice_lines.find((l) => l.line_no === 1)!;
    expect(after.packs_per_unit).toBe(2);
    expect(after.base_unit).toBeTruthy();
    expect(["apply", "needs_approval", "same", "skip", "none"]).toContain(after.decision);
    expect(after.decision).not.toBe("apply"); // learning mode
    expect(after.state).toBe("open");
    expect(openQs(f, "unit_unclear")).toHaveLength(0); // not asked again
    expect(f.db.cost_ingredients.find((i) => i.id === "ing-kingfish")!.pack_price).toBe(66.5);
    expect(f.db.invoice_price_changes ?? []).toHaveLength(0);
  });

  it("a unit question answered with one of the engine's own options does the same", async () => {
    const { f } = await filed([dbIng(ING_KINGFISH, { pack_unit: "each", pack_size: 1 }), dbIng(ING_BARRA)]);
    const [question] = openQs(f, "unit_unclear");
    const r = await answerQuestion(f.sb, { questionId: question.id, optionId: "packs:6", actor: "mon" }, real);
    expect(r.ok).toBe(true);
    expect(f.db.invoice_lines.find((l) => l.line_no === 1)!.packs_per_unit).toBe(6);
    expect(openQs(f, "unit_unclear")).toHaveLength(0);
  });

  it("the same supplier under a different ABN: ask once, confirm, and the lines are no longer held back", async () => {
    const { f } = await filed([dbIng(ING_KINGFISH), dbIng(ING_BARRA)], (e) => {
      e.supplier_abn = "99999999999";
    });
    const [question] = openQs(f, "new_supplier");
    expect(question).toBeTruthy();
    const heldBack = f.db.invoice_lines.filter((l) => l.line_class === "product").every((l) => l.decision === "none" || l.decision === "skip" || l.decision === "needs_approval");
    expect(heldBack).toBe(true);
    const r = await answerQuestion(f.sb, { questionId: question.id, optionId: "same_supplier", actor: "mon" }, real);
    expect(r.ok).toBe(true);
    expect(openQs(f, "new_supplier")).toHaveLength(0); // not asked again
    // another answer on the same invoice replays the confirmation instead of asking again
    const other = f.db.invoice_questions.find((x) => x.status === "open");
    if (other) {
      const opt = other.options[0];
      await answerQuestion(f.sb, { questionId: other.id, optionId: opt.id, actor: "mon" }, real);
    }
    expect(openQs(f, "new_supplier")).toHaveLength(0);
  });
});
