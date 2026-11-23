/**
 * One card per product (Troy, 23 Nov 2026), end to end. An order item's own stored price (ordering_products.price_inc_gst) is
 * retired and worked out from the ingredient, so an invoice sets ONE price: the ingredient's pack price.
 *
 * These tests start from an invoice as the rules BEFORE that date left it in the database (engine version 3: an order price pair on
 * the lines, "big change" questions about an order price), run the free re-check with the real engine, the real saveAnalysis and the
 * real applyLine, and then read the result through the real Approve Prices loader and the real weekly review. Nothing about an order
 * price may be left to approve, to answer, to list or to write.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyDocumentAuto } from "../lib/invoice-apply";
import { assembleWeeklyData, type WeeklyRaw, type WeeklyRawDoc, type WeeklyRawLine, type WeeklyRawQuestion } from "../lib/invoice-digest-data";
import { buildWeeklyReview } from "../lib/invoice-digest";
import { ENGINE_VERSION, NO_INGREDIENT_REASON, analyseInvoice } from "../lib/invoice-engine";
import { reanalyseNext, type ReanalyseDeps } from "../lib/invoice-reanalyse";
import { saveAnalysis } from "../lib/invoice-store";
import { loadApprovePrices } from "../lib/invoice-todo-approve";
import type { AnalyseContext, ExtractedInvoice } from "../lib/invoice-types";
import { lineStatus, outcomeStats, outcomeView } from "../lib/invoice-view";
import { createFakeSupabase, type FakeSupabase, type Row } from "./helpers/fake-supabase";
import { document, IDS, line as lineRow, SETTINGS_AUTO, VENUES } from "./helpers/invoice-fixtures";
import { ING_BARRA, ING_KINGFISH, PROD_BARRA, SUP_DS, baseCtx, danielStreet51329Fixed, line as readLine, prod, supplierDS } from "./fixtures/invoice-fixtures";

const NOW = new Date("2026-10-24T02:00:00Z"); // 24 Oct 2026, noon in Brisbane
const TODAY = "2026-10-24";
const STRAWS = prod({ id: "prod-straws", name: "Paper Straws", supplier_item_code: "STRAW", supplier_name: "Daniel Street Fish Market", unit_name: "carton" });
const ORDER_PRICE = /order(ing)? price/i;

/** Daniel Street #51329 (it adds up) with one more line: paper straws, an order item that has no costing ingredient. */
function reading(): ExtractedInvoice {
  const d = danielStreet51329Fixed();
  d.lines.push(readLine({ line_no: 5, item_code: "STRAW", description: "Paper straws", qty: 1, unit: "CTN", unit_price: 25, line_total: 25, gst: "taxable", class_hint: "product" }));
  d.subtotal_ex = 241.21;
  d.gst_total = 3.09;
  d.total_inc = 244.3;
  return d;
}

const ctx = (over: Partial<AnalyseContext> = {}): AnalyseContext => baseCtx({ products: [PROD_BARRA, STRAWS], ...over });

const bigChange = (id: string, lineId: string, prompt: string, over: Row = {}): Row => ({
  id, venue_id: 1, document_id: IDS.doc, line_id: lineId, kind: "big_change", prompt, status: "open", answer: null, answered_by: null, answered_at: null, created_at: "2026-10-20T00:00:00Z",
  options: [{ id: "approve_change", label: "Yes, use the new price", action: "approve_change" }, { id: "reject_change", label: "No, keep the current price", action: "reject_change" }],
  ...over,
});

