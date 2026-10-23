/**
 * Fixes from the independent review of lib/invoice-apply.ts: the write-time re-check (S1), the stale basis (S2), a same price is a
 * confirmation and never a price write (S9), one live change per line and target (M1), and confirmations on a document with
 * nothing else to apply (M3). Every test here failed before the fix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyDocumentAuto, applyLine } from "../lib/invoice-apply";
import { createFakeSupabase, type FakeSupabase } from "./helpers/fake-supabase";
import { document, ingredient, IDS, line, product, SETTINGS_AUTO, SUPPLIER } from "./helpers/invoice-fixtures";

// 24 Oct 2026, 12:00 in Brisbane
const NOW = new Date("2026-10-24T02:00:00Z");
const TODAY = "2026-10-24";

interface Over { doc?: Record<string, any>; lines?: Record<string, any>[]; ing?: Record<string, any>; settings?: Record<string, any>[]; products?: Record<string, any>[]; supplier?: Record<string, any>; deals?: Record<string, any>[] }

function setup(over: Over = {}): FakeSupabase {
  const f = createFakeSupabase({
    invoice_suppliers: [{ ...SUPPLIER, ...(over.supplier ?? {}) }],
    invoice_documents: [document(over.doc)],
    invoice_lines: over.lines ?? [line()],
    cost_ingredients: [ingredient(over.ing)],
    cost_ingredient_deals: over.deals ?? [],
    cost_price_log: [],
    cost_settings: over.settings ?? SETTINGS_AUTO,
    ordering_products: over.products ?? [],
    ordering_price_log: [],
  });
  f.installIngredientPriceTrigger(TODAY);
  return f;
}

const writes = (f: FakeSupabase) => f.log.filter((l) => l.op !== "select");
/** A small automatic change: 65 to 66.30 (2%), on an invoice that is a "go" for automatic apply. */
const autoOver = (over: Over = {}): Over => ({
  doc: { mode: "auto", ...(over.doc ?? {}) },
  lines: [line({ unit_price_ex: 66.3, new_pack_price: 66.3, change_pct: 0.02, decision: "apply", decision_reason: null })],
  ...over,
  ...(over.doc ? { doc: { mode: "auto", ...over.doc } } : {}),
});
const auto = (f: FakeSupabase) => applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "invoice-reader", mode: "auto" });
const approve = (f: FakeSupabase) => applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "mon@example.com", mode: "approved" });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("S1: automatic mode re-checks the trust rules at write time", () => {
  it("the baseline applies", async () => {
    const f = setup(autoOver());
    expect((await auto(f)).ok).toBe(true);
    expect(f.db.cost_ingredients[0].pack_price).toBe(66.3);
  });

  it("refuses when the supplier is no longer set to apply prices itself", async () => {
    const f = setup(autoOver({ supplier: { auto_apply: false } }));
    const r = await auto(f);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("supplier is no longer set to apply prices by itself");
    expect(f.db.cost_ingredients[0].pack_price).toBe(65);
    expect(writes(f)).toHaveLength(0);
  });

  it("refuses when the invoice has no supplier at all", async () => {
    const f = setup(autoOver({ doc: { supplier_id: null } }));
    expect((await auto(f)).ok).toBe(false);
    expect(writes(f)).toHaveLength(0);
  });

  it("refuses when the ingredient now has a deal in force or coming up", async () => {
    for (const deal of [{}, { ends_on: "2026-12-01" }, { ends_on: "2026-10-26" }, { starts_on: "2026-11-01" }]) {
      const f = setup(autoOver({ deals: [{ id: "d1", ingredient_id: IDS.kingfish, active: true, starts_on: null, ends_on: null, ...deal }] }));
      const r = await auto(f);
      expect(r.ok, JSON.stringify(deal)).toBe(false);
      expect(r.message).toContain("has a deal");
      expect(writes(f)).toHaveLength(0);
    }
  });

  it("a deal that has ended, or is switched off, does not stop it", async () => {
    for (const deal of [{ ends_on: "2026-10-01" }, { active: false }]) {
      const f = setup(autoOver({ deals: [{ id: "d1", ingredient_id: IDS.kingfish, active: true, starts_on: null, ends_on: null, ...deal }] }));
      expect((await auto(f)).ok, JSON.stringify(deal)).toBe(true);
    }
  });

  it("refuses when the ordering product has a free-unit deal", async () => {
    const lines = [line({ unit_price_ex: 66.3, new_pack_price: 66.3, product_id: IDS.kingfishProduct, old_product_price: 65, new_product_price: 66.3, decision: "apply" })];
    const f = setup({ ...autoOver(), lines, products: [product({ deal_buy_qty: 8, deal_free_qty: 1 })] });
    const r = await auto(f);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("free-unit deal");
    expect(f.db.ordering_products[0].price_inc_gst).toBe(65);
    expect(writes(f)).toHaveLength(0);
  });

  it("refuses when the price was updated after the date of the invoice", async () => {
    const f = setup(autoOver({ ing: { last_price_update: "2026-10-20" } })); // the invoice is dated 14 Oct
    const r = await auto(f);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("20 Oct 2026");
    expect(f.db.cost_ingredients[0].pack_price).toBe(65);
    expect(writes(f)).toHaveLength(0);
  });

  it("refuses an invoice more than 45 days old, accepts one that is exactly 45", async () => {
    const old = (date: string) => autoOver({ doc: { invoice_date: date }, ing: { last_price_update: "2026-07-01" }, lines: [line({ invoice_date: date, unit_price_ex: 66.3, new_pack_price: 66.3, decision: "apply" })] });
    const tooOld = setup(old("2026-09-08")); // 46 days
    const r = await auto(tooOld);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("45 days");
    expect(writes(tooOld)).toHaveLength(0);
    expect((await auto(setup(old("2026-09-09")))).ok).toBe(true); // 45 days
  });

  it("refuses an invoice with no date, or one dated in the future", async () => {
    for (const invoice_date of [null, "2026-11-05"]) {
      const f = setup(autoOver({ doc: { invoice_date } }));
      expect((await auto(f)).ok, String(invoice_date)).toBe(false);
      expect(writes(f)).toHaveLength(0);
    }
  });

  it("refuses when learning mode was switched back on, and when the limit was lowered", async () => {
    const learning = setup(autoOver({ settings: SETTINGS_AUTO.map((s) => (s.key === "invoice_learning_mode" ? { ...s, value: 1 } : s)) }));
    expect((await auto(learning)).message).toContain("Learning mode");
    const tight = setup(autoOver({ settings: SETTINGS_AUTO.map((s) => (s.key === "invoice_auto_apply_pct" ? { ...s, value: 0.01 } : s)) }));
    expect((await auto(tight)).message).toContain("automatic limit");
  });

  it("the person's own approval skips the trust rules: an old invoice, a deal, an untrusted supplier all still approve", async () => {
    const f = setup({
      supplier: { auto_apply: false },
      doc: { invoice_date: "2026-08-01" },
      ing: { last_price_update: "2026-07-01" },
      deals: [{ id: "d1", ingredient_id: IDS.kingfish, active: true, starts_on: null, ends_on: null }],
      lines: [line({ invoice_date: "2026-08-01" })],
    });
    expect((await approve(f)).ok).toBe(true);
    expect(f.db.cost_ingredients[0].pack_price).toBe(68.9);
  });

  it("a confirmation needs no supplier trust and no learning-mode switch-off", async () => {
    const f = setup({
      supplier: { auto_apply: false },
      settings: [{ key: "invoice_learning_mode", value: 1 }],
      lines: [line({ unit_price_ex: 65, new_pack_price: 65, decision: "same", change_pct: 0 })],
    });
    const r = await auto(f);
    expect(r.ok).toBe(true);
    expect(f.db.invoice_lines[0].state).toBe("confirmed");
    expect(f.db.cost_ingredients[0].pack_price).toBe(65);
  });

  it("an unreconciled invoice never confirms by itself either", async () => {
    const f = setup({ doc: { reconciled: false }, lines: [line({ unit_price_ex: 65, new_pack_price: 65, decision: "same", change_pct: 0 })] });
    expect((await auto(f)).ok).toBe(false);
    expect(writes(f)).toHaveLength(0);
  });
});

