import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyDocumentAuto, applyLine, invoiceSourceLabel, money, undoChange, undoDocument } from "../lib/invoice-apply";
import { createFakeSupabase, type FakeSupabase } from "./helpers/fake-supabase";
import { document, ingredient, IDS, line, product, SETTINGS_AUTO, SUPPLIER } from "./helpers/invoice-fixtures";

// 24 Oct 2026, 12:00 in Brisbane
const NOW = new Date("2026-10-24T02:00:00Z");
const TODAY = "2026-10-24";
const LABEL = "Invoice 51329 · Daniel Street Fish Market · 14 Oct 2026";

function setup(over: { doc?: Record<string, any>; lines?: Record<string, any>[]; ing?: Record<string, any>; settings?: Record<string, any>[]; products?: Record<string, any>[] } = {}): FakeSupabase {
  const f = createFakeSupabase({
    invoice_suppliers: [SUPPLIER],
    invoice_documents: [document(over.doc)],
    invoice_lines: over.lines ?? [line()],
    cost_ingredients: [ingredient(over.ing)],
    cost_price_log: [],
    cost_settings: over.settings ?? SETTINGS_AUTO,
    ordering_products: over.products ?? [],
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

describe("invoiceSourceLabel and money", () => {
  it("builds the one wording the price log shows", () => {
    expect(invoiceSourceLabel({ invoice_number: "51329", invoice_date: "2026-10-14" }, "Daniel Street Fish Market")).toBe(LABEL);
    expect(invoiceSourceLabel({ invoice_number: "ENV-34730", invoice_date: "2026-10-22" }, "Diablo Co")).toBe("Invoice ENV-34730 · Diablo Co · 22 Oct 2026");
  });
  it("copes with a missing number, supplier or date", () => {
    expect(invoiceSourceLabel({ invoice_number: null, invoice_date: null }, null)).toBe("Invoice (no number) · Unknown supplier");
  });
  it("shows dollars to the cent, and more places only when the price has them", () => {
    expect(money(68.9)).toBe("$68.90");
    expect(money(0.0833)).toBe("$0.0833");
    expect(money(null)).toBe("no price");
  });
});

describe("applyLine: an approved price change", () => {
  it("writes the price, the label, the ledger and settles the line and the document", async () => {
    const f = setup();
    const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "mon@example.com", mode: "approved" });
    expect(r.ok).toBe(true);
    expect(r.message).toBe("Kingfish Fillets is now $68.90 (was $65.00).");

    const ing = f.db.cost_ingredients[0];
    expect(ing.pack_price).toBe(68.9);
    expect(ing.source).toBe(LABEL);
    expect(ing.previous_price).toBe(65); // the trigger
    expect(ing.last_price_update).toBe("2026-10-14"); // the invoice date: later than the old 1 Oct, earlier than today

    // the existing trigger wrote the price history, labelled with the invoice
    expect(f.db.cost_price_log).toHaveLength(1);
    expect(f.db.cost_price_log[0]).toMatchObject({ ingredient_id: IDS.kingfish, old_price: 65, new_price: 68.9, source: LABEL });

    const [ledger] = f.db.invoice_price_changes;
    expect(r.changeIds).toEqual([ledger.id]);
    expect(ledger).toMatchObject({
      line_id: IDS.lineKingfish, document_id: IDS.doc, venue_id: 1, target: "ingredient", target_id: IDS.kingfish, kind: "price_change", mode: "approved",
      old_price: 65, new_price: 68.9, old_last_price_update: "2026-10-01", old_previous_price: 62, old_source: "Daniel Street price list",
      cost_log_id: f.db.cost_price_log[0].id, status: "applied", applied_by: "mon@example.com",
    });
    expect(f.db.invoice_lines[0].state).toBe("applied");
    expect(f.db.invoice_documents[0].status).toBe("applied");
  });

  it("does not move last_price_update to an invoice date at or before the old one", async () => {
    const f = setup({ doc: { invoice_date: "2026-09-20" }, ing: { last_price_update: "2026-10-01" } });
    await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "mon", mode: "approved" });
    expect(f.db.cost_ingredients[0].last_price_update).toBe(TODAY); // left as the trigger set it, never earlier than before
    expect(f.db.cost_ingredients[0].last_price_update >= "2026-10-01").toBe(true);
  });

  it("an invoice dated today leaves the date to the trigger", async () => {
    const f = setup({ doc: { invoice_date: TODAY } });
    await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "mon", mode: "approved" });
    expect(f.db.cost_ingredients[0].last_price_update).toBe(TODAY);
  });

  it("refuses when the price changed since the analysis, and writes nothing at all", async () => {
    const f = setup({ ing: { pack_price: 66.5 } });
    const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "mon", mode: "approved" });
    expect(r.ok).toBe(false);
    expect(r.stale).toBe(true);
    expect(r.message).toContain("changed since this invoice was read");
    expect(f.db.cost_ingredients[0].pack_price).toBe(66.5);
    expect(f.db.invoice_price_changes ?? []).toHaveLength(0);
    expect(f.db.cost_price_log).toHaveLength(0);
    expect(f.db.invoice_lines[0].state).toBe("open");
    expect(f.log.filter((l) => l.op !== "select")).toHaveLength(0);
  });

  it("tolerates float noise below 0.00005", async () => {
    const f = setup({ ing: { pack_price: 65.00003 } });
    const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "mon", mode: "approved" });
    expect(r.ok).toBe(true);
  });

  it("two taps at once change the price once", async () => {
    const f = setup();
    const [a, b] = await Promise.all([
      applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "mon", mode: "approved" }),
      applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "matt", mode: "approved" }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(f.db.cost_ingredients[0].pack_price).toBe(68.9);
    expect(f.db.invoice_price_changes).toHaveLength(1); // the loser's ledger row was taken back
    expect(f.db.cost_price_log).toHaveLength(1);
  });

  it("refuses a line that is not a matched product, or already applied", async () => {
    const f = setup({ lines: [line({ match_state: "unmatched", ingredient_id: null })] });
    expect((await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "mon", mode: "approved" })).ok).toBe(false);
    const g = setup();
    await applyLine(g.sb, { lineId: IDS.lineKingfish, actor: "mon", mode: "approved" });
    const again = await applyLine(g.sb, { lineId: IDS.lineKingfish, actor: "mon", mode: "approved" });
    expect(again.ok).toBe(false);
    expect(g.db.invoice_price_changes).toHaveLength(1);
  });

  it("does not apply on an ignored or duplicate invoice", async () => {
    const f = setup({ doc: { status: "ignored" } });
    expect((await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "mon", mode: "approved" })).ok).toBe(false);
    expect(f.db.cost_ingredients[0].pack_price).toBe(65);
  });

  it("takes the ledger row back if the database refuses the price write", async () => {
    const f = setup();
    f.failNext("cost_ingredients", "update", "boom");
    const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "mon", mode: "approved" });
    expect(r.ok).toBe(false);
    expect(f.db.invoice_price_changes).toHaveLength(0);
    expect(f.db.cost_ingredients[0].pack_price).toBe(65);
  });
});