/** The database as engine version 3 left this invoice: the barramundi and the straws each wait on an ORDER price, each with its question. */
function oldWorld(over: { doc?: Row; lines?: Row[]; questions?: Row[] } = {}): FakeSupabase {
  const f = createFakeSupabase({
    cost_venues: VENUES,
    cost_settings: SETTINGS_AUTO,
    invoice_suppliers: [{ ...supplierDS(), id: SUP_DS }],
    invoice_files: [{ id: IDS.file, venue_id: 1 }],
    invoice_documents: [document({ supplier_id: SUP_DS, extracted: reading(), analysis_version: 3, status: "needs_review", mode: "auto", created_at: "2026-10-20T00:00:00Z", ...over.doc })],
    invoice_lines: over.lines ?? [
      lineRow({ id: "l1", line_no: 1, old_pack_price: 66.5, new_pack_price: 68.9, change_pct: 0.0361, decision: "apply", decision_reason: null }),
      // the ingredient moved 3.85%, but the order item's own stored price (45) made it a 7.7% drop that waited for a person
      lineRow({
        id: "l2", line_no: 2, item_code: "15056", description: "Humpty Doo Barramundi fillets per kg", qty: 2.39, unit_price_ex: 41.54, line_total_ex: 99.28, ingredient_id: "ing-barra", product_id: "prod-barra",
        base_qty: 2.39, old_pack_price: 40, new_pack_price: 41.54, old_product_price: 45, new_product_price: 41.54, change_pct: 0.0385, decision: "needs_approval", decision_reason: "7.7% change is over the 5% limit.",
      }),
      lineRow({ id: "l3", line_no: 3, line_class: "discount", item_code: "15056", description: "Barramundi credit", qty: null, unit: null, unit_price_ex: null, line_total_ex: -16.45, match_state: "ignored", match_method: null, ingredient_id: null, packs_per_unit: null, base_qty: null, base_unit: null, old_pack_price: null, new_pack_price: null, change_pct: null, decision: "none", decision_reason: null }),
      lineRow({ id: "l4", line_no: 4, line_class: "delivery", item_code: "99000", description: "Delivery order over $200", qty: 1, unit: "EA", unit_price_ex: 5.91, line_total_ex: 5.91, gst: "taxable", match_state: "ignored", match_method: null, ingredient_id: null, packs_per_unit: null, base_qty: null, base_unit: null, old_pack_price: null, new_pack_price: null, change_pct: null, decision: "none", decision_reason: null }),
      // matched ONLY to an order item: version 3 proposed an order price for it (20 to 27.50 inc GST)
      lineRow({
        id: "l5", line_no: 5, item_code: "STRAW", description: "Paper straws", qty: 1, unit: "CTN", unit_price_ex: 25, line_total_ex: 25, gst: "taxable", ingredient_id: null, product_id: "prod-straws", packs_per_unit: null,
        base_qty: null, base_unit: null, old_pack_price: null, new_pack_price: null, old_product_price: 20, new_product_price: 27.5, change_pct: 0.375, decision: "needs_approval", decision_reason: "37.5% change is over the 5% limit.",
      }),
    ],
    invoice_questions: over.questions ?? [
      bigChange("q-barra", "l2", "Barramundi Fillets from Daniel Street Fish Market is $41.54 a kg, inc GST, down 7.7% from $45.00. That is over our 5% limit. Is the new price right?"),
      bigChange("q-straws", "l5", "Paper Straws from Daniel Street Fish Market is $27.50 a carton, inc GST, up 37.5% from $20.00. That is over our 5% limit. Is the new price right?"),
    ],
    cost_ingredients: [
      { id: "ing-kingfish", name: ING_KINGFISH.name, supplier_id: 7, supplier_code: "15026", pack_size: 1, pack_unit: "kg", pack_price: 66.5, price_inc_gst: false, gst_free: true, last_price_update: "2026-10-01", previous_price: null, source: null, active: true },
      { id: "ing-barra", name: ING_BARRA.name, supplier_id: 7, supplier_code: "15056", pack_size: 1, pack_unit: "kg", pack_price: 40, price_inc_gst: false, gst_free: true, last_price_update: "2026-10-01", previous_price: null, source: null, active: true },
    ],
    cost_ingredient_deals: [],
    cost_price_log: [],
    ordering_products: [
      { id: "prod-barra", venue_id: 1, name: "Barramundi Fillets", unit_name: "kg", supplier_item_code: "15056", price_inc_gst: 45, ingredient_id: "ing-barra", costing_packs_per_unit: 1, deal_buy_qty: null, deal_free_qty: null, active: true },
      { id: "prod-straws", venue_id: 1, name: "Paper Straws", unit_name: "carton", supplier_item_code: "STRAW", price_inc_gst: 20, ingredient_id: null, costing_packs_per_unit: null, deal_buy_qty: null, deal_free_qty: null, active: true },
    ],
    ordering_price_log: [],
  });
  f.installIngredientPriceTrigger(TODAY);
  return f;
}

const deps = (over: Partial<ReanalyseDeps> = {}, c: Partial<AnalyseContext> = {}): ReanalyseDeps => ({
  analyse: analyseInvoice,
  loadContext: async () => ctx(c),
  save: saveAnalysis,
  today: () => TODAY,
  firstReadModel: "claude-sonnet-5-5",
  ...over,
});

