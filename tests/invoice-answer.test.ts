import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerQuestion, descKey, extractedFromStored } from "../lib/invoice-answer";
import type { AnalyseInvoice } from "../lib/invoice-interfaces";
import type { AnalysedLine, AnalysedQuestion, ExtractedInvoice, InvoiceAnalysis, InvoiceLineRow } from "../lib/invoice-types";
import { createFakeSupabase, type FakeSupabase } from "./helpers/fake-supabase";
import { document, ingredient, IDS, line, SETTINGS_AUTO, SUPPLIER, VENUES } from "./helpers/invoice-fixtures";

const NOW = new Date("2026-10-24T02:00:00Z");
const TODAY = "2026-10-24";

/**
 * A stand-in engine, just enough to exercise the answer flow: it matches a line by the learned map (code, else description),
 * compares with the ingredient's price, decides like the real rules (apply under 5% outside learning mode, else approval),
 * checks the venue by text, flags a duplicate, and asks about what it cannot match.
 */
const fakeEngine: AnalyseInvoice = (ex: ExtractedInvoice, ctx): InvoiceAnalysis => {
  const supplier = ctx.suppliers.find((s) => s.abn === ex.supplier_abn || s.name === ex.supplier_name) ?? null;
  const venue = ctx.venueNames.find((v) => v.id === ctx.venueId)!;
  const text = `${ex.bill_to ?? ""} ${ex.ship_to ?? ""}`.toLowerCase();
  const venue_check = text.trim() === "" ? "unknown" : [venue.name, ...venue.aliases].some((n) => text.includes(n.toLowerCase())) ? "ok" : "mismatch";
  const dup = ctx.existingDocs.find((d) => d.venue_id === ctx.venueId && d.supplier_id === supplier?.id && d.invoice_number === ex.invoice_number);
  const lines: AnalysedLine[] = [];
  const questions: AnalysedQuestion[] = [];
  ex.lines.forEach((l, i) => {
    const key = (l.description ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
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
    } else if (ing && l.unit_price !== null && l.line_class !== "delivery") {
      const change = (l.unit_price - ing.pack_price) / ing.pack_price;
      const small = Math.abs(change) < ctx.settings.autoApplyPct;
      const decision = Math.abs(change) < 1e-9 ? "same" : small && !ctx.settings.learningMode && venue_check === "ok" ? "apply" : "needs_approval";
      lines.push({ ...base, match_state: "matched", match_method: "human", map_id: map!.id, ingredient_id: ing.id, packs_per_unit: map!.packs_per_unit, old_pack_price: ing.pack_price, new_pack_price: l.unit_price, change_pct: change, decision, decision_reason: decision === "needs_approval" ? "Waits for a tap" : null });
      if (decision === "needs_approval" && !small) questions.push({ kind: "big_change", line_no: l.line_no, prompt: "Big change", options: [{ id: "yes", label: "Approve This Price", action: "approve_change" }, { id: "no", label: "Leave It", action: "reject_change" }] });
    } else if ((l.class_hint ?? "product") === "product") {
      lines.push({ ...base, match_state: "unmatched", match_method: null, map_id: null, ingredient_id: null, packs_per_unit: null, old_pack_price: null, new_pack_price: null, change_pct: null, decision: "none", decision_reason: "Not matched" });
      questions.push({ kind: "unmatched_line", line_no: l.line_no, prompt: `Which product is ${l.description}?`, options: [{ id: "kf", label: "Kingfish Fillets", ingredient_id: IDS.kingfish }, { id: "ly", label: "Lychee Liqueur", ingredient_id: IDS.lychee, packs_per_unit: 1 }, { id: "np", label: "Not a product", action: "not_a_product" }, { id: "ig", label: "Ignore this line", action: "ignore_line" }] });
    } else {
      lines.push({ ...base, match_state: "unmatched", match_method: null, map_id: null, ingredient_id: null, packs_per_unit: null, old_pack_price: null, new_pack_price: null, change_pct: null, decision: "none", decision_reason: null });
    }
  });
  if (venue_check === "mismatch") questions.push({ kind: "venue_mismatch", line_no: null, prompt: "Is this for this venue?", options: [{ id: "yes", label: "Yes", action: "confirm_venue" }, { id: "no", label: "No", action: "wrong_venue" }] });
  return {
    supplier_id: supplier?.id ?? null, new_supplier: null, venue_check, price_basis: "ex", reconciled: true, recon_notes: [], fee_pool_ex: 0, lines, questions,
    duplicate_of: dup?.id ?? null, mode: ctx.settings.learningMode ? "learning" : "auto", status: dup ? "duplicate" : "needs_review",
    summary: { products: 0, matched: 0, same: 0, to_apply: 0, need_approval: 0, unmatched: 0 },
  };
};