describe("applyLine: price confirmed", () => {
  const same = () => ({ lines: [line({ unit_price_ex: 65, new_pack_price: 65, change_pct: 0, decision: "same", decision_reason: null })] });

  it("changes no price, dates the confirmation to the invoice and logs it", async () => {
    const f = setup(same());
    const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "system", mode: "auto" });
    expect(r.ok).toBe(true);
    expect(r.message).toBe("Kingfish Fillets: price confirmed at $65.00.");
    const ing = f.db.cost_ingredients[0];
    expect(ing.pack_price).toBe(65);
    expect(ing.source).toBe("Daniel Street price list"); // untouched
    expect(ing.last_price_update).toBe("2026-10-14");
    expect(f.db.cost_price_log).toHaveLength(1);
    expect(f.db.cost_price_log[0]).toMatchObject({ old_price: 65, new_price: 65, source: `${LABEL} (price confirmed)`, entered_by: "system" });
    expect(f.db.invoice_price_changes[0]).toMatchObject({ kind: "price_confirmed", old_price: 65, new_price: 65, old_last_price_update: "2026-10-01", mode: "auto", cost_log_id: f.db.cost_price_log[0].id });
    expect(f.db.invoice_lines[0].state).toBe("confirmed");
  });

  it("never moves last_price_update backwards", async () => {
    const f = setup({ ...same(), doc: { invoice_date: "2026-09-01" } });
    await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "system", mode: "auto" });
    expect(f.db.cost_ingredients[0].last_price_update).toBe("2026-10-01");
  });

  it("an invoice dated in the future never pushes the date past today", async () => {
    const f = setup({ ...same(), doc: { invoice_date: "2027-01-05" } });
    await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "system", mode: "auto" });
    expect(f.db.cost_ingredients[0].last_price_update).toBe(TODAY);
  });

  it("is stale if the price moved, because it is no longer a confirmation", async () => {
    const f = setup({ ...same(), ing: { pack_price: 64 } });
    const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "system", mode: "auto" });
    expect(r.stale).toBe(true);
    expect(f.db.invoice_price_changes ?? []).toHaveLength(0);
  });

  it("a line decided 'same' whose numbers differ is still only a confirmation: it never writes a price", async () => {
    const f = setup({ lines: [line({ decision: "same" })] }); // new 68.90 vs old 65
    const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "system", mode: "auto" });
    expect(r.ok).toBe(true);
    expect(f.db.cost_ingredients[0].pack_price).toBe(65);
    expect(f.db.invoice_price_changes[0]).toMatchObject({ kind: "price_confirmed", old_price: 65, new_price: 65 });
    expect(f.db.invoice_lines[0].state).toBe("confirmed");
  });

  it("a price within half a cent of the current one is a confirmation even when the decision says apply or needs approval", async () => {
    for (const mode of ["auto", "approved"] as const) {
      const f = setup({ doc: { mode: "auto" }, lines: [line({ unit_price_ex: 65.004, new_pack_price: 65.004, decision: mode === "auto" ? "apply" : "needs_approval" })] });
      const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "mon", mode });
      expect(r.ok, mode).toBe(true);
      expect(r.message).toBe("Kingfish Fillets: price confirmed at $65.00.");
      expect(f.db.cost_ingredients[0].pack_price).toBe(65); // no price written
      expect(f.db.invoice_price_changes[0].kind).toBe("price_confirmed");
      expect(f.db.invoice_lines[0].state).toBe("confirmed");
    }
  });

  it("a difference of half a cent or more is a real change and uses the guarded price write", async () => {
    const f = setup({ lines: [line({ unit_price_ex: 65.006, new_pack_price: 65.006, decision: "needs_approval" })] });
    const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "mon", mode: "approved" });
    expect(r.ok).toBe(true);
    expect(f.db.cost_ingredients[0].pack_price).toBe(65.006);
    expect(f.db.invoice_price_changes[0].kind).toBe("price_change");
  });

  it("approving a same-price line confirms it instead of refusing", async () => {
    const f = setup(same());
    const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "mon", mode: "approved" });
    expect(r.ok).toBe(true);
    expect(f.db.invoice_lines[0].state).toBe("confirmed");
  });
});

