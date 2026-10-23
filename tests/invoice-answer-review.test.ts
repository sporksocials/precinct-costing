/**
 * Fixes from the independent review of lib/invoice-answer.ts: the learned map is scoped to a venue (S4), never invents a pack
 * size (S5), stores the description with the engine's own key (S6), a re-read really reads again (S7), and a charge rule is never
 * made from a few letters (M10). Every test here failed before the fix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerQuestion } from "../lib/invoice-answer";
import { loadAnalyseContext } from "../lib/invoice-context";
import { analyseInvoice } from "../lib/invoice-engine";
import type { AnalyseInvoice } from "../lib/invoice-interfaces";
import { descKey } from "../lib/invoice-names";
import { saveAnalysis } from "../lib/invoice-store";
import type { InvoiceAnalysis, QuestionOption } from "../lib/invoice-types";
import { createFakeSupabase, type FakeSupabase } from "./helpers/fake-supabase";
import { document, ingredient, IDS, line, SUPPLIER, VENUES } from "./helpers/invoice-fixtures";
import { ING_GINGER, ING_LYCHEE, diabloEnv23585, supplierDiablo } from "./fixtures/invoice-fixtures";

const NOW = new Date("2026-10-24T02:00:00Z");
const TODAY = "2026-10-24";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

/** An engine that changes nothing, so a test sees only what the answer itself wrote. */
const quiet: AnalyseInvoice = (_ex, ctx) =>
  ({
    supplier_id: ctx.suppliers[0]?.id ?? null, new_supplier: null, venue_check: "ok", price_basis: "ex", reconciled: true, recon_notes: [], fee_pool_ex: 0, lines: [], questions: [],
    duplicate_of: null, mode: "learning", status: "needs_review", summary: { products: 0, matched: 0, same: 0, to_apply: 0, need_approval: 0, unmatched: 0 },
  }) satisfies InvoiceAnalysis;

const pick = (id: string, extra: Partial<QuestionOption> = {}): QuestionOption => ({ id, label: id, ...extra });
const question = (options: QuestionOption[], over: Record<string, any> = {}) => ({ id: "Q1", venue_id: 1, document_id: IDS.doc, line_id: "L1", kind: "unmatched_line", prompt: "?", status: "open", options, answer: null, ...over });
const unmatched = (over: Record<string, any> = {}) => line({ id: "L1", line_no: 1, match_state: "unmatched", match_method: null, ingredient_id: null, packs_per_unit: null, old_pack_price: null, new_pack_price: null, change_pct: null, decision: "none", ...over });

function setup(over: { venue?: number; lines?: Record<string, any>[]; questions?: Record<string, any>[]; maps?: Record<string, any>[]; docs?: Record<string, any>[]; files?: Record<string, any>[]; rules?: Record<string, any>[] } = {}): FakeSupabase {
  const venue = over.venue ?? 1;
  return createFakeSupabase({
    cost_venues: VENUES,
    cost_settings: [{ key: "gst_rate", value: 0.1 }],
    invoice_suppliers: [SUPPLIER],
    invoice_files: over.files ?? [{ id: "file-1", venue_id: venue, storage_path: "x.pdf", sha256: "abc", status: "done", attempts: 2, error: "old" }],
    invoice_documents: over.docs ?? [document({ venue_id: venue })],
    invoice_lines: over.lines ?? [unmatched({ venue_id: venue })],
    invoice_questions: over.questions ?? [question([pick("pick:ing-other", { ingredient_id: "ing-other" })], { venue_id: venue })],
    invoice_item_map: over.maps ?? [],
    invoice_charge_rules: over.rules ?? [],
    cost_ingredients: [ingredient(), ingredient({ id: "ing-other", name: "Other", supplier_code: null })],
    cost_ingredient_deals: [],
    ordering_products: [],
    ordering_suppliers: [],
  });
}
const ask = (f: FakeSupabase, optionId: string, note?: string) => answerQuestion(f.sb, { questionId: "Q1", optionId, actor: "mon@example.com", note }, { analyse: quiet, today: TODAY });

const mapRow = (over: Record<string, any>) => ({ id: "m", supplier_id: IDS.supplier, venue_id: null, item_code: "15026", desc_key: null, ingredient_id: null, product_id: null, packs_per_unit: null, rejected: false, ...over });