const unmatchedLine = (over: Record<string, any> = {}) => line({ id: "L1", line_no: 1, match_state: "unmatched", match_method: null, ingredient_id: null, packs_per_unit: null, old_pack_price: null, new_pack_price: null, change_pct: null, decision: "none", decision_reason: "Not matched", ...over });

function setup(over: { doc?: Record<string, any>; lines?: Record<string, any>[]; questions?: Record<string, any>[]; settings?: Record<string, any>[]; ings?: Record<string, any>[] } = {}): FakeSupabase {
  const f = createFakeSupabase({
    cost_venues: VENUES,
    cost_settings: over.settings ?? [{ key: "gst_rate", value: 0.1 }, { key: "invoice_learning_mode", value: 1 }],
    invoice_suppliers: [SUPPLIER],
    invoice_files: [{ id: "file-1", venue_id: 1, storage_path: "x.pdf", sha256: "abc", status: "done", attempts: 2, error: "old" }],
    invoice_documents: [document(over.doc)],
    invoice_lines: over.lines ?? [unmatchedLine()],
    invoice_questions: over.questions ?? [{ id: "Q1", venue_id: 1, document_id: IDS.doc, line_id: "L1", kind: "unmatched_line", prompt: "Which product is this?", status: "open", options: [{ id: "kf", label: "Kingfish Fillets", ingredient_id: IDS.kingfish }, { id: "np", label: "Not a product", action: "not_a_product" }, { id: "ig", label: "Ignore this line", action: "ignore_line" }] }],
    invoice_item_map: [],
    invoice_charge_rules: [],
    cost_ingredients: over.ings ?? [ingredient(), ingredient({ id: IDS.lychee, name: "Lychee Liqueur", supplier_code: null, pack_price: 38.62 })],
    cost_ingredient_deals: [],
    cost_price_log: [],
    ordering_products: [],
    ordering_suppliers: [],
    ordering_price_log: [],
  });
  f.installIngredientPriceTrigger(TODAY);
  return f;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const deps = (analyse: AnalyseInvoice = fakeEngine) => ({ analyse, today: TODAY });

describe("answering with a match", () => {
  it("learns the match by supplier and item code, records who answered, and re-analyses", async () => {
    const f = setup();
    const r = await answerQuestion(f.sb, { questionId: "Q1", optionId: "kf", actor: "mon@example.com", note: "it is the kingfish" }, deps());

    expect(r.ok).toBe(true);
    expect(r.message).toBe("Saved. Daniel Street Fish Market code 15026 is now Kingfish Fillets.");

    expect(f.db.invoice_item_map).toHaveLength(1);
    expect(f.db.invoice_item_map[0]).toMatchObject({ supplier_id: IDS.supplier, item_code: "15026", ingredient_id: IDS.kingfish, packs_per_unit: 1, rejected: false, created_by: "mon@example.com" });
    expect(f.db.invoice_item_map[0].desc_key ?? null).toBeNull();

    expect(f.db.invoice_questions[0]).toMatchObject({ status: "answered", answer: { option_id: "kf", note: "it is the kingfish" }, answered_by: "mon@example.com" });
    expect(f.db.invoice_questions[0].answered_at).toBeTruthy();

    // re-analysed: the line is now matched to the ingredient and waits for approval (learning mode), and the question was not asked again
    const l = f.db.invoice_lines.find((x) => x.line_no === 1)!;
    expect(l).toMatchObject({ match_state: "matched", ingredient_id: IDS.kingfish, old_pack_price: 65, new_pack_price: 68.9, decision: "needs_approval" });
    expect(f.db.invoice_questions.filter((q) => q.kind === "unmatched_line" && q.status === "open")).toHaveLength(0);
    expect(f.db.cost_ingredients[0].pack_price).toBe(65); // learning mode: nothing applied
  });

  it("applies what the rules now allow when the document is in auto mode", async () => {
    const f = setup({
      settings: SETTINGS_AUTO,
      doc: { mode: "auto" },
      lines: [unmatchedLine({ unit_price_ex: 66.3 })],
    });
    const r = await answerQuestion(f.sb, { questionId: "Q1", optionId: "kf", actor: "mon" }, deps());
    expect(r.ok).toBe(true);
    expect(f.db.cost_ingredients[0].pack_price).toBe(66.3); // 2% up, venue ok, learning off, not a duplicate
    expect(f.db.cost_price_log[0].source).toBe("Invoice 51329 · Daniel Street Fish Market · 14 Oct 2026");
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0]).toMatchObject({ ok: true });
    expect(r.message).toContain("1 more price was updated.");
    expect(f.db.invoice_documents[0].status).toBe("applied");
  });

  it("uses the description when the line has no item code, and the pack count from the option", async () => {
    const f = setup({
      lines: [unmatchedLine({ item_code: null, description: "Lychee Liqueur 700ml Bottle", qty: 2, unit: "EA", unit_price_ex: 38.62 })],
      questions: [{ id: "Q1", venue_id: 1, document_id: IDS.doc, line_id: "L1", kind: "unmatched_line", prompt: "?", status: "open", options: [{ id: "ly", label: "Lychee Liqueur", ingredient_id: IDS.lychee, packs_per_unit: 1 }] }],
    });
    const r = await answerQuestion(f.sb, { questionId: "Q1", optionId: "ly", actor: "mon" }, deps());
    expect(r.message).toBe('Saved. Daniel Street Fish Market "Lychee Liqueur 700ml Bottle" is now Lychee Liqueur.');
    expect(f.db.invoice_item_map[0]).toMatchObject({ desc_key: "lycheeliqueur700mlbottle", ingredient_id: IDS.lychee, packs_per_unit: 1 });
    expect(f.db.invoice_item_map[0].item_code ?? null).toBeNull();
    expect(f.db.invoice_lines.find((x) => x.line_no === 1)).toMatchObject({ match_state: "matched", decision: "same" });
  });

  it("an ordering-product answer is remembered for that venue", async () => {
    const f = setup({ questions: [{ id: "Q1", venue_id: 1, document_id: IDS.doc, line_id: "L1", kind: "unmatched_line", prompt: "?", status: "open", options: [{ id: "p", label: "Kingfish (order)", product_id: "prod-9", packs_per_unit: 12 }] }] });
    await answerQuestion(f.sb, { questionId: "Q1", optionId: "p", actor: "mon" }, deps());
    expect(f.db.invoice_item_map[0]).toMatchObject({ venue_id: 1, product_id: "prod-9", packs_per_unit: 12 });
  });

  it("updates an existing map entry for the same code instead of adding a second", async () => {
    const f = setup();
    f.db.invoice_item_map.push({ id: "m1", supplier_id: IDS.supplier, venue_id: null, item_code: "15026", desc_key: null, ingredient_id: IDS.lychee, product_id: null, packs_per_unit: 1, rejected: false });
    await answerQuestion(f.sb, { questionId: "Q1", optionId: "kf", actor: "mon" }, deps());
    expect(f.db.invoice_item_map).toHaveLength(1);
    expect(f.db.invoice_item_map[0]).toMatchObject({ id: "m1", ingredient_id: IDS.kingfish });
  });

  it("the map is the learning: the next invoice with that code matches without a question", async () => {
    const f = setup();
    await answerQuestion(f.sb, { questionId: "Q1", optionId: "kf", actor: "mon" }, deps());
    const { loadAnalyseContext } = await import("../lib/invoice-context");
    const ctx = await loadAnalyseContext(f.sb, { venueId: 1, folderVenueId: 1, today: TODAY });
    expect(ctx.maps).toHaveLength(1);
    expect(ctx.maps[0]).toMatchObject({ item_code: "15026", ingredient_id: IDS.kingfish });
  });
});