/**
 * One card per product (Troy, 23 Nov 2026): the order item's own stored price is retired, so an invoice writes ONE price, the
 * ingredient's pack price. These lines carry the order item for the record, and some carry the order price pair an analysis before
 * that date stored (old_product_price / new_product_price): nothing may ever be written to ordering_products from them.
 */
describe("applyLine writes one price: the ingredient's pack price", () => {
  /** every write (anything but a read) made to the order item table or its price log */
  const orderWrites = (f: FakeSupabase) => f.log.filter((l) => l.op !== "select" && (l.table === "ordering_products" || l.table === "ordering_price_log"));

  it("a line linked to an ingredient with an order item writes cost_ingredients only, with ONE ledger row", async () => {
    const f = setup({ lines: [line({ product_id: IDS.kingfishProduct })], products: [product()] });
    const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "mon", mode: "approved" });
    expect(r.ok).toBe(true);
    expect(r.message).toBe("Kingfish Fillets is now $68.90 (was $65.00).");
    expect(r.changeIds).toHaveLength(1);
    expect(f.db.cost_ingredients[0].pack_price).toBe(68.9);
    expect(f.db.invoice_price_changes).toHaveLength(1);
    expect(f.db.invoice_price_changes[0]).toMatchObject({ target: "ingredient", target_id: IDS.kingfish, old_price: 65, new_price: 68.9 });
    // the order item is untouched: no update, no price log row, not even a read in approved mode
    expect(f.db.ordering_products[0].price_inc_gst).toBe(65);
    expect(f.db.ordering_price_log).toHaveLength(0);
    expect(f.log.filter((l) => l.table === "ordering_products")).toHaveLength(0);
    expect(f.db.invoice_lines[0].state).toBe("applied");
  });

  it("an older line that still carries an order price pair writes the ingredient only and says nothing about an order price", async () => {
    const f = setup({ lines: [line({ product_id: IDS.kingfishProduct, old_product_price: 65, new_product_price: 75.79 })], products: [product()] });
    const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "mon", mode: "approved" });
    expect(r.ok).toBe(true);
    expect(r.changeIds).toHaveLength(1);
    expect(r.message).not.toMatch(/order price/i);
    expect(f.db.cost_ingredients[0].pack_price).toBe(68.9);
    expect(f.db.ordering_products[0].price_inc_gst).toBe(65);
    expect(orderWrites(f)).toHaveLength(0);
    expect(f.db.invoice_price_changes.some((c) => c.target === "ordering_product")).toBe(false);
  });

  it("the order item's stored price moving is no longer a stale check: the ingredient still applies", async () => {
    const f = setup({ lines: [line({ product_id: IDS.kingfishProduct, old_product_price: 65, new_product_price: 75.79 })], products: [product({ price_inc_gst: 70 })] });
    const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "mon", mode: "approved" });
    expect(r.ok).toBe(true);
    expect(f.db.cost_ingredients[0].pack_price).toBe(68.9);
    expect(f.db.ordering_products[0].price_inc_gst).toBe(70);
    expect(orderWrites(f)).toHaveLength(0);
  });

  it("the ingredient's own stale check still refuses, and writes nothing at all", async () => {
    const f = setup({ lines: [line({ product_id: IDS.kingfishProduct })], products: [product()], ing: { pack_price: 66.5 } });
    const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "mon", mode: "approved" });
    expect(r.ok).toBe(false);
    expect(r.stale).toBe(true);
    expect(f.log.filter((l) => l.op !== "select")).toHaveLength(0);
  });

  it("a line matched only to an order item (no ingredient) is refused in plain words, never an error, and writes nothing", async () => {
    for (const mode of ["approved", "auto"] as const) {
      for (const over of [
        // as a new analysis stores it: nothing proposed
        { ingredient_id: null, old_pack_price: null, new_pack_price: null, product_id: IDS.kingfishProduct, decision: "none", decision_reason: "No costing ingredient to update." },
        // as an analysis before 23 Nov 2026 stored it: an order price waiting for approval
        { ingredient_id: null, old_pack_price: null, new_pack_price: null, product_id: IDS.kingfishProduct, old_product_price: 65, new_product_price: 70, decision: mode === "auto" ? "apply" : "needs_approval" },
      ]) {
        const f = setup({ lines: [line(over)], products: [product()], doc: { mode: "auto" } });
        const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "mon", mode });
        expect(r.ok).toBe(false);
        expect(r.message).not.toMatch(/^Nothing was changed\./); // not the caught-exception wording
        expect(r.message).not.toMatch(/[—–]/);
        expect(f.db.ordering_products[0].price_inc_gst).toBe(65);
        expect(f.log.filter((l) => l.op !== "select")).toHaveLength(0);
        expect(f.db.invoice_lines[0].state).toBe("open");
      }
    }
  });

  it("says there is no costing ingredient when an older order-price line is approved", async () => {
    const f = setup({ lines: [line({ ingredient_id: null, old_pack_price: null, new_pack_price: null, product_id: IDS.kingfishProduct, old_product_price: null, new_product_price: 70 })], products: [product({ price_inc_gst: null })] });
    const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "mon", mode: "approved" });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("No costing ingredient to update.");
    expect(f.db.ordering_products[0].price_inc_gst).toBeNull();
  });

  it("an order item that belongs to another venue is not a reason to refuse: only the shared ingredient price is written", async () => {
    const f = setup({ lines: [line({ product_id: IDS.kingfishProduct })], products: [product({ venue_id: 2 })] });
    const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "mon", mode: "approved" });
    expect(r.ok).toBe(true);
    expect(f.db.ordering_products[0].price_inc_gst).toBe(65);
  });

  it("automatic mode applies the ingredient only, and only READS the order item (its free-unit deal)", async () => {
    const f = setup({ lines: [line({ product_id: IDS.kingfishProduct, unit_price_ex: 66.3, new_pack_price: 66.3, change_pct: 0.02, decision: "apply", decision_reason: null })], products: [product()], doc: { mode: "auto" } });
    const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "system", mode: "auto" });
    expect(r.ok).toBe(true);
    expect(f.db.cost_ingredients[0].pack_price).toBe(66.3);
    expect(f.db.ordering_products[0].price_inc_gst).toBe(65);
    expect(orderWrites(f)).toHaveLength(0);
    expect(f.log.filter((l) => l.table === "ordering_products").every((l) => l.op === "select")).toBe(true);
  });

  it("automatic mode still refuses when the linked order item now has a free-unit deal", async () => {
    const f = setup({ lines: [line({ product_id: IDS.kingfishProduct, unit_price_ex: 66.3, new_pack_price: 66.3, change_pct: 0.02, decision: "apply", decision_reason: null })], products: [product({ deal_buy_qty: 8, deal_free_qty: 1 })], doc: { mode: "auto" } });
    const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "system", mode: "auto" });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("free-unit deal");
    expect(f.db.cost_ingredients[0].pack_price).toBe(65);
    expect(f.log.filter((l) => l.op !== "select")).toHaveLength(0);
  });

  it("the module has exactly ONE update of ordering_products left, inside the undo of an older ledger row", () => {
    const src = readFileSync(new URL("../lib/invoice-apply.ts", import.meta.url), "utf8");
    const updates = src.match(/from\("ordering_products"\)\.update\(/g) ?? [];
    expect(updates).toHaveLength(1);
    const undoStart = src.indexOf("async function undoInner");
    expect(undoStart).toBeGreaterThan(0);
    expect(src.indexOf('from("ordering_products").update(')).toBeGreaterThan(undoStart);
    // and no ledger row is ever written for an order item
    expect(src).not.toMatch(/target: "ordering_product"/);
    expect(src.slice(0, undoStart)).not.toContain("ordering_price_log");
  });
});

