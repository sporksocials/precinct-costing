import { describe, expect, it } from "vitest";
import { computeIngredientCosts } from "../lib/invoice-cost-stats";
import type { CostStatLine } from "../lib/invoice-cost-stats";
import { analyseInvoice } from "../lib/invoice-engine";
import { baseCtx, danielStreet51329Fixed } from "./fixtures/invoice-fixtures";

const TODAY = "2026-10-24";
const settings = { averageDays: 90 };

/** a product line with sensible defaults: 10 kg bought at $5/kg, landed $5.50/kg */
function row(over: Partial<CostStatLine> = {}): CostStatLine {
  return {
    ingredient_id: "ing-a", document_id: "doc-1", invoice_date: "2026-10-10", line_class: "product", unit_price_ex: 5, qty: 10,
    landed_total_ex: 55, landed_base_ex: 5.5, base_qty: 10, base_unit: "kg", packs_per_unit: 1, state: "open", ...over,
  };
}

describe("computeIngredientCosts", () => {
  it("last cost is the latest invoice's price and landed cost per base unit", () => {
    const [c] = computeIngredientCosts([row({ document_id: "d1", invoice_date: "2026-09-01" }), row({ document_id: "d2", invoice_date: "2026-10-12", unit_price_ex: 6, landed_total_ex: 66, landed_base_ex: 6.6 })], settings, TODAY);
    expect(c.last).toEqual({ invoice_date: "2026-10-12", document_id: "d2", unit_price_base: 6, landed_base: 6.6 });
    expect(c.base_unit).toBe("kg");
    expect(c.window_days).toBe(90);
  });

  it("average is quantity weighted: total landed dollars over total base quantity", () => {
    // 10 kg at $5.50 landed and 90 kg at $4.00 landed: weighted $4.15, not the plain mean $4.75
    const [c] = computeIngredientCosts(
      [row({ document_id: "d1" }), row({ document_id: "d2", invoice_date: "2026-10-11", landed_total_ex: 360, landed_base_ex: 4, base_qty: 90, qty: 90, unit_price_ex: 3.9 })],
      settings,
      TODAY,
    );
    expect(c.average_landed_base).toBe(4.15);
    expect(c.deliveries).toBe(2);
  });

  it("counts deliveries as distinct documents", () => {
    const [c] = computeIngredientCosts([row(), row({ landed_total_ex: 11, landed_base_ex: 5.5, base_qty: 2, qty: 2 })], settings, TODAY);
    expect(c.deliveries).toBe(1);
    expect(c.average_landed_base).toBe(5.5);
  });

  it("leaves out lines outside the window from the average, but still reports the last cost", () => {
    const [c] = computeIngredientCosts([row({ document_id: "old", invoice_date: "2026-05-01", landed_total_ex: 100, landed_base_ex: 10 })], settings, TODAY);
    expect(c.average_landed_base).toBeNull();
    expect(c.deliveries).toBe(0);
    expect(c.last?.document_id).toBe("old");
  });

  it("the window edge is inclusive: exactly averageDays ago counts", () => {
    const [c] = computeIngredientCosts([row({ invoice_date: "2026-07-26" })], settings, TODAY);
    expect(c.average_landed_base).toBe(5.5);
    const [d] = computeIngredientCosts([row({ invoice_date: "2026-07-25" })], settings, TODAY);
    expect(d.average_landed_base).toBeNull();
  });

  it("ignores reverted and ignored lines, non product lines, lines with no ingredient and lines dated in the future", () => {
    const rows = [
      row({ state: "reverted", landed_total_ex: 999, landed_base_ex: 99.9 }),
      row({ state: "ignored", landed_total_ex: 999, landed_base_ex: 99.9 }),
      row({ line_class: "delivery", landed_total_ex: 999, landed_base_ex: 99.9 }),
      row({ ingredient_id: null, landed_total_ex: 999, landed_base_ex: 99.9 }),
      row({ invoice_date: "2026-12-01", landed_total_ex: 999, landed_base_ex: 99.9 }),
      row({ invoice_date: null, landed_total_ex: 999, landed_base_ex: 99.9 }),
      row({ document_id: "good" }),
    ];
    const out = computeIngredientCosts(rows, settings, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].average_landed_base).toBe(5.5);
    expect(out[0].last?.document_id).toBe("good");
  });

  it("a line missing its landed cost or its quantity does not count toward the average", () => {
    const [c] = computeIngredientCosts([row({ landed_total_ex: null, landed_base_ex: null }), row({ base_qty: null, document_id: "d2" })], settings, TODAY);
    expect(c.average_landed_base).toBeNull();
    expect(c.last).toBeNull();
  });

  it("a credited quantity netted off a line is respected in the average", () => {
    // 10 kg bought, 2 kg credited: landed total $80 over the 8 kg kept is $10/kg
    const [c] = computeIngredientCosts([row({ landed_total_ex: 80, landed_base_ex: 10, base_qty: 10, qty: 10, unit_price_ex: 10 })], settings, TODAY);
    expect(c.average_landed_base).toBe(10);
  });

  it("picks a deterministic last when two lines share a date", () => {
    const rows = [row({ document_id: "a", unit_price_ex: 5 }), row({ document_id: "b", unit_price_ex: 6, landed_base_ex: 6.5, landed_total_ex: 65 })];
    expect(computeIngredientCosts(rows, settings, TODAY)[0].last?.document_id).toBe("b");
    expect(computeIngredientCosts([...rows].reverse(), settings, TODAY)[0].last?.document_id).toBe("b");
  });

  it("works per ingredient and sorts by id; an empty input gives nothing", () => {
    const out = computeIngredientCosts([row({ ingredient_id: "z" }), row({ ingredient_id: "a" })], settings, TODAY);
    expect(out.map((o) => o.ingredient_id)).toEqual(["a", "z"]);
    expect(computeIngredientCosts([], settings, TODAY)).toEqual([]);
  });

  it("without qty the last cost cannot be stated, but the average still works", () => {
    const r = row();
    delete (r as { qty?: number | null }).qty;
    const [c] = computeIngredientCosts([r], settings, TODAY);
    expect(c.last).toBeNull();
    expect(c.average_landed_base).toBe(5.5);
  });

  it("rounds money to four decimals", () => {
    const [c] = computeIngredientCosts([row({ landed_total_ex: 10, landed_base_ex: 3.3333, base_qty: 3, qty: 3, unit_price_ex: 3.123456 })], settings, TODAY);
    expect(c.average_landed_base).toBe(3.3333);
    expect(c.last?.unit_price_base).toBe(3.1235);
  });

  it("works on the engine's own output (Daniel Street kingfish)", () => {
    const a = analyseInvoice(danielStreet51329Fixed(), baseCtx());
    const rows = a.lines.map((l) => ({ ...l, document_id: "doc-51329" }));
    const [barra, kingfish] = computeIngredientCosts(rows as unknown as CostStatLine[], settings, TODAY);
    // ingredient ids sort as "ing-barra" then "ing-kingfish"
    expect(barra.ingredient_id).toBe("ing-barra");
    expect(kingfish.ingredient_id).toBe("ing-kingfish");
    expect(kingfish.last).toEqual({ invoice_date: "2026-10-14", document_id: "doc-51329", unit_price_base: 68.9, landed_base: 70.8378 });
    expect(kingfish.average_landed_base).toBe(70.8378);
    // the barramundi carries a standing $16.45 discount over its full 2.39 kg, so its landed cost per kilo is known and is the NET one
    expect(barra.average_landed_base).toBe(35.6318);
    expect(barra.last).toEqual({ invoice_date: "2026-10-14", document_id: "doc-51329", unit_price_base: 41.54, landed_base: 35.6318 });
  });
});