describe("answering without a match", () => {
  it("rejects a choice that is not on the question, and one already answered", async () => {
    const f = setup();
    const bad = await answerQuestion(f.sb, { questionId: "Q1", optionId: "nope", actor: "mon" }, deps());
    expect(bad.ok).toBe(false);
    expect(f.db.invoice_item_map).toHaveLength(0);
    expect(f.db.invoice_questions[0].status).toBe("open");
    await answerQuestion(f.sb, { questionId: "Q1", optionId: "kf", actor: "mon" }, deps());
    const twice = await answerQuestion(f.sb, { questionId: "Q1", optionId: "kf", actor: "matt" }, deps());
    expect(twice.ok).toBe(false);
    expect(twice.message).toContain("already been answered");
    const gone = await answerQuestion(f.sb, { questionId: "missing", optionId: "kf", actor: "matt" }, deps());
    expect(gone.ok).toBe(false);
  });

  it("ignore this line: the line stays ignored after the document is looked at again", async () => {
    const f = setup();
    const r = await answerQuestion(f.sb, { questionId: "Q1", optionId: "ig", actor: "mon" }, deps());
    expect(r.ok).toBe(true);
    expect(f.db.invoice_lines.find((l) => l.line_no === 1)!.state).toBe("ignored");
    expect(f.db.invoice_item_map).toHaveLength(0);
    expect(f.db.invoice_documents[0].status).toBe("nothing_to_apply");
  });

  it("not a product: stores a rejected map row and ignores the line", async () => {
    const f = setup();
    await answerQuestion(f.sb, { questionId: "Q1", optionId: "np", actor: "mon" }, deps());
    expect(f.db.invoice_item_map).toHaveLength(1);
    expect(f.db.invoice_item_map[0]).toMatchObject({ supplier_id: IDS.supplier, item_code: "15026", rejected: true, created_by: "mon" });
    expect(f.db.invoice_item_map[0].ingredient_id ?? null).toBeNull();
    const l = f.db.invoice_lines.find((x) => x.line_no === 1)!;
    expect(l.state).toBe("ignored");
    expect(l.match_state).toBe("ignored");
  });

  it("not a product replaces an earlier learned match for the same code", async () => {
    const f = setup();
    f.db.invoice_item_map.push({ id: "m1", supplier_id: IDS.supplier, venue_id: null, item_code: "15026", desc_key: null, ingredient_id: IDS.kingfish, product_id: null, packs_per_unit: 1, rejected: false });
    await answerQuestion(f.sb, { questionId: "Q1", optionId: "np", actor: "mon" }, deps());
    expect(f.db.invoice_item_map.map((m) => [m.id === "m1", m.rejected])).toEqual([[false, true]]);
  });
});