const byNo = (f: FakeSupabase, n: number) => f.db.invoice_lines.find((l) => l.line_no === n)!;
const openQuestions = (f: FakeSupabase) => f.db.invoice_questions.filter((q) => q.status === "open");
const orderWrites = (f: FakeSupabase) => f.log.filter((l) => l.op !== "select" && (l.table === "ordering_products" || l.table === "ordering_price_log"));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("the free re-check of an invoice read before the order price was retired", () => {
  it("the rules version moved on, so the stored invoice is picked up", async () => {
    expect(ENGINE_VERSION).toBe(4);
    const f = oldWorld();
    expect(await reanalyseNext(f.sb, deps())).toBe(true);
    expect(f.db.invoice_documents[0].analysis_version).toBe(4);
    expect(await reanalyseNext(f.sb, deps())).toBe(false); // and only once
  });

  it("leaves ONE price on every line: no order price pair survives on a line that was re-checked", async () => {
    const f = oldWorld();
    await reanalyseNext(f.sb, deps());
    expect(f.db.invoice_lines).toHaveLength(5); // the old rows were replaced, not doubled
    for (const l of f.db.invoice_lines) expect([l.old_product_price ?? null, l.new_product_price ?? null], `line ${l.line_no}`).toEqual([null, null]);
    // the barramundi: its order item stays on the line for the record; only the ingredient's 3.85% move is judged, so it no longer waits
    expect(byNo(f, 2)).toMatchObject({ ingredient_id: "ing-barra", product_id: "prod-barra", old_pack_price: 40, new_pack_price: 41.54, decision: "apply", state: "open" });
    expect(byNo(f, 2).decision_reason ?? null).toBeNull();
    expect(byNo(f, 2).change_pct).toBeCloseTo(0.0385, 4);
    expect(byNo(f, 1)).toMatchObject({ ingredient_id: "ing-kingfish", old_pack_price: 66.5, new_pack_price: 68.9, decision: "apply" });
  });

  it("the line matched only to an order item stays matched for the record and proposes nothing", async () => {
    const f = oldWorld();
    await reanalyseNext(f.sb, deps());
    const straws = byNo(f, 5);
    expect(straws).toMatchObject({ match_state: "matched", match_method: "code", product_id: "prod-straws", decision: "none", decision_reason: NO_INGREDIENT_REASON, state: "open" });
    expect(straws.ingredient_id ?? null).toBeNull();
    expect([straws.old_pack_price ?? null, straws.new_pack_price ?? null, straws.change_pct ?? null]).toEqual([null, null, null]);
    expect(lineStatus(straws as Parameters<typeof lineStatus>[0])).toMatchObject({ kind: "nothing", word: "No costing ingredient to update" });
  });

  it("closes the questions that only concerned an order price, and asks nothing new about one", async () => {
    const f = oldWorld();
    await reanalyseNext(f.sb, deps());
    expect(f.db.invoice_questions).toHaveLength(2); // nothing deleted, nothing added
    expect(f.db.invoice_questions.map((q) => [q.id, q.status])).toEqual([["q-barra", "dismissed"], ["q-straws", "dismissed"]]);
    expect(openQuestions(f)).toEqual([]);
    // the closed questions still hang off the document's own (new) lines, not off rows that were deleted
    const ids = new Set(f.db.invoice_lines.map((l) => l.id));
    for (const q of f.db.invoice_questions) expect(ids.has(q.line_id), q.id).toBe(true);
  });

  it("a real big change on the INGREDIENT regenerates the same question, about the pack price", async () => {
    const f = oldWorld();
    f.db.cost_ingredients[1].pack_price = 36;
    await reanalyseNext(f.sb, deps({}, { ingredients: [ING_KINGFISH, { ...ING_BARRA, pack_price: 36 }] }));
    expect(byNo(f, 2)).toMatchObject({ old_pack_price: 36, new_pack_price: 41.54, decision: "needs_approval", decision_reason: "15.4% change is over the 5% limit." });
    const q = f.db.invoice_questions.find((x) => x.id === "q-barra")!;
    expect(q.status).toBe("open");
    expect(q.line_id).toBe(byNo(f, 2).id);
    expect(q.prompt).toBe("Barramundi Fillets (1kg) from Daniel Street Fish Market is $41.54 a pack, ex GST, up 15.4% from $36.00. That is over our 5% limit. Is the new price right?");
    expect(q.prompt).not.toMatch(/inc GST|a kg,/);
    // the straws question had nothing to be regenerated from
    expect(f.db.invoice_questions.find((x) => x.id === "q-straws")!.status).toBe("dismissed");
    expect(openQuestions(f)).toHaveLength(1);
  });

  it("a question a person already answered is kept as their answer, never asked again", async () => {
    const f = oldWorld({
      questions: [bigChange("q-barra", "l2", "about an order price", { status: "answered", answer: { option_id: "reject_change" }, answered_by: "mon@example.com", answered_at: "2026-10-21T00:00:00Z" })],
    });
    f.db.cost_ingredients[1].pack_price = 36;
    await reanalyseNext(f.sb, deps({}, { ingredients: [ING_KINGFISH, { ...ING_BARRA, pack_price: 36 }] }));
    expect(f.db.invoice_questions).toHaveLength(1);
    expect(f.db.invoice_questions[0]).toMatchObject({ id: "q-barra", status: "answered", answered_by: "mon@example.com" });
  });

  it("a line a person skipped stays skipped", async () => {
    const f = oldWorld();
    f.db.invoice_lines.find((l) => l.id === "l5")!.state = "approved_skip";
    await reanalyseNext(f.sb, deps());
    expect(byNo(f, 5)).toMatchObject({ state: "approved_skip", decision: "none" });
  });

  it("no word the re-check writes speaks of an order price", async () => {
    const f = oldWorld();
    await reanalyseNext(f.sb, deps());
    const written = [...f.db.invoice_lines.map((l) => l.decision_reason ?? ""), ...openQuestions(f).map((q) => q.prompt), JSON.stringify(f.db.invoice_documents[0].recon_notes)].join(" | ");
    expect(written).not.toMatch(ORDER_PRICE);
    expect(written).not.toMatch(/[—–]/);
  });

  it("HISTORY: a line whose order price was already applied is kept exactly as it was (the ledger points at it)", async () => {
    // a partly applied invoice is not picked by the quiet re-check; the answer path re-analyses one through saveAnalysis, like this
    const f = oldWorld({ doc: { status: "partly_applied" } });
    Object.assign(f.db.invoice_lines.find((l) => l.id === "l5")!, { state: "applied" });
    f.db.invoice_price_changes = [{ id: "chg-old", line_id: "l5", document_id: IDS.doc, venue_id: 1, target: "ordering_product", target_id: "prod-straws", kind: "price_change", mode: "approved", old_price: 20, new_price: 27.5, status: "applied", applied_by: "mon", applied_at: "2026-10-21T00:00:00Z" }];
    expect(await reanalyseNext(f.sb, deps())).toBe(false);
    const ex = reading();
    await saveAnalysis(f.sb, { fileId: IDS.file, venueId: 1, extracted: ex, analysis: analyseInvoice(ex, ctx()), pagePdfPath: null, readModel: "claude-sonnet-5-5", documentId: IDS.doc });
    expect(byNo(f, 5)).toMatchObject({ id: "l5", state: "applied", product_id: "prod-straws", old_product_price: 20, new_product_price: 27.5, decision: "needs_approval" });
    expect(f.db.invoice_price_changes).toEqual([expect.objectContaining({ id: "chg-old", target: "ordering_product", status: "applied", old_price: 20, new_price: 27.5 })]);
    expect(lineStatus(byNo(f, 5) as Parameters<typeof lineStatus>[0]).kind).toBe("changed");
    // the other lines were re-checked under the one-price rule
    expect(byNo(f, 2)).toMatchObject({ decision: "apply" });
    expect(byNo(f, 2).new_product_price ?? null).toBeNull();
    // its order price question has nothing left to ask
    expect(f.db.invoice_questions.find((q) => q.id === "q-straws")!.status).toBe("dismissed");
  });
});

