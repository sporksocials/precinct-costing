import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerItemGroups, itemGroupsMessage } from "../lib/invoice-answer";
import type { AnalyseInvoice } from "../lib/invoice-interfaces";
import { descKey } from "../lib/invoice-names";
import type { AnalysedLine, AnalysedQuestion, ExtractedInvoice, InvoiceAnalysis } from "../lib/invoice-types";
import { createFakeSupabase, type FakeSupabase } from "./helpers/fake-supabase";
import { document, ingredient, line, SUPPLIER, VENUES } from "./helpers/invoice-fixtures";

const NOW = new Date("2026-10-25T02:00:00Z");
const TODAY = "2026-10-25";
const ING = { wedge: "ing-wedge" };
const SUP = SUPPLIER.id as string;

/** Matches by a learned code, asks about the rest, and counts how many times it is asked to look at an invoice. */
function makeEngine() {
  const state = { calls: [] as string[] };
  const analyse: AnalyseInvoice = (ex: ExtractedInvoice, ctx): InvoiceAnalysis => {
    state.calls.push(ex.invoice_number ?? "?");
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

const WEDGES = { code: "8229", description: "POTATO WEDGES SEASONED (MCCAIN) 2kg", price: 10.14 };
const RICOTTA = { code: "7366", description: "CHEESE RICOTTA 500gr", price: 7.68 };

/** Three invoices (Drift, Drift, Chiobu) from one supplier, each with the same two unmatched items. */
function setup(): FakeSupabase {
  const docs: Record<string, any>[] = [];
  const lines: Record<string, any>[] = [];
  const questions: Record<string, any>[] = [];
  [1, 2, 3].forEach((n) => {
    docs.push(document({ id: `doc-${n}`, invoice_number: `INV${n}`, invoice_date: `2026-10-${10 + n}`, venue_id: n === 3 ? 2 : 1 }));
    [WEDGES, RICOTTA].forEach((it, k) => {
      const id = `L${n}${k}`;
      lines.push(line({ id, document_id: `doc-${n}`, venue_id: n === 3 ? 2 : 1, line_no: k + 1, item_code: it.code, description: it.description, qty: 2, unit: "PKT", unit_price_ex: it.price, line_total_ex: it.price * 2, gst: "taxable", match_state: "unmatched", match_method: null, ingredient_id: null, packs_per_unit: null, old_pack_price: null, new_pack_price: null, change_pct: null, decision: "none", decision_reason: "Not matched" }));
      questions.push({ id: `Q${n}${k}`, venue_id: n === 3 ? 2 : 1, document_id: `doc-${n}`, line_id: id, kind: "unmatched_line", prompt: "x", status: "open", options: [{ id: "np", label: "Not a product", action: "not_a_product" }] });
    });
  });
  const f = createFakeSupabase({
    cost_venues: VENUES,
    cost_settings: [{ key: "gst_rate", value: 0.1 }, { key: "invoice_learning_mode", value: 1 }],
    invoice_suppliers: [SUPPLIER],
    invoice_files: [{ id: "file-1", venue_id: 1, storage_path: "x.pdf", sha256: "abc", status: "done", attempts: 0, error: null }],
    invoice_documents: docs,
    invoice_lines: lines,
    invoice_questions: questions,
    invoice_item_map: [],
    invoice_charge_rules: [],
    cost_ingredients: [ingredient({ id: ING.wedge, name: "Wedges", supplier_code: null, pack_price: 9.95 })],
    cost_ingredient_deals: [],
    cost_price_log: [],
    ordering_products: [],
    ordering_suppliers: [],
    ordering_price_log: [],
  });
  f.installIngredientPriceTrigger(TODAY);
  return f;
}

const wedgeAnswer = (ids: string[]) => ({ questionIds: ids, optionId: `custom:${ING.wedge}`, note: JSON.stringify({ ingredient_id: ING.wedge }) });
const ricottaAnswer = (ids: string[]) => ({ questionIds: ids, optionId: "not_a_product" });
const mapWrites = (f: FakeSupabase) => f.log.filter((o) => o.table === "invoice_item_map" && (o.op === "insert" || o.op === "update" || o.op === "upsert"));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("answerItemGroups: one choice settles every invoice that has the item", () => {
  it("answers all six questions of two items on three invoices, teaches each item ONCE, and looks at each invoice once", async () => {
    const f = setup();
    const eng = makeEngine();
    const r = await answerItemGroups(f.sb, { actor: "mon@example.com", groups: [wedgeAnswer(["Q10", "Q20", "Q30"]), ricottaAnswer(["Q11", "Q21", "Q31"])] }, { analyse: eng.analyse, today: TODAY });

    expect(r.ok).toBe(true);
    expect(r.groups.map((g) => [g.status, g.saved, g.failed])).toEqual([["saved", 3, 0], ["saved", 3, 0]]);
    expect(f.db.invoice_questions.filter((q) => q.status === "answered")).toHaveLength(6);
    expect(f.db.invoice_questions.every((q) => q.answered_by === "mon@example.com")).toBe(true);

    // two items, two map rows, written once each (no repeat updates), shared across venues
    const maps = f.db.invoice_item_map;
    expect(maps).toHaveLength(2);
    expect(mapWrites(f)).toHaveLength(2);
    expect(mapWrites(f).some((o) => o.op === "update")).toBe(false);
    expect(maps.find((m) => m.item_code === "8229")).toMatchObject({ supplier_id: SUP, ingredient_id: ING.wedge, rejected: false });
    expect(maps.find((m) => m.item_code === "8229")!.venue_id ?? null).toBeNull();
    expect(maps.find((m) => m.item_code === "7366")).toMatchObject({ rejected: true });

    // each invoice is looked at once, not once per answer
    expect([...eng.state.calls].sort()).toEqual(["INV1", "INV2", "INV3"]);

    // the ricotta lines are ignored everywhere; the wedge lines are matched and wait for a tap (10.14 against 9.95)
    const ofDoc = (n: number, code: string) => f.db.invoice_lines.find((l) => l.document_id === `doc-${n}` && l.item_code === code)!;
    for (const n of [1, 2, 3]) {
      expect(ofDoc(n, "7366")).toMatchObject({ state: "ignored" });
      expect(ofDoc(n, "8229")).toMatchObject({ match_state: "matched", ingredient_id: ING.wedge, decision: "needs_approval" });
    }
    expect(r.message).toBe("Saved 1 match. 1 item marked Not In The App. 3 prices ready to approve.");
  });

  it("is safe to run again: every item reads as already done, nothing is written or looked at twice", async () => {
    const f = setup();
    const eng = makeEngine();
    const groups = [wedgeAnswer(["Q10", "Q20", "Q30"]), ricottaAnswer(["Q11", "Q21", "Q31"])];
    await answerItemGroups(f.sb, { actor: "mon", groups }, { analyse: eng.analyse, today: TODAY });
    const writes = mapWrites(f).length;
    const calls = eng.state.calls.length;
    const again = await answerItemGroups(f.sb, { actor: "mon", groups }, { analyse: eng.analyse, today: TODAY });
    expect(again.ok).toBe(true);
    expect(again.groups.map((g) => g.status)).toEqual(["already", "already"]);
    expect(again.message).toBe("2 items were already done.");
    expect(mapWrites(f)).toHaveLength(writes);
    expect(eng.state.calls).toHaveLength(calls);
  });

  it("an item that was half answered (someone answered one invoice first) still teaches and settles the rest", async () => {
    const f = setup();
    f.db.invoice_questions.find((q) => q.id === "Q10")!.status = "answered";
    const eng = makeEngine();
    const r = await answerItemGroups(f.sb, { actor: "mon", groups: [wedgeAnswer(["Q10", "Q20", "Q30"])] }, { analyse: eng.analyse, today: TODAY });
    expect(r.groups[0]).toMatchObject({ status: "saved", saved: 2, already: 1, failed: 0 });
    // the first question skipped the learning, so the second one taught it, and only once
    expect(f.db.invoice_item_map).toHaveLength(1);
    expect(mapWrites(f)).toHaveLength(1);
  });

  it("a question that no longer needs an answer counts as already done, not as a failure", async () => {
    const f = setup();
    f.db.invoice_questions.find((q) => q.id === "Q20")!.status = "dismissed";
    const r = await answerItemGroups(f.sb, { actor: "mon", groups: [wedgeAnswer(["Q10", "Q20", "Q30"])] }, { analyse: makeEngine().analyse, today: TODAY });
    expect(r.ok).toBe(true);
    expect(r.groups[0]).toMatchObject({ status: "saved", saved: 2, already: 1 });
  });

  it("reports each item on its own: a missing ingredient fails that item, a missing question makes another partial, the rest save", async () => {
    const f = setup();
    const eng = makeEngine();
    const r = await answerItemGroups(
      f.sb,
      {
        actor: "mon",
        groups: [
          { questionIds: ["Q10", "Q20", "Q30"], optionId: "custom:ing-gone", note: JSON.stringify({ ingredient_id: "ing-gone" }) },
          { questionIds: ["Q11", "Q21", "Q-missing"], optionId: "not_a_product" },
        ],
      },
      { analyse: eng.analyse, today: TODAY },
    );
    expect(r.ok).toBe(false);
    expect(r.groups[0]).toMatchObject({ status: "failed", saved: 0, failed: 3 });
    expect(r.groups[0].message).toContain("could not be found");
    expect(r.groups[1]).toMatchObject({ status: "partial", saved: 2, failed: 1 });
    expect(r.groups[1].message).toContain("no longer exists");
    // the failed item stays open on every invoice; the half that saved is learned
    expect(f.db.invoice_questions.filter((q) => ["Q10", "Q20", "Q30"].includes(q.id)).every((q) => q.status === "open")).toBe(true);
    expect(f.db.invoice_item_map).toHaveLength(1);
    expect(r.message).toBe("2 items could not be saved.");
  });

  it("sends nothing when no item was chosen", async () => {
    const f = setup();
    const r = await answerItemGroups(f.sb, { actor: "mon", groups: [] });
    expect(r).toMatchObject({ ok: true, message: "Nothing was saved.", groups: [] });
    expect(f.log).toHaveLength(0);
  });

  it("words the summary in items, never in questions", () => {
    expect(itemGroupsMessage({ matches: 9, ignored: 3, already: 1, failed: 2, waiting: 4, autoApplied: 1 })).toBe(
      "Saved 9 matches. 3 items marked Not In The App. 1 price applied automatically. 4 prices ready to approve. 1 item was already done. 2 items could not be saved.",
    );
    expect(itemGroupsMessage({ matches: 0, ignored: 0, already: 0, failed: 0, waiting: 0, autoApplied: 0 })).toBe("Nothing was saved.");
  });
});