describe("approve and reject a price", () => {
  const bigChange = (over: Record<string, any> = {}) => ({
    lines: [line({ id: "L1", ...over })],
    questions: [{ id: "Q1", venue_id: 1, document_id: IDS.doc, line_id: "L1", kind: "big_change", prompt: "Big change", status: "open", options: [{ id: "yes", label: "Approve This Price", action: "approve_change" }, { id: "no", label: "Leave It", action: "reject_change" }] }],
    ings: [ingredient(), ingredient({ id: IDS.lychee, name: "Lychee Liqueur", pack_price: 38.62 })],
  });
  const mapFor = (f: FakeSupabase) => f.db.invoice_item_map.push({ id: "m1", supplier_id: IDS.supplier, venue_id: null, item_code: "15026", desc_key: null, ingredient_id: IDS.kingfish, product_id: null, packs_per_unit: 1, rejected: false });

  it("approve applies the price with the person's name, then answers the question", async () => {
    const f = setup(bigChange());
    mapFor(f);
    const r = await answerQuestion(f.sb, { questionId: "Q1", optionId: "yes", actor: "mon@example.com" }, deps());
    expect(r.ok).toBe(true);
    expect(r.message).toContain("Kingfish Fillets is now $68.90 (was $65.00).");
    expect(f.db.cost_ingredients[0].pack_price).toBe(68.9);
    expect(f.db.invoice_price_changes[0]).toMatchObject({ mode: "approved", applied_by: "mon@example.com" });
    expect(f.db.invoice_questions[0].status).toBe("answered");
    expect(r.applied).toHaveLength(1);
    // the applied line is not replaced when the invoice is looked at again
    expect(f.db.invoice_lines.filter((l) => l.line_no === 1)).toHaveLength(1);
    expect(f.db.invoice_lines.find((l) => l.line_no === 1)!.state).toBe("applied");
    expect(f.db.invoice_price_changes).toHaveLength(1);
  });

  it("approve on a price that moved since leaves the question open and says why", async () => {
    const f = setup(bigChange());
    f.db.cost_ingredients[0].pack_price = 66;
    const r = await answerQuestion(f.sb, { questionId: "Q1", optionId: "yes", actor: "mon" }, deps());
    expect(r.ok).toBe(false);
    expect(r.message).toContain("changed since this invoice was read");
    expect(r.applied[0].stale).toBe(true);
    expect(f.db.invoice_questions[0].status).toBe("open");
    expect(f.db.cost_ingredients[0].pack_price).toBe(66);
  });

  it("reject leaves the price alone and the decision survives a second look", async () => {
    const f = setup(bigChange());
    mapFor(f);
    const r = await answerQuestion(f.sb, { questionId: "Q1", optionId: "no", actor: "mon" }, deps());
    expect(r.ok).toBe(true);
    expect(f.db.cost_ingredients[0].pack_price).toBe(65);
    expect(f.db.invoice_lines.find((l) => l.line_no === 1)!.state).toBe("ignored");
    expect(f.db.invoice_documents[0].status).toBe("nothing_to_apply");
  });
});