// ============================================================================================================ S4
describe("S4: the learned map is scoped to a venue", () => {
  const drift = mapRow({ id: "map-drift", venue_id: 1, product_id: "P-DRIFT", packs_per_unit: 6 });

  it("a Chiobu answer for the same supplier and code leaves Drift's row exactly as it was", async () => {
    const f = setup({ venue: 2, maps: [{ ...drift }] });
    const r = await ask(f, "pick:ing-other");
    expect(r.ok).toBe(true);
    expect(f.db.invoice_item_map.find((m) => m.id === "map-drift")).toEqual(drift);
    const mine = f.db.invoice_item_map.filter((m) => m.id !== "map-drift");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ item_code: "15026", ingredient_id: "ing-other", rejected: false });
    expect(mine[0].venue_id ?? null).toBeNull(); // an ingredient-only answer is for every venue
  });

  it("an ordering product answer in Chiobu is a Chiobu row beside Drift's, not a change to it", async () => {
    const f = setup({ venue: 2, maps: [{ ...drift }], questions: [question([pick("p", { product_id: "P-CHIOBU", packs_per_unit: 12 })], { venue_id: 2 })] });
    await ask(f, "p");
    expect(f.db.invoice_item_map.find((m) => m.id === "map-drift")).toEqual(drift);
    expect(f.db.invoice_item_map).toHaveLength(2);
    expect(f.db.invoice_item_map.find((m) => m.id !== "map-drift")).toMatchObject({ venue_id: 2, product_id: "P-CHIOBU", packs_per_unit: 12 });
  });

  it("a different target in the same scope for the same code is a correction: that one row changes", async () => {
    const f = setup({ maps: [mapRow({ id: "m1", ingredient_id: IDS.kingfish, packs_per_unit: 12 })] });
    await ask(f, "pick:ing-other");
    expect(f.db.invoice_item_map).toHaveLength(1);
    expect(f.db.invoice_item_map[0]).toMatchObject({ id: "m1", ingredient_id: "ing-other", rejected: false });
    expect(f.db.invoice_item_map[0].packs_per_unit ?? null).toBeNull(); // the old pack size belonged to the old product
  });

  it("the same target answered again keeps the pack size a person already gave", async () => {
    const f = setup({ maps: [mapRow({ id: "m1", ingredient_id: "ing-other", packs_per_unit: 12 })] });
    await ask(f, "pick:ing-other");
    expect(f.db.invoice_item_map).toHaveLength(1);
    expect(f.db.invoice_item_map[0].packs_per_unit).toBe(12);
  });

  it("a rejected row and a confirmed row for the same code and target are one row with the flag flipped", async () => {
    const f = setup({ maps: [mapRow({ id: "m1", ingredient_id: "ing-other", rejected: true })] });
    await ask(f, "pick:ing-other");
    expect(f.db.invoice_item_map).toHaveLength(1);
    expect(f.db.invoice_item_map[0]).toMatchObject({ id: "m1", rejected: false });
  });

  it("codes compare the way the engine compares them (case and spaces ignored)", async () => {
    const f = setup({ lines: [unmatched({ item_code: "ab 123" })], maps: [mapRow({ id: "m1", item_code: "AB123", ingredient_id: IDS.kingfish })] });
    await ask(f, "pick:ing-other");
    expect(f.db.invoice_item_map).toHaveLength(1);
    expect(f.db.invoice_item_map[0]).toMatchObject({ id: "m1", ingredient_id: "ing-other" });
  });

  it("a description-only line never reads a code row, and a code line never reads a description row", async () => {
    const byDesc = mapRow({ id: "m-desc", item_code: null, desc_key: descKey("Kingfish fillets skin on wing off per kg"), ingredient_id: IDS.kingfish });
    const f = setup({ maps: [byDesc] }); // the line has code 15026
    await ask(f, "pick:ing-other");
    expect(f.db.invoice_item_map.find((m) => m.id === "m-desc")).toEqual(byDesc);
    expect(f.db.invoice_item_map).toHaveLength(2);
  });

  it("not a product replaces this venue's and every venue's learned match, and leaves another venue's alone", async () => {
    const all = mapRow({ id: "m-all", ingredient_id: IDS.kingfish });
    const here = mapRow({ id: "m-here", venue_id: 2, product_id: "P-CHIOBU" });
    const other = mapRow({ id: "m-drift", venue_id: 1, product_id: "P-DRIFT" });
    const f = setup({ venue: 2, maps: [all, here, other], questions: [question([pick("np", { action: "not_a_product" })], { venue_id: 2 })] });
    await ask(f, "np");
    expect(f.db.invoice_item_map.find((m) => m.id === "m-all")).toBeUndefined();
    expect(f.db.invoice_item_map.find((m) => m.id === "m-here")).toBeUndefined();
    expect(f.db.invoice_item_map.find((m) => m.id === "m-drift")).toEqual(other);
    const rejected = f.db.invoice_item_map.filter((m) => m.rejected);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ item_code: "15026", rejected: true });
    expect(rejected[0].ingredient_id ?? null).toBeNull();
  });

  it("saying 'not a product' twice for the same code stores one rejection", async () => {
    const f = setup({ maps: [mapRow({ id: "r1", rejected: true })], questions: [question([pick("np", { action: "not_a_product" })])] });
    await ask(f, "np");
    expect(f.db.invoice_item_map).toHaveLength(1);
  });

  it("the unit answer updates the line's own row in its own scope", async () => {
    const lineRow = line({ id: "L1", line_no: 1, ingredient_id: IDS.kingfish, product_id: "P-DRIFT", packs_per_unit: null, unit: "CTN" });
    const f = setup({
      lines: [lineRow],
      maps: [mapRow({ id: "m1", venue_id: 1, ingredient_id: IDS.kingfish, product_id: "P-DRIFT" }), mapRow({ id: "m-null", venue_id: null, ingredient_id: IDS.kingfish })],
      questions: [question([pick("packs:6", { packs_per_unit: 6 })], { kind: "unit_unclear" })],
    });
    await ask(f, "packs:6");
    expect(f.db.invoice_item_map.find((m) => m.id === "m1")!.packs_per_unit).toBe(6);
    expect(f.db.invoice_item_map.find((m) => m.id === "m-null")!.packs_per_unit ?? null).toBeNull(); // the every-venue row is another scope
  });
});