describe("Approve Prices after the re-check", () => {
  it("lists the ingredient prices only: one row per line, never an order price, never the order-item-only line", async () => {
    const f = oldWorld();
    // before: version 3 rows as the new screen reads them (the straws line is already not a price to approve)
    const before = await loadApprovePrices(f.sb, null);
    expect(before.rows.map((r) => r.line.id).sort()).toEqual(["l1", "l2"]);
    expect(before.rows.every((r) => r.target === "ingredient")).toBe(true);

    await reanalyseNext(f.sb, deps());
    const after = await loadApprovePrices(f.sb, null);
    expect(after.rows.map((r) => [r.line.line_no, r.target, r.oldPrice, r.newPrice, r.flag]).sort()).toEqual([
      [1, "ingredient", 66.5, 68.9, null],
      [2, "ingredient", 40, 41.54, null],
    ]);
    expect(after.rows.some((r) => r.line.product_id === "prod-straws")).toBe(false);
    for (const r of after.rows) expect(Object.keys(r)).not.toContain("other");
    expect(JSON.stringify(after.rows.map((r) => ({ ...r, line: undefined })))).not.toMatch(ORDER_PRICE);
  });

  it("the invoice list words the outcome from the lines that really wait", async () => {
    const f = oldWorld();
    await reanalyseNext(f.sb, deps());
    const stats = outcomeStats(f.db.invoice_lines as unknown as Parameters<typeof outcomeStats>[0], openQuestions(f) as unknown as { document_id: string; kind: string }[]);
    const doc = f.db.invoice_documents[0];
    expect(stats.get(IDS.doc)).toMatchObject({ approve: 2, match: 0, checks: 0 });
    expect(outcomeView(doc as Parameters<typeof outcomeView>[0], stats.get(IDS.doc)!).word).toBe("Approve 2 prices");
  });
});