describe("applyLine: automatic mode is paranoid", () => {
  const near = () => ({ lines: [line({ unit_price_ex: 66.3, new_pack_price: 66.3, change_pct: 0.02, decision: "apply", decision_reason: null })], doc: { mode: "auto" } });

  it("applies a small change when everything allows it", async () => {
    const f = setup(near());
    const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "system", mode: "auto" });
    expect(r.ok).toBe(true);
    expect(f.db.cost_ingredients[0].pack_price).toBe(66.3);
    expect(f.db.invoice_price_changes[0].mode).toBe("auto");
  });

  it("refuses a line that needs approval", async () => {
    const f = setup({ ...near(), lines: [line({ unit_price_ex: 66.3, new_pack_price: 66.3, decision: "needs_approval" })] });
    expect((await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "system", mode: "auto" })).ok).toBe(false);
    expect(f.db.cost_ingredients[0].pack_price).toBe(65);
  });

  it("refuses while learning mode is on (or the setting is missing)", async () => {
    for (const settings of [[{ key: "invoice_learning_mode", value: 1 }], []]) {
      const f = setup({ ...near(), settings });
      const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "system", mode: "auto" });
      expect(r.ok).toBe(false);
      expect(r.message).toContain("Learning mode");
      expect(f.db.cost_ingredients[0].pack_price).toBe(65);
    }
  });

  it("refuses a change at or over the limit even if the line says apply", async () => {
    const f = setup({ ...near(), lines: [line({ unit_price_ex: 68.25, new_pack_price: 68.25, decision: "apply" })] }); // exactly 5%
    expect((await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "system", mode: "auto" })).ok).toBe(false);
  });

  it("the venue check never stops an apply: a mismatch or unknown venue still applies", async () => {
    for (const venue_check of ["mismatch", "unknown"]) {
      const f = setup({ ...near(), doc: { mode: "auto", venue_check } });
      const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "system", mode: "auto" });
      expect(r.ok).toBe(true);
      expect(f.db.cost_ingredients[0].pack_price).toBe(66.3);
    }
  });

  it("refuses an unreconciled invoice and a learning-mode invoice", async () => {
    for (const doc of [{ mode: "auto", reconciled: false }, { mode: "learning" }]) {
      const f = setup({ ...near(), doc });
      expect((await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "system", mode: "auto" })).ok).toBe(false);
      expect(f.db.cost_ingredients[0].pack_price).toBe(65);
    }
  });
});