describe("S2: the numbers are worked out again from the line and the ingredient as it is now", () => {
  const STALE = "The ingredient's pack or GST setting changed since this invoice was read. Open the invoice and check it again.";

  it("refuses when the ingredient was switched to inc GST after the read, in both modes", async () => {
    for (const mode of ["approved", "auto"] as const) {
      const f = setup({
        doc: { mode: "auto" },
        ing: { price_inc_gst: true, gst_free: false },
        lines: [line({ gst: "taxable", unit_price_ex: 66.3, new_pack_price: 66.3, decision: mode === "auto" ? "apply" : "needs_approval" })],
      });
      const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "mon", mode });
      expect(r.ok, mode).toBe(false);
      expect(r.stale).toBe(true);
      expect(r.message).toBe(STALE);
      expect(f.db.cost_ingredients[0].pack_price).toBe(65);
      expect(writes(f)).toHaveLength(0);
    }
  });

  it("refuses when the ingredient was switched from inc GST to ex GST after the read", async () => {
    const f = setup({
      ing: { price_inc_gst: false, gst_free: false, pack_price: 71.5 },
      lines: [line({ gst: "taxable", unit_price_ex: 68, old_pack_price: 71.5, new_pack_price: 74.8 })], // worked out as inc GST: 68 x 1.1
    });
    const r = await approve(f);
    expect(r.message).toBe(STALE);
    expect(writes(f)).toHaveLength(0);
  });

  it("an inc GST ingredient is priced with GST on a taxable line, and that applies", async () => {
    const f = setup({
      ing: { price_inc_gst: true, gst_free: false, pack_price: 71.5 },
      lines: [line({ gst: "taxable", unit_price_ex: 68, old_pack_price: 71.5, new_pack_price: 74.8 })],
    });
    const r = await approve(f);
    expect(r.ok).toBe(true);
    expect(f.db.cost_ingredients[0].pack_price).toBe(74.8);
  });

  it("reads the GST rate from the settings", async () => {
    const f = setup({
      settings: [{ key: "gst_rate", value: 0.15 }],
      ing: { price_inc_gst: true, gst_free: false, pack_price: 71.5 },
      lines: [line({ gst: "taxable", unit_price_ex: 68, old_pack_price: 71.5, new_pack_price: 74.8 })], // worked out at 10%
    });
    expect((await approve(f)).message).toBe(STALE);
  });

  it("refuses when the pack size changed after the read, even if the price number did not", async () => {
    const f = setup({ ing: { pack_size: 2 } }); // 1.85 kg ordered was 1.85 packs; against a 2 kg pack it is 3.7 kg
    const r = await approve(f);
    expect(r.ok).toBe(false);
    expect(r.message).toBe(STALE);
    expect(f.db.cost_ingredients[0].pack_price).toBe(65);
    expect(writes(f)).toHaveLength(0);
  });

  it("refuses when the pack unit changed after the read", async () => {
    const f = setup({ ing: { pack_unit: "L" } });
    expect((await approve(f)).message).toBe(STALE);
  });

  it("a line whose recorded new price no longer matches its own unit price is refused", async () => {
    const f = setup({ lines: [line({ unit_price_ex: 68.9, new_pack_price: 60 })] });
    expect((await approve(f)).message).toBe(STALE);
  });

  it("a line with no packs per unit can never be applied or confirmed", async () => {
    for (const decision of ["needs_approval", "same"] as const) {
      const f = setup({ lines: [line({ packs_per_unit: null, decision })] });
      const r = await approve(f);
      expect(r.ok, decision).toBe(false);
      expect(r.message).toContain("pack size");
      expect(writes(f)).toHaveLength(0);
    }
  });

  it("packs per unit divide the unit price: a carton of 6 at $120 is $20 a pack", async () => {
    const f = setup({ ing: { pack_price: 18, pack_unit: "each", pack_size: 1 }, lines: [line({ unit: "CTN", qty: 2, base_qty: 12, base_unit: "each", packs_per_unit: 6, unit_price_ex: 120, old_pack_price: 18, new_pack_price: 20 })] });
    expect((await approve(f)).ok).toBe(true);
    expect(f.db.cost_ingredients[0].pack_price).toBe(20);
    const g = setup({ ing: { pack_price: 18, pack_unit: "each", pack_size: 1 }, lines: [line({ unit: "CTN", qty: 2, base_qty: 12, base_unit: "each", packs_per_unit: 6, unit_price_ex: 120, old_pack_price: 18, new_pack_price: 120 })] });
    expect((await approve(g)).message).toBe(STALE);
  });

  it("refuses when the ordering product's costing packs changed", async () => {
    const lines = [line({ product_id: IDS.kingfishProduct, old_product_price: 65, new_product_price: 75.79 })];
    const f = setup({ lines, products: [product({ costing_packs_per_unit: 6 })] });
    const r = await approve(f);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("pack size or ingredient link changed");
    expect(f.db.ordering_products[0].price_inc_gst).toBe(65);
    expect(writes(f)).toHaveLength(0);
  });

  it("refuses when the ordering product now points at another ingredient", async () => {
    const lines = [line({ product_id: IDS.kingfishProduct, old_product_price: 65, new_product_price: 75.79 })];
    const f = setup({ lines, products: [product({ ingredient_id: IDS.lychee })] });
    expect((await approve(f)).ok).toBe(false);
    expect(writes(f)).toHaveLength(0);
  });

  it("an ordering-only line (no ingredient) needs no pack size", async () => {
    const f = setup({ lines: [line({ ingredient_id: null, new_pack_price: null, old_pack_price: null, packs_per_unit: null, product_id: IDS.kingfishProduct, old_product_price: 65, new_product_price: 70 })], products: [product()] });
    expect((await approve(f)).ok).toBe(true);
    expect(f.db.ordering_products[0].price_inc_gst).toBe(70);
  });
});