// ============================================================================================================ S5
describe("S5: a pack size nobody stated is stored as null, never 1", () => {
  it("an answer with no pack size stores no pack size", async () => {
    const f = setup();
    await ask(f, "pick:ing-other");
    expect(f.db.invoice_item_map[0].packs_per_unit ?? null).toBeNull();
  });

  it("uses the option's pack size, else the line's (the engine derived it safely), else none", async () => {
    const stated = setup({ questions: [question([pick("a", { ingredient_id: "ing-other", packs_per_unit: 24 })])] });
    await ask(stated, "a");
    expect(stated.db.invoice_item_map[0].packs_per_unit).toBe(24);

    const derived = setup({ lines: [unmatched({ packs_per_unit: 2 })] });
    await ask(derived, "pick:ing-other");
    expect(derived.db.invoice_item_map[0].packs_per_unit).toBe(2);

    for (const bad of [0, -1]) {
      const f = setup({ lines: [unmatched({ packs_per_unit: bad })] });
      await ask(f, "pick:ing-other");
      expect(f.db.invoice_item_map[0].packs_per_unit ?? null, String(bad)).toBeNull();
    }
  });

  it("a rejection stores no pack size either", async () => {
    const f = setup({ questions: [question([pick("np", { action: "not_a_product" })])] });
    await ask(f, "np");
    expect(f.db.invoice_item_map[0].packs_per_unit ?? null).toBeNull();
  });
});