describe("applying after the re-check", () => {
  it("auto-apply writes the two ingredient prices and never touches an order item", async () => {
    const f = oldWorld();
    await reanalyseNext(f.sb, deps({ autoApply: applyDocumentAuto }));
    expect(f.db.cost_ingredients.map((i) => [i.id, i.pack_price])).toEqual([["ing-kingfish", 68.9], ["ing-barra", 41.54]]);
    expect(f.db.invoice_price_changes).toHaveLength(2);
    expect(f.db.invoice_price_changes.every((c) => c.target === "ingredient" && c.mode === "auto")).toBe(true);
    // the order items keep whatever stored price they had; nothing was written to them or their price log
    expect(f.db.ordering_products.map((p) => p.price_inc_gst)).toEqual([45, 20]);
    expect(f.db.ordering_price_log).toEqual([]);
    expect(orderWrites(f)).toEqual([]);
    expect(f.db.invoice_lines.map((l) => [l.line_no, l.state]).sort()).toEqual([[1, "applied"], [2, "applied"], [3, "open"], [4, "open"], [5, "open"]]);
    // nothing is left waiting on a person: the order-item-only line is not a pending price
    expect(f.db.invoice_documents[0].status).toBe("applied");
    expect((await loadApprovePrices(f.sb, null)).rows).toEqual([]);
  });
});

describe("the weekly review after the re-check", () => {
  function weeklyRaw(f: FakeSupabase): WeeklyRaw {
    const lines = f.db.invoice_lines as unknown as WeeklyRawLine[];
    return {
      now: NOW,
      venues: VENUES as WeeklyRaw["venues"],
      docs: f.db.invoice_documents as unknown as WeeklyRawDoc[],
      questions: openQuestions(f) as unknown as WeeklyRawQuestion[],
      questionLines: [],
      openLines: lines.filter((l) => l.state === "open" && l.line_class === "product" && (l.decision === "needs_approval" || l.decision === "apply")),
      periodLines: lines.filter((l) => l.line_class === "product"),
      changes: (f.db.invoice_price_changes ?? []).filter((c) => c.status === "applied") as WeeklyRaw["changes"],
      supplierNames: new Map([[SUP_DS, "Daniel Street Fish Market"]]),
      discounts: new Map(),
    };
  }

  it("lists ingredient price moves only, and counts only ingredient prices to approve", async () => {
    const f = oldWorld();
    // as version 3 left it, the new review already ignores the straws' order price
    const before = assembleWeeklyData(weeklyRaw(f), "https://example.test").venues.find((v) => v.venueSlug === "drift")!;
    expect(before.toApprove).toBe(2);
    expect(before.moves.map((m) => m.item)).not.toContain("Paper straws");

    await reanalyseNext(f.sb, deps());
    const data = assembleWeeklyData(weeklyRaw(f), "https://example.test");
    const drift = data.venues.find((v) => v.venueSlug === "drift")!;
    expect(drift.toApprove).toBe(2);
    expect(drift.toCheck).toBe(0);
    expect(drift.moves.map((m) => [m.item, m.oldPrice, m.newPrice]).sort()).toEqual([
      ["Humpty Doo Barramundi fillets per kg", 40, 41.54],
      ["Kingfish fillets skin on wing off per kg", 66.5, 68.9],
    ]);
    const text = buildWeeklyReview(data);
    expect(text).not.toMatch(/straws/i);
    expect(text).not.toMatch(ORDER_PRICE);
    expect(text).toContain("• Drift: 2 prices to approve");
  });

  it("after auto-apply it reports two prices updated and nothing to approve", async () => {
    const f = oldWorld();
    await reanalyseNext(f.sb, deps({ autoApply: applyDocumentAuto }));
    const data = assembleWeeklyData(weeklyRaw(f), "https://example.test");
    const drift = data.venues.find((v) => v.venueSlug === "drift")!;
    expect(drift).toMatchObject({ pricesUpdated: 2, toApprove: 0 });
    expect(buildWeeklyReview(data)).not.toMatch(ORDER_PRICE);
  });
});