describe("applyDocumentAuto", () => {
  const twoLines = () => [
    line({ id: "a", line_no: 1, unit_price_ex: 66.3, new_pack_price: 66.3, decision: "apply" }),
    line({ id: "b", line_no: 2, ingredient_id: IDS.barra, old_pack_price: 40, unit_price_ex: 40, new_pack_price: 40, decision: "same" }),
    line({ id: "c", line_no: 3, ingredient_id: IDS.lychee, old_pack_price: 30, unit_price_ex: 35, new_pack_price: 35, decision: "needs_approval" }),
  ];
  const withIngs = (f: FakeSupabase) => {
    f.db.cost_ingredients.push(ingredient({ id: IDS.barra, name: "Barramundi", pack_price: 40 }), ingredient({ id: IDS.lychee, name: "Lychee Liqueur", pack_price: 30 }));
    return f;
  };

  it("in auto mode applies the apply lines and the confirmations, and leaves the rest", async () => {
    const f = withIngs(setup({ lines: twoLines(), doc: { mode: "auto" } }));
    const results = await applyDocumentAuto(f.sb, { documentId: IDS.doc, actor: "system" });
    expect(results.map((r) => [r.lineId, r.ok])).toEqual([["a", true], ["b", true]]);
    expect(f.db.invoice_lines.map((l) => l.state)).toEqual(["applied", "confirmed", "open"]);
    expect(f.db.invoice_documents[0].status).toBe("partly_applied");
  });

  it("in learning mode applies nothing except confirmations", async () => {
    const f = withIngs(setup({ lines: twoLines(), doc: { mode: "learning" } }));
    const results = await applyDocumentAuto(f.sb, { documentId: IDS.doc, actor: "system" });
    expect(results.map((r) => r.lineId)).toEqual(["b"]);
    expect(f.db.cost_ingredients[0].pack_price).toBe(65);
    expect(f.db.invoice_lines.map((l) => l.state)).toEqual(["open", "confirmed", "open"]);
  });

  it("does nothing for a document that is not waiting (applied, ignored)", async () => {
    for (const status of ["applied", "ignored", "duplicate"]) {
      const f = withIngs(setup({ lines: twoLines(), doc: { mode: "auto", status } }));
      expect(await applyDocumentAuto(f.sb, { documentId: IDS.doc, actor: "system" })).toEqual([]);
    }
  });
});