describe("S9: a same price is a confirmation and never writes a price", () => {
  it("auto and approve both confirm instead of hitting a dead end, and the price log shows a confirmation", async () => {
    for (const mode of ["auto", "approved"] as const) {
      const f = setup({ lines: [line({ unit_price_ex: 65, new_pack_price: 65, change_pct: 0, decision: "same" })] });
      const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "x", mode });
      expect(r.ok, mode).toBe(true);
      expect(f.db.cost_ingredients[0].pack_price).toBe(65);
      expect(f.db.cost_price_log).toHaveLength(1);
      expect(f.db.cost_price_log[0]).toMatchObject({ old_price: 65, new_price: 65 });
      expect(f.db.cost_price_log[0].source).toContain("(price confirmed)");
    }
  });

  it("an ordering product within half a cent is confirmed without a write or a ledger row", async () => {
    const lines = [line({ ingredient_id: null, new_pack_price: null, old_pack_price: null, product_id: IDS.kingfishProduct, old_product_price: 65, new_product_price: 65.004, decision: "needs_approval" })];
    const f = setup({ lines, products: [product()] });
    const r = await approve(f);
    expect(r.ok).toBe(true);
    expect(f.db.ordering_products[0].price_inc_gst).toBe(65);
    expect(f.db.ordering_price_log).toHaveLength(0);
    expect(f.db.invoice_price_changes ?? []).toHaveLength(0);
    expect(f.db.invoice_lines[0].state).toBe("confirmed");
  });
});