// ============================================================================================================ S6
describe("S6: a description is learned with the engine's own key (Diablo)", () => {
  const DESC = "Diablo Co Lychee Liqueur 700ml Bottle";

  /** The database as the app has it for Chiobu, with Diablo's invoice filed and its lychee line waiting on a question. */
  async function filed() {
    const f = createFakeSupabase({
      cost_venues: VENUES,
      cost_settings: [{ key: "gst_rate", value: 0.1 }],
      invoice_suppliers: [supplierDiablo()],
      invoice_files: [{ id: "file-1", venue_id: 2, storage_path: "x.pdf", sha256: "abc", status: "done", attempts: 1 }],
      invoice_documents: [],
      invoice_lines: [],
      invoice_questions: [],
      invoice_item_map: [],
      invoice_charge_rules: [],
      cost_ingredients: [{ ...ING_GINGER, category: "Drinks" }, { ...ING_LYCHEE, category: "Drinks" }],
      cost_ingredient_deals: [],
      ordering_products: [],
      ordering_suppliers: [],
      cost_price_log: [],
    });
    const ctx = await loadAnalyseContext(f.sb, { venueId: 2, folderVenueId: 2, today: TODAY });
    const extracted = diabloEnv23585();
    extracted.supplier_name = "Diablo Co";
    extracted.lines[1] = { ...extracted.lines[1], description: DESC };
    const analysis = analyseInvoice(extracted, ctx);
    const saved = await saveAnalysis(f.sb, { fileId: "file-1", venueId: 2, extracted, analysis, pagePdfPath: null, readModel: "test", documentId: undefined });
    return { f, saved };
  }
  const lychee = (f: FakeSupabase) => f.db.invoice_lines.find((l) => l.description === DESC)!;
  const open = (f: FakeSupabase) => f.db.invoice_questions.find((x) => x.status === "open" && x.line_id === lychee(f).id);
  const real = { analyse: analyseInvoice, today: TODAY };

  it("learns the match once, and the real engine then matches the same description by that saved match", async () => {
    const { f } = await filed();
    const qn = open(f)!;
    expect(qn).toBeTruthy();
    expect(lychee(f).match_state).not.toBe("matched");

    const r = await answerQuestion(f.sb, { questionId: qn.id, optionId: `custom:${ING_LYCHEE.id}`, actor: "mon", note: JSON.stringify({ ingredient_id: ING_LYCHEE.id, packs_per_unit: 1 }) }, real);
    expect(r.ok).toBe(true);

    const [row] = f.db.invoice_item_map;
    expect(f.db.invoice_item_map).toHaveLength(1);
    expect(row.desc_key).toBe(descKey(DESC));
    expect(row.item_code ?? null).toBeNull();
    // the engine looked at the invoice again with that row: the line is matched by description, not unmatched
    expect(lychee(f)).toMatchObject({ match_state: "matched", match_method: "alias", ingredient_id: ING_LYCHEE.id });
    expect(f.db.invoice_questions.filter((x) => x.line_id === lychee(f).id && x.kind === "unmatched_line" && x.status === "open")).toHaveLength(0);

    // and a later invoice with the same words, spaced and cased differently, matches by the same row
    const ctx = await loadAnalyseContext(f.sb, { venueId: 2, folderVenueId: 2, today: TODAY });
    const again = diabloEnv23585();
    again.supplier_name = "Diablo Co";
    again.invoice_number = "ENV-34730";
    again.lines[1] = { ...again.lines[1], description: "DIABLO CO  LYCHEE LIQUEUR 700 ML  BOTTLE" };
    const second = analyseInvoice(again, ctx);
    expect(second.lines.find((l) => l.line_no === 2)).toMatchObject({ match_state: "matched", match_method: "alias", ingredient_id: ING_LYCHEE.id });
  });

  it("a not a product answer is stored under the same key, so asking again about a respaced description adds nothing", async () => {
    const { f } = await filed();
    const qn = open(f)!;
    const np = qn.options.find((o: QuestionOption) => o.action === "not_a_product");
    expect(np, "the question offers 'not a stock item'").toBeTruthy();
    await answerQuestion(f.sb, { questionId: qn.id, optionId: np.id, actor: "mon" }, real);
    expect(f.db.invoice_item_map).toHaveLength(1);
    expect(f.db.invoice_item_map[0]).toMatchObject({ desc_key: descKey(DESC), rejected: true });
    expect(f.db.invoice_item_map[0].item_code ?? null).toBeNull();
    expect(lychee(f).state).toBe("ignored");

    // the same words read slightly differently on the next scan: still one rejection
    const g = setup({
      lines: [unmatched({ item_code: null, description: "DIABLO CO  LYCHEE LIQUEUR 700 ML  BOTTLE" })],
      maps: [...f.db.invoice_item_map.map((m) => ({ ...m, supplier_id: IDS.supplier }))],
      questions: [question([pick("np", { action: "not_a_product" })])],
    });
    await ask(g, "np");
    expect(g.db.invoice_item_map).toHaveLength(1);
  });
});