describe("undoChange", () => {
  async function applied(over: Parameters<typeof setup>[0] = {}) {
    const f = setup(over);
    const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "mon", mode: "approved" });
    return { f, changeId: r.changeIds[0] };
  }

  it("restores the price, previous price, price date and source, and logs the undo", async () => {
    const { f, changeId } = await applied();
    vi.setSystemTime(new Date("2026-10-25T02:00:00Z"));
    const r = await undoChange(f.sb, { changeId, actor: "troy@example.com" });
    expect(r.ok).toBe(true);
    expect(r.message).toBe("Kingfish Fillets is back to $65.00 (was $68.90).");
    expect(f.db.cost_ingredients[0]).toMatchObject({ pack_price: 65, previous_price: 62, last_price_update: "2026-10-01", source: "Daniel Street price list" });
    // history: the apply row and an Undo row naming the invoice
    expect(f.db.cost_price_log).toHaveLength(2);
    expect(f.db.cost_price_log[1]).toMatchObject({ old_price: 68.9, new_price: 65, source: `Undo: ${LABEL}` });
    expect(f.db.invoice_price_changes[0]).toMatchObject({ status: "reverted", reverted_by: "troy@example.com" });
    expect(f.db.invoice_price_changes[0].reverted_at).toBeTruthy();
    expect(f.db.invoice_price_changes[0].revert_note).toContain("Undone by troy@example.com");
    expect(f.db.invoice_price_changes[0].revert_note).toContain(`price log row ${f.db.cost_price_log[1].id}`);
    expect(f.db.invoice_lines[0].state).toBe("reverted");
    expect(f.db.invoice_documents[0].status).toBe("nothing_to_apply");
  });

  it("restores a null previous price and source", async () => {
    const { f, changeId } = await applied({ ing: { previous_price: null, source: null, last_price_update: null } });
    await undoChange(f.sb, { changeId, actor: "troy" });
    expect(f.db.cost_ingredients[0]).toMatchObject({ pack_price: 65, previous_price: null, last_price_update: null, source: null });
  });

  it("will not undo over someone else's later price without force", async () => {
    const { f, changeId } = await applied();
    f.db.cost_ingredients[0].pack_price = 70.1; // someone changed it afterwards
    const r = await undoChange(f.sb, { changeId, actor: "troy" });
    expect(r).toMatchObject({ ok: false, needsForce: true, currentPrice: 70.1 });
    expect(f.db.cost_ingredients[0].pack_price).toBe(70.1);
    expect(f.db.invoice_price_changes[0].status).toBe("applied");
    const forced = await undoChange(f.sb, { changeId, actor: "troy", force: true });
    expect(forced.ok).toBe(true);
    expect(f.db.cost_ingredients[0].pack_price).toBe(65);
    expect(f.db.invoice_price_changes[0].revert_note).toContain("forced after the price had been changed to $70.10");
  });

  it("cannot be undone twice", async () => {
    const { f, changeId } = await applied();
    await undoChange(f.sb, { changeId, actor: "troy" });
    const r = await undoChange(f.sb, { changeId, actor: "troy" });
    expect(r.ok).toBe(false);
    expect(f.db.cost_price_log).toHaveLength(2);
  });

  it("undoes a price confirmation by putting the date back, without touching history", async () => {
    const f = setup({ lines: [line({ unit_price_ex: 65, new_pack_price: 65, decision: "same" })] });
    const r = await applyLine(f.sb, { lineId: IDS.lineKingfish, actor: "system", mode: "auto" });
    const logRows = f.db.cost_price_log.length;
    const u = await undoChange(f.sb, { changeId: r.changeIds[0], actor: "troy" });
    expect(u.ok).toBe(true);
    expect(f.db.cost_ingredients[0]).toMatchObject({ pack_price: 65, last_price_update: "2026-10-01" });
    expect(f.db.cost_price_log).toHaveLength(logRows); // no Undo row for a confirmation
    expect(f.db.invoice_lines[0].state).toBe("reverted");
  });

  // ---- HISTORY: ledger rows written before 23 Nov 2026, when an invoice also set the order item's stored price. Nothing writes one
  // now, so the tests seed the row as the old apply left it (the order item at the invoice price, its own ledger row and log row).
  const OLD_PRODUCT_CHANGE = {
    id: "chg-old-product", line_id: IDS.lineKingfish, document_id: IDS.doc, venue_id: 1, target: "ordering_product", target_id: IDS.kingfishProduct, kind: "price_change", mode: "approved",
    old_price: 65, new_price: 75.79, old_last_price_update: null, old_previous_price: null, old_source: null, ordering_log_id: "olog-1", status: "applied", applied_by: "mon", applied_at: "2026-10-24T02:00:00Z",
  };
  function oldProductChange(over: { ingredientToo?: boolean; lineOver?: Record<string, any> } = {}) {
    const f = setup({
      lines: [line({ product_id: IDS.kingfishProduct, old_product_price: 65, new_product_price: 75.79, state: "applied", ...over.lineOver })],
      products: [product({ price_inc_gst: 75.79 })],
      ing: over.ingredientToo ? { pack_price: 68.9, previous_price: 65, source: LABEL, last_price_update: "2026-10-14" } : {},
    });
    f.db.ordering_price_log.push({ id: "olog-1", venue_id: 1, product_id: IDS.kingfishProduct, old_price: 65, new_price: 75.79, changed_by: "mon", invoice_document_id: IDS.doc });
    f.db.invoice_price_changes = [{ ...OLD_PRODUCT_CHANGE }];
    if (over.ingredientToo) {
      f.db.invoice_price_changes.push({
        id: "chg-old-ingredient", line_id: IDS.lineKingfish, document_id: IDS.doc, venue_id: 1, target: "ingredient", target_id: IDS.kingfish, kind: "price_change", mode: "approved",
        old_price: 65, new_price: 68.9, old_last_price_update: "2026-10-01", old_previous_price: 62, old_source: "Daniel Street price list", status: "applied", applied_by: "mon", applied_at: "2026-10-24T02:00:00Z",
      });
    }
    return f;
  }

  it("an OLD ledger row for an order item still undoes: the stored price goes back and the undo is logged", async () => {
    const f = oldProductChange({ ingredientToo: true });
    const r = await undoChange(f.sb, { changeId: "chg-old-product", actor: "troy" });
    expect(r.ok).toBe(true);
    expect(r.message).toBe("Kingfish Fillets order price is back to $65.00 (was $75.79).");
    expect(f.db.ordering_products[0].price_inc_gst).toBe(65);
    expect(f.db.ordering_price_log).toHaveLength(2);
    expect(f.db.ordering_price_log[1]).toMatchObject({ old_price: 75.79, new_price: 65, changed_by: "troy", invoice_document_id: IDS.doc });
    expect(f.db.invoice_price_changes[0]).toMatchObject({ status: "reverted", reverted_by: "troy" });
    // the ingredient change is still applied, so the line stays applied and the ingredient is untouched
    expect(f.db.invoice_lines[0].state).toBe("applied");
    expect(f.db.cost_ingredients[0].pack_price).toBe(68.9);
    await undoChange(f.sb, { changeId: "chg-old-ingredient", actor: "troy" });
    expect(f.db.cost_ingredients[0].pack_price).toBe(65);
    expect(f.db.invoice_lines[0].state).toBe("reverted");
  });

  it("an OLD order item row on a line with no ingredient undoes and puts the line back", async () => {
    const f = oldProductChange({ lineOver: { ingredient_id: null, old_pack_price: null, new_pack_price: null } });
    const r = await undoChange(f.sb, { changeId: "chg-old-product", actor: "troy" });
    expect(r.ok).toBe(true);
    expect(f.db.ordering_products[0].price_inc_gst).toBe(65);
    expect(f.db.invoice_lines[0].state).toBe("reverted");
  });

  it("an OLD order item price moved by someone else needs force", async () => {
    const f = oldProductChange();
    f.db.ordering_products[0].price_inc_gst = 80;
    const r = await undoChange(f.sb, { changeId: "chg-old-product", actor: "troy" });
    expect(r).toMatchObject({ ok: false, needsForce: true, currentPrice: 80 });
    expect(f.db.ordering_products[0].price_inc_gst).toBe(80);
    const forced = await undoChange(f.sb, { changeId: "chg-old-product", actor: "troy", force: true });
    expect(forced.ok).toBe(true);
    expect(f.db.ordering_products[0].price_inc_gst).toBe(65);
  });

  it("undoDocument still undoes an invoice whose old rows include an order item", async () => {
    const f = oldProductChange({ ingredientToo: true });
    const results = await undoDocument(f.sb, { documentId: IDS.doc, actor: "troy" });
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(f.db.ordering_products[0].price_inc_gst).toBe(65);
    expect(f.db.cost_ingredients[0].pack_price).toBe(65);
    expect(f.db.invoice_price_changes.every((c) => c.status === "reverted")).toBe(true);
  });
});