describe("M1: one live change per line and target", () => {
  const oneLive = (f: FakeSupabase) => f.unique("invoice_price_changes", ["line_id", "target"], (r) => r.status === "applied");

  it("two taps at once: one applies, the other is told someone else did, and nothing is doubled", async () => {
    const f = setup();
    oneLive(f);
    const [a, b] = await Promise.all([approve(f), applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "matt", mode: "approved" })]);
    const ok = [a, b].filter((r) => r.ok);
    const lost = [a, b].find((r) => !r.ok)!;
    expect(ok).toHaveLength(1);
    expect(lost.message).toBe("Someone else has already applied this line.");
    expect(lost.changeIds).toEqual([]);
    expect(f.db.invoice_price_changes).toHaveLength(1);
    expect(f.db.cost_price_log).toHaveLength(1);
    expect(f.db.cost_ingredients[0].pack_price).toBe(68.9);
  });

  it("two confirmations at once make one ledger row and one log row", async () => {
    const f = setup({ lines: [line({ unit_price_ex: 65, new_pack_price: 65, change_pct: 0, decision: "same" })] });
    oneLive(f);
    const [a, b] = await Promise.all([auto(f), approve(f)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(f.db.invoice_price_changes).toHaveLength(1);
    expect(f.db.cost_price_log).toHaveLength(1);
  });

  it("a ledger conflict on the ordering product leaves the ingredient price in place and says so", async () => {
    const lines = [line({ product_id: IDS.kingfishProduct, old_product_price: 65, new_product_price: 75.79 })];
    const f = setup({ lines, products: [product()] });
    oneLive(f);
    // somebody else applies the ordering-product side while this one is writing the ingredient
    f.onUpdate("cost_ingredients", () => {
      if (f.db.invoice_price_changes.some((c) => c.id === "other")) return;
      f.db.invoice_price_changes.push({ id: "other", line_id: IDS.lineKingfish, document_id: IDS.doc, venue_id: 1, target: "ordering_product", target_id: IDS.kingfishProduct, kind: "price_change", status: "applied" });
    });
    const r = await approve(f);
    expect(r.ok).toBe(true);
    expect(r.message).toContain("applied by someone else");
    expect(f.db.cost_ingredients[0].pack_price).toBe(68.9);
    expect(f.db.ordering_products[0].price_inc_gst).toBe(65);
    expect(f.db.invoice_price_changes.filter((c) => c.status === "applied")).toHaveLength(2);
  });

  it("a failed guarded write takes its ledger row back, for a price change and for a confirmation", async () => {
    const change = setup();
    change.failNext("cost_ingredients", "update", "boom");
    expect((await approve(change)).ok).toBe(false);
    expect(change.db.invoice_price_changes ?? []).toHaveLength(0);
    expect(change.db.cost_ingredients[0].pack_price).toBe(65);

    const confirm = setup({ lines: [line({ unit_price_ex: 65, new_pack_price: 65, decision: "same", change_pct: 0 })] });
    confirm.failNext("cost_ingredients", "update", "boom");
    expect((await approve(confirm)).ok).toBe(false);
    expect(confirm.db.invoice_price_changes ?? []).toHaveLength(0);
    expect(confirm.db.cost_price_log).toHaveLength(0);
  });

  it("a failed ordering-product write takes its own ledger row back and keeps the ingredient change, saying so", async () => {
    const lines = [line({ product_id: IDS.kingfishProduct, old_product_price: 65, new_product_price: 75.79 })];
    const f = setup({ lines, products: [product()] });
    f.failNext("ordering_products", "update", "boom");
    const r = await approve(f);
    expect(r.ok).toBe(true);
    expect(r.message).toContain("left alone");
    expect(f.db.invoice_price_changes.filter((c) => c.target === "ordering_product")).toHaveLength(0);
    expect(f.db.invoice_price_changes.filter((c) => c.target === "ingredient")).toHaveLength(1);
    expect(f.db.ordering_products[0].price_inc_gst).toBe(65);
  });
});