// ============================================================================================================ S7
describe("S7: read again really reads again", () => {
  const doc = (id: string, status: string, over: Record<string, any> = {}) => document({ id, status, file_id: "file-1", read_model: "claude-sonnet-5-5", ...over });
  const rereadQ = question([pick("rr", { action: "reread" })], { kind: "totals_mismatch", line_id: null, document_id: "doc-1" });

  it("puts the file back in the queue and forgets the stored reading of every invoice that is not settled", async () => {
    const f = setup({
      docs: [doc("doc-1", "needs_review"), doc("doc-2", "applied"), doc("doc-3", "nothing_to_apply"), doc("doc-4", "ignored"), doc("doc-5", "duplicate"), doc("doc-6", "partly_applied"), doc("doc-7", "needs_review", { file_id: "file-2" })],
      files: [{ id: "file-1", venue_id: 1, status: "done", attempts: 2, error: "old" }, { id: "file-2", venue_id: 1, status: "done", attempts: 1 }],
      lines: [],
      questions: [rereadQ],
    });
    const analyse = vi.fn(quiet);
    const r = await answerQuestion(f.sb, { questionId: "Q1", optionId: "rr", actor: "mon" }, { analyse, today: TODAY });
    expect(r.ok).toBe(true);
    expect(f.db.invoice_files.find((x) => x.id === "file-1")).toMatchObject({ status: "received", attempts: 0 });
    expect(f.db.invoice_files.find((x) => x.id === "file-1")!.error ?? null).toBeNull();
    const model = (id: string) => f.db.invoice_documents.find((d) => d.id === id)!.read_model ?? null;
    // the ones that will be read again
    expect(model("doc-1")).toBeNull();
    expect(model("doc-3")).toBeNull();
    // what was applied, set aside or filed as a copy keeps its reading
    expect(model("doc-2")).toBe("claude-sonnet-5-5");
    expect(model("doc-4")).toBe("claude-sonnet-5-5");
    expect(model("doc-5")).toBe("claude-sonnet-5-5");
    expect(model("doc-6")).toBe("claude-sonnet-5-5");
    // another file is not touched
    expect(f.db.invoice_files.find((x) => x.id === "file-2")).toMatchObject({ status: "done", attempts: 1 });
    expect(model("doc-7")).toBe("claude-sonnet-5-5");
    expect(analyse).not.toHaveBeenCalled();
  });

  it("no invoice of the file that is still to be read keeps a stored reading", async () => {
    const f = setup({ docs: [doc("doc-1", "needs_review"), doc("doc-3", "nothing_to_apply")], lines: [], questions: [rereadQ] });
    await answerQuestion(f.sb, { questionId: "Q1", optionId: "rr", actor: "mon" }, { analyse: quiet, today: TODAY });
    expect(f.db.invoice_documents.filter((d) => d.read_model)).toHaveLength(0);
  });
});

// ============================================================================================================ M10
describe("M10: a charge rule is never made from a few letters", () => {
  const opts: QuestionOption[] = [pick("spread_charge"), pick("leave_out_charge", { action: "not_a_product" })];
  const charge = (over: Record<string, any>) => unmatched({ line_class: "fee", ...over });

  it("a short description uses the item code as the text to match", async () => {
    const f = setup({ lines: [charge({ description: "Fee", item_code: "FUEL01" })], questions: [question(opts, { kind: "other" })] });
    const r = await ask(f, "spread_charge");
    expect(r.ok).toBe(true);
    expect(f.db.invoice_charge_rules).toHaveLength(1);
    expect(f.db.invoice_charge_rules[0]).toMatchObject({ supplier_id: IDS.supplier, match_text: "fuel01", spread: true });
  });

  it("a short description with no usable code is refused in plain words and nothing is saved", async () => {
    for (const code of [null, "", "  ", "A1"]) {
      const f = setup({ lines: [charge({ description: "Fee", item_code: code })], questions: [question(opts, { kind: "other" })] });
      for (const optionId of ["spread_charge", "leave_out_charge"]) {
        const r = await ask(f, optionId);
        expect(r.ok, `${code} ${optionId}`).toBe(false);
        expect(r.message).toBe("That description is too short to make a rule from. Ask for the rule to be added in Settings.");
        expect(f.db.invoice_charge_rules).toHaveLength(0);
        expect(f.db.invoice_questions[0].status).toBe("open");
      }
    }
  });

  it("a description of five characters or more is used as it always was", async () => {
    const f = setup({ lines: [charge({ description: "Fuel levy", item_code: "99000" })], questions: [question(opts, { kind: "other" })] });
    await ask(f, "spread_charge");
    expect(f.db.invoice_charge_rules[0].match_text).toBe("fuel levy");
  });
});