describe("venue questions", () => {
  const venueQ = [{ id: "Q1", venue_id: 1, document_id: IDS.doc, line_id: null, kind: "venue_mismatch", prompt: "Is this for this venue?", status: "open", options: [{ id: "yes", label: "Yes", action: "confirm_venue" }, { id: "no", label: "No", action: "wrong_venue" }] }];
  const mismatched = { bill_to: "SOME OTHER CAFE", ship_to: "SOME OTHER CAFE", venue_check: "mismatch" };

  it("confirm venue marks the invoice ok, and it stays ok when the engine looks again", async () => {
    const f = setup({ doc: mismatched, lines: [line({ id: "L1" })], questions: venueQ });
    const r = await answerQuestion(f.sb, { questionId: "Q1", optionId: "yes", actor: "mon" }, deps());
    expect(r.ok).toBe(true);
    expect(f.db.invoice_documents[0].venue_check).toBe("ok");
    // what the scan says is not rewritten
    expect(f.db.invoice_documents[0].bill_to).toBe("SOME OTHER CAFE");
    expect(f.db.invoice_questions.filter((q) => q.kind === "venue_mismatch")).toHaveLength(1);
  });

  it("wrong venue sets the invoice aside with a note, and does not look at it again", async () => {
    const analyse = vi.fn(fakeEngine);
    const f = setup({ doc: mismatched, lines: [line({ id: "L1" })], questions: venueQ });
    const r = await answerQuestion(f.sb, { questionId: "Q1", optionId: "no", actor: "troy@example.com" }, deps(analyse));
    expect(r.ok).toBe(true);
    expect(f.db.invoice_documents[0].status).toBe("ignored");
    expect(f.db.invoice_documents[0].recon_notes.at(-1)).toMatchObject({ check: "venue", ok: false });
    expect(f.db.invoice_documents[0].recon_notes.at(-1).message).toContain("troy@example.com");
    expect(analyse).not.toHaveBeenCalled();
  });

  it("read again sends the file back to the queue", async () => {
    const analyse = vi.fn(fakeEngine);
    const f = setup({ questions: [{ id: "Q1", venue_id: 1, document_id: IDS.doc, line_id: null, kind: "totals_mismatch", prompt: "Totals do not add up", status: "open", options: [{ id: "rr", label: "Read It Again", action: "reread" }] }] });
    const r = await answerQuestion(f.sb, { questionId: "Q1", optionId: "rr", actor: "mon" }, deps(analyse));
    expect(r.ok).toBe(true);
    expect(f.db.invoice_files[0]).toMatchObject({ status: "received", attempts: 0 });
    expect(f.db.invoice_files[0].error ?? null).toBeNull();
    expect(analyse).not.toHaveBeenCalled();
  });
});