describe("M3: confirmations on a document with nothing else to apply", () => {
  const sameLines = () => [
    line({ id: "a", line_no: 1, unit_price_ex: 65, new_pack_price: 65, change_pct: 0, decision: "same" }),
    line({ id: "b", line_no: 2, ingredient_id: IDS.barra, old_pack_price: 40, unit_price_ex: 40, new_pack_price: 40, change_pct: 0, decision: "same" }),
  ];
  const withBarra = (f: FakeSupabase) => {
    f.db.cost_ingredients.push(ingredient({ id: IDS.barra, name: "Barramundi", pack_price: 40 }));
    return f;
  };

  it("confirms the same-price lines of a nothing_to_apply document in learning mode and in auto mode", async () => {
    for (const mode of ["learning", "auto"]) {
      const f = withBarra(setup({ lines: sameLines(), doc: { mode, status: "nothing_to_apply" } }));
      const results = await applyDocumentAuto(f.sb, { documentId: IDS.doc, actor: "invoice-reader" });
      expect(results.map((r) => [r.lineId, r.ok]), mode).toEqual([["a", true], ["b", true]]);
      expect(f.db.invoice_lines.map((l) => l.state)).toEqual(["confirmed", "confirmed"]);
      expect(f.db.invoice_documents[0].status).toBe("applied");
      expect(f.db.cost_ingredients.map((i) => i.pack_price)).toEqual([65, 40]);
    }
  });

  it("never applies a real price change in learning mode, even on a document that is waiting", async () => {
    const lines = [...sameLines(), line({ id: "c", line_no: 3, ingredient_id: IDS.lychee, old_pack_price: 30, unit_price_ex: 33, new_pack_price: 33, change_pct: 0.1, decision: "apply" })];
    const f = withBarra(setup({ lines, doc: { mode: "learning", status: "nothing_to_apply" } }));
    f.db.cost_ingredients.push(ingredient({ id: IDS.lychee, name: "Lychee Liqueur", pack_price: 30 }));
    const results = await applyDocumentAuto(f.sb, { documentId: IDS.doc, actor: "invoice-reader" });
    expect(results.map((r) => r.lineId)).toEqual(["a", "b"]);
    expect(f.db.cost_ingredients.find((i) => i.id === IDS.lychee)!.pack_price).toBe(30);
    expect(f.db.invoice_lines.find((l) => l.id === "c")!.state).toBe("open");
  });

  it("still ignores applied, ignored and duplicate documents", async () => {
    for (const status of ["applied", "ignored", "duplicate", "failed"]) {
      const f = withBarra(setup({ lines: sameLines(), doc: { mode: "auto", status } }));
      expect(await applyDocumentAuto(f.sb, { documentId: IDS.doc, actor: "x" })).toEqual([]);
    }
  });
});