describe("undoDocument", () => {
  function twoApplied() {
    const f = setup({
      lines: [line({ id: "a", line_no: 1 }), line({ id: "b", line_no: 2, ingredient_id: IDS.barra, old_pack_price: 40, unit_price_ex: 41, new_pack_price: 41, decision: "apply" })],
    });
    f.db.cost_ingredients.push(ingredient({ id: IDS.barra, name: "Barramundi", pack_price: 40 }));
    return f;
  }

  it("undoes everything, newest first", async () => {
    const f = twoApplied();
    await applyLine(f.sb, { lineId: "a", actor: "mon", mode: "approved" });
    vi.setSystemTime(new Date("2026-10-24T03:00:00Z"));
    await applyLine(f.sb, { lineId: "b", actor: "mon", mode: "approved" });
    vi.setSystemTime(new Date("2026-10-25T03:00:00Z"));
    const results = await undoDocument(f.sb, { documentId: IDS.doc, actor: "troy" });
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(results[0].message).toContain("Barramundi"); // b was applied last, so it goes first
    expect(results[1].message).toContain("Kingfish");
    expect(f.db.invoice_price_changes.every((c) => c.status === "reverted")).toBe(true);
    expect(f.db.cost_ingredients.map((i) => i.pack_price)).toEqual([65, 40]);
  });

  it("stops at the first price someone else has moved", async () => {
    const f = twoApplied();
    await applyLine(f.sb, { lineId: "a", actor: "mon", mode: "approved" });
    vi.setSystemTime(new Date("2026-10-24T03:00:00Z"));
    await applyLine(f.sb, { lineId: "b", actor: "mon", mode: "approved" });
    f.db.cost_ingredients[1].pack_price = 43; // Barramundi moved afterwards
    const results = await undoDocument(f.sb, { documentId: IDS.doc, actor: "troy" });
    expect(results).toHaveLength(1);
    expect(results[0].needsForce).toBe(true);
    expect(f.db.cost_ingredients[0].pack_price).toBe(68.9); // the older change was not touched
    expect(f.db.invoice_price_changes.every((c) => c.status === "applied")).toBe(true);
  });

  it("says so when nothing was applied", async () => {
    const f = twoApplied();
    const results = await undoDocument(f.sb, { documentId: IDS.doc, actor: "troy" });
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
  });
});

describe("raw inserts", () => {
  it("only lib/invoice-insert.ts writes new rows (every other invoice module goes through insertRow / insertRows)", () => {
    for (const file of ["invoice-apply", "invoice-store", "invoice-answer", "invoice-context"]) {
      const src = readFileSync(new URL(`../lib/${file}.ts`, import.meta.url), "utf8");
      expect(src, `${file}.ts`).not.toMatch(/\.insert\(/);
      expect(src, `${file}.ts`).not.toMatch(/\[["']insert["']\]/);
      expect(src, `${file}.ts`).not.toMatch(/\.upsert\(/);
    }
    // the one place that writes strips null/undefined keys first, and never imports the store or the service-role module
    const helper = readFileSync(new URL("../lib/invoice-insert.ts", import.meta.url), "utf8");
    expect(helper).toMatch(/\.upsert\(withoutNulls\(row\)\)/);
    expect(helper).toMatch(/\.upsert\(rows\.map\(withoutNulls\)\)/);
    expect(helper).not.toMatch(/^import .*(\.\/store|supabase\/service)/m);
    expect(helper).not.toMatch(/\.insert\(/);
  });
});