describe("re-analysis details", () => {
  it("does not see the invoice as a duplicate of itself", async () => {
    const f = setup();
    await answerQuestion(f.sb, { questionId: "Q1", optionId: "kf", actor: "mon" }, deps());
    expect(f.db.invoice_documents[0].status).not.toBe("duplicate");
    expect(f.db.invoice_documents[0].duplicate_of ?? null).toBeNull();
  });

  it("an engine failure still saves the answer, and says the invoice could not be checked again", async () => {
    const f = setup();
    const boom: AnalyseInvoice = () => {
      throw new Error("engine broke");
    };
    const r = await answerQuestion(f.sb, { questionId: "Q1", optionId: "kf", actor: "mon" }, deps(boom));
    expect(r.ok).toBe(true);
    expect(r.message).toContain("could not be checked again");
    expect(f.db.invoice_item_map).toHaveLength(1);
    expect(f.db.invoice_questions[0].status).toBe("answered");
  });

  it("a database error before the answer is recorded leaves the question open", async () => {
    const f = setup();
    f.failNext("invoice_item_map", "insert", "disk full");
    const r = await answerQuestion(f.sb, { questionId: "Q1", optionId: "kf", actor: "mon" }, deps());
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Nothing was saved");
    expect(f.db.invoice_questions[0].status).toBe("open");
  });
});

describe("helpers", () => {
  it("descKey is lower case letters and digits only", () => {
    expect(descKey("Lychee Liqueur 700ml / Bottle")).toBe("lycheeliqueur700mlbottle");
  });

  it("extractedFromStored rebuilds the reader's output from the stored rows", () => {
    const rows = [line({ id: "L2", line_no: 2, item_code: null, description: "Delivery", line_class: "delivery", qty: 1, unit_price_ex: 5.91, line_total_ex: 5.91, gst: "taxable" }), line({ id: "L1" })] as unknown as InvoiceLineRow[];
    const ex = extractedFromStored(document() as any, rows);
    expect(ex).toMatchObject({ supplier_name: "Daniel Street Fish Market", supplier_abn: "61151388094", invoice_number: "51329", invoice_date: "2026-10-14", subtotal_ex: 215.91, gst_total: 0.59, total_inc: 216.5, bill_to: "DRIFT BAR AND DINING" });
    expect(ex.lines.map((l) => l.line_no)).toEqual([1, 2]);
    expect(ex.lines[0]).toEqual({ line_no: 1, page: 1, item_code: "15026", description: "Kingfish fillets skin on wing off per kg", qty: 1.85, unit: "KG", unit_price: 68.9, line_total: 127.47, basis: "ex", gst: "free", class_hint: "product" });
    expect(ex.lines[1]).toMatchObject({ item_code: null, class_hint: "delivery", unit_price: 5.91 });
  });
});
